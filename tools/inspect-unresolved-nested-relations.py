#!/usr/bin/env python3
"""Read nested member relations from the same immutable regional OSM PBF."""
import json
import os
import sys
from collections import Counter

import osmium


def main(workspace, region):
    review_file = os.path.join(workspace, 'multipolygon-followup-review.jsonl')
    with open(review_file, encoding='utf8') as source:
        rows = [json.loads(line) for line in source if line.strip()]
    parents = [r for r in rows if r['region'] == region and any(m['type'] == 'relation' for m in r['members'])]
    wanted = {m['id'] for r in parents for m in r['members'] if m['type'] == 'relation'}
    nested = {}
    pbf = os.path.join(workspace, region, 'latest.osm.pbf')
    for item in osmium.FileProcessor(pbf, entities=osmium.osm.RELATION):
        if item.id in wanted:
            nested[item.id] = {'id': item.id, 'tags': {t.k: t.v for t in item.tags},
                'members': [{'type': {'w': 'way', 'n': 'node', 'r': 'relation'}[m.type], 'id': m.ref, 'role': m.role} for m in item.members]}
    directory = os.path.join(workspace, f'multipolygon-followup-{region}')
    with open(os.path.join(directory, 'nested-relations.jsonl'), 'w', encoding='utf8', newline='\n') as target:
        for row in nested.values(): target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'region': region, 'parents': len(parents), 'requestedNested': len(wanted),
                      'found': len(nested), 'missing': sorted(wanted - nested.keys()),
                      'nestedTypes': dict(Counter(x['tags'].get('type', '') for x in nested.values()))}), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit('Expected workspace and region')
    main(*sys.argv[1:])
