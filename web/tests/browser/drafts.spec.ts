// Drafts' row menu and selection, at the design target on a fresh seed each with drafts made for the
// check. A row's right-click has Open (docked, as a click), Pop out (a window, the page as it was)
// and Discard with Undo; a draft being sent has no Discard. ⌘-click and ⇧-click select drafts: the
// docked composer gives way to the selection's pane, a window stays up, Discard counts what can go
// and one toast's Undo brings every one back, and Enter opens every selected draft in a window. ⌘A
// in the docked composer selects its words; from the list, every draft.
import type {DraftOut, DraftsOut, Recipient} from '@setpoint/shared';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, holdToast, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const SAM: Recipient = {name: 'Sam Lee', address: 'sam@example.org'};
const JUNE: Recipient = {name: 'June Park', address: 'june@example.org'};
const RAVI: Recipient = {name: 'Ravi Menon', address: 'ravi@example.org'};

const drafts = async (setpoint: Setpoint) => (await setpoint.api<DraftsOut>('GET', '/mail/drafts')).drafts;
const subjects = async (setpoint: Setpoint) => (await drafts(setpoint)).map(draft => draft.subject);
const row = (page: Page, subject: string) => page.locator('.drafts-list .row', {hasText: subject});
const selection = (page: Page) => page.locator('section.pane.selection');
const lines = (page: Page) => selection(page).locator('.sel-list > li[data-id]').evaluateAll(found => found.map(one => `${one.querySelector('.from')?.textContent} | ${one.querySelector('.subj')?.textContent}`));
const tools = (page: Page) => selection(page).locator('.rd-tools .tool').allTextContents();
const menu = (page: Page) => page.locator('.ctx-menu');
const items = (page: Page) => menu(page).locator('.menu-i').allTextContents();
// The windows up, by their subjects: a new message's title bar reads New message.
const windows = (page: Page) => page.locator('.cmp-window').evaluateAll(found => found.map(one => one.querySelector<HTMLInputElement>('input[aria-label="Subject"]')?.value ?? ''));
const docked = (page: Page) => page.locator('section.pane[aria-label="Draft"] .composer');
const pathOf = (page: Page) => new URL(page.url()).pathname;

/** New messages with these subjects, made oldest first, so Drafts lists them in reverse. */
async function makeDrafts(setpoint: Setpoint, made: {subject: string; to: Recipient[]}[]): Promise<number[]> {
  const ids: number[] = [];
  for (const {subject, to} of made) {
    const draft = await setpoint.api<DraftOut>('POST', '/mail/drafts', {kind: 'new'});
    await setpoint.api('PATCH', `/mail/drafts/${draft.id}`, {to, subject, body: [{type: 'paragraph', runs: [{text: `About ${subject}.`, marks: [], href: null}]}]});
    ids.push(draft.id);
  }
  return ids;
}

/** The draft as being sent: the server holds changes to it off, and nothing here sends it. */
function markSending(setpoint: Setpoint, id: number) {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.prepare('UPDATE drafts SET send_state = \'sending\' WHERE id = ?').run(id);
  } finally {
    database.close();
  }
}

