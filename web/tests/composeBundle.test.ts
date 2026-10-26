// SV-95: the web's title parser as one JS file for the iPhone app (setpoint-ios), which runs it in
// JavaScriptCore (darma SI-10, D8), with a table of what it parses for the app's tests to run. Both
// live in shared/compose/, beside the contract (`npm run contract:record` clears shared/contract/),
// and setpoint-ios copies them in at a pinned commit as it does the contract. This builds the bundle
// from web/src/logic/composeApp.ts with the repo's Vite, runs the committed one with no module loader
// and no DOM, and fails when either file is stale against compose.ts. `npm run compose:record`
// rewrites them, deliberately, once setpoint-ios handles the change.
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';
import type {Rolldown} from 'vite';
import {describe, expect, test} from 'vitest';
import * as app from '../src/logic/composeApp.ts';
import {LINE_REFERENCE} from '../src/logic/lineReference.ts';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const DIR = fileURLToPath(new URL('../../shared/compose/', import.meta.url));
const BUNDLE = `${DIR}compose.js`;
const CASES = `${DIR}cases.json`;
const RECORDING = process.env.SETPOINT_UPDATE_COMPOSE === '1';

// The seed's Wed, Oct 7, 2026, and its Google calendars and Todoist projects (server/src/dev/sample.ts).
const TODAY = '2026-10-07';
const CALENDARS = ['Personal', 'Classes', 'Jobs'];
const PROJECTS = ['Inbox', 'School', 'Home'];

const HEADER = `// Setpoint's title parser (web/src/logic/compose.ts), built by web/tests/composeBundle.test.ts
// (npm run compose:record) for the iPhone app's JavaScriptCore: one script, no module loader, no DOM.
// Generated; don't edit. It defines the global SetpointCompose with:
//   parseTitle({text, kind: "event"|"task", today: "YYYY-MM-DD", calendars: [name], projects: [name],
//     pickedPlace?: string|null, pickedHash?: string|null, edit?: {before, day: "YYYY-MM-DD"}|null,
//     remind?: {day: "YYYY-MM-DD", time, kept?}|null})
//     → {title, marks: [{start, end, kind: "when"|"place"|"calendar"|"project"|"reminder"}], date, start, end,
//        place, calendar, recurrence, project, days, length, reminders}
//     (edit: an item's title before it was edited, and its day; only what the edit typed is read)
//     (days: an event's all-day days, first and last counting, else null: a span's, a weekend's 2
//      ("this weekend" with no time), or a length's in whole days with no time ("fri for 3 days",
//      D298); length: minutes a "for" length read, else null, the end already counting it when a
//      start was read, and with none the event starts at the default start, the slot's else 9:00 AM;
//      null when it made days instead; SV-111, SV-113)
//     (recurrence: an RFC 5545 rule, its end the line read after it, a date-only UNTIL=YYYYMMDD
//      (the last local day) or, an event's only, COUNT=N; a task's goes to Todoist as words, its
//      UNTIL as "until YYYY-MM-DD" after the repeat, a form Todoist documents; SV-113, D294)
//     (remind: what the item's reminders count from when the line names no day or time: its day, and
//      its moment in minutes after midnight (an event's start, the slot's else 9:00 AM, an all-day
//      one's 0; a task's due time, else Settings' task time, 9:00 AM at None; an edited item's own),
//      and kept, how many reminders it keeps beside the line's. Null or left out (a task with no
//      date): "remind …" phrases stay words. SV-112)
//     (reminders: what "remind", "remind me" or "reminder" phrases read, in order, the same one once,
//      else null: [{minutes}] before the item's moment, negative after it, or [{date: "YYYY-MM-DD",
//      time}] a moment, which the app turns into minutes from the item's moment in its time zone.
//      A phrase with one past 4 weeks either side, or one past 10 with kept, stays words. On a new
//      item they replace Settings' default, beside reminders picked by hand; on an edited item they
//      add to its own. SV-112, D293)
//   bareToken({text, trigger: "#"|"@"}) → {start, query} | null
//   completeToken({text, start, end, name}) → {text, caret}
//   lineWithTitle({text, marks, title}) → string
//   typedSpan({before, after}) → {start, end}, what an edit typed
//   editedWhen({item: {date, start, end, days}, read: {date, start, end, days?, length?}, kind}) → {date, start, end, days}
//   call(name, inputJSON) → resultJSON, the same with JSON text
// Offsets are UTF-16 code units; start and end are minutes after midnight (an end past midnight is
// over 1440, an end at the start No end). shared/compose/cases.json records what each returns.`;

