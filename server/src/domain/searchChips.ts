// The chip grammar: words that name an organisation, a type, a date or range, an account or a kind
// become chips that filter exactly. `northwind rejection march` becomes Org Northwind · Type
// Rejection · Date Mar 2026. Words that form no chip stay free text, and so does anything in
// "quotes". A "!" before a word negates it (SV-31): `!confirmation` is a Not Type Confirmation chip,
// and a "!word" that forms no chip stays in the text, where search leaves out the mail that has it.
//
// Mail's field no longer runs all of it: a word typed there stays a word (D392). What's left is a
// "!word", any time; dates for a suggestion (src/search/reading.ts); and Alfred's searches, whole.
// Calendar search keeps its own words on `parseChips` below.
//
// Pure: the known organisations and accounts come in as a vocabulary, and dates resolve against the
// given clock in the owner's zone. Dates prefer the past (the user is looking for an email they got):
// "march" in October 2026 is March 2026, in February 2026 it's March 2025. Chrono reads the day
// phrases ("sep 30", "3/14", "march 14 2025", "monday", "mar 1 - mar 5"); the rest (bare months and
// years, "last week", "this month", "last 7 days", "since sep", "before 2025") is read here, because
// Chrono resolves those forward or not at all.
//
// The grammar is here rather than in `shared/` because it needs the vocabulary (the database's
// organisations and accounts) and keeps Chrono out of the web bundle: the web shows the chips each
// answer returns (`SearchOut.chips`).
import * as chrono from 'chrono-node';
import type {CalendarSearchChip, Kind, MessageType, SearchChip} from '@setpoint/shared';
import {addDays, localDay} from './time.ts';

export interface ChipVocabulary {
  // Organisations as emails carry them ("Northwind Talent", "Parkside Apartments").
  organisations: string[];
  accounts: {id: number; label: string}[];
}

export interface ChipContext extends ChipVocabulary {
  now: string;
  timeZone: string;
  // What plain words form: every chip (Alfred's), only dates, the rest staying text for search to
  // rank (a suggestion), or nothing (the field). A word after "!" is the whole grammar's in each,
  // since it says what it leaves out as exactly as it did (SV-31, SV-138).
  fromWords?: 'all' | 'dates' | 'none';
}

export interface ParsedQuery {
  chips: SearchChip[];
  // The words that formed no chip, as typed.
  text: string;
}

/** Case and accents folded, as the search index sees words. */
export const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const trimPunctuation = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
/** A string's words, folded. */
export const wordsOf = (value: string) => fold(value).match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * Words that never start an organisation chip on their own: filler, and the words a question to
 * Alfred is made of, so "where" in a question doesn't become Where Wild Things Grow. The
 * organisation still chips by more of its words ("where wild").
 */
const FILLER = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'from', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'about', 'my',
  'i', 'me', 'it', 'this', 'that', 'you', 'your', 'we', 'our', 'they', 'their',
  'who', 'what', 'when', 'where', 'which', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'am', 'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'have', 'has', 'had',
]);

export const TYPE_WORDS: Record<string, MessageType> = {
  confirmation: 'confirmation', confirmations: 'confirmation',
  rejection: 'rejection', rejections: 'rejection', rejected: 'rejection',
  receipt: 'receipt', receipts: 'receipt',
  shipping: 'shipping', shipment: 'shipping', shipments: 'shipping', shipped: 'shipping',
  deadline: 'deadline', deadlines: 'deadline',
  reminder: 'reminder', reminders: 'reminder',
  code: 'verification_code', codes: 'verification_code', otp: 'verification_code',
  'verification code': 'verification_code', 'verification codes': 'verification_code',
  alert: 'alert', alerts: 'alert',
  newsletter: 'newsletter', newsletters: 'newsletter',
  statement: 'statement', statements: 'statement',
};
/** The words that say an email is of a type, as a reading's type chip looks for them (D386). */
export const TYPE_CHIP_WORDS: Record<MessageType, string[]> = {
  confirmation: ['confirmation', 'confirmed'], rejection: ['rejection', 'rejected'], receipt: ['receipt'], shipping: ['shipping', 'shipped', 'shipment'], deadline: ['deadline'],
  reminder: ['reminder'], verification_code: ['verification', 'code'], alert: ['alert'], newsletter: ['newsletter'], statement: ['statement', 'bill'],
};
export const TYPE_LABELS: Record<MessageType, string> = {
  confirmation: 'Confirmation', rejection: 'Rejection', receipt: 'Receipt', shipping: 'Shipping', deadline: 'Deadline',
  reminder: 'Reminder', verification_code: 'Verification code', alert: 'Alert', newsletter: 'Newsletter', statement: 'Statement',
};

