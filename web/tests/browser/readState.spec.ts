// The read-state rules in the browser (DESIGN.md › Interaction rules; BRIEF.md › Read state and
// Done), at 1677 × 1050 and an iPhone size, each on a fresh seed: an email turns read only when
// opened (Enter or a click) or by Mark all as read; moving the cursor, scrolling and opening a
// Noise line never read anything; the counts follow at once, opening dropping the unread counts
// and only Done dropping Attention's count. The seed starts at 3 attention and 19 unread. Reading
// never moves a row: unread mail sits in its day (SV-199, D449).
// A row's key says where it is: Attention ("attention:22") or its day ("all:5").
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, describe, drawn, point, readSecurity, SIZES, startSetpoint, test, until} from './harness.ts';
import type {Setpoint, SizeName} from './harness.ts';

after(cleanUp);

const sizes: SizeName[] = ['target', 'iphone'];

/** Attention's count on its segment and the sidebar's unread badge; null where the sidebar isn't shown (the phone). */
async function sidebar(page: Page): Promise<{attention: string; unread: string} | null> {
  if (!await page.locator('.sb').isVisible()) return null;
  const text = async (selector: string) => ((await page.locator(selector).count()) ? (await page.locator(selector).first().textContent()) ?? '' : '');
  return {attention: await text('.hd .ib-views .n'), unread: await text('.nav:has-text("Inbox") .ubadge')};
}

