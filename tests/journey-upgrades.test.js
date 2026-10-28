const test=require('node:test'),assert=require('node:assert/strict');
const J=require('../js/journey-upgrades'),Journey=require('../js/journey-policy'),Traffic=require('../js/public-traffic');
const raw=(duration=600)=>({duration,distance:1000,geometry:{coordinates:[[-71,42],[-70.99,42]]},legs:[{steps:[]}]});
const route=(id,sec,types)=>({id,durationSec:sec,raw:{...raw(sec),legs:[{steps:types.map(([type,modifier])=>({maneuver:{type,modifier}}))}]}});
test('comfortable route respects time cap, counts U-turns and never changes travel time',()=>{
    const a=route('a',600,[['turn','uturn']]),b=route('b',720,[['turn','left'],['turn','right']]),c=route('c',920,[]);
    const data={routes:{fastest:a,glareFree:c,shade:b,all:[a,b,c]}};
    J.apply(data,2);assert.equal(data.routes.simple,b);assert.equal(data.routes.glareFree,a);assert.equal(data.routes.shade,b);assert.equal(b.durationSec,720);
    J.apply(data,10);assert.equal(data.routes.glareFree,c);assert.equal(data.routes.simple,c);
    J.apply(data,0);assert.equal(data.routes.simple,a);assert.equal(data.routes.shade,a);
});
test('preference rejects blocked/invalid candidates and normalizes persisted budget',()=>{
    const a=route('a',600,[['turn','left']]),b=route('b',610,[]);b.traffic={blocked:true};
    assert.equal(J.apply({routes:{fastest:a,all:[b,route('bad',NaN,[])]}},5).routes.simple,a);
    assert.equal(J.budget(-5),5);assert.equal(J.budget('2'),2);assert.equal(J.budget(Infinity),5);
});
test('itinerary reorder preserves endpoints and does not mutate original plan',()=>{
    const p={current:{name:'A'},pending:[{name:'B'},{name:'C'}]};
    const out=J.reorder(p,2,0);assert.deepEqual([out.current.name,...out.pending.map(p=>p.name)],['C','A','B']);assert.equal(p.current.name,'A');
    assert.throws(()=>J.reorder(p,0,4));assert.throws(()=>J.reorder(p,NaN,0));
});
test('itinerary uses every leg, bounds requests and refuses partial totals',async()=>{
    const points=[0,1,2,3,4].map(n=>({coords:{lat:42,lng:-71+n*.01},name:String(n)}));let calls=0;
    const result=await J.itinerary(points,raw(),async()=>{calls++;return raw(120);},async raws=>raws.length===4);
    assert.equal(calls,3);assert.equal(result.seconds,960);assert.equal(result.meters,4000);
    await assert.rejects(J.itinerary(points,raw(),async()=>{throw Error('offline');},async()=>true));
    await assert.rejects(J.itinerary(points,raw(),async()=>raw(),async()=>false));
    await assert.rejects(J.itinerary([...points,points[0]],raw(),async()=>raw(),async()=>true));
});
test('itinerary discards changed plan during a delayed request and rejects corrupt legs',async()=>{
    const points=[{name:'A'},{name:'B'},{name:'C'}];let current=true;
    await assert.rejects(J.itinerary(points,raw(),async()=>{current=false;return raw();},async()=>true,()=>current));
    await assert.rejects(J.itinerary(points,raw(),async()=>({...raw(),duration:Infinity}),async()=>true));
});
test('closure proposal accepts only recent stationary-context identity and nearby accurate position',()=>{
    const at=1000000,p={at,start:{lat:42,lng:-71},routeKey:'r',destinationKey:'d',toll:false,mode:'simple',budget:5};
    const s={...p,now:at+1000,fixAt:at,live:true,realtime:true,snapped:true,position:p.start,accuracy:5};
    assert.equal(J.proposalCurrent(p,s,()=>10),true);
    for(const change of [{live:false},{snapped:false},{realtime:false},{busy:true},{routeKey:'x'},{destinationKey:'x'},{toll:true},{mode:'shade'},{budget:2},{accuracy:null},{accuracy:36},{now:at+121000},{fixAt:at-20000}])assert.equal(J.proposalCurrent(p,{...s,...change},()=>10),false,JSON.stringify(change));
    assert.equal(J.proposalCurrent({...p,heading:10},{...s,heading:180},()=>0),false);
    assert.equal(J.proposalCurrent(p,s,()=>51),false);assert.equal(J.proposalCurrent(null,s,()=>0),false);
});
test('closure key is order independent and changes for a distinct restriction',()=>{
    const a={source:'test',id:1,name:'Main'},b={source:'test',id:2,name:'Other'};
    assert.equal(J.closureKey({closures:[a,b]}),J.closureKey({closures:[b,a]}));assert.notEqual(J.closureKey({closures:[a]}),J.closureKey({closures:[b]}));
});
test('remaining journey clips passed step geometry so a closure behind does not trigger detour',()=>{
    const coords=[[-71,42],[-70.99,42]],now=Date.now();
    const r={distanceMeters:826,durationSec:600,analyzed:{coordinates:coords},raw:{legs:[{steps:[{name:'Main Street',distance:826,duration:600,geometry:{coordinates:coords}}]}]}};
    const remaining=Journey.remaining(r,{isSnapped:true,lng:-70.995,lat:42,segmentIndex:0,progressMeters:413,remainingMeters:413});
    assert.ok(Math.abs(remaining.steps[0].geometry.coordinates[0][0]+70.995)<.000001);
    const closure={impact:'all-lanes-closed',closureVerified:true,start:now-1000,end:now+60000,direction:'eastbound',names:['Main Street'],points:[[-71,42],[-70.997,42]]};
    assert.equal(Traffic.matchesClosure({legs:[{steps:remaining.steps}]},closure,now),false);
    assert.equal(Traffic.matchesClosure(r.raw,closure,now),true);
});
