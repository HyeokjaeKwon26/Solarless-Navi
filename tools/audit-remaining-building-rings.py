#!/usr/bin/env python3
"""Review remaining exclusions and salvage independently valid outer rings.

No inner rings are discarded. Nested children must already have complete
previously applied geometry. Other malformed outer members, overlapping outer
rings, shared ways and intersections with nearby scene buildings are excluded.
"""
import importlib.util
import json
import math
import os
import sys
from collections import Counter
from functools import lru_cache

import numpy as np
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely import union_all
from shapely.strtree import STRtree

spec = importlib.util.spec_from_file_location('prepare', os.path.join(os.path.dirname(__file__), 'prepare-scene-multipolygons.py'))
prepare = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare)

def lines(file):
    with open(file, encoding='utf8') as source: return [json.loads(line) for line in source if line.strip()]

def iter_lines(file):
    with open(file, encoding='utf8') as source:
        for line in source:
            if line.strip(): yield json.loads(line)

def write(file, rows):
    with open(file, 'w', encoding='utf8', newline='\n') as target:
        for row in rows: target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')

def independent_rings(polygons, shared, nested_geometries, nearby_overlaps):
    eligible, excluded = [], []
    for wid, poly in polygons:
        reasons = []
        if wid in shared: reasons.append('shared_with_applied_relation')
        if any(wid != other_id and poly.intersection(other).area > max(poly.area * 1e-9, 1e-22) for other_id, other in polygons):
            reasons.append('overlaps_another_outer_ring')
        if any(poly.intersection(child).area > max(poly.area * 1e-9, 1e-22) for child in nested_geometries):
            reasons.append('overlaps_existing_nested_child')
        hits = nearby_overlaps(poly) if not reasons else []
        if hits: reasons.append('overlaps_nearby_scene_building')
        if reasons: excluded.append({'wayId': wid, 'reasons': reasons, 'sceneIds': hits[:12]})
        else: eligible.append((wid, poly))
    return eligible, excluded

