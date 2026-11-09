// Settings' words and small rules (DESIGN.md › Settings; boards 17, 18a, 18b), tested as tables.
import type {HealthOut, HealthState, Kind, Lane, MessageType, RuleMatch, RuleOut, RuleTrash, Settings, SettingsPatch, SourceOut} from '@setpoint/shared';
import type {IconName} from '../ui/glyphs.ts';
import type {SettingsPage} from './route.ts';

/** Settings' pages as its nav names them, each with its glyph; ⌘K's "Settings › Mail" carries the same (#123). */
export const SETTINGS_NAV: Record<SettingsPage, {label: string; icon: IconName}> = {
  accounts: {label: 'Accounts', icon: 'alternate_email'},
  calendar: {label: 'Calendar', icon: 'calendar_month'},
  todoist: {label: 'Todoist', icon: 'task_alt'},
  notifications: {label: 'Notifications', icon: 'notifications'},
  mail: {label: 'Mail', icon: 'mail'},
  news: {label: 'News', icon: 'newspaper'},
  jobs: {label: 'Jobs', icon: 'work'},
  ai: {label: 'AI', icon: 'auto_awesome'},
  appearance: {label: 'Appearance', icon: 'contrast'},
  security: {label: 'Security', icon: 'lock'},
};

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
  const quoted = (values: string[]) => values.map(text => `“${text}”`).join(' or ');
  // A field's "doesn't contain" follows its own words as "without “return”", or stands alone with
  // the field named when the rule has no words for that field (D487).
  const without = (values: string[] | undefined, follows: boolean, alone: string) => {
    if (values) add(follows ? `, without ${quoted(values)}` : `${runs.length ? ', ' : ''}${alone.replace('%', quoted(values))}`);
  };
  if (match.from_name_includes) add(`${runs.length ? ' named ' : 'Named '}${quoted(match.from_name_includes)}`);
  without(match.from_name_excludes, Boolean(match.from_name_includes), runs.length ? 'not named %' : 'Not named %');
  if (match.subject_includes) add(`${runs.length ? ' with ' : 'With '}${quoted(match.subject_includes)} in the subject`);
  if (match.subject_regex) add(`${runs.length ? ' with ' : 'With '}a subject like /${match.subject_regex}/`);
  without(match.subject_excludes, Boolean(match.subject_includes || match.subject_regex), runs.length ? 'without % in the subject' : 'Without % in the subject');
  if (match.body_includes) add(`${runs.length ? ' mentioning ' : 'Mentioning '}${quoted(match.body_includes)}`);
  if (match.body_regex) add(`${runs.length ? ' with ' : 'With '}a body like /${match.body_regex}/`);
  without(match.body_excludes, Boolean(match.body_includes || match.body_regex), runs.length ? 'not mentioning %' : 'Not mentioning %');
  if (match.none_includes) add(`, not ${quoted(match.none_includes)}`);
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
/** Add rule's filters: a field's words it contains, or doesn't ("Not"). */
export type RuleFilter = 'subject' | 'subjectNot' | 'name' | 'nameNot' | 'body' | 'bodyNot';
export type RuleWordsInput = Partial<Record<RuleFilter, string | undefined>>;

/** What Add rule's filters add to the sender's match: each one's phrase, blank ones left out. */
export function wordsMatch(input: RuleWordsInput): RuleMatch {
  const match: RuleMatch = {};
  const keys = {subject: 'subject_includes', subjectNot: 'subject_excludes', name: 'from_name_includes', nameNot: 'from_name_excludes', body: 'body_includes', bodyNot: 'body_excludes'} as const;
  for (const [field, key] of Object.entries(keys) as [keyof RuleWordsInput, (typeof keys)[keyof RuleWordsInput]][]) {
    const text = input[field]?.trim();
    if (text) match[key] = [text];
  }
  return match;
}

export function senderMatch(text: string): RuleMatch | null {
  const value = text.trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(value)) return {from_addresses: [value]};
  if (/^([a-z0-9-]+\.)+[a-z]{2,63}$/.test(value)) return {from_domains: [value]};
  return null;
}

// Mail hosts many people send from: a rule from one of them names the address, not everyone on it.
const SHARED_HOSTS = new Set(['gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com']);

export interface RuleSender {
  // What Add to rule names it by: "northwind.example", or "sam@gmail.com".
  text: string;
  match: Pick<RuleMatch, 'from_domains' | 'from_addresses'>;
}

