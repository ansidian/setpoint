// How well search does on the searches a private test file marks (src/dev/searchScore.ts), through
// the real matchSearch, as numbers and search text. It only reads the database. Against the local
// snapshot (src/dev/exportSearchSnapshot.ts), where the code may be ahead of the data, --migrate
// scores a scratch copy brought up to this checkout's migrations and leaves the snapshot as it was.
// The copy sits beside the snapshot, so real mail stays under `data/`:
//
//   SETPOINT_DB=data/search-test/mail-snapshot.sqlite node server/src/dev/scoreSearch.ts data/search-test/test.json --migrate
//
// With --migrate, --terms <file> (any number of them) writes search terms into the scratch copy
// before scoring, as the job would: one {"id": 1, "terms": ["..."]} a line, a later line for an
// email replacing an earlier one. Terms for mail that isn't there are left out.
//
// Each search's "about" and "right" columns are the rows in the first section, and the share of its
// right emails there.
//
// Inside the app's container, the test file comes on stdin:
//
//   docker compose exec -T app node server/src/dev/scoreSearch.ts - < data/search-test/test.json
//
// SETPOINT_DB moves it off the container's database. The test file and the snapshot stay out of git.
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {openDatabase} from '../db/open.ts';
import * as schema from '../db/schema.ts';
import type {Store} from '../store.ts';
import {loadTerms, scoreReport, scoreSearches, searchTest} from './searchScore.ts';

const usage = 'Usage: scoreSearch.ts <test file, or - for stdin> [--migrate [--terms <file>]...]';
const {values: {migrate, terms: termFiles = []}, positionals: [testFile]} = parseArgs({
  allowPositionals: true,
  options: {migrate: {type: 'boolean'}, terms: {type: 'string', multiple: true}},
});
if (!testFile) throw new Error(usage);
// Search terms only ever go into a scratch copy, never the database named.
if (termFiles.length && !migrate) throw new Error(`--terms needs --migrate. ${usage}`);

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
  const dir = fs.mkdtempSync(path.join(path.dirname(file), 'score-'));
  try {
    const copy = path.join(dir, 'mail.sqlite');
    fs.copyFileSync(file, copy);
    const {sqlite} = openDatabase(copy);
    if (termFiles.length) console.log(`Search terms on ${loadTerms(sqlite, termFiles.map(terms => fs.readFileSync(terms, 'utf8')))} emails`);
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
