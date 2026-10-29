/* Suppress only duplicate WebView subscriptions after a healthy native GPS handover. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GpsSourcePolicy=api;})(typeof window==='undefined'?globalThis:window,function(){
    'use strict';
    function create(){
        let count=0,first=0,last=0,received=0;
        function reset(){count=0;first=0;last=0;received=0;}
        function observe({source,timestamp,accuracy,accepted},now){
            if(!/^native-gps$/i.test(source||''))return;
            if(!accepted||!Number.isFinite(timestamp)||now-timestamp>750||timestamp>now+250||!(accuracy>0&&accuracy<=25)){reset();return;}
            if(timestamp<=last)return;
            if(!count||timestamp-last>750){count=0;first=timestamp;}
            count++;last=timestamp;received=now;
        }
        function preferred(now){return count>=3&&last-first>=500&&now-received>=0&&now-received<=750&&now-last<=750;}
        return {observe,preferred,reset,expiresIn:now=>Math.max(0,Math.min(received,last)+750-now)};
    }
    return {create};
});
