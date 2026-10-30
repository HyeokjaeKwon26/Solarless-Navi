package com.solaris.nav;

import java.util.ArrayDeque;
import org.json.*;

/** Bounded, session-only engine callback diagnostics; no spoken text or location. */
final class SpeechPlayback {
    private String group = "", last = "", source = "";
    private long requestedAt, startedAt = -1;
    private int requested, started, completed, errors, expired, cancelled, missingStart;
    private final ArrayDeque<JSONObject> events = new ArrayDeque<>();
    boolean owns(String id) { return !group.isEmpty() && id != null && id.startsWith(group); }
    boolean active() { return !group.isEmpty(); }
    void begin(String group, String last, long now, boolean background) {
        cancel("replaced", now); this.group=group; this.last=last; requestedAt=now; startedAt=-1;
        source=background?"background":"foreground"; requested++; add("requested",now);
    }
    long deadline() { return startedAt < 0 ? requestedAt+4000 : startedAt+60000; }
    boolean timeout(long now) {
        if (!active() || now < deadline()) return false;
        expired++; add(startedAt<0?"start-timeout":"completion-timeout",now); group=""; return true;
    }
    boolean start(String id, long now) {
        if (!owns(id) || timeout(now)) return false;
        if (startedAt<0) { startedAt=now; started++; add("started",now); }
        return true;
    }
    boolean done(String id, long now) {
        if (!owns(id) || !id.equals(last)) return false;
        if(startedAt<0) { missingStart++; add("missing-start-callback",now); }
        completed++; add("completed",now); group=""; return true;
    }
    boolean error(String id, long now) {
        if(!owns(id))return false; errors++; add("error",now);group="";return true;
    }
    void cancel(String reason,long now) {
        if(!active())return;cancelled++;add(reason,now);group="";
    }
    private void add(String event,long now) {
        try {
            JSONObject row=new JSONObject().put("event",event).put("source",source)
                .put("elapsedMs",Math.max(0,now-requestedAt));
            if(startedAt>=0)row.put("startDelayMs",Math.max(0,startedAt-requestedAt));
            events.addLast(row);while(events.size()>48)events.removeFirst();
        } catch(JSONException ignored) { }
    }
    JSONObject snapshot() {
        JSONObject out=new JSONObject();
        try { out.put("requested",requested).put("started",started).put("completed",completed)
            .put("errors",errors).put("expired",expired).put("cancelled",cancelled).put("missingStart",missingStart)
            .put("active",active()).put("events",new JSONArray(events)); } catch(JSONException ignored) { }
        return out;
    }
}
