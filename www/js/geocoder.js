/**
 * Geocoder - Smart Location-Aware Fuzzy & Proximity Place Search Engine
 * Country-Specific Road Sign System (US MUTCD Signs, KR Red Circles, US STOP Signs)
 */

window.Geocoder = (function () {

    const API_TIMEOUT_MS = 7000;
    const SEARCH_CACHE_MAX = 24;
    const searchCache = new Map();
    const COUNTRY_CACHE_TTL_MS = 15 * 60 * 1000;
    const COUNTRY_NEGATIVE_CACHE_TTL_MS = 30 * 1000;
    const COUNTRY_CACHE_MAX = 64;
    const REVERSE_CACHE_TTL_MS = 15 * 60 * 1000;
    const REVERSE_NEGATIVE_CACHE_TTL_MS = 30 * 1000;
    const countryCache = new Map();
    const reverseCache = new Map();
    const reverseInFlight = new Map();

    function createApiError(code, messageKey, details, cause) {
        const error = new Error(code);
        error.code = code;
        error.messageKey = messageKey;
        error.details = details || '';
        if (cause) error.cause = cause;
        return error;
    }

    async function fetchJsonWithTimeout(url, options = {}) {
        const timeoutMs = options.timeoutMs || API_TIMEOUT_MS;
        const externalSignal = options.signal || null;
        const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        let timeoutId = null;
        let timedOut = false;
        let abortHandler = null;

        if (controller) {
            timeoutId = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
            if (externalSignal) {
                abortHandler = () => controller.abort();
                if (externalSignal.aborted) controller.abort();
                else externalSignal.addEventListener('abort', abortHandler, { once: true });
            }
        }

        try {
            const fetchOptions = {};
            if (controller) fetchOptions.signal = controller.signal;
            if (options.headers) fetchOptions.headers = options.headers;
            const response = await fetch(url, fetchOptions);
            if (!response.ok) {
                throw createApiError('HTTP_ERROR', options.messageKey, `${response.status} ${url}`);
            }
            try {
                return await response.json();
            } catch (e) {
                throw createApiError('INVALID_JSON', options.messageKey, url, e);
            }
        } catch (e) {
            if (externalSignal && externalSignal.aborted) throw e;
            if (timedOut || (e && e.name === 'AbortError')) {
                throw createApiError('TIMEOUT', options.messageKey, url, e);
            }
            if (e && e.code) throw e;
            throw createApiError('NETWORK_ERROR', options.messageKey, url, e);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (externalSignal && abortHandler) externalSignal.removeEventListener('abort', abortHandler);
        }
    }

    function cacheSearchResults(key, results) {
        searchCache.delete(key);
        searchCache.set(key, results);
        while (searchCache.size > SEARCH_CACHE_MAX) {
            searchCache.delete(searchCache.keys().next().value);
        }
    }

    function getDistanceKm(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radius of the Earth in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function pointInPolygon(lat, lng, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const a = polygon[i];
            const b = polygon[j];
            const intersects = ((a[1] > lat) !== (b[1] > lat)) &&
                (lng < (b[0] - a[0]) * (lat - a[1]) / ((b[1] - a[1]) || Number.EPSILON) + a[0]);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    // Conservative Great Britain outline. A broad UK bbox includes Ireland,
    // France, Belgium and the Netherlands, which can silently select mph.
    // Ambiguous points intentionally fall back to the international km/h mode.
    const GREAT_BRITAIN_POLYGON = [
        [-5.8, 50.0], [-4.0, 50.0], [-2.0, 50.5], [0.2, 50.7], [1.8, 51.0],
        [1.7, 52.1], [1.3, 52.7], [1.7, 53.4], [0.5, 54.0], [-0.2, 54.5],
        [-1.4, 55.0], [-2.0, 55.6], [-3.0, 58.7], [-5.0, 58.7], [-6.0, 57.5],
        [-5.5, 56.0], [-4.7, 55.3], [-4.8, 54.5], [-3.5, 53.5], [-4.5, 52.8],
        [-5.3, 52.2], [-4.0, 51.5], [-5.2, 50.8]
    ];

    // A conservative outline for the contiguous United States.  It is only
    // a local fallback when reverse geocoding has no ISO code; it intentionally
    // excludes Toronto, Tijuana and the broad Canadian/Mexican areas covered
    // by the old rectangular bbox.  Explicit OSM/reverse-geocoder country
    // codes always take precedence over this approximation.
    const CONTIGUOUS_US_POLYGON = [
        [-124.8, 48.9], [-123.2, 46.0], [-124.2, 42.0], [-120.0, 39.0],
        [-117.1, 32.8], [-114.7, 32.7], [-111.0, 31.3], [-108.2, 31.3],
        [-106.5, 31.8], [-104.0, 29.8], [-97.2, 25.8], [-90.1, 28.5],
        [-88.0, 30.2], [-85.0, 29.5], [-82.5, 27.0], [-80.0, 25.0],
        [-80.0, 31.0], [-75.0, 35.0], [-71.0, 41.0], [-67.0, 44.8],
        [-74.5, 45.0], [-79.0, 44.5], [-84.8, 46.0], [-89.5, 48.0],
        [-95.1, 49.0], [-104.0, 49.0], [-111.0, 49.0], [-120.0, 49.0],
        [-124.8, 48.9]
    ];

    // Alaska is split into a conservative mainland and panhandle outline so
    // Yukon/Whitehorse is not silently treated as US mph territory.
    const ALASKA_MAINLAND_POLYGON = [
        [-168.0, 54.5], [-160.0, 54.5], [-151.0, 57.0], [-145.0, 59.0],
        [-141.0, 60.5], [-141.0, 72.0], [-170.0, 72.0], [-173.0, 65.0],
        [-170.0, 60.0]
    ];
    const ALASKA_PANHANDLE_POLYGON = [
        [-135.5, 57.5], [-133.0, 57.5], [-133.0, 59.0], [-135.5, 59.0]
    ];

    function normalizeCountryCode(countryCode) {
        const value = String(countryCode || '').trim().toUpperCase();
        if (!value) return '';
        if (value === 'USA' || value === 'US') return 'US';
        if (value === 'GBR' || value === 'GB' || value === 'UK') return 'GB';
        if (value === 'KOR' || value === 'KR') return 'KR';
        return /^[A-Z]{2}$/.test(value) ? value : '';
    }

    function countryCacheKey(lat, lng) {
        // ~110m cells reduce the chance that one cache entry straddles a
        // national border while still suppressing repeated GPS lookups.
        return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
    }

    function getCachedCountryCode(lat, lng) {
        const key = countryCacheKey(lat, lng);
        const entry = countryCache.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            countryCache.delete(key);
            return null;
        }
        countryCache.delete(key);
        countryCache.set(key, entry);
        // Empty string is a cached "unknown" result; null means no cache
        // entry.  Keeping that distinction prevents repeated reverse lookups
        // while a GPS position remains in the same cell.
        return entry.code;
    }

    function setCachedCountryCode(lat, lng, code, ttlMs = null) {
        const key = countryCacheKey(lat, lng);
        countryCache.delete(key);
        const normalized = normalizeCountryCode(code);
        const ttl = ttlMs || (normalized ? COUNTRY_CACHE_TTL_MS : COUNTRY_NEGATIVE_CACHE_TTL_MS);
        countryCache.set(key, { code: normalized, expiresAt: Date.now() + ttl });
        while (countryCache.size > COUNTRY_CACHE_MAX) countryCache.delete(countryCache.keys().next().value);
    }

    function getReverseCache(key) {
        const entry = reverseCache.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            reverseCache.delete(key);
            return null;
        }
        reverseCache.delete(key);
        reverseCache.set(key, entry);
        return entry.value;
    }

    function setReverseCache(key, value, ttlMs) {
        reverseCache.delete(key);
        reverseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
        while (reverseCache.size > COUNTRY_CACHE_MAX) reverseCache.delete(reverseCache.keys().next().value);
    }

    function abortablePromise(promise, signal) {
        if (!signal) return promise;
        if (signal.aborted) return Promise.reject(createApiError('ABORTED', 'searchNetworkError', 'reverse geocode aborted'));
        return new Promise((resolve, reject) => {
            const onAbort = () => {
                signal.removeEventListener('abort', onAbort);
                reject(createApiError('ABORTED', 'searchNetworkError', 'reverse geocode aborted'));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            promise.then(value => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            }, error => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            });
        });
    }

    /* Country detection uses explicit ISO data when available, then a
     * conservative local boundary. It never treats a broad European bbox as
     * proof of UK units. */
    function detectCountry(lat, lng, countryCode = '') {
        const explicit = String(countryCode || '').trim().toUpperCase();
        if (explicit === 'US' || explicit === 'USA') return 'US';
        if (explicit === 'GB' || explicit === 'UK' || explicit === 'GBR') return 'GB';
        if (explicit === 'KR' || explicit === 'KOR') return 'KR';
        if (explicit) return 'INT';

        // USA Mainland, Alaska, Hawaii.  The contiguous outline is kept
        // deliberately conservative; unknown points use international km/h.
        const inGreatLakesCanadaBand = Number(lat) > 43.2 && Number(lat) < 46.0 &&
            Number(lng) > -83.5 && Number(lng) < -77.0;
        const inAlaska = pointInPolygon(Number(lat), Number(lng), ALASKA_MAINLAND_POLYGON) ||
            pointInPolygon(Number(lat), Number(lng), ALASKA_PANHANDLE_POLYGON);
        if (!inGreatLakesCanadaBand && (pointInPolygon(Number(lat), Number(lng), CONTIGUOUS_US_POLYGON) ||
            inAlaska ||
            (lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154))) {
            return 'US';
        }

        // Republic of Korea
        if (lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132) {
            return 'KR';
        }

        // UK roads commonly use mph even when the OSM value has no suffix.
        if (pointInPolygon(Number(lat), Number(lng), GREAT_BRITAIN_POLYGON)) {
            return 'GB';
        }

        return 'INT'; // International / European Default
    }

    async function fetchReverseGeocodeData(lat, lng, options = {}) {
        const key = countryCacheKey(lat, lng);
        const cached = getReverseCache(key);
        if (cached) return abortablePromise(Promise.resolve(cached), options.signal);
        let request = reverseInFlight.get(key);
        if (!request) {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&addressdetails=1&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
            request = fetchJsonWithTimeout(url, {
                signal: options.signal,
                timeoutMs: options.timeoutMs || API_TIMEOUT_MS,
                headers: { 'User-Agent': 'SolarisNav-MobileApp/1.0' },
                messageKey: 'searchNetworkError'
            }).then(data => {
                const value = {
                    displayName: data && data.display_name ? String(data.display_name) : '',
                    countryCode: normalizeCountryCode(data && data.address && data.address.country_code),
                    data: data || null
                };
                setReverseCache(key, value, value.displayName ? REVERSE_CACHE_TTL_MS : REVERSE_NEGATIVE_CACHE_TTL_MS);
                setCachedCountryCode(lat, lng, value.countryCode);
                return value;
            }).catch(error => {
                setReverseCache(key, { displayName: '', countryCode: '', data: null }, REVERSE_NEGATIVE_CACHE_TTL_MS);
                setCachedCountryCode(lat, lng, '', COUNTRY_NEGATIVE_CACHE_TTL_MS);
                throw error;
            }).finally(() => {
                if (reverseInFlight.get(key) === request) reverseInFlight.delete(key);
            });
            reverseInFlight.set(key, request);
        }
        return abortablePromise(request, options.signal);
    }

    async function resolveCountryCode(lat, lng, options = {}) {
        const explicit = normalizeCountryCode(options.countryCode);
        if (explicit) return explicit;
        const cached = getCachedCountryCode(lat, lng);
        if (cached !== null) return cached;
        try {
            const reverse = await fetchReverseGeocodeData(lat, lng, options);
            return reverse.countryCode || null;
        } catch (error) {
            if (options.signal && options.signal.aborted) throw error;
            console.warn('Country lookup warning:', error);
            return null;
        }
    }

    function pointToSegmentDistanceMeters(lat, lng, a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return Infinity;
        const latScale = 111320;
        const lngScale = latScale * Math.max(0.01, Math.cos(Number(lat) * Math.PI / 180));
        const ax = (Number(a[1]) - Number(lng)) * lngScale;
        const ay = (Number(a[0]) - Number(lat)) * latScale;
        const bx = (Number(b[1]) - Number(lng)) * lngScale;
        const by = (Number(b[0]) - Number(lat)) * latScale;
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
        const projectedLat = Number(a[0]) + (Number(b[0]) - Number(a[0])) * t;
        const projectedLng = Number(a[1]) + (Number(b[1]) - Number(a[1])) * t;
        return getDistanceKm(lat, lng, projectedLat, projectedLng) * 1000;
    }

    function distanceToWayMeters(lat, lng, element) {
        const geometry = element && Array.isArray(element.geometry) ? element.geometry : [];
        if (geometry.length < 2) return Infinity;
        let best = Infinity;
        for (let i = 0; i < geometry.length - 1; i++) {
            const a = [Number(geometry[i].lat), Number(geometry[i].lon)];
            const b = [Number(geometry[i + 1].lat), Number(geometry[i + 1].lon)];
            best = Math.min(best, pointToSegmentDistanceMeters(lat, lng, a, b));
        }
        return best;
    }

    function parseMaxspeed(rawValue, country) {
        const raw = String(rawValue || '').trim().toLowerCase();
        if (!raw || /^(signals|none|variable|national|walk|living_street)$/.test(raw)) return null;
        const match = raw.match(/\d+(?:[.,]\d+)?/);
        if (!match) return null;
        const numeric = Number(match[0].replace(',', '.'));
        if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 300) return null;

        const explicitMph = /\bmph\b/.test(raw);
        const explicitKmh = /\b(?:km\/h|kmh|kph)\b/.test(raw);
        const sourceUnit = explicitMph
            ? 'mph'
            : (explicitKmh ? 'km/h' : ((country === 'US' || country === 'GB') ? 'mph' : 'km/h'));
        const speedLimitKmh = sourceUnit === 'mph' ? numeric * 1.609344 : numeric;
        return {
            value: numeric,
            sourceUnit,
            speedLimitKmh,
            displayUnit: (country === 'US' || country === 'GB') ? 'mph' : 'km/h'
        };
    }

    /* OSM Overpass lookup for nearby speed-limit, tunnel, highway, toll and sign tags */
    async function fetchCurrentRoadSpeedLimitAndRules(lat, lng, options = {}) {
        const resolvedCountryCode = await resolveCountryCode(lat, lng, options);
        const country = detectCountry(lat, lng, resolvedCountryCode || options.countryCode);
        let speedLimit = null;
        let isStopSignAhead = false;
        let isTunnel = false;
        let isMotorway = false;
        let isToll = false;
        let isTollBoothAhead = false;
        let roadName = "";
        let rawUnit = (country === 'US' || country === 'GB') ? 'mph' : 'km/h';
        let speedLimitKmh = null;
        let rawSpeedLimit = null;
        let rawSpeedLimitUnit = null;
        let errorCode = null;

        try {
            const query = `[out:json][timeout:5];
            (
              way(around:45,${lat},${lng})["maxspeed"];
              way(around:45,${lat},${lng})["tunnel"];
              way(around:45,${lat},${lng})["covered"];
              way(around:45,${lat},${lng})["highway"];
              way(around:45,${lat},${lng})["toll"];
              node(around:45,${lat},${lng})["highway"="stop"];
              node(around:90,${lat},${lng})["barrier"="toll_booth"];
              node(around:90,${lat},${lng})["highway"="toll_booth"];
              way(around:90,${lat},${lng})["barrier"="toll_booth"];
            );
             out tags geom;`;

            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            const data = await fetchJsonWithTimeout(url, {
                signal: options.signal,
                timeoutMs: 5000,
                messageKey: 'routeNetworkError'
            });
            if (data && Array.isArray(data.elements) && data.elements.length > 0) {
                const wayCandidates = data.elements.filter(elem => elem.type === 'way' && elem.tags &&
                    (elem.tags.highway || elem.tags.maxspeed) && Array.isArray(elem.geometry) && elem.geometry.length >= 2);
                const matchedWay = wayCandidates
                    .map(elem => ({ elem, distance: distanceToWayMeters(lat, lng, elem) }))
                    .sort((a, b) => a.distance - b.distance)[0]?.elem || null;

                // Point signs and toll booths are independent of the current
                // way, but road properties must come from the nearest geometry.
                for (const elem of data.elements) {
                    const tags = elem.tags || {};
                    if (tags.highway === 'stop') isStopSignAhead = true;
                    if (tags.barrier === 'toll_booth' || tags.highway === 'toll_booth') isTollBoothAhead = true;
                }

                if (matchedWay && matchedWay.tags) {
                    const tags = matchedWay.tags;
                    isMotorway = tags.highway === 'motorway' || tags.highway === 'motorway_link';
                    isToll = tags.toll === 'yes';
                    isTunnel = tags.tunnel === 'yes' || tags.tunnel === 'building_passage' || tags.covered === 'yes' || (tags.layer && parseInt(tags.layer, 10) < 0);
                    roadName = tags.name || tags.ref || '';
                    if (tags.maxspeed) {
                        const parsed = parseMaxspeed(tags.maxspeed, country);
                        if (parsed) {
                            speedLimitKmh = parsed.speedLimitKmh;
                            speedLimit = speedLimitKmh;
                            rawSpeedLimit = parsed.value;
                            rawSpeedLimitUnit = parsed.sourceUnit;
                            rawUnit = parsed.displayUnit;
                        }
                    }
                }
            }
        } catch (e) {
            errorCode = e && e.code ? e.code : 'NETWORK_ERROR';
            console.warn("OSM road rules lookup warning:", e);
        }

        return {
            country: country,
            countryCode: resolvedCountryCode || normalizeCountryCode(options.countryCode) || null,
            speedLimit: speedLimit,
            speedLimitKmh: speedLimitKmh,
            rawSpeedLimit: rawSpeedLimit,
            rawSpeedLimitUnit: rawSpeedLimitUnit,
            isStopSignAhead: isStopSignAhead,
            isTunnel: isTunnel,
            isMotorway: isMotorway,
            isToll: isToll,
            isTollBoothAhead: isTollBoothAhead,
            roadName: roadName,
            unit: rawUnit,
            errorCode: errorCode
        };
    }

    async function searchPlaces(query, userCoords = null, options = {}) {
        if (!query || query.trim().length === 0) return [];
        const cleanQ = query.trim();
        const includeNominatim = options.includeNominatim !== false;
        const hasCoords = !!(userCoords && Number.isFinite(userCoords.lat) && Number.isFinite(userCoords.lng));
        const cacheKey = `${cleanQ.toLowerCase()}|${hasCoords ? `${userCoords.lat.toFixed(3)},${userCoords.lng.toFixed(3)}` : 'none'}|${includeNominatim ? 'all' : 'photon'}`;
        const cached = searchCache.get(cacheKey);
        if (cached) return cached.map(item => ({ ...item }));

        const results = [];
        let attemptedServices = 0;
        let failedServices = 0;
        const addResult = (result) => {
            if (!Number.isFinite(result.lat) || !Number.isFinite(result.lng)) return;
            if (!results.some(r => Math.abs(r.lat - result.lat) < 0.0005 && Math.abs(r.lng - result.lng) < 0.0005)) {
                results.push(result);
            }
        };

        // Nominatim is deliberately opt-in for submitted searches. Autocomplete
        // uses Photon only so every keystroke does not hit Nominatim.
        if (includeNominatim) {
            attemptedServices++;
            try {
                let nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQ)}&limit=10&addressdetails=1`;
                if (hasCoords) {
                    const minLat = userCoords.lat - 1.5;
                    const maxLat = userCoords.lat + 1.5;
                    const minLng = userCoords.lng - 1.5;
                    const maxLng = userCoords.lng + 1.5;
                    nomUrl += `&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=0`;
                }
                const nomData = await fetchJsonWithTimeout(nomUrl, {
                    headers: { 'User-Agent': 'SolarisNav-MobileApp/1.0' },
                    messageKey: 'searchNetworkError'
                });
                if (Array.isArray(nomData)) {
                    nomData.forEach(item => {
                        const itemLat = parseFloat(item.lat);
                        const itemLng = parseFloat(item.lon);
                        const displayName = String(item.display_name || '').trim();
                        if (!displayName) return;
                        addResult({
                            displayName,
                            shortTitle: String(item.name || displayName.split(',')[0]),
                            lat: itemLat,
                            lng: itemLng,
                            distKm: hasCoords ? getDistanceKm(userCoords.lat, userCoords.lng, itemLat, itemLng) : null,
                            source: 'nominatim'
                        });
                    });
                }
            } catch (e) {
                failedServices++;
                console.warn("Nominatim search warning:", e);
            }
        }

        // Photon supplies the lightweight autocomplete path and fuzzy matching.
        attemptedServices++;
        try {
            let photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQ)}&limit=10`;
            if (hasCoords) photonUrl += `&lat=${userCoords.lat}&lon=${userCoords.lng}`;
            const photonData = await fetchJsonWithTimeout(photonUrl, { messageKey: 'searchNetworkError' });
            if (photonData && Array.isArray(photonData.features)) {
                photonData.features.forEach(feature => {
                    const props = feature && feature.properties ? feature.properties : {};
                    const coords = feature && feature.geometry && feature.geometry.coordinates;
                    if (!Array.isArray(coords) || coords.length < 2) return;
                    const itemLat = Number(coords[1]);
                    const itemLng = Number(coords[0]);
                    const nameParts = [props.name, props.street, props.city || props.town || props.district, props.state, props.country]
                        .filter(Boolean).map(String);
                    const fullAddress = nameParts.join(', ');
                    if (!fullAddress) return;
                    addResult({
                        displayName: fullAddress,
                        shortTitle: String(props.name || nameParts[0]),
                        lat: itemLat,
                        lng: itemLng,
                        distKm: hasCoords ? getDistanceKm(userCoords.lat, userCoords.lng, itemLat, itemLng) : null,
                        source: 'photon'
                    });
                });
            }
        } catch (e) {
            failedServices++;
            console.warn("Photon search warning:", e);
        }

        if (attemptedServices > 0 && failedServices === attemptedServices && results.length === 0) {
            throw createApiError('SEARCH_UNAVAILABLE', 'searchNetworkError', cleanQ);
        }

        if (hasCoords) {
            results.sort((a, b) => {
                if (a.distKm !== null && b.distKm !== null) return a.distKm - b.distKm;
                return 0;
            });
        }

        const finalResults = results.slice(0, 7);
        cacheSearchResults(cacheKey, finalResults);
        return finalResults.map(item => ({ ...item }));
    }

    async function reverseGeocode(lat, lng, options = {}) {
        try {
            const reverse = await fetchReverseGeocodeData(lat, lng, options);
            if (reverse.displayName) {
                const parts = reverse.displayName.split(',').map(part => part.trim());
                return parts.slice(0, 3).join(', ').trim();
            }
        } catch (e) {
            console.warn("Reverse geocode warning:", e);
        }
        return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }

    return {
        searchPlaces: searchPlaces,
        reverseGeocode: reverseGeocode,
        detectCountry: detectCountry,
        getCachedCountryCode: getCachedCountryCode,
        resolveCountryCode: resolveCountryCode,
        parseMaxspeed: parseMaxspeed,
        pointToSegmentDistanceMeters: pointToSegmentDistanceMeters,
        distanceToWayMeters: distanceToWayMeters,
        fetchCurrentRoadSpeedLimitAndRules: fetchCurrentRoadSpeedLimitAndRules
    };
})();
