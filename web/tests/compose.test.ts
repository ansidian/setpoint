// The editor's title parsing as tables (DESIGN.md › Editor; board 13), with v1's
// `parseCalendarTitle.test.ts` cases carried over through the harvest gate (darma SV-15). Today is
// the seed's Wed, Oct 7, 2026.
import {describe, expect, test} from 'vitest';
import {bareToken, clockLabel, completeToken, lineWithTitle, describeRule, describeTaskRepeat, draftStarted, editedWhen, endChoices, extraDays, parseClock, parseDay, parseDays, parseEnd, parseTitle, readEnd, repeatChoices, spanTo, taskRepeat, taskRepeatChoices, timeChoices, typedSpan} from '../src/logic/compose.ts';

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
