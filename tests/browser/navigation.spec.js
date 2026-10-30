const { test, expect } = require('@playwright/test');
const { version: mapVersion } = require('maplibre-gl/package.json');

test('drive replay imports locally, selects a point and persists explicit glare observations',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-drive-replay').click();await expect(page.locator('#drive-lab-modal')).toBeVisible();
    const at=Date.now(),recording={version:2,samples:[0,1,2].map(i=>({lat:42.36,lng:-71.07+i*.00005,accuracy:5,heading:90,reportedSpeedKmh:20,timestamp:at+i*1000,receivedAt:at+i*1000,
        glarePrediction:{risk:.8,uncertain:false,computedAt:at,weatherModel:'OPEN_METEO_FORECAST',occlusionRatio:0}})),events:[{type:'route',recordedAt:at-1000,data:{coordinates:[[-71.07,42.36],[-71.06,42.36]],maneuvers:[]}},
        {type:'native-location',recordedAt:at,data:{timestamp:at,lat:42.36,lng:-71.07,accuracy68:3,heading:90,speedMps:5}}]};
    await page.locator('#replay-import').setInputFiles({name:'drive.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recording))});
    await expect(page.locator('#replay-summary')).toContainText('3 fixes');
    await expect(page.locator('#btn-glare-no')).toBeEnabled();await page.locator('#btn-glare-no').click();
    await expect(page.locator('#replay-frame')).toContainText('No glare');
    expect(await page.evaluate(()=>GlareFeedback.summarize(DriveLab.feedback()).falsePositive)).toBe(1);
    await page.locator('#replay-source').selectOption('native');await expect(page.locator('#replay-summary')).toContainText('1 fixes');await expect(page.locator('#btn-glare-no')).toBeDisabled();
    await page.locator('#replay-source').selectOption('foreground');await expect(page.locator('#replay-summary')).toContainText('3 fixes');
    await page.setViewportSize({width:320,height:740});await page.locator('#btn-lab-close').scrollIntoViewIfNeeded();
    const width=await page.locator('.drive-lab-card').evaluate(e=>({scroll:e.scrollWidth,client:e.clientWidth}));expect(width.scroll).toBeLessThanOrEqual(width.client+1);
    await page.screenshot({path:test.info().outputPath('drive-review-320.png')});await page.locator('#btn-lab-close').click();
    await page.reload();expect(await page.evaluate(()=>DriveLab.feedback().length)).toBe(1);expect(state.errors).toEqual([]);
});

test('scene repair presents source age and repairs only the selected tile',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await page.evaluate(()=>{window.repairs=[];SceneShadow.statusAt=async()=>[{region:'us-northeast',tileKey:'160:96',cacheState:'not-downloaded',source:'OSM fixture',extractTimestamp:'2026-10-27T21:23:59Z',releaseTag:'scene-fixture',pack:'one',downloadBytes:5242880,manifestCheckedAt:Date.now(),manifestStale:false}];SceneShadow.repairTile=async(...args)=>repairs.push(args);});
    await page.locator('#btn-scene-status').click();await expect(page.locator('#scene-repair-list')).toContainText('2026-10-27');
    await page.locator('#scene-repair-list button').click();await expect(page.locator('#drive-lab-message')).toContainText('Repair complete');
    expect(await page.evaluate(()=>repairs)).toEqual([['us-northeast','160:96']]);expect(state.errors).toEqual([]);
});

test('vehicle entrance candidates change the reviewed pin without claiming user verification',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');
    await page.route('**/api/interpreter',route=>route.fulfill({json:{elements:[
        {type:'node',id:1,lon:-71.07,lat:42.36},{type:'node',id:2,lon:-71.069,lat:42.36,tags:{amenity:'parking_entrance',name:'Parking A'}},
        {type:'way',id:11,nodes:[1,2],tags:{highway:'service',oneway:'yes',name:'Driveway'}}]}}));
    await page.evaluate(()=>{DestinationReview.show({lat:42.36,lng:-71.0688},'Test destination',null).then(v=>window.entranceChoice=v);});
    await page.locator('#btn-find-entrances').click();await expect(page.locator('#entrance-results')).toContainText('Parking A');
    await page.locator('#entrance-results button').click();await expect(page.locator('#destination-entrance-confirmed')).not.toBeChecked();
    await expect(page.locator('#destination-review-position')).toContainText('-71.06900');await page.locator('#btn-review-confirm').click();
    expect(await page.evaluate(()=>entranceChoice)).toMatchObject({lat:42.36,lng:-71.069,entranceConfirmed:false,source:'user-pin'});expect(state.errors).toEqual([]);
});

test('live glare colors, banner and voice share forecast and uncertainty on unchanged geometry', async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await captureJourneyControls(page);
    await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();await expect(page.locator('#live-gps-nav-btn')).toHaveClass(/active/);
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({heading:0});return journeyTestApi.state().snapped;})).toBe(true);
    await page.evaluate(()=>{
        SunCalc.getPosition=()=>({azimuth:0,altitude:10});
        WeatherRadiation.interpolateAt=p=>({dni:p.dni,directRadiation:p.dni*.17,diffuseRadiation:0,shortwaveRadiation:p.dni*.17});
        window.glareVoiceCalls=0;TTSVoice.announceProactiveGlareWarning=()=>glareVoiceCalls++;
        window.setGlareFixture=(dni,occlusion)=>{
            const route=journeyTestApi.state().route,at=Date.now();
            route.analyzed={...route.analyzed,segments:route.analyzed.segments.map(s=>({...s,heading:0,passTime:new Date(at),occlusionRatio:occlusion,confirmedShade:occlusion===1,shadeState:occlusion===1?'confirmed-shade':'confirmed-clear'}))};
            route.remainingForecast={analyzed:{weatherProfile:{dni,weatherRetrievedAt:at}}};
            window.glareVoiceCalls=0;
        };
        setGlareFixture(600,0);
    });
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({heading:0});return document.getElementById('banner-desc').textContent;})).toContain('Glare predicted');
    await expect(page.locator('#map path[stroke="#f59e0b"]').first()).toBeAttached();
    expect(await page.evaluate(()=>glareVoiceCalls)).toBeGreaterThan(0);
    await page.evaluate(()=>setGlareFixture(0,0));
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({heading:0});return document.getElementById('banner-desc').textContent;})).not.toContain('Glare predicted');
    await expect(page.locator('#map path[stroke="#f59e0b"]')).toHaveCount(0);
    expect(await page.evaluate(()=>glareVoiceCalls)).toBe(0);
    await page.evaluate(()=>setGlareFixture(600,null));
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({heading:0});return document.getElementById('banner-desc').textContent;})).toContain('shade/weather unverified');
    await expect(page.locator('#map path[stroke="#eab308"][stroke-dasharray="7 7"]').first()).toBeAttached();
    expect(await page.evaluate(()=>glareVoiceCalls)).toBe(0);
    await page.screenshot({path:test.info().outputPath('glare-uncertain.png')});
    await page.evaluate(()=>setGlareFixture(600,1));
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({heading:0});return document.getElementById('banner-desc').textContent;})).not.toContain('Possible glare');
    await expect(page.locator('#map path[stroke="#7c3aed"]').first()).toBeAttached();
    expect(await page.evaluate(()=>glareVoiceCalls)).toBe(0);expect(state.errors).toEqual([]);
});

async function captureJourneyControls(page){
    await page.route('**/js/journey-controls.js',async route=>{
        const original=await route.fetch();
        await route.fulfill({response:original,body:await original.text()+`\nconst originalJourneyCreate=JourneyControls.create; JourneyControls.create=api=>{window.journeyTestApi=api;return window.journeyTestController=originalJourneyCreate(api);};`});
    });
}
async function installClosureFixture(page){
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({speed:0});return journeyTestApi.state().snapped;})).toBe(true);
    await page.evaluate(async()=>{
        const s=journeyTestApi.state(),coords=s.route.analyzed.coordinates;
        const original=structuredClone(s.route.raw),candidate=structuredClone(s.route),now=Date.now();
        const feeds=[{source:'test',newest:now,status:'fresh',events:[{id:1,name:'Fixture Road',names:['Fixture Road'],direction:'northbound',impact:'all-lanes-closed',closureVerified:true,verified:true,start:now-1000,end:now+300000,points:coords.slice(15,26)}]}];
        const move=p=>{const t=(p[1]-coords[0][1])/(coords.at(-1)[1]-coords[0][1]);return [p[0]-.003*Math.sin(Math.PI*Math.max(0,Math.min(1,t))),p[1]];};
        candidate.id='closure-detour';candidate.durationSec+=120;candidate.raw.duration=candidate.durationSec;
        candidate.raw.geometry.coordinates=coords.map(move);
        for(const step of candidate.raw.legs.flatMap(l=>l.steps)){step.geometry.coordinates=step.geometry.coordinates.map(move);step.maneuver.location=move(step.maneuver.location);}
        candidate.analyzed=await ShadowRouter.analyzeRouteSegmentsAsync(candidate.raw.geometry.coordinates,new Date(),candidate.durationSec,candidate.raw.legs.flatMap(l=>l.steps));
        candidate.routeSteps=candidate.raw.legs.flatMap(l=>l.steps);
        window.closureFixture={feeds,traffic:PublicTraffic.evaluate(original,feeds),remaining:{duration:300,coordinates:coords,steps:original.legs.flatMap(l=>l.steps)},candidate};
        if(!closureFixture.traffic.blocked||PublicTraffic.evaluate(candidate.raw,feeds).blocked)throw Error('Closure fixture must block only original road');
        journeyTestApi.candidates=async()=>({routes:{fastest:candidate,glareFree:candidate,shade:candidate,all:[candidate]}});
        PublicTraffic.load=async()=>feeds;
    });
}

test('route preference and detour budget persist and remain usable on a narrow screen',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#mobile-toggle-panel').click();
    await page.locator('#route-preference').selectOption('simple');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#route-budget').selectOption('2');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.setViewportSize({width:320,height:740});await page.locator('#route-preference').scrollIntoViewIfNeeded();
    const box=await page.locator('#route-preference').boundingBox();expect(box.x+box.width).toBeLessThanOrEqual(321);expect(box.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('#route-preference-status')).toContainText('turns');
    await page.screenshot({path:test.info().outputPath('route-preference-320.png')});
    await page.reload();await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#route-preference')).toHaveValue('simple');await expect(page.locator('#route-budget')).toHaveValue('2');expect(state.errors).toEqual([]);
});

test('entire journey shows every leg and total, supports reordering, and refuses moving leg transition',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await captureJourneyControls(page);
    await page.route('https://router.project-osrm.org/**',async route=>{
        const url=new URL(route.request().url());if(url.searchParams.get('alternatives')!=='false')return route.fallback();
        const coordinates=url.pathname.split('/').at(-1).split(';').map(p=>p.split(',').map(Number));
        await route.fulfill({json:{code:'Ok',waypoints:coordinates.map(location=>({location,distance:0})),routes:[{duration:120,distance:1000,geometry:{coordinates},legs:[{steps:[]}]}]}});
    });
    await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-add-stop').click();await selectDestination(page,'Bravo');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-trip-preview').click();
    await expect(page.locator('#trip-preview-legs li')).toHaveCount(2);await expect(page.locator('#trip-preview-status')).toContainText('Total driving ~7 min');
    await expect(page.locator('#trip-preview-map path.leaflet-interactive')).toHaveCount(2);
    await page.screenshot({path:test.info().outputPath('entire-journey.png')});await page.locator('#btn-close-trip-preview').click();
    await page.locator('#trip-order-list .trip-order-row').first().locator('button').last().click();
    await expect(page.locator('#bar-dest-text')).toContainText('Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-next-stop').click();await expect(page.locator('#bar-dest-text')).toContainText('Alpha');
    expect((await page.evaluate(()=>TripTools.get())).current.name).toContain('Alpha');
    await page.evaluate(()=>testGps.emit({speed:0}));await page.locator('#btn-next-stop').click();
    await expect(page.locator('#bar-dest-text')).toContainText('Bravo');expect(await page.evaluate(()=>TripTools.get())).toBeNull();expect(state.errors).toEqual([]);
});

test('closure detour requires acceptance, commits through live guidance, and keeps destination',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await captureJourneyControls(page);await page.goto('./');await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#btn-map-start-nav').click();
    await expect(page.locator('#live-gps-nav-btn')).toHaveClass(/active/);
    const before=await page.locator('#bar-dest-text').textContent();
    await installClosureFixture(page);
    await page.evaluate(async()=>{
        window.originalClosureRoute=EtaLearning.routeKey(journeyTestApi.state().route);window.closureCommits=0;
        const commit=journeyTestApi.commit;journeyTestApi.commit=data=>{closureCommits++;return commit(data);};
        await journeyTestController.considerClosure(closureFixture.traffic,closureFixture.remaining);
    });
    await expect(page.locator('#closure-offer')).toBeVisible();await expect(page.locator('#closure-offer-text')).toContainText('+2 min');
    expect(await page.evaluate(()=>closureCommits)).toBe(0);await page.locator('#btn-closure-accept').click();
    await expect(page.locator('#closure-offer')).toBeHidden();expect(await page.evaluate(()=>closureCommits)).toBe(1);
    expect(await page.locator('#bar-dest-text').textContent()).toBe(before);await expect(page.locator('#live-gps-nav-btn')).toHaveClass(/active/);
    expect(await page.evaluate(()=>EtaLearning.routeKey(journeyTestApi.state().route)!==originalClosureRoute)).toBe(true);expect(state.errors).toEqual([]);
});

