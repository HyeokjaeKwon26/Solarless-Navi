const { test, expect } = require('@playwright/test');
const { version: mapVersion } = require('maplibre-gl/package.json');

const places = {
    Alpha: [-71.065, 42.37],
    Bravo: [-71.06, 42.375],
    Charlie: [-71.055, 42.38]
};
const style = {
    version: 8,
    sources: { fixture: { type: 'geojson', data: {
        type: 'FeatureCollection', features: [{ type: 'Feature', properties: {},
            geometry: { type: 'Point', coordinates: [-71.07, 42.36] } }]
    } } },
    layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#dde6ed' } },
        { id: 'fixture', type: 'circle', source: 'fixture', paint: { 'circle-radius': 8, 'circle-color': '#2244cc' } }
    ]
};

async function fixtures(page, { brokenMap = false, holdBravo = false } = {}) {
    const state = { routes: [], errors: [], releaseBravo: null, bravoFinished: false };
    page.on('pageerror', error => state.errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => {
        localStorage.setItem('solarless_auto_free_drive_enabled', 'false');
        let nextId = 0;
        const watchers = new Map();
        let coords = { latitude: 42.36, longitude: -71.07, accuracy: 5, heading: 45, speed: 12,
            altitude: 0, altitudeAccuracy: 5 };
        const fix = () => ({ coords: { ...coords }, timestamp: Date.now() });
        Object.defineProperty(navigator, 'geolocation', { value: {
            getCurrentPosition(success) { setTimeout(() => success(fix()), 0); },
            watchPosition(success) {
                const id = ++nextId;
                watchers.set(id, success);
                setTimeout(() => { if (watchers.has(id)) success(fix()); }, 0);
                return id;
            },
            clearWatch(id) { watchers.delete(id); }
        } });
        window.testGps = {
            emit(update) { coords = { ...coords, ...update }; for (const callback of watchers.values()) callback(fix()); },
            watchers() { return watchers.size; }
        };
    });
    // No public routing, geocoding, weather or tile service is contacted.
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.hostname === '127.0.0.1') return route.continue();
        const json = data => route.fulfill({ json: data });
        if (url.hostname === 'tiles.openfreemap.org') {
            return brokenMap ? route.abort() : json(style);
        }
        if (url.hostname === 'tile.openstreetmap.org') {
            return route.fulfill({ contentType: 'image/png', body: Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
        }
        if (url.pathname === '/reverse') return json({ display_name: 'Fixture road, Boston', address: { country_code: 'us' } });
        if (url.hostname === 'photon.komoot.io' || url.pathname === '/search') {
            const name = url.searchParams.get('q');
            const coordinates = places[name];
            if (url.hostname === 'photon.komoot.io') return json({ features: coordinates ? [{
                geometry: { type: 'Point', coordinates }, properties: { name, city: 'Boston', country: 'United States' }
            }] : [] });
            return json(coordinates ? [{ name, display_name: `${name}, Boston`, lon: coordinates[0], lat: coordinates[1] }] : []);
        }
        if (url.pathname.startsWith('/route/v1/driving/')) {
            const points = decodeURIComponent(url.pathname.split('/').pop()).split(';').map(point => point.split(',').map(Number));
            const start = points[0];
            const end = points.at(-1);
            state.routes.push(end);
            if (holdBravo && Math.abs(end[1] - places.Bravo[1]) < 0.000001) {
                await new Promise(resolve => { state.releaseBravo = resolve; });
            }
            const coordinates = Array.from({ length: 41 }, (_, i) => [
                start[0] + (end[0] - start[0]) * i / 40,
                start[1] + (end[1] - start[1]) * i / 40
            ]);
            const geometry = { type: 'LineString', coordinates };
            await json({ code: 'Ok', waypoints: [{ location: start }, { location: end }], routes: [{
                distance: 2400, duration: 300, geometry,
                legs: [{ distance: 2400, duration: 300, steps: [
                    { name: 'Fixture Road', distance: 2400, duration: 300, mode: 'driving', geometry,
                        maneuver: { type: 'depart', location: start, bearing_after: 45 }, intersections: [] },
                    { name: 'Fixture Road', distance: 0, duration: 0, mode: 'driving',
                        geometry: { type: 'LineString', coordinates: [end, end] },
                        maneuver: { type: 'arrive', location: end, bearing_before: 45 }, intersections: [] }
                ] }]
            }] });
            if (Math.abs(end[1] - places.Bravo[1]) < 0.000001) state.bravoFinished = true;
            return;
        }
        return route.fulfill({ status: 503, json: { error: 'Optional service unavailable in regression test' } });
    });
    return state;
}

