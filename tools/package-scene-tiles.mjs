#!/usr/bin/env node
/* Bundle 5 km scene tiles into small GitHub Release assets. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require('fflate');
const ROOT = path.resolve(import.meta.dirname, '..');
const REGION_ID = String(process.env.SCENE_REGION || 'us-northeast').toLowerCase();
const REGION_LABEL = String(process.env.SCENE_REGION_LABEL || (REGION_ID === 'ma' ? 'MA' : REGION_ID.toUpperCase()));
const INPUT_DIR = path.resolve(process.env.SCENE_INPUT_DIR || path.join(ROOT, 'data', 'generated', `scene-${REGION_ID}`));
const RELEASE_TAG = String(process.env.SCENE_RELEASE_TAG || `scene-${REGION_ID}-v1`);
const OUTPUT_DIR = path.resolve(process.env.SCENE_RELEASE_DIR || path.join(ROOT, 'data', 'release', RELEASE_TAG));
const TRACKED_MANIFEST = path.resolve(process.env.SCENE_TRACKED_MANIFEST || path.join(ROOT, 'data', 'scene', REGION_ID, 'manifest.json'));
// The pack width can be increased for sparse/rural regions so each release
// stays below GitHub's 1,000-asset limit without changing logical 5 km tiles.
const PACK_WIDTH = Number(process.env.SCENE_PACK_WIDTH || 2);
const MAX_PACK_BYTES = Number(process.env.SCENE_MAX_PACK_BYTES || 500 * 1024 * 1024);
const RELEASE_BASE_URL = String(process.env.SCENE_RELEASE_BASE_URL || `https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/${RELEASE_TAG}`);

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function packForTile(key) {
    const [x, y] = String(key).split(':').map(Number);
    return `${Math.floor(x / PACK_WIDTH)}_${Math.floor(y / PACK_WIDTH)}`;
}

function zipTileList(inputDir, tileList) {
    const entries = {};
    for (const tile of tileList) {
        const sourcePath = path.join(inputDir, tile.path);
        entries[tile.path] = strToU8(fs.readFileSync(sourcePath, 'utf8'));
    }
    return zipSync(entries, { level: 6 });
}

function main() {
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(INPUT_DIR, 'manifest.json'), 'utf8'));
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    ensureDir(OUTPUT_DIR);
    const groups = new Map();
    for (const tile of sourceManifest.tiles || []) {
        const pack = packForTile(tile.key);
        if (!groups.has(pack)) groups.set(pack, []);
        groups.get(pack).push(tile);
    }
    const packs = {};
    const tiles = {};
    const pending = [...groups.entries()].map(([pack, tileList]) => [pack, [...tileList].sort((a, b) => String(a.key).localeCompare(String(b.key)))]);
    while (pending.length) {
        const [basePack, tileList] = pending.shift();
        const zipped = zipTileList(INPUT_DIR, tileList);
        if (zipped.length > MAX_PACK_BYTES && tileList.length > 1) {
            const midpoint = Math.ceil(tileList.length / 2);
            pending.unshift(
                [`${basePack}-b`, tileList.slice(midpoint)],
                [`${basePack}-a`, tileList.slice(0, midpoint)]
            );
            continue;
        }
        if (zipped.length > MAX_PACK_BYTES) {
            throw new Error(`single tile exceeds SCENE_MAX_PACK_BYTES: ${basePack} (${zipped.length} bytes)`);
        }
        const pack = basePack;
        const fileName = `scene-${REGION_ID}-${pack}.zip`;
        const filePath = path.join(OUTPUT_DIR, fileName);
        fs.writeFileSync(filePath, zipped);
        packs[pack] = { path: fileName, bytes: zipped.length, sha256: sha256(filePath), tiles: tileList.length };
        for (const tile of tileList) tiles[tile.key] = { pack, file: tile.path };
    }
    const manifest = {
        schema: 2,
        region: REGION_LABEL,
        releaseTag: RELEASE_TAG,
        baseUrl: RELEASE_BASE_URL,
        tileSizeM: sourceManifest.tileSizeM,
        tilePaddingMeters: sourceManifest.tilePaddingMeters,
        terrainSpacingM: sourceManifest.terrainSpacingM,
        grid: sourceManifest.grid,
        source: sourceManifest.source,
        sourceMetadata: sourceManifest.sourceMetadata || null,
        localFileModifiedAt: sourceManifest.sourceMetadata && sourceManifest.sourceMetadata.osm
            ? sourceManifest.sourceMetadata.osm.localFileModifiedAt || null : null,
        osmExtractTimestamp: sourceManifest.osmExtractTimestamp || null,
        osmSourceUrl: sourceManifest.osmSourceUrl || null,
        osmPbfSha256: sourceManifest.osmPbfSha256 || null,
        demDataset: sourceManifest.demDataset || null,
        demDatasetVersion: sourceManifest.demDatasetVersion || null,
        generatedAt: sourceManifest.generatedAt,
        schemaVersion: sourceManifest.schemaVersion || sourceManifest.schema || null,
        packWidth: PACK_WIDTH,
        maxPackBytes: MAX_PACK_BYTES,
        profileResolution: sourceManifest.profileResolution || null,
        dataVersion: sourceManifest.dataVersion || null,
        bounds: sourceManifest.bounds || null,
        stats: {
            tileCount: Object.keys(tiles).length,
            packCount: Object.keys(packs).length,
            totalBytes: Object.values(packs).reduce((sum, pack) => sum + Number(pack.bytes || 0), 0),
            maxPackBytes: Math.max(0, ...Object.values(packs).map(pack => Number(pack.bytes || 0)))
        },
        packs,
        tiles
    };
    ensureDir(path.dirname(TRACKED_MANIFEST));
    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(TRACKED_MANIFEST, JSON.stringify({ ...manifest, baseUrl: RELEASE_BASE_URL }, null, 2));
    console.log(`created ${Object.keys(packs).length} release packs and ${Object.keys(tiles).length} tile entries`);
    for (const [key, value] of Object.entries(packs)) console.log(`${key}: ${value.bytes} bytes (${value.tiles} tiles)`);
}

main();
