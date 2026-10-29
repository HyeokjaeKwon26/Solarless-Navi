const test=require('node:test'),assert=require('node:assert/strict');
const regression=require('../js/drive-regression'),budget=require('../js/storage-budget'),roads=require('../js/road-network'),explore=require('../js/solar-exploration'),compare=require('../js/route-comparison'),nav=require('../js/navigation-map');
const fixture=require('./fixtures/drive-release-synthetic.json');
test('truth gates reject wrong position and missed guidance rather than trusting recorded voice',()=>{
 const good=regression.evaluate(fixture);assert.equal(good.fixErrors,0);assert.equal(good.lateGuidance,0);
 const bad=structuredClone(fixture);bad.samples[3].expectedProgressMeters=900;bad.events.find(e=>e.type==='guidance-ground-truth').data.latestAt=1;
 const result=regression.evaluate(bad);assert.ok(result.fixErrors>0);assert.equal(result.lateGuidance,1);assert.equal(regression.gate(result,{max:{fixErrors:0,lateGuidance:0}}).passed,false);
});
test('unlabelled recording cannot pass accuracy or latency gates',()=>{
 const data=structuredClone(fixture);data.samples.forEach(s=>{delete s.expectedMatched;delete s.expectedProgressMeters;});data.events=data.events.filter(e=>!e.type.endsWith('ground-truth'));
 const result=regression.evaluate(data);assert.equal(result.fixErrors,null);assert.equal(result.lateGuidance,null);assert.equal(result.falseRerouteProposals,null);
 assert.equal(regression.gate(result,{max:{fixErrors:0}}).passed,false);assert.equal(regression.gate(result,{}).passed,false);
 assert.equal(regression.gate(result,{maxIncrease:{matched:1}}).passed,false);
});
test('a regression against the same-recording metric baseline fails',()=>{
 const good=regression.evaluate(fixture);assert.equal(regression.gate(good,{maxIncrease:{fixErrors:0}},{fixErrors:0}).passed,true);
 assert.equal(regression.gate({...good,fixErrors:1},{maxIncrease:{fixErrors:0}},{fixErrors:0}).passed,false);
});
test('storage partitions preserve old maximum and low budgets reduce optional caches',()=>{
 for(const size of [160,240,400]){const c=budget.configuration(size);assert.equal(c.total,c.map+c.scene+c.roads+c.reserve);assert.ok(c.scene<=256*1048576);}
 assert.equal(budget.configuration(160).map,20*1048576);assert.equal(budget.configuration(1).total,400*1048576);
});
test('storage admits replacements, evicts LRU only when idle, and refuses active eviction',()=>{
 const rows=[{key:'a',bytes:40,used:1},{key:'b',bytes:40,used:2}];
 assert.deepEqual(budget.plan(rows,[{key:'c',bytes:30}],100),{admit:true,remove:['a']});
 assert.deepEqual(budget.plan(rows,[{key:'c',bytes:30}],100,true),{admit:false,remove:[]});
 assert.deepEqual(budget.plan(rows,[{key:'a',bytes:30}],100,true),{admit:true,remove:[]});
 assert.equal(budget.plan(rows,[{key:'large',bytes:101}],100).admit,false);
});
function pack(tags={},restriction=false,disconnected=false){
 const coords=[[0,0],[.001,0],[.002,0],[.003,0],[.004,0],[.001,.001],[.003,.001]];
 const elements=coords.map((p,i)=>({type:'node',id:i+1,lon:p[0],lat:p[1]}));
 elements.push({type:'way',id:10,nodes:[1,2,3,4,5],tags:{highway:'primary',oneway:'yes'}},{type:'way',id:20,nodes:disconnected?[6,7]:[2,6,7,4],tags:{highway:'residential',oneway:'yes',...tags}});
 if(restriction)elements.push({type:'relation',id:30,tags:{type:'restriction',restriction:'no_left_turn'},members:[{type:'way',role:'from',ref:10},{type:'way',role:'to',ref:20},{type:'node',role:'via',ref:2}]});
 return {version:1,savedAt:Date.now(),elements};
}
const raw={geometry:{coordinates:[[0,0],[.001,0],[.002,0],[.003,0],[.004,0]]}};
test('solar exploration finds a legal connected rejoining branch without downloading data',()=>{
 const result=explore.select(roads.build(pack()),raw,()=>.8);assert.ok(result.length>0);assert.ok(result.length<=4);assert.ok(result.every(p=>p.connectedRoad&&p.lat>.0005));
 assert.deepEqual(explore.select(null,raw,()=>.8),[]);assert.deepEqual(explore.select(roads.build(pack()),raw,()=>0),[]);
});
test('solar exploration rejects disconnected, restricted, private, service and toll branches',()=>{
 for(const data of [pack({},true),pack({},false,true),pack({access:'private'}),pack({highway:'service'}),pack({toll:'yes'})])assert.deepEqual(explore.select(roads.build(data),raw,()=>.8,{tollFree:true}),[]);
});
test('road labels use current and next road, and hide uncertain or distant turns',()=>{
 const a=[0,0],b=[.002,0],c=[.004,0],model={coordinates:[a,b,c],cumulative:[0,222,444],maneuvers:[{name:'Current',progressMeters:0}]};
 const s={model,reliable:true,progress:10,maneuver:{name:'Next',progressMeters:222,distanceFromCar:212,exits:'12'},language:'en'};
 assert.deepEqual(nav.focusLabels(s).map(l=>l.name),['Current','Next · Exit 12']);assert.deepEqual(nav.focusLabels({...s,reliable:false}),[]);
 assert.equal(nav.focusLabels({...s,maneuver:{...s.maneuver,distanceFromCar:501}}).length,1);
});
const route=coords=>({analyzed:{coordinates:coords}});
test('comparison groups only identical geometry and distinguishes cross streets and reverse travel',()=>{
 const a=route([[0,0],[.001,0],[.002,0]]),same=route([[0,0],[.001,0],[.002,0]]),cross=route([[.001,-.001],[.001,.001]]),reverse=route([[.002,0],[0,0]]);
 assert.deepEqual(compare.groups([a,same,cross]).map(g=>g.members.length),[2,1]);
 assert.ok(compare.differences(a,same).every(s=>s.shared));assert.ok(compare.differences(cross,a).every(s=>!s.shared));assert.ok(compare.differences(reverse,a).every(s=>!s.shared));
 assert.ok(compare.differences(route([[0,0],[.002,0]]),a).every(s=>s.shared));
});
test('map presets keep core direction aids and low load removes optional heavy layers',()=>{
 for(const p of Object.values(nav.presets)){assert.equal(p.arrows,true);assert.equal(p.arrival,true);assert.equal(p.style,true);}
 assert.equal(nav.presetName(nav.defaults),'basic');assert.equal(nav.presets.low.buildings,false);assert.equal(nav.presets.low.terrain,false);assert.equal(nav.presets.low.shade,false);
 assert.equal(nav.presetName({...nav.defaults,arrows:false}),'custom');
});

