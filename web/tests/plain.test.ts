// SV-110 (D290): a lit phrase made title words again, as tables. The rules are the iPhone's
// (setpoint-ios QuickAddDraft: `type`, `makePlain`, `masked`, `unmasked`). Today is the seed's Wed,
// Oct 7, 2026.
import {describe, expect, test} from 'vitest';
import {parseTitle} from '../src/logic/compose.ts';
import {markInside, masked, retyped, titleRun, unmasked, wordSpans} from '../src/logic/plain.ts';
import type {Span} from '../src/logic/plain.ts';

const TODAY = '2026-10-07';
/** The line read with `plain` hidden from it, as the editor reads it. */
function read(text: string, plain: Span[]) {
  const hidden = masked(text, plain);
  const parsed = parseTitle(hidden.text, TODAY);
  return {title: unmasked(parsed.title, hidden.words), date: parsed.date, start: parsed.start, place: parsed.place === null ? null : unmasked(parsed.place, hidden.words),
    marks: parsed.marks.map(mark => text.slice(mark.start, mark.end))};
}
const span = (text: string, part: string): Span => ({start: text.indexOf(part), end: text.indexOf(part) + part.length});

describe('a plain phrase is title words, and sets nothing', () => {
  test.each<[string, string, string, string | null, string[]]>([
    ['Lunch with May 12', 'May 12', 'Lunch with May 12', null, []],
    ['Dinner fri 7pm', 'fri 7pm', 'Dinner fri 7pm', null, []],
    ['Gym sat 9am @Blue Door', '@Blue Door', 'Gym @Blue Door', '2026-10-10', ['sat 9am']],
    ['Mon standup fri', 'Mon', 'Mon standup', '2026-10-09', ['fri']],
  ])('"%s" with "%s" plain', (text, part, title, date, marks) => {
    expect(parseTitle(text, TODAY).marks.length).toBeGreaterThan(0);
    const got = read(text, [span(text, part)]);
    expect([got.title, got.date, got.marks]).toEqual([title, date, marks]);
  });
  test('a plain word after a place is no phrase, so the place runs on over it, as the iPhone\'s does', () => {
    const text = 'Coffee @Blue Door fri';
    expect(read(text, [span(text, 'fri')])).toMatchObject({title: 'Coffee', place: 'Blue Door fri', date: null});
  });
  test('masking keeps every offset, and unmasking gives the words back', () => {
    const text = 'Lunch with May fri';
    const hidden = masked(text, [span(text, 'with May')]);
    expect(hidden.text.length).toBe(text.length);
    expect(hidden.text.slice(0, 6)).toBe('Lunch ');
    expect(hidden.text.slice(14)).toBe(' fri');
    expect(unmasked(hidden.text, hidden.words)).toBe(text);
  });
  test('a proposal\'s title, every word plain, reads as typed', () => {
    const text = 'Dinner Friday at 7';
    expect(read(text, wordSpans(text))).toMatchObject({title: text, date: null, start: null, marks: []});
  });
});

describe('typing keeps a plain phrase until it\'s typed into', () => {
  const plain = [{start: 11, end: 14}]; // "May" in "Lunch with May fri"
  test.each<[string, string, Span[]]>([
    ['typed after it, moved with it', 'Lunch with May fri 1pm', plain],
    ['typed before it, moved with it', 'Big lunch with May fri', [{start: 15, end: 18}]],
    ['typed into, read again', 'Lunch with Mxy fri', []],
    ['typed right after it, kept, as the iPhone keeps it', 'Lunch with Mayo fri', plain],
    ['taken out with it', 'Lunch with fri', []],
    ['nothing typed', 'Lunch with May fri', plain],
  ])('%s', (_, after, expected) => expect(retyped(plain, 'Lunch with May fri', after)).toEqual(expected));
});

describe('⌥⌫ finds the phrase the caret is inside, not at its edge', () => {
  const marks = parseTitle('Lunch fri 1pm', TODAY).marks;
  test.each<[number, string | null]>([[6, null], [7, 'fri 1pm'], [12, 'fri 1pm'], [13, null], [2, null]])('caret %i', (caret, found) => {
    const mark = markInside(marks, caret);
    expect(mark ? 'Lunch fri 1pm'.slice(mark.start, mark.end) : null).toBe(found);
  });
});

describe('E selects the line\'s title words', () => {
  test.each<[string, string]>([
    ['Dinner with Sam fri 7pm @Blue Door', 'Dinner with Sam'],
    ['fri 7pm Dinner with Sam', 'Dinner with Sam'],
    ['Dentist', 'Dentist'],
    ['Dinner fri with Sam', 'Dinner'],
    ['fri 7pm', ''],
    ['', ''],
  ])('%s', (text, selected) => {
    const run = titleRun(text, parseTitle(text, TODAY).marks);
    expect(text.slice(run.start, run.end)).toBe(selected);
  });
});
