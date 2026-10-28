const { test, expect } = require('@playwright/test');
const { version: mapVersion } = require('maplibre-gl/package.json');

test('fresh start opens settings without free drive on narrow phones and actions share styling', async ({ page }) => {
    const state = await fixtures(page, {brokenMap:true});
    await page.goto('./');
    for (const width of [320,360,384,412]) {
        await page.setViewportSize({width,height:820});
        await page.locator('#btn-header-home').click();
        await expect(page.locator('#start-search-modal')).not.toHaveClass(/hidden/);
        const settings = page.locator('#mobile-toggle-panel');
        const rect = await settings.boundingBox();
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x+rect.width).toBeLessThanOrEqual(width);
        expect(rect.width).toBeGreaterThanOrEqual(44);
        await settings.click();
        await expect(page.locator('#start-search-modal')).toHaveClass(/hidden/);
        await expect(page.locator('#sidebar-panel')).toHaveClass(/active/);
        await expect(page.locator('#live-gps-nav-btn')).not.toHaveClass(/active/);
        for (const id of ['btn-check-update','btn-road-pack','btn-road-pack-clear','btn-drive-record','btn-drive-clear','btn-drive-export','btn-arrival-preview']) {
            const button=page.locator('#'+id);
            await button.scrollIntoViewIfNeeded();
            const style=await button.evaluate(el=>({height:el.getBoundingClientRect().height,radius:getComputedStyle(el).borderRadius,bg:getComputedStyle(el).backgroundColor,text:el.textContent}));
            expect(style.height).toBeGreaterThanOrEqual(44);
            expect(style.radius).toBe('10px');
            expect(style.bg).not.toBe('rgb(239, 239, 239)');
            expect(style.text).not.toMatch(/[가-힣]/);
        }
    }
    await page.locator('#btn-check-update').scrollIntoViewIfNeeded();
    await page.screenshot({path:test.info().outputPath('settings-actions.png')});
    await page.locator('#btn-check-update').click();
    await expect(page.locator('#update-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#update-status')).toContainText('Android app');
    expect(state.routes).toEqual([]);
    expect(state.errors).toEqual([]);
});

test('real app launch offers update before free drive and Continue returns to destination entry', async ({ page }) => {
    const state = await fixtures(page, {brokenMap:true});
    const config = require('../../app-release.json');
    const prefix='https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/app-v9.0.0/';
    await page.addInitScript(config=>{
        localStorage.setItem('solarless_update_checked_at',String(Date.now()));
        window.updateCalls={info:0,download:0,install:0};
        window.Capacitor={isNativePlatform:()=>true,Plugins:{App:{addListener:async(name,callback)=>{if(name==='backButton')window.androidBack=callback;return {remove:async()=>{}};}},AppUpdate:{
            getInstalledInfo:async()=>{window.updateCalls.info++;return {...config,sdkInt:34};},
            downloadUpdate:async()=>{window.updateCalls.download++;return {verified:true};},
            installUpdate:async()=>{window.updateCalls.install++;return {installerOpened:true};}
        }}};
    },config);
    await page.route('https://api.github.com/repos/**',route=>route.fulfill({json:route.request().url().includes('/git/matching-refs/') ? [{ref:'refs/tags/app-v9.0.0'}] : {tag_name:'app-v9.0.0',assets:[{name:'update.json',browser_download_url:prefix+'update.json'}]}}));
    await page.route(prefix+'update.json',route=>route.fulfill({json:{...config,versionName:'9.0.0',versionCode:900,schemaVersion:1,sizeBytes:400,sha256:'a'.repeat(64),apkUrl:prefix+'SolarLessNavi-9.0.0.apk',releaseNotes:'Address search and settings improvements.'}}));
    await page.goto('./');
    await expect(page.locator('#update-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#update-info-msg')).toContainText('9.0.0');
    await expect(page.locator('#btn-close-update-modal')).toContainText('Continue for now');
    await expect(page.locator('#update-modal')).toHaveCSS('opacity','1');
    await page.screenshot({path:test.info().outputPath('launch-update.png')});
    await page.locator('#btn-close-update-modal').click();
    await expect(page.locator('#start-search-modal')).not.toHaveClass(/hidden/);
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-check-update').click();
    await expect(page.locator('#update-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#update-info-msg')).toContainText('9.0.0');
    expect(await page.evaluate(()=>window.updateCalls)).toEqual({info:2,download:0,install:0});
    await page.evaluate(()=>window.androidBack());
    await expect(page.locator('#update-modal')).toHaveClass(/hidden/);
    expect(state.routes).toEqual([]);
    expect(state.errors).toEqual([]);
});

const places = {
    Alpha: [-71.065, 42.37],
    Bravo: [-71.06, 42.375],
    Charlie: [-71.055, 42.38]
};

test('confirmed vehicle entrance survives favorite reuse and arrival preview fits narrow screens', async ({page}) => {
    const state=await fixtures(page,{brokenMap:true});
    await page.goto('./');
    await page.locator('#destination-input').fill('Alpha');
    await page.locator('#destination-results [role="option"]').first().click();
    await page.locator('#destination-entrance-confirmed').check();
    await page.locator('#destination-save-favorite').check();
    await expect(page.locator('#destination-review-position')).toContainText('User-confirmed');
    await page.locator('#btn-review-confirm').click();
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    const favorite=await page.evaluate(()=>JSON.parse(localStorage.getItem('solaris_favorites')).at(-1));
    expect(favorite.coords.source).toBe('user-pin');expect(favorite.coords.entranceConfirmed).toBe(true);
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-arrival-preview').click();
    await expect(page.locator('#destination-review-title')).toHaveText('Arrival approach preview');
    await expect(page.locator('#destination-review-modal')).toHaveCSS('opacity','1');
    await expect(page.locator('#destination-review-note')).toContainText('yellow: route endpoint');
    await expect(page.locator('#destination-access-options')).toBeHidden();
    for(const size of [{width:320,height:740},{width:640,height:320}]) {
        await page.setViewportSize(size);
        await page.locator('#btn-review-confirm').scrollIntoViewIfNeeded();
        const box=await page.locator('.destination-review-card').boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width+1);
        await expect.poll(()=>page.evaluate(()=>{
            const map=document.getElementById('destination-review-map').getBoundingClientRect();
            const pin=document.querySelector('#destination-review-map .destination-review-pin').getBoundingClientRect();
            return pin.top>=map.top && pin.bottom<=map.bottom && pin.left>=map.left && pin.right<=map.right;
        })).toBe(true);
        await page.screenshot({path:test.info().outputPath(`arrival-${size.width}.png`)});
    }
    await page.locator('#btn-review-confirm').click();
    await page.setViewportSize({width:412,height:915});
    await page.locator('#btn-header-home').click();
    await page.locator('.fav-chip-btn').filter({hasText:'Alpha'}).click();
    await expect(page.locator('#destination-entrance-confirmed')).toBeChecked();
    await expect(page.locator('#destination-review-position')).toContainText('User-confirmed');
    await page.locator('#btn-review-adjust').click();
    await page.locator('#destination-review-map').click({position:{x:200,y:65}});
    await expect(page.locator('#destination-entrance-confirmed')).not.toBeChecked();
    expect(state.errors).toEqual([]);
});

