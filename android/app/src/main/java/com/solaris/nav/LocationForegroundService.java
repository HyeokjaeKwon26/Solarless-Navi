package com.solaris.nav;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps the navigation process visible while the activity is in PiP or the
 * user briefly leaves it. It deliberately uses platform LocationManager so
 * no Google location SDK or background-location permission is required.
 */
public final class LocationForegroundService extends Service implements LocationListener {
    public static final String ACTION_LOCATION_UPDATE = "com.solaris.nav.LOCATION_UPDATE";
    private static final String CHANNEL_ID = "navigation_location";
    private static final int NOTIFICATION_ID = 1206;
    private LocationManager locationManager;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        Notification notification = builder
            .setContentTitle("SolarLess Navi")
            .setContentText("Navigation location is active")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
        startForeground(NOTIFICATION_ID, notification);
        requestLocationUpdates();
        return START_NOT_STICKY;
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
        if (checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopSelf();
            return;
        }
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 3f, this);
            }
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 2000L, 10f, this);
            }
        } catch (SecurityException ignored) {
            stopSelf();
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        if (location == null) return;
        Intent event = new Intent(ACTION_LOCATION_UPDATE)
            .setPackage(getPackageName())
            .putExtra("lat", location.getLatitude())
            .putExtra("lng", location.getLongitude())
            .putExtra("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1f)
            .putExtra("timestamp", location.getTime())
            .putExtra("source", location.getProvider() == null ? "native" : location.getProvider());
        if (location.hasSpeed()) event.putExtra("speed", location.getSpeed());
        if (location.hasBearing()) event.putExtra("heading", location.getBearing());
        sendBroadcast(event);
    }

    @Override public void onProviderEnabled(String provider) { }
    @Override public void onProviderDisabled(String provider) { }

    @Override
    public void onDestroy() {
        if (locationManager != null) {
            try { locationManager.removeUpdates(this); } catch (SecurityException ignored) { }
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
