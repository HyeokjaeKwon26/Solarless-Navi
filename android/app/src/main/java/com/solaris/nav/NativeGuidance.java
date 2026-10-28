package com.solaris.nav;

import android.content.Context;
import android.location.Location;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/** Route snapshot survives WebView suspension. No network or speculative dead reckoning. */
final class NativeGuidance {
    private static NativeGuidance instance;
    private final Context context;
    private NavigationProgress progress;
    private JSONArray turns = new JSONArray();
    private int[] phases = new int[0];
    private String language = "en-US";
    private String unitSystem = "metric";
    private boolean muted, background, uncertain;
    private long lastVoice, revision, lastLocationAt;
    private final java.util.concurrent.ExecutorService io = Executors.newSingleThreadExecutor();
    static synchronized NativeGuidance get(Context context) {
        if (instance == null) instance = new NativeGuidance(context.getApplicationContext());
        return instance;
    }
    private NativeGuidance(Context context) {
        this.context = context;
        muted = context.getSharedPreferences("guidance", 0).getBoolean("muted", false);
        NavigationSpeech.get(context);
        try {
            AtomicFile file = new AtomicFile(new File(context.getFilesDir(), "navigation-snapshot.json"));
            JSONObject snapshot = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
            long age = System.currentTimeMillis() - snapshot.optLong("savedAt");
            if (age >= 0 && age < 12 * 3600000L) load(snapshot);
        } catch (Exception ignored) { }
    }
    private synchronized void load(JSONObject snapshot) throws JSONException {
        JSONArray coordinates = snapshot.getJSONArray("coordinates");
        if (coordinates.length() < 2 || coordinates.length() > 100000) throw new JSONException("Route size invalid");
        double[][] points = new double[coordinates.length()][2];
        for (int i = 0; i < points.length; i++) {
            points[i][0] = coordinates.getJSONArray(i).getDouble(0); points[i][1] = coordinates.getJSONArray(i).getDouble(1);
            if (!NavigationProgress.finite(points[i][0]) || !NavigationProgress.finite(points[i][1]) || Math.abs(points[i][0]) > 180 || Math.abs(points[i][1]) > 90) throw new JSONException("Coordinates invalid");
        }
        JSONArray candidateTurns = snapshot.getJSONArray("turns");
        if (candidateTurns.length() > 10000) throw new JSONException("Too many turns");
        for (int i = 0; i < candidateTurns.length(); i++) {
            JSONObject turn = candidateTurns.getJSONObject(i);
            double meters = turn.optDouble("progressMeters", Double.NaN);
            if (!NavigationProgress.finite(meters) || meters < 0) throw new JSONException("Invalid turn position");
        }
        progress = new NavigationProgress(points);
        turns = candidateTurns; phases = new int[turns.length()];
        lastLocationAt = 0; uncertain = false;
        language = snapshot.optString("language", "en-US");
        unitSystem = "imperial".equals(snapshot.optString("unitSystem")) ? "imperial" : "metric";
    }
    synchronized void configure(JSONObject snapshot) throws JSONException {
        long incoming = snapshot.optLong("revision");
        if (incoming <= revision) return;
        load(snapshot); revision = incoming;
        final byte[] bytes = snapshot.put("savedAt", System.currentTimeMillis()).toString().getBytes(StandardCharsets.UTF_8);
        io.execute(() -> {
            AtomicFile file = new AtomicFile(new File(context.getFilesDir(), "navigation-snapshot.json"));
            FileOutputStream out = null;
            try { out = file.startWrite(); out.write(bytes); file.finishWrite(out); }
            catch (IOException e) { if (out != null) file.failWrite(out); }
        });
    }
    synchronized void setBackground(boolean value) { if (background && !value) NavigationSpeech.get(context).stop(); background = value; }
    synchronized void setMuted(boolean value) { muted = value; context.getSharedPreferences("guidance", 0).edit().putBoolean("muted", value).apply(); if (value) NavigationSpeech.get(context).stop(); }
    synchronized void clear(long incoming) {
        if (incoming <= revision) return;
        revision = incoming; clearState();
    }
    synchronized void clear() {
        revision = Math.max(revision + 1, System.currentTimeMillis() * 1000);
        clearState();
    }
    private void clearState() {
        progress = null; turns = new JSONArray(); phases = new int[0];
        NavigationSpeech.get(context).stop();
        io.execute(() -> new AtomicFile(new File(context.getFilesDir(), "navigation-snapshot.json")).delete());
    }
    static synchronized void repeatAfterInterruption() {
        if (instance != null) { java.util.Arrays.fill(instance.phases, 0); instance.lastVoice = 0; }
    }
    synchronized String notificationText() {
        if (!background || progress == null) return "Navigation location is active";
        return uncertain ? "Position or route uncertain. Open app to check or reroute." : "Background turn guidance. Open app for rerouting.";
    }
    synchronized void onLocation(Location location) {
        if (!background || muted || progress == null) return;
        if (location.getTime() <= lastLocationAt) return;
        lastLocationAt = location.getTime();
        long now = System.currentTimeMillis();
        double speed = location.hasSpeed() ? Math.max(0, location.getSpeed()) : 0;
        double at = progress.match(location.getLongitude(), location.getLatitude(), location.hasAccuracy() ? location.getAccuracy() * 1.62 : Double.NaN,
            location.hasBearing() ? location.getBearing() : Double.NaN, speed, location.getTime(), now);
        if (!NavigationProgress.finite(at)) {
            if (!uncertain) {
                NavigationSpeech.get(context).stop();
                java.util.Arrays.fill(phases, 0);
            }
            uncertain = true; return;
        }
        uncertain = false;
        for (int i = 0; i < turns.length(); i++) {
            JSONObject turn = turns.optJSONObject(i);
            if (turn == null || "arrive".equals(turn.optString("type"))) continue;
            double distance = turn.optDouble("progressMeters", -1000) - at;
            if (distance < -8) continue;
            int phase = NavigationProgress.phase(distance, speed, turn.optBoolean("complex", false));
            if (phase <= phases[i] || (phase != 3 && now - lastVoice < 2500)) return;
            boolean ko = language.startsWith("ko");
            String prefix = phase == 1 ? GuidanceUnits.spokenDistance(distance, unitSystem, language) + (ko ? " 앞에서 " : " ahead, ") : (phase == 3 ? (ko ? "곧 " : "Now, ") : (ko ? "잠시 후 " : "Shortly, "));
            JSONObject spokenTurn = phase == 3 && turn.optJSONObject("execute") != null ? turn.optJSONObject("execute") : turn;
            String text = prefix + spokenTurn.optString("text");
            JSONArray segments = null;
            try {
                segments = SpeechPlan.prepend(prefix, language, spokenTurn);
                JSONObject next = turn.optJSONObject("following");
                if (phase >= 2 && next != null && next.optDouble("distanceAfter", 181) <= 180 && next.optDouble("distanceAfter", -1) >= 0) {
                    String distanceText = GuidanceUnits.spokenDistance(next.optDouble("distanceAfter"), unitSystem, language);
                    String followingPrefix = ko ? " 이어서 " + distanceText + " 후 " : " Then in " + distanceText + ", ";
                    text += followingPrefix + next.optString("text");
                    JSONArray followingParts = SpeechPlan.prepend(followingPrefix, language, next);
                    for (int part = 0; part < followingParts.length(); part++) segments.put(followingParts.get(part));
                }
            } catch (JSONException ignored) { }
            if (NavigationSpeech.get(context).speak(text, language, true, segments)) {
                phases[i] = phase; lastVoice = now;
                try { DriveJournal.get(context).append("voice", new JSONObject().put("text", text).put("source", "native-background").put("timestamp", now)); } catch (JSONException ignored) { }
            }
            return;
        }
    }
}
