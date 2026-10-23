package com.solaris.nav;

import java.net.URI;
import java.util.Set;

/** Shared validation for downloads and installer handoff; no Android dependencies. */
final class UpdatePolicy {
    static final long MAX_APK_BYTES = 100L * 1024 * 1024;
    static final String RELEASE_PATH = "/HyeokjaeKwon26/Solarless-Navi/releases/download/";

    static void checkUrl(String value, boolean redirect) {
        URI uri = URI.create(value);
        String host = uri.getHost();
        boolean repositoryAsset = "github.com".equals(host) && uri.getRawQuery() == null &&
            uri.getRawPath().matches(RELEASE_PATH + "app-v[0-9]+\\.[0-9]+\\.[0-9]+/SolarLessNavi-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk");
        boolean assetHost = redirect && ("release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host));
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getFragment() != null ||
            (uri.getPort() != -1 && uri.getPort() != 443) || (!repositoryAsset && !assetHost)) {
            throw new IllegalArgumentException("UNTRUSTED_URL");
        }
    }

    static void checkMetadata(String sha256, long size, long versionCode) {
        if (sha256 == null || !sha256.matches("[a-fA-F0-9]{64}") || size <= 0 || size > MAX_APK_BYTES || versionCode <= 0) {
            throw new IllegalArgumentException("INVALID_UPDATE");
        }
    }

    static void checkIdentity(String installedPackage, long installedVersion, Set<String> installedSigners,
        String updatePackage, long updateVersion, Set<String> updateSigners, long expectedVersion) {
        if (!installedPackage.equals(updatePackage)) throw new IllegalArgumentException("PACKAGE_MISMATCH");
        if (installedSigners.isEmpty() || !installedSigners.equals(updateSigners)) throw new IllegalArgumentException("SIGNATURE_MISMATCH");
        if (updateVersion <= installedVersion || updateVersion != expectedVersion) throw new IllegalArgumentException("VERSION_MISMATCH");
    }
}
