// A calendar or an event colour Alfred names ("on Classes", "in Tomato"), matched by name: the
// user's writable Google calendars listed in Calendar, and Google Calendar's eleven event colours.
// Case doesn't matter and part of a name is enough, as long as one wins: an exact name beats a
// partial one ("Work" over "Work travel"). No match, or several, gives the list to ask from.
import type {EventColour} from '@setpoint/shared';
import {asc, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {calendarWritable} from '../domain/calendarAccess.ts';
import {eventColourOf} from '../domain/colours.ts';
import type {Store} from '../store.ts';

/** Google Calendar's event colours by name, by colorId. Several fall on one swatch (Flamingo and Tomato are both `alert`). */
export const GOOGLE_COLOUR_NAMES: Record<string, string> = {
  1: 'Lavender', 2: 'Sage', 3: 'Grape', 4: 'Flamingo', 5: 'Banana', 6: 'Tangerine', 7: 'Peacock', 8: 'Graphite', 9: 'Blueberry', 10: 'Basil', 11: 'Tomato',
};

export type Named<T> = {value: T} | {error: string};

/** The one candidate a name means: an exact name first, else the only one whose name holds it. */
function pick<T>(asked: string, candidates: {name: string; label: string; value: T}[], what: string): Named<T> {
  const wanted = asked.trim().toLowerCase();
  const list = candidates.map(one => one.label).join(', ');
  if (!wanted) return {error: `Name the ${what}: ${list}.`};
  const exact = candidates.filter(one => one.name.toLowerCase() === wanted);
  const partial = exact.length ? exact : candidates.filter(one => one.name.toLowerCase().includes(wanted));
  if (partial.length === 1) return {value: partial[0]!.value};
  if (!partial.length) return {error: `No ${what} is called "${asked.trim()}". Ask the user which they mean: ${list}.`};
  return {error: `"${asked.trim()}" could be ${partial.map(one => one.label).join(' or ')}. Ask the user which they mean.`};
}

/**
 * The writable, listed Google calendar a name means (on `accountId` alone when given, as an existing
 * event can only move within its account). A name on two accounts is told apart by the account's label.
 */
export function calendarNamed(store: Store, asked: string, accountId: number | null = null): Named<number> {
  const rows = store.db.select({id: t.calendars.id, name: t.calendars.name, accountId: t.calendars.accountId, accessRole: t.calendars.accessRole, listed: t.calendars.listed, label: t.accounts.label})
    .from(t.calendars).leftJoin(t.accounts, eq(t.accounts.id, t.calendars.accountId))
    .where(eq(t.calendars.provider, 'google')).orderBy(asc(t.calendars.position)).all()
    .filter(row => row.listed && calendarWritable(row.accessRole) && (accountId === null || row.accountId === accountId));
  if (!rows.length) return {error: 'There\'s no calendar it can go on.'};
  const twice = (name: string) => rows.filter(row => row.name.toLowerCase() === name.toLowerCase()).length > 1;
  return pick(asked, rows.map(row => ({name: row.name, label: twice(row.name) && row.label ? `${row.name} (${row.label})` : row.name, value: row.id})), 'calendar');
}

/** The swatch a Google event colour's name means. */
export function colourNamed(asked: string): Named<EventColour> {
  return pick(asked, Object.entries(GOOGLE_COLOUR_NAMES).map(([id, name]) => ({name, label: name, value: eventColourOf(id) as EventColour})), 'colour');
}
