/**
 * Geocoder - Smart Location-Aware Fuzzy & Proximity Place Search Engine
 * Country-Specific Road Sign System (US MUTCD Signs, KR Red Circles, US STOP Signs)
 */

window.Geocoder = (function () {

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

        return 'INT'; // International / European Default
    }

    /* Real-Time OSM Overpass API Speed Limit, Tunnel, Highway, Toll & Road Sign Rules Lookup */
    async function fetchCurrentRoadSpeedLimitAndRules(lat, lng) {
        const country = detectCountry(lat, lng);
        let speedLimit = null;
        let isStopSignAhead = false;
        let isTunnel = false;
        let isMotorway = false;
        let isToll = false;
        let isTollBoothAhead = false;
        let roadName = "";
        let rawUnit = country === 'US' ? 'mph' : 'km/h';

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

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3500);

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
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

                            if (elem.tags.maxspeed && !speedLimit) {
                                const raw = elem.tags.maxspeed.trim().toLowerCase();
                                if (raw.includes('mph')) {
                                    rawUnit = 'mph';
                                    const num = parseInt(raw, 10);
                                    if (!isNaN(num)) speedLimit = num;
                                } else {
                                    const num = parseInt(raw, 10);
                                    if (!isNaN(num) && num > 0 && num <= 140) {
                                        speedLimit = num;
                                        if (country === 'US') rawUnit = 'mph';
                                        else rawUnit = 'km/h';
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("Real-time road rules lookup warning:", e);
        }

        return {
            country: country,
            speedLimit: speedLimit,
            isStopSignAhead: isStopSignAhead,
            isTunnel: isTunnel,
            isMotorway: isMotorway,
            isToll: isToll,
            isTollBoothAhead: isTollBoothAhead,
            roadName: roadName,
            unit: rawUnit
        };
    }

    async function searchPlaces(query, userCoords = null) {
        if (!query || query.trim().length === 0) return [];
        const cleanQ = query.trim();

        const results = [];
        const hasCoords = (userCoords && typeof userCoords.lat === 'number' && typeof userCoords.lng === 'number');

        // 1. OpenStreetMap Nominatim Global Search biased with Location Viewbox
        try {
            let nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQ)}&limit=10&addressdetails=1`;
            if (hasCoords) {
                const minLat = userCoords.lat - 1.5;
                const maxLat = userCoords.lat + 1.5;
                const minLng = userCoords.lng - 1.5;
                const maxLng = userCoords.lng + 1.5;
                nomUrl += `&viewbox=${minLng},${maxLat},${maxLng},${minLat}&bounded=0`;
            }

            const nomRes = await fetch(nomUrl, {
                headers: { 'User-Agent': 'SolarisNav-MobileApp/1.0' }
            });

            if (nomRes.ok) {
                const nomData = await nomRes.json();
                nomData.forEach(item => {
                    const itemLat = parseFloat(item.lat);
                    const itemLng = parseFloat(item.lon);

                    let distKm = null;
                    if (hasCoords) {
                        distKm = getDistanceKm(userCoords.lat, userCoords.lng, itemLat, itemLng);
                    }

                    if (!results.some(r => Math.abs(r.lat - itemLat) < 0.0005 && Math.abs(r.lng - itemLng) < 0.0005)) {
                        results.push({
                            displayName: item.display_name,
                            shortTitle: item.name || item.display_name.split(',')[0],
                            lat: itemLat,
                            lng: itemLng,
                            distKm: distKm,
                            source: 'nominatim'
                        });
                    }
                });
            }
        } catch (e) {
            console.warn("Nominatim search warning:", e);
        }

        // 2. Photon Komoot API for Fast Fuzzy Search & Partial Typo Tolerance
        try {
            let photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(cleanQ)}&limit=10`;
            if (hasCoords) {
                photonUrl += `&lat=${userCoords.lat}&lon=${userCoords.lng}`;
            }

            const photonRes = await fetch(photonUrl);
            if (photonRes.ok) {
                const photonData = await photonRes.json();
                if (photonData.features) {
                    photonData.features.forEach(f => {
                        const props = f.properties;
                        const coords = f.geometry.coordinates; // [lng, lat]
                        const itemLat = coords[1];
                        const itemLng = coords[0];

                        const nameParts = [props.name, props.street, props.city || props.town || props.district, props.state, props.country].filter(Boolean);
                        const fullAddress = nameParts.join(', ');

                        let distKm = null;
                        if (hasCoords) {
                            distKm = getDistanceKm(userCoords.lat, userCoords.lng, itemLat, itemLng);
                        }

                        if (fullAddress && !results.some(r => Math.abs(r.lat - itemLat) < 0.0005 && Math.abs(r.lng - itemLng) < 0.0005)) {
                            results.push({
                                displayName: fullAddress,
                                shortTitle: props.name || nameParts[0],
                                lat: itemLat,
                                lng: itemLng,
                                distKm: distKm,
                                source: 'photon'
                            });
                        }
                    });
                }
            }
        } catch (e) {
            console.warn("Photon search warning:", e);
        }

        // 3. Smart Distance Proximity Sorting
        if (userCoords) {
            results.sort((a, b) => {
                if (a.distKm !== null && b.distKm !== null) {
                    return a.distKm - b.distKm;
                }
                return 0;
            });
        }

        return results.slice(0, 7);
    }

    async function reverseGeocode(lat, lng) {
        try {
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'SolarisNav-MobileApp/1.0' }
            });
            if (res.ok) {
                const data = await res.json();
                if (data.display_name) {
                    const parts = data.display_name.split(',');
                    return parts.slice(0, 3).join(', ').trim();
                }
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
        fetchCurrentRoadSpeedLimitAndRules: fetchCurrentRoadSpeedLimitAndRules
    };
})();
