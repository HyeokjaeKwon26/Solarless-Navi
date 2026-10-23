const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Journey = require('../js/journey-policy');
const Traffic = require('../js/public-traffic');
const Roads = require('../js/road-network');
const now = Date.parse('2026-10-23T17:58:00Z');
const node = (id,lon,lat=40,tags) => ({type:'node',id,lon,lat,tags});
const way = (id,nodes,tags={}) => ({type:'way',id,nodes,tags:{highway:'residential',...tags}});
const pack = elements => ({version:1,savedAt:now,elements});
const restriction = (kind,from,to,via) => ({type:'relation',id:1000,tags:{type:'restriction',restriction:kind},members:[{type:'way',role:'from',ref:from},{type:'way',role:'to',ref:to},{type:'node',role:'via',ref:via}]});
function encode(points) {
    let lat=0,lng=0,text='';
    function add(value){let v=value<0?~(value<<1):value<<1;while(v>=32){text+=String.fromCharCode((32|(v&31))+63);v>>=5;}text+=String.fromCharCode(v+63);}
    for(const p of points){const y=Math.round(p[1]*1e5),x=Math.round(p[0]*1e5);add(y-lat);add(x-lng);lat=y;lng=x;}return text;
}
const points=[[-73.99,40.75],[-73.989,40.75],[-73.988,40.75]];
const row=(extra={})=>({link_id:'sensor',data_as_of:'2026-10-23T13:57:06.000',travel_time:'60',encoded_poly_line:encode(points),...extra});
test('NYC times use America/New_York and reject ambiguous DST timestamps',()=>{
    assert.equal(Traffic.nyTime('2026-10-23T13:57:06.000'),Date.parse('2026-10-23T17:57:06Z'));
    assert.equal(Traffic.nyTime('2026-01-23T13:57:06.000'),Date.parse('2026-01-23T18:57:06Z'));
    assert.ok(Number.isNaN(Traffic.nyTime('2026-11-01T01:30:00.000')));
    assert.ok(Number.isNaN(Traffic.nyTime('2026-03-08T02:30:00.000')));
});
test('stale, future, missing and zero-time sensors cannot affect ETA',()=>{
    assert.equal(Traffic.parseNYC([row()],now).links.length,1);
    assert.equal(Traffic.parseNYC([row()],now+11*60000).links.length,0);
    assert.equal(Traffic.parseNYC([row()],now-120000).links.length,0);
    assert.equal(Traffic.parseNYC([row({travel_time:'0'})],now).links.length,0);
    assert.equal(Traffic.parseNYC([row({encoded_poly_line:'invalid'})],now).links.length,0);
});
test('traffic matches complete directed links, corrects timing and expires',()=>{
    const raw={geometry:{coordinates:points},duration:30};const feed=Traffic.parseNYC([row()],now);
    const applied=Traffic.evaluate(raw,[feed],now);assert.equal(applied.duration,60);assert.ok(applied.coverage>.99);
    assert.equal(Traffic.evaluate({...raw,geometry:{coordinates:[...points].reverse()}},[feed],now).coverage,0);
    assert.equal(Traffic.evaluate({...raw,geometry:{coordinates:points.map(p=>[p[0],p[1]+.001])}},[feed],now).coverage,0);
    assert.equal(Traffic.evaluate(raw,[feed],now+11*60000).duration,30);
});
test('partial sensor links preserve unmatched road timing and deduplicate overlap',()=>{
    const length=Traffic.distance(points[0],points[2]);
    const raw={geometry:{coordinates:[...points,[-73.987,40.75]]},duration:100,legs:[{steps:[{distance:length,duration:20},{distance:length/2,duration:80}]}]};
    const feed=Traffic.parseNYC([row()],now);feed.links.push({...feed.links[0],id:'duplicate'});
    const result=Traffic.evaluate(raw,[feed],now);assert.ok(Math.abs(result.duration-140)<.01);assert.ok(result.coverage>.66&&result.coverage<.67);
    assert.ok(Math.abs(result.steps[0].duration-60)<.01);assert.ok(Math.abs(result.steps[1].duration-80)<.01);
});
test('MassDOT only reports active events in a fresh feed and never fabricates speed',()=>{
    const event={id:'work',geometry:{type:'LineString',coordinates:points},properties:{start_date:new Date(now-60000).toISOString(),end_date:new Date(now+60000).toISOString(),vehicle_impact:'all-lanes-closed',core_details:{road_names:['Test road']}}};
    const data={feed_info:{update_date:new Date(now).toISOString()},features:[event]};
    const feed=Traffic.parseMA(data,now);assert.equal(feed.events.length,1);
    const result=Traffic.evaluate({geometry:{coordinates:points},duration:100},[feed],now);assert.equal(result.duration,100);assert.equal(result.coverage,0);assert.equal(result.warnings.length,1);
    assert.equal(Traffic.parseMA(data,now+11*60000).events.length,0);
    assert.equal(Traffic.parseMA(data,now-120000).events.length,0);
});
test('junction camera accounts for speed and chained turns; refresh avoids a near turn',()=>{
    assert.equal(Journey.camera({type:'turn',distanceFromCar:250},20).close,false);
    assert.equal(Journey.camera({type:'turn',distanceFromCar:250,following:{distanceAfter:100}},100).chained,true);
    const state={live:true,realtime:true,visible:true,snapped:true,busy:false,now,fixAt:now,lastAt:now-300000,remainingMeters:1000};
    assert.equal(Journey.shouldRefresh(state),true);
    for(const override of [{next:{distanceFromCar:400}},{fixAt:now-11000},{busy:true},{snapped:false},{visible:false},{live:false},{lastAt:now-299999}])assert.equal(Journey.shouldRefresh({...state,...override}),false);
});
test('remaining solar geometry and road durations start at the accepted fix',()=>{
    const route={distanceMeters:200,durationSec:60,analyzed:{coordinates:points},routeSteps:[{distance:100,duration:20},{distance:100,duration:40}]};
    const remaining=Journey.remaining(route,{isSnapped:true,lng:points[1][0],lat:points[1][1],segmentIndex:1,progressMeters:100,remainingMeters:100});
    assert.deepEqual(remaining.coordinates,[points[1],points[2]]);assert.equal(remaining.duration,40);
    assert.equal(Journey.remaining(route,{isSnapped:false}),null);
});
test('offline graph clips endpoints to actual directed roads and emits turns',()=>{
    const graph=Roads.build(pack([node(1,-71),node(2,-70.999),node(3,-70.999,40.001),way(10,[1,2]),way(20,[2,3])]),now);
    const route=graph.route([-70.9998,40],[-70.999,40.0008],{heading:90});
    assert.ok(route.offline);assert.deepEqual(route.geometry.coordinates[0],[-70.9998,40]);assert.deepEqual(route.geometry.coordinates.at(-1),[-70.999,40.0008]);
    assert.equal(route.legs[0].steps[1].maneuver.modifier,'left');assert.equal(route.legs[0].steps.at(-1).maneuver.type,'arrive');assert.ok(route.distance>150&&route.distance<165);
});
test('oneway, reverse oneway and implicit motorway direction are honored',()=>{
    for(const tags of [{oneway:'yes'},{highway:'motorway'}]){
        const graph=Roads.build(pack([node(1,-71),node(2,-70.999),way(10,[1,2],tags)]),now);
        assert.ok(graph.route([-70.9998,40],[-70.9992,40]));assert.throws(()=>graph.route([-70.9992,40],[-70.9998,40]));
    }
    const graph=Roads.build(pack([node(1,-71),node(2,-70.999),way(10,[1,2],{oneway:'-1'})]),now);
    assert.ok(graph.route([-70.9992,40],[-70.9998,40]));assert.throws(()=>graph.route([-70.9998,40],[-70.9992,40]));
});
test('crossing roads at different levels do not connect without a shared node',()=>{
    const graph=Roads.build(pack([node(1,-71),node(2,-70.998),node(3,-70.999,39.999),node(4,-70.999,40.001),way(10,[1,2]),way(20,[3,4],{bridge:'yes',layer:'1'})]),now);
    assert.throws(()=>graph.route([-70.9998,40],[-70.999,40.0008]));
});
test('no-turn and only-turn restrictions prevent the prohibited connection',()=>{
    const elements=[node(1,-71),node(2,-70.999),node(3,-70.999,40.001),node(4,-70.998),way(10,[1,2]),way(20,[2,3]),way(30,[2,4])];
    for(const rule of [restriction('no_left_turn',10,20,2),restriction('only_straight_on',10,30,2)]){
        const graph=Roads.build(pack([...elements,rule]),now);assert.throws(()=>graph.route([-70.9998,40],[-70.999,40.0008],{heading:90}));assert.ok(graph.route([-70.9998,40],[-70.9982,40],{heading:90}));
    }
});
test('private, conditional, barrier and toll roads cannot be used against constraints',()=>{
    const base=[node(1,-71),node(2,-70.999),node(3,-70.998),way(10,[1,2])];
    for(const tags of [{access:'private'},{'access:conditional':'no @ (Mo-Fr)'},{motorcar:'no'}]){
        const graph=Roads.build(pack([...base,way(20,[2,3],tags)]),now);assert.throws(()=>graph.route([-70.9998,40],[-70.9982,40]));
    }
    const toll=Roads.build(pack([...base,way(20,[2,3],{toll:'yes'})]),now);assert.throws(()=>toll.route([-70.9998,40],[-70.9982,40],{tollFree:true}));
    const barrier=Roads.build(pack([...base,node(3,-70.998,40,{barrier:'gate'}),way(20,[2,3])]),now);assert.throws(()=>barrier.route([-70.9998,40],[-70.9982,40]));
});
test('unsupported via-way restrictions exclude affected roads; expired packs fail',()=>{
    const elements=[node(1,-71),node(2,-70.999),way(10,[1,2])];
    assert.throws(()=>Roads.build(pack(elements),now+8*86400000),/EXPIRED/);
    const r=restriction('no_left_turn',10,10,10);r.members[2].type='way';assert.throws(()=>Roads.build(pack([...elements,r]),now),/EMPTY/);
});
test('parallel-road ambiguity refuses offline start and competing road suspends route snap',()=>{
    const graph=Roads.build(pack([node(1,-71),node(2,-70.998),node(3,-71,40.00015),node(4,-70.998,40.00015),way(10,[1,2]),way(20,[3,4])]),now);
    assert.throws(()=>graph.route([-70.9995,40.000075],[-70.9982,40],{heading:90}),/AMBIGUOUS/);
    assert.equal(graph.conflictingRoad([-70.9995,40],90,30),true);
    assert.equal(graph.conflictingRoad([-70.9995,40.000075],90,30),false);
});
test('native route generations prevent a late result from suppressing resync after clear',async()=>{
    const calls=[],pending=[];const window={Capacitor:{Plugins:{Pip:{setGuidanceRoute:r=>{calls.push(r.route.revision);return new Promise(resolve=>pending.push(resolve));},clearGuidanceRoute:r=>{calls.push(r.revision);return Promise.resolve();}}}},NavigationGuidance:{model:()=>({coordinates:points,maneuvers:[]})},TTSVoice:{getLanguage:()=> 'en-US',isMuted:()=>false}};
    vm.runInNewContext(fs.readFileSync('js/native-navigation.js','utf8'),{window,Date});const route={};
    window.NativeNavigation.sync(route);window.NativeNavigation.clear();window.NativeNavigation.sync(route);pending[0]();await Promise.resolve();await Promise.resolve();
    assert.ok(calls[0]<calls[1]&&calls[1]<calls[2]);assert.equal(calls.length,3);pending[1]();
});
