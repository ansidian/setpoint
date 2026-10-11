// The read-state rules in the browser (DESIGN.md › Interaction rules; BRIEF.md › Read state and
// Done), at 1677 × 1050, 1728 × 1117 and an iPhone size, each on a fresh seed: an email turns read
// only when opened (Enter or a click) or by Mark all as read; moving the cursor, scrolling and
// expanding a group never read anything; the counts follow at once, opening dropping the unread
// counts and only Done dropping the attention pill. The seed starts at 3 attention and 19 unread.
import assert from 'node:assert/strict';
import {after, describe, test} from 'node:test';
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, collapseGroups, point, readSecurity, SIZES, startSetpoint, until} from './harness.ts';
import type {Setpoint, SizeName} from './harness.ts';

after(cleanUp);

const sizes = Object.keys(SIZES) as SizeName[];

/** The sidebar's pill and unread count, and one account's count; null where the sidebar isn't shown (the phone). */
async function sidebar(page: Page, account?: string): Promise<{pill: string; unread: string; account?: string} | null> {
  if (!await page.locator('.sb').isVisible()) return null;
  const text = async (selector: string) => ((await page.locator(selector).count()) ? (await page.locator(selector).first().textContent()) ?? '' : '');
  const accountCount = account ? await text(`.acct:has-text("${account}") .cnt`) : undefined;
  return {pill: await text('.nav:has-text("Inbox") .apill'), unread: await text('.nav:has-text("Inbox") .cnt'), ...(account ? {account: accountCount} : {})};
}

const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');
const row = (page: Page, key: string) => page.locator(`[data-key="${key}"]`);
const isUnread = async (page: Page, key: string) => (await row(page, key).getAttribute('class'))!.split(' ').includes('unread');
const cursorKey = (page: Page) => page.locator('.list .cur').first().getAttribute('data-key');

async function load(setpoint: Setpoint, size: SizeName): Promise<Page> {
  const page = await setpoint.page(size);
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.arow').first().waitFor();
  return page;
}

/** Ids of the seed's emails, from the API. */
async function ids(setpoint: Setpoint): Promise<Record<string, number>> {
  const inbox = await setpoint.api<{groups: {group: string; rows: {id: number; subject: string}[]}[]}>('GET', '/mail/inbox');
  const all = inbox.groups.flatMap(group => group.rows);
  const find = (subject: string) => all.find(item => item.subject.startsWith(subject))!.id;
  return {google: find('Your recovery email'), northwind: find('Interview availability'), exams: find('Final exam'), signIn: find('Security alert'), code: find('Your code')};
}

