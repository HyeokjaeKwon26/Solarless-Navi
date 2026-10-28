#!/usr/bin/env python3
"""Convert validated relation polygons into hole-safe scene polygons.

Polygons with holes are split through their interiors into simple polygons;
constrained triangulation is a fallback. Each decomposition is checked against
the original area and remains compatible with existing schema-3 clients.
"""
import json
import math
import os
import sys
from collections import Counter

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import split


def key_for(lat, lon, grid):
    scale = math.pi / 180 * 6371000 / 5000
    return f"{math.floor((lon - grid['lngOrigin']) * scale * grid['cosLat'])}:{math.floor((lat - grid['latOrigin']) * scale)}"


def pieces_for(geom):
    result = []
    for poly in geom.geoms:
        if not poly.interiors:
            result.append((poly, poly.representative_point()))
            continue
        pending, pieces = [poly], []
        while pending:
            current = pending.pop()
            if not current.interiors:
                pieces.append(current)
                continue
            minx, miny, maxx, maxy = current.bounds
            hole_point = Polygon(current.interiors[0]).representative_point()
            margin = max(maxx - minx, maxy - miny, 1e-7)
            cutters = [LineString([(minx - margin, hole_point.y), (maxx + margin, hole_point.y)]),
                       LineString([(hole_point.x, miny - margin), (hole_point.x, maxy + margin)])]
            parts = None
            for cutter in cutters:
                candidate = list(split(current, cutter).geoms)
                if len(candidate) > 1 and sum(len(part.interiors) for part in candidate) < len(current.interiors):
                    parts = candidate
                    break
            if parts is None:
                parts = list(shapely.constrained_delaunay_triangles(current).geoms)
            if not parts:
                raise ValueError('cannot decompose polygon')
            pending.extend(parts)
        merged = shapely.union_all(pieces)
        tolerance = max(poly.area * 1e-9, 1e-20)
        if poly.symmetric_difference(merged).area > tolerance or abs(sum(x.area for x in pieces) - poly.area) > tolerance:
            pieces = list(shapely.constrained_delaunay_triangles(poly).geoms)
            if not pieces:
                raise ValueError('decomposition has no parts')
            merged = shapely.union_all(pieces)
            if poly.symmetric_difference(merged).area > tolerance or abs(sum(x.area for x in pieces) - poly.area) > tolerance:
                raise ValueError('decomposition does not preserve polygon area')
        ground_point = poly.representative_point()
        result.extend((piece, ground_point) for piece in pieces)
    return result


def main(audit_dir, node_index, manifest_path):
    with open(manifest_path, encoding='utf-8') as source: manifest = json.load(source)
    grid = manifest['grid']
    ways = {}
    with open(os.path.join(audit_dir, 'member-ways.jsonl'), encoding='utf-8') as source:
        for line in source:
            w = json.loads(line); ways[w['id']] = w
    dtype = np.dtype([('id', '<u8'), ('lat', '<i4'), ('lng', '<i4')])
    index = np.memmap(node_index, dtype=dtype, mode='r')
    stats = Counter()
    rejected = []
    with open(os.path.join(audit_dir, 'assembled-buildings.jsonl'), encoding='utf-8') as source, \
         open(os.path.join(audit_dir, 'scene-relations.jsonl'), 'w', encoding='utf-8', newline='\n') as target:
        for line in source:
            row = json.loads(line)
            try:
                geom = shape(row['geometry'])
                parts = pieces_for(geom)
                entries = []
                for i, (polygon, ground) in enumerate(parts):
                    points = [[lat, lon] for lon, lat in polygon.exterior.coords]
                    lat = sum(p[0] for p in points) / len(points)
                    lon = sum(p[1] for p in points) / len(points)
                    entries.append({'id': f"relation/{row['id']}/piece/{i}", 'key': key_for(lat, lon, grid),
                        'polygon': points, 'groundPoint': [ground.y, ground.x]})
                removals = []
                for way_id in row['replaceWayIds']:
                    refs = np.asarray(ways[way_id]['refs'], dtype=np.uint64)
                    positions = np.searchsorted(index['id'], refs)
                    if np.any(positions >= len(index)) or np.any(index['id'][positions] != refs):
                        raise ValueError('missing duplicate way node')
                    coords = index[positions]
                    lat = float(np.mean(coords['lat'])) / 1e7
                    lon = float(np.mean(coords['lng'])) / 1e7
                    removals.append({'id': f'way/{way_id}', 'key': key_for(lat, lon, grid)})
                target.write(json.dumps({'id': row['id'], 'tags': row['tags'], 'kind': row['candidateKind'],
                    'pieces': entries, 'removeWays': removals}, separators=(',', ':')) + '\n')
                stats['relations'] += 1
                stats['pieces'] += len(entries)
                stats['replaced_way_references'] += len(removals)
                stats['relations_with_holes'] += int(any(poly.interiors for poly in geom.geoms))
                if stats['relations'] % 5000 == 0: print(f"prepared {stats['relations']} relations", flush=True)
            except (ValueError, shapely.GEOSException) as error:
                rejected.append({'id': row['id'], 'reason': str(error)})
    stats['rejected'] = len(rejected)
    with open(os.path.join(audit_dir, 'triangulation-rejected.jsonl'), 'w', encoding='utf-8', newline='\n') as target:
        for row in rejected: target.write(json.dumps(row) + '\n')
    with open(os.path.join(audit_dir, 'scene-preparation-audit.json'), 'w', encoding='utf-8') as target:
        json.dump(stats, target, indent=2)
    print(json.dumps(stats), flush=True)


if __name__ == '__main__':
    if len(sys.argv) != 4: raise SystemExit('Expected audit directory, nodes.bin and manifest')
    main(*sys.argv[1:])
