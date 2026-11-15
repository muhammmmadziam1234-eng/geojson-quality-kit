#!/usr/bin/env node
import {readFile, writeFile, mkdir, access} from 'node:fs/promises';
import {createReadStream, createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {join, resolve} from 'node:path';
import {cleanPoints} from './quality.mjs';
import {cleanText} from './lib/text.mjs';
import {resolveOptions, GEOMETRY_TYPES} from './lib/options.mjs';
import {VERSION} from './lib/version.mjs';
import {cleanNdjson} from './stream.mjs';

const USAGE = `Usage: geojson-quality INPUT [OUTPUT_DIR] [options]

Checks and cleans GeoJSON features and writes a report.

  INPUT        a GeoJSON FeatureCollection file, or - for standard input. A .ndjson or .jsonl
               file (or --ndjson) holds one Feature per line and is streamed.
  OUTPUT_DIR   receives clean.geojson (or clean.ndjson) and report.json. Without it the
               cleaned data goes to standard output and the summary to standard error.

Options:
  --precision N     decimals kept in coordinates, 0 to 8 (default 6)
  --near METRES     flag accepted points closer than this, 0 to 1000; 0 turns it off (default 15)
  --types LIST      geometry types to accept, comma separated (default: all six GeoJSON types)
  --fields LIST     required properties to keep, e.g. name,level:lower=low|moderate|high
                    (default name,category:lower)
  --group-by NAME   property counted in report.categories, or none (default category)
  --format F        geojson (default) or ndjson, for the cleaned file
  --ndjson          read INPUT as one Feature per line
  --max-items N     entries kept per report list, or all (default 10000; counts stay exact)
  --report-only     write only the report
  --strict          exit with 1 when any feature was rejected
  --quiet           print nothing when the run succeeds
  --help, --version

Exit codes: 0 done, 1 features rejected (with --strict), 2 usage error,
3 input unreadable or not GeoJSON.

Compatibility: node cli.mjs INPUT OUTPUT [PRECISION] [NEAR] with no options is the original
points-only form. It writes the original version 1 report and its messages. Add any option
(even --format geojson) to use the full tool; so does an INPUT that is - or ends in .ndjson or .jsonl.`;

const VALUE_OPTIONS = {precision: 'N', near: 'METRES', format: 'geojson', types: 'Point,Polygon', fields: 'name,category:lower', 'group-by': 'category', 'max-items': 'N'};
const FLAG_OPTIONS = ['report-only', 'strict', 'quiet', 'ndjson', 'help', 'version'];

class UsageError extends Error {}
const usage = message => new UsageError(message);

function parseArgs(args) {
  const positional = [], flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const eq = arg.indexOf('='), name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (FLAG_OPTIONS.includes(name)) {
      if (eq !== -1) throw usage('--' + name + ' does not take a value.');
      flags[name] = true;
    } else if (name in VALUE_OPTIONS) {
      const value = eq === -1 ? args[++i] : arg.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith('--')))
        throw usage('--' + name + ' needs a value, for example --' + name + ' ' + VALUE_OPTIONS[name] + '.');
      flags[name] = value;
    } else throw usage('Unknown option --' + name + '. Run geojson-quality --help for the list.');
  }
  return {positional, flags};
}

