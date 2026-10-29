package com.solaris.nav;

import org.json.*;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

public class SpeechDispatchTest {
    private static final List<SpeechPreferences.Choice> VOICES = Arrays.asList(
        new SpeechPreferences.Choice("ko-default","ko-KR"), new SpeechPreferences.Choice("ko-selected","ko-KR"),
        new SpeechPreferences.Choice("en-default","en-US"), new SpeechPreferences.Choice("cloud","ko-KR",true));
    private static final class Engine implements SpeechDispatch.Engine {
        String voice = "old", koDefault = "ko-default";
        boolean unsupportedEnglish, failVoice;
        final List<String> calls = new ArrayList<>();
        final List<SpeechPlan.Part> spoken = new ArrayList<>();
        public boolean language(String lang) {
            calls.add("language:"+lang);
            if (unsupportedEnglish && lang.startsWith("en")) return false;
            voice = lang.startsWith("ko") ? koDefault : "en-default"; return true;
        }
        public String currentVoice() { return voice; }
        public boolean voice(String id) { calls.add("voice:"+id); voice=id; return !failVoice; }
        public boolean speak(SpeechPlan.Part part, int index) { calls.add("speak:"+voice);spoken.add(part);return true; }
    }
    private List<SpeechPlan.Part> plan(boolean unified) throws Exception {
        JSONArray segments = new JSONArray("[{\"text\":\"잠시 후 🚗 \",\"lang\":\"ko-KR\"},{\"text\":\"Lee Street\",\"lang\":\"en-US\"},{\"text\":\"에서 우회전. \",\"lang\":\"ko-KR\"},{\"text\":\"Harvard Avenue\",\"lang\":\"en-US\"}]");
        return SpeechPlan.utterances("fallback","ko-KR",segments,unified);
    }
    @Test public void defaultAndSelectedDifferOnlyInVoiceSelectionAndRetainEnglishRanges() throws Exception {
        SpeechPreferences saved = new SpeechPreferences(new JSONObject().put("koVoice","ko-selected").put("enVoice","en-default").put("rate",.8).put("pitch",1.2).put("unifiedVoice",false));
        List<SpeechPlan.Part> plan = plan(true);
        Engine a = new Engine(), b = new Engine();
        assertTrue(SpeechDispatch.run(plan,"ko-KR",saved.comparison(true),VOICES,a).accepted);
        assertTrue(SpeechDispatch.run(plan,"ko-KR",saved.comparison(false),VOICES,b).accepted);
        assertEquals(Arrays.asList("language:ko-KR","speak:ko-default"), a.calls);
        assertEquals(Arrays.asList("language:ko-KR","voice:ko-selected","speak:ko-selected"), b.calls);
        assertEquals(1,b.spoken.size());assertSame(a.spoken.get(0),b.spoken.get(0));
        assertEquals(2,plan.get(0).ranges.size());
        for (SpeechPlan.Range range : plan.get(0).ranges) {
            assertEquals("en-US",range.language);
            String text=plan.get(0).text.substring(range.start,range.end);
            assertTrue(text.equals("Lee Street") || text.equals("Harvard Avenue"));
        }
        assertEquals(saved.rate,saved.comparison(true).rate,0);assertEquals(saved.pitch,saved.comparison(false).pitch,0);
        assertFalse(saved.unifiedVoice);assertEquals("ko-selected",saved.koVoice);
    }
    @Test public void missingVoiceFallsBackLocallyButCloudDefaultCannotLeak() throws Exception {
        Engine engine=new Engine();engine.koDefault="cloud";
        SpeechPreferences saved=new SpeechPreferences(new JSONObject().put("koVoice","missing"));
        SpeechDispatch.Result result=SpeechDispatch.run(plan(true),"ko-KR",saved,VOICES,engine);
        assertTrue(result.accepted);assertTrue(result.voiceFallback);assertEquals("ko-default",engine.voice);
        Engine cloud=new Engine();cloud.koDefault="cloud";
        result=SpeechDispatch.run(plan(true),"ko-KR",saved,Collections.singletonList(VOICES.get(3)),cloud);
        assertFalse(result.accepted);assertTrue(result.unavailable);assertTrue(cloud.spoken.isEmpty());
    }
    @Test public void separateModeStillWorksAndMissingEnglishDoesNotQueueHalfInstruction() throws Exception {
        Engine engine=new Engine();SpeechPreferences config=new SpeechPreferences(null);
        assertTrue(SpeechDispatch.run(plan(false),"ko-KR",config,VOICES,engine).accepted);
        assertEquals(4,engine.spoken.size());assertTrue(engine.calls.contains("speak:en-default"));
        Engine missing=new Engine();
        assertFalse(SpeechDispatch.run(plan(false),"ko-KR",config,VOICES.subList(0,2),missing).accepted);
        assertTrue(missing.spoken.isEmpty());
    }
    @Test public void engineRefusalStopsBeforeSpeakingAndLanguageFallbackIsExplicit() throws Exception {
        Engine engine=new Engine();engine.failVoice=true;
        SpeechPreferences config=new SpeechPreferences(new JSONObject().put("koVoice","ko-selected"));
        assertFalse(SpeechDispatch.run(plan(true),"ko-KR",config,VOICES,engine).accepted);assertTrue(engine.spoken.isEmpty());
        Engine fallback=new Engine();fallback.unsupportedEnglish=true;
        SpeechDispatch.Result result=SpeechDispatch.run(plan(false),"ko-KR",config,VOICES,fallback);
        assertTrue(result.accepted);assertTrue(result.languageFallback);
        assertTrue(fallback.calls.stream().noneMatch(c->c.equals("speak:en-default")));
    }
}
