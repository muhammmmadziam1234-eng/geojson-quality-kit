import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {cleanFeatures} from '../index.mjs';
import {EVERY_RULE_OPTIONS} from './support/cases.mjs';

// Golden files: a messy input that triggers every rule, and the clean output and report the kit
// is expected to produce for it. They are committed and were read by a person before being
// committed. UPDATE_GOLDEN=1 rewrites the two expected files; review the diff before committing.
const dir = new URL('fixtures/', import.meta.url);
const load = async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'));
const pretty = value => JSON.stringify(value, null, 2) + '\n';

async function golden(name, options) {
  const {cleaned, report} = cleanFeatures(await load(name + '.geojson'), options);
  if (process.env.UPDATE_GOLDEN === '1') {
    await writeFile(new URL(name + '.clean.geojson', dir), pretty(cleaned));
    await writeFile(new URL(name + '.report.json', dir), pretty(report));
  }
  assert.deepEqual(cleaned, await load(name + '.clean.geojson'));
  assert.deepEqual(report, await load(name + '.report.json'));
  return {cleaned, report};
}

test('golden: a messy file with one example of every rule cleans to the expected output and report', async () => {
  const {cleaned, report} = await golden('every-rule', EVERY_RULE_OPTIONS);
  assert.deepEqual([report.input, report.accepted, report.rejected, report.output], [28, 10, 18, 11]);
  assert.equal(cleaned.features.length, 11);
});

test('golden: the expected report is stable under a second pass over the expected output', async () => {
  const expected = await load('every-rule.clean.geojson');
  const again = cleanFeatures(expected, EVERY_RULE_OPTIONS);
  assert.deepEqual(again.cleaned, expected);
  assert.equal(again.report.rejected, 0);
});
