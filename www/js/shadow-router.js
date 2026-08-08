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
            return { lat: carLat, lng: carLng, heading: rawHeading, isSnapped: false, segmentIndex: 0, t: 0, distMeters: 0 };
        }

        let minDistance = Infinity;
        let bestSnappedPoint = { lat: carLat, lng: carLng };
        let bestRoadBearing = rawHeading;
        let bestIndex = 0;
        let bestT = 0;

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
                bestIndex = i;
                bestT = t;
            }
        }

        if (minDistance <= 40) {
            let angleDiff = Math.abs(rawHeading - bestRoadBearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            const finalHeading = (angleDiff < 75 || rawHeading === 0) ? bestRoadBearing : rawHeading;

            return {
                lat: bestSnappedPoint.lat,
                lng: bestSnappedPoint.lng,
                heading: finalHeading,
                isSnapped: true,
                distMeters: minDistance,
                segmentIndex: bestIndex,
                t: bestT
            };
        }

        return { lat: carLat, lng: carLng, heading: rawHeading, isSnapped: false, distMeters: minDistance, segmentIndex: bestIndex, t: bestT };
    }

    function calculateRemainingRouteDistance(carLat, carLng, coordinates, segmentIndex) {
        if (!coordinates || coordinates.length < 2) return 0;
        let total = 0;
        const startIndex = Math.max(0, Math.min(coordinates.length - 2, segmentIndex || 0));

        // Distance from current position to next route waypoint
        total += calculateDistanceMeters(carLat, carLng, coordinates[startIndex + 1][1], coordinates[startIndex + 1][0]);

        // Remaining route segments to destination
        for (let i = startIndex + 1; i < coordinates.length - 1; i++) {
            total += calculateDistanceMeters(
                coordinates[i][1], coordinates[i][0],
                coordinates[i + 1][1], coordinates[i + 1][0]
            );
        }
        return total;
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
        // Guard: invalid inputs
        if (!sunPosition || !isFinite(sunPosition.altitude) || !isFinite(sunPosition.azimuth)) return 0;
        if (!isFinite(segmentHeading)) return 0;
        // Direct windshield glare requires sun disc to be physically visible above horizon (altitude > -0.833°)
        if (sunPosition.altitude <= -0.833) return 0;
        // Sun high above roofline (>45 deg) rarely causes direct front windshield glare
        if (sunPosition.altitude > 45) return 0.04;

        const sunAzimuthDeg = sunPosition.azimuth;
        const sunElevationDeg = Math.max(0, sunPosition.altitude + 0.833);

        // 360° periodic minimum angular difference
        let angleDiff = Math.abs(((segmentHeading - sunAzimuthDeg) % 360 + 540) % 360 - 180);

        if (angleDiff <= 45 && sunElevationDeg < 25) {
            const headingFactor = 1 - (angleDiff / 45);
            const elevationFactor = 1 - (sunElevationDeg / 25);
            return Math.min(1.0, headingFactor * elevationFactor);
        }

        return 0;
    }

    function estimateSegmentShade(p1, p2, sunPosition) {
        // Guard: invalid sun position
        if (!sunPosition || !isFinite(sunPosition.altitude) || !isFinite(sunPosition.azimuth)) return 0.5;
        if (sunPosition.altitude <= -6.0) return 1.0;
        const sunElevationDeg = sunPosition.altitude;
        const sunAzimuthDeg = sunPosition.azimuth;

        const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
        // 360° periodic minimum angular difference
        let diff = Math.abs(((heading - sunAzimuthDeg) % 360 + 540) % 360 - 180);

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

    /**
     * Build a cumulative time lookup from OSRM step durations.
     * Returns an array mapping coordinate index → elapsed seconds from route start.
     * Falls back to uniform speed assumption if steps data is unavailable.
     */
    function buildStepTimeLookup(coordinates, steps, totalDurationSec) {
        const n = coordinates.length;
        const timeLookup = new Float64Array(n); // timeLookup[i] = elapsed seconds at coordinate i
        if (!steps || steps.length === 0 || totalDurationSec <= 0) {
            // Fallback: uniform speed distribution
            let totalDist = 0;
            const dists = [];
            for (let i = 0; i < n - 1; i++) {
                const d = calculateDistanceMeters(coordinates[i][1], coordinates[i][0], coordinates[i + 1][1], coordinates[i + 1][0]);
                dists.push(d);
                totalDist += d;
            }
            let cumDist = 0;
            for (let i = 0; i < n - 1; i++) {
                timeLookup[i] = totalDist > 0 ? (cumDist / totalDist) * totalDurationSec : 0;
                cumDist += dists[i];
            }
            timeLookup[n - 1] = totalDurationSec;
            return timeLookup;
        }

        // Map step geometry coordinates to overall route coordinate indices
        let coordIdx = 0;
        let elapsedSec = 0;
        for (const step of steps) {
            const stepCoords = step.geometry ? step.geometry.coordinates : [];
            const stepDur = step.duration || 0;
            const stepDist = step.distance || 0;
            let stepCumDist = 0;

            for (let j = 0; j < stepCoords.length && coordIdx < n; j++) {
                timeLookup[coordIdx] = Math.min(elapsedSec + (stepDist > 0 ? (stepCumDist / stepDist) * stepDur : 0), totalDurationSec);
                if (j < stepCoords.length - 1) {
                    stepCumDist += calculateDistanceMeters(stepCoords[j][1], stepCoords[j][0], stepCoords[j + 1][1], stepCoords[j + 1][0]);
                }
                coordIdx++;
            }
            // Avoid double-counting shared coordinate between consecutive steps
            if (coordIdx > 0 && coordIdx < n) coordIdx--;
            elapsedSec += stepDur;
        }
        // Fill any remaining coordinates
        for (let i = coordIdx; i < n; i++) {
            timeLookup[i] = totalDurationSec;
        }
        return timeLookup;
    }

    function analyzeRouteSegments(coordinates, dateObj, durationSec = 0, steps = null) {
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

        // 4D Time Estimation: Use per-step durations from OSRM if available
        const timeLookup = buildStepTimeLookup(coordinates, steps, durationSec);
        const startTimestamp = dateObj.getTime();

        for (let i = 0; i < coordinates.length - 1; i++) {
            const p1 = [coordinates[i][1], coordinates[i][0]];
            const p2 = [coordinates[i + 1][1], coordinates[i + 1][0]];
            const segDist = segmentDistances[i];

            // Skip zero-length degenerate segments
            if (segDist < 0.5) continue;

            // 4D Spatio-Temporal: Use midpoint time of this segment
            const segMidTimeSec = (timeLookup[i] + timeLookup[i + 1]) / 2;
            const elapsedSec = Math.min(segMidTimeSec, durationSec || 0);
            const segmentPassTime = new Date(startTimestamp + elapsedSec * 1000);

            // Dynamic solar azimuth & altitude for this specific geographic point at that exact future arrival time
            const segSunPos = SunCalc.getPosition(segmentPassTime, p1[0], p1[1]);
            const sunIntensity = calculateSolarUvIntensity(segSunPos.altitude);

            const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
            const glareRisk = calculateSegmentGlare(heading, segSunPos);
            const shadeScore = estimateSegmentShade(p1, p2, segSunPos);

            // Direct UV Exposure Factor per segment:
            const unshadedFraction = (1.0 - (shadeScore * 0.85));
            const vehicleExposureFactor = (0.35 + 0.65 * glareRisk);
            const directSunExposure = unshadedFraction * vehicleExposureFactor;
            const segmentUvScore = isFinite(sunIntensity) ? sunIntensity * directSunExposure : 0;

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
        }

        const denom = totalPathMeters || 1;
        const avgGlare = totalGlareWeighted / denom;
        const avgShade = totalShadeWeighted / denom;
        const totalUv = totalUvExposureWeighted / denom;
        return {
            segments: segments,
            avgGlareRisk: isFinite(avgGlare) ? avgGlare : 0,
            avgShadeCoverage: isFinite(avgShade) ? avgShade : 0.5,
            totalUvExposureUnits: isFinite(totalUv) ? totalUv : 0,
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
        
        // 1. Direct OSRM query (with steps=true for turn-by-turn maneuver data)
        let directUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=3&steps=true`;
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
            ...offsets.map(v => `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${v.lng.toFixed(6)},${v.lat.toFixed(6)};${end.lng},${end.lat}?overview=full&geometries=geojson&continue_straight=true&steps=true`)
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

            // Extract OSRM step maneuver data for turn-by-turn navigation
            let routeSteps = null;
            let maneuvers = [];
            if (r.legs && r.legs.length > 0) {
                routeSteps = [];
                let cumulativeStepDist = 0;
                for (const leg of r.legs) {
                    if (leg.steps) {
                        for (const step of leg.steps) {
                            routeSteps.push(step);
                            if (step.maneuver && step.maneuver.type !== 'depart') {
                                maneuvers.push({
                                    type: step.maneuver.type,
                                    modifier: step.maneuver.modifier || '',
                                    location: step.maneuver.location,
                                    bearingBefore: step.maneuver.bearing_before,
                                    bearingAfter: step.maneuver.bearing_after,
                                    name: step.name || '',
                                    ref: step.ref || '',
                                    distance: step.distance,
                                    duration: step.duration,
                                    cumulativeDistance: cumulativeStepDist
                                });
                            }
                            cumulativeStepDist += (step.distance || 0);
                        }
                    }
                }
            }

            const analyzed = analyzeRouteSegments(r.geometry.coordinates, dateObj, liveDuration, routeSteps);

            return {
                id: 'route_opt_' + idx,
                raw: r,
                distanceMeters: r.distance,
                durationSec: liveDuration,
                baseDurationSec: baseDuration,
                analyzed: analyzed,
                maneuvers: maneuvers
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

    /* Web Worker for background solar analysis (UI thread offloading) */
    let solarWorker = null;
    let workerCallId = 0;
    const workerCallbacks = new Map();

    function initSolarWorker() {
        if (solarWorker) return true;
        try {
            solarWorker = new Worker('js/solar-worker.js');
            solarWorker.onmessage = function (e) {
                const { id, result } = e.data;
                const cb = workerCallbacks.get(id);
                if (cb) {
                    workerCallbacks.delete(id);
                    cb.resolve(result);
                }
            };
            solarWorker.onerror = function (err) {
                console.warn('Solar Worker error, falling back to sync:', err);
                solarWorker = null;
            };
            return true;
        } catch (e) {
            console.warn('Web Worker not supported, using sync fallback:', e);
            return false;
        }
    }

    /**
     * Async version of analyzeRouteSegments that runs in a Web Worker.
     * Falls back to synchronous main-thread computation if Worker is unavailable.
     */
    function analyzeRouteSegmentsAsync(coordinates, dateObj, durationSec, steps) {
        // Build time lookup on main thread (lightweight) so Worker gets it ready
        const timeLookup = buildStepTimeLookup(coordinates, steps, durationSec);

        if (initSolarWorker() && solarWorker) {
            return new Promise((resolve) => {
                const id = ++workerCallId;
                workerCallbacks.set(id, { resolve });

                solarWorker.postMessage({
                    id,
                    coordinates,
                    startTimestamp: dateObj.getTime(),
                    durationSec,
                    timeLookup: Array.from(timeLookup)
                });

                // Safety timeout: if Worker doesn't respond in 8s, fallback to sync
                setTimeout(() => {
                    if (workerCallbacks.has(id)) {
                        workerCallbacks.delete(id);
                        const result = analyzeRouteSegments(coordinates, dateObj, durationSec, steps);
                        result.coordinates = coordinates;
                        resolve(result);
                    }
                }, 8000);
            }).then(result => {
                // Worker returns segments without coordinates; add them back
                result.coordinates = coordinates;
                return result;
            });
        }

        // Sync fallback
        const result = analyzeRouteSegments(coordinates, dateObj, durationSec, steps);
        return Promise.resolve(result);
    }

    return {
        calculateBearing: calculateBearing,
        calculateDistanceMeters: calculateDistanceMeters,
        distanceToRoute: distanceToRoute,
        snapHeadingToRoad: snapHeadingToRoad,
        snapPositionAndHeadingToRoad: snapPositionAndHeadingToRoad,
        calculateRemainingRouteDistance: calculateRemainingRouteDistance,
        calculateSegmentGlare: calculateSegmentGlare,
        estimateSegmentShade: estimateSegmentShade,
        calculateSolarUvIntensity: calculateSolarUvIntensity,
        analyzeRouteSegments: analyzeRouteSegments,
        analyzeRouteSegmentsAsync: analyzeRouteSegmentsAsync,
        fetchAndAnalyzeRoutes: fetchAndAnalyzeRoutes
    };
})();

