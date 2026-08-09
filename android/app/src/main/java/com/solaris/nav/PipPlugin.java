package com.solaris.nav;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Intent;
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
    private static boolean autoEnter;

    @Override
    public void load() {
        instance = this;
    }

    private static boolean supported(Activity activity) {
        return activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            activity.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE);
    }

    @PluginMethod
    public void isPipSupported(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", supported(getActivity()));
        result.put("inPip", Build.VERSION.SDK_INT >= 26 && getActivity() != null && getActivity().isInPictureInPictureMode());
        call.resolve(result);
    }

    @PluginMethod
    public void isPipAllowed(PluginCall call) {
        // Android controls this per application in Settings. The capability
        // result is intentionally conservative and has no extra permission.
        JSObject result = new JSObject();
        result.put("allowed", supported(getActivity()));
        call.resolve(result);
    }

    @PluginMethod
    public void setNavigationActive(PluginCall call) {
        navigationActive = call.getBoolean("active", false);
        autoEnter = call.getBoolean("autoEnter", autoEnter);
        call.resolve();
    }

    @PluginMethod
    public void enterPip(PluginCall call) {
        Activity activity = getActivity();
        if (!supported(activity) || !navigationActive) {
            call.reject("PiP is unavailable or navigation is inactive");
            return;
        }
        boolean entered;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            entered = activity.enterPictureInPictureMode(buildParams());
        } else {
            entered = false;
        }
        if (entered) call.resolve(); else call.reject("Android did not enter PiP mode");
    }

    @PluginMethod
    public void updatePipParams(PluginCall call) {
        autoEnter = call.getBoolean("autoEnter", autoEnter);
        Activity activity = getActivity();
        if (supported(activity) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && activity.isInPictureInPictureMode()) {
            activity.setPictureInPictureParams(buildParams());
        }
        call.resolve();
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

    static void handleUserLeaveHint(Activity activity) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && navigationActive && autoEnter && supported(activity)) {
            activity.enterPictureInPictureMode(buildParams());
        }
    }

    static void dispatchModeChanged(boolean inPip) {
        if (instance == null) return;
        JSObject data = new JSObject();
        data.put("inPip", inPip);
        instance.notifyListeners("pipModeChanged", data);
    }
}
