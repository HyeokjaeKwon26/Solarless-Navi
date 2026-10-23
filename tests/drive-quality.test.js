const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateNavigationFix, evaluateOffRoute, canConfirmArrival, maneuverLaneGuidance } = require('../js/route-state.js');
const { replay, createRecorder } = require('../js/drive-quality.js');
test('replay CLI consumes a saved synthetic recording without network', () => {
    const { execFileSync } = require('node:child_process');
    const path = require('node:path');
    const output = execFileSync(process.execPath, ['tools/replay-drive.cjs', 'tests/fixtures/drive-synthetic.json'], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8'
    });
    const report = JSON.parse(output);
    assert.equal(report.accepted, 6);
    assert.equal(report.rerouteRequests, 1);
    assert.equal(report.rejected.LOW_ACCURACY, 1);
    assert.equal(report.rejected.STALE_FIX, 1);
});

const sample = (timestamp, extra = {}) => ({ lat: 42, lng: -71, timestamp, receivedAt: timestamp,
    accuracy: 5, reportedSpeedKmh: 40, distanceMeters: 90, online: true, ...extra });
test('native 4 Hz fixes cannot trigger an immediate reroute; confirmed deviation can', () => {
    let state = {};
    for (let time = 1000; time < 3000; time += 250) {
        state = evaluateOffRoute(state, sample(time));
        assert.equal(state.shouldReroute, false);
    }
    state = evaluateOffRoute(state, sample(3000));
    assert.equal(state.shouldReroute, true);
    assert.equal(evaluateOffRoute(state, sample(4000)).shouldReroute, false);
});
test('accuracy overlap and interrupted evidence suppress false reroutes', () => {
    let state = {};
    for (let time = 1000; time <= 10000; time += 1000) {
        state = evaluateOffRoute(state, sample(time, { distanceMeters: 70, accuracy: 40 }));
        assert.equal(state.shouldReroute, false);
    }
    state = evaluateOffRoute({}, sample(1000));
    state = evaluateOffRoute(state, sample(2000));
    state = evaluateOffRoute(state, sample(9000));
    assert.equal(state.confirmed, false);
    state = evaluateOffRoute({}, sample(20000, { distanceMeters: 0 }));
    for (const time of [20250, 20500, 20750]) {
        state = evaluateOffRoute(state, sample(time));
        assert.equal(state.shouldReroute, false, 'elapsed evidence must start at the first off-route sample');
    }
});
test('offline deviation retains evidence, reconnect triggers once, on-route fix clears it', () => {
    let state = {};
    for (const time of [1000, 2000, 3000]) state = evaluateOffRoute(state, sample(time, { online: false }));
    assert.equal(state.confirmed, true);
    assert.equal(state.shouldReroute, false);
    state = evaluateOffRoute(state, sample(4000));
    assert.equal(state.shouldReroute, true);
    state = evaluateOffRoute(state, sample(5000, { distanceMeters: 10 }));
    assert.equal(state.confirmed, false);
});
test('recorded GPS sequence reports rejects, gaps and labelled false reroutes without network', () => {
    const records = [sample(1000), sample(2000, { accuracy: 150 }), sample(3000),
        sample(4000), sample(5000, { expectedOffRoute: true }),
        sample(6000, { receivedAt: 30000 })];
    const result = replay(records, () => 0);
    assert.equal(result.accepted, 4);
    assert.deepEqual(result.rejected, { LOW_ACCURACY: 1, STALE_FIX: 1 });
    assert.equal(result.rerouteRequests, 1);
    assert.equal(result.falseRerouteRate, 0);
    assert.equal(result.maxAcceptedGapMs, 2000);
    assert.equal(replay([sample(1000), sample(2000), sample(3000)], () => 0).falseRerouteRate, null);
});
test('recording is opt-in, bounded and exported without mutable references', () => {
    const recorder = createRecorder(2);
    recorder.add(sample(1));
    assert.equal(recorder.export().samples.length, 0);
    recorder.start();
    for (const time of [1, 2, 3]) recorder.add(sample(time));
    recorder.stop();
    recorder.add(sample(4));
    const output = recorder.export();
    assert.equal(output.dropped, 1);
    assert.equal(output.samples.length, 2);
    output.samples[0].lat = 0;
    assert.equal(recorder.export().samples[0].lat, 42);
});
test('stale, future and impossible fixes cannot advance guidance', () => {
    assert.equal(evaluateNavigationFix(null, sample(1), () => 0, { nowMs: 20000 }).accepted, false);
    assert.equal(evaluateNavigationFix(null, sample(30000), () => 0, { nowMs: 20000 }).accepted, false);
    assert.equal(evaluateNavigationFix(null, sample(1, { lat: 91 }), () => 0).accepted, false);
});
test('arrival requires route end, reliable GPS and low speed together', () => {
    assert.equal(canConfirmArrival(20, 500, 5, 10), false);
    assert.equal(canConfirmArrival(20, 30, 45, 10), false);
    assert.equal(canConfirmArrival(20, 30, 5, 60), false);
    assert.equal(canConfirmArrival(20, 30, 5, 10), true);
});
test('lane guidance is tied to the maneuver intersection and uses explicit validity', () => {
    const step = { maneuver: { location: [-71, 42] }, intersections: [{ location: [-71, 42],
        lanes: [{ valid: false }, { valid: true }, { valid: true }] }] };
    assert.deepEqual(maneuverLaneGuidance(step), { total: 3, valid: [2, 3] });
    step.intersections[0].location = [-71.01, 42];
    assert.equal(maneuverLaneGuidance(step), null);
    assert.equal(maneuverLaneGuidance({}), null);
});
