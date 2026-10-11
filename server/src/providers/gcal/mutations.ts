// Calendar changes carried out at Google. The command layer has already changed the mirror
// (src/commands/itemMirror.ts); this makes the same change at Google, scope by scope, and records
// the ids Google assigned. Rewritten from v1's `calendar-mutations` (see SV-6), keeping its rules:
// - a create carries an id Setpoint chose, so a retry after a timeout finds it instead of making a
//   second event (409 "already exists" → read it back);
// - writes send If-Match with the etag Setpoint last saw, so a change made elsewhere since is
//   refused in Google's words rather than overwritten;
// - "This and following" at the first occurrence is "All events";
// - deleting one occurrence cancels it; deleting an event Google has already deleted is done;
// - Google's own kinds of event (birthdays…) are never written.
// And fixing v1's: the new series of a split is created first with a chosen id, then the old one
// trimmed, so a retry can't lose half; the trim keeps EXDATE lines; "All events" shifts the series
// by the moved occurrence's change instead of moving its start to that occurrence; times are written
// in the event's own zone.
import {createHash} from 'node:crypto';
import type {Colour, ItemChanges, RecurringScope} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import type {CommandRow, Previous} from '../../commands/index.ts';
import type {ItemDeletion, ItemRow} from '../../commands/itemMirror.ts';
import * as t from '../../db/schema.ts';
import {CALENDAR_HEX, foregroundFor} from '../../domain/colours.ts';
import type {Store} from '../../store.ts';
import {ProviderError} from '../../sync/errors.ts';
import {isAlreadyThere, isNotFound} from './api.ts';
import type {GoogleCalendarApi, GoogleEvent} from './api.ts';
import {colorIdOf, eventBody, isFirstOccurrence, ruleEndingBefore, withRule} from './normalize.ts';
import {claimProviderId} from '../../commands/itemMirror.ts';

/** A Google event id Setpoint chooses (base32hex, `[0-9a-v]{5,1024}`), the same on every retry. */
export const chosenEventId = (command: CommandRow, itemId: number) => `sp${createHash('sha256').update(`setpoint:${command.id}:${itemId}`).digest('hex').slice(0, 30)}`;

const itemRow = (store: Store, id: number) => store.db.select().from(t.items).where(eq(t.items.id, id)).get() ?? null;
const calendarOf = (store: Store, row: ItemRow) => store.db.select().from(t.calendars).where(eq(t.calendars.id, row.calendarId)).get()!;

function refuseReadOnly(row: ItemRow) {
  if (row.readOnly) throw new ProviderError('permanent', 'Google Calendar doesn\'t let this kind of event be changed here.');
}

/** Inserts with Setpoint's id; a retry that finds it already there takes Google's copy. */
async function insertOnce(api: GoogleCalendarApi, calendarId: string, id: string, body: Partial<GoogleEvent>): Promise<GoogleEvent> {
  try {
    return await api.insertEvent(calendarId, {id, ...body});
  } catch (error) {
    if (!isAlreadyThere(error)) throw error;
    return api.getEvent(calendarId, id);
  }
}

/**
 * events.move to `to`, once: it isn't idempotent, so a retry whose first try moved the event but
 * lost Google's answer finds it gone from `from` (404) and takes it from `to` instead (v1's
 * bfdd3d70, as is the "already exists" answer). If-Match carries the etag Setpoint last saw.
 */
async function moveOnce(api: GoogleCalendarApi, from: string, to: string, row: ItemRow): Promise<GoogleEvent> {
  try {
    return await api.moveEvent(from, row.providerId, to, row.etag);
  } catch (error) {
    if (!isNotFound(error) && !isAlreadyThere(error)) throw error;
    let there: GoogleEvent;
    try {
      there = await api.getEvent(to, row.providerId);
    } catch (lookup) {
      if (isNotFound(lookup)) throw error;
      throw lookup;
    }
    if (there.status === 'cancelled') throw error;
    return there;
  }
}

/** The Google instance of a series' occurrence (Google's ids are opaque: asked for, not built). */
async function instanceOf(api: GoogleCalendarApi, calendarId: string, master: ItemRow, originalStart: string): Promise<GoogleEvent> {
  const [instance] = await api.instances(calendarId, master.providerId, {originalStart});
  if (!instance) throw new ProviderError('permanent', 'Google Calendar has no such occurrence of this event. (404 Not Found)', {status: 404});
  return instance;
}

