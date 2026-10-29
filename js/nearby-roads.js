/* Local road-network evidence; never fabricate a connection across nearby roads. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./road-network'));else root.NearbyRoads=factory(root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(roads){
    'use strict';
    const snapshots=new WeakMap();
    function assess(graph,fix,snap,previous={}){
        const fallback={status:'unavailable',at:fix.timestamp,candidates:[],hold:false};
        if(!graph||!Number.isFinite(fix.accuracy)||fix.accuracy<=0||fix.accuracy>35||!Number.isFinite(fix.timestamp)||fix.timestamp>graph.pack.savedAt+7*86400000)return fallback;
        const speed=Number(fix.speedKmh)||0,heading=speed>=8?fix.heading:undefined;
        const elapsed=(fix.timestamp-previous.at)/1000;
        const continuity=elapsed>0&&elapsed<=8&&previous.packSavedAt===graph.pack.savedAt;
        const list=graph.nearby([fix.lng,fix.lat],heading).map(c=>{
            const prior=continuity?previous.candidates||[]:[];
            const connected=prior.some(p=>p.edge===c.edge.id||p.to===c.edge.from&&graph.edges[p.edge]&&graph.permitted(graph.edges[p.edge],c.edge));
            const diff=Number.isFinite(heading)?Math.abs((heading-c.edge.heading+540)%360-180):0;
            return {...c,score:c.distance+diff*.12+(prior.length&&!connected?18:0),connected};
        }).sort((a,b)=>a.score-b.score).slice(0,6);
        if(!list.length)return fallback;
        const best=list[0],other=list.find(c=>c.edge.way!==best.edge.way&&roads.distance(c.point,best.point)>5);
        const ambiguous=!!other&&other.score-best.score<Math.max(6,fix.accuracy*.6);
        const routePoint=Number.isFinite(snap.lng)&&Number.isFinite(snap.lat)?[snap.lng,snap.lat]:null;
        const separated=routePoint&&roads.distance(best.point,routePoint)>Math.max(10,fix.accuracy);
        const conflict=!!(snap.isSnapped&&separated&&best.distance+Math.max(6,fix.accuracy*.5)<snap.distMeters);
        const hold=ambiguous||conflict;
        return {status:ambiguous?'ambiguous':conflict?'conflict':'supported',hold,at:fix.timestamp,packSavedAt:graph.pack.savedAt,
            way:best.edge.way,point:best.point,connected:best.connected,
            candidates:list.map(c=>({edge:c.edge.id,to:c.edge.to,score:c.score}))};
    }
    function nativeSnapshot(graph){
        if(!graph)return null;
        if(snapshots.has(graph))return snapshots.get(graph);
        // Bounded snapshot of the saved area; route matching continues normally outside it.
        if(graph.edges.length>12000)return null;
        const byFrom=new Map();
        for(const e of graph.edges){if(!byFrom.has(e.from))byFrom.set(e.from,[]);byFrom.get(e.from).push(e);}
        // Legal successors use shared OSM nodes and the same turn restrictions
        // as foreground matching. Build once per graph, never on each GPS fix.
        const snapshot={expiresAt:graph.pack.savedAt+7*86400000,edges:graph.edges.map(e=>[...e.a,...e.b,e.heading,e.way]),
            successors:graph.edges.map(e=>(byFrom.get(e.to)||[]).filter(n=>graph.permitted(e,n)).map(n=>n.id))};
        if(snapshot.successors.reduce((n,row)=>n+row.length,0)>120000)return null;
        snapshots.set(graph,snapshot);return snapshot;
    }
    return {assess,nativeSnapshot};
});
