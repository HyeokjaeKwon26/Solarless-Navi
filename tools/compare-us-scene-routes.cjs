#!/usr/bin/env node
// Run the same archived OSRM candidates and production routing model against
// either the old or refreshed regional scene packs. Run once for each version:
// node tools/compare-us-scene-routes.cjs <old|new> <working-dir> <result.json>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const codeRoot = process.env.SCENE_COMPARISON_CODE_ROOT ? path.resolve(process.env.SCENE_COMPARISON_CODE_ROOT) : root;
const [version, workspaceArg, outputArg] = process.argv.slice(2);
if (!['old', 'new'].includes(version) || !workspaceArg || !outputArg) throw new Error('Expected old|new, working directory, output path');
const workspace = path.resolve(workspaceArg), output = path.resolve(outputArg);
const allRegions = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
const requestedRegion = process.env.SCENE_COMPARISON_REGION || null;
const multipolygonComparison = process.env.SCENE_COMPARISON_MULTIPOLYGON === 'true';
const recheckComparison = process.env.SCENE_COMPARISON_RECHECK === 'true';
if (recheckComparison && !multipolygonComparison) throw new Error('Recheck comparison requires multipolygon mode');
if (requestedRegion && !allRegions.includes(requestedRegion)) throw new Error('Invalid comparison region');
const regionIds = requestedRegion ? [requestedRegion] : allRegions;
const manifests = {}, directories = {}, tags = {};
for (const id of regionIds) {
    const directory = recheckComparison
        ? (version === 'old' ? path.join(workspace, `multipolygon-${id}`, 'release') : path.join(workspace, `multipolygon-recheck-${id}`, 'release'))
        : multipolygonComparison
        ? (version === 'old' ? path.join(workspace, `build-${id}`, 'release') : path.join(workspace, `multipolygon-${id}`, 'release'))
        : (version === 'old' ? path.join(workspace, id) : path.join(workspace, `build-${id}`, 'release'));
    const manifestPath = multipolygonComparison || version === 'new' ? path.join(directory, 'manifest.json')
        : path.join(root, 'data', 'scene', id, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    manifests[id] = manifestPath; directories[manifest.releaseTag] = directory; tags[id] = manifest.releaseTag;
    if (recheckComparison) {
        const originalDir = path.join(workspace, `build-${id}`, 'release');
        const original = JSON.parse(fs.readFileSync(path.join(originalDir, 'manifest.json')));
        directories[original.releaseTag] = originalDir;
        const priorDir = path.join(workspace, `multipolygon-${id}`, 'release');
        const prior = JSON.parse(fs.readFileSync(path.join(priorDir, 'manifest.json')));
        directories[prior.releaseTag] = priorDir;
    } else if (multipolygonComparison && version === 'new') {
        const previousDir = path.join(workspace, `build-${id}`, 'release');
        const previous = JSON.parse(fs.readFileSync(path.join(previousDir, 'manifest.json')));
        directories[previous.releaseTag] = previousDir;
    }
}

globalThis.window = globalThis;
globalThis.self = globalThis;
const runtimeRoot = process.env.SCENE_COMPARISON_RUNTIME_ROOT ? path.resolve(process.env.SCENE_COMPARISON_RUNTIME_ROOT) : null;
const fflatePath = runtimeRoot ? path.join(runtimeRoot, 'fflate.cjs') : require.resolve('fflate');
const spaPath = runtimeRoot ? path.join(runtimeRoot, 'spa.cjs') : path.join(root, 'node_modules', 'nrel-spa', 'lib', 'spa.cjs');
globalThis.fflate = require(fflatePath);
globalThis.Worker = undefined;
globalThis.DebugLogger = { log() {} };
globalThis.NrelSpaCore = require(spaPath);
globalThis.SolarPhysics = require(path.join(codeRoot, 'js', 'solar-physics.js'));
globalThis.SunCalc = require(path.join(codeRoot, 'js', 'suncalc.js'));
globalThis.SceneShadow = require(path.join(codeRoot, 'js', 'scene-shadow.js'));
require(path.join(codeRoot, 'js', 'shadow-router.js'));

globalThis.fetch = async input => {
    const url = String(input && input.url || input);
    const matchManifest = /^local:\/\/scene-manifest\/(us-[a-z-]+)$/.exec(url);
    if (matchManifest && manifests[matchManifest[1]]) {
        return new Response(fs.readFileSync(manifests[matchManifest[1]]), { headers: { 'content-type': 'application/json' } });
    }
    const matchAsset = /\/releases\/download\/(scene-us-[^/]+)\/([^?#]+)/.exec(url);
    if (matchAsset && directories[matchAsset[1]]) {
        const file = path.join(directories[matchAsset[1]], decodeURIComponent(matchAsset[2]));
        if (!fs.existsSync(file)) return new Response('missing pack', { status: 404 });
        return new Response(fs.readFileSync(file), { headers: { 'content-type': 'application/zip' } });
    }
    throw new Error(`Unexpected network access in offline comparison: ${url}`);
};

const scenarios = [
    ['NE-S', 'us-northeast', 'Boston Back Bay → Brookline', [42.3493, -71.0826], [42.3318, -71.1212], -4, -5],
    ['NE-M', 'us-northeast', 'Boston → Salem', [42.3601, -71.0589], [42.5195, -70.8967], -4, -5],
    ['NE-L', 'us-northeast', 'Boston → Providence', [42.3601, -71.0589], [41.8240, -71.4128], -4, -5],
    ['MW-S', 'us-midwest', 'Chicago Loop → Hyde Park', [41.8837, -87.6325], [41.7943, -87.5907], -5, -6],
    ['MW-M', 'us-midwest', 'Chicago → Aurora', [41.8781, -87.6298], [41.7606, -88.3201], -5, -6],
    ['MW-L', 'us-midwest', 'Chicago → Milwaukee', [41.8781, -87.6298], [43.0389, -87.9065], -5, -6],
    ['SO-S', 'us-south', 'Atlanta → Decatur', [33.7490, -84.3880], [33.7748, -84.2963], -4, -5],
    ['SO-M', 'us-south', 'Dallas → Fort Worth', [32.7767, -96.7970], [32.7555, -97.3308], -5, -6],
    ['SO-L', 'us-south', 'Atlanta → Macon', [33.7490, -84.3880], [32.8407, -83.6324], -4, -5],
    ['WE-S', 'us-west', 'Los Angeles → Santa Monica', [34.0522, -118.2437], [34.0195, -118.4912], -7, -8],
    ['WE-M', 'us-west', 'Seattle → Tacoma', [47.6062, -122.3321], [47.2529, -122.4443], -7, -8],
    ['WE-L', 'us-west', 'San Francisco → Sacramento', [37.7749, -122.4194], [38.5816, -121.4944], -7, -8]
];
const cases = [
    { name: 'summer-0800', date: [2026, 6, 21, 8], offset: 'summer' },
    { name: 'summer-1300', date: [2026, 6, 21, 13], offset: 'summer' },
    { name: 'summer-1800', date: [2026, 6, 21, 18], offset: 'summer' },
    { name: 'winter-1300', date: [2026, 12, 21, 13], offset: 'winter' }
];
const candidatePath = path.join(codeRoot, 'docs', 'data', 'us-route-candidates.json');
const cache = JSON.parse(fs.readFileSync(candidatePath));
const hashFile = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const codeHashes = Object.fromEntries(['scene-shadow.js', 'shadow-router.js', 'solar-physics.js', 'suncalc.js']
    .map(file => [file, hashFile(path.join(codeRoot, 'js', file))]));
const runtimeHashes = {
    spa: hashFile(spaPath),
    fflate: hashFile(fflatePath),
    node: process.version
};
if (cache.candidateStrategy !== 'app-direct-plus-via-v1') throw new Error('Unexpected archived candidate strategy');
const point = ([lat, lng]) => ({ lat, lng });
function summary(route) {
    const a = route && route.analyzed || {};
    return { id: route && route.id, durationSec: route && route.durationSec, analysisMode: a.analysisMode,
        confirmedShadeTimeRatio: a.confirmedShadeTimeRatio, uncertainOcclusionTimeRatio: a.uncertainOcclusionTimeRatio,
        sunlitTimeRatio: a.sunlitTimeRatio, directSolarEnergyWhM2: a.directSolarEnergyWhM2, sceneCoverage: a.sceneCoverage };
}

(async () => {
    const rows = [];
    const chosenScenarios = requestedRegion ? scenarios.filter(s => s[1] === requestedRegion) : scenarios;
    for (const [id, region, name, start, end, summerOffset, winterOffset] of chosenScenarios) {
        const candidates = cache.routes[id];
        if (!Array.isArray(candidates) || !candidates.length) throw new Error(`No archived candidates for ${id}`);
        for (const c of cases) {
            const [year, month, day, hour] = c.date;
            const offset = c.offset === 'summer' ? summerOffset : winterOffset;
            const date = new Date(Date.UTC(year, month - 1, day, hour - offset));
            const analysis = await ShadowRouter.fetchAndAnalyzeRoutes(point(start), point(end), date, false, {
                candidates, preferredRouteRole: 'shade', precomputedManifestUrl: `local://scene-manifest/${region}`,
                precomputedRegion: region, disableLiveSceneFallback: true, sceneConcurrency: 1,
                scenePackConcurrency: 1, precomputedPackTimeoutMs: 60000, precomputedManifestTimeoutMs: 15000
            });
            const fastest = summary(analysis.routes.fastest), shade = summary(analysis.routes.shade);
            if (!['scene', 'hybrid-scene'].includes(fastest.analysisMode) || !['scene', 'hybrid-scene'].includes(shade.analysisMode)) {
                throw new Error(`Scene unavailable: ${id} ${c.name} ${JSON.stringify({ fastest, shade })}`);
            }
            rows.push({ id, region, name, timeCase: c.name, departureUtc: date.toISOString(), candidateCount: candidates.length, fastest, shade });
            console.log(`${version} ${rows.length}/${chosenScenarios.length * cases.length} ${id} ${c.name}: ${fastest.analysisMode}, shade=${fastest.confirmedShadeTimeRatio}`);
        }
    }
    fs.writeFileSync(output, JSON.stringify({ version, generatedAt: new Date().toISOString(), tags, codeHashes, runtimeHashes,
        candidateFile: 'docs/data/us-route-candidates.json', candidateSha256: hashFile(candidatePath), rows }, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
