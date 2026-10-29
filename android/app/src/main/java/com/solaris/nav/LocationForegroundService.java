package com.solaris.nav;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;
import android.content.SharedPreferences;

/**
 * Keeps the navigation process visible while the activity is in PiP or the
 * user briefly leaves it. It deliberately uses platform LocationManager so
 * no Google location SDK or background-location permission is required.
 */
public final class LocationForegroundService extends Service implements LocationListener {
    public static final float HORIZONTAL_ACCURACY_CONFIDENCE_LEVEL = 0.68f;
    public static final String HORIZONTAL_ACCURACY_SOURCE = "android-location-horizontal-68";
    public static final String ACTION_LOCATION_UPDATE = "com.solaris.nav.LOCATION_UPDATE";
    public static final String ACTION_SERVICE_STATUS = "com.solaris.nav.LOCATION_SERVICE_STATUS";
    public static final String EXTRA_REASON = "reason";
    public static final String PREFS = "solarless_navigation_location";
    public static final long LAST_LOCATION_TTL_MS = 2 * 60 * 1000L;
    private static final String CHANNEL_ID = "navigation_location";
    private static final int NOTIFICATION_ID = 1206;
    private static Location latestLocation;
    private static final CheckpointGate checkpoint = new CheckpointGate();
    private LocationManager locationManager;
    private boolean providerRegistered;
    private boolean updatesRequested;
    private String notificationText = "Navigation location is active";

    @Override
    public void onCreate() {
        super.onCreate();
        instanceRunning = true;
        createNotificationChannel();
        NativeGuidance.get(this).setBackground(!MainActivity.foreground);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = buildNotification(notificationText);
        try {
            startForeground(NOTIFICATION_ID, notification);
        } catch (SecurityException error) {
            sendStatus("LOCATION_SERVICE_START_FAILED");
            stopSelf();
            return START_NOT_STICKY;
        } catch (RuntimeException error) {
            sendStatus("LOCATION_SERVICE_START_FAILED");
            stopSelf();
            return START_NOT_STICKY;
        }
        requestLocationUpdates();
        return START_STICKY;
    }

