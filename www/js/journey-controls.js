/* UI orchestration; the app owns active guidance and explicitly commits proposals. */
window.JourneyControls={create(api){
    const $=id=>document.getElementById(id),ko=()=>I18n.getLanguage().startsWith('ko');
    const text=(a,b)=>ko()?a:b;
    let tripController=null,tripMap=null,tripLayers=null,tripGeneration=0,tripBusy=false,lastPreviewAt=0;
    let proposal=null,proposalController=null,lastProposalAt=0,lastClosureKey='',dismissedKey='';
    const routeKey=route=>EtaLearning.routeKey(route),endKey=end=>JSON.stringify([end?.lat,end?.lng]);
    const distance=(a,b)=>ShadowRouter.calculateDistanceMeters(a.lat,a.lng,b.lat,b.lng);
    function snapshot(){const s=api.state();return {...s,routeKey:routeKey(s.route),destinationKey:endKey(s.end),position:s.start,now:Date.now()};}
    function matchingPlan(){const p=TripTools.get();return p&&TripTools.same(p.current.coords,api.state().end)?p:null;}
    function render(){
        const s=api.state(),p=matchingPlan(),c=JourneyUpgrades.complexity(s.route);
        $('route-preference-title').textContent=text('경로 선택','Route preference');
        $('route-preference-label').textContent=text('우선순위','Priority');
        $('route-budget-label').textContent=text('최단시간 대비 허용 우회','Maximum extra driving time');
        for(const [i,label] of (ko()?['최단시간','운전하기 편한 경로','역광 회피','그늘 우선']:['Fastest','Easier driving','Avoid glare','Prefer shade']).entries())$('route-preference').options[i].textContent=label;
        $('route-preference').value=s.mode;$('route-budget').value=String(s.budget);
        for(const o of $('route-budget').options)o.textContent=`${o.value} ${ko()?'분':'min'}`;
        const choice=s.route&&s.data?.routes?.fastest?JourneyUpgrades.comfort(s.data.routes.fastest,s.route,s.budget):null;
        const comfort=s.mode==='simple'&&s.route ? (choice?.eligible
            ?text(`최단 대비 +${Math.max(0,choice.extraSeconds/60).toFixed(1)}분 · 회전 ${choice.turnsSaved>=0?'-':'+'}${Math.abs(choice.turnsSaved)}회 · 연속 회전 ${choice.rapidTurnsSaved>=0?'-':'+'}${Math.abs(choice.rapidTurnsSaved)}회 · 유턴 ${choice.uturnsSaved>=0?'-':'+'}${Math.abs(choice.uturnsSaved)}회 · 급회전 ${-choice.sharpTurnsSaved}회 · 분기 ${-choice.branchesSaved}회. `,
                `Vs fastest +${Math.max(0,choice.extraSeconds/60).toFixed(1)} min · ${choice.turnsSaved>=0?'-':'+'}${Math.abs(choice.turnsSaved)} turns · ${choice.rapidTurnsSaved>=0?'-':'+'}${Math.abs(choice.rapidTurnsSaved)} close turns · ${choice.uturnsSaved>=0?'-':'+'}${Math.abs(choice.uturnsSaved)} U-turns · ${-choice.sharpTurnsSaved} sharp turns · ${-choice.branchesSaved} branches. `)
            :text('허용 시간 안에서 충분히 단순한 후보가 없어 최단시간 경로를 사용합니다. ','No sufficiently simpler candidate within the time limit; using fastest. ')):'';
        $('route-preference-status').textContent=comfort+text('수신한 후보만 비교합니다. 편한 경로는 최대 2분·20% 및 설정한 우회 한도 안에서 선택합니다. 폭 자료가 없으면 좁은 도로로 추정하지 않습니다.',
            'Compares returned candidates only. Easier routes stay within 2 min, 20%, and your detour limit. Missing width data is not treated as a narrow road.')+(s.route&&c.known?text(` 현재: 회전 ${c.turns} · 유턴 ${c.uturns} · 연속 회전 ${c.rapidTurns} · 급회전 ${c.sharpTurns}`,` Current: ${c.turns} turns · ${c.uturns} U-turns · ${c.rapidTurns} close turns · ${c.sharpTurns} sharp turns`):'');
        $('btn-trip-preview').textContent=text('전체 여정 미리보기','Preview entire journey');
        $('trip-preview-title').textContent=text('전체 여정','Entire journey');
        $('btn-close-trip-preview').textContent=text('닫기','Close');
        $('btn-arrival-next').textContent=text('정차 후 다음 구간 이어가기','Continue to next leg when stopped');
        $('btn-arrival-next').hidden=!p?.pending.length;
        $('btn-next-stop').textContent=text('현재 구간 건너뛰고 다음 목적지로','Skip current leg / next destination');
        const list=$('trip-order-list');list.replaceChildren();
        if(p)[p.current,...p.pending].forEach((point,i,points)=>{
            const row=document.createElement('div');row.className='trip-order-row';
            const label=document.createElement('span');label.textContent=`${i+1}. ${point.name}`;row.appendChild(label);
            for(const [delta,arrow] of [[-1,'↑'],[1,'↓']]){
                const b=document.createElement('button');b.type='button';b.className='nav-btn secondary';b.textContent=arrow;
                b.setAttribute('aria-label',text(`${point.name} ${delta<0?'앞으로':'뒤로'}`,`Move ${point.name} ${delta<0?'earlier':'later'}`));
                b.disabled=s.live||tripBusy||i+delta<0||i+delta>=points.length;
                b.addEventListener('click',()=>changeOrder(i,i+delta));row.appendChild(b);
            }list.appendChild(row);
        });
    }
    function invalidate(){tripGeneration++;tripController?.abort();proposalController?.abort();proposalController=null;proposal=null;$('closure-offer').classList.add('hidden');
        if(!$('trip-preview-modal').classList.contains('hidden')){tripLayers?.clearLayers();$('trip-preview-legs').replaceChildren();$('trip-preview-status').textContent=text('경로가 변경되었습니다. 닫은 뒤 다시 조회하세요.','The route changed. Close this preview and request it again.');}}
    async function preferenceChanged(){
        const s=api.state(),mode=$('route-preference').value,budget=JourneyUpgrades.budget($('route-budget').value);
        if(s.live&&!confirm(text('선호도를 바꾸고 현재 위치에서 다시 탐색할까요?','Change preference and reroute from your current position?'))){render();return;}
        try{await api.preference(mode,budget);invalidate();render();}catch{api.notice(text('경로 설정을 저장하지 못했습니다.','Could not save route preferences.'));render();}
    }
    $('route-preference').addEventListener('change',preferenceChanged);$('route-budget').addEventListener('change',preferenceChanged);
    async function changeOrder(from,to){
        if(tripBusy||api.state().live)return;
        const old=matchingPlan();if(!old)return;
        const next=JourneyUpgrades.reorder(old,from,to);tripBusy=true;invalidate();
        try{
            TripTools.set(next);
            if(!TripTools.same(old.current.coords,next.current.coords)&&!await api.destination(next.current))throw Error('DESTINATION');
            api.renderTrip();
        }catch{try{TripTools.set(old);}catch{}api.notice(text('순서를 변경하지 못했습니다.','Could not change stop order.'));}
        finally{tripBusy=false;render();}
    }
    async function advance(arrived){
        if(tripBusy)return;
        const old=matchingPlan();if(!old?.pending.length)return;
        if(!arrived&&!confirm(text('현재 목적지를 건너뛰고 다음 목적지로 갈까요?','Skip the current destination and go to the next?')))return;
        tripBusy=true;
        try{
            const fix=await api.gps();
            if(JSON.stringify(matchingPlan())!==JSON.stringify(old))throw Error('TRIP_CHANGED');
            const speed=fix?.coords?.speed,accuracy=fix?.coords?.accuracy;
            if(!Number.isFinite(speed)||speed<0||speed>1||!Number.isFinite(accuracy)||accuracy>35||!Number.isFinite(fix.timestamp)||Date.now()-fix.timestamp<0||Date.now()-fix.timestamp>10000)throw Error('STOP_FIRST');
            if(api.state().live)await api.stop();
            if(api.state().live)throw Error('STILL_LIVE');
            api.useGps(fix);
            const next=old.pending[0],remaining={savedAt:Date.now(),current:next,pending:old.pending.slice(1)};
            if(remaining.pending.length)TripTools.set(remaining);else TripTools.clear();invalidate();
            if(!await api.destination(next)){TripTools.set(old);throw Error('DESTINATION');}
            $('arrival-modal').classList.add('hidden');
            api.renderTrip();
            api.notice(text('다음 구간을 계산합니다. 경로 확인 후 안내 시작을 눌러 주세요.','Calculating the next leg. Review it and press Start navigation.'));
        }catch{api.notice(text('정차와 정확한 GPS를 확인한 뒤 다시 시도하세요.','Stop and wait for an accurate GPS fix, then try again.'));}
        finally{tripBusy=false;render();}
    }
    $('btn-arrival-next').addEventListener('click',()=>advance(true));
    // Existing next-stop listener is replaced by this guarded transition.
    $('btn-next-stop').addEventListener('click',()=>advance(false));
    function closePreview(){tripGeneration++;tripController?.abort();$('trip-preview-modal').classList.add('hidden');$('btn-trip-preview').focus();}
    $('btn-close-trip-preview').addEventListener('click',closePreview);
    $('trip-preview-modal').addEventListener('keydown',event=>{
        if(event.key==='Escape')closePreview();
        if(event.key==='Tab'){
            const nodes=[...$('trip-preview-modal').querySelectorAll('button:not([disabled]),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
            const first=nodes[0],last=nodes.at(-1);
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
            else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
        }
    });
    async function preview(){
        const s=api.state(),p=matchingPlan(),now=Date.now();
        if(s.live||!s.ready||!s.route||!s.start||!s.end){api.notice(text('주행 전에 현재 구간 경로 계산을 완료하세요.','Finish calculating the current leg before driving.'));return;}
        if(now-lastPreviewAt<60000){api.notice(text('전체 여정 조회는 1분 간격으로 가능합니다.','Wait one minute between journey requests.'));return;}
        lastPreviewAt=now;tripController?.abort();tripController=new AbortController();const signal=tripController.signal;
        const generation=++tripGeneration,key=routeKey(s.route),planKey=JSON.stringify(p);
        const current=()=>generation===tripGeneration&&!signal.aborted&&!api.state().live&&routeKey(api.state().route)===key&&api.state().toll===s.toll&&api.state().mode===s.mode&&api.state().budget===s.budget&&JSON.stringify(matchingPlan())===planKey;
        $('trip-preview-modal').classList.remove('hidden');$('trip-preview-status').textContent=text('구간별 경로 확인 중…','Checking each leg…');$('trip-preview-legs').replaceChildren();
        $('btn-close-trip-preview').focus();
        if(!tripMap){tripMap=L.map('trip-preview-map');L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(tripMap);tripLayers=L.featureGroup().addTo(tripMap);}
        tripLayers.clearLayers();tripMap.invalidateSize();
        try{
            const points=[{coords:s.start,name:text('출발','Start')},...(p?[p.current,...p.pending]:[{coords:s.end,name:s.name}])];
            const first={...s.route.raw,duration:s.route.durationSec,distance:s.route.distanceMeters,geometry:{coordinates:s.route.analyzed.coordinates}};
            const result=await JourneyUpgrades.itinerary(points,first,(a,b)=>RouteDetours.request(a,b,null,{tollFree:s.toll,signal}),async raws=>{
                const feeds=await PublicTraffic.load(raws.flatMap(r=>r.geometry.coordinates));return raws.every(r=>!PublicTraffic.evaluate(r,feeds).blocked);
            },current);
            if(!current())return;
            $('trip-preview-status').textContent=text(`전체 주행 약 ${Math.ceil(result.seconds/60)}분 · ${NavigationUnits.distance(result.meters)}. 정차 시간 제외. 이후 구간은 기본 도로 속도 추정이며 해당 구간 시작 시 선호도로 다시 계산합니다.`,`Total driving ~${Math.ceil(result.seconds/60)} min · ${NavigationUnits.distance(result.meters)}. Stops excluded. Future legs use base road speeds and are recalculated with your preference when starting each leg.`);
            const colors=['#38bdf8','#a78bfa','#fb923c','#4ade80'];
            result.legs.forEach((leg,i)=>{
                L.polyline(leg.raw.geometry.coordinates.map(p=>[p[1],p[0]]),{color:colors[i],weight:5}).addTo(tripLayers);
                const end=leg.raw.geometry.coordinates.at(-1),label=document.createElement('span');label.textContent=`${i+1}. ${leg.to}`;
                L.marker([end[1],end[0]]).bindTooltip(label,{permanent:false}).addTo(tripLayers);
                const row=document.createElement('li');row.textContent=`${leg.from} → ${leg.to}: ${Math.ceil(leg.raw.duration/60)} ${ko()?'분':'min'} · ${NavigationUnits.distance(leg.raw.distance)}`;row.style.color=colors[i];$('trip-preview-legs').appendChild(row);
            });
            setTimeout(()=>{if(current()){tripMap.invalidateSize();tripMap.fitBounds(tripLayers.getBounds(),{padding:[24,24],maxZoom:15});}},250);
        }catch{if(generation===tripGeneration)$('trip-preview-status').textContent=text('전체 여정을 확인하지 못했습니다. 통신·도로 연결·통제 또는 변경된 경로를 확인하세요. 부분 합계는 표시하지 않습니다.','Could not verify the entire journey. Check connectivity, road access, closures or changed routes. No partial total is shown.');}
    }
    $('btn-trip-preview').addEventListener('click',preview);
    function offer(message,enabled){$('closure-offer-text').textContent=message;$('closure-offer').classList.remove('hidden');$('btn-closure-accept').hidden=!enabled;$('btn-closure-accept').textContent=text('우회 경로 사용','Use detour');$('btn-closure-dismiss').textContent=text('나중에','Later');}
    async function considerClosure(traffic,remaining){
        const s=snapshot(),key=JourneyUpgrades.closureKey(traffic);
        if(!key||!s.live||!s.realtime||!s.snapped||s.busy||s.free||navigator.onLine===false||s.now-s.fixAt>10000||!Number.isFinite(s.accuracy)||s.accuracy>35)return;
        if(`${key}:${s.routeKey}`===dismissedKey||s.now-lastProposalAt<300000)return;
        lastProposalAt=s.now;lastClosureKey=`${key}:${s.routeKey}`;proposalController?.abort();const controller=new AbortController();proposalController=controller;
        const base={...s,start:{...s.start},at:s.now};
        const current=()=>!controller.signal.aborted&&JourneyUpgrades.proposalCurrent(base,snapshot(),distance);
        offer(text('남은 경로에 확인된 전면 통제가 있습니다. 우회 후보 확인 중…','Confirmed full closure ahead. Checking for a detour…'),false);
        const timer=setTimeout(()=>controller.abort(),45000);
        try{
            const data=JourneyUpgrades.apply(await api.candidates(s,controller.signal),s.budget);
            const candidate=data.routes[s.mode]||data.routes.fastest;
            const remainingRaw={geometry:{coordinates:remaining.coordinates},duration:remaining.duration,legs:[{steps:remaining.steps||[]}]};
            const feeds=await PublicTraffic.load([...remaining.coordinates,...candidate.analyzed.coordinates]);
            if(!current())throw Error('STALE');
            if(JourneyUpgrades.closureKey(PublicTraffic.evaluate(remainingRaw,feeds))!==key)throw Error('CLOSURE_CHANGED');
            if(candidate.offline||PublicTraffic.evaluate(candidate.raw,feeds).blocked)throw Error('BLOCKED');
            proposal={...base,data,candidate,feeds,key,remainingRaw};
            const extra=Math.ceil((candidate.durationSec-remaining.duration)/60),names=traffic.closures.map(c=>c.name).filter(Boolean).join(', ');
            offer(text(`전면 통제: ${names||'현재 경로'}. 우회 약 ${Math.ceil(candidate.durationSec/60)}분 · 기존 남은 경로 대비 ${extra>=0?'+':''}${extra}분. 공개 피드 기준이며 정체 시간은 미반영입니다.`,`Full closure: ${names||'current route'}. Detour ~${Math.ceil(candidate.durationSec/60)} min · ${extra>=0?'+':''}${extra} min versus remaining route. Based on public feeds; congestion delay is not included.`),true);
        }catch{if(proposalController===controller){proposal=null;offer(text('확인된 전면 통제가 있습니다. 현재 위치에서 유효한 우회 후보를 확보하지 못했습니다. 현장 통제를 확인하세요.','Confirmed full closure ahead. No valid detour could be confirmed from your current position. Check local restrictions.'),false);}}
        finally{clearTimeout(timer);if(proposalController===controller)proposalController=null;}
    }
    $('btn-closure-dismiss').addEventListener('click',()=>{dismissedKey=lastClosureKey;proposalController?.abort();proposalController=null;proposal=null;$('closure-offer').classList.add('hidden');});
    $('btn-closure-accept').addEventListener('click',async()=>{
        const p=proposal,remaining=api.remaining();
        const raw=remaining&&{geometry:{coordinates:remaining.coordinates},duration:remaining.duration,legs:[{steps:remaining.steps||[]}]};
        if(!JourneyUpgrades.proposalCurrent(p,snapshot(),distance)||!raw||JourneyUpgrades.closureKey(PublicTraffic.evaluate(raw,p.feeds))!==p.key||PublicTraffic.evaluate(p.candidate.raw,p.feeds).blocked){proposal=null;offer(text('위치·경로·통제 자료가 변경되어 제안이 만료됐습니다. 현재 위치에서 다시 탐색하세요.','Position, route or closure data changed; this proposal expired. Recalculate from your current position.'),false);return;}
        proposal=null;$('closure-offer').classList.add('hidden');await api.commit(p.data);
    });
    return {render,invalidate,considerClosure,closePreview};
}};
