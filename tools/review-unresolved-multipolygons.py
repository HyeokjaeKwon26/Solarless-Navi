#!/usr/bin/env python3
"""Audit unresolved relations and prepare only separable, untagged components.

This pass retains every independently tagged outer way.  Geometry assembly and
component selection are separate required steps; selection here is not a claim
that a candidate can be applied to the scene.
"""
import importlib.util
import json
import os
import sys
from collections import Counter

spec = importlib.util.spec_from_file_location('recovery', os.path.join(os.path.dirname(__file__), 'recover-excluded-multipolygons.py'))
recovery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recovery)


def main(workspace):
    previous = recovery.lines('docs/data/us-multipolygon-recheck-decisions-2026-10-28.jsonl')
    unresolved = [x for x in previous if x['status'] == 'unresolved']
    if len(unresolved) != 548:
        raise ValueError('Unexpected unresolved relation count')
    reviews = []
    for region in ('us-northeast', 'us-midwest', 'us-south', 'us-west'):
        src = os.path.join(workspace, f'multipolygon-{region}')
        dest = os.path.join(workspace, f'multipolygon-followup-{region}')
        os.makedirs(dest, exist_ok=True)
        rels = {x['id']: x for x in recovery.lines(os.path.join(src, 'building-relations.jsonl'))}
        ways = {x['id']: x for x in recovery.lines(os.path.join(src, 'member-ways.jsonl'))}
        selected = []
        stats = Counter()
        for d in (x for x in unresolved if x['region'] == region):
            rel = rels[d['id']]
            cleaned, issues = [], []
            fixes = {'Outer': 'outer', 'oouter': 'outer', 'innner': 'inner', 'innwe': 'inner'}
            for m in rel['members']:
                if m['type'] == 'node' and m['role'].lower() not in ('outer', 'inner'):
                    continue
                cleaned.append({**m, 'role': fixes.get(m['role'], m['role'])})
            if rel['candidateKind'] != 'relation-tagged' or not recovery.assembler.building_value(rel['tags'], 'building') or rel['tags'].get('building:part'):
                issues.append('no_unambiguous_whole_building_relation')
            if any(m['type'] != 'way' or m['role'] not in ('outer', 'inner', '') for m in cleaned):
                issues.append('unsupported_member_or_role')
            outer = [m for m in cleaned if m['type'] == 'way' and m['role'] in ('outer', '')]
            if not outer:
                issues.append('no_outer_way')
            if any(m['type'] == 'way' and (m['id'] not in ways or len(ways[m['id']]['refs']) < 2) for m in cleaned):
                issues.append('missing_member_way')
            tagged = [ways[m['id']] for m in outer if m['id'] in ways and
                      (recovery.assembler.building_value(ways[m['id']]['tags'], 'building') or
                       recovery.assembler.building_value(ways[m['id']]['tags'], 'building:part'))]
            untagged = [m for m in outer if m['id'] in ways and ways[m['id']] not in tagged]
            if not tagged or not untagged:
                issues.append('not_mixed_tagged_and_untagged_outers')
            if any(len(w['refs']) < 4 or w['refs'][0] != w['refs'][-1] for w in tagged):
                issues.append('tagged_outer_not_closed')
            if not issues:
                selected.append({**rel, 'members': cleaned, 'preserveWayIds': [w['id'] for w in tagged],
                                 'allowClassMismatch': True, 'recoveryChanges': ['independent_tagged_outers_retained']})
            status = 'candidate_requires_assembly_and_separation' if not issues else 'not_eligible_for_separable_component_rule'
            stats[status] += 1
            reviews.append({'region': region, 'id': d['id'], 'priorReason': d['reason'], 'originalReason': d['originalReason'],
                            'tags': rel['tags'], 'members': rel['members'], 'taggedOuterIds': [w['id'] for w in tagged],
                            'status': status, 'checks': issues})
        member_ids = {m['id'] for rel in selected for m in rel['members'] if m['type'] == 'way'}
        for name, rows in [('building-relations.jsonl', selected), ('member-ways.jsonl', [ways[i] for i in sorted(member_ids) if i in ways])]:
            with open(os.path.join(dest, name), 'w', encoding='utf8', newline='\n') as target:
                for row in rows: target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
        print(region, dict(stats), flush=True)
    out = os.path.join(workspace, 'multipolygon-followup-review.jsonl')
    with open(out, 'w', encoding='utf8', newline='\n') as target:
        for row in reviews: target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Expected workspace')
    main(sys.argv[1])