// "Other" stays a word: it's too common to mean the kind.
const KIND_WORDS: Record<string, Kind> = {
  deliveries: 'deliveries', delivery: 'deliveries', money: 'money', career: 'career', security: 'security', updates: 'updates', people: 'people',
};
export const KIND_LABELS: Record<Kind, string> = {
  deliveries: 'Deliveries', money: 'Money', career: 'Career', security: 'Security', updates: 'Updates', people: 'People', other: 'Other',
};

// ---- Dates ----

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Before every email: "before 2025" runs from here.
const EPOCH = '1970-01-01';

interface Range {
  from: string;
  to: string;
  label: string;
}

const pad = (value: number) => String(value).padStart(2, '0');
const isoDate = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const partsOf = (date: string) => date.split('-').map(Number) as [number, number, number];
const monthStart = (year: number, month: number) => isoDate(year, month, 1);
const nextMonth = (year: number, month: number) => (month === 12 ? monthStart(year + 1, 1) : monthStart(year, month + 1));
const validDay = (year: number, month: number, day: number) => {
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
};

function addMonths(date: string, months: number): string {
  const [year, month, day] = partsOf(date);
  const index = year * 12 + (month - 1) + months;
  const target = {year: Math.floor(index / 12), month: (index % 12) + 1};
  const last = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate();
  return isoDate(target.year, target.month, Math.min(day, last));
}

/** "Today", "Yesterday", "Mar 14", or "Mar 14, 2025" outside this year. */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, -1)) return 'Yesterday';
  const [year, month, day] = partsOf(date);
  return `${MONTH_SHORT[month - 1]} ${day}${year === partsOf(today)[0] ? '' : `, ${year}`}`;
}
const monthLabel = (year: number, month: number) => `${MONTH_SHORT[month - 1]} ${year}`;

/** A range's label: a whole month ("Mar 2026"), months ("Mar – May 2026"), a year, or days. */
function rangeLabel(from: string, to: string, today: string): string {
  const [fy, fm, fd] = partsOf(from);
  const [ty, tm, td] = partsOf(to);
  if (fd === 1 && td === 1) {
    if (fm === 1 && tm === 1 && ty === fy + 1) return String(fy);
    const lastMonth = tm === 1 ? {year: ty - 1, month: 12} : {year: ty, month: tm - 1};
    if (lastMonth.year === fy && lastMonth.month === fm) return monthLabel(fy, fm);
    return fy === lastMonth.year ? `${MONTH_SHORT[fm - 1]} – ${monthLabel(lastMonth.year, lastMonth.month)}` : `${monthLabel(fy, fm)} – ${monthLabel(lastMonth.year, lastMonth.month)}`;
  }
  const last = addDays(to, -1);
  if (last === from) return dayLabel(from, today);
  return `${dayLabel(from, today)} – ${dayLabel(last, today)}`;
}

const range = (from: string, to: string, today: string): Range => ({from, to, label: rangeLabel(from, to, today)});

/** The latest month with this number that has started by today. */
function pastMonth(month: number, today: string): {year: number; month: number} {
  const [year, current] = partsOf(today);
  return {year: month > current ? year - 1 : year, month};
}

/** The latest such day on or before today. */
function pastDay(month: number, day: number, today: string): string | null {
  const [year] = partsOf(today);
  for (const candidate of [year, year - 1, year - 2, year - 3, year - 4]) {
    if (validDay(candidate, month, day) && isoDate(candidate, month, day) <= today) return isoDate(candidate, month, day);
  }
  return null;
}

