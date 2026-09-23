const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const provider = require(path.join(__dirname, '..', 'js', 'map-provider.js'));

function leafletStub() {
    const calls = { raster: [], vector: [] };
    return {
        calls,
        tileLayer(url, options) {
            const layer = { kind: 'raster', url, options };
            calls.raster.push(layer);
            return layer;
        },
        maplibreGL(options) {
            const layer = { kind: 'vector', options };
            calls.vector.push(layer);
            return layer;
        }
    };
}

test('OpenFreeMap vector is primary and OSM raster remains a no-key fallback', () => {
    const leaflet = leafletStub();
    let workerUrl = '';
    const maplibregl = {
        supported: () => true,
        getWorkerUrl: () => workerUrl,
        setWorkerUrl: value => { workerUrl = value; }
    };
    const layers = provider.createRoadLayers(leaflet, maplibregl);

    assert.equal(layers.vectorSupported, true);
    assert.equal(layers.primary.light.kind, 'vector');
    assert.equal(layers.primary.light.options.style, 'https://tiles.openfreemap.org/styles/liberty');
    assert.equal(layers.primary.dark.options.style, 'https://tiles.openfreemap.org/styles/dark');
    assert.equal(layers.fallback.light.url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    assert.equal(layers.fallback.dark.options.className, 'osm-fallback-dark');
    assert.deepEqual(layers.primary.light.options.maxCanvasSize, [4096, 4096]);
    assert.ok(layers.primary.light.options.pixelRatio <= 1.5);
    assert.equal(workerUrl, 'js/maplibre-gl-worker.mjs');
});

test('unsupported WebGL starts directly on OSM without creating vector layers', () => {
    const leaflet = leafletStub();
    const layers = provider.createRoadLayers(leaflet, { supported: () => false });

    assert.equal(layers.vectorSupported, false);
    assert.equal(leaflet.calls.vector.length, 0);
    assert.equal(provider.layerForTheme(layers, 'light', false), layers.fallback.light);
    assert.equal(provider.layerForTheme(layers, 'dark', true), layers.fallback.dark);
});

test('provider detection handles missing and throwing WebGL implementations', () => {
    const leaflet = leafletStub();
    assert.equal(provider.canUseVectorMap(null, leaflet), false);
    assert.equal(provider.canUseVectorMap({ supported() { throw new Error('blocked'); } }, leaflet), false);
    assert.equal(provider.canUseVectorMap({ supported: () => true }, {}), false);
});

test('attribution follows the visible provider', () => {
    assert.match(provider.attributionFor({ vectorSupported: true }), /OpenFreeMap/);
    assert.match(provider.attributionFor({ vectorSupported: true }), /OpenMapTiles/);
    assert.doesNotMatch(provider.attributionFor({ fallbackActive: true }), /OpenFreeMap/);
    assert.match(provider.attributionFor({ satellite: true }), /Esri/);
});

test('browser bundles and third-party licenses are packaged locally', () => {
    const root = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(html, /js\/maplibre-gl\.js/);
    assert.match(html, /js\/leaflet-maplibre-gl\.js/);
    assert.match(html, /css\/maplibre-gl\.css/);
    assert.ok(fs.existsSync(path.join(root, 'licenses', 'maplibre-gl-LICENSE.txt')));
    assert.ok(fs.existsSync(path.join(root, 'www', 'licenses', 'maplibre-gl-LICENSE.txt')));
    assert.ok(fs.existsSync(path.join(root, 'js', 'maplibre-gl-worker.mjs')));
    assert.ok(fs.existsSync(path.join(root, 'js', 'maplibre-gl-shared.mjs')));
    assert.ok(fs.existsSync(path.join(root, 'www', 'js', 'maplibre-gl-worker.mjs')));

    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const maplibreVersion = packageJson.dependencies['maplibre-gl'].replace(/^[^0-9]*/, '');
    const [major, minor, patch] = maplibreVersion.split('.').map(Number);
    assert.ok(major > 6 || (major === 6 && (minor > 4 || (minor === 4 && patch >= 1))),
        `MapLibre ${maplibreVersion} must include the GHSA-jrc7-96c5-q579 patch`);
    const browserBundle = fs.readFileSync(path.join(root, 'js', 'maplibre-gl.js'), 'utf8');
    assert.ok(browserBundle.includes(`MapLibre GL JS ${maplibreVersion}`));

    const buildScript = fs.readFileSync(path.join(root, 'build_apk.bat'), 'utf8');
    assert.match(buildScript, /LICENSES_DIR/);
    assert.match(buildScript, /PUBLIC_DIR%\\licenses/);
});
