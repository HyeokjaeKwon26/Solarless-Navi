#!/usr/bin/env node
/* Validate a packaged static-scene Release directory without network access. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { unzipSync, strFromU8 } = require('fflate');
const releaseDir = path.resolve(process.env.SCENE_RELEASE_DIR || process.argv[2] || '.');
const manifestPath = path.resolve(process.env.SCENE_RELEASE_MANIFEST || path.join(releaseDir, 'manifest.json'));

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function percentile(sorted, fraction) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

const startedAt = Date.now();
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedEntries = new Map();
for (const [key, tile] of Object.entries(manifest.tiles || {})) {
    if (expectedEntries.has(`${tile.pack}:${tile.file}`)) throw new Error(`duplicate mapped entry: ${tile.pack}:${tile.file}`);
    expectedEntries.set(`${tile.pack}:${tile.file}`, key);
}

const seenTiles = new Set();
const sizes = [];
let parsedBytes = 0;
for (const [packKey, pack] of Object.entries(manifest.packs || {})) {
    const filePath = path.join(releaseDir, pack.path);
    const content = fs.readFileSync(filePath);
    if (content.length !== Number(pack.bytes)) throw new Error(`byte count mismatch: ${pack.path}`);
    if (sha256(content) !== pack.sha256) throw new Error(`SHA-256 mismatch: ${pack.path}`);
    if (content.length > Number(manifest.maxPackBytes)) throw new Error(`pack exceeds hard limit: ${pack.path}`);
    sizes.push(content.length);
    const entries = unzipSync(new Uint8Array(content));
    if (Object.keys(entries).length !== Number(pack.tiles)) throw new Error(`entry count mismatch: ${pack.path}`);
    for (const [file, bytes] of Object.entries(entries)) {
        const identity = `${packKey}:${file}`;
        const tileKey = expectedEntries.get(identity);
        if (!tileKey) throw new Error(`unmapped ZIP entry: ${identity}`);
        if (seenTiles.has(tileKey)) throw new Error(`tile appears twice: ${tileKey}`);
        JSON.parse(strFromU8(bytes));
        parsedBytes += bytes.byteLength;
        seenTiles.add(tileKey);
    }
}

if (seenTiles.size !== expectedEntries.size) {
    const missing = [...expectedEntries.values()].filter(key => !seenTiles.has(key)).slice(0, 5);
    throw new Error(`missing ${expectedEntries.size - seenTiles.size} tiles: ${missing.join(', ')}`);
}
if (manifest.stats && Number(manifest.stats.packCount) !== sizes.length) throw new Error('manifest packCount mismatch');
if (manifest.stats && Number(manifest.stats.tileCount) !== seenTiles.size) throw new Error('manifest tileCount mismatch');
if (sizes.length + 1 > Number(manifest.packaging && manifest.packaging.maxReleaseAssets || 1000)) {
    throw new Error('Release asset count exceeds manifest policy');
}

sizes.sort((a, b) => a - b);
const result = {
    releaseDir,
    packs: sizes.length,
    releaseAssets: sizes.length + 1,
    tiles: seenTiles.size,
    compressedBytes: sizes.reduce((sum, value) => sum + value, 0),
    parsedJsonBytes: parsedBytes,
    minPackBytes: sizes[0] || 0,
    medianPackBytes: percentile(sizes, 0.5),
    p95PackBytes: percentile(sizes, 0.95),
    maxPackBytes: sizes[sizes.length - 1] || 0,
    elapsedMs: Date.now() - startedAt,
    checksums: 'verified',
    json: 'all parsed',
    coverage: 'exactly once'
};
console.log(JSON.stringify(result, null, 2));
