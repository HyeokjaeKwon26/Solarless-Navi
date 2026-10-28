const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cases = require('./fixtures/navigation-units.json');
function fresh(storage = new Map()) {
    const context = { localStorage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)} };
    vm.runInNewContext(fs.readFileSync('js/navigation-units.js','utf8'), context);
    return context.NavigationUnits;
}
test('navigation display and speech convert real distances at metric and imperial boundaries', () => {
    const units = fresh();
    for (const row of cases) {
        units.setPreference(row.system);
        assert.equal(units.distance(row.meters), row.display);
        assert.equal(units.distance(row.meters,{speech:true,language:'en-US'}),row.en);
        assert.equal(units.distance(row.meters,{speech:true,language:'ko-KR'}),row.ko);
    }
    units.setPreference('imperial');
    assert.equal(units.speed(43.2),27);
    assert.equal(units.speed(48.28032),30);
    units.setPreference('metric');
    assert.equal(units.speed(48.28032),48);
});
test('automatic units follow country while explicit preference survives country changes and restart', () => {
    const storage = new Map(), units=fresh(storage), changes=[];
    units.onChange(()=>changes.push([units.system(),units.speedUnit(),units.speed(43.2)]));
    units.setCountry('US'); units.setCountry('GB'); units.setCountry('KR');
    assert.deepEqual(changes,[['imperial','mph',27],['metric','km/h',43]]);
    units.setPreference('metric'); units.setCountry('US');
    assert.equal(units.system(),'metric');
    const restored=fresh(storage); restored.setCountry('GB');
    assert.equal(restored.system(),'metric');
    restored.setPreference('auto'); assert.equal(restored.system(),'imperial');
    restored.setCountry('CA'); assert.equal(restored.system(),'metric');
    restored.setPreference('bad'); assert.equal(restored.getPreference(),'auto');
});
test('native snapshot receives a changed unit even while an older request for the same route is pending', async()=>{
    const calls=[],pending=[],units=fresh();
    const window={NavigationUnits:units,Capacitor:{Plugins:{Pip:{setGuidanceRoute:({route})=>{calls.push(route);return new Promise(resolve=>pending.push(resolve));}}}},
        NavigationGuidance:{model:()=>({coordinates:[[0,0],[0,1]],maneuvers:[]})},TTSVoice:{getLanguage:()=> 'en-US',isMuted:()=>false}};
    vm.runInNewContext(fs.readFileSync('js/native-navigation.js','utf8'),{window,Date});
    const route={}; window.NativeNavigation.sync(route);
    units.setCountry('US'); window.NativeNavigation.sync(route);
    assert.deepEqual(calls.map(call=>call.unitSystem),['metric','imperial']);
    assert.ok(calls[1].revision>calls[0].revision);
    pending[1](); await new Promise(setImmediate); pending[0](); await new Promise(setImmediate);
    window.NativeNavigation.sync(route); assert.equal(calls.length,2);
});
