package com.solaris.nav;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdateRequestTest {
    private static final String URL = "https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/app-v1.3.5/SolarLessNavi-1.3.5.apk";
    private static final String HASH = "ffc44af2a370c73a7c6311bb85e5c197854f2aeb8989390823a663de9ff01c8b";

    private PluginCall call(String size, String code) throws Exception {
        JSObject data = new JSObject("{\"url\":\"" + URL + "\",\"sha256\":\"" + HASH +
            "\",\"sizeBytes\":" + size + ",\"versionCode\":" + code + "}");
        return new PluginCall(null, "AppUpdate", "test", "downloadUpdate", data);
    }

    @Test public void realCapacitorIntegerPayloadPassesTheDownloadGate() throws Exception {
        PluginCall call = call("4380808", "8");
        assertTrue(call.getData().opt("sizeBytes") instanceof Integer);
        assertEquals(Long.valueOf(0), call.getLong("sizeBytes", 0L)); // Original failure.
        UpdateRequest request = UpdateRequest.fromCall(call);
        assertEquals(4380808L, request.sizeBytes);
        assertEquals(8L, request.versionCode);
        assertEquals(URL, request.url);
        assertEquals(HASH, request.sha256);
    }

    @Test public void acceptsLongAndIntegralNumberRepresentations() throws Exception {
        assertEquals(2147483648L, UpdateRequest.fromCall(call("4380808", "2147483648")).versionCode);
        assertEquals(9L, UpdateRequest.fromCall(call("4380808.0", "9.0")).versionCode);
    }

    @Test public void rejectsMalformedMissingFractionalAndUnsafeNumbers() throws Exception {
        for (String value : new String[] {"null", "true", "\"9\"", "{}", "[]", "0", "-1", "1.5", "9007199254740992"}) {
            for (PluginCall invalid : new PluginCall[] {call(value, "9"), call("4380808", value)}) {
                try { UpdateRequest.fromCall(invalid); fail("Accepted " + value); }
                catch (IllegalArgumentException error) { assertEquals("INVALID_UPDATE", error.getMessage()); }
            }
        }
        PluginCall missing = call("4380808", "9");
        missing.getData().remove("sizeBytes");
        try { UpdateRequest.fromCall(missing); fail("Accepted missing size"); }
        catch (IllegalArgumentException error) { assertEquals("INVALID_UPDATE", error.getMessage()); }
    }

    @Test public void keepsSizeHashAndUrlValidationAtTheBridgeBoundary() throws Exception {
        for (String key : new String[] {"sizeBytes", "sha256", "url"}) {
            PluginCall invalid = call("4380808", "9");
            invalid.getData().put(key, key.equals("sizeBytes") ? UpdatePolicy.MAX_APK_BYTES + 1 : "bad");
            try { UpdateRequest.fromCall(invalid); fail("Accepted invalid " + key); }
            catch (IllegalArgumentException error) {
                assertEquals(key.equals("url") ? "UNTRUSTED_URL" : "INVALID_UPDATE", error.getMessage());
            }
        }
    }
}
