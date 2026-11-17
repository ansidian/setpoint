// Sent in the browser, at the design target on a fresh seed each. The seed has sent mail from
// Personal, Work and iCloud, and none from Business or Jobs. From the sidebar's Sent to its list,
// each row naming who it went to, to an email with Sent's tools, Trash with Undo, and an empty
// account's view. Several selected as in the Inbox, trashed together with one Undo, and ⌘A selecting
// every one listed; Reply all on a few of them opening a window for each with others. Then search
// from Sent (sent mail only, in its account, found by its recipients too) and from the Inbox (sent
// mail with the rest). Tab and the quiet segments are components/sentAccounts.test.tsx's.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {DraftsOut, FromOut, MessageOut, SentOut} from '@setpoint/shared';
import {hasOthers} from '../../src/logic/composer.ts';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, holdToast, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const rows = (page: Page) => page.locator('.list .row:not(.leaving)');
const rowOf = (page: Page, subject: string) => rows(page).filter({hasText: subject});
const accountOf = (page: Page) => new URL(page.url()).searchParams.get('account');
const tools = (page: Page) => page.locator('.rd-tools .tool').allTextContents();
const results = (page: Page) => page.locator('.search-list .arow').evaluateAll(found => found.map(row => [row.querySelector('.from')?.getAttribute('aria-label') ?? row.querySelector('.from')?.textContent, row.querySelector('.l2')?.textContent]));

const sentIds = async (setpoint: Setpoint) => (await setpoint.api<SentOut>('GET', '/mail/sent?limit=500')).days.flatMap(day => day.rows.map(row => row.id));
const selection = (page: Page) => page.locator('section.pane.selection');
const menu = (page: Page) => page.locator('.ctx-menu');
const drafts = async (setpoint: Setpoint) => (await setpoint.api<DraftsOut>('GET', '/mail/drafts')).drafts;

/** Right-clicks `target`, and waits for the menu to open and take the keys. */
async function rightClick(target: Locator) {
  await target.click({button: 'right'});
  const page = target.page();
  await menu(page).waitFor();
  await until('the menu has the keys', () => page.evaluate(() => document.activeElement?.classList.contains('ctx-menu') ?? false), has => has);
}

async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  return page;
}

async function search(page: Page, words: string) {
  await page.keyboard.press('/');
  await page.keyboard.type(words);
  await page.locator('.search-list:not(.pending) :is(.bar, .no-results, .arow)').first().waitFor();
}

