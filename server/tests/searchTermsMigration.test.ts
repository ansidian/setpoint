// Migration 0023_search_terms over a database at 0022 that already holds mail, jobs and a ledger
// (SV-136): the two rebuilds keep their rows, the new purpose and job kind are allowed, and mail already
// here is marked as from before terms, without touching the search index.
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
const AT = '2026-10-07T16:00:00.000Z';

function atSearchBody() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_search_terms'));
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
  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: before});
  sqlite.prepare(`insert into accounts (provider, label, address, colour, icon, position, created_at) values ('gmail', 'Personal', 'user@example.com', 'cool', 'person', 0, '${AT}')`).run();
  sqlite.prepare(`insert into messages (id, account_id, provider_id, thread_id, from_name, from_address, subject, snippet, body_text, search_body, received_at, unread)
    values (1, 1, 'm1', 't1', 'Billing Desk', 'billing@notices.example', 'Your invoice', '', 'Amount due', 'Amount due', '${AT}', 1)`).run();
  return {sqlite, db};
}

test('0023_search_terms keeps the ledger and jobs, allows the new values and marks the mail already here', () => {
  const {sqlite, db} = atSearchBody();
  sqlite.prepare(`insert into ai_usage (at, provider, model, purpose, message_id, input_tokens, output_tokens, cost_micros) values ('${AT}', 'anthropic', 'claude-haiku-5-5', 'triage', 1, 10, 2, 7)`).run();
  sqlite.prepare(`insert into jobs (kind, key, message_id, state, attempts, run_at, last_error, created_at) values ('triage', 'triage:1', 1, 'queued', 2, '${AT}', 'overloaded', '${AT}')`).run();

  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select purpose, message_id, cost_micros from ai_usage').all()).toEqual([{purpose: 'triage', message_id: 1, cost_micros: 7}]);
  expect(sqlite.prepare('select kind, key, message_id, state, attempts, last_error from jobs').all()).toEqual([{kind: 'triage', key: 'triage:1', message_id: 1, state: 'queued', attempts: 2, last_error: 'overloaded'}]);
  expect(sqlite.prepare('select search_terms, search_terms_version from messages').all()).toEqual([{search_terms: null, search_terms_version: 0}]);

  sqlite.prepare(`insert into ai_usage (at, provider, model, purpose, input_tokens, output_tokens, cost_micros) values ('${AT}', 'anthropic', 'claude-haiku-5-5', 'search_terms', 10, 2, 7)`).run();
  sqlite.prepare(`insert into jobs (kind, key, message_id, run_at, created_at) values ('search_terms', 'search_terms:1', 1, '${AT}', '${AT}')`).run();
  expect(() => sqlite.prepare(`insert into ai_usage (at, provider, model, purpose, input_tokens, output_tokens, cost_micros) values ('${AT}', 'anthropic', 'm', 'other', 1, 1, 1)`).run()).toThrow(/CHECK/);

  // Mail arriving from now on starts null, which is what's read on its own.
  sqlite.prepare(`insert into messages (id, account_id, provider_id, thread_id, from_name, from_address, subject, snippet, body_text, received_at, unread)
    values (2, 1, 'm2', 't2', 'Billing Desk', 'billing@notices.example', 'Next invoice', '', '', '${AT}', 1)`).run();
  expect(sqlite.prepare('select search_terms_version from messages where id = 2').get()).toEqual({search_terms_version: null});

  // The index still follows the column: a job's write reaches it.
  sqlite.prepare(`update messages set search_terms = 'tenancy agreement' where id = 1`).run();
  expect(sqlite.prepare(`select rowid from messages_fts where messages_fts match 'tenancy'`).all()).toEqual([{rowid: 1}]);
  sqlite.prepare(`insert into messages_fts(messages_fts) values ('integrity-check')`).run();
});
