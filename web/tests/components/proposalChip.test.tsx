// Alfred's proposal chip in his answer: one from the user's words says what, when and where with no
// "from this email", and Create sends it as it stands. A change to an existing item leads with what
// it becomes, what it was struck under it, and which of a recurring event's events change; Save
// sends only the changed fields with its scope and occurrence. Edit opens the full card in its place
// with Alfred's changes filled in and marked, Cancel comes back to the chip, and the card's Save
// sends only what differs from the item. Nothing is sent before Create or Save, and either one
// going through tells the server the proposal was acted on. What Alfred set beyond the title, day,
// times and place shows on one line (a change's was-line struck), and in the full card marked as
// his. A later answer's proposal replaces an earlier one not acted on. The server is faked at
// fetch: the calendars, the days' items and the commands.
import type {AnswerOut, CalendarOut, ItemOut, ProposalOut} from '@setpoint/shared';
import {DEFAULT_SETTINGS, SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {AnswerCard} from '../../src/app/search/AnswerCard.tsx';
import type {Alfred} from '../../src/app/search/state.ts';

const NOW = Date.parse(SEED_NOW);
const CALENDARS: CalendarOut[] = [{id: 2, provider: 'google', account_id: 1, name: 'Personal', colour: 'cool', position: 0, visible: true, listed: true, writable: true, command: null}];

const GYM_START = '2026-10-09T14:00:00.000Z';
const gym: ItemOut = {
  key: `7@${GYM_START}`, id: 7, calendar_id: 2, kind: 'event', title: 'Gym', time_zone: SEED_TIME_ZONE, recurring: true, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', occurrence_start: GYM_START,
  place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null,
  all_day: false, starts_at: GYM_START, ends_at: '2026-10-09T15:00:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null,
  read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null,
};
const MOVED = {starts_at: '2026-10-08T14:00:00.000Z', ends_at: '2026-10-08T15:00:00.000Z'};
const CHANGE: ProposalOut = {
  kind: 'event', message_id: null, from_email: [], conflict: {free: true, label: 'Free that morning'},
  item: {kind: 'event', calendar_id: 2, title: 'Gym', all_day: false, ...MOVED, start_date: null, end_date: null, due_date: null, due_at: null, time_zone: SEED_TIME_ZONE, place: null, project: null},
  change: {item: gym, changes: {all_day: false, start_date: null, end_date: null, ...MOVED}, scope: 'this'},
};
const DENTIST: ProposalOut = {
  kind: 'event', message_id: null, from_email: [], conflict: {free: true, label: 'Free that afternoon'},
  item: {kind: 'event', calendar_id: 2, title: 'Dentist', all_day: false, starts_at: '2026-10-13T22:00:00.000Z', ends_at: '2026-10-13T23:00:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null, time_zone: SEED_TIME_ZONE, place: null, project: null},
};

// Each answer its own turn: what's acted on is kept by turn for the page's life, as in the app.
let turns = 100;
const answer = (proposal: ProposalOut, turnId = ++turns): AnswerOut => ({
  conversation_id: 1, turn_id: turnId, ends_at: SEED_NOW, question: 'Move gym to Thursday', answer: 'Ready for you to review.', emphasis: [],
  sources: [], items: [], applications: [], searched: [], proposals: [proposal], fixes: [],
});
const acted = (turnId = turns) => ({method: 'POST', path: '/alfred/acted', body: {turn_id: turnId, index: 0}});
const alfredWith = (turns: AnswerOut[]): Alfred => ({open: true, turns, waiting: null, step: null, trail: [], error: null, failed: null, start: vi.fn(), ask: vi.fn(), close: vi.fn()});
const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
const confirmed = {id: 1, target: 'item', target_id: 7, kind: 'item_update', state: 'confirmed', provider: 'google', provider_message: null, retry: null, can_retry: false, can_move_back: false, previous: null, created_at: SEED_NOW, settled_at: SEED_NOW};

let sent: {method: string; path: string; body: unknown}[] = [];
beforeEach(() => {
  sent = [];
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      sent.push({method, path: url.pathname.replace(/^\/api/, ''), body: init?.body ? JSON.parse(String(init.body)) : null});
      return url.pathname.endsWith('/alfred/acted') ? new Response(null, {status: 204}) : json(confirmed);
    }
    if (url.pathname.endsWith('/calendars')) return json(CALENDARS);
    if (url.pathname.endsWith('/items')) return json({from: url.searchParams.get('from'), to: url.searchParams.get('to'), items: url.searchParams.get('from') === '2026-10-09' ? [gym] : []});
    if (url.pathname.endsWith('/settings')) return json({...DEFAULT_SETTINGS, reminders: {event_minutes_before: null, task_time: null}, time_to_leave: {enabled: true, buffer_minutes: 5}, todoist: {default_project: null}});
    // Settings › AI's keys. Every other list (accounts) is empty.
    if (url.pathname.endsWith('/ai')) return json({keys: {anthropic: true}});
    return json([]);
  });
});
afterEach(() => vi.restoreAllMocks());

