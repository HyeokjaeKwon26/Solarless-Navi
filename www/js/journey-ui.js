/* Small recovery/measurement surfaces. All location choices require confirmation. */
(function(root){
    'use strict';
    const $=id=>document.getElementById(id),ko=()=>root.I18n.getLanguage().startsWith('ko'),t=(a,b)=>ko()?a:b;
    let schematic,eta,status,shapeKey='',shapeRoute=null,statusTimer;
    function init(){
        schematic=document.createElement('div');schematic.id='junction-schematic';schematic.hidden=true;document.querySelector('#mobile-turn-banner .banner-info').append(schematic);
        eta=document.createElement('p');eta.id='eta-evidence';eta.hidden=true;$('route-summary-box').append(eta);
        status=document.createElement('p');status.id='journey-request-status';status.hidden=true;status.setAttribute('role','status');$('route-summary-box').append(status);
    }
    function junction(route,turn,visible){
        if(!schematic)return;
        schematic.hidden=!(visible&&turn&&root.NavigationGuidance.complexTurn(turn)&&route?.analyzed?.coordinates?.length);
        if(schematic.hidden){shapeKey='';return;}
        const key=[route.id,turn.sequence,turn.progressMeters,root.I18n.getLanguage()].join('|');if(key===shapeKey&&shapeRoute===route.analyzed.coordinates)return;shapeKey=key;shapeRoute=route.analyzed.coordinates;
        const points=root.JunctionPreview.shape(root.NavigationGuidance.model(route),turn);if(!points){schematic.hidden=true;return;}
        const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 160 90');svg.setAttribute('role','img');svg.setAttribute('aria-label',t('다가오는 회전의 경로 모양','Upcoming turn route shape'));
        const path=document.createElementNS(ns,'polyline');path.setAttribute('points',points.map(p=>p.join(',')).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#38bdf8');path.setAttribute('stroke-width','7');path.setAttribute('stroke-linejoin','round');path.setAttribute('stroke-linecap','round');svg.append(path);
        const start=document.createElementNS(ns,'circle');start.setAttribute('cx',points[0][0]);start.setAttribute('cy',points[0][1]);start.setAttribute('r','5');start.setAttribute('fill','#fff');svg.append(start);
        const label=document.createElement('small');label.textContent=t('회전 경로 개요 · 차로 위치 아님','Turn overview · not lane position');schematic.replaceChildren(svg,label);
    }
    function etaEvidence(base,estimate,delay,active){
        if(!eta)return;const range=estimate?.range;eta.hidden=!active||(!range&&delay<10);
        const parts=[];
        if(range){const low=Math.max(1,Math.floor(base*range.lowFactor/60)),high=Math.max(low,Math.ceil(base*range.highFactor/60));parts.push(t(`같은 시간대 기록 ${range.count}회: ${low}–${high}분`,`Same-time history (${range.count} trips): ${low}–${high} min`));}
        if(delay>=10)parts.push(t(`최근 지연 약 +${Math.round(delay)}초`,`Recent slowdown about +${Math.round(delay)} s`));
        eta.textContent=parts.join(' · ')+(parts.length?t(' · 실시간 교통 예측 아님',' · not a live traffic forecast'):'');
    }
    function requestState(value,reason){
        if(!status)return;clearTimeout(statusTimer);status.hidden=!value;
        status.textContent=value==='pending'?t('현재 위치에서 새 경로 확인 중…','Checking a new route from your position…'):value==='failed'?t('새 경로 확인 실패 · 연결 복구 후 다시 시도합니다','New route unavailable · retry after connectivity recovers'):value==='ready'?(reason==='forward-recovery'?t('초기 유턴을 피하는 경로로 갱신했습니다','Updated to a route avoiding an early U-turn'):t('새 경로로 안내합니다','Guidance updated')):'';
        if(value==='ready')statusTimer=setTimeout(()=>{status.hidden=true;},7000);
    }
    function searchRecovery(dropdown,input,options){
        const actions=document.createElement('div');actions.className='search-recovery-actions';
        const city=document.createElement('label');city.textContent=t('도시·주 또는 우편번호','City, state or postal code');const field=document.createElement('input');field.type='text';field.maxLength=100;field.placeholder=t('예: Brookline, MA','e.g. Brookline, MA');city.append(field);
        const submit=document.createElement('button');submit.type='button';submit.className='nav-btn secondary';submit.textContent=t('지역 추가해 검색','Search with area');submit.onclick=e=>{e.stopPropagation();if(!field.value.trim()){field.focus();return;}input.value=input.value.trim()+', '+field.value.trim();options.submit();};
        actions.append(city,submit);
        if(options.pin){const pin=document.createElement('button');pin.type='button';pin.className='nav-btn secondary';pin.textContent=t('지도에서 도착점 지정','Choose arrival pin on map');pin.onclick=e=>{e.stopPropagation();options.pin();};actions.append(pin);}
        if(options.recent){const recent=document.createElement('button');recent.type='button';recent.className='nav-btn secondary';recent.textContent=t('최근 선택한 주소 보기','Show recently selected addresses');recent.onclick=e=>{e.stopPropagation();options.recent();};actions.append(recent);}
        // Keep the existing listbox for results; action controls belong beside it.
        const previous=dropdown.parentElement.querySelector('.search-recovery-actions');previous?.remove();dropdown.after(actions);dropdown.parentElement.classList.add('search-recovery-active');
        return actions;
    }
    root.JourneyUI={init,junction,etaEvidence,requestState,searchRecovery};
})(window);
