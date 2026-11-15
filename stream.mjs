import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {createCleaner} from './lib/cleaner.mjs';
import {parseJson} from './lib/json.mjs';

const CHUNK = 1 << 16;

// Collects text and hands it to the stream in 64 KB pieces, waiting when the stream is full.
function sink(output) {
  let buffer = '';
  async function flush() {
    if (!buffer) return;
    const chunk = buffer;
    buffer = '';
    if (output && !output.write(chunk)) await once(output, 'drain');
  }
  return {
    async write(text) { if (!output) return; buffer += text; if (buffer.length >= CHUNK) await flush(); },
    flush
  };
}

/**
 * Cleans newline-delimited GeoJSON (one Feature per line) from a Node readable, one line at a
 * time. Memory grows with the id set, the point index and the capped report lists, not with
 * the file. When `output` is given, cleaned features are written to it as they are produced,
 * as NDJSON or as one FeatureCollection with a feature per line (its bbox follows the features).
 * Returns the report. The caller ends the output stream.
 */
export async function cleanNdjson(readable, {options, output = null, format = 'geojson'} = {}) {
  if (format !== 'geojson' && format !== 'ndjson') throw new RangeError('format must be geojson or ndjson.');
  const cleaner = createCleaner(options), out = sink(output), geojson = format === 'geojson';
  let first = true, lineNumber = 0;
  if (geojson) await out.write('{"type":"FeatureCollection","features":[\n');
  for await (const line of createInterface({input: readable, crlfDelay: Infinity})) {
    lineNumber++;
    if (line.trim() === '') continue;
    const parsed = parseJson(line);
    const features = parsed.error
      ? cleaner.rejectRecord('invalid_json', {line: lineNumber, column: parsed.error.column, message: parsed.error.detail})
      : cleaner.push(parsed.value);
    for (const feature of features) {
      await out.write(geojson ? (first ? '' : ',\n') + JSON.stringify(feature) : JSON.stringify(feature) + '\n');
      first = false;
    }
  }
  const report = cleaner.finish();
  if (geojson) await out.write('\n]' + (report.bbox ? ',"bbox":' + JSON.stringify(report.bbox) : '') + '}\n');
  await out.flush();
  return report;
}
