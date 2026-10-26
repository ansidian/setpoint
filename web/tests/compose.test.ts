// The editor's title parsing as tables (DESIGN.md › Editor; board 13), with v1's
// `parseCalendarTitle.test.ts` cases carried over through the harvest gate (darma SV-15). Today is
// the seed's Wed, Oct 7, 2026.
import {REMINDER_LIMIT_MINUTES} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {REMINDER_LINE_LIMITS, bareToken, clockLabel, completeToken, lineWithTitle, describeRule, describeTaskRepeat, draftStarted, editedWhen, endChoices, extraDays, parseClock, parseDay, parseDays, parseEnd, parseTitle, readEnd, repeatChoices, spanTo, taskRepeat, taskRepeatChoices, timeChoices, typedSpan} from '../src/logic/compose.ts';

const TODAY = '2026-10-07';
const CALENDARS = ['Personal', 'Classes', 'Jobs'];
const h = (hour: number, minute = 0) => hour * 60 + minute;
const parse = (text: string) => parseTitle(text, TODAY, CALENDARS);
/** The marked parts of the text, as typed. */
const marked = (text: string) => parse(text).marks.map(mark => `${mark.kind}:${text.slice(mark.start, mark.end)}`);

describe('board 13', () => {
  test('Dinner with Sam fri 7-9pm @Blue Door', () => {
    const text = 'Dinner with Sam fri 7-9pm @Blue Door';
    expect(parse(text)).toMatchObject({title: 'Dinner with Sam', date: '2026-10-09', start: h(19), end: h(21), place: 'Blue Door', calendar: null, recurrence: null});
    expect(marked(text)).toEqual(['when:fri 7-9pm', 'place:@Blue Door']);
  });
  test('Gym sat 9am (the batch draft)', () => {
    expect(parse('Gym sat 9am')).toMatchObject({title: 'Gym', date: '2026-10-10', start: h(9), end: null});
    expect(marked('Gym sat 9am')).toEqual(['when:sat 9am']);
  });
});

describe('titles that hold no phrase stay as typed (v1: ordinary typing)', () => {
  test.each([
    'Dentist', 'Gym 7', 'Dinner at 7', 'Call Sam', 'Wedding planning', 'Contoso University visit', 'Room 2026', 'Mayday drill', '@', '@x',
  ])('%s', text => {
    const parsed = parse(text);
    expect(parsed.title).toBe(text);
    expect(parsed.marks).toEqual([]);
    expect([parsed.date, parsed.start, parsed.place, parsed.recurrence]).toEqual([null, null, null, null]);
  });
});

describe('days', () => {
  test.each([
    ['today', '2026-10-07'], ['tonight', '2026-10-07'], ['tomorrow', '2026-10-08'], ['tmr', '2026-10-08'], ['tmrw', '2026-10-08'],
    // A weekday is the next one, today counting; "next" is the one after.
    ['wed', '2026-10-07'], ['thu', '2026-10-08'], ['friday', '2026-10-09'], ['mon', '2026-10-12'], ['tues', '2026-10-13'], ['this fri', '2026-10-09'],
    ['next fri', '2026-10-16'], ['next wed', '2026-10-14'], ['on sat', '2026-10-10'],
    ['oct 12', '2026-10-12'], ['October 12th', '2026-10-12'], ['12 oct', '2026-10-12'], ['nov 1', '2026-11-01'], ['dec 9, 2026', '2026-12-09'],
    // Already past this year: next year's.
    ['oct 1', '2027-10-01'], ['jan 5', '2027-01-05'],
    ['10/12', '2026-10-12'], ['10/12/26', '2026-10-12'], ['3/4/2027', '2027-03-04'], ['2026-10-30', '2026-10-30'],
  ])('Lunch %s → %s', (phrase, date) => {
    const parsed = parse(`Lunch ${phrase}`);
    expect(parsed.date).toBe(date);
    expect(parsed.title).toBe('Lunch');
  });
  test.each(['Lunch 2/30', 'Lunch 13/1', 'Lunch feb 30'])('%s is no day', text => expect(parse(text).date).toBeNull());
});

describe('times', () => {
  test.each([
    ['7pm', h(19), null], ['7 pm', h(19), null], ['7:30pm', h(19, 30), null], ['7:30 PM', h(19, 30), null], ['at 7pm', h(19), null], ['19:00', h(19), null],
    ['7:30', h(7, 30), null], ['noon', h(12), null], ['midnight', 0, null], ['12am', 0, null], ['12pm', h(12), null], ['9a', h(9), null],
    // Ranges: the missing am/pm follows the other end.
    ['7-9pm', h(19), h(21)], ['7pm-9pm', h(19), h(21)], ['7 - 9 pm', h(19), h(21)], ['7 to 9pm', h(19), h(21)], ['from 9 to 5pm', h(9), h(17)],
    ['11-1pm', h(11), h(13)], ['9am-5', h(9), h(17)], ['10:30-11:15am', h(10, 30), h(11, 15)], ['9:00-10:30', h(9), h(10, 30)], ['13-15', h(13), h(15)],
    // Past midnight: the next day's.
    ['11pm-1am', h(23), h(25)],
    // An end at the start is No end (SV-78), not the next day's (SV-108, D286).
    ['2pm to 2pm', h(14), h(14)], ['at 2pm to 2pm', h(14), h(14)], ['2-2pm', h(14), h(14)], ['2pm-2', h(14), h(14)], ['14:00–14:00', h(14), h(14)],
    // "no end" by a time, either side of it (SV-108).
    ['2pm no end', h(14), h(14)], ['no end 2pm', h(14), h(14)], ['no end at 2pm', h(14), h(14)], ['noon No End', h(12), h(12)],
  ])('Meet %s', (phrase, start, end) => {
    const parsed = parse(`Meet ${phrase}`);
    expect([parsed.start, parsed.end]).toEqual([start, end]);
    expect(parsed.title).toBe('Meet');
  });
  test.each(['Meet 7-9', 'Meet 13pm', 'Meet 7:75pm', 'Meet at 7'])('%s holds no time', text => expect(parse(text).start).toBeNull());
  test('a bare time keeps no date (the editor gives it the selected day, as v1 did)', () => expect(parse('Standup 9am')).toMatchObject({date: null, start: h(9)}));
  test.each([
    ['Call Sam 2pm no end', 'Call Sam', ['when:2pm no end']],
    ['Call Sam no end 2pm fri', 'Call Sam', ['when:no end 2pm fri']],
    ['event at 2pm to 2pm', 'event', ['when:at 2pm to 2pm']],
  ])('SV-108: %s is No end, lit with its time', (text, title, marks) => {
    expect(parse(text)).toMatchObject({title, start: h(14), end: h(14)});
    expect(marked(text)).toEqual(marks);
  });
  test.each([
    // Only the phrase itself, and only by a time: otherwise it's the title's.
    ['Call Sam no end', null, null], ['Fix the no end bug', null, null], ['Call no ending 2pm', h(14), null], ['Call 2pm noend', h(14), null],
    ['Call 2pm, no end', h(14), null],
  ])('SV-108: %s reads no No end', (text, start, end) => expect([parse(text).start, parse(text).end]).toEqual([start, end]));
});

describe('places (v1: @ starts a place, up to the next phrase)', () => {
  test.each([
    ['Dinner @Blue Door', 'Dinner', 'Blue Door', ['place:@Blue Door']],
    ['Dinner @Blue Door fri 7pm', 'Dinner', 'Blue Door', ['place:@Blue Door', 'when:fri 7pm']],
    ['Dinner @Blue Door at 7pm', 'Dinner', 'Blue Door', ['place:@Blue Door', 'when:at 7pm']],
    ['Dinner @Blue Door cal Personal', 'Dinner', 'Blue Door', ['place:@Blue Door', 'calendar:cal Personal']],
    ['@Smile Dental Dentist', '', 'Smile Dental Dentist', ['place:@Smile Dental Dentist']],
    // A comma ends a typed place and goes with it (SV-27).
    ['Dinner @Blue Door, bring wine', 'Dinner bring wine', 'Blue Door', ['place:@Blue Door,']],
    ['Dinner @Blue Door , bring wine fri 7pm', 'Dinner bring wine', 'Blue Door', ['place:@Blue Door ,', 'when:fri 7pm']],
    // v1: plain "at" doesn't start a place.
    ['Lunch at Blue Door', 'Lunch at Blue Door', null, []],
  ])('%s', (text, title, place, marks) => {
    expect(parse(text)).toMatchObject({title, place});
    expect(marked(text)).toEqual(marks);
  });
  test('a second @ stays in the title', () => expect(parse('A @One @Two')).toMatchObject({place: 'One', title: 'A @Two'}));
  // SV-27: once a suggestion is picked for "mcd", what's typed after it is the title's again.
  test.each([
    ['Lunch @mcd bring wine', 'mcd', 'Lunch bring wine', 'mcd', ['place:@mcd']],
    ['Lunch @mcd bring wine fri', 'mcd', 'Lunch bring wine', 'mcd', ['place:@mcd', 'when:fri']],
    // A link ends at a space, picked or not (punctuation after it isn't part of it).
    ['Standup @https://zoom.us/j/123 with team', null, 'Standup with team', 'https://zoom.us/j/123', ['place:@https://zoom.us/j/123']],
    ['Standup @https://zoom.us/j/123, with team', null, 'Standup with team', 'https://zoom.us/j/123', ['place:@https://zoom.us/j/123,']],
    ['Lunch @mcd, bring wine', 'mcd', 'Lunch bring wine', 'mcd', ['place:@mcd,']],
    ['Standup @www.example.com/call fri', null, 'Standup', 'www.example.com/call', ['place:@www.example.com/call', 'when:fri']],
    // The picked text changed: the place runs on as before.
    ['Lunch @mcdo bring wine', 'mcd', 'Lunch', 'mcdo bring wine', ['place:@mcdo bring wine']],
    // SV-29: a picked name keeps its own comma.
    ['Lunch @Blue Door, Sunset bring wine', 'Blue Door, Sunset', 'Lunch bring wine', 'Blue Door, Sunset', ['place:@Blue Door, Sunset']],
  ])('%s, picked for %j', (text, picked, title, place, marks) => {
    const parsed = parseTitle(text, TODAY, CALENDARS, picked);
    expect(parsed).toMatchObject({title, place});
    expect(parsed.marks.map(mark => `${mark.kind}:${text.slice(mark.start, mark.end)}`)).toEqual(marks);
  });
});

