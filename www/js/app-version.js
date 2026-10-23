(function (root) {
    'use strict';
    function parseSemver(value) {
        const normalized = String(value || '').trim().replace(/^(?:app|android|apk)[-_]?/i, '');
        const match = normalized.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/i);
        return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : null;
    }
    function compareSemver(a, b) {
        const left = parseSemver(a) || [0, 0, 0];
        const right = parseSemver(b) || [0, 0, 0];
        for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
        return 0;
    }
    function isApkRelease(release) {
        if (!release || release.draft || release.prerelease) return false;
        const tag = String(release.tag_name || '');
        const assets = Array.isArray(release.assets) ? release.assets : [];
        return /^(?:app|android|apk)[-_]?v?\d/i.test(tag) || assets.some(asset => /\.apk$/i.test(String(asset && asset.name || '')));
    }
    const repository = 'HyeokjaeKwon26/Solarless-Navi';
    function releaseAssetUrl(value, filename) {
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password &&
                !url.port && !url.search && !url.hash &&
                new RegExp(`^/${repository}/releases/download/app-v\\d+\\.\\d+\\.\\d+/${filename}$`).test(url.pathname);
        } catch { return false; }
    }
    function updateReleases(releases) {
        return (Array.isArray(releases) ? releases : []).filter(release =>
            release && !release.draft && !release.prerelease && /^app-v\d+\.\d+\.\d+$/.test(release.tag_name) &&
            Array.isArray(release.assets) && release.assets.some(asset => asset.name === 'update.json' &&
                releaseAssetUrl(asset.browser_download_url, 'update\\.json') &&
                asset.browser_download_url.endsWith(`/${release.tag_name}/update.json`))
        ).sort((a, b) => compareSemver(b.tag_name, a.tag_name));
    }
    function validateUpdate(manifest, installed, tag) {
        const fail = code => { throw new Error(code); };
        if (!manifest || manifest.schemaVersion !== 1 || manifest.packageName !== 'com.solaris.nav' ||
            !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1 ||
            !/^\d+\.\d+\.\d+$/.test(manifest.versionName || '') || `app-v${manifest.versionName}` !== tag ||
            !Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0 || manifest.sizeBytes > 100 * 1024 * 1024 ||
            !/^[a-f0-9]{64}$/i.test(manifest.sha256 || '') || !/^[a-f0-9]{64}$/i.test(manifest.certificateSha256 || '') ||
            !Number.isInteger(manifest.minSdk) || manifest.minSdk < 22 ||
            !releaseAssetUrl(manifest.apkUrl, 'SolarLessNavi-\\d+\\.\\d+\\.\\d+\\.apk') ||
            !manifest.apkUrl.endsWith(`/${tag}/SolarLessNavi-${manifest.versionName}.apk`)) fail('INVALID_UPDATE');
        if (!installed || installed.packageName !== manifest.packageName || !Number.isSafeInteger(installed.versionCode) ||
            !/^[a-f0-9]{64}$/i.test(installed.certificateSha256 || '') || !Number.isInteger(installed.sdkInt)) fail('VERSION_READ_FAILED');
        if (manifest.versionCode <= installed.versionCode) return { available: false };
        if (String(installed.certificateSha256).toLowerCase() !== manifest.certificateSha256.toLowerCase()) fail('SIGNATURE_MISMATCH');
        if (manifest.minSdk > installed.sdkInt) fail('ANDROID_TOO_OLD');
        return { available: true, manifest };
    }
    root.SolarlessVersionUtils = { parseSemver, compareSemver, isApkRelease, releaseAssetUrl, updateReleases, validateUpdate, repository };
    if (typeof module === 'object' && module.exports) module.exports = root.SolarlessVersionUtils;
})(typeof window !== 'undefined' ? window : globalThis);
