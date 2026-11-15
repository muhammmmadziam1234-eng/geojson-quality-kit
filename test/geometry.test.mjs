import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanFeatures, validateGeometry, ISSUE_CODES} from '../index.mjs';
import {deepFreeze, collection, feature} from './support/helpers.mjs';

// Cleans one geometry inside a deep-frozen input, so any attempt to modify the input throws.
function run(geometry, options = {}, extra = []) {
  const input = deepFreeze({type: 'FeatureCollection', features: [feature('a1', geometry), ...extra]});
  return cleanFeatures(input, {nearMeters: 0, ...options});
}
const only = geometry => run(geometry).cleaned.features[0]?.geometry;
const error = (geometry, options) => {
  const {report} = run(geometry, options);
  assert.equal(report.rejected, 1, 'expected a rejection');
  return report.issues[0];
};
const warningCodes = geometry => run(geometry).report.warnings.map(w => w.code);
const twiceArea = ring => ring.slice(0, -1).reduce((s, [x, y], i) => s + x * ring[i + 1][1] - ring[i + 1][0] * y, 0);
const square = (x, y, s, ccw = true) => {
  const ring = [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
  return ccw ? ring : [...ring].reverse();
};

test('every code in the table has a severity and the rules below use only documented codes', () => {
  assert.equal(Object.keys(ISSUE_CODES).length, 24);
  for (const [code, info] of Object.entries(ISSUE_CODES)) assert.ok(['error', 'warning'].includes(info.severity) && info.summary && info.fix, code);
});

test('unsupported and unknown geometries get their own codes', () => {
  assert.equal(error(null).code, 'null_geometry');
  assert.equal(error(undefined).code, 'null_geometry');
  assert.equal(error({type: 'GeometryCollection', geometries: []}).code, 'geometry_collection_unsupported');
  assert.equal(error({type: 'Circle', coordinates: [1, 2]}).code, 'unknown_geometry_type');
  assert.deepEqual(error({type: 7}).details, {type: null});
  assert.equal(error('Point').code, 'unknown_geometry_type');
  const excluded = error({type: 'LineString', coordinates: [[0, 0], [1, 1]]}, {geometryTypes: ['Point', 'Polygon']});
  assert.deepEqual([excluded.code, excluded.details], ['geometry_type_not_allowed', {type: 'LineString', allowed: ['Point', 'Polygon']}]);
});

test('positions: shape, finiteness and range are errors with the path to the bad value', () => {
  assert.deepEqual(error({type: 'Point', coordinates: [1]}).details, {path: [], problem: 'expected 2 or 3 numbers, found 1'});
  assert.equal(error({type: 'Point', coordinates: [1, 2, 3, 4]}).code, 'invalid_coordinates');
  assert.equal(error({type: 'Point', coordinates: ['1', 2]}).code, 'invalid_coordinates');
  assert.equal(error({type: 'Point', coordinates: [NaN, 2]}).code, 'invalid_coordinates');
  assert.equal(error({type: 'Point'}).code, 'invalid_coordinates');
  assert.deepEqual(error({type: 'LineString', coordinates: [[0, 0], [1, 91]]}).details, {path: [1], axis: 'latitude', value: 91});
  assert.deepEqual(error({type: 'Polygon', coordinates: [square(0, 0, 1), [[0, 0], [181, 0], [0, 1], [0, 0]]]}).details, {path: [1, 1], axis: 'longitude', value: 181});
  assert.equal(error({type: 'LineString', coordinates: 'x'}).code, 'invalid_coordinates');
  assert.deepEqual(only({type: 'Point', coordinates: [-0, 1.23456789, 55]}), {type: 'Point', coordinates: [0, 1.234568]});
});

test('MultiPoint is exploded into Point features with numbered ids and one warning', () => {
  const {cleaned, report} = run({type: 'MultiPoint', coordinates: [[1, 2], [3, 4, 5], [1, 2]]});
  assert.deepEqual(cleaned.features.map(f => [f.id, f.geometry.coordinates, f.properties.name]), [['A1-1', [1, 2], 'N a1'], ['A1-2', [3, 4], 'N a1'], ['A1-3', [1, 2], 'N a1']]);
  assert.deepEqual([report.accepted, report.output, report.geometries, report.categories], [1, 3, {Point: 3}, {c: 3}]);
  assert.deepEqual(report.warnings.map(w => [w.code, w.severity, w.index, w.details]), [['multipoint_exploded', 'warning', 0, {count: 3, ids: ['A1-1', 'A1-2', 'A1-3']}]]);
  assert.equal(error({type: 'MultiPoint', coordinates: []}).code, 'empty_geometry');
  assert.deepEqual(error({type: 'MultiPoint', coordinates: [[1, 2], [3]]}).details.path, [1]);
});

test('exploded ids stay unique and valid: they claim the parent id and collide with real ids', () => {
  const multi = id => feature(id, {type: 'MultiPoint', coordinates: [[1, 2], [3, 4]]});
  const pt = id => feature(id, {type: 'Point', coordinates: [5, 6]});
  const a = cleanFeatures(collection([multi('a'), pt('a-1')]), {nearMeters: 0});
  assert.deepEqual(a.report.issues.map(x => [x.index, x.code, x.details]), [[1, 'duplicate_id', {keptIndex: 0, id: 'A-1'}]]);
  const b = cleanFeatures(collection([pt('a'), multi('a')]), {nearMeters: 0});
  assert.deepEqual(b.report.issues.map(x => [x.index, x.code]), [[1, 'duplicate_id']]);
  const long = 'X'.repeat(39);
  const c = cleanFeatures(collection([multi(long)]), {nearMeters: 0});
  assert.equal(c.report.issues[0].code, 'invalid_id');
  assert.match(c.report.issues[0].message, /too long to number/);
  const near = cleanFeatures(collection([feature('n', {type: 'MultiPoint', coordinates: [[10, 10], [10.00003, 10]]})]), {nearMeters: 10});
  assert.deepEqual(near.report.nearby, [{ids: ['N-1', 'N-2'], meters: 3.3}]);
});

test('LineString and MultiLineString: consecutive duplicates removed, two distinct positions required', () => {
  const {cleaned, report} = run({type: 'LineString', coordinates: [[0, 0], [0, 0], [1, 1], [1, 1], [2, 2, 9]]});
  assert.deepEqual(cleaned.features[0].geometry, {type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 2]]});
  assert.deepEqual(report.warnings.map(w => [w.code, w.details]), [['duplicate_positions', {count: 2, at: [[]]}]]);
  assert.deepEqual(only({type: 'LineString', coordinates: [[0, 0], [1, 1], [0, 0]]}).coordinates, [[0, 0], [1, 1], [0, 0]]);
  assert.deepEqual(error({type: 'LineString', coordinates: [[0, 0], [0, 0]]}).details, {path: [], distinct: 1});
  assert.equal(error({type: 'LineString', coordinates: [[3, 3]]}).code, 'line_too_short');
  assert.equal(error({type: 'LineString', coordinates: [[0, 0], [0.0000001, 0]]}).code, 'line_too_short');
  assert.equal(error({type: 'LineString', coordinates: []}).code, 'empty_geometry');
  assert.deepEqual(only({type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [2, 2], [3, 3]]]}).coordinates, [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]);
  assert.deepEqual(error({type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [2, 2]]]}).details, {path: [1], distinct: 1});
  assert.equal(error({type: 'MultiLineString', coordinates: []}).code, 'empty_geometry');
});