test('closure proposal expires after movement and dismissal cancels delayed candidates',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await captureJourneyControls(page);await page.goto('./');await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#btn-map-start-nav').click();await expect(page.locator('#live-gps-nav-btn')).toHaveClass(/active/);
    await installClosureFixture(page);
    await page.evaluate(async()=>{
        window.closureCommits=0;journeyTestApi.commit=async()=>{closureCommits++;};
        await journeyTestController.considerClosure(closureFixture.traffic,closureFixture.remaining);
        const get=journeyTestApi.state;journeyTestApi.state=()=>({...get(),start:{lat:43,lng:-71}});
    });
    await page.locator('#btn-closure-accept').click();await expect(page.locator('#closure-offer-text')).toContainText('expired');expect(await page.evaluate(()=>closureCommits)).toBe(0);
    await page.locator('#btn-closure-dismiss').click();await page.evaluate(()=>journeyTestApi.stop());
    await page.reload();await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#btn-map-start-nav').click();await expect(page.locator('#live-gps-nav-btn')).toHaveClass(/active/);
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({speed:0});return journeyTestApi.state().snapped;})).toBe(true);
    await page.evaluate(()=>{
        const data=journeyTestApi.state().data;
        journeyTestApi.candidates=()=>new Promise(resolve=>{window.releaseClosure=()=>resolve(data);});
        window.pendingClosure=journeyTestController.considerClosure({blocked:true,closures:[{source:'test',id:2,name:'Main'}]},{duration:300});
    });
    await expect(page.locator('#closure-offer')).toBeVisible();await page.locator('#btn-closure-dismiss').click();
    await page.evaluate(()=>{releaseClosure();return pendingClosure;});await expect(page.locator('#closure-offer')).toBeHidden();expect(state.errors).toEqual([]);
});

test('closure approval is refused if the feed expires after showing a proposal',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await captureJourneyControls(page);await page.goto('./');await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#btn-map-start-nav').click();await expect(page.locator('#live-gps-nav-btn')).toHaveClass(/active/);
    await installClosureFixture(page);
    await page.evaluate(async()=>{
        window.closureCommits=0;journeyTestApi.commit=async()=>{closureCommits++;};
        await journeyTestController.considerClosure(closureFixture.traffic,closureFixture.remaining);
    });
    await expect(page.locator('#btn-closure-accept')).toBeVisible();
    await page.evaluate(()=>{closureFixture.feeds[0].newest=Date.now()-11*60000;});
    await page.locator('#btn-closure-accept').click();await expect(page.locator('#closure-offer-text')).toContainText('expired');expect(await page.evaluate(()=>closureCommits)).toBe(0);expect(state.errors).toEqual([]);
});

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

test('personal ETA consent persists, handles save failure and stays usable on small screens',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    const toggle=page.locator('#eta-learning-enabled');await expect(toggle).not.toBeChecked();await toggle.check();
    await expect(page.locator('#eta-learning-status')).toContainText('Learning on');
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(toggle).toBeChecked();
    for(const width of [320,640]){await page.setViewportSize({width,height:width===320?740:320});await page.locator('#btn-eta-clear').scrollIntoViewIfNeeded();
        const box=await page.locator('#btn-eta-clear').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+1);expect(box.height).toBeGreaterThanOrEqual(44);
        await page.locator('[aria-labelledby="eta-learning-title"]').screenshot({path:test.info().outputPath(`eta-settings-${width}.png`)});}
    await page.locator('#btn-eta-clear').click();await expect(page.locator('#eta-learning-status')).toContainText('0 saved trips');
    await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===EtaLearning.KEY)throw Error('full');return set.call(this,k,v);};});
    await toggle.click();await expect(toggle).toBeChecked();await expect(page.locator('#eta-learning-status')).toContainText('Could not save');
    expect(state.errors).toEqual([]);
});

test('personal ETA uses validated history in cards and HUD then removes it when deleted',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');
    await page.evaluate(()=>{
        const coordinates=Array.from({length:41},(_,i)=>[-71.07+(-71.065+71.07)*i/40,42.36+(42.37-42.36)*i/40]);
        const r={durationSec:300,analyzed:{coordinates}},at=Date.now();
        localStorage.setItem(EtaLearning.KEY,JSON.stringify({enabled:true,records:Array.from({length:5},(_,i)=>({key:EtaLearning.routeKey(r),slot:EtaLearning.slot(at),at:at-(i+1)*7*86400000,base:300,actual:390}))}));
    });
    await page.reload();await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await expect(page.locator('#eta-fastest')).toContainText('Personal estimate');
    await expect(page.locator('#eta-learning-badge')).toContainText('5 trips');
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-eta-clear').click();
    await expect(page.locator('#eta-fastest')).not.toContainText('Personal estimate');await expect(page.locator('#eta-learning-badge')).toBeHidden();
    expect(state.errors).toEqual([]);
});

test('starting guidance discards a delayed place quote from planning',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.route('https://overpass.private.coffee/api/interpreter',route=>route.fulfill({json:{elements:[{type:'node',id:991,lat:42.364,lon:-71.068,tags:{amenity:'fuel',name:'Late stop'}}]}}));
    let release;
    await page.route('https://router.project-osrm.org/route/v1/driving/**',async route=>{
        if(new URL(route.request().url()).searchParams.get('alternatives')!=='false')return route.fallback();
        await new Promise(resolve=>release=resolve);return route.fulfill({status:503,json:{}});
    });
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-route-fuel').click();
    await expect.poll(()=>!!release).toBe(true);await page.locator('#live-gps-nav-btn').click();release();
    await expect(page.locator('#route-place-results')).toContainText('changed');await expect(page.locator('#route-place-results button')).toHaveCount(0);
    expect(state.errors).toEqual([]);
});

test('along-route places rank by quoted driving time and require destination review',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.route('https://overpass.private.coffee/api/interpreter',route=>route.fulfill({json:{elements:[
        {type:'node',id:991,lat:42.364,lon:-71.068,tags:{amenity:'fuel',name:'Long detour'}},
        {type:'node',id:992,lat:42.366,lon:-71.067,tags:{amenity:'fuel',name:'Easy stop'}}]}}));
    let requests=0;
    await page.route('https://router.project-osrm.org/route/v1/driving/**',route=>{
        if(new URL(route.request().url()).searchParams.get('alternatives')!=='false')return route.fallback();
        requests++;const points=new URL(route.request().url()).pathname.split('/').at(-1).split(';').map(p=>p.split(',').map(Number));
        const duration=points.length===2?300:points[1][1]<42.365?600:360;
        return route.fulfill({json:{code:'Ok',waypoints:points.map(location=>({location,distance:0})),routes:[{duration,distance:duration*8,geometry:{coordinates:points},legs:points.slice(1).map(()=>({steps:[]}))}]}});
    });
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-route-fuel').click();
    await expect(page.locator('#route-place-results button').first()).toContainText('Easy stop',{timeout:10000});
    await expect(page.locator('#route-place-results button').first()).toContainText('+1 min');expect(requests).toBe(3);
    await page.locator('#route-place-results').screenshot({path:test.info().outputPath('detour-results.png')});
    await page.locator('#route-place-results button').first().click();await expect(page.locator('#destination-review-modal')).toBeVisible();
    expect(state.errors).toEqual([]);
});

const optionalAreaElements = [
    {type:'node',id:1,lat:42.36,lon:-71.07},
    {type:'node',id:2,lat:42.365,lon:-71.0675},
    {type:'node',id:3,lat:42.37,lon:-71.065,tags:{'addr:housenumber':'94','addr:street':'Gerry Road','addr:city':'Brookline'}},
    {type:'way',id:10,nodes:[1,2,3],tags:{highway:'residential',name:'Saved road'}}
];

test('optional area searches offline after reload and refuses oversized replacement or corrupted data',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});let downloads=0;
    await page.route('https://overpass.private.coffee/api/interpreter',route=>{downloads++;return route.fulfill({json:{elements:optionalAreaElements}});});
    await page.goto('./');
    await page.locator('#mobile-toggle-panel').click();
    expect(downloads).toBe(0);
    await expect(page.locator('#offline-area-label')).toContainText('not bundled');
    await page.locator('#btn-road-pack').click();
    await expect(page.locator('#road-pack-status')).toContainText('places/addresses');
    await page.reload();
    await expect.poll(()=>page.evaluate(()=>!!RoadPack.graph)).toBe(true);
    const result=await page.evaluate(async()=>{
        Object.defineProperty(navigator,'onLine',{configurable:true,value:false});
        const items=await Geocoder.searchPlaces('94 Gerry Rd',{lat:42.36,lng:-71.07});
        const route=await RoadPack.route({lat:42.36,lng:-71.07},{lat:42.37,lng:-71.065});
        return {items,route};
    });
    expect(result.items[0].houseNumber).toBe('94');expect(result.route.offline).toBe(true);
    await page.route('https://overpass.private.coffee/api/interpreter',route=>route.fulfill({body:' '.repeat(13*1024*1024)}));
    expect(await page.evaluate(()=>RoadPack.save({lat:42.365,lng:-71.0675}).catch(e=>e.message))).toBe('ROAD_PACK_TOO_LARGE');
    expect(await page.evaluate(()=>RoadPack.search('94 Gerry Rd').length)).toBe(1);
    await page.evaluate(async()=>{
        const db=await new Promise(resolve=>{const r=indexedDB.open('solarless-road-pack',1);r.onsuccess=()=>resolve(r.result);});
        await new Promise(resolve=>{const tx=db.transaction('packs','readwrite'),store=tx.objectStore('packs'),r=store.get('local');r.onsuccess=()=>{r.result.elements[2].tags['addr:housenumber']='95';store.put(r.result,'local');};tx.oncomplete=resolve;});db.close();
    });
    await page.reload();await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#road-pack-status')).toContainText('damaged');
    expect(await page.evaluate(()=>RoadPack.graph)).toBeNull();
    expect(state.errors).toEqual([]);
});

test('optional area deleted during download cannot return after completion or reload',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});let release;
    await page.route('https://overpass.private.coffee/api/interpreter',async route=>{await new Promise(resolve=>release=resolve);await route.fulfill({json:{elements:optionalAreaElements}});});
    await page.goto('./');await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-road-pack').click();
    await expect.poll(()=>!!release).toBe(true);
    await page.locator('#btn-road-pack-clear').click();release();
    await expect(page.locator('#btn-road-pack')).toBeEnabled();
    expect(await page.evaluate(()=>RoadPack.graph)).toBeNull();
    await page.reload();await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#road-pack-status')).toContainText('No offline road pack');
    expect(state.errors).toEqual([]);
});

test('system voice destination requires address selection and remembers recognition language',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});
    await page.addInitScript(()=>{window.voiceCalls=[];window.voiceResult={text:'Alpha'};window.Capacitor={Plugins:{VoiceInput:{recognize:async options=>{window.voiceCalls.push(options);return window.voiceResult;}}}};});
    await page.goto('./');await page.locator('#voice-search-language').selectOption('ko-KR');
    await page.locator('#btn-voice-destination').click();
    await expect(page.locator('#destination-input')).toHaveValue('Alpha');
    await expect(page.locator('#destination-results [role="option"]').first()).toBeVisible();
    expect(state.routes).toEqual([]);
    expect(await page.evaluate(()=>window.voiceCalls[0].language)).toBe('ko-KR');
    await page.locator('#destination-results [role="option"]').first().click();await page.locator('#btn-review-confirm').click();
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.reload();await expect(page.locator('#voice-search-language')).toHaveValue('ko-KR');
    await page.evaluate(()=>window.voiceResult={cancelled:true});await page.locator('#btn-voice-destination').click();
    await expect(page.locator('#voice-search-status')).toContainText('cancelled');
    await page.evaluate(()=>window.Capacitor.Plugins.VoiceInput.recognize=async()=>{throw Error('VOICE_UNAVAILABLE');});
    await page.locator('#btn-voice-destination').click();await expect(page.locator('#voice-search-status')).toContainText('unavailable');
    expect(state.errors).toEqual([]);
});

test('manual stops keep the final destination and comparison controls fit a narrow phone',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-compare-routes').click();await expect(page.locator('#route-compare-modal')).toBeVisible();
    await expect(page.locator('#route-compare-map .leaflet-overlay-pane path')).not.toHaveCount(0);
    await page.locator('#route-compare-close').click();
    await page.locator('#btn-add-stop').click();await selectDestination(page,'Bravo');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    const plan=await page.evaluate(()=>TripTools.get());expect(plan.current.name).toContain('Bravo');expect(plan.pending[0].name).toContain('Alpha');
    await page.locator('#mobile-toggle-panel').click();
    await page.setViewportSize({width:320,height:740});
    for(const id of ['btn-add-stop','btn-next-stop','btn-clear-stops','btn-route-fuel','btn-route-parking']){
        const el=page.locator('#'+id);await el.scrollIntoViewIfNeeded();const box=await el.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(321);expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({path:test.info().outputPath('trip-controls-320.png')});
    await page.evaluate(()=>window.testGps.emit({speed:0}));
    await page.locator('#btn-next-stop').click();await expect(page.locator('#bar-dest-text')).toContainText('Alpha');
    expect(await page.evaluate(()=>TripTools.get())).toBeNull();expect(state.errors).toEqual([]);
});

