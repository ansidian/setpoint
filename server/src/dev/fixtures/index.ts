// Board fixtures (SV decision D3): board states that contradict the brief's counts, layered on the
// dev seed for a board's baseline check rather than kept in it. Each names its board and adds rows
// to a seeded database; nothing here runs unless asked.
//
//   SETPOINT_DATA_DIR=… node server/src/dev/fixtures/index.ts busy-saturday
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadConfig} from '../../config.ts';
import {openDatabase} from '../../db/open.ts';
import type {OpenDatabase} from '../../db/open.ts';
import {busySaturday} from './busySaturday.ts';
import {failedChange, noDinner} from './calendarChanges.ts';
import {codeExpiring, coffeeHtml, lastYear, newDigest, newsletterHtml, recoveryHtml, secondPin} from './mailBoards.ts';
import {newsAiDown, newsCapped, newsFirstRun, newsQuietTech, newsStaleAi} from './newsStates.ts';
import {backfill, checked, failingWeather, failingWork, mailRules, needsReconnect, ntfy, precision, staleIcloud, stalePersonal, staleTodoist, triageDown} from './states.ts';
import {linkPlaces} from './linkPlaces.ts';
import {timeToLeave} from './timeToLeave.ts';
import {weekendForecast} from './weekendForecast.ts';

export const FIXTURES: Record<string, {board: string; apply: (database: OpenDatabase) => void}> = {
  'coffee-html': {board: '02', apply: coffeeHtml},
  'recovery-html': {board: '03', apply: recoveryHtml},
  'new-digest': {board: '09', apply: newDigest},
  'second-pin': {board: '10', apply: secondPin},
  'busy-saturday': {board: '11b', apply: busySaturday},
  'time-to-leave': {board: '11, 12a, 12b, 12d', apply: timeToLeave},
  'no-dinner': {board: '13', apply: noDinner},
  'failed-change': {board: '19b', apply: failedChange},
  // Not a board: the mail checks watch a code's row leave at its expiry.
  'code-expiring': {board: 'mail checks', apply: codeExpiring},
  // Not a board: the mail checks size the reader's frame to a newsletter that is mostly pictures.
  'newsletter-html': {board: 'mail checks', apply: newsletterHtml},
  // Not a board: the floating detail's place line with a link in it (SV-76, SV-77).
  'link-places': {board: 'detail checks', apply: linkPlaces},
  // Not a board: search's rows and Alfred's sources hold an age with its year.
  'last-year': {board: 'search checks', apply: lastYear},
  // F7 (states.ts): health states and Settings' contents.
  'needs-reconnect': {board: '17, 19a', apply: needsReconnect},
  'stale-personal': {board: '17', apply: stalePersonal},
  'stale-icloud': {board: '19a', apply: staleIcloud},
  'failing-work': {board: 'states checks', apply: failingWork},
  // SV-20: the calendar's own stale and failing lines.
  'stale-todoist': {board: '19b', apply: staleTodoist},
  'failing-weather': {board: 'calendar checks', apply: failingWeather},
  'checked': {board: '17', apply: checked},
  'triage-down': {board: '19a', apply: triageDown},
  'backfill': {board: 'search\'s indexing line', apply: backfill},
  'precision': {board: '17', apply: precision},
  'mail-rules': {board: '18a', apply: mailRules},
  'ntfy': {board: '17, 18b', apply: ntfy},
  // Not a board: the phone agenda's empty weekend with its forecasts.
  'weekend-forecast': {board: 'phone checks', apply: weekendForecast},
  // N5 (newsStates.ts): News's states and Settings › AI's cap.
  'news-ai-down': {board: '29a', apply: newsAiDown},
  'news-stale-ai': {board: '29a', apply: newsStaleAi},
  'news-quiet-tech': {board: '29a', apply: newsQuietTech},
  'news-first-run': {board: '29b', apply: newsFirstRun},
  'news-capped': {board: 'settings checks', apply: newsCapped},
};

/** Applies fixtures by name to a seeded database file. */
export function applyFixtures(file: string, names: string[]) {
  const unknown = names.filter(name => !FIXTURES[name]);
  if (unknown.length) throw new Error(`Unknown fixture: ${unknown.join(', ')}. Known: ${Object.keys(FIXTURES).join(', ')}.`);
  const database = openDatabase(file);
  try {
    for (const name of names) FIXTURES[name]!.apply(database);
  } finally {
    database.sqlite.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const names = process.argv.slice(2);
    if (!names.length) throw new Error(`Name a fixture: ${Object.keys(FIXTURES).join(', ')}.`);
    applyFixtures(loadConfig().databasePath, names);
    console.log(`Applied ${names.join(', ')}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
