#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const workspace = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Expected workspace directory');
const regions = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const cases = [], stats = [];
let hashes = null;
for (const region of regions) {
    const dir = path.join(workspace, `multipolygon-${region}`);
    const { pbf: _localPbf, ...source } = read(path.join(dir, 'relations.jsonl.summary.json'));
    const members = read(path.join(dir, 'member-audit.json'));
    const assembly = read(path.join(dir, 'assembly-audit.json'));
    const preparation = read(path.join(dir, 'scene-preparation-audit.json'));
    const overlay = read(path.join(dir, 'overlay-audit.json'));
    const packaging = read(path.join(dir, 'package-audit.json'));
    const validation = read(path.join(dir, 'validation.json'));
    const old = read(path.join(dir, 'routes-old.json')), fresh = read(path.join(dir, 'routes-new.json'));
    if (old.version !== 'old' || fresh.version !== 'new' || old.rows.length !== 12 || fresh.rows.length !== 12 ||
        JSON.stringify(old.codeHashes) !== JSON.stringify(fresh.codeHashes) ||
        JSON.stringify(old.runtimeHashes) !== JSON.stringify(fresh.runtimeHashes) || old.candidateSha256 !== fresh.candidateSha256) {
        throw new Error(`Unmatched comparison environment: ${region}`);
    }
    const currentHashes = { code: old.codeHashes, runtime: old.runtimeHashes, candidate: old.candidateSha256 };
    if (hashes && JSON.stringify(hashes) !== JSON.stringify(currentHashes)) throw new Error('Different regional comparison environments');
    hashes = currentHashes;
    old.rows.forEach((a, i) => {
        const b = fresh.rows[i];
        if (a.id !== b.id || a.timeCase !== b.timeCase || a.departureUtc !== b.departureUtc || a.fastest.id !== b.fastest.id ||
            a.candidateCount !== b.candidateCount || !Number.isFinite(a.fastest.confirmedShadeTimeRatio) ||
            !Number.isFinite(b.fastest.confirmedShadeTimeRatio) || !Number.isFinite(a.fastest.sceneCoverage?.segmentRatio) ||
            !Number.isFinite(b.fastest.sceneCoverage?.segmentRatio)) throw new Error(`Unmatched route case ${region} ${a.id}`);
        cases.push({ region, id: a.id, name: a.name, timeCase: a.timeCase, departureUtc: a.departureUtc,
            oldConfirmed: a.fastest.confirmedShadeTimeRatio, newConfirmed: b.fastest.confirmedShadeTimeRatio,
            deltaPercentagePoints: 100 * (b.fastest.confirmedShadeTimeRatio - a.fastest.confirmedShadeTimeRatio),
            oldUncertain: a.fastest.uncertainOcclusionTimeRatio, newUncertain: b.fastest.uncertainOcclusionTimeRatio,
            oldCoverage: a.fastest.sceneCoverage.segmentRatio, newCoverage: b.fastest.sceneCoverage.segmentRatio,
            oldShadeRoute: a.shade.id, newShadeRoute: b.shade.id, shadeRouteChanged: a.shade.id !== b.shade.id });
    });
    if (validation.relationPieces !== overlay.pieces || assembly.candidates !== members.candidate_total ||
        preparation.relations + preparation.rejected !== assembly.assembled ||
        overlay.appliedRelations + overlay.blockedRelations !== preparation.relations) throw new Error(`Audit accounting mismatch ${region}`);
    stats.push({ region, source, members, assembly, preparation, overlay, packaging, validation });
}
const result = { generatedAt: new Date().toISOString(), sourceCommit: process.env.SCENE_COMPARISON_SOURCE_COMMIT || null,
    comparisonEnvironment: hashes, stats, cases };
