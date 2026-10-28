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
        if (!route?.analyzed?.coordinates || !snap?.isSnapped || snap.segmentIndex < 0) return null;
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
            // A passed closure in the first partial step must not be evaluated
            // as still ahead. Preserve the remaining step's geometry as well.
            if (passed > 0 && step.geometry?.coordinates?.length > 1) {
                const points = step.geometry.coordinates;
                const lengths = points.slice(1).map((b,i) => Math.hypot((b[0]-points[i][0])*Math.cos((b[1]+points[i][1])*Math.PI/360), b[1]-points[i][1]));
                let cut = lengths.reduce((a,b)=>a+b,0) * (1-ratio), index = 0;
                while (index < lengths.length-1 && cut >= lengths[index]) cut -= lengths[index++];
                const t = lengths[index] > 0 ? Math.min(1,cut/lengths[index]) : 0;
                const a = points[index], b = points[index+1];
                remainingStep.geometry = { ...step.geometry, coordinates: [[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],...points.slice(index+1)] };
            }
            steps.push(remainingStep); duration += remainingStep.duration; passed = 0;
        }
        if (!duration) duration = route.durationSec * snap.remainingMeters / total;
        return { coordinates, steps: steps.length ? steps : null, duration };
    }
    function previewSnapshot(route, end, now) {
        const coordinates = route?.analyzed?.coordinates;
        if (!Array.isArray(coordinates) || coordinates.length < 2 || coordinates.length > 20000) return null;
        const snapshot = { version: 1, savedAt: now, end: { lat: end?.lat, lng: end?.lng }, coordinates };
        if (!validPreview(snapshot, end, now)) return null;
        return JSON.parse(JSON.stringify(snapshot));
    }
    function validPreview(snapshot, end, now) {
        return !!(snapshot && snapshot.version === 1 && Number.isFinite(snapshot.savedAt) && now >= snapshot.savedAt && now - snapshot.savedAt <= 43200000 &&
            end && [end.lat, end.lng, snapshot.end?.lat, snapshot.end?.lng].every(Number.isFinite) &&
            Math.abs(end.lat) <= 90 && Math.abs(end.lng) <= 180 &&
            Math.abs(end.lat - snapshot.end.lat) < 0.00001 && Math.abs(end.lng - snapshot.end.lng) < 0.00001 &&
            Array.isArray(snapshot.coordinates) && snapshot.coordinates.length >= 2 && snapshot.coordinates.length <= 20000 &&
            snapshot.coordinates.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90));
    }
    function solarTradeoff(baseline, selected) {
        const a = baseline?.analyzed, b = selected?.analyzed;
        if (!a || !b || ![a.sunlitTimeSeconds, b.sunlitTimeSeconds, baseline.durationSec, selected.durationSec].every(n => Number.isFinite(n) && n >= 0)) return null;
        const weather = baseline.weatherMode || a.weatherMode;
        const comparable = ['scene','hybrid-scene','heuristic'].includes(baseline.analysisMode) && baseline.analysisMode === selected.analysisMode &&
            !!weather && weather !== 'unknown' && weather === (selected.weatherMode || b.weatherMode);
        return { predictionOnly: true, comparable, extraSeconds: selected.durationSec - baseline.durationSec,
            sunlitSecondsSaved: comparable ? a.sunlitTimeSeconds - b.sunlitTimeSeconds : null,
            glareReductionPoints: comparable && [a.avgGlareRisk,b.avgGlareRisk].every(Number.isFinite) ? (a.avgGlareRisk-b.avgGlareRisk)*100 : null,
            uncertainRatio: [a.uncertainOcclusionTimeRatio,b.uncertainOcclusionTimeRatio].every(Number.isFinite) ? Math.max(a.uncertainOcclusionTimeRatio,b.uncertainOcclusionTimeRatio) : null,
            analysisMode: selected.analysisMode || 'unknown' };
    }
    return { camera, shouldRefresh, remaining, previewSnapshot, validPreview, solarTradeoff };
});
