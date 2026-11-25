// The phone's Inbox at 390 × 844 (board 21): its two-line rows and their marks, read state by taps,
// the views menu under its title, and plain search, which takes sent mail in.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';
import {counts, email, inbox} from './phoneHelpers.ts';

after(cleanUp);

test('on the phone a row\'s summary wraps rather than being cut, and the kinds are subheadings', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    // Every row's line in the seed fits in its two lines, none cut.
    const cut = await page.locator('.list .row .subj:not(.code-line)').evaluateAll(all => all.filter(node => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
    assert.deepEqual(cut, []);
    // Each FYI run gets its subheading, as on the desktop.
    const subheads = page.locator('.list.all .kh');
    await subheads.first().waitFor();
    assert.deepEqual((await subheads.allTextContents()).slice(0, 4), ['Security', 'Deliveries', 'Money', 'Career']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone a Done row\'s tag covers neither its sender, its account nor its summary', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await setpoint.api('POST', `/mail/messages/${await email(setpoint, 'Interview availability')}/done`, {done: true});
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    const row = page.locator('.list.all .row.done', {hasText: 'Northwind'});
    await row.locator('.tag').waitFor();
    const boxOf = async (selector: string) => (await rested(() => row.locator(selector).boundingBox()))!;
    const [from, tag, age, line] = await Promise.all([boxOf('.from'), boxOf('.tag'), boxOf('.age'), boxOf('.subj')]);
    assert.ok(tag.y + tag.height <= line.y, `tag bottom ${tag.y + tag.height}, summary top ${line.y}`);
    // After the sender and before the age, overlapping neither. The Inbox's rows carry no account.
    assert.equal(await row.locator('.ac').count(), 0);
    assert.ok(from.x + from.width <= tag.x && tag.x + tag.width <= age.x, `sender ${from.x}–${from.x + from.width}, tag ${tag.x}–${tag.x + tag.width}, age ${age.x}`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('read state on the phone: a tap opens and reads; scrolling and opening Noise read nothing', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    // Nothing reads on a scroll, so the check makes none.
    await page.locator('.list .nfold').first().tap();
    await page.locator('.row:has(b[data-tip^="Fall sale"])').waitFor();
    // Nothing happens to wait for: opening Noise reads nothing.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.deepEqual(await counts(setpoint).then(value => [value.attention, value.unread]), [3, 19]);
    // One count in the header: Attention's pill. Unread's is in the title's menu.
    assert.equal(await page.locator('.hd .apill').textContent(), '3');
    assert.equal(await page.locator('.hd .num:not(.apill)').count(), 0);

    await page.locator('.row:has(b[data-tip="Out for delivery"])').tap();
    await page.locator('.rd-subj', {hasText: 'Out for delivery'}).waitFor();
    await until('the server read it', () => counts(setpoint), value => value.unread === 18 && value.attention === 3);
    await page.locator('.ph-back').tap();
    await page.locator('.hd .ph-title-btn').tap();
    const unread = page.getByRole('menu', {name: 'Inbox'}).getByRole('menuitemradio', {name: /^Unread/});
    await until('the count follows', () => unread.textContent(), text => text === 'Unread18');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.hd .apill').textContent(), '3');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('no account filter, and plain search with no chips, Ask Alfred leading its results', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    assert.equal(await page.locator('.hd select').count(), 0);

    const reads: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/search') reads.push((request.postDataJSON() as {read?: string}).read ?? 'words');
      if (path === '/api/search/suggestion') reads.push('suggestion');
    });
    // The page's clock is the check's, so the suggestion's 700 ms pause (mailSearch.ts) has run out when it says.
    await page.clock.install();
    await page.locator('.search input').tap();
    await page.keyboard.type('northwind interview ');
    await page.locator('.search-list .result').first().waitFor();
    // Searching, the top reads Search alone: no attention pill beside it, as mail's search clears its controls.
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.equal(await page.locator('.hd .apill').count(), 0);
    await page.keyboard.press('Enter');
    // Nothing happens to wait for. Enter makes no chips on the phone, and no pause asks for a
    // suggestion, its 700 ms run out on the page's clock.
    await page.clock.runFor(701);
    await setpoint.idle();
    assert.equal(await page.locator('.search .qchip').count(), 0, 'no chips');
    assert.ok(reads.length > 0 && reads.every(read => read === 'words'), `its searches ask for no reading: ${reads.join()}`);
    assert.equal(await page.locator('.search input').inputValue(), 'northwind interview ');
    assert.equal(await page.locator('.search-list .ask').isVisible(), true, 'Ask Alfred leads the results');
    // The user's own reply to Priya comes first: search takes sent mail in.
    await page.locator('.search-list .result', {hasText: 'Interview availability'}).tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('phone search: no Mark all as read meanwhile, Back to Search from a result, and the clear button leaves search for the Inbox', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const markAll = page.locator('.hd button[aria-label="Mark all as read"]');
    await markAll.waitFor();
    await page.locator('.search input').tap();
    await page.keyboard.type('northwind');
    await page.locator('.search-list .result').first().waitFor();
    // Mark all as read would read the hidden Inbox's mail, not the results: it's gone while searching.
    assert.equal(await markAll.count(), 0);
    // An email from the results goes back to them.
    await page.locator('.search-list .result', {hasText: 'Interview availability'}).tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.equal(await page.locator('.ph-back').textContent(), 'Search');
    await page.locator('.ph-back').tap();
    await until('back at the results', () => page.locator('.pane').count(), count => count === 0);
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    // One tap leaves search: the field empties and lets go, and the Inbox and Mark all as read come back.
    await page.locator('.search .search-clear').tap();
    await page.locator('.content > .list .gh').first().waitFor();
    assert.equal(await page.locator('.search input').inputValue(), '');
    assert.equal(await page.locator('.hd-title').textContent(), 'Inbox');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
    await markAll.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the title\'s menu switches the views, Unread and Attention with their counts, and the Inbox tab goes back to All; Sent follows them, and Settings opens its index, the Inbox tab lit', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const title = page.locator('.hd .ph-title-btn');
    const menu = page.getByRole('menu', {name: 'Inbox'});
    await title.tap();
    await menu.waitFor();
    const rows = await menu.locator('.menu-i').evaluateAll(found => found.map(row => `${row.textContent}${row.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`));
    assert.deepEqual(rows, ['All ✓', 'Unread19', 'Attention3', 'FYI', 'Noise', 'Sent', 'Settings']);

    // Unread: the header names it, and every row it lists is unread.
    await menu.getByRole('menuitemradio', {name: /^Unread/}).tap();
    await until('the Unread view', () => page.evaluate(() => window.location.search), search => search === '?view=unread');
    assert.equal(await title.textContent(), 'Unread');
    await page.locator('.list .row.unread').first().waitFor();
    assert.equal(await page.locator('.list .row:not(.unread)').count(), 0);
    // Beside "Unread" a count would read as Unread's, so the header has none and the Inbox tab carries Attention's.
    assert.equal(await page.locator('.hd .apill').count(), 0);
    assert.equal(await page.locator('.ph-tabs a', {hasText: 'Inbox'}).locator('.ph-badge').textContent(), '3');

    // Attention has nothing to mark read.
    await title.tap();
    await page.getByRole('menu', {name: 'Unread'}).getByRole('menuitemradio', {name: /^Attention/}).tap();
    await until('the Attention view', () => title.textContent(), text => text === 'Attention');
    assert.equal(await page.locator('.hd .apill').textContent(), '3');
    assert.equal(await page.locator('.ph-tabs .ph-badge').count(), 0);
    assert.equal(await page.locator('.hd button[aria-label^="Mark"]').count(), 0);

    // The Inbox tab goes back to All.
    await page.locator('.ph-tabs a', {hasText: 'Inbox'}).tap();
    await until('All again', () => title.textContent(), text => text === 'Inbox');
    assert.equal(new URL(page.url()).search, '');

    await title.tap();
    await page.getByRole('menu', {name: 'Inbox'}).getByRole('menuitem', {name: 'Settings'}).tap();
    await until('Settings', () => page.evaluate(() => window.location.pathname), path => path === '/settings');
    await page.locator('.ph-set-pages').waitFor();
    assert.equal(await page.locator('.ph-tabs a[aria-current="page"]', {hasText: 'Inbox'}).count(), 1, 'the Inbox tab is lit');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone a row\'s reply mark and Draft tag sit on its sender\'s line, clear of the sender, the account and the subject', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    // A reply left on the phone is a draft, and its row says so.
    await page.locator('.row:has(b[data-tip="Out for delivery"])').tap();
    await page.locator('.ph-acts button', {hasText: 'Reply'}).tap();
    const reply = page.getByRole('dialog', {name: 'Reply'});
    await reply.locator('.cmp-from > button').waitFor();
    await page.keyboard.type('Thanks!');
    await until('the draft is kept', () => setpoint.api<{drafts: {snippet: string}[]}>('GET', '/mail/drafts'), out => out.drafts.some(one => one.snippet === 'Thanks!'));
    await reply.getByRole('button', {name: 'Cancel'}).tap();
    await page.locator('.ph-back').tap();

    for (const [row, mark] of [['.row:has(b[data-tip="Out for delivery"])', '.drafted'], ['.row:has(.replied)', '.replied']] as const) {
      const at = page.locator(`.list ${row}`).first();
      await at.locator(mark).waitFor();
      const boxOf = async (selector: string) => (await rested(() => at.locator(selector).boundingBox()))!;
      const [from, marks, age, line] = await Promise.all([boxOf('.from'), boxOf('.marks'), boxOf('.age'), boxOf('.subj')]);
      assert.ok(marks.y + marks.height <= line.y, `${mark}: marks bottom ${marks.y + marks.height}, subject top ${line.y}`);
      assert.ok(from.x + from.width <= marks.x && marks.x + marks.width <= age.x, `${mark}: sender ${from.x}–${from.x + from.width}, marks ${marks.x}–${marks.x + marks.width}, age ${age.x}`);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('phone search takes sent mail in: the user\'s reply reads To its recipient and opens with no Pin, Snooze or read state', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.search input').tap();
    await page.keyboard.type('cabin');
    const sent = page.locator('.search-list .result', {hasText: /^To\s*Theo Walsh/}).first();
    await sent.waitFor();
    // Theo's own emails, which the user answered, carry the reply mark.
    await page.locator('.search-list .result', {hasText: 'Theo Walsh'}).locator('.replied').first().waitFor();
    await sent.tap();
    await page.locator('.rd-subj', {hasText: 'Cabin weekend in November'}).waitFor();
    await until('its bar', () => page.locator('.ph-acts > button').allTextContents(), shown => shown.join() === 'Trash,Reply,More');
    assert.equal(await page.locator('.ph-top button[aria-label="Pin"]').count(), 0);
    await page.locator('.ph-acts button', {hasText: 'More'}).tap();
    assert.deepEqual(await page.locator('.ph-bs .ph-bs-i').allTextContents(), ['Forward', 'Add to calendar', 'Add as task']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