const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');
const row = (page: Page, key: string) => page.locator(`[data-key="${key}"]`);
const isUnread = async (page: Page, key: string) => (await row(page, key).getAttribute('class'))!.split(' ').includes('unread');
const cursorKey = (page: Page) => page.locator('.list .cur').first().getAttribute('data-key');
// The seed's today, whose Noise holds the Fall sale.
const TODAY_NOISE = 'noise:2026-10-07';
/** How many rows the list draws unread. */
const unreadRows = (page: Page) => page.locator('.list .row.unread:not(.done)').count();

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
        const unreadRows = await page.locator('.list .row.unread').count();
        // J and K move the keyboard cursor: a `sub2` fill, nothing opened. Attention's three, the
        // shelf's one, then Today's Security: six J and a K land on Security's first row, the code.
        for (let index = 0; index < 6; index += 1) await page.keyboard.press('j');
        await page.keyboard.press('k');
        assert.equal(await cursorKey(page), `all:${code}`);
        assert.equal(await page.locator('.pane:not(.idle)').count(), 0);
        // The pointer onto a row makes it the cursor.
        await point(row(page, `attention:${northwind}`));
        assert.equal(await cursorKey(page), `attention:${northwind}`);
        // Opening Today's Noise from the keyboard (its line is a cursor stop), closing it by a click,
        // and opening it again. Nothing reads on a scroll, so the check makes none (D416).
        await point(row(page, TODAY_NOISE));
        await page.keyboard.press('Enter');
        await page.locator('.row:has(b[data-tip^="Fall sale"])').waitFor();
        // The list's first Noise line is Today's.
        await page.locator('.list .nfold').first().click();
        await until('Noise folded', () => page.locator('.row:has(b[data-tip^="Fall sale"])').count(), count => count === 0);
        await page.locator('.list .nfold').first().click();
        await page.locator('.row:has(b[data-tip^="Fall sale"])').waitFor();
        // Nothing happens to wait for: opening Noise opens and reads nothing.
        await page.waitForTimeout(300);
        await setpoint.idle();

        assert.equal(await page.locator('.pane:not(.idle)').count(), 0, 'nothing opened');
        // Today's three Noise emails show now, unread too.
        assert.equal(await page.locator('.list .row.unread').count(), unreadRows + 3, 'every unread row is still unread');
        const after = await counts(setpoint);
        assert.deepEqual([after.attention, after.unread], [3, 19]);
        const shown = await sidebar(page);
        if (shown) assert.deepEqual([shown.attention, shown.unread], ['3', '19']);
        assert.equal(await page.title(), '(19) Inbox');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('Enter opens and reads; the unread counts drop at once and Attention\'s count stays', async () => {
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
          await until('the sidebar follows', () => sidebar(page), shown => shown?.unread === '18' && shown.attention === '3');
        }
        const after = await until('the server read it', () => counts(setpoint), value => value.unread === 18);
        assert.equal(after.attention, 3);
        assert.equal(await page.title(), 'Interview availability for Software Engineer I');
        // Esc closes the reader; read, not Done, it stays in Attention without its dot, with its ring.
        await page.keyboard.press('Escape');
        await until('the reader closes', () => page.locator('.pane:not(.idle)').count(), count => count === 0);
        assert.equal(await row(page, `attention:${northwind}`).count(), 1);
        assert.equal(await isUnread(page, `attention:${northwind}`), false);
        assert.equal(await page.title(), '(18) Inbox');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('a click opens and reads an FYI email, which keeps its place in its day, then and after leaving the Inbox (D449)', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const {signIn} = await ids(setpoint);
        const before = await unreadRows(page);
        await row(page, `all:${signIn}`).click();
        await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
        await until('the server read it', () => counts(setpoint), value => value.unread === 18 && value.unread_fyi === 10);
        if (await page.locator('.sb').isVisible()) {
          await until('the sidebar follows', () => sidebar(page), shown => shown?.unread === '18' && shown.attention === '3');
        }
        // One fewer row is drawn unread; the row stays, read, under the reader, once it closes, and
        // once the server's lists have it. A refetch asked now has the server's read.
        await until('one fewer drawn unread', () => unreadRows(page), now => now === before - 1);
        const refetched = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/mail/all');
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await drawn(page, await refetched);
        await setpoint.idle();
        assert.equal(await row(page, `all:${signIn}`).count(), 1);
        assert.equal(await isUnread(page, `all:${signIn}`), false);
        await page.keyboard.press('Escape');
        await until('the reader closes', () => page.locator('.pane:not(.idle)').count(), count => count === 0);
        assert.equal(await row(page, `all:${signIn}`).count(), 1);
        // Trash it, and ⌘Z: back in its place, read.
        await point(row(page, `all:${signIn}`));
        await page.keyboard.press('e');
        await until('trashed', () => row(page, `all:${signIn}`).count(), count => count === 0);
        await page.keyboard.press('Meta+z');
        await until('back from ⌘Z', () => row(page, `all:${signIn}`).count(), count => count === 1);
        assert.equal(await isUnread(page, `all:${signIn}`), false);
        await until('the toast goes with it', () => page.locator('.toast').count(), count => count === 0);
        // Calendar (2), then back (1): still in its day, read.
        await page.keyboard.press('2');
        await page.waitForURL(/\/calendar/);
        await page.keyboard.press('1');
        await until('it\'s in its day', () => row(page, `all:${signIn}`).count(), count => count === 1);
        assert.equal(await isUnread(page, `all:${signIn}`), false);
        assert.equal(await unreadRows(page), before - 1);
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('Attention\'s count drops only on Done', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const {google, exams} = await ids(setpoint);
        // Opening the protected email reads it; Attention's count stays.
        await row(page, `attention:${google}`).click();
        await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
        await until('read', () => counts(setpoint), value => value.unread === 18);
        assert.equal((await counts(setpoint)).attention, 3);
        // H: Done. It leaves Attention and its count drops; the next email, Northwind, opens and so
        // reads (2026-10-07: Done on the open email opens the next). The phone goes back to the
        // list instead, opening nothing (UX #12).
        const unread = size === 'iphone' ? 18 : 17;
        await page.keyboard.press('h');
        await until('it leaves Attention', () => row(page, `attention:${google}`).count(), count => count === 0);
        if (size !== 'iphone') await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
        if (await page.locator('.sb').isVisible()) await until('Attention\'s count drops to 2', () => sidebar(page), shown => shown?.attention === '2' && shown.unread === String(unread));
        await until('the server agrees', () => counts(setpoint), value => value.attention === 2 && value.unread === unread);
        if (size !== 'iphone') {
          assert.equal(await page.title(), 'Interview availability for Software Engineer I');
          await page.keyboard.press('Escape');
        }
        await until('the reader closes', () => page.locator('.pane:not(.idle)').count(), count => count === 0);
        assert.equal(await page.title(), `(${unread}) Inbox`);
        // Done from the row, without opening: Contoso University (read, not Done) leaves too.
        await point(row(page, `attention:${exams}`));
        await page.keyboard.press('h');
        await until('Contoso University leaves', () => row(page, `attention:${exams}`).count(), count => count === 0);
        await until('the server agrees', () => counts(setpoint), value => value.attention === 1 && value.unread === unread);
        assert.equal(await page.locator('.pane:not(.idle)').count(), 0, 'Done from the row opens nothing');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });

    test('Mark all as read reads everything outside Attention and Security (UX #4), every row in its place; then Done empties Attention', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await load(setpoint, size);
        const rows = await page.locator('.list .row').count();
        await page.keyboard.press('Shift+I');
        // The server first: a refetch sent before the provider confirms can draw the list again
        // until the live stream's catches up.
        await until('the server read them', () => counts(setpoint).then(after => [after.attention, after.unread, after.unread_fyi].join()), value => value === '3,5,3');
        // Attention's two unread and Security's three keep their dots; nothing moved.
        await until('the rest read', () => page.locator('.list .row.unread').count(), count => count === 5, 5000);
        assert.equal(await page.locator('.list .row').count(), rows);
        const bands = () => page.locator('.list .gh:not(.day)').allTextContents().then(all => all.map(text => text.replace(/\s+/g, ' ').trim().split(' ')[0]!.toLowerCase()).join());
        assert.equal(await bands(), 'attention,pinned');
        if (await page.locator('.sb').isVisible()) await until('the sidebar follows', () => sidebar(page), shown => shown?.attention === '3' && shown.unread === '5');
        if (size !== 'iphone') await until('Unread\'s badge follows', () => page.locator('.hd .ib-views .ubadge').textContent(), text => text === '5');
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
        assert.equal(await page.locator('.pane:not(.idle)').count(), 0);
        await until('the server agrees', () => counts(setpoint), value => value.attention === 0 && value.unread === 3);
        if (await page.locator('.sb').isVisible()) await until('the sidebar follows', () => sidebar(page), shown => shown?.attention === '' && shown.unread === '3');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });
  });
}

