#!/usr/bin/env python3
"""Find excluded relations whose closed outer ways are already in the scene.

This only verifies the two-dimensional footprint. It makes no claim that
relation height/part tags are equivalent to the existing way's height model.
"""
import json
import os
import sys
from functools import lru_cache

import numpy as np


def lines(file):
    with open(file, encoding='utf-8') as source:
        return [json.loads(line) for line in source if line.strip()]


def main(workspace, region, manifest_path):
    original = os.path.join(workspace, f'multipolygon-{region}')
    recheck = os.path.join(workspace, f'multipolygon-recheck-{region}')
    rels = {r['id']: r for r in lines(os.path.join(original, 'building-relations.jsonl'))}
    ways = {w['id']: w for w in lines(os.path.join(original, 'member-ways.jsonl'))}
    failures = []
    for name in ('assembly-rejected.jsonl', 'triangulation-rejected.jsonl', 'overlay-blocked.jsonl'):
        failures.extend(lines(os.path.join(original, name)))
    blocked = {r['id'] for r in lines(os.path.join(recheck, 'overlay-blocked.jsonl'))}
    applied = {r['id'] for r in lines(os.path.join(recheck, 'scene-relations.jsonl')) if r['id'] not in blocked}
    with open(manifest_path, encoding='utf-8') as source: manifest = json.load(source)
    grid = manifest['grid']
    dtype = np.dtype([('id', '<u8'), ('lat', '<i4'), ('lng', '<i4')])
    index = np.memmap(os.path.join(workspace, f'build-{region}', 'work', 'nodes.bin'), dtype=dtype, mode='r')
    scale = np.pi / 180 * 6371000 / 5000

    @lru_cache(maxsize=128)
    def ids_in_tile(key):
        entry = manifest['tiles'].get(key)
        if entry is None: return frozenset()
        filename = entry['file']
        for base in (os.path.join(recheck, 'changed-tiles'), os.path.join(original, 'changed-tiles'),
                     os.path.join(workspace, f'build-{region}', 'generated')):
            file = os.path.join(base, filename)
            if os.path.isfile(file):
                with open(file, encoding='utf-8') as source: tile = json.load(source)
                return frozenset(b['id'] for b in tile.get('buildings', []))
        return frozenset()

    covered = []
    for item in failures:
        ident = item['id']
        if ident in applied: continue
        rel = rels[ident]
        if any(m['type'] != 'way' or m['role'] not in ('outer', '') for m in rel['members']): continue
        outer = [ways.get(m['id']) for m in rel['members']]
        if not outer or any(not w or len(w['refs']) < 4 or w['refs'][0] != w['refs'][-1] or
                            (w['tags'].get('building') in (None, '', 'no') and
                             w['tags'].get('building:part') in (None, '', 'no')) for w in outer): continue
        ids = []
        for way in outer:
            refs = np.asarray(way['refs'], dtype=np.uint64)
            positions = np.searchsorted(index['id'], refs)
            if np.any(positions >= len(index)) or np.any(index['id'][positions] != refs): break
            coords = index[positions]
            lat = float(np.mean(coords['lat'])) / 1e7; lon = float(np.mean(coords['lng'])) / 1e7
            x = int(np.floor((lon-grid['lngOrigin']) * scale * grid['cosLat']))
            y = int(np.floor((lat-grid['latOrigin']) * scale))
            identity = f"way/{way['id']}"
            # Neighbours cover floating-point boundary rounding; identity is
            # checked explicitly rather than inferred from proximity alone.
            if not any(identity in ids_in_tile(f'{x+dx}:{y+dy}') for dx in (0, -1, 1) for dy in (0, -1, 1)):
                break
            ids.append(identity)
        if len(ids) == len(outer):
            covered.append({'region': region, 'id': ident, 'reason': item['reason'],
                            'existingWayIds': ids, 'scope': '2d_footprint_only'})
    with open(os.path.join(recheck, 'already-covered-footprints.jsonl'), 'w', encoding='utf-8', newline='\n') as target:
        for row in covered: target.write(json.dumps(row, separators=(',', ':')) + '\n')
    print(json.dumps({'region': region, 'originalExclusions': len(failures), 'added': len(applied),
                      'remainingWithExistingWayFootprints': len(covered)}), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 4: raise SystemExit('Expected workspace, region and current manifest')
    main(*sys.argv[1:])
