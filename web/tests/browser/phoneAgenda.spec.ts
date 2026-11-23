// The phone's agenda at 390 × 844 (board 21): today and the next 7 days, an item's detail,
// reminders, forecasts and now. Then its changes on the seed: + opens the editor sheet on the day in
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

after(cleanUp);

test('the agenda: today and the next 7 days, empty days folded, an item\'s detail read-only', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    await page.locator('.ph-agenda .pwx').first().waitFor();
    assert.equal(await page.locator('.hd .ph-range').textContent(), 'Oct 7 – 14');
    assert.deepEqual((await page.locator('.ph-agenda .pday').allTextContents()).map(text => text.trim()), [
      'Today · Wed, Oct 778° / 61°', 'Thu, Oct 872° / 59°', 'Fri, Oct 9', 'Sat, Oct 10 – Sun, Oct 11No events', 'Mon, Oct 12', 'Tue, Oct 1364° / 55°', 'Wed, Oct 14',
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
    assert.deepEqual((await page.locator('.ph-agenda .pday').allTextContents()).map(text => text.trim()).slice(3, 5), [
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

async function agenda(setpoint: Setpoint) {
  const page = await setpoint.page('iphone');
  await page.clock.install();
  await page.goto(`${setpoint.base}/calendar`);
  await page.locator('.ph-agenda .pitem').first().waitFor();
  return page;
}

async function openDetail(page: Page, title: string) {
  await line(page, title).first().tap();
  await page.locator('.ph-detail .fd-title', {hasText: title}).waitFor();
}

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
    assert.equal(await page.getByLabel('Date', {exact: true}).inputValue(), 'Wed, Oct 7');
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
    assert.deepEqual(await asking.locator('.ph-bs-i > .ell').allTextContents(), ['This event', 'This and following', 'All events']);
    await asking.getByRole('button', {name: /^All events/}).tap();
    const held = await holdToast(page);
    await held.getByText('Deleted Gym').waitFor();
    await fridayGym.waitFor({state: 'detached'});
    assert.equal(await line(page, 'Gym').count(), 0, 'every Gym goes');
    await held.getByRole('button', {name: 'Undo'}).tap();
    await fridayGym.waitFor();

    // This event takes today's alone, once its toast has gone.
    await openDetail(page, 'Gym');
    await page.locator('.ph-detail').getByRole('button', {name: 'Delete'}).tap();
    await asking.getByRole('button', {name: /^This event/}).tap();
    await page.locator('.toast:not(.leaving)', {hasText: 'Deleted Gym'}).waitFor();
    await page.clock.runFor(UNDO_MS);
    await until('today\'s Gym deleted', () => titles(setpoint, '2026-10-07'), list => !list.includes('Gym'), 10_000);
    assert.ok((await titles(setpoint, '2026-10-09')).includes('Gym'), 'Friday\'s stays');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
