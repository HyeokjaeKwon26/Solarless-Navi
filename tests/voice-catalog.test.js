const test=require('node:test'),assert=require('node:assert/strict');
const catalog=require('../js/voice-catalog');
const voice=(code,language='ko-KR',network=false)=>({id:'android:engine:'+code,name:code,lang:language,networkRequired:network,quality:400,latency:200});
test('opaque Korean and English codes receive stable app nicknames and variants remain distinguishable',()=>{
    const ko=voice('ko-kr-x-ism-local'),online=voice('ko-kr-x-ism-network','ko-KR',true);
    assert.equal(catalog.name(ko,'ko'),'가람');assert.equal(catalog.name(online,'ko'),'가람');
    assert.match(catalog.label(ko,'ko'),/기기용/);assert.match(catalog.label(online,'ko'),/인터넷용/);
    assert.equal(catalog.name(voice('en-us-x-iob-local','en-US'),'en'),'Alex');
    assert.match(catalog.label(voice('en-us-x-iog-local','en-GB'),'ko'),/영국 영어/);
    assert.equal(catalog.name(voice('ko-KR-language'),'ko'),'기본 음색');
    const choices=['ism','kob','koc','kod'].map(v=>voice(`ko-kr-x-${v}-local`));
    assert.equal(new Set(choices.map(v=>catalog.name(v,'ko'))).size,4);
    assert.deepEqual(choices.map(v=>catalog.label(v,'ko')),choices.slice().reverse().map(v=>catalog.label(v,'ko')).reverse());
});
test('catalog describes only engine-provided properties and preserves readable names',()=>{
    assert.match(catalog.details(voice('ko-kr-x-kob-local'),'ko'),/품질: 높음 · 응답: 빠름/);
    assert.doesNotMatch(catalog.details(voice('ko-kr-x-kob-local'),'ko'),/남성|여성/);
    assert.match(catalog.details({name:'Unknown'},'en'),/Unlisted/);
    assert.equal(catalog.name({id:'web:voice',name:'Microsoft David',lang:'en-US'},'en'),'Microsoft David');
    const unfamiliar=voice('en-us-x-new123-local','en-US');
    assert.doesNotMatch(catalog.label(unfamiliar,'en'),/en-us-x-new123/);
    assert.equal(catalog.name(unfamiliar,'en'),catalog.name({...unfamiliar,name:'en-us-x-new123-network',id:'android:engine:en-us-x-new123-network'},'en'));
});

test('online voice selections migrate only to a matching installed voice from the same engine',()=>{
    const local=voice('ko-kr-x-koc-local'),online=voice('ko-kr-x-koc-network','ko-KR',true);
    assert.equal(catalog.localId(online.id,'ko',[online,local]),local.id);
    assert.equal(catalog.localId(online.id,'ko',[{...local,id:local.id.replace('engine','other')}]),'');
    assert.equal(catalog.localId(online.id,'en',[local]),'');
    assert.equal(catalog.localId('vendor:cloud','ko',[{id:'vendor:cloud',lang:'ko-KR',networkRequired:true}]),'');
    assert.equal(catalog.localId('missing:installed','ko',[]),'missing:installed');
    assert.deepEqual([online,local].filter(catalog.installed),[local]);
    assert.equal(catalog.installed({localService:false}),false);
});
