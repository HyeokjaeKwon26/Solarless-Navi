/* Bounded route preferences and itinerary/proposal validation. No data uploads. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JourneyUpgrades=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const modes=['fastest','simple','glareFree','shade'];
    const budget=value=>[0,2,5,10].includes(Number(value))?Number(value):5;
    function complexity(route){
        const steps=route?.raw?.legs?.flatMap(l=>l.steps||[])||route?.routeSteps||[];
        let turns=0,uturns=0,branches=0;
        for(const s of steps){const m=s.maneuver||{};
            if(m.modifier==='uturn')uturns++;
            else if(['turn','end of road','roundabout','rotary','roundabout turn'].includes(m.type))turns++;
            if(['fork','merge','on ramp','off ramp'].includes(m.type))branches++;
        }
        return {turns,uturns,branches,score:turns+uturns*8+branches*2};
    }
    function apply(data,minutes){
        if(!data?.routes?.fastest)return data;
        const routes=data.routes,base=routes.fastest,cap=budget(minutes)*60;
        data.unboundedRoles ||= {glareFree:routes.glareFree,shade:routes.shade};
        const allowed=r=>r&&Number.isFinite(r.durationSec)&&r.durationSec>0&&!r.traffic?.blocked&&r.durationSec<=base.durationSec+cap+.001;
        const candidates=[base,...(routes.all||[])].filter(allowed);
        routes.simple=candidates.sort((a,b)=>complexity(a).score-complexity(b).score||a.durationSec-b.durationSec)[0]||base;
        for(const mode of ['glareFree','shade'])routes[mode]=allowed(data.unboundedRoles[mode])?data.unboundedRoles[mode]:base;
        data.preferenceBudgetMinutes=budget(minutes);
        return data;
    }
    function reorder(plan,from,to){
        const points=[plan.current,...plan.pending];
        if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=points.length||to>=points.length)throw Error('INVALID_ORDER');
        const [point]=points.splice(from,1);points.splice(to,0,point);
        return {savedAt:Date.now(),current:points[0],pending:points.slice(1)};
    }
    function closureKey(traffic){return (traffic?.closures||[]).map(c=>`${c.source}:${c.id}:${c.name}`).sort().join('|');}
    function proposalCurrent(proposal,state,distance){
        return !!(proposal&&state.live&&state.realtime&&state.snapped&&!state.busy&&state.routeKey===proposal.routeKey&&state.destinationKey===proposal.destinationKey&&
            state.toll===proposal.toll&&state.mode===proposal.mode&&state.budget===proposal.budget&&
            state.now>=proposal.at&&state.now-proposal.at<=120000&&state.now-state.fixAt>=0&&state.now-state.fixAt<=10000&&
            Number.isFinite(state.accuracy)&&state.accuracy<=35&&state.position&&distance(proposal.start,state.position)<=50&&
            (!Number.isFinite(proposal.heading)||(Number.isFinite(state.heading)&&Math.abs(((state.heading-proposal.heading+540)%360)-180)<=60)));
    }
    // Each future leg is independent; stops take time that is deliberately not guessed.
    async function itinerary(points,first,request,inspect,isCurrent=()=>true){
        if(!Array.isArray(points)||points.length<2||points.length>5)throw Error('INVALID_TRIP');
        const legs=[];
        for(let i=1;i<points.length;i++){
            if(!isCurrent())throw Error('STALE_TRIP');
            const raw=i===1?first:await request(points[i-1].coords,points[i].coords);
            if(!raw||!Number.isFinite(raw.duration)||raw.duration<=0||!Number.isFinite(raw.distance)||raw.distance<=0||!Array.isArray(raw.geometry?.coordinates)||raw.geometry.coordinates.length<2)throw Error('INVALID_LEG');
            legs.push({from:points[i-1].name,to:points[i].name,raw});
        }
        if(!isCurrent()||!await inspect(legs.map(l=>l.raw))||!isCurrent())throw Error('TRIP_UNVERIFIED');
        return {legs,seconds:legs.reduce((n,l)=>n+l.raw.duration,0),meters:legs.reduce((n,l)=>n+l.raw.distance,0)};
    }
    return {modes,budget,complexity,apply,reorder,closureKey,proposalCurrent,itinerary};
});
