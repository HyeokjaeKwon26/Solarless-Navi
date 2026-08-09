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
    const overpassCache = new Map();
    const terrainCache = new Map();
    const terrainInflight = new Map();

    function finite(value) {
        return value !== null && value !== '' && Number.isFinite(Number(value));
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

    function bboxKey(bbox) {
        return [bbox.south, bbox.west, bbox.north, bbox.east].map(v => Number(v).toFixed(3)).join(',');
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

    async function loadOverpassData(bbox, origin, options) {
        // Local projected coordinates depend on the origin. Include it in the
        // cache key so two nearby routes cannot reuse shifted geometry.
        const key = `${bboxKey(bbox)}|${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`;
        const cached = getExpiringCacheValue(overpassCache, key);
        if (cached !== undefined) return cached;
        const query = `[out:json][timeout:15];(way["building"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["building:part"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["tunnel"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["covered"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););out tags geom;`;
        const promise = fetchJsonWithTimeout(`${OVERPASS_ENDPOINT}?data=${encodeURIComponent(query)}`, {
            signal: options.signal,
            timeoutMs: options.timeoutMs || 12000
        }).then(data => {
            const buildings = [];
            const tunnels = [];
            const seen = new Set();
            for (const element of (data && data.elements) || []) {
                const tags = element.tags || {};
                const points = readOverpassGeometry(element, origin);
                if (points.length < 2) continue;
                const isTunnel = tags.tunnel === 'yes' || tags.covered === 'yes' || tags.covered === 'true';
                if (isTunnel) {
                    tunnels.push({ id: element.id, line: points, bounds: computeBounds(points), tags: {
                        tunnel: tags.tunnel || '', covered: tags.covered || '', layer: tags.layer || ''
                    }});
                }
                const buildingTag = tags.building || tags['building:part'];
                if (points.length >= 3 && buildingTag && !seen.has(element.id)) {
                    seen.add(element.id);
                    buildings.push({
                        id: element.id,
                        polygon: points,
                        bounds: computeBounds(points),
                        height: parseHeight(tags),
                        heightEstimated: !tags.height && !tags['building:levels'],
                        ground: 0,
                        tags: { building: buildingTag, height: tags.height || '', levels: tags['building:levels'] || '' }
                    });
                }
            }
            return { buildings, tunnels, available: true };
        });
        setExpiringCacheValue(overpassCache, key, promise, OVERPASS_CACHE_MAX_ENTRIES);
        try {
            return await promise;
        } catch (error) {
            const current = getExpiringCacheValue(overpassCache, key);
            if (current === promise) overpassCache.delete(key);
            throw error;
        }
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
        if (routeLengthMeters > maxRouteMeters) return null;
        const originCoordinate = coordinates[Math.floor(coordinates.length / 2)];
        const origin = { lat: Number(originCoordinate[1]), lng: Number(originCoordinate[0]) };
        const bbox = routeBbox(coordinates, options.paddingMeters || 250);
        if (!bbox) return null;
        const maxBboxSpanDeg = Number(options.maxBboxSpanDeg || 1.5);
        if ((bbox.north - bbox.south) > maxBboxSpanDeg || (bbox.east - bbox.west) > maxBboxSpanDeg) {
            // A single large Overpass corridor is more likely to hit service
            // limits than to improve the estimate.  Keep OSRM usable and let
            // ShadowRouter retain the common heuristic comparison tier.
            return null;
        }
        const plan = makeTerrainPlan(coordinates, options);
        const overpassPromise = loadOverpassData(bbox, origin, options).catch(error => {
            if (options.signal && options.signal.aborted) throw error;
            return { buildings: [], tunnels: [], available: false, error: String(error && error.message || error) };
        });
        const terrainPromise = loadTerrainSamples(plan.pointRecords, options).catch(error => {
            if (options.signal && options.signal.aborted) throw error;
            return new Map();
        });
        const [overpass, terrain] = await Promise.all([overpassPromise, terrainPromise]);
        const baseRecord = plan.pointRecords[0];
        const baseElevation = baseRecord && terrain.has(baseRecord.key) ? terrain.get(baseRecord.key) : null;
        const terrainSamples = plan.pointRecords.map(record => {
            const local = projectPoint(record.lat, record.lng, origin);
            return { key: record.key, lat: record.lat, lng: record.lng, x: local.x, y: local.y, elevation: terrain.has(record.key) ? terrain.get(record.key) : null };
        });
        assignBuildingGroundElevations(overpass.buildings || [], terrainSamples);
        const profiles = plan.profiles.map(profile => ({
            coordinateIndex: profile.coordinateIndex,
            anchor: terrainSamples.find(p => p.key === profile.anchorKey) || null,
            direction: profile.direction,
            elevation: profile.elevation,
            distances: profile.distances,
            elevations: profile.probeKeys.map(key => terrain.has(key) ? terrain.get(key) : null)
        }));
        const terrainAvailable = terrainSamples.some(p => finite(p.elevation));
        const buildingGroundAvailable = (overpass.buildings || []).every(building => finite(building.ground));
        const segmentCoverage = Array.from({ length: Math.max(0, coordinates.length - 1) }, (_, segmentIndex) => {
            const nearbyProfile = profiles
                .filter(profile => profile.anchor && profile.elevations.every(finite))
                .sort((a, b) => Math.abs(a.coordinateIndex - segmentIndex) - Math.abs(b.coordinateIndex - segmentIndex))[0];
            const profileSpacing = coordinates.length / Math.max(1, profiles.length - 1);
            const terrainCovered = !!nearbyProfile && Math.abs(nearbyProfile.coordinateIndex - segmentIndex) <= Math.max(2, profileSpacing * 1.5);
            return {
                buildings: !!overpass.available,
                tunnels: !!overpass.available,
                terrain: terrainCovered
            };
        });
        return {
            origin,
            baseElevation: finite(baseElevation) ? baseElevation : null,
            buildings: overpass.buildings || [],
            tunnels: overpass.tunnels || [],
            terrainSamples,
            terrainProfiles: profiles,
            segmentCoverage,
            coverage: {
                buildings: !!overpass.available,
                tunnels: !!overpass.available,
                terrain: terrainAvailable,
                buildingGround: !!overpass.available && buildingGroundAvailable
            },
            // A route is scene-comparable only when the shared Overpass data
            // and every route segment's DEM profile are available. Partial
            // coverage remains attached for diagnostics but forces the common
            // heuristic comparison tier in ShadowRouter.
            precisionReady: !!overpass.available && terrainAvailable && buildingGroundAvailable &&
                segmentCoverage.length > 0 && segmentCoverage.every(segment => segment.terrain),
            source: 'OpenStreetMap Overpass + OpenTopoData ASTER30m',
            sampleCount: terrainSamples.length
        };
    }

    function findNearestTerrainSample(point, terrainSamples, maxDistance = Infinity) {
        let nearest = null;
        let nearestDistance = Infinity;
        for (const sample of terrainSamples || []) {
            if (!finite(sample.elevation)) continue;
            const distance = Math.hypot(point.x - sample.x, point.y - sample.y);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearest = sample;
            }
        }
        return nearest && nearestDistance <= maxDistance
            ? { sample: nearest, distance: nearestDistance }
            : null;
    }

    function assignBuildingGroundElevations(buildings, terrainSamples, maxDistance = BUILDING_GROUND_MAX_SAMPLE_DISTANCE_METERS) {
        for (const building of buildings || []) {
            const bounds = building.bounds;
            const center = bounds
                ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
                : (building.polygon || []).reduce((sum, point, index, points) => ({
                    x: sum.x + point.x / Math.max(1, points.length),
                    y: sum.y + point.y / Math.max(1, points.length)
                }), { x: 0, y: 0 });
            const match = findNearestTerrainSample(center, terrainSamples, maxDistance);
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

    function nearestTerrainElevation(point, scene) {
        const match = findNearestTerrainSample(point, scene && scene.terrainSamples, Infinity);
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
        if (segmentCoverage.buildings) {
            for (const building of scene.buildings || []) {
                const bounds = building.bounds;
                if (bounds && (direction.x > 0 ? bounds.maxX < point.x : bounds.minX > point.x)) continue;
                if (bounds && (direction.y > 0 ? bounds.maxY < point.y : bounds.minY > point.y)) continue;
                const hitDistance = intersectRayWithPolygon(point, direction, building.polygon, 4500);
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
        fetchSceneForRoute,
        getSegmentOcclusion,
        calculateRouteLengthMeters,
        getCacheStats: () => ({ overpass: overpassCache.size, terrain: terrainCache.size, ttlMs: CACHE_TTL_MS }),
        clearCaches: () => { overpassCache.clear(); terrainCache.clear(); }
    };
});