const card = (list: AnswerOut[]) => <div style={{width: 560}}><AnswerCard alfred={alfredWith(list)} scoped={false} openId={null} accounts={new Map()} now={NOW} timeZone={SEED_TIME_ZONE} onOpen={vi.fn()} /></div>;
const show = (proposal: ProposalOut) => render(card([answer(proposal)]));

test('a proposal from the user\'s words says what, when and where, not from an email; Create sends it and the chip goes', async () => {
  await show(DENTIST);
  const chip = page.getByRole('region', {name: 'Proposal: add to calendar'});
  await expect.element(chip.getByText('Dentist')).toBeVisible();
  await expect.element(chip.getByText('Tue, Oct 13 · 3:00 – 4:00 PM')).toBeVisible();
  await expect.element(chip.getByText('Personal')).toBeVisible();
  expect(chip.element().textContent).not.toContain('from this email');
  expect(sent).toEqual([]);
  await chip.getByRole('button', {name: 'Create event'}).click();
  await expect.poll(() => sent).toEqual([{method: 'POST', path: '/items', body: expect.objectContaining({kind: 'event', calendar_id: 2, title: 'Dentist', starts_at: DENTIST.item.starts_at, ends_at: DENTIST.item.ends_at})}, acted()]);
  await expect.element(page.getByRole('region', {name: 'Proposal: add to calendar'})).not.toBeInTheDocument();
});

test('a change leads with what it becomes, what it was struck under it, and which events; Save sends only the changes', async () => {
  await show(CHANGE);
  const chip = page.getByRole('region', {name: 'Proposal: change event'});
  await expect.element(chip.getByText('Thu, Oct 8 · 7:00 – 8:00 AM')).toBeVisible();
  const was = chip.getByText('Fri, Oct 9 · 7:00 – 8:00 AM');
  await expect.element(was).toBeVisible();
  expect(getComputedStyle(was.element()).textDecorationLine).toBe('line-through');
  await expect.element(chip.getByText('This event only')).toBeVisible();
  expect(sent).toEqual([]);
  await chip.getByRole('button', {name: 'Save'}).click();
  await expect.poll(() => sent).toEqual([{method: 'PATCH', path: '/items/7', body: {changes: CHANGE.change!.changes, scope: 'this', occurrence_start: GYM_START}}, acted()]);
});

test('Edit opens the card with the change filled in and marked as Alfred\'s; Cancel comes back, and its Save sends only what differs', async () => {
  await show(CHANGE);
  await page.getByRole('region', {name: 'Proposal: change event'}).getByRole('button', {name: 'Edit'}).click();
  const card = page.getByRole('form', {name: 'Proposal: change event'});
  await expect.element(card.getByText('Was Fri, Oct 9 · 7:00 – 8:00 AM')).toBeVisible();
  await expect.element(card.getByRole('img', {name: 'Alfred\'s change'})).toBeVisible();
  await card.getByRole('button', {name: /^Cancel/}).click();
  await expect.element(page.getByRole('region', {name: 'Proposal: change event'})).toBeVisible();
  expect(sent).toEqual([]);

  await page.getByRole('region', {name: 'Proposal: change event'}).getByRole('button', {name: 'Edit'}).click();
  await page.getByRole('form', {name: 'Proposal: change event'}).getByRole('button', {name: /^Save/}).click();
  // A recurring event asks which of its events, Alfred's choice already picked.
  await page.getByRole('button', {name: /^Save/}).click();
  await expect.poll(() => sent).toEqual([{method: 'PATCH', path: '/items/7', body: {changes: {all_day: false, start_date: null, end_date: null, ...MOVED}, scope: 'this', occurrence_start: GYM_START}}, acted()]);
});

