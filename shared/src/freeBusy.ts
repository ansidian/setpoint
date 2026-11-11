// An event's free/busy (Google's transparency), read the same by the web app (the editor's conflict
// preview, the agenda's Overlaps line) and the server (a proposal card's conflict line).
import type {Transparency} from './enums.ts';

/**
 * A free event (Google's transparency `transparent`) is never a clash: it overlaps nothing, and
 * nothing overlaps it (SV-180, D440 and its extension). A task, or an item with no transparency, is busy.
 */
export const isFree = (item: {transparency?: Transparency | null}) => item.transparency === 'transparent';

// ---- A proposal's conflict line (DESIGN.md › Proposal, board 08) ----

export interface DayItem {
  title: string;
  kind: 'event' | 'task';
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  // SV-180: a free event (Google's `transparent`) is never a clash.
  transparency?: Transparency | null;
}

/** "1h 30m", "2h", "45m". */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours}h` : '', rest ? `${rest}m` : ''].filter(Boolean).join(' ') || '0m';
}

const more = (count: number) => (count > 0 ? ` and ${count} more` : '');

/**
 * Board 08's line for an event: "Free that evening" or "Overlaps Study group · 1h 30m" (the time the
 * two share). A timed event is checked against the day's timed events; an all-day one against any.
 * `startHour` is the proposal's local start hour, for morning, afternoon or evening. Free events
 * are left out (SV-180).
 */
export function proposalConflict(proposal: {all_day: boolean; starts_at: string | null; ends_at: string | null; startHour: number | null}, items: DayItem[]): {free: boolean; label: string} {
  const events = items.filter(item => item.kind === 'event' && !isFree(item));
  if (proposal.all_day || !proposal.starts_at || !proposal.ends_at) {
    if (!events.length) return {free: true, label: 'Free that day'};
    return {free: false, label: `Overlaps ${events[0]!.title}${more(events.length - 1)}`};
  }
  const start = Date.parse(proposal.starts_at);
  const end = Date.parse(proposal.ends_at);
  const overlaps = events
    .filter(item => !item.all_day && item.starts_at && item.ends_at)
    .map(item => ({item, minutes: Math.round((Math.min(end, Date.parse(item.ends_at!)) - Math.max(start, Date.parse(item.starts_at!))) / 60_000)}))
    .filter(overlap => overlap.minutes > 0)
    .sort((a, b) => Date.parse(a.item.starts_at!) - Date.parse(b.item.starts_at!));
  if (!overlaps.length) {
    const hour = proposal.startHour ?? 12;
    return {free: true, label: `Free that ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}`};
  }
  const [first] = overlaps;
  return {free: false, label: `Overlaps ${first!.item.title}${more(overlaps.length - 1)} · ${durationLabel(first!.minutes)}`};
}
