package com.solaris.nav;

import android.content.Context;
import android.location.Location;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/** Route snapshot survives WebView suspension; bounded recovery uses existing fixes. */
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
    private double[][] coordinates;
    private JSONObject snapshot;
    private final BackgroundRecovery recovery = new BackgroundRecovery();
    private final java.util.concurrent.ExecutorService routing = Executors.newSingleThreadExecutor();
    private Location latest;
    private long lastRecoveryCheck, arrivalSince;
    private boolean arrived;
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
            if (age >= 0 && age < 12 * 3600000L) { load(snapshot); revision=snapshot.optLong("revision"); }
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
        NavigationProgress candidateProgress = new NavigationProgress(points);
        JSONObject nearby = snapshot.optJSONObject("nearbyRoads");
        if (nearby != null) {
            JSONArray edges = nearby.optJSONArray("edges");
            if (edges != null && edges.length() <= 12000) {
                double[][] values = new double[edges.length()][6];
                for (int i=0;i<values.length;i++) {
                    for(int j=0;j<6;j++) {
                        values[i][j]=edges.getJSONArray(i).getDouble(j);
                        if(!NavigationProgress.finite(values[i][j])) throw new JSONException("Invalid nearby road");
                    }
                    if(Math.abs(values[i][0])>180||Math.abs(values[i][2])>180||Math.abs(values[i][1])>85||Math.abs(values[i][3])>85) throw new JSONException("Invalid nearby coordinates");
                }
                JSONArray links=nearby.optJSONArray("successors");
                int[][] successors=null;
                if(links!=null) {
                    if(links.length()!=values.length) throw new JSONException("Invalid road connections");
                    successors=new int[values.length][];
                    int total=0;
                    for(int i=0;i<values.length;i++) {
                        JSONArray row=links.getJSONArray(i); total+=row.length();
                        if(total>120000) throw new JSONException("Too many road connections");
                        successors[i]=new int[row.length()];
                        for(int j=0;j<row.length();j++) {
                            int id=row.getInt(j);
                            if(id<0||id>=values.length) throw new JSONException("Invalid road connection");
                            successors[i][j]=id;
                        }
                    }
                }
                candidateProgress.setNearbyRoads(values, nearby.optLong("expiresAt"), successors);
            }
        }
        progress=candidateProgress; this.coordinates=points; this.snapshot=snapshot; recovery.reset(); arrived=false; arrivalSince=0;
        turns = candidateTurns; phases = new int[turns.length()];
        lastLocationAt = 0; uncertain = false;
        language = snapshot.optString("language", "en-US");
        unitSystem = "imperial".equals(snapshot.optString("unitSystem")) ? "imperial" : "metric";
    }
    synchronized void configure(JSONObject snapshot) throws JSONException {
        long incoming = snapshot.optLong("revision");
        if (incoming <= revision) return;
        load(snapshot); revision = incoming;
        if(background)NavigationSpeech.get(context).stop();
        final byte[] bytes = snapshot.put("savedAt", System.currentTimeMillis()).toString().getBytes(StandardCharsets.UTF_8);
        io.execute(() -> {
            AtomicFile file = new AtomicFile(new File(context.getFilesDir(), "navigation-snapshot.json"));
            FileOutputStream out = null;
            try { out = file.startWrite(); out.write(bytes); file.finishWrite(out); }
            catch (IOException e) { if (out != null) file.failWrite(out); }
        });
    }
    synchronized void setBackground(boolean value) { if (background && !value) { NavigationSpeech.get(context).stop(); recovery.reset(); } background = value; }
    synchronized JSONObject recoveryState() throws JSONException {
        JSONObject result=new JSONObject().put("revision",revision).put("arrived",arrived);
        if(snapshot!=null&&snapshot.has("rawRoute"))result.put("route",snapshot.getJSONObject("rawRoute")).put("destination",snapshot.optJSONArray("destination"))
            .put("recoveredAt",snapshot.optLong("recoveredAt")).put("solarAnalysisPending",true);
        return result;
    }
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
        snapshot=null; coordinates=null; latest=null; arrived=false; recovery.reset();
        NavigationSpeech.get(context).stop();
        io.execute(() -> new AtomicFile(new File(context.getFilesDir(), "navigation-snapshot.json")).delete());
    }
    static synchronized void repeatAfterInterruption() {
        if (instance != null) { java.util.Arrays.fill(instance.phases, 0); instance.lastVoice = 0; }
    }
    synchronized String notificationText() {
        if (!background || progress == null) return "Navigation location is active";
        if(arrived)return language.startsWith("ko")?"목적지 부근 도착 · 앱에서 종료 확인":"Near destination · open app to finish";
        if(uncertain)return language.startsWith("ko")?"위치 확인 중 · 정확한 위치에서 경로 복구":"Checking position · recovery requires a reliable fix";
        return snapshot!=null&&snapshot.has("rawRoute")?(language.startsWith("ko")?"복구 경로 안내 · 햇빛 분석 대기":"Recovery guidance · sunlight analysis pending"):(language.startsWith("ko")?"화면 꺼짐 주행 안내":"Background turn guidance");
    }
    synchronized void onLocation(Location location) {
        if (!background || progress == null) return;
        if (location.getTime() <= lastLocationAt) return;
        lastLocationAt = location.getTime();
        long now = System.currentTimeMillis();
        latest=new Location(location);
        double speed = location.hasSpeed() ? Math.max(0, location.getSpeed()) : 0;
        if(arrived) {
            double[] end=coordinates[coordinates.length-1];
            if(!location.hasAccuracy()||location.getAccuracy()*1.62>25||now-location.getTime()>10000)return;
            if(NavigationProgress.distance(location.getLongitude(),location.getLatitude(),end[0],end[1])<=60)return;
            arrived=false;arrivalSince=0; // Passing the arrival area must not permanently suppress guidance.
        }
        double at = progress.match(location.getLongitude(), location.getLatitude(), location.hasAccuracy() ? location.getAccuracy() * 1.62 : Double.NaN,
            location.hasBearing() ? location.getBearing() : Double.NaN, speed, location.getTime(), now);
        if (!NavigationProgress.finite(at)) {
            if (!uncertain) {
                NavigationSpeech.get(context).stop();
                java.util.Arrays.fill(phases, 0);
            }
            uncertain = true; arrivalSince=0;
            if(now-lastRecoveryCheck>=1000) {
                lastRecoveryCheck=now;
                double distance=BackgroundRecovery.distanceToPath(location.getLongitude(),location.getLatitude(),coordinates);
                if(recovery.observe(distance,location.hasAccuracy()?location.getAccuracy()*1.62:Double.NaN,speed,location.getTime(),now)) requestRecovery(location,now);
            }
            return;
        }
        recovery.reset();
        uncertain = false;
        JSONObject endTurn=turns.optJSONObject(turns.length()-1);
        double[] end=coordinates[coordinates.length-1];
        boolean nearEnd=endTurn!=null&&"arrive".equals(endTurn.optString("type"))&&endTurn.optDouble("progressMeters",Double.MAX_VALUE)-at<30&&
            NavigationProgress.distance(location.getLongitude(),location.getLatitude(),end[0],end[1])<25&&speed<2;
        if(nearEnd) { if(arrivalSince==0)arrivalSince=now; if(now-arrivalSince>=10000) {
            arrived=true;NavigationSpeech.get(context).stop();
            if(!muted)NavigationSpeech.get(context).speak(language.startsWith("ko")?"목적지 부근입니다. 안전한 곳에서 도착 위치를 확인하세요.":"Near your destination. Check the arrival point when safe.",language,true);
            return;
        } } else arrivalSince=0;
        if(muted)return;
        for (int i = 0; i < turns.length(); i++) {
            JSONObject turn = turns.optJSONObject(i);
            if (turn == null || "arrive".equals(turn.optString("type"))) continue;
            double distance = turn.optDouble("progressMeters", -1000) - at;
            if (distance < -8) continue;
            String speechKey=revision+":"+i;
            NavigationSpeech.get(context).updateTurn(speechKey,true);
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
            if (NavigationSpeech.get(context).speakTurn(text, language, true, segments, speechKey)) {
                phases[i] = phase; lastVoice = now;
                try { DriveJournal.get(context).append("voice", new JSONObject().put("text", text).put("source", "native-background").put("timestamp", now)); } catch (JSONException ignored) { }
            }
            return;
        }
        NavigationSpeech.get(context).updateTurn("",true);
    }
    private void requestRecovery(Location origin,long now) {
        JSONArray target=snapshot==null?null:snapshot.optJSONArray("destination");
        if(target==null||target.length()!=2)return;
        final double[] start={origin.getLongitude(),origin.getLatitude()},end={target.optDouble(0),target.optDouble(1)};
        if(!NavigationProgress.finite(end[0])||!NavigationProgress.finite(end[1])||Math.abs(end[0])>180||Math.abs(end[1])>85)return;
        final long token=recovery.begin(now),routeRevision=revision;
        final String lang=language,units=unitSystem;
        final boolean toll=snapshot.optBoolean("avoidTolls");
        final double bearing=origin.hasBearing()?origin.getBearing():Double.NaN;
        routing.execute(()->{
            JSONObject replacement=null;
            try {replacement=RecoveryRoute.parse(RecoveryHttp.fetch(start,end,bearing,toll),start,end,lang); } catch(Exception ignored) { }
            final JSONObject result=replacement;
            new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{
                synchronized(NativeGuidance.this) {
                    long current=System.currentTimeMillis();
                    if(!background||revision!=routeRevision||!recovery.current(token))return;
                    boolean fresh=latest!=null&&recovery.accepts(token,background,routeRevision,revision,now,latest.getTime(),current,
                        NavigationProgress.distance(start[0],start[1],latest.getLongitude(),latest.getLatitude()));
                    recovery.finish(token,current,result!=null&&fresh);
                    if(result==null||!fresh)return;
                    try {
                        result.put("destination",new JSONArray(end)).put("avoidTolls",toll).put("language",lang).put("unitSystem",units)
                            .put("revision",Math.max(revision+1,current*1000)).put("recoveredAt",current);
                        NavigationSpeech.get(context).stop(); configure(result);
                        DriveJournal.get(context).append("native-recovery",new JSONObject().put("timestamp",current).put("solarAnalysisPending",true));
                        DriveJournal.get(context).append("route",new JSONObject().put("coordinates",result.getJSONArray("coordinates")).put("maneuvers",result.getJSONArray("maneuvers")).put("distanceMeters",result.getDouble("geometryMeters")).put("nativeRecovery",true));
                    }catch(JSONException ignored) { }
                }
            });
        });
    }
}
