const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const sandbox = {
    console,
    Math,
    Date,
    Number,
    String,
    Array,
    Object,
    JSON,
    Map,
    Set,
    Float64Array,
    Promise,
    AbortController,
    fflate: require('fflate'),
    setTimeout,
    clearTimeout,
    isFinite,
    fetch: () => Promise.reject(new Error('network is not used in unit tests')),
    Worker: undefined
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

for (const file of ['js/suncalc.js', 'js/route-state.js', 'js/scene-shadow.js', 'js/shadow-router.js', 'js/geocoder.js', 'js/offline-map.js', 'js/app-version.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const ShadowRouter = sandbox.ShadowRouter;
const OfflineMap = sandbox.OfflineMap;
const SceneShadow = sandbox.SceneShadow;
const RouteState = sandbox.RouteState;
const Geocoder = sandbox.Geocoder;
const VersionUtils = sandbox.SolarlessVersionUtils;

function runSolarWorkerMessage(data, importAvailable = true) {
    const messages = [];
    const workerSandbox = {
        console,
        Math,
        Date,
        Number,
        String,
        Array,
        Object,
        JSON,
        Map,
        Set,
        Float64Array,
        Promise,
        AbortController,
        setTimeout,
        clearTimeout,
        isFinite,
        self: null,
        postMessage: message => messages.push(message),
        importScripts: file => {
            if (!importAvailable) throw new Error('scene module unavailable');
            vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), workerSandbox, { filename: file });
        }
    };
    workerSandbox.self = workerSandbox;
    vm.createContext(workerSandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/solar-worker.js'), 'utf8'), workerSandbox, { filename: 'js/solar-worker.js' });
    workerSandbox.self.onmessage({ data });
    assert.equal(messages.length, 1);
    return messages[0].result;
}

function suppressExpectedWarnings(task) {
    const originalWarn = console.warn;
    console.warn = () => {};
    return Promise.resolve().then(task).finally(() => { console.warn = originalWarn; });
}

function createMemoryIndexedDb() {
    const stores = new Map();
    const makeStore = name => {
        if (!stores.has(name)) stores.set(name, new Map());
        const values = stores.get(name);
        const request = result => {
            const value = {};
            queueMicrotask(() => { value.result = result(); if (value.onsuccess) value.onsuccess(); });
            return value;
        };
        return {
            indexNames: { contains: () => false },
            createIndex: () => {},
            put: (value, key) => values.set(key, structuredClone(value)),
            get: key => request(() => values.has(key) ? structuredClone(values.get(key)) : undefined),
            getAll: () => request(() => [...values.values()].map(value => structuredClone(value))),
            getAllKeys: () => request(() => [...values.keys()]),
            delete: key => values.delete(key)
        };
    };
    const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore: makeStore,
        transaction(name) {
            const transaction = { objectStore: () => makeStore(name) };
            setTimeout(() => { if (transaction.oncomplete) transaction.oncomplete(); }, 0);
            return transaction;
        }
    };
    return {
        open() {
            const request = { result: db, transaction: { objectStore: makeStore } };
            queueMicrotask(() => {
                if (request.onupgradeneeded) request.onupgradeneeded();
                if (request.onsuccess) request.onsuccess();
            });
            return request;
        }
    };
}

test('distance and bearing calculations handle normal and invalid inputs', () => {
    assert.equal(ShadowRouter.calculateDistanceMeters(0, 0, 0, 0), 0);
    assert.ok(Math.abs(ShadowRouter.calculateDistanceMeters(0, 0, 0, 1) - 111194.9) < 200);
    assert.ok(Math.abs(ShadowRouter.calculateBearing(0, 0, 1, 0) - 0) < 1e-9);
    assert.ok(Math.abs(ShadowRouter.calculateBearing(0, 0, 0, 1) - 90) < 1e-9);
    assert.equal(ShadowRouter.calculateDistanceMeters(NaN, 0, 0, 0), 0);
    assert.equal(ShadowRouter.calculateBearing(undefined, 0, 0, 0), 0);
});

test('solar intensity handles daylight, twilight, night, and invalid altitude', () => {
    assert.ok(ShadowRouter.calculateSolarUvIntensity(45) > 0);
    assert.ok(ShadowRouter.calculateSolarUvIntensity(-1) > 0);
    assert.equal(ShadowRouter.calculateSolarUvIntensity(-7), 0);
    assert.equal(ShadowRouter.calculateSolarUvIntensity(NaN), 0);
    assert.equal(ShadowRouter.calculateSolarUvIntensity(null), 0);
});

test('glare risk respects invalid, night, high-angle, and angular boundaries', () => {
    assert.equal(ShadowRouter.calculateSegmentGlare(NaN, { altitude: 10, azimuth: 0 }), 0);
    assert.equal(ShadowRouter.calculateSegmentGlare(0, { altitude: -1, azimuth: 0 }), 0);
    assert.ok(ShadowRouter.calculateSegmentGlare(0, { altitude: 5, azimuth: 0 }) > 0);
    assert.ok(ShadowRouter.calculateSegmentGlare(0, { altitude: 60, azimuth: 0 }) > 0);
    assert.equal(ShadowRouter.calculateSegmentGlare(45, { altitude: 5, azimuth: 0 }), 0);
});

test('offline route fallback never returns a synthetic navigation route', () => {
    assert.equal(OfflineMap.canCalculateRouteOffline(), false);
    assert.equal(OfflineMap.generateStandaloneRoute({ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, new Date()), null);
});

test('APK update checks ignore scene releases and compare SemVer without parseFloat', () => {
    assert.equal(VersionUtils.compareSemver('v1.10.0', '1.9.9') > 0, true);
    assert.equal(VersionUtils.compareSemver('app-v1.0', '1.0.0'), 0);
    assert.equal(VersionUtils.isApkRelease({ tag_name: 'scene-us-west-hybrid-v1', assets: [] }), false);
    assert.equal(VersionUtils.isApkRelease({ tag_name: 'scene-data', assets: [{ name: 'SolarLessNavi.apk' }] }), true);
});

test('scene projection and polygon ray intersection are deterministic', () => {
    const origin = { lat: 37.5, lng: 127.0 };
    const local = SceneShadow.projectPoint(37.5, 127.001, origin);
    assert.ok(local.x > 80 && local.x < 100);
    assert.ok(Math.abs(local.y) < 0.001);

    const square = [{ x: 20, y: -10 }, { x: 40, y: -10 }, { x: 40, y: 10 }, { x: 20, y: 10 }];
    assert.equal(SceneShadow.pointInPolygon({ x: 30, y: 0 }, square), true);
    assert.equal(SceneShadow.intersectRayWithPolygon({ x: 0, y: 0 }, { x: 1, y: 0 }, square), 20);
    assert.equal(SceneShadow.intersectRayWithPolygon({ x: 0, y: 30 }, { x: 1, y: 0 }, square), null);
});

test('terrain grid preserves exact nearest-sample results without retaining full building geometry', () => {
    const samples = [];
    for (let x = -1000; x <= 1000; x += 50) {
        for (let y = -1000; y <= 1000; y += 50) samples.push({ x, y, elevation: 100 + (x + y) / 1000 });
    }
    const grid = SceneShadow.buildTerrainGrid(samples, 200);
    for (const point of [{ x: 17, y: 29 }, { x: 851, y: -733 }, { x: -999, y: 998 }]) {
        const linear = SceneShadow.findNearestTerrainSample(point, samples, Infinity);
        const indexed = SceneShadow.findNearestTerrainSample(point, samples, Infinity, grid);
        assert.equal(indexed.sample, linear.sample);
        assert.equal(indexed.distance, linear.distance);
    }
    assert.ok(Object.keys(grid.cells).length < samples.length);
});

test('building spatial index keeps ray occlusion parity', () => {
    const buildings = Array.from({ length: 500 }, (_, index) => ({
        polygon: [{ x: 1000 + index * 20, y: 1000 }, { x: 1010 + index * 20, y: 1000 }, { x: 1010 + index * 20, y: 1010 }, { x: 1000 + index * 20, y: 1010 }],
        bounds: { minX: 1000 + index * 20, maxX: 1010 + index * 20, minY: 1000, maxY: 1010 },
        height: 10,
        ground: 0
    }));
    buildings.push({
        polygon: [{ x: 30, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: 30, y: 10 }],
        bounds: { minX: 30, maxX: 60, minY: -10, maxY: 10 }, height: 30, ground: 0
    });
    const base = {
        origin: { lat: 0, lng: 0 }, coverage: { buildings: true, terrain: false, tunnels: false },
        buildings, tunnels: [], terrainSamples: [], terrainProfiles: []
    };
    const sun = { altitude: 10, azimuth: 90 };
    const linear = SceneShadow.getSegmentOcclusion([0, 0], [0.00001, 0], sun, base, 0);
    const indexed = SceneShadow.getSegmentOcclusion([0, 0], [0.00001, 0], sun, { ...base, buildingGrid: SceneShadow.buildBuildingGrid(buildings) }, 0);
    assert.deepEqual(indexed, linear);
});

test('terrain ray obstruction respects night, invalid data, and horizon tolerance', () => {
    assert.equal(SceneShadow.isTerrainRayOccluded(100, -1, [100, 200], [130, 160]), false);
    assert.equal(SceneShadow.isTerrainRayOccluded(100, 10, [100, 200], [130, 160]), true);
    assert.equal(SceneShadow.isTerrainRayOccluded(100, 10, [100], [101]), false);
    assert.equal(SceneShadow.isTerrainRayOccluded(NaN, 10, [100], [300]), false);
});

test('scene occlusion reports building and tunnel sources without fabricating geometry', () => {
    const scene = {
        origin: { lat: 0, lng: 0 },
        coverage: { buildings: true, terrain: false, tunnels: true },
        buildings: [{
            polygon: [{ x: 30, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: 30, y: 10 }],
            bounds: { minX: 30, maxX: 60, minY: -10, maxY: 10 },
            height: 30,
            ground: 0
        }],
        tunnels: [{ line: [{ x: -10, y: 0 }, { x: 10, y: 0 }] }],
        terrainSamples: [],
        terrainProfiles: []
    };
    const blocked = SceneShadow.getSegmentOcclusion([0, 0], [0.00001, 0], { altitude: 10, azimuth: 90 }, scene, 0);
    assert.equal(blocked.source, 'tunnel');
    const buildingScene = { ...scene, tunnels: [] };
    const buildingBlocked = SceneShadow.getSegmentOcclusion([0, 0], [0.00001, 0], { altitude: 10, azimuth: 90 }, buildingScene, 0);
    assert.equal(buildingBlocked.source, 'building');
});

test('scene coverage falls back to heuristics for uncovered route segments', () => {
    const scene = {
        origin: { lat: 0, lng: 0 },
        coverage: { buildings: true, terrain: false, tunnels: false },
        segmentCoverage: [{ buildings: true, terrain: false, tunnels: false }, { buildings: false, terrain: false, tunnels: false }],
        buildings: [{
            polygon: [{ x: 30, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: 30, y: 10 }],
            bounds: { minX: 30, maxX: 60, minY: -10, maxY: 10 },
            height: 30,
            ground: 0
        }],
        tunnels: [],
        terrainSamples: [],
        terrainProfiles: []
    };
    const sun = { altitude: 10, azimuth: 90 };
    assert.equal(SceneShadow.getSegmentOcclusion([0, 0], [0.00001, 0], sun, scene, 0).source, 'building');
    assert.equal(SceneShadow.getSegmentOcclusion([0, 0], [0.00001, 0], sun, scene, 1).source, 'heuristic');
});

test('precomputed scene packs are loaded once, cached, and produce a precision scene', async () => {
    const originalFetch = sandbox.fetch;
    const originalIndexedDb = sandbox.indexedDB;
    sandbox.indexedDB = createMemoryIndexedDb();
    const manifestUrl = 'https://example.test/scene-us-northeast/manifest.json';
    const tileNames = [];
    const tileMap = {};
    for (let x = -1; x <= 1; x++) {
        for (let y = -1; y <= 1; y++) {
            const key = `${x}:${y}`;
            const file = `${x}_${y}.json`;
            tileNames.push(file);
            tileMap[key] = { pack: 'pilot', file };
        }
    }
    const terrain = [];
    for (let lat = 40.98; lat <= 41.06; lat += 0.0009) {
        for (let lng = -74.02; lng <= -73.92; lng += 0.0011) terrain.push([Number(lat.toFixed(6)), Number(lng.toFixed(6)), 20]);
    }
    const tilePayload = { schema: 1, buildings: [], tunnels: [], terrain };
    const files = {};
    for (const file of tileNames) files[file] = require('fflate').strToU8(JSON.stringify(tilePayload));
    // This entry is intentionally invalid JSON. Selective extraction must not
    // inflate or parse an unrequested file that merely shares the same pack.
    files['unused-invalid.json'] = require('fflate').strToU8('{invalid');
    const zipBytes = require('fflate').zipSync(files, { level: 6 });
    const manifest = {
        schema: 2,
        region: 'US-NORTHEAST',
        releaseTag: 'pilot',
        baseUrl: 'https://example.test/scene-us-northeast',
        tileSizeM: 5000,
        tilePaddingMeters: 4500,
        terrainSpacingM: 100,
        grid: { latOrigin: 41, lngOrigin: -74, cosLat: Math.cos(42 * Math.PI / 180) },
        packs: { pilot: { path: 'pilot.zip', bytes: zipBytes.length, tiles: tileNames.length } },
        tiles: tileMap
    };
    let fetchCount = 0;
    let packFetchAttempts = 0;
    sandbox.fetch = async url => {
        fetchCount++;
        if (String(url) === manifestUrl) return { ok: true, status: 200, json: async () => manifest };
        packFetchAttempts++;
        if (packFetchAttempts === 1) throw new Error('temporary mobile network failure');
        return { ok: true, status: 200, arrayBuffer: async () => zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) };
    };
    try {
        SceneShadow.clearCaches();
        const coordinates = [[-73.970, 41.022], [-73.969, 41.023]];
        const options = {
            precomputedManifestUrl: manifestUrl,
            precomputedRegionBounds: { south: 40, west: -75, north: 43, east: -69 },
            dateObj: new Date('2026-08-09T12:00:00Z'),
            durationSec: 600
        };
        const first = await SceneShadow.fetchPrecomputedSceneForRoute(coordinates, options);
        assert.equal(first.source, 'GitHub precomputed US-NORTHEAST scene tiles');
        assert.equal(first.precisionReady, true);
        assert.ok(first.tileKeys.length >= 1 && first.tileKeys.length <= 4,
            'sun-ray selection should avoid the old unconditional 3x3 download');
        assert.equal(Object.hasOwn(first, 'allBuildings'), false);
        assert.equal(SceneShadow.getCacheStats().precomputedParsedEntries, 0);
        assert.ok(SceneShadow.getCacheStats().precomputedMaxBytes <= 12 * 1024 * 1024);
        assert.ok(SceneShadow.getCacheStats().precomputedPersistentMaxBytes > SceneShadow.getCacheStats().precomputedMaxBytes);
        assert.equal(packFetchAttempts, 2, 'a failed pack download is retried exactly once');
        const countAfterFirst = fetchCount;
        SceneShadow.clearPrecomputedMemoryCache();
        const second = await SceneShadow.fetchPrecomputedSceneForRoute(coordinates, options);
        assert.equal(second.precisionReady, true);
        assert.equal(fetchCount, countAfterFirst);
    } finally {
        sandbox.fetch = originalFetch;
        sandbox.indexedDB = originalIndexedDb;
        SceneShadow.clearCaches();
    }
});

test('an irrelevant padded tile is not downloaded or counted as missing coverage', async () => {
    const originalFetch = sandbox.fetch;
    const manifestUrl = 'https://example.test/partial/manifest.json';
    const terrain = [];
    for (let lat = 40.98; lat <= 41.06; lat += 0.0009) {
        for (let lng = -74.02; lng <= -73.92; lng += 0.0011) terrain.push([Number(lat.toFixed(6)), Number(lng.toFixed(6)), 20]);
    }
    const tilePayload = { schema: 1, buildings: [], tunnels: [], terrain };
    const files = {};
    const tiles = {};
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
        if (x === 1 && y === 1) continue;
        const key = `${x}:${y}`;
        const file = `${x}_${y}.json`;
        files[file] = require('fflate').strToU8(JSON.stringify(tilePayload));
        tiles[key] = { pack: 'partial', file };
    }
    const zipBytes = require('fflate').zipSync(files, { level: 6 });
    const manifest = {
        schema: 2, region: 'PARTIAL', releaseTag: 'partial', baseUrl: 'https://example.test/partial',
        tileSizeM: 5000, tilePaddingMeters: 4500, terrainSpacingM: 100,
        grid: { latOrigin: 41, lngOrigin: -74, cosLat: Math.cos(42 * Math.PI / 180) },
        packs: { partial: { path: 'partial.zip', bytes: zipBytes.length } }, tiles
    };
    sandbox.fetch = async url => String(url) === manifestUrl
        ? { ok: true, status: 200, headers: { get: () => null }, json: async () => manifest }
        : { ok: true, status: 200, arrayBuffer: async () => zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength) };
    try {
        SceneShadow.clearCaches();
        const scene = await SceneShadow.fetchPrecomputedSceneForRoute(
            [[-73.999, 41.001], [-73.9985, 41.0015]],
            { precomputedManifestUrl: manifestUrl, precomputedRegionBounds: { south: 40, west: -75, north: 43, east: -69 }, dateObj: new Date('2026-06-21T12:00:00Z'), durationSec: 60 }
        );
        assert.ok(scene);
        assert.equal(scene.precisionReady, true);
        assert.notEqual(scene.partial, true);
        assert.equal(scene.coverage.missingTiles, 0,
            'a missing tile outside the centreline/sun-ray corridor is irrelevant');
        assert.ok(scene.coverage.coveredSegments > 0);
        const analyzed = ShadowRouter.analyzeRouteSegments(
            [[-73.999, 41.001], [-73.9985, 41.0015]], new Date('2026-06-21T12:00:00Z'), 60, null, scene
        );
        assert.equal(analyzed.analysisMode, 'scene');
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.clearCaches();
    }
});