test('along-route fuel becomes a reviewed stop and retains the final destination',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});
    await page.route('https://overpass.private.coffee/api/interpreter',route=>route.fulfill({json:{elements:[{type:'node',id:99,lat:42.365,lon:-71.0675,tags:{amenity:'fuel',name:'Route fuel'}}]}}));
    await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-route-fuel').click();
    await expect(page.locator('#route-place-results')).toContainText('unverified');
    await page.locator('#route-place-results button').click();
    expect(await page.evaluate(()=>TripTools.get())).toBeNull();
    await page.locator('#btn-review-confirm').click();
    await expect(page.locator('#bar-dest-text')).toContainText('Route fuel');
    const plan=await page.evaluate(()=>TripTools.get());expect(plan.pending[0].name).toContain('Alpha');
    expect(state.errors).toEqual([]);
});

test('extra alternatives use four bounded via requests and a cooldown',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await selectDestination(page,'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#mobile-toggle-panel').click();
    const urls=[];page.on('request',r=>{if(r.url().includes('/route/v1/driving/'))urls.push(r.url());});
    await page.locator('#btn-more-routes').click();await expect(page.locator('#btn-more-routes')).toBeEnabled({timeout:20000});
    const via=urls.filter(url=>new URL(url).pathname.split(';').length===3);
    expect(via.length).toBe(4);expect(new Set(via).size).toBe(4);
    const count=urls.length;await page.locator('#btn-more-routes').click();expect(urls.length).toBe(count);
    expect(state.errors).toEqual([]);
});

test('optional area server rate limit and missing offline catalog are explained',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});
    await page.route('https://overpass.private.coffee/api/interpreter',route=>route.fulfill({status:429,body:'Rate limit'}));
    await page.goto('./');await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-road-pack').click();
    await expect(page.locator('#road-pack-status')).toContainText('rate limit');
    expect(await page.evaluate(()=>RoadPack.graph)).toBeNull();
    await page.locator('#btn-header-home').click();
    await page.evaluate(()=>Object.defineProperty(navigator,'onLine',{configurable:true,value:false}));
    await page.locator('#destination-input').fill('94 Gerry Road');
    await expect(page.locator('#destination-results')).toContainText('Save a local road/address area first');
    expect(state.errors).toEqual([]);
});

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

