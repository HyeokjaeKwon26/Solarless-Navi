const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('patched Capacitor CLI extracts its real Android plugin template with tar 7', async () => {
    const cliRoot = path.dirname(require.resolve('@capacitor/cli/package.json'));
    const { extractTemplate } = require(path.join(cliRoot, 'dist/util/template.js'));
    const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'solarless-cap-template-'));
    try {
        await extractTemplate(path.join(cliRoot, 'assets/capacitor-cordova-android-plugins.tar.gz'), destination);
        const gradle = await fs.readFile(path.join(destination, 'build.gradle'), 'utf8');
        assert.match(gradle, /com.android.library/);
        assert.ok((await fs.stat(path.join(destination, 'src/main/AndroidManifest.xml'))).isFile());
    } finally {
        await fs.rm(destination, { recursive: true, force: true });
    }
});
