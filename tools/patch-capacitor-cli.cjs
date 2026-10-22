// Capacitor 6 imports tar's removed default export. Keep the native runtime
// on its patched 6.x line while using the security-maintained tar 7 package.
// Fail closed if an upstream CLI update changes the code this patch expects.
const fs = require('node:fs');
const path = require('node:path');
let cliPackage;
try {
    cliPackage = require.resolve('@capacitor/cli/package.json');
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    // Production-only installs omit the CLI and need no build-tool patch.
    console.log('Capacitor CLI is not installed; skipping its development-only patch.');
    process.exit(0);
}
const { version } = JSON.parse(fs.readFileSync(cliPackage, 'utf8'));
if (version !== '6.2.2') throw new Error(`Review the tar compatibility patch for Capacitor CLI ${version}`);
const target = path.join(path.dirname(cliPackage), 'dist/util/template.js');
const original = fs.readFileSync(target, 'utf8');
const replacements = [
    ['const tar_1 = tslib_1.__importDefault(require("tar"));', 'const tar_1 = require("tar");'],
    ['await tar_1.default.extract({ file: src, cwd: dir });', 'await tar_1.extract({ file: src, cwd: dir });']
];
let patched = original;
for (const [before, after] of replacements) {
    if (patched.includes(before)) patched = patched.replace(before, after);
    else if (!patched.includes(after)) throw new Error(`Unexpected Capacitor template extractor: ${target}`);
}
if (patched !== original) fs.writeFileSync(target, patched);
console.log('Capacitor CLI tar 7 compatibility patch verified.');