test('precision sampling never exceeds the original OSRM point count', () => {
    const coordinates = Array.from({ length: 80 }, (_, index) => [index * 0.01, Math.sin(index / 5) * 0.001]);
    const sampling = ShadowRouter.buildPrecisionAnalysisGeometry({ geometry: { coordinates }, legs: [{ steps: [] }] });
    assert.ok(sampling.analysisCoordinateCount <= coordinates.length);
    assert.ok(sampling.analysisCoordinateCount <= 800);
    assert.deepEqual(Array.from(sampling.coordinates[0]), coordinates[0]);
    assert.deepEqual(Array.from(sampling.coordinates.at(-1)), coordinates.at(-1));
});

test('fully astronomical-night routes skip scene network work', async () => {
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    let calls = 0;
    SceneShadow.fetchPrecomputedSceneForRoute = async () => { calls++; return null; };
    SceneShadow.fetchSceneForRoute = async () => { calls++; return null; };
    try {
        const raw = { distance: 1000, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0]] }, legs: [{ steps: [] }] };
        const result = await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, new Date('2026-06-21T00:00:00Z'), false,
            { candidates: [raw], preferredRouteRole: 'shade' }
        );
        assert.equal(calls, 0);
        assert.equal(result.routes.fastest.isNight, true);
    } finally {
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
    }
});

test('boundary-crossing routes merge two regional releases with aligned profiles', async () => {
    const originalFetch = sandbox.fetch;
    const coordinates = [[-0.012, 0], [-0.004, 0], [0.004, 0], [0.012, 0]];
    const terrain = [];
    for (let lat = -0.05; lat <= 0.05; lat += 0.001) {
        for (let lng = -0.08; lng <= 0.08; lng += 0.001) terrain.push([Number(lat.toFixed(5)), Number(lng.toFixed(5)), 15]);
    }
    function makeRegion(id, bounds) {
        const files = {};
        const tiles = {};
        for (let x = -3; x <= 2; x++) for (let y = -2; y <= 1; y++) {
            const key = `${x}:${y}`;
            const file = `${id}-${x}_${y}.json`;
            files[file] = require('fflate').strToU8(JSON.stringify({ schema: 1, buildings: [], tunnels: [], terrain }));
            tiles[key] = { pack: id, file };
        }
        const zip = require('fflate').zipSync(files, { level: 1 });
        return {
            id, url: `https://example.test/${id}/manifest.json`, bounds, zip,
            manifest: {
                schema: 2, region: id, releaseTag: id, baseUrl: `https://example.test/${id}`,
                tileSizeM: 5000, tilePaddingMeters: 4500, terrainSpacingM: 100,
                grid: { latOrigin: 0, lngOrigin: 0, cosLat: 1 },
                packs: { [id]: { path: `${id}.zip`, bytes: zip.length } }, tiles
            }
        };
    }
    const west = makeRegion('west-test', { south: -1, west: -1, north: 1, east: 0 });
    const east = makeRegion('east-test', { south: -1, west: 0, north: 1, east: 1 });
    const regions = [west, east];
    const fetches = [];
    sandbox.fetch = async url => {
        fetches.push(String(url));
        const region = regions.find(item => String(url).includes(`/${item.id}/`));
        if (!region) throw new Error(`unexpected regional URL ${url}`);
        if (String(url).endsWith('manifest.json')) return { ok: true, status: 200, headers: { get: () => null }, json: async () => region.manifest };
        return { ok: true, status: 200, arrayBuffer: async () => region.zip.buffer.slice(region.zip.byteOffset, region.zip.byteOffset + region.zip.byteLength) };
    };
    try {
        SceneShadow.clearCaches();
        const scene = await SceneShadow.fetchPrecomputedSceneForRoute(coordinates, {
            precomputedRegions: regions.map(({ id, url, bounds }) => ({ id, url, bounds })),
            dateObj: new Date('2026-06-21T12:00:00Z'), durationSec: 180
        });
        assert.ok(scene);
        assert.deepEqual(Array.from(scene.sceneCoverage.regions).sort(), ['east-test', 'west-test']);
        assert.equal(scene.segmentCoverage.length, coordinates.length - 1);
        assert.ok(scene.terrainProfiles.some(profile => profile.coordinateIndex <= 1));
        assert.ok(scene.terrainProfiles.some(profile => profile.coordinateIndex >= 2));
        assert.ok(fetches.some(url => url.includes('/west-test/')));
        assert.ok(fetches.some(url => url.includes('/east-test/')));
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.clearCaches();
    }
});

test('scene pack worker inflates and parses only requested JSON entries', () => {
    const valid = require('fflate').strToU8(JSON.stringify({ id: 'wanted' }));
    const invalid = require('fflate').strToU8('{not-json');
    const zip = require('fflate').zipSync({ 'wanted.json': valid, 'unused.json': invalid });
    const messages = [];
    const workerSandbox = {
        self: null,
        Uint8Array,
        Set,
        String,
        Object,
        fflate: require('fflate'),
        importScripts: () => {},
        postMessage: message => messages.push(message)
    };
    workerSandbox.self = workerSandbox;
    vm.createContext(workerSandbox);
    vm.runInContext(fs.readFileSync(path.join(root, 'js/scene-pack-worker.js'), 'utf8'), workerSandbox);
    const buffer = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
    workerSandbox.self.onmessage({ data: { buffer, fileNames: ['wanted.json'] } });
    assert.equal(messages.length, 1);
    assert.equal(JSON.parse(messages[0].files['wanted.json']).id, 'wanted');
    assert.equal(Object.hasOwn(messages[0].files, 'unused.json'), false);
    assert.equal(messages[0].sizes['wanted.json'], valid.byteLength);
});

