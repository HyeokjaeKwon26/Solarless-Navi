const { test, expect } = require('@playwright/test');
const config = require('../../app-release.json');

async function updater(page, options = {}) {
    const prefix = 'https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/';
    const manifest = { ...config, versionName: '9.0.0', versionCode: 900, schemaVersion: 1, sizeBytes: 400,
        sha256: 'a'.repeat(64), apkUrl: `${prefix}app-v9.0.0/SolarLessNavi-9.0.0.apk`,
        releaseNotes: '<img src=x onerror="window.injected=true">Test release', ...options.manifest };
    await page.route('https://api.github.com/**', route => route.fulfill({ json: [{ tag_name: 'scene-2099' },
        { tag_name: 'app-v9.0.0', assets: [{ name: 'update.json', browser_download_url: `${prefix}app-v9.0.0/update.json` }] }] }));
    await page.route(`${prefix}**`, route => options.networkError ? route.fulfill({ status: 503, body: 'offline' }) : route.fulfill({ json: manifest }));
    await page.addInitScript(({ config, options }) => {
        window.calls = { download: 0, install: 0, cancel: 0, removed: 0 };
        window.driving = !!options.driving;
        let progress, rejectDownload;
        window.Capacitor = { isNativePlatform: () => true, Plugins: { AppUpdate: {
            getInstalledInfo: async () => ({ ...config, versionCode: 1, sdkInt: 34 }),
            addListener: async (_, callback) => { progress = callback; return { remove: async () => { window.calls.removed++; } }; },
            downloadUpdate: async () => {
                window.calls.download++;
                progress({ totalBytes: 400, receivedBytes: 200 });
                if (options.downloadError) throw new Error(options.downloadError);
                if (options.pendingDownload) return new Promise((resolve, reject) => { rejectDownload = reject; window.finishDownload = () => resolve({ verified: true }); });
                return { verified: true };
            },
            cancelDownload: async () => { window.calls.cancel++; rejectDownload(new Error('CANCELLED')); },
            installUpdate: async () => {
                window.calls.install++;
                return window.calls.install === 1 ? { permissionGranted: true } : { installerOpened: true };
            }
        } } };
    }, { config, options });
    await page.route('**/__update_test__', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <style>.hidden,[hidden]{display:none}</style>
        <button id="btn-check-update">Check</button><p id="update-check-status"></p>
        <div id="update-modal" class="hidden">
        <p id="update-info-msg"></p><pre id="update-release-notes"></pre><p id="update-status"></p>
        <progress id="update-progress" max="100" hidden></progress><button id="btn-cancel-update" hidden>Cancel</button>
        <button id="btn-download-update"><span id="update-download-btn-text"></span></button>
        <button id="btn-close-update-modal">Later</button></div>
        <script src="js/app-version.js"></script><script src="js/app-updater.js"></script>
        <script>window.updater=SolarlessUpdater.create({language:()=> 'en',isDriving:()=>window.driving});</script>` }));
    await page.goto('__update_test__');
    await page.locator('#btn-check-update').click();
}

test('verified download requires explicit installation and permission retry; notes are plain text', async ({ page }) => {
    await updater(page);
    await expect(page.locator('#update-modal')).toBeVisible();
    await expect(page.locator('#update-release-notes')).toContainText('<img');
    expect(await page.evaluate(() => window.injected)).toBeUndefined();
    await page.locator('#btn-download-update').click();
    await expect(page.locator('#update-modal')).toHaveAttribute('data-update-state', 'ready');
    expect(await page.evaluate(() => window.calls.install)).toBe(0);
    await page.locator('#btn-download-update').click();
    await expect(page.locator('#update-status')).toContainText('Tap Install update again');
    await page.locator('#btn-download-update').click();
    await expect(page.locator('#update-status')).toContainText('Android installer');
    expect(await page.evaluate(() => window.calls)).toEqual({ download: 1, install: 2, cancel: 0, removed: 1 });
});
test('mismatched signing key prevents download', async ({ page }) => {
    await updater(page, { manifest: { certificateSha256: 'b'.repeat(64) } });
    await expect(page.locator('#update-check-status')).toContainText('signing certificates differ');
    await expect(page.locator('#update-modal')).toBeHidden();
    expect(await page.evaluate(() => window.calls.download)).toBe(0);
});
test('cancelled download restores controls and never opens installer', async ({ page }) => {
    await updater(page, { pendingDownload: true });
    await page.locator('#btn-download-update').click();
    await expect(page.locator('#update-progress')).toHaveJSProperty('value', 50);
    await page.locator('#btn-cancel-update').click();
    await expect(page.locator('#update-status')).toContainText('Download cancelled');
    await expect(page.locator('#btn-download-update')).toBeEnabled();
    expect(await page.evaluate(() => window.calls)).toEqual({ download: 1, install: 0, cancel: 1, removed: 1 });
});
test('corrupt download cannot enter install state and can be retried', async ({ page }) => {
    await updater(page, { downloadError: 'HASH_MISMATCH' });
    await page.locator('#btn-download-update').click();
    await expect(page.locator('#update-status')).toContainText('File verification failed');
    await expect(page.locator('#update-modal')).toHaveAttribute('data-update-state', 'available');
    await page.locator('#btn-download-update').click();
    await expect.poll(() => page.evaluate(() => window.calls.download)).toBe(2);
    expect(await page.evaluate(() => window.calls.install)).toBe(0);
});
test('driving defers checking and hides a pending update until navigation ends', async ({ page }) => {
    await updater(page, { driving: true });
    await expect(page.locator('#update-check-status')).toContainText('End navigation');
    await expect(page.locator('#update-modal')).toBeHidden();
    await page.evaluate(() => { window.driving = false; });
    await expect(page.locator('#update-modal')).toBeVisible();
    await page.evaluate(() => { window.driving = true; });
    await expect(page.locator('#update-modal')).toBeHidden();
    expect(await page.evaluate(() => window.calls.install)).toBe(0);
});
test('network failure unlocks manual retry', async ({ page }) => {
    await updater(page, { networkError: true });
    await expect(page.locator('#update-check-status')).toContainText('Could not reach');
    await expect(page.locator('#btn-check-update')).toBeEnabled();
    await page.locator('#btn-check-update').click();
    await expect(page.locator('#update-modal')).toHaveAttribute('data-update-state', 'error');
});
test('same or older version is never offered', async ({ page }) => {
    await updater(page, { manifest: { versionCode: 1 } });
    await expect(page.locator('#update-check-status')).toContainText('Up to date');
    await expect(page.locator('#update-modal')).toBeHidden();
});
