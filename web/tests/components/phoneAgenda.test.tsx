// The phone Agenda's own widgets at 375 × 812: the month picker (AgendaMonthPicker.tsx) opens on the
// day in view's month, steps months, jumps to a picked day or to today and closes; the search's
// results (AgendaSearch.tsx) show the results line, Upcoming then Past, each row's day, title,
// line and why it matched, open a result, and say when nothing matches. The agenda's journeys on
// the seed are phoneAgenda.spec.ts's.
import type {CalendarOut, CalendarSearchOut, CalendarSearchResultOut, ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {beforeEach, expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import '../../src/app/calendar/agendaPhone.css';
import {AgendaMonthPicker} from '../../src/app/calendar/AgendaMonthPicker.tsx';
import {AgendaSearch} from '../../src/app/calendar/AgendaSearch.tsx';
import type {CalendarSearch} from '../../src/app/search/state.ts';

beforeEach(async () => {
  await page.viewport(375, 812);
});

test('the month picker opens on the day in view\'s month, steps, and a day or Today jumps and closes it', async () => {
  const picked = vi.fn();
  const today = vi.fn();
  const close = vi.fn();
  const shown = await render(<AgendaMonthPicker day="2026-10-20" today="2026-10-07" onPick={picked} onToday={today} onClose={close} />);
  const sheet = shown.getByRole('dialog', {name: 'Go to a day'});
  await expect.element(sheet.getByText('October 2026')).toBeVisible();
  await sheet.getByRole('button', {name: 'Next month'}).click();
  await expect.element(sheet.getByText('November 2026')).toBeVisible();
  await sheet.getByRole('button', {name: '2026-11-18'}).click();
  expect(picked).toHaveBeenCalledWith('2026-11-18');
  expect(close).toHaveBeenCalledTimes(1);
  await sheet.getByRole('button', {name: 'Today'}).click();
  expect(today).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(2);
  // A finger's size: each day is 40 px.
  const day = sheet.getByRole('button', {name: '2026-11-18'}).element().getBoundingClientRect();
  expect(day.height).toBeGreaterThanOrEqual(40);
});

const CALENDARS = new Map<number, CalendarOut>([
  [1, {id: 1, provider: 'google', account_id: 1, name: 'Personal', colour: 'cool', position: 1, visible: true, listed: true, writable: true, command: null}],
]);

function item(fields: Partial<ItemOut>): ItemOut {
  return {
    key: '2', id: 2, calendar_id: 1, kind: 'event', title: 'Dentist', time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
    place: 'Smile Dental', address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null,
    all_day: false, starts_at: '2026-10-07T21:30:00.000Z', ends_at: '2026-10-07T22:30:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null, ...fields,
  };
}

const DENTIST: CalendarSearchResultOut = {
  item: item({}), date: '2026-10-07', upcoming: true, rule: null, highlights: [],
  reasons: [{field: 'place', key: 'Place', value: 'Smile Dental', runs: [{start: 0, end: 5}]}],
} as CalendarSearchResultOut;
const LIBRARY: CalendarSearchResultOut = {
  item: item({key: '18', id: 18, kind: 'task', title: 'Renew the library card', calendar_id: 1, place: null, starts_at: null, ends_at: null, all_day: true, due_date: '2025-09-24', project: 'Inbox'}),
  date: '2025-09-24', upcoming: false, rule: null, highlights: [{start: 10, end: 17}], reasons: [{field: 'title', key: 'Title', value: 'Renew the library card', runs: [{start: 10, end: 17}]}],
} as CalendarSearchResultOut;

function search(results: CalendarSearchResultOut[], text = 'smile'): CalendarSearch {
  const out = {chips: [], text, results, next_offset: null, total: results.length} as unknown as CalendarSearchOut;
  const none = () => {};
  return {chips: [], text, active: true, out, results, error: null, pending: false, setText: none, settle: () => Promise.resolve(null), removeChip: none, clearText: none, clear: none, loadMore: none, update: none};
}

test('the results: the line, Upcoming then Past, each row\'s day, marked title, line and why, and a tap opens one', async () => {
  const chosen = vi.fn();
  const shown = await render(<AgendaSearch search={search([DENTIST, LIBRARY])} calendars={CALENDARS} selectedKey={null} today="2026-10-07" timeZone={SEED_TIME_ZONE} onSelect={chosen} />);
  const list = shown.getByRole('region', {name: 'Search results'});
  await expect.element(list.getByText('2 results')).toBeVisible();
  expect([...list.element().querySelectorAll('.pday')].map(head => head.textContent)).toEqual(['Upcoming', 'Past']);
  const rows = [...list.element().querySelectorAll<HTMLElement>('.ph-res')];
  expect(rows.map(row => row.querySelector('.when')!.textContent)).toEqual(['Oct 7', 'Sep 24 2025']);
  expect(rows[0]!.querySelector('.ph-res-line')!.textContent).toBe('2:30 – 3:30 PM · Smile Dental');
  expect(rows[0]!.querySelector('.ph-res-why')!.textContent).toBe('Place Smile Dental');
  // The title's match is marked, so a title reason isn't said again.
  expect(rows[1]!.querySelector('.ph-res-title mark')!.textContent).toBe('library');
  expect(rows[1]!.querySelector('.ph-res-why')).toBeNull();
  // Nothing spills off the row at 375 px.
  for (const row of rows) expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  await list.getByText('Dentist').click();
  expect(chosen).toHaveBeenCalledWith(DENTIST);
});

test('no results say so', async () => {
  const shown = await render(<AgendaSearch search={search([], 'zzz')} calendars={CALENDARS} selectedKey={null} today="2026-10-07" timeZone={SEED_TIME_ZONE} onSelect={() => {}} />);
  await expect.element(shown.getByText('No events or tasks match')).toBeVisible();
});
