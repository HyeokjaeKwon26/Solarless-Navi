/* Presentation policies; none of these settings change route matching or GPS. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.DriveExperience=api;})(typeof window!=='undefined'?window:globalThis,function(root){
    'use strict';
    const $=id=>root.document.getElementById(id),ko=()=>root.I18n.getLanguage().startsWith('ko');
    const t=(a,b)=>ko()?a:b;
    let initialized=false,compact=false,constrained=false,open=false;
    try{compact=root.localStorage?.getItem('solarless_compact_controls')==='true';}catch{}
    function same(a,b){
        const x=a?.analyzed?.coordinates,y=b?.analyzed?.coordinates;
        return a===b||!!(x?.length>1&&x.length===y?.length&&x.every((p,i)=>p[0]===y[i][0]&&p[1]===y[i][1]));
    }
    function groups(routes){
        const result=[];
        for(const role of ['fastest','glareFree','shade']){const route=routes[role];if(!route)continue;let group=result.find(g=>same(g.route,route));if(!group){group={route,roles:[]};result.push(group);}group.roles.push(role);}
        return result;
    }
    function controls(){
        if(!initialized)return;
        const effective=compact||constrained;
        root.document.body.classList.toggle('constrained-controls',constrained);
        root.document.body.classList.toggle('compact-controls',effective);
        root.document.body.classList.toggle('map-tools-open',open&&effective);
        $('toggle-compact-controls').checked=compact;
        $('btn-map-tools').setAttribute('aria-expanded',String(open&&effective));
        $('btn-map-tools').textContent=open?t('닫기','Close'):t('더보기','More');
        $('btn-map-tools').setAttribute('aria-label',open?t('지도 도구 닫기','Close map tools'):t('지도 도구 펼치기','Expand map tools'));
    }
    function init(){
        if(initialized)return;initialized=true;
        const section=root.document.createElement('section');section.className='settings-section';section.id='experience-settings';
        section.innerHTML='<h4 id="experience-title"></h4><div class="option-row settings-option"><div class="option-label-group"><span class="option-title" id="compact-controls-label"></span></div><label class="toggle-switch"><input type="checkbox" id="toggle-compact-controls" aria-labelledby="compact-controls-label"><span class="slider"></span></label></div><small id="compact-controls-note"></small><h4 id="alert-settings-title"></h4><div id="alert-settings-options"></div><small id="alert-settings-note"></small><button type="button" class="nav-btn secondary" id="btn-clear-entrances"></button><small id="experience-status" role="status"></small>';
        $('toggle-driving-focus').closest('.card-body').append(section);
        for(const type of ['glare','speeding','road']){
            const row=root.document.createElement('label');row.className='alert-setting-row';
            const label=root.document.createElement('span');label.id='alert-label-'+type;
            const select=root.document.createElement('select');select.id='alert-mode-'+type;select.setAttribute('aria-labelledby',label.id);
            for(const mode of ['both','visual','off']){const o=root.document.createElement('option');o.value=mode;select.append(o);}
            select.addEventListener('change',()=>{
                const ok=root.AlertSettings.set({...root.AlertSettings.get(),[type]:select.value});
                $('experience-status').textContent=ok?t('경고 설정을 저장했습니다.','Alert settings saved.'):t('설정을 저장하지 못했습니다.','Could not save settings.');render();
            });row.append(label,select);$('alert-settings-options').append(row);
        }
        $('btn-clear-entrances').addEventListener('click',()=>{$('experience-status').textContent=root.EntranceMemory.clear(root.localStorage)?t('기억한 입구를 삭제했습니다. 즐겨찾기는 유지됩니다.','Remembered entrances deleted. Favorites are unchanged.'):t('삭제하지 못했습니다.','Could not delete entrances.');});
        $('toggle-compact-controls').addEventListener('change',e=>{try{root.localStorage.setItem('solarless_compact_controls',String(e.target.checked));compact=e.target.checked;open=false;controls();}catch{e.target.checked=compact;$('experience-status').textContent=t('설정을 저장하지 못했습니다.','Could not save settings.');}});
        const button=root.document.createElement('button');button.type='button';button.id='btn-map-tools';button.className='map-floating-btn';button.setAttribute('aria-controls','btn-driving-view btn-route-legend btn-toggle-battery-saver btn-toggle-compass');
        $('btn-recenter-gps').before(button);button.addEventListener('click',()=>{open=!open;controls();});
        for(const id of ['btn-driving-view','btn-route-legend','btn-toggle-battery-saver','btn-toggle-compass'])$(id).classList.add('map-aux-tool');
        root.document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){open=false;controls();button.focus();}});
        root.document.addEventListener('pointerdown',e=>{if(open&&!e.target.closest('.map-controls-group')){open=false;controls();}});
        const arrival=root.document.createElement('p');arrival.id='arrival-pin-note';arrival.hidden=true;$('route-summary-box').append(arrival);
        const about=root.document.createElement('details');about.id='search-model-details';const heading=root.document.createElement('summary');heading.id='search-model-heading';about.append(heading,$('search-modal-sub'));$('search-modal-title').after(about);
        render();
    }
    function render(){
        if(!initialized)return;
        $('experience-title').textContent=t('주행 화면과 알림','Driving display and alerts');
        $('compact-controls-label').textContent=t('간결한 지도 도구','Compact map controls');
        $('compact-controls-note').textContent=t('재중앙은 항상 표시합니다. 좁은 화면에서는 자동으로 접습니다. 지도 도구는 더보기에서 펼칩니다.','Recenter stays visible. Controls also fold automatically when space is limited. Expand More for map tools.');
        $('alert-settings-title').textContent=t('경고별 알림','Alerts by type');
        const labels=ko()?['눈부심 예상','과속','고속도로·유료도로']:['Predicted glare','Speeding','Highways and toll roads'];
        ['glare','speeding','road'].forEach((type,i)=>{$('alert-label-'+type).textContent=labels[i];const select=$('alert-mode-'+type);select.value=root.AlertSettings.get()[type];[...select.options].forEach((o,j)=>o.textContent=(ko()?['음성 + 화면','화면만','끔']:['Voice + display','Display only','Off'])[j]);});
        $('alert-settings-note').textContent=t('회전·도착 안내와 경로 색상은 유지됩니다. 회전 안내 중에는 일반 경고 음성을 보류합니다.','Turn/arrival guidance and route colors stay enabled. General alert speech waits while turn guidance is protected.');
        $('btn-clear-entrances').textContent=t('기억한 차량 입구 삭제','Delete remembered vehicle entrances');
        $('search-model-heading').textContent=t('햇빛 경로는 어떻게 계산하나요?','How are sun-aware routes estimated?');controls();
    }
    function routeSummary(data){
        if(!initialized)return;
        const container=root.document.querySelector('.mode-options'),routes=data.routes;
        const buttons=Object.fromEntries(['fastest','glareFree','shade'].map(role=>[role,container.querySelector('[data-mode="'+role+'"]')]));
        const active=root.document.activeElement;
        const fragment=root.document.createDocumentFragment();
        for(const group of groups(routes)){
            const wrapper=root.document.createElement('section');wrapper.className='route-choice-group';
            const title=root.document.createElement('p');title.className='route-choice-summary';
            const trade=root.JourneyPolicy.solarTradeoff(routes.fastest,group.route);
            const delta=group.route.durationSec-routes.fastest.durationSec;
            const time=Math.abs(delta)<30?t('추가 시간 없음','No extra time'):`${delta>=0?'+':'−'}${Math.round(Math.abs(delta)/60)} ${t('분','min')}`;
            title.textContent=time+' · '+(same(group.route,routes.fastest)?t('최단시간 경로','Fastest route'):!trade?.comparable?t('햇빛 비교 자료 부족','Insufficient comparable sun data'):trade.glareReductionPoints>0?t(`눈부심 위험 추정 ${Math.round(trade.glareReductionPoints)}%p 감소`,`Estimated glare risk −${Math.round(trade.glareReductionPoints)} pp`):trade.sunlitSecondsSaved>0?t(`직사광 노출 추정 ${Math.round(trade.sunlitSecondsSaved/60)}분 감소`,`Estimated direct sun −${Math.round(trade.sunlitSecondsSaved/60)} min`):t('햇빛 감소 확인 안 됨','No estimated sun reduction'));
            if(group.roles.length>1)title.textContent+=' · '+t('같은 경로, 선호도만 선택','Same route; choose a preference');
            wrapper.append(title);
            group.roles.forEach((role,i)=>{
                const button=buttons[role];button.classList.toggle('shared-route-role',i>0);wrapper.append(button);
                if(role==='glareFree'&&same(group.route,routes.fastest)){
                    const reason=root.document.createElement('small');reason.className='route-choice-reason';
                    reason.textContent=data.enrichmentPending?t('기상·차폐 분석 중입니다.','Weather and shade analysis pending.'):root.RoutePresentation.fallbackText(root.ShadowRouter.glareAlternativeReason(routes,routes.glareFree,data.preferenceBudgetMinutes),root.I18n.getLanguage());wrapper.append(reason);
                }
                if(role==='shade'&&same(group.route,routes.fastest)){
                    const note=root.document.createElement('small');note.className='route-choice-reason';
                    note.textContent=t('그늘 우선: 확인한 후보에서 우회 한도와 햇빛 감소 조건을 함께 충족한 다른 경로가 없습니다.','Shade preference: no other evaluated candidate met both detour and sun-reduction requirements.');wrapper.append(note);
                }
            });fragment.append(wrapper);
        }
        container.replaceChildren(fragment);if(active?.isConnected&&Object.values(buttons).includes(active))active.focus({preventScroll:true});
    }
    function arrival(live,remaining,end,route){
        if(!initialized)return;
        const el=$('arrival-pin-note');el.hidden=!(live&&Number.isFinite(remaining)&&remaining<=500&&end);
        if(el.hidden)return;
        const endpoint=root.ShadowRouter.getRouteEndpoint(route),gap=endpoint?root.ShadowRouter.calculateDistanceMeters(end.lat,end.lng,endpoint.lat,endpoint.lng):null;
        el.textContent=(end.entranceConfirmed?t('선택한 차량 입구로 접근 중 · 현장 진입 방향 확인','Approaching your confirmed entrance · check access direction on site'):t('선택한 도착점으로 접근 중 · 차량 입구 미확인','Approaching your arrival pin · vehicle entrance unverified'))+(gap>25?' · '+t(`경로 끝과 핀 ${root.NavigationUnits.distance(gap)} 차이`,`Route ends ${root.NavigationUnits.distance(gap)} from pin`):'');
    }
    // Layout measurements may cross the folding threshold during resize or
    // junction refinement. Preserve an explicit user opening across those
    // measurements; outside taps / Escape / the toggle still close it.
    return {init,render,routeSummary,arrival,groups,same,setConstrained(value){if(constrained!==value){constrained=value;controls();}},closeTools(){open=false;controls();}};
});
