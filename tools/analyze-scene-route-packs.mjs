#!/usr/bin/env node
/* Report which static-scene Release assets a route would download. */
import fs from 'node:fs';
import path from 'node:path';

const EARTH_RADIUS = 6371000;
const RAD = Math.PI / 180;
const manifestPath = path.resolve(process.env.SCENE_MANIFEST || process.argv[2] || 'manifest.json');
const routePath = path.resolve(process.env.SCENE_ROUTE || process.argv[3] || 'route.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const routeValue = JSON.parse(fs.readFileSync(routePath, 'utf8').replace(/^\uFEFF/, ''));

function coordinatesFrom(value) {
    if (Array.isArray(value) && (!value.length || Array.isArray(value[0]) && typeof value[0][0] === 'number')) return value;
    if (Array.isArray(value) && value[0] && Array.isArray(value[0].value)) return value.map(item => item.value);
    if (value && value.type === 'Feature') return coordinatesFrom(value.geometry);
    if (value && value.type === 'LineString') return value.coordinates || [];
    if (value && value.routes && value.routes[0] && value.routes[0].geometry) return coordinatesFrom(value.routes[0].geometry);
    throw new Error('route must be a coordinate array, GeoJSON LineString/Feature, or OSRM response');
}

function tileKey(coordinate) {
    const grid = manifest.grid || {};
    const tileSize = Number(manifest.tileSizeM) || 5000;
    const cosLat = Number.isFinite(Number(grid.cosLat)) ? Number(grid.cosLat) : Math.cos(42 * RAD);
    const x = (Number(coordinate[0]) - Number(grid.lngOrigin || -74)) * RAD * EARTH_RADIUS * cosLat;
    const y = (Number(coordinate[1]) - Number(grid.latOrigin || 41)) * RAD * EARTH_RADIUS;
    return `${Math.floor(x / tileSize)}:${Math.floor(y / tileSize)}`;
}

const coordinates = coordinatesFrom(routeValue);
const radius = Math.max(0, Math.ceil(Number(process.env.SCENE_PADDING_METERS || manifest.tilePaddingMeters || 4500) / Number(manifest.tileSizeM || 5000)));
const baseKeys = new Set(coordinates.map(tileKey));
const tileKeys = new Set();
for (const key of baseKeys) {
    const [x, y] = key.split(':').map(Number);
    for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dy = -radius; dy <= radius; dy += 1) tileKeys.add(`${x + dx}:${y + dy}`);
    }
}
const missingTiles = [...tileKeys].filter(key => !manifest.tiles || !manifest.tiles[key]).sort();
const packKeys = [...new Set([...tileKeys].map(key => manifest.tiles && manifest.tiles[key] && manifest.tiles[key].pack).filter(Boolean))].sort();
const packs = packKeys.map(key => ({ key, ...(manifest.packs[key] || {}) }));
const result = {
    manifest: manifestPath,
    route: routePath,
    routePoints: coordinates.length,
    baseTileCount: baseKeys.size,
    tileCount: tileKeys.size,
    missingTiles,
    packCount: packs.length,
    downloadBytes: packs.reduce((sum, pack) => sum + Number(pack.bytes || pack.estimatedBytes || 0), 0),
    tileKeys: [...tileKeys].sort(),
    packs
};
console.log(JSON.stringify(result, null, 2));
