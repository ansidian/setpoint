// Migration 0005_triage over a database at 0004 that already holds jobs and mail (B3): its jobs survive the
// jobs table's rebuild, the FTS triggers from 0002 stay, and deleting a rule keeps the emails it
// sorted (the hand-restored ON DELETE SET NULL).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';
import {registerMigrationFunctions} from '../src/db/open.ts';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

test('0005_triage applies over a database at 0004 with jobs and mail', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  // The migrations folder as it was before B3.
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_triage'));
  expect(upTo).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, upTo);
  fs.writeFileSync(path.join(before, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(before, `${entry.tag}.sql`));

  const sqlite = new Database(path.join(dir, 'setpoint.sqlite'));
  onTestFinished(() => {
    sqlite.close();
  });
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, {migrationsFolder: before});
  sqlite.prepare(`insert into jobs (kind, key, state, run_at, created_at) values ('sync', 'sync:1', 'queued', '2026-10-07T16:00:00.000Z', '2026-10-07T16:00:00.000Z')`).run();
  sqlite.prepare(`insert into accounts (provider, label, address, colour, icon, position, created_at) values ('gmail', 'Personal', 'user@example.com', 'cool', 'person', 0, '2026-10-07T16:00:00.000Z')`).run();
  sqlite.prepare(`insert into messages (account_id, provider_id, thread_id, from_name, from_address, subject, snippet, body_text, received_at, unread)
    values (1, 'm1', 't1', 'Woodgrove Bank', 'no-reply@woodgrovebank.example', 'Statement ready', 'Your statement', 'Your statement is ready', '2026-10-07T16:00:00.000Z', 1)`).run();

  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select kind, key, state, message_id from jobs').all()).toEqual([{kind: 'sync', key: 'sync:1', state: 'queued', message_id: null}]);
  sqlite.prepare(`insert into jobs (kind, key, message_id, run_at, created_at) values ('triage', 'triage:1', 1, '2026-10-07T16:00:00.000Z', '2026-10-07T16:00:00.000Z')`).run();
  expect(sqlite.prepare(`select count(*) as n from messages_fts where messages_fts match 'statement'`).get()).toEqual({n: 1});
  const triggers = (sqlite.prepare(`select name from sqlite_master where type = 'trigger' order by name`).all() as {name: string}[]).map(row => row.name);
  expect(triggers).toEqual(['messages_fts_delete', 'messages_fts_insert', 'messages_fts_update']);

  sqlite.prepare(`insert into triage_rules (origin, match, lane, kind, position, created_at) values ('written', '{"from_domains":["woodgrovebank.example"]}', 'fyi', 'money', 0, '2026-10-07T16:00:00.000Z')`).run();
  sqlite.prepare(`update messages set lane = 'fyi', triage_source = 'rule', triage_rule_id = 1`).run();
  sqlite.prepare('delete from triage_rules where id = 1').run();
  expect(sqlite.prepare('select lane, triage_rule_id from messages').get()).toEqual({lane: 'fyi', triage_rule_id: null});
  // A deleted email takes its triage job with it.
  sqlite.prepare('delete from messages').run();
  expect(sqlite.prepare(`select count(*) as n from jobs where kind = 'triage'`).get()).toEqual({n: 0});
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
});
