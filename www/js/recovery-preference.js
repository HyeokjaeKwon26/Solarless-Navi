/* Bounded, time-specific evidence for Android recovery. No new scene lookup. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RecoveryPreference=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    function snapshot(routes,mode,budget,now=Date.now()){
        const segments=[];
        for(const route of routes||[])for(const s of route?.analyzed?.segments||[]){
            const at=new Date(s.passTime).getTime();
            if(!Array.isArray(s.p1)||!Array.isArray(s.p2)||![...s.p1,...s.p2,s.glareRisk,s.occlusionRatio].every(Number.isFinite)||s.irradiance?.model!=='OPEN_METEO_FORECAST'||!Number.isFinite(at)||Math.abs(at-now)>1800000)continue;
            if(segments.length>=512)break;
            segments.push([...s.p1,...s.p2,Math.max(0,Math.min(1,s.glareRisk)),Math.max(0,Math.min(1,s.occlusionRatio)),at]);
        }
        return {mode:['fastest','simple','glareFree','shade'].includes(mode)?mode:'fastest',budgetSeconds:Math.max(0,Math.min(600,Number(budget)*60||0)),createdAt:now,segments};
    }
    return {snapshot};
});
