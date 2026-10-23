const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { replay } = require('../js/drive-quality.js');
const input = process.argv[2];
if (!input) throw new Error('Usage: npm run replay:drive -- drive.json [report.json]');
const recording = JSON.parse(fs.readFileSync(input, 'utf8'));
if (![1, 2].includes(recording.version) || !Array.isArray(recording.samples)) throw new Error('Unsupported drive recording');
const sandbox = { window: {}, console, Math, Date, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shadow-router.js'), 'utf8'), sandbox);
const annotations = new Map((recording.events || []).filter(e => e.type === 'match').map(e => [e.data.timestamp, e.data]));
const samples = recording.samples.map(s => ({ ...s, ...(annotations.get(s.timestamp) || {}) }));
const report = replay(samples, sandbox.window.ShadowRouter.calculateDistanceMeters);
const nativeSamples = (recording.events || []).filter(e => e.type === 'native-location').map(e => ({
    ...e.data, receivedAt: e.recordedAt, accuracy: e.data.accuracy68 > 0 ? e.data.accuracy68 * 1.62 : Infinity,
    reportedSpeedKmh: e.data.speedMps >= 0 ? e.data.speedMps * 3.6 : null
})).sort((a,b) => a.timestamp - b.timestamp);
// Keep native observations separate from WebView duplicates. Without labelled
// road truth this reports fix quality, not a claimed route-correctness score.
report.nativeFixQuality = replay(nativeSamples, sandbox.window.ShadowRouter.calculateDistanceMeters);
delete report.nativeFixQuality.decisions;
const guidance = require('../js/navigation-guidance.js');
const routeEvents = (recording.events || []).filter(e => e.type === 'route' && e.data.coordinates?.length >= 2).sort((a,b) => a.recordedAt-b.recordedAt);
let routeIndex=-1, previous=null;
report.nativeRouteReplay = { matched:0, uncertain:0, missingRoute:0 };
for (const sample of nativeSamples) {
    while(routeIndex+1<routeEvents.length && routeEvents[routeIndex+1].recordedAt<=sample.receivedAt) { routeIndex++; previous=null; }
    if(routeIndex<0) {report.nativeRouteReplay.missingRoute++;continue;}
    const data=routeEvents[routeIndex].data;
    if(!data._route) data._route={analyzed:{coordinates:data.coordinates},maneuvers:data.maneuvers||[],distanceMeters:data.distanceMeters};
    if(sample.accuracy>35||sample.receivedAt-sample.timestamp>10000) {report.nativeRouteReplay.uncertain++;continue;}
    const snap=guidance.match(data._route,{...sample,speedKmh:sample.reportedSpeedKmh,heading:sample.heading>=0?sample.heading:NaN},previous);
    if(snap.isSnapped){report.nativeRouteReplay.matched++;previous=snap;}else report.nativeRouteReplay.uncertain++;
}
report.dropped = recording.dropped || 0;
report.retention = recording.retention || 'memory';
report.routeChanges = (recording.events || []).filter(e => e.type === 'route').length;
report.voiceEvents = (recording.events || []).filter(e => e.type === 'voice').length;
report.voiceRequests = (recording.events || []).filter(e => e.type === 'voice' && e.data.status === 'requested').length;
report.voiceAccepted = (recording.events || []).filter(e => e.type === 'voice' && (e.data.status === 'accepted' || e.data.source === 'native-background')).length;
report.voiceDenied = (recording.events || []).filter(e => e.type === 'voice' && e.data.status === 'denied').length;
report.nativeLocationEvents = (recording.events || []).filter(e => e.type === 'native-location').length;
const json = JSON.stringify(report, null, 2) + '\n';
if (process.argv[3]) fs.writeFileSync(process.argv[3], json);
else process.stdout.write(json);
