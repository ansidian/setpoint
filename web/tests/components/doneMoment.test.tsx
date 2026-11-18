// The completion moment plays where a task turns done as it's drawn: its row takes `just-done` and
// its check bursts. A task reopened, or one already done when first drawn, plays nothing.
import type {CalendarOut, ItemOut, SubtaskOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {expect, test, vi} from 'vitest';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import {Chip} from '../../src/app/calendar/Chip.tsx';
import {Subtasks} from '../../src/app/calendar/Subtasks.tsx';

const TODOIST: CalendarOut = {id: 4, provider: 'todoist', account_id: null, name: 'Todoist', colour: null, position: 4, visible: true, listed: true, writable: true, command: null};

function task(fields: Partial<ItemOut> = {}): ItemOut {
  return {
    key: '7', id: 7, calendar_id: 4, kind: 'task', title: 'Pay rent', time_zone: null, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: 'Home', done: false, done_at: null, can_reopen: true, command: null,
    all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: '2026-10-07', due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: null, description: null, subtasks: [], parent_id: null, ...fields,
  };
}
const sub = (done: boolean): SubtaskOut => ({id: 21, title: 'Plot the timing data', done, command: null, parent_id: 7, due_date: null, due_at: null, reminders: []});

const chip = (item: ItemOut) => (
  <Chip item={item} calendar={TODOIST} selected={false} now={Date.parse('2026-10-07T16:00:00.000Z')} timeZone={SEED_TIME_ZONE} onSelect={vi.fn()} onComplete={vi.fn()} />
);
const checklist = (done: boolean) => <Subtasks task={task({subtasks: [sub(done)]})} ring={undefined} timeZone={SEED_TIME_ZONE} onComplete={vi.fn()} />;

const played = (row: string) => {
  const shown = document.querySelector(row)!;
  return {moment: shown.classList.contains('just-done'), burst: shown.querySelectorAll('.burst > i').length};
};

test.each([
  ['a grid chip', '.tk', chip(task()), chip(task({done: true}))],
  ['a subtask', '.subtask', checklist(false), checklist(true)],
])('%s ticked off plays the moment, and reopened plays nothing', async (_, row, open, done) => {
  const shown = await render(open);
  expect(played(row)).toEqual({moment: false, burst: 0});
  await shown.rerender(done);
  expect(played(row)).toEqual({moment: true, burst: 6});
  await shown.rerender(open);
  expect(played(row)).toEqual({moment: false, burst: 0});
});

test.each([
  ['a grid chip', '.tk', chip(task({done: true}))],
  ['a subtask', '.subtask', checklist(true)],
])('%s already done when first drawn plays nothing', async (_, row, done) => {
  await render(done);
  expect(played(row)).toEqual({moment: false, burst: 0});
});