async function fixtures(page, { brokenMap = false, holdBravo = false, chained = false, initialAccuracy = 5, holdWatchFix = false, pitched = false, nearTurns = false, everydaySettings = false } = {}) {
    const state = { routes: [], errors: [], releaseBravo: null, bravoFinished: false };
    page.on('pageerror', error => state.errors.push(error.stack || error.message));
    page.on('dialog', dialog => dialog.accept().catch(error => {
        // Reload can emit an initialization dialog while Playwright tears down
        // the page. Keep real dialog errors; ignore only a closed test target.
        if(!page.isClosed()&&!/Test ended|Target page, context or browser has been closed/.test(error.message))state.errors.push(error.message);
    }));
    await page.addInitScript(({initialAccuracy, holdWatchFix,pitched,everydaySettings}) => {
        // Legacy feature cases explicitly use the complete settings view.
        if(!everydaySettings && !localStorage.getItem('solarless_settings_view'))localStorage.setItem('solarless_settings_view','all');
        // Existing Leaflet interaction cases explicitly retain the 2D renderer.
        if(!localStorage.getItem('solarless_driving_3d'))localStorage.setItem('solarless_driving_3d',String(pitched));
        localStorage.setItem('solarless_auto_free_drive_enabled', 'false');
        let nextId = 0;
        const watchers = new Map();
        // Pitched-map fixtures hold one coordinate; report a stationary vehicle.
        // Moving guidance is exercised with changing fixes in separate cases.
        let coords = { latitude: 42.36, longitude: -71.07, accuracy: initialAccuracy, heading: 45, speed: pitched ? 0 : 12,
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
        if(pitched&&!holdWatchFix)setInterval(()=>{for(const callback of watchers.values())callback(fix());},1000);
        window.testGps = {
            emit(update) { coords = { ...coords, ...update }; for (const callback of watchers.values()) callback(fix()); },
            snapshot: fix,
            watchers() { return watchers.size; }
        };
    }, {initialAccuracy, holdWatchFix,pitched,everydaySettings});
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
                    { name: 'Fixture Road', distance: nearTurns ? 120 : 600, duration: 75, mode: 'driving',
                        geometry: { type: 'LineString', coordinates: coordinates.slice(0, 11) },
                        maneuver: { type: 'depart', location: start, bearing_after: 45 }, intersections: [] },
                    { name: 'Fixture Road', exits: '7', destinations: 'Downtown', distance: chained ? (nearTurns ? 180 : 240) : 1800, duration: chained ? 30 : 225, mode: 'driving',
                        geometry: { type: 'LineString', coordinates: coordinates.slice(10) },
                        maneuver: { type: 'turn', modifier: 'slight right', location: coordinates[nearTurns ? 2 : 10], bearing_after: 45 },
                        intersections: [{ location: coordinates[10], lanes: [{ valid: false, indications:['left'] }, { valid: true, indications:['straight','slight right'] }, { valid: true, indications:['slight right'] }] }] },
                    ...(chained ? [{ name: 'Second Street', distance: 1560, duration: 195, mode: 'driving',
                        geometry: { type: 'LineString', coordinates: coordinates.slice(14) },
                        maneuver: { type: 'turn', modifier: 'left', location: coordinates[nearTurns ? 5 : 14], bearing_after: 315 }, intersections: [] }] : []),
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

async function speechSettingsFixture(page,{missing=false,delayed=false}={}) {
    const state=await fixtures(page,{brokenMap:true});
    await page.addInitScript(({missing,delayed})=>{
        window.speechRequests=[];window.speechReads=0;window.speechSaveFailure=false;
        window.speechCatalogue=[{id:'engine:ko1',name:'Korean installed voice',lang:'ko-KR',networkRequired:false},
            {id:'engine:en1',name:'English installed voice',lang:'en-US',networkRequired:false},
            {id:'engine:en2',name:'English online voice with a very long provider label',lang:'en-GB',networkRequired:true}];
        if(missing&&!localStorage.getItem('native-speech-fixture'))localStorage.setItem('native-speech-fixture',JSON.stringify({koVoice:'removed:ko',enVoice:'',rate:1,pitch:1}));
        const get=()=>({ready:!delayed||window.speechReads>1,voices:window.speechCatalogue,settings:JSON.parse(localStorage.getItem('native-speech-fixture')||'{"koVoice":"","enVoice":"","rate":1,"pitch":1}')});
        window.Capacitor={Plugins:{Pip:{
            getSpeechPlayback:async()=>{if(window.diagnosticFailure)throw Error('NO_REPORT');return {playback:{requested:3,started:2,completed:1,errors:0,expired:1,cancelled:1,events:[{event:'started',startDelayMs:240}]}};},
            compareSpeechPreview:async({useDefault})=>{
                const saved=get().settings;
                (window.comparisonRequests ||= []).push({useDefault,saved});
                if(window.compareFailure)throw Error('PREVIEW_UNAVAILABLE');
                return {accepted:true,engine:'fixture-engine',requestedVoice:useDefault?'':saved.koVoice,reportedVoices:[useDefault?'default-ko':saved.koVoice||'default-ko'],rate:saved.rate,pitch:saved.pitch};
            },
            getSpeechSettings:async()=>{window.speechReads++;return get();},
            setSpeechSettings:async({settings})=>{if(window.speechSaveFailure)throw Error('SAVE_FAILED');localStorage.setItem('native-speech-fixture',JSON.stringify(settings));return get();},
            stopFocusedSpeech:async()=>{},speakFocused:async request=>{window.speechRequests.push({...request,saved:get().settings,planned:NavigationGuidance.voicePlan(request.segments,request.lang,get().settings.unifiedVoice)});return {accepted:true};}
        }}};
    },{missing,delayed});
    return state;
}

test('voice settings persist separately by language and previews use the saved native settings',async({page})=>{
    const state=await speechSettingsFixture(page,{delayed:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await page.locator('#speech-voice-ko').selectOption('engine:ko1');await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await page.locator('#speech-voice-en').selectOption('engine:en1');await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    for(const [id,value] of [['speech-rate','0.8'],['speech-pitch','1.2']]){
        await page.locator('#'+id).fill(value);await page.locator('#'+id).dispatchEvent('change');await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    }
    await page.locator('#btn-preview-ko').click();await expect.poll(()=>page.evaluate(()=>window.speechRequests.length)).toBe(1);
    await page.locator('#btn-preview-en').click();await expect.poll(()=>page.evaluate(()=>window.speechRequests.length)).toBe(2);
    const requests=await page.evaluate(()=>window.speechRequests);
    expect(requests.map(r=>r.lang)).toEqual(['ko-KR','en-US']);
    for(const r of requests)expect(r.saved).toEqual({koVoice:'engine:ko1',enVoice:'engine:en1',rate:.8,pitch:1.2,unifiedVoice:true});
    expect(requests[0].planned.every(s=>s.lang==='ko-KR')).toBe(true);
    expect(requests[0].planned[0].text).toContain('Harvard Avenue');
    await page.locator('#btn-toggle-lang').click();await expect(page.locator('#speech-settings-title')).toHaveText('안내 목소리');
    await expect(page.locator('#speech-voice-en')).toHaveValue('engine:en1');
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await expect(page.locator('#speech-voice-ko')).toHaveValue('engine:ko1');await expect(page.locator('#speech-voice-en')).toHaveValue('engine:en1');
    await expect(page.locator('#speech-rate-value')).toHaveText('0.80×');await expect(page.locator('#speech-pitch-value')).toHaveText('1.20×');
    await page.locator('#btn-reset-voices').click();await expect(page.locator('#speech-rate-value')).toHaveText('1.00×');
    await expect(page.locator('#speech-voice-ko')).toHaveValue('');await expect(page.locator('#speech-voice-en')).toHaveValue('');expect(state.errors).toEqual([]);
});

test('voice comparison keeps saved settings and reports errors without interrupting guidance',async({page})=>{
    const state=await speechSettingsFixture(page);await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await page.locator('#speech-voice-ko').selectOption('engine:ko1');await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    const saved=await page.evaluate(()=>localStorage.getItem('native-speech-fixture'));
    await page.locator('#btn-compare-default').click();await expect(page.locator('#speech-settings-status')).toContainText('unchanged');
    await page.locator('#btn-compare-selected').click();await expect(page.locator('#speech-comparison-details')).toContainText('engine:ko1');
    expect(await page.evaluate(()=>comparisonRequests.map(r=>r.useDefault))).toEqual([true,false]);
    expect(await page.evaluate(()=>localStorage.getItem('native-speech-fixture'))).toBe(saved);
    await page.evaluate(()=>window.compareFailure=true);await page.locator('#btn-compare-selected').click();
    await expect(page.locator('#speech-settings-status')).toContainText('Could not start');
    await page.evaluate(()=>TTSVoice.toggleMute());await page.locator('#btn-compare-default').click();
    await expect(page.locator('#speech-settings-status')).toContainText('Enable voice');
    expect(await page.evaluate(()=>comparisonRequests.length)).toBe(3);
    await page.evaluate(()=>TTSVoice.toggleMute());
    await page.locator('#btn-open-search-modal').click();await selectDestination(page,'Alpha');await page.locator('#btn-map-start-nav').click();
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-compare-default').click();
    await expect(page.locator('#speech-settings-status')).toContainText('End guidance');
    expect(await page.evaluate(()=>comparisonRequests.length)).toBe(3);expect(state.errors).toEqual([]);
});

test('voice listening results are local, profile-specific and survive reload',async({page})=>{
    const state=await speechSettingsFixture(page);await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-voice-ko')).toBeEnabled();await page.locator('#speech-voice-ko').selectOption('engine:ko1');
    await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await page.evaluate(()=>localStorage.setItem('solarless_voice_comparisons','[null,{},"bad"]'));
    await page.locator('#btn-compare-selected').click();await page.locator('#speech-comparison-rating').selectOption('good');
    await expect(page.locator('#speech-comparison-saved')).toContainText('saved');
    await page.locator('#btn-compare-default').click();await expect(page.locator('#speech-comparison-rating')).toHaveValue('unchecked');
    await page.reload();await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-compare-selected').click();await expect(page.locator('#speech-comparison-rating')).toHaveValue('good');
    await page.locator('#speech-rate').fill('0.8');await page.locator('#speech-rate').dispatchEvent('change');
    await expect(page.locator('#speech-voice-ko')).toBeEnabled();await page.locator('#btn-compare-selected').click();
    await expect(page.locator('#speech-comparison-rating')).toHaveValue('unchecked');
    await page.evaluate(()=>window.compareFailure=true);await page.locator('#btn-compare-selected').click();
    await expect(page.locator('#speech-comparison-rating')).toBeDisabled();expect(state.errors).toEqual([]);
});

test('speech callback diagnostics are on demand and do not enqueue audio',async({page})=>{
    const state=await speechSettingsFixture(page);await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await page.locator('#speech-playback-title').click();await page.locator('#btn-speech-playback').click();
    await expect(page.locator('#speech-playback-status')).toContainText('240 ms');
    await expect(page.locator('#speech-playback-status')).toContainText('do not verify audible');
    expect(await page.evaluate(()=>speechRequests.length)).toBe(0);
    await page.evaluate(()=>window.diagnosticFailure=true);await page.locator('#btn-speech-playback').click();
    await expect(page.locator('#speech-playback-status')).toContainText('Could not read');expect(state.errors).toEqual([]);
});

test('everyday settings group common controls and preserve all tools without starting a drive',async({page})=>{
    const state=await fixtures(page,{brokenMap:true,everydaySettings:true});await page.goto('./');
    await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#settings-basic')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#time-slider')).toBeHidden();await expect(page.locator('#btn-drive-record')).toBeHidden();
    await page.locator('#settings-go-route').click();await expect(page.locator('#route-preference')).toBeVisible();
    await expect(page.locator('#toggle-toll-free')).toBeAttached();
    await page.locator('#settings-go-voice').click();await expect(page.locator('#speech-voice-ko')).toBeVisible();
    await expect(page.locator('#speech-pitch')).toBeHidden();
    await page.locator('#settings-go-update').click();await expect(page.locator('#btn-check-update')).toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/live-driving/);
    await page.locator('#settings-all').click();await expect(page.locator('#time-slider')).toBeVisible();await expect(page.locator('#speech-pitch')).toBeVisible();
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#settings-all')).toHaveAttribute('aria-pressed','true');
    await page.locator('#settings-basic').click();await expect(page.locator('#settings-basic')).toBeFocused();
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#time-slider')).toBeHidden();
    await page.locator('#btn-toggle-lang').click();await expect(page.locator('#settings-basic')).toHaveText('자주 쓰는 설정');
    expect(state.errors).toEqual([]);
});

test('everyday settings shortcuts fit narrow and landscape screens with usable touch targets',async({page})=>{
    const state=await fixtures(page,{brokenMap:true,everydaySettings:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    for(const size of [{width:320,height:740},{width:640,height:320}]){
        await page.setViewportSize(size);await page.locator('#settings-basic').scrollIntoViewIfNeeded();
        const bounds=await page.locator('#settings-navigation button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,height:r.height};}));
        for(const b of bounds){expect(b.left).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(size.width);expect(b.height).toBeGreaterThanOrEqual(44);}
        await page.screenshot({path:test.info().outputPath(`everyday-${size.width}.png`)});
    }
    expect(state.errors).toEqual([]);
});

test('easier driving selection explains verified tradeoffs and the fastest fallback',async({page})=>{
    const state=await fixtures(page,{brokenMap:true,everydaySettings:true});await captureJourneyControls(page);
    await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#mobile-toggle-panel').click();await page.locator('#route-preference').selectOption('simple');
    await expect(page.locator('#route-preference-status')).toContainText('No sufficiently simpler');
    await expect(page.locator('#route-preference-status')).toContainText('20%');
    await page.evaluate(()=>{
        const state=journeyTestApi.state(),base=structuredClone(state.route),alternative=structuredClone(base);
        base.durationSec=600;base.raw.legs=[{steps:[{distance:100,maneuver:{type:'turn',modifier:'uturn'}}]}];
        alternative.durationSec=660;alternative.raw.legs=[{steps:[{distance:100,maneuver:{type:'depart'}},{distance:0,maneuver:{type:'arrive'}}]}];
        const data=JourneyUpgrades.apply({routes:{fastest:base,all:[base,alternative]}},5);
        journeyTestApi.state=()=>({...state,data,route:data.routes.simple,mode:'simple',budget:5});journeyTestController.render();
    });
    await expect(page.locator('#route-preference-status')).toContainText('+1.0 min');
    await expect(page.locator('#route-preference-status')).toContainText('-1 U-turns');
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#route-preference')).toHaveValue('simple');
    expect(state.errors).toEqual([]);
});

test('online choices disappear and saved network voice migrates to its installed counterpart',async({page})=>{
    const state=await speechSettingsFixture(page);
    await page.addInitScript(()=>{
        speechCatalogue.push({id:'engine:ko-kr-x-koc-local',name:'ko-kr-x-koc-local',lang:'ko-KR',networkRequired:false},
            {id:'engine:ko-kr-x-koc-network',name:'ko-kr-x-koc-network',lang:'ko-KR',networkRequired:true});
        if(!localStorage.getItem('native-speech-fixture'))localStorage.setItem('native-speech-fixture',JSON.stringify({koVoice:'engine:ko-kr-x-koc-network',enVoice:'engine:en2',rate:.8,pitch:1.2,unifiedVoice:true}));
    });
    await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-voice-ko')).toHaveValue('engine:ko-kr-x-koc-local');
    await expect(page.locator('#speech-voice-en')).toHaveValue('');
    await expect(page.locator('#speech-voice-en option[value="engine:en2"]')).toHaveCount(0);
    await expect(page.locator('#speech-voice-ko')).not.toContainText('Online');
    await page.locator('#btn-preview-ko').click();await expect.poll(()=>page.evaluate(()=>speechRequests.length)).toBe(1);
    const saved=await page.evaluate(()=>speechRequests[0].saved);
    expect(saved).toEqual({koVoice:'engine:ko-kr-x-koc-local',enVoice:'',rate:.8,pitch:1.2,unifiedVoice:true});
    await page.reload();await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-voice-ko')).toHaveValue(saved.koVoice);
    await page.screenshot({path:test.info().outputPath('installed-voice-settings.png')});expect(state.errors).toEqual([]);
});

test('voice nicknames, tone notes and unified mixed guidance persist without exposing raw codes in choices',async({page})=>{
    const state=await speechSettingsFixture(page);await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await page.evaluate(()=>{speechCatalogue[0]={...speechCatalogue[0],name:'ko-kr-x-ism-local',quality:400,latency:200};speechCatalogue[1]={...speechCatalogue[1],name:'en-us-x-iob-local',quality:400,latency:200};});
    await page.locator('#btn-refresh-voices').click();await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await expect(page.locator('#speech-voice-ko option[value="engine:ko1"]')).toContainText('Garam');
    await expect(page.locator('#speech-voice-en option[value="engine:en1"]')).toContainText('Alex');
    await expect(page.locator('#speech-voice-ko')).not.toContainText('ko-kr-x-ism');
    await page.locator('#speech-voice-ko').selectOption('engine:ko1');await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await expect(page.locator('#speech-details-ko')).toContainText('High');await expect(page.locator('#speech-details-ko')).toContainText('Fast');
    await page.locator('#speech-note-ko').fill('Low male <test>');await page.locator('#speech-note-ko').dispatchEvent('change');
    await expect(page.locator('#speech-voice-ko option:checked')).toContainText('Low male <test>');
    await page.locator('#speech-voice-en').selectOption('engine:en1');await expect(page.locator('#speech-voice-en')).toBeEnabled();
    await page.locator('#btn-preview-ko').click();await expect.poll(()=>page.evaluate(()=>speechRequests.length)).toBe(1);
    expect(await page.evaluate(()=>speechRequests[0].planned.map(p=>p.lang))).toEqual(['ko-KR']);
    await page.locator('#speech-mode').selectOption('separate');await expect(page.locator('#speech-mode')).toBeEnabled();
    await page.locator('#btn-preview-ko').click();await expect.poll(()=>page.evaluate(()=>speechRequests.length)).toBe(2);
    expect(await page.evaluate(()=>speechRequests[1].planned.map(p=>p.lang))).toEqual(['ko-KR','en-US','ko-KR']);
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#speech-mode')).toHaveValue('separate');
    await expect(page.locator('#speech-note-ko')).toHaveValue('Low male <test>');
    await page.locator('#speech-mode').selectOption('unified');await expect(page.locator('#speech-mode')).toBeEnabled();
    await page.locator('#btn-preview-ko').click();await expect.poll(()=>page.evaluate(()=>speechRequests.length)).toBe(1);
    expect(await page.evaluate(()=>speechRequests[0].planned.length)).toBe(1);expect(state.errors).toEqual([]);
});

test('missing voices and failed saves are explicit and refresh restores native truth',async({page})=>{
    const state=await speechSettingsFixture(page,{missing:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-settings-status')).toContainText('Unavailable');
    await expect(page.locator('#speech-voice-ko')).toHaveValue('removed:ko');
    await page.evaluate(()=>window.speechSaveFailure=true);await page.locator('#speech-voice-ko').selectOption('engine:ko1');
    await expect(page.locator('#speech-settings-status')).toContainText('Could not save');await expect(page.locator('#speech-voice-ko')).toBeDisabled();
    await page.evaluate(()=>window.speechSaveFailure=false);await page.locator('#btn-refresh-voices').click();await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    await expect(page.locator('#speech-voice-ko')).toHaveValue('removed:ko');
    await page.locator('#speech-voice-ko').selectOption('');await expect(page.locator('#speech-settings-status')).toContainText('save automatically');
    expect(state.errors).toEqual([]);
});

test('voice settings fit narrow and landscape screens and mute prevents previews',async({page})=>{
    const state=await speechSettingsFixture(page);await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    for(const size of [{width:320,height:740},{width:640,height:320}]){
        await page.setViewportSize(size);
        for(const id of ['speech-mode','speech-voice-ko','speech-voice-en','speech-note-ko','speech-note-en','speech-rate','speech-pitch','btn-preview-ko','btn-preview-en','btn-compare-default','btn-compare-selected','btn-reset-voices','btn-refresh-voices']){
            const control=page.locator('#'+id);await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();
            expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width+1);expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await page.locator('#speech-voice-en').scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath(`speech-settings-${size.width}.png`)});
    }
    await page.evaluate(()=>TTSVoice.toggleMute());await page.locator('#btn-preview-en').click();
    await expect(page.locator('#speech-settings-status')).toContainText('Enable voice');expect(await page.evaluate(()=>window.speechRequests.length)).toBe(0);
    expect(state.errors).toEqual([]);
});

test('voice preview cannot interrupt active guidance',async({page})=>{
    const state=await speechSettingsFixture(page);await page.goto('./');await selectDestination(page,'Alpha');await page.locator('#btn-map-start-nav').click();
    await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#speech-voice-ko')).toBeEnabled();
    const count=await page.evaluate(()=>window.speechRequests.length);
    await page.locator('#btn-preview-ko').click();await expect(page.locator('#speech-settings-status')).toContainText('End guidance');
    expect(await page.evaluate(()=>window.speechRequests.length)).toBe(count);expect(state.errors).toEqual([]);
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
    await expect(page.locator('#offline-area-size option[value="3"]')).toHaveText(imperial ? '3.0 km × 3.0 km' : '1.9 mi × 1.9 mi');
    await expect(page.locator('#offline-area-size option[value="6"]')).toHaveText(imperial ? '6.0 km × 6.0 km' : '3.7 mi × 3.7 mi');
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
        await expect(page.locator('#btn-recenter-gps')).toHaveClass(/gps-unavailable/);
        await expect(page.locator('#guidance-health')).toBeHidden();
        await expect(page.locator('#mobile-turn-banner')).toBeHidden();
        await page.evaluate(()=>NavigationUnits.setPreference('metric'));
        await page.locator('#btn-toggle-lang').click();
        await expect(page.locator('#btn-recenter-gps')).toHaveAttribute('aria-label', /GPS 수신 불안정/);
        await page.locator('#btn-toggle-lang').click();
        await expect(page.locator('#mobile-turn-banner')).toBeHidden();
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
        await expect(dialog.locator('li')).toHaveCount(6);
        await expect(dialog).toContainText('do not show traffic congestion');
        await expect(dialog).toContainText('not field-verified shade');
        await expect(dialog).toContainText('grayscale');
        const colors=await dialog.locator('.route-legend-swatch').evaluateAll(items=>items.map(item=>getComputedStyle(item).borderTopColor));
        expect(colors).toEqual(['rgb(245, 158, 11)','rgb(234, 179, 8)','rgb(124, 58, 237)','rgb(14, 116, 144)','rgb(2, 132, 199)','rgb(100, 116, 139)']);
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
        return page.locator('#banner-lanes').evaluate(el => !el.hidden && !document.getElementById('btn-recenter-gps').classList.contains('gps-unavailable') ? el.textContent : 'Waiting for accepted GPS');
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
    // Duplicate route roles stay compact even outside focus mode; their full
    // explanation remains available in the analysis dialog checked above.
    await expect(page.locator('#desc-fastest')).toBeVisible();
    if(await page.locator('#desc-glare').evaluate(el=>!!el.closest('.shared-route-role')))await expect(page.locator('#desc-glare')).toBeHidden();
    else await expect(page.locator('#desc-glare')).toBeVisible();
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
    // A single startup failure waits for the production 12-second deadline.
    await expect(page.locator('#map-attribution-text')).not.toContainText('OpenFreeMap', {timeout:15000});
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
    await captureDrivingMap(page);
    await page.goto('./');
    await selectDestination(page, 'Alpha');
    await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.locator('#btn-map-start-nav').click();
    // Finish the initial accepted-GPS replacement before measuring whether a
    // later rejected fix starts any new routing request.
    await establishReliableGuidance(page);
    await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-drive-record').click();
    await page.waitForTimeout(300);
    await expect.poll(()=>page.evaluate(()=>drivingTestState.reliable)).toBe(true);
    // Fast guidance can be ready while optional alternatives are still loading.
    // Only count requests after that initial analysis has finished.
    await expect(page.locator('#route-summary-box')).toHaveAttribute('aria-busy', 'false');
    const before = state.routes.length;
    await page.evaluate(() => window.testGps.emit({ latitude: 42.365, longitude: -71.06, accuracy: 180 }));
    // The generic notice is rate-limited and can be replaced by road-data
    // status. Assert the rejected guidance state rather than transient copy.
    await expect.poll(()=>page.evaluate(()=>drivingTestState.reliable)).toBe(false);
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
    await expect(page.locator('#btn-recenter-gps')).toHaveClass(/gps-unavailable/, { timeout: 13000 });
    await expect(page.locator('#guidance-health')).toBeHidden();
    await page.evaluate(()=>NavigationUnits.setPreference('metric'));
    await expect(page.locator('#mobile-turn-banner')).toBeHidden();
    await expect(page.locator('#btn-recenter-gps i')).toHaveClass(/fa-satellite-dish/);
    await page.emulateMedia({reducedMotion:'reduce'});
    await expect(page.locator('#btn-recenter-gps')).toHaveCSS('animation-name','none');
    await page.locator('#btn-recenter-gps').click();
    await expect(page.locator('#btn-recenter-gps')).toHaveClass(/gps-unavailable/);
    await page.evaluate(() => window.testGps.emit({ latitude: 42.3601 }));
    await expect(page.locator('#btn-recenter-gps')).not.toHaveClass(/gps-unavailable/);
    await expect(page.locator('#btn-recenter-gps i')).toHaveClass(/fa-location-crosshairs/);
    await expect(page.locator('#mobile-turn-banner')).toBeVisible();
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
    await expect(page.locator('#mobile-turn-banner')).toContainText('Exit 7');
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
    await expect(page.locator('#mobile-turn-banner')).toContainText('Exit 7');
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

async function captureDrivingMap(page){
    await page.route('**/js/map-provider.js',async route=>{
        const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nconst createDrivingRoads=MapProvider.createRoadLayers;MapProvider.createRoadLayers=(...args)=>window.drivingRoadLayers=createDrivingRoads(...args);`});
    });
    await page.route('**/js/driving-view.js',async route=>{
        const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nconst createDrivingView=DrivingView.create;DrivingView.create=options=>{const NativeMap=options.library.Map; options.library={...options.library,Map:class extends NativeMap{constructor(config){super(config);window.drivingTestMap=this;window.drivingMapErrors=[];this.on('error',e=>drivingMapErrors.push(String(e.error?.message||e.error)));}}};const controller=createDrivingView(options);window.drivingTestController=controller;const update=controller.update;controller.update=s=>{window.drivingTestState=s;return update(s);};return controller;};`});
    });
}
test('queued vector resize cannot access a removed or replaced Leaflet map',async({page})=>{
    const state=await fixtures(page);await captureDrivingMap(page);await page.goto('./');
    await expect.poll(()=>page.evaluate(()=>Object.values(drivingRoadLayers.primary).some(l=>l._map&&l._glMap))).toBe(true);
    await page.evaluate(()=>{
        const layer=Object.values(drivingRoadLayers.primary).find(l=>l._map&&l._glMap),map=layer._map;
        layer._transitionEnd();layer.remove();
        window.restoreVectorFixture=()=>{layer.addTo(map);layer._transitionEnd();layer.remove();layer.addTo(map);};
    });
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(state.errors).toEqual([]);
    await page.evaluate(()=>restoreVectorFixture());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    expect(state.errors).toEqual([]);
});
async function establishMapFix(page){
    try{await expect.poll(()=>page.evaluate(()=>{testGps.emit({speed:0,heading:20});return journeyTestApi.state().snapped;})).toBe(true);}
    catch(error){
        console.log('Map fixture readiness',await page.evaluate(()=>{
            const s=journeyTestApi.state(),fix=testGps.snapshot();return {live:s.live,ready:s.ready,busy:s.busy,snapped:s.snapped,fixAge:Date.now()-s.fixAt,speed:s.speed,heading:s.heading,gps:fix,viewReady:document.getElementById('driving-map').className};
        }));throw error;
    }
}
async function startTilted(page,options={}){
    const state=await fixtures(page,{pitched:true,...options});await captureDrivingMap(page);await captureJourneyControls(page);
    await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await expect(page.locator('#driving-map')).not.toHaveClass(/ready/);
    await page.locator('#btn-map-start-nav').click();
    await establishMapFix(page);
    try{await expect(page.locator('#driving-map')).toHaveClass(/ready/);}catch(e){console.log(await page.evaluate(()=>({...drivingTestState,segments:drivingTestState?.segments?.length,failed:drivingTestController.failed()})));throw e;}
    await expect.poll(()=>page.evaluate(()=>journeyTestApi.state().busy)).toBe(false);return state;
}

test('tilted renderer caps pixel ratio under thermal pressure and keeps the live route',async({page})=>{
    const state=await startTilted(page);
    await page.evaluate(()=>Object.defineProperty(window,'devicePixelRatio',{value:2,configurable:true}));
    await expect.poll(()=>page.evaluate(()=>{drivingTestController.update({...drivingTestState,thermalStatus:2});return drivingTestMap.getPixelRatio();})).toBe(1);
    await expect(page.locator('#driving-map')).toHaveClass(/ready/);
    expect(await page.evaluate(()=>!!drivingTestMap.getSource('driving-route'))).toBe(true);expect(state.errors).toEqual([]);
});
test('tilted driving projects the route and vehicle together, explores and returns to persisted 2D',async({page})=>{
    const state=await startTilted(page);
    await expect(page.locator('#btn-driving-view')).toHaveText('3D');
    await expect.poll(()=>page.evaluate(()=>drivingTestMap.queryRenderedFeatures({layers:['driving-route-solid','driving-route-uncertain']}).length)).toBeGreaterThan(0);
    const result=await page.evaluate(async()=>{
        const map=drivingTestMap,vehicle=document.querySelector('.driving-vehicle').getBoundingClientRect(),canvas=map.getContainer().getBoundingClientRect();
        const coord=(await map.getSource('driving-route').getData()).features[0].geometry.coordinates[0],p=map.project(coord);
        return {pitch:map.getPitch(),dx:Math.abs(vehicle.x+vehicle.width/2-canvas.x-p.x),dy:Math.abs(vehicle.y+vehicle.height/2-canvas.y-p.y),count:(await map.getSource('driving-route').getData()).features.length,centerY:p.y,height:canvas.height};
    });
    expect(result.pitch).toBeGreaterThan(30);expect(result.count).toBeGreaterThan(0);expect(result.dx).toBeLessThan(5);expect(result.dy).toBeLessThan(8);
    expect(result.centerY).toBeGreaterThan(result.height*.5);
    await page.screenshot({path:test.info().outputPath('tilted-drive.png')});
    const rect=await page.locator('#driving-map').boundingBox();await page.mouse.move(rect.x+100,rect.y+rect.height*.5);await page.mouse.down();await page.mouse.move(rect.x+170,rect.y+rect.height*.5,{steps:10});await page.mouse.up();
    await expect(page.locator('#btn-recenter-gps')).toHaveClass(/panned/);
    await expect.poll(()=>page.evaluate(()=>drivingTestMap.isMoving())).toBe(false);
    const explored=await page.evaluate(()=>drivingTestMap.getCenter().toArray());await page.evaluate(()=>testGps.emit({heading:30}));
    expect(await page.evaluate(()=>drivingTestMap.getCenter().toArray())).toEqual(explored);
    await page.locator('#btn-recenter-gps').click();await expect(page.locator('#btn-recenter-gps')).not.toHaveClass(/panned/);
    await page.locator('#btn-driving-view').click();await expect(page.locator('#driving-map')).not.toHaveClass(/ready/);await expect(page.locator('#map')).toBeVisible();
    expect(await page.evaluate(()=>localStorage.getItem('solarless_driving_3d'))).toBe('false');
    await page.reload();expect(await page.evaluate(()=>localStorage.getItem('solarless_driving_3d'))).toBe('false');expect(state.errors).toEqual([]);
});
test('tilted junction camera fits consecutive turns and changes geometry colors on the live map',async({page})=>{
    const state=await startTilted(page,{chained:true,nearTurns:true});
    await page.evaluate(()=>testGps.emit({speed:0,heading:20}));
    await expect(page.locator('#banner-road')).toContainText('Exit 7');await expect(page.locator('#banner-following')).toContainText('Second Street');
    await page.evaluate(()=>{
        // Supply deterministic analysis at the camera boundary. Mutating one
        // route's forecast races the worker's initial GPS route replacement,
        // especially when the runner's timezone differs from the GPS country.
        // Forecast/solar physics are exercised separately above and in units.
        const refresh=ShadowRouter.refreshGlareSegments;
        ShadowRouter.refreshGlareSegments=(...args)=>refresh(...args).map(s=>({...s,glareRisk:.8,occlusionRatio:null}));
        journeyTestApi.state().route.glareSnapshot=null;
        testGps.emit({speed:0,heading:20});
    });
    await expect.poll(()=>page.evaluate(async()=>(await drivingTestMap.getSource('driving-route').getData()).features.some(f=>f.properties.uncertain&&f.properties.color==='#eab308'))).toBe(true);
    await expect.poll(()=>page.evaluate(()=>Math.round(drivingTestMap.getPitch()))).toBe(32);
    // Pitch readiness does not mean the asynchronous HUD resize has reached
    // the camera yet. Keep the same spatial bounds and wait for convergence.
    await expect(async()=>{
        const result=await page.evaluate(async()=>{
        const map=drivingTestMap,points=(await map.getSource('driving-junctions').getData()).features.map(f=>map.project(f.geometry.coordinates)),r=map.getContainer().getBoundingClientRect();
        return {points:points.map(p=>({x:p.x,y:p.y})),width:r.width,height:r.height,top:document.getElementById('mobile-turn-banner').getBoundingClientRect().bottom-r.top,bottom:document.getElementById('map-bottom-overlay-stack').getBoundingClientRect().top-r.top};
    });
        expect(result.points.length).toBe(2);for(const p of result.points){expect(p.x).toBeGreaterThan(10);expect(p.x).toBeLessThan(result.width-10);expect(p.y).toBeGreaterThan(result.top);expect(p.y).toBeLessThan(result.bottom);}
    }).toPass({timeout:5000});
    await page.screenshot({path:test.info().outputPath('tilted-junction.png')});
    for(const size of [{width:320,height:740},{width:640,height:320}]){
        await page.setViewportSize(size);
        if(size.width===320){
            // A tall junction banner leaves too little room for the full tool
            // stack. The automatic fold must keep 3D reachable through More.
            await expect(page.locator('#btn-map-tools')).toBeVisible();
            await page.locator('#btn-map-tools').click();
            await expect(page.locator('#btn-map-tools')).toHaveAttribute('aria-expanded','true');
        }
        await expect(page.locator('#btn-driving-view')).toBeVisible();
        await page.locator('#btn-driving-view').click({trial:true});
        expect(await page.locator('#map-perspective-wrapper').evaluate(el=>[el.scrollLeft,el.scrollTop])).toEqual([0,0]);
        expect(await page.evaluate(()=>[scrollX,scrollY])).toEqual([0,0]);
        const box=await page.locator('#btn-driving-view').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(size.width);expect(box.height).toBeGreaterThanOrEqual(44);
        if(size.width===640){
            await expect.poll(()=>page.evaluate(()=>drivingTestMap.getPadding().left)).toBeGreaterThan(250);
            const boxes=await page.locator('#mobile-turn-banner,#route-summary-box').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
            expect(boxes[0].right).toBeLessThan(boxes[1].left);
            for(const rect of boxes){expect(rect.top).toBeGreaterThanOrEqual(44);expect(rect.bottom).toBeLessThanOrEqual(size.height);}
            const credit=await page.locator('#map-attribution').boundingBox();
            expect(credit.x+credit.width).toBeLessThan(boxes[1].left);
            expect(credit.y).toBeGreaterThan(boxes[0].bottom);
            await expect.poll(()=>page.evaluate(()=>document.querySelector('.driving-vehicle').getBoundingClientRect().bottom-document.getElementById('route-summary-box').getBoundingClientRect().top)).toBeLessThan(0);
        }
        await page.screenshot({path:test.info().outputPath(`tilted-junction-${size.width}.png`)});
    }
    await page.evaluate(()=>testGps.emit({accuracy:120}));await expect.poll(()=>page.evaluate(async()=>(await drivingTestMap.getSource('driving-junctions').getData()).features.length)).toBe(0);
    await expect(page.locator('#banner-road')).toBeHidden();expect(state.errors).toEqual([]);
});
test('tilted view releases its renderer for saver and PiP, resumes and recovers context loss to 2D',async({page})=>{
    const state=await startTilted(page);
    await page.locator('#btn-toggle-battery-saver').click();await expect(page.locator('#driving-map canvas')).toHaveCount(0);await expect(page.locator('#map')).toBeVisible();
    await page.locator('#btn-driving-view').click();
    expect(await page.evaluate(()=>localStorage.getItem('solarless_driving_3d'))).toBe('true');
    await expect(page.locator('#driving-map canvas')).toHaveCount(0);
    await page.locator('#btn-toggle-battery-saver').click();await expect(page.locator('#driving-map')).toHaveClass(/ready/);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('solarless:pipmode',{detail:{inPip:true}})));await expect(page.locator('#driving-map canvas')).toHaveCount(0);
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('solarless:pipmode',{detail:{inPip:false}})));await expect(page.locator('#driving-map')).toHaveClass(/ready/);
    await page.evaluate(()=>{window.drivingVisibility='hidden';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.drivingVisibility});document.dispatchEvent(new Event('visibilitychange'));});
    await expect(page.locator('#driving-map canvas')).toHaveCount(0);
    await page.evaluate(()=>{window.drivingVisibility='visible';document.dispatchEvent(new Event('visibilitychange'));});await expect(page.locator('#driving-map')).toHaveClass(/ready/);
    await page.evaluate(()=>drivingTestMap.getCanvas().dispatchEvent(new Event('webglcontextlost',{cancelable:true})));await expect(page.locator('#driving-map canvas')).toHaveCount(0);await expect(page.locator('#map')).toBeVisible();
    await page.evaluate(()=>testGps.emit({heading:20}));await expect(page.locator('#driving-map canvas')).toHaveCount(0);
    await page.locator('#btn-driving-view').click();await expect(page.locator('#driving-map')).toHaveClass(/ready/);
    await page.locator('#btn-map-start-nav').click();await expect(page.locator('#driving-map canvas')).toHaveCount(0);expect(state.errors).toEqual([]);
});
test('tilted view style failure keeps the usable 2D route and navigation',async({page})=>{
    const state=await fixtures(page,{pitched:true});await captureDrivingMap(page);
    let requested=0;await page.route('https://failed-style.test/**',route=>{requested++;return route.fulfill({status:503,body:'Unavailable'});});
    await page.route('**/js/driving-view.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('style:theme,center:',"style:'https://failed-style.test/style.json',center:")});});
    await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#btn-map-start-nav').click();
    await expect.poll(()=>requested).toBeGreaterThan(0);
    await expect(page.locator('#driving-map canvas')).toHaveCount(0,{timeout:12000});await expect(page.locator('#map')).toBeVisible();await expect(page.locator('#live-gps-nav-btn')).toHaveClass(/active/);expect(state.errors).toEqual([]);
});


test('map controls stay on the right edge and GPS uncertainty leaves the map clear', async ({page}) => {
    const state = await fixtures(page,{initialAccuracy:150,holdWatchFix:true});
    await page.goto('./');await selectDestination(page,'Alpha');
    await page.locator('#btn-map-start-nav').click();
    await expect(page.locator('#btn-recenter-gps')).toHaveClass(/gps-unavailable/);
    await expect(page.locator('#btn-recenter-gps')).toHaveCSS('animation-name','gps-signal-pulse');
    await expect(page.locator('#api-status-banner').filter({hasText:'GPS accuracy is low'})).toHaveCount(0);
    await expect(page.locator('body')).toHaveClass(/live-driving/);
    await expect(page.locator('.sidebar-panel')).not.toHaveClass(/active/);
    for(const viewport of [{width:412,height:915},{width:320,height:740},{width:640,height:320}]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('#mobile-turn-banner')).toBeHidden();
        await expect(page.locator('#guidance-health')).toBeHidden();
        await expect.poll(async()=>page.locator('#btn-driving-view').evaluate(el=>el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(44);
        const boxes=await page.locator('.map-controls-group .map-floating-btn').evaluateAll(els=>els.filter(e=>e.getBoundingClientRect().width).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};}));
        expect(boxes).toHaveLength(5);
        for(const b of boxes) {expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(44);expect(b.right).toBeLessThanOrEqual(viewport.width);expect(b.bottom).toBeLessThan(viewport.height);expect(b.width).toBeGreaterThanOrEqual(44);}
        if(viewport.height>viewport.width) {
            expect(Math.max(...boxes.map(b=>b.right))-Math.min(...boxes.map(b=>b.right))).toBeLessThan(1);
            for(let i=1;i<boxes.length;i++)expect(boxes[i].y).toBeGreaterThan(boxes[i-1].bottom);
        }
        await page.screenshot({path:test.info().outputPath('gps-controls-'+viewport.width+'.png')});
    }
    await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'));});
    await expect(page.locator('#guidance-health')).toContainText('Offline');
    await expect(page.locator('#btn-recenter-gps')).toHaveClass(/gps-unavailable/);
    expect(state.errors).toEqual([]);
});


