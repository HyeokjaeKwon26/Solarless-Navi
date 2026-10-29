/* User-confirmed arrival pins only; never silently replace a search result. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EntranceMemory=api;})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const KEY='solarless_confirmed_entrances',TTL=180*86400000;
    const valid=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=85&&Math.abs(p.lng)<=180;
    const name=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim().slice(0,500);
    const distance=(a,b)=>Math.hypot((a.lng-b.lng)*Math.cos((a.lat+b.lat)*Math.PI/360),a.lat-b.lat)*111320;
    function read(storage,now=Date.now()){
        try{const rows=JSON.parse(storage.getItem(KEY)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&valid(r.anchor)&&valid(r.pin)&&typeof r.name==='string'&&Number.isFinite(r.at)&&now>=r.at&&now-r.at<TTL&&distance(r.anchor,r.pin)<=500).slice(-50):[];}catch{return [];}
    }
    function find(storage,title,anchor,now=Date.now()){
        if(!valid(anchor)||!name(title))return null;
        return read(storage,now).reverse().find(r=>r.name===name(title)&&distance(r.anchor,anchor)<100)||null;
    }
    function save(storage,title,anchor,pin,now=Date.now()){
        if(!valid(anchor)||!valid(pin)||!name(title)||pin.entranceConfirmed!==true||distance(anchor,pin)>500)return false;
        const rows=read(storage,now).filter(r=>!(r.name===name(title)&&distance(r.anchor,anchor)<100));
        rows.push({name:name(title),anchor:{lat:anchor.lat,lng:anchor.lng},pin:{lat:pin.lat,lng:pin.lng},at:now});
        try{storage.setItem(KEY,JSON.stringify(rows.slice(-50)));return true;}catch{return false;}
    }
    function clear(storage){try{storage.removeItem(KEY);return true;}catch{return false;}}
    return {find,save,read,clear};
});
