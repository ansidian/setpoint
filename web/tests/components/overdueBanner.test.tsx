// The overdue banner (OverdueBanner.tsx) on its own: one task and several draw their parts, a click
// or Esc dismisses it, and no other key acts on it or the page under it. While it enters, a click
// reaches the page under it and Esc waits. Its arrivals: with the user there, a task going overdue
// draws nothing; the next arrival does, and an arrival after a dismissal draws it again once the
// 5-minute cooldown since it left is over. The old
// record of tasks shown is removed. The snooze: each title's button and its menu, their clicks and
// keys, a snoozed title leaving and the next taking its place, and a snooze kept by the browser
// holding its task off later arrivals until it ends. When an arrival comes is logic/arrival.ts's, as a table, and
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

/** The arrivals' banner, each arrival coming at the browser's clock now. */
function arrivals(came: Omit<Arrival, 'clock'> | null, items: ItemOut[], present = true, taskTime: string | null = null) {
  const arrival = came && {...came, clock: Date.now()};
  return <OverdueArrivals arrival={arrival} present={present} items={items} taskTime={taskTime} timeZone={SEED_TIME_ZONE} />;
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

test('an arrival while the banner is up leaves it as it is; a dismissal lasts through the 5 minutes after it left, then the next arrival draws it again', async () => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(now);
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
  // An arrival under 5 minutes after it left, by the browser's clock, reload or return: nothing.
  const left = Date.now();
  vi.setSystemTime(left + 4 * 60_000);
  await rerender(arrivals({count: 3, at: now + 4 * 60_000}, [one.item]));
  expect(document.querySelector('.overdue')).toBeNull();
  vi.setSystemTime(left + 5 * 60_000);
  await rerender(arrivals({count: 4, at: now + 5 * 60_000}, [one.item]));
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

// The snooze.
const snoozeButtons = () => [...document.querySelectorAll<HTMLButtonElement>('.overdue .overdue-snooze-button')];
const snoozeMenu = page.getByRole('menu', {name: 'Snooze'});
const listedRows = () => [...document.querySelectorAll('.overdue-list li')].map(row => row.textContent);
const SNOOZED_KEY = 'setpoint.overdueSnoozed';

test('each title has a snooze button after it, there once the title is up, with the tip "Snooze"', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  await render(<OverdueBanner overdue={several()} now={now} timeZone={SEED_TIME_ZONE} />);
  await expect.element(banner).toBeInTheDocument();
  expect(snoozeButtons()).toHaveLength(0);
  vi.advanceTimersByTime(ENTRANCE_MS);
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  const buttons = snoozeButtons();
  expect(buttons).toHaveLength(4);
  for (const button of buttons) {
    expect(button.getAttribute('aria-label')).toBe('Snooze');
    expect(button.dataset.tip).toBe('Snooze');
    expect(button.parentElement?.previousElementSibling?.classList.contains('overdue-name')).toBe(true);
  }
});

test('a snooze button opens its menu, 1 hour, 3 hours and Tomorrow, and the banner stays; Esc closes only the menu, then the banner', async () => {
  await draw(several());
  await userEvent.click(snoozeButtons()[1]!);
  await expect.element(snoozeMenu).toBeVisible();
  expect([...document.querySelectorAll('.overdue-menu [role="menuitem"]')].map(item => item.textContent)).toEqual(['1 hour', '3 hours', 'Tomorrow']);
  expect(state()).toBe('in');
  await userEvent.keyboard('{Escape}');
  await expect.element(snoozeMenu).not.toBeInTheDocument();
  expect(state()).toBe('in');
  await userEvent.keyboard('{Escape}');
  await expect.poll(state).toBe('out');
});

test('a click outside the menu closes only the menu; the next click dismisses the banner', async () => {
  await draw(several());
  await userEvent.click(snoozeButtons()[0]!);
  await expect.element(snoozeMenu).toBeVisible();
  await userEvent.click(page.getByText('6 tasks'));
  await expect.element(snoozeMenu).not.toBeInTheDocument();
  expect(state()).toBe('in');
  await userEvent.click(banner);
  await expect.poll(state).toBe('out');
});

test('picking a preset snoozes that task: its title leaves, the next hidden one takes its place and "and N more" counts down', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  const picked: [string, string][] = [];
  await render(<OverdueBanner overdue={several()} now={now} timeZone={SEED_TIME_ZONE} onSnooze={(item, choice) => picked.push([item.title, choice])} />);
  vi.advanceTimersByTime(ENTRANCE_MS);
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  await userEvent.click(snoozeButtons()[1]!);
  await userEvent.click(page.getByRole('menuitem', {name: '3 hours'}));
  expect(picked).toEqual([['Return the drill', 'threeHours']]);
  await expect.element(snoozeMenu).not.toBeInTheDocument();
  // It fades where it is, then closes up, and the banner stays.
  expect(document.querySelector('.overdue-list li[data-leaving]')?.textContent).toBe('Return the drillYesterday');
  await expect.element(page.getByText('5 tasks')).toBeInTheDocument();
  vi.advanceTimersByTime(timing.snoozeOut + timing.closeUp);
  await expect.poll(listedRows).toEqual([
    'Call the landlord8:00 AM',
    'Submit the parking permit formMon',
    'Pay the water billFri',
    'Book a haircutSep 30',
    'and 1 more',
  ]);
  expect(state()).toBe('in');
});

