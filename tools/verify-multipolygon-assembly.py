#!/usr/bin/env python3
"""Verify that libosmium reproduces all previously assembled geometries."""
import json
import os
import sys

import osmium
from shapely import from_wkb
from shapely.geometry import shape


def main(audit_dir):
    previous = {}
    with open(os.path.join(audit_dir, 'assembled-buildings.jsonl'), encoding='utf-8') as source:
        for line in source:
            row = json.loads(line)
            previous[row['id']] = shape(row['geometry']).wkb
    seen, changed = set(), []
    factory = osmium.geom.GeoJSONFactory()

    class Reader(osmium.SimpleHandler):
        def area(self, area):
            if area.from_way() or area.orig_id() not in previous:
                return
            ident = area.orig_id()
            try:
                current = shape(json.loads(factory.create_multipolygon(area)))
                if not current.equals(from_wkb(previous[ident])):
                    changed.append(ident)
                seen.add(ident)
            except (RuntimeError, ValueError):
                changed.append(ident)
    Reader().apply_file(os.path.join(audit_dir, 'building-relations.osm.pbf'), locations=True)
    missing = set(previous).difference(seen)
    result = {'expected': len(previous), 'seen': len(seen), 'changed': changed, 'missing': sorted(missing)}
    print(json.dumps(result), flush=True)
    if changed or missing: raise SystemExit(1)


if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Expected audit directory')
    main(sys.argv[1])
