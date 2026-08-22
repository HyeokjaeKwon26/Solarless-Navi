#!/usr/bin/env node
/*
 * Reproducible U.S. route/solar simulation.
 *
 * This intentionally reports clear-sky broadband direct-solar energy rather
 * than UV dose or cabin temperature. Cooling figures are a sensitivity range
 * derived from avoided incident energy under declared vehicle assumptions.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_DIR = path.join(ROOT, 'docs');
const DATA_DIR = path.join(REPORT_DIR, 'data');
const IMAGE_DIR = path.join(REPORT_DIR, 'images');
const ROUTE_CACHE_FILE = path.join(DATA_DIR, 'us-route-candidates.json');
const RESULT_JSON_FILE = path.join(DATA_DIR, 'us-solar-route-simulation.json');
const RESULT_CSV_FILE = path.join(DATA_DIR, 'us-solar-route-simulation.csv');
const REPORT_FILE = path.join(REPORT_DIR, 'US_SOLAR_ROUTE_SIMULATION.md');

for (const directory of [REPORT_DIR, DATA_DIR, IMAGE_DIR]) fs.mkdirSync(directory, { recursive: true });

const regionReleaseDirs = {
    northeast: process.env.SCENE_NE_DIR || 'D:\\SolarLessNavi-v2\\us-northeast\\v2-density-release',
    midwest: process.env.SCENE_MW_DIR || 'D:\\SolarLessNavi-v2\\us-midwest\\v2-density-release',
    south: process.env.SCENE_SOUTH_DIR || 'D:\\SolarLessNavi-v2\\us-south\\v2-density-release',
    west: process.env.SCENE_WEST_DIR || 'D:\\SolarLessNavi-v2\\us-west\\v2-density-release'
};
const releaseDirs = {};
const regionTags = {};
const sceneReleaseInfo = {};

// Read the release identity from each manifest rather than hard-coding v2.
// This lets the same harness document either the current validated releases or
// schema-v3 releases supplied through SCENE_*_DIR without misrouting ZIPs.
for (const [region, directory] of Object.entries(regionReleaseDirs)) {
    const manifestFile = path.join(directory, 'manifest.json');
    if (!fs.existsSync(manifestFile)) {
        throw new Error(`Missing local validated scene release for ${region}: ${directory}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const releaseTag = String(manifest.releaseTag || `scene-us-${region}-hybrid-v2`);
    releaseDirs[releaseTag] = directory;
    regionTags[region] = releaseTag;
    sceneReleaseInfo[region] = {
        releaseTag,
        schema: Number(manifest.schema) || null,
        dataVersion: manifest.dataVersion || null,
        uncertaintyModel: manifest.uncertaintyModel || null
    };
}

const networkFetch = globalThis.fetch.bind(globalThis);
const ioStats = { packRequests: 0, packBytes: 0, manifestReads: 0, osrmRequests: 0 };
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.fflate = require('fflate');
globalThis.Worker = undefined;
globalThis.DebugLogger = { log() {} };
globalThis.NrelSpaCore = require(path.join(ROOT, 'node_modules', 'nrel-spa', 'lib', 'spa.cjs'));
globalThis.SolarPhysics = require(path.join(ROOT, 'js', 'solar-physics.js'));
globalThis.SunCalc = require(path.join(ROOT, 'js', 'suncalc.js'));
globalThis.SceneShadow = require(path.join(ROOT, 'js', 'scene-shadow.js'));
require(path.join(ROOT, 'js', 'shadow-router.js'));

function fileResponse(file, contentType) {
    const body = fs.readFileSync(file);
    return new Response(body, {
        status: 200,
        headers: { 'content-type': contentType, 'content-length': String(body.length) }
    });
}

globalThis.fetch = async function simulationFetch(input, init = {}) {
    const url = String(input && input.url || input);
    const localManifestMatch = /^local:\/\/scene-manifest\/([a-z-]+)$/.exec(url);
    if (localManifestMatch) {
        const tag = regionTags[localManifestMatch[1]];
        ioStats.manifestReads++;
        return fileResponse(path.join(releaseDirs[tag], 'manifest.json'), 'application/json');
    }
    const assetMatch = /\/releases\/download\/(scene-us-[^/]+)\/([^?#]+)/.exec(url);
    if (assetMatch && releaseDirs[assetMatch[1]]) {
        const file = path.join(releaseDirs[assetMatch[1]], decodeURIComponent(assetMatch[2]));
        if (!fs.existsSync(file)) return new Response('missing local asset', { status: 404 });
        const size = fs.statSync(file).size;
        ioStats.packRequests++;
        ioStats.packBytes += size;
        return fileResponse(file, 'application/zip');
    }
    if (url.includes('router.project-osrm.org')) ioStats.osrmRequests++;
    return networkFetch(input, init);
};

const scenarios = [
    { id: 'NE-S', region: 'northeast', distanceClass: 'short', name: 'Boston Back Bay → Brookline', start: [42.3493, -71.0826], end: [42.3318, -71.1212], summerOffset: -4, winterOffset: -5 },
    { id: 'NE-M', region: 'northeast', distanceClass: 'medium', name: 'Boston → Salem', start: [42.3601, -71.0589], end: [42.5195, -70.8967], summerOffset: -4, winterOffset: -5 },
    { id: 'NE-L', region: 'northeast', distanceClass: 'long', name: 'Boston → Providence', start: [42.3601, -71.0589], end: [41.8240, -71.4128], summerOffset: -4, winterOffset: -5 },
    { id: 'MW-S', region: 'midwest', distanceClass: 'short', name: 'Chicago Loop → Hyde Park', start: [41.8837, -87.6325], end: [41.7943, -87.5907], summerOffset: -5, winterOffset: -6 },
    { id: 'MW-M', region: 'midwest', distanceClass: 'medium', name: 'Chicago → Aurora', start: [41.8781, -87.6298], end: [41.7606, -88.3201], summerOffset: -5, winterOffset: -6 },
    { id: 'MW-L', region: 'midwest', distanceClass: 'long', name: 'Chicago → Milwaukee', start: [41.8781, -87.6298], end: [43.0389, -87.9065], summerOffset: -5, winterOffset: -6 },
    { id: 'SO-S', region: 'south', distanceClass: 'short', name: 'Atlanta → Decatur', start: [33.7490, -84.3880], end: [33.7748, -84.2963], summerOffset: -4, winterOffset: -5 },
    { id: 'SO-M', region: 'south', distanceClass: 'medium', name: 'Dallas → Fort Worth', start: [32.7767, -96.7970], end: [32.7555, -97.3308], summerOffset: -5, winterOffset: -6 },
    { id: 'SO-L', region: 'south', distanceClass: 'long', name: 'Atlanta → Macon', start: [33.7490, -84.3880], end: [32.8407, -83.6324], summerOffset: -4, winterOffset: -5 },
    { id: 'WE-S', region: 'west', distanceClass: 'short', name: 'Los Angeles → Santa Monica', start: [34.0522, -118.2437], end: [34.0195, -118.4912], summerOffset: -7, winterOffset: -8 },
    { id: 'WE-M', region: 'west', distanceClass: 'medium', name: 'Seattle → Tacoma', start: [47.6062, -122.3321], end: [47.2529, -122.4443], summerOffset: -7, winterOffset: -8 },
    { id: 'WE-L', region: 'west', distanceClass: 'long', name: 'San Francisco → Sacramento', start: [37.7749, -122.4194], end: [38.5816, -121.4944], summerOffset: -7, winterOffset: -8 }
];
const timeCases = [
    { id: 'summer-0800', season: 'summer', label: 'Summer 08:00', date: [2026, 6, 21, 8] },
    { id: 'summer-1300', season: 'summer', label: 'Summer 13:00', date: [2026, 6, 21, 13] },
    { id: 'summer-1800', season: 'summer', label: 'Summer 18:00', date: [2026, 6, 21, 18] },
    { id: 'winter-1300', season: 'winter', label: 'Winter 13:00', date: [2026, 12, 21, 13] }
];

function localDateToUtc(timeCase, scenario) {
    const [year, month, day, hour] = timeCase.date;
    const offset = timeCase.season === 'summer' ? scenario.summerOffset : scenario.winterOffset;
    return new Date(Date.UTC(year, month - 1, day, hour - offset));
}

function loadRouteCache() {
    if (!fs.existsSync(ROUTE_CACHE_FILE)) return { schema: 1, generatedAt: null, routes: {} };
    return JSON.parse(fs.readFileSync(ROUTE_CACHE_FILE, 'utf8'));
}

async function getCandidates(scenario, cache) {
    const candidateStrategy = 'app-direct-plus-via-v1';
    if (cache.routeStrategies && cache.routeStrategies[scenario.id] === candidateStrategy &&
        Array.isArray(cache.routes[scenario.id]) && cache.routes[scenario.id].length) {
        return cache.routes[scenario.id];
    }
    const [startLat, startLng] = scenario.start;
    const [endLat, endLng] = scenario.end;
    // Use the production router itself so the study includes the same direct
    // alternatives, two bounded lateral via requests, geometry de-duplication
    // and 60% duration ceiling as the Android app. A local 02:00 departure
    // keeps this candidate-only pass astronomical-night, so it does not fetch
    // scene packs before the four declared study times are evaluated.
    const localNight = new Date(Date.UTC(2026, 0, 15, 7));
    const result = await globalThis.ShadowRouter.fetchAndAnalyzeRoutes(
        { lat: startLat, lng: startLng },
        { lat: endLat, lng: endLng },
        localNight,
        false,
        {
            viaRequestBudget: 2,
            directTimeoutMs: 15000,
            viaTimeoutMs: 15000,
            disableLiveSceneFallback: true
        }
    );
    const candidates = Array.isArray(result && result.routeCandidates) ? result.routeCandidates : [];
    if (!candidates.length) throw new Error(`No app-equivalent route candidates for ${scenario.id}`);
    cache.schema = 2;
    cache.candidateStrategy = candidateStrategy;
    cache.routeStrategies ||= {};
    cache.routeStrategies[scenario.id] = candidateStrategy;
    cache.routes[scenario.id] = candidates;
    cache.generatedAt = new Date().toISOString();
    fs.writeFileSync(ROUTE_CACHE_FILE, JSON.stringify(cache, null, 2));
    await new Promise(resolve => setTimeout(resolve, 500));
    return candidates;
}

function analysisFor(route) {
    return route && route.analyzed || {};
}

function pct(value) {
    return Number.isFinite(value) ? value : 0;
}

function coolingSensitivity(avoidedWhM2) {
    const avoided = Math.max(0, Number(avoidedWhM2) || 0);
    // Sensitivity assumptions, not measured vehicle performance:
    // effective solar-coupled area 1.5–3.0 m², coupling 0.35–0.65, COP 2.0–3.5.
    return {
        minWh: avoided * 1.5 * 0.35 / 3.5,
        centralWh: avoided * 2.0 * 0.50 / 2.5,
        maxWh: avoided * 3.0 * 0.65 / 2.0
    };
}

function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function mean(values) {
    const finite = values.map(Number).filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function fixed(value, digits = 1) {
    return Number(value || 0).toFixed(digits);
}

function groupBy(rows, key) {
    const groups = new Map();
    for (const row of rows) {
        const value = row[key];
        if (!groups.has(value)) groups.set(value, []);
        groups.get(value).push(row);
    }
    return groups;
}

function svgBarChart(file, title, groups, valueKey, suffix, maxOverride = null) {
    const width = 900;
    const barHeight = 42;
    const height = 95 + groups.length * 66;
    const max = maxOverride || Math.max(1, ...groups.map(group => group.value));
    const bars = groups.map((group, index) => {
        const y = 72 + index * 66;
        const w = Math.max(0, Math.min(650, group.value / max * 650));
        return `<text x="20" y="${y + 25}" font-size="17" fill="#dce7ff">${group.label}</text>` +
            `<rect x="185" y="${y}" width="650" height="34" rx="7" fill="#17223a"/>` +
            `<rect x="185" y="${y}" width="${w.toFixed(1)}" height="34" rx="7" fill="#29b6f6"/>` +
            `<text x="${Math.min(842, 195 + w)}" y="${y + 24}" font-size="15" fill="#ffffff">${fixed(group.value, 1)}${suffix}</text>`;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `<rect width="100%" height="100%" fill="#0b1220"/><text x="20" y="38" font-size="23" font-family="system-ui" fill="#ffffff">${title}</text>` +
        `<g font-family="system-ui">${bars}</g></svg>`;
    fs.writeFileSync(file, svg);
}

function buildReport(rows, metadata) {
    const validScene = rows.filter(row => ['scene', 'hybrid-scene'].includes(row.analysisMode));
    const scenarioCandidates = new Map();
    for (const row of rows) scenarioCandidates.set(row.scenarioId, Number(row.osrmCandidateCount) || 0);
    const singleCandidatePairs = [...scenarioCandidates.values()].filter(count => count === 1).length;
    const candidateCounts = [...scenarioCandidates.values()];
    const releaseEntries = Object.entries(metadata.sceneReleases || {});
    const v3ReleaseCount = releaseEntries.filter(([, info]) => Number(info && info.schema) >= 3).length;
    const releaseSummary = releaseEntries.map(([region, info]) =>
        `${region}: ${info.releaseTag} (schema ${info.schema || 'unknown'})`).join(', ');
    const distanceGroups = [...groupBy(validScene, 'distanceClass')].map(([key, values]) => ({
        label: key, value: mean(values.map(row => row.bestAvailableReductionPct))
    }));
    const timeGroups = [...groupBy(validScene, 'timeCase')].map(([key, values]) => ({
        label: key, value: mean(values.map(row => row.bestAvailableReductionPct))
    }));
    const regionGroups = [...groupBy(validScene, 'region')].map(([key, values]) => ({
        label: key, value: mean(values.map(row => row.shadeConfirmedPct))
    }));
    const energyGroups = [...groupBy(validScene, 'timeCase')].map(([key, values]) => ({
        label: key, value: mean(values.map(row => row.fastestDirectWhM2))
    }));
    svgBarChart(path.join(IMAGE_DIR, 'solar-reduction-by-distance.svg'), 'Post-hoc best available direct-solar reduction by route class', distanceGroups, 'value', '%', 20);
    svgBarChart(path.join(IMAGE_DIR, 'solar-reduction-by-time.svg'), 'Post-hoc best available direct-solar reduction by local departure time', timeGroups, 'value', '%', 20);
    svgBarChart(path.join(IMAGE_DIR, 'confirmed-shade-by-region.svg'), 'Mean modeled shade share on selected shade route', regionGroups, 'value', '%', 50);
    svgBarChart(path.join(IMAGE_DIR, 'direct-energy-by-time.svg'), 'Mean fastest-route clear-sky direct energy by departure time', energyGroups, 'value', ' Wh/m²');

    const aggregate = {
        total: rows.length,
        precision: validScene.length,
        meanReduction: mean(validScene.map(row => row.directSolarReductionPct)),
        meanBestAvailableReduction: mean(validScene.map(row => row.bestAvailableReductionPct)),
        medianReduction: [...validScene].map(row => row.directSolarReductionPct).sort((a, b) => a - b)[Math.floor(validScene.length / 2)] || 0,
        positive: validScene.filter(row => row.directSolarReductionPct > 0).length,
        meanShade: mean(validScene.map(row => row.shadeConfirmedPct)),
        meanUncertain: mean(validScene.map(row => row.shadeUncertainPct)),
        totalAvoidedWhM2: validScene.reduce((sum, row) => sum + row.avoidedIncidentWhM2, 0),
        totalCoolingCentralWh: validScene.reduce((sum, row) => sum + row.coolingCentralWh, 0)
    };
    const tableRows = rows.map(row => `| ${row.scenarioId} | ${row.timeCase} | ${fixed(row.distanceKm)} | ${row.analysisMode} | ${fixed(row.fastestDirectWhM2)} | ${fixed(row.shadeDirectWhM2)} | ${fixed(row.directSolarReductionPct)}% | ${fixed(row.bestAvailableReductionPct)}% | ${fixed(row.shadeConfirmedPct)}% | ${fixed(row.shadeUncertainPct)}% | ${fixed(row.detourMinutes)} | ${fixed(row.bestCoolingMinWh)}–${fixed(row.bestCoolingMaxWh)} Wh |`).join('\n');
    return `# U.S. clear-sky shade-aware route simulation\n\n` +
`Generated: ${metadata.generatedAt}\n\n` +
`## 초록\n\n` +
`미국 4개 장면 데이터 권역에서 단·중·장거리 12개 출발지–목적지 조합을 선정하고, 각 경로를 2026년 하지의 08:00·13:00·18:00 및 동지의 13:00 현지시각에 분석하여 총 ${rows.length}개 사례를 만들었다. 후보는 앱과 같은 라우터 흐름(직접 OSRM 대안, 필요할 때 최대 2개의 측면 경유점 요청, 형상 중복 제거, 최단시간 대비 60% 초과 후보 제외)으로 수집하고 네 시각에 재사용했다. 구간별 태양 위치는 NREL SPA, 맑은하늘 광대역 일사는 Bird 모델, 건물·터널·지형 차광은 사전계산 OSM/SRTM 장면으로 계산했다. 제품의 우회·최소개선 정책을 적용한 그늘 경로의 빠른 경로 대비 총 직접 일사 감소율은 평균 **${fixed(aggregate.meanReduction)}%**였다. 제한된 후보를 사후적으로 모두 비교한 최대 가능 감소율은 평균 **${fixed(aggregate.meanBestAvailableReduction)}%**였고, 전체 주행시간 중 장면이 확정한 평균 차광시간 비율은 **${fixed(aggregate.meanShade)}%**, 전체 경로 중 차광 판정 불확실 시간은 평균 **${fixed(aggregate.meanUncertain)}%**였다. ${scenarios.length}개 OD 중 앱 흐름을 거친 뒤에도 후보가 하나뿐인 OD는 ${singleCandidatePairs}개였다. 0% 감소는 계산 실패를 뜻하지 않으며, 최단 경로가 최선이거나 대안이 제품의 우회·최소개선 기준을 통과하지 못할 때 발생한다. 실제 UV 선량, 실내온도, 연료·배터리 절감 또는 의학적 효과는 추정하지 않았다.\n\n` +
`## Abstract\n\n` +
`This reproducible simulation evaluated ${scenarios.length} U.S. origin–destination pairs (short, medium and long routes in four release regions) at four local departure times, yielding ${rows.length} route-time cases. Candidate collection used the production app's direct-plus-via OSRM flow and reused the resulting geometry across times. NREL SPA determined segment solar position; the Bird clear-sky model estimated broadband irradiance; precomputed OpenStreetMap/SRTM scenes tested building, tunnel and terrain occlusion. Under the product's detour/improvement policy, the selected shade route reduced modeled direct-solar energy by a mean of **${fixed(aggregate.meanReduction)}%**. A separate post-hoc best-available analysis found **${fixed(aggregate.meanBestAvailableReduction)}%** mean potential among the limited returned candidates; it is not a navigation recommendation. Mean confirmed shade time over total driving time was **${fixed(aggregate.meanShade)}%**, while mean uncertain-occlusion time over the whole route was **${fixed(aggregate.meanUncertain)}%**. These are clear-sky model estimates, not measured UV dose, cabin temperature, fuel economy or medical protection.\n\n` +
`## Methods\n\n` +
`### Route and time design\n\nTwelve fixed routes covered Northeast, Midwest, South and West releases, with one short, medium and long trip per region. Departures were 08:00, 13:00 and 18:00 local time on 21 June 2026 and 13:00 local time on 21 December 2026. Candidate collection calls the production router: it first requests direct OSRM alternatives, and when fewer than three geometrically distinct direct routes exist, it makes at most two bounded lateral via-point requests. The production geometry de-duplication and 1.60× fastest-duration ceiling are retained. The resulting ${candidateCounts.length ? `${Math.min(...candidateCounts)}–${Math.max(...candidateCounts)}` : '0'} candidates per OD are cached in [us-route-candidates.json](data/us-route-candidates.json) and reused at all four times. This is app-equivalent candidate generation, but public OSRM still does not enumerate every drivable route.\n\n` +
`### Solar and occlusion model\n\nFor segment \(i\), NREL SPA computes solar zenith and azimuth at its predicted pass time. The Bird clear-sky model supplies direct-normal irradiance \(DNI_i\). Scene occlusion \(O_i\) equals one when the 2.5D model identifies a building, terrain horizon or tunnel obstruction and zero otherwise. Direct horizontal energy is integrated over travel time:\n\n` +
`$$H_{dir}=\\sum_i DNI_i\\max(0,\\cos z_i)(1-O_i)\\frac{\\Delta t_i}{3600}\\quad[Wh/m^2]$$\n\n` +
`The same-tier fastest route is the baseline. Reduction is \(100(1-H_{shade}/H_{fastest})\). Bird inputs use a declared standard clear-sky atmosphere (ozone 0.30 cm, precipitable water 1.5 cm, AOD 0.10/0.08, albedo 0.20), not actual clouds, smoke or local weather.\n\n` +
`### Scene uncertainty\n\nRelease inputs used in this run: ${releaseSummary || 'not recorded'}. Schema-v3 scenes preserve building-height provenance and sensitivity envelopes and apply a ±10 m terrain relative-vertical-error test at the stated 90% level. A building or terrain obstruction receives shade credit only when it remains blocking under the conservative bound. A marginal result is marked \`uncertain\`; its occlusion ratio is null and the energy integral above uses \(O_i=0\), so uncertainty never creates an artificial solar-reduction benefit. ${v3ReleaseCount ? `${v3ReleaseCount} of ${releaseEntries.length} releases in this run used schema v3.` : 'This recorded run used legacy releases without explicit v3 uncertainty metadata; rerun with validated v3 directories to evaluate that policy.'} Building envelopes are sensitivity bounds, not statistical confidence intervals.\n\n` +
`### GPS and ETA scope\n\nThe simulation assigns segment pass times from OSRM step durations scaled to the route duration. It does not replay phone GPS fixes, traffic, rerouting latency or Android lifecycle interruptions. In the app, the W3C Geolocation \`accuracy\` value is treated separately as a 95% horizontal-position radius and propagated only as a GPS-position contribution to ETA; it is not a confidence interval for traffic or the OSRM travel-time estimate.\n\n` +
`### UV interpretation\n\nThe study does **not** report UV Index or erythemal UV dose. Those require spectral irradiance, action-spectrum weighting, clouds/aerosols and occupant exposure geometry. The reported direct-solar reduction can only be interpreted as a broadband direct-beam occlusion proxy; diffuse UV remains even in shade.\n\n` +
`### Cooling-energy sensitivity\n\nAvoided incident direct energy was converted only to a sensitivity range, not a vehicle claim: effective coupled area 1.5–3.0 m², solar coupling 0.35–0.65 and cooling COP 2.0–3.5. Thus \\(E_{cool}=H_{avoided}A\\eta/COP\\). Vehicle glazing, body absorptance, ventilation, ambient temperature, HVAC control and occupancy were not simulated, so cabin-temperature reduction cannot be inferred.\n\n` +
`### Runtime and data transfer\n\nThe complete ${rows.length}-case run took **${fixed(metadata.durationSeconds)} s** (${fixed(metadata.durationSeconds / rows.length, 2)} s/case) on the development PC while reading validated release assets from local disk. The Node harness has no Android IndexedDB, and therefore read **${fixed(metadata.ioStats.packBytes / 1048576)} MiB** across all repeated time cases. This is a stress measurement of the analysis/data path, not a phone-network benchmark; Android persistent tile cache can avoid later network transfers, while a first long trip can still require tens of MiB.\n\n` +
`## Results\n\n` +
`![Reduction by distance](images/solar-reduction-by-distance.svg)\n\n` +
`![Reduction by departure time](images/solar-reduction-by-time.svg)\n\n` +
`![Shade by region](images/confirmed-shade-by-region.svg)\n\n` +
`![Direct energy by departure time](images/direct-energy-by-time.svg)\n\n` +
`| Case | Local departure | km | tier | fastest direct | selected shade direct | selected reduction | post-hoc best | confirmed shade | uncertain occlusion | selected detour min | post-hoc cooling range |\n|:--|:--|--:|:--|--:|--:|--:|--:|--:|--:|--:|--:|\n${tableRows}\n\n` +
`Direct-energy columns are Wh/m². “Post-hoc best” selects the lowest-energy same-tier OSRM candidate within a 35% duration bound after seeing all outcomes; it is diagnostic and not a navigation recommendation. Cooling-equivalent values are Wh per trip for that post-hoc opportunity under the sensitivity assumptions above. Zero selected reduction commonly means the fastest route was also the best admissible route or no alternative passed the product gates.\n\n` +
`## Limitations\n\n` +
`- This is a deterministic model study, not a randomized field trial.\n- OSM buildings can be missing and inferred heights are uncertain; SRTM and 5 km scene preprocessing have finite resolution.\n- Trees, temporary structures, bridge decks, clouds, road-side lane position and vehicle-body self-shading are incomplete or absent.\n- Public OSRM direct and via requests do not enumerate every drivable route.\n- GPS error, traffic and live ETA prediction error are outside this simulation.\n- The cooling sensitivity is not an estimate of actual battery/fuel savings for a specific vehicle.\n- Results do not establish medical benefit or safe UV exposure.\n\n` +
`## Reproduction\n\n\`npm run simulate:us\` uses the four validated local release directories and reads each release tag/schema from its manifest. Override them with \`SCENE_NE_DIR\`, \`SCENE_MW_DIR\`, \`SCENE_SOUTH_DIR\` and \`SCENE_WEST_DIR\`. The first run may call public OSRM for the app-equivalent direct-plus-via candidate set; subsequent runs reuse the candidate cache. Machine-readable results are in [CSV](data/us-solar-route-simulation.csv) and [JSON](data/us-solar-route-simulation.json).\n\n` +
`## References\n\n` +
`1. Reda I, Andreas A. [Solar Position Algorithm for Solar Radiation Applications](https://doi.org/10.2172/15003974). NREL/TP-560-34302.\n2. Bird RE, Hulstrom RL. [A Simplified Clear Sky Model for Direct and Diffuse Insolation on Horizontal Surfaces](https://doi.org/10.2172/6510849). SERI/TR-642-761.\n3. CIE. [CIE 146:2002 Collection on Glare](https://www.cie.co.at/publications/cie-collection-glare-2002).\n4. WHO. [Global Solar UV Index: A Practical Guide](https://www.who.int/publications/i/item/9241590076).\n5. NASA LP DAAC. [NASADEM User Guide](https://lpdaac.usgs.gov/documents/592/NASADEM_User_Guide_V1.pdf).\n6. Usui H. [Building storey-height estimation](https://doi.org/10.1177/23998083221116117).\n7. Bocher E et al. [GeoClimate: missing building-height estimation](https://doi.org/10.5194/gmd-15-7505-2022).\n8. OpenStreetMap Wiki. [Key:building:levels](https://wiki.openstreetmap.org/wiki/Key:building:levels).\n9. W3C. [Geolocation API: accuracy is a 95% confidence level](https://www.w3.org/TR/geolocation/).\n10. OpenStreetMap contributors. [Copyright and ODbL](https://www.openstreetmap.org/copyright).\n11. Project OSRM. [Open Source Routing Machine](https://project-osrm.org/).\n12. Fayazbakhsh MA, Bahrami M. [Comprehensive Modeling of Vehicle Air Conditioning Loads Using Heat Balance Method](https://doi.org/10.4271/2011-01-0127). SAE 2011-01-0127.\n13. Rugh JP et al. [Vehicle Ancillary Load Reduction Project Close-Out Report](https://www.nrel.gov/docs/fy07osti/40986.pdf). NREL.\n`;
}

const routeCache = loadRouteCache();
if (String(process.env.SIMULATION_CANDIDATES_ONLY || '').toLowerCase() === 'true') {
    const summary = [];
    for (const scenario of scenarios) {
        const candidates = await getCandidates(scenario, routeCache);
        summary.push({ scenarioId: scenario.id, candidates: candidates.length });
        console.log(`[simulation] candidates ${scenario.id}: ${candidates.length}`);
    }
    console.log(JSON.stringify({
        candidateStrategy: routeCache.candidateStrategy,
        scenarios: summary,
        totalCandidates: summary.reduce((sum, item) => sum + item.candidates, 0)
    }, null, 2));
    process.exit(0);
}
const rows = [];
const startedAt = Date.now();
for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const candidates = await getCandidates(scenario, routeCache);
    for (const timeCase of timeCases) {
        const dateObj = localDateToUtc(timeCase, scenario);
        const ioBefore = { ...ioStats };
        const result = await globalThis.ShadowRouter.fetchAndAnalyzeRoutes(
            { lat: scenario.start[0], lng: scenario.start[1] },
            { lat: scenario.end[0], lng: scenario.end[1] },
            dateObj,
            false,
            {
                candidates,
                preferredRouteRole: 'shade',
                precomputedManifestUrl: `local://scene-manifest/${scenario.region}`,
                precomputedRegion: scenario.region,
                disableLiveSceneFallback: true,
                sceneConcurrency: 1,
                scenePackConcurrency: 1,
                precomputedPackTimeoutMs: 60000,
                precomputedManifestTimeoutMs: 15000
            }
        );
        const fastest = result.routes.fastest;
        const shade = result.routes.shade;
        const fastestAnalysis = analysisFor(fastest);
        const shadeAnalysis = analysisFor(shade);
        const fastestEnergy = Number(fastestAnalysis.directSolarEnergyWhM2) || 0;
        const shadeEnergy = Number(shadeAnalysis.directSolarEnergyWhM2) || 0;
        const avoided = Math.max(0, fastestEnergy - shadeEnergy);
        const cooling = coolingSensitivity(avoided);
        const fastestMode = fastestAnalysis.analysisMode;
        const comparable = (result.routes.all || []).map(route => ({
            route,
            analysis: route.id === fastest.id ? fastestAnalysis : route.sceneAnalysis
        })).filter(item => item.analysis && item.analysis.analysisMode === fastestMode &&
            Number(item.route.durationSec) <= Number(fastest.durationSec) * 1.35);
        const bestAvailable = comparable.sort((a, b) =>
            Number(a.analysis.directSolarEnergyWhM2 || Infinity) -
            Number(b.analysis.directSolarEnergyWhM2 || Infinity))[0] ||
            { route: fastest, analysis: fastestAnalysis };
        const bestEnergy = Number(bestAvailable.analysis.directSolarEnergyWhM2) || fastestEnergy;
        const bestAvoided = Math.max(0, fastestEnergy - bestEnergy);
        const bestCooling = coolingSensitivity(bestAvoided);
        const row = {
            scenarioId: scenario.id,
            scenario: scenario.name,
            region: scenario.region,
            distanceClass: scenario.distanceClass,
            osrmCandidateCount: candidates.length,
            timeCase: timeCase.label,
            departureUtc: dateObj.toISOString(),
            analysisMode: shade.analysisMode || result.roleAnalysis.shade.analysisMode,
            fastestRouteId: fastest.id,
            shadeRouteId: shade.id,
            sameRoute: fastest.id === shade.id,
            distanceKm: (Number(shade.distanceMeters) || 0) / 1000,
            fastestMinutes: (Number(fastest.durationSec) || 0) / 60,
            shadeMinutes: (Number(shade.durationSec) || 0) / 60,
            detourMinutes: Math.max(0, (Number(shade.durationSec) - Number(fastest.durationSec)) / 60),
            fastestDirectWhM2: fastestEnergy,
            shadeDirectWhM2: shadeEnergy,
            avoidedIncidentWhM2: avoided,
            directSolarReductionPct: fastestEnergy > 0 ? 100 * avoided / fastestEnergy : 0,
            bestAvailableRouteId: bestAvailable.route.id,
            bestAvailableDirectWhM2: bestEnergy,
            bestAvailableReductionPct: fastestEnergy > 0 ? 100 * bestAvoided / fastestEnergy : 0,
            shadeConfirmedPct: 100 * pct(shadeAnalysis.confirmedShadeTimeRatio),
            shadeUncertainPct: 100 * pct(shadeAnalysis.uncertainOcclusionTimeRatio),
            sunlitTimePct: 100 * pct(shadeAnalysis.sunlitTimeRatio),
            sceneCoveragePct: 100 * pct(shadeAnalysis.sceneCoverage && shadeAnalysis.sceneCoverage.segmentRatio),
            coolingMinWh: cooling.minWh,
            coolingCentralWh: cooling.centralWh,
            coolingMaxWh: cooling.maxWh,
            bestCoolingMinWh: bestCooling.minWh,
            bestCoolingCentralWh: bestCooling.centralWh,
            bestCoolingMaxWh: bestCooling.maxWh,
            packRequests: ioStats.packRequests - ioBefore.packRequests,
            packBytes: ioStats.packBytes - ioBefore.packBytes
        };
        rows.push(row);
        console.log(`[${scenarioIndex + 1}/${scenarios.length}] ${scenario.id} ${timeCase.label}: ${row.analysisMode}, ${fixed(row.directSolarReductionPct)}% direct reduction, ${fixed(row.shadeConfirmedPct)}% shade`);
    }
}

const metadata = {
    schema: 2,
    generatedAt: new Date().toISOString(),
    gitCommit: (() => {
        try { return require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); }
        catch { return null; }
    })(),
    workingTreeDirty: (() => {
        try { require('node:child_process').execFileSync('git', ['diff', '--quiet'], { cwd: ROOT }); return false; }
        catch { return true; }
    })(),
    durationSeconds: (Date.now() - startedAt) / 1000,
    solarModel: globalThis.SolarPhysics.MODEL_METADATA,
    sceneReleaseTags: regionTags,
    sceneReleases: sceneReleaseInfo,
    candidateStrategy: 'app-direct-plus-via-v1',
    gpsEtaScope: 'OSRM step timing only; phone GPS/traffic uncertainty not simulated',
    ioStats,
    coolingSensitivity: { effectiveAreaM2: [1.5, 3.0], coupling: [0.35, 0.65], cop: [2.0, 3.5] },
    uvDoseEstimated: false,
    cabinTemperatureEstimated: false
};
fs.writeFileSync(RESULT_JSON_FILE, JSON.stringify({ metadata, rows }, null, 2));
const columns = Object.keys(rows[0]);
fs.writeFileSync(RESULT_CSV_FILE, [columns.join(','), ...rows.map(row => columns.map(column => csvEscape(row[column])).join(','))].join('\n') + '\n');
fs.writeFileSync(REPORT_FILE, buildReport(rows, metadata));
console.log(`Completed ${rows.length} route-time cases in ${fixed(metadata.durationSeconds)} s.`);
console.log(`Report: ${REPORT_FILE}`);
