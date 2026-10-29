// Removing Jobs (D303): drop.sql, applied to an ephemeral database holding mail and Jobs, drops every
// jobs_ table and Jobs's migrations table, and leaves every other table and row exactly as it was.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {expect, test} from 'vitest';
import {world} from '../../../tests/helpers.ts';
import {mailCounts} from '../../queries/mail.ts';

const DROP = fs.readFileSync(fileURLToPath(new URL('../drop.sql', import.meta.url)), 'utf8');

test('drop.sql removes Jobs and leaves mail untouched', () => {
  const w = world({seed: true});
  const {sqlite} = w.store;
  const tables = () => (sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name').all() as {name: string}[])
    .map(row => row.name);
  const rows = () => Object.fromEntries(tables().filter(name => !name.startsWith('jobs_')).map(name => [name, sqlite.prepare(`SELECT * FROM "${name}"`).all()]));

  const jobsTables = tables().filter(name => name.startsWith('jobs_'));
  expect(jobsTables).toContain('jobs_migrations');
  expect(sqlite.prepare('SELECT count(*) AS n FROM jobs_applications').get()).toEqual({n: 62});
  const mailBefore = rows();
  expect((mailBefore.messages as unknown[]).length).toBeGreaterThan(30);
  const countsBefore = mailCounts(w.store);

  sqlite.exec(DROP);

  expect(tables().filter(name => name.startsWith('jobs_'))).toEqual([]);
  expect(tables()).toEqual(Object.keys(mailBefore));
  expect(rows()).toEqual(mailBefore);
  expect(mailCounts(w.store)).toEqual(countsBefore);
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
});
