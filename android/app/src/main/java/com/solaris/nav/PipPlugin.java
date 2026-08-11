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

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Small, optional PiP bridge. It never requests overlay/background location permission. */
@CapacitorPlugin(name = "Pip")
public class PipPlugin extends Plugin {
    private static PipPlugin instance;
    private static boolean navigationActive;
    private static boolean autoEnter = true;
    private BroadcastReceiver locationReceiver;

    @Override
    public void load() {
        instance = this;
        locationReceiver = new BroadcastReceiver() {
            @Override public void onReceive(Context context, Intent intent) {
                if (!LocationForegroundService.ACTION_LOCATION_UPDATE.equals(intent.getAction())) return;
                JSObject data = new JSObject();
                data.put("lat", intent.getDoubleExtra("lat", Double.NaN));
                data.put("lng", intent.getDoubleExtra("lng", Double.NaN));
                data.put("accuracy", intent.getFloatExtra("accuracy", -1f));
                data.put("timestamp", intent.getLongExtra("timestamp", 0L));
                data.put("source", intent.getStringExtra("source"));
                if (intent.hasExtra("speed")) data.put("speed", intent.getFloatExtra("speed", -1f));
                if (intent.hasExtra("heading")) data.put("heading", intent.getFloatExtra("heading", -1f));
                notifyListeners("locationUpdate", data);
            }
        };
        try {
            IntentFilter filter = new IntentFilter(LocationForegroundService.ACTION_LOCATION_UPDATE);
            if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(locationReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            else getContext().registerReceiver(locationReceiver, filter);
        } catch (Exception ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
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
        boolean coarse = activity != null && Build.VERSION.SDK_INT >= 23 &&
            activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean fine = activity != null && Build.VERSION.SDK_INT >= 23 &&
            activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("coarse", coarse);
        result.put("fine", fine);
        result.put("granted", coarse || fine);
        result.put("state", fine ? "fine-granted" : (coarse ? "coarse-granted" : "prompt-or-denied"));
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
        navigationActive = call.getBoolean("active", false);
        autoEnter = call.getBoolean("autoEnter", autoEnter);
        Activity activity = getActivity();
        if (navigationActive) startLocationService(activity); else stopLocationService(activity);
        updateActivityParams(activity);
        JSObject result = state(activity, navigationActive ? "NAVIGATION_ACTIVE" : "NAVIGATION_INACTIVE");
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

    private static PictureInPictureParams buildParams() {
        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(autoEnter);
            builder.setSeamlessResizeEnabled(true);
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

    private static void startLocationService(Activity activity) {
        if (activity == null) return;
        Intent intent = new Intent(activity, LocationForegroundService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) activity.startForegroundService(intent);
            else activity.startService(intent);
        } catch (Exception ignored) { }
    }

    private static void stopLocationService(Activity activity) {
        if (activity == null) return;
        try { activity.stopService(new Intent(activity, LocationForegroundService.class)); } catch (Exception ignored) { }
    }

    static void handleUserLeaveHint(Activity activity) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !navigationActive || !autoEnter) return;
        if (!supported(activity)) { dispatchReason("UNSUPPORTED"); return; }
        if (!isAllowed(activity)) { dispatchReason("OS_PIP_BLOCKED"); return; }
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
