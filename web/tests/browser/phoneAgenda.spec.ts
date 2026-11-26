// The phone's agenda at 390 × 844 (board 21): today at the top with the past week above it, an
// item's detail, reminders, forecasts and now. Its range: later weeks load as the end nears, until
// four empty weeks leave Show later; the header's month opens the month picker, which jumps to any
// day, and the tab and Today go back to today. A line opened under the detail card comes up above it.
// Today's Overdue group, its snooze (from a detail or a swipe) and the tab's count; search in the
// header's place with Cancel, its results and their details, the tab leaving it. Then its changes on the seed: + opens the editor sheet on the day in
// view and Create adds the event there; Edit saves, with Undo; a repeating event's edit asks which
// of its events; a task's ring completes it and its done check reopens it; Delete waits out its
// toast, Undo keeping the item, and a repeating event's asks which of its events in the bottom
// sheet. The sheet's own behaviour is the component test's (editorSheet.test.tsx).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {UNDO_MS} from '../../src/app/toast.ts';
import {cleanUp, holdToast, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';
import {fingertips, instantScrolls, scrollsAsked, swipe} from './phoneHelpers.ts';

after(cleanUp);

/** The agenda's topmost day whose line still shows, its first for folded empty days. */
const topDay = (page: Page) => page.locator('.ph-agenda').evaluate(list => {
  const top = list.getBoundingClientRect().top;
  return ([...list.querySelectorAll<HTMLElement>('.ph-day')].find(day => day.getBoundingClientRect().bottom > top + 1)?.dataset.days ?? '').split(' ')[0];
});

test('the agenda: today at the top under the past week, empty days folded, an item\'s detail', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    await page.locator('.ph-agenda .pwx').first().waitFor();
    assert.equal(await page.locator('.hd .ph-month-btn').textContent(), 'October');
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    const heads = (await page.locator('.ph-agenda .pday').allTextContents()).map(text => text.trim());
    const today = heads.indexOf('Today · Wed, Oct 778° / 61°');
    // The past week above, its weekend folded.
    assert.deepEqual(heads.slice(0, today), ['Wed, Sep 30', 'Thu, Oct 1', 'Fri, Oct 2', 'Sat, Oct 3 – Sun, Oct 4No events', 'Mon, Oct 5', 'Tue, Oct 6']);
    assert.deepEqual(heads.slice(today, today + 8), [
      'Today · Wed, Oct 778° / 61°', 'Thu, Oct 872° / 59°', 'Fri, Oct 9', 'Sat, Oct 10 – Sun, Oct 11No events', 'Mon, Oct 12', 'Tue, Oct 1364° / 55°', 'Wed, Oct 14', 'Thu, Oct 15',
    ]);
    // A forecast's high and low sit before its icon, as a month cell's do.
    assert.equal(await page.locator('.ph-agenda .pwx').first().getAttribute('data-tip'), 'Sunny · 78° / 61°');
    // The day heads never wrap.
    for (const head of await page.locator('.ph-agenda .pday').all()) assert.equal((await head.boundingBox())!.height, 30);
    // No month grid and no editor until + or Edit.
    assert.equal(await page.locator('.cal-grid, .editor, .rpane').count(), 0);

    await page.locator('.pitem', {hasText: 'Dentist'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist'}).waitFor();
    assert.equal(await page.locator('.ph-detail .fd-when').textContent(), 'Wed, Oct 7 · 2:30 – 3:30 PM');
    // Edit and Delete, nothing else: Clone, Copy and Colour stay on the desktop.
    assert.deepEqual(await page.locator('.ph-detail .card-acts button').evaluateAll(buttons => buttons.map(one => one.getAttribute('aria-label') ?? (one as HTMLElement).innerText)), ['Edit', 'Delete']);
    assert.match(new URL(page.url()).pathname, /^\/calendar\/item\/\d+$/);
    await page.locator('.ph-detail button[aria-label="Close"]').tap();
    await until('the detail closes', () => page.locator('.ph-detail').count(), count => count === 0);

    // A task's detail too.
    await page.locator('.pitem', {hasText: 'Pay rent'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Pay rent'}).waitFor();
    await page.locator('.ph-scrim').tap({position: {x: 195, y: 100}});
    await until('a tap outside closes it', () => page.locator('.ph-detail').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a task\'s custom reminder on the phone reads as its moment, the offset beside it, inside the card', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const {items} = await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-08');
    const rent = items.find(item => item.title === 'Pay rent')!;
    await setpoint.api('PATCH', `/items/${rent.id}`, {changes: {reminders: [30, -90]}});
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar/item/${rent.id}`);
    await page.locator('.ph-detail .fd-title', {hasText: 'Pay rent'}).waitFor();
    // Pay rent has no time: its reminders count from Settings' 9:00 AM.
    const lines = page.locator('.ph-detail .fd-reminders > span');
    await until('its reminders', () => lines.allTextContents(), texts => texts.length === 2);
    assert.deepEqual(await lines.allTextContents(), ['30 min before', 'Wed, Oct 7, 10:30 AM1 hr 30 min after']);
    const card = (await rested(() => page.locator('.ph-detail .card').boundingBox()))!;
    for (const line of await lines.all()) {
      const box = (await rested(() => line.boundingBox()))!;
      assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width, 'the line sits inside the card');
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an empty day with a forecast keeps its own line to show it, "No events" beside its date', async () => {
  const setpoint = await startSetpoint({clock: 'frozen', fixtures: ['weekend-forecast']});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda [data-days="2026-10-11"] .pwx').waitFor();
    assert.deepEqual([await page.locator('.ph-agenda [data-days="2026-10-10"] .pday').textContent(), await page.locator('.ph-agenda [data-days="2026-10-11"] .pday').textContent()], [
      'Sat, Oct 10No events74° / 58°', 'Sun, Oct 11No events77° / 60°',
    ]);
    // "No events" follows the date, and the forecast takes the end, on one 30 px line.
    const head = page.locator('.ph-agenda [data-days="2026-10-10"] .pday');
    const [line, none, wx] = await rested(() => Promise.all([head.boundingBox(), head.locator('.none').boundingBox(), head.locator('.pwx').boundingBox()]));
    assert.equal(line!.height, 30);
    assert.ok(none!.x + none!.width < wx!.x - 40, 'a space between "No events" and the forecast');
    assert.ok(Math.abs(line!.x + line!.width - 20 - (wx!.x + wx!.width)) <= 1, 'the forecast at the end');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the agenda puts now in today\'s order, at the seed\'s 9:12 AM between the past Gym and the Dentist', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    const today = page.locator('.ph-agenda [data-days="2026-10-07"]');
    assert.deepEqual(await today.locator(':scope > :not(.pday)').evaluateAll(lines => lines.map(line => (line.classList.contains('ph-now') ? `now ${line.textContent}` : line.querySelector('.ell')!.firstChild!.textContent))),
      ['Gym', 'now 9:12 AM', 'Dentist', 'CS 101 lab report', 'Pay rent']);
    assert.equal(await page.locator('.ph-now').count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A day's items as the API has them: "Gym 7:00 AM", with any change still on its way marked. */
async function day(setpoint: Setpoint, date: string) {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const {items} = await setpoint.api<ItemsOut>('GET', `/items?from=${date}&to=${next}`);
  return items;
}
const titles = async (setpoint: Setpoint, date: string) => (await day(setpoint, date)).map(item => item.title);
const line = (page: Page, title: string) => page.locator('.ph-agenda .pitem', {hasText: title});
// Today's line of it, the past week having its own.
const todays = (page: Page, title: string) => page.locator('.ph-agenda [data-days="2026-10-07"] .pitem', {hasText: title});

async function agenda(setpoint: Setpoint) {
  const page = await setpoint.page('iphone');
  await page.clock.install();
  await instantScrolls(page);
  await page.goto(`${setpoint.base}/calendar`);
  await page.locator('.ph-agenda .pitem').first().waitFor();
  return page;
}

async function openDetail(page: Page, title: string) {
  await todays(page, title).first().tap();
  await page.locator('.ph-detail .fd-title', {hasText: title}).waitFor();
}

test('every control a finger needs takes a 44 px tap, and none takes its neighbour\'s: the header, a detail and the editor', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    await fingertips([page.locator('.hd .ph-month-btn'), page.getByRole('button', {name: 'Search'}), page.getByRole('button', {name: 'New event'})]);
    await page.locator('.pitem', {hasText: 'Pay rent'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Pay rent'}).waitFor();
    await fingertips([page.locator('.ph-detail .fd-mark.check'), page.locator('.ph-detail button[aria-label="Close"]'), ...await page.locator('.ph-detail .card-acts button').all()]);
    await page.locator('.ph-detail button[aria-label="Close"]').tap();
    await until('the detail closes', () => page.locator('.ph-detail').count(), count => count === 0);

    await page.getByRole('button', {name: 'New event'}).tap();
    const sheet = page.getByRole('dialog', {name: 'New event'});
    await sheet.waitFor();
    await sheet.getByPlaceholder('Add place').fill('Library');
    await sheet.getByRole('button', {name: 'Add reminder'}).tap();
    await sheet.locator('.menu-i').nth(2).tap();
    await until('two reminders', () => sheet.locator('.qchip .x').count(), count => count === 2);
    // The Event and Task switch, each reminder's × (never the next chip's), Add reminder, Clear place and the line's ?.
    await fingertips([sheet.getByRole('button', {name: 'Cancel'}), sheet.getByRole('button', {name: 'Create'}), ...await sheet.locator('.seg > *').all(),
      ...await sheet.locator('.qchip .x').all(), sheet.getByRole('button', {name: 'Add reminder'}), sheet.getByRole('button', {name: 'Clear place'}),
      sheet.getByRole('button', {name: 'What the line reads'})]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('+ opens the editor sheet on the day in view, and Create adds the event there', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    await page.getByRole('button', {name: 'New event'}).tap();
    const sheet = page.getByRole('dialog', {name: 'New event'});
    await sheet.waitFor();
    // Over the agenda and the tab bar, the whole screen.
    const box = (await rested(() => sheet.boundingBox()))!;
    assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 390, 844]);
    assert.equal(await page.getByLabel('Date', {exact: true}).inputValue(), '2026-10-07');
    await page.getByLabel('Describe the event').fill('Lunch with Ana 12-1pm');
    await sheet.getByRole('button', {name: 'Create'}).tap();
    await sheet.waitFor({state: 'detached'});
    await page.locator('.toast', {hasText: 'Created Lunch with Ana'}).waitFor();
    await line(page, 'Lunch with Ana').waitFor();
    assert.equal(await page.locator('.ph-agenda [data-days="2026-10-07"] .pitem', {hasText: 'Lunch with Ana'}).locator('.when').textContent(), '12:00 – 1:00 PM');
    assert.ok((await titles(setpoint, '2026-10-07')).includes('Lunch with Ana'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Edit saves in the sheet, its Undo putting the item back; a repeating event\'s edit asks which of its events', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    await openDetail(page, 'Dentist');
    await page.locator('.ph-detail').getByRole('button', {name: 'Edit'}).tap();
    const sheet = page.getByRole('dialog', {name: 'Edit event'});
    await sheet.waitFor();
    await page.getByLabel('Title', {exact: true}).fill('Dentist checkup');
    await sheet.getByRole('button', {name: 'Save'}).tap();
    await sheet.waitFor({state: 'detached'});
    // The detail stays, with what was saved.
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist checkup'}).waitFor();
    await until('saved', () => titles(setpoint, '2026-10-07'), list => list.includes('Dentist checkup'));
    const toast = await holdToast(page);
    await toast.getByText('Saved Dentist checkup').waitFor();
    await toast.getByRole('button', {name: 'Undo'}).tap();
    await until('put back', () => titles(setpoint, '2026-10-07'), list => list.includes('Dentist') && !list.includes('Dentist checkup'));

    // Gym repeats: its Save asks, and This event changes today's alone.
    await page.locator('.ph-detail button[aria-label="Close"]').tap();
    await openDetail(page, 'Gym');
    await page.locator('.ph-detail').getByRole('button', {name: 'Edit'}).tap();
    await page.getByLabel('Title', {exact: true}).fill('Gym class');
    await page.getByRole('dialog', {name: 'Edit event'}).locator('.ph-sheet-top').getByRole('button', {name: 'Save'}).tap();
    const which = page.getByRole('radiogroup', {name: 'Which events'});
    await which.waitFor();
    assert.equal(await which.getByRole('radio', {checked: true}).textContent().then(text => text?.startsWith('This event')), true);
    await page.locator('.scope-acts').getByRole('button', {name: 'Save'}).tap();
    await until('today\'s Gym renamed', () => titles(setpoint, '2026-10-07'), list => list.includes('Gym class'));
    assert.ok((await titles(setpoint, '2026-10-09')).includes('Gym'), 'Friday\'s stays Gym');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a line opened under where the detail card rests comes up to sit above it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    // Next Tuesday's lecture, low on the first screen, under where the card comes to rest.
    const lecture = page.locator('.ph-agenda [data-days="2026-10-13"] .pitem', {hasText: 'CS 101 lecture'});
    await lecture.tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'CS 101 lecture'}).waitFor();
    const [line, card] = await rested(() => Promise.all([lecture.boundingBox(), page.locator('.ph-detail').boundingBox()]));
    assert.ok(line!.y + line!.height <= card!.y, `the line (to ${line!.y + line!.height}) ends above the card (${card!.y})`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a task\'s ring in its detail completes it, and its done check reopens it, each with Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    const rent = async () => (await day(setpoint, '2026-10-07')).find(item => item.title === 'Pay rent')!;
    await openDetail(page, 'Pay rent');
    await page.locator('.ph-detail').getByRole('button', {name: 'Complete'}).tap();
    await page.locator('.ph-detail').getByRole('button', {name: 'Reopen'}).waitFor();
    const toast = await holdToast(page);
    await toast.getByText('Completed Pay rent').waitFor();
    // The card lifts clear of the toast: its actions stay in reach.
    const [acts, pill] = await rested(() => Promise.all([page.locator('.ph-detail .card-acts').boundingBox(), toast.boundingBox()]));
    assert.ok(acts!.y + acts!.height <= pill!.y, `the detail's actions (to ${acts!.y + acts!.height}) end above the toast (${pill!.y})`);
    await until('done', rent, item => item.done && !item.command);
    // Its line in the agenda shows it done too.
    await line(page, 'Pay rent').and(page.locator('.done')).waitFor();
    await page.locator('.ph-detail').getByRole('button', {name: 'Reopen'}).tap();
    await page.locator('.toast', {hasText: 'Reopened Pay rent'}).waitFor();
    await until('open again', rent, item => !item.done && !item.command);
    await page.locator('.ph-detail').getByRole('button', {name: 'Complete'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Delete waits out its toast: Undo keeps the item, and left alone it goes; a repeating event\'s asks which of its events', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    await openDetail(page, 'Dentist');
    await page.locator('.ph-detail').getByRole('button', {name: 'Delete'}).tap();
    // Off the agenda and the detail closed at once, the server not yet told.
    await page.locator('.toast:not(.leaving)', {hasText: 'Deleted Dentist'}).waitFor();
    await line(page, 'Dentist').waitFor({state: 'detached'});
    assert.equal(await page.locator('.ph-detail').count(), 0);
    assert.doesNotMatch(new URL(page.url()).pathname, /\/item\//);
    await setpoint.idle();
    assert.ok((await titles(setpoint, '2026-10-07')).includes('Dentist'), 'held while Undo is offered');
    await page.locator('.toast').getByRole('button', {name: 'Undo'}).tap();
    await line(page, 'Dentist').waitFor();
    await page.clock.runFor(UNDO_MS + 1000);
    await setpoint.idle();
    assert.ok((await titles(setpoint, '2026-10-07')).includes('Dentist'), 'Undo sent nothing');

    // Left alone, it's sent once the toast has gone.
    await openDetail(page, 'Dentist');
    await page.locator('.ph-detail').getByRole('button', {name: 'Delete'}).tap();
    await page.locator('.toast:not(.leaving)', {hasText: 'Deleted Dentist'}).waitFor();
    await page.clock.runFor(UNDO_MS);
    await until('deleted', () => titles(setpoint, '2026-10-07'), list => !list.includes('Dentist'), 10_000);
    await setpoint.idle();
    assert.equal(await line(page, 'Dentist').count(), 0);

    // Gym repeats: Delete asks in the bottom sheet. All events takes every Gym off the agenda at
    // once, and Undo brings them back.
    const fridayGym = page.locator('.ph-agenda [data-days="2026-10-09"] .pitem', {hasText: 'Gym'});
    await openDetail(page, 'Gym');
    await page.locator('.ph-detail').getByRole('button', {name: 'Delete'}).tap();
    const asking = page.getByRole('dialog', {name: 'Delete recurring event'});
    await asking.waitFor();
    assert.deepEqual(await asking.locator('.ph-bs-i > .ell').allTextContents(), ['Delete this event', 'Delete future events', 'Delete all events', 'Cancel']);
    await asking.getByRole('button', {name: /^Delete all events/}).tap();
    const held = await holdToast(page);
    await held.getByText('Deleted Gym').waitFor();
    await fridayGym.waitFor({state: 'detached'});
    assert.equal(await line(page, 'Gym').count(), 0, 'every Gym goes');
    await held.getByRole('button', {name: 'Undo'}).tap();
    await fridayGym.waitFor();

    // This event takes today's alone, once its toast has gone.
    await openDetail(page, 'Gym');
    await page.locator('.ph-detail').getByRole('button', {name: 'Delete'}).tap();
    await asking.getByRole('button', {name: /^Delete this event/}).tap();
    await page.locator('.toast:not(.leaving)', {hasText: 'Deleted Gym'}).waitFor();
    await page.clock.runFor(UNDO_MS);
    await until('today\'s Gym deleted', () => titles(setpoint, '2026-10-07'), list => !list.includes('Gym'), 10_000);
    assert.ok((await titles(setpoint, '2026-10-09')).includes('Gym'), 'Friday\'s stays');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the month picker jumps to a day at the top, far off or near, and Today goes back to today, as the tab does, gliding when today is loaded', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    const picker = page.getByRole('dialog', {name: 'Go to a day'});
    await page.locator('.hd .ph-month-btn').tap();
    await picker.getByText('October 2026').waitFor();
    for (let step = 0; step < 4; step += 1) await picker.getByRole('button', {name: 'Next month'}).tap();
    await picker.getByRole('button', {name: '2027-02-15'}).tap();
    await picker.waitFor({state: 'detached'});
    // Far off, the agenda opens there, with the week before it above.
    await until('the day at the top', () => topDay(page), day => day === '2027-02-15');
    assert.equal(new URL(page.url()).pathname, '/calendar/2027-02-15');
    assert.equal(await page.locator('.hd .ph-month-btn').textContent(), 'February 2027');
    assert.equal(await page.locator('.ph-agenda .ph-day').first().getAttribute('data-days').then(days => days!.split(' ')[0]), '2027-02-08');

    // Today goes back.
    await page.locator('.hd .ph-month-btn').tap();
    await picker.getByText('February 2027').waitFor();
    await picker.getByRole('button', {name: 'Today'}).tap();
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    assert.equal(new URL(page.url()).pathname, '/calendar');

    // Far off again, the tab opens the agenda on today: nothing to glide through.
    await page.locator('.hd .ph-month-btn').tap();
    await picker.getByRole('button', {name: 'Next month'}).tap();
    await picker.getByRole('button', {name: '2026-11-20'}).tap();
    await until('the day at the top', () => topDay(page), day => day === '2026-11-20');
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    assert.deepEqual(await scrollsAsked(page), []);

    // A day already loaded comes to the top at once, and the tab glides back to today.
    await page.locator('.hd .ph-month-btn').tap();
    await picker.getByRole('button', {name: '2026-10-14'}).tap();
    await until('the day at the top', () => topDay(page), day => day === '2026-10-14');
    assert.deepEqual(await scrollsAsked(page), []);
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    assert.deepEqual(await scrollsAsked(page), ['smooth']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the month picker swipes left to the next month and right to the one before, a swipe on a day not picking it, one from the screen\'s edge being Safari\'s Back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    const picker = page.getByRole('dialog', {name: 'Go to a day'});
    await page.locator('.hd .ph-month-btn').tap();
    await picker.getByText('October 2026').waitFor();
    // Started on a day, with the click a mouse sends after it: the month turns, the day isn't picked.
    const grid = picker.locator('.mini');
    await swipe(picker.getByRole('button', {name: '2026-10-14'}), 300, 200);
    await picker.getByText('November 2026').waitFor();
    await swipe(grid, 100, 220, false);
    await picker.getByText('October 2026').waitFor();
    await swipe(grid, 100, 220);
    await picker.getByText('September 2026').waitFor();
    // From the screen's edge it's Back's, and a short drag is a tap's: the month stays.
    await swipe(grid, 8, 200);
    await swipe(grid, 200, 180, false);
    assert.equal(await picker.locator('.mini-head .name').textContent(), 'September 2026');
    // A thumb drifting down as it swipes turns the month and leaves the sheet where it is.
    await grid.evaluate(element => {
      const fire = (type: string, x: number, y: number) => element.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerId: 9, pointerType: 'touch', button: 0, clientX: x, clientY: y}));
      fire('pointerdown', 300, 400);
      for (const step of [0.25, 0.5, 0.75, 1]) fire('pointermove', 300 - 100 * step, 400 + 30 * step);
      (window as unknown as {sheetMoved: string}).sheetMoved = element.closest<HTMLElement>('.ph-bs')!.style.transform;
      fire('pointerup', 200, 430);
    });
    assert.equal(await page.evaluate(() => (window as unknown as {sheetMoved: string}).sheetMoved), '');
    await picker.getByText('October 2026').waitFor();
    await swipe(grid, 100, 220);
    await picker.getByText('September 2026').waitFor();
    // The next tap on a day is a pick.
    await picker.getByRole('button', {name: '2026-09-28'}).tap();
    await picker.waitFor({state: 'detached'});
    await until('the day at the top', () => topDay(page), day => day === '2026-09-28');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the agenda loads on by itself until four empty weeks, then Show later loads four more', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // March 2027 emptied: every repeating event there goes.
    const {items} = await setpoint.api<ItemsOut>('GET', '/items?from=2027-02-01&to=2027-06-01');
    for (const id of new Set(items.map(item => item.id))) await setpoint.api('POST', `/items/${id}/delete`, {scope: 'all'});
    await until('emptied', () => setpoint.api<ItemsOut>('GET', '/items?from=2027-02-01&to=2027-06-01'), out => out.items.length === 0, 10_000);
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar/2027-03-01`);
    const later = page.locator('.ph-agenda .ph-later');
    await later.waitFor();
    // The day it opens on keeps its own line, and the four weeks after it fold into one.
    assert.deepEqual(await page.locator('.ph-agenda .pday').allTextContents(), ['Mon, Feb 22 – Sun, Feb 28No events', 'Mon, Mar 1No events', 'Tue, Mar 2 – Sun, Mar 28No events']);
    await until('the day at the top', () => topDay(page), day => day === '2027-03-01');
    await later.getByRole('button', {name: 'Show later'}).tap();
    await until('four more weeks', () => page.locator('.ph-agenda .pday').last().textContent(), text => text === 'Tue, Mar 2 – Sun, Apr 25No events');
    await later.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('overdue tasks lead today as its Overdue group, the tab counts them, and a detail\'s Snooze holds one off with Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen', fixtures: ['overdue-tasks']});
  try {
    const page = await agenda(setpoint);
    const group = page.locator('.ph-agenda [data-days="2026-10-07"] .ph-overdue');
    await group.locator('.pitem').first().waitFor();
    const rows = () => group.locator('.pitem').evaluateAll(lines => lines.map(one => `${one.querySelector('.when')!.textContent}|${one.querySelector('.ell')!.textContent}`));
    assert.equal(await group.locator('.ph-overdue-h').textContent(), 'Overdue3');
    // The most recently due first, each saying how long it's been overdue.
    assert.deepEqual(await rows(), ['1 hr overdue|Call the landlord about the heater', '2 days overdue|Submit the parking permit form', '13 days overdue|Renew the library card']);
    // Today's own lines leave out the one due today; Monday keeps its own.
    assert.equal(await page.locator('.ph-agenda [data-days="2026-10-07"] > .pitem', {hasText: 'Call the landlord'}).count(), 0);
    assert.equal(await page.locator('.ph-agenda [data-days="2026-10-05"] .pitem', {hasText: 'Submit the parking permit form'}).count(), 1);
    // The group's head is under today's, never over it.
    const [head, label] = await rested(() => Promise.all([page.locator('.ph-agenda [data-days="2026-10-07"] .pday').boundingBox(), group.locator('.ph-overdue-h').boundingBox()]));
    assert.ok(label!.y >= head!.y + head!.height, 'the Overdue label sits under today\'s head');

    // The tab counts them on another page, not on the Agenda.
    const badge = page.locator('.ph-tab', {hasText: 'Agenda'}).locator('.ph-badge');
    assert.equal(await badge.count(), 0);
    await page.locator('.ph-tab', {hasText: 'Inbox'}).tap();
    await until('the Agenda tab\'s count', () => badge.textContent(), text => text === '3');
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();

    // Snooze, from its detail, in the bottom sheet with when each ends.
    await group.locator('.pitem', {hasText: 'Submit the parking permit form'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Submit the parking permit form'}).waitFor();
    await page.locator('.ph-detail').getByRole('button', {name: 'Snooze'}).tap();
    const sheet = page.getByRole('dialog', {name: 'Snooze Submit the parking permit form'});
    await sheet.waitFor();
    assert.deepEqual(await sheet.locator('.ph-bs-i').evaluateAll(choices => choices.map(one => `${one.querySelector('.ell')!.textContent}|${one.querySelector('.ph-bs-detail')!.textContent}`)),
      ['1 hour|10:12 AM', '3 hours|12:12 PM', 'Tomorrow|Thu 9:00 AM']);
    await sheet.getByRole('button', {name: /^1 hour/}).tap();
    const toast = await holdToast(page);
    await toast.getByText('Snoozed Submit the parking permit form').waitFor();
    await until('held off', rows, list => list.length === 2 && !list.some(one => one.includes('parking')));
    assert.equal(await page.locator('.ph-detail').count(), 0);
    // Its day keeps its line.
    assert.equal(await page.locator('.ph-agenda [data-days="2026-10-05"] .pitem', {hasText: 'Submit the parking permit form'}).count(), 1);
    await toast.getByRole('button', {name: 'Undo'}).tap();
    await until('back', rows, list => list.length === 3);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an Overdue line swiped left offers Snooze, and swiped all the way opens its sheet; neither opens its detail', async () => {
  const setpoint = await startSetpoint({clock: 'frozen', fixtures: ['overdue-tasks']});
  try {
    const page = await agenda(setpoint);
    const line = page.locator('.ph-agenda [data-days="2026-10-07"] .ph-overdue .ph-swipe', {hasText: 'Submit the parking permit form'});
    await line.waitFor();
    // A finger from x `from` to x `to`, then lifted, and the click a mouse sends after it.
    const swipe = (from: number, to: number, click = true) => line.evaluate((element, [start, end, clicks]) => {
      // Sent to the line itself, so its height on screen doesn't matter.
      const y = 400;
      const fire = (type: string, x: number) => element.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerId: 9, pointerType: 'touch', button: 0, clientX: x, clientY: y}));
      fire('pointerdown', start);
      for (const step of [0.1, 0.25, 0.5, 0.75, 1]) fire('pointermove', start + (end - start) * step);
      fire('pointerup', end);
      if (clicks) element.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: end, clientY: y}));
    }, [from, to, click] as const);
    await swipe(300, 240);
    await line.locator('.sw-b', {hasText: 'Snooze'}).tap();
    const sheet = page.getByRole('dialog', {name: 'Snooze Submit the parking permit form'});
    await sheet.waitFor();
    assert.equal(await page.locator('.ph-detail').count(), 0);
    await page.keyboard.press('Escape');
    await sheet.waitFor({state: 'detached'});
    // As a finger does it, with no click after: the sheet's choice is still a tap.
    await swipe(340, 30, false);
    await sheet.waitFor();
    assert.equal(await page.locator('.ph-detail').count(), 0);
    await sheet.getByRole('button', {name: /^Tomorrow/}).tap();
    await holdToast(page);
    await page.locator('.toast', {hasText: 'Snoozed Submit the parking permit form'}).waitFor();
    await line.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search takes the header\'s place: the list stays put, and Cancel leaves search from the moment it opens', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    const list = page.locator('.ph-agenda[aria-label="Agenda"]');
    const before = await rested(() => list.boundingBox());
    await page.getByRole('button', {name: 'Search'}).tap();
    const field = page.getByLabel('Search events and tasks');
    await field.waitFor();
    // The field is in the header's row, in the title's place: the list under it doesn't move.
    assert.equal((await rested(() => list.boundingBox()))!.y, before!.y, 'the list stays where it was');
    assert.equal(await page.locator('.hd .hd-title').isVisible(), false, 'the title gives the field its place');
    // An empty field has its way out: Cancel, a fingertip's size.
    const cancel = page.locator('.hd').getByRole('button', {name: 'Cancel'});
    await fingertips([cancel]);
    await cancel.tap();
    await field.waitFor({state: 'detached'});
    await page.locator('.hd .hd-title').waitFor();
    // With words, Cancel leaves the results too.
    await page.getByRole('button', {name: 'Search'}).tap();
    await field.fill('smile');
    await page.getByRole('region', {name: 'Search results'}).locator('.ph-res').first().waitFor();
    await cancel.tap();
    await page.getByRole('region', {name: 'Search results'}).waitFor({state: 'detached'});
    assert.ok(await list.isVisible());
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search: plain words, the results in the list\'s place, a result\'s detail and back, clear empties it, Cancel leaves it where the agenda was, and the tab leaves it for today', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await agenda(setpoint);
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    await page.getByRole('button', {name: 'Search'}).tap();
    const field = page.getByLabel('Search events and tasks');
    await field.waitFor();
    // Until there are words, the agenda stays.
    assert.ok(await page.locator('.ph-agenda[aria-label="Agenda"]').isVisible());
    await field.fill('smile');
    const results = page.getByRole('region', {name: 'Search results'});
    await results.locator('.ph-res').first().waitFor();
    assert.equal(await results.locator('.ph-res-count').textContent(), '1 result');
    assert.deepEqual(await results.locator('.pday').allTextContents(), ['Upcoming']);
    assert.equal(await results.locator('.ph-res-why').textContent(), 'Place Smile Dental');
    assert.ok(!(await page.locator('.ph-agenda[aria-label="Agenda"]').isVisible()));

    // A result's detail opens over the results, and closing it comes back to them.
    await results.locator('.ph-res', {hasText: 'Dentist'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist'}).waitFor();
    await page.locator('.ph-detail button[aria-label="Close"]').tap();
    await page.locator('.ph-detail').waitFor({state: 'detached'});
    await results.locator('.ph-res', {hasText: 'Dentist'}).waitFor();

    // Plain words: a date word stays a word, never a chip.
    await field.fill('march ');
    await results.locator('.no-results, .ph-res').first().waitFor();
    assert.equal(await page.locator('.hd .search .qchip').count(), 0);
    assert.equal(await field.inputValue(), 'march ');

    // Clear empties the field, the agenda back under it; Cancel leaves search, the agenda where it was.
    await page.getByRole('button', {name: 'Clear search'}).tap();
    assert.equal(await field.inputValue(), '');
    await page.locator('.ph-agenda[aria-label="Agenda"]').waitFor();
    await page.locator('.hd').getByRole('button', {name: 'Cancel'}).tap();
    await page.locator('.hd .search').waitFor({state: 'detached'});
    await until('the agenda where it was', () => topDay(page), day => day === '2026-10-07');

    // The Agenda tab over the results leaves search for today.
    await page.getByRole('button', {name: 'Search'}).tap();
    await field.fill('smile');
    await results.locator('.ph-res').first().waitFor();
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.hd .search').waitFor({state: 'detached'});
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
