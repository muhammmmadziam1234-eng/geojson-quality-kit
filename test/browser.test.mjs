import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, normalize, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {cleanFeatures, cleanText} from '../index.mjs';
import {readJson, root} from './support/helpers.mjs';
import {everyRule, EVERY_RULE_OPTIONS} from './support/cases.mjs';

const repo = fileURLToPath(root);
const TYPES = {'.mjs': 'text/javascript', '.json': 'application/json', '.geojson': 'application/json', '.html': 'text/html'};

// The core library must run unchanged in a browser: no Node built-ins, no process, Buffer or require.
// First a static check of every module reachable from index.mjs, then a real Chromium.
function importGraph(entry, seen = new Map()) {
  return readFile(join(repo, entry), 'utf8').then(async source => {
    seen.set(entry, source);
    for (const [, spec] of source.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
      if (spec.startsWith('node:') || !spec.startsWith('.')) throw new Error(entry + ' imports ' + spec);
      const next = normalize(join(entry, '..', spec));
      if (!seen.has(next)) await importGraph(next, seen);
    }
    return seen;
  });
}

test('every module reachable from index.mjs avoids Node built-ins, process, Buffer and require', async () => {
  const modules = await importGraph('index.mjs');
  assert.ok(modules.size >= 9, [...modules.keys()].join(', '));
  for (const [file, source] of modules) {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\b(process|Buffer|require|__dirname|__filename|module\.exports)\b/, file);
    assert.doesNotMatch(code, /from\s*['"]node:/, file);
  }
  // Only the command line and the streaming helper use Node built-ins; the rest of the package does not.
  for (const file of ['quality.mjs', ...[...modules.keys()]]) assert.doesNotMatch(await readFile(join(repo, file), 'utf8'), /['"]node:/, file);
  const users = [];
  for (const file of ['cli.mjs', 'stream.mjs', 'benchmark.mjs']) if (/['"]node:/.test(await readFile(join(repo, file), 'utf8'))) users.push(file);
  assert.deepEqual(users, ['cli.mjs', 'stream.mjs', 'benchmark.mjs']);
});

function serve() {
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (path === '/__blank') { response.writeHead(200, {'content-type': 'text/html'}).end('<!doctype html><title>blank</title><link rel="icon" href="data:,">'); return; }
    const file = join(repo, normalize(path));
    if (!file.startsWith(repo) || !TYPES[extname(file)]) { response.writeHead(404).end(); return; }
    try { response.writeHead(200, {'content-type': TYPES[extname(file)]}).end(await readFile(file)); } catch { response.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('index.mjs runs unchanged in Chromium and gives the same results as in Node', async t => {
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath || !existsSync(executablePath)) {
    if (process.env.REQUIRE_BROWSER === '1') assert.fail('REQUIRE_BROWSER=1 but CHROME_PATH is not an existing browser: ' + executablePath);
    return t.skip('CHROME_PATH is not set to a Chrome or Chromium executable');
  }
  const sample = await readJson('sample/facilities.geojson'), mixed = everyRule(), badText = '{\n  "type": "FeatureCollection",\n  "features": [,]\n}';
  const server = await serve(), origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({executablePath, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage(), problems = [];
    page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text()); });
    page.on('pageerror', error => problems.push('page error: ' + error.message));
    page.on('request', request => { if (!request.url().startsWith(origin)) problems.push('request outside the test server: ' + request.url()); });
    await page.goto(origin + '/__blank');
    const result = await page.evaluate(async ({sample, mixed, badText, mixedOptions}) => {
      const api = await import('/index.mjs');
      return {
        names: Object.keys(api).sort(), nodeGlobals: [typeof process, typeof Buffer, typeof require],
        points: api.cleanFeatures(sample, {geometryTypes: ['Point']}), all: api.cleanFeatures(sample),
        mixed: api.cleanFeatures(mixed, mixedOptions), text: api.cleanText(JSON.stringify(sample)), bad: api.cleanText(badText),
        legacy: api.cleanPoints(sample)
      };
    }, {sample, mixed, badText, mixedOptions: EVERY_RULE_OPTIONS});
    const viaJson = value => JSON.parse(JSON.stringify(value));
    assert.deepEqual(result.nodeGlobals, ['undefined', 'undefined', 'undefined']);
    assert.deepEqual(result.names, ['ISSUE_CODES', 'VERSION', 'cleanFeatures', 'cleanPoints', 'cleanText', 'validateGeometry']);
    assert.deepEqual(result.points, viaJson(cleanFeatures(sample, {geometryTypes: ['Point']})));
    assert.deepEqual(result.points.cleaned.features, viaJson((await import('../quality.mjs')).cleanPoints(sample).cleaned.features), 'the same points as the original cleaner');
    assert.deepEqual(result.all, viaJson(cleanFeatures(sample)));
    assert.deepEqual(result.mixed, viaJson(cleanFeatures(mixed, EVERY_RULE_OPTIONS)), 'every rule, every geometry type, exact BigInt fallback included');
    assert.deepEqual(result.text, viaJson(cleanText(JSON.stringify(sample))));
    assert.deepEqual(result.bad, viaJson(cleanText(badText)));
    assert.deepEqual([result.bad.error.line, result.bad.error.column], [3, 16]);
    assert.deepEqual(result.legacy, viaJson((await import('../quality.mjs')).cleanPoints(sample)));
    assert.deepEqual(problems, []);
  } finally { await browser.close(); server.close(); }
});
