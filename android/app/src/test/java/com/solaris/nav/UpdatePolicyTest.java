package com.solaris.nav;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.Collections;
import java.util.Set;

public class UpdatePolicyTest {
    private static final String URL = "https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/app-v1.1.0/SolarLessNavi-1.1.0.apk";
    private static final String HASH = "8ec1a26e9c1eefeac384660973a0a9a99341071f1233ab196d315b3ce40a0a0d";
    private static final Set<String> SIGNERS = Collections.singleton(HASH);

    private void rejects(String code, Runnable action) {
        try { action.run(); fail("Expected " + code); }
        catch (IllegalArgumentException error) { assertEquals(code, error.getMessage()); }
    }

    @Test public void acceptsRepositoryApkAndSignedCdnRedirect() {
        UpdatePolicy.checkUrl(URL, false);
        UpdatePolicy.checkUrl("https://release-assets.githubusercontent.com/github-production-release-asset/123?sig=abc", true);
    }
    @Test public void rejectsOtherRepositoriesProtocolsAndRedirectHosts() {
        for (String url : new String[] { URL.replace("https:", "http:"), URL.replace("Solarless-Navi", "other"),
            URL.replace("github.com/", "github.com.evil.example/"), URL.replace("github.com/", "user@github.com/"),
            URL.replace("github.com/", "github.com:8443/"), URL + "#fragment", URL + "?download=1",
            URL.replace("SolarLessNavi-1.1.0.apk", "../../other.apk") }) {
            rejects("UNTRUSTED_URL", () -> UpdatePolicy.checkUrl(url, false));
        }
        rejects("UNTRUSTED_URL", () -> UpdatePolicy.checkUrl("https://evil.example/file.apk", true));
        rejects("UNTRUSTED_URL", () -> UpdatePolicy.checkUrl("https://release-assets.githubusercontent.com/file.apk", false));
    }
    @Test public void validatesHashSizeAndVersion() {
        UpdatePolicy.checkMetadata(HASH, 4000000, 2);
        rejects("INVALID_UPDATE", () -> UpdatePolicy.checkMetadata("bad", 100, 2));
        rejects("INVALID_UPDATE", () -> UpdatePolicy.checkMetadata(HASH, 0, 2));
        rejects("INVALID_UPDATE", () -> UpdatePolicy.checkMetadata(HASH, UpdatePolicy.MAX_APK_BYTES + 1, 2));
        rejects("INVALID_UPDATE", () -> UpdatePolicy.checkMetadata(HASH, 100, 0));
    }
    @Test public void acceptsOnlyNewerMatchingPackageAndSigner() {
        UpdatePolicy.checkIdentity("com.solaris.nav", 1, SIGNERS, "com.solaris.nav", 2, SIGNERS, 2);
    }
    @Test public void rejectsReplacementKeyAndMissingSignatures() {
        rejects("SIGNATURE_MISMATCH", () -> UpdatePolicy.checkIdentity("com.solaris.nav", 1, SIGNERS,
            "com.solaris.nav", 2, Collections.singleton("debug-key"), 2));
        rejects("SIGNATURE_MISMATCH", () -> UpdatePolicy.checkIdentity("com.solaris.nav", 1, Collections.emptySet(),
            "com.solaris.nav", 2, Collections.emptySet(), 2));
    }
    @Test public void rejectsWrongPackageDowngradeAndManifestMismatch() {
        rejects("PACKAGE_MISMATCH", () -> UpdatePolicy.checkIdentity("com.solaris.nav", 1, SIGNERS, "other.app", 2, SIGNERS, 2));
        for (long version : new long[] { 0, 1, 3 }) {
            rejects("VERSION_MISMATCH", () -> UpdatePolicy.checkIdentity("com.solaris.nav", 1, SIGNERS,
                "com.solaris.nav", version, SIGNERS, 2));
        }
    }
}
