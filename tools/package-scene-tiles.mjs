#!/usr/bin/env node
/*
 * Bundle logical 5 km scene tiles into deterministic GitHub Release assets.
 *
 * Adaptive mode keeps the tile grid unchanged, but uses the compressed size of
 * every tile to choose spatially local packs. Sparse cells start as 8x8 blocks;
 * blocks that exceed the target are divided into 4x4, 2x2, and finally smaller
 * groups. Undersized neighboring groups are merged when the result remains
 * within the configured target. This avoids both huge urban assets and tens of
 * thousands of tiny rural assets.
 *
 * The input may be either a build-scene-tiles output directory (loose JSON
 * files plus an array-based manifest) or a downloaded v1 release directory
 * (ZIP assets plus a schema-2 object-based manifest).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { unzipSync, zipSync } = require('fflate');
const ROOT = path.resolve(import.meta.dirname, '..');
const ZIP_END_RECORD_BYTES = 22;
// ZIP's DOS timestamp cannot represent a local time before 1980. Jan 2 stays
// valid even in negative UTC offsets while remaining stable across runs.
const DETERMINISTIC_ZIP_MTIME = new Date('1980-01-02T00:00:00.000Z');
const groupBoundsCache = new WeakMap();
const groupBytesCache = new WeakMap();

function positiveInteger(value, fallback, name) {
    const parsed = Number(value == null || value === '' ? fallback : value);
    if (!Number.isFinite(parsed) || parsed <= 0 || Math.floor(parsed) !== parsed) {
        throw new Error(`${name} must be a positive integer`);
    }
    return parsed;
}

function booleanValue(value, fallback) {
    if (value == null || value === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function configFromEnvironment(env = process.env) {
    const regionId = String(env.SCENE_REGION || 'us-northeast').toLowerCase();
    const releaseTag = String(env.SCENE_RELEASE_TAG || `scene-${regionId}-hybrid-v2`);
    const inputDir = path.resolve(env.SCENE_INPUT_DIR || path.join(ROOT, 'data', 'generated', `scene-${regionId}`));
    const explicitLegacyWidth = env.SCENE_PACK_WIDTH != null && env.SCENE_PACK_WIDTH !== '';
    const adaptive = booleanValue(env.SCENE_ADAPTIVE_PACKING, !explicitLegacyWidth);
    const targetMinBytes = positiveInteger(env.SCENE_MIN_PACK_BYTES, 2 * 1024 * 1024, 'SCENE_MIN_PACK_BYTES');
    const targetBytes = positiveInteger(env.SCENE_TARGET_PACK_BYTES, 7 * 1024 * 1024, 'SCENE_TARGET_PACK_BYTES');
    const targetMaxBytes = positiveInteger(env.SCENE_TARGET_MAX_PACK_BYTES, 8 * 1024 * 1024, 'SCENE_TARGET_MAX_PACK_BYTES');
    const maxPackBytes = positiveInteger(env.SCENE_MAX_PACK_BYTES, 10 * 1024 * 1024, 'SCENE_MAX_PACK_BYTES');
    if (!(targetMinBytes <= targetBytes && targetBytes <= targetMaxBytes && targetMaxBytes <= maxPackBytes)) {
        throw new Error('pack sizes must satisfy min <= target <= target max <= hard max');
    }
    return {
        regionId,
        regionLabel: String(env.SCENE_REGION_LABEL || (regionId === 'ma' ? 'MA' : regionId.toUpperCase())),
        inputDir,
        sourceManifest: path.resolve(env.SCENE_SOURCE_MANIFEST || path.join(inputDir, 'manifest.json')),
        sourceTileDir: path.resolve(env.SCENE_SOURCE_TILE_DIR || inputDir),
        sourceReleaseDir: path.resolve(env.SCENE_SOURCE_RELEASE_DIR || inputDir),
        releaseTag,
        outputDir: path.resolve(env.SCENE_RELEASE_DIR || path.join(ROOT, 'data', 'release', releaseTag)),
        trackedManifest: path.resolve(env.SCENE_TRACKED_MANIFEST || path.join(ROOT, 'data', 'scene', regionId, 'manifest.json')),
        releaseBaseUrl: String(env.SCENE_RELEASE_BASE_URL || `https://github.com/HyeokjaeKwon26/Solarless-Navi/releases/download/${releaseTag}`),
        adaptive,
        legacyPackWidth: positiveInteger(env.SCENE_PACK_WIDTH, 2, 'SCENE_PACK_WIDTH'),
        targetMinBytes,
        targetBytes,
        targetMaxBytes,
        maxPackBytes,
        dense2x2ThresholdBytes: positiveInteger(env.SCENE_DENSE_2X2_BYTES, 512 * 1024, 'SCENE_DENSE_2X2_BYTES'),
        preserveDenseGroups: booleanValue(env.SCENE_PRESERVE_DENSE_GROUPS, true),
        maxAssets: positiveInteger(env.SCENE_MAX_ASSETS, 900, 'SCENE_MAX_ASSETS'),
        maxMergeGapTiles: positiveInteger(env.SCENE_MAX_MERGE_GAP_TILES, 8, 'SCENE_MAX_MERGE_GAP_TILES'),
        maxAdaptivePackSpanTiles: positiveInteger(env.SCENE_MAX_PACK_SPAN_TILES, 8, 'SCENE_MAX_PACK_SPAN_TILES'),
        sourcePackCacheEntries: positiveInteger(env.SCENE_SOURCE_PACK_CACHE_ENTRIES, 1, 'SCENE_SOURCE_PACK_CACHE_ENTRIES'),
        planCache: env.SCENE_PLAN_CACHE === 'false' ? null : path.resolve(env.SCENE_PLAN_CACHE || path.join(path.dirname(path.resolve(env.SCENE_SOURCE_RELEASE_DIR || inputDir)), `scene-${regionId}-compressed-size-cache.json`)),
        dryRun: booleanValue(env.SCENE_DRY_RUN, false),
        dryRunManifest: env.SCENE_DRY_RUN_MANIFEST ? path.resolve(env.SCENE_DRY_RUN_MANIFEST) : null
    };
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function sha256Buffer(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(file) { return sha256Buffer(fs.readFileSync(file)); }
function compareKeys(a, b) {
    const ac = tileCoordinates(a);
    const bc = tileCoordinates(b);
    return ac.x - bc.x || ac.y - bc.y || String(a).localeCompare(String(b));
}

function tileCoordinates(key) {
    const match = String(key).match(/^(-?\d+):(-?\d+)$/);
    if (!match) throw new Error(`invalid scene tile key: ${key}`);
    return { x: Number(match[1]), y: Number(match[2]) };
}

function safeRelativeFile(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
        throw new Error(`unsafe tile path: ${value}`);
    }
    return normalized;
}

function normalizeSourceTiles(sourceManifest) {
    if (Array.isArray(sourceManifest.tiles)) {
        return sourceManifest.tiles.map(tile => ({
            key: String(tile.key),
            file: safeRelativeFile(tile.path || tile.file),
            sourcePack: tile.pack || null
        })).sort((a, b) => compareKeys(a.key, b.key));
    }
    if (sourceManifest.tiles && typeof sourceManifest.tiles === 'object') {
        return Object.entries(sourceManifest.tiles).map(([key, tile]) => ({
            key,
            file: safeRelativeFile(tile.file || tile.path),
            sourcePack: tile.pack || null
        })).sort((a, b) => compareKeys(a.key, b.key));
    }
    throw new Error('source manifest has no tiles');
}

class SourceTileReader {
    constructor(sourceManifest, inputDir, sourceReleaseDir, cacheEntries = 4) {
        this.sourceManifest = sourceManifest;
        this.inputDir = inputDir;
        this.sourceReleaseDir = sourceReleaseDir;
        this.cacheEntries = cacheEntries;
        this.packCache = new Map();
        this.centralDirectoryCache = new Map();
    }

    read(tile) {
        const loosePath = path.resolve(this.inputDir, tile.file);
        if (loosePath.startsWith(`${this.inputDir}${path.sep}`) && fs.existsSync(loosePath)) {
            return new Uint8Array(fs.readFileSync(loosePath));
        }
        if (!tile.sourcePack) throw new Error(`missing loose tile: ${tile.file}`);
        const packMeta = this.sourceManifest.packs && this.sourceManifest.packs[tile.sourcePack];
        if (!packMeta || !packMeta.path) throw new Error(`missing source pack metadata: ${tile.sourcePack}`);
        const pack = this.loadPack(tile.sourcePack, safeRelativeFile(packMeta.path));
        const content = pack[tile.file] || pack[tile.file.replace(/\\/g, '/')];
        if (!content) throw new Error(`tile ${tile.file} is absent from source pack ${tile.sourcePack}`);
        return content;
    }

    estimateZipContribution(tile) {
        if (!tile.sourcePack) return null;
        const packMeta = this.sourceManifest.packs && this.sourceManifest.packs[tile.sourcePack];
        if (!packMeta || !packMeta.path) return null;
        let entries = this.centralDirectoryCache.get(tile.sourcePack);
        if (!entries) {
            const packPath = path.resolve(this.sourceReleaseDir, safeRelativeFile(packMeta.path));
            if (!packPath.startsWith(`${this.sourceReleaseDir}${path.sep}`) || !fs.existsSync(packPath)) return null;
            entries = readZipEntryContributions(packPath);
            this.centralDirectoryCache.clear();
            this.centralDirectoryCache.set(tile.sourcePack, entries);
        }
        return entries.get(tile.file) || null;
    }

    loadPack(key, relativePath) {
        if (this.packCache.has(key)) {
            const value = this.packCache.get(key);
            this.packCache.delete(key);
            this.packCache.set(key, value);
            return value;
        }
        const packPath = path.resolve(this.sourceReleaseDir, relativePath);
        if (!packPath.startsWith(`${this.sourceReleaseDir}${path.sep}`) || !fs.existsSync(packPath)) {
            throw new Error(`source release asset not found: ${relativePath}`);
        }
        const value = unzipSync(new Uint8Array(fs.readFileSync(packPath)));
        this.packCache.set(key, value);
        while (this.packCache.size > this.cacheEntries) this.packCache.delete(this.packCache.keys().next().value);
        return value;
    }
}

function readZipEntryContributions(filePath) {
    const fd = fs.openSync(filePath, 'r');
    const fileBytes = fs.fstatSync(fd).size;
    const tailLength = Math.min(fileBytes, 65557);
    const tail = Buffer.allocUnsafe(tailLength);
    fs.readSync(fd, tail, 0, tailLength, fileBytes - tailLength);
    let endOffset = -1;
    for (let offset = tail.length - ZIP_END_RECORD_BYTES; offset >= 0; offset -= 1) {
        if (tail.readUInt32LE(offset) === 0x06054b50) { endOffset = offset; break; }
    }
    if (endOffset < 0) { fs.closeSync(fd); throw new Error(`ZIP end record not found: ${filePath}`); }
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    const bytes = Buffer.allocUnsafe(centralSize);
    fs.readSync(fd, bytes, 0, centralSize, centralOffset);
    fs.closeSync(fd);
    let offset = 0;
    const result = new Map();
    for (let index = 0; index < entryCount; index += 1) {
        if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error(`invalid ZIP central directory: ${filePath}`);
        const compressedSize = bytes.readUInt32LE(offset + 20);
        const fileNameLength = bytes.readUInt16LE(offset + 28);
        const extraLength = bytes.readUInt16LE(offset + 30);
        const commentLength = bytes.readUInt16LE(offset + 32);
        const fileName = bytes.subarray(offset + 46, offset + 46 + fileNameLength).toString('utf8');
        // The v2 writer emits no per-entry extras/comments. Deflate output is
        // independent of timestamps, so an existing level-6 v1 asset gives an
        // exact compressed payload estimate without inflating/recompressing
        // 1.6+ GiB solely to plan the groups.
        result.set(fileName, compressedSize + 76 + fileNameLength * 2);
        offset += 46 + fileNameLength + extraLength + commentLength;
    }
    return result;
}

function estimatedGroupBytes(tiles) {
    if (groupBytesCache.has(tiles)) return groupBytesCache.get(tiles);
    const value = ZIP_END_RECORD_BYTES + tiles.reduce((sum, tile) => sum + tile.zipContributionBytes, 0);
    groupBytesCache.set(tiles, value);
    return value;
}

function planCacheIdentity(sourceManifest, tiles) {
    const packs = Object.entries(sourceManifest.packs || {}).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [
        key, value && value.path || null, value && value.bytes || null, value && value.sha256 || null
    ]);
    const source = {
        algorithm: 'fflate-level6-entry-contribution-v1',
        schema: sourceManifest.schema || null,
        schemaVersion: sourceManifest.schemaVersion || null,
        dataVersion: sourceManifest.dataVersion || null,
        releaseTag: sourceManifest.releaseTag || null,
        tiles: tiles.map(tile => [tile.key, tile.file, tile.sourcePack]),
        packs
    };
    return sha256Buffer(Buffer.from(JSON.stringify(source)));
}

function readPlanCache(file, identity) {
    if (!file || !fs.existsSync(file)) return null;
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value && value.schema === 1 && value.identity === identity && value.entries && typeof value.entries === 'object'
            ? value.entries : null;
    } catch (_error) {
        return null;
    }
}

function writePlanCache(file, identity, tiles) {
    if (!file) return;
    const entries = Object.fromEntries(tiles.map(tile => [tile.key, tile.zipContributionBytes]));
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, `${JSON.stringify({ schema: 1, identity, entries })}\n`);
}

function enrichTileEstimates(tiles, reader, progress, cachedEntries) {
    // A v1 source can contain hundreds of ZIPs. Read one source pack at a time
    // so repacking does not repeatedly inflate the same asset or retain the
    // entire regional data set in memory.
    const sourceOrdered = [...tiles].sort((a, b) =>
        String(a.sourcePack || '').localeCompare(String(b.sourcePack || '')) ||
        String(a.file).localeCompare(String(b.file)));
    return sourceOrdered.map((tile, index) => {
        const cachedContribution = Number(cachedEntries && cachedEntries[tile.key]);
        const existingContribution = Number.isSafeInteger(cachedContribution) && cachedContribution > 0
            ? cachedContribution : reader.estimateZipContribution(tile);
        const singleZip = existingContribution == null ? zipSync({
            [tile.file]: [reader.read(tile), { mtime: DETERMINISTIC_ZIP_MTIME }]
        }, { level: 6 }) : null;
        if (progress && ((index + 1) % 500 === 0 || index + 1 === sourceOrdered.length)) {
            progress(`measured ${index + 1}/${sourceOrdered.length} tile compression sizes`);
        }
        return {
            ...tile,
            ...tileCoordinates(tile.key),
            zipContributionBytes: Math.max(1, existingContribution == null
                ? singleZip.length - ZIP_END_RECORD_BYTES : existingContribution)
        };
    }).sort((a, b) => compareKeys(a.key, b.key));
}

function groupBounds(tiles) {
    if (groupBoundsCache.has(tiles)) return groupBoundsCache.get(tiles);
    const value = tiles.reduce((bounds, tile) => ({
        minX: Math.min(bounds.minX, tile.x), maxX: Math.max(bounds.maxX, tile.x),
        minY: Math.min(bounds.minY, tile.y), maxY: Math.max(bounds.maxY, tile.y)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    groupBoundsCache.set(tiles, value);
    return value;
}

function groupDistance(a, b) {
    const aa = groupBounds(a);
    const bb = groupBounds(b);
    const dx = Math.max(0, aa.minX - bb.maxX - 1, bb.minX - aa.maxX - 1);
    const dy = Math.max(0, aa.minY - bb.maxY - 1, bb.minY - aa.maxY - 1);
    return Math.hypot(dx, dy);
}

function combinedGroupSpan(a, b) {
    const aa = groupBounds(a);
    const bb = groupBounds(b);
    return {
        x: Math.max(aa.maxX, bb.maxX) - Math.min(aa.minX, bb.minX) + 1,
        y: Math.max(aa.maxY, bb.maxY) - Math.min(aa.minY, bb.minY) + 1
    };
}

function groupSort(a, b) {
    const aa = groupBounds(a);
    const bb = groupBounds(b);
    return aa.minX - bb.minX || aa.minY - bb.minY || aa.maxX - bb.maxX || aa.maxY - bb.maxY;
}

function partitionByWidth(tiles, width) {
    const buckets = new Map();
    for (const tile of tiles) {
        const key = `${Math.floor(tile.x / width)}:${Math.floor(tile.y / width)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(tile);
    }
    return [...buckets.values()].map(group => group.sort((a, b) => compareKeys(a.key, b.key))).sort(groupSort);
}

function splitSpatially(tiles) {
    const bounds = groupBounds(tiles);
    const axis = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 'x' : 'y';
    const secondary = axis === 'x' ? 'y' : 'x';
    const sorted = [...tiles].sort((a, b) => a[axis] - b[axis] || a[secondary] - b[secondary] || compareKeys(a.key, b.key));
    const midpoint = Math.ceil(sorted.length / 2);
    return [sorted.slice(0, midpoint), sorted.slice(midpoint)].filter(group => group.length);
}

function divideOversizedGroup(tiles, targetMaxBytes) {
    const queue = [tiles];
    const result = [];
    while (queue.length) {
        const group = queue.shift();
        if (estimatedGroupBytes(group) <= targetMaxBytes || group.length === 1) {
            result.push(group);
            continue;
        }
        const bounds = groupBounds(group);
        const span = Math.max(bounds.maxX - bounds.minX + 1, bounds.maxY - bounds.minY + 1);
        const nextWidth = span > 4 ? 4 : span > 2 ? 2 : 1;
        const partitioned = nextWidth > 1 ? partitionByWidth(group, nextWidth) : splitSpatially(group);
        if (partitioned.length < 2) queue.unshift(...splitSpatially(group));
        else queue.unshift(...partitioned);
    }
    return result.sort(groupSort);
}

function mergeGroups(groups, options, hardLimitMode = false, stopAt = 0) {
    const limit = hardLimitMode ? options.maxPackBytes : options.targetMaxBytes;
    const desired = hardLimitMode ? limit : options.targetBytes;
    const remaining = [...groups].sort(groupSort);
    let changed = true;
    while (changed && (!stopAt || remaining.length > stopAt)) {
        changed = false;
        let best = null;
        for (let i = 0; i < remaining.length; i += 1) {
            const leftBytes = estimatedGroupBytes(remaining[i]);
            if (options.preserveDenseGroups && remaining[i].some(tile => tile.dense)) continue;
            // Aim for the configured 6-8 MiB band. The lower 2 MiB threshold
            // remains a best-effort floor for isolated geographic fragments,
            // not the point where merging should normally stop.
            if (!hardLimitMode && leftBytes >= options.targetBytes) continue;
            for (let j = i + 1; j < remaining.length; j += 1) {
                if (options.preserveDenseGroups && remaining[j].some(tile => tile.dense)) continue;
                const distance = groupDistance(remaining[i], remaining[j]);
                if (!hardLimitMode && distance > options.maxMergeGapTiles) continue;
                if (!hardLimitMode) {
                    const span = combinedGroupSpan(remaining[i], remaining[j]);
                    if (span.x > options.maxAdaptivePackSpanTiles || span.y > options.maxAdaptivePackSpanTiles) continue;
                }
                const combinedBytes = estimatedGroupBytes(remaining[i]) + estimatedGroupBytes(remaining[j]) - ZIP_END_RECORD_BYTES;
                if (combinedBytes > limit) continue;
                const score = [distance, Math.abs(desired - combinedBytes), i, j];
                if (!best || score.some((value, index) => value < best.score[index] && score.slice(0, index).every((prior, priorIndex) => prior === best.score[priorIndex]))) {
                    best = { i, j, score };
                }
            }
        }
        if (best) {
            const merged = [...remaining[best.i], ...remaining[best.j]].sort((a, b) => compareKeys(a.key, b.key));
            remaining.splice(best.j, 1);
            remaining.splice(best.i, 1, merged);
            remaining.sort(groupSort);
            changed = true;
        }
    }
    return remaining;
}

function mergeSparseGroupsToCount(groups, options, targetCount) {
    const dense = groups.filter(group => options.preserveDenseGroups && group.some(tile => tile.dense));
    const sparseTarget = targetCount - dense.length;
    if (sparseTarget < 0) return groups;
    const sparse = groups.filter(group => !(options.preserveDenseGroups && group.some(tile => tile.dense)));
    while (sparse.length > sparseTarget) {
        sparse.sort(groupSort);
        let best = null;
        // Nearby-window search avoids the cubic all-pairs behavior on 40k+
        // tile regions while retaining geographic locality in ordinary cases.
        for (let i = 0; i < sparse.length; i += 1) {
            const upper = Math.min(sparse.length, i + 65);
            for (let j = i + 1; j < upper; j += 1) {
                const combinedBytes = estimatedGroupBytes(sparse[i]) + estimatedGroupBytes(sparse[j]) - ZIP_END_RECORD_BYTES;
                if (combinedBytes > options.maxPackBytes) continue;
                const score = [groupDistance(sparse[i], sparse[j]), Math.abs(options.maxPackBytes - combinedBytes), i, j];
                if (!best || score.some((value, index) => value < best.score[index] && score.slice(0, index).every((prior, priorIndex) => prior === best.score[priorIndex]))) {
                    best = { i, j, score };
                }
            }
        }
        if (!best) {
            // If no geographically nearby pair fits, the two smallest groups
            // are the only useful deterministic fallback. Dense 2x2 groups
            // are never included in this fallback.
            const bySize = sparse.map((group, index) => ({ group, index, bytes: estimatedGroupBytes(group) }))
                .sort((a, b) => a.bytes - b.bytes || groupSort(a.group, b.group));
            if (bySize.length < 2 || bySize[0].bytes + bySize[1].bytes - ZIP_END_RECORD_BYTES > options.maxPackBytes) break;
            best = { i: Math.min(bySize[0].index, bySize[1].index), j: Math.max(bySize[0].index, bySize[1].index) };
        }
        const merged = [...sparse[best.i], ...sparse[best.j]].sort((a, b) => compareKeys(a.key, b.key));
        sparse.splice(best.j, 1);
        sparse.splice(best.i, 1, merged);
    }
    return [...sparse, ...dense].sort(groupSort);
}

function fixedGroups(tiles, width) {
    return partitionByWidth(tiles, width);
}

export function planAdaptiveGroups(tiles, options) {
    for (const tile of tiles) {
        if (estimatedGroupBytes([tile]) > options.maxPackBytes) {
            throw new Error(`single tile exceeds SCENE_MAX_PACK_BYTES: ${tile.key} (${estimatedGroupBytes([tile])} bytes)`);
        }
    }
    const denseThreshold = Number(options.dense2x2ThresholdBytes) || 512 * 1024;
    const denseGroups = [];
    const sparseTiles = [];
    for (const block of partitionByWidth(tiles, 2)) {
        if (estimatedGroupBytes(block) >= denseThreshold) {
            for (const tile of block) tile.dense = true;
            denseGroups.push(...divideOversizedGroup(block, options.targetMaxBytes));
        } else {
            sparseTiles.push(...block);
        }
    }
    let groups = partitionByWidth(sparseTiles, 8)
        .flatMap(group => divideOversizedGroup(group, options.targetMaxBytes));
    const seedGroups = new Map();
    for (const group of groups) {
        const bounds = groupBounds(group);
        const seed = `${Math.floor(bounds.minX / 8)}:${Math.floor(bounds.minY / 8)}`;
        if (!seedGroups.has(seed)) seedGroups.set(seed, []);
        seedGroups.get(seed).push(group);
    }
    groups = [...seedGroups.values()].flatMap(seed => mergeGroups(seed, options, false));
    groups.push(...denseGroups);
    groups.sort(groupSort);
    const maximumPackAssets = options.maxAssets - 1; // reserve one Release asset for manifest.json
    if (maximumPackAssets < 1) throw new Error('SCENE_MAX_ASSETS must leave room for manifest.json');
    if (groups.length > maximumPackAssets) groups = mergeSparseGroupsToCount(groups, options, maximumPackAssets);
    if (groups.length > maximumPackAssets) {
        throw new Error(`cannot fit ${groups.length} packs plus manifest into SCENE_MAX_ASSETS=${options.maxAssets}`);
    }
    return groups.sort(groupSort);
}

function stablePackKey(group) {
    const bounds = groupBounds(group);
    const identity = group.map(tile => tile.key).sort(compareKeys).join('|');
    const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 10);
    return `${bounds.minX}_${bounds.minY}-${bounds.maxX}_${bounds.maxY}-${digest}`;
}

function zipTileList(reader, tileList) {
    const entries = {};
    for (const tile of [...tileList].sort((a, b) =>
        String(a.sourcePack || '').localeCompare(String(b.sourcePack || '')) ||
        String(a.file).localeCompare(String(b.file)))) {
        entries[tile.file] = [reader.read(tile), { mtime: DETERMINISTIC_ZIP_MTIME }];
    }
    return zipSync(entries, { level: 6 });
}

function assertTileCoverage(sourceTiles, outputTiles) {
    const sourceKeys = sourceTiles.map(tile => tile.key).sort(compareKeys);
    const outputKeys = Object.keys(outputTiles).sort(compareKeys);
    if (sourceKeys.length !== new Set(sourceKeys).size) throw new Error('source manifest contains duplicate tile keys');
    if (sourceKeys.length !== outputKeys.length || sourceKeys.some((key, index) => key !== outputKeys[index])) {
        throw new Error('packaging did not preserve every logical tile exactly once');
    }
}

function createManifest(sourceManifest, config, packs, tiles) {
    const packValues = Object.values(packs);
    const manifest = {
        schema: 2,
        region: config.regionLabel,
        releaseTag: config.releaseTag,
        baseUrl: config.releaseBaseUrl,
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
        packWidth: config.adaptive ? null : config.legacyPackWidth,
        maxPackBytes: config.maxPackBytes,
        profileResolution: sourceManifest.profileResolution || null,
        dataVersion: sourceManifest.dataVersion || null,
        bounds: sourceManifest.bounds || null,
        packaging: {
            mode: config.adaptive ? 'adaptive-compressed-size-v2' : 'fixed-grid',
            logicalTileSizeM: sourceManifest.tileSizeM,
            sparseSeedWidth: config.adaptive ? 8 : config.legacyPackWidth,
            normalSeedWidth: config.adaptive ? 4 : config.legacyPackWidth,
            denseSeedWidth: config.adaptive ? 2 : config.legacyPackWidth,
            targetMinBytes: config.targetMinBytes,
            targetBytes: config.targetBytes,
            targetMaxBytes: config.targetMaxBytes,
            hardMaxBytes: config.maxPackBytes,
            dense2x2ThresholdBytes: config.dense2x2ThresholdBytes,
            preserveDenseGroups: config.preserveDenseGroups,
            maxAdaptivePackSpanTiles: config.maxAdaptivePackSpanTiles,
            maxReleaseAssets: config.maxAssets
        },
        stats: {
            tileCount: Object.keys(tiles).length,
            packCount: packValues.length,
            releaseAssetCount: packValues.length + 1,
            totalBytes: packValues.reduce((sum, pack) => sum + Number(pack.bytes || 0), 0),
            minPackBytes: packValues.length ? Math.min(...packValues.map(pack => Number(pack.bytes || 0))) : 0,
            maxPackBytes: packValues.length ? Math.max(...packValues.map(pack => Number(pack.bytes || 0))) : 0
        },
        packs,
        tiles
    };
    const hashInput = JSON.stringify({ ...manifest, generatedAt: null });
    manifest.manifestHash = sha256Buffer(Buffer.from(hashInput));
    return manifest;
}

export function packageSceneTiles(config = configFromEnvironment()) {
    const plan = planScenePackages(config);
    const { sourceManifest, sourceTiles, reader, groups } = plan;
    if (groups.length + 1 > config.maxAssets) {
        throw new Error(`packaging needs ${groups.length + 1} Release assets; maximum is ${config.maxAssets}`);
    }

    const stagingDir = `${config.outputDir}.staging-${process.pid}`;
    fs.rmSync(stagingDir, { recursive: true, force: true });
    ensureDir(stagingDir);
    const packs = {};
    const tiles = {};
    try {
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
            const group = groups[groupIndex];
            const pack = stablePackKey(group);
            const zipped = zipTileList(reader, group);
            if (zipped.length > config.maxPackBytes) {
                throw new Error(`pack exceeds SCENE_MAX_PACK_BYTES after compression: ${pack} (${zipped.length} bytes)`);
            }
            const fileName = `scene-${config.regionId}-${pack}.zip`;
            const filePath = path.join(stagingDir, fileName);
            fs.writeFileSync(filePath, zipped);
            packs[pack] = {
                path: fileName,
                bytes: zipped.length,
                sha256: sha256File(filePath),
                tiles: group.length,
                density: group.some(tile => tile.dense) ? 'dense-2x2' : 'adaptive-sparse',
                bounds: groupBounds(group)
            };
            for (const tile of group) {
                if (tiles[tile.key]) throw new Error(`tile was assigned more than once: ${tile.key}`);
                tiles[tile.key] = { pack, file: tile.file };
            }
            if (plan.progress && ((groupIndex + 1) % 10 === 0 || groupIndex + 1 === groups.length)) {
                plan.progress(`wrote ${groupIndex + 1}/${groups.length} release packs`);
            }
        }
        assertTileCoverage(sourceTiles, tiles);
        const manifest = createManifest(sourceManifest, config, packs, tiles);
        fs.writeFileSync(path.join(stagingDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        fs.rmSync(config.outputDir, { recursive: true, force: true });
        ensureDir(path.dirname(config.outputDir));
        fs.renameSync(stagingDir, config.outputDir);
        ensureDir(path.dirname(config.trackedManifest));
        fs.writeFileSync(config.trackedManifest, `${JSON.stringify(manifest, null, 2)}\n`);
        return manifest;
    } catch (error) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw error;
    }
}

export function planScenePackages(config = configFromEnvironment()) {
    const sourceManifestPath = config.sourceManifest || path.join(config.inputDir, 'manifest.json');
    const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
    const sourceTiles = normalizeSourceTiles(sourceManifest);
    const reader = new SourceTileReader(sourceManifest, config.sourceTileDir || config.inputDir, config.sourceReleaseDir, config.sourcePackCacheEntries);
    const progress = config.progress ? message => console.log(`[scene-package] ${message}`) : null;
    const cacheIdentity = planCacheIdentity(sourceManifest, sourceTiles);
    const cachedEntries = readPlanCache(config.planCache, cacheIdentity);
    if (progress && cachedEntries) progress(`loaded compressed-size cache: ${config.planCache}`);
    const estimatedTiles = enrichTileEstimates(sourceTiles, reader, progress, cachedEntries);
    if (config.planCache && (!cachedEntries || estimatedTiles.some(tile => Number(cachedEntries[tile.key]) !== tile.zipContributionBytes))) {
        writePlanCache(config.planCache, cacheIdentity, estimatedTiles);
        if (progress) progress(`wrote compressed-size cache: ${config.planCache}`);
    }
    const groups = config.adaptive
        ? planAdaptiveGroups(estimatedTiles, config)
        : fixedGroups(estimatedTiles, config.legacyPackWidth).flatMap(group => divideOversizedGroup(group, config.maxPackBytes));
    return { sourceManifest, sourceTiles, reader, estimatedTiles, groups, progress };
}

function createDryRunManifest(plan, config) {
    const packs = {};
    const tiles = {};
    for (const group of plan.groups) {
        const pack = stablePackKey(group);
        packs[pack] = {
            path: `scene-${config.regionId}-${pack}.zip`,
            bytes: estimatedGroupBytes(group),
            sha256: null,
            tiles: group.length,
            density: group.some(tile => tile.dense) ? 'dense-2x2' : 'adaptive-sparse',
            bounds: groupBounds(group)
        };
        for (const tile of group) {
            if (tiles[tile.key]) throw new Error(`tile was assigned more than once: ${tile.key}`);
            tiles[tile.key] = { pack, file: tile.file };
        }
    }
    assertTileCoverage(plan.sourceTiles, tiles);
    return createManifest(plan.sourceManifest, config, packs, tiles);
}

function main() {
    const config = configFromEnvironment();
    config.progress = true;
    const manifest = config.dryRun
        ? createDryRunManifest(planScenePackages(config), config)
        : packageSceneTiles(config);
    if (config.dryRunManifest) {
        ensureDir(path.dirname(config.dryRunManifest));
        fs.writeFileSync(config.dryRunManifest, `${JSON.stringify(manifest, null, 2)}\n`);
    }
    if (config.dryRun) console.log('dry-run only; no ZIP assets were written');
    console.log(`created ${manifest.stats.packCount} release packs and ${manifest.stats.tileCount} tile entries`);
    console.log(`release assets: ${manifest.stats.releaseAssetCount}/${config.maxAssets}; total ${(manifest.stats.totalBytes / 1048576).toFixed(2)} MiB`);
    console.log(`pack sizes: ${(manifest.stats.minPackBytes / 1048576).toFixed(2)}-${(manifest.stats.maxPackBytes / 1048576).toFixed(2)} MiB`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) main();

export { configFromEnvironment, createDryRunManifest, normalizeSourceTiles, planCacheIdentity, stablePackKey };
