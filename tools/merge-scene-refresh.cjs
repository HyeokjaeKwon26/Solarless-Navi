#!/usr/bin/env node
// Index an existing release, then compare it with rebuilt loose tiles while
// retaining the released terrain grid and ground for unchanged footprints.
// Run from the project root: node tools/merge-scene-refresh.cjs index|merge
// <region-id> <old-release-dir> <new-generated-dir> <index.sqlite>.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { unzipSync } = require('fflate');
const { SceneElevationStore, terrainGridForKey } = require('./scene-elevation.cjs');

function leastRotation(a) {
    const n = a.length;
    let i = 0, j = 1, k = 0;
    while (i < n && j < n && k < n) {
        const x = a[(i + k) % n], y = a[(j + k) % n];
        if (x === y) { k++; continue; }
        if (x > y) { i += k + 1; if (i === j) i++; }
        else { j += k + 1; if (i === j) j++; }
        k = 0;
    }
    const start = Math.min(i, j);
    return a.slice(start).concat(a.slice(0, start)).join(';');
}

function footprintHash(polygon) {
    if (!Array.isArray(polygon) || polygon.length < 3) throw new Error('Invalid building polygon');
    const points = polygon.map(p => {
        if (!Array.isArray(p) || !Number.isFinite(Number(p[0])) || !Number.isFinite(Number(p[1]))) {
            throw new Error('Invalid building coordinate');
        }
        return `${Math.round(Number(p[0]) * 1e7)},${Math.round(Number(p[1]) * 1e7)}`;
    });
    const closed = points.length > 1 && points[0] === points.at(-1);
    if (closed) points.pop();
    const reverse = [...points].reverse();
    const forwardKey = closed ? leastRotation(points) : points.join(';');
    const reverseKey = closed ? leastRotation(reverse) : reverse.join(';');
    return crypto.createHash('sha256').update((closed ? 'closed:' : 'open:') +
        (forwardKey < reverseKey ? forwardKey : reverseKey)).digest('hex').slice(0, 24);
}

function objectId(value) {
    const match = /^way\/(\d+)$/.exec(String(value));
    if (!match || !Number.isSafeInteger(Number(match[1]))) throw new Error(`Invalid way ID: ${value}`);
    return Number(match[1]);
}

function openIndex(file) {
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-262144;');
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);' +
        'CREATE TABLE IF NOT EXISTS buildings (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, ground REAL, seen INTEGER NOT NULL DEFAULT 0);' +
        'CREATE TABLE IF NOT EXISTS tunnels (id INTEGER PRIMARY KEY, seen INTEGER NOT NULL DEFAULT 0);');
    return db;
}

function eachOldTile(manifest, oldDir, callback, terrainOnly = false) {
    let count = 0;
    for (const pack of Object.values(manifest.packs || {})) {
        const raw = fs.readFileSync(path.join(oldDir, pack.path));
        if (raw.length !== Number(pack.bytes) || crypto.createHash('sha256').update(raw).digest('hex') !== pack.sha256) {
            throw new Error(`Release pack integrity failed: ${pack.path}`);
        }
        const entries = unzipSync(raw);
        for (const [filename, bytes] of Object.entries(entries)) {
            const text = Buffer.from(bytes).toString();
            let tile;
            if (terrainOnly) {
                const buildingsAt = text.indexOf(',"buildings":');
                const terrainAt = text.indexOf(',"terrain":');
                const end = terrainAt < 0 ? -1 : text.indexOf(',"profileResolution":', terrainAt);
                if (buildingsAt > 0 && terrainAt > buildingsAt && end > terrainAt) {
                    tile = JSON.parse(text.slice(0, buildingsAt) + '}');
                    tile.terrain = JSON.parse(text.slice(terrainAt + ',"terrain":'.length, end));
                }
            }
            if (!tile) tile = JSON.parse(text);
            callback(tile, filename);
            count++;
        }
        if (count % 1000 < Number(pack.tiles)) console.log(`old release tiles: ${count}`);
    }
    if (count !== Number(manifest.stats.tileCount)) throw new Error('Old tile count mismatch');
    return count;
}

