#!/usr/bin/env python3
"""Assemble audited OSM building relations using libosmium and validate geometry.

Inputs are the member audit and the sorted node index from the scene builder.
Requires pyosmium 4.3.2, Shapely 2.1.2 and NumPy. The output retains holes;
the scene writer must preserve them rather than treating them as solid.
"""
import json
import os
import sys
from collections import Counter

import numpy as np
import osmium
from shapely.geometry import shape, mapping


def load_lines(file):
    with open(file, encoding='utf-8') as source:
        return [json.loads(line) for line in source if line.strip()]


def building_value(tags, key):
    value = tags.get(key)
    return value if value not in (None, '', 'no') else None


def relation_tags_and_overlap(rel, ways):
    tags = dict(rel['tags'])
    tagged = []
    for member in rel['members']:
        if member['type'] != 'way' or member['role'] not in ('outer', ''):
            continue
        way = ways.get(member['id'])
        if way and (building_value(way['tags'], 'building') or building_value(way['tags'], 'building:part')):
            tagged.append(way)
    keys = ('building', 'building:part', 'height', 'building:levels', 'min_height', 'building:min_level')
    if rel['candidateKind'] == 'outer-tagged-legacy':
        signatures = {tuple((key, way['tags'].get(key)) for key in keys) for way in tagged}
        if len(signatures) != 1:
            return None, [], 'conflicting_legacy_outer_tags'
        for key in keys:
            if key in tagged[0]['tags']:
                tags[key] = tagged[0]['tags'][key]
    # A way tagged as its own building can be an independent feature. Only
    # replace it when its structural tags are compatible with the relation.
    for way in tagged:
        wt = way['tags']
        for key in keys:
            if key not in wt:
                continue
            rel_value, way_value = tags.get(key), wt[key]
            if key == 'building' and rel_value and way_value and 'yes' in (rel_value, way_value):
                continue
            if rel_value != way_value:
                return None, [], 'conflicting_tagged_outer'
    return tags, [way['id'] for way in tagged], None


