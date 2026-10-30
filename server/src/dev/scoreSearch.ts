// How well search does on the searches a private test file marks (src/dev/searchScore.ts), through
// the real matchSearch, as numbers and search text. It only reads the database. Against the local
// snapshot (src/dev/exportSearchSnapshot.ts), where the code may be ahead of the data, --migrate
// scores a scratch copy brought up to this checkout's migrations and leaves the snapshot as it was:
//
//   SETPOINT_DB=data/search-test/mail-snapshot.sqlite node server/src/dev/scoreSearch.ts data/search-test/test.json --migrate
//
// Inside the app's container, the test file comes on stdin:
//
//   docker compose exec -T app node server/src/dev/scoreSearch.ts - < data/search-test/test.json
//
// SETPOINT_DB moves it off the container's database. The test file and the snapshot stay out of git.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {openDatabase} from '../db/open.ts';
import * as schema from '../db/schema.ts';
import type {Store} from '../store.ts';
import {scoreReport, scoreSearches, searchTest} from './searchScore.ts';

const args = process.argv.slice(2);
const migrate = args.includes('--migrate');
const testFile = args.find(arg => arg !== '--migrate');
if (!testFile) throw new Error('Usage: scoreSearch.ts <test file, or - for stdin> [--migrate]');

const {searches} = searchTest.parse(JSON.parse(fs.readFileSync(testFile === '-' ? 0 : testFile, 'utf8')));
const file = process.env.SETPOINT_DB ?? '/data/setpoint.sqlite';

function scoreOn(sqlite: Database.Database) {
  const db = drizzle(sqlite, {schema});
  const {newest} = sqlite.prepare('SELECT max(received_at) AS newest FROM messages').get() as {newest: string};
  // The newest email is "now", so the same data scores the same on any day.
  const store: Store = {sqlite, db, timeZone: process.env.SETPOINT_TZ ?? 'America/Los_Angeles', now: () => new Date(newest), keyring: null};
  console.log(scoreReport(scoreSearches(store, searches)));
}

if (migrate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-search-score-'));
  try {
    const copy = path.join(dir, 'mail.sqlite');
    fs.copyFileSync(file, copy);
    const {sqlite} = openDatabase(copy);
    scoreOn(sqlite);
    sqlite.close();
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
} else {
  const sqlite = new Database(file, {readonly: true, fileMustExist: true});
  scoreOn(sqlite);
  sqlite.close();
}