test('long tilted routes upload the far geometry once while the near chunk moves',async({page})=>{
    const state=await startTilted(page);
    const result=await page.evaluate(()=>{
        const map=drivingTestMap,controller=drivingTestController,base={...drivingTestState};
        const segments=Array.from({length:5000},(_,i)=>({p1:[42.36+i*.00001,-71.07],p2:[42.36+(i+1)*.00001,-71.07],glareRisk:0}));
        const uploads={ahead:0,near:0,maxNearPoints:0};
        for(const [name,key] of [['driving-route-ahead','ahead'],['driving-route','near']]){
            const src=map.getSource(name),set=src.setData.bind(src);src.setData=data=>{uploads[key]++;if(key==='near')uploads.maxNearPoints=Math.max(uploads.maxNearPoints,data.features.reduce((n,f)=>n+f.geometry.coordinates.length,0));return set(data);};
        }
        const now=Date.now;let clock=now();Date.now=()=>clock;
        try{for(let i=0;i<120;i++){clock+=501;controller.update({...base,reliable:true,segments,index:i,position:[-71.07,42.36+i*.00001],maneuver:null});}
            controller.update({...base,reliable:false,segments,index:119});
        }finally{Date.now=now;}
        return {...uploads,filter:map.getFilter('driving-ahead-casing')};
    });
    expect(result.ahead).toBe(1);expect(result.near).toBeGreaterThanOrEqual(120);expect(result.maxNearPoints).toBeLessThanOrEqual(128);
    expect(JSON.stringify(result.filter)).toContain('false');expect(await page.evaluate(()=>drivingMapErrors.filter(x=>x.includes('filter')))).toEqual([]);expect(state.errors).toEqual([]);
});


