// The CLI line `npm run try` prints (SV-173): pasted into a shell, it reaches try's own copy, though
// `npm run cli` runs in server/ (npm runs a workspace's script there), where a relative data dir
// would open a new server/data/try.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from 'vitest';
import {cliLine} from '../src/dev/cliLine.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER = path.join(ROOT, 'server');

test.each([
  ['try\'s own', path.join(ROOT, 'data', 'try')],
  ['one with a space and a quote', path.join(ROOT, 'data', 'it\'s a try')],
])('the line\'s data dir, from server/, is the copy\'s: %s', (_, dataDir) => {
  const line = cliLine(dataDir, 7450, 'pair-link');
  expect(line).toMatch(/ SETPOINT_PORT=7450 npm run cli -- pair-link$/);
  // The shell reads the line's environment, and the CLI resolves its data dir from server/.
  const env = line.replace(/ npm run cli -- pair-link$/, '');
  const resolved = spawnSync('sh', ['-c', `${env} node -p 'require("node:path").resolve(process.env.SETPOINT_DATA_DIR)'`], {cwd: SERVER, encoding: 'utf8'});
  expect(resolved.stdout.trim()).toBe(dataDir);
});
