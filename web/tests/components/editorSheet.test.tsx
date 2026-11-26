// The phone's editor sheet (app/phone/EditorSheet.tsx) at 375 × 812, the server faked at fetch: a
// new item opens as "New event" with Cancel and Create in the top bar, Create waiting for a title
// and sending what the line read; an item opens as "Edit event" with Save; a repeating event's Save
// asks This event, This and following or All events in the sheet, the top bar's action waiting
// meanwhile; Cancel and Esc close it with nothing sent, Cancel on words typed asking Keep editing or
// Discard first. Edit opens with no row over its fields and the keyboard down. An event's All day is
// a switch above Starts. Its fields are 16 px, so iOS doesn't zoom in on them, and its date picker
// fits the screen. A repeating event's Delete asks Delete this event, Delete future events or Delete
// all events in the bottom sheet, with Cancel, and a delete waits out its toast: Undo sends nothing
// (itemActions.ts). The sheet's
// own top bar and Esc are phoneSheets.test.tsx's; the journeys on the seed are phoneAgenda.spec.ts's.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import {clearCache, setCached} from '../../src/api/client.ts';
import {CALENDARS_PATH} from '../../src/api/items.ts';
import {Editor} from '../../src/app/calendar/Editor.tsx';
import {closeEditorSheet, openEditorSheet, PhoneSheets, removeItem} from '../../src/app/phone/EditorSheet.tsx';
import {deleteWithUndo, toggleDone} from '../../src/app/phone/itemActions.ts';
import {dismissToast} from '../../src/app/toast.ts';
import {ToastPill} from '../../src/app/ToastPill.tsx';

const CALENDARS: CalendarOut[] = [
  {id: 1, provider: 'google', account_id: 1, name: 'Personal', colour: 'cool', position: 1, visible: true, listed: true, writable: true, command: null},
  {id: 9, provider: 'todoist', account_id: 2, name: 'Todoist', colour: 'warm', position: 9, visible: true, listed: true, writable: true, command: null},
];

function event(fields: Partial<ItemOut> = {}): ItemOut {
  return {
    key: '4', id: 4, calendar_id: 1, kind: 'event', title: 'Dentist', time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null,
    all_day: false, starts_at: '2026-10-07T21:30:00.000Z', ends_at: '2026-10-07T22:30:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null, ...fields,
  };
}
const GYM = event({key: '1:2026-10-07T14:00:00.000Z', id: 1, title: 'Gym', recurring: true, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', occurrence_start: '2026-10-07T14:00:00.000Z',
  starts_at: '2026-10-07T14:00:00.000Z', ends_at: '2026-10-07T15:00:00.000Z'});

/** The server, faked at fetch: every change it was sent, as "METHOD path" and its body. */
function server() {
  const sent: {at: string; body: Record<string, unknown>}[] = [];
  const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}}));
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), location.href);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      sent.push({at: `${method} ${url.pathname}`, body: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {}});
      const command = {id: sent.length, target: 'item', target_id: 40 + sent.length, kind: 'item_create', state: 'done', provider: 'google_calendar', provider_message: null, retry: null,
        can_retry: false, can_move_back: false, previous: null, created_at: '2026-10-07T16:12:00.000Z', settled_at: '2026-10-07T16:12:00.000Z'};
      return answer(command, 201);
    }
    if (url.pathname === '/api/items') return answer({from: url.searchParams.get('from'), to: url.searchParams.get('to'), items: []});
    return answer({error: {code: 'not_found', message: 'Not here.'}}, 404);
  });
  return sent;
}

beforeEach(async () => {
  await page.viewport(375, 812);
  setCached(CALENDARS_PATH, CALENDARS);
});

afterEach(() => {
  closeEditorSheet();
  dismissToast();
  clearCache();
  vi.restoreAllMocks();
});

const sheet = (name: string) => page.getByRole('dialog', {name});
const topBar = (name: string) => [...sheet(name).element().querySelectorAll('.ph-sheet-top > *')].map(part => part.textContent);

