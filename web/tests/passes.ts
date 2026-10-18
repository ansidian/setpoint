// Passing runs recorded by the content they ran on (SV-83, D274), so a release runs only what hasn't
// already passed on its exact content (release.ts). The key is the working tree as a git tree:
// tracked and untracked files, ignored ones left out, written through a scratch index, so it equals
// HEAD^{tree} once that content is committed and a run before the commit counts for it. A pass also
// carries the Node version and the installed lockfile (`env`), which change what runs without
// changing the tree. Records live in the repository's common git directory, so a run in a worktree
// counts in the main checkout too, and go after 30 days.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KEEP_MS = 30 * 24 * 60 * 60_000;
// What the board audit's page depends on: it draws the boards beside the goldens, not the app.
const AUDIT_INPUTS = ['design-export', 'web/tests/browser/goldens', 'web/tests/browser/audit.ts', 'web/tests/browser/harness.ts', 'web/src/tokens.ts'];

export type Check = 'unit' | 'browser' | 'stress' | 'pages' | 'audit';

export interface Pass {
  check: Check;
  // The spec files that passed, by name (`mail`), for the browser checks.
  specs?: string[];
  env: string;
  // The checkout it ran in, for the message.
  dir: string;
  at: string;
}

const git = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', env: {...process.env, ...env}}).trim();

const store = () => path.join(git(['rev-parse', '--path-format=absolute', '--git-common-dir']), 'setpoint-passes');

/** The working tree's content as a git tree id, without touching the real index. */
export function treeOf(): string {
  const scratch = path.join(os.tmpdir(), `setpoint-tree-${process.pid}-${Date.now()}`);
  try {
    try {
      // The real index's file times save hashing every file again.
      fs.copyFileSync(git(['rev-parse', '--path-format=absolute', '--git-path', 'index']), scratch);
    } catch {
      // No index yet: add hashes everything.
    }
    git(['add', '-A'], {GIT_INDEX_FILE: scratch});
    return git(['write-tree'], {GIT_INDEX_FILE: scratch});
  } finally {
    fs.rmSync(scratch, {force: true});
  }
}

/** HEAD's tree, and whether the working tree is HEAD's content exactly (no change, nothing untracked). */
export function head(): {tree: string; rev: string; clean: boolean} {
  return {tree: git(['rev-parse', 'HEAD^{tree}']), rev: git(['rev-parse', '--short', 'HEAD']), clean: git(['status', '--porcelain']) === ''};
}

/** The board audit's key: its inputs within `tree`. */
export function auditKey(tree: string): string {
  const ids = AUDIT_INPUTS.map(input => {
    try {
      return git(['rev-parse', `${tree}:${input}`]);
    } catch {
      return '-';
    }
  });
  return `audit-${crypto.createHash('sha256').update(ids.join('\n')).digest('hex').slice(0, 40)}`;
}

export function envOf(): string {
  let lock = '';
  try {
    lock = fs.readFileSync(path.join(ROOT, 'node_modules', '.package-lock.json'), 'utf8');
  } catch {
    // Not installed: the key still differs from an installed one.
  }
  return crypto.createHash('sha256').update(`${process.version}\n${lock}`).digest('hex').slice(0, 12);
}

/** Records a pass under `key` (a tree, or an audit key), and drops records past KEEP_MS. */
export function record(key: string, pass: Pick<Pass, 'check' | 'specs'>) {
  const dir = store();
  fs.mkdirSync(dir, {recursive: true});
  const line: Pass = {...pass, env: envOf(), dir: ROOT, at: new Date().toISOString()};
  fs.appendFileSync(path.join(dir, `${key}.jsonl`), `${JSON.stringify(line)}\n`);
  for (const file of fs.readdirSync(dir)) {
    const at = path.join(dir, file);
    if (Date.now() - fs.statSync(at).mtimeMs > KEEP_MS) fs.rmSync(at, {force: true});
  }
}

/** The passes recorded under `key` in this environment. */
export function passesOf(key: string): Pass[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(store(), `${key}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  const env = envOf();
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Pass).filter(pass => pass.env === env);
}

/** The spec files of `all` that no pass of `check` covers. */
export function missing(all: string[], passes: Pass[], check: 'browser' | 'stress'): string[] {
  const passed = new Set(passes.filter(pass => pass.check === check).flatMap(pass => pass.specs ?? []));
  return all.filter(spec => !passed.has(spec));
}

/** A spec file's name as runs and records use it: `mail` for mail.spec.ts. */
export const specName = (file: string) => path.basename(file).replace(/\.spec\.ts$/, '');
