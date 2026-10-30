(function(root){
    'use strict';
    let modal,map,layer,trigger;
    const ko=()=>root.I18n.getLanguage().startsWith('ko'),t=(a,b)=>ko()?a:b;
    function close(){if(map){map.remove();map=null;}if(modal){modal.remove();modal=null;}trigger?.focus();}
    function show(routes,baseline,selected){
        close();if(!routes?.length||!baseline?.analyzed?.coordinates?.length)return;trigger=document.activeElement;
        modal=document.createElement('div');modal.id='route-compare-modal';modal.className='map-review-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','route-compare-title');
        const card=document.createElement('section');card.className='map-review-card';const title=document.createElement('h3');title.id='route-compare-title';title.textContent=t('경로 차이 비교','Compare route differences');
        const select=document.createElement('select');select.id='route-compare-select';select.setAttribute('aria-label',title.textContent);
        const groups=root.RouteComparison.groups(routes);for(const [i,g] of groups.entries()){const o=document.createElement('option');o.value=i;o.textContent=`${i+1} · ${Math.round(g.route.durationSec/60)} ${ko()?'분':'min'} · ${root.NavigationUnits.distance(g.route.distanceMeters,{long:true})}`+(g.members.length>1?t(` · 같은 경로 ${g.members.length}개 묶음`,` · ${g.members.length} identical routes grouped`):'');select.append(o);}
        const canvas=document.createElement('div');canvas.id='route-compare-map';const summary=document.createElement('p');summary.id='route-compare-summary';
        const note=document.createElement('p');note.textContent=t('회색: 기준 경로 · 파랑: 비교 경로의 다른 구간 · 보라: 대략적인 공유 구간 · 주황: 눈부심 예상. 색은 실측값이 아닙니다. 경로 선택은 바뀌지 않습니다.','Gray: baseline · blue: different sections · purple: approximate shared sections · orange: predicted glare. Predictions are not measurements. Your selected route is unchanged.');
        const button=document.createElement('button');button.id='route-compare-close';button.className='nav-btn secondary';button.textContent=t('닫기','Close');button.onclick=close;
        card.append(title,select,summary,canvas,note,button);modal.append(card);document.body.append(modal);
        modal.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const all=[select,button],at=all.indexOf(document.activeElement);event.preventDefault();all[(at+(event.shiftKey?-1:1)+all.length)%all.length].focus();}});
        map=root.L.map(canvas,{zoomControl:false}).setView([0,0],2);
        root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
        function draw(){
            const route=groups[Number(select.value)]?.route;if(!route)return;if(layer)layer.remove();layer=root.L.featureGroup().addTo(map);
            const points=p=>p.map(v=>[v[1],v[0]]),base=baseline.analyzed.coordinates;
            root.L.polyline(points(base),{color:'#64748b',weight:6,opacity:.7}).addTo(layer);
            for(const section of root.RouteComparison.differences(route,baseline))root.L.polyline(points(section.coordinates),{color:section.shared?'#a855f7':'#0284c7',weight:5}).addTo(layer);
            const hot=(route.analyzed.segments||[]).filter(s=>{const a=root.RoutePresentation.assessment(s);return !a.uncertain&&a.warningRisk>.45;}).slice(0,256);
            for(const s of hot)root.L.polyline([s.p1,s.p2],{color:'#f59e0b',weight:7}).addTo(layer);
            const ease=root.JourneyUpgrades.complexity(route);
            const value=root.JourneyPolicy.solarTradeoff(baseline,route),extra=value?`${value.extraSeconds>=0?'+':''}${(value.extraSeconds/60).toFixed(1)} ${ko()?'분':'min'}`:'—';
            summary.textContent=t('기준 대비 시간 ','Time vs baseline ')+extra+' · '+(value?.comparable?t(`직사광선 감소 추정 ${(value.sunlitSecondsSaved/60).toFixed(1)}분`,`Predicted direct-sun reduction ${(value.sunlitSecondsSaved/60).toFixed(1)} min`):t('분석 조건이 달라 햇빛 감소 비교 불가','Sun reduction unavailable: different analysis conditions'));
            if(ease.known)summary.textContent+=t(` · 회전 ${ease.turns} · 연속 회전 ${ease.rapidTurns} · 급회전 ${ease.sharpTurns}`,` · ${ease.turns} turns · ${ease.rapidTurns} close turns · ${ease.sharpTurns} sharp turns`);
            map.invalidateSize();map.fitBounds(layer.getBounds(),{padding:[20,20],maxZoom:17,animate:false});
        }
        select.value=Math.max(0,groups.findIndex(g=>g.members.some(r=>r===selected||r.id===selected?.id)));select.onchange=draw;draw();select.focus();
    }
    root.RouteCompareView={show,close};
})(window);
