// The completion moment plays where a task turns done as it's drawn: its row takes `just-done` and
// its check bursts. A task reopened, or one already done when first drawn, plays nothing. A done
// check doesn't answer the pointer while its moment plays. A subtask confirmed mid-moment plays on.
import type {CalendarOut, ItemOut, SubtaskOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import {Chip} from '../../src/app/calendar/Chip.tsx';
import {Subtasks} from '../../src/app/calendar/Subtasks.tsx';
import {DONE_MOMENT_MS} from '../../src/logic/today.ts';
import {still} from './contrast.ts';

const TODOIST: CalendarOut = {id: 4, provider: 'todoist', account_id: null, name: 'Todoist', colour: null, position: 4, visible: true, listed: true, writable: true, command: null};

function task(fields: Partial<ItemOut> = {}): ItemOut {
  return {
    key: '7', id: 7, calendar_id: 4, kind: 'task', title: 'Pay rent', time_zone: null, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: 'Home', done: false, done_at: null, can_reopen: true, command: null,
    all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: '2026-10-07', due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: null, description: null, subtasks: [], parent_id: null, ...fields,
  };
}
const sub = (done: boolean, command: SubtaskOut['command'] = null): SubtaskOut => ({id: 21, title: 'Plot the timing data', done, command, parent_id: 7, due_date: null, due_at: null, reminders: []});

const chip = (item: ItemOut, onComplete = vi.fn()) => (
  <Chip item={item} calendar={TODOIST} selected={false} now={Date.parse('2026-10-07T16:00:00.000Z')} timeZone={SEED_TIME_ZONE} onSelect={vi.fn()} onComplete={onComplete} />
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

// Whether the chip's check answers the pointer (grows, as styles.css draws it), its pop finished.
const answers = () => {
  const glyph = document.querySelector('.tk .check > *')!;
  for (const animation of document.getAnimations()) animation.finish();
  return getComputedStyle(glyph).transform !== 'none';
};

test('a chip ticked off under the pointer answers it only once its moment is over, however the pointer moves meanwhile', async () => {
  const restore = still();
  const onComplete = vi.fn();
  const shown = await render(chip(task(), onComplete));
  const check = page.elementLocator(document.querySelector('.tk .check')!);
  await userEvent.hover(check);
  expect(answers()).toBe(true);
  await userEvent.click(check);
  expect(onComplete).toHaveBeenCalledOnce();
  // The moment's end is held, then let go.
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  await shown.rerender(chip(task({done: true}), onComplete));
  expect(answers()).toBe(false);
  await userEvent.hover(page.elementLocator(document.documentElement), {position: {x: 400, y: 300}});
  await userEvent.hover(check);
  expect(answers()).toBe(false);
  await vi.advanceTimersByTimeAsync(DONE_MOMENT_MS);
  vi.useRealTimers();
  await expect.element(page.elementLocator(document.querySelector('.tk')!)).not.toHaveClass('just-done');
  expect(answers()).toBe(true);
  restore();
});

test('a subtask whose completion is confirmed while its moment plays plays on rather than starting over', async () => {
  const pending = {id: 1, kind: 'item_complete', state: 'pending'} as unknown as SubtaskOut['command'];
  const drawn = (subtask: SubtaskOut) => <Subtasks task={task({subtasks: [subtask]})} ring={undefined} timeZone={SEED_TIME_ZONE} onComplete={vi.fn()} onOpen={vi.fn()} />;
  const sweep = () => document.querySelector('.subtask .done-tx')!.getAnimations().find(animation => (animation as CSSAnimation).animationName === 'done-sweep');
  const shown = await render(drawn(sub(false)));
  await shown.rerender(drawn(sub(true, pending)));
  const playing = sweep();
  expect(playing).toBeDefined();
  await shown.rerender(drawn(sub(true)));
  expect(sweep()).toBe(playing);
});
