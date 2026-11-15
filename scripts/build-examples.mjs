// Rebuilds every file under examples/ that the kit produces, by running the real command line.
// test/examples.test.mjs runs the same commands into a temporary folder and compares, so the
// committed examples cannot drift from the code.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export const root = fileURLToPath(new URL('../', import.meta.url));
// [input, output folder, options...], paths relative to the repository root.
export const RUNS = [
  ['examples/messy.geojson', 'examples/messy', '--near', '15'],
  ['examples/atlas/zones-raw.geojson', 'examples/atlas/zones', '--types', 'Polygon,MultiPolygon', '--fields', 'name,level:lower=low|moderate|high', '--group-by', 'level'],
  ['examples/atlas/facilities-raw.geojson', 'examples/atlas/facilities', '--types', 'Point,MultiPoint', '--fields', 'id,name,category:lower', '--near', '15']
];

export function build(base = root) {
  for (const [input, output, ...options] of RUNS) {
    const r = spawnSync(process.execPath, [join(root, 'cli.mjs'), join(root, input), join(base, output), ...options, '--quiet'], {encoding: 'utf8'});
    if (r.status !== 0) throw new Error(input + ' failed: ' + r.stderr);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { build(); console.log('Rebuilt ' + RUNS.length + ' example runs under examples/.'); }
