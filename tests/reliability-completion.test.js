const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Segment=require('../js/segment-eta'),Eta=require('../js/eta-learning'),Truth=require('../js/drive-truth'),Regression=require('../js/drive-regression'),Entrance=require('../js/entrance-candidates'),Junction=require('../js/junction-presentation');
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
function route(offset=0){const a=[.001,0],b=[.003,0],coords=[[offset,0],a,b,[.004,0]];return {durationSec:200,analyzed:{coordinates:coords},raw:{legs:[{steps:[{name:'Shared Road',duration:60,geometry:{coordinates:[a,b]}}]}]}};}
const now=new Date(2026,9,26,8).getTime();
test('segment ETA transfers only identical directed geometry and applies only to the remaining shared section',()=>{
    const r=route(),part=Segment.segments(r)[0],rows=Array.from({length:5},(_,i)=>({key:part.key,slot:Eta.slot(now),trip:now-(i+1)*7*86400000,at:now-(i+1)*7*86400000,base:60,actual:78}));
    const estimate=Segment.profile(rows,route(-.001),now);assert.equal(estimate.applied,true);assert.equal(estimate.factor,1.09);assert.equal(estimate.count,5);
    assert.equal(estimate.remainingFactor(10000,60),1);assert.equal(estimate.remainingFactor(0,60),1.3);
    assert.equal(Segment.profile(rows.slice(1),r,now).applied,false);
    assert.equal(Segment.profile(rows.map(v=>({...v,trip:1})),r,now).applied,false);
    const reversed=route();reversed.raw.legs[0].steps[0].geometry.coordinates.reverse();assert.equal(Segment.profile(rows,reversed,now).applied,false);
    const parallel=route();parallel.raw.legs[0].steps[0].geometry.coordinates=parallel.raw.legs[0].steps[0].geometry.coordinates.map(p=>[p[0],.0002]);assert.equal(Segment.profile(rows,parallel,now).applied,false);
    assert.equal(Segment.profile(rows,r,now+91*86400000).applied,false);
});
test('segment ETA records complete crossings, retains traffic-light stops, rejects gaps and long unexplained stops',()=>{
    for(const mode of ['normal','gap','long-stop','short-stop','unmatched']){
        let at=now;const store=memory(),api=Segment.create(store,()=>at),r=route(),p=Segment.segments(r)[0];api.start(r);
        const fix=(position,speed=20,snapped=true,seconds=10)=>{at+=seconds*1000;api.sample(r,{isSnapped:snapped,timestamp:at,progressMeters:position,speedKmh:speed});};
        fix(p.start-10);fix(p.start+10);
        if(mode.includes('stop'))for(let i=0;i<(mode==='long-stop'?14:2);i++)fix(p.start+10,0);
        for(let i=1;i<=5;i++)fix(p.start+10+(p.end-p.start-20)*i/5,20,mode!=='unmatched',mode==='gap'?20:10);
        fix(p.end+10);
        const rows=JSON.parse(store.getItem(Segment.KEY)||'[]');assert.equal(rows.length,['normal','short-stop'].includes(mode)?1:0,mode);
    }
});
test('segment learning requires consent, does not double-correct traffic, and clears all history',()=>{
    const store=memory(),r=route(),part=Segment.segments(r)[0],rows=Array.from({length:5},(_,i)=>({key:part.key,slot:Eta.slot(now),trip:now-(i+1)*7*86400000,at:now-(i+1)*7*86400000,base:60,actual:78}));store.setItem(Segment.KEY,JSON.stringify(rows));
    const api=Eta.create(store,()=>now);assert.equal(api.estimate(r).applied,false);api.enable(true);assert.equal(api.estimate(r).applied,true);
    assert.equal(api.estimate({...r,traffic:{coverage:.5}}).applied,false);api.clear();assert.deepEqual(JSON.parse(store.getItem(Segment.KEY)),[]);assert.equal(api.enabled,true);
});
const recording=()=>({version:2,samples:[{timestamp:now,lat:0,lng:0,accuracy:5,heading:90,speedKmh:20}],events:[{type:'native-location',recordedAt:now,data:{timestamp:now,lat:0,lng:0,accuracy68:3,speedMps:5}},{type:'route',recordedAt:now-1000,data:{coordinates:[[0,0],[.01,0]],maneuvers:[]}}]});
test('truth labels are explicit, reversible and isolated by foreground/native location source',()=>{
    const original=recording(),labelled=Truth.labelFix(original,'native',now,false,null);
    assert.equal(original.events[0].data.expectedMatched,undefined);assert.equal(labelled.samples[0].expectedMatched,undefined);assert.equal(labelled.events[0].data.expectedMatched,false);
    assert.equal(Truth.labelFix(labelled,'native',now,null).events[0].data.expectedMatched,undefined);
    assert.throws(()=>Truth.labelFix({...original,samples:[...original.samples,...original.samples]},'foreground',now,true));
    const turns=Truth.labelEvent(original,'native','guidance-ground-truth',{routeIndex:0,progressMeters:100,stage:'execute',earliestAt:now-1000,latestAt:now});
    assert.equal(Regression.evaluate(turns,'foreground').guidanceLabels,0);assert.equal(Regression.evaluate(turns,'native').guidanceLabels,1);
    assert.throws(()=>Truth.labelEvent(original,'foreground','reroute-ground-truth',{start:10,end:0,allowed:false}));
});
test('version comparisons require identical labelled bytes and source; unknown metrics remain unknown',async()=>{
    const r=recording(),a=await Truth.report(r,'foreground','old'),b=await Truth.report(r,'foreground','new');
    assert.equal(Truth.compare(a,b).changes.fixErrors,null);assert.equal(a.recordingSha256.length,64);
    assert.throws(()=>Truth.compare(a,{...b,source:'native'}));
    const changed=await Truth.report(Truth.labelFix(r,'foreground',now,true,0),'foreground','new');assert.throws(()=>Truth.compare(a,changed));
});
test('entrances rank a connected driving approach above a closer unverified pin and cap remote requests',async()=>{
    const items=Array.from({length:5},(_,i)=>({id:i,lng:.001+i*.001,lat:0,distance:i+1,approaches:[{a:[i*.001,0],b:[.001+i*.001,0]}]}));let calls=0;
    const rows=await Entrance.rank(items,{lng:0,lat:0},{quote:async(start,end)=>{calls++;if(end.id===0)throw Error('UNREACHABLE');return {duration:60,distance:300,geometry:{coordinates:[[end.lng-.0002,0],[end.lng,0]]},legs:[{steps:[]}]};}});
    assert.equal(calls,3);assert.equal(rows[0].id,1);assert.equal(rows.find(v=>v.id===0).approach,null);
    assert.equal(Entrance.approachMatches(items[0],{duration:30,geometry:{coordinates:[[.0012,0],[.001,0]]}}),false);
    let current=true;assert.deepEqual(await Entrance.rank(items,{lng:0,lat:0},{isCurrent:()=>current,quote:async()=>{current=false;throw Error();}}),[]);
});
test('junction phases prefer sign, mapped lane preparation and immediate arrow without fabricating lane data',()=>{
    const turn={type:'off ramp',distanceFromCar:800,exits:'7',ref:'I-90',destinations:'Downtown',lanes:{total:3,valid:[2,3]},following:{distanceAfter:100}};
    assert.equal(Junction.present(turn,60).phase,'approach');assert.match(Junction.present(turn,60).sign,/Downtown/);assert.equal(Junction.present(turn,60).lanes,null);
    assert.equal(Junction.present({...turn,distanceFromCar:250},60).lanes.total,3);
    const close=Junction.present({...turn,distanceFromCar:15},60);assert.equal(close.compact,true);assert.equal(close.lanes,null);assert.ok(close.following);
    assert.equal(Junction.present({...turn,distanceFromCar:250,lanes:{total:3,valid:[4]}},60).lanes,null);
    assert.equal(Junction.present({...turn,type:'arrive'},60).phase,'none');
});
test('native handoff rejects another destination and prevents the old WebView route overwriting recovery',async()=>{
    let calls=0;const old={analyzed:{coordinates:[[0,0],[.01,0]]}},state={revision:500,route:{geometry:{coordinates:[[0,0],[.01,0]]}},destination:[.01,0],recoveredAt:now};
    const root={Capacitor:{Plugins:{Pip:{getGuidanceRecovery:async()=>state,setGuidanceRoute:async()=>{calls++;}}}},PublicTraffic:{distance:(a,b)=>Math.abs(a[0]-b[0])*111195},TTSVoice:{getLanguage:()=> 'en-US',isMuted:()=>false},NavigationUnits:{system:()=> 'metric'},NavigationGuidance:{model:()=>({coordinates:old.analyzed.coordinates,maneuvers:[]})}};
    vm.runInNewContext(fs.readFileSync('js/native-navigation.js','utf8'),{window:root,Date,setTimeout,clearTimeout});
    assert.equal(await root.NativeNavigation.recovery({lng:.02,lat:0},old),null);
    assert.ok(await root.NativeNavigation.recovery({lng:.01,lat:0},old));root.NativeNavigation.invalidate();root.NativeNavigation.sync(old);assert.equal(calls,0);
    root.NativeNavigation.sync({...old});await new Promise(r=>setImmediate(r));assert.equal(calls,1);
});
test('stopping during a native handoff cancels the response and clears an invalidated route',async()=>{
    let resolve,clears=0;const root={Capacitor:{Plugins:{Pip:{getGuidanceRecovery:()=>new Promise(r=>resolve=r),clearGuidanceRoute:async()=>{clears++;}}}},PublicTraffic:{distance:()=>0}};
    vm.runInNewContext(fs.readFileSync('js/native-navigation.js','utf8'),{window:root,Date,setTimeout,clearTimeout});
    const pending=root.NativeNavigation.recovery({lng:0,lat:0},{});root.NativeNavigation.clear(true);resolve({revision:2,destination:[0,0],route:{}});
    assert.equal(await pending,null);assert.equal(clears,1);
    root.Capacitor.Plugins.Pip.getGuidanceRecovery=async()=>({revision:3,destination:[0,0],route:{}});
    await root.NativeNavigation.recovery({lng:0,lat:0},{});root.NativeNavigation.invalidate();root.NativeNavigation.clear();assert.equal(clears,2);
});
