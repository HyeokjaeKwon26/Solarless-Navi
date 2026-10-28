#!/usr/bin/env node
// Add verified, hole-safe multipolygon pieces to a prior loose scene without
// modifying the baseline. Matching tagged outer ways are removed only when
// their identity and tile have been verified.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { createRequire } from 'node:module';
import { parseHeightModel, normalizeMinHeightEnvelope } from './build-scene-tiles.mjs';
const require = createRequire(import.meta.url);
const { SceneElevationStore, terrainGridForKey } = require('./scene-elevation.cjs');

const [region, workspaceArg] = process.argv.slice(2);
if (!region || !workspaceArg || !/^us-(northeast|midwest|south|west)$/.test(region)) throw new Error('Expected region and workspace');
const workspace = path.resolve(workspaceArg);
const last = process.env.SCENE_OVERLAY_LAST === 'true';
const followup = last || process.env.SCENE_OVERLAY_FOLLOWUP === 'true';
const incremental = followup || process.env.SCENE_OVERLAY_INCREMENTAL === 'true';
const auditDir = path.join(workspace, `${last ? 'multipolygon-last' : followup ? 'multipolygon-followup' : incremental ? 'multipolygon-recheck' : 'multipolygon'}-${region}`);
const baseDir = path.join(workspace, `build-${region}`, 'generated');
const priorChangedDir = path.join(workspace, `multipolygon-${region}`, 'changed-tiles');
const recheckChangedDir = path.join(workspace, `multipolygon-recheck-${region}`, 'changed-tiles');
const followupChangedDir = path.join(workspace, `multipolygon-followup-${region}`, 'changed-tiles');
const output = path.join(auditDir, 'changed-tiles');
fs.mkdirSync(output, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(path.join('data', 'scene', region, 'manifest.json')));
if (manifest.sourceMetadata?.multipolygon && !incremental) throw new Error('The baseline already contains multipolygon geometry; rebuild against a verified way-only baseline');
if (incremental && !manifest.sourceMetadata?.multipolygon) throw new Error('Incremental overlay requires an existing multipolygon baseline');
function baselineTile(file) {
    const followed = path.join(followupChangedDir, file);
    const rechecked = path.join(recheckChangedDir, file);
    const prior = path.join(priorChangedDir, file);
    return JSON.parse(fs.readFileSync(last && fs.existsSync(followed) ? followed : followup && fs.existsSync(rechecked) ? rechecked : incremental && fs.existsSync(prior) ? prior : path.join(baseDir, file)));
}
const elevation = new SceneElevationStore(path.join(workspace, 'us-hgt'));
const rows = [];
const readRows = async (file, fn) => {
    const lines = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of lines) if (line.trim()) fn(JSON.parse(line));
};
const rejectedIds = new Set();
for (const name of ['assembly-rejected.jsonl', 'triangulation-rejected.jsonl']) {
    await readRows(path.join(auditDir, name), row => rejectedIds.add(row.id));
}
const rejectedOuter = new Set();
await readRows(path.join(auditDir, 'scene-relations.jsonl'), row => { rows.push(row); });
if (incremental) {
    const recoverable = new Set(rows.map(row => row.id));
    for (const name of ['assembly-rejected.jsonl', 'triangulation-rejected.jsonl', 'overlay-blocked.jsonl']) {
        await readRows(path.join(workspace, `multipolygon-${region}`, name), row => {
            if (!recoverable.has(row.id)) rejectedIds.add(row.id);
        });
    }
}
await readRows(path.join(incremental ? path.join(workspace, `multipolygon-${region}`) : auditDir, 'building-relations.jsonl'), row => {
    if (rejectedIds.has(row.id)) for (const member of row.members) {
        if (member.type === 'way' && (member.role === 'outer' || member.role === '')) rejectedOuter.add(member.id);
    }
});
const blocked = new Map();
const block = (id, reason) => { if (!blocked.has(id)) blocked.set(id, reason); };
const removalsByTile = new Map(), points = new Map();
for (const row of rows) {
    for (const removal of row.removeWays) {
        if (rejectedOuter.has(Number(removal.id.slice(4)))) block(row.id, 'outer_shared_with_rejected_relation');
        if (!removalsByTile.has(removal.key)) removalsByTile.set(removal.key, []);
        removalsByTile.get(removal.key).push({ id: removal.id, relation: row.id });
    }
    for (const part of row.pieces) points.set(part.groundPoint.join(','), part.groundPoint);
}
for (const [key, removals] of removalsByTile) {
    const entry = manifest.tiles[key];
    let ids = new Set();
    if (entry) {
        const tile = baselineTile(entry.file);
        ids = new Set((tile.buildings || []).map(b => b.id));
    }
    for (const removal of removals) if (!ids.has(removal.id)) block(removal.relation, 'tagged_outer_not_found_in_baseline');
}
const pointValues = new Map();
const orderedPoints = [...points.entries()].sort((a, b) =>
    Math.floor(a[1][0]) - Math.floor(b[1][0]) || Math.floor(a[1][1]) - Math.floor(b[1][1]));
