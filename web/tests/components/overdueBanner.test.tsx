// The overdue banner (OverdueBanner.tsx) on its own: one task and several draw their parts, a click
// or Esc dismisses it, and no other key acts on it or the page under it. While it enters, a click
// reaches the page under it and Esc waits. Its arrivals: with the user there, a task going overdue
// draws nothing; the next arrival does, and every arrival after a dismissal draws it again. The old
// record of tasks shown is removed. When an arrival comes is logic/arrival.ts's, as a table, and
// the page's events are checked in the browser (shell.spec.ts). Its look and its fades are by eye.
import type {ItemOut, TodoistProjectOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache, setCached} from '../../src/api/client.ts';
import {TODOIST_PROJECTS_PATH} from '../../src/api/items.ts';
import type {Arrival} from '../../src/app/arrival.ts';
import {ENTRANCE_MS, OverdueArrivals, OverdueBanner} from '../../src/app/OverdueBanner.tsx';
import {overdue as timing} from '../../src/tokens.ts';
import type {Overdue} from '../../src/logic/overdue.ts';

// The old record of tasks already shown, which nothing reads any more.
const OLD_KEY = 'setpoint.overdueShown';
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
});

test('the hint is absent at first and comes after its delay', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  await render(<OverdueBanner overdue={[landlord()]} now={now} timeZone={SEED_TIME_ZONE} />);
  await expect.element(banner).toBeInTheDocument();
  vi.advanceTimersByTime(timing.hintDelay - 1);
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  expect(document.querySelector('.overdue-hint')).toBeNull();
  vi.advanceTimersByTime(1);
  await expect.element(page.getByText('Click anywhere to dismiss')).toBeInTheDocument();
  expect(document.querySelector('.overdue-hint')?.textContent).toBe('Click anywhere to dismissEsc');
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

test('a click anywhere dismisses it', async () => {
  await draw(several());
  await expect.element(banner).toBeVisible();
  await userEvent.click(banner);
  await expect.poll(state).not.toBe('in');
});

test('the click reaches nothing under it', async () => {
  const reached: string[] = [];
  const listen = (event: Event) => reached.push(event.type);
  for (const type of ['pointerdown', 'mousedown', 'click']) document.addEventListener(type, listen);
  try {
    await draw([landlord()]);
    await userEvent.click(banner);
    await expect.poll(state).not.toBe('in');
    expect(reached).toEqual([]);
  } finally {
    for (const type of ['pointerdown', 'mousedown', 'click']) document.removeEventListener(type, listen);
  }
});

test('Esc dismisses it', async () => {
  await draw([landlord()]);
  await expect.element(banner).toBeVisible();
  await userEvent.keyboard('{Escape}');
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
  } finally {
    document.removeEventListener('keydown', listen);
    window.removeEventListener('keydown', listen, true);
  }
});

test('a browser that refuses storage shows it all the same', async () => {
  const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  Object.defineProperty(window, 'localStorage', {configurable: true, get: () => {
    throw new DOMException('Refused', 'SecurityError');
  }});
  try {
    await render(arrivals({count: 1, at: now}, [landlord().item]));
    await expect.element(banner).toHaveAttribute('data-state', 'in');
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
    await render(<OverdueBanner overdue={[landlord()]} now={now} timeZone={SEED_TIME_ZONE} />);
    await expect.element(banner).toBeInTheDocument();
    expect(state()).toBe('entering');
    await userEvent.click(banner, {force: true});
    expect(clicked).toEqual(['under']);
    await userEvent.keyboard('{Escape}');
    expect(state()).toBe('entering');

    vi.advanceTimersByTime(ENTRANCE_MS);
    await expect.element(banner).toHaveAttribute('data-state', 'in');
    await userEvent.click(banner);
    await expect.poll(state).not.toBe('in');
    expect(clicked).toEqual(['under']);
  } finally {
    under.remove();
  }
});

/**
 * A stand-in for the shell's sidebar: its nav, then Today's lines for `lines` (title by key), or
 * folded to the rail, or Calendar's sidebar with no Today block.
 */
