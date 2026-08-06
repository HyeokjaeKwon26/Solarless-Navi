/**
 * ShadowRouter - Solar Glare & Building Shadow Routing Engine
 * Calculates Live Traffic ETAs, Glare Risk Scores, Road Bearing Snapping, Toll-Free Exclusions, Trans-Oceanic Route Validation,
 * and Cumulative Solar UV Irradiance Exposure Reduction (%) Physics Model.
 */

window.ShadowRouter = (function () {

    function getTrafficMultiplier(dateObj) {
        const hour = dateObj.getHours();
        const mins = dateObj.getMinutes();
        const timeVal = hour + mins / 60;

        if (timeVal >= 7.5 && timeVal <= 9.5) return 1.35;
        if (timeVal >= 17.5 && timeVal <= 19.5) return 1.42;
        if (timeVal > 9.5 && timeVal < 17.5) return 1.15;
        return 1.0;
    }

    function calculateBearing(lat1, lon1, lat2, lon2) {
        const toRad = Math.PI / 180;
        const toDeg = 180 / Math.PI;

        const phi1 = lat1 * toRad;
        const phi2 = lat2 * toRad;
        const deltaLambda = (lon2 - lon1) * toRad;

        const y = Math.sin(deltaLambda) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

        let theta = Math.atan2(y, x) * toDeg;
        return (theta + 360) % 360;
    }

    function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function distanceToRoute(carLat, carLng, coordinates) {
        if (!coordinates || coordinates.length < 2) return 0;
        let minDistance = Infinity;

        for (let i = 0; i < coordinates.length; i++) {
            const dist = calculateDistanceMeters(carLat, carLng, coordinates[i][1], coordinates[i][0]);
            if (dist < minDistance) minDistance = dist;
        }

        return minDistance;
    }

    function snapPositionAndHeadingToRoad(carLat, carLng, rawHeading, coordinates) {
        if (!coordinates || coordinates.length < 2) {
            return { lat: carLat, lng: carLng, heading: rawHeading, isSnapped: false };
        }

        let minDistance = Infinity;
        let bestSnappedPoint = { lat: carLat, lng: carLng };
        let bestRoadBearing = rawHeading;

        for (let i = 0; i < coordinates.length - 1; i++) {
            const aLat = coordinates[i][1];
            const aLng = coordinates[i][0];
            const bLat = coordinates[i + 1][1];
            const bLng = coordinates[i + 1][0];

            const dx = bLng - aLng;
            const dy = bLat - aLat;
            const lenSq = dx * dx + dy * dy;

            let t = 0;
            if (lenSq > 0) {
                t = ((carLng - aLng) * dx + (carLat - aLat) * dy) / lenSq;
                t = Math.max(0, Math.min(1, t));
            }

            const projLat = aLat + t * dy;
            const projLng = aLng + t * dx;
            const distMeters = calculateDistanceMeters(carLat, carLng, projLat, projLng);

            if (distMeters < minDistance) {
                minDistance = distMeters;
                bestSnappedPoint = { lat: projLat, lng: projLng };
                bestRoadBearing = calculateBearing(aLat, aLng, bLat, bLng);
            }
        }

        if (minDistance <= 30) {
            let angleDiff = Math.abs(rawHeading - bestRoadBearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            const finalHeading = (angleDiff < 75 || rawHeading === 0) ? bestRoadBearing : rawHeading;

            return {
                lat: bestSnappedPoint.lat,
                lng: bestSnappedPoint.lng,
                heading: finalHeading,
                isSnapped: true,
                distMeters: minDistance
            };
        }

        return { lat: carLat, lng: carLng, heading: rawHeading, isSnapped: false, distMeters: minDistance };
    }

    function snapHeadingToRoad(carLat, carLng, rawHeading, coordinates) {
        return snapPositionAndHeadingToRoad(carLat, carLng, rawHeading, coordinates).heading;
    }

    /**
     * Physics-based Solar UV Radiation Intensity Function (0.0 to 1.0)
     * Incorporates solar elevation angle, atmospheric refraction at horizon (-0.833° / -50 arcminutes),
     * and upper-atmosphere Rayleigh diffuse scattering during Civil Twilight (-6.0° <= altitude < -0.833°).
     * 
     * - Altitude >= -0.833°: Direct sun disk visible above apparent horizon + diffuse sky baseline
     * - -6.0° <= Altitude < -0.833° (Civil Twilight): Sun center geometrically below horizon, but high-altitude
     *   stratospheric ozone and tropospheric Rayleigh scattering send diffuse UV-A/UV-B to the ground.
     * - Altitude < -6.0° (True Astronomical Night): Earth curvature completely blocks solar rays. UV = 0.
     */
    function calculateSolarUvIntensity(altitudeDeg) {
        const apparentAltitude = altitudeDeg + 0.833; // Astronomical horizon refraction correction (-50 arcmin)
        const horizonDiffuseBaseline = Math.sin(0.833 * Math.PI / 180); // ~0.0145 (Diffuse UV skylight at sunrise/sunset horizon)

        if (apparentAltitude > 0) {
            // Direct sun disk visible above horizon + sky diffuse baseline
            const directFactor = Math.sin(apparentAltitude * Math.PI / 180);
            return Math.min(1.0, directFactor + horizonDiffuseBaseline * (1.0 - directFactor));
        } else if (altitudeDeg >= -6.0) {
            // Civil Twilight zone (-6.0° <= altitude <= -0.833°):
            // Stratospheric Rayleigh diffuse scattering with quadratic decay down to -6.0°
            const twilightSpan = 6.0 - 0.833; // 5.167 degrees
            const twilightFraction = Math.max(0, (altitudeDeg + 6.0) / twilightSpan);
            return horizonDiffuseBaseline * Math.pow(twilightFraction, 2.0);
        } else {
            // True Astronomical Night (altitude < -6.0°): Complete darkness, UV = 0
            return 0;
        }
    }

    function calculateSegmentGlare(segmentHeading, sunPosition) {
        // Direct windshield glare requires sun disc to be physically visible above horizon (altitude > -0.833°)
        if (!sunPosition || sunPosition.altitude <= -0.833) return 0;
        // Sun high above roofline (>45 deg) rarely causes direct front windshield glare
        if (sunPosition.altitude > 45) return 0.04;

        const sunAzimuthDeg = sunPosition.azimuth;
        const sunElevationDeg = Math.max(0, sunPosition.altitude + 0.833);

        let angleDiff = Math.abs(segmentHeading - sunAzimuthDeg);
        if (angleDiff > 180) angleDiff = 360 - angleDiff;

        if (angleDiff <= 45 && sunElevationDeg < 25) {
            const headingFactor = 1 - (angleDiff / 45);
            const elevationFactor = 1 - (sunElevationDeg / 25);
            return Math.min(1.0, headingFactor * elevationFactor);
        }

        return 0;
    }

    function estimateSegmentShade(p1, p2, sunPosition) {
        if (!sunPosition || sunPosition.altitude <= -6.0) return 1.0;
        const sunElevationDeg = sunPosition.altitude;
        const sunAzimuthDeg = sunPosition.azimuth;

        const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
        let diff = Math.abs(heading - sunAzimuthDeg);
        if (diff > 180) diff = 360 - diff;

        // Perpendicular factor: Road perpendicular to sun azimuth receives lateral building/tree shadow across lanes
        const perpFactor = Math.sin(diff * Math.PI / 180);

        if (sunElevationDeg <= -0.833) {
            // Twilight: Ambient diffuse light, structural shade baseline
            return 0.85;
        } else if (sunElevationDeg < 25) {
            // Low sun: Long shadows cast by buildings and roadside trees
            return 0.35 + Math.abs(perpFactor) * 0.50;
        } else if (sunElevationDeg < 55) {
            // Mid sun: Moderate building/tree canyon shadows
            return 0.22 + Math.abs(perpFactor) * 0.42;
        } else {
            // High solar noon (>55 deg): East-West streets with southern high-rises/structures have substantial shade
            return 0.18 + Math.abs(perpFactor) * 0.38;
        }
    }

    function analyzeRouteSegments(coordinates, dateObj, durationSec = 0) {
        const segments = [];
        let totalGlareWeighted = 0;
        let totalShadeWeighted = 0;
        let totalUvExposureWeighted = 0;
        let totalPathMeters = 0;

        const segmentDistances = [];
        for (let i = 0; i < coordinates.length - 1; i++) {
            const d = calculateDistanceMeters(coordinates[i][1], coordinates[i][0], coordinates[i + 1][1], coordinates[i + 1][0]);
            segmentDistances.push(d);
            totalPathMeters += d;
        }

        const startTimestamp = dateObj.getTime();
        let cumulativeDist = 0;

        for (let i = 0; i < coordinates.length - 1; i++) {
            const p1 = [coordinates[i][1], coordinates[i][0]];
            const p2 = [coordinates[i + 1][1], coordinates[i + 1][0]];
            const segDist = segmentDistances[i];

            // 4D Spatio-Temporal: Calculate exact timestamp when vehicle physically arrives at segment i
            const elapsedSec = (totalPathMeters > 0 && durationSec > 0)
                ? ((cumulativeDist + segDist / 2) / totalPathMeters) * durationSec
                : 0;
            const segmentPassTime = new Date(startTimestamp + elapsedSec * 1000);

            // Dynamic solar azimuth & altitude for this specific geographic point at that exact future arrival time
            const segSunPos = SunCalc.getPosition(segmentPassTime, p1[0], p1[1]);
            const sunIntensity = calculateSolarUvIntensity(segSunPos.altitude);

            const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
            const glareRisk = calculateSegmentGlare(heading, segSunPos);
            const shadeScore = estimateSegmentShade(p1, p2, segSunPos);

            // Direct UV Exposure Factor per segment:
            // Shade blocks ~85% of direct UV-A/B radiation (leaving ~15% diffuse).
            // Facing the sun directly through windshield increases direct driver UV exposure to 100%,
            // while lateral or rear sun angles are partially roof/window-pillar blocked (~35% baseline).
            const unshadedFraction = (1.0 - (shadeScore * 0.85));
            const vehicleExposureFactor = (0.35 + 0.65 * glareRisk);
            const directSunExposure = unshadedFraction * vehicleExposureFactor;
            const segmentUvScore = sunIntensity * directSunExposure;

            segments.push({
                p1: p1,
                p2: p2,
                heading: heading,
                passTime: segmentPassTime,
                glareRisk: glareRisk,
                shadeScore: shadeScore,
                uvScore: segmentUvScore
            });

            totalGlareWeighted += glareRisk * segDist;
            totalShadeWeighted += shadeScore * segDist;
            totalUvExposureWeighted += segmentUvScore * segDist;
            cumulativeDist += segDist;
        }

        const denom = totalPathMeters || 1;
        return {
            segments: segments,
            avgGlareRisk: totalGlareWeighted / denom,
            avgShadeCoverage: totalShadeWeighted / denom,
            totalUvExposureUnits: totalUvExposureWeighted / denom,
            coordinates: coordinates
        };
    }

    async function fetchAndAnalyzeRoutes(start, end, dateObj, isTollFreeOnly = false) {
        // Trans-Oceanic / Cross-Continental Driving Distance Check (> 1500 km)
        const straightDistMeters = calculateDistanceMeters(start.lat, start.lng, end.lat, end.lng);
        if (straightDistMeters > 1500000) {
            const km = Math.round(straightDistMeters / 1000);
            const err = new Error(`TRANS_OCEANIC_ROUTE_ERROR:${km}`);
            err.code = "TRANS_OCEANIC";
            err.distanceKm = km;
            throw err;
        }

        const trafficMult = getTrafficMultiplier(dateObj);
        
        // 1. Direct OSRM query
        let directUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=3`;
        if (isTollFreeOnly) {
            directUrl += `&exclude=toll`;
        }

        // 2. Parallel Multi-Corridor Exploration: Generate lateral via-points with aspect-ratio normalization
        const midLat = (start.lat + end.lat) / 2;
        const midLng = (start.lng + end.lng) / 2;
        const dLat = end.lat - start.lat;
        const dLng = end.lng - start.lng;
        const cosLat = Math.cos(midLat * Math.PI / 180);

        const perpLat = -dLng / (cosLat || 1);
        const perpLng = dLat * (cosLat || 1);
        const norm = Math.sqrt(perpLat * perpLat + perpLng * perpLng) || 1;

        const distDeg = Math.sqrt(dLat * dLat + dLng * dLng);
        const offsetScale = Math.min(0.015, Math.max(0.0015, distDeg * 0.18));

        const offsets = [
            { lat: midLat + (perpLat / norm) * offsetScale, lng: midLng + (perpLng / norm) * offsetScale },
            { lat: midLat - (perpLat / norm) * offsetScale, lng: midLng - (perpLng / norm) * offsetScale },
            { lat: midLat + (perpLat / norm) * offsetScale * 1.8, lng: midLng + (perpLng / norm) * offsetScale * 1.8 },
            { lat: midLat - (perpLat / norm) * offsetScale * 1.8, lng: midLng - (perpLng / norm) * offsetScale * 1.8 }
        ];

        const urls = [
            directUrl,
            ...offsets.map(v => `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${v.lng.toFixed(6)},${v.lat.toFixed(6)};${end.lng},${end.lat}?overview=full&geometries=geojson&continue_straight=true`)
        ];

        const responses = await Promise.allSettled(urls.map(u => fetch(u).then(r => r.ok ? r.json() : null)));
        const rawCandidates = [];
        responses.forEach(res => {
            if (res.status === 'fulfilled' && res.value && res.value.routes) {
                rawCandidates.push(...res.value.routes);
            }
        });

        if (rawCandidates.length === 0) throw new Error("No routes found.");

        // Deduplicate route candidates by distance and duration, skipping excessive detours (> 1.60x)
        const uniqueRoutes = [];
        const minDuration = Math.min(...rawCandidates.map(r => r.duration));

        for (const r of rawCandidates) {
            if (r.duration > minDuration * 1.60) continue;
            const isDuplicate = uniqueRoutes.some(u => 
                Math.abs(u.distance - r.distance) < 80 && Math.abs(u.duration - r.duration) < 15
            );
            if (!isDuplicate) {
                uniqueRoutes.push(r);
            }
        }

        if (uniqueRoutes.length === 0) uniqueRoutes.push(rawCandidates[0]);

        const analyzedRoutes = uniqueRoutes.map((r, idx) => {
            const baseDuration = r.duration;
            const liveDuration = Math.round(baseDuration * trafficMult);
            const analyzed = analyzeRouteSegments(r.geometry.coordinates, dateObj, liveDuration);

            return {
                id: 'route_opt_' + idx,
                raw: r,
                distanceMeters: r.distance,
                durationSec: liveDuration,
                baseDurationSec: baseDuration,
                analyzed: analyzed
            };
        });

        // 1. Fastest Route: strictly minimum duration
        const sortedByDuration = [...analyzedRoutes].sort((a, b) => a.durationSec - b.durationSec);
        const fastestRoute = sortedByDuration[0];

        // 2 & 3. Distinct Glare-Free & Shade-Priority Routes
        const distinctAlternatives = analyzedRoutes.filter(r => r.id !== fastestRoute.id);
        let glareFreeRoute, shadeRoute;

        if (distinctAlternatives.length === 0) {
            glareFreeRoute = fastestRoute;
            shadeRoute = fastestRoute;
        } else {
            // Sort distinct alternatives by lowest glare risk
            const sortedByGlare = [...distinctAlternatives].sort((a, b) => a.analyzed.avgGlareRisk - b.analyzed.avgGlareRisk);
            glareFreeRoute = sortedByGlare[0];

            // Sort distinct alternatives by lowest UV exposure / highest shade coverage
            const sortedByShade = [...distinctAlternatives].sort((a, b) => {
                if (Math.abs(a.analyzed.totalUvExposureUnits - b.analyzed.totalUvExposureUnits) > 0.001) {
                    return a.analyzed.totalUvExposureUnits - b.analyzed.totalUvExposureUnits;
                }
                return b.analyzed.avgShadeCoverage - a.analyzed.avgShadeCoverage;
            });

            const remainingForShade = distinctAlternatives.filter(r => r.id !== glareFreeRoute.id);
            shadeRoute = remainingForShade.length > 0
                ? [...remainingForShade].sort((a, b) => a.analyzed.totalUvExposureUnits - b.analyzed.totalUvExposureUnits)[0]
                : sortedByShade[0];
        }

        // Cumulative UV Exposure Reduction % compared to Standard Fastest Route
        const sunPos = SunCalc.getPosition(dateObj, start.lat, start.lng);
        const startUvIntensity = calculateSolarUvIntensity(sunPos.altitude);
        const hasSolarUv = startUvIntensity > 0 || fastestRoute.analyzed.totalUvExposureUnits > 0.0001;
        const baseUvExposure = fastestRoute.analyzed.totalUvExposureUnits;

        fastestRoute.uvReductionPct = 0;
        fastestRoute.isNight = !hasSolarUv;

        [glareFreeRoute, shadeRoute].forEach(r => {
            if (!hasSolarUv) {
                // True Astronomical Night (altitude < -6.0°): No solar UV radiation
                r.uvReductionPct = 0;
                r.isNight = true;
            } else if (r.id === fastestRoute.id) {
                r.uvReductionPct = 0;
                r.isNight = false;
            } else if (baseUvExposure > 0.00001) {
                const diffPct = ((baseUvExposure - r.analyzed.totalUvExposureUnits) / baseUvExposure) * 100;
                if (diffPct >= 1) {
                    r.uvReductionPct = Math.min(99, Math.round(diffPct));
                } else {
                    r.uvReductionPct = 0;
                }
                r.isNight = false;
            } else {
                r.uvReductionPct = 0;
                r.isNight = false;
            }
        });

        return {
            trafficMultiplier: trafficMult,
            routes: {
                fastest: fastestRoute,
                glareFree: glareFreeRoute,
                shade: shadeRoute,
                all: analyzedRoutes
            }
        };
    }

    return {
        calculateBearing: calculateBearing,
        calculateDistanceMeters: calculateDistanceMeters,
        distanceToRoute: distanceToRoute,
        snapHeadingToRoad: snapHeadingToRoad,
        snapPositionAndHeadingToRoad: snapPositionAndHeadingToRoad,
        calculateSegmentGlare: calculateSegmentGlare,
        calculateSolarUvIntensity: calculateSolarUvIntensity,
        fetchAndAnalyzeRoutes: fetchAndAnalyzeRoutes
    };
})();

