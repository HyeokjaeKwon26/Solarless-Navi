/* Opt-in, bounded local observations of complete directed road steps. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./navigation-guidance'));else root.SegmentEta=factory(root.NavigationGuidance);})(typeof window!=='undefined'?window:globalThis,function(guidance){
    'use strict';
    const KEY='solarless_eta_segments_v1',TTL=90*86400000,LIMIT=600,cache=new WeakMap();
    const distance=(a,b)=>Math.hypot((b[0]-a[0])*Math.cos((a[1]+b[1])*Math.PI/360),b[1]-a[1])*111195;
    const median=v=>{const a=v.slice().sort((x,y)=>x-y);return a[Math.floor(a.length/2)];};
    const slot=at=>{const d=new Date(at);return `${d.getDay()}:${Math.floor(d.getHours()/2)}:${d.getTimezoneOffset()}`;};
    function segments(route){
        if(!route?.analyzed?.coordinates||!route.raw?.legs)return [];
        if(cache.has(route))return cache.get(route);
        const model=guidance.model(route),out=[];let cursor=0;
        for(const leg of route.raw.legs)for(const step of leg.steps||[]){
            const coords=step.geometry?.coordinates,base=step.duration;
            if(!Array.isArray(coords)||coords.length<2||coords.length>2000||!(base>=10&&base<3600)||!coords.every(p=>p?.length>=2&&p.slice(0,2).every(Number.isFinite)))continue;
            const locate=(p,from)=>{for(let i=from;i<model.coordinates.length;i++)if(distance(p,model.coordinates[i])<2)return i;return -1;};
            const first=locate(coords[0],cursor),last=first<0?-1:locate(coords.at(-1),first+1);if(first<0||last<0)continue;cursor=last;
            const start=model.cumulative[first],end=model.cumulative[last];if(end-start<100||end-start>5000)continue;
            // Every coordinate and its direction participates; a parallel road cannot borrow this history.
            let a=2166136261,b=5381;const identity=(step.name||'')+'|'+(step.ref||'')+'|'+coords.map(p=>p.slice(0,2).map(n=>n.toFixed(5)).join(',')).join(';');
            for(const c of identity){a=Math.imul(a^c.charCodeAt(0),16777619);b=Math.imul(b,33)^c.charCodeAt(0);}
            out.push({key:`${coords.length}:${a>>>0}:${b>>>0}`,start,end,base});
        }
        cache.set(route,out);return out;
    }
    function valid(r,now){return r&&typeof r.key==='string'&&r.key.length<100&&typeof r.slot==='string'&&r.slot.length<40&&Number.isFinite(r.trip)&&Number.isFinite(r.at)&&now>=r.at&&now-r.at<=TTL&&Number.isFinite(r.base)&&r.base>=10&&r.base<=3600&&Number.isFinite(r.actual)&&r.actual/r.base>=.5&&r.actual/r.base<=3;}
    function profile(rows,route,at){
        const parts=[];
        for(const s of segments(route)){
            const seen=new Set(),observations=rows.filter(r=>valid(r,at)&&r.key===s.key&&r.slot===slot(at)).sort((a,b)=>b.at-a.at).filter(r=>{if(seen.has(r.trip))return false;seen.add(r.trip);return true;});
            if(observations.length<5)continue;
            const held=observations.slice(0,2),train=observations.slice(2),ratios=train.map(r=>r.actual/r.base),factor=Math.max(.8,Math.min(1.5,median(ratios)));
            const baseline=held.reduce((sum,r)=>sum+Math.abs(r.actual-r.base),0),corrected=held.reduce((sum,r)=>sum+Math.abs(r.actual-r.base*factor),0);
            if(corrected>=baseline*.9||median(ratios.map(v=>Math.abs(v-factor)))>.25||Math.abs(factor-1)<.03)continue;
            parts.push({...s,factor,count:observations.length});
        }
        const remaining=(progress,base)=>{
            if(!(base>0)||!Number.isFinite(progress))return 1;
            const delta=parts.reduce((sum,s)=>sum+s.base*(s.factor-1)*Math.max(0,Math.min(1,(s.end-progress)/(s.end-s.start))),0);
            return Math.max(.8,Math.min(1.5,1+delta/base));
        };
        return {factor:remaining(0,route?.durationSec),count:parts.length?Math.min(...parts.map(s=>s.count)):0,applied:parts.length>0,segmentCount:parts.length,remainingFactor:remaining};
    }
    function create(storage,clock=()=>Date.now()){
        let rows=[],session=null;
        try{const value=JSON.parse(storage.getItem(KEY));if(Array.isArray(value)){rows=value.filter(r=>valid(r,clock())).slice(-LIMIT);if(rows.length!==value.length)storage.setItem(KEY,JSON.stringify(rows));}}catch{}
        function save(){rows=rows.filter(r=>valid(r,clock())).slice(-LIMIT);try{storage.setItem(KEY,JSON.stringify(rows));}catch{}}
        return {get count(){return rows.filter(r=>valid(r,clock())).length;},estimate:(route,at)=>profile(rows,route,at??clock()),clear(){storage.setItem(KEY,'[]');rows=[];session=null;},cancel(){session=null;},
            start(route){session={route,trip:clock(),parts:segments(route),previous:null,active:null};},
            sample(route,fix){
                if(!session||session.route!==route)return;
                const s=session,p=fix.progressMeters,now=clock(),at=fix.timestamp;
                if(!fix.isSnapped||!Number.isFinite(p)||!Number.isFinite(at)||Math.abs(now-at)>10000){s.active=null;s.previous=null;return;}
                const prev=s.previous;s.previous={p,at};
                if(!prev||at<=prev.at||at-prev.at>15000||p<prev.p-5){s.active=null;return;}
                const crossing=position=>prev.at+(at-prev.at)*Math.max(0,Math.min(1,(position-prev.p)/Math.max(.001,p-prev.p)));
                if(s.active){
                    const active=s.active;
                    if(fix.speedKmh<3){active.stoppedAt??=at;if(at-active.stoppedAt>120000)active.invalid=true;}else active.stoppedAt=null;
                    if(p>=active.part.end){
                        const row={key:active.part.key,slot:slot(active.at),trip:s.trip,at:active.at,base:active.part.base,actual:(crossing(active.part.end)-active.at)/1000};
                        if(!active.invalid&&valid(row,now)){rows.push(row);save();}s.active=null;
                    }
                }
                if(!s.active){const part=s.parts.find(v=>prev.p<=v.start&&p>=v.start&&p<v.end);if(part)s.active={part,at:crossing(part.start),stoppedAt:null,invalid:false};}
            }};
    }
    return {KEY,segments,profile,valid,create};
});