test('solar worker handles heuristic and precision scene messages without scope errors', () => {
    const coordinates = [[127, 37], [127.001, 37]];
    const base = {
        id: 'worker-test',
        coordinates,
        startTimestamp: 0,
        durationSec: 100,
        timeLookup: [0, 100]
    };
    const heuristic = runSolarWorkerMessage(base);
    assert.equal(heuristic.analysisMode, 'heuristic');
    assert.equal(heuristic.sceneSource, 'heuristic fallback');
    assert.ok(Number.isFinite(heuristic.avgGlareRisk));
    assert.ok(Number.isFinite(heuristic.avgShadeCoverage));
    assert.ok(Number.isFinite(heuristic.totalUvExposureUnits));

    const scene = {
        precisionReady: true,
        source: 'mock scene',
        origin: { lat: 37, lng: 127 },
        coverage: { buildings: true, terrain: true, tunnels: true },
        segmentCoverage: [{ buildings: true, terrain: true, tunnels: true }],
        buildings: [],
        tunnels: [],
        terrainSamples: [],
        terrainProfiles: []
    };
    const workerScene = runSolarWorkerMessage({ ...base, scene });
    const mainScene = ShadowRouter.analyzeRouteSegments(coordinates, new Date(0), 100, null, scene);
    assert.equal(workerScene.analysisMode, 'scene');
    assert.equal(workerScene.sceneSource, 'mock scene');
    assert.ok(Math.abs(workerScene.avgGlareRisk - mainScene.avgGlareRisk) < 1e-12);
    assert.ok(Math.abs(workerScene.avgShadeCoverage - mainScene.avgShadeCoverage) < 1e-12);
    assert.ok(Math.abs(workerScene.totalUvExposureUnits - mainScene.totalUvExposureUnits) < 1e-12);

    const importFailure = runSolarWorkerMessage({ ...base, scene }, false);
    assert.equal(importFailure.analysisMode, 'heuristic');
    assert.equal(importFailure.sceneSource, 'heuristic fallback');
});

