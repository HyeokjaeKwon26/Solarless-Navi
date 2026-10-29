/* Schematic of the selected route only; not inferred lanes or live lane position. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JunctionPreview=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    function shape(model,turn){
        if(!model||!turn||!Number.isFinite(turn.progressMeters))return null;
        const start=Math.max(0,turn.progressMeters-70),end=Math.min(model.total,turn.progressMeters+Math.min(220,Math.max(100,(turn.following?.distanceAfter||0)+40)));
        const points=[];
        for(let i=0;i<model.coordinates.length-1;i++){
            const a=model.cumulative[i],b=model.cumulative[i+1];if(b<=start||a>=end||b<=a)continue;
            for(const p of [Math.max(a,start),Math.min(b,end)]){const t=(p-a)/(b-a),x=model.coordinates[i],y=model.coordinates[i+1];points.push([x[0]+t*(y[0]-x[0]),x[1]+t*(y[1]-x[1])]);}
        }
        if(points.length<2)return null;
        const origin=points[0],angle=Math.atan2((points[1][0]-origin[0])*Math.cos(origin[1]*Math.PI/180),points[1][1]-origin[1]);
        const transformed=points.map(p=>{const x=(p[0]-origin[0])*Math.cos(origin[1]*Math.PI/180)*111195,y=(p[1]-origin[1])*111195;return [x*Math.cos(angle)-y*Math.sin(angle),-(x*Math.sin(angle)+y*Math.cos(angle))];});
        const xs=transformed.map(p=>p[0]),ys=transformed.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
        const scale=Math.min(130/Math.max(1,maxX-minX),65/Math.max(1,maxY-minY));
        return transformed.map(p=>[+(80+(p[0]-(minX+maxX)/2)*scale).toFixed(1),+(45+(p[1]-(minY+maxY)/2)*scale).toFixed(1)]);
    }
    return {shape};
});
