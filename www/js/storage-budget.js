/* Partitioned payload budget. No polling; never evict a live/planning session. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.StorageBudget=api;})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';const MiB=1048576;let busy=()=>false;
    function configuration(value){const total=[160,240,400].includes(Number(value))?Number(value):400,map=total===160?20:32;return {total:total*MiB,map:map*MiB,scene:(total-100-map-12)*MiB,roads:12*MiB,reserve:100*MiB};}
    let config;try{config=configuration(root.localStorage?.getItem('solarless_storage_budget'));}catch{config=configuration();}
    function protectedNow(){return !!busy();}
    function plan(rows,incoming,limit,protectedData=false,maxEntries=4096){
        const replaced=new Set(incoming.map(r=>r.key)),kept=rows.filter(r=>!replaced.has(r.key));let bytes=kept.reduce((n,r)=>n+r.bytes,0)+incoming.reduce((n,r)=>n+r.bytes,0);const remove=[];
        if([...rows,...incoming].some(r=>!Number.isFinite(r.bytes)||r.bytes<0)||incoming.length>maxEntries||incoming.reduce((n,r)=>n+r.bytes,0)>limit)return {admit:false,remove:[]};
        if(protectedData&&(bytes>limit||kept.length+incoming.length>maxEntries))return {admit:false,remove:[]};
        for(const row of kept.sort((a,b)=>a.used-b.used)){if(bytes<=limit&&kept.length+incoming.length-remove.length<=maxEntries)break;remove.push(row.key);bytes-=row.bytes;}
        return {admit:bytes<=limit,remove};
    }
    async function set(value){if(protectedNow())throw Error('STORAGE_IN_USE');const next=configuration(value);root.localStorage.setItem('solarless_storage_budget',String(next.total/MiB));config=next;await trim();return config;}
    async function trim(){if(protectedNow())return false;await Promise.all([root.MapCache?.trim?.(),root.SceneShadow?.trimStorage?.()]);return true;}
    async function stats(){const results=await Promise.allSettled([root.MapCache?.stats?.(),root.SceneShadow?.storageStats?.(),root.RoadPack?.storageStats?.(),root.DriveArchive?.storageStats?.()]);
        const names=['map','scene','roads','recordings'],items=results.map((r,i)=>({name:names[i],...(r.status==='fulfilled'&&r.value?r.value:{bytes:null,unavailable:true})}));
        let preferences=0;try{for(let i=0;i<root.localStorage.length;i++){const k=root.localStorage.key(i);preferences+=new TextEncoder().encode(k+(root.localStorage.getItem(k)||'')).byteLength;}}catch{}
        return {items,preferences,total:items.reduce((n,r)=>n+(Number.isFinite(r.bytes)?r.bytes:0),preferences),incomplete:items.some(r=>!Number.isFinite(r.bytes)||r.unknown||r.storageFailed),limit:config.total,protected:protectedNow()};
    }
    async function clear(kind){if(protectedNow())throw Error('STORAGE_IN_USE');const f={map:()=>root.MapCache.clear(),scene:()=>root.SceneShadow.clearStorage(),roads:()=>root.RoadPack.clear(),recordings:()=>root.DriveArchive.clear()}[kind];if(!f)throw Error('UNKNOWN_STORAGE');const result=await f();if(result===false)throw Error('STORAGE_FAILED');}
    return {configuration,plan,set,trim,stats,clear,protected:protectedNow,limit:kind=>config[kind],init:fn=>{busy=fn||busy;void trim().catch(()=>{});}};
});