test('worker failure resolves immediately and disables repeated worker creation', async () => {
    let constructorCount = 0;
    function FailingWorker() {
        constructorCount++;
        setTimeout(() => {
            if (this.onerror) this.onerror(new Error('mock worker failure'));
        }, 0);
    }
    FailingWorker.prototype.postMessage = () => {};
    FailingWorker.prototype.terminate = () => {};

    const local = { ...sandbox, Worker: FailingWorker };
    local.window = local;
    local.self = local;
    vm.createContext(local);
    for (const file of ['js/suncalc.js', 'js/route-state.js', 'js/scene-shadow.js', 'js/shadow-router.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), local, { filename: file });
    }
    const started = Date.now();
    const results = await suppressExpectedWarnings(async () => {
        const first = await Promise.race([
            local.ShadowRouter.analyzeRouteSegmentsAsync([[127, 37], [127.001, 37]], new Date(0), 100, null),
            new Promise((_, reject) => setTimeout(() => reject(new Error('worker fallback waited too long')), 500))
        ]);
        const second = await local.ShadowRouter.analyzeRouteSegmentsAsync([[127, 37], [127.001, 37]], new Date(0), 100, null);
        const third = await local.ShadowRouter.analyzeRouteSegmentsAsync([[127, 37], [127.001, 37]], new Date(0), 100, null);
        return { first, second, third };
    });
    const { first, second, third } = results;
    assert.equal(first.analysisMode, 'heuristic');
    assert.equal(second.analysisMode, 'heuristic');
    assert.equal(third.analysisMode, 'heuristic');
    assert.ok(Date.now() - started < 500);
    assert.equal(constructorCount, 2);
});

test('silent worker is terminated on timeout and later calls use synchronous fallback', async () => {
    let constructorCount = 0;
    function SilentWorker() { constructorCount++; }
    SilentWorker.prototype.postMessage = () => {};
    SilentWorker.prototype.terminate = function () { this.terminated = true; };
    const local = { ...sandbox, Worker: SilentWorker };
    local.window = local;
    local.self = local;
    vm.createContext(local);
    for (const file of ['js/suncalc.js', 'js/route-state.js', 'js/scene-shadow.js', 'js/shadow-router.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), local, { filename: file });
    }
    const request = () => local.ShadowRouter.analyzeRouteSegmentsAsync(
        [[127, 37], [127.001, 37]], new Date(0), 100, null, null, null, { timeoutMs: 15 }
    );
    const first = await suppressExpectedWarnings(request);
    assert.equal(first.analysisMode, 'heuristic');
    const second = await suppressExpectedWarnings(request);
    assert.equal(second.analysisMode, 'heuristic');
    const started = Date.now();
    const third = await suppressExpectedWarnings(request);
    assert.ok(Date.now() - started < 100, 'worker should stay disabled after restart budget is exhausted');
    assert.equal(third.analysisMode, 'heuristic');
    assert.equal(constructorCount, 2);
});

test('road-rule refresh cadence ignores GPS jitter but refreshes route context changes', () => {
    const distance = (aLat, aLng, bLat, bLng) => Math.abs(bLat - aLat) * 111320 + Math.abs(bLng - aLng) * 90000;
    const config = { distanceMeters: distance, minMoveMeters: 65, headingDelta: 25, maxAgeMs: 30000 };
    const state = { lastPosition: { lat: 37, lng: 127 }, lastFetchAt: 1000, lastSegment: 2, lastHeading: 90, lastRouteKey: 'route-a' };
    assert.equal(RouteState.shouldRefreshRoadRules(2000, state, { lat: 37.0001, lng: 127, segmentIndex: 2, heading: 100, routeKey: 'route-a' }, config), false);
    assert.equal(RouteState.shouldRefreshRoadRules(2000, state, { lat: 37.001, lng: 127, segmentIndex: 2, heading: 90, routeKey: 'route-a' }, config), true);
    assert.equal(RouteState.shouldRefreshRoadRules(2000, state, { lat: 37, lng: 127, segmentIndex: 3, heading: 90, routeKey: 'route-a' }, config), true);
    assert.equal(RouteState.shouldRefreshRoadRules(2000, state, { lat: 37, lng: 127, segmentIndex: 2, heading: 90, routeKey: 'route-b' }, config), true);
    assert.equal(RouteState.shouldRefreshRoadRules(32001, state, { lat: 37, lng: 127, segmentIndex: 2, heading: 90, routeKey: 'route-a' }, config), true);
});

test('silent worker timeout terminates the generation and does not repeat the delay', async () => {
    let constructorCount = 0;
    let lastWorker = null;
    function SilentWorker() { constructorCount++; lastWorker = this; }
    SilentWorker.prototype.postMessage = () => {};
    SilentWorker.prototype.terminate = function () { this.terminated = true; };
    const local = { ...sandbox, Worker: SilentWorker };
    local.window = local;
    local.self = local;
    vm.createContext(local);
    for (const file of ['js/suncalc.js', 'js/route-state.js', 'js/scene-shadow.js', 'js/shadow-router.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), local, { filename: file });
    }
    const coordinates = [[127, 37], [127.001, 37]];
    const results = await suppressExpectedWarnings(async () => ({
        first: await local.ShadowRouter.analyzeRouteSegmentsAsync(coordinates, new Date(0), 100, null, null, null, { timeoutMs: 15 }),
        second: await local.ShadowRouter.analyzeRouteSegmentsAsync(coordinates, new Date(0), 100, null, null, null, { timeoutMs: 15 }),
        third: await local.ShadowRouter.analyzeRouteSegmentsAsync(coordinates, new Date(0), 100, null, null, null, { timeoutMs: 15 })
    }));
    const { first, second, third } = results;
    if (lastWorker && lastWorker.onmessage) lastWorker.onmessage({ data: { id: 1, result: { analysisMode: 'scene' } } });
    assert.equal(first.analysisMode, 'heuristic');
    assert.equal(second.analysisMode, 'heuristic');
    assert.equal(third.analysisMode, 'heuristic');
    assert.equal(constructorCount, 2);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
        local.ShadowRouter.analyzeRouteSegmentsAsync(coordinates, new Date(0), 100, null, null, controller.signal, { timeoutMs: 15 }),
        error => error && error.name === 'AbortError'
    );
});

test('route request identity rejects stale origin, destination, mode, and toll results', () => {
    const start = { lat: 37, lng: 127 };
    const end = { lat: 37.1, lng: 127.1 };
    const key = RouteState.createRouteRequestKey(start, end, 'fastest', false, 1000);
    assert.equal(RouteState.isRouteRequestKeyCurrent(key, start, end, 'fastest', false, 1000), true);
    assert.equal(RouteState.isRouteRequestKeyCurrent(key, { lat: 38, lng: 127 }, end, 'fastest', false, 1000), false);
    assert.equal(RouteState.isRouteRequestKeyCurrent(key, start, end, 'shade', false, 1000), false);
    assert.equal(RouteState.isRouteRequestKeyCurrent(key, start, end, 'fastest', true, 1000), false);
});

test('real-time route identity stays valid across a minute boundary', () => {
    const start = { lat: 37, lng: 127 };
    const end = { lat: 37.1, lng: 127.1 };
    const key = RouteState.createRouteRequestKey(start, end, 'fastest', false, 'realtime');
    assert.equal(RouteState.isRouteRequestKeyCurrent(key, start, end, 'fastest', false, 'realtime'), true);
    assert.equal(RouteState.isRouteRequestKeyCurrent(key, start, end, 'fastest', false, 1735689900000), false);
    assert.equal(RouteState.normalizeTimeToken('realtime'), 'realtime');
});

test('off-route distance uses the nearest point on a route segment', () => {
    const route = [[0, 0], [0.01, 0]];
    const distance = ShadowRouter.distanceToRoute(0.0005, 0.005, route);
    assert.ok(distance > 50 && distance < 65, `expected about 56m, got ${distance}`);
    assert.ok(ShadowRouter.pointToSegmentDistanceMeters(0.0005, 0.005, route[0], route[1]) < 65);
});

test('guidance snap prefers forward route progress at self-crossings', () => {
    const route = [
        [0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001],
        [0, 0], [0.001, 0]
    ];
    const withoutProgress = ShadowRouter.snapPositionAndHeadingToRoad(0, 0.0002, 90, route);
    const withProgress = ShadowRouter.snapPositionAndHeadingToRoad(0, 0.0002, 90, route, {
        previousSegmentIndex: 3,
        maxBacktrackSegments: 0
    });
    assert.ok(withoutProgress.segmentIndex < 3, 'nearest-point snap should see the earlier crossing');
    assert.ok(withProgress.segmentIndex >= 3, 'active guidance must not jump behind the last accepted segment');
});

test('reroute preserves verified guidance until a forward replacement arrives', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const routerSource = fs.readFileSync(path.join(root, 'js/shadow-router.js'), 'utf8');
    const rerouteStart = appSource.slice(
        appSource.indexOf('if (isMidDrive && isLiveNavActive) {'),
        appSource.indexOf('const requestGeneration = ++routeAnalysisGeneration;')
    );
    assert.equal(rerouteStart.includes('clearLayers()'), false, 'old route must remain visible while OSRM is pending');
    assert.ok(appSource.includes("window.DebugLogger.log('route-reroute-committed'"));
    assert.ok(appSource.includes('if (isMidDrive && isLiveNavActive && !liveRerouteCommitted && selectedRouteObj)'));
    assert.ok(appSource.includes('currentStart = {'));
    assert.ok(appSource.includes('startHeading: isMidDrive'));
    assert.ok(routerSource.includes('&bearings=${bearing},60;'));
    assert.ok(routerSource.includes('viaBearing'));
});

test('initial GPS acquisition retries a timeout with one bounded high-accuracy request', async () => {
    const options = [];
    const expected = { coords: { latitude: 42.4, longitude: -71.1, accuracy: 12 }, timestamp: Date.now() };
    const geolocation = {
        getCurrentPosition(success, error, requestOptions) {
            options.push(requestOptions);
            if (options.length === 1) {
                const timeout = new Error('timeout');
                timeout.code = 3;
                setTimeout(() => error(timeout), 1);
            } else {
                setTimeout(() => success(expected), 1);
            }
        }
    };
    const result = await RouteState.acquireInitialPosition(geolocation);
    assert.equal(result, expected);
    assert.deepEqual(options.map(option => ({
        high: option.enableHighAccuracy,
        timeout: option.timeout,
        maximumAge: option.maximumAge
    })), [
        { high: false, timeout: 8000, maximumAge: 120000 },
        { high: true, timeout: 12000, maximumAge: 15000 }
    ]);
});

test('initial GPS acquisition does not repeat a denied permission request', async () => {
    let requests = 0;
    const denied = new Error('denied');
    denied.code = 1;
    const geolocation = {
        getCurrentPosition(success, error) {
            requests += 1;
            error(denied);
        }
    };
    await assert.rejects(RouteState.acquireInitialPosition(geolocation), error => error.code === 1);
    assert.equal(requests, 1);
});

test('a refined GPS fix restarts an in-flight route with a changed request identity', () => {
    const oldKey = RouteState.createRouteRequestKey({ lat: 42.4, lng: -71.1 }, { lat: 42.5, lng: -71.2 }, 'fastest', false, 'realtime');
    const newKey = RouteState.createRouteRequestKey({ lat: 42.4003, lng: -71.1003 }, { lat: 42.5, lng: -71.2 }, 'fastest', false, 'realtime');
    assert.equal(RouteState.shouldRestartRouteForGpsFix(oldKey, newKey, true, false), true);
    assert.equal(RouteState.shouldRestartRouteForGpsFix(oldKey, oldKey, true, false), false);
    assert.equal(RouteState.shouldRestartRouteForGpsFix(oldKey, newKey, true, true), false);
});

test('route duplicate filtering compares sampled geometry after distance and duration', () => {
    const base = {
        distance: 1000,
        duration: 100,
        geometry: { coordinates: [[0, 0], [0.005, 0], [0.01, 0]] }
    };
    const slightVariation = {
        distance: 1002,
        duration: 101,
        geometry: { coordinates: [[0, 0], [0.005, 0.00005], [0.01, 0]] }
    };
    const differentCorridor = {
        distance: 1001,
        duration: 101,
        geometry: { coordinates: [[0, 0], [0.005, 0.004], [0.01, 0]] }
    };
    assert.equal(ShadowRouter.areRoutesGeometricallySimilar(base, slightVariation), true);
    assert.equal(ShadowRouter.areRoutesGeometricallySimilar(base, differentCorridor), false);
    assert.notEqual(ShadowRouter.createRouteIdentity(base), ShadowRouter.createRouteIdentity(differentCorridor));
    assert.ok(ShadowRouter.geometryHausdorffDistanceMeters(base, differentCorridor) > 300);
});

test('precision candidates include duration fastest plus purpose-specific heuristic leaders', () => {
    const makeRoute = (id, durationSec, glare, uv, shade, candidateIndex) => ({
        id, durationSec, candidateIndex,
        analyzed: { avgGlareRisk: glare, totalUvExposureUnits: uv, avgShadeCoverage: shade }
    });
    const routes = [
        makeRoute('fast', 100, 0.80, 0.90, 0.10, 0),
        makeRoute('glare-a', 120, 0.10, 0.70, 0.20, 1),
        makeRoute('glare-b', 125, 0.20, 0.60, 0.30, 2),
        makeRoute('shade-a', 130, 0.70, 0.10, 0.90, 3),
        makeRoute('shade-b', 135, 0.60, 0.20, 0.80, 4)
    ];
    const selection = ShadowRouter.selectPrecisionCandidates(routes, 5);
    assert.equal(selection.fastest.id, 'fast');
    assert.deepEqual(Array.from(selection.glareCandidates, route => route.id), ['glare-a', 'glare-b']);
    assert.deepEqual(Array.from(selection.shadeCandidates, route => route.id), ['shade-a', 'shade-b']);
    assert.deepEqual(new Set(selection.precisionCandidates).size, 5);
    assert.ok(selection.precisionCandidates.some(route => route.id === 'shade-a'));
});

test('precision scheduling prioritizes the active role, then fastest, and skips noncompetitive noise', () => {
    const makeRoute = (id, durationSec, glare, uv, shade, candidateIndex) => ({
        id, durationSec, baseDurationSec: durationSec, candidateIndex,
        analyzed: { avgGlareRisk: glare, totalUvExposureUnits: uv, avgShadeCoverage: shade }
    });
    const routes = [
        makeRoute('fast', 100, 0.8, 1, 0.2, 0),
        makeRoute('glare', 115, 0.1, 0.9, 0.25, 1),
        makeRoute('shade', 120, 0.7, 0.7, 0.8, 2),
        makeRoute('noise', 130, 0.795, 0.995, 0.205, 3)
    ];
    const glareFirst = ShadowRouter.selectPrecisionCandidates(routes, 5, 'glareFree');
    assert.deepEqual(Array.from(glareFirst.precisionCandidates, route => route.id).slice(0, 3), ['glare', 'fast', 'shade']);
    assert.equal(glareFirst.precisionCandidates.some(route => route.id === 'noise'), false);
    const shadeFirst = ShadowRouter.selectPrecisionCandidates(routes, 5, 'shade');
    assert.deepEqual(Array.from(shadeFirst.precisionCandidates, route => route.id).slice(0, 3), ['shade', 'fast', 'glare']);
});

test('precision analysis geometry is bounded while preserving endpoints, turns, and OSRM navigation geometry', () => {
    const firstLeg = Array.from({ length: 101 }, (_, index) => [index * 0.00001, 0]);
    const secondLeg = Array.from({ length: 100 }, (_, index) => [0.001, (index + 1) * 0.00001]);
    const coordinates = [...firstLeg, ...secondLeg];
    const raw = {
        geometry: { coordinates },
        legs: [{ steps: [{
            maneuver: { location: [0.001, 0] },
            tunnel: true,
            geometry: { coordinates: [[0.001, 0], [0.001, 0.0005]] }
        }] }]
    };
    const sampling = ShadowRouter.buildPrecisionAnalysisGeometry(raw, { steps: raw.legs[0].steps });
    assert.deepEqual(Array.from(sampling.coordinates[0]), coordinates[0]);
    assert.deepEqual(Array.from(sampling.coordinates.at(-1)), coordinates.at(-1));
    assert.ok(sampling.coordinates.some(point => Math.abs(point[0] - 0.001) < 1e-10 && Math.abs(point[1]) < 1e-10));
    assert.ok(sampling.analysisCoordinateCount < sampling.originalCoordinateCount / 2);

    const heuristic = ShadowRouter.analyzeRouteSegments(coordinates, new Date('2024-06-21T12:00:00Z'), 100);
    const sampled = ShadowRouter.analyzeRouteSegments(sampling.coordinates, new Date('2024-06-21T12:00:00Z'), 100);
    const mapped = ShadowRouter.mapPrecisionAnalysisToOriginalGeometry(sampled, heuristic, coordinates, sampling);
    assert.equal(mapped.coordinates, coordinates);
    assert.equal(mapped.segments.length, heuristic.segments.length);
    assert.equal(mapped.precisionSampling.analysisCoordinateCount, sampling.analysisCoordinateCount);
});

test('route roles preserve OSRM duration for fastest regardless of solar scores', () => {
    const routes = [
        { id: 'fast', durationSec: 100, candidateIndex: 0, analyzed: { avgGlareRisk: 0.9, totalUvExposureUnits: 0.9, avgShadeCoverage: 0.1 } },
        { id: 'slow', durationSec: 130, candidateIndex: 1, analyzed: { avgGlareRisk: 0.1, totalUvExposureUnits: 0.1, avgShadeCoverage: 0.9 } }
    ];
    const roles = ShadowRouter.selectRouteRoles(routes);
    assert.equal(roles.fastest.id, 'fast');
    assert.equal(roles.glareFree.id, 'slow');
    assert.equal(roles.shade.id, 'slow');
});

test('route roles reject long detours with noise-level improvements', () => {
    const routes = [
        { id: 'fast', durationSec: 100, candidateIndex: 0, analyzed: { avgGlareRisk: 0.50, totalUvExposureUnits: 1, avgShadeCoverage: 0.40 } },
        { id: 'slow-noise', durationSec: 150, candidateIndex: 1, analyzed: { avgGlareRisk: 0.495, totalUvExposureUnits: 0.995, avgShadeCoverage: 0.405 } }
    ];
    const roles = ShadowRouter.selectRouteRoles(routes);
    assert.equal(roles.fastest.id, 'fast');
    assert.equal(roles.glareFree.id, 'fast');
    assert.equal(roles.shade.id, 'fast');
    assert.equal(routes[1].tradeoff.detourRatio, 1.5);
});

test('route roles accept a modest detour with meaningful glare or shade improvement', () => {
    const routes = [
        { id: 'fast', durationSec: 100, candidateIndex: 0, analyzed: { avgGlareRisk: 0.80, totalUvExposureUnits: 1, avgShadeCoverage: 0.20 } },
        { id: 'glare', durationSec: 115, candidateIndex: 1, analyzed: { avgGlareRisk: 0.20, totalUvExposureUnits: 0.95, avgShadeCoverage: 0.25 } },
        { id: 'shade', durationSec: 120, candidateIndex: 2, analyzed: { avgGlareRisk: 0.70, totalUvExposureUnits: 0.80, avgShadeCoverage: 0.80 } }
    ];
    const roles = ShadowRouter.selectRouteRoles(routes);
    assert.equal(roles.fastest.id, 'fast');
    assert.equal(roles.glareFree.id, 'glare');
    assert.equal(roles.shade.id, 'shade');
    assert.ok(routes[1].tradeoff.glareImprovement > 0.05);
    assert.ok(routes[2].tradeoff.uvReductionPct >= 5);
});

test('exposure reduction uses the same-tier refined fastest baseline', () => {
    const fastest = { id: 'fast', analyzed: { totalUvExposureUnits: 0.5 } };
    const glare = { id: 'glare', analyzed: { totalUvExposureUnits: 0.25 } };
    const shade = { id: 'shade', analyzed: { totalUvExposureUnits: 0.4 } };
    ShadowRouter.applyExposureReductions(fastest, glare, shade, new Date('2024-06-21T12:00:00Z'), { lat: 0, lng: 0 });
    assert.equal(fastest.uvReductionPct, 0);
    assert.equal(glare.uvReductionPct, 50);
    assert.equal(shade.uvReductionPct, 20);
});

test('OSM maxspeed values normalize to km/h while preserving regional display units', () => {
    assert.equal(Geocoder.detectCountry(40.7, -74), 'US');
    assert.equal(Geocoder.detectCountry(51.5, -0.1), 'GB');
    assert.equal(Geocoder.parseMaxspeed('30 mph', 'US').speedLimitKmh, 48.28032);
    assert.equal(Geocoder.parseMaxspeed('50 km/h', 'US').speedLimitKmh, 50);
    assert.equal(Geocoder.parseMaxspeed('50', 'GB').sourceUnit, 'mph');
    assert.equal(Geocoder.parseMaxspeed('50', 'INT').sourceUnit, 'km/h');
    assert.equal(Geocoder.parseMaxspeed('signals', 'US'), null);
});

test('step time lookup scales OSRM 100 seconds to an adjusted 142-second route', () => {
    const coordinates = [[127, 37], [127.01, 37], [127.02, 37]];
    const steps = [
        { distance: 1111, duration: 50, geometry: { coordinates: [coordinates[0], coordinates[1]] } },
        { distance: 1111, duration: 50, geometry: { coordinates: [coordinates[1], coordinates[2]] } }
    ];
    const lookup = ShadowRouter.buildStepTimeLookup(coordinates, steps, 142);
    assert.ok(Math.abs(lookup[0] - 0) < 1e-9);
    assert.ok(Math.abs(lookup[1] - 71) < 0.5);
    assert.equal(lookup[2], 142);

    const analyzed = ShadowRouter.analyzeRouteSegments(coordinates, new Date(0), 142, steps);
    assert.equal(analyzed.segments.length, 2);
    const lastPass = analyzed.segments[1].passTime.getTime() / 1000;
    assert.ok(lastPass > 71 && lastPass < 142);
});

test('toll-free candidate filtering rejects routes with OSRM toll indicators', () => {
    assert.equal(ShadowRouter.routeContainsToll({ legs: [{ steps: [{ classes: ['toll'] }] }] }), true);
    assert.equal(ShadowRouter.routeContainsToll({ legs: [{ steps: [{ intersections: [{ classes: ['motorway'] }] }] }] }), false);
});

test('scene service failure does not fail an otherwise valid OSRM route', async () => {
    const originalFetch = sandbox.fetch;
    const originalScene = sandbox.window.SceneShadow;
    sandbox.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ routes: [{ distance: 1000, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0]] }, legs: [{ steps: [] }] }] })
    });
    sandbox.window.SceneShadow = { fetchSceneForRoute: async () => { throw new Error('mock scene outage'); } };
    try {
        const result = await suppressExpectedWarnings(() => ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, new Date(0), false
        ));
        assert.ok(result && result.routes && result.routes.fastest);
        assert.equal(result.analysisMode, 'heuristic');
        assert.ok([result.routes.fastest, result.routes.glareFree, result.routes.shade].every(route => route.analysisMode === 'heuristic'));
    } finally {
        sandbox.fetch = originalFetch;
        sandbox.window.SceneShadow = originalScene;
    }
});

