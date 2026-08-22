#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function finite(value) {
    return Number.isFinite(Number(value));
}

export function validateLooseSceneTiles(inputDir, options = {}) {
    const root = path.resolve(inputDir);
    const manifestFile = path.join(root, 'manifest.json');
    if (!fs.existsSync(manifestFile)) throw new Error(`manifest not found: ${manifestFile}`);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const expectedSchema = Number(options.schema || manifest.schemaVersion || manifest.schema);
    const expectedVersion = String(options.dataVersion || manifest.dataVersion || '');
    const terrainErrorM = Number(manifest.uncertaintyModel?.terrain?.relativeVerticalErrorM);
    const entries = Array.isArray(manifest.tiles) ? manifest.tiles : [];
    if (!entries.length) throw new Error('manifest has no tiles');

    const actualFiles = fs.readdirSync(root).filter(name => name.endsWith('.json') && name !== 'manifest.json');
    const expectedFiles = new Set(entries.map(entry => String(entry.path)));
    const actualSet = new Set(actualFiles);
    const stats = {
        tiles: 0,
        buildings: 0,
        tunnels: 0,
        terrainSamples: 0,
        adjustedMinHeights: 0,
        invalidMinHeightEnvelopes: 0,
        missingBuildingGround: 0,
        duplicateBuildingIds: 0,
        parseErrors: 0,
        metadataErrors: 0,
        missingFiles: [...expectedFiles].filter(file => !actualSet.has(file)).length,
        extraFiles: [...actualSet].filter(file => !expectedFiles.has(file)).length,
        bytes: 0
    };

    for (const entry of entries) {
        const fileName = String(entry.path || '');
        const file = path.resolve(root, fileName);
        if (path.dirname(file) !== root || !fs.existsSync(file)) continue;
        let tile;
        try {
            tile = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            stats.parseErrors++;
            continue;
        }
        stats.tiles++;
        stats.bytes += fs.statSync(file).size;
        const buildings = Array.isArray(tile.buildings) ? tile.buildings : [];
        const tunnels = Array.isArray(tile.tunnels) ? tile.tunnels : [];
        const terrain = Array.isArray(tile.terrain) ? tile.terrain : [];
        stats.buildings += buildings.length;
        stats.tunnels += tunnels.length;
        stats.terrainSamples += terrain.length;

        if (Number(tile.schemaVersion || tile.schema) !== expectedSchema
            || tile.dataVersion !== expectedVersion
            || tile.key !== entry.key
            || tile.region !== manifest.region
            || Number(tile.uncertaintyModel?.terrainRelativeVerticalErrorM) !== terrainErrorM
            || tile.source?.osmPbfSha256 !== manifest.osmPbfSha256
            || buildings.length !== Number(entry.buildings)
            || tunnels.length !== Number(entry.tunnels)
            || terrain.length !== Number(entry.terrain)) {
            stats.metadataErrors++;
        }

        const ids = new Set();
        for (const building of buildings) {
            if (ids.has(building.id)) stats.duplicateBuildingIds++;
            ids.add(building.id);
            if (!finite(building.ground)) stats.missingBuildingGround++;
            if (building.minHeightAdjusted) stats.adjustedMinHeights++;
            const validEnvelope = finite(building.height)
                && finite(building.heightLower)
                && finite(building.heightUpper)
                && finite(building.minHeight)
                && finite(building.minHeightLower)
                && finite(building.minHeightUpper)
                && Number(building.minHeight) <= Number(building.height)
                && Number(building.minHeightLower) <= Number(building.heightLower)
                && Number(building.minHeightUpper) <= Number(building.heightUpper);
            if (!validEnvelope) stats.invalidMinHeightEnvelopes++;
        }
        const expectedGroundCoverage = buildings.every(building => finite(building.ground));
        if (Boolean(tile.sceneCoverage?.buildingGround) !== expectedGroundCoverage) stats.metadataErrors++;
    }

    const failures = stats.missingFiles + stats.extraFiles + stats.parseErrors
        + stats.metadataErrors + stats.invalidMinHeightEnvelopes
        + stats.missingBuildingGround + stats.duplicateBuildingIds;
    return { ok: failures === 0 && stats.tiles === entries.length, manifest, stats, failures };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    const inputDir = process.argv[2] || process.env.SCENE_INPUT_DIR;
    if (!inputDir) {
        console.error('Usage: node tools/validate-loose-scene-tiles.mjs <generated-directory>');
        process.exit(2);
    }
    const result = validateLooseSceneTiles(inputDir);
    console.log(JSON.stringify({ ok: result.ok, stats: result.stats }, null, 2));
    if (!result.ok) process.exitCode = 1;
}
