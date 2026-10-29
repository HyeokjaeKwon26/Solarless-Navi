(function(root){
    'use strict';
    let initialized=false,notify=()=>{},state={},preferences=root.NavigationMap.settings(root.localStorage);const $=id=>document.getElementById(id),ko=()=>root.I18n.getLanguage().startsWith('ko'),t=(a,b)=>ko()?a:b;
    const names={style:['주행용 도로·글자 강조','Driving road and label style'],arrows:['지도 위 회전 화살표','Turn arrows on the map'],buildings:['주변 3D 건물 · 자동 단순화','Nearby 3D buildings · adaptive'],arrival:['도착점·차량 입구 지도','Arrival pin and entrance map'],cache:['본 지도 임시 저장 · 최대 32 MiB','Cache viewed maps · up to 32 MiB'],shade:['경로 주변 예상 그늘 표시','Estimated shade along route'],terrain:['입체 지형·지형 음영','3D terrain and hillshade']};
    function init(onChange){
        if(initialized)return;initialized=true;notify=onChange||notify;const section=document.createElement('section');section.id='map-detail-settings';section.className='settings-section';
        const heading=document.createElement('h4');heading.id='map-detail-title';section.append(heading);
        const presetLabel=document.createElement('label');presetLabel.id='map-preset-label';presetLabel.htmlFor='map-detail-preset';
        const preset=document.createElement('select');preset.id='map-detail-preset';
        for(const key of ['basic','detailed','low','custom']){const o=document.createElement('option');o.value=key;preset.append(o);}preset.lastChild.disabled=true;
        preset.onchange=()=>{try{const prefs={...root.NavigationMap.presets[preset.value]};localStorage.setItem('solarless_map_details',JSON.stringify(prefs));preferences=prefs;root.MapCache.setDisabled(!prefs.cache);notify('preset');render();}catch{$('map-detail-message').textContent=t('설정 저장 실패','Could not save settings');render();}};
        section.append(presetLabel,preset);
        for(const key of Object.keys(names)){
            const row=document.createElement('div');row.className='option-row settings-option';const group=document.createElement('div');group.className='option-label-group';const label=document.createElement('span');label.id='map-detail-label-'+key;label.className='option-title';group.append(label);
            const toggle=document.createElement('label');toggle.className='toggle-switch';const input=document.createElement('input');input.type='checkbox';input.id='map-detail-'+key;input.setAttribute('aria-labelledby',label.id);const slider=document.createElement('span');slider.className='slider';toggle.append(input,slider);row.append(group,toggle);section.append(row);
            input.onchange=()=>{try{const prefs={...preferences};prefs[key]=input.checked;localStorage.setItem('solarless_map_details',JSON.stringify(prefs));preferences=prefs;if(key==='cache')root.MapCache.setDisabled(!input.checked);notify(key);render();}catch{$('map-detail-message').textContent=t('설정을 저장하지 못했습니다.','Could not save settings.');render();}};
        }
        for(const id of ['map-detail-note','map-cache-status','map-detail-message']){const p=document.createElement('p');p.id=id;section.append(p);}
        for(const [id,action] of [['map-cache-refresh',async()=>refresh()],['map-cache-clear',async()=>{const ok=await root.MapCache.clear();await refresh();$('map-detail-message').textContent=ok?t('지도 캐시를 삭제했습니다.','Map cache cleared.'):t('캐시 삭제 실패','Could not clear cache');}]]){const b=document.createElement('button');b.type='button';b.id=id;b.className='nav-btn secondary';b.onclick=action;section.append(b);}
        $('experience-settings').after(section);
        root.StorageSettings.init(section);
        const note=document.createElement('p');note.id='map-detail-status';note.hidden=true;$('route-summary-box').append(note);root.addEventListener('map-cache-status',()=>status(state));render();refresh();
    }
    async function refresh(){if(!initialized)return;const s=await root.MapCache.stats();$('map-cache-status').textContent=t(`지도 캐시 ${(s.bytes/1048576).toFixed(1)} / ${s.maxBytes/1048576} MiB · ${s.count}개`,`Map cache ${(s.bytes/1048576).toFixed(1)} / ${s.maxBytes/1048576} MiB · ${s.count} resources`)+(s.native?'':t(' · 앱에서 사용 가능',' · available in the Android app'))+(s.storageFailed?t(' · 저장 공간 사용 불가',' · storage unavailable'):'');await root.StorageSettings.refresh();}
    function render(){
        if(!initialized)return;const prefs=root.NavigationMap.settings(localStorage);$('map-detail-title').textContent=t('지도 표시와 저장 공간','Map display and storage');
        $('map-preset-label').textContent=t('지도 표시 프리셋','Map display preset');
        for(const o of $('map-detail-preset').options)o.textContent=({basic:t('기본','Basic'),detailed:t('상세 · 추가 지도 자료 사용','Detailed · additional map data'),low:t('저부하 · 건물·지형·그늘 끄기','Low load · no buildings, terrain or shade'),custom:t('개별 설정','Custom')})[o.value];
        $('map-detail-preset').value=root.NavigationMap.presetName(prefs);root.StorageSettings.render();
        for(const [key,text] of Object.entries(names)){$('map-detail-label-'+key).textContent=t(...text);$('map-detail-'+key).checked=prefs[key];}
        $('map-detail-note').textContent=t('건물은 높이 60m·주변 450m로 제한합니다. 교차로·도착점 주변에서는 숨깁니다. 그늘은 경로의 예상 통과 시각 기준이며 주변 전체의 그림자 모양이 아닙니다. 입체 지형은 별도 고도 자료이며 차로·고가도로 높이 판단에 사용하지 않습니다. 발열·화면 지연 시 추가 표현을 줄입니다.','Buildings are limited to 60 m height and 450 m surroundings, and hidden near turns/arrival. Shade describes expected passing times on the route, not shadow footprints of the whole area. Terrain is separate elevation data, not lane or bridge-height detection. Extra details reduce under thermal/render pressure.');
        $('map-cache-refresh').textContent=t('저장 공간 확인','Check storage');$('map-cache-clear').textContent=t('지도 캐시 삭제','Clear map cache');$('map-cache-clear').disabled=root.StorageBudget.protected();status(state);
    }
    function status(next){state=next;if(!initialized)return;const note=$('map-detail-status'),parts=[];
        if(next.arrival)parts.push(next.confirmed?t('선택한 차량 입구','Selected vehicle entrance'):t('도착점 · 차량 입구 미확인','Arrival pin · entrance unverified'));
        if(next.arrival&&next.gap>10)parts.push(t('점선은 도착점과 경로 끝의 차이 · 주행 경로 아님','Dashed connector is the gap to the pin, not a driving route'));
        if(next.shade&&!next.reduced)parts.push(t('그늘 띠: 보라 예상 그늘 · 노랑 노출 · 회색 자료 부족','Shade band: purple predicted shade · yellow exposed · gray unknown'));
        if(next.terrain)parts.push(t('지형: Mapterhorn · 경사 과장 없음','Terrain: Mapterhorn · true-scale elevation'));
        if(next.terrainFailed)parts.push(t('지형 자료 없음 · 평면 지도 유지','Terrain unavailable · flat map retained'));
        if(next.reduced)parts.push(t('지도 추가 표현 자동 축소','Extra map detail reduced'));
        if(root.MapCache.status().offline)parts.push(t('저장 지도 사용 중 · 최신 도로 미확인','Using cached map · road freshness unverified'));
        const text=parts.join(' · ');if(note.textContent!==text)note.textContent=text;note.hidden=!text;
    }
    root.MapDetailSettings={init,render,refresh,status,get:()=>preferences};
})(window);
