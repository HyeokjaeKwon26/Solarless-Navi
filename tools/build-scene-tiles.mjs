#!/usr/bin/env node
/*
 * Build static Massachusetts scene tiles from a Geofabrik OSM PBF extract and
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
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parseOSM = require('osm-pbf-parser');

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_DIR = path.join(ROOT, 'data', 'source');
const WORK_DIR = path.join(ROOT, 'data', 'work', 'scene-ma');
const OUTPUT_DIR = path.join(ROOT, 'data', 'generated', 'scene-ma');

const EARTH_RADIUS = 6371000;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const TILE_SIZE_M = 5000;
const GRID_LAT_ORIGIN = 41;
const GRID_LNG_ORIGIN = -74;
const GRID_COS_LAT = Math.cos(42 * RAD);
const TERRAIN_SPACING_M = 100;
const NODE_RECORD_SIZE = 16; // uint64 id + int32 latitude/lng at 1e-7 degree
const PBF_PATH = path.join(SOURCE_DIR, 'massachusetts-latest.osm.pbf');
const NODE_INDEX_PATH = path.join(WORK_DIR, 'nodes.bin');
const HGT_DIR = path.join(SOURCE_DIR, 'hgt');

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
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

function parseHeight(tags = {}) {
    const height = String(tags.height || '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (height && Number(height[0]) > 0) return Number(height[0]);
    const levels = String(tags['building:levels'] || '').replace(',', '.').match(/\d+(?:\.\d+)?/);
    if (levels && Number(levels[0]) > 0) return Number(levels[0]) * 3.2;
    return 6;
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
    }

    load(lat, lng) {
        const name = hgtName(lat, lng);
        if (this.cache.has(name)) return this.cache.get(name);
        const gzipPath = path.join(this.dir, `${name}.gz`);
        const rawPath = path.join(this.dir, name);
        let buffer = null;
        if (fs.existsSync(rawPath)) buffer = fs.readFileSync(rawPath);
        else if (fs.existsSync(gzipPath)) buffer = zlib.gunzipSync(fs.readFileSync(gzipPath));
        if (!buffer || buffer.length < 3601 * 3601 * 2) return null;
        this.cache.set(name, buffer);
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
    if (fs.existsSync(NODE_INDEX_PATH) && fs.statSync(NODE_INDEX_PATH).size % NODE_RECORD_SIZE === 0) {
        console.log(`reuse node index: ${NODE_INDEX_PATH}`);
        return;
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
    console.log(`node index complete: ${count.toLocaleString()} records`);
}

class NodeLookup {
    constructor(file) {
        this.buffer = fs.readFileSync(file);
        if (this.buffer.length % NODE_RECORD_SIZE) throw new Error('invalid node index');
        this.count = this.buffer.length / NODE_RECORD_SIZE;
    }

    find(idValue) {
        const target = BigInt(Math.trunc(Number(idValue)));
        let low = 0;
        let high = this.count - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            const offset = middle * NODE_RECORD_SIZE;
            const id = this.buffer.readBigUInt64LE(offset);
            if (id === target) {
                return {
                    lat: this.buffer.readInt32LE(offset + 8) / 1e7,
                    lng: this.buffer.readInt32LE(offset + 12) / 1e7
                };
            }
            if (id < target) low = middle + 1;
            else high = middle - 1;
        }
        return null;
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
            if (!isBuilding && !isTunnel && !isRoad) return;
            const points = wayGeometry(item, lookup);
            if (points.length < (isBuilding ? 3 : 2)) return;
            for (const [lat, lng] of points) roadTiles.add(tileKeyForCoordinate(lat, lng));
            if (isBuilding || isTunnel) {
                const center = points.reduce((sum, point) => ({ lat: sum.lat + point[0], lng: sum.lng + point[1] }), { lat: 0, lng: 0 });
                center.lat /= points.length;
                center.lng /= points.length;
                const key = tileKeyForCoordinate(center.lat, center.lng);
                if (isBuilding) writer.append(key, {
                    k: 'b', id: `way/${item.id}`, p: points,
                    h: parseHeight(tags), he: !tags.height && !tags['building:levels'],
                    g: null
                });
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

async function writeTiles() {
    const linesDir = path.join(WORK_DIR, 'lines');
    const roadTiles = JSON.parse(fs.readFileSync(path.join(WORK_DIR, 'road-tiles.json'), 'utf8'));
    const tileKeys = new Set(roadTiles);
    for (const file of fs.readdirSync(linesDir)) tileKeys.add(file.replace('.jsonl', '').replace('_', ':'));
    fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    ensureDir(OUTPUT_DIR);
    const hgt = new HgtStore(HGT_DIR);
    const tileList = [];
    let index = 0;
    for (const key of [...tileKeys].sort()) {
        const records = readLineRecords(path.join(linesDir, `${key.replace(':', '_')}.jsonl`));
        const buildings = [];
        const tunnels = [];
        for (const record of records) {
            const points = record.p || [];
            if (record.k === 'b') {
                const center = points.reduce((sum, point) => ({ lat: sum.lat + point[0], lng: sum.lng + point[1] }), { lat: 0, lng: 0 });
                center.lat /= Math.max(1, points.length);
                center.lng /= Math.max(1, points.length);
                buildings.push({ id: record.id, polygon: points, height: record.h, heightEstimated: !!record.he, ground: hgt.sample(center.lat, center.lng) });
            } else if (record.k === 't') {
                tunnels.push({ id: record.id, line: points });
            }
        }
        const tile = {
            schema: 1,
            region: 'MA',
            key,
            tileSizeM: TILE_SIZE_M,
            grid: { latOrigin: GRID_LAT_ORIGIN, lngOrigin: GRID_LNG_ORIGIN, cosLat: GRID_COS_LAT },
            bounds: tileBounds(key),
            buildings,
            tunnels,
            terrain: terrainGridForTile(key, hgt),
            source: {
                osm: 'Geofabrik Massachusetts OSM extract',
                terrain: 'SRTM 1 arc-second public elevation tiles',
                generatedAt: new Date().toISOString()
            }
        };
        const fileName = `${key.replace(':', '_')}.json`;
        fs.writeFileSync(path.join(OUTPUT_DIR, fileName), JSON.stringify(tile));
        tileList.push({ key, path: fileName, bytes: fs.statSync(path.join(OUTPUT_DIR, fileName)).size, buildings: buildings.length, tunnels: tunnels.length, terrain: tile.terrain.length });
        index++;
        if (index % 100 === 0) console.log(`  tiles: ${index}/${tileKeys.size}`);
    }
    const manifest = {
        schema: 1,
        region: 'MA',
        tileSizeM: TILE_SIZE_M,
        grid: { latOrigin: GRID_LAT_ORIGIN, lngOrigin: GRID_LNG_ORIGIN, cosLat: GRID_COS_LAT },
        tilePaddingMeters: 4500,
        terrainSpacingM: TERRAIN_SPACING_M,
        generatedAt: new Date().toISOString(),
        source: 'Geofabrik Massachusetts OSM + public SRTM elevation',
        tiles: tileList
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`generated ${tileList.length} tiles in ${OUTPUT_DIR}`);
}

async function main() {
    ensureDir(SOURCE_DIR);
    ensureDir(WORK_DIR);
    ensureDir(HGT_DIR);
    await buildNodeIndex();
    const lookup = new NodeLookup(NODE_INDEX_PATH);
    await collectWays(lookup);
    await writeTiles();
}

main().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
});