/** The Sunday a day's week starts on, as the calendar's weeks do (SV-29). */
const weekStart = (date: string) => addDays(date, -new Date(`${date}T00:00:00.000Z`).getUTCDay());

/** A reference Date whose local wall clock is today at noon, for Chrono (which reads wall clocks). */
function chronoReference(today: string): Date {
  const [year, month, day] = partsOf(today);
  return new Date(year, month - 1, day, 12, 0, 0);
}

type Granularity = 'day' | 'month';

/** A Chrono component (start or end) as a local day or month, preferring the past. */
function chronoPoint(component: chrono.ParsedComponents, today: string): {date: string; granularity: Granularity} | null {
  const month = component.get('month');
  const day = component.get('day');
  const year = component.get('year');
  if (component.isCertain('day') && month && day) {
    if (component.isCertain('year') && year) return validDay(year, month, day) ? {date: isoDate(year, month, day), granularity: 'day'} : null;
    const date = pastDay(month, day, today);
    return date ? {date, granularity: 'day'} : null;
  }
  if (component.isCertain('weekday') && !component.isCertain('month')) {
    const weekday = component.get('weekday');
    if (weekday === null) return null;
    const back = (new Date(`${today}T00:00:00.000Z`).getUTCDay() - weekday + 7) % 7;
    return {date: addDays(today, -back), granularity: 'day'};
  }
  if (component.isCertain('month') && month) {
    const at = component.isCertain('year') && year ? {year, month} : pastMonth(month, today);
    return {date: monthStart(at.year, at.month), granularity: 'month'};
  }
  return null;
}

const endOf = (point: {date: string; granularity: Granularity}) => {
  if (point.granularity === 'day') return addDays(point.date, 1);
  const [year, month] = partsOf(point.date);
  return nextMonth(year, month);
};

/** Day phrases through Chrono: the whole phrase must be one date or range, with no time of day. */
function chronoRange(raw: string, words: string[], today: string): Range | null {
  const phrase = raw.trim();
  // A bare "may" is the verb far more often than the month; weekdays only by their full names.
  if (words.length === 1 && (words[0] === 'may' || /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)$/.test(words[0]!))) return null;
  const results = chrono.parse(phrase, chronoReference(today));
  if (results.length !== 1) return null;
  const [result] = results;
  if (!result || result.index !== 0 || fold(result.text.trim()) !== fold(phrase)) return null;
  if (result.start.isCertain('hour')) return null;
  const start = chronoPoint(result.start, today);
  if (!start) return null;
  if (!result.end) return range(start.date, endOf(start), today);
  const end = chronoPoint(result.end, today);
  if (!end) return null;
  // "mar 1 - mar 5" in an implied year: keep the end after the start.
  let to = endOf(end);
  if (to <= start.date) to = addMonths(to, 12);
  return range(start.date, to, today);
}

/** A date or range from a phrase of words, or null. `raw` is the phrase as typed, for Chrono. */
function dateRange(words: string[], raw: string, today: string): Range | null {
  const [first, second, third] = words;
  const [year, month] = partsOf(today);
  if (words.length === 1 && first === 'today') return range(today, addDays(today, 1), today);
  if (words.length === 1 && first === 'yesterday') return range(addDays(today, -1), today, today);
  if (words.length === 2 && (first === 'this' || first === 'last')) {
    const back = first === 'last' ? 1 : 0;
    if (second === 'week') {
      const start = addDays(weekStart(today), -7 * back);
      return range(start, addDays(start, 7), today);
    }
    if (second === 'month') {
      const start = addMonths(monthStart(year, month), -back);
      const [y, m] = partsOf(start);
      return range(start, nextMonth(y, m), today);
    }
    if (second === 'year') return range(monthStart(year - back, 1), monthStart(year - back + 1, 1), today);
  }
  if (words.length === 3 && (first === 'last' || first === 'past') && /^\d{1,3}$/.test(second!) && Number(second) > 0) {
    const n = Number(second);
    const unit = third!.replace(/s$/, '');
    const end = addDays(today, 1);
    if (unit === 'day') return range(addDays(today, 1 - n), end, today);
    if (unit === 'week') return range(addDays(today, 1 - 7 * n), end, today);
    if (unit === 'month') return range(addDays(addMonths(today, -n), 1), end, today);
    return null;
  }
  const bare = bareMonth(words);
  if (bare) {
    const at = pastMonth(bare, today);
    return range(monthStart(at.year, at.month), nextMonth(at.year, at.month), today);
  }
  if (words.length === 2 && first! in MONTHS && /^\d{4}$/.test(second!)) {
    const at = {year: Number(second), month: MONTHS[first!]!};
    return range(monthStart(at.year, at.month), nextMonth(at.year, at.month), today);
  }
  if (words.length === 1 && /^\d{4}$/.test(first!) && Number(first) >= 2000 && Number(first) <= year) {
    return range(monthStart(Number(first), 1), monthStart(Number(first) + 1, 1), today);
  }
  return chronoRange(raw, words, today);
}

