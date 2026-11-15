import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readJson, root} from './support/helpers.mjs';

// The workflow cannot run on this machine, so these checks keep it consistent with the repository.
test('the CI workflow keeps its name, tests Node 22 and 24, and only calls scripts that exist', async () => {
  const yaml = await readFile(new URL('.github/workflows/test.yml', root), 'utf8');
  assert.match(yaml, /^name: Tests\n/);
  assert.match(yaml, /node: \[22, 24\]/);
  for (const step of ['npm ci', 'npm run coverage', 'npm run types', 'npm pack --dry-run', 'npm run benchmark']) assert.ok(yaml.includes(step), step);
  assert.ok(yaml.includes('CHROME_PATH: /usr/bin/google-chrome') && yaml.includes("REQUIRE_BROWSER: '1'"));
  assert.ok(!/playwright install/.test(yaml), 'no browser download step');
  const {scripts} = await readJson('package.json');
  for (const [, name] of yaml.matchAll(/npm run ([\w:-]+)/g)) assert.ok(scripts[name], 'package.json has no script ' + name);
});

test('the README badge points at the workflow file', async () => {
  const readme = await readFile(new URL('README.md', root), 'utf8');
  const [first, second] = readme.split('\n');
  assert.equal(first, '# GeoJSON Quality Kit');
  assert.match(second === '' ? readme.split('\n')[2] : second, /\(https:\/\/github\.com\/muhammmmadziam1234-eng\/geojson-quality-kit\/actions\/workflows\/test\.yml\)$/);
  assert.ok(readme.trimEnd().endsWith('© 2026 muhammmmadziam1234-eng. All rights reserved.'));
});
