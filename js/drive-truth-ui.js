(function(root){
    'use strict';
    function create(host,options){
        const ko=()=>root.I18n.getLanguage().startsWith('ko'),t=(a,b)=>ko()?a:b;
        const box=document.createElement('details');box.id='drive-truth-editor';
        const title=document.createElement('summary');title.textContent=t('정답 라벨과 버전 비교','Truth labels and version comparison');
        const note=document.createElement('p');note.textContent=t('당시 주행을 직접 확인한 경우에만 입력하세요. 자동 매칭은 정답이 아닙니다. 기록을 내보내야 라벨이 보관됩니다.','Label only what you verified about the drive. An automatic match is not ground truth. Export the recording to keep your labels.');
        const status=document.createElement('p');status.id='truth-status';status.setAttribute('role','status');
        box.append(title,note);host.append(box);
        const field=(label,type,id)=>{const l=document.createElement('label'),input=document.createElement('input');l.textContent=label;input.type=type;input.id=id;l.append(input);box.append(l);return input;};
        const progress=field(t('확인한 경로 진행 거리(m, 선택)','Verified route progress (meters, optional)'),'number','truth-progress');progress.min=0;progress.placeholder=t('직접 확인한 값만 입력','Enter only independently verified progress');
        const action=(label,id,fn)=>{const b=document.createElement('button');b.type='button';b.className='nav-btn secondary';b.textContent=label;b.id=id;b.onclick=async()=>{if(options.live())return;try{await fn();}catch(e){status.textContent=t('처리하지 못했습니다. 같은 기록·위치 출처인지 확인하세요.','Could not apply. Check the recording and location source.');}};box.append(b);return b;};
        const context=()=>{const value=options.current();if(!value?.recording||!value.frame)throw Error('NO_RECORDING');return value;};
        for(const [label,id,value] of [[t('이 시점은 선택한 경로 위','This point is on the selected route'),'truth-on-route',true],[t('이 시점은 선택한 경로 밖','This point is off the selected route'),'truth-off-route',false],[t('이 위치 라벨 삭제','Clear this fix label'),'truth-clear-fix',null]])action(label,id,()=>{
            const c=context();options.update(root.DriveTruth.labelFix(c.recording,c.source,c.frame.timestamp,value,progress.value===''?null:Number(progress.value)));
            status.textContent=t('위치 라벨 적용됨 · 기록을 내보내 보관하세요.','Fix labelled · export the recording to keep it.');
        });
        const turnLabel=document.createElement('label');turnLabel.textContent=t('검증할 회전','Turn to verify');const turn=document.createElement('select');turn.id='truth-turn';turnLabel.append(turn);box.append(turnLabel);
        const stageLabel=document.createElement('label');stageLabel.textContent=t('이 시점까지 나왔어야 할 안내 단계','Guidance stage expected by this point');const stage=document.createElement('select');stage.id='truth-stage';
        for(const [value,label] of [['preview',t('먼 거리 예고','Advance warning')],['prepare',t('회전 준비','Prepare')],['execute',t('회전 직전','Immediate turn')]]){const option=document.createElement('option');option.value=value;option.textContent=label;stage.append(option);}stageLabel.append(stage);box.append(stageLabel);
        const windowSeconds=field(t('이 시점 이전 검증 구간(초)','Review window before this point (seconds)'),'number','truth-window');windowSeconds.min=1;windowSeconds.max=120;windowSeconds.value=30;
        const span=()=>{const n=Number(windowSeconds.value);if(!Number.isFinite(n)||n<1||n>120)throw Error('WINDOW');return n*1000;};
        action(t('회전 안내 기한 라벨 추가','Add instruction deadline'),'truth-add-turn',()=>{const c=context();if(!turn.value)throw Error('TURN');options.update(root.DriveTruth.labelEvent(c.recording,c.source,'guidance-ground-truth',{routeIndex:c.frame.routeIndex,progressMeters:Number(turn.value),stage:stage.value,earliestAt:c.frame.timestamp-span(),latestAt:c.frame.timestamp}));status.textContent=t('안내 조건의 기한을 기록했습니다. 실제 스피커 출력 지연 측정은 아닙니다.','Eligibility deadline labelled; this does not measure speaker latency.');});
        action(t('이 구간은 재탐색 불필요','Mark this window: reroute not needed'),'truth-no-reroute',()=>{const c=context();options.update(root.DriveTruth.labelEvent(c.recording,c.source,'reroute-ground-truth',{start:c.frame.timestamp-span(),end:c.frame.timestamp,allowed:false}));status.textContent=t('재탐색 불필요 구간을 기록했습니다.','No-reroute window labelled.');});
        const download=async(value,name)=>{const json=root.DriveTruth.serialize(value),native=root.Capacitor?.Plugins?.Pip;
            if(native?.saveDriveRecording){const result=await native.saveDriveRecording({json,name});status.textContent=result.saved?t('파일 저장됨','File saved'):t('저장을 취소했습니다.','Save cancelled.');return;}
            const blob=new Blob([json],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
        };
        async function currentReport(){const c=context();return root.DriveTruth.report(c.recording,c.source,root.BuildInfo.versionName);}
        action(t('라벨 포함 기록 저장','Export labelled recording'),'truth-export-recording',()=>download(context().recording,'drive-labelled.json'));
        action(t('현재 버전 평가 저장','Export current version evaluation'),'truth-export-report',async()=>download(await currentReport(),'drive-evaluation.json'));
        const compare=field(t('이전 버전 평가 JSON과 비교','Compare an earlier version evaluation JSON'),'file','truth-compare');compare.accept='.json,application/json';
        compare.onchange=async()=>{try{if(options.live())return;const file=compare.files[0];if(!file||file.size>1048576)throw Error('SIZE');const result=root.DriveTruth.compare(JSON.parse(await file.text()),await currentReport());status.textContent=`${result.before} → ${result.after}\n`+t('변화(음수는 오류 감소): ','Change (negative means fewer errors): ')+[t('위치 오류','Fix errors'),t('안내 조건 지연','Late eligibility'),t('불필요 재탐색','False reroute'),t('진행 급변','Progress jumps')].map((label,i)=>`${label}: ${Object.values(result.changes)[i]??'—'}`).join(' · ');}catch{status.textContent=t('같은 라벨 포함 기록과 같은 위치 출처의 평가만 비교할 수 있습니다.','Comparison requires the identical labelled recording and location source.');}compare.value='';};
        box.append(status);
        return {refresh(){const c=options.current();const previous=turn.value;turn.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent=t('회전을 직접 선택','Select the turn');turn.append(empty);
            for(const m of c?.turns||[]){if(m.type==='arrive'||m.type==='depart')continue;const o=document.createElement('option');o.value=m.progressMeters;o.textContent=`${Math.round(m.progressMeters)} m · ${m.name||m.ref||m.type}`;turn.append(o);}turn.value=previous;
            for(const b of box.querySelectorAll('button'))b.disabled=options.live()||!c?.frame;
        }};
    }
    root.DriveTruthUI={create};
})(window);
