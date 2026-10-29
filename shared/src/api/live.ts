// The typed live events: one Server-Sent Events stream at GET /api/events (BRIEF.md › Decided
// elsewhere). Each event names what changed, so the web refetches only that: the rows of those
// emails and the counts, the items in view, the sources' health, or News's stories. Commands ride
// on the event of what they change.
import type {LiveEventType, NewsSection} from '../enums.ts';
import type {JobsLiveEvent} from '../jobs/api.ts';

export type LiveEvent =
  | {type: 'mail'; messages: number[]; accounts: number[]; commands: number[]}
  | {type: 'items'; items: number[]; calendars: number[]; commands: number[]}
  | {type: 'health'; sources: number[]}
  // News (N1): `stories` changed in place (their dot, sources or summary: the page updates those rows
  // without reordering, D87); `sections` gained, lost or re-ranked stories (the page holds its order
  // behind the "3 new · 1 updated" pill); `sources` are News sources whose health changed (Settings ›
  // News only: News sources never ride on `health`, which is the accounts' and calendar's). N3: one
  // naming nothing means sorting's state changed (down, back, or the first run done): GET
  // /api/news/status again.
  | {type: 'news'; stories: number[]; sections: NewsSection[]; sources: number[]}
  // Jobs (after News, J1): a module that can be removed whole; its event is in shared/src/jobs/.
  | JobsLiveEvent;

// Compile-time check that the union covers LIVE_EVENT_TYPES exactly.
export type LiveEventCheck = [LiveEvent['type']] extends [LiveEventType] ? ([LiveEventType] extends [LiveEvent['type']] ? true : never) : never;

/**
 * The stream's own events, besides LiveEvent's types (each sent as the SSE `event` name with the
 * LiveEvent as JSON `data`, and an `id` to resume from with Last-Event-ID):
 * - `ready` starts each connection, with the id to resume from;
 * - `resync` means refetch everything (a reconnect after more than the server kept, a restart, or
 *   another process's write);
 * - `ping` every 25 s shows an open tab the stream still works (darma's pattern).
 */
export const STREAM_EVENTS = ['ready', 'resync', 'ping'] as const;
export interface ReadyOut {
  last_id: string;
}
