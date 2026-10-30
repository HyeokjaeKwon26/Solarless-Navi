(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./road-network'));else root.JourneyPreparation=factory(root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(roads){
    'use strict';
    const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=75;
    function samples(coords,spacing=100){
        if(!Array.isArray(coords)||coords.length<2||coords.length>50000||!coords.every(valid))throw Error('INVALID_ROUTE');
        let total=0,next=0;const points=[];
        for(let i=1;i<coords.length;i++){const a=coords[i-1],b=coords[i],length=roads.distance(a,b);if(length>10000)throw Error('INVALID_ROUTE');
            while(next<=total+length&&length>0){if(points.length>=2000)throw Error('ROUTE_TOO_LONG');const t=(next-total)/length;points.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);next+=spacing;}total+=length;}
        points.push(coords.at(-1));return {points,total};
    }
    function corridor(coords){const {points,total}=samples(coords,500);if(total>12000)throw Error('CORRIDOR_LIMIT');
        const boxes=points.map(([lng,lat])=>{const dy=350/111195,dx=dy/Math.cos(lat*Math.PI/180);if(lng-dx< -180||lng+dx>180)throw Error('INVALID_ROUTE');return [lat-dy,lng-dx,lat+dy,lng+dx];});
        return {boxes,bounds:[Math.min(...boxes.map(b=>b[0])),Math.min(...boxes.map(b=>b[1])),Math.max(...boxes.map(b=>b[2])),Math.max(...boxes.map(b=>b[3]))],total};
    }
    function coverage(coords,graph){const {points,total}=samples(coords);let covered=0,missing=[];
        points.forEach((p,i)=>{if(graph?.nearby(p).length)covered++;else if(missing.length<12)missing.push(Math.round(Math.min(total,i*100)));});
        return {samples:points.length,covered,missing,ratio:covered/points.length,total};
    }
    function savedRoute(saved,start,end,options={},now=Date.now()){
        if(!saved||!Number.isFinite(saved.at)||!valid(saved.destination)||now<saved.at||now-saved.at>86400000||options.tollFree&&!saved.avoidTolls)return null;
        const raw=saved.raw,coords=raw?.geometry?.coordinates;if(!Array.isArray(coords)||coords.length<2||coords.length>50000||!coords.every(valid)||!Number.isFinite(raw.duration)||raw.duration<=0||!Number.isFinite(raw.distance)||raw.distance<=0||!raw.legs?.[0]?.steps?.length)return null;
        if(roads.distance([start.lng,start.lat],coords[0])>15||roads.distance([end.lng,end.lat],saved.destination)>5)return null;
        if(Number.isFinite(options.heading)&&Math.abs((options.heading-roads.bearing(coords[0],coords[1])+540)%360-180)>60)return null;
        return {...raw,traffic:null,offline:true,preparedJourney:true};
    }
    return {samples,corridor,coverage,savedRoute};
});
