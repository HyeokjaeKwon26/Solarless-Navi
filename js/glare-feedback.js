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
    return {observation,summarize,retain};
});
