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

    function manualMapRotationFromTouchAngles(startOffsetDeg, currentTouchAngleDeg, startTouchAngleDeg) {
        const offset = Number(startOffsetDeg);
        const current = Number(currentTouchAngleDeg);
        const start = Number(startTouchAngleDeg);
        if (![offset, current, start].every(Number.isFinite)) return Number.isFinite(offset) ? offset : 0;
        const touchDelta = ((current - start + 540) % 360) - 180;
        // Screen touch angles increase clockwise because clientY grows
        // downward. The map DOM is rendered with CSS rotate(-mapBearing), so
        // the manual bearing offset must use the opposite sign for the map to
        // visually follow the two-finger gesture instead of opposing it.
        return offset - touchDelta;
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
            maximumAge: Number(config.quickMaximumAgeMs || 5000)
        };
        const preciseOptions = {
            enableHighAccuracy: true,
            timeout: Number(config.preciseTimeoutMs || 12000),
            maximumAge: Number(config.preciseMaximumAgeMs || 2000)
        };
        const quickAccuracyMeters = Number(config.quickAccuracyMeters || 30);
        const maxInitialAccuracyMeters = Number(config.maxInitialAccuracyMeters || 50);
        const maxRouteFixAgeMs = Number(config.maxRouteFixAgeMs || 2000);
        const now = Number(config.nowMs || Date.now());
        const accuracyOf = position => Number(position && position.coords && position.coords.accuracy);
        const timestampOf = position => Number(position && position.timestamp);
        const hasCoordinates = position => Number.isFinite(Number(position && position.coords && position.coords.latitude)) &&
            Number.isFinite(Number(position && position.coords && position.coords.longitude));
        const isFresh = position => {
            const timestamp = timestampOf(position);
            return Number.isFinite(timestamp) && timestamp > 0 && Math.max(0, now - timestamp) <= maxRouteFixAgeMs;
        };
        const isReliable = position => {
            const accuracy = accuracyOf(position);
            return Number.isFinite(accuracy) && accuracy > 0 && accuracy <= maxInitialAccuracyMeters;
        };
        const bestAvailable = (...positions) => positions.filter(hasCoordinates).sort((a, b) => {
            const freshnessDifference = Number(isFresh(b)) - Number(isFresh(a));
            if (freshnessDifference) return freshnessDifference;
            const aAccuracy = accuracyOf(a);
            const bAccuracy = accuracyOf(b);
            const aRank = Number.isFinite(aAccuracy) && aAccuracy > 0 ? aAccuracy : Infinity;
            const bRank = Number.isFinite(bAccuracy) && bAccuracy > 0 ? bAccuracy : Infinity;
            if (aRank !== bRank) return aRank - bRank;
            return (timestampOf(b) || 0) - (timestampOf(a) || 0);
        })[0] || null;
        const acquirePrecise = async fallback => {
            try {
                const precise = await requestGeolocationPosition(geolocation, preciseOptions);
                if (isReliable(precise) && isFresh(precise)) return precise;
                // A coarse but valid coordinate is enough to calculate an
                // approximate road origin. The live guidance filter still
                // rejects low-confidence movement/reroute updates until a more
                // reliable fix arrives, so startup is not needlessly blocked.
                const available = bestAvailable(precise, fallback);
                if (available) return available;
                const unavailable = new Error('Location did not contain usable coordinates.');
                unavailable.code = 'UNAVAILABLE';
                throw unavailable;
            } catch (error) {
                // Any valid quick fix remains usable as an approximate origin
                // when the bounded high-accuracy follow-up fails.
                if (hasCoordinates(fallback)) return fallback;
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
        if (isReliable(quick) && isFresh(quick) && accuracyOf(quick) <= quickAccuracyMeters) return quick;
        return acquirePrecise(quick);
    }

    function isProvisionalRouteOrigin(position, nowMs = Date.now(), config = {}) {
        const lat = Number(position && position.lat);
        const lng = Number(position && position.lng);
        const accuracy = Number(position && position.accuracy);
        const timestamp = Number(position && position.timestamp);
        const now = Number(nowMs);
        const maxAccuracyMeters = Number(config.maxAccuracyMeters || 50);
        const maxAgeMs = Number(config.maxAgeMs || 2000);
        if (![lat, lng, now].every(Number.isFinite)) return true;
        if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > maxAccuracyMeters) return true;
        if (!Number.isFinite(timestamp) || timestamp <= 0 || Math.max(0, now - timestamp) > maxAgeMs) return true;
        return false;
    }

    function vehicleMarkerAnimationDurationMs(speedKmh, gapMeters) {
        const speed = Math.max(0, Number(speedKmh) || 0);
        const gap = Math.max(0, Number(gapMeters) || 0);
        let duration = Math.max(80, Math.min(320, 320 - speed * 1.8));
        const speedMetersPerSecond = speed / 3.6;
        if (gap > Math.max(12, speedMetersPerSecond * 0.5)) duration *= 0.65;
        return Math.max(60, Math.round(duration));
    }

    function formatArrivalDateTime(nowMs, remainingSec, locale = 'en-US') {
        const nowValue = Number(nowMs);
        const now = new Date(Number.isFinite(nowValue) ? nowValue : Date.now());
        const seconds = Math.max(0, Number(remainingSec) || 0);
        const arrival = new Date(now.getTime() + seconds * 1000);
        const sameDay = now.getFullYear() === arrival.getFullYear() &&
            now.getMonth() === arrival.getMonth() && now.getDate() === arrival.getDate();
        const options = { hour: 'numeric', minute: '2-digit' };
        if (!sameDay) {
            options.month = 'short';
            options.day = 'numeric';
            if (now.getFullYear() !== arrival.getFullYear()) options.year = 'numeric';
        }
        return arrival.toLocaleString(locale || undefined, options);
    }

    function formatRemainingDuration(remainingSec, isKorean = false) {
        const totalMinutes = Math.max(1, Math.round(Math.max(0, Number(remainingSec) || 0) / 60));
        const days = Math.floor(totalMinutes / (24 * 60));
        const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
        const minutes = totalMinutes % 60;
        if (days > 0) return isKorean ? `${days}일 ${hours}시간` : `${days}d ${hours}h`;
        if (hours > 0) return isKorean ? `${hours}시간 ${minutes}분` : `${hours}h ${minutes}min`;
        return isKorean ? `${minutes}분` : `${minutes} min`;
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

    function evaluateAutoFreeDriveSample(state = {}, candidate = {}, distanceMeters, config = {}) {
        const lat = Number(candidate.lat);
        const lng = Number(candidate.lng);
        const timestamp = Number(candidate.timestamp);
        const accuracy = Number(candidate.accuracy);
        const reportedSpeedKmh = Number(candidate.reportedSpeedKmh);
        const minimumSpeedKmh = Number(config.minimumSpeedKmh || 15);
        const maximumAccuracyMeters = Number(config.maximumAccuracyMeters || 50);
        const minimumSamples = Math.max(2, Number(config.minimumSamples || 3));
        const minimumElapsedMs = Number(config.minimumElapsedMs || 3000);
        const minimumDistanceMeters = Number(config.minimumDistanceMeters || 25);
        const maximumSampleGapMs = Number(config.maximumSampleGapMs || 15000);
        const reset = reason => ({ state: {}, shouldStart: false, reason });

        if (![lat, lng, timestamp].every(Number.isFinite)) return reset('INVALID_FIX');
        if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > maximumAccuracyMeters) {
            return reset('LOW_ACCURACY');
        }

        const previous = state.last;
        let distance = 0;
        let elapsedMs = 0;
        let computedSpeedKmh = 0;
        if (previous) {
            elapsedMs = timestamp - Number(previous.timestamp);
            if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > maximumSampleGapMs) {
                return reset('STALE_OR_GAPPED_FIX');
            }
            distance = typeof distanceMeters === 'function'
                ? Number(distanceMeters(Number(previous.lat), Number(previous.lng), lat, lng))
                : 0;
            computedSpeedKmh = Number.isFinite(distance) ? distance / (elapsedMs / 1000) * 3.6 : 0;
        }

        const speedKmh = Number.isFinite(reportedSpeedKmh) && reportedSpeedKmh >= 0
            ? reportedSpeedKmh : computedSpeedKmh;
        if (!Number.isFinite(speedKmh) || speedKmh < minimumSpeedKmh || speedKmh > Number(config.maximumSpeedKmh || 220)) {
            return reset('NOT_CONFIRMED_DRIVING');
        }

        const first = state.first || { lat, lng, timestamp };
        const totalDistanceMeters = Number(state.totalDistanceMeters || 0) + Math.max(0, Number(distance) || 0);
        const consecutiveSamples = Number(state.consecutiveSamples || 0) + 1;
        const totalElapsedMs = timestamp - Number(first.timestamp);
        const nextState = {
            first,
            last: { lat, lng, timestamp, accuracy, speedKmh },
            totalDistanceMeters,
            consecutiveSamples
        };
        return {
            state: nextState,
            shouldStart: consecutiveSamples >= minimumSamples &&
                totalElapsedMs >= minimumElapsedMs && totalDistanceMeters >= minimumDistanceMeters,
            reason: 'DRIVING_SAMPLE',
            speedKmh,
            totalElapsedMs,
            totalDistanceMeters,
            consecutiveSamples
        };
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
        manualMapRotationFromTouchAngles,
        screenPointToRotatedLayout,
        rotatedLayoutPointToScreen,
        normalizeTimeToken,
        rectsOverlap,
        findRectIntersections,
        createDebouncedScheduler,
        shouldRefreshRoadRules,
        acquireInitialPosition,
        isProvisionalRouteOrigin,
        vehicleMarkerAnimationDurationMs,
        shouldRestartRouteForGpsFix,
        evaluateNavigationFix,
        evaluateAutoFreeDriveSample,
        estimateGpsEtaUncertainty,
        formatArrivalDateTime,
        formatRemainingDuration
    };
});
