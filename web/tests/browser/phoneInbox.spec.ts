// The phone's Inbox at 390 × 844 (board 21): its two-line rows, read state by taps, and plain search.
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
    const [from, tag, account, line] = await Promise.all([boxOf('.from'), boxOf('.tag'), boxOf('.ac'), boxOf('.subj')]);
    assert.ok(tag.y + tag.height <= line.y, `tag bottom ${tag.y + tag.height}, summary top ${line.y}`);
    // After the sender and before the account, overlapping neither.
    assert.ok(from.x + from.width <= tag.x && tag.x + tag.width <= account.x, `sender ${from.x}–${from.x + from.width}, tag ${tag.x}–${tag.x + tag.width}, account ${account.x}`);
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
    assert.equal(await page.locator('.hd .ph-count').textContent(), '19');

    await page.locator('.row:has(b[data-tip="Out for delivery"])').tap();
    await page.locator('.rd-subj', {hasText: 'Out for delivery'}).waitFor();
    await until('the server read it', () => counts(setpoint), value => value.unread === 18 && value.attention === 3);
    await page.locator('.ph-back').tap();
    await until('the count follows', () => page.locator('.hd .ph-count').textContent(), text => text === '18');
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
    // Searching, the top reads Search alone: no attention pill or count beside it, as mail's search clears its controls.
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.equal(await page.locator('.hd .apill, .hd .ph-count').count(), 0);
    await page.keyboard.press('Enter');
    // Nothing happens to wait for. Enter makes no chips on the phone, and no pause asks for a
    // suggestion, its 700 ms run out on the page's clock.
    await page.clock.runFor(701);
    await setpoint.idle();
    assert.equal(await page.locator('.search .qchip').count(), 0, 'no chips');
    assert.ok(reads.length > 0 && reads.every(read => read === 'words'), `its searches ask for no reading: ${reads.join()}`);
    assert.equal(await page.locator('.search input').inputValue(), 'northwind interview ');
    assert.equal(await page.locator('.search-list .ask').isVisible(), true, 'Ask Alfred leads the results');
    await page.locator('.search-list .result').first().tap();
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
