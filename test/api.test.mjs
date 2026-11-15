import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as api from '../index.mjs';
import {cleanPoints} from '../quality.mjs';
import {readJson, deepFreeze, collection, point, root} from './support/helpers.mjs';

const sample = await readJson('sample/facilities.geojson');
const pkg = await readJson('package.json');

test('the entry point exports the documented API and nothing else', () => {
  assert.deepEqual(Object.keys(api).sort(), ['ISSUE_CODES', 'VERSION', 'cleanFeatures', 'cleanPoints', 'validateGeometry']);
  assert.equal(api.cleanPoints, cleanPoints);
});

test('cleanPoints still reproduces the committed sample report exactly', async () => {
  const {cleaned, report} = api.cleanPoints(sample);
  assert.deepEqual(report, await readJson('sample/example-report.json'));
  assert.equal(cleaned.features.length, 4);
});

test('cleanFeatures restricted to points gives the same cleaned output and facts as cleanPoints', () => {
  const legacy = cleanPoints(sample), next = api.cleanFeatures(sample, {geometryTypes: ['Point']});
  assert.deepEqual(next.cleaned, legacy.cleaned);
  for (const key of ['input', 'accepted', 'rejected', 'precision', 'bbox', 'nearMeters', 'nearby', 'categories'])
    assert.deepEqual(next.report[key], legacy.report[key], key);
  assert.deepEqual(next.report.issues.map(x => [x.index, x.id, x.code, x.severity]), [
    [2, 'site-01', 'duplicate_id', 'error'],
    [4, 'SITE-04', 'coordinate_out_of_range', 'error'],
    [5, 'SITE-05', 'geometry_type_not_allowed', 'error'],
    [6, 'SITE-06', 'missing_property', 'error']
  ]);
  assert.equal(next.report.issues[0].details.keptIndex, 0);
  assert.equal(next.report.issues[3].details.property, 'name');
  assert.ok(next.report.issues.every(x => typeof x.message === 'string' && x.message.length > 10));
});

test('the v2 report carries the schema version, tool version, options and counts', () => {
  const {report} = api.cleanFeatures(sample, {geometryTypes: ['Point'], precision: 5});
  assert.equal(report.schemaVersion, 2);
  assert.deepEqual(report.tool, {name: 'geojson-quality-kit', version: pkg.version});
  assert.equal(api.VERSION, pkg.version);
  assert.equal(report.options.precision, 5);
  assert.equal(report.precision, 5);
  assert.deepEqual(report.counts.errors, {coordinate_out_of_range: 1, duplicate_id: 1, geometry_type_not_allowed: 1, missing_property: 1});
  assert.equal(report.accepted + report.rejected, report.input);
  assert.deepEqual(report.warnings, []);
});

test('validateGeometry reports findings without touching the geometry', () => {
  const ok = deepFreeze({type: 'Point', coordinates: [79.9, 6.9, 12]});
  assert.deepEqual(api.validateGeometry(ok), {valid: true, issues: []});
  const bad = api.validateGeometry({type: 'Point', coordinates: [181, 6.9]});
  assert.equal(bad.valid, false);
  assert.deepEqual(bad.issues.map(x => [x.code, x.severity]), [['coordinate_out_of_range', 'error']]);
  assert.equal(api.validateGeometry(null).issues[0].code, 'null_geometry');
  assert.equal(api.validateGeometry({type: 'GeometryCollection', geometries: []}).issues[0].code, 'geometry_collection_unsupported');
  assert.equal(api.validateGeometry({type: 'Circle'}).issues[0].code, 'unknown_geometry_type');
  assert.equal(api.validateGeometry({type: 'LineString', coordinates: [[1, 2], [3, 4]]}, {geometryTypes: ['Point']}).issues[0].code, 'geometry_type_not_allowed');
});

test('inputs are never mutated, even when deep-frozen', () => {
  const input = deepFreeze(JSON.parse(JSON.stringify(sample)));
  const {cleaned} = api.cleanFeatures(input, {geometryTypes: ['Point']});
  assert.equal(cleaned.features.length, 4);
  assert.notEqual(cleaned.features[0].geometry.coordinates, input.features[0].geometry.coordinates);
});

test('options are checked with specific messages', () => {
  const empty = collection([]);
  assert.throws(() => api.cleanFeatures({type: 'Feature'}), /FeatureCollection/);
  assert.throws(() => api.cleanFeatures(empty, {precision: 9}), /Precision must be an integer from 0 to 8/);
  assert.throws(() => api.cleanFeatures(empty, {nearMeters: 1001}), /Proximity radius must be from 0 to 1000 metres/);
  assert.throws(() => api.cleanFeatures(empty, {nearMeter: 5}), /Unknown option "nearMeter"/);
  assert.throws(() => api.cleanFeatures(empty, {geometryTypes: ['Circle']}), /geometryTypes/);
  assert.throws(() => api.cleanFeatures(empty, {groupBy: 'colour'}), /groupBy/);
  assert.throws(() => api.cleanFeatures(empty, {fields: ['a:shout']}), /Field "a:shout"/);
  assert.throws(() => api.cleanFeatures(empty, {maxItems: -1}), /maxItems/);
  assert.equal(api.cleanFeatures(empty).cleaned.bbox, undefined);
  assert.equal(api.cleanFeatures(empty).report.bbox, null);
});

test('fields choose the required properties, their case and allowed values', () => {
  const zone = (id, level) => point(id, [1, 2], {name: ' North  inlet ', level});
  const input = collection([zone('z1', 'HIGH'), zone('z2', 'severe'), zone('z3', undefined)]);
  const {cleaned, report} = api.cleanFeatures(input, {fields: ['name', 'level:lower=low|moderate|high', 'id'], groupBy: 'level'});
  assert.deepEqual(cleaned.features.map(f => f.properties), [{name: 'North inlet', level: 'high', id: 'Z1'}]);
  assert.deepEqual(report.issues.map(x => [x.code, x.details.property]), [['invalid_property_value', 'level'], ['missing_property', 'level']]);
  assert.deepEqual(report.issues[0].details.allowed, ['low', 'moderate', 'high']);
  assert.deepEqual(report.categories, {high: 1});
});

test('package.json describes the published surface', () => {
  assert.equal(pkg.version, '1.0.0');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.private, true);
  assert.equal(pkg.license, 'UNLICENSED');
  assert.equal(pkg.types, './index.d.ts');
  assert.deepEqual(pkg.bin, {'geojson-quality': 'cli.mjs'});
  assert.deepEqual(pkg.engines, {node: '>=22'});
  assert.deepEqual(pkg.exports['.'], {types: './index.d.ts', default: './index.mjs'});
  assert.equal(pkg.dependencies, undefined);
});

test('npm pack lists exactly the intended files', () => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {cwd: fileURLToPath(root), encoding: 'utf8', shell: process.platform === 'win32'});
  const listed = JSON.parse(out)[0].files.map(f => f.path).sort();
  const lib = readdirSync(new URL('lib/', root)).map(f => 'lib/' + f);
  const top = ['README.md', 'cli.mjs', 'index.d.ts', 'index.mjs', 'package.json', 'quality.mjs']
    .concat(['report.schema.json', 'stream.mjs'].filter(f => readdirSync(root).includes(f)));
  assert.deepEqual(listed, [...top, ...lib].sort());
  assert.ok(lib.length >= 5);
});
