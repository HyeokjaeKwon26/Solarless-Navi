/* Bounded, user-requested driving detour quotes; POI pins are not verified entrances. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RouteDetours=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    // Shared with normal routing: the public demo permits at most 1 request/s.
    // Reserve launch slots, not response completion, and skip cancelled work.
    function createRoutingFetch(fetcher,clock=()=>performance.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))){
        let tail=Promise.resolve(),last=-Infinity;
        return async function(url,options={}){
            const previous=tail;let release;tail=new Promise(resolve=>release=resolve);
            try{
                await previous;
                if(options.signal?.aborted)throw Error('REQUEST_CANCELLED');
                const delay=Math.max(0,1000-(clock()-last));if(delay)await sleep(Math.ceil(delay));
                if(options.signal?.aborted)throw Error('REQUEST_CANCELLED');
                last=clock();return fetcher(url,options);
            }finally{release();}
        };
    }
    const routingFetch=createRoutingFetch((...args)=>fetch(...args));
    const point=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=85&&Math.abs(p.lng)<=180;
    function url(start,end,via,options={}){
        if(!point(start)||!point(end)||via&&!point(via))throw Error('COORDINATES');
        const points=via?[start,via,end]:[start,end];
        let value='https://router.project-osrm.org/route/v1/driving/'+points.map(p=>`${p.lng},${p.lat}`).join(';')+'?overview=full&geometries=geojson&steps=true&alternatives=false&continue_straight=false';
        if(options.tollFree)value+='&exclude=toll';
        if(Number.isFinite(options.heading)&&options.heading>=0)value+='&bearings='+`${Math.round(options.heading%360)},60`+';'.repeat(points.length-1);
        return value;
    }
    function validate(data,via){
        const r=data?.routes?.[0],n=via?3:2;
        if(data?.code!=='Ok'||!r||!Number.isFinite(r.duration)||r.duration<=0||!Number.isFinite(r.distance)||r.distance<=0||
            !Array.isArray(r.geometry?.coordinates)||r.geometry.coordinates.length<2||!r.geometry.coordinates.every(p=>Array.isArray(p)&&point({lng:p[0],lat:p[1]}))||
            !Array.isArray(r.legs)||r.legs.length!==n-1||r.legs.some(l=>!l||!Array.isArray(l.steps)||l.steps.some(s=>!s||typeof s!=='object'))||!Array.isArray(data.waypoints)||data.waypoints.length!==n||
            data.waypoints.some(w=>!Number.isFinite(w.distance)||w.distance<0||w.distance>60))throw Error('ACCESS_UNVERIFIED');
        return r;
    }
    async function request(start,end,via,options){
        const controller=new AbortController(),abort=()=>controller.abort();
        options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();
        const timer=setTimeout(abort,10000);
        try{
            const response=await (options.fetcher||routingFetch)(url(start,end,via,options),{signal:controller.signal});
            if(!response.ok)throw Error(response.status===429?'RATE_LIMIT':'NETWORK');
            const text=await response.text();if(text.length>2000000)throw Error('SIZE');
            return validate(JSON.parse(text),via);
        }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
    }
    function quote(base,via){return {extraSeconds:Math.max(0,via.duration-base.duration),extraMeters:Math.max(0,via.distance-base.distance),
        uturns:via.legs.reduce((n,l)=>n+(l.steps||[]).filter(s=>s.maneuver?.modifier==='uturn').length,0),baseSeconds:base.duration,viaSeconds:via.duration};}
    async function rank(items,start,end,options={}){
        const rows=items.map(item=>({...item,detour:null})),routes=[];
        if(!rows.length)return rows;
        const current=()=>!options.signal?.aborted&&(!options.isCurrent||options.isCurrent());
        let base;
        try{base=await request(start,end,null,options);}catch{return rows;}
        for(const row of rows.slice(0,3)){
            if(!current())return [];
            try{const r=await request(start,end,row,options);routes.push({row,r});}
            catch(e){if(e.message==='RATE_LIMIT'||options.signal?.aborted)break;}
        }
        if(!current())return [];
        let allowed;
        try{allowed=options.inspect?await options.inspect([base,...routes.map(v=>v.r)]):[base,...routes.map(v=>v.r)].map(()=>true);}catch{return rows;}
        if(!current())return [];
        if(!Array.isArray(allowed)||!allowed[0])return rows;
        routes.forEach(({row,r},i)=>{if(allowed[i+1])row.detour=quote(base,r);else row.blocked=true;});
        return rows.sort((a,b)=>(a.detour?.extraSeconds??Infinity)-(b.detour?.extraSeconds??Infinity)||(a.detour?.uturns??Infinity)-(b.detour?.uturns??Infinity));
    }
    return {url,validate,quote,rank,request,routingFetch,createRoutingFetch};
});
