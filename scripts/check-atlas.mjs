// Runs the flood-exposure-atlas validator (validate.mjs) over the files this kit prepared for it.
//   node scripts/check-atlas.mjs [path to the atlas folder]     default: $ATLAS_DIR, else ../flood-exposure-atlas
//   node scripts/check-atlas.mjs --write                        also saves docs/evidence/atlas-check.txt
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';

const here = fileURLToPath(new URL('../', import.meta.url));
const atlas = resolve(process.argv.slice(2).find(a => !a.startsWith('--')) ?? process.env.ATLAS_DIR ?? join(here, '..', 'flood-exposure-atlas'));
if (!existsSync(join(atlas, 'validate.mjs'))) { console.log('No validate.mjs in ' + atlas + '; nothing to check.'); process.exit(0); }
const {validateZones, validateFacilities} = await import(pathToFileURL(join(atlas, 'validate.mjs')).href);
const read = path => JSON.parse(readFileSync(join(here, path), 'utf8'));
const git = (...args) => spawnSync('git', ['-C', atlas, ...args], {encoding: 'utf8'}).stdout.trim() || 'unknown';

const lines = ['validate.mjs of flood-exposure-atlas (last changed in commit ' + git('log', '-1', '--format=%h', '--', 'validate.mjs') + ', atlas HEAD ' + git('rev-parse', '--short', 'HEAD') + ')', ''];
let failed = false;
for (const [label, check, cleanPath, rawPath] of [
  ['zones', validateZones, 'examples/atlas/zones/clean.geojson', 'examples/atlas/zones-raw.geojson'],
  ['facilities', validateFacilities, 'examples/atlas/facilities/clean.geojson', 'examples/atlas/facilities-raw.geojson']
]) {
  const cleaned = read(cleanPath), result = check(cleaned), raw = check(read(rawPath));
  const same = result.features.every((f, i) => isDeepStrictEqual(f.geometry, cleaned.features[i].geometry) && isDeepStrictEqual(f.properties, cleaned.features[i].properties));
  lines.push(label + ' after the kit (' + cleanPath + '): ' + result.total + ' features, ' + result.features.length + ' accepted, ' + result.problems.length + ' problems; geometry and properties kept unchanged: ' + same,
    label + ' straight from the raw file (' + rawPath + '): ' + raw.total + ' features, ' + raw.features.length + ' accepted, ' + raw.problems.length + ' problems', '');
  if (result.rejected !== 0 || result.problems.length !== 0 || !same) failed = true;
}
lines.push(failed ? 'RESULT: the atlas validator rejected something the kit produced.' : 'RESULT: the atlas validator accepts everything the kit produced.');
console.log(lines.join('\n'));
if (process.argv.includes('--write')) writeFileSync(join(here, 'docs/evidence/atlas-check.txt'), lines.join('\n') + '\n');
process.exit(failed ? 1 : 0);