function toOptions(flags) {
  const options = {};
  const number = (name, text, ok, expected) => {
    const value = text.trim() === '' ? NaN : Number(text);
    if (!ok(value)) throw usage('--' + name + ' must be ' + expected + ' (got "' + text + '").');
    return value;
  };
  if (flags.precision !== undefined) options.precision = number('precision', flags.precision, v => Number.isInteger(v) && v >= 0 && v <= 8, 'a whole number from 0 to 8');
  if (flags.near !== undefined) options.nearMeters = number('near', flags.near, v => Number.isFinite(v) && v >= 0 && v <= 1000, 'a number of metres from 0 to 1000');
  if (flags['max-items'] !== undefined)
    options.maxItems = flags['max-items'] === 'all' ? null : number('max-items', flags['max-items'], v => Number.isInteger(v) && v >= 0, 'a whole number of 0 or more, or all');
  if (flags.types !== undefined) {
    options.geometryTypes = flags.types.split(',').map(t => GEOMETRY_TYPES.find(known => known.toLowerCase() === t.trim().toLowerCase()) ?? t.trim());
    const unknown = options.geometryTypes.filter(t => !GEOMETRY_TYPES.includes(t));
    if (unknown.length) throw usage('--types: "' + unknown.join('", "') + '" is not a geometry type. Use: ' + GEOMETRY_TYPES.join(', ') + '.');
  }
  if (flags.fields !== undefined) options.fields = flags.fields.split(',');
  if (flags['group-by'] !== undefined) options.groupBy = flags['group-by'] === 'none' ? null : flags['group-by'];
  if (flags.format !== undefined && flags.format !== 'geojson' && flags.format !== 'ndjson')
    throw usage('--format must be geojson or ndjson (got "' + flags.format + '").');
  try { resolveOptions(options); } catch (e) { throw usage(e.message + ' Check --types, --fields and --group-by.'); }
  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const REASONS = {ENOENT: 'no such file or directory', EISDIR: 'it is a directory', EACCES: 'permission denied', EPERM: 'permission denied'};
const reason = e => REASONS[e.code] ?? e.message;
class InputError extends Error {}

function summary(report) {
  const warnings = Object.values(report.counts.warnings).reduce((a, b) => a + b, 0);
  return 'Accepted ' + report.accepted + ' of ' + report.input + ' features; rejected ' + report.rejected + '; ' + warnings + ' warning' + (warnings === 1 ? '' : 's') + '.' +
    (report.output === report.accepted ? '' : ' Wrote ' + report.output + ' features.');
}

async function run(args) {
  const {positional, flags} = parseArgs(args);
  if (flags.help) { console.log(USAGE); return 0; }
  if (flags.version) { console.log(VERSION); return 0; }
  if (positional.length === 0) throw usage('No INPUT given. Pass a GeoJSON file, or - to read standard input.');
  if (positional.length > 2) throw usage('Too many arguments (' + positional.slice(2).map(a => '"' + a + '"').join(', ') + '). Use geojson-quality INPUT [OUTPUT_DIR] and put settings in options such as --precision 5.');
  const [input, outDir] = positional, options = toOptions(flags);
  const format = flags.format ?? 'geojson', reportOnly = flags['report-only'] === true;
  const ndjson = flags.ndjson === true || /\.(ndjson|jsonl)$/i.test(input), name = input === '-' ? 'standard input' : '"' + input + '"';
  const cleanName = 'clean.' + (format === 'geojson' ? 'geojson' : 'ndjson');
  const targets = outDir === undefined ? [] : (reportOnly ? ['report.json'] : [cleanName, 'report.json']).map(file => join(outDir, file));
  const clash = input === '-' ? undefined : targets.find(target => resolve(target) === resolve(input));
  if (clash) throw usage('Writing ' + clash + ' would overwrite the input file ' + name + '. Choose a different OUTPUT_DIR; the input is never overwritten.');
  const save = async (path, text) => {
    try { await writeFile(path, text); } catch (e) { throw new InputError('cannot write "' + path + '": ' + reason(e) + '.'); }
  };
  if (outDir !== undefined) {
    try { await mkdir(outDir, {recursive: true}); } catch (e) { throw new InputError('cannot create the output directory "' + outDir + '": ' + reason(e) + '.'); }
  }
  let report, cleaned = null;
  if (ndjson) {
    if (input !== '-') {
      try { await access(input); } catch (e) { throw new InputError('cannot read ' + name + ': ' + reason(e) + '. Check the path, or use - to read standard input.'); }
    }
    const source = input === '-' ? process.stdin : createReadStream(input);
    const toFile = outDir !== undefined && !reportOnly, output = toFile ? createWriteStream(targets[0]) : (outDir === undefined && !reportOnly ? process.stdout : null);
    try {
      report = await cleanNdjson(source, {options, output, format});
      if (toFile) { output.end(); await finished(output); }
    } catch (e) {
      if (toFile) output.destroy();
      throw new InputError('cannot read ' + name + ': ' + reason(e) + '. Check the path, or use - to read standard input.');
    }
  } else {
    let text;
    try { text = input === '-' ? await readStdin() : await readFile(input, 'utf8'); } catch (e) {
      throw new InputError('cannot read ' + name + ': ' + reason(e) + '. Check the path, or use - to read standard input.');
    }
    const result = cleanText(text, options);
    if (result.error) throw new InputError(result.error.code === 'invalid_json'
      ? name + ' is not valid JSON: ' + result.error.message + '. If the file holds one Feature per line, add --ndjson.'
      : name + ': ' + result.error.message);
    ({cleaned, report} = result);
    if (!reportOnly) {
      const body = format === 'geojson' ? JSON.stringify(cleaned, null, 2) + '\n' : cleaned.features.map(f => JSON.stringify(f) + '\n').join('');
      if (outDir === undefined) process.stdout.write(body); else await save(targets[0], body);
    }
  }
  const reportText = JSON.stringify(report, null, 2) + '\n';
  if (outDir !== undefined) await save(targets[targets.length - 1], reportText);
  else if (reportOnly) process.stdout.write(reportText);
  if (flags.quiet !== true) {
    const lines = [summary(report), ...targets];
    (outDir === undefined ? console.error : console.log)(lines.join('\n'));
  }
  if (flags.strict === true && report.rejected > 0) {
    console.error('--strict: ' + report.rejected + ' of ' + report.input + ' features were rejected' + (outDir === undefined ? '.' : '; see ' + join(outDir, 'report.json') + '.'));
    return 1;
  }
  return 0;
}

// The original command line, kept exactly as it was: positional arguments only, Point features only.
async function runLegacy(args) {
  const [input, output, rawPrecision, rawNearMeters, ...extra] = args;
  if (!input || !output || extra.length) {
    console.error('Usage: node cli.mjs INPUT.geojson OUTPUT_DIRECTORY [PRECISION] [PROXIMITY_METRES]');
    return 2;
  }
  try {
    const targets = ['clean.geojson', 'report.json'].map(name => join(output, name));
    if (targets.some(name => resolve(name) === resolve(input))) throw new Error('Choose a different output directory from the source files.');
    const source = JSON.parse(await readFile(input, 'utf8'));
    const {cleaned, report} = cleanPoints(source, {...(rawPrecision === undefined ? {} : {precision: Number(rawPrecision)}), ...(rawNearMeters === undefined ? {} : {nearMeters: Number(rawNearMeters)})});
    await mkdir(output, {recursive: true});
    for (const [name, value] of [[targets[0], cleaned], [targets[1], report]])
      await writeFile(name, JSON.stringify(value, null, 2) + '\n');
    console.log('Accepted ' + report.accepted + ' of ' + report.input + ' features; rejected ' + report.rejected + '.');
    console.log(targets.join('\n'));
    return 0;
  } catch (e) { console.error('Could not process the dataset: ' + e.message); return 1; }
}

const argv = process.argv.slice(2);
const legacy = argv.length >= 2 && argv[0] !== '-' && !/\.(ndjson|jsonl)$/i.test(argv[0]) && !argv.some(a => a.startsWith('--'));
try {
  process.exitCode = await (legacy ? runLegacy(argv) : run(argv));
} catch (e) {
  if (e instanceof UsageError) { console.error('geojson-quality: ' + e.message + '\nRun geojson-quality --help for usage.'); process.exitCode = 2; }
  else if (e instanceof InputError) { console.error('geojson-quality: ' + e.message); process.exitCode = 3; }
  else throw e;
}
