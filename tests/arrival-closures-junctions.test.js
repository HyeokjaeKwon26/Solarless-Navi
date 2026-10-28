const test = require('node:test');
const assert = require('node:assert/strict');
const Traffic = require('../js/public-traffic');
const Guidance = require('../js/navigation-guidance');
const RouteState = require('../js/route-state');
const now = Date.parse('2026-10-28T12:00:00Z');
const points = [[-71,42],[-70.999,42],[-70.998,42]];
const route = (coords=points,name='Main Street') => ({geometry:{coordinates:coords},duration:100,
    legs:[{steps:[{name,distance:170,duration:100,geometry:{coordinates:coords}}]}]});
function feed(properties={},geometry={type:'LineString',coordinates:points}) {
    return Traffic.parseMA({feed_info:{update_date:new Date(now).toISOString()},features:[{id:'closure',geometry,properties:{
        start_date:new Date(now-60000).toISOString(),end_date:new Date(now+60000).toISOString(),
        vehicle_impact:'all-lanes-closed',is_start_date_verified:true,is_end_date_verified:true,
        is_start_position_verified:true,is_end_position_verified:true,
        core_details:{road_names:['MAIN STREET - EB'],direction:'eastbound'},...properties}}]},now);
}
test('only fresh verified full closures on the named directed road block a candidate',()=>{
    const result=Traffic.evaluate(route(),[feed()],now);
    assert.equal(result.blocked,true); assert.equal(result.closures[0].id,'closure');
    assert.equal(result.duration,100); assert.equal(result.coverage,0);
    assert.match(Traffic.label(result,false),/Confirmed full closure/);
    for(const properties of [{vehicle_impact:'some-lanes-closed'},{is_start_date_verified:false},
        {is_end_date_verified:false},{is_start_position_verified:false},{is_end_position_verified:false},
        {core_details:{road_names:['Main Street'],direction:'unknown'}},
        {core_details:{road_names:['Main Street'],direction:'westbound'}}]) {
        assert.equal(Traffic.evaluate(route(),[feed(properties)],now).blocked,false);
    }
    assert.equal(Traffic.evaluate(route(),[feed()],now+11*60000).blocked,false);
    assert.equal(Traffic.evaluate(route(),[feed()],now+60000).blocked,false);
});
test('reverse, crossing, parallel, unnamed and differently named roads are not closed by proximity',()=>{
    for(const raw of [route([...points].reverse()),route(points,'Side Road'),route(points,''),
        route(points.map(([x,y])=>[x,y+.00015])),route([[-70.999,41.999],[-70.999,42.001]])]) {
        assert.equal(Traffic.evaluate(raw,[feed()],now).blocked,false);
    }
    const reversed=feed({}, {type:'LineString',coordinates:[...points].reverse()});
    assert.equal(Traffic.evaluate(route(),[reversed],now).blocked,false);
});
test('malformed closure geometry and future events cannot enter matching',()=>{
    for(const coordinates of [null,[],[[0,0]],[[NaN,42],[-71,42]],[[181,0],[0,0]]]) {
        assert.equal(feed({}, {type:'LineString',coordinates}).events.length,0);
    }
    assert.equal(feed({start_date:new Date(now+60000).toISOString()}).events.length,0);
});
test('lane arrows use only provider indications at the actual maneuver',()=>{
    const step={maneuver:{location:points[1]},intersections:[{location:points[1],lanes:[
        {valid:false,indications:['left']},{valid:true,indications:['straight','right','bad-data']}]}]};
    const lanes=RouteState.maneuverLaneGuidance(step);
    assert.deepEqual(lanes.indications,[['left'],['straight','right']]);
    assert.equal(Guidance.laneArrows(lanes.indications[1]),'↑→');
    assert.equal(Guidance.laneArrows(['bad-data']),'');
    step.intersections[0].location=points[0]; assert.equal(RouteState.maneuverLaneGuidance(step),null);
});
test('complex junctions prepare earlier without moving the immediate turn threshold',()=>{
    const plain=Guidance.thresholds(100),complex=Guidance.thresholds(100,{type:'off ramp'});
    assert.ok(complex.prepare>plain.prepare);assert.ok(complex.preview>plain.preview);
    assert.equal(complex.execute,plain.execute);
    assert.equal(Guidance.shortRoad({exits:'7A',ref:'I-95',name:'Long Road',destinations:'Many signs'},false),'Exit 7A · I-95');
});
