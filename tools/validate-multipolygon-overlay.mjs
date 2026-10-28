#!/usr/bin/env node
// Validate every referenced tile and checksum across a new overlay release and
// its immutable baseline release. The overlay itself contains only new packs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { unzipSync } = require('fflate');
const [region, workspaceArg] = process.argv.slice(2);
if (!region || !workspaceArg || !/^us-(northeast|midwest|south|west)$/.test(region)) throw new Error('Expected region and workspace');
const workspace = path.resolve(workspaceArg);
const last = process.env.SCENE_OVERLAY_LAST === 'true';
const followup = last || process.env.SCENE_OVERLAY_FOLLOWUP === 'true';
const incremental = followup || process.env.SCENE_OVERLAY_INCREMENTAL === 'true';
const audit = path.join(workspace, `${last ? 'multipolygon-last' : followup ? 'multipolygon-followup' : incremental ? 'multipolygon-recheck' : 'multipolygon'}-${region}`);
const output = path.join(audit, 'release'), old = path.join(workspace, `build-${region}`, 'release');
const prior = path.join(workspace, `multipolygon-${region}`, 'release');
const recheck = path.join(workspace, `multipolygon-recheck-${region}`, 'release');
const followupDir = path.join(workspace, `multipolygon-followup-${region}`, 'release');
const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
const oldManifest = JSON.parse(fs.readFileSync(path.join(last ? followupDir : followup ? recheck : incremental ? prior : old, 'manifest.json')));
const originalManifest = incremental ? JSON.parse(fs.readFileSync(path.join(old, 'manifest.json'))) : null;
const previousManifest = followup ? JSON.parse(fs.readFileSync(path.join(prior, 'manifest.json'))) : null;
const recheckManifest = last ? JSON.parse(fs.readFileSync(path.join(recheck, 'manifest.json'))) : null;
const expected = new Map();
for (const [key, tile] of Object.entries(manifest.tiles)) {
    const identity = `${tile.pack}:${tile.file}`;
    if (expected.has(identity)) throw new Error(`Duplicate tile mapping ${identity}`);
    expected.set(identity, key);
}
const seen = new Set(), localNames = new Set(['manifest.json']);
let count = 0, relationPieces = 0;
for (const [key, pack] of Object.entries(manifest.packs)) {
    const parts = String(pack.path).split('/');
    if (parts.length !== 2 || ![manifest.releaseTag, oldManifest.releaseTag, originalManifest?.releaseTag, previousManifest?.releaseTag, recheckManifest?.releaseTag].includes(parts[0]) || parts[1] !== path.basename(parts[1])) {
        throw new Error(`Unexpected pack path ${pack.path}`);
    }
    const directory = parts[0] === manifest.releaseTag ? output : (last && parts[0] === oldManifest.releaseTag ? followupDir : (parts[0] === recheckManifest?.releaseTag || (!last && followup && parts[0] === oldManifest.releaseTag)) ? recheck : (parts[0] === previousManifest?.releaseTag || (!followup && incremental && parts[0] === oldManifest.releaseTag)) ? prior : old);
    if (directory === output) localNames.add(parts[1]);
    const bytes = fs.readFileSync(path.join(directory, parts[1]));
    if (bytes.length !== pack.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== pack.sha256 || bytes.length > manifest.maxPackBytes) {
        throw new Error(`Pack integrity failure ${pack.path}`);
    }
    const entries = unzipSync(bytes);
    if (Object.keys(entries).length !== pack.tiles) throw new Error(`Pack count mismatch ${pack.path}`);
    for (const [file, data] of Object.entries(entries)) {
        const identity = `${key}:${file}`, tileKey = expected.get(identity);
        if (!tileKey || seen.has(tileKey)) throw new Error(`Unexpected or duplicate tile ${identity}`);
        const tile = JSON.parse(Buffer.from(data).toString());
        if (tile.key !== tileKey || tile.terrain.length !== 2601 || !tile.sceneCoverage?.buildingGround) throw new Error(`Incomplete tile ${tileKey}`);
        relationPieces += (tile.buildings || []).filter(b => String(b.id).startsWith('relation/')).length;
        seen.add(tileKey);
    }
    if (++count % 100 === 0) console.log(`validated ${count}/${Object.keys(manifest.packs).length} referenced packs`);
}
const actualNames = new Set(fs.readdirSync(output).filter(name => fs.statSync(path.join(output, name)).isFile()));
if (seen.size !== expected.size || seen.size !== manifest.stats.tileCount || count !== manifest.stats.packCount ||
    localNames.size !== manifest.stats.releaseAssetCount || localNames.size > 1000 ||
    actualNames.size !== localNames.size || [...actualNames].some(name => !localNames.has(name))) {
    throw new Error('Tile or release asset coverage mismatch');
}
const result = { region, tiles: seen.size, referencedPacks: count, releaseAssets: localNames.size, relationPieces,
    baseline: oldManifest.releaseTag, checksums: 'verified', coverage: 'exactly once' };
fs.writeFileSync(path.join(audit, 'validation.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
