(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./journey-policy'),require('./road-network'));else root.RouteComparison=factory(root.JourneyPolicy,root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(Journey,Roads){
    'use strict';
    function overlap(a,b){
        const points=a?.analyzed?.coordinates||[],other=b?.analyzed?.coordinates||[];
        if(points.length<2||other.length<2)return null;
        const segments=other.slice(1),stride=Math.max(1,Math.ceil(points.length/100));let count=0,shared=0;
        for(let i=0;i<points.length;i+=stride){count++;if(segments.some((p,j)=>Roads.projection(points[i],other[j],p).distance<25))shared++;}
        return shared/count;
    }
    function rows(routes,baseline,quality){
        return (routes||[]).slice(0,12).map(route=>({id:route.id,durationSec:route.durationSec,distanceMeters:route.distanceMeters,
            ...quality(route.raw||route),shared:overlap(route,baseline),solar:Journey.solarTradeoff(baseline,route)}));
    }
    function groups(routes){
        const map=new Map();
        for(const route of (routes||[]).slice(0,16)){
            const p=route.analyzed?.coordinates;if(!p?.length)continue;
            // Only identical rounded geometry is folded; similar roads are not
            // merged just because their durations happen to be equal.
            const key=p.map(v=>v.slice(0,2).map(n=>Number(n).toFixed(6)).join(',')).join(';');
            if(!map.has(key))map.set(key,{route,members:[]});map.get(key).members.push(route);
        }return [...map.values()];
    }
    function differences(route,baseline){
        const a=route?.analyzed?.coordinates||[],b=baseline?.analyzed?.coordinates||[],stride=Math.max(1,Math.ceil((a.length-1)/600)),otherStride=Math.max(1,Math.ceil((b.length-1)/600));
        const lines=[];for(let j=0;j<b.length-1;j+=otherStride)lines.push([b[j],b[Math.min(j+otherStride,b.length-1)]]);
        const sections=[];
        for(let i=0;i<a.length-1;i+=stride){
            const end=Math.min(i+stride,a.length-1),p=a[i],q=a[end],heading=Roads.bearing(p,q);
            const shared=[p,[(p[0]+q[0])/2,(p[1]+q[1])/2],q].every(point=>lines.some(([x,y])=>Math.abs((heading-Roads.bearing(x,y)+540)%360-180)<25&&Roads.projection(point,x,y).distance<25));
            const last=sections.at(-1);if(last&&last.shared===shared)last.coordinates.push(...a.slice(i+1,end+1));else sections.push({shared,coordinates:a.slice(i,end+1)});
        }return sections;
    }
    return {overlap,rows,groups,differences};
});
