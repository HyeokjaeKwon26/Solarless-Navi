(function(root,factory){
    if(typeof module==='object'&&module.exports)module.exports=factory(null);
    else root.VoiceSettings=factory(root);
})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const defaults={koVoice:'',enVoice:'',rate:1,pitch:1,unifiedVoice:true};
    const bound=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):1;
    function normalize(value={}){return {koVoice:typeof value?.koVoice==='string'&&value.koVoice.length<=1024?value.koVoice:'',enVoice:typeof value?.enVoice==='string'&&value.enVoice.length<=1024?value.enVoice:'',rate:bound(value?.rate,.5,1.5),pitch:bound(value?.pitch,.75,1.5),unifiedVoice:value?.unifiedVoice!==false};}
    const matches=(lang,voice)=>String(voice.lang||'').toLowerCase().split(/[-_]/)[0]===lang.split('-')[0];
    function selected(config,language,voices){const id=language.startsWith('ko')?config.koVoice:config.enVoice;return voices.find(v=>v.networkRequired!==true&&v.id===id&&matches(language,v))||null;}
    let config={...defaults},catalog=[],ready=false,busy=false,initialized=false,canPreview=()=>true;
    let notes=Object.create(null);
    const native=()=>root?.Capacitor?.Plugins?.Pip?.getSpeechSettings?root.Capacitor.Plugins.Pip:null;
    const ko=()=>root.I18n?.getLanguage().startsWith('ko');
    const label=(a,b)=>ko()?a:b;
    const el=id=>root.document.getElementById(id);
    function status(text){el('speech-settings-status').textContent=text;}
    function deadline(promise){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('TTS_TIMEOUT')),6000);Promise.resolve(promise).then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});}
    function webVoices(){return (root.speechSynthesis?.getVoices()||[]).map(v=>({id:'web:'+v.voiceURI,name:v.name,lang:v.lang,networkRequired:v.localService===false})).filter(v=>matches('ko',v)||matches('en',v));}
    function accept(result){config=normalize(result.settings);catalog=(Array.isArray(result.voices)?result.voices:[]).filter(root.VoiceCatalog.installed);ready=result.ready===true;}
    function offlineConfig(value,voices){const next=normalize(value);for(const lang of ['ko','en'])next[lang+'Voice']=root.VoiceCatalog.localId(next[lang+'Voice'],lang,voices);return next;}
    async function acceptNative(result,plugin){
        if(result.ready){const next=offlineConfig(result.settings,Array.isArray(result.voices)?result.voices:[]);
            if(next.koVoice!==(result.settings?.koVoice||'')||next.enVoice!==(result.settings?.enVoice||''))result=await deadline(plugin.setSpeechSettings({settings:next}));}
        accept(result);
    }
    function acceptWeb(){
        const all=webVoices(),next=offlineConfig(config,all);
        if(next.koVoice!==config.koVoice||next.enVoice!==config.enVoice)root.localStorage.setItem('solarless_web_speech_settings',JSON.stringify(next));
        config=next;catalog=all.filter(root.VoiceCatalog.installed);
    }
    function controls(){el('speech-settings-controls').disabled=busy||!ready;el('btn-refresh-voices').disabled=busy;}
    function render(){
        if(!initialized)return;
        const text={
            'speech-settings-title':label('안내 목소리','Guidance voices'),
            'speech-ko-label':config.unifiedVoice?label('한국어 안내 · 영문 도로명 포함','Korean guidance · includes English road names'):label('한국어 목소리','Korean voice'),
            'speech-en-label':config.unifiedVoice?label('영어 안내 목소리','English guidance voice'):label('영어 목소리 · 영어 도로명','English voice · English road names'),
            'speech-mode-label':label('한영 혼합 안내','Mixed-language guidance'),
            'speech-mode-help':config.unifiedVoice
                ?label('선택한 목소리 하나로 문장 전체를 읽고 영어 도로명에 발음 언어 정보를 전달합니다. 실제 발음·음색 유지 여부는 음성 엔진에 따라 다릅니다.','Uses one selected voice for the whole instruction and passes language hints for English roads. Pronunciation and speaker consistency depend on the engine.')
                :label('한국어와 영어를 각각 선택한 목소리로 읽습니다. 도로명에서 음색이 바뀔 수 있습니다.','Uses the selected Korean and English voices separately. The tone can change at road names.'),
            'speech-comparison-help':label('같은 한영 문장을 같은 속도·음높이로 비교합니다. 설정은 바뀌지 않습니다. 발음과 음색이 유지되는지 직접 들어보세요.','Compare the same Korean/English sentence at the same rate and pitch without changing settings. Listen for pronunciation and speaker consistency.'),
            'btn-compare-default':label('기본 목소리로 비교 듣기','Compare: default Korean voice'),
            'btn-compare-selected':label('선택한 목소리로 비교 듣기','Compare: selected Korean voice'),
            'speech-comparison-details-label':label('비교 정보 · 엔진 보고값','Comparison details · engine-reported'),
            'btn-preview-ko':label('한국어 미리 듣기','Preview Korean'),'btn-preview-en':label('영어 미리 듣기','Preview English'),
            'speech-rate-label':label('말하기 속도 · 두 언어 공통','Speech rate · both languages'),
            'speech-pitch-label':label('음높이 · 두 언어 공통','Pitch · both languages'),
            'btn-reset-voices':label('음성 설정 초기화','Reset voice settings'),'btn-refresh-voices':label('목소리 목록 새로고침','Refresh voices'),
            'speech-settings-help':label('가람·Alex 등은 구분용 별칭입니다. 성별·음색은 미리 듣기로 확인하고 메모해 두세요. 품질·응답은 엔진 제공 등급입니다. 설치된 기기용 음성만 표시합니다. Android에서는 PiP·화면 꺼짐에도 설정을 유지합니다. 엔진 변경 후 앱을 다시 켜 주세요.','Garam, Alex and similar names are app nicknames. Preview each voice and note its tone. Quality and response are engine-reported ratings. Only installed on-device voices are listed. Android keeps settings in PiP and with the screen off. Restart after changing engines.')
        };
        for(const [id,value] of Object.entries(text))el(id).textContent=value;
        el('speech-comparison').hidden=!native()?.compareSpeechPreview;
        el('speech-mode').value=config.unifiedVoice?'unified':'separate';
        el('speech-mode').options[0].textContent=label('한 목소리로 통일 (기본)','One voice throughout (default)');
        el('speech-mode').options[1].textContent=label('언어별 목소리 · 발음 우선','Separate voices · language pronunciation');
        for(const language of ['ko','en']){
            const selector=el('speech-voice-'+language),id=config[language+'Voice'];selector.replaceChildren();
            const option=(value,text)=>{const o=root.document.createElement('option');o.value=value;o.textContent=text;selector.appendChild(o);};
            option('',label('기기용 기본','On-device default'));
            const choices=catalog.filter(v=>matches(language,v));
            for(const voice of choices)option(voice.id,root.VoiceCatalog.label(voice,ko()?'ko':'en')+(notes[voice.id]?` · ${notes[voice.id].slice(0,32)}`:''));
            if(id&&!choices.some(v=>v.id===id))option(id,label('사용 불가 · 기본 음성으로 대체','Unavailable · using language default'));
            selector.value=id;
            const voice=choices.find(v=>v.id===id);
            el('speech-details-'+language).textContent=root.VoiceCatalog.details(voice,ko()?'ko':'en');
            el('speech-original-label-'+language).textContent=label('원래 음성 이름 보기','Show original voice name');
            el('speech-original-'+language).textContent=voice?`${voice.name} · ${voice.id}`:label('시스템 기본 또는 사용 불가','System default or unavailable');
            el('speech-note-label-'+language).textContent=label('내 음색 메모 · 이 기기에 저장','My tone note · saved on this device');
            const note=el('speech-note-'+language);note.value=notes[id]||'';note.disabled=!voice;
            note.placeholder=label('예: 낮은 남성, 밝은 여성 (듣고 입력)','Example: low male, bright female (after listening)');
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
                await acceptNative(result,plugin);
            }else{try{config=normalize(JSON.parse(root.localStorage.getItem('solarless_web_speech_settings')||'{}'));}catch{config={...defaults};}acceptWeb();ready=!!root.speechSynthesis;}
            render();status(summary());
        }catch{ready=false;render();status(label('음성 목록을 읽지 못했습니다. 다시 새로고침하세요.','Could not load voices. Please refresh again.'));}
        finally{busy=false;controls();}
    }
    async function save(next){
        if(busy||!ready)return;busy=true;controls();status(label('저장 중…','Saving…'));
        try{
            const normalized=offlineConfig(next,catalog),plugin=native();
            if(plugin)await acceptNative(await deadline(plugin.setSpeechSettings({settings:normalized})),plugin);
            else{root.localStorage.setItem('solarless_web_speech_settings',JSON.stringify(normalized));config=normalized;}
            root.TTSVoice?.resetGuidance();
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
    async function compare(useDefault){
        if(busy||!ready)return;
        if(!canPreview()){status(label('주행 안내를 종료한 뒤 미리 들어보세요.','End guidance before previewing.'));return;}
        if(root.TTSVoice.isMuted()){status(label('상단 스피커 버튼으로 음성을 켜 주세요.','Enable voice using the speaker button first.'));return;}
        const plugin=native();if(!plugin?.compareSpeechPreview)return;
        busy=true;controls();
        try{
            const result=await deadline(plugin.compareSpeechPreview({useDefault}));
            if(!result.accepted)throw Error('PREVIEW_UNAVAILABLE');
            const source=useDefault?label('기본','Default'):label('선택','Selected');
            el('speech-comparison-details').textContent=`${source} · ${result.engine||''} · ${result.requestedVoice||label('기기용 기본','On-device default')} → ${(result.reportedVoices||[]).join(', ')} · ${result.rate}× / ${result.pitch}×`;
            status(result.voiceFallback?label('선택한 음성이 없어 기본 음성으로 비교했습니다.','Selected voice unavailable; compared using the default voice.'):label('비교 재생을 요청했습니다. 설정은 바뀌지 않았습니다.','Comparison requested. Settings are unchanged.'));
        }catch{status(label('비교 재생을 시작하지 못했습니다. 안내 종료·음량·설치 음성을 확인하세요.','Could not start comparison. End guidance and check volume and installed voices.'));}
        finally{busy=false;controls();}
    }
    function init(options={}){
        if(initialized)return;initialized=true;canPreview=options.canPreview||canPreview;
        try{const stored=JSON.parse(root.localStorage.getItem('solarless_voice_notes')||'{}');for(const [id,note] of Object.entries(stored||{}).slice(0,200))if(typeof note==='string')notes[id]=note.slice(0,80);}catch{}
        el('btn-compare-default').addEventListener('click',()=>compare(true));
        el('btn-compare-selected').addEventListener('click',()=>compare(false));
        el('speech-mode').addEventListener('change',e=>save({...config,unifiedVoice:e.target.value==='unified'}));
        for(const language of ['ko','en']){
            el('speech-voice-'+language).addEventListener('change',e=>save({...config,[language+'Voice']:e.target.value}));
            el('btn-preview-'+language).addEventListener('click',()=>preview(language==='ko'?'ko-KR':'en-US'));
            el('speech-note-'+language).addEventListener('change',e=>{
                const id=config[language+'Voice'];if(!id)return;
                const next=Object.assign(Object.create(null),notes,{[id]:e.target.value.trim().slice(0,80)});
                if(Object.keys(next).length>200)delete next[Object.keys(next)[0]];
                try{root.localStorage.setItem('solarless_voice_notes',JSON.stringify(next));notes=next;render();status(label('음색 메모를 저장했습니다.','Tone note saved.'));}
                catch{status(label('메모를 저장하지 못했습니다.','Could not save the note.'));}
            });
        }
        for(const name of ['rate','pitch']){
            el('speech-'+name).addEventListener('input',e=>el('speech-'+name+'-value').textContent=Number(e.target.value).toFixed(2)+'×');
            el('speech-'+name).addEventListener('change',e=>save({...config,[name]:Number(e.target.value)}));
        }
        el('btn-reset-voices').addEventListener('click',()=>save(defaults));el('btn-refresh-voices').addEventListener('click',refresh);
        root.speechSynthesis?.addEventListener?.('voiceschanged',()=>{if(!native()&&!busy){acceptWeb();render();status(summary());}});
        render();refresh();
    }
    return {normalize,selected,init,refresh,render,get:()=>({...config})};
});
