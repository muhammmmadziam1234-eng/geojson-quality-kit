import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable, Writable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {cleanNdjson} from '../stream.mjs';
import {cleanFeatures} from '../index.mjs';
import {everyRule, EVERY_RULE_OPTIONS} from './support/cases.mjs';
import {readJson, point} from './support/helpers.mjs';

const toNdjson = features => features.map(f => JSON.stringify(f)).join('\n') + '\n';
async function stream(text, options, format = 'ndjson') {
  const chunks = [];
  const output = new Writable({write(chunk, encoding, done) { chunks.push(chunk.toString()); done(); }});
  const report = await cleanNdjson(Readable.from([text]), {options, output, format});
  return {report, text: chunks.join('')};
}

test('streaming gives the same features and report as cleaning in memory', async () => {
  const input = everyRule(), memory = cleanFeatures(input, EVERY_RULE_OPTIONS);
  const nd = await stream(toNdjson(input.features), EVERY_RULE_OPTIONS);
  assert.deepEqual(nd.report, memory.report);
  assert.deepEqual(nd.text.split('\n').filter(Boolean).map(l => JSON.parse(l)), memory.cleaned.features);
  const geo = await stream(toNdjson(input.features), EVERY_RULE_OPTIONS, 'geojson');
  assert.deepEqual(JSON.parse(geo.text), memory.cleaned);
  assert.ok(geo.text.startsWith('{"type":"FeatureCollection","features":[\n{"type":"Feature"'));
});

test('an empty stream gives an empty collection and no bbox', async () => {
  const geo = await stream('', {}, 'geojson');
  assert.deepEqual(JSON.parse(geo.text), {type: 'FeatureCollection', features: []});
  assert.equal(geo.report.bbox, null);
  assert.equal((await stream('\n\n  \n', {}, 'ndjson')).text, '');
});

test('line endings, blank lines and a last line without a newline are handled; bad lines keep their file line number', async () => {
  const a = JSON.stringify(point('a', [1, 2])), b = JSON.stringify(point('b', [3, 4]));
  const {report} = await stream(a + '\r\n\r\n{"type": \r\n' + b + '\r\n   \r\n[', {nearMeters: 0});
  assert.deepEqual([report.input, report.accepted, report.rejected], [4, 2, 2]);
  assert.deepEqual(report.issues.map(x => [x.index, x.code, x.details.line]), [[1, 'invalid_json', 3], [3, 'invalid_json', 6]]);
  assert.deepEqual(report.issues[0].details.message, 'Unexpected end of the text');
  assert.match(report.issues[1].message, /^Line 6 is not valid JSON: Unexpected end of the text\./);
});

test('report lists stay bounded however many records fail, and the counts stay exact', async () => {
  const bad = JSON.stringify({type: 'Feature', properties: {}, geometry: null});
  const text = Array.from({length: 20000}, () => bad).join('\n');
  const {report} = await stream(text, {maxItems: 50}, 'ndjson');
  assert.deepEqual([report.rejected, report.issues.length, report.counts.errors, report.truncated.issues], [20000, 50, {invalid_id: 20000}, true]);
  assert.equal(report.issues[49].index, 49);
});

test('a slow consumer is waited for: nothing is lost or reordered', async () => {
  const features = Array.from({length: 4000}, (_, i) => point('p' + i, [i / 100, 1]));
  const seen = [];
  let refused = 0;
  const output = new Writable({highWaterMark: 8, write(chunk, encoding, done) { seen.push(chunk.toString()); setImmediate(done); }});
  const write = output.write.bind(output);
  output.write = chunk => { const ok = write(chunk); if (!ok) refused++; return ok; };
  const report = await cleanNdjson(Readable.from([toNdjson(features)]), {options: {nearMeters: 0}, output, format: 'ndjson'});
  const ids = seen.join('').split('\n').filter(Boolean).map(l => JSON.parse(l).id);
  assert.equal(report.output, 4000);
  assert.deepEqual(ids, features.map(f => f.id.toUpperCase()));
  assert.ok(refused > 0, 'the writer was full at least once');
});

test('bad arguments and read errors surface as rejections', async () => {
  await assert.rejects(cleanNdjson(Readable.from([]), {format: 'csv'}), /format must be geojson or ndjson/);
  await assert.rejects(cleanNdjson(Readable.from([]), {options: {precision: 99}}), /Precision/);
  const broken = new Readable({read() { this.destroy(new Error('disk gone')); }});
  await assert.rejects(cleanNdjson(broken, {}), /disk gone/);
  const report = await cleanNdjson(Readable.from([toNdjson([point('x', [1, 1])])]));
  assert.equal(report.accepted, 1);
});

test('the benchmark runs, checks streaming against memory, and the committed evidence is a complete large run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'geoq-bench-test-'));
  try {
    const out = join(dir, 'result.json');
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../benchmark.mjs', import.meta.url)), '--out', out], {encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    const result = JSON.parse(await readFile(out, 'utf8'));
    assert.deepEqual(JSON.parse(r.stdout), result);
    assert.equal(result.mode, 'small');
    assert.equal(result.streamingMatchesInMemory, true);
    assert.equal(result.result.accepted + result.result.rejected, result.data.records);
    assert.ok(result.pipeline.peakRssMB > 0 && result.pipeline.seconds > 0);
  } finally { await rm(dir, {recursive: true, force: true}); }
  const evidence = await readJson('docs/evidence/benchmark.json');
  assert.deepEqual([evidence.mode, evidence.data.points, evidence.data.polygons], ['large', 1000000, 50000]);
  assert.equal(evidence.result.accepted + evidence.result.rejected, 1050000);
  assert.equal(evidence.result.input, 1050000);
  assert.ok(evidence.machine.cpu && evidence.machine.node.startsWith('v'));
});
