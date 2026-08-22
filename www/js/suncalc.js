/**
 * SunCalc - Astronomical Sun position & Solar Sunrise/Sunset Times Calculator
 * Calculates real-time sun position (azimuth & elevation) and exact astronomical sunrise, solar noon, and sunset times
 * The public API delegates position calculations to NREL SPA when the bundled
 * SolarPhysics module is available, with the legacy algorithm as a fallback.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.SunCalc = factory();
    }
}(this, function () {
    'use strict';

    var SunCalc = {};

    var PI = Math.PI,
        sin = Math.sin,
        cos = Math.cos,
        tan = Math.tan,
        asin = Math.asin,
        atan = Math.atan2,
        acos = Math.acos,
        rad = PI / 180;

    var dayMs = 1000 * 60 * 60 * 24,
        J1970 = 2440588,
        J2000 = 2451545,
        J0 = 0.0009;

    function toJulian(date) { return date.valueOf() / dayMs - 0.5 + J1970; }
    function toDays(date) { return toJulian(date) - J2000; }
    function julianToDate(j) { return new Date((j + 0.5 - J1970) * dayMs); }

    var e = rad * 23.4397; // Obliquity of the ecliptic

    function rightAscension(l, b) { return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l)); }
    function declination(l, b) { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }

    function azimuth(H, phi, dec) { return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)); }
    function altitude(H, phi, dec) { return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)); }

    function siderealTime(d, lw) { return rad * (280.1600 + 360.9856235 * d) - lw; }
    function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }

    function eclipticLongitude(M) {
        var C = rad * (1.9148 * sin(M) + 0.0200 * sin(2 * M) + 0.0003 * sin(3 * M)),
            P = rad * 102.9372;
        return M + C + P + PI;
    }

    function sunCoords(d) {
        var M = solarMeanAnomaly(d),
            L = eclipticLongitude(M);

        return {
            dec: declination(L, 0),
            ra: rightAscension(L, 0)
        };
    }

    function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * PI)); }
    function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * PI) + n; }
    function solarTransitJ(ds, M, L) { return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L); }
    function hourAngle(h, phi, dec) { return acos((sin(h) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec))); }

    SunCalc.getPosition = function (date, lat, lng, options) {
        var physicsRoot = typeof globalThis !== 'undefined' ? globalThis : null;
        if (physicsRoot && physicsRoot.SolarPhysics && typeof physicsRoot.SolarPhysics.spaPosition === 'function') {
            var spa = physicsRoot.SolarPhysics.spaPosition(date, lat, lng, options || {});
            return {
                azimuth: spa.azimuth,
                altitude: spa.altitude,
                azimuthRad: spa.azimuth * rad,
                altitudeRad: spa.altitude * rad,
                geometricAltitude: spa.geometricAltitude,
                zenith: spa.zenith,
                model: spa.model
            };
        }
        var lw = rad * -lng,
            phi = rad * lat,
            d = toDays(date),
            c = sunCoords(d),
            H = siderealTime(d, lw) - c.ra;

        var azRad = azimuth(H, phi, c.dec);
        var altRad = altitude(H, phi, c.dec);

        // Convert azimuth from South-based (0=South) to North-based standard (0=North, 90=East)
        var azDeg = (azRad * 180 / PI + 180) % 360;
        var altDeg = altRad * 180 / PI;

        return {
            azimuth: azDeg,       // 0° = North, 90° = East, 180° = South, 270° = West
            altitude: altDeg,     // -90° to 90°
            azimuthRad: azRad,
            altitudeRad: altRad
        };
    };
    SunCalc.__solarPhysicsDelegate = true;

    /* Exact Astronomical Sunrise, Solar Noon, and Sunset Times Calculation (Day Base 12:00 Normalized) */
    SunCalc.getTimes = function (date, lat, lng) {
        // Normalize date to local noon (12:00:00) of the target day so it represents the day's full cycle
        var normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);

        // Stabilize coordinate jitter (0.01 deg ~= 1.1km) to prevent 1-min indoor fluctuation
        var stableLat = Math.round(lat * 100) / 100;
        var stableLng = Math.round(lng * 100) / 100;

        var lw = rad * -stableLng,
            phi = rad * stableLat,
            d = toDays(normalizedDate),
            n = julianCycle(d, lw),
            ds = approxTransit(0, lw, n),
            M = solarMeanAnomaly(ds),
            L = eclipticLongitude(M),
            dec = declination(L, 0),
            Jnoon = solarTransitJ(ds, M, L);

        // Standard sun atmospheric refraction altitude angle at horizon (-0.833 degrees)
        var h0 = -0.833 * rad;
        var cosH0 = (sin(h0) - sin(phi) * sin(dec)) / (cos(phi) * cos(dec));

        if (cosH0 > 1 || cosH0 < -1) {
            // Extreme Polar day or Polar night fallback
            return {
                sunrise: new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), normalizedDate.getDate(), 6, 0),
                solarNoon: julianToDate(Jnoon),
                sunset: new Date(normalizedDate.getFullYear(), normalizedDate.getMonth(), normalizedDate.getDate(), 19, 30)
            };
        }

        var w0 = hourAngle(h0, phi, dec);
        var a = approxTransit(w0, lw, n);
        var Jset = solarTransitJ(a, M, L);
        var Jrise = Jnoon - (Jset - Jnoon);

        var sunriseDate = julianToDate(Jrise);
        var noonDate = julianToDate(Jnoon);
        var sunsetDate = julianToDate(Jset);

        // Rough rounding to nearest minute (30-second window) to eliminate jitter
        var roundToNearestMin = function (dt) {
            return new Date(Math.round(dt.getTime() / 60000) * 60000);
        };

        return {
            sunrise: roundToNearestMin(sunriseDate),
            solarNoon: roundToNearestMin(noonDate),
            sunset: roundToNearestMin(sunsetDate)
        };
    };

    return SunCalc;
}));
