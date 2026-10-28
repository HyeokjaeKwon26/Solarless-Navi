#!/usr/bin/env python3
"""Avoid adding equivalent relation geometry twice in the same overlay."""
import json
import os
import sys
from shapely.geometry import shape
from shapely.strtree import STRtree

def lines(file):
    with open(file, encoding='utf8') as source: return [json.loads(line) for line in source if line.strip()]

def main(workspace, region):
    directory = os.path.join(workspace, f'multipolygon-followup-{region}')
    node_dir = os.path.join(workspace, f'multipolygon-outer-node-{region}')
    scene_file = os.path.join(directory, 'scene-relations.jsonl')
    scene = lines(scene_file)
    ids = {r['id'] for r in scene}
    records = [r for filename in (os.path.join(directory, 'assembled-buildings.jsonl'), os.path.join(node_dir, 'assembled-buildings.jsonl'))
               for r in lines(filename) if r['id'] in ids]
    if len(records) != len(scene): raise ValueError('Missing candidate geometry')
    records.sort(key=lambda r: r['id'])
    geometries = [shape(r['geometry']) for r in records]
    tree = STRtree(geometries)
    structural = ('height', 'building:levels', 'min_height', 'building:min_level', 'building:part')
    duplicates = {}
    for i, geom in enumerate(geometries):
        if records[i]['id'] in duplicates: continue
        for j in sorted(int(x) for x in tree.query(geom) if int(x) > i):
            if records[j]['id'] in duplicates: continue
            other = geometries[j]
            if geom.intersection(other).area <= max(min(geom.area, other.area) * 1e-9, 1e-22): continue
            equal_heights = all(records[i]['tags'].get(k) == records[j]['tags'].get(k) for k in structural)
            if not geom.equals(other) or not equal_heights:
                raise ValueError(f"Overlapping candidate relations require review: {records[i]['id']} {records[j]['id']}")
            duplicates[records[j]['id']] = records[i]['id']
    with open(scene_file, 'w', encoding='utf8', newline='\n') as target:
        for row in scene:
            if row['id'] not in duplicates: target.write(json.dumps(row, separators=(',', ':')) + '\n')
    with open(os.path.join(directory, 'dedup-decisions.jsonl'), 'w', encoding='utf8', newline='\n') as target:
        for ident, equivalent in duplicates.items():
            target.write(json.dumps({'id': ident, 'status': 'equivalent_selected_geometry', 'representedByRelationId': equivalent}) + '\n')
    filename = os.path.join(directory, 'scene-preparation-audit.json')
    with open(filename, encoding='utf8') as source: prep = json.load(source)
    removed = [r for r in scene if r['id'] in duplicates]
    prep['equivalent_relations_not_duplicated'] = len(removed)
    prep['relations'] -= len(removed)
    prep['pieces'] -= sum(len(r['pieces']) for r in removed)
    prep['relations_with_holes'] -= sum(any(poly.interiors for poly in geometries[next(i for i, r in enumerate(records) if r['id'] == row['id'])].geoms) for row in removed)
    with open(filename, 'w', encoding='utf8') as target: json.dump(prep, target, indent=2)
    print(json.dumps({'region': region, 'duplicates': duplicates, 'appliedCandidates': len(scene)-len(duplicates)}), flush=True)

if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit('Expected workspace and region')
    main(*sys.argv[1:])
