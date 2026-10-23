package com.solaris.nav;

import android.content.Context;
import android.media.*;
import android.os.*;
import android.speech.tts.*;
import java.util.Locale;

/** Single TTS owner for foreground and background. Never forces Bluetooth routing. */
final class NavigationSpeech implements AudioManager.OnAudioFocusChangeListener {
    private static NavigationSpeech instance;
    private final AudioManager audio;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    private AudioFocusRequest focus;
    private TextToSpeech tts;
    private boolean ready, backgroundOwner;
    private long deniedUntil;
    private String currentId = "";
    private long sequence;
    static synchronized NavigationSpeech get(Context context) {
        if (instance == null) instance = new NavigationSpeech(context.getApplicationContext());
        return instance;
    }
    private NavigationSpeech(Context context) {
        audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(context, status -> {
            ready = status == TextToSpeech.SUCCESS;
            if (ready) tts.setAudioAttributes(attributes);
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { }
            @Override public void onDone(String id) { main.post(() -> { if (id.equals(currentId)) release(); }); }
            @Override public void onError(String id) { onDone(id); }
        });
    }
    boolean speak(String text, String language) { return speak(text, language, false); }
    boolean speak(String text, String language, boolean fromBackground) {
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
        backgroundOwner = fromBackground;
        currentId = "nav-" + (++sequence);
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, currentId) != TextToSpeech.SUCCESS) { release(); return false; }
        return true;
    }
    void stopForeground() { if (!backgroundOwner) stop(); }
    void stop() { currentId = ""; if (tts != null) tts.stop(); release(); }
    private void release() {
        if (audio == null) return;
        if (Build.VERSION.SDK_INT >= 26 && focus != null) audio.abandonAudioFocusRequest(focus);
        else audio.abandonAudioFocus(this);
    }
    @Override public void onAudioFocusChange(int change) {
        if (change < 0) {
            currentId = ""; tts.stop();
            NativeGuidance.repeatAfterInterruption();
        }
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
            NativeGuidance.repeatAfterInterruption();
            PipPlugin.dispatchSpeechResume();
        }
    }
}
