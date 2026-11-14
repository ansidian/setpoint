// SV-272 (D558): a task's subtasks. In the floating detail they're a checklist under "Subtasks 1/4",
// a column in from the header: each ring completes or reopens its subtask alone, never the task; the
// handle in that column moves it a place with ↑ ↓ (dragging is Settings' live order, order.ts), the
// rows showing the new order at once. Without actions (the phone) the rings are marks and nothing
// moves. On the grid the task's chip ends in the count, on its one line.
import type {CalendarOut, ItemOut, SubtaskOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import '../../src/app/calendar/calendar.css';
import '../../src/app/calendar/detail/detail.css';
import {Chip} from '../../src/app/calendar/Chip.tsx';
import {DetailContent} from '../../src/app/calendar/detail/DetailContent.tsx';
import type {DetailActions} from '../../src/app/calendar/detail/DetailContent.tsx';

const TODOIST: CalendarOut = {id: 4, provider: 'todoist', account_id: null, name: 'Todoist', colour: null, position: 4, visible: true, listed: true, writable: true, command: null};
const sub = (id: number, title: string, done = false): SubtaskOut => ({id, title, done, command: null, parent_id: 7, due_date: null, due_at: null, reminders: []});
const CHECKLIST = [sub(21, 'Plot the timing data', true), sub(22, 'Write the analysis'), sub(23, 'Proofread'), sub(24, 'Submit on the portal')];

function task(fields: Partial<ItemOut> = {}): ItemOut {
  return {
    key: '7', id: 7, calendar_id: 4, kind: 'task', title: 'CS 101 lab report', time_zone: null, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: 'School', done: false, done_at: null, can_reopen: false, command: null,
    all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: '2026-10-07', due_at: null,
    read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: null, description: null, subtasks: CHECKLIST, parent_id: null, ...fields,
  };
}

/** The card's actions as spies; a reorder never settles, so the order it sent stays shown. */
function actions() {
  return {
    complete: vi.fn<DetailActions['complete']>(),
    completeSubtask: vi.fn<NonNullable<DetailActions['completeSubtask']>>(),
    settleSubtask: vi.fn<NonNullable<DetailActions['settleSubtask']>>(),
    reorderSubtasks: vi.fn<NonNullable<DetailActions['reorderSubtasks']>>(() => new Promise(() => {})),
  };
}

async function card(item: ItemOut, offered?: DetailActions) {
  return render(
    <div className="fd" role="dialog" aria-label={item.title} style={{position: 'relative', width: 340}}>
      <div className="card float"><div className="fd-body"><div className="fd-layer in">
        <DetailContent target={{item, date: '2026-10-07', calendar: TODOIST}} timeZone={SEED_TIME_ZONE} actions={offered} onClose={() => {}} onEdit={() => {}} />
      </div></div></div>
    </div>,
  );
}

const titles = () => [...document.querySelectorAll('.subtask .title')].map(title => title.textContent);

test('the card lists them under "Subtasks 1/4", in order, the done one struck through, a column in from the header', async () => {
  await card(task(), actions());
  await expect.element(page.getByText('Subtasks')).toBeVisible();
  expect(document.querySelector('.fd-subtasks .fact')!.textContent).toBe('Subtasks 1/4');
  expect(titles()).toEqual(['Plot the timing data', 'Write the analysis', 'Proofread', 'Submit on the portal']);
  expect([...document.querySelectorAll('.subtask')].map(row => row.classList.contains('done'))).toEqual([true, false, false, false]);
  // Each ring sits to the right of the header's glyph, its handle in the glyph's column.
  const glyph = document.querySelector('.fd-subtasks .fact .icon')!.getBoundingClientRect();
  const handle = document.querySelector('.subtask .handle')!.getBoundingClientRect();
  const ring = document.querySelector('.subtask .fd-mark')!.getBoundingClientRect();
  expect(Math.abs(handle.left - glyph.left)).toBeLessThanOrEqual(1);
  expect(ring.left).toBeGreaterThanOrEqual(glyph.right);
});

test('a subtask\'s ring completes it, its done check reopens it, and neither completes the task', async () => {
  const offered = actions();
  await card(task(), offered);
  await page.getByRole('button', {name: 'Complete Proofread'}).click();
  expect(offered.completeSubtask).toHaveBeenLastCalledWith(CHECKLIST[2]);
  await page.getByRole('button', {name: 'Reopen Plot the timing data'}).click();
  expect(offered.completeSubtask).toHaveBeenLastCalledWith(CHECKLIST[0]);
  expect(offered.complete).not.toHaveBeenCalled();
});

test('a subtask waiting for Todoist is at .5 and its ring does nothing', async () => {
  const offered = actions();
  const pending = {id: 9, target: 'item', target_id: 23, kind: 'item_complete', state: 'pending', provider: 'todoist', provider_message: null, can_retry: false, can_move_back: false, previous: null, created_at: '2026-10-07T16:00:00.000Z', settled_at: null} as const;
  await card(task({subtasks: CHECKLIST.map(one => (one.id === 23 ? {...one, command: pending} : one))}), offered);
  const ring = page.getByRole('button', {name: 'Complete Proofread'});
  await expect.element(ring).toHaveAttribute('data-tip', 'Waiting for Todoist');
  await ring.click({force: true});
  expect(offered.completeSubtask).not.toHaveBeenCalled();
  expect(getComputedStyle(document.querySelectorAll('.subtask')[2]!).opacity).toBe('0.5');
});

test('a check Todoist refused stays in place and says so: its words as the tip, Try again and Undo on the row, no ring to press', async () => {
  const offered = actions();
  const failed = {id: 9, target: 'item', target_id: 23, kind: 'item_complete', state: 'failed', provider: 'todoist', provider_message: 'Insufficient permissions (403 Forbidden)', can_retry: true, can_move_back: true, previous: null, created_at: '2026-10-07T16:00:00.000Z', settled_at: '2026-10-07T16:00:01.000Z'} as const;
  const refused = {...CHECKLIST[2]!, done: true, command: failed};
  await card(task({subtasks: CHECKLIST.map(one => (one.id === 23 ? refused : one))}), offered);
  await expect.element(page.getByRole('img', {name: 'Failed'})).toHaveAttribute('data-tip', 'Insufficient permissions (403 Forbidden)');
  expect(document.querySelector('[aria-label="Reopen Proofread"], [aria-label="Complete Proofread"]')).toBeNull();
  await page.getByRole('button', {name: 'Try again: Proofread'}).click();
  expect(offered.settleSubtask).toHaveBeenLastCalledWith(refused, 'retry');
  await page.getByRole('button', {name: 'Undo: Proofread'}).click();
  expect(offered.settleSubtask).toHaveBeenLastCalledWith(refused, 'move-back');
  // The row is no taller for its two buttons.
  const heights = [...document.querySelectorAll('.subtask')].map(row => row.getBoundingClientRect().height);
  expect(heights[2]).toBe(heights[1]);
});

test('↓ on a handle moves the subtask a place: every id in the new order, shown at once; ↑ on the first does nothing', async () => {
  const offered = actions();
  await card(task(), offered);
  (document.querySelector('[aria-label="Move Plot the timing data"]') as HTMLElement).focus();
  await userEvent.keyboard('{ArrowUp}');
  expect(offered.reorderSubtasks).not.toHaveBeenCalled();
  (document.querySelector('[aria-label="Move Write the analysis"]') as HTMLElement).focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(offered.reorderSubtasks).toHaveBeenCalledWith(expect.objectContaining({id: 7}), [21, 23, 22, 24]);
  expect(titles()).toEqual(['Plot the timing data', 'Proofread', 'Write the analysis', 'Submit on the portal']);
});

test('without actions the rings are marks and nothing moves; a task waiting on a change keeps its subtasks where they are', async () => {
  const plain = await card(task());
  expect(titles()).toHaveLength(4);
  expect(document.querySelector('.subtask button')).toBeNull();
  expect(document.querySelector('.subtask[draggable="true"]')).toBeNull();
  await plain.unmount();
  const waiting = {id: 9, target: 'item', target_id: 7, kind: 'item_update', state: 'pending', provider: 'todoist', provider_message: null, can_retry: false, can_move_back: false, previous: null, created_at: '2026-10-07T16:00:00.000Z', settled_at: null} as const;
  await card(task({command: waiting}), actions());
  expect(document.querySelector('.subtask button.handle')).toBeNull();
  await expect.element(page.getByRole('button', {name: 'Complete Proofread'})).toBeVisible();
});

test('a task with no subtasks has no checklist', async () => {
  await card(task({subtasks: [], parent_id: null}), actions());
  await expect.element(page.getByText('School')).toBeVisible();
  expect(document.querySelector('.fd-subtasks')).toBeNull();
});

test('on the grid the task\'s chip ends in the count, on its one line, as tall as a task without one', async () => {
  const chip = (item: ItemOut) => <Chip item={item} calendar={TODOIST} selected={false} now={Date.parse('2026-10-07T16:00:00.000Z')} timeZone={SEED_TIME_ZONE} onSelect={() => {}} />;
  await render(<div style={{width: 120, display: 'flex', flexDirection: 'column', gap: 3}}>{chip(task())}{chip(task({key: '8', id: 8, title: 'Pay rent', subtasks: [], parent_id: null}))}</div>);
  const [counted, plain] = [...document.querySelectorAll('.tk')].map(one => one.getBoundingClientRect()) as [DOMRect, DOMRect];
  const count = document.querySelector('.tk .count')!;
  expect(count.textContent).toBe('1/4');
  expect(counted.height).toBe(plain.height);
  const box = count.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(counted.top);
  expect(box.bottom).toBeLessThanOrEqual(counted.bottom);
  expect(box.right).toBeLessThanOrEqual(counted.right);
  // The title gives way to it, cut with an ellipsis, never under it.
  const title = document.querySelector('.tk .title')!;
  expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(box.left);
  expect(title.scrollWidth).toBeGreaterThan(title.clientWidth);
});

// ---------- SV-273: adding, a dated one's date, opening one and its menu ----------

/** The card's actions with adding: an add settles when `settle` is called, so the row waits meanwhile. */
function adding() {
  const settles: (() => void)[] = [];
  return {
    ...actions(),
    addSubtask: vi.fn<NonNullable<DetailActions['addSubtask']>>(() => new Promise<void>(resolve => settles.push(resolve))),
    openSubtask: vi.fn<NonNullable<DetailActions['openSubtask']>>(),
    subtaskMenu: vi.fn<NonNullable<DetailActions['subtaskMenu']>>(),
    settles,
  };
}

const field = () => page.getByRole('textbox', {name: 'New subtask'});

test('Add subtask, the checklist\'s last row, becomes a field in place: Enter adds at the end at .5, clears and keeps the field for the next', async () => {
  const offered = adding();
  await card(task(), offered);
  expect(titles().at(-1)).toBe('Add subtask');
  await page.getByRole('button', {name: 'Add subtask'}).click();
  await expect.element(field()).toHaveFocus();
  await userEvent.keyboard('Post it{Enter}');
  expect(offered.addSubtask).toHaveBeenLastCalledWith(expect.objectContaining({id: 7}), 'Post it');
  await expect.element(field()).toHaveValue('');
  await expect.element(field()).toHaveFocus();
  const waiting = [...document.querySelectorAll('.subtask')].find(row => row.textContent === 'Post it')!;
  expect(waiting.classList.contains('pending')).toBe(true);
  expect(titles().slice(-2)).toEqual(['Post it', '']);
  await userEvent.keyboard('Keep the receipt{Enter}');
  expect(offered.addSubtask).toHaveBeenLastCalledWith(expect.objectContaining({id: 7}), 'Keep the receipt');
  // Settled, the row is the server's to draw.
  offered.settles.forEach(settle => settle());
  await expect.poll(() => document.querySelectorAll('.subtask.pending').length).toBe(0);
});

test('Esc, or leaving it empty, puts the row back with nothing added; leaving it with text adds that first', async () => {
  const offered = adding();
  await card(task(), offered);
  await page.getByRole('button', {name: 'Add subtask'}).click();
  await userEvent.keyboard('Never mind{Escape}');
  await expect.element(page.getByRole('button', {name: 'Add subtask'})).toBeVisible();
  expect(document.querySelector('[aria-label="New subtask"]')).toBeNull();
  await page.getByRole('button', {name: 'Add subtask'}).click();
  (document.activeElement as HTMLElement).blur();
  await expect.element(page.getByRole('button', {name: 'Add subtask'})).toBeVisible();
  expect(offered.addSubtask).not.toHaveBeenCalled();
  await page.getByRole('button', {name: 'Add subtask'}).click();
  await userEvent.keyboard('Post it');
  (document.activeElement as HTMLElement).blur();
  expect(offered.addSubtask).toHaveBeenCalledWith(expect.objectContaining({id: 7}), 'Post it');
  await expect.element(page.getByRole('button', {name: 'Add subtask'})).toBeVisible();
});

test('a task with none shows the add row alone where the header would be', async () => {
  await card(task({subtasks: [], parent_id: null}), adding());
  await expect.element(page.getByRole('button', {name: 'Add subtask'})).toBeVisible();
  expect(document.querySelector('.fd-subtasks .fact')).toBeNull();
  await page.getByRole('button', {name: 'Add subtask'}).click();
  await expect.element(field()).toHaveFocus();
});

test('a subtask\'s own card has no add row, and no Copy (D569); Clone stays', async () => {
  await card(task({key: '23', id: 23, title: 'Proofread', subtasks: [], parent_id: 7}), {...adding(), clone: vi.fn(), copy: vi.fn()});
  await expect.element(page.getByText('School')).toBeVisible();
  expect(document.querySelector('.subtask.add')).toBeNull();
  await expect.element(page.getByRole('button', {name: 'Clone'})).toBeVisible();
  expect(document.querySelector('[aria-label="Copy"]')).toBeNull();
});

test('a dated subtask shows its date after its title, with the bell for reminders; its title opens it and a right-click its menu', async () => {
  const offered = adding();
  const dated = {...CHECKLIST[2]!, due_date: '2026-12-24', due_at: null, reminders: [0]};
  await card(task({subtasks: CHECKLIST.map(one => (one.id === 23 ? dated : one))}), offered);
  const row = document.querySelectorAll('.subtask')[2]!;
  expect(row.querySelector('.due')!.textContent).toBe('Dec 24');
  expect(row.querySelector('.due .icon')).not.toBeNull();
  expect(document.querySelectorAll('.subtask .due')).toHaveLength(1);
  await page.getByRole('button', {name: 'Edit Proofread'}).click();
  expect(offered.openSubtask).toHaveBeenLastCalledWith(dated);
  await page.getByRole('button', {name: 'Edit Write the analysis'}).click({button: 'right'});
  expect(offered.subtaskMenu).toHaveBeenLastCalledWith(expect.anything(), CHECKLIST[1]);
});