test('scene lookup prefers precomputed tiles before live Overpass fallback', async () => {
    const originalFetch = sandbox.fetch;
    const originalScene = sandbox.window.SceneShadow;
    const calls = [];
    sandbox.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ routes: [{ distance: 1000, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0]] }, legs: [{ steps: [] }] }] })
    });
    sandbox.window.SceneShadow = {
        fetchPrecomputedSceneForRoute: async () => { calls.push('precomputed'); return null; },
        fetchSceneForRoute: async () => { calls.push('overpass'); return null; }
    };
    try {
        await ShadowRouter.fetchAndAnalyzeRoutes({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, new Date('2026-06-21T12:00:00Z'), false);
        assert.ok(calls.length >= 2);
        assert.equal(calls[0], 'precomputed');
        assert.equal(calls[1], 'overpass');
    } finally {
        sandbox.fetch = originalFetch;
        sandbox.window.SceneShadow = originalScene;
    }
});

test('precomputed scene failure keeps its concrete reason after live fallback also fails', async () => {
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    const raw = { distance: 1000, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0]] }, legs: [{ steps: [] }] };
    SceneShadow.fetchPrecomputedSceneForRoute = async () => {
        const error = new Error('scene pack download timed out');
        error.code = 'SCENE_PACK_DOWNLOAD_TIMEOUT';
        throw error;
    };
    SceneShadow.fetchSceneForRoute = async () => { throw new Error('mock Overpass outage'); };
    try {
        const result = await suppressExpectedWarnings(() => ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, new Date('2026-06-21T12:00:00Z'), false,
            { candidates: [raw] }
        ));
        assert.equal(result.routes.fastest.analysisMode, 'heuristic');
        assert.equal(result.routes.fastest.fallbackReason, 'SCENE_PACK_DOWNLOAD_TIMEOUT');
    } finally {
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
    }
});

test('scene refinement accepts an independent abort signal', async () => {
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    const routeController = new AbortController();
    const sceneController = new AbortController();
    const raw = { distance: 1000, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0]] }, legs: [{ steps: [] }] };
    let observedSignal = null;
    SceneShadow.fetchPrecomputedSceneForRoute = async (_coordinates, options) => {
        observedSignal = options.signal;
        return null;
    };
    SceneShadow.fetchSceneForRoute = async () => null;
    try {
        const result = await suppressExpectedWarnings(() => ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, new Date('2026-06-21T12:00:00Z'), false,
            { candidates: [raw], signal: routeController.signal, sceneSignal: sceneController.signal }
        ));
        assert.ok(result.routes.fastest);
        assert.equal(observedSignal, sceneController.signal);
        assert.notEqual(observedSignal, routeController.signal);
    } finally {
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
    }
});

test('partial pack failure retains successfully cached tiles as hybrid scene data', async () => {
    const originalFetch = sandbox.fetch;
    const manifestUrl = 'https://example.test/partial-pack/manifest.json';
    const route = [[0.001, 0.001], [0.046, 0.001]];
    const terrainFor = (lngMin, lngMax) => {
        const values = [];
        for (let lat = -0.01; lat <= 0.02; lat += 0.001) {
            for (let lng = lngMin; lng <= lngMax; lng += 0.001) values.push([Number(lat.toFixed(5)), Number(lng.toFixed(5)), 10]);
        }
        return values;
    };
    const goodZip = require('fflate').zipSync({
        '0_0.json': require('fflate').strToU8(JSON.stringify({ schema: 1, buildings: [], tunnels: [], terrain: terrainFor(-0.01, 0.05) }))
    });
    const badZip = require('fflate').zipSync({
        '1_0.json': require('fflate').strToU8(JSON.stringify({ schema: 1, buildings: [], tunnels: [], terrain: terrainFor(0.04, 0.1) }))
    });
    const manifest = {
        schema: 2, region: 'PARTIAL-PACK', releaseTag: 'partial-pack', baseUrl: 'https://example.test/partial-pack',
        tileSizeM: 5000, tilePaddingMeters: 0, terrainSpacingM: 100,
        grid: { latOrigin: 0, lngOrigin: 0, cosLat: 1 },
        packs: { good: { path: 'good.zip' }, bad: { path: 'bad.zip' } },
        tiles: {
            '0:0': { pack: 'good', file: '0_0.json' },
            '1:0': { pack: 'bad', file: '1_0.json' }
        }
    };
    let goodFetches = 0;
    let badFetches = 0;
    sandbox.fetch = async url => {
        if (String(url) === manifestUrl) return { ok: true, status: 200, headers: { get: () => null }, json: async () => manifest };
        if (String(url).endsWith('good.zip')) {
            goodFetches++;
            return { ok: true, status: 200, arrayBuffer: async () => goodZip.buffer.slice(goodZip.byteOffset, goodZip.byteOffset + goodZip.byteLength) };
        }
        if (String(url).endsWith('bad.zip')) {
            badFetches++;
            return { ok: false, status: 503, arrayBuffer: async () => badZip.buffer.slice(badZip.byteOffset, badZip.byteOffset + badZip.byteLength) };
        }
        throw new Error(`unexpected URL ${url}`);
    };
    try {
        SceneShadow.clearCaches();
        const scene = await SceneShadow.fetchPrecomputedSceneForRoute(route, {
            precomputedManifestUrl: manifestUrl,
            precomputedRegionBounds: { south: -1, west: -1, north: 1, east: 1 },
            dateObj: new Date('2026-06-21T12:00:00Z'), durationSec: 300,
            precomputedPackRetryCount: 0
        });
        assert.ok(scene);
        assert.equal(scene.precisionReady, false);
        assert.equal(scene.partial, scene.coverage.coveredSegments > 0,
            'partial is true only when the successfully loaded pack covers at least one segment');
        assert.ok(scene.coverage.precomputedTiles >= 1);
        assert.ok(scene.coverage.missingTiles >= 1);
        assert.ok(scene.diagnostics.streamFailureReasons.includes('SCENE_PACK_HTTP_ERROR'));
        const goodFetchesAfterFirst = goodFetches;
        await SceneShadow.fetchPrecomputedSceneForRoute(route, {
            precomputedManifestUrl: manifestUrl,
            precomputedRegionBounds: { south: -1, west: -1, north: 1, east: 1 },
            dateObj: new Date('2026-06-21T12:00:00Z'), durationSec: 300,
            precomputedPackRetryCount: 0
        });
        assert.equal(goodFetches, goodFetchesAfterFirst, 'successful pack tiles should stay cached');
        assert.ok(badFetches >= 2, 'only the failed pack should be retried');
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.clearCaches();
    }
});

test('precomputed scene cache has a byte budget and no removed single-region default', () => {
    const sceneSource = fs.readFileSync(path.join(root, 'js/scene-shadow.js'), 'utf8');
    assert.equal(sceneSource.includes('PRECOMPUTED_MANIFEST_URL'), false);
    const stats = SceneShadow.getCacheStats();
    assert.ok(Number.isFinite(stats.precomputedMaxBytes) && stats.precomputedMaxBytes > 0);
    assert.ok(Number.isFinite(stats.precomputedBytes) && stats.precomputedBytes >= 0);
});

test('identical route groups invoke scene analysis once and return scene-tier results', async () => {
    const originalFetch = sandbox.fetch;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    let sceneCalls = 0;
    sandbox.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ routes: [{ distance: 1000, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0]] }, legs: [{ steps: [] }] }] })
    });
    SceneShadow.fetchSceneForRoute = async () => {
        sceneCalls++;
        return {
            precisionReady: true,
            origin: { lat: 0, lng: 0 },
            coverage: { buildings: true, terrain: true, tunnels: true },
            segmentCoverage: [{ buildings: true, terrain: true, tunnels: true }],
            buildings: [], tunnels: [], terrainSamples: [], terrainProfiles: [],
            source: 'mock scene'
        };
    };
    try {
        const result = await suppressExpectedWarnings(() => ShadowRouter.fetchAndAnalyzeRoutes({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, new Date('2026-06-21T12:00:00Z'), false));
        assert.equal(sceneCalls, 1);
        assert.equal(result.analysisMode, 'scene');
        assert.equal(result.routes.fastest.analysisMode, 'scene');
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
    }
});

test('partial scene failure falls back only the affected role comparison tier', async () => {
    const originalFetch = sandbox.fetch;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    let sceneCalls = 0;
    const rawRoutes = [
        { distance: 1100, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0.0045]] }, legs: [{ steps: [] }] },
        { distance: 1200, duration: 115, geometry: { coordinates: [[0, 0], [0, 0.01]] }, legs: [{ steps: [] }] },
        { distance: 1250, duration: 120, geometry: { coordinates: [[0, 0], [0, -0.01]] }, legs: [{ steps: [] }] }
    ];
    SceneShadow.fetchPrecomputedSceneForRoute = async () => null;
    SceneShadow.fetchSceneForRoute = async () => {
        sceneCalls++;
        if (sceneCalls > 1) throw new Error('mock partial scene outage');
        return {
            precisionReady: true,
            origin: { lat: 0, lng: 0 },
            coverage: { buildings: true, terrain: true, tunnels: true },
            segmentCoverage: [{ buildings: true, terrain: true, tunnels: true }],
            buildings: [], tunnels: [], terrainSamples: [], terrainProfiles: [],
            source: 'mock scene'
        };
    };
    try {
        const result = await suppressExpectedWarnings(() => ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0.0045, lng: 0.01 }, new Date('2024-06-21T07:00:00Z'), false,
            { candidates: rawRoutes, preferredRouteRole: 'fastest' }
        ));
        assert.ok(sceneCalls > 1);
        assert.equal(result.analysisMode, 'mixed-by-role');
        assert.equal(result.routes.fastest.analysisMode, 'scene');
        assert.ok([result.routes.glareFree, result.routes.shade].some(route => route.analysisMode === 'heuristic'));
        assert.ok(result.routes.all.some(route => route.sceneAnalysis));
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
    }
});

test('uniform partial scenes remain a common hybrid comparison tier', async () => {
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    const rawRoutes = [
        { distance: 1000, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0]] }, legs: [{ steps: [] }] },
        { distance: 1100, duration: 110, geometry: { coordinates: [[0, 0], [0.005, 0.006], [0.01, 0]] }, legs: [{ steps: [] }] }
    ];
    SceneShadow.fetchPrecomputedSceneForRoute = async coordinates => ({
        precisionReady: false,
        partial: true,
        origin: { lat: 0, lng: 0 },
        coverage: { buildings: true, terrain: true, tunnels: true, coveredSegments: Math.max(1, coordinates.length - 1), segmentCount: coordinates.length - 1, segmentRatio: 1 },
        segmentCoverage: Array.from({ length: Math.max(1, coordinates.length - 1) }, () => ({ buildings: true, terrain: true, tunnels: true, buildingGround: true })),
        buildings: [], tunnels: [], terrainSamples: [], terrainProfiles: [],
        source: 'mock partial regional scene'
    });
    SceneShadow.fetchSceneForRoute = async () => { throw new Error('live fallback should not be called'); };
    try {
        const result = await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, new Date('2026-06-21T12:00:00Z'), false,
            { candidates: rawRoutes, preferredRouteRole: 'shade' }
        );
        assert.equal(result.analysisMode, 'hybrid-scene');
        assert.ok(['hybrid-scene'].includes(result.routes.fastest.analysisMode));
        assert.ok(['hybrid-scene'].includes(result.routes.shade.analysisMode));
        assert.equal(result.routes.fastest.analyzed.analysisMode, 'hybrid-scene');
    } finally {
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
    }
});

