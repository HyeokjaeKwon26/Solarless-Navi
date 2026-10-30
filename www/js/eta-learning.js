/* Optional device-local ETA history. Never changes routing or traffic data. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./segment-eta'));else root.EtaLearning=factory(root.SegmentEta);})(typeof window!=='undefined'?window:globalThis,function(segmentEta){
    'use strict';
    const KEY='solarless_eta_history_v1', TTL=90*86400000, LIMIT=100;
    const keys=new WeakMap();
    const median=a=>{const b=a.slice().sort((x,y)=>x-y);return (b[Math.floor((b.length-1)/2)]+b[Math.ceil((b.length-1)/2)])/2;};
    function routeKey(route){
        const coords=route?.analyzed?.coordinates;
        if(!Array.isArray(coords)||coords.length<2||!Number.isFinite(route.durationSec)||route.durationSec<=0)return null;
        if(keys.has(coords))return keys.get(coords);
        let a=2166136261,b=5381;
        for(const p of coords){
            if(!Array.isArray(p)||p.length<2||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85)return null;
            for(const c of `${p[0].toFixed(5)},${p[1].toFixed(5)};`){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}
        }
        const key=`${coords.length}:${a>>>0}:${b>>>0}`;keys.set(coords,key);return key;
    }
    function slot(at){const d=new Date(at);return `${d.getDay()}:${Math.floor(d.getHours()/2)}:${d.getTimezoneOffset()}`;}
    function valid(r,now){return r&&typeof r.key==='string'&&r.key.length<100&&typeof r.slot==='string'&&r.slot.length<40&&
        [r.at,r.base,r.actual].every(Number.isFinite)&&now>=r.at&&now-r.at<=TTL&&r.base>=60&&r.actual>=60&&r.actual<=21600&&r.actual/r.base>=.5&&r.actual/r.base<=3;}
    function estimate(records,key,at,base){
        const rows=records.filter(r=>valid(r,at)&&r.key===key&&r.slot===slot(at)).sort((a,b)=>a.at-b.at);
        const plain={factor:1,count:rows.length,applied:false};
        if(!key||rows.length<5||!Number.isFinite(base)||base<=0)return plain;
        const ratios=rows.map(r=>r.actual/r.base),train=ratios.slice(0,-2),held=rows.slice(-2);
        const trained=Math.max(.8,Math.min(1.5,median(train)));
        const baseline=held.reduce((s,r)=>s+Math.abs(r.actual-r.base),0);
        const corrected=held.reduce((s,r)=>s+Math.abs(r.actual-r.base*trained),0);
        const factor=Math.max(.8,Math.min(1.5,median(ratios)));
        const ordered=ratios.slice().sort((a,b)=>a-b);
        const range={lowFactor:ordered[Math.floor((ordered.length-1)*.1)],highFactor:ordered[Math.ceil((ordered.length-1)*.9)],count:rows.length};
        if(corrected>=baseline*.9||median(ratios.map(r=>Math.abs(r-factor)))>.25||Math.abs(factor-1)<.03)return {...plain,range};
        return {factor,count:rows.length,applied:true,range};
    }
    function create(storage,clock=()=>Date.now()){
        let state={enabled:false,records:[]},session=null;
        const segments=segmentEta.create(storage,clock);
        try{const v=JSON.parse(storage.getItem(KEY));if(v&&typeof v.enabled==='boolean'&&Array.isArray(v.records)){
            state={enabled:v.enabled,records:v.records.filter(r=>valid(r,clock())).slice(-LIMIT)};
            if(state.records.length!==v.records.length)storage.setItem(KEY,JSON.stringify(state));
        }}catch{}
        function persist(next){storage.setItem(KEY,JSON.stringify(next));state=next;}
        return {
            get enabled(){return state.enabled;},get count(){return state.records.filter(r=>valid(r,clock())).length;},
            get segmentCount(){return segments.count;},
            enable(value){persist({...state,enabled:value===true});session=null;segments.cancel();},
            clear(){segments.clear();persist({enabled:state.enabled,records:[]});session=null;},
            estimate(route,at=clock()){
                if(!state.enabled||route?.traffic?.coverage>0||route?.offline)return {factor:1,count:0,applied:false};
                const shared=segments.estimate(route,at);
                return shared.applied?shared:estimate(state.records,routeKey(route),at,route?.durationSec);
            },
            start(route){
                const key=routeKey(route),at=clock();
                session=state.enabled&&key&&!route.offline&&!(route.traffic?.coverage>0) ? {key,slot:slot(at),at,base:route.durationSec,last:at,samples:0,stoppedAt:null}:null;
                if(session)segments.start(route);else segments.cancel();
            },
            sample(route,fix){
                if(state.enabled&&!route?.offline&&!(route?.traffic?.coverage>0)&&!(route?.remainingForecast?.traffic?.coverage>0))segments.sample(route,fix);else segments.cancel();
                if(!session)return;
                const now=clock();
                if(routeKey(route)!==session.key||route.traffic?.coverage>0||route.remainingForecast?.traffic?.coverage>0||now-session.last>60000||!Number.isFinite(fix.timestamp)||Math.abs(now-fix.timestamp)>10000){session=null;return;}
                if(!fix.isSnapped)return;
                session.last=now;session.samples++;
                if(Number.isFinite(fix.speedKmh)&&fix.speedKmh<3){if(session.stoppedAt===null)session.stoppedAt=now;if(now-session.stoppedAt>300000)session=null;}
                else session.stoppedAt=null;
            },
            cancel(){session=null;segments.cancel();},
            finish(route,arrived){
                const s=session;session=null;
                segments.cancel();
                if(!state.enabled||!arrived||!s||routeKey(route)!==s.key||s.samples<3||clock()-s.last>15000)return false;
                const row={key:s.key,slot:s.slot,at:s.at,base:s.base,actual:(clock()-s.at)/1000};
                if(!valid(row,clock()))return false;
                persist({enabled:true,records:[...state.records.filter(r=>valid(r,clock())),row].slice(-LIMIT)});return true;
            }
        };
    }
    return {create,routeKey,slot,estimate,valid,KEY};
});
