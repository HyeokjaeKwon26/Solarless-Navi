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
                offRoute = { ...rules.evaluateOffRoute(offRoute, {...sample,
                    uncertain: sample.uncertain === true || ['ambiguous','nearby-road-conflict','reacquiring','motion-conflict'].includes(sample.snapReason)}), routeId: sample.routeId };
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
    function review(recording) {
        const events = (recording.events || []).slice().sort((a,b) => a.recordedAt - b.recordedAt);
        const matches = new Map(events.filter(e => e.type === 'match' && e.data).map(e => [e.data.timestamp, e.data]));
        const samples = (recording.samples || []).map(sample => ({ ...sample, ...matches.get(sample.timestamp) })).sort((a,b) => a.timestamp-b.timestamp);
        const labelled = samples.filter(sample => typeof sample.snapped === 'boolean');
        const nativeTimes = events.filter(e => e.type === 'native-location' && Number.isFinite(e.data?.timestamp)).map(e => e.data.timestamp).sort((a,b)=>a-b);
        const report = { samples: samples.length, matched: labelled.filter(sample => sample.snapped).length,
            uncertain: labelled.filter(sample => !sample.snapped).length, unlabelled: samples.length-labelled.length,
            nativeSamples: nativeTimes.length, maxNativeGpsGapSec: 0,
            maxGpsGapSec: 0, rerouteLatencySec: [], failedReroutes: 0, cancelledReroutes: 0, etaErrorsSec: [], solarPredictions: [], fieldSolarBenefit: null };
        for (let i=1;i<nativeTimes.length;i++) report.maxNativeGpsGapSec=Math.max(report.maxNativeGpsGapSec,(nativeTimes[i]-nativeTimes[i-1])/1000);
        for (let i=1;i<samples.length;i++) if (Number.isFinite(samples[i].timestamp) && Number.isFinite(samples[i-1].timestamp)) report.maxGpsGapSec=Math.max(report.maxGpsGapSec,(samples[i].timestamp-samples[i-1].timestamp)/1000);
        const requests=new Map(), trips=new Map(), redirected=new Set();
        for (const event of events) {
            const data=event.data || {};
            if (!Number.isFinite(event.recordedAt)) continue;
            // A stopped/restarted recording cannot measure an entire journey.
            if (event.type==='recording-stop' || event.type==='recording-start') trips.clear();
            if (event.type==='reroute-start') requests.set(data.id,event.recordedAt);
            if (event.type==='reroute-ready' && requests.has(data.id)) {
                const seconds=(event.recordedAt-requests.get(data.id))/1000;
                if (seconds>=0) report.rerouteLatencySec.push(seconds);
                requests.delete(data.id);
            }
            if (event.type==='reroute-failed') { report.failedReroutes++; requests.delete(data.id); }
            if (event.type==='reroute-cancelled') { report.cancelledReroutes++; requests.delete(data.id); }
            if (event.type==='trip-start') {
                trips.set(data.id,{...data,at:event.recordedAt});
                if(data.solar) report.solarPredictions.push({tripId:data.id,...data.solar,predictionOnly:true});
            }
            if (event.type==='trip-redirect') redirected.add(data.id);
            if (event.type==='trip-end' && data.arrived && trips.has(data.id) && !redirected.has(data.id)) {
                const trip=trips.get(data.id), elapsed=(event.recordedAt-trip.at)/1000;
                if (Number.isFinite(trip.predictedDurationSec) && trip.predictedDurationSec>0 && elapsed>=0) report.etaErrorsSec.push(elapsed-trip.predictedDurationSec);
                trips.delete(data.id);
            }
            if (event.type==='trip-end') trips.delete(data.id);
        }
        report.meanAbsoluteEtaErrorSec=report.etaErrorsSec.length?report.etaErrorsSec.reduce((sum,n)=>sum+Math.abs(n),0)/report.etaErrorsSec.length:null;
        report.pendingReroutes=requests.size;
        return report;
    }
    return { replay, createRecorder, review };
});