test('the sidebar\'s Sent: its list names who each went to, an email opens with Trash and Open in Gmail, Trash has Undo, and an empty account says so', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    await page.locator('.sb .nav.sub', {hasText: 'Sent'}).click();
    await until('Sent opens', async () => new URL(page.url()).pathname, path => path === '/sent');
    await rowOf(page, 'Re: Saturday hike').waitFor();
    await until('the title', () => page.title(), title => title === 'Sent');
    assert.deepEqual(await page.locator('.hd .sent-accounts button').allTextContents(), ['All', 'Business', 'Personal', 'Work', 'Jobs', 'iCloud']);
    // Newest first, each naming its first recipient, and how many more.
    assert.deepEqual(await rows(page).evaluateAll(found => found.map(row => row.querySelector('.from')?.getAttribute('aria-label'))),
      ['To Priya Raman', 'To Sam Ortiz', 'To Mom', 'To Lena Fischer +1', 'To Theo Walsh', 'To Ravi Menon +1', 'To Theo Walsh', 'To Theo Walsh', 'To Theo Walsh', 'To Contoso Coffee', 'To Tailspin Toys Support']);

    // An email opens beside it with Sent's tools, and the head says who it went to.
    await rowOf(page, 'Lab notes for Friday').click();
    await page.locator('.rd-subj', {hasText: 'Lab notes for Friday'}).waitFor();
    assert.match(new URL(page.url()).pathname, /^\/sent\/\d+$/);
    assert.deepEqual(await tools(page), ['TrashE', 'Open in GmailO', 'ReplyR', 'ForwardF']);
    await until('the head names its recipients', () => page.locator('.rd-head .to').textContent(), text => text === 'to Ravi Menon +1');

    // E: out of the list, the next one opens, and Undo puts it back in the reader.
    await page.keyboard.press('e');
    await page.locator('.mailtext', {hasText: 'Games and a cooler'}).waitFor();
    await until('it left the list', () => rowOf(page, 'Lab notes for Friday').count(), count => count === 0);
    await holdToast(page);
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator('.rd-subj', {hasText: 'Lab notes for Friday'}).waitFor();
    await rowOf(page, 'Lab notes for Friday').waitFor();
    await page.keyboard.press('Escape');
    await until('Esc closes the reader', async () => new URL(page.url()).pathname, path => path === '/sent');

    // An account's own sent mail, then an account with none: its empty view, and Show All.
    await page.locator('.hd .sent-accounts button', {hasText: 'Work'}).click();
    await until('Work', async () => accountOf(page), account => account !== null);
    await until('only Work\'s', () => rows(page).count(), count => count === 2);
    await page.locator('.hd .sent-accounts button', {hasText: 'Jobs'}).click();
    await page.locator('.view-empty .ve-head', {hasText: 'Nothing sent from Jobs'}).waitFor();
    await page.locator('.view-empty button', {hasText: 'Show All'}).click();
    await until('Show All', async () => accountOf(page), account => account === null);
    await rowOf(page, 'Re: Saturday hike').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('several selected in Sent: the first ⌘-click takes the open email, ⇧-click a range; the pane names who each went to; E trashes every one with one toast, and Undo brings them back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/sent`);
    await rows(page).nth(4).waitFor();
    const ids = await rows(page).evaluateAll(found => found.map(row => Number((row as HTMLElement).dataset.id)));
    const picked = ids.slice(1, 4);
    const row = (id: number) => page.locator(`.list .row[data-id="${id}"]`);

    // Open one, then ⌘-click the next: both selected, the reader giving way to the selection.
    await row(picked[0]!).click();
    await page.locator('.rd-subj').waitFor();
    await row(picked[1]!).locator('.from').click({modifiers: ['ControlOrMeta']});
    await selection(page).waitFor();
    await page.locator('section.pane[aria-label="Reading pane"]').waitFor({state: 'detached'});
    // ⇧-click: the range from the last one clicked.
    await row(picked[2]!).locator('.from').click({modifiers: ['Shift']});
    const listed = () => selection(page).locator('.sel-list > li[data-id]').evaluateAll(found => found.map(one => Number((one as HTMLElement).dataset.id)));
    await until('three selected', listed, shown => shown.length === 3);
    assert.deepEqual(await listed(), picked);
    assert.equal(await selection(page).locator('.rd-subj').textContent(), '3 emails selected');
    // Each line names who it went to, as its row does.
    const who = (from: Locator) => from.evaluateAll(found => found.map(one => one.querySelector('.from')?.getAttribute('aria-label')));
    assert.deepEqual(await who(selection(page).locator('.sel-list > li[data-id]')), await who(page.locator(picked.map(id => `.list .row[data-id="${id}"]`).join(', '))));
    assert.deepEqual(await selection(page).locator('.rd-tools .tool').allTextContents(), ['TrashE', 'ReplyR', 'Reply allA', 'ForwardF', 'ClearEsc']);
    assert.equal(await page.locator('.list .row.sel').count(), 3);

    // A selected row's menu is the selection's.
    await rightClick(row(picked[1]!));
    assert.deepEqual(await menu(page).locator('.menu-i').allTextContents(), ['TrashE', 'ReplyR', 'Reply allA', 'ForwardF', 'Clear selectionEsc']);
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});

    // E: every one leaves at once, one toast, the selection ended.
    await page.keyboard.press('e');
    const toast = await holdToast(page);
    assert.equal(await toast.textContent(), 'Moved 3 to TrashUndo');
    await selection(page).waitFor({state: 'detached'});
    for (const id of picked) await until(`${id} trashed`, () => sentIds(setpoint), found => !found.includes(id));
    for (const id of picked) await row(id).waitFor({state: 'detached'});

    // Undo: every one back, on the server and in the list.
    await toast.locator('button', {hasText: 'Undo'}).click();
    for (const id of picked) await until(`${id} back`, () => sentIds(setpoint), found => found.includes(id));
    for (const id of picked) await row(id).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘A in Sent selects every email listed, the reader giving way; Esc ends it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/sent`);
    await rows(page).nth(4).waitFor();
    const ids = await rows(page).evaluateAll(found => found.map(row => Number((row as HTMLElement).dataset.id)));
    // The rows drawn selected: the pane lists only its first few.
    const listed = () => page.locator('.list .row.sel').evaluateAll(found => found.map(one => Number((one as HTMLElement).dataset.id)));

    await rows(page).nth(1).click();
    await page.locator('section.pane[aria-label="Reading pane"]').waitFor();
    await page.keyboard.press('ControlOrMeta+a');
    await selection(page).waitFor();
    await page.locator('section.pane[aria-label="Reading pane"]').waitFor({state: 'detached'});
    assert.equal(await selection(page).locator('.rd-subj').textContent(), `${ids.length} emails selected`);
    assert.deepEqual(await listed(), ids);

    await page.keyboard.press('ControlOrMeta+a');
    assert.deepEqual(await listed(), ids, 'again: the same');
    await page.keyboard.press('Escape');
    await selection(page).waitFor({state: 'detached'});
    assert.deepEqual(await listed(), []);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('F and Reply all on a few selected in Sent open a window for each, in the list\'s order, Reply all only where there are others; past five A does nothing', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/sent`);
    await rows(page).nth(6).waitFor();
    const shown = await rows(page).evaluateAll(found => found.map(row => Number((row as HTMLElement).dataset.id)));
    // Whether each has anyone for Reply all, as A on one email reads it: the seed's Lab notes went to two.
    const from = await setpoint.api<FromOut>('GET', '/mail/from');
    const others = new Map(await Promise.all(shown.map(async id => [id, hasOthers(await setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), from)] as const)));
    const withOthers = shown.find(id => others.get(id));
    const alone = shown.filter(id => !others.get(id)).slice(0, 2);
    assert.ok(withOthers !== undefined && alone.length === 2, 'a sent email with others, and two to one person');
    const ids = shown.filter(id => id === withOthers || alone.includes(id));
    for (const id of ids) await page.locator(`.list .row[data-id="${id}"] .from`).click({modifiers: ['ControlOrMeta']});
    await until('three selected', () => selection(page).locator('.sel-list > li[data-id]').count(), n => n === 3);

    // F: a forward of each, a window each, in the list's order.
    await page.keyboard.press('f');
    const forwards = await until('a forward of each', () => drafts(setpoint), all => ids.every(id => all.some(one => one.message_id === id && one.kind === 'forward')));
    const subjects = ids.map(id => forwards.find(one => one.message_id === id && one.kind === 'forward')!.subject);
    const titles = () => page.locator('.cmp-windows .cmp-window .cmp-title-text').allTextContents();
    await until('three windows in order', titles, all => all.join('|') === subjects.join('|'));

    // The pane's Reply all: a window for the one with others, none for the two to one person.
    await selection(page).locator('.rd-tools .tool', {hasText: 'Reply all'}).click();
    const found = await until('a reply all to it', () => drafts(setpoint), all => all.some(one => one.message_id === withOthers && one.kind === 'reply_all'));
    await until('its window after them', titles, all => all.join('|') === [...subjects, found.find(one => one.message_id === withOthers && one.kind === 'reply_all')!.subject].join('|'));
    await setpoint.idle();
    assert.equal((await drafts(setpoint)).length, 4, 'none to the ones to one person');

    // Every one, back on the page (the caret leaves the window): past five, A does nothing.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('ControlOrMeta+a');
    await until('every one selected', () => page.locator('.list .row.sel').count(), n => n > 5);
    await page.keyboard.press('a');
    await setpoint.idle();
    assert.equal((await drafts(setpoint)).length, 4, 'no draft started');
    assert.equal(await page.locator('.cmp-window').count(), 4, 'no window opened');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search from Sent covers sent mail only, in its account; from the Inbox it covers sent mail too, which reads "To …"', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    // The Inbox: received and sent mail together.
    await search(page, 'order');
    await until('sent mail with the rest', () => results(page), found => found.some(([from]) => from === 'To Contoso Coffee') && found.some(([from]) => !from?.startsWith('To ')));
    // A sent result opens with Sent's tools.
    await page.locator('.search-list .arow', {hasText: 'Order 4417 arrived damaged'}).click();
    await page.locator('.rd-subj', {hasText: 'Order 4417 arrived damaged'}).waitFor();
    assert.deepEqual(await tools(page), ['TrashE', 'Open in GmailO', 'ReplyR', 'ForwardF']);

    // Sent: sent mail only.
    await page.goto(`${setpoint.base}/sent`);
    await rowOf(page, 'Re: Saturday hike').waitFor();
    await search(page, 'order');
    await until('only the sent one', () => results(page), found => JSON.stringify(found) === JSON.stringify([['To Contoso Coffee', 'Order 4417 arrived damaged']]));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    // Who it went to finds it, in To or Cc, a name its words never say.
    await search(page, 'ortiz');
    await until('found by its recipients', () => results(page), found => JSON.stringify(found) === JSON.stringify([['To Sam Ortiz', 'Re: Saturday hike'], ['To Lena Fischer +1', 'Book club dates']]));
    assert.deepEqual(await page.locator('.search-list .arow .why').allTextContents(), ['To ortiz', 'To ortiz']);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await rowOf(page, 'Re: Saturday hike').waitFor();

    // In an account: that account's sent mail only.
    await page.locator('.hd .sent-accounts button', {hasText: 'Work'}).click();
    await until('Work', async () => accountOf(page), account => account !== null);
    await until('only Work\'s', () => rows(page).count(), count => count === 2);
    await search(page, 'hike');
    await page.locator('.search-list .no-results', {hasText: 'No emails match'}).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.hd .sent-accounts button', {hasText: 'Personal'}).click();
    await until('Personal\'s', () => rows(page).count(), count => count === 7);
    await search(page, 'hike');
    await until('Personal\'s hike', () => results(page), found => JSON.stringify(found) === JSON.stringify([['To Sam Ortiz', 'Re: Saturday hike']]));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a conversation from Sent: a sent reply lists its thread, Theo\'s email opens in the Inbox with its own tools, and a sent one opened from there has Sent\'s; Sent\'s rows carry no reply mark', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/sent`);
    await rowOf(page, 'Re: Saturday hike').waitFor();
    assert.equal(await page.locator('.list .row .replied').count(), 0);
    // The last reply to Theo, Oct 4.
    await rows(page).filter({has: page.locator('.from[aria-label="To Theo Walsh"]')}).first().click();
    await page.locator('.mailtext', {hasText: '4 PM works.'}).waitFor();
    assert.equal(await page.locator('.rd-replied').count(), 0);
    await page.locator('.rd-conv-h', {hasText: 'Earlier in this conversation'}).waitFor();
    assert.deepEqual(await tools(page), ['TrashE', 'Open in GmailO', 'ReplyR', 'ForwardF']);

    // Theo's email is received mail: it opens in the Inbox, with Pin, and says the user replied.
    await page.locator('.rd-conv-line', {hasText: 'Perfect, Ana and Kofi'}).click();
    await page.locator('.mailtext', {hasText: 'Perfect, Ana and Kofi'}).waitFor();
    assert.match(new URL(page.url()).pathname, /^\/inbox\/\d+$/);
    await page.locator('.rd-replied', {hasText: 'You replied Oct 4'}).waitFor();
    assert.deepEqual(await tools(page), ['TrashE', 'PinP', 'Open in GmailO', 'ReplyR', 'ForwardF']);

    // A reply opened from the Inbox's reader has Sent's tools.
    await page.locator('.rd-conv-line.you', {hasText: 'Games and a cooler'}).click();
    await page.locator('.mailtext', {hasText: 'Games and a cooler'}).waitFor();
    await until('Sent\'s tools', () => tools(page), shown => shown.join() === 'TrashE,Open in GmailO,ReplyR,ForwardF');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
