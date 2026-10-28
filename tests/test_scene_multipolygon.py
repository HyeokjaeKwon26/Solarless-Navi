import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

import numpy as np
from shapely.geometry import Point, Polygon, shape
from shapely import union_all

FILE = Path(__file__).resolve().parents[1] / 'tools' / 'assemble-scene-multipolygons.py'
spec = importlib.util.spec_from_file_location('assemble_scene_multipolygons', FILE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
prep_spec = importlib.util.spec_from_file_location('prepare_scene_multipolygons', FILE.parent / 'prepare-scene-multipolygons.py')
prep = importlib.util.module_from_spec(prep_spec)
prep_spec.loader.exec_module(prep)


class MultipolygonAssemblyTest(unittest.TestCase):
    def test_split_outer_hole_and_conflicting_member(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            points = {1: (0, 0), 2: (0, 10), 3: (10, 10), 4: (10, 0),
                      5: (3, 3), 6: (3, 7), 7: (7, 7), 8: (7, 3)}
            dtype = np.dtype([('id', '<u8'), ('lat', '<i4'), ('lng', '<i4')])
            array = np.array([(ident, lat * 10**7, lon * 10**7) for ident, (lat, lon) in points.items()], dtype=dtype)
            nodes = root / 'nodes.bin'; array.tofile(nodes)
            (root / 'nodes.bin.meta.json').write_text(json.dumps({'pbfSha256': 'fixture'}))
            manifest = root / 'manifest.json'; manifest.write_text(json.dumps({'osmPbfSha256': 'fixture'}))
            ways = [dict(id=10, tags={}, refs=[1, 2, 3]), dict(id=11, tags={}, refs=[3, 4, 1]),
                    dict(id=12, tags={}, refs=[5, 6, 7, 8, 5]),
                    dict(id=13, tags={'building': 'yes', 'height': '99'}, refs=[1, 2, 3, 4, 1])]
            members = lambda values: [dict(type='way', id=ident, role=role) for ident, role in values]
            rels = [dict(id=100, tags={'type': 'multipolygon', 'building': 'yes'}, candidateKind='relation-tagged',
                         members=members([(10, 'outer'), (11, 'outer'), (12, 'inner')])),
                    dict(id=101, tags={'type': 'multipolygon', 'building': 'yes'}, candidateKind='relation-tagged',
                         members=members([(13, 'outer')]))]
            for name, rows in [('building-relations.jsonl', rels), ('member-ways.jsonl', ways)]:
                (root / name).write_text(''.join(json.dumps(row) + '\n' for row in rows))
            module.main(str(root), str(nodes), str(manifest))
            records = [json.loads(line) for line in (root / 'assembled-buildings.jsonl').read_text().splitlines()]
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]['id'], 100)
            geom = shape(records[0]['geometry'])
            self.assertEqual(geom.area, 84)
            self.assertEqual(len(geom.geoms[0].interiors), 1)
            stats = json.loads((root / 'assembly-audit.json').read_text())
            self.assertEqual(stats['conflicting_tagged_outer'], 1)

    def test_courtyard_is_not_filled_by_triangles(self):
        from shapely.geometry import MultiPolygon
        polygon = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)],
                          holes=[[(3, 3), (7, 3), (7, 7), (3, 7)]])
        pieces = prep.pieces_for(MultiPolygon([polygon]))
        combined = union_all([piece for piece, _ in pieces])
        self.assertTrue(combined.equals(polygon))
        self.assertFalse(combined.covers(Point(5, 5)))
        self.assertTrue(combined.covers(Point(1, 1)))


if __name__ == '__main__':
    unittest.main()
