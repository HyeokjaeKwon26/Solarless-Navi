/* Schematic of the selected route only; not inferred lanes or live lane position. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./road-network'));else root.JunctionPreview=factory(root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(roads){
    'use strict';
    function layout(model,turn,graph){
        if(!model||!turn||!Number.isFinite(turn.progressMeters))return null;
        const start=Math.max(0,turn.progressMeters-70),end=Math.min(model.total,turn.progressMeters+Math.min(220,Math.max(100,(turn.following?.distanceAfter||0)+40)));
        const points=[];
        for(let i=0;i<model.coordinates.length-1;i++){
            const a=model.cumulative[i],b=model.cumulative[i+1];if(b<=start||a>=end||b<=a)continue;
            for(const p of [Math.max(a,start),Math.min(b,end)]){const t=(p-a)/(b-a),x=model.coordinates[i],y=model.coordinates[i+1];points.push([x[0]+t*(y[0]-x[0]),x[1]+t*(y[1]-x[1])]);}
        }
        if(points.length<2)return null;
        const origin=points[0],angle=Math.atan2((points[1][0]-origin[0])*Math.cos(origin[1]*Math.PI/180),points[1][1]-origin[1]);
        const transform=p=>{const x=(p[0]-origin[0])*Math.cos(origin[1]*Math.PI/180)*111195,y=(p[1]-origin[1])*111195;return [x*Math.cos(angle)-y*Math.sin(angle),-(x*Math.sin(angle)+y*Math.cos(angle))];};
        const branches=[];let structure='';
        if(graph&&Array.isArray(turn.location)){
            const nearby=graph.nearby(turn.location),ids=new Set(nearby.flatMap(c=>[[c.edge.from,c.edge.a],[c.edge.to,c.edge.b]]).filter(([,p])=>roads.distance(p,turn.location)<=3).map(([id])=>id));
            // No geometric-crossing inference: exactly one shared OSM node is required.
            if(ids.size===1){const id=[...ids][0],idx=model.cumulative.findIndex(m=>m>=turn.progressMeters-1),heading=idx>0?roads.bearing(model.coordinates[idx-1],turn.location):null;
                const incoming=nearby.filter(c=>c.edge.to===id&&Number.isFinite(heading)&&Math.abs((c.edge.heading-heading+540)%360-180)<20).sort((a,b)=>a.distance-b.distance);
                if(incoming.length===1){const edge=incoming[0].edge;structure=edge.tunnel?'tunnel':edge.bridge?'bridge':'';
                    for(const e of graph.edges.filter(e=>e.from===id&&graph.permitted(edge,e)).slice(0,8)){
                        const length=Math.min(55,e.length),end=[e.a[0]+(e.b[0]-e.a[0])*length/e.length,e.a[1]+(e.b[1]-e.a[1])*length/e.length];
                        // Highlighted route is drawn above these mapped connections.
                        branches.push([e.a,end].map(transform));
                    }
                }
            }
        }
        const transformed=points.map(transform),all=[...transformed,...branches.flat()];
        const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
        const scale=Math.min(130/Math.max(1,maxX-minX),65/Math.max(1,maxY-minY));
        const fit=p=>[+(80+(p[0]-(minX+maxX)/2)*scale).toFixed(1),+(45+(p[1]-(minY+maxY)/2)*scale).toFixed(1)];
        return {points:transformed.map(fit),branches:branches.map(b=>b.map(fit)),structure};
    }
    return {shape:(model,turn)=>layout(model,turn)?.points||null,layout};
});
