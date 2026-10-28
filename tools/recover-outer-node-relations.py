#!/usr/bin/env python3
"""Recover valid way geometry when an extra outer node cannot form an area.

Only untagged, non-shared outer ways are used; inner nodes, nested relations,
tagged outer ways and ways used by an already applied relation are excluded.
The point members are retained in the audit but never turned into a footprint.
"""
import importlib.util
import json
import os
import sys

def module(name, file):
    spec = importlib.util.spec_from_file_location(name, os.path.join(os.path.dirname(__file__), file))
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result); return result

assemble = module('outer_node_assembly', 'assemble-scene-multipolygons.py')
prepare = module('outer_node_prepare', 'prepare-scene-multipolygons.py')

def lines(file):
    with open(file, encoding='utf8') as source: return [json.loads(line) for line in source if line.strip()]

def write(file, rows, mode='w'):
    with open(file, mode, encoding='utf8', newline='\n') as target:
        for row in rows: target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')

def main(workspace, region):
    orig = os.path.join(workspace, f'multipolygon-{region}')
    recheck = os.path.join(workspace, f'multipolygon-recheck-{region}')
    output = os.path.join(workspace, f'multipolygon-followup-{region}')
    dest = os.path.join(workspace, f'multipolygon-outer-node-{region}')
    os.makedirs(dest, exist_ok=True)
    original = {r['id']: r for r in lines(os.path.join(orig, 'building-relations.jsonl'))}
    ways = {w['id']: w for w in lines(os.path.join(orig, 'member-ways.jsonl'))}
    applied = set()
    for directory in (orig, recheck):
        blocked = {r['id'] for r in lines(os.path.join(directory, 'overlay-blocked.jsonl'))}
        applied.update(r['id'] for r in lines(os.path.join(directory, 'scene-relations.jsonl')) if r['id'] not in blocked)
    shared = {m['id'] for ident in applied if ident in original for m in original[ident]['members'] if m['type'] == 'way'}
    review = [r for r in lines(os.path.join(workspace, 'multipolygon-followup-review.jsonl')) if r['region'] == region]
    selected, checks = [], []
    for row in review:
        rel = original[row['id']]
        members = rel['members']
        bad_nodes = [m for m in members if m['type'] == 'node' and m['role'] == 'outer']
        if not bad_nodes: continue
        way_members = [m for m in members if m['type'] == 'way']
        reason = None
        if (rel['candidateKind'] != 'relation-tagged' or not assemble.building_value(rel['tags'], 'building') or
                rel['tags'].get('building:part')):
            reason = 'not_unambiguous_whole_building'
        elif any(m['type'] not in ('node', 'way') or (m['type'] == 'node' and m['role'] == 'inner') or
                 (m['type'] == 'way' and m['role'] not in ('outer', 'inner', '')) for m in members):
            reason = 'unsupported_other_member'
        elif not any(m['role'] in ('outer', '') for m in way_members):
            reason = 'no_outer_way'
        elif any(m['id'] not in ways for m in way_members):
            reason = 'missing_way'
        elif any(m['id'] in shared for m in way_members):
            reason = 'way_used_by_applied_relation'
        elif any(assemble.building_value(ways[m['id']]['tags'], 'building') or assemble.building_value(ways[m['id']]['tags'], 'building:part')
                 for m in way_members if m['role'] in ('outer', '')):
            reason = 'outer_way_independently_tagged'
        if reason:
            checks.append({'id': row['id'], 'status': 'unresolved', 'reason': reason}); continue
        selected.append({**rel, 'members': way_members, 'preserveWayIds': [], 'allowClassMismatch': False})
        checks.append({'id': row['id'], 'status': 'requires_assembly', 'ignoredOuterNodeIds': [m['id'] for m in bad_nodes]})
    member_ids = {m['id'] for r in selected for m in r['members']}
    write(os.path.join(dest, 'building-relations.jsonl'), selected)
    write(os.path.join(dest, 'member-ways.jsonl'), [ways[i] for i in sorted(member_ids)])
    node_file = os.path.join(workspace, f'build-{region}', 'work', 'nodes.bin')
    manifest = os.path.join('data', 'scene', region, 'manifest.json')
    assemble.main(dest, node_file, manifest)
    prepare.main(dest, node_file, manifest)
    failure = {x['id']: x['reason'] for name in ('assembly-rejected.jsonl', 'triangulation-rejected.jsonl') for x in lines(os.path.join(dest, name))}
    added = lines(os.path.join(dest, 'scene-relations.jsonl'))
    if any(r['removeWays'] for r in added): raise ValueError('Unexpected removal')
    existing = {r['id'] for r in lines(os.path.join(output, 'scene-relations.jsonl'))}
    if existing.intersection(r['id'] for r in added): raise ValueError('Duplicate followup relation')
    geometry = {r['id']: r for r in lines(os.path.join(dest, 'assembled-buildings.jsonl'))}
    from shapely.geometry import shape
    component_records = [{'id': row['id'], 'status': 'component_selected', 'method': 'valid_way_geometry_outer_nodes_ignored',
                          'selectedComponents': len(shape(geometry[row['id']]['geometry']).geoms),
                          'allComponents': len(shape(geometry[row['id']]['geometry']).geoms), 'retainedTaggedWayIds': []}
                         for row in added]
    write(os.path.join(output, 'scene-relations.jsonl'), added, 'a')
    write(os.path.join(output, 'component-decisions.jsonl'), component_records, 'a')
    prep_file = os.path.join(output, 'scene-preparation-audit.json')
    with open(prep_file, encoding='utf8') as source: prep_stats = json.load(source)
    with open(os.path.join(dest, 'scene-preparation-audit.json'), encoding='utf8') as source: node_stats = json.load(source)
    prep_stats['outer_node_additional_relations'] = len(added)
    for key in ('relations', 'pieces', 'relations_with_holes'):
        prep_stats[key] = prep_stats.get(key, 0) + node_stats.get(key, 0)
    with open(prep_file, 'w', encoding='utf8') as target: json.dump(prep_stats, target, indent=2)
    assembly_file = os.path.join(output, 'assembly-audit.json')
    with open(assembly_file, encoding='utf8') as source: assembly_stats = json.load(source)
    assembly_stats['outer_node_additional_candidates'] = len(selected)
    assembly_stats['outer_node_additional_assembled'] = len(geometry)
    with open(assembly_file, 'w', encoding='utf8') as target: json.dump(assembly_stats, target, indent=2)
    for c in checks:
        if c['id'] in failure: c.update(status='unresolved', reason=failure[c['id']])
        elif c['id'] in geometry: c['status'] = 'selected_valid_way_geometry'
    write(os.path.join(output, 'outer-node-decisions.jsonl'), checks)
    print(json.dumps({'region': region, 'outer_node_candidates': len(selected), 'added': len(added), 'checks': checks}), flush=True)

if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit('Expected workspace and region')
    main(*sys.argv[1:])
