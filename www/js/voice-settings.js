(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(null);
    else root.VoiceSettings=factory(root);
})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const defaults={koVoice:'',enVoice:'',rate:1,pitch:1};
    const bound=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):1;
    function normalize(value={}){return {koVoice:typeof value?.koVoice==='string'&&value.koVoice.length<=1024?value.koVoice:'',enVoice:typeof value?.enVoice==='string'&&value.enVoice.length<=1024?value.enVoice:'',rate:bound(value?.rate,.5,1.5),pitch:bound(value?.pitch,.75,1.5)};}
    const matches=(lang,voice)=>String(voice.lang||'').toLowerCase().split(/[-_]/)[0]===lang.split('-')[0];
    function selected(config,language,voices){const id=language.startsWith('ko')?config.koVoice:config.enVoice;return voices.find(v=>v.id===id&&matches(language,v))||null;}
    let config={...defaults},catalog=[],ready=false,busy=false,initialized=false,canPreview=()=>true;
    const native=()=>root?.Capacitor?.Plugins?.Pip?.getSpeechSettings?root.Capacitor.Plugins.Pip:null;
    const ko=()=>root.I18n?.getLanguage().startsWith('ko');
    const label=(a,b)=>ko()?a:b;
    const el=id=>root.document.getElementById(id);
    function status(text){el('speech-settings-status').textContent=text;}
    function deadline(promise){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('TTS_TIMEOUT')),6000);Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});}
    function webVoices(){return (root.speechSynthesis?.getVoices()||[]).map(v=>({id:'web:'+v.voiceURI,name:v.name,lang:v.lang,networkRequired:v.localService===false})).filter(v=>matches('ko',v)||matches('en',v));}
    function accept(result){config=normalize(result.settings);catalog=Array.isArray(result.voices)?result.voices:[];ready=result.ready===true;}
    function controls(){el('speech-settings-controls').disabled=busy||!ready;el('btn-refresh-voices').disabled=busy;}
    function render(){
        if(!initialized)return;
        const text={
            'speech-settings-title':label('안내 목소리','Guidance voices'),
            'speech-ko-label':label('한국어 목소리','Korean voice'),'speech-en-label':label('영어 목소리 · 영어 도로명','English voice · English road names'),
            'btn-preview-ko':label('한국어 미리 듣기','Preview Korean'),'btn-preview-en':label('영어 미리 듣기','Preview English'),
            'speech-rate-label':label('말하기 속도 · 두 언어 공통','Speech rate · both languages'),
            'speech-pitch-label':label('음높이 · 두 언어 공통','Pitch · both languages'),
            'btn-reset-voices':label('음성 설정 초기화','Reset voice settings'),'btn-refresh-voices':label('목소리 목록 새로고침','Refresh voices'),
            'speech-settings-help':label('폰의 음성 엔진에 있는 목소리입니다. 인터넷 필요 표시를 확인하세요. Android 앱에서는 PiP·화면 꺼짐에도 설정이 유지됩니다. 엔진을 바꿨다면 앱을 다시 켜 주세요.','Uses your phone’s speech engine. Check the Internet label. The Android app keeps these settings in PiP and with the screen off. Restart the app after changing engines.')
        };
        for(const [id,value] of Object.entries(text))el(id).textContent=value;
        for(const language of ['ko','en']){
            const selector=el('speech-voice-'+language),id=config[language+'Voice'];selector.replaceChildren();
            const option=(value,text)=>{const o=root.document.createElement('option');o.value=value;o.textContent=text;selector.appendChild(o);};
            option('',label('언어 기본 음성','Language default'));
            const choices=catalog.filter(v=>matches(language,v));
            for(const voice of choices)option(voice.id,`${voice.name} (${voice.lang}) · ${voice.networkRequired?label('인터넷 필요','Internet'):label('기기 음성','On device')}`);
            if(id&&!choices.some(v=>v.id===id))option(id,label('사용 불가 · 기본 음성으로 대체','Unavailable · using language default'));
            selector.value=id;
        }
        for(const name of ['rate','pitch']){el('speech-'+name).value=config[name];el('speech-'+name+'-value').textContent=Number(config[name]).toFixed(2)+'×';}
        controls();
        if(!busy)status(summary());
    }
    function summary(){
        if(!ready)return label('음성 엔진이 준비되지 않았습니다. 잠시 후 목록을 새로고침하세요.','Speech engine is not ready. Refresh voices shortly.');
        if(['ko','en'].some(lang=>config[lang+'Voice']&&!selected(config,lang,catalog)))return label('사용할 수 없는 선택 음성은 같은 언어의 기본 음성으로 대체합니다.','Unavailable selections use the same language’s default voice.');
        if(!catalog.length)return label('선택할 목소리가 없습니다. 시스템 음성을 설치한 뒤 새로고침하세요.','No voices listed. Install system voices, then refresh.');
        return label('설정은 자동 저장됩니다. 미리 듣기는 주행 안내를 종료한 뒤 이용하세요.','Changes save automatically. End guidance before previewing.');
    }
    async function refresh(){
        if(busy)return;busy=true;controls();status(label('목소리 불러오는 중…','Loading voices…'));
        try{
            const plugin=native();
            if(plugin){
                let result;
                for(let i=0;i<8;i++){result=await deadline(plugin.getSpeechSettings());if(result.ready)break;await new Promise(resolve=>setTimeout(resolve,400));}
                accept(result);
            }else{try{config=normalize(JSON.parse(root.localStorage.getItem('solarless_web_speech_settings')||'{}'));}catch{config={...defaults};}catalog=webVoices();ready=!!root.speechSynthesis;}
            render();status(summary());
        }catch{ready=false;render();status(label('음성 목록을 읽지 못했습니다. 다시 새로고침하세요.','Could not load voices. Please refresh again.'));}
        finally{busy=false;controls();}
    }
    async function save(next){
        if(busy||!ready)return;busy=true;controls();status(label('저장 중…','Saving…'));
        try{
            const normalized=normalize(next),plugin=native();
            if(plugin)accept(await deadline(plugin.setSpeechSettings({settings:normalized})));
            else{root.localStorage.setItem('solarless_web_speech_settings',JSON.stringify(normalized));config=normalized;}
            render();status(summary());
        }catch{ready=false;render();status(label('설정을 저장하지 못했습니다. 목록을 새로고침해 실제 설정을 확인하세요.','Could not save. Refresh voices to read the saved settings.'));}
        finally{busy=false;controls();}
    }
    async function preview(language){
        if(busy||!ready)return;
        if(!canPreview()){status(label('주행 안내를 종료한 뒤 미리 들어보세요.','End guidance before previewing.'));return;}
        if(root.TTSVoice.isMuted()){status(label('상단 스피커 버튼으로 음성을 켜 주세요.','Enable voice using the speaker button first.'));return;}
        try{const accepted=await root.TTSVoice.previewLanguage(language);status(accepted?label('미리 듣기를 요청했습니다. 소리가 없으면 음량과 음성 설치 상태를 확인하세요.','Preview requested. If silent, check volume and installed voices.'):label('현재 음성을 재생할 수 없습니다. 잠시 후 다시 시도하세요.','Voice is unavailable right now. Please try again shortly.'));}
        catch{status(label('미리 듣기에 실패했습니다. 음성 설치 상태를 확인하세요.','Preview failed. Check installed voices.'));}
    }
    function init(options={}){
        if(initialized)return;initialized=true;canPreview=options.canPreview||canPreview;
        for(const language of ['ko','en']){
            el('speech-voice-'+language).addEventListener('change',e=>save({...config,[language+'Voice']:e.target.value}));
            el('btn-preview-'+language).addEventListener('click',()=>preview(language==='ko'?'ko-KR':'en-US'));
        }
        for(const name of ['rate','pitch']){
            el('speech-'+name).addEventListener('input',e=>el('speech-'+name+'-value').textContent=Number(e.target.value).toFixed(2)+'×');
            el('speech-'+name).addEventListener('change',e=>save({...config,[name]:Number(e.target.value)}));
        }
        el('btn-reset-voices').addEventListener('click',()=>save(defaults));el('btn-refresh-voices').addEventListener('click',refresh);
        root.speechSynthesis?.addEventListener?.('voiceschanged',()=>{if(!native()&&!busy){catalog=webVoices();render();status(summary());}});
        render();refresh();
    }
    return {normalize,selected,init,refresh,render,get:()=>({...config})};
});
