import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, readFile, writeFile, readdir, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {cleanPoints, cleanFeatures} from '../index.mjs';
import {readJson, root} from './support/helpers.mjs';
import {everyRule} from './support/cases.mjs';

// GEOJSON_QUALITY_CLI lets the same tests run against another build of the command, for example
// the original one, to see which behaviours are new and which are kept.
const cli = process.env.GEOJSON_QUALITY_CLI ?? fileURLToPath(new URL('../cli.mjs', import.meta.url));
const sampleFile = fileURLToPath(new URL('../sample/facilities.geojson', import.meta.url));
const sample = await readJson('sample/facilities.geojson');
const pkg = await readJson('package.json');
const validate = new Ajv2020({strict: true}).compile(await readJson('report.schema.json'));

function geo(args, input) {
  const r = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', input});
  return {status: r.status, out: r.stdout, err: r.stderr};
}
async function inTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'geoq-'));
  try { return await fn(dir); } finally { await rm(dir, {recursive: true, force: true}); }
}
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const lines = text => text.split('\n').filter(Boolean);

test('legacy form: INPUT OUTPUT writes the original files, byte for byte', () => inTemp(async dir => {
  const r = geo([sampleFile, dir]);
  assert.equal(r.status, 0);
  assert.equal(r.out, 'Accepted 4 of 8 features; rejected 4.\n' + join(dir, 'clean.geojson') + '\n' + join(dir, 'report.json') + '\n');
  assert.equal(await readFile(join(dir, 'report.json'), 'utf8'), await readFile(new URL('sample/example-report.json', root), 'utf8'));
  assert.deepEqual(await json(join(dir, 'clean.geojson')), cleanPoints(sample).cleaned);
  assert.deepEqual((await readdir(dir)).sort(), ['clean.geojson', 'report.json']);
}));

test('legacy form: positional precision and proximity radius', () => inTemp(async dir => {
  assert.equal(geo([sampleFile, dir, '5', '20']).status, 0);
  const report = await json(join(dir, 'report.json'));
  assert.deepEqual([report.precision, report.nearMeters, report.accepted, report.schemaVersion], [5, 20, 4, undefined]);
  assert.deepEqual((await json(join(dir, 'clean.geojson'))).features[0].geometry.coordinates, [79.90235, 6.92352]);
}));

test('legacy form: failures keep their message and exit codes', () => inTemp(async dir => {
  let r = geo([sampleFile, dir, '9']);
  assert.deepEqual([r.status, r.out, r.err], [1, '', 'Could not process the dataset: Precision must be an integer from 0 to 8.\n']);
  r = geo([join(dir, 'missing.geojson'), dir]);
  assert.equal(r.status, 1);
  assert.match(r.err, /^Could not process the dataset: ENOENT/);
  r = geo([sampleFile, dir, '5', '20', 'extra']);
  assert.deepEqual([r.status, r.err], [2, 'Usage: node cli.mjs INPUT.geojson OUTPUT_DIRECTORY [PRECISION] [PROXIMITY_METRES]\n']);
  await writeFile(join(dir, 'a.json'), '{"type":"FeatureCollection","features":[]}');
  r = geo([join(dir, 'a.json'), dir]);
  assert.deepEqual([r.status, r.err], [0, '']);
  r = geo([join(dir, 'report.json'), dir]);
  assert.deepEqual([r.status, r.err], [1, 'Could not process the dataset: Choose a different output directory from the source files.\n']);
}));

test('--help, --version and a missing input', () => {
  const help = geo(['--help']);
  assert.equal(help.status, 0);
  for (const word of ['--precision', '--near', '--format', '--report-only', '--strict', '--quiet', '--ndjson', '--types', '--fields', 'Exit codes']) assert.ok(help.out.includes(word), word);
  assert.deepEqual([geo(['--version']).status, geo(['--version']).out], [0, pkg.version + '\n']);
  const none = geo([]);
  assert.equal(none.status, 2);
  assert.match(none.err, /No INPUT given.*or - to read standard input/);
});

