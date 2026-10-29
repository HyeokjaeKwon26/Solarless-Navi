const test=require('node:test'),assert=require('node:assert/strict');
const {policy,routeData}=require('../js/driving-view');
test('pitched camera uses reliable approaching turns and chained points only',()=>{
    const base={reliable:true,autoZoom:true,speed:40,maneuver:{type:'turn',distanceFromCar:120,location:[-71,42],following:{distanceAfter:90,location:[-71.001,42]}}};
    assert.deepEqual(policy(base),{close:true,pitch:32,zoom:17.8,points:[[-71,42],[-71.001,42]]});
    for(const changed of [{reliable:false},{autoZoom:false},{maneuver:{...base.maneuver,distanceFromCar:-1}},{maneuver:{...base.maneuver,type:'arrive'}},{maneuver:null}]){
        const p=policy({...base,...changed});assert.equal(p.close,false);assert.equal(p.pitch,50);assert.deepEqual(p.points,[]);
    }
    assert.equal(policy({...base,speed:100,maneuver:{...base.maneuver,distanceFromCar:300}}).zoom,16.7);
    assert.equal(policy({...base,maneuver:{...base.maneuver,following:{distanceAfter:181,location:[-71,42]}}}).points.length,1);
});
test('driving geometry preserves geographic coordinates, current progress and uncertainty colors',()=>{
    const s=(a,b,color='blue',dash=false)=>({p1:a,p2:b,color,dash});
    const segments=[s([42,-71],[42.1,-71]),s([42.1,-71],[42.2,-71]),s([42.2,-71],[42.3,-71],'yellow',true),s([42.3,-71],[42.4,-71],'yellow',true)];
    const args=[s=>s.color,s=>s.dash];
    const data=routeData(segments,1,[-71,42.15],...args);
    assert.equal(data.features.length,2);assert.deepEqual(data.features[0].geometry.coordinates,[[-71,42.15],[-71,42.2]]);
    assert.deepEqual(data.features[1].geometry.coordinates,[[-71,42.2],[-71,42.3],[-71,42.4]]);assert.equal(data.features[1].properties.uncertain,true);
    assert.equal(routeData([{p1:[NaN,0],p2:[1,1]}],0,null,...args).features.length,0);
    assert.equal(routeData(segments,4,null,...args).features.length,0);
});


test('chunked route retains every segment, color and uncertainty across boundaries',()=>{
    const {routeChunks,CHUNK_SIZE}=require('../js/driving-view');
    const segments=Array.from({length:5000},(_,i)=>({p1:[42+i*.00001,-71],p2:[42+(i+1)*.00001,-71],shade:i%3}));
    const color=s=>['red','blue','green'][s.shade],uncertain=s=>s.shade===2;
    const full=routeChunks(segments,color,uncertain);
    for(const index of [0,63,64,65,4999]){
        const chunk=Math.floor(index/CHUNK_SIZE);
        const current=routeData(segments,index,[-71,segments[index].p1[0]+.000005],color,uncertain,(chunk+1)*CHUNK_SIZE);
        const rest=full.features.filter(f=>f.properties.chunk>chunk);
        const flatten=features=>features.flatMap(f=>f.geometry.coordinates.slice(1).map(p=>({p,color:f.properties.color,uncertain:f.properties.uncertain})));
        assert.deepEqual(flatten([...current.features,...rest]),flatten(routeData(segments,index,[-71,segments[index].p1[0]+.000005],color,uncertain).features));
        assert.ok(current.features.length<=CHUNK_SIZE);
    }
});
