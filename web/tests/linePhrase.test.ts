// The line's phrases against the editor's rows, as tables: a row's pick or clear deletes the phrase
// that set its field, and a phrase named afterwards takes the field back. Today is the seed's
// Wed, Oct 7, 2026.
import {describe, expect, test} from 'vitest';
import {parseTitle} from '../src/logic/compose.ts';
import {caretAfterCut, dropPhrases, keptPicks, namedFields, phraseOf, withoutPhrase} from '../src/logic/linePhrase.ts';
import type {LineField} from '../src/logic/linePhrase.ts';

const TODAY = '2026-10-07';
const CALENDARS = ['Personal', 'Classes', 'Jobs'];
const read = (text: string) => parseTitle(text, TODAY, CALENDARS, null, {kind: 'calendar', names: CALENDARS, picked: null});
const readTask = (text: string) => parseTitle(text, TODAY, [], null, {kind: 'project', names: ['Inbox', 'Home'], picked: null});

describe('a row\'s change deletes its field\'s phrase from the line', () => {
  test.each<[string, LineField[], string, LineField[]]>([
    ['Lunch 3pm', ['time'], 'Lunch', []],
    ['3pm Lunch', ['time'], 'Lunch', []],
    ['Lunch 3pm with Ana', ['time'], 'Lunch with Ana', []],
    ['Lunch at 3pm', ['time'], 'Lunch', []],
    // The day and time share one phrase: it goes whole, and the day keeps its value.
    ['Dinner fri 7-9pm', ['time'], 'Dinner', ['date']],
    ['Dinner fri 7-9pm', ['date'], 'Dinner', ['time']],
    ['Dinner fri 7-9pm', ['date', 'time'], 'Dinner', []],
    ['Gym every mon 9am', ['recurrence'], 'Gym', ['time', 'date']],
    // A phrase that doesn't set the field stays.
    ['Lunch fri', ['time'], 'Lunch fri', []],
    ['Lunch 3pm', ['date'], 'Lunch 3pm', []],
    ['Coffee @Blue Door fri', ['place'], 'Coffee fri', []],
    ['Standup #Jobs 9am', ['calendar'], 'Standup 9am', []],
    ['Standup cal Classes', ['calendar'], 'Standup', []],
    ['Lunch', ['time'], 'Lunch', []],
  ])('"%s" with %j set in its row', (text, fields, line, held) => {
    const dropped = dropPhrases(text, read, fields);
    expect(dropped.text).toBe(line);
    expect(dropped.held.sort()).toEqual(held.sort());
  });
  test('a task\'s #project and repeat', () => {
    expect(dropPhrases('Water plants #Home every day', readTask, ['project']).text).toBe('Water plants every day');
    expect(dropPhrases('Water plants #Home every day', readTask, ['recurrence']).text).toBe('Water plants #Home');
  });
  test('the fields a phrase sets', () => {
    expect(phraseOf('Dinner fri 7-9pm @Blue Door', read, 'place')).toMatchObject({fields: ['place']});
    expect(phraseOf('Trip oct 23-25', read, 'date')?.fields).toEqual(['date']);
    expect(phraseOf('Lunch fri', read, 'time')).toBeNull();
  });
});

describe('the caret moves only if it sat after the phrase', () => {
  test.each<[number, number]>([[0, 0], [5, 5], [6, 6], [8, 6], [10, 6], [14, 10]])('at %i', (caret, after) => {
    // "Lunch 3pm with Ana": "3pm " goes, from 6 for 4.
    expect(caretAfterCut(caret, {start: 6, length: 4})).toBe(after);
  });
  test('as dropPhrases moves it', () => {
    expect(dropPhrases('Lunch 3pm with Ana', read, ['time'], 18)).toMatchObject({text: 'Lunch with Ana', caret: 14});
    expect(dropPhrases('Lunch 3pm with Ana', read, ['time'], 3)).toMatchObject({caret: 3});
  });
  test('a phrase ending the line takes the space before it', () => {
    expect(withoutPhrase('Lunch 3pm', {start: 6, end: 9, kind: 'when'})).toEqual({text: 'Lunch', start: 5, length: 4});
  });
});

describe('a phrase named afterwards takes its field back from the row', () => {
  test.each<[string, LineField[], LineField[]]>([
    ['Lunch', ['date', 'time'], ['date', 'time']],
    ['Lunch 4pm', ['date', 'time'], ['date']],
    ['Lunch fri 4pm', ['date', 'time'], []],
    ['Lunch @Cafe', ['place', 'calendar'], ['calendar']],
    ['Lunch every day', ['recurrence'], []],
    ['Trip for 3 days', ['date'], []],
  ])('"%s" with %j set in rows', (text, manual, kept) => {
    expect(keptPicks(manual, read(text))).toEqual(kept);
  });
  test('labels and reminders keep their own rule', () => {
    expect(keptPicks(['labels', 'reminders'] as string[], read('Lunch remind me 1h before'))).toEqual(['labels', 'reminders']);
  });
  test('the fields a read names', () => {
    expect(namedFields(read('Dinner fri 7-9pm @Blue Door #Jobs every week'))).toEqual(['date', 'time', 'place', 'calendar', 'recurrence']);
  });
});
