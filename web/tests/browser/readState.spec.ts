// The read-state rules in the browser (DESIGN.md › Interaction rules; BRIEF.md › Read state and
// Done), at 1677 × 1050, 1728 × 1117 and an iPhone size, each on a fresh seed: an email turns read
// only when opened (Enter or a click) or by Mark all as read; moving the cursor, scrolling and
// opening a Noise line never read anything; the counts follow at once, opening dropping the unread
// counts and only Done dropping the attention pill. The seed starts at 3 attention and 19 unread.
// A row's key says where it is: New ("new:5"), Attention ("attention:22") or its day ("all:5").
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, describe, point, readSecurity, SIZES, startSetpoint, test, until} from './harness.ts';
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
  await page.locator('.list .row').first().waitFor();
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
        // J and K move the keyboard cursor: a `sub2` fill, nothing opened. New's two in Attention,
        // then Security: four J and a K land on Security's first row, the code.
        for (let index = 0; index < 4; index += 1) await page.keyboard.press('j');
        await page.keyboard.press('k');
        assert.equal(await cursorKey(page), `new:${code}`);
        assert.equal(await page.locator('.pane').count(), 0);
        // The pointer onto a row makes it the cursor.
        await point(row(page, `new:${northwind}`));
        assert.equal(await cursorKey(page), `new:${northwind}`);
        // Scrolling the list.
        await page.locator('.list').evaluate(list => list.scrollBy(0, 400));
        await page.locator('.list').evaluate(list => list.scrollTo(0, 0));
        // Opening New's Noise from the keyboard (its line is a cursor stop), closing it by a click, and opening it again.
        await row(page, 'noise:new').scrollIntoViewIfNeeded();
        await point(row(page, 'noise:new'));
        await page.keyboard.press('Enter');
        await page.locator('.row[title^="Fall sale"]').waitFor();
        await page.locator('.list .nfold').first().click();
        await until('Noise folded', () => page.locator('.row[title^="Fall sale"]').count(), count => count === 0);
        await page.locator('.list .nfold').first().click();
        await page.locator('.row[title^="Fall sale"]').waitFor();
        // Nothing happens to wait for: opening Noise opens and reads nothing.
        await page.waitForTimeout(300);
        await setpoint.idle();

        assert.equal(await page.locator('.pane').count(), 0, 'nothing opened');
        assert.equal(await page.locator('.list .row.unread').count(), 2 + 3 + 4 + 3 + 1 + 6, 'every unread row is still unread');
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
        await point(row(page, `new:${northwind}`));
        await page.mouse.move(1, 1);
        assert.equal(await isUnread(page, `new:${northwind}`), true);
        await page.keyboard.press('Enter');
        await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
        await until('the row turns read', () => isUnread(page, `new:${northwind}`), unread => !unread);
        if (await page.locator('.sb').isVisible()) {
          await until('the sidebar follows', () => sidebar(page, 'Jobs'), shown => shown?.unread === '18' && shown.account === '1' && shown.pill === '3');
        }
        const after = await until('the server read it', () => counts(setpoint), value => value.unread === 18);
        assert.equal(after.attention, 3);
        assert.equal(await page.title(), 'Interview availability for Software Engineer I');
        // Esc closes the reader; read, not Done, it stays in New without its dot until the visit ends.
        await page.keyboard.press('Escape');
        await until('the pane collapses', () => page.locator('.pane').count(), count => count === 0);
        assert.equal(await row(page, `new:${northwind}`).count(), 1);
        assert.equal(await isUnread(page, `new:${northwind}`), false);
        assert.equal(await page.title(), '(3) Inbox');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('a click opens and reads an FYI email, which keeps its place in New until the user leaves the Inbox', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const {signIn} = await ids(setpoint);
        await row(page, `new:${signIn}`).click();
        await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
        await until('the server read it', () => counts(setpoint), value => value.unread === 18 && value.unread_fyi === 10);
        if (await page.locator('.sb').isVisible()) {
          await until('Business drops to 6', () => sidebar(page, 'Business'), shown => shown?.unread === '18' && shown.account === '6' && shown.pill === '3');
        }
        // Read mail leaves New, but not while the user is in the Inbox (2026-10-09, #243): not from
        // under the reader, nor once it closes.
        await page.waitForTimeout(400);
        await setpoint.idle();
        assert.equal(await row(page, `new:${signIn}`).count(), 1);
        assert.equal(await isUnread(page, `new:${signIn}`), false);
        await page.keyboard.press('Escape');
        await until('the pane collapses', () => page.locator('.pane').count(), count => count === 0);
        // Nothing happens to wait for: the read row keeps its place.
        await page.waitForTimeout(400);
        await setpoint.idle();
        assert.equal(await row(page, `new:${signIn}`).count(), 1);
        // Trash it, and ⌘Z: back in its place, read, though New wouldn't take it now.
        await point(row(page, `new:${signIn}`));
        await page.keyboard.press('e');
        await until('trashed', () => row(page, `new:${signIn}`).count(), count => count === 0);
        await page.keyboard.press('Meta+z');
        await until('back from ⌘Z', () => row(page, `new:${signIn}`).count(), count => count === 1);
        assert.equal(await isUnread(page, `new:${signIn}`), false);
        await until('the toast goes with it', () => page.locator('.toast').count(), count => count === 0);
        // Settings is a modal over the list: opening and closing it keeps the visit.
        if (await page.locator('.sb').isVisible()) {
          await page.keyboard.press('Meta+Comma');
          await page.locator('.settings').waitFor();
          await page.keyboard.press('Escape');
          await until('Settings closes', () => page.locator('.settings').count(), count => count === 0);
          assert.equal(await row(page, `new:${signIn}`).count(), 1);
        }
        // Calendar (2), then back (1): a new visit, and it's in its day.
        await page.keyboard.press('2');
        await page.waitForURL(/\/calendar/);
        await page.keyboard.press('1');
        await until('it leaves New with the visit', () => row(page, `new:${signIn}`).count(), count => count === 0);
        await until('it\'s in its day', () => row(page, `all:${signIn}`).count(), count => count === 1);
        assert.equal(await page.locator('.list .lh', {hasText: 'FYI'}).first().textContent(), 'FYI 10');
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
        await row(page, `new:${google}`).click();
        await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
        await until('read', () => counts(setpoint), value => value.unread === 18);
        assert.equal((await counts(setpoint)).attention, 3);
        // H: Done. It leaves New's Attention and the pill drops; the next email, Northwind, opens and so
        // reads (2026-10-07: Done on the open email opens the next). The phone goes back to the
        // list instead, opening nothing (UX #12).
        const unread = size === 'iphone' ? 18 : 17;
        await page.keyboard.press('h');
        await until('it leaves New', () => row(page, `new:${google}`).count(), count => count === 0);
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

    test('Mark all as read reads everything outside Attention and Security (UX #4) and empties New; then Done empties Attention', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        await page.keyboard.press('Shift+I');
        // The server first: a refetch sent before the provider confirms can draw the list again
        // until the live stream's catches up.
        await until('the server read them', () => counts(setpoint).then(after => [after.attention, after.unread, after.unread_fyi].join()), value => value === '3,5,3');
        // New empties; Attention it left unread joins the Attention band (#243).
        const bands = () => page.locator('.list .gh:not(.day)').allTextContents().then(all => all.map(text => text.replace(/\s+/g, ' ').trim().split(' ')[0]!.toLowerCase()).join());
        await until('New goes', bands, value => value === 'attention,pinned', 5000);
        if (await page.locator('.sb').isVisible()) await until('the sidebar follows', () => sidebar(page), shown => shown?.pill === '3' && shown.unread === '5');
        // Attention keeps its read state: Google and Northwind are still unread.
        assert.equal(await page.locator('.list .row.unread[data-key^="attention:"]').count(), 2);
        // Done on each, from the keyboard: J to the first attention row, then H three times.
        await page.keyboard.press('j');
        for (let index = 0; index < 3; index += 1) {
          await page.keyboard.press('h');
          await until('one fewer', () => page.locator('.list .row[data-key^="attention:"]').count(), count => count === 2 - index);
        }
        // Security's codes and sign-in alerts are left unread, in their day: they're read by opening them.
        await until('Attention goes', bands, value => value === 'pinned');
        assert.equal(await page.locator('.list .row.unread:not(.done)').count(), 3);
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

test('Mark all as read leaves Security unread in its day at once, before All\'s next answer (UX #4, #243)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, 'target');
    // All's answers after Mark all as read wait, so the days show what the browser made of it.
    const gate = Promise.withResolvers<void>();
    let marked = false;
    await page.route(/\/api\/mail\/all(\?|$)/, async route => {
      if (marked) await gate.promise;
      await route.continue();
    });
    marked = true;
    await page.keyboard.press('Shift+I');
    await until('New goes', () => page.locator('.list .gh.new').count(), count => count === 0);
    // Security's codes and sign-in alerts, in their day, keep their dots.
    assert.equal(await page.locator('.list .row.unread:not(.done):not([data-key^="attention:"]):not([data-key^="pinned:"])').count(), 3);
    gate.resolve();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('mail read and Done elsewhere keeps its rows in New until the user leaves; then the list starts at the shelf (SV-25, #243)', async () => {
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
    // New keeps the rows it showed, read (DESIGN.md #20, #243).
    await until('the dots go', () => page.locator('.list .unread').count(), count => count === 0, 5000);
    // Nothing happens to wait for: New keeps the rows it showed.
    await page.waitForTimeout(400);
    await setpoint.idle();
    assert.ok(await page.locator('.list .row[data-key^="new:"]').count() > 0);
    // Leaving ends the visit: back, there's no New and no Attention, and no All caught up either.
    await page.keyboard.press('2');
    await page.locator('.cal-title').waitFor();
    await page.keyboard.press('1');
    await page.locator('.list .gh.day').first().waitFor();
    // The answers this browser had may show first; places settle once the fresh ones are in.
    await until('the shelf leads', () => page.locator('.list .gh:not(.day)').allTextContents(), bands => bands.join() === 'Pinned 1');
    assert.equal(await page.locator('.empty-line').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
