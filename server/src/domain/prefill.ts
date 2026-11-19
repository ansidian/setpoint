// The prefill's answer, checked before it touches a proposal (src/alfred/prefill.ts asks the model).
// Every value must be in its format or it's dropped, and a dropped value leaves the rules' value
// standing:
//
// - The title is trimmed, single-line and at most TITLE_MAX characters. An empty one is dropped.
// - A date is a real calendar day, YYYY-MM-DD. A time is a 24-hour HH:MM.
// - A date the model gives brings its own times: its start and end replace the rules' (null clears
//   them), so a time from another day never sits on the model's day. With no date, its times are
//   dropped. An end with no start is dropped.
// - A place that is a link must be a meeting link (MEETING_HOSTS). An application, signing or
//   tracking link isn't a place, so it's dropped. A null place leaves the rules' place.
import {placeLink} from '@setpoint/shared';
import type {ProposalFields} from './proposal.ts';

export const TITLE_MAX = 120;

/** Hosts whose links are where a meeting happens, and their subdomains ("acme.zoom.us"). */
export const MEETING_HOSTS = [
  'zoom.us', 'zoom.com', 'meet.google.com', 'teams.microsoft.com', 'teams.live.com', 'webex.com', 'whereby.com', 'meet.jit.si', 'gotomeeting.com', 'meet.goto.com',
  'chime.aws', 'bluejeans.com', 'around.co', 'gather.town', 'discord.gg', 'slack.com',
];

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A real calendar day as YYYY-MM-DD, or null. */
export function checkedDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = DATE.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? match[0] : null;
}

/** A 24-hour HH:MM, or null. */
export const checkedTime = (value: unknown): string | null => (typeof value === 'string' && TIME.test(value.trim()) ? value.trim() : null);

/** A short one-line title, or null. */
export function checkedTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const title = value.replace(/\s+/g, ' ').trim();
  return title && title.length <= TITLE_MAX ? title : null;
}

const meetingHost = (host: string) => MEETING_HOSTS.some(meeting => host === meeting || host.endsWith(`.${meeting}`));

/** A place, or null: a link in it must be a meeting link. */
export function checkedPlace(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const place = value.replace(/\s+/g, ' ').trim();
  if (!place || place.length > 300) return null;
  const link = placeLink({place, address: null});
  return link && !meetingHost(link.host.toLowerCase()) ? null : place;
}

/** What the model answered, as the tools ask for it: an event's fields or a task's. */
export interface PrefillAnswer {
  title?: unknown;
  date?: unknown;
  start?: unknown;
  end?: unknown;
  place?: unknown;
  due_date?: unknown;
  due_time?: unknown;
}

/** The model's answer as changes to the rules' proposal, every value checked. Empty when nothing is usable. */
export function prefillOverrides(kind: 'event' | 'task', answer: PrefillAnswer): Partial<ProposalFields> {
  const overrides: Partial<ProposalFields> = {};
  const title = checkedTitle(answer.title);
  if (title) overrides.title = title;
  const date = checkedDate(kind === 'task' ? answer.due_date : answer.date);
  if (date) {
    overrides.date = date;
    const start = checkedTime(kind === 'task' ? answer.due_time : answer.start);
    overrides.start = start;
    overrides.end = start && kind === 'event' ? checkedTime(answer.end) : null;
  }
  if (kind === 'event') {
    const place = checkedPlace(answer.place);
    if (place) overrides.place = place;
  }
  return overrides;
}
