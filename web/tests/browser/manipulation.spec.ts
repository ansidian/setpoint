// Direct manipulation on the month grid (DESIGN.md › Drag, Recurring events and Health and states;
// boards 15, 15b and 19b): the boards against their approved screenshots, then the flows: a drop with each
// scope, a single event and a task moved at once (pending at .5 with a spinner until the provider
// confirms), a change that fails in place with Try again and Move back, Clone, Copy and Paste,
// Colour, Delete (and a recurring one asking which), multi-select, and the drag, the drop prompt and
// the failed card under the 1.25 wide-screen zoom (D23). The dev provider confirms after 600 ms and
// refuses moving Dinner with Sam to Saturday with Google's 409 (board 19b, by rule).
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {UNDO_MS} from '../../src/app/toast.ts';
import {cleanUp, matchGolden, rested, startSetpoint, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

const GAP = 8;
// A delete is sent once its Undo has gone; then the server and the dev provider (600 ms) have it.
const AFTER_UNDO = UNDO_MS + 10_000;

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
    // Lets the drag's ghost settle before the screenshot.
    await page.waitForTimeout(200);
    await matchGolden(page, '15-drag-in-progress', 'grid');

    // Board 15b: let go; the prompt sits beside the dropped chip, This event chosen.
    await page.mouse.up();
    const prompt = page.locator('.scope-card');
    await prompt.waitFor();
    await page.locator('.ag-item', {hasText: 'Moving to Thu, Oct 8'}).waitFor();
    await page.locator('.cell[data-date="2026-10-07"] .ev.ghost.faded', {hasText: 'Gym'}).waitFor();
    assert.equal(await prompt.getAttribute('data-side'), 'left');
    const dropped = (await rested(() => page.locator('.cell[data-date="2026-10-08"] .ev.sel', {hasText: 'Gym'}).boundingBox()))!;
    const box = (await rested(() => prompt.boundingBox()))!;
    assert.equal(Math.round(dropped.x - (box.x + box.width)), GAP);
    await page.mouse.move(700, 28);
    // Lets a hover fill the move left fade out (120 ms) before the screenshot.
    await page.waitForTimeout(200);
    await matchGolden(page, '15b-dropped-this-following-or-all', 'grid');

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

test('an event and a task move at once, waiting at .5 with a spinner until the provider confirms', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await drag(page, chip(page, '2026-10-07', 'Dentist'), '2026-10-08');
    // No prompt for a single event: pending where it landed, then confirmed.
    const moved = chip(page, '2026-10-08', 'Dentist');
    // The spinner shows only after a second (DESIGN.md #54), and the dev provider confirms sooner.
    await page.locator('.cell[data-date="2026-10-08"] .ev.pending .spin').waitFor({state: 'attached'});
    // Read while it's pending: the dev provider confirms within the moment a rest would wait.
    assert.equal(await moved.evaluate(element => getComputedStyle(element).opacity), '0.5');
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
    assert.equal(await card.getAttribute('data-side'), 'below');
    // The card's × is 16 px in a 26 px button, as every card's (#123).
    assert.deepEqual(await card.getByRole('button', {name: 'Close'}).evaluate(button => [button.getBoundingClientRect().width, button.querySelector('.icon')!.getAttribute('width')]), [26, '16']);
    const failed = (await rested(() => chip(page, '2026-10-10', 'Dinner with Sam').boundingBox()))!;
    assert.equal(Math.round((await rested(() => card.boundingBox()))!.y - (failed.y + failed.height)), GAP);
    await page.mouse.move(700, 28);
    // Lets a hover fill the move left fade out (120 ms) before the screenshot.
    await page.waitForTimeout(200);
    await matchGolden(page, '19b-states-a-change-that-failed', 'main');

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

test('Clone, Copy and Paste (Copy and ⌘C say what they took, S10), Colour and Delete from the card and the keys; multi-select', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const dentists = async (date: string) => (await items(setpoint, date)).filter(item => item.title === 'Dentist');

    // Clone: another Dentist on the same day.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').getByRole('button', {name: 'Clone'}).click();
    await until('the clone', () => dentists('2026-10-07'), list => list.length === 2 && list.every(item => !item.command));

    // Copy, then ⌘V on Tue, Oct 13: the copy keeps its time.
    await page.locator('.fd').getByRole('button', {name: 'Copy'}).click();
    await page.locator('.toast', {hasText: 'Copied Dentist, ⌘V pastes on the selected day'}).waitFor();
    // A toast with no button keeps the same room on both sides.
    assert.deepEqual(await page.locator('.toast').evaluate(toast => [getComputedStyle(toast).paddingLeft, getComputedStyle(toast).paddingRight]), ['16px', '16px']);
    await page.locator('.cell[data-date="2026-10-13"]').click({position: {x: 70, y: 150}});
    await page.keyboard.press('Meta+v');
    await until('the paste', () => dentists('2026-10-13'), list => list.length === 1 && !list[0]!.command);
    assert.deepEqual(await titles(setpoint, '2026-10-13').then(list => list.filter(title => title.startsWith('Dentist'))), ['Dentist 2:30 PM']);

    // Colour: Dinner with Sam takes `good`, its own.
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.locator('.fd').getByRole('button', {name: 'Colour'}).click();
    await page.locator('.fd-swatches').getByRole('radio', {name: 'good'}).click();
    await until('the colour', async () => (await items(setpoint, '2026-10-09')).find(item => item.title === 'Dinner with Sam')!, item => item.colour === 'good' && !item.command);
    assert.match(await chip(page, '2026-10-09', 'Dinner with Sam').evaluate(element => (element as HTMLElement).style.getPropertyValue('--c')), /good/);

    // Delete the pasted Dentist with the key.
    await chip(page, '2026-10-13', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Delete');
    await until('the delete, once its Undo has gone', () => dentists('2026-10-13'), list => list.length === 0, AFTER_UNDO);

    // Multi-select: ⌘ alone puts the card away and keeps Dinner selected; ⌘-click a second, no card;
    // ⌘C and ⌘V on Tue, Oct 20 keeps their distance; Delete takes both copies.
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Meta');
    await page.locator('.fd').waitFor({state: 'detached'});
    await page.locator('.cell[data-date="2026-10-09"] .ev.sel', {hasText: 'Dinner with Sam'}).waitFor();
    await chip(page, '2026-10-15', 'Career fair').click({modifiers: ['Meta']});
    await page.locator('.cell[data-date="2026-10-15"] .ev.sel', {hasText: 'Career fair'}).waitFor();
    await page.locator('.cell[data-date="2026-10-09"] .ev.sel', {hasText: 'Dinner with Sam'}).waitFor();
    await page.locator('.fd').waitFor({state: 'detached'});
    await page.keyboard.press('Meta+c');
    await page.locator('.toast', {hasText: 'Copied 2 items, ⌘V pastes on the selected day'}).waitFor();
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
    await until('both copies gone', async () => [...await items(setpoint, '2026-10-20'), ...await items(setpoint, '2026-10-26')].filter(item => !item.recurring), list => list.length === 0, AFTER_UNDO);

    // Deleting one Gym asks which; This event takes Friday's alone.
    await chip(page, '2026-10-16', 'Gym').click();
    await page.locator('.fd').getByRole('button', {name: 'Delete'}).click();
    await page.locator('.scope-card', {hasText: 'Delete recurring event'}).waitFor();
    await page.keyboard.press('Enter');
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
    await openCalendar(page, setpoint.base);
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
    await until('the delete lands', async () => (await titles(setpoint, '2026-10-09')).filter(title => title.startsWith('Dinner with Sam')), list => list.length === 0, AFTER_UNDO);
    await until('the completion lands', async () => (await items(setpoint, '2026-10-07')).find(item => item.title === 'Pay rent')!, task => task.done && !task.command);
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
    await openCalendar(page, setpoint.base);
    const dentists = async () => (await items(setpoint, '2026-10-07')).filter(item => item.title === 'Dentist');

    // Backspace on Dentist: off the grid, the toast says so, and the address leaves the item.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Backspace');
    await page.locator('.toast', {hasText: 'Deleted Dentist'}).waitFor();
    // It folds away first (polish audit calflows-11).
    await until('off the grid', () => chip(page, '2026-10-07', 'Dentist').count(), count => count === 0);
    assert.doesNotMatch(new URL(page.url()).pathname, /\/item\//);
    // Undo brings it back, and the server never hears of it.
    await page.locator('.toast').getByRole('button', {name: 'Undo'}).click();
    await chip(page, '2026-10-07', 'Dentist').waitFor();
    // Nothing happens to wait for: past the 6 s Undo, the delete is never sent.
    await page.waitForTimeout(UNDO_MS + 1000);
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
    assert.equal((await dentists()).length, 1, 'held while Undo is offered');
    await until('the delete is sent', dentists, list => list.length === 0, AFTER_UNDO);
    assert.equal(await chip(page, '2026-10-07', 'Dentist').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #6: a move, a completion, a clone, a paste, a colour and a create each say what they did, with an Undo that takes it back', async () => {
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

    // A paste.
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
    await undo('Changed the colour of Dinner with Sam');
    await until('the colour back', () => named('2026-10-09', 'Dinner with Sam'), list => list[0]!.colour !== 'good' && !list[0]!.command);

    // A create, from the editor: the toast says where it went.
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await page.keyboard.type('Haircut fri 3pm');
    await page.keyboard.press('Meta+Enter');
    await toast('Created Haircut, Fri, Oct 9').waitFor();
    await until('the haircut', () => named('2026-10-09', 'Haircut'), list => list.length === 1 && !list[0]!.command);
    await undo('Created Haircut, Fri, Oct 9');
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

    await chip(page, '2026-10-07', 'Pay rent').click();
    await card.getByRole('button', {name: 'Complete'}).click();
    await card.getByRole('button', {name: 'Reopen'}).waitFor();
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

test('F6b: a drag held at the grid\'s bottom edge scrolls it on, and at its top back; the drop lands on the day under the pointer', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const scroller = page.locator('.cal-scroll');
    const grid = (await rested(() => scroller.boundingBox()))!;
    const scrollTop = () => scroller.evaluate(element => element.scrollTop);
    // Off the edge, a tick already under way can still land: at rest once two frames don't move it.
    const atRest = () => until('the grid at rest', () => scroller.evaluate(element => new Promise<boolean>(done => {
      const top = element.scrollTop;
      requestAnimationFrame(() => requestAnimationFrame(() => done(element.scrollTop === top)));
    })), still => still);
    const start = await scrollTop();
    const dentist = (await rested(() => chip(page, '2026-10-07', 'Dentist').boundingBox()))!;
    await page.mouse.move(dentist.x + 20, dentist.y + dentist.height / 2);
    await page.mouse.down();
    await page.mouse.move(dentist.x + 60, dentist.y + 40, {steps: 3});
    // Held at the bottom edge: the grid scrolls on by itself.
    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height - 4, {steps: 4});
    await until('the grid scrolls down', scrollTop, top => top > start + 3 * 176, 6000);
    // Held in the middle: it stops.
    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height / 2, {steps: 2});
    await atRest();
    const stopped = await scrollTop();
    // Nothing happens to wait for: the grid stays where it stopped.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await scrollTop(), stopped);
    // At the top edge: back up a little.
    await page.mouse.move(grid.x + grid.width / 2, grid.y + 6, {steps: 2});
    await until('the grid scrolls up', scrollTop, top => top < stopped - 176, 6000);
    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height / 2, {steps: 2});
    await atRest();
    // Let go on an empty November day in full view: the one the tooltip names. How far the top edge
    // took it back depends on how long the pointer was there, so the wheel brings November back into
    // view if it went past.
    const november = () => scroller.evaluate(element => {
      const view = element.getBoundingClientRect();
      const cells = [...element.querySelectorAll<HTMLElement>('.cal-grid .cell')].filter(cell => {
        const box = cell.getBoundingClientRect();
        return cell.dataset.date! > '2026-11-01' && !cell.querySelector('.ev, .tk') && box.top >= view.top && box.bottom <= view.bottom;
      });
      return cells[0]?.dataset.date ?? null;
    });
    const date = (await until('an empty November day in view', async () => {
      const found = await november();
      if (!found) await page.mouse.wheel(0, 176);
      return found;
    }, found => found !== null))!;
    await atRest();
    const box = (await rested(() => page.locator(`.cell[data-date="${date}"]`).boundingBox()))!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 3});
    await page.locator('.drag-tip', {hasText: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'})}).waitFor();
    await page.mouse.up();
    await settled(setpoint, [date]);
    assert.ok(date > '2026-10-31', `dropped on ${date}, past October`);
    assert.deepEqual(await titles(setpoint, date), ['Dentist 2:30 PM']);
    assert.deepEqual((await titles(setpoint, '2026-10-07')).filter(title => title.startsWith('Dentist')), []);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

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

test('under the 1.25 wide-screen zoom: the drag\'s tooltip, the drop prompt and the failed card sit by their items (D23)', async () => {
  const setpoint = await startSetpoint({fixtures: ['failed-change'], clock: 'frozen'});
  try {
    const page = await setpoint.page({width: 2400, height: 1300});
    await openCalendar(page, setpoint.base);
    const zoomGap = GAP * 1.25;
    // The failed card: below its chip, 8 CSS px off it.
    const card = page.locator('.failed-card');
    await card.waitFor();
    const failed = (await rested(() => chip(page, '2026-10-10', 'Dinner with Sam').boundingBox()))!;
    assert.ok(Math.abs((await rested(() => card.boundingBox()))!.y - (failed.y + failed.height) - zoomGap) <= 1.5, 'the failed card is 8 px under its chip');
    await card.getByRole('button', {name: 'Close'}).click();

    // The drag: the tooltip 18, 30 off the lifted chip, which keeps the press's place under the pointer.
    await drag(page, chip(page, '2026-10-07', 'Gym'), '2026-10-08', {held: true});
    const lifted = (await rested(() => page.locator('.ev.lift').boundingBox()))!;
    const tip = (await rested(() => page.locator('.drag-tip').boundingBox()))!;
    // The lift's tilt and scale grow its box a little around its centre.
    assert.ok(Math.abs(tip.y - lifted.y - 30 * 1.25) < 6, `the tooltip sits under the chip: ${tip.y - lifted.y}`);
    await page.mouse.up();
    // The prompt: right of the dropped chip, 8 CSS px off it.
    const prompt = page.locator('.scope-card');
    await prompt.waitFor();
    const dropped = (await rested(() => page.locator('.cell[data-date="2026-10-08"] .ev.sel', {hasText: 'Gym'}).boundingBox()))!;
    const box = (await rested(() => prompt.boundingBox()))!;
    assert.ok(Math.abs(box.x - (dropped.x + dropped.width) - zoomGap) <= 1.5, `the prompt is 8 px right of the chip: ${box.x - (dropped.x + dropped.width)}`);
    assert.ok(Math.abs(box.y + box.height / 2 - (dropped.y + dropped.height / 2)) <= 1.5, 'centred on it');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

