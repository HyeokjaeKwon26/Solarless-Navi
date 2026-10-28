#!/usr/bin/env python3
"""Resolve relation member way IDs/tags without reading every way into Python.

Requires pyosmium 4.3.2. The JSONL relation input is produced by
audit-scene-multipolygons.cjs from the same PBF.
"""
import json
import os
import sys
from collections import Counter

import osmium


def main(pbf, relations_path, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    with open(relations_path, encoding='utf-8') as source:
        relations = [json.loads(line) for line in source if line.strip()]
    wanted = {int(m['id']) for rel in relations for m in rel['members'] if m['type'] == 'way'}
    print(f'loaded {len(relations)} multipolygons; {len(wanted)} member ways', flush=True)
    ways = {}
    processor = osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(osmium.filter.IdFilter(wanted))
    for way in processor:
        ways[way.id] = {'id': way.id, 'tags': dict(way.tags), 'refs': [node.ref for node in way.nodes]}
        if len(ways) % 100000 == 0:
            print(f'matched {len(ways)} member ways', flush=True)
    stats = Counter(total_multipolygons=len(relations), member_way_ids=len(wanted), member_ways_found=len(ways))
    chosen = []
    selected_ids = set()
    # Building-tagged relations are direct candidates. For the historical
    # outer-tagged form only accept otherwise unclassified relations; an
    # outer tagged as a different area could describe an independent feature.
    area_keys = {'landuse', 'natural', 'leisure', 'water', 'waterway', 'amenity', 'man_made', 'highway', 'boundary', 'aeroway'}
    for rel in relations:
        tags = rel['tags']
        outer = [m for m in rel['members'] if m['type'] == 'way' and m['role'] in ('outer', '')]
        tagged_outer = [ways[m['id']] for m in outer if m['id'] in ways and
                        (ways[m['id']]['tags'].get('building') not in (None, 'no') or
                         ways[m['id']]['tags'].get('building:part') not in (None, 'no'))]
        rel_building = tags.get('building') not in (None, 'no') or tags.get('building:part') not in (None, 'no')
        if rel_building:
            rel['candidateKind'] = 'relation-tagged'
        elif ('building' not in tags and 'building:part' not in tags and tagged_outer and
              not any(key in tags for key in area_keys)):
            rel['candidateKind'] = 'outer-tagged-legacy'
        else:
            if tagged_outer:
                stats['noncandidate_with_tagged_outer'] += 1
            continue
        stats[rel['candidateKind']] += 1
        stats['candidate_with_tagged_outer'] += int(bool(tagged_outer))
        stats['candidate_with_inner'] += int(any(m['role'] == 'inner' for m in rel['members']))
        stats['candidate_with_missing_way'] += int(any(m['type'] == 'way' and m['id'] not in ways for m in rel['members']))
        chosen.append(rel)
        selected_ids.update(m['id'] for m in rel['members'] if m['type'] == 'way')
    with open(os.path.join(output_dir, 'building-relations.jsonl'), 'w', encoding='utf-8', newline='\n') as target:
        for rel in chosen:
            target.write(json.dumps(rel, separators=(',', ':')) + '\n')
    with open(os.path.join(output_dir, 'member-ways.jsonl'), 'w', encoding='utf-8', newline='\n') as target:
        for way_id in sorted(selected_ids):
            if way_id in ways:
                target.write(json.dumps(ways[way_id], separators=(',', ':')) + '\n')
    stats['candidate_total'] = len(chosen)
    stats['selected_member_ways_found'] = sum(way_id in ways for way_id in selected_ids)
    with open(os.path.join(output_dir, 'member-audit.json'), 'w', encoding='utf-8') as target:
        json.dump(stats, target, indent=2)
    print(json.dumps(stats), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Expected source PBF, relation JSONL and output directory')
    main(*sys.argv[1:])
