/**
 * Solar Analysis Web Worker — Background thread for 4D spatio-temporal UV/glare route computation.
 * Contains inlined SunCalc getPosition + shadow-router physics to avoid blocking the UI thread.
 */
'use strict';

// The scene module is shared with the main thread.  If a WebView blocks
// worker imports, the worker still completes with the documented heuristic
// fallback instead of failing route analysis.
try { importScripts('scene-shadow.js'); } catch (e) { /* optional scene data */ }

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

function getSunPosition(dateMs, lat, lng) {
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
    const apparentAltitude = altitudeDeg + 0.833;
    const horizonDiffuseBaseline = sin(0.833 * rad);
    if (apparentAltitude > 0) {
        const directFactor = sin(apparentAltitude * rad);
        return Math.min(1.0, directFactor + horizonDiffuseBaseline * (1.0 - directFactor));
    } else if (altitudeDeg >= -6.0) {
        const twilightSpan = 6.0 - 0.833;
        const twilightFraction = Math.max(0, (altitudeDeg + 6.0) / twilightSpan);
        return horizonDiffuseBaseline * Math.pow(twilightFraction, 2.0);
    }
    return 0;
}

function calculateSegmentGlare(segmentHeading, sunPos) {
    if (!sunPos || !isFinite(sunPos.altitude) || !isFinite(sunPos.azimuth)) return 0;
    if (!isFinite(segmentHeading)) return 0;
    if (sunPos.altitude <= -0.833) return 0;
    if (sunPos.altitude > 45) return 0.04;
    const sunElevationDeg = Math.max(0, sunPos.altitude + 0.833);
    let angleDiff = Math.abs(((segmentHeading - sunPos.azimuth) % 360 + 540) % 360 - 180);
    if (angleDiff <= 45 && sunElevationDeg < 25) {
        return Math.min(1.0, (1 - angleDiff / 45) * (1 - sunElevationDeg / 25));
    }
    return 0;
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
    const { id, coordinates, startTimestamp, durationSec, timeLookup: timeLookupArr, scene } = e.data;

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

    const segments = [];
    let totalGlareWeighted = 0, totalShadeWeighted = 0, totalUvWeighted = 0, totalPathMeters = 0;

    for (let i = 0; i < n - 1; i++) {
        const p1 = [coordinates[i][1], coordinates[i][0]];
        const p2 = [coordinates[i + 1][1], coordinates[i + 1][0]];
        const segDist = calculateDistanceMeters(p1[0], p1[1], p2[0], p2[1]);

        if (segDist < 0.5) continue;
        totalPathMeters += segDist;

        const segMidTime = (timeLookup[i] + timeLookup[i + 1]) / 2;
        const elapsedSec = Math.min(segMidTime, durationSec || 0);
        const passTimeMs = startTimestamp + elapsedSec * 1000;

        const segSunPos = getSunPosition(passTimeMs, p1[0], p1[1]);
        const sunIntensity = calculateSolarUvIntensity(segSunPos.altitude);
        const heading = calculateBearing(p1[0], p1[1], p2[0], p2[1]);
        const glareRisk = calculateSegmentGlare(heading, segSunPos);
        const sceneResult = scene && self.SceneShadow
            ? self.SceneShadow.getSegmentOcclusion(p1, p2, segSunPos, scene, i)
            : null;
        const shadeScore = sceneResult && Number.isFinite(sceneResult.shadeScore)
            ? sceneResult.shadeScore
            : estimateSegmentShade(p1, p2, segSunPos);
        const unshadedFraction = 1.0 - shadeScore * 0.85;
        const vehicleExposureFactor = 0.35 + 0.65 * glareRisk;
        const segmentUvScore = isFinite(sunIntensity) ? sunIntensity * unshadedFraction * vehicleExposureFactor : 0;

        segments.push({
            p1,
            p2,
            passTime: new Date(passTimeMs),
            heading,
            glareRisk,
            shadeScore,
            shadeSource: sceneResult && sceneResult.source ? sceneResult.source : 'heuristic',
            sceneOcclusion: sceneResult || null,
            uvScore: segmentUvScore
        });

        totalGlareWeighted += glareRisk * segDist;
        totalShadeWeighted += shadeScore * segDist;
        totalUvWeighted += segmentUvScore * segDist;
    }

    const denom = totalPathMeters || 1;
    const avgGlare = totalGlareWeighted / denom;
    const avgShade = totalShadeWeighted / denom;
    const totalUv = totalUvWeighted / denom;

    self.postMessage({
        id,
        result: {
            segments,
            avgGlareRisk: isFinite(avgGlare) ? avgGlare : 0,
            avgShadeCoverage: isFinite(avgShade) ? avgShade : 0.5,
            totalUvExposureUnits: isFinite(totalUv) ? totalUv : 0,
            sceneCoverage: scene && scene.coverage ? scene.coverage : { buildings: false, terrain: false, tunnels: false },
            sceneSource: scene && scene.source ? scene.source : 'heuristic fallback'
        }
    });
};
