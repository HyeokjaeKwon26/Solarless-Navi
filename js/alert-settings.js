(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.AlertSettings=api;})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const types=['glare','speeding','road'],modes=['both','visual','off'];
    const normalize=value=>Object.fromEntries(types.map(k=>[k,modes.includes(value?.[k])?value[k]:'both']));
    let value=normalize();try{value=normalize(JSON.parse(root.localStorage?.getItem('solarless_alerts')||'{}'));}catch{}
    function set(next){const safe=normalize(next);try{root.localStorage.setItem('solarless_alerts',JSON.stringify(safe));value=safe;root.dispatchEvent(new Event('solarless:alerts'));return true;}catch{return false;}}
    function allows(type,channel){return !types.includes(type)||value[type]==='both'||channel==='visual'&&value[type]==='visual';}
    function glareGate(){
        let sentAt=null,sentRisk=0,lowSince=null,episode=false;
        return {observe(risk,now){
            if(!Number.isFinite(risk))return false;
            if(risk<=.35){if(lowSince===null)lowSince=now;if(now-lowSince>=10000)episode=false;return false;}
            lowSince=null;
            if(risk<=.45)return false;
            return sentAt===null||(!episode&&now-sentAt>=30000)||(risk-sentRisk>=.2&&now-sentAt>=60000);
        },sent(risk,now){sentAt=now;sentRisk=risk;episode=true;},reset(){sentAt=null;sentRisk=0;lowSince=null;episode=false;}};
    }
    return {normalize,set,get:()=>({...value}),allows,glareGate};
});
