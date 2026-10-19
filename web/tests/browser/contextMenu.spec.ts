// The right-click menu (DESIGN.md › Decided while building #248): an email's row offers its actions at
// the pointer, moving the cursor there and opening nothing; Mark read reads it in place with Undo,
// its keys run its items, Add as task opens the email with the card, and ⌥ or an open popover leave
// the browser's own. On Calendar an event's menu selects it without the floating detail, Colour's
// swatches take the menu's place, and empty grid offers New event here (at a week slot's time) and
// Paste here on the day clicked. News's rows, the sidebar and the Today block have theirs.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {ItemsOut, MailCountsOut, MessageOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const menu = (page: Page) => page.locator('.ctx-menu');
const items = (page: Page) => menu(page).locator('.menu-i').allTextContents();
const item = (page: Page, label: string) => menu(page).locator('.menu-i', {hasText: label});
const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');
const northwind = (page: Page) => page.locator('.list .row[title^="Interview availability"]').first();

/** Right-clicks `target` at `position` within it, and waits for the menu to open and take the keys. */
async function rightClick(target: Locator, position?: {x: number; y: number}) {
  await target.click({button: 'right', position});
  const page = target.page();
  await menu(page).waitFor();
  await until('the menu has the keys', () => page.evaluate(() => document.activeElement?.classList.contains('ctx-menu') ?? false), has => has);
}

async function openInbox(page: Page, base: string) {
  await page.goto(`${base}/inbox`);
  await northwind(page).waitFor();
}

test('an email\'s right-click: its actions at the pointer, the cursor there, nothing opened or read', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const row = northwind(page);
    const box = (await rested(() => row.boundingBox()))!;
    await rightClick(row, {x: 420, y: 12});
    assert.deepEqual(await items(page), [
      'Open↵', 'DoneH', 'TrashE', 'PinP', 'Open in GmailO', 'Add to calendar', 'Add as task', 'Ask about this email', 'Mark read', 'Copy sender address',
    ]);
    assert.equal(await menu(page).locator('.menu-i.cur').textContent(), 'Open↵', 'the cursor starts on the first item');
    // Its corner is at the pointer.
    const at = (await rested(() => menu(page).boundingBox()))!;
    assert.ok(Math.abs(at.x - (box.x + 420)) <= 1 && Math.abs(at.y - (box.y + 12)) <= 1, `the menu at ${at.x}, ${at.y}`);
    assert.match((await row.getAttribute('class'))!, /\bcur\b/, 'the cursor moved to the row');
    assert.match((await row.getAttribute('class'))!, /\bunread\b/, 'still unread');
    assert.equal(await page.locator('.pane').count(), 0, 'nothing opened');

    // Esc closes it alone.
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});
    assert.match((await row.getAttribute('class'))!, /\bcur\b/, 'Esc closed only the menu');

    // A read row offers Mark unread in Mark read's place; a code row, Copy code.
    const code = page.locator('.list .row', {hasText: '482'}).first();
    await rightClick(code);
    assert.ok((await items(page)).includes('Copy code'));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    await item(page, 'Copy code').click();
    await page.locator('.toast', {hasText: 'Copied 482913'}).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '482913');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an email\'s menu: Mark read in place with Undo, P by its key, Add as task opens it with the card; ⌥ and a popover keep the browser\'s', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const row = northwind(page);
    const id = Number(await row.getAttribute('data-id'));
    const before = await counts(setpoint);

    // Mark read: read where it is, New keeping it, the attention pill as it was; Undo or ⌘Z takes it back.
    await rightClick(row);
    await item(page, 'Mark read').click();
    await page.locator('.toast', {hasText: 'Marked as read'}).waitFor();
    await until('read', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => !message.unread);
    await until('its class', () => row.getAttribute('class'), classes => !/\bunread\b/.test(classes!));
    assert.ok(await row.isVisible(), 'it stays where it is, in New');
    const after = await until('the counts', () => counts(setpoint), counts => counts.unread === before.unread - 1);
    assert.equal(after.attention, before.attention, 'the pill doesn\'t move');
    await page.keyboard.press('Meta+z');
    await until('unread again', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => message.unread);

    // An item's key runs it: P pins.
    await rightClick(row);
    await page.keyboard.press('p');
    await menu(page).waitFor({state: 'detached'});
    await until('pinned', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => message.pinned);

    // ⌥ keeps the browser's menu.
    await row.click({button: 'right', modifiers: ['Alt']});
    // Nothing should open: a pause for it to have done so.
    await page.waitForTimeout(150);
    await setpoint.idle();
    assert.equal(await menu(page).count(), 0);

    // A right-click while the menu is open only closes it.
    await rightClick(row);
    await page.locator('.list .row', {hasText: '482'}).first().click({button: 'right'});
    await menu(page).waitFor({state: 'detached'});
    // Nothing should open: a pause for it to have done so.
    await page.waitForTimeout(150);
    await setpoint.idle();
    assert.equal(await menu(page).count(), 0, 'it opened nothing');

    // Add as task opens the email with its proposal card.
    await rightClick(row);
    await item(page, 'Add as task').click();
    await page.waitForURL(`**/inbox/${id}`);
    await page.locator('.pane .card.prop').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the sidebar and the Today block: Mark all as read on Inbox, an item\'s card actions on its line', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    await rightClick(page.locator('aside.sb .nav', {hasText: 'Inbox'}));
    assert.deepEqual(await items(page), ['Mark all as read⇧I']);
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});
    await rightClick(page.locator('.today-row', {hasText: 'Pay rent'}));
    assert.deepEqual(await items(page), ['EditE', 'Complete', 'Open in Calendar', 'Delete']);
    assert.equal(await page.locator('.fd.today-card').count(), 0, 'no card');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

