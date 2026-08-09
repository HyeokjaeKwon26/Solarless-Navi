#!/usr/bin/env node
/* Bundle 5 km scene tiles into small GitHub Release assets. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require('fflate');
const ROOT = path.resolve(import.meta.dirname, '..');
const INPUT_DIR = path.join(ROOT, 'data', 'generated', 'scene-ma');
const OUTPUT_DIR = path.join(ROOT, 'data', 'release', 'scene-ma-v1');
const TRACKED_MANIFEST = path.join(ROOT, 'data', 'scene', 'ma', 'manifest.json');
// Four tiles per release asset keeps peak preprocessing memory bounded even
// for dense Boston-area tiles while still keeping the release well below the
// GitHub asset-count limit.
const PACK_WIDTH = 2;
const RELEASE_TAG = 'scene-ma-v1';
const RELEASE_BASE_URL = `https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/${RELEASE_TAG}`;

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function packForTile(key) {
    const [x, y] = String(key).split(':').map(Number);
    return `${Math.floor(x / PACK_WIDTH)}_${Math.floor(y / PACK_WIDTH)}`;
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
    for (const [pack, tileList] of groups) {
        const entries = {};
        for (const tile of tileList) {
            const sourcePath = path.join(INPUT_DIR, tile.path);
            entries[tile.path] = strToU8(fs.readFileSync(sourcePath, 'utf8'));
        }
        const fileName = `scene-ma-${pack}.zip`;
        const filePath = path.join(OUTPUT_DIR, fileName);
        fs.writeFileSync(filePath, zipSync(entries, { level: 6 }));
        packs[pack] = { path: fileName, bytes: fs.statSync(filePath).size, sha256: sha256(filePath), tiles: tileList.length };
        for (const tile of tileList) tiles[tile.key] = { pack, file: tile.path };
    }
    const manifest = {
        schema: 2,
        region: 'MA',
        releaseTag: RELEASE_TAG,
        baseUrl: RELEASE_BASE_URL,
        tileSizeM: sourceManifest.tileSizeM,
        tilePaddingMeters: sourceManifest.tilePaddingMeters,
        terrainSpacingM: sourceManifest.terrainSpacingM,
        grid: sourceManifest.grid,
        source: sourceManifest.source,
        generatedAt: sourceManifest.generatedAt,
        packWidth: PACK_WIDTH,
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
