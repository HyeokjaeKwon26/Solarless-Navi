package com.solaris.nav;
import org.junit.Test;
import org.json.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import static org.junit.Assert.*;

public class GuidanceUnitsTest {
    @Test public void backgroundSpeechMatchesWebDistanceCasesRegardlessOfDeviceLocale() throws Exception {
        JSONArray cases = new JSONArray(new String(Files.readAllBytes(Paths.get(System.getProperty("navigation.units.fixtures"))), StandardCharsets.UTF_8));
        Locale original = Locale.getDefault();
        try {
            Locale.setDefault(Locale.GERMANY);
            for (int i = 0; i < cases.length(); i++) {
                JSONObject row = cases.getJSONObject(i);
                assertEquals(row.getString("en"), GuidanceUnits.spokenDistance(row.getDouble("meters"), row.getString("system"), "en-US"));
                assertEquals(row.getString("ko"), GuidanceUnits.spokenDistance(row.getDouble("meters"), row.getString("system"), "ko-KR"));
            }
        } finally { Locale.setDefault(original); }
    }
}
