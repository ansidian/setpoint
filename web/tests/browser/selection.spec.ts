// Selecting several emails. ⌘-click and ⇧-click select rows without opening or reading them, and the
// reading pane shows the selection as a stack of cards, the last selected in front and read nothing.
// A strip's click brings its card to the front. The first ⌘-click takes the open email, and a plain click ends
// it and opens. A selected row's right-click offers the selection's actions, and another row's
// offers its own. E trashes every one with one toast, and ⌘Z brings every one back. Mark read, Pin
// and Done act on all of it. ⌘A selects every email the list holds, and in the search field its text.
// R, A and F on two to five selected open a composer window for each, in the list's order. S opens
// the pane's snooze menu (where a pane covers the list, the first selected row's), the right-click
// menu's Snooze has the times, and a time snoozes every one.
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {AllOut, MessageOut, MessageRowOut, SnoozedOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const row = (page: Page, id: number) => page.locator(`.list .row[data-id="${id}"]`).first();
const pane = (page: Page) => page.locator('section.pane.selection');
const reader = (page: Page) => page.locator('section.pane[aria-label="Reading pane"]');
// The stack's cards, the front one first (the strips are drawn farthest first, the front card last).
const listed = (page: Page) => pane(page).locator('.sel-stack > [data-id]').evaluateAll(items => items.map(item => Number((item as HTMLElement).dataset.id)).reverse());
const selectedRows = (page: Page) => page.locator('.list .row.sel').evaluateAll(rows => [...new Set(rows.map(one => Number((one as HTMLElement).dataset.id)))]);
const menu = (page: Page) => page.locator('.ctx-menu');
const items = (page: Page) => menu(page).locator('.menu-i').allTextContents();
const message = (setpoint: Setpoint, id: number) => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`);
const allRows = async (setpoint: Setpoint) => (await setpoint.api<AllOut>('GET', '/mail/all?limit=500')).days.flatMap(day => day.rows);
const inAll = async (setpoint: Setpoint, id: number) => (await allRows(setpoint)).some(one => one.id === id);
// Every draft the server keeps, read from its database: an untouched one is in no Drafts list.
const drafts = async (setpoint: Setpoint) => {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    return database.prepare('SELECT id, kind, message_id, subject FROM drafts ORDER BY id').all() as {id: number; kind: string; message_id: number | null; subject: string}[];
  } finally {
    database.close();
  }
};
// The composer windows' titles, in the order they popped out (those folded into "+N" too).
const windowTitles = (page: Page) => page.locator('.cmp-windows .cmp-window .cmp-title-text').allTextContents();

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
 * Four emails next to each other in a day, none of them in Attention or on the shelf: three for a
 * selection, and the day's next one after them.
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
    await openInbox(page, setpoint.base);
    const [first, second, third] = await fourInADay(page, setpoint);

    // ⌘-click: selected, the pane up, nothing opened or read.
    await row(page, first!.id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await pane(page).waitFor();
    assert.equal(await pane(page).locator('.sel-head .rd-subj').textContent(), '1 email selected');
    assert.equal(await reader(page).count(), 0, 'nothing opened');
    // Whatever the click sent answered before the server is read.
    await setpoint.idle();
    assert.equal((await message(setpoint, first!.id)).unread, first!.unread, 'nothing read');
    assert.ok(!new URL(page.url()).searchParams.has('open') && !page.url().includes('/open/'), 'the address opens nothing');

    // ⇧-click: every email from the last one clicked to this one, the one clicked in front.
    await row(page, third!.id).locator('.from').click({modifiers: ['Shift']});
    await until('three selected', () => listed(page), ids => ids.length === 3);
    assert.deepEqual(await listed(page), [third!.id, second!.id, first!.id]);
    assert.deepEqual(await selectedRows(page), [first!.id, second!.id, third!.id]);
    assert.equal(await pane(page).locator('.sel-head .rd-subj').textContent(), '3 emails selected');
    assert.equal(await page.evaluate(() => getSelection()?.toString() ?? ''), '', 'the ⇧-click selected no text');
    // A selected row is drawn as the open one is: lifted, with the 3 px accent edge.
    await until('drawn selected', () => row(page, second!.id).evaluate(element => getComputedStyle(element).boxShadow), shadow => /3px 0px 0px 0px inset/.test(shadow));

    // × takes one out; ⌘-click on a selected row does too.
    await pane(page).locator(`.sel-stack > [data-id="${second!.id}"] > .sel-drop`).click();
    await until('two listed', () => listed(page), ids => ids.length === 2);
    await row(page, third!.id).locator('.from').click({modifiers: ['ControlOrMeta']});
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

test('the stack shows the last selected in front, read as the reader reads it, and reads nothing; a strip\'s click swaps it to the front, the selection kept', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const shown = await onScreen(page);
    const [first, second] = (await allRows(setpoint)).filter(one => one.unread && shown.includes(one.id));
    assert.ok(first && second, 'two unread emails listed');
    for (const id of [first.id, second.id]) await row(page, id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('two selected', () => listed(page), ids => ids.length === 2);
    assert.deepEqual(await listed(page), [second.id, first.id]);

    // The front card is the email: its subject, and its body once it's in.
    const front = pane(page).locator('.sel-card');
    assert.equal(await front.locator('.rd-subj').textContent(), second.subject);
    await front.locator('.rd-body .mailtext, .rd-body .mailframe').first().waitFor();

    // A strip's click: that one in front, the other behind, both still selected.
    await pane(page).locator(`.sel-strip[data-id="${first.id}"] .sel-front-it`).click();
    await until('the strip in front', () => listed(page), ids => ids[0] === first.id);
    assert.deepEqual(await listed(page), [first.id, second.id]);
    assert.equal(await pane(page).locator('.sel-head .rd-subj').textContent(), '2 emails selected');
    await front.locator('.rd-body .mailtext, .rd-body .mailframe').first().waitFor();

    // Shown in front, neither was read.
    await setpoint.idle();
    assert.deepEqual([(await message(setpoint, first.id)).unread, (await message(setpoint, second.id)).unread], [true, true]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘A selects every email listed, the reader giving way, and again changes nothing; Esc ends it; in the search field it selects the field\'s text', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const shown = await onScreen(page);
    assert.ok(shown.length > 3, 'several emails listed');

    // With an email open: every one listed, in the list's order, the reader giving way.
    await row(page, shown[1]!).locator('.from').click();
    await reader(page).waitFor();
    await page.keyboard.press('ControlOrMeta+a');
    await pane(page).waitFor();
    await reader(page).waitFor({state: 'detached'});
    assert.equal(await pane(page).locator('.sel-head .rd-subj').textContent(), `${shown.length} emails selected`);
    assert.deepEqual(await selectedRows(page), shown);
    assert.equal(await page.evaluate(() => getSelection()?.toString() ?? ''), '', 'no page text selected');

    // Again: the same.
    await page.keyboard.press('ControlOrMeta+a');
    assert.equal(await pane(page).locator('.sel-head .rd-subj').textContent(), `${shown.length} emails selected`);
    assert.deepEqual(await selectedRows(page), shown);

    // Esc ends it.
    await page.keyboard.press('Escape');
    await pane(page).waitFor({state: 'detached'});
    assert.deepEqual(await selectedRows(page), []);

    // In the search field, the field's words and nothing else.
    await page.keyboard.press('/');
    await page.keyboard.type('order');
    await page.locator('.search-list:not(.pending) :is(.bar, .no-results, .arow)').first().waitFor();
    await page.keyboard.press('ControlOrMeta+a');
    assert.ok(await page.locator('.hd .search input').evaluate((field: HTMLInputElement) => field.selectionStart === 0 && field.selectionEnd === field.value.length && field.value.length > 0), 'the field\'s text selected');
    await setpoint.idle();
    assert.equal(await pane(page).count(), 0, 'no email selected');
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

    await row(page, first!.id).locator('.from').click();
    await reader(page).waitFor();
    await row(page, second!.id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await pane(page).waitFor();
    assert.deepEqual(await listed(page), [second!.id, first!.id]);
    await reader(page).waitFor({state: 'detached'});
    await setpoint.idle();
    assert.equal((await message(setpoint, second!.id)).unread, second!.unread, 'the one ⌘-clicked isn\'t read');

    // A plain click opens that email, and the selection ends.
    await row(page, third!.id).locator('.from').click();
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
    // By the sender: with the selection open beside it, a row's middle can be its code's Copy.
    for (const id of ids) await row(page, id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('three selected', () => listed(page), shown => shown.length === 3);

    // On a selected row: the selection's, nothing that's one email's only.
    await rightClick(row(page, ids[1]!));
    const offered = await items(page);
    assert.deepEqual(offered.filter(label => !/^Mark (un)?read/.test(label)),
      ['TrashE', picked.every(one => one.pinned) ? 'UnpinP' : 'PinP', 'Snooze', 'ReplyR', 'Reply allA', 'ForwardF', 'Clear selectionEsc']);
    assert.equal(offered.length, 8, 'and Mark read or Mark unread');
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});

    // On a row outside it: that row's own, and the selection stays.
    await rightClick(row(page, next!.id));
    assert.equal((await items(page))[0], 'Open↵');
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});
    assert.deepEqual(await listed(page), [...ids].reverse(), 'the selection kept');

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
    // By the sender: with the selection open beside it, a row's middle can be its code's Copy.
    for (const id of ids) await row(page, id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('three selected', () => listed(page), listedIds => listedIds.length === 3);
    const tools = () => pane(page).locator('.rd-tools .tool').allTextContents();
    assert.deepEqual(await tools(), ['Done 2H', 'TrashE', 'PinP', 'SnoozeS', 'ReplyR', 'Reply allA', 'ForwardF', 'Mark read', 'ClearEsc']);

    // Mark read: the unread ones, one toast. The selection stays.
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
    await setpoint.idle();
    assert.equal((await message(setpoint, plain.id)).done, false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S on a selection of two opens the pane\'s snooze menu, and Tomorrow snoozes both with one toast, ending the selection', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const shown = new Set(await onScreen(page));
    const ids = (await allRows(setpoint)).filter(one => shown.has(one.id) && !one.pinned && one.lane !== 'attention').slice(0, 2).map(one => one.id);
    for (const id of ids) await row(page, id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('two selected', () => listed(page), listedIds => listedIds.length === 2);
    await page.keyboard.press('s');
    const snooze = pane(page).locator('.snooze-list');
    await snooze.waitFor();
    await until('Tomorrow focused', () => page.evaluate(() => document.activeElement?.textContent ?? ''), text => text.startsWith('Tomorrow'));
    await snooze.getByRole('menuitem', {name: /^Tomorrow/}).click();
    await page.locator('.toast', {hasText: /^Snoozed/}).waitFor();
    await pane(page).waitFor({state: 'detached'});
    const snoozed = () => setpoint.api<SnoozedOut>('GET', '/mail/snoozed').then(list => list.rows.map(one => one.id));
    await until('both snoozed at the server', snoozed, found => ids.every(id => found.includes(id)));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('where a pane covers the list, S on a selection opens the first selected row\'s snooze menu, and Tomorrow snoozes both', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page({width: 900, height: 800});
    await openInbox(page, setpoint.base);
    const shown = await onScreen(page);
    const rows = await allRows(setpoint);
    // Two in the list's order, not pinned (the shelf repeats them) nor Attention.
    const ids = shown.filter(id => rows.some(one => one.id === id && !one.pinned && one.lane !== 'attention')).slice(0, 2);
    for (const id of ids) await row(page, id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('two selected', () => selectedRows(page), selectedIds => selectedIds.length === 2);
    assert.equal(await pane(page).count(), 0, 'no selection pane at this width');
    await page.keyboard.press('s');
    const snooze = row(page, ids[0]!).locator('.snooze-list');
    await snooze.waitFor();
    await until('Tomorrow focused', () => page.evaluate(() => document.activeElement?.textContent ?? ''), text => text.startsWith('Tomorrow'));
    await snooze.getByRole('menuitem', {name: /^Tomorrow/}).click();
    await page.locator('.toast', {hasText: /^Snoozed/}).waitFor();
    const snoozed = () => setpoint.api<SnoozedOut>('GET', '/mail/snoozed').then(list => list.rows.map(one => one.id));
    await until('both snoozed at the server', snoozed, found => ids.every(id => found.includes(id)));
    await until('the selection ended', () => selectedRows(page), selectedIds => selectedIds.length === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a selection\'s right-click Snooze › Tomorrow snoozes every one', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const shown = new Set(await onScreen(page));
    const ids = (await allRows(setpoint)).filter(one => shown.has(one.id) && !one.pinned && one.lane !== 'attention').slice(0, 2).map(one => one.id);
    for (const id of ids) await row(page, id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('two selected', () => listed(page), listedIds => listedIds.length === 2);
    await rightClick(row(page, ids[1]!));
    await menu(page).locator('.menu-i', {hasText: /^Snooze$/}).click();
    const times = await items(page);
    assert.ok(times[0]!.startsWith('Tomorrow · '), `Tomorrow first in ${times.join()}`);
    assert.equal(times.at(-1), 'Pick a date and time…');
    await menu(page).locator('.menu-i', {hasText: /^Tomorrow/}).click();
    await page.locator('.toast', {hasText: /^Snoozed/}).waitFor();
    const snoozed = () => setpoint.api<SnoozedOut>('GET', '/mail/snoozed').then(list => list.rows.map(one => one.id));
    await until('both snoozed at the server', snoozed, found => ids.every(id => found.includes(id)));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('R, A and F on two to five selected open one composer window per email, in the list\'s order, from the keys and the menu; past five they aren\'t offered and the keys do nothing', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const picked = (await fourInADay(page, setpoint)).slice(0, 3);
    const ids = picked.map(one => one.id);

    // ⌘A: more than five, so the pane and menu don't offer them and R, A and F do nothing.
    await page.keyboard.press('ControlOrMeta+a');
    await until('every one selected', () => listed(page), shown => shown.length > 5);
    const tools = await pane(page).locator('.rd-tools .tool').allTextContents();
    assert.ok(!tools.some(tool => /^(Reply|Forward)/.test(tool)), `no Reply, Reply all or Forward in ${tools.join()}`);
    await rightClick(row(page, ids[0]!));
    assert.ok(!(await items(page)).some(item => /^(Reply|Forward)/.test(item)), 'nor in the menu');
    await page.keyboard.press('Escape');
    await menu(page).waitFor({state: 'detached'});
    for (const key of ['r', 'a', 'f']) await page.keyboard.press(key);
    await setpoint.idle();
    assert.deepEqual(await drafts(setpoint), [], 'no draft started');
    assert.equal(await page.locator('.cmp-window').count(), 0, 'no window opened');
    await page.keyboard.press('Escape');
    await pane(page).waitFor({state: 'detached'});

    // Three, ⌘-clicked out of order: the windows still follow the list.
    for (const id of [ids[2]!, ids[0]!, ids[1]!]) await row(page, id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('three selected', () => listed(page), shown => shown.length === 3);

    /** Each email's draft of `kind`, by the email, once all of them are in. */
    const draftsOf = async (kind: string) => {
      const found = await until(`a ${kind} for each`, () => drafts(setpoint), all => ids.every(id => all.some(one => one.message_id === id && one.kind === kind)));
      return ids.map(id => found.find(one => one.message_id === id && one.kind === kind)!);
    };

    // The menu's Forward: a forward of each, each in its own window, in the list's order. The selection stays.
    await rightClick(row(page, ids[1]!));
    await menu(page).locator('.menu-i', {hasText: /^ForwardF$/}).click();
    const forwards = await draftsOf('forward');
    await until('three windows in order', () => windowTitles(page), titles => titles.join('|') === forwards.map(one => one.subject).join('|'));
    assert.equal(await page.locator('.pane .composer').count(), 0, 'none in the reading pane');
    assert.deepEqual(await listed(page), [ids[1], ids[0], ids[2]], 'still selected');

    // R, back on the page (the caret leaves the last window): a reply to each, after the forwards.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('r');
    const replies = await draftsOf('reply');
    await until('three more windows in order', () => windowTitles(page),
      titles => titles.join('|') === [...forwards, ...replies].map(one => one.subject).join('|'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a reply open under an email that joins a selection pops out with the rest when R answers the selection', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openInbox(page, setpoint.base);
    const [first, second] = await fourInADay(page, setpoint);
    await row(page, first!.id).locator('.from').click();
    await reader(page).waitFor();
    await page.keyboard.press('r');
    await page.locator('.pane .composer').waitFor();

    // ⌘-click: the open email and this one, the reader (and its reply) giving way.
    await row(page, second!.id).locator('.from').click({modifiers: ['ControlOrMeta']});
    await until('two selected', () => listed(page), shown => shown.length === 2);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('r');
    const found = await until('a reply to each', () => drafts(setpoint), all => [first!.id, second!.id].every(id => all.some(one => one.message_id === id && one.kind === 'reply')));
    const subjects = [first!.id, second!.id].map(id => found.find(one => one.message_id === id && one.kind === 'reply')!.subject);
    await until('two windows in order', () => windowTitles(page), titles => titles.join('|') === subjects.join('|'));
    assert.equal(found.length, 2, 'the first reply\'s own draft, not another');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
