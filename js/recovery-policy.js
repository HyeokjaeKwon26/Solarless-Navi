/* Select only verified provider candidates. Never fabricate a road connection. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RecoveryPolicy=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    function profile(route){
        let meters=0,earlyUturns=0,turns=0;
        for(const s of route?.raw?.legs?.flatMap(l=>l.steps||[])||route?.routeSteps||[]){
            if(meters>500)break;
            const m=s.maneuver||{};
            if(m.modifier==='uturn'&&meters<=250)earlyUturns++;
            if(['turn','fork','end of road','on ramp','off ramp','roundabout'].includes(m.type))turns++;
            meters+=Math.max(0,Number(s.distance)||0);
        }
        return {earlyUturns,turns};
    }
    function choose(data,mode,budgetMinutes,glareMetrics,preferenceAllows=()=>true){
        const original=data?.routes?.[mode]||data?.routes?.fastest;
        if(!original||!profile(original).earlyUturns)return {route:original,reason:'preferred'};
        // Respect the selected sun preference: only improve its complexity when
        // sun metrics are comparable and no worse. No new public API requests.
        const baseline=data.routes.fastest||original;
        const cap=Math.min(120,Math.max(0,Number(budgetMinutes)||0)*60);
        const originalGlare=mode==='glareFree'&&typeof glareMetrics==='function'&&original.analyzed?.segments?.length?glareMetrics(original.analyzed):null;
        const glareNotWorse=r=>{
            if(mode!=='glareFree')return true;
            if(!originalGlare||!r.analyzed?.segments?.length)return false;
            const candidate=glareMetrics(r.analyzed);
            return ['burden','strongSeconds','longestSeconds'].every(k=>Number.isFinite(candidate[k])&&Number.isFinite(originalGlare[k])&&candidate[k]<=originalGlare[k]);
        };
        const allowed=(data.routes.all||[]).filter(r=>r&&preferenceAllows(r)&&r.analyzed?.coordinates?.length>1&&!r.traffic?.blocked&&
            Number.isFinite(r.durationSec)&&r.durationSec>0&&r.durationSec<=original.durationSec+cap&&r.durationSec<=baseline.durationSec+Math.max(0,Number(budgetMinutes)||0)*60&&
            !profile(r).earlyUturns&&(['fastest','simple'].includes(mode)||['heuristic','scene','hybrid-scene'].includes(r.analysisMode)&&r.analysisMode===original.analysisMode&&
                !!r.weatherMode&&r.weatherMode!=='unknown'&&r.weatherMode===original.weatherMode&&
                Number.isFinite(r.analyzed?.[mode==='shade'?'sunlitTimeSeconds':'avgGlareRisk'])&&
                Number.isFinite(original.analyzed?.[mode==='shade'?'sunlitTimeSeconds':'avgGlareRisk'])&&
                r.analyzed[mode==='shade'?'sunlitTimeSeconds':'avgGlareRisk']<=original.analyzed[mode==='shade'?'sunlitTimeSeconds':'avgGlareRisk']&&
                glareNotWorse(r)));
        allowed.sort((a,b)=>a.durationSec-b.durationSec||profile(a).turns-profile(b).turns);
        return {route:allowed[0]||original,reason:allowed.length?'forward-recovery':'uturn-required-by-candidates',extraSeconds:allowed.length?allowed[0].durationSec-original.durationSec:0};
    }
    return {profile,choose};
});
