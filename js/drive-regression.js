/* Release gates use explicit truth labels. Recorded speech is not replayed speech. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./drive-replay'),require('./route-state'));else root.DriveRegression=factory(root.DriveReplay,root.RouteState);})(typeof window!=='undefined'?window:globalThis,function(replay,rules){
    'use strict';
    function evaluate(recording,source='foreground',existingReport){
        const report=existingReport||replay.run(recording,source),samples=replay.samples(recording,source).slice().sort((a,b)=>a.timestamp-b.timestamp);
        let labelledFixes=0,fixErrors=0,off={},lastRoute=-1;const proposals=[];
        for(let i=0;i<report.frames.length;i++){
            const f=report.frames[i],s=samples[i],hasProgress=Number.isFinite(s.expectedProgressMeters),label=typeof s.expectedMatched==='boolean'?s.expectedMatched:hasProgress?true:null;
            if(label!==null){labelledFixes++;if(!!f.snapped!==label||label&&hasProgress&&Math.abs(f.progressMeters-s.expectedProgressMeters)>Math.max(5,Number(s.expectedToleranceMeters)||25))fixErrors++;}
            if(f.routeIndex!==lastRoute){off={};lastRoute=f.routeIndex;}
            off=rules.evaluateOffRoute(off,{timestamp:s.receivedAt??s.timestamp,distanceMeters:f.rawDistanceMeters,accuracy:s.accuracy,oppositeDirection:f.reason==='opposite-direction',uncertain:!f.accepted||['ambiguous','nearby-road-conflict','reacquiring','motion-conflict'].includes(f.reason),online:s.online!==false,pending:s.reroutePending===true});
            if(off.shouldReroute)proposals.push(f.timestamp);
        }
        const events=(recording.events||[]).filter(e=>!e.data?.source||e.data.source===source),turns=events.filter(e=>e.type==='guidance-ground-truth'&&Number.isFinite(e.data?.latestAt)&&Number.isFinite(e.data?.progressMeters)&&['preview','prepare','execute'].includes(e.data?.stage));
        const stages={preview:1,prepare:2,execute:3};
        const late=turns.filter(e=>!report.frames.some(f=>f.routeIndex===(e.data.routeIndex??0)&&f.timestamp<=e.data.latestAt&&f.timestamp>=(e.data.earliestAt??-Infinity)&&f.guidance&&Math.abs(f.guidance.progressMeters-e.data.progressMeters)<=5&&stages[f.guidance.stage]>=stages[e.data.stage])).length;
        const windows=events.filter(e=>e.type==='reroute-ground-truth'&&Number.isFinite(e.data?.start)&&Number.isFinite(e.data?.end)&&e.data.end>=e.data.start&&typeof e.data.allowed==='boolean');
        const falseProposals=proposals.filter(at=>windows.some(e=>!e.data.allowed&&at>=e.data.start&&at<=e.data.end)).length;
        return {schema:1,source,synthetic:recording.synthetic===true,samples:report.samples,labelledFixes,fixErrors:labelledFixes?fixErrors:null,positionJumps:report.positionJumps,uncertain:report.uncertain,rejected:report.rejected,matched:report.matched,guidanceLabels:turns.length,lateGuidance:turns.length?late:null,rerouteLabels:windows.length,falseRerouteProposals:windows.length?falseProposals:null,rerouteProposals:proposals.length,
            limitations:'Route matching and guidance eligibility/off-route policy replay; not actual speech playback, full Android execution or network rerouting.'};
    }
    function gate(actual,limits,baseline){
        const failures=[];const allowed=new Set(['samples','labelledFixes','fixErrors','positionJumps','uncertain','rejected','matched','guidanceLabels','lateGuidance','rerouteLabels','falseRerouteProposals','rerouteProposals']);
        for(const [kind,values] of Object.entries(limits||{})){
            if(!['max','min','maxIncrease'].includes(kind)){failures.push('Unknown gate '+kind);continue;}
            for(const [key,limit] of Object.entries(values||{})){
                const value=kind==='maxIncrease'&&Number.isFinite(baseline?.[key])?actual[key]-baseline[key]:actual[key];
                if(!allowed.has(key)||!Number.isFinite(limit)||!Number.isFinite(actual[key])||kind==='maxIncrease'&&!Number.isFinite(baseline?.[key]))failures.push(key+': insufficient evidence');
                else if(kind==='min'?value<limit:value>limit)failures.push(key+': '+value+' violates '+kind+' '+limit);
            }
        }
        if(!Object.values(limits||{}).some(v=>v&&Object.keys(v).length))failures.push('No gates configured');
        return {passed:failures.length===0,failures};
    }
    return {evaluate,gate};
});
