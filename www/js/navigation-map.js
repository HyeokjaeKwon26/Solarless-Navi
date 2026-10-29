/* Bounded presentation overlays. They never modify routing or GPS decisions. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NavigationMap=api;})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const empty=()=>({type:'FeatureCollection',features:[]});
    const valid=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<85;
    const defaults={style:true,arrows:true,buildings:true,arrival:true,cache:true,shade:false,terrain:false};
    const presets={basic:{...defaults},detailed:{...defaults,shade:true,terrain:true},low:{...defaults,buildings:false}};
    function presetName(prefs){return Object.keys(presets).find(name=>Object.keys(defaults).every(key=>presets[name][key]===prefs[key]))||'custom';}
    function settings(storage){try{const raw=JSON.parse(storage?.getItem('solarless_map_details')||'{}');return Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,typeof raw[k]==='boolean'?raw[k]:v]));}catch{return {...defaults};}}
    function meters(a,b){if(!valid(a)||!valid(b))return Infinity;return Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111195;}
    function offset(p,x,y){return [p[0]+x/(111195*Math.cos(p[1]*Math.PI/180)),p[1]+y/111195];}
    function segmentBox(a,b,width){
        const dx=(b[0]-a[0])*Math.cos(a[1]*Math.PI/180)*111195,dy=(b[1]-a[1])*111195,d=Math.hypot(dx,dy);if(d<.1)return null;
        const x=-dy/d*width,y=dx/d*width;return [offset(a,x,y),offset(b,x,y),offset(b,-x,-y),offset(a,-x,-y),offset(a,x,y)];
    }
    function slice(model,start,end){
        const points=[];if(!model?.coordinates||!model.cumulative)return points;
        let lo=0,hi=model.cumulative.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(model.cumulative[mid]<start)lo=mid+1;else hi=mid;}
        for(let i=Math.max(0,lo-1);i<model.coordinates.length-1;i++){
            if(model.cumulative[i]>=end)break;
            const a=model.cumulative[i],b=model.cumulative[i+1];if(b<=start||a>=end||b<=a)continue;
            for(const v of [Math.max(start,a),Math.min(end,b)]){const t=(v-a)/(b-a),p=model.coordinates[i],q=model.coordinates[i+1];const r=[p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];if(valid(r)&&(!points.length||meters(points.at(-1),r)>.1))points.push(r);}
            if(points.length>=128)break;
        }return points;
    }
    function arrowData(model,turn,reliable){
        const data=empty();if(!reliable||!turn||turn.type==='arrive'||!(turn.distanceFromCar>=0&&turn.distanceFromCar<=500))return data;
        for(const [i,t] of [turn,turn.following?.distanceAfter<=180?turn.following:null].entries()){
            if(!t)continue;const progress=Number.isFinite(t.progressMeters)?t.progressMeters:turn.progressMeters+t.distanceAfter;if(!Number.isFinite(progress))continue;
            const points=slice(model,Math.max(0,progress-35),progress+35);if(points.length<2)continue;
            data.features.push({type:'Feature',properties:{following:i===1},geometry:{type:'LineString',coordinates:points}});
            const end=points.at(-1),prev=points.at(-2),length=meters(prev,end);if(length<.1)continue;
            const dx=(end[0]-prev[0])*Math.cos(end[1]*Math.PI/180)*111195/length,dy=(end[1]-prev[1])*111195/length;
            data.features.push({type:'Feature',properties:{following:i===1},geometry:{type:'LineString',coordinates:[offset(end,-dx*13-dy*7,-dy*13+dx*7),end,offset(end,-dx*13+dy*7,-dy*13-dx*7)]}});
        }return data;
    }
    function corridor(segments,index,position){
        const polygons=[];let length=0;
        for(const s of (segments||[]).slice(Math.max(0,index||0),Math.max(0,index||0)+64)){
            const a=[s.p1?.[1],s.p1?.[0]],b=[s.p2?.[1],s.p2?.[0]];if(!valid(a)||!valid(b))continue;
            const box=segmentBox(a,b,45);if(box)polygons.push([box]);length+=meters(a,b);if(length>700)break;
        }
        if(valid(position)){const a=offset(position,-85,-85),b=offset(position,85,85);polygons.push([[a,[b[0],a[1]],b,[a[0],b[1]],a]]);}
        return {type:'MultiPolygon',coordinates:polygons};
    }
    function shadeData(segments,index,reliable,now=Date.now()){
        const data=empty();if(!reliable)return data;let length=0;
        for(const s of (segments||[]).slice(Math.max(0,index||0),Math.max(0,index||0)+64)){
            const a=[s.p1?.[1],s.p1?.[0]],b=[s.p2?.[1],s.p2?.[0]];if(!valid(a)||!valid(b))continue;
            length+=meters(a,b);if(length>1000)break;
            const stamp=Number(new Date(s.occlusionAt||s.passTime));
            const known=Number.isFinite(stamp)&&Math.abs(now-stamp)<=10*60*1000&&typeof s.occlusionRatio==='number'&&Number.isFinite(s.occlusionRatio)&&['confirmed-shade','confirmed-clear'].includes(s.shadeState);
            const state=known?(s.occlusionRatio>=.5?'shade':'clear'):'unknown';
            // This ribbon describes samples on the route, not a simulated
            // shadow footprint on surrounding sidewalks/buildings.
            data.features.push({type:'Feature',properties:{state},geometry:{type:'LineString',coordinates:[a,b]}});
        }return data;
    }
    function roadLines(segments,index){
        const coordinates=[];let length=0;
        for(const s of (segments||[]).slice(Math.max(0,index||0),Math.max(0,index||0)+64)){
            const a=[s.p1?.[1],s.p1?.[0]],b=[s.p2?.[1],s.p2?.[0]];if(!valid(a)||!valid(b))continue;
            coordinates.push([a,b]);length+=meters(a,b);if(length>700)break;
        }return {type:'MultiLineString',coordinates};
    }
    function arrivalData(s){
        const data=empty(),pin=s.destination;if(!s.reliable||!valid(s.end)||!valid(pin)||!(s.remaining>=0&&s.remaining<=350)||meters(s.position,s.end)>500)return data;
        data.features.push({type:'Feature',properties:{kind:'end'},geometry:{type:'Point',coordinates:s.end}});
        data.features.push({type:'Feature',properties:{kind:s.entranceConfirmed?'entrance':'pin'},geometry:{type:'Point',coordinates:pin}});
        if(meters(pin,s.end)>10)data.features.push({type:'Feature',properties:{kind:'gap'},geometry:{type:'LineString',coordinates:[s.end,pin]}});
        return data;
    }
    const originalStyles=new WeakMap();
    function focusLabels(s){
        if(!s.reliable||!s.model||!Number.isFinite(s.progress))return [];
        const current=(s.model.maneuvers||[]).filter(m=>m.progressMeters<=s.progress+5).at(-1),next=s.maneuver;
        const labels=[];
        for(const [kind,m,at] of [['current',current,s.progress+45],['next',next,(next?.progressMeters||0)+45]]){
            if(!m||kind==='next'&&(!(next.distanceFromCar<=500)||m.type==='arrive'))continue;
            const name=[m.name||m.ref,m.exits?(String(s.language).startsWith('ko')?m.exits+'번 출구':'Exit '+m.exits):''].filter(Boolean).join(' · ');
            const points=slice(s.model,Math.max(0,at-1),at);if(!name||!points.length)continue;
            labels.push({kind,name:name.slice(0,100),position:points.at(-1)});
        }return labels;
    }
    function style(map,dark,enabled=true){
        const saved=originalStyles.get(map);
        if(!enabled){if(saved){for(const [id,type,key,value] of saved)if(map.getLayer(id))map[type](id,key,value??null);originalStyles.delete(map);}return;}
        if(saved)return;const changes=[];originalStyles.set(map,changes);
        const setPaint=(id,key,value)=>{changes.push([id,'setPaintProperty',key,map.getPaintProperty(id,key)]);map.setPaintProperty(id,key,value);};
        const setLayout=(id,key,value)=>{changes.push([id,'setLayoutProperty',key,map.getLayoutProperty(id,key)]);map.setLayoutProperty(id,key,value);};
        for(const layer of map.getStyle().layers||[]){
            if(layer.id.startsWith('nav-')||layer.id.startsWith('driving-'))continue;
            const source=layer['source-layer'];
            if(layer.type==='symbol'&&source==='poi')setLayout(layer.id,'visibility','none');
            if(layer.type==='symbol'&&source==='transportation_name'&&map.getLayoutProperty(layer.id,'text-field')){
                setPaint(layer.id,'text-opacity',.65);
                setPaint(layer.id,'text-color',dark?'#f1f5f9':'#17263b');setPaint(layer.id,'text-halo-color',dark?'#17263b':'#ffffff');setPaint(layer.id,'text-halo-width',2);
                if(!/shield/.test(layer.id))setLayout(layer.id,'text-size',['interpolate',['linear'],['zoom'],12,12,16,16,19,19]);
            }
            if(layer.type==='fill'&&source==='building')setPaint(layer.id,'fill-opacity',.45);
            if(layer.type==='line'&&source==='transportation'&&!/tunnel|bridge|casing|rail|path|track|service/.test(layer.id)){
                setPaint(layer.id,'line-color',dark?'#536277':'#f8fafc');
            }
        }
    }
    function create(map,options={}){
        let lastAt=-Infinity,lastKey='',lastSegments=null,buildingKey='',terrainOn=false,terrainFailed=false,disposed=false,lastArrival=false,lastStatus={};
        const firstRoute='driving-route-casing',before=map.getLayer('driving-ahead-casing')?'driving-ahead-casing':firstRoute;
        const source=(id)=>map.addSource(id,{type:'geojson',data:empty()});
        source('nav-arrows');source('nav-shade');source('nav-arrival');
        const serialized=new Map();
        const setData=(id,data)=>{const json=JSON.stringify(data);if(serialized.get(id)===json)return;serialized.set(id,json);map.getSource(id).setData(data);};
        map.addLayer({id:'nav-shade',type:'line',source:'nav-shade',layout:{'line-cap':'round'},paint:{'line-width':25,'line-opacity':.28,'line-color':['match',['get','state'],'shade','#8b5cf6','clear','#fbbf24','#94a3b8']}},before);
        for(const [id,width,color] of [['nav-arrow-casing',10,'#0f172a'],['nav-arrow',6,'#ffffff']])map.addLayer({id,type:'line',source:'nav-arrows',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':color,'line-width':width}});
        map.addLayer({id:'nav-arrival-gap',type:'line',source:'nav-arrival',filter:['==',['geometry-type'],'LineString'],paint:{'line-color':'#f8fafc','line-width':3,'line-dasharray':[2,2]}});
        map.addLayer({id:'nav-arrival',type:'circle',source:'nav-arrival',filter:['==',['geometry-type'],'Point'],paint:{'circle-radius':['match',['get','kind'],'end',7,11],'circle-color':['match',['get','kind'],'entrance','#22c55e','pin','#fbbf24','#38bdf8'],'circle-stroke-color':'#0f172a','circle-stroke-width':3}});
        const building=(map.getStyle().layers||[]).find(l=>l['source-layer']==='building');
        if(building){map.addLayer({id:'nav-buildings',type:'fill-extrusion',source:building.source,'source-layer':'building',minzoom:15,layout:{visibility:'none'},paint:{'fill-extrusion-color':options.dark?'#64748b':'#cbd5e1','fill-extrusion-height':['min',60,['max',0,['to-number',['get','render_height'],0]]],'fill-extrusion-base':0,'fill-extrusion-opacity':.45}},before);}
        const terrainError=e=>{if(e.sourceId==='nav-dem'){terrainFailed=true;setTerrain(false);lastStatus={...lastStatus,terrain:false,terrainFailed:true};options.onStatus?.(lastStatus);options.onTerrainError?.();}};map.on('error',terrainError);
        function setTerrain(on){
            if(on===terrainOn||disposed)return;
            if(on){
                if(!map.getSource('nav-dem'))map.addSource('nav-dem',{type:'raster-dem',tiles:['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],encoding:'terrarium',tileSize:512,maxzoom:12,attribution:'<a href="https://mapterhorn.com/attribution/">© Mapterhorn</a>'});
                if(!map.getLayer('nav-hillshade'))map.addLayer({id:'nav-hillshade',type:'hillshade',source:'nav-dem',paint:{'hillshade-exaggeration':.15,'hillshade-shadow-color':'#334155','hillshade-highlight-color':'#f8fafc'}},before);
                map.setTerrain({source:'nav-dem',exaggeration:1});
            }else{
                map.setTerrain(null);if(map.getLayer('nav-hillshade'))map.removeLayer('nav-hillshade');if(map.getSource('nav-dem'))map.removeSource('nav-dem');
            }terrainOn=on;
        }
        function update(s,reduced,force=false){
            if(disposed)return;const prefs=s.details||defaults;
            const key=JSON.stringify([prefs,s.reliable,s.maneuver?.sequence,s.maneuver?.progressMeters,s.maneuver?.distanceFromCar<=500,s.remaining<=350,s.end,s.destination,s.entranceConfirmed,reduced,s.language]);
            const changed=key!==lastKey||lastSegments!==s.segments;
            if(!force&&!changed&&Date.now()-lastAt<2000)return;lastKey=key;lastSegments=s.segments;lastAt=Date.now();
            style(map,options.dark,prefs.style);
            setData('nav-arrows',prefs.arrows?arrowData(s.model,s.maneuver,s.reliable):empty());
            setData('nav-shade',prefs.shade&&!reduced?shadeData(s.segments,s.index,s.reliable):empty());
            const arrival=prefs.arrival?arrivalData(s):empty();setData('nav-arrival',arrival);lastArrival=arrival.features.length>0;
            const close=s.maneuver?.distanceFromCar>=0&&s.maneuver.distanceFromCar<180;
            if(building){
                const show=!!(prefs.buildings&&!reduced&&s.reliable&&!close&&!lastArrival);
                map.setLayoutProperty('nav-buildings','visibility',show?'visible':'none');
                const next=JSON.stringify([s.position?.map(v=>Number(v.toFixed(3))),s.index,s.model?.total]);
                if(show&&(next!==buildingKey||changed)){
                    buildingKey=next;const pos=s.position,a=offset(pos,-450,-450),b=offset(pos,450,450),bounds={type:'Polygon',coordinates:[[a,[b[0],a[1]],b,[a[0],b[1]],a]]};
                    const roads=roadLines(s.segments,s.index),filters=[['within',bounds],['!', ['within',corridor(s.segments,s.index,pos)]]];
                    // Polygon-to-line distance also excludes large footprints
                    // that only partly overlap the road buffer. The 100 m margin
                    // exceeds the projection of the capped 60 m buildings.
                    if(roads.coordinates.length)filters.push(['>', ['distance',roads],100]);
                    map.setFilter('nav-buildings',['all',...filters]);
                }
            }
            if(!prefs.terrain)terrainFailed=false;
            setTerrain(!!(prefs.terrain&&!reduced&&!terrainFailed&&s.reliable&&!close&&!lastArrival));
            lastStatus={arrival:lastArrival,confirmed:!!s.entranceConfirmed,gap:meters(s.end,s.destination),shade:!!prefs.shade,terrain:terrainOn,terrainFailed,reduced};options.onStatus?.(lastStatus);
        }
        return {update,arrival:()=>lastArrival,terrain:()=>terrainOn,dispose(){if(disposed)return;setTerrain(false);disposed=true;map.off('error',terrainError);}};
    }
    return {defaults,presets,presetName,settings,valid,meters,offset,slice,arrowData,shadeData,arrivalData,corridor,roadLines,focusLabels,style,create};
});