test('confirmed full closures prevent early route preview and final guidance candidates', async ({page}) => {
    const state=await fixtures(page,{brokenMap:true});
    await page.goto('./');
    const result=await page.evaluate(async()=>{
        const now=Date.now(),points=[[-71.07,42.36],[-71.065,42.37]];
        const feed=PublicTraffic.parseMA({feed_info:{update_date:new Date(now).toISOString()},features:[{
            id:'closed',geometry:{type:'LineString',coordinates:points},properties:{
                start_date:new Date(now-60000).toISOString(),end_date:new Date(now+60000).toISOString(),
                vehicle_impact:'all-lanes-closed',is_start_date_verified:true,is_end_date_verified:true,
                is_start_position_verified:true,is_end_position_verified:true,
                core_details:{road_names:['Fixture Road'],direction:'northbound'}}}]},now);
        PublicTraffic.load=async()=>[feed];
        let previews=0;
        try { await ShadowRouter.fetchAndAnalyzeRoutes({lat:42.36,lng:-71.07},{lat:42.37,lng:-71.065},new Date(),false,
            {onProgress:()=>previews++,viaRequestBudget:0,disableWeatherRefinement:true});return {previews,code:'unexpected-success'}; }
        catch(error){return {previews,code:error.code,key:error.messageKey};}
    });
    expect(result).toEqual({previews:0,code:'CONFIRMED_CLOSURE',key:'routeClosureError'});
    expect(state.errors).toEqual([]);
});
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

