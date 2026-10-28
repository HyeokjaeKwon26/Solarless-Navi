#!/usr/bin/env node
// Reuse immutable baseline packs and publish only packs containing changed
// tiles. The schema-3 client concatenates baseUrl and path, so each pack path
// names its own release tag. Oversized changed packs are deterministically split.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { stablePackKey, groupBounds } from './package-scene-tiles.mjs';
const require = createRequire(import.meta.url);
const { unzipSync, zipSync } = require('fflate');
const [region, workspaceArg] = process.argv.slice(2);
if (!region || !workspaceArg || !/^us-(northeast|midwest|south|west)$/.test(region)) throw new Error('Expected region and workspace');
const workspace = path.resolve(workspaceArg);
const last = process.env.SCENE_OVERLAY_LAST === 'true';
const followup = last || process.env.SCENE_OVERLAY_FOLLOWUP === 'true';
const incremental = followup || process.env.SCENE_OVERLAY_INCREMENTAL === 'true';
const auditDir = path.join(workspace, `${last ? 'multipolygon-last' : followup ? 'multipolygon-followup' : incremental ? 'multipolygon-recheck' : 'multipolygon'}-${region}`);
const oldDir = path.join(workspace, `build-${region}`, 'release');
const priorDir = path.join(workspace, `multipolygon-${region}`, 'release');
const recheckDir = path.join(workspace, `multipolygon-recheck-${region}`, 'release');
const followupDir = path.join(workspace, `multipolygon-followup-${region}`, 'release');
const changedDir = path.join(auditDir, 'changed-tiles');
const output = path.join(auditDir, 'release');
const baseline = JSON.parse(fs.readFileSync(path.join('data', 'scene', region, 'manifest.json')));
const overlay = JSON.parse(fs.readFileSync(path.join(auditDir, 'overlay-audit.json')));
const assembly = JSON.parse(fs.readFileSync(path.join(auditDir, 'assembly-audit.json')));
const prep = JSON.parse(fs.readFileSync(path.join(auditDir, 'scene-preparation-audit.json')));
const tag = `scene-${region}-hybrid-v3-osm-20261027-multipolygon${incremental ? '-recheck-20261028' : ''}${followup ? '-followup-20261028' : ''}${last ? '-rings-20261028' : ''}`;
const baseTag = baseline.releaseTag;
const originalTag = incremental ? baseline.packaging?.baselineReleaseTag : null;
if (incremental && (!baseline.sourceMetadata?.multipolygon || !originalTag)) throw new Error('Missing multipolygon baseline provenance');
const baselineDirs = new Map();
if (incremental) for (const dir of [oldDir, priorDir, ...(followup ? [recheckDir] : []), ...(last ? [followupDir] : [])]) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
    baselineDirs.set(meta.releaseTag, dir);
}
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const coord = key => { const [x, y] = key.split(':').map(Number); return { x, y }; };
const filename = key => `${key.replace(':', '_')}.json`;
const byKey = new Map();
for (const file of fs.readdirSync(changedDir).filter(f => f.endsWith('.json'))) {
    const match = /^(-?\d+)_(-?\d+)\.json$/.exec(file);
    if (!match) throw new Error(`Invalid changed tile ${file}`);
    const key = `${match[1]}:${match[2]}`;
    if (byKey.has(key) || filename(key) !== file) throw new Error(`Duplicate changed tile ${file}`);
    byKey.set(key, { file, path: path.join(changedDir, file) });
}
if (byKey.size !== overlay.changedExistingTiles + overlay.newTiles) throw new Error('Changed tile count mismatch');
const oldGroups = new Map(), newTiles = [];
for (const [key, entry] of Object.entries(baseline.tiles)) {
    if (!oldGroups.has(entry.pack)) oldGroups.set(entry.pack, []);
    oldGroups.get(entry.pack).push({ key, file: entry.file, ...coord(key) });
}
for (const key of byKey.keys()) if (!baseline.tiles[key]) newTiles.push({ key, file: filename(key), ...coord(key) });
fs.mkdirSync(output, { recursive: true });
const packs = {}, tiles = {}, created = [];
const mtime = new Date('1980-01-02T00:00:00.000Z');
const maxBytes = Number(baseline.maxPackBytes || 10 * 1024 * 1024);
const maxAssets = Number(process.env.SCENE_OVERLAY_MAX_ASSETS || 1000);
if (!Number.isInteger(maxAssets) || maxAssets < 2 || maxAssets > 1000) throw new Error('Invalid release asset limit');
function makePack(group, content) {
    const entries = {};
    for (const item of [...group].sort((a, b) => a.file.localeCompare(b.file))) entries[item.file] = [content.get(item.file), { mtime }];
    const zipped = zipSync(entries, { level: 6 });
    if (zipped.length > maxBytes) {
        if (group.length < 2) throw new Error(`Single tile exceeds maximum ZIP size: ${group[0].key}`);
        const sorted = [...group].sort((a, b) => a.x - b.x || a.y - b.y);
        const middle = Math.floor(sorted.length / 2);
        makePack(sorted.slice(0, middle), content); makePack(sorted.slice(middle), content); return;
    }
    const key = stablePackKey(group), name = `scene-${region}-${key}.zip`;
    if (packs[key]) throw new Error(`Pack key collision: ${key}`);
    fs.writeFileSync(path.join(output, name), zipped);
    packs[key] = { path: `${tag}/${name}`, bytes: zipped.length, sha256: sha(zipped), tiles: group.length,
        density: 'multipolygon-updated', bounds: groupBounds(group) };
    for (const item of group) {
        if (tiles[item.key]) throw new Error(`Duplicate tile ${item.key}`);
        tiles[item.key] = { pack: key, file: item.file };
    }
    created.push(name);
}
let processed = 0, reused = 0;
const resume = process.env.SCENE_OVERLAY_RESUME === 'true';
for (const [key, oldGroup] of oldGroups) {
    const meta = baseline.packs[key];
    if (!meta || oldGroup.length !== meta.tiles) throw new Error(`Bad baseline pack ${key}`);
    if (!oldGroup.some(item => byKey.has(item.key))) {
        packs[key] = { ...meta, path: incremental ? meta.path : `${baseTag}/${meta.path}` };
        for (const item of oldGroup) tiles[item.key] = { pack: key, file: item.file };
        reused++;
    } else if (!resume) {
        let sourceDir = oldDir, sourceName = meta.path;
        if (incremental) {
            const parts = String(meta.path).split('/');
            if (parts.length !== 2 || !baselineDirs.has(parts[0])) throw new Error(`Unexpected baseline pack path ${meta.path}`);
            sourceDir = baselineDirs.get(parts[0]);
            sourceName = parts[1];
        }
        const file = fs.readFileSync(path.join(sourceDir, sourceName));
        if (file.length !== meta.bytes || sha(file) !== meta.sha256) throw new Error(`Baseline pack checksum failed: ${meta.path}`);
        const oldEntries = unzipSync(file), content = new Map();
        for (const item of oldGroup) {
            const changed = byKey.get(item.key);
            const bytes = changed ? fs.readFileSync(changed.path) : oldEntries[item.file];
            if (!bytes) throw new Error(`Missing tile ${item.key}`);
            content.set(item.file, bytes);
        }
        makePack(oldGroup, content);
    }
    if (++processed % 50 === 0) console.log(`processed ${processed}/${oldGroups.size} baseline packs; wrote ${created.length}`);
}
if (!resume) {
    const newGroups = new Map();
    for (const item of newTiles) {
        const key = `${Math.floor(item.x / 8)}:${Math.floor(item.y / 8)}`;
        if (!newGroups.has(key)) newGroups.set(key, []);
        newGroups.get(key).push(item);
    }
    for (const group of newGroups.values()) makePack(group, new Map(group.map(item => [item.file, fs.readFileSync(byKey.get(item.key).path)])));
} else {
    // A previous pass may have completed every ZIP but exceeded the release
    // asset count before it could write its manifest. Reconstruct the mapping
    // from those ZIP entries; final validation still checks every tile/hash.
    for (const name of fs.readdirSync(output).filter(file => file.endsWith('.zip'))) {
        const bytes = fs.readFileSync(path.join(output, name)), entries = unzipSync(bytes), group = [];
        for (const file of Object.keys(entries)) {
            const match = /^(-?\d+)_(-?\d+)\.json$/.exec(file);
            if (!match) throw new Error(`Unexpected recovered tile ${file}`);
            const tileKey = `${match[1]}:${match[2]}`;
            if (tiles[tileKey]) throw new Error(`Duplicate recovered tile ${tileKey}`);
            group.push({ key: tileKey, file, ...coord(tileKey) });
        }
        const key = stablePackKey(group);
        if (name !== `scene-${region}-${key}.zip` || packs[key]) throw new Error(`Unexpected recovered pack ${name}`);
        packs[key] = { path: `${tag}/${name}`, bytes: bytes.length, sha256: sha(bytes), tiles: group.length,
            density: 'multipolygon-updated', bounds: groupBounds(group) };
        for (const item of group) tiles[item.key] = { pack: key, file: item.file };
        created.push(name);
        if (created.length % 100 === 0) console.log(`recovered ${created.length} new packs`);
    }
}
while (created.length + 1 > maxAssets) {
    const byName = new Map(Object.entries(packs).filter(([, p]) => p.path.startsWith(`${tag}/`))
        .map(([key, p]) => [path.posix.basename(p.path), { key, bytes: p.bytes }]));
    const smallest = [...created].sort((a, b) => byName.get(a).bytes - byName.get(b).bytes).slice(0, 2);
    if (smallest.length < 2 || byName.get(smallest[0]).bytes + byName.get(smallest[1]).bytes > maxBytes) {
        throw new Error('Cannot combine packs within release asset limit');
    }
    const oldKeys = new Set(smallest.map(name => byName.get(name).key));
    const group = Object.entries(tiles).filter(([, t]) => oldKeys.has(t.pack))
        .map(([key, t]) => ({ key, file: t.file, ...coord(key) }));
    const content = new Map();
    for (const name of smallest) {
        const entries = unzipSync(fs.readFileSync(path.join(output, name)));
        for (const [file, bytes] of Object.entries(entries)) {
            if (content.has(file)) throw new Error(`Duplicate merged tile ${file}`);
            content.set(file, bytes);
        }
    }
    for (const key of oldKeys) delete packs[key];
    for (const item of group) delete tiles[item.key];
    for (const name of smallest) {
        created.splice(created.indexOf(name), 1);
        fs.unlinkSync(path.join(output, name));
    }
    makePack(group, content);
    console.log(`combined two small packs; ${created.length + 1} release assets remain`);
}
if (Object.keys(tiles).length !== Object.keys(baseline.tiles).length + newTiles.length ||
    Object.keys(baseline.tiles).some(key => !tiles[key]) || newTiles.some(item => !tiles[item.key])) {
    throw new Error('Tile coverage mismatch');
}
const values = Object.values(packs), sizes = values.map(value => value.bytes);
const manifest = { ...baseline, releaseTag: tag,
    baseUrl: 'https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download',
    generatedAt: new Date().toISOString(),
    sourceMetadata: { ...baseline.sourceMetadata, multipolygon: last
        ? { ...baseline.sourceMetadata.multipolygon, remainingRings: { baselineReleaseTag: baseTag,
            method: 'validated disjoint closed outer rings from incomplete relations', assembly, prep, overlay } }
        : followup
        ? { ...baseline.sourceMetadata.multipolygon, followup: { baselineReleaseTag: baseTag,
            method: 'add disjoint untagged components while retaining independently tagged outer ways', assembly, prep, overlay } }
        : incremental
        ? { ...baseline.sourceMetadata.multipolygon, recheck: { baselineReleaseTag: baseTag,
            method: 'conservative re-evaluation of previously excluded building relations', assembly, prep, overlay } }
        : { baselineReleaseTag: baseTag, method: 'validated OSM relations; hole-preserving simple polygon decomposition', assembly, prep, overlay } },
    packaging: { ...baseline.packaging, mode: 'immutable-baseline-plus-updated-packs', maxReleaseAssets: maxAssets,
        baselineReleaseTag: baseTag, baselineReleaseTags: followup ? [baseTag, ...baseline.packaging.baselineReleaseTags] : incremental ? [baseTag, originalTag] : [baseTag],
        reusedBaselinePacks: reused, newlyPublishedPacks: created.length },
    stats: { ...baseline.stats, tileCount: Object.keys(tiles).length, packCount: values.length,
        releaseAssetCount: created.length + 1, totalBytes: sizes.reduce((sum, n) => sum + n, 0),
        minPackBytes: Math.min(...sizes), maxPackBytes: Math.max(...sizes) }, packs, tiles };
delete manifest.manifestHash;
manifest.manifestHash = sha(Buffer.from(JSON.stringify({ ...manifest, generatedAt: null })));
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(auditDir, 'package-audit.json'), JSON.stringify({ region, tag, baseTag,
    reusedPacks: reused, newPacks: created.length, newTiles: newTiles.length,
    referencedPacks: values.length, releaseAssets: created.length + 1, changedTiles: byKey.size }, null, 2));
console.log(JSON.stringify({ region, reusedPacks: reused, newPacks: created.length, newTiles: newTiles.length,
    referencedPacks: values.length, releaseAssets: created.length + 1 }, null, 2));