type Kind = 'event' | 'task';
type Case = {fn: keyof typeof FUNCTIONS; input: Record<string, unknown>};

const FUNCTIONS = {parseTitle: app.parseTitle, bareToken: app.bareToken, completeToken: app.completeToken, lineWithTitle: app.lineWithTitle, typedSpan: app.typedSpan, editedWhen: app.editedWhen};

type Remind = {day: string; time: number; kept?: number} | null;
const line = (text: string, kind: Kind = 'event', picked: {pickedPlace?: string; pickedHash?: string; edit?: {before: string; day: string}; remind?: Remind} = {}): Case =>
  ({fn: 'parseTitle', input: {text, kind, today: TODAY, calendars: CALENDARS, projects: PROJECTS, ...picked}});
// SV-112: a new item today at 9:00 AM, what the line's reminders count from when it names no day or time.
const REMIND = {day: TODAY, time: 540};
const remind = (text: string, kind: Kind = 'event', given: Remind = REMIND): Case => line(text, kind, {remind: given});
// SV-113: a line read on another day (the issue's Mon, Oct 26, a Saturday that ends a month, a Sunday, month ends).
const lineOn = (text: string, today: string, kind: Kind = 'event'): Case => ({fn: 'parseTitle', input: {text, kind, today, calendars: CALENDARS, projects: PROJECTS}});
// SV-90: the item edited is on Wed, Oct 14.
const edited = (before: string, text: string, kind: Kind = 'event'): Case => line(text, kind, {edit: {before, day: '2026-10-14'}});