async function fixtures(page, { brokenMap = false, holdBravo = false, chained = false, initialAccuracy = 5, holdWatchFix = false } = {}) {
    const state = { routes: [], errors: [], releaseBravo: null, bravoFinished: false };
    page.on('pageerror', error => state.errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(({initialAccuracy, holdWatchFix}) => {
        localStorage.setItem('solarless_auto_free_drive_enabled', 'false');
        let nextId = 0;
        const watchers = new Map();
        let coords = { latitude: 42.36, longitude: -71.07, accuracy: initialAccuracy, heading: 45, speed: 12,
            altitude: 0, altitudeAccuracy: 5 };
        const fix = () => ({ coords: { ...coords }, timestamp: Date.now() });
        Object.defineProperty(navigator, 'geolocation', { value: {
            getCurrentPosition(success) { setTimeout(() => success(fix()), 0); },
            watchPosition(success) {
                const id = ++nextId;
                watchers.set(id, success);
                setTimeout(() => { if (!holdWatchFix && watchers.has(id)) success(fix()); }, 0);
                return id;
            },
            clearWatch(id) { watchers.delete(id); }
        } });
        window.testGps = {
            emit(update) { coords = { ...coords, ...update }; for (const callback of watchers.values()) callback(fix()); },
            watchers() { return watchers.size; }
        };
    }, {initialAccuracy, holdWatchFix});
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
                    { name: 'Fixture Road', distance: 600, duration: 75, mode: 'driving',
                        geometry: { type: 'LineString', coordinates: coordinates.slice(0, 11) },
                        maneuver: { type: 'depart', location: start, bearing_after: 45 }, intersections: [] },
                    { name: 'Fixture Road', exits: '7', destinations: 'Downtown', distance: chained ? 240 : 1800, duration: chained ? 30 : 225, mode: 'driving',
                        geometry: { type: 'LineString', coordinates: coordinates.slice(10) },
                        maneuver: { type: 'turn', modifier: 'slight right', location: coordinates[10], bearing_after: 45 },
                        intersections: [{ location: coordinates[10], lanes: [{ valid: false, indications:['left'] }, { valid: true, indications:['straight','slight right'] }, { valid: true, indications:['slight right'] }] }] },
                    ...(chained ? [{ name: 'Second Street', distance: 1560, duration: 195, mode: 'driving',
                        geometry: { type: 'LineString', coordinates: coordinates.slice(14) },
                        maneuver: { type: 'turn', modifier: 'left', location: coordinates[14], bearing_after: 315 }, intersections: [] }] : []),
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
    const navigating = await page.locator('#live-gps-nav-btn').evaluate(button => button.classList.contains('active'));
    await page.locator('#destination-input').fill(name);
    await page.locator('#destination-results [role="option"]').first().click();
    if (!navigating) {
        await expect(page.locator('#destination-review-modal')).toBeVisible();
        await page.locator('#btn-review-confirm').click();
    }
    await expect(page.locator('#bar-dest-text')).toContainText(name);
}

async function changeDestination(page, name) {
    // During guidance the turn banner occupies the top bar. Use the visible
    // settings drawer, as on a phone, rather than clicking through the banner.
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-open-search-modal').click();
    await selectDestination(page, name);
}

test('destination review can cancel and adjust the pin before requesting any route', async ({page}) => {
    const state=await fixtures(page,{brokenMap:true});
    await page.goto('./');
    await page.locator('#destination-input').fill('Alpha');
    await page.locator('#destination-results [role="option"]').first().click();
    await expect(page.locator('#destination-review-modal')).toBeVisible();
    await expect(page.locator('#start-search-modal')).toBeHidden();
    await expect(page.locator('#destination-review-position')).toContainText('entrance unverified');
    expect(state.routes).toEqual([]);
    await page.locator('#btn-review-cancel').click();
    await expect(page.locator('#start-search-modal')).toBeVisible();
    expect(state.routes).toEqual([]);
    await page.locator('#destination-input').fill('Alpha');
    await page.locator('#destination-input-search').click();
    await page.locator('#destination-results [role="option"]').first().click();
    await page.locator('#btn-review-adjust').click();
    await page.locator('#destination-review-map').click({position:{x:200,y:65}});
    await expect(page.locator('#destination-review-position')).toContainText('Adjusted pin');
    const selected=await page.locator('#destination-review-position').textContent();
    const [lat,lng]=selected.split(' · ')[0].split(', ').map(Number);
    await expect(page.locator('#destination-review-modal')).toHaveCSS('opacity','1');
    await page.screenshot({path:test.info().outputPath('destination-review.png')});
    await page.locator('#btn-review-confirm').click();
    await expect.poll(()=>state.routes.length).toBeGreaterThan(0);
    expect(state.routes[0][0]).toBeCloseTo(lng,4);expect(state.routes[0][1]).toBeCloseTo(lat,4);
    expect(state.errors).toEqual([]);
});

test('voice preview sends Korean and English segments to native speech and respects mute', async ({page}) => {
    const state=await fixtures(page,{brokenMap:true});
    await page.addInitScript(()=>{
        window.voiceRequests=[];
        window.Capacitor={Plugins:{Pip:{stopFocusedSpeech:async()=>{},speakFocused:async args=>{window.voiceRequests.push(args);return {accepted:true};}}}};
    });
    await page.goto('./');
    await page.evaluate(()=>window.TTSVoice.setLanguage('ko-KR'));
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-preview-voice').click();
    await expect.poll(()=>page.evaluate(()=>window.voiceRequests.length)).toBe(1);
    const plan=await page.evaluate(()=>window.voiceRequests[0].segments);
    expect(plan.map(p=>p.lang)).toEqual(['ko-KR','en-US','ko-KR','en-US','ko-KR']);
    expect(plan.filter(p=>p.lang==='en-US').map(p=>p.text)).toEqual(['Lee Street','Harvard Avenue']);
    await page.evaluate(()=>window.TTSVoice.toggleMute());
    await page.locator('#btn-preview-voice').click();
    expect(await page.evaluate(()=>window.voiceRequests.length)).toBe(1);
    expect(state.errors).toEqual([]);
});

test('registering Home requires choosing and confirming an address instead of saving the first hit', async ({page}) => {
    const state=await fixtures(page,{brokenMap:true});
    page.removeAllListeners('dialog'); page.on('dialog',dialog=>dialog.accept('Alpha'));
    await page.route('https://photon.komoot.io/**',route=>route.fulfill({json:{features:Object.entries(places).slice(0,2).map(([name,coordinates])=>({geometry:{coordinates},properties:{name,city:'Boston',country:'United States'}}))}}));
    await page.goto('./');
    await page.locator('.fav-chip-btn').first().click();
    await expect(page.locator('#destination-results [role="option"]')).toHaveCount(2);
    expect(await page.evaluate(()=>localStorage.getItem('solaris_favorites'))).toBeNull();
    expect(state.routes).toEqual([]);
    await page.locator('#destination-results [role="option"]').nth(1).click();
    await expect(page.locator('#destination-review-address')).toContainText('Bravo');
    expect(await page.evaluate(()=>localStorage.getItem('solaris_favorites'))).toBeNull();
    await page.locator('#btn-review-confirm').click();
    const home=await page.evaluate(()=>JSON.parse(localStorage.getItem('solaris_favorites'))[0]);
    expect(home.address).toContain('Bravo'); expect(home.coords.lng).toBe(places.Bravo[0]);
    await expect.poll(()=>state.routes.length).toBeGreaterThan(0);
    expect(state.routes[0]).toEqual(places.Bravo); expect(state.errors).toEqual([]);
});

for (const country of ['us', 'gb', 'kr']) test(`navigation units stay consistent across speed, routes, turns and preferences in ${country}`, async ({page}) => {
    const state = await fixtures(page, {brokenMap:true});
    await page.route('**/reverse?**', route => route.fulfill({json:{display_name:'Unit fixture road',address:{country_code:country}}}));
    await page.route('https://overpass-api.de/api/interpreter?**', route => route.fulfill({json:{elements:[{type:'way',id:1,tags:{highway:'primary',maxspeed:'30 mph'},geometry:[{lat:42.36,lon:-71.07},{lat:42.37,lon:-71.065}]}]}}));
    await page.goto('./');
    await expect(page.locator('#origin-input')).toHaveValue(/Unit fixture road/);
    const imperial = country !== 'kr';
    await expect(page.locator('#speed-unit-val')).toHaveText(imperial ? 'mph' : 'km/h');
    await selectDestination(page,'Alpha');
    for (const id of ['eta-fastest','eta-glare','eta-shade']) await expect(page.locator('#'+id)).toHaveText(imperial ? '⏱️ 5 min (1.5 mi)' : '⏱️ 5 min (2.4 km)');
    await page.locator('#btn-map-start-nav').click();
    await establishReliableGuidance(page);
    await expect(page.locator('#speed-val')).toHaveText(imperial ? '27' : '43');
    await expect(page.locator(country === 'us' ? '#limit-val-us' : '#limit-val-kr')).toHaveText(imperial ? '30' : '48');
    await expect(page.locator('#banner-dist')).toHaveText(imperial ? /In [\d.]+ (mi|ft)/ : /In [\d.]+ (km|m)/);
    await expect(page.locator('#sum-dist')).toHaveText(imperial ? / mi$/ : / km$/);
    const rawRemaining = await page.locator('#sum-dist').getAttribute('data-distance-meters');
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#navigation-units').selectOption(imperial ? 'metric' : 'imperial');
    await expect(page.locator('#speed-unit-val')).toHaveText(imperial ? 'km/h' : 'mph');
    await expect(page.locator('#speed-val')).toHaveText(imperial ? '43' : '27');
    await expect(page.locator('#sum-dist')).toHaveText(imperial ? / km$/ : / mi$/);
    await expect(page.locator('#sum-dist')).toHaveAttribute('data-distance-meters',rawRemaining);
    await expect(page.locator('#road-save-label')).toContainText(imperial ? '3.0 km' : '1.9 mi');
    await page.locator('#btn-toggle-lang').click();
    await expect(page.locator('#navigation-units-label')).toHaveText('거리·속도 단위');
    await expect(page.locator('#speed-unit-val')).toHaveText(imperial ? 'km/h' : 'mph');
    await expect(page.locator('#eta-fastest')).toContainText('5분');
    await page.setViewportSize({width:320,height:740});
    const box=await page.locator('#navigation-units').boundingBox();
    expect(box.width).toBeGreaterThan(200);expect(box.x+box.width).toBeLessThanOrEqual(320);
    await page.screenshot({path:test.info().outputPath(`units-${country}.png`)});
    await page.reload();
    await expect(page.locator('#navigation-units')).toHaveValue(imperial ? 'metric' : 'imperial');
    await expect(page.locator('#speed-unit-val')).toHaveText(imperial ? 'km/h' : 'mph');
    expect(state.errors).toEqual([]);
});

test('delayed country correction updates speed number and all units without another GPS tick', async ({page}) => {
    const state=await fixtures(page,{brokenMap:true});
    let release; const pending=new Promise(resolve=>release=resolve);
    await page.route('**/reverse?**',async route=>{await pending;await route.fulfill({json:{display_name:'Corrected country',address:{country_code:'kr'}}});});
    await page.route('https://overpass-api.de/api/interpreter?**',route=>route.fulfill({json:{elements:[]}}));
    await page.goto('./');
    await selectDestination(page,'Alpha');
    await page.locator('#btn-map-start-nav').click();
    await establishReliableGuidance(page);
    await expect(page.locator('#speed-val')).toHaveText('27');
    await expect(page.locator('#speed-unit-val')).toHaveText('mph');
    await page.evaluate(()=>{
        window.unitFrames=[];
        new MutationObserver(()=>window.unitFrames.push([document.getElementById('speed-val').textContent,document.getElementById('speed-unit-val').textContent])).observe(document.getElementById('speedometer-bottom-left'),{subtree:true,childList:true,characterData:true});
    });
    release();
    await expect(page.locator('#speed-unit-val')).toHaveText('km/h');
    await expect(page.locator('#speed-val')).toHaveText('43');
    await expect(page.locator('#eta-fastest')).toContainText('2.4 km');
    await expect(page.locator('#sum-dist')).toHaveText(/ km$/);
    await expect(page.locator('#banner-dist')).toHaveText(/In [\d.]+ (km|m)/);
    const frames=await page.evaluate(()=>window.unitFrames);
    expect(frames.length).toBeGreaterThan(0);
    for(const [value,unit] of frames) expect([value,unit]).toEqual(unit === 'mph' ? ['27','mph'] : ['43','km/h']);
    expect(state.errors).toEqual([]);
});

async function observePreviewMap(page) {
    await page.route('**/js/leaflet.js', async route => {
        const response = await route.fetch();
        await route.fulfill({response,body:(await response.text()) + '\nL.Map.addInitHook(function(){if(this.getContainer().id!=="destination-review-map")window.previewTestMap=this;});'});
    });
}

async function previewGeometry(page, start, end) {
    return page.evaluate(({start,end}) => {
        const map=window.previewTestMap;
        let paths=0;
        map.eachLayer(layer=>{if(layer instanceof L.Polyline && !(layer instanceof L.Polygon)) paths++;});
        const rect=map.getContainer().getBoundingClientRect();
        const top=document.getElementById('map-top-bar').getBoundingClientRect().bottom;
        const bottom=document.getElementById('map-bottom-overlay-stack').getBoundingClientRect().top;
        const endpoints=[start,end].map(point=>{
            const p=map.latLngToContainerPoint([point[1],point[0]]);
            return {visible:map.getBounds().contains([point[1],point[0]]),x:rect.left+p.x,y:rect.top+p.y};
        });
        return {paths,endpoints,top,bottom};
    },{start,end});
}

for (const originKind of ['stale GPS','selected address','coarse GPS']) {
    test(`route preview draws both endpoints with ${originKind} and waits for reliable live GPS`, async ({page})=>{
        const state=await fixtures(page,{brokenMap:true,initialAccuracy:originKind==='coarse GPS'?150:5,holdWatchFix:true});
        await observePreviewMap(page);
        await page.goto('./');
        await expect(page.locator('#origin-input')).toHaveValue(/Fixture road/);
        let start=[-71.07,42.36];
        if(originKind==='selected address'){
            await page.locator('#origin-input').fill('Bravo');
            await page.locator('#origin-input').press('Enter');
            await page.locator('#origin-results [role="option"]').first().click();
            start=places.Bravo;
        }else if(originKind==='stale GPS') await page.waitForTimeout(2200);
        await selectDestination(page,'Alpha');
        await expect(page.locator('#eta-fastest')).toContainText('5 min');
        await expect.poll(async()=> (await previewGeometry(page,start,places.Alpha)).paths).toBeGreaterThan(0);
        const preview=await previewGeometry(page,start,places.Alpha);
        for(const point of preview.endpoints){
            expect(point.visible).toBe(true);
            expect(point.y).toBeGreaterThan(preview.top);
            expect(point.y).toBeLessThan(preview.bottom);
        }
        await expect(page.locator('#route-preview-status')).toBeVisible();
        if(originKind==='selected address') await expect(page.locator('#route-preview-status')).toContainText('selected origin');
        await page.screenshot({path:test.info().outputPath('route-preview.png')});
        await page.locator('#btn-map-start-nav').click();
        // Wait for the health timer that used to overwrite the provisional
        // banner, rather than asserting only during its first frame.
        await expect(page.locator('#guidance-health')).toContainText('Waiting for GPS');
        await expect(page.locator('#banner-dist')).toContainText('Refining GPS');
        await page.evaluate(()=>NavigationUnits.setPreference('metric'));
        await page.locator('#btn-toggle-lang').click();
        await expect(page.locator('#banner-dist')).toContainText('GPS 보정 중');
        await page.locator('#btn-toggle-lang').click();
        await expect(page.locator('#banner-dist')).toContainText('Refining GPS');
        await expect(page.locator('#route-preview-status')).toBeHidden();
        expect((await previewGeometry(page,start,places.Alpha)).paths).toBe(0);
        await page.evaluate(()=>window.testGps.emit({accuracy:150}));
        expect((await previewGeometry(page,start,places.Alpha)).paths).toBe(0);
        await establishReliableGuidance(page);
        await expect.poll(async()=> (await previewGeometry(page,start,places.Alpha)).paths).toBeGreaterThan(0);
        expect(state.errors).toEqual([]);
    });
}

test('route colors legend is readable on narrow and landscape screens and closes without ending guidance',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});
    await page.goto('./');
    await selectDestination(page,'Alpha');
    for(const viewport of [{width:320,height:740},{width:844,height:390}]){
        await page.setViewportSize(viewport);
        const trigger=page.locator('#btn-route-legend');
        await trigger.click();
        await expect(trigger).toHaveAttribute('aria-expanded','true');
        const dialog=page.getByRole('dialog',{name:'Route colors'});
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveCSS('opacity','1');
        await expect(dialog.locator('li')).toHaveCount(5);
        await expect(dialog).toContainText('do not show traffic congestion');
        await expect(dialog).toContainText('not field-verified shade');
        await expect(dialog).toContainText('grayscale');
        const colors=await dialog.locator('.route-legend-swatch').evaluateAll(items=>items.map(item=>getComputedStyle(item).borderTopColor));
        expect(colors).toEqual(['rgb(245, 158, 11)','rgb(124, 58, 237)','rgb(14, 116, 144)','rgb(2, 132, 199)','rgb(100, 116, 139)']);
        const card=await dialog.locator('.route-legend-card').boundingBox();
        expect(card.x).toBeGreaterThanOrEqual(0);expect(card.x+card.width).toBeLessThanOrEqual(viewport.width);
        expect(card.y).toBeGreaterThanOrEqual(0);expect(card.y+card.height).toBeLessThanOrEqual(viewport.height);
        await page.screenshot({path:test.info().outputPath(`legend-${viewport.width}.png`)});
        await expect(page.locator('#btn-close-route-legend')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('#route-legend-modal')).toHaveClass(/hidden/);
        await expect(trigger).toBeFocused();
    }
    await page.setViewportSize({width:412,height:915});
    await page.locator('#btn-toggle-lang').click();
    await page.locator('#btn-route-legend').click();
    await expect(page.getByRole('dialog',{name:'경로 색상 범례'})).toContainText('교통 정체 표시가 아닙니다');
    await page.getByRole('button',{name:'닫기',exact:true}).click();
    await page.locator('#btn-toggle-lang').click();
    await page.locator('#btn-map-start-nav').click();
    await page.locator('#btn-route-legend').click();
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    await page.locator('#btn-route-legend').click();
    // Browser history and Android Back share the same app handler.
    await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));
    await expect(page.locator('#route-legend-modal')).toHaveClass(/hidden/);
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    expect(state.errors).toEqual([]);
});