function sidebar(how: {lines: Overdue[]} | 'rail' | 'calendar') {
  const aside = document.createElement('aside');
  aside.className = how === 'rail' ? 'sb rail' : 'sb';
  aside.style.cssText = 'position: fixed; top: 0; left: 0; bottom: 0; width: 248px; display: flex; flex-direction: column; font-size: 13px;';
  aside.innerHTML = '<a class="nav">Inbox</a><a class="nav">Calendar</a>';
  if (typeof how === 'object') {
    const today = document.createElement('div');
    today.className = 'sb-sec today';
    for (const {item} of how.lines) {
      const line = document.createElement('a');
      line.className = 'today-row task';
      line.dataset.key = item.key;
      line.innerHTML = '<span class="lines"><span class="ell title"></span></span>';
      line.querySelector('.title')!.textContent = item.title;
      today.append(line);
    }
    aside.append(today);
  } else if (how === 'calendar') {
    aside.insertAdjacentHTML('beforeend', '<div class="sb-sec"><div class="sb-label">Calendars</div></div>');
  }
  document.body.append(aside);
  return aside;
}

const exits = () => Object.fromEntries([...document.querySelectorAll('.overdue [data-exit]')].map(title => [title.textContent, title.getAttribute('data-exit')]));

test('on the way out, a task due today returns to its Today line and older ones fade', async () => {
  const tasks = several();
  const aside = sidebar({lines: [tasks[1]!]});
  try {
    await draw(tasks);
    expect(exits()).toEqual({});
    await userEvent.click(banner);
    await expect.poll(state).toBe('out');
    expect(exits()).toEqual({
      'Call the landlord': 'return',
      'Return the drill': 'fade',
      'Submit the parking permit form': 'fade',
      'Pay the water bill': 'fade',
    });
    expect(document.querySelector('.overdue-icon')).toBeNull();
  } finally {
    aside.remove();
  }
});

test('one task due today returns; with its line not in Today, it fades', async () => {
  const one = landlord();
  const aside = sidebar({lines: []});
  try {
    await draw([one]);
    await userEvent.keyboard('{Escape}');
    await expect.poll(state).toBe('out');
    expect(exits()).toEqual({'Call the landlord': 'fade'});
  } finally {
    aside.remove();
  }
});

test.each(['rail', 'calendar'] as const)('with no Today lines on screen (%s), the titles due today go to the icon, drawn only when one returns', async how => {
  const aside = sidebar(how);
  try {
    const {unmount} = await draw([landlord()]);
    await userEvent.click(banner);
    await expect.poll(state).toBe('out');
    expect(exits()).toEqual({'Call the landlord': 'return'});
    await expect.element(page.getByRole('img', {name: 'Overdue task'})).toBeInTheDocument();
    await unmount();

    // From an earlier day only: nothing returns, and no icon.
    await draw([task('Return the drill', {due_date: '2026-10-06'})]);
    await userEvent.click(banner);
    await expect.poll(state).toBe('out');
    expect(exits()).toEqual({'Return the drill': 'fade'});
    expect(document.querySelector('.overdue-icon')).toBeNull();
  } finally {
    aside.remove();
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

test('an arrival while the banner is up leaves it as it is; a dismissal lasts until the next arrival, which draws it again', async () => {
  const one = landlord();
  const {rerender} = await render(arrivals({count: 1, at: now}, [one.item]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  await rerender(arrivals({count: 2, at: now + 60_000}, [one.item]));
  expect(state()).toBe('in');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.overdue')).toBeNull();
  // The same visit: the items coming in again raise nothing.
  await rerender(arrivals({count: 2, at: now + 60_000}, [{...one.item}]));
  expect(document.querySelector('.overdue')).toBeNull();
  await rerender(arrivals({count: 3, at: now + 120_000}, [one.item]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  expect(document.querySelector('.overdue-title')?.textContent).toBe('Call the landlord');
});

test('the old record of tasks shown is no longer read, and is removed', async () => {
  const one = landlord();
  localStorage.setItem(OLD_KEY, JSON.stringify([`${one.item.id}@${one.item.due_at}`]));
  await render(arrivals({count: 1, at: now}, [one.item]));
  await expect.element(banner).toBeVisible();
  expect(localStorage.getItem(OLD_KEY)).toBeNull();
});