test('a new event: Cancel, its title and Create, which waits for a title and sends what the line read, then closes', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await expect.element(sheet('New event')).toBeVisible();
  expect(topBar('New event')).toEqual(['Cancel', 'New event', 'Create']);
  const create = sheet('New event').getByRole('button', {name: 'Create'});
  await expect.element(create).toBeDisabled();
  // The desktop's head and footer give way to the top bar: no close button, no footer Create.
  expect(document.querySelector('.ph-sheet [aria-label="Close editor"], .ph-sheet .ed-foot')).toBeNull();
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch with Ana 12-1pm');
  await expect.element(page.getByLabelText('Start', {exact: true})).toHaveValue('12:00');
  await userEvent.click(create);
  await expect.element(sheet('New event')).not.toBeInTheDocument();
  await expect.poll(() => sent.map(one => one.at)).toEqual(['POST /api/items']);
  expect(sent[0]!.body).toMatchObject({kind: 'event', calendar_id: 1, title: 'Lunch with Ana', all_day: false, starts_at: '2026-10-09T19:00:00.000Z', ends_at: '2026-10-09T20:00:00.000Z'});
});

test('on a page that isn\'t a secure context (plain http, as the dev Setpoint on the LAN), where Safari has no crypto.randomUUID, the sheet still opens', async () => {
  server();
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new TypeError('crypto.randomUUID is not a function'); });
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await expect.element(sheet('New event')).toBeVisible();
});

test('Task in the sheet makes it a task, its title "New task"', async () => {
  server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.click(page.getByRole('tab', {name: 'Task'}));
  await expect.element(sheet('New task')).toBeVisible();
  await expect.element(page.getByLabelText('Describe the task')).toBeVisible();
});

test('Cancel and Esc close it with nothing sent; Cancel on a draft with words asks Keep editing or Discard first', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  // Nothing typed: Cancel closes at once.
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Cancel'}));
  await expect.element(sheet('New event')).not.toBeInTheDocument();
  // Words typed: Cancel asks, Keep editing keeps them, and Discard closes.
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch with Ana 12-1pm');
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Cancel'}));
  const asking = sheet('Discard this event?');
  await userEvent.click(asking.getByRole('button', {name: 'Keep editing'}));
  await expect.element(asking).not.toBeInTheDocument();
  await expect.element(page.getByLabelText('Describe the event')).toHaveValue('Lunch with Ana 12-1pm');
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Cancel'}));
  await userEvent.click(asking.getByRole('button', {name: 'Discard event'}));
  await expect.element(sheet('New event')).not.toBeInTheDocument();
  // Esc while it asks closes the question alone.
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch with Ana 12-1pm');
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Cancel'}));
  await expect.element(asking).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(asking).not.toBeInTheDocument();
  await expect.element(sheet('New event')).toBeVisible();
  closeEditorSheet();
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await expect.element(sheet('New event')).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(sheet('New event')).not.toBeInTheDocument();
  expect(sent).toEqual([]);
});

test('an item opens as Edit with Save, which sends only what changed', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-07', item: event()});
  await expect.element(sheet('Edit event')).toBeVisible();
  expect(topBar('Edit event')).toEqual(['Cancel', 'Edit event', 'Save']);
  await expect.element(page.getByLabelText('Title')).toHaveValue('Dentist');
  await userEvent.fill(page.getByLabelText('Title'), 'Dentist checkup');
  await userEvent.click(sheet('Edit event').getByRole('button', {name: 'Save'}));
  await expect.element(sheet('Edit event')).not.toBeInTheDocument();
  await expect.poll(() => sent.map(one => one.at)).toEqual(['PATCH /api/items/4']);
  expect(sent[0]!.body).toEqual({changes: {title: 'Dentist checkup'}, scope: 'this', occurrence_start: null});
});

test('Edit opens with no row over its fields (Delete is the detail\'s) and the keyboard down, the title not selected', async () => {
  server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-07', item: event()});
  await expect.element(page.getByLabelText('Title')).toHaveValue('Dentist');
  expect(sheet('Edit event').element().querySelector('.ed-head')).toBeNull();
  await expect.element(sheet('Edit event').getByRole('button', {name: 'More'})).not.toBeInTheDocument();
  expect(document.activeElement).not.toBe(page.getByLabelText('Title').element());
});

