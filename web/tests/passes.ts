// Passing runs recorded by the content they ran on (SV-83, D274), so a release runs only what hasn't
// already passed on its exact content (release.ts). Each check is keyed on what it reads (SV-193):
// INPUTS names whole directories, less what that check never reads, so a goldens-only commit leaves
// npm test and the browser checks passed, a docs-only one leaves everything passed, and a new file
// under a directory a check reads counts without being listed. The browser checks are kept per spec
// file: a pass records each file it ran with its content, under a key of everything the spec files
// share (the app, the harness, the lockfile), so changing one spec file re-runs only that file.
//
// The content is the working tree as a git tree: tracked and untracked files, ignored ones left out,
// written through a scratch index, so it equals HEAD^{tree} once that content is committed and a run
// before the commit counts for it. A pass also carries the Node version and the installed lockfile
// (`env`), which change what runs without changing the tree. Records live in the repository's common
// git directory, so a run in a worktree counts in the main checkout too, and go after 30 days.
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PAGES} from './browser/pages.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KEEP_MS = 30 * 24 * 60 * 60_000;

export type Check = 'unit' | 'image' | 'browser' | 'pages' | 'audit';

/** What a check reads: every file under `include` (a path, or '' for the whole tree), less `exclude`. */
interface Inputs {
  include: string[];
  exclude: ((file: string) => boolean)[];
}

const under = (...dirs: string[]) => (file: string) => dirs.some(dir => file.startsWith(`${dir}/`));
const named = (...files: string[]) => (file: string) => files.includes(file);
// Prose no check reads: the docs at the top, docs/ and reviews/.
const prose = (file: string) => (!file.includes('/') && /\.md$|^LICENSE$/.test(file)) || under('docs', 'reviews')(file);
// The export, less what the app builds from (its stylesheet and fonts) and the glyphs' tests read.
const boards = (file: string) => under('design-export')(file) && !under('design-export/styles', 'design-export/glyphs')(file);
const goldens = under('web/tests/browser/goldens');
// What only npm test runs: Vitest's files, the contract it records, its fakes and component tests.
const unitOnly = (file: string) => /\.test\.tsx?$/.test(file) || under('shared/contract', 'server/tests', 'web/tests/components')(file);
const SPEC = /^web\/tests\/browser\/([^/]+)\.spec\.ts$/;
const spec = (file: string) => SPEC.test(file);
const PAGE_SPECS = new Set(PAGES.map(shot => `web/tests/browser/${shot.spec}.spec.ts`));
// The app and what a browser run builds, boots and drives it with, less the spec files themselves.
const APP = ['package.json', 'package-lock.json', 'tsconfig.base.json', 'shared', 'server', 'web', 'design-export/styles', 'design-export/glyphs'];

export const INPUTS: Record<Check, Inputs> = {
  // Lint and typecheck read every source file, so it's the whole tree less what they skip.
  unit: {include: [''], exclude: [prose, boards, goldens, named('Dockerfile', '.dockerignore')]},
  // OPERATIONS.md's build reads what the Dockerfile copies; the goldens come along in web/ but
  // build nothing.
  image: {include: ['Dockerfile', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'shared', 'server', 'web', 'extension'], exclude: [goldens]},
  browser: {include: APP, exclude: [goldens, unitOnly, spec]},
  // The app as the browser checks have it, the goldens, and the spec files that take the screenshots.
  pages: {include: APP, exclude: [unitOnly, file => spec(file) && !PAGE_SPECS.has(file)]},
  // It draws the boards beside the goldens, not the app.
  audit: {include: ['design-export', 'web/tests/browser/goldens', 'web/tests/browser/audit.ts', 'web/tests/browser/harness.ts', 'web/src/tokens.ts'], exclude: []},
};

export interface Pass {
  check: Check;
  // The spec files that passed, by name (`mail`), each with its content's blob id, for the browser checks.
  specs?: Record<string, string>;
  env: string;
  // The checkout it ran in, for the message.
  dir: string;
  at: string;
}

const git = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  execFileSync('git', args, {cwd: ROOT, encoding: 'utf8', env: {...process.env, ...env}, maxBuffer: 64 * 1024 * 1024}).trim();

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

