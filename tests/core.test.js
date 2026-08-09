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
    setTimeout,
    clearTimeout,
    isFinite,
    fetch: () => Promise.reject(new Error('network is not used in unit tests')),
    Worker: undefined
};
sandbox.window = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

for (const file of ['js/suncalc.js', 'js/route-state.js', 'js/scene-shadow.js', 'js/shadow-router.js', 'js/geocoder.js', 'js/offline-map.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const ShadowRouter = sandbox.ShadowRouter;
const OfflineMap = sandbox.OfflineMap;
const SceneShadow = sandbox.SceneShadow;
const RouteState = sandbox.RouteState;
const Geocoder = sandbox.Geocoder;

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
        const result = await ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: 0, lng: 0 }, { lat: 0, lng: 1 }, new Date(0), false
        );
        assert.ok(result && result.routes && result.routes.fastest);
    } finally {
        sandbox.fetch = originalFetch;
        sandbox.window.SceneShadow = originalScene;
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
    assert.equal(requestedUrls.length, 5);
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
});

test('nearest OSM way geometry determines the speed limit', async () => {
    const originalFetch = sandbox.fetch;
    sandbox.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ elements: [
            { type: 'way', id: 1, tags: { highway: 'primary', maxspeed: '30 mph', name: 'Nearby Road' }, geometry: [{ lat: 40, lon: -74.0002 }, { lat: 40, lon: -74.0001 }] },
            { type: 'way', id: 2, tags: { highway: 'motorway', maxspeed: '70 mph', name: 'Distant Highway' }, geometry: [{ lat: 40.01, lon: -74.01 }, { lat: 40.01, lon: -74.00 }] }
        ] })
    });
    try {
        const road = await Geocoder.fetchCurrentRoadSpeedLimitAndRules(40, -74);
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
