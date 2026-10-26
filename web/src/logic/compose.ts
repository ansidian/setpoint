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
//   already past this year is next year's); "on" before any of them.
// - a time: "7pm", "7:30 pm", "19:00", "noon", "midnight", "at" before any of them; a range "7-9pm",
//   "7pm - 9pm", "11-1pm", "from 9 to 5pm" (a bare hour is a time only with am/pm or minutes, so
//   "Gym 7" stays a title); No end, the end at the start, for the same time twice ("2pm to 2pm") or
//   "no end" by a time ("2pm no end", "no end 2pm"; SV-108).
// - repeats: daily, weekly, monthly, yearly, annually, biweekly; every day / week / month / year;
//   every 2 weeks; every other mon; every mon, wed and fri; every weekday / weekend; first mon of
//   every month.
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

export type MarkKind = 'when' | 'place' | 'calendar' | 'project';

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
}

const RRULE_DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
const WEEKDAY_WORDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
const WEEKDAY = 'mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday|s)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?';
const MONTH = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// A phrase ends at a space, punctuation or the end.
const END = '(?=$|[\\s,.;!?])';
const TIME = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)?';
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
  if (!startMer && !endMer && !(m1 || m2 || startHour > 12 || endHour > 12)) return null;
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
}

interface Matcher {
  kind: MarkKind;
  pattern: RegExp;
  // False when the match isn't one after all; `state` is changed only when it is.
  apply: (match: RegExpExecArray, state: State, today: string) => boolean;
}

const sticky = (source: string) => new RegExp(source, 'iy');

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

const TIMES: Matcher[] = [
  {kind: 'when', pattern: sticky(`(?:(?:at|from)\\s+)?${TIME}\\s*(?:-|–|to|until)\\s*${TIME}${END}`), apply: (m, s) => {
    const found = range(m);
    if (!found || s.start !== null) return false;
    [s.start, s.end] = [found.start, found.end];
    return true;
  }},
  // A time, with "no end" before or after it for No end (SV-108).
  {kind: 'when', pattern: sticky(`(?:no\\s+end\\s+)?(?:at\\s+)?(?:(noon|midnight)|${TIME})(?:\\s+no\\s+end)?${END}`), apply: (m, s) => {
    if (s.start !== null) return false;
    let found: number | null;
    if (m[1]) found = m[1].toLowerCase() === 'noon' ? 720 : 0;
    else if (!m[3] && !m[4]) return false;
    else found = clock(Number(m[2]), Number(m[3] ?? 0), meridiemOf(m[4]));
    if (found === null) return false;
    s.start = found;
    if (/no\s+end/i.test(m[0])) s.end = found;
    return true;
  }},
];

