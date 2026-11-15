import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanText, cleanFeatures} from '../index.mjs';
import {firstErrorOffset} from '../lib/json.mjs';
import {readFile} from 'node:fs/promises';
import {root} from './support/helpers.mjs';

const sampleText = await readFile(new URL('sample/facilities.geojson', root), 'utf8');

test('cleanText parses and cleans, returning exactly {cleaned, report}', () => {
  const result = cleanText(sampleText, {geometryTypes: ['Point']});
  assert.deepEqual(Object.keys(result), ['cleaned', 'report']);
  assert.deepEqual(result, cleanFeatures(JSON.parse(sampleText), {geometryTypes: ['Point']}));
  assert.equal(result.report.accepted, 4);
  assert.deepEqual(cleanText('﻿' + sampleText).report, cleanFeatures(JSON.parse(sampleText)).report);
});

// [text, line, column, what was found]
const SYNTAX_ERRORS = [
  ['', 1, 1, 'end of the text'],
  ['   \n  ', 2, 3, 'end of the text'],
  ['{', 1, 2, 'end of the text'],
  ['{"a":}', 1, 6, 'character "}"'],
  ['{\n  "type": "FeatureCollection",\n  "features": [,]\n}', 3, 16, 'character ","'],
  ['[1,]', 1, 4, 'character "]"'],
  ["{'a': 1}", 1, 2, "character \"'\""],
  ['[01]', 1, 3, 'character "1"'],
  ['{"a":"x\ny"}', 1, 8, 'character "\\n"'],
  ['["\\x"]', 1, 4, 'character "x"'],
  ['["\\u12G4"]', 1, 7, 'character "G"'],
  ['["\\u12', 1, 7, 'end of the text'],
  ['["abc', 1, 6, 'end of the text'],
  ['[1.]', 1, 4, 'character "]"'],
  ['[1e]', 1, 4, 'character "]"'],
  ['[-]', 1, 3, 'character "]"'],
  ['[tru]', 1, 2, 'character "t"'],
  ['{} x', 1, 4, 'character "x"'],
  ['{"a" 1}', 1, 6, 'character "1"'],
  ['{1: 2}', 1, 2, 'character "1"'],
  ['[1 2]', 1, 4, 'character "2"'],
  ['// comment\n{}', 1, 1, 'character "/"'],
  ['{"a": undefined}', 1, 7, 'character "u"']
];

test('invalid JSON comes back as a structured error with 1-based line and column', () => {
  for (const [text, line, column, found] of SYNTAX_ERRORS) {
    assert.throws(() => JSON.parse(text), undefined, 'JSON.parse should refuse ' + JSON.stringify(text));
    const {error, cleaned, report} = cleanText(text);
    assert.equal(cleaned, undefined);
    assert.equal(report, undefined);
    assert.deepEqual([error.code, error.line, error.column], ['invalid_json', line, column], JSON.stringify(text));
    assert.equal(error.message, 'Unexpected ' + found + ' at line ' + line + ', column ' + column, JSON.stringify(text));
    assert.equal(error.detail, 'Unexpected ' + found);
    assert.ok(Number.isInteger(error.offset) && error.offset <= text.length);
  }
});

test('the syntax scanner accepts everything JSON.parse accepts', () => {
  for (const text of ['{}', '[]', ' [1, -2.5e+3, true, false, null, "a\\u00e9\\n\\/", {"k": [ ]}] ', '"\\ud800"', '0', '-0.0', '{"":0}', '[[[[]]]]'])
    assert.equal(firstErrorOffset(text), null, text);
  assert.equal(firstErrorOffset('['.repeat(600)) !== null, true, 'absurd nesting is refused instead of overflowing the stack');
});

test('valid JSON that is not a FeatureCollection is a structured error too', () => {
  const found = text => cleanText(text).error;
  assert.deepEqual(found('[]').code, 'not_a_feature_collection');
  assert.match(found('[]').message, /but it is an array; wrap the features/);
  assert.match(found('{"type":"Feature","geometry":null,"properties":{}}').message, /a single Feature; wrap it/);
  assert.match(found('{"type":"Point","coordinates":[1,2]}').message, /type "Point"; put the data in Features/);
  assert.match(found('{"type":"FeatureCollection"}').message, /type "FeatureCollection"/);
  assert.match(found('null').message, /but it is null\./);
  assert.match(found('12').message, /but it is a number\./);
  assert.equal(found('"x"').line, undefined);
});

test('bad arguments throw instead of returning an error', () => {
  assert.throws(() => cleanText(5), /expects the JSON text as a string/);
  assert.throws(() => cleanText('{}', {precision: 99}), /Precision must be an integer from 0 to 8/);
  assert.throws(() => cleanText('{"type":"FeatureCollection","features":[]}', {nope: 1}), /Unknown option "nope"/);
});
