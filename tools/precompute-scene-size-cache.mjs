#!/usr/bin/env node
// Compute the packer's exact per-tile ZIP estimates in parallel for a loose
// scene. The normal packer validates this cache's content identity and still
// checks the compressed output against the hard pack-size limit.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { normalizeSourceTiles, planCacheIdentity } from './package-scene-tiles.mjs';

const require = createRequire(import.meta.url);
const { zipSync } = require('fflate');
const mtime = new Date('1980-01-02T00:00:00.000Z');

if (!isMainThread) {
    const entries = [];
    for (const tile of workerData.tiles) {
        const source = fs.readFileSync(path.join(workerData.directory, tile.file));
        const zipped = zipSync({ [tile.file]: [new Uint8Array(source), { mtime }] }, { level: 6 });
        entries.push([tile.key, zipped.length - 22]);
    }
    parentPort.postMessage(entries);
} else {
    const directory = path.resolve(process.argv[2] || '');
    const output = path.resolve(process.argv[3] || '');
    const count = Number(process.argv[4] || 4);
    if (!process.argv[2] || !process.argv[3] || !Number.isInteger(count) || count < 1 || count > 16) {
        throw new Error('Usage: node tools/precompute-scene-size-cache.mjs <loose-directory> <cache-file> [workers]');
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
    if (manifest.terrainDeferred !== false) throw new Error('Scene merge must be complete');
    const tiles = normalizeSourceTiles(manifest);
    if (tiles.some(tile => tile.sourcePack)) throw new Error('Loose scene tiles required');
    const identity = planCacheIdentity(manifest, tiles);
    const groups = Array.from({ length: count }, () => []);
    tiles.forEach((tile, i) => groups[i % count].push(tile));
    const chunks = await Promise.all(groups.map((group, index) => new Promise((resolve, reject) => {
        const worker = new Worker(import.meta.filename, { workerData: { directory, tiles: group } });
        worker.once('message', entries => { console.log(`worker ${index + 1}/${count}: ${entries.length} tiles measured`); resolve(entries); });
        worker.once('error', reject);
        worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
    })));
    const entries = Object.fromEntries(chunks.flat());
    if (Object.keys(entries).length !== tiles.length) throw new Error('Duplicate or missing tile estimate');
    fs.writeFileSync(output, JSON.stringify({ schema: 1, identity, entries }) + '\n');
    console.log(`Measured ${tiles.length} exact tile ZIP sizes into ${output}`);
}