async function establishReliableGuidance(page) {
    // A route origin older than two seconds correctly starts provisionally.
    // Supply live fixes until its forward replacement and first turn are ready.
    await expect.poll(async () => {
        await page.evaluate(() => window.testGps.emit({ latitude: 42.36005, accuracy: 5 }));
        return page.locator('#banner-lanes').evaluate(el => !el.hidden && document.getElementById('guidance-health')?.hidden ? el.textContent : 'Waiting for accepted GPS');
    }, { timeout: 15000, intervals: [500] }).toContain('Use lane 2, 3 from left');
}

test('driving focus keeps three journey totals visible and exposes analysis separately on a small phone', async ({page}) => {
    const state=await fixtures(page,{brokenMap:true});
    await page.setViewportSize({width:320,height:740});
    await page.goto('./');
    await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    await establishReliableGuidance(page);
    await expect(page.locator('body')).toHaveClass(/driving-focus/);
    for(const id of ['sum-time','sum-duration','sum-dist']) {
        await expect(page.locator('#'+id)).toBeVisible();
        const rect=await page.locator('#'+id).boundingBox();
        expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(320);
    }
    await page.screenshot({path:test.info().outputPath('driving-focus-320.png')});
    for (const language of ['en','ko']) {
        if(language==='ko') await page.locator('#btn-toggle-lang').click();
        for (const [width,height] of [[640,320],[320,740]]) {
            await page.setViewportSize({width,height});
            const boxes=await page.locator('#sum-time,#sum-duration,#sum-dist').evaluateAll(els=>els.map(el=>{
                const r=el.getBoundingClientRect();return {left:r.left,right:r.right};
            }));
            for(const box of boxes){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(width);}
            for(let i=1;i<boxes.length;i++)expect(boxes[i-1].right).toBeLessThanOrEqual(boxes[i].left);
        }
    }
    await page.locator('#btn-toggle-lang').click();
    await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#desc-glare')).toBeHidden();
    await page.locator('#btn-route-analysis').click();
    await expect(page.locator('#journey-detail-body')).toContainText('Model prediction');
    await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));
    await expect(page.locator('#journey-detail-modal')).toBeHidden();
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    await page.locator('#driving-focus-label').click();
    await expect(page.locator('#toggle-driving-focus')).not.toBeChecked();
    await expect(page.locator('body')).not.toHaveClass(/driving-focus/);
    await expect(page.locator('#desc-glare')).toBeVisible();
    expect(await page.evaluate(()=>localStorage.getItem('solarless_driving_focus'))).toBe('false');
    expect(state.errors).toEqual([]);
});

