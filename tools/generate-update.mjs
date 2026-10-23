import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function validateApkMetadata(config, certificateOutput, badging) {
    if (!/^\d+\.\d+\.\d+$/.test(config.versionName) || !Number.isSafeInteger(config.versionCode) ||
        config.versionCode < 2 || config.versionCode > 2100000000 || config.packageName !== 'com.solaris.nav' ||
        !/^[a-f0-9]{64}$/.test(config.certificateSha256)) throw new Error('Invalid release configuration');
    const signers = [...certificateOutput.matchAll(/certificate SHA-256 digest:\s*([a-f0-9]+)/gi)].map(match => match[1].toLowerCase());
    if (signers.length !== 1 || signers[0] !== config.certificateSha256) throw new Error('SIGNATURE_MISMATCH: release must use the pinned certificate in app-release.json');
    const info = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
    const minSdk = badging.match(/sdkVersion:'(\d+)'/);
    if (!info || info[1] !== config.packageName || Number(info[2]) !== config.versionCode || info[3] !== config.versionName ||
        !minSdk || Number(minSdk[1]) !== config.minSdk) throw new Error('APK package/version/minSdk does not match app-release.json');
}

export function buildManifest(config, apk, notes = '') {
    if (!apk.length || apk.length > 100 * 1024 * 1024) throw new Error('Invalid APK size');
    return { schemaVersion: 1, ...config, sizeBytes: apk.length,
        sha256: createHash('sha256').update(apk).digest('hex'),
        apkUrl: `https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/app-v${config.versionName}/SolarLessNavi-${config.versionName}.apk`,
        releaseNotes: notes.slice(0, 4000) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const [apkPath, outputFolder] = process.argv.slice(2);
    if (!apkPath || !outputFolder) throw new Error('Usage: node tools/generate-update.mjs signed.apk output-directory');
    const config = JSON.parse(fs.readFileSync('app-release.json', 'utf8'));
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (!sdk) throw new Error('ANDROID_HOME is required');
    const buildTools = path.join(sdk, 'build-tools', '34.0.0');
    const certificates = execFileSync('java', ['-jar', path.join(buildTools, 'lib', 'apksigner.jar'), 'verify', '--print-certs', apkPath], { encoding: 'utf8' });
    const badging = execFileSync(path.join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), ['dump', 'badging', apkPath], { encoding: 'utf8' });
    validateApkMetadata(config, certificates, badging);
    const apk = fs.readFileSync(apkPath);
    const notes = fs.readFileSync('docs/RELEASE_NOTES.md', 'utf8');
    const manifest = buildManifest(config, apk, notes);
    fs.mkdirSync(outputFolder, { recursive: true });
    fs.writeFileSync(path.join(outputFolder, `SolarLessNavi-${config.versionName}.apk`), apk);
    fs.writeFileSync(path.join(outputFolder, 'update.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.writeFileSync(path.join(outputFolder, 'SHA256SUMS.txt'), `${manifest.sha256}  SolarLessNavi-${config.versionName}.apk\n`);
    console.log(`Verified ${config.packageName} ${config.versionName} (${config.versionCode}); signing certificate matches app-release.json.`);
}
