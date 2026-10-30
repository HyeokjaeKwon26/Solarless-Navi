(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SearchEvidence=factory();})(typeof window!=='undefined'?window:globalThis,function(){
    'use strict';
    const norm=v=>String(v||'').toLowerCase().replace(/\b(street|avenue|road|boulevard|drive|lane|court)\b/g,v=>({street:'st',avenue:'ave',road:'rd',boulevard:'blvd',drive:'dr',lane:'ln',court:'ct'})[v]).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    function assess(query,result){
        const parts=String(query).split(','),street=norm(parts[0]),match=street.match(/^(\d+[a-z]?)\s+(.+)$/),house=norm(result.houseNumber),road=norm(result.road);
        const area=parts.slice(1).map(norm).filter(Boolean),full=norm(result.displayName),words=full.split(' ');
        const areaMismatch=area.some(a=>a.split(' ').some(w=>!words.includes(w)));
        if(areaMismatch)return 'area-unconfirmed';
        if(!match)return 'place';
        if(house&&house!==match[1])return 'different-number';
        if(road!==match[2])return 'unconfirmed';
        return house===match[1]?'address':'street';
    }
    function label(kind,ko){return (ko?{address:'번지·도로명 일치 · 입구는 별도 확인',street:'도로만 일치 · 번지 미확인','different-number':'다른 번지 · 선택 주의','area-unconfirmed':'입력한 지역 일치 미확인',unconfirmed:'주소 일치 미확인',place:'장소 결과 · 전체 주소 확인'}:{address:'House number + street match · verify entrance',street:'Street match only · number unverified','different-number':'Different house number · check before selecting','area-unconfirmed':'Requested area not confirmed',unconfirmed:'Address match unverified',place:'Place result · check full address'})[kind];}
    return {assess,label};
});