test('a valid polygon passes unchanged; orientation follows the right-hand rule', () => {
  const ccw = {type: 'Polygon', coordinates: [square(0, 0, 10), square(2, 2, 3, false)]};
  assert.deepEqual(only(ccw), ccw);
  assert.deepEqual(warningCodes(ccw), []);
  const flipped = {type: 'Polygon', coordinates: [square(0, 0, 10, false), square(2, 2, 3, true)]};
  const out = only(flipped);
  assert.ok(twiceArea(out.coordinates[0]) > 0 && twiceArea(out.coordinates[1]) < 0);
  assert.deepEqual(out, ccw);
  const w = run(flipped).report.warnings;
  assert.deepEqual(w.map(x => [x.code, x.details]), [['ring_orientation', {count: 2, at: [[0], [1]]}]]);
  assert.equal(run(flipped).report.accepted, 1);
});

test('rings are closed, deduplicated and measured after rounding', () => {
  const open = only({type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]]});
  assert.deepEqual(open.coordinates, [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  assert.deepEqual(warningCodes({type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]]}), ['ring_not_closed']);
  const dup = {type: 'Polygon', coordinates: [[[0, 0], [0, 0], [1, 0], [1, 0.0000001], [1, 1], [0, 0], [0, 0]]]};
  assert.deepEqual(only(dup).coordinates, [[[0, 0], [1, 0], [1, 1], [0, 0]]]);
  assert.deepEqual(warningCodes(dup), ['duplicate_positions']);
  assert.deepEqual(error({type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]]}).details, {path: [0], positions: 3});
  assert.equal(error({type: 'Polygon', coordinates: [[[0, 0], [1, 1]]]}).code, 'ring_too_short');
  assert.equal(error({type: 'Polygon', coordinates: [[[5, 5], [5, 5], [5, 5]]]}).code, 'ring_too_short');
  assert.equal(error({type: 'Polygon', coordinates: []}).code, 'empty_geometry');
  assert.equal(error({type: 'Polygon', coordinates: [[]]}).code, 'empty_geometry');
  assert.equal(error({type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]], 'x']}).code, 'invalid_coordinates');
});

