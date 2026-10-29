/* Route-relative guidance. Coordinates describe the selected route, not nearby roads. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.NavigationGuidance = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const rad = Math.PI / 180;
    const cache = new WeakMap();
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    function distance(a, b) {
        const x = (b[0] - a[0]) * rad * Math.cos((a[1] + b[1]) * rad / 2);
        const y = (b[1] - a[1]) * rad;
        return Math.hypot(x, y) * 6371000;
    }
    function project(point, a, b) {
        const cos = Math.cos(point[1] * rad);
        const x = (b[0] - a[0]) * cos, y = b[1] - a[1];
        const t = clamp(((point[0] - a[0]) * cos * x + (point[1] - a[1]) * y) / (x * x + y * y || 1), 0, 1);
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        return { t, point: p, distance: distance(point, p) };
    }
    function model(route) {
        const cached = cache.get(route);
        if (cached && cached.coordinates === route.analyzed.coordinates && cached.sourceManeuvers === route.maneuvers) return cached;
        const coordinates = route.analyzed.coordinates;
        const cumulative = [0], headings = [];
        for (let i = 0; i < coordinates.length - 1; i++) {
            const a = coordinates[i], b = coordinates[i + 1];
            cumulative.push(cumulative[i] + distance(a, b));
            headings.push((Math.atan2((b[0] - a[0]) * Math.cos((a[1] + b[1]) * rad / 2), b[1] - a[1]) / rad + 360) % 360);
        }
        const total = cumulative[cumulative.length - 1];
        let previous = 0;
        const maneuvers = (route.maneuvers || []).filter(m => Array.isArray(m.location)).map((m, sequence) => {
            // Cumulative provider distance disambiguates repeat visits to the same
            // junction; geometry determines the actual distance used for guidance.
            const expected = route.distanceMeters > 0 && Number.isFinite(m.cumulativeDistance)
                ? total * m.cumulativeDistance / route.distanceMeters : previous;
            let best = null;
            for (let i = 0; i < coordinates.length - 1; i++) {
                const p = project(m.location, coordinates[i], coordinates[i + 1]);
                const progress = cumulative[i] + p.t * (cumulative[i + 1] - cumulative[i]);
                if (progress + 1 < previous) continue;
                const offset = Math.abs(progress - expected);
                if (!best || p.distance < best.distance - 0.5 ||
                    (Math.abs(p.distance - best.distance) <= 0.5 && offset < best.offset)) {
                    best = { distance: p.distance, offset, progress };
                }
            }
            previous = best ? best.progress : previous;
            return { ...m, sequence, progressMeters: previous };
        });
        const result = { coordinates, cumulative, headings, total, maneuvers, sourceManeuvers: route.maneuvers };
        cache.set(route, result);
        return result;
    }
    function match(route, fix, previous = null) {
        if (![fix.lng, fix.lat, fix.timestamp].every(Number.isFinite) || Math.abs(fix.lng) > 180 || Math.abs(fix.lat) > 90 ||
            (fix.accuracy !== undefined && (!Number.isFinite(fix.accuracy) || fix.accuracy <= 0 || fix.accuracy > 35))) {
            return { lat: fix.lat, lng: fix.lng, timestamp: fix.timestamp, isSnapped: false, reason: 'inaccurate', remainingMeters: Infinity };
        }
        const data = model(route), point = [fix.lng, fix.lat];
        const speed = Math.max(0, Number(fix.speedKmh) || 0) / 3.6;
        const accuracy = clamp(Number(fix.accuracy) || 10, 3, 35);
        const elapsed = previous ? (fix.timestamp - previous.timestamp) / 1000 : 0;
        if (previous && elapsed <= 0) return { isSnapped: false, reason: 'stale', timestamp: fix.timestamp, remainingMeters: Infinity };
        const continuous = previous && elapsed >= 0 && elapsed <= 15;
        const history = continuous ? (previous.history || []).filter(p => fix.timestamp - p.timestamp <= 8000) : [];
        const travelled = history.length ? history[history.length - 1].travelled + distance(point, history[history.length - 1].point) : 0;
        const allowance = Math.max(45, speed * Math.max(0, elapsed) * 1.8 + accuracy * 2);
        const candidates = [];
        let nearest = Infinity;
        let oppositeNearby = false;
        let motionConflict = false;
        for (let i = 0; i < data.coordinates.length - 1; i++) {
            if (continuous && (data.cumulative[i + 1] < previous.progressMeters - 120 || data.cumulative[i] > previous.progressMeters + allowance)) continue;
            const p = project(point, data.coordinates[i], data.coordinates[i + 1]);
            nearest = Math.min(nearest, p.distance);
            if (p.distance > 40) continue;
            const progress = data.cumulative[i] + p.t * (data.cumulative[i + 1] - data.cumulative[i]);
            const headingKnown = fix.heading !== null && fix.heading !== undefined && Number.isFinite(fix.heading) && speed >= 2.2;
            const difference = headingKnown ? Math.abs((fix.heading - data.headings[i] + 540) % 360 - 180) : 0;
            if (difference > 110) {
                if (p.distance <= 20 && accuracy <= 20 && speed >= 2.8) oppositeNearby = true;
                continue;
            }
            if (continuous && (progress < previous.progressMeters - 20 || progress > previous.progressMeters + allowance)) continue;
            // A string of individually plausible snaps must not creep onto a
            // later parallel/loop segment while the raw fixes barely move.
            const anchor = history.find(h => fix.timestamp - h.timestamp >= 2000);
            const moved = anchor ? travelled - anchor.travelled : 0;
            if (anchor && Math.abs(progress - anchor.progressMeters) > moved * 1.5 + accuracy + anchor.accuracy + 15) {
                motionConflict = true; continue;
            }
            const residual = anchor ? Math.abs(Math.max(0, progress - anchor.progressMeters) - moved) : 0;
            const score = p.distance + difference * 0.15 + (continuous ? Math.max(0, previous.progressMeters - progress) * 0.5 : 0) + Math.min(12, residual * 0.2);
            candidates.push({ ...p, score, progressMeters: progress, segmentIndex: i });
        }
        candidates.sort((a, b) => a.score - b.score);
        const best = candidates[0];
        const margin = Math.max(8, accuracy * 0.6);
        const ambiguous = best && candidates.some(c => Math.abs(c.progressMeters - best.progressMeters) > 60 && c.score - best.score < margin);
        const accepted = best && best.distance <= Math.min(40, Math.max(18, accuracy * 1.5)) && !ambiguous;
        const raw = { lat: fix.lat, lng: fix.lng, heading: fix.heading || 0, isSnapped: false,
            distMeters: nearest, segmentIndex: -1, t: 0, remainingMeters: Infinity,
            reason: ambiguous ? 'ambiguous' : motionConflict ? 'motion-conflict' : oppositeNearby ? 'opposite-direction' : 'unmatched', timestamp: fix.timestamp };
        if (!accepted) return raw;
        return { lat: best.point[1], lng: best.point[0], heading: data.headings[best.segmentIndex],
            isSnapped: true, distMeters: best.distance, segmentIndex: best.segmentIndex, t: best.t,
            progressMeters: best.progressMeters, remainingMeters: data.total - best.progressMeters,
            timestamp: fix.timestamp, reason: 'matched',
            history: [...history, {point, timestamp: fix.timestamp, progressMeters: best.progressMeters, accuracy, travelled}].slice(-32) };
    }
    function confirmMatch(candidate, fix, previous = {}) {
        const recovering = previous.recovering === true || previous.snap && fix.timestamp - previous.snap.timestamp > 15000 ||
            ['ambiguous', 'nearby-road-conflict', 'reacquiring', 'motion-conflict'].includes(previous.result?.reason);
        if (!candidate.isSnapped) return { result: candidate, pending: null,
            recovering: !!recovering || ['ambiguous','nearby-road-conflict','motion-conflict'].includes(candidate.reason) };
        if (!recovering) return { result: candidate, pending: null, recovering: false };
        const pending = previous.pending;
        const elapsed = pending ? fix.timestamp - pending.timestamp : 0;
        const allowance = Math.max(45, Math.max(0, fix.speedKmh || 0) / 3.6 * elapsed / 1000 * 1.8 + Math.max(3, fix.accuracy || 10) * 2);
        if (pending && elapsed > 0 && elapsed <= 5000 && candidate.progressMeters >= pending.progressMeters - 20 && candidate.progressMeters <= pending.progressMeters + allowance) {
            return { result: candidate, pending: null, recovering: false };
        }
        return { recovering: true, pending: pending && elapsed <= 0 ? pending : candidate,
            result: { ...candidate, lat: fix.lat, lng: fix.lng, isSnapped: false, reason: 'reacquiring', remainingMeters: Infinity } };
    }
    function next(route, snap) {
        if (!snap || !snap.isSnapped) return null;
        const maneuvers = model(route).maneuvers;
        const index = maneuvers.findIndex(m => m.progressMeters >= snap.progressMeters - 8 && m.type !== 'depart');
        if (index < 0) return null;
        const m = maneuvers[index], following = maneuvers[index + 1];
        const distanceFromCar = Math.max(0, m.progressMeters - snap.progressMeters);
        if (distanceFromCar > 2500) return null;
        return { ...m, distanceFromCar, following: following && following.type !== 'arrive'
            ? { ...following, distanceAfter: Math.max(0, following.progressMeters - m.progressMeters) } : null };
    }
    function thresholds(speedKmh, maneuver = {}) {
        const speed = clamp(Number(speedKmh) || 0, 0, 180) / 3.6;
        const complex = complexTurn(maneuver);
        return { preview: clamp(speed * (complex ? 30 : 25), 250, complex ? 1200 : 1000), prepare: clamp(speed * (complex ? 14 : 10), 90, complex ? 450 : 400), execute: clamp(speed * 2, 20, 60) };
    }
    function complexTurn(m) { return !!(m.lanes || /ramp|fork|roundabout|rotary/.test(m.type || '') || m.following?.distanceAfter <= 180); }
    function laneArrows(indications) {
        const arrows = {straight:'↑','slight left':'↖',left:'←','sharp left':'↙','slight right':'↗',right:'→','sharp right':'↘',uturn:'↶'};
        return [...new Set((indications || []).map(v => arrows[v]).filter(Boolean))].join('');
    }
    function shortRoad(m, ko) {
        return [m.exits ? (ko ? `${m.exits}번 출구` : `Exit ${m.exits}`) : '', m.ref || m.name || ''].filter(Boolean).join(' · ');
    }
    function roadLabel(m, ko) {
        const parts = [m.name, m.ref].filter(Boolean);
        if (m.exits) parts.push(ko ? `${m.exits}번 출구` : `Exit ${m.exits}`);
        if (m.destinations) parts.push(m.destinations);
        return [...new Set(parts)].join(' · ');
    }
    function validSession(saved, now, ttl) {
        return !!(saved && saved.end && typeof saved.end.lat === 'number' && typeof saved.end.lng === 'number' &&
            Number.isFinite(saved.end.lat) && Number.isFinite(saved.end.lng) && Math.abs(saved.end.lat) <= 90 && Math.abs(saved.end.lng) <= 180 &&
            Number.isFinite(saved.savedAt) && now >= saved.savedAt && now - saved.savedAt <= ttl);
    }
    function shouldConserve(health, previous = false) {
        if (!health) return false;
        return health.powerSaveMode === true || Number(health.thermalStatus) >= 2 ||
            (Number.isFinite(health.batteryPercent) && health.batteryPercent >= 0 && !health.charging &&
                health.externalPowerConnected !== true && health.batteryPercent <= (previous ? 20 : 15));
    }
    // Only road-name fields are expanded: St. Louis and Dr. King must remain names.
    function spokenRoad(value) {
        const suffixes = { st: 'Street', rd: 'Road', av: 'Avenue', ave: 'Avenue', blvd: 'Boulevard', dr: 'Drive', ln: 'Lane', ct: 'Court', pkwy: 'Parkway', hwy: 'Highway' };
        return String(value || '').replace(/\b(st|rd|av|ave|blvd|dr|ln|ct|pkwy|hwy)\.?\s*(?=$|[,;·])/gi,
            (_, suffix) => suffixes[suffix.toLowerCase()])
            .replace(/\bI[- ](\d+)\b/g, 'Interstate $1').replace(/\bUS[- ](\d+)\b/g, 'U S Route $1');
    }
    function speechSegments(text, language, names = []) {
        const segments = [];
        const roads = [...new Set(names.filter(name => typeof name === 'string' && /[A-Za-z]/.test(name)))].sort((a, b) => b.length - a.length);
        let rest = String(text || '');
        while (rest) {
            let found = null;
            for (const name of roads) {
                const at = rest.indexOf(name);
                if (at >= 0 && (!found || at < found.at)) found = { name, at };
            }
            if (!found) { segments.push({ text: rest, lang: language }); break; }
            if (found.at) segments.push({ text: rest.slice(0, found.at), lang: language });
            segments.push({ text: spokenRoad(found.name), lang: 'en-US' });
            rest = rest.slice(found.at + found.name.length);
        }
        return segments.filter(part => part.text.trim()).reduce((out, part) => {
            if (out.length && out[out.length - 1].lang === part.lang) out[out.length - 1].text += part.text;
            else out.push({ ...part });
            return out;
        }, []);
    }
    function voicePlan(segments, language, unifiedVoice = true) {
        return unifiedVoice === false || !segments.length ? segments : [{text:segments.map(part=>part.text).join(''),lang:language}];
    }
    return { model, match, confirmMatch, next, thresholds, complexTurn, laneArrows, shortRoad, roadLabel, validSession, shouldConserve, spokenRoad, speechSegments, voicePlan };
});
