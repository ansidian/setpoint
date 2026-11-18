// The overdue banner (OverdueBanner.tsx) on its own: one task and several draw their parts, a click
// or Esc dismisses it and marks its tasks shown in this browser, no other key acts on it or the
// page under it, and it draws nothing when every task is shown. While it enters, a click reaches
// the page under it and Esc waits. Its arrivals: with the user there, a task going overdue draws
// nothing; the next arrival does. When an arrival comes is logic/arrival.ts's, as a table, and the
// page's events are checked in the browser (shell.spec.ts). Its look and its fades are by eye.
import type {ItemOut, TodoistProjectOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache, setCached} from '../../src/api/client.ts';
import {TODOIST_PROJECTS_PATH} from '../../src/api/items.ts';
import type {Arrival} from '../../src/app/arrival.ts';
import {ENTRANCE_MS, OverdueArrivals, OverdueBanner} from '../../src/app/OverdueBanner.tsx';
import type {Overdue} from '../../src/logic/overdue.ts';
import {shownKey} from '../../src/logic/overdueBanner.ts';

const KEY = 'setpoint.overdueShown';
const now = Date.parse(SEED_NOW);

let nextId = 1;
function task(title: string, fields: Partial<ItemOut>): Overdue {
  const id = nextId++;
  const item: ItemOut = {
    key: String(id), id, calendar_id: 4, kind: 'task', title, time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: 'Home', done: false, done_at: null, can_reopen: false, command: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null,
    all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, ...fields,
  };
  return {item, today: item.due_date === '2026-10-07'};
}

const landlord = () => task('Call the landlord', {due_date: '2026-10-07', due_at: '2026-10-07T15:00:00.000Z'});
const several = () => [
  task('Submit the parking permit form', {due_date: '2026-10-05', project: 'School'}),
  landlord(),
  task('Renew the library card', {due_date: '2026-09-24', project: 'Inbox'}),
  task('Return the drill', {due_date: '2026-10-06'}),
  task('Pay the water bill', {due_date: '2026-10-02'}),
  task('Book a haircut', {due_date: '2026-09-30'}),
];

const banner = page.getByRole('dialog', {name: 'Overdue tasks'});
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
const state = () => document.querySelector('.overdue')?.getAttribute('data-state') ?? 'gone';
/** Drawn and entered: it takes clicks and keys from here. */
async function draw(overdue: Overdue[]) {
  const drawn = await render(<OverdueBanner overdue={overdue} now={now} timeZone={SEED_TIME_ZONE} />);
  if (overdue.length) await expect.element(banner).toHaveAttribute('data-state', 'in');
  return drawn;
}

beforeEach(() => {
  localStorage.clear();
  setCached(TODOIST_PROJECTS_PATH, [
    {id: '1', name: 'Home', colour: 'orange', inbox: false},
    {id: '2', name: 'School', colour: 'sky_blue', inbox: false},
    {id: '3', name: 'Inbox', colour: 'charcoal', inbox: true},
  ] as TodoistProjectOut[]);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  clearCache();
});

test('one task: Overdue, its title large, then its ring, project and due', async () => {
  await draw([landlord()]);
  await expect.element(banner).toBeVisible();
  const text = (selector: string) => document.querySelector(selector)?.textContent;
  expect(text('.overdue-label')).toBe('Overdue');
  expect(text('.overdue-title')).toBe('Call the landlord');
  expect(text('.overdue-due')).toBe('Home · Due today, 8:00 AM');
  expect(document.querySelectorAll('.overdue-due .ring')).toHaveLength(1);
  expect(text('.overdue-hint')).toBe('Click anywhere to dismissEsc');
});

test('several: their count, the four most recently due with their short dues, then "and 2 more"', async () => {
  await draw(several());
  await expect.element(banner).toBeVisible();
  expect(document.querySelector('.overdue-title')?.textContent).toBe('6 tasks');
  const rows = [...document.querySelectorAll('.overdue-list li')].map(row => row.textContent);
  expect(rows).toEqual([
    'Call the landlord8:00 AM',
    'Return the drillYesterday',
    'Submit the parking permit formMon',
    'Pay the water billFri',
    'and 2 more',
  ]);
  expect(document.querySelectorAll('.overdue-list .ring')).toHaveLength(4);
});

test('a click anywhere dismisses it and marks every task shown, the ones under "and 2 more" too', async () => {
  const tasks = several();
  await draw(tasks);
  await expect.element(banner).toBeVisible();
  expect(stored()).toEqual([]);
  await userEvent.click(page.getByText('Click anywhere to dismiss'));
  await expect.poll(state).not.toBe('in');
  expect(stored().sort()).toEqual(tasks.map(one => shownKey(one.item)).sort());
});

test('the click reaches nothing under it', async () => {
  const reached: string[] = [];
  const listen = (event: Event) => reached.push(event.type);
  for (const type of ['pointerdown', 'mousedown', 'click']) document.addEventListener(type, listen);
  try {
    await draw([landlord()]);
    await userEvent.click(banner);
    await expect.poll(() => stored()).toHaveLength(1);
    expect(reached).toEqual([]);
  } finally {
    for (const type of ['pointerdown', 'mousedown', 'click']) document.removeEventListener(type, listen);
  }
});