test('scene analysis concurrency is bounded and queued candidates remain cancellable', async () => {
    const originalFetch = sandbox.fetch;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    let active = 0;
    let maxActive = 0;
    const rawRoutes = [
        { distance: 1100, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0.0045]] }, legs: [{ steps: [] }] },
        { distance: 1200, duration: 112, geometry: { coordinates: [[0, 0], [0, 0.01]] }, legs: [{ steps: [] }] },
        { distance: 1250, duration: 118, geometry: { coordinates: [[0, 0], [0, -0.01]] }, legs: [{ steps: [] }] },
        { distance: 1300, duration: 124, geometry: { coordinates: [[0, 0], [-0.01, 0]] }, legs: [{ steps: [] }] }
    ];
    SceneShadow.fetchPrecomputedSceneForRoute = async () => null;
    SceneShadow.fetchSceneForRoute = async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 12));
        active--;
        return {
            precisionReady: true,
            origin: { lat: 0, lng: 0 },
            coverage: { buildings: true, terrain: true, tunnels: true },
            segmentCoverage: [{ buildings: true, terrain: true, tunnels: true }],
            buildings: [], tunnels: [], terrainSamples: [], terrainProfiles: [],
            source: 'mock scene'
        };
    };
    try {
        const result = await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0.0045, lng: 0.01 }, new Date('2024-06-21T07:00:00Z'), false,
            { sceneConcurrency: 2, candidates: rawRoutes, preferredRouteRole: 'shade' }
        );
        assert.ok(result.precisionCandidateIds.length >= 2);
        assert.ok(maxActive <= 2, `expected at most 2 concurrent scene requests, got ${maxActive}`);
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
    }
});

test('building ground elevation uses the nearest valid DEM sample and does not fabricate zero', async () => {
    const originalFetch = sandbox.fetch;
    SceneShadow.clearCaches();
    let terrainAvailable = true;
    let activeOrigin = { lat: 0, lng: 0 };
    const testDate = new Date('2024-06-21T12:00:00Z');
    function buildingAtSunRay(id, distanceMeters, height) {
        const sun = sandbox.SunCalc.getPosition(testDate, activeOrigin.lat, activeOrigin.lng);
        const azimuth = Number(sun.azimuth) * Math.PI / 180;
        const centerLat = activeOrigin.lat + distanceMeters * Math.cos(azimuth) / 111320;
        const centerLng = activeOrigin.lng + distanceMeters * Math.sin(azimuth) / (111320 * Math.max(0.01, Math.cos(activeOrigin.lat * Math.PI / 180)));
        const halfLat = 0.00004;
        const halfLng = 0.00004;
        return {
            type: 'way', id,
            tags: { building: 'yes', height: String(height) },
            geometry: [
                { lat: centerLat - halfLat, lon: centerLng - halfLng },
                { lat: centerLat + halfLat, lon: centerLng - halfLng },
                { lat: centerLat + halfLat, lon: centerLng + halfLng },
                { lat: centerLat - halfLat, lon: centerLng + halfLng }
            ]
        };
    }
    function irrelevantFarBuilding() {
        const centerLat = activeOrigin.lat + 0.02;
        const centerLng = activeOrigin.lng + 0.02;
        return {
            type: 'way', id: 99,
            tags: { building: 'yes', height: '30' },
            geometry: [
                { lat: centerLat - 0.0001, lon: centerLng - 0.0001 },
                { lat: centerLat + 0.0001, lon: centerLng - 0.0001 },
                { lat: centerLat + 0.0001, lon: centerLng + 0.0001 },
                { lat: centerLat - 0.0001, lon: centerLng + 0.0001 }
            ]
        };
    }
    sandbox.fetch = async url => {
        if (String(url).includes('overpass-api.de')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ elements: [
                    buildingAtSunRay(1, 30, 12),
                    buildingAtSunRay(2, 210, 18),
                    irrelevantFarBuilding()
                ] })
            };
        }
        if (String(url).includes('opentopodata')) {
            return {
                ok: true,
                status: 200,
                json: async () => ({ results: terrainAvailable
                    ? Array.from({ length: 100 }, (_, index) => ({ elevation: 100 + index }))
                    : [] })
            };
        }
        throw new Error(`unexpected URL: ${url}`);
    };
    try {
        activeOrigin = { lat: 0, lng: 0 };
        const scene = await SceneShadow.fetchSceneForRoute(
            [[0, 0], [0.001, 0]], { dateObj: testDate, durationSec: 100 }
        );
        assert.equal(scene.buildings.length, 2);
        assert.equal(scene.diagnostics.totalBuildings, 3);
        assert.equal(Object.hasOwn(scene, 'allBuildings'), false);
        assert.ok(scene.buildings.every(building => Number.isFinite(building.ground)));
        assert.notEqual(scene.buildings[0].ground, scene.buildings[1].ground);

        SceneShadow.clearCaches();
        terrainAvailable = false;
        activeOrigin = { lat: 0, lng: 0.01 };
        const incomplete = await SceneShadow.fetchSceneForRoute(
            [[0.01, 0], [0.011, 0]], { dateObj: testDate, durationSec: 100 }
        );
        assert.equal(incomplete.buildings.length, 2);
        assert.equal(incomplete.buildings[0].ground, null);
        assert.ok(incomplete.segmentCoverage.some(segment => segment.buildingGround === false));
        assert.equal(incomplete.precisionReady, false);
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.clearCaches();
    }
});

test('large scene bbox is skipped before external API calls', async () => {
    const originalFetch = sandbox.fetch;
    let calls = 0;
    sandbox.fetch = async () => { calls++; throw new Error('should not call API'); };
    try {
        const scene = await SceneShadow.fetchSceneForRoute(
            [[0, 0], [2, 0]], { maxRouteMeters: 300000, maxBboxSpanDeg: 1.5 }
        );
        assert.equal(scene, null);
        const diagonalScene = await SceneShadow.fetchSceneForRoute(
            [[0, 0], [1, 1]], { maxRouteMeters: 300000, maxBboxSpanDeg: 1.5, maxBboxAreaKm2: 25, maxSceneTiles: 8 }
        );
        assert.equal(diagonalScene, null);
        assert.equal(calls, 0);
    } finally {
        sandbox.fetch = originalFetch;
    }
});

test('scene bbox metrics account for latitude-scaled area and diagonal spans', () => {
    const diagonal = SceneShadow.routeBbox([[0, 0], [0.01, 0.01]], 250);
    const metrics = SceneShadow.bboxMetrics(diagonal);
    assert.ok(metrics.widthMeters > 1000 && metrics.heightMeters > 1000);
    assert.ok(metrics.areaKm2 > 1 && metrics.areaKm2 < 3);
    const broad = SceneShadow.bboxMetrics({ south: 0, west: 0, north: 1, east: 1 });
    assert.ok(broad.areaKm2 > 10000);
});

test('scene tiles deduplicate OSM ids and reuse overlapping tile cache', async () => {
    const originalFetch = sandbox.fetch;
    SceneShadow.clearCaches();
    let overpassCalls = 0;
    let terrainCalls = 0;
    sandbox.fetch = async url => {
        if (String(url).includes('overpass-api.de')) {
            overpassCalls++;
            return {
                ok: true,
                status: 200,
                json: async () => ({ elements: [
                    { type: 'way', id: 7, tags: { building: 'yes', height: '10' }, geometry: [
                        { lat: -0.0001, lon: 0.0001 }, { lat: 0.0001, lon: 0.0001 },
                        { lat: 0.0001, lon: 0.0002 }, { lat: -0.0001, lon: 0.0002 }
                    ] },
                    { type: 'way', id: 8, tags: { building: 'yes', height: '12' }, geometry: [
                        { lat: -0.0001, lon: 0.0003 }, { lat: 0.0001, lon: 0.0003 },
                        { lat: 0.0001, lon: 0.0004 }, { lat: -0.0001, lon: 0.0004 }
                    ] }
                ] })
            };
        }
        if (String(url).includes('opentopodata')) {
            terrainCalls++;
            return { ok: true, status: 200, json: async () => ({ results: Array.from({ length: 100 }, () => ({ elevation: 100 })) }) };
        }
        throw new Error(`unexpected URL: ${url}`);
    };
    const route = [[0, 0], [0.03, 0], [0.06, 0], [0.09, 0]];
    try {
        const first = await SceneShadow.fetchSceneForRoute(route, {
            maxBboxAreaKm2: 0.2,
            sceneTileRouteMeters: 3000,
            maxSceneTiles: 8,
            maxSceneTotalAreaKm2: 100,
            dateObj: new Date('2024-06-21T12:00:00Z'),
            durationSec: 200
        });
        assert.ok(overpassCalls > 1);
        assert.equal(first.diagnostics.totalBuildings, 2);
        assert.equal(Object.hasOwn(first, 'allBuildings'), false);
        const callsAfterFirst = overpassCalls;
        const terrainAfterFirst = terrainCalls;
        const second = await SceneShadow.fetchSceneForRoute(route, {
            maxBboxAreaKm2: 0.2,
            sceneTileRouteMeters: 3000,
            maxSceneTiles: 8,
            maxSceneTotalAreaKm2: 100,
            dateObj: new Date('2024-06-21T12:00:00Z'),
            durationSec: 200
        });
        assert.equal(overpassCalls, callsAfterFirst);
        assert.equal(terrainCalls, terrainAfterFirst);
        assert.equal(second.diagnostics.totalBuildings, first.diagnostics.totalBuildings);
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.clearCaches();
    }
});

test('aborting scene tiles prevents the next Overpass tile from starting', async () => {
    const originalFetch = sandbox.fetch;
    SceneShadow.clearCaches();
    let overpassCalls = 0;
    sandbox.fetch = async (url, options = {}) => new Promise((resolve, reject) => {
        if (String(url).includes('overpass-api.de')) overpassCalls++;
        const onAbort = () => reject(new Error('aborted'));
        if (options.signal) {
            if (options.signal.aborted) onAbort();
            else options.signal.addEventListener('abort', onAbort, { once: true });
        }
    });
    const controller = new AbortController();
    try {
        const promise = SceneShadow.fetchSceneForRoute([[0, 0], [0.03, 0], [0.06, 0]], {
            maxBboxAreaKm2: 0.2,
            sceneTileRouteMeters: 3000,
            maxSceneTiles: 8,
            signal: controller.signal
        });
        setTimeout(() => controller.abort(), 5);
        await assert.rejects(promise);
        assert.equal(overpassCalls, 1);
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.clearCaches();
    }
});

test('toll-free routing adds exclusion to direct and via-point OSRM requests', async () => {
    const originalFetch = sandbox.fetch;
    const requestedUrls = [];
    sandbox.window.SceneShadow = null;
    sandbox.fetch = async (url) => {
        requestedUrls.push(String(url));
        return {
            ok: true,
            status: 200,
            json: async () => ({
                routes: [{
                    distance: 1000,
                    duration: 100,
                    geometry: { coordinates: [[0, 0], [0.01, 0]] },
                    legs: [{ steps: [] }]
                }]
            })
        };
    };
    try {
        await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 },
            { lat: 0, lng: 1 },
            new Date(0),
            true
        );
    } finally {
        sandbox.fetch = originalFetch;
        sandbox.window.SceneShadow = SceneShadow;
    }
    assert.equal(requestedUrls.length, 3);
    assert.ok(requestedUrls.every(url => url.includes('exclude=toll')));
});

test('continental-scale coordinates are valid inputs and are not rejected by distance alone', () => {
    assert.equal(ShadowRouter.areValidRouteCoordinates({ lat: 40, lng: -100 }, { lat: 40, lng: 100 }), true);
    assert.equal(ShadowRouter.areValidRouteCoordinates({ lat: 91, lng: 0 }, { lat: 0, lng: 0 }), false);
});

