package com.solaris.nav;

import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
import java.util.List;

public class SpeechPlanTest {
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
