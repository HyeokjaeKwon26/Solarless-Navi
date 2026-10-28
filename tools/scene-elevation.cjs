const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

class SceneElevationStore {
    constructor(directory, maxEntries = 32) {
        this.directory = path.resolve(directory);
        this.maxEntries = Math.max(1, Number(maxEntries) || 32);
        this.cache = new Map();
        this.missingFiles = new Set();
        this.voidFiles = new Set();
    }

    sample(lat, lng) {
        const north = Math.floor(Number(lat)), west = Math.floor(Number(lng));
        const name = `${north < 0 ? 'S' : 'N'}${String(Math.abs(north)).padStart(2, '0')}` +
            `${west < 0 ? 'W' : 'E'}${String(Math.abs(west)).padStart(3, '0')}.hgt`;
        let buffer = this.cache.get(name);
        if (buffer) { this.cache.delete(name); this.cache.set(name, buffer); }
        else {
            const raw = path.join(this.directory, name), gzip = raw + '.gz';
            if (fs.existsSync(raw)) buffer = fs.readFileSync(raw);
            else if (fs.existsSync(gzip)) buffer = zlib.gunzipSync(fs.readFileSync(gzip));
            if (!buffer || buffer.length < 3601 * 3601 * 2) { this.missingFiles.add(name); return null; }
            this.cache.set(name, buffer);
            while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
        }
        const row = Math.max(0, Math.min(3600, Math.round((north + 1 - Number(lat)) * 3600)));
        const col = Math.max(0, Math.min(3600, Math.round((Number(lng) - west) * 3600)));
        const value = buffer.readInt16BE((row * 3601 + col) * 2);
        if (value <= -32768) { this.voidFiles.add(name); return null; }
        return value;
    }
}

// Mirrors the grid math in build-scene-tiles.mjs. Sample raw coordinates
// before rounding the serialized latitude and longitude to six decimals.
function terrainGridForKey(key, grid, elevation) {
    const [x, y] = String(key).split(':').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y) || !grid || !Number.isFinite(Number(grid.latOrigin)) ||
        !Number.isFinite(Number(grid.lngOrigin)) || !Number.isFinite(Number(grid.cosLat)) || Number(grid.cosLat) === 0) {
        throw new Error(`Invalid terrain tile grid: ${key}`);
    }
    const points = [], earthRadius = 6371000, degrees = 180 / Math.PI;
    for (let iy = 0; iy <= 50; iy++) for (let ix = 0; ix <= 50; ix++) {
        const lat = Number(grid.latOrigin) + (y * 5000 + iy * 100) / earthRadius * degrees;
        const lng = Number(grid.lngOrigin) + (x * 5000 + ix * 100) / (earthRadius * Number(grid.cosLat)) * degrees;
        const value = elevation.sample(lat, lng);
        if (value !== null && Number.isFinite(Number(value))) {
            points.push([Number(lat.toFixed(6)), Number(lng.toFixed(6)), Math.round(Number(value))]);
        }
    }
    return points;
}

module.exports = { SceneElevationStore, terrainGridForKey };
