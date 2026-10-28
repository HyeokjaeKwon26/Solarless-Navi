(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RoutePresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const colors = Object.freeze({ glare: '#f59e0b', uncertain: '#eab308', shade: '#7c3aed', estimated: '#0e7490', normal: '#0284c7', alternative: '#64748b' });
    function assessment(segment) {
        const risk = Number(segment?.glareRisk) || 0;
        const knownShade = typeof segment?.occlusionRatio === 'number' && Number.isFinite(segment.occlusionRatio);
        const forecast = segment?.irradiance?.model === 'OPEN_METEO_FORECAST';
        const high = risk > .45;
        const uncertain = high && (!knownShade || !forecast);
        return { risk, uncertain, warningRisk: high && !uncertain ? risk : 0 };
    }
    function segmentColor(segment) {
        const state = assessment(segment);
        return state.uncertain ? colors.uncertain : state.warningRisk > .45 ? colors.glare : segment.confirmedShade ? colors.shade
            : segment.shadeState === 'estimated-shade' && segment.shadeScore > 0.5 ? colors.estimated : colors.normal;
    }
    function segmentStyle(segment) { return { color: segmentColor(segment), dashArray: assessment(segment).uncertain ? '7 7' : null }; }
    function fallbackText(reason, language) {
        const ko = String(language).startsWith('ko');
        const text = ko ? {
            'no-candidates': '비교 가능한 다른 경로를 받지 못했습니다.',
            budget: '눈부심 감소 후보가 설정한 추가 시간 한도를 넘었습니다.',
            ratio: '받은 우회 후보가 최단시간 대비 35% 한도를 넘었습니다.',
            'no-improvement': '비교 가능한 후보 중 눈부심 감소 기준과 우회 한도를 함께 충족한 경로가 없습니다.'
        } : {
            'no-candidates': 'No comparable alternative was returned.',
            budget: 'Glare-reducing alternatives exceed your extra-time limit.',
            ratio: 'Returned alternatives exceed the 35% detour limit.',
            'no-improvement': 'No comparable alternative met both the glare-reduction and detour limits.'
        };
        return reason === 'alternative' ? '' : (ko ? '최단시간 경로와 동일 · ' : 'Same as fastest · ') + text[reason];
    }
    function labels(language) {
        return String(language).startsWith('ko') ? {
            title: '경로 색상 범례', button: '범례', close: '닫기',
            items: ['주황 · 기상·차폐 분석상 눈부심 가능성이 높은 구간', '노랑 점선 · 눈부심 가능성은 있으나 차폐 또는 기상 미확인', '보라 · 건물·지형 분석에서 그늘로 계산된 구간',
                '청록 · 간이 추정으로 그늘 가능성이 높은 구간', '파랑 · 기본 구간 (그늘·눈부심 없음의 보장은 아님)', '회색 점선 · 선택하지 않은 후보 경로'],
            note: '교통 정체 표시가 아닙니다. 예상 통과 시각과 지도·기상 데이터를 이용한 추정이며 현장 측정이 아닙니다. 나무·차량·실제 구름은 다를 수 있습니다. 노랑 점선은 눈부심이 없다는 뜻이 아닙니다.',
            saver: '절전모드에서는 지도가 흑백으로 표시됩니다.',
            previewGps: '경로 미리보기 · 안내 시작 시 현재 GPS를 재확인합니다.',
            previewAddress: '지정한 출발지의 미리보기 · 실제 안내는 현재 GPS에서 시작합니다.'
        } : {
            title: 'Route colors', button: 'Colors', close: 'Close',
            items: ['Orange · Higher glare potential using weather and occlusion estimates', 'Yellow dashed · Possible glare; shade or weather unverified', 'Purple · Shade calculated from buildings or terrain',
                'Teal · Shade suggested by a simpler estimate', 'Blue · Default segment (does not guarantee shade or no glare)', 'Gray dashed · Unselected alternative route'],
            note: 'These colors do not show traffic congestion. Estimates use expected passing time, map and weather data, not field-verified shade. Trees, vehicles and actual clouds may differ. Yellow dashed does not mean glare-free.',
            saver: 'Battery saver displays the map in grayscale.',
            previewGps: 'Route preview · Current GPS will be checked when guidance starts.',
            previewAddress: 'Preview from your selected origin · Guidance starts from current GPS.'
        };
    }
    return { colors, segmentColor, segmentStyle, assessment, fallbackText, labels };
});
