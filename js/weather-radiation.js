/**
 * WeatherRadiation - bounded forecast sampling for route solar analysis.
 *
 * Open-Meteo is an optional enrichment source.  Callers must retain the
 * Bird clear-sky result whenever a forecast is outside its supported window,
 * incomplete, aborted, or unavailable.
 */
(function (root) {
    'use strict';

    const API_URL = 'https://api.open-meteo.com/v1/forecast';
    const SUCCESS_TTL_MS = 25 * 60 * 1000;
    const NEGATIVE_TTL_MS = 90 * 1000;
    const MAX_CACHE_ENTRIES = 24;
    const MAX_FORECAST_DAYS = 16;
    const SAMPLE_DISTANCE_METERS = 10000;
    const SAMPLE_TIME_SECONDS = 15 * 60;
    const MAX_SAMPLE_LOCATIONS = 120;
    const BATCH_SIZE = 50;
    const MAX_NEAREST_SAMPLE_METERS = 18000;
    const DIRECT_SUN_DNI_THRESHOLD_WM2 = 120;

    const cache = new Map();
    const inFlight = new Map();

    function finite(value) { return Number.isFinite(Number(value)); }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value))); }

    function abortError() {
        const error = new Error('Weather request aborted');
        error.name = 'AbortError';
        return error;
    }

    function distanceMeters(a, b) {
        if (!a || !b || !finite(a.lat) || !finite(a.lng) || !finite(b.lat) || !finite(b.lng)) return Infinity;
        const rad = Math.PI / 180;
        const dLat = (Number(b.lat) - Number(a.lat)) * rad;
        const dLng = (Number(b.lng) - Number(a.lng)) * rad;
        const lat1 = Number(a.lat) * rad;
        const lat2 = Number(b.lat) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
    }

    function routeCoordinates(route) {
        const raw = route && route.raw ? route.raw : route;
        const geometry = raw && raw.geometry;
        return geometry && Array.isArray(geometry.coordinates)
            ? geometry.coordinates.filter(point => Array.isArray(point) && finite(point[0]) && finite(point[1]))
            : [];
    }

    function routeDurationSeconds(route) {
        if (finite(route && route.durationSec)) return Math.max(0, Number(route.durationSec));
        const raw = route && route.raw ? route.raw : route;
        return finite(raw && raw.duration) ? Math.max(0, Number(raw.duration)) : 0;
    }

    function interpolateCoordinate(coordinates, cumulative, targetDistance) {
        if (!coordinates.length) return null;
        if (targetDistance <= 0) return coordinates[0];
        const total = cumulative[cumulative.length - 1] || 0;
        if (targetDistance >= total) return coordinates[coordinates.length - 1];
        let index = 1;
        while (index < cumulative.length && cumulative[index] < targetDistance) index++;
        const startDistance = cumulative[index - 1];
        const endDistance = cumulative[index];
        const fraction = endDistance > startDistance ? (targetDistance - startDistance) / (endDistance - startDistance) : 0;
        return [
            Number(coordinates[index - 1][0]) + (Number(coordinates[index][0]) - Number(coordinates[index - 1][0])) * fraction,
            Number(coordinates[index - 1][1]) + (Number(coordinates[index][1]) - Number(coordinates[index - 1][1])) * fraction
        ];
    }

    function sampleRoute(route, startDate, options = {}) {
        const coordinates = routeCoordinates(route);
        if (!coordinates.length) return [];
        const cumulative = [0];
        for (let index = 1; index < coordinates.length; index++) {
            cumulative.push(cumulative[index - 1] + distanceMeters(
                { lat: coordinates[index - 1][1], lng: coordinates[index - 1][0] },
                { lat: coordinates[index][1], lng: coordinates[index][0] }
            ));
        }
        const totalDistance = cumulative[cumulative.length - 1] || 0;
        const durationSec = routeDurationSeconds(route);
        const distanceInterval = Math.max(1000, Number(options.sampleDistanceMeters) || SAMPLE_DISTANCE_METERS);
        const timeInterval = Math.max(300, Number(options.sampleTimeSeconds) || SAMPLE_TIME_SECONDS);
        const intervalCount = Math.max(1, Math.ceil(totalDistance / distanceInterval), Math.ceil(durationSec / timeInterval));
        const startMs = new Date(startDate).getTime();
        const samples = [];
        for (let index = 0; index <= intervalCount; index++) {
            const fraction = index / intervalCount;
            const point = interpolateCoordinate(coordinates, cumulative, totalDistance * fraction);
            if (!point) continue;
            samples.push({
                lat: Number(point[1]),
                lng: Number(point[0]),
                passTimeMs: startMs + durationSec * fraction * 1000
            });
        }
        return samples;
    }

    function locationCell(sample) {
        // Roughly five-kilometre cells keep overlapping route candidates from
        // multiplying requests without reusing forecasts across border-scale
        // distances.
        return `${Number(sample.lat).toFixed(2)},${Number(sample.lng).toFixed(2)}`;
    }

    function sampleRoutes(routes, startDate, options = {}) {
        const unique = new Map();
        (routes || []).forEach(route => sampleRoute(route, startDate, options).forEach(sample => {
            const key = locationCell(sample);
            const existing = unique.get(key);
            if (!existing || sample.passTimeMs < existing.passTimeMs) unique.set(key, sample);
        }));
        const values = Array.from(unique.values());
        if (values.length <= MAX_SAMPLE_LOCATIONS) return values;
        const reduced = [];
        const lastIndex = values.length - 1;
        for (let index = 0; index < MAX_SAMPLE_LOCATIONS; index++) {
            reduced.push(values[Math.round(index * lastIndex / (MAX_SAMPLE_LOCATIONS - 1))]);
        }
        return reduced;
    }

    function forecastEligibility(startDate, routes, nowMs = Date.now()) {
        const startMs = new Date(startDate).getTime();
        const longestSec = Math.max(0, ...(routes || []).map(routeDurationSeconds));
        const endMs = startMs + longestSec * 1000;
        if (!Number.isFinite(startMs)) return { eligible: false, reason: 'INVALID_FORECAST_TIME' };
        if (startMs < nowMs - 60 * 60 * 1000) return { eligible: false, reason: 'PAST_FORECAST_UNAVAILABLE' };
        if (endMs > nowMs + MAX_FORECAST_DAYS * 86400000) return { eligible: false, reason: 'FORECAST_HORIZON_EXCEEDED' };
        const forecastDays = clamp(Math.ceil((endMs - nowMs) / 86400000) + 1, 1, MAX_FORECAST_DAYS);
        return { eligible: true, forecastDays };
    }

    function parseTime(value) {
        if (finite(value)) return Number(value);
        const text = String(value || '');
        const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(text) ? text : `${text}Z`;
        return new Date(normalized).getTime();
    }

    function numericArray(values) {
        return Array.isArray(values) ? values.map(value => finite(value) ? Math.max(0, Number(value)) : null) : [];
    }

    function responseToLocation(response, requested) {
        if (!response || typeof response !== 'object') return null;
        const minutely = response.minutely_15 || {};
        const hourly = response.hourly || {};
        const radiationTimes = (minutely.time || []).map(parseTime).filter(Number.isFinite);
        const cloudTimes = (hourly.time || []).map(parseTime).filter(Number.isFinite);
        if (!radiationTimes.length) return null;
        return {
            lat: finite(response.latitude) ? Number(response.latitude) : Number(requested.lat),
            lng: finite(response.longitude) ? Number(response.longitude) : Number(requested.lng),
            requestedLat: Number(requested.lat),
            requestedLng: Number(requested.lng),
            radiation: {
                times: radiationTimes,
                dni: numericArray(minutely.direct_normal_irradiance),
                direct: numericArray(minutely.direct_radiation),
                diffuse: numericArray(minutely.diffuse_radiation),
                shortwave: numericArray(minutely.shortwave_radiation)
            },
            cloud: {
                times: cloudTimes,
                total: numericArray(hourly.cloud_cover),
                low: numericArray(hourly.cloud_cover_low),
                mid: numericArray(hourly.cloud_cover_mid),
                high: numericArray(hourly.cloud_cover_high)
            }
        };
    }

    function interpolate(times, values, targetMs) {
        if (!times.length || !values.length || !Number.isFinite(targetMs)) return null;
        if (targetMs < times[0] || targetMs > times[times.length - 1]) return null;
        let low = 0;
        let high = times.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (times[mid] < targetMs) low = mid + 1; else high = mid;
        }
        const right = low;
        const left = Math.max(0, right - 1);
        const leftValue = values[left];
        const rightValue = values[right];
        if (!finite(leftValue) && !finite(rightValue)) return null;
        if (left === right || times[right] === times[left] || !finite(leftValue)) return finite(rightValue) ? Number(rightValue) : null;
        if (!finite(rightValue)) return Number(leftValue);
        const fraction = clamp((targetMs - times[left]) / (times[right] - times[left]), 0, 1);
        return Number(leftValue) + (Number(rightValue) - Number(leftValue)) * fraction;
    }

    function interpolateAt(profile, lat, lng, timeInput) {
        if (!profile || !Array.isArray(profile.locations) || !profile.locations.length) return null;
        const point = { lat: Number(lat), lng: Number(lng) };
        let nearest = null;
        let nearestDistance = Infinity;
        profile.locations.forEach(location => {
            const distance = distanceMeters(point, { lat: location.requestedLat, lng: location.requestedLng });
            if (distance < nearestDistance) { nearest = location; nearestDistance = distance; }
        });
        if (!nearest || nearestDistance > (profile.maxNearestSampleMeters || MAX_NEAREST_SAMPLE_METERS)) return null;
        const targetMs = new Date(timeInput).getTime();
        const radiation = nearest.radiation;
        const cloud = nearest.cloud;
        const dni = interpolate(radiation.times, radiation.dni, targetMs);
        const directRadiation = interpolate(radiation.times, radiation.direct, targetMs);
        const diffuseRadiation = interpolate(radiation.times, radiation.diffuse, targetMs);
        const shortwaveRadiation = interpolate(radiation.times, radiation.shortwave, targetMs);
        if (![dni, directRadiation, diffuseRadiation, shortwaveRadiation].some(finite)) return null;
        return {
            dni: finite(dni) ? Number(dni) : 0,
            directRadiation: finite(directRadiation) ? Number(directRadiation) : 0,
            diffuseRadiation: finite(diffuseRadiation) ? Number(diffuseRadiation) : 0,
            shortwaveRadiation: finite(shortwaveRadiation) ? Number(shortwaveRadiation) : 0,
            cloudCover: interpolate(cloud.times, cloud.total, targetMs),
            cloudCoverLow: interpolate(cloud.times, cloud.low, targetMs),
            cloudCoverMid: interpolate(cloud.times, cloud.mid, targetMs),
            cloudCoverHigh: interpolate(cloud.times, cloud.high, targetMs),
            distanceToSampleMeters: nearestDistance
        };
    }

    async function fetchJson(url, options) {
        const fetchImpl = options.fetchImpl || root.fetch;
        if (typeof fetchImpl !== 'function') throw new Error('Weather fetch is unavailable');
        const controller = new AbortController();
        const parentSignal = options.signal;
        const abortHandler = () => controller.abort();
        if (parentSignal) {
            if (parentSignal.aborted) throw abortError();
            parentSignal.addEventListener('abort', abortHandler, { once: true });
        }
        // Production defaults to eight seconds; tests and constrained hosts may
        // inject a shorter timeout without waiting for the real default.
        const timeoutId = setTimeout(() => controller.abort(), Math.max(1, Number(options.timeoutMs) || 8000));
        try {
            const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
            if (!response || !response.ok) throw new Error(`Weather HTTP ${response && response.status}`);
            try { return await response.json(); } catch (error) { throw new Error(`Weather JSON parse failed: ${error.message}`); }
        } catch (error) {
            if ((parentSignal && parentSignal.aborted) || error.name === 'AbortError') throw abortError();
            throw error;
        } finally {
            clearTimeout(timeoutId);
            if (parentSignal) parentSignal.removeEventListener('abort', abortHandler);
        }
    }

    function buildUrl(samples, forecastDays) {
        const latitude = samples.map(sample => Number(sample.lat).toFixed(4)).join(',');
        const longitude = samples.map(sample => Number(sample.lng).toFixed(4)).join(',');
        const radiation = 'direct_normal_irradiance,direct_radiation,diffuse_radiation,shortwave_radiation';
        const cloud = 'cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high';
        return `${API_URL}?latitude=${latitude}&longitude=${longitude}` +
            `&minutely_15=${radiation}&hourly=${cloud}&timezone=GMT&forecast_days=${forecastDays}`;
    }

    function cacheKey(samples, forecastDays) {
        return `${forecastDays}|${samples.map(locationCell).sort().join('|')}`;
    }

    function readCache(key, nowMs) {
        const entry = cache.get(key);
        if (!entry || entry.expiresAt <= nowMs) { if (entry) cache.delete(key); return null; }
        cache.delete(key);
        cache.set(key, entry);
        if (entry.error) throw new Error(entry.error);
        return entry.value;
    }

    function writeCache(key, value, error, nowMs, options) {
        cache.delete(key);
        cache.set(key, {
            value,
            error: error ? String(error.message || error) : null,
            expiresAt: nowMs + (error ? (options.negativeTtlMs || NEGATIVE_TTL_MS) : (options.successTtlMs || SUCCESS_TTL_MS))
        });
        while (cache.size > (options.maxCacheEntries || MAX_CACHE_ENTRIES)) cache.delete(cache.keys().next().value);
    }

    async function fetchForecastForRoutes(routes, startDate, options = {}) {
        const nowMs = finite(options.nowMs) ? Number(options.nowMs) : Date.now();
        const eligibility = forecastEligibility(startDate, routes, nowMs);
        if (!eligibility.eligible) return {
            available: false,
            weatherMode: 'clear-sky-fallback',
            fallbackReason: eligibility.reason,
            coverage: 0
        };
        const samples = sampleRoutes(routes, startDate, options);
        if (!samples.length) return { available: false, weatherMode: 'clear-sky-fallback', fallbackReason: 'NO_ROUTE_SAMPLES', coverage: 0 };
        const key = cacheKey(samples, eligibility.forecastDays);
        const cached = readCache(key, nowMs);
        if (cached) return cached;
        if (inFlight.has(key)) return inFlight.get(key);

        const promise = (async () => {
            const locations = [];
            try {
                for (let offset = 0; offset < samples.length; offset += BATCH_SIZE) {
                    if (options.signal && options.signal.aborted) throw abortError();
                    const batch = samples.slice(offset, offset + BATCH_SIZE);
                    const payload = await fetchJson(buildUrl(batch, eligibility.forecastDays), options);
                    const responses = Array.isArray(payload) ? payload : [payload];
                    if (responses.length !== batch.length) throw new Error('Weather response location count mismatch');
                    responses.forEach((response, index) => {
                        const location = responseToLocation(response, batch[index]);
                        if (!location) throw new Error('Weather response is missing radiation data');
                        locations.push(location);
                    });
                }
                const result = {
                    available: true,
                    weatherMode: 'forecast',
                    weatherSource: 'open-meteo-best-match',
                    weatherRetrievedAt: nowMs,
                    weatherResolutionMinutes: 15,
                    coverage: locations.length / samples.length,
                    requestedLocationCount: samples.length,
                    locations,
                    maxNearestSampleMeters: MAX_NEAREST_SAMPLE_METERS
                };
                writeCache(key, result, null, nowMs, options);
                return result;
            } catch (error) {
                if (!(options.signal && options.signal.aborted) && error.name !== 'AbortError') writeCache(key, null, error, nowMs, options);
                throw error;
            } finally {
                inFlight.delete(key);
            }
        })();
        inFlight.set(key, promise);
        return promise;
    }

    function resetForTests() { cache.clear(); inFlight.clear(); }

    const api = {
        DIRECT_SUN_DNI_THRESHOLD_WM2,
        sampleRoute,
        sampleRoutes,
        forecastEligibility,
        interpolate,
        interpolateAt,
        fetchForecastForRoutes,
        _responseToLocation: responseToLocation,
        _resetForTests: resetForTests,
        _cacheSize: () => cache.size,
        _inFlightSize: () => inFlight.size
    };
    root.WeatherRadiation = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