test('zero-area rings are rejected, including ones that collapse when rounded', () => {
  assert.deepEqual(error({type: 'Polygon', coordinates: [[[0, 0], [1, 1], [2, 2], [0, 0]]]}).details, {path: [0]});
  assert.equal(error({type: 'Polygon', coordinates: [[[0, 0], [0.0000004, 1], [0, 2], [0, 0]]]}).code, 'ring_zero_area');
  assert.equal(error({type: 'Polygon', coordinates: [square(0, 0, 4), [[1, 1], [2, 1], [3, 1], [1, 1]]]}).code, 'ring_zero_area');
  assert.equal(run({type: 'Polygon', coordinates: [[[0, 0], [0.0000004, 1], [0, 2], [0, 0]]]}, {precision: 7}).report.accepted, 1, 'at precision 7 the sliver has area');
});

test('self-intersection is detected and rejected with the offending segment indices', () => {
  const bow = error({type: 'Polygon', coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]});
  assert.deepEqual([bow.code, bow.details], ['self_intersection', {ring: 0, segments: [0, 2]}]);
  assert.match(bow.message, /segments 0 and 2/);
  const touch = error({type: 'Polygon', coordinates: [[[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 1], [0, 0]]]});
  assert.deepEqual([touch.code, touch.details], ['self_intersection', {ring: 0, segments: [1, 4]}]);
  const spike = error({type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [2, 4], [2, 6], [2, 5], [0, 4], [0, 0]]]});
  assert.deepEqual(spike.details, {ring: 0, segments: [3, 4]});
  const indexed = error({type: 'Polygon', coordinates: [[[0, 0], [0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]});
  assert.deepEqual(indexed.details.segments, [1, 3], 'indices refer to the input ring, duplicates included');
  const second = error({type: 'Polygon', coordinates: [square(0, 0, 10), [[2, 2], [3, 3], [3, 2], [2, 3], [2, 2]]]});
  assert.deepEqual([second.code, second.details], ['self_intersection', {ring: 1, segments: [0, 2]}]);
  const multi = error({type: 'MultiPolygon', coordinates: [[square(0, 0, 1)], [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]]});
  assert.deepEqual(multi.details, {polygon: 1, ring: 0, segments: [0, 2]});
});

test('rings of one polygon may not share a point; holes must sit inside the exterior', () => {
  const crossing = error({type: 'Polygon', coordinates: [square(0, 0, 10), [[8, 2], [12, 2], [12, 4], [8, 4], [8, 2]]]});
  assert.deepEqual([crossing.code, crossing.details.rings], ['rings_intersect', [0, 1]]);
  const touching = error({type: 'Polygon', coordinates: [square(0, 0, 10), [[0, 5], [3, 4], [3, 6], [0, 5]]]});
  assert.equal(touching.code, 'rings_intersect');
  const holes = error({type: 'Polygon', coordinates: [square(0, 0, 10), square(2, 2, 3, false), square(4, 4, 3, false)]});
  assert.deepEqual([holes.code, holes.details.rings], ['rings_intersect', [1, 2]]);
  assert.deepEqual(error({type: 'Polygon', coordinates: [square(0, 0, 10), square(20, 20, 1, false)]}).details, {ring: 1, reason: 'outside_exterior'});
  assert.deepEqual(error({type: 'Polygon', coordinates: [square(0, 0, 10), square(1, 1, 8, false), square(3, 3, 2, false)]}).details, {ring: 2, reason: 'inside_other_hole'});
  assert.equal(run({type: 'Polygon', coordinates: [square(0, 0, 10), square(1, 1, 2, false), square(5, 5, 2, false)]}).report.accepted, 1);
});

