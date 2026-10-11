// A world with one Google account (Personal) connected as Connect Gmail connects it (one consent,
// written to its Gmail and Calendar sources), the Google Calendar adapter pointed at a fake Google
// on 127.0.0.1, and the sync engine. The user's calendar is
// the brief's: Gym Mon/Wed/Fri 7–8 AM from Aug 31, Dinner with Sam Fri Oct 9 7–9 PM at Blue Door.
import {and, eq} from 'drizzle-orm';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {Notifier} from '../src/notify/index.ts';
import {DEFAULT_SCHEDULES} from '../src/domain/sources.ts';
import {googleCalendarAdapter} from '../src/providers/gcal/index.ts';
import {GOOGLE_ENDPOINTS} from '../src/providers/google/auth.ts';
import {itemsInRange} from '../src/queries/items.ts';
import {connectMailAccount} from '../src/sync/connect.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import type {Store} from '../src/store.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeGoogle} from './fakes/google.ts';
import {world} from './helpers.ts';

export const PERSONAL = 'user@example.com';
export const HOLIDAYS = 'en.usa#holiday@group.v.calendar.google.com';
export const PUBLIC_URL = 'https://setpoint.example.com';

/** Connect Gmail's outcome for Personal (B2's flow without the browser): one consent for Gmail and Calendar. */
export function connectPersonal(store: Store, accountId?: number) {
  return connectMailAccount(store, {
    provider: 'gmail', address: PERSONAL, label: 'Personal', colour: 'cool', icon: 'person', accountId,
    credentials: {kind: 'oauth', refresh_token: 'refresh-personal', access_token: null, expires_at: null, scope: null},
    syncMode: DEFAULT_SCHEDULES.gmail.mode, intervalSeconds: DEFAULT_SCHEDULES.gmail.intervalSeconds,
    alsoSources: [{provider: 'google_calendar', syncMode: DEFAULT_SCHEDULES.google_calendar.mode, intervalSeconds: DEFAULT_SCHEDULES.google_calendar.intervalSeconds}],
  });
}

export async function calendarWorld({push = false, webhookOrigin = null}: {push?: boolean; webhookOrigin?: string | null} = {}) {
  const w = world();
  const google = await fakeGoogle();
  google.addCalendar({id: PERSONAL, summary: PERSONAL, summaryOverride: 'Personal', backgroundColor: '#4986e7', primary: true, defaultReminders: [{method: 'popup', minutes: 10}]});
  google.addCalendar({id: HOLIDAYS, summary: 'Holidays in United States', backgroundColor: '#16a765', accessRole: 'reader'});
  google.addCalendar({id: 'hidden@example.com', summary: 'Hidden', backgroundColor: '#ff0000', selected: false});
  google.put(PERSONAL, {
    id: 'gym', summary: 'Gym', start: {dateTime: zoned('2026-08-31', '07:00'), timeZone: 'America/Los_Angeles'},
    end: {dateTime: zoned('2026-08-31', '08:00'), timeZone: 'America/Los_Angeles'}, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'], reminders: {useDefault: true},
  });
  google.put(PERSONAL, {
    id: 'dinner', summary: 'Dinner with Sam', location: 'Blue Door, 2118 Sunset Blvd', start: {dateTime: zoned('2026-10-09', '19:00'), timeZone: 'America/Los_Angeles'},
    end: {dateTime: zoned('2026-10-09', '21:00'), timeZone: 'America/Los_Angeles'}, attendees: [{email: 'sam@example.org', displayName: 'Sam Lee'}, {email: PERSONAL, self: true}],
    reminders: {useDefault: false, overrides: [{method: 'popup', minutes: 60}]},
  });
  google.put(HOLIDAYS, {id: 'columbus', summary: 'Columbus Day', start: {date: '2026-10-12'}, end: {date: '2026-10-13'}, eventType: 'default'});

  const connected = connectPersonal(w.store);
  const account = w.store.db.select().from(t.accounts).where(eq(t.accounts.id, connected.accountId)).get()!;
  const [gmail, source] = connected.sourceIds.map(id => w.store.db.select().from(t.sources).where(eq(t.sources.id, id)).get()!) as [typeof t.sources.$inferSelect, typeof t.sources.$inferSelect];

  const client = {clientId: 'client-id', clientSecret: 'client-secret', endpoints: {...GOOGLE_ENDPOINTS, token: google.tokenUrl}};
  const notifier = new Notifier(w.store, {publicUrl: PUBLIC_URL});
  const start = (origin: string | null, timeoutMs?: number) => {
    const adapter = googleCalendarAdapter({client, baseUrl: google.calendarApi, publicUrl: push ? PUBLIC_URL : null, webhookOrigin: origin, timeoutMs: 2000});
    return new SyncEngine({store: w.store, adapters: new Adapters({google_calendar: adapter}), notifier, ...(timeoutMs ? {timeoutMs} : {})});
  };
  let engine = start(webhookOrigin);
  /**
   * Setpoint started again with another SETPOINT_WEBHOOK_ORIGIN, on the same database, or with a
   * short job timeout for just the step that tests a hung Google.
   */
  const restart = (origin: string | null, timeoutMs?: number) => (engine = start(origin, timeoutMs));

  /** Runs what's due until nothing is. */
  const run = async () => {
    for (let round = 0; round < 5; round += 1) {
      await engine.tick();
      await engine.settled();
    }
  };
  const calendar = (providerId: string) => w.store.db.select().from(t.calendars).where(eq(t.calendars.providerId, providerId)).get()!;
  const item = (providerId: string) => w.store.db.select().from(t.items).where(and(eq(t.items.calendarId, calendar(PERSONAL).id), eq(t.items.providerId, providerId))).get()!;
  const day = (date: string) => itemsInRange(w.store, date, new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)).items;
  const titles = (date: string) => day(date).map(entry => `${entry.title}${entry.starts_at ? ` ${new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit'}).format(new Date(entry.starts_at)).replace(/\s/g, ' ')}` : ''}`);
  const command = (id: number) => w.store.db.select().from(t.commands).where(eq(t.commands.id, id)).get()!;
  return {w, google, get engine() {
    return engine;
  }, restart, source, gmail, account, run, calendar, item, day, titles, command};
}