describe('a task\'s #project (SV-25)', () => {
  const PROJECTS = ['Inbox', 'School', 'Home', 'Home Repairs'];
  test.each<[string, string | null, string, string | null, string[]]>([
    // The longest project name it starts with, any case; the rest is the title's.
    ['Pay rent #Home now', null, 'Pay rent now', 'Home', ['project:#Home']],
    ['Pay rent #home now', null, 'Pay rent now', 'Home', ['project:#home']],
    ['Fix sink #home repairs fri', null, 'Fix sink', 'Home Repairs', ['project:#home repairs', 'when:fri']],
    ['Study #School, then rest', null, 'Study then rest', 'School', ['project:#School,']],
    // A name it only starts a word of isn't that project: an unknown name runs on, as a place does.
    ['Draft #Homework plan', null, 'Draft', 'Homework plan', ['project:#Homework plan']],
    ['Draft #Side gig plan fri 3pm', null, 'Draft', 'Side gig plan', ['project:#Side gig plan', 'when:fri 3pm']],
    ['Draft #Side gig, plan it', null, 'Draft plan it', 'Side gig', ['project:#Side gig,']],
    ['Call #Side gig @Blue Door', null, 'Call', 'Side gig', ['project:#Side gig', 'place:@Blue Door']],
    // A pick ends it at the text it was made for.
    ['Draft #sid plan', 'sid', 'Draft plan', 'sid', ['project:#sid']],
    ['Call #', null, 'Call #', null, []],
  ])('%s (picked for %j)', (text, picked, title, project, marks) => {
    const parsed = parseTitle(text, TODAY, CALENDARS, null, {kind: 'project', names: PROJECTS, picked});
    expect(parsed).toMatchObject({title, project});
    expect(parsed.marks.map(mark => `${mark.kind}:${text.slice(mark.start, mark.end)}`)).toEqual(marks);
  });
  test('# stops a place only while projects or calendars are read', () => {
    expect(parseTitle('Fix @Blue Door #Home', TODAY, [], null, {kind: 'project', names: PROJECTS, picked: null})).toMatchObject({place: 'Blue Door', project: 'Home', title: 'Fix'});
    expect(parse('Fix @Blue Door #2')).toMatchObject({place: 'Blue Door #2', project: null});
  });
});

describe('an event\'s #calendar (SV-25 D57)', () => {
  // In the list's order; two accounts can each have a Personal.
  const NAMES = ['Personal', 'School', 'Work', 'Work Shifts', 'Personal'];
  test.each<[string, string | null, string, string | null, string[]]>([
    // The user's mock.
    ['dinner with sam at 6-9pm #school', null, 'dinner with sam', 'School', ['when:at 6-9pm', 'calendar:#school']],
    // The longest text a calendar's name starts with, ending a word; the first such calendar.
    ['Lab #sch notes', null, 'Lab notes', 'School', ['calendar:#sch']],
    ['Shift #work shifts fri', null, 'Shift', 'Work Shifts', ['calendar:#work shifts', 'when:fri']],
    ['Plan #work stuff', null, 'Plan stuff', 'Work', ['calendar:#work']],
    ['Lunch #personal', null, 'Lunch', 'Personal', ['calendar:#personal']],
    ['Call #school, then rest', null, 'Call then rest', 'School', ['calendar:#school,']],
    // A #word no calendar's name starts with stays in the title.
    ['Ship #1 priority', null, 'Ship #1 priority', null, []],
    ['Ship #schedule', null, 'Ship #schedule', null, []],
    // A pick ends it at the text it was made for.
    ['Lab #sc notes', 'sc', 'Lab notes', 'sc', ['calendar:#sc']],
    // "#" ends a place; "cal …" still works, and the first calendar named wins.
    ['Dinner @Blue Door #school', null, 'Dinner', 'School', ['place:@Blue Door', 'calendar:#school']],
    ['Lecture cal Personal #school', null, 'Lecture #school', 'Personal', ['calendar:cal Personal']],
  ])('%s (picked for %j)', (text, picked, title, calendar, marks) => {
    const parsed = parseTitle(text, TODAY, NAMES, null, {kind: 'calendar', names: NAMES, picked});
    expect(parsed).toMatchObject({title, calendar, project: null});
    expect(parsed.marks.map(mark => `${mark.kind}:${text.slice(mark.start, mark.end)}`)).toEqual(marks);
  });
});

describe('calendars (v1\'s "cal", now only by a calendar\'s name)', () => {
  test.each([
    ['Lecture cal classes', 'Lecture', 'Classes'],
    ['Interview cal Jobs fri 2pm', 'Interview', 'Jobs'],
    ['Contoso University visit', 'Contoso University visit', null],
    ['Lecture cal', 'Lecture cal', null],
  ])('%s', (text, title, calendar) => expect(parse(text)).toMatchObject({title, calendar}));
});