    private Notification buildNotification(String text) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("SolarLess Navi")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(PendingIntent.getActivity(
                this,
                0,
                new Intent(this, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP),
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            ))
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Navigation location",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Visible location service used while navigation is active");
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void requestLocationUpdates() {
        if (updatesRequested && providerRegistered) return;
        if (androidx.core.content.ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            androidx.core.content.ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            sendStatus("LOCATION_PERMISSION_MISSING");
            stopSelf();
            return;
        }
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            sendStatus("LOCATION_SERVICE_START_FAILED");
            stopSelf();
            return;
        }
        providerRegistered = false;
        // Navigation needs sub-second GPS samples at motorway speed. At
        // 120 km/h a 1 s cadence moves about 33 m between fixes, which made
        // the WebView marker visibly lag and jump. The foreground service is
        // active only during guidance, so request 4 Hz/1 m from GPS while
        // keeping the lower-power network fallback at its former cadence.
        registerProvider(LocationManager.GPS_PROVIDER, 250L, 1f);
        registerProvider(LocationManager.NETWORK_PROVIDER, 2000L, 10f);
        if (!providerRegistered) {
            sendStatus("LOCATION_SERVICE_NO_PROVIDER");
            stopSelf();
        } else {
            updatesRequested = true;
        }
    }

    private void registerProvider(String provider, long intervalMs, float minDistanceM) {
        if (locationManager == null) return;
        try {
            if (!locationManager.isProviderEnabled(provider)) {
                sendStatus("LOCATION_PROVIDER_UNAVAILABLE");
                return;
            }
            locationManager.requestLocationUpdates(provider, intervalMs, minDistanceM, this);
            providerRegistered = true;
        } catch (SecurityException error) {
            sendStatus("LOCATION_PERMISSION_MISSING");
        } catch (IllegalArgumentException error) {
            sendStatus("LOCATION_PROVIDER_REGISTER_FAILED");
        } catch (RuntimeException error) {
            sendStatus("LOCATION_PROVIDER_REGISTER_FAILED");
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;
        NativeGuidance.get(this).onLocation(location);
        String status = NativeGuidance.get(this).notificationText();
        if (!status.equals(notificationText)) {
            notificationText = status;
            try { startForeground(NOTIFICATION_ID, buildNotification(status)); } catch (RuntimeException ignored) {}
        }
        try {
            DriveJournal.get(this).append("native-location", new org.json.JSONObject()
                .put("lat", location.getLatitude()).put("lng", location.getLongitude()).put("timestamp", location.getTime())
                .put("heading", location.hasBearing() ? location.getBearing() : -1)
                .put("accuracy68", location.hasAccuracy() ? location.getAccuracy() : -1)
                .put("speedMps", location.hasSpeed() ? location.getSpeed() : -1));
        } catch (org.json.JSONException ignored) { }
        long timestamp = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        synchronized (LocationForegroundService.class) {
            if (latestLocation != null && timestamp < latestLocation.getTime()) return;
            latestLocation = new Location(location);
            latestLocation.setTime(timestamp);
            if (checkpoint.due(android.os.SystemClock.elapsedRealtime())) flushLastLocation(this);
        }
        Intent event = new Intent(ACTION_LOCATION_UPDATE)
            .setPackage(getPackageName())
            .putExtra("lat", location.getLatitude())
            .putExtra("lng", location.getLongitude())
            .putExtra("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1f)
            .putExtra("accuracyConfidenceLevel", HORIZONTAL_ACCURACY_CONFIDENCE_LEVEL)
            .putExtra("accuracySource", HORIZONTAL_ACCURACY_SOURCE)
            .putExtra("timestamp", timestamp)
            .putExtra("source", location.getProvider() == null ? "native" : location.getProvider());
        if (location.hasSpeed()) event.putExtra("speed", location.getSpeed());
        if (location.hasBearing()) event.putExtra("heading", location.getBearing());
        sendBroadcast(event);
    }

    private void sendStatus(String reason) {
        Intent event = new Intent(ACTION_SERVICE_STATUS)
            .setPackage(getPackageName())
            .putExtra(EXTRA_REASON, reason);
        sendBroadcast(event);
    }

    public static synchronized Location getLatestLocation() {
        return latestLocation == null ? null : new Location(latestLocation);
    }

    public static synchronized void flushLastLocation(Context context) {
        if (context == null || latestLocation == null) return;
        Location location = latestLocation;
        SharedPreferences.Editor editor = context.getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putLong("timestamp", location.getTime())
            .putString("provider", location.getProvider() == null ? "native" : location.getProvider())
            .putString("lat", Double.toString(location.getLatitude()))
            .putString("lng", Double.toString(location.getLongitude()))
            .putFloat("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1f)
            .remove("speed").remove("bearing");
        if (location.hasSpeed()) editor.putFloat("speed", location.getSpeed());
        if (location.hasBearing()) editor.putFloat("bearing", location.getBearing());
        editor.apply();
        checkpoint.saved(android.os.SystemClock.elapsedRealtime());
    }

    public static synchronized void clearLastLocation(Context context) {
        latestLocation = null;
        checkpoint.reset();
        if (context == null) return;
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().clear().apply();
    }

    public static boolean isRunning() {
        return instanceRunning;
    }

    private static volatile boolean instanceRunning;

    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }

    @Override
    public void onDestroy() {
        flushLastLocation(this);
        DriveJournal.get(this).flush();
        if (locationManager != null) {
            try { locationManager.removeUpdates(this); } catch (SecurityException ignored) { }
        }
        updatesRequested = false;
        providerRegistered = false;
        instanceRunning = false;
        sendStatus("LOCATION_SERVICE_STOPPED");
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