async function openDrafts(setpoint: Setpoint, count: number): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}/drafts`);
  await page.locator('.drafts-list .row').nth(count - 1).waitFor();
  return page;
}

/** Right-clicks `target`, and waits for the menu to open and take the keys. */
async function rightClick(target: Locator) {
  await target.click({button: 'right'});
  const page = target.page();
  await menu(page).waitFor();
  await until('the menu has the keys', () => page.evaluate(() => document.activeElement?.classList.contains('ctx-menu') ?? false), has => has);
}

async function pick(page: Page, item: string) {
  await menu(page).locator('.menu-i', {hasText: item}).click();
  await menu(page).waitFor({state: 'detached'});
}

test('a draft\'s right-click: Open docks it, Pop out opens a window and leaves the page, Discard has Undo; one being sent has no Discard', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const [, beta, , delta] = await makeDrafts(setpoint, [
      {subject: 'Alpha', to: [SAM]}, {subject: 'Beta', to: [JUNE]}, {subject: 'Gamma', to: [RAVI]}, {subject: 'Delta', to: [SAM]},
    ]);
    markSending(setpoint, delta!);
    const page = await openDrafts(setpoint, 4);

    await rightClick(row(page, 'Alpha'));
    assert.deepEqual(await items(page), ['Open↵', 'Pop out', 'Discard']);
    await pick(page, 'Pop out');
    await until('Alpha in a window', () => windows(page), titles => titles.length === 1 && titles[0] === 'Alpha');
    assert.equal(pathOf(page), '/drafts', 'the page stays as it was');

    await rightClick(row(page, 'Beta'));
    await pick(page, 'Open');
    await until('Beta docked', async () => pathOf(page), at => at === `/drafts/${beta}`);
    await docked(page).waitFor();

    // Discard: the row goes at once, and Undo starts it again with its words.
    await rightClick(row(page, 'Gamma'));
    await pick(page, 'Discard');
    const toast = await holdToast(page);
    assert.equal(await toast.textContent(), 'Draft discardedUndo');
    await row(page, 'Gamma').waitFor({state: 'detached'});
    await until('Gamma gone', () => subjects(setpoint), found => !found.includes('Gamma'));
    await toast.locator('button', {hasText: 'Undo'}).click();
    const back = await until('Gamma back', () => drafts(setpoint), found => found.some(one => one.subject === 'Gamma' && one.snippet === 'About Gamma.'));
    await row(page, 'Gamma').waitFor();
    assert.deepEqual(back.find(one => one.subject === 'Gamma')!.to, [RAVI]);
    assert.equal(pathOf(page), `/drafts/${beta}`, 'one not open comes back to the list only');

    // Being sent: Open and Pop out only.
    await rightClick(row(page, 'Delta'));
    assert.deepEqual(await items(page), ['Open↵', 'Pop out']);
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('several drafts selected: the docked one gives way, a window stays; Discard counts what can go, one toast\'s Undo brings them back, and Enter opens each in a window', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const [, , , delta] = await makeDrafts(setpoint, [
      {subject: 'Alpha', to: [SAM, JUNE, RAVI]}, {subject: 'Beta', to: [JUNE]}, {subject: 'Gamma', to: [RAVI]}, {subject: 'Delta', to: [SAM]}, {subject: 'Epsilon', to: [JUNE]},
    ]);
    markSending(setpoint, delta!);
    const page = await openDrafts(setpoint, 5);

    // Epsilon up in a window, Alpha docked.
    await rightClick(row(page, 'Epsilon'));
    await pick(page, 'Pop out');
    await until('Epsilon in a window', () => windows(page), titles => titles.length === 1);
    await row(page, 'Alpha').click();
    await docked(page).waitFor();

    // The first ⌘-click takes the docked draft too, its composer closing (the draft kept).
    await row(page, 'Beta').locator('.from').click({modifiers: ['ControlOrMeta']});
    await selection(page).waitFor();
    await docked(page).waitFor({state: 'detached'});
    await until('the address opens nothing', async () => pathOf(page), at => at === '/drafts');
    assert.deepEqual(await lines(page), ['To June Park | Beta', 'To Sam Lee +2 | Alpha']);
    assert.equal(await selection(page).locator('.rd-subj').textContent(), '2 drafts selected');
    assert.deepEqual(await windows(page), ['Epsilon'], 'the window stays up');

    // ⇧-click: the range from the last one clicked, Delta being sent among it.
    await row(page, 'Delta').locator('.from').click({modifiers: ['Shift']});
    await until('four selected', () => lines(page), found => found.length === 4);
    assert.deepEqual(await lines(page), ['To Sam Lee | Delta', 'To Ravi Menon | Gamma', 'To June Park | Beta', 'To Sam Lee +2 | Alpha']);
    assert.deepEqual(await tools(page), ['Open↵', 'Discard 3', 'ClearEsc']);
    assert.equal(await page.locator('.drafts-list .row.sel').count(), 4);
    await rightClick(row(page, 'Gamma'));
    assert.deepEqual(await items(page), ['Open↵', 'Discard 3', 'Clear selectionEsc']);
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});

    // Discard: the three that can go, one toast, Delta kept and the selection ended.
    await selection(page).locator('.tool', {hasText: 'Discard 3'}).click();
    const toast = await holdToast(page);
    assert.equal(await toast.textContent(), 'Discarded 3 draftsUndo');
    await selection(page).waitFor({state: 'detached'});
    for (const subject of ['Alpha', 'Beta', 'Gamma']) await row(page, subject).waitFor({state: 'detached'});
    await until('three gone', () => subjects(setpoint), found => found.length === 2 && found.includes('Delta') && found.includes('Epsilon'));

    // Undo: every one back, in the list's order.
    await toast.locator('button', {hasText: 'Undo'}).click();
    await until('three back', () => subjects(setpoint), found => found.length === 5);
    for (const subject of ['Alpha', 'Beta', 'Gamma']) await row(page, subject).waitFor();
    assert.deepEqual(await page.locator('.drafts-list .row .subj b').allTextContents(), ['Gamma', 'Beta', 'Alpha', 'Epsilon', 'Delta']);

    // Enter: each selected draft in a window of its own, beside the one up, and the selection ends.
    await row(page, 'Gamma').locator('.from').click({modifiers: ['ControlOrMeta']});
    await row(page, 'Beta').locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('two selected', () => lines(page), found => found.length === 2);
    await page.keyboard.press('Enter');
    await selection(page).waitFor({state: 'detached'});
    await until('three windows', () => windows(page), titles => [...titles].sort().join() === 'Beta,Epsilon,Gamma');
    assert.equal(pathOf(page), '/drafts');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘A in the docked composer selects its words only; from the list it selects every draft, the composer closing; Esc ends it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await makeDrafts(setpoint, [{subject: 'Alpha', to: [SAM]}, {subject: 'Beta', to: [JUNE]}, {subject: 'Gamma', to: [RAVI]}]);
    const page = await openDrafts(setpoint, 3);
    const count = await page.locator('.drafts-list .row').count();

    // In the composer's subject: its words, and no draft.
    await row(page, 'Beta').click();
    await docked(page).waitFor();
    const subject = docked(page).locator('input[aria-label="Subject"]');
    await subject.click();
    await page.keyboard.press('ControlOrMeta+a');
    assert.ok(await subject.evaluate((field: HTMLInputElement) => field.selectionStart === 0 && field.selectionEnd === field.value.length && field.value === 'Beta'), 'the subject\'s words selected');
    assert.equal(await selection(page).count(), 0, 'no draft selected');

    // From the list: every draft, the docked composer closing (the draft kept).
    await page.locator('.hd-title').click();
    await page.keyboard.press('ControlOrMeta+a');
    await selection(page).waitFor();
    await docked(page).waitFor({state: 'detached'});
    assert.equal(await selection(page).locator('.rd-subj').textContent(), `${count} drafts selected`);
    assert.equal(await page.locator('.drafts-list .row.sel').count(), count);
    assert.equal(pathOf(page), '/drafts');

    await page.keyboard.press('Escape');
    await selection(page).waitFor({state: 'detached'});
    assert.equal(await page.locator('.drafts-list .row.sel').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
