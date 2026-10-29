(function(root){
    'use strict';let section,select,summary,message,refreshButton;const buttons=[];
    const ko=()=>root.I18n.getLanguage().startsWith('ko'),t=(a,b)=>ko()?a:b;
    async function action(fn){try{await fn();message.textContent=t('완료했습니다.','Done.');}catch(e){message.textContent=e.message==='STORAGE_IN_USE'?t('안내·경로 계산 종료 후 변경할 수 있습니다.','End guidance and route calculation before changing storage.'):t('저장 공간 작업 실패. 다시 확인해 주세요.','Storage operation failed. Please check again.');}await refresh();}
    function init(after){
        section=document.createElement('section');section.id='storage-settings';section.className='settings-section';
        const title=document.createElement('h4');title.id='storage-title';
        const label=document.createElement('label');label.id='storage-limit-label';label.htmlFor='storage-limit';select=document.createElement('select');select.id='storage-limit';
        for(const n of [160,240,400]){const o=document.createElement('option');o.value=n;o.textContent=n+' MiB';select.append(o);}select.onchange=()=>action(()=>root.StorageBudget.set(Number(select.value)));
        summary=document.createElement('p');summary.id='storage-summary';const note=document.createElement('p');note.id='storage-note';message=document.createElement('p');message.id='storage-message';message.setAttribute('role','status');
        refreshButton=document.createElement('button');refreshButton.id='storage-refresh';refreshButton.className='nav-btn secondary';refreshButton.onclick=refresh;
        section.append(title,label,select,summary,note,refreshButton);
        for(const kind of ['map','scene','roads','recordings']){const b=document.createElement('button');b.type='button';b.id='storage-clear-'+kind;b.className='nav-btn secondary';b.onclick=()=>action(()=>root.StorageBudget.clear(kind));buttons.push({b,kind});section.append(b);}
        section.append(message);after.after(section);document.getElementById('mobile-toggle-panel')?.addEventListener('click',render);render();
    }
    function render(){if(!section)return;document.getElementById('storage-title').textContent=t('저장 공간 관리','Manage storage');document.getElementById('storage-limit-label').textContent=t('관리 데이터 예산','Managed data budget');
        select.value=root.StorageBudget.limit('total')/1048576;refreshButton.textContent=t('사용량 새로 확인','Refresh usage');
        document.getElementById('storage-note').textContent=t('지도·정밀 자료는 오래 사용하지 않은 캐시부터 정리합니다. 기록·설정용 여유 100 MiB를 포함하며 APK·WebView 캐시·DB 부가 용량은 제외합니다. 안내·경로 계산 중에는 삭제하지 않습니다. 기록 삭제는 수동입니다.','Old unused map and scene caches are removed first. Budget includes a 100 MiB allowance for recordings and settings; excludes APK, WebView cache and database overhead. No deletion during guidance or route calculation. Recordings are cleared manually.');
        for(const {b,kind} of buttons)b.textContent=({map:t('지도 캐시 삭제','Clear map cache'),scene:t('정밀 자료 캐시 삭제','Clear scene cache'),roads:t('저장 도로 삭제','Delete saved roads'),recordings:t('주행 기록 삭제','Delete drive recordings')})[kind];
        const busy=root.StorageBudget.protected();select.disabled=busy;for(const {b}of buttons)b.disabled=busy;
    }
    async function refresh(){if(!section)return;render();const s=await root.StorageBudget.stats();const labels={map:t('지도','Map'),scene:t('정밀 자료','Scene'),roads:t('도로','Roads'),recordings:t('기록','Recordings')};
        summary.textContent=s.items.map(r=>`${labels[r.name]}: ${Number.isFinite(r.bytes)?(r.bytes/1048576).toFixed(1)+' MiB':'—'}`).join(' · ')+t(` · 확인된 합계 ${(s.total/1048576).toFixed(1)} MiB`,` · Known total ${(s.total/1048576).toFixed(1)} MiB`)+(s.incomplete?t(' · 일부 사용량 미확인',' · some usage unavailable'):'')+(s.total>s.limit?t(' · 예산 초과: 안내 종료 후 캐시 정리 필요',' · over budget: trim caches after guidance'):'');render();
    }
    root.StorageSettings={init,render,refresh};
})(window);