export async function executeEventCommand(store: Store, api: GoogleCalendarApi, command: CommandRow) {
  switch (command.kind) {
    case 'item_create':
      return create(store, api, command);
    case 'item_update':
      return update(store, api, command);
    case 'item_delete':
      return remove(store, api, command);
    case 'calendar_colour':
      return setColour(store, api, command);
    default:
      throw new ProviderError('permanent', `Google Calendar can't ${command.kind.replace('item_', '')} an event.`);
  }
}

/** SV-20: the calendar's colour on the user's calendar list; the next sync reads it back as the same swatch. */
async function setColour(store: Store, api: GoogleCalendarApi, command: CommandRow) {
  const calendar = store.db.select().from(t.calendars).where(eq(t.calendars.id, command.targetId)).get();
  if (!calendar) throw new ProviderError('permanent', 'This calendar is no longer in Google Calendar.');
  const hex = CALENDAR_HEX[command.payload.colour as Colour];
  try {
    await api.patchCalendarListEntry(calendar.providerId, {backgroundColor: hex, foregroundColor: foregroundFor(hex)});
  } catch (error) {
    // A consent without calendar-list write (v1's, carried over at cutover) refuses only this
    // optional write: it fails the colour in place, not the account (no needs reconnect).
    if (error instanceof ProviderError && error.kind === 'auth' && error.status === 403) {
      throw new ProviderError('permanent', `${error.message}, Reconnect this Google account in Settings › Accounts to allow colour changes`, {status: 403});
    }
    throw error;
  }
}

async function create(store: Store, api: GoogleCalendarApi, command: CommandRow) {
  const row = itemRow(store, command.targetId);
  if (!row) return;
  const calendar = calendarOf(store, row);
  const id = row.providerId.startsWith('local-') ? chosenEventId(command, row.id) : row.providerId;
  // The id goes on the row first, so a sync that sees the new event meanwhile finds this row.
  claimProviderId(store, row.id, id);
  const event = await insertOnce(api, calendar.providerId, id, {...eventBody(row, store.timeZone), ...(row.colour ? {colorId: colorIdOf(row.colour)} : {}), ...(row.recurrence ? {recurrence: [row.recurrence]} : {})});
  claimProviderId(store, row.id, event.id, event.etag ?? null);
}

interface UpdatePayload {
  item_id: number;
  changes: ItemChanges;
  scope: RecurringScope;
  occurrence_start: string | null;
  // F6b: the calendar an event moves from (the mirror already shows it in its new one).
  from_calendar_id?: number;
}

