package com.solaris.nav;

import org.json.*;
import java.util.*;

/** Language-tagged utterances shared by foreground and background guidance. */
final class SpeechPlan {
    static final class Part {
        final String text, language;
        final List<Range> ranges;
        Part(String text, String language) { this(text, language, Collections.emptyList()); }
        Part(String text, String language, List<Range> ranges) {
            this.text = text; this.language = language;
            this.ranges = Collections.unmodifiableList(new ArrayList<>(ranges));
        }
    }
    static final class Range {
        final int start, end;
        final String language;
        Range(int start, int end, String language) { this.start = start; this.end = end; this.language = language; }
    }
    static List<Part> parts(String text, String language, JSONArray segments) {
        List<Part> out = new ArrayList<>();
        if (segments != null && segments.length() <= 32) {
            for (int i = 0; i < segments.length(); i++) {
                JSONObject part = segments.optJSONObject(i);
                if (part == null) continue;
                String words = part.optString("text", "");
                String lang = part.optString("lang", language);
                if (!"en-US".equals(lang) && !"ko-KR".equals(lang)) lang = language;
                if (!words.trim().isEmpty()) out.add(new Part(words, lang));
            }
        }
        if (out.isEmpty() && text != null && !text.trim().isEmpty()) out.add(new Part(text, language));
        return out;
    }
    static JSONArray prepend(String prefix, String language, JSONObject turn) throws JSONException {
        JSONArray out = new JSONArray();
        out.put(new JSONObject().put("text", prefix).put("lang", language));
        for (Part part : parts(turn.optString("text"), language, turn.optJSONArray("segments"))) {
            out.put(new JSONObject().put("text", part.text).put("lang", part.language));
        }
        return out;
    }
    static List<Part> utterances(String text, String language, JSONArray segments, boolean unifiedVoice) {
        List<Part> plan = parts(text, language, segments);
        if (!unifiedVoice || plan.isEmpty()) return plan;
        StringBuilder joined = new StringBuilder();
        List<Range> ranges = new ArrayList<>();
        for (Part part : plan) {
            int start = joined.length(); joined.append(part.text);
            if (!part.language.equals(language)) ranges.add(new Range(start, joined.length(), part.language));
        }
        return Collections.singletonList(new Part(joined.toString(), language, ranges));
    }
}
