/* On-demand map resources only: no area download or speculative prefetch. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.MapCache=api;})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const MAX_BYTES=32*1024*1024,MAX_ENTRIES=1500,MAX_ITEM=2*1024*1024,MAX_AGE=7*86400000;
    let dbPromise,disabled=false,generation=0,active=0,pendingWrites=0,offline=false,storageFailed=false,installed=false;const queue=[];
    function allowed(url){try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['tiles.openfreemap.org','tiles.mapterhorn.com'].includes(u.hostname);}catch{return false;}}
    function native(){return root.Capacitor?.isNativePlatform?.()===true;}
    const byteLimit=()=>root.StorageBudget?.limit('map')||MAX_BYTES;
    function setOffline(value){if(offline===value)return;offline=value;root.dispatchEvent?.(new Event('map-cache-status'));}
    function enabled(){return native()&&!disabled&&(root.MapDetailSettings?.get()||root.NavigationMap?.settings(root.localStorage))?.cache!==false;}
    function expiry(headers,now){
        const control=headers.get('cache-control')||'';if(/no-store|private|no-cache/i.test(control))return null;
        const age=Number(headers.get('age'))||0,match=control.match(/(?:^|,)\s*max-age=(\d+)/i);
        const fresh=match?Math.max(0,Number(match[1])-age)*1000:3600000;
        const freshUntil=now+Math.min(MAX_AGE,fresh);
        return {freshUntil,expires:/must-revalidate/i.test(control)?freshUntil:now+MAX_AGE};
    }
    function eviction(rows,newKey,newSize,maxBytes=MAX_BYTES,maxEntries=MAX_ENTRIES,now=Date.now()){
        const kept=rows.filter(r=>r.key!==newKey),remove=kept.filter(r=>r.expires<=now).map(r=>r.key),live=kept.filter(r=>r.expires>now).sort((a,b)=>a.used-b.used);
        let size=live.reduce((n,r)=>n+r.size,0)+newSize,count=live.length+1;
        while((size>maxBytes||count>maxEntries)&&live.length){const row=live.shift();remove.push(row.key);size-=row.size;count--;}
        return remove;
    }
    function database(){
        if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
            if(!root.indexedDB){reject(Error('CACHE_UNAVAILABLE'));return;}
            let settled=false;const timer=setTimeout(()=>{settled=true;reject(Error('CACHE_OPEN_TIMEOUT'));},2000);
            const req=root.indexedDB.open('solarless-map-cache-v1',1);
            req.onupgradeneeded=()=>{req.result.createObjectStore('meta',{keyPath:'key'});req.result.createObjectStore('data');};
            req.onsuccess=()=>{if(settled){req.result.close();return;}settled=true;clearTimeout(timer);req.result.onversionchange=()=>req.result.close();resolve(req.result);};req.onerror=()=>{settled=true;clearTimeout(timer);reject(req.error);};
        }).catch(error=>{storageFailed=true;throw error;});return dbPromise;
    }
    async function read(key){
        try{const db=await database();return await new Promise((resolve,reject)=>{
            const tx=db.transaction(['meta','data'],'readwrite'),meta=tx.objectStore('meta'),r=meta.get(key);let result=null;
            const timer=setTimeout(()=>{try{tx.abort();}catch{}resolve(null);},500);
            r.onsuccess=()=>{try{const row=r.result;if(!row)return;if(row.expires<=Date.now()){if(!root.StorageBudget?.protected()){meta.delete(key);tx.objectStore('data').delete(key);}return;}
                const body=tx.objectStore('data').get(key);body.onsuccess=()=>{try{if(body.result){result={...row,body:body.result};meta.put({...row,used:Date.now()});}}catch{tx.abort();}};}catch{tx.abort();}};
            tx.oncomplete=()=>{clearTimeout(timer);resolve(result);};tx.onerror=tx.onabort=()=>{clearTimeout(timer);reject(tx.error);};
        });}catch{storageFailed=true;return null;}
    }
    async function write(key,body,times,token){
        if(!times||body.byteLength>MAX_ITEM||!body.byteLength||token!==generation||!enabled()||pendingWrites>=4)return;
        // MapLibre transfers/detaches the returned buffer in its worker. Copy
        // synchronously before awaiting IDB; at most four bounded copies exist.
        body=body.slice(0);pendingWrites++;
        try{const db=await database();if(token!==generation||!enabled())return;await new Promise((resolve,reject)=>{
            const tx=db.transaction(['meta','data'],'readwrite'),meta=tx.objectStore('meta'),data=tx.objectStore('data'),r=meta.getAll();
            r.onsuccess=()=>{try{const removes=eviction(r.result,key,body.byteLength,byteLimit());if(body.byteLength>byteLimit()||root.StorageBudget?.protected()&&removes.length)return;for(const k of removes){meta.delete(k);data.delete(k);}meta.put({key,size:body.byteLength,used:Date.now(),...times});data.put(body,key);}catch{tx.abort();}};
            tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
        });}catch{storageFailed=true;}finally{pendingWrites--;}
    }
    function slot(signal){return new Promise((resolve,reject)=>{
        const abort=()=>{const i=queue.indexOf(job);if(i>=0)queue.splice(i,1);reject(new DOMException('Aborted','AbortError'));};
        const job=()=>{signal?.removeEventListener('abort',abort);if(signal?.aborted){abort();return;}active++;resolve(()=>{active--;queue.shift()?.();});};
        if(signal?.aborted){abort();return;}if(active<4)job();else{queue.push(job);signal?.addEventListener('abort',abort,{once:true});}
    });}
    async function resource(url,signal){
        if(!allowed(url))throw Error('MAP_RESOURCE_NOT_ALLOWED');const token=generation,use=enabled(),cached=use?await read(url):null;
        if(signal?.aborted)throw new DOMException('Aborted','AbortError');
        if(cached&&(cached.freshUntil>Date.now()||root.navigator?.onLine===false)){if(root.navigator?.onLine===false)setOffline(true);return cached.body;}
        const release=await slot(signal),controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
        const timer=setTimeout(abort,8000);
        try{
            // Both allowlisted providers support CORS. Use WebView fetch directly
            // so AbortController cancels the actual tile transfer, not a native proxy.
            const fetcher=root.CapacitorWebFetch||root.fetch;
            if(signal?.aborted)abort();const response=await fetcher.call(root,url,{signal:controller.signal,credentials:'omit'});
            if(!response.ok){const error=Error('MAP_HTTP_'+response.status);error.status=response.status;throw error;}
            const body=await response.arrayBuffer();if(signal?.aborted)throw new DOMException('Aborted','AbortError');setOffline(false);
            if(use)void write(url,body,expiry(response.headers,Date.now()),token);return body;
        }catch(error){
            if(signal?.aborted)throw error;
            if(cached&&cached.expires>Date.now()&&(!error.status||error.status>=500||error.status===429)){setOffline(true);return cached.body;}
            throw error;
        }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);release();}
    }
    function configure(gl){
        if(installed||!gl?.addProtocol)return;installed=true;
        gl.addProtocol('solarless-map',async(params,controller)=>{
            const url=decodeURIComponent(params.url.slice('solarless-map://'.length)),body=await resource(url,controller.signal);
            return {data:params.type==='json'?JSON.parse(new TextDecoder().decode(body)):params.type==='string'?new TextDecoder().decode(body):body};
        });
    }
    function transformRequest(url){return {url:installed&&enabled()&&allowed(url)?'solarless-map://'+encodeURIComponent(url):url};}
    async function stats(){try{const db=await database();return await new Promise((resolve,reject)=>{const r=db.transaction('meta').objectStore('meta').getAll();r.onsuccess=()=>resolve({bytes:r.result.reduce((n,x)=>n+x.size,0),count:r.result.length,maxBytes:byteLimit(),offline,storageFailed,native:native()});r.onerror=()=>reject(r.error);});}catch{return {bytes:0,count:0,maxBytes:byteLimit(),offline,storageFailed:true,native:native()};}}
    async function trim(){if(root.StorageBudget?.protected())return false;const db=await database();await new Promise((resolve,reject)=>{const tx=db.transaction(['meta','data'],'readwrite'),r=tx.objectStore('meta').getAll();r.onsuccess=()=>{if(root.StorageBudget?.protected())return;for(const key of eviction(r.result,'',0,byteLimit())){tx.objectStore('meta').delete(key);tx.objectStore('data').delete(key);}};tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});return true;}
    async function clear(){if(root.StorageBudget?.protected())return false;generation++;try{const db=await database();if(root.StorageBudget?.protected())return false;await new Promise((resolve,reject)=>{const tx=db.transaction(['meta','data'],'readwrite');tx.objectStore('meta').clear();tx.objectStore('data').clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});setOffline(false);storageFailed=false;return true;}catch{return false;}}
    return {MAX_BYTES,MAX_ENTRIES,MAX_AGE,allowed,expiry,eviction,configure,transformRequest,resource,stats,clear,trim,enabled,setDisabled(value){disabled=!!value;generation++;},status:()=>({offline,storageFailed})};
});
