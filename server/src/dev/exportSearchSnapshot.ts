// The mail of a running Setpoint with nothing secret in it, gzipped on stdout, for scoring search
// locally against code that isn't released (src/dev/scoreSearch.ts). Self-contained, node:sqlite
// only, so it runs inside the app's container, whatever its image, and only ever reads the database:
//
//   docker compose exec -T app node --input-type=module-typescript - < server/src/dev/exportSearchSnapshot.ts | gunzip > data/search-test/mail-snapshot.sqlite
//
// SETPOINT_DB moves it off the container's database. The host's own steps live in the private ops
// workspace, not here.
//
// The copy is an SQLite memory database, not a file: the database outgrows the container's /tmp, and
// this way a run that dies leaves nothing behind. Tables are kept by name, so one this file has never
// heard of goes out empty, whatever it holds. The kept ones are what search reads and what the
// migrations need to carry on from here. Of those, only `messages.code` is a credential. It's
// blanked, but the email's own text keeps a code as it keeps any link, because that's the mail.
import {DatabaseSync} from 'node:sqlite';
import {gzipSync} from 'node:zlib';

const KEPT = new Set(['__drizzle_migrations', 'jobs_migrations', 'accounts', 'messages', 'attachments', 'triage_rules']);
const isKept = (table: string) => KEPT.has(table) || table.startsWith('messages_fts');

// What must be gone. These tables are emptied like any other; this is the check that they were.
const CREDENTIALS = [
  ['secrets', 'ciphertext'], ['sources', 'credentials'], ['owner', 'password_hash'], ['sessions', 'hash'], ['devices', 'hash'], ['ha_token', 'hash'],
  ['recovery_codes', 'hash'], ['passkeys', 'credential_id'], ['calendar_channels', 'token_hash'],
] as const;

const MEMORY = 'file:/search-snapshot?vfs=memdb';

// Open first and throughout: a memory database lasts as long as a connection to it.
const snapshot = new DatabaseSync(MEMORY, {enableForeignKeyConstraints: false});
const live = new DatabaseSync(process.env.SETPOINT_DB ?? '/data/setpoint.sqlite', {readOnly: true});
let credentials: string[];
try {
  credentials = CREDENTIALS.flatMap(([table, column]) => live.prepare(`select ${column} as value from ${table} where ${column} is not null`).all().map(row => String(row.value)));
  live.exec(`VACUUM INTO '${MEMORY}'`);
} finally {
  live.close();
}

const tables = snapshot.prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`).all().map(row => String(row.name));
const emptied = tables.filter(table => !isKept(table));
for (const table of emptied) snapshot.exec(`delete from "${table}"`);
snapshot.exec(`update messages set code = null, code_expires_at = null where code is not null`);
// Deleted rows stay in the file's free pages until a VACUUM, which needs room /tmp hasn't got.
snapshot.exec(`PRAGMA temp_store = MEMORY; VACUUM`);

const bytes = Buffer.from(snapshot.serialize());
if (credentials.some(credential => bytes.includes(credential))) throw new Error('A credential is still in the snapshot, so it stays here.');

const count = (table: string) => Number(snapshot.prepare(`select count(*) as rows from ${table}`).get()?.rows);
console.error(JSON.stringify({taken_at: new Date().toISOString(), bytes: bytes.length, messages: count('messages'), attachments: count('attachments'), emptied: emptied.length, credentials_checked: credentials.length}));
process.stdout.write(gzipSync(bytes));
