const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const settings=require('../js/voice-settings');
test('voice settings bound invalid values and retain language-specific stable IDs',()=>{
    assert.deepEqual(settings.normalize(null),{koVoice:'',enVoice:'',rate:1,pitch:1});
    assert.deepEqual(settings.normalize({koVoice:'engine:ko',enVoice:'engine:en',rate:9,pitch:-2}),{koVoice:'engine:ko',enVoice:'engine:en',rate:1.5,pitch:.75});
    assert.equal(settings.normalize({rate:NaN,pitch:Infinity}).rate,1);
    assert.equal(settings.normalize({rate:'0.7',pitch:Infinity}).pitch,1);
    const voices=[{id:'engine:en',lang:'en-GB'},{id:'engine:ko',lang:'ko-KR'}],config={koVoice:'engine:ko',enVoice:'engine:en'};
    assert.equal(settings.selected(config,'en-US',voices).id,'engine:en');
    assert.equal(settings.selected(config,'ko-KR',voices).id,'engine:ko');
    assert.equal(settings.selected({...config,enVoice:'engine:ko'},'en-US',voices),null);
    assert.equal(settings.selected(config,'en-US',voices.slice(1)),null);
});
test('web previews and bilingual guidance use separate voices with shared rate and pitch',async()=>{
    const voices=[{voiceURI:'ko2',lang:'ko-KR'},{voiceURI:'en2',lang:'en-GB'}],spoken=[];
    const root={navigator:{language:'ko-KR'},console,Date,SpeechSynthesisUtterance:function(text){this.text=text;},
        VoiceSettings:{get:()=>({koVoice:'web:ko2',enVoice:'web:en2',rate:.8,pitch:1.2})},
        NavigationGuidance:require('../js/navigation-guidance'),
        speechSynthesis:{getVoices:()=>voices,cancel(){},resume(){},speak:v=>spoken.push(v)}};
    root.window=root;vm.createContext(root);vm.runInContext(fs.readFileSync('js/tts-voice.js','utf8'),root);
    assert.equal(await root.TTSVoice.previewLanguage('en-US'),true);
    assert.equal(root.TTSVoice.getLanguage(),'ko-KR');assert.equal(spoken[0].voice.voiceURI,'en2');
    spoken.length=0;await root.TTSVoice.preview();
    assert.ok(spoken.some(v=>v.voice.voiceURI==='en2'));assert.ok(spoken.some(v=>v.voice.voiceURI==='ko2'));
    assert.ok(spoken.every(v=>v.rate===.8&&v.pitch===1.2));
    root.TTSVoice.toggleMute();assert.equal(await root.TTSVoice.previewLanguage('ko-KR'),false);
});