describe('repeats (v1\'s recurrence clauses)', () => {
  test.each([
    ['Gym every mon wed fri 7am', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-10-07', h(7)],
    ['Gym every mon, wed and fri', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-10-07', null],
    ['Gym 7am every fri', 'RRULE:FREQ=WEEKLY;BYDAY=FR', '2026-10-09', h(7)],
    ['Lecture every tue thu', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', '2026-10-08', null],
    ['Standup every weekday 9am', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '2026-10-07', h(9)],
    ['Hike every weekend', 'RRULE:FREQ=WEEKLY;BYDAY=SA,SU', '2026-10-10', null],
    ['Vitamins every day', 'RRULE:FREQ=DAILY', null, null],
    ['Vitamins daily', 'RRULE:FREQ=DAILY', null, null],
    ['Review weekly fri', 'RRULE:FREQ=WEEKLY;BYDAY=FR', '2026-10-09', null],
    ['Review weekly', 'RRULE:FREQ=WEEKLY;BYDAY=WE', null, null],
    ['Rent every month', 'RRULE:FREQ=MONTHLY', null, null],
    ['Rent monthly', 'RRULE:FREQ=MONTHLY', null, null],
    ['Taxes yearly', 'RRULE:FREQ=YEARLY', null, null],
    ['Taxes annually', 'RRULE:FREQ=YEARLY', null, null],
    ['Payday biweekly fri', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', '2026-10-09', null],
    ['Payday every other fri', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', '2026-10-09', null],
    ['Payday every 2 weeks', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE', null, null],
    ['Haircut every 3 months', 'RRULE:FREQ=MONTHLY;INTERVAL=3', null, null],
    ['Book club first mon of every month', 'RRULE:FREQ=MONTHLY;BYDAY=1MO', null, null],
    ['Book club last fri of every month', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR', null, null],
  ])('%s', (text, recurrence, date, start) => {
    const parsed = parse(text);
    expect(parsed).toMatchObject({recurrence, date, start});
    expect(parsed.marks.filter(mark => mark.kind === 'when')).toHaveLength(1);
  });
});

describe('the date and time fields', () => {
  test.each([
    ['Fri, Oct 9', '2026-10-09'], ['Fri, Oct 16', '2026-10-16'], ['fri', '2026-10-09'], ['oct 12', '2026-10-12'], ['10/12', '2026-10-12'],
    ['tomorrow', '2026-10-08'], ['soon', null], ['', null], ['oct 12 7pm', null],
  ])('date %s', (text, date) => expect(parseDay(text, TODAY)).toBe(date));
  test.each([
    ['7:00 PM', null, h(19)], ['7pm', null, h(19)], ['19:00', null, h(19)], ['7', h(19), h(19)], ['7:30', h(8), h(7, 30)], ['9', null, null], ['later', null, null],
    // SV-25: shorthand, in the fields only ("Room 2026" in the line stays a title).
    ['3p', null, h(15)], ['330p', null, h(15, 30)], ['930a', null, h(9, 30)], ['930 am', null, h(9, 30)], ['1230p', null, h(12, 30)], ['2130', null, h(21, 30)],
    ['930', h(19), h(21, 30)], ['0930', null, h(9, 30)], ['2460', null, null], ['1360p', null, null], ['3m', null, null],
  ])('time %s (from %s)', (text, from, minutes) => expect(parseClock(text, from)).toBe(minutes));
  test.each([
    ['9:00 PM', h(19), h(20), h(21)], ['9', h(19), h(20), h(21)], ['1:00 AM', h(23), h(24), h(25)], ['7:00 PM', h(19), h(20), h(43)], ['later', h(19), h(20), null],
  ])('end %s (start %i)', (text, start, end, minutes) => expect(parseEnd(text, start, end)).toBe(minutes));
  test.each([[h(19), '7:00 PM'], [0, '12:00 AM'], [h(12, 5), '12:05 PM'], [h(25), '1:00 AM']])('%i is %s', (minutes, label) => expect(clockLabel(minutes)).toBe(label));
  test('SV-25: the Start list is the day in 15-minute steps', () => {
    const list = timeChoices();
    expect([list.length, list[0], list[1], list.at(-1)]).toEqual([96, {minutes: 0, label: '12:00 AM'}, {minutes: 15, label: '12:15 AM'}, {minutes: h(23, 45), label: '11:45 PM'}]);
  });
  test('SV-25: the End list starts after the start, with lengths', () => {
    const list = timeChoices(h(9));
    expect(list.slice(0, 6).map(choice => choice.label)).toEqual([
      '9:15 AM (15 min)', '9:30 AM (30 min)', '9:45 AM (45 min)', '10:00 AM (1 hr)', '10:15 AM (1.25 hrs)', '10:30 AM (1.5 hrs)',
    ]);
    expect(list.at(-1)).toEqual({minutes: h(33), label: '9:00 AM (24 hrs)'});
  });
});

describe('the repeat field', () => {
  test.each([
    [null, 'Does not repeat'],
    ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', 'Weekly on Mon, Wed, Fri'],
    ['RRULE:FREQ=WEEKLY', 'Weekly on Wednesday'],
    ['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', 'Every 2 weeks on Friday'],
    ['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday'],
    ['RRULE:FREQ=DAILY', 'Daily'],
    ['RRULE:FREQ=DAILY;INTERVAL=3', 'Every 3 days'],
    ['RRULE:FREQ=MONTHLY', 'Monthly on day 7'],
    ['RRULE:FREQ=MONTHLY;BYDAY=1MO', 'Monthly on the first Monday'],
    ['RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'Monthly on the last Friday'],
    ['RRULE:FREQ=YEARLY', 'Yearly on Oct 7'],
    ['RRULE:FREQ=HOURLY', 'Custom repeat'],
  ])('%s', (rule, label) => expect(describeRule(rule, TODAY)).toBe(label));
  test('choices for Wed, Oct 7 keep the event\'s own rule', () => {
    expect(repeatChoices(TODAY, 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR').map(choice => choice.label)).toEqual([
      'Does not repeat', 'Daily', 'Weekly on Wednesday', 'Every weekday', 'Monthly on day 7', 'Yearly on Oct 7', 'Weekly on Mon, Wed, Fri',
    ]);
  });
});

describe('F6b: a task\'s repeat, in Todoist\'s words', () => {
  test.each([
    ['Wed, Oct 7', TODAY, null, ['Does not repeat', 'Every day', 'Every Wednesday', 'Every weekday', 'Every month', 'Every year']],
    ['Sun, Oct 11 keeps the task\'s own', '2026-10-11', 'every other fri', ['Does not repeat', 'Every day', 'Every Sunday', 'Every weekday', 'Every month', 'Every year', 'Every other Friday']],
    ['its own already listed', TODAY, 'every wed', ['Does not repeat', 'Every day', 'Every Wednesday', 'Every weekday', 'Every month', 'Every year']],
  ])('%s', (_, date, current, labels) => {
    expect(taskRepeatChoices(date, current).map(choice => choice.label)).toEqual(labels);
  });
});

describe('SV-29: a task\'s repeat names its days as words', () => {
  test.each([
    [null, 'Does not repeat'],
    ['every sat', 'Every Saturday'],
    ['every tues', 'Every Tuesday'],
    ['every 1st mon', 'Every 1st Monday'],
    ['every tue, thu, sat', 'Every Tue, Thu, Sat'],
    ['every monday, friday', 'Every Monday, Friday'],
    ['every sat at 9am', 'Every Saturday at 9am'],
    ['every weekday', 'Every weekday'],
    ['every 2 weeks', 'Every 2 weeks'],
    ['every month on the 3rd', 'Every month on the 3rd'],
  ])('%s', (repeat, label) => expect(describeTaskRepeat(repeat)).toBe(label));
});

describe('SV-25: a repeat typed for a task, in Todoist\'s words', () => {
  test.each([
    ['Water plants every mon', 'every mon'],
    ['Gym every mon, wed and fri', 'every mon, wed, fri'],
    ['Standup every weekday', 'every weekday'],
    ['Review weekly', 'every wed'],
    ['Vitamins daily', 'every day'],
    ['Payday every other fri', 'every other fri'],
    ['Payday biweekly fri', 'every other fri'],
    ['Haircut every 3 weeks', 'every 3 weeks'],
    ['Water every 3 days', 'every 3 days'],
    ['Rent monthly', 'every month'],
    ['Haircut every 3 months', 'every 3 months'],
    ['Book club first mon of every month', 'every 1st mon'],
    ['Book club last fri of every month', 'every last fri'],
    ['Taxes yearly', 'every year'],
    ['Taxes every 2 years', 'every 2 years'],
    ['Pay rent fri', null],
  ])('%s → %j', (text, repeat) => expect(taskRepeat(parse(text).recurrence)).toBe(repeat));
});

describe('whether a new draft has started (choice 14: E or New doesn\'t replace it then)', () => {
  const empty = {text: '', title: '', place: '', manual: [], reminders: null, recurrence: null, project: null};
  test.each([
    ['nothing typed', [empty], false],
    ['only spaces', [{...empty, text: '   '}], false],
    ['a line', [{...empty, text: 'Gym sat 9am'}], true],
    ['a title', [{...empty, title: 'Gym'}], true],
    ['a place', [{...empty, place: 'Blue Door'}], true],
    ['a time set by hand', [{...empty, manual: ['time']}], true],
    ['a reminder chosen', [{...empty, reminders: []}], true],
    ['a repeat', [{...empty, recurrence: 'RRULE:FREQ=DAILY'}], true],
    ['a project', [{...empty, project: 'Home'}], true],
    ['a second draft, both empty', [empty, empty], true],
  ])('%s: %s', (_, drafts, started) => expect(draftStarted(drafts)).toBe(started));
});

describe('SV-29: a suggestion picked for the line completes its text, then a space', () => {
  const at = (text: string, token: string) => {
    const start = text.indexOf(token);
    return [start, start + token.length] as const;
  };
  test.each([
    ['a #project at the end', 'Pay bills #hom', '#hom', 'Home', 'Pay bills #Home ', 16],
    ['a #calendar', 'Standup #wo', '#wo', 'Work', 'Standup #Work ', 14],
    ['a place in the middle keeps the space after it', 'Lunch @mcd fri', '@mcd', 'McDonald\'s', 'Lunch @McDonald\'s fri', 18],
    ['a comma typed after it stays', 'Plan trip #Travel ideas, every sat', '#Travel ideas,', 'Travel ideas', 'Plan trip #Travel ideas, every sat', 25],
    ['a new project keeps what was typed', 'Pay bills #hom', '#hom', 'hom', 'Pay bills #hom ', 15],
  ])('%s', (_, text, token, name, line, caret) => {
    const [start, end] = at(text, token);
    expect(completeToken(text, start, end, name)).toEqual({text: line, caret});
  });
});

describe('SV-71: a "#" or "@" just typed at the line\'s end opens its menu before anything is typed', () => {
  test.each<[string, string, '#' | '@', {start: number; query: string} | null]>([
    ['a lone # alone', '#', '#', {start: 0, query: ''}],
    ['a lone # after words', 'Pay bills #', '#', {start: 10, query: ''}],
    ['# with a letter is the line\'s mark', 'Pay bills #h', '#', null],
    ['# with a space after has ended', 'Pay bills # ', '#', null],
    ['# inside a word', 'C#', '#', null],
    ['a lone @', 'Lunch @', '@', {start: 6, query: ''}],
    ['@ with one letter', 'Lunch @b', '@', {start: 6, query: 'b'}],
    ['@ with two letters is Places\'', 'Lunch @bl', '@', null],
    ['@ inside an address', 'Mail me at a@', '@', null],
    ['@ with a space after has ended', 'Lunch @ ', '@', null],
  ])('%s', (_, text, trigger, expected) => {
    expect(bareToken(text, trigger)).toEqual(expected);
  });
});

describe('SV-29: an event\'s days, from its first to its last', () => {
  const h = (hours: number) => hours * 60;
  test.each([
    ['all day, one day', null, null, 1, 0],
    ['all day, three days', null, null, 3, 2],
    ['9 – 10 AM', h(9), h(10), 1, 0],
    ['11 PM – midnight stays on its day', h(23), h(24), 1, 0],
    ['11 PM – 1 AM runs into the next', h(23), h(25), 1, 1],
    ['9 AM – 5 PM two days on', h(9), h(48 + 17), 1, 2],
  ])('%s', (_, start, end, days, extra) => expect(extraDays(start, end, days)).toBe(extra));

  test.each([
    ['all day over three days', '2026-10-23', '2026-10-25', null, null, {date: '2026-10-23', end: null, days: 3}],
    ['all day back to one', '2026-10-23', '2026-10-23', null, null, {date: '2026-10-23', end: null, days: 1}],
    ['9 – 10 AM over three days: 10 AM on the last', '2026-10-23', '2026-10-25', h(9), h(10), {date: '2026-10-23', end: h(48 + 10), days: 1}],
    ['9 AM – 5 PM two days on, back to one day', '2026-10-23', '2026-10-23', h(9), h(48 + 17), {date: '2026-10-23', end: h(17), days: 1}],
    ['10 PM – 1 AM onto one day ends an hour after it starts', '2026-10-23', '2026-10-23', h(22), h(25), {date: '2026-10-23', end: h(23), days: 1}],
    ['11 PM – midnight over two days', '2026-10-23', '2026-10-24', h(23), h(24), {date: '2026-10-23', end: h(48), days: 1}],
    ['a last day before the first is the first', '2026-10-23', '2026-10-20', null, null, {date: '2026-10-23', end: null, days: 1}],
  ])('%s', (_, from, to, start, end, span) => expect(spanTo(from, to, start, end)).toEqual(span));

  test('the End list on the first day is No end, then the 24 hours after the start, with lengths (SV-78)', () => {
    expect(endChoices(h(9), h(10))).toEqual([{minutes: h(9), label: 'No end'}, ...timeChoices(h(9))]);
  });
  test('on a later last day, it\'s No end, then that day\'s times, without lengths', () => {
    const list = endChoices(h(9), h(48 + 10));
    expect(list.length).toBe(97);
    expect(list.slice(0, 3)).toEqual([{minutes: h(9), label: 'No end'}, {minutes: h(48), label: '12:00 AM'}, {minutes: h(48) + 15, label: '12:15 AM'}]);
    expect(list.at(-1)).toEqual({minutes: h(72) - 15, label: '11:45 PM'});
  });
  test.each([
    ['on the first day, as parseEnd', '11a', h(9), h(10), h(11)],
    ['on the first day, before the start is the next', '8a', h(9), h(10), h(32)],
    ['on a later day, that day\'s time', '8a', h(9), h(48 + 10), h(48 + 8)],
    ['unreadable', 'soon', h(9), h(48 + 10), null],
    ['"no end" is the start (SV-78)', 'no end', h(9), h(10), h(9)],
    ['"none" too', ' None ', h(9), h(48 + 10), h(9)],
  ])('end %s', (_, text, start, end, minutes) => expect(readEnd(text, start, end)).toBe(minutes));

  test.each([
    ['a day keeps the length', 'Oct 23', {from: '2026-10-23', to: null}],
    ['as the field shows it', 'Fri, Oct 23 – Sun, Oct 25', {from: '2026-10-23', to: '2026-10-25'}],
    ['a hyphen with spaces', 'oct 23 - oct 25', {from: '2026-10-23', to: '2026-10-25'}],
    ['"to"', 'fri to sun', {from: '2026-10-09', to: '2026-10-11'}],
    ['the last day read from the first', 'Dec 30 – Jan 2', {from: '2026-12-30', to: '2027-01-02'}],
    ['nonsense', 'whenever', null],
    ['half nonsense', 'Oct 23 – whenever', null],
  ])('%s: %s', (_, text, days) => expect(parseDays(text, TODAY)).toEqual(days));
});

describe('a Title typed by hand rewrites the line\'s title words (UX #8)', () => {
  const rewrite = (text: string, title: string) => lineWithTitle(text, parse(text).marks, title);
  test.each([
    ['Coffee fri', 'Coffee with Ana', 'Coffee with Ana fri'],
    ['Dinner with Sam fri 7-9pm @Blue Door', 'Dinner with Sam and Jo', 'Dinner with Sam and Jo fri 7-9pm @Blue Door'],
    ['fri 3pm Haircut', 'Haircut at Supercuts', 'Haircut at Supercuts fri 3pm'],
    ['Coffee', 'Tea', 'Tea'],
    ['Coffee fri', 'Coffee ', 'Coffee fri'],
    ['Coffee fri', '', 'fri'],
  ])('"%s" with Title "%s" reads "%s"', (text, title, line) => {
    expect(rewrite(text, title)).toBe(line);
  });
  test('the line then reads the same title, and keeps its day', () => {
    const after = parse(rewrite('Coffee fri', 'Coffee with Ana'));
    expect([after.title, after.date]).toEqual(['Coffee with Ana', parse('Coffee fri').date]);
  });
});

describe('SV-90: an edited title reads only what the edit typed', () => {
  test.each<[string, string, {start: number; end: number}]>([
    ['Work', 'Work', {start: 4, end: 4}],
    // Typed beside a word, not into it.
    ['Work', 'Work at 3:45a', {start: 4, end: 13}],
    ['Call fri', 'Call fri 3pm', {start: 8, end: 12}],
    ['Dinner fri', 'Dinner on fri', {start: 7, end: 10}],
    // A word the edit changed is typed whole, a letter taken out of it too.
    ['Standup 9am', 'Standup 10am', {start: 8, end: 12}],
    ['Standup 10am', 'Standup 1am', {start: 8, end: 11}],
    ['Work', 'Shift at 3:45a', {start: 0, end: 14}],
    // Only whole words or spaces taken out: nothing typed.
    ['Lunch at noon', 'Lunch noon', {start: 6, end: 6}],
  ])('%s → %s', (before, after, span) => expect(typedSpan(before, after)).toEqual(span));

  const edit = (before: string, text: string, day = '2026-10-14') => parseTitle(text, TODAY, CALENDARS, null, {kind: 'calendar', names: CALENDARS, picked: null}, {before, day});
  test('Work at 3:45a (the issue\'s example): the time, and the title as it was', () => {
    expect(edit('Work', 'Work at 3:45a')).toMatchObject({title: 'Work', start: h(3, 45), end: null, date: null});
  });
  test.each([
    // The title's own phrases stay its words: no change is the title as it was, spaces and all.
    ['Lunch at noon', 'Lunch at noon', 'Lunch at noon', null],
    ['Lunch at noon', 'Team lunch at noon', 'Team lunch at noon', null],
    ['Call fri', 'Call fri 3pm', 'Call fri', h(15)],
    ['Dinner fri', 'Dinner on fri', 'Dinner on fri', null],
    ['Plan  trip', 'Plan  trip ', 'Plan  trip ', null],
    ['Dinner', 'Dinner @Blue Door', 'Dinner', null],
    // Phrases that leave no words keep the title.
    ['Work', 'tomorrow 3pm', 'Work', h(15)],
  ])('%s → %s is %s', (before, text, title, start) => {
    const parsed = edit(before, text);
    expect(parsed.title).toBe(title);
    expect(parsed.start).toBe(start);
  });
  test('a place, calendar and day typed in the edit; one already in the title stays its words', () => {
    expect(edit('Dinner @Home', 'Dinner @Home #jobs tmr')).toMatchObject({title: 'Dinner @Home', place: null, calendar: 'Jobs', date: '2026-10-08'});
    expect(edit('Dinner', 'Dinner @Blue Door fri')).toMatchObject({title: 'Dinner', place: 'Blue Door', date: '2026-10-09'});
  });
  test('a place typed before the old words stops at them', () => {
    expect(edit('lunch', '@Cafe lunch')).toMatchObject({title: 'lunch', place: 'Cafe'});
  });
  test('a repeat with no day of its own counts from the item\'s day, not today', () => {
    // Wed, Oct 14 for the item; today is Wed, Oct 7.
    expect(edit('Gym', 'Gym weekly', '2026-10-16')).toMatchObject({recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=FR', date: null});
    expect(edit('Gym', 'Gym every mon', '2026-10-16')).toMatchObject({recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO', date: '2026-10-19'});
    expect(edit('Gym', 'Gym tomorrow')).toMatchObject({date: '2026-10-08'});
  });
});

describe('SV-90: an edited item\'s when', () => {
  const timed = {date: '2026-10-14', start: h(3), end: h(8), days: 1};
  const none = {date: null, start: null, end: null};
  test.each<[string, Parameters<typeof editedWhen>[0], Parameters<typeof editedWhen>[1], 'event' | 'task', ReturnType<typeof editedWhen>]>([
    ['a time keeps the day and length', timed, {...none, start: h(3, 45)}, 'event', {date: '2026-10-14', start: h(3, 45), end: h(8, 45), days: 1}],
    ['a range sets both ends', timed, {...none, start: h(9), end: h(10)}, 'event', {date: '2026-10-14', start: h(9), end: h(10), days: 1}],
    ['a day keeps the time and length', timed, {...none, date: '2026-10-16'}, 'event', {...timed, date: '2026-10-16'}],
    ['both', timed, {date: '2026-10-16', start: h(22), end: null}, 'event', {date: '2026-10-16', start: h(22), end: h(27), days: 1}],
    ['an overnight event keeps its length', {date: '2026-10-16', start: h(21), end: h(34), days: 1}, {...none, start: h(20)}, 'event', {date: '2026-10-16', start: h(20), end: h(33), days: 1}],
    ['an all-day event moves with its days', {date: '2026-10-14', start: null, end: null, days: 3}, {...none, date: '2026-10-20'}, 'event', {date: '2026-10-20', start: null, end: null, days: 3}],
    ['an all-day event given a time ends an hour later on its last day', {date: '2026-10-14', start: null, end: null, days: 2}, {...none, start: h(9)}, 'event', {date: '2026-10-14', start: h(9), end: h(1440 / 60 + 10), days: 1}],
    ['a one-day all-day event given a time is an hour', {date: '2026-10-14', start: null, end: null, days: 1}, {...none, start: h(9)}, 'event', {date: '2026-10-14', start: h(9), end: h(10), days: 1}],
    ['nothing read: as it was', timed, none, 'event', timed],
    ['a task\'s time is its due time', {date: '2026-10-14', start: null, end: null, days: 1}, {...none, start: h(17)}, 'task', {date: '2026-10-14', start: h(17), end: null, days: 1}],
    ['a task\'s day keeps its time', {date: '2026-10-14', start: h(17), end: null, days: 1}, {...none, date: '2026-10-09'}, 'task', {date: '2026-10-09', start: h(17), end: null, days: 1}],
  ])('%s', (_name, item, read, kind, when) => expect(editedWhen(item, read, kind)).toEqual(when));
});

describe('SV-111: a length after "for" (D291, D292), events only', () => {
  const task = (text: string) => parseTitle(text, TODAY, CALENDARS, null, {kind: 'project', names: ['Inbox', 'School', 'Home'], picked: null});
  test.each<[string, string, number | null, number | null, number | null, string]>([
    ['minutes', 'Run fri 7am for 15 min', h(7), h(7, 15), 15, 'fri 7am for 15 min'],
    ['a decimal', 'Call 2pm for 1.5h', h(14), h(15, 30), 90, '2pm for 1.5h'],
    ['a compound', 'Meeting 2pm for 1 hour 20mins', h(14), h(15, 20), 80, '2pm for 1 hour 20mins'],
    ['hours and bare minutes', 'Meeting 2pm for 1h30', h(14), h(15, 30), 90, '2pm for 1h30'],
    ['hr and minute', 'Meeting 2pm for 1 hr 1 minute', h(14), h(15, 1), 61, '2pm for 1 hr 1 minute'],
    ['past midnight', 'Party 11pm for 2 hours', h(23), h(25), 120, '11pm for 2 hours'],
    ['days', 'Trip fri 9am for 2 days', h(9), h(9) + 2 * 1440, 2880, 'fri 9am for 2 days'],
    ['a week', 'Retreat sat 9am for 1 week', h(9), h(9) + 7 * 1440, 7 * 1440, 'sat 9am for 1 week'],
    ['d', 'Trip 9am for 1d', h(9), h(9) + 1440, 1440, '9am for 1d'],
    ['before the time', 'Shift for 90 minutes 3pm', h(15), h(16, 30), 90, 'for 90 minutes 3pm'],
    ['no time: the default start is the reader\'s', 'Lunch fri for 1h', null, null, 60, 'fri for 1h'],
  ])('%s: %s', (_, text, start, end, length, when) => {
    expect(parse(text)).toMatchObject({start, end, length});
    expect(marked(text)).toEqual([`when:${when}`]);
  });
  test.each<[string, string, string, number | null, number | null]>([
    ['a bare length', '30 min run', '30 min run', null, null],
    ['a number word', 'Run for one hour', 'Run for one hour', null, null],
    ['wk', 'Run for 1 wk', 'Run for 1 wk', null, null],
    ['no unit', 'Run for 2 dogs', 'Run for 2 dogs', null, null],
    ['nothing long', 'Run for 0 min', 'Run for 0 min', null, null],
    // The first of a length or an end wins; the later stays words.
    ['a range first', 'Call 2-3pm for 2h', 'Call for 2h', h(14), h(15)],
    ['no end first', 'Call 2pm no end for 1h', 'Call for 1h', h(14), h(14)],
    ['a length first', 'Call for 1h 2-3pm', 'Call 2-3pm', null, null],
    ['a length first, then "no end"', 'Call for 1h 2pm no end', 'Call no end', h(14), h(15)],
  ])('%s: %s', (_, text, title, start, end) => expect(parse(text)).toMatchObject({title, start, end}));
  test('in a task\'s line it stays words', () => {
    expect(task('Study fri 3pm for 1h')).toMatchObject({title: 'Study for 1h', date: '2026-10-09', start: h(15), end: null, length: null});
  });
});

describe('SV-111: a span of days (D292), events only', () => {
  const task = (text: string) => parseTitle(text, TODAY, CALENDARS, null, {kind: 'project', names: ['Inbox', 'School', 'Home'], picked: null});
  test.each<[string, string, string, number, string]>([
    ['a dash', 'Trip oct 23–25', '2026-10-23', 3, 'oct 23–25'],
    ['"to" a day', 'Trip oct 23 to 25', '2026-10-23', 3, 'oct 23 to 25'],
    ['across months', 'Trip oct 30 – nov 2', '2026-10-30', 4, 'oct 30 – nov 2'],
    ['across years', 'Trip dec 30 - jan 2', '2026-12-30', 4, 'dec 30 - jan 2'],
    ['weekdays', 'Trip fri to sun', '2026-10-09', 3, 'fri to sun'],
    ['through', 'Trip fri through sun', '2026-10-09', 3, 'fri through sun'],
    ['from', 'Trip from fri to sun', '2026-10-09', 3, 'from fri to sun'],
    ['into next week', 'Trip fri to mon', '2026-10-09', 4, 'fri to mon'],
    ['numbers', 'Trip 10/23 - 10/25', '2026-10-23', 3, '10/23 - 10/25'],
  ])('all day with no time, %s: %s', (_, text, date, days, when) => {
    expect(parse(text)).toMatchObject({title: 'Trip', date, days, start: null, end: null, recurrence: null});
    expect(marked(text)).toEqual([`when:${when}`]);
  });
  test('a time at each end is one event across the days', () => {
    expect(parse('Trip fri 7pm to sun 3pm')).toMatchObject({title: 'Trip', date: '2026-10-09', start: h(19), end: 2 * 1440 + h(15), days: null, recurrence: null});
    expect(marked('Trip fri 7pm to sun 3pm')).toEqual(['when:fri 7pm to sun 3pm']);
  });
  test.each<[string, string, string, number | null, number | null, number | null, string]>([
    ['a time range', 'Conference oct 23–25 9am–5pm', '2026-10-23', h(9), h(17), null, 'RRULE:FREQ=DAILY;UNTIL=20261025'],
    ['one time after', 'Camp fri to sun 9am', '2026-10-09', h(9), null, null, 'RRULE:FREQ=DAILY;UNTIL=20261011'],
    ['one time inside', 'Camp fri 9am to sun', '2026-10-09', h(9), null, null, 'RRULE:FREQ=DAILY;UNTIL=20261011'],
    ['a length, from the default start', 'Camp oct 23–25 for 2h', '2026-10-23', null, null, 120, 'RRULE:FREQ=DAILY;UNTIL=20261025'],
    ['a repeat typed is the one that ends', 'Standup weekly nov 2 to nov 30 9am', '2026-11-02', h(9), null, null, 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130'],
  ])('one time each day is a daily repeat until the last day, %s: %s', (_, text, date, start, end, length, recurrence) => {
    expect(parse(text)).toMatchObject({date, start, end, length, days: null, recurrence});
  });
  test.each([
    ['a backwards day', 'Trip oct 25–23'],
    ['a backwards month day', 'Trip oct 25 – oct 23'],
    ['a backwards year', 'Trip 10/25/2026 - 10/23/2026'],
    ['a backwards time', 'Trip fri 7pm to fri 3pm'],
  ])('%s stays words: %s', (_, text) => {
    expect(parse(text)).toMatchObject({title: text, date: null, start: null, days: null});
    expect(parse(text).marks).toEqual([]);
  });
  test.each([
    'Meet oct 3 to 5pm', 'Dinner fri 7-9pm', 'Dinner fri 7pm to 9pm', 'Lunch 10/12 - 2pm',
  ])('a time range after a day is not a span: %s', text => expect(parse(text).days).toBeNull());
  test('in a task\'s line it stays words', () => {
    expect(task('Pack fri to sun')).toMatchObject({title: 'Pack fri to sun', date: null, days: null});
    expect(task('Pack fri 7pm to sun 3pm')).toMatchObject({title: 'Pack fri 7pm to sun 3pm', date: null, start: null});
  });
  test('a lone day has no days, and the Date field reads no span as one day', () => {
    expect(parse('Lunch fri').days).toBeNull();
    expect(parseDay('fri to sun', TODAY)).toBeNull();
  });
  test('the Repeat row says the last day', () => {
    expect(describeRule('RRULE:FREQ=DAILY;UNTIL=20261025', '2026-10-23')).toBe('Daily, until Sun, Oct 25');
    expect(describeRule('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261130', '2026-11-02')).toBe('Weekly on Monday, until Mon, Nov 30');
  });
});

describe('SV-111: an edited event\'s when, from a span or a length', () => {
  const timed = {date: '2026-10-14', start: h(3), end: h(8), days: 1};
  const none = {date: null, start: null, end: null};
  test.each<[string, Parameters<typeof editedWhen>[0], Parameters<typeof editedWhen>[1], 'event' | 'task', ReturnType<typeof editedWhen>]>([
    ['a span is all day over its days', timed, {date: '2026-10-23', start: null, end: null, days: 3, length: null}, 'event', {date: '2026-10-23', start: null, end: null, days: 3}],
    ['a length with no time keeps the start', timed, {...none, days: null, length: 60}, 'event', {date: '2026-10-14', start: h(3), end: h(4), days: 1}],
    ['an all-day event given a length starts at 9:00 AM', {date: '2026-10-14', start: null, end: null, days: 2}, {...none, days: null, length: 90}, 'event', {date: '2026-10-14', start: h(9), end: h(10, 30), days: 1}],
    ['a task has neither', {date: '2026-10-14', start: h(17), end: null, days: 1}, {...none, days: 3, length: 60}, 'task', {date: '2026-10-14', start: h(17), end: null, days: 1}],
  ])('%s', (_name, item, read, kind, when) => expect(editedWhen(item, read, kind)).toEqual(when));
});

describe('SV-112: reminder phrases (D293), with D291\'s units', () => {
  const PROJECTS = ['Inbox', 'School', 'Home'];
  // A new event's moment, when the line reads no day or time: today at 9:00 AM.
  const base = {day: TODAY, time: h(9)};
  const read = (text: string, remind: Parameters<typeof parseTitle>[6] = base) => parseTitle(text, TODAY, CALENDARS, null, null, null, remind);
  const task = (text: string, remind: Parameters<typeof parseTitle>[6] = base) => parseTitle(text, TODAY, CALENDARS, null, {kind: 'project', names: PROJECTS, picked: null}, null, remind);
  const kinds = (text: string, remind: Parameters<typeof parseTitle>[6] = base) => read(text, remind).marks.map(mark => `${mark.kind}:${text.slice(mark.start, mark.end)}`);

  test.each<[string, string, string, {minutes: number}[]]>([
    ['remind me', 'Call mom remind me 1h before', 'remind me 1h before', [{minutes: 60}]],
    ['remind', 'Call mom remind 30 mins before', 'remind 30 mins before', [{minutes: 30}]],
    ['reminder', 'Call mom reminder 2 hours after', 'reminder 2 hours after', [{minutes: -120}]],
    ['at start', 'Call mom remind at start', 'remind at start', [{minutes: 0}]],
    ['at the start', 'Call mom remind me at the start', 'remind me at the start', [{minutes: 0}]],
    ['two joined, one before', 'Call mom remind 1 day and 10 mins before', 'remind 1 day and 10 mins before', [{minutes: 1440}, {minutes: 10}]],
    ['a comma and and', 'Call mom remind 1 day, 1h and 10 min before', 'remind 1 day, 1h and 10 min before', [{minutes: 1440}, {minutes: 60}, {minutes: 10}]],
    ['before and after', 'Call mom remind 1h before and 30 min after', 'remind 1h before and 30 min after', [{minutes: 60}, {minutes: -30}]],
    ['a decimal', 'Call mom remind 1.5h before', 'remind 1.5h before', [{minutes: 90}]],
    ['a compound', 'Call mom remind 1 hour 20mins before', 'remind 1 hour 20mins before', [{minutes: 80}]],
    ['hours and bare minutes', 'Call mom remind 1h30 before', 'remind 1h30 before', [{minutes: 90}]],
    ['hrs', 'Call mom remind 2 hrs before', 'remind 2 hrs before', [{minutes: 120}]],
    ['d', 'Call mom remind 2d before', 'remind 2d before', [{minutes: 2880}]],
    ['a week', 'Call mom remind 1 week before', 'remind 1 week before', [{minutes: 10080}]],
    ['4 weeks, the most', 'Call mom remind 4 weeks after', 'remind 4 weeks after', [{minutes: -40320}]],
    ['the same twice is once', 'Call mom remind 1h and 60 min before', 'remind 1h and 60 min before', [{minutes: 60}]],
  ])('an offset, %s: %s', (_, text, phrase, reminders) => {
    expect(read(text)).toMatchObject({title: 'Call mom', reminders, date: null, start: null});
    expect(kinds(text)).toEqual([`reminder:${phrase}`]);
  });

  test.each<[string, string, string, {date: string; time: number}[], string | null, number | null]>([
    // "sun 8pm" is the reminder's, not the item's day (read before the dates and times).
    ['a day and time', 'Call mom remind sun 8pm', 'Call mom', [{date: '2026-10-11', time: h(20)}], null, null],
    ['tomorrow', 'Trip fri remind tomorrow 9am', 'Trip', [{date: '2026-10-08', time: h(9)}], '2026-10-09', null],
    ['"at" on the item\'s own day', 'Dinner fri 7pm remind at 6pm', 'Dinner', [{date: '2026-10-09', time: h(18)}], '2026-10-09', h(19)],
    ['a time alone on the item\'s day, read later', 'Dinner remind me 6pm fri 7pm', 'Dinner', [{date: '2026-10-09', time: h(18)}], '2026-10-09', h(19)],
    ['on a day with "at"', 'Dinner oct 20 7pm remind on oct 19 at 8:30pm', 'Dinner', [{date: '2026-10-19', time: h(20, 30)}], '2026-10-20', h(19)],
    ['noon', 'Call mom remind fri noon', 'Call mom', [{date: '2026-10-09', time: h(12)}], null, null],
  ])('a moment, %s: %s', (_, text, title, reminders, date, start) => {
    expect(read(text)).toMatchObject({title, reminders, date, start});
  });

  test('offsets and moments join', () => {
    expect(read('Exam fri 3pm remind 1 day before and fri 2pm')).toMatchObject({
      title: 'Exam', date: '2026-10-09', start: h(15), reminders: [{minutes: 1440}, {date: '2026-10-09', time: h(14)}],
    });
    expect(kinds('Exam fri 3pm remind 1 day before and fri 2pm')).toEqual(['when:fri 3pm', 'reminder:remind 1 day before and fri 2pm']);
  });
  test('two phrases each read', () => {
    expect(read('Call remind 1h before remind me 2 hours after').reminders).toEqual([{minutes: 60}, {minutes: -120}]);
  });
  test('a mark of its own beside the when, and a place stops before it', () => {
    expect(kinds('Call fri 3pm remind 1h before')).toEqual(['when:fri 3pm', 'reminder:remind 1h before']);
    expect(read('Coffee @Blue Door remind 1h before')).toMatchObject({title: 'Coffee', place: 'Blue Door', reminders: [{minutes: 60}]});
  });
  test('a dated task\'s line reads them too', () => {
    expect(task('Pay rent fri remind 1h before')).toMatchObject({title: 'Pay rent', date: '2026-10-09', reminders: [{minutes: 60}]});
  });

  test.each<[string, string, Parameters<typeof parseTitle>[6]?]>([
    ['"remind" alone', 'Call remind'],
    ['"remind me" alone', 'Call remind me'],
    ['"reminder email"', 'Send reminder email'],
    ['a reminder to do something', 'remind me to call Sam'],
    ['other words', 'Call remember 1h before'],
    ['"reminds"', 'Call reminds 1h before'],
    ['an offset with no before or after', 'Call remind 1h'],
    ['a number word', 'Call remind one hour before'],
    ['"wk"', 'Call remind 1 wk before'],
    ['past 4 weeks', 'Call remind 5 weeks before'],
    ['past 4 weeks by a minute', 'Call remind 4 weeks 1 min after'],
    ['one of them past 4 weeks', 'Call remind 1h and 5 weeks before'],
    ['a day with no time', 'Call remind sun'],
    ['a task with no date', 'Call remind 1h before', null],
  ])('stays words, %s: %s', (_, text, remind) => {
    const parsed = read(text, remind === undefined ? base : remind);
    expect(parsed).toMatchObject({title: text, reminders: null, date: null, start: null});
    expect(parsed.marks).toEqual([]);
  });

  test('a moment past 4 weeks from the item stays words, its day not the item\'s', () => {
    expect(read('Trip dec 20 remind sun 8pm')).toMatchObject({title: 'Trip remind sun 8pm', date: '2026-12-20', reminders: null});
    expect(read('Trip nov 20 remind tomorrow 9am')).toMatchObject({title: 'Trip remind tomorrow 9am', date: '2026-11-20', reminders: null});
    // 4 weeks to the minute is still one: Wed, Nov 4, 9:00 AM from Wed, Oct 7, 9:00 AM.
    expect(read('Call remind nov 4 9am').reminders).toEqual([{date: '2026-11-04', time: h(9)}]);
    expect(read('Call remind nov 4 9:01am').reminders).toBeNull();
  });
  test('a task with no date keeps a moment as words, its day not the task\'s', () => {
    expect(task('Pay rent remind sun 8pm', null)).toMatchObject({title: 'Pay rent remind sun 8pm', date: null, start: null, reminders: null});
  });
  test('past 10, counting what the item keeps besides the line, a phrase stays words', () => {
    const many = `Call remind ${Array.from({length: 11}, (_, index) => `${index + 1} min`).join(', ')} before`;
    expect(read(many)).toMatchObject({title: many, reminders: null});
    expect(read(`Call remind ${Array.from({length: 10}, (_, index) => `${index + 1} min`).join(', ')} before`).reminders).toHaveLength(10);
    expect(read('Call remind 1h before remind 2h before', {...base, kept: 9})).toMatchObject({title: 'Call remind 2h before', reminders: [{minutes: 60}]});
    expect(read('Call remind 1h and 2h before', {...base, kept: 9})).toMatchObject({title: 'Call remind 1h and 2h before', reminders: null});
  });
  test('an untimed item counts from the time given; a span of days from its midnight', () => {
    // 4 weeks before Wed, Nov 4 at 7:00 AM is Wed, Oct 7 at 7:00 AM; at 9:00 AM, 8:00 AM is past it.
    expect(read('Call nov 4 remind oct 7 8am', {day: TODAY, time: h(7)}).reminders).toEqual([{date: '2026-10-07', time: h(8)}]);
    expect(read('Call nov 4 remind oct 7 8am', {day: TODAY, time: h(9)}).reminders).toBeNull();
    // An all-day span counts from its first midnight, Tue, Nov 10: 4 weeks before is Tue, Oct 13.
    expect(read('Trip nov 10–12 remind oct 13 1am')).toMatchObject({days: 3, reminders: [{date: '2026-10-13', time: h(1)}]});
    expect(read('Trip nov 10–12 remind oct 12 11pm')).toMatchObject({days: 3, reminders: null});
  });
  test('an edit reads only a phrase it typed', () => {
    const edit = (before: string, text: string) => parseTitle(text, TODAY, CALENDARS, null, null, {before, day: '2026-10-14'}, {day: '2026-10-14', time: h(9)});
    expect(edit('Work', 'Work remind 1h before')).toMatchObject({title: 'Work', reminders: [{minutes: 60}]});
    expect(edit('Work', 'Work remind at 8am')).toMatchObject({title: 'Work', reminders: [{date: '2026-10-14', time: h(8)}]});
    expect(edit('Call remind 1h before', 'Call remind 1h before fri')).toMatchObject({title: 'Call remind 1h before', reminders: null, date: '2026-10-09'});
  });
  test('the limits are the API\'s', () => {
    expect(REMINDER_LINE_LIMITS).toEqual({minutes: REMINDER_LIMIT_MINUTES, count: 10});
  });
});

describe('SV-113: relative days (D294)', () => {
  // The issue's Mon, Oct 26, 2026; a Saturday that is a month's last day; a Sunday; month ends.
  const MON = '2026-10-26';
  const SAT = '2026-10-31';
  const SUN = '2026-11-01';
  const on = (text: string, today: string) => parseTitle(text, today, CALENDARS);
  const task = (text: string, today: string) => parseTitle(text, today, CALENDARS, null, {kind: 'project', names: ['Inbox', 'School', 'Home'], picked: null});
  test.each([
    ['in 3 days', MON, '2026-10-29'], ['in 1 day', MON, '2026-10-27'], ['in 2 weeks', MON, '2026-11-09'], ['in 1 week', MON, '2026-11-02'],
    ['in 1 month', MON, '2026-11-26'], ['in 3 months', MON, '2027-01-26'],
    ['next week', MON, '2026-11-02'], ['this weekend', MON, '2026-10-31'], ['weekend', MON, '2026-10-31'], ['next weekend', MON, '2026-11-07'],
    ['end of week', MON, '2026-10-30'], ['end of the week', MON, '2026-10-30'], ['end of month', MON, '2026-10-31'], ['end of the month', MON, '2026-10-31'],
    ['eom', MON, '2026-10-31'], ['end of next month', MON, '2026-11-30'], ['on end of month', MON, '2026-10-31'],
    // A Saturday: this weekend is today; the week's end is the coming Friday; today is the month's last day.
    ['this weekend', SAT, '2026-10-31'], ['next weekend', SAT, '2026-11-07'], ['next week', SAT, '2026-11-02'], ['end of week', SAT, '2026-11-06'],
    ['end of month', SAT, '2026-10-31'], ['end of next month', SAT, '2026-11-30'], ['in 1 month', SAT, '2026-11-30'], ['in 4 months', SAT, '2027-02-28'],
    // A Sunday: next week starts tomorrow, and the coming Saturday is six days on.
    ['next week', SUN, '2026-11-02'], ['this weekend', SUN, '2026-11-07'], ['end of week', SUN, '2026-11-06'],
    // A month to the same date, or that month's last day; a year's turn and a leap year.
    ['in 1 month', '2027-01-31', '2027-02-28'], ['in 13 months', '2027-01-31', '2028-02-29'], ['end of next month', '2027-01-31', '2027-02-28'],
    ['end of next month', '2026-12-15', '2027-01-31'], ['in 2 months', '2026-12-15', '2027-02-15'], ['end of month', '2028-02-03', '2028-02-29'],
  ])('Lunch %s, today %s → %s', (phrase, today, date) => {
    const parsed = task(`Lunch ${phrase}`, today);
    expect(parsed).toMatchObject({title: 'Lunch', date, days: null});
    expect(parsed.marks.map(mark => `Lunch ${phrase}`.slice(mark.start, mark.end))).toEqual([phrase]);
  });
  test('an event\'s weekend with no time is all day Saturday–Sunday; with a time, Saturday at it; a task\'s is due Saturday', () => {
    expect(on('Hike this weekend', MON)).toMatchObject({title: 'Hike', date: '2026-10-31', days: 2, start: null, recurrence: null});
    expect(on('Hike next weekend', MON)).toMatchObject({date: '2026-11-07', days: 2});
    expect(on('Hike weekend', SAT)).toMatchObject({date: '2026-10-31', days: 2});
    expect(on('Hike this weekend 9am', MON)).toMatchObject({date: '2026-10-31', days: null, start: h(9), recurrence: null});
    expect(task('Clean garage this weekend', MON)).toMatchObject({title: 'Clean garage', date: '2026-10-31', days: null, start: null});
  });
  test('times and other phrases read beside them', () => {
    expect(on('Review in 3 days 2pm @Blue Door', MON)).toMatchObject({title: 'Review', date: '2026-10-29', start: h(14), place: 'Blue Door'});
    expect(on('Plan next week 9-10am', MON)).toMatchObject({date: '2026-11-02', start: h(9), end: h(10)});
  });
  test.each([
    'Lunch in 3 hours', 'Lunch in 0 days', 'Lunch in three days', 'Lunch in 2 wks', 'Lunch end of year', 'Lunch next weeks',
  ])('%s stays words', text => expect(on(text, MON)).toMatchObject({title: text, date: null, days: null}));
  test('the Date field takes them, an event\'s weekend as its Saturday', () => {
    expect(parseDay('next week', MON)).toBe('2026-11-02');
    expect(parseDay('this weekend', MON)).toBe('2026-10-31');
    expect(parseDay('eom', MON)).toBe('2026-10-31');
    expect(parseDays('next week to end of week', SAT)).toEqual({from: '2026-11-02', to: '2026-11-06'});
  });
  test('a span reads them as its days', () => {
    expect(on('Trip fri to end of month', MON)).toMatchObject({date: '2026-10-30', days: 2});
  });
});

describe('SV-113: when a repeat ends (D294), only after one', () => {
  const MON = '2026-10-26';
  const on = (text: string, today = MON) => parseTitle(text, today, CALENDARS);
  const task = (text: string, today = MON) => parseTitle(text, today, CALENDARS, null, {kind: 'project', names: ['Inbox', 'School', 'Home'], picked: null});
  test.each<[string, string | null, string, string]>([
    ['Standup every mon until dec 15', '2026-10-26', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261215', 'every mon until dec 15'],
    ['Standup every mon 9am until dec 15', '2026-10-26', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261215', 'every mon 9am until dec 15'],
    ['Gym daily until fri', null, 'RRULE:FREQ=DAILY;UNTIL=20261030', 'daily until fri'],
    ['Gym every day until end of month', null, 'RRULE:FREQ=DAILY;UNTIL=20261031', 'every day until end of month'],
    ['Gym every day until next week', null, 'RRULE:FREQ=DAILY;UNTIL=20261102', 'every day until next week'],
    ['Gym every day until in 2 weeks', null, 'RRULE:FREQ=DAILY;UNTIL=20261109', 'every day until in 2 weeks'],
    ['Class every tue and thu until 12/10', '2026-10-27', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261210', 'every tue and thu until 12/10'],
    ['Gym every day 6 times', null, 'RRULE:FREQ=DAILY;COUNT=6', 'every day 6 times'],
    ['Gym every day for 6 times', null, 'RRULE:FREQ=DAILY;COUNT=6', 'every day for 6 times'],
    ['Gym weekly 1 time', null, 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1', 'weekly 1 time'],
    // "for N days/weeks/months" lasts that long from the first occurrence, its last day the one before first + N.
    ['Gym every day for 2 weeks', '2026-10-26', 'RRULE:FREQ=DAILY;UNTIL=20261108', 'every day for 2 weeks'],
    ['Gym every day for 3 days', '2026-10-26', 'RRULE:FREQ=DAILY;UNTIL=20261028', 'every day for 3 days'],
    ['Gym every mon for 4 weeks', '2026-10-26', 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261122', 'every mon for 4 weeks'],
    ['Rent monthly for 3 months', '2026-10-26', 'RRULE:FREQ=MONTHLY;UNTIL=20270125', 'monthly for 3 months'],
    ['Gym every fri 7am for 2 weeks', '2026-10-30', 'RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261112', 'every fri 7am for 2 weeks'],
    ['Rent monthly nov 30 for 3 months', '2026-11-30', 'RRULE:FREQ=MONTHLY;UNTIL=20270227', 'monthly nov 30 for 3 months'],
  ])('%s', (text, date, recurrence, when) => {
    const parsed = on(text);
    expect(parsed).toMatchObject({date, recurrence, length: null, days: null});
    expect(parsed.title).toBe(text.split(' ')[0]);
    expect(parsed.marks.map(mark => `${mark.kind}:${text.slice(mark.start, mark.end)}`)).toEqual([`when:${when}`]);
  });
  test('the "for 2 weeks" bug: after a repeat it\'s the repeat\'s end, not the event\'s length', () => {
    expect(on('Gym every day for 2 weeks')).toMatchObject({start: null, end: null, length: null, days: null, recurrence: 'RRULE:FREQ=DAILY;UNTIL=20261108'});
    // A length in hours after a repeat is still a length.
    expect(on('Gym every day 7am for 1h')).toMatchObject({start: h(7), end: h(8), length: 60, recurrence: 'RRULE:FREQ=DAILY'});
  });
  test.each([
    ['no repeat', 'Party until dec 15', 'Party until dec 15', null, null],
    ['no repeat, a count', 'Stretch 6 times', 'Stretch 6 times', null, null],
    ['no repeat, for a count', 'Stretch for 6 times', 'Stretch for 6 times', null, null],
    ['no repeat, months', 'Trip for 2 months', 'Trip for 2 months', null, null],
    ['a repeat after it', 'Gym until dec 15 every mon', 'Gym until dec 15', 'RRULE:FREQ=WEEKLY;BYDAY=MO', '2026-10-26'],
    ['an end before the first', 'Gym every fri until thu', 'Gym until thu', 'RRULE:FREQ=WEEKLY;BYDAY=FR', '2026-10-30'],
    ['a second end', 'Gym every day 3 times until fri', 'Gym until fri', 'RRULE:FREQ=DAILY;COUNT=3', null],
    ['no times', 'Gym every day 0 times', 'Gym 0 times', 'RRULE:FREQ=DAILY', null],
  ])('stays words: %s', (_, text, title, recurrence, date) => expect(on(text)).toMatchObject({title, recurrence, date}));
  test('the Repeat row says the end', () => {
    expect(describeRule('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261215', MON)).toBe('Weekly on Monday, until Tue, Dec 15');
    expect(describeRule('RRULE:FREQ=DAILY;COUNT=6', MON)).toBe('Daily, 6 times');
    expect(describeRule('RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=1', MON)).toBe('Weekly on Mon, Wed, once');
    expect(describeRule('RRULE:FREQ=MONTHLY;INTERVAL=2;COUNT=3', MON)).toBe('Every 2 months on day 26, 3 times');
  });
  test.each<[string, string | null, string, string]>([
    // A task's end goes to Todoist as "until" a date, which it documents; a count, which it doesn't, stays words.
    ['Water plants every mon until dec 15', 'every mon until 2026-12-15', 'Water plants', 'Every Monday, until Tue, Dec 15'],
    ['Vitamins every day for 2 weeks', 'every day until 2026-11-08', 'Vitamins', 'Every day, until Sun, Nov 8'],
    ['Water plants every mon until end of next month', 'every mon until 2026-11-30', 'Water plants', 'Every Monday, until Mon, Nov 30'],
    ['Vitamins every day 6 times', 'every day', 'Vitamins 6 times', 'Every day'],
    ['Vitamins every day for 6 times', 'every day', 'Vitamins for 6 times', 'Every day'],
  ])('a task: %s', (text, repeat, title, label) => {
    const parsed = task(text);
    expect(parsed.title).toBe(title);
    expect(taskRepeat(parsed.recurrence)).toBe(repeat);
    expect(describeTaskRepeat(repeat)).toBe(label);
  });
  test('a count reaches no task\'s repeat', () => expect(taskRepeat('RRULE:FREQ=DAILY;COUNT=3')).toBeNull());
  test('an edit\'s "for 2 weeks" counts from the item\'s day', () => {
    expect(parseTitle('Gym daily for 2 weeks', MON, CALENDARS, null, null, {before: 'Gym', day: '2026-11-03'}))
      .toMatchObject({date: '2026-11-03', recurrence: 'RRULE:FREQ=DAILY;UNTIL=20261116'});
  });
});

describe('SV-113: a length in days with no time is all day over them (D298)', () => {
  const MON = '2026-10-26';
  const on = (text: string) => parseTitle(text, MON, CALENDARS);
  test.each<[string, string | null, number, string]>([
    ['Trip fri for 3 days', '2026-10-30', 3, 'fri for 3 days'],
    ['Trip fri for 1 day', '2026-10-30', 1, 'fri for 1 day'],
    ['Trip fri for 2d', '2026-10-30', 2, 'fri for 2d'],
    ['Retreat for 1 week', null, 7, 'for 1 week'],
    ['Retreat sat for 1 week 2 days', '2026-10-31', 9, 'sat for 1 week 2 days'],
    ['Camp this weekend for 3 days', '2026-10-31', 3, 'this weekend for 3 days'],
  ])('%s', (text, date, days, when) => {
    expect(on(text)).toMatchObject({date, days, start: null, end: null, length: null});
    expect(on(text).marks.map(mark => text.slice(mark.start, mark.end))).toEqual([when]);
  });
  test.each<[string, number | null, number | null, number]>([
    // Hours, part days and a time typed keep SV-111's timed length.
    ['Trip fri for 1.5 days', null, null, 2160],
    ['Trip fri for 1 day 3h', null, null, 1620],
    ['Trip fri 9am for 2 days', h(9), h(9) + 2880, 2880],
    ['Lunch fri for 2h', null, null, 120],
  ])('%s stays timed', (text, start, end, length) => expect(on(text)).toMatchObject({start, end, length, days: null}));
});
