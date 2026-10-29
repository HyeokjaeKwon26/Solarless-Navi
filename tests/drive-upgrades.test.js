const test=require('node:test'),assert=require('node:assert/strict');
const Replay=require('../js/drive-replay'),Nearby=require('../js/nearby-roads'),Graph=require('../js/road-network'),Glare=require('../js/glare-feedback'),Entrance=require('../js/entrance-candidates'),{quality,policy}=require('../js/driving-view');
const now=Date.now();
function pack(extra=[]){return {version:1,savedAt:now,elements:[
    {type:'node',id:1,lon:0,lat:0},{type:'node',id:2,lon:.001,lat:0},
    {type:'node',id:3,lon:0,lat:.00016},{type:'node',id:4,lon:.001,lat:.00016},
    {type:'way',id:11,nodes:[1,2],tags:{highway:'residential',oneway:'yes'}},
    {type:'way',id:12,nodes:[3,4],tags:{highway:'residential',oneway:'yes'}},...extra]};}
const fix=(extra={})=>({lat:.00008,lng:.0005,accuracy:20,speedKmh:30,heading:90,timestamp:now,...extra});
test('nearby parallel roads remain uncertain; precise separation resolves the candidate',()=>{
    const graph=Graph.build(pack()),snap={isSnapped:true,lat:0,lng:.0005,distMeters:9};
    const ambiguous=Nearby.assess(graph,fix(),snap);assert.equal(ambiguous.hold,true);assert.equal(ambiguous.status,'ambiguous');
    const precise=Nearby.assess(graph,fix({lat:0,accuracy:3,timestamp:now+1000}),{...snap,distMeters:0},ambiguous);
    assert.equal(precise.hold,false);assert.equal(precise.way,11);assert.equal(precise.connected,true);
});
test('nearby evidence does not move a car onto a competing road or override missing data',()=>{
    const graph=Graph.build(pack());
    const conflict=Nearby.assess(graph,fix({lat:.00016,accuracy:3}),{isSnapped:true,lat:0,lng:.0005,distMeters:18});assert.equal(conflict.status,'conflict');
    assert.equal(Nearby.assess(null,fix(),{}).status,'unavailable');
    assert.equal(Nearby.assess(graph,fix({heading:270}),{}).status,'unavailable');
    assert.equal(Nearby.assess(graph,fix({accuracy:80}),{}).hold,false);
    assert.equal(Nearby.nativeSnapshot(graph).expiresAt,now+7*86400000);
});
test('thermal and sustained frame pressure reduce rendering, stable recovery avoids toggling',()=>{
    let p=quality({}, {now:1000,fps:15});assert.equal(p.reduced,false);
    p=quality(p,{now:4000,fps:15});assert.equal(p.reduced,true);assert.equal(p.pixelRatio,1);
    p=quality(p,{now:5000,fps:60});assert.equal(p.reduced,true);
    p=quality(p,{now:19000,fps:60});assert.equal(p.reduced,true);
    p=quality(p,{now:20000,fps:60});assert.equal(p.reduced,false);
    assert.equal(quality(p,{now:21000,fps:60,thermalStatus:2}).reduced,true);
});
test('camera anticipates curves, preserves junction priority and shows more road at speed',()=>{
    const s={reliable:true,autoZoom:true,speed:40,segments:[{p1:[0,0],p2:[0,.001]},{p1:[0,.001],p2:[.001,.001]}]};
    assert.equal(policy(s).pitch,42);assert.equal(policy(s).zoom,16.7);
    assert.equal(policy({...s,speed:100}).zoom,16);
    assert.equal(policy({...s,maneuver:{type:'turn',distanceFromCar:50,location:[.001,0]}}).pitch,32);
});
test('glare labels distinguish false alarms, missed glare and unknown predictions',()=>{
    const row=(risk,glare,uncertain=false)=>Glare.observation({lat:42,lng:-71,timestamp:now,glarePrediction:{risk,uncertain}},glare,now);
    const r=Glare.summarize([row(.8,true),row(.8,false),row(.1,false),row(.1,true),row(.9,true,true)]);
    assert.equal(r.labelled,4);assert.equal(r.unknown,1);assert.equal(r.falsePositiveRate,.5);assert.equal(r.missRate,.5);
    assert.equal(Glare.summarize([]).missRate,null);
    assert.throws(()=>Glare.observation({timestamp:now},true));
    assert.equal(Glare.retain([{observedAt:now-91*86400000},...Array.from({length:201},()=>({observedAt:now}))],now).length,200);
});
test('entrances require explicit vehicle tags and an incoming legal shared-node connection',()=>{
    const p=pack();p.elements[1].tags={amenity:'parking_entrance',name:'Public parking'};
    p.elements.push({type:'node',id:8,lon:.0005,lat:.00001,tags:{amenity:'parking_entrance'}},
        {type:'node',id:9,lon:.0006,lat:0,tags:{entrance:'yes'}});
    const rows=Entrance.candidates(p,[.001,0]);assert.equal(rows.length,1);assert.equal(rows[0].id,2);assert.equal(rows[0].oneWay,true);assert.equal(rows[0].verified,false);
    p.elements[1].tags.access='private';assert.equal(Entrance.candidates(p,[.001,0]).length,0);
});
test('exit-only and disconnected or conditional entrances are not recommended',()=>{
    const p=pack();p.elements[0].tags={amenity:'parking_entrance'}; // start of one-way: no incoming edge
    p.elements[1].tags={amenity:'parking_entrance',entrance:'exit'};
    assert.deepEqual(Entrance.candidates(p,[.001,0]),[]);
    p.elements[1].tags={amenity:'parking_entrance','access:conditional':'yes @ (Mo-Fr)'};
    assert.deepEqual(Entrance.candidates(p,[.001,0]),[]);
});
test('replay recomputes recorded GPS against route revisions without treating saved matches as truth',()=>{
    const sample=(time,lng,extra={})=>({lat:0,lng,timestamp:time,receivedAt:time,accuracy:5,heading:90,reportedSpeedKmh:20,...extra});
    const recording={version:2,samples:[sample(1000,.0001,{snapped:false}),sample(2000,.00015,{expectedProgressMeters:900}),sample(3000,.0002,{accuracy:100})],events:[{type:'route',recordedAt:500,data:{coordinates:[[0,0],[.01,0]],maneuvers:[]}}]};
    const r=Replay.run(recording);assert.equal(r.matched,2);assert.equal(r.rejected,1);assert.equal(r.wrongRoadRate,1);assert.equal(r.lateTurnRequestRate,null);
    assert.deepEqual(Replay.compare(r,r),{matched:0,uncertain:0,missingRoute:0,rejected:0,positionJumps:0,wrongRoadRate:0,lateTurnRequestRate:null});
    delete recording.samples[1].expectedProgressMeters;assert.equal(Replay.run(recording).wrongRoadRate,null);
});
test('replay uses explicit turn timing labels and ignores malformed route geometry',()=>{
    const r=Replay.run({version:2,samples:[{lat:0,lng:0,timestamp:1000,receivedAt:1000,accuracy:5}],events:[
        {type:'route',recordedAt:1,data:{coordinates:[[0,0],[999,0]]}},
        {type:'turn-ground-truth',recordedAt:2000,data:{utteranceId:'a',latestRequestAt:1500}},
        {type:'voice',recordedAt:1800,data:{utteranceId:'a',status:'requested'}}]});
    assert.equal(r.missingRoute,1);assert.equal(r.lateTurnRequestRate,1);
    assert.throws(()=>Replay.run({version:3,samples:[]}));
});
test('native replay uses background GPS separately and converts Android accuracy and speed',()=>{
    const data={version:2,samples:[],events:[{type:'route',recordedAt:500,data:{coordinates:[[0,0],[.01,0]],maneuvers:[]}},
        {type:'native-location',recordedAt:1000,data:{lat:0,lng:.001,timestamp:1000,accuracy68:3,speedMps:10,heading:90}}]};
    assert.equal(Replay.run(data).samples,0);assert.equal(Replay.run(data,'native').matched,1);
    assert.equal(Replay.samples(data,'native')[0].reportedSpeedKmh,36);
    assert.equal(Replay.samples(data,'native')[0].accuracy,4.86);
});
test('CLI compares identical recordings and refuses a changed input fingerprint',()=>{
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solarless-replay-')),before=path.join(dir,'before.json'),after=path.join(dir,'after.json'),changed=path.join(dir,'changed.json');
    try{
        const input='tests/fixtures/drive-evaluation-synthetic.json';
        execFileSync(process.execPath,['tools/replay-drive.cjs',input,before]);
        execFileSync(process.execPath,['tools/replay-drive.cjs',input,after,before]);
        const result=JSON.parse(fs.readFileSync(after));assert.equal(result.currentRouteReplay.matched,3);assert.equal(result.currentRouteReplay.wrongRoadRate,0);assert.equal(result.currentRouteReplay.lateTurnRequestRate,0);assert.equal(result.changeFromBaseline.matched,0);
        const data=JSON.parse(fs.readFileSync(input));data.samples.pop();fs.writeFileSync(changed,JSON.stringify(data));
        assert.throws(()=>execFileSync(process.execPath,['tools/replay-drive.cjs',changed,after,before],{stdio:'pipe'}),/identical recording/);
    }finally{for(const p of [before,after,changed])if(fs.existsSync(p))fs.unlinkSync(p);fs.rmdirSync(dir);}
});
test('scene status checks manifests only; selective repair verifies hash and preserves healthy cache on failure',async()=>{
    const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),fflate=require('fflate');
    const zip=fflate.zipSync({'tile.json':fflate.strToU8(JSON.stringify({schema:3,buildings:[],terrain:[],sceneCoverage:{buildingCoverage:true}})),'unused.json':fflate.strToU8('invalid')});
    const manifest={schema:3,releaseTag:'fixture',source:'OSM fixture',sourceMetadata:{osm:{extractTimestamp:'2020-01-01T00:00:00Z'}},grid:{latOrigin:0,lngOrigin:0,cosLat:1},tileSizeM:5000,baseUrl:'https://example.test',packs:{p:{path:'one.zip',bytes:zip.length,sha256:crypto.createHash('sha256').update(zip).digest('hex')}},tiles:{'0:0':{pack:'p',file:'tile.json'}}};
    const calls=[];let corrupt=false;
    const sandbox={console,Date,Math,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,crypto:crypto.webcrypto,fflate,fetch:async(url)=>{calls.push(url);return String(url).endsWith('.json')?{ok:true,json:async()=>manifest}:{ok:true,arrayBuffer:async()=>corrupt?new Uint8Array([1,2,3]).buffer:zip.buffer.slice(zip.byteOffset,zip.byteOffset+zip.byteLength)};}};
    sandbox.self=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync('js/scene-shadow.js','utf8'),sandbox);
    const scene=sandbox.SceneShadow,options={precomputedManifestUrl:'https://example.test/manifest.json',precomputedPackRetryCount:0};
    let rows=await scene.statusAt([.001,.001],options);assert.equal(rows[0].cacheState,'not-downloaded');assert.equal(calls.length,1);assert.ok(rows[0].ageDays>30);
    await scene.repairTile('custom','0:0',options);assert.equal(calls.filter(u=>u.endsWith('.zip')).length,1);
    rows=await scene.statusAt([.001,.001],options);assert.equal(rows[0].cacheState,'cached');assert.equal(scene.getCacheStats().precomputedEntries,1);
    corrupt=true;await assert.rejects(scene.repairTile('custom','0:0',options),/checksum/);
    assert.equal((await scene.statusAt([.001,.001],options))[0].cacheState,'cached');
    assert.equal((await scene.statusAt([1,1],options))[0].cacheState,'missing');
    await assert.rejects(scene.repairTile('custom','99:99',options),/TILE_NOT_PUBLISHED/);
});
