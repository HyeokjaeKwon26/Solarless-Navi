(function(root){
    'use strict';
    let graph=null,pack=null,db=null,layer=null, drawnGraph=null, lastDownload=0;
    const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const status=text=>{const el=document.getElementById('road-pack-status');if(el)el.textContent=text;};
    const localized=(ko,en)=>root.I18n?.getLanguage().startsWith('ko')?ko:en;
    function show(){status(pack?localized(`OSM 도로 저장됨 · ${new Date(pack.savedAt).toLocaleString()} · 7일 유효`,`Saved OSM roads · ${new Date(pack.savedAt).toLocaleString()} · valid 7 days`):localized('저장된 도로 없음','No offline road pack'));}
    async function init(){
        const r=indexedDB.open('solarless-road-pack',1);r.onupgradeneeded=()=>r.result.createObjectStore('packs');db=await req(r);
        const saved=await req(db.transaction('packs').objectStore('packs').get('local'));
        if(saved){try{graph=RoadGraph.build(saved);pack=saved;}catch(e){status(localized('도로 자료 만료 · 다시 저장하세요','Road pack expired. Save it again.'));return;}}show();
    }
    async function save(center){
        if(!db)throw Error('STORAGE_UNAVAILABLE');
        if(!Number.isFinite(center?.lat)||!Number.isFinite(center?.lng)||Math.abs(center.lat)>75)throw Error('LOCATION_UNAVAILABLE');
        if (Date.now()-lastDownload<60000) throw Error('DOWNLOAD_COOLDOWN');
        lastDownload=Date.now();
        status(localized('주변 도로 다운로드 중…','Downloading roads…'));
        const lat=.014,lng=.014/Math.cos(center.lat*Math.PI/180),bounds=[center.lat-lat,center.lng-lng,center.lat+lat,center.lng+lng];
        // Ways, their nodes, and all turn restrictions involving those ways. No map tiles are downloaded.
        const query=`[out:json][timeout:25];way[highway](${bounds.join(',')})->.roads;(.roads;rel(bw.roads)[type~"^restriction"];);(._;>;);out body;`;
        const response=await fetch('https://overpass.private.coffee/api/interpreter',{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(30000)});
        if(!response.ok)throw Error('ROAD_DOWNLOAD_FAILED');const text=await response.text();if(text.length>12000000)throw Error('ROAD_PACK_TOO_LARGE');
        const data=JSON.parse(text);if(data.remark)throw Error('INCOMPLETE_ROAD_PACK');
        const next={version:1,savedAt:Date.now(),bounds,source:'© OpenStreetMap contributors · ODbL',elements:data.elements};
        const built=RoadGraph.build(next);
        await new Promise((resolve,reject)=>{const tx=db.transaction('packs','readwrite');tx.objectStore('packs').put(next,'local');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
        pack=next;graph=built;show();return graph;
    }
    async function clear(){if(db)await req(db.transaction('packs','readwrite').objectStore('packs').clear());pack=graph=null;if(layer){layer.remove();layer=null;}show();}
    function route(start,end,options={}){
        if(!pack)return Promise.reject(Error('NO_OFFLINE_ROAD_PACK'));
        return new Promise((resolve,reject)=>{
            const worker=new Worker('js/road-network-worker.js'),timer=setTimeout(()=>{worker.terminate();reject(Error('OFFLINE_ROUTING_TIMEOUT'));},10000);
            const done=()=>{clearTimeout(timer);worker.terminate();};
            worker.onmessage=e=>{done();e.data.error?reject(Error(e.data.error)):resolve(e.data.route);};worker.onerror=()=>{done();reject(Error('OFFLINE_ROUTING_FAILED'));};
            worker.postMessage({id:1,pack,start:[start.lng,start.lat],end:[end.lng,end.lat],options});
        });
    }
    function draw(map){if(drawnGraph===graph&&layer)return;drawnGraph=graph;if(layer){layer.remove();layer=null;}if(!graph||!map)return;
        const seen=new Set();
        layer=L.geoJSON({type:'FeatureCollection',features:graph.edges.filter((e,i,all)=>{const key=[Math.min(e.from,e.to),Math.max(e.from,e.to),e.way].join('|');if(seen.has(key))return false;seen.add(key);return true;}).map(e=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[e.a,e.b]}}))},{style:{color:'#8594a5',weight:2,opacity:.65},interactive:false}).addTo(map);
    }
    root.RoadPack={init,save,clear,route,draw,get graph(){return pack&&Date.now()-pack.savedAt<=7*86400000?graph:null;}};
})(window);