// What compose.ts's header lists, a case or more for each line of it.
const CASE_LIST: Case[] = [
  // Board 13, and titles that hold no phrase stay as typed.
  line('Dinner with Sam fri 7-9pm @Blue Door'),
  ...['Dentist', 'Gym 7', 'Dinner at 7', 'Room 2026', 'Mayday drill', '@', '@x', '#1 priority', 'Lunch feb 30', 'Lunch 13/1'].map(text => line(text)),
  // Days.
  ...['today', 'tonight', 'tomorrow', 'tmr', 'tmrw', 'wed', 'friday', 'tues', 'this fri', 'next fri', 'on sat', 'oct 12', 'October 12th',
    '12 oct', 'dec 9, 2026', 'oct 1', 'jan 5', '10/12', '10/12/26', '3/4/2027', '2026-10-30'].map(phrase => line(`Lunch ${phrase}`)),
  // Times and ranges.
  ...['7pm', '7:30 PM', 'at 7pm', '19:00', '7:30', 'noon', 'midnight', '12am', '9a', '7-9pm', '7pm - 9pm', '7 to 9pm', 'from 9 to 5pm',
    '11-1pm', '9am-5', '9:00-10:30', '13-15', '11pm-1am', 'at 7'].map(phrase => line(`Call ${phrase}`)),
  line('Gym sat 9am'),
  line('Dinner tmr at 7:30pm'),
  // An end at its start, and "no end" by a time, are No end (SV-108); only an end before it is the next day's.
  ...['event at 2pm to 2pm', 'Call 2-2pm', 'Call 14:00–14:00', 'Call Sam 2pm no end', 'Call Sam no end 2pm', 'Call Sam no end'].map(text => line(text)),
  // An event's length after "for" (SV-111, D291, D292): digits, decimals and compounds; with no time,
  // `length` alone; the first of a length or an end wins; bare lengths, number words and "wk" stay.
  ...['Run fri 7am for 15 min', 'Call 2pm for 1.5h', 'Meeting 2pm for 1 hour 20mins', 'Meeting 2pm for 1h30', 'Meeting 2pm for 1 hr 1 minute',
    'Party 11pm for 2 hours', 'Trip fri 9am for 2 days', 'Retreat sat 9am for 1 week', 'Trip 9am for 1d', 'Shift for 90 minutes 3pm', 'Lunch fri for 1h',
    '30 min run', 'Run for one hour', 'Run for 1 wk', 'Run for 2 dogs', 'Run for 0 min', 'Call 2-3pm for 2h', 'Call 2pm no end for 1h',
    'Call for 1h 2-3pm', 'Call for 1h 2pm no end'].map(text => line(text)),
  line('Study fri 3pm for 1h', 'task'),
  // An event's span of days (SV-111, D292): all day with no time, one event with a time at each end,
  // a daily repeat until the last day with one time; backwards stays words, and a task's line keeps it.
  ...['Trip oct 23–25', 'Trip oct 23 to 25', 'Trip oct 30 – nov 2', 'Trip dec 30 - jan 2', 'Trip fri to sun', 'Trip fri through sun', 'Trip from fri to sun',
    'Trip fri to mon', 'Trip 10/23 - 10/25', 'Trip fri 7pm to sun 3pm', 'Conference oct 23–25 9am–5pm', 'Camp fri to sun 9am', 'Camp fri 9am to sun',
    'Camp oct 23–25 for 2h', 'Standup weekly nov 2 to nov 30 9am', 'Trip oct 25–23', 'Trip oct 25 – oct 23', 'Trip 10/25/2026 - 10/23/2026',
    'Trip fri 7pm to fri 3pm', 'Meet oct 3 to 5pm', 'Dinner fri 7pm to 9pm'].map(text => line(text)),
  line('Pack fri to sun', 'task'),
  line('Pack fri 7pm to sun 3pm', 'task'),
  // Repeats.
  ...['daily', 'weekly', 'monthly', 'yearly', 'annually', 'biweekly', 'every day', 'every week', 'every month', 'every year', 'every 2 weeks',
    'every 3 days', 'every other mon', 'every mon, wed and fri', 'every tue and thu', 'every weekday', 'every weekend',
    'first mon of every month', 'last fri of every month', 'every mon 7am', 'weekly fri 6pm', 'every weekday at 9:30am'].map(phrase => line(`Practice ${phrase}`)),
  // "@" places: up to the next phrase, a link, a comma, or the picked text.
  line('Coffee @Blue Door at 3pm'),
  line('Coffee @Blue Door tomorrow 3pm'),
  line('Coffee @Blue Door, then errands'),
  line('Call @https://zoom.us/j/1. at 9am'),
  line('Lunch @www.example.com fri'),
  line('Coffee @Blue Door Cafe and friends', 'event', {pickedPlace: 'Blue Door Cafe'}),
  line('Dinner @Blue Door, Seattle fri 7pm', 'event', {pickedPlace: 'Blue Door, Seattle'}),
  line('Coffee @Blue Door Cafe tmr', 'event', {pickedPlace: 'Blue Door'}),
  // "#" on an event: a calendar.
  line('Lecture #classes tmr 6pm'),
  line('Lecture #cl 6pm'),
  line('Interview #Jobs fri @Contoso'),
  line('Review #1 priority'),
  line('Seminar #Classes, fri', 'event', {pickedHash: 'Classes'}),
  // "#" on a task: a project.
  line('Pay rent #home tmr', 'task'),
  line('Lab report #School fri 5pm', 'task'),
  line('Buy milk #Groceries', 'task'),
  line('Buy milk #Groceries tomorrow', 'task'),
  line('Plan #Side Project fri', 'task', {pickedHash: 'Side Project'}),
  line('Call mom #home, tmr', 'task'),
  line('Water plants every mon #Home', 'task'),
  line('#1 priority report', 'task'),
  // "cal …".
  line('Interview cal Jobs fri 10am'),
  line('Study cal Classes'),
  line('cal Personal Dentist oct 20 2:30pm'),
  line('Study cal classes #Jobs'),
  // Everything at once, and offsets past an emoji (UTF-16).
  line('Dinner with Sam fri 7-9pm @Blue Door cal Personal every week'),
  line('🎉 Party fri 8pm @Blue Door'),
  line('Pay rent on fri at noon for', 'task'),
  // The menus and picks.
  ...[['Lunch #', '#'], ['Lunch @', '@'], ['Lunch @B', '@'], ['Lunch @Bl', '@'], ['Lunch#', '#'], ['#', '#']]
    .map(([text, trigger]): Case => ({fn: 'bareToken', input: {text, trigger}})),
  {fn: 'completeToken', input: {text: 'Coffee @blu fri', start: 7, end: 11, name: 'Blue Door'}},
  {fn: 'completeToken', input: {text: 'Coffee @blu, fri', start: 7, end: 12, name: 'Blue Door'}},
  {fn: 'completeToken', input: {text: 'Pay rent #ho', start: 9, end: 12, name: 'Home'}},
  {fn: 'lineWithTitle', input: {text: 'Coffee fri', marks: [{start: 7, end: 10, kind: 'when'}], title: 'Coffee with Ana'}},
  {fn: 'lineWithTitle', input: {text: 'Coffee fri 3pm @Blue Door', marks: [{start: 7, end: 14, kind: 'when'}, {start: 15, end: 25, kind: 'place'}], title: ''}},
  {fn: 'lineWithTitle', input: {text: 'fri', marks: [{start: 0, end: 3, kind: 'when'}], title: 'Coffee '}},
  // Editing (SV-90): only what the edit typed is read.
  edited('Work', 'Work'),
  edited('Work', 'Work at 3:45a'),
  edited('Call fri', 'Call fri 3pm'),
  edited('Standup 9am', 'Standup 10am'),
  edited('Lunch at noon', 'Team lunch at noon'),
  edited('Dinner @Home', 'Dinner @Home #jobs tmr'),
  edited('Work', 'tomorrow 3pm'),
  edited('Gym', 'Gym weekly'),
  edited('Pay rent', 'Pay rent #home fri 5pm', 'task'),
  {fn: 'typedSpan', input: {before: 'Work', after: 'Work at 3:45a'}},
  {fn: 'typedSpan', input: {before: 'Standup 9am', after: 'Standup 10am'}},
  {fn: 'editedWhen', input: {item: {date: '2026-10-14', start: 180, end: 480, days: 1}, read: {date: null, start: 225, end: null}, kind: 'event'}},
  {fn: 'editedWhen', input: {item: {date: '2026-10-14', start: 180, end: 480, days: 1}, read: {date: '2026-10-16', start: null, end: null}, kind: 'event'}},
  {fn: 'editedWhen', input: {item: {date: '2026-10-14', start: null, end: null, days: 2}, read: {date: null, start: 540, end: null}, kind: 'event'}},
  {fn: 'editedWhen', input: {item: {date: '2026-10-14', start: 1020, end: null, days: 1}, read: {date: '2026-10-09', start: null, end: null}, kind: 'task'}},
  // SV-111: a span typed into an edit is all day over its days; a length with no time keeps the start.
  edited('Work', 'Work oct 23–25'),
  edited('Work', 'Work for 2h'),
  {fn: 'editedWhen', input: {item: {date: '2026-10-14', start: 180, end: 480, days: 1}, read: {date: '2026-10-23', start: null, end: null, days: 3, length: null}, kind: 'event'}},
  {fn: 'editedWhen', input: {item: {date: '2026-10-14', start: 180, end: 480, days: 1}, read: {date: null, start: null, end: null, days: null, length: 60}, kind: 'event'}},
  {fn: 'editedWhen', input: {item: {date: '2026-10-14', start: null, end: null, days: 2}, read: {date: null, start: null, end: null, days: null, length: 90}, kind: 'event'}},
  // SV-112, D293: reminder phrases after "remind", "remind me" or "reminder": offsets in D291's units,
  // several joined, and moments, read before the item's day; past 4 weeks, past 10, a task with no
  // date and other words stay words.
  ...['Call mom remind me 1h before', 'Call mom remind 30 mins before', 'Call mom reminder 2 hours after', 'Call mom remind at start',
    'Call mom remind 1 day and 10 mins before', 'Call mom remind 1 day, 1h and 10 min before', 'Call mom remind 1h before and 30 min after',
    'Call mom remind 1.5h before', 'Call mom remind 1 hour 20mins before', 'Call mom remind 1h30 before', 'Call mom remind 2 hrs before',
    'Call mom remind 2d before', 'Call mom remind 1 week before', 'Call mom remind 4 weeks after', 'Call mom remind sun 8pm',
    'Trip fri remind tomorrow 9am', 'Dinner fri 7pm remind at 6pm', 'Dinner remind me 6pm fri 7pm', 'Dinner oct 20 7pm remind on oct 19 at 8:30pm',
    'Exam fri 3pm remind 1 day before and fri 2pm', 'Call remind 1h before remind me 2 hours after', 'Coffee @Blue Door remind 1h before',
    'Trip nov 10–12 remind oct 13 1am', 'Call remind nov 4 9am',
    'Call remind', 'Call remind me', 'Send reminder email', 'remind me to call Sam', 'Call remember 1h before', 'Call remind 1h',
    'Call remind one hour before', 'Call remind 1 wk before', 'Call remind 5 weeks before', 'Call remind 4 weeks 1 min after',
    'Call remind 1h and 5 weeks before', 'Call remind sun', 'Trip dec 20 remind sun 8pm', 'Trip nov 10–12 remind oct 12 11pm', 'Call remind nov 4 9:01am',
    `Call remind ${Array.from({length: 11}, (_, index) => `${index + 1} min`).join(', ')} before`].map(text => remind(text)),
  remind('Call remind 1h before remind 2h before', 'event', {...REMIND, kept: 9}),
  remind('Call nov 4 remind oct 7 8am', 'event', {day: TODAY, time: 420}),
  remind('Pay rent fri remind 1h before', 'task'),
  remind('Pay rent fri remind 1h before', 'task', {day: TODAY, time: 1080}),
  remind('Pay rent remind 1h before', 'task', null),
  remind('Pay rent remind sun 8pm', 'task', null),
  // Without remind, as an app that doesn't read them yet: the phrase stays words, its day not the item's.
  line('Call mom remind sun 8pm'),
  line('Work remind 1h before', 'event', {edit: {before: 'Work', day: '2026-10-14'}, remind: {day: '2026-10-14', time: 540}}),
  // SV-113, D294: days counted from today, on a Monday, a Saturday that ends a month, a Sunday and month ends.
  ...['in 3 days', 'in 2 weeks', 'in 1 month', 'next week', 'this weekend', 'weekend', 'next weekend', 'end of week', 'end of the month',
    'eom', 'end of next month', 'on end of month', 'in 3 hours', 'in 0 days'].map(phrase => lineOn(`Lunch ${phrase}`, '2026-10-26', 'task')),
  ...['this weekend', 'next weekend', 'next week', 'end of week', 'end of month', 'in 1 month'].map(phrase => lineOn(`Lunch ${phrase}`, '2026-10-31', 'task')),
  ...['next week', 'this weekend', 'end of week'].map(phrase => lineOn(`Lunch ${phrase}`, '2026-11-01', 'task')),
  lineOn('Lunch in 1 month', '2027-01-31', 'task'),
  lineOn('Lunch end of next month', '2026-12-15', 'task'),
  // An event's weekend is all day Saturday–Sunday with no time, Saturday at a time typed.
  ...['Hike this weekend', 'Hike this weekend 9am', 'Hike next weekend', 'Review in 3 days 2pm', 'Trip fri to end of month'].map(text => lineOn(text, '2026-10-26')),
  // When a repeat ends: until a day, a count (an event's), for a while from the first; without a repeat, words.
  ...['Standup every mon until dec 15', 'Standup every mon 9am until dec 15', 'Gym daily until fri', 'Gym every day until end of month',
    'Gym every day until next week', 'Class every tue and thu until 12/10', 'Gym every day 6 times', 'Gym every day for 6 times',
    'Gym every day for 2 weeks', 'Gym every mon for 4 weeks', 'Rent monthly for 3 months', 'Gym every fri 7am for 2 weeks', 'Gym every day 7am for 1h',
    'Party until dec 15', 'Stretch 6 times', 'Trip for 2 months', 'Gym until dec 15 every mon', 'Gym every fri until thu', 'Gym every day 3 times until fri'].map(text => lineOn(text, '2026-10-26')),
  ...['Water plants every mon until dec 15', 'Vitamins every day for 2 weeks', 'Vitamins every day 6 times'].map(text => lineOn(text, '2026-10-26', 'task')),
  line('Gym daily for 2 weeks', 'event', {edit: {before: 'Gym', day: '2026-10-14'}}),
  // D298: a length in whole days with no time is all day over them; hours, part days and a time stay timed.
  ...['Trip fri for 3 days', 'Retreat for 1 week', 'Camp this weekend for 3 days', 'Trip fri for 1.5 days', 'Trip fri for 1 day 3h'].map(text => lineOn(text, '2026-10-26')),
  line('Work remind at 8am', 'event', {edit: {before: 'Work', day: '2026-10-14'}, remind: {day: '2026-10-14', time: 540}}),
  line('Call remind 1h before fri', 'event', {edit: {before: 'Call remind 1h before', day: '2026-10-14'}, remind: {day: '2026-10-14', time: 540}}),
  // SV-114: What the line reads (reference.json), each example as lineReference.test.ts reads it; a
  // row with a phrase kept as words needs the client's own hiding of it, so it isn't a case here.
  ...LINE_REFERENCE.flatMap(section => section.rows).filter(row => !row.plain).map(row => remind(row.example, row.kind)),
];

