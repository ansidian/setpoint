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
  ['mail\'s queries importing it by a longer way round', 'server/src/queries/mail.ts', 'import {jobsPage} from \'../../src/jobs/queries.ts\';\nexport {jobsPage};\n'],
  ['re-exporting it', 'server/src/api/app.ts', 'export * from \'../jobs/index.ts\';\n'],
  ['a dynamic import', 'server/src/triage/worker.ts', 'export const load = () => import(\'../jobs/index.ts\');\n'],
  ['the reader importing the web module', 'web/src/app/Reader.tsx', 'import {JdChip} from \'./jobs/JdChip.tsx\';\nexport {JdChip};\n'],
  ['mail\'s contract importing Jobs\'s', 'shared/src/api/mail.ts', 'import type {JobsPageOut} from \'../jobs/api.ts\';\nexport type {JobsPageOut};\n'],
  ['a test outside Jobs', 'server/tests/mail.test.ts', 'import {seedJobs} from \'../src/jobs/seed.ts\';\nexport {seedJobs};\n'],
])('refuses %s', async (_, file, code) => {
  expect(await refusals(file, code)).not.toEqual([]);
});

test.each([
  ['the server, a wiring point', 'server/src/server.ts', 'import {jobsApi} from \'./jobs/index.ts\';\nexport {jobsApi};\n'],
  ['the command line, a wiring point', 'server/src/cli.ts', 'import {rereadPlan} from \'./jobs/index.ts\';\nexport {rereadPlan};\n'],
  ['the seed, a wiring point', 'server/src/dev/sample.ts', 'import {seedJobs} from \'../jobs/index.ts\';\nexport {seedJobs};\n'],
  ['shared\'s index, a wiring point', 'shared/src/index.ts', 'export * from \'./jobs/index.ts\';\n'],
  ['Jobs itself', 'server/src/jobs/queries.ts', 'import {jobsDb} from \'./db.ts\';\nimport * as t from \'../db/schema.ts\';\nexport {jobsDb, t};\n'],
  ['a file merely named jobs', 'server/src/sync/engine.ts', 'import {x} from \'./jobs.ts\';\nexport {x};\n'],
])('lets through %s', async (_, file, code) => {
  expect(await refusals(file, code)).toEqual([]);
});