def main(audit_dir, node_index, manifest_path):
    rels = load_lines(os.path.join(audit_dir, 'building-relations.jsonl'))
    ways = {w['id']: w for w in load_lines(os.path.join(audit_dir, 'member-ways.jsonl'))}
    with open(manifest_path, encoding='utf-8') as source:
        manifest = json.load(source)
    with open(node_index + '.meta.json', encoding='utf-8') as source:
        node_meta = json.load(source)
    if node_meta.get('pbfSha256') != manifest.get('osmPbfSha256'):
        raise RuntimeError('Node index belongs to a different OSM extract')
    stats = Counter(candidates=len(rels))
    selected, rejected = [], []
    for rel in rels:
        members = rel['members']
        if not any(m['type'] == 'way' and m['role'] in ('outer', '') for m in members):
            rejected.append((rel['id'], 'no_outer_way')); continue
        if any(m['type'] != 'way' or m['role'] not in ('outer', 'inner', '') for m in members):
            rejected.append((rel['id'], 'unsupported_member_or_role')); continue
        if any(m['id'] not in ways or len(ways[m['id']]['refs']) < 2 for m in members):
            rejected.append((rel['id'], 'missing_or_short_member_way')); continue
        tags, remove_way_ids, error = relation_tags_and_overlap(rel, ways)
        if error:
            rejected.append((rel['id'], error)); continue
        selected.append({**rel, 'effectiveTags': tags, 'replaceWayIds': remove_way_ids})
    way_ids = {m['id'] for rel in selected for m in rel['members']}
    node_ids = sorted({ref for way_id in way_ids for ref in ways[way_id]['refs']})
    dtype = np.dtype([('id', '<u8'), ('lat', '<i4'), ('lng', '<i4')])
    index = np.memmap(node_index, dtype=dtype, mode='r')
    target_ids = np.asarray(node_ids, dtype=np.uint64)
    positions = np.searchsorted(index['id'], target_ids)
    valid = positions < len(index)
    valid[valid] = index['id'][positions[valid]] == target_ids[valid]
    missing_nodes = set(target_ids[~valid].tolist())
    if missing_nodes:
        missing_way_ids = {wid for wid in way_ids if any(n in missing_nodes for n in ways[wid]['refs'])}
        kept = []
        for rel in selected:
            if any(m['id'] in missing_way_ids for m in rel['members']): rejected.append((rel['id'], 'missing_member_node'))
            else: kept.append(rel)
        selected = kept
        way_ids = {m['id'] for rel in selected for m in rel['members']}
        node_ids = sorted({ref for way_id in way_ids for ref in ways[way_id]['refs']})
        target_ids = np.asarray(node_ids, dtype=np.uint64)
        positions = np.searchsorted(index['id'], target_ids)
    print(f'assembling {len(selected)} relations from {len(way_ids)} ways and {len(node_ids)} nodes', flush=True)
    mini = os.path.join(audit_dir, 'building-relations.osm.pbf')
    with osmium.SimpleWriter(mini, overwrite=True) as writer:
        for ident, position in zip(node_ids, positions):
            record = index[position]
            writer.add_node(osmium.osm.mutable.Node(id=ident, location=(float(record['lng']) / 1e7, float(record['lat']) / 1e7)))
        for ident in sorted(way_ids):
            w = ways[ident]
            writer.add_way(osmium.osm.mutable.Way(id=ident, nodes=w['refs'], tags=w['tags']))
        for rel in sorted(selected, key=lambda r: r['id']):
            members = [('w', m['id'], m['role'] or 'outer') for m in rel['members']]
            writer.add_relation(osmium.osm.mutable.Relation(id=rel['id'], members=members, tags=rel['effectiveTags']))
    selected_by_id = {rel['id']: rel for rel in selected}
    accepted = set()
    out_path = os.path.join(audit_dir, 'assembled-buildings.jsonl')
    factory = osmium.geom.GeoJSONFactory()

    class AreaReader(osmium.SimpleHandler):
        def __init__(self, target):
            super().__init__(); self.target = target

        def area(self, area):
            if area.from_way(): return
            ident = area.orig_id()
            rel = selected_by_id.get(ident)
            if rel is None: return
            try:
                geom = shape(json.loads(factory.create_multipolygon(area)))
                if geom.is_empty or not geom.is_valid or geom.area <= 0:
                    rejected.append((ident, 'invalid_assembled_geometry')); return
                self.target.write(json.dumps({'id': ident, 'candidateKind': rel['candidateKind'],
                    'tags': rel['effectiveTags'], 'replaceWayIds': rel['replaceWayIds'],
                    'geometry': mapping(geom)}, separators=(',', ':')) + '\n')
                accepted.add(ident)
                stats['polygons'] += len(geom.geoms)
                stats['polygons_with_holes'] += sum(bool(poly.interiors) for poly in geom.geoms)
            except (RuntimeError, ValueError) as error:
                rejected.append((ident, 'geometry_error:' + type(error).__name__))
    with open(out_path, 'w', encoding='utf-8', newline='\n') as target:
        AreaReader(target).apply_file(mini, locations=True)
    already_rejected = {item[0] for item in rejected}
    for rel in selected:
        if rel['id'] not in accepted and rel['id'] not in already_rejected:
            rejected.append((rel['id'], 'libosmium_could_not_assemble'))
    stats['assembled'] = len(accepted)
    for _, reason in rejected: stats[reason] += 1
    if stats['assembled'] + len(rejected) != stats['candidates']:
        raise RuntimeError('Relation accounting mismatch')
    with open(os.path.join(audit_dir, 'assembly-rejected.jsonl'), 'w', encoding='utf-8', newline='\n') as target:
        for ident, reason in rejected: target.write(json.dumps({'id': ident, 'reason': reason}) + '\n')
    with open(os.path.join(audit_dir, 'assembly-audit.json'), 'w', encoding='utf-8') as target:
        json.dump(stats, target, indent=2)
    print(json.dumps(stats), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('Expected audit directory, nodes.bin, and current manifest')
    main(*sys.argv[1:])