/** A month's name alone ("march"), as its number; "may" stays a word. */
export const bareMonth = (words: string[]): number | null => (words.length === 1 && words[0] !== 'may' ? MONTHS[words[0]!] ?? null : null);

/** "since sep", "after mar 14", "before 2025", "until march", or a plain date or range. */
export function dateChip(words: string[], raw: string, today: string): Range | null {
  const [first] = words;
  if (words.length >= 2 && (first === 'since' || first === 'from' || first === 'after' || first === 'before' || first === 'until')) {
    const rest = dateRange(words.slice(1), raw.trim().replace(/^\S+\s+/, ''), today);
    if (!rest) return null;
    const tomorrow = addDays(today, 1);
    if (first === 'since' || first === 'from') return rest.from < tomorrow ? {from: rest.from, to: tomorrow, label: `Since ${rest.label}`} : null;
    if (first === 'after') return rest.to < tomorrow ? {from: rest.to, to: tomorrow, label: `After ${rest.label}`} : null;
    if (first === 'before') return {from: EPOCH, to: rest.from, label: `Before ${rest.label}`};
    return {from: EPOCH, to: rest.to, label: `Until ${rest.label}`};
  }
  return dateRange(words, raw, today);
}

// ---- The other chips ----

function organisationChip(words: string[], organisations: string[]): string | null {
  if (words.every(word => FILLER.has(word))) return null;
  for (const organisation of organisations) {
    const own = wordsOf(organisation);
    if (own.length < words.length || !words.every((word, index) => own[index] === word)) continue;
    // The organisation's own leading words, as it writes them.
    const written = organisation.match(/[\p{L}\p{N}]+/gu) ?? [];
    return written.slice(0, words.length).join(' ');
  }
  return null;
}

function chipFor(words: string[], raw: string, context: ChipContext, today: string, negated: boolean): SearchChip | null {
  const fromWords = negated ? 'all' : context.fromWords ?? 'all';
  if (fromWords === 'none') return null;
  const phrase = words.join(' ');
  const date = dateChip(words, raw, today);
  if (date) return {kind: 'date', from: date.from, to: date.to, label: date.label};
  if (fromWords === 'dates') return null;
  const type = TYPE_WORDS[phrase];
  if (type) return {kind: 'type', value: type, label: TYPE_LABELS[type]};
  const kind = KIND_WORDS[phrase];
  if (kind) return {kind: 'kind', value: kind, label: KIND_LABELS[kind]};
  const account = context.accounts.find(candidate => wordsOf(candidate.label).join(' ') === phrase);
  if (account) return {kind: 'account', value: account.id, label: account.label};
  const organisation = organisationChip(words, context.organisations);
  if (organisation) return {kind: 'organisation', value: organisation, label: organisation};
  return null;
}

const MAX_WINDOW = 5;

/** Whether a chip leaves out what it matches (typed after "!"). */
export const isNot = (chip: SearchChip | CalendarSearchChip) => 'not' in chip && chip.not === true;

/** A chip as words the grammar reads back as the same chip: its label, after "!" for a Not chip. */
export const chipWords = (chip: SearchChip) => (isNot(chip) ? `!${chip.label}` : chip.label);

