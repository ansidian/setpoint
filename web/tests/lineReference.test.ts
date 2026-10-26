// SV-114 (D295): "What the line reads" (shared/compose/reference.json) can't drift from the parser.
// Each example runs through the iPhone's parseTitle (composeApp.ts, what compose.js is built from) on
// the seed's Wed, Oct 7, 2026, with its kept phrase hidden as the editor hides it, and what it read is
// said in the editor's own words (the Date and time fields, Repeat, Reminders, Place, Calendar,
// Project): a row's `reads` must be exactly that. The examples are cases in cases.json too.
import {describe, expect, test} from 'vitest';
import {dayTitle} from '../src/logic/calendar.ts';
import {clockLabel, describeRule} from '../src/logic/compose.ts';
import {parseTitle} from '../src/logic/composeApp.ts';
import {addDays} from '../src/logic/format.ts';
import {LINE_REFERENCE} from '../src/logic/lineReference.ts';
import type {ReferenceRow} from '../src/logic/lineReference.ts';
import {masked, unmasked} from '../src/logic/plain.ts';
import {reminderWords} from '../src/logic/reminders.ts';

// As composeBundle.test.ts's: the seed's day, Google calendars and Todoist projects, and a new item's
// reminders counting from today at 9:00 AM.
const TODAY = '2026-10-07';
const CALENDARS = ['Personal', 'Classes', 'Jobs'];
const PROJECTS = ['Inbox', 'School', 'Home'];
const REMIND = {day: TODAY, time: 540};

/** A start and end as the Start and End fields say them together: "9:00 – 9:15 AM", "2:00 PM, No end". */
function times(start: number, end: number | null): string {
  if (end === null) return clockLabel(start);
  if (end === start) return `${clockLabel(start)}, No end`;
  if (end > 1440) throw new Error('an end on a later day is not said here');
  const [from, half] = clockLabel(start).split(' ');
  const to = clockLabel(end);
  return half === to.split(' ')[1] ? `${from} – ${to}` : `${clockLabel(start)} – ${to}`;
}

/** What a row's example reads, in the editor's words, each field it set joined by " · ". */
function reads(row: ReferenceRow): string {
  const at = row.plain ? row.example.indexOf(row.plain) : -1;
  const hidden = masked(row.example, at >= 0 ? [{start: at, end: at + row.plain!.length}] : []);
  const parsed = parseTitle({text: hidden.text, kind: row.kind, today: TODAY, calendars: CALENDARS, projects: PROJECTS, remind: REMIND});
  const said: string[] = [];
  if (row.plain) said.push(`“${unmasked(parsed.title, hidden.words)}”`);
  if (parsed.days !== null && parsed.days > 1) said.push(`${dayTitle(parsed.date!)} – ${dayTitle(addDays(parsed.date!, parsed.days - 1))}, all day`);
  else if (parsed.date) said.push(`${row.kind === 'task' ? 'due ' : ''}${dayTitle(parsed.date)}`);
  if (parsed.start !== null) said.push(times(parsed.start, parsed.end));
  else if (parsed.length !== null) throw new Error('a length with no time is not said here');
  if (parsed.recurrence) said.push(describeRule(parsed.recurrence, parsed.date ?? TODAY));
  if (parsed.reminders) {
    said.push(`a reminder ${parsed.reminders.map(one => ('minutes' in one ? reminderWords(one.minutes, null, 'UTC').text : `${dayTitle(one.date)}, ${clockLabel(one.time)}`)).join(', ')}`);
  }
  if (parsed.place) said.push(`at ${parsed.place}`);
  if (parsed.calendar) said.push(`the ${parsed.calendar} calendar`);
  if (parsed.project) said.push(`the ${parsed.project} project`);
  return said.join(' · ');
}

const rows = LINE_REFERENCE.flatMap(section => section.rows.map(row => ({section: section.title, ...row})));

describe('What the line reads', () => {
  test.each(rows)('$section: "$example" reads "$reads"', row => {
    if (row.plain) expect(row.example, 'the kept phrase is in the example').toContain(row.plain);
    expect(row.reads, `"${row.example}" reads "${reads(row)}"`).toBe(reads(row));
  });

  test('each kind of phrase has its section, each with an example, and none twice', () => {
    expect(LINE_REFERENCE.map(section => section.title)).toEqual(['Days', 'Times', 'Lengths and spans', 'Repeats', 'Reminders', 'Places, calendars and projects', 'Keeping a phrase as words']);
    expect(LINE_REFERENCE.every(section => section.rows.length > 0)).toBe(true);
    expect(new Set(rows.map(row => row.example)).size).toBe(rows.length);
  });
});
