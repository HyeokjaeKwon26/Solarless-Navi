#!/usr/bin/env python3
"""Reconsider prior exclusions using conservative, explicit repair rules.

Only non-geometric node members are removed; obviously misspelled way roles
are normalized. Building-tagged single closed outers can supply missing height
metadata, provided no conflicting height/part tags exist. Two-node outers are
known to have been omitted by the original way builder and need no removal.
"""
import json
import os
import re
import sys
from collections import Counter

import importlib.util

ASSEMBLER = os.path.join(os.path.dirname(__file__), 'assemble-scene-multipolygons.py')
spec = importlib.util.spec_from_file_location('assembler', ASSEMBLER)
assembler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembler)


def lines(file):
    with open(file, encoding='utf-8') as source:
        return [json.loads(line) for line in source if line.strip()]


def reconsider(rel, ways, reason):
    rel = {**rel, 'tags': dict(rel['tags']), 'members': [dict(m) for m in rel['members']]}
    changes = []
    if reason == 'outer_shared_with_rejected_relation':
        return None, 'shared_outer_requires_joint_resolution'
    if reason not in ('conflicting_tagged_outer', 'conflicting_legacy_outer_tags',
                       'unsupported_member_or_role', 'no_outer_way', 'tagged_outer_not_found_in_baseline'):
        return None, 'geometry_or_source_data_requires_review'
    role_fixes = {'Outer': 'outer', 'oouter': 'outer', 'innner': 'inner', 'innwe': 'inner'}
    cleaned = []
    for member in rel['members']:
        if member['type'] == 'node' and member['role'].lower() not in ('outer', 'inner'):
            changes.append('non_geometry_node_ignored')
            continue
        if member['type'] == 'way' and member['role'] in role_fixes:
            member['role'] = role_fixes[member['role']]
            changes.append('obvious_way_role_typo_normalized')
        cleaned.append(member)
    rel['members'] = cleaned
    if any(m['type'] != 'way' or m['role'] not in ('outer', 'inner', '') for m in cleaned):
        return None, 'ambiguous_member_or_role'
    outer = [m for m in cleaned if m['role'] in ('outer', '')]
    if not outer:
        return None, 'no_outer_geometry'
    if any(m['id'] not in ways or len(ways[m['id']]['refs']) < 2 for m in cleaned):
        return None, 'missing_member_geometry'
    tagged = [ways[m['id']] for m in outer if assembler.building_value(ways[m['id']]['tags'], 'building') or
              assembler.building_value(ways[m['id']]['tags'], 'building:part')]
    structural = ('height', 'building:levels', 'min_height', 'building:min_level')
    if rel['candidateKind'] == 'outer-tagged-legacy':
        # Different descriptive building classes do not affect shade, but all
        # outer components must have identical structural attributes.
        if not tagged or len(tagged) != len(outer) or any('building:part' in w['tags'] for w in tagged):
            return None, 'legacy_component_tags_ambiguous'
        if any(w['refs'][0] != w['refs'][-1] for w in tagged):
            return None, 'legacy_outer_not_closed'
        signatures = {tuple((key, w['tags'].get(key)) for key in structural) for w in tagged}
        if len(signatures) != 1:
            return None, 'legacy_component_heights_differ'
        way_tags = tagged[0]['tags']
        for left, right in (('height', 'building:levels'), ('min_height', 'building:min_level')):
            if ((way_tags.get(left) is not None and rel['tags'].get(left) is None and rel['tags'].get(right) is not None) or
                    (way_tags.get(right) is not None and rel['tags'].get(right) is None and rel['tags'].get(left) is not None)):
                return None, 'conflicting_height_sources'
        rel['tags']['building'] = 'yes'
        for key in structural:
            value = way_tags.get(key)
            if value is not None and rel['tags'].get(key) is not None and rel['tags'][key] != value:
                return None, 'conflicting_height_values'
            if value is not None and rel['tags'].get(key) is None:
                rel['tags'][key] = value
        rel['candidateKind'] = 'relation-tagged'
        rel['allowClassMismatch'] = True
        changes.append('legacy_building_tags_inferred')
    elif tagged and (assembler.building_value(rel['tags'], 'building:part') and
                     not assembler.building_value(rel['tags'], 'building') and
                     all(assembler.building_value(w['tags'], 'building') and
                         not assembler.building_value(w['tags'], 'building:part') for w in tagged)):
        # A building part and its building outline are distinct OSM objects.
        # Retain the parent footprint and add the part only when its own top
        # height or level count is explicit and positive.
        explicit = rel['tags'].get('height') or rel['tags'].get('building:levels') or ''
        number = re.search(r'-?\d+(?:[.,]\d+)?', explicit)
        if not number or float(number.group().replace(',', '.')) <= 0:
            return None, 'part_height_not_explicit'
        rel['preserveWayIds'] = [w['id'] for w in tagged]
        changes.append('independent_building_part_parent_retained')
    elif tagged:
        # This rule deliberately excludes whole-building/part overlaps and
        # multi-outer cases where per-component heights may differ. Multiple
        # closed outer buildings are safe when all structural tags agree.
        if (len(tagged) != len(outer) or
                rel['tags'].get('building:part') is not None or
                any(w['tags'].get('building:part') is not None for w in tagged) or
                not assembler.building_value(rel['tags'], 'building') or
                any(not assembler.building_value(w['tags'], 'building') for w in tagged) or
                any(w['refs'][0] != w['refs'][-1] for w in tagged) or
                len({tuple((key, w['tags'].get(key)) for key in structural) for w in tagged}) != 1):
            if reason != 'tagged_outer_not_found_in_baseline':
                return None, 'building_part_or_multi_outer_ambiguous'
        else:
            way_tags = tagged[0]['tags']
            # Do not mix a way's explicit height with a relation's alternative
            # level estimate, or vice versa, without a common source.
            for left, right in (('height', 'building:levels'), ('min_height', 'building:min_level')):
                if ((way_tags.get(left) is not None and rel['tags'].get(left) is None and rel['tags'].get(right) is not None) or
                    (way_tags.get(right) is not None and rel['tags'].get(right) is None and rel['tags'].get(left) is not None)):
                    return None, 'conflicting_height_sources'
            for key in structural:
                value = way_tags.get(key)
                if value is not None and rel['tags'].get(key) is not None and rel['tags'][key] != value:
                    return None, 'conflicting_height_values'
                if value is not None and rel['tags'].get(key) is None:
                    rel['tags'][key] = value
                    changes.append(f'inherited_{key}')
            rel['allowClassMismatch'] = True
            if rel['tags'].get('building') != way_tags.get('building'):
                changes.append('building_class_differs_shading_unchanged')
    # A two-node tagged way was never emitted as a building by the prior
    # builder, so it should not be expected as a removable scene object.
    rel['omittedShortWayIds'] = [w['id'] for w in tagged if len(w['refs']) < 3]
    tags, _, error = assembler.relation_tags_and_overlap(rel, ways)
    if error:
        return None, error
    if not changes and reason != 'tagged_outer_not_found_in_baseline':
        return None, 'no_safe_interpretation_change'
    rel['recoveryChanges'] = sorted(set(changes + (['two_node_outer_was_not_in_scene'] if rel['omittedShortWayIds'] else [])))
    return rel, None