test('a repeating event\'s Save asks which of its events, the top bar\'s action waiting, and sends the one picked', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-07', item: GYM});
  await userEvent.fill(page.getByLabelText('Title'), 'Gym class');
  await userEvent.click(sheet('Edit event').getByRole('button', {name: 'Save'}));
  const which = page.getByRole('radiogroup', {name: 'Which events'});
  await expect.element(which).toBeVisible();
  expect(topBar('Edit event')).toEqual(['Cancel', 'Edit event']);
  expect(sent).toEqual([]);
  await userEvent.click(which.getByRole('radio', {name: /^All events/}));
  await userEvent.click(page.getByRole('button', {name: 'Save', exact: true}));
  await expect.element(sheet('Edit event')).not.toBeInTheDocument();
  await expect.poll(() => sent.map(one => one.at)).toEqual(['PATCH /api/items/1']);
  expect(sent[0]!.body).toMatchObject({changes: {title: 'Gym class'}, scope: 'all'});
});

/** Each day and time field shows its whole value, at 16 px or more, as do the rest of the sheet's fields. */
function fieldsFit() {
  for (const field of document.querySelectorAll<HTMLElement>('.ph-editor input, .ph-editor textarea, .ph-editor [contenteditable="true"], .ph-editor .native-pick .shown')) {
    expect(parseFloat(getComputedStyle(field).fontSize), field.getAttribute('aria-label') ?? field.className).toBeGreaterThanOrEqual(16);
  }
  const shown = [...document.querySelectorAll<HTMLElement>('.ph-editor .native-pick .shown')];
  expect(shown.length).toBeGreaterThan(0);
  for (const value of shown) expect(value.scrollWidth, value.textContent!).toBeLessThanOrEqual(value.clientWidth);
}

test('its fields are at least 16 px, so iOS doesn\'t zoom in on one, and a day and its times show whole: an event\'s, a task\'s with its time and ×, a custom reminder\'s', async () => {
  server();
  await render(<PhoneSheets />);
  // The widest days and times there are: a Wednesday the 30th, a quarter to eleven.
  openEditorSheet({kind: 'event', date: '2026-09-30'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch 10:45am-12:45pm');
  await expect.element(page.getByLabelText('End', {exact: true})).toHaveValue('12:45');
  fieldsFit();
  closeEditorSheet();
  openEditorSheet({kind: 'task', date: '2026-09-30'});
  await expect.element(sheet('New task')).toBeVisible();
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Add a time'}));
  await userEvent.fill(page.getByLabelText('Time', {exact: true}), '10:45');
  await expect.element(sheet('New task').getByRole('button', {name: 'Remove due date'})).toBeVisible();
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Add reminder', exact: true}));
  await userEvent.click(page.getByRole('menuitem', {name: /Custom/}));
  await expect.element(page.getByLabelText('Reminder date')).toHaveValue('2026-09-30');
  fieldsFit();
});

test('the day and times are iOS\'s own pickers, and a pick changes the draft: the start moves the event, the end ends it, an earlier end runs past midnight', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch with Ana 12-1pm');
  expect(['Date', 'Start', 'End date', 'End'].map(label => (page.getByLabelText(label, {exact: true}).element() as HTMLInputElement).type)).toEqual(['date', 'time', 'date', 'time']);
  await userEvent.fill(page.getByLabelText('Date', {exact: true}), '2026-10-12');
  await expect.element(page.getByLabelText('End date', {exact: true})).toHaveValue('2026-10-12');
  await userEvent.fill(page.getByLabelText('Start', {exact: true}), '13:30');
  // The end keeps the hour.
  await expect.element(page.getByLabelText('End', {exact: true})).toHaveValue('14:30');
  await userEvent.fill(page.getByLabelText('End', {exact: true}), '15:00');
  expect([...document.querySelectorAll('.ph-editor .native-pick .shown')].map(one => one.textContent)).toEqual(['Mon, Oct 12', '1:30 PM', 'Mon, Oct 12', '3:00 PM']);
  // Neither the typed fields' month nor their list of times.
  expect(document.querySelector('.ph-editor .datepop, .ph-editor .timelist')).toBeNull();
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Create'}));
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.body).toMatchObject({title: 'Lunch with Ana', all_day: false, starts_at: '2026-10-12T20:30:00.000Z', ends_at: '2026-10-12T22:00:00.000Z'});

  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Late show 11pm');
  await userEvent.fill(page.getByLabelText('End', {exact: true}), '01:00');
  await expect.element(page.getByLabelText('End date', {exact: true})).toHaveValue('2026-10-10');
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Create'}));
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body).toMatchObject({title: 'Late show', starts_at: '2026-10-10T06:00:00.000Z', ends_at: '2026-10-10T08:00:00.000Z'});
});

