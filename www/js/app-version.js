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
    root.SolarlessVersionUtils = { parseSemver, compareSemver, isApkRelease };
    if (typeof module === 'object' && module.exports) module.exports = root.SolarlessVersionUtils;
})(typeof window !== 'undefined' ? window : globalThis);
