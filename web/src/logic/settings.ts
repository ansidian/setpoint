// Settings' words and small rules (DESIGN.md › Settings; boards 17, 18a, 18b), tested as tables.
import type {HealthOut, HealthState, Kind, Lane, MessageType, PrecisionOut, RuleMatch, RuleOut, Settings, SettingsPatch, SourceOut} from '@setpoint/shared';

const WORST: HealthState[] = ['needs_reconnect', 'failing', 'stale', 'healthy'];

/**
 * Google Calendar as one row (board 17), though each Google account has its own source: the worst
 * state of them, last checked at the earliest check.
 */
export function mergeSources(sources: SourceOut[]): SourceOut | null {
  if (!sources.length) return null;
  const worst = [...sources].sort((a, b) => WORST.indexOf(a.health.state) - WORST.indexOf(b.health.state))[0]!;
  const earliest = (pick: (health: HealthOut) => string | null) => sources.map(source => pick(source.health)).filter((at): at is string => at !== null).sort()[0] ?? null;
  return {...worst, health: {...worst.health, last_check_at: earliest(health => health.last_check_at)}};
}

/** "Attention precision · 82%" and its line, or what's missing. */
export function precisionText(precision: Pick<PrecisionOut, 'precision' | 'done'> | undefined): {value: string; line: string} {
  if (!precision || precision.precision === null) return {value: '—', line: 'Nothing in Attention was marked Done in the last 30 days'};
  // The line says what the figure is, not its inverse (UX #22).
  const opened = Math.round(precision.precision * 100);
  return {value: `${opened}%`, line: `${opened}% of attention mail was opened before Done · last 30 days`};
}

/** The sparkline's bars: each day's share opened before Done, as a height up to 28 px (2 px on a day with none). */
export const sparkHeights = (days: PrecisionOut['days'], max = 28) =>
  days.map(day => (day.done ? Math.max(2, Math.round(max * day.opened_before_done / day.done)) : 2));

const TYPE_PLURALS: Record<MessageType, string> = {
  confirmation: 'confirmations', rejection: 'rejections', receipt: 'receipts', shipping: 'shipping updates', deadline: 'deadlines', reminder: 'reminders',
  verification_code: 'codes', alert: 'alerts', newsletter: 'newsletters', statement: 'statements',
};

const KIND_LABELS: Record<Kind, string> = {deliveries: 'Deliveries', money: 'Money', career: 'Career', security: 'Security', updates: 'Updates', people: 'People', other: 'Other'};

/** Where a rule sends mail: "Attention", "FYI · Money", "Noise". */
export function laneTag(lane: Lane, kind: Kind | null): string {
  if (lane === 'attention') return 'Attention';
  if (lane === 'noise') return 'Noise';
  return kind ? `FYI · ${KIND_LABELS[kind]}` : 'FYI';
}

/** A rule's words as runs, the matched values bold: "From **woodgrovebank.example** with “Registrar” in the subject". */
export function ruleWords(match: RuleMatch): {text: string; bold: boolean}[] {
  const runs: {text: string; bold: boolean}[] = [];
  const add = (text: string, bold = false) => runs.push({text, bold});
  const or = (values: string[]) => values.join(' or ');
  const senders = [...match.from_domains ?? [], ...match.from_addresses ?? []];
  if (senders.length) {
    add('From ');
    add(or(senders), true);
  }
  if (match.organisation) {
    add(runs.length ? ' · ' : '');
    add(match.type ? `${match.organisation} ${TYPE_PLURALS[match.type]}` : match.organisation, true);
  } else if (match.type) {
    add(runs.length ? ' · ' : '');
    add(TYPE_PLURALS[match.type].replace(/^./, letter => letter.toUpperCase()), true);
  }
  if (match.from_name_includes) add(`${runs.length ? ' named ' : 'Named '}${match.from_name_includes.map(text => `“${text}”`).join(' or ')}`);
  if (match.subject_includes) add(`${runs.length ? ' with ' : 'With '}${match.subject_includes.map(text => `“${text}”`).join(' or ')} in the subject`);
  if (match.subject_regex) add(`${runs.length ? ' with ' : 'With '}a subject like /${match.subject_regex}/`);
  if (match.body_includes) add(`${runs.length ? ' mentioning ' : 'Mentioning '}${match.body_includes.map(text => `“${text}”`).join(' or ')}`);
  if (match.body_regex) add(`${runs.length ? ' with ' : 'With '}a body like /${match.body_regex}/`);
  if (match.none_includes) add(`, not ${match.none_includes.map(text => `“${text}”`).join(' or ')}`);
  return runs.filter(run => run.text);
}

