/**
 * ShadowRouter - solar exposure/glare possibility estimation over real OSRM routes.
 * Travel times use OSRM profile durations, not live traffic data.
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
        // OSRM profile duration is the only defensible initial ETA without
        // live or locally calibrated traffic observations. The former fixed
        // 1.15/1.35/1.42 multipliers had no regional or empirical basis.
        // During guidance app.js continues to update remaining time from
        // measured route progress and speed.
        void dateObj;
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

    function snapPositionAndHeadingToRoad(carLat, carLng, rawHeading, coordinates, options = {}) {
        if (!coordinates || coordinates.length < 2) {
            return { lat: carLat, lng: carLng, heading: rawHeading, isSnapped: false, segmentIndex: 0, t: 0, distMeters: 0 };
        }

        let minDistance = Infinity;
        let bestRawDistance = Infinity;
        let bestSnappedPoint = { lat: carLat, lng: carLng };
        let bestRoadBearing = rawHeading;
        let bestIndex = 0;
        let bestT = 0;
        const previousSegmentIndex = Number.isFinite(Number(options.previousSegmentIndex))
            ? Math.max(0, Number(options.previousSegmentIndex)) : null;
        const maxBacktrackSegments = Number.isFinite(Number(options.maxBacktrackSegments))
            ? Math.max(0, Number(options.maxBacktrackSegments)) : 1;
        const hasHeading = Number.isFinite(Number(rawHeading)) && Number(rawHeading) >= 0;

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
            const candidateProgress = i + t;
            if (previousSegmentIndex !== null && candidateProgress < previousSegmentIndex - maxBacktrackSegments) continue;
            let candidateScore = distMeters;
            if (previousSegmentIndex !== null && candidateProgress < previousSegmentIndex) {
                candidateScore += 25 + (previousSegmentIndex - candidateProgress) * 10;
            }
            if (previousSegmentIndex !== null && hasHeading) {
                const roadBearing = calculateBearing(aLat, aLng, bLat, bLng);
                let headingDiff = Math.abs(Number(rawHeading) - roadBearing);
                if (headingDiff > 180) headingDiff = 360 - headingDiff;
                // Prefer the segment in front of the vehicle. A reverse
                // segment remains possible only when no forward segment is
                // close enough (a genuine U-turn case).
                if (headingDiff > 110) candidateScore += 35;
            }

            if (candidateScore < minDistance) {
                minDistance = candidateScore;
                bestSnappedPoint = { lat: projLat, lng: projLng };
                bestRawDistance = distMeters;
                bestRoadBearing = calculateBearing(aLat, aLng, bLat, bLng);
                bestIndex = i;
                bestT = t;
            }
        }

        if (bestRawDistance <= 40) {
            let angleDiff = Math.abs(rawHeading - bestRoadBearing);
            if (angleDiff > 180) angleDiff = 360 - angleDiff;
            const finalHeading = (angleDiff < 75 || rawHeading === 0) ? bestRoadBearing : rawHeading;

            return {
                lat: bestSnappedPoint.lat,
                lng: bestSnappedPoint.lng,
                heading: finalHeading,
                isSnapped: true,
                distMeters: bestRawDistance,
                segmentIndex: bestIndex,
                t: bestT
            };
        }

        return { lat: carLat, lng: carLng, heading: rawHeading, isSnapped: false, distMeters: bestRawDistance, segmentIndex: bestIndex, t: bestT };
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

    function calculateRemainingRouteDuration(coordinates, steps, totalDurationSec, segmentIndex, segmentT = 0, existingLookup = null) {
        const duration = Number(totalDurationSec);
        const validCoordinates = Array.isArray(coordinates) && coordinates.length >= 2 && coordinates.every(point =>
            Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
        );
        if (!validCoordinates || !Number.isFinite(duration) || duration <= 0) return 0;
        const rawIndex = Number(segmentIndex);
        const index = Number.isFinite(rawIndex)
            ? Math.max(0, Math.min(coordinates.length - 2, Math.floor(rawIndex)))
            : 0;
        const rawFraction = Number(segmentT);
        const fraction = Number.isFinite(rawFraction) ? Math.max(0, Math.min(1, rawFraction)) : 0;
        // Navigation updates can arrive several times per second. Reuse the
        // route's immutable lookup when supplied instead of rebuilding the
        // O(coordinates x steps) mapping on every accepted GPS fix.
        const lookup = existingLookup && existingLookup.length === coordinates.length
            ? existingLookup
            : buildStepTimeLookup(coordinates, steps, duration);
        const startElapsed = Number(lookup[index]);
        const endElapsed = Number(lookup[index + 1]);
        if (!Number.isFinite(startElapsed) || !Number.isFinite(endElapsed)) return 0;
        const elapsed = startElapsed + (endElapsed - startElapsed) * fraction;
        return Math.max(0, Math.min(duration, duration - elapsed));
    }

    function snapHeadingToRoad(carLat, carLng, rawHeading, coordinates) {
        return snapPositionAndHeadingToRoad(carLat, carLng, rawHeading, coordinates).heading;
    }

    /**
     * Compatibility 0..1 clear-sky direct-horizontal factor.
     *
     * This is deliberately not called a UV dose: real UV requires spectral
     * irradiance and erythemal weighting. Route analysis below uses the NREL
     * Bird model in SolarPhysics and integrates W/m² over time. This helper is
     * retained for older UI/cache fields and for a no-SolarPhysics fallback.
     */
    function calculateSolarUvIntensity(altitudeDeg) {
        if (!Number.isFinite(altitudeDeg)) return 0;
        return altitudeDeg > 0 ? Math.max(0, Math.min(1, Math.sin(altitudeDeg * Math.PI / 180))) : 0;
    }

    function calculateSegmentGlare(segmentHeading, sunPosition, irradiance = null, occlusionRatio = 0) {
        // Guard: invalid inputs
        if (!sunPosition || !isFinite(sunPosition.altitude) || !isFinite(sunPosition.azimuth)) return 0;
        if (!isFinite(segmentHeading)) return 0;
        if (window.SolarPhysics && typeof window.SolarPhysics.disabilityGlare === 'function') {
            const clearSky = irradiance || {
                // Geometry-only fallback for callers such as the live HUD.
                // Route analysis always supplies Bird DNI.
                dni: 1000 * calculateSolarUvIntensity(Number(sunPosition.altitude))
            };
            return window.SolarPhysics.disabilityGlare(
                segmentHeading, sunPosition, clearSky, occlusionRatio
            ).normalizedPotential;
        }
        if (sunPosition.altitude <= 0) return 0;
        const angleDiff = Math.abs(((segmentHeading - sunPosition.azimuth) % 360 + 540) % 360 - 180);
        return angleDiff < 90 ? Math.max(0, Math.cos(angleDiff * Math.PI / 180) * Math.cos(sunPosition.altitude * Math.PI / 180)) : 0;
    }

    function calculateDirectSolarExposure(sunIntensity, occlusionRatio = null) {
        const intensity = Number(sunIntensity);
        if (!Number.isFinite(intensity) || intensity <= 0) return 0;
        const occlusion = Number.isFinite(Number(occlusionRatio))
            ? Math.max(0, Math.min(1, Number(occlusionRatio)))
            : 0;
        return Math.max(0, Math.min(1, intensity)) * (1 - occlusion);
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
        if (!Array.isArray(coordinates) || coordinates.length === 0) return new Float64Array(0);
        const n = coordinates.length;
        const normalizedDuration = Number.isFinite(Number(totalDurationSec))
            ? Math.max(0, Number(totalDurationSec)) : 0;
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
                    ? (routeDistances[i] / routeTotalDistance) * normalizedDuration
                    : 0;
            }
            return timeLookup;
        };

        if (!steps || steps.length === 0 || normalizedDuration <= 0 || routeTotalDistance <= 0) {
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
        const durationScale = normalizedDuration / stepDurationTotal;
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
            timeLookup[i] = Math.max(0, Math.min(normalizedDuration,
                intervalStartTime + fraction * interval.duration * durationScale));
        }
        // Rounding and sparse step geometry must never leave the route ending
        // before the adjusted duration.
        timeLookup[n - 1] = normalizedDuration;
        return timeLookup;
    }

    function sceneAnalysisMode(scene) {
        // SceneShadow marks incomplete Overpass/DEM coverage explicitly. A
        // missing flag remains compatible with small hand-built test scenes,
        // but scene metadata alone must never claim precision when the
        // occlusion implementation is unavailable.
        if (!scene || !window.SceneShadow || typeof window.SceneShadow.getSegmentOcclusion !== 'function') return 'heuristic';
        if (scene.precisionReady !== false) return 'scene';
        const coverage = scene.coverage || {};
        return scene.partial === true && Number(coverage.coveredSegments || 0) > 0
            ? 'hybrid-scene' : 'heuristic';
    }

    function isPrecisionScene(scene) {
        return sceneAnalysisMode(scene) !== 'heuristic';
    }

    function segmentAtmosphereOptions(p1, p2, scene) {
        const options = { ...(scene && scene.atmosphere || {}) };
        if (!scene || !scene.origin || !window.SceneShadow ||
            typeof window.SceneShadow.projectPoint !== 'function' ||
            typeof window.SceneShadow.findNearestTerrainSample !== 'function') return options;
        const midpoint = window.SceneShadow.projectPoint(
            (Number(p1[0]) + Number(p2[0])) / 2,
            (Number(p1[1]) + Number(p2[1])) / 2,
            scene.origin
        );
        const nearest = window.SceneShadow.findNearestTerrainSample(
            midpoint, scene.terrainSamples, 500, scene.terrainGrid
        );
        const elevation = nearest && nearest.sample && Number(nearest.sample.elevation);
        if (Number.isFinite(elevation)) {
            options.elevationMeters = elevation;
            if (!options.source) options.source = 'bird-standard-atmosphere+scene-dem-elevation';
        }
        return options;
    }

    function forecastIrradianceAt(weatherProfile, p1, passTime, sunPosition, clearSkyIrradiance) {
        if (!weatherProfile || !window.WeatherRadiation ||
            typeof window.WeatherRadiation.interpolateAt !== 'function') return null;
        const weather = window.WeatherRadiation.interpolateAt(weatherProfile, p1[0], p1[1], passTime);
        if (!weather) return null;
        const altitudeRad = Math.max(0, Number(sunPosition && sunPosition.altitude) || 0) * Math.PI / 180;
        const dni = Math.max(0, Number(weather.dni) || 0);
        const directHorizontal = Number.isFinite(Number(weather.directRadiation))
            ? Math.max(0, Number(weather.directRadiation))
            : dni * Math.sin(altitudeRad);
        const dhi = Math.max(0, Number(weather.diffuseRadiation) || 0);
        const ghi = Number.isFinite(Number(weather.shortwaveRadiation))
            ? Math.max(0, Number(weather.shortwaveRadiation))
            : directHorizontal + dhi;
        return {
            dni,
            directHorizontal,
            dhi,
            ghi,
            model: 'OPEN_METEO_FORECAST',
            atmosphereSource: clearSkyIrradiance && clearSkyIrradiance.atmosphereSource || 'forecast-grid',
            weather
        };
    }

    function analyzeRouteSegments(coordinates, dateObj, durationSec = 0, steps = null, scene = null, weatherProfile = null) {
        const segments = [];
        let totalGlareWeighted = 0;
        let totalGlareWeight = 0;
        let totalShadeWeighted = 0;
        let totalSolarExposureWeighted = 0;
        let totalDirectSolarEnergyWhM2 = 0;
        let clearSkyDirectEnergyWhM2 = 0;
        let diffuseSkyEnergyWhM2 = 0;
        let totalTimeSeconds = 0;
        let sunlitTimeSeconds = 0;
        let sunlitDistanceMeters = 0;
        let confirmedShadeDistance = 0;
        let confirmedShadeTimeSeconds = 0;
        let confirmedSceneDistance = 0;
        let confirmedSceneTimeSeconds = 0;
        let uncertainSceneDistance = 0;
        let uncertainSceneTimeSeconds = 0;
        let estimatedShadeWeighted = 0;
        let estimatedDistance = 0;
        let totalPathMeters = 0;
        let forecastSegmentCount = 0;

        const segmentDistances = [];
        const analysisMode = sceneAnalysisMode(scene);
        const useScene = analysisMode !== 'heuristic';
        for (let i = 0; i < coordinates.length - 1; i++) {
            const d = calculateDistanceMeters(coordinates[i][1], coordinates[i][0], coordinates[i + 1][1], coordinates[i + 1][0]);
            segmentDistances.push(d);
            totalPathMeters += d;
        }

        // 4D time estimate: scale OSRM step durations to the OSRM route
        // duration. This is profile routing time, not live traffic telemetry.
        const timeLookup = buildStepTimeLookup(coordinates, steps, durationSec);
        // Keep aggregate glare weights in one unit. If OSRM provides any route
        // time, zero-duration geometry fragments contribute zero elapsed time;
        // mixing their metre length with seconds can push the mean outside the
        // physical 0..1 risk range. Distance is used only when the entire route
        // has no usable timing information.
        const hasRouteTiming = Number(timeLookup[timeLookup.length - 1]) > Number(timeLookup[0]);
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
            const atmosphereOptions = segmentAtmosphereOptions(p1, p2, scene);
            const segSunPos = SunCalc.getPosition(segmentPassTime, p1[0], p1[1], atmosphereOptions);
            const clearSkyIrradiance = window.SolarPhysics && typeof window.SolarPhysics.birdClearSky === 'function'
                ? window.SolarPhysics.birdClearSky(segSunPos, segmentPassTime, atmosphereOptions)
                : { dni: 1000 * calculateSolarUvIntensity(segSunPos.altitude), dhi: 0, ghi: 1000 * calculateSolarUvIntensity(segSunPos.altitude), directHorizontal: 1000 * calculateSolarUvIntensity(segSunPos.altitude), model: 'GEOMETRIC_FALLBACK', atmosphereSource: 'none' };
            const forecastIrradiance = forecastIrradianceAt(
                weatherProfile, p1, segmentPassTime, segSunPos, clearSkyIrradiance
            );
            const irradiance = forecastIrradiance || clearSkyIrradiance;
            if (forecastIrradiance) forecastSegmentCount++;
            const sunIntensity = window.SolarPhysics && typeof window.SolarPhysics.normalizedDirectExposure === 'function'
                ? window.SolarPhysics.normalizedDirectExposure(irradiance, 0)
                : calculateSolarUvIntensity(segSunPos.altitude);

            const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
            const sceneResult = useScene && window.SceneShadow
                ? window.SceneShadow.getSegmentOcclusion(p1, p2, segSunPos, scene, i)
                : null;
            const estimatedShadePotential = estimateSegmentShade(p1, p2, segSunPos);
            const shadeState = sceneResult && sceneResult.shadeState
                ? sceneResult.shadeState
                : (sunIntensity <= 0 ? 'night' : 'estimated-shade');
            const confirmedOcclusion = sceneResult && Number.isFinite(sceneResult.occlusionRatio)
                ? Math.max(0, Math.min(1, Number(sceneResult.occlusionRatio)))
                : null;
            const glareRisk = calculateSegmentGlare(heading, segSunPos, irradiance, confirmedOcclusion);
            // Solar exposure is independent of windshield glare. Confirmed
            // building/terrain/tunnel occlusion removes direct exposure;
            // uncovered/unknown segments conservatively remain exposed.
            const directSolarExposure = window.SolarPhysics && typeof window.SolarPhysics.normalizedDirectExposure === 'function'
                ? window.SolarPhysics.normalizedDirectExposure(irradiance, confirmedOcclusion)
                : calculateDirectSolarExposure(sunIntensity, confirmedOcclusion);
            // An uncertainty envelope that crosses the solar ray is not
            // evidence of shade. Keep direct exposure and the aggregate shade
            // score conservative; only genuinely uncovered hybrid segments
            // retain the heuristic estimate.
            const shadeScore = shadeState === 'uncertain'
                ? 0
                : (confirmedOcclusion === null ? estimatedShadePotential : confirmedOcclusion);
            const segmentDurationSec = Math.max(0, Number(timeLookup[i + 1]) - Number(timeLookup[i]));
            const directHorizontalWm2 = Math.max(0, Number(irradiance.directHorizontal) || 0);
            const directEnergyWhM2 = directHorizontalWm2 * (1 - (confirmedOcclusion === null ? 0 : confirmedOcclusion)) * segmentDurationSec / 3600;
            const clearDirectEnergyWhM2 = Math.max(0, Number(clearSkyIrradiance.directHorizontal) || 0) * segmentDurationSec / 3600;
            // Diffuse sky irradiance is retained separately. Without a sky-view
            // factor, building shade must not be claimed to remove it.
            const diffuseEnergyWhM2 = Math.max(0, Number(irradiance.dhi) || 0) * segmentDurationSec / 3600;

            segments.push({
                p1: p1,
                p2: p2,
                heading: heading,
                passTime: segmentPassTime,
                glareRisk: glareRisk,
                shadeScore: shadeScore,
                shadeState,
                confirmedShade: shadeState === 'confirmed-shade',
                estimatedShadePotential,
                occlusionRatio: confirmedOcclusion,
                sunIntensity,
                clearSkyIrradiance,
                irradiance,
                weather: forecastIrradiance && forecastIrradiance.weather || null,
                atmosphereOptions,
                directSolarExposure,
                directHorizontalIrradianceWm2: directHorizontalWm2,
                directSolarEnergyWhM2: directEnergyWhM2,
                clearSkyDirectEnergyWhM2: clearDirectEnergyWhM2,
                diffuseSkyEnergyWhM2: diffuseEnergyWhM2,
                segmentDurationSec,
                shadeSource: sceneResult && sceneResult.source ? sceneResult.source : 'heuristic',
                sceneOcclusion: sceneResult || null,
                solarExposureScore: directSolarExposure,
                uvScore: directSolarExposure
            });

            const glareWeight = hasRouteTiming ? segmentDurationSec : segDist;
            totalGlareWeighted += glareRisk * glareWeight;
            totalGlareWeight += glareWeight;
            totalShadeWeighted += shadeScore * segDist;
            totalSolarExposureWeighted += directSolarExposure * segDist;
            totalTimeSeconds += segmentDurationSec;
            totalDirectSolarEnergyWhM2 += directEnergyWhM2;
            clearSkyDirectEnergyWhM2 += clearDirectEnergyWhM2;
            diffuseSkyEnergyWhM2 += diffuseEnergyWhM2;
            const directSunThreshold = window.WeatherRadiation
                ? window.WeatherRadiation.DIRECT_SUN_DNI_THRESHOLD_WM2 : 120;
            if (segSunPos.altitude > 0 && Number(irradiance.dni) >= directSunThreshold && confirmedOcclusion !== 1) {
                sunlitTimeSeconds += segmentDurationSec;
                sunlitDistanceMeters += segDist;
            }
            if (shadeState === 'confirmed-shade' || shadeState === 'confirmed-clear') {
                confirmedSceneDistance += segDist;
                confirmedSceneTimeSeconds += segmentDurationSec;
                if (shadeState === 'confirmed-shade') {
                    confirmedShadeDistance += segDist;
                    confirmedShadeTimeSeconds += segmentDurationSec;
                }
            } else if (shadeState === 'uncertain') {
                uncertainSceneDistance += segDist;
                uncertainSceneTimeSeconds += segmentDurationSec;
            } else if (shadeState === 'estimated-shade') {
                estimatedDistance += segDist;
                estimatedShadeWeighted += estimatedShadePotential * segDist;
            }
        }

        // Never mix forecast and clear-sky segments in one route score. If a
        // forecast profile cannot cover the complete route, recompute the
        // route uniformly with the Bird clear-sky fallback.
        if (weatherProfile && segments.length && forecastSegmentCount !== segments.length) {
            return analyzeRouteSegments(coordinates, dateObj, durationSec, steps, scene, null);
        }

        const denom = totalPathMeters || 1;
        const avgGlare = totalGlareWeighted / (totalGlareWeight || denom);
        const avgShade = totalShadeWeighted / denom;
        const totalSolarExposure = totalTimeSeconds > 0
            ? Math.max(0, Math.min(1.5, (totalDirectSolarEnergyWhM2 * 3600 / totalTimeSeconds) / 1000))
            : totalSolarExposureWeighted / denom;
        const confirmedShadeRatio = confirmedSceneDistance > 0 ? confirmedShadeDistance / confirmedSceneDistance : 0;
        const confirmedShadeTimeRatio = totalTimeSeconds > 0 ? confirmedShadeTimeSeconds / totalTimeSeconds : 0;
        const confirmedShadeWithinSceneTimeRatio = confirmedSceneTimeSeconds > 0
            ? confirmedShadeTimeSeconds / confirmedSceneTimeSeconds : 0;
        const estimatedShadeRatio = estimatedDistance > 0 ? estimatedShadeWeighted / estimatedDistance : 0;
        return {
            segments: segments,
            avgGlareRisk: isFinite(avgGlare) ? avgGlare : 0,
            avgShadeCoverage: isFinite(avgShade) ? avgShade : 0.5,
            totalDirectSolarExposureUnits: isFinite(totalSolarExposure) ? totalSolarExposure : 0,
            directSolarEnergyWhM2: isFinite(totalDirectSolarEnergyWhM2) ? totalDirectSolarEnergyWhM2 : 0,
            clearSkyDirectEnergyWhM2: isFinite(clearSkyDirectEnergyWhM2) ? clearSkyDirectEnergyWhM2 : 0,
            diffuseSkyEnergyWhM2: isFinite(diffuseSkyEnergyWhM2) ? diffuseSkyEnergyWhM2 : 0,
            sunlitTimeSeconds: isFinite(sunlitTimeSeconds) ? sunlitTimeSeconds : 0,
            totalTimeSeconds: isFinite(totalTimeSeconds) ? totalTimeSeconds : 0,
            sunlitDistanceRatio: totalPathMeters > 0 ? sunlitDistanceMeters / totalPathMeters : 0,
            sunlitTimeRatio: totalTimeSeconds > 0 ? sunlitTimeSeconds / totalTimeSeconds : 0,
            // Deprecated compatibility alias. This value is not a measured UV dose.
            totalUvExposureUnits: isFinite(totalSolarExposure) ? totalSolarExposure : 0,
            confirmedShadeRatio: isFinite(confirmedShadeRatio) ? confirmedShadeRatio : 0,
            confirmedShadeTimeRatio: isFinite(confirmedShadeTimeRatio) ? confirmedShadeTimeRatio : 0,
            confirmedShadeWithinSceneTimeRatio: isFinite(confirmedShadeWithinSceneTimeRatio) ? confirmedShadeWithinSceneTimeRatio : 0,
            confirmedSceneTimeRatio: totalTimeSeconds > 0 ? confirmedSceneTimeSeconds / totalTimeSeconds : 0,
            uncertainOcclusionDistanceRatio: totalPathMeters > 0 ? uncertainSceneDistance / totalPathMeters : 0,
            uncertainOcclusionTimeRatio: totalTimeSeconds > 0 ? uncertainSceneTimeSeconds / totalTimeSeconds : 0,
            estimatedShadeRatio: isFinite(estimatedShadeRatio) ? estimatedShadeRatio : 0,
            confirmedSceneDistanceMeters: confirmedSceneDistance,
            coordinates: coordinates,
            sceneCoverage: scene && scene.coverage ? scene.coverage : { buildings: false, terrain: false, tunnels: false },
            segmentSceneCoverage: scene && Array.isArray(scene.segmentCoverage) ? scene.segmentCoverage : null,
            sceneSource: useScene && scene.source ? scene.source : 'heuristic fallback',
            analysisMode,
            analysisTier: weatherProfile
                ? (analysisMode === 'scene' ? 'weather-scene' :
                    (analysisMode === 'hybrid-scene' ? 'weather-hybrid-scene' : 'weather-heuristic'))
                : (analysisMode === 'scene' ? 'clear-sky-scene' :
                    (analysisMode === 'hybrid-scene' ? 'clear-sky-hybrid-scene' : 'clear-sky-heuristic')),
            weatherMode: weatherProfile ? 'forecast' : 'clear-sky-fallback',
            weatherCoverage: segments.length ? forecastSegmentCount / segments.length : 0,
            weatherRetrievedAt: weatherProfile && weatherProfile.weatherRetrievedAt || null,
            weatherResolutionMinutes: weatherProfile && weatherProfile.weatherResolutionMinutes || null,
            weatherSource: weatherProfile && weatherProfile.weatherSource || 'bird-clear-sky',
            solarModelVersion: window.SolarPhysics ? window.SolarPhysics.MODEL_VERSION : 'legacy-fallback',
            solarReferences: window.SolarPhysics ? window.SolarPhysics.REFERENCES : null,
            atmosphereSource: segments[0] && segments[0].clearSkyIrradiance ? segments[0].clearSkyIrradiance.atmosphereSource : 'none'
        };
    }

    const ROUTE_GEOMETRY_SAMPLE_COUNT = 24;
    const ROUTE_DUPLICATE_HAUSDORFF_METERS = 100;
    const ROUTE_DUPLICATE_OVERLAP_METERS = 80;

    function getRouteCoordinates(route) {
        const coordinates = route && route.geometry && Array.isArray(route.geometry.coordinates)
            ? route.geometry.coordinates : (Array.isArray(route) ? route : []);
        return coordinates.filter(point => Array.isArray(point) &&
            Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])));
    }

    function getRouteEndpoint(route) {
        const rawRoute = route && route.raw ? route.raw : route;
        const roadDestination = rawRoute && rawRoute.roadDestination;
        if (roadDestination && Number.isFinite(Number(roadDestination.lat)) && Number.isFinite(Number(roadDestination.lng))) {
            return { lat: Number(roadDestination.lat), lng: Number(roadDestination.lng) };
        }
        const coordinates = route && route.analyzed && Array.isArray(route.analyzed.coordinates)
            ? route.analyzed.coordinates
            : getRouteCoordinates(rawRoute);
        const last = coordinates && coordinates.length ? coordinates[coordinates.length - 1] : null;
        return Array.isArray(last) && Number.isFinite(Number(last[0])) && Number.isFinite(Number(last[1]))
            ? { lat: Number(last[1]), lng: Number(last[0]) } : null;
    }

    function routeStepEndpoint(step) {
        const coordinates = step && step.geometry && Array.isArray(step.geometry.coordinates)
            ? step.geometry.coordinates : [];
        const last = coordinates.length ? coordinates[coordinates.length - 1] : null;
        return Array.isArray(last) && Number.isFinite(Number(last[0])) && Number.isFinite(Number(last[1]))
            ? { lat: Number(last[1]), lng: Number(last[0]) } : null;
    }

    function trimRouteToRoadDestination(route, finalLeg, namedStepIndex, roadDestination) {
        if (!route || !finalLeg || namedStepIndex < 0 || !roadDestination) return;
        const steps = Array.isArray(finalLeg.steps) ? finalLeg.steps : [];
        const tailSteps = steps.slice(namedStepIndex + 1).filter(step =>
            step && step.maneuver && step.maneuver.type !== 'arrive');
        const removedDistance = tailSteps.reduce((sum, step) => sum + (Number(step.distance) || 0), 0);
        const removedDuration = tailSteps.reduce((sum, step) => sum + (Number(step.duration) || 0), 0);
        const arrivalStep = steps.find(step => step && step.maneuver && step.maneuver.type === 'arrive');
        const roadPoint = [roadDestination.lng, roadDestination.lat];
        finalLeg.steps = steps.slice(0, namedStepIndex + 1);
        if (arrivalStep) {
            finalLeg.steps.push({
                ...arrivalStep,
                distance: 0,
                duration: 0,
                geometry: { type: 'LineString', coordinates: [roadPoint] },
                maneuver: { ...arrivalStep.maneuver, location: roadPoint }
            });
        }
        if (Number.isFinite(Number(finalLeg.distance))) finalLeg.distance = Math.max(0, Number(finalLeg.distance) - removedDistance);
        if (Number.isFinite(Number(finalLeg.duration))) finalLeg.duration = Math.max(0, Number(finalLeg.duration) - removedDuration);
        if (Number.isFinite(Number(route.distance))) route.distance = Math.max(0, Number(route.distance) - removedDistance);
        if (Number.isFinite(Number(route.duration))) route.duration = Math.max(0, Number(route.duration) - removedDuration);

        const coordinates = getRouteCoordinates(route);
        if (coordinates.length) {
            let nearestIndex = 0;
            let nearestDistance = Infinity;
            // Search backwards so a loop that passed the destination road
            // earlier is not truncated at that earlier occurrence.
            for (let index = coordinates.length - 1; index >= 0; index--) {
                const point = coordinates[index];
                const distance = calculateDistanceMeters(roadDestination.lat, roadDestination.lng, point[1], point[0]);
                if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
            }
            route.geometry.coordinates = coordinates.slice(0, nearestIndex + 1);
            const last = route.geometry.coordinates[route.geometry.coordinates.length - 1];
            if (!last || calculateDistanceMeters(roadDestination.lat, roadDestination.lng, last[1], last[0]) > 1) {
                route.geometry.coordinates.push(roadPoint);
            }
        }
    }

    function assignRoadDestination(route, waypoints) {
        if (!route) return route;
        const waypoint = Array.isArray(waypoints) && waypoints.length
            ? waypoints[waypoints.length - 1] : null;
        const location = waypoint && Array.isArray(waypoint.location) ? waypoint.location : null;
        const snapped = location && Number.isFinite(Number(location[0])) && Number.isFinite(Number(location[1]))
            ? { lat: Number(location[1]), lng: Number(location[0]) } : null;
        const finalLeg = route.legs && route.legs.length ? route.legs[route.legs.length - 1] : null;
        const steps = finalLeg && Array.isArray(finalLeg.steps) ? finalLeg.steps : [];
        const drivingSteps = steps.filter(step => step && step.maneuver && step.maneuver.type !== 'arrive');
        let namedIndex = -1;
        for (let index = drivingSteps.length - 1; index >= 0; index--) {
            if (String(drivingSteps[index].name || '').trim() && routeStepEndpoint(drivingSteps[index])) {
                namedIndex = index;
                break;
            }
        }
        const namedEndpoint = namedIndex >= 0 ? routeStepEndpoint(drivingSteps[namedIndex]) : null;
        const hasTrailingUnnamedAccess = namedIndex >= 0 && drivingSteps.slice(namedIndex + 1).some(step =>
            !String(step && step.name || '').trim());
        const distanceToSnapped = namedEndpoint && snapped
            ? calculateDistanceMeters(namedEndpoint.lat, namedEndpoint.lng, snapped.lat, snapped.lng) : Infinity;

        // OSRM may route a POI centroid onto a short unnamed driveway or
        // campus service road. For car guidance, stop at the last named road
        // entrance when that access tail is short; otherwise retain OSRM's
        // own snapped waypoint rather than the original POI coordinate.
        const useRoadEntrance = hasTrailingUnnamedAccess && namedEndpoint && distanceToSnapped <= 300;
        route.roadDestination = useRoadEntrance ? namedEndpoint : (snapped || namedEndpoint || getRouteEndpoint(route));
        if (useRoadEntrance) {
            const namedStep = drivingSteps[namedIndex];
            trimRouteToRoadDestination(route, finalLeg, steps.indexOf(namedStep), namedEndpoint);
        }
        return route;
    }

    const PRECISION_SAMPLE_INTERVAL_METERS = 50;
    const PRECISION_DETAIL_INTERVAL_METERS = 25;
    const PRECISION_TURN_THRESHOLD_DEG = 18;
    const PRECISION_MAX_POINTS = 800;

    function angularDifferenceDegrees(a, b) {
        const delta = Math.abs((((Number(a) - Number(b)) % 360) + 540) % 360 - 180);
        return Number.isFinite(delta) ? delta : 0;
    }

    function interpolateRoutePointAtDistance(coordinates, cumulative, targetMeters) {
        if (!coordinates.length) return null;
        if (targetMeters <= 0) return [Number(coordinates[0][0]), Number(coordinates[0][1])];
        const total = cumulative[cumulative.length - 1] || 0;
        if (targetMeters >= total) {
            const last = coordinates[coordinates.length - 1];
            return [Number(last[0]), Number(last[1])];
        }
        let low = 1;
        let high = cumulative.length - 1;
        while (low < high) {
            const mid = Math.floor((low + high) / 2);
            if (cumulative[mid] < targetMeters) low = mid + 1;
            else high = mid;
        }
        const endIndex = low;
        const startIndex = Math.max(0, endIndex - 1);
        const span = cumulative[endIndex] - cumulative[startIndex];
        const fraction = span > 0 ? (targetMeters - cumulative[startIndex]) / span : 0;
        return [
            Number(coordinates[startIndex][0]) + (Number(coordinates[endIndex][0]) - Number(coordinates[startIndex][0])) * fraction,
            Number(coordinates[startIndex][1]) + (Number(coordinates[endIndex][1]) - Number(coordinates[startIndex][1])) * fraction
        ];
    }

    function nearestRouteDistanceForPoint(point, coordinates, cumulative) {
        if (!Array.isArray(point) || point.length < 2) return null;
        const lng = Number(point[0]);
        const lat = Number(point[1]);
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
        let best = null;
        for (let i = 0; i < coordinates.length - 1; i++) {
            const projection = projectPointToSegment(lat, lng, coordinates[i], coordinates[i + 1]);
            if (!projection || projection === Infinity) continue;
            const distanceMeters = calculateDistanceMeters(lat, lng, projection.lat, projection.lng);
            if (!Number.isFinite(distanceMeters)) continue;
            const segmentMeters = cumulative[i + 1] - cumulative[i];
            const routeMeters = cumulative[i] + segmentMeters * projection.t;
            if (!best || distanceMeters < best.distanceMeters) {
                best = { distanceMeters, routeMeters };
            }
        }
        return best ? best.routeMeters : null;
    }

    function stepLooksLikeTunnel(step) {
        if (!step) return false;
        if (step.tunnel === true || String(step.tunnel || '').toLowerCase() === 'yes') return true;
        const classes = [];
        if (Array.isArray(step.classes)) classes.push(...step.classes);
        (step.intersections || []).forEach(intersection => {
            if (Array.isArray(intersection.classes)) classes.push(...intersection.classes);
        });
        return classes.some(value => String(value).toLowerCase().includes('tunnel'));
    }

    /**
     * Produce a bounded geometry for expensive building/terrain ray tests while
     * retaining the untouched OSRM geometry for map display and navigation.
     * Normal road spans use 50 m samples. Sharp turns, maneuver boundaries and
     * OSRM tunnel-labelled steps are retained/densified at 25 m.
     */
    function buildPrecisionAnalysisGeometry(rawRoute, options = {}) {
        const coordinates = getRouteCoordinates(rawRoute);
        if (coordinates.length < 2) {
            return { coordinates: coordinates.map(point => [Number(point[0]), Number(point[1])]), distances: [0], originalCoordinateCount: coordinates.length };
        }
        const normalInterval = Math.max(25, Number(options.intervalMeters) || PRECISION_SAMPLE_INTERVAL_METERS);
        const detailInterval = Math.min(normalInterval, Math.max(10, Number(options.detailIntervalMeters) || PRECISION_DETAIL_INTERVAL_METERS));
        const cumulative = [0];
        for (let i = 1; i < coordinates.length; i++) {
            cumulative.push(cumulative[i - 1] + calculateDistanceMeters(
                Number(coordinates[i - 1][1]), Number(coordinates[i - 1][0]),
                Number(coordinates[i][1]), Number(coordinates[i][0])
            ));
        }
        const total = cumulative[cumulative.length - 1];
        if (!Number.isFinite(total) || total <= 0) {
            return { coordinates: coordinates.map(point => [Number(point[0]), Number(point[1])]), distances: cumulative, originalCoordinateCount: coordinates.length };
        }

        const targetDistances = new Set([0, total]);
        const requiredDistances = new Set([0, total]);
        for (let distance = normalInterval; distance < total; distance += normalInterval) targetDistances.add(distance);

        // Preserve original vertices that materially change road direction and
        // add one detailed sample on each side of the turn.
        for (let i = 1; i < coordinates.length - 1; i++) {
            const before = calculateBearing(coordinates[i - 1][1], coordinates[i - 1][0], coordinates[i][1], coordinates[i][0]);
            const after = calculateBearing(coordinates[i][1], coordinates[i][0], coordinates[i + 1][1], coordinates[i + 1][0]);
            if (angularDifferenceDegrees(before, after) >= PRECISION_TURN_THRESHOLD_DEG) {
                targetDistances.add(cumulative[i]);
                targetDistances.add(Math.max(0, cumulative[i] - detailInterval));
                targetDistances.add(Math.min(total, cumulative[i] + detailInterval));
                requiredDistances.add(cumulative[i]);
            }
        }

        const routeSteps = Array.isArray(options.steps) ? options.steps : [];
        routeSteps.forEach(step => {
            const stepCoordinates = step && step.geometry && Array.isArray(step.geometry.coordinates)
                ? step.geometry.coordinates : [];
            const anchors = [];
            if (step.maneuver && Array.isArray(step.maneuver.location)) anchors.push(step.maneuver.location);
            if (stepCoordinates.length) anchors.push(stepCoordinates[0], stepCoordinates[stepCoordinates.length - 1]);
            const anchorDistances = anchors.map(point => nearestRouteDistanceForPoint(point, coordinates, cumulative))
                .filter(Number.isFinite);
            anchorDistances.forEach(distance => { targetDistances.add(distance); requiredDistances.add(distance); });
            if (stepLooksLikeTunnel(step) && anchorDistances.length >= 2) {
                const start = Math.min(...anchorDistances);
                const end = Math.max(...anchorDistances);
                for (let distance = start; distance <= end; distance += detailInterval) targetDistances.add(distance);
            }
        });

        let distances = Array.from(targetDistances).filter(Number.isFinite).sort((a, b) => a - b)
            .filter((distance, index, values) => index === 0 || distance - values[index - 1] >= 0.25);
        const maxPoints = Math.max(2, Math.min(
            coordinates.length,
            Math.max(2, Number(options.maxPoints) || PRECISION_MAX_POINTS)
        ));
        if (distances.length > maxPoints) {
            let required = [...requiredDistances].filter(Number.isFinite).sort((a, b) => a - b)
                .filter((distance, index, values) => index === 0 || distance - values[index - 1] >= 0.25);
            if (required.length > maxPoints) {
                required = Array.from({ length: maxPoints }, (_, index) =>
                    required[Math.round(index * (required.length - 1) / Math.max(1, maxPoints - 1))]);
            }
            const selected = new Set(required);
            const optional = distances.filter(distance => !selected.has(distance));
            const remaining = maxPoints - selected.size;
            for (let index = 0; index < remaining && optional.length; index++) {
                selected.add(optional[Math.round(index * (optional.length - 1) / Math.max(1, remaining - 1))]);
            }
            distances = [...selected].sort((a, b) => a - b);
        }
        const sampled = distances.map(distance => interpolateRoutePointAtDistance(coordinates, cumulative, distance));
        return {
            coordinates: sampled,
            distances,
            totalMeters: total,
            originalCoordinateCount: coordinates.length,
            analysisCoordinateCount: sampled.length,
            intervalMeters: normalInterval,
            detailIntervalMeters: detailInterval
        };
    }

    function mapPrecisionAnalysisToOriginalGeometry(refinedAnalyzed, heuristicAnalyzed, rawCoordinates, sampling) {
        if (!refinedAnalyzed || !heuristicAnalyzed || !Array.isArray(rawCoordinates)) return refinedAnalyzed;
        const precisionSegments = Array.isArray(refinedAnalyzed.segments) ? refinedAnalyzed.segments : [];
        const sampleDistances = sampling && Array.isArray(sampling.distances) ? sampling.distances : [];
        const originalSegments = Array.isArray(heuristicAnalyzed.segments) ? heuristicAnalyzed.segments : [];
        let precisionIndex = 0;
        let originalDistance = 0;
        const mappedSegments = originalSegments.map(segment => {
            const segmentMeters = calculateDistanceMeters(segment.p1[0], segment.p1[1], segment.p2[0], segment.p2[1]);
            const midpoint = originalDistance + segmentMeters / 2;
            while (precisionIndex < precisionSegments.length - 1 && Number(sampleDistances[precisionIndex + 1]) < midpoint) precisionIndex++;
            originalDistance += segmentMeters;
            const precision = precisionSegments[precisionIndex];
            if (!precision) return Object.assign({}, segment);
            return Object.assign({}, segment, {
                shadeScore: precision.shadeScore,
                shadeState: precision.shadeState,
                confirmedShade: precision.confirmedShade,
                estimatedShadePotential: precision.estimatedShadePotential,
                occlusionRatio: precision.occlusionRatio,
                sunIntensity: precision.sunIntensity,
                directSolarExposure: precision.directSolarExposure,
                irradiance: precision.irradiance,
                weather: precision.weather,
                directHorizontalIrradianceWm2: precision.directHorizontalIrradianceWm2,
                directSolarEnergyWhM2: precision.directSolarEnergyWhM2,
                diffuseSkyEnergyWhM2: precision.diffuseSkyEnergyWhM2,
                shadeSource: precision.shadeSource,
                sceneOcclusion: precision.sceneOcclusion,
                solarExposureScore: precision.solarExposureScore,
                uvScore: precision.uvScore
            });
        });
        return Object.assign({}, refinedAnalyzed, {
            // Consumers use this geometry for snapping, rendering, rerouting
            // and turn guidance, so it must remain byte-for-byte OSRM-shaped.
            coordinates: rawCoordinates,
            segments: mappedSegments,
            precisionAnalysisCoordinates: sampling.coordinates,
            precisionSampling: {
                originalCoordinateCount: sampling.originalCoordinateCount,
                analysisCoordinateCount: sampling.analysisCoordinateCount,
                intervalMeters: sampling.intervalMeters,
                detailIntervalMeters: sampling.detailIntervalMeters
            }
        });
    }

    function sampleRouteGeometry(route, maxSamples = ROUTE_GEOMETRY_SAMPLE_COUNT) {
        const coordinates = getRouteCoordinates(route);
        if (!coordinates.length) return [];
        if (coordinates.length <= maxSamples) return coordinates.map(point => [Number(point[0]), Number(point[1])]);
        const cumulative = [0];
        for (let i = 1; i < coordinates.length; i++) {
            cumulative.push(cumulative[i - 1] + calculateDistanceMeters(
                Number(coordinates[i - 1][1]), Number(coordinates[i - 1][0]),
                Number(coordinates[i][1]), Number(coordinates[i][0])
            ));
        }
        const total = cumulative[cumulative.length - 1];
        if (!Number.isFinite(total) || total <= 0) {
            return Array.from({ length: maxSamples }, (_, index) => {
                const sourceIndex = Math.round(index * (coordinates.length - 1) / Math.max(1, maxSamples - 1));
                return [Number(coordinates[sourceIndex][0]), Number(coordinates[sourceIndex][1])];
            });
        }
        const sampled = [];
        let cursor = 1;
        for (let i = 0; i < maxSamples; i++) {
            const target = total * i / Math.max(1, maxSamples - 1);
            while (cursor < cumulative.length - 1 && cumulative[cursor] < target) cursor++;
            const startIndex = Math.max(0, cursor - 1);
            const endIndex = Math.min(coordinates.length - 1, cursor);
            const span = cumulative[endIndex] - cumulative[startIndex];
            const fraction = span > 0 ? (target - cumulative[startIndex]) / span : 0;
            sampled.push([
                Number(coordinates[startIndex][0]) + (Number(coordinates[endIndex][0]) - Number(coordinates[startIndex][0])) * fraction,
                Number(coordinates[startIndex][1]) + (Number(coordinates[endIndex][1]) - Number(coordinates[startIndex][1])) * fraction
            ]);
        }
        return sampled;
    }

    function geometryPointDistanceMeters(a, b) {
        if (!a || !b) return Infinity;
        return calculateDistanceMeters(Number(a[1]), Number(a[0]), Number(b[1]), Number(b[0]));
    }

    function directedGeometryHausdorffMeters(source, target) {
        if (!source.length || !target.length) return Infinity;
        return Math.max(...source.map(point => Math.min(...target.map(candidate =>
            geometryPointDistanceMeters(point, candidate)))));
    }

    function geometryHausdorffDistanceMeters(routeA, routeB) {
        const samplesA = sampleRouteGeometry(routeA);
        const samplesB = sampleRouteGeometry(routeB);
        if (!samplesA.length || !samplesB.length) return Infinity;
        return Math.max(
            directedGeometryHausdorffMeters(samplesA, samplesB),
            directedGeometryHausdorffMeters(samplesB, samplesA)
        );
    }

    function geometryOverlapRatio(routeA, routeB, thresholdMeters = ROUTE_DUPLICATE_OVERLAP_METERS) {
        const samplesA = sampleRouteGeometry(routeA);
        const samplesB = sampleRouteGeometry(routeB);
        if (!samplesA.length || !samplesB.length) return 0;
        const coveredA = samplesA.filter(point => Math.min(...samplesB.map(candidate =>
            geometryPointDistanceMeters(point, candidate))) <= thresholdMeters).length / samplesA.length;
        const coveredB = samplesB.filter(point => Math.min(...samplesA.map(candidate =>
            geometryPointDistanceMeters(point, candidate))) <= thresholdMeters).length / samplesB.length;
        return Math.min(coveredA, coveredB);
    }

    function areRoutesGeometricallySimilar(routeA, routeB) {
        // Distance and duration are a cheap first filter, never the complete
        // duplicate decision. Distinct corridors can have nearly identical
        // totals, so compare sampled geometry before suppressing a candidate.
        const distanceA = Number(routeA && routeA.distance);
        const distanceB = Number(routeB && routeB.distance);
        const durationA = Number(routeA && routeA.duration);
        const durationB = Number(routeB && routeB.duration);
        if ([distanceA, distanceB, durationA, durationB].every(Number.isFinite) &&
            (Math.abs(distanceA - distanceB) >= 80 || Math.abs(durationA - durationB) >= 15)) return false;
        const samplesA = sampleRouteGeometry(routeA);
        const samplesB = sampleRouteGeometry(routeB);
        if (!samplesA.length || !samplesB.length) return true;
        return geometryHausdorffDistanceMeters(routeA, routeB) <= ROUTE_DUPLICATE_HAUSDORFF_METERS &&
            geometryOverlapRatio(routeA, routeB) >= 0.8;
    }

    function routeGeometrySignature(rawRoute) {
        const samples = sampleRouteGeometry(rawRoute, 12);
        return samples.map(point => `${point[0].toFixed(4)},${point[1].toFixed(4)}`).join(';');
    }

    function createRouteIdentity(rawRoute, fallbackIndex = 0) {
        const coordinates = getRouteCoordinates(rawRoute);
        const first = coordinates[0] || [];
        const last = coordinates[coordinates.length - 1] || [];
        const values = [
            Number(rawRoute && rawRoute.distance || 0), Number(rawRoute && rawRoute.duration || 0),
            Number(first[0]), Number(first[1]), Number(last[0]), Number(last[1])
        ];
        return values.every(Number.isFinite)
            ? `route-${values.map(value => value.toFixed(5)).join('-')}-${routeGeometrySignature(rawRoute)}`
            : `route-index-${fallbackIndex}-${routeGeometrySignature(rawRoute)}`;
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

    function routeSolarExposure(analyzed) {
        // Route choice is based on time-integrated incident energy. A mean
        // irradiance score can make a longer detour look beneficial even when
        // the occupant receives more total direct solar energy over the trip.
        if (analyzed && Number.isFinite(Number(analyzed.directSolarEnergyWhM2))) {
            return Number(analyzed.directSolarEnergyWhM2);
        }
        if (analyzed && Number.isFinite(Number(analyzed.totalDirectSolarExposureUnits))) {
            return Number(analyzed.totalDirectSolarExposureUnits);
        }
        return Number(analyzed && analyzed.totalUvExposureUnits) || 0;
    }

    function routeSunlitTimeSeconds(route) {
        const analyzed = route && route.analyzed || {};
        const exactSeconds = Number(analyzed.sunlitTimeSeconds);
        if (Number.isFinite(exactSeconds) && exactSeconds >= 0) return exactSeconds;
        const ratio = Number(analyzed.sunlitTimeRatio);
        const analyzedDuration = Number(analyzed.totalTimeSeconds);
        if (Number.isFinite(ratio) && ratio >= 0) {
            const duration = Number.isFinite(analyzedDuration) && analyzedDuration >= 0
                ? analyzedDuration : routeDurationForSelection(route);
            if (Number.isFinite(duration)) return Math.max(0, ratio) * Math.max(0, duration);
        }
        // Older cached/test route objects may not carry the explicit metric.
        // Treat a daylight route as exposed for its full duration so missing
        // evidence can never fabricate shade; zero direct energy remains night.
        const duration = routeDurationForSelection(route);
        return Number.isFinite(duration) && routeSolarExposure(analyzed) > 0 ? Math.max(0, duration) : 0;
    }

    function compareShadeRoutes(a, b) {
        const sunlitDifference = routeSunlitTimeSeconds(a) - routeSunlitTimeSeconds(b);
        if (Math.abs(sunlitDifference) > SUNLIT_TIME_TIE_TOLERANCE_SEC) return sunlitDifference;
        const energyDifference = routeSolarExposure(a.analyzed) - routeSolarExposure(b.analyzed);
        if (Math.abs(energyDifference) > 0.000001) return energyDifference;
        return routeDurationForSelection(a) - routeDurationForSelection(b);
    }

    function routeShadeMetric(analyzed) {
        const mode = analyzed && analyzed.analysisMode;
        if (['scene', 'hybrid-scene'].includes(mode) && Number.isFinite(Number(analyzed.confirmedShadeRatio))) {
            return Number(analyzed.confirmedShadeRatio);
        }
        return Number(analyzed && analyzed.avgShadeCoverage) || 0;
    }

    function normalizePreferredRouteRole(role) {
        if (role === 'shade') return 'shade';
        if (role === 'fastest') return 'fastest';
        return 'glareFree';
    }

    function selectPrecisionCandidates(routes, maxCandidates = 5, preferredRole = 'glareFree') {
        if (!Array.isArray(routes) || routes.length === 0) {
            return { fastest: null, glareCandidates: [], shadeCandidates: [], precisionCandidates: [] };
        }
        const fastest = stableSortRoutes(routes, (a, b) => routeDurationForSelection(a) - routeDurationForSelection(b))[0];
        const glareCandidates = stableSortRoutes(routes.filter(route => route.id === fastest.id ||
            isMeaningfulGlareAlternative(calculateRouteTradeoff(fastest, route))),
        (a, b) => a.analyzed.avgGlareRisk - b.analyzed.avgGlareRisk).slice(0, 2);
        const shadeCandidates = stableSortRoutes(routes.filter(route => route.id === fastest.id ||
            isPromisingShadePrecisionCandidate(calculateRouteTradeoff(fastest, route))), (a, b) => {
            const exposureDifference = routeSolarExposure(a.analyzed) - routeSolarExposure(b.analyzed);
            return Math.abs(exposureDifference) > 0.001
                ? exposureDifference
                : routeShadeMetric(b.analyzed) - routeShadeMetric(a.analyzed);
        }).slice(0, 2);
        const heuristicRoles = selectRouteRoles(routes);
        const role = normalizePreferredRouteRole(preferredRole);
        const refineAllShortCandidates = routes.length <= 3 && routes.every(route => {
            const distance = Number(route && (route.distanceMeters ?? (route.raw && route.raw.distance)));
            return Number.isFinite(distance) && distance <= 30000;
        });
        // A conservative heuristic pass counts unknown daylight as exposed, so
        // its final shade role can legitimately remain the fastest route. Still
        // refine the best purpose-specific shade signal first; otherwise the
        // scene analysis needed to discover a shorter sunlit duration would be
        // delayed behind the baseline it is meant to challenge.
        const preferred = role === 'shade'
            ? (shadeCandidates.find(route => route.id !== fastest.id) || heuristicRoles.shade)
            : heuristicRoles[role];
        const otherPurpose = role === 'shade' ? heuristicRoles.glareFree : heuristicRoles.shade;
        const selected = [];
        const seen = new Set();
        // Expensive scenes are ordered for user value rather than OSRM array
        // order: the active purpose first, then its duration baseline, then
        // only alternatives that passed the detour/improvement noise guards.
        [preferred, fastest, otherPurpose, ...glareCandidates, ...shadeCandidates,
            ...(refineAllShortCandidates ? routes : [])].forEach(route => {
            if (route && !seen.has(route.id) && selected.length < maxCandidates) {
                seen.add(route.id);
                selected.push(route);
            }
        });
        return { fastest, glareCandidates, shadeCandidates, precisionCandidates: selected };
    }

    // A detour must provide a measurable purpose benefit before it can replace
    // the fastest route. These conservative thresholds are noise guards, not
    // medical protection claims: 30 seconds is a sampling/timing noise band,
    // 5 percentage points guards energy ties, and a 35% time increase is the
    // maximum acceptable detour.
    const MAX_ALTERNATIVE_DETOUR_RATIO = 1.35;
    const MIN_GLARE_IMPROVEMENT = 0.05;
    const MIN_SHADE_IMPROVEMENT = 0.05;
    const MIN_SOLAR_EXPOSURE_REDUCTION_PCT = 5;
    // Direct-sun duration is the primary user-facing shade objective. A
    // 30-second band prevents sampling/timing noise from selecting a detour;
    // within that band integrated direct energy is the tie-breaker.
    const SUNLIT_TIME_TIE_TOLERANCE_SEC = 30;
    const MIN_SUNLIT_TIME_REDUCTION_SEC = 30;
    const SCENE_ROUTE_CACHE_TTL_MS = 10 * 60 * 1000;
    const SCENE_ROUTE_CACHE_MAX = 24;
    const sceneRouteCache = new Map();
    const OSRM_ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
    const OSRM_ROUTE_CACHE_MAX = 12;
    const osrmRouteCache = new Map();

    function osrmRouteCacheKey(start, end, tollFree) {
        return [Number(start.lat).toFixed(5), Number(start.lng).toFixed(5), Number(end.lat).toFixed(5), Number(end.lng).toFixed(5), tollFree ? 'toll-free' : 'standard'].join('|');
    }

    function getCachedOsrmRoutes(key) {
        const entry = osrmRouteCache.get(key);
        if (!entry || entry.expiresAt <= Date.now()) { if (entry) osrmRouteCache.delete(key); return null; }
        osrmRouteCache.delete(key);
        osrmRouteCache.set(key, entry);
        return entry.routes.map(route => ({ ...route }));
    }

    function cacheOsrmRoutes(key, routes) {
        if (!key || !Array.isArray(routes) || !routes.length) return;
        osrmRouteCache.delete(key);
        osrmRouteCache.set(key, { routes: routes.map(route => ({ ...route })), expiresAt: Date.now() + OSRM_ROUTE_CACHE_TTL_MS });
        while (osrmRouteCache.size > OSRM_ROUTE_CACHE_MAX) osrmRouteCache.delete(osrmRouteCache.keys().next().value);
    }

    function calculateRouteTradeoff(fastest, candidate) {
        const fastestDuration = routeDurationForSelection(fastest);
        const candidateDuration = routeDurationForSelection(candidate);
        const fastestAnalyzed = fastest && fastest.analyzed || {};
        const candidateAnalyzed = candidate && candidate.analyzed || {};
        const fastestExposure = routeSolarExposure(fastestAnalyzed);
        const candidateExposure = routeSolarExposure(candidateAnalyzed);
        const fastestSunlitTimeSec = routeSunlitTimeSeconds(fastest);
        const candidateSunlitTimeSec = routeSunlitTimeSeconds(candidate);
        const sunlitTimeReductionSec = fastestSunlitTimeSec - candidateSunlitTimeSec;
        const solarExposureReductionPct = fastestExposure > 0.00001
            ? ((fastestExposure - candidateExposure) / fastestExposure) * 100
            : 0;
        const tradeoff = {
            detourRatio: fastestDuration > 0 && Number.isFinite(candidateDuration) ? candidateDuration / fastestDuration : Infinity,
            extraDurationSec: Number.isFinite(candidateDuration) && Number.isFinite(fastestDuration)
                ? Math.max(0, candidateDuration - fastestDuration) : Infinity,
            glareImprovement: (Number(fastestAnalyzed.avgGlareRisk) || 0) - (Number(candidateAnalyzed.avgGlareRisk) || 0),
            // uvReductionPct is retained only for older UI/state consumers.
            // The value is broadband direct-solar energy reduction, not UV.
            uvReductionPct: Math.max(0, solarExposureReductionPct),
            solarExposureReductionPct: Math.max(0, solarExposureReductionPct),
            shadeImprovement: routeShadeMetric(candidateAnalyzed) - routeShadeMetric(fastestAnalyzed),
            fastestSunlitTimeSec,
            candidateSunlitTimeSec,
            sunlitTimeReductionSec,
            sunlitTimeReductionPct: fastestSunlitTimeSec > 0.5
                ? Math.max(0, (sunlitTimeReductionSec / fastestSunlitTimeSec) * 100) : 0
        };
        candidate.tradeoff = tradeoff;
        return tradeoff;
    }

    function isMeaningfulGlareAlternative(tradeoff) {
        return tradeoff.detourRatio <= MAX_ALTERNATIVE_DETOUR_RATIO &&
            tradeoff.glareImprovement >= MIN_GLARE_IMPROVEMENT;
    }

    function isMeaningfulShadeAlternative(tradeoff) {
        if (tradeoff.detourRatio > MAX_ALTERNATIVE_DETOUR_RATIO) return false;
        if (tradeoff.sunlitTimeReductionSec >= MIN_SUNLIT_TIME_REDUCTION_SEC) return true;
        const sunlitTimeIsTied = Math.abs(tradeoff.sunlitTimeReductionSec) <= SUNLIT_TIME_TIE_TOLERANCE_SEC;
        return sunlitTimeIsTied && tradeoff.solarExposureReductionPct >= MIN_SOLAR_EXPOSURE_REDUCTION_PCT;
    }

    function isPromisingShadePrecisionCandidate(tradeoff) {
        return tradeoff.detourRatio <= MAX_ALTERNATIVE_DETOUR_RATIO &&
            (isMeaningfulShadeAlternative(tradeoff) ||
                tradeoff.solarExposureReductionPct >= MIN_SOLAR_EXPOSURE_REDUCTION_PCT ||
                tradeoff.shadeImprovement >= MIN_SHADE_IMPROVEMENT);
    }

    function selectRouteRoles(routes) {
        if (!Array.isArray(routes) || routes.length === 0) return { fastest: null, glareFree: null, shade: null };
        const fastest = stableSortRoutes(routes, (a, b) => routeDurationForSelection(a) - routeDurationForSelection(b))[0];
        const alternatives = routes.filter(route => route.id !== fastest.id);
        fastest.tradeoff = {
            detourRatio: 1,
            extraDurationSec: 0,
            glareImprovement: 0,
            uvReductionPct: 0,
            solarExposureReductionPct: 0,
            shadeImprovement: 0,
            fastestSunlitTimeSec: routeSunlitTimeSeconds(fastest),
            candidateSunlitTimeSec: routeSunlitTimeSeconds(fastest),
            sunlitTimeReductionSec: 0,
            sunlitTimeReductionPct: 0
        };
        if (alternatives.length === 0) return { fastest, glareFree: fastest, shade: fastest };
        const scored = alternatives.map(route => ({ route, tradeoff: calculateRouteTradeoff(fastest, route) }));
        const glarePool = scored.filter(item => isMeaningfulGlareAlternative(item.tradeoff));
        const glareFree = glarePool.length > 0
            ? stableSortRoutes(glarePool, (a, b) => a.route.analyzed.avgGlareRisk - b.route.analyzed.avgGlareRisk ||
                a.tradeoff.extraDurationSec - b.tradeoff.extraDurationSec).map(item => item.route)[0]
            : fastest;
        const shadePool = scored.filter(item => isMeaningfulShadeAlternative(item.tradeoff));
        const shade = shadePool.length > 0
            ? stableSortRoutes(shadePool, (a, b) => compareShadeRoutes(a.route, b.route)).map(item => item.route)[0]
            : fastest;
        return { fastest, glareFree, shade };
    }

    function applyExposureReductions(fastestRoute, glareFreeRoute, shadeRoute, dateObj, start) {
        if (!fastestRoute) return;
        const baseSolarExposure = routeSolarExposure(fastestRoute.analyzed);
        const sunPos = SunCalc.getPosition(dateObj, start.lat, start.lng);
        const hasDirectSolar = calculateSolarUvIntensity(sunPos.altitude) > 0 || baseSolarExposure > 0.0001;
        fastestRoute.uvReductionPct = 0;
        fastestRoute.solarExposureReductionPct = 0;
        fastestRoute.isNight = !hasDirectSolar;
        [glareFreeRoute, shadeRoute].forEach(route => {
            if (!route) return;
            if (!hasDirectSolar) {
                route.uvReductionPct = 0;
                route.solarExposureReductionPct = 0;
                route.isNight = true;
            } else if (route.id === fastestRoute.id) {
                route.uvReductionPct = 0;
                route.solarExposureReductionPct = 0;
                route.isNight = false;
            } else if (baseSolarExposure > 0.00001) {
                const diffPct = ((baseSolarExposure - routeSolarExposure(route.analyzed)) / baseSolarExposure) * 100;
                route.uvReductionPct = diffPct >= 1 ? Math.min(99, Math.round(diffPct)) : 0;
                route.solarExposureReductionPct = route.uvReductionPct;
                route.isNight = false;
            } else {
                route.uvReductionPct = 0;
                route.solarExposureReductionPct = 0;
                route.isNight = false;
            }
        });
    }

    function sceneFallbackReason(error) {
        const explicitCode = String(error && error.code || '').trim();
        if (explicitCode) return explicitCode;
        const message = String(error && error.message || '').toLowerCase();
        if (message.includes('abort') || message.includes('cancel')) return 'SCENE_REQUEST_ABORTED';
        if (message.includes('timeout')) return message.includes('dem') ? 'DEM_FAILURE' : 'SCENE_PACK_DOWNLOAD_TIMEOUT';
        if (message.includes('range') || message.includes('bbox') || message.includes('250')) return 'ROUTE_TOO_LONG';
        if (message.includes('checksum')) return 'SCENE_PACK_CHECKSUM_FAILURE';
        if (message.includes('decompress') || message.includes('worker')) return 'SCENE_DECOMPRESS_FAILURE';
        return 'SCENE_DATA_UNAVAILABLE';
    }

    function getCachedScene(routeId) {
        const entry = sceneRouteCache.get(routeId);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            sceneRouteCache.delete(routeId);
            return null;
        }
        sceneRouteCache.delete(routeId);
        sceneRouteCache.set(routeId, entry);
        return entry.scene;
    }

    function cacheScene(routeId, scene) {
        if (!routeId || !scene) return;
        sceneRouteCache.delete(routeId);
        sceneRouteCache.set(routeId, { scene, expiresAt: Date.now() + SCENE_ROUTE_CACHE_TTL_MS });
        while (sceneRouteCache.size > SCENE_ROUTE_CACHE_MAX) sceneRouteCache.delete(sceneRouteCache.keys().next().value);
    }

    function createRoleRouteView(route, analyzed, mode, fallbackReason = null) {
        const analyzedCoverage = analyzed && analyzed.sceneCoverage;
        const retainedCoverage = route.sceneCoverage;
        const view = Object.assign({}, route, {
            analyzed,
            analysisMode: mode,
            analysisTier: analyzed && analyzed.analysisTier || mode,
            weatherMode: analyzed && analyzed.weatherMode || 'clear-sky-fallback',
            weatherCoverage: analyzed && Number(analyzed.weatherCoverage) || 0,
            weatherRetrievedAt: analyzed && analyzed.weatherRetrievedAt || null,
            weatherResolutionMinutes: analyzed && analyzed.weatherResolutionMinutes || null,
            weatherSource: analyzed && analyzed.weatherSource || 'bird-clear-sky',
            fallbackReason: mode === 'heuristic' ? (fallbackReason || route.fallbackReason || null) : null,
            // A heuristic comparison tier may still have useful partial-scene
            // diagnostics. Prefer that retained coverage instead of masking it
            // with the empty coverage attached to the initial heuristic pass.
            sceneCoverage: mode === 'heuristic'
                ? (retainedCoverage || analyzedCoverage)
                : (analyzedCoverage || retainedCoverage),
            sceneSource: analyzed && analyzed.sceneSource ? analyzed.sceneSource : route.sceneSource
        });
        if (route.sceneAnalysis) view.sceneAnalysis = route.sceneAnalysis;
        return view;
    }

    function selectRoleByTier(fastest, purposeCandidates, role, refinedById) {
        const unique = [];
        const seen = new Set();
        [fastest, ...(purposeCandidates || [])].forEach(route => {
            if (route && !seen.has(route.id)) { seen.add(route.id); unique.push(route); }
        });
        const baselineResult = fastest ? refinedById.get(fastest.id) : null;
        const baselineReady = !!(baselineResult && baselineResult.ready && baselineResult.refinedAnalyzed);
        const baselineMode = baselineReady ? baselineResult.refinedAnalyzed.analysisMode : 'heuristic';
        const baselineWeatherMode = baselineReady ? baselineResult.refinedAnalyzed.weatherMode : 'clear-sky-fallback';
        // A failed, unrelated alternative must not discard a valid precision
        // baseline. Compare only candidates that completed with the exact same
        // analysis tier as the fastest baseline; failed/mismatched candidates
        // remain diagnostic metadata and are never mixed into the ranking.
        const comparable = baselineReady
            ? unique.filter(route => {
                const refined = refinedById.get(route.id);
                return !!(refined && refined.ready && refined.refinedAnalyzed &&
                    refined.refinedAnalyzed.analysisMode === baselineMode &&
                    refined.refinedAnalyzed.weatherMode === baselineWeatherMode);
            })
            : unique;
        const allReady = baselineReady;
        const mode = baselineReady ? baselineMode : 'heuristic';
        const failedResult = unique.map(route => refinedById.get(route.id)).find(result => result && !result.ready);
        const roleFallbackReason = !baselineReady
            ? (failedResult && failedResult.fallbackReason || 'SCENE_REFINEMENT_INCOMPLETE')
            : null;
        const views = comparable.map(route => {
            const refined = refinedById.get(route.id);
            return createRoleRouteView(route, baselineReady && refined ? refined.refinedAnalyzed : route.analyzed,
                mode, roleFallbackReason || (refined && refined.fallbackReason));
        });
        const baseline = views[0];
        let selected = baseline;
        const alternatives = views.slice(1).map(route => ({ route, tradeoff: calculateRouteTradeoff(baseline, route) }));
        const pool = role === 'glare'
            ? alternatives.filter(item => isMeaningfulGlareAlternative(item.tradeoff))
                .sort((a, b) => a.route.analyzed.avgGlareRisk - b.route.analyzed.avgGlareRisk ||
                    a.tradeoff.extraDurationSec - b.tradeoff.extraDurationSec)
            : alternatives.filter(item => isMeaningfulShadeAlternative(item.tradeoff))
                .sort((a, b) => compareShadeRoutes(a.route, b.route));
        if (pool.length) selected = pool[0].route;
        return { selected, baseline, mode, allReady, fallbackReason: roleFallbackReason, views };
    }

    async function mapWithConcurrency(items, concurrency, worker, signal) {
        const values = Array.isArray(items) ? items : [];
        if (!values.length) return [];
        const limit = Math.max(1, Math.min(values.length, Number(concurrency) || 2));
        let cursor = 0;
        const results = new Array(values.length);
        async function consume() {
            while (true) {
                if (signal && signal.aborted) throw createAbortError();
                const index = cursor++;
                if (index >= values.length) return;
                results[index] = await worker(values[index], index);
            }
        }
        await Promise.all(Array.from({ length: limit }, consume));
        return results;
    }

    async function analyzeRawRoute(rawRoute, idx, dateObj, timeOfDayAdjustment, signal) {
        const baseDuration = Number(rawRoute.duration) || 0;
        const liveDuration = Math.round(baseDuration * timeOfDayAdjustment);
        let routeSteps = null;
        const maneuvers = [];
        if (Array.isArray(rawRoute.legs) && rawRoute.legs.length > 0) {
            routeSteps = [];
            let cumulativeStepDist = 0;
            for (const leg of rawRoute.legs) {
                for (const step of leg.steps || []) {
                    routeSteps.push(step);
                    if (step.maneuver && step.maneuver.type !== 'depart') {
                        maneuvers.push({
                            type: step.maneuver.type, modifier: step.maneuver.modifier || '',
                            location: step.maneuver.location, bearingBefore: step.maneuver.bearing_before,
                            bearingAfter: step.maneuver.bearing_after, name: step.name || '', ref: step.ref || '',
                            distance: step.distance, duration: step.duration, cumulativeDistance: cumulativeStepDist
                        });
                    }
                    cumulativeStepDist += Number(step.distance) || 0;
                }
            }
        }
        const analyzed = await analyzeRouteSegmentsAsync(rawRoute.geometry.coordinates, dateObj, liveDuration, routeSteps, null, signal);
        return {
            id: createRouteIdentity(rawRoute, idx), candidateIndex: idx, raw: rawRoute,
            distanceMeters: Number(rawRoute.distance) || 0, durationSec: liveDuration,
            baseDurationSec: baseDuration, analyzed, maneuvers, routeSteps,
            analysisMode: 'heuristic', sceneCoverage: analyzed.sceneCoverage, sceneSource: analyzed.sceneSource
        };
    }

    function buildHeuristicProgressResult(analyzedRoutes, timeOfDayAdjustment, dateObj, start) {
        if (!analyzedRoutes.length) return null;
        // Apply the same detour/improvement gates to the immediate heuristic
        // result as the final result. Tiny floating-point differences must not
        // recommend a visibly slower route with no meaningful user benefit.
        const roles = selectRouteRoles(analyzedRoutes);
        const fastest = roles.fastest;
        const glareFree = roles.glareFree;
        const shade = roles.shade;
        applyExposureReductions(fastest, glareFree, shade, dateObj, start);
        return {
            timeOfDayAdjustment,
            analysisMode: 'heuristic',
            // The first result is intentionally lightweight and may be
            // rendered while scene/DEM enrichment continues in the
            // background.  Consumers can distinguish it from the final
            // callback without guessing from analysisMode alone.
            analysisPhase: 'heuristic-initial',
            enrichmentPending: true,
            routeCandidates: analyzedRoutes.map(route => route.raw),
            routes: { fastest, glareFree, shade, all: analyzedRoutes }
        };
    }

    async function fetchAndAnalyzeRoutes(start, end, dateObj, isTollFreeOnly = false, options = {}) {
        // Let OSRM decide whether a long-distance route is connected. A
        // straight-line threshold incorrectly rejected valid continental
        // drives before the routing service was even asked.
        if (!areValidRouteCoordinates(start, end)) {
            throw createApiError('INVALID_COORDINATES', 'routeNetworkError', 'Start/end coordinates are invalid');
        }

        const timeOfDayAdjustment = getTimeOfDayAdjustment(dateObj);
        
        const routeCacheKey = osrmRouteCacheKey(start, end, isTollFreeOnly);
        let progressEmitted = false;
        let rawCandidates = Array.isArray(options.candidates) && options.candidates.length
            ? options.candidates.filter(route => route && route.geometry && Array.isArray(route.geometry.coordinates))
            : (options.reuseOsrmCache === true ? getCachedOsrmRoutes(routeCacheKey) : null);
        if (!rawCandidates) {
            // Direct OSRM is intentionally awaited before exploratory
            // via-point requests. The caller can render a usable first route
            // while slower enrichment continues in this same request.
            let directUrl = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson&alternatives=3&steps=true`;
            // When rerouting during navigation, tell OSRM which direction
            // the vehicle is currently facing. This keeps a forward route as
            // the default and leaves a U-turn to OSRM only when no forward
            // connection exists.
            const startHeading = Number(options.startHeading);
            if (Number.isFinite(startHeading) && startHeading >= 0) {
                const bearing = Math.round(((startHeading % 360) + 360) % 360);
                directUrl += `&bearings=${bearing},60;`;
            }
            if (isTollFreeOnly) directUrl += `&exclude=toll`;

            const directStartedAt = Date.now();
            if (window.DebugLogger) window.DebugLogger.log('osrm-direct-start', { tollFree: isTollFreeOnly });
            const directResponse = await fetchJsonWithTimeout(directUrl, {
                signal: options.signal,
                timeoutMs: options.directTimeoutMs || 10000
            });
            rawCandidates = directResponse && Array.isArray(directResponse.routes) ? directResponse.routes.slice() : [];
            rawCandidates.forEach(route => assignRoadDestination(route, directResponse && directResponse.waypoints));
            if (window.DebugLogger && typeof window.DebugLogger.log === 'function') {
                window.DebugLogger.log('osrm-direct-success', { elapsedMs: Date.now() - directStartedAt, routeCount: rawCandidates.length, http: 'ok' });
            }
            if (rawCandidates.length && typeof options.onProgress === 'function') {
                const directAnalyzed = await Promise.all(rawCandidates.map((route, index) =>
                    analyzeRawRoute(route, index, dateObj, timeOfDayAdjustment, options.signal)));
                const progress = buildHeuristicProgressResult(directAnalyzed, timeOfDayAdjustment, dateObj, start);
                if (progress) { await options.onProgress(progress); progressEmitted = true; }
            }

            // Generate lateral via-points only after direct results are
            // available. These are optional enrichment, not a prerequisite
            // for displaying or starting the verified direct route.
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
            const directDistinct = rawCandidates.filter((route, index) => rawCandidates.slice(0, index).every(previous => !areRoutesGeometricallySimilar(previous, route))).length;
            const viaBudget = directDistinct >= 3 ? 0 : Math.min(2, Math.max(0, Number(options.viaRequestBudget || 2)));
            if (viaBudget === 0) {
                if (window.DebugLogger) window.DebugLogger.log('osrm-via-skipped', { reason: 'DIRECT_ALTERNATIVES_SUFFICIENT', directDistinct });
            }
            const tollQuery = isTollFreeOnly ? '&exclude=toll' : '';
            const viaBearing = Number.isFinite(startHeading) && startHeading >= 0
                ? `&bearings=${Math.round(((startHeading % 360) + 360) % 360)},60;;`
                : '';
            const urls = [
                directUrl,
                ...offsets.map(v => `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${v.lng.toFixed(6)},${v.lat.toFixed(6)};${end.lng},${end.lat}?overview=full&geometries=geojson&continue_straight=true&steps=true${tollQuery}${viaBearing}`)
            ];
            const viaUrls = urls.slice(1);
            const responses = await Promise.allSettled(viaUrls.slice(0, viaBudget).map(u => fetchJsonWithTimeout(u, {
                signal: options.signal,
                timeoutMs: options.viaTimeoutMs || 10000
            })));
            if (window.DebugLogger) window.DebugLogger.log('osrm-via-end', { requested: viaUrls.slice(0, viaBudget).length, fulfilled: responses.filter(result => result.status === 'fulfilled').length });
            responses.forEach(res => {
                if (res.status === 'fulfilled' && res.value && res.value.routes) {
                    res.value.routes.forEach(route => assignRoadDestination(route, res.value.waypoints));
                    rawCandidates.push(...res.value.routes);
                }
            });
        }

        if (!progressEmitted && rawCandidates && rawCandidates.length && typeof options.onProgress === 'function') {
            const cachedAnalyzed = await Promise.all(rawCandidates.map((route, index) =>
                analyzeRawRoute(route, index, dateObj, timeOfDayAdjustment, options.signal)));
            const progress = buildHeuristicProgressResult(cachedAnalyzed, timeOfDayAdjustment, dateObj, start);
            if (progress) await options.onProgress(progress);
        }

        cacheOsrmRoutes(routeCacheKey, rawCandidates);

        const filteredCandidates = isTollFreeOnly
            ? rawCandidates.filter(route => !routeContainsToll(route))
            : rawCandidates;

        if (filteredCandidates.length === 0) {
            if (isTollFreeOnly && rawCandidates.length > 0) {
                throw createApiError('TOLL_FREE_UNAVAILABLE', 'routeNetworkError', 'All returned routes contain toll indicators');
            }
            throw createApiError('ROUTE_UNAVAILABLE', 'routeNetworkError', 'OSRM returned no usable routes');
        }

        // Deduplicate route candidates by distance/duration first, then by a
        // fixed-size sampled geometry comparison.  This preserves genuinely
        // different corridors that happen to have similar totals.
        const uniqueRoutes = [];
        const minDuration = Math.min(...filteredCandidates.map(r => r.duration));

        for (const r of filteredCandidates) {
            if (r.duration > minDuration * 1.60) continue;
            const isDuplicate = uniqueRoutes.some(u => areRoutesGeometricallySimilar(u, r));
            if (!isDuplicate) {
                uniqueRoutes.push(r);
            }
        }

        if (uniqueRoutes.length === 0) uniqueRoutes.push(filteredCandidates[0]);

        // First analyse every candidate with the same lightweight model. Scene
        // data is selected only after these common scores are available.
        const analyzedRoutes = await Promise.all(uniqueRoutes.map((route, idx) =>
            analyzeRawRoute(route, idx, dateObj, timeOfDayAdjustment, options.signal)));

        const selection = selectPrecisionCandidates(analyzedRoutes, 5, options.preferredRouteRole);
        let weatherProfile = null;
        let weatherFallbackReason = null;
        if (window.WeatherRadiation && typeof window.WeatherRadiation.fetchForecastForRoutes === 'function' &&
            options.disableWeatherRefinement !== true) {
            const weatherStartedAt = Date.now();
            if (window.DebugLogger) window.DebugLogger.log('weather-refinement-start', {
                candidateCount: selection.precisionCandidates.length
            });
            try {
                const forecast = await window.WeatherRadiation.fetchForecastForRoutes(
                    selection.precisionCandidates, dateObj, {
                        signal: options.sceneSignal || options.signal,
                        timeoutMs: options.weatherTimeoutMs || 8000,
                        fetchImpl: options.weatherFetch
                    }
                );
                if (forecast && forecast.available && Number(forecast.coverage) >= 0.999) {
                    weatherProfile = forecast;
                } else {
                    weatherFallbackReason = forecast && forecast.fallbackReason || 'WEATHER_COVERAGE_INCOMPLETE';
                }
                if (window.DebugLogger) window.DebugLogger.log('weather-refinement-end', {
                    elapsedMs: Date.now() - weatherStartedAt,
                    mode: weatherProfile ? 'forecast' : 'clear-sky-fallback',
                    coverage: forecast && forecast.coverage,
                    reason: weatherFallbackReason
                });
            } catch (weatherError) {
                if ((options.sceneSignal && options.sceneSignal.aborted) || (options.signal && options.signal.aborted)) throw weatherError;
                weatherFallbackReason = weatherError && weatherError.name === 'AbortError'
                    ? 'WEATHER_REQUEST_ABORTED' : 'WEATHER_DATA_UNAVAILABLE';
                if (window.DebugLogger) window.DebugLogger.log('weather-refinement-failure', {
                    elapsedMs: Date.now() - weatherStartedAt,
                    reason: weatherFallbackReason,
                    message: String(weatherError && weatherError.message || weatherError)
                });
            }
        } else {
            weatherFallbackReason = 'WEATHER_REFINEMENT_DISABLED';
        }
        function routeIsEntirelyNight(route) {
            const segments = route && route.analyzed && route.analyzed.segments;
            return Array.isArray(segments) && segments.length > 0 && segments.every(segment =>
                segment && segment.passTime instanceof Date &&
                SunCalc.getPosition(segment.passTime, segment.p1[0], segment.p1[1]).altitude <= 0);
        }
        const refineRoute = async route => {
            if (options.signal && options.signal.aborted) throw createAbortError();
            let scene = null;
            let refinedAnalyzed = null;
            let fallbackReason = null;
            const rawCoordinates = route.raw.geometry.coordinates;
            const precisionSampling = buildPrecisionAnalysisGeometry(route.raw, { steps: route.routeSteps });
            const precisionCoordinates = precisionSampling.coordinates;
            try {
                if (routeIsEntirelyNight(route)) {
                    fallbackReason = 'NIGHT_SCENE_NOT_NEEDED';
                    return { route, refinedAnalyzed: null, fallbackReason, ready: false };
                }
                const sceneSignal = options.sceneSignal || options.signal;
                const sceneOptions = {
                    dateObj,
                    durationSec: route.durationSec,
                    timeLookup: buildStepTimeLookup(precisionCoordinates, route.routeSteps, route.durationSec),
                    signal: sceneSignal,
                    timeoutMs: 12000,
                    terrainTimeoutMs: 10000,
                    precomputedManifestTimeoutMs: options.precomputedManifestTimeoutMs || 10000,
                    precomputedPackTimeoutMs: options.precomputedPackTimeoutMs || 15000,
                    precomputedPackRetryCount: options.precomputedPackRetryCount ?? 1,
                    // CapacitorHttp bridges binary responses as base64. Keep
                    // Android ZIP transfers sequential to bound transient heap
                    // while desktop browsers may still fetch two packs.
                    scenePackConcurrency: options.scenePackConcurrency ||
                        (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' &&
                            window.Capacitor.isNativePlatform() ? 1 : 2),
                    precomputedManifestUrl: options.precomputedManifestUrl,
                    maxRouteMeters: 250000
                };
                // Prefer immutable, precomputed regional scene tiles.  Only
                // when a tile is missing or the manifest is unavailable do we
                // fall back to the live Overpass/DEM scene request.
                let precomputedError = null;
                if (!scene && window.SceneShadow && typeof window.SceneShadow.fetchPrecomputedSceneForRoute === 'function') {
                    try {
                        scene = await window.SceneShadow.fetchPrecomputedSceneForRoute(precisionCoordinates, sceneOptions);
                    } catch (error) {
                        if (sceneSignal && sceneSignal.aborted) throw error;
                        precomputedError = error;
                        if (window.DebugLogger) window.DebugLogger.log('precomputed-scene-failure', {
                            reason: sceneFallbackReason(error), message: String(error && error.message || error)
                        });
                    }
                }
                if (!scene && options.disableLiveSceneFallback !== true && window.SceneShadow && typeof window.SceneShadow.fetchSceneForRoute === 'function') {
                    try {
                        scene = await window.SceneShadow.fetchSceneForRoute(precisionCoordinates, sceneOptions);
                    } catch (liveError) {
                        if (sceneSignal && sceneSignal.aborted) throw liveError;
                        // The immutable regional archive is the primary source.
                        // Preserve its concrete failure code when live public
                        // APIs also fail instead of reducing both to a generic
                        // SCENE_DATA_UNAVAILABLE label.
                        throw precomputedError || liveError;
                    }
                }
                if (isPrecisionScene(scene)) {
                    const sampledAnalysis = await analyzeRouteSegmentsAsync(
                        precisionCoordinates, dateObj, route.durationSec, route.routeSteps,
                        scene, sceneSignal, { weatherProfile }
                    );
                    refinedAnalyzed = mapPrecisionAnalysisToOriginalGeometry(
                        sampledAnalysis, route.analyzed, rawCoordinates, precisionSampling
                    );
                } else {
                    fallbackReason = precomputedError ? sceneFallbackReason(precomputedError) : 'SCENE_DATA_UNAVAILABLE';
                }
            } catch (sceneError) {
                if ((options.sceneSignal && options.sceneSignal.aborted) || (options.signal && options.signal.aborted)) throw sceneError;
                console.warn('Scene data unavailable; retaining common heuristic comparison.', sceneError);
                fallbackReason = sceneFallbackReason(sceneError);
            }
            // Forecast irradiance is still useful when a scene tile is
            // unavailable. Re-analyse without scene occlusion so every segment
            // remains conservatively exposed; this cannot fabricate shade.
            if (!refinedAnalyzed && weatherProfile) {
                const weatherOnly = await analyzeRouteSegmentsAsync(
                    precisionCoordinates, dateObj, route.durationSec, route.routeSteps,
                    null, options.sceneSignal || options.signal, { weatherProfile }
                );
                refinedAnalyzed = mapPrecisionAnalysisToOriginalGeometry(
                    weatherOnly, route.analyzed, rawCoordinates, precisionSampling
                );
            }
            const result = {
                route, refinedAnalyzed, fallbackReason,
                ready: !!refinedAnalyzed && (
                    ['scene', 'hybrid-scene'].includes(refinedAnalyzed.analysisMode) ||
                    refinedAnalyzed.weatherMode === 'forecast'
                )
            };
            if (refinedAnalyzed) route.sceneAnalysis = refinedAnalyzed;
            route.sceneCoverage = scene && scene.coverage ? { ...scene.coverage } : route.analyzed.sceneCoverage;
            route.sceneSource = scene && scene.source ? scene.source : route.analyzed.sceneSource;
            route.fallbackReason = fallbackReason || null;
            scene = null;
            return result;
        };

        function buildTieredProgress(processedResults, phase, enrichmentPending) {
            const processedById = new Map(processedResults.map(result => [result.route.id, result]));
            const readyPurposeRoutes = routes => (routes || []).filter(route => processedById.has(route.id));
            const fastestTier = selectRoleByTier(selection.fastest, [], 'fastest', processedById);
            const glareTier = selectRoleByTier(selection.fastest, readyPurposeRoutes(selection.glareCandidates), 'glare', processedById);
            const shadeTier = selectRoleByTier(selection.fastest, readyPurposeRoutes(selection.shadeCandidates), 'shade', processedById);
            applyExposureReductions(fastestTier.baseline, null, null, dateObj, start);
            applyExposureReductions(glareTier.baseline, glareTier.selected, null, dateObj, start);
            applyExposureReductions(shadeTier.baseline, null, shadeTier.selected, dateObj, start);
            const roleModes = [fastestTier.mode, glareTier.mode, shadeTier.mode];
            const roleMeta = tier => ({
                analysisMode: tier.mode,
                analysisTier: tier.selected && tier.selected.analysisTier || tier.mode,
                weatherMode: tier.selected && tier.selected.weatherMode || 'clear-sky-fallback',
                refinementReady: tier.allReady,
                sceneReady: tier.allReady && ['scene', 'hybrid-scene'].includes(tier.mode),
                weatherReady: tier.allReady && tier.selected && tier.selected.weatherMode === 'forecast',
                fallbackReason: tier.fallbackReason || null
            });
            return {
                timeOfDayAdjustment,
                analysisMode: roleModes.every(mode => mode === 'scene') ? 'scene' :
                    (roleModes.every(mode => mode === 'hybrid-scene') ? 'hybrid-scene' :
                        (roleModes.every(mode => mode === 'heuristic') ? 'heuristic' : 'mixed-by-role')),
                analysisPhase: phase,
                enrichmentPending,
                backgroundRefinementComplete: !enrichmentPending,
                refinedAt: Date.now(),
                weatherMode: weatherProfile ? 'forecast' : 'clear-sky-fallback',
                weatherCoverage: weatherProfile ? Number(weatherProfile.coverage) || 0 : 0,
                weatherRetrievedAt: weatherProfile && weatherProfile.weatherRetrievedAt || null,
                weatherResolutionMinutes: weatherProfile && weatherProfile.weatherResolutionMinutes || null,
                weatherSource: weatherProfile && weatherProfile.weatherSource || 'bird-clear-sky',
                weatherFallbackReason,
                precisionCandidateIds: selection.precisionCandidates.map(route => route.id),
                refinedCandidateIds: processedResults.map(result => result.route.id),
                routeCandidates: analyzedRoutes.map(route => route.raw),
                roleAnalysis: {
                    fastest: roleMeta(fastestTier),
                    glareFree: roleMeta(glareTier),
                    shade: roleMeta(shadeTier)
                },
                routes: {
                    fastest: fastestTier.baseline,
                    glareFree: glareTier.selected,
                    shade: shadeTier.selected,
                    all: analyzedRoutes
                }
            };
        }

        // Fetch the active purpose first, then its fastest-route baseline.
        // Remaining competitive alternatives may use a tiny bounded pool, but
        // the default stays sequential to avoid mobile download/heap spikes.
        const refinedResults = [];
        const firstCandidate = selection.precisionCandidates[0] || null;
        const priorityCount = Math.min(selection.precisionCandidates.length,
            firstCandidate && selection.fastest && firstCandidate.id !== selection.fastest.id ? 2 : 1);
        for (let index = 0; index < priorityCount; index++) {
            refinedResults.push(await refineRoute(selection.precisionCandidates[index]));
        }
        if (refinedResults.length && typeof options.onProgress === 'function' &&
            selection.precisionCandidates.length > refinedResults.length) {
            if (options.signal && options.signal.aborted) throw createAbortError();
            await options.onProgress(buildTieredProgress(refinedResults, 'precision-partial', true));
        }
        const remainingCandidates = selection.precisionCandidates.slice(priorityCount);
        if (remainingCandidates.length) {
            const remaining = await mapWithConcurrency(
                remainingCandidates,
                Math.min(2, Math.max(1, Number(options.sceneConcurrency) || 1)),
                refineRoute,
                options.signal
            );
            refinedResults.push(...remaining);
        }

        // A final ranking must use one common data tier. If any precision
        // candidate lacks the same scene tier, preserve successful scene data
        // for diagnostics but recompute every comparison route uniformly with
        // forecast irradiance (or uniformly with the initial clear-sky model).
        const sceneModes = new Set(refinedResults.filter(result => result.ready && result.refinedAnalyzed)
            .map(result => result.refinedAnalyzed.analysisMode));
        const weatherModes = new Set(refinedResults.filter(result => result.ready && result.refinedAnalyzed)
            .map(result => result.refinedAnalyzed.weatherMode || 'clear-sky-fallback'));
        const uniformSceneTier = refinedResults.length === selection.precisionCandidates.length &&
            refinedResults.every(result => result.ready && result.refinedAnalyzed &&
                ['scene', 'hybrid-scene'].includes(result.refinedAnalyzed.analysisMode)) &&
            sceneModes.size === 1 && weatherModes.size === 1 &&
            (!weatherProfile || weatherModes.has('forecast'));
        let comparisonResults = refinedResults;
        if (!uniformSceneTier && weatherProfile) {
            const weatherComparisonResults = await mapWithConcurrency(
                selection.precisionCandidates,
                Math.min(2, Math.max(1, Number(options.sceneConcurrency) || 1)),
                async route => {
                    const sampling = buildPrecisionAnalysisGeometry(route.raw, { steps: route.routeSteps });
                    const weatherOnly = await analyzeRouteSegmentsAsync(
                        sampling.coordinates, dateObj, route.durationSec, route.routeSteps,
                        null, options.sceneSignal || options.signal, { weatherProfile }
                    );
                    const mapped = mapPrecisionAnalysisToOriginalGeometry(
                        weatherOnly, route.analyzed, route.raw.geometry.coordinates, sampling
                    );
                    route.weatherAnalysis = mapped;
                    return {
                        route,
                        refinedAnalyzed: mapped,
                        ready: true,
                        fallbackReason: 'COMMON_SCENE_TIER_INCOMPLETE'
                    };
                },
                options.signal
            );
            if (weatherComparisonResults.every(result => result.refinedAnalyzed &&
                result.refinedAnalyzed.weatherMode === 'forecast')) {
                comparisonResults = weatherComparisonResults;
            } else {
                weatherProfile = null;
                weatherFallbackReason = 'WEATHER_SEGMENT_COVERAGE_INCOMPLETE';
                comparisonResults = selection.precisionCandidates.map(route => ({
                    route, refinedAnalyzed: null, ready: false,
                    fallbackReason: 'COMMON_SCENE_TIER_INCOMPLETE'
                }));
            }
        } else if (!uniformSceneTier) {
            comparisonResults = selection.precisionCandidates.map(route => {
                const original = refinedResults.find(result => result.route.id === route.id);
                return {
                    route,
                    refinedAnalyzed: null,
                    ready: false,
                    fallbackReason: original && original.fallbackReason || 'COMMON_SCENE_TIER_INCOMPLETE'
                };
            });
        }

        // Keep successful scene results attached to their route, but select a
        // comparison tier per role. Precision is never compared directly with
        // a heuristic baseline.
        const refinedById = new Map(comparisonResults.map(result => [result.route.id, result]));
        refinedResults.forEach(({ route, refinedAnalyzed, fallbackReason }) => {
            if (refinedAnalyzed) route.sceneAnalysis = refinedAnalyzed;
            route.sceneCoverage = refinedAnalyzed && refinedAnalyzed.sceneCoverage
                ? refinedAnalyzed.sceneCoverage : route.sceneCoverage;
            route.sceneSource = refinedAnalyzed && refinedAnalyzed.sceneSource
                ? refinedAnalyzed.sceneSource : route.sceneSource;
            route.fallbackReason = fallbackReason || null;
        });

        // Apply reductions only after the common-tier comparison set is fixed.
        // A role uses precision only when its fastest baseline is ready. It
        // compares that baseline solely with successful candidates from the
        // same precision tier; failed candidates are excluded, never replaced
        // by heuristic scores in the precision comparison.
        const fastestTier = selectRoleByTier(selection.fastest, [], 'fastest', refinedById);
        const glareTier = selectRoleByTier(selection.fastest, selection.glareCandidates, 'glare', refinedById);
        const shadeTier = selectRoleByTier(selection.fastest, selection.shadeCandidates, 'shade', refinedById);
        const fastestRoute = fastestTier.baseline;
        const glareFreeRoute = glareTier.selected;
        const shadeRoute = shadeTier.selected;
        // Reductions are calculated independently per role tier. This keeps a
        // heuristic glare/shade fallback from being compared with a precision
        // fastest baseline.
        applyExposureReductions(fastestRoute, null, null, dateObj, start);
        applyExposureReductions(glareTier.baseline, glareFreeRoute, null, dateObj, start);
        applyExposureReductions(shadeTier.baseline, null, shadeRoute, dateObj, start);
        const roleModes = [fastestTier.mode, glareTier.mode, shadeTier.mode];
        const finalRoleMeta = tier => ({
            analysisMode: tier.mode,
            analysisTier: tier.selected && tier.selected.analysisTier || tier.mode,
            weatherMode: tier.selected && tier.selected.weatherMode || 'clear-sky-fallback',
            refinementReady: tier.allReady,
            sceneReady: tier.allReady && ['scene', 'hybrid-scene'].includes(tier.mode),
            weatherReady: tier.allReady && tier.selected && tier.selected.weatherMode === 'forecast',
            fallbackReason: tier.fallbackReason || null
        });
        const finalAnalysisMode = roleModes.every(mode => mode === 'scene')
            ? 'scene'
            : (roleModes.every(mode => mode === 'hybrid-scene') ? 'hybrid-scene'
                : (roleModes.every(mode => mode === 'heuristic') ? 'heuristic' : 'mixed-by-role'));
        const finalResult = {
            timeOfDayAdjustment: timeOfDayAdjustment,
            analysisMode: finalAnalysisMode,
            analysisPhase: 'precision-final',
            enrichmentPending: false,
            backgroundRefinementComplete: true,
            refinedAt: Date.now(),
            weatherMode: weatherProfile ? 'forecast' : 'clear-sky-fallback',
            weatherCoverage: weatherProfile ? Number(weatherProfile.coverage) || 0 : 0,
            weatherRetrievedAt: weatherProfile && weatherProfile.weatherRetrievedAt || null,
            weatherResolutionMinutes: weatherProfile && weatherProfile.weatherResolutionMinutes || null,
            weatherSource: weatherProfile && weatherProfile.weatherSource || 'bird-clear-sky',
            weatherFallbackReason,
            precisionCandidateIds: selection.precisionCandidates.map(route => route.id),
            // Raw OSRM candidates are safe to reuse for a time-only change;
            // their geometry, steps and base duration do not depend on the
            // selected clock time.
            routeCandidates: analyzedRoutes.map(route => route.raw),
            roleAnalysis: {
                fastest: finalRoleMeta(fastestTier),
                glareFree: finalRoleMeta(glareTier),
                shade: finalRoleMeta(shadeTier)
            },
            routes: {
                fastest: fastestRoute,
                glareFree: glareFreeRoute,
                shade: shadeRoute,
                all: analyzedRoutes
            }
        };

        // OSRM/heuristic progress is emitted before the optional scene
        // requests.  Emit the refined roles as a second progress event so a
        // caller can update its UI (and, when safe, the active guidance route)
        // without waiting for another route request.  This callback is
        // guarded by the caller's AbortSignal/generation in app.js, just like
        // the initial event.
        if (options.signal && options.signal.aborted) throw createAbortError();
        if (typeof options.onProgress === 'function') {
            await options.onProgress(finalResult);
        }
        return finalResult;
    }

    /* Web Worker for background solar analysis (UI thread offloading) */
    let solarWorker = null;
    let workerCallId = 0;
    const workerCallbacks = new Map();
    let workerUnavailable = false;
    let workerGeneration = 0;
    let workerRestartCount = 0;
    const MAX_WORKER_RESTARTS = 1;
    const DEFAULT_WORKER_TIMEOUT_MS = 8000;
    const MAX_WORKER_TIMEOUT_MS = 30000;

    function calculateWorkerTimeoutMs(coordinates, scene, overrideMs = null) {
        if (Number.isFinite(Number(overrideMs)) && Number(overrideMs) > 0) return Number(overrideMs);
        const coordinateCount = Array.isArray(coordinates) ? coordinates.length : 0;
        const terrainCount = scene && Array.isArray(scene.terrainSamples) ? scene.terrainSamples.length : 0;
        const buildingCount = scene && Array.isArray(scene.buildings) ? scene.buildings.length : 0;
        // Structured cloning and ray tests grow with both route samples and
        // scene size. Short routes retain the old 8 s watchdog, while a
        // legitimate 100+ km mobile analysis gets enough time without allowing
        // a permanently silent Worker to stall indefinitely.
        const workloadAllowance = Math.min(22000,
            coordinateCount * 8 + terrainCount * 0.05 + buildingCount * 1.5);
        return Math.min(MAX_WORKER_TIMEOUT_MS, Math.max(DEFAULT_WORKER_TIMEOUT_MS,
            Math.ceil(DEFAULT_WORKER_TIMEOUT_MS + workloadAllowance)));
    }

    function createAbortError() {
        const error = new Error('Solar analysis request was aborted');
        error.name = 'AbortError';
        return error;
    }

    function settleWorkerCallback(id, outcome, value) {
        const callback = workerCallbacks.get(id);
        if (!callback) return;
        workerCallbacks.delete(id);
        if (callback.timeoutId) clearTimeout(callback.timeoutId);
        if (callback.abortHandler && callback.signal) {
            callback.signal.removeEventListener('abort', callback.abortHandler);
        }
        try {
            if (outcome === 'reject') callback.reject(value);
            else callback.resolve(value);
        } catch (error) {
            // A consumer callback must never break cleanup for other requests.
            console.warn('Solar Worker callback handling warning:', error);
        }
    }

    function fallbackPendingWorkerCalls(generation = null) {
        const pending = Array.from(workerCallbacks.entries());
        pending.forEach(([id, callback]) => {
            if (generation !== null && callback.generation !== generation) return;
            try {
                if (callback.signal && callback.signal.aborted) {
                    settleWorkerCallback(id, 'reject', createAbortError());
                } else {
                    settleWorkerCallback(id, 'resolve', callback.fallback());
                }
            } catch (error) {
                settleWorkerCallback(id, 'reject', error);
            }
        });
    }

    function markWorkerUnavailable(error, generation = null, allowRestart = true) {
        if (error) console.warn('Solar Worker unavailable; using synchronous analysis:', error);
        if (generation !== null && generation !== workerGeneration) return;
        const failedWorker = solarWorker;
        solarWorker = null;
        workerGeneration++;
        if (failedWorker && typeof failedWorker.terminate === 'function') {
            try { failedWorker.terminate(); } catch (terminateError) { /* best effort */ }
        }
        // Resolve all in-flight analyses immediately.  They must not remain
        // pending until the 8-second hung-worker safety timeout.
        fallbackPendingWorkerCalls(generation);
        if (allowRestart && workerRestartCount < MAX_WORKER_RESTARTS) {
            workerRestartCount++;
            workerUnavailable = false;
        } else {
            workerUnavailable = true;
        }
    }

    function initSolarWorker() {
        if (workerUnavailable) return false;
        if (solarWorker) return true;
        try {
            const worker = new Worker('js/solar-worker.js');
            const generation = ++workerGeneration;
            solarWorker = worker;
            worker.onmessage = function (e) {
                if (solarWorker !== worker || workerGeneration !== generation) return;
                const { id, result } = e.data;
                if (workerCallbacks.has(id)) settleWorkerCallback(id, 'resolve', result);
            };
            worker.onerror = error => markWorkerUnavailable(error, generation, true);
            worker.onmessageerror = error => markWorkerUnavailable(error, generation, true);
            return true;
        } catch (e) {
            workerUnavailable = true;
            fallbackPendingWorkerCalls();
            return false;
        }
    }

    /**
     * Async version of analyzeRouteSegments that runs in a Web Worker.
     * Falls back to synchronous main-thread computation if Worker is unavailable.
     */
    function analyzeRouteSegmentsAsync(coordinates, dateObj, durationSec, steps, scene = null, signal = null, workerOptions = {}) {
        // Build time lookup on main thread (lightweight) so Worker gets it ready
        const timeLookup = buildStepTimeLookup(coordinates, steps, durationSec);
        const weatherProfile = workerOptions && workerOptions.weatherProfile || null;

        const fallback = () => {
            if (signal && signal.aborted) throw createAbortError();
            const result = analyzeRouteSegments(coordinates, dateObj, durationSec, steps, scene, weatherProfile);
            result.coordinates = coordinates;
            return result;
        };

        if (signal && signal.aborted) return Promise.reject(createAbortError());

        if (initSolarWorker() && solarWorker) {
            const generation = workerGeneration;
            const timeoutMs = calculateWorkerTimeoutMs(coordinates, scene, workerOptions.timeoutMs);
            return new Promise((resolve, reject) => {
                const id = ++workerCallId;
                const callback = {
                    resolve,
                    reject,
                    fallback,
                    signal,
                    generation,
                    timeoutId: null,
                    abortHandler: null
                };
                workerCallbacks.set(id, callback);
                if (signal) {
                    callback.abortHandler = () => settleWorkerCallback(id, 'reject', createAbortError());
                    signal.addEventListener('abort', callback.abortHandler, { once: true });
                }
                callback.timeoutId = setTimeout(() => {
                    if (workerCallbacks.has(id)) {
                        try {
                            // A silent worker is unhealthy too. Terminate the
                            // generation and settle every pending callback;
                            // the bounded restart budget prevents repeated
                            // multi-second stalls during one app session.
                            markWorkerUnavailable(new Error('Solar Worker response timeout'), generation, true);
                        } catch (error) {
                            settleWorkerCallback(id, 'reject', error);
                        }
                    }
                }, timeoutMs);

                try {
                    solarWorker.postMessage({
                        id,
                        coordinates,
                        startTimestamp: dateObj.getTime(),
                        durationSec,
                        timeLookup: Array.from(timeLookup),
                        scene,
                        weatherProfile
                    });
                } catch (error) {
                    markWorkerUnavailable(error, generation, true);
                }
            }).then(result => {
                if (signal && signal.aborted) throw createAbortError();
                if (result && result.weatherFallbackRequired) {
                    // The worker detected incomplete forecast coverage. Re-run
                    // uniformly with Bird values; never mix tiers by segment.
                    const clearSky = analyzeRouteSegments(coordinates, dateObj, durationSec, steps, scene, null);
                    clearSky.coordinates = coordinates;
                    return clearSky;
                }
                // Worker returns segments without coordinates; add them back.
                if (result && !result.coordinates) result.coordinates = coordinates;
                return result;
            });
        }

        // Sync fallback
        return Promise.resolve().then(fallback);
    }

    return {
        calculateBearing: calculateBearing,
        calculateDistanceMeters: calculateDistanceMeters,
        distanceToRoute: distanceToRoute,
        pointToSegmentDistanceMeters: pointToSegmentDistanceMeters,
        snapHeadingToRoad: snapHeadingToRoad,
        snapPositionAndHeadingToRoad: snapPositionAndHeadingToRoad,
        calculateRemainingRouteDistance: calculateRemainingRouteDistance,
        calculateRemainingRouteDuration: calculateRemainingRouteDuration,
        calculateSegmentGlare: calculateSegmentGlare,
        calculateDirectSolarExposure: calculateDirectSolarExposure,
        estimateSegmentShade: estimateSegmentShade,
        segmentAtmosphereOptions: segmentAtmosphereOptions,
        calculateSolarUvIntensity: calculateSolarUvIntensity,
        buildStepTimeLookup: buildStepTimeLookup,
        createRouteIdentity: createRouteIdentity,
        sampleRouteGeometry: sampleRouteGeometry,
        buildPrecisionAnalysisGeometry: buildPrecisionAnalysisGeometry,
        mapPrecisionAnalysisToOriginalGeometry: mapPrecisionAnalysisToOriginalGeometry,
        geometryHausdorffDistanceMeters: geometryHausdorffDistanceMeters,
        geometryOverlapRatio: geometryOverlapRatio,
        areRoutesGeometricallySimilar: areRoutesGeometricallySimilar,
        selectPrecisionCandidates: selectPrecisionCandidates,
        selectRouteRoles: selectRouteRoles,
        buildHeuristicProgressResult: buildHeuristicProgressResult,
        calculateRouteTradeoff: calculateRouteTradeoff,
        routeSolarExposure: routeSolarExposure,
        routeSunlitTimeSeconds: routeSunlitTimeSeconds,
        compareShadeRoutes: compareShadeRoutes,
        routeShadeMetric: routeShadeMetric,
        applyExposureReductions: applyExposureReductions,
        routeContainsToll: routeContainsToll,
        getRouteEndpoint: getRouteEndpoint,
        assignRoadDestination: assignRoadDestination,
        areValidRouteCoordinates: areValidRouteCoordinates,
        analyzeRouteSegments: analyzeRouteSegments,
        analyzeRouteSegmentsAsync: analyzeRouteSegmentsAsync,
        calculateWorkerTimeoutMs: calculateWorkerTimeoutMs,
        fetchAndAnalyzeRoutes: fetchAndAnalyzeRoutes
    };
})();