const chip = (page: Page, date: string, title: string) => page.locator(`.cal-month .cell[data-date="${date}"] .ev`, {hasText: title});
const next = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const titlesOn = async (setpoint: Setpoint, date: string) => (await setpoint.api<ItemsOut>('GET', `/items?from=${date}&to=${next(date)}`)).items.map(one => one.title);

test('a calendar item\'s right-click selects it without the card; Colour, Copy and Paste here; a week slot\'s New event here', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    const dentist = chip(page, '2026-10-07', 'Dentist');
    await dentist.waitFor();
    await rightClick(dentist);
    assert.deepEqual(await items(page), ['EditE', 'Clone', 'Copy⌘C', 'Colour', 'DeleteDel']);
    await until('selected', () => dentist.getAttribute('class'), classes => /\bsel\b/.test(classes!));
    assert.equal(await page.locator('.fd').count(), 0, 'no floating detail');

    // Colour's swatches take the menu's place, and a pick colours it.
    await item(page, 'Colour').click();
    await menu(page).locator('.fd-swatches').getByRole('radio', {name: 'good'}).click();
    await page.locator('.toast', {hasText: 'Changed the colour of Dentist'}).waitFor();
    await menu(page).waitFor({state: 'detached'});

    // Copy, then Paste here on another day: there, not on the selected day.
    await rightClick(dentist);
    await item(page, 'Copy').click();
    await page.locator('.toast', {hasText: 'Copied Dentist'}).waitFor();
    const empty = page.locator('.cal-month .cell[data-date="2026-10-14"]');
    const cell = (await rested(() => empty.boundingBox()))!;
    await rightClick(empty, {x: cell.width / 2, y: cell.height - 12});
    assert.deepEqual(await items(page), ['New event hereC', 'New task hereD', 'Paste here⌘V']);
    await item(page, 'Paste here').click();
    await page.locator('.toast', {hasText: 'Pasted Dentist on Wed, Oct 14'}).waitFor();
    await chip(page, '2026-10-14', 'Dentist').waitFor();
    await until('pasted there', () => titlesOn(setpoint, '2026-10-14'), titles => titles.includes('Dentist'));

    // On the week (Oct 14's, the day Paste here selected), empty hours: New event here at the step
    // under the pointer, an hour long.
    await page.keyboard.press('w');
    const column = page.locator('.wk-col[data-date="2026-10-17"]');
    await page.locator('.wk-col[data-date="2026-10-14"] .wb', {hasText: 'Dentist'}).waitFor();
    const hours = (await rested(() => column.boundingBox()))!;
    await rightClick(column, {x: hours.width / 2, y: 11 * 44 + 6});
    await item(page, 'New event here').click();
    await page.locator('.editor').waitFor();
    await until('the draft at 11', () => page.locator('.wk-col[data-date="2026-10-17"] .wb.ghost').textContent(), text => /11:00 AM – 12:00 PM/.test(text ?? ''));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a story\'s right-click: Open, Open at its outlet, Copy link, the cursor there and nothing opened', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const row = page.locator('.nw-list .nw-row').first();
    await row.waitFor();
    await rightClick(row);
    const offered = await items(page);
    assert.equal(offered.length, 3);
    assert.equal(offered[0], 'Open↵');
    assert.match(offered[1]!, /^Open at .+O$/);
    assert.equal(offered[2], 'Copy link');
    assert.match((await row.getAttribute('class'))!, /\bcur\b/);
    assert.equal(await page.locator('.pane').count(), 0, 'nothing opened');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    await item(page, 'Copy link').click();
    await page.locator('.toast', {hasText: 'link'}).waitFor();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^https?:\/\//);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
