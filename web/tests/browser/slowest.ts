// A node:test reporter for the browser run (run.ts): after the spec reporter's output, the ten
// slowest checks with their spec file, so a growing run shows where its time goes.
import path from 'node:path';

interface Event {
  type: string;
  data: {name: string; file?: string; nesting: number; details?: {duration_ms: number; type?: string}};
}

const COUNT = 10;

export default async function* slowest(source: AsyncIterable<Event>): AsyncGenerator<string> {
  const checks: {name: string; file: string; ms: number}[] = [];
  // A check's own event names harness.ts, where `test` is; a file's checks are reported together,
  // then the suite the harness names for the spec file (harness.ts › register), which gives them theirs.
  let unfiled: typeof checks = [];
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const {name, file, nesting, details} = event.data;
    if (details?.type === 'suite' && nesting === 0 && name.endsWith('.spec.ts')) {
      for (const check of unfiled) check.file = name;
      unfiled = [];
    }
    // A suite (a describe, or a file's own entry) holds checks; only checks are listed.
    if (!details || details.type === 'suite' || !file || name === file) continue;
    const check = {name, file: path.basename(file), ms: details.duration_ms};
    checks.push(check);
    unfiled.push(check);
  }
  if (!checks.length) return;
  const top = checks.sort((a, b) => b.ms - a.ms).slice(0, COUNT);
  yield `\nSlowest ${top.length} of ${checks.length} checks:\n`;
  for (const check of top) yield `${(check.ms / 1000).toFixed(1).padStart(6)} s  ${check.file} › ${check.name}\n`;
}