test('a run with options cleans every geometry type, writes both files and a valid v2 report', () => inTemp(async dir => {
  const r = geo([sampleFile, dir, '--precision', '5', '--near=15']);
  assert.equal(r.status, 0);
  assert.equal(r.out, 'Accepted 5 of 8 features; rejected 3; 0 warnings.\n' + join(dir, 'clean.geojson') + '\n' + join(dir, 'report.json') + '\n');
  const report = await json(join(dir, 'report.json'));
  assert.equal(validate(report), true);
  assert.deepEqual([report.schemaVersion, report.precision, report.geometries], [2, 5, {LineString: 1, Point: 4}]);
  assert.equal((await json(join(dir, 'clean.geojson'))).features.length, 5);
}));

test('--types point gives the same cleaned points as the original tool', () => inTemp(async dir => {
  assert.equal(geo([sampleFile, dir, '--types', 'point']).status, 0);
  assert.deepEqual(await json(join(dir, 'clean.geojson')), cleanPoints(sample).cleaned);
  assert.deepEqual((await json(join(dir, 'report.json'))).issues.map(x => x.code), ['duplicate_id', 'coordinate_out_of_range', 'geometry_type_not_allowed', 'missing_property']);
}));

test('without OUTPUT_DIR the cleaned data goes to stdout and the summary to stderr', () => {
  const r = geo([sampleFile, '--types', 'Point']);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.out), cleanPoints(sample).cleaned);
  assert.equal(r.err, 'Accepted 4 of 8 features; rejected 4; 0 warnings.\n');
  const quiet = geo([sampleFile, '--quiet']);
  assert.deepEqual([quiet.status, quiet.err, JSON.parse(quiet.out).features.length], [0, '', 5]);
});

test('standard input, --report-only and --format ndjson', () => inTemp(async dir => {
  const text = JSON.stringify(sample);
  const report = geo(['-', '--report-only', '--quiet'], text);
  assert.equal(report.status, 0);
  assert.equal(validate(JSON.parse(report.out)), true);
  const nd = geo(['-', '--format', 'ndjson', '--quiet', '--types', 'Point'], text);
  assert.deepEqual(lines(nd.out).map(l => JSON.parse(l)), cleanPoints(sample).cleaned.features);
  assert.equal(geo(['-', dir, '--format', 'ndjson', '--quiet'], text).status, 0);
  assert.equal(lines(await readFile(join(dir, 'clean.ndjson'), 'utf8')).length, 5);
  assert.deepEqual((await readdir(dir)).sort(), ['clean.ndjson', 'report.json']);
  const only = join(dir, 'only');
  assert.equal(geo(['-', only, '--report-only', '--quiet'], text).status, 0);
  assert.deepEqual(await readdir(only), ['report.json']);
}));

const ndjsonText = () => [
  JSON.stringify(sample.features[0]), '', '{"type": "Feature", "id": "x", ', JSON.stringify(sample.features[1]),
  JSON.stringify(sample.features[2]), JSON.stringify({type: 'Feature', id: 'multi', properties: {name: 'M', category: 'c'}, geometry: {type: 'MultiPoint', coordinates: [[1, 2], [3, 4]]}}), '[1,2]'
].join('\n');

test('NDJSON input is detected from .ndjson, .jsonl or --ndjson, streamed, and bad lines are reported', () => inTemp(async dir => {
  for (const file of ['in.ndjson', 'in.JSONL', 'in.txt']) await writeFile(join(dir, file), ndjsonText());
  for (const [file, extra] of [['in.ndjson', []], ['in.JSONL', []], ['in.txt', ['--ndjson']]]) {
    const out = join(dir, 'out-' + file);
    const r = geo([join(dir, file), out, ...extra]);
    assert.equal(r.status, 0, r.err);
    const report = await json(join(out, 'report.json'));
    assert.equal(validate(report), true);
    assert.deepEqual([report.input, report.accepted, report.rejected, report.output], [6, 3, 3, 4]);
    assert.deepEqual(report.issues.map(x => [x.index, x.code]), [[1, 'invalid_json'], [3, 'duplicate_id'], [5, 'invalid_feature']]);
    assert.equal(report.issues[0].details.line, 3, 'the line number counts the blank line');
    const cleaned = await json(join(out, 'clean.geojson'));
    assert.deepEqual(cleaned.features.map(f => f.id), ['SITE-01', 'SITE-02', 'MULTI-1', 'MULTI-2']);
    assert.deepEqual(cleaned.bbox, report.bbox);
  }
  const nd = geo([join(dir, 'in.ndjson'), '--format', 'ndjson', '--quiet']);
  assert.equal(lines(nd.out).length, 4);
  const stdin = geo(['-', '--ndjson', '--report-only', '--quiet'], ndjsonText());
  assert.equal(JSON.parse(stdin.out).input, 6);
  const missing = geo([join(dir, 'gone.ndjson')]);
  assert.equal(missing.status, 3);
  assert.match(missing.err, /cannot read ".*gone.ndjson": no such file or directory\. Check the path/);
  assert.deepEqual((await readdir(dir)).filter(x => x.startsWith('clean')), []);
}));