function indexRelease(region, oldDir, dbFile) {
    const manifest = JSON.parse(fs.readFileSync(path.join('data', 'scene', region, 'manifest.json')));
    const db = openIndex(dbFile);
    const stored = db.prepare('SELECT value FROM meta WHERE key = ?').get('releaseHash');
    if (stored && stored.value !== manifest.manifestHash) throw new Error('Index belongs to a different release');
    if (db.prepare('SELECT value FROM meta WHERE key = ?').get('indexComplete')) {
        console.log('Existing completed release index reused'); db.close(); return;
    }
    db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('releaseHash', manifest.manifestHash);
    const building = db.prepare('INSERT OR IGNORE INTO buildings(id,hash,ground) VALUES (?,?,?)');
    const tunnel = db.prepare('INSERT OR IGNORE INTO tunnels(id) VALUES (?)');
    let addedBuildings = 0, addedTunnels = 0;
    db.exec('BEGIN');
    try {
        eachOldTile(manifest, oldDir, tile => {
            for (const b of tile.buildings || []) {
                if (String(b.id || '').startsWith('relation/')) {
                    throw new Error('Baseline contains multipolygon relation pieces; use a relation-aware refresh to avoid silently dropping them');
                }
                const result = building.run(objectId(b.id), footprintHash(b.polygon), b.ground == null ? null : Number(b.ground));
                addedBuildings += Number(result.changes);
            }
            for (const t of tile.tunnels || []) addedTunnels += Number(tunnel.run(objectId(t.id)).changes);
        });
        db.prepare('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)').run('indexComplete', new Date().toISOString());
        db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    db.close();
    console.log(JSON.stringify({ indexedBuildings: addedBuildings, indexedTunnels: addedTunnels }));
}

function mergeRelease(region, oldDir, newDir, dbFile) {
    const oldManifest = JSON.parse(fs.readFileSync(path.join('data', 'scene', region, 'manifest.json')));
    const manifestFile = path.join(newDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    if (manifest.terrainDeferred && !process.env.SCENE_HGT_DIR) throw new Error('SCENE_HGT_DIR is required for deferred terrain');
    const elevation = manifest.terrainDeferred ? new SceneElevationStore(process.env.SCENE_HGT_DIR) : null;
    const db = openIndex(dbFile);
    if (!db.prepare('SELECT value FROM meta WHERE key = ?').get('indexComplete') ||
        db.prepare('SELECT value FROM meta WHERE key = ?').get('releaseHash')?.value !== oldManifest.manifestHash) {
        throw new Error('Missing or mismatched completed release index');
    }
    const entries = new Map(manifest.tiles.map(e => [e.key, e]));
    const sample = JSON.parse(fs.readFileSync(path.join(newDir, manifest.tiles[0].path)));
    let preservedTerrain = 0, restoredEmptyTiles = 0;
    eachOldTile(oldManifest, oldDir, (old, filename) => {
        const file = path.join(newDir, filename);
        let fresh;
        if (fs.existsSync(file)) fresh = JSON.parse(fs.readFileSync(file));
        else {
            fresh = { ...sample, ...old, buildings: [], tunnels: [], source: { ...sample.source },
                sceneCoverage: { ...sample.sceneCoverage, buildings: true, tunnels: true, buildingGround: true },
                uncertaintyModel: { ...sample.uncertaintyModel } };
            entries.set(old.key, { key: old.key, path: filename, bytes: 0, buildings: 0, tunnels: 0, terrain: old.terrain.length });
            restoredEmptyTiles++;
        }
        fresh.terrain = old.terrain;
        fresh.source.terrain = 'Original v3 SRTM grid; Mapzen Skadi for new or changed building ground';
        fs.writeFileSync(file, JSON.stringify(fresh));
        preservedTerrain++;
    }, true);
    db.exec('UPDATE buildings SET seen=0; UPDATE tunnels SET seen=0;');
    const getBuilding = db.prepare('SELECT hash,ground FROM buildings WHERE id=?');
    const markBuilding = db.prepare('UPDATE buildings SET seen=1 WHERE id=?');
    const markTunnel = db.prepare('UPDATE tunnels SET seen=1 WHERE id=?');
    const result = { region, oldTileCount: preservedTerrain, restoredEmptyTiles,
        newTiles: entries.size - preservedTerrain, oldBuildings: 0, currentBuildings: 0,
        newBuildingIds: 0, changedFootprints: 0, unchangedFootprints: 0,
        preservedBuildingGround: 0, newOrChangedGround: 0, newTunnelIds: 0, currentTunnels: 0,
        missingGround: 0, recoveredGround: 0, oldTilesWithTerrainGaps: 0, newTilesWithTerrainGaps: 0 };
    db.exec('BEGIN');
    try {
        let processed = 0;
        for (const entry of entries.values()) {
            const file = path.join(newDir, entry.path);
            const tile = JSON.parse(fs.readFileSync(file));
            if (manifest.terrainDeferred && !oldManifest.tiles[entry.key]) {
                tile.terrain = terrainGridForKey(entry.key, tile.grid, elevation);
            }
            for (const b of tile.buildings) {
                const id = objectId(b.id), previous = getBuilding.get(id);
                result.currentBuildings++;
                if (!previous) { result.newBuildingIds++; result.newOrChangedGround++; }
                else {
                    markBuilding.run(id);
                    if (previous.hash === footprintHash(b.polygon)) {
                        result.unchangedFootprints++;
                        if (previous.ground != null) { b.ground = previous.ground; result.preservedBuildingGround++; }
                        else result.newOrChangedGround++;
                    } else { result.changedFootprints++; result.newOrChangedGround++; }
                }
                if ((b.ground == null || !Number.isFinite(Number(b.ground))) && elevation && b.polygon.length) {
                    const center = b.polygon.reduce((sum, point) => ({ lat: sum.lat + point[0], lng: sum.lng + point[1] }), { lat: 0, lng: 0 });
                    const recovered = elevation.sample(center.lat / b.polygon.length, center.lng / b.polygon.length);
                    if (recovered != null) { b.ground = recovered; result.recoveredGround++; }
                }
                if (b.ground == null || !Number.isFinite(Number(b.ground))) result.missingGround++;
            }
            for (const t of tile.tunnels) {
                result.currentTunnels++;
                if (!Number(markTunnel.run(objectId(t.id)).changes)) result.newTunnelIds++;
            }
            if (tile.terrain.length < 2601) {
                if (oldManifest.tiles[entry.key]) result.oldTilesWithTerrainGaps++;
                else result.newTilesWithTerrainGaps++;
            }
            tile.sceneCoverage.buildingGround = tile.buildings.every(b => b.ground != null && Number.isFinite(Number(b.ground)));
            tile.sceneCoverage.terrain = tile.terrain.length === 2601;
            tile.source.terrainDeferred = false;
            tile.uncertaintyModel.terrainConfidenceLevel = null;
            tile.uncertaintyModel.terrainConfidenceNote = '10 m sensitivity envelope; mixed-source Skadi confidence not established';
            const raw = JSON.stringify(tile);
            fs.writeFileSync(file, raw);
            entry.bytes = Buffer.byteLength(raw);
            entry.buildings = tile.buildings.length; entry.tunnels = tile.tunnels.length; entry.terrain = tile.terrain.length;
            if (++processed % 1000 === 0) console.log(`new tiles compared: ${processed}/${entries.size}`);
        }
        result.oldBuildings = db.prepare('SELECT count(*) AS n FROM buildings').get().n;
        result.missingOldBuildingIds = db.prepare('SELECT count(*) AS n FROM buildings WHERE seen=0').get().n;
        result.oldTunnels = db.prepare('SELECT count(*) AS n FROM tunnels').get().n;
        result.missingOldTunnelIds = db.prepare('SELECT count(*) AS n FROM tunnels WHERE seen=0').get().n;
        result.missingHgtFiles = elevation ? [...elevation.missingFiles].sort() : [];
        result.voidHgtFiles = elevation ? [...elevation.voidFiles].sort() : [];
        if (result.unchangedFootprints + result.changedFootprints + result.missingOldBuildingIds !== result.oldBuildings ||
            result.currentTunnels - result.newTunnelIds + result.missingOldTunnelIds !== result.oldTunnels) {
            throw new Error('Duplicate or inconsistent way IDs in the compared tiles');
        }
        db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    db.close();
    manifest.tiles = [...entries.values()];
    manifest.terrainDeferred = false;
    manifest.demDataset = 'Original v3 SRTM grids for existing tiles; Mapzen Terrain Tiles Skadi for new tiles and new or changed building ground';
    manifest.demDatasetVersion = 'v3 grids preserved; Mapzen Skadi fetched 2026-10-28 UTC';
    manifest.source = `Geofabrik ${manifest.region} OSM + preserved SRTM grids + Mapzen Terrain Tiles Skadi`;
    manifest.sourceMetadata.terrain = { dataset: manifest.demDataset, datasetVersion: manifest.demDatasetVersion,
        originalReleaseTag: oldManifest.releaseTag, newTerrainSource: 'https://registry.opendata.aws/terrain-tiles/', ...result };
    manifest.uncertaintyModel.terrain.confidenceLevel = null;
    manifest.uncertaintyModel.terrain.note = 'The 10 m screening envelope is a sensitivity assumption; 90% confidence is not established for mixed-source Skadi elevations.';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(newDir, 'refresh-comparison.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    const [mode, region, oldDir, newDir, dbFile] = process.argv.slice(2);
    if (!['index', 'merge'].includes(mode) || !region || !oldDir || !newDir || !dbFile) {
        throw new Error('Usage: node tools/merge-scene-refresh.cjs index|merge <region> <old-dir> <new-dir> <index.sqlite>');
    }
    if (mode === 'index') indexRelease(region, path.resolve(oldDir), path.resolve(dbFile));
    else mergeRelease(region, path.resolve(oldDir), path.resolve(newDir), path.resolve(dbFile));
}

module.exports = { footprintHash, leastRotation };
