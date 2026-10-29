const test=require('node:test'),assert=require('node:assert/strict');
const Memory=require('../js/entrance-memory'),Alerts=require('../js/alert-settings'),Experience=require('../js/drive-experience'),Driving=require('../js/driving-view');
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};};
test('confirmed entrances require exact normalized address and nearby original search pin',()=>{
    const s=storage(),anchor={lat:42,lng:-71},pin={lat:42.0002,lng:-71,entranceConfirmed:true};
    assert.equal(Memory.save(s,'84 Gerry Road, Brookline',anchor,{...pin,entranceConfirmed:false},1000),false);
    assert.equal(Memory.save(s,'84 Gerry Road, Brookline',anchor,pin,1000),true);
    assert.deepEqual(Memory.find(s,'  84 GERRY Road, Brookline ',anchor,2000).pin,{lat:pin.lat,lng:pin.lng});
    assert.equal(Memory.find(s,'94 Gerry Road, Brookline',anchor,2000),null);
    assert.equal(Memory.find(s,'84 Gerry Road, Brookline',{lat:43,lng:-71},2000),null);
    assert.equal(Memory.find(s,'84 Gerry Road, Brookline',anchor,180*86400000+1000),null);
    assert.equal(Memory.find(s,'84 Gerry Road, Brookline',anchor,999),null);
});
test('remembered entrance storage is bounded, validates coordinates and clears independently',()=>{
    const s=storage(),p={lat:42,lng:-71,entranceConfirmed:true};
    for(let i=0;i<60;i++)assert.equal(Memory.save(s,'address '+i,p,p,1000+i),true);
    assert.equal(Memory.read(s,1100).length,50);
    assert.equal(Memory.save(s,'bad',p,{lat:NaN,lng:-71,entranceConfirmed:true},1100),false);
    assert.equal(Memory.save(s,'far',p,{lat:43,lng:-71,entranceConfirmed:true},1100),false);
    s.setItem('favorites','keep');assert.equal(Memory.clear(s),true);assert.equal(Memory.read(s).length,0);assert.equal(s.getItem('favorites'),'keep');
    assert.equal(Memory.save({getItem:()=>null,setItem:()=>{throw Error('full');}},'a',p,p),false);
});
test('glare episode repeats only after sustained recovery or meaningful escalation',()=>{
    const g=Alerts.glareGate();assert.equal(g.observe(.6,1000),true);g.sent(.6,1000);
    assert.equal(g.observe(.6,60000),false);assert.equal(g.observe(.61,200000),false);
    assert.equal(g.observe(.9,61000),true);g.sent(.9,61000);
    g.observe(.2,62000);g.observe(.2,67000);assert.equal(g.observe(.9,92000),false);
    g.observe(.2,93000);g.observe(.2,104000);assert.equal(g.observe(.7,105000),true);
    g.reset();assert.equal(g.observe(NaN,0),false);assert.equal(g.observe(.5,1),true);
});
test('alert preferences reject unknown modes while leaving unconfigured types enabled',()=>{
    assert.deepEqual(Alerts.normalize({glare:'off',speeding:'visual',road:'invalid'}),{glare:'off',speeding:'visual',road:'both'});
    assert.equal(Alerts.allows('turn','voice'),true);assert.equal(Alerts.allows('arrival','voice'),true);
});
test('grouping preserves preference roles and only merges exact route geometry',()=>{
    const a={analyzed:{coordinates:[[1,2],[2,3]]}},b={analyzed:{coordinates:[[1,2],[2,3]]}},c={analyzed:{coordinates:[[1,2],[2,3.0001]]}};
    assert.deepEqual(Experience.groups({fastest:a,glareFree:b,shade:c}).map(g=>g.roles),[['fastest','glareFree'],['shade']]);
    assert.equal(Experience.same({id:'x'},{id:'x'}),false);
});
test('display cadence preserves approaching turns and limits stationary redraws',()=>{
    assert.equal(Driving.cadence({speed:0}),200);
    assert.equal(Driving.cadence({speed:60}),50);
    assert.equal(Driving.cadence({speed:40,reliable:true,autoZoom:true,maneuver:{type:'turn',distanceFromCar:80}}),33);
    assert.equal(Driving.cadence({speed:40,reliable:true,autoZoom:true,maneuver:{type:'turn',distanceFromCar:80}},{reduced:true}),66);
    assert.equal(Driving.cadence({speed:0},{reduced:true}),200);
});
test('map render latency pressure degrades with hysteresis and restores after recovery',()=>{
    let q=Driving.quality({}, {now:1000,latency:100});assert.equal(q.reduced,false);
    q=Driving.quality(q,{now:4100,latency:100});assert.equal(q.reduced,true);
    q=Driving.quality(q,{now:5000,latency:20});assert.equal(q.reduced,true);
    q=Driving.quality(q,{now:20100,latency:20});assert.equal(q.reduced,false);
    assert.equal(Driving.quality(q,{now:21000,latency:10,thermalStatus:2}).reduced,true);
});
