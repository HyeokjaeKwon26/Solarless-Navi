import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'node_modules', 'maplibre-gl', 'package.json'), 'utf8'));
const version = packageJson.version;
const dist = path.join(root, 'node_modules', 'maplibre-gl', 'dist');

await Promise.all([
    mkdir(path.join(root, 'js'), { recursive: true }),
    mkdir(path.join(root, 'css'), { recursive: true }),
    mkdir(path.join(root, 'licenses'), { recursive: true }),
    mkdir(path.join(root, 'www', 'js'), { recursive: true }),
    mkdir(path.join(root, 'www', 'css'), { recursive: true }),
    mkdir(path.join(root, 'www', 'licenses'), { recursive: true })
]);

// MapLibre 6 publishes ESM modules only. Bundle the main module to the legacy
// global expected by the Leaflet bridge, while retaining the upstream module
// worker as a separate local asset configured by map-provider.js.
await build({
    entryPoints: [path.join(dist, 'maplibre-gl.mjs')],
    outfile: path.join(root, 'js', 'maplibre-gl.js'),
    bundle: true,
    format: 'iife',
    globalName: 'maplibregl',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    sourcemap: false,
    legalComments: 'eof',
    banner: { js: `/*! MapLibre GL JS ${version} | BSD-3-Clause | locally bundled */` }
});

const rootAssets = [
    [path.join(dist, 'maplibre-gl.css'), path.join(root, 'css', 'maplibre-gl.css')],
    [path.join(dist, 'maplibre-gl-worker.mjs'), path.join(root, 'js', 'maplibre-gl-worker.mjs')],
    [path.join(dist, 'maplibre-gl-shared.mjs'), path.join(root, 'js', 'maplibre-gl-shared.mjs')],
    [path.join(root, 'node_modules', 'maplibre-gl', 'LICENSE.txt'), path.join(root, 'licenses', 'maplibre-gl-LICENSE.txt')]
];
for (const [source, destination] of rootAssets) await copyFile(source, destination);

const mirrorAssets = [
    ['js/maplibre-gl.js', 'www/js/maplibre-gl.js'],
    ['js/maplibre-gl-worker.mjs', 'www/js/maplibre-gl-worker.mjs'],
    ['js/maplibre-gl-shared.mjs', 'www/js/maplibre-gl-shared.mjs'],
    ['css/maplibre-gl.css', 'www/css/maplibre-gl.css'],
    ['licenses/maplibre-gl-LICENSE.txt', 'www/licenses/maplibre-gl-LICENSE.txt']
];
for (const [source, destination] of mirrorAssets) {
    await copyFile(path.join(root, source), path.join(root, destination));
}

console.log(`Vendored MapLibre GL JS ${version} with local module worker assets.`);
