import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {build, RUNS} from '../scripts/build-examples.mjs';
import {readJson, root} from './support/helpers.mjs';

const validate = new Ajv2020({strict: true}).compile(await readJson('report.schema.json'));
const text = (base, path) => readFile(join(base, path), 'utf8');

test('the committed examples are exactly what the command line produces today', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'geoq-examples-'));
  try {
    build(dir);
    for (const [, output] of RUNS) for (const file of ['clean.geojson', 'report.json'])
      assert.equal(await text(dir, join(output, file)), await text(fileURLToPath(root), join(output, file)), output + '/' + file + ' is out of date; run node scripts/build-examples.mjs');
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('the messy example shows duplicates, bad coordinates, bad polygons and mixed geometry, and its report is valid', async () => {
  const report = await readJson('examples/messy/report.json'), input = await readJson('examples/messy.geojson');
  assert.equal(validate(report), true);
  assert.deepEqual(new Set(input.features.map(f => f.geometry?.type ?? 'none')), new Set(['Point', 'MultiPoint', 'LineString', 'Polygon', 'MultiPolygon', 'GeometryCollection', 'none']));
  for (const code of ['duplicate_id', 'coordinate_out_of_range', 'invalid_coordinates', 'self_intersection', 'rings_intersect', 'geometry_collection_unsupported', 'null_geometry', 'line_too_short', 'missing_property', 'invalid_id'])
    assert.ok(report.counts.errors[code] >= 1, code);
  for (const code of ['multipoint_exploded', 'duplicate_positions', 'ring_not_closed', 'ring_orientation', 'antimeridian_crossing']) assert.ok(report.counts.warnings[code] >= 1, code);
  assert.deepEqual([report.input, report.accepted, report.rejected, report.output], [18, 8, 10, 9]);
});

// The flood-exposure-atlas imports zones as Polygon or MultiPolygon features with properties name and
// level (low, moderate or high) and facilities as Point features with properties id, name and category.
test('the atlas recipe outputs have the shapes the flood-exposure-atlas imports', async () => {
  const zones = await readJson('examples/atlas/zones/clean.geojson'), sites = await readJson('examples/atlas/facilities/clean.geojson');
  for (const base of ['zones', 'facilities']) assert.equal(validate(await readJson('examples/atlas/' + base + '/report.json')), true);
  assert.ok(zones.features.length >= 3 && sites.features.length >= 5);
  const jump = ring => ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180);
  for (const z of zones.features) {
    assert.deepEqual(Object.keys(z.properties), ['name', 'level']);
    assert.ok(['low', 'moderate', 'high'].includes(z.properties.level));
    assert.ok(['Polygon', 'MultiPolygon'].includes(z.geometry.type));
    const polygons = z.geometry.type === 'Polygon' ? [z.geometry.coordinates] : z.geometry.coordinates;
    for (const rings of polygons) for (const ring of rings) { assert.ok(ring.length >= 4 && !jump(ring)); assert.deepEqual(ring[0], ring.at(-1)); }
  }
  const ids = sites.features.map(f => f.properties.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of sites.features) {
    assert.deepEqual(Object.keys(s.properties), ['id', 'name', 'category']);
    assert.ok(Object.values(s.properties).every(v => typeof v === 'string' && v.trim() === v && v !== ''));
    assert.equal(s.geometry.type, 'Point');
    assert.equal(s.properties.id, s.id);
  }
});

// ATLAS_DIR points at another checkout of the atlas; by default the folder next to this repository is used.
test('when the atlas repository is available, its own validator accepts the recipe outputs', t => {
  const atlas = process.env.ATLAS_DIR ?? fileURLToPath(new URL('../flood-exposure-atlas/', root));
  if (!existsSync(join(atlas, 'validate.mjs'))) return t.skip('no flood-exposure-atlas/validate.mjs at ' + atlas + ' (set ATLAS_DIR)');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/check-atlas.mjs', root)), atlas], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: the atlas validator accepts everything the kit produced\./);
});