test('Esc dismisses it', async () => {
  const one = landlord();
  await draw([one]);
  await expect.element(banner).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => stored()).toEqual([shownKey(one.item)]);
  await expect.poll(state).not.toBe('in');
});

test('another key does nothing, on the banner or the page under it', async () => {
  const reached: string[] = [];
  const listen = (event: KeyboardEvent) => reached.push(event.key);
  document.addEventListener('keydown', listen);
  window.addEventListener('keydown', listen, true);
  try {
    await draw([landlord()]);
    await expect.element(banner).toBeVisible();
    await userEvent.keyboard('c{Enter} `');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(reached).toEqual([]);
    expect(state()).toBe('in');
    expect(stored()).toEqual([]);
  } finally {
    document.removeEventListener('keydown', listen);
    window.removeEventListener('keydown', listen, true);
  }
});

test('nothing draws when every task is shown, and an unshown one still does', async () => {
  const tasks = several();
  localStorage.setItem(KEY, JSON.stringify(tasks.map(one => shownKey(one.item))));
  const {unmount} = await render(<OverdueBanner overdue={tasks} now={now} timeZone={SEED_TIME_ZONE} />);
  expect(document.querySelector('.overdue')).toBeNull();
  await unmount();

  // The same task rescheduled to yesterday and missed again shows once more.
  const moved = {...tasks[0]!, item: {...tasks[0]!.item, due_date: '2026-10-06'}};
  await draw([moved, ...tasks.slice(1)]);
  await expect.element(banner).toBeVisible();
  expect(document.querySelector('.overdue-title')?.textContent).toBe('Submit the parking permit form');
});

test('a browser that refuses storage shows it all the same', async () => {
  const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  Object.defineProperty(window, 'localStorage', {configurable: true, get: () => {
    throw new DOMException('Refused', 'SecurityError');
  }});
  try {
    await draw([landlord()]);
    await expect.element(banner).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.poll(state).not.toBe('in');
  } finally {
    Object.defineProperty(window, 'localStorage', real);
  }
});

test('while it enters, a click reaches what is under it and leaves it up, and Esc waits; once in, a click dismisses it', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  const clicked: string[] = [];
  const under = document.createElement('button');
  under.textContent = 'Under';
  under.style.cssText = 'position: fixed; inset: 0;';
  under.addEventListener('click', () => clicked.push('under'));
  document.body.append(under);
  try {
    const one = landlord();
    await render(<OverdueBanner overdue={[one]} now={now} timeZone={SEED_TIME_ZONE} />);
    await expect.element(banner).toBeInTheDocument();
    expect(state()).toBe('entering');
    await userEvent.click(page.getByText('Click anywhere to dismiss'), {force: true});
    expect(clicked).toEqual(['under']);
    await userEvent.keyboard('{Escape}');
    expect(state()).toBe('entering');
    expect(stored()).toEqual([]);

    vi.advanceTimersByTime(ENTRANCE_MS);
    await expect.element(banner).toHaveAttribute('data-state', 'in');
    await userEvent.click(page.getByText('Click anywhere to dismiss'));
    await expect.poll(state).not.toBe('in');
    expect(clicked).toEqual(['under']);
    expect(stored()).toEqual([shownKey(one.item)]);
  } finally {
    under.remove();
  }
});

function arrivals(arrival: Arrival | null, items: ItemOut[], present = true) {
  return <OverdueArrivals arrival={arrival} present={present} items={items} timeZone={SEED_TIME_ZONE} />;
}

test('with the user there, a task going overdue draws nothing; the next arrival draws it', async () => {
  // At the load, Call the landlord isn't due yet: no banner.
  const later = {...landlord().item, due_at: '2026-10-07T17:00:00.000Z'};
  const load = {count: 1, at: now};
  const {rerender} = await render(arrivals(load, [later]));
  // Now past its time, and the same arrival: nothing.
  const passed = {...later, due_at: '2026-10-07T16:00:00.000Z'};
  await rerender(arrivals(load, [passed]));
  expect(document.querySelector('.overdue')).toBeNull();
  // The user goes away; an arrival that comes while they're away waits for them.
  await rerender(arrivals({count: 2, at: now + 60_000}, [passed], false));
  expect(document.querySelector('.overdue')).toBeNull();
  await rerender(arrivals({count: 2, at: now + 60_000}, [passed]));
  await expect.element(banner).toBeVisible();
  expect(document.querySelector('.overdue-title')?.textContent).toBe('Call the landlord');
});

test('an arrival while the banner is up leaves it as it is; once dismissed, an arrival with nothing new draws nothing', async () => {
  const one = landlord();
  const {rerender} = await render(arrivals({count: 1, at: now}, [one.item]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  await rerender(arrivals({count: 2, at: now + 60_000}, [one.item]));
  expect(state()).toBe('in');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.overdue')).toBeNull();
  await rerender(arrivals({count: 3, at: now + 120_000}, [one.item]));
  expect(document.querySelector('.overdue')).toBeNull();
});