const SET: ProposalOut = {
  ...DENTIST, alfred: ['repeat', 'reminders', 'leave_reminder', 'colour'],
  item: {...DENTIST.item, place: 'Bright Smile', reminders: [30], leave_reminder: true, colour: 'alert', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU'},
};

test('what Alfred set shows on one line under the place, and in the full card marked as his; Create sends it', async () => {
  await show(SET);
  const chip = page.getByRole('region', {name: 'Proposal: add to calendar'});
  await expect.element(chip.getByText('Weekly on Tuesday · 30 min before · Time to Leave')).toBeVisible();
  await chip.getByRole('button', {name: 'Edit'}).click();
  const full = page.getByRole('form', {name: 'Proposal: add to calendar'});
  await expect.element(full.getByRole('button', {name: 'Repeat'})).toHaveTextContent('Weekly on Tuesday');
  // His colour is the Colour button's, his mark on it.
  await expect.element(full.getByRole('button', {name: 'Colour', exact: true}).getByRole('img', {name: 'From Alfred'})).toBeVisible();
  await expect.element(full.getByText('Time to Leave')).toBeVisible();
  // Repeat, reminders and colour each carry his mark, and the foot says what it means.
  expect(full.getByRole('img', {name: 'From Alfred'}).elements()).toHaveLength(3);
  await expect.element(full.getByText('From Alfred', {exact: true})).toBeVisible();
  await full.getByRole('button', {name: /^Create event/}).click();
  await expect.poll(() => sent).toEqual([
    {method: 'POST', path: '/items', body: expect.objectContaining({reminders: [30], leave_reminder: true, colour: 'alert', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU'})}, acted(),
  ]);
});

test('a change of reminders says them as they become, and struck under it, as they were', async () => {
  const change: ProposalOut = {...CHANGE, item: {...CHANGE.item, reminders: [60]}, change: {item: {...gym, reminders: [10]}, changes: {reminders: [60]}, scope: 'this'}};
  await show(change);
  const chip = page.getByRole('region', {name: 'Proposal: change event'});
  await expect.element(chip.getByText('1 hour before')).toBeVisible();
  const was = chip.getByText('10 min before');
  await expect.element(was).toBeVisible();
  expect(getComputedStyle(was.element()).textDecorationLine).toBe('line-through');
});

test('a later answer\'s proposal replaces one not acted on; one created stays made, and the next stands beside its line', async () => {
  const first = answer(DENTIST);
  const second = answer(SET);
  const screen = await render(card([first]));
  await expect.element(page.getByRole('region', {name: 'Proposal: add to calendar'})).toBeVisible();
  await screen.rerender(card([first, second]));
  await expect.element(page.getByText('Weekly on Tuesday · 30 min before · Time to Leave')).toBeVisible();
  expect(page.getByRole('region', {name: 'Proposal: add to calendar'}).elements()).toHaveLength(1);
  expect(sent).toEqual([]);

  // Created, the next answer's proposal leaves it be (its chip has gone, the event made).
  const third = answer(DENTIST);
  await screen.rerender(card([third]));
  await page.getByRole('region', {name: 'Proposal: add to calendar'}).getByRole('button', {name: 'Create event'}).click();
  await expect.poll(() => sent.at(-1)).toEqual(acted(third.turn_id));
  await expect.element(page.getByRole('region', {name: 'Proposal: add to calendar'})).not.toBeInTheDocument();
  await screen.rerender(card([third, answer(SET)]));
  await expect.element(page.getByText('Weekly on Tuesday · 30 min before · Time to Leave')).toBeVisible();
  expect(page.getByRole('region', {name: 'Proposal: add to calendar'}).elements()).toHaveLength(1);
});
