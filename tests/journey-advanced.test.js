const test=require('node:test'),assert=require('node:assert/strict');
const Guidance=require('../js/navigation-guidance'),Nearby=require('../js/nearby-roads'),Roads=require('../js/road-network');
const Recovery=require('../js/recovery-policy'),Health=require('../js/service-health'),Evidence=require('../js/journey-evidence'),Glare=require('../js/glare-feedback'),Junction=require('../js/junction-preview'),Eta=require('../js/eta-learning');
for(const scenario of require('./fixtures/guidance-parity.json'))test('shared Java/JS guidance: '+scenario.name,()=>{
    const route={analyzed:{coordinates:scenario.points},maneuvers:[]};let state={};
    const edges=(scenario.edges||[]).map((e,id)=>({id,a:e.slice(0,2),b:e.slice(2,4),heading:e[4],way:e[5],from:id,to:id+1}));
    const graph=edges.length?{pack:{savedAt:(scenario.expiresAt||200000)-7*86400000},edges,permitted:(a,b)=>scenario.successors[a.id].includes(b.id),
        nearby:(point,heading)=>edges.map(edge=>({...Roads.projection(point,edge.a,edge.b),edge})).filter(c=>c.distance<=25&&(!Number.isFinite(heading)||Math.abs((heading-c.edge.heading+540)%360-180)<=65))}:null;
    for(const f of scenario.fixes){
        const fix={...f,timestamp:f.at,accuracy:f.accuracy??5,heading:f.heading??90,speedKmh:(f.speed??10)*3.6};
        let candidate=Guidance.match(route,fix,state.snap),nearby=Nearby.assess(graph,fix,candidate,state.nearby);
        if(candidate.isSnapped&&nearby.hold)candidate={...candidate,isSnapped:false,reason:'nearby-road-conflict'};
        const confirmed=Guidance.confirmMatch(candidate,fix,state);
        state={...state,...confirmed,nearby};if(confirmed.result.isSnapped)state.snap=confirmed.result;
        assert.equal(confirmed.result.isSnapped,f.expected,JSON.stringify(f));
    }
});
const route=(seconds,uturn=false)=>({durationSec:seconds,analyzed:{coordinates:[[0,0],[.01,0]]},raw:{legs:[{steps:[{distance:50,maneuver:{type:'turn',modifier:uturn?'uturn':'right'}}]}]}});
test('recovery avoids early U-turn only within budget and honors unverified sun comparison',()=>{
    const a=route(600,true),b=route(680);const data={routes:{fastest:a,glareFree:a,all:[a,b]}};
    assert.equal(Recovery.choose(data,'fastest',2).route,b);assert.equal(Recovery.choose(data,'fastest',0).route,a);
    assert.equal(Recovery.choose(data,'glareFree',2).route,a);b.traffic={blocked:true};assert.equal(Recovery.choose(data,'fastest',2).route,a);
});
test('service backoff isolates failures, obeys retry-after and does not punish cancellation',async()=>{
    let now=1000;const health=Health.create(()=>now);health.failure('route',429,'90');
    assert.throws(()=>health.check('route'),e=>e.retryAfterMs===90000);assert.doesNotThrow(()=>health.check('weather'));
    now+=90001;health.check('route');health.success('route');assert.equal(health.status('route').remainingMs,0);
    await assert.rejects(health.run('search',()=>Promise.reject(Object.assign(Error('cancel'),{name:'AbortError'}))));assert.equal(health.status('search').count,undefined);
    health.failure('search',503);health.failure('search',503);assert.equal(health.status('search').remainingMs,2000);
});
test('recent slowdown is local, bounded, expires and never extrapolates over the whole trip',()=>{
    const d=Evidence.delayTracker(),r={};let value=0;
    for(let i=0;i<=60;i++)value=d.observe(r,i*1000,600,10000,true);
    assert.equal(value,60);
    for(let i=61;i<=121;i++)value=d.observe(r,i*1000,600-(i-60),10000-(i-60)*10,true);
    assert.equal(value,0);assert.equal(d.observe(r,122000,539,9390,false),0);
    assert.equal(d.observe({},123000,900,14000,true),0);
});
test('empirical ETA range needs enough matching route and time observations',()=>{
    const at=Date.parse('2026-10-29T12:00:00Z'),rows=[.9,1,1.1,1.2,1.3].map(r=>({key:'same',slot:Eta.slot(at),at:at-1000,base:600,actual:600*r}));
    assert.equal(Eta.estimate(rows.slice(0,4),'same',at,600).range,undefined);
    assert.deepEqual(Eta.estimate(rows,'same',at,600).range,{lowFactor:.9,highFactor:1.3,count:5});
    assert.equal(Eta.estimate(rows,'different',at,600).range,undefined);
});
test('glare groups keep unknown evidence and require independent held-out dates',()=>{
    const rows=[{glare:true,timestamp:1000,prediction:{risk:.7,evidenceKnown:true,uncertain:false,roadHeading:90,sunAltitude:8,occlusionRatio:0,weatherModel:'forecast'}},{glare:false,prediction:{risk:.9,uncertain:true}}];
    const groups=Glare.stratify(rows);assert.equal(groups[0].truePositive,1);assert.equal(groups[1].unknown,1);
    assert.equal(Glare.evaluateThreshold(Array(100).fill(rows[0])).eligible,false);
    const labelled=[];for(let day=0;day<5;day++)for(let i=0;i<20;i++)labelled.push({timestamp:day*86400000+i*1000,glare:i<10,prediction:{risk:i<10?.8:.5,uncertain:false,evidenceKnown:true}});
    const result=Glare.evaluateThreshold(labelled);assert.equal(result.eligible,true);assert.equal(result.recommendedThreshold,.5);assert.equal(result.automaticCalibration,false);
});
const perf=(charging=false)=>({events:Array.from({length:61},(_,i)=>({type:'performance-sample',recordedAt:i*30000,data:{version:'1.3.24',device:'test',brightness:100,brightnessMode:0,visible:true,pip:false,map3d:true,live:true,saver:false,charging,externalPowerConnected:charging,batteryPercent:80-i/10,batteryTemperatureC:30+i/20,renderLatencyMs:10+i}}))});
test('performance comparison refuses charging, automatic brightness, gaps and short sessions',()=>{
    const a=Evidence.performanceReport(perf());assert.equal(a.comparable,true);assert.equal(a.batteryPointsPerHour,12);assert.equal(a.actualPanelFps,null);
    assert.equal(Evidence.performanceReport(perf(true)).comparable,false);
    const b=perf();b.events[30].data.brightnessMode=1;assert.equal(Evidence.performanceReport(b).comparable,false);
    const c=perf();c.events.splice(20,10);assert.equal(Evidence.performanceReport(c).comparable,false);
    assert.equal(Evidence.comparePerformance(a,{...a,device:'different'}).comparable,false);
});
test('junction drawing uses actual path, fits bounded viewport and does not add lanes',()=>{
    const model={coordinates:[[0,0],[0,.001],[.001,.001]],cumulative:[0,111,222],total:222};
    const shape=Junction.shape(model,{progressMeters:111,following:{distanceAfter:70}});
    assert.ok(shape.length>=3);assert.ok(shape.every(p=>p[0]>=0&&p[0]<=160&&p[1]>=0&&p[1]<=90));
    assert.equal(Junction.shape(model,{progressMeters:NaN}),null);
});
