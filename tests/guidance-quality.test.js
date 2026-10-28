const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const guidance = require('../js/navigation-guidance');
const plain = value => JSON.parse(JSON.stringify(value));

test('road pronunciation expands suffixes without rewriting Saint or Doctor prefixes', () => {
    assert.equal(guidance.spokenRoad('Lee St.'), 'Lee Street');
    assert.equal(guidance.spokenRoad('St. Louis Ave.'), 'St. Louis Avenue');
    assert.equal(guidance.spokenRoad('Dr. Martin Luther King Jr. Blvd.'), 'Dr. Martin Luther King Jr. Boulevard');
    assert.equal(guidance.spokenRoad('I-95 / US-1'), 'Interstate 95 / U S Route 1');
});
test('only named road fragments switch to English; Korean distance and exit stay Korean', () => {
    const plan = guidance.speechSegments('300미터 앞에서 Lee St. · 7번 출구 방면 우회전입니다.', 'ko-KR', ['Lee St.']);
    assert.deepEqual(plan, [{text:'300미터 앞에서 ',lang:'ko-KR'}, {text:'Lee Street',lang:'en-US'}, {text:' · 7번 출구 방면 우회전입니다.',lang:'ko-KR'}]);
    assert.deepEqual(guidance.speechSegments('Turn onto Lee St.', 'en-US', ['Lee St.']), [{text:'Turn onto Lee Street',lang:'en-US'}]);
});
test('native background snapshots carry mixed languages and a following turn', async () => {
    let payload;
    const root = { Date, NavigationGuidance: guidance, NavigationUnits:{system:()=> 'imperial'},
        TTSVoice:{getLanguage:()=> 'ko-KR',isMuted:()=>false,getManeuverText:()=> '우회전'},
        Capacitor:{Plugins:{Pip:{setGuidanceRoute:async value => {payload=value;}}}} };
    root.window=root; vm.createContext(root); vm.runInContext(fs.readFileSync('js/native-navigation.js','utf8'),root);
    root.NativeNavigation.sync({distanceMeters:220,analyzed:{coordinates:[[0,0],[0.001,0],[0.002,0]]},maneuvers:[
        {type:'turn',name:'Lee St.',location:[0.001,0],cumulativeDistance:110},
        {type:'turn',name:'Harvard Ave.',location:[0.002,0],cumulativeDistance:220}]});
    assert.ok(payload.route.turns[0].following.distanceAfter < 180);
    assert.ok(payload.route.turns[0].segments.some(part => part.lang==='en-US' && part.text==='Lee Street'));
    assert.equal(payload.route.unitSystem,'imperial');
});
function router() {
    const context={console,Date,Math,setTimeout,clearTimeout};context.window=context;
    vm.createContext(context);vm.runInContext(fs.readFileSync('js/shadow-router.js','utf8'),context);
    return context.ShadowRouter;
}
const candidate = (duration, distance, modifier = 'straight') => ({duration,distance,legs:[{steps:[{name:'Main Street',distance:distance,maneuver:{modifier}}]}]});
test('dominated U-turn alternative is removed but the only U-turn route is retained', () => {
    const api=router(), direct=candidate(100,1000), uturn=candidate(130,1200,'uturn');
    assert.deepEqual(plain(api.filterDrivingCandidates([uturn,direct])),[direct]);
    assert.deepEqual(plain(api.filterDrivingCandidates([uturn])),[uturn]);
});
test('faster or shorter U-turn alternative remains a real tradeoff, with a visible quality signal', () => {
    const api=router(), direct=candidate(100,1000), faster=candidate(90,1200,'uturn'), shorter=candidate(130,800,'uturn');
    assert.equal(api.filterDrivingCandidates([direct,faster,shorter]).length,3);
    assert.equal(api.routeDrivingQuality(shorter).uturns,1);
});
test('live traffic duration takes precedence when filtering awkward alternatives', () => {
    const api=router(), direct={...candidate(100,1000),traffic:{duration:200}}, uturn=candidate(150,1200,'uturn');
    assert.equal(api.filterDrivingCandidates([direct,uturn]).length,2);
});
test('short interior unnamed detour is filtered only if a simpler route dominates it', () => {
    const api=router(), direct=candidate(100,1000), awkward=candidate(130,1200);
    awkward.legs[0].steps=[{name:'Main',distance:500},{name:'',distance:30},{name:'Main',distance:670},{maneuver:{type:'arrive'},distance:0}];
    assert.equal(api.routeDrivingQuality(awkward).shortAccess,1);
    assert.equal(api.filterDrivingCandidates([awkward,direct]).length,1);
    assert.equal(api.filterDrivingCandidates([awkward]).length,1);
});
