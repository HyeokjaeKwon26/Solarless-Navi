package com.solaris.nav;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;
    private File readyFile;
    private String readyHash;
    private long readyVersion;

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    private int signatureFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private Set<String> signers(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
            ? info.signingInfo.getApkContentsSigners() : info.signatures;
        Set<String> result = new HashSet<>();
        if (signatures != null) for (Signature signature : signatures) {
            result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        }
        return result;
    }

    private long version(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @PluginMethod
    public void getInstalledInfo(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags());
            Set<String> certificates = signers(info);
            JSObject result = new JSObject();
            result.put("packageName", info.packageName);
            result.put("versionName", info.versionName);
            result.put("versionCode", version(info));
            result.put("sdkInt", Build.VERSION.SDK_INT);
            result.put("certificateSha256", certificates.size() == 1 ? certificates.iterator().next() : "");
            call.resolve(result);
        } catch (Exception error) { call.reject("VERSION_READ_FAILED", error); }
    }

    private HttpURLConnection open(String address) throws Exception {
        String current = address;
        for (int redirects = 0; redirects <= 5; redirects++) {
            UpdatePolicy.checkUrl(current, redirects > 0);
            HttpURLConnection request = (HttpURLConnection) new URL(current).openConnection();
            connection = request;
            request.setConnectTimeout(15000);
            request.setReadTimeout(15000);
            request.setInstanceFollowRedirects(false);
            request.setRequestProperty("User-Agent", "SolarLessNavi-Updater");
            request.setRequestProperty("Accept-Encoding", "identity");
            if (cancelled) { request.disconnect(); throw new Exception("CANCELLED"); }
            int status = request.getResponseCode();
            if (status == 200) return request;
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = request.getHeaderField("Location");
                request.disconnect();
                if (location == null) throw new Exception("DOWNLOAD_FAILED");
                current = new URL(new URL(current), location).toString();
                continue;
            }
            request.disconnect();
            throw new Exception("HTTP_" + status);
        }
        throw new Exception("TOO_MANY_REDIRECTS");
    }

    private void verify(File file, String expectedHash, long expectedVersion) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[65536];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        if (!hex(digest.digest()).equalsIgnoreCase(expectedHash)) throw new Exception("HASH_MISMATCH");
        PackageManager manager = getContext().getPackageManager();
        PackageInfo archive = manager.getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), signatureFlags());
        if (archive == null) throw new Exception("INVALID_APK");
        UpdatePolicy.checkIdentity(installed.packageName, version(installed), signers(installed),
            archive.packageName, version(archive), signers(archive), expectedVersion);
        if (Build.VERSION.SDK_INT >= 24 && archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT) throw new Exception("ANDROID_TOO_OLD");
    }

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("BUSY"); return; }
        cancelled = false;
        executor.execute(() -> {
            File partial = null;
            File target = null;
            try {
                if (LocationForegroundService.isRunning()) throw new Exception("DRIVING");
                String address = call.getString("url", "");
                String hash = call.getString("sha256", "");
                long size = call.getLong("sizeBytes", 0L);
                long code = call.getLong("versionCode", 0L);
                UpdatePolicy.checkUrl(address, false);
                UpdatePolicy.checkMetadata(hash, size, code);
                File folder = new File(getContext().getCacheDir(), "app-updates");
                if (!folder.exists() && !folder.mkdirs()) throw new Exception("STORAGE_FAILED");
                partial = new File(folder, "update.part");
                target = new File(folder, "update.apk");
                readyFile = null;
                if (target.exists() && !target.delete()) throw new Exception("STORAGE_FAILED");
                long started = android.os.SystemClock.elapsedRealtime();
                HttpURLConnection request = open(address);
                String contentLength = request.getHeaderField("Content-Length");
                long advertised = contentLength == null ? -1 : Long.parseLong(contentLength);
                if (advertised >= 0 && advertised != size) throw new Exception("SIZE_MISMATCH");
                long received = 0;
                long lastProgress = 0;
                try (InputStream input = request.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancelled) throw new Exception("CANCELLED");
                        if (android.os.SystemClock.elapsedRealtime() - started > 120000) throw new Exception("DOWNLOAD_TIMEOUT");
                        received += count;
                        if (received > size) throw new Exception("SIZE_MISMATCH");
                        output.write(buffer, 0, count);
                        long now = android.os.SystemClock.elapsedRealtime();
                        if (now - lastProgress >= 200 || received == size) {
                            JSObject progress = new JSObject();
                            progress.put("receivedBytes", received);
                            progress.put("totalBytes", size);
                            notifyListeners("downloadProgress", progress);
                            lastProgress = now;
                        }
                    }
                }
                if (received != size) throw new Exception("SIZE_MISMATCH");
                if (cancelled) throw new Exception("CANCELLED");
                verify(partial, hash, code);
                if (cancelled) throw new Exception("CANCELLED");
                if (!partial.renameTo(target)) throw new Exception("STORAGE_FAILED");
                readyFile = target;
                readyHash = hash;
                readyVersion = code;
                JSObject result = new JSObject(); result.put("verified", true); call.resolve(result);
            } catch (Exception error) {
                if (target != null) target.delete();
                call.reject(cancelled ? "CANCELLED" : error.getMessage(), error);
            } finally {
                if (connection != null) connection.disconnect();
                connection = null;
                if (partial != null) partial.delete();
                busy.set(false);
            }
        });
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        cancelled = true;
        if (connection != null) connection.disconnect();
        call.resolve();
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("BUSY"); return; }
        if (LocationForegroundService.isRunning()) { busy.set(false); call.reject("DRIVING"); return; }
        if (readyFile == null || !readyFile.isFile()) { busy.set(false); call.reject("DOWNLOAD_REQUIRED"); return; }
        executor.execute(() -> {
            try {
                verify(readyFile, readyHash, readyVersion);
                getActivity().runOnUiThread(() -> {
                    try {
                        if (LocationForegroundService.isRunning()) throw new Exception("DRIVING");
                        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getContext().getPackageName()));
                            startActivityForResult(call, settings, "permissionReturned");
                            return;
                        }
                        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".updates", readyFile);
                        Intent installer = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive");
                        installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        getActivity().startActivity(installer);
                        busy.set(false);
                        JSObject result = new JSObject(); result.put("installerOpened", true); call.resolve(result);
                    } catch (Exception error) { busy.set(false); call.reject(error.getMessage(), error); }
                });
            } catch (Exception error) { busy.set(false); call.reject(error.getMessage(), error); }
        });
    }

    @ActivityCallback
    private void permissionReturned(PluginCall call, ActivityResult result) {
        busy.set(false);
        if (call == null) return;
        JSObject response = new JSObject();
        response.put("permissionGranted", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(response); // Explicit second tap; never auto-install on resume.
    }

    @Override protected void handleOnDestroy() {
        cancelled = true;
        if (connection != null) connection.disconnect();
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
