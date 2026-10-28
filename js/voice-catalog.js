/* App nicknames identify choices, not a claimed speaker gender or timbre. */
(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory();
    else root.VoiceCatalog=factory();
})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const korean={ism:['가람','Garam'],kob:['나래','Narae'],koc:['다온','Daon'],kod:['라온','Raon']};
    const english={iob:'Alex',iog:'Robin',iol:'Jamie',iom:'Casey',msm00013:'Taylor',sfg:'Morgan',tpc:'Avery',tpd:'Riley',tpf:'Skyler'};
    const hash=text=>{let value=2166136261;for(const ch of text)value=Math.imul(value^ch.charCodeAt(0),16777619);return value>>>0;};
    function name(voice,language){
        const ko=String(language).startsWith('ko'),raw=String(voice.name||''),locale=String(voice.lang||'');
        if(/^[a-z]{2}[-_][a-z]{2}[-_]language$/i.test(raw))return ko?'기본 음색':'Default tone';
        const code=raw.match(/^([a-z]{2})-([a-z]{2})-x-(.+?)-(?:local|network)$/i);
        if(code){
            const key=code[3].toLowerCase();
            if(code[1].toLowerCase()==='ko'&&Object.hasOwn(korean,key))return korean[key][ko?0:1];
            if(code[1].toLowerCase()==='en'&&Object.hasOwn(english,key))return english[key];
        }
        // Preserve readable engine-supplied names. Unrecognized codes receive
        // a deterministic nickname; catalogue order never determines identity.
        if(raw&&/[\s가-힣]/.test(raw)&&!code)return raw;
        const id=String(voice.id||raw).replace(/-(local|network)$/i,'');
        const names=locale.toLowerCase().startsWith('ko')?(ko?['하늘','새봄','한결','이든']:['Haneul','Saebom','Hangyeol','Eden']):['Rowan','Blair','Sage','Quinn'];
        return `${names[hash(id)%names.length]} ${hash(id)%100000}`;
    }
    function localeLabel(locale,language){
        const ko=String(language).startsWith('ko'),normalized=String(locale||'').replaceAll('_','-').toLowerCase();
        const labels={'ko-kr':['한국어','Korean'],'en-us':['미국 영어','US English'],'en-gb':['영국 영어','UK English'],'en-au':['호주 영어','Australian English'],'en-in':['인도 영어','Indian English']};
        return labels[normalized]?.[ko?0:1]||locale|| (ko?'언어 미확인':'Language unlisted');
    }
    function label(voice,language){
        const ko=String(language).startsWith('ko');
        return `${name(voice,language)} · ${localeLabel(voice.lang,language)} · ${voice.networkRequired?(ko?'인터넷용':'Online'):(ko?'기기용':'On device')}`;
    }
    function details(voice,language){
        const ko=String(language).startsWith('ko');
        if(!voice)return ko?'시스템이 고른 기본 음성입니다. 미리 듣기로 확인하세요.':'Uses the system default. Preview to hear it.';
        const qualities={100:['매우 낮음','Very low'],200:['낮음','Low'],300:['보통','Normal'],400:['높음','High'],500:['매우 높음','Very high']};
        const latency={100:['매우 빠름','Very fast'],200:['빠름','Fast'],300:['보통','Normal'],400:['느림','Slow'],500:['매우 느림','Very slow']};
        const unknown=ko?'미제공':'Unlisted';
        return ko?`엔진 기준 품질: ${qualities[voice.quality]?.[0]||unknown} · 응답: ${latency[voice.latency]?.[0]||unknown}. 음색은 미리 듣기로 비교하세요.`
            :`Engine-rated quality: ${qualities[voice.quality]?.[1]||unknown} · Response: ${latency[voice.latency]?.[1]||unknown}. Preview to compare tone.`;
    }
    return {name,label,details};
});
