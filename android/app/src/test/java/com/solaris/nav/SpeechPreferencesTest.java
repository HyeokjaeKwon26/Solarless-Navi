package com.solaris.nav;

import org.junit.Test;
import org.json.JSONObject;
import java.util.Arrays;
import static org.junit.Assert.*;

public class SpeechPreferencesTest {
    @Test public void defaultsAndBoundariesAreFinite() throws Exception {
        SpeechPreferences defaults = new SpeechPreferences(null);
        assertEquals(1f, defaults.rate, 0); assertEquals(1f, defaults.pitch, 0);
        assertTrue(defaults.unifiedVoice);
        SpeechPreferences limits = new SpeechPreferences(new JSONObject("{\"rate\":20,\"pitch\":-4}"));
        assertEquals(1.5f, limits.rate, 0); assertEquals(.75f, limits.pitch, 0);
        SpeechPreferences invalid = new SpeechPreferences(new JSONObject("{\"rate\":\"Infinity\",\"pitch\":\"NaN\"}"));
        assertEquals(1f, invalid.rate, 0); assertEquals(1f, invalid.pitch, 0);
    }
    @Test public void serializedSettingsPreserveBothVoicesAndCommonControls() throws Exception {
        SpeechPreferences original = new SpeechPreferences(new JSONObject("{\"koVoice\":\"android:engine:ko1\",\"enVoice\":\"android:engine:en2\",\"rate\":0.8,\"pitch\":1.2}"));
        SpeechPreferences restored = new SpeechPreferences(new JSONObject(original.json().toString()));
        assertEquals(original.koVoice, restored.forLanguage("ko-KR"));
        assertEquals(original.enVoice, restored.forLanguage("en-US"));
        assertEquals(original.enVoice, restored.forLanguage("en-GB"));
        assertEquals(original.rate, restored.rate, 0); assertEquals(original.pitch, restored.pitch, 0);
        assertTrue(restored.unifiedVoice);
        SpeechPreferences separate = new SpeechPreferences(new JSONObject("{\"unifiedVoice\":false}"));
        assertFalse(new SpeechPreferences(separate.json()).unifiedVoice);
        assertTrue(new SpeechPreferences(new JSONObject("{\"unifiedVoice\":\"false\"}")).unifiedVoice);
    }
    @Test public void selectionIsStableAcrossReorderingAndNeverCrossesLanguagesOrEngines() {
        SpeechPreferences.Choice ko = new SpeechPreferences.Choice("engineA:voice1", "ko-KR");
        SpeechPreferences.Choice en = new SpeechPreferences.Choice("engineA:voice2", "en-GB");
        assertSame(en, SpeechPreferences.selected(en.id, "en-US", Arrays.asList(ko,en)));
        assertSame(en, SpeechPreferences.selected(en.id, "en-US", Arrays.asList(en,ko)));
        assertNull(SpeechPreferences.selected(ko.id, "en-US", Arrays.asList(ko,en)));
        assertNull(SpeechPreferences.selected("engineB:voice2", "en-US", Arrays.asList(ko,en)));
        assertNull(SpeechPreferences.selected(en.id, "en-US", Arrays.asList(ko)));
        assertNull(SpeechPreferences.selected("", "ko-KR", Arrays.asList(ko,en)));
    }
}
