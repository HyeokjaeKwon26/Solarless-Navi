/* Conservative OSM motorcar routing. Connections require shared OSM node IDs. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoadGraph=factory();})(typeof self!=='undefined'?self:globalThis,function(){
    'use strict';
    const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
    const distance=(a,b)=>Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111195;
    const bearing=(a,b)=>(Math.atan2((b[0]-a[0])*Math.cos((a[1]+b[1])*Math.PI/360),b[1]-a[1])*180/Math.PI+360)%360;
    function projection(p,a,b){const c=Math.cos(p[1]*Math.PI/180),x=(b[0]-a[0])*c,y=b[1]-a[1];const t=Math.max(0,Math.min(1,((p[0]-a[0])*c*x+(p[1]-a[1])*y)/(x*x+y*y||1)));const point=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];return {t,point,distance:distance(p,point)};}
    class Heap {
        constructor(){this.items=[];}
        push(value){const a=this.items;let i=a.length;a.push(value);while(i){const p=(i-1)>>1;if(a[p].cost<=value.cost)break;a[i]=a[p];i=p;}a[i]=value;}
        pop(){const a=this.items,first=a[0],v=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let c=i*2+1;if(c+1<a.length&&a[c+1].cost<a[c].cost)c++;if(a[c].cost>=v.cost)break;a[i]=a[c];i=c;}a[i]=v;}return first;}
    }
    function build(pack,now=Date.now()){
        if(!pack||pack.version!==1||!Array.isArray(pack.elements)||pack.elements.length>80000||!Number.isFinite(pack.savedAt)||now-pack.savedAt>7*86400000||pack.savedAt>now+60000)throw Error('ROAD_PACK_EXPIRED_OR_INVALID');
        const nodes=new Map(),blocked=new Set(),ways=[],rules=[];
        const allowed=/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service)(?:_link)?$/;
        for(const e of pack.elements){
            if(e.type==='node'&&valid([e.lon,e.lat])){nodes.set(e.id,[e.lon,e.lat]);if(e.tags?.barrier&&!['no','entrance','cattle_grid','toll_booth'].includes(e.tags.barrier)||e.tags?.access&&e.tags.access!=='yes'||e.tags?.motorcar==='no'||e.tags?.motor_vehicle==='no')blocked.add(e.id);}
            if(e.type==='way')ways.push(e);
        }
        const excludedWays=new Set();
        for(const e of pack.elements.filter(e=>e.type==='relation'&&String(e.tags?.type).startsWith('restriction'))){
            const from=(e.members||[]).filter(m=>m.role==='from'&&m.type==='way'),to=(e.members||[]).filter(m=>m.role==='to'&&m.type==='way'),via=(e.members||[]).filter(m=>m.role==='via');
            const kind=e.tags['restriction:motorcar']||e.tags['restriction:motor_vehicle']||e.tags.restriction;
            const conditional=Object.keys(e.tags).some(k=>k.includes('conditional'));
            if(conditional||from.length!==1||to.length!==1||via.length!==1||via[0].type!=='node'||!String(kind).match(/^(no|only)_/)){
                for(const m of e.members||[])if(m.type==='way')excludedWays.add(m.ref);
            }else rules.push({from:from[0].ref,to:to[0].ref,via:via[0].ref,kind});
        }
        const edges=[],adj=new Map(),grid=new Map();
        function add(from,to,way,tags){
            if(blocked.has(from)||blocked.has(to)||!nodes.has(from)||!nodes.has(to))return;
            const a=nodes.get(from),b=nodes.get(to),length=distance(a,b);if(length<=0||length>3000)return;
            const parsed=Number.parseFloat(tags.maxspeed),speed=Number.isFinite(parsed)?Math.min(110,Math.max(5,parsed*(String(tags.maxspeed).includes('mph')?1.609344:1))):/motorway|trunk/.test(tags.highway)?70:/primary|secondary/.test(tags.highway)?45:25;
            const edge={id:edges.length,from,to,way,a,b,length,seconds:length/(speed/3.6),name:tags.name||tags.ref||'',ref:tags.ref||'',toll:tags.toll==='yes',heading:bearing(a,b)};
            edges.push(edge);if(!adj.has(from))adj.set(from,[]);adj.get(from).push(edge);
            const minX=Math.floor(Math.min(a[0],b[0])*1000),maxX=Math.floor(Math.max(a[0],b[0])*1000),minY=Math.floor(Math.min(a[1],b[1])*1000),maxY=Math.floor(Math.max(a[1],b[1])*1000);
            for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(edge);}
        }
        for(const way of ways){
            const t=way.tags||{},access=t.motorcar||t.motor_vehicle||t.vehicle||t.access;
            if(excludedWays.has(way.id)||!allowed.test(t.highway||'')||access&&!['yes','permissive','designated'].includes(access)||Object.keys(t).some(k=>k.includes('conditional'))||!Array.isArray(way.nodes))continue;
            const oneway=t['oneway:motorcar']||t['oneway:motor_vehicle']||t.oneway;
            if(oneway&&!['yes','1','true','no','0','false','-1'].includes(oneway))continue;
            const forward=oneway!=='-1',backward=['no','0','false'].includes(oneway)||!oneway&&t.junction!=='roundabout'&&t.highway!=='motorway'||oneway==='-1';
            for(let i=1;i<way.nodes.length;i++){if(forward)add(way.nodes[i-1],way.nodes[i],way.id,t);if(backward)add(way.nodes[i],way.nodes[i-1],way.id,t);}
        }
        if(!edges.length)throw Error('ROAD_PACK_EMPTY');
        function nearby(point,heading,tollFree=false){
            if(!valid(point))return [];
            const candidates=[],seen=new Set(),x=Math.floor(point[0]*1000),y=Math.floor(point[1]*1000);
            for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const edge of grid.get((x+dx)+','+(y+dy))||[]){
                if(seen.has(edge.id)||tollFree&&edge.toll)continue;seen.add(edge.id);
                if(Number.isFinite(heading)&&Math.abs((heading-edge.heading+540)%360-180)>65)continue;
                const p=projection(point,edge.a,edge.b);if(p.distance<=25)candidates.push({...p,edge});
            }
            return candidates.sort((a,b)=>a.distance-b.distance);
        }
        function snap(point,heading,tollFree){
            const list=nearby(point,heading,tollFree),best=list[0];if(!best)throw Error('OUTSIDE_ROAD_PACK');
            if(list.some(c=>c.distance-best.distance<5&&c.edge.way!==best.edge.way&&distance(c.point,best.point)>5))throw Error('AMBIGUOUS_ROAD');
            return list.filter(c=>c.edge.way===best.edge.way&&distance(c.point,best.point)<1);
        }
        const rulesAt=new Map();for(const r of rules){const key=r.via+'|'+r.from;if(!rulesAt.has(key))rulesAt.set(key,[]);rulesAt.get(key).push(r);}
        function permitted(prev,next){
            // Avoid implicit U-turns; a new route must find a forward connection.
            if(prev.from===next.to)return false;
            return (rulesAt.get(prev.to+'|'+prev.way)||[]).every(r=>r.kind.startsWith('only_')?next.way===r.to:next.way!==r.to);
        }
        function route(start,end,options={}){
            const starts=snap(start,options.heading,options.tollFree),ends=snap(end,undefined,options.tollFree);
            const heap=new Heap(),best=new Map();let winner=null,iterations=0;
            for(const s of starts){const first={...s.edge,a:s.point,length:s.edge.length*(1-s.t),seconds:s.edge.seconds*(1-s.t)};heap.push({edge:s.edge,cost:first.seconds,previous:null,part:first});
                for(const e of ends)if(s.edge.id===e.edge.id&&e.t>=s.t){const part={...s.edge,a:s.point,b:e.point,length:s.edge.length*(e.t-s.t),seconds:s.edge.seconds*(e.t-s.t)};if(!winner||part.seconds<winner.cost)winner={cost:part.seconds,part,previous:null};}}
            while(heap.items.length&&iterations++<150000){
                const current=heap.pop();if(winner&&current.cost>=winner.cost)break;
                const edge=current.edge;if(best.has(edge.id)&&best.get(edge.id)<=current.cost)continue;best.set(edge.id,current.cost);
                for(const next of adj.get(edge.to)||[]){
                    if(options.tollFree&&next.toll||!permitted(edge,next))continue;
                    for(const endSnap of ends)if(next.id===endSnap.edge.id){const part={...next,b:endSnap.point,length:next.length*endSnap.t,seconds:next.seconds*endSnap.t};const cost=current.cost+part.seconds;if(!winner||cost<winner.cost)winner={cost,part,previous:current};}
                    const cost=current.cost+next.seconds;if(!best.has(next.id)||cost<best.get(next.id))heap.push({edge:next,cost,part:next,previous:current});
                }
            }
            if(!winner)throw Error('NO_CONNECTED_OFFLINE_ROUTE');
            const parts=[];for(let c=winner;c;c=c.previous)if(c.part.length>0.1)parts.push(c.part);parts.reverse();
            if(!parts.length)throw Error('OFFLINE_ROUTE_TOO_SHORT');
            const coordinates=[parts[0].a,...parts.map(p=>p.b)],steps=[];let previous=null;
            for(const p of parts){const diff=previous?((p.heading-previous.heading+540)%360-180):0;
                const turn=!previous||previous.way!==p.way||Math.abs(diff)>35;
                if(turn)steps.push({name:p.name,ref:p.ref,distance:p.length,duration:p.seconds,geometry:{type:'LineString',coordinates:[p.a,p.b]},maneuver:{type:previous?'turn':'depart',modifier:Math.abs(diff)<25?'straight':Math.abs(diff)>150?'uturn':diff>0?'right':'left',location:p.a,bearing_before:previous?.heading||p.heading,bearing_after:p.heading}});
                else {const s=steps[steps.length-1];s.distance+=p.length;s.duration+=p.seconds;s.geometry.coordinates.push(p.b);}previous=p;
            }
            steps.push({name:'',distance:0,duration:0,maneuver:{type:'arrive',location:coordinates[coordinates.length-1]}});
            return {geometry:{type:'LineString',coordinates},distance:parts.reduce((s,p)=>s+p.length,0),duration:winner.cost,legs:[{steps}],offline:true,packSavedAt:pack.savedAt};
        }
        function conflictingRoad(point,heading,routeDistance){
            const c=nearby(point,heading),best=c[0];return !!(best&&best.distance<=8&&routeDistance>best.distance+15&&c.every(other=>other.edge.way===best.edge.way||other.distance>best.distance+8));
        }
        return {route,nearby,conflictingRoad,edges,nodes,pack};
    }
    return {build,distance,bearing,projection};
});
