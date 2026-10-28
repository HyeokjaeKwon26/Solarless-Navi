#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const workspace = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Expected workspace');
const regions = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const stats = [], cases = [], decisions = [];
let environment = null;
for (const region of regions) {
    const prior = path.join(workspace, `multipolygon-${region}`), dir = path.join(workspace, `multipolygon-recheck-${region}`);
    const original = ['assembly-rejected.jsonl', 'triangulation-rejected.jsonl', 'overlay-blocked.jsonl']
        .flatMap(name => lines(path.join(prior, name)));
    const preliminary = new Map(lines(path.join(dir, 'decisions.jsonl')).map(row => [row.id, row]));
    const assembledFailures = new Map(lines(path.join(dir, 'assembly-rejected.jsonl')).map(row => [row.id, row.reason]));
    const prepFailures = new Map(lines(path.join(dir, 'triangulation-rejected.jsonl')).map(row => [row.id, row.reason]));
    const blocked = new Map(lines(path.join(dir, 'overlay-blocked.jsonl')).map(row => [row.id, row.reason]));
    const added = new Set(lines(path.join(dir, 'scene-relations.jsonl')).map(row => row.id).filter(id => !blocked.has(id)));
    const covered = new Map(lines(path.join(dir, 'already-covered-footprints.jsonl')).map(row => [row.id, row]));
    const overlay = read(path.join(dir, 'overlay-audit.json'));
    const assembly = read(path.join(dir, 'assembly-audit.json'));
    const preparation = read(path.join(dir, 'scene-preparation-audit.json'));
    const packaging = read(path.join(dir, 'package-audit.json'));
    const validation = read(path.join(dir, 'validation.json'));
    const priorValidation = read(path.join(prior, 'validation.json'));
    if (added.size !== overlay.appliedRelations || validation.relationPieces !== priorValidation.relationPieces + overlay.pieces ||
        assembly.assembled !== preparation.relations + preparation.rejected) throw new Error(`Audit accounting mismatch: ${region}`);
    const regionDecisions = [];
    for (const item of original) {
        const proposed = preliminary.get(item.id);
        if (!proposed) throw new Error(`Missing decision ${region} ${item.id}`);
        const status = added.has(item.id) ? 'added' : covered.has(item.id) ? 'existing_2d_footprint' : 'unresolved';
        const reason = status === 'added' ? null : assembledFailures.get(item.id) || prepFailures.get(item.id) ||
            blocked.get(item.id) || proposed.reason || 'not_applied';
        const row = { region, id: item.id, originalReason: item.reason, status, reason,
            ...(status === 'added' ? { changes: proposed.changes } : {}),
            ...(status === 'existing_2d_footprint' ? { existingWayIds: covered.get(item.id).existingWayIds } : {}) };
        regionDecisions.push(row); decisions.push(row);
    }
    const old = read(path.join(dir, 'routes-old.json')), fresh = read(path.join(dir, 'routes-new.json'));
    if (old.version !== 'old' || fresh.version !== 'new' || old.rows.length !== 12 || fresh.rows.length !== 12 ||
        JSON.stringify(old.codeHashes) !== JSON.stringify(fresh.codeHashes) || JSON.stringify(old.runtimeHashes) !== JSON.stringify(fresh.runtimeHashes) ||
        old.candidateSha256 !== fresh.candidateSha256) throw new Error(`Comparison environment mismatch: ${region}`);
    const env = { code: old.codeHashes, runtime: old.runtimeHashes, candidate: old.candidateSha256 };
    if (environment && JSON.stringify(environment) !== JSON.stringify(env)) throw new Error('Regional comparison environments differ');
    environment = env;
    old.rows.forEach((a, i) => {
        const b = fresh.rows[i];
        if (a.id !== b.id || a.timeCase !== b.timeCase || a.departureUtc !== b.departureUtc ||
            a.fastest.id !== b.fastest.id || a.candidateCount !== b.candidateCount ||
            !Number.isFinite(a.fastest.confirmedShadeTimeRatio) || !Number.isFinite(b.fastest.confirmedShadeTimeRatio) ||
            !Number.isFinite(a.fastest.sceneCoverage?.segmentRatio) || !Number.isFinite(b.fastest.sceneCoverage?.segmentRatio)) {
            throw new Error(`Unmatched route ${region} ${a.id}`);
        }
        cases.push({ region, id: a.id, name: a.name, timeCase: a.timeCase, departureUtc: a.departureUtc,
            oldConfirmed: a.fastest.confirmedShadeTimeRatio, newConfirmed: b.fastest.confirmedShadeTimeRatio,
            deltaPercentagePoints: 100 * (b.fastest.confirmedShadeTimeRatio - a.fastest.confirmedShadeTimeRatio),
            oldUncertain: a.fastest.uncertainOcclusionTimeRatio, newUncertain: b.fastest.uncertainOcclusionTimeRatio,
            oldCoverage: a.fastest.sceneCoverage.segmentRatio, newCoverage: b.fastest.sceneCoverage.segmentRatio,
            oldShadeRoute: a.shade.id, newShadeRoute: b.shade.id, shadeRouteChanged: a.shade.id !== b.shade.id });
    });
    const n = status => regionDecisions.filter(row => row.status === status).length;
    stats.push({ region, originalExcluded: original.length, added: n('added'),
        existing2dFootprint: n('existing_2d_footprint'), unresolved: n('unresolved'),
        independentParts: regionDecisions.filter(row => row.status === 'added' && row.changes?.includes('independent_building_part_parent_retained')).length,
        assembly, preparation, overlay, packaging, validation });
}
if (decisions.length !== 1934 || cases.length !== 48) throw new Error('Unexpected total case count');
fs.mkdirSync('docs/data', { recursive: true });
fs.writeFileSync('docs/data/us-multipolygon-recheck-decisions-2026-10-28.jsonl', decisions.map(row => JSON.stringify(row)).join('\n') + '\n');
const output = { generatedAt: new Date().toISOString(), sourceCommit: process.env.SCENE_COMPARISON_SOURCE_COMMIT || null,
    comparisonEnvironment: environment, stats, cases };
