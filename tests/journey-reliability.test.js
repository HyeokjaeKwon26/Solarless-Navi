const test = require('node:test');
const assert = require('node:assert/strict');
const guidance = require('../js/navigation-guidance.js');
const policy = require('../js/journey-policy.js');
const quality = require('../js/drive-quality.js');
const state = require('../js/route-state.js');
test('stopping native recording waits for the final event before disabling the journal',async()=>{
    const calls=[];let complete;
    const root={Capacitor:{Plugins:{Pip:{getDriveRecording:async()=>({active:true}),
        recordDriveEvent:({type})=>{calls.push(type);return new Promise(resolve=>{complete=resolve;});},
        setDriveRecording:async({active})=>calls.push(`active:${active}`)
    }}},addEventListener:()=>{}};
    require('node:vm').runInNewContext(require('node:fs').readFileSync('js/drive-archive.js','utf8'),{window:root});
    await root.DriveArchive.init();
    const stopping=root.DriveArchive.setActive(false);
    assert.deepEqual(calls,['recording-stop']);complete();await stopping;
    assert.deepEqual(calls,['recording-stop','active:false']);
});
test('offline replay CLI applies recovery confirmation to native observations and reports them separately',()=>{
    const output=require('node:child_process').execFileSync(process.execPath,['tools/replay-drive.cjs','tests/fixtures/drive-recovery-synthetic.json'],{encoding:'utf8'});
    const report=JSON.parse(output);
    assert.deepEqual(report.nativeRouteReplay,{matched:2,uncertain:2,missingRoute:0});
    assert.equal(report.journeyReview.nativeSamples,4);
    assert.equal(report.journeyReview.maxNativeGpsGapSec,20);
    assert.deepEqual(report.journeyReview.rerouteLatencySec,[1]);
    assert.equal(report.journeyReview.fieldSolarBenefit,null);
});
const route = {analyzed:{coordinates:[[0,0],[0.01,0]]}};
const fix = (timestamp,lng=0.001,extra={}) => ({timestamp,lng,lat:0,accuracy:5,heading:90,speedKmh:36,...extra});
function tracker(r=route) {
    let previous={};
    return sample => {
        const checked=guidance.confirmMatch(guidance.match(r,sample,previous.snap),sample,previous);
        previous={...previous,...checked};
        if(checked.result.isSnapped) previous.snap=checked.result;
        return checked.result;
    };
}
test('tunnel gap needs two consistent fixes; duplicate and old fixes cannot confirm recovery',()=>{
    const track=tracker();
    assert.equal(track(fix(10000)).isSnapped,true);
    for(const sample of [fix(30000,0.008),fix(30000,0.008),fix(29999,0.008)]) {
        assert.equal(track(sample).reason,'reacquiring');
    }
    assert.equal(track(fix(31000,0.0081)).isSnapped,true);
});
test('recovery rejects impossible second jump and expired confirmation',()=>{
    const track=tracker();track(fix(10000));
    assert.equal(track(fix(30000,0.003)).isSnapped,false);
    assert.equal(track(fix(31000,0.008)).isSnapped,false);
    assert.equal(track(fix(37000,0.0081)).isSnapped,false);
    assert.equal(track(fix(38000,0.0082)).isSnapped,true);
});
test('parallel-road uncertainty scales with accuracy and persists through unmatched fixes',()=>{
    const parallel={analyzed:{coordinates:[[0,0],[0.01,0],[0.01,0.001],[0,0.001],[0,0.0002],[0.01,0.0002]]}};
    const track=tracker(parallel);
    assert.equal(track(fix(10000,0.005,{lat:0.00004,accuracy:30})).reason,'ambiguous');
    assert.equal(track(fix(11000,0.005,{lat:0.005})).isSnapped,false);
    assert.equal(track(fix(12000,0.005)).reason,'reacquiring');
    assert.equal(track(fix(13000,0.0051)).isSnapped,true);
});
test('invalid fix cannot become a route match; ambiguous samples reset reroute evidence',()=>{
    for(const extra of [{accuracy:0},{accuracy:null},{accuracy:36},{lat:91},{lng:181},{timestamp:NaN}]) {
        assert.equal(guidance.match(route,fix(10000,0.001,extra)).isSnapped,false);
    }
    let evidence={};
    for(const timestamp of [1000,2000,3000,4000]) evidence=state.evaluateOffRoute(evidence,{timestamp,distanceMeters:150,accuracy:5,online:true,uncertain:true});
    assert.equal(evidence.shouldReroute,false);
    const samples=[1000,2000,3000].map(timestamp=>({...fix(timestamp),receivedAt:timestamp,distanceMeters:150,online:true,snapReason:'ambiguous'}));
    assert.equal(quality.replay(samples,()=>0).rerouteRequests,0);
});
test('saved preview has bounded geometry, matching destination, TTL and independent data',()=>{
    const end={lat:0,lng:0.01};
    const snapshot=policy.previewSnapshot(route,end,1000);
    assert.equal(policy.validPreview(snapshot,end,43201000),true);
    assert.equal(policy.validPreview(snapshot,end,43201001),false);
    assert.equal(policy.validPreview(snapshot,end,999),false);
    assert.equal(policy.validPreview(snapshot,{...end,lng:0.02},1000),false);
    assert.equal(policy.previewSnapshot(route,{lat:91,lng:0},1000),null);
    assert.equal(policy.previewSnapshot({analyzed:{coordinates:[[0,0],[181,0]]}},end,1000),null);
    assert.equal(policy.previewSnapshot({analyzed:{coordinates:Array(20001).fill([0,0])}},end,1000),null);
    snapshot.coordinates[0][0]=9; assert.equal(route.analyzed.coordinates[0][0],0);
});
test('solar comparisons keep adverse tradeoffs and distinguish incompatible models and field measurements',()=>{
    const baseline={durationSec:600,analysisMode:'scene',weatherMode:'forecast',analyzed:{sunlitTimeSeconds:400,avgGlareRisk:.4,uncertainOcclusionTimeRatio:.1}};
    const selected={...baseline,durationSec:720,analyzed:{sunlitTimeSeconds:300,avgGlareRisk:.2,uncertainOcclusionTimeRatio:.3}};
    const report=policy.solarTradeoff(baseline,selected);
    assert.equal(report.predictionOnly,true);assert.equal(report.extraSeconds,120);assert.equal(report.sunlitSecondsSaved,100);assert.equal(report.uncertainRatio,.3);
    assert.equal(policy.solarTradeoff(selected,baseline).sunlitSecondsSaved,-100);
    assert.equal(policy.solarTradeoff(baseline,{...selected,analysisMode:'heuristic'}).sunlitSecondsSaved,null);
    assert.equal(policy.solarTradeoff(baseline,{...selected,weatherMode:'clear-sky'}).comparable,false);
    assert.equal(policy.solarTradeoff(null,selected),null);
});
test('drive review measures completed continuous trips and first verified reroutes, not cancelled/partial trips',()=>{
    const event=(type,recordedAt,id,extra={})=>({type,recordedAt,data:{id,...extra}});
    const events=[event('recording-start',0),event('trip-start',1000,'a',{predictedDurationSec:100,solar:{predictionOnly:false}}),
        event('trip-end',111000,'a',{arrived:true}),event('trip-start',120000,'b',{predictedDurationSec:100}),
        event('trip-redirect',125000,'b'),event('trip-end',230000,'b',{arrived:true}),
        event('trip-start',240000,'c',{predictedDurationSec:100}),event('recording-stop',250000),event('recording-start',260000),event('trip-end',350000,'c',{arrived:true}),
        event('reroute-start',1000,'r1'),event('reroute-ready',2500,'r1'),event('reroute-ready',4000,'r1'),
        event('reroute-start',5000,'r2'),event('reroute-failed',6000,'r2'),event('reroute-start',7000,'r3'),event('reroute-cancelled',8000,'r3'),
        event('reroute-start',9000,'r4'),{type:'match',recordedAt:1000,data:{timestamp:1000,snapped:true}}];
    const report=quality.review({samples:[{timestamp:1000},{timestamp:21000,snapped:false},{timestamp:22000}],events:events.reverse()});
    assert.deepEqual(report.etaErrorsSec,[10]);assert.equal(report.meanAbsoluteEtaErrorSec,10);
    assert.deepEqual(report.rerouteLatencySec,[1.5]);assert.equal(report.failedReroutes,1);assert.equal(report.cancelledReroutes,1);assert.equal(report.pendingReroutes,1);
    assert.equal(report.maxGpsGapSec,20);assert.equal(report.matched,1);assert.equal(report.uncertain,1);assert.equal(report.unlabelled,1);
    assert.equal(report.fieldSolarBenefit,null);assert.equal(report.solarPredictions[0].predictionOnly,true);
    assert.equal(quality.review({samples:[]}).meanAbsoluteEtaErrorSec,null);
});
