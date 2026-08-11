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
        try {
            return await requestGeolocationPosition(geolocation, quickOptions);
        } catch (error) {
            // Permission denial must be surfaced immediately. A timeout or an
            // unavailable cached/network fix gets one bounded GPS attempt.
            if (Number(error && error.code) === 1 || error && error.code === 'UNAVAILABLE') throw error;
            return requestGeolocationPosition(geolocation, preciseOptions);
        }
    }

    function shouldRestartRouteForGpsFix(pendingKey, currentKey, hasDestination, liveNavigationActive) {
        return !!hasDestination && !liveNavigationActive && !!pendingKey && !!currentKey && pendingKey !== currentKey;
    }

    return {
        createRouteRequestKey,
        isRouteRequestKeyCurrent,
        normalizeTimeToken,
        rectsOverlap,
        findRectIntersections,
        createDebouncedScheduler,
        shouldRefreshRoadRules,
        acquireInitialPosition,
        shouldRestartRouteForGpsFix
    };
});
