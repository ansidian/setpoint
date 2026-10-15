// The dev provider (SV-2 decision D4): an in-process stand-in for Gmail, iCloud, Google Calendar,
// Todoist and weather, serving only the seed's dev sources. The seed is its whole state, so a sync
// finds nothing new, and a command is confirmed locally after a short delay, so `npm run dev` shows
// pending, confirmed and (by rule) failed changes and their live events end to end.
//
// It never touches a real account: the registry gives it only sources marked `dev`, a dev source
// can't hold credentials (a database check), and it refuses anything else itself.
import type {PlaceOut, PlaceSuggestionOut} from '@setpoint/shared';
import type {SourceAdapter, AdapterContext, CommandRow} from '../../sync/adapter.ts';
import {devAttachment} from '../../dev/attachments.ts';
import {ProviderError} from '../../sync/errors.ts';
import {and, eq} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import {localDay} from '../../domain/time.ts';
import type {Store} from '../../store.ts';

export interface DevProviderOptions {
  // How long the "provider" takes to confirm, so pending shows.
  delayMs?: number;
  // A provider's refusal for a command, in its words, or null to confirm it.
  refuse?: (store: Store, command: CommandRow) => string | null;
  // While this says so, a change waits rather than being confirmed (SETPOINT_DEV_PROVIDER_HOLD).
  held?: () => boolean;
}

function assertDev(context: AdapterContext) {
  if (!context.source.dev || context.source.credentials !== null) throw new Error('The dev provider serves only the seed\'s dev sources.');
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, {once: true});
  });
}

export function devProvider({delayMs = 0, refuse, held}: DevProviderOptions = {}): SourceAdapter {
  return {
    async sync(context, cursor) {
      assertDev(context);
      return {cursor: cursor ?? 'dev'};
    },
    async sweep(context) {
      assertDev(context);
    },
    // The seed's attachments have a name and type but no bytes: a stand-in of the same type.
    async attachment(context, message, attachmentId) {
      assertDev(context);
      const row = context.store.db.select({filename: t.attachments.filename, mimeType: t.attachments.mimeType}).from(t.attachments)
        .innerJoin(t.messages, eq(t.messages.id, t.attachments.messageId))
        .where(and(eq(t.messages.providerId, message.providerId), eq(t.attachments.providerId, attachmentId))).get();
      return row ? devAttachment(row.filename, row.mimeType) : null;
    },
    async execute(context, command) {
      assertDev(context);
      await wait(delayMs, context.signal);
      while (held?.()) await wait(50, context.signal);
      const refusal = refuse?.(context.store, command);
      if (refusal) throw new ProviderError('permanent', refusal);
      // A new item gets the provider's id, as Google's or Todoist's would.
      if (command.kind === 'item_create') {
        context.store.db.update(t.items).set({providerId: `dev-item-${command.targetId}`}).where(eq(t.items.id, command.targetId)).run();
        // A project the user chose to make (SV-24) joins the list, as Todoist's would.
        const input = command.payload.input as {create_project?: boolean; project?: string | null} | undefined;
        if (input?.create_project && input.project && !context.store.db.select().from(t.todoistProjects).where(eq(t.todoistProjects.name, input.project)).get()) {
          context.store.db.insert(t.todoistProjects).values({providerId: `dev-project-${command.targetId}`, name: input.project, position: 1000, inbox: false}).onConflictDoNothing().run();
        }
      }
    },
  };
}

/**
 * Board 19b's failure, for building the failed state against `npm run dev`: moving Dinner with Sam
 * to Saturday, Oct 10 is refused with Google Calendar's 409.
 */
export function boardRefusals(store: Store, command: CommandRow): string | null {
  // SV-20's failed colour, for Settings › Calendar: Google refuses `sun` as a calendar's colour (one
  // Settings offers, which `alert` no longer is, #163).
  if (command.kind === 'calendar_colour') return command.payload.colour === 'sun' ? 'The caller does not have permission (403 Forbidden)' : null;
  // SV-25's failed colour, for Settings › Todoist: Todoist refuses taupe as a project's colour.
  if (command.kind === 'project_colour') return command.payload.colour === 'taupe' ? 'Insufficient permissions (403 Forbidden)' : null;
  // SV-74's refused task with no date, which says so in a toast: Todoist refuses "Renew passport".
  if (command.kind === 'item_create') return (command.payload.input as {title?: string} | undefined)?.title === 'Renew passport' ? 'Insufficient permissions (403 Forbidden)' : null;
  if (command.kind !== 'item_update') return null;
  const item = store.db.select().from(t.items).where(eq(t.items.id, command.targetId)).get();
  const changes = command.payload.changes as {starts_at?: string} | undefined;
  if (item?.title === 'Dinner with Sam' && changes?.starts_at && localDay(changes.starts_at, store.timeZone) === '2026-10-10') {
    return 'The requested event was modified by another client. (409 Conflict)';
  }
  return null;
}

/**
 * Places for the seed's dev runs (F6; D4's stand-in, as for the calendar): invented places matched
 * by name or address, so the editor's place suggestions (board 13) work without a Maps key and never
 * reach Google. Served only while the database holds the seed's dev sources and no key is set.
 */
export const DEV_PLACES: PlaceSuggestionOut[] = [
  {place_id: 'dev-blue-door', name: 'Blue Door', address: '2118 Sunset Blvd'},
  {place_id: 'dev-blue-door-bistro', name: 'Blue Door Bistro', address: '845 Example St, Los Angeles'},
  {place_id: 'dev-blue-door-coffee', name: 'Blue Door Coffee', address: '77 Elm Ave, Glendale'},
  {place_id: 'dev-smile-dental', name: 'Smile Dental', address: '1420 Elm St'},
  {place_id: 'dev-student-union', name: 'University Student Union', address: ''},
];

// Invented coordinates for the invented places (F7: Home in Settings › Calendar), around Los Angeles.
const DEV_LOCATIONS: Record<string, [number, number]> = {
  'dev-blue-door': [34.0901, -118.2768], 'dev-blue-door-bistro': [34.1478, -118.1445], 'dev-blue-door-coffee': [34.1425, -118.2551],
  'dev-smile-dental': [34.0736, -118.2400], 'dev-student-union': [34.0689, -118.4452],
};

// As Google's Place Details, which can name more of the address than a suggestion's second line.
const DEV_ADDRESSES: Record<string, string> = {'dev-blue-door-coffee': '77 Elm Ave, Glendale, CA 91203'};

/** One invented place with its coordinates, or null. */
export function devPlace(placeId: string): PlaceOut | null {
  const place = DEV_PLACES.find(one => one.place_id === placeId);
  const location = DEV_LOCATIONS[placeId];
  return place && location ? {...place, address: DEV_ADDRESSES[placeId] ?? place.address, lat: location[0], lng: location[1]} : null;
}

export function devPlaces(query: string): PlaceSuggestionOut[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return DEV_PLACES.filter(place => words.every(word => `${place.name} ${place.address}`.toLowerCase().includes(word))).slice(0, 5);
}
