// Selecting several emails (DESIGN.md #249): ⌘-click and ⇧-click select rows without opening or
// reading them, and the reading pane shows the selection, against its approved screenshot; the first
// ⌘-click takes the open email, and a plain click ends it and opens. A selected row's right-click offers
// the selection's actions and another row's its own; E trashes every one with one toast, and ⌘Z
// brings every one back; Mark read, Pin and Done act on all of it.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {AllOut, MessageOut, MessageRowOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, matchGolden, startSetpoint, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const row = (page: Page, id: number) => page.locator(`.list .row[data-id="${id}"]`).first();
const pane = (page: Page) => page.locator('section.pane.selection');
const reader = (page: Page) => page.locator('section.pane[aria-label="Reading pane"]');
const listed = (page: Page) => pane(page).locator('.sel-list > li[data-id]').evaluateAll(items => items.map(item => Number((item as HTMLElement).dataset.id)));
const selectedRows = (page: Page) => page.locator('.list .row.sel').evaluateAll(rows => [...new Set(rows.map(one => Number((one as HTMLElement).dataset.id)))]);
const menu = (page: Page) => page.locator('.ctx-menu');
const items = (page: Page) => menu(page).locator('.menu-i').allTextContents();
const message = (setpoint: Setpoint, id: number) => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`);
const allRows = async (setpoint: Setpoint) => (await setpoint.api<AllOut>('GET', '/mail/all?limit=500')).days.flatMap(day => day.rows);
const inAll = async (setpoint: Setpoint, id: number) => (await allRows(setpoint)).some(one => one.id === id);

/** The list's emails as the page shows them, top to bottom, each once. */
const onScreen = (page: Page) => page.locator('.list .row[data-id]').evaluateAll(rows => [...new Set(rows.map(one => Number((one as HTMLElement).dataset.id)))]);

async function openInbox(page: Page, base: string) {
  await page.goto(`${base}/inbox`);
  await page.locator('.list .row[data-id]').first().waitFor();
}

/** Right-clicks `target`, and waits for the menu to open and take the keys. */
async function rightClick(target: Locator) {
  await target.click({button: 'right'});
  const page = target.page();
  await menu(page).waitFor();
  await until('the menu has the keys', () => page.evaluate(() => document.activeElement?.classList.contains('ctx-menu') ?? false), has => has);
}

/**
 * Four emails next to each other in a day, none of them in New or Attention: three for a selection,
 * and the day's next one after them.
 */
async function fourInADay(page: Page, setpoint: Setpoint): Promise<MessageRowOut[]> {
  const shown = await onScreen(page);
  const rows = new Map((await allRows(setpoint)).map(one => [one.id, one]));
  const days = await page.locator('.list .row[data-key^="all:"]').evaluateAll(all => all.map(one => Number((one as HTMLElement).dataset.id)));
  const at = days.findIndex((id, index) => index + 3 < days.length && shown.indexOf(days[index + 3]!) === shown.indexOf(id) + 3);
  assert.ok(at >= 0, 'four emails in a row in a day');
  return days.slice(at, at + 4).map(id => rows.get(id)!);
}

test('⌘-click and ⇧-click select without opening or reading; the pane lists them; × and Esc take them out', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.addInitScript(() => localStorage.setItem('setpoint.theme', 'night'));
    await openInbox(page, setpoint.base);
    const [first, second, third] = await fourInADay(page, setpoint);

    // ⌘-click: selected, the pane up, nothing opened or read.
    await row(page, first!.id).click({modifiers: ['ControlOrMeta']});
    await pane(page).waitFor();
    assert.equal(await pane(page).locator('.rd-subj').textContent(), '1 email selected');
    assert.equal(await reader(page).count(), 0, 'nothing opened');
    assert.equal((await message(setpoint, first!.id)).unread, first!.unread, 'nothing read');
    assert.ok(!new URL(page.url()).searchParams.has('open') && !page.url().includes('/open/'), 'the address opens nothing');

    // ⇧-click: every email from the last one clicked to this one, in the list's order.
    await row(page, third!.id).click({modifiers: ['Shift']});
    await until('three selected', () => listed(page), ids => ids.length === 3);
    assert.deepEqual(await listed(page), [first!.id, second!.id, third!.id]);
    assert.deepEqual(await selectedRows(page), [first!.id, second!.id, third!.id]);
    assert.equal(await pane(page).locator('.rd-subj').textContent(), '3 emails selected');
    assert.equal(await page.evaluate(() => getSelection()?.toString() ?? ''), '', 'the ⇧-click selected no text');
    // A selected row is drawn as the open one is: `sub3` and the accent bar.
    await until('drawn selected', () => row(page, second!.id).evaluate(element => getComputedStyle(element).boxShadow), shadow => /2px 0px 0px 0px inset/.test(shadow));
    await matchGolden(page, 'selected-emails', 'main');

    // × takes one out; ⌘-click on a selected row does too.
    await pane(page).locator(`li[data-id="${second!.id}"] .sel-drop`).click();
    await until('two listed', () => listed(page), ids => ids.length === 2);
    await row(page, third!.id).click({modifiers: ['ControlOrMeta']});
    await until('one listed', () => listed(page), ids => ids.length === 1);
    assert.deepEqual(await selectedRows(page), [first!.id]);

    // Esc ends it.
    await page.keyboard.press('Escape');
    await pane(page).waitFor({state: 'detached'});
    assert.deepEqual(await selectedRows(page), []);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the first ⌘-click takes the open email, its reader giving way; a plain click ends the selection and opens', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const [first, second, third] = await fourInADay(page, setpoint);

    await row(page, first!.id).click();
    await reader(page).waitFor();
    await row(page, second!.id).click({modifiers: ['ControlOrMeta']});
    await pane(page).waitFor();
    assert.deepEqual(await listed(page), [first!.id, second!.id]);
    await reader(page).waitFor({state: 'detached'});
    assert.equal((await message(setpoint, second!.id)).unread, second!.unread, 'the one ⌘-clicked isn\'t read');

    // A plain click opens that email, and the selection ends.
    await row(page, third!.id).click();
    await reader(page).waitFor();
    await pane(page).waitFor({state: 'detached'});
    assert.deepEqual(await selectedRows(page), []);
    assert.match((await row(page, third!.id).getAttribute('class'))!, /\bopen\b/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a selected row\'s right-click offers the selection\'s actions; E trashes every one with one toast, and ⌘Z brings every one back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const [next, ...picked] = (await fourInADay(page, setpoint)).reverse();
    picked.reverse();
    const ids = picked.map(one => one.id);
    for (const id of ids) await row(page, id).click({modifiers: ['ControlOrMeta']});
    await until('three selected', () => listed(page), shown => shown.length === 3);

    // On a selected row: the selection's, nothing that's one email's only.
    await rightClick(row(page, ids[1]!));
    const offered = await items(page);
    assert.deepEqual(offered.filter(label => !/^Mark (un)?read/.test(label)), ['TrashE', picked.every(one => one.pinned) ? 'UnpinP' : 'PinP', 'Clear selectionEsc']);
    assert.equal(offered.length, 4, 'and Mark read or Mark unread');
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});

    // On a row outside it: that row's own, and the selection stays.
    await rightClick(row(page, next!.id));
    assert.equal((await items(page))[0], 'Open↵');
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});
    assert.deepEqual(await listed(page), ids, 'the selection kept');

    // E: every one leaves at once, one toast, the selection ended.
    await page.keyboard.press('e');
    await page.locator('.toast', {hasText: 'Moved 3 to Trash'}).waitFor();
    await pane(page).waitFor({state: 'detached'});
    for (const id of ids) await row(page, id).waitFor({state: 'detached'});
    for (const id of ids) await until(`${id} trashed`, () => inAll(setpoint, id), present => !present);

    // ⌘Z: every one back, on the server and in the list.
    await page.keyboard.press('ControlOrMeta+z');
    for (const id of ids) await until(`${id} back`, () => inAll(setpoint, id), present => present, 10_000);
    for (const id of ids) await row(page, id).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark read, Pin and Done act on the whole selection: Pin keeps it, Done counts only what can be Done and ends it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const shown = new Set(await onScreen(page));
    const rows = (await allRows(setpoint)).filter(one => shown.has(one.id) && !one.pinned);
    // Two unread Attention emails not yet Done, and one email that can't be Done.
    const attention = rows.filter(one => one.lane === 'attention' && !one.done && one.unread).slice(0, 2);
    const plain = rows.find(one => one.lane !== 'attention')!;
    assert.equal(attention.length, 2, 'two unread Attention emails');
    const ids = [...attention.map(one => one.id), plain.id];
    for (const id of ids) await row(page, id).click({modifiers: ['ControlOrMeta']});
    await until('three selected', () => listed(page), listedIds => listedIds.length === 3);
    const tools = () => pane(page).locator('.rd-tools .tool').allTextContents();
    assert.deepEqual(await tools(), ['Done 2H', 'TrashE', 'PinP', 'Mark read', 'ClearEsc']);

    // Mark read: the unread ones, one toast; the selection stays.
    await pane(page).locator('.tool', {hasText: 'Mark read'}).click();
    await page.locator('.toast', {hasText: /Marked \d as read/}).waitFor();
    for (const id of attention.map(one => one.id)) await until(`${id} read`, () => message(setpoint, id), found => !found.unread);
    assert.equal(await pane(page).count(), 1, 'still selected');

    // P pins every one, and the selection stays, its tool now Unpin.
    await page.keyboard.press('p');
    for (const id of ids) await until(`${id} pinned`, () => message(setpoint, id), found => found.pinned);
    await pane(page).locator('.tool', {hasText: 'Unpin'}).waitFor();

    // H: the two that can be Done, one toast, the selection ended.
    await page.keyboard.press('h');
    await page.locator('.toast', {hasText: 'Marked 2 Done'}).waitFor();
    await pane(page).waitFor({state: 'detached'});
    for (const one of attention) await until(`${one.id} Done`, () => message(setpoint, one.id), found => found.done);
    assert.equal((await message(setpoint, plain.id)).done, false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
