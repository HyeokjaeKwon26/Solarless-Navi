#!/usr/bin/env node
// Extract multipolygon relation members from the exact regional PBF used by
// the current scene release. Geometry is resolved in a separate pass.
const fs = require('node:fs');
const path = require('node:path');
const parseOSM = require('osm-pbf-parser');

async function scan(pbf, output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const fd = fs.openSync(output, 'w');
    let buffer = '', relationCount = 0, taggedBuilding = 0, negativeBuilding = 0, totalRelations = 0;
    const flush = () => { if (buffer) { fs.writeSync(fd, buffer); buffer = ''; } };
    try {
        await new Promise((resolve, reject) => {
            const parser = parseOSM();
            parser.on('data', batch => {
                try {
                    for (const item of batch) {
                        if (item.type !== 'relation') continue;
                        totalRelations++;
                        if (item.tags?.type !== 'multipolygon') continue;
                        relationCount++;
                        const tags = item.tags || {};
                        if (tags.building || tags['building:part']) {
                            taggedBuilding++;
                            if (tags.building === 'no' || tags['building:part'] === 'no') negativeBuilding++;
                        }
                        buffer += JSON.stringify({ id: item.id, tags, members: item.members || [] }) + '\n';
                        if (buffer.length >= 1024 * 1024) flush();
                        if (relationCount % 100000 === 0) console.log(`multipolygon relations: ${relationCount}`);
                    }
                } catch (error) { parser.destroy(error); }
            });
            parser.once('error', reject);
            parser.once('end', resolve);
            fs.createReadStream(pbf).once('error', reject).pipe(parser);
        });
        flush();
    } finally { fs.closeSync(fd); }
    const summary = { pbf: path.resolve(pbf), totalRelations, multipolygons: relationCount, taggedBuilding, negativeBuilding };
    fs.writeFileSync(output + '.summary.json', JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
}

if (process.argv.length !== 4) throw new Error('Expected PBF file and relation JSONL output');
scan(path.resolve(process.argv[2]), path.resolve(process.argv[3])).catch(error => { console.error(error); process.exitCode = 1; });
