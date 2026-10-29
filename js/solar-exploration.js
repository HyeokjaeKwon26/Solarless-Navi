/* Reuse saved legal road connections. No graph download, no extra route quota. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./road-network'));else root.SolarExploration=factory(root.RoadGraph);})(typeof window!=='undefined'?window:globalThis,function(roads){
    'use strict';
    function select(graph,raw,risk,options={}){
        const points=raw?.geometry?.coordinates;if(!graph||!points||points.length<3||graph.edges.length>12000||Date.now()-graph.pack.savedAt>7*86400000)return [];
        const stride=Math.max(1,Math.ceil((points.length-1)/96)),samples=[],future=new Map(),adj=new Map();
        for(const e of graph.edges){if(!adj.has(e.from))adj.set(e.from,[]);adj.get(e.from).push(e);}
        for(let i=0;i<points.length-1;i+=stride){
            const a=points[i],b=points[Math.min(points.length-1,i+stride)],heading=roads.bearing(a,b),candidate=graph.nearby(a,heading,!!options.tollFree)[0];
            if(!candidate||candidate.distance>15)continue;
            const score=Number(risk(a,b,i/(points.length-1)));if(!Number.isFinite(score))continue;
            const e=candidate.edge;samples.push({i,edge:e,score});for(const node of [e.from,e.to])if(!future.has(node))future.set(node,i);
        }
        const result=[];let work=0;
        for(const seed of samples.filter(s=>s.score>.2).sort((a,b)=>b.score-a.score).slice(0,8)){
            for(const branch of adj.get(seed.edge.to)||[]){
                if(branch.way===seed.edge.way||branch.service||options.tollFree&&branch.toll||!graph.permitted(seed.edge,branch))continue;
                const queue=[{e:branch,length:branch.length,via:branch.b}],seen=new Set();let found=null;
                for(let q=0;q<queue.length&&work++<500;q++){
                    const current=queue[q],e=current.e;if(seen.has(e.id)||current.length>1500)continue;seen.add(e.id);
                    const joined=future.get(e.to);
                    if(joined>seed.i+stride){found=current;break;}
                    for(const next of adj.get(e.to)||[])if(!next.service&&(!options.tollFree||!next.toll)&&queue.length<500&&graph.permitted(e,next)&&!seen.has(next.id))queue.push({e:next,length:current.length+next.length,via:current.length<80?next.b:current.via});
                }
                if(found&&!result.some(v=>roads.distance([v.lng,v.lat],found.via)<80))result.push({lng:found.via[0],lat:found.via[1],connectedRoad:true,score:seed.score});
                if(result.length>=4||work>=500)return result;
            }
        }return result;
    }
    return {select};
});
