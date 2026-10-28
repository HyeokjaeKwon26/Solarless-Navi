#!/usr/bin/env python3
"""Classify excluded building relations using their original member tags."""
import json
import os
import sys
from collections import Counter, defaultdict


def read_lines(path):
    with open(path, encoding='utf-8') as source:
        return [json.loads(line) for line in source if line.strip()]


def main(workspace, output):
    keys = ('building', 'building:part', 'height', 'building:levels', 'min_height', 'building:min_level')
    summaries, all_rows = {}, []
    for region in ('us-northeast', 'us-midwest', 'us-south', 'us-west'):
        directory = os.path.join(workspace, f'multipolygon-{region}')
        rels = {r['id']: r for r in read_lines(os.path.join(directory, 'building-relations.jsonl'))}
        ways = {w['id']: w for w in read_lines(os.path.join(directory, 'member-ways.jsonl'))}
        excluded = []
        for name in ('assembly-rejected.jsonl', 'triangulation-rejected.jsonl', 'overlay-blocked.jsonl'):
            excluded.extend(read_lines(os.path.join(directory, name)))
        stats = Counter()
        for failure in excluded:
            rel = rels[failure['id']]
            outers = [ways[m['id']] for m in rel['members'] if m['type'] == 'way' and m['role'] in ('', 'outer') and m['id'] in ways]
            tagged = [w for w in outers if w['tags'].get('building') not in (None, '', 'no') or
                      w['tags'].get('building:part') not in (None, '', 'no')]
            differences = defaultdict(set)
            for way in tagged:
                for key in keys:
                    old, new = rel['tags'].get(key), way['tags'].get(key)
                    if new is None or old == new or (key == 'building' and old and 'yes' in (old, new)):
                        continue
                    differences[f'{key}:{"relation_missing" if old is None else "disagrees"}'].add(str(new))
            row = {'region': region, 'id': rel['id'], 'originalReason': failure['reason'],
                   'kind': rel['candidateKind'], 'tags': rel['tags'], 'members': rel['members'],
                   'taggedOuters': [{'id': w['id'], 'tags': {k: w['tags'][k] for k in keys if k in w['tags']},
                                     'closed': len(w['refs']) > 2 and w['refs'][0] == w['refs'][-1],
                                     'nodes': len(w['refs'])} for w in tagged],
                   'differences': {k: sorted(v) for k, v in sorted(differences.items())}}
            stats[failure['reason']] += 1
            for k in differences: stats[f'difference:{k}'] += 1
            roles = {f"{m['type']}:{m['role'] or '(empty)'}" for m in rel['members']}
            if failure['reason'] in ('unsupported_member_or_role', 'no_outer_way'):
                for role in roles: stats[f'role:{role}'] += 1
            all_rows.append(row)
        summaries[region] = dict(stats)
    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    with open(output, 'w', encoding='utf-8', newline='\n') as target:
        for row in all_rows: target.write(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n')
    with open(output + '.summary.json', 'w', encoding='utf-8') as target:
        json.dump(summaries, target, indent=2, ensure_ascii=False)
    print(json.dumps(summaries, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit('Expected workspace and JSONL output')
    main(*sys.argv[1:])
