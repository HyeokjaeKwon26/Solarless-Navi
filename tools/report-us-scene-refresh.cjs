#!/usr/bin/env node
// Produce a paired comparison only when candidates and calculation code match.
const fs = require('node:fs');
const path = require('node:path');
const [oldArg, newArg, workspaceArg] = process.argv.slice(2);
if (!oldArg || !newArg || !workspaceArg) throw new Error('Expected old result, new result and working directory');
const old = JSON.parse(fs.readFileSync(path.resolve(oldArg)));
const fresh = JSON.parse(fs.readFileSync(path.resolve(newArg)));
const workspace = path.resolve(workspaceArg);
if (old.version !== 'old' || fresh.version !== 'new' || old.rows.length !== 48 || fresh.rows.length !== 48 ||
    JSON.stringify(old.codeHashes) !== JSON.stringify(fresh.codeHashes) ||
    JSON.stringify(old.runtimeHashes) !== JSON.stringify(fresh.runtimeHashes) || old.candidateSha256 !== fresh.candidateSha256) {
    throw new Error('Calculation code, runtime, candidate data or case count differs');
}
const comparisons = old.rows.map((a, i) => {
    const b = fresh.rows[i];
    if (a.id !== b.id || a.timeCase !== b.timeCase || a.departureUtc !== b.departureUtc ||
        a.fastest.id !== b.fastest.id || a.candidateCount !== b.candidateCount) {
        throw new Error(`Unmatched route or time for ${a.id} ${a.timeCase}`);
    }
    for (const x of [a, b]) for (const route of [x.fastest, x.shade]) {
        if (!Number.isFinite(route.confirmedShadeTimeRatio) || !Number.isFinite(route.uncertainOcclusionTimeRatio)) {
            throw new Error(`Missing scene metrics for ${a.id} ${a.timeCase}`);
        }
    }
    if (!Number.isFinite(a.fastest.sceneCoverage?.segmentRatio) || !Number.isFinite(b.fastest.sceneCoverage?.segmentRatio)) {
        throw new Error(`Missing scene coverage for ${a.id} ${a.timeCase}`);
    }
    return { id: a.id, region: a.region, name: a.name, timeCase: a.timeCase, departureUtc: a.departureUtc,
        durationSec: a.fastest.durationSec, candidateCount: a.candidateCount,
        oldConfirmed: a.fastest.confirmedShadeTimeRatio, newConfirmed: b.fastest.confirmedShadeTimeRatio,
        deltaConfirmedPercentagePoints: 100 * (b.fastest.confirmedShadeTimeRatio - a.fastest.confirmedShadeTimeRatio),
        oldUncertain: a.fastest.uncertainOcclusionTimeRatio, newUncertain: b.fastest.uncertainOcclusionTimeRatio,
        oldShadeRoute: a.shade.id, newShadeRoute: b.shade.id, shadeRouteChanged: a.shade.id !== b.shade.id,
        oldMode: a.fastest.analysisMode, newMode: b.fastest.analysisMode,
        oldCoverage: a.fastest.sceneCoverage, newCoverage: b.fastest.sceneCoverage };
});
const ids = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
const regionStats = ids.map(id => {
    const data = comparisons.filter(row => row.region === id);
    const release = JSON.parse(fs.readFileSync(path.join(workspace, `build-${id}`, 'release', 'manifest.json')));
    const shape = JSON.parse(fs.readFileSync(path.join(workspace, `build-${id}`, 'generated', 'refresh-comparison.json')));
    return { id, releaseTag: release.releaseTag, osmExtractTimestamp: release.osmExtractTimestamp,
        osmPbfSha256: release.osmPbfSha256, tileCount: release.stats.tileCount, packCount: release.stats.packCount,
        shape, cases: data.length,
        meanDeltaPercentagePoints: data.reduce((sum, row) => sum + row.deltaConfirmedPercentagePoints, 0) / data.length,
        maxAbsDeltaPercentagePoints: Math.max(...data.map(row => Math.abs(row.deltaConfirmedPercentagePoints))),
        selectedRouteChanges: data.filter(row => row.shadeRouteChanged).length };
});
const output = { generatedAt: new Date().toISOString(), sourceCommit: old.sourceCommit || null,
    codeHashes: old.codeHashes, runtimeHashes: old.runtimeHashes,
    candidateSha256: old.candidateSha256, candidateFile: old.candidateFile,
    baselineTags: old.tags, updatedTags: fresh.tags, regionStats, comparisons };
