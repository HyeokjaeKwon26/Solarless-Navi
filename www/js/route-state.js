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

    return {
        createRouteRequestKey,
        isRouteRequestKeyCurrent,
        normalizeTimeToken,
        rectsOverlap,
        findRectIntersections,
        createDebouncedScheduler
    };
});
