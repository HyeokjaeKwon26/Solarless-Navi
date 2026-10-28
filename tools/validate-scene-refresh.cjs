#!/usr/bin/env node
// Check the post-merge guarantees before a refreshed scene is packaged.
const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(process.argv[2] || '.');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
const result = JSON.parse(fs.readFileSync(path.join(directory, 'refresh-comparison.json')));
if (manifest.terrainDeferred !== false) throw new Error('Terrain merge is incomplete');
if (manifest.uncertaintyModel?.terrain?.confidenceLevel !== null) throw new Error('Mixed DEM confidence must not be asserted');
if (!manifest.osmExtractTimestamp || !manifest.osmPbfSha256) throw new Error('OSM provenance is incomplete');
if (result.missingGround !== 0 || result.newTilesWithTerrainGaps !== 0) {
    throw new Error(`New scene elevation gaps: ${result.missingGround} buildings, ${result.newTilesWithTerrainGaps} new tiles`);
}
if (!Array.isArray(manifest.tiles) || manifest.tiles.length !== result.oldTileCount + result.newTiles) {
    throw new Error('Refreshed tile count mismatch');
}
if (result.unchangedFootprints + result.changedFootprints + result.missingOldBuildingIds !== result.oldBuildings ||
    result.unchangedFootprints + result.changedFootprints + result.newBuildingIds !== result.currentBuildings ||
    result.currentTunnels - result.newTunnelIds + result.missingOldTunnelIds !== result.oldTunnels) {
    throw new Error('Refreshed object count mismatch');
}
console.log(JSON.stringify({ region: result.region, tiles: manifest.tiles.length, buildings: result.currentBuildings,
    missingGround: result.missingGround, oldTilesWithTerrainGaps: result.oldTilesWithTerrainGaps,
    newTilesWithTerrainGaps: result.newTilesWithTerrainGaps, checked: 'ok' }, null, 2));
