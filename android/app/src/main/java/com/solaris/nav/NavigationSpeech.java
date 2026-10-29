package com.solaris.nav;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.*;
import android.os.*;
import android.speech.tts.*;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.LocaleSpan;
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
    private boolean onDeviceVoiceUnavailable;
    private JSObject lastPreview = new JSObject();
    boolean onDeviceVoiceUnavailable() { return onDeviceVoiceUnavailable; }
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
        SpeechPreferences saved;
        try { saved = new SpeechPreferences(new JSONObject(preferences.getString("settings", "{}"))); }
        catch (JSONException error) { saved = new SpeechPreferences(null); }
        if (!ready) return saved;
        SpeechPreferences local = saved.offline(choices(voices(true)));
        // One-time upgrade: the old separate mode changes speakers at road names.
        // Keep the chosen IDs/rate/pitch; a later explicit separate choice is respected.
        if (!preferences.getBoolean("locale_hint_policy_v1", false)) {
            local = local.comparison(false);
            preferences.edit().putBoolean("locale_hint_policy_v1", true)
                .putString("settings", local.json().toString()).apply();
        }
        if (!local.koVoice.equals(saved.koVoice) || !local.enVoice.equals(saved.enVoice))
            preferences.edit().putString("settings",local.json().toString()).apply();
        return local;
    }
    private String voiceId(Voice voice) { return "android:" + engine + ":" + voice.getName(); }
    private List<Voice> voices() { return voices(false); }
    private List<Voice> voices(boolean includeNetwork) {
        List<Voice> list = new ArrayList<>();
        if (!ready || tts.getVoices() == null) return list;
        for (Voice voice : tts.getVoices()) {
            String language = voice.getLocale().getLanguage();
            if ((language.equals("ko") || language.equals("en")) && (includeNetwork || !voice.isNetworkConnectionRequired()) &&
                (voice.getFeatures() == null || !voice.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED))) list.add(voice);
        }
        Collections.sort(list, (a,b) -> {
            int network = Boolean.compare(a.isNetworkConnectionRequired(), b.isNetworkConnectionRequired());
            return network != 0 ? network : a.getName().compareTo(b.getName());
        });
        return list;
    }
    private List<SpeechPreferences.Choice> choices(List<Voice> list) {
        List<SpeechPreferences.Choice> out = new ArrayList<>();
        for (Voice voice : list) out.add(new SpeechPreferences.Choice(voiceId(voice),voice.getLocale().toLanguageTag(),voice.isNetworkConnectionRequired()));
        return out;
    }
    private Voice chosen(String id, String language, List<Voice> list) {
        SpeechPreferences.Choice selected = SpeechPreferences.selected(id, language, choices(list));
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
        SpeechPreferences next = new SpeechPreferences(input).offline(choices(voices(true))), previous = settings();
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
        return speak(text, language, fromBackground, segments, settings());
    }
    private boolean speak(String text, String language, boolean fromBackground, JSONArray segments, SpeechPreferences config) {
        languageFallback = false;
        voiceFallback = false;
        onDeviceVoiceUnavailable = false;
        if (System.currentTimeMillis() < deniedUntil) return false;
        if (!ready || audio == null || text == null || text.isEmpty() || audio.getMode() == AudioManager.MODE_IN_CALL || audio.getMode() == AudioManager.MODE_IN_COMMUNICATION) return false;
        int result;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus == null) focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(attributes).setOnAudioFocusChangeListener(this, main).setWillPauseWhenDucked(true).build();
            result = audio.requestAudioFocus(focus);
        } else result = audio.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { deniedUntil = System.currentTimeMillis() + 2000; return false; }
        List<SpeechPlan.Part> parts = SpeechPlan.utterances(text, language, segments, config.unifiedVoice);
        if (parts.isEmpty()) { release(); return false; }
        backgroundOwner = fromBackground;
        currentGroup = "nav-" + (++sequence) + "-";
        currentId = currentGroup + (parts.size() - 1);
        List<Voice> availableVoices = voices();
        tts.setSpeechRate(config.rate); tts.setPitch(config.pitch);
        JSONArray reported = new JSONArray();
        SpeechDispatch.Result dispatched = SpeechDispatch.run(parts, language, config, choices(availableVoices), new SpeechDispatch.Engine() {
            public boolean language(String tag) { return tts.setLanguage(Locale.forLanguageTag(tag)) >= 0; }
            public String currentVoice() { Voice v = tts.getVoice(); return v == null ? "" : voiceId(v); }
            public boolean voice(String id) {
                for (Voice v : availableVoices) if (voiceId(v).equals(id)) return tts.setVoice(v) == TextToSpeech.SUCCESS;
                return false;
            }
            public boolean speak(SpeechPlan.Part part, int index) {
                // Preserve the text's language hints without switching to the English
                // voice. Whether the installed engine honors them requires listening.
                SpannableString words = new SpannableString(part.text);
                for (SpeechPlan.Range range : part.ranges)
                    words.setSpan(new LocaleSpan(Locale.forLanguageTag(range.language)), range.start, range.end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                reported.put(currentVoice());
                return tts.speak(words, index == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, currentGroup + index) == TextToSpeech.SUCCESS;
            }
        });
        languageFallback = dispatched.languageFallback; voiceFallback = dispatched.voiceFallback;
        onDeviceVoiceUnavailable = dispatched.unavailable;
        lastPreview = new JSObject(); lastPreview.put("engine", engine);
        lastPreview.put("requestedVoice", config.forLanguage(language)); lastPreview.put("reportedVoices", reported);
        lastPreview.put("utterances", parts.size()); lastPreview.put("languageRanges", parts.get(0).ranges.size());
        lastPreview.put("rate", config.rate); lastPreview.put("pitch", config.pitch);
        if (!dispatched.accepted) stop();
        return dispatched.accepted;
    }
    JSObject comparePreview(boolean useDefault) {
        SpeechPreferences current = settings();
        lastPreview = new JSObject();
        JSONArray segments = new JSONArray();
        try {
            segments.put(new JSONObject().put("text", "잠시 후 ").put("lang", "ko-KR"));
            segments.put(new JSONObject().put("text", "Lee Street").put("lang", "en-US"));
            segments.put(new JSONObject().put("text", "에서 우회전하세요. 이어서 ").put("lang", "ko-KR"));
            segments.put(new JSONObject().put("text", "Harvard Avenue").put("lang", "en-US"));
            segments.put(new JSONObject().put("text", " 방면으로 좌회전하세요.").put("lang", "ko-KR"));
        } catch (JSONException ignored) { }
        boolean accepted = speak("미리 듣기", "ko-KR", false, segments, current.comparison(useDefault));
        lastPreview.put("accepted", accepted); lastPreview.put("comparison", useDefault ? "default" : "selected");
        lastPreview.put("voiceFallback", voiceFallback);
        return lastPreview;
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
