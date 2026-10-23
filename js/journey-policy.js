/* Pure camera and remaining-journey policies, shared with regression tests. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.JourneyPolicy = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    function camera(maneuver, speedKmh) {
        const distance = Number(maneuver?.distanceFromCar);
        const prepare = Math.max(150, Math.min(500, (Number(speedKmh) || 0) / 3.6 * 12));
        const close = !!maneuver && maneuver.type !== 'arrive' && Number.isFinite(distance) && distance <= prepare;
        return { close, zoom: close ? (speedKmh >= 80 ? 17 : 18) : speedKmh >= 80 ? 15 : 16,
            chained: close && maneuver.following?.distanceAfter <= 180 };
    }
    function shouldRefresh(state) {
        return !!(state.live && state.realtime && state.visible && state.snapped && !state.busy &&
            state.now - state.fixAt <= 10000 && state.now - state.lastAt >= 300000 &&
            state.remainingMeters >= 300 && (!state.next || state.next.distanceFromCar > 500));
    }
    function remaining(route, snap) {
        if (!snap?.isSnapped || snap.segmentIndex < 0) return null;
        const coordinates = [[snap.lng, snap.lat], ...route.analyzed.coordinates.slice(snap.segmentIndex + 1)];
        if (coordinates.length < 2 || snap.remainingMeters < 10) return null;
        // Keep original per-road timing proportions instead of assigning one speed to all roads.
        const total = route.distanceMeters || 1;
        const geometryTotal = snap.progressMeters + snap.remainingMeters;
        let passed = Math.max(0, total * snap.progressMeters / Math.max(1, geometryTotal)), duration = 0;
        const steps = [];
        for (const step of (route.raw?.legs?.flatMap(leg => leg.steps || []) || route.routeSteps || [])) {
            const length = Number(step.distance) || 0;
            if (passed >= length) { passed -= length; continue; }
            const ratio = length > 0 ? (length - passed) / length : 0;
            const remainingStep = { ...step, distance: length * ratio, duration: (Number(step.duration) || 0) * ratio };
            steps.push(remainingStep); duration += remainingStep.duration; passed = 0;
        }
        if (!duration) duration = route.durationSec * snap.remainingMeters / total;
        return { coordinates, steps: steps.length ? steps : null, duration };
    }
    return { camera, shouldRefresh, remaining };
});
