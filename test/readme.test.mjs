import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderCodeTable} from '../scripts/readme-table.mjs';
import {readJson, root} from './support/helpers.mjs';

const readme = await readFile(new URL('README.md', root), 'utf8');
const pkg = await readJson('package.json');
const bench = await readJson('docs/evidence/benchmark.json');
const coverage = await readFile(new URL('docs/evidence/coverage.txt', root), 'utf8');
const n = value => value.toLocaleString('en-US');

test('the rule table in the README is exactly the table in lib/codes.mjs', () => {
  const block = readme.split('<!-- codes:start -->\n')[1]?.split('\n<!-- codes:end -->')[0];
  assert.equal(block, renderCodeTable());
});

test('every npm script and every relative link in the README exists', async () => {
  for (const [, name] of readme.matchAll(/npm run ([\w:-]+)/g)) assert.ok(pkg.scripts[name], 'no script ' + name);
  const links = [...readme.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)].map(m => m[1]);
  assert.ok(links.length >= 8);
  for (const link of links) assert.ok(existsSync(new URL(link, root)), 'broken link ' + link);
});

// `npm run coverage -- --write` sets REFRESH_EVIDENCE=1 so that this one test does not block rewriting the file it reads.
test('numbers quoted in the README are the ones in the evidence files', {skip: process.env.REFRESH_EVIDENCE === '1' && 'the evidence is being rewritten'}, () => {
  const tests = /tests (\d+), pass (\d+), fail (\d+), skipped (\d+); line coverage ([\d.]+)%/.exec(coverage);
  assert.ok(tests, 'coverage.txt has no summary line');
  assert.ok(readme.includes(tests[5] + '%'), 'line coverage ' + tests[5] + '%');
  assert.ok(readme.includes(tests[1] + ' tests'), tests[1] + ' tests');
  assert.equal(tests[3], '0');
  const {machine, data, result, pipeline} = bench;
  for (const quoted of [machine.cpu, machine.node, n(data.records), n(data.points), n(data.polygons), String(data.fileMB), String(pipeline.seconds), n(pipeline.recordsPerSecond), String(pipeline.peakRssMB), n(result.accepted), n(result.rejected), n(result.nearbyPairs)])
    assert.ok(readme.includes(quoted), 'the README does not quote ' + quoted);
});

test('the README keeps its title, badge and closing line, and no file names a tool or a company it should not', async () => {
  const lines = readme.split('\n');
  assert.equal(lines[0], '# GeoJSON Quality Kit');
  assert.match(lines[2], /^\[!\[Tests\]\(https:\/\/github\.com\/muhammmmadziam1234-eng\/geojson-quality-kit\/actions\/workflows\/test\.yml\/badge\.svg\?branch=main\)\]/);
  assert.equal(lines.at(-2), '© 2026 muhammmmadziam1234-eng. All rights reserved.');
  const self = fileURLToPath(import.meta.url); // this file lists the words, so it is left out
  const banned = /\b(claude|anthropic|chatgpt|copilot|openai|gpt-\d|llm|axiom|meridian|dubai)\b/i;
  const walk = async dir => {
    const found = [];
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      if (['node_modules', '.git', 'output'].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...await walk(path));
      else if (/\.(mjs|ts|json|md|yml|geojson|txt)$/.test(entry.name) && path !== self && banned.test(await readFile(path, 'utf8'))) found.push(path);
    }
    return found;
  };
  assert.deepEqual(await walk(fileURLToPath(root)), []);
});
