const assert = require('node:assert/strict');
const test = require('node:test');

const WeatherRadiation = require('../js/weather-radiation.js');

function route(id, coordinates, duration = 1800) {
    return { id, durationSec: duration, raw: { duration, geometry: { coordinates } } };
}

function mockLocation(lat, lng) {
    return {
        latitude: lat,
        longitude: lng,
        minutely_15: {
            time: ['2026-06-01T00:00', '2026-06-01T00:15', '2026-06-01T00:30'],
            direct_normal_irradiance: [800, 400, 0],
            direct_radiation: [600, 300, 0],
            diffuse_radiation: [100, 150, 200],
            shortwave_radiation: [700, 450, 200]
        },
        hourly: {
            time: ['2026-06-01T00:00', '2026-06-01T01:00'],
            cloud_cover: [20, 80],
            cloud_cover_low: [10, 70],
            cloud_cover_mid: [5, 20],
            cloud_cover_high: [5, 10]
        }
    };
}

test.beforeEach(() => WeatherRadiation._resetForTests());

test('weather route sampling keeps endpoints and deduplicates overlapping candidates', () => {
    const start = new Date('2026-06-01T00:00:00Z');
    const first = route('a', [[-71.10, 42.35], [-70.90, 42.35]], 1800);
    const second = route('b', [[-71.10, 42.35], [-70.90, 42.35]], 1800);
    const one = WeatherRadiation.sampleRoute(first, start);
    const both = WeatherRadiation.sampleRoutes([first, second], start);
    assert.deepEqual([one[0].lng, one[0].lat], [-71.10, 42.35]);
    assert.deepEqual([one.at(-1).lng, one.at(-1).lat], [-70.90, 42.35]);
    assert.equal(both.length, one.length);
    assert.ok(one.length >= 3, 'time or distance interval should add an interior sample');
});

test('15-minute irradiance and hourly cloud cover interpolate independently', () => {
    const location = WeatherRadiation._responseToLocation(mockLocation(42.35, -71.10), { lat: 42.35, lng: -71.10 });
    const profile = { locations: [location], maxNearestSampleMeters: 20000 };
    const result = WeatherRadiation.interpolateAt(profile, 42.35, -71.10, '2026-06-01T00:07:30Z');
    assert.equal(result.dni, 600);
    assert.equal(result.directRadiation, 450);
    assert.equal(result.diffuseRadiation, 125);
    assert.equal(result.cloudCover, 27.5);
});

test('forecast horizon rejects historical and far-future requests without network access', async () => {
    const now = new Date('2026-06-01T00:00:00Z').getTime();
    const candidate = route('a', [[-71.10, 42.35], [-71.09, 42.35]], 600);
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('must not fetch'); };
    const past = await WeatherRadiation.fetchForecastForRoutes(
        [candidate], new Date(now - 2 * 3600000), { nowMs: now, fetchImpl }
    );
    const future = await WeatherRadiation.fetchForecastForRoutes(
        [candidate], new Date(now + 17 * 86400000), { nowMs: now, fetchImpl }
    );
    assert.equal(past.weatherMode, 'clear-sky-fallback');
    assert.equal(past.fallbackReason, 'PAST_FORECAST_UNAVAILABLE');
    assert.equal(future.fallbackReason, 'FORECAST_HORIZON_EXCEEDED');
    assert.equal(calls, 0);
});