test('from two to one, it stays a list and reads "1 task"', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  await render(<OverdueBanner overdue={several().slice(0, 2)} now={now} timeZone={SEED_TIME_ZONE} />);
  vi.advanceTimersByTime(ENTRANCE_MS);
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  await userEvent.click(snoozeButtons()[0]!);
  await userEvent.click(page.getByRole('menuitem', {name: '1 hour'}));
  vi.advanceTimersByTime(timing.snoozeOut + timing.closeUp);
  await expect.poll(listedRows).toEqual(['Submit the parking permit formMon']);
  expect(document.querySelector('.overdue-title')?.textContent).toBe('1 task');
  expect(state()).toBe('in');
});

test('snoozing the last one closes the banner, the snoozed title fading rather than returning to its Today line', async () => {
  const one = landlord();
  const aside = sidebar({lines: [one]});
  try {
    await draw([one]);
    await userEvent.click(snoozeButtons()[0]!);
    await userEvent.click(page.getByRole('menuitem', {name: 'Tomorrow'}));
    await expect.poll(state).toBe('out');
    expect(exits()).toEqual({'Call the landlord': 'fade'});
  } finally {
    aside.remove();
  }
});

test('Tab moves among the snooze buttons and never to the page under it; Enter or Space opens one, the arrows move in its menu and Enter picks', async () => {
  const under = document.createElement('button');
  under.textContent = 'Under';
  document.body.append(under);
  const picked: string[] = [];
  try {
    await render(<OverdueBanner overdue={several().slice(0, 3)} now={now} timeZone={SEED_TIME_ZONE} onSnooze={(item, choice) => picked.push(`${item.title} ${choice}`)} />);
    await expect.element(banner).toHaveAttribute('data-state', 'in');
    const buttons = snoozeButtons();
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(buttons[0]);
    await userEvent.keyboard('{Tab}{Tab}{Tab}');
    expect(document.activeElement).toBe(buttons[0]);
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    expect(document.activeElement).toBe(buttons[2]);

    await userEvent.keyboard(' ');
    await expect.element(snoozeMenu).toBeVisible();
    expect(document.activeElement?.textContent).toBe('1 hour');
    await userEvent.keyboard('{Escape}');
    await expect.element(snoozeMenu).not.toBeInTheDocument();
    expect(document.activeElement).toBe(buttons[2]);

    await userEvent.keyboard('{Enter}');
    await expect.element(snoozeMenu).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Tomorrow');
    await userEvent.keyboard('{Enter}');
    expect(picked).toEqual(['Renew the library card tomorrow']);
    expect(state()).toBe('in');
    expect(document.activeElement).not.toBe(under);
  } finally {
    under.remove();
  }
});