test('country detection does not classify Ireland or continental Europe as Great Britain', () => {
    assert.equal(Geocoder.detectCountry(51.5, -0.1), 'GB');
    assert.equal(Geocoder.detectCountry(53.35, -6.26), 'INT');
    assert.equal(Geocoder.detectCountry(48.86, 2.35), 'INT');
    assert.equal(Geocoder.detectCountry(50.85, 4.35), 'INT');
    assert.equal(Geocoder.detectCountry(43.6532, -79.3832), 'INT');
    assert.equal(Geocoder.detectCountry(32.5149, -117.0382), 'INT');
    assert.equal(Geocoder.detectCountry(47.6062, -122.3321), 'US');
    assert.equal(Geocoder.detectCountry(60.7212, -135.0568), 'INT'); // Whitehorse
    assert.equal(Geocoder.detectCountry(49.2827, -123.1207), 'INT'); // Vancouver
    assert.equal(Geocoder.detectCountry(61.2181, -149.9003), 'US'); // Anchorage
    assert.equal(Geocoder.detectCountry(58.3019, -134.4197), 'US'); // Juneau
    assert.equal(Geocoder.detectCountry(21.3069, -157.8583), 'US'); // Hawaii
});

test('street-address autocomplete prefers exact Nominatim fallback over Photon fuzzy roads', async () => {
    const originalFetch = sandbox.fetch;
    const requested = [];
    sandbox.fetch = async url => {
        requested.push(String(url));
        if (String(url).includes('photon.komoot.io')) {
            return { ok: true, status: 200, json: async () => ({ features: [{
                properties: { name: 'Alton Tannery Road', housenumber: '94', city: 'Hudson', state: 'ME', country: 'United States' },
                geometry: { coordinates: [-68.8194211, 45.007609] }
            }] }) };
        }
        return { ok: true, status: 200, json: async () => ([{
            name: '94', lat: '44.1012402', lon: '-70.5287212',
            display_name: '94, Gerry Road, Otisfield, Oxford County, Maine, 04270, United States'
        }]) };
    };
    try {
        // Put the simulated driver next to Photon's fuzzy result; exact
        // Nominatim street-address data must still win provider ranking.
        const results = await Geocoder.searchPlaces('94 Gerry Road', { lat: 45.0076, lng: -68.8194 }, {
            includeNominatim: false,
            fallbackNominatim: true
        });
        assert.equal(results[0].source, 'nominatim');
        assert.equal(results[0].displayName.includes('Gerry Road'), true);
        assert.equal(requested.some(url => url.includes('addressdetails=1')), true);
    } finally {
        sandbox.fetch = originalFetch;
    }
});

test('turn voice does not append a generic straight prompt when a maneuver is pending', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const guardedHazardCalls = appSource.match(/if \(!nextManeuver\) TTSVoice\.announceNavHazard/g) || [];
    assert.equal(guardedHazardCalls.length, 2);
    assert.ok(appSource.includes('fa-arrow-left maneuver-icon maneuver-left'));
    assert.ok(appSource.includes('fa-arrow-right maneuver-icon maneuver-right'));
});

test('reverse-geocoded ISO country is cached and controls speed units', async () => {
    const originalFetch = sandbox.fetch;
    let reverseCalls = 0;
    let overpassCalls = 0;
    sandbox.fetch = async url => {
        if (String(url).includes('nominatim.openstreetmap.org/reverse')) {
            reverseCalls++;
            return { ok: true, status: 200, json: async () => ({ address: { country_code: 'ca' } }) };
        }
        overpassCalls++;
        return {
            ok: true,
            status: 200,
            json: async () => ({ elements: [{
                type: 'way',
                tags: { highway: 'primary', maxspeed: '50', name: 'Canadian Road' },
                geometry: [{ lat: 43.6532, lon: -79.3833 }, { lat: 43.6532, lon: -79.3831 }]
            }] })
        };
    };
    try {
        const first = await Geocoder.fetchCurrentRoadSpeedLimitAndRules(43.6532, -79.3832);
        const second = await Geocoder.fetchCurrentRoadSpeedLimitAndRules(43.6532, -79.3832);
        assert.equal(first.countryCode, 'CA');
        assert.equal(first.country, 'INT');
        assert.equal(first.unit, 'km/h');
        assert.equal(first.speedLimitKmh, 50);
        assert.equal(second.countryCode, 'CA');
        assert.equal(reverseCalls, 1);
        assert.equal(overpassCalls, 2);
    } finally {
        sandbox.fetch = originalFetch;
    }
});

test('address and country reverse lookups share one in-flight response per cell', async () => {
    const originalFetch = sandbox.fetch;
    let reverseCalls = 0;
    let overpassCalls = 0;
    let reverseUrl = '';
    sandbox.fetch = async url => {
        if (String(url).includes('nominatim.openstreetmap.org/reverse')) {
            reverseCalls++;
            reverseUrl = String(url);
            await new Promise(resolve => setTimeout(resolve, 15));
            return { ok: true, status: 200, json: async () => ({
                display_name: 'Example Road, Example City, Canada',
                address: { country_code: 'ca' }
            }) };
        }
        overpassCalls++;
        return { ok: true, status: 200, json: async () => ({ elements: [] }) };
    };
    try {
        const [address, country] = await Promise.all([
            Geocoder.reverseGeocode(44, -79),
            Geocoder.resolveCountryCode(44, -79)
        ]);
        assert.equal(address, 'Example Road, Example City, Canada');
        assert.equal(country, 'CA');
        assert.ok(reverseUrl.includes('addressdetails=1'));
        assert.equal(reverseCalls, 1);

        const road = await Geocoder.fetchCurrentRoadSpeedLimitAndRules(44, -79);
        assert.equal(road.countryCode, 'CA');
        assert.equal(reverseCalls, 1);
        assert.equal(overpassCalls, 1);

        await Geocoder.resolveCountryCode(44.1, -79);
        assert.equal(reverseCalls, 2);
    } finally {
        sandbox.fetch = originalFetch;
    }
});

test('nearest OSM way geometry determines the speed limit', async () => {
    const originalFetch = sandbox.fetch;
    sandbox.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ elements: [
            { type: 'way', id: 1, tags: { highway: 'primary', maxspeed: '30 mph', name: 'Nearby Road' }, geometry: [{ lat: 40, lon: -74.0002 }, { lat: 40, lon: -74.0001 }] },
            { type: 'way', id: 2, tags: { highway: 'motorway', maxspeed: '70 mph', name: 'Distant Highway' }, geometry: [{ lat: 40.01, lon: -74.01 }, { lat: 40.01, lon: -74.00 }] },
            { type: 'way', id: 3, tags: { highway: 'secondary', maxspeed: '50 mph', name: 'Parallel Crossing' }, geometry: [{ lat: 39.9998, lon: -74.00015 }, { lat: 40.0002, lon: -74.00015 }] }
        ] })
    });
    try {
        const road = await Geocoder.fetchCurrentRoadSpeedLimitAndRules(40, -74, { roadContext: { heading: 90, name: 'Nearby Road' } });
        assert.equal(road.roadName, 'Nearby Road');
        assert.equal(road.rawSpeedLimit, 30);
        assert.equal(road.rawSpeedLimitUnit, 'mph');
    } finally {
        sandbox.fetch = originalFetch;
    }
});

test('scene caches expose a finite TTL and bounded entry counts', () => {
    SceneShadow.clearCaches();
    const stats = SceneShadow.getCacheStats();
    assert.ok(stats.ttlMs > 0);
    assert.equal(stats.overpass, 0);
    assert.equal(stats.terrain, 0);
});

test('route-state overlay geometry reports intersections without DOM dependencies', () => {
    assert.equal(RouteState.findRectIntersections({
        attribution: { left: 0, top: 80, right: 100, bottom: 100 },
        summary: { left: 0, top: 40, right: 100, bottom: 78 }
    }).length, 0);
    assert.deepEqual(Array.from(RouteState.findRectIntersections({
        attribution: { left: 0, top: 80, right: 100, bottom: 100 },
        banner: { left: 20, top: 90, right: 80, bottom: 120 }
    })[0]), ['attribution', 'banner']);
});

test('time slider debounce collapses repeated input into one analysis', async () => {
    let calls = 0;
    const schedule = RouteState.createDebouncedScheduler(() => { calls++; }, 20);
    for (let i = 0; i < 20; i++) schedule(i);
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(calls, 1);
});

test('time-only route analysis reuses OSRM geometry and makes no network request', async () => {
    const originalFetch = sandbox.fetch;
    const originalScene = sandbox.window.SceneShadow;
    let fetchCalls = 0;
    sandbox.fetch = async () => {
        fetchCalls++;
        return { ok: true, status: 200, json: async () => ({ routes: [] }) };
    };
    sandbox.window.SceneShadow = null;
    const candidate = {
        distance: 1000,
        duration: 100,
        geometry: { coordinates: [[0, 0], [0.01, 0]] },
        legs: [{ steps: [] }]
    };
    try {
        const result = await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, new Date('2026-06-21T12:00:00Z'), false,
            { candidates: [candidate] }
        );
        assert.equal(fetchCalls, 0);
        assert.equal(result.routeCandidates.length, 1);
        assert.equal(result.routes.fastest.raw, candidate);
    } finally {
        sandbox.fetch = originalFetch;
        sandbox.window.SceneShadow = originalScene;
    }
});

test('heading-up panning no longer resets the map DOM transform', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const panSection = appSource.slice(appSource.indexOf('function setupMapPanTrackingListeners'), appSource.indexOf('function triggerRecenterCountdownToast'));
    assert.equal(panSection.includes("mapElement.style.transform = 'none';"), false);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.includes('map-bottom-overlay-stack'));
    assert.ok(html.includes('openstreetmap.org/copyright'));
});

test('vehicle animation and remaining path use cancellable/reusable renderers', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes('function stopVehicleMarkerAnimation()'));
    assert.ok(appSource.includes('cancelAnimationFrame(vehicleAnimFrameId)'));
    assert.ok(appSource.includes("document.visibilityState === 'hidden'"));
    assert.ok(appSource.includes('dynamicRemainingLayers = new Map()'));
    assert.ok(appSource.includes('knownSnap = null'));
    assert.equal(appSource.includes('activeRoutePolylineGroup.clearLayers();\n\n        // 1. Current segment'), false);
});

test('heading-up gestures compensate CSS rotation and route preview frames both endpoints', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes('function installHeadingUpInteractionCompensation()'));
    assert.ok(appSource.includes('function installManualMapRotationGesture()'));
    assert.ok(appSource.includes('function markUserMapPanning()'));
    assert.ok(appSource.includes("'touchmove'"));
    assert.ok(appSource.includes('startOffset: manualMapRotation'));
    assert.ok(appSource.includes('manualMapRotation = gesture.startOffset'));
    assert.ok(appSource.includes("'pointermove'"));
    assert.ok(appSource.includes('rotatePointToMapCoordinates'));
    assert.ok(appSource.includes('queueMicrotask'));
    assert.ok(appSource.includes('paddingTopLeft: [48, 176]'));
    assert.ok(appSource.includes('paddingBottomRight: [48, 156]'));
    assert.ok(appSource.includes('maxZoom: PREVIEW_MAX_ZOOM'));
    assert.ok(appSource.includes('setLiveNavigationMapMode(true)'));
    assert.ok(appSource.includes('setLiveNavigationMapMode(false)'));
    assert.ok(appSource.includes('manualMapRotation = 0;'));
    assert.ok(appSource.includes("wrapper.classList.remove('user-map-panning', 'manual-rotation-gesture')"));
});

test('heading-up oversized map is limited to live navigation', () => {
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    assert.ok(css.includes('.map-container.heading-up-active.live-navigation #map'));
    assert.equal(css.includes('.map-container.heading-up-active #map {'), false);
});

test('initial search overlay cannot cover the global header controls', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    assert.ok(html.indexOf('<header class="app-header">') < html.indexOf('<div class="main-body">'));
    assert.ok(css.includes('flex: 0 0 60px;'));
    assert.ok(css.includes('position: relative;'));
    assert.ok(css.includes('z-index: 10000;'));
});

test('rotated Leaflet input uses logical layout dimensions and document drag events', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes('const layoutWidth = container.clientWidth || rect.width;'));
    assert.ok(appSource.includes('const layoutHeight = container.clientHeight || rect.height;'));
    assert.ok(appSource.includes('rect.left + (container.clientLeft || 0) + localX'));
    assert.ok(appSource.includes('const patchDocumentEvent = event =>'));
    assert.ok(appSource.includes("'touchmove', 'touchend', 'touchcancel'"));
    assert.ok(appSource.includes('map.mouseEventToContainerPoint = event =>'));
    assert.ok(appSource.includes("draggable.on('predrag'"));
});

