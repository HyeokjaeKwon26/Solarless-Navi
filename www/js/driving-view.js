/* Native MapLibre camera for live guidance; Leaflet remains the 2D fallback. */
(function(root,factory){
    const api=factory();
    if(typeof module==='object'&&module.exports)module.exports=api;
    else root.DrivingView=api;
})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const empty=()=>({type:'FeatureCollection',features:[]});
    const valid=p=>Array.isArray(p)&&p.length>=2&&p.slice(0,2).every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=85;
    function quality(previous={},sample={}){
        const now=sample.now||0,thermal=Number(sample.thermalStatus)||0;
        const pressure=thermal>=2||(Number.isFinite(sample.fps)&&sample.fps<24);
        const healthy=thermal<2&&(!Number.isFinite(sample.fps)||sample.fps>=40);
        const badSince=pressure?(previous.badSince??now):null;
        const goodSince=healthy?(previous.goodSince??now):null;
        const reduced=thermal>=2||(pressure&&now-badSince>=3000)||!!previous.reduced&&!(healthy&&now-goodSince>=15000);
        return {reduced,badSince,goodSince,interval:reduced?66:33,pixelRatio:reduced?1:1.5};
    }
    function curve(s){
        const items=(s.segments||[]).slice(s.index||0,(s.index||0)+5);
        const bearings=items.map(e=>{
            if(!e.p1||!e.p2)return null;
            return Math.atan2((e.p2[1]-e.p1[1])*Math.cos((e.p1[0]+e.p2[0])*Math.PI/360),e.p2[0]-e.p1[0])*180/Math.PI;
        }).filter(Number.isFinite);
        return bearings.some((b,i)=>i>0&&Math.abs((b-bearings[i-1]+540)%360-180)>30);
    }
    function policy(s){
        const m=s.maneuver, distance=m?.distanceFromCar;
        const close=!!(s.reliable&&s.autoZoom&&m&&m.type!=='arrive'&&Number.isFinite(distance)&&distance>=0&&distance<=Math.max(150,Math.min(500,(s.speed||0)/3.6*12)));
        const bending=s.reliable&&curve(s),stopped=s.reliable&&Number.isFinite(s.speed)&&s.speed<3;
        return {pitch:close?32:bending||stopped?42:50,zoom:close?(s.speed>=80?16.7:17.8):(s.speed>=80?16:bending?16.7:stopped?17.2:17),close,
            points:close?[m.location,m.following?.distanceAfter<=180?m.following.location:null].filter(valid):[]};
    }
    function routeData(segments,index,position,color,uncertain,stop=Infinity){
        const result=empty();let last=null;
        for(let i=Math.max(0,index||0);i<Math.min((segments||[]).length,stop);i++){
            const s=segments[i],a=i===index&&valid(position)?position:[s.p1?.[1],s.p1?.[0]],b=[s.p2?.[1],s.p2?.[0]];
            if(!valid(a)||!valid(b)){last=null;continue;}
            const properties={color:color(s),uncertain:!!uncertain(s)};
            const tail=last?.geometry.coordinates.at(-1);
            if(last&&last.properties.color===properties.color&&last.properties.uncertain===properties.uncertain&&tail[0]===a[0]&&tail[1]===a[1])last.geometry.coordinates.push(b);
            else{last={type:'Feature',properties,geometry:{type:'LineString',coordinates:[a,b]}};result.features.push(last);}
        }
        return result;
    }
    const CHUNK_SIZE=64;
    function routeChunks(segments,color,uncertain){
        const data=empty();
        for(let start=0;start<(segments||[]).length;start+=CHUNK_SIZE){
            const chunk=routeData(segments,start,null,color,uncertain,start+CHUNK_SIZE);
            for(const feature of chunk.features){feature.properties.chunk=start/CHUNK_SIZE;data.features.push(feature);}
        }
        return data;
    }
    function create(options){
        const {container,library:gl,onActive=()=>{},onPan=()=>{},onFailure=()=>{}}=options;
        let map=null,vehicle=null,end=null,ready=false,failed=false,state=null,timer=null,theme='',generation=0;
        let lastDataAt=0,lastSegments=null,lastIndex=-1,lastReliable=null,lastFrame=0,lastCameraAt=0,errors=[],fitKey='',fitCeiling=20;
        let active=false,viewSize=null,lastChunk=-1,lastJunctionKey='';
        let performanceState={},raf=0,frameCount=0,frameStarted=0,lastFps=null,appliedRatio=0,heldBearing=null;
        function measure(at){
            if(!active)return;
            if(state?.speed>3&&!state.panning){
                if(!frameStarted)frameStarted=at;
                frameCount++;
                if(at-frameStarted>=2000){lastFps=frameCount*1000/(at-frameStarted);frameCount=0;frameStarted=at;}
            }else {frameCount=0;frameStarted=0;lastFps=null;}
            raf=requestAnimationFrame(measure);
        }
        const activate=value=>{if(active===value)return;active=value;container.classList.toggle('ready',value);onActive(value);};
        function destroy(){
            cancelAnimationFrame(raf);frameCount=0;frameStarted=0;lastFps=null;heldBearing=null;appliedRatio=0;
            generation++;clearTimeout(timer);ready=false;activate(false);
            if(map){vehicle?.remove();end?.remove();map.remove();}
            map=null;vehicle=null;end=null;lastSegments=null;lastIndex=-1;lastChunk=-1;lastReliable=null;lastJunctionKey='';viewSize=null;lastDataAt=0;lastFrame=0;lastCameraAt=0;container.replaceChildren();
        }
        function fail(){if(failed)return;failed=true;destroy();onFailure();}
        function makeMarker(className,text){const el=document.createElement('div');el.className=className;el.textContent=text;el.setAttribute('aria-hidden','true');return el;}
        function start(){
            const token=++generation;
            try{
                theme=state.theme;errors=[];
                map=new gl.Map({container,style:theme,center:state.position,zoom:17,pitch:50,bearing:state.bearing||0,
                    attributionControl:false,maxPitch:60,minZoom:2,maxZoom:20,renderWorldCopies:false,
                    pixelRatio:Math.min(1.5,window.devicePixelRatio||1),fadeDuration:0});
                map.touchZoomRotate.enable();map.touchPitch?.disable();
                map.on('dragstart',onPan);map.on('drag',onPan);map.on('rotate',e=>{if(e.originalEvent)onPan();});
                map.on('zoom',e=>{if(e.originalEvent)onPan();});
                map.getCanvas().addEventListener('webglcontextlost',e=>{e.preventDefault();if(token===generation)fail();},{once:true});
                map.on('error',()=>{if(token!==generation)return;const now=Date.now();errors=errors.filter(t=>now-t<10000);errors.push(now);if(errors.length>=(ready?6:2))fail();});
                timer=setTimeout(()=>{if(token===generation&&!ready)fail();},8000);
                map.once('load',()=>{
                    if(token!==generation)return;
                    try{
                    clearTimeout(timer);
                    // Buildings can cover the route at shallow camera angles.
                    for(const layer of map.getStyle().layers||[])if(layer.type==='fill-extrusion')map.setLayoutProperty(layer.id,'visibility','none');
                    map.addSource('driving-route-ahead',{type:'geojson',data:empty()});
                    map.addLayer({id:'driving-ahead-casing',type:'line',source:'driving-route-ahead',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0f172a','line-width':11,'line-opacity':.7}});
                    for(const dashed of [false,true])map.addLayer({id:dashed?'driving-ahead-uncertain':'driving-ahead-solid',type:'line',source:'driving-route-ahead',
                        filter:['==',['get','uncertain'],dashed],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':7,...(dashed?{'line-dasharray':[1.5,1.5]}:{})}});
                    map.addSource('driving-route',{type:'geojson',data:empty()});
                    map.addLayer({id:'driving-route-casing',type:'line',source:'driving-route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#0f172a','line-width':11,'line-opacity':.7}});
                    for(const dashed of [false,true])map.addLayer({id:dashed?'driving-route-uncertain':'driving-route-solid',type:'line',source:'driving-route',
                        filter:['==',['get','uncertain'],dashed],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':7,...(dashed?{'line-dasharray':[1.5,1.5]}:{})}});
                    map.addSource('driving-junctions',{type:'geojson',data:empty()});
                    map.addLayer({id:'driving-junctions',type:'circle',source:'driving-junctions',paint:{'circle-radius':8,'circle-color':'#f8fafc','circle-stroke-color':'#0369a1','circle-stroke-width':3}});
                    vehicle=new gl.Marker({element:makeMarker('driving-vehicle','▲'),rotationAlignment:'map',pitchAlignment:'map'}).setLngLat(state.position).addTo(map);
                    end=new gl.Marker({element:makeMarker('driving-end','⚑')}).setLngLat(state.position).addTo(map);
                    ready=true;activate(true);raf=requestAnimationFrame(measure);draw(true);
                    }catch{fail();}
                });
            }catch{fail();}
        }
        function draw(force=false){
            if(!ready||!map||!state)return;
            const now=Date.now();performanceState=quality(performanceState,{now,fps:lastFps,thermalStatus:state.thermalStatus});
            if(!force&&state.reliable===lastReliable&&now-lastFrame<performanceState.interval)return;lastFrame=now;
            const ratio=Math.min(performanceState.pixelRatio,window.devicePixelRatio||1);
            if(ratio!==appliedRatio){map.setPixelRatio(ratio);appliedRatio=ratio;options.onQuality?.(performanceState.reduced);}
            vehicle.setLngLat(state.position).setRotation(Number.isFinite(state.heading)?state.heading:0);
            vehicle.getElement().classList.toggle('uncertain',!state.reliable);
            end.getElement().hidden=!valid(state.end);if(valid(state.end))end.setLngLat(state.end);
            const changed=state.segments!==lastSegments,chunk=Math.floor(Math.max(0,state.index||0)/CHUNK_SIZE);
            if(changed)map.getSource('driving-route-ahead').setData(routeChunks(state.segments,options.color,options.uncertain));
            if(force||changed||chunk!==lastChunk||state.reliable!==lastReliable){
                const future=['all',['>', ['get','chunk'],chunk],['==',state.reliable,true]];
                map.setFilter('driving-ahead-casing',future);
                for(const dashed of [false,true])map.setFilter(dashed?'driving-ahead-uncertain':'driving-ahead-solid',['all',future,['==',['get','uncertain'],dashed]]);
                lastChunk=chunk;
            }
            // Only this bounded near-car chunk moves; the far route stays in the worker.
            if(force||changed||state.index!==lastIndex||state.reliable!==lastReliable||now-lastDataAt>=500){
                map.getSource('driving-route').setData(state.reliable?routeData(state.segments,state.index,state.position,options.color,options.uncertain,(chunk+1)*CHUNK_SIZE):empty());
                lastSegments=state.segments;lastIndex=state.index;lastReliable=state.reliable;lastDataAt=now;
            }
            const p=policy(state),junctionKey=JSON.stringify(p.points);
            if(junctionKey!==lastJunctionKey){
                map.getSource('driving-junctions').setData({type:'FeatureCollection',features:p.points.map(coordinates=>({type:'Feature',properties:{},geometry:{type:'Point',coordinates}}))});
                lastJunctionKey=junctionKey;
            }
            if(state.panning)return;
            const size=viewSize||(viewSize=container.getBoundingClientRect());
            if(size.width<64||size.height<64)return;
            // Reserve actual HUD bounds. Extra top padding places the vehicle
            // below the centre of the remaining map, leaving more road ahead.
            const top=Math.min(size.height*.4,Math.max(20,state.top||0)),bottom=Math.min(Math.max(20,size.height-top-60),Math.max(20,state.bottom||0));
            const room=Math.max(0,size.height-top-bottom);
            const left=Math.min(size.width*.48,Math.max(24,state.left||32)),right=state.left>32?24:Math.min(88,size.width*.2);
            const padding={top:top+room*.3,bottom,left,right};
            const desired=state.bearing||0;
            if(heldBearing===null||state.speed>=3||state.bearing===0)heldBearing=desired;
            const delta=(heldBearing-map.getBearing()+540)%360-180;
            const camera={center:state.position,bearing:force?heldBearing:map.getBearing()+delta*Math.min(1,Math.max(.05,(now-lastCameraAt)/350)),pitch:p.pitch,padding};
            // Smooth the camera's zoom/pitch rather than starting overlapping
            // easeTo animations on every GPS interpolation frame.
            const dt=Math.min(1,(now-lastCameraAt)/500);lastCameraAt=now;
            const pitch=force||state.reducedMotion?p.pitch:map.getPitch()+(p.pitch-map.getPitch())*dt;
            const key=JSON.stringify([p.points,size.width,size.height,top,bottom,left]);
            if(key!==fitKey){fitKey=key;fitCeiling=20;}
            const targetZoom=Math.min(p.zoom,fitCeiling);
            const zoom=state.autoZoom?(force||state.reducedMotion?targetZoom:map.getZoom()+(targetZoom-map.getZoom())*dt):map.getZoom();
            map.jumpTo({...camera,pitch,zoom});
            // Check the actual pitched projection: next and chained turns must
            // stay clear of HUD panels. Do not assume flat fitBounds geometry.
            if(p.points.length){
                const points=[state.position,...p.points];let z=map.getZoom();
                while(z>13.5&&points.some(pos=>{const v=map.project(pos);return v.x<left||v.x>size.width-right||v.y<top+12||v.y>size.height-bottom-12;})){
                    z-=.25;fitCeiling=z;map.jumpTo({zoom:z});
                }
            }
        }
        function update(next){
            state=next;
            const allowed=next.live&&next.wanted&&!next.saver&&!next.pip&&next.visible&&!next.satellite&&next.available&&valid(next.position);
            if(!allowed){if(map)destroy();return;}
            if(failed)return;
            if(map&&theme!==next.theme)destroy();
            if(!map)start();else draw();
        }
        const resize=()=>{viewSize=null;if(map){map.resize();draw(true);}};
        const observer=new ResizeObserver(resize);observer.observe(container);
        return {update,resize,recenter:()=>{if(state){state.panning=false;draw(true);}},retry:()=>{failed=false;},
            active:()=>active,failed:()=>failed,dispose:()=>{observer.disconnect();destroy();}};
    }
    return {policy,routeData,routeChunks,CHUNK_SIZE,create,quality};
});
