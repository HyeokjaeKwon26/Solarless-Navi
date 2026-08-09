/**
 * ShadowRouter - solar exposure/glare possibility estimation over real OSRM routes.
 * Travel times use an explicit time-of-day adjustment, not live traffic data.
 * Shade and exposure values are experimental; optional scene data adds bounded
 * building, tunnel, and terrain sun-ray checks, with a heuristic fallback.
 */

window.ShadowRouter = (function () {

    function createApiError(code, messageKey, details, cause) {
        const error = new Error(code);
        error.code = code;
        error.messageKey = messageKey;
        error.details = details || '';
        if (cause) error.cause = cause;
        return error;
    }

    function routeContainsToll(route) {
        return !!(route && route.legs && route.legs.some(leg => (leg.steps || []).some(step => {
            if (step.toll === true || (Array.isArray(step.classes) && step.classes.includes('toll'))) return true;
            return (step.intersections || []).some(intersection =>
                Array.isArray(intersection.classes) && intersection.classes.includes('toll')
            );
        })));
    }

    function areValidRouteCoordinates(start, end) {
        return [start, end].every(point => point &&
            Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)) &&
            Number(point.lat) >= -90 && Number(point.lat) <= 90 &&
            Number(point.lng) >= -180 && Number(point.lng) <= 180);
    }

    async function fetchJsonWithTimeout(url, options = {}) {
        const timeoutMs = options.timeoutMs || 10000;
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
            const response = await fetch(url, controller ? { signal: controller.signal } : {});
            if (!response.ok) {
                throw createApiError('HTTP_ERROR', 'routeNetworkError', `${response.status} ${url}`);
            }
            try {
                return await response.json();
            } catch (e) {
                throw createApiError('INVALID_JSON', 'routeNetworkError', url, e);
            }
        } catch (e) {
            if (externalSignal && externalSignal.aborted) throw e;
            if (timedOut || (e && e.name === 'AbortError')) {
                throw createApiError('TIMEOUT', 'routeNetworkError', url, e);
            }
            if (e && e.code) throw e;
            throw createApiError('NETWORK_ERROR', 'routeNetworkError', url, e);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
            if (externalSignal && abortHandler) externalSignal.removeEventListener('abort', abortHandler);
        }
    }

    function getTimeOfDayAdjustment(dateObj) {
        const hour = dateObj.getHours();
        const mins = dateObj.getMinutes();
        const timeVal = hour + mins / 60;

        if (timeVal >= 7.5 && timeVal <= 9.5) return 1.35;
        if (timeVal >= 17.5 && timeVal <= 19.5) return 1.42;
        if (timeVal > 9.5 && timeVal < 17.5) return 1.15;
        return 1.0;
    }

    function calculateBearing(lat1, lon1, lat2, lon2) {
        if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
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
        if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return 0;
        const R = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    function projectPointToSegment(carLat, carLng, a, b) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) return Infinity;
        if (![carLat, carLng, a[1], a[0], b[1], b[0]].every(Number.isFinite)) return Infinity;

        // Use a local equirectangular projection for the short road segments
        // returned by OSRM. Both off-route distance and road snapping use this
        // same projection so their thresholds cannot disagree.
        const latScale = 111320;
        const lngScale = latScale * Math.max(0.01, Math.cos(Number(carLat) * Math.PI / 180));
        const ax = (Number(a[0]) - carLng) * lngScale;
        const ay = (Number(a[1]) - carLat) * latScale;
        const bx = (Number(b[0]) - carLng) * lngScale;
        const by = (Number(b[1]) - carLat) * latScale;
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq)) : 0;
        const projectedLng = Number(a[0]) + (Number(b[0]) - Number(a[0])) * t;
        const projectedLat = Number(a[1]) + (Number(b[1]) - Number(a[1])) * t;
        return { t, lat: projectedLat, lng: projectedLng };
    }

    function pointToSegmentDistanceMeters(carLat, carLng, a, b) {
        const projected = projectPointToSegment(carLat, carLng, a, b);
        if (!projected || projected === Infinity) return Infinity;
        const projectedLat = projected.lat;
        const projectedLng = projected.lng;
        return calculateDistanceMeters(carLat, carLng, projectedLat, projectedLng);
    }

    function distanceToRoute(carLat, carLng, coordinates) {
        if (!coordinates || coordinates.length < 2) return 0;
        let minDistance = Infinity;

        for (let i = 0; i < coordinates.length - 1; i++) {
            minDistance = Math.min(minDistance, pointToSegmentDistanceMeters(carLat, carLng, coordinates[i], coordinates[i + 1]));
        }

        return Number.isFinite(minDistance) ? minDistance : 0;
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

            const projection = projectPointToSegment(carLat, carLng, coordinates[i], coordinates[i + 1]);
            if (!projection || projection === Infinity) continue;
            const t = projection.t;
            const projLat = projection.lat;
            const projLng = projection.lng;
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
        if (!Number.isFinite(altitudeDeg)) return 0;
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
        // Build cumulative route distance once. Step geometry is often a
        // simplified/different point list, so coordinate indexes must not be
        // used as a substitute for spatial matching.
        const routeDistances = [0];
        let routeTotalDistance = 0;
        for (let i = 0; i < n - 1; i++) {
            routeTotalDistance += calculateDistanceMeters(
                coordinates[i][1], coordinates[i][0],
                coordinates[i + 1][1], coordinates[i + 1][0]
            );
            routeDistances.push(routeTotalDistance);
        }

        const uniformFallback = () => {
            for (let i = 0; i < n; i++) {
                timeLookup[i] = routeTotalDistance > 0
                    ? (routeDistances[i] / routeTotalDistance) * Math.max(0, totalDurationSec)
                    : 0;
            }
            return timeLookup;
        };

        if (!steps || steps.length === 0 || totalDurationSec <= 0 || routeTotalDistance <= 0) {
            return uniformFallback();
        }

        const intervals = [];
        let stepDistanceTotal = 0;
        let stepDurationTotal = 0;
        for (const step of steps) {
            const stepCoords = step.geometry && Array.isArray(step.geometry.coordinates)
                ? step.geometry.coordinates
                : [];
            let stepDistance = Number(step.distance) || 0;
            if (stepDistance <= 0 && stepCoords.length > 1) {
                for (let i = 0; i < stepCoords.length - 1; i++) {
                    stepDistance += calculateDistanceMeters(
                        stepCoords[i][1], stepCoords[i][0],
                        stepCoords[i + 1][1], stepCoords[i + 1][0]
                    );
                }
            }
            const stepDuration = Math.max(0, Number(step.duration) || 0);
            if (stepDistance > 0 && stepDuration >= 0) {
                intervals.push({ distance: stepDistance, duration: stepDuration });
                stepDistanceTotal += stepDistance;
                stepDurationTotal += stepDuration;
            }
        }

        if (!intervals.length || stepDistanceTotal <= 0 || stepDurationTotal <= 0) {
            return uniformFallback();
        }

        // Scale the OSRM base step durations to the time-of-day-adjusted
        // route duration, then interpolate by cumulative physical distance.
        const durationScale = totalDurationSec / stepDurationTotal;
        const distanceScale = stepDistanceTotal / routeTotalDistance;
        let intervalStartDistance = 0;
        let intervalStartTime = 0;
        for (let i = 0; i < n; i++) {
            const targetDistance = routeDistances[i] * distanceScale;
            let interval = intervals[intervals.length - 1];
            let intervalEndDistance = stepDistanceTotal;
            let cursorDistance = 0;
            let cursorTime = 0;
            for (const candidate of intervals) {
                const candidateEnd = cursorDistance + candidate.distance;
                if (targetDistance <= candidateEnd || candidate === intervals[intervals.length - 1]) {
                    interval = candidate;
                    intervalStartDistance = cursorDistance;
                    intervalStartTime = cursorTime;
                    intervalEndDistance = candidateEnd;
                    break;
                }
                cursorDistance = candidateEnd;
                cursorTime += candidate.duration * durationScale;
            }
            const fraction = intervalEndDistance > intervalStartDistance
                ? (targetDistance - intervalStartDistance) / (intervalEndDistance - intervalStartDistance)
                : 0;
            timeLookup[i] = Math.max(0, Math.min(totalDurationSec,
                intervalStartTime + fraction * interval.duration * durationScale));
        }
        // Rounding and sparse step geometry must never leave the route ending
        // before the adjusted duration.
        timeLookup[n - 1] = totalDurationSec;
        return timeLookup;
    }

    function isPrecisionScene(scene) {
        // SceneShadow marks incomplete Overpass/DEM coverage explicitly. A
        // missing flag remains compatible with small hand-built test scenes.
        return !!scene && scene.precisionReady !== false;
    }

    function analyzeRouteSegments(coordinates, dateObj, durationSec = 0, steps = null, scene = null) {
        const segments = [];
        let totalGlareWeighted = 0;
        let totalShadeWeighted = 0;
        let totalUvExposureWeighted = 0;
        let totalPathMeters = 0;

        const segmentDistances = [];
        const useScene = isPrecisionScene(scene);
        for (let i = 0; i < coordinates.length - 1; i++) {
            const d = calculateDistanceMeters(coordinates[i][1], coordinates[i][0], coordinates[i + 1][1], coordinates[i + 1][0]);
            segmentDistances.push(d);
            totalPathMeters += d;
        }

        // 4D time estimate: use OSRM step durations, then apply only the
        // documented time-of-day adjustment (not live traffic telemetry).
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
            const sceneResult = useScene && window.SceneShadow
                ? window.SceneShadow.getSegmentOcclusion(p1, p2, segSunPos, scene, i)
                : null;
            const shadeScore = sceneResult && Number.isFinite(sceneResult.shadeScore)
                ? sceneResult.shadeScore
                : estimateSegmentShade(p1, p2, segSunPos);

            // Experimental solar-exposure estimate per segment:
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
                shadeSource: sceneResult && sceneResult.source ? sceneResult.source : 'heuristic',
                sceneOcclusion: sceneResult || null,
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
            coordinates: coordinates,
            sceneCoverage: scene && scene.coverage ? scene.coverage : { buildings: false, terrain: false, tunnels: false },
            segmentSceneCoverage: scene && Array.isArray(scene.segmentCoverage) ? scene.segmentCoverage : null,
            sceneSource: useScene && scene.source ? scene.source : 'heuristic fallback',
            analysisMode: useScene ? 'scene' : 'heuristic'
        };
    }

    function createRouteIdentity(rawRoute, fallbackIndex = 0) {
        const coordinates = rawRoute && rawRoute.geometry && Array.isArray(rawRoute.geometry.coordinates)
            ? rawRoute.geometry.coordinates : [];
        const first = coordinates[0] || [];
        const last = coordinates[coordinates.length - 1] || [];
        const values = [
            Number(rawRoute && rawRoute.distance || 0), Number(rawRoute && rawRoute.duration || 0),
            Number(first[0]), Number(first[1]), Number(last[0]), Number(last[1])
        ];
        return values.every(Number.isFinite)
            ? `route-${values.map(value => value.toFixed(5)).join('-')}`
            : `route-index-${fallbackIndex}`;
    }

    function extractRouteDetails(rawRoute) {
        const routeSteps = [];
        const maneuvers = [];
        let cumulativeStepDist = 0;
        for (const leg of (rawRoute && rawRoute.legs) || []) {
            for (const step of (leg && leg.steps) || []) {
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
                cumulativeStepDist += Number(step.distance) || 0;
            }
        }
        return { routeSteps, maneuvers };
    }

    function createRouteCandidate(rawRoute, candidateIndex, timeOfDayAdjustment) {
        const baseDuration = Number(rawRoute.duration) || 0;
        const details = extractRouteDetails(rawRoute);
        return {
            id: createRouteIdentity(rawRoute, candidateIndex),
            candidateIndex,
            raw: rawRoute,
            distanceMeters: Number(rawRoute.distance) || 0,
            durationSec: Math.round(baseDuration * timeOfDayAdjustment),
            baseDurationSec: baseDuration,
            routeSteps: details.routeSteps,
            maneuvers: details.maneuvers,
            analyzed: null,
            analysisMode: 'heuristic',
            sceneCoverage: { buildings: false, terrain: false, tunnels: false },
            sceneSource: 'heuristic fallback'
        };
    }

    function stableSortRoutes(routes, compare) {
        return [...routes].sort((a, b) => compare(a, b) ||
            (a.candidateIndex || 0) - (b.candidateIndex || 0));
    }

    function routeDurationForSelection(route) {
        return Number.isFinite(Number(route && route.baseDurationSec))
            ? Number(route.baseDurationSec)
            : Number(route && route.durationSec) || Infinity;
    }

    function selectPrecisionCandidates(routes, maxCandidates = 5) {
        if (!Array.isArray(routes) || routes.length === 0) {
            return { fastest: null, glareCandidates: [], shadeCandidates: [], precisionCandidates: [] };
        }
        const fastest = stableSortRoutes(routes, (a, b) => routeDurationForSelection(a) - routeDurationForSelection(b))[0];
        const glareCandidates = stableSortRoutes(routes, (a, b) => a.analyzed.avgGlareRisk - b.analyzed.avgGlareRisk).slice(0, 2);
        const shadeCandidates = stableSortRoutes(routes, (a, b) => {
            const uvDifference = a.analyzed.totalUvExposureUnits - b.analyzed.totalUvExposureUnits;
            return Math.abs(uvDifference) > 0.001 ? uvDifference : b.analyzed.avgShadeCoverage - a.analyzed.avgShadeCoverage;
        }).slice(0, 2);
        const selected = [];
        const seen = new Set();
        [fastest, ...glareCandidates, ...shadeCandidates].forEach(route => {
            if (route && !seen.has(route.id) && selected.length < maxCandidates) {
                seen.add(route.id);
                selected.push(route);
            }
        });
        return { fastest, glareCandidates, shadeCandidates, precisionCandidates: selected };
    }

    function selectRouteRoles(routes) {
        if (!Array.isArray(routes) || routes.length === 0) return { fastest: null, glareFree: null, shade: null };
        const fastest = stableSortRoutes(routes, (a, b) => routeDurationForSelection(a) - routeDurationForSelection(b))[0];
        const alternatives = routes.filter(route => route.id !== fastest.id);
        if (alternatives.length === 0) return { fastest, glareFree: fastest, shade: fastest };
        const glareFree = stableSortRoutes(alternatives, (a, b) => a.analyzed.avgGlareRisk - b.analyzed.avgGlareRisk)[0];
        const shadeSorted = stableSortRoutes(alternatives, (a, b) => {
            const uvDifference = a.analyzed.totalUvExposureUnits - b.analyzed.totalUvExposureUnits;
            return Math.abs(uvDifference) > 0.001 ? uvDifference : b.analyzed.avgShadeCoverage - a.analyzed.avgShadeCoverage;
        });
        const remainingForShade = alternatives.filter(route => route.id !== glareFree.id);
        const shade = remainingForShade.length > 0
            ? stableSortRoutes(remainingForShade, (a, b) => {
                const uvDifference = a.analyzed.totalUvExposureUnits - b.analyzed.totalUvExposureUnits;
                return Math.abs(uvDifference) > 0.001 ? uvDifference : b.analyzed.avgShadeCoverage - a.analyzed.avgShadeCoverage;
            })[0]
            : shadeSorted[0];
        return { fastest, glareFree, shade };
    }

    function applyExposureReductions(fastestRoute, glareFreeRoute, shadeRoute, dateObj, start) {
        if (!fastestRoute) return;
        const baseUvExposure = fastestRoute.analyzed.totalUvExposureUnits;
        const sunPos = SunCalc.getPosition(dateObj, start.lat, start.lng);
        const hasSolarUv = calculateSolarUvIntensity(sunPos.altitude) > 0 || baseUvExposure > 0.0001;
        fastestRoute.uvReductionPct = 0;
        fastestRoute.isNight = !hasSolarUv;
        [glareFreeRoute, shadeRoute].forEach(route => {
            if (!route) return;
            if (!hasSolarUv) {
                route.uvReductionPct = 0;
                route.isNight = true;
            } else if (route.id === fastestRoute.id) {
                route.uvReductionPct = 0;
                route.isNight = false;
            } else if (baseUvExposure > 0.00001) {
                const diffPct = ((baseUvExposure - route.analyzed.totalUvExposureUnits) / baseUvExposure) * 100;
                route.uvReductionPct = diffPct >= 1 ? Math.min(99, Math.round(diffPct)) : 0;
                route.isNight = false;
            } else {
                route.uvReductionPct = 0;
                route.isNight = false;
            }
        });
    }

    async function fetchAndAnalyzeRoutes(start, end, dateObj, isTollFreeOnly = false, options = {}) {
        // Let OSRM decide whether a long-distance route is connected. A
        // straight-line threshold incorrectly rejected valid continental
        // drives before the routing service was even asked.
        if (!areValidRouteCoordinates(start, end)) {
            throw createApiError('INVALID_COORDINATES', 'routeNetworkError', 'Start/end coordinates are invalid');
        }

        const timeOfDayAdjustment = getTimeOfDayAdjustment(dateObj);
        
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

        const tollQuery = isTollFreeOnly ? '&exclude=toll' : '';
        const urls = [
            directUrl,
            ...offsets.map(v => `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${v.lng.toFixed(6)},${v.lat.toFixed(6)};${end.lng},${end.lat}?overview=full&geometries=geojson&continue_straight=true&steps=true${tollQuery}`)
        ];

        const responses = await Promise.allSettled(urls.map(u => fetchJsonWithTimeout(u, {
            signal: options.signal,
            timeoutMs: 10000
        })));
        const rawCandidates = [];
        responses.forEach(res => {
            if (res.status === 'fulfilled' && res.value && res.value.routes) {
                rawCandidates.push(...res.value.routes);
            }
        });

        const filteredCandidates = isTollFreeOnly
            ? rawCandidates.filter(route => !routeContainsToll(route))
            : rawCandidates;

        if (filteredCandidates.length === 0) {
            if (isTollFreeOnly && rawCandidates.length > 0) {
                throw createApiError('TOLL_FREE_UNAVAILABLE', 'routeNetworkError', 'All returned routes contain toll indicators');
            }
            throw createApiError('ROUTE_UNAVAILABLE', 'routeNetworkError', 'OSRM returned no usable routes');
        }

        // Deduplicate route candidates by distance and duration, skipping excessive detours (> 1.60x)
        const uniqueRoutes = [];
        const minDuration = Math.min(...filteredCandidates.map(r => r.duration));

        for (const r of filteredCandidates) {
            if (r.duration > minDuration * 1.60) continue;
            const isDuplicate = uniqueRoutes.some(u => 
                Math.abs(u.distance - r.distance) < 80 && Math.abs(u.duration - r.duration) < 15
            );
            if (!isDuplicate) {
                uniqueRoutes.push(r);
            }
        }

        if (uniqueRoutes.length === 0) uniqueRoutes.push(filteredCandidates[0]);

        // First analyse every candidate with the same lightweight model. Scene
        // data is selected only after these common scores are available.
        const analyzedRoutes = await Promise.all(uniqueRoutes.map(async (r, idx) => {
            const baseDuration = r.duration;
            const liveDuration = Math.round(baseDuration * timeOfDayAdjustment);

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

            const analyzed = await analyzeRouteSegmentsAsync(r.geometry.coordinates, dateObj, liveDuration, routeSteps, null);

            return {
                id: createRouteIdentity(r, idx),
                candidateIndex: idx,
                raw: r,
                distanceMeters: r.distance,
                durationSec: liveDuration,
                baseDurationSec: baseDuration,
                analyzed: analyzed,
                maneuvers: maneuvers,
                routeSteps: routeSteps,
                analysisMode: 'heuristic',
                sceneCoverage: analyzed.sceneCoverage,
                sceneSource: analyzed.sceneSource
            };
        }));

        const selection = selectPrecisionCandidates(analyzedRoutes, 5);
        const refinedResults = await Promise.all(selection.precisionCandidates.map(async route => {
            let scene = null;
            let refinedAnalyzed = null;
            try {
                if (window.SceneShadow && typeof window.SceneShadow.fetchSceneForRoute === 'function') {
                    scene = await window.SceneShadow.fetchSceneForRoute(route.raw.geometry.coordinates, {
                        dateObj,
                        durationSec: route.durationSec,
                        timeLookup: buildStepTimeLookup(route.raw.geometry.coordinates, route.routeSteps, route.durationSec),
                        signal: options.signal,
                        timeoutMs: 12000,
                        terrainTimeoutMs: 10000,
                        maxRouteMeters: 250000
                    });
                }
                if (isPrecisionScene(scene)) {
                    refinedAnalyzed = await analyzeRouteSegmentsAsync(route.raw.geometry.coordinates, dateObj, route.durationSec, route.routeSteps, scene);
                }
            } catch (sceneError) {
                if (options.signal && options.signal.aborted) throw sceneError;
                console.warn('Scene data unavailable; retaining common heuristic comparison.', sceneError);
            }
            return { route, scene, refinedAnalyzed, ready: !!refinedAnalyzed && refinedAnalyzed.analysisMode === 'scene' };
        }));

        const allPrecisionReady = refinedResults.length === selection.precisionCandidates.length &&
            refinedResults.length > 0 && refinedResults.every(result => result.ready);
        refinedResults.forEach(({ route, scene, refinedAnalyzed }) => {
            if (refinedAnalyzed) route.sceneAnalysis = refinedAnalyzed;
            if (allPrecisionReady && refinedAnalyzed) {
                route.analyzed = refinedAnalyzed;
                route.analysisMode = 'scene';
            }
            route.sceneCoverage = scene && scene.coverage ? scene.coverage : route.analyzed.sceneCoverage;
            route.sceneSource = scene && scene.source ? scene.source : route.analyzed.sceneSource;
        });

        // Apply reductions only after the common-tier comparison set is fixed.
        // If any precision candidate lacks scene data, every final ranking
        // deliberately stays on the common heuristic tier. Successful scene
        // results remain auxiliary metadata and are never mixed into scores.
        const comparisonRoutes = allPrecisionReady ? selection.precisionCandidates : analyzedRoutes;
        const roles = selectRouteRoles(comparisonRoutes);
        const fastestRoute = comparisonRoutes.find(route => route.id === selection.fastest.id) || roles.fastest;
        const glareFreeRoute = roles.glareFree;
        const shadeRoute = roles.shade;
        applyExposureReductions(fastestRoute, glareFreeRoute, shadeRoute, dateObj, start);
        /* const hasSolarUv = calculateSolarUvIntensity(sunPos.altitude) > 0 || fastestRoute.analyzed.totalUvExposureUnits > 0.0001;
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
        }); */

        return {
            timeOfDayAdjustment: timeOfDayAdjustment,
            analysisMode: allPrecisionReady ? 'scene' : 'heuristic',
            precisionCandidateIds: selection.precisionCandidates.map(route => route.id),
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
    function analyzeRouteSegmentsAsync(coordinates, dateObj, durationSec, steps, scene = null) {
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
                    timeLookup: Array.from(timeLookup),
                    scene
                });

                // Safety timeout: if Worker doesn't respond in 8s, fallback to sync
                setTimeout(() => {
                    if (workerCallbacks.has(id)) {
                        workerCallbacks.delete(id);
                        const result = analyzeRouteSegments(coordinates, dateObj, durationSec, steps, scene);
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
        const result = analyzeRouteSegments(coordinates, dateObj, durationSec, steps, scene);
        return Promise.resolve(result);
    }

    return {
        calculateBearing: calculateBearing,
        calculateDistanceMeters: calculateDistanceMeters,
        distanceToRoute: distanceToRoute,
        pointToSegmentDistanceMeters: pointToSegmentDistanceMeters,
        snapHeadingToRoad: snapHeadingToRoad,
        snapPositionAndHeadingToRoad: snapPositionAndHeadingToRoad,
        calculateRemainingRouteDistance: calculateRemainingRouteDistance,
        calculateSegmentGlare: calculateSegmentGlare,
        estimateSegmentShade: estimateSegmentShade,
        calculateSolarUvIntensity: calculateSolarUvIntensity,
        buildStepTimeLookup: buildStepTimeLookup,
        createRouteIdentity: createRouteIdentity,
        selectPrecisionCandidates: selectPrecisionCandidates,
        selectRouteRoles: selectRouteRoles,
        applyExposureReductions: applyExposureReductions,
        routeContainsToll: routeContainsToll,
        areValidRouteCoordinates: areValidRouteCoordinates,
        analyzeRouteSegments: analyzeRouteSegments,
        analyzeRouteSegmentsAsync: analyzeRouteSegmentsAsync,
        fetchAndAnalyzeRoutes: fetchAndAnalyzeRoutes
    };
})();
