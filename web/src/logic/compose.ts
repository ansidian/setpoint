// The editor's title as it's typed (DESIGN.md › Editor; board 13): "Dinner with Sam fri 7-9pm
// @Blue Door" is the title "Dinner with Sam", Fri, Oct 9 from 7 to 9 PM, at Blue Door, each parsed
// part marked where it was typed. Rewritten from v1's `parseCalendarTitle` and its
// `calendarTitleIntent` / `calendarRecurrenceClauseModel` through the harvest gate (darma SV-15):
// v1 handed the dates to Chrono in a fixed Pacific zone; v2 reads the few phrases the editor needs
// itself, as local days and minutes, so every mark has its exact place in the text.
//
// What it reads, anywhere in the title:
// - a day: today, tonight, tomorrow (tmr, tmrw); a weekday (the next one, today counting; "next
//   fri" the one after); "oct 12", "12 oct", "10/12", "10/12/26", "2026-10-12" (a month and day
//   already past this year is next year's); "on" before any of them. Days counted from today (SV-113,
//   D294): "in 3 days", "in 2 weeks", "in 1 month" (that month's last day when it's shorter); "next
//   week", its Monday; "this weekend" or "weekend", the coming Saturday (today on one), "next weekend"
//   the one after, an event's all day Saturday–Sunday with no time; "end of week", the coming Friday;
//   "end of month", "eom", "end of next month", the month's last day.
// - a time: "7pm", "7:30 pm", "19:00", "noon", "midnight", "at" before any of them; a range "7-9pm",
//   "7pm - 9pm", "11-1pm", "from 9 to 5pm" (a bare hour is a time only with am/pm or minutes, so
//   "Gym 7" stays a title); minutes with no colon with am/pm, "345am", "745p", "1230 pm", or in a
//   range with am/pm at either end, "930-1030am" (SV-116; "Room 1245" and "pages 101-105" stay
//   words); a lone a or p only against the digits, so "2 a day" stays words; No end, the end at the start, for the same time twice ("2pm to 2pm") or
//   "no end" by a time ("2pm no end", "no end 2pm"; SV-108).
// - an event's length after "for" (SV-111, D291, D292): "for 15 min", "for 1.5h", "for 1 hour 20mins",
//   "for 1h30"; digits only, in min(s)/minute(s), h/hr(s)/hour(s), d/day(s) and week(s). It ends the
//   event that long after its start; with no time typed, `length` alone says it, for the reader's
//   default start, but a length in whole days or weeks is all day over them ("Trip fri for 3 days" is
//   Fri–Sun, D298). The first of a length or an end wins ("2-3pm for 2h" keeps "for 2h" as words).
// - an event's span of days (SV-111, D292), as the Date field takes them: "oct 23–25", "oct 23 to 25",
//   "oct 30 – nov 2", "fri to sun", "fri through sun", "from fri to sun", the last day read from the
//   first ("fri to mon" runs into next week); a backwards one stays words. With no time it's all day
//   over its `days`; with a time at each end ("fri 7pm to sun 3pm") one event across them; with one
//   time or range ("oct 23–25 9am–5pm") that time each day, repeating daily until the last day.
//   A task's line keeps lengths and spans as words.
// - reminders (SV-112, D293), after "remind", "remind me" or "reminder" and no other words: an offset
//   ("1h before", "30 mins before", "2 hours after", "at start"; D291's units) or a moment ("sun 8pm",
//   "tomorrow 9am", "at 6pm" on the item's own day), several joined by "and" or commas ("remind 1 day
//   and 10 mins before"). Read before the days and times, so "sun 8pm" there isn't the item's day.
//   Given what the item counts from (`remind`), each phrase is checked against it: past 4 weeks
//   either side, or past 10 with what the item keeps, it stays words; with none given (a task with
//   no date) every such phrase does. "remind" and a day with no time stays words too.
// - repeats: daily, weekly, monthly, yearly, annually, biweekly; every day / week / month / year;
//   every 2 weeks; every other mon; every mon, wed and fri; every weekday / weekend; first mon of
//   every month. After one, when it ends (SV-113, D294): "until <day>", any day above, as UNTIL; "6
//   times" or "for 6 times" as COUNT (an event's only: Todoist documents no count); "for 2 weeks"
//   (days, weeks, months) as UNTIL the day before the first occurrence plus that, the first then the
//   item's day. Without a repeat before them they stay words, and "for 2 days" is a length.
// - "@Blue Door": a place, up to the next time, day, repeat or calendar (two letters at least), or
//   just its picked text once a Places suggestion was picked for it, a link up to the next space,
//   or up to a comma, which goes with it (darma SV-27).
// - "#Home": a task's project, when the projects are given: the longest project name it starts with
//   (any case), else up to the next phrase as a place does; a pick or a comma ends it too (SV-25).
// - "#school": an event's calendar, when the calendars are given: the longest text a calendar's name
//   starts with (any case), the first such calendar; "#1 priority" names none and stays (SV-25 D57).
// - "cal Classes": a calendar, by one of the calendars' names.
//
// Editing an item's title reads only what the edit typed (SV-90): the words the title already had
// stay title words.
import {addDays, daysBetween} from './format.ts';

export type MarkKind = 'when' | 'place' | 'calendar' | 'project' | 'reminder';

/**
 * A reminder the line read (SV-112): minutes before the item's moment (negative after it), or a
 * moment, a local day and minutes after its midnight, which becomes an offset once the item's moment
 * is known in its time zone (`lineOffsets` in reminders.ts).
 */
export type ReminderRead = {minutes: number} | {date: string; time: number};

/**
 * What the line's reminders count from when it reads no day or time of its own (SV-112): the item's
 * day, and the minutes after midnight its moment falls at (an event's start, the slot's else 9:00 AM;
 * an all-day event's 0; a task's due time, else Settings' task time or 9:00 AM). `kept` is how many
 * reminders the item keeps beside the line's (picked in the editor, or an edited item's own).
 */
export interface ReminderBase {
  day: string;
  time: number;
  kept?: number;
}

/** The API's limits on an item's reminders: 4 weeks either side, and 10 (shared's REMINDER_LIMIT_MINUTES). */
export const REMINDER_LINE_LIMITS = {minutes: 4 * 7 * 1440, count: 10};

/** A parsed part of the text, `end` exclusive (UTF-16 offsets). */
export interface Mark {
  start: number;
  end: number;
  kind: MarkKind;
}

export interface ParsedTitle {
  title: string;
  marks: Mark[];
  date: string | null;
  // Minutes after midnight; an end past midnight is over 1440.
  start: number | null;
  end: number | null;
  place: string | null;
  // The calendar's name as the calendars list has it.
  calendar: string | null;
  // An RFC 5545 rule, "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR".
  recurrence: string | null;
  // A known project by its own name ("#home" is "Home"), else as typed.
  project: string | null;
  // An all-day event's days, its first and last counting: a span's ("oct 23–25" is 3; SV-111), a
  // weekend's 2, or a length's in whole days with no time ("for 3 days"; SV-113, D298); else null.
  days: number | null;
  // Minutes a "for" length read ("for 1.5h" is 90), the end already counting it when a start was
  // read; with none, the event starts at the default start and lasts this long (SV-111). Null when
  // a length in whole days made `days` instead (D298).
  length: number | null;
  // The reminders the line read, in order, the same one once; null for none (SV-112).
  reminders: ReminderRead[] | null;
}