test('restart shows saved dashed preview during route outage and clears it after a verified route',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});
    let unavailable=true;
    await page.route('**/route/v1/driving/**',route=>unavailable?route.fulfill({status:503,json:{code:'NoRoute'}}):route.fallback());
    await page.addInitScript(()=>localStorage.setItem('solarless_active_navigation_session',JSON.stringify({
        end:{lat:42.37,lng:-71.065,source:'user-pin'},name:'Saved Alpha',mode:'fastest',savedAt:Date.now(),
        preview:{version:1,savedAt:Date.now(),end:{lat:42.37,lng:-71.065},coordinates:[[-71.07,42.36],[-71.065,42.37]]}
    })));
    await page.goto('./');
    await expect(page.locator('#cached-preview-status')).toBeVisible();
    await expect(page.locator('#cached-preview-status')).toContainText('new verified route');
    await expect(page.locator('path[stroke-dasharray="8,8"]')).toHaveCount(1);
    await expect(page.locator('#btn-map-start-nav')).toBeDisabled();
    await expect(page.locator('#route-summary-box')).toHaveAttribute('aria-busy','false',{timeout:20000});
    await expect(page.locator('#cached-preview-status')).toBeVisible();
    unavailable=false;
    await page.reload();
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled({timeout:15000});
    await expect(page.locator('#cached-preview-status')).toBeHidden();
    await expect(page.locator('path[stroke-dasharray="8,8"]')).toHaveCount(0);
    expect(state.errors).toEqual([]);
});

test('drive report and export include recorded journey events without claiming measured solar benefits',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});
    await page.goto('./');
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-drive-record').click();
    await page.locator('#btn-open-search-modal').click();
    await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    await establishReliableGuidance(page);
    await page.locator('#mobile-toggle-panel').click();
    await expect.poll(async()=>{
        await page.evaluate(()=>window.testGps.emit({accuracy:5}));
        return page.evaluate(async()=>JSON.parse(await DriveArchive.exportRecording({samples:[]})).events.some(e=>e.type==='match'));
    },{intervals:[500]}).toBe(true);
    await page.locator('#btn-drive-report').click();
    await expect(page.locator('#journey-detail-body')).toContainText('Completed trips: 0');
    await expect(page.locator('#journey-detail-body')).toContainText('actual benefit is unmeasured');
    await page.locator('#btn-close-journey-detail').click();
    const saved=await page.evaluate(async()=>JSON.parse(await DriveArchive.exportRecording({samples:[]})));
    expect(saved.events.some(e=>e.type==='trip-start'&&e.data.predictedDurationSec>0)).toBe(true);
    expect(saved.events.some(e=>e.type==='match')).toBe(true);
    const pending=page.waitForEvent('download');await page.locator('#btn-drive-export').click();
    const download=await pending;
    const exported=JSON.parse(require('node:fs').readFileSync(await download.path(),'utf8'));
    expect(exported.review.solarPredictions.length).toBe(1);
    expect(exported.review.fieldSolarBenefit).toBeNull();
    expect(exported.review.samples).toBeGreaterThan(0);
    expect(state.errors).toEqual([]);
});

