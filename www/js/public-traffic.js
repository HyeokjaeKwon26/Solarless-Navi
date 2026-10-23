/* Keyless public feeds. Missing/stale/unmatched data never becomes invented delay. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.PublicTraffic = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    'use strict';
    const TTL = 10 * 60000;
    const cache = new Map();
    const sources = {
        nyc: { url: 'https://data.cityofnewyork.us/resource/i4gi-tjb9.json?$limit=5000&$order=data_as_of%20DESC', bounds: [-74.3,40.45,-73.65,40.95] },
        ma: { url: 'https://feed.massdot-swzm.com/massdot_wzdx_v4.1_work_zone_feed.geojson', bounds: [-73.6,41.2,-69.8,43] }
    };
    const distance = (a,b) => Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111195;
    function project(p,a,b) {
        const c = Math.cos(p[1]*Math.PI/180), dx=(b[0]-a[0])*c, dy=b[1]-a[1];
        const t=Math.max(0,Math.min(1,((p[0]-a[0])*c*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
        return {t, distance:distance(p,[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t])};
    }
    // Socrata floating timestamps are NYC local time, independent of phone timezone.
    // Fall-back hour is ambiguous: reject rather than choose the fresher interpretation.
    function nyTime(value) {
        if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?$/.test(value || '')) return NaN;
        const target = value.slice(0,19), candidates = [];
        for (const offset of ['-04:00','-05:00']) {
            const ms=Date.parse(value+offset);
            const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(ms)).replace(' ','T');
            if(parts===target) candidates.push(ms);
        }
        return candidates.length===1?candidates[0]:NaN;
    }
    function decode(text) {
        text=String(text||'');
        const result=[]; let i=0,lat=0,lng=0;
        function next() { let bits=0,shift=0,b;
            do { if(i>=text.length||shift>30) throw Error('polyline'); b=text.charCodeAt(i++)-63; if(b<0||b>63)throw Error('polyline'); bits|=(b&31)<<shift;shift+=5; } while(b>=32);
            return bits&1?~(bits>>1):bits>>1;
        }
        try { while(i<text.length&&result.length<10000) {lat+=next();lng+=next();result.push([lng/1e5,lat/1e5]);} } catch(e) {return [];}
        return result.every(p=>Math.abs(p[0])<=180&&Math.abs(p[1])<=90)?result:[];
    }
    const fresh = (at,now) => Number.isFinite(at)&&now-at>=-60000&&now-at<=TTL;
    function parseNYC(rows, now=Date.now()) {
        const links=[],seen=new Set(); let newest=0;
        for(const row of (Array.isArray(rows)?rows:[])) {
            const at=nyTime(row.data_as_of); newest=Math.max(newest,at||0);
            if(!fresh(at,now)||seen.has(row.link_id))continue;
            seen.add(row.link_id);
            const encoded=decode(row.encoded_poly_line), travel=Number(row.travel_time);
            const tokens=String(row.link_points||'').trim().split(/\s+/).filter(Boolean);
            const prefix=[];let complete=!!tokens.length;
            for(const token of tokens){const pair=token.split(',').map(Number);if(!/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(token)||pair.length!==2||!pair.every(Number.isFinite)||Math.abs(pair[0])>90||Math.abs(pair[1])>180){complete=false;break;}prefix.push([pair[1],pair[0]]);}
            // Some public rows truncate link_points and contain malformed escaped
            // polylines. Cross-check the available geometry, never repair by guess.
            const encodedValid=encoded.length>=2&&(!row.encoded_poly_line_lvls||encoded.length===row.encoded_poly_line_lvls.length)&&prefix.every((p,i)=>encoded[i]&&distance(p,encoded[i])<3);
            const points=complete&&prefix.length>=2?prefix:encodedValid?encoded:[];
            if(points.length<2||!(travel>0&&travel<7200))continue;
            const length=points.slice(1).reduce((s,p,i)=>s+distance(points[i],p),0);
            // TravelTime is seconds; do not guess the undocumented Speed unit.
            if(length<30||length/travel>55)continue;
            links.push({id:row.link_id,points,seconds:travel,length,at,name:String(row.link_name||'')});
        }
        return {source:'NYC DOT',newest,links,status:links.length?'fresh':newest?'stale':'unavailable'};
    }
    function parseMA(data,now=Date.now()) {
        const at=Date.parse(data?.feed_info?.update_date),events=[];
        if(fresh(at,now))for(const item of (data.features||[])) {
            const p=item.properties||{},start=Date.parse(p.start_date),end=Date.parse(p.end_date);
            if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<now||item.geometry?.type!=='LineString')continue;
            events.push({id:item.id,points:item.geometry.coordinates,impact:p.vehicle_impact,
                name:(p.core_details?.road_names||[]).join(', '),verified:p.is_start_date_verified===true&&p.is_start_position_verified===true});
        }
        return {source:'MassDOT',newest:at,events,status:fresh(at,now)?'fresh':Number.isFinite(at)?'stale':'unavailable'};
    }
    async function fetchSource(key,now) {
        const old=cache.get(key);
        if(old&&now-old.fetchedAt<300000)return key==='nyc'?parseNYC(old.data,now):parseMA(old.data,now);
        let data;
        try {
            const url=sources[key].url, native=root.Capacitor?.isNativePlatform?.()&&root.Capacitor?.Plugins?.CapacitorHttp;
            if(native) {const r=await native.get({url,connectTimeout:5000,readTimeout:8000});if(r.status!==200)throw Error('http');data=typeof r.data==='string'?JSON.parse(r.data):r.data;}
            else {const r=await fetch(url,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('http');const text=await r.text();if(text.length>8000000)throw Error('size');data=JSON.parse(text);}
            cache.set(key,{data,fetchedAt:now});
        } catch(e) {cache.set(key,{data:old?.data,fetchedAt:now});data=old?.data;}
        return key==='nyc'?parseNYC(data,now):parseMA(data,now);
    }
    async function load(coordinates,now=Date.now()) {
        const keys=Object.keys(sources).filter(k=>coordinates.some(p=>{const b=sources[k].bounds;return p[0]>=b[0]&&p[0]<=b[2]&&p[1]>=b[1]&&p[1]<=b[3];}));
        return Promise.all(keys.map(k=>fetchSource(k,now)));
    }
    function evaluate(raw,feeds,now=Date.now()) {
        const coords=raw.geometry.coordinates,total=coords.slice(1).reduce((s,p,i)=>s+distance(coords[i],p),0);
        const cumulative=[0],grid=new Map(),wide=[];
        for(let i=0;i<coords.length-1;i++) {
            const a=coords[i],b=coords[i+1];cumulative.push(cumulative[i]+distance(a,b));
            const x0=Math.floor(Math.min(a[0],b[0])*500),x1=Math.floor(Math.max(a[0],b[0])*500),y0=Math.floor(Math.min(a[1],b[1])*500),y1=Math.floor(Math.max(a[1],b[1])*500);
            if((x1-x0+1)*(y1-y0+1)>1000){wide.push(i);continue;}
            for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);}
        }
        const nearby=point=>{
            const x=Math.floor(point[0]*500),y=Math.floor(point[1]*500),indices=new Set(wide);
            for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const i of grid.get((x+dx)+','+(y+dy))||[])indices.add(i);
            return [...indices];
        };
        const originalSteps=(raw.legs||[]).flatMap(l=>l.steps||[]);
        const stepLength=originalSteps.reduce((s,step)=>s+(Number(step.distance)||0),0),stepTime=originalSteps.reduce((s,step)=>s+(Number(step.duration)||0),0);
        let at=0;
        const spans=originalSteps.map(step=>{const start=at;at+=(Number(step.distance)||0)*(total/(stepLength||1));return {start,end:at,seconds:(Number(step.duration)||0)*(raw.duration/(stepTime||1)),delta:0};});
        const baselineBetween=(start,end)=>spans.length?spans.reduce((s,p)=>s+p.seconds*Math.max(0,Math.min(p.end,end)-Math.max(p.start,start))/Math.max(.001,p.end-p.start),0):raw.duration*(end-start)/(total||1);
        const links=feeds.filter(f=>f.links&&fresh(f.newest,now)).flatMap(f=>f.links).filter(l=>fresh(l.at,now));
        let covered=0,observed=0,baseCovered=0;
        // A complete directed sensor link must match the route in order. Endpoint-only proximity is insufficient.
        const occupied=new Set();
        for(const link of links) {
            let last=-1,firstMeters=null,lastMeters=null; const segments=new Set(); let valid=true;
            for(const point of link.points) {
                let best=null;
                for(const i of nearby(point)){const p=project(point,coords[i],coords[i+1]);if(p.distance<=12&&(!best||p.distance<best.distance))best={...p,i,progress:i+p.t};}
                if(!best||best.progress+0.001<last){valid=false;break;}last=best.progress;segments.add(best.i);
                const meters=cumulative[best.i]+best.t*(cumulative[best.i+1]-cumulative[best.i]);
                if(firstMeters===null)firstMeters=meters;lastMeters=meters;
            }
            if(!valid||[...segments].some(i=>occupied.has(i)))continue;
            // Reject links which only map to a tiny piece of a crossing/parallel corridor.
            const matched=lastMeters-firstMeters;
            if(matched<link.length*.8||matched>link.length*1.3)continue;
            const baseline=baselineBetween(firstMeters,lastMeters);
            if(!(baseline>0))continue;
            covered+=matched;observed+=link.seconds;baseCovered+=baseline;segments.forEach(i=>occupied.add(i));
            for(const span of spans){const overlap=Math.max(0,Math.min(span.end,lastMeters)-Math.max(span.start,firstMeters));span.delta+=(link.seconds-baseline)*overlap/(matched||1);}
        }
        const warnings=[];
        for(const feed of feeds.filter(f=>fresh(f.newest,now)))for(const event of feed.events||[]) {
            if(event.points?.some(p=>nearby(p).some(i=>project(p,coords[i],coords[i+1]).distance<25)))warnings.push({source:feed.source,name:event.name,impact:event.impact,verified:event.verified});
        }
        const duration=covered>0?Math.max(1,raw.duration-baseCovered+observed):raw.duration;
        return {duration,coverage:Math.min(1,covered/(total||1)),observedSeconds:observed,warnings,
            steps:originalSteps.map((step,i)=>({...step,duration:Math.max(0,spans[i].seconds+spans[i].delta)})),
            sources:feeds.map(f=>({source:f.source,status:fresh(f.newest,now)?f.status:f.newest?'stale':'unavailable',updatedAt:f.newest})),checkedAt:now};
    }
    function label(result,ko=true) {
        if(!result)return ko?'교통 미반영':'Traffic not applied';
        const coverage=Math.round(result.coverage*100);
        let text=coverage>0?(ko?`센서 교통 ${coverage}% 구간 반영`:`Sensor traffic covers ${coverage}%`):(ko?'실시간 속도 미반영 · 기본 ETA':'No live speeds · base ETA');
        if(result.warnings.length)text+=ko?` · 주변 공사/통제 ${result.warnings.length}건`:` · ${result.warnings.length} nearby works/restrictions`;
        if(result.sources.some(s=>s.status==='stale'))text+=ko?' · 오래된 피드 제외':' · stale feed excluded';
        if(!result.sources.length)text+=ko?' · 지원 지역 밖':' · outside supported regions';
        const updated=Math.max(0,...result.sources.map(s=>s.updatedAt||0));
        if(updated)text+=(ko?' · 자료 ':' · data ')+new Date(updated).toLocaleTimeString();
        return text;
    }
    return {parseNYC,parseMA,nyTime,decode,load,evaluate,label,project,distance,fresh};
});
