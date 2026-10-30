/* Explicit user labels. Never promotes a computed match to ground truth. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./drive-regression'));else root.DriveTruth=factory(root.DriveRegression);})(typeof window!=='undefined'?window:globalThis,function(regression){
    'use strict';
    const serialize=value=>JSON.stringify(value,null,2)+'\n';
    function copy(recording){if(![1,2].includes(recording?.version)||!Array.isArray(recording.samples)||recording.samples.length>50000||(recording.events||[]).length>60000)throw Error('INVALID_RECORDING');return JSON.parse(JSON.stringify(recording));}
    function sourceCheck(source){if(!['foreground','native'].includes(source))throw Error('SOURCE');}
    function labelFix(recording,source,timestamp,label,progress){
        sourceCheck(source);if(![true,false,null].includes(label)||!Number.isFinite(timestamp))throw Error('LABEL');
        const out=copy(recording),samples=source==='native'?(out.events||[]).filter(e=>e.type==='native-location').map(e=>e.data):out.samples;
        const found=samples.filter(s=>s?.timestamp===timestamp);if(found.length!==1)throw Error('AMBIGUOUS_SAMPLE');
        const sample=found[0];delete sample.expectedMatched;delete sample.expectedProgressMeters;delete sample.expectedToleranceMeters;
        if(label!==null){sample.expectedMatched=label;if(progress!==null&&progress!==undefined&&label){if(!Number.isFinite(progress)||progress<0)throw Error('PROGRESS');sample.expectedProgressMeters=progress;sample.expectedToleranceMeters=25;}}
        out.truthLabelOrigin='user-reviewed';return out;
    }
    function labelEvent(recording,source,type,data){
        sourceCheck(source);const out=copy(recording);out.events??=[];
        if(type==='guidance-ground-truth'){
            if(!['preview','prepare','execute'].includes(data.stage)||!Number.isInteger(data.routeIndex)||data.routeIndex<0||!Number.isFinite(data.progressMeters)||data.progressMeters<0||!Number.isFinite(data.earliestAt)||!Number.isFinite(data.latestAt)||data.latestAt<data.earliestAt)throw Error('TURN_LABEL');
        }else if(type==='reroute-ground-truth'){
            if(!Number.isFinite(data.start)||!Number.isFinite(data.end)||data.end<data.start||typeof data.allowed!=='boolean')throw Error('WINDOW_LABEL');
        }else throw Error('TYPE');
        if(out.events.length>=60000)throw Error('LIMIT');
        out.events.push({type,recordedAt:data.latestAt??data.end,data:{...data,source}});out.truthLabelOrigin='user-reviewed';return out;
    }
    async function report(recording,source,version){
        sourceCheck(source);const bytes=new TextEncoder().encode(serialize(recording));
        if(bytes.length>16*1048576)throw Error('LIMIT');
        const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
        const recordingSha256=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
        return {schema:1,appVersion:String(version),recordingSha256,source,metrics:regression.evaluate(copy(recording),source)};
    }
    function compare(before,after){
        if(before?.schema!==1||after?.schema!==1||before.recordingSha256!==after.recordingSha256||before.source!==after.source||!before.recordingSha256)throw Error('DIFFERENT_EVIDENCE');
        const changes={};for(const key of ['fixErrors','lateGuidance','falseRerouteProposals','positionJumps'])changes[key]=Number.isFinite(before.metrics?.[key])&&Number.isFinite(after.metrics?.[key])?after.metrics[key]-before.metrics[key]:null;
        return {before:before.appVersion,after:after.appVersion,changes};
    }
    return {serialize,labelFix,labelEvent,report,compare};
});
