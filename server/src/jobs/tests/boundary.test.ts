// The module boundary's lint rule (D303): the repository's own eslint.config.js refuses an import of
// Jobs from mail (or anywhere outside Jobs's folders), and lets Jobs's wiring points and Jobs itself
// through.
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';
import {expect, test} from 'vitest';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const eslint = new ESLint({cwd: ROOT, cache: false});

async function refusals(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, {filePath});
  return result!.messages.filter(message => message.ruleId === 'module-boundary/jobs').map(message => message.line);
}

test.each([
  ['mail\'s sync engine importing Jobs\'s store', 'server/src/sync/engine.ts', 'import {jobsDb} from \'../jobs/db.ts\';\nexport {jobsDb};\n'],
  ['re-exporting it', 'server/src/api/app.ts', 'export * from \'../jobs/index.ts\';\n'],
  ['a dynamic import', 'server/src/triage/worker.ts', 'export const load = () => import(\'../jobs/index.ts\');\n'],
  ['the reader importing the web module', 'web/src/app/Reader.tsx', 'import {JdChip} from \'./jobs/JdChip.tsx\';\nexport {JdChip};\n'],
  ['mail\'s contract importing Jobs\'s', 'shared/src/api/mail.ts', 'import type {JobsPageOut} from \'../jobs/api.ts\';\nexport type {JobsPageOut};\n'],
])('refuses %s', async (_, file, code) => {
  expect(await refusals(file, code)).not.toEqual([]);
});

// The wiring points and Jobs itself pass because `npm test` lints the real files.
test('lets through a file merely named jobs', async () => {
  expect(await refusals('server/src/sync/engine.ts', 'import {x} from \'./jobs.ts\';\nexport {x};\n')).toEqual([]);
});
