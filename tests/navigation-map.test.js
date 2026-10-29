const test=require('node:test'),assert=require('node:assert/strict');
const nav=require('../js/navigation-map'),cache=require('../js/map-cache');
const a=[-71,42],b=nav.offset(a,0,100),c=nav.offset(b,100,0),d=nav.offset(c,0,100);
const model={coordinates:[a,b,c,d],cumulative:[0,100,200,300],total:300};
test('map preferences accept only booleans and default heavy extras off',()=>{
    const prefs=nav.settings({getItem:()=>'{"terrain":"yes","buildings":false,"shade":true}'});
    assert.equal(prefs.terrain,false);assert.equal(prefs.buildings,false);assert.equal(prefs.shade,true);
    assert.deepEqual(nav.settings({getItem(){throw Error();}}),nav.defaults);
});
test('maneuver arrow follows the actual polyline and separates chained turns',()=>{
    const turn={type:'turn',progressMeters:100,distanceFromCar:70,following:{progressMeters:200,distanceAfter:100}};
    const data=nav.arrowData(model,turn,true);assert.equal(data.features.length,4);
    assert.ok(data.features[0].geometry.coordinates.some(p=>nav.meters(p,b)<.01));assert.ok(data.features[2].geometry.coordinates.some(p=>nav.meters(p,c)<.01));
    assert.equal(data.features[2].properties.following,true);
    for(const [t,reliable] of [[turn,false],[{...turn,distanceFromCar:501},true],[{...turn,type:'arrive'},true]])assert.equal(nav.arrowData(model,t,reliable).features.length,0);
});
test('route slice clips endpoints, bounds output and handles duplicate points',()=>{
    const result=nav.slice(model,70,130);assert.ok(Math.abs(nav.meters(result[0],b)-30)<.1);assert.ok(Math.abs(nav.meters(result.at(-1),b)-30)<.1);
    assert.deepEqual(nav.slice(null,0,1),[]);assert.deepEqual(nav.slice(model,400,500),[]);
});
test('shade ribbon distinguishes missing, expired and nighttime analysis',()=>{
    const now=Date.now(),base={p1:[a[1],a[0]],p2:[b[1],b[0]],passTime:new Date(now).toISOString(),occlusionRatio:1,shadeState:'confirmed-shade'};
    const states=nav.shadeData([base,{...base,occlusionRatio:null},{...base,occlusionAt:new Date(now-700000).toISOString()},{...base,shadeState:'night'},{...base,occlusionRatio:0,shadeState:'confirmed-clear'}],0,true,now).features.map(f=>f.properties.state);
    assert.deepEqual(states,['shade','unknown','unknown','unknown','clear']);assert.equal(nav.shadeData([base],0,false).features.length,0);
});
test('arrival pin connector is labeled as a gap and requires near reliable progress',()=>{
    const state={reliable:true,remaining:100,position:a,end:b,destination:c,entranceConfirmed:false};
    assert.deepEqual(nav.arrivalData(state).features.map(f=>f.properties.kind),['end','pin','gap']);
    assert.equal(nav.arrivalData({...state,entranceConfirmed:true}).features[1].properties.kind,'entrance');
    for(const s of [{...state,reliable:false},{...state,remaining:351},{...state,position:[0,0]},{...state,destination:null}])assert.equal(nav.arrivalData(s).features.length,0);
});
test('public cache rejects unrelated hosts, credentials and insecure transports',()=>{
    assert.ok(cache.allowed('https://tiles.openfreemap.org/planet/14/1/2.pbf'));assert.ok(cache.allowed('https://tiles.mapterhorn.com/12/1/2.webp'));
    for(const url of ['http://tiles.openfreemap.org/a','https://tiles.openfreemap.org.evil.example/a','https://user:pass@tiles.openfreemap.org/a','https://tile.openstreetmap.org/1/2/3.png','file:///tmp/a'])assert.equal(cache.allowed(url),false);
});
test('cache respects no-store/private/no-cache, age and maximum stale retention',()=>{
    for(const cc of ['no-store','private, max-age=600','no-cache'])assert.equal(cache.expiry(new Headers({'cache-control':cc}),100),null);
    assert.deepEqual(cache.expiry(new Headers({'cache-control':'max-age=100','age':'70'}),100),{freshUntil:30100,expires:100+cache.MAX_AGE});
    assert.equal(cache.expiry(new Headers({'cache-control':'max-age=9999999999'}),0).freshUntil,cache.MAX_AGE);
    assert.deepEqual(cache.expiry(new Headers({'cache-control':'max-age=60, must-revalidate'}),0),{freshUntil:60000,expires:60000});
});
test('cache eviction replaces existing keys and enforces byte and entry bounds',()=>{
    const rows=[{key:'old',size:20,expires:5,used:1},{key:'a',size:40,expires:999,used:10},{key:'b',size:40,expires:999,used:20}];
    assert.deepEqual(cache.eviction(rows,'c',40,90,3,100),['old','a']);
    assert.deepEqual(cache.eviction(rows,'a',40,90,3,100),['old']);
    assert.deepEqual(cache.eviction(rows,'c',5,1000,1,100),['old','a','b']);
});
test('near-road exclusion contains a car buffer and bounds route analysis',()=>{
    const segments=Array.from({length:10000},()=>({p1:[a[1],a[0]],p2:[b[1],b[0]]}));
    const region=nav.corridor(segments,0,a);assert.equal(region.type,'MultiPolygon');assert.ok(region.coordinates.length<=10);assert.ok(region.coordinates.every(p=>p[0].length===5));
});
