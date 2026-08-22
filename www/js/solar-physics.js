/*
 * SolarPhysics - reference-based solar position, clear-sky irradiance, and
 * standardized disability-glare calculations for SolarLess Navi.
 *
 * References:
 *   R1 NREL SPA: Reda & Andreas, NREL/TP-560-34302,
 *      https://doi.org/10.2172/15003974
 *   R2 Bird clear-sky model: SERI/TR-642-761,
 *      https://doi.org/10.2172/6510849
 *   R5 CIE 146:2002 disability glare equations,
 *      https://www.cie.co.at/publications/cie-collection-glare-2002
 *
 * Irradiance outputs are a declared standard-atmosphere clear-sky
 * estimate, not measured weather or UV dose. The legacy 0..1 value is retained
 * only for route/UI compatibility and is derived from direct horizontal
 * irradiance, not labelled as UV.
 */
(function attachSolarPhysics(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(globalThis);
    else root.SolarPhysics = factory(root);
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis), function createSolarPhysics(root) {
    'use strict';

    const DEG = Math.PI / 180;
    const SOLAR_CONSTANT_W_M2 = 1364;
    const STANDARD_LUMINOUS_EFFICACY_LM_W = 93;
    const MODEL_VERSION = 'solar-physics-v2';
    const REFERENCES = Object.freeze({
        solarPosition: 'NREL_SPA_R1',
        clearSky: 'NREL_BIRD_R2',
        glare: 'CIE_146_2002_R5'
    });
    const MODEL_METADATA = Object.freeze({
        version: MODEL_VERSION,
        solarPosition: REFERENCES.solarPosition,
        irradiance: REFERENCES.clearSky,
        glare: REFERENCES.glare,
        atmosphereSource: 'bird-standard-atmosphere',
        estimatesUvDose: false,
        estimatesCabinTemperature: false
    });

    const STANDARD_CLEAR_SKY_ATMOSPHERE = Object.freeze({
        ozoneCm: 0.30,
        precipitableWaterCm: 1.50,
        aod380: 0.10,
        aod500: 0.08,
        asymmetry: 0.85,
        albedo: 0.20,
        source: 'bird-standard-atmosphere'
    });

    function finite(value) { return Number.isFinite(Number(value)); }
    function clamp(value, low, high) { return Math.max(low, Math.min(high, Number(value))); }

    function pressureFromElevation(elevationMeters = 0) {
        const elevation = clamp(finite(elevationMeters) ? elevationMeters : 0, -500, 9000);
        return 100 * Math.pow((44331.514 - elevation) / 11880.516, 1 / 0.1902632);
    }

    function dayOfYear(date) {
        const start = Date.UTC(date.getUTCFullYear(), 0, 0);
        return Math.floor((date.getTime() - start) / 86400000);
    }

    function extraterrestrialDni(date) {
        const day = dayOfYear(date);
        return SOLAR_CONSTANT_W_M2 * (1 + 0.033 * Math.cos(2 * Math.PI * day / 365));
    }

    function approximateDeltaTSeconds(date) {
        // Espenak/Meeus polynomial for 2005-2050. Delta-T affects SPA by a
        // very small angle but is kept explicit instead of a stale fixed 67 s.
        const year = date.getUTCFullYear() + (date.getUTCMonth() + 0.5) / 12;
        if (year >= 2005 && year <= 2050) {
            const t = year - 2000;
            return 62.92 + 0.32217 * t + 0.005589 * t * t;
        }
        return 69;
    }

    function spaPosition(dateInput, latitude, longitude, options = {}) {
        const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
        if (!Number.isFinite(date.getTime()) || !finite(latitude) || !finite(longitude)) {
            return { azimuth: 0, altitude: -90, geometricAltitude: -90, zenith: 180, model: REFERENCES.solarPosition };
        }
        const core = root.NrelSpaCore;
        if (!core || typeof core.SpaData !== 'function' || typeof core.spa_calculate !== 'function') {
            if (root.SunCalc && typeof root.SunCalc.getPosition === 'function' && !root.SunCalc.__solarPhysicsDelegate) {
                const fallback = root.SunCalc.getPosition(date, Number(latitude), Number(longitude));
                return { ...fallback, geometricAltitude: fallback.altitude, zenith: 90 - fallback.altitude, model: 'SUNCALC_FALLBACK' };
            }
            return { azimuth: 0, altitude: -90, geometricAltitude: -90, zenith: 180, model: 'UNAVAILABLE' };
        }
        const data = new core.SpaData();
        data.year = date.getUTCFullYear();
        data.month = date.getUTCMonth() + 1;
        data.day = date.getUTCDate();
        data.hour = date.getUTCHours();
        data.minute = date.getUTCMinutes();
        data.second = date.getUTCSeconds() + date.getUTCMilliseconds() / 1000;
        data.delta_ut1 = finite(options.deltaUt1Seconds) ? Number(options.deltaUt1Seconds) : 0;
        data.delta_t = finite(options.deltaTSeconds) ? Number(options.deltaTSeconds) : approximateDeltaTSeconds(date);
        data.timezone = 0;
        data.longitude = Number(longitude);
        data.latitude = Number(latitude);
        data.elevation = finite(options.elevationMeters) ? Number(options.elevationMeters) : 0;
        data.pressure = (finite(options.pressurePa) ? Number(options.pressurePa) : pressureFromElevation(data.elevation)) / 100;
        data.temperature = finite(options.temperatureC) ? Number(options.temperatureC) : 15;
        data.slope = 0;
        data.azm_rotation = 0;
        data.atmos_refract = 0.5667;
        data.function = core.SPA_ZA;
        const code = core.spa_calculate(data);
        if (code !== 0) return { azimuth: 0, altitude: -90, geometricAltitude: -90, zenith: 180, model: 'SPA_ERROR', errorCode: code };
        return {
            azimuth: data.azimuth,
            altitude: data.e,
            geometricAltitude: data.e0,
            zenith: data.zenith,
            earthRadiusAu: data.r,
            model: REFERENCES.solarPosition
        };
    }

    function relativeAirmassKasten1966(zenithDeg) {
        const zenith = Number(zenithDeg);
        if (!Number.isFinite(zenith) || zenith >= 90 || zenith < 0) return Infinity;
        return 1 / (Math.cos(zenith * DEG) + 0.15 * Math.pow(93.885 - zenith, -1.253));
    }

    function normalizeAtmosphere(options = {}) {
        const base = STANDARD_CLEAR_SKY_ATMOSPHERE;
        const elevationMeters = finite(options.elevationMeters) ? Number(options.elevationMeters) : 0;
        return {
            ozoneCm: finite(options.ozoneCm) ? clamp(options.ozoneCm, 0.1, 0.8) : base.ozoneCm,
            precipitableWaterCm: finite(options.precipitableWaterCm) ? clamp(options.precipitableWaterCm, 0.1, 10) : base.precipitableWaterCm,
            aod380: finite(options.aod380) ? clamp(options.aod380, 0.001, 2) : base.aod380,
            aod500: finite(options.aod500) ? clamp(options.aod500, 0.001, 2) : base.aod500,
            asymmetry: finite(options.asymmetry) ? clamp(options.asymmetry, 0, 1) : base.asymmetry,
            albedo: finite(options.albedo) ? clamp(options.albedo, 0, 0.95) : base.albedo,
            pressurePa: finite(options.pressurePa) ? Number(options.pressurePa) : pressureFromElevation(elevationMeters),
            source: options.source || base.source
        };
    }

    function birdClearSky(position, dateInput, atmosphereOptions = {}) {
        const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
        const zenith = Number(position && position.zenith);
        const directZero = {
            dni: 0, dhi: 0, ghi: 0, directHorizontal: 0,
            relativeAirmass: Infinity, model: REFERENCES.clearSky,
            atmosphereSource: atmosphereOptions.source || STANDARD_CLEAR_SKY_ATMOSPHERE.source
        };
        if (!Number.isFinite(zenith) || zenith >= 90 || !Number.isFinite(date.getTime())) return directZero;
        const atmosphere = normalizeAtmosphere(atmosphereOptions);
        const airmass = relativeAirmassKasten1966(zenith);
        if (!Number.isFinite(airmass)) return directZero;
        const amPress = airmass * atmosphere.pressurePa / 101325;
        const etr = finite(atmosphereOptions.dniExtraWm2)
            ? Number(atmosphereOptions.dniExtraWm2)
            : extraterrestrialDni(date);
        const cosZenith = Math.max(0, Math.cos(zenith * DEG));
        const tRayleigh = Math.exp(-0.0903 * Math.pow(amPress, 0.84) * (1 + amPress - Math.pow(amPress, 1.01)));
        const amOzone = atmosphere.ozoneCm * airmass;
        const tOzone = 1 - 0.1611 * amOzone * Math.pow(1 + 139.48 * amOzone, -0.3034) -
            0.002715 * amOzone / (1 + 0.044 * amOzone + 0.0003 * amOzone * amOzone);
        const tGases = Math.exp(-0.0127 * Math.pow(amPress, 0.26));
        const amWater = airmass * atmosphere.precipitableWaterCm;
        const tWater = 1 - 2.4959 * amWater /
            (Math.pow(1 + 79.034 * amWater, 0.6828) + 6.385 * amWater);
        const aerosolBroadband = 0.27583 * atmosphere.aod380 + 0.35 * atmosphere.aod500;
        const tAerosol = Math.exp(-Math.pow(aerosolBroadband, 0.873) *
            (1 + aerosolBroadband - Math.pow(aerosolBroadband, 0.7088)) * Math.pow(airmass, 0.9108));
        const taa = 1 - 0.1 * (1 - airmass + Math.pow(airmass, 1.06)) * (1 - tAerosol);
        const rs = 0.0685 + (1 - atmosphere.asymmetry) * (1 - tAerosol / taa);
        const dni = Math.max(0, 0.9662 * etr * tAerosol * tWater * tGases * tOzone * tRayleigh);
        const directHorizontal = dni * cosZenith;
        const scattered = etr * cosZenith * 0.79 * tOzone * tGases * tWater * taa *
            (0.5 * (1 - tRayleigh) + atmosphere.asymmetry * (1 - tAerosol / taa)) /
            (1 - airmass + Math.pow(airmass, 1.02));
        const ghi = Math.max(0, (directHorizontal + scattered) / (1 - atmosphere.albedo * rs));
        const dhi = Math.max(0, ghi - directHorizontal);
        return {
            dni, dhi, ghi, directHorizontal,
            relativeAirmass: airmass,
            model: REFERENCES.clearSky,
            atmosphereSource: atmosphere.source
        };
    }

    function angularDifferenceDegrees(a, b) {
        return Math.abs(((Number(a) - Number(b) + 540) % 360) - 180);
    }

    function sunViewAngleDegrees(vehicleHeadingDeg, sunPosition) {
        if (!finite(vehicleHeadingDeg) || !sunPosition || !finite(sunPosition.azimuth) || !finite(sunPosition.altitude)) return 180;
        const horizontal = angularDifferenceDegrees(vehicleHeadingDeg, sunPosition.azimuth) * DEG;
        const elevation = Number(sunPosition.altitude) * DEG;
        const cosTheta = Math.cos(elevation) * Math.cos(horizontal);
        return Math.acos(clamp(cosTheta, -1, 1)) / DEG;
    }

    function disabilityGlare(vehicleHeadingDeg, sunPosition, irradiance, occlusionRatio = 0, options = {}) {
        const theta = sunViewAngleDegrees(vehicleHeadingDeg, sunPosition);
        const occlusion = finite(occlusionRatio) ? clamp(occlusionRatio, 0, 1) : 0;
        const dni = irradiance && finite(irradiance.dni) ? Number(irradiance.dni) : 0;
        if (dni <= 0 || occlusion >= 1 || theta >= 100 || Number(sunPosition.altitude) <= 0) {
            return { thetaDeg: theta, eyeIlluminanceLux: 0, veilingLuminanceCdM2: 0, normalizedPotential: 0, model: REFERENCES.glare };
        }
        const efficacy = finite(options.luminousEfficacyLmW)
            ? clamp(options.luminousEfficacyLmW, 50, 130)
            : STANDARD_LUMINOUS_EFFICACY_LM_W;
        const eyeIlluminanceLux = dni * efficacy * Math.max(0, Math.cos(theta * DEG)) * (1 - occlusion);
        // Classical CIE/Stiles-Holladay standard-observer form. The 1 degree
        // floor stays within the published domain and avoids a singularity.
        const thetaForModel = Math.max(1, theta);
        const veilingLuminanceCdM2 = 10 * eyeIlluminanceLux / (thetaForModel * thetaForModel);
        // UI compatibility only: monotonic display mapping, not a probability.
        const normalizedPotential = 1 - Math.exp(-veilingLuminanceCdM2 / 1000);
        return { thetaDeg: theta, eyeIlluminanceLux, veilingLuminanceCdM2, normalizedPotential, model: REFERENCES.glare };
    }

    function normalizedDirectExposure(irradiance, occlusionRatio = 0) {
        const direct = irradiance && finite(irradiance.directHorizontal) ? Number(irradiance.directHorizontal) : 0;
        const occlusion = finite(occlusionRatio) ? clamp(occlusionRatio, 0, 1) : 0;
        return clamp(direct * (1 - occlusion) / 1000, 0, 1.5);
    }

    return {
        MODEL_VERSION,
        MODEL_METADATA,
        REFERENCES,
        STANDARD_CLEAR_SKY_ATMOSPHERE,
        pressureFromElevation,
        approximateDeltaTSeconds,
        spaPosition,
        relativeAirmassKasten1966,
        birdClearSky,
        sunViewAngleDegrees,
        disabilityGlare,
        normalizedDirectExposure,
        extraterrestrialDni
    };
});
