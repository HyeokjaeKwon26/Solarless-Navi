const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const guidance = require('../js/navigation-guidance.js');
const routeState = require('../js/route-state.js');
const route = (coordinates, maneuvers = []) => ({ analyzed: { coordinates }, maneuvers });
const fix = (lng, lat, extra = {}) => ({ lng, lat, heading: 90, accuracy: 5, speedKmh: 36, timestamp: 10000, ...extra });

test('road match treats north as a real heading and rejects travel against the route', () => {
    const r = route([[0, 0], [0, 0.01]]);
    assert.equal(guidance.match(r, fix(0, 0.001, { heading: 0 })).isSnapped, true);
    assert.equal(guidance.match(r, fix(0, 0.001, { heading: 180 })).isSnapped, false);
    assert.equal(guidance.match(r, fix(0, 0.001, { heading: null })).isSnapped, true);
});
test('history rejects an impossible jump even when the distant route section is nearby', () => {
    const r = route([[0, 0], [0.01, 0], [0.01, 0.001], [0, 0.001]]);
    const previous = guidance.match(r, fix(0.001, 0));
    assert.equal(previous.isSnapped, true);
    const next = guidance.match(r, fix(0.001, 0.001, { heading: 270, timestamp: 11000 }), previous);
    assert.equal(next.isSnapped, false);
    assert.equal(next.remainingMeters, Infinity);
});
test('parallel repeated route sections stay ambiguous without history', () => {
    const r = route([[0, 0], [0.01, 0], [0.01, 0.001], [0, 0.001], [0, 0.0001], [0.01, 0.0001]]);
    const raw = fix(0.005, 0.00005);
    assert.equal(guidance.match(r, raw).reason, 'ambiguous');
    const tracked = guidance.match(r, raw, { progressMeters: 550, timestamp: 9000 });
    assert.equal(tracked.isSnapped, true);
    assert.equal(tracked.segmentIndex, 0);
});
test('fresh history progresses normally and long GPS gaps allow reacquisition', () => {
    const r = route([[0, 0], [0.01, 0]]);
    const first = guidance.match(r, fix(0.001, 0));
    assert.ok(guidance.match(r, fix(0.0011, 0, { timestamp: 11000 }), first).progressMeters > first.progressMeters);
    assert.equal(guidance.match(r, fix(0.009, 0, { timestamp: 11000 }), first).isSnapped, false);
    assert.equal(guidance.match(r, fix(0.009, 0, { timestamp: 30000 }), first).isSnapped, true);
});
test('opposite travel needs sustained evidence; one bad heading or inaccurate fix cannot reroute', () => {
    const r = route([[0, 0], [0, 0.01]]);
    let evidence = {};
    for (let i = 0; i < 3; i++) {
        const snap = guidance.match(r, fix(0, 0.005 - i * 0.0001, { heading: 180, timestamp: 10000 + i * 1000 }));
        assert.equal(snap.reason, 'opposite-direction');
        evidence = routeState.evaluateOffRoute(evidence, { timestamp: 10000 + i * 1000,
            distanceMeters: 0, accuracy: 5, oppositeDirection: snap.reason === 'opposite-direction' });
        assert.equal(evidence.shouldReroute, i === 2);
    }
    const reset = routeState.evaluateOffRoute(evidence, { timestamp: 13000, distanceMeters: 0, accuracy: 5, oppositeDirection: false });
    assert.equal(reset.confirmed, false);
    const inaccurate = routeState.evaluateOffRoute(evidence, { timestamp: 13000, distanceMeters: 0, accuracy: 30, oppositeDirection: true });
    assert.equal(inaccurate.confirmed, false);
});
test('hairpin turn distance follows the road instead of its geographic chord', () => {
    const r = route([[0, 0], [0.005, 0], [0.005, 0.001], [0, 0.001]], [
        { type: 'turn', modifier: 'right', location: [0, 0.001] }
    ]);
    const next = guidance.next(r, guidance.match(r, fix(0.001, 0)));
    assert.ok(next.distanceFromCar > 1000 && next.distanceFromCar < 1200);
    assert.equal(guidance.next(r, { isSnapped: false }), null);
});
test('repeat visits to one junction retain maneuver order and chain distance', () => {
    const r = route([[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0], [0.001, 0]], [
        { type: 'turn', location: [0.001, 0], cumulativeDistance: 100 },
        { type: 'turn', location: [0, 0], cumulativeDistance: 400 },
        { type: 'turn', location: [0.001, 0], cumulativeDistance: 500 }
    ]);
    r.distanceMeters = 500;
    const m = guidance.model(r).maneuvers;
    assert.ok(m[2].progressMeters - m[0].progressMeters > 400);
    const next = guidance.next(r, { isSnapped: true, progressMeters: m[1].progressMeters - 10 });
    assert.equal(next.sequence, 1);
    assert.ok(next.following.distanceAfter > 100 && next.following.distanceAfter < 120);
    assert.equal(guidance.model(r), guidance.model(r));
});
test('session restore rejects future, expired, coerced and out-of-range coordinates', () => {
    const saved = { end: { lat: 42, lng: -71 }, savedAt: 1000 };
    assert.equal(guidance.validSession(saved, 1500, 1000), true);
    for (const invalid of [{ ...saved, savedAt: 1600 }, { ...saved, savedAt: 0 },
        { ...saved, end: { lat: 91, lng: 0 } }, { ...saved, end: { lat: null, lng: -71 } }]) {
        assert.equal(guidance.validSession(invalid, 1500, 1000), false);
    }
});
test('automatic saver uses thermal state and battery hysteresis without treating missing data as zero', () => {
    assert.equal(guidance.shouldConserve({}), false);
    assert.equal(guidance.shouldConserve({ batteryPercent: null }), false);
    assert.equal(guidance.shouldConserve({ thermalStatus: 2 }), true);
    assert.equal(guidance.shouldConserve({ powerSaveMode: true }), true);
    assert.equal(guidance.shouldConserve({ batteryPercent: 14, charging: false }), true);
    assert.equal(guidance.shouldConserve({ batteryPercent: 14, charging: true }), false);
    assert.equal(guidance.shouldConserve({ batteryPercent: 14, charging: false, externalPowerConnected: true }), false);
    assert.equal(guidance.shouldConserve({ batteryPercent: 14, externalPowerConnected: true, thermalStatus: 2 }), true);
    assert.equal(guidance.shouldConserve({ batteryPercent: 18 }, true), true);
    assert.equal(guidance.shouldConserve({ batteryPercent: 18 }, false), false);
    assert.equal(guidance.shouldConserve({ batteryPercent: 21 }, true), false);
});
function voice(native = null) {
    let now = 100000;
    const spoken = [];
    const context = { navigator: { language: 'en-US' }, console, NavigationGuidance: guidance,
        Date: { now: () => now }, SpeechSynthesisUtterance: function (text) { this.text = text; },
        speechSynthesis: { cancel() {}, resume() {}, getVoices: () => [], speak: u => spoken.push(u.text) } };
    context.window = context;
    if (native) context.Capacitor = { Plugins: { TextToSpeech: native } };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(require.resolve('../js/navigation-units.js'), 'utf8'), context);
    vm.runInContext(fs.readFileSync(require.resolve('../js/tts-voice.js'), 'utf8'), context);
    return { api: context.TTSVoice, units: context.NavigationUnits, spoken, advance: ms => { now += ms; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const turn = { sequence: 1, type: 'turn', modifier: 'right', location: [1, 2], name: 'Main', exits: '7' };

test('cancel during a bilingual native segment prevents the remaining Korean instruction', async () => {
    const calls=[];let completeEnglish;
    const v=voice({stop:async()=>{},speak:args=>{
        calls.push(args);
        return args.lang==='en-US' ? new Promise(resolve=>{completeEnglish=resolve;}) : Promise.resolve();
    }});
    v.api.setLanguage('ko-KR');
    const task=v.api.preview();await flush();
    assert.deepEqual(calls.map(call=>call.lang),['ko-KR','en-US']);
    v.api.handleInterruptionStart();completeEnglish();await task;
    assert.equal(calls.length,2);
});
test('partly spoken native instruction is not duplicated through browser fallback', async () => {
    const v=voice({stop:async()=>{},speak:args=>args.lang==='en-US'?Promise.reject(new Error('missing voice')):Promise.resolve()});
    v.api.setLanguage('ko-KR');await v.api.preview();
    assert.deepEqual(v.spoken,[]);
});

test('turn speech respects selected units and glare speech does not invent distance or direction', async () => {
    const v = voice();
    v.units.setCountry('US');
    v.api.announceTurnManeuver(turn, 295, 60); await flush();
    assert.match(v.spoken.at(-1), /0.2 miles/);
    v.api.setLanguage('ko-KR'); v.advance(7000);
    v.api.announceTurnManeuver({...turn,sequence:2},295,60); await flush();
    assert.match(v.spoken.join(''), /0.2마일/);
    v.api.setLanguage('en-US'); v.advance(7000);
    v.api.announceTurnManeuver({...turn,sequence:3,following:{type:'turn',modifier:'left',distanceAfter:90}},40,40); await flush();
    assert.match(v.spoken.at(-1), /Then in 300 feet/);
    v.advance(7000); v.api.announceNavHazard(100,90,0.8,'New Road'); await flush();
    assert.match(v.spoken.at(-1), /predicted on this section/);
    assert.doesNotMatch(v.spoken.at(-1), /feet|meters|west|avoidance/);
    v.units.setPreference('metric'); v.advance(7000);
    v.api.announceTurnManeuver({...turn,sequence:4},295,60); await flush();
    assert.match(v.spoken.at(-1), /300 meters/);
});

test('highway turn preview starts earlier than city guidance', async () => {
    const v = voice();
    v.api.announceTurnManeuver(turn, 650, 30);
    await flush();
    assert.equal(v.spoken.length, 0);
    v.api.announceTurnManeuver(turn, 650, 110);
    await flush();
    assert.equal(v.spoken.length, 1);
    assert.match(v.spoken[0], /Exit 7/);
    assert.ok(guidance.thresholds(200).execute <= 60);
});
test('speed or distance oscillation cannot replay a completed turn phase', async () => {
    const v = voice();
    for (const distance of [120, 270, 110, 10, 100]) {
        v.api.announceTurnManeuver(turn, distance, 60);
        await flush(); v.advance(3000);
    }
    assert.equal(v.spoken.length, 2);
});
test('critical turn suppresses a same-tick glare utterance and describes the following turn', async () => {
    const v = voice();
    v.api.announceTurnManeuver({ ...turn, following: { type: 'turn', modifier: 'left', distanceAfter: 90 } }, 40, 40);
    v.api.speak('Glare warning', true);
    await flush();
    assert.equal(v.spoken.length, 1);
    assert.match(v.spoken[0], /Then in 90 meters/);
    v.advance(6100); await v.api.speak('Glare warning', true);
    assert.equal(v.spoken.length, 2);
});
test('interruption does not consume a turn phase, and recovery can repeat interrupted guidance', async () => {
    const v = voice();
    v.api.handleInterruptionStart();
    v.api.announceTurnManeuver(turn, 30, 40);
    v.api.handleInterruptionEnd();
    v.api.announceTurnManeuver(turn, 30, 40);
    await flush();
    assert.equal(v.spoken.length, 1);
    v.api.handleInterruptionStart(); v.api.handleInterruptionEnd();
    v.api.announceTurnManeuver(turn, 30, 40); await flush();
    assert.equal(v.spoken.length, 2);
});
test('delayed native failures cannot revive cancelled speech through web fallback', async () => {
    let rejectOld;
    const calls = [];
    const v = voice({ stop: async () => {}, speak: args => {
        calls.push(args.text);
        return args.text === 'old' ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve();
    } });
    const old = v.api.speak('old'); await flush();
    await v.api.speak('new'); rejectOld(new Error('cancelled')); await old;
    assert.deepEqual(calls, ['old', 'new']);
    assert.deepEqual(v.spoken, []);
});
test('serialized native stops launch only the latest queued utterance', async () => {
    let resolveStop;
    const calls = [];
    let first = true;
    const v = voice({ stop: () => first ? (first = false, new Promise(resolve => { resolveStop = resolve; })) : Promise.resolve(),
        speak: async args => calls.push(args.text) });
    const a = v.api.speak('old'); await flush();
    const b = v.api.speak('new'); resolveStop(); await Promise.all([a, b]);
    assert.deepEqual(calls, ['new']);
});
