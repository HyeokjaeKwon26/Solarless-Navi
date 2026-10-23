const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const utils = require('../js/app-version');
const config = { ...require('../app-release.json'), versionName: '1.1.0', versionCode: 2, minSdk: 22 };
const prefix = `https://github.com/${utils.repository}/releases/download/`;
const installed = { ...config, versionCode: 1, versionName: '1.0', sdkInt: 34 };
const manifest = { ...config, schemaVersion: 1, sha256: 'a'.repeat(64), sizeBytes: 4000000,
    apkUrl: `${prefix}app-v1.1.0/SolarLessNavi-1.1.0.apk` };
function release(version, overrides = {}) {
    return { tag_name: `app-v${version}`, assets: [{ name: 'update.json', browser_download_url: `${prefix}app-v${version}/update.json` }], ...overrides };
}

test('update release selection ignores scene, draft, prerelease and untrusted manifests; sorts numerically', () => {
    const selected = utils.updateReleases([release('1.2.0'), release('1.10.0'), release('2.0.0', { prerelease: true }),
        release('3.0.0', { draft: true }), release('1.3.0', { tag_name: 'scene-v1.3.0' }),
        release('4.0.0', { assets: [{ name: 'update.json', browser_download_url: 'https://evil.example/update.json' }] }),
        release('5.0.0', { assets: release('1.1.0').assets })]);
    assert.deepEqual(selected.map(item => item.tag_name), ['app-v1.10.0', 'app-v1.2.0']);
});
test('update uses Android versionCode and exact signing identity', () => {
    assert.equal(utils.validateUpdate(manifest, installed, 'app-v1.1.0').available, true);
    assert.equal(utils.validateUpdate(manifest, { ...installed, versionCode: 2 }, 'app-v1.1.0').available, false);
    assert.equal(utils.validateUpdate(manifest, { ...installed, versionCode: 3 }, 'app-v1.1.0').available, false);
    assert.throws(() => utils.validateUpdate(manifest, { ...installed, certificateSha256: 'b'.repeat(64) }, 'app-v1.1.0'), /SIGNATURE_MISMATCH/);
    assert.throws(() => utils.validateUpdate({ ...manifest, minSdk: 35 }, installed, 'app-v1.1.0'), /ANDROID_TOO_OLD/);
    assert.throws(() => utils.validateUpdate(manifest, { ...installed, sdkInt: undefined }, 'app-v1.1.0'), /VERSION_READ_FAILED/);
});
test('invalid update manifests cannot reach native download', () => {
    for (const patch of [ { schemaVersion: 2 }, { versionCode: 2.5 }, { packageName: 'other.app' }, { versionName: '1.2.0' },
        { sha256: 'bad' }, { certificateSha256: '' }, { sizeBytes: -1 }, { sizeBytes: 104857601 }, { minSdk: 21 },
        { apkUrl: manifest.apkUrl.replace('github.com', 'github.com.evil.example') },
        { apkUrl: manifest.apkUrl.replace('Solarless-Navi', 'other') }, { apkUrl: manifest.apkUrl + '?x=1' },
        { apkUrl: manifest.apkUrl.replace('SolarLessNavi-1.1.0', 'SolarLessNavi-2.0.0') } ]) {
        assert.throws(() => utils.validateUpdate({ ...manifest, ...patch }, installed, 'app-v1.1.0'), /INVALID_UPDATE/);
    }
});
test('release packaging verifies original signer and actual APK version before creating metadata', async () => {
    const { validateApkMetadata, buildManifest } = await import('../tools/generate-update.mjs');
    const cert = `Signer #1 certificate SHA-256 digest: ${config.certificateSha256}`;
    const badge = "package: name='com.solaris.nav' versionCode='2' versionName='1.1.0'\nsdkVersion:'22'";
    validateApkMetadata(config, cert, badge);
    assert.throws(() => validateApkMetadata(config, cert.replace(config.certificateSha256, 'b'.repeat(64)), badge), /SIGNATURE_MISMATCH/);
    assert.throws(() => validateApkMetadata(config, cert + '\n' + cert, badge), /SIGNATURE_MISMATCH/);
    assert.throws(() => validateApkMetadata(config, cert, badge.replace("versionCode='2'", "versionCode='1'")), /package\/version/);
    const bytes = Buffer.from('fixture APK bytes');
    const output = buildManifest(config, bytes, '<script>plain release notes</script>');
    assert.equal(output.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(output.sizeBytes, bytes.length);
    assert.equal(utils.validateUpdate(output, installed, 'app-v1.1.0').available, true);
    assert.throws(() => buildManifest(config, Buffer.alloc(0)), /Invalid APK size/);
});
