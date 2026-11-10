// The Inbox's views in the browser (SV-221, D471, D472), at the design target on a fresh seed each:
// All | Unread | Attention | FYI | Noise in the header, Tab and Shift-Tab stepping them; Unread's red
// badge and Attention's count; an email read in Unread staying there until the view changes; each
// view's part of the list; Mark all as read following the view; an empty view's drawing, quiet line and
// Show All (SV-226); and the sidebar's Inbox and 1 going back to All. The seed starts at 3 attention and 19 unread.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');
const views = (page: Page) => page.locator('.hd .ib-views button').allTextContents();
const on = (page: Page) => page.locator('.hd .ib-views button.on').textContent();
const viewOf = (page: Page) => new URL(page.url()).searchParams.get('view');
const rows = (page: Page) => page.locator('.list .row:not(.leaving)');

async function load(setpoint: Setpoint, path = '/inbox'): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}${path}`);
  await page.locator('.list .row, .list .view-empty').first().waitFor();
  return page;
}

test('the views: Unread\'s red badge and Attention\'s count, Tab and Shift-Tab stepping them; the sidebar is the badge alone and the title counts unread', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    assert.deepEqual(await views(page), ['All', 'Unread19', 'Attention3', 'FYI', 'Noise']);
    assert.equal(await on(page), 'All');
    // The sidebar's Inbox has the red badge and nothing else; the tab counts unread.
    assert.deepEqual(await page.locator('.nav:has-text("Inbox") .num').allTextContents(), ['19']);
    assert.equal(await page.locator('.nav:has-text("Inbox") .ubadge').count(), 1);
    await until('the title counts unread', () => page.title(), title => title === '(19) Inbox');
    // Tab steps to the next view; Shift-Tab goes back (the wrap is components/segmented.test.tsx's).
    for (const [key, view] of [['Tab', 'unread'], ['Shift+Tab', null]] as const) {
      await page.keyboard.press(key);
      await until(`${key} to ${view ?? 'all'}`, async () => viewOf(page), now => now === view);
    }
    assert.equal(await on(page), 'All');
    // 1 goes back to All; the sidebar's Inbox does from any view.
    await page.locator('.hd .ib-views button', {hasText: 'Noise'}).click();
    await until('Noise', async () => viewOf(page), now => now === 'noise');
    await page.keyboard.press('1');
    await until('1 opens All', async () => viewOf(page), now => now === null);
    await page.locator('.hd .ib-views button', {hasText: 'FYI'}).click();
    await until('FYI', async () => viewOf(page), now => now === 'fyi');
    await page.locator('.sb .nav', {hasText: 'Inbox'}).click();
    await until('the sidebar opens All', async () => viewOf(page), now => now === null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Unread: only unread mail, Noise in full and no shelf; an email read there stays, drawn read, until the view changes', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, '/inbox?view=unread');
    assert.equal(await on(page), 'Unread19');
    assert.equal(await page.locator('.list .row.shelf, .list .nfold, .list .gh.pinned').count(), 0, 'no shelf and no folded Noise');
    assert.ok(await page.locator('.list .row.noise').count() > 0, 'Noise in full');
    const shown = await rows(page).count();
    assert.equal(await page.locator('.list .row.unread').count(), shown, 'every row unread');
    // Read one: it stays, drawn read, and the badge counts one less.
    const first = page.locator('.list .row[data-key^="all:"]').first();
    const key = (await first.getAttribute('data-key'))!;
    await first.locator('.from').click();
    await until('read', () => counts(setpoint), value => value.unread === 18);
    await page.keyboard.press('Escape');
    const kept = page.locator(`.list [data-key="${key}"]`);
    await until('drawn read', () => kept.getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    assert.equal(await rows(page).count(), shown);
    await until('the badge follows', () => on(page), text => text === 'Unread18');
    // Away and back: it's gone.
    await page.keyboard.press('Tab');
    await until('Attention', async () => viewOf(page), now => now === 'attention');
    await page.keyboard.press('Shift+Tab');
    await until('Unread again', async () => viewOf(page), now => now === 'unread');
    await until('the read email left', () => kept.count(), count => count === 0);
    assert.equal(await rows(page).count(), shown - 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Attention, FYI and Noise each show their part; Mark all as read reads only FYI in FYI, and Attention has none', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, '/inbox?view=attention');
    assert.equal(await rows(page).count(), 3);
    assert.equal(await page.locator('.list .row:not([data-key^="attention:"])').count(), 0);
    assert.equal(await page.locator('.hd .mark-all').count(), 0, 'no Mark all as read in Attention');
    await page.keyboard.press('Shift+I');
    assert.equal((await counts(setpoint)).unread, 19, 'and ⇧I reads nothing');

    await page.keyboard.press('Tab');
    await until('FYI', async () => viewOf(page), now => now === 'fyi');
    assert.equal(await page.locator('.list .row.att, .list .row.noise, .list .lh').count(), 0, 'FYI alone, under its days and kinds');
    assert.ok(await page.locator('.list .kh').count() > 0);
    const before = await counts(setpoint);
    const button = page.locator('.hd .mark-all');
    assert.equal(await button.getAttribute('data-tip'), 'Mark FYI as read · ⇧I');
    await button.click();
    // Security keeps its three; the rest of FYI reads, and Noise and Attention don't.
    await until('FYI read but Security', () => counts(setpoint), value => value.unread_fyi === 3, 5000);
    assert.equal((await counts(setpoint)).unread, before.unread - (before.unread_fyi - 3));

    await page.keyboard.press('Tab');
    await until('Noise', async () => viewOf(page), now => now === 'noise');
    assert.ok(await rows(page).count() > 0);
    assert.equal(await page.locator('.list .row:not(.noise)').count(), 0, 'Noise alone');
    assert.equal(await page.locator('.list .nfold, .list .lh').count(), 0, 'in full, under the day alone');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an empty view draws its own picture and says so, and Show All goes to All', async () => {
  const setpoint = await startSetpoint();
  try {
    const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
    for (const one of inbox.groups.find(group => group.group === 'attention')!.rows) await setpoint.api('POST', `/mail/messages/${one.id}/done`, {done: true});
    const page = await load(setpoint, '/inbox?view=attention');
    assert.equal(await page.locator('.list .view-empty .ve-head').textContent(), 'Nothing needs you');
    assert.equal(await page.locator('.list .view-empty .ve-art').count(), 1);
    assert.equal(await rows(page).count(), 0);
    await page.locator('.list .view-empty .btn', {hasText: 'Show All'}).click();
    await until('All', async () => viewOf(page), now => now === null);
    assert.equal(new URL(page.url()).search, '');
    await rows(page).first().waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an empty Attention tells when the last one needing the user came, from the list, Done or not (SV-226)', async () => {
  const setpoint = await startSetpoint();
  try {
    const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
    for (const one of inbox.groups.find(group => group.group === 'attention')!.rows) await setpoint.api('POST', `/mail/messages/${one.id}/done`, {done: true});
    const page = await load(setpoint, '/inbox?view=attention');
    assert.equal(await page.locator('.list .view-empty .ve-head').textContent(), 'Nothing needs you');
    assert.equal(await page.locator('.list .view-empty .ve-quiet').textContent(), 'The last one came at 8:52 AM');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
