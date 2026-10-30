/* OSM vehicle entrance suggestions. User review and route verification remain required. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./road-network'));else root.EntranceCandidates=factory(root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(roads){
    'use strict';
    function candidates(pack,point){
        const graph=roads.build(pack),incoming=new Map();
        for(const e of graph.edges){if(!incoming.has(e.to))incoming.set(e.to,[]);incoming.get(e.to).push(e);}
        const result=[];
        for(const node of pack.elements){
            const t=node.tags||{},access=t.motorcar||t.motor_vehicle||t.vehicle||t.access;
            if(node.type!=='node'||!Number.isFinite(node.lon)||!Number.isFinite(node.lat)||access&&!['yes','permissive','designated'].includes(access)||Object.keys(t).some(k=>k.includes('conditional'))||t.entrance==='exit'||t.entrance==='emergency')continue;
            const explicit=t.amenity==='parking_entrance'||t.barrier==='entrance'||t.entrance&&t.motor_vehicle==='yes';
            if(!explicit)continue;
            const arriving=incoming.get(node.id)||[];
            if(!arriving.length)continue;
            const distance=roads.distance(point,[node.lon,node.lat]);if(distance>300)continue;
            result.push({id:node.id,lat:node.lat,lng:node.lon,name:t.name||'',kind:t.amenity==='parking_entrance'?'parking':'vehicle',distance,
                approaches:arriving.map(e=>({a:e.a,b:e.b})),road:arriving[0].name,oneWay:!graph.edges.some(e=>e.from===node.id&&e.to===arriving[0].from),verified:false});
        }
        return result.sort((a,b)=>a.distance-b.distance).slice(0,5);
    }
    let lastRequest=0;
    const cache=new Map();
    async function request(query,fetcher){
        const url='https://overpass.private.coffee/api/interpreter',body=new URLSearchParams({data:query});
        const cap=globalThis.Capacitor;
        if(!cap?.isNativePlatform?.()||!cap.nativePromise)return fetcher(url,{method:'POST',body,signal:AbortSignal.timeout(15000)});
        // Capacitor 6's patched POST fetch does not forward AbortSignal or
        // timeout options. Use the bundled native transport's explicit limits.
        let timer;
        try{
            const result=await Promise.race([cap.nativePromise('CapacitorHttp','request',{
                url,method:'POST',data:body.toString(),responseType:'text',connectTimeout:5000,readTimeout:15000,
                headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json',
                    'User-Agent':'SolarLessNavi (+https://github.com/HyeokjaeKwon26/Solarless-Navi)'}}),
                new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('REQUEST_TIMEOUT')),20000);})]);
            const text=typeof result.data==='string'?result.data:JSON.stringify(result.data);
            if(new TextEncoder().encode(text).length>1500000)throw Error('TOO_LARGE');
            return {ok:result.status>=200&&result.status<300,status:result.status,headers:{get:name=>result.headers?.[name]||result.headers?.[name.toLowerCase()]||null},text:async()=>text};
        }finally{clearTimeout(timer);}
    }
    async function find(point,saved,fetcher=fetch,now=Date.now()){
        if(!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>85)throw Error('INVALID_LOCATION');
        if(saved&&now>=saved.savedAt&&now-saved.savedAt<=7*86400000&&saved.bounds&&point[1]>=saved.bounds[0]+.003&&point[1]<=saved.bounds[2]-.003&&point[0]>=saved.bounds[1]+.004&&point[0]<=saved.bounds[3]-.004)return {items:candidates(saved,point),pack:saved,source:'saved',at:saved.savedAt};
        const key=point.map(v=>v.toFixed(4)).join(',');
        if(cache.get(key)?.until>now)return cache.get(key).value;
        if(now-lastRequest<60000)throw Error('COOLDOWN');lastRequest=now;
        const around=`around:350,${point[1]},${point[0]}`;
        const query=`[out:json][timeout:12];way[highway](${around})->.roads;(.roads;rel(bw.roads)[type~"^restriction"];node[amenity=parking_entrance](${around});node[barrier=entrance](${around});node[entrance][motor_vehicle=yes](${around}););(._;>;);out body;`;
        const response=await request(query,fetcher);
        if(response.status===429)throw Error('COOLDOWN');
        if(!response.ok)throw Error('PROVIDER_UNAVAILABLE');
        if(Number(response.headers.get('content-length'))>1500000)throw Error('TOO_LARGE');
        const reader=response.body?.getReader();let text;
        if(reader){const chunks=[];let size=0;for(;;){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>1500000){await reader.cancel();throw Error('TOO_LARGE');}chunks.push(r.value);}const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}text=new TextDecoder().decode(bytes);}else text=await response.text();
        if(text.length>1500000)throw Error('TOO_LARGE');
        const data=JSON.parse(text);if(data.remark||!Array.isArray(data.elements))throw Error('INCOMPLETE_DATA');
        const pack={version:1,savedAt:now,elements:data.elements,bounds:[point[1]-.003,point[0]-.003,point[1]+.003,point[0]+.003]};
        const value={items:candidates(pack,point),pack,source:'OSM',at:now};
        cache.set(key,{value,until:now+600000});while(cache.size>2)cache.delete(cache.keys().next().value);
        return value;
    }
    function approachMatches(item,route){
        const c=route?.geometry?.coordinates;if(!c?.length||!Number.isFinite(route.duration)||route.duration<=0)return false;
        const end=c.at(-1);if(roads.distance(end,[item.lng,item.lat])>12)return false;
        let before=c.length-2;while(before>0&&roads.distance(c[before],end)<12)before--;
        const heading=roads.bearing(c[before],end);
        return (item.approaches||[]).some(e=>roads.projection(end,e.a,e.b).distance<12&&Math.abs((heading-roads.bearing(e.a,e.b)+540)%360-180)<65);
    }
    async function rank(items,origin,options={}){
        const rows=items.map(v=>({...v,approach:null}));
        if(!origin||![origin.lng,origin.lat].every(Number.isFinite))return rows;
        const pack=options.pack,b=pack?.bounds,inside=b&&origin.lat>=b[0]&&origin.lat<=b[2]&&origin.lng>=b[1]&&origin.lng<=b[3];
        const graph=inside?roads.build(pack):null,current=()=>!options.signal?.aborted&&(!options.isCurrent||options.isCurrent());
        let requests=0;
        for(const row of rows){
            if(!current())return [];
            let route,source;
            if(graph){try{route=graph.route([origin.lng,origin.lat],[row.lng,row.lat],{tollFree:options.tollFree,heading:options.heading});source='local';}catch{}}
            if(!approachMatches(row,route)&&options.quote&&requests<3){
                requests++;try{route=await options.quote(origin,row);source='routing';}catch(e){if(e.message==='RATE_LIMIT')break;}
            }
            if(approachMatches(row,route))row.approach={seconds:route.duration,meters:route.distance,source,uturns:(route.legs||[]).flatMap(l=>l.steps||[]).filter(s=>s.maneuver?.modifier==='uturn').length};
        }
        if(!current())return [];
        return rows.sort((a,b)=>(a.approach?0:1)-(b.approach?0:1)||(a.approach?.uturns??0)-(b.approach?.uturns??0)||(a.approach?.seconds??Infinity)-(b.approach?.seconds??Infinity)||a.distance-b.distance);
    }
    return {candidates,find,rank,approachMatches};
});
