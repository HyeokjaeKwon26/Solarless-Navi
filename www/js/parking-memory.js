(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./road-network'));else root.ParkingMemory=factory(root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(roads){
    'use strict';const KEY='solarless_parked_location';
    const point=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=85&&Math.abs(p.lng)<=180;
    function save(storage,fix,destination,name,now=Date.now()){
        if(!point(fix)||!point(destination)||!Number.isFinite(fix.timestamp)||now<fix.timestamp||now-fix.timestamp>15000||!Number.isFinite(fix.accuracy)||fix.accuracy<=0||fix.accuracy>25||fix.stationaryConfirmed!==true||(fix.speed!=null&&(!Number.isFinite(fix.speed)||fix.speed>3.5||fix.speed<0)))throw Error('RELIABLE_STOP_REQUIRED');
        const value={at:now,parked:{lat:fix.lat,lng:fix.lng},destination:{lat:destination.lat,lng:destination.lng},name:String(name||'').slice(0,300),accuracy:fix.accuracy};storage.setItem(KEY,JSON.stringify(value));return value;
    }
    function get(storage,now=Date.now()){try{const s=storage.getItem(KEY);if(!s||s.length>4096)return null;const v=JSON.parse(s);return point(v.parked)&&point(v.destination)&&Number.isFinite(v.at)&&v.at<=now&&now-v.at<=30*86400000?v:null;}catch{return null;}}
    function summary(value){const a=[value.parked.lng,value.parked.lat],b=[value.destination.lng,value.destination.lat];return {distance:roads.distance(a,b),bearing:roads.bearing(a,b)};}
    return {KEY,save,get,summary,clear:storage=>storage.removeItem(KEY)};
});