test('a snooze is kept by the browser: later arrivals leave its task off until it ends, then the next one brings it back', async () => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(now);
  const one = landlord();
  const other = task('Return the drill', {due_date: '2026-10-06'});
  const {rerender} = await render(arrivals({count: 1, at: now}, [one.item, other.item]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  await userEvent.click(snoozeButtons()[0]!);
  await userEvent.click(page.getByRole('menuitem', {name: '1 hour'}));
  // An hour from the pick, on the page's clock.
  const [kept] = JSON.parse(localStorage.getItem(SNOOZED_KEY)!) as {id: number; due: string; until: number}[];
  expect({id: kept!.id, due: kept!.due}).toEqual({id: one.item.id, due: one.item.due_at});
  expect(kept!.until - now).toBeGreaterThanOrEqual(3_600_000);
  expect(kept!.until - now).toBeLessThan(3_660_000);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.overdue')).toBeNull();

  // Within the hour: the other alone.
  vi.setSystemTime(now + 30 * 60_000);
  await rerender(arrivals({count: 2, at: now + 30 * 60_000}, [one.item, other.item]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  expect(document.querySelector('.overdue-title')?.textContent).toBe('Return the drill');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.overdue')).toBeNull();

  // Past it: both, and the ended snooze is no longer kept.
  vi.setSystemTime(now + 61 * 60_000);
  await rerender(arrivals({count: 3, at: now + 61 * 60_000}, [one.item, other.item]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  expect(document.querySelector('.overdue-title')?.textContent).toBe('2 tasks');
  await expect.poll(() => localStorage.getItem(SNOOZED_KEY)).toBeNull();
});

test('Tomorrow is tomorrow at the Settings task time', async () => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(now);
  const one = landlord();
  await render(arrivals({count: 1, at: now}, [one.item], true, '08:30'));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  await userEvent.click(snoozeButtons()[0]!);
  await userEvent.click(page.getByRole('menuitem', {name: 'Tomorrow'}));
  expect(JSON.parse(localStorage.getItem(SNOOZED_KEY)!)).toEqual([{id: one.item.id, due: one.item.due_at, until: Date.parse('2026-10-08T15:30:00.000Z')}]);
});

test('a snooze ends when its task is rescheduled', async () => {
  const one = landlord();
  localStorage.setItem(SNOOZED_KEY, JSON.stringify([{id: one.item.id, due: one.item.due_at, until: now + 3_600_000}]));
  await render(arrivals({count: 1, at: now}, [{...one.item, due_at: '2026-10-07T15:30:00.000Z'}]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
  expect(document.querySelector('.overdue-title')?.textContent).toBe('Call the landlord');
  await expect.poll(() => localStorage.getItem(SNOOZED_KEY)).toBeNull();
});

test('a browser that refuses storage still takes a snoozed title off the banner', async () => {
  const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
  Object.defineProperty(window, 'localStorage', {configurable: true, get: () => {
    throw new DOMException('Refused', 'SecurityError');
  }});
  try {
    await render(arrivals({count: 1, at: now}, several().slice(0, 2).map(one => one.item)));
    await expect.element(banner).toHaveAttribute('data-state', 'in');
    await userEvent.click(snoozeButtons()[0]!);
    await userEvent.click(page.getByRole('menuitem', {name: '1 hour'}));
    await expect.element(page.getByText('1 task')).toBeInTheDocument();
  } finally {
    Object.defineProperty(window, 'localStorage', real);
  }
});

test('a malformed record is read as no snoozes', async () => {
  localStorage.setItem(SNOOZED_KEY, '{"not": "a list"');
  await render(arrivals({count: 1, at: now}, [landlord().item]));
  await expect.element(banner).toHaveAttribute('data-state', 'in');
});
