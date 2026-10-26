// Google Calendar into the mirror: the calendar list, then each calendar's events from its sync
// token (or a full read), applied in one transaction per calendar. Harvested from v1's mirror sync
// (see SV-6): no orderBy (or no sync token comes back), the token from the last page, a 410 means a
// full read, deleted events come too (showDeleted), and holiday calendars, whose tokens Google
// refuses straight away, are re-read whole at most once a day instead.
//
// v2 reads series and their exceptions (singleEvents off) rather than v1's expanded instances, so
// the mirror holds one recurring item and expands it itself; a series it can't expand (EXDATE, an
// all-day series, an unusual rule) takes Google's instances as rows (`expanded`). Rows a pending or
// failed change holds are left alone.
import {and, eq} from 'drizzle-orm';
import {activeCommands, itemsHeldByCommands} from '../../commands/index.ts';
import type {ItemRow} from '../../commands/itemMirror.ts';
import * as t from '../../db/schema.ts';
import {swatchFor} from '../../domain/colours.ts';
import {isoNow, noteLive, transaction} from '../../store.ts';
import type {Store} from '../../store.ts';
import type {SourceRow} from '../../sync/adapter.ts';
import {isSyncTokenGone} from './api.ts';
import type {GoogleCalendarApi, GoogleCalendarEntry, GoogleEvent} from './api.ts';
import {cancelledOccurrence, eventColumns, originalStartOf, withOwnAfter} from './normalize.ts';

const DAY = 86_400_000;
// How far back a full read goes; series reach further on their own.
export const FULL_SYNC_BACK_MS = 400 * DAY;
// The window Google's instances are read for, for series it expands.
export const INSTANCES_BACK_MS = 120 * DAY;
export const INSTANCES_AHEAD_MS = 550 * DAY;
const HOLIDAY = /#holiday@group\.v\.calendar\.google\.com$/;
// A full read on the sweep this often, so the mirror's far edge moves on with time.
export const FULL_SYNC_EVERY_MS = DAY;

type CalendarRow = typeof t.calendars.$inferSelect;

/** Calendars the user shows in Google (v1: selected, not hidden or deleted). */
export const listedCalendar = (entry: GoogleCalendarEntry) => entry.selected !== false && entry.hidden !== true && entry.deleted !== true;

/** The calendar list into `calendars`: new ones added, names and colours kept current, removed ones dropped. */
export function applyCalendarList(store: Store, source: SourceRow, entries: GoogleCalendarEntry[]): CalendarRow[] {
  const listed = entries.filter(listedCalendar).sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)) || (a.summaryOverride ?? a.summary ?? '').localeCompare(b.summaryOverride ?? b.summary ?? ''));
  return transaction(store, () => {
    const existing = store.db.select().from(t.calendars).where(and(eq(t.calendars.provider, 'google'), eq(t.calendars.accountId, source.accountId!))).all();
    const base = store.db.select({id: t.calendars.id}).from(t.calendars).all().length;
    const touched: number[] = [];
    const kept: CalendarRow[] = [];
    const heldCalendars = new Set(activeCommands(store, 'calendar').map(row => row.targetId));
    listed.forEach((entry, index) => {
      // A rename of the user's own wins over the calendar's name (v1 had these the other way round).
      const name = entry.summaryOverride || entry.summary || entry.id;
      const found = existing.find(row => row.providerId === entry.id);
      // A colour change waiting for Google, or failed in place, keeps the colour picked (SV-20).
      const colour = found && heldCalendars.has(found.id) ? found.colour : swatchFor(entry.backgroundColor);
      if (found) {
        if (found.name !== name || found.colour !== colour) touched.push(found.id);
        kept.push(store.db.update(t.calendars).set({name, colour}).where(eq(t.calendars.id, found.id)).returning().get()!);
      } else {
        const row = store.db.insert(t.calendars).values({provider: 'google', providerId: entry.id, accountId: source.accountId, name, colour, position: base + index}).returning().get();
        touched.push(row.id);
        kept.push(row);
      }
    });
    const held = itemsHeldByCommands(store);
    for (const gone of existing.filter(row => !listed.some(entry => entry.id === row.providerId))) {
      const rows = store.db.select({id: t.items.id}).from(t.items).where(eq(t.items.calendarId, gone.id)).all();
      if (heldCalendars.has(gone.id) || rows.some(row => held.has(row.id))) continue;
      store.db.delete(t.items).where(eq(t.items.calendarId, gone.id)).run();
      store.db.delete(t.syncCursors).where(and(eq(t.syncCursors.sourceId, source.id), eq(t.syncCursors.scope, `cal:${gone.providerId}`))).run();
      store.db.delete(t.calendars).where(eq(t.calendars.id, gone.id)).run();
      touched.push(gone.id);
    }
    if (touched.length) noteLive(store, {type: 'items', items: [], calendars: touched, commands: []});
    return kept;
  });
}