async function bundle(): Promise<string> {
  const out = await build({
    configFile: false, root: WEB, logLevel: 'silent',
    build: {
      write: false, target: 'es2020', minify: false,
      lib: {entry: 'src/logic/composeApp.ts', name: 'SetpointCompose', formats: ['iife'], fileName: () => 'compose.js'},
      rolldownOptions: {output: {banner: HEADER}},
    },
  }) as Rolldown.RolldownOutput[];
  return out[0]!.output[0].code;
}

/** The bundle's global, run as JavaScriptCore would: a bare context with no module loader and no DOM. */
function load(code: string): typeof app {
  const context = vm.createContext({});
  vm.runInContext(code, context, {filename: 'compose.js'});
  return vm.runInContext('SetpointCompose', context) as typeof app;
}

// JSON through text, so values from the bare context compare as plain data.
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? 'null');

const table = () => ({
  about: 'What shared/compose/compose.js (SetpointCompose) returns for each input, recorded by web/tests/composeBundle.test.ts (npm run compose:record) from web/src/logic/compose.ts. Today is the seed\'s Wed, Oct 7, 2026; the calendars are its Google calendars and the projects its Todoist projects; an edited item (SV-90) is on Wed, Oct 14. The iPhone app runs every case through its JavaScriptCore copy of the bundle and expects the same output.',
  cases: CASE_LIST.map(({fn, input}) => ({fn, input, output: plain(FUNCTIONS[fn](input as never))})),
});

