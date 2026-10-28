const test = require('node:test');
const assert = require('node:assert/strict');
const { footprintHash } = require('../tools/merge-scene-refresh.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { zipSync, strToU8 } = require('fflate');
const { terrainGridForKey } = require('../tools/scene-elevation.cjs');

test('US scene manifests identify the verified multipolygon refresh and fit GitHub release limits', () => {
    const expected = { 'us-northeast': [15445, 770, 686], 'us-midwest': [44083, 935, 613],
        'us-south': [48034, 1044, 999], 'us-west': [42227, 930, 725] };
    for (const [region, [tiles, packs, newPacks]] of Object.entries(expected)) {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../data/scene/${region}/manifest.json`)));
        assert.equal(manifest.schema, 3);
        assert.equal(manifest.releaseTag, `scene-${region}-hybrid-v3-osm-20261027-multipolygon`);
        assert.equal(manifest.osmExtractTimestamp, '2026-10-27T21:23:59Z');
        assert.match(manifest.osmPbfSha256, /^[a-f0-9]{64}$/);
        assert.equal(manifest.stats.tileCount, tiles);
        assert.equal(manifest.stats.packCount, packs);
        assert.equal(manifest.packaging.newlyPublishedPacks, newPacks);
        assert.equal(manifest.stats.releaseAssetCount, newPacks + 1);
        assert.ok(manifest.stats.releaseAssetCount <= 1000);
        assert.ok(manifest.sourceMetadata.multipolygon);
        assert.equal(manifest.uncertaintyModel.terrain.confidenceLevel, null);
    }
});

test('closed building footprints ignore their starting vertex and winding direction', () => {
    const a = [[40, -74], [40, -73], [41, -73], [41, -74], [40, -74]];
    const rotated = [[41, -73], [41, -74], [40, -74], [40, -73], [41, -73]];
    const reversed = [[40, -74], [41, -74], [41, -73], [40, -73], [40, -74]];
    assert.equal(footprintHash(a), footprintHash(rotated));
    assert.equal(footprintHash(a), footprintHash(reversed));
    assert.notEqual(footprintHash(a), footprintHash([[40, -74], [40, -73], [41.00001, -73], [41, -74], [40, -74]]));
});

test('an open footprint cannot match a closed footprint', () => {
    const open = [[40, -74], [40, -73], [41, -73], [41, -74]];
    assert.notEqual(footprintHash(open), footprintHash([...open, open[0]]));
    assert.equal(footprintHash(open), footprintHash([...open].reverse()));
    assert.throws(() => footprintHash([[40, -74], [40, -73]]));
});

test('canonical footprints retain equality for repeated vertices and every ring rotation', () => {
    const ring = [[0, 0], [1, 1], [0, 0], [2, 2], [1, 1], [3, 3]];
    const base = footprintHash([...ring, ring[0]]);
    for (let i = 0; i < ring.length; i++) {
        const rotated = ring.slice(i).concat(ring.slice(0, i));
        assert.equal(footprintHash([...rotated, rotated[0]]), base);
        const reversed = [...rotated].reverse();
        assert.equal(footprintHash([...reversed, reversed[0]]), base);
    }
});

test('deferred terrain sampling produces the established 51 by 51 grid', () => {
    const grid = { latOrigin: 38, lngOrigin: -81, cosLat: 0.7313537016191705 };
    const points = terrainGridForKey('0:0', grid, { sample: () => 42 });
    assert.equal(points.length, 2601);
    assert.deepEqual(points[0], [38, -81, 42]);
    assert.ok(points.at(-1)[0] > 38 && points.at(-1)[1] > -81);
    assert.equal(terrainGridForKey('0:0', grid, { sample: () => null }).length, 0);
    assert.throws(() => terrainGridForKey('bad', grid, { sample: () => 0 }));
});

test('intermediate deferred-terrain tiles cannot be packaged for release', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-deferred-test-'));
    try {
        const manifest = path.join(temp, 'manifest.json');
        fs.writeFileSync(manifest, JSON.stringify({ terrainDeferred: true }));
        const { pathToFileURL } = require('node:url');
        const packager = await import(pathToFileURL(path.resolve(__dirname, '../tools/package-scene-tiles.mjs')).href);
        assert.throws(() => packager.planScenePackages({ sourceManifest: manifest }), /must be merged/);
    } finally {
        assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('parallel size cache matches the packer ZIP estimates and source identity', async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-cache-test-'));
    try {
        const content = ['{"key":"0:0","buildings":[]}', '{"key":"1:0","buildings":[1,2,3]}'];
        const tiles = content.map((value, index) => {
            const file = `${index}_0.json`;
            fs.writeFileSync(path.join(temp, file), value);
            return { key: `${index}:0`, path: file, bytes: Buffer.byteLength(value) };
        });
        const manifest = { schema: 3, terrainDeferred: false, tiles };
        fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify(manifest));
        const cache = path.join(temp, 'cache.json');
        const run = spawnSync(process.execPath, [path.resolve(__dirname, '../tools/precompute-scene-size-cache.mjs'), temp, cache, '2'], { encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        const actual = JSON.parse(fs.readFileSync(cache));
        const { pathToFileURL } = require('node:url');
        const packager = await import(pathToFileURL(path.resolve(__dirname, '../tools/package-scene-tiles.mjs')).href);
        assert.equal(actual.identity, packager.planCacheIdentity(manifest, packager.normalizeSourceTiles(manifest)));
        for (const tile of tiles) {
            const data = fs.readFileSync(path.join(temp, tile.path));
            const expected = zipSync({ [tile.path]: [new Uint8Array(data), { mtime: new Date('1980-01-02T00:00:00.000Z') }] }, { level: 6 }).length - 22;
            assert.equal(actual.entries[tile.key], expected);
        }
    } finally {
        assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('parallel packaging produces the same manifest and ZIP bytes as standard packaging', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-parallel-pack-'));
    try {
        const input = path.join(temp, 'input'); fs.mkdirSync(input);
        const tiles = [0, 1, 12].map(index => {
            const file = `${index}_0.json`;
            const data = JSON.stringify({ key: `${index}:0`, buildings: [index], terrain: [1, 2] });
            fs.writeFileSync(path.join(input, file), data);
            return { key: `${index}:0`, path: file, bytes: Buffer.byteLength(data) };
        });
        fs.writeFileSync(path.join(input, 'manifest.json'), JSON.stringify({ schema: 3, schemaVersion: 3,
            region: 'Test', terrainDeferred: false, generatedAt: '2026-10-27T00:00:00Z', tiles }));
        const execute = (script, dir) => spawnSync(process.execPath, [path.resolve(__dirname, `../tools/${script}`)], {
            encoding: 'utf8', env: { ...process.env, SCENE_REGION: 'test', SCENE_REGION_LABEL: 'Test',
                SCENE_INPUT_DIR: input, SCENE_RELEASE_DIR: dir, SCENE_TRACKED_MANIFEST: path.join(temp, `${path.basename(dir)}.json`),
                SCENE_RELEASE_TAG: 'scene-test', SCENE_PLAN_CACHE: 'false', SCENE_PACK_WORKERS: '2' }
        });
        const a = path.join(temp, 'standard'), b = path.join(temp, 'parallel');
        const one = execute('package-scene-tiles.mjs', a), two = execute('package-scene-tiles-parallel.mjs', b);
        assert.equal(one.status, 0, one.stderr); assert.equal(two.status, 0, two.stderr);
        const x = JSON.parse(fs.readFileSync(path.join(a, 'manifest.json'))), y = JSON.parse(fs.readFileSync(path.join(b, 'manifest.json')));
        assert.deepEqual(y, x);
        for (const pack of Object.values(x.packs)) assert.deepEqual(fs.readFileSync(path.join(a, pack.path)), fs.readFileSync(path.join(b, pack.path)));
    } finally {
        assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('refresh matches buildings across tiles and retains old terrain without retaining removed objects', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-refresh-test-'));
    const oldDir = path.join(temp, 'old'), newDir = path.join(temp, 'new'), hgtDir = path.join(temp, 'hgt');
    const manifestDir = path.join(temp, 'data', 'scene', 'test');
    const script = path.resolve(__dirname, '../tools/merge-scene-refresh.cjs');
    fs.mkdirSync(oldDir, { recursive: true }); fs.mkdirSync(newDir, { recursive: true }); fs.mkdirSync(hgtDir, { recursive: true });
    fs.mkdirSync(manifestDir, { recursive: true });
    const ring = [[40, -74], [40, -73], [41, -73], [40, -74]];
    const tile = (key, buildings, tunnels, terrain) => ({ key, buildings, tunnels, terrain, profileResolution: {},
        grid: { latOrigin: 38, lngOrigin: -81, cosLat: 0.7313537016191705 },
        source: {}, sceneCoverage: { buildings: true, tunnels: true, terrain: true, buildingGround: true },
        uncertaintyModel: { terrainConfidenceLevel: 0.9 } });
    const first = tile('0:0', [{ id: 'way/1', polygon: ring, ground: 100 },
        { id: 'way/2', polygon: ring, ground: 200 }, { id: 'way/3', polygon: ring, ground: 300 }], [{ id: 'way/10' }], [[40, -74, 7]]);
    const second = tile('0:1', [], [], [[40.1, -74, 8]]);
    const zipped = Buffer.from(zipSync({ '0_0.json': strToU8(JSON.stringify(first)), '0_1.json': strToU8(JSON.stringify(second)) }));
    fs.writeFileSync(path.join(oldDir, 'pack.zip'), zipped);
    const oldManifest = { manifestHash: 'test-manifest', releaseTag: 'old-test', stats: { tileCount: 2 },
        tiles: { '0:0': { pack: 'p', file: '0_0.json' }, '0:1': { pack: 'p', file: '0_1.json' } },
        packs: { p: { path: 'pack.zip', bytes: zipped.length, sha256: crypto.createHash('sha256').update(zipped).digest('hex'), tiles: 2 } } };
    fs.writeFileSync(path.join(manifestDir, 'manifest.json'), JSON.stringify(oldManifest));
    const changed = [[40, -74], [40, -73], [41.001, -73], [40, -74]];
    fs.writeFileSync(path.join(newDir, '0_0.json'), JSON.stringify(tile('0:0', [
        { id: 'way/2', polygon: changed, ground: 222 }, { id: 'way/4', polygon: ring, ground: 400 }
    ], [{ id: 'way/10' }, { id: 'way/11' }], [])));
    fs.writeFileSync(path.join(newDir, '0_2.json'), JSON.stringify(tile('0:2', [
        { id: 'way/1', polygon: [[41, -73], [40, -74], [40, -73], [41, -73]], ground: 111 }
    ], [], [])));
    fs.writeFileSync(path.join(hgtDir, 'N38W081.hgt'), Buffer.alloc(3601 * 3601 * 2, Buffer.from([0, 42])));
    fs.writeFileSync(path.join(newDir, 'manifest.json'), JSON.stringify({ terrainDeferred: true,
        osmExtractTimestamp: '2026-10-27T21:23:59Z', osmPbfSha256: 'example', tiles: [
        { key: '0:0', path: '0_0.json' }, { key: '0:2', path: '0_2.json' }
    ], sourceMetadata: {}, uncertaintyModel: { terrain: {} } }));
    const db = path.join(temp, 'index.sqlite');
    try {
        for (const mode of ['index', 'merge']) {
            const result = spawnSync(process.execPath, [script, mode, 'test', oldDir, newDir, db],
                { cwd: temp, encoding: 'utf8', env: { ...process.env, SCENE_HGT_DIR: hgtDir } });
            assert.equal(result.status, 0, result.stderr);
        }
        const a = JSON.parse(fs.readFileSync(path.join(newDir, '0_0.json')));
        const restored = JSON.parse(fs.readFileSync(path.join(newDir, '0_1.json')));
        const moved = JSON.parse(fs.readFileSync(path.join(newDir, '0_2.json')));
        const result = JSON.parse(fs.readFileSync(path.join(newDir, 'refresh-comparison.json')));
        assert.deepEqual(a.terrain, first.terrain); assert.deepEqual(restored.terrain, second.terrain);
        assert.deepEqual(restored.buildings, []); assert.equal(moved.buildings[0].ground, 100);
        assert.equal(moved.terrain.length, 2601); assert.equal(moved.terrain[0][2], 42);
        assert.equal(a.buildings[0].ground, 222);
        assert.equal(result.newBuildingIds, 1); assert.equal(result.changedFootprints, 1);
        assert.equal(result.unchangedFootprints, 1); assert.equal(result.missingOldBuildingIds, 1);
        assert.equal(result.newTunnelIds, 1); assert.equal(result.restoredEmptyTiles, 1);
        const validate = path.resolve(__dirname, '../tools/validate-scene-refresh.cjs');
        const verified = spawnSync(process.execPath, [validate, newDir], { cwd: temp, encoding: 'utf8' });
        assert.equal(verified.status, 0, verified.stderr);
        const broken = JSON.parse(fs.readFileSync(path.join(newDir, 'refresh-comparison.json')));
        broken.missingGround = 1;
        fs.writeFileSync(path.join(newDir, 'refresh-comparison.json'), JSON.stringify(broken));
        const rejected = spawnSync(process.execPath, [validate, newDir], { cwd: temp, encoding: 'utf8' });
        assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /elevation gaps/);
    } finally {
        assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});

test('paired route report requires identical code and candidates and calculates percentage-point changes', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-route-report-test-'));
    const script = path.resolve(__dirname, '../tools/report-us-scene-refresh.cjs');
    const ids = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
    fs.mkdirSync(path.join(temp, 'docs', 'data'), { recursive: true });
    const rows = ids.flatMap(region => Array.from({ length: 12 }, (_, i) => {
        const fastest = { id: `${region}-${i}`, durationSec: 600, analysisMode: 'scene',
            confirmedShadeTimeRatio: 0.25, uncertainOcclusionTimeRatio: 0.1, sceneCoverage: { segmentRatio: 1 } };
        return { id: `${region}-${i}`, region, name: region, timeCase: String(i), departureUtc: '2026-06-21T12:00:00Z',
            candidateCount: 2, fastest, shade: { ...fastest } };
    }));
    const common = { codeHashes: { scene: 'a' }, runtimeHashes: { node: 'v24' }, candidateSha256: 'same',
        candidateFile: 'candidate.json', tags: {} };
    const old = { ...common, version: 'old', rows };
    const fresh = { ...common, version: 'new', rows: rows.map(row => ({ ...row,
        fastest: { ...row.fastest, confirmedShadeTimeRatio: 0.3 }, shade: { ...row.shade } })) };
    const oldFile = path.join(temp, 'old.json'), newFile = path.join(temp, 'new.json');
    fs.writeFileSync(oldFile, JSON.stringify(old)); fs.writeFileSync(newFile, JSON.stringify(fresh));
    fs.writeFileSync(path.join(temp, 'us-route-baseline.json'), JSON.stringify(old));
    for (const id of ids) {
        const regionDir = path.join(temp, `build-${id}`);
        fs.mkdirSync(path.join(regionDir, 'release'), { recursive: true });
        fs.mkdirSync(path.join(regionDir, 'generated'), { recursive: true });
        fs.writeFileSync(path.join(regionDir, 'release', 'manifest.json'), JSON.stringify({ releaseTag: id,
            osmExtractTimestamp: '2026-10-27T21:23:59Z', osmPbfSha256: 'hash', stats: { tileCount: 2, packCount: 1 } }));
        fs.writeFileSync(path.join(regionDir, 'generated', 'refresh-comparison.json'), JSON.stringify({ oldBuildings: 3,
            newBuildingIds: 1, changedFootprints: 1, missingOldBuildingIds: 0, newTunnelIds: 0 }));
        fs.writeFileSync(path.join(temp, `us-route-new-${id}.json`), JSON.stringify({ ...fresh,
            tags: { [id]: id }, rows: fresh.rows.filter(row => row.region === id) }));
    }
    try {
        const combine = path.resolve(__dirname, '../tools/combine-us-scene-routes.cjs');
        const combined = path.join(temp, 'combined.json');
        let combinedRun = spawnSync(process.execPath, [combine, temp, combined], { cwd: temp, encoding: 'utf8' });
        assert.equal(combinedRun.status, 0, combinedRun.stderr);
        assert.equal(JSON.parse(fs.readFileSync(combined)).rows.length, 48);
        let run = spawnSync(process.execPath, [script, oldFile, newFile, temp], { cwd: temp, encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr);
        const result = JSON.parse(fs.readFileSync(path.join(temp, 'docs', 'data', 'us-scene-update-comparison-2026-10-27.json')));
        assert.equal(result.comparisons.length, 48);
        assert.ok(Math.abs(result.comparisons[0].deltaConfirmedPercentagePoints - 5) < 1e-9);
        fresh.candidateSha256 = 'different'; fs.writeFileSync(newFile, JSON.stringify(fresh));
        run = spawnSync(process.execPath, [script, oldFile, newFile, temp], { cwd: temp, encoding: 'utf8' });
        assert.notEqual(run.status, 0); assert.match(run.stderr, /candidate data/);
        const badRegion = path.join(temp, 'us-route-new-us-west.json');
        const bad = JSON.parse(fs.readFileSync(badRegion)); bad.codeHashes.scene = 'different';
        fs.writeFileSync(badRegion, JSON.stringify(bad));
        combinedRun = spawnSync(process.execPath, [combine, temp, combined], { cwd: temp, encoding: 'utf8' });
        assert.notEqual(combinedRun.status, 0); assert.match(combinedRun.stderr, /Inconsistent regional comparison/);
    } finally {
        assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(temp, { recursive: true, force: true });
    }
});