/** Every file in `tree` under `paths` ('' for all of it), as path to mode and blob id. */
function filesOf(tree: string, paths: string[]): Map<string, string> {
  const listing = git(['ls-tree', '-r', '-z', '--full-tree', tree, ...(paths.includes('') ? [] : ['--', ...paths])]);
  const files = new Map<string, string>();
  for (const entry of listing.split('\0')) {
    const tab = entry.indexOf('\t');
    if (tab === -1) continue;
    const [mode, , id] = entry.slice(0, tab).split(' ');
    files.set(entry.slice(tab + 1), `${mode} ${id}`);
  }
  return files;
}

/** Whether `check` reads `file`, a path from the top of the repository. A browser run reads each spec file it runs too. */
export function reads(check: Check, file: string): boolean {
  const {include, exclude} = INPUTS[check];
  return include.some(top => top === '' || file === top || file.startsWith(`${top}/`)) && !exclude.some(skip => skip(file));
}

/** The files `check` reads in `tree`, as path to mode and blob id. */
export function inputsOf(tree: string, check: Check): Map<string, string> {
  return new Map([...filesOf(tree, INPUTS[check].include)].filter(([file]) => reads(check, file)));
}

/** The key `check`'s passes are recorded under in `tree`: its kind and a hash of what it reads. */
export function keyOf(tree: string, check: Check): string {
  const hash = crypto.createHash('sha256');
  for (const [file, id] of [...inputsOf(tree, check)].sort(([a], [b]) => (a < b ? -1 : 1))) hash.update(`${file}\0${id}\n`);
  return `${check}-${hash.digest('hex').slice(0, 40)}`;
}

/**
 * Whether what `check` reads, and the spec files named, are the same in trees `a` and `b`: a run
 * records its pass only if nothing it read changed while it ran.
 */
export function unchanged(a: string, b: string, check: Check, specs: string[] = []): boolean {
  if (a === b) return true;
  if (keyOf(a, check) !== keyOf(b, check)) return false;
  const [before, after] = [specsOf(a), specsOf(b)];
  return specs.every(name => before[name] === after[name]);
}

/** The spec files in `tree`, by name, each with its mode and blob id. */
export function specsOf(tree: string): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const [file, id] of filesOf(tree, ['web/tests/browser'])) {
    const name = file.match(SPEC)?.[1];
    if (name) specs[name] = id;
  }
  return specs;
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

/**
 * Records a pass of `check` on `tree`, and drops records past KEEP_MS. A browser pass
 * names the spec files it ran.
 */
export function record(tree: string, check: Check, specs?: string[]) {
  const dir = store();
  fs.mkdirSync(dir, {recursive: true});
  const contents = specs && specsOf(tree);
  const line: Pass = {check, ...(contents && {specs: Object.fromEntries(specs.map(name => [name, contents[name] ?? '-']))}), env: envOf(), dir: ROOT, at: new Date().toISOString()};
  fs.appendFileSync(path.join(dir, `${keyOf(tree, check)}.jsonl`), `${JSON.stringify(line)}\n`);
  for (const file of fs.readdirSync(dir)) {
    const at = path.join(dir, file);
    if (Date.now() - fs.statSync(at).mtimeMs > KEEP_MS) fs.rmSync(at, {force: true});
  }
}

/** The passes of `check` recorded for what it reads in `tree`, in this environment. */
export function passesOf(tree: string, check: Check): Pass[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(store(), `${keyOf(tree, check)}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  const env = envOf();
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Pass).filter(pass => pass.check === check && pass.env === env);
}

/** The spec files of `specs` (name to content) that no pass ran on that same content. */
export function missing(specs: Record<string, string>, passes: Pass[]): string[] {
  const passed = new Set(passes.flatMap(pass => Object.entries(pass.specs ?? {}).map(([name, id]) => `${name} ${id}`)));
  return Object.keys(specs).sort().filter(name => !passed.has(`${name} ${specs[name]}`));
}

/** A spec file's name as runs and records use it: `mail` for mail.spec.ts. */
export const specName = (file: string) => path.basename(file).replace(/\.spec\.ts$/, '');
