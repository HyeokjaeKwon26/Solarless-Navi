/**
 * Geocoder - Smart Location-Aware Fuzzy & Proximity Place Search Engine
 * Country-Specific Road Sign System (US MUTCD Signs, KR Red Circles, US STOP Signs)
 */

window.Geocoder = (function () {

    const API_TIMEOUT_MS = 7000;
    const SEARCH_CACHE_MAX = 24;
    const searchCache = new Map();

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

    /* Fast Country Detection Bounding Box Logic */
    function detectCountry(lat, lng) {
        // USA Mainland, Alaska, Hawaii
        if ((lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) ||
            (lat >= 50 && lat <= 72 && lng >= -180 && lng <= -130) ||
            (lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154)) {
            return 'US';
        }

        // Republic of Korea
        if (lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132) {
            return 'KR';
        }

        // UK roads commonly use mph even when the OSM value has no suffix.
        if (lat >= 49.5 && lat <= 59.5 && lng >= -8.5 && lng <= 2.0) {
            return 'GB';
        }

        return 'INT'; // International / European Default
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
    async function fetchCurrentRoadSpeedLimitAndRules(lat, lng) {
        const country = detectCountry(lat, lng);
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
            out tags;`;

            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            const data = await fetchJsonWithTimeout(url, {
                timeoutMs: 5000,
                messageKey: 'routeNetworkError'
            });
            if (data && data.elements && data.elements.length > 0) {
                for (let elem of data.elements) {
                        if (elem.tags) {
                            if (elem.tags.highway === 'stop') {
                                isStopSignAhead = true;
                            }

                            if (elem.tags.barrier === 'toll_booth' || elem.tags.highway === 'toll_booth') {
                                isTollBoothAhead = true;
                            }

                            if (elem.tags.highway === 'motorway' || elem.tags.highway === 'motorway_link') {
                                isMotorway = true;
                            }

                            if (elem.tags.toll === 'yes') {
                                isToll = true;
                            }

                            if (elem.tags.tunnel === 'yes' || elem.tags.tunnel === 'building_passage' || elem.tags.covered === 'yes' || (elem.tags.layer && parseInt(elem.tags.layer, 10) < 0)) {
                                isTunnel = true;
                            }

                            if (elem.tags.name && !roadName) {
                                roadName = elem.tags.name;
                            } else if (elem.tags.ref && !roadName) {
                                roadName = elem.tags.ref;
                            }

                            if (elem.tags.maxspeed && speedLimitKmh === null) {
                                const parsed = parseMaxspeed(elem.tags.maxspeed, country);
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
            }
        } catch (e) {
            errorCode = e && e.code ? e.code : 'NETWORK_ERROR';
            console.warn("OSM road rules lookup warning:", e);
        }

        return {
            country: country,
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

    async function reverseGeocode(lat, lng) {
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
            const data = await fetchJsonWithTimeout(url, {
                headers: { 'User-Agent': 'SolarisNav-MobileApp/1.0' },
                messageKey: 'searchNetworkError'
            });
            if (data && data.display_name) {
                const parts = String(data.display_name).split(',');
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
        parseMaxspeed: parseMaxspeed,
        fetchCurrentRoadSpeedLimitAndRules: fetchCurrentRoadSpeedLimitAndRules
    };
})();
