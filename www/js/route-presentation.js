(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.RoutePresentation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const colors = Object.freeze({ glare: '#f59e0b', shade: '#7c3aed', estimated: '#0e7490', normal: '#0284c7', alternative: '#64748b' });
    function segmentColor(segment) {
        return segment.glareRisk > 0.45 ? colors.glare : segment.confirmedShade ? colors.shade
            : segment.shadeState === 'estimated-shade' && segment.shadeScore > 0.5 ? colors.estimated : colors.normal;
    }
    function labels(language) {
        return String(language).startsWith('ko') ? {
            title: '경로 색상 범례', button: '범례', close: '닫기',
            items: ['주황 · 예상 눈부심 위험이 높은 구간', '보라 · 건물·지형 분석에서 그늘로 계산된 구간',
                '청록 · 간이 추정으로 그늘 가능성이 높은 구간', '파랑 · 기본 구간 (그늘·눈부심 없음의 보장은 아님)', '회색 점선 · 선택하지 않은 후보 경로'],
            note: '교통 정체 표시가 아닙니다. 예상 통과 시각과 지도·기상 데이터를 이용한 계산·추정이며, 실제 그늘을 현장에서 확인한 결과가 아닙니다. 눈부심 위험이 높으면 주황색을 우선 표시합니다.',
            saver: '절전모드에서는 지도가 흑백으로 표시됩니다.',
            previewGps: '경로 미리보기 · 안내 시작 시 현재 GPS를 재확인합니다.',
            previewAddress: '지정한 출발지의 미리보기 · 실제 안내는 현재 GPS에서 시작합니다.'
        } : {
            title: 'Route colors', button: 'Colors', close: 'Close',
            items: ['Orange · Higher estimated glare risk', 'Purple · Shade calculated from buildings or terrain',
                'Teal · Shade suggested by a simpler estimate', 'Blue · Default segment (does not guarantee shade or no glare)', 'Gray dashed · Unselected alternative route'],
            note: 'These colors do not show traffic congestion. They are calculations and estimates for your expected passing time using map and weather data, not field-verified shade. Higher glare risk takes priority and appears orange.',
            saver: 'Battery saver displays the map in grayscale.',
            previewGps: 'Route preview · Current GPS will be checked when guidance starts.',
            previewAddress: 'Preview from your selected origin · Guidance starts from current GPS.'
        };
    }
    return { colors, segmentColor, labels };
});