function readCursor(store: Store, source: SourceRow, calendar: CalendarRow): string | null {
  return store.db.select().from(t.syncCursors).where(and(eq(t.syncCursors.sourceId, source.id), eq(t.syncCursors.scope, `cal:${calendar.providerId}`))).get()?.cursor ?? null;
}

function writeCursor(store: Store, source: SourceRow, calendar: CalendarRow, cursor: string) {
  const values = {sourceId: source.id, scope: `cal:${calendar.providerId}`, cursor, updatedAt: isoNow(store)};
  store.db.insert(t.syncCursors).values(values).onConflictDoUpdate({target: [t.syncCursors.sourceId, t.syncCursors.scope], set: {cursor, updatedAt: values.updatedAt}}).run();
}

/** A calendar's cursor: Google's sync token and when the last full read was. */
interface Cursor {
  token: string | null;
  fullAt: string | null;
}
const parseCursor = (text: string | null): Cursor => {
  if (!text) return {token: null, fullAt: null};
  try {
    return JSON.parse(text) as Cursor;
  } catch {
    return {token: null, fullAt: null};
  }
};

interface Fetched {
  full: boolean;
  items: GoogleEvent[];
  zone: string;
  defaults: number[];
  // Google's instances of the series it expands, by series id (read afresh this time).
  instances: Map<string, GoogleEvent[]>;
  cursor: Cursor;
}

const isMaster = (event: GoogleEvent) => !event.recurringEventId;

/**
 * Syncs one calendar: incrementally from its token, or a full read when there's none, it was
 * refused (410), a series changed under an expanded one, or a full read is due (`full`).
 */
export async function syncCalendar(store: Store, api: GoogleCalendarApi, source: SourceRow, calendar: CalendarRow, {full = false}: {full?: boolean} = {}): Promise<void> {
  const now = store.now();
  const cursor = parseCursor(readCursor(store, source, calendar));
  const holiday = HOLIDAY.test(calendar.providerId);
  if (holiday && cursor.fullAt && now.getTime() - Date.parse(cursor.fullAt) < DAY) return;
  const read = async (fullRead: boolean) => api.events(calendar.providerId, fullRead || !cursor.token
    ? {timeMin: new Date(now.getTime() - FULL_SYNC_BACK_MS).toISOString()}
    : {syncToken: cursor.token});
  let fullRead = full || holiday || !cursor.token;
  let page;
  try {
    page = await read(fullRead);
  } catch (error) {
    if (!isSyncTokenGone(error) || fullRead) throw error;
    fullRead = true;
    page = await read(true);
  }
  const zone = page.timeZone ?? store.timeZone;
  // Series Google expands: read their instances now, outside the transaction.
  const instances = new Map<string, GoogleEvent[]>();
  for (const event of page.items.filter(isMaster)) {
    if (event.status === 'cancelled' || !event.recurrence?.length) continue;
    const columns = eventColumns(event, zone, page.defaultReminders);
    if (!columns.expanded) continue;
    instances.set(event.id, await api.instances(calendar.providerId, event.id, {
      timeMin: new Date(now.getTime() - INSTANCES_BACK_MS).toISOString(), timeMax: new Date(now.getTime() + INSTANCES_AHEAD_MS).toISOString(),
    }));
  }
  applyEvents(store, calendar, {
    full: fullRead, items: page.items, zone, defaults: page.defaultReminders, instances,
    // Holiday calendars' tokens are refused at once (v1): never kept, re-read daily.
    cursor: {token: holiday ? null : page.nextSyncToken, fullAt: fullRead ? now.toISOString() : cursor.fullAt},
  }, source);
}

/** Whether the sweep should read this calendar whole. */
export function fullReadDue(store: Store, source: SourceRow, calendar: CalendarRow): boolean {
  const cursor = parseCursor(readCursor(store, source, calendar));
  return !cursor.fullAt || store.now().getTime() - Date.parse(cursor.fullAt) >= FULL_SYNC_EVERY_MS;
}

