(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TripTools=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const KEY='solarless_stop_plan';
    const point=p=>p&&Number.isFinite(p.coords?.lat)&&Number.isFinite(p.coords?.lng)&&Math.abs(p.coords.lat)<=85&&Math.abs(p.coords.lng)<=180&&typeof p.name==='string'&&p.name.length<=300;
    const same=(a,b)=>!!(a&&b&&Math.abs(a.lat-b.lat)<.00001&&Math.abs(a.lng-b.lng)<.00001);
    function valid(plan,now=Date.now()){return !!(plan&&point(plan.current)&&Array.isArray(plan.pending)&&plan.pending.length<=3&&plan.pending.every(point)&&Number.isFinite(plan.savedAt)&&now>=plan.savedAt&&now-plan.savedAt<12*3600000);}
    function get(){try{const p=JSON.parse(localStorage.getItem(KEY));return valid(p)?p:null;}catch{return null;}}
    function set(plan){if(!valid(plan))throw Error('INVALID_TRIP');localStorage.setItem(KEY,JSON.stringify(plan));return plan;}
    function insert(current,stop,previous,now=Date.now()){
        if(!point(current)||!point(stop)||same(current.coords,stop.coords))throw Error('INVALID_STOP');
        const pending=[current,...(valid(previous,now)&&same(previous.current.coords,current.coords)?previous.pending:[])];
        if(pending.length>3||pending.some(p=>same(p.coords,stop.coords)))throw Error('STOP_LIMIT_OR_DUPLICATE');
        return {savedAt:now,current:stop,pending};
    }
    function corridor(coordinates,progress=0){
        const out=[];let at=0,next=progress;
        for(let i=1;i<coordinates.length&&out.length<6;i++){
            const a=coordinates[i-1],b=coordinates[i],length=Math.hypot((b[0]-a[0])*Math.cos((a[1]+b[1])*Math.PI/360),b[1]-a[1])*111195;
            while(length>0&&next<=at+length&&out.length<6){if(next>=at){const t=(next-at)/length;out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}next+=2000;}
            at+=length;
        }
        return out;
    }
    return {get,set,insert,valid,same,corridor,clear:()=>localStorage.removeItem(KEY)};
});
