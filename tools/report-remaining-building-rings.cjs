#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const workspace = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Expected workspace');
const regions = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const review = lines(path.join(workspace, 'multipolygon-last-review.jsonl'));
if (review.length !== 472) throw new Error('Unexpected review count');
const stats = [], cases = [], decisions = [];
let environment;
for (const region of regions) {
    const dir = path.join(workspace, `multipolygon-last-${region}`);
    const oldDir = path.join(workspace, `multipolygon-followup-${region}`);
    const prepared = lines(path.join(dir, 'scene-relations.jsonl'));
    const selected = new Map(lines(path.join(dir, 'selection-decisions.jsonl')).map(row => [row.id, row]));
    const hasChanges = prepared.length > 0;
    const blocked = hasChanges ? new Map(lines(path.join(dir, 'overlay-blocked.jsonl')).map(r => [r.id, r.reason])) : new Map();
    const applied = new Set(prepared.map(r => r.id).filter(id => !blocked.has(id)));
    if (hasChanges) {
        const overlay = read(path.join(dir, 'overlay-audit.json')), verification = read(path.join(dir, 'validation.json'));
        const prior = read(path.join(oldDir, 'validation.json'));
        if (overlay.appliedRelations !== applied.size || overlay.removedWays !== 0 || verification.relationPieces !== prior.relationPieces + overlay.pieces) throw new Error(`Overlay verification mismatch: ${region}`);
        const old = read(path.join(oldDir, 'routes-new.json')), fresh = read(path.join(dir, 'routes-new.json'));
        if (old.rows.length !== 12 || fresh.rows.length !== 12 || JSON.stringify(old.codeHashes) !== JSON.stringify(fresh.codeHashes) ||
            JSON.stringify(old.runtimeHashes) !== JSON.stringify(fresh.runtimeHashes) || old.candidateSha256 !== fresh.candidateSha256) throw new Error(`Route environment mismatch: ${region}`);
        const env = { code: old.codeHashes, runtime: old.runtimeHashes, candidate: old.candidateSha256 };
        if (environment && JSON.stringify(environment) !== JSON.stringify(env)) throw new Error('Inconsistent route environments');
        environment = env;
        old.rows.forEach((a, i) => {
            const b = fresh.rows[i];
            if (a.id !== b.id || a.timeCase !== b.timeCase || a.departureUtc !== b.departureUtc || a.fastest.id !== b.fastest.id || a.candidateCount !== b.candidateCount ||
                !Number.isFinite(a.fastest.confirmedShadeTimeRatio) || !Number.isFinite(b.fastest.confirmedShadeTimeRatio) ||
                !Number.isFinite(a.fastest.sceneCoverage?.segmentRatio) || !Number.isFinite(b.fastest.sceneCoverage?.segmentRatio)) throw new Error(`Unmatched route ${region} ${a.id}`);
            cases.push({ region, id: a.id, name: a.name, timeCase: a.timeCase, departureUtc: a.departureUtc,
                oldConfirmed: a.fastest.confirmedShadeTimeRatio, newConfirmed: b.fastest.confirmedShadeTimeRatio,
                deltaPercentagePoints: 100 * (b.fastest.confirmedShadeTimeRatio - a.fastest.confirmedShadeTimeRatio),
                oldUncertain: a.fastest.uncertainOcclusionTimeRatio, newUncertain: b.fastest.uncertainOcclusionTimeRatio,
                oldCoverage: a.fastest.sceneCoverage.segmentRatio, newCoverage: b.fastest.sceneCoverage.segmentRatio,
                oldShadeRoute: a.shade.id, newShadeRoute: b.shade.id, shadeRouteChanged: a.shade.id !== b.shade.id });
        });
    }
    const local = review.filter(r => r.region === region);
    for (const r of local) decisions.push({ ...r, outcome: applied.has(r.id) ? 'partially_added' : 'not_added',
        selectedWayIds: applied.has(r.id) ? selected.get(r.id).selectedWayIds : [], finalReason: blocked.get(r.id) || null });
    stats.push({ region, reviewed: local.length, partiallyAdded: applied.size, notAdded: local.length - applied.size,
        addedOuterWays: [...applied].reduce((sum, id) => sum + selected.get(id).selectedWayIds.length, 0),
        pieces: prepared.filter(r => applied.has(r.id)).reduce((sum, r) => sum + r.pieces.length, 0),
        ...(hasChanges ? { overlay: read(path.join(dir, 'overlay-audit.json')), validation: read(path.join(dir, 'validation.json')), packaging: read(path.join(dir, 'package-audit.json')) } : {}) });
}
if (decisions.length !== 472 || cases.length !== 24) throw new Error('Unexpected audit totals');
fs.writeFileSync('docs/data/us-multipolygon-remaining-472-2026-10-28.jsonl', decisions.map(r => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync('docs/data/us-multipolygon-remaining-472-routes-2026-10-28.json', JSON.stringify({ generatedAt: new Date().toISOString(), environment, stats, cases }, null, 2) + '\n');
const f = x => Number(x).toFixed(2);
const table = stats.map(s => `| ${s.region} | ${s.reviewed} | ${s.partiallyAdded} | ${s.addedOuterWays} | ${s.notAdded} |`).join('\n');
const routes = cases.map(c => `| ${c.name} | ${c.timeCase} | ${f(c.oldConfirmed*100)} → ${f(c.newConfirmed*100)} | ${f(c.deltaPercentagePoints)} | ${f(c.oldCoverage*100)} → ${f(c.newCoverage*100)} | ${c.shadeRouteChanged ? '변경' : '동일'} |`).join('\n');
const report = `# 미국 multipolygon 미추가 472개 추가 검토 — 2026-10-28\n\n` +
`이전 검토에서 이번에 추가하지 못한 관계 472개를 동일한 2026-10-27T21:23:59Z OSM 추출본의 구성원·태그와 이전 검토 결과에 대조했다. 각 관계의 [검토 결과와 제외된 외곽](data/us-multipolygon-remaining-472-2026-10-28.jsonl)을 기록했다.\n\n` +
`| 권역 | 검토 관계 | 일부 외곽 추가 | 추가한 외곽 way | 이번에 추가하지 않음 |\n|:--|--:|--:|--:|--:|\n${table}\n\n` +
`기존 관계와 공유하거나 다른 외곽과 겹치는 형상은 제외했다. 조립에 실패한 관계에서는 내곽이 없고 모든 외곽 way가 닫혀 유효한 경우, 다른 외곽과 면적이 겹치지 않는 개별 부분만 추가했다. 중첩 관계의 경우 기존 지도에 온전히 들어 있는 자식과 겹치지 않는 유효한 외곽만 선택했다. 기존 건물은 삭제하지 않았고, 맞닿은 외곽의 합집합은 면적이 원본 합과 같은지 확인했다. 추가된 관계도 전체가 해결됐다는 뜻은 아니다.\n\n` +
`이번에 선택된 다섯 관계에는 명시적인 높이 또는 층수 태그가 없어, 기존 장면 모델의 기본 높이와 민감도 범위를 적용한다. 이는 실제 건물 높이의 확인값이 아니다.\n\n` +
`기존 건물과의 위치 중복은 후보 중심 5 km 타일의 주변 2타일, 즉 25 km × 25 km 범위의 장면에서 확인했다. 건물의 타일은 중심점 기준이므로, 그 범위 바깥에 중심을 둔 비정상적으로 큰 건물까지 전 세계적으로 전수 검색한 것은 아니다. 나머지는 형상·구멍·중첩 관계 또는 높이 정보가 불명확해 임의로 채우지 않았다.\n\n` +
`## 동일 도로 경로 비교\n\n변경한 동북부와 중서부의 저장된 OSRM 후보 경로 6개·출발 시각 네 조건을 같은 코드와 런타임으로 비교했다. 적용률이 100% 미만이면 일부는 대체 추정이며 일조량 실측이 아니다. 남부와 서부 파일은 바뀌지 않아 다시 계산하지 않았다. [기계 판독 결과](data/us-multipolygon-remaining-472-routes-2026-10-28.json).\n\n` +
`| 경로 | 조건 | 확정 그늘 이전 → 이후 (%) | 변화 (%p) | 적용률 이전 → 이후 (%) | 그늘 추천 |\n|:--|:--|--:|--:|--:|:--|\n${routes}\n\n` +
`동북부와 중서부 새 manifest는 새 릴리스와 이전 네 릴리스의 ZIP을 함께 참조하므로 다섯 릴리스를 모두 유지해야 한다.\n`;
fs.writeFileSync('docs/US_MULTIPOLYGON_REMAINING_472_2026-10-28.md', report);
console.log(JSON.stringify({stats: stats.map(({region, reviewed, partiallyAdded, notAdded, addedOuterWays, pieces}) => ({region, reviewed, partiallyAdded, notAdded, addedOuterWays, pieces})),
    cases: cases.length, changed: cases.filter(c => Math.abs(c.deltaPercentagePoints)>1e-10).length, changedSelections: cases.filter(c => c.shadeRouteChanged).length}, null, 2));
