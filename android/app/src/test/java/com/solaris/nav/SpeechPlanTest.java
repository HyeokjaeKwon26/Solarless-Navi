package com.solaris.nav;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.List;

public class SpeechPlanTest {
    @Test public void mixedGuidanceUsesOneSelectedVoiceByDefaultAndSeparateVoicesOnlyOnRequest() throws Exception {
        JSONArray input = new JSONArray("[{\"text\":\"잠시 후 \",\"lang\":\"ko-KR\"},{\"text\":\"Harvard Avenue\",\"lang\":\"en-US\"},{\"text\":\"에서 우회전\",\"lang\":\"ko-KR\"}]");
        SpeechPreferences config = new SpeechPreferences(new JSONObject("{\"koVoice\":\"selected-ko\",\"enVoice\":\"selected-en\"}"));
        List<SpeechPlan.Part> unified = SpeechPlan.utterances("fallback", "ko-KR", input, config.unifiedVoice);
        assertEquals(1, unified.size());assertEquals("잠시 후 Harvard Avenue에서 우회전",unified.get(0).text);
        assertEquals("selected-ko",config.forLanguage(unified.get(0).language));
        List<SpeechPlan.Part> separate = SpeechPlan.utterances("fallback", "ko-KR", input, false);
        assertEquals(3,separate.size());assertEquals("selected-en",config.forLanguage(separate.get(1).language));
    }
    @Test public void persistedModeAppliesToBackgroundPrefixAndOldSnapshots() throws Exception {
        JSONObject turn=new JSONObject("{\"text\":\"Harvard Ave.에서 우회전\",\"segments\":[{\"text\":\"Harvard Avenue\",\"lang\":\"en-US\"},{\"text\":\"에서 우회전\",\"lang\":\"ko-KR\"}]}");
        JSONArray background=SpeechPlan.prepend("300미터 앞 ","ko-KR",turn);
        SpeechPreferences saved=new SpeechPreferences(new JSONObject(new SpeechPreferences(null).json().toString()));
        List<SpeechPlan.Part> plan=SpeechPlan.utterances(turn.getString("text"),"ko-KR",background,saved.unifiedVoice);
        assertEquals(1,plan.size());assertEquals("300미터 앞 Harvard Avenue에서 우회전",plan.get(0).text);assertEquals("ko-KR",plan.get(0).language);
        assertEquals("legacy",SpeechPlan.utterances("legacy","ko-KR",null,true).get(0).text);
        assertTrue(SpeechPlan.utterances("","ko-KR",null,true).isEmpty());
    }
    @Test public void preservesLanguagesAndOrder() throws Exception {
        JSONArray input = new JSONArray("[{\"text\":\"잠시 후 \",\"lang\":\"ko-KR\"},{\"text\":\"Lee Street\",\"lang\":\"en-US\"},{\"text\":\"에서 우회전\",\"lang\":\"ko-KR\"}]");
        List<SpeechPlan.Part> parts = SpeechPlan.parts("fallback", "ko-KR", input);
        assertEquals(3, parts.size()); assertEquals("en-US", parts.get(1).language); assertEquals("Lee Street", parts.get(1).text);
        assertEquals("ko-KR", parts.get(2).language);
    }
    @Test public void backgroundPrefixRetainsEnglishStreet() throws Exception {
        JSONObject turn = new JSONObject("{\"text\":\"Lee St. 우회전\",\"segments\":[{\"text\":\"Lee Street\",\"lang\":\"en-US\"},{\"text\":\"우회전\",\"lang\":\"ko-KR\"}]}");
        JSONArray parts = SpeechPlan.prepend("300미터 앞에서 ", "ko-KR", turn);
        assertEquals(3, parts.length()); assertEquals("ko-KR", parts.getJSONObject(0).getString("lang"));
        assertEquals("en-US", parts.getJSONObject(1).getString("lang"));
    }
    @Test public void oldSnapshotsAndInvalidLanguageHaveDeterministicFallback() throws Exception {
        assertEquals("legacy", SpeechPlan.parts("legacy", "ko-KR", null).get(0).text);
        JSONArray input = new JSONArray("[{\"text\":\"hello\",\"lang\":\"bogus\"}]");
        assertEquals("ko-KR", SpeechPlan.parts("fallback", "ko-KR", input).get(0).language);
        assertTrue(SpeechPlan.parts("", "ko-KR", new JSONArray()).isEmpty());
    }
}
