import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const SceneShadow = require('../js/scene-shadow.js');

const samples = [];
for (let x = 0; x < 225; x++) {
    for (let y = 0; y < 200; y++) samples.push({ x: x * 100, y: y * 100, elevation: 50 + ((x + y) % 200) });
}
const queries = Array.from({ length: 735 }, (_, index) => ({
    x: (index * 31) % 22400,
    y: (index * 47) % 19900
}));

function measure(label, task) {
    const started = performance.now();
    const value = task();
    const elapsed = performance.now() - started;
    console.log(`${label}: ${elapsed.toFixed(1)} ms`);
    return { value, elapsed };
}

const linear = measure('linear nearest lookup (45,000 samples × 735)', () =>
    queries.map(point => SceneShadow.findNearestTerrainSample(point, samples, Infinity)));
const grid = SceneShadow.buildTerrainGrid(samples);
const indexed = measure('grid nearest lookup (45,000 samples × 735)', () =>
    queries.map(point => SceneShadow.findNearestTerrainSample(point, samples, Infinity, grid)));

for (let index = 0; index < queries.length; index++) {
    if (linear.value[index].sample !== indexed.value[index].sample || linear.value[index].distance !== indexed.value[index].distance) {
        throw new Error(`nearest-sample parity failed at query ${index}`);
    }
}
console.log(`speedup: ${(linear.elapsed / Math.max(0.001, indexed.elapsed)).toFixed(1)}x; grid cells: ${Object.keys(grid.cells).length}`);
