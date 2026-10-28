#!/usr/bin/env node
// Assemble the individual source review, component decisions and matched-route
// comparisons into a reproducible audit without treating partial additions as
// resolution of the whole relation.
const fs = require('node:fs');
const path = require('node:path');
const workspace = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Expected workspace');
const regions = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const lines = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
const review = lines(path.join(workspace, 'multipolygon-followup-review.jsonl'));
const originalReview = new Map(lines(path.join(workspace, 'multipolygon-recheck', 'review.jsonl')).map(r => [`${r.region}:${r.id}`, r]));
const decisions = [], stats = [], cases = [];
let environment;
for (const region of regions) {
    const dir = path.join(workspace, `multipolygon-followup-${region}`);
    const oldDir = path.join(workspace, `multipolygon-recheck-${region}`);
    const components = new Map(lines(path.join(dir, 'component-decisions.jsonl')).map(r => [r.id, r]));
    const failures = new Map(['assembly-rejected.jsonl', 'triangulation-rejected.jsonl', 'overlay-blocked.jsonl']
        .flatMap(name => lines(path.join(dir, name))).map(r => [r.id, r.reason]));
    const scene = lines(path.join(dir, 'scene-relations.jsonl'));
    const applied = new Set(scene.map(r => r.id).filter(id => !failures.has(id)));
    const nested = new Map(lines(path.join(dir, 'nested-relations.jsonl')).map(r => [r.id, r]));
    const outerNodes = new Map(lines(path.join(dir, 'outer-node-decisions.jsonl')).map(r => [r.id, r]));
    const duplicates = new Map(lines(path.join(dir, 'dedup-decisions.jsonl')).map(r => [r.id, r]));
    const overlay = read(path.join(dir, 'overlay-audit.json'));
    const validation = read(path.join(dir, 'validation.json'));
    const priorValidation = read(path.join(oldDir, 'validation.json'));
    if (applied.size !== overlay.appliedRelations || overlay.removedWays !== 0 ||
        validation.relationPieces !== priorValidation.relationPieces + overlay.pieces) throw new Error(`Scene audit mismatch ${region}`);
    const local = review.filter(r => r.region === region);
    for (const row of local) {
        const source = originalReview.get(`${region}:${row.id}`);
        if (!source) throw new Error(`Missing original review ${region} ${row.id}`);
        const component = components.get(row.id);
        decisions.push({ ...row, taggedOuters: source.taggedOuters, differences: source.differences,
            nestedMembers: row.members.filter(m => m.type === 'relation').map(m => ({ role: m.role, relation: nested.get(m.id) || null })),
            outcome: applied.has(row.id) ? 'partially_added' : duplicates.has(row.id) ? 'equivalent_geometry_added_once' : 'not_added',
            componentReview: component || null, outerNodeReview: outerNodes.get(row.id) || null,
            equivalentRelation: duplicates.get(row.id) || null,
            finalReason: failures.get(row.id) || component?.reason || outerNodes.get(row.id)?.reason || null });
    }
    const old = read(path.join(oldDir, 'routes-new.json')), fresh = read(path.join(dir, 'routes-new.json'));
    if (old.rows.length !== 12 || fresh.rows.length !== 12 || JSON.stringify(old.codeHashes) !== JSON.stringify(fresh.codeHashes) ||
        JSON.stringify(old.runtimeHashes) !== JSON.stringify(fresh.runtimeHashes) || old.candidateSha256 !== fresh.candidateSha256) throw new Error(`Unmatched comparison ${region}`);
    const env = { code: old.codeHashes, runtime: old.runtimeHashes, candidate: old.candidateSha256 };
    if (environment && JSON.stringify(environment) !== JSON.stringify(env)) throw new Error('Regional environments differ');
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
    stats.push({ region, reviewed: local.length, partialRelations: applied.size, equivalentRelations: duplicates.size,
        selectedComponents: [...applied].reduce((n, id) => n + components.get(id).selectedComponents, 0),
        unchangedRelations: local.length - applied.size - duplicates.size, overlay, validation, packaging: read(path.join(dir, 'package-audit.json')) });
}
if (decisions.length !== 548 || cases.length !== 48) throw new Error('Unexpected audit totals');
fs.writeFileSync('docs/data/us-multipolygon-unresolved-followup-2026-10-28.jsonl', decisions.map(row => JSON.stringify(row)).join('\n') + '\n');
fs.writeFileSync('docs/data/us-multipolygon-followup-routes-2026-10-28.json', JSON.stringify({ generatedAt: new Date().toISOString(), environment, stats, cases }, null, 2) + '\n');
const f = x => Number(x).toFixed(2);
const table = stats.map(s => `| ${s.region} | ${s.reviewed} | ${s.partialRelations} | ${s.selectedComponents} | ${s.equivalentRelations} | ${s.unchangedRelations} |`).join('\n');
const routes = cases.map(c => `| ${c.name} | ${c.timeCase} | ${f(c.oldConfirmed*100)} → ${f(c.newConfirmed*100)} | ${f(c.deltaPercentagePoints)} | ${f(c.oldCoverage*100)} → ${f(c.newCoverage*100)} | ${c.shadeRouteChanged ? '변경' : '동일'} |`).join('\n');
const report = `# 미국 multipolygon 미해결 548개 추가 검토 — 2026-10-28\n\n` +
`이전 검토에서 미해결로 남은 관계 548개의 원본 태그·구성원과 제외 사유를 다시 확인했다. 동일한 2026-10-27T21:23:59Z OSM 추출본을 사용했다. 다른 관계를 구성원으로 둔 경우 해당 중첩 관계의 태그와 구성원도 원본 PBF에서 확인했다. 각 항목은 [ID별 검토 기록](data/us-multipolygon-unresolved-followup-2026-10-28.jsonl)에 있다.\n\n` +
`| 권역 | 검토한 관계 | 일부 형상 추가 | 추가한 분리 면 | 동일 형상으로 한 번만 추가 | 이번에 추가하지 않은 관계 |\n|:--|--:|--:|--:|--:|--:|\n${table}\n\n` +
`추가한 관계도 전체가 해결됐다는 뜻은 아니다. 건물 태그가 있는 독립 외곽 way를 그대로 보존하고, 전체 관계를 조립한 뒤 그 외곽과 면적이 겹치지 않는 건물 관계의 분리된 부분을 추가했다. 외곽 역할로 잘못 지정된 점은 면적을 만들 수 없으므로, 다른 기존 관계와 공유하지 않는 유효한 way 형상만 추가한 사례도 있다. 점이 가리킬 수 있는 추가 면적은 추정하지 않았다. 내부 구멍은 분해 전후 면적과 형상을 검증했다. 미적용 부분에는 외곽 자체가 없거나 중첩 관계, 높이와 건물 부분의 의미, 잘못된 형상 또는 역할이 모호한 사례가 남는다.\n\n` +
`이미 적용된 관계와 경계를 공유하는 부분은 제외했다. 완전히 같은 형상과 높이 정보를 가진 관계 두 개는 한 번만 추가했으며, 두 관계의 태그와 대응 관계는 ID별 기록에 남겼다.\n\n` +
`## 동일 도로 경로 비교\n\n2026-08-14에 저장한 OSRM 후보 12개 경로와 네 출발 시각을 동일 코드·런타임으로 비교했다. 장면 적용률이 100%보다 낮으면 일부는 대체 추정이며 일조량 실측은 아니다. [경로별 전체 수치와 코드 해시](data/us-multipolygon-followup-routes-2026-10-28.json).\n\n` +
`| 경로 | 조건 | 확정 그늘 이전 → 이후 (%) | 변화 (%p) | 적용률 이전 → 이후 (%) | 그늘 추천 |\n|:--|:--|--:|--:|--:|:--|\n${routes}\n\n` +
`새 manifest는 새 릴리스와 이전 세 릴리스의 ZIP을 참조하므로 네 릴리스를 모두 유지해야 한다.\n`;
fs.writeFileSync('docs/US_MULTIPOLYGON_FOLLOWUP_2026-10-28.md', report);
console.log(JSON.stringify({ stats: stats.map(({region, reviewed, partialRelations, selectedComponents, equivalentRelations, unchangedRelations}) => ({region, reviewed, partialRelations, selectedComponents, equivalentRelations, unchangedRelations})),
    cases: cases.length, changed: cases.filter(c => Math.abs(c.deltaPercentagePoints) > 1e-10).length,
    changedSelections: cases.filter(c => c.shadeRouteChanged).length }, null, 2));
