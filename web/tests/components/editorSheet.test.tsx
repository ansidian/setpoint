// The phone's editor sheet (app/phone/EditorSheet.tsx) at 375 × 812, the server faked at fetch: a
// new item opens as "New event" with Cancel and Create in the top bar, Create waiting for a title
// and sending what the line read; an item opens as "Edit event" with Save; a repeating event's Save
// asks This event, This and following or All events in the sheet, the top bar's action waiting
// meanwhile; Cancel and Esc close it with nothing sent. Its fields are 16 px, so iOS doesn't zoom in
// on them, and its date picker fits the screen. A repeating event's Delete asks the same in the
// bottom sheet, and a delete waits out its toast: Undo sends nothing (itemActions.ts). The sheet's
// own top bar and Esc are phoneSheets.test.tsx's; the journeys on the seed are phoneAgenda.spec.ts's.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import {clearCache, setCached} from '../../src/api/client.ts';
import {CALENDARS_PATH} from '../../src/api/items.ts';
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
  await expect.element(page.getByLabelText('Start', {exact: true})).toHaveValue('12:00 PM');
  await userEvent.click(create);
  await expect.element(sheet('New event')).not.toBeInTheDocument();
  await expect.poll(() => sent.map(one => one.at)).toEqual(['POST /api/items']);
  expect(sent[0]!.body).toMatchObject({kind: 'event', calendar_id: 1, title: 'Lunch with Ana', all_day: false, starts_at: '2026-10-09T19:00:00.000Z', ends_at: '2026-10-09T20:00:00.000Z'});
});

test('Task in the sheet makes it a task, its title "New task"', async () => {
  server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.click(page.getByRole('tab', {name: 'Task'}));
  await expect.element(sheet('New task')).toBeVisible();
  await expect.element(page.getByLabelText('Describe the task')).toBeVisible();
});

test('Cancel and Esc close it with nothing sent', async () => {
  const sent = server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await userEvent.fill(page.getByLabelText('Describe the event'), 'Lunch with Ana 12-1pm');
  await userEvent.click(sheet('New event').getByRole('button', {name: 'Cancel'}));
  await expect.element(sheet('New event')).not.toBeInTheDocument();
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

test('its fields are at least 16 px, so iOS doesn\'t zoom in on one, and the date picker fits the screen', async () => {
  server();
  await render(<PhoneSheets />);
  openEditorSheet({kind: 'event', date: '2026-10-09'});
  await expect.element(sheet('New event')).toBeVisible();
  for (const field of document.querySelectorAll<HTMLElement>('.ph-editor input, .ph-editor textarea, .ph-editor [contenteditable="true"]')) {
    expect(parseFloat(getComputedStyle(field).fontSize), field.getAttribute('aria-label') ?? field.className).toBeGreaterThanOrEqual(16);
  }
  // The date and both times each show their whole value.
  for (const label of ['Date', 'Start', 'End']) {
    const input = page.getByLabelText(label, {exact: true}).element() as HTMLInputElement;
    expect(input.scrollWidth, label).toBeLessThanOrEqual(input.clientWidth);
  }
  await userEvent.click(page.getByLabelText('Date', {exact: true}));
  const picker = document.querySelector('.ph-editor .datepop');
  expect(picker).not.toBeNull();
  const box = picker!.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(375);
});

test('every picker and menu in the sheet fits the screen: the times, the calendar, the repeat, a reminder\'s, a task\'s project and labels', async () => {
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
  for (const label of ['Start', 'End']) {
    await userEvent.click(page.getByLabelText(label, {exact: true}));
    await fits(label);
  }
  for (const name of ['Calendar', 'Repeat', 'Add reminder']) {
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
  await userEvent.click(asking.getByRole('button', {name: /^This and following/}));
  await expect.element(asking).not.toBeInTheDocument();
  await expect.element(page.getByText('Deleted Gym')).toBeVisible();
  expect(sent).toEqual([]);
  // The toast going sends it.
  dismissToast();
  await expect.poll(() => sent.map(one => one.at)).toEqual(['POST /api/items/1/delete']);
  expect(sent[0]!.body).toEqual({scope: 'following', occurrence_start: '2026-10-07T14:00:00.000Z'});
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