for (const [key, point] of orderedPoints) pointValues.set(key, elevation.sample(point[0], point[1]));
for (const row of rows) if (row.pieces.some(piece => pointValues.get(piece.groundPoint.join(',')) == null)) block(row.id, 'missing_ground_elevation');

const tileChanges = new Map();
const tileChange = key => {
    if (!tileChanges.has(key)) tileChanges.set(key, { additions: [], removals: new Set(), relationIds: new Set() });
    return tileChanges.get(key);
};
for (const row of rows) {
    if (blocked.has(row.id)) continue;
    for (const piece of row.pieces) tileChange(piece.key).relationIds.add(row.id);
}
const newTerrains = new Map();
for (const [key, value] of tileChanges) if (!manifest.tiles[key]) {
    const terrain = terrainGridForKey(key, manifest.grid, elevation);
    if (terrain.length !== 2601) for (const id of value.relationIds) block(id, 'missing_new_tile_terrain');
    else newTerrains.set(key, terrain);
}
tileChanges.clear();
const stats = { region, candidates: rows.length, appliedRelations: 0, pieces: 0, removedWays: 0,
    changedExistingTiles: 0, newTiles: 0, blockedRelations: 0, holesSupported: true };
for (const row of rows) {
    if (blocked.has(row.id)) continue;
    const model = parseHeightModel(row.tags);
    const minHeight = normalizeMinHeightEnvelope(model.minHeight, model);
    for (const part of row.pieces) {
        tileChange(part.key).additions.push({ id: part.id, polygon: part.polygon,
            height: model.nominal, heightLower: model.lower, heightUpper: model.upper,
            heightSource: model.source, heightEstimated: model.estimated, heightUncertainty: model.uncertainty,
            minHeight: minHeight.nominal, minHeightLower: minHeight.lower, minHeightUpper: minHeight.upper,
            minHeightSource: minHeight.source, ...(minHeight.adjusted ? { minHeightAdjusted: true } : {}),
            ground: pointValues.get(part.groundPoint.join(',')), groundVerticalErrorM: 10 });
        stats.pieces++;
    }
    for (const removal of row.removeWays) tileChange(removal.key).removals.add(removal.id);
    stats.appliedRelations++;
}
const first = Object.values(manifest.tiles)[0];
const template = baselineTile(first.file);
const earth = 6371000, degrees = 180 / Math.PI;
for (const [key, changes] of tileChanges) {
    const old = manifest.tiles[key];
    const filename = old ? old.file : `${key.replace(':', '_')}.json`;
    let tile;
    if (old) {
        tile = baselineTile(filename);
        stats.changedExistingTiles++;
    } else {
        const [x, y] = key.split(':').map(Number), grid = manifest.grid;
        const south = grid.latOrigin + (y * 5000 / earth) * degrees;
        const west = grid.lngOrigin + (x * 5000 / (earth * grid.cosLat)) * degrees;
        tile = { ...template, key, bounds: { south, west,
            north: grid.latOrigin + ((y + 1) * 5000 / earth) * degrees,
            east: grid.lngOrigin + ((x + 1) * 5000 / (earth * grid.cosLat)) * degrees },
            buildings: [], tunnels: [], terrain: newTerrains.get(key),
            source: { ...template.source }, sceneCoverage: { ...template.sceneCoverage } };
        stats.newTiles++;
    }
    const prior = tile.buildings.length;
    tile.buildings = tile.buildings.filter(building => !changes.removals.has(building.id));
    stats.removedWays += prior - tile.buildings.length;
    const existingIds = new Set(tile.buildings.map(building => building.id));
    for (const building of changes.additions) {
        if (existingIds.has(building.id)) throw new Error(`Relation piece already exists: ${building.id}`);
        existingIds.add(building.id);
        tile.buildings.push(building);
    }
    tile.sceneCoverage.buildingGround = tile.buildings.every(b => b.ground != null && Number.isFinite(Number(b.ground)));
    tile.source.multipolygonGeometry = 'OSM relation rings split into hole-preserving simple polygons';
    fs.writeFileSync(path.join(output, filename), JSON.stringify(tile));
    if ((stats.changedExistingTiles + stats.newTiles) % 1000 === 0) console.log(`updated ${stats.changedExistingTiles + stats.newTiles} tiles`);
}
stats.blockedRelations = blocked.size;
stats.missingHgtFiles = [...elevation.missingFiles].sort();
stats.voidHgtFiles = [...elevation.voidFiles].sort();
fs.writeFileSync(path.join(auditDir, 'overlay-blocked.jsonl'), [...blocked].map(([id, reason]) => JSON.stringify({ id, reason })).join('\n') + '\n');
fs.writeFileSync(path.join(auditDir, 'overlay-audit.json'), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