test('native GPS handover removes only duplicate web subscriptions and restores fallback on loss',async({page})=>{
 const state=await fixtures(page,{brokenMap:true});
 await page.addInitScript(()=>{window.nativeEvents={};window.Capacitor={Plugins:{Pip:{
  addListener:async(name,fn)=>{nativeEvents[name]=fn;return {remove:async()=>{}};},
  isPipSupported:async()=>({supported:true,allowed:true,inPip:false}),
  setNavigationActive:async()=>({locationServiceStarted:true}),updatePipParams:async()=>({})
 }}};});
 await page.goto('./');await selectDestination(page,'Alpha');await page.locator('#btn-map-start-nav').click();await establishReliableGuidance(page);
 const emit=()=>page.evaluate(async()=>{for(let i=0;i<4;i++){nativeEvents.locationUpdate({lat:42.36005,lng:-71.07,accuracy:5,speed:0,heading:0,timestamp:Date.now(),source:'gps'});await new Promise(r=>setTimeout(r,250));}});
 await emit();await expect.poll(()=>page.evaluate(()=>testGps.watchers())).toBe(0);
 await expect.poll(()=>page.evaluate(()=>testGps.watchers()),{timeout:2500}).toBe(1);
 await emit();await expect.poll(()=>page.evaluate(()=>testGps.watchers())).toBe(0);
 await page.evaluate(()=>nativeEvents.locationUpdate({lat:42.36005,lng:-71.07,accuracy:150,speed:0,heading:0,timestamp:Date.now(),source:'gps'}));
 await expect.poll(()=>page.evaluate(()=>testGps.watchers())).toBe(1);
 await emit();await expect.poll(()=>page.evaluate(()=>testGps.watchers())).toBe(0);
 await page.evaluate(()=>nativeEvents.pipDebug({reason:'LOCATION_SERVICE_STOPPED'}));await expect.poll(()=>page.evaluate(()=>testGps.watchers())).toBe(1);
 expect(state.errors).toEqual([]);
});


test('recording batches samples and flushes before export and deletion',async({page})=>{
 const state=await fixtures(page,{brokenMap:true});await page.goto('./');
 const result=await page.evaluate(async()=>{
  await DriveArchive.setActive(true);
  await DriveArchive.record('ready',{});
  const original=IDBDatabase.prototype.transaction;let writes=0;
  // Cache cleanup may run at startup. Count only the journal under test.
  IDBDatabase.prototype.transaction=function(...args){if(this.name==='solarless-drive-journal'&&args[1]==='readwrite')writes++;return original.apply(this,args);};
  try{
   const saved=Array.from({length:40},(_,i)=>DriveArchive.record('sample',{lat:42.36,lng:-71.07,sequence:i,timestamp:Date.now()}));
   const before=writes;const [json]=await Promise.all([DriveArchive.exportRecording({}),MapCache.trim()]);const exported=JSON.parse(json);await Promise.all(saved);
   const after=writes;await DriveArchive.clear();const cleared=JSON.parse(await DriveArchive.exportRecording({}));
   return {before,after,sequences:exported.samples.map(x=>x.sequence),remaining:cleared.samples.length+cleared.events.length};
  }finally{IDBDatabase.prototype.transaction=original;}
 });
 expect(result).toEqual({before:0,after:1,sequences:Array.from({length:40},(_,i)=>i),remaining:0});expect(state.errors).toEqual([]);
});

test('compact controls persist, expand accessibly and retain recenter on narrow driving screens',async({page})=>{
    const state=await startTilted(page);
    await page.locator('#mobile-toggle-panel').click();await page.locator('label.toggle-switch:has(#toggle-compact-controls)').click();await expect(page.locator('#toggle-compact-controls')).toBeChecked();await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#btn-recenter-gps')).toBeVisible();await expect(page.locator('#btn-driving-view')).toBeHidden();await expect(page.locator('#btn-map-tools')).toBeVisible();
    await page.locator('#btn-map-tools').click();await expect(page.locator('#btn-map-tools')).toHaveAttribute('aria-expanded','true');await expect(page.locator('#btn-driving-view')).toBeVisible();
    await page.locator('#btn-map-tools').press('Escape');await expect(page.locator('#btn-driving-view')).toBeHidden();await expect(page.locator('#btn-map-tools')).toBeFocused();
    await page.setViewportSize({width:320,height:740});await page.screenshot({path:test.info().outputPath('compact-driving-320.png')});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>drivingTestController.metrics().samples)).toBeGreaterThan(0);
    const cadence=await page.evaluate(()=>{drivingTestController.update({...drivingTestState,speed:0});return drivingTestController.metrics().interval;});expect(cadence).toBe(200);
    await page.reload();expect(await page.evaluate(()=>document.body.classList.contains('compact-controls'))).toBe(true);expect(state.errors).toEqual([]);
});

test('confirmed entrance is offered on repeat search, never silently selected, and can be deleted',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');
    await page.evaluate(()=>{DestinationReview.show({lat:42.36,lng:-71.07},'84 Gerry Road, Brookline',null).then(v=>window.chosenEntrance=v);});
    await page.locator('#destination-entrance-confirmed').check();await page.locator('#btn-review-confirm').click();
    await page.reload();
    await page.evaluate(()=>{DestinationReview.show({lat:42.36,lng:-71.07},'84 Gerry Road, Brookline',null).then(v=>window.chosenEntrance=v);});
    await expect(page.locator('#remembered-entrance button')).toBeVisible();await expect(page.locator('#destination-entrance-confirmed')).not.toBeChecked();
    await page.locator('#remembered-entrance button').click();await expect(page.locator('#destination-entrance-confirmed')).toBeChecked();await page.locator('#btn-review-confirm').click();
    expect(await page.evaluate(()=>chosenEntrance)).toMatchObject({source:'user-pin',entranceConfirmed:true});
    await page.evaluate(()=>{DestinationReview.show({lat:42.36,lng:-71.07},'94 Gerry Road, Brookline',null);});await expect(page.locator('#remembered-entrance button')).toHaveCount(0);await page.locator('#btn-review-cancel').click();
    await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-clear-entrances').click();expect(await page.evaluate(()=>EntranceMemory.read(localStorage).length)).toBe(0);expect(state.errors).toEqual([]);
});

test('route choices group identical geometry and disclose unavailable comparison data',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await captureJourneyControls(page);await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();
    await page.evaluate(()=>{const r=journeyTestApi.state().route;window.presentationFixture=r;DriveExperience.routeSummary({routes:{fastest:r,glareFree:{...r},shade:{...r},all:[r]},preferenceBudgetMinutes:5});});
    await expect(page.locator('.route-choice-group')).toHaveCount(1);await expect(page.locator('.shared-route-role')).toHaveCount(2);await expect(page.locator('.route-choice-summary')).toContainText('Same route');
    await page.evaluate(()=>{const a=presentationFixture,b={...a,id:'other',durationSec:a.durationSec+120,analysisMode:'unknown',analyzed:{...a.analyzed,coordinates:a.analyzed.coordinates.map(([x,y],i)=>[x+(i===1?.0001:0),y])}};DriveExperience.routeSummary({routes:{fastest:a,glareFree:b,shade:b,all:[a,b]},preferenceBudgetMinutes:5});});
    await expect(page.locator('.route-choice-group')).toHaveCount(2);await expect(page.locator('.route-choice-summary').last()).toContainText('+2 min');await expect(page.locator('.route-choice-summary').last()).toContainText('Insufficient comparable sun data');
    await page.locator('#mobile-toggle-panel').click();await page.locator('.route-choice-group').last().scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('grouped-routes.png')});expect(state.errors).toEqual([]);
});

