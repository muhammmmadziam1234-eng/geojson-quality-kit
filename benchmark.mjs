// Generates seeded synthetic features, runs them through the streaming pipeline in a fresh
// process and reports time and peak memory.
//   npm run benchmark                    20,000 points and 1,000 polygons; prints the result
//   npm run benchmark -- --large         1,000,000 points and 50,000 polygons; writes docs/evidence/benchmark.json
//   --out FILE                           write the result to FILE
import {createWriteStream, createReadStream, readFileSync} from 'node:fs';
import {mkdtemp, rm, stat, mkdir, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import {spawnSync} from 'node:child_process';
import {cpus, tmpdir, totalmem} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {rng} from './test/support/rng.mjs';
import {cleanNdjson} from './stream.mjs';
import {cleanFeatures} from './index.mjs';

const SEED = 20261115, OPTIONS = {precision: 6, nearMeters: 15, maxItems: 1000};
const CATEGORIES = ['clinic', 'school', 'depot', 'library', 'station'];
const pad = (n, width) => String(n).padStart(width, '0');

function* records(points, polygons) {
  const r = rng(SEED);
  for (let i = 0; i < points; i++) {
    const lon = r.float(79.5, 80.5), lat = r.float(6.5, 7.5), roll = r.next();
    let id = 'P' + pad(i, 7), geometry = {type: 'Point', coordinates: [lon, lat]}, name = 'Site ' + i;
    if (roll < 0.002 && i > 0) id = 'P' + pad(r.int(0, i - 1), 7);        // repeats an earlier id
    else if (roll < 0.004) geometry.coordinates[0] = 180 + r.float(0.5, 20); // longitude out of range
    else if (roll < 0.005) name = '  ';                                    // blank required property
    else if (roll < 0.0055) { yield '{"type":"Feature","id":"' + id + '",'; continue; } // a line that is not JSON
    else if (roll < 0.006) geometry = null;
    yield JSON.stringify({type: 'Feature', id, geometry, properties: {name, category: r.pick(CATEGORIES)}});
  }
  for (let i = 0; i < polygons; i++) {
    const cx = r.float(79.5, 80.5), cy = r.float(6.5, 7.5), n = r.int(8, 24), rmin = r.float(0.0008, 0.002), rmax = rmin * r.float(1.2, 2);
    const ring = Array.from({length: n}, (_, k) => {
      const angle = (k + r.float(-0.3, 0.3)) * 2 * Math.PI / n, radius = r.float(rmin, rmax);
      return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
    });
    if (r.chance(0.01)) { const k = r.int(1, n - 3); [ring[k], ring[k + 1]] = [ring[k + 1], ring[k]]; } // swapped corners: usually self-crossing
    const rings = [[...ring, ring[0]]];
    if (r.chance(0.05)) {                           // a hole, wound clockwise
      const hole = Array.from({length: 6}, (_, k) => [cx + rmin * 0.4 * Math.cos(-k * Math.PI / 3), cy + rmin * 0.4 * Math.sin(-k * Math.PI / 3)]);
      rings.push([...hole, hole[0]]);
    }
    if (r.chance(0.5)) rings[0].reverse();          // clockwise exterior: reversed and warned about
    if (r.chance(0.05)) rings[0].pop();             // unclosed ring: closed and warned about
    yield JSON.stringify({type: 'Feature', id: 'Z' + pad(i, 6), geometry: {type: 'Polygon', coordinates: rings}, properties: {name: 'Zone ' + i, category: r.pick(CATEGORIES)}});
  }
}

async function writeNdjson(path, points, polygons) {
  const out = createWriteStream(path);
  let buffer = '';
  for (const line of records(points, polygons)) {
    buffer += line + '\n';
    if (buffer.length > 1 << 16) { if (!out.write(buffer)) await once(out, 'drain'); buffer = ''; }
  }
  out.end(buffer);
  await finished(out);
}

async function child(input, output) {
  const start = performance.now(), out = createWriteStream(output);
  const report = await cleanNdjson(createReadStream(input), {options: OPTIONS, output: out, format: 'ndjson'});
  out.end();
  await finished(out);
  const seconds = (performance.now() - start) / 1000;
  console.log(JSON.stringify({seconds, peakRssMB: process.resourceUsage().maxRSS / 1024, report}));
}

if (process.argv[2] === '--child') {
  await child(process.argv[3], process.argv[4]);
} else {
  const args = process.argv.slice(2), large = args.includes('--large');
  const outIndex = args.indexOf('--out');
  const here = dirname(fileURLToPath(import.meta.url));
  const out = outIndex >= 0 ? args[outIndex + 1] : (large ? join(here, 'docs', 'evidence', 'benchmark.json') : null);
  const points = large ? 1_000_000 : 20_000, polygons = large ? 50_000 : 1_000;
  const dir = await mkdtemp(join(tmpdir(), 'geoq-bench-'));
  try {
    const source = join(dir, 'input.ndjson');
    await writeNdjson(source, points, polygons);
    const bytes = (await stat(source)).size;
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', source, join(dir, 'clean.ndjson')], {encoding: 'utf8', maxBuffer: 1 << 28});
    if (run.status !== 0) throw new Error('pipeline process failed: ' + run.stderr);
    const {seconds, peakRssMB, report} = JSON.parse(run.stdout);
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const result = {
      benchmark: 'streaming NDJSON pipeline of geojson-quality-kit ' + report.tool.version,
      mode: large ? 'large' : 'small',
      machine: {cpu: cpus()[0].model, logicalCpus: cpus().length, memoryGB: Math.round(totalmem() / 2 ** 30 * 10) / 10, node: process.version, platform: process.platform + ' ' + process.arch},
      data: {seed: SEED, points, polygons, records: points + polygons, fileMB: Math.round(bytes / 2 ** 20 * 10) / 10},
      options: OPTIONS,
      result: {
        input: report.input, accepted: report.accepted, rejected: report.rejected, output: report.output,
        errors: report.counts.errors, warnings: report.counts.warnings, nearbyPairs: report.counts.nearby,
        issueListsCappedAt: OPTIONS.maxItems
      },
      pipeline: {seconds: Math.round(seconds * 100) / 100, recordsPerSecond: Math.round(report.input / seconds), peakRssMB: Math.round(peakRssMB)}
    };
    if (report.accepted + report.rejected !== report.input || sum(report.counts.errors) !== report.rejected) throw new Error('report counts do not add up');
    if (!large) {
      // The small run also checks that streaming and in-memory cleaning agree.
      const lines = readFileSync(source, 'utf8').split('\n').filter(Boolean);
      const features = lines.map(line => { try { return JSON.parse(line); } catch { return 'unparseable line'; } });
      const memory = cleanFeatures({type: 'FeatureCollection', features}, OPTIONS).report;
      // A line that is not JSON is invalid_json when streamed and invalid_feature when it reaches memory as a string.
      const streamed = {...report.counts.errors};
      if (streamed.invalid_json) { streamed.invalid_feature = (streamed.invalid_feature ?? 0) + streamed.invalid_json; delete streamed.invalid_json; }
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      result.streamingMatchesInMemory = memory.accepted === report.accepted && memory.output === report.output && same(memory.counts.errors, Object.fromEntries(Object.entries(streamed).sort(([a], [b]) => (a < b ? -1 : 1)))) &&
        same(memory.counts.warnings, report.counts.warnings) && same(memory.geometries, report.geometries) && same(memory.bbox, report.bbox) && same(memory.categories, report.categories) && memory.counts.nearby === report.counts.nearby;
      if (!result.streamingMatchesInMemory) throw new Error('streaming and in-memory results differ');
    }
    const text = JSON.stringify(result, null, 2) + '\n';
    if (out) { await mkdir(dirname(out), {recursive: true}); await writeFile(out, text); }
    console.log(text.trimEnd());
  } finally { await rm(dir, {recursive: true, force: true}); }
}
