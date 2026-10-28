const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const { zipSync, unzipSync, strToU8 } = require('fflate');
const SceneShadow = require('../js/scene-shadow.js');

test('simple scene polygons preserve a courtyard for ray intersections', () => {
    // Four non-overlapping pieces form a 10x10 building with a 4x4 courtyard.
    const rings = [
        [[0, 0], [10, 0], [10, 3], [0, 3]], [[0, 7], [10, 7], [10, 10], [0, 10]],
        [[0, 3], [3, 3], [3, 7], [0, 7]], [[7, 3], [10, 3], [10, 7], [7, 7]]
    ].map(r => r.map(([x, y]) => ({ x, y })));
    const point = { x: 5, y: 5 }, direction = { x: 1, y: 0 };
    assert.equal(rings.some(r => SceneShadow.pointInPolygon(point, r)), false);
    const hits = rings.map(r => SceneShadow.intersectRayWithPolygon(point, direction, r)).filter(x => x !== null);
    assert.equal(Math.min(...hits), 2);
});

test('overlay package reuses immutable packs and publishes changed packs under the new tag', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-rel-package-'));
    try {
        const region = 'us-northeast', oldTag = 'scene-us-northeast-hybrid-v3-osm-20261027';
        const data = path.join(root, 'data', 'scene', region), oldDir = path.join(root, `build-${region}`, 'release');
        const audit = path.join(root, `multipolygon-${region}`), changed = path.join(audit, 'changed-tiles');
        [data, oldDir, changed].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
        const tile = key => ({ key, buildings: [], terrain: Array(2601).fill([0,0,0]), sceneCoverage: { buildingGround: true } });
        const a = Buffer.from(zipSync({ '0_0.json': strToU8(JSON.stringify(tile('0:0'))) }));
        const b = Buffer.from(zipSync({ '1_0.json': strToU8(JSON.stringify(tile('1:0'))) }));
        fs.writeFileSync(path.join(oldDir, 'a.zip'), a); fs.writeFileSync(path.join(oldDir, 'b.zip'), b);
        const meta = (file, bytes) => ({ path: file, bytes: bytes.length, tiles: 1,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bounds: {} });
        const old = { schema: 3, releaseTag: oldTag, maxPackBytes: 10485760, stats: {}, packaging: {},
            packs: { a: meta('a.zip', a), b: meta('b.zip', b) },
            tiles: { '0:0': { pack: 'a', file: '0_0.json' }, '1:0': { pack: 'b', file: '1_0.json' } } };
        fs.writeFileSync(path.join(data, 'manifest.json'), JSON.stringify(old));
        fs.writeFileSync(path.join(oldDir, 'manifest.json'), JSON.stringify(old));
        const changedTile = tile('1:0'); changedTile.buildings.push({ id: 'relation/1/piece/0' });
        fs.writeFileSync(path.join(changed, '1_0.json'), JSON.stringify(changedTile));
        fs.writeFileSync(path.join(changed, '2_0.json'), JSON.stringify(tile('2:0')));
        fs.writeFileSync(path.join(audit, 'overlay-audit.json'), JSON.stringify({ changedExistingTiles: 1, newTiles: 1 }));
        for (const name of ['assembly-audit.json', 'scene-preparation-audit.json']) fs.writeFileSync(path.join(audit, name), '{}');
        const script = path.resolve(__dirname, '../tools/package-multipolygon-overlay.mjs');
        const result = spawnSync(process.execPath, [script, region, root], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const release = path.join(audit, 'release');
        const manifest = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json')));
        assert.equal(manifest.packs.a.path, `${oldTag}/a.zip`);
        assert.equal(manifest.stats.tileCount, 3);
        assert.equal(manifest.stats.releaseAssetCount, 3);
        const changedPack = manifest.packs[manifest.tiles['1:0'].pack];
        assert.ok(changedPack.path.startsWith(manifest.releaseTag + '/'));
        const dataZip = unzipSync(fs.readFileSync(path.join(release, path.basename(changedPack.path))));
        assert.equal(JSON.parse(Buffer.from(dataZip['1_0.json'])).buildings[0].id, 'relation/1/piece/0');
        assert.deepEqual(fs.readFileSync(path.join(oldDir, 'a.zip')), a);
        const validator = path.resolve(__dirname, '../tools/validate-multipolygon-overlay.mjs');
        const checked = spawnSync(process.execPath, [validator, region, root], { cwd: root, encoding: 'utf8' });
        assert.equal(checked.status, 0, checked.stderr);
        assert.equal(JSON.parse(fs.readFileSync(path.join(audit, 'validation.json'))).relationPieces, 1);
        const resumed = spawnSync(process.execPath, [script, region, root], { cwd: root, encoding: 'utf8',
            env: { ...process.env, SCENE_OVERLAY_RESUME: 'true', SCENE_OVERLAY_MAX_ASSETS: '2' } });
        assert.equal(resumed.status, 0, resumed.stderr);
        const compact = JSON.parse(fs.readFileSync(path.join(release, 'manifest.json')));
        assert.equal(compact.stats.releaseAssetCount, 2);
        assert.equal(compact.stats.tileCount, 3);
        const checkedAgain = spawnSync(process.execPath, [validator, region, root], { cwd: root, encoding: 'utf8' });
        assert.equal(checkedAgain.status, 0, checkedAgain.stderr);

        fs.writeFileSync(path.join(data, 'manifest.json'), JSON.stringify(compact));
        const recheck = path.join(root, `multipolygon-recheck-${region}`), recheckTiles = path.join(recheck, 'changed-tiles');
        fs.mkdirSync(recheckTiles, { recursive: true });
        changedTile.buildings.push({ id: 'relation/2/piece/0' });
        fs.writeFileSync(path.join(recheckTiles, '1_0.json'), JSON.stringify(changedTile));
        fs.writeFileSync(path.join(recheck, 'overlay-audit.json'), JSON.stringify({ changedExistingTiles: 1, newTiles: 0 }));
        for (const name of ['assembly-audit.json', 'scene-preparation-audit.json']) fs.writeFileSync(path.join(recheck, name), '{}');
        const incrementalEnv = { ...process.env, SCENE_OVERLAY_INCREMENTAL: 'true' };
        const incremental = spawnSync(process.execPath, [script, region, root], { cwd: root, encoding: 'utf8', env: incrementalEnv });
        assert.equal(incremental.status, 0, incremental.stderr);
        const finalCheck = spawnSync(process.execPath, [validator, region, root], { cwd: root, encoding: 'utf8', env: incrementalEnv });
        assert.equal(finalCheck.status, 0, finalCheck.stderr);
        assert.equal(JSON.parse(fs.readFileSync(path.join(recheck, 'validation.json'))).relationPieces, 2);

        const recheckManifest = JSON.parse(fs.readFileSync(path.join(recheck, 'release', 'manifest.json')));
        fs.writeFileSync(path.join(data, 'manifest.json'), JSON.stringify(recheckManifest));
        const followup = path.join(root, `multipolygon-followup-${region}`), followupTiles = path.join(followup, 'changed-tiles');
        fs.mkdirSync(followupTiles, { recursive: true });
        changedTile.buildings.push({ id: 'relation/3/piece/0' });
        fs.writeFileSync(path.join(followupTiles, '1_0.json'), JSON.stringify(changedTile));
        fs.writeFileSync(path.join(followup, 'overlay-audit.json'), JSON.stringify({ changedExistingTiles: 1, newTiles: 0 }));
        for (const name of ['assembly-audit.json', 'scene-preparation-audit.json']) fs.writeFileSync(path.join(followup, name), '{}');
        const followupEnv = { ...process.env, SCENE_OVERLAY_FOLLOWUP: 'true' };
        const packagedFollowup = spawnSync(process.execPath, [script, region, root], { cwd: root, encoding: 'utf8', env: followupEnv });
        assert.equal(packagedFollowup.status, 0, packagedFollowup.stderr);
        const checkedFollowup = spawnSync(process.execPath, [validator, region, root], { cwd: root, encoding: 'utf8', env: followupEnv });
        assert.equal(checkedFollowup.status, 0, checkedFollowup.stderr);
        assert.equal(JSON.parse(fs.readFileSync(path.join(followup, 'validation.json'))).relationPieces, 3);
        assert.equal(JSON.parse(fs.readFileSync(path.join(followup, 'release', 'manifest.json'))).packaging.baselineReleaseTags.length, 3);

        fs.writeFileSync(path.join(data, 'manifest.json'), fs.readFileSync(path.join(followup, 'release', 'manifest.json')));
        const last = path.join(root, `multipolygon-last-${region}`), lastTiles = path.join(last, 'changed-tiles');
        fs.mkdirSync(lastTiles, { recursive: true });
        changedTile.buildings.push({ id: 'relation/4/piece/0' });
        fs.writeFileSync(path.join(lastTiles, '1_0.json'), JSON.stringify(changedTile));
        fs.writeFileSync(path.join(last, 'overlay-audit.json'), JSON.stringify({ changedExistingTiles: 1, newTiles: 0 }));
        for (const name of ['assembly-audit.json', 'scene-preparation-audit.json']) fs.writeFileSync(path.join(last, name), '{}');
        const lastEnv = { ...process.env, SCENE_OVERLAY_LAST: 'true' };
        const packagedLast = spawnSync(process.execPath, [script, region, root], { cwd: root, encoding: 'utf8', env: lastEnv });
        assert.equal(packagedLast.status, 0, packagedLast.stderr);
        const checkedLast = spawnSync(process.execPath, [validator, region, root], { cwd: root, encoding: 'utf8', env: lastEnv });
        assert.equal(checkedLast.status, 0, checkedLast.stderr);
        assert.equal(JSON.parse(fs.readFileSync(path.join(last, 'validation.json'))).relationPieces, 4);
        assert.equal(JSON.parse(fs.readFileSync(path.join(last, 'release', 'manifest.json'))).packaging.baselineReleaseTags.length, 4);
    } finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('overlay replaces only a verified duplicate outer way without changing the baseline', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-rel-overlay-'));
    try {
        const audit = path.join(root, 'multipolygon-us-northeast');
        const base = path.join(root, 'build-us-northeast', 'generated');
        const data = path.join(root, 'data', 'scene', 'us-northeast');
        const hgt = path.join(root, 'us-hgt');
        [audit, base, data, hgt].forEach(dir => fs.mkdirSync(dir, { recursive: true }));
        const tile = { key: '0:0', grid: { latOrigin: 38, lngOrigin: -81, cosLat: 0.7 },
            buildings: [{ id: 'way/1', polygon: [[40,-74],[40,-73],[41,-73],[40,-74]], ground: 0 }],
            tunnels: [], terrain: [[40,-74,0]], source: {}, sceneCoverage: { buildingGround: true } };
        const original = JSON.stringify(tile);
        fs.writeFileSync(path.join(base, '0_0.json'), original);
        fs.writeFileSync(path.join(data, 'manifest.json'), JSON.stringify({ grid: tile.grid, tiles: { '0:0': { file: '0_0.json' } } }));
        // Zero is a valid DEM value, not a missing-value sentinel.
        fs.writeFileSync(path.join(hgt, 'N40W074.hgt'), Buffer.alloc(3601 * 3601 * 2));
        const row = { id: 7, tags: { building: 'yes' }, kind: 'relation-tagged',
            pieces: [{ id: 'relation/7/piece/0', key: '0:0', polygon: [[40,-74],[40,-73],[41,-73],[40,-74]], groundPoint: [40,-74] }],
            removeWays: [{ id: 'way/1', key: '0:0' }] };
        fs.writeFileSync(path.join(audit, 'scene-relations.jsonl'), JSON.stringify(row) + '\n');
        for (const name of ['building-relations.jsonl','assembly-rejected.jsonl','triangulation-rejected.jsonl']) fs.writeFileSync(path.join(audit, name), '');
        const script = path.resolve(__dirname, '../tools/build-multipolygon-scene-overlay.mjs');
        const result = spawnSync(process.execPath, [script, 'us-northeast', root], { cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const updated = JSON.parse(fs.readFileSync(path.join(audit, 'changed-tiles', '0_0.json')));
        assert.equal(updated.buildings.length, 1);
        assert.equal(updated.buildings[0].id, 'relation/7/piece/0');
        assert.equal(updated.buildings[0].ground, 0);
        assert.equal(fs.readFileSync(path.join(base, '0_0.json'), 'utf8'), original);

        const current = { grid: tile.grid, tiles: { '0:0': { file: '0_0.json' } }, sourceMetadata: { multipolygon: {} } };
        fs.writeFileSync(path.join(data, 'manifest.json'), JSON.stringify(current));
        const recheck = path.join(root, 'multipolygon-recheck-us-northeast'); fs.mkdirSync(recheck);
        for (const name of ['building-relations.jsonl','assembly-rejected.jsonl','triangulation-rejected.jsonl']) fs.writeFileSync(path.join(recheck, name), '');
        fs.writeFileSync(path.join(audit, 'overlay-blocked.jsonl'), '');
        const second = { id: 8, tags: { 'building:part': 'yes', height: '4' }, kind: 'relation-tagged',
            pieces: [{ id: 'relation/8/piece/0', key: '0:0', polygon: [[40,-74],[40,-73],[41,-73],[40,-74]], groundPoint: [40,-74] }], removeWays: [] };
        fs.writeFileSync(path.join(recheck, 'scene-relations.jsonl'), JSON.stringify(second) + '\n');
        const increment = spawnSync(process.execPath, [script, 'us-northeast', root], { cwd: root, encoding: 'utf8',
            env: { ...process.env, SCENE_OVERLAY_INCREMENTAL: 'true' } });
        assert.equal(increment.status, 0, increment.stderr);
        const again = JSON.parse(fs.readFileSync(path.join(recheck, 'changed-tiles', '0_0.json')));
        assert.deepEqual(again.buildings.map(b => b.id), ['relation/7/piece/0', 'relation/8/piece/0']);
        assert.equal(fs.readFileSync(path.join(audit, 'changed-tiles', '0_0.json'), 'utf8'), JSON.stringify(updated));
    } finally {
        assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(root, { recursive: true, force: true });
    }
});