test('alert modes persist and mute only selected warning speech while preserving turns',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await page.locator('#alert-mode-glare').selectOption('off');await page.locator('#alert-mode-speeding').selectOption('visual');await page.reload();
    expect(await page.evaluate(()=>AlertSettings.get())).toEqual({glare:'off',speeding:'visual',road:'both'});
    const result=await page.evaluate(async()=>{
        window.spokenAlerts=[];window.Capacitor={Plugins:{Pip:{stopFocusedSpeech:async()=>{},speakFocused:async a=>{spokenAlerts.push(a.text);return {accepted:true};}}}};
        if(TTSVoice.isMuted())TTSVoice.toggleMute();TTSVoice.resetGuidance();
        const disabled=await TTSVoice.speak('Glare off',true,'glare');const visual=await TTSVoice.speak('Speed visual',true,'speeding');
        await TTSVoice.speak('Turn right now',true,null,2);const blocked=await TTSVoice.speak('Road status',true,null,0,[],{alertType:'road'});
        return {disabled,visual,blocked,spoken:spokenAlerts};
    });
    expect(result).toEqual({disabled:false,visual:true,blocked:false,spoken:['Turn right now']});expect(state.errors).toEqual([]);
});

test('arrival pin note discloses access uncertainty and endpoint gap without changing route',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');
    const text=await page.evaluate(()=>{const route={analyzed:{coordinates:[[-71,42],[-71.001,42]]}};DriveExperience.arrival(true,200,{lat:42,lng:-71.002,entranceConfirmed:false},route);return document.getElementById('arrival-pin-note').textContent;});
    expect(text).toContain('vehicle entrance unverified');expect(text).toContain('from pin');
    await page.evaluate(()=>DriveExperience.arrival(false,100,null,null));await expect(page.locator('#arrival-pin-note')).toBeHidden();
    await expect(page.locator('#search-model-details')).not.toHaveAttribute('open');await page.locator('#search-model-heading').click();await expect(page.locator('#search-modal-sub')).toBeVisible();expect(state.errors).toEqual([]);
});


test('reliability search recovery keeps area input usable and confirms map pins',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.setViewportSize({width:320,height:740});await page.goto('./');
    await page.evaluate(()=>{window.recoveryQueries=[];Geocoder.searchPlaces=async q=>{recoveryQueries.push(q);throw Error('network');};});
    await page.locator('#destination-input').fill('94 Gerry Road');await page.locator('#destination-input-search').click();
    await expect(page.locator('.search-recovery-actions')).toBeVisible();
    await page.locator('.search-recovery-actions input').fill('Brookline, MA');
    await page.getByRole('button',{name:'Search with area',exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>recoveryQueries.at(-1))).toContain('Brookline, MA');
    await expect(page.locator('.search-recovery-actions')).toBeVisible();
    const box=await page.locator('.search-recovery-actions').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(320);
    await page.getByRole('button',{name:'Choose arrival pin on map',exact:true}).click();
    await expect(page.locator('#destination-review-modal')).toBeVisible();
    await expect(page.locator('#destination-entrance-confirmed')).not.toBeChecked();
    await expect(page.locator('#destination-review-address')).toContainText('Arrival pin selected on map');
    await page.locator('#btn-review-cancel').click();expect(state.routes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test('reliability junction schematic fits a narrow phone and hides for uncertain GPS',async({page})=>{
    const state=await fixtures(page,{brokenMap:true,chained:true,nearTurns:true});await captureJourneyControls(page);await page.setViewportSize({width:320,height:740});
    await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#btn-map-start-nav').click();
    await expect.poll(()=>page.evaluate(()=>{testGps.emit();return journeyTestApi.state().snapped;})).toBe(true);
    await expect(page.locator('#junction-schematic')).toBeVisible();await expect(page.locator('#junction-schematic svg polyline')).toHaveCount(1);
    const b=await page.locator('#mobile-turn-banner').boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(320);
    await expect(page.locator('#btn-map-tools')).toBeVisible();
    const topButton=await page.locator('#btn-map-tools').boundingBox();expect(topButton.y).toBeGreaterThanOrEqual(b.y+b.height);
    await expect(page.locator('#btn-recenter-gps')).toBeVisible();
    await page.screenshot({path:'.codex-remote-attachments/junction-1.3.24-'+test.info().project.name+'.png'});
    await expect.poll(()=>page.evaluate(()=>{testGps.emit({accuracy:200});return document.getElementById('junction-schematic').hidden;})).toBe(true);await expect(page.locator('#junction-schematic')).toBeHidden();expect(state.errors).toEqual([]);
});

test('reliability evidence review reports missing calibration and rejects charged performance comparison',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await page.locator('#mobile-toggle-panel').click();await page.locator('#btn-drive-replay').click();
    const at=Date.now(),recording={version:2,samples:[],events:Array.from({length:61},(_,i)=>({type:'performance-sample',recordedAt:at+i*30000,data:{version:'1.3.24',device:'test-phone',brightness:100,brightnessMode:0,visible:true,pip:false,map3d:true,live:true,saver:false,charging:false,externalPowerConnected:false,batteryPercent:80-i/10,batteryTemperatureC:32,renderLatencyMs:12}}))};
    await page.locator('#replay-import').setInputFiles({name:'drive.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recording))});
    await page.locator('#drive-evidence-details summary').click();await expect(page.locator('#drive-evidence-report')).toContainText('12.0');
    await expect(page.locator('#drive-evidence-report')).toContainText('Calibration evidence insufficient');
    const charged=structuredClone(recording);charged.events[2].data.charging=true;
    await page.locator('#performance-compare-file').setInputFiles({name:'prior.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(charged))});
    await expect(page.locator('#performance-comparison')).toContainText('Insufficient comparison');expect(state.errors).toEqual([]);
});

test('reliability ETA evidence and reroute status keep totals and label uncertainty',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await selectDestination(page,'Alpha');
    await page.evaluate(()=>{JourneyUI.etaEvidence(600,{range:{lowFactor:.9,highFactor:1.3,count:5}},25,true);JourneyUI.requestState('ready','forward-recovery');});
    await expect(page.locator('#eta-evidence')).toContainText('9–13 min');await expect(page.locator('#eta-evidence')).toContainText('not a live traffic forecast');
    await expect(page.locator('#journey-request-status')).toContainText('avoiding an early U-turn');
    await expect(page.locator('#sum-duration')).not.toBeEmpty();expect(state.errors).toEqual([]);
});

test('reliability native guidance retries failures with bounded backoff and clears on stop',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');
    const result=await page.evaluate(async()=>{
        let now=1000,calls=0,clears=0;ServiceHealth.shared=ServiceHealth.create(()=>now);
        window.Capacitor={Plugins:{Pip:{setGuidanceRoute:async()=>{calls++;throw Error('bridge busy');},clearGuidanceRoute:async()=>{clears++;}}}};
        const route={analyzed:{coordinates:[[-71,42],[-71.01,42]]},maneuvers:[]};
        NativeNavigation.invalidate();NativeNavigation.sync(route);await new Promise(r=>setTimeout(r,0));NativeNavigation.sync(route);await new Promise(r=>setTimeout(r,0));
        NativeNavigation.sync(route);const bounded=calls;now+=2001;NativeNavigation.sync(route);await new Promise(r=>setTimeout(r,0));NativeNavigation.clear(true);
        return {bounded,calls,clears};
    });
    expect(result).toEqual({bounded:2,calls:3,clears:1});expect(state.errors).toEqual([]);
});

async function detailedMapFixture(page){
    const state=await fixtures(page,{pitched:true});await captureDrivingMap(page);await captureJourneyControls(page);
    const {GeoJSONVT}=await import('@maplibre/geojson-vt'),{fromGeojsonVt}=await import('@maplibre/vt-pbf');
    const features=[[-71.0678,42.3607],[-71.07,42.3602]].map(([x,y],i)=>({type:'Feature',id:i+1,properties:{render_height:20},geometry:{type:'Polygon',coordinates:[[[x,y],[x+.00012,y],[x+.00012,y+.00012],[x,y+.00012],[x,y]]]}}));
    const index=new GeoJSONVT({type:'FeatureCollection',features});let resources=0,blocked=false;
    await page.route('https://tiles.openfreemap.org/**',async route=>{
        resources++;if(blocked)return route.abort();const url=new URL(route.request().url()),tile=url.pathname.match(/\/test\/(\d+)\/(\d+)\/(\d+)\.pbf/);
        if(tile){const [z,x,y]=tile.slice(1).map(Number),data=index.getTile(z,x,y)||{features:[]};return route.fulfill({body:Buffer.from(fromGeojsonVt({building:data})),contentType:'application/x-protobuf',headers:{'Cache-Control':'max-age=3600'}});}
        return route.fulfill({json:{version:8,sources:{buildings:{type:'vector',tiles:['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'],maxzoom:14}},layers:[{id:'background',type:'background',paint:{'background-color':'#e2e8f0'}},{id:'building',type:'fill',source:'buildings','source-layer':'building',paint:{'fill-color':'#94a3b8'}}]},headers:{'Cache-Control':'max-age=3600'}});
    });
    await page.goto('./');
    await page.evaluate(()=>{window.Capacitor={...(window.Capacitor||{}),isNativePlatform:()=>true};});
    await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#btn-map-start-nav').click();
    await establishMapFix(page);
    await expect(page.locator('#driving-map')).toHaveClass(/ready/);await expect.poll(()=>page.evaluate(()=>journeyTestApi.state().busy)).toBe(false);
    // Deterministic renderer inputs after the normal startup path. GPS/routing
    // integration remains exercised by the unmodified driving tests above.
    await page.evaluate(()=>{window.mapDetailBase={...drivingTestState};window.mapDetailUpdate=drivingTestController.update.bind(drivingTestController);drivingTestController.update=()=>{};});
    return {...state,count:()=>resources,block:()=>{blocked=true;}};
}

test('map upgrade settings fit 320px, keep heavy detail optional and persist',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.setViewportSize({width:320,height:740});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await expect(page.locator('#map-detail-terrain')).not.toBeChecked();await expect(page.locator('#map-detail-shade')).not.toBeChecked();
    for(const key of ['style','arrows','buildings','arrival','cache','shade','terrain']){
        const input=page.locator('#map-detail-'+key);await input.locator('..').scrollIntoViewIfNeeded();
        const row=await input.evaluate(el=>({switch:el.parentElement.getBoundingClientRect().toJSON(),row:el.closest('.option-row').getBoundingClientRect().toJSON()}));
        expect(row.switch.width).toBe(44);expect(row.switch.right).toBeLessThanOrEqual(row.row.right+.5);
    }
    await page.locator('#map-detail-buildings').locator('..').click();
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#map-detail-buildings')).not.toBeChecked();expect(state.errors).toEqual([]);
});

test('map upgrades render bounded buildings, route arrows, shade and arrival without changing geometry',async({page})=>{
    const state=await detailedMapFixture(page);
    await expect.poll(()=>page.evaluate(()=>drivingTestMap.querySourceFeatures('buildings',{'sourceLayer':'building'}).length)).toBeGreaterThan(0);
    const result=await page.evaluate(async()=>{
        const s=mapDetailBase,base=drivingTestMap.getSource('driving-route');const coords=JSON.stringify((await base.getData()).features.map(f=>f.geometry.coordinates));
        const data=await drivingTestMap.getSource('nav-arrows').getData();
        return {arrows:data.features.length,height:drivingTestMap.getPaintProperty('nav-buildings','fill-extrusion-height'),filter:drivingTestMap.getFilter('nav-buildings'),coords,errors:drivingMapErrors};
    });
    expect(result.arrows).toBeGreaterThan(0);expect(JSON.stringify(result.height)).toContain('60');expect(JSON.stringify(result.filter)).toContain('within');expect(result.errors).toEqual([]);
    await expect.poll(()=>page.evaluate(async()=>{
        const s=mapDetailBase,segments=s.segments.map(x=>({...x,occlusionRatio:1,shadeState:'confirmed-shade',passTime:new Date().toISOString()}));
        mapDetailUpdate({...s,details:{...s.details,shade:true},segments});return (await drivingTestMap.getSource('nav-shade').getData()).features.length;
    })).toBeGreaterThan(0);
    expect(await page.evaluate(async()=>JSON.stringify((await drivingTestMap.getSource('driving-route').getData()).features.map(f=>f.geometry.coordinates)))).toBe(result.coords);
    await expect.poll(()=>page.evaluate(async()=>{mapDetailUpdate({...mapDetailBase,reliable:false});return (await drivingTestMap.getSource('nav-arrows').getData()).features.length;})).toBe(0);
    await expect(page.locator('#driving-map')).toHaveClass(/ready/);
    await expect.poll(()=>page.evaluate(async()=>{
        const s=mapDetailBase,end=s.end;mapDetailUpdate({...s,reliable:true,position:end,remaining:40,destination:[end[0]+.0002,end[1]],entranceConfirmed:false,maneuver:null});
        return (await drivingTestMap.getSource('nav-arrival').getData()).features.map(f=>f.properties.kind).join(',');
    })).toBe('end,pin,gap');
    await expect(page.locator('#map-detail-status')).toContainText('not a driving route');
    expect(await page.evaluate(()=>drivingTestMap.getLayoutProperty('nav-buildings','visibility'))).toBe('none');
    await page.screenshot({path:test.info().outputPath('map-arrival.png')});expect(state.errors).toEqual([]);
});

test('map cache serves real vector resources offline and can be cleared',async({page})=>{
    const state=await detailedMapFixture(page);
    await expect.poll(()=>page.evaluate(async()=>(await MapCache.stats()).count)).toBeGreaterThan(1);
    // Auto-night mode can load /dark. Reading an unrelated /liberty URL after
    // cutting the network tests an uncached resource, not offline cache reuse.
    const style=await page.evaluate(()=>mapDetailBase.theme);
    expect(style).toMatch(/^https:\/\/tiles\.openfreemap\.org\/styles\/(liberty|dark)$/);
    await expect.poll(()=>page.evaluate(url=>new Promise((resolve,reject)=>{
        const open=indexedDB.open('solarless-map-cache-v1',1);
        open.onerror=()=>reject(open.error);open.onsuccess=()=>{
            const db=open.result,tx=db.transaction('data'),read=tx.objectStore('data').get(url);
            let exists=false;read.onsuccess=()=>{exists=!!read.result;};
            tx.oncomplete=()=>{db.close();resolve(exists);};tx.onerror=()=>{db.close();reject(tx.error);};
        };
    }),style)).toBe(true);
    const before=state.count();state.block();
    const result=await page.evaluate(async url=>{
        const first=await MapCache.resource(url,new AbortController().signal);
        const json=JSON.parse(new TextDecoder().decode(first));return {version:json.version,bytes:(await MapCache.stats()).bytes};
    },style);
    expect(result.version).toBe(8);expect(result.bytes).toBeLessThanOrEqual(32*1048576);expect(state.count()).toBe(before);
    expect(await page.evaluate(()=>MapCache.clear())).toBe(false);
    await page.evaluate(()=>journeyTestApi.stop());
    await page.evaluate(async()=>{if(!await MapCache.clear())throw Error('clear failed');});expect(await page.evaluate(async()=>(await MapCache.stats()).count)).toBe(0);expect(state.errors).toEqual([]);
});

test('optional terrain renders from DEM and is removed under heat while the route survives',async({page})=>{
    const state=await detailedMapFixture(page);const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');ctx.fillStyle='rgb(128,0,0)';ctx.fillRect(0,0,512,512);return c.toDataURL().split(',')[1];});
    let demRequests=0;await page.route('https://tiles.mapterhorn.com/**',route=>{demRequests++;return route.fulfill({contentType:'image/png',body:Buffer.from(png,'base64'),headers:{'Cache-Control':'max-age=3600'}});});
    await expect.poll(()=>page.evaluate(()=>{mapDetailUpdate({...mapDetailBase,maneuver:null,details:{...mapDetailBase.details,terrain:true}});return drivingTestMap.getTerrain()?.source;})).toBe('nav-dem');
    await expect.poll(()=>demRequests).toBeGreaterThan(0);
    await expect.poll(()=>page.evaluate(()=>drivingTestMap.isSourceLoaded('nav-dem'))).toBe(true);
    expect(await page.evaluate(()=>drivingTestMap.getStyle().sources['nav-dem'].maxzoom)).toBe(12);
    await expect.poll(()=>page.evaluate(()=>{mapDetailUpdate({...mapDetailBase,maneuver:null,thermalStatus:2,details:{...mapDetailBase.details,terrain:true}});return drivingTestMap.getTerrain();})).toBeNull();
    expect(await page.evaluate(()=>!!drivingTestMap.getSource('nav-dem'))).toBe(false);expect(await page.evaluate(()=>!!drivingTestMap.getSource('driving-route'))).toBe(true);expect(await page.evaluate(()=>drivingMapErrors)).toEqual([]);expect(state.errors).toEqual([]);
});

test('map cache persists across reload, honors no-store and survives storage failure',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});let requests=0;
    await page.route('https://tiles.openfreemap.org/cache-test/**',route=>{requests++;return route.fulfill({body:'cached map payload',headers:{'Cache-Control':route.request().url().endsWith('private')?'no-store':'max-age=0'}});});
    await page.goto('./');await page.evaluate(async()=>{window.Capacitor={isNativePlatform:()=>true};await MapCache.clear();await MapCache.resource('https://tiles.openfreemap.org/cache-test/stale');});
    await expect.poll(()=>page.evaluate(async()=>(await MapCache.stats()).count)).toBe(1);
    await page.reload();const before=requests;
    const cached=await page.evaluate(async()=>{window.Capacitor={isNativePlatform:()=>true};Object.defineProperty(navigator,'onLine',{configurable:true,value:false});return new TextDecoder().decode(await MapCache.resource('https://tiles.openfreemap.org/cache-test/stale'));});
    expect(cached).toBe('cached map payload');expect(requests).toBe(before);await expect(page.locator('#map-detail-status')).toContainText('Using cached map');
    await page.evaluate(async()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});await MapCache.resource('https://tiles.openfreemap.org/cache-test/private');});
    expect(await page.evaluate(async()=>(await MapCache.stats()).count)).toBe(1);
    expect(await page.evaluate(async()=>{
        const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='data')throw new DOMException('Quota exceeded','QuotaExceededError');return original.apply(this,args);};
        return new TextDecoder().decode(await MapCache.resource('https://tiles.openfreemap.org/cache-test/quota'));
    })).toBe('cached map payload');
    await expect.poll(()=>page.evaluate(()=>MapCache.status().storageFailed)).toBe(true);expect(state.errors).toEqual([]);
});