test('release regression CLI rejects changed recordings and fails a labelled latency gate',()=>{
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solarless-regression-')),record=path.join(dir,'record.json'),manifest=path.join(dir,'suite.json');
 try{
  fs.writeFileSync(record,JSON.stringify(fixture));let hash=crypto.createHash('sha256').update(fs.readFileSync(record)).digest('hex');
  const suite={schema:1,cases:[{id:'test',recording:'record.json',sha256:hash,limits:{max:{lateGuidance:0}}}]};fs.writeFileSync(manifest,JSON.stringify(suite));
  const run=()=>spawnSync(process.execPath,[path.resolve('tools/check-drive-regressions.cjs'),manifest],{encoding:'utf8'});
  assert.equal(run().status,0);fs.appendFileSync(record,' ');assert.notEqual(run().status,0);
  const wrong=structuredClone(fixture);wrong.events.find(e=>e.type==='guidance-ground-truth').data.latestAt=1;fs.writeFileSync(record,JSON.stringify(wrong));suite.cases[0].sha256=crypto.createHash('sha256').update(fs.readFileSync(record)).digest('hex');fs.writeFileSync(manifest,JSON.stringify(suite));
  const failed=run();assert.equal(failed.status,1);assert.match(failed.stdout,/lateGuidance/);
 }finally{for(const file of [record,manifest])if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(dir);}
});

test('off-route replay flags proposals inside an explicitly forbidden reroute window',()=>{
 const data=structuredClone(fixture);data.samples.forEach(s=>{s.lat=.001;delete s.expectedProgressMeters;delete s.expectedMatched;});
 const result=regression.evaluate(data);assert.ok(result.rerouteProposals>0);assert.ok(result.falseRerouteProposals>0);assert.equal(regression.gate(result,{max:{falseRerouteProposals:0}}).passed,false);
});
