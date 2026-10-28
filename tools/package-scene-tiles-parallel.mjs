#!/usr/bin/env node
// Parallel implementation for loose, fully merged scene tiles. Planning,
// manifest construction and final validation use the standard packager.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { configFromEnvironment, planScenePackages, stablePackKey, groupBounds,
    assertTileCoverage, createManifest } from './package-scene-tiles.mjs';

const require = createRequire(import.meta.url);
const { zipSync } = require('fflate');
const mtime = new Date('1980-01-02T00:00:00.000Z');

if (!isMainThread) {
    const done = [];
    for (const { index, key, files } of workerData.jobs) {
        const entries = {};
        for (const file of [...files].sort((a, b) => a.localeCompare(b))) {
            entries[file] = [new Uint8Array(fs.readFileSync(path.join(workerData.inputDir, file))), { mtime }];
        }
        const bytes = zipSync(entries, { level: 6 });
        if (bytes.length > workerData.maxPackBytes) throw new Error(`Pack ${key} exceeds size limit`);
        const name = `scene-${workerData.region}-${key}.zip`;
        fs.writeFileSync(path.join(workerData.stagingDir, name), bytes);
        done.push({ index, key, name, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
        if (done.length % 25 === 0) parentPort.postMessage({ progress: done.length });
    }
    parentPort.postMessage({ done });
} else {
    const count = Number(process.env.SCENE_PACK_WORKERS || 4);
    if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error('SCENE_PACK_WORKERS must be 1–16');
    const config = configFromEnvironment();
    config.progress = true;
    const plan = planScenePackages(config);
    const { groups, sourceManifest, sourceTiles } = plan;
    if (sourceTiles.some(tile => tile.sourcePack)) throw new Error('Parallel packaging requires loose tiles');
    if (groups.length + 1 > config.maxAssets) throw new Error('Too many release assets');
    const stagingDir = `${config.outputDir}.parallel-staging-${process.pid}`;
    fs.mkdirSync(stagingDir, { recursive: true });
    try {
        const jobs = groups.map((group, index) => ({ index, key: stablePackKey(group), files: group.map(tile => tile.file) }));
        const chunks = Array.from({ length: count }, () => []);
        jobs.forEach((job, index) => chunks[index % count].push(job));
        const result = await Promise.all(chunks.map((jobs, workerIndex) => new Promise((resolve, reject) => {
            const worker = new Worker(import.meta.filename, { workerData: { jobs, inputDir: config.sourceTileDir,
                stagingDir, region: config.regionId, maxPackBytes: config.maxPackBytes } });
            worker.on('message', message => {
                if (message.done) resolve(message.done);
                else if (message.progress) console.log(`worker ${workerIndex + 1}/${count}: wrote ${message.progress}/${jobs.length} packs`);
            });
            worker.once('error', reject);
            worker.once('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
        })));
        const packs = {}, tiles = {};
        const records = result.flat().sort((a, b) => a.index - b.index);
        if (records.length !== groups.length) throw new Error('Missing packaged groups');
        for (const record of records) {
            const group = groups[record.index];
            if (record.key !== stablePackKey(group)) throw new Error('Pack identity mismatch');
            packs[record.key] = { path: record.name, bytes: record.bytes, sha256: record.sha256,
                tiles: group.length, density: group.some(tile => tile.dense) ? 'dense-2x2' : 'adaptive-sparse', bounds: groupBounds(group) };
            for (const tile of group) {
                if (tiles[tile.key]) throw new Error(`Duplicate tile ${tile.key}`);
                tiles[tile.key] = { pack: record.key, file: tile.file };
            }
        }
        assertTileCoverage(sourceTiles, tiles);
        const manifest = createManifest(sourceManifest, config, packs, tiles);
        fs.writeFileSync(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        fs.rmSync(config.outputDir, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(config.outputDir), { recursive: true });
        fs.renameSync(stagingDir, config.outputDir);
        fs.mkdirSync(path.dirname(config.trackedManifest), { recursive: true });
        fs.writeFileSync(config.trackedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`created ${groups.length} packs and ${sourceTiles.length} tiles`);
    } catch (error) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw error;
    }
}
