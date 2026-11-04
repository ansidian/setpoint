// SV-191: a Google calendar the user can only read (a subscribed holiday calendar is `reader`).
// Its role is kept from the calendar list, calendarWritable says whether its events can change, and
// an ordinary event on it reads as read-only, refused as Google's own kinds of event are.
import {icsImportInput, itemCreateInput, itemScopeInput, itemUpdateInput} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {importEvent, readImport} from '../src/calendar/icsImport.ts';
import {createItem, deleteItem, updateItem} from '../src/commands/items.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {calendarWritable} from '../src/domain/calendarAccess.ts';
import {itemDetail} from '../src/queries/items.ts';
import {calendarWorld, HOLIDAYS, PERSONAL} from './calendarWorld.ts';
import {crlf, INTERVIEW_INVITE} from './fixtures/icsFiles.ts';

describe('whether a calendar can be written to, from Google\'s accessRole', () => {
  test.each([
    ['owner', true],
    ['writer', true],
    // Writes everything but private events (Andy, 2026-11-04).
    ['writerWithoutPrivateAccess', true],
    ['reader', false],
    ['freeBusyReader', false],
    // Todoist's, or a Google calendar not listed since the column came.
    [null, true],
    // A role Google adds later isn't known to write.
    ['commenter', false],
  ])('%s', (role, writable) => expect(calendarWritable(role)).toBe(writable));
});

describe('the calendar list', () => {
  test('keeps each calendar\'s role', async () => {
    const {run, calendar} = await calendarWorld();
    await run();
    expect([calendar(PERSONAL).accessRole, calendar(HOLIDAYS).accessRole]).toEqual(['owner', 'reader']);
  });
});

describe('an event on a calendar the user can only read', () => {
  test('reads as read-only, as Google\'s own kinds of event do, and an event on a writable calendar doesn\'t', async () => {
    const {w, run, day} = await calendarWorld();
    await run();
    const columbus = day('2026-10-12').find(item => item.title === 'Columbus Day')!;
    expect([columbus.read_only, day('2026-10-12').find(item => item.title === 'Gym')!.read_only]).toEqual([true, false]);
    // The row's own flag stays Google's kinds' alone: the calendar makes it read-only where the API answers.
    expect(w.store.db.select().from(t.items).where(eq(t.items.id, columbus.id)).get()!.readOnly).toBe(false);
    expect(itemDetail(w.store, columbus.id).read_only).toBe(true);
  });

  test('is refused a change, a delete, a new event, an event moved in and an import, in the calendar\'s words', async () => {
    const {w, run, day, calendar, item} = await calendarWorld();
    await run();
    const columbus = day('2026-10-12').find(item => item.title === 'Columbus Day')!;
    const holidays = calendar(HOLIDAYS).id;
    expect(() => updateItem(w.store, columbus.id, itemUpdateInput.parse({changes: {title: 'x'}}))).toThrow('This calendar is read-only.');
    expect(() => deleteItem(w.store, columbus.id, itemScopeInput.parse({}))).toThrow('This calendar is read-only.');
    expect(() => createItem(w.store, itemCreateInput.parse({
      kind: 'event', calendar_id: holidays, title: 'Mine', all_day: false, starts_at: zoned('2026-10-14', '09:00'), ends_at: zoned('2026-10-14', '10:00'),
    }))).toThrow('This calendar is read-only.');
    expect(() => updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {calendar_id: holidays}}))).toThrow('This calendar is read-only.');
    const {past: _past, existing: _existing, ...invite} = readImport(w.store, crlf(INTERVIEW_INVITE)).events[0]!;
    expect(() => importEvent(w.store, icsImportInput.parse({calendar_id: holidays, event: invite}))).toThrow('This calendar is read-only.');
    expect(w.store.db.select().from(t.commands).all()).toEqual([]);
  });

  test('a change asked for before Google said the calendar is read-only fails in place, and Google is never written', async () => {
    const {w, google, run, day, calendar, command} = await calendarWorld();
    await run();
    // As on a database from before the column: the role isn't known yet.
    w.store.db.update(t.calendars).set({accessRole: null}).where(eq(t.calendars.id, calendar(HOLIDAYS).id)).run();
    const columbus = day('2026-10-12').find(item => item.title === 'Columbus Day')!;
    expect(columbus.read_only).toBe(false);
    const renamed = updateItem(w.store, columbus.id, itemUpdateInput.parse({changes: {title: 'Columbus Day off'}}));
    w.store.db.update(t.calendars).set({accessRole: 'reader'}).where(eq(t.calendars.id, calendar(HOLIDAYS).id)).run();
    await run();
    expect(command(renamed.id)).toMatchObject({state: 'failed', providerMessage: 'This calendar is read-only.'});
    expect(google.event(HOLIDAYS, 'columbus')!.summary).toBe('Columbus Day');
  });
});
