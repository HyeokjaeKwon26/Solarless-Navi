#!/usr/bin/env node
/*
 * Build static regional scene tiles from a Geofabrik OSM PBF extract and
 * SRTM HGT elevation files.  This is an offline preprocessing tool; the app
 * never runs it and never needs the raw source files.
 *
 * The generated JSON tiles contain OSM buildings/tunnels, a conservative
 * building ground elevation, and a 100 m terrain grid.  SceneShadow performs
 * the time-dependent sun-ray calculation at runtime.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parseOSM = require('osm-pbf-parser');

const ROOT = path.resolve(import.meta.dirname, '..');
const REGION_ID = String(process.env.SCENE_REGION || 'us-northeast').toLowerCase();
const REGION_LABEL = String(process.env.SCENE_REGION_LABEL || (REGION_ID === 'ma' ? 'MA' : REGION_ID.toUpperCase()));
const SOURCE_DIR = path.resolve(process.env.SCENE_SOURCE_DIR || path.join(ROOT, 'data', 'source'));
const WORK_DIR = path.resolve(process.env.SCENE_WORK_DIR || path.join(ROOT, 'data', 'work', `scene-${REGION_ID}`));
const OUTPUT_DIR = path.resolve(process.env.SCENE_OUTPUT_DIR || path.join(ROOT, 'data', 'generated', `scene-${REGION_ID}`));

const EARTH_RADIUS = 6371000;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const TILE_SIZE_M = 5000;
const MAX_SHADOW_RAY_DISTANCE_METERS = 4500;
const GRID_LAT_ORIGIN = Number(process.env.SCENE_GRID_LAT_ORIGIN || (REGION_ID === 'ma' ? 41 : 38));
const GRID_LNG_ORIGIN = Number(process.env.SCENE_GRID_LNG_ORIGIN || (REGION_ID === 'ma' ? -74 : -81));
const GRID_COS_LAT = Number(process.env.SCENE_GRID_COS_LAT || Math.cos((REGION_ID === 'ma' ? 42 : 43) * RAD));
const TERRAIN_SPACING_M = 100;
const NODE_RECORD_SIZE = 16; // uint64 id + int32 latitude/lng at 1e-7 degree
const PBF_PATH = path.resolve(process.env.SCENE_PBF_PATH || path.join(SOURCE_DIR, REGION_ID === 'ma' ? 'massachusetts-latest.osm.pbf' : `${REGION_ID}-latest.osm.pbf`));
// Large-region pass 2 performs random node lookups while writing thousands of
// line shards. Allow the immutable node index to live on a separate physical
// disk so those I/O patterns do not contend on one drive.
const NODE_INDEX_PATH = path.resolve(process.env.SCENE_NODE_INDEX_PATH || path.join(WORK_DIR, 'nodes.bin'));
const NODE_INDEX_METADATA_PATH = `${NODE_INDEX_PATH}.meta.json`;
const HGT_DIR = path.resolve(process.env.SCENE_HGT_DIR || path.join(SOURCE_DIR, 'hgt'));
const POLY_PATH = path.resolve(process.env.SCENE_POLY_PATH || path.join(SOURCE_DIR, `${REGION_ID}.poly`));
const PROFILE_AZIMUTH_DEG = Math.max(1, Number(process.env.SCENE_PROFILE_AZIMUTH_DEG || 10));
const PROFILE_SAMPLE_SPACING_M = Math.max(25, Number(process.env.SCENE_PROFILE_SAMPLE_SPACING_M || 100));
const SCENE_SCHEMA_VERSION = Math.max(3, Number(process.env.SCENE_SCHEMA_VERSION || 3));
const DATA_VERSION = String(process.env.SCENE_DATA_VERSION || 'hybrid-scene-v3');
// SRTM mission specification: relative vertical error <=10 m at 90%.
// This is a dataset-level bound, not a per-pixel Gaussian standard deviation.
const TERRAIN_RELATIVE_VERTICAL_ERROR_M = Math.max(0, Number(process.env.SCENE_TERRAIN_RELATIVE_ERROR_M || 10));
const OSM_SOURCE_URL = process.env.SCENE_OSM_SOURCE_URL || null;
const OSM_EXTRACT_TIMESTAMP = process.env.SCENE_OSM_EXTRACT_TIMESTAMP || null;
const OSM_SOURCE_METADATA_PATH = process.env.SCENE_OSM_SOURCE_METADATA || null;
const DEM_DATASET = String(process.env.SCENE_DEM_DATASET || 'SRTM 1 arc-second public elevation tiles');
const DEM_DATASET_VERSION = process.env.SCENE_DEM_DATASET_VERSION || null;
// Regional tile emission can take hours. An interrupted write pass may be
// resumed, but only after every existing tile is parsed and matched against
// the immutable inputs/configuration that determine its payload.
const RESUME_WRITE_TILES = String(process.env.SCENE_RESUME_WRITE_TILES || '').toLowerCase() === 'true';
const DELETE_LOCAL_NODE_INDEX_AFTER_COLLECT = String(process.env.SCENE_DELETE_NODE_INDEX_AFTER_COLLECT || '').toLowerCase() === 'true';
// Restoring every road node in a large regional PBF is needlessly expensive. For larger
// regions the app already computes route tile keys at runtime, so precompute
// only scene geometry unless explicitly requested.
const INCLUDE_ROAD_COVERAGE = String(process.env.SCENE_INCLUDE_ROADS || (REGION_ID === 'ma' ? 'true' : 'false')).toLowerCase() === 'true';

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readBoundsFromPoly(file) {
    if (!fs.existsSync(file)) return null;
    const bounds = { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity };
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.trim().match(/^(-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[Ee][+-]?\d+)?)/);
        if (!match) continue;
        const lng = Number(match[1]);
        const lat = Number(match[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        bounds.south = Math.min(bounds.south, lat);
        bounds.west = Math.min(bounds.west, lng);
        bounds.north = Math.max(bounds.north, lat);
        bounds.east = Math.max(bounds.east, lng);
    }
    return Number.isFinite(bounds.south) ? bounds : null;
}

const REGION_BOUNDS = readBoundsFromPoly(POLY_PATH);

let cachedSourceMetadata = null;
function sourceMetadata() {
    if (cachedSourceMetadata) return cachedSourceMetadata;
    const pbf = fs.existsSync(PBF_PATH) ? fs.statSync(PBF_PATH) : null;
    const hgtCount = fs.existsSync(HGT_DIR)
        ? fs.readdirSync(HGT_DIR).filter(name => /\.hgt(?:\.gz)?$/i.test(name)).length
        : 0;
    let pbfSha256 = null;
    if (pbf) {
        const hash = crypto.createHash('sha256');
        const fd = fs.openSync(PBF_PATH, 'r');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        try {
            let bytesRead = 0;
            do {
                bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
                if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
            } while (bytesRead);
            pbfSha256 = hash.digest('hex');
        } finally { fs.closeSync(fd); }
    }
    let verifiedExtractTimestamp = OSM_EXTRACT_TIMESTAMP;
    if (!verifiedExtractTimestamp && OSM_SOURCE_METADATA_PATH && fs.existsSync(OSM_SOURCE_METADATA_PATH)) {
        try {
            const source = JSON.parse(fs.readFileSync(OSM_SOURCE_METADATA_PATH, 'utf8'));
            verifiedExtractTimestamp = source.extractTimestamp || source.osmExtractTimestamp || null;
        } catch (error) {
            verifiedExtractTimestamp = null;
        }
    }
    cachedSourceMetadata = {
        osm: {
            extract: path.basename(PBF_PATH),
            bytes: pbf ? pbf.size : null,
            extractTimestamp: verifiedExtractTimestamp,
            localFileModifiedAt: pbf ? pbf.mtime.toISOString() : null,
            sourceUrl: OSM_SOURCE_URL,
            pbfSha256,
            license: 'ODbL / OpenStreetMap contributors'
        },
        boundary: fs.existsSync(POLY_PATH) ? path.basename(POLY_PATH) : null,
        terrain: { dataset: DEM_DATASET, datasetVersion: DEM_DATASET_VERSION, tileCount: hgtCount }
    };
    return cachedSourceMetadata;
}

function finite(value) {
    return Number.isFinite(Number(value));
}

function projectGrid(lat, lng) {
    return {
        x: (Number(lng) - GRID_LNG_ORIGIN) * RAD * EARTH_RADIUS * GRID_COS_LAT,
        y: (Number(lat) - GRID_LAT_ORIGIN) * RAD * EARTH_RADIUS
    };
}

function unprojectGrid(x, y) {
    return {
        lat: GRID_LAT_ORIGIN + Number(y) / EARTH_RADIUS * DEG,
        lng: GRID_LNG_ORIGIN + Number(x) / (EARTH_RADIUS * GRID_COS_LAT) * DEG
    };
}

function tileKeyForCoordinate(lat, lng) {
    const point = projectGrid(lat, lng);
    return `${Math.floor(point.x / TILE_SIZE_M)}:${Math.floor(point.y / TILE_SIZE_M)}`;
}

function parseTileKey(key) {
    const [x, y] = String(key).split(':').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`invalid tile key: ${key}`);
    return { x, y };
}

function tileBounds(key) {
    const { x, y } = parseTileKey(key);
    const sw = unprojectGrid(x * TILE_SIZE_M, y * TILE_SIZE_M);
    const ne = unprojectGrid((x + 1) * TILE_SIZE_M, (y + 1) * TILE_SIZE_M);
    return { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng };
}

function parseOsmLengthMeters(value) {
    const text = String(value || '').replace(',', '.').trim();
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const feetInches = text.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(\d+(?:\.\d+)?)?\s*(?:in|inch|inches|")?/i);
    let meters = feetInches
        ? Number(feetInches[1]) * 0.3048 + Number(feetInches[2] || 0) * 0.0254
        : Number(match[0]);
    if (!feetInches && (/\b(?:ft|feet|foot)\b|'/i.test(text))) meters *= 0.3048;
    else if (!feetInches && (/\b(?:in|inch|inches)\b|"/i.test(text))) meters *= 0.0254;
    return Number.isFinite(meters) ? Number(meters.toFixed(3)) : null;
}

function parseMinHeightModel(tags = {}) {
    const explicit = parseOsmLengthMeters(tags.min_height);
    if (Number.isFinite(explicit) && explicit >= 0) {
        return { nominal: explicit, lower: explicit, upper: explicit, source: 'osm-min-height' };
    }
    const match = String(tags['building:min_level'] || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
    if (match) {
        const levels = Number(match[0]);
        return {
            nominal: Number((levels * 3.2).toFixed(3)),
            lower: Number((levels * 3.0).toFixed(3)),
            upper: Number((levels * 4.5).toFixed(3)),
            source: 'osm-building-min-level'
        };
    }
    return { nominal: 0, lower: 0, upper: 0, source: 'ground' };
}

function normalizeMinHeightEnvelope(minHeight = {}, topHeight = {}) {
    const topNominal = Math.max(0, Number(topHeight.nominal) || 0);
    const topLower = Math.max(0, Number(topHeight.lower) || topNominal);
    const topUpper = Math.max(0, Number(topHeight.upper) || topNominal);
    const original = {
        nominal: Math.max(0, Number(minHeight.nominal) || 0),
        lower: Math.max(0, Number(minHeight.lower) || 0),
        upper: Math.max(0, Number(minHeight.upper) || 0)
    };
    const normalized = {
        nominal: Math.min(original.nominal, topNominal),
        lower: Math.min(original.lower, topLower),
        upper: Math.min(original.upper, topUpper)
    };
    const adjusted = normalized.nominal !== original.nominal
        || normalized.lower !== original.lower
        || normalized.upper !== original.upper;
    return {
        ...normalized,
        source: adjusted
            ? `${String(minHeight.source || 'unknown')}-clamped-to-height`
            : String(minHeight.source || 'ground'),
        adjusted
    };
}

function parseHeightModel(tags = {}) {
    const minHeight = parseMinHeightModel(tags);
    const heightText = String(tags.height || '').replace(',', '.');
    const height = heightText.match(/-?\d+(?:\.\d+)?/);
    if (height && Number(height[0]) > 0) {
        const feetInches = heightText.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(\d+(?:\.\d+)?)?\s*(?:in|inch|inches|")?/i);
        let nominal = feetInches
            ? Number(feetInches[1]) * 0.3048 + Number(feetInches[2] || 0) * 0.0254
            : Number(height[0]);
        // OSM uses metres by default, while explicit imperial suffixes are
        // valid and must be normalized before writing scene tiles.
        if (!feetInches && (/\b(?:ft|feet|foot)\b|'/i.test(heightText))) nominal *= 0.3048;
        else if (!feetInches && (/\b(?:in|inch|inches)\b|"/i.test(heightText))) nominal *= 0.0254;
        nominal = Number(nominal.toFixed(3));
        return {
            nominal, lower: nominal, upper: nominal, source: 'osm-height', estimated: false,
            uncertainty: 'tag-value; source accuracy is not specified by OSM', minHeight
        };
    }
    const levels = String(tags['building:levels'] || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
    if (levels && Number(levels[0]) > 0) {
        const count = Number(levels[0]);
        // 3.0–4.5 m/storey covers published residential/service/industrial
        // means. It is a deterministic sensitivity envelope, not a CI.
        return {
            nominal: Number((minHeight.nominal + count * 3.2).toFixed(3)),
            lower: Number((minHeight.lower + count * 3.0).toFixed(3)),
            upper: Number((minHeight.upper + count * 4.5).toFixed(3)),
            source: 'osm-building-levels', estimated: true,
            uncertainty: '3.0–4.5 m/storey literature sensitivity envelope', minHeight
        };
    }
    // Missing-height buildings remain useful for candidate ray tests, but a
    // broad 1–4 storey envelope prevents a nominal 6 m extrusion from being
    // reported as certain shade near the decision boundary.
    return {
        nominal: Number((minHeight.nominal + 6).toFixed(3)),
        lower: Number((minHeight.lower + 3).toFixed(3)),
        upper: Number((minHeight.upper + 12).toFixed(3)),
        source: 'missing-height-default', estimated: true,
        uncertainty: '3–12 m conservative sensitivity envelope; not a statistical CI', minHeight
    };
}

function hgtName(lat, lng) {
    const north = Math.floor(Number(lat));
    const west = Math.floor(Number(lng));
    return `N${String(north).padStart(2, '0')}${west < 0 ? 'W' : 'E'}${String(Math.abs(west)).padStart(3, '0')}.hgt`;
}

class HgtStore {
    constructor(dir) {
        this.dir = dir;
        this.cache = new Map();
        this.maxEntries = Math.max(1, Number(process.env.SCENE_HGT_CACHE_ENTRIES || 8));
    }

    load(lat, lng) {
        const name = hgtName(lat, lng);
        if (this.cache.has(name)) {
            const cached = this.cache.get(name);
            this.cache.delete(name);
            this.cache.set(name, cached);
            return cached;
        }
        const gzipPath = path.join(this.dir, `${name}.gz`);
        const rawPath = path.join(this.dir, name);
        let buffer = null;
        if (fs.existsSync(rawPath)) buffer = fs.readFileSync(rawPath);
        else if (fs.existsSync(gzipPath)) buffer = zlib.gunzipSync(fs.readFileSync(gzipPath));
        if (!buffer || buffer.length < 3601 * 3601 * 2) return null;
        this.cache.set(name, buffer);
        while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
        return buffer;
    }

    sample(lat, lng) {
        const north = Math.floor(Number(lat));
        const west = Math.floor(Number(lng));
        const buffer = this.load(lat, lng);
        if (!buffer) return null;
        const row = Math.max(0, Math.min(3600, Math.round((north + 1 - Number(lat)) * 3600)));
        const col = Math.max(0, Math.min(3600, Math.round((Number(lng) - west) * 3600)));
        const value = buffer.readInt16BE((row * 3601 + col) * 2);
        return value <= -32768 ? null : value;
    }
}

function parsePbf(file, onItem) {
    return new Promise((resolve, reject) => {
        const parser = parseOSM();
        let settled = false;
        const finish = (error) => {
            if (settled) return;
            settled = true;
            if (error) reject(error);
            else resolve();
        };
        parser.on('data', batch => {
            try {
                for (const item of batch) onItem(item);
            } catch (error) {
                parser.destroy(error);
            }
        });
        parser.once('error', finish);
        parser.once('end', () => finish());
        fs.createReadStream(file).once('error', finish).pipe(parser);
    });
}

async function buildNodeIndex() {
    if (!fs.existsSync(PBF_PATH)) throw new Error(`missing OSM extract: ${PBF_PATH}`);
    const metadata = sourceMetadata();
    const sourceFingerprint = {
        pbfSha256: metadata.osm.pbfSha256,
        bytes: metadata.osm.bytes
    };
    if (fs.existsSync(NODE_INDEX_PATH) && fs.existsSync(NODE_INDEX_METADATA_PATH)) {
        const indexSize = fs.statSync(NODE_INDEX_PATH).size;
        let indexMetadata = null;
        try { indexMetadata = JSON.parse(fs.readFileSync(NODE_INDEX_METADATA_PATH, 'utf8')); } catch (error) { indexMetadata = null; }
        const sourceMatches = indexMetadata &&
            indexMetadata.pbfSha256 === sourceFingerprint.pbfSha256 &&
            Number(indexMetadata.bytes) === Number(sourceFingerprint.bytes);
        if (indexSize > 0 && indexSize % NODE_RECORD_SIZE === 0 && sourceMatches) {
            console.log(`reuse node index: ${NODE_INDEX_PATH}`);
            return;
        }
        console.log('discard stale or incomplete node index metadata; rebuilding');
    }
    console.log('pass 1/2: building compact sorted node index');
    const fd = fs.openSync(NODE_INDEX_PATH, 'w');
    const block = Buffer.allocUnsafe(NODE_RECORD_SIZE * 65536);
    let blockOffset = 0;
    let count = 0;
    let lastId = -1n;
    let outOfOrder = false;
    const flush = () => {
        if (blockOffset) fs.writeSync(fd, block, 0, blockOffset);
        blockOffset = 0;
    };
    try {
        await parsePbf(PBF_PATH, item => {
            if (item.type !== 'node') return;
            const id = BigInt(Math.trunc(Number(item.id)));
            if (id <= lastId) outOfOrder = true;
            lastId = id;
            const offset = blockOffset;
            block.writeBigUInt64LE(id, offset);
            block.writeInt32LE(Math.round(Number(item.lat) * 1e7), offset + 8);
            block.writeInt32LE(Math.round(Number(item.lon) * 1e7), offset + 12);
            blockOffset += NODE_RECORD_SIZE;
            count++;
            if (blockOffset === block.length) flush();
            if (count % 1000000 === 0) console.log(`  nodes: ${count.toLocaleString()}`);
        });
        flush();
    } finally {
        fs.closeSync(fd);
    }
    if (outOfOrder) throw new Error('OSM node IDs are not sorted; cannot use compact lookup index');
    const metadataTemp = `${NODE_INDEX_METADATA_PATH}.tmp`;
    fs.writeFileSync(metadataTemp, `${JSON.stringify({
        ...sourceFingerprint,
        records: count,
        recordBytes: NODE_RECORD_SIZE,
        createdAt: new Date().toISOString()
    }, null, 2)}\n`);
    fs.renameSync(metadataTemp, NODE_INDEX_METADATA_PATH);
    console.log(`node index complete: ${count.toLocaleString()} records`);
}

class NodeLookup {
    constructor(file) {
        this.file = file;
        this.fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(this.fd).size;
        if (size % NODE_RECORD_SIZE) throw new Error('invalid node index');
        this.count = size / NODE_RECORD_SIZE;
        // A large regional extract can have an index larger than Node's 2 GiB
        // Buffer limit. Keep a sparse boundary index in memory and load only
        // the small chunk containing a requested node. A short LRU avoids
        // repeatedly reading nearby way nodes from disk.
        this.chunkRecords = Math.max(16_384, Number(process.env.SCENE_NODE_CHUNK_RECORDS || 65_536)); // 1 MB default
        this.chunkCount = Math.ceil(this.count / this.chunkRecords);
        this.chunkStarts = new Array(this.chunkCount);
        const record = Buffer.allocUnsafe(NODE_RECORD_SIZE);
        for (let chunk = 0; chunk < this.chunkCount; chunk++) {
            const offset = chunk * this.chunkRecords * NODE_RECORD_SIZE;
            const read = fs.readSync(this.fd, record, 0, NODE_RECORD_SIZE, offset);
            if (read !== NODE_RECORD_SIZE) throw new Error('truncated node index');
            this.chunkStarts[chunk] = record.readBigUInt64LE(0);
        }
        this.chunkCache = new Map();
    }

    loadChunk(chunk) {
        const cached = this.chunkCache.get(chunk);
        if (cached) {
            this.chunkCache.delete(chunk);
            this.chunkCache.set(chunk, cached);
            return cached;
        }
        const first = chunk * this.chunkRecords;
        const records = Math.min(this.chunkRecords, this.count - first);
        const buffer = Buffer.allocUnsafe(records * NODE_RECORD_SIZE);
        const read = fs.readSync(this.fd, buffer, 0, buffer.length, first * NODE_RECORD_SIZE);
        if (read !== buffer.length) throw new Error('truncated node index chunk');
        const value = { first, records, buffer };
        this.chunkCache.set(chunk, value);
        const maxChunks = Math.max(2, Number(process.env.SCENE_NODE_CACHE_CHUNKS || 512));
        while (this.chunkCache.size > maxChunks) this.chunkCache.delete(this.chunkCache.keys().next().value);
        return value;
    }

    find(idValue) {
        const target = BigInt(Math.trunc(Number(idValue)));
        let low = 0;
        let high = this.chunkCount - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (this.chunkStarts[middle] <= target) low = middle + 1;
            else high = middle - 1;
        }
        const chunk = Math.max(0, low - 1);
        const loaded = this.loadChunk(chunk);
        low = 0;
        high = loaded.records - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const offset = middle * NODE_RECORD_SIZE;
            const id = loaded.buffer.readBigUInt64LE(offset);
            if (id === target) {
                return {
                    lat: loaded.buffer.readInt32LE(offset + 8) / 1e7,
                    lng: loaded.buffer.readInt32LE(offset + 12) / 1e7
                };
            }
            if (id < target) low = middle + 1;
            else high = middle - 1;
        }
        return null;
    }

    close() {
        if (this.fd !== undefined) {
            fs.closeSync(this.fd);
            this.fd = undefined;
        }
    }
}

class TileLineWriter {
    constructor(dir) {
        this.dir = dir;
        this.entries = new Map();
        ensureDir(dir);
    }

    pathFor(key) {
        return path.join(this.dir, `${key.replace(':', '_')}.jsonl`);
    }

    append(key, record) {
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { fd: fs.openSync(this.pathFor(key), 'a'), buffer: '', touched: Date.now() };
            this.entries.set(key, entry);
        }
        entry.touched = Date.now();
        entry.buffer += `${JSON.stringify(record)}\n`;
        if (entry.buffer.length >= 1024 * 1024) this.flushEntry(key, entry);
        if (this.entries.size > 64) {
            const oldest = [...this.entries.entries()].sort((a, b) => a[1].touched - b[1].touched)[0];
            this.flushEntry(oldest[0], oldest[1]);
            fs.closeSync(oldest[1].fd);
            this.entries.delete(oldest[0]);
        }
    }

    flushEntry(key, entry) {
        if (!entry.buffer) return;
        fs.writeSync(entry.fd, entry.buffer, null, 'utf8');
        entry.buffer = '';
        entry.touched = Date.now();
    }

    close() {
        for (const [key, entry] of this.entries) {
            this.flushEntry(key, entry);
            fs.closeSync(entry.fd);
        }
        this.entries.clear();
    }
}

function wayGeometry(item, lookup) {
    const points = [];
    for (const ref of item.refs || []) {
        const point = lookup.find(ref);
        if (point) points.push([point.lat, point.lng]);
    }
    return points;
}

async function collectWays(lookup) {
    console.log('pass 2/2: extracting buildings, tunnels, and road tile coverage');
    const linesDir = path.join(WORK_DIR, 'lines');
    fs.rmSync(linesDir, { recursive: true, force: true });
    ensureDir(linesDir);
    const writer = new TileLineWriter(linesDir);
    const roadTiles = new Set();
    let ways = 0;
    let sceneWays = 0;
    try {
        await parsePbf(PBF_PATH, item => {
            if (item.type !== 'way') return;
            ways++;
            const tags = item.tags || {};
            const isBuilding = !!(tags.building || tags['building:part']);
            const isTunnel = tags.tunnel === 'yes' || tags.covered === 'yes' || tags.covered === 'true';
            const isRoad = !!tags.highway;
            if (!isBuilding && !isTunnel && (!isRoad || !INCLUDE_ROAD_COVERAGE)) return;
            const points = wayGeometry(item, lookup);
            if (points.length < (isBuilding ? 3 : 2)) return;
            for (const [lat, lng] of points) roadTiles.add(tileKeyForCoordinate(lat, lng));
            if (isBuilding || isTunnel) {
                const center = points.reduce((sum, point) => ({ lat: sum.lat + point[0], lng: sum.lng + point[1] }), { lat: 0, lng: 0 });
                center.lat /= points.length;
                center.lng /= points.length;
                const key = tileKeyForCoordinate(center.lat, center.lng);
                if (isBuilding) {
                    const heightModel = parseHeightModel(tags);
                    writer.append(key, {
                    k: 'b', id: `way/${item.id}`, p: points,
                    h: heightModel.nominal, hl: heightModel.lower, hu: heightModel.upper,
                    hs: heightModel.source, he: heightModel.estimated, hq: heightModel.uncertainty,
                    mh: heightModel.minHeight.nominal, mhl: heightModel.minHeight.lower,
                    mhu: heightModel.minHeight.upper, mhs: heightModel.minHeight.source,
                    g: null
                    });
                }
                if (isTunnel) writer.append(key, { k: 't', id: `way/${item.id}`, p: points });
                sceneWays++;
            }
            if (ways % 100000 === 0) console.log(`  ways: ${ways.toLocaleString()}, road tiles: ${roadTiles.size}`);
        });
    } finally {
        writer.close();
    }
    fs.writeFileSync(path.join(WORK_DIR, 'road-tiles.json'), JSON.stringify([...roadTiles]));
    console.log(`ways complete: ${ways.toLocaleString()}, scene ways: ${sceneWays.toLocaleString()}, tiles: ${roadTiles.size}`);
}

function readLineRecords(file) {
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function terrainGridForTile(key, hgt) {
    const { x, y } = parseTileKey(key);
    const points = [];
    const count = Math.floor(TILE_SIZE_M / TERRAIN_SPACING_M);
    for (let iy = 0; iy <= count; iy++) {
        for (let ix = 0; ix <= count; ix++) {
            const point = unprojectGrid(x * TILE_SIZE_M + ix * TERRAIN_SPACING_M, y * TILE_SIZE_M + iy * TERRAIN_SPACING_M);
            const elevation = hgt.sample(point.lat, point.lng);
            if (Number.isFinite(elevation)) points.push([Number(point.lat.toFixed(6)), Number(point.lng.toFixed(6)), Math.round(elevation)]);
        }
    }
    return points;
}

function reusableTileEntry(file, key, metadata) {
    if (!RESUME_WRITE_TILES || !fs.existsSync(file)) return null;
    try {
        const tile = JSON.parse(fs.readFileSync(file, 'utf8'));
        const matches = Number(tile.schemaVersion || tile.schema) === SCENE_SCHEMA_VERSION
            && tile.dataVersion === DATA_VERSION
            && tile.region === REGION_LABEL
            && tile.key === key
            && Number(tile.tileSizeM) === TILE_SIZE_M
            && Number(tile.grid?.latOrigin) === GRID_LAT_ORIGIN
            && Number(tile.grid?.lngOrigin) === GRID_LNG_ORIGIN
            && Number(tile.grid?.cosLat) === GRID_COS_LAT
            && Number(tile.uncertaintyModel?.terrainRelativeVerticalErrorM) === TERRAIN_RELATIVE_VERTICAL_ERROR_M
            && tile.source?.osmPbfSha256 === metadata.osm.pbfSha256
            && tile.source?.demDataset === metadata.terrain.dataset
            && (tile.source?.demDatasetVersion || null) === (metadata.terrain.datasetVersion || null)
            && Array.isArray(tile.buildings)
            && Array.isArray(tile.tunnels)
            && Array.isArray(tile.terrain);
        if (!matches) return null;
        const stat = fs.statSync(file);
        return {
            key,
            path: path.basename(file),
            bytes: stat.size,
            buildings: tile.buildings.length,
            tunnels: tile.tunnels.length,
            terrain: tile.terrain.length
        };
    } catch (error) {
        return null;
    }
}

async function writeTiles() {
    const linesDir = path.join(WORK_DIR, 'lines');
    // Scene-only regional builds intentionally omit the full road coverage
    // pass. In that mode the line files themselves are the tile index.
    const roadTilesPath = path.join(WORK_DIR, 'road-tiles.json');
    const roadTiles = fs.existsSync(roadTilesPath)
        ? JSON.parse(fs.readFileSync(roadTilesPath, 'utf8'))
        : [];
    const tileKeys = new Set(roadTiles);
    for (const file of fs.readdirSync(linesDir)) tileKeys.add(file.replace('.jsonl', '').replace('_', ':'));
    if (!RESUME_WRITE_TILES) fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    ensureDir(OUTPUT_DIR);
    const metadata = sourceMetadata();
    const hgt = new HgtStore(HGT_DIR);
    const tileList = [];
    let index = 0;
    let resumed = 0;
    for (const key of [...tileKeys].sort()) {
        const fileName = `${key.replace(':', '_')}.json`;
        const outputFile = path.join(OUTPUT_DIR, fileName);
        const reusable = reusableTileEntry(outputFile, key, metadata);
        if (reusable) {
            tileList.push(reusable);
            resumed++;
            index++;
            if (index % 100 === 0) console.log(`  tiles: ${index}/${tileKeys.size} (resumed: ${resumed})`);
            continue;
        }
        const records = readLineRecords(path.join(linesDir, `${key.replace(':', '_')}.jsonl`));
        const buildings = [];
        const tunnels = [];
        for (const record of records) {
            const points = record.p || [];
            if (record.k === 'b') {
                const center = points.reduce((sum, point) => ({ lat: sum.lat + point[0], lng: sum.lng + point[1] }), { lat: 0, lng: 0 });
                center.lat /= Math.max(1, points.length);
                center.lng /= Math.max(1, points.length);
                // OSM can contain contradictory height/min_height tags. Clamp
                // only the lower opening envelope to the corresponding roof
                // envelope so malformed data cannot create an inverted solid.
                const minHeight = normalizeMinHeightEnvelope({
                    nominal: record.mh,
                    lower: record.mhl,
                    upper: record.mhu,
                    source: record.mhs
                }, {
                    nominal: record.h,
                    lower: record.hl,
                    upper: record.hu
                });
                buildings.push({
                    id: record.id, polygon: points,
                    height: record.h, heightLower: record.hl, heightUpper: record.hu,
                    heightSource: record.hs, heightEstimated: !!record.he,
                    heightUncertainty: record.hq,
                    minHeight: minHeight.nominal,
                    minHeightLower: minHeight.lower,
                    minHeightUpper: minHeight.upper,
                    minHeightSource: minHeight.source,
                    minHeightAdjusted: minHeight.adjusted || undefined,
                    ground: hgt.sample(center.lat, center.lng),
                    groundVerticalErrorM: TERRAIN_RELATIVE_VERTICAL_ERROR_M
                });
            } else if (record.k === 't') {
                tunnels.push({ id: record.id, line: points });
            }
        }
        const tile = {
            schema: SCENE_SCHEMA_VERSION,
            schemaVersion: SCENE_SCHEMA_VERSION,
            region: REGION_LABEL,
            dataVersion: DATA_VERSION,
            key,
            tileSizeM: TILE_SIZE_M,
            grid: { latOrigin: GRID_LAT_ORIGIN, lngOrigin: GRID_LNG_ORIGIN, cosLat: GRID_COS_LAT },
            bounds: tileBounds(key),
            buildings,
            tunnels,
            terrain: terrainGridForTile(key, hgt),
            profileResolution: {
                azimuthDeg: PROFILE_AZIMUTH_DEG,
                sampleSpacingM: PROFILE_SAMPLE_SPACING_M,
                maxDistanceM: MAX_SHADOW_RAY_DISTANCE_METERS
            },
            uncertaintyModel: {
                version: 'scene-uncertainty-v1',
                buildingHeight: 'source-aware deterministic envelope',
                buildingMinimumHeight: 'OSM min_height or building:min_level vertical opening',
                terrainRelativeVerticalErrorM: TERRAIN_RELATIVE_VERTICAL_ERROR_M,
                terrainConfidenceLevel: 0.90,
                references: {
                    terrain: 'NASADEM/SRTM User Guide',
                    levels: 'Usui 2023; Kleemann et al. 2020'
                }
            },
            sceneCoverage: {
                buildings: true,
                tunnels: true,
                terrain: true,
                buildingGround: buildings.every(building => finite(building.ground))
            },
            source: {
                osm: `Geofabrik ${REGION_LABEL} OSM extract`,
                terrain: metadata.terrain.dataset,
                generatedAt: new Date().toISOString(),
                osmExtractTimestamp: metadata.osm.extractTimestamp,
                osmSourceUrl: metadata.osm.sourceUrl,
                osmPbfSha256: metadata.osm.pbfSha256,
                demDataset: metadata.terrain.dataset,
                demDatasetVersion: metadata.terrain.datasetVersion
            }
        };
        fs.writeFileSync(outputFile, JSON.stringify(tile));
        tileList.push({ key, path: fileName, bytes: fs.statSync(outputFile).size, buildings: buildings.length, tunnels: tunnels.length, terrain: tile.terrain.length });
        index++;
        if (index % 100 === 0) console.log(`  tiles: ${index}/${tileKeys.size}`);
    }
    const manifest = {
        schema: SCENE_SCHEMA_VERSION,
        schemaVersion: SCENE_SCHEMA_VERSION,
        region: REGION_LABEL,
        tileSizeM: TILE_SIZE_M,
        grid: { latOrigin: GRID_LAT_ORIGIN, lngOrigin: GRID_LNG_ORIGIN, cosLat: GRID_COS_LAT },
        tilePaddingMeters: 4500,
        terrainSpacingM: TERRAIN_SPACING_M,
        profileResolution: {
            azimuthDeg: PROFILE_AZIMUTH_DEG,
            sampleSpacingM: PROFILE_SAMPLE_SPACING_M,
            maxDistanceM: MAX_SHADOW_RAY_DISTANCE_METERS
        },
        uncertaintyModel: {
            version: 'scene-uncertainty-v1',
            buildingHeight: {
                explicit: 'OSM height tag retained; tag accuracy unspecified',
                levels: { nominalMetersPerStorey: 3.2, lower: 3.0, upper: 4.5 },
                missing: { nominalMeters: 6, lower: 3, upper: 12 }
            },
            terrain: { relativeVerticalErrorM: TERRAIN_RELATIVE_VERTICAL_ERROR_M, confidenceLevel: 0.90 },
            references: {
                terrain: 'https://lpdaac.usgs.gov/documents/592/NASADEM_User_Guide_V1.pdf',
                levels: 'https://doi.org/10.1177/23998083221116117'
            }
        },
        dataVersion: DATA_VERSION,
        bounds: REGION_BOUNDS,
        includeRoadCoverage: INCLUDE_ROAD_COVERAGE,
        generatedAt: new Date().toISOString(),
        osmExtractTimestamp: metadata.osm.extractTimestamp,
        osmSourceUrl: metadata.osm.sourceUrl,
        osmPbfSha256: metadata.osm.pbfSha256,
        demDataset: metadata.terrain.dataset,
        demDatasetVersion: metadata.terrain.datasetVersion,
        source: `Geofabrik ${REGION_LABEL} OSM + public SRTM elevation`,
        sourceMetadata: metadata,
        tiles: tileList
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`generated ${tileList.length} tiles in ${OUTPUT_DIR} (resumed: ${resumed})`);
}

async function main() {
    ensureDir(SOURCE_DIR);
    ensureDir(WORK_DIR);
    ensureDir(HGT_DIR);
    const skipCollect = String(process.env.SCENE_SKIP_COLLECT || '').toLowerCase() === 'true';
    if (skipCollect) {
        console.log('skip pass 1/2 and pass 2/2: reusing existing scene line files');
    } else {
        await buildNodeIndex();
        const lookup = new NodeLookup(NODE_INDEX_PATH);
        try {
            await collectWays(lookup);
        } finally {
            lookup.close();
        }
        if (DELETE_LOCAL_NODE_INDEX_AFTER_COLLECT) {
            const relative = path.relative(WORK_DIR, NODE_INDEX_PATH);
            if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
                throw new Error('SCENE_DELETE_NODE_INDEX_AFTER_COLLECT only permits an index inside SCENE_WORK_DIR');
            }
            fs.rmSync(NODE_INDEX_PATH, { force: true });
            fs.rmSync(NODE_INDEX_METADATA_PATH, { force: true });
            console.log(`removed completed temporary node index: ${NODE_INDEX_PATH}`);
        }
    }
    await writeTiles();
}

main().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