describe('the compose bundle for the iPhone app', async () => {
  const code = await bundle();
  if (RECORDING) {
    fs.mkdirSync(DIR, {recursive: true});
    fs.writeFileSync(BUNDLE, code);
    fs.writeFileSync(CASES, `${JSON.stringify(table(), null, 2)}\n`);
  }

  test('the committed bundle is built from compose.ts as it is', () => {
    expect(fs.readFileSync(BUNDLE, 'utf8') === code, 'compose.ts changed: once setpoint-ios handles it, npm run compose:record and pin the new commit there.').toBe(true);
  });

  test('the committed table is what compose.ts returns', () => {
    expect(JSON.parse(fs.readFileSync(CASES, 'utf8')), 'npm run compose:record, once setpoint-ios handles the change.').toEqual(table());
  });

  test('the committed bundle, on its own, returns every case in the table', () => {
    const compose = load(fs.readFileSync(BUNDLE, 'utf8'));
    const {cases} = JSON.parse(fs.readFileSync(CASES, 'utf8')) as {cases: {fn: Case['fn']; input: unknown; output: unknown}[]};
    for (const {fn, input, output} of cases) {
      expect(plain(compose[fn](input as never)), `${fn} ${JSON.stringify(input)}`).toEqual(output);
      expect(JSON.parse(compose.call(fn, JSON.stringify(input))), `call ${fn}`).toEqual(output);
    }
  });

  test('the table covers each function', () => {
    expect(new Set(CASE_LIST.map(one => one.fn))).toEqual(new Set(Object.keys(FUNCTIONS)));
  });
});