fs.writeFileSync('docs/data/us-scene-update-comparison-2026-10-27.json', JSON.stringify(output, null, 2));
const n = x => Number(x).toLocaleString('en-US');
const f = x => Number(x).toFixed(2);
const regionRows = regionStats.map(r => `| ${r.id} | ${n(r.shape.oldBuildings)} | ${n(r.shape.newBuildingIds)} | ${n(r.shape.changedFootprints)} | ${n(r.shape.missingOldBuildingIds)} | ${n(r.shape.newTunnelIds)} | ${n(r.shape.missingOldTunnelIds)} |`).join('\n');
const routeRows = comparisons.map(r => `| ${r.name} | ${r.timeCase} | ${f(100*r.oldConfirmed)} → ${f(100*r.newConfirmed)} | ${f(r.deltaConfirmedPercentagePoints)} | ${f(100*r.oldUncertain)} → ${f(100*r.newUncertain)} | ${f(100*r.oldCoverage.segmentRatio)} → ${f(100*r.newCoverage.segmentRatio)} | ${r.shadeRouteChanged ? '변경' : '동일'} |`).join('\n');
const text = `# 미국 장면 데이터 갱신 및 경로 비교 — 2026-10-27\n\n` +
`Geofabrik OSM 추출본의 기준 시각은 네 권역 모두 2026-10-27T21:23:59Z이다. 각 원본 해시, 지역별 릴리스와 집계는 [JSON](data/us-scene-update-comparison-2026-10-27.json)에 기록했다.\n\n` +
`기존 v3 장면의 건물·터널 way ID 전체와 갱신된 way를 비교했다. 건물 외곽선의 시작점과 진행 방향만 바뀐 경우는 동일하게 취급하며, 그 외 좌표열 차이를 외곽선 변경으로 센다. 동일 형상의 꼭짓점 추가·삭제도 좌표열 차이에 포함될 수 있다. 신규 ID는 기존 장면에 없던 객체이며 신축을 뜻하지 않는다. 미발견 ID 역시 철거 확정이 아니다. 기존 처리 범위 밖인 multipolygon relation은 비교하지 못했으며 권역 중복도 있을 수 있다.\n\n` +
`| 권역 | 기존 건물 | 기존에 없던 건물 ID | 기존 건물 좌표열 변화 | 기존 건물 ID 미발견 | 기존에 없던 터널 ID | 기존 터널 ID 미발견 |\n|:--|--:|--:|--:|--:|--:|--:|\n${regionRows}\n\n` +
`기존 타일의 SRTM 지형 격자를 보존하고 동일 외곽선 건물은 기존 지면 고도를 보존했다. 신규 타일과 신규·변경 건물의 지면 고도에는 Mapzen Terrain Tiles Skadi를 사용했다. 확보한 고도 원본의 파일 해시와 서버 메타데이터는 [목록](data/us-scene-hgt-sources-2026-10-27.jsonl)에 기록했다. 혼합 출처의 90% 수직오차 수준은 확인되지 않아 ±10m는 민감도 가정이다.\n\n` +
`## 경로 비교\n\n` +
`2026-08-14에 저장한 OSRM 도로 후보를 12개 출발·도착지와 네 출발 시각에 재사용해 기존과 갱신본을 같은 코드로 계산했다. 단위는 가장 빠른 동일 경로의 전체 주행시간 대비 비율(%)과 변화 폭(%p)이다. 장면 적용률이 100%보다 낮은 행은 일부 구간에 대체 추정이 포함된다. 갱신에는 신규·변경 건물 지면 고도와 신규 타일 지형의 출처 변화도 포함되므로, 결과를 OSM 변경만의 인과 효과로 분리할 수 없다. 그늘 추천은 제한된 후보 가운데 앱이 선택한 경로의 변경 여부다. 날씨·실측 일조량·현재 교통 상태를 측정한 결과가 아니다.\n\n` +
`| 경로 | 출발 조건 | 확정 그늘 이전 → 이후 (%) | 변화 (%p) | 불확실 이전 → 이후 (%) | 장면 적용률 이전 → 이후 (%) | 그늘 추천 |\n|:--|:--|--:|--:|--:|--:|:--|\n${routeRows}\n\n` +
`갱신 전 상세 결과와 OSRM 후보는 [기준 결과](data/us-scene-update-baseline-2026-10-27.json) 및 [경로 후보](data/us-route-candidates.json)에 있다.\n`;
fs.writeFileSync('docs/US_SCENE_UPDATE_2026-10-27.md', text);
console.log(JSON.stringify({ regionStats, cases: comparisons.length,
    changedSelections: comparisons.filter(row => row.shadeRouteChanged).length }, null, 2));