const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const WEEKDAY_WORDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday|s)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// A phrase ends at a space, punctuation or the end.
const END = '(?=$|[\\s,.;!?])';
// am/pm, or a lone a or p only against the digits: "2 a day" isn't 2 AM (SV-116).
const MERIDIEM = '(?:\\s*(?:am|pm)|[ap])(?![a-z])';
// An hour, its minutes after a colon or with none ("345am"), and its am/pm. `compact` is what has to
// follow minutes with no colon.
const clockPattern = (compact: string) =>
  `(\\d{1,2})(?:(?::|(?=\\d{2}${compact}))(\\d{2}))?(?:\\s+(?=(?:am|pm)(?![a-z])))?(am|pm|a|p)?`;
// A time on its own: minutes with no colon only with its own am/pm ("345a", "1230 pm"; SV-116).
const TIME = clockPattern(MERIDIEM);
// A range's end: one with no colon may take its am/pm from the other ("930-1030am"); range() refuses one on neither.
const RANGE_TIME = clockPattern('(?!\\d)');
// Days counted from today (SV-113, D294): "in 3 days", "next week", "this weekend", "end of month".
const RELATIVE = 'in\\s+\\d{1,3}\\s*(?:days?|d|weeks?|months?)(?![a-z])|(?:(?:this|next)\\s+)?weekend(?![a-z])|next\\s+week(?![a-z])'
  + '|end\\s+of\\s+(?:the\\s+)?(?:week|month|next\\s+month)(?![a-z])|eom(?![a-z])';
const ORDINALS: Record<string, number> = {first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, last: -1};

/** Monday 0 … Sunday 6 for a weekday word. */
const weekdayIndex = (word: string) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(word.slice(0, 3).toLowerCase());
const weekdayOf = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;

/** A real day ("2026-02-30" isn't), or null. */
function day(year: number, month: number, date: number): string | null {
  const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
  const back = new Date(`${text}T12:00:00Z`);
  return back.getUTCMonth() + 1 === month && back.getUTCDate() === date ? text : null;
}

/** A month and day with no year: this year's, or next year's once it's past. */
function upcoming(month: number, date: number, today: string, year?: string): string | null {
  if (year) return day(Number(year.length === 2 ? `20${year}` : year), month, date);
  const thisYear = Number(today.slice(0, 4));
  const found = day(thisYear, month, date);
  return found && found < today ? day(thisYear + 1, month, date) : found;
}

/** Hours, minutes and am/pm as minutes after midnight; null for an impossible time. */
function clock(hour: number, minute: number, meridiem: 'a' | 'p' | null): number | null {
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    return ((hour % 12) + (meridiem === 'p' ? 12 : 0)) * 60 + minute;
  }
  return hour > 23 ? null : hour * 60 + minute;
}

const meridiemOf = (text: string | undefined) => (text ? (text[0]!.toLowerCase() as 'a' | 'p') : null);

/**
 * A range's two ends. An end missing its am/pm takes the first reading after the start ("9am-5" is
 * 5 PM); a start missing its own takes the last reading before the end ("7-9pm" is 7 PM, "11-1pm"
 * 11 AM). With am/pm on neither, both need minutes or a 24-hour hour ("9:00-10:30", "13-15"). The
 * same time twice ("2-2pm", "14:00–14:00") is No end, the end at the start (SV-78, SV-108).
 */
function range(match: RegExpExecArray): {start: number; end: number} | null {
  const [, h1, m1, a1, h2, m2, a2] = match;
  const [startHour, startMinute, endHour, endMinute] = [Number(h1), Number(m1 ?? 0), Number(h2), Number(m2 ?? 0)];
  const startMer = meridiemOf(a1);
  const endMer = meridiemOf(a2);
  if (!startMer && !endMer && (/\d{3}/.test(match[0]) || !(m1 || m2 || startHour > 12 || endHour > 12))) return null;
  const readings = (hour: number, minute: number) => [clock(hour, minute, 'a'), clock(hour, minute, 'p')].filter((value): value is number => value !== null);
  let start = startMer ? clock(startHour, startMinute, startMer) : null;
  let end = endMer ? clock(endHour, endMinute, endMer) : null;
  if (!startMer && !endMer) {
    start = clock(startHour, startMinute, null);
    end = clock(endHour, endMinute, null);
  } else if (!startMer && end !== null) {
    start = readings(startHour, startMinute).filter(value => value <= end!).at(-1) ?? clock(startHour, startMinute, endMer);
  } else if (!endMer && start !== null) {
    end = readings(endHour, endMinute).find(value => value >= start!) ?? clock(endHour, endMinute, startMer);
  }
  if (start === null || end === null) return null;
  // "11pm-1am" ends the next day.
  return {start, end: end < start ? end + 1440 : end};
}

/** "every mon, wed and fri" → MO,WE,FR in the week's order. */
const byDays = (text: string) => [...new Set([...text.matchAll(new RegExp(WEEKDAY, 'gi'))].map(found => weekdayIndex(found[0])))]
  .sort((a, b) => a - b).map(index => RRULE_DAYS[index]).join(',');

interface State {
  date: string | null;
  start: number | null;
  end: number | null;
  place: string | null;
  calendar: string | null;
  recurrence: string | null;
  project: string | null;
  // A weekly rule with no day yet takes the date's weekday.
  weeklyNeedsDay: boolean;
  // The weekdays a repeat names (Monday 0), for its first day when no date is given.
  repeatDays: number[];
  // An event's line reads lengths and spans; a task's doesn't (SV-111).
  event: boolean;
  length: number | null;
  // A span's last day, when it's all day or repeats each day; a span across days with a time at
  // each end is just its date, start and end.
  last: string | null;
  // What reminder phrases count from; null, and they stay words (SV-112).
  remind: ReminderBase | null;
  // Each reminder phrase read, where it starts; a moment's null day is the item's own.
  reminders: {start: number; reads: ({minutes: number} | {date: string | null; time: number})[]}[];
  // A weekend read as the day: an event's is all day Saturday–Sunday with no time (SV-113).
  weekend: boolean;
  // A length's units were only days and weeks, so with no time it's all day over them (D298).
  wholeDays: boolean;
  // When the repeat ends (SV-113), where its phrase starts: a last day, a count, or a length from
  // the first occurrence.
  ending: {start: number; until?: string; count?: number; length?: {value: number; unit: 'd' | 'w' | 'm'}} | null;
}

const fresh = (event: boolean, remind: ReminderBase | null = null): State => ({date: null, start: null, end: null, place: null, calendar: null, recurrence: null, project: null,
  weeklyNeedsDay: false, repeatDays: [], event, length: null, last: null, remind, reminders: [], weekend: false, wholeDays: false, ending: null});

interface Matcher {
  kind: MarkKind;
  pattern: RegExp;
  // False when the match isn't one after all; `state` is changed only when it is. 'words' when it's
  // a phrase that stays words whole (a backwards span, a task's span), read no further.
  apply: (match: RegExpExecArray, state: State, today: string) => boolean | 'words';
}

const sticky = (source: string) => new RegExp(source, 'iy');

/** A day as RRULE writes a date-only UNTIL ("2026-10-25" is 20261025). */
const compact = (date: string) => date.replace(/-/g, '');

function rule(state: State, body: string, weeklyNeedsDay = false): boolean {
  if (state.recurrence) return false;
  state.recurrence = `RRULE:${body}`;
  state.weeklyNeedsDay = weeklyNeedsDay;
  state.repeatDays = (/BYDAY=([A-Z,]+)/.exec(body)?.[1] ?? '').split(',').filter(Boolean).map(code => RRULE_DAYS.indexOf(code as (typeof RRULE_DAYS)[number]));
  return true;
}

const setDate = (state: State, date: string | null) => {
  if (!date || state.date) return false;
  state.date = date;
  return true;
};