function applyEvents(store: Store, calendar: CalendarRow, fetched: Fetched, source: SourceRow) {
  transaction(store, () => {
    const held = itemsHeldByCommands(store);
    const rows = store.db.select().from(t.items).where(eq(t.items.calendarId, calendar.id)).all();
    const byProviderId = new Map(rows.map(row => [row.providerId, row]));
    const seen = new Set<number>();
    const touched = new Set<number>();

    const upsert = (providerId: string, values: Partial<ItemRow>): ItemRow | null => {
      const found = byProviderId.get(providerId);
      if (found) {
        seen.add(found.id);
        if (held.has(found.id)) return found;
        // A sync from Google keeps Setpoint's after-reminders (D287).
        const set = values.reminders ? {...values, reminders: withOwnAfter(values.reminders, found)} : values;
        const updated = store.db.update(t.items).set(set).where(eq(t.items.id, found.id)).returning().get()!;
        if (JSON.stringify({...found}) !== JSON.stringify({...updated})) touched.add(found.id);
        byProviderId.set(providerId, updated);
        return updated;
      }
      const row = store.db.insert(t.items).values({calendarId: calendar.id, providerId, kind: 'event', title: '(No title)', ...values} as typeof t.items.$inferInsert).returning().get();
      seen.add(row.id);
      touched.add(row.id);
      byProviderId.set(providerId, row);
      return row;
    };
    const remove = (row: ItemRow) => {
      if (held.has(row.id)) return;
      store.db.delete(t.items).where(eq(t.items.id, row.id)).run();
      byProviderId.delete(row.providerId);
      touched.add(row.id);
    };

    const exception = (event: GoogleEvent) => {
      const master = byProviderId.get(event.recurringEventId!);
      const originalStart = originalStartOf(event.originalStartTime);
      if (!master || master.recurringItemId !== null || !originalStart) {
        // An occurrence of a series this calendar doesn't hold (outside the read, or deleted):
        // shown as an event of its own while it isn't cancelled.
        if (event.status === 'cancelled' || !event.start) {
          const found = byProviderId.get(event.id);
          if (found) remove(found);
          return;
        }
        upsert(event.id, {...eventColumns(event, fetched.zone, fetched.defaults), recurringItemId: null, originalStart: null, cancelled: false, recurrence: null, expanded: false});
        return;
      }
      if (event.status === 'cancelled') {
        upsert(event.id, {
          title: master.title, timeZone: master.timeZone, ...cancelledOccurrence(originalStart, master),
          recurringItemId: master.id, originalStart, cancelled: true, recurrence: null, expanded: false, etag: event.etag ?? null,
        });
        return;
      }
      upsert(event.id, {...eventColumns(event, fetched.zone, fetched.defaults), recurrence: null, expanded: false, recurringItemId: master.id, originalStart, cancelled: false});
    };

    // Series and single events first, so exceptions find their series.
    for (const event of fetched.items.filter(isMaster)) {
      if (event.status === 'cancelled') {
        const found = byProviderId.get(event.id);
        if (found) remove(found);
        continue;
      }
      if (!event.start) continue;
      upsert(event.id, {...eventColumns(event, fetched.zone, fetched.defaults), recurringItemId: null, originalStart: null, cancelled: false});
    }
    for (const event of fetched.items.filter(event => !isMaster(event))) exception(event);
    // Google's instances for the series it expands: each becomes (or stays) a row; ones it no
    // longer has go.
    for (const [masterId, list] of fetched.instances) {
      const master = byProviderId.get(masterId);
      if (!master) continue;
      const kept = new Set<string>();
      for (const instance of list) {
        exception({...instance, recurringEventId: masterId});
        kept.add(instance.id);
      }
      for (const row of [...byProviderId.values()].filter(row => row.recurringItemId === master.id && !kept.has(row.providerId))) remove(row);
    }
    // A full read is the whole calendar: what it didn't mention is gone.
    if (fetched.full) for (const row of [...byProviderId.values()]) if (!seen.has(row.id)) remove(row);
    writeCursor(store, source, calendar, JSON.stringify(fetched.cursor));
    if (touched.size) noteLive(store, {type: 'items', items: [...touched].sort((a, b) => a - b), calendars: [calendar.id], commands: []});
  });
}

/** Every calendar of the account, in the list's order. */
export function accountCalendars(store: Store, source: SourceRow): CalendarRow[] {
  return store.db.select().from(t.calendars).where(and(eq(t.calendars.provider, 'google'), eq(t.calendars.accountId, source.accountId!))).all();
}