test('Mark all as read leaves Security unread in its day at once, before All\'s next answer (UX #4, D449)', async () => {
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
    // Security's codes and sign-in alerts, in their day, keep their dots; the rest of the days' read.
    const dayUnread = page.locator('.list .row.unread:not(.done):not([data-key^="attention:"]):not([data-key^="pinned:"])');
    await until('the days read but Security', () => dayUnread.count(), count => count === 3);
    gate.resolve();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('mail read and Done elsewhere shows as it comes: the dots go, Attention empties, and the list starts at the shelf (SV-25, D449)', async () => {
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
    // Nothing holds a row: the dots go and Attention empties as the lists come (D449). Done mail
    // can be unread still, and shows no dot (#241).
    await until('the dots go', () => page.locator('.list .row.unread:not(.done)').count(), count => count === 0, 5000);
    await until('the shelf leads', () => page.locator('.list .gh:not(.day)').allTextContents(), bands => bands.join() === 'Pinned 1', 5000);
    assert.equal(await page.locator('.ubadge').count(), 0, 'no badge counts unread mail');
    assert.equal(await page.locator('.view-empty').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-150: a change on its way keeps its count: counts asked meanwhile, from before the server has it, don\'t bring the old one back', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, 'target');
    const {google, exams} = await ids(setpoint);
    await setpoint.idle();
    // Each change is held on its way out, as a slow connection can, so the server hasn't got it when the counts are asked.
    const gate = Promise.withResolvers<void>();
    await page.route(/\/api\/mail\/messages\/\d+\/(done|open)$/, async route => {
      await gate.promise;
      await route.continue();
    });
    const askMeanwhile = async () => {
      const answered = page.waitForResponse(/\/api\/mail\/counts$/);
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      // The answer read whole and drawn, what the cache made of it on the page.
      await drawn(page, await answered);
    };
    // Done: the server still says 3 in Attention.
    await point(row(page, `attention:${exams}`));
    await page.keyboard.press('h');
    await until('Attention\'s count drops to 2', () => sidebar(page), shown => shown?.attention === '2');
    await askMeanwhile();
    assert.equal((await sidebar(page))?.attention, '2', 'Attention\'s count stays down while Done is on its way');
    // An open: the server still says 19 unread.
    await row(page, `attention:${google}`).click();
    await until('unread drops to 18', () => sidebar(page), shown => shown?.unread === '18');
    await askMeanwhile();
    assert.equal((await sidebar(page))?.unread, '18', 'unread stays down while the open is on its way');
    gate.resolve();
    await until('the server agrees', () => counts(setpoint), value => value.attention === 2 && value.unread === 18);
    await until('the sidebar agrees', () => sidebar(page), shown => shown?.attention === '2' && shown.unread === '18');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