const DATES: Matcher[] = [
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
function matchAt(text: string, index: number, matchers: Matcher[], state: State, today: string): {length: number; kind: MarkKind} | null {
  for (const matcher of matchers) {
    matcher.pattern.lastIndex = index;
    const match = matcher.pattern.exec(text);
    if (match && match[0].length && matcher.apply(match, state, today)) return {length: match[0].length, kind: matcher.kind};
  }
  return null;
}

// Words a place stops before, as v1's did ("@Blue Door at 7pm").
const BOUNDARY_WORDS = /^(?:at|on|from|to)$/i;

/** Whether a phrase other than a place starts at `index` (a place stops there); `#` too while projects or calendars are read. */
function phraseStarts(text: string, index: number, matchers: Matcher[], today: string, hash: boolean): boolean {
  if (BOUNDARY_WORDS.test(/^\S+/.exec(text.slice(index))![0])) return true;
  const probe: State = {date: null, start: null, end: null, place: null, calendar: null, recurrence: null, project: null, weeklyNeedsDay: false, repeatDays: []};
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
 */
export function parseTitle(text: string, today: string, calendars: string[] = [], picked: string | null = null,
  hash: {kind: 'project' | 'calendar'; names: string[]; picked: string | null} | null = null,
  edit: {before: string; day: string} | null = null): ParsedTitle {
  const state: State = {date: null, start: null, end: null, place: null, calendar: null, recurrence: null, project: null, weeklyNeedsDay: false, repeatDays: []};
  const phrases = [...calendarMatchers(calendars), ...REPEATS, ...TIMES, ...DATES];
  const marks: Mark[] = [];
  // An edit's phrases start and end in what it typed: the text is read only to its end.
  const typed = edit ? typedSpan(edit.before, text) : {start: 0, end: text.length};
  const line = text.slice(0, typed.end);
  const words = [...line.matchAll(/\S+/g)].map(word => word.index).filter(index => index >= typed.start);
  for (let w = 0; w < words.length; w += 1) {
    const index = words[w]!;
    let found: {length: number; kind: MarkKind} | null = null;
    const place = line[index] === '@' && state.place === null;
    if (place || (line[index] === '#' && hash && state[hash.kind] === null)) {
      // The place or project runs to the next phrase, or stops at what a pick was made for.
      const from = index + 1;
      const pick = place ? picked : hash!.picked;
      const lower = (name: string) => name.toLowerCase();
      const ends = (at: number) => new RegExp(`^${END}`).test(line.slice(at));
      let next = w + 1;
      while (next < words.length && !phraseStarts(line, words[next]!, phrases, today, !!hash)) next += 1;
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
    marks.push({start: index, end: index + found.length, kind: found.kind});
    while (w + 1 < words.length && words[w + 1]! < index + found.length) w += 1;
  }

  // A day, time or repeat next to another reads as one ("fri 7-9pm").
  const merged: Mark[] = [];
  for (const mark of marks) {
    const last = merged.at(-1);
    if (last && last.kind === 'when' && mark.kind === 'when' && /^\s*$/.test(text.slice(last.end, mark.start))) last.end = mark.end;
    else merged.push({...mark});
  }

  // A weekly repeat with no date starts on its next day, today (an edited item's day) counting.
  const first = edit?.day ?? today;
  if (!state.date && state.repeatDays.length) state.date = addDays(first, Math.min(...state.repeatDays.map(index => (index - weekdayOf(first) + 7) % 7)));
  if (state.recurrence && state.weeklyNeedsDay) state.recurrence += `;BYDAY=${RRULE_DAYS[weekdayOf(state.date ?? first)]}`;

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
    project: state.project,
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
  // "Fri, Oct 12" as the field shows it: the date, not the weekday.
  const parsed = parseTitle(text.trim().replace(new RegExp(`^(?:${WEEKDAY}),?\\s+(?=\\S)`, 'i'), ''), today);
  return parsed.title === '' && parsed.start === null && parsed.date ? parsed.date : null;
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
 */
export function editedWhen(item: When, read: {date: string | null; start: number | null; end: number | null}, kind: 'event' | 'task'): When {
  const date = read.date ?? item.date;
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

/** A rule as the repeat field says it: "Weekly on Mon, Wed, Fri", "Every 2 weeks on Mon", "Monthly on the first Mon". */
export function describeRule(rule: string | null, date: string): string {
  if (!rule) return 'Does not repeat';
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
  const days = new RegExp(`\\b(?:${WEEKDAY})\\b`, 'gi');
  const one = (repeat.match(days) ?? []).length === 1;
  const named = repeat.replace(days, word => (one ? FULL_DAY_NAMES[weekdayIndex(word)]! : `${word[0]!.toUpperCase()}${word.slice(1).toLowerCase()}`));
  return `${named[0]!.toUpperCase()}${named.slice(1)}`;
}

const ORDINAL_WORDS: Record<string, string> = {'1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '-1': 'last'};

/** A rule the line read, as a task's repeat in Todoist's words ("every mon, wed", "every other fri"), as `taskRepeatChoices` words them. */
export function taskRepeat(rule: string | null): string | null {
  if (!rule) return null;
  const parts = ruleParts(rule);
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
