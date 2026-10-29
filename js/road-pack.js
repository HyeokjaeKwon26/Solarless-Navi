(function(root){
    'use strict';
    let graph=null,pack=null,db=null,layer=null, drawnGraph=null, lastDownload=0,catalog=[],generation=0;
    const MAX_BYTES=12*1024*1024;
    const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
    async function digest(value){const hash=await crypto.subtle.digest('SHA-256',bytes([value.bounds,value.elements]));return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
    const valid=()=>pack&&Date.now()>=pack.savedAt&&Date.now()-pack.savedAt<=7*86400000;
    const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const status=text=>{const el=document.getElementById('road-pack-status');if(el)el.textContent=text;};
    const localized=(ko,en)=>root.I18n?.getLanguage().startsWith('ko')?ko:en;
    function show(){status(pack?localized(`OSM 지역 저장됨 · ${(bytes(pack).length/1048576).toFixed(1)} MB · 장소/주소 ${catalog.length}개 · ${new Date(pack.savedAt).toLocaleString()} · 7일 유효`,`Saved OSM area · ${(bytes(pack).length/1048576).toFixed(1)} MB · ${catalog.length} places/addresses · ${new Date(pack.savedAt).toLocaleString()} · valid 7 days`):localized('저장된 도로 없음','No offline road pack'));}
    async function init(){
        const r=indexedDB.open('solarless-road-pack',1);r.onupgradeneeded=()=>r.result.createObjectStore('packs');db=await req(r);
        const saved=await req(db.transaction('packs').objectStore('packs').get('local'));
        if(saved){try{if(bytes(saved).length>MAX_BYTES||saved.sha256&&saved.sha256!==await digest(saved))throw Error('CORRUPT_PACK');graph=RoadGraph.build(saved);catalog=OfflineCatalog.build(saved);pack=saved;}catch(e){status(localized('도로 자료 만료 또는 손상 · 다시 저장하세요','Road pack expired or damaged. Save it again.'));return;}}show();
    }
    async function save(center,diameterKm=3){
        if(!db)throw Error('STORAGE_UNAVAILABLE');
        if(!Number.isFinite(center?.lat)||!Number.isFinite(center?.lng)||Math.abs(center.lat)>75)throw Error('LOCATION_UNAVAILABLE');
        if (Date.now()-lastDownload<60000) throw Error('DOWNLOAD_COOLDOWN');
        lastDownload=Date.now();
        const token=++generation;
        status(localized('주변 도로 다운로드 중…','Downloading roads…'));
        const size=[3,6].includes(Number(diameterKm))?Number(diameterKm):3;
        const lat=size/2/111.195,lng=lat/Math.cos(center.lat*Math.PI/180),bounds=[center.lat-lat,center.lng-lng,center.lat+lat,center.lng+lng];
        // Ways, their nodes, and all turn restrictions involving those ways. No map tiles are downloaded.
        const box=bounds.join(',');
        const query=`[out:json][timeout:25];way[highway](${box})->.roads;(.roads;rel(bw.roads)[type~"^restriction"];node["addr:housenumber"](${box});way["addr:housenumber"](${box});nwr[amenity~"^(fuel|parking|charging_station)$"](${box}););(._;>;);out body;`;
        const response=await fetch('https://overpass.private.coffee/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(30000)});
        if(response.status===429)throw Error('ROAD_PROVIDER_BUSY');
        if(!response.ok)throw Error('ROAD_DOWNLOAD_FAILED');
        if(Number(response.headers.get('content-length'))>MAX_BYTES)throw Error('ROAD_PACK_TOO_LARGE');
        const reader=response.body?.getReader();let text;
        if(reader){const chunks=[];let length=0;while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>MAX_BYTES){await reader.cancel();throw Error('ROAD_PACK_TOO_LARGE');}chunks.push(value);}const data=new Uint8Array(length);let at=0;for(const chunk of chunks){data.set(chunk,at);at+=chunk.length;}text=new TextDecoder().decode(data);}
        else {text=await response.text();if(new TextEncoder().encode(text).length>MAX_BYTES)throw Error('ROAD_PACK_TOO_LARGE');}
        const data=JSON.parse(text);if(data.remark)throw Error('INCOMPLETE_ROAD_PACK');
        const next={version:1,savedAt:Date.now(),bounds,source:'© OpenStreetMap contributors · ODbL',elements:data.elements};
        const built=RoadGraph.build(next);
        const nextCatalog=OfflineCatalog.build(next);next.sha256=await digest(next);
        if(bytes(next).length>MAX_BYTES)throw Error('ROAD_PACK_TOO_LARGE');
        if(token!==generation)throw Error('DOWNLOAD_CANCELLED');
        await new Promise((resolve,reject)=>{const tx=db.transaction('packs','readwrite');tx.objectStore('packs').put(next,'local');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
        if(token!==generation)throw Error('DOWNLOAD_CANCELLED');
        pack=next;graph=built;catalog=nextCatalog;show();return graph;
    }
    async function clear(){generation++;if(db)await new Promise((resolve,reject)=>{const tx=db.transaction('packs','readwrite');tx.objectStore('packs').clear();tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});pack=graph=null;catalog=[];if(layer){layer.remove();layer=null;}show();}
    function route(start,end,options={}){
        if(!valid())return Promise.reject(Error('NO_OFFLINE_ROAD_PACK'));
        options={simpler:localStorage.getItem('solarless_offline_simpler')==='true',...options};
        return new Promise((resolve,reject)=>{
            const worker=new Worker('js/road-network-worker.js'),timer=setTimeout(()=>{worker.terminate();reject(Error('OFFLINE_ROUTING_TIMEOUT'));},10000);
            const done=()=>{clearTimeout(timer);worker.terminate();};
            worker.onmessage=e=>{done();e.data.error?reject(Error(e.data.error)):resolve(e.data.route);};worker.onerror=()=>{done();reject(Error('OFFLINE_ROUTING_FAILED'));};
            worker.postMessage({id:1,pack,start:[start.lng,start.lat],end:[end.lng,end.lat],options});
        });
    }
    function draw(map){if(!valid()){if(layer){layer.remove();layer=null;}return;}if(drawnGraph===graph&&layer)return;drawnGraph=graph;if(layer){layer.remove();layer=null;}if(!graph||!map)return;
        const seen=new Set();
        layer=L.geoJSON({type:'FeatureCollection',features:graph.edges.filter((e,i,all)=>{const key=[Math.min(e.from,e.to),Math.max(e.from,e.to),e.way].join('|');if(seen.has(key))return false;seen.add(key);return true;}).map(e=>({type:'Feature',properties:{name:e.name},geometry:{type:'LineString',coordinates:[e.a,e.b]}}))},{style:{color:'#8594a5',weight:3,opacity:.8},onEachFeature:(feature,item)=>{const label=document.createElement('span');label.textContent=feature.properties.name||localized('저장 도로','Saved road');item.bindTooltip(label);}}).addTo(map);
        for(const item of catalog.filter(i=>i.amenity).slice(0,500)){const label=document.createElement('span');label.textContent=item.displayName;L.circleMarker([item.lat,item.lng],{radius:4,color:'#fbbf24'}).bindTooltip(label).addTo(layer);}
    }
    root.RoadPack={init,save,clear,route,draw,show,search:(query,origin)=>valid()?OfflineCatalog.search(catalog,query,origin):[],along:(coordinates,kind,progress)=>valid()?OfflineCatalog.along(catalog,coordinates,kind,progress):[],get pack(){return valid()?pack:null;},get catalog(){return valid()?catalog:[];},get graph(){return valid()?graph:null;}};
})(window);