test('weather requests share in-flight work and reuse the bounded success cache', async () => {
    const now = new Date('2026-06-01T00:00:00Z').getTime();
    const candidate = route('a', [[-71.10, 42.35], [-71.09, 42.35]], 600);
    let calls = 0;
    const fetchImpl = async url => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 15));
        const parsed = new URL(url);
        const lats = parsed.searchParams.get('latitude').split(',').map(Number);
        const lngs = parsed.searchParams.get('longitude').split(',').map(Number);
        const payload = lats.map((lat, index) => mockLocation(lat, lngs[index]));
        return { ok: true, status: 200, json: async () => payload.length === 1 ? payload[0] : payload };
    };
    const options = { nowMs: now, fetchImpl, timeoutMs: 1000 };
    const [first, second] = await Promise.all([
        WeatherRadiation.fetchForecastForRoutes([candidate], new Date(now), options),
        WeatherRadiation.fetchForecastForRoutes([candidate], new Date(now), options)
    ]);
    const third = await WeatherRadiation.fetchForecastForRoutes([candidate], new Date(now), options);
    assert.equal(first.available, true);
    assert.equal(second, first);
    assert.equal(third, first);
    assert.equal(calls, 1);
    assert.equal(WeatherRadiation._inFlightSize(), 0);
    assert.equal(WeatherRadiation._cacheSize(), 1);
});

test('failed weather requests use a short negative cache and never poison success entries', async () => {
    const now = new Date('2026-06-01T00:00:00Z').getTime();
    const candidate = route('a', [[-71.10, 42.35], [-71.09, 42.35]], 600);
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('forecast unavailable'); };
    const options = { nowMs: now, fetchImpl, timeoutMs: 1000, negativeTtlMs: 10 };
    await assert.rejects(() => WeatherRadiation.fetchForecastForRoutes([candidate], new Date(now), options));
    await assert.rejects(() => WeatherRadiation.fetchForecastForRoutes([candidate], new Date(now), options));
    assert.equal(calls, 1);
    await assert.rejects(() => WeatherRadiation.fetchForecastForRoutes(
        [candidate], new Date(now), { ...options, nowMs: now + 20 }
    ));
    assert.equal(calls, 2);
});

test('aborted weather requests clean their in-flight entry and return no fallback result', async () => {
    const now = new Date('2026-06-01T00:00:00Z').getTime();
    const candidate = route('a', [[-71.10, 42.35], [-71.09, 42.35]], 600);
    const controller = new AbortController();
    const fetchImpl = (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });
    const request = WeatherRadiation.fetchForecastForRoutes(
        [candidate], new Date(now), { nowMs: now, fetchImpl, timeoutMs: 1000, signal: controller.signal }
    );
    controller.abort();
    await assert.rejects(request, error => error && error.name === 'AbortError');
    assert.equal(WeatherRadiation._inFlightSize(), 0);
    assert.equal(WeatherRadiation._cacheSize(), 0);
});

test('weather timeout is injectable and bounded cache evicts old route cells', async () => {
    const now = new Date('2026-06-01T00:00:00Z').getTime();
    const hangingFetch = (url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            const error = new Error('timeout');
            error.name = 'AbortError';
            reject(error);
        }, { once: true });
    });
    const timedOut = WeatherRadiation.fetchForecastForRoutes(
        [route('timeout', [[-71.10, 42.35], [-71.09, 42.35]], 600)],
        new Date(now), { nowMs: now, fetchImpl: hangingFetch, timeoutMs: 5 }
    );
    await assert.rejects(timedOut, error => error && error.name === 'AbortError');
    assert.equal(WeatherRadiation._inFlightSize(), 0);

    WeatherRadiation._resetForTests();
    let calls = 0;
    const fetchImpl = async url => {
        calls++;
        const parsed = new URL(url);
        const lats = parsed.searchParams.get('latitude').split(',').map(Number);
        const lngs = parsed.searchParams.get('longitude').split(',').map(Number);
        const payload = lats.map((lat, index) => mockLocation(lat, lngs[index]));
        return { ok: true, status: 200, json: async () => payload.length === 1 ? payload[0] : payload };
    };
    for (let index = 0; index < 3; index++) {
        const lng = -71.10 + index;
        await WeatherRadiation.fetchForecastForRoutes(
            [route(`cache-${index}`, [[lng, 42.35], [lng + 0.01, 42.35]], 600)],
            new Date(now), { nowMs: now, fetchImpl, timeoutMs: 100, maxCacheEntries: 2 }
        );
    }
    assert.equal(calls, 3);
    assert.equal(WeatherRadiation._cacheSize(), 2);
});
