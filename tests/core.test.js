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

for (const file of ['js/suncalc.js', 'js/shadow-router.js', 'js/offline-map.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

const ShadowRouter = sandbox.ShadowRouter;
const OfflineMap = sandbox.OfflineMap;

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
