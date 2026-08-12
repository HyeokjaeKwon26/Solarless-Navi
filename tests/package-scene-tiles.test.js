const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { zipSync, unzipSync } = require('fflate');

let modulePromise;
function packageModule() {
    modulePromise ||= import(pathToFileURL(path.resolve(__dirname, '../tools/package-scene-tiles.mjs')).href);
    return modulePromise;
}

function pseudoRandomBytes(length, seed) {
    const output = Buffer.alloc(length);
    let state = seed >>> 0;
    for (let index = 0; index < length; index += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        output[index] = state >>> 24;
    }
    return output;
}

function sourceManifest(tiles) {
    return {
        schema: 3,
        schemaVersion: 'fixture-v1',
        dataVersion: 'fixture-data-v1',
        generatedAt: '2026-08-11T00:00:00.000Z',
        tileSizeM: 5000,
        tilePaddingMeters: 4500,
        terrainSpacingM: 100,
        grid: { latOrigin: 40, lngOrigin: -75, cosLat: 0.75 },
        tiles
    };
}

function fixtureConfig(root, overrides = {}) {
    return {
        regionId: 'fixture', regionLabel: 'FIXTURE',
        inputDir: path.join(root, 'input'), sourceReleaseDir: path.join(root, 'input'),
        releaseTag: 'scene-fixture-hybrid-v2', outputDir: path.join(root, 'output'),
        trackedManifest: path.join(root, 'tracked', 'manifest.json'),
        releaseBaseUrl: 'https://example.test/scene-fixture-hybrid-v2', adaptive: true,
        legacyPackWidth: 2, targetMinBytes: 3500, targetBytes: 5500,
        targetMaxBytes: 7000, maxPackBytes: 9000, maxAssets: 25,
        maxMergeGapTiles: 8, sourcePackCacheEntries: 1,
        ...overrides
    };
}

function makeLooseFixture(root, count = 32) {
    const input = path.join(root, 'input');
    fs.mkdirSync(input, { recursive: true });
    const tiles = [];
    for (let index = 0; index < count; index += 1) {
        const x = Math.floor(index / 8);
        const y = index % 8;
        const file = `${x}_${y}.json`;
        fs.writeFileSync(path.join(input, file), pseudoRandomBytes(900 + (index % 5) * 50, index + 1));
        tiles.push({ key: `${x}:${y}`, path: file });
    }
    fs.writeFileSync(path.join(input, 'manifest.json'), JSON.stringify(sourceManifest(tiles)));
    return tiles;
}

function sha256(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('adaptive packaging preserves every 5 km tile exactly once and obeys hard limits', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-pack-test-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const sourceTiles = makeLooseFixture(root, 40);
    const { packageSceneTiles } = await packageModule();
    const config = fixtureConfig(root);
    const manifest = packageSceneTiles(config);

    assert.equal(manifest.tileSizeM, 5000);
    assert.equal(manifest.packaging.mode, 'adaptive-compressed-size-v2');
    assert.equal(manifest.stats.tileCount, sourceTiles.length);
    assert.ok(manifest.stats.releaseAssetCount <= config.maxAssets);
    const assigned = Object.keys(manifest.tiles).sort();
    assert.deepEqual(assigned, sourceTiles.map(tile => tile.key).sort());
    for (const [packKey, pack] of Object.entries(manifest.packs)) {
        assert.ok(pack.bytes <= config.maxPackBytes, `${packKey} exceeds hard maximum`);
        const archive = unzipSync(fs.readFileSync(path.join(config.outputDir, pack.path)));
        assert.equal(Object.keys(archive).length, pack.tiles);
        for (const file of Object.keys(archive)) {
            const tile = Object.values(manifest.tiles).find(entry => entry.pack === packKey && entry.file === file);
            assert.ok(tile, `unmapped archive entry ${file}`);
        }
    }
});

