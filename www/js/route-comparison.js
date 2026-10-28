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
    return {overlap,rows};
});
