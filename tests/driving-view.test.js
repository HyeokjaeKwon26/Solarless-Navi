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
