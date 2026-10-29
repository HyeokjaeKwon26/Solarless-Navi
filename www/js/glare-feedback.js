/* Driver observations are local labels, not automatic model calibration. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GlareFeedback=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    function observation(sample,glare,now=Date.now()){
        if(typeof glare!=='boolean'||!Number.isFinite(sample?.timestamp)||!Number.isFinite(sample.lat)||!Number.isFinite(sample.lng)||Math.abs(sample.lat)>90||Math.abs(sample.lng)>180||!sample.glarePrediction)throw Error('NO_PREDICTION');
        return {timestamp:sample.timestamp,lat:sample.lat,lng:sample.lng,heading:sample.heading,observedAt:now,glare,
            prediction:{...sample.glarePrediction},source:'driver-recall'};
    }
    function summarize(values){
        const report={labelled:0,unknown:0,truePositive:0,falsePositive:0,trueNegative:0,falseNegative:0};
        for(const v of values){
            if(typeof v.glare!=='boolean')continue;
            const p=v.prediction;
            if(!p||p.uncertain||p.evidenceKnown===false||!Number.isFinite(p.risk)){report.unknown++;continue;}
            report.labelled++;
            report[p.risk>.45?(v.glare?'truePositive':'falsePositive'):(v.glare?'falseNegative':'trueNegative')]++;
        }
        report.falsePositiveRate=report.falsePositive+report.trueNegative?report.falsePositive/(report.falsePositive+report.trueNegative):null;
        report.missRate=report.falseNegative+report.truePositive?report.falseNegative/(report.falseNegative+report.truePositive):null;
        return report;
    }
    function retain(values,now=Date.now()){return values.filter(v=>Number.isFinite(v.observedAt)&&v.observedAt<=now&&now-v.observedAt<=90*86400000).slice(-200);}
    function stratify(values){
        const groups=new Map();
        for(const v of values){
            const p=v.prediction||{};
            const elevation=Number.isFinite(p.sunAltitude)?p.sunAltitude<=10?'low-sun':p.sunAltitude<=30?'mid-sun':'high-sun':'sun-unknown';
            const heading=Number.isFinite(p.roadHeading)?['N','E','S','W'][Math.floor((p.roadHeading+45)%360/90)]:'heading-unknown';
            const shade=Number.isFinite(p.occlusionRatio)?p.occlusionRatio>=.5?'shaded':'exposed':'shade-unknown';
            const key=[elevation,heading,shade,p.weatherModel||'weather-unknown'].join(' / ');
            if(!groups.has(key))groups.set(key,[]);groups.get(key).push(v);
        }
        return [...groups].map(([condition,rows])=>({condition,...summarize(rows)}));
    }
    function evaluateThreshold(values){
        const rows=values.filter(v=>typeof v.glare==='boolean'&&Number.isFinite(v.timestamp)&&v.prediction&&!v.prediction.uncertain&&v.prediction.evidenceKnown===true&&Number.isFinite(v.prediction.risk)).sort((a,b)=>a.timestamp-b.timestamp);
        const days=[...new Set(rows.map(v=>Math.floor(v.timestamp/86400000)))];
        const unavailable={eligible:false,reason:'insufficient-independent-observations',recommendedThreshold:null};
        if(days.length<4||rows.length<40)return unavailable;
        const split=days[Math.floor(days.length*.7)],train=rows.filter(v=>Math.floor(v.timestamp/86400000)<split),held=rows.filter(v=>Math.floor(v.timestamp/86400000)>=split);
        if([train,held].some(set=>set.filter(v=>v.glare).length<5||set.filter(v=>!v.glare).length<5))return unavailable;
        const loss=(set,threshold)=>{const positive=set.filter(v=>v.glare),negative=set.filter(v=>!v.glare);return .5*(positive.filter(v=>v.prediction.risk<=threshold).length/positive.length+negative.filter(v=>v.prediction.risk>threshold).length/negative.length);};
        const candidate=[.35,.4,.45,.5,.55,.6,.65].sort((a,b)=>loss(train,a)-loss(train,b)||Math.abs(a-.45)-Math.abs(b-.45))[0];
        const baseline=loss(held,.45),tested=loss(held,candidate),improved=baseline>0&&tested<baseline*.9;
        return {eligible:true,reason:improved?'held-out-improvement':'no-held-out-improvement',recommendedThreshold:improved?candidate:null,trainCount:train.length,heldOutCount:held.length,baselineBalancedError:baseline,candidateBalancedError:tested,automaticCalibration:false};
    }
    return {observation,summarize,retain,stratify,evaluateThreshold};
});
