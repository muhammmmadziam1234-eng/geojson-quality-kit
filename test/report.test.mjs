import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import {cleanFeatures, cleanPoints, ISSUE_CODES} from '../index.mjs';
import {readJson, clone, collection, point} from './support/helpers.mjs';
import {everyRule, EVERY_RULE_OPTIONS} from './support/cases.mjs';

const schema = await readJson('report.schema.json');
const validate = new Ajv2020({strict: true, allErrors: true}).compile(schema);
const sample = await readJson('sample/facilities.geojson');
const accept = (report, label = '') => assert.equal(validate(report), true, label + JSON.stringify(validate.errors?.slice(0, 3)));
const reject = (report, label) => assert.equal(validate(report), false, label);
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

// Facts a JSON Schema cannot express.
function invariants(r) {
  assert.equal(r.accepted + r.rejected, r.input);
  assert.equal(sum(r.counts.errors), r.rejected);
  assert.equal(sum(r.geometries), r.output);
  assert.equal(r.precision, r.options.precision);
  assert.equal(r.nearMeters, r.options.nearMeters);
  if (r.options.groupBy !== null) assert.equal(sum(r.categories), r.output);
  assert.equal(r.truncated.issues, r.issues.length < r.rejected);
  assert.equal(r.truncated.nearby, r.nearby.length < r.counts.nearby);
  assert.ok(r.issues.every(x => x.index < r.input), 'issue indices point into the input');
  assert.ok(r.issues.every((x, i, all) => i === 0 || all[i - 1].index < x.index), 'issues are in input order');
  assert.equal(r.bbox === null, r.output === 0);
}

const reports = () => ({
  sample: cleanFeatures(sample, {geometryTypes: ['Point']}).report,
  sampleAllTypes: cleanFeatures(sample).report,
  everyRule: cleanFeatures(everyRule(), EVERY_RULE_OPTIONS).report,
  empty: cleanFeatures(collection([])).report,
  truncated: cleanFeatures(everyRule(), {...EVERY_RULE_OPTIONS, maxItems: 2}).report,
  noLimit: cleanFeatures(everyRule(), {...EVERY_RULE_OPTIONS, maxItems: null, nearMeters: 0}).report,
  zeroItems: cleanFeatures(everyRule(), {...EVERY_RULE_OPTIONS, maxItems: 0}).report,
  noGroup: cleanFeatures(collection([point('a', [1, 2], {name: 'x', level: 'high'})]), {fields: ['name', 'level:upper=HIGH|LOW'], groupBy: null}).report
});

test('real reports validate against report.schema.json and keep their invariants', () => {
  for (const [label, report] of Object.entries(reports())) { accept(report, label + ': '); invariants(report); }
});

test('the schema lists exactly the documented codes, split by severity', () => {
  const byLevel = level => Object.entries(ISSUE_CODES).filter(([, v]) => v.severity === level).map(([k]) => k).sort();
  assert.deepEqual([...schema.$defs.errorCode.enum].sort(), byLevel('error'));
  assert.deepEqual([...schema.$defs.warningCode.enum].sort(), byLevel('warning'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.schemaVersion.const, 2);
});

test('one collection exercises every documented code except invalid_json', () => {
  const {report} = cleanFeatures(everyRule(), EVERY_RULE_OPTIONS);
  const seen = [...Object.keys(report.counts.errors), ...Object.keys(report.counts.warnings)].sort();
  assert.deepEqual(seen, Object.keys(ISSUE_CODES).filter(c => c !== 'invalid_json').sort());
  assert.deepEqual(report.nearby.map(x => x.ids), [['MULTI-1', 'MULTI-2'], ['NEAR-A', 'NEAR-B']]);
});

test('lists are cut at maxItems while the counts stay exact', () => {
  const full = cleanFeatures(everyRule(), EVERY_RULE_OPTIONS).report, cut = cleanFeatures(everyRule(), {...EVERY_RULE_OPTIONS, maxItems: 2}).report;
  assert.deepEqual(cut.counts, full.counts);
  assert.deepEqual([cut.issues.length, cut.warnings.length, cut.nearby.length], [2, 2, 2]);
  assert.deepEqual(cut.truncated, {issues: true, warnings: true, nearby: false});
  assert.deepEqual(cut.issues, full.issues.slice(0, 2));
  const none = cleanFeatures(everyRule(), {...EVERY_RULE_OPTIONS, maxItems: 0}).report;
  assert.deepEqual([none.issues, none.warnings, none.nearby, none.truncated.nearby], [[], [], [], true]);
  assert.equal(none.counts.nearby, 2);
});

test('the schema rejects reports that break the format', () => {
  const base = reports().everyRule;
  const mutate = (label, fn) => { const r = clone(base); fn(r); reject(r, label); };
  mutate('wrong schemaVersion', r => { r.schemaVersion = 1; });
  mutate('missing tool', r => { delete r.tool; });
  mutate('unknown top-level key', r => { r.extra = true; });
  mutate('a warning code in issues', r => { r.issues[0].code = 'multipoint_exploded'; });
  mutate('error severity on a warning', r => { r.warnings[0].severity = 'error'; });
  mutate('issue without details', r => { delete r.issues[0].details; });
  mutate('negative index', r => { r.issues[0].index = -1; });
  mutate('three-number bbox', r => { r.bbox = [1, 2, 3]; });
  mutate('unknown code count', r => { r.counts.errors.nonsense = 1; });
  mutate('precision out of range', r => { r.options.precision = 9; });
  mutate('nearby pair of three', r => { r.nearby[0].ids.push('X'); });
  mutate('geometry count for MultiPoint', r => { r.geometries.MultiPoint = 1; });
  mutate('fractional count', r => { r.input = 1.5; });
});

test('the version 1 report from cleanPoints is a different, older format', () => {
  const legacy = cleanPoints(sample).report;
  assert.equal(legacy.schemaVersion, undefined);
  reject(legacy, 'v1 report');
  const v2 = cleanFeatures(sample, {geometryTypes: ['Point']}).report;
  for (const key of ['input', 'accepted', 'rejected', 'precision', 'bbox', 'nearMeters', 'nearby', 'categories']) assert.deepEqual(v2[key], legacy[key], key);
  assert.deepEqual(v2.issues.map(x => [x.index, x.id]), legacy.issues.map(x => [x.index, x.id]));
});
