package com.solaris.nav;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.*;
import android.os.*;
import android.speech.tts.*;
import java.util.Locale;
import java.util.List;
import java.util.ArrayList;
import java.util.Collections;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import com.getcapacitor.JSObject;

/** Single TTS owner for foreground and background. Never forces Bluetooth routing. */
final class NavigationSpeech implements AudioManager.OnAudioFocusChangeListener {
    private static NavigationSpeech instance;
    private final AudioManager audio;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private AudioFocusRequest focus;
    private TextToSpeech tts;
    private final SharedPreferences preferences;
    private String engine = "";
    private boolean ready, backgroundOwner;
    private long deniedUntil;
    private String currentId = "";
    private long sequence;
    private String currentGroup = "";
    private boolean languageFallback;
    private boolean voiceFallback;
    boolean usedLanguageFallback() { return languageFallback; }
    boolean usedVoiceFallback() { return voiceFallback; }
    static synchronized NavigationSpeech get(Context context) {
        if (instance == null) instance = new NavigationSpeech(context.getApplicationContext());
        return instance;
    }
    private NavigationSpeech(Context context) {
        preferences = context.getSharedPreferences("solarless_speech", Context.MODE_PRIVATE);
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(context, status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready) { engine = tts.getDefaultEngine(); tts.setAudioAttributes(attributes); }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) { main.post(() -> { if (id.equals(currentId)) release(); }); }
            @Override public void onError(String id) { main.post(() -> { if (!currentGroup.isEmpty() && id.startsWith(currentGroup)) stop(); }); }
        });
    }
    private SpeechPreferences settings() {
        try { return new SpeechPreferences(new JSONObject(preferences.getString("settings", "{}"))); }
        catch (JSONException error) { return new SpeechPreferences(null); }
    }
    private String voiceId(Voice voice) { return "android:" + engine + ":" + voice.getName(); }
    private List<Voice> voices() {
        List<Voice> list = new ArrayList<>();
        if (!ready || tts.getVoices() == null) return list;
        for (Voice voice : tts.getVoices()) {
            String language = voice.getLocale().getLanguage();
            if ((language.equals("ko") || language.equals("en")) &&
                (voice.getFeatures() == null || !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))) list.add(voice);
        }
        Collections.sort(list, (a,b) -> {
            int network = Boolean.compare(a.isNetworkConnectionRequired(), b.isNetworkConnectionRequired());
            return network != 0 ? network : a.getName().compareTo(b.getName());
        });
        return list;
    }
    private Voice chosen(String id, String language, List<Voice> list) {
        List<SpeechPreferences.Choice> choices = new ArrayList<>();
        for (Voice voice : list) choices.add(new SpeechPreferences.Choice(voiceId(voice), voice.getLocale().toLanguageTag()));
        SpeechPreferences.Choice selected = SpeechPreferences.selected(id, language, choices);
        if (selected != null) for (Voice voice : list) if (voiceId(voice).equals(selected.id)) return voice;
        return null;
    }
    JSObject speechSettings() {
        SpeechPreferences value = settings();
        List<Voice> list = voices();
        JSONArray available = new JSONArray();
        for (Voice voice : list) {
            JSObject item = new JSObject(); item.put("id", voiceId(voice)); item.put("name", voice.getName());
            item.put("lang", voice.getLocale().toLanguageTag()); item.put("networkRequired", voice.isNetworkConnectionRequired());
            item.put("quality", voice.getQuality()); item.put("latency", voice.getLatency()); available.put(item);
        }
        JSObject result = new JSObject(); result.put("ready", ready); result.put("engine", engine);
        result.put("settings", value.json()); result.put("voices", available); return result;
    }
    JSObject saveSpeechSettings(JSONObject input) {
        if (!ready) throw new IllegalStateException("TTS_NOT_READY");
        SpeechPreferences next = new SpeechPreferences(input), previous = settings();
        List<Voice> list = voices();
        for (String language : new String[]{"ko-KR", "en-US"}) {
            String id = next.forLanguage(language);
            if (!id.isEmpty() && !id.equals(previous.forLanguage(language)) && chosen(id, language, list) == null)
                throw new IllegalArgumentException("VOICE_UNAVAILABLE");
        }
        if (!preferences.edit().putString("settings", next.json().toString()).commit()) {
            preferences.edit().putString("settings", previous.json().toString()).apply();
            throw new IllegalStateException("VOICE_SAVE_FAILED");
        }
        // Stop queued parts from the previous selection before the next fix
        // repeats guidance using the newly persisted settings, also in PiP.
        stop();
        NativeGuidance.repeatAfterInterruption();
        return speechSettings();
    }
    boolean speak(String text, String language) { return speak(text, language, false); }
    boolean speak(String text, String language, boolean fromBackground) {
        return speak(text, language, fromBackground, null);
    }
    boolean speak(String text, String language, boolean fromBackground, JSONArray segments) {
        languageFallback = false;
        voiceFallback = false;
        if (System.currentTimeMillis() < deniedUntil) return false;
        if (!ready || audio == null || text == null || text.isEmpty() || audio.getMode() == AudioManager.MODE_IN_CALL || audio.getMode() == AudioManager.MODE_IN_COMMUNICATION) return false;
        int result;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus == null) focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes).setOnAudioFocusChangeListener(this, main).setWillPauseWhenDucked(true).build();
            result = audio.requestAudioFocus(focus);
        } else result = audio.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { deniedUntil = System.currentTimeMillis() + 2000; return false; }
        int available = tts.setLanguage(Locale.forLanguageTag(language));
        if (available == TextToSpeech.LANG_MISSING_DATA || available == TextToSpeech.LANG_NOT_SUPPORTED) { release(); return false; }
        SpeechPreferences config = settings();
        List<SpeechPlan.Part> parts = SpeechPlan.utterances(text, language, segments, config.unifiedVoice);
        if (parts.isEmpty()) { release(); return false; }
        backgroundOwner = fromBackground;
        currentGroup = "nav-" + (++sequence) + "-";
        currentId = currentGroup + (parts.size() - 1);
        List<Voice> availableVoices = voices();
        tts.setSpeechRate(config.rate); tts.setPitch(config.pitch);
        // Each speak() captures the current language/voice in its request. Keep
        // audio focus until the final segment, including across language changes.
        for (int i = 0; i < parts.size(); i++) {
            SpeechPlan.Part part = parts.get(i);
            String actualLanguage = part.language;
            int supported = tts.setLanguage(Locale.forLanguageTag(part.language));
            if (supported < 0) {
                languageFallback = true;
                if (tts.setLanguage(Locale.forLanguageTag(language)) < 0) { stop(); return false; }
                actualLanguage = language;
            }
            String requestedVoice = config.forLanguage(actualLanguage);
            Voice selected = chosen(requestedVoice, actualLanguage, availableVoices);
            if (!requestedVoice.isEmpty() && (selected == null || tts.setVoice(selected) != TextToSpeech.SUCCESS)) {
                voiceFallback = true;
                if (tts.setLanguage(Locale.forLanguageTag(actualLanguage)) < 0) { stop(); return false; }
            }
            if (tts.speak(part.text, i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, currentGroup + i) != TextToSpeech.SUCCESS) { stop(); return false; }
        }
        return true;
    }
    void stopForeground() { if (!backgroundOwner) stop(); }
    void stop() { currentId = ""; currentGroup = ""; if (tts != null) tts.stop(); release(); }
    private void release() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26 && focus != null) audio.abandonAudioFocusRequest(focus);
        else audio.abandonAudioFocus(this);
    }
    @Override public void onAudioFocusChange(int change) {
        if (change < 0) {
            currentId = ""; currentGroup = ""; tts.stop();
            NativeGuidance.repeatAfterInterruption();
        }
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
            NativeGuidance.repeatAfterInterruption();
            PipPlugin.dispatchSpeechResume();
        }
    }
}