test('an all-day event\'s Starts and Ends are its first and last days', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Trip');
  await userEvent.click(sheet('New event').getByRole('switch', {name: 'All day'}));
  await expect.element(page.getByLabelText('Start', {exact: true})).not.toBeInTheDocument();
  await userEvent.fill(page.getByLabelText('End date', {exact: true}), '2026-10-11');
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Create'}));
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.body).toMatchObject({title: 'Trip', all_day: true, start_date: '2026-10-09', end_date: '2026-10-12'});
});

test('an event\'s All day is a switch above Starts: on, its times go; off, the times it had come back', async () => {
  server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-07', item: event()});
  const allDay = sheet('Edit event').getByRole('switch', {name: 'All day'});
  await expect.element(allDay).toHaveAttribute('aria-checked', 'false');
  // Above Starts, and no × beside the end time.
  const order = [...sheet('Edit event').element().querySelectorAll('[role="switch"], .ph-when-label')].map(part => part.getAttribute('aria-label') ?? part.textContent);
  expect(order.slice(0, 2)).toEqual(['All day', 'Starts']);
  expect(sheet('Edit event').element().querySelector('.ph-when .ibtn')).toBeNull();
  await userEvent.click(allDay);
  await expect.element(allDay).toHaveAttribute('aria-checked', 'true');
  await expect.element(page.getByLabelText('Start', {exact: true})).not.toBeInTheDocument();
  await userEvent.click(allDay);
  await expect.element(page.getByLabelText('Start', {exact: true})).toHaveValue('14:30');
  await expect.element(page.getByLabelText('End', {exact: true})).toHaveValue('15:30');
});

test('a task\'s due day and time are iOS\'s pickers too, and its × leaves it with no date', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'task', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the task'), 'Pay rent');
  await userEvent.fill(page.getByLabelText('Due date', {exact: true}), '2026-10-14');
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Add a time'}));
  await userEvent.fill(page.getByLabelText('Time', {exact: true}), '08:15');
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Create'}));
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]!.body).toMatchObject({kind: 'task', title: 'Pay rent', due_date: '2026-10-14', due_at: '2026-10-14T15:15:00.000Z'});

  openEditorSheet({kind: 'task', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the task'), 'Someday');
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Remove due date'}));
  await expect.element(page.getByLabelText('Due date', {exact: true})).toHaveValue('');
  expect(document.querySelector('.ph-editor .pick-date .shown')!.textContent).toBe('No date');
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Create'}));
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[1]!.body).toMatchObject({title: 'Someday', due_date: null, due_at: null});
});

test('a new task\'s custom reminder is picked with iOS\'s pickers: its day and time, then Add', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'task', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the task'), 'Pay rent 5pm');
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Add reminder', exact: true}));
  await userEvent.click(page.getByRole('menuitem', {name: /Custom/}));
  const day = page.getByLabelText('Reminder date', {exact: true});
  const time = page.getByLabelText('Reminder time', {exact: true});
  // Opened, it waits for a tap rather than popping a picker up.
  expect(document.activeElement).not.toBe(day.element());
  expect([(day.element() as HTMLInputElement).type, (time.element() as HTMLInputElement).type]).toEqual(['date', 'time']);
  await userEvent.fill(day, '2026-10-08');
  await userEvent.fill(time, '20:00');
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Add', exact: true}));
  await expect.element(sheet('New task').getByRole('group', {name: 'Custom reminder'})).not.toBeInTheDocument();
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Create'}));
  await expect.poll(() => sent.length).toBe(1);
  // 21 hours before 5 PM the next day.
  expect((sent[0]!.body.reminders as number[])).toContain(21 * 60);
});

