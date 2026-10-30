/* Presentation only: speech timing and position matching remain independent. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./navigation-guidance'));else root.JunctionPresentation=factory(root.NavigationGuidance);})(typeof window!=='undefined'?window:globalThis,function(guidance){
    'use strict';
    function present(turn,speed,ko=false){
        if(!turn||turn.type==='arrive'||!Number.isFinite(turn.distanceFromCar))return {phase:'none',lanes:null,following:null,sign:'',compact:false};
        const limits=guidance.thresholds(speed,turn),distance=Math.max(0,turn.distanceFromCar);
        const prepareDistance=Math.max(350,limits.prepare);
        const phase=distance<=limits.execute?'execute':distance<=prepareDistance?'prepare':'approach';
        const l=turn.lanes,valid=l&&Number.isInteger(l.total)&&l.total>0&&l.total<=12&&Array.isArray(l.valid)&&l.valid.length>0&&l.valid.every(n=>Number.isInteger(n)&&n>=1&&n<=l.total);
        const following=turn.following&&turn.following.distanceAfter>=0&&turn.following.distanceAfter<=180&&distance<=prepareDistance?turn.following:null;
        const sign=[turn.exits?(ko?`${turn.exits}번 출구`:`Exit ${turn.exits}`):'',turn.ref,phase==='approach'?turn.destinations:''].filter(Boolean).map(v=>String(v).slice(0,120)).join(' · ');
        return {phase,lanes:phase==='prepare'&&valid?l:null,following,sign,compact:phase==='execute'};
    }
    return {present};
});