test('--strict exits 1 only when something was rejected; the files are still written', () => inTemp(async dir => {
  const r = geo([sampleFile, dir, '--strict', '--quiet']);
  assert.equal(r.status, 1);
  assert.match(r.err, /--strict: 3 of 8 features were rejected; see .*report\.json\./);
  assert.equal((await json(join(dir, 'report.json'))).rejected, 3);
  const noDir = geo([sampleFile, '--strict', '--quiet']);
  assert.deepEqual([noDir.status, noDir.err], [1, '--strict: 3 of 8 features were rejected.\n']);
  const good = geo(['-', '--strict', '--quiet'], JSON.stringify({type: 'FeatureCollection', features: sample.features.slice(0, 2)}));
  assert.deepEqual([good.status, good.err], [0, '']);
}));

test('settings: fields, group-by, max-items and the alternative option spelling', () => inTemp(async dir => {
  const zones = {type: 'FeatureCollection', features: [
    {type: 'Feature', id: 'z1', properties: {name: 'North', level: 'HIGH'}, geometry: {type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]]}},
    {type: 'Feature', id: 'z2', properties: {name: 'South', level: 'severe'}, geometry: {type: 'Polygon', coordinates: [[[2, 0], [2, 1], [3, 1], [3, 0], [2, 0]]]}}
  ]};
  const r = geo(['-', dir, '--quiet', '--types', 'polygon, multipolygon', '--fields', 'name,level:lower=low|moderate|high', '--group-by=level', '--max-items', '0'], JSON.stringify(zones));
  assert.equal(r.status, 0, r.err);
  const report = await json(join(dir, 'report.json'));
  assert.deepEqual([report.categories, report.issues, report.truncated.issues, report.counts.errors], [{high: 1}, [], true, {invalid_property_value: 1}]);
  assert.deepEqual((await json(join(dir, 'clean.geojson'))).features[0].properties, {name: 'North', level: 'high'});
  const all = geo(['-', '--report-only', '--quiet', '--max-items', 'all', '--group-by', 'none', '--fields', 'name,level'], JSON.stringify(zones));
  assert.deepEqual([JSON.parse(all.out).options.maxItems, JSON.parse(all.out).options.groupBy], [null, null]);
}));

test('usage errors exit 2 with a message that names the fix', () => {
  const bad = (args, pattern, input) => {
    const r = geo(args, input);
    assert.equal(r.status, 2, args.join(' ') + ' -> ' + r.err);
    assert.match(r.err, pattern);
    assert.match(r.err, /Run geojson-quality --help for usage\.\n$/);
    assert.equal(r.out, '');
  };
  bad([sampleFile, '--frobnicate'], /Unknown option --frobnicate\. Run geojson-quality --help/);
  bad([sampleFile, '--precision'], /--precision needs a value, for example --precision N\./);
  bad([sampleFile, '--precision', '--quiet'], /--precision needs a value/);
  bad([sampleFile, '--precision', '9'], /--precision must be a whole number from 0 to 8 \(got "9"\)\./);
  bad([sampleFile, '--precision', '2.5'], /whole number/);
  bad([sampleFile, '--near', 'abc'], /--near must be a number of metres from 0 to 1000 \(got "abc"\)\./);
  bad([sampleFile, '--near', ''], /--near must be a number of metres/);
  bad([sampleFile, '--near', '1001'], /0 to 1000/);
  bad([sampleFile, '--format', 'xml'], /--format must be geojson or ndjson \(got "xml"\)\./);
  bad([sampleFile, '--types', 'Circle'], /--types: "Circle" is not a geometry type\. Use: Point, MultiPoint/);
  bad([sampleFile, '--fields', 'a:shout'], /Field "a:shout" must look like name, name:lower or name:lower=a\|b\|c\. Check --types/);
  bad([sampleFile, '--group-by', 'colour'], /groupBy must be null or the name of one of the fields/);
  bad([sampleFile, '--max-items', '-1'], /--max-items must be a whole number of 0 or more, or all \(got "-1"\)\./);
  bad([sampleFile, '--quiet=yes'], /--quiet does not take a value\./);
  bad(['a', 'b', 'c', '--quiet'], /Too many arguments \("c"\)\. Use geojson-quality INPUT \[OUTPUT_DIR\]/);
  bad(['-', '--strict', 'x', 'y'], /Too many arguments/, '');
});

