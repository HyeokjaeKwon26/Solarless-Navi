// Optional network smoke test: run the shipping updater against public GitHub
// responses in Chromium. The installed Android identity is simulated; this does
// not verify Android's HTTP proxy, APK installer, or preservation of phone data.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const config = require('../app-release.json');

(async () => {
    const browser = await chromium.launch();
    try {
        const source = fs.readFileSync(process.env.UPDATE_CHECK_SOURCE || 'js/app-updater.js', 'utf8');
        const ids = [...new Set([...source.matchAll(/byId\('([^']+)'\)/g)].map(match => match[1]))];
        for (const [versionCode, expected] of [[config.versionCode, 'idle'], [1, 'available']]) {
            const page = await browser.newPage();
            page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
            const requests = [];
            await page.route('**/*', async route => {
                if (route.request().url() === 'https://solarless-update.test/') {
                    await route.fulfill({ contentType: 'text/html', body: ids.map(id => `<div id="${id}"></div>`).join('') });
                    return;
                }
                const response = await fetch(route.request().url(), { headers: { Accept: 'application/json' } });
                const body = Buffer.from(await response.arrayBuffer());
                requests.push({ url: route.request().url(), status: response.status, bytes: body.length });
                await route.fulfill({ status: response.status, body,
                    contentType: response.headers.get('content-type') || 'application/octet-stream' });
            });
            await page.goto('https://solarless-update.test/');
            await page.evaluate(installed => {
                window.Capacitor = { isNativePlatform: () => true, Plugins: { AppUpdate: {
                    getInstalledInfo: async () => installed
                } } };
            }, { ...config, versionCode, sdkInt: 34 });
            await page.addScriptTag({ path: 'js/app-version.js' });
            await page.addScriptTag({ content: source });
            await page.evaluate(async () => {
                const updater = SolarlessUpdater.create({ language: () => 'en', isDriving: () => false });
                await updater.check(true);
            });
            const result = await page.evaluate(() => ({
                state: document.getElementById('update-modal').dataset.updateState,
                message: document.getElementById('update-status').textContent
            }));
            console.log(JSON.stringify({ simulatedInstalledCode: versionCode, ...result, requests }, null, 2));
            assert.equal(result.state, expected);
            await page.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