test('GPS recovery pauses turns until two consistent new fixes and preference changes cannot revive old guidance',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});
    await page.goto('./');await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();await establishReliableGuidance(page);
    await expect(page.locator('#route-summary-box')).toHaveAttribute('aria-busy','false');
    await page.evaluate(()=>{
        const original=Date.now;window.testTimeOffset=20000;Date.now=()=>original()+window.testTimeOffset;
        window.testGps.emit({latitude:42.3601,accuracy:5});
    });
    await expect(page.locator('#banner-desc')).toContainText('Checking road position');
    await expect(page.locator('#banner-lanes')).toBeHidden();
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#navigation-units').selectOption('metric');
    await expect(page.locator('#banner-desc')).toContainText('Checking road position');
    await page.evaluate(()=>{window.testTimeOffset+=1000;window.testGps.emit({latitude:42.36015,accuracy:5});});
    await expect(page.locator('#banner-desc')).toContainText('Fixture Road');
    expect(state.errors).toEqual([]);
});

test('diagnostic opt-in survives reload, exports persisted events and deletes them', async ({ page }) => {
    const state = await fixtures(page, { brokenMap: true });
    await page.goto('./');
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-drive-record').click();
    await page.evaluate(() => DriveArchive.record('sample', { lat: 42.36, lng: -71.07, timestamp: 123, accuracy: 5 }));
    await page.reload();
    await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#btn-drive-record')).toContainText('Stop recording');
    const saved = await page.evaluate(async () => JSON.parse(await DriveArchive.exportRecording({ samples: [] })));
    expect(saved.version).toBe(2);
    expect(saved.samples.some(s => s.timestamp === 123)).toBe(true);
    await page.locator('#btn-drive-clear').click();
    await expect(page.locator('#btn-drive-record')).toContainText('Record drive');
    expect(await page.evaluate(async () => JSON.parse(await DriveArchive.exportRecording({})).samples.length)).toBe(0);
    expect(state.errors).toEqual([]);
});

test('saved OSM roads survive reload and route in a worker without routing service', async ({ page }) => {
    const state = await fixtures(page, { brokenMap: true });
    const elements = [
        { type: 'node', id: 1, lat: 42.36, lon: -71.07 },
        { type: 'node', id: 2, lat: 42.365, lon: -71.0675 },
        { type: 'node', id: 3, lat: 42.37, lon: -71.065 },
        { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential', name: 'Saved road' } }
    ];
    await page.route('https://overpass.private.coffee/api/interpreter', route => route.fulfill({ json: { elements } }));
    await page.goto('./');
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-road-pack').click();
    await expect(page.locator('#road-pack-status')).toContainText('valid 7 days');
    await page.reload();
    await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#road-pack-status')).toContainText('valid 7 days');
    await page.route('**/route/v1/driving/**', route => route.abort());
    const route = await page.evaluate(async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        const result = await ShadowRouter.fetchAndAnalyzeRoutes({lat:42.36,lng:-71.07},{lat:42.37,lng:-71.065},new Date(),false,{disableWeatherRefinement:true});
        return result.routes.fastest;
    });
    expect(route.offline).toBe(true);
    expect(route.maneuvers.at(-1).type).toBe('arrive');
    expect(route.raw.geometry.coordinates).toEqual([[-71.07,42.36],[-71.0675,42.365],[-71.065,42.37]]);
    await page.locator('#btn-road-pack-clear').click();
    await expect(page.locator('#road-pack-status')).toContainText('No offline road pack');
    expect(state.errors).toEqual([]);
});

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

test('uncertain GPS preserves guidance and local recording exports the sample', async ({ page }) => {
    const state = await fixtures(page);
    await page.goto('./');
    await selectDestination(page, 'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-drive-record').click();
    await page.waitForTimeout(300);
    const before = state.routes.length;
    await page.evaluate(() => window.testGps.emit({ latitude: 42.365, longitude: -71.06, accuracy: 180 }));
    await expect(page.locator('#api-status-banner')).toContainText('GPS accuracy');
    expect(state.routes.length).toBe(before);
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btn-drive-export').click();
    const download = await downloadPromise;
    const fs = require('node:fs');
    const recording = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(recording.samples.some(sample => sample.accuracy === 180)).toBe(true);
    expect(recording.type).toBe('solarless-drive-quality');
    expect(state.errors).toEqual([]);
});

test('offline deviation pauses old turns and reconnect reroutes from the current position', async ({ page }) => {
    const state = await fixtures(page);
    await page.goto('./');
    await selectDestination(page, 'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    await establishReliableGuidance(page);
    // Let optional analysis complete before measuring route requests.
    await expect(page.locator('#route-summary-box')).toHaveAttribute('aria-busy', 'false');
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
        window.dispatchEvent(new Event('offline'));
    });
    await page.waitForTimeout(2400);
    const before = state.routes.length;
    for (let i = 0; i < 3; i++) {
        await page.evaluate(index => window.testGps.emit({ latitude: 42.36 + index * 0.00005,
            longitude: -71.0686, accuracy: 5, speed: 12 }), i);
        await page.waitForTimeout(1100);
    }
    await expect(page.locator('#guidance-health')).toContainText('Offline');
    await expect(page.locator('#banner-desc')).toContainText('turn guidance paused');
    expect(state.routes.length).toBe(before);
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
        window.dispatchEvent(new Event('online'));
    });
    await expect.poll(() => state.routes.length).toBeGreaterThan(before);
    await expect(page.locator('#bar-dest-text')).toContainText('Alpha');
    expect(state.errors).toEqual([]);
});

test('lane guidance renders and GPS silence is reported until a reliable fix returns', async ({ page }) => {
    const state = await fixtures(page);
    await page.goto('./');
    await selectDestination(page, 'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    await establishReliableGuidance(page);
    await expect(page.locator('#banner-lanes')).toContainText('Use lane 2, 3 from left');
    await expect(page.locator('#banner-lanes')).toBeVisible();
    await expect(page.locator('#guidance-health')).toBeHidden();
    await page.screenshot({ path: `.codex-remote-attachments/lanes-${test.info().project.name}.png` });
    await expect(page.locator('#guidance-health')).toContainText('Waiting for GPS', { timeout: 13000 });
    await page.evaluate(()=>NavigationUnits.setPreference('metric'));
    await expect(page.locator('#banner-dist')).toHaveText('—');
    await expect(page.locator('#banner-desc')).toContainText('Waiting for GPS');
    await page.evaluate(() => window.testGps.emit({ latitude: 42.3601 }));
    await expect(page.locator('#guidance-health')).toBeHidden();
    expect(state.errors).toEqual([]);
});


test('chained turns and exit details clear when heading contradicts the selected road', async ({ page }) => {
    const state = await fixtures(page, { chained: true });
    await page.goto('./');
    await selectDestination(page, 'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    await establishReliableGuidance(page);
    await expect(page.locator('#banner-desc')).toContainText('Exit 7');
    await expect(page.locator('#banner-following')).toContainText('Then in');
    await expect(page.locator('#banner-following')).toBeVisible();
    await expect(page.locator('#banner-following')).toContainText('Second Street');
    await expect(page.locator('#banner-lanes')).toContainText('current lane not detected');
    await expect(page.locator('.lane-chips .lane-valid').first()).toHaveText('↑↗');
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.testGps.emit({ latitude: 42.36015, heading: 225 }));
    await expect(page.locator('#banner-desc')).toContainText('Checking road position');
    await expect(page.locator('#banner-lanes')).toBeHidden();
    await expect(page.locator('#banner-following')).toBeHidden();
    await page.waitForTimeout(1600);
    await page.evaluate(() => window.testGps.emit({ latitude: 42.3602, heading: 20 }));
    await expect(page.locator('#banner-desc')).toContainText('Exit 7');
    expect(state.errors).toEqual([]);
});

test('restart restores the saved destination and toll preference through a fresh route', async ({ page }) => {
    test.setTimeout(60000);
    const state = await fixtures(page);
    await page.addInitScript(() => localStorage.setItem('solarless_active_navigation_session', JSON.stringify({
        end: { lat: 42.37, lng: -71.065 }, name: 'Saved Alpha', mode: 'fastest', tollFree: true, savedAt: Date.now()
    })));
    await page.goto('./');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled({ timeout: 15000 });
    await page.locator('#btn-map-start-nav').click();
    await expect(page.locator('#btn-map-start-nav')).toHaveClass(/active/);
    await expect(page.locator('#toggle-toll-free')).toBeChecked();
    await expect(page.locator('#bar-dest-text')).toContainText('Saved Alpha');
    await establishReliableGuidance(page);
    expect(state.routes.length).toBeGreaterThan(0);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('solarless_active_navigation_session')));
    expect(saved.tollFree).toBe(true);
    expect(saved.mode).toBe('fastest');
    expect(state.errors).toEqual([]);
});

