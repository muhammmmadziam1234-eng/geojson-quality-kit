import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('the TypeScript declarations compile and reject misuse (tsc --noEmit over test/types-check.ts)', () => {
  const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
  const project = fileURLToPath(new URL('./tsconfig.json', import.meta.url));
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', project], {encoding: 'utf8'});
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
