#!/usr/bin/env python3
"""Keep only disjoint relation components without independently tagged outers.

The complete original multipolygon is assembled first.  This filter never
deletes existing ways, and rejects a candidate if its tagged outlines cannot be
located and validated in the exact source node index.
"""
import json
import os
import sys
from collections import Counter

import numpy as np
from shapely.geometry import LineString, MultiPolygon, Polygon, mapping, shape
from shapely import union_all


def lines(file):
    with open(file, encoding='utf8') as source:
        return [json.loads(line) for line in source if line.strip()]


def main(directory, node_file, workspace=None, region=None):
    rels = {r['id']: r for r in lines(os.path.join(directory, 'building-relations.jsonl'))}
    ways = {w['id']: w for w in lines(os.path.join(directory, 'member-ways.jsonl'))}
    dtype = np.dtype([('id', '<u8'), ('lat', '<i4'), ('lng', '<i4')])
    index = np.memmap(node_file, dtype=dtype, mode='r')
    shared = set()
    if workspace and region:
        original_dir = os.path.join(workspace, f'multipolygon-{region}')
        recheck_dir = os.path.join(workspace, f'multipolygon-recheck-{region}')
        applied = set()
        for base in (original_dir, recheck_dir):
            blocked = {r['id'] for r in lines(os.path.join(base, 'overlay-blocked.jsonl'))}
            applied.update(r['id'] for r in lines(os.path.join(base, 'scene-relations.jsonl')) if r['id'] not in blocked)
        for rel in lines(os.path.join(original_dir, 'building-relations.jsonl')):
            if rel['id'] in applied:
                shared.update(m['id'] for m in rel['members'] if m['type'] == 'way')
    filename = os.path.join(directory, 'assembled-buildings.jsonl')
    rows = lines(filename)
    decisions, selected, stats = [], [], Counter()
    for row in rows:
        rel = rels[row['id']]
        excluded_shared = set()
        try:
            tagged = []
            for way_id in rel['preserveWayIds']:
                refs = np.asarray(ways[way_id]['refs'], dtype=np.uint64)
                positions = np.searchsorted(index['id'], refs)
                if np.any(positions >= len(index)) or np.any(index['id'][positions] != refs):
                    raise ValueError('tagged_outer_missing_nodes')
                coords = index[positions]
                poly = Polygon([(float(c['lng']) / 1e7, float(c['lat']) / 1e7) for c in coords])
                if not poly.is_valid or poly.is_empty or poly.area <= 0:
                    raise ValueError('invalid_tagged_outer_geometry')
                tagged.append(poly)
            tagged_union = union_all(tagged)
            geom = shape(row['geometry'])
            shared_lines = []
            for member in rel['members']:
                if member['type'] != 'way' or member['id'] not in shared: continue
                refs = np.asarray(ways[member['id']]['refs'], dtype=np.uint64)
                positions = np.searchsorted(index['id'], refs)
                if np.any(positions >= len(index)) or np.any(index['id'][positions] != refs):
                    raise ValueError('shared_way_missing_nodes')
                coords = index[positions]
                shared_lines.append((member['id'], LineString([(float(c['lng']) / 1e7, float(c['lat']) / 1e7) for c in coords])))
            eligible = []
            for part in geom.geoms:
                overlapping = [ident for ident, line in shared_lines if part.boundary.intersection(line).length > 1e-12]
                excluded_shared.update(overlapping)
                if not overlapping and part.intersection(tagged_union).area <= max(part.area * 1e-12, 1e-22):
                    eligible.append(part)
            if not eligible:
                raise ValueError('shared_prior_way_or_no_disjoint_component' if excluded_shared else 'no_disjoint_component')
            filtered = MultiPolygon(eligible)
            if not filtered.is_valid or filtered.is_empty:
                raise ValueError('invalid_filtered_geometry')
            if row['replaceWayIds']:
                raise ValueError('existing_way_would_be_removed')
            selected.append({**row, 'geometry': mapping(filtered)})
            decisions.append({'id': row['id'], 'status': 'component_selected', 'selectedComponents': len(eligible),
                              'allComponents': len(geom.geoms), 'retainedTaggedWayIds': rel['preserveWayIds'],
                              'excludedSharedWayIds': sorted(excluded_shared)})
            stats['selected'] += 1
            stats['selected_components'] += len(eligible)
            stats['retained_components'] += len(geom.geoms) - len(eligible)
        except ValueError as error:
            decisions.append({'id': row['id'], 'status': 'unresolved', 'reason': str(error),
                              'excludedSharedWayIds': sorted(excluded_shared)})
            stats[str(error)] += 1
    with open(os.path.join(directory, 'assembled-buildings-full.jsonl'), 'w', encoding='utf8', newline='\n') as target:
        for row in rows: target.write(json.dumps(row, separators=(',', ':')) + '\n')
    with open(filename, 'w', encoding='utf8', newline='\n') as target:
        for row in selected: target.write(json.dumps(row, separators=(',', ':')) + '\n')
    with open(os.path.join(directory, 'component-decisions.jsonl'), 'w', encoding='utf8', newline='\n') as target:
        for row in decisions: target.write(json.dumps(row, separators=(',', ':')) + '\n')
    print(json.dumps(stats), flush=True)


if __name__ == '__main__':
    if len(sys.argv) not in (3, 5): raise SystemExit('Expected audit directory, nodes.bin and optional workspace and region')
    main(*sys.argv[1:])
