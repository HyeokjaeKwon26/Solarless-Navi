package com.solaris.nav;

import java.util.List;
import org.json.JSONObject;
import org.json.JSONException;

/** Engine-qualified voice IDs are stable across catalogue reordering. */
final class SpeechPreferences {
    final String koVoice, enVoice;
    final float rate, pitch;
    final boolean unifiedVoice;
    SpeechPreferences(JSONObject value) {
        JSONObject data = value == null ? new JSONObject() : value;
        koVoice = id(data.optString("koVoice", ""));
        enVoice = id(data.optString("enVoice", ""));
        rate = bounded(data.optDouble("rate", 1), .5f, 1.5f);
        pitch = bounded(data.optDouble("pitch", 1), .75f, 1.5f);
        unifiedVoice = !Boolean.FALSE.equals(data.opt("unifiedVoice"));
    }
    private static String id(String value) { return value.length() <= 1024 ? value : ""; }
    private static float bounded(double value, float min, float max) {
        return Double.isNaN(value) || Double.isInfinite(value) ? 1f : (float)Math.max(min, Math.min(max, value));
    }
    String forLanguage(String language) { return language.startsWith("ko") ? koVoice : language.startsWith("en") ? enVoice : ""; }
    static boolean matches(String language, String locale) {
        return (language.startsWith("ko") && locale.startsWith("ko")) || (language.startsWith("en") && locale.startsWith("en"));
    }
    static final class Choice {
        final String id, language;
        final boolean network;
        Choice(String id, String language) { this(id, language, false); }
        Choice(String id, String language, boolean network) { this.id = id; this.language = language; this.network = network; }
    }
    static Choice selected(String id, String language, List<Choice> choices) {
        if (id.isEmpty()) return null;
        for (Choice choice : choices) if (!choice.network && choice.id.equals(id) && matches(language, choice.language)) return choice;
        return null;
    }
    static Choice defaultLocal(String language, String defaultId, List<Choice> choices) {
        Choice preferred = selected(defaultId,language,choices);
        if (preferred != null) return preferred;
        for (Choice choice : choices) if (!choice.network && choice.language.equalsIgnoreCase(language)) return choice;
        for (Choice choice : choices) if (!choice.network && matches(language,choice.language)) return choice;
        return null;
    }
    static String localId(String id, String language, List<Choice> choices) {
        if (selected(id, language, choices) != null) return id;
        boolean network = id.endsWith("-network");
        for (Choice choice : choices) if (choice.id.equals(id)) network |= choice.network;
        if (!network) return id; // Retain missing installed voices for later restoration.
        String local = id.endsWith("-network") ? id.substring(0, id.length()-8)+"-local" : "";
        return selected(local, language, choices) != null ? local : "";
    }
    SpeechPreferences offline(List<Choice> choices) {
        JSONObject value = json();
        try { value.put("koVoice", localId(koVoice,"ko-KR",choices)); value.put("enVoice",localId(enVoice,"en-US",choices)); }
        catch (JSONException ignored) { }
        return new SpeechPreferences(value);
    }
    SpeechPreferences comparison(boolean useDefault) {
        JSONObject value = json();
        try {
            value.put("unifiedVoice", true);
            if (useDefault) value.put("koVoice", "").put("enVoice", "");
        } catch (JSONException ignored) { }
        return new SpeechPreferences(value);
    }
    JSONObject json() {
        JSONObject value = new JSONObject();
        try { value.put("koVoice", koVoice).put("enVoice", enVoice).put("rate", (double)rate).put("pitch", (double)pitch).put("unifiedVoice", unifiedVoice); }
        catch (JSONException ignored) { }
        return value;
    }
}