def main(workspace):
    all_decisions = []
    for region in ('us-northeast', 'us-midwest', 'us-south', 'us-west'):
        original = os.path.join(workspace, f'multipolygon-{region}')
        destination = os.path.join(workspace, f'multipolygon-recheck-{region}')
        os.makedirs(destination, exist_ok=True)
        rels = {r['id']: r for r in lines(os.path.join(original, 'building-relations.jsonl'))}
        ways = {w['id']: w for w in lines(os.path.join(original, 'member-ways.jsonl'))}
        failures = []
        for name in ('assembly-rejected.jsonl', 'triangulation-rejected.jsonl', 'overlay-blocked.jsonl'):
            failures.extend(lines(os.path.join(original, name)))
        accepted, decisions, stats = [], [], Counter(total=len(failures))
        for failure in failures:
            rel, reason = reconsider(rels[failure['id']], ways, failure['reason'])
            if rel:
                accepted.append(rel); stats['eligible'] += 1
                decision = {'region': region, 'id': rel['id'], 'originalReason': failure['reason'],
                            'decision': 'eligible', 'changes': rel['recoveryChanges']}
            else:
                stats[reason] += 1
                decision = {'region': region, 'id': failure['id'], 'originalReason': failure['reason'],
                            'decision': 'unresolved', 'reason': reason}
            decisions.append(decision); all_decisions.append(decision)
        selected = {m['id'] for r in accepted for m in r['members'] if m['type'] == 'way'}
        for name, rows in [('building-relations.jsonl', accepted), ('member-ways.jsonl',
                            (ways[i] for i in sorted(selected) if i in ways)), ('decisions.jsonl', decisions)]:
            with open(os.path.join(destination, name), 'w', encoding='utf-8', newline='\n') as target:
                for row in rows: target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
        with open(os.path.join(destination, 'recheck-summary.json'), 'w', encoding='utf-8') as target:
            json.dump(stats, target, indent=2)
        print(region, json.dumps(stats), flush=True)
    with open(os.path.join(workspace, 'multipolygon-recheck', 'decisions.jsonl'), 'w', encoding='utf-8', newline='\n') as target:
        for row in all_decisions: target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Expected workspace')
    main(sys.argv[1])