def main(workspace):
    previous = [r for r in lines('docs/data/us-multipolygon-unresolved-followup-2026-10-28.jsonl') if r['outcome'] == 'not_added']
    if len(previous) != 472: raise ValueError('Unexpected previous total')
    all_reviews = []
    for region in ('us-northeast', 'us-midwest', 'us-south', 'us-west'):
        original = os.path.join(workspace, f'multipolygon-{region}')
        out = os.path.join(workspace, f'multipolygon-last-{region}'); os.makedirs(out, exist_ok=True)
        relations = {r['id']: r for r in lines(os.path.join(original, 'building-relations.jsonl'))}
        ways = {w['id']: w for w in lines(os.path.join(original, 'member-ways.jsonl'))}
        manifest = json.load(open(os.path.join('data', 'scene', region, 'manifest.json'), encoding='utf8'))
        dtype = np.dtype([('id', '<u8'), ('lat', '<i4'), ('lng', '<i4')])
        index = np.memmap(os.path.join(workspace, f'build-{region}', 'work', 'nodes.bin'), dtype=dtype, mode='r')
        applied, complete, child_pieces = set(), set(), {}
        child_ids = {m['id'] for x in previous if x['region'] == region for m in x['members'] if m['type'] == 'relation'}
        for prefix in ('multipolygon', 'multipolygon-recheck', 'multipolygon-followup'):
            directory = os.path.join(workspace, f'{prefix}-{region}')
            blocked = {r['id'] for r in lines(os.path.join(directory, 'overlay-blocked.jsonl'))}
            for r in iter_lines(os.path.join(directory, 'scene-relations.jsonl')):
                if r['id'] in blocked: continue
                applied.add(r['id'])
                if prefix != 'multipolygon-followup':
                    complete.add(r['id'])
                    # Keep only children referenced by this round's relations.
                    if r['id'] in child_ids:
                        child_pieces[r['id']] = union_all([Polygon([(p[1], p[0]) for p in part['polygon']]) for part in r['pieces']])
        shared = {m['id'] for ident in applied if ident in relations for m in relations[ident]['members'] if m['type'] == 'way'}
        @lru_cache(maxsize=128)
        def tile_buildings(key):
            entry = manifest['tiles'].get(key)
            if entry is None: return []
            for base in (f'multipolygon-followup-{region}/changed-tiles', f'multipolygon-recheck-{region}/changed-tiles',
                         f'multipolygon-{region}/changed-tiles', f'build-{region}/generated'):
                filename = os.path.join(workspace, base, entry['file'])
                if os.path.isfile(filename):
                    with open(filename, encoding='utf8') as source: tile = json.load(source)
                    return [(b['id'], Polygon([(point[1], point[0]) for point in b['polygon']]))
                            for b in tile.get('buildings', []) if len(b.get('polygon', [])) >= 4]
            raise ValueError(f'Missing current baseline tile {key}')
        def nearby_overlaps(poly):
            x, y = map(int, prepare.key_for(poly.centroid.y, poly.centroid.x, manifest['grid']).split(':'))
            hits = []
            # Scene objects are assigned to 5 km tiles by centroid. Search a
            # 25 km square around the candidate; this is not an exhaustive
            # global spatial index for unusually large distant-centred objects.
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    for ident, existing in tile_buildings(f'{x+dx}:{y+dy}'):
                        a, b = existing.bounds, poly.bounds
                        if a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1]: continue
                        if not existing.is_valid or (existing.intersects(poly) and existing.intersection(poly).area > max(poly.area * 1e-9, 1e-22)):
                            hits.append(ident)
            return sorted(set(hits))
        candidates, decisions = [], []
        for item in (r for r in previous if r['region'] == region):
            rel = relations[item['id']]; members = rel['members']; issues = []
            nested = [m for m in members if m['type'] == 'relation']
            is_nested = bool(nested)
            if not (rel['candidateKind'] == 'relation-tagged' and rel['tags'].get('building') not in (None, '', 'no') and not rel['tags'].get('building:part')):
                issues.append('not_a_whole_building_relation')
            if rel['tags'].get('man_made') in ('platform',) or rel['tags'].get('leisure') in ('terrace',):
                issues.append('ambiguous_nonbuilding_area_use')
            if not is_nested and item['originalReason'] not in ('geometry_error:RuntimeError', 'missing_or_short_member_way'):
                issues.append('not_a_geometry_failure_or_nested_relation')
            if any(m['type'] not in ('way', 'relation') or m['role'] not in ('outer', '') for m in members):
                issues.append('non_outer_or_unsupported_member')
            if is_nested and any(m['id'] == rel['id'] or m['id'] not in complete or m['id'] not in child_pieces for m in nested):
                issues.append('nested_child_not_fully_present_in_scene')
            way_members = [m for m in members if m['type'] == 'way']
            if not way_members: issues.append('no_outer_way')
            polygons = []
            if not issues:
                for m in way_members:
                    w = ways.get(m['id'])
                    if not w or len(w['refs']) < 4 or w['refs'][0] != w['refs'][-1]:
                        issues.append('outer_way_not_closed_or_missing'); break
                    if w['tags'].get('building') not in (None, '', 'no') or w['tags'].get('building:part') not in (None, '', 'no'):
                        issues.append('outer_way_independently_tagged'); break
                    refs = np.asarray(w['refs'], dtype=np.uint64); positions = np.searchsorted(index['id'], refs)
                    if np.any(positions >= len(index)) or np.any(index['id'][positions] != refs):
                        issues.append('outer_way_missing_node'); break
                    poly = Polygon([(float(x['lng']) / 1e7, float(x['lat']) / 1e7) for x in index[positions]])
                    if not poly.is_valid or poly.is_empty or poly.area <= 0:
                        issues.append('invalid_outer_polygon'); break
                    polygons.append((m['id'], poly))
            eligible, excluded = [], []
            if not issues:
                eligible, excluded = independent_rings(polygons, shared, [child_pieces[m['id']] for m in nested], nearby_overlaps)
            if not issues and not eligible: issues.append('no_independent_nonoverlapping_outer_ring')
            decision = {'region': region, 'id': rel['id'], 'originalReason': item['originalReason'], 'priorReason': item['priorReason'],
                        'tags': rel['tags'], 'members': members, 'nestedMembers': item.get('nestedMembers', []),
                        'checks': issues, 'excludedRings': excluded, 'candidateWayIds': [wid for wid, _ in eligible]}
            decisions.append(decision)
            for wid, poly in eligible: candidates.append({'relation': rel['id'], 'way': wid, 'geometry': poly, 'tags': rel['tags']})
        # Reject overlapping candidate rings across relations as well.
        geoms = [c['geometry'] for c in candidates]; tree = STRtree(geoms); cross = set()
        for i, a in enumerate(geoms):
            for j in tree.query(a):
                j = int(j)
                if j > i and a.intersection(geoms[j]).area > max(min(a.area, geoms[j].area) * 1e-9, 1e-22): cross.update((i, j))
        grouped = {}
        for i, c in enumerate(candidates):
            if i in cross:
                next(d for d in decisions if d['id'] == c['relation'])['excludedRings'].append({'wayId': c['way'], 'reasons': ['overlaps_another_candidate'], 'sceneIds': []})
                continue
            grouped.setdefault(c['relation'], []).append(c)
        scene, scene_decisions = [], []
        for ident, group in grouped.items():
            geom = union_all([c['geometry'] for c in group])
            if geom.geom_type == 'Polygon': geom = MultiPolygon([geom])
            if geom.geom_type != 'MultiPolygon' or abs(geom.area - sum(c['geometry'].area for c in group)) > max(geom.area * 1e-9, 1e-22):
                raise ValueError(f'Area changed when assembling selected rings {ident}')
            if not geom.is_valid: raise ValueError(f'Invalid selected multipolygon {ident}')
            entries = []
            for i, (poly, ground) in enumerate(prepare.pieces_for(geom)):
                points = [[lat, lon] for lon, lat in poly.exterior.coords]
                lat = sum(p[0] for p in points) / len(points); lon = sum(p[1] for p in points) / len(points)
                entries.append({'id': f'relation/{ident}/piece/{i}', 'key': prepare.key_for(lat, lon, manifest['grid']),
                                'polygon': points, 'groundPoint': [ground.y, ground.x]})
            scene.append({'id': ident, 'tags': group[0]['tags'], 'kind': 'validated-independent-outer-rings', 'pieces': entries, 'removeWays': []})
            scene_decisions.append({'id': ident, 'selectedWayIds': [c['way'] for c in group], 'pieces': len(entries)})
        for d in decisions:
            result = next((r for r in scene_decisions if r['id'] == d['id']), None)
            d['selectedWayIds'] = result['selectedWayIds'] if result else []
            d['status'] = 'candidate_for_scene' if result else 'not_recovered'
        write(os.path.join(out, 'scene-relations.jsonl'), scene)
        write(os.path.join(out, 'selection-decisions.jsonl'), scene_decisions)
        write(os.path.join(out, 'assembly-rejected.jsonl'), [])
        write(os.path.join(out, 'triangulation-rejected.jsonl'), [])
        with open(os.path.join(out, 'assembly-audit.json'), 'w', encoding='utf8') as f:
            json.dump({'method': 'independent valid outer rings from malformed relation or non-overlapping outer members beside already-applied child', 'reviewed': len(decisions), 'selected': len(scene)}, f, indent=2)
        with open(os.path.join(out, 'scene-preparation-audit.json'), 'w', encoding='utf8') as f:
            json.dump({'relations': len(scene), 'pieces': sum(len(r['pieces']) for r in scene), 'replaced_way_references': 0, 'rejected': 0}, f, indent=2)
        all_reviews.extend(decisions)
        print(region, json.dumps({'reviewed': len(decisions), 'selectedRelations': len(scene), 'pieces': sum(len(r['pieces']) for r in scene), 'reasons': Counter(x for d in decisions for x in d['checks'])}), flush=True)
    write(os.path.join(workspace, 'multipolygon-last-review.jsonl'), all_reviews)

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Expected workspace')
    main(sys.argv[1])
