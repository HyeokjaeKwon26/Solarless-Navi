package com.solaris.nav;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Opt-in private journal; at most four 2 MiB files. Never uploads. */
final class DriveJournal {
    private static final long CHUNK_BYTES = 2 * 1024 * 1024;
    private static DriveJournal instance;
    private final Context context;
    private final File directory;
    private final ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor();
    private final BufferedJournal buffer;
    private ScheduledFuture<?> flushTask;
    private final java.util.concurrent.atomic.AtomicInteger pending = new java.util.concurrent.atomic.AtomicInteger();
    private volatile long dropped;
    private volatile boolean active;
    static synchronized DriveJournal get(Context context) {
        if (instance == null) instance = new DriveJournal(context.getApplicationContext());
        return instance;
    }
    private DriveJournal(Context context) {
        this.context = context;
        directory = new File(context.getFilesDir(), "drive-journal");
        buffer = new BufferedJournal(directory, (int) CHUNK_BYTES, 64 * 1024);
        active = context.getSharedPreferences("drive-journal", 0).getBoolean("active", false);
    }
    boolean isActive() { return active; }
    synchronized void setActive(boolean value) {
        active = value;
        context.getSharedPreferences("drive-journal", 0).edit().putBoolean("active", value).apply();
        if (value) append("recording-start", new JSONObject());
        else flush();
    }
    synchronized void append(String type, JSONObject data) {
        if (!active) return;
        if (pending.incrementAndGet() > 64) { pending.decrementAndGet(); dropped++; return; }
        final String line;
        try {
            line = new JSONObject().put("type", type).put("recordedAt", System.currentTimeMillis()).put("data", data).toString() + "\n";
        } catch (Exception e) { pending.decrementAndGet(); return; }
        if (line.length() > 300000) { pending.decrementAndGet(); dropped++; return; }
        io.execute(() -> {
            try {
                buffer.append(line);
                if (!"sample".equals(type) && !"native-location".equals(type)) flushBuffer();
                else if (flushTask == null) flushTask = io.schedule(this::flushBuffer, 1, TimeUnit.SECONDS);
            } catch (IOException e) { /* Failed records are counted by the buffer. */ }
            finally { pending.decrementAndGet(); }
        });
    }
    private void flushBuffer() {
        if (flushTask != null) flushTask.cancel(false);
        flushTask = null;
        try { buffer.flush(); } catch (IOException ignored) { /* Counted by the buffer. */ }
    }
    void flush() { io.execute(this::flushBuffer); }
    interface Callback { void accept(String value); }
    void export(Callback callback) {
        io.execute(() -> {
            flushBuffer();
            JSONArray samples = new JSONArray(), events = new JSONArray();
            try {
                for (int i = 3; i >= 0; i--) {
                    File file = new File(directory, i + ".jsonl");
                    if (!file.exists()) continue;
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) {
                            try {
                                JSONObject event = new JSONObject(line);
                                if ("sample".equals(event.optString("type"))) samples.put(event.getJSONObject("data"));
                                else events.put(event);
                            } catch (Exception ignored) { /* A truncated final line cannot discard the recording. */ }
                        }
                    }
                }
                callback.accept(new JSONObject().put("version", 2).put("type", "solarless-drive-quality")
                    .put("retention", "last-four-2MiB-chunks").put("dropped", dropped + buffer.failedRecords).put("samples", samples).put("events", events).toString());
            } catch (Exception error) { callback.accept(null); }
        });
    }
    interface ClearCallback { void accept(boolean success); }
    synchronized void clear(ClearCallback done) {
        setActive(false);
        io.execute(() -> {
            if (flushTask != null) flushTask.cancel(false);
            flushTask = null; buffer.discard();
            boolean success = true;
            synchronized (this) {
                for (int i = 0; i < 4; i++) { File f = new File(directory, i + ".jsonl"); if (f.exists() && !f.delete()) success = false; }
                if (success) { dropped = 0; buffer.failedRecords = 0; }
            }
            done.accept(success);
        });
    }
}
