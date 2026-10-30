// The search snapshot (src/dev/exportSearchSnapshot.ts), run as it runs on a host: on a database with
// a credential in every place one can be, and a table it has never heard of. What comes out is the
// mail, with no trace of the rest in its bytes, and goes through the migrations and the real search.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {describe, expect, onTestFinished, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';
import {seedSampleData} from '../src/dev/sample.ts';
import {matchSearch} from '../src/search/search.ts';
import type {Store} from '../src/store.ts';

const NOW = '2026-10-30T12:00:00.000Z';
// Each export starts a Node process, which a machine that's busy can take seconds over.
const SPAWNING = 30_000;

/** Each credential is its own invented value, findable in a file's bytes. */
const CREDENTIALS: [string, string][] = [
  ['ciphertext of a key', `INSERT INTO secrets (name, ciphertext, updated_at) VALUES ('anthropic_api_key', ?, '${NOW}')`],
  ['password hash', `INSERT INTO owner (id, password_hash, claimed_at) VALUES (1, ?, '${NOW}')`],
  ['session hash', `INSERT INTO sessions (hash, security_generation, method, created_at, last_used_at) VALUES (?, 1, 'password', '${NOW}', '${NOW}')`],
  ['device hash', `INSERT INTO devices (hash, name, created_at) VALUES (?, 'A phone', '${NOW}')`],
  ['home assistant hash', `INSERT INTO ha_token (id, hash, created_at) VALUES (1, ?, '${NOW}')`],
  ['recovery code hash', `INSERT INTO recovery_codes (hash, generated_at) VALUES (?, '${NOW}')`],
  ['source credentials', `INSERT INTO sources (provider, credentials, sync_mode, interval_seconds, created_at) VALUES ('todoist', ?, 'poll', 60, '${NOW}')`],
  ['a table nobody listed', `INSERT INTO not_in_any_list (held) VALUES (?)`],
];

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-search-snapshot-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

function liveDatabase(dir: string) {
  const file = path.join(dir, 'live.sqlite');
  const {sqlite, db} = openDatabase(file);
  seedSampleData({sqlite, db}, {newsImagesDir: null});
  sqlite.exec('CREATE TABLE not_in_any_list (held TEXT)');
  for (const [value, insert] of CREDENTIALS) sqlite.prepare(insert).run(`invented ${value}`);
  sqlite.prepare(`UPDATE messages SET code = '4AF2C9', code_expires_at = ? WHERE id = (SELECT min(id) FROM messages)`).run(NOW);
  return {file, sqlite, db};
}

const script = fileURLToPath(new URL('../src/dev/exportSearchSnapshot.ts', import.meta.url));
const exportFrom = (file: string) => spawnSync(process.execPath, ['--no-warnings', script], {env: {...process.env, SETPOINT_DB: file}, maxBuffer: 64 * 1024 * 1024});

describe('exportSearchSnapshot.ts', () => {
  test('holds the mail and no credential, and leaves the database as it was', () => {
    const dir = scratch();
    const live = liveDatabase(dir);
    onTestFinished(() => {
      live.sqlite.close();
    });
    const out = exportFrom(live.file);
    expect(out.status).toBe(0);
    const bytes = gunzipSync(out.stdout);

    for (const [value] of CREDENTIALS) {
      expect(bytes.includes(`invented ${value}`), value).toBe(false);
      expect(fs.readFileSync(live.file).includes(`invented ${value}`) || fs.readFileSync(`${live.file}-wal`).includes(`invented ${value}`), value).toBe(true);
    }
    expect(bytes.includes('Lease renewal terms')).toBe(true);

    const file = path.join(dir, 'snapshot.sqlite');
    fs.writeFileSync(file, bytes);
    const {sqlite, db} = openDatabase(file);
    onTestFinished(() => {
      sqlite.close();
    });
    const rows = (table: string) => (sqlite.prepare(`SELECT count(*) AS rows FROM ${table}`).get() as {rows: number}).rows;
    for (const table of ['secrets', 'owner', 'sessions', 'devices', 'ha_token', 'recovery_codes', 'sources', 'sync_cursors', 'settings', 'not_in_any_list', 'jobs', 'items', 'news_articles']) {
      expect(rows(table), table).toBe(0);
    }
    expect(rows('messages')).toBe((live.sqlite.prepare('SELECT count(*) AS rows FROM messages').get() as {rows: number}).rows);
    expect(sqlite.prepare('SELECT count(*) AS rows FROM messages WHERE code IS NOT NULL OR code_expires_at IS NOT NULL').get()).toEqual({rows: 0});
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.pragma('integrity_check')).toEqual([{integrity_check: 'ok'}]);

    const storeOn = (over: Pick<Store, 'sqlite' | 'db'>): Store => ({...over, timeZone: 'America/Los_Angeles', now: () => new Date(NOW), keyring: null});
    const ids = (store: Store) => matchSearch(store, {text: 'lease renewal', chips: [], account_id: undefined}).ids;
    expect(ids(storeOn({sqlite, db})).length).toBeGreaterThan(0);
    expect(ids(storeOn({sqlite, db}))).toEqual(ids(storeOn(live)));
  }, SPAWNING);

  test('a later migration runs on it, rebuilding a table it emptied', () => {
    const dir = scratch();
    const live = liveDatabase(dir);
    live.sqlite.close();
    const file = path.join(dir, 'snapshot.sqlite');
    fs.writeFileSync(file, gunzipSync(exportFrom(live.file).stdout));
    const forgetLast = openDatabase(file);
    const rowsBefore = forgetLast.sqlite.prepare('SELECT count(*) AS rows FROM __drizzle_migrations').get();
    forgetLast.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE id = (SELECT max(id) FROM __drizzle_migrations)').run();
    forgetLast.sqlite.close();

    const {sqlite} = openDatabase(file);
    onTestFinished(() => {
      sqlite.close();
    });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    expect(sqlite.prepare('SELECT count(*) AS rows FROM __drizzle_migrations').get()).toEqual(rowsBefore);
  }, SPAWNING);

  test('sends nothing when a credential would still be in it', () => {
    const dir = scratch();
    const live = liveDatabase(dir);
    live.sqlite.prepare(`UPDATE messages SET body_text = 'invented session hash' WHERE id = (SELECT min(id) FROM messages)`).run();
    live.sqlite.close();
    const out = exportFrom(live.file);
    expect(out.status).not.toBe(0);
    expect(out.stdout.length).toBe(0);
  }, SPAWNING);
});