/** "2 this month", "None this month". */
export const matchesThisMonth = (count: number) => (count ? `${count} this month` : 'None this month');

/** Written rules in their order, then learned ones, newest first (as GET /api/mail/rules answers). */
export const splitRules = (rules: RuleOut[]) => ({
  written: rules.filter(rule => rule.origin === 'written').sort((a, b) => a.position - b.position),
  learned: rules.filter(rule => rule.origin === 'learned').sort((a, b) => b.created_at.localeCompare(a.created_at)),
});

/** A list moved one place up or down: the new order, or the same when it's already at that end. */
export function moved<T>(list: T[], index: number, delta: 1 | -1): T[] {
  const to = index + delta;
  if (index < 0 || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** A list with `id`'s item taken out and put back at `to` (its place among the others): a drag's live order. */
export function placed<T extends {id: number}>(list: T[], id: number, to: number): T[] {
  const item = list.find(one => one.id === id);
  if (!item) return list;
  const others = list.filter(one => one !== item);
  return [...others.slice(0, to), item, ...others.slice(to)];
}

/**
 * How far each row slides while the one at `from` is dragged to `to` (its place among the others),
 * by the rows' heights: the rows it passes make room, and it moves past them.
 */
export function shifts(heights: number[], from: number, to: number): number[] {
  const slides = heights.map(() => 0);
  const own = heights[from] ?? 0;
  for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
    if (index === from) continue;
    slides[index] = to > from ? -own : own;
    slides[from]! += to > from ? heights[index]! : -heights[index]!;
  }
  return slides;
}

/** Where a dragged row goes among the others: past each one whose middle is above the pointer. */
export const dropIndex = (middles: number[], y: number) => middles.filter(middle => middle < y).length;

/** "From woodgrovebank.example" in Add rule: a domain or an address. */
export function senderMatch(text: string): RuleMatch | null {
  const value = text.trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(value)) return {from_addresses: [value]};
  if (/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(value)) return {from_domains: [value]};
  return null;
}

/** Event reminder presets (Settings › Notifications), in minutes before. */
export const EVENT_REMINDERS = [0, 5, 10, 15, 30, 60, 120, 24 * 60];

export function minutesBefore(minutes: number): string {
  if (minutes === 0) return 'At the start';
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} day${minutes === 24 * 60 ? '' : 's'} before`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'} before`;
  return `${minutes} min before`;
}

/** "9:00 AM on the due day", from a 24-hour "09:00". */
export function taskTime(clock: string): string {
  const [hours, minutes] = clock.split(':').map(Number) as [number, number];
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'} on the due day`;
}

export const TASK_TIMES = ['07:00', '08:00', '09:00', '10:00', '12:00', '17:00', '20:00'];

/** Code expiry's presets (Settings › Mail): "5 min", "1 hour". */
export const expiryLabel = (minutes: number) => (minutes === 60 ? '1 hour' : `${minutes} min`);

/**
 * What a provider's return to Settings says (Connect Gmail's callback: ?connected=<id> or
 * ?error=<code>; Todoist's: ?connected=1 or 0), for a toast; null for a plain link.
 */
export function connectNote(page: string, search: string): string | null {
  const query = new URLSearchParams(search);
  const connected = query.get('connected');
  const error = query.get('error');
  if (page === 'todoist' && connected !== null) return connected === '1' ? 'Todoist is connected' : 'Todoist couldn’t be connected, try again';
  if (error) return error === 'google_not_configured' ? 'Google sign-in isn’t set up on this Setpoint' : `Gmail couldn’t be connected, ${error.replace(/_/g, ' ')}`;
  if (connected !== null) return 'Gmail is connected';
  return null;
}

/** The settings with a change applied, as they show at once before the server answers: each section's fields over its own. */
export function withPatch(settings: Settings, patch: SettingsPatch): Settings {
  const next = {...settings} as Record<string, object>;
  for (const [section, fields] of Object.entries(patch)) if (fields) next[section] = {...next[section], ...fields};
  return next as Settings;
}

const tokens = (count: number) => (count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

/** Settings › AI's usage, naming what's counted: "1,204 calls · 2.4M tokens in · 48k out" (#73). */
export function usageLine(usage: {calls: number; input_tokens: number; output_tokens: number}): string {
  return `${usage.calls.toLocaleString('en-US')} ${usage.calls === 1 ? 'call' : 'calls'} · ${tokens(usage.input_tokens)} tokens in · ${tokens(usage.output_tokens)} out`;
}
