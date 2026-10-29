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

test('MapLibre 6 probes WebGL2 without the removed supported helper and releases the probe',()=>{
    const before=global.document;let lost=0;
    try{
        global.document={createElement:()=>({getContext:type=>{assert.equal(type,'webgl2');return {getExtension:()=>({loseContext:()=>lost++})};}})};
        assert.equal(provider.canUseVectorMap({Map:function(){}},leafletStub()),true);assert.equal(lost,1);
        global.document={createElement:()=>({getContext:()=>null})};
        assert.equal(provider.canUseVectorMap({Map:function(){}},leafletStub()),false);
    }finally{if(before===undefined)delete global.document;else global.document=before;}
});

test('attribution follows the visible provider', () => {
    assert.match(provider.attributionFor({ vectorSupported: true }), /OpenFreeMap/);
    assert.match(provider.attributionFor({ vectorSupported: true }), /OpenMapTiles/);
    assert.doesNotMatch(provider.attributionFor({ fallbackActive: true }), /OpenFreeMap/);
    assert.match(provider.attributionFor({ satellite: true }), /Esri/);
});

test('removed or replaced vector layers cannot run stale resize frames or move callbacks',()=>{
    let frames=[],cancelled=[],moves=[],resized=0,jumped=0,ended=0;
    const leaflet={Util:{requestAnimFrame:fn=>(frames.push(fn),frames.length),cancelAnimFrame:id=>cancelled.push(id)},DomUtil:{setTransform(){}}};
    const map={getZoom:()=>17,getCenter:()=>[0,0],getBounds:()=>({getNorthWest:()=>[0,0]}),latLngToContainerPoint:()=>[0,0]};
    const makeGl=()=>({_actualCanvas:{},once:(event,fn)=>moves.push(fn),jumpTo:()=>jumped++});
    const layer={_transitionEnd(){},onAdd(m){this._map=m;this._glMap=makeGl();},onRemove(){this._map=null;this._glMap=null;},_resizeContainer(){resized++;},_zoomEnd(){ended++;}};
    provider.guardVectorLayer(layer,leaflet);layer.onAdd(map);
    layer._transitionEnd();layer.onRemove();frames[0]();
    assert.deepEqual(cancelled,[1]);assert.equal(resized,0);
    layer.onAdd(map);layer._transitionEnd();frames[1]();assert.equal(jumped,1);
    layer.onRemove();layer.onAdd(map);moves[0]();assert.equal(ended,0);
    layer._transitionEnd();frames[2]();moves[1]();assert.equal(ended,1);
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
