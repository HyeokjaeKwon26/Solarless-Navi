/**
 * Solar Analysis Web Worker — background thread for 4D direct-solar/glare route computation.
 * Contains inlined SunCalc getPosition + shadow-router physics to avoid blocking the UI thread.
 */
'use strict';

// The scene module is shared with the main thread.  If a WebView blocks
// worker imports, the worker still completes with the documented heuristic
// fallback instead of failing route analysis.
try { importScripts('nrel-spa.js', 'solar-physics.js', 'weather-radiation.js', 'scene-shadow.js'); } catch (e) { /* optional physics/scene data */ }

/* ===== Inlined SunCalc getPosition (NOAA/AA+ Astronomical Algorithms) ===== */
const PI = Math.PI, sin = Math.sin, cos = Math.cos, tan = Math.tan,
    asin = Math.asin, atan = Math.atan2, acos = Math.acos, rad = PI / 180;
const dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;

function toJulian(date) { return date / dayMs - 0.5 + J1970; }
function toDays(date) { return toJulian(date) - J2000; }
const e = rad * 23.4397;
function rightAscension(l, b) { return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l)); }
function declination(l, b) { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }
function azimuthFn(H, phi, dec) { return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)); }
function altitudeFn(H, phi, dec) { return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)); }
function siderealTime(d, lw) { return rad * (280.1600 + 360.9856235 * d) - lw; }
function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(M) {
    var C = rad * (1.9148 * sin(M) + 0.0200 * sin(2 * M) + 0.0003 * sin(3 * M)),
        P = rad * 102.9372;
    return M + C + P + PI;
}
function sunCoords(d) {
    var M = solarMeanAnomaly(d), L = eclipticLongitude(M);
    return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function getSunPosition(dateMs, lat, lng, options = {}) {
    if (self.SolarPhysics && typeof self.SolarPhysics.spaPosition === 'function') {
        return self.SolarPhysics.spaPosition(new Date(dateMs), lat, lng, options);
    }
    var lw = rad * -lng, phi = rad * lat, d = toDays(dateMs),
        c = sunCoords(d), H = siderealTime(d, lw) - c.ra;
    var azRad = azimuthFn(H, phi, c.dec);
    var altRad = altitudeFn(H, phi, c.dec);
    return {
        azimuth: (azRad * 180 / PI + 180) % 360,
        altitude: altRad * 180 / PI
    };
}

/* ===== Shadow Router Physics (inlined from shadow-router.js) ===== */

function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = sin(dLat / 2) * sin(dLat / 2) +
        cos(lat1 * rad) * cos(lat2 * rad) * sin(dLon / 2) * sin(dLon / 2);
    return R * 2 * atan(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const dLon = (lon2 - lon1) * rad;
    const y = sin(dLon) * cos(lat2 * rad);
    const x = cos(lat1 * rad) * sin(lat2 * rad) - sin(lat1 * rad) * cos(lat2 * rad) * cos(dLon);
    return (atan(y, x) * 180 / PI + 360) % 360;
}

function calculateSolarUvIntensity(altitudeDeg) {
    if (!Number.isFinite(altitudeDeg)) return 0;
    return altitudeDeg > 0 ? Math.max(0, Math.min(1, sin(altitudeDeg * rad))) : 0;
}

function calculateSegmentGlare(segmentHeading, sunPos, irradiance = null, occlusionRatio = 0) {
    if (!sunPos || !isFinite(sunPos.altitude) || !isFinite(sunPos.azimuth)) return 0;
    if (!isFinite(segmentHeading)) return 0;
    if (self.SolarPhysics && typeof self.SolarPhysics.disabilityGlare === 'function') {
        return self.SolarPhysics.disabilityGlare(segmentHeading, sunPos,
            irradiance || { dni: 1000 * calculateSolarUvIntensity(sunPos.altitude) }, occlusionRatio).normalizedPotential;
    }
    if (sunPos.altitude <= 0) return 0;
    const angleDiff = Math.abs(((segmentHeading - sunPos.azimuth) % 360 + 540) % 360 - 180);
    return angleDiff < 90 ? Math.max(0, Math.cos(angleDiff * rad) * Math.cos(sunPos.altitude * rad)) : 0;
}

function calculateDirectSolarExposure(sunIntensity, occlusionRatio = null) {
    const intensity = Number(sunIntensity);
    if (!Number.isFinite(intensity) || intensity <= 0) return 0;
    const occlusion = Number.isFinite(Number(occlusionRatio))
        ? Math.max(0, Math.min(1, Number(occlusionRatio)))
        : 0;
    return Math.max(0, Math.min(1, intensity)) * (1 - occlusion);
}

function segmentAtmosphereOptions(p1, p2, scene) {
    const options = { ...(scene && scene.atmosphere || {}) };
    if (!scene || !scene.origin || !self.SceneShadow ||
        typeof self.SceneShadow.projectPoint !== 'function' ||
        typeof self.SceneShadow.findNearestTerrainSample !== 'function') return options;
    const midpoint = self.SceneShadow.projectPoint(
        (Number(p1[0]) + Number(p2[0])) / 2,
        (Number(p1[1]) + Number(p2[1])) / 2,
        scene.origin
    );
    const nearest = self.SceneShadow.findNearestTerrainSample(
        midpoint, scene.terrainSamples, 500, scene.terrainGrid
    );
    const elevation = nearest && nearest.sample && Number(nearest.sample.elevation);
    if (Number.isFinite(elevation)) {
        options.elevationMeters = elevation;
        if (!options.source) options.source = 'bird-standard-atmosphere+scene-dem-elevation';
    }
    return options;
}

function estimateSegmentShade(p1, p2, sunPos) {
    if (!sunPos || !isFinite(sunPos.altitude) || !isFinite(sunPos.azimuth)) return 0.5;
    if (sunPos.altitude <= -6.0) return 1.0;
    const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
    let diff = Math.abs(((heading - sunPos.azimuth) % 360 + 540) % 360 - 180);
    const perpFactor = sin(diff * rad);
    if (sunPos.altitude <= -0.833) return 0.85;
    if (sunPos.altitude < 25) return 0.35 + Math.abs(perpFactor) * 0.50;
    if (sunPos.altitude < 55) return 0.22 + Math.abs(perpFactor) * 0.42;
    return 0.18 + Math.abs(perpFactor) * 0.38;
}

/* ===== Worker Message Handler ===== */

self.onmessage = function (e) {
    const { id, coordinates, startTimestamp, durationSec, timeLookup: timeLookupArr, scene, weatherProfile } = e.data;

    // Keep scene capability checks outside the segment loop.  The previous
    // implementation declared `useScene` inside the loop and then referenced
    // it while building the final result, which caused a ReferenceError after
    // all segments had already been calculated.  Scene data alone is not
    // enough: the worker must have imported the occlusion API as well.
    const sceneApiAvailable = self.SceneShadow &&
        typeof self.SceneShadow.getSegmentOcclusion === 'function';
    const partialScene = !!scene && scene.precisionReady === false && scene.partial === true &&
        Number(scene.coverage && scene.coverage.coveredSegments || 0) > 0;
    const useScene = !!scene && !!sceneApiAvailable && (scene.precisionReady !== false || partialScene);
    const analysisMode = !useScene ? 'heuristic' : (partialScene ? 'hybrid-scene' : 'scene');

    const n = coordinates.length;
    // Accept pre-computed timeLookup or build uniform fallback
    let timeLookup;
    if (timeLookupArr && timeLookupArr.length === n) {
        timeLookup = timeLookupArr;
    } else {
        // Uniform speed fallback
        timeLookup = new Float64Array(n);
        let totalDist = 0;
        const dists = [];
        for (let i = 0; i < n - 1; i++) {
            const d = calculateDistanceMeters(coordinates[i][1], coordinates[i][0], coordinates[i + 1][1], coordinates[i + 1][0]);
            dists.push(d);
            totalDist += d;
        }
        let cumDist = 0;
        for (let i = 0; i < n - 1; i++) {
            timeLookup[i] = totalDist > 0 ? (cumDist / totalDist) * durationSec : 0;
            cumDist += dists[i];
        }
        timeLookup[n - 1] = durationSec;
    }

    // Do not mix metres and seconds in a single weighted mean. Zero-duration
    // geometry fragments have zero time weight whenever route timing exists;
    // distance is the fallback only when the whole route has no timing data.
    const hasRouteTiming = Number(timeLookup[n - 1]) > Number(timeLookup[0]);

    const segments = [];
    let totalGlareWeighted = 0, totalGlareWeight = 0, totalShadeWeighted = 0, totalSolarExposureWeighted = 0, totalPathMeters = 0;
    let totalDirectSolarEnergyWhM2 = 0, clearSkyDirectEnergyWhM2 = 0, diffuseSkyEnergyWhM2 = 0, totalTimeSeconds = 0;
    let sunlitTimeSeconds = 0, sunlitDistanceMeters = 0, confirmedShadeTimeSeconds = 0, confirmedSceneTimeSeconds = 0;
    let confirmedShadeDistance = 0, confirmedSceneDistance = 0;
    let uncertainSceneDistance = 0, uncertainSceneTimeSeconds = 0;
    let estimatedShadeWeighted = 0, estimatedDistance = 0;
    let forecastSegmentCount = 0;

    for (let i = 0; i < n - 1; i++) {
        const p1 = [coordinates[i][1], coordinates[i][0]];
        const p2 = [coordinates[i + 1][1], coordinates[i + 1][0]];
        const segDist = calculateDistanceMeters(p1[0], p1[1], p2[0], p2[1]);

        if (segDist < 0.5) continue;
        totalPathMeters += segDist;

        const segMidTime = (timeLookup[i] + timeLookup[i + 1]) / 2;
        const elapsedSec = Math.min(segMidTime, durationSec || 0);
        const passTimeMs = startTimestamp + elapsedSec * 1000;

        const atmosphereOptions = segmentAtmosphereOptions(p1, p2, scene);
        const segSunPos = getSunPosition(passTimeMs, p1[0], p1[1], atmosphereOptions);
        const clearSkyIrradiance = self.SolarPhysics && typeof self.SolarPhysics.birdClearSky === 'function'
            ? self.SolarPhysics.birdClearSky(segSunPos, new Date(passTimeMs), atmosphereOptions)
            : { dni: 1000 * calculateSolarUvIntensity(segSunPos.altitude), dhi: 0, ghi: 1000 * calculateSolarUvIntensity(segSunPos.altitude), directHorizontal: 1000 * calculateSolarUvIntensity(segSunPos.altitude), model: 'GEOMETRIC_FALLBACK', atmosphereSource: 'none' };
        const weather = weatherProfile && self.WeatherRadiation && typeof self.WeatherRadiation.interpolateAt === 'function'
            ? self.WeatherRadiation.interpolateAt(weatherProfile, p1[0], p1[1], passTimeMs) : null;
        const altitudeRad = Math.max(0, Number(segSunPos.altitude) || 0) * Math.PI / 180;
        const irradiance = weather ? {
            dni: Math.max(0, Number(weather.dni) || 0),
            directHorizontal: Number.isFinite(Number(weather.directRadiation))
                ? Math.max(0, Number(weather.directRadiation))
                : Math.max(0, Number(weather.dni) || 0) * Math.sin(altitudeRad),
            dhi: Math.max(0, Number(weather.diffuseRadiation) || 0),
            ghi: Number.isFinite(Number(weather.shortwaveRadiation))
                ? Math.max(0, Number(weather.shortwaveRadiation))
                : Math.max(0, Number(weather.directRadiation) || 0) + Math.max(0, Number(weather.diffuseRadiation) || 0),
            model: 'OPEN_METEO_FORECAST',
            atmosphereSource: clearSkyIrradiance.atmosphereSource,
            weather
        } : clearSkyIrradiance;
        if (weather) forecastSegmentCount++;
        const sunIntensity = self.SolarPhysics && typeof self.SolarPhysics.normalizedDirectExposure === 'function'
            ? self.SolarPhysics.normalizedDirectExposure(irradiance, 0)
            : calculateSolarUvIntensity(segSunPos.altitude);
        const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
        const sceneResult = useScene && self.SceneShadow
            ? self.SceneShadow.getSegmentOcclusion(p1, p2, segSunPos, scene, i)
            : null;
        const estimatedShadePotential = estimateSegmentShade(p1, p2, segSunPos);
        const shadeState = sceneResult && sceneResult.shadeState
            ? sceneResult.shadeState
            : (sunIntensity <= 0 ? 'night' : 'estimated-shade');
        const confirmedOcclusion = sceneResult && Number.isFinite(sceneResult.occlusionRatio)
            ? Math.max(0, Math.min(1, Number(sceneResult.occlusionRatio)))
            : null;
        const glareRisk = calculateSegmentGlare(heading, segSunPos, irradiance, confirmedOcclusion);
        const directSolarExposure = self.SolarPhysics && typeof self.SolarPhysics.normalizedDirectExposure === 'function'
            ? self.SolarPhysics.normalizedDirectExposure(irradiance, confirmedOcclusion)
            : calculateDirectSolarExposure(sunIntensity, confirmedOcclusion);
        const shadeScore = shadeState === 'uncertain'
            ? 0
            : (confirmedOcclusion === null ? estimatedShadePotential : confirmedOcclusion);
        const segmentDurationSec = Math.max(0, Number(timeLookup[i + 1]) - Number(timeLookup[i]));
        const directHorizontalWm2 = Math.max(0, Number(irradiance.directHorizontal) || 0);
        const directEnergyWhM2 = directHorizontalWm2 * (1 - (confirmedOcclusion === null ? 0 : confirmedOcclusion)) * segmentDurationSec / 3600;
        const clearDirectEnergyWhM2 = Math.max(0, Number(clearSkyIrradiance.directHorizontal) || 0) * segmentDurationSec / 3600;
        const diffuseEnergyWhM2 = Math.max(0, Number(irradiance.dhi) || 0) * segmentDurationSec / 3600;

        segments.push({
            p1,
            p2,
            passTime: new Date(passTimeMs),
            heading,
            glareRisk,
            shadeScore,
            shadeState,
            confirmedShade: shadeState === 'confirmed-shade',
            estimatedShadePotential,
            occlusionRatio: confirmedOcclusion,
            sunIntensity,
            clearSkyIrradiance,
            irradiance,
            weather,
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
        const directSunThreshold = self.WeatherRadiation
            ? self.WeatherRadiation.DIRECT_SUN_DNI_THRESHOLD_WM2 : 120;
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

    // A partially covered forecast must not be mixed with clear-sky values.
    // Ask the main thread to retry this route uniformly with Bird data.
    if (weatherProfile && segments.length && forecastSegmentCount !== segments.length) {
        self.postMessage({ id, result: { weatherFallbackRequired: true } });
        return;
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

    self.postMessage({
        id,
        result: {
            segments,
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
            totalUvExposureUnits: isFinite(totalSolarExposure) ? totalSolarExposure : 0,
            confirmedShadeRatio: isFinite(confirmedShadeRatio) ? confirmedShadeRatio : 0,
            confirmedShadeTimeRatio: isFinite(confirmedShadeTimeRatio) ? confirmedShadeTimeRatio : 0,
            confirmedShadeWithinSceneTimeRatio: isFinite(confirmedShadeWithinSceneTimeRatio) ? confirmedShadeWithinSceneTimeRatio : 0,
            confirmedSceneTimeRatio: totalTimeSeconds > 0 ? confirmedSceneTimeSeconds / totalTimeSeconds : 0,
            uncertainOcclusionDistanceRatio: totalPathMeters > 0 ? uncertainSceneDistance / totalPathMeters : 0,
            uncertainOcclusionTimeRatio: totalTimeSeconds > 0 ? uncertainSceneTimeSeconds / totalTimeSeconds : 0,
            estimatedShadeRatio: isFinite(estimatedShadeRatio) ? estimatedShadeRatio : 0,
            confirmedSceneDistanceMeters: confirmedSceneDistance,
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
            solarModelVersion: self.SolarPhysics ? self.SolarPhysics.MODEL_VERSION : 'legacy-fallback',
            solarReferences: self.SolarPhysics ? self.SolarPhysics.REFERENCES : null,
            atmosphereSource: segments[0] && segments[0].clearSkyIrradiance ? segments[0].clearSkyIrradiance.atmosphereSource : 'none'
        }
    });
};