/** The same filter, whatever its label says. */
export function sameChip(a: SearchChip | CalendarSearchChip, b: SearchChip | CalendarSearchChip): boolean {
  if (isNot(a) !== isNot(b)) return false;
  if (a.kind === 'date' || b.kind === 'date') return a.kind === 'date' && b.kind === 'date' && a.from === b.from && a.to === b.to;
  return a.kind === b.kind && fold(String(a.value)) === fold(String(b.value));
}

interface Token {
  raw: string;
  quoted: boolean;
  // Folded, punctuation trimmed; empty for punctuation alone.
  word: string;
  // Typed after "!" ("!confirmation").
  negated: boolean;
}

/** A word typed after "!": "!confirmation", not "!" alone or "wow!". */
export const NEGATED = /^![\p{L}\p{N}]/u;

/** The tokens of `text` that `keep` keeps, spaced as one: words, "quotes" and "!words" whole. */
export const keptTokens = (text: string, keep: (token: {raw: string; quoted: boolean; negated: boolean; word: string}) => boolean) => tokens(text).filter(keep).map(token => token.raw).join(' ');

function tokens(text: string): Token[] {
  return [...text.matchAll(/"([^"]*)"?|[^\s"]+/g)].map(match => {
    const quoted = match[0].startsWith('"');
    return {raw: match[0], quoted, word: quoted ? '' : fold(trimPunctuation(match[0])), negated: !quoted && NEGATED.test(match[0])};
  });
}

/**
 * The chips a query's words form, longest phrase first at each word ("since mar 14" is one date,
 * not three words), and the words left over. Dates win over types, kinds, accounts and organisations.
 */
export function parseQuery(text: string, context: ChipContext): ParsedQuery {
  const today = localDay(context.now, context.timeZone);
  // Longer names first, so "Contoso Insurance" is preferred for "contoso insurance".
  const organisations = [...new Set(context.organisations.filter(Boolean))].sort((a, b) => wordsOf(b).length - wordsOf(a).length || a.localeCompare(b));
  const vocabulary = {...context, organisations};
  return parseChips(text, (words, raw, negated) => chipFor(words, raw, vocabulary, today, negated), chip => ({...chip, not: true}));
}

/**
 * The tokens' chips by a grammar, longest phrase first at each word, and the words left over. With
 * `negate`, a phrase starting with "!" gives its chips negated, and never takes in a later "!" word;
 * without it, "!" is punctuation.
 */
export function parseChips<C extends SearchChip | CalendarSearchChip>(text: string, chipFor: (words: string[], raw: string, negated: boolean) => C | C[] | null, negate?: (chip: C) => C): {chips: C[]; text: string} {
  const all = tokens(text);
  const chips: C[] = [];
  const left: string[] = [];
  let at = 0;
  while (at < all.length) {
    const token = all[at]!;
    if (token.quoted || !token.word) {
      left.push(token.raw);
      at += 1;
      continue;
    }
    let found: {length: number; chips: C[]} | null = null;
    for (let length = MAX_WINDOW; length >= 1 && !found; length -= 1) {
      const window = all.slice(at, at + length);
      // Punctuation alone may sit inside a phrase ("mar 1 - mar 5"), never at its ends.
      if (window.length < length || window.some(item => item.quoted) || !window.at(-1)!.word) continue;
      if (negate && window.slice(1).some(item => item.negated)) continue;
      const raw = window.map(item => item.raw).join(' ');
      const negated = negate !== undefined && token.negated;
      const chip = chipFor(window.flatMap(item => (item.word ? [item.word] : [])), negated ? raw.slice(1) : raw, negated);
      if (chip) found = {length, chips: ([chip].flat() as C[]).map(each => (negated ? negate(each) : each))};
    }
    if (found) {
      for (const each of found.chips) if (!chips.some(chip => sameChip(chip, each))) chips.push(each);
      at += found.length;
    } else {
      left.push(token.raw);
      at += 1;
    }
  }
  return {chips, text: left.join(' ')};
}
