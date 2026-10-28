const test=require('node:test'),assert=require('node:assert/strict');
const Eta=require('../js/eta-learning'),Detours=require('../js/route-detours'),Guidance=require('../js/navigation-guidance');
const route={durationSec:600,analyzed:{coordinates:[[-71,42],[-70.99,42]]}};
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v)};};
const now=new Date(2026,9,26,8).getTime();
const rows=(ratios)=>ratios.map((ratio,i)=>({key:Eta.routeKey(route),slot:Eta.slot(now),at:now-(ratios.length-i)*7*86400000,base:600,actual:600*ratio}));
test('personal ETA needs five comparable trips and beats held-out baseline before applying',()=>{
    assert.equal(Eta.estimate(rows([1.3,1.3,1.3,1.3]),Eta.routeKey(route),now,600).applied,false);
    assert.equal(Eta.estimate(rows([1.3,1.3,1.3,1.3,1.3]),Eta.routeKey(route),now,600).factor,1.3);
    assert.equal(Eta.estimate(rows([1.3,1.3,1.3,1,1]),Eta.routeKey(route),now,600).applied,false);
    assert.equal(Eta.estimate(rows([1.3,1.3,1.3,1.3,1.3]),'other route',now,600).applied,false);
    assert.equal(Eta.estimate(rows([1.3,1.3,1.3,1.3,1.3]),Eta.routeKey(route),now+3*3600000,600).applied,false);
    assert.equal(Eta.estimate(rows([2,2,2,2,2]),Eta.routeKey(route),now,600).applied,false);
});
test('ETA history is opt-in, persists only complete sampled trips, and deletes without disabling consent',()=>{
    const store=memory();let at=now;const api=Eta.create(store,()=>at);
    const run=()=>{api.start(route);for(let i=0;i<13;i++){at+=60000;api.sample(route,{isSnapped:true,timestamp:at,speedKmh:30});}return api.finish(route,true);};
    assert.equal(run(),false);assert.equal(api.count,0);api.enable(true);assert.equal(run(),true);
    assert.equal(Eta.create(store,()=>at).count,1);assert.equal(api.enabled,true);api.clear();assert.equal(api.count,0);assert.equal(api.enabled,true);
    api.enable(false);assert.equal(Eta.create(store,()=>at).enabled,false);
});
test('ETA discards route changes, gaps, abandonment, long stops and live traffic',()=>{
    for(const kind of ['route','gap','stop','cancel','traffic']){
        let at=now;const api=Eta.create(memory(),()=>at);api.enable(true);api.start(route);
        for(let i=0;i<7;i++){at+=kind==='gap'?61000:60000;api.sample(kind==='route'?{...route,analyzed:{coordinates:[[-71,42],[-70.98,42]]}}:kind==='traffic'?{...route,traffic:{coverage:.1}}:route,{timestamp:at,isSnapped:true,speedKmh:kind==='stop'?0:30});}
        assert.equal(api.finish(route,kind!=='cancel'),false,kind);assert.equal(api.count,0);
    }
});
test('ETA malformed persistence and storage failure cannot fabricate consent or records',()=>{
    const store=memory();store.setItem(Eta.KEY,'{"enabled":true,"records":[{}]}');const api=Eta.create(store,()=>now);assert.equal(api.count,0);
    store.setItem=()=>{throw Error('disk');};assert.throws(()=>api.enable(false));assert.equal(api.enabled,true);
    assert.equal(Eta.routeKey({...route,analyzed:{coordinates:[[null,42],[-71,42]]}}),null);
});
test('ETA excludes live speeds and expired history, and keeps raw route times unchanged',()=>{
    const store=memory(),history=rows([1.3,1.3,1.3,1.3,1.3]);
    store.setItem(Eta.KEY,JSON.stringify({enabled:true,records:[...history,{...history[0],at:now-91*86400000}]}));
    const api=Eta.create(store,()=>now);assert.equal(api.count,5);assert.equal(JSON.parse(store.getItem(Eta.KEY)).records.length,5);
    assert.equal(api.estimate(route).factor,1.3);assert.equal(route.durationSec,600);
    assert.equal(api.estimate({...route,traffic:{coverage:.01}}).applied,false);assert.equal(api.estimate({...route,offline:true}).applied,false);
});
const response=(seconds,legs=1)=>({code:'Ok',waypoints:Array.from({length:legs+1},()=>({distance:2})),routes:[{duration:seconds,distance:seconds*10,geometry:{coordinates:[[-71,42],[-70.99,42]]},legs:Array.from({length:legs},()=>({steps:[{maneuver:{modifier:'straight'}}]}))}]});
test('shared routing queue spaces launches and skips cancelled requests without blocking later work',async()=>{
    let at=0;const calls=[];const request=Detours.createRoutingFetch(async url=>{calls.push([url,at]);return url;},()=>at,async ms=>{at+=ms;});
    const controller=new AbortController();controller.abort();
    const results=await Promise.allSettled([request('first'),request('cancelled',{signal:controller.signal}),request('second'),request('third')]);
    assert.equal(results[1].status,'rejected');assert.deepEqual(calls,[['first',0],['second',1000],['third',2000]]);
    const malformed=response(600,2);malformed.routes[0].legs[0].steps={};assert.throws(()=>Detours.validate(malformed,true));
});
test('detour quotes compare real via routes, bound requests, sort and preserve unknown results',async()=>{
    let calls=0;const queue=[response(600),response(900,2),response(660,2),response(780,2)];
    const items=[0,1,2,3].map(i=>({id:i,lat:42,lng:-71+i*.001}));
    const result=await Detours.rank(items,items[0],{lat:42,lng:-70.9},{fetcher:async()=>({ok:true,text:async()=>JSON.stringify(queue[calls++])})});
    assert.equal(calls,4);assert.deepEqual(result.map(i=>i.id),[1,2,0,3]);assert.equal(result[0].detour.extraSeconds,60);assert.equal(result[3].detour,null);
});
test('detours stop on throttling, reject far snaps and discard stale results',async()=>{
    const start={lat:42,lng:-71},end={lat:42,lng:-70.9},items=[start,start,start];let calls=0;
    const result=await Detours.rank(items,start,end,{fetcher:async()=>++calls===1?{ok:true,text:async()=>JSON.stringify(response(600))}:{ok:false,status:429}});
    assert.equal(calls,2);assert.ok(result.every(i=>!i.detour));
    const far=response(600,2);far.waypoints[1].distance=61;assert.throws(()=>Detours.validate(far,start));
    assert.deepEqual(await Detours.rank(items,start,end,{isCurrent:()=>false,fetcher:async()=>({ok:true,text:async()=>JSON.stringify(response(600))})}),[]);
    assert.match(Detours.url(start,end,start,{tollFree:true,heading:90}),/exclude=toll&bearings=90,60;;$/);
    assert.ok(!Detours.url(start,end,start,{heading:undefined}).includes('bearings='));
});
test('verified closures are never presented as valid detour quotes',async()=>{
    let calls=0;const p={lat:42,lng:-71};
    const result=await Detours.rank([p],p,{lat:42,lng:-70.9},{fetcher:async()=>({ok:true,text:async()=>JSON.stringify(response(600,++calls===1?1:2))}),inspect:async()=>[true,false]});
    assert.equal(result[0].blocked,true);assert.equal(result[0].detour,null);
});
test('route matching retains bounded trajectory and rejects duplicate time without losing turns',()=>{
    const r={analyzed:{coordinates:[[0,0],[.01,0]]}};let snap=null;
    for(let i=0;i<40;i++)snap=Guidance.match(r,{lng:i*.00002,lat:0,heading:90,accuracy:5,speedKmh:32,timestamp:10000+i*250},snap);
    assert.equal(snap.isSnapped,true);assert.equal(snap.history.length,32);
    assert.equal(Guidance.match(r,{lng:.001,lat:0,accuracy:5,timestamp:snap.timestamp},snap).reason,'stale');
    const missing=Guidance.match(r,{lng:.001,lat:0,accuracy:5,heading:90,speedKmh:32,timestamp:50000},snap);
    assert.equal(missing.history.length,1);
});
test('trajectory rejects a nearby later loop when progress exceeds actual movement',()=>{
    const r={analyzed:{coordinates:[[0,0],[.00027,0],[.00027,.00009],[0,.00009],[0,.00018],[.002,.00018]]}};
    const fix=(lng,lat,timestamp)=>({lng,lat,timestamp,accuracy:5,heading:90,speedKmh:180});
    const first=Guidance.match(r,fix(0,0,10000));
    const second=Guidance.match(r,fix(.00004,0,11000),first);
    assert.equal(first.isSnapped,true);assert.equal(second.isSnapped,true);
    const snap=Guidance.match(r,fix(.00004,.00018,12000),second);
    assert.equal(snap.isSnapped,false);
    assert.equal(snap.reason,'motion-conflict');
    const recovered=Guidance.match(r,fix(.00006,0,13000),second);
    assert.equal(recovered.isSnapped,true);assert.ok(recovered.progressMeters<10);
});
