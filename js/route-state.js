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

    return { createRouteRequestKey, isRouteRequestKeyCurrent, normalizeTimeToken };
});
