const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reportTool = fs.readFileSync(
    path.join(__dirname, '..', 'tools', 'simulate-us-solar-routes.mjs'),
    'utf8'
);

test('simulation report source stays UTF-8 and documents the production comparison scope', () => {
    // Keep the corrupt byte-decoding remnants expressed as escapes so this
    // regression test does not itself reintroduce visible mojibake into rg or
    // repository-wide encoding audits.
    const knownMojibake = [
        '\uFFFD',
        '\u73e5\ub348\uc909',
        '\u8a98\uba78\ub385',
        `m\uc9fc`,
        `\uc3f1ost-hoc`,
        `origin?\ubc3aestination`,
        `Wh/m\uc9fc. ?\uc3f1ost-hoc best?` + `?selects`
    ];
    for (const marker of knownMojibake) {
        assert.equal(reportTool.includes(marker), false, `unexpected mojibake marker: ${marker}`);
    }

    assert.match(reportTool, /production app's direct-plus-via OSRM flow/);
    assert.match(reportTool, /at most two bounded lateral via-point requests/);
    assert.match(reportTool, /1\.60× fastest-duration ceiling/);
    assert.match(reportTool, /uncertainty never creates an artificial solar-reduction benefit/);
    assert.match(reportTool, /GPS-position contribution to ETA/);
    assert.match(reportTool, /OpenStreetMap contributors/);
    assert.match(reportTool, /Geolocation API: accuracy is a 95% confidence level/);
});

test('simulation rows and metadata retain uncertainty and release provenance', () => {
    assert.match(reportTool, /shadeUncertainPct:\s*100 \* pct\(shadeAnalysis\.uncertainOcclusionTimeRatio\)/);
    assert.match(reportTool, /sceneReleases:\s*sceneReleaseInfo/);
    assert.match(reportTool, /candidateStrategy:\s*'app-direct-plus-via-v1'/);
    assert.match(reportTool, /cache\.routeStrategies\[scenario\.id\] === candidateStrategy/);
    assert.match(reportTool, /schema:\s*2/);
});