test('the input is never overwritten', () => inTemp(async dir => {
  await writeFile(join(dir, 'clean.geojson'), JSON.stringify(sample));
  const r = geo([join(dir, 'clean.geojson'), dir, '--quiet']);
  assert.equal(r.status, 2);
  assert.match(r.err, /would overwrite the input file ".*clean\.geojson"\. Choose a different OUTPUT_DIR/);
  assert.equal((await json(join(dir, 'clean.geojson'))).features.length, 8);
  await writeFile(join(dir, 'report.json'), JSON.stringify(sample));
  assert.equal(geo([join(dir, 'report.json'), dir, '--report-only']).status, 2);
}));

test('unreadable or invalid input exits 3 and says what to do', () => inTemp(async dir => {
  const fail = (args, pattern, input) => {
    const r = geo(args, input);
    assert.equal(r.status, 3, args.join(' ') + ' -> ' + r.err);
    assert.match(r.err, pattern);
    assert.equal(r.out, '');
  };
  fail([join(dir, 'nope.geojson'), '--quiet'], /^geojson-quality: cannot read ".*nope\.geojson": no such file or directory\. Check the path, or use - to read standard input\.\n$/);
  fail([dir, '--quiet'], /cannot read .*: it is a directory\./);
  await writeFile(join(dir, 'bad.json'), '{\n  "type": "FeatureCollection",\n  "features": [,]\n}');
  fail([join(dir, 'bad.json')], /"[^"]*bad\.json" is not valid JSON: Unexpected character "," at line 3, column 16\. If the file holds one Feature per line, add --ndjson\./);
  await writeFile(join(dir, 'one.json'), JSON.stringify(sample.features[0]));
  fail([join(dir, 'one.json')], /one\.json": Input must be a GeoJSON FeatureCollection, but it is a single Feature; wrap it as/);
  fail(['-'], /standard input is not valid JSON: Unexpected end of the text at line 1, column 1/, '');
  fail(['-', '--quiet'], /standard input: Input must be a GeoJSON FeatureCollection, but it is an array/, '[]');
  await writeFile(join(dir, 'file'), 'x');
  fail([sampleFile, join(dir, 'file', 'sub'), '--quiet'], /cannot create the output directory/);
  await writeFile(join(dir, 'ok.json'), JSON.stringify(sample));
  await mkdir(join(dir, 'blocked', 'report.json'), {recursive: true});
  fail([join(dir, 'ok.json'), join(dir, 'blocked'), '--report-only', '--quiet'], /cannot write ".*report\.json": it is a directory\./);
}));

test('a byte order mark in front of the JSON is ignored', () => inTemp(async dir => {
  await writeFile(join(dir, 'bom.geojson'), '﻿' + JSON.stringify(sample));
  const r = geo([join(dir, 'bom.geojson'), '--report-only', '--quiet']);
  assert.equal(JSON.parse(r.out).input, 8);
}));

test('the whole pipeline agrees with the library on a mixed file', () => inTemp(async dir => {
  const input = everyRule();
  await writeFile(join(dir, 'mixed.geojson'), JSON.stringify(input));
  assert.equal(geo([join(dir, 'mixed.geojson'), join(dir, 'out'), '--quiet', '--fields', 'name,category:lower=park|school|clinic', '--types', 'Point,MultiPoint,LineString,MultiLineString,Polygon']).status, 0);
  const {cleaned, report} = cleanFeatures(input, {fields: ['name', 'category:lower=park|school|clinic'], geometryTypes: ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon']});
  assert.deepEqual(await json(join(dir, 'out', 'clean.geojson')), cleaned);
  assert.deepEqual(await json(join(dir, 'out', 'report.json')), report);
}));
