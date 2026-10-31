import {execFileSync} from 'node:child_process';
import {defineConfig} from 'vitest/config';

/** A Mac's performance cores, or null on a machine that doesn't have two kinds. */
function performanceCores(): number | null {
  try {
    return Number(execFileSync('sysctl', ['-n', 'hw.perflevel0.logicalcpu'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})) || null;
  } catch {
    return null;
  }
}

// Vitest's default of every core but one puts workers on a Mac's efficiency cores even when it's
// idle, where a test takes far longer and can pass its time limit: 6 workers on 6 performance cores
// ran the suite 5 s slower and each test about a third faster. It's set through the environment
// because test.maxWorkers here left 11 workers running, with projects (Vitest 5.0.5).
const cores = performanceCores();
if (cores) process.env.VITEST_MAX_WORKERS ??= String(cores);

// Each tested workspace has its own config.
export default defineConfig({
  test: {projects: ['server', 'web', 'web/vitest.components.config.ts']},
});
