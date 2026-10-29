/* Bounded on-device estimates and opt-in measurements. No implied traffic coverage. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JourneyEvidence=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    function delayTracker(){
        let key=null,rows=[];
        return {reset(){key=null;rows=[];},observe(route,now,base,meters,eligible){
            if(!eligible||![now,base,meters].every(Number.isFinite)||base<0||meters<0){rows=[];key=null;return 0;}
            if(route!==key){key=route;rows=[];}
            const last=rows.at(-1);
            if(last&&(now<last.now||now-last.now>15000||meters>last.meters+30||base>last.base+30))rows=[];
            else if(last&&now-last.now<1000)return last.delay;
            rows=rows.filter(v=>now-v.now<=60000);
            const first=rows[0],elapsed=first?(now-first.now)/1000:0;
            // Account for a recent local slowdown once, not as a multiplier on
            // every remaining road. Recovered travel removes it within 60 s.
            const delay=elapsed>=20?Math.min(60,Math.max(0,elapsed-(first.base-base))):0;
            rows.push({now,base,meters,delay});return delay;
        }};
    }
    function performanceReport(recording){
        const samples=(recording.events||[]).filter(e=>e.type==='performance-sample'&&Number.isFinite(e.recordedAt)&&e.data).sort((a,b)=>a.recordedAt-b.recordedAt);
        const first=samples[0],last=samples.at(-1),minutes=first&&last?(last.recordedAt-first.recordedAt)/60000:0;
        const numbers=key=>samples.map(e=>e.data[key]).filter(Number.isFinite);
        const knownPower=samples.length>1&&samples.every(e=>e.data.charging===false&&e.data.externalPowerConnected===false);
        const battery=numbers('batteryPercent'),temps=numbers('batteryTemperatureC'),latency=numbers('renderLatencyMs').sort((a,b)=>a-b);
        const versions=[...new Set(samples.map(e=>e.data.version).filter(Boolean))],devices=[...new Set(samples.map(e=>e.data.device).filter(Boolean))];
        const brightness=numbers('brightness'),brightnessModes=numbers('brightnessMode');
        const stableBrightness=brightness.length===samples.length&&brightness.length>0&&Math.max(...brightness)-Math.min(...brightness)<=5&&brightnessModes.length===samples.length&&brightnessModes.every(v=>v===0);
        const gaps=samples.slice(1).map((e,i)=>e.recordedAt-samples[i].recordedAt),maxGapMs=gaps.length?Math.max(...gaps):null;
        const modes=[...new Set(samples.map(e=>['visible','pip','map3d','live','saver'].every(k=>typeof e.data[k]==='boolean')?JSON.stringify([e.data.visible,e.data.pip,e.data.map3d,e.data.live,e.data.saver]):'unknown'))];
        const mode=modes.length===1&&modes[0]!=='unknown'?modes[0]:null;
        const valid=!!mode&&minutes>=30&&knownPower&&battery.length===samples.length&&battery.length>1&&battery[0]>=battery.at(-1)&&versions.length===1&&devices.length===1&&stableBrightness&&maxGapMs<=90000;
        return {samples:samples.length,minutes,version:versions.length===1?versions[0]:null,device:devices.length===1?devices[0]:null,
            mode,comparable:valid,reason:valid?'controlled-device-sample':'needs-30min-unplugged-fixed-brightness-continuous-samples',
            batteryPointsPerHour:valid?(battery[0]-battery.at(-1))*60/minutes:null,
            maxBatteryTemperatureC:temps.length?Math.max(...temps):null,p90RenderEventLatencyMs:latency.length?latency[Math.floor((latency.length-1)*.9)]:null,
            brightness:stableBrightness?brightness[0]:null,maxGapMs,actualPanelFps:null};
    }
    function comparePerformance(a,b){
        if(!a?.comparable||!b?.comparable||a.device!==b.device||a.mode!==b.mode||Math.abs(a.brightness-b.brightness)>5)return {comparable:false};
        return {comparable:true,batteryPointsPerHourChange:b.batteryPointsPerHour-a.batteryPointsPerHour,
            temperatureChange:Number.isFinite(a.maxBatteryTemperatureC)&&Number.isFinite(b.maxBatteryTemperatureC)?b.maxBatteryTemperatureC-a.maxBatteryTemperatureC:null,
            sameRouteWeatherMountRequired:true};
    }
    return {delayTracker,performanceReport,comparePerformance};
});
