(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./road-network'));else root.OfflineCatalog=factory(root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(Roads){
    'use strict';
    const aliases={st:'street',rd:'road',ave:'avenue',blvd:'boulevard',ln:'lane',dr:'drive',ct:'court'};
    const normalize=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).map(w=>aliases[w]||w).join(' ');
    function build(pack){
        const nodes=new Map(pack.elements.filter(e=>e.type==='node').map(e=>[e.id,[e.lon,e.lat]])),items=[];
        for(const e of pack.elements){
            const t=e.tags||{};if(!t.name&&!t['addr:housenumber']&&!['fuel','parking','charging_station'].includes(t.amenity))continue;
            let p=e.type==='node'?nodes.get(e.id):e.center?[e.center.lon,e.center.lat]:null;
            if(!p&&e.type==='way'){const coords=(e.nodes||[]).map(id=>nodes.get(id)).filter(Boolean);if(coords.length)p=[coords.reduce((s,p)=>s+p[0],0)/coords.length,coords.reduce((s,p)=>s+p[1],0)/coords.length];}
            if(!p||!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>85)continue;
            if(pack.bounds&&(p[1]<pack.bounds[0]||p[1]>pack.bounds[2]||p[0]<pack.bounds[1]||p[0]>pack.bounds[3]))continue;
            const address=[t['addr:housenumber'],t['addr:street']].filter(Boolean).join(' '),name=t.name||address||t.amenity;
            const displayName=[name,address!==name?address:'',t['addr:city'],t['addr:state']].filter(Boolean).join(', ');
            items.push({id:`${e.type}/${e.id}`,lat:p[1],lng:p[0],shortTitle:name,displayName,houseNumber:t['addr:housenumber']||'',road:t['addr:street']||'',amenity:t.amenity||'',source:'offline-osm',tokens:normalize(displayName)});
            if(items.length>=20000)break;
        }
        return items;
    }
    function search(items,query,origin){
        const words=normalize(query).split(' ').filter(Boolean),house=/^\d+[a-z]?$/.test(words[0]||'')?words[0]:null;
        if(!words.length)return [];
        return items.filter(item=>{
            if(house){
                if(normalize(item.houseNumber)!==house)return false;
                const street=normalize(item.road).split(' ').filter(Boolean);
                if(!street.length||words.length<=street.length||!street.every((word,index)=>words[index+1]===word))return false;
            }
            return words.every(word=>item.tokens.split(' ').some(token=>token===word||(!house&&token.startsWith(word))));
        }).map(item=>({...item,distKm:origin&&Number.isFinite(origin.lat)&&Number.isFinite(origin.lng)?Roads.distance([origin.lng,origin.lat],[item.lng,item.lat])/1000:null}))
            .sort((a,b)=>(a.distKm??0)-(b.distKm??0)).slice(0,7);
    }
    function along(items,coordinates,kind,progress=0){
        if(!Array.isArray(coordinates)||coordinates.length<2)return [];
        const candidates=[];
        for(const item of items.filter(i=>i.amenity===kind)){
            let at=0,best=null;
            for(let i=1;i<coordinates.length;i++){
                const length=Roads.distance(coordinates[i-1],coordinates[i]);
                if(at+length>=progress){const p=Roads.projection([item.lng,item.lat],coordinates[i-1],coordinates[i]);const location=at+p.t*length;
                    if(location>=progress&&(!best||p.distance<best.distance))best={distance:p.distance,progress:location};}
                at+=length;
            }
            if(best&&best.distance<=750&&best.progress-progress<=10000)candidates.push({...item,corridorMeters:best.distance,aheadMeters:best.progress-progress});
        }
        return candidates.sort((a,b)=>a.aheadMeters-b.aheadMeters||a.corridorMeters-b.corridorMeters).slice(0,8);
    }
    return {build,search,along,normalize};
});