async function batteryFixture(page, health) {
    const state = await fixtures(page, { brokenMap: true });
    await page.addInitScript(initial => {
        const callbacks = new Map();
        window.healthTest = {
            health: initial, calls: 0, deferNext: false,
            emit(next) { this.health = { ...this.health, ...next }; callbacks.get('runtimeHealthChanged')?.(); }
        };
        window.Capacitor = { isNativePlatform: () => false, Plugins: { Pip: {
            addListener: async (name, callback) => {
                callbacks.set(name, callback);
                return { remove: async () => callbacks.delete(name) };
            },
            getRuntimeHealth: async () => {
                window.healthTest.calls++;
                const snapshot = { ...window.healthTest.health };
                if (window.healthTest.deferNext) {
                    window.healthTest.deferNext = false;
                    return new Promise(resolve => { window.healthTest.finishRead = () => resolve(snapshot); });
                }
                return snapshot;
            }
        } } };
    }, health);
    await page.goto('./');
    await expect.poll(() => page.evaluate(() => window.healthTest.calls)).toBeGreaterThan(0);
    return state;
}

test('automatic saver can be turned off and later health checks respect normal mode', async ({ page }) => {
    const state = await batteryFixture(page, { batteryPercent: 10, charging: false, powerSaveMode: true, thermalStatus: 2 });
    await expect(page.locator('body')).toHaveClass(/battery-saver-active/);
    await page.locator('#btn-start-free-drive').click();
    const button = page.locator('#btn-toggle-battery-saver');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('body')).not.toHaveClass(/battery-saver-active/);
    expect(await page.evaluate(() => localStorage.getItem('solarless_battery_saver'))).toBe('false');
    const before = await page.evaluate(() => window.healthTest.calls);
    await page.clock.setFixedTime(new Date(Date.now() + 31000));
    await expect.poll(() => page.evaluate(() => window.healthTest.calls)).toBeGreaterThan(before);
    await expect(page.locator('body')).not.toHaveClass(/battery-saver-active/);
    await expect(page.locator('#guidance-health')).not.toContainText('Automatic battery saver active');
    await page.evaluate(() => window.healthTest.emit({ charging: true, externalPowerConnected: true }));
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/battery-saver-active/);
    expect(state.errors).toEqual([]);
});

test('charging and resume update automatic saver even before navigation starts', async ({ page }) => {
    const state = await batteryFixture(page, { batteryPercent: 10, charging: false });
    await expect(page.locator('body')).toHaveClass(/battery-saver-active/);
    await page.evaluate(() => window.healthTest.emit({ externalPowerConnected: true }));
    await expect(page.locator('body')).not.toHaveClass(/battery-saver-active/);
    await page.evaluate(() => window.healthTest.emit({ externalPowerConnected: false }));
    await expect(page.locator('body')).toHaveClass(/battery-saver-active/);
    await page.evaluate(() => {
        window.healthTest.health.charging = true;
        document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.locator('body')).not.toHaveClass(/battery-saver-active/);
    expect(state.routes).toEqual([]);
    expect(state.errors).toEqual([]);
});

test('charging event supersedes an in-flight device reading', async ({ page }) => {
    const state = await batteryFixture(page, { batteryPercent: 10, charging: true });
    await expect(page.locator('body')).not.toHaveClass(/battery-saver-active/);
    await page.evaluate(() => {
        window.healthTest.deferNext = true;
        window.healthTest.emit({ charging: false });
    });
    await expect.poll(() => page.evaluate(() => typeof window.healthTest.finishRead)).toBe('function');
    const before = await page.evaluate(() => window.healthTest.calls);
    await page.evaluate(() => {
        window.healthTest.emit({ charging: true });
        window.healthTest.finishRead();
    });
    await expect.poll(() => page.evaluate(() => window.healthTest.calls)).toBeGreaterThan(before);
    await expect(page.locator('body')).not.toHaveClass(/battery-saver-active/);
    expect(state.errors).toEqual([]);
});

test('manual saver remains on when plugged in and can still be switched off', async ({ page }) => {
    const state = await batteryFixture(page, { batteryPercent: 90, charging: false });
    await page.locator('#btn-start-free-drive').click();
    const button = page.locator('#btn-toggle-battery-saver');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => window.healthTest.emit({ charging: true, externalPowerConnected: true }));
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/battery-saver-active/);
    await page.locator('#btn-start-free-drive').click();
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(state.errors).toEqual([]);
});

test('manual battery saver persists across a page restart', async ({ page }) => {
    const state = await fixtures(page);
    await page.goto('./');
    await page.locator('#btn-start-free-drive').click();
    await page.locator('#btn-toggle-battery-saver').click();
    await expect(page.locator('body')).toHaveClass(/battery-saver-active/);
    await page.reload();
    await expect(page.locator('body')).toHaveClass(/battery-saver-active/);
    await expect(page.locator('#btn-toggle-battery-saver')).toHaveAttribute('aria-pressed', 'true');
    expect(state.errors).toEqual([]);
});