fs.mkdirSync('docs/data', { recursive: true });
fs.writeFileSync('docs/data/us-multipolygon-comparison-2026-10-28.json', JSON.stringify(result, null, 2) + '\n');
const n = value => Number(value).toLocaleString('en-US'), f = value => Number(value).toFixed(2);
const statRows = stats.map(s => `| ${s.region} | ${n(s.members.candidate_total)} | ${n(s.assembly.assembled)} | ${n(s.overlay.appliedRelations)} | ${n(s.members.candidate_total-s.overlay.appliedRelations)} | ${n(s.overlay.removedWays)} |`).join('\n');
const routeRows = cases.map(r => `| ${r.name} | ${r.timeCase} | ${f(r.oldConfirmed*100)} → ${f(r.newConfirmed*100)} | ${f(r.deltaPercentagePoints)} | ${f(r.oldUncertain*100)} → ${f(r.newUncertain*100)} | ${f(r.oldCoverage*100)} → ${f(r.newCoverage*100)} | ${r.shadeRouteChanged ? '변경' : '동일'} |`).join('\n');
const text = `# 미국 건물 multipolygon 점검 — 2026-10-28\n\n` +
`네 권역에서 기존 배포본과 동일한 2026-10-27T21:23:59Z OSM 추출본을 사용했다. 다른 날짜의 OSM 수정과 관계 지원의 효과가 섞이지 않도록 했다. 각 원본 해시와 전체 집계·경로 결과는 [JSON](data/us-multipolygon-comparison-2026-10-28.json)에 있다.\n\n` +
`건물 또는 building:part 태그가 붙은 multipolygon과, 다른 면적 용도가 명시되지 않고 외곽 way에 건물 태그가 붙은 구형 관계를 비교했다. 기존 데이터에는 관계 객체가 없었으나 일부 외곽 way는 이미 들어 있었다. 호환 가능한 중복 외곽 way만 제거했고 구조 태그 충돌, 결손 노드·way, 조립 실패, 중복 관계 등은 제외 사유와 함께 [목록](data/us-multipolygon-excluded-2026-10-28.jsonl)에 기록했다. 건물이 아닌 관계와 별도 면적 용도가 있는 관계의 건물 태그 외곽은 이 집계에 포함하지 않는다.\n\n` +
`| 권역 | 건물 관계 후보 | 형상 조립 | 지도에 적용 | 미적용 | 대체한 기존 way |\n|:--|--:|--:|--:|--:|--:|\n${statRows}\n\n` +
`안뜰 등 내부 구멍은 빈 공간으로 보존했다. 기존 클라이언트가 처리할 수 있도록 구멍이 없는 단순 다각형으로 나누고 원래 형상과 면적 일치를 검증했다. 기존 지형 격자는 보존했으며 새 건물 지면에는 Mapzen Skadi를 사용했다. 원본의 지면 정확도와 높이 태그가 없는 건물의 높이는 불확실하다.\n\n` +
`형상은 pyosmium 4.1.1 환경에서 조립한 뒤 4.3.2 환경으로 네 권역의 모든 조립 결과를 다시 확인해 위상적으로 동일함을 검증했다. 재현용 패키지 버전은 \`tools/requirements-multipolygon.txt\`에 기록했다.\n\n` +
`새 manifest는 변경된 ZIP을 새 릴리스에서, 변경되지 않은 ZIP은 2026-10-27 기존 릴리스에서 불러온다. 따라서 해당 기존 릴리스를 함께 보존해야 한다.\n\n` +
`## 동일 도로 경로 비교\n\n` +
`2026-08-14 저장 OSRM 후보 12개 경로와 출발 시각 네 조건을 동일한 앱 코드로 비교했다. 표는 동일한 최단시간 경로의 전체 주행시간 대비 확정 그늘·불확실 차광 비율과 장면 적용률이다. 적용률이 100% 미만인 경우 일부 구간에 대체 추정이 포함된다. 모델 계산이며 일조량 실측이나 현재 교통상황이 아니다.\n\n` +
`| 경로 | 조건 | 확정 그늘 이전 → 이후 (%) | 변화 (%p) | 불확실 이전 → 이후 (%) | 적용률 이전 → 이후 (%) | 그늘 추천 |\n|:--|:--|--:|--:|--:|--:|:--|\n${routeRows}\n`;
fs.writeFileSync('docs/US_MULTIPOLYGON_UPDATE_2026-10-28.md', text);
console.log(JSON.stringify({ cases: cases.length, changed: cases.filter(x => Math.abs(x.deltaPercentagePoints) > 1e-10).length,
    changedSelections: cases.filter(x => x.shadeRouteChanged).length, applied: stats.map(s => ({ region: s.region, relations: s.overlay.appliedRelations })) }, null, 2));