test('map tile fetch is cancellable and limited to four concurrent transfers',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');
    await page.evaluate(()=>{
        window.Capacitor={isNativePlatform:()=>true};window.cacheTransfers={active:0,max:0,calls:0};window.tileControllers=[];
        window.CapacitorWebFetch=(_url,{signal})=>new Promise((_resolve,reject)=>{
            const t=cacheTransfers;t.active++;t.calls++;t.max=Math.max(t.max,t.active);
            const abort=()=>{t.active--;reject(new DOMException('Aborted','AbortError'));};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
        });
        window.tileResults=Promise.allSettled(Array.from({length:8},(_,i)=>{const c=new AbortController();tileControllers.push(c);return MapCache.resource('https://tiles.openfreemap.org/cancel/'+i,c.signal);}));
    });
    await expect.poll(()=>page.evaluate(()=>cacheTransfers.active)).toBe(4);
    const result=await page.evaluate(async()=>{tileControllers.forEach(c=>c.abort());const outcomes=await tileResults;return {...cacheTransfers,errors:outcomes.map(x=>x.reason?.name)};});
    expect(result).toEqual({active:0,max:4,calls:4,errors:Array(8).fill('AbortError')});expect(state.errors).toEqual([]);
});

test('terrain request failure leaves the base map and guidance alive',async({page})=>{
    const state=await detailedMapFixture(page);
    await page.route('https://tiles.mapterhorn.com/**',route=>route.fulfill({status:503,body:'Terrain unavailable'}));
    await page.evaluate(()=>mapDetailUpdate({...mapDetailBase,maneuver:null,details:{...mapDetailBase.details,terrain:true}}));
    await expect(page.locator('#map-detail-status')).toContainText('Terrain unavailable');
    expect(await page.evaluate(()=>drivingTestMap.getTerrain())).toBeNull();
    await expect(page.locator('#driving-map')).toHaveClass(/ready/);
    expect(await page.evaluate(()=>!!drivingTestMap.getSource('driving-route'))).toBe(true);expect(state.errors).toEqual([]);
});

test('refinement presets and managed budget persist without changing guidance preferences',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.setViewportSize({width:320,height:740});await page.goto('./');await page.locator('#mobile-toggle-panel').click();
    await page.locator('#map-detail-preset').selectOption('detailed');await expect(page.locator('#map-detail-terrain')).toBeChecked();await expect(page.locator('#map-detail-shade')).toBeChecked();
    await page.locator('#map-detail-preset').selectOption('low');await expect(page.locator('#map-detail-buildings')).not.toBeChecked();await expect(page.locator('#map-detail-arrows')).toBeChecked();
    await page.locator('#storage-limit').selectOption('160');await expect(page.locator('#storage-message')).toContainText('Done');
    await page.reload();await page.locator('#mobile-toggle-panel').click();await expect(page.locator('#map-detail-preset')).toHaveValue('low');await expect(page.locator('#storage-limit')).toHaveValue('160');
    await page.locator('#storage-refresh').click();await expect(page.locator('#storage-summary')).toContainText('Known total');
    await page.locator('#btn-drive-record').click();await expect(page.locator('#btn-drive-record')).toHaveAttribute('data-recording','true');
    await page.locator('#storage-clear-recordings').click();await expect(page.locator('#btn-drive-record')).toHaveAttribute('data-recording','false');
    const box=await page.locator('#storage-settings').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth}));expect(box.scroll).toBeLessThanOrEqual(box.width+1);
    await page.screenshot({path:test.info().outputPath('storage-presets-320.png')});expect(state.errors).toEqual([]);
});

test('refinement scene budget trims LRU metadata while active sessions protect every category',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');
    const result=await page.evaluate(async()=>{
        await SceneShadow.storageStats();
        const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('solarless-scene-cache',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
        await new Promise((resolve,reject)=>{const tx=db.transaction('tiles','readwrite');for(const [key,used]of [['old',1],['new',2]])tx.objectStore('tiles').put({value:'{}',bytes:20*1048576,lastAccess:used},key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
        let busy=true;StorageBudget.init(()=>busy);const protectedResults=await Promise.all(['map','scene','roads','recordings'].map(kind=>StorageBudget.clear(kind).then(()=>false,e=>e.message==='STORAGE_IN_USE')));
        const setting=await StorageBudget.set(160).then(()=>false,e=>e.message==='STORAGE_IN_USE');const before=await SceneShadow.storageStats();busy=false;await StorageBudget.set(160);const after=await SceneShadow.storageStats();
        const keys=await new Promise(resolve=>{const r=db.transaction('tiles').objectStore('tiles').getAllKeys();r.onsuccess=()=>resolve(r.result);});
        await StorageBudget.clear('scene');const cleared=await SceneShadow.storageStats();db.close();return {protectedResults,setting,before,after,keys,cleared};
    });
    expect(result.protectedResults).toEqual([true,true,true,true]);expect(result.setting).toBe(true);expect(result.before.bytes).toBe(40*1048576);expect(result.after.bytes).toBe(20*1048576);expect(result.keys).toEqual(['new']);expect(result.cleared.bytes).toBe(0);expect(state.errors).toEqual([]);
});

test('refinement road labels stay bounded and disappear with uncertain GPS',async({page})=>{
    const state=await detailedMapFixture(page);
    await expect.poll(()=>page.evaluate(()=>{
        const s=mapDetailBase;mapDetailUpdate({...s,reliable:true,progress:0,model:{...s.model,maneuvers:[{name:'Current road',progressMeters:0}]},maneuver:{...s.maneuver,name:'Next road',distanceFromCar:200}});
        return [...document.querySelectorAll('.driving-road-label')].filter(e=>!e.hidden).length;
    })).toBeGreaterThan(0);
    expect(await page.locator('.driving-road-label').count()).toBeLessThanOrEqual(2);
    await page.screenshot({path:test.info().outputPath('road-labels.png')});
    await page.evaluate(()=>mapDetailUpdate({...mapDetailBase,reliable:false}));await expect(page.locator('.driving-road-label:visible')).toHaveCount(0);expect(state.errors).toEqual([]);
});

test('refinement visual comparison groups identical geometry and closes without changing selection',async({page})=>{
    const state=await fixtures(page,{brokenMap:true});await page.goto('./');await selectDestination(page,'Alpha');await expect(page.locator('#btn-map-start-nav')).toBeEnabled();await page.locator('#mobile-toggle-panel').click();
    await page.locator('#btn-compare-routes').click();await expect(page.locator('#route-compare-modal')).toBeVisible();await expect(page.locator('#route-compare-summary')).toContainText('Time vs baseline');
    await page.setViewportSize({width:320,height:740});const size=await page.locator('.map-review-card').evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));expect(size.scroll).toBeLessThanOrEqual(size.client+1);
    await page.screenshot({path:test.info().outputPath('route-differences-320.png')});await page.keyboard.press('Escape');await expect(page.locator('#route-compare-modal')).toHaveCount(0);
    await page.locator('#btn-compare-routes').click();await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));await expect(page.locator('#route-compare-modal')).toHaveCount(0);await expect(page.locator('#btn-compare-routes')).toBeFocused();expect(state.errors).toEqual([]);
});