test('GPS permission and GPS fix are separate, with one in-flight request', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes("let gpsPermissionState = 'unknown'"));
    assert.ok(appSource.includes("let gpsFixState = 'idle'"));
    assert.ok(appSource.includes('if (gpsFixPromise) return gpsFixPromise;'));
    assert.ok(appSource.includes('gpsFixState = \'pending\';'));
    assert.ok(appSource.includes('async function startNavigationFlow()'));
    assert.ok(appSource.includes('await requestUserGpsLocation(false);'));
    assert.ok(appSource.includes('const shouldRefreshExistingRoute = !!currentEnd && !navigationStartPending;'));
    assert.ok(appSource.includes('if (currentEnd && !currentStart) {'));
    assert.ok(appSource.includes('startNavigationFlow();\n                return;'));
    assert.ok(appSource.includes("e.code === 1 && gpsPermissionState === 'denied'"));
    assert.ok(appSource.includes('The current GPS fix is not ready yet.'));
});

test('startup is north-up and native permission/PiP state is checked before onboarding', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(appSource.includes("let compassMode = 'north-up'"));
    assert.ok(appSource.includes('getLocationPermissionState'));
    assert.ok(appSource.includes('window.RouteState.acquireInitialPosition(navigator.geolocation)'));
    assert.equal(appSource.includes('timeout: 2500'), false);
    assert.ok(appSource.includes('updateGpsAccuracyCircle'));
    assert.equal(html.includes('map-container heading-up-active'), false);
    assert.equal(html.includes('compass-btn heading-up'), false);
});

test('offline map does not issue a second cache.add fetch after tileload', () => {
    const source = fs.readFileSync(path.join(root, 'js/offline-map.js'), 'utf8');
    assert.equal(/^\s*cache\.add\(/m.test(source), false);
});

test('routing exposes direct OSRM progress before via-point enrichment', () => {
    const routerSource = fs.readFileSync(path.join(root, 'js/shadow-router.js'), 'utf8');
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(routerSource.includes('typeof options.onProgress === \'function\''));
    assert.ok(routerSource.includes('urls.slice(1)'));
    assert.ok(appSource.includes("onProgress: async progress =>"));
    assert.ok(appSource.includes("route-first-result"));
});

test('route analysis emits heuristic progress before non-blocking scene refinement', async () => {
    const originalFetch = sandbox.fetch;
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    const phases = [];
    let sceneStarted = false;
    let initialBeforeScene = false;
    sandbox.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ routes: [{
            distance: 1000,
            duration: 100,
            geometry: { coordinates: [[0, 0], [0.01, 0]] },
            legs: [{ steps: [] }]
        }] })
    });
    SceneShadow.fetchPrecomputedSceneForRoute = async () => null;
    SceneShadow.fetchSceneForRoute = async () => {
        sceneStarted = true;
        await new Promise(resolve => setTimeout(resolve, 12));
        return {
            precisionReady: true,
            origin: { lat: 0, lng: 0 },
            coverage: { buildings: true, terrain: true, tunnels: true },
            segmentCoverage: [{ buildings: true, terrain: true, tunnels: true }],
            buildings: [], tunnels: [], terrainSamples: [], terrainProfiles: [],
            source: 'mock scene'
        };
    };
    try {
        const result = await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, new Date('2026-06-21T12:00:00Z'), false,
            { onProgress: async progress => {
                const first = phases.length === 0;
                phases.push({
                    phase: progress.analysisPhase,
                    pending: progress.enrichmentPending,
                    mode: progress.analysisMode
                });
                if (first && !sceneStarted) initialBeforeScene = true;
            } }
        );
        assert.ok(phases.length >= 2, `expected initial and refined progress, got ${phases.length}`);
        assert.equal(phases[0].phase, 'heuristic-initial');
        assert.equal(phases[0].pending, true);
        assert.equal(initialBeforeScene, true);
        assert.equal(phases.at(-1).phase, 'precision-final');
        assert.equal(phases.at(-1).pending, false);
        assert.equal(result.backgroundRefinementComplete, true);
        assert.equal(result.enrichmentPending, false);
        assert.equal(result.routes.fastest.analysisMode, 'scene');
    } finally {
        sandbox.fetch = originalFetch;
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
    }
});

test('selected-role scene is fetched before fastest and emits a same-tier partial result', async () => {
    const originalSceneFetch = SceneShadow.fetchSceneForRoute;
    const originalPrecomputedFetch = SceneShadow.fetchPrecomputedSceneForRoute;
    const rawRoutes = [
        { distance: 1100, duration: 100, geometry: { coordinates: [[0, 0], [0.01, 0.0045]] }, legs: [{ steps: [] }] },
        { distance: 1200, duration: 112, geometry: { coordinates: [[0, 0], [0, 0.01]] }, legs: [{ steps: [] }] },
        { distance: 1250, duration: 118, geometry: { coordinates: [[0, 0], [0, -0.01]] }, legs: [{ steps: [] }] }
    ];
    const fetchedEndpoints = [];
    const phases = [];
    SceneShadow.fetchPrecomputedSceneForRoute = async () => null;
    SceneShadow.fetchSceneForRoute = async coordinates => {
        fetchedEndpoints.push(Array.from(coordinates.at(-1)));
        return {
            precisionReady: true,
            origin: { lat: 0, lng: 0 },
            coverage: { buildings: true, terrain: true, tunnels: true },
            segmentCoverage: Array.from({ length: coordinates.length - 1 }, () => ({ buildings: true, terrain: true, tunnels: true })),
            buildings: [], tunnels: [], terrainSamples: [], terrainProfiles: [], source: 'mock scene'
        };
    };
    try {
        const result = await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0.0045, lng: 0.01 }, new Date('2024-06-21T07:00:00Z'), false,
            { candidates: rawRoutes, preferredRouteRole: 'shade', onProgress: async progress => phases.push(progress) }
        );
        assert.ok(fetchedEndpoints[0][0] === 0 && Math.abs(fetchedEndpoints[0][1]) === 0.01);
        assert.deepEqual(fetchedEndpoints[1], [0.01, 0.0045]);
        const partial = phases.find(progress => progress.analysisPhase === 'precision-partial');
        assert.ok(partial);
        assert.equal(partial.enrichmentPending, true);
        assert.ok(partial.refinedCandidateIds.length >= 2);
        assert.ok(['scene', 'mixed-by-role'].includes(partial.analysisMode));
        assert.equal(result.routes.fastest.analyzed.coordinates, rawRoutes[0].geometry.coordinates);
        assert.ok(result.routes.fastest.analyzed.precisionSampling.analysisCoordinateCount < 100);
    } finally {
        SceneShadow.fetchSceneForRoute = originalSceneFetch;
        SceneShadow.fetchPrecomputedSceneForRoute = originalPrecomputedFetch;
    }
});

test('precision progress can replace an active heuristic glare or shade route', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes("progress.analysisPhase === 'precision-final'"));
    assert.ok(appSource.includes('canSwitchActiveGuidance'));
    assert.ok(appSource.includes('navigationSessionRouteGeometry = selectedRouteObj.analyzed'));
    assert.ok(appSource.includes('Guidance updated to the precision'));
    assert.ok(appSource.includes('precisionRerouteCooldownUntil = Date.now() + PRECISION_REROUTE_COOLDOWN_MS'));
    assert.equal(appSource.includes('navigationSessionRouteGeometry = null;\n            precisionReroutePending = false;'), false);
});

test('native and web location sources share the navigation pipeline and resume fix seam', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes('function processNavigationPosition(position, source = \'web-watch\')'));
    assert.ok(appSource.includes("processNavigationPosition(pos, 'web-watch')"));
    assert.ok(appSource.includes('window.__solarlessProcessNavigationPosition'));
    assert.ok(appSource.includes('getLastNavigationLocation'));
    assert.ok(appSource.includes('gps-stale-ignored'));
    assert.ok(appSource.includes('gps-duplicate-ignored'));
});

test('navigation freezes the direct route and permits replacement only through explicit reroute', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes('route-frozen-for-navigation'));
    assert.ok(appSource.includes("progress.analysisPhase === 'precision-partial'"));
    assert.ok(appSource.includes('A partial precision callback is an enrichment'));
    assert.ok(appSource.includes('isLiveNavActive && precisionReadyForRole &&'));
    assert.ok(appSource.includes('A mid-drive request is an explicit reroute'));
    assert.ok(appSource.includes('liveRerouteCommitted = true;'));
});

test('debug diagnostics are debug-only, collapsed, and bounded', () => {
    const source = fs.readFileSync(path.join(root, 'js/debug-logger.js'), 'utf8');
    assert.ok(source.includes('MAX_PENDING = 50'));
    assert.ok(source.includes('debug-diagnostic-card collapsed'));
    assert.ok(source.includes('data-debug-action'));
    assert.ok(source.includes('MAX_ENTRIES'));
    assert.ok(source.includes('password') && source.includes('token'));
});

test('scene fallback UI exposes actionable failure reasons instead of one generic label', () => {
    const appSource = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.ok(appSource.includes('SCENE_PACK_DOWNLOAD_TIMEOUT'));
    assert.ok(appSource.includes('scene tile download timeout'));
    assert.ok(appSource.includes('SCENE_WORKER_TIMEOUT'));
    assert.ok(appSource.includes('scene processing timeout'));
});

test('scene pack worker and regional merge hooks are present', () => {
    assert.ok(fs.existsSync(path.join(root, 'js/scene-pack-worker.js')));
    const worker = fs.readFileSync(path.join(root, 'js/scene-pack-worker.js'), 'utf8');
    const scene = fs.readFileSync(path.join(root, 'js/scene-shadow.js'), 'utf8');
    assert.ok(worker.includes('unzipSync'));
    assert.ok(worker.includes('requested.has(file.name)'));
    assert.ok(worker.includes('postMessage'));
    assert.ok(scene.includes('mergePrecomputedScenes'));
    assert.ok(scene.includes('streamPrecomputedTiles(manifest, tileKeys'));
    assert.equal(scene.includes('for (const tile of tileValues)'), false);
    assert.ok(scene.includes('buildTerrainGrid'));
    assert.ok(scene.includes('rayBuildingCandidateIndices'));
    assert.ok(scene.includes("indexedDB.open('solarless-scene-cache', 2)"));
    assert.ok(scene.includes('PRECOMPUTED_CACHE_MAX_BYTES'));
});

test('release metadata never treats local PBF mtime as extract timestamp', () => {
    const source = fs.readFileSync(path.join(root, 'tools/build-scene-tiles.mjs'), 'utf8');
    assert.ok(source.includes('SCENE_OSM_EXTRACT_TIMESTAMP'));
    assert.ok(source.includes('localFileModifiedAt'));
    assert.ok(source.includes('extractTimestamp: verifiedExtractTimestamp'));
});

test('PiP is map-only and hides every guidance banner', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    const pipController = fs.readFileSync(path.join(root, 'js/pip-controller.js'), 'utf8');
    assert.ok(html.includes('id="pip-mini-icon"'));
    assert.match(css, /body\.pip-mode[\s\S]*\.app-header[\s\S]*display:\s*none\s*!important/);
    assert.match(css, /body\.pip-mode[\s\S]*\.map-container[\s\S]*position:\s*absolute/);
    assert.match(css, /body\.pip-mode \.pip-mini-hud\s*\{\s*display:\s*none\s*!important/);
    assert.ok(pipController.includes("classList.toggle('pip-mode'"));
    assert.ok(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8').includes('prefersReducedMotion() || isPipMode'));
});

test('Android location service activation is permission/provider-aware and reported to JavaScript', () => {
    const plugin = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/solaris/nav/PipPlugin.java'), 'utf8');
    assert.ok(plugin.includes('boolean legacyGranted = activity != null && Build.VERSION.SDK_INT < Build.VERSION_CODES.M'));
    assert.ok(plugin.includes('private static boolean startLocationService(Activity activity)'));
    assert.ok(plugin.includes('hasEnabledLocationProvider(activity)'));
    assert.ok(plugin.includes('result.put("locationServiceStarted", locationServiceStarted)'));
    assert.ok(plugin.includes('navigationActive = locationServiceStarted;'));
});
