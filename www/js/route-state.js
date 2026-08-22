/* Small pure helpers for guarding route results against stale input state. */
(function attachRouteState(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.RouteState = factory();
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis), function createRouteState() {
    'use strict';

    function coordinatePart(point) {
        if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return 'invalid';
        return `${Number(point.lat).toFixed(6)},${Number(point.lng).toFixed(6)}`;
    }

    function normalizeTimeToken(timeToken) {
        // Real-time routes remain valid across a minute boundary.  The route
        // calculation uses the current time for solar estimates, but a clock
        // tick alone must not make an otherwise unchanged road route unusable.
        if (timeToken === 'realtime') return 'realtime';
        return Number.isFinite(Number(timeToken)) ? String(Number(timeToken)) : 'time-unknown';
    }

    function createRouteRequestKey(start, end, mode, tollFree, timeToken) {
        return [
            coordinatePart(start),
            coordinatePart(end),
            String(mode || ''),
            tollFree ? 'toll-free' : 'standard',
            normalizeTimeToken(timeToken)
        ].join('|');
    }

    function isRouteRequestKeyCurrent(key, start, end, mode, tollFree, timeToken) {
        return !!key && key === createRouteRequestKey(start, end, mode, tollFree, timeToken);
    }

    function inverseRotateScreenDelta(dx, dy, angleDeg) {
        const x = Number(dx);
        const y = Number(dy);
        const radians = (Number(angleDeg) || 0) * Math.PI / 180;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return { x: 0, y: 0 };
        return {
            x: x * Math.cos(radians) - y * Math.sin(radians),
            y: x * Math.sin(radians) + y * Math.cos(radians)
        };
    }

    function screenPointToRotatedLayout(clientX, clientY, centerX, centerY, layoutWidth, layoutHeight, angleDeg) {
        const x = Number(clientX);
        const y = Number(clientY);
        const cx = Number(centerX);
        const cy = Number(centerY);
        const width = Number(layoutWidth);
        const height = Number(layoutHeight);
        if (![x, y, cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
            return { x: 0, y: 0 };
        }
        const delta = inverseRotateScreenDelta(x - cx, y - cy, angleDeg);
        return { x: width / 2 + delta.x, y: height / 2 + delta.y };
    }

    function rotatedLayoutPointToScreen(layoutX, layoutY, centerX, centerY, layoutWidth, layoutHeight, angleDeg) {
        const x = Number(layoutX);
        const y = Number(layoutY);
        const cx = Number(centerX);
        const cy = Number(centerY);
        const width = Number(layoutWidth);
        const height = Number(layoutHeight);
        if (![x, y, cx, cy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
            return { x: 0, y: 0 };
        }
        const radians = (Number(angleDeg) || 0) * Math.PI / 180;
        const dx = x - width / 2;
        const dy = y - height / 2;
        // The map DOM uses CSS rotate(-angle). This is the exact forward
        // transform paired with screenPointToRotatedLayout's +angle inverse.
        return {
            x: cx + dx * Math.cos(radians) + dy * Math.sin(radians),
            y: cy - dx * Math.sin(radians) + dy * Math.cos(radians)
        };
    }

    function rectsOverlap(a, b, gap = 0) {
        if (!a || !b) return false;
        const clearance = Math.max(0, Number(gap) || 0);
        return a.left < b.right - clearance && a.right > b.left + clearance &&
            a.top < b.bottom - clearance && a.bottom > b.top + clearance;
    }

    function findRectIntersections(rects, gap = 0) {
        const entries = Object.entries(rects || {}).filter(([, rect]) => rect);
        const overlaps = [];
        for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
                if (rectsOverlap(entries[i][1], entries[j][1], gap)) {
                    overlaps.push([entries[i][0], entries[j][0]]);
                }
            }
        }
        return overlaps;
    }

    function createDebouncedScheduler(task, delayMs = 300) {
        let timer = null;
        let generation = 0;
        const schedule = (...args) => {
            generation += 1;
            const currentGeneration = generation;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                if (currentGeneration === generation) task(...args);
            }, Math.max(0, Number(delayMs) || 0));
        };
        schedule.flush = (...args) => {
            generation += 1;
            if (timer !== null) clearTimeout(timer);
            timer = null;
            task(...args);
        };
        schedule.cancel = () => {
            generation += 1;
            if (timer !== null) clearTimeout(timer);
            timer = null;
        };
        return schedule;
    }

    function shouldRefreshRoadRules(now, state = {}, context = {}, config = {}) {
        const lastPosition = state.lastPosition;
        if (!lastPosition) return true;
        if (context.routeKey && state.lastRouteKey && context.routeKey !== state.lastRouteKey) return true;
        const distanceMeters = typeof config.distanceMeters === 'function'
            ? config.distanceMeters(lastPosition.lat, lastPosition.lng, context.lat, context.lng)
            : Infinity;
        const minMoveMeters = Number(config.minMoveMeters || 65);
        const headingDelta = state.lastHeading === null || state.lastHeading === undefined
            ? Infinity
            : Math.abs(((Number(context.heading) - Number(state.lastHeading) + 540) % 360) - 180);
        const segmentChanged = context.segmentIndex !== null && context.segmentIndex !== undefined &&
            context.segmentIndex !== state.lastSegment;
        const ttlExpired = Number(now) - Number(state.lastFetchAt || 0) >= Number(config.maxAgeMs || 30000);
        return ttlExpired || segmentChanged || distanceMeters >= minMoveMeters ||
            headingDelta >= Number(config.headingDelta || 25);
    }

    function requestGeolocationPosition(geolocation, options) {
        return new Promise((resolve, reject) => {
            if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
                const error = new Error('Geolocation is unavailable.');
                error.code = 'UNAVAILABLE';
                reject(error);
                return;
            }
            geolocation.getCurrentPosition(resolve, reject, options);
        });
    }

    async function acquireInitialPosition(geolocation, config = {}) {
        const quickOptions = {
            enableHighAccuracy: false,
            timeout: Number(config.quickTimeoutMs || 8000),
            maximumAge: Number(config.quickMaximumAgeMs || 120000)
        };
        const preciseOptions = {
            enableHighAccuracy: true,
            timeout: Number(config.preciseTimeoutMs || 12000),
            maximumAge: Number(config.preciseMaximumAgeMs || 15000)
        };
        const quickAccuracyMeters = Number(config.quickAccuracyMeters || 30);
        const maxInitialAccuracyMeters = Number(config.maxInitialAccuracyMeters || 50);
        const accuracyOf = position => Number(position && position.coords && position.coords.accuracy);
        const isReliable = position => {
            const accuracy = accuracyOf(position);
            return Number.isFinite(accuracy) && accuracy > 0 && accuracy <= maxInitialAccuracyMeters;
        };
        const acquirePrecise = async fallback => {
            try {
                const precise = await requestGeolocationPosition(geolocation, preciseOptions);
                if (isReliable(precise)) return precise;
                if (isReliable(fallback)) return fallback;
                const uncertain = new Error('Location accuracy is insufficient for driving guidance.');
                uncertain.code = 'POSITION_UNCERTAIN';
                uncertain.accuracy = accuracyOf(precise);
                throw uncertain;
            } catch (error) {
                // A moderately accurate quick fix remains usable when the
                // high-accuracy follow-up times out. Very coarse indoor fixes
                // are never promoted through this fallback.
                if (isReliable(fallback) && error && error.code !== 'POSITION_UNCERTAIN') return fallback;
                throw error;
            }
        };
        let quick;
        try {
            quick = await requestGeolocationPosition(geolocation, quickOptions);
        } catch (error) {
            // Permission denial must be surfaced immediately. A timeout or an
            // unavailable cached/network fix gets one bounded GPS attempt.
            if (Number(error && error.code) === 1 || error && error.code === 'UNAVAILABLE') throw error;
            return acquirePrecise(null);
        }
        if (isReliable(quick) && accuracyOf(quick) <= quickAccuracyMeters) return quick;
        return acquirePrecise(quick);
    }

    function shouldRestartRouteForGpsFix(pendingKey, currentKey, hasDestination, liveNavigationActive) {
        return !!hasDestination && !liveNavigationActive && !!pendingKey && !!currentKey && pendingKey !== currentKey;
    }

    function evaluateNavigationFix(previous, candidate, distanceMeters, config = {}) {
        const lat = Number(candidate && candidate.lat);
        const lng = Number(candidate && candidate.lng);
        const timestamp = Number(candidate && candidate.timestamp);
        const accuracy = Number(candidate && candidate.accuracy);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(timestamp)) {
            return { accepted: false, reason: 'INVALID_FIX' };
        }

        // A coarse indoor/network fix is useful for showing an uncertainty
        // circle, but is not safe enough to move turn guidance or trigger a
        // road reroute. Waiting for a better fix is safer than manufacturing
        // a route from a position that may be in another block.
        const maxAccuracyMeters = Number(config.maxAccuracyMeters || 50);
        if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > maxAccuracyMeters) {
            return { accepted: false, reason: 'LOW_ACCURACY', accuracy };
        }

        if (!previous) return { accepted: true, reason: 'FIRST_RELIABLE_FIX', distanceMeters: 0, impliedSpeedKmh: 0 };
        const previousTimestamp = Number(previous.timestamp);
        const dtSeconds = (timestamp - previousTimestamp) / 1000;
        if (!Number.isFinite(previousTimestamp) || dtSeconds <= 0) {
            return { accepted: false, reason: 'STALE_FIX' };
        }

        const distance = typeof distanceMeters === 'function'
            ? Number(distanceMeters(Number(previous.lat), Number(previous.lng), lat, lng))
            : Infinity;
        const impliedSpeedKmh = Number.isFinite(distance) ? distance / dtSeconds * 3.6 : Infinity;
        if (impliedSpeedKmh > Number(config.maxPlausibleSpeedKmh || 220)) {
            return { accepted: false, reason: 'IMPLAUSIBLE_JUMP', distanceMeters: distance, impliedSpeedKmh };
        }

        const reportedSpeedKmh = Number(candidate.reportedSpeedKmh);
        const previousAccuracy = Number(previous.accuracy);
        const uncertaintyMeters = Math.max(
            Number(config.stationaryJumpMeters || 60),
            ((Number.isFinite(previousAccuracy) ? previousAccuracy : accuracy) + accuracy) * 2
        );
        if (Number.isFinite(reportedSpeedKmh) && reportedSpeedKmh <= Number(config.stationarySpeedKmh || 3.5) &&
            dtSeconds <= Number(config.stationaryWindowSeconds || 8) && distance > uncertaintyMeters) {
            return { accepted: false, reason: 'STATIONARY_JUMP', distanceMeters: distance, impliedSpeedKmh };
        }

        return { accepted: true, reason: 'RELIABLE_FIX', distanceMeters: distance, impliedSpeedKmh };
    }

    function estimateGpsEtaUncertainty(accuracyMeters, remainingMeters, remainingSeconds, options = {}) {
        const accuracy = Number(accuracyMeters);
        const distance = Number(remainingMeters);
        const duration = Number(remainingSeconds);
        if (![accuracy, distance, duration].every(Number.isFinite) || accuracy <= 0 || distance <= 0 || duration <= 0) {
            return { seconds: null, confidenceLevel: null, scope: 'unavailable' };
        }
        const reportedConfidence = Number(options && options.confidenceLevel);
        const confidenceLevel = Number.isFinite(reportedConfidence) && reportedConfidence > 0 && reportedConfidence < 1
            ? reportedConfidence : null;
        const accuracySource = String(options && options.accuracySource || 'unspecified');
        // Propagate the provider-reported horizontal accuracy radius through
        // the current route-average speed. Web Geolocation defines a 95%
        // radius, while Android Location.getAccuracy() uses a 68th-percentile
        // radius; callers must provide that metadata rather than this helper
        // silently labelling every provider as W3C 95%.
        //
        // This is GPS-position uncertainty only. It deliberately excludes
        // traffic and OSRM speed-profile error and is not a full ETA CI.
        const routeAverageMetersPerSecond = distance / duration;
        return {
            // Do not cap the computed effect at the remaining duration. If the
            // radius exceeds remaining distance, that is useful evidence that
            // the fix cannot constrain arrival time to the nominal trip time.
            seconds: accuracy / routeAverageMetersPerSecond,
            confidenceLevel,
            scope: 'gps-position-only',
            accuracyMeters: accuracy,
            accuracySource,
            routeAverageMetersPerSecond
        };
    }

    return {
        createRouteRequestKey,
        isRouteRequestKeyCurrent,
        inverseRotateScreenDelta,
        screenPointToRotatedLayout,
        rotatedLayoutPointToScreen,
        normalizeTimeToken,
        rectsOverlap,
        findRectIntersections,
        createDebouncedScheduler,
        shouldRefreshRoadRules,
        acquireInitialPosition,
        shouldRestartRouteForGpsFix,
        evaluateNavigationFix,
        estimateGpsEtaUncertainty
    };
});