async function selectDestination(page, name) {
    await page.locator('#destination-input').fill(name);
    await page.locator('#destination-results [role="option"]').first().click();
    await expect(page.locator('#bar-dest-text')).toContainText(name);
}

async function changeDestination(page, name) {
    // During guidance the turn banner occupies the top bar. Use the visible
    // settings drawer, as on a phone, rather than clicking through the banner.
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-open-search-modal').click();
    await selectDestination(page, name);
}

test('MapLibre renders a GeoJSON source using the shipped local module worker', async ({ page, baseURL }) => {
    const requests = [];
    page.on('response', response => { if (response.ok()) requests.push(response.url()); });
    const state = await fixtures(page);
    await page.route(`${baseURL}worker-smoke.html`, route => route.fulfill({ contentType: 'text/html', body:
        '<html><head><link rel="stylesheet" href="css/maplibre-gl.css"></head><body><div id="fixture-map" style="width:400px;height:400px"></div><script src="js/maplibre-gl.js"></script><script src="js/map-provider.js"></script></body></html>' }));
    await page.goto('worker-smoke.html');
    await page.evaluate(style => {
        MapProvider.configureMapLibreRuntime(maplibregl);
        window.fixtureMap = new maplibregl.Map({ container: 'fixture-map', center: [-71.07, 42.36], zoom: 14, style });
    }, style);
    await expect.poll(() => page.evaluate(() => window.fixtureMap.queryRenderedFeatures({ layers: ['fixture'] }).length)).toBeGreaterThan(0);
    expect(await page.evaluate(() => maplibregl.getVersion())).toBe(mapVersion);
    expect(requests.some(url => url.endsWith('/js/maplibre-gl-worker.mjs'))).toBe(true);
    // 6.15 ships a self-contained worker; its shared.mjs is an empty upstream
    // compatibility asset and is no longer requested by the worker.
    expect(state.errors).toEqual([]);
});

test('failed vector styles switch the app to raster fallback', async ({ page }) => {
    const state = await fixtures(page, { brokenMap: true });
    await page.goto('./');
    await expect(page.locator('#map-attribution-text')).not.toContainText('OpenFreeMap');
    await expect(page.locator('#map .leaflet-tile-loaded').first()).toBeAttached();
    expect(state.errors).toEqual([]);
});

test('free drive keeps north-up through GPS updates and resumes after visibility changes', async ({ page }) => {
    const state = await fixtures(page);
    await page.goto('./');
    await page.locator('#btn-start-free-drive').click();
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    await expect(page.locator('#map-perspective-wrapper')).toHaveClass(/heading-up-active/);
    await page.locator('#btn-toggle-compass').click();
    await expect(page.locator('#map-perspective-wrapper')).not.toHaveClass(/heading-up-active/);
    await page.evaluate(() => window.testGps.emit({ heading: 120 }));
    await expect(page.locator('#map-perspective-wrapper')).not.toHaveClass(/heading-up-active/);
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => page.evaluate(() => window.testGps.watchers())).toBeGreaterThan(0);
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    await expect(page.locator('#map-perspective-wrapper')).not.toHaveClass(/heading-up-active/);
    await page.locator('#btn-map-start-nav').click();
    await expect(page.locator('#btn-map-start-nav')).not.toHaveClass(/active/);
    expect(state.routes).toHaveLength(0);
    expect(state.errors).toEqual([]);
});

test('a delayed destination response cannot replace newer live guidance', async ({ page }) => {
    const state = await fixtures(page, { holdBravo: true });
    await page.goto('./');
    await selectDestination(page, 'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    await changeDestination(page, 'Bravo');
    await expect.poll(() => !!state.releaseBravo).toBe(true);
    await changeDestination(page, 'Charlie');
    try {
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('solarless_active_navigation_session') || '{}').name)).toContain('Charlie');
    } finally {
        state.releaseBravo?.();
    }
    await expect.poll(() => state.bravoFinished).toBe(true);
    await expect(page.locator('#bar-dest-text')).toContainText('Charlie');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('solarless_active_navigation_session') || '{}').name)).toContain('Charlie');
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    expect(state.errors).toEqual([]);
    await expect(page.locator('#route-summary-box')).toHaveAttribute('aria-busy', 'false');
});
