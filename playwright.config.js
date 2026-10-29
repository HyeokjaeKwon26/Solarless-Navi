const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/browser',
    timeout: 30000,
    // Root and packaged-www projects use isolated browser contexts and read-only
    // fixtures. CI can check them concurrently; local WebGL debugging stays serial.
    workers: process.env.CI ? 2 : 1,
    forbidOnly: !!process.env.CI,
    retries: 0,
    use: {
        browserName: 'chromium',
        viewport: { width: 412, height: 915 },
        locale: 'en-US',
        timezoneId: 'UTC',
        permissions: ['geolocation'],
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    },
    projects: [
        { name: 'root', use: { baseURL: 'http://127.0.0.1:8087/' } },
        { name: 'www', use: { baseURL: 'http://127.0.0.1:8087/www/' } }
    ],
    webServer: {
        command: 'node node_modules/serve/build/main.js -l tcp://127.0.0.1:8087 --no-clipboard',
        url: 'http://127.0.0.1:8087',
        reuseExistingServer: false
    }
});
