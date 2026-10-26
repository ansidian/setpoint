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
//     pickedPlace?: string|null, pickedHash?: string|null, edit?: {before, day: "YYYY-MM-DD"}|null})
//     → {title, marks: [{start, end, kind: "when"|"place"|"calendar"|"project"}], date, start, end,
//        place, calendar, recurrence, project, days, length}
//     (edit: an item's title before it was edited, and its day; only what the edit typed is read)
//     (days: an event's all-day span of days, first and last counting, else null; length: minutes a
//      "for" length read, else null, the end already counting it when a start was read, and with
//      none the event starts at the default start, the slot's else 9:00 AM; SV-111)
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

const line = (text: string, kind: Kind = 'event', picked: {pickedPlace?: string; pickedHash?: string; edit?: {before: string; day: string}} = {}): Case =>
  ({fn: 'parseTitle', input: {text, kind, today: TODAY, calendars: CALENDARS, projects: PROJECTS, ...picked}});
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
