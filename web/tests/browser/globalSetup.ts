// The browser checks' global setup (`npm run test:browser`, or `node --test` given it): the run's
// lock (lock.ts), which run.ts already holds, and one directory of seeded templates
// (harness.ts › template) for every spec file in the run, removed when the run ends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {holdForRun, release} from './lock.ts';

export async function globalSetup() {
  await holdForRun();
  process.env.SETPOINT_BROWSER_TEMPLATES = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-templates-'));
}

export function globalTeardown() {
  const root = process.env.SETPOINT_BROWSER_TEMPLATES;
  if (root) fs.rmSync(root, {recursive: true, force: true});
  release();
}
