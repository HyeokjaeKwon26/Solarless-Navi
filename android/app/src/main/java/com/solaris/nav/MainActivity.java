package com.solaris.nav;

import android.app.PictureInPictureParams;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static volatile boolean foreground;
    @Override public void onResume() {
        super.onResume(); foreground = true;
        NativeGuidance.get(this).setBackground(false);
    }
    @Override public void onPause() {
        foreground = false; NativeGuidance.get(this).setBackground(true);
        LocationForegroundService.flushLastLocation(this);
        DriveJournal.get(this).flush();
        super.onPause();
    }
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PipPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(VoiceInputPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        PipPlugin.handleUserLeaveHint(this);
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        }
        PipPlugin.dispatchModeChanged(isInPictureInPictureMode);
    }
}
