package com.solaris.nav;

import com.getcapacitor.PluginCall;

/** Parse the actual JS bridge payload before opening a connection or touching files. */
final class UpdateRequest {
    final String url;
    final String sha256;
    final long sizeBytes;
    final long versionCode;

    private UpdateRequest(PluginCall call) {
        url = call.getString("url", "");
        sha256 = call.getString("sha256", "");
        // Capacitor 6 getLong accepts Long only; JSON commonly yields Integer.
        sizeBytes = positiveInteger(call.getData().opt("sizeBytes"));
        versionCode = positiveInteger(call.getData().opt("versionCode"));
        UpdatePolicy.checkUrl(url, false);
        UpdatePolicy.checkMetadata(sha256, sizeBytes, versionCode);
    }

    static UpdateRequest fromCall(PluginCall call) { return new UpdateRequest(call); }

    private static long positiveInteger(Object value) {
        if (!(value instanceof Number)) throw new IllegalArgumentException("INVALID_UPDATE");
        double number = ((Number) value).doubleValue();
        if (Double.isNaN(number) || Double.isInfinite(number) || number <= 0 ||
            number > 9007199254740991d || number != Math.rint(number)) {
            throw new IllegalArgumentException("INVALID_UPDATE");
        }
        return ((Number) value).longValue();
    }
}
