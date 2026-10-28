package com.solaris.nav;

import android.app.Activity;
import android.content.Intent;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.ArrayList;

/** Uses the system recognition activity; this app does not record/store microphone audio. */
@CapacitorPlugin(name = "VoiceInput")
public class VoiceInputPlugin extends Plugin {
    private boolean recognizing;
    @PluginMethod public void recognize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizing) { call.reject("VOICE_BUSY"); return; }
            String language = "ko-KR".equals(call.getString("language")) ? "ko-KR" : "en-US";
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "ko-KR".equals(language) ? "목적지 주소나 장소를 말하세요" : "Say a destination address or place");
            try { recognizing = true; startActivityForResult(call, intent, "recognized"); }
            catch (Exception error) { recognizing = false; call.reject("VOICE_UNAVAILABLE"); }
        });
    }
    @ActivityCallback private void recognized(PluginCall call, ActivityResult result) {
        recognizing = false;
        if (call == null) return;
        ArrayList<String> choices = result.getData() == null ? null : result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String text = result.getResultCode() == Activity.RESULT_OK && choices != null && !choices.isEmpty() ? choices.get(0) : "";
        JSObject value = new JSObject();
        value.put("text", text == null ? "" : text.substring(0, Math.min(300, text.length())));
        value.put("cancelled", result.getResultCode() != Activity.RESULT_OK);
        call.resolve(value);
    }
}
