const test=require('node:test');
const assert=require('node:assert/strict');
const Catalog=require('../js/offline-catalog');
const Trip=require('../js/trip-tools');
const Compare=require('../js/route-comparison');
const Roads=require('../js/road-network');
const node=(id,lon,lat,tags={})=>({type:'node',id,lon,lat,tags});
const point=(name,lng)=>({name,coords:{lat:40,lng}});

test('offline numbered addresses require the house and street, not a token from the city or POI',()=>{
    const items=Catalog.build({elements:[
        node(1,-71,40,{'addr:housenumber':'94','addr:street':'Gerry Road','addr:city':'Brookline'}),
        node(2,-70,40,{'addr:housenumber':'94','addr:street':'Main Street','addr:city':'Gerry Road'}),
        node(3,-71,40,{'addr:housenumber':'194','addr:street':'Gerry Road'}),
        node(4,-71,40,{name:'94 Gerry Road Trail'}),
        node(5,-72,40,{'addr:housenumber':'94','addr:street':'Gerry Road'})]});
    assert.deepEqual(Catalog.search(items,'94 Gerry Rd.',{lat:40,lng:-71}).map(i=>i.id),['node/1','node/5']);
    assert.equal(Catalog.search(items,'94 Gerry Road Brookline').length,1);
    assert.equal(Catalog.search(items,'94 Main Rd.').length,0);
    assert.equal(Catalog.search(items,'Gerry').length,5);
});

test('offline catalog clips addresses, validates coordinates and indexes way centers',()=>{
    const items=Catalog.build({bounds:[39.99,-71.01,40.01,-70.99],elements:[
        node(1,-71,40),node(2,-70.999,40),node(3,-100,40,{name:'Outside'}),node(4,NaN,40,{name:'Invalid'}),
        {type:'way',id:10,nodes:[1,2],tags:{amenity:'parking',name:'Parking'}},
        {type:'way',id:11,center:{lat:40,lon:-71},tags:{amenity:'fuel',name:'Fuel'}}]});
    assert.deepEqual(items.map(i=>i.id),['way/10','way/11']);
    assert.equal(items[0].lng,(-71-70.999)/2);
});

test('along-route places exclude behind, beyond 10 km and outside the corridor',()=>{
    const route=[[-71,40],[-71,40.2]],items=Catalog.build({elements:[
        node(1,-71,40.001,{amenity:'fuel'}),node(2,-71,40.02,{amenity:'fuel'}),
        node(3,-71,40.15,{amenity:'fuel'}),node(4,-71.02,40.02,{amenity:'fuel'}),
        node(5,-71,40.03,{amenity:'parking'})]});
    assert.deepEqual(Catalog.along(items,route,'fuel',1000).map(i=>i.id),['node/2']);
    const samples=Trip.corridor(route,1000);
    assert.equal(samples.length,6);
    assert.ok(Math.abs(Roads.distance(route[0],samples[0])-1000)<1);
    assert.ok(Math.abs(Roads.distance(samples[0],samples.at(-1))-10000)<1);
});

test('manual stop queue preserves final destination and refuses duplicates, excess and expired plans',()=>{
    const final=point('Final',-71),a=point('A',-70.99),b=point('B',-70.98),c=point('C',-70.97),now=Date.now();
    const first=Trip.insert(final,a,null,now),second=Trip.insert(a,b,first,now),third=Trip.insert(b,c,second,now);
    assert.deepEqual(third.pending.map(p=>p.name),['B','A','Final']);
    assert.throws(()=>Trip.insert(c,point('D',-70.96),third,now),/LIMIT/);
    assert.throws(()=>Trip.insert(a,final,first,now),/DUPLICATE/);
    assert.equal(Trip.valid(first,now+12*3600000),false);
    assert.equal(Trip.valid({...first,current:point('Bad',Infinity)},now),false);
    assert.deepEqual(Trip.insert(a,b,{...first,savedAt:now-13*3600000},now).pending,[a]);
});

test('offline simpler preference changes selection cost without inflating drive ETA and honors bounds',()=>{
    const graph=Roads.build({version:1,savedAt:Date.now(),bounds:[39.999,-71.001,40.002,-70.997],elements:[
        node(1,-71,40),node(2,-70.999,40),node(3,-70.999,40.001),
        {type:'way',id:10,nodes:[1,2],tags:{highway:'service'}},
        {type:'way',id:20,nodes:[2,3],tags:{highway:'residential'}}]});
    const from=[-70.9998,40],to=[-70.999,40.0008];
    const normal=graph.route(from,to),simple=graph.route(from,to,{simpler:true});
    assert.equal(simple.duration,normal.duration);
    assert.ok(simple.selectionCost>simple.duration+8);
    assert.deepEqual(simple.geometry,normal.geometry);
    assert.throws(()=>graph.route([-71.002,40],to),/OUTSIDE/);
});

test('route comparison distinguishes separated geometry and refuses mismatched solar analyses',()=>{
    const a={id:'a',durationSec:600,distanceMeters:2000,analysisMode:'scene',weatherMode:'forecast',analyzed:{coordinates:[[-71,40],[-71,40.01]],sunlitTimeSeconds:400}};
    const b={...a,id:'b',durationSec:660,analyzed:{coordinates:[[-71.01,40],[-71.01,40.01]],sunlitTimeSeconds:300}};
    const c={...b,id:'c',analysisMode:'heuristic'};
    const rows=Compare.rows([a,b,c],a,()=>({uturns:1}));
    assert.equal(rows[0].shared,1);assert.equal(rows[1].shared,0);
    assert.equal(rows[1].solar.extraSeconds,60);assert.equal(rows[1].solar.sunlitSecondsSaved,100);
    assert.equal(rows[2].solar.comparable,false);assert.equal(rows[2].solar.sunlitSecondsSaved,null);
});

test('offline simpler routing can choose a slightly longer public road over a service shortcut',()=>{
    const graph=Roads.build({version:1,savedAt:Date.now(),elements:[
        node(1,-71.002,40),node(2,-71.001,40),node(3,-71,40.0002),node(4,-70.999,40),node(5,-70.998,40),
        {type:'way',id:10,nodes:[1,2],tags:{highway:'residential'}},
        {type:'way',id:20,nodes:[2,4],tags:{highway:'service'}},
        {type:'way',id:30,nodes:[2,3,4],tags:{highway:'residential'}},
        {type:'way',id:40,nodes:[4,5],tags:{highway:'residential'}}]});
    const start=[-71.0018,40],end=[-70.9982,40];
    const fast=graph.route(start,end),simple=graph.route(start,end,{simpler:true});
    assert.equal(fast.geometry.coordinates.length,4);assert.equal(simple.geometry.coordinates.length,5);
    assert.ok(simple.duration>fast.duration);
    assert.ok(Math.abs(simple.duration-simple.distance/(25/3.6))<.001);
});
