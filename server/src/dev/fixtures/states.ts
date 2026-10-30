// F7's fixtures (SV decision D3): health states and Settings' contents the seed doesn't have, for
// boards 17, 18a, 18b and 19a and the states' browser checks. Registered in index.ts.
//
//   needs-reconnect  17, 19a: Business's Gmail refused its credentials ("Business needs sign-in")
//   stale-personal   17: Personal's checks stopped at 9:14 PM yesterday
//   stale-icloud     19a: iCloud's checks stopped at 8:40 AM
//   failing-work     the states' checks: Work's last check failed ("Gmail answered 503")
//   stale-todoist    19b (SV-20): Todoist's checks stopped at 8:40 AM ("Todoist, as of 8:40 AM")
//   failing-weather  the calendar's checks (SV-20): Weather's last check failed at 9:00 AM
//   checked          17: the other sources last checked as the board says (Calendar and Todoist
//                    9:10 AM, Weather 9:00 AM)
//   triage-down      19a: triage down since 9:09 AM, with two emails waiting in Unsorted
//   backfill         search's indexing line: the first backfill 62% through
//   precision        17: 30 days of attention mail marked Done, 82% opened first
//   mail-rules       18a: three written rules, two learned ones and 78 trusted domains
//   ntfy             18b: ntfy set up at an `.example` server (never reached), last sent 8:02 AM,
//                    and Home set for Time to Leave (17's Weather row names it too)
//
// A stale source is one whose check hangs: a running job with a lease far ahead keeps the engine
// from starting another, as a hung check would.
import {SEED_NOW} from '@setpoint/shared';
import type {RuleMatch, Settings} from '@setpoint/shared';
import {and, eq, inArray} from 'drizzle-orm';
import type {Db, OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {searchBody} from '../../domain/searchBody.ts';
import {zoned} from '../sample.ts';

const account = (db: Db, label: string) => {
  const row = db.select().from(t.accounts).where(eq(t.accounts.label, label)).get();
  if (!row) throw new Error(`The seed has no ${label} account: run \`npm run seed\` first.`);
  return row;
};

const mailSource = (db: Db, label: string) => {
  const source = db.select().from(t.sources).where(and(eq(t.sources.accountId, account(db, label).id), inArray(t.sources.provider, ['gmail', 'icloud']))).get();
  if (!source) throw new Error(`The seed's ${label} account has no source.`);
  return source;
};

export function needsReconnect({db}: OpenDatabase) {
  const source = mailSource(db, 'Business');
  const at = zoned('2026-10-07', '08:52');
  db.update(t.sources).set({
    lastCheckAt: at, lastErrorAt: at, lastSuccessAt: zoned('2026-10-07', '08:47'), lastError: 'Token has been expired or revoked. (invalid_grant)', needsReconnectAt: at,
  }).where(eq(t.sources.id, source.id)).run();
}

function stale(db: Db, label: string, at: string) {
  staleSource(db, mailSource(db, label), at);
}

function staleSource(db: Db, source: typeof t.sources.$inferSelect, at: string) {
  db.update(t.sources).set({lastCheckAt: at, lastSuccessAt: at}).where(eq(t.sources.id, source.id)).run();
  db.insert(t.jobs).values({
    kind: 'sync', key: `sync:${source.id}`, sourceId: source.id, state: 'running', attempts: 1, runAt: at, leaseUntil: '2099-01-01T00:00:00.000Z', createdAt: at,
  }).run();
}

export const stalePersonal = ({db}: OpenDatabase) => stale(db, 'Personal', zoned('2026-10-06', '21:14'));
export const staleIcloud = ({db}: OpenDatabase) => stale(db, 'iCloud', zoned('2026-10-07', '08:40'));

const calendarSource = (db: Db, provider: 'todoist' | 'weather') => {
  const source = db.select().from(t.sources).where(eq(t.sources.provider, provider)).get();
  if (!source) throw new Error(`The seed has no ${provider} source: run \`npm run seed\` first.`);
  return source;
};

// SV-20: the calendar's own lines.
export const staleTodoist = ({db}: OpenDatabase) => staleSource(db, calendarSource(db, 'todoist'), zoned('2026-10-07', '08:40'));

export function failingWeather({db}: OpenDatabase) {
  db.update(t.sources).set({
    lastCheckAt: zoned('2026-10-07', '09:00'), lastErrorAt: zoned('2026-10-07', '09:00'), lastSuccessAt: zoned('2026-10-07', '08:30'), lastError: 'Pirate Weather answered 500 Internal Server Error.',
  }).where(eq(t.sources.id, calendarSource(db, 'weather').id)).run();
}

export function failingWork({db}: OpenDatabase) {
  const source = mailSource(db, 'Work');
  db.update(t.sources).set({lastCheckAt: zoned('2026-10-07', '09:11'), lastErrorAt: zoned('2026-10-07', '09:11'), lastSuccessAt: zoned('2026-10-07', '09:06'), lastError: 'Gmail answered 503.'})
    .where(eq(t.sources.id, source.id)).run();
}

export function checked({db}: OpenDatabase) {
  const set = (provider: 'google_calendar' | 'todoist' | 'weather', at: string) =>
    db.update(t.sources).set({lastCheckAt: at, lastSuccessAt: at}).where(eq(t.sources.provider, provider)).run();
  set('google_calendar', zoned('2026-10-07', '09:10'));
  set('todoist', zoned('2026-10-07', '09:10'));
  set('weather', zoned('2026-10-07', '09:00'));
}

export function triageDown({db}: OpenDatabase) {
  db.insert(t.triageHealth).values({id: 1, lastSuccessAt: zoned('2026-10-07', '09:09'), lastFailureAt: zoned('2026-10-07', '09:11'), lastError: 'Anthropic is overloaded. (529)'})
    .onConflictDoUpdate({target: t.triageHealth.id, set: {lastSuccessAt: zoned('2026-10-07', '09:09'), lastFailureAt: zoned('2026-10-07', '09:11')}}).run();
  const minutesAgo = (minutes: number) => new Date(Date.parse(SEED_NOW) - minutes * 60_000).toISOString();
  db.insert(t.messages).values([
    {
      accountId: account(db, 'Jobs').id, providerId: 'fixture-19a-assessment', threadId: 'fixture-19a-assessment-thread',
      fromName: 'Fabrikam', fromAddress: 'no-reply@fabrikam.example', via: 'Workday', subject: 'Online assessment · Data Analyst',
      snippet: 'Your online assessment for the Data Analyst role is ready.', bodyText: 'Your online assessment for the Data Analyst role is ready. Complete it within 5 days.',
      searchBody: searchBody('Your online assessment for the Data Analyst role is ready. Complete it within 5 days.'),
      receivedAt: minutesAgo(1), unread: true,
    },
    {
      accountId: account(db, 'Personal').id, providerId: 'fixture-19a-order', threadId: 'fixture-19a-order-thread',
      fromName: 'Tailspin Toys', fromAddress: 'orders@tailspintoys.example', subject: 'Order confirmation',
      snippet: 'Thanks for your order.', bodyText: 'Thanks for your order. We\'ll email you when it ships.',
      searchBody: searchBody('Thanks for your order. We\'ll email you when it ships.'),
      receivedAt: minutesAgo(2), unread: true,
    },
  ]).run();
}

export function backfill({db}: OpenDatabase) {
  const source = mailSource(db, 'Personal');
  const state = {since: zoned('2025-10-07', '09:00'), total: 1000, fetched: 620, done: false, cursor: null, startedAt: zoned('2026-10-07', '08:30'), finishedAt: null};
  db.insert(t.syncCursors).values({sourceId: source.id, scope: 'backfill', cursor: JSON.stringify(state), updatedAt: zoned('2026-10-07', '09:11')}).run();
}

// Opened first, of five Done a day, over the 30 days to Oct 7, oldest first: 123 of 150 (82%).
const OPENED = [3, 3, 4, 3, 3, 4, 4, 3, 4, 4, 4, 4, 4, 5, 4, 4, 4, 5, 4, 4, 5, 4, 5, 5, 4, 5, 5, 4, 5, 4];

export function precision({db}: OpenDatabase) {
  const personal = account(db, 'Personal').id;
  const day = Date.parse(SEED_NOW);
  db.insert(t.messages).values(OPENED.flatMap((opened, index) => Array.from({length: 5}, (_, n) => {
    const at = new Date(day - (29 - index) * 86_400_000 - (n + 1) * 3_600_000).toISOString();
    const id = `fixture-17-precision-${index}-${n}`;
    return {
      accountId: personal, providerId: id, threadId: `${id}-thread`, fromName: 'Fixture', fromAddress: 'fixture@example.com',
      subject: 'Attention', snippet: '', bodyText: '', receivedAt: at, unread: false, lane: 'attention' as const, kind: 'other' as const,
      doneAt: at, openedBeforeDone: n < opened,
    };
  }))).run();
}

const RULES: {match: RuleMatch; lane: 'attention' | 'fyi' | 'noise'; kind: 'money' | 'updates' | null; origin: 'written' | 'learned'; at: string}[] = [
  {match: {from_domains: ['university.edu'], subject_includes: ['Registrar']}, lane: 'attention', kind: null, origin: 'written', at: zoned('2026-08-02', '10:00')},
  {match: {from_domains: ['woodgrovebank.example']}, lane: 'fyi', kind: 'money', origin: 'written', at: zoned('2026-08-02', '10:01')},
  {match: {from_domains: ['news.fabrikam.com']}, lane: 'noise', kind: null, origin: 'written', at: zoned('2026-08-02', '10:02')},
  {match: {organisation: 'Northwind', type: 'newsletter'}, lane: 'fyi', kind: 'updates', origin: 'learned', at: zoned('2026-10-07', '08:20')},
  {match: {organisation: 'Proseware', type: 'alert'}, lane: 'fyi', kind: 'updates', origin: 'learned', at: zoned('2026-09-18', '12:00')},
];

// Newest first, as Settings › Mail lists them: the board's eleven, then 67 more trusted earlier.
const DOMAINS = ['northwind.com', 'woodgrovebank.example', 'wingtiptoys.example', 'consolidatedmessenger.example', 'woodgrovepay.example', 'proseware.example', 'southridgevideo.example', 'greenhouse.io', 'fabrikam.com', 'contoso.com', 'parkside.example.com'];

export function mailRules({db}: OpenDatabase) {
  RULES.forEach((rule, position) => {
    db.insert(t.triageRules).values({origin: rule.origin, match: rule.match, lane: rule.lane, kind: rule.kind, position: rule.origin === 'written' ? position : 0, createdAt: rule.at}).run();
  });
  const all = [...DOMAINS, ...Array.from({length: 67}, (_, index) => `sender-${String(index + 1).padStart(2, '0')}.example.com`)];
  const newest = Date.parse(zoned('2026-10-06', '18:00'));
  db.insert(t.trustedDomains).values(all.map((domain, index) => ({domain, createdAt: new Date(newest - index * 86_400_000).toISOString()}))).run();
}

export function ntfy({db}: OpenDatabase) {
  const at = zoned('2026-10-07', '09:00');
  const notifications: Partial<Settings['notifications']> = {ntfy_server: 'https://ntfy.example.net'};
  const calendar: Partial<Settings['calendar']> = {home: {label: 'Home', address: '100 Example Ave', lat: 34.09, lng: -118.33}};
  db.insert(t.settings).values([{section: 'notifications', value: notifications, updatedAt: at}, {section: 'calendar', value: calendar, updatedAt: at}]).run();
  db.insert(t.notifications).values({
    kind: 'reminder', topic: 'reminders', title: 'Gym', body: 'In 10 min · 7:00 – 8:00 AM', click: null, state: 'sent', createdAt: zoned('2026-10-07', '08:02'),
  }).run();
}