test('MultiPolygon checks every member and names the failing one', () => {
  const good = {type: 'MultiPolygon', coordinates: [[square(0, 0, 1)], [square(5, 5, 1, false)]]};
  const out = only(good);
  assert.ok(twiceArea(out.coordinates[1][0]) > 0);
  assert.deepEqual(warningCodes(good), ['ring_orientation']);
  assert.deepEqual(run(good).report.warnings[0].details, {count: 1, at: [[1, 0]]});
  const bad = error({type: 'MultiPolygon', coordinates: [[square(0, 0, 1)], [[[0, 0], [1, 1], [2, 2], [0, 0]]]]});
  assert.deepEqual([bad.code, bad.details.path], ['ring_zero_area', [1, 0]]);
  assert.equal(error({type: 'MultiPolygon', coordinates: []}).code, 'empty_geometry');
  assert.deepEqual(error({type: 'MultiPolygon', coordinates: [[square(0, 0, 10), square(20, 20, 1, false)]]}).details, {polygon: 0, ring: 1, reason: 'outside_exterior'});
});

test('the first error wins, in a fixed order, and warnings never reject', () => {
  const polygon = {type: 'Polygon', coordinates: [square(0, 0, 4), [[1, 1], [2, 1], [3, 1], [1, 1]], [[1, 1], [200, 1], [3, 3], [1, 1]]]};
  assert.equal(error(polygon).code, 'coordinate_out_of_range', 'coordinate checks run on every ring before the shape checks');
  const messy = {type: 'Polygon', coordinates: [[[0, 0], [0, 0], [0, 4], [4, 4], [4, 0]]]};
  const {report, cleaned} = run(messy);
  assert.equal(cleaned.features.length, 1);
  assert.deepEqual(report.warnings.map(w => w.code).sort(), ['duplicate_positions', 'ring_not_closed', 'ring_orientation']);
  assert.deepEqual(report.counts.warnings, {duplicate_positions: 1, ring_not_closed: 1, ring_orientation: 1});
  assert.deepEqual(report.counts.errors, {});
});

test('antimeridian crossings are flagged as warnings and the geometry is kept as written', () => {
  const line = {type: 'LineString', coordinates: [[179, 10], [-179, 10], [-178, 11]]};
  assert.deepEqual(only(line).coordinates, line.coordinates);
  assert.deepEqual(run(line).report.warnings.map(w => [w.code, w.severity, w.details]), [['antimeridian_crossing', 'warning', {count: 1, at: [[0]]}]]);
  const poly = {type: 'Polygon', coordinates: [[[170, 0], [-170, 0], [-170, 10], [170, 10], [170, 0]]]};
  assert.equal(run(poly).report.accepted, 1);
  assert.ok(warningCodes(poly).includes('antimeridian_crossing'));
  assert.deepEqual(run(line).report.counts, {errors: {}, warnings: {antimeridian_crossing: 1}, nearby: 0});
});

test('bbox and geometry counts cover every kind of accepted geometry', () => {
  const {cleaned, report} = cleanFeatures(collection([
    feature('p', {type: 'Point', coordinates: [1, 2]}),
    feature('l', {type: 'LineString', coordinates: [[-5, 0], [3, 9]]}),
    feature('g', {type: 'Polygon', coordinates: [square(10, -7, 2)]}),
    feature('m', {type: 'MultiPolygon', coordinates: [[square(20, 0, 1)]]})
  ]), {nearMeters: 0});
  assert.deepEqual(report.bbox, [-5, -7, 21, 9]);
  assert.deepEqual(cleaned.bbox, [-5, -7, 21, 9]);
  assert.deepEqual(report.geometries, {LineString: 1, MultiPolygon: 1, Point: 1, Polygon: 1});
});

test('validateGeometry returns the same findings for a geometry on its own', () => {
  const bow = validateGeometry({type: 'Polygon', coordinates: [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]});
  assert.equal(bow.valid, false);
  assert.deepEqual([bow.issues[0].code, bow.issues[0].severity, bow.issues[0].details], ['self_intersection', 'error', {ring: 0, segments: [0, 2]}]);
  const open = validateGeometry({type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1]]]});
  assert.equal(open.valid, true);
  assert.deepEqual(open.issues.map(x => [x.code, x.severity]), [['ring_not_closed', 'warning']]);
  assert.equal(validateGeometry({type: 'MultiPoint', coordinates: [[1, 2]]}).issues.length, 0);
  const tiny = {type: 'Polygon', coordinates: [[[0, 0], [0.4, 0], [0, 0.4], [0, 0]]]};
  assert.equal(validateGeometry(tiny, {precision: 0}).issues[0].code, 'ring_too_short', 'rounded to whole degrees the triangle collapses to one point');
  assert.equal(validateGeometry(tiny, {precision: 1}).valid, true);
  assert.equal(validateGeometry(tiny).valid, true);
});
