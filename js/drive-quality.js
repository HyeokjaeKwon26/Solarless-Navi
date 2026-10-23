/* Opt-in driving diagnostics. Persistence is supplied by DriveArchive on device. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./route-state.js'));
    else root.DriveQuality = factory(root.RouteState);
})(typeof window !== 'undefined' ? window : globalThis, function (rules) {
    'use strict';
    function replay(samples, distanceMeters) {
        let previous = null;
        let offRoute = {};
        const report = { samples: samples.length, accepted: 0, rejected: {}, rerouteRequests: 0,
            labelledRerouteRequests: 0, falseRerouteRequests: 0, maxAcceptedGapMs: 0, decisions: [] };
        for (const sample of samples) {
            const fix = rules.evaluateNavigationFix(previous, sample, distanceMeters, { nowMs: sample.receivedAt });
            if (!fix.accepted) {
                report.rejected[fix.reason] = (report.rejected[fix.reason] || 0) + 1;
                offRoute = { lastAttempt: offRoute.lastAttempt };
            } else {
                report.accepted++;
                if (previous) report.maxAcceptedGapMs = Math.max(report.maxAcceptedGapMs, sample.timestamp - previous.timestamp);
                previous = sample;
                if (sample.routeId !== undefined && sample.routeId !== offRoute.routeId) offRoute = {};
                offRoute = { ...rules.evaluateOffRoute(offRoute, sample), routeId: sample.routeId };
                if (offRoute.shouldReroute) {
                    report.rerouteRequests++;
                    if (typeof sample.expectedOffRoute === 'boolean') {
                        report.labelledRerouteRequests++;
                        if (!sample.expectedOffRoute) report.falseRerouteRequests++;
                    }
                }
            }
            report.decisions.push({ timestamp: sample.timestamp, accepted: fix.accepted,
                reason: fix.reason, reroute: fix.accepted && !!offRoute.shouldReroute });
        }
        // Unlabelled samples cannot establish a false-reroute rate.
        report.falseRerouteRate = report.labelledRerouteRequests
            ? report.falseRerouteRequests / report.labelledRerouteRequests : null;
        return report;
    }
    function createRecorder(limit = 14400) {
        let active = false;
        let samples = [];
        let dropped = 0;
        return {
            start() { samples = []; dropped = 0; active = true; },
            stop() { active = false; },
            get active() { return active; },
            add(sample) {
                if (!active) return;
                if (typeof window !== 'undefined' && window.DriveArchive) window.DriveArchive.record('sample', sample);
                if (samples.length >= limit) { dropped++; return; }
                // Copy primitives so later route/GPS updates cannot mutate history.
                samples.push({ ...sample });
            },
            annotate(timestamp, fields) {
                if (active && typeof window !== 'undefined' && window.DriveArchive) window.DriveArchive.record('match', { timestamp, ...fields });
                const last = samples[samples.length - 1];
                if (active && last && last.timestamp === timestamp) Object.assign(last, fields);
            },
            export() { return { version: 1, type: 'solarless-drive-quality', dropped,
                samples: samples.map(sample => ({ ...sample })) }; }
        };
    }
    return { replay, createRecorder };
});
