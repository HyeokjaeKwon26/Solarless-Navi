/* Per-service bounded backoff. No automatic retries, endpoint scraping or GPS delay. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ServiceHealth=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    function create(clock=()=>Date.now()){
        const states=new Map();
        function check(key){const s=states.get(key);if(s&&clock()<s.until){const e=Error('SERVICE_COOLDOWN');e.code='SERVICE_COOLDOWN';e.retryAfterMs=s.until-clock();e.service=key;throw e;}}
        function failure(key,status,retryAfter){
            if(status!==429&&status<500&&status!==0)return;
            const old=states.get(key),count=Math.min(6,(old?.count||0)+1);
            const n=Number(retryAfter),date=Date.parse(retryAfter);
            const requested=retryAfter!=null&&String(retryAfter).trim()!==''?(Number.isFinite(n)?n*1000:Number.isFinite(date)?date-clock():0):0;
            const delay=status===429?Math.max(30000,Math.min(300000,requested)):count>=2?Math.min(60000,2000*2**(count-2)):0;
            states.set(key,{count,until:clock()+delay,status});
        }
        function success(key){states.delete(key);}
        async function run(key,operation){check(key);try{const response=await operation();if(response.ok)success(key);else failure(key,response.status,response.headers?.get?.('retry-after'));return response;}catch(e){if(e?.name!=='AbortError'&&e?.code!=='SERVICE_COOLDOWN')failure(key,0);throw e;}}
        return {check,failure,success,run,status:key=>({...states.get(key),remainingMs:Math.max(0,(states.get(key)?.until||0)-clock())})};
    }
    const shared=create();
    return {create,shared};
});