test('numbered address search hides fuzzy suggestions and requires choosing the full address', async ({ page }) => {
    const state = await fixtures(page, { brokenMap: true });
    let submits = 0;
    await page.route('https://photon.komoot.io/**', route => route.fulfill({json:{features:[{
        geometry:{coordinates:[-79.183,42.219]}, properties:{name:'East Side Overland Hiking Trail - Gerry Rd',street:'Gerry-Ellington Road',housenumber:'1985'}
    }]}}));
    await page.route('https://nominatim.openstreetmap.org/search?**', route => {
        submits++;
        return route.fulfill({json:[
            {lat:'42.3006881',lon:'-71.1570098',display_name:'94, Gerry Road, Brookline, Massachusetts, 02467',address:{house_number:'94',road:'Gerry Road'}},
            {lat:'42.5261573',lon:'-71.0308517',display_name:'94, Gerry Road, Lynnfield, Massachusetts, 01940',address:{house_number:'94',road:'Gerry Road'}}
        ]});
    });
    await page.goto('./');
    await expect(page.locator('#btn-close-start-search')).toHaveCount(0);
    await page.locator('#destination-input').fill('94 gerry rd');
    await expect(page.locator('#destination-results')).toContainText('This address may still be available');
    expect(submits).toBe(0);
    await expect(page.locator('#destination-results [role="option"]')).toHaveCount(0);
    await page.getByRole('button', {name:'Search this address: 94 gerry rd', exact:true}).click();
    await expect(page.locator('#destination-results [role="option"]')).toHaveCount(2);
    expect(submits).toBe(1);
    expect(state.routes.length).toBe(0);
    await expect(page.locator('#start-search-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#destination-results')).toContainText('Brookline');
    await expect(page.locator('#destination-results')).toContainText('Lynnfield');
    await page.screenshot({path: test.info().outputPath('address-candidates.png')});
    await page.locator('#destination-results [role="option"]').first().click();
    await expect(page.locator('#destination-review-address')).toContainText('Brookline');
    expect(state.routes).toEqual([]);
    await page.locator('#btn-review-confirm').click();
    await expect(page.locator('#bar-dest-text')).toContainText('Brookline');
    await expect.poll(() => state.routes.length).toBeGreaterThan(0);
    expect(state.routes[0]).toEqual([-71.1570098,42.3006881]);
    await expect(page.locator('#desc-glare')).toContainText('Same as fastest');
    await expect(page.locator('#desc-shade')).toContainText('Same as fastest');
    await expect(page.locator('#desc-glare')).not.toContainText('No meaningful alternative');
    expect(state.errors).toEqual([]);
});

test('failed address lookup offers retry and recovers without restarting', async ({ page }) => {
    const state = await fixtures(page, {brokenMap:true});
    let offline = true;
    await page.route('https://photon.komoot.io/**', route => route.fulfill({json:{features:[]}}));
    await page.route('https://nominatim.openstreetmap.org/search?**', route => offline
        ? route.fulfill({status:503,body:'unavailable'})
        : route.fulfill({json:[{lat:'42.3006881',lon:'-71.1570098',
            display_name:'94, Gerry Road, Brookline, Massachusetts, 02467',
            address:{house_number:'94',road:'Gerry Road'}}]}));
    await page.goto('./');
    await page.locator('#destination-input').fill('94 gerry road');
    await page.locator('#destination-input').press('Enter');
    await expect(page.locator('#destination-results')).toContainText('Search unavailable');
    await expect(page.locator('#destination-results')).not.toContainText('No matching address');
    offline = false;
    const retry = page.getByRole('button', {name:'Search this address: 94 gerry road',exact:true});
    await page.setViewportSize({width:320,height:820});
    await retry.scrollIntoViewIfNeeded();
    const bounds = await retry.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await retry.click();
    await expect(page.locator('#destination-results [role="option"]')).toHaveCount(1);
    await expect(page.locator('#destination-results')).toContainText('Brookline');
    expect(state.routes).toEqual([]);
    expect(state.errors).toEqual([]);
});

test('Enter and search button show choices, editing clears stale options and origin can be searched', async ({ page }) => {
    const state = await fixtures(page, { brokenMap: true });
    await page.goto('./');
    await page.locator('#destination-input').fill('Alpha');
    await page.locator('#destination-input').press('Enter');
    await expect(page.locator('#destination-results [role="option"]')).toHaveCount(1);
    expect(state.routes.length).toBe(0);
    await page.locator('#destination-input').fill('Unknown');
    await expect(page.locator('#destination-results [role="option"]')).toHaveCount(0);
    await page.locator('#btn-confirm-destination').click();
    await expect(page.locator('#destination-results')).toContainText('No matching address');
    expect(state.routes.length).toBe(0);
    await page.locator('#origin-input').fill('Bravo');
    await page.locator('#origin-input-search').click();
    await expect(page.locator('#origin-results [role="option"]')).toHaveCount(1);
    await page.locator('#origin-results [role="option"]').first().click();
    await selectDestination(page, 'Alpha');
    await expect.poll(() => state.routes.length).toBeGreaterThan(0);
    expect(state.errors).toEqual([]);
});

test('settings remain accessible without Map button and long free-drive labels cannot shrink switches', async ({ page }) => {
    const state = await fixtures(page, { brokenMap: true });
    await page.goto('./');
    await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#start-search-modal')).toHaveClass(/hidden/);
    for (const width of [320,360,384,412]) {
        await page.setViewportSize({width,height:820});
        const toggle = page.locator('#toggle-auto-free-drive');
        await toggle.locator('..').scrollIntoViewIfNeeded();
        for (const checked of [true,false]) {
            if (await toggle.isChecked() !== checked) await toggle.locator('..').click();
            await expect(toggle).toBeChecked({checked});
            // Wait for the CSS knob transition before measuring containment.
            await page.waitForTimeout(350);
            const bounds = await toggle.evaluate(input => {
                const control = input.parentElement;
                const row = control.closest('.option-row');
                const text = row.querySelector('.option-label-group');
                const slider = control.querySelector('.slider');
                const knob = getComputedStyle(slider,'::before');
                const rect = control.getBoundingClientRect();
                const translation = new DOMMatrix(knob.transform === 'none' ? undefined : knob.transform).m41;
                return {width:rect.width, right:rect.right, rowRight:row.getBoundingClientRect().right,
                    textRight:text.getBoundingClientRect().right, left:rect.left,
                    knobRight:parseFloat(knob.left)+parseFloat(knob.width)+translation};
            });
            expect(bounds.width).toBe(44);
            expect(bounds.right).toBeLessThanOrEqual(bounds.rowRight+0.5);
            expect(bounds.textRight).toBeLessThan(bounds.left);
            expect(bounds.knobRight).toBeLessThanOrEqual(bounds.width);
        }
    }
    await page.screenshot({path:test.info().outputPath('settings-switches.png')});
    expect(state.errors).toEqual([]);
});
