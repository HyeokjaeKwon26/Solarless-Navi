/*
 * SceneShadow - small, network-backed 2.5D occlusion layer.
 *
 * This is deliberately not a full 3D renderer.  It combines OpenStreetMap
 * building/tunnel geometry with public ASTER elevation samples and tests the
 * sun ray against that data.  Missing data is represented as `coverage:false`
 * and never replaced with a made-up obstruction.
 */
(function attachSceneShadow(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(globalThis);
    else root.SceneShadow = factory(root);
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis), function createSceneShadow(root) {
    'use strict';

    const EARTH_RADIUS = 6371000;
    const RAD = Math.PI / 180;
    const DEG = 180 / Math.PI;
    const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
    const TERRAIN_ENDPOINT = 'https://api.opentopodata.org/v1/aster30m?locations=';
    const CACHE_TTL_MS = 10 * 60 * 1000;
    const OVERPASS_CACHE_MAX_ENTRIES = 12;
    const TERRAIN_CACHE_MAX_ENTRIES = 512;
    const BUILDING_GROUND_MAX_SAMPLE_DISTANCE_METERS = 500;
    const DEFAULT_MAX_BBOX_AREA_KM2 = 25;
    const DEFAULT_MAX_SCENE_TOTAL_AREA_KM2 = 100;
    const DEFAULT_MAX_SCENE_TILES = 8;
    const DEFAULT_SCENE_TILE_ROUTE_METERS = 5000;
    const MAX_SHADOW_RAY_DISTANCE_METERS = 4500;
    const TERRAIN_GRID_CELL_METERS = 200;
    const BUILDING_GRID_CELL_METERS = 250;
    const PRECOMPUTED_REGION_MANIFESTS = [
        {
            id: 'us-northeast',
            url: 'https://raw.githubusercontent.com/HyeokjaeKwon26/Solarless-Navi/main/data/scene/us-northeast/manifest.json',
            bounds: { south: 38.74287, west: -80.52275, north: 47.46222, east: -66.87164 }
        },
        {
            id: 'us-midwest',
            url: 'https://raw.githubusercontent.com/HyeokjaeKwon26/Solarless-Navi/main/data/scene/us-midwest/manifest.json',
            bounds: { south: 36.0, west: -104.1, north: 49.5, east: -80.0 }
        },
        {
            id: 'us-south',
            url: 'https://raw.githubusercontent.com/HyeokjaeKwon26/Solarless-Navi/main/data/scene/us-south/manifest.json',
            bounds: { south: 24.3, west: -106.7, north: 39.1, east: -75.0 }
        },
        {
            id: 'us-west',
            url: 'https://raw.githubusercontent.com/HyeokjaeKwon26/Solarless-Navi/main/data/scene/us-west/manifest.json',
            bounds: { south: 31.3, west: -125.0, north: 49.1, east: -102.0 }
        }
    ];
    const PRECOMPUTED_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const PRECOMPUTED_MANIFEST_REVALIDATE_MS = 24 * 60 * 60 * 1000;
    const PRECOMPUTED_MANIFEST_TIMEOUT_MS = 5000;
    const PRECOMPUTED_PACK_TIMEOUT_MS = 15000;
    const PRECOMPUTED_PACK_RETRY_COUNT = 1;
    // Byte budget is the primary bound. This large cap is only a failsafe for
    // malformed manifests; ordinary routes may retain more than 64 tiles.
    const PRECOMPUTED_CACHE_MAX_ENTRIES = 4096;
    // Parsed scene graphs are deliberately never cached. Compact serialized
    // tiles get a small hot cache; IndexedDB remains the durable warm cache.
    const PRECOMPUTED_CACHE_MAX_BYTES = 12 * 1024 * 1024;
    const PRECOMPUTED_PERSISTENT_CACHE_MAX_BYTES = 256 * 1024 * 1024;
    const overpassCache = new Map();
    const terrainCache = new Map();
    const terrainInflight = new Map();
    const precomputedTileCache = new Map();
    const precomputedTileInflight = new Map();
    const precomputedManifestCache = new Map();
    const precomputedManifestInflight = new Map();
    const manifestIdentityCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    const scenePackWorkerUrl = 'js/scene-pack-worker.js';
    const persistentTouchAt = new Map();
    let precomputedTileCacheBytes = 0;

    function finite(value) {
        return value !== null && value !== '' && Number.isFinite(Number(value));
    }

    function debugScene(event, details = {}) {
        if (root.DebugLogger && typeof root.DebugLogger.log === 'function') root.DebugLogger.log(event, details);
    }

    function precomputedSourceLabel(manifest) {
        const region = String(manifest && (manifest.region || manifest.releaseTag) || '').trim();
        return region ? `GitHub precomputed ${region} scene tiles` : 'GitHub precomputed scene tiles';
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
        if (![lat1, lng1, lat2, lng2].every(finite)) return Infinity;
        const dLat = (lat2 - lat1) * RAD;
        const dLng = (lng2 - lng1) * RAD;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
        return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
    }

    function calculateRouteLengthMeters(coordinates) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) return 0;
        let total = 0;
        for (let i = 0; i < coordinates.length - 1; i++) {
            total += calculateDistanceMeters(
                Number(coordinates[i][1]), Number(coordinates[i][0]),
                Number(coordinates[i + 1][1]), Number(coordinates[i + 1][0])
            );
        }
        return Number.isFinite(total) ? total : 0;
    }

    function projectPoint(lat, lng, origin) {
        const cosLat = Math.cos(origin.lat * RAD) || 1;
        return {
            x: (lng - origin.lng) * RAD * EARTH_RADIUS * cosLat,
            y: (lat - origin.lat) * RAD * EARTH_RADIUS
        };
    }

    function unprojectPoint(x, y, origin) {
        const cosLat = Math.cos(origin.lat * RAD) || 1;
        return {
            lat: origin.lat + (y / EARTH_RADIUS) * DEG,
            lng: origin.lng + (x / (EARTH_RADIUS * cosLat)) * DEG
        };
    }

    function pointInPolygon(point, polygon) {
        if (!point || !polygon || polygon.length < 3) return false;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i];
            const b = polygon[j];
            const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
                (point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function raySegmentDistance(origin, direction, a, b) {
        const sx = b.x - a.x;
        const sy = b.y - a.y;
        const denominator = direction.x * sy - direction.y * sx;
        if (Math.abs(denominator) < 1e-9) return null;
        const ox = a.x - origin.x;
        const oy = a.y - origin.y;
        const t = (ox * sy - oy * sx) / denominator;
        const u = (ox * direction.y - oy * direction.x) / denominator;
        if (t >= 0 && u >= 0 && u <= 1) return t;
        return null;
    }

    function intersectRayWithPolygon(origin, direction, polygon, maxDistance = 5000) {
        if (!polygon || polygon.length < 3) return null;
        if (pointInPolygon(origin, polygon)) return 0;
        let nearest = null;
        for (let i = 0; i < polygon.length; i++) {
            const distance = raySegmentDistance(origin, direction, polygon[i], polygon[(i + 1) % polygon.length]);
            if (distance !== null && distance <= maxDistance && (nearest === null || distance < nearest)) nearest = distance;
        }
        return nearest;
    }

    function distanceToPolyline(point, line) {
        if (!point || !line || line.length < 2) return Infinity;
        let best = Infinity;
        for (let i = 0; i < line.length - 1; i++) {
            const a = line[i];
            const b = line[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const lengthSq = dx * dx + dy * dy;
            const t = lengthSq ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq, 0, 1) : 0;
            const px = a.x + dx * t;
            const py = a.y + dy * t;
            best = Math.min(best, Math.hypot(point.x - px, point.y - py));
        }
        return best;
    }

    function isTerrainRayOccluded(roadElevation, sunElevationDeg, distances, elevations, tolerance = 2) {
        if (!finite(roadElevation) || !finite(sunElevationDeg) || sunElevationDeg <= 0) return false;
        if (!Array.isArray(distances) || !Array.isArray(elevations)) return false;
        const tangent = Math.tan(sunElevationDeg * RAD);
        for (let i = 0; i < Math.min(distances.length, elevations.length); i++) {
            if (!finite(distances[i]) || !finite(elevations[i])) continue;
            const lineElevation = roadElevation + tangent * Number(distances[i]);
            if (Number(elevations[i]) > lineElevation + tolerance) return true;
        }
        return false;
    }

    function parseHeight(tags) {
        tags = tags || {};
        const heightText = String(tags.height || '').replace(',', '.');
        const heightMatch = heightText.match(/-?\d+(?:\.\d+)?/);
        if (heightMatch && Number(heightMatch[0]) > 0) return Number(heightMatch[0]);
        const levelText = String(tags['building:levels'] || '').replace(',', '.');
        const levelMatch = levelText.match(/\d+(?:\.\d+)?/);
        if (levelMatch && Number(levelMatch[0]) > 0) return Number(levelMatch[0]) * 3.2;
        return 6;
    }

    function routeBbox(coordinates, paddingMeters = 250) {
        const valid = (coordinates || []).filter(c => Array.isArray(c) && finite(c[0]) && finite(c[1]));
        if (!valid.length) return null;
        const south = Math.min(...valid.map(c => Number(c[1])));
        const north = Math.max(...valid.map(c => Number(c[1])));
        const west = Math.min(...valid.map(c => Number(c[0])));
        const east = Math.max(...valid.map(c => Number(c[0])));
        const midLat = (south + north) / 2;
        const latPad = paddingMeters / EARTH_RADIUS * DEG;
        const lngPad = paddingMeters / (EARTH_RADIUS * (Math.cos(midLat * RAD) || 1)) * DEG;
        return { south: south - latPad, west: west - lngPad, north: north + latPad, east: east + lngPad };
    }

    function bboxMetrics(bbox) {
        if (!bbox || ![bbox.south, bbox.west, bbox.north, bbox.east].every(finite)) return null;
        const midLat = (Number(bbox.south) + Number(bbox.north)) / 2;
        const widthMeters = calculateDistanceMeters(midLat, Number(bbox.west), midLat, Number(bbox.east));
        const heightMeters = calculateDistanceMeters(Number(bbox.south), Number(bbox.west), Number(bbox.north), Number(bbox.west));
        if (![widthMeters, heightMeters].every(Number.isFinite)) return null;
        return {
            widthMeters,
            heightMeters,
            areaKm2: (widthMeters * heightMeters) / 1000000,
            midLat
        };
    }

    function bboxKey(bbox) {
        return [bbox.south, bbox.west, bbox.north, bbox.east].map(v => Number(v).toFixed(3)).join(',');
    }

    function splitRouteIntoSceneTiles(coordinates, options = {}) {
        const maxTileRouteMeters = Number(options.sceneTileRouteMeters || DEFAULT_SCENE_TILE_ROUTE_METERS);
        const paddingMeters = Number(options.paddingMeters || 250);
        const tiles = [];
        let chunk = [coordinates[0]];
        let chunkDistance = 0;
        for (let i = 1; i < coordinates.length; i++) {
            const previous = coordinates[i - 1];
            const current = coordinates[i];
            chunk.push(current);
            chunkDistance += calculateDistanceMeters(
                Number(previous[1]), Number(previous[0]),
                Number(current[1]), Number(current[0])
            );
            if (chunkDistance >= maxTileRouteMeters && chunk.length >= 2) {
                const bbox = routeBbox(chunk, paddingMeters);
                if (bbox) tiles.push({ bbox, routeCoordinates: chunk });
                chunk = [current];
                chunkDistance = 0;
            }
        }
        if (chunk.length === 1 && coordinates.length > 1) chunk.unshift(coordinates[coordinates.length - 2]);
        if (chunk.length >= 2) {
            const bbox = routeBbox(chunk, paddingMeters);
            if (bbox) tiles.push({ bbox, routeCoordinates: chunk });
        }
        const unique = new Map();
        for (const tile of tiles) {
            const key = bboxKey(tile.bbox);
            if (!unique.has(key)) unique.set(key, tile);
        }
        return [...unique.values()];
    }

    function getExpiringCacheValue(cache, key) {
        const entry = cache.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            cache.delete(key);
            return undefined;
        }
        // Refresh insertion order for a small LRU-like bound.
        cache.delete(key);
        cache.set(key, entry);
        return entry.value;
    }

    function setExpiringCacheValue(cache, key, value, maxEntries) {
        cache.delete(key);
        cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    }

    async function fetchJsonWithTimeout(url, options = {}) {
        const fetchFn = root.fetch || (typeof fetch === 'function' ? fetch : null);
        if (!fetchFn) throw new Error('fetch unavailable');
        const timeoutMs = options.timeoutMs || 12000;
        const externalSignal = options.signal || null;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        let timer = null;
        let abortedByTimeout = false;
        let abortHandler = null;
        if (controller) {
            timer = setTimeout(() => { abortedByTimeout = true; controller.abort(); }, timeoutMs);
            if (externalSignal) {
                abortHandler = () => controller.abort();
                if (externalSignal.aborted) controller.abort();
                else externalSignal.addEventListener('abort', abortHandler, { once: true });
            }
        }
        try {
            const response = await fetchFn(url, controller ? { signal: controller.signal } : {});
            if (!response || !response.ok) throw new Error(`HTTP ${response && response.status || 0}`);
            return await response.json();
        } catch (error) {
            if (externalSignal && externalSignal.aborted) throw error;
            if (abortedByTimeout) throw new Error('timeout');
            throw error;
        } finally {
            if (timer) clearTimeout(timer);
            if (externalSignal && abortHandler) externalSignal.removeEventListener('abort', abortHandler);
        }
    }

    function sceneTileGridPoint(lat, lng, grid) {
        const source = grid || {};
        const originLat = finite(source.latOrigin) ? Number(source.latOrigin) : 41;
        const originLng = finite(source.lngOrigin) ? Number(source.lngOrigin) : -74;
        const cosLat = finite(source.cosLat) ? Number(source.cosLat) : Math.cos(42 * RAD);
        return {
            x: (Number(lng) - originLng) * RAD * EARTH_RADIUS * cosLat,
            y: (Number(lat) - originLat) * RAD * EARTH_RADIUS
        };
    }

    function sceneTileKeyForCoordinate(lat, lng, manifest) {
        const grid = manifest && manifest.grid;
        const tileSize = Number(manifest && manifest.tileSizeM) || DEFAULT_SCENE_TILE_ROUTE_METERS;
        const point = sceneTileGridPoint(lat, lng, grid);
        return `${Math.floor(point.x / tileSize)}:${Math.floor(point.y / tileSize)}`;
    }

    function routeSceneTileKeys(coordinates, manifest, paddingMeters) {
        const tileSize = Number(manifest && manifest.tileSizeM) || DEFAULT_SCENE_TILE_ROUTE_METERS;
        const radius = Math.max(0, Math.ceil(Number(paddingMeters || manifest && manifest.tilePaddingMeters || MAX_SHADOW_RAY_DISTANCE_METERS) / tileSize));
        const base = new Set();
        for (const coordinate of coordinates || []) {
            if (!Array.isArray(coordinate) || !finite(coordinate[0]) || !finite(coordinate[1])) continue;
            base.add(sceneTileKeyForCoordinate(Number(coordinate[1]), Number(coordinate[0]), manifest));
        }
        const result = new Set();
        for (const key of base) {
            const [x, y] = key.split(':').map(Number);
            for (let dx = -radius; dx <= radius; dx++) {
                for (let dy = -radius; dy <= radius; dy++) result.add(`${x + dx}:${y + dy}`);
            }
        }
        return [...result];
    }

    function getPrecomputedCacheValue(key) {
        const record = precomputedTileCache.get(key);
        if (!record) return undefined;
        if (record.expiresAt <= Date.now()) {
            precomputedTileCacheBytes = Math.max(0, precomputedTileCacheBytes - Number(record.bytes || 0));
            precomputedTileCache.delete(key);
            return undefined;
        }
        precomputedTileCache.delete(key);
        record.lastAccess = Date.now();
        precomputedTileCache.set(key, record);
        return record.value;
    }

    function estimateCacheBytes(value, explicitBytes = 0) {
        if (Number.isFinite(Number(explicitBytes)) && Number(explicitBytes) > 0) return Number(explicitBytes);
        try { return Math.max(1, JSON.stringify(value).length * 2); } catch (error) { return 1; }
    }

    function setPrecomputedCacheValue(key, value, explicitBytes = 0) {
        const bytes = estimateCacheBytes(value, explicitBytes);
        const previous = precomputedTileCache.get(key);
        if (previous) precomputedTileCacheBytes = Math.max(0, precomputedTileCacheBytes - Number(previous.bytes || 0));
        precomputedTileCache.delete(key);
        precomputedTileCache.set(key, { value, bytes, lastAccess: Date.now(), expiresAt: Date.now() + PRECOMPUTED_CACHE_TTL_MS });
        precomputedTileCacheBytes += bytes;
        while (precomputedTileCache.size > PRECOMPUTED_CACHE_MAX_ENTRIES || precomputedTileCacheBytes > PRECOMPUTED_CACHE_MAX_BYTES) {
            const oldestKey = precomputedTileCache.keys().next().value;
            if (oldestKey === undefined) break;
            const oldest = precomputedTileCache.get(oldestKey);
            precomputedTileCacheBytes = Math.max(0, precomputedTileCacheBytes - Number(oldest && oldest.bytes || 0));
            precomputedTileCache.delete(oldestKey);
        }
    }

    function openPrecomputedDb() {
        if (typeof indexedDB === 'undefined') return Promise.resolve(null);
        if (!openPrecomputedDb.promise) {
            openPrecomputedDb.promise = new Promise(resolve => {
                try {
                    const request = indexedDB.open('solarless-scene-cache', 2);
                    request.onupgradeneeded = () => {
                        const db = request.result;
                        const transaction = request.transaction;
                        let tiles;
                        if (!db.objectStoreNames.contains('tiles')) tiles = db.createObjectStore('tiles');
                        else tiles = transaction.objectStore('tiles');
                        if (!tiles.indexNames.contains('lastAccess')) tiles.createIndex('lastAccess', 'lastAccess', { unique: false });
                        if (!tiles.indexNames.contains('bytes')) tiles.createIndex('bytes', 'bytes', { unique: false });
                        if (!request.result.objectStoreNames.contains('manifests')) request.result.createObjectStore('manifests');
                    };
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => resolve(null);
                } catch (error) {
                    resolve(null);
                }
            });
        }
        return openPrecomputedDb.promise;
    }

    async function readStoredSceneValue(storeName, key) {
        const db = await openPrecomputedDb();
        if (!db) return null;
        return new Promise(resolve => {
            try {
                const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            } catch (error) {
                resolve(null);
            }
        });
    }

    async function writeStoredSceneValue(storeName, key, value) {
        const db = await openPrecomputedDb();
        if (!db) return;
        try {
            const transaction = db.transaction(storeName, 'readwrite');
            transaction.objectStore(storeName).put(value, key);
        } catch (error) {
            // IndexedDB is an optional persistence layer; memory cache remains valid.
        }
    }

    async function writeStoredSceneValues(storeName, values) {
        const db = await openPrecomputedDb();
        if (!db || !Array.isArray(values) || !values.length) return;
        try {
            const transaction = db.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            values.forEach(entry => store.put(entry.value, entry.key));
            await new Promise(resolve => { transaction.oncomplete = resolve; transaction.onerror = resolve; transaction.onabort = resolve; });
        } catch (error) {
            // IndexedDB is optional; the in-memory LRU remains authoritative.
        }
    }

    async function touchStoredSceneTile(key, record) {
        const now = Date.now();
        if (!key || now - Number(persistentTouchAt.get(key) || 0) < 5 * 60 * 1000) return;
        persistentTouchAt.set(key, now);
        if (!record) return;
        await writeStoredSceneValue('tiles', key, { ...record, key, lastAccess: now });
    }

    async function pruneStoredSceneTiles() {
        const db = await openPrecomputedDb();
        if (!db) return;
        const records = await new Promise(resolve => {
            try {
                const store = db.transaction('tiles', 'readonly').objectStore('tiles');
                const valuesRequest = store.getAll();
                const keysRequest = store.getAllKeys();
                let values = null;
                let keys = null;
                const finish = () => {
                    if (!values || !keys) return;
                    resolve(values.map((value, index) => ({ ...(value || {}), key: value && value.key !== undefined ? value.key : keys[index] })));
                };
                valuesRequest.onsuccess = () => { values = valuesRequest.result || []; finish(); };
                keysRequest.onsuccess = () => { keys = keysRequest.result || []; finish(); };
                valuesRequest.onerror = () => resolve([]);
                keysRequest.onerror = () => resolve([]);
            } catch (error) {
                resolve([]);
            }
        });
        const now = Date.now();
        const live = records.filter(record => record && (!record.expiresAt || record.expiresAt > now));
        const expired = records.filter(record => record && record.expiresAt && record.expiresAt <= now);
        let totalBytes = live.reduce((sum, record) => sum + (Number(record.bytes) || estimateCacheBytes(record.value)), 0);
        const remove = expired.concat(live.sort((a, b) => Number(a.lastAccess || 0) - Number(b.lastAccess || 0)));
        const toDelete = [];
        for (const record of remove) {
            if (!expired.includes(record) && live.length - toDelete.length <= PRECOMPUTED_CACHE_MAX_ENTRIES && totalBytes <= PRECOMPUTED_PERSISTENT_CACHE_MAX_BYTES) break;
            const bytes = Number(record.bytes) || estimateCacheBytes(record.value);
            totalBytes = Math.max(0, totalBytes - bytes);
            toDelete.push(record);
        }
        if (!toDelete.length) return;
        try {
            const transaction = db.transaction('tiles', 'readwrite');
            const store = transaction.objectStore('tiles');
            for (const record of toDelete) {
                if (record && record.key !== undefined) store.delete(record.key);
            }
        } catch (error) {
            // Best-effort byte bound; memory cache remains authoritative.
        }
    }

    async function loadPrecomputedManifest(options = {}) {
        const manifestUrl = options.precomputedManifestUrl;
        if (!manifestUrl) return null;
        const memory = precomputedManifestCache.get(manifestUrl);
        if (memory && memory.expiresAt > Date.now() && memory.revalidateAt > Date.now()) { debugScene('manifest-memory-hit', { manifestUrl }); return memory.value; }
        if (precomputedManifestInflight.has(manifestUrl)) return precomputedManifestInflight.get(manifestUrl);
        const promise = (async () => {
            const stored = await readStoredSceneValue('manifests', manifestUrl) || memory;
            const now = Date.now();
            if (stored && stored.value && stored.revalidateAt > now) {
                precomputedManifestCache.set(manifestUrl, { value: stored.value, etag: stored.etag || null, expiresAt: now + PRECOMPUTED_CACHE_TTL_MS, revalidateAt: stored.revalidateAt });
                debugScene('manifest-idb-hit', { manifestUrl });
                return stored.value;
            }
            try {
                const fetchFn = root.fetch || (typeof fetch === 'function' ? fetch : null);
                if (!fetchFn) return stored && stored.value || null;
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timeoutMs = options.precomputedManifestTimeoutMs || PRECOMPUTED_MANIFEST_TIMEOUT_MS;
                let timer = null;
                let abortHandler = null;
                try {
                    if (controller) {
                        timer = setTimeout(() => controller.abort(), timeoutMs);
                        if (options.signal) {
                            abortHandler = () => controller.abort();
                            if (options.signal.aborted) controller.abort();
                            else options.signal.addEventListener('abort', abortHandler, { once: true });
                        }
                    }
                    const headers = stored && stored.etag ? { 'If-None-Match': stored.etag } : undefined;
                    const response = await fetchFn(manifestUrl, controller ? { signal: controller.signal, headers } : { headers });
                    if (response && response.status === 304 && stored && stored.value) {
                        const refreshed = { ...stored, revalidateAt: now + PRECOMPUTED_MANIFEST_REVALIDATE_MS, expiresAt: now + PRECOMPUTED_CACHE_TTL_MS };
                        await writeStoredSceneValue('manifests', manifestUrl, refreshed);
                        precomputedManifestCache.set(manifestUrl, refreshed);
                        debugScene('manifest-revalidate-304', { manifestUrl });
                        return stored.value;
                    }
                    if (!response || !response.ok) throw new Error(`HTTP ${response && response.status || 0}`);
                    const value = await response.json();
                    const etag = response.headers && typeof response.headers.get === 'function' ? response.headers.get('etag') : null;
                    const record = { value, etag, revalidateAt: now + PRECOMPUTED_MANIFEST_REVALIDATE_MS, expiresAt: now + PRECOMPUTED_CACHE_TTL_MS };
                    precomputedManifestCache.set(manifestUrl, record);
                    await writeStoredSceneValue('manifests', manifestUrl, record);
                    debugScene('manifest-revalidate-refresh', { manifestUrl });
                    return value;
                } finally {
                    if (timer) clearTimeout(timer);
                    if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);
                }
            } catch (error) {
                if (options.signal && options.signal.aborted) throw error;
                debugScene('manifest-revalidate-failure', { manifestUrl, message: String(error && error.message || error) });
                return stored && stored.value || null;
            }
        })().finally(() => precomputedManifestInflight.delete(manifestUrl));
        precomputedManifestInflight.set(manifestUrl, promise);
        return promise;
    }

    function sceneTileUrl(manifest, pack) {
        const base = String(manifest.baseUrl || '').replace(/\/$/, '');
        const relative = manifest.packs && manifest.packs[pack] && manifest.packs[pack].path;
        if (!base || !relative) return null;
        return `${base}/${relative}`;
    }

    async function mapWithConcurrency(items, concurrency, worker, signal) {
        const values = new Array(items.length);
        let cursor = 0;
        const limit = Math.max(1, Math.min(Number(concurrency) || 6, 8));
        const consume = async () => {
            while (true) {
                if (signal && signal.aborted) throw new Error('scene request aborted');
                const index = cursor++;
                if (index >= items.length) return;
                values[index] = await worker(items[index], index);
            }
        };
        await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
        return values;
    }

    function shortManifestDigest(value) {
        let a = 2166136261;
        let b = 16777619;
        for (let i = 0; i < value.length; i++) {
            const code = value.charCodeAt(i);
            a = Math.imul(a ^ code, 16777619) >>> 0;
            b = Math.imul(b ^ (code + i), 2246822519) >>> 0;
        }
        return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
    }
    async function manifestCacheIdentity(manifest) {
        if (!manifest || typeof manifest !== 'object') return 'scene:unknown';
        if (manifestIdentityCache && manifestIdentityCache.has(manifest)) return manifestIdentityCache.get(manifest);
        const directHash = manifest.manifestHash || manifest.contentHash;
        const source = directHash
            ? String(directHash)
            : [manifest.releaseTag || 'scene', manifest.dataVersion || '', manifest.schemaVersion || manifest.schema || 'unknown',
                ...Object.entries(manifest.packs || {}).map(([key, value]) => `${key}:${value && value.sha256 || ''}`).sort()].join('|');
        const promise = (async () => {
            if (directHash) return `manifest:${source}`;
            if (root.crypto && root.crypto.subtle && typeof root.crypto.subtle.digest === 'function' && typeof TextEncoder !== 'undefined') {
                const bytes = new TextEncoder().encode(source);
                const digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
                return `manifest:${[...digest].map(value => value.toString(16).padStart(2, '0')).join('')}`;
            }
            return `manifest:${shortManifestDigest(source)}`;
        })();
        if (manifestIdentityCache) manifestIdentityCache.set(manifest, promise);
        return promise;
    }

    function unzipPackPayload(bytes, requestedFileNames, options = {}) {
        const requested = new Set((requestedFileNames || []).map(String));
        const canUseWorker = options.disableScenePackWorker !== true && typeof root.Worker === 'function';
        if (!canUseWorker) {
            if (!root.fflate || typeof root.fflate.unzipSync !== 'function') throw new Error('scene tile decompressor unavailable');
            const files = root.fflate.unzipSync(bytes, { filter: file => requested.size === 0 || requested.has(file.name) });
            const parsed = {};
            for (const [name, content] of Object.entries(files)) {
                if (!name.endsWith('.json') || (requested.size > 0 && !requested.has(name))) continue;
                const text = root.fflate.strFromU8(content);
                parsed[name] = text;
            }
            Object.defineProperty(parsed, '__sceneByteSizes', { value: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, content.byteLength])), enumerable: false });
            return Promise.resolve(parsed);
        }
        return new Promise((resolve, reject) => {
            let worker;
            let timer;
            let abortHandler;
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);
                try { if (worker) worker.terminate(); } catch (e) {}
                if (error) reject(error); else resolve(value);
            };
            try {
                worker = new root.Worker(options.scenePackWorkerUrl || scenePackWorkerUrl);
                worker.onmessage = event => {
                    const payload = event && event.data;
                    if (!payload || payload.error) { finish(new Error(payload && payload.error || 'scene pack worker failed')); return; }
                    const files = payload.files || {};
                    Object.defineProperty(files, '__sceneByteSizes', { value: payload.sizes || {}, enumerable: false });
                    finish(null, files);
                };
                worker.onerror = () => finish(new Error('scene pack worker failed'));
                timer = setTimeout(() => finish(new Error('scene pack worker timeout')), options.workerTimeoutMs || 8000);
                if (options.signal) {
                    abortHandler = () => finish(new Error('scene request aborted'));
                    if (options.signal.aborted) { abortHandler(); return; }
                    options.signal.addEventListener('abort', abortHandler, { once: true });
                }
                const transferable = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
                worker.postMessage({ buffer: transferable, fileNames: [...requested] }, [transferable]);
                debugScene('scene-pack-unzip-start', { bytes: bytes.byteLength, worker: true });
            } catch (error) {
                finish(error);
            }
        }).catch(error => {
            if (options.signal && options.signal.aborted) throw error;
            debugScene('scene-pack-unzip-failure', { message: String(error && error.message || error), fallback: true });
            if (!root.fflate || typeof root.fflate.unzipSync !== 'function') throw error;
            const files = root.fflate.unzipSync(bytes, { filter: file => requested.size === 0 || requested.has(file.name) });
            const parsed = {};
            for (const [name, content] of Object.entries(files)) {
                if (!name.endsWith('.json') || (requested.size > 0 && !requested.has(name))) continue;
                const text = root.fflate.strFromU8(content);
                parsed[name] = text;
            }
            Object.defineProperty(parsed, '__sceneByteSizes', { value: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, content.byteLength])), enumerable: false });
            return parsed;
        });
    }

    async function loadPrecomputedPack(manifest, pack, requestedFileNames, options = {}) {
        const identity = await manifestCacheIdentity(manifest);
        const wanted = [...new Set((requestedFileNames || []).map(String))];
        if (!wanted.length) return {};
        const cacheKey = `${identity}:pack-download:${pack}`;
        const url = sceneTileUrl(manifest, pack);
        if (!url) return null;
        let downloadPromise = precomputedTileInflight.get(cacheKey);
        if (!downloadPromise) downloadPromise = (async () => {
            const fetchFn = root.fetch || (typeof fetch === 'function' ? fetch : null);
            if (!fetchFn) return null;
            const retryCount = Math.max(0, Math.min(1, Number(options.precomputedPackRetryCount ?? PRECOMPUTED_PACK_RETRY_COUNT)));
            for (let attempt = 0; attempt <= retryCount; attempt++) {
                if (options.signal && options.signal.aborted) throw new Error('scene request aborted');
                const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                let timer = null;
                let abortHandler = null;
                try {
                    if (controller) {
                        timer = setTimeout(() => controller.abort(), options.precomputedPackTimeoutMs || PRECOMPUTED_PACK_TIMEOUT_MS);
                        if (options.signal) {
                            abortHandler = () => controller.abort();
                            if (options.signal.aborted) controller.abort();
                            else options.signal.addEventListener('abort', abortHandler, { once: true });
                        }
                    }
                    const response = await fetchFn(url, controller ? { signal: controller.signal } : {});
                    if (!response || !response.ok) throw new Error(`HTTP ${response && response.status || 0}`);
                    const bytes = new Uint8Array(await response.arrayBuffer());
                    debugScene('scene-pack-download-end', { pack, bytes: bytes.byteLength, attempt });
                    const expectedHash = manifest.packs && manifest.packs[pack] && manifest.packs[pack].sha256;
                    if (expectedHash && root.crypto && root.crypto.subtle && typeof root.crypto.subtle.digest === 'function') {
                        const digest = new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes));
                        const actualHash = [...digest].map(value => value.toString(16).padStart(2, '0')).join('');
                        if (actualHash.toLowerCase() !== String(expectedHash).toLowerCase()) { debugScene('scene-pack-checksum-failure', { pack, attempt }); throw new Error('scene tile checksum mismatch'); }
                    }
                    return bytes;
                } catch (error) {
                    if (options.signal && options.signal.aborted) throw error;
                    if (attempt >= retryCount) throw error;
                    debugScene('scene-pack-download-retry', { pack, attempt: attempt + 1, message: String(error && error.message || error) });
                } finally {
                    if (timer) clearTimeout(timer);
                    if (options.signal && abortHandler) options.signal.removeEventListener('abort', abortHandler);
                }
            }
            return null;
        })().finally(() => precomputedTileInflight.delete(cacheKey));
        if (!precomputedTileInflight.has(cacheKey)) precomputedTileInflight.set(cacheKey, downloadPromise);
        const bytes = await downloadPromise;
        if (!bytes) return null;
        const parsed = await unzipPackPayload(bytes, wanted, options);
        debugScene('scene-pack-unzip-end', { pack, requestedFiles: wanted.length, returnedFiles: Object.keys(parsed || {}).length });
        const storedEntries = [];
        for (const [name, value] of Object.entries(parsed || {})) {
            const tileCacheKey = `${identity}:tile:${name}`;
            const estimatedBytes = Number(parsed.__sceneByteSizes && parsed.__sceneByteSizes[name]) || 1024;
            setPrecomputedCacheValue(tileCacheKey, value, estimatedBytes);
            storedEntries.push({ key: tileCacheKey, value: { key: tileCacheKey, value, bytes: estimatedBytes, lastAccess: Date.now(), expiresAt: Date.now() + PRECOMPUTED_CACHE_TTL_MS, manifestIdentity: identity } });
        }
        await writeStoredSceneValues('tiles', storedEntries);
        await pruneStoredSceneTiles();
        return parsed;
    }

    async function loadPrecomputedTile(manifest, tileKey, options = {}) {
        const tileMeta = manifest.tiles && manifest.tiles[tileKey];
        if (!tileMeta) return null;
        const cacheKey = `${await manifestCacheIdentity(manifest)}:tile:${tileMeta.file}`;
        const cached = getPrecomputedCacheValue(cacheKey);
        if (cached) { debugScene('scene-tile-memory-hit', { tileKey }); return typeof cached === 'string' ? JSON.parse(cached) : cached; }
        const stored = await readStoredSceneValue('tiles', cacheKey);
        if (stored && stored.value && (!stored.expiresAt || stored.expiresAt > Date.now())) {
            const serialized = typeof stored.value === 'string' ? stored.value : JSON.stringify(stored.value);
            setPrecomputedCacheValue(cacheKey, serialized, Number(stored.bytes) || undefined);
            touchStoredSceneTile(cacheKey, stored).catch(() => {});
            debugScene('scene-tile-idb-hit', { tileKey });
            return JSON.parse(serialized);
        }
        debugScene('scene-tile-miss', { tileKey });
        const pack = await loadPrecomputedPack(manifest, tileMeta.pack, [tileMeta.file], options);
        return pack && pack[tileMeta.file] ? JSON.parse(pack[tileMeta.file]) : null;
    }

    async function streamPrecomputedTiles(manifest, tileKeys, onTile, options = {}) {
        const identity = await manifestCacheIdentity(manifest);
        const missingByPack = new Map();
        let processed = 0;
        const consume = async (tileKey, serialized) => {
            if (options.signal && options.signal.aborted) throw new Error('scene request aborted');
            const tile = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
            if (!tile) return;
            await onTile(tile, tileKey);
            processed++;
            debugScene('scene-tile-consumed', { tileKey, processed });
        };
        for (const tileKey of tileKeys) {
            const meta = manifest.tiles && manifest.tiles[tileKey];
            if (!meta) continue;
            const cacheKey = `${identity}:tile:${meta.file}`;
            let serialized = getPrecomputedCacheValue(cacheKey);
            if (!serialized) {
                const stored = await readStoredSceneValue('tiles', cacheKey);
                if (stored && stored.value && (!stored.expiresAt || stored.expiresAt > Date.now())) {
                    serialized = typeof stored.value === 'string' ? stored.value : JSON.stringify(stored.value);
                    setPrecomputedCacheValue(cacheKey, serialized, Number(stored.bytes) || undefined);
                    touchStoredSceneTile(cacheKey, stored).catch(() => {});
                }
            }
            if (serialized) { await consume(tileKey, serialized); continue; }
            if (!missingByPack.has(meta.pack)) missingByPack.set(meta.pack, []);
            missingByPack.get(meta.pack).push({ tileKey, file: meta.file });
        }
        await mapWithConcurrency([...missingByPack.entries()], options.scenePackConcurrency || 2, async ([pack, entries]) => {
            const parsed = await loadPrecomputedPack(manifest, pack, entries.map(entry => entry.file), options);
            for (const entry of entries) if (parsed && parsed[entry.file]) await consume(entry.tileKey, parsed[entry.file]);
        }, options.signal);
        return processed;
    }

    function readOverpassGeometry(element, origin) {
        const geometry = Array.isArray(element.geometry) ? element.geometry : [];
        return geometry.filter(p => finite(p.lat) && finite(p.lon)).map(p => projectPoint(Number(p.lat), Number(p.lon), origin));
    }

    function computeBounds(points) {
        if (!points || !points.length) return null;
        return points.reduce((box, p) => ({
            minX: Math.min(box.minX, p.x), maxX: Math.max(box.maxX, p.x),
            minY: Math.min(box.minY, p.y), maxY: Math.max(box.maxY, p.y)
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    }

    function buildTerrainGrid(terrainSamples, cellSize = TERRAIN_GRID_CELL_METERS) {
        const cells = Object.create(null);
        let count = 0;
        let minCellX = Infinity, maxCellX = -Infinity, minCellY = Infinity, maxCellY = -Infinity;
        (terrainSamples || []).forEach((sample, index) => {
            if (!finite(sample.x) || !finite(sample.y) || !finite(sample.elevation)) return;
            const cellX = Math.floor(Number(sample.x) / cellSize);
            const cellY = Math.floor(Number(sample.y) / cellSize);
            const key = `${cellX}:${cellY}`;
            if (!cells[key]) cells[key] = [];
            cells[key].push(index);
            count++;
            minCellX = Math.min(minCellX, cellX); maxCellX = Math.max(maxCellX, cellX);
            minCellY = Math.min(minCellY, cellY); maxCellY = Math.max(maxCellY, cellY);
        });
        return { cellSize, cells, count, minCellX, maxCellX, minCellY, maxCellY };
    }

    function buildBuildingGrid(buildings, cellSize = BUILDING_GRID_CELL_METERS) {
        const cells = Object.create(null);
        (buildings || []).forEach((building, index) => {
            const bounds = building.bounds || computeBounds(building.polygon);
            if (!bounds) return;
            building.bounds = bounds;
            const minX = Math.floor(bounds.minX / cellSize), maxX = Math.floor(bounds.maxX / cellSize);
            const minY = Math.floor(bounds.minY / cellSize), maxY = Math.floor(bounds.maxY / cellSize);
            for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
                const key = `${x}:${y}`;
                if (!cells[key]) cells[key] = [];
                cells[key].push(index);
            }
        });
        return { cellSize, cells };
    }

    function rayBuildingCandidateIndices(point, direction, grid, maxDistance = MAX_SHADOW_RAY_DISTANCE_METERS) {
        if (!grid || !grid.cells) return null;
        const result = new Set();
        const step = Math.max(25, Number(grid.cellSize) / 2);
        for (let distance = 0; distance <= maxDistance; distance += step) {
            const x = point.x + direction.x * distance;
            const y = point.y + direction.y * distance;
            const cellX = Math.floor(x / grid.cellSize), cellY = Math.floor(y / grid.cellSize);
            // Neighbor cells make the sampled ray conservative near cell and
            // polygon boundaries; exact polygon intersection remains final.
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                for (const index of grid.cells[`${cellX + dx}:${cellY + dy}`] || []) result.add(index);
            }
        }
        return [...result];
    }

    function parseOverpassData(data, origin) {
        const buildings = [];
        const tunnels = [];
        const seenBuildings = new Set();
        const seenTunnels = new Set();
        for (const element of (data && data.elements) || []) {
            const tags = element.tags || {};
            const points = readOverpassGeometry(element, origin);
            if (points.length < 2) continue;
            const id = element.id !== undefined ? String(element.id) : `geometry:${points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(';')}`;
            const isTunnel = tags.tunnel === 'yes' || tags.covered === 'yes' || tags.covered === 'true';
            if (isTunnel && !seenTunnels.has(id)) {
                seenTunnels.add(id);
                tunnels.push({ id: element.id, line: points, bounds: computeBounds(points), tags: {
                    tunnel: tags.tunnel || '', covered: tags.covered || '', layer: tags.layer || ''
                }});
            }
            const buildingTag = tags.building || tags['building:part'];
            if (points.length >= 3 && buildingTag && !seenBuildings.has(id)) {
                seenBuildings.add(id);
                buildings.push({
                    id: element.id,
                    polygon: points,
                    bounds: computeBounds(points),
                    height: parseHeight(tags),
                    heightEstimated: !tags.height && !tags['building:levels'],
                    ground: null,
                    relevantProfileIndices: [],
                    tags: { building: buildingTag, height: tags.height || '', levels: tags['building:levels'] || '' }
                });
            }
        }
        return { buildings, tunnels, available: data && data.available !== false };
    }

    async function loadOverpassData(bbox, origin, options) {
        // Cache raw OSM elements by deterministic tile bbox, then project them
        // for each route origin. This lets overlapping candidate routes share
        // one public API response without mixing local coordinate systems.
        const key = bboxKey(bbox);
        const cached = getExpiringCacheValue(overpassCache, key);
        if (cached !== undefined) {
            try {
                return parseOverpassData(await cached, origin);
            } catch (error) {
                const current = getExpiringCacheValue(overpassCache, key);
                if (current === cached) overpassCache.delete(key);
                throw error;
            }
        }
        const query = `[out:json][timeout:15];(way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["building:part"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["tunnel"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["covered"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out tags geom;`;
        const promise = fetchJsonWithTimeout(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`, {
            signal: options.signal,
            timeoutMs: options.timeoutMs || 12000
        }).then(data => ({ elements: Array.isArray(data && data.elements) ? data.elements : [], available: true }));
        setExpiringCacheValue(overpassCache, key, promise, OVERPASS_CACHE_MAX_ENTRIES);
        try {
            return parseOverpassData(await promise, origin);
        } catch (error) {
            const current = getExpiringCacheValue(overpassCache, key);
            if (current === promise) overpassCache.delete(key);
            throw error;
        }
    }

    function mergeOverpassData(results) {
        const buildings = new Map();
        const tunnels = new Map();
        for (const result of results) {
            for (const building of result.buildings || []) {
                const key = building.id !== undefined ? String(building.id) : `building:${building.polygon.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(';')}`;
                if (!buildings.has(key)) buildings.set(key, building);
            }
            for (const tunnel of result.tunnels || []) {
                const key = tunnel.id !== undefined ? String(tunnel.id) : `tunnel:${tunnel.line.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(';')}`;
                if (!tunnels.has(key)) tunnels.set(key, tunnel);
            }
        }
        return {
            buildings: [...buildings.values()],
            tunnels: [...tunnels.values()],
            available: results.length > 0 && results.every(result => result.available)
        };
    }

    function quantizePoint(lat, lng) {
        return `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;
    }

    function destinationPoint(lat, lng, bearing, distance) {
        const angular = distance / EARTH_RADIUS;
        const latRad = lat * RAD;
        const bearingRad = bearing * RAD;
        const destLat = Math.asin(Math.sin(latRad) * Math.cos(angular) + Math.cos(latRad) * Math.sin(angular) * Math.cos(bearingRad));
        const destLng = lng * RAD + Math.atan2(Math.sin(bearingRad) * Math.sin(angular) * Math.cos(latRad), Math.cos(angular) - Math.sin(latRad) * Math.sin(destLat));
        return { lat: destLat * DEG, lng: destLng * DEG };
    }

    function sampleIndices(coordinates, maxSamples) {
        const count = Math.min(maxSamples, Math.max(1, coordinates.length));
        const indices = [];
        for (let i = 0; i < count; i++) indices.push(Math.round(i * (coordinates.length - 1) / Math.max(1, count - 1)));
        return [...new Set(indices)];
    }

    function makeTerrainPlan(coordinates, options) {
        const dateObj = options.dateObj instanceof Date ? options.dateObj : new Date(options.startTimestamp || Date.now());
        const durationSec = Number(options.durationSec) || 0;
        const timeLookup = (Array.isArray(options.timeLookup) ||
            (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(options.timeLookup))) ? options.timeLookup : null;
        const indices = sampleIndices(coordinates, 24);
        const distances = [250, 600, 1200, 2400];
        const pointRecords = [];
        const pointMap = new Map();
        const addPoint = (lat, lng) => {
            const key = quantizePoint(lat, lng);
            if (!pointMap.has(key)) {
                const record = { key, lat, lng };
                pointMap.set(key, record);
                pointRecords.push(record);
            }
            return key;
        };
        const profiles = [];
        indices.forEach((coordinateIndex, profileIndex) => {
            const c = coordinates[coordinateIndex];
            const lat = Number(c[1]);
            const lng = Number(c[0]);
            const elapsed = timeLookup && finite(timeLookup[coordinateIndex]) ? Number(timeLookup[coordinateIndex]) : durationSec * coordinateIndex / Math.max(1, coordinates.length - 1);
            let direction = 180;
            let elevation = 30;
            if (root.SunCalc && typeof root.SunCalc.getPosition === 'function') {
                const sun = root.SunCalc.getPosition(new Date(dateObj.getTime() + elapsed * 1000), lat, lng);
                direction = finite(sun.azimuth) ? Number(sun.azimuth) : direction;
                elevation = finite(sun.altitude) ? Number(sun.altitude) : elevation;
            }
            const anchorKey = addPoint(lat, lng);
            const probeKeys = distances.map(distance => {
                const probe = destinationPoint(lat, lng, direction, distance);
                return addPoint(probe.lat, probe.lng);
            });
            profiles.push({ coordinateIndex, profileIndex, anchorKey, direction, elevation, distances, probeKeys });
        });
        return { pointRecords, profiles };
    }

    async function loadTerrainSamples(pointRecords, options) {
        const elevations = new Map();
        const missing = [];
        for (const record of pointRecords) {
            const cached = getExpiringCacheValue(terrainCache, record.key);
            if (cached !== undefined) elevations.set(record.key, cached);
            else missing.push(record);
        }
        const batchSize = 80;
        for (let i = 0; i < missing.length; i += batchSize) {
            const batch = missing.slice(i, i + batchSize);
            const newRecords = batch.filter(record => !terrainInflight.has(record.key));
            if (newRecords.length) {
                const requestBatch = newRecords.slice(0, batchSize);
                const locations = requestBatch.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
                const request = fetchJsonWithTimeout(`${TERRAIN_ENDPOINT}${encodeURIComponent(locations)}`, {
                    signal: options.signal,
                    timeoutMs: options.terrainTimeoutMs || 10000
                }).then(data => {
                    const values = new Map();
                    const results = Array.isArray(data && data.results) ? data.results : [];
                    requestBatch.forEach((record, index) => {
                        const value = results[index] && Number(results[index].elevation);
                        if (Number.isFinite(value)) values.set(record.key, value);
                    });
                    return values;
                });
                requestBatch.forEach(record => {
                    let valuePromise;
                    valuePromise = request.then(values => values.has(record.key) ? values.get(record.key) : null)
                        .then(value => {
                            if (Number.isFinite(value)) setExpiringCacheValue(terrainCache, record.key, value, TERRAIN_CACHE_MAX_ENTRIES);
                            return value;
                        })
                        .finally(() => {
                            if (terrainInflight.get(record.key) === valuePromise) terrainInflight.delete(record.key);
                        });
                    terrainInflight.set(record.key, valuePromise);
                });
            }
            try {
                await Promise.all(batch.map(async record => {
                    const pending = terrainInflight.get(record.key);
                    if (!pending) return;
                    const value = await pending;
                    if (Number.isFinite(value)) {
                        setExpiringCacheValue(terrainCache, record.key, value, TERRAIN_CACHE_MAX_ENTRIES);
                        elevations.set(record.key, value);
                    }
                }));
            } catch (error) {
                if (options.signal && options.signal.aborted) throw error;
                // Public DEM service limits are expected; retain partial coverage.
                break;
            }
        }
        return elevations;
    }

    async function fetchSceneForRoute(coordinates, options = {}) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
        const routeLengthMeters = calculateRouteLengthMeters(coordinates);
        const maxRouteMeters = Number(options.maxRouteMeters || 250000);
        // Large corridors make Overpass bboxes and DEM probes disproportionately
        // expensive. OSRM remains available; only the optional scene layer is
        // skipped for such routes.
        if (routeLengthMeters > maxRouteMeters) { debugScene('precision-heuristic', { reason: 'ROUTE_TOO_LONG', routeLengthMeters }); return null; }
        const originCoordinate = coordinates[Math.floor(coordinates.length / 2)];
        const origin = { lat: Number(originCoordinate[1]), lng: Number(originCoordinate[0]) };
        const bbox = routeBbox(coordinates, options.paddingMeters || 250);
        if (!bbox) return null;
        const maxBboxSpanDeg = Number(options.maxBboxSpanDeg || 1.5);
        const wholeMetrics = bboxMetrics(bbox);
        if (!wholeMetrics) return null;
        const maxBboxAreaKm2 = Number(options.maxBboxAreaKm2 || DEFAULT_MAX_BBOX_AREA_KM2);
        const needsTiles = (bbox.north - bbox.south) > maxBboxSpanDeg ||
            (bbox.east - bbox.west) > maxBboxSpanDeg || wholeMetrics.areaKm2 > maxBboxAreaKm2;
        const tiles = needsTiles ? splitRouteIntoSceneTiles(coordinates, options) : [{ bbox, routeCoordinates: coordinates }];
        const maxSceneTiles = Number(options.maxSceneTiles || DEFAULT_MAX_SCENE_TILES);
        const totalTileAreaKm2 = tiles.reduce((total, tile) => total + (bboxMetrics(tile.bbox)?.areaKm2 || Infinity), 0);
        const maxSceneTotalAreaKm2 = Number(options.maxSceneTotalAreaKm2 || DEFAULT_MAX_SCENE_TOTAL_AREA_KM2);
        if (!tiles.length || tiles.length > maxSceneTiles || totalTileAreaKm2 > maxSceneTotalAreaKm2) {
            // The optional scene layer must never turn a large route into an
            // unbounded Overpass workload. OSRM remains available and the
            // router will keep the common heuristic comparison tier.
            debugScene('precision-heuristic', { reason: 'TOO_MANY_TILES', tileCount: tiles.length, totalTileAreaKm2 });
            return null;
        }
        const plan = makeTerrainPlan(coordinates, options);
        debugScene('overpass-start', { tileCount: tiles.length });
        const overpassPromise = (async () => {
            const results = [];
            for (const tile of tiles) {
                if (options.signal && options.signal.aborted) throw new Error('scene request aborted');
                try {
                    results.push(await loadOverpassData(tile.bbox, origin, options));
                } catch (error) {
                    if (options.signal && options.signal.aborted) throw error;
                    debugScene('overpass-failure', { reason: 'OVERPASS_FAILURE', message: String(error && error.message || error) });
                    results.push({ buildings: [], tunnels: [], available: false, error: String(error && error.message || error) });
                }
            }
            return mergeOverpassData(results);
        })().then(result => { debugScene('overpass-end', { buildings: result.buildings.length, tunnels: result.tunnels.length }); return result; });
        debugScene('dem-start', { points: plan.pointRecords.length });
        const terrainPromise = loadTerrainSamples(plan.pointRecords, options).catch(error => {
            if (options.signal && options.signal.aborted) throw error;
            debugScene('dem-failure', { reason: 'DEM_FAILURE', message: String(error && error.message || error) });
            return new Map();
        });
        const [overpass, terrain] = await Promise.all([overpassPromise, terrainPromise]);
        const baseRecord = plan.pointRecords[0];
        const baseElevation = baseRecord && terrain.has(baseRecord.key) ? terrain.get(baseRecord.key) : null;
        const terrainSamples = plan.pointRecords.map(record => {
            const local = projectPoint(record.lat, record.lng, origin);
            return { key: record.key, lat: record.lat, lng: record.lng, x: local.x, y: local.y, elevation: terrain.has(record.key) ? terrain.get(record.key) : null };
        });
        const profiles = plan.profiles.map(profile => ({
            coordinateIndex: profile.coordinateIndex,
            anchor: terrainSamples.find(p => p.key === profile.anchorKey) || null,
            direction: profile.direction,
            elevation: profile.elevation,
            distances: profile.distances,
            elevations: profile.probeKeys.map(key => terrain.has(key) ? terrain.get(key) : null)
        }));
        const allBuildings = overpass.buildings || [];
        const relevantBuildings = selectRelevantBuildings(allBuildings, profiles, MAX_SHADOW_RAY_DISTANCE_METERS);
        const terrainGrid = buildTerrainGrid(terrainSamples);
        assignBuildingGroundElevations(relevantBuildings, terrainSamples, BUILDING_GROUND_MAX_SAMPLE_DISTANCE_METERS, terrainGrid);
        const buildingGrid = buildBuildingGrid(relevantBuildings);
        const terrainAvailable = terrainSamples.some(p => finite(p.elevation));
        const buildingGroundAvailable = relevantBuildings.every(building => finite(building.ground));
        const segmentCoverage = Array.from({ length: Math.max(0, coordinates.length - 1) }, (_, segmentIndex) => {
            const nearbyProfile = profiles
                .filter(profile => profile.anchor && profile.elevations.every(finite))
                .sort((a, b) => Math.abs(a.coordinateIndex - segmentIndex) - Math.abs(b.coordinateIndex - segmentIndex))[0];
            const profileSpacing = coordinates.length / Math.max(1, profiles.length - 1);
            const terrainCovered = !!nearbyProfile && Math.abs(nearbyProfile.coordinateIndex - segmentIndex) <= Math.max(2, profileSpacing * 1.5);
            const nearbyRelevantBuildings = relevantBuildings.filter(building =>
                (building.relevantProfileIndices || []).some(index =>
                    Math.abs(Number(index) - segmentIndex) <= Math.max(2, profileSpacing * 1.5)));
            const segmentBuildingGround = nearbyRelevantBuildings.every(building => finite(building.ground));
            return {
                buildings: !!overpass.available,
                tunnels: !!overpass.available,
                terrain: terrainCovered,
                buildingGround: !!overpass.available && segmentBuildingGround
            };
        });
        const sceneResult = {
            origin,
            baseElevation: finite(baseElevation) ? baseElevation : null,
            // Only ray-relevant geometry is retained. Full Overpass geometry
            // can be hundreds of MB on mobile; diagnostics retain counts only.
            buildings: relevantBuildings,
            tunnels: overpass.tunnels || [],
            terrainSamples,
            terrainGrid,
            buildingGrid,
            terrainProfiles: profiles,
            segmentCoverage,
            coverage: {
                buildings: !!overpass.available,
                tunnels: !!overpass.available,
                terrain: terrainAvailable,
                buildingGround: !!overpass.available && buildingGroundAvailable,
                relevantBuildings: relevantBuildings.length,
                totalBuildings: allBuildings.length
            },
            diagnostics: { totalBuildings: allBuildings.length, relevantBuildings: relevantBuildings.length },
            // A route is scene-comparable only when the shared Overpass data
            // and every route segment's DEM profile are available. Partial
            // coverage remains attached for diagnostics but forces the common
            // heuristic comparison tier in ShadowRouter.
            precisionReady: !!overpass.available && terrainAvailable && buildingGroundAvailable &&
                segmentCoverage.length > 0 && segmentCoverage.every(segment => segment.terrain && segment.buildingGround),
            source: 'OpenStreetMap Overpass + OpenTopoData ASTER30m',
            sampleCount: terrainSamples.length
        };
        debugScene(sceneResult.precisionReady ? 'precision-ready' : 'precision-partial', {
            reason: sceneResult.precisionReady ? null : 'SEGMENT_COVERAGE_INCOMPLETE', coverage: sceneResult.coverage
        });
        return sceneResult;
    }

    async function fetchPrecomputedSceneForRouteSingle(coordinates, options = {}) {
        if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
        const routeLengthMeters = calculateRouteLengthMeters(coordinates);
        if (routeLengthMeters > Number(options.maxRouteMeters || 250000)) return null;
        const regionBounds = options.precomputedRegionBounds || { south: -90, west: -180, north: 90, east: 180 };
        const routeLatitudes = coordinates.map(coordinate => Number(coordinate[1])).filter(Number.isFinite);
        const routeLongitudes = coordinates.map(coordinate => Number(coordinate[0])).filter(Number.isFinite);
        if (!routeLatitudes.length || !routeLongitudes.length ||
            Math.max(...routeLatitudes) < Number(regionBounds.south) || Math.min(...routeLatitudes) > Number(regionBounds.north) ||
            Math.max(...routeLongitudes) < Number(regionBounds.west) || Math.min(...routeLongitudes) > Number(regionBounds.east)) return null;
        const manifest = await loadPrecomputedManifest(options);
        if (!manifest || manifest.schema !== 2 || !manifest.tiles || !manifest.packs) return null;
        const tileKeys = routeSceneTileKeys(coordinates, manifest, options.precomputedPaddingMeters);
        // A 64-tile hard stop caused ordinary long routes to silently lose
        // all scene data. Keep a bounded safety cap, but allow chunked regional
        // archives to contribute partial/precision data first.
        const maxTiles = Number(options.maxPrecomputedTiles || 256);
        if (!tileKeys.length || tileKeys.length > maxTiles) return null;
        if (options.signal && options.signal.aborted) throw new Error('scene request aborted');
        const availableTileKeys = tileKeys.filter(key => manifest.tiles[key]);
        const missingTileKeys = tileKeys.filter(key => !manifest.tiles[key]);
        // Coastal cells, state boundaries and neighboring regional extracts
        // can leave a few padded tiles absent. Do not discard every usable
        // building/terrain tile; mark only affected route segments uncovered
        // so the router applies its common heuristic to those segments.
        if (!availableTileKeys.length) return null;
        const originCoordinate = coordinates[Math.floor(coordinates.length / 2)];
        const origin = { lat: Number(originCoordinate[1]), lng: Number(originCoordinate[0]) };
        const plan = makeTerrainPlan(coordinates, options);
        const selectionProfiles = plan.profiles.map(profile => {
            const coordinate = coordinates[profile.coordinateIndex];
            return {
                coordinateIndex: profile.coordinateIndex,
                anchor: projectPoint(Number(coordinate[1]), Number(coordinate[0]), origin),
                direction: profile.direction,
                elevation: profile.elevation
            };
        });
        const routePoints = coordinates.map(coordinate => projectPoint(Number(coordinate[1]), Number(coordinate[0]), origin));
        const routeBounds = computeBounds(routePoints);
        const buildings = new Map();
        const totalBuildingIds = new Set();
        const tunnels = new Map();
        const terrain = new Map();
        let processedTiles = 0;
        try {
            // Consume one tile at a time. Raw tile objects and non-relevant
            // building geometry become collectible immediately after this
            // callback instead of accumulating for the entire route.
            processedTiles = await streamPrecomputedTiles(manifest, availableTileKeys, tile => {
                const tileBuildingCandidates = [];
                for (const building of tile.buildings || []) {
                    const key = String(building.id || `building:${JSON.stringify(building.polygon)}`);
                    totalBuildingIds.add(key);
                    if (buildings.has(key)) continue;
                    const candidate = {
                        id: building.id,
                        polygon: (building.polygon || []).filter(point => Array.isArray(point) && finite(point[0]) && finite(point[1]))
                            .map(point => projectPoint(Number(point[0]), Number(point[1]), origin)),
                        height: Number(building.height) || 6,
                        heightEstimated: !!building.heightEstimated,
                        ground: finite(building.ground) ? Number(building.ground) : null,
                        relevantProfileIndices: []
                    };
                    if (candidate.polygon.length < 3) continue;
                    candidate.bounds = computeBounds(candidate.polygon);
                    if (routeBounds && candidate.bounds) {
                        const dx = Math.max(candidate.bounds.minX - routeBounds.maxX, routeBounds.minX - candidate.bounds.maxX, 0);
                        const dy = Math.max(candidate.bounds.minY - routeBounds.maxY, routeBounds.minY - candidate.bounds.maxY, 0);
                        if (Math.hypot(dx, dy) > MAX_SHADOW_RAY_DISTANCE_METERS) continue;
                    }
                    candidate.__sceneKey = key;
                    tileBuildingCandidates.push(candidate);
                }
                for (const relevant of selectRelevantBuildings(tileBuildingCandidates, selectionProfiles, MAX_SHADOW_RAY_DISTANCE_METERS)) {
                    const key = relevant.__sceneKey;
                    delete relevant.__sceneKey;
                    const existing = buildings.get(key);
                    if (!existing) buildings.set(key, relevant);
                    else existing.relevantProfileIndices = [...new Set([...(existing.relevantProfileIndices || []), ...(relevant.relevantProfileIndices || [])])];
                }
                for (const tunnel of tile.tunnels || []) {
                    const key = String(tunnel.id || `tunnel:${JSON.stringify(tunnel.line)}`);
                    if (!tunnels.has(key)) tunnels.set(key, {
                        id: tunnel.id,
                        line: (tunnel.line || []).filter(point => Array.isArray(point) && finite(point[0]) && finite(point[1]))
                            .map(point => projectPoint(Number(point[0]), Number(point[1]), origin))
                    });
                }
                for (const sample of tile.terrain || []) {
                    if (!Array.isArray(sample) || sample.length < 3 || !finite(sample[0]) || !finite(sample[1]) || !finite(sample[2])) continue;
                    const local = projectPoint(Number(sample[0]), Number(sample[1]), origin);
                    const key = quantizePoint(Number(sample[0]), Number(sample[1]));
                    if (!terrain.has(key)) terrain.set(key, {
                        key, lat: Number(sample[0]), lng: Number(sample[1]), x: local.x, y: local.y, elevation: Number(sample[2])
                    });
                }
            }, options);
        } catch (error) {
            if (options.signal && options.signal.aborted) throw error;
            return null;
        }
        if (processedTiles !== availableTileKeys.length) return null;
        const terrainSamples = [...terrain.values()];
        const terrainGrid = buildTerrainGrid(terrainSamples);
        const profiles = plan.profiles.map(profile => {
            const coordinate = coordinates[profile.coordinateIndex];
            const lat = Number(coordinate[1]);
            const lng = Number(coordinate[0]);
            const anchorPoint = projectPoint(lat, lng, origin);
            const anchorMatch = findNearestTerrainSample(anchorPoint, terrainSamples, 180, terrainGrid);
            const elevations = profile.distances.map(distance => {
                const probe = destinationPoint(lat, lng, Number(profile.direction), Number(distance));
                const match = findNearestTerrainSample(projectPoint(probe.lat, probe.lng, origin), terrainSamples, 180, terrainGrid);
                return match ? Number(match.sample.elevation) : null;
            });
            return {
                coordinateIndex: profile.coordinateIndex,
                anchor: anchorMatch ? anchorMatch.sample : null,
                direction: profile.direction,
                elevation: profile.elevation,
                distances: profile.distances,
                elevations
            };
        });
        const relevantBuildings = [...buildings.values()];
        const buildingGrid = buildBuildingGrid(relevantBuildings);
        const segmentCoverage = Array.from({ length: Math.max(0, coordinates.length - 1) }, (_, segmentIndex) => {
            const segmentBaseTileKeys = [
                sceneTileKeyForCoordinate(Number(coordinates[segmentIndex][1]), Number(coordinates[segmentIndex][0]), manifest),
                sceneTileKeyForCoordinate(Number(coordinates[segmentIndex + 1][1]), Number(coordinates[segmentIndex + 1][0]), manifest)
            ];
            // Missing padding reduces ray coverage but should not erase the
            // centerline's usable DEM/building data. A segment is uncovered
            // only when its actual road tile is absent.
            const tilesComplete = segmentBaseTileKeys.length > 0 && segmentBaseTileKeys.every(key => !!manifest.tiles[key]);
            const nearbyProfile = profiles
                .filter(profile => profile.anchor && profile.elevations.length > 0 && profile.elevations.every(finite))
                .sort((a, b) => Math.abs(a.coordinateIndex - segmentIndex) - Math.abs(b.coordinateIndex - segmentIndex))[0];
            const profileCoordinate = nearbyProfile && coordinates[nearbyProfile.coordinateIndex];
            const rayTilesComplete = !!profileCoordinate && [0, 250, 600, 1200, 2400, MAX_SHADOW_RAY_DISTANCE_METERS]
                .map(distance => distance === 0
                    ? { lat: Number(profileCoordinate[1]), lng: Number(profileCoordinate[0]) }
                    : destinationPoint(Number(profileCoordinate[1]), Number(profileCoordinate[0]), Number(nearbyProfile.direction), distance))
                .map(point => sceneTileKeyForCoordinate(point.lat, point.lng, manifest))
                .every(key => !!manifest.tiles[key]);
            const profileSpacing = coordinates.length / Math.max(1, profiles.length - 1);
            const terrainCovered = !!nearbyProfile && Math.abs(nearbyProfile.coordinateIndex - segmentIndex) <= Math.max(2, profileSpacing * 1.5);
            const nearbyRelevantBuildings = relevantBuildings.filter(building =>
                (building.relevantProfileIndices || []).some(index =>
                    Math.abs(Number(index) - segmentIndex) <= Math.max(2, profileSpacing * 1.5)));
            return {
                buildings: tilesComplete && rayTilesComplete,
                tunnels: tilesComplete,
                terrain: tilesComplete && rayTilesComplete && terrainCovered,
                buildingGround: tilesComplete && rayTilesComplete && nearbyRelevantBuildings.every(building => finite(building.ground)),
                tiles: tilesComplete,
                sunRayTiles: rayTilesComplete
            };
        });
        const terrainAvailable = terrainSamples.length > 0 && profiles.some(profile => profile.elevations.some(finite));
        const buildingGroundAvailable = relevantBuildings.every(building => finite(building.ground));
        const coveredSegments = segmentCoverage.filter(segment => segment.terrain && segment.buildingGround).length;
        const segmentCount = segmentCoverage.length;
        const precisionReady = terrainAvailable && buildingGroundAvailable && segmentCount > 0 &&
            coveredSegments === segmentCount && missingTileKeys.length === 0;
        return {
            origin,
            baseElevation: terrainSamples[0] && finite(terrainSamples[0].elevation) ? terrainSamples[0].elevation : null,
            buildings: relevantBuildings,
            tunnels: [...tunnels.values()],
            terrainSamples,
            terrainGrid,
            buildingGrid,
            terrainProfiles: profiles,
            segmentCoverage,
            coverage: {
                buildings: true,
                tunnels: true,
                terrain: terrainAvailable,
                buildingGround: buildingGroundAvailable,
                relevantBuildings: relevantBuildings.length,
                totalBuildings: totalBuildingIds.size,
                precomputedTiles: availableTileKeys.length,
                requestedTiles: tileKeys.length,
                missingTiles: missingTileKeys.length,
                coveredSegments,
                segmentCount,
                segmentRatio: segmentCount ? coveredSegments / segmentCount : 0
            },
            diagnostics: {
                totalBuildings: totalBuildingIds.size,
                relevantBuildings: relevantBuildings.length,
                missingTileKeys: missingTileKeys.slice(0, 64)
            },
            precisionReady,
            partial: !precisionReady && coveredSegments > 0,
            source: precomputedSourceLabel(manifest),
            dataVersion: manifest.dataVersion || null,
            profileResolution: manifest.profileResolution || null,
            sceneCoverage: {
                ...((manifest.sceneCoverage && typeof manifest.sceneCoverage === 'object') ? manifest.sceneCoverage : {}),
                precomputedTiles: availableTileKeys.length,
                requestedTiles: tileKeys.length,
                missingTiles: missingTileKeys.length,
                coveredSegments,
                segmentCount,
                segmentRatio: segmentCount ? coveredSegments / segmentCount : 0
            },
            sampleCount: terrainSamples.length,
            tileKeys: availableTileKeys,
            missingTileKeys
        };
    }

    function reprojectScenePoint(point, fromOrigin, toOrigin) {
        if (!point || !finite(point.x) || !finite(point.y) || !fromOrigin || !toOrigin) return point;
        const geo = unprojectPoint(Number(point.x), Number(point.y), fromOrigin);
        return projectPoint(geo.lat, geo.lng, toOrigin);
    }

    function mergePrecomputedScenes(parts, coordinates) {
        if (!parts.length) return null;
        if (parts.length === 1 && Number(parts[0].segmentOffset || 0) === 0 &&
            Array.isArray(parts[0].segmentCoverage) && parts[0].segmentCoverage.length === coordinates.length - 1) {
            return parts[0];
        }
        const center = coordinates[Math.floor(coordinates.length / 2)] || coordinates[0];
        const origin = { lat: Number(center[1]), lng: Number(center[0]) };
        const buildings = new Map();
        const tunnels = new Map();
        const terrain = new Map();
        const terrainProfiles = [];
        const segmentCoverage = Array.from({ length: Math.max(0, coordinates.length - 1) }, () => ({ buildings: false, tunnels: false, terrain: false, buildingGround: false }));
        const regions = [];
        for (const scene of parts) {
            regions.push({ region: scene.region || null, source: scene.source || null, dataVersion: scene.dataVersion || null, sceneCoverage: scene.sceneCoverage || null });
            for (const building of scene.buildings || []) {
                const id = String(building.id || `building:${JSON.stringify(building.polygon)}`);
                if (!buildings.has(id)) buildings.set(id, {
                    ...building,
                    polygon: (building.polygon || []).map(point => reprojectScenePoint(point, scene.origin, origin)),
                    bounds: null
                });
            }
            for (const tunnel of scene.tunnels || []) {
                const id = String(tunnel.id || `tunnel:${JSON.stringify(tunnel.line)}`);
                if (!tunnels.has(id)) tunnels.set(id, { ...tunnel, line: (tunnel.line || []).map(point => reprojectScenePoint(point, scene.origin, origin)) });
            }
            for (const sample of scene.terrainSamples || []) {
                const key = sample.key || `${Number(sample.lat).toFixed(5)},${Number(sample.lng).toFixed(5)}`;
                if (!terrain.has(key)) terrain.set(key, { ...sample, ...reprojectScenePoint(sample, scene.origin, origin) });
            }
            const segmentOffset = Number(scene.segmentOffset) || 0;
            for (const profile of scene.terrainProfiles || []) {
                terrainProfiles.push({
                    ...profile,
                    coordinateIndex: segmentOffset + Number(profile.coordinateIndex || 0),
                    anchor: profile.anchor ? { ...profile.anchor, ...reprojectScenePoint(profile.anchor, scene.origin, origin) } : null
                });
            }
            (scene.segmentCoverage || []).forEach((coverage, index) => {
                const targetIndex = segmentOffset + index;
                if (!segmentCoverage[targetIndex]) return;
                Object.keys(segmentCoverage[targetIndex]).forEach(key => { segmentCoverage[targetIndex][key] = segmentCoverage[targetIndex][key] || coverage[key] === true; });
            });
        }
        const coveredSegments = segmentCoverage.filter(segment => segment.terrain && segment.buildingGround).length;
        const complete = parts.every(scene => scene.precisionReady) && segmentCoverage.length > 0 && coveredSegments === segmentCoverage.length;
        const mergedBuildings = [...buildings.values()];
        const mergedTerrain = [...terrain.values()];
        const totalBuildings = parts.reduce((sum, scene) => sum + Number(scene.coverage && scene.coverage.totalBuildings || 0), 0);
        const missingTiles = parts.reduce((sum, scene) => sum + Number(scene.coverage && scene.coverage.missingTiles || 0), 0);
        const requestedTiles = parts.reduce((sum, scene) => sum + Number(scene.coverage && scene.coverage.requestedTiles || 0), 0);
        const precomputedTiles = parts.reduce((sum, scene) => sum + Number(scene.coverage && scene.coverage.precomputedTiles || 0), 0);
        return {
            ...parts[0], origin, buildings: mergedBuildings, tunnels: [...tunnels.values()], terrainSamples: mergedTerrain,
            terrainProfiles,
            terrainGrid: buildTerrainGrid(mergedTerrain), buildingGrid: buildBuildingGrid(mergedBuildings),
            segmentCoverage, coverage: {
                ...(parts[0].coverage || {}), regions: regions.length, relevantBuildings: buildings.size, totalBuildings,
                missingTiles, requestedTiles, precomputedTiles,
                coveredSegments, segmentCount: segmentCoverage.length,
                segmentRatio: segmentCoverage.length ? coveredSegments / segmentCoverage.length : 0
            },
            diagnostics: { totalBuildings, relevantBuildings: buildings.size },
            sceneRegions: regions, precisionReady: complete, partial: !complete && coveredSegments > 0, source: regions.map(region => region.source).filter(Boolean).join(' + ') || 'GitHub precomputed scene tiles',
            sceneCoverage: { regions: regions.map(region => region.region).filter(Boolean), partial: !complete, coveredSegments, segmentCount: segmentCoverage.length }
        };
    }

    function coordinateInsideBounds(coordinate, bounds) {
        if (!bounds || !Array.isArray(coordinate)) return false;
        const lat = Number(coordinate[1]);
        const lng = Number(coordinate[0]);
        return lat >= Number(bounds.south) && lat <= Number(bounds.north) &&
            lng >= Number(bounds.west) && lng <= Number(bounds.east);
    }

    function routeRunsInsideBounds(coordinates, bounds) {
        const runs = [];
        let start = null;
        for (let index = 0; index < coordinates.length; index++) {
            const inside = coordinateInsideBounds(coordinates[index], bounds);
            if (inside && start === null) start = index;
            if ((!inside || index === coordinates.length - 1) && start !== null) {
                const insideEnd = inside && index === coordinates.length - 1 ? index : index - 1;
                const runStart = Math.max(0, start - 1);
                const runEnd = Math.min(coordinates.length - 1, insideEnd + 1);
                if (runEnd > runStart) runs.push({ start: runStart, end: runEnd });
                start = null;
            }
        }
        return runs;
    }

    async function fetchPrecomputedSceneForRoute(coordinates, options = {}) {
        const candidates = options.precomputedManifestUrl
            ? [{ id: options.precomputedRegion || 'custom', url: options.precomputedManifestUrl, bounds: options.precomputedRegionBounds }]
            : (Array.isArray(options.precomputedRegions) && options.precomputedRegions.length
            ? options.precomputedRegions
            : PRECOMPUTED_REGION_MANIFESTS);
        const parts = [];
        for (const candidate of candidates) {
            if (!candidate || !candidate.url) continue;
            const bounds = candidate.bounds || options.precomputedRegionBounds;
            const explicitSingleManifest = !!options.precomputedManifestUrl;
            const runs = explicitSingleManifest || !bounds
                ? [{ start: 0, end: coordinates.length - 1 }]
                : routeRunsInsideBounds(coordinates, bounds);
            for (const run of runs) {
                const subset = coordinates.slice(run.start, run.end + 1);
                const subsetScene = await fetchPrecomputedSceneForRouteSingle(subset, {
                    ...options, precomputedManifestUrl: candidate.url, precomputedRegionBounds: bounds
                });
                if (!subsetScene) continue;
                subsetScene.region = candidate.id || subsetScene.region || null;
                subsetScene.segmentOffset = run.start;
                parts.push(subsetScene);
            }
        }
        return mergePrecomputedScenes(parts, coordinates);
    }

    function findNearestTerrainSample(point, terrainSamples, maxDistance = Infinity, terrainGrid = null) {
        let nearest = null;
        let nearestDistance = Infinity;
        const samples = terrainSamples || [];
        const consider = index => {
            const sample = samples[index];
            if (!sample || !finite(sample.elevation)) return;
            const distance = Math.hypot(point.x - sample.x, point.y - sample.y);
            if (distance < nearestDistance) { nearestDistance = distance; nearest = sample; }
        };
        if (terrainGrid && terrainGrid.cells && Number(terrainGrid.count) > 0 && finite(point.x) && finite(point.y)) {
            const cellSize = Number(terrainGrid.cellSize) || TERRAIN_GRID_CELL_METERS;
            const centerX = Math.floor(Number(point.x) / cellSize);
            const centerY = Math.floor(Number(point.y) / cellSize);
            const boundsRadius = Math.max(
                Math.abs(centerX - Number(terrainGrid.minCellX)), Math.abs(centerX - Number(terrainGrid.maxCellX)),
                Math.abs(centerY - Number(terrainGrid.minCellY)), Math.abs(centerY - Number(terrainGrid.maxCellY))
            );
            const maxRadius = Number.isFinite(maxDistance)
                ? Math.min(boundsRadius, Math.ceil(maxDistance / cellSize) + 1)
                : boundsRadius;
            for (let radius = 0; radius <= maxRadius; radius++) {
                for (let dx = -radius; dx <= radius; dx++) for (let dy = -radius; dy <= radius; dy++) {
                    if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
                    for (const index of terrainGrid.cells[`${centerX + dx}:${centerY + dy}`] || []) consider(index);
                }
                // Any unvisited cell is separated by at least roughly one
                // additional cell width; once farther than the best sample it
                // cannot change the exact nearest result.
                if (nearest && Math.max(0, radius - 1) * cellSize > nearestDistance) break;
            }
        } else {
            for (let index = 0; index < samples.length; index++) consider(index);
        }
        return nearest && nearestDistance <= maxDistance
            ? { sample: nearest, distance: nearestDistance }
            : null;
    }

    function assignBuildingGroundElevations(buildings, terrainSamples, maxDistance = BUILDING_GROUND_MAX_SAMPLE_DISTANCE_METERS, terrainGrid = null) {
        for (const building of buildings || []) {
            const bounds = building.bounds;
            const center = bounds
                ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
                : (building.polygon || []).reduce((sum, point, index, points) => ({
                    x: sum.x + point.x / Math.max(1, points.length),
                    y: sum.y + point.y / Math.max(1, points.length)
                }), { x: 0, y: 0 });
            const match = findNearestTerrainSample(center, terrainSamples, maxDistance, terrainGrid);
            if (match) {
                building.ground = Number(match.sample.elevation);
                building.groundSampleKey = match.sample.key;
                building.groundSampleDistanceMeters = match.distance;
                building.groundSource = 'OpenTopoData nearest DEM sample';
            } else {
                // Do not use the first route sample or zero as a fabricated
                // ground elevation for a distant/uncovered building.
                building.ground = null;
                building.groundSampleKey = null;
                building.groundSampleDistanceMeters = null;
                building.groundSource = 'unresolved';
            }
        }
    }

    function selectRelevantBuildings(buildings, profiles, maxRayDistance = MAX_SHADOW_RAY_DISTANCE_METERS) {
        const source = buildings || [];
        const spatialGrid = buildBuildingGrid(source);
        const matches = new Map();
        for (const profile of profiles || []) {
            if (!profile.anchor || !finite(profile.elevation) || Number(profile.elevation) <= -0.833) continue;
            const direction = {
                x: Math.sin(Number(profile.direction) * RAD),
                y: Math.cos(Number(profile.direction) * RAD)
            };
            const candidateIndices = rayBuildingCandidateIndices(profile.anchor, direction, spatialGrid, maxRayDistance) || [];
            for (const index of candidateIndices) {
                const building = source[index];
                if (!building || intersectRayWithPolygon(profile.anchor, direction, building.polygon, maxRayDistance) === null) continue;
                if (!matches.has(index)) matches.set(index, []);
                matches.get(index).push(profile.coordinateIndex);
            }
        }
        const relevantBuildings = [];
        source.forEach((building, index) => {
            const profileIndices = matches.get(index) || [];
            if (profileIndices.length > 0) {
                building.relevantProfileIndices = profileIndices;
                relevantBuildings.push(building);
            }
        });
        return relevantBuildings;
    }

    function nearestTerrainElevation(point, scene) {
        const match = findNearestTerrainSample(point, scene && scene.terrainSamples, Infinity, scene && scene.terrainGrid);
        return match ? Number(match.sample.elevation) : null;
    }

    function angularDifference(a, b) {
        return Math.abs(((a - b + 540) % 360) - 180);
    }

    function getNearestProfile(point, sunAzimuth, segmentIndex, scene) {
        let best = null;
        let bestScore = Infinity;
        for (const profile of scene.terrainProfiles || []) {
            if (!profile.anchor) continue;
            if (!Array.isArray(profile.elevations) || !profile.elevations.every(finite)) continue;
            const spatial = Math.hypot(point.x - profile.anchor.x, point.y - profile.anchor.y) / 1000;
            const directional = angularDifference(Number(profile.direction) || 0, sunAzimuth) / 90;
            const indexPenalty = Math.abs((profile.coordinateIndex || 0) - (segmentIndex || 0)) / 10;
            const score = spatial + directional + indexPenalty;
            if (score < bestScore) { bestScore = score; best = profile; }
        }
        return best;
    }

    function getSegmentCoverage(scene, segmentIndex) {
        if (scene && Array.isArray(scene.segmentCoverage) && scene.segmentCoverage[segmentIndex]) {
            return scene.segmentCoverage[segmentIndex];
        }
        return (scene && scene.coverage) || { buildings: false, terrain: false, tunnels: false };
    }

    function getSegmentOcclusion(p1, p2, sunPosition, scene, segmentIndex) {
        if (!scene || !sunPosition || !finite(sunPosition.altitude) || !finite(sunPosition.azimuth)) return null;
        if (sunPosition.altitude <= -6) return { shadeScore: 1, source: 'night', buildingBlocked: false, terrainBlocked: false, tunnel: false };
        const origin = scene.origin;
        if (!origin) return null;
        const point = projectPoint(Number(p1[0]), Number(p1[1]), origin);
        const direction = { x: Math.sin(Number(sunPosition.azimuth) * RAD), y: Math.cos(Number(sunPosition.azimuth) * RAD) };
        const segmentCoverage = getSegmentCoverage(scene, segmentIndex);
        const roadElevation = nearestTerrainElevation(point, scene);
        let tunnel = false;
        for (const tunnelData of segmentCoverage.tunnels ? (scene.tunnels || []) : []) {
            if (distanceToPolyline(point, tunnelData.line) < 14 || distanceToPolyline(projectPoint(Number(p2[0]), Number(p2[1]), origin), tunnelData.line) < 14) {
                tunnel = true;
                break;
            }
        }
        if (tunnel) return { shadeScore: 1, source: 'tunnel', buildingBlocked: false, terrainBlocked: false, tunnel: true };

        let buildingBlocked = false;
        if (segmentCoverage.buildings && segmentCoverage.buildingGround !== false) {
            const buildings = scene.buildings || [];
            const candidateIndices = rayBuildingCandidateIndices(point, direction, scene.buildingGrid, MAX_SHADOW_RAY_DISTANCE_METERS);
            const candidates = candidateIndices ? candidateIndices.map(index => buildings[index]).filter(Boolean) : buildings;
            for (const building of candidates) {
                const bounds = building.bounds;
                if (bounds && (direction.x > 0 ? bounds.maxX < point.x : bounds.minX > point.x)) continue;
                if (bounds && (direction.y > 0 ? bounds.maxY < point.y : bounds.minY > point.y)) continue;
                const hitDistance = intersectRayWithPolygon(point, direction, building.polygon, MAX_SHADOW_RAY_DISTANCE_METERS);
                if (hitDistance === null) continue;
                if (!finite(building.ground)) continue;
                // A hand-built/test scene may omit route DEM samples.  In
                // that case use the building's explicitly supplied ground as
                // a conservative local reference; never use an unrelated
                // first sample or an implicit zero for fetched buildings.
                const roadZ = finite(roadElevation) ? Number(roadElevation) : Number(building.ground);
                const lineZ = roadZ + Math.tan(Number(sunPosition.altitude) * RAD) * hitDistance;
                if (Number(building.ground) + Number(building.height || 0) >= lineZ - 1.5) {
                    buildingBlocked = true;
                    break;
                }
            }
        }

        let terrainBlocked = false;
        const profile = segmentCoverage.terrain ? getNearestProfile(point, Number(sunPosition.azimuth), segmentIndex, scene) : null;
        if (profile && finite(roadElevation)) {
            terrainBlocked = isTerrainRayOccluded(Number(roadElevation), Number(sunPosition.altitude), profile.distances, profile.elevations, 2);
        }
        if (buildingBlocked && terrainBlocked) return { shadeScore: 1, source: 'building+terrain', buildingBlocked, terrainBlocked, tunnel: false };
        if (buildingBlocked) return { shadeScore: 0.88, source: 'building', buildingBlocked, terrainBlocked, tunnel: false };
        if (terrainBlocked) return { shadeScore: 0.78, source: 'terrain', buildingBlocked, terrainBlocked, tunnel: false };
        if (segmentCoverage.buildingGround === false && !terrainBlocked) {
            return { shadeScore: null, source: 'heuristic', buildingBlocked, terrainBlocked, tunnel: false };
        }
        if (segmentCoverage.buildings || segmentCoverage.terrain || segmentCoverage.tunnels) {
            return { shadeScore: 0, source: 'scene-clear', buildingBlocked, terrainBlocked, tunnel: false };
        }
        return { shadeScore: null, source: 'heuristic', buildingBlocked, terrainBlocked, tunnel: false };
    }

    return {
        projectPoint,
        unprojectPoint,
        pointInPolygon,
        intersectRayWithPolygon,
        isTerrainRayOccluded,
        calculateDistanceMeters,
        routeBbox,
        bboxMetrics,
        splitRouteIntoSceneTiles,
        buildTerrainGrid,
        buildBuildingGrid,
        findNearestTerrainSample,
        fetchPrecomputedSceneForRoute,
        fetchSceneForRoute,
        getSegmentOcclusion,
        calculateRouteLengthMeters,
        getCacheStats: () => ({
            overpass: overpassCache.size,
            terrain: terrainCache.size,
            precomputedEntries: precomputedTileCache.size,
            precomputedParsedEntries: [...precomputedTileCache.values()].filter(record => typeof record.value !== 'string').length,
            precomputedBytes: precomputedTileCacheBytes,
            precomputedMaxBytes: PRECOMPUTED_CACHE_MAX_BYTES,
            precomputedPersistentMaxBytes: PRECOMPUTED_PERSISTENT_CACHE_MAX_BYTES,
            ttlMs: CACHE_TTL_MS
        }),
        clearPrecomputedMemoryCache: () => {
            precomputedTileCache.clear();
            precomputedTileCacheBytes = 0;
            precomputedTileInflight.clear();
        },
        clearCaches: () => {
            overpassCache.clear();
            terrainCache.clear();
            terrainInflight.clear();
            precomputedTileCache.clear();
            precomputedTileCacheBytes = 0;
            precomputedTileInflight.clear();
            precomputedManifestCache.clear();
            precomputedManifestInflight.clear();
        }
    };
});
