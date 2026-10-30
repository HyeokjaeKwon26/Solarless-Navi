const test=require('node:test'),assert=require('node:assert/strict');
const Prep=require('../js/journey-preparation'),Parking=require('../js/parking-memory'),Search=require('../js/search-evidence'),Preference=require('../js/recovery-preference'),Roads=require('../js/road-network'),Junction=require('../js/junction-preview'),Guidance=require('../js/navigation-guidance'),Regression=require('../js/drive-regression');
const memory=()=>{let value=null;return {getItem:()=>value,setItem:(k,v)=>value=v,removeItem:()=>value=null};};
test('corridor sampling fills long edges, caps route length, rejects invalid geography',()=>{
 const c=Prep.corridor([[0,0],[.05,0]]);assert.ok(c.boxes.length>10&&c.boxes.length<27);assert.ok(c.total>5000);assert.ok(c.boxes[0][1]<0);
 assert.throws(()=>Prep.corridor([[0,0],[.07,0],[.14,0]]),/CORRIDOR_LIMIT/);assert.throws(()=>Prep.corridor([[0,80],[.001,80]]));
 assert.throws(()=>Prep.samples([[0,0],[20,0]]));assert.equal(Prep.coverage([[0,0],[.001,0]],null).covered,0);
});
test('saved instructions are only reused at the original start, destination, direction and toll setting',()=>{
 const at=Date.now(),saved={at,destination:[.01,0],avoidTolls:false,raw:{duration:100,distance:1112,legs:[{steps:[{}]}],geometry:{coordinates:[[0,0],[.01,0]]}}},start={lng:0,lat:0},end={lng:.01,lat:0};
 assert.equal(Prep.savedRoute(saved,start,end,{},at).offline,true);
 assert.equal(Prep.savedRoute(saved,{lng:.005,lat:0},end,{},at),null);
 assert.equal(Prep.savedRoute(saved,start,{lng:.02,lat:0},{},at),null);
 assert.equal(Prep.savedRoute(saved,start,end,{heading:270},at),null);
 assert.equal(Prep.savedRoute(saved,start,end,{tollFree:true},at),null);
 assert.equal(Prep.savedRoute(saved,start,end,{},at+86400001),null);
});
test('parking requires explicit stopping, fresh accurate location and rejects movement',()=>{
 const storage=memory(),now=Date.now(),fix={lat:42,lng:-71,accuracy:5,timestamp:now,speed:null,stationaryConfirmed:true},end={lat:42.001,lng:-71};
 assert.throws(()=>Parking.save(storage,{...fix,stationaryConfirmed:false},end,'x',now));
 for(const change of [{speed:10},{timestamp:now-16000},{accuracy:50},{lat:NaN}])assert.throws(()=>Parking.save(storage,{...fix,...change},end,'x',now));
 const saved=Parking.save(storage,fix,end,'Destination',now);assert.ok(Parking.summary(saved).distance>100);assert.deepEqual(Parking.get(storage,now).destination,end);
 assert.equal(Parking.get(storage,now+31*86400000),null);Parking.clear(storage);assert.equal(Parking.get(storage,now),null);
});
test('search badges distinguish exact number, missing number, wrong number and explicit area',()=>{
 const row={houseNumber:'94',road:'Gerry Road',displayName:'94 Gerry Road, Brookline, MA'};
 assert.equal(Search.assess('94 Gerry Rd',row),'address');assert.equal(Search.assess('84 Gerry Rd',row),'different-number');
 assert.equal(Search.assess('94 Gerry Rd',{...row,houseNumber:''}),'street');assert.equal(Search.assess('94 Gerry Rd, Boston',row),'area-unconfirmed');
 assert.equal(Search.assess('94 Gerry Rd, Brookline, MA',row),'address');assert.equal(Search.assess('94 Gerry Rd',{...row,road:'Other Rd'}),'unconfirmed');
 assert.equal(Search.assess('Coffee shop',row),'place');
});
test('recovery evidence is bounded and excludes unverified weather or occlusion',()=>{
 const now=Date.now(),s={p1:[0,0],p2:[.001,0],passTime:now,glareRisk:.3,occlusionRatio:.5,irradiance:{model:'OPEN_METEO_FORECAST'}};
 const policy=Preference.snapshot([{analyzed:{segments:[s,{...s,occlusionRatio:null},{...s,irradiance:{}},{...s,passTime:now+3600000}]}}],'shade',5,now);
 assert.equal(policy.segments.length,1);assert.equal(policy.mode,'shade');assert.equal(policy.budgetSeconds,300);
 assert.equal(Preference.snapshot([{analyzed:{segments:Array(1000).fill(s)}}],'simple',99,now).segments.length,512);
});
test('junction branches require a shared node and never connect a crossing road by geometry',()=>{
 const now=Date.now(),nodes=[{type:'node',id:1,lon:0,lat:0},{type:'node',id:2,lon:.001,lat:0},{type:'node',id:3,lon:.001,lat:.001},{type:'node',id:4,lon:.002,lat:0}];
 const way=(id,ns)=>({type:'way',id,nodes:ns,tags:{highway:'residential'}}),coords=[[0,0],[.001,0],[.001,.001]],route={analyzed:{coordinates:coords},maneuvers:[]},model=Guidance.model(route),turn={location:[.001,0],progressMeters:model.cumulative[1]};
 let graph=Roads.build({version:1,savedAt:now,elements:[...nodes,way(10,[1,2,3]),way(11,[2,4])]});
 const connected=Junction.layout(model,turn,graph);assert.ok(connected.branches.length>=2);assert.ok(connected.points.flat().every(Number.isFinite));
 graph=Roads.build({version:1,savedAt:now,elements:[...nodes,{type:'node',id:5,lon:.001,lat:0},way(10,[1,2,3]),way(11,[5,4])]});
 assert.equal(Junction.layout(model,turn,graph).branches.length,0);
});
test('review issues identify explicit labelled errors and do not manufacture truth',()=>{
 const recording=require('./fixtures/drive-release-synthetic.json'),copy=JSON.parse(JSON.stringify(recording));
 copy.samples[3].expectedMatched=false;const r=Regression.evaluate(copy);assert.ok(r.issues.some(i=>i.kind==='fix'&&i.index===3));assert.equal(r.synthetic,true);
 for(const s of copy.samples){delete s.expectedMatched;delete s.expectedProgressMeters;}copy.events=copy.events.filter(e=>!e.type.endsWith('ground-truth'));
 const empty=Regression.evaluate(copy);assert.equal(empty.fixErrors,null);assert.equal(empty.issues.length,0);
});
