// An email's Snooze (SnoozeMenu.tsx) on its own: the menu's choices on each day of the week, with
// their moments, as a table, and a pick handing its moment on; Pick's panel: a day picked moves the
// focus to the time, the time is read as it's typed, Snooze waits for a moment it can read, Enter
// snoozes, days gone by can't be picked, and Esc goes back to the choices, then closes the menu.
// When each choice ends is logic/snooze.ts's, as tables (snooze.test.ts). Its look is by eye.
import type {Settings} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache, setCached} from '../../src/api/client.ts';
import {SETTINGS_PATH} from '../../src/api/items.ts';
import {SnoozeMenu} from '../../src/app/SnoozeMenu.tsx';

const menu = page.getByRole('menu', {name: 'Snooze'});
const panel = page.getByRole('dialog', {name: 'Snooze until'});
const time = page.getByRole('textbox', {name: 'Snooze time'});
const snoozeButton = page.getByRole('button', {name: /^Snooze/}).last();

function settings(taskTime: string | null) {
  setCached(SETTINGS_PATH, {reminders: {task_time: taskTime}} as unknown as Settings);
}

/** The menu drawn at `now`, opened; what it picks goes to the returned list. */
async function open(now: string, taskTime: string | null = null) {
  vi.useFakeTimers({toFake: ['Date'], now: Date.parse(now)});
  settings(taskTime);
  const picked: string[] = [];
  // At a row's right end, as the menu hangs left from its button.
  await render(<div style={{paddingLeft: 320}}><SnoozeMenu onPick={until => picked.push(new Date(until).toISOString())}
    button={(shown, toggle) => <button type="button" aria-label="Open snooze" aria-expanded={shown} onClick={toggle}>Open</button>} /></div>);
  await page.getByRole('button', {name: 'Open snooze'}).click();
  await expect.element(menu).toBeVisible();
  return picked;
}

const choices = () => [...document.querySelectorAll('.snooze-list [role="menuitem"]')].map(item => item.textContent);

beforeEach(() => clearCache());
afterEach(() => {
  vi.useRealTimers();
  clearCache();
});

// Pacific is UTC−7 in October.
test.each([
  ['Wednesday', '2026-10-07T16:12:00.000Z', null, ['TomorrowThu 9:00 AM', 'Pick a date and time…']],
  ['Friday evening', '2026-10-10T02:00:00.000Z', null, ['TomorrowSat 9:00 AM', 'Next weekdayMon 9:00 AM', 'Pick a date and time…']],
  ['Saturday', '2026-10-10T18:00:00.000Z', null, ['TomorrowSun 9:00 AM', 'Next weekdayMon 9:00 AM', 'Pick a date and time…']],
  ['Sunday', '2026-10-11T18:00:00.000Z', null, ['TomorrowMon 9:00 AM', 'Pick a date and time…']],
  ['Saturday, with a task time', '2026-10-10T18:00:00.000Z', '07:30', ['TomorrowSun 7:30 AM', 'Next weekdayMon 7:30 AM', 'Pick a date and time…']],
])('on %s the menu offers its choices with their moments', async (_name, now, taskTime, expected) => {
  await open(now, taskTime);
  expect(choices()).toEqual(expected);
});

test('a choice hands on its moment and closes the menu', async () => {
  const picked = await open('2026-10-10T18:00:00.000Z');
  await page.getByRole('menuitem', {name: /Next weekday/}).click();
  expect(picked).toEqual(['2026-10-12T16:00:00.000Z']);
  await expect.element(menu).not.toBeInTheDocument();
});

test('Pick: a day picked moves to the time, read as it\'s typed, and Enter snoozes', async () => {
  const picked = await open('2026-10-07T16:12:00.000Z');
  await page.getByRole('menuitem', {name: /Pick a date and time/}).click();
  await expect.element(panel).toBeVisible();
  // It starts tomorrow at the task time.
  await expect.element(page.getByText('Thu, Oct 8, 9:00 AM')).toBeVisible();
  await page.getByRole('button', {name: '2026-10-12'}).click();
  await expect.element(time).toHaveFocus();
  // The time's words are selected, so typing replaces them.
  await userEvent.keyboard('2');
  await expect.element(time).toHaveValue('2');
  await expect.element(page.getByText('Add AM or PM')).toBeVisible();
  await expect.element(time).toHaveAttribute('aria-invalid', 'true');
  await expect.element(snoozeButton).toBeDisabled();
  await userEvent.keyboard('pm');
  await expect.element(page.getByText('2:00 PM', {exact: true})).toBeVisible();
  await expect.element(page.getByText('Mon, Oct 12, 2:00 PM')).toBeVisible();
  await expect.element(snoozeButton).toBeEnabled();
  await userEvent.keyboard('{Enter}');
  expect(picked).toEqual(['2026-10-12T21:00:00.000Z']);
  await expect.element(panel).not.toBeInTheDocument();
});

test('Pick: days gone by can\'t be picked, a time passed says so, and Esc goes back, then closes', async () => {
  const picked = await open('2026-10-07T16:12:00.000Z');
  await page.getByRole('menuitem', {name: /Pick a date and time/}).click();
  await expect.element(page.getByRole('button', {name: '2026-10-06'})).toBeDisabled();
  await page.getByRole('button', {name: '2026-10-07'}).click();
  await userEvent.keyboard('8am');
  await expect.element(page.getByText('That time has passed')).toBeVisible();
  await expect.element(snoozeButton).toBeDisabled();
  await userEvent.keyboard('{Enter}');
  expect(picked).toEqual([]);
  await userEvent.keyboard('{Escape}');
  await expect.element(menu).toBeVisible();
  await userEvent.keyboard('{Escape}');
  await expect.element(menu).not.toBeInTheDocument();
});
