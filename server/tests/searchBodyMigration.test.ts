// Migration 0022_search_body over a database at 0021 that already holds mail (SV-135): every email
// gets its search body from the same rule as new mail, the index is rebuilt over it and the summary,
// and its triggers follow the new columns.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';
import {registerMigrationFunctions} from '../src/db/open.ts';
import {searchBody} from '../src/domain/searchBody.ts';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const AT = '2026-10-07T16:00:00.000Z';

function atSearchBody() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_search_body'));
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
  sqlite.prepare(`insert into accounts (provider, label, address, colour, icon, position, created_at) values ('gmail', 'Personal', 'user@example.com', 'cool', 'person', 0, '${AT}')`).run();
  return {sqlite, db};
}

const insert = (sqlite: Database.Database, id: number, values: {subject: string; body: string; summary?: string; organisation?: string}) => sqlite.prepare(`
  insert into messages (id, account_id, provider_id, thread_id, from_name, from_address, organisation, subject, summary, snippet, body_text, received_at, unread)
  values (?, 1, ?, ?, 'Billing Desk', 'billing@notices.example', ?, ?, ?, '', ?, '${AT}', 1)`).run(id, `m${id}`, `t${id}`, values.organisation ?? null, values.subject, values.summary ?? null, values.body);
const matches = (sqlite: Database.Database, query: string) => (sqlite.prepare('select rowid from messages_fts where messages_fts match ? order by rowid').all(query) as {rowid: number}[]).map(row => row.rowid);
const integrity = (sqlite: Database.Database) => sqlite.prepare(`insert into messages_fts(messages_fts) values ('integrity-check')`).run();

test('0022_search_body fills every email and rebuilds the index over it', () => {
  const {sqlite, db} = atSearchBody();
  const invoice = 'Your invoice is ready.\n\nView it at https://fhwbilling.example/i/8842?campaign=spring today.\n\nTo unsubscribe, click here.';
  insert(sqlite, 1, {subject: 'Your invoice', body: invoice, summary: 'Electricity bill is due', organisation: 'Foothill Water'});
  insert(sqlite, 2, {subject: 'Lunch', body: 'See you at noon.'});
  insert(sqlite, 3, {subject: 'No body', body: ''});
  expect(matches(sqlite, '"campaign"')).toEqual([1]);
  expect(matches(sqlite, '"electricity"')).toEqual([]);

  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select id, body_text, search_body, search_terms from messages order by id').all()).toEqual([
    {id: 1, body_text: invoice, search_body: 'Your invoice is ready.\n\nView it at fhwbilling today.', search_terms: null},
    {id: 2, body_text: 'See you at noon.', search_body: 'See you at noon.', search_terms: null},
    {id: 3, body_text: '', search_body: '', search_terms: null},
  ]);
  expect(sqlite.prepare('select search_body from messages where id = 1').get()).toEqual({search_body: searchBody(invoice)});
  integrity(sqlite);
  // From the body, by a link's domain, from the summary, and from every field the old index had.
  expect(matches(sqlite, '"invoice"')).toEqual([1]);
  expect(matches(sqlite, '"fhw"*')).toEqual([1]);
  expect(matches(sqlite, '"electricity"')).toEqual([1]);
  expect(matches(sqlite, '"foothill"')).toEqual([1]);
  expect(matches(sqlite, '"billing"')).toEqual([1, 2, 3]);
  expect(matches(sqlite, '"noon"')).toEqual([2]);
  // A link's path and a footer are gone.
  expect(matches(sqlite, '"campaign"')).toEqual([]);
  expect(matches(sqlite, '"unsubscribe"')).toEqual([]);
  expect(matches(sqlite, '{search_body} : "electricity"')).toEqual([]);
  expect(matches(sqlite, '{summary} : "electricity"')).toEqual([1]);

  const triggers = (sqlite.prepare(`select name from sqlite_master where type = 'trigger' order by name`).all() as {name: string}[]).map(row => row.name);
  expect(triggers).toEqual(['messages_fts_delete', 'messages_fts_insert', 'messages_fts_update']);
});

test('the triggers follow the new columns on rows from before it and after it', () => {
  const {sqlite, db} = atSearchBody();
  insert(sqlite, 1, {subject: 'Before', body: 'Old words.'});
  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: MIGRATIONS});

  sqlite.prepare(`update messages set summary = 'Electricity bill', search_terms = 'utility payment' where id = 1`).run();
  expect(matches(sqlite, '"electricity"')).toEqual([1]);
  expect(matches(sqlite, '"utility"')).toEqual([1]);
  sqlite.prepare(`update messages set summary = 'Gas bill', search_terms = null where id = 1`).run();
  expect(matches(sqlite, '"electricity"')).toEqual([]);
  expect(matches(sqlite, '"utility"')).toEqual([]);
  expect(matches(sqlite, '"gas"')).toEqual([1]);
  sqlite.prepare(`update messages set search_body = 'Fresh words.' where id = 1`).run();
  expect(matches(sqlite, '"old"')).toEqual([]);
  expect(matches(sqlite, '"fresh"')).toEqual([1]);

  sqlite.prepare(`insert into messages (id, account_id, provider_id, thread_id, from_name, from_address, subject, snippet, body_text, search_body, received_at, unread)
    values (2, 1, 'm2', 't2', 'Billing Desk', 'billing@notices.example', 'After', '', 'Plain.', 'Plain.', '${AT}', 1)`).run();
  expect(matches(sqlite, '"plain"')).toEqual([2]);
  integrity(sqlite);
  sqlite.prepare('delete from messages').run();
  expect(matches(sqlite, '"gas"')).toEqual([]);
  expect(matches(sqlite, '"plain"')).toEqual([]);
  integrity(sqlite);
});

test('a write to other columns leaves the index alone', () => {
  const {sqlite, db} = atSearchBody();
  insert(sqlite, 1, {subject: 'Before', body: 'Old words.'});
  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: MIGRATIONS});
  sqlite.prepare(`update messages set unread = 0, body_html = '<p>Other</p>' where id = 1`).run();
  expect(matches(sqlite, '"old"')).toEqual([1]);
  expect(matches(sqlite, '"other"')).toEqual([]);
  integrity(sqlite);
});

test('it stops the whole migration if the rule fails, leaving the database as it was', () => {
  const {sqlite, db} = atSearchBody();
  insert(sqlite, 1, {subject: 'Before', body: 'Old words.'});
  sqlite.function('search_body_of', () => {
    throw new Error('the rule failed');
  });
  expect(() => migrate(db, {migrationsFolder: MIGRATIONS})).toThrow();
  expect(matches(sqlite, '"old"')).toEqual([1]);
  const columns = (sqlite.prepare(`select name from pragma_table_info('messages')`).all() as {name: string}[]).map(row => row.name);
  expect(columns).not.toContain('search_body');
  integrity(sqlite);
});
