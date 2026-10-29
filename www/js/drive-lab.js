/* Post-drive local review and selective scene repair. No recording upload. */
(function(root){
    'use strict';
    const el=id=>document.getElementById(id),ko=()=>root.I18n.getLanguage().startsWith('ko'),text=(a,b)=>ko()?a:b;
    const feedbackKey='solarless_glare_feedback';
    function feedback(){try{const all=JSON.parse(localStorage.getItem(feedbackKey)||'[]'),kept=root.GlareFeedback.retain(all);if(kept.length!==all.length)localStorage.setItem(feedbackKey,JSON.stringify(kept));return kept;}catch{return [];}}
    function clear(){localStorage.removeItem(feedbackKey);}
    function init(options){
        feedback(); // Prune expired observations on app start, not only on export.
        let originalRecording,recording,report,map,routeLayer,rawMarker,snapMarker,trigger,timer,token=0,scenePoint,drawnRoute=-2;
        const modal=el('drive-lab-modal');
        const details=document.createElement('details');details.id='drive-evidence-details';
        const heading=document.createElement('summary');heading.textContent=text('조건별 눈부심·성능 평가','Glare conditions and performance review');
        const evidence=document.createElement('div');evidence.className='evidence-report';evidence.id='drive-evidence-report';
        const compareLabel=document.createElement('label');compareLabel.textContent=text('이전 주행 JSON과 성능 비교','Compare performance with an earlier drive JSON');
        const compareInput=document.createElement('input');compareInput.type='file';compareInput.accept='.json,application/json';compareInput.id='performance-compare-file';compareLabel.append(compareInput);
        const comparison=document.createElement('p');comparison.className='evidence-report';comparison.id='performance-comparison';
        details.append(heading,evidence,compareLabel,comparison);el('replay-summary').after(details);
        function renderEvidence(){
            heading.textContent=text('조건별 눈부심·성능 평가','Glare conditions and performance review');
            const values=feedback(),groups=root.GlareFeedback.stratify(values),evaluation=root.GlareFeedback.evaluateThreshold(values);
            const perf=root.JourneyEvidence.performanceReport(originalRecording||{});
            const fmt=n=>Number.isFinite(n)?n.toFixed(1):'—';
            evidence.textContent=text('눈부심 관찰은 운전자 기억에 따른 평가입니다. 자동 보정하지 않습니다.','Glare observations are driver recall, not sensor measurements. No automatic calibration.')+'\n'+
                groups.map(g=>g.condition.split(' / ').map(v=>({'low-sun':text('낮은 태양','Low sun'),'mid-sun':text('중간 태양 고도','Mid sun'),'high-sun':text('높은 태양','High sun'),'sun-unknown':text('태양 고도 미확인','Sun elevation unknown'),shaded:text('차폐 많음','More occlusion'),exposed:text('차폐 적음','Less occlusion'),'shade-unknown':text('차폐 미확인','Occlusion unknown'),'heading-unknown':text('도로 방향 미확인','Road heading unknown'),OPEN_METEO_FORECAST:text('기상 예보 반영','Weather forecast'), 'weather-unknown':text('기상 자료 미확인','Weather unknown')})[v]||v).join(' / ')+': '+text('평가 ','labelled ')+g.labelled+text(' · 오탐 ',' · false alarms ')+g.falsePositive+text(' · 누락 ',' · misses ')+g.falseNegative+text(' · 미확인 ',' · unknown ')+g.unknown).join('\n')+'\n'+
                (evaluation.eligible?text('날짜를 분리한 검증: ','Held-out dates: ')+(evaluation.recommendedThreshold!==null?text('검토 후보 기준값 ','Candidate threshold for review ')+evaluation.recommendedThreshold:text('기존 기준보다 개선 확인 안 됨','No verified improvement over the current threshold')):text('보정 평가 자료 부족: 4일 이상·40건 이상이며 학습/검증 각각 눈부심 유/무 5건 이상 필요','Calibration evidence insufficient: need 4+ days, 40+ observations and 5+ positives/negatives in each train/test set.'))+'\n\n'+
                text('성능 기록 ','Performance samples ')+perf.samples+' · '+fmt(perf.minutes)+' min\n'+
                text('배터리 소모(%p/시간): ','Battery drain (percentage points/hour): ')+fmt(perf.batteryPointsPerHour)+'\n'+
                text('최고 배터리 온도: ','Peak battery temperature: ')+fmt(perf.maxBatteryTemperatureC)+' °C\n'+
                text('주기적 렌더 지연 표본 p90: ','Periodic render-latency samples p90: ')+fmt(perf.p90RenderEventLatencyMs)+' ms\n'+
                text('비교에는 같은 폰·경로·밝기·거치·날씨와 30분 이상 비충전 기록이 필요합니다. 실제 패널 FPS가 아닙니다.','Compare only the same phone, route, brightness, mount and weather with 30+ unplugged minutes. This is not panel FPS.');
        }
        compareInput.onchange=async()=>{const file=compareInput.files[0];if(!file)return;try{
            if(file.size>16*1024*1024)throw Error('SIZE');
            const baseline=JSON.parse(await file.text());if(!Array.isArray(baseline.events)||baseline.events.length>60000)throw Error('INVALID');
            const result=root.JourneyEvidence.comparePerformance(root.JourneyEvidence.performanceReport(baseline),root.JourneyEvidence.performanceReport(originalRecording||{}));
            comparison.textContent=result.comparable?text('배터리 소모 변화 ','Battery drain change ')+result.batteryPointsPerHourChange.toFixed(1)+text('%p/시간. 같은 경로·날씨·거치 조건인지 직접 확인해야 합니다.',' percentage points/hour. Manually confirm the same route, weather and mount conditions.'):text('비교 자료 부족: 같은 기기·고정 밝기·비충전 30분 이상 연속 기록을 사용하세요.','Insufficient comparison: use continuous 30+ minute unplugged recordings on the same device with fixed brightness.');
        }catch{comparison.textContent=text('지원하는 주행 JSON 파일을 선택하세요.','Choose a supported drive JSON file.');}compareInput.value='';};
        function stop(){clearInterval(timer);timer=null;el('btn-replay-play').textContent=text('재생','Play');}
        function open(title){trigger=document.activeElement;modal.classList.remove('hidden');el('drive-lab-title').textContent=title;el('drive-lab-message').textContent='';el('btn-lab-close').focus();}
        function close(){token++;stop();modal.classList.add('hidden');trigger?.focus();}
        root.DriveLab.close=()=>{if(!modal.classList.contains('hidden'))close();};
        el('btn-lab-close').onclick=close;
        modal.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const controls=[...modal.querySelectorAll('button,input,select,a[href]')].filter(n=>!n.disabled&&n.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
        function frame(){
            const index=Number(el('replay-position').value),f=report?.frames[index];if(!f)return;
            if(drawnRoute!==f.routeIndex){if(routeLayer)routeLayer.remove();routeLayer=null;drawnRoute=f.routeIndex;
            const coords=report.routes[f.routeIndex];if(coords)routeLayer=root.L.polyline(coords.map(p=>[p[1],p[0]]),{color:'#0284c7',weight:4}).addTo(map);}
            const valid=Array.isArray(f.raw)&&f.raw.every(Number.isFinite)&&Math.abs(f.raw[0])<=180&&Math.abs(f.raw[1])<=85;
            if(valid){rawMarker.setLatLng([f.raw[1],f.raw[0]]).addTo(map);map.setView([f.raw[1],f.raw[0]],17,{animate:false});}else rawMarker.remove();
            if(f.matched)snapMarker.setLatLng([f.matched[1],f.matched[0]]).addTo(map);else snapMarker.remove();
            const sample=recording.samples[index];
            const labels=feedback();const saved=labels.find(v=>v.timestamp===f.timestamp&&v.lat===sample?.lat&&v.lng===sample?.lng);
            const prediction=sample?.glarePrediction;
            el('replay-frame').textContent=`${new Date(f.timestamp).toLocaleString()} · ${index+1}/${report.frames.length}\n`+
                text('노랑: GPS · 청록: 다시 계산한 위치 · 파랑: 경로','Yellow: GPS · cyan: recomputed match · blue: route')+`\n${f.snapped?text('도로 매칭','Matched'):f.reason||text('경로 없음','No route')}`+
                (prediction?`\n${text('당시 눈부심 예측','Recorded glare estimate')}: ${Math.round(prediction.risk*100)}% · ${prediction.uncertain||prediction.evidenceKnown===false?text('미확인','uncertain'):text('기상·차폐 반영','weather / occlusion included')}`:'')+
                (saved?'\n'+text('저장한 관찰: ','Saved observation: ')+(saved.glare?text('눈부셨음','Glare'):text('눈부시지 않았음','No glare')):'');
            for(const id of ['btn-glare-yes','btn-glare-no'])el(id).disabled=options.live()||!prediction||!f.accepted;
        }
        function load(value){
            stop();
            if(!Array.isArray(value.samples))throw Error('INVALID_RECORDING');
            const annotations=new Map((value.events||[]).filter(e=>e.type==='match').map(e=>[e.data?.timestamp,e.data]));
            const source=el('replay-source').value;
            const prepared={...value,samples:root.DriveReplay.samples(value,source).map(s=>({...s,...(source==='foreground'?annotations.get(s.timestamp):{})})).sort((a,b)=>a.timestamp-b.timestamp)};
            const nextReport=root.DriveReplay.run(prepared);
            originalRecording=value;recording=prepared;report=nextReport;drawnRoute=-2;comparison.textContent='';renderEvidence();
            const review=root.DriveQuality.review(recording);
            el('replay-summary').textContent=text(`위치 ${report.samples}개 · 매칭 ${report.matched} · 불확실 ${report.uncertain} · 거부 ${report.rejected} · 경로 없음 ${report.missingRoute}\n위치 진행 급변 ${report.positionJumps}회 · ETA 평균 절대 오차 ${review.meanAbsoluteEtaErrorSec===null?'—':Math.round(review.meanAbsoluteEtaErrorSec)+'초'}\n정답 도로·회전 시각 라벨이 없으면 정확도·안내 지연을 확정할 수 없습니다.`,
                `${report.samples} fixes · ${report.matched} matched · ${report.uncertain} uncertain · ${report.rejected} rejected · ${report.missingRoute} missing route\n${report.positionJumps} progress jumps · mean absolute ETA error: ${review.meanAbsoluteEtaErrorSec===null?'—':Math.round(review.meanAbsoluteEtaErrorSec)+' s'}\nRoad accuracy and instruction timing require ground-truth labels.`);
            const regression=root.DriveRegression.evaluate(prepared,'foreground',report);
            el('replay-summary').textContent+='\n'+text('라벨 기반 회귀: ','Labelled regression: ')+text('위치 오류 ','fix errors ')+(regression.fixErrors??'—')+' · '+text('안내 조건 지연 ','late guidance eligibility ')+(regression.lateGuidance??'—')+' · '+text('불필요 재탐색 제안 ','false reroute proposals ')+(regression.falseRerouteProposals??'—')+'\n'+text('실제 음성 출력 지연이나 전체 Android 재탐색 시험이 아닙니다.','This does not test actual speech latency or full Android rerouting.');
            el('replay-position').max=Math.max(0,report.frames.length-1);el('replay-position').value=0;el('replay-position').disabled=!report.frames.length;
            el('btn-replay-play').disabled=!report.frames.length;
            if(!map){map=root.L.map('drive-replay-map').setView([42.34,-71.13],13);root.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);rawMarker=root.L.circleMarker([0,0],{radius:9,color:'#eab308'});snapMarker=root.L.circleMarker([0,0],{radius:5,color:'#22d3ee'});}
            map.invalidateSize();frame();
        }
        el('btn-drive-replay').onclick=async()=>{
            if(options.live()){options.notice(text('안내를 종료한 뒤 기록을 검토하세요.','End guidance before reviewing recordings.'));return;}
            open(text('주행 재생과 눈부심 평가','Drive replay and glare review'));el('drive-replay-panel').hidden=false;el('scene-repair-panel').hidden=true;
            const generation=++token;
            try{const value=await options.recording();if(generation===token)load(value);}catch{el('drive-lab-message').textContent=text('기록을 읽지 못했습니다. JSON 파일을 선택할 수 있습니다.','Recording unavailable. You can choose a JSON file.');}
        };
        el('replay-import').onchange=async event=>{const file=event.target.files[0];if(!file)return;const generation=++token;
            try{if(file.size>16*1024*1024)throw Error();const value=JSON.parse(await file.text());if(generation===token)load(value);}catch{el('drive-lab-message').textContent=text('지원하는 주행 JSON 파일(최대 16 MB)을 선택하세요.','Choose a supported drive JSON file (up to 16 MB).');}event.target.value='';};
        el('replay-position').oninput=()=>{stop();frame();};
        el('replay-source').onchange=()=>{if(originalRecording)load(originalRecording);};
        el('btn-replay-play').onclick=()=>{if(timer){stop();return;}el('btn-replay-play').textContent=text('일시정지','Pause');timer=setInterval(()=>{const slider=el('replay-position');if(Number(slider.value)>=Number(slider.max)){stop();return;}slider.value=Number(slider.value)+1;frame();},500);};
        for(const [id,value] of [['btn-glare-yes',true],['btn-glare-no',false]])el(id).onclick=()=>{
            if(options.live())return;
            try{const sample=recording.samples[Number(el('replay-position').value)],label=root.GlareFeedback.observation(sample,value);
                const items=feedback().filter(v=>v.timestamp!==label.timestamp||v.lat!==label.lat||v.lng!==label.lng);items.push(label);localStorage.setItem(feedbackKey,JSON.stringify(root.GlareFeedback.retain(items)));
                const stats=root.GlareFeedback.summarize(feedback());
                el('drive-lab-message').textContent=text(`관찰 저장됨 · 오탐 ${stats.falsePositive} · 누락 ${stats.falseNegative} · 예측 미확인 ${stats.unknown}. 자동 보정하지 않습니다.`,`Observation saved · ${stats.falsePositive} false alarms · ${stats.falseNegative} misses · ${stats.unknown} unknown predictions. No automatic recalibration.`);renderEvidence();frame();
            }catch{el('drive-lab-message').textContent=text('저장하지 못했습니다.','Could not save.');}
        };
        el('btn-glare-clear').onclick=()=>{clear();el('drive-lab-message').textContent=text('눈부심 평가를 삭제했습니다.','Glare observations deleted.');if(originalRecording)load(originalRecording);};
        async function scenes(generation){
            const list=el('scene-repair-list');list.textContent=text('자료 확인 중…','Checking data…');
            try{
                const rows=await root.SceneShadow.statusAt(scenePoint);if(generation!==token)return;
                list.replaceChildren();
                if(!rows.length)list.textContent=text('이 위치는 공개된 정밀 자료 범위 밖입니다.','This location is outside published precision data coverage.');
                const states=ko()?{'cached':'기기에 저장됨','not-downloaded':'아직 받지 않음','expired':'캐시 만료','damaged':'손상','missing':'공개 타일 없음','unavailable':'확인 실패'}:{};
                for(const row of rows){
                    const item=document.createElement('div'),p=document.createElement('p');
                    p.textContent=`${row.region} · ${row.tileKey||''}\n${states[row.cacheState]||row.cacheState}\n${row.source||''}\n`+
                        text('OSM 원본 기준: ','OSM extract: ')+(row.extractTimestamp||'—')+'\n'+text('릴리스: ','Release: ')+(row.releaseTag||'—')+'\n'+
                        text('목록 확인: ','Manifest checked: ')+(row.manifestCheckedAt?new Date(row.manifestCheckedAt).toLocaleString():'—')+
                        (row.manifestStale?'\n'+text('최신 목록 확인 실패 또는 확인 필요','Manifest may be out of date'):'')+
                        (row.ageDays>30?'\n'+text('원본 기준 30일 경과 · 현장 변경 가능','Extract older than 30 days; roads may have changed'):'')+
                        '\n'+text('타일 자료: ','Tile coverage: ')+(row.coverage?['buildings','tunnels','terrain','buildingGround'].map(k=>`${ko()?({buildings:'건물',tunnels:'터널',terrain:'지형',buildingGround:'건물 지면'})[k]:k}: ${row.coverage[k]===true?text('포함','included'):row.coverage[k]===false?text('부족','incomplete'):text('미확인','unknown')}`).join(' · '):text('다운로드 후 확인 가능','available after download'));item.append(p);
                    if(row.pack){const button=document.createElement('button');button.type='button';button.className='nav-btn secondary';button.textContent=text('이 구간 자료 다시 받기','Download this section again')+(row.downloadBytes?` (${(row.downloadBytes/1048576).toFixed(1)} MB)`:'');
                        button.onclick=async()=>{if(options.live())return;button.disabled=true;el('drive-lab-message').textContent=text('이 타일이 포함된 ZIP만 확인·다운로드합니다…','Downloading and verifying this tile’s archive…');
                            try{await root.SceneShadow.repairTile(row.region,row.tileKey);if(generation!==token)return;el('drive-lab-message').textContent=text('복구 완료. 다음 경로 계산부터 반영됩니다.','Repair complete. Used by the next route calculation.');await scenes(generation);}
                            catch{if(generation===token){el('drive-lab-message').textContent=text('복구 실패. 연결 상태를 확인하고 다시 시도하세요.','Repair failed. Check your connection and retry.');button.disabled=false;}}};item.append(button);}
                    list.append(item);
                }
            }catch{if(generation===token)list.textContent=text('자료를 확인하지 못했습니다.','Could not check data.');}
        }
        el('btn-scene-status').onclick=()=>{
            if(options.live()){options.notice(text('안내를 종료한 뒤 자료를 관리하세요.','End guidance before managing data.'));return;}
            scenePoint=options.point();open(text('현재 지도 위치의 정밀 자료','Precision data at the map center'));el('drive-replay-panel').hidden=true;el('scene-repair-panel').hidden=false;scenes(++token);
        };
    }
    root.DriveLab={init,feedback,clear};
})(window);