for (const size of sizes) {
  describe(`read state at ${SIZES[size].width} × ${SIZES[size].height}`, () => {
    test('moving the cursor, the pointer, scrolling and expanding read nothing', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const {northwind, code} = await ids(setpoint);
        // J and K move the keyboard cursor: a `sub2` fill, nothing opened. Pinned, three in
        // Attention, then Security: six J and a K land on Security's first row, the code.
        for (let index = 0; index < 6; index += 1) await page.keyboard.press('j');
        await page.keyboard.press('k');
        assert.equal(await cursorKey(page), `security:${code}`);
        assert.equal(await page.locator('.pane').count(), 0);
        // The pointer onto a row makes it the cursor.
        await point(row(page, `attention:${northwind}`));
        assert.equal(await cursorKey(page), `attention:${northwind}`);
        // Scrolling the list.
        await page.locator('.list').evaluate(list => list.scrollBy(0, 400));
        await page.locator('.list').evaluate(list => list.scrollTo(0, 0));
        // Collapsing, then expanding Deliveries by a click, and Money from the keyboard (its header is a cursor stop).
        await collapseGroups(page);
        await page.locator('.gh', {hasText: 'Deliveries'}).click();
        await page.locator('.row[title="Out for delivery"]').waitFor();
        await page.locator('.list').evaluate(list => list.scrollTo(0, 0));
        await point(row(page, 'group:money'));
        await page.keyboard.press('Enter');
        await page.locator('.row[title="Statement ready"]').waitFor();
        // Noise too.
        await page.locator('.gh', {hasText: 'Noise'}).click();
        await page.locator('.row[title^="Fall sale"]').waitFor();
        // Nothing happens to wait for: expanding opens and reads nothing.
        await page.waitForTimeout(300);
        await setpoint.idle();

        assert.equal(await page.locator('.pane').count(), 0, 'nothing opened');
        assert.equal(await page.locator('.list .row.unread, .list .arow.unread').count(), 2 + 3 + 4 + 3 + 1 + 6, 'every unread row is still unread');
        const after = await counts(setpoint);
        assert.deepEqual([after.attention, after.unread], [3, 19]);
        const shown = await sidebar(page);
        if (shown) assert.deepEqual([shown.pill, shown.unread], ['3', '19']);
        assert.equal(await page.title(), '(3) Inbox');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('Enter opens and reads; the unread counts drop at once and the pill stays', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const {northwind} = await ids(setpoint);
        await point(row(page, `attention:${northwind}`));
        await page.mouse.move(1, 1);
        assert.equal(await isUnread(page, `attention:${northwind}`), true);
        await page.keyboard.press('Enter');
        await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
        await until('the row turns read', () => isUnread(page, `attention:${northwind}`), unread => !unread);
        if (await page.locator('.sb').isVisible()) {
          await until('the sidebar follows', () => sidebar(page, 'Jobs'), shown => shown?.unread === '18' && shown.account === '1' && shown.pill === '3');
        }
        const after = await until('the server read it', () => counts(setpoint), value => value.unread === 18);
        assert.equal(after.attention, 3);
        assert.equal(await page.title(), 'Interview availability for Software Engineer I');
        // Esc closes the reader; read, not Done, it stays in Attention without its dot.
        await page.keyboard.press('Escape');
        await until('the pane collapses', () => page.locator('.pane').count(), count => count === 0);
        assert.equal(await row(page, `attention:${northwind}`).count(), 1);
        assert.equal(await isUnread(page, `attention:${northwind}`), false);
        assert.equal(await page.title(), '(3) Inbox');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('a click opens and reads an FYI email, which keeps its place until the user leaves Unread', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const {signIn} = await ids(setpoint);
        await row(page, `security:${signIn}`).click();
        await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
        await until('the server read it', () => counts(setpoint), value => value.unread === 18 && value.unread_fyi === 10);
        if (await page.locator('.sb').isVisible()) {
          await until('Business drops to 6', () => sidebar(page, 'Business'), shown => shown?.unread === '18' && shown.account === '6' && shown.pill === '3');
        }
        // Read mail leaves the Inbox, but not while the user is in Unread (2026-10-09): not from
        // under the reader, nor once it closes.
        await page.waitForTimeout(400);
        await setpoint.idle();
        assert.equal(await row(page, `security:${signIn}`).count(), 1);
        assert.equal(await isUnread(page, `security:${signIn}`), false);
        await page.keyboard.press('Escape');
        await until('the pane collapses', () => page.locator('.pane').count(), count => count === 0);
        // Nothing happens to wait for: the read row keeps its place.
        await page.waitForTimeout(400);
        await setpoint.idle();
        assert.equal(await row(page, `security:${signIn}`).count(), 1);
        // Trash it, and ⌘Z: back in its place, read, though Unread wouldn't list it now.
        await point(row(page, `security:${signIn}`));
        await page.keyboard.press('e');
        await until('trashed', () => row(page, `security:${signIn}`).count(), count => count === 0);
        await page.keyboard.press('Meta+z');
        await until('back from ⌘Z', () => row(page, `security:${signIn}`).count(), count => count === 1);
        assert.equal(await isUnread(page, `security:${signIn}`), false);
        await until('the toast goes with it', () => page.locator('.toast').count(), count => count === 0);
        // Settings is a modal over the list: opening and closing it keeps the visit.
        if (await page.locator('.sb').isVisible()) {
          await page.keyboard.press('Meta+Comma');
          await page.locator('.settings').waitFor();
          await page.keyboard.press('Escape');
          await until('Settings closes', () => page.locator('.settings').count(), count => count === 0);
          assert.equal(await row(page, `security:${signIn}`).count(), 1);
        }
        // Calendar (2), then back (1): a new visit, and it's gone.
        await page.keyboard.press('2');
        await page.waitForURL(/\/calendar/);
        await page.keyboard.press('1');
        await until('it leaves with the visit', () => row(page, `security:${signIn}`).count(), count => count === 0);
        assert.match((await page.locator('.gh', {hasText: 'Security'}).textContent())!, /Security\s*2/i);
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('the pill drops only on Done', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const {google, exams} = await ids(setpoint);
        // Opening the protected email reads it; the pill stays.
        await row(page, `attention:${google}`).click();
        await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
        await until('read', () => counts(setpoint), value => value.unread === 18);
        assert.equal((await counts(setpoint)).attention, 3);
        // H: Done. It leaves Attention and the pill drops; the next email, Northwind, opens and so
        // reads (2026-10-07: Done on the open email opens the next). The phone goes back to the
        // list instead, opening nothing (UX #12).
        const unread = size === 'iphone' ? 18 : 17;
        await page.keyboard.press('h');
        await until('it leaves Attention', () => row(page, `attention:${google}`).count(), count => count === 0);
        if (size !== 'iphone') await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
        if (await page.locator('.sb').isVisible()) await until('the pill drops to 2', () => sidebar(page), shown => shown?.pill === '2' && shown.unread === String(unread));
        await until('the server agrees', () => counts(setpoint), value => value.attention === 2 && value.unread === unread);
        if (size !== 'iphone') {
          assert.equal(await page.title(), 'Interview availability for Software Engineer I');
          await page.keyboard.press('Escape');
        }
        await until('the pane collapses', () => page.locator('.pane').count(), count => count === 0);
        assert.equal(await page.title(), '(2) Inbox');
        // Done from the row, without opening: Contoso University (read, not Done) leaves too.
        await point(row(page, `attention:${exams}`));
        await page.keyboard.press('h');
        await until('Contoso University leaves', () => row(page, `attention:${exams}`).count(), count => count === 0);
        await until('the server agrees', () => counts(setpoint), value => value.attention === 1 && value.unread === unread);
        assert.equal(await page.locator('.pane').count(), 0, 'Done from the row opens nothing');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('Mark all as read reads everything outside Attention and Security (UX #4), then Done leaves Security', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        await page.keyboard.press('Shift+I');
        // One provider call per account; the rows follow once it confirms, by the live stream. The
        // phone puts Attention before the Pinned shelf (board 21).
        const left = size === 'iphone' ? 'attention,pinned,security' : 'pinned,attention,security';
        // The server first: a refetch sent before the provider confirms can draw the groups again
        // until the live stream's catches up.
        await until('the server read them', () => counts(setpoint).then(after => [after.attention, after.unread, after.unread_fyi].join()), value => value === '3,5,3');
        await until('the FYI and Noise groups go', () => page.locator('.gh').allTextContents(), headers => headers.map(text => text.replace(/\s+/g, ' ').trim().split(' ')[0]!.toLowerCase()).join(',') === left, 5000);
        if (await page.locator('.sb').isVisible()) await until('the sidebar follows', () => sidebar(page), shown => shown?.pill === '3' && shown.unread === '5');
        // Attention keeps its read state: Google and Northwind are still unread.
        assert.equal(await page.locator('.arow.unread').count(), 2);
        // Done on each, from the keyboard: J to the first attention row, then H three times.
        await page.keyboard.press('j');
        if (size !== 'iphone') await page.keyboard.press('j');
        for (let index = 0; index < 3; index += 1) {
          await page.keyboard.press('h');
          await until('one fewer', () => page.locator('.arow').count(), count => count === 2 - index);
        }
        // Security is left, unread: its codes and sign-in alerts are read by opening them.
        const groups = await page.locator('.gh').allTextContents();
        assert.deepEqual(groups.map(text => text.replace(/\s+/g, ' ').trim().split(' ')[0]!.toLowerCase()), ['pinned', 'security']);
        assert.equal(await page.locator('.empty-line').count(), 0);
        assert.equal(await page.locator('.pane').count(), 0);
        await until('the server agrees', () => counts(setpoint), value => value.attention === 0 && value.unread === 3);
        if (await page.locator('.sb').isVisible()) await until('the sidebar follows', () => sidebar(page), shown => shown?.pill === '' && shown.unread === '3');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });
  });
}

test('All caught up waits until Unread holds nothing: mail read and Done elsewhere keeps its rows until the user leaves (SV-25)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, 'target');
    // Elsewhere: the Security emails opened, every other email read, then every attention email Done.
    await readSecurity(setpoint);
    await setpoint.api('POST', '/mail/mark-all-read', {});
    await until('Mark all as read confirmed', () => counts(setpoint), value => value.unread === value.attention - 1 && value.unread_fyi === 0);
    const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
    for (const one of inbox.groups.find(group => group.group === 'attention')!.rows) await setpoint.api('POST', `/mail/messages/${one.id}/done`, {done: true});
    await until('nothing waits on the server', () => counts(setpoint), value => value.attention === 0 && value.unread === 0);
    // Unread keeps the rows it showed, read, so it isn't caught up yet (DESIGN.md #20).
    await until('the dots go', () => page.locator('.list .unread').count(), count => count === 0, 5000);
    // Nothing happens to wait for: Unread keeps the rows it showed.
    await page.waitForTimeout(400);
    await setpoint.idle();
    assert.ok(await page.locator('.list .row:not(.shelf), .list .arow').count() > 0);
    assert.equal(await page.locator('.empty-line').count(), 0);
    // Leaving ends the visit: going back opens All, as nothing waits (D106), and Unread, picked,
    // holds nothing and says All caught up.
    await page.keyboard.press('2');
    await page.locator('.cal-title').waitFor();
    await page.keyboard.press('1');
    await page.locator('.list.all .row').first().waitFor();
    await page.keyboard.press('u');
    await page.locator('.empty-line', {hasText: 'All caught up'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