/** Add to rule's sender (SV-160): the address's domain, or the address itself on a shared host. */
export function ruleSender(address: string): RuleSender | null {
  const value = address.trim().toLowerCase();
  const domain = value.split('@')[1] ?? '';
  const text = SHARED_HOSTS.has(domain) ? value : domain;
  const match = senderMatch(text);
  return match && {text, match};
}

const covers = (match: RuleMatch, sender: RuleSender) => {
  const [address] = sender.match.from_addresses ?? [];
  const domain = sender.match.from_domains?.[0] ?? address?.split('@')[1];
  return (address !== undefined && (match.from_addresses ?? []).includes(address))
    || (match.from_domains ?? []).some(one => domain === one || domain?.endsWith(`.${one}`));
};

/** The rules Add to rule offers: written ones that are on and match on sender, in their order, leaving out those that already take this sender. */
export const rulesToAddTo = (rules: RuleOut[] | undefined, sender: RuleSender): RuleOut[] => splitRules(rules ?? []).written
  .filter(rule => rule.enabled && (rule.match.from_domains || rule.match.from_addresses) && !covers(rule.match, sender));

/** The rule's match with the sender among its senders (which are alternatives), the rest kept. */
export function withSender(match: RuleMatch, sender: RuleSender): RuleMatch {
  const next = {...match};
  if (sender.match.from_domains) next.from_domains = [...match.from_domains ?? [], ...sender.match.from_domains];
  if (sender.match.from_addresses) next.from_addresses = [...match.from_addresses ?? [], ...sender.match.from_addresses];
  return next;
}

/** A rule on one line, as Settings › Mail words it: "From woodgrovebank.example → FYI · Money". */
export const ruleLine = (rule: Pick<RuleOut, 'match' | 'lane' | 'kind'> & Partial<Pick<RuleOut, 'mark_read' | 'trash'>>) =>
  `${ruleWords(rule.match).map(run => run.text).join('')} → ${laneTag(rule.lane, rule.kind)}${ruleActionWords(rule)}`;

/** The rule form's Trash segments (DESIGN.md #347): "Never", "Now", "15 min", "1 hour", "1 day", "1 week". */
export const TRASH_LABELS: Record<RuleTrash, string> = {never: 'Never', now: 'Now', '15m': '15 min', '1h': '1 hour', '1d': '1 day', '1w': '1 week'};

/** What a written rule does after its lane tag: ", mark read, trash now", ", trash after 1 day", or nothing. */
export function ruleActionWords({mark_read = false, trash = 'never'}: Partial<Pick<RuleOut, 'mark_read' | 'trash'>>): string {
  const words = [
    ...(mark_read ? ['mark read'] : []),
    ...(trash === 'now' ? ['trash now'] : trash !== 'never' ? [`trash after ${TRASH_LABELS[trash]}`] : []),
  ];
  return words.map(word => `, ${word}`).join('');
}

/** Add rule's Send to for an email in `lane` and `kind`: where it is now ("fyi:money"), FYI · Other before triage. */
export function ruleDestination(lane: Lane | null, kind: Kind | null): string {
  if (lane === 'attention' || lane === 'noise') return lane;
  return `fyi:${kind ?? 'other'}`;
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

/** Whether connectNote's line says the connection failed, so the toast leads with the failure's glyph. */
export function connectFailed(page: string, search: string): boolean {
  const query = new URLSearchParams(search);
  return page === 'todoist' && query.get('connected') !== null ? query.get('connected') !== '1' : query.has('error');
}

/** The settings with a change applied, as they show at once before the server answers: each section's fields over its own. */
export function withPatch(settings: Settings, patch: SettingsPatch): Settings {
  const next = {...settings} as Record<string, object>;
  for (const [section, fields] of Object.entries(patch)) if (fields) next[section] = {...next[section], ...fields};
  return next as Settings;
}

const tokens = (count: number) => (count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

/** The month's AI spend, Triage, Alfred and News together, for Usage this month's label. */
export const monthTotal = (usage: Record<'triage' | 'search_terms' | 'search_reading' | 'alfred' | 'news', {cost_usd: number}>) => usage.triage.cost_usd + usage.search_terms.cost_usd + usage.search_reading.cost_usd + usage.alfred.cost_usd + usage.news.cost_usd;

/** Settings › AI's usage, naming what's counted: "1,204 calls · 2.4M tokens in · 48k out" (#73). */
export function usageLine(usage: {calls: number; input_tokens: number; output_tokens: number}): string {
  return `${usage.calls.toLocaleString('en-US')} ${usage.calls === 1 ? 'call' : 'calls'} · ${tokens(usage.input_tokens)} tokens in · ${tokens(usage.output_tokens)} out`;
}