test('Add another is the desktop\'s: the phone\'s sheet makes one item at a time', async () => {
  server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch with Ana 12-1pm');
  expect(document.querySelector('.ph-editor .batch')).toBeNull();
  await expect.element(page.getByRole('button', {name: 'Add another'})).not.toBeInTheDocument();
  closeEditorSheet();
  await render(<Editor open={{kind: 'event', date: '2026-10-09'}} calendars={CALENDARS} today="2026-10-07" timeZone={SEED_TIME_ZONE} handed={false}
    dayItems={() => []} onPreview={() => {}} onCreate={() => {}} onSave={() => {}} onDelete={() => {}} onClose={() => {}} />);
  await expect.element(page.getByRole('button', {name: 'Add another'})).toBeVisible();
});

test('every menu in the sheet fits the screen: the calendar, the colour, the repeat, a reminder\'s, a task\'s project and labels', async () => {
  server();
  setCached('/todoist/projects', [{id: 'p1', name: 'Home', colour: 'berry_red', inbox: false, command: null}, {id: 'p2', name: 'Inbox', colour: 'grey', inbox: true, command: null}]);
  setCached('/todoist/labels', [{id: 'l1', name: 'errand', colour: 'grey'}]);
  await render(<PhoneSheets />);
  const fits = async (what: string) => {
    await expect.poll(() => document.querySelector('.ph-editor .pop'), {message: what}).not.toBeNull();
    const box = document.querySelector('.ph-editor .pop')!.getBoundingClientRect();
    expect([box.left >= 0, box.right <= 375, box.top >= 0, box.bottom <= 812], what).toEqual([true, true, true, true]);
    await userEvent.keyboard('{Escape}');
    await expect.poll(() => document.querySelector('.ph-editor .pop'), {message: what}).toBeNull();
  };
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await expect.element(sheet('New event')).toBeVisible();
  for (const name of ['Calendar', 'Colour', 'Repeat', 'Add reminder']) {
    await userEvent.click(sheet('New event').getByRole('button', {name, exact: true}));
    await fits(name);
  }
  closeEditorSheet();
  openEditorSheet({kind: 'task', date: '2026-10-09'});
  await expect.element(sheet('New task')).toBeVisible();
  await userEvent.click(page.getByLabelText('Project', {exact: true}));
  await fits('Project');
  await userEvent.click(sheet('New task').getByRole('button', {name: 'Add label', exact: true}));
  await fits('Add label');
});

/** The Colour button's dot, as the colour it's drawn in. */
const colourDot = () => sheetButton('Colour').element().querySelector<HTMLElement>('.dot')!.style.getPropertyValue('--c');
const sheetButton = (name: string) => page.getByRole('button', {name, exact: true});

test('an event\'s Colour button shows its calendar\'s colour until a swatch is picked, and Create sends the pick', async () => {
  const sent = server();
  setCached(CALENDARS_PATH, [...CALENDARS, {...CALENDARS[0]!, id: 2, name: 'Work', colour: 'good', position: 2}]);
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await expect.element(sheet('New event')).toBeVisible();
  expect(colourDot()).toBe('var(--cool)');
  // Another calendar, and the dot follows it while the event has no colour of its own.
  await userEvent.click(sheetButton('Calendar'));
  await userEvent.click(page.getByRole('menuitemradio', {name: 'Work'}));
  await expect.poll(colourDot).toBe('var(--good)');
  await userEvent.click(sheetButton('Colour'));
  await userEvent.click(page.getByRole('radio', {name: 'sun'}));
  await expect.element(page.getByRole('radiogroup', {name: 'Colour'})).not.toBeInTheDocument();
  await expect.poll(colourDot).toBe('var(--sun)');
  // Its own colour stays when the calendar changes again.
  await userEvent.click(sheetButton('Calendar'));
  await userEvent.click(page.getByRole('menuitemradio', {name: 'Personal'}));
  await expect.poll(colourDot).toBe('var(--sun)');
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch with Ana 12-1pm');
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Create'}));
  await expect.poll(() => sent.map(one => one.at)).toEqual(['POST /api/items']);
  expect(sent[0]!.body).toMatchObject({calendar_id: 1, colour: 'sun'});
});