const REPEATS: Matcher[] = [
  {kind: 'when', pattern: sticky(`every\\s+other\\s+(${WEEKDAY})${END}`),
    apply: (m, s) => rule(s, `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byDays(m[1]!)}`)},
  {kind: 'when', pattern: sticky(`(first|1st|second|2nd|third|3rd|fourth|4th|last)\\s+(${WEEKDAY})\\s+(?:of\\s+)?every\\s+month${END}`),
    apply: (m, s) => rule(s, `FREQ=MONTHLY;BYDAY=${ORDINALS[m[1]!.toLowerCase()]}${RRULE_DAYS[weekdayIndex(m[2]!)]}`)},
  {kind: 'when', pattern: sticky(`every\\s+(\\d{1,2})\\s+(day|week|month|year)s?${END}`), apply: (m, s) => {
    const interval = Number(m[1]);
    if (interval < 1) return false;
    const freq = {day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY'}[m[2]!.toLowerCase()]!;
    return rule(s, `FREQ=${freq}${interval > 1 ? `;INTERVAL=${interval}` : ''}`, freq === 'WEEKLY');
  }},
  {kind: 'when', pattern: sticky(`every\\s+(weekday|weekend)s?${END}`),
    apply: (m, s) => rule(s, m[1]!.toLowerCase() === 'weekday' ? 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' : 'FREQ=WEEKLY;BYDAY=SA,SU')},
  {kind: 'when', pattern: sticky(`every\\s+((?:${WEEKDAY})(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+)(?:${WEEKDAY}))*)${END}`),
    apply: (m, s) => rule(s, `FREQ=WEEKLY;BYDAY=${byDays(m[1]!)}`)},
  {kind: 'when', pattern: sticky(`(?:every\\s+(day|week|month|year)|(daily|weekly|monthly|yearly|annually|biweekly))${END}`), apply: (m, s) => {
    const word = (m[1] ?? m[2]!).toLowerCase();
    if (word === 'biweekly') return rule(s, 'FREQ=WEEKLY;INTERVAL=2', true);
    const freq = {day: 'DAILY', daily: 'DAILY', week: 'WEEKLY', weekly: 'WEEKLY', month: 'MONTHLY', monthly: 'MONTHLY', year: 'YEARLY', yearly: 'YEARLY', annually: 'YEARLY'}[word]!;
    return rule(s, `FREQ=${freq}`, freq === 'WEEKLY');
  }},
];

/** A time on its own; "no end" by it is No end (SV-108), unless a length came first (SV-111). */
function single(m: RegExpExecArray, s: State): boolean {
  if (s.start !== null) return false;
  const noEnd = /no\s+end/i.test(m[0]);
  if (noEnd && s.length !== null) return false;
  let found: number | null;
  if (m[1]) found = m[1].toLowerCase() === 'noon' ? 720 : 0;
  else if (!m[3] && !m[4]) return false;
  else found = clock(Number(m[2]), Number(m[3] ?? 0), meridiemOf(m[4]));
  if (found === null) return false;
  s.start = found;
  if (noEnd) s.end = found;
  return true;
}

const TIMES: Matcher[] = [
  {kind: 'when', pattern: sticky(`(?:(?:at|from)\\s+)?${RANGE_TIME}\\s*(?:-|–|to|until)\\s*${RANGE_TIME}${END}`), apply: (m, s) => {
    const found = range(m);
    // A length read first wins over an end (SV-111).
    if (!found || s.start !== null || s.length !== null) return false;
    [s.start, s.end] = [found.start, found.end];
    return true;
  }},
  // A time, with "no end" before or after it for No end (SV-108); without it, once a length is read.
  {kind: 'when', pattern: sticky(`(?:no\\s+end\\s+)?(?:at\\s+)?(?:(noon|midnight)|${TIME})(?:\\s+no\\s+end)?${END}`), apply: single},
  {kind: 'when', pattern: sticky(`(?:at\\s+)?(?:(noon|midnight)|${TIME})${END}`), apply: single},
];

// ---------- Lengths and spans (SV-111) ----------

// A length's units (D291): min(s)/minute(s), h/hr(s)/hour(s), d/day(s), week(s); no "wk".
const UNIT = '(?:minutes?|mins?|hours?|hrs?|h|days?|d|weeks?)(?![a-z])';
const NUMBER = '\\d+(?:\\.\\d+)?';
const UNIT_MINUTES: Record<string, number> = {m: 1, h: 60, d: 1440, w: 10080};

const LENGTH: Matcher = {
  kind: 'when', pattern: sticky(`for\\s+(${NUMBER}\\s*${UNIT}(?:\\s*${NUMBER}\\s*${UNIT})*(?:\\d{1,2})?)${END}`), apply: (m, s) => {
    // A task's line keeps it as words, and the first of a length or an end wins (D292).
    if (!s.event || s.length !== null || s.end !== null) return false;
    const minutes = minutesIn(m[1]!);
    if (minutes === null || minutes < 1) return false;
    s.length = minutes;
    s.wholeDays = minutes % 1440 === 0 && /^(?:\s*\d+\s*(?:days?|d|weeks?)(?![a-z]))+$/i.test(m[1]!);
    return true;
  },
};

/** A length's minutes ("1 hour 20mins" is 80, "1h30" 90), rounded; null when it isn't one. */
function minutesIn(text: string): number | null {
  let minutes = 0;
  let last = '';
  for (const [, value, word] of text.matchAll(/(\d+(?:\.\d+)?)\s*([a-z]*)/gi)) {
    // "1h30": minutes after hours, with no unit of their own.
    if (!word && (last !== 'h' || Number(value) > 59)) return null;
    last = word ? word[0]!.toLowerCase() : 'm';
    minutes += Number(value) * UNIT_MINUTES[last]!;
  }
  return Math.round(minutes);
}

// The days a span runs between, as the date matchers read them (a bare day only last: "oct 23–25").
const DAY_TEXT = `(?:${RELATIVE}|today|tonight|tomorrow|tmrw|tmr|(?:(?:next|this)\\s+)?(?:${WEEKDAY})|(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`
  + `|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH})(?:\\s+\\d{4})?|\\d{1,2}/\\d{1,2}(?:/(?:\\d{4}|\\d{2}))?|\\d{4}-\\d{2}-\\d{2})`;
// A bare day isn't an hour ("oct 3 to 5pm" is a time).
const LAST_DAY = `(?:${DAY_TEXT}|\\d{1,2}(?:st|nd|rd|th)?(?!\\s*:|${MERIDIEM}))`;
// A time by a span's end: am/pm or minutes, noon or midnight, as a lone time.
const SPAN_TIME = `(?:noon|midnight|\\d{1,2}(?::?\\d{2})?${MERIDIEM}|\\d{1,2}:\\d{2})`;

/**
 * A span's last day, read from its first (D292): a weekday the next on or after it, a bare day in its
 * month, a month and day past it next year's when its month is earlier ("dec 30 – jan 2"). Null
 * when it's backwards: before the first, or a month and day earlier in the first's own month.
 */
function lastDay(text: string, from: string): string | null {
  const bare = /^(\d{1,2})(?:st|nd|rd|th)?$/i.exec(text);
  const to = bare ? day(Number(from.slice(0, 4)), Number(from.slice(5, 7)), Number(bare[1])) : parseDay(text, from);
  if (to === null || to < from) return null;
  // Read from the first without a year of its own, the same month earlier would be a year on.
  const rolled = to.slice(0, 4) > from.slice(0, 4) && to.slice(5, 7) >= from.slice(5, 7);
  return rolled && !/\d{4}|\/\d{1,2}\/\d{2}$/.test(text) ? null : to;
}

const SPAN: Matcher = {
  kind: 'when',
  pattern: sticky(`(?:(?:on|from)\\s+)?(${DAY_TEXT})(?:\\s+(?:at\\s+)?(${SPAN_TIME}))?(?:\\s*[-–—]\\s*|\\s+(?:to|through|thru)\\s+)(${LAST_DAY})(?:\\s+(?:at\\s+)?(${SPAN_TIME}))?${END}`),
  apply: (m, s, today) => {
    if (!s.event) return 'words';
    if (s.date || s.ending) return false;
    const from = parseDay(m[1]!, today);
    if (from === null) return false;
    const to = lastDay(m[3]!, from);
    if (to === null) return 'words';
    const [first, second] = [m[2] ? parseClock(m[2]) : null, m[4] ? parseClock(m[4]) : null];
    if ((m[2] && first === null) || (m[4] && second === null)) return false;
    if (first !== null && second !== null) {
      // A time at each end: one event across the days.
      const end = daysBetween(from, to) * 1440 + second;
      if (s.start !== null || s.length !== null) return false;
      if (end <= first) return 'words';
      [s.date, s.start, s.end] = [from, first, end];
      return true;
    }
    const time = first ?? second;
    if (time !== null && s.start !== null) return false;
    [s.date, s.last] = [from, to];
    if (time !== null) s.start = time;
    return true;
  },
};

// ---------- When a repeat ends (SV-113) ----------

/**
 * When a repeat ends (SV-113, D294), only once one is read; the first ending wins. Without a repeat
 * "until …" and a count stay words, and "for N days/weeks" is left to the length.
 */
function ending(s: State, start: number, found: Omit<NonNullable<State['ending']>, 'start'>, orLength = false): boolean | 'words' {
  if (!s.recurrence) return orLength ? false : 'words';
  if (s.ending || s.last) return 'words';
  s.ending = {start, ...found};
  return true;
}

const ENDINGS: Matcher[] = [
  {kind: 'when', pattern: sticky(`until\\s+(${DAY_TEXT})${END}`), apply: (m, s, today) => {
    const until = parseDay(m[1]!, today);
    return until ? ending(s, m.index, {until}) : false;
  }},
  // Todoist documents no count, so a task's stays words.
  {kind: 'when', pattern: sticky(`(?:for\\s+)?(\\d{1,3})\\s+times?${END}`),
    apply: (m, s) => (!s.event || Number(m[1]) < 1 ? 'words' : ending(s, m.index, {count: Number(m[1])}))},
  {kind: 'when', pattern: sticky(`for\\s+(\\d{1,3})\\s*(days?|d|weeks?|months?)${END}`), apply: (m, s) => {
    const value = Number(m[1]);
    if (value < 1) return false;
    return ending(s, m.index, {length: {value, unit: m[2]![0]!.toLowerCase() as 'd' | 'w' | 'm'}}, true);
  }},
];

// ---------- Reminders (SV-112, D293) ----------

const DURATION = `${NUMBER}\\s*${UNIT}(?:\\s*${NUMBER}\\s*${UNIT})*(?:\\d{1,2})?`;
// Between a phrase's reminders: "and", a comma, or both.
const JOIN = '(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)';
const AT_START = 'at\\s+(?:the\\s+)?start(?![a-z])';
// Lengths sharing one "before" or "after" ("1 day and 10 mins before").
const OFFSETS = `(${DURATION}(?:${JOIN}${DURATION})*)\\s+(before|after)(?![a-z])`;
const MOMENT = `(?:(?:on\\s+)?(${DAY_TEXT})\\s+)?(?:at\\s+)?(${SPAN_TIME})`;
const REMIND_ITEM = `(?:${AT_START}|${OFFSETS}|${MOMENT})`.replace(/\((?!\?)/g, '(?:');
const REMIND = '(?:remind(?:\\s+me)?|reminder)\\s+';
const REMIND_PARTS = {join: sticky(JOIN), start: sticky(AT_START), offsets: sticky(OFFSETS), moment: sticky(MOMENT)};

/** A reminder phrase's reminders, after its "remind": null when one isn't one. */
function remindersIn(body: string, today: string): State['reminders'][number]['reads'] | null {
  const reads: State['reminders'][number]['reads'] = [];
  const at = (pattern: RegExp, index: number) => {
    pattern.lastIndex = index;
    return pattern.exec(body);
  };
  let index = 0;
  while (index < body.length) {
    if (reads.length) {
      const join = at(REMIND_PARTS.join, index);
      if (!join) return null;
      index += join[0].length;
    }
    const start = at(REMIND_PARTS.start, index);
    const offsets = start ? null : at(REMIND_PARTS.offsets, index);
    const moment = start || offsets ? null : at(REMIND_PARTS.moment, index);
    const found = start ?? offsets ?? moment;
    if (!found) return null;
    if (start) reads.push({minutes: 0});
    if (offsets) {
      const sign = offsets[2]!.toLowerCase() === 'after' ? -1 : 1;
      for (const part of offsets[1]!.split(new RegExp(JOIN, 'i'))) {
        const minutes = minutesIn(part);
        if (minutes === null) return null;
        reads.push({minutes: minutes === 0 ? 0 : sign * minutes});
      }
    }
    if (moment) {
      const date = moment[1] ? parseDay(moment[1], today) : null;
      const time = parseClock(moment[2]!);
      if ((moment[1] && date === null) || time === null) return null;
      reads.push({date, time});
    }
    index += found[0].length;
  }
  return reads;
}

const REMINDERS: Matcher[] = [
  {kind: 'reminder', pattern: sticky(`${REMIND}(${REMIND_ITEM}(?:${JOIN}${REMIND_ITEM})*)${END}`), apply: (m, s, today) => {
    // Nothing to count from (a task with no date): the phrase stays words.
    if (!s.remind) return 'words';
    const reads = remindersIn(m[1]!, today);
    if (!reads) return false;
    s.reminders.push({start: m.index, reads});
    return true;
  }},
  // "remind" and a day with no time: words, the day not the item's.
  {kind: 'reminder', pattern: sticky(`${REMIND}(?:on\\s+)?${DAY_TEXT}${END}`), apply: () => 'words'},
];

/**
 * The reminders the phrases read, each checked against the item's moment once the whole line is
 * read: a phrase with one past 4 weeks either side, or one too many with what the item keeps, stays
 * words. Approximate in minutes on the clock; reminders.ts turns them into exact offsets.
 */
function resolveReminders(state: State, days: number | null): {reminders: ReminderRead[] | null; words: Set<number>} {
  const words = new Set<number>();
  if (!state.reminders.length || !state.remind) return {reminders: null, words};
  const day = state.date ?? state.remind.day;
  const time = state.start ?? (days !== null ? 0 : state.remind.time);
  const kept = new Map<string, ReminderRead>();
  for (const phrase of state.reminders) {
    const reads: ReminderRead[] = phrase.reads.map(read => ('minutes' in read ? read : {date: read.date ?? day, time: read.time}));
    const offset = (read: ReminderRead) => ('minutes' in read ? read.minutes : daysBetween(read.date, day) * 1440 + time - read.time);
    const added = new Map(reads.map(read => [JSON.stringify(read), read] as const).filter(([key]) => !kept.has(key)));
    if (reads.some(read => Math.abs(offset(read)) > REMINDER_LINE_LIMITS.minutes) || kept.size + added.size + (state.remind.kept ?? 0) > REMINDER_LINE_LIMITS.count) {
      words.add(phrase.start);
      continue;
    }
    for (const [key, read] of added) kept.set(key, read);
  }
  return {reminders: kept.size ? [...kept.values()] : null, words};
}

/** A month's last day. */
const lastOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/** `months` after `date`: the same day of the month, or that month's last day when it's shorter. */
function addMonths(date: string, months: number): string {
  const index = Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1 + months;
  const [year, month] = [Math.floor(index / 12), (index % 12) + 1];
  return day(year, month, Number(date.slice(8))) ?? lastOfMonth(year, month);
}

/**
 * A day counted from today (D294): "in N days/weeks/months" today plus N; "next week" Monday of next
 * week; "this weekend" or "weekend" the coming Saturday, today on a Saturday, "next weekend" the one
 * after; "end of week" the coming Friday (this week's, but next week's at the weekend); "end of month"
 * and "eom" this month's last day, "end of next month" next month's. Null when it isn't one.
 */
function relativeDay(text: string, today: string): string | null {
  const words = text.toLowerCase().replace(/\s+/g, ' ');
  const weekday = weekdayOf(today);
  const counted = /^in (\d+) ?([a-z])/.exec(words);
  if (counted) {
    const n = Number(counted[1]);
    if (n < 1) return null;
    return counted[2] === 'm' ? addMonths(today, n) : addDays(today, n * (counted[2] === 'w' ? 7 : 1));
  }
  if (/weekend$/.test(words)) return addDays(today, (5 - weekday + 7) % 7 + (words.startsWith('next') ? 7 : 0));
  if (words === 'next week') return addDays(today, 7 - weekday);
  if (/week$/.test(words)) return addDays(today, (4 - weekday + 7) % 7);
  const month = addMonths(`${today.slice(0, 8)}01`, words.includes('next') ? 1 : 0);
  return lastOfMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
}

const DATES: Matcher[] = [
  {kind: 'when', pattern: sticky(`(?:on\\s+)?(${RELATIVE})${END}`), apply: (m, s, today) => {
    if (!setDate(s, relativeDay(m[1]!, today))) return false;
    s.weekend = /weekend$/i.test(m[1]!);
    return true;
  }},
  {kind: 'when', pattern: sticky(`(?:on\\s+)?(today|tonight|tomorrow|tmrw|tmr)${END}`),
    apply: (m, s, today) => setDate(s, m[1]!.toLowerCase().startsWith('to') && m[1]!.toLowerCase() !== 'tomorrow' ? today : addDays(today, 1))},
  {kind: 'when', pattern: sticky(`(?:on\\s+)?(?:(next|this)\\s+)?(${WEEKDAY})${END}`), apply: (m, s, today) => {
    const ahead = (weekdayIndex(m[2]!) - weekdayOf(today) + 7) % 7;
    return setDate(s, addDays(today, ahead + (m[1]?.toLowerCase() === 'next' ? 7 : 0)));
  }},
  {kind: 'when', pattern: sticky(`(?:on\\s+)?(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${END}`),
    apply: (m, s, today) => setDate(s, upcoming(MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1, Number(m[2]), today, m[3]))},
  {kind: 'when', pattern: sticky(`(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})(?:\\s+(\\d{4}))?${END}`),
    apply: (m, s, today) => setDate(s, upcoming(MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1, Number(m[1]), today, m[3]))},
  {kind: 'when', pattern: sticky(`(?:on\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?${END}`),
    apply: (m, s, today) => setDate(s, upcoming(Number(m[1]), Number(m[2]), today, m[3]))},
  {kind: 'when', pattern: sticky(`(?:on\\s+)?(\\d{4})-(\\d{2})-(\\d{2})${END}`),
    apply: (m, s) => setDate(s, day(Number(m[1]), Number(m[2]), Number(m[3])))},
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function calendarMatchers(calendars: string[]): Matcher[] {
  return [...calendars].sort((a, b) => b.length - a.length).map(name => ({
    kind: 'calendar' as const, pattern: sticky(`cal\\s+${escape(name)}${END}`),
    apply: (_m: RegExpExecArray, s: State) => {
      if (s.calendar) return false;
      s.calendar = name;
      return true;
    },
  }));
}

/** Tries each matcher at `index`; the first that matches and applies wins. */
function matchAt(text: string, index: number, matchers: Matcher[], state: State, today: string): {length: number; kind: MarkKind; words?: true} | null {
  for (const matcher of matchers) {
    matcher.pattern.lastIndex = index;
    const match = matcher.pattern.exec(text);
    const applied = match && match[0].length ? matcher.apply(match, state, today) : false;
    if (applied === 'words') return {length: match![0].length, kind: matcher.kind, words: true};
    if (applied) return {length: match![0].length, kind: matcher.kind};
  }
  return null;
}

// Words a place stops before, as v1's did ("@Blue Door at 7pm").
const BOUNDARY_WORDS = /^(?:at|on|from|to)$/i;

/** Whether a phrase other than a place starts at `index` (a place stops there); `#` too while projects or calendars are read. */
function phraseStarts(text: string, index: number, matchers: Matcher[], today: string, hash: boolean, event: boolean): boolean {
  if (BOUNDARY_WORDS.test(/^\S+/.exec(text.slice(index))![0])) return true;
  const probe = fresh(event);
  return text[index] === '@' || (hash && text[index] === '#') || matchAt(text, index, matchers, probe, today) !== null;
}

/** A link as a place ("https://zoom.us/j/1"), without punctuation after it. */
export const PLACE_URL = /^(?:https?:\/\/|www\.)\S+?(?=[.,;!?]*(?:\s|$))/i;

/**
 * The line once a suggestion is picked for its "@place" or "#name" (from `start`, its "@" or "#", to
 * `end`, a comma after it included): the name in full, then a space to go on typing (SV-29). A comma
 * typed after it stays; the caret goes past the space.
 */
export function completeToken(text: string, start: number, end: number, name: string): {text: string; caret: number} {
  const valueEnd = end - (/\s*,$/.exec(text.slice(start, end))?.[0].length ?? 0);
  const head = `${text.slice(0, start + 1)}${name}`;
  let rest = text.slice(valueEnd);
  if (!/^[\s,]/.test(rest)) rest = ` ${rest}`;
  return {text: `${head}${rest}`, caret: head.length + /^[\s,]*/.exec(rest)![0].length};
}

/**
 * A "#" or "@" just typed at the line's end, before the line reads it as a mark (SV-71): a lone "#",
 * or "@" with at most one letter (Places searches from two). Its field's menu opens on it, showing
 * every choice before anything is typed, as darma's does. `start` is the trigger's place; `query`
 * is what follows it.
 */
export function bareToken(text: string, trigger: '#' | '@'): {start: number; query: string} | null {
  const found = (trigger === '#' ? /(?:^|\s)#$/ : /(?:^|\s)@(\S?)$/).exec(text);
  if (!found) return null;
  const query = found[1] ?? '';
  return {start: text.length - query.length - 1, query};
}

const TRAILING_CONNECTOR = /(?:\s+(?:on|at|from|to|for))+\s*$/i;

/**
 * What an edit typed into a title (SV-90): `after` from where it first differs from `before` to
 * where the two agree again. A word the edit changed is typed whole ("Standup 9am" made "Standup
 * 10am" typed "10am"); a word it only typed beside isn't ("Call fri" made "Call fri 3pm" typed
 * " 3pm"). Empty when nothing changed, or when only spaces or whole words went.
 */
export function typedSpan(before: string, after: string): {start: number; end: number} {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  let end = after.length - tail;
  const word = (at: number) => at >= 0 && at < after.length && /\S/.test(after[at]!);
  while (word(start - 1) && word(start)) start -= 1;
  while (word(end - 1) && word(end)) end += 1;
  return {start, end};
}

/**
 * Reads the title as typed; `today` places weekdays and bare dates, `calendars` are the names "cal …"
 * knows, and `picked` is the place text a suggestion was picked for, where the place stops. `hash`
 * is what "#…" reads (a task's projects or an event's calendars): their names, in the list's order,
 * with the text a menu pick was made for.
 *
 * `edit` is an item's title as it was and its day, when the text is that title edited (SV-90): only
 * phrases wholly inside what the edit typed are read (`typedSpan`), and a repeat with no day of its
 * own counts from the item's day rather than today. With no phrase read the title is the text as
 * typed, spaces and all; phrases that leave no words keep the title as it was.
 *
 * A task's line (`hash` its projects) reads no lengths or spans of days; any other, an event's, does.
 *
 * `remind` is what the item's reminders count from when the line names no day or time (SV-112); with
 * none, reminder phrases stay words.
 */
export function parseTitle(text: string, today: string, calendars: string[] = [], picked: string | null = null,
  hash: {kind: 'project' | 'calendar'; names: string[]; picked: string | null} | null = null,
  edit: {before: string; day: string} | null = null, remind: ReminderBase | null = null): ParsedTitle {
  const state = fresh(hash?.kind !== 'project', remind);
  // Reminders before the days and times, so "remind sun 8pm" doesn't move the item (SV-112).
  const phrases = [...calendarMatchers(calendars), ...REMINDERS, ...REPEATS, ...ENDINGS, ...TIMES, LENGTH, SPAN, ...DATES];
  let marks: Mark[] = [];
  // An edit's phrases start and end in what it typed: the text is read only to its end.
  const typed = edit ? typedSpan(edit.before, text) : {start: 0, end: text.length};
  const line = text.slice(0, typed.end);
  const words = [...line.matchAll(/\S+/g)].map(word => word.index).filter(index => index >= typed.start);
  for (let w = 0; w < words.length; w += 1) {
    const index = words[w]!;
    let found: {length: number; kind: MarkKind; words?: true} | null = null;
    const place = line[index] === '@' && state.place === null;
    if (place || (line[index] === '#' && hash && state[hash.kind] === null)) {
      // The place or project runs to the next phrase, or stops at what a pick was made for.
      const from = index + 1;
      const pick = place ? picked : hash!.picked;
      const lower = (name: string) => name.toLowerCase();
      const ends = (at: number) => new RegExp(`^${END}`).test(line.slice(at));
      let next = w + 1;
      while (next < words.length && !phraseStarts(line, words[next]!, phrases, today, !!hash, state.event)) next += 1;
      const stopsAtPick = pick !== null && line.startsWith(pick, from) && ends(from + pick.length);
      const url = place ? PLACE_URL.exec(line.slice(from)) : null;
      // A project stops at the longest name it starts with.
      const known = hash?.kind !== 'project' ? undefined : hash.names.filter(name => lower(line.slice(from, from + name.length)) === lower(name) && ends(from + name.length))
        .sort((a, b) => b.length - a.length)[0];
      // A calendar is the longest text, ending a word, that a calendar's name starts with.
      let prefix = from;
      for (let at = from + 1; !place && hash!.kind === 'calendar' && at <= line.length; at += 1) {
        if (!hash!.names.some(name => lower(name).startsWith(lower(line.slice(from, at))))) break;
        if (ends(at)) prefix = at;
      }
      let end = stopsAtPick ? from + pick.length : url ? from + url[0].length : known ? from + known.length
        : hash?.kind === 'calendar' && !place ? prefix : next < words.length ? words[next]! : line.length;
      // A comma ends it, unless it's in the name picked for it (SV-29).
      const comma = stopsAtPick ? -1 : line.slice(from, end).indexOf(',');
      if (comma >= 0) end = from + comma;
      const value = line.slice(from, end).trim();
      if (value.length >= (place ? 2 : 1)) {
        if (place) state.place = value;
        else if (hash!.kind === 'project') state.project = known && !stopsAtPick && end === from + known.length ? known : value;
        else state.calendar = stopsAtPick ? value : hash!.names.find(name => lower(name) === lower(value)) ?? hash!.names.find(name => lower(name).startsWith(lower(value)))!;
        // A comma right after it goes with it, out of the title.
        const after = /^\s*,/.exec(line.slice(end));
        found = {length: after ? end + after[0].length - index : line.slice(index, end).trimEnd().length, kind: place ? 'place' : hash!.kind};
      }
    } else {
      found = matchAt(line, index, phrases, state, today);
    }
    if (!found) continue;
    // A phrase that stays words is passed over whole.
    if (!found.words) marks.push({start: index, end: index + found.length, kind: found.kind});
    while (w + 1 < words.length && words[w + 1]! < index + found.length) w += 1;
  }

  // A weekly repeat with no date starts on its next day, today (an edited item's day) counting.
  const first = edit?.day ?? today;
  if (!state.date && state.repeatDays.length) state.date = addDays(first, Math.min(...state.repeatDays.map(index => (index - weekdayOf(first) + 7) % 7)));
  if (state.recurrence && state.weeklyNeedsDay) state.recurrence += `;BYDAY=${RRULE_DAYS[weekdayOf(state.date ?? first)]}`;
  // The repeat's end (SV-113, D294), from its first occurrence, the item's day: "for N weeks" lasts that
  // long, its last day the one before the first plus N, and pins the day it counts from; a last day
  // before the first stays words.
  const endWords = new Set<number>();
  if (state.ending) {
    const {start, until, count, length} = state.ending;
    if (length) {
      state.date ??= first;
      const after = length.unit === 'm' ? addMonths(state.date, length.value) : addDays(state.date, length.value * (length.unit === 'w' ? 7 : 1));
      state.recurrence += `;UNTIL=${compact(addDays(after, -1))}`;
    } else if (until !== undefined) {
      if (until < (state.date ?? first)) endWords.add(start);
      else state.recurrence += `;UNTIL=${compact(until)}`;
    } else state.recurrence += `;COUNT=${count}`;
  }
  // A span with no time is all day over its days; with one time or a length, that each day until its
  // last, the repeat typed or a daily one (SV-111, D292). A length in whole days with no time is all
  // day over them (D298), and an event's weekend with neither is Saturday–Sunday (D294).
  let days: number | null = null;
  if (state.last && state.start === null && state.length === null) days = daysBetween(state.date!, state.last) + 1;
  else if (state.last) state.recurrence = `${state.recurrence ?? 'RRULE:FREQ=DAILY'};UNTIL=${compact(state.last)}`;
  else if (state.event && state.start === null && state.length !== null && state.wholeDays) [days, state.length] = [state.length / 1440, null];
  else if (state.event && state.start === null && state.length === null && state.weekend) days = 2;
  if (state.length !== null && state.start !== null && state.end === null) state.end = state.start + state.length;
  // A reminder phrase the item can't take stays words (SV-112).
  const {reminders, words: remindWords} = resolveReminders(state, days);
  marks = marks.filter(mark => (mark.kind !== 'reminder' || !remindWords.has(mark.start)) && !endWords.has(mark.start));

  // A day, time or repeat next to another reads as one ("fri 7-9pm").
  const merged: Mark[] = [];
  for (const mark of marks) {
    const last = merged.at(-1);
    if (last && last.kind === 'when' && mark.kind === 'when' && /^\s*$/.test(text.slice(last.end, mark.start))) last.end = mark.end;
    else merged.push({...mark});
  }


  let title = '';
  let from = 0;
  for (const mark of merged) {
    title += `${text.slice(from, mark.start)} `;
    from = mark.end;
  }
  title += text.slice(from);
  title = title.replace(/\s+/g, ' ').trim().replace(TRAILING_CONNECTOR, '');
  if (edit) title = !merged.length ? text : title || edit.before;
  return {
    title,
    marks: merged, date: state.date, start: state.start, end: state.end, place: state.place, calendar: state.calendar, recurrence: state.recurrence,
    project: state.project, days, length: state.length, reminders,
  };
}

/**
 * The line with its title words replaced by a Title typed by hand, its phrases kept in order after
 * it ("Coffee fri" titled "Coffee with Ana" reads "Coffee with Ana fri"), so the line and the Title
 * never disagree (UX #8).
 */
export function lineWithTitle(text: string, marks: Mark[], title: string): string {
  const rest = marks.map(mark => text.slice(mark.start, mark.end)).join(' ');
  if (!title.trim()) return rest;
  if (!rest) return title;
  return /\s$/.test(title) ? `${title}${rest}` : `${title} ${rest}`;
}

/** A typed day for the date field ("fri", "oct 12", "10/12"), or null. */
export function parseDay(text: string, today: string): string | null {
  // "Fri, Oct 12" as the field shows it: the date, not the weekday. Read as a task's line, so a
  // weekend is its Saturday rather than an event's two days (SV-113).
  const parsed = parseTitle(text.trim().replace(new RegExp(`^(?:${WEEKDAY}),?\\s+(?=\\S)`, 'i'), ''), today, [], null, {kind: 'project', names: [], picked: null});
  return parsed.title === '' && parsed.start === null && parsed.days === null && parsed.date ? parsed.date : null;
}

/**
 * A typed time for a time field ("7pm", "7:30 PM", "19:00", and SV-25's shorthand "3p", "330p",
 * "2130"; "7" or "930" keep `meridiemFrom`'s half), or null.
 */
export function parseClock(text: string, meridiemFrom: number | null = null): number | null {
  const typed = /^\s*(\d{1,2})(?::?(\d{2}))?\s*(?:([ap])\.?m?\.?)?\s*$/i.exec(text);
  if (typed) {
    const [hour, minute, meridiem] = [Number(typed[1]), Number(typed[2] ?? 0), typed[3]?.toLowerCase() as 'a' | 'p' | undefined];
    if (meridiem) return clock(hour, minute, meridiem);
    if (meridiemFrom !== null && hour <= 12) return clock(hour, minute, meridiemFrom >= 720 ? 'p' : 'a');
    return typed[2] ? clock(hour, minute, null) : null;
  }
  const parsed = parseTitle(text.trim(), '2000-01-01');
  return parsed.title === '' && parsed.start !== null && parsed.end === null ? parsed.start : null;
}

/** What a new draft holds, for whether it has started. */
export interface DraftContent {
  text: string;
  title: string;
  place: string;
  // Fields set by hand.
  manual: string[];
  // Null while Settings' default.
  reminders: number[] | null;
  recurrence: string | null;
  project: string | null;
}

/**
 * Whether new drafts hold anything the user put there: a line, a title, a place, a field set by hand,
 * a reminder, repeat or project chosen, or a second draft. Such a draft leaves only by Create,
 * Cancel or Esc; E or New on another item doesn't replace it (2026-10-08, F6 choice 14).
 */
export function draftStarted(drafts: DraftContent[]): boolean {
  return drafts.length > 1 || drafts.some(draft => draft.text.trim() !== '' || draft.title.trim() !== '' || draft.place.trim() !== ''
    || draft.manual.length > 0 || draft.reminders !== null || draft.recurrence !== null || draft.project !== null);
}

/** "7:00 PM" for minutes after midnight (a time past midnight reads as the next day's). */
/** An end typed beside `start` ("9" reads as `end`'s half of the day); at or before the start, it's the next day's. */
export function parseEnd(text: string, start: number, end: number | null): number | null {
  const found = parseClock(text, end);
  if (found === null) return null;
  return found > start % 1440 ? found + Math.floor(start / 1440) * 1440 : found + 1440;
}

// ---------- An event's days (SV-29) ----------

/**
 * The days an event runs past its first: an all-day one's `days` less one; a timed one's to its end
 * (minutes from its first day's midnight), an end at midnight staying on the day before.
 */
export function extraDays(start: number | null, end: number | null, days: number): number {
  if (start === null) return days - 1;
  return Math.max(0, Math.floor(((end ?? start) - 1) / 1440));
}

/**
 * An event made to run from `from` to `to`, its last day, keeping its times of day: an all-day one
 * takes the days between; a timed one ends at its end's time on `to`, or an hour after its start
 * when that's no later on a one-day event. A last day before the first is the first.
 */
export function spanTo(from: string, to: string, start: number | null, end: number | null): {date: string; end: number | null; days: number} {
  const extra = Math.max(0, daysBetween(from, to));
  if (start === null) return {date: from, end: null, days: extra + 1};
  // The end's time of day, an end at midnight as 24:00.
  const time = (((end ?? start + 60) - 1) % 1440) + 1;
  const next = extra * 1440 + time;
  return {date: from, end: next > start ? next : start + 60, days: 1};
}

/** An item's when: its first day; minutes after that day's midnight (null: all day, or a task's no time); an all-day event's days. */
export interface When {
  date: string;
  start: number | null;
  end: number | null;
  days: number;
}

/**
 * An edited item's when, once its title's typed day and time are read (SV-90): a day moves it,
 * keeping its time and length (an all-day event its days); a time moves its start on its own day,
 * the end keeping the length ("Work" 3:00 – 8:00 AM at 3:45a ends 8:45 AM); a range sets both ends.
 * An all-day event given a time ends an hour later on its last day, as Add a time makes it. A
 * task's time is its due time, with no end. With neither, it's as it was.
 *
 * An event's span of days (`days`) makes it all day over them, and a length with no time lasts that
 * long from its own start, an all-day one's 9:00 AM (SV-111).
 */
export function editedWhen(item: When, read: {date: string | null; start: number | null; end: number | null; days?: number | null; length?: number | null}, kind: 'event' | 'task'): When {
  const date = read.date ?? item.date;
  if (kind === 'event' && read.days != null) return {date, start: null, end: null, days: read.days};
  if (kind === 'event' && read.start === null && read.length != null) {
    const start = item.start ?? 9 * 60;
    return {date, start, end: start + read.length, days: 1};
  }
  if (read.start === null) return {...item, date};
  if (kind === 'task') return {date, start: read.start, end: null, days: 1};
  const length = item.start === null || item.end === null ? (item.days - 1) * 1440 + 60 : item.end - item.start;
  return {date, start: read.start, end: read.end ?? read.start + length, days: 1};
}

/** An event with no end (SV-78): Google needs one, so it ends as it starts. */
export const NO_END = 'No end';

/** The End list: No end (SV-78), then the 24 hours after `start` (SV-25) while the event ends on its first day or the next; on a later last day, that day's times. */
export function endChoices(start: number, end: number): {minutes: number; label: string}[] {
  const extra = extraDays(start, end, 1);
  const none = {minutes: start, label: NO_END};
  if (extra === 0) return [none, ...timeChoices(start)];
  return [none, ...Array.from({length: 96}, (_, index) => ({minutes: extra * 1440 + index * 15, label: clockLabel(index * 15)}))];
}

/** A typed end: as `parseEnd` while the event ends on its first day; on a later last day, that day's time. */
export function readEnd(text: string, start: number, end: number): number | null {
  if (/^\s*(?:no end|none)\s*$/i.test(text)) return start;
  const extra = extraDays(start, end, 1);
  if (extra === 0) return parseEnd(text, start, end);
  const found = parseClock(text, end % 1440);
  return found === null ? null : extra * 1440 + found;
}

/**
 * An event's days as typed in its Date field: "Oct 23", or a first and last day ("Fri, Oct 23 – Sun,
 * Oct 25", "oct 23 - 25", "fri to sun"), the last read from the first. A lone day (`to` null) keeps
 * the event's length.
 */
export function parseDays(text: string, today: string): {from: string; to: string | null} | null {
  const [first, last, ...more] = text.split(/\s+(?:-|to|through|thru|until)\s+|\s*[–—]\s*/i);
  if (more.length || !first) return null;
  const from = parseDay(first, today);
  if (from === null) return null;
  if (last === undefined) return {from, to: null};
  const to = parseDay(last, from);
  return to === null ? null : {from, to};
}

export function clockLabel(minutes: number): string {
  const within = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(within / 60);
  return `${hour % 12 || 12}:${String(within % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "15 min", "1 hr", "1.5 hrs": an event's length in the End list. */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

/**
 * A time field's list in 15-minute steps (SV-25): the day's for a start; for an end, the 24 hours
 * after `start`, each with its length ("10:00 AM (1 hr)").
 */
export function timeChoices(start: number | null = null): {minutes: number; label: string}[] {
  return Array.from({length: 96}, (_, index) => {
    if (start === null) return {minutes: index * 15, label: clockLabel(index * 15)};
    const minutes = start + (index + 1) * 15;
    return {minutes, label: `${clockLabel(minutes)} (${durationLabel(minutes - start)})`};
  });
}

// ---------- Repeats ----------

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FULL_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ORDINAL_NAMES: Record<string, string> = {'1': 'first', '2': 'second', '3': 'third', '4': 'fourth', '-1': 'last'};

const ruleParts = (rule: string) => new Map(rule.replace(/^RRULE:/, '').split(';').filter(Boolean).map(part => part.split('=') as [string, string]));

/** "Tue, Dec 15" for a day, as a repeat's last day is said. */
const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'});

/**
 * A rule as the repeat field says it: "Weekly on Mon, Wed, Fri", "Every 2 weeks on Mon", "Monthly on
 * the first Mon"; its end, as the line writes it, after it: a last day ("Daily, until Sun, Oct 25";
 * SV-111) or a count ("Daily, 6 times", "…, once"; SV-113).
 */
export function describeRule(rule: string | null, date: string): string {
  if (!rule) return 'Does not repeat';
  const parts = ruleParts(rule);
  // An UNTIL with a time is an instant in UTC, whose local day this can't tell; it's left unsaid.
  const until = /^(\d{4})(\d{2})(\d{2})$/.exec(parts.get('UNTIL') ?? '');
  const count = Number(parts.get('COUNT') ?? 0);
  const said = describeRepeat(rule, date);
  if (said === 'Custom repeat') return said;
  if (until) return `${said}, until ${shortDay(`${until[1]}-${until[2]}-${until[3]}`)}`;
  return count > 0 ? `${said}, ${count === 1 ? 'once' : `${count} times`}` : said;
}

function describeRepeat(rule: string, date: string): string {
  const parts = ruleParts(rule);
  const interval = Number(parts.get('INTERVAL') ?? 1);
  const days = parts.get('BYDAY');
  const every = (one: string, many: string) => (interval > 1 ? `Every ${interval} ${many}` : one);
  switch (parts.get('FREQ')) {
    case 'DAILY':
      return every('Daily', 'days');
    case 'WEEKLY': {
      const list = (days ?? RRULE_DAYS[weekdayOf(date)]!).split(',');
      if (interval === 1 && list.join(',') === 'MO,TU,WE,TH,FR') return 'Every weekday';
      // One day is spelled out (SV-29); several stay short.
      const names = list.length === 1 ? FULL_DAY_NAMES : DAY_NAMES;
      return `${every('Weekly', 'weeks')} on ${list.map(code => names[RRULE_DAYS.indexOf(code as (typeof RRULE_DAYS)[number])]).join(', ')}`;
    }
    case 'MONTHLY': {
      const nth = days ? /^(-?\d)([A-Z]{2})$/.exec(days) : null;
      if (nth) return `${every('Monthly', 'months')} on the ${ORDINAL_NAMES[nth[1]!]} ${FULL_DAY_NAMES[RRULE_DAYS.indexOf(nth[2] as (typeof RRULE_DAYS)[number])]}`;
      return `${every('Monthly', 'months')} on day ${Number(date.slice(8))}`;
    }
    case 'YEARLY':
      return `${every('Yearly', 'years')} on ${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'})}`;
    default:
      return 'Custom repeat';
  }
}

/** The repeat field's choices for an event on `date`, with the event's own rule kept among them. */
export function repeatChoices(date: string, current: string | null): {rule: string | null; label: string}[] {
  const rules = [null, 'RRULE:FREQ=DAILY', `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_DAYS[weekdayOf(date)]}`, 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'RRULE:FREQ=MONTHLY', 'RRULE:FREQ=YEARLY'];
  if (current && !rules.includes(current)) rules.push(current);
  return rules.map(rule => ({rule, label: describeRule(rule, date)}));
}

/**
 * A task's repeat as the field says it: Todoist's own words, capitalised, its days named as words
 * (SV-29): one spelled out ("Every Wednesday"), several capitalised as written ("Every Tue, Thu, Sat").
 */
export function describeTaskRepeat(repeat: string | null): string {
  if (!repeat) return 'Does not repeat';
  // A last day the line sent ("until 2026-12-15", SV-113) is said as an event's is.
  const until = /\s+until\s+(\d{4}-\d{2}-\d{2})$/i.exec(repeat);
  const words = until ? repeat.slice(0, until.index) : repeat;
  const days = new RegExp(`\\b(?:${WEEKDAY})\\b`, 'gi');
  const one = (words.match(days) ?? []).length === 1;
  const named = words.replace(days, word => (one ? FULL_DAY_NAMES[weekdayIndex(word)]! : `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`));
  return `${named[0]!.toUpperCase()}${named.slice(1)}${until ? `, until ${shortDay(until[1]!)}` : ''}`;
}

const ORDINAL_WORDS: Record<string, string> = {'1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last'};

/**
 * A rule the line read, as a task's repeat in Todoist's words ("every mon, wed", "every other fri"), as
 * `taskRepeatChoices` words them; a last day as "until 2026-12-15", a form Todoist documents (SV-113).
 * Todoist documents no count, so a rule with one has no words.
 */
export function taskRepeat(rule: string | null): string | null {
  if (!rule) return null;
  const parts = ruleParts(rule);
  if (parts.has('COUNT')) return null;
  const until = /^(\d{4})(\d{2})(\d{2})$/.exec(parts.get('UNTIL') ?? '');
  const words = taskRepeatWords(parts);
  return words && until ? `${words} until ${until[1]}-${until[2]}-${until[3]}` : words;
}

function taskRepeatWords(parts: Map<string, string>): string | null {
  const interval = Number(parts.get('INTERVAL') ?? 1);
  const days = (parts.get('BYDAY') ?? '').split(',').filter(Boolean);
  const unit = {DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year'}[parts.get('FREQ') ?? ''];
  if (!unit) return null;
  const word = (code: string) => WEEKDAY_WORDS[RRULE_DAYS.indexOf(code as (typeof RRULE_DAYS)[number])];
  const nth = unit === 'month' && days.length === 1 ? /^(-?\d)([A-Z]{2})$/.exec(days[0]!) : null;
  if (nth && interval === 1) return `every ${ORDINAL_WORDS[nth[1]!]} ${word(nth[2]!)}`;
  if (unit === 'week' && days.length && interval <= 2) {
    if (interval === 1 && days.join(',') === 'MO,TU,WE,TH,FR') return 'every weekday';
    return `every ${interval === 2 ? 'other ' : ''}${days.map(word).join(', ')}`;
  }
  return interval > 1 ? `every ${interval} ${unit}s` : `every ${unit}`;
}

/**
 * A Todoist task's repeat choices for its day, in Todoist's words (F6b): none, every day, every
 * <its weekday>, every weekday, every month, every year, and the task's own when it's another.
 */
export function taskRepeatChoices(date: string, current: string | null): {repeat: string | null; label: string}[] {
  const list = [null, 'every day', `every ${WEEKDAY_WORDS[weekdayOf(date)]}`, 'every weekday', 'every month', 'every year'];
  if (current && !list.includes(current)) list.push(current);
  return list.map(repeat => ({repeat, label: describeTaskRepeat(repeat)}));
}
