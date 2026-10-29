/* Deterministic local replay. A saved snap is evidence, never ground truth. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./navigation-guidance'),require('./route-state'));else root.DriveReplay=factory(root.NavigationGuidance,root.RouteState);})(typeof window!=='undefined'?window:globalThis,function(guidance,rules){
    'use strict';
    const distance=(lat1,lng1,lat2,lng2)=>Math.hypot((lng2-lng1)*Math.cos((lat1+lat2)*Math.PI/360),lat2-lat1)*111195;
    function samples(recording,source='foreground'){
        if(source!=='native')return recording.samples||[];
        return (recording.events||[]).filter(e=>e.type==='native-location'&&e.data).map(e=>({...e.data,receivedAt:e.recordedAt,
            accuracy:e.data.accuracy68>0?e.data.accuracy68*1.62:Infinity,reportedSpeedKmh:e.data.speedMps>=0?e.data.speedMps*3.6:null,
            heading:e.data.heading>=0?e.data.heading:null}));
    }
    function run(recording,source='foreground'){
        if(![1,2].includes(recording?.version)||!Array.isArray(recording.samples)||recording.samples.length>50000||(recording.events||[]).length>60000)throw Error('INVALID_RECORDING');
        const events=(recording.events||[]).filter(e=>Number.isFinite(e.recordedAt)).slice().sort((a,b)=>a.recordedAt-b.recordedAt);
        const routes=events.filter(e=>e.type==='route'&&e.data?.coordinates?.length>=2&&e.data.coordinates.length<=100000&&e.data.coordinates.every(p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85));
        const fixes=samples(recording,source).slice().sort((a,b)=>a.timestamp-b.timestamp);
        if(fixes.length>50000)throw Error('REPLAY_TOO_LARGE');
        const report={version:1,samples:fixes.length,matched:0,uncertain:0,missingRoute:0,rejected:0,positionJumps:0,labelledMatches:0,wrongRoadMatches:0,turnTimingLabels:0,lateTurnRequests:0,frames:[]};
        let ri=-1,state={},lastFix=null,lastSnap=null,geometryWork=0;
        for(const sample of fixes){
            const now=Number.isFinite(sample.receivedAt)?sample.receivedAt:sample.timestamp;
            while(ri+1<routes.length&&routes[ri+1].recordedAt<=now){ri++;state={};lastSnap=null;}
            const fix={...sample,speedKmh:sample.reportedSpeedKmh??sample.speedKmh};
            const checked=rules.evaluateNavigationFix(lastFix,fix,distance,{nowMs:now});
            const frame={timestamp:sample.timestamp,raw:[sample.lng,sample.lat],routeIndex:ri,accepted:checked.accepted,reason:checked.reason};
            if(!checked.accepted){report.rejected++;report.frames.push(frame);continue;}
            lastFix=fix;
            if(ri<0){report.missingRoute++;report.frames.push(frame);continue;}
            const data=routes[ri].data;
            geometryWork+=data.coordinates.length;
            if(geometryWork>25000000)throw Error('REPLAY_TOO_LARGE');
            const route=routes[ri]._model||(routes[ri]._model={analyzed:{coordinates:data.coordinates},maneuvers:data.maneuvers||[],distanceMeters:data.distanceMeters});
            const confirmed=guidance.confirmMatch(guidance.match(route,fix,state.snap),fix,state);
            const snap=confirmed.result;state={...state,...confirmed};
            Object.assign(frame,{snapped:snap.isSnapped,reason:snap.reason,progressMeters:snap.progressMeters,matched:snap.isSnapped?[snap.lng,snap.lat]:null});
            if(snap.isSnapped){
                report.matched++;state.snap=snap;
                if(lastSnap&&fix.timestamp-lastSnap.timestamp<=5000&&Math.abs(snap.progressMeters-lastSnap.progressMeters)>Math.max(60,(fix.speedKmh||0)/3.6*(fix.timestamp-lastSnap.timestamp)/1000*2))report.positionJumps++;
                lastSnap=snap;
                // Labels are manually supplied route positions with a stated tolerance.
                if(Number.isFinite(sample.expectedProgressMeters)){
                    report.labelledMatches++;
                    if(Math.abs(snap.progressMeters-sample.expectedProgressMeters)>Math.max(5,Number(sample.expectedToleranceMeters)||25))report.wrongRoadMatches++;
                }
            }else report.uncertain++;
        report.frames.push(frame);
        }
        for(const event of events.filter(e=>e.type==='turn-ground-truth')){
            const d=event.data||{};
            if(!Number.isFinite(d.latestRequestAt)||typeof d.utteranceId!=='string')continue;
            report.turnTimingLabels++;
            const voice=events.find(e=>e.type==='voice'&&e.data?.utteranceId===d.utteranceId&&e.data.status==='requested');
            if(!voice||voice.recordedAt>d.latestRequestAt)report.lateTurnRequests++;
        }
        report.wrongRoadRate=report.labelledMatches?report.wrongRoadMatches/report.labelledMatches:null;
        report.lateTurnRequestRate=report.turnTimingLabels?report.lateTurnRequests/report.turnTimingLabels:null;
        report.routes=routes.map(e=>e.data.coordinates);
        return report;
    }
    function compare(before,after){
        const keys=['matched','uncertain','missingRoute','rejected','positionJumps','wrongRoadRate','lateTurnRequestRate'];
        return Object.fromEntries(keys.map(k=>[k,Number.isFinite(before[k])&&Number.isFinite(after[k])?after[k]-before[k]:null]));
    }
    return {run,compare,samples};
});
