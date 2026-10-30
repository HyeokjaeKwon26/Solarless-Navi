/* Reuse the existing controls and listeners; no new location or render timer. */
window.SettingsLayout=(()=>{
    const panel=document.getElementById('sidebar-panel'),$=id=>document.getElementById(id);
    let view='basic';try{view=localStorage.getItem('solarless_settings_view')==='all'?'all':'basic';}catch{}
    const nav=document.createElement('nav');nav.className='settings-navigation';nav.id='settings-navigation';
    nav.innerHTML='<div class="settings-view-switch"><button type="button" id="settings-basic" class="nav-btn secondary"></button><button type="button" id="settings-all" class="nav-btn secondary"></button></div><div class="settings-shortcuts"></div>';
    panel.querySelector('.search-card').after(nav);
    function card(id){const box=document.createElement('div');box.id=id;box.className='card settings-common-card';return box;}
    const route=card('settings-route'),update=card('settings-update');
    route.append($('route-preference').closest('section'),$('toggle-toll-free').closest('.option-row'),$('btn-compare-routes'),$('btn-arrival-preview'));
    update.append($('btn-check-update').closest('section'));
    nav.after(route);
    const display=$('navigation-units').closest('.card');display.id='settings-display';
    const voice=document.createElement('details');voice.id='settings-voice';voice.className='card settings-common-card';
    voice.innerHTML='<summary id="settings-voice-summary"></summary>';
    voice.append($('speech-settings-title').closest('section'),$('btn-preview-voice'));
    display.after(voice,update);
    // Existing research, simulation, offline and diagnostics tools remain in All.
    for(const selector of ['.time-card','.mode-card','.hud-card','.pip-settings-card'])panel.querySelector(selector)?.classList.add('settings-advanced');
    for(const id of ['speech-mode-label','speech-mode','speech-mode-help','speech-note-label-ko','speech-note-ko','speech-note-label-en','speech-note-en','speech-comparison','speech-pitch-label','speech-pitch-value','speech-pitch','btn-reset-voices','speech-settings-help','speech-playback-diagnostics'])$(id)?.classList.add('settings-advanced');
    for(const lang of ['ko','en'])$('speech-original-'+lang).closest('details').classList.add('settings-advanced');
    const links=[['route','경로','Route'],['display','화면·단위','Display / units'],['voice','목소리','Voices'],['update','업데이트','Updates']];
    for(const [id] of links){
        const button=document.createElement('button');button.type='button';button.className='settings-shortcut';button.id='settings-go-'+id;
        button.addEventListener('click',()=>{const target=$('settings-'+id);if(target===voice)voice.open=true;target.scrollIntoView({block:'start'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});});
        nav.querySelector('.settings-shortcuts').append(button);
    }
    function render(){
        const ko=I18n.getLanguage().startsWith('ko');
        nav.setAttribute('aria-label',ko?'설정 바로가기':'Settings navigation');
        $('settings-basic').textContent=ko?'자주 쓰는 설정':'Everyday settings';$('settings-all').textContent=ko?'전체 설정':'All settings';
        $('settings-voice-summary').textContent=ko?'안내 목소리 · 선택·미리 듣기':'Guidance voices · select and preview';
        for(const [id,a,b] of links)$('settings-go-'+id).textContent=ko?a:b;
        panel.dataset.settingsView=view;
        for(const name of ['basic','all'])$('settings-'+name).setAttribute('aria-pressed',String(view===name));
    }
    function select(next){
        view=next;try{localStorage.setItem('solarless_settings_view',view);}catch{}
        $('settings-'+next).focus();if(next==='all')voice.open=true;
        render();nav.scrollIntoView({block:'start'});
    }
    $('settings-basic').addEventListener('click',()=>select('basic'));$('settings-all').addEventListener('click',()=>select('all'));
    voice.open=view==='all';render();return {render};
})();