async function update(store: Store, api: GoogleCalendarApi, command: CommandRow) {
  const payload = command.payload as unknown as UpdatePayload;
  const target = itemRow(store, command.targetId);
  if (!target) return;
  refuseReadOnly(target);
  const calendar = calendarOf(store, target);
  const calendarId = calendar.providerId;
  const created = (command.previous as Previous | null)?.created ?? [];
  // The occurrence the change started from: named, or the exception it was made on.
  const occurrenceStart = payload.occurrence_start ?? itemRow(store, payload.item_id)?.originalStart ?? null;
  // The colour goes to Google only when it's what changed (see colorIdOf).
  const colour = payload.changes.colour !== undefined ? {colorId: colorIdOf(payload.changes.colour)} : {};

  // One occurrence on its own: the target is the exception the mirror made (or already had).
  if (target.recurringItemId !== null) {
    let id = target.providerId;
    let etag = target.etag;
    if (id.startsWith('local-')) {
      const master = itemRow(store, target.recurringItemId)!;
      const instance = await instanceOf(api, calendarId, master, target.originalStart!);
      [id, etag] = [instance.id, instance.etag ?? null];
      claimProviderId(store, target.id, id);
    }
    const event = await api.patchEvent(calendarId, id, {...eventBody(target, store.timeZone), ...colour}, etag);
    claimProviderId(store, target.id, event.id, event.etag ?? null);
    return;
  }

  // A single event, or a whole series ("All events", or "This and following" from its first).
  if (!target.recurrence || !occurrenceStart || created.length === 0) {
    let etag = target.etag;
    if (payload.from_calendar_id !== undefined && payload.from_calendar_id !== target.calendarId) {
      // To another calendar first (events.move), then the rest of the change there.
      const from = store.db.select().from(t.calendars).where(eq(t.calendars.id, payload.from_calendar_id)).get()!;
      const moved = await moveOnce(api, from.providerId, calendarId, target);
      claimProviderId(store, target.id, moved.id, moved.etag ?? null);
      etag = moved.etag ?? null;
      if (Object.keys(payload.changes).every(key => key === 'calendar_id')) return;
    }
    const body: Partial<GoogleEvent> = {...eventBody(target, store.timeZone), ...colour};
    if (target.recurrence) {
      // Keep the series' other lines (EXDATE, RDATE) and put the mirror's rule in place of its RRULE.
      const current = await api.getEvent(calendarId, target.providerId);
      body.recurrence = withRule(current.recurrence, target.recurrence);
    }
    const event = await api.patchEvent(calendarId, target.providerId, body, etag);
    claimProviderId(store, target.id, event.id, event.etag ?? null);
    return;
  }

  // This and following: the mirror ended the series before the occurrence and made a new one from
  // it. At Google: the trim (If-Match, so a series changed elsewhere is refused before anything
  // else), then the new series with Setpoint's id. A retry skips a trim already made and finds the
  // new series already there.
  const series = itemRow(store, created[0]!);
  if (!series) return;
  const current = await api.getEvent(calendarId, target.providerId);
  const rule = current.recurrence?.find(line => line.startsWith('RRULE:')) ?? target.recurrence;
  const trimmedRule = ruleEndingBefore(rule, occurrenceStart);
  if (rule !== trimmedRule) {
    const patched = await api.patchEvent(calendarId, target.providerId, {recurrence: withRule(current.recurrence, trimmedRule)}, target.etag ?? current.etag);
    claimProviderId(store, target.id, patched.id, patched.etag ?? null);
  }
  const newId = series.providerId.startsWith('local-') ? chosenEventId(command, series.id) : series.providerId;
  claimProviderId(store, series.id, newId);
  // The new series goes in its own calendar: another one when it moves there from this occurrence on.
  const inserted = await insertOnce(api, calendarOf(store, series).providerId, newId, {...eventBody(series, store.timeZone), ...(series.colour ? {colorId: colorIdOf(series.colour)} : {}), recurrence: [series.recurrence!]});
  claimProviderId(store, series.id, inserted.id, inserted.etag ?? null);
}

async function remove(store: Store, api: GoogleCalendarApi, command: CommandRow) {
  const payload = command.payload as unknown as ItemDeletion;
  const row = itemRow(store, payload.item_id);
  if (!row) return;
  refuseReadOnly(row);
  const calendarId = calendarOf(store, row).providerId;
  const gone = async (work: Promise<unknown>) => {
    try {
      await work;
    } catch (error) {
      // Already deleted at Google (404, or 410 "Resource has been deleted"): the delete is done.
      if (!isNotFound(error)) throw error;
    }
  };

  // An exception: this one alone is cancelled; with following or all, its series is.
  if (row.recurringItemId !== null) {
    if (payload.scope === 'this') return gone(api.patchEvent(calendarId, row.providerId, {status: 'cancelled'}, row.etag));
    const master = itemRow(store, row.recurringItemId);
    if (!master) return;
    return removeSeries(store, api, calendarId, master, payload.scope, row.originalStart);
  }
  if (!row.recurrence) return gone(api.deleteEvent(calendarId, row.providerId, row.etag));
  return removeSeries(store, api, calendarId, row, payload.scope, payload.occurrence_start);
}

async function removeSeries(store: Store, api: GoogleCalendarApi, calendarId: string, master: ItemRow, scope: RecurringScope, occurrenceStart: string | null) {
  const first = !occurrenceStart || isFirstOccurrence(master.startsAt ?? master.startDate!, occurrenceStart, master.timeZone ?? store.timeZone);
  if (scope === 'all' || (scope === 'following' && first)) {
    try {
      await api.deleteEvent(calendarId, master.providerId, master.etag);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    return;
  }
  if (scope === 'this') {
    const instance = await instanceOf(api, calendarId, master, occurrenceStart!);
    await api.patchEvent(calendarId, instance.id, {status: 'cancelled'}, instance.etag);
    return;
  }
  const current = await api.getEvent(calendarId, master.providerId);
  const rule = current.recurrence?.find(line => line.startsWith('RRULE:')) ?? master.recurrence!;
  const patched = await api.patchEvent(calendarId, master.providerId, {recurrence: withRule(current.recurrence, ruleEndingBefore(rule, occurrenceStart!))}, master.etag ?? current.etag);
  // Setpoint's own write moved the etag on: keep it, or the next change would look stale.
  claimProviderId(store, master.id, patched.id, patched.etag ?? null);
}

