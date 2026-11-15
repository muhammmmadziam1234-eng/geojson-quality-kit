// Renders the table of finding codes for the README from lib/codes.mjs, so the two cannot disagree.
// test/readme.test.mjs compares the README with this output; `node scripts/readme-table.mjs` prints it.
import {fileURLToPath} from 'node:url';
import {ISSUE_CODES} from '../lib/codes.mjs';

const keys = details => {
  if (details === '-') return 'none';
  const [list, note] = details.split(/ (?=\()/);
  return list.split(', ').map(key => '`' + key + '`').join(', ') + (note ? ' ' + note : '');
};

export function renderCodeTable() {
  return ['| Code | Severity | Applies to | Meaning | Details | What to do |', '| --- | --- | --- | --- | --- | --- |',
    ...Object.entries(ISSUE_CODES).map(([code, i]) => '| `' + code + '` | ' + i.severity + ' | ' + i.appliesTo + ' | ' + i.summary + ' | ' + keys(i.details) + ' | ' + i.fix + ' |')].join('\n');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(renderCodeTable());