fs.writeFileSync('docs/data/us-multipolygon-recheck-comparison-2026-10-28.json', JSON.stringify(output, null, 2) + '\n');
const f = x => Number(x).toFixed(2), n = x => Number(x).toLocaleString('en-US');
const regionsTable = stats.map(s => `| ${s.region} | ${n(s.originalExcluded)} | ${n(s.added)} | ${n(s.existing2dFootprint)} | ${n(s.unresolved)} |`).join('\n');
const caseRows = cases.map(c => `| ${c.name} | ${c.timeCase} | ${f(100*c.oldConfirmed)} → ${f(100*c.newConfirmed)} | ${f(c.deltaPercentagePoints)} | ${f(100*c.oldUncertain)} → ${f(100*c.newUncertain)} | ${f(100*c.oldCoverage)} → ${f(100*c.newCoverage)} | ${c.shadeRouteChanged ? '변경' : '동일'} |`).join('\n');
const report = `# 미국 multipolygon 미적용 항목 재검토 — 2026-10-28\n\n` +
`이전 비교에서 미적용된 1,934개 건물 관계를 원본 OSM 관계·way 태그와 기존 지도에 대조했다. 원본은 기존과 같은 2026-10-27T21:23:59Z 추출본이다. 각 관계의 처리 결과는 [ID별 목록](data/us-multipolygon-recheck-decisions-2026-10-28.jsonl), 집계와 경로별 수치는 [JSON](data/us-multipolygon-recheck-comparison-2026-10-28.json)에 기록했다.\n\n` +
`| 권역 | 이전 미적용 | 이번 추가 | 기존 way에 2차원 외곽선 존재 | 미해결 |\n|:--|--:|--:|--:|--:|\n${regionsTable}\n\n` +
`독립된 건물 부분은 높이 또는 층수가 명시된 경우에만 본체 way를 보존하며 추가했다. 외곽선에만 있던 높이를 이어받는 경우에는 관계와 충돌하지 않는지 확인했다. 비기하 노드와 명백한 역할 표기 오류를 처리한 경우에도 원본의 형상을 조립하고 안뜰과 면적을 검증했다. 이미 존재하는 외곽선 분류는 평면 형상만 뜻하며 관계의 높이 태그까지 동일함을 보장하지 않는다.\n\n` +
`건물 본체와 독립된 부분은 각각 차광물로 계산한다. 기존 본체 외곽이 부분 객체의 내부 구멍을 덮는 경우 그 본체의 차광 판정은 유지된다. 미해결 관계에는 외곽 형상이 없거나 건물 부분·높이 정보가 모호한 경우가 포함되며 임의로 형상을 추정하지 않았다.\n\n` +
`## 동일 도로 경로 비교\n\n2026-08-14에 저장한 OSRM 후보 12개 경로·네 출발 시각을 같은 코드로 비교했다. 장면 적용률이 100%보다 낮은 경우 일부는 대체 추정이다. 일조량 실측이나 현재 교통상황이 아니다.\n\n` +
`| 경로 | 조건 | 확정 그늘 이전 → 이후 (%) | 변화 (%p) | 불확실 이전 → 이후 (%) | 적용률 이전 → 이후 (%) | 그늘 추천 |\n|:--|:--|--:|--:|--:|--:|:--|\n${caseRows}\n\n` +
`새 manifest는 이번 릴리스와 이전 두 릴리스의 ZIP을 함께 참조하므로 세 릴리스를 모두 보존해야 한다.\n`;
fs.writeFileSync('docs/US_MULTIPOLYGON_RECHECK_2026-10-28.md', report);
console.log(JSON.stringify({ stats: stats.map(({ region, originalExcluded, added, existing2dFootprint, unresolved, independentParts }) =>
    ({ region, originalExcluded, added, existing2dFootprint, unresolved, independentParts })), cases: cases.length,
    changed: cases.filter(c => Math.abs(c.deltaPercentagePoints) > 1e-10).length,
    changedSelections: cases.filter(c => c.shadeRouteChanged).length }, null, 2));