test('an event with its own colour shows it on the button, and picking its calendar\'s colour saves it with none', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-07', item: event({colour: 'warm'})});
  await expect.element(sheet('Edit event')).toBeVisible();
  expect(colourDot()).toBe('var(--warm)');
  await expect.element(page.getByText('Its own colour')).not.toBeInTheDocument();
  await userEvent.click(sheetButton('Colour'));
  await expect.element(page.getByRole('radio', {name: 'warm'})).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(page.getByRole('radio', {name: 'Personal\'s colour'}));
  await expect.poll(colourDot).toBe('var(--cool)');
  await userEvent.click(sheet('Edit event').getByRole('button', {name: 'Save'}));
  await expect.poll(() => sent.map(one => one.at)).toEqual(['PATCH /api/items/4']);
  expect(sent[0]!.body).toMatchObject({changes: {colour: null}});
});

test('a task has no Colour button, its Project field the row', async () => {
  server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'task', date: '2026-10-09'});
  await expect.element(page.getByLabelText('Project', {exact: true})).toBeVisible();
  expect(document.querySelector('.ph-editor [aria-label="Colour"]')).toBeNull();
});

test('a repeating task\'s completion sends its occurrence\'s day, and its Undo reopens the done occurrence it made', async () => {
  const sent = server();
  await render(<ToastPill />);
  const water = event({key: '7', id: 7, kind: 'task', calendar_id: 9, title: 'Water the plants', recurring: true, due_date: '2026-10-07', due_string: 'every day',
    starts_at: null, ends_at: null});
  toggleDone(water);
  await expect.element(page.getByText('Completed Water the plants')).toBeVisible();
  expect(sent.map(one => [one.at, one.body])).toEqual([['POST /api/items/7/complete', {done: true, occurrence_date: '2026-10-07'}]]);
  await userEvent.click(page.getByRole('button', {name: 'Undo'}));
  // The fake's answer named item 41, the done occurrence.
  await expect.poll(() => sent.map(one => [one.at, one.body])).toEqual([['POST /api/items/7/complete', {done: true, occurrence_date: '2026-10-07'}], ['POST /api/items/41/complete', {done: false, occurrence_date: null}]]);
});

test('a repeating event\'s Delete asks which of its events in the bottom sheet, and a delete waits out its toast', async () => {
  const sent = server();
  await render(<><PhoneSheets /><ToastPill /></>);
  removeItem(GYM);
  const asking = page.getByRole('dialog', {name: 'Delete recurring event'});
  await expect.element(asking).toBeVisible();
  expect([...asking.element().querySelectorAll('.ph-bs-i > .ell')].map(label => label.textContent)).toEqual(['Delete this event', 'Delete future events', 'Delete all events', 'Cancel']);
  await userEvent.click(asking.getByRole('button', {name: /^Delete future events/}));
  await expect.element(asking).not.toBeInTheDocument();
  await expect.element(page.getByText('Deleted Gym')).toBeVisible();
  expect(sent).toEqual([]);
  // The toast going sends it.
  dismissToast();
  await expect.poll(() => sent.map(one => one.at)).toEqual(['POST /api/items/1/delete']);
  expect(sent[0]!.body).toEqual({scope: 'following', occurrence_start: '2026-10-07T14:00:00.000Z'});
});

test('the repeating delete\'s Cancel keeps every event and sends nothing', async () => {
  const sent = server();
  await render(<><PhoneSheets /><ToastPill /></>);
  removeItem(GYM);
  const asking = page.getByRole('dialog', {name: 'Delete recurring event'});
  await userEvent.click(asking.getByRole('button', {name: 'Cancel'}));
  await expect.element(asking).not.toBeInTheDocument();
  await expect.element(page.getByText('Deleted Gym')).not.toBeInTheDocument();
  expect(sent).toEqual([]);
});

test('Undo on a delete keeps the item and sends nothing', async () => {
  const sent = server();
  await render(<ToastPill />);
  deleteWithUndo(event());
  await userEvent.click(page.getByRole('button', {name: 'Undo'}));
  await expect.element(page.getByText('Deleted Dentist')).not.toBeInTheDocument();
  dismissToast();
  expect(sent).toEqual([]);
});
