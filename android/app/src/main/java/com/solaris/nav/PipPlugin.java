package com.solaris.nav;

import android.app.Activity;
import android.app.AppOpsManager;
import android.app.PictureInPictureParams;
import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.BatteryManager;
import android.util.Rational;
import android.content.SharedPreferences;
import android.location.LocationManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Small, optional PiP bridge. It never requests overlay/background location permission. */
@CapacitorPlugin(name = "Pip")
public class PipPlugin extends Plugin {
    private static PipPlugin instance;
    private static boolean navigationActive;
    private static boolean autoEnter = true;
    private BroadcastReceiver locationReceiver;
    private BroadcastReceiver runtimeHealthReceiver;

    public static void dispatchSpeechResume() {
        if (instance != null) instance.notifyListeners("speechResume", new JSObject());
    }
    @PluginMethod public void speakFocused(PluginCall call) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            JSObject result = new JSObject();
            // A PiP WebView can still execute JS while the Activity is paused.
            // Only the native route engine owns speech then; otherwise both
            // providers could interrupt each other on the same GPS update.
            NavigationSpeech speech = NavigationSpeech.get(getContext());
            result.put("accepted", MainActivity.foreground && speech.speak(call.getString("text", ""), call.getString("lang", "en-US"), false, call.getArray("segments")));
            result.put("languageFallback", speech.usedLanguageFallback());
            result.put("voiceFallback", speech.usedVoiceFallback());
            call.resolve(result);
        });
    }
    @PluginMethod public void getSpeechSettings(PluginCall call) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> call.resolve(NavigationSpeech.get(getContext()).speechSettings()));
    }
    @PluginMethod public void setSpeechSettings(PluginCall call) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            try { call.resolve(NavigationSpeech.get(getContext()).saveSpeechSettings(call.getObject("settings", new JSObject()))); }
            catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void stopFocusedSpeech(PluginCall call) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> { NavigationSpeech.get(getContext()).stopForeground(); call.resolve(); });
    }
    @PluginMethod public void setGuidanceRoute(PluginCall call) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            try { NativeGuidance.get(getContext()).configure(call.getObject("route", new JSObject())); call.resolve(); }
            catch (Exception e) { call.reject("Invalid guidance route"); }
        });
    }
    @PluginMethod public void clearGuidanceRoute(PluginCall call) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> { NativeGuidance.get(getContext()).clear(call.getLong("revision", 0L)); call.resolve(); });
    }
    @PluginMethod public void setGuidanceMuted(PluginCall call) {
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> { NativeGuidance.get(getContext()).setMuted(call.getBoolean("muted", false)); call.resolve(); });
    }

    @PluginMethod
    public void setDriveRecording(PluginCall call) {
        DriveJournal.get(getContext()).setActive(call.getBoolean("active", false));
        call.resolve();
    }
    @PluginMethod
    public void recordDriveEvent(PluginCall call) {
        DriveJournal.get(getContext()).append(call.getString("type", "event"), call.getObject("data", new JSObject()));
        call.resolve();
    }
    @PluginMethod
    public void getDriveRecording(PluginCall call) {
        DriveJournal journal = DriveJournal.get(getContext());
        if (call.getBoolean("statusOnly", false)) {
            JSObject result = new JSObject(); result.put("active", journal.isActive()); call.resolve(result); return;
        }
        journal.export(json -> {
            if (json == null) { call.reject("Unable to read recording"); return; }
            JSObject result = new JSObject(); result.put("json", json); result.put("active", journal.isActive()); call.resolve(result);
        });
    }
    @PluginMethod
    public void clearDriveRecording(PluginCall call) { DriveJournal.get(getContext()).clear(success -> { if (success) call.resolve(); else call.reject("Recording deletion failed"); }); }

    @PluginMethod
    public void getRuntimeHealth(PluginCall call) {
        JSObject result = new JSObject();
        PowerManager power = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        result.put("powerSaveMode", power != null && power.isPowerSaveMode());
        result.put("thermalStatus", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && power != null
            ? power.getCurrentThermalStatus() : -1);
        Intent battery = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery != null) {
            int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
            if (level >= 0 && scale > 0) result.put("batteryPercent", 100.0 * level / scale);
            int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            result.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
            // Battery protection can pause charging while external power remains connected.
            result.put("externalPowerConnected", battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0);
            if (battery.hasExtra(BatteryManager.EXTRA_TEMPERATURE)) {
                result.put("batteryTemperatureC", battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) / 10.0);
            }
        }
        result.put("device", Build.MANUFACTURER + " " + Build.MODEL);
        try {
            result.put("brightness", android.provider.Settings.System.getInt(getContext().getContentResolver(), android.provider.Settings.System.SCREEN_BRIGHTNESS));
            result.put("brightnessMode", android.provider.Settings.System.getInt(getContext().getContentResolver(), android.provider.Settings.System.SCREEN_BRIGHTNESS_MODE));
        } catch (android.provider.Settings.SettingNotFoundException | SecurityException ignored) { /* Unknown is not zero. */ }
        call.resolve(result);
    }

    @PluginMethod
    public void saveDriveRecording(PluginCall call) {
        String json = call.getString("json");
        if (json == null || json.length() > 12 * 1024 * 1024) {
            call.reject("Recording is missing or too large");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, "solarless-drive-" + System.currentTimeMillis() + ".json");
        startActivityForResult(call, intent, "driveRecordingSaved");
    }

    @ActivityCallback
    private void driveRecordingSaved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject response = new JSObject();
            response.put("saved", false);
            call.resolve(response);
            return;
        }
        try (OutputStream stream = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
            if (stream == null) throw new java.io.IOException("No output stream");
            stream.write(call.getString("json", "{}").getBytes(StandardCharsets.UTF_8));
            JSObject response = new JSObject();
            response.put("saved", true);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to save drive recording", error);
        }
    }

    @Override
    public void load() {
        instance = this;
        runtimeHealthReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                notifyListeners("runtimeHealthChanged", new JSObject());
            }
        };
        IntentFilter healthFilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
        healthFilter.addAction(Intent.ACTION_POWER_CONNECTED);
        healthFilter.addAction(Intent.ACTION_POWER_DISCONNECTED);
        healthFilter.addAction(PowerManager.ACTION_POWER_SAVE_MODE_CHANGED);
        androidx.core.content.ContextCompat.registerReceiver(getContext(), runtimeHealthReceiver, healthFilter,
            androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
        navigationActive = LocationForegroundService.isRunning();
        locationReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (LocationForegroundService.ACTION_SERVICE_STATUS.equals(intent.getAction())) {
                    String reason = intent.getStringExtra(LocationForegroundService.EXTRA_REASON);
                    if (reason != null && (reason.startsWith("LOCATION_SERVICE_") ||
                        "LOCATION_PERMISSION_MISSING".equals(reason))) {
                        navigationActive = false;
                    }
                    dispatchReason(reason);
                    return;
                }
                if (!LocationForegroundService.ACTION_LOCATION_UPDATE.equals(intent.getAction())) return;
                JSObject data = new JSObject();
                data.put("lat", intent.getDoubleExtra("lat", Double.NaN));
                data.put("lng", intent.getDoubleExtra("lng", Double.NaN));
                data.put("accuracy", intent.getFloatExtra("accuracy", -1f));
                data.put("accuracyConfidenceLevel", intent.getFloatExtra("accuracyConfidenceLevel",
                    LocationForegroundService.HORIZONTAL_ACCURACY_CONFIDENCE_LEVEL));
                data.put("accuracySource", intent.getStringExtra("accuracySource") == null
                    ? LocationForegroundService.HORIZONTAL_ACCURACY_SOURCE : intent.getStringExtra("accuracySource"));
                data.put("timestamp", intent.getLongExtra("timestamp", 0L));
                data.put("source", intent.getStringExtra("source"));
                if (intent.hasExtra("speed")) data.put("speed", intent.getFloatExtra("speed", -1f));
                if (intent.hasExtra("heading")) data.put("heading", intent.getFloatExtra("heading", -1f));
                notifyListeners("locationUpdate", data);
            }
        };
        try {
            IntentFilter filter = new IntentFilter(LocationForegroundService.ACTION_LOCATION_UPDATE);
            filter.addAction(LocationForegroundService.ACTION_SERVICE_STATUS);
            androidx.core.content.ContextCompat.registerReceiver(getContext(), locationReceiver, filter,
                androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);
        } catch (Exception ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
        if (runtimeHealthReceiver != null) {
            try { getContext().unregisterReceiver(runtimeHealthReceiver); } catch (Exception ignored) { }
            runtimeHealthReceiver = null;
        }
        if (locationReceiver != null) {
            try { getContext().unregisterReceiver(locationReceiver); } catch (Exception ignored) { }
            locationReceiver = null;
        }
        super.handleOnDestroy();
    }

    private static boolean supported(Activity activity) {
        return activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    @PluginMethod
    public void isPipSupported(PluginCall call) {
        JSObject result = new JSObject();
        Activity activity = getActivity();
        result.put("supported", supported(activity));
        result.put("allowed", isAllowed(activity));
        result.put("autoEnter", autoEnter);
        result.put("navigationActive", navigationActive);
        result.put("inPip", Build.VERSION.SDK_INT >= 26 && activity != null && activity.isInPictureInPictureMode());
        result.put("reason", supported(activity) ? (isAllowed(activity) ? "OK" : "OS_PIP_BLOCKED") : "UNSUPPORTED");
        call.resolve(result);
    }

    @PluginMethod
    public void isPipAllowed(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", supported(getActivity()));
        result.put("allowed", isAllowed(getActivity()));
        result.put("autoEnter", autoEnter);
        result.put("navigationActive", navigationActive);
        result.put("inPip", Build.VERSION.SDK_INT >= 26 && getActivity() != null && getActivity().isInPictureInPictureMode());
        result.put("reason", isAllowed(getActivity()) ? "OK" : "OS_PIP_BLOCKED");
        call.resolve(result);
    }

    @PluginMethod
    public void getLocationPermissionState(PluginCall call) {
        Activity activity = getActivity();
        boolean legacyGranted = activity != null && Build.VERSION.SDK_INT < Build.VERSION_CODES.M;
        boolean coarse = legacyGranted || activity != null &&
            activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean fine = legacyGranted || activity != null &&
            activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("coarse", coarse);
        result.put("fine", fine);
        result.put("granted", coarse || fine);
        result.put("state", fine ? "fine-granted" : (coarse ? "coarse-granted" : "prompt-or-denied"));
        call.resolve(result);
    }

    @PluginMethod
    public void getLastNavigationLocation(PluginCall call) {
        // Resume from the newest in-memory fix, not the two-second disk checkpoint.
        android.location.Location latest = LocationForegroundService.getLatestLocation();
        if (latest != null) {
            long age = Math.max(0L, System.currentTimeMillis() - latest.getTime());
            JSObject live = new JSObject();
            live.put("available", latest.getTime() > 0 && age <= LocationForegroundService.LAST_LOCATION_TTL_MS);
            live.put("timestamp", latest.getTime()); live.put("ageMs", age);
            live.put("lat", latest.getLatitude()); live.put("lng", latest.getLongitude());
            live.put("accuracy", latest.hasAccuracy() ? latest.getAccuracy() : -1f);
            live.put("accuracyConfidenceLevel", LocationForegroundService.HORIZONTAL_ACCURACY_CONFIDENCE_LEVEL);
            live.put("accuracySource", LocationForegroundService.HORIZONTAL_ACCURACY_SOURCE);
            live.put("provider", latest.getProvider());
            if (latest.hasSpeed()) live.put("speed", latest.getSpeed());
            if (latest.hasBearing()) live.put("heading", latest.getBearing());
            call.resolve(live); return;
        }
        SharedPreferences prefs = getContext().getSharedPreferences(LocationForegroundService.PREFS, Context.MODE_PRIVATE);
        long timestamp = prefs.getLong("timestamp", 0L);
        long ageMs = timestamp > 0 ? Math.max(0L, System.currentTimeMillis() - timestamp) : Long.MAX_VALUE;
        JSObject result = new JSObject();
        result.put("available", timestamp > 0 && ageMs <= LocationForegroundService.LAST_LOCATION_TTL_MS);
        result.put("timestamp", timestamp);
        result.put("ageMs", ageMs == Long.MAX_VALUE ? -1L : ageMs);
        if (timestamp > 0 && ageMs <= LocationForegroundService.LAST_LOCATION_TTL_MS) {
            try {
                result.put("lat", Double.parseDouble(prefs.getString("lat", "NaN")));
                result.put("lng", Double.parseDouble(prefs.getString("lng", "NaN")));
            } catch (Exception error) {
                result.put("available", false);
            }
            result.put("accuracy", prefs.getFloat("accuracy", -1f));
            result.put("accuracyConfidenceLevel", LocationForegroundService.HORIZONTAL_ACCURACY_CONFIDENCE_LEVEL);
            result.put("accuracySource", LocationForegroundService.HORIZONTAL_ACCURACY_SOURCE);
            result.put("provider", prefs.getString("provider", "native"));
            if (prefs.contains("speed")) result.put("speed", prefs.getFloat("speed", -1f));
            if (prefs.contains("bearing")) result.put("heading", prefs.getFloat("bearing", -1f));
        }
        call.resolve(result);
    }

    @PluginMethod
    public void isDebugBuild(PluginCall call) {
        JSObject result = new JSObject();
        Activity activity = getActivity();
        boolean debug = activity != null && (activity.getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        result.put("debug", debug);
        call.resolve(result);
    }

    @PluginMethod
    public void getAppVersion(PluginCall call) {
        JSObject result = new JSObject();
        try {
            Activity activity = getActivity();
            android.content.pm.PackageInfo info = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
            result.put("versionName", info.versionName == null ? "0.0.0" : info.versionName);
            result.put("versionCode", Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode);
        } catch (Exception error) {
            result.put("versionName", "0.0.0");
            result.put("versionCode", 0);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void setNavigationActive(PluginCall call) {
        boolean requestedActive = call.getBoolean("active", false);
        if (!requestedActive) new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> NativeGuidance.get(getContext()).clear());
        autoEnter = call.getBoolean("autoEnter", autoEnter);
        Activity activity = getActivity();
        boolean locationServiceStarted = false;
        if (requestedActive) {
            locationServiceStarted = startLocationService(activity);
            navigationActive = locationServiceStarted;
        } else {
            navigationActive = false;
            stopLocationService(activity);
        }
        updateActivityParams(activity);
        String reason = navigationActive ? "NAVIGATION_ACTIVE" :
            (requestedActive ? "LOCATION_SERVICE_START_FAILED" : "NAVIGATION_INACTIVE");
        JSObject result = state(activity, reason);
        result.put("locationServiceStarted", locationServiceStarted);
        call.resolve(result);
    }

    @PluginMethod
    public void enterPip(PluginCall call) {
        Activity activity = getActivity();
        if (!supported(activity)) {
            call.reject("UNSUPPORTED");
            return;
        }
        if (!isAllowed(activity)) {
            call.reject("OS_PIP_BLOCKED");
            return;
        }
        if (!navigationActive) {
            call.reject("NAVIGATION_INACTIVE");
            return;
        }
        try {
            boolean entered = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.enterPictureInPictureMode(buildParams());
            if (entered) call.resolve(state(activity, "ENTERED"));
            else { dispatchReason("ENTER_FAILED"); call.reject("ENTER_FAILED"); }
        } catch (Exception error) {
            dispatchReason("ENTER_EXCEPTION");
            call.reject("ENTER_EXCEPTION", error);
        }
    }

    @PluginMethod
    public void updatePipParams(PluginCall call) {
        autoEnter = call.getBoolean("autoEnter", autoEnter);
        Activity activity = getActivity();
        updateActivityParams(activity);
        call.resolve(state(activity, isAllowed(activity) ? "PARAMS_UPDATED" : "OS_PIP_BLOCKED"));
    }

    @PluginMethod
    public void openPipSettings(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("Activity unavailable"); return; }
        try {
            Intent intent = new Intent("android.settings.PICTURE_IN_PICTURE_SETTINGS",
                Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("PiP settings are not available", error);
        }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.O)
    private static PictureInPictureParams buildParams() {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(autoEnter);
            builder.setSeamlessResizeEnabled(true);
        }
        // Keep the compact navigation window close to the landscape ratio used
        // by Android Auto/Google Maps. The WebView switches to its map-only
        // PiP surface via body.pip-mode, so a stable ratio avoids clipping the
        // turn HUD when the launcher resizes the activity.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try { builder.setAspectRatio(new Rational(16, 9)); } catch (IllegalArgumentException ignored) { }
        }
        return builder.build();
    }

    private static boolean isAllowed(Activity activity) {
        if (!supported(activity)) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        try {
            AppOpsManager ops = (AppOpsManager) activity.getSystemService(Context.APP_OPS_SERVICE);
            if (ops == null) return true;
            int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE,
                android.os.Process.myUid(), activity.getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED || mode == AppOpsManager.MODE_DEFAULT;
        } catch (Exception ignored) {
            return true;
        }
    }

    private static JSObject state(Activity activity, String reason) {
        JSObject result = new JSObject();
        result.put("supported", supported(activity));
        result.put("allowed", isAllowed(activity));
        result.put("autoEnter", autoEnter);
        result.put("navigationActive", navigationActive);
        result.put("inPip", Build.VERSION.SDK_INT >= 26 && activity != null && activity.isInPictureInPictureMode());
        result.put("reason", reason);
        return result;
    }

    private static void updateActivityParams(Activity activity) {
        if (!supported(activity) || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try { activity.setPictureInPictureParams(buildParams()); } catch (Exception ignored) { }
    }

    private static boolean hasLocationPermission(Activity activity) {
        if (activity == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean hasEnabledLocationProvider(Activity activity) {
        if (activity == null) return false;
        try {
            LocationManager manager = (LocationManager) activity.getSystemService(Context.LOCATION_SERVICE);
            return manager != null && (manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
        } catch (RuntimeException error) {
            return false;
        }
    }

    private static boolean startLocationService(Activity activity) {
        if (activity == null) return false;
        if (!hasLocationPermission(activity)) {
            dispatchReason("LOCATION_PERMISSION_MISSING");
            return false;
        }
        if (!hasEnabledLocationProvider(activity)) {
            dispatchReason("LOCATION_SERVICE_NO_PROVIDER");
            return false;
        }
        if (LocationForegroundService.isRunning()) return true;
        Intent intent = new Intent(activity, LocationForegroundService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) activity.startForegroundService(intent);
            else activity.startService(intent);
            return true;
        } catch (SecurityException error) {
            dispatchReason("LOCATION_PERMISSION_MISSING");
        } catch (IllegalStateException error) {
            dispatchReason("LOCATION_SERVICE_START_FAILED");
        } catch (RuntimeException error) {
            dispatchReason("LOCATION_SERVICE_START_FAILED");
        }
        return false;
    }

    private static void stopLocationService(Activity activity) {
        if (activity == null) return;
        try {
            activity.stopService(new Intent(activity, LocationForegroundService.class));
            LocationForegroundService.clearLastLocation(activity);
            dispatchReason("LOCATION_SERVICE_STOPPED");
        } catch (Exception error) {
            dispatchReason("LOCATION_SERVICE_STOPPED");
        }
    }

    static void handleUserLeaveHint(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !navigationActive || !autoEnter) return;
        if (!supported(activity)) { dispatchReason("UNSUPPORTED"); return; }
        if (!isAllowed(activity)) { dispatchReason("OS_PIP_BLOCKED"); return; }
        // Android 12+ owns the automatic transition after auto-enter params
        // are set. Calling enterPictureInPictureMode here as well can race the
        // system transition and produce duplicate ENTER_FAILED callbacks.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            updateActivityParams(activity);
            return;
        }
        try {
            if (!activity.enterPictureInPictureMode(buildParams())) dispatchReason("ENTER_FAILED");
        } catch (Exception error) {
            dispatchReason("ENTER_EXCEPTION");
        }
    }

    static void dispatchModeChanged(boolean inPip) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("inPip", inPip);
        instance.notifyListeners("pipModeChanged", data);
    }

    private static void dispatchReason(String reason) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("reason", reason);
        instance.notifyListeners("pipDebug", data);
    }
}
