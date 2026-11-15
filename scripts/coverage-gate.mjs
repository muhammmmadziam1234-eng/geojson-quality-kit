// Runs the whole test suite with Node's built-in coverage and fails when line coverage of the
// kit's own code is under MINIMUM percent (or any test fails).
//   npm run coverage                prints the coverage table and checks the gate
//   npm run coverage -- --write     also saves it to docs/evidence/coverage.txt
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const MINIMUM = 95;
const root = fileURLToPath(new URL('../', import.meta.url));
// Only this repository's own code is measured (not the tests, and not a sibling repository that a test may import).
const COVERED = ['--test-coverage-include=*.mjs', '--test-coverage-include=lib/**/*.mjs', '--test-coverage-include=scripts/**/*.mjs', '--test-coverage-exclude=test/**'];
const args = ['--test', '--experimental-test-coverage', ...COVERED, '--test-reporter=spec', 'test/*.test.mjs'];
// While rewriting the evidence, the one test that compares the README with that file is skipped.
const write = process.argv.includes('--write');
const run = spawnSync(process.execPath, args, {cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, env: {...process.env, ...(write ? {REFRESH_EVIDENCE: '1'} : {})}});
const lines = (run.stdout + run.stderr).split('\n').map(line => line.replace(/^(?:ℹ|#)\s?/, ''));

const start = lines.findIndex(line => line === 'start of coverage report'), end = lines.findIndex(line => line === 'end of coverage report');
if (start < 0 || end < 0) { console.error('No coverage report in the test output.\n' + lines.slice(-30).join('\n')); process.exit(1); }
const table = lines.slice(start + 1, end).filter(line => line.trim() !== '');
const totals = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(name => {
  const found = lines.find(line => new RegExp('^' + name + ' \\d+$').test(line));
  return [name, found ? Number(found.split(' ')[1]) : null];
}));
const all = table.find(line => line.startsWith('all files'));
const linePercent = all ? Number(all.split('|')[1]) : NaN;

const summary = 'tests ' + totals.tests + ', pass ' + totals.pass + ', fail ' + totals.fail + ', skipped ' + totals.skipped + '; line coverage ' + linePercent + '% (minimum ' + MINIMUM + '%)';
console.log(table.join('\n') + '\n\n' + summary);
if (run.status !== 0 || totals.fail !== 0) { console.error('The test run failed (exit ' + run.status + ').'); process.exit(1); }
if (!(linePercent >= MINIMUM)) { console.error('Line coverage ' + linePercent + '% is under the ' + MINIMUM + '% gate.'); process.exit(1); }
if (write) { // only a passing run is worth keeping as evidence
  mkdirSync(new URL('../docs/evidence/', import.meta.url), {recursive: true});
  writeFileSync(new URL('../docs/evidence/coverage.txt', import.meta.url),
    'Measured with: node ' + args.filter(a => a !== '--test-reporter=spec').map(a => (/[*]/.test(a) ? '"' + a + '"' : a)).join(' ') + '\n' +
    'Node ' + process.version + ' on ' + process.platform + ' ' + process.arch + '. Written with REFRESH_EVIDENCE=1, which skips only the test that compares the README with this file.\n' + summary + '\n\n' + table.join('\n') + '\n');
}
