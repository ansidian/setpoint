// A grid task chip's ring, or its done check, completes the task or reopens it. Its target is the
// chip's full height over its first 20 px, and a press there neither selects the chip nor starts a
// drag. A read-only task, one with a change in flight, or a done one that can't reopen takes no click
// there: its ring selects and drags as the rest of the chip does.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import {Chip} from '../../src/app/calendar/Chip.tsx';

const TODOIST: CalendarOut = {id: 4, provider: 'todoist', account_id: null, name: 'Todoist', colour: null, position: 4, visible: true, listed: true, writable: true, command: null};

const WAITING = {id: 1, target: 'item', target_id: 7, kind: 'item_update', state: 'pending', provider: 'todoist', provider_message: null, retry: null, can_retry: false, can_move_back: false, previous: null, created_at: '2026-10-07T16:00:00.000Z', settled_at: null} satisfies ItemOut['command'];

function task(fields: Partial<ItemOut> = {}): ItemOut {
  return {
    key: '7', id: 7, calendar_id: 4, kind: 'task', title: 'Pay rent', time_zone: null, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: 'Home', done: false, done_at: null, can_reopen: false, command: null,
    all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: '2026-10-07', due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: null, description: null, subtasks: [], parent_id: null, ...fields,
  };
}

async function chip(item: ItemOut) {
  const onSelect = vi.fn();
  const onPress = vi.fn();
  const onComplete = vi.fn();
  await render(<div style={{width: 140, display: 'flex', flexDirection: 'column'}}>
    <Chip item={item} calendar={TODOIST} selected={false} now={Date.parse('2026-10-07T16:00:00.000Z')} timeZone={SEED_TIME_ZONE} onSelect={onSelect} onPress={onPress} onComplete={onComplete} />
  </div>);
  return {onSelect, onPress, onComplete, chip: page.elementLocator(document.querySelector('.tk')!)};
}

test('a click on the ring completes the task, and neither selects the chip nor starts a drag', async () => {
  const item = task();
  const {onSelect, onPress, onComplete, chip: shown} = await chip(item);
  await shown.click({position: {x: 10, y: 10}});
  expect(onComplete).toHaveBeenCalledExactlyOnceWith(item);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onPress).not.toHaveBeenCalled();
});

test('the ring\'s target is the chip\'s full height over its first 20 px', async () => {
  const {onSelect, onComplete, chip: shown} = await chip(task());
  // Its corners, outside the ring itself.
  await shown.click({position: {x: 1, y: 1}});
  await shown.click({position: {x: 19, y: 19}});
  expect(onComplete).toHaveBeenCalledTimes(2);
  expect(onSelect).not.toHaveBeenCalled();
});

test('a click on a done check reopens the task', async () => {
  const item = task({done: true, can_reopen: true});
  const {onSelect, onComplete, chip: shown} = await chip(item);
  await shown.click({position: {x: 10, y: 10}});
  expect(onComplete).toHaveBeenCalledExactlyOnceWith(item);
  expect(onSelect).not.toHaveBeenCalled();
});

test('the rest of the chip still selects it and starts a drag', async () => {
  const {onSelect, onPress, onComplete, chip: shown} = await chip(task());
  await shown.click({position: {x: 60, y: 10}});
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onPress).toHaveBeenCalledOnce();
  expect(onComplete).not.toHaveBeenCalled();
});

test.each([
  ['read-only', task({read_only: true})],
  ['with a change in flight', task({command: WAITING})],
  ['done and unable to reopen', task({done: true, can_reopen: false})],
])('a task %s takes no click on its ring, which selects and drags as the chip does', async (_, item) => {
  const {onSelect, onPress, onComplete, chip: shown} = await chip(item);
  await shown.click({position: {x: 10, y: 10}});
  expect(onComplete).not.toHaveBeenCalled();
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onPress).toHaveBeenCalledOnce();
});
