#!/usr/bin/env node
// Combine independently completed regional runs in the baseline case order.
const fs = require('node:fs');
const path = require('node:path');
const [workspaceArg, outputArg] = process.argv.slice(2);
if (!workspaceArg || !outputArg) throw new Error('Expected working directory and output path');
const workspace = path.resolve(workspaceArg);
const old = JSON.parse(fs.readFileSync(path.join(workspace, 'us-route-baseline.json')));
const ids = ['us-northeast', 'us-midwest', 'us-south', 'us-west'];
const regional = ids.map(id => JSON.parse(fs.readFileSync(path.join(workspace, `us-route-new-${id}.json`))));
const rows = new Map(), tags = {};
for (let i = 0; i < ids.length; i++) {
    const r = regional[i], id = ids[i];
    if (r.version !== 'new' || r.rows.length !== 12 || r.rows.some(row => row.region !== id) ||
        JSON.stringify(r.codeHashes) !== JSON.stringify(old.codeHashes) ||
        JSON.stringify(r.runtimeHashes) !== JSON.stringify(old.runtimeHashes) || r.candidateSha256 !== old.candidateSha256) {
        throw new Error(`Inconsistent regional comparison: ${id}`);
    }
    tags[id] = r.tags[id];
    for (const row of r.rows) {
        const key = `${row.id}:${row.timeCase}`;
        if (rows.has(key)) throw new Error(`Duplicate route case: ${key}`);
        rows.set(key, row);
    }
}
const ordered = old.rows.map(row => {
    const key = `${row.id}:${row.timeCase}`;
    if (!rows.has(key)) throw new Error(`Missing route case: ${key}`);
    return rows.get(key);
});
if (ordered.length !== 48 || rows.size !== 48) throw new Error('Unexpected route case count');
fs.writeFileSync(path.resolve(outputArg), JSON.stringify({ version: 'new', generatedAt: new Date().toISOString(), tags,
    codeHashes: old.codeHashes, runtimeHashes: old.runtimeHashes, candidateFile: old.candidateFile,
    candidateSha256: old.candidateSha256, rows: ordered }, null, 2));
console.log(`Combined ${ordered.length} paired route cases`);