test('adaptive pack names and checksums are deterministic', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-pack-deterministic-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    makeLooseFixture(root, 24);
    const { packageSceneTiles } = await packageModule();
    const config = fixtureConfig(root);
    const first = packageSceneTiles(config);
    const firstHashes = Object.fromEntries(Object.values(first.packs).map(pack => [pack.path, sha256(path.join(config.outputDir, pack.path))]));
    const second = packageSceneTiles(config);
    const secondHashes = Object.fromEntries(Object.values(second.packs).map(pack => [pack.path, sha256(path.join(config.outputDir, pack.path))]));
    assert.deepEqual(secondHashes, firstHashes);
    assert.equal(second.manifestHash, first.manifestHash);
});

test('schema-2 v1 release ZIP assets can be repacked without extracted tile files', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-pack-v1-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const input = path.join(root, 'input');
    fs.mkdirSync(input, { recursive: true });
    const entries = {};
    const mappedTiles = {};
    for (let index = 0; index < 6; index += 1) {
        const file = `${index}_0.json`;
        entries[file] = pseudoRandomBytes(700, index + 50);
        mappedTiles[`${index}:0`] = { pack: 'legacy', file };
    }
    const legacyFile = 'scene-fixture-legacy.zip';
    fs.writeFileSync(path.join(input, legacyFile), zipSync(entries, { level: 6 }));
    const manifest = sourceManifest(mappedTiles);
    manifest.schema = 2;
    manifest.packs = { legacy: { path: legacyFile, tiles: 6 } };
    fs.writeFileSync(path.join(input, 'manifest.json'), JSON.stringify(manifest));

    const { packageSceneTiles, planScenePackages } = await packageModule();
    const cacheFile = path.join(root, 'compressed-size-cache.json');
    const config = fixtureConfig(root, { targetMinBytes: 1000, targetBytes: 2500, targetMaxBytes: 3500, maxPackBytes: 5000, planCache: cacheFile });
    const output = packageSceneTiles(config);
    assert.equal(output.stats.tileCount, 6);
    assert.deepEqual(Object.keys(output.tiles).sort(), Object.keys(mappedTiles).sort());
    assert.ok(output.stats.packCount >= 1);
    assert.ok(fs.existsSync(cacheFile));
    fs.renameSync(path.join(input, legacyFile), path.join(input, `${legacyFile}.offline`));
    const cachedPlan = planScenePackages(config);
    assert.equal(cachedPlan.estimatedTiles.length, 6);
});

test('adaptive planner rejects a tile larger than the hard asset size', async () => {
    const { planAdaptiveGroups } = await packageModule();
    assert.throws(() => planAdaptiveGroups([
        { key: '0:0', x: 0, y: 0, zipContributionBytes: 10000 }
    ], {
        targetMinBytes: 1000, targetBytes: 2000, targetMaxBytes: 3000,
        maxPackBytes: 5000, maxAssets: 10, maxMergeGapTiles: 8
    }), /single tile exceeds/);
});

test('dense 2x2 blocks remain separate while sparse packs stay geographically bounded', async () => {
    const { planAdaptiveGroups } = await packageModule();
    const tiles = [];
    for (let x = 0; x < 12; x += 1) {
        for (let y = 0; y < 4; y += 1) {
            tiles.push({
                key: `${x}:${y}`, x, y,
                zipContributionBytes: x < 4 ? 180000 : 10000
            });
        }
    }
    const groups = planAdaptiveGroups(tiles, {
        targetMinBytes: 200000, targetBytes: 700000, targetMaxBytes: 800000,
        maxPackBytes: 1000000, maxAssets: 100, maxMergeGapTiles: 8,
        maxAdaptivePackSpanTiles: 8, dense2x2ThresholdBytes: 500000,
        preserveDenseGroups: true
    });
    const dense = groups.filter(group => group.some(tile => tile.dense));
    assert.equal(dense.length, 4);
    assert.ok(dense.every(group => group.length === 4));
    for (const group of groups.filter(group => !group.some(tile => tile.dense))) {
        const xs = group.map(tile => tile.x);
        const ys = group.map(tile => tile.y);
        assert.ok(Math.max(...xs) - Math.min(...xs) + 1 <= 8);
        assert.ok(Math.max(...ys) - Math.min(...ys) + 1 <= 8);
    }
});
