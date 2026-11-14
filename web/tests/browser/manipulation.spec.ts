// Direct manipulation on the month grid (DESIGN.md › Drag, Recurring events and Health and states;
// boards 15, 15b and 19b): the boards built and checked, then the flows: a drop with each scope, a
// single event and a task moved at once (pending with a spinner until the provider confirms), a
// change that fails in place with Try again and Move back, Clone, Copy and Paste, Colour, Delete (and
// a recurring one asking which), multi-select, and the drag, the drop prompt and the failed card
// under the 1.25 wide-screen zoom (D23). The dev provider confirms after 600 ms and refuses moving
// Dinner with Sam to Saturday with Google's 409 (board 19b, by rule).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {UNDO_MS} from '../../src/app/toast.ts';
import {cleanUp, holdToast, pauseClock, rested, startSetpoint, test, until, ZOOM} from './harness.ts';
import type {Setpoint} from './harness.ts';

const GAP = 8;
// Past its Undo, a delete goes to the server and the dev provider (600 ms).
const AFTER_UNDO = 10_000;

after(cleanUp);

const next = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const items = async (setpoint: Setpoint, date: string) => (await setpoint.api<ItemsOut>('GET', `/items?from=${date}&to=${next(date)}`)).items;
/** "Gym 7:00 AM", "Pay rent" … as the API has a day. */
async function titles(setpoint: Setpoint, date: string): Promise<string[]> {
  return (await items(setpoint, date)).map(item => `${item.title}${item.starts_at ? ` ${new Date(item.starts_at).toLocaleTimeString('en-US', {timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit'})}` : ''}`);
}
// The browser's change reaches the server first: until then the days have nothing pending either.
async function settled(setpoint: Setpoint, dates: string[]) {
  await setpoint.idle();
  return until(`${dates.join(', ')} settled`, async () => (await Promise.all(dates.map(date => items(setpoint, date)))).flat(),
    list => list.every(item => !item.command || item.command.state === 'failed'), 8000);
}

const chip = (page: Page, date: string, title: string) => page.locator(`.cell[data-date="${date}"] :is(.ev, .tk)`, {hasText: title});

async function openCalendar(page: Page, base: string) {
  await page.goto(`${base}/calendar`);
  await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
  await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
}

/**
 * Runs the page's clock (a check that installs one) past the Undo of a delete, as 6 s waited out are
 * the most a check here spends, then sees its items off the grid. The delete goes with its
 * toast, so this goes from that; the clock may be stopped (pauseClock), the chips' fold being on it too.
 */
async function passUndo(page: Page, ...deleted: [date: string, title: string][]) {
  await page.locator('.toast:not(.leaving)', {hasText: /Deleted /}).waitFor();
  await page.clock.runFor(UNDO_MS);
  for (const [date, title] of deleted) await chip(page, date, title).waitFor({state: 'detached'});
}

/** Presses a chip and carries it to another day's cell, `held` true to stop before letting go. */
async function drag(page: Page, from: Locator, to: string, {held = false} = {}) {
  const box = (await rested(() => from.boundingBox()))!;
  const target = (await rested(() => page.locator(`.cell[data-date="${to}"]`).boundingBox()))!;
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height / 2 + 10, {steps: 3});
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {steps: 5});
  if (!held) await page.mouse.up();
}

test('boards 15 and 15b: Gym dragged from Wednesday to Thursday, then the drop asks which; This event moves Wednesday\'s alone', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    // Board 15: pressed at 72, 8 in the chip and held at 671, 296 in the month section (it starts at 248, 56),
    // over Thursday, a column on from the board's 524 with Sunday first (SV-29).
    const gym = (await chip(page, '2026-10-07', 'Gym').boundingBox())!;
    await page.mouse.move(gym.x + 72, gym.y + 8);
    await page.mouse.down();
    await page.mouse.move(gym.x + 120, gym.y + 30, {steps: 4});
    await page.mouse.move(248 + 671, 56 + 296, {steps: 4});
    await page.locator('.ev.lift', {hasText: 'Gym'}).waitFor();
    await page.locator('.drag-tip', {hasText: 'Thu, Oct 8 · 7:00 AM'}).waitFor();
    await page.locator('.cell[data-date="2026-10-08"].drop').waitFor();
    await page.locator('.cell[data-date="2026-10-07"] .ev.ghost', {hasText: 'Gym'}).waitFor();

    // Board 15b: let go; the prompt sits beside the dropped chip, This event chosen.
    await page.mouse.up();
    const prompt = page.locator('.scope-card');
    await prompt.waitFor();
    await page.locator('.ag-item', {hasText: 'Moving to Thu, Oct 8'}).waitFor();
    await page.locator('.cell[data-date="2026-10-07"] .ev.ghost.faded', {hasText: 'Gym'}).waitFor();
    assert.equal(await prompt.getAttribute('data-side'), 'left');
    const dropped = (await rested(() => page.locator('.cell[data-date="2026-10-08"] .ev.sel', {hasText: 'Gym'}).boundingBox()))!;
    const box = (await rested(() => prompt.boundingBox()))!;
    assert.equal(Math.round((dropped.x - (box.x + box.width)) / ZOOM), GAP);

    await page.keyboard.press('Enter');
    await prompt.waitFor({state: 'detached'});
    await settled(setpoint, ['2026-10-07', '2026-10-08']);
    assert.deepEqual((await titles(setpoint, '2026-10-07')).filter(title => title.startsWith('Gym')), []);
    assert.deepEqual((await titles(setpoint, '2026-10-08')).filter(title => title.startsWith('Gym')), ['Gym 7:00 AM']);
    assert.deepEqual((await titles(setpoint, '2026-10-14')).filter(title => title.startsWith('Gym')), ['Gym 7:00 AM']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a drop asks which occurrences: This and following splits Gym, All events moves the lecture past ones too, Cancel leaves it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    // Cancel (Esc): nothing moves.
    await drag(page, chip(page, '2026-10-16', 'Gym'), '2026-10-17');
    await page.locator('.scope-card').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.scope-card').waitFor({state: 'detached'});
    await chip(page, '2026-10-16', 'Gym').waitFor();
    assert.equal(await chip(page, '2026-10-17', 'Gym').count(), 0);

    // This and following: Friday's Gym to Saturday from Oct 16 on.
    await drag(page, chip(page, '2026-10-16', 'Gym'), '2026-10-17');
    await page.locator('.scope-card', {hasText: 'Fri → Sat from Oct 16 on'}).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await settled(setpoint, ['2026-10-16', '2026-10-17']);
    assert.deepEqual([await titles(setpoint, '2026-10-09'), await titles(setpoint, '2026-10-16'), await titles(setpoint, '2026-10-17'), await titles(setpoint, '2026-10-24')].map(list => list.filter(title => title.startsWith('Gym'))),
      [['Gym 7:00 AM'], [], ['Gym 7:00 AM'], ['Gym 7:00 AM']]);

    // All events: Tuesday's lecture to Wednesday, past ones too.
    await drag(page, chip(page, '2026-10-13', 'CS 101 lecture'), '2026-10-14');
    await page.locator('.scope-card', {hasText: 'Tue → Wed, past ones too'}).waitFor();
    await page.locator('.scope-card .ropt', {hasText: 'All events'}).click();
    await page.getByRole('button', {name: 'Move'}).click();
    await settled(setpoint, ['2026-10-13', '2026-10-14']);
    assert.deepEqual([await titles(setpoint, '2026-10-06'), await titles(setpoint, '2026-10-07'), await titles(setpoint, '2026-10-14')].map(list => list.filter(title => title.startsWith('CS 101 lecture'))),
      [[], ['CS 101 lecture 6:00 PM'], ['CS 101 lecture 6:00 PM']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an event and a task move at once, waiting with a spinner until the provider confirms', async () => {
  // The dev provider holds every change while this file is there, so the pending move is the
  // check's to read, not the provider's 600 ms.
  const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-hold-'));
  const hold = path.join(holdDir, 'hold');
  fs.writeFileSync(hold, '');
  const setpoint = await startSetpoint({clock: 'frozen', env: {SETPOINT_DEV_PROVIDER_HOLD: hold}});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await drag(page, chip(page, '2026-10-07', 'Dentist'), '2026-10-08');
    // No prompt for a single event: pending where it landed, then confirmed.
    // The spinner shows only after a second (DESIGN.md #54): it's there, not yet seen.
    await page.locator('.cell[data-date="2026-10-08"] .ev.pending .spin').waitFor({state: 'attached'});
    fs.rmSync(hold);
    await page.locator('.cell[data-date="2026-10-08"] .ev:not(.pending)', {hasText: 'Dentist'}).waitFor();
    assert.equal(await chip(page, '2026-10-07', 'Dentist').count(), 0);
    assert.deepEqual((await titles(setpoint, '2026-10-08')).filter(title => title.startsWith('Dentist')), ['Dentist 2:30 PM']);

    // A task moves by whole days.
    await drag(page, chip(page, '2026-10-07', 'Pay rent'), '2026-10-09');
    await page.locator('.cell[data-date="2026-10-09"] .tk:not(.pending)', {hasText: 'Pay rent'}).waitFor();
    const rent = (await items(setpoint, '2026-10-09')).find(item => item.title === 'Pay rent')!;
    assert.equal(rent.due_date, '2026-10-09');
    // A done task doesn't move: no drag starts while it's held over another day, and it stays.
    await drag(page, chip(page, '2026-10-05', 'Return library books'), '2026-10-06', {held: true});
    // Nothing happens to wait for: the done task stays put.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await page.locator('.drag-tip').count(), 0);
    await page.mouse.up();
    assert.equal(await chip(page, '2026-10-05', 'Return library books').count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    fs.rmSync(holdDir, {recursive: true, force: true});
  }
});

test('board 19b: a change that failed stays in place with Google\'s words; Try again waits and fails again; Move back takes it back', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave', 'failed-change', 'stale-todoist'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const card = page.locator('.failed-card');
    await card.waitFor();
    await card.locator('.provider-says', {hasText: 'The requested event was modified by another client. (409 Conflict)'}).waitFor();
    await card.locator('.card-b', {hasText: 'From Fri, Oct 9'}).waitFor();
    await page.locator('.cell[data-date="2026-10-10"] .ev.failed .icon').waitFor();
    await page.locator('.cell[data-date="2026-10-07"] .tk.pending .spin').waitFor();
    // A Saturday, in the grid's right half: the card is on its left (#348).
    assert.equal(await card.getAttribute('data-side'), 'left');
    const failed = (await rested(() => chip(page, '2026-10-10', 'Dinner with Sam').boundingBox()))!;
    const box = (await rested(() => card.boundingBox()))!;
    assert.ok(box.x + box.width <= failed.x, `the card ends at ${box.x + box.width}, beside the chip from ${failed.x}`);

    // Try again: pending once more at once, before the server has it (held here at its door), then
    // the provider refuses again, in place (SV-42).
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route('**/api/commands/*/retry', async route => {
      await held;
      await route.continue();
    });
    await card.getByRole('button', {name: 'Try again'}).click();
    await page.locator('.cell[data-date="2026-10-10"] .ev.pending', {hasText: 'Dinner with Sam'}).waitFor();
    release();
    await page.locator('.cell[data-date="2026-10-10"] .ev.failed', {hasText: 'Dinner with Sam'}).waitFor();
    // Move back: Friday again, and the card goes.
    await page.locator('.failed-card').getByRole('button', {name: 'Move back'}).click();
    await chip(page, '2026-10-09', 'Dinner with Sam').waitFor();
    await page.locator('.failed-card').waitFor({state: 'detached'});
    assert.equal(await chip(page, '2026-10-10', 'Dinner with Sam').count(), 0);
    assert.deepEqual((await titles(setpoint, '2026-10-09')).filter(title => title.startsWith('Dinner')), ['Dinner with Sam 7:00 PM']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a drag the provider refuses fails in place, and its card says so', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await drag(page, chip(page, '2026-10-09', 'Dinner with Sam'), '2026-10-10');
    await page.locator('.cell[data-date="2026-10-10"] .ev.failed', {hasText: 'Dinner with Sam'}).waitFor();
    await page.locator('.failed-card', {hasText: 'Couldn\'t move Dinner with Sam'}).waitFor();
    // Closing the card leaves the failure outlined; clicking the chip brings the card back.
    await page.locator('.failed-card').getByRole('button', {name: 'Close'}).click();
    await page.locator('.failed-card').waitFor({state: 'detached'});
    await chip(page, '2026-10-10', 'Dinner with Sam').click();
    await page.locator('.failed-card').waitFor();
    assert.equal(await page.locator('.fd').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Copy and Paste (Copy and ⌘C say what they took, S10) and Delete from the card and the keys; multi-select', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await openCalendar(page, setpoint.base);
    const dentists = async (date: string) => (await items(setpoint, date)).filter(item => item.title === 'Dentist');

    // Copy, then ⌘V on Tue, Oct 13: the copy keeps its time.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').getByRole('button', {name: 'Copy'}).click();
    await page.locator('.toast', {hasText: 'Copied Dentist'}).waitFor();
    await page.locator('.cell[data-date="2026-10-13"]').click({position: {x: 70, y: 150}});
    await page.keyboard.press('Meta+v');
    await until('the paste', () => dentists('2026-10-13'), list => list.length === 1 && !list[0]!.command);
    assert.deepEqual(await titles(setpoint, '2026-10-13').then(list => list.filter(title => title.startsWith('Dentist'))), ['Dentist 2:30 PM']);

    // Delete the pasted Dentist with the key, once the browser draws it saved: Delete leaves pending items.
    await until('Dentist drawn saved', () => chip(page, '2026-10-13', 'Dentist').evaluateAll(chips => chips.map(one => one.classList.contains('pending'))), pending => pending.join() === 'false');
    await chip(page, '2026-10-13', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Delete');
    await passUndo(page, ['2026-10-13', 'Dentist']);
    await until('the delete, once its Undo has gone', () => dentists('2026-10-13'), list => list.length === 0, AFTER_UNDO);

    // Multi-select: ⌘ alone puts the card away and keeps Dinner selected; ⌘-click a second;
    // ⌘C and ⌘V on Tue, Oct 20 keeps their distance; Delete takes both copies.
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Meta');
    await page.locator('.fd').waitFor({state: 'detached'});
    await chip(page, '2026-10-15', 'Career fair').click({modifiers: ['Meta']});
    await page.keyboard.press('Meta+c');
    await page.locator('.toast', {hasText: 'Copied 2 items'}).waitFor();
    await page.locator('.cell[data-date="2026-10-20"]').click({position: {x: 70, y: 150}});
    await page.keyboard.press('Meta+v');
    await until('both pasted', async () => [...await items(setpoint, '2026-10-20'), ...await items(setpoint, '2026-10-26')].filter(item => !item.recurring),
      list => list.length === 2 && list.every(item => !item.command));
    assert.deepEqual((await titles(setpoint, '2026-10-20')).filter(title => title.startsWith('Dinner')), ['Dinner with Sam 7:00 PM']);
    assert.deepEqual((await titles(setpoint, '2026-10-26')).filter(title => title.startsWith('Career')), ['Career fair 10:00 AM']);
    // The browser draws them saved (the drafts gone, nothing pending: Delete leaves pending items) after the server has them.
    for (const [date, title] of [['2026-10-20', 'Dinner with Sam'], ['2026-10-26', 'Career fair']] as const) {
      await until(`${title} drawn saved`, () => chip(page, date, title).evaluateAll(chips => chips.map(one => one.classList.contains('pending'))), pending => pending.join() === 'false');
    }
    await chip(page, '2026-10-20', 'Dinner with Sam').click();
    await chip(page, '2026-10-26', 'Career fair').click({modifiers: ['Meta']});
    await page.keyboard.press('Delete');
    await passUndo(page, ['2026-10-20', 'Dinner with Sam'], ['2026-10-26', 'Career fair']);
    await until('both copies gone', async () => [...await items(setpoint, '2026-10-20'), ...await items(setpoint, '2026-10-26')].filter(item => !item.recurring), list => list.length === 0, AFTER_UNDO);

    // Deleting one Gym asks which; This event takes Friday's alone.
    await chip(page, '2026-10-16', 'Gym').click();
    await page.locator('.fd').getByRole('button', {name: 'Delete'}).click();
    await page.locator('.scope-card', {hasText: 'Delete recurring event'}).waitFor();
    await page.keyboard.press('Enter');
    await passUndo(page, ['2026-10-16', 'Gym']);
    await until('Friday\'s Gym gone', async () => (await titles(setpoint, '2026-10-16')).filter(title => title.startsWith('Gym')), list => list.length === 0, AFTER_UNDO);
    assert.deepEqual((await titles(setpoint, '2026-10-14')).filter(title => title.startsWith('Gym')), ['Gym 7:00 AM']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a paste shows at once, pending, before the server answers; ⌘Z takes it away again, and puts a colour back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const dentists = async (date: string) => (await items(setpoint, date)).filter(item => item.title === 'Dentist');

    // Hold the create at the server's door: the copy is drawn pending on Tue, Oct 13 meanwhile.
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route('**/api/items', async route => {
      if (route.request().method() === 'POST') await held;
      await route.continue();
    });
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.keyboard.press('Meta+c');
    await page.locator('.cell[data-date="2026-10-13"]').click({position: {x: 70, y: 150}});
    await page.keyboard.press('Meta+v');
    await page.locator('.cell[data-date="2026-10-13"] .ev.pending', {hasText: 'Dentist'}).waitFor();
    assert.deepEqual(await dentists('2026-10-13'), [], 'drawn before the server has it');
    release();
    await until('the paste', () => dentists('2026-10-13'), list => list.length === 1 && !list[0]!.command);
    await page.unroute('**/api/items');

    // ⌘Z undoes it once the browser has the server's answer, as the toast says.
    await page.locator('.toast', {hasText: 'Pasted Dentist'}).waitFor();
    await page.keyboard.press('Meta+z');
    await until('the paste undone', () => dentists('2026-10-13'), list => list.length === 0);

    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.locator('.fd').getByRole('button', {name: 'Colour'}).click();
    await page.locator('.fd-swatches').getByRole('radio', {name: 'good'}).click();
    const dinner = async () => (await items(setpoint, '2026-10-09')).find(item => item.title === 'Dinner with Sam')!;
    await until('the colour', dinner, item => item.colour === 'good' && !item.command);
    await page.locator('.toast', {hasText: 'Changed the colour of Dinner with Sam'}).waitFor();
    await page.keyboard.press('Meta+z');
    await until('the colour undone', dinner, item => item.colour === null && !item.command);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a delete and a completion show at once, before the server has them', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await openCalendar(page, setpoint.base);
    // Stopped, so the delete's Undo, and the delete held behind it, last as long as the check says.
    await pauseClock(page);
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    // The completion is held at the server's door; the delete needs no holding, as it waits out
    // its Undo in the browser first.
    await page.route(/\/api\/items\/\d+\/complete$/, async route => {
      await held;
      await route.continue();
    });

    // Delete Dinner with Sam: off the grid at once, while the server still has it.
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Delete');
    await page.locator('.toast:not(.leaving)', {hasText: 'Deleted Dinner with Sam'}).waitFor();
    // A moment short of the Undo's end: off the grid, its fold run.
    await page.clock.runFor(UNDO_MS - 1);
    await until('Dinner leaves the grid', () => chip(page, '2026-10-09', 'Dinner with Sam').count(), count => count === 0);
    // Whatever the browser has sent has landed, and the server has no delete: a delete it has lists
    // the item, pending, until the provider confirms.
    await setpoint.idle();
    const dinner = (await items(setpoint, '2026-10-09')).find(item => item.title === 'Dinner with Sam');
    assert.ok(dinner && !dinner.command, 'the server doesn\'t have it yet');

    // Complete Pay rent from the day pane: done at once.
    await page.locator('.cell[data-date="2026-10-07"]').click({position: {x: 70, y: 150}});
    await page.getByRole('button', {name: 'Complete Pay rent'}).click();
    await page.getByRole('button', {name: 'Reopen Pay rent'}).waitFor();
    assert.equal((await items(setpoint, '2026-10-07')).find(item => item.title === 'Pay rent')!.done, false, 'the server doesn\'t have it yet');

    release();
    await page.clock.runFor(1);
    // The rest runs on real time again, the refetches with it.
    await page.clock.resume();
    await until('the delete lands', async () => (await titles(setpoint, '2026-10-09')).filter(title => title.startsWith('Dinner with Sam')), list => list.length === 0, AFTER_UNDO);
    await until('the completion lands', async () => (await items(setpoint, '2026-10-07')).find(item => item.title === 'Pay rent')!, task => task.done && !task.command);
    await setpoint.idle();
    assert.equal(await chip(page, '2026-10-09', 'Dinner with Sam').count(), 0, 'and Dinner stays gone');
    await page.unroute(/\/api\/items\/\d+\/complete$/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #1: Delete or Backspace says what it deleted and offers Undo, which keeps it; the delete is sent only once the Undo is gone', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await openCalendar(page, setpoint.base);
    // Stopped, so the Undo's 6 s are the check's to move on.
    await pauseClock(page);
    const dentists = async () => (await items(setpoint, '2026-10-07')).filter(item => item.title === 'Dentist');

    // Backspace on Dentist: off the grid, the toast says so, and the address leaves the item.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Backspace');
    await page.locator('.toast', {hasText: 'Deleted Dentist'}).waitFor();
    // It folds away first (polish audit calflows-11); a moment short of the Undo's end, it's still offered.
    await page.clock.runFor(UNDO_MS - 1);
    await until('off the grid', () => chip(page, '2026-10-07', 'Dentist').count(), count => count === 0);
    assert.doesNotMatch(new URL(page.url()).pathname, /\/item\//);
    // Undo brings it back, and the server never hears of it.
    await page.locator('.toast').getByRole('button', {name: 'Undo'}).click();
    await chip(page, '2026-10-07', 'Dentist').waitFor();
    // Nothing happens to wait for: past the 6 s Undo, the delete is never sent.
    await page.clock.fastForward(UNDO_MS + 1000);
    await setpoint.idle();
    assert.equal((await dentists()).length, 1, 'the delete was never sent');
    assert.equal(await chip(page, '2026-10-07', 'Dentist').count(), 1);

    // ⌘Z undoes it too while the toast is up.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.keyboard.press('Delete');
    await page.locator('.toast', {hasText: 'Deleted Dentist'}).waitFor();
    await page.keyboard.press('Meta+z');
    await chip(page, '2026-10-07', 'Dentist').waitFor();

    // Left alone, it's sent once the toast has gone.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.keyboard.press('Delete');
    await page.locator('.toast', {hasText: 'Deleted Dentist'}).waitFor();
    await setpoint.idle();
    assert.equal((await dentists()).length, 1, 'held while Undo is offered');
    await passUndo(page, ['2026-10-07', 'Dentist']);
    await until('the delete is sent', dentists, list => list.length === 0, AFTER_UNDO);
    await setpoint.idle();
    assert.equal(await chip(page, '2026-10-07', 'Dentist').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-247, D506: a delete is sent when its toast goes, however it goes but by Undo: held past 6 s its Undo still keeps it, swiped away or replaced it\'s sent at once', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await openCalendar(page, setpoint.base);
    // Stopped, so nothing here goes by time unless the check moves it.
    await pauseClock(page);
    const titled = async (date: string, title: string) => (await items(setpoint, date)).filter(item => item.title === title);
    const toast = page.locator('.toast:not(.leaving)');

    // Held past its 6 s, the toast and its Undo stay, and Undo keeps Dentist: nothing was sent.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.keyboard.press('Delete');
    await page.locator('.toast', {hasText: 'Deleted Dentist'}).waitFor();
    await holdToast(page);
    await page.clock.runFor(UNDO_MS * 2);
    assert.equal(await toast.count(), 1, 'held, it stays past its 6 s');
    await toast.getByRole('button', {name: 'Undo'}).click();
    await chip(page, '2026-10-07', 'Dentist').waitFor();
    await setpoint.idle();
    assert.equal((await titled('2026-10-07', 'Dentist')).length, 1, 'Undo kept it');

    // Swiped away (dragged past its distance), the delete is sent at once, the clock still stopped.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.keyboard.press('Delete');
    await page.locator('.toast', {hasText: 'Deleted Dentist'}).waitFor();
    const box = (await rested(() => toast.boundingBox()))!;
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 30 + 150, box.y + box.height / 2);
    await page.mouse.up();
    await until('the swiped toast goes', () => toast.count(), count => count === 0);
    await until('the delete is sent', () => titled('2026-10-07', 'Dentist'), list => list.length === 0, AFTER_UNDO);

    // Replaced by a newer toast, the first delete is sent at once and the newer one is held.
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.keyboard.press('Delete');
    await page.locator('.toast', {hasText: 'Deleted Dinner with Sam'}).waitFor();
    await chip(page, '2026-10-09', 'Study group').click();
    await page.keyboard.press('Delete');
    await page.locator('.toast', {hasText: 'Deleted Study group'}).waitFor();
    await until('the replaced delete is sent', () => titled('2026-10-09', 'Dinner with Sam'), list => list.length === 0, AFTER_UNDO);
    await setpoint.idle();
    assert.equal((await titled('2026-10-09', 'Study group')).length, 1, 'the newer delete is still held');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #6: a move, a completion, a clone, a paste and a colour each say what they did, with an Undo that takes it back; a create says nothing and ⌘Z takes it back (#247)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const toast = (text: string) => page.locator('.toast', {hasText: text});
    const undo = async (text: string) => {
      await toast(text).locator('button', {hasText: 'Undo'}).click();
      await toast(text).waitFor({state: 'detached'});
    };
    const named = async (date: string, title: string) => (await items(setpoint, date)).filter(item => item.title === title);

    // A move.
    await drag(page, chip(page, '2026-10-07', 'Dentist'), '2026-10-08');
    await toast('Moved Dentist to Thu, Oct 8').waitFor();
    await settled(setpoint, ['2026-10-07', '2026-10-08']);
    await undo('Moved Dentist to Thu, Oct 8');
    await until('Dentist back on Wednesday', () => named('2026-10-07', 'Dentist'), list => list.length === 1 && !list[0]!.command);

    // A completion, from the card.
    await chip(page, '2026-10-07', 'Pay rent').click();
    await page.locator('.fd').getByRole('button', {name: 'Complete'}).click();
    await toast('Completed Pay rent').waitFor();
    await until('Pay rent done', () => named('2026-10-07', 'Pay rent'), list => list[0]!.done && !list[0]!.command);
    await undo('Completed Pay rent');
    await until('Pay rent open again', () => named('2026-10-07', 'Pay rent'), list => !list[0]!.done && !list[0]!.command);

    // A clone.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').getByRole('button', {name: 'Clone'}).click();
    await toast('Cloned Dentist').waitFor();
    await until('the clone', () => named('2026-10-07', 'Dentist'), list => list.length === 2 && list.every(item => !item.command));
    await undo('Cloned Dentist');
    await until('the clone gone', () => named('2026-10-07', 'Dentist'), list => list.length === 1, 10_000);

    // A paste. Clicked while its card is open, the chip would put the card away (#323), so it starts from none.
    await page.keyboard.press('Escape');
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').getByRole('button', {name: 'Copy'}).click();
    await page.locator('.cell[data-date="2026-10-13"]').click({position: {x: 70, y: 150}});
    await page.keyboard.press('Meta+v');
    await toast('Pasted Dentist on Tue, Oct 13').waitFor();
    await until('the paste', () => named('2026-10-13', 'Dentist'), list => list.length === 1 && !list[0]!.command);
    await undo('Pasted Dentist on Tue, Oct 13');
    await until('the paste gone', () => named('2026-10-13', 'Dentist'), list => list.length === 0, 10_000);

    // A colour.
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.locator('.fd').getByRole('button', {name: 'Colour'}).click();
    await page.locator('.fd-swatches').getByRole('radio', {name: 'good'}).click();
    await toast('Changed the colour of Dinner with Sam').waitFor();
    await until('the colour', () => named('2026-10-09', 'Dinner with Sam'), list => list[0]!.colour === 'good' && !list[0]!.command);
    assert.match(await chip(page, '2026-10-09', 'Dinner with Sam').evaluate(element => (element as HTMLElement).style.getPropertyValue('--c')), /good/);
    await undo('Changed the colour of Dinner with Sam');
    await until('the colour back', () => named('2026-10-09', 'Dinner with Sam'), list => list[0]!.colour !== 'good' && !list[0]!.command);

    // A create, from the editor, says nothing: the item on the grid is the answer (DESIGN #247). ⌘Z still takes it back.
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await page.keyboard.type('Haircut fri 3pm');
    await page.keyboard.press('Meta+Enter');
    await until('the haircut', () => named('2026-10-09', 'Haircut'), list => list.length === 1 && !list[0]!.command);
    await setpoint.idle();
    assert.equal(await page.locator('.toast').count(), 0, 'no toast for a create');
    await page.keyboard.press('Meta+z');
    await until('the haircut gone', () => named('2026-10-09', 'Haircut'), list => list.length === 0, 10_000);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S1 (SV-25, D55): a task\'s card completes it and reopens it; ⌘Z undoes a completion made there', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const rent = async () => (await items(setpoint, '2026-10-07')).find(item => item.title === 'Pay rent')!;
    const card = page.locator('.fd');

    // An event's card has no Complete.
    await chip(page, '2026-10-07', 'Dentist').click();
    await card.getByRole('button', {name: 'Clone'}).waitFor();
    assert.equal(await card.getByRole('button', {name: 'Complete'}).count(), 0);

    // SV-242: the ring beside the title completes it, and its done check reopens it.
    await chip(page, '2026-10-07', 'Pay rent').click();
    await card.locator('.card-h').getByRole('button', {name: 'Complete'}).click();
    await card.locator('.card-h').getByRole('button', {name: 'Reopen'}).waitFor();
    await until('Pay rent done', rent, task => task.done && !task.command);
    await card.getByRole('button', {name: 'Reopen'}).click();
    await until('Pay rent open again', rent, task => !task.done && !task.command);
    await card.getByRole('button', {name: 'Complete'}).waitFor();
    // Its toast replaces the first Completed one, so the next Completed is the next answer's.
    await page.locator('.toast', {hasText: 'Reopened Pay rent'}).waitFor();

    await card.getByRole('button', {name: 'Complete'}).click();
    await until('Pay rent done again', rent, task => task.done && !task.command);
    // ⌘Z undoes it once the browser has the server's answer, as the toast says.
    await page.locator('.toast', {hasText: 'Completed Pay rent'}).waitFor();
    await page.keyboard.press('Meta+z');
    // The Undo waits for the Complete to reach Todoist: two trips through the dev provider (600 ms each).
    await until('the completion undone', rent, task => !task.done && !task.command, 10_000);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-272 (D558–D562): a task\'s subtasks: its chip\'s count, the card\'s checklist checking one with its toast and Undo while the task stays open, and the agenda\'s count opening the checklist, where ↓ on a handle reorders them', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const report = async () => (await items(setpoint, '2026-10-07')).find(item => item.title === 'CS 101 lab report')!;
    const quiet = (task: Awaited<ReturnType<typeof report>>) => !task.command && task.subtasks.every(subtask => !subtask.command);
    const checklist = (task: Awaited<ReturnType<typeof report>>) => task.subtasks.map(subtask => `${subtask.done ? '●' : '○'} ${subtask.title}`);
    const card = page.locator('.fd');

    // The seed's checklist, one of it done; its subtasks have no date, so the day doesn't list them.
    assert.deepEqual(checklist(await report()), ['● Plot the timing data', '○ Write the analysis', '○ Proofread', '○ Submit on the portal']);
    assert.deepEqual((await items(setpoint, '2026-10-07')).filter(item => item.kind === 'task').map(item => item.title), ['CS 101 lab report', 'Pay rent']);
    assert.equal(await chip(page, '2026-10-07', 'CS 101 lab report').locator('.count').textContent(), '1/4');

    // In the card: a subtask's ring completes it alone, with the task's toast and Undo.
    await chip(page, '2026-10-07', 'CS 101 lab report').click();
    await card.locator('.fd-subtasks .fact', {hasText: 'Subtasks 1/4'}).waitFor();
    await card.getByRole('button', {name: 'Complete Proofread'}).click();
    const done = await until('Proofread done', report, task => quiet(task) && task.subtasks[2]!.done);
    assert.equal(done.done, false);
    await card.locator('.fd-subtasks .fact', {hasText: 'Subtasks 2/4'}).waitFor();
    await card.locator('.card-h').getByRole('button', {name: 'Complete'}).waitFor();
    const toast = await holdToast(page);
    await page.locator('.toast', {hasText: 'Completed Proofread'}).waitFor();
    await toast.getByRole('button', {name: 'Undo'}).click();
    // The Undo waits for the Complete to reach Todoist: two trips through the dev provider (600 ms each).
    await until('Proofread open again', report, task => quiet(task) && !task.subtasks[2]!.done, 10_000);
    await card.getByRole('button', {name: 'Close'}).click();
    await card.waitFor({state: 'detached'});

    // In the agenda: the count opens the same checklist under the task's row, and ↓ on a handle
    // moves that subtask a place.
    const row = page.locator('.ag-task', {hasText: 'CS 101 lab report'});
    await row.getByRole('button', {name: '1 of 4 subtasks done'}).click();
    const under = page.locator('.ag-subtasks');
    await under.getByRole('button', {name: 'Move Write the analysis'}).focus();
    await page.keyboard.press('ArrowDown');
    const moved = await until('the subtasks reordered', report, task => quiet(task) && task.subtasks[1]!.title === 'Proofread', 10_000);
    assert.deepEqual(checklist(moved), ['● Plot the timing data', '○ Proofread', '○ Write the analysis', '○ Submit on the portal']);
    await setpoint.idle();
    assert.deepEqual(await under.locator('.subtask:not(.add) .title').allTextContents(), ['Plot the timing data', 'Proofread', 'Write the analysis', 'Submit on the portal']);
    // The count closes it again.
    await row.getByRole('button', {name: '1 of 4 subtasks done'}).click();
    await under.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-273 (D566–D569): subtasks added from the card land in Todoist in the order typed; one opens in the editor, takes a date and shows it, its menu is the same on its day and in the checklist, and its date comes off with a toast and Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const report = async () => (await items(setpoint, '2026-10-07')).find(item => item.title === 'CS 101 lab report')!;
    const quiet = (task: Awaited<ReturnType<typeof report>>) => !task.command && task.subtasks.every(subtask => !subtask.command);
    const card = page.locator('.fd');
    const menu = page.locator('.ctx-menu');

    // D566: the add row, a field in place; Enter adds and keeps it for the next; Esc puts the row back, the card staying.
    await chip(page, '2026-10-07', 'CS 101 lab report').click();
    await card.getByRole('button', {name: 'Add subtask'}).click();
    const field = card.getByRole('textbox', {name: 'New subtask'});
    await field.fill('Print the cover page');
    await field.press('Enter');
    await field.fill('Email the TA');
    await field.press('Enter');
    await field.press('Escape');
    await card.getByRole('button', {name: 'Add subtask'}).waitFor();
    const added = await until('both added', report, task => task.subtasks.length === 6 && quiet(task), 10_000);
    assert.deepEqual(added.subtasks.slice(-2).map(subtask => subtask.title), ['Print the cover page', 'Email the TA']);
    await card.locator('.fd-subtasks .fact', {hasText: 'Subtasks 1/6'}).waitFor();

    // D567: its title opens it in the editor, the card staying; a date saved shows after its title and puts it on its day.
    await card.getByRole('button', {name: 'Edit Print the cover page'}).click();
    const due = page.getByLabel('Due date', {exact: true});
    assert.deepEqual([await due.inputValue(), await due.getAttribute('placeholder')], ['', 'No date']);
    await due.fill('Oct 9');
    await due.press('Enter');
    await page.getByRole('button', {name: 'Save'}).click();
    await until('dated', report, task => quiet(task) && task.subtasks[4]!.due_date === '2026-10-09', 10_000);
    await card.locator('.subtask', {hasText: 'Print the cover page'}).locator('.due', {hasText: 'Fri'}).waitFor();
    await chip(page, '2026-10-09', 'Print the cover page').waitFor();

    // D569: one menu, on its chip and on its checklist row.
    const offered = async (target: Locator) => {
      await target.click({button: 'right'});
      await menu.waitFor();
      const list = await menu.locator('.menu-i').allTextContents();
      await page.keyboard.press('Escape');
      await menu.waitFor({state: 'detached'});
      return list;
    };
    // Its agenda row's (a right-click on a chip at the grid's edge scrolls its day in, which closes a menu).
    await chip(page, '2026-10-09', 'Print the cover page').click();
    assert.deepEqual(await offered(page.locator('.rpane .ag-task', {hasText: 'Print the cover page'})), ['Complete', 'EditE', 'Clone', 'DeleteDel']);
    await chip(page, '2026-10-07', 'CS 101 lab report').click();
    const row = card.locator('.subtask', {hasText: 'Email the TA'});
    assert.deepEqual(await offered(row), ['Complete', 'EditE', 'Clone', 'DeleteDel']);
    // Clone keeps it in the same checklist, at the end.
    await row.click({button: 'right'});
    await menu.getByText('Clone').click();
    const cloned = await until('cloned', report, task => task.subtasks.length === 7 && quiet(task), 10_000);
    assert.deepEqual(cloned.subtasks.map(subtask => subtask.title).slice(-2), ['Email the TA', 'Email the TA']);

    // D568: its date comes off in the editor; it leaves its day, stays in the checklist, and Undo puts it back.
    await card.getByRole('button', {name: 'Edit Print the cover page'}).click();
    await page.getByRole('button', {name: 'Remove due date'}).click();
    const toast = await holdToast(page);
    await page.getByRole('button', {name: 'Save'}).click();
    await page.locator('.toast', {hasText: 'Took the date off Print the cover page'}).waitFor();
    await until('undated', report, task => quiet(task) && task.subtasks[4]!.due_date === null, 10_000);
    await chip(page, '2026-10-09', 'Print the cover page').waitFor({state: 'detached'});
    await toast.getByRole('button', {name: 'Undo'}).click();
    await until('dated again', report, task => quiet(task) && task.subtasks[4]!.due_date === '2026-10-09', AFTER_UNDO);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// A drag held at the grid's edge scrolling it on is edgeScroll's, a table in manipulate.test.ts; the
// scroll it makes is by eye (D416).
test('F6b: an item drags out of the "+3" popover onto another day', async () => {
  const setpoint = await startSetpoint({fixtures: ['busy-saturday'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.locator('.cell[data-date="2026-10-17"] .more').click();
    const popover = page.locator('.daypop');
    await popover.waitFor();
    await drag(page, popover.locator('.ev', {hasText: 'Movie night'}), '2026-10-21', {held: true});
    // The popover closes as the chip lifts.
    await popover.waitFor({state: 'detached'});
    await page.locator('.ev.lift', {hasText: 'Movie night'}).waitFor();
    await page.locator('.drag-tip', {hasText: 'Wed, Oct 21 · 8:00 PM'}).waitFor();
    await page.mouse.up();
    await settled(setpoint, ['2026-10-17', '2026-10-21']);
    assert.deepEqual(await titles(setpoint, '2026-10-21'), ['Gym 7:00 AM', 'Movie night 8:00 PM']);
    assert.ok(!(await titles(setpoint, '2026-10-17')).includes('Movie night 8:00 PM'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
