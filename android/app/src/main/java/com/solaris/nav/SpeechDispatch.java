package com.solaris.nav;

import java.util.*;

/** Testable engine call ordering. Locale ranges never select a second speaker. */
final class SpeechDispatch {
    interface Engine {
        boolean language(String language);
        String currentVoice();
        boolean voice(String id);
        boolean speak(SpeechPlan.Part part, int index);
    }
    static final class Result {
        boolean accepted, languageFallback, voiceFallback, unavailable;
        final List<String> voices = new ArrayList<>();
    }
    static Result run(List<SpeechPlan.Part> parts, String language, SpeechPreferences config,
                      List<SpeechPreferences.Choice> available, Engine engine) {
        Result result = new Result();
        if (parts.isEmpty()) return result;
        String activeLanguage = "";
        for (SpeechPlan.Part part : parts) {
            String actual = part.language;
            if (!actual.equals(activeLanguage)) {
                if (!engine.language(actual)) {
                    result.languageFallback = true;
                    actual = language;
                    if (!engine.language(actual)) return result;
                }
                activeLanguage = actual;
            }
            String requested = config.forLanguage(actual);
            SpeechPreferences.Choice selected = SpeechPreferences.selected(requested, actual, available);
            if (selected == null) {
                result.voiceFallback |= !requested.isEmpty();
                selected = SpeechPreferences.defaultLocal(actual, engine.currentVoice(), available);
            }
            if (selected == null) { result.unavailable = true; return result; }
            result.voices.add(selected.id);
        }
        // Validate the entire plan before enqueueing any speech. In unified mode
        // setLanguage runs once, followed by setVoice only for an actual change.
        for (int i = 0; i < parts.size(); i++) {
            String selected = result.voices.get(i);
            if (!selected.equals(engine.currentVoice()) && !engine.voice(selected)) {
                result.unavailable = true; return result;
            }
            if (!engine.speak(parts.get(i), i)) return result;
        }
        result.accepted = true;
        return result;
    }
}
