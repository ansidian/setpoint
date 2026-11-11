// Mail's details in the browser (BUILD-PLAN.md › F2), at the design target on a fresh seed each:
// Done or Trash on the open email opens the next (2026-10-07), each with Undo in the toast;
// pin and unpin; Mark all as read; copying a code, and a code leaving at its expiry; images hidden
// and Show / Always show; an attachment's preview; the pattern prompt's answer; the one list's parts
// and days (SV-70).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import {deepLinkPath} from '@setpoint/shared';
import type {AllOut, InboxOut, ItemsOut, MailCountsOut, MessageOut, TrustedDomainOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {UNDO_MS} from '../../src/app/toast.ts';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, drawn, holdToast, pauseClock, point, rested, startSetpoint, test, until, ZOOM} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** A token's colour as the page computes it, to compare with an element's. */
const tokenColour = (page: Page, token: string) => page.evaluate(name => {
  const probe = document.createElement('span');
  probe.style.color = `var(--${name})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

const GLYPH_NAMES = new Map<string, string>(Object.entries(ICONS).map(([name, path]) => [path, name]));
/** Each glyph's name (from its bundled path), size and colour. */
const glyphs = async (icons: Locator) => (await icons.evaluateAll(all => all.map(icon => [icon.querySelector('path')!.getAttribute('d')!, icon.getAttribute('width'), getComputedStyle(icon).color])))
  .map(([path, size, colour]) => [GLYPH_NAMES.get(path!) ?? 'unknown', size, colour]);

const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');
const attentionCount = (page: Page) => page.locator('.hd .ib-views .n').textContent();
const unreadCount = (page: Page) => page.locator('.nav:has-text("Inbox") .ubadge').textContent();

async function load(setpoint: Setpoint, path = '/inbox'): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}${path}`);
  await page.locator('.list .row').first().waitFor();
  return page;
}

/** An email's row in the list, by its text or its tooltip's (a subject a summary took the place of), not one folding away. */
const rowOf = (page: Page, text: string) => page.locator('.list .row[data-key]', {hasText: text}).or(page.locator(`.list .row[data-key]:has(b[data-tip*="${text}"])`));

/** Opens the first Noise line, Today's, folded until then (#48, D449). */
const openNoise = (page: Page) => page.locator('.list .nfold.collapsed').first().click();

async function idOf(setpoint: Setpoint, subjectStart: string): Promise<number> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  return all.days.flatMap(day => day.rows).find(row => row.subject.startsWith(subjectStart))!.id;
}

const inAll = async (setpoint: Setpoint, id: number) =>
  (await setpoint.api<AllOut>('GET', '/mail/all?limit=500')).days.some(day => day.rows.some(row => row.id === id));

test('SV-218: with nothing open the Inbox\'s pane says how the day is going; a Done elsewhere moves its numbers', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const pane = page.locator('section.pane.idle');
    const tiles = () => pane.locator('.md-tile').evaluateAll(all => all.map(tile => [tile.querySelector('dd')!.textContent, tile.querySelector('dt')!.textContent, tile.classList.contains('lit')]));
    await until('the day', () => pane.locator('.md-need').textContent(), text => text === '3 need you, 1 overdue');
    assert.deepEqual(await tiles(), [['0', 'Done today', false], ['8', 'Sorted to FYI', true], ['3', 'Sorted to Noise', true]]);
    assert.equal(await pane.locator('.pane-foot .md-kept').textContent(), '34 emails, 192 KB, since Mar 2026.');
    // Done from elsewhere (the phone) reaches the pane through the live stream.
    await setpoint.api('POST', `/mail/messages/${await idOf(setpoint, 'Your recovery email was changed')}/done`, {done: true});
    await until('one fewer needs the user', () => pane.locator('.md-need').textContent(), text => text === '2 need you, 1 overdue');
    assert.deepEqual((await tiles())[0], ['1', 'Done today', true]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Done on the open email opens the next, which reads it; Attention\'s count drops for the Done, and the email goes to its day', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // Google (protected, unread) open: 18 unread. Done opens Northwind, the next row, and reads it.
    await rowOf(page, 'Your recovery email was changed').click();
    await until('Google read', () => unreadCount(page), text => text === '18');
    await page.keyboard.press('h');
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await until('the unread count drops by one and Attention\'s by one', async () => [await attentionCount(page), await unreadCount(page)], ([shownPill, unread]) => shownPill === '2' && unread === '17');
    // The server has them once the browser's Done and open land, after the counts show them.
    await until('the server has them', () => counts(setpoint).then(value => [value.attention, value.unread].join()), value => value === '2,17');
    // Done on Northwind opens Contoso University's exams, the row after it in Attention, read already.
    await page.keyboard.press('h');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    // Its toast is held, so its Undo waits while the check reads the server.
    await holdToast(page);
    await until('Attention\'s count drops again', () => attentionCount(page), text => text === '1');
    assert.equal(await page.locator('.list .row.open', {hasText: 'Contoso University'}).count(), 1);
    // Northwind's row folds out of Attention (DESIGN.md › Decided while building #13) and settles in
    // its day, quiet, with a Done tag (#241, D449).
    await until('Northwind in its day, Done', () => rowOf(page, 'Pick a 30-minute slot').evaluate(row => [row.classList.contains('done'), row.querySelector('.tag')?.textContent]), ([done, tag]) => done === true && tag === 'Done');
    assert.match((await page.locator('.list .gh.day').first().textContent())!, /^Today Wed, Oct 7/);
    await until('the server has it', () => counts(setpoint).then(value => [value.attention, value.unread].join()), value => value === '1,17');
    // The toast offers Undo: Northwind comes back to Attention and to the reader.
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await page.locator('.list .row.open:not(.done)', {hasText: 'Northwind Talent'}).waitFor();
    await until('Attention\'s count comes back', () => attentionCount(page), text => text === '2');
    // Undo takes the toast away: it fades out over 120 ms, then goes.
    await page.locator('.toast').waitFor({state: 'detached'});
    // FYI mail has no Done (#93): opening it already read it. Fabrikam, in Career, opens with Trash
    // first in the tools, and H leaves it where it is, with no toast.
    await rowOf(page, 'Fabrikam').click();
    await page.locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.equal(await page.locator('.rd-tools .tool', {hasText: 'Done'}).count(), 0);
    assert.equal(await page.locator('.rd-tools .tool').first().textContent(), 'TrashE');
    await page.keyboard.press('h');
    // Nothing happens to wait for: H does nothing here.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await page.locator('.rd-subj', {hasText: 'Application received'}).count(), 1, 'H does nothing on FYI mail');
    assert.equal(await page.locator('.toast').count(), 0);
    // Done on Northwind opens Contoso University; Done on that, the last in the Attention band, opens
    // the Pinned shelf's lease, and the band goes.
    await rowOf(page, 'Pick a 30-minute slot').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await page.keyboard.press('h');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await page.keyboard.press('h');
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await until('the Attention band goes', () => page.locator('.list .gh.attention').count(), count => count === 0);
    // A Done email's reader says Done where the button was (SV-69).
    await rowOf(page, 'Pick a 30-minute slot').click();
    await until('the reader\'s Done', () => page.locator('.rd-tools .rd-done').textContent(), text => text === 'Done');
    assert.equal(await page.locator('.rd-tools .tool.done').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #2: with an email open, J and K open the next and previous email, so H, E and P act on what\'s highlighted', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await rowOf(page, 'Interview availability for Software Engineer I').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // J: the next in Attention, Contoso University's exams.
    await page.keyboard.press('j');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    // One row marked, the open one.
    assert.deepEqual(await page.locator('.list .cur, .list .open').allTextContents().then(rows => rows.length), 1);
    await page.keyboard.press('k');
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // E trashes the email that's open and highlighted.
    await page.keyboard.press('j');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    const exams = await idOf(setpoint, 'Final exam schedule');
    await page.keyboard.press('e');
    await until('the exams email is trashed', () => inAll(setpoint, exams), shown => !shown);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Trash opens the next email, and Undo brings the trashed one back to the reader', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // Each Trash the page sends, and below each the route holds: the server once had Consolidated Messenger's Trash
    // although its route was held (Thread A's timing report, seen once at 737333e and not since), so
    // a failure says which it was: sent before the route, sent past it, or never sent.
    const sent: string[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/trash')) sent.push(new URL(request.url()).pathname);
    });
    const signIn = await idOf(setpoint, 'Security alert');
    await page.locator('.row', {hasText: 'New sign-in'}).click();
    await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
    await page.keyboard.press('e');
    // The next row in Security (Access granted) opens.
    await page.locator('.rd-subj', {hasText: 'Claude was granted access'}).waitFor();
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    await holdToast(page);
    await until('trashed at the provider', () => inAll(setpoint, signIn), present => !present, 5000);
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
    await until('back from the trash', () => inAll(setpoint, signIn), present => present, 5000);
    await page.locator('.toast').waitFor({state: 'detached'});

    // Trash from the cursor row, no reader: nothing opens, and Undo is offered for 6 seconds.
    await page.keyboard.press('Escape');
    await until('the reader closes', () => page.locator('.pane:not(.idle)').count(), count => count === 0);
    const ups = await idOf(setpoint, 'Out for delivery');
    await point(page.locator('.row:has(b[data-tip="Out for delivery"])'));
    // The row leaves at once, before the server has the Trash (held here at its door).
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const heldAt: string[] = [];
    await page.route('**/api/mail/messages/*/trash', async route => {
      heldAt.push(new URL(route.request().url()).pathname);
      await held;
      await route.continue();
    });
    // The page's clock stops here, so the toast's 6 seconds are the check's, not the machine's.
    await pauseClock(page);
    await page.keyboard.press('e');
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    assert.equal(await page.locator('.pane:not(.idle)').count(), 0, 'Trash from the row opens nothing');
    // Its row, not the one folding away (it has no key).
    const upsRow = page.locator('.row[data-key]:has(b[data-tip="Out for delivery"])');
    await until('Consolidated Messenger leaves', () => upsRow.count(), count => count === 0);
    assert.equal(await inAll(setpoint, ups), true, `the server doesn't have it yet (Consolidated Messenger is ${ups}; sent ${JSON.stringify(sent)}, held ${JSON.stringify(heldAt)})`);
    release();
    await until('trashed at the provider', () => inAll(setpoint, ups), present => !present, 5000);
    await setpoint.idle();
    assert.equal(await upsRow.count(), 0, 'and it stays gone');
    const toast = page.locator('.toast:not(.leaving)', {hasText: 'Moved to Trash'});
    await page.clock.runFor(UNDO_MS - 1);
    assert.equal(await toast.count(), 1, 'Undo is still offered just short of 6 seconds');
    await page.clock.runFor(1);
    await until('the toast goes at 6 seconds', () => toast.count(), count => count === 0);
    assert.equal(await inAll(setpoint, ups), false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Undo right after Trash, before the server has the Trash, waits for it: the email comes back, with no error', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const ups = await idOf(setpoint, 'Out for delivery');
    await point(page.locator('.row:has(b[data-tip="Out for delivery"])'));
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route('**/api/mail/messages/*/trash', async route => {
      await held;
      await route.continue();
    });
    // Each answer to the untrash: refused only while the Trash still waits for its provider, and sent again after.
    const answers: string[] = [];
    page.on('response', async response => {
      if (response.url().endsWith('/untrash')) answers.push(response.ok() ? 'ok' : ((await response.json()) as {error: {code: string}}).error.code);
    });
    await page.keyboard.press('e');
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    // Back as a row of the list: the one folding away keeps its title but has no key.
    await page.locator('.row[data-key]:has(b[data-tip="Out for delivery"])').waitFor();
    release();
    const row = async () => (await setpoint.api<AllOut>('GET', '/mail/all?limit=500')).days.flatMap(day => day.rows).find(one => one.id === ups);
    // Two trips through the dev provider (600 ms each), the Trash's and the Undo's, and the wait between.
    await until('back from the trash at the provider', row, found => answers.includes('ok') && found !== undefined && !found.command, 10_000);
    assert.ok(answers.at(-1) === 'ok' && answers.slice(0, -1).every(code => code === 'command_pending'), `Undo goes once the Trash is in: ${answers.join(', ')}`);
    await setpoint.idle();
    assert.equal(await page.locator('.toast').count(), 0, 'no failure shows');
    await page.unroute('**/api/mail/messages/*/trash');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Pin and Unpin (D105): P on a day\'s row moves it to the shelf at once, Unpin under the pointer puts it back in its day, and the reader\'s P pins and unpins the open email', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const shelf = () => page.locator('.list.all .row.shelf .from').allTextContents();
    const bank = page.locator('.list.all .row', {hasText: 'Checking ending in 1234'});
    assert.deepEqual(await shelf(), ['Parkside Apartments']);
    await point(bank);
    // The server's answer is held, so the move is shown before the server has it.
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route('**/api/mail/messages/*/pin', async route => {
      await held;
      await route.continue();
    });
    await page.keyboard.press('p');
    await until('Woodgrove Bank leads the shelf', () => shelf(), rows => rows.join() === 'Woodgrove Bank,Parkside Apartments');
    assert.equal(await page.locator('.list.all .gh.pinned').textContent(), 'Pinned 2');
    await until('it leaves its day', () => page.locator('.list.all .row:not(.shelf)', {hasText: 'Checking ending in 1234'}).count(), count => count === 0);
    release();
    const id = await idOf(setpoint, 'Statement ready');
    await until('the server pinned it', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => message.pinned);
    await page.unroute('**/api/mail/messages/*/pin');
    // Unpin under the pointer puts it back in its day, unread as it still is, and opens nothing.
    const pinned = page.locator('.list.all .row.shelf', {hasText: 'Checking ending in 1234'});
    await pinned.hover();
    await pinned.locator('.unpin').click();
    await until('it leaves the shelf', () => shelf(), rows => rows.join() === 'Parkside Apartments');
    await until('back in its day', () => page.locator('.list.all .row.unread:not(.shelf)[data-key^="all:"]', {hasText: 'Checking ending in 1234'}).count(), count => count === 1);
    await until('the server unpinned it', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => !message.pinned);
    assert.equal(await page.locator('.rd-subj').count(), 0, 'unpinning from the shelf opens nothing');
    // The reader's P pins the open email, and P again unpins it.
    await rowOf(page, 'Pick a 30-minute slot').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await page.keyboard.press('p');
    await until('Northwind joins the shelf', () => shelf(), rows => rows.length === 2);
    await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).waitFor();
    await page.keyboard.press('p');
    await until('it leaves the shelf', () => shelf(), rows => rows.length === 1);
    await page.locator('.rd-tools .tool:not(.active)', {hasText: 'Pin'}).waitFor();
    await until('the server unpinned it', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), inbox => !inbox.groups.some(group => group.rows.some(row => row.pinned && row.subject.startsWith('Interview availability'))));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-252: a code email due for the trash at its expiry keeps the row\'s one countdown, the reader says "Trash when the code expires"; P takes it away and Unpin before expiry puts it back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Your code is 482913');
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      // As triage arms new mail with a code (the seed's codes are from before SV-252).
      database.prepare('UPDATE messages SET code_trash = 1, trash_due_at = code_expires_at WHERE id = ?').run(id);
    } finally {
      database.close();
    }
    const page = await load(setpoint);
    const row = page.locator(`.list.all .row[data-id="${id}"]:not(.shelf)`);
    await row.waitFor();
    assert.equal(await row.locator('.trash-in').count(), 0);
    // The sender, clear of the code's Copy in the row's middle.
    await row.locator('.from').click();
    await page.locator('.rd-subj', {hasText: 'Your code is 482913'}).waitFor();
    assert.equal(await page.locator('.rd-meta .rd-right .trash-in').textContent(), 'Trash when the code expires');
    await page.keyboard.press('p');
    await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).waitFor();
    assert.equal(await page.locator('.rd-meta .trash-in').count(), 0);
    await until('the server spared it', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => message.pinned && message.trash_due_at === null);
    await page.keyboard.press('p');
    await page.locator('.rd-meta .rd-right .trash-in', {hasText: 'Trash when the code expires'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-237: a rule\'s waiting trash shows as auto_delete and "22 h" on the row and "Trash in 22 h" under the reader\'s time; P takes both away at once, and the server forgets it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Out for delivery');
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      database.prepare('UPDATE messages SET trash_due_at = ? WHERE id = ?').run('2026-10-08T14:02:00.000Z', id);
    } finally {
      database.close();
    }
    const page = await load(setpoint);
    const row = page.locator(`.list.all .row[data-id="${id}"]:not(.shelf)`);
    assert.equal(await row.locator('.trash-in').textContent(), '22 h');
    assert.equal(await row.locator('.trash-in').getAttribute('data-tip'), 'Trash in 22 h');
    assert.deepEqual((await glyphs(row.locator('.trash-in .icon'))).map(([name]) => name), ['auto_delete']);
    // A row with none shows none.
    assert.equal(await page.locator('.list.all .row .trash-in').count(), 1);
    await row.click();
    await page.locator('.rd-subj', {hasText: 'Out for delivery'}).waitFor();
    assert.equal(await page.locator('.rd-meta .rd-right .trash-in').textContent(), 'Trash in 22 h');
    await page.keyboard.press('p');
    await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).waitFor();
    assert.equal(await page.locator('.rd-meta .trash-in').count(), 0);
    // The day's copy leaving for the shelf isn't the email's row any more.
    assert.equal(await page.locator('.list.all .row:not(.leaving) .trash-in').count(), 0);
    await until('the server forgot it', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => message.pinned && message.trash_due_at === null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('P on an email just opened: the open\'s answer, arriving after the pin\'s, doesn\'t unpin it on screen', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // The server answers the open at once, but that answer reaches the browser only after the pin's,
    // as answers on separate connections can.
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    let served = false;
    await page.route('**/api/mail/messages/*/open', async route => {
      const response = await route.fetch();
      served = true;
      await held;
      await route.fulfill({response});
    });
    await rowOf(page, 'Pick a 30-minute slot').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await until('the server answered the open', async () => served, done => done);
    const pinned = page.waitForResponse(/\/pin$/);
    await page.keyboard.press('p');
    await pinned;
    await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).waitFor();
    const delivered = page.waitForResponse(/\/open$/);
    release();
    await delivered;
    await setpoint.idle();
    assert.equal(await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).count(), 1, 'still pinned on screen');
    // So P unpins it.
    await page.keyboard.press('p');
    await until('the server unpinned it', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), inbox => !inbox.groups.some(group => group.rows.some(row => row.pinned && row.subject.startsWith('Interview availability'))));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-80: P then P again before the pin is answered: one pin change at a time, the last asked is what the server keeps, and it never shows pinned again', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // Each pin change's answer is held, as a slow connection can; what's sent and answered is noted in order.
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const seen: string[] = [];
    await page.route('**/api/mail/messages/*/pin', async route => {
      const {pinned} = route.request().postDataJSON() as {pinned: boolean};
      const gate = gates[seen.filter(one => one.startsWith('send')).length];
      seen.push(`send ${pinned}`);
      await gate?.promise;
      const response = await route.fetch();
      seen.push(`answer ${pinned}`);
      await route.fulfill({response});
    });
    // The shelf's rows, not one folding away (it has no key).
    const shelf = () => page.locator('.row.shelf[data-key]').count();
    await rowOf(page, 'Pick a 30-minute slot').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await page.keyboard.press('p');
    await until('the pin is on its way', async () => seen, list => list.length === 1);
    await page.keyboard.press('p');
    await until('off the shelf at once', shelf, count => count === 1);
    // Nothing more goes out while the pin waits: a second change sent now could reach the server first.
    await page.waitForTimeout(300);
    assert.deepEqual(seen, ['send true'], 'the unpin waits for the pin\'s answer');
    // The pin lands, and the lists load again while the unpin is still on its way: the server says
    // pinned then, but the screen keeps what was last asked.
    const reloaded = page.waitForResponse(/\/api\/mail\/inbox$/);
    gates[0]!.resolve();
    await until('the unpin follows the pin', async () => seen, list => list.length === 3);
    assert.deepEqual(seen, ['send true', 'answer true', 'send false']);
    // The answer is in, read whole and drawn as the cache made it.
    await drawn(page, await reloaded);
    assert.equal(await shelf(), 1, 'not back on the shelf while the unpin is on its way');
    assert.equal(await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).count(), 0, 'the reader still says Pin');
    gates[1]!.resolve();
    await until('the unpin answered', async () => seen, list => list.length === 4);
    await until('the server keeps it unpinned', () => setpoint.api<InboxOut>('GET', '/mail/inbox'),
      inbox => !inbox.groups.some(group => group.rows.some(row => row.pinned && row.subject.startsWith('Interview availability'))));
    await setpoint.idle();
    assert.equal(await shelf(), 1);
    await page.locator('.rd-tools .tool:not(.active)', {hasText: 'Pin'}).waitFor();
    // No "Pinned" toast for a pin taken back before it was answered.
    assert.equal(await page.locator('.toast', {hasText: 'Pinned'}).count(), 0);
    await page.unroute('**/api/mail/messages/*/pin');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('P on an email still loading: its first answer, from before the pin, doesn\'t unpin it on screen', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // The server answers the email's first load before the pin, but the browser has that answer only
    // after the pin is made and before any other answer about the email: the open's, the pin's and
    // the loads after the first wait until the end.
    const first = Promise.withResolvers<void>();
    const end = Promise.withResolvers<void>();
    let loads = 0;
    let served = false;
    let pinServed = false;
    await page.route(/\/api\/mail\/messages\/\d+$/, async route => {
      const gate = loads++ ? end : first;
      const response = await route.fetch();
      served = true;
      await gate.promise;
      await route.fulfill({response});
    });
    await page.route(/\/api\/mail\/messages\/\d+\/(open|pin)$/, async route => {
      if (pinServed) return route.continue();
      const response = await route.fetch();
      if (route.request().url().endsWith('/pin')) pinServed = true;
      await end.promise;
      await route.fulfill({response});
    });
    await rowOf(page, 'Pick a 30-minute slot').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await until('the server answered the load', async () => served, done => done);
    await page.keyboard.press('p');
    await until('the server pinned it', async () => pinServed, done => done);
    await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).waitFor();
    const delivered = page.waitForResponse(/\/messages\/\d+$/);
    first.resolve();
    await delivered;
    await page.locator('.rd-body:not(:has(.sk-body))').waitFor();
    assert.equal(await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).count(), 1, 'still pinned on screen');
    // So P unpins it, at once on screen; the unpin goes once the pin is answered (SV-80).
    await page.keyboard.press('p');
    await page.locator('.rd-tools .tool:not(.active)', {hasText: 'Pin'}).waitFor();
    end.resolve();
    await until('the server unpinned it', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), inbox => !inbox.groups.some(group => group.rows.some(row => row.pinned && row.subject.startsWith('Interview availability'))));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Whether the shelf is in sight is inSight's, a table in inbox.test.ts.
test('inbox-09: a pin out of the shelf\'s sight says so, with Undo, and lands on the shelf', async () => {
  const setpoint = await startSetpoint();
  try {
    // A short window, so the shelf starts below Attention's three rows, out of sight, with nothing scrolled.
    const page = await setpoint.page({width: 1677, height: 220});
    await page.goto(`${setpoint.base}/inbox`);
    // P on Contoso University, the last in Attention: the toast says Pinned, with Undo; the row leaves
    // Attention for the shelf (D105, D449).
    const exams = page.locator('.row:not(.shelf):has(b[data-tip^="Final exam schedule"])');
    await point(exams);
    await page.keyboard.press('p');
    const toast = page.locator('.toast.pinned', {hasText: 'Pinned'});
    await toast.waitFor();
    await page.locator('.row.shelf:has(b[data-tip^="Final exam schedule"])').waitFor();
    await until('it left Attention', () => exams.count(), count => count === 0);
    // Undo unpins it, back in Attention, and the toast goes.
    await toast.getByRole('button', {name: 'Undo'}).click();
    await until('back in Attention', () => exams.count(), count => count === 1);
    await until('the toast gone', () => page.locator('.toast').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a key pressed as soon as the hover has moved the cursor acts on the row under the pointer', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const northwind = rowOf(page, 'Pick a 30-minute slot');
    // H goes in the same moment the row is drawn as the cursor, before anything after that render.
    await northwind.evaluate(row => {
      new MutationObserver((_, observer) => {
        if (!row.classList.contains('cur')) return;
        observer.disconnect();
        document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'h', bubbles: true, cancelable: true}));
      }).observe(row, {attributes: true, attributeFilter: ['class']});
    });
    await northwind.hover();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await until('Northwind Done, in its day', () => northwind.getAttribute('class'), classes => Boolean(classes?.split(' ').includes('done')));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark all as read from the header: everything outside Attention and Security reads, Noise included (UX #4, D449)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    assert.equal(await page.locator('.hd .ib-views .ubadge').textContent(), '19');
    await page.locator('.hd .mark-all', {hasText: 'Mark all as read'}).click();
    await until('only Attention\'s two unread and Security\'s three remain', () => unreadCount(page), text => text === '5', 5000);
    await until('Unread\'s badge says so', () => page.locator('.hd .ib-views .ubadge').textContent(), text => text === '5');
    // The screen shows it at once; the server follows.
    await until('the server agrees', () => counts(setpoint).then(value => [value.attention, value.unread, value.unread_fyi].join()), value => value === '3,5,3', 5000);
    // Every row stays where it was: Security's codes and alerts unread in their day, Attention's in its band.
    await until('Security stays unread, in its day', () => page.locator('.list .row.unread[data-key^="all:"]', {hasText: 'Contoso Insurance'}).count(), count => count === 1);
    assert.equal(await page.locator('.list .gh.attention').textContent(), 'Attention 3');
    assert.equal(await page.locator('.list .row.unread[data-key^="attention:"]').count(), 2);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark all as read says how many it read; Undo brings the dots back at once, before the server\'s lists have them, and ⌘Z undoes it too; ⌘K\'s and ⇧I run the same; the header\'s button goes with nothing left to mark (SV-25, SV-37)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const button = page.locator('.hd .mark-all', {hasText: 'Mark all as read'});
    await button.waitFor();
    const unreadRows = page.locator('.list .row.unread:not(.done)');
    const before = await unreadRows.count();
    // ⌘K's Mark all as read is the Inbox's own, as ⇧I is: the toast counts what it read.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('mark all');
    await page.keyboard.press('Enter');
    await page.locator('.toast', {hasText: 'Marked 14 as read'}).waitFor();
    await holdToast(page);
    await until('the server read them', () => counts(setpoint).then(value => [value.attention, value.unread].join()), value => value === '3,5', 5000);
    // Attention's two and Security's three keep their dots, which Mark all as read doesn't touch: no button.
    await until('the dots go', () => unreadRows.count(), count => count === 5);
    await until('the button goes', () => button.count(), count => count === 0);

    // Undo, with the server's lists answering only once released: the dots come back at once.
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    // Once released the route only passes the lists on, so it stays to the check's end: removing it
    // turns the browser's interception off, which can strand whatever /api request is crossing it
    // (SV-261). Its pages close at the end, maybe while it passes one on.
    const lists = /\/api\/mail\/(inbox|all)(\?|$)/;
    await page.route(lists, async route => {
      await held;
      await route.continue().catch(() => undefined);
    });
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await until('the dots are back at once', () => unreadRows.count(), count => count === before);
    // Once the server has them unread and their changes are with the provider, ⇧I reads the same 14.
    await until('the server has them unread', () => counts(setpoint).then(value => value.unread), value => value === 19, 15000);
    await until('their changes are in', () => setpoint.api<AllOut>('GET', '/mail/all?limit=500'),
      all => !all.days.some(day => day.rows.some(row => row.command?.state === 'pending')), 5000);
    await page.keyboard.press('Shift+I');
    await page.locator('.toast', {hasText: 'Marked 14 as read'}).waitFor();
    await holdToast(page);
    await until('the dots go again', () => unreadRows.count(), count => count === 5);
    release();
    await until('the server read them again', () => counts(setpoint).then(value => value.unread), value => value === 5, 5000);
    await setpoint.idle();
    assert.equal(await unreadRows.count(), 5, 'the lists agree');

    // ⌘Z undoes it as the toast's Undo does, taking the toast away, and the button comes back.
    await page.keyboard.press('Meta+z');
    await until('unread again', () => counts(setpoint).then(value => value.unread), value => value === 19, 15000);
    await page.locator('.toast').waitFor({state: 'detached'});
    await button.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a code row: Copy puts the code on the clipboard and reads its email in place, or says it couldn\'t; at its expiry the code turns to its subject\'s text, the row staying in its day (SV-159)', async () => {
  // The fixture's code expires 12 seconds after the seed's moment. The server's clock stays there and
  // the page's is the check's, so a slow start or a busy machine can't spend those seconds first.
  const setpoint = await startSetpoint({fixtures: ['code-expiring'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // The page took the seed's moment from the server before this, so the code expires no later
    // than 12 seconds from here (and the app's 15 s clock first ticks later than that).
    const loaded = await page.evaluate(() => Date.now());
    // Stopped at about the time read, however long that read took.
    await pauseClock(page);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    // Today's live code row; Contoso Insurance's other email is in an earlier day, its code long gone.
    const row = page.locator('.list .row', {has: page.locator('.code-line')});
    assert.equal(await row.locator('.code').textContent(), '482 913');
    const id = await row.getAttribute('data-id');
    const message = () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`);
    assert.match((await row.getAttribute('class'))!, /\bunread\b/);
    const before = await counts(setpoint);
    await row.locator('button', {hasText: 'Copy'}).click();
    await row.locator('button', {hasText: 'Copied'}).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '482913');
    // Read where it is, Attention's count as it was, nothing opened, and no Marked as read toast.
    await until('read', message, shown => !shown.unread);
    await until('its class', () => row.getAttribute('class'), classes => !/\bunread\b/.test(classes!));
    await until('the count follows', () => unreadCount(page), text => text === String(before.unread - 1));
    assert.equal((await counts(setpoint)).attention, before.attention, 'Attention\'s count doesn\'t move');
    assert.equal(await page.locator('.pane:not(.idle)').count(), 0, 'Copy doesn\'t open the email');
    assert.equal(await page.locator('.toast').count(), 0, 'Copied says it');
    // "Copied" for a second and a half.
    await page.clock.runFor(1500);
    await row.locator('button', {hasText: 'Copy'}).waitFor();
    // A clipboard that refuses the code says so (#41), and the button stays Copy.
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
    });
    await row.locator('button', {hasText: 'Copy'}).click();
    await page.locator('.toast', {hasText: 'Couldn\'t copy it'}).waitFor();
    assert.equal(await row.locator('.copy').textContent(), 'Copy');
    // At its expiry Copy and the countdown go, without a reload, and not up to 15 s later on the app's
    // clock; its last minute counts down in seconds (inbox-11). The row stays in its day (D449).
    const countdown = row.locator('.sum');
    const seconds = Number(/^Expires in (\d+) sec$/.exec((await countdown.textContent())!)?.[1]);
    assert.ok(seconds > 0 && seconds <= 12, `${seconds} seconds left`);
    // A second later it reads one less.
    await page.clock.runFor(1000);
    await until('a second less', () => countdown.textContent(), text => text === `Expires in ${seconds - 1} sec`);
    // When it expires is codeExpired's, a table in inbox.test.ts; its fold out is by eye (D416).
    await page.clock.runFor(loaded + 12_000 + 400 - await page.evaluate(() => Date.now()));
    await page.clock.resume();
    await until('Copy gone', () => row.count(), count => count === 0);
    assert.equal(await page.locator(`.list .row[data-key="all:${id}"] .subj .code`).count(), 1, 'the code in its subject, in its day');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an email read earlier shows again at once, the window\'s focus between: its own answers and its frame\'s held', async () => {
  const setpoint = await startSetpoint({fixtures: ['coffee-html']});
  try {
    const page = await load(setpoint);
    const coffee = await idOf(setpoint, 'The Contoso Coffee Journal');
    const box = page.locator('.mailframe-box');
    await openNoise(page);
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    await page.frameLocator('iframe.mailframe').locator('table').waitFor();
    await until('the frame has its height', () => box.getAttribute('class'), name => name === 'mailframe-box');
    await rowOf(page, 'Pick a 30-minute slot').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // Back from another window: what's on screen refreshes, what isn't keeps its answer.
    const refetched = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/mail/inbox');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await drawn(page, await refetched);
    const gate = Promise.withResolvers<void>();
    await page.route(new RegExp(`/api/mail/messages/${coffee}(/body.*|/open)?$`), async route => {
      await gate.promise;
      await route.continue().catch(() => undefined);
    });
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    // The body shows only once the email is in, so with its answer held this is the one kept.
    await box.waitFor();
    assert.equal(await box.getAttribute('class'), 'mailframe-box');
    gate.resolve();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('images hidden: Show loads them this time; Always show trusts the domain', async () => {
  const setpoint = await startSetpoint({fixtures: ['coffee-html']});
  try {
    const page = await load(setpoint);
    // The images' host, faked in the check: nothing reaches the network, but a request that gets
    // this far would have loaded.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
    await page.context().route('https://cdn.contosocoffee.example/**', route => route.fulfill({contentType: 'image/png', body: png}));
    // Every request that leaves 127.0.0.1 (requests to the fake host included).
    const elsewhere: string[] = [];
    page.on('request', request => {
      if (!request.url().startsWith(setpoint.base) && !/^(data|blob|about):/.test(request.url())) elsewhere.push(request.url());
    });
    const frame = page.frameLocator('iframe.mailframe');
    // Show swaps the frame for one with the images, so a look can catch the old one leaving.
    const loadedImages = () => frame.locator('img').evaluateAll(images => images.filter(image => (image as HTMLImageElement).naturalWidth > 0).length).catch(() => -1);
    const openCoffee = async () => {
      // It's in Today's Noise, folded until opened.
      if (!await page.locator('.row', {hasText: 'Contoso Coffee'}).isVisible()) await openNoise(page);
      await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
      await page.locator('.rd-subj', {hasText: 'The Contoso Coffee Journal'}).waitFor();
      await frame.locator('table').waitFor();
    };
    await openCoffee();
    // Noise, sender not authenticated: hidden, with placeholders and the bar.
    await page.locator('.imgbar', {hasText: 'Images hidden'}).waitFor();
    assert.equal(await frame.locator('img').count(), 0);
    assert.equal(await frame.locator('[data-hidden-image]').count(), 7);
    assert.equal(await frame.locator('[data-hidden-image]').first().textContent(), 'Contoso Coffee');
    // The frame is sandboxed (no origin of its own, and no scripts but the measuring script its
    // policy names) and loads the body page by src.
    const element = page.locator('iframe.mailframe');
    assert.equal(await element.getAttribute('sandbox'), 'allow-scripts allow-popups allow-popups-to-escape-sandbox');
    assert.match((await element.getAttribute('src'))!, /^\/api\/mail\/messages\/\d+\/body\?images=hide$/);
    // Hidden, nothing has left 127.0.0.1.
    await page.waitForTimeout(300);
    assert.equal(elsewhere.length, 0, elsewhere.join(' '));

    await page.locator('.imgbar').getByRole('button', {name: 'Show', exact: true}).click();
    await until('the images load from their host', loadedImages, count => count === 7);
    assert.match((await frame.locator('img').first().getAttribute('src'))!, /^https:\/\/cdn\.contosocoffee\.example\//);
    assert.match((await element.getAttribute('src'))!, /\/body\?images=show$/);
    assert.equal(await page.locator('.imgbar').count(), 0);
    assert.ok(elsewhere.length > 0 && elsewhere.every(url => url.startsWith('https://cdn.contosocoffee.example/')), 'only the images\' host');
    elsewhere.length = 0;

    // Show was for this time: opened again (still in its day, read), they're hidden again.
    await page.keyboard.press('Escape');
    await until('the reader closes', () => page.locator('.pane:not(.idle)').count(), count => count === 0);
    await page.locator('.list.all .row', {hasText: 'Contoso Coffee'}).click();
    await page.locator('.imgbar', {hasText: 'Images hidden'}).waitFor();
    await frame.locator('[data-hidden-image]').first().waitFor();
    assert.equal(await frame.locator('img').count(), 0);
    assert.equal(elsewhere.length, 0, `hidden again, nothing leaves: ${elsewhere.join(' ')}`);

    await page.locator('.imgbar .lnk', {hasText: 'Always show from contosocoffee.example'}).click();
    await until('the images load', loadedImages, count => count === 7, 5000);
    const trusted = await setpoint.api<TrustedDomainOut[]>('GET', '/mail/trusted-domains');
    assert.deepEqual(trusted.map(item => item.domain), ['contosocoffee.example']);
    assert.equal(await page.locator('.imgbar').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// A picture as big as its name says, from the newsletter's faked host.
const PICTURE_SIZES: Record<string, [number, number]> = {masthead: [602, 260], harvest: [602, 400], roasting: [602, 400], social: [32, 32]};
async function fakePictures(page: Page) {
  await page.context().route('https://files.mailing.example/**', route => {
    const [width, height] = PICTURE_SIZES[/\/(\w+)\.png$/.exec(route.request().url())![1]!]!;
    return route.fulfill({contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#7a5"/></svg>`});
  });
}

/**
 * How the email sits in its frame: what overflows the frame's viewport across and down (0 when
 * nothing scrolls inside it), and how far the email's lowest box is from the frame's bottom (a zoomed
 * email ends on a fraction of a pixel, which the frame rounds up).
 */
const fit = (page: Page) => page.frameLocator('iframe.mailframe').locator('html').evaluate(root => {
  const end = root.querySelector('setpoint-end');
  // The email ends at the marker after it, or lower, at a box held out of the page's flow (SV-228).
  const bottom = Math.max(...[end, ...document.body.children].map(box => box?.getBoundingClientRect().bottom ?? -Infinity));
  return [root.scrollWidth - innerWidth, root.scrollHeight - innerHeight, end ? Math.round(innerHeight - bottom) : -1];
}).catch(() => [-1, -1, -1]);
const fits = ([across, down, below]: number[]) => across === 0 && down === 0 && (below === 0 || below === 1);
const picturesLoaded = (page: Page) => page.frameLocator('iframe.mailframe').locator('img')
  .evaluateAll(images => images.filter(image => (image as HTMLImageElement).naturalWidth > 0).length).catch(() => -1);

test('reader-10: a newsletter whose images give only their width keeps its shape while they\'re hidden', async () => {
  const setpoint = await startSetpoint({fixtures: ['newsletter-html']});
  try {
    const page = await load(setpoint);
    await openNoise(page);
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    await page.locator('.imgbar', {hasText: 'Images hidden'}).waitFor();
    // Three 602-wide pictures at 150 each, their padding and the footer: never the ~100 px band it was.
    await until('the frame holds the newsletter', () => page.locator('.mailframe').evaluate(frame => frame.getBoundingClientRect().height), height => height > 450);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a newsletter that is mostly pictures: the frame grows to the whole email, with no scrollbars of its own', async () => {
  const setpoint = await startSetpoint({fixtures: ['newsletter-html']});
  try {
    const page = await load(setpoint);
    await fakePictures(page);
    const element = page.locator('iframe.mailframe');
    await openNoise(page);
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    await page.locator('.imgbar', {hasText: 'Images hidden'}).waitFor();
    // Hidden, the frame is exactly as tall as the email. How wide the frame and its card are (#254) is
    // by eye (D417).
    await until('the hidden newsletter fits its frame', () => fit(page), fits);

    await page.locator('.imgbar').getByRole('button', {name: 'Show', exact: true}).click();
    await until('the pictures load', () => picturesLoaded(page), count => count === 4);
    // Shown, the frame grows with the pictures: over a thousand pixels, not a short box with its
    // own scrollbars.
    await until('the newsletter fits its frame', () => fit(page), fits);
    const shown = (await rested(() => element.boundingBox()))!;
    assert.ok(shown.height > 1000, `the frame is ${shown.height} px tall`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone, a newsletter wider than the screen is zoomed to fit it, as tall as it then is', async () => {
  const setpoint = await startSetpoint({fixtures: ['newsletter-html']});
  try {
    const page = await setpoint.page('iphone');
    await fakePictures(page);
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id: await idOf(setpoint, 'The Contoso Coffee Journal')})}`);
    await page.locator('.imgbar').getByRole('button', {name: 'Show', exact: true}).tap();
    await until('the pictures load', () => picturesLoaded(page), count => count === 4);
    await until('the newsletter fits its frame', () => fit(page), fits);
    const frame = (await rested(() => page.locator('iframe.mailframe').boundingBox()))!;
    assert.equal(frame.width, 350);
    // 622 px zoomed into 350: the pictures' 1060 px come to under 600, and the frame follows.
    assert.ok(frame.height > 550 && frame.height < 750, `the frame is ${frame.height} px tall`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** Waits for the stitched notice to fit its frame; says what sits where, in the page's order. */
async function stitchedNotice(page: Page) {
  const frame = page.frameLocator('iframe.mailframe');
  await frame.getByText('please don\'t reply').waitFor();
  await until('the notice fits its frame', () => fit(page), fits);
  const box = (await rested(() => page.locator('iframe.mailframe').boundingBox()))!;
  const top = (text: string) => rested(() => frame.getByText(text, {exact: true}).boundingBox());
  return {box, tops: [(await top('Woodgrove Bank'))!.y, (await top('Your statement is ready'))!.y, (await top('This mailbox isn\'t read, so please don\'t reply to this email.'))!.y]};
}

test('an email of three whole documents shows all three, in order, as tall as they are (SV-127)', async () => {
  const setpoint = await startSetpoint({fixtures: ['stitched-html']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id: await idOf(setpoint, 'Statement ready')})}`);
    const {box, tops} = await stitchedNotice(page);
    assert.deepEqual([...tops].sort((a, b) => a - b), tops);
    // The first document alone is 240 px, where the frame used to end.
    assert.ok(box.height > 400, `the frame is ${box.height} px tall`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** Opens an email and waits for it to fit its frame; says the frame's box and where each line sits in the page. */
async function fitted(page: Page, setpoint: Setpoint, subject: string, lines: string[]) {
  await page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id: await idOf(setpoint, subject)})}`);
  const frame = page.frameLocator('iframe.mailframe');
  await frame.getByText(lines.at(-1)!).waitFor();
  await until(`${subject} fits its frame`, () => fit(page), fits);
  const box = (await rested(() => page.locator('iframe.mailframe').boundingBox()))!;
  const boxes = await Promise.all(lines.map(line => rested(() => frame.getByText(line).boundingBox())));
  return {box, boxes: boxes.map(line => line!)};
}

const INVITE_LINES = ['Join us on Oct 15', 'Questions from the audience', 'Manage your email preferences'];
const NOTICE_LINES = ['Your package is out for delivery', 'Tracking number', 'Manage your delivery preferences'];

for (const device of ['target', 'iphone'] as const) {
  test(`${device === 'iphone' ? 'on the phone, ' : ''}an email that sizes its page to the window, or holds itself out of the page's flow, shows whole, top to bottom (SV-228)`, async () => {
    const setpoint = await startSetpoint({fixtures: ['viewport-html', 'positioned-html']});
    try {
      const page = await setpoint.page(device);
      for (const [subject, lines] of [['Webinar: what\'s new in Litware 12', INVITE_LINES], ['Out for delivery', NOTICE_LINES]] as const) {
        const {box, boxes} = await fitted(page, setpoint, subject, [...lines]);
        const tops = boxes.map(line => line.y);
        assert.deepEqual([...tops].sort((a, b) => a - b), tops, `${subject}: its lines in order`);
        // Every line inside the frame, the first near its top: nothing above it or below it is cut off.
        for (const line of boxes) assert.ok(line.y >= box.y && line.y + line.height <= box.y + box.height, `${subject}: a line at ${line.y} outside the frame at ${box.y}, ${box.height} tall`);
        assert.ok(boxes[0]!.y - box.y < 120, `${subject}: its first line ${boxes[0]!.y - box.y} px down the frame`);
      }
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}

test('with the email clicked into, its keys still reach Setpoint, and its text stays selected (SV-149)', async () => {
  const setpoint = await startSetpoint({fixtures: ['stitched-html']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id: await idOf(setpoint, 'Statement ready')})}`);
    await stitchedNotice(page);
    const frame = page.frameLocator('iframe.mailframe');
    const intoEmail = async () => {
      // By the pointer at its box: under the page's zoom, Playwright's own hit check inside the frame
      // misses (it maps the point without the zoom), while the browser's lands on it.
      const heading = (await rested(() => frame.getByText('Your statement is ready', {exact: true}).boundingBox()))!;
      await page.mouse.click(heading.x + heading.width / 2, heading.y + heading.height / 2, {clickCount: 3});
      await until('the email has the keys', () => page.evaluate(() => document.activeElement?.className), name => name === 'mailframe');
    };
    const selected = () => frame.locator('body').evaluate(() => getSelection()!.toString().trim());

    await intoEmail();
    await page.keyboard.press('p');
    await page.locator('.rd-tools .tool', {hasText: 'Unpin'}).waitFor();
    assert.equal(await selected(), 'Your statement is ready');

    // O opens it in Gmail (answered here, never the real Gmail).
    await page.context().route('https://mail.google.com/**', route => route.fulfill({contentType: 'text/html', body: '<title>Gmail</title>'}));
    await intoEmail();
    const opened = page.waitForEvent('popup');
    await page.keyboard.press('o');
    assert.match((await opened).url(), /^https:\/\/mail\.google\.com\/mail\/\?authuser=/);

    // ⌘F goes to the header's search, as it does from anywhere else.
    await intoEmail();
    await page.keyboard.press('Meta+f');
    await until('the search has the keys', () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')), label => label === 'Search mail');
    await page.keyboard.press('Escape');

    await intoEmail();
    await page.keyboard.press('2');
    await page.locator('.cal-grid').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a proposal\'s Cancel takes its card away at once, and the copy it leaves goes', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.list .row:has(b[data-tip^="Final exam schedule"])').click();
    await page.locator('.rd-acts .btn', {hasText: 'Add to calendar'}).click();
    const proposal = page.getByRole('form', {name: 'Proposal: add to calendar'});
    await proposal.waitFor();
    await proposal.getByRole('button', {name: 'Cancel'}).click();
    assert.equal(await proposal.count(), 0, 'the card itself goes at once');
    await page.locator('.prop[aria-hidden="true"]').waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-270: a proposal\'s Description starts "From:" its email, linked to Gmail; created, the link opens the email in Setpoint, from the detail and from the editor', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=100');
    const exam = all.days.flatMap(day => day.rows).find(row => row.subject === 'Final exam schedule · CS 101')!;
    const gmail = (await setpoint.api<MessageOut>('GET', `/mail/messages/${exam.id}`)).open_url!;
    await rowOf(page, 'Final exam schedule').click();
    await page.locator('.rd-acts .btn', {hasText: 'Add to calendar'}).click();
    const proposal = page.getByRole('form', {name: 'Proposal: add to calendar'});
    const field = proposal.getByRole('textbox', {name: 'Description'});
    await field.waitFor();
    assert.equal(await field.textContent(), 'From: Final exam schedule · CS 101');
    assert.equal(await field.locator('a').getAttribute('href'), gmail);
    await proposal.locator('.desc-field .srcm[aria-label="From the email"]').waitFor();
    await proposal.getByRole('button', {name: 'Create event'}).click();
    await proposal.waitFor({state: 'detached'});
    await setpoint.idle();
    const created = await until('the exam created', () => setpoint.api<ItemsOut>('GET', '/items?from=2026-12-09&to=2026-12-10'),
      ({items}) => items.some(item => item.title === 'CS 101 final exam' && !item.command));
    const item = created.items.find(one => one.title === 'CS 101 final exam')!;
    assert.equal(item.description, `From: <a href="${gmail.replaceAll('&', '&amp;')}">Final exam schedule · CS 101</a>`);

    // The detail: a plain description link, "Opens in Setpoint" once it's known, opening the reader.
    await page.goto(`${setpoint.base}/calendar/item/${item.id}`);
    const link = page.locator('.fd .fd-desc a', {hasText: 'Final exam schedule · CS 101'});
    await page.locator('.fd .fd-desc a[data-tip="Opens in Setpoint"]').waitFor();
    assert.equal(await link.getAttribute('href'), gmail);
    await link.click();
    await page.waitForURL(`**/inbox/${exam.id}`);
    await page.locator('h1.rd-subj', {hasText: 'Final exam schedule'}).waitFor();

    // The editor's field: ⌘-click opens it the same way, its tip saying so.
    await page.goto(`${setpoint.base}/calendar/item/${item.id}/edit`);
    const own = page.locator('.editor[aria-label="Edit event"]').getByRole('textbox', {name: 'Description'}).locator('a');
    await own.hover();
    await page.locator('.editor .desc-edit a[data-tip="Opens in Setpoint · ⌘Click"]').waitFor();
    await own.click({modifiers: ['ControlOrMeta']});
    await page.waitForURL(`**/inbox/${exam.id}`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-270: another provider\'s email gives the From: line as text, and cleared it takes its mark and sends no description', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const sent: {description?: unknown}[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\/items$/.test(request.url())) sent.push(request.postDataJSON() as {description?: unknown});
    });
    await rowOf(page, 'Bill is ready').click();
    await page.locator('.rd-acts .btn', {hasText: 'Add as task'}).click();
    const proposal = page.getByRole('form', {name: 'Proposal: add as task'});
    const field = proposal.getByRole('textbox', {name: 'Description'});
    await field.waitFor();
    assert.equal(await field.textContent(), 'From: Bill is ready');
    assert.equal(await field.locator('a').count(), 0);
    await proposal.locator('.desc-field .srcm').waitFor();
    await field.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Backspace');
    await proposal.locator('.desc-field .srcm').waitFor({state: 'detached'});
    await proposal.getByRole('button', {name: 'Create task'}).click();
    await proposal.waitFor({state: 'detached'});
    await until('the task sent', async () => sent, list => list.length === 1);
    assert.equal(sent[0]!.description, null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the facts card and protected line on security mail, and no Add to calendar there', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.row', {hasText: 'New sign-in'}).click();
    await page.locator('.facts').waitFor();
    assert.deepEqual(await page.locator('.facts dt').allTextContents(), ['What happened', 'When', 'Device', 'Location']);
    // Each label holds one line, its icon beside it.
    assert.deepEqual(await page.locator('.facts dt').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().height <= 20)), [true, true, true, true]);
    assert.equal(await page.locator('.facts .unfamiliar').count(), 0);
    assert.equal(await page.locator('.protected-line').count(), 0);
    assert.deepEqual(await page.locator('.rd-acts .btn').allTextContents(), ['Ask about this email']);
    await rowOf(page, 'Your recovery email was changed').click();
    await page.locator('.protected-line', {hasText: 'Protected, always stays in Attention'}).waitFor();
    assert.equal(await page.locator('.facts .unfamiliar').textContent(), 'not a place you use');
    // Others propose.
    await rowOf(page, 'Pick a 30-minute slot').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    // The email itself has loaded, not only its row's subject.
    await page.locator('.rd-body:not(:has(.sk-body))').waitFor();
    assert.deepEqual(await page.locator('.rd-acts .btn').allTextContents(), ['Add to calendar', 'Add as task', 'Ask about this email']);
    assert.equal(await page.locator('.facts').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an attachment opens its preview over the reading pane; Esc closes the preview first', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // The dev provider serves the seed's attachment: a one-page PDF stand-in.
    const served = page.waitForResponse(response => /\/api\/mail\/messages\/\d+\/attachments\/\d+$/.test(response.url()));
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    const card = page.locator('.attach', {hasText: 'Renewal agreement.pdf'});
    assert.equal(await card.locator('.size').textContent(), 'PDF · 184 KB');
    assert.equal(await card.locator('.name').evaluate(name => name.scrollWidth <= name.clientWidth), true, 'the whole name shows');
    await card.click();
    await page.locator('.attach-preview iframe.preview-pdf').waitFor();
    const response = await served;
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'application/pdf');
    assert.match(response.headers()['content-disposition']!, /^inline; filename="Renewal agreement.pdf"/);
    await page.keyboard.press('Escape');
    await until('the preview closes', () => page.locator('.attach-preview').count(), count => count === 0);
    assert.equal(await page.locator('.pane:not(.idle)').count(), 1, 'the reader stays');
    // When the provider can't serve it, the preview says so.
    await page.route('**/api/mail/messages/*/attachments/*', route => route.fulfill({status: 502, json: {error: {code: 'provider_failed', message: 'Gmail didn\'t answer in time.'}}}));
    await card.click();
    await page.locator('.attach-preview', {hasText: 'Couldn’t load the preview, Gmail didn\'t answer in time.'}).waitFor();
    await page.locator('.attach-preview button[aria-label="Close preview"]').click();
    assert.equal(await page.locator('.attach-preview').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('every attachment downloads: its card\'s Download, the preview\'s, and a card with no preview is one Download link (SV-25)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    const card = page.locator('.attach', {hasText: 'Renewal agreement.pdf'});
    // The card's Download saves it without opening the preview.
    let download = page.waitForEvent('download');
    await card.locator('.dl', {hasText: 'Download'}).click();
    assert.equal((await download).suggestedFilename(), 'Renewal agreement.pdf');
    assert.equal(await page.locator('.attach-preview').count(), 0);
    // The preview's head offers it too.
    await card.click();
    await page.locator('.attach-preview iframe.preview-pdf').waitFor();
    download = page.waitForEvent('download');
    await page.locator('.attach-preview .preview-head .dl', {hasText: 'Download'}).click();
    assert.equal((await download).suggestedFilename(), 'Renewal agreement.pdf');

    // An attachment with no preview (the same file, as a zip) is one Download link, no longer a dead card.
    const other = await load(setpoint);
    // The email's GET and its open's answer, which the app caches as the email.
    await other.route(/\/api\/mail\/messages\/\d+(\/open)?$/, async route => {
      const response = await route.fetch();
      const message = await response.json() as MessageOut;
      await route.fulfill({response, json: {...message, attachments: message.attachments.map(file => ({...file, filename: 'Renewal agreement.zip', mime_type: 'application/zip'}))}});
    });
    await other.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    const zip = other.locator('a.attach', {hasText: 'Renewal agreement.zip'});
    assert.equal(await zip.locator('.dl').textContent(), 'Download');
    // An archive's tile is warm, with folder_zip (#122).
    assert.deepEqual(await glyphs(zip.locator('.type .icon')), [['folder_zip', '18', await tokenColour(other, 'warm')]]);
    download = other.waitForEvent('download');
    await zip.click();
    await download;
    assert.equal(await other.locator('.attach-preview').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the pattern prompt sits at the end of New\'s Attention; No answers it and it goes', async () => {
  const setpoint = await startSetpoint({fixtures: ['new-digest']});
  try {
    const page = await setpoint.page('target');
    // B3's real routes: the fixture's four digests cleared unopened raise the prompt.
    const answers: unknown[] = [];
    page.on('request', request => {
      if (request.method() === 'POST' && /\/api\/mail\/prompts\/\d+$/.test(request.url())) answers.push(request.postDataJSON());
    });
    await page.goto(`${setpoint.base}/inbox`);
    const prompt = page.locator('.prompt');
    await prompt.waitFor();
    assert.equal(await prompt.locator('.grow').textContent(), 'You\'ve cleared 4 Northwind Engineering newsletters without opening them. Send these to FYI from now on?');
    // The last thing in Attention: after its last row, before the Pinned shelf.
    const order = await page.locator('.list > *').evaluateAll(nodes => nodes.map(node => (node.classList.contains('prompt') ? 'prompt' : `${node.classList[0]}:${node.textContent!.trim().slice(0, 18)}`)));
    const at = order.indexOf('prompt');
    assert.match(order[at - 1]!, /^row:/);
    assert.match(order[at + 1]!, /^gh:Pinned/);
    await prompt.locator('button', {hasText: 'No'}).click();
    await until('it goes', () => prompt.count(), count => count === 0);
    await until('the answer sent', async () => answers, sent => sent.length === 1);
    assert.deepEqual(answers, [{answer: 'no'}]);
    // No keeps it quiet for good, on the server too, once the browser's answer lands.
    await until('the server has the answer', () => setpoint.api<unknown[]>('GET', '/mail/prompts'), prompts => prompts.length === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('days first: Attention, the shelf, then the days, Today first; lanes, kinds and Noise folded; opening one reads it and it stays (D449)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // Attention (unread or read, not Done), the Pinned shelf, then the days, Today first, unread mail in its day.
    assert.deepEqual((await page.locator('.list.all .gh').allTextContents()).slice(0, 5),
      ['Attention 3', 'Pinned 1', 'Today Wed, Oct 7', 'Yesterday Tue, Oct 6', 'Mon Oct 5']);
    // Today's lanes and Yesterday's, the kind once where an FYI run starts (#48).
    assert.deepEqual((await page.locator('.list.all .lh').allTextContents()).slice(0, 2), ['FYI 8', 'FYI 4']);
    // Each FYI run of one kind under its subheading (#237).
    assert.deepEqual((await page.locator('.list.all .kh').allTextContents()).slice(0, 4), ['Security', 'Deliveries', 'Money', 'Career']);
    // The summary takes the subject's place; the subject is its tooltip (SV-203).
    const fabrikam = page.locator('.list.all .row', {hasText: 'Fabrikam'}).first();
    assert.equal(await fabrikam.locator('.subj').textContent(), 'Data Analyst · via Workday');
    assert.equal(await fabrikam.locator('.subj b').getAttribute('data-tip'), 'Application received');
    // Above the days and in Today, ages; in earlier days, clock times. The pinned lease is on the shelf only.
    assert.equal(await fabrikam.locator('.age').textContent(), '7h');
    assert.match((await page.locator('.list.all .row:has(b[data-tip="Lab 5 posted"]) .age').textContent())!, /^\d{1,2}:\d\d [AP]M$/);
    assert.deepEqual(await page.locator('.list.all .row:has(b[data-tip="Lease renewal terms"])').evaluateAll(rows => rows.map(row => [row.classList.contains('shelf'), row.querySelector('.age')!.textContent])),
      [[true, 'Sep 30']]);
    // Today's Noise is one line; J and K stop on it after Attention's 3, the shelf's 1 and Today's 8,
    // and Enter opens it in place.
    const coffee = page.locator('.list.all .row', {hasText: 'Contoso Coffee'});
    const noise = page.locator('.list.all .nfold').first();
    assert.equal(await noise.textContent(), 'Noise 3Tailspin Toys, Contoso Coffee, Litware');
    assert.equal(await coffee.count(), 0);
    for (let press = 0; press < 13; press++) await page.keyboard.press('j');
    await page.locator('.list.all .nfold.cur').waitFor();
    await page.keyboard.press('Enter');
    await coffee.first().waitFor();
    await coffee.first().click();
    await page.locator('.rd-subj', {hasText: 'The Contoso Coffee Journal'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === 18);
    // Read, it stays where it was in its day, and Unread's badge counts one less.
    await until('the row reads as read', () => coffee.first().getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    await until('Unread counts one less', () => page.locator('.hd .ib-views .ubadge').textContent(), text => text === '18');
    // The account stays on every row beside the reading pane.
    assert.equal(await coffee.first().locator('.ac').isVisible(), true);
    // Trash takes the row out, and ⌘Z brings it back; the folds are by eye (D416).
    await page.keyboard.press('Escape');
    const lease = page.locator('.list.all .row:has(b[data-tip="Lease renewal terms"])');
    await point(lease);
    await page.keyboard.press('e');
    await until('it goes', () => lease.count(), count => count === 0);
    await page.keyboard.press('Meta+z');
    await until('⌘Z brings it back', () => lease.count(), count => count === 1, 5000);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('#238: the reader shows the email\'s summary under its subject, and none when triage wrote none', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.list.all .row', {hasText: 'Fabrikam'}).first().click();
    await page.locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    const summary = page.locator('.rd-sum');
    assert.equal(await summary.textContent(), 'Data Analyst');
    // Above the sender.
    const [sum, meta] = [await summary.boundingBox(), await page.locator('.rd-meta').boundingBox()];
    assert.ok(meta!.y > sum!.y + sum!.height, 'the sender comes after it');
    // An email with no summary has no line for it.
    await page.locator('.list.all .row', {hasText: 'You sent $42.00 to Sam Lee'}).first().click();
    await page.locator('.rd-subj', {hasText: 'You sent $42.00 to Sam Lee'}).waitFor();
    assert.equal(await summary.count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the Inbox is one place: the sidebar and the bare address open it, and All\'s old addresses land there (#243)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    const path = () => Promise.resolve(new URL(page.url()).pathname);
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-grid').waitFor();
    await page.locator('.sb .nav', {hasText: 'Inbox'}).click();
    await page.locator('.list .gh.day').first().waitFor();
    assert.equal(await path(), '/inbox');
    // In All, the first of the views (SV-221).
    assert.equal(await page.locator('.hd .ib-views button.on').textContent(), 'All');
    // The bare address, and All's old one with an email in it.
    await page.goto(`${setpoint.base}/`);
    await page.locator('.list .gh.day').first().waitFor();
    assert.equal(await path(), '/');
    const lease = await idOf(setpoint, 'Lease renewal terms');
    await page.goto(`${setpoint.base}/inbox/all/${lease}`);
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await page.locator('.list .row.shelf.open').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Bringing a row into sight from further down went with the scroll it needed (D416).
test('U takes the cursor to the next unread email, from the top again past the last; ⌘K\'s Go to next unread does the same; 1 goes to the Inbox from elsewhere (D449)', async () => {
  const setpoint = await startSetpoint();
  try {
    // Tall enough that Monday's rows show as the page loads.
    const page = await setpoint.page({width: 1677, height: 1400});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .gh.day').first().waitFor();
    // From Yesterday's read Lab 5, past Yesterday's folded Noise, to Monday's unread Southridge Video.
    const lab = page.locator('.list .row:has(b[data-tip="Lab 5 posted"])');
    await point(lab);
    await page.keyboard.press('u');
    await page.locator('.list .row.cur', {hasText: 'Southridge Video'}).waitFor();
    // Nothing unread below it shows, so U goes round to the top: Attention's Google.
    await page.keyboard.press('u');
    await page.locator('.list .row.cur', {hasText: 'Your recovery email was changed'}).waitFor();
    // ⌘K names it with its key, and goes on from the cursor: Northwind.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('next unread');
    assert.deepEqual(await page.locator('.palette .item').allTextContents(), ['Go to next unreadU']);
    await page.keyboard.press('Enter');
    await page.locator('.list .row.cur', {hasText: 'Northwind Talent'}).waitFor();
    // From the Calendar, 1 goes to the Inbox.
    await page.keyboard.press('2');
    await page.locator('.cal-grid').waitFor();
    await page.keyboard.press('1');
    await page.locator('.list .gh.day').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the reading pane resizes from its left edge, within bounds, and this browser keeps the width', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const pane = page.locator('.pane:not(.idle)');
    const paneWidth = async () => Math.round((await rested(() => pane.boundingBox()))!.width / ZOOM);
    await page.locator('.row', {hasText: 'New sign-in'}).click();
    await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
    assert.equal(await paneWidth(), 680);

    // dx in the page's pixels; the pointer moves in the window's.
    const drag = async (dx: number) => {
      const edge = (await rested(() => page.locator('.pane-edge').boundingBox()))!;
      const at = {x: edge.x + edge.width / 2, y: edge.y + 200};
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (let step = 1; step <= 5; step += 1) await page.mouse.move(at.x + dx * ZOOM * step / 5, at.y);
      await page.mouse.up();
    };
    await drag(-120);
    assert.equal(await paneWidth(), 800, 'wider by the drag');
    await drag(600);
    assert.equal(await paneWidth(), 480, 'no narrower than 480');
    // ← on the focused edge widens it a step.
    await page.locator('.pane-edge').focus();
    await page.keyboard.press('ArrowLeft');
    assert.equal(await paneWidth(), 496);

    await page.reload();
    await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
    assert.equal(await paneWidth(), 496, 'kept across a reload');
    // A double-click on the edge puts it back to 680.
    await page.locator('.pane-edge').dblclick();
    await until('back to 680', paneWidth, width => width === 680);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S8 (SV-25, D54): a Pin or Mark all as read the server refuses says so in the toast, in its words', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.route(/\/api\/mail\/(messages\/\d+\/pin|mark-all-read)$/, route => route.fulfill({status: 502, json: {error: {code: 'provider_failed', message: 'Gmail didn\'t answer in time.'}}}));
    await point(rowOf(page, 'Pick a 30-minute slot'));
    await page.keyboard.press('p');
    await page.locator('.toast', {hasText: 'Couldn\'t pin it, Gmail didn\'t answer in time.'}).waitFor();
    await page.keyboard.press('Shift+I');
    await page.locator('.toast', {hasText: 'Couldn\'t mark all as read, Gmail didn\'t answer in time.'}).waitFor();
    await page.unroute(/\/api\/mail\/(messages\/\d+\/pin|mark-all-read)$/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('after Mark all as read, a load answered before the provider confirms brings no dot back (SV-41)', async () => {
  // The dev provider holds every change while this file is there, so the check, not how fast the
  // load comes, makes sure the load is answered before the provider confirms.
  const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-hold-'));
  const hold = path.join(holdDir, 'hold');
  fs.writeFileSync(hold, '');
  const setpoint = await startSetpoint({env: {SETPOINT_DEV_PROVIDER_HOLD: hold}});
  try {
    const page = await load(setpoint);
    // Attention's two and Security's three are left unread by Mark all as read.
    const unreadRows = page.locator('.list .row.unread:not(.done)');
    await page.locator('.list .gh.day').first().waitFor();
    const answered = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/mail/mark-all-read'));
    await page.keyboard.press('Shift+I');
    await answered;
    await until('the dots go at once', () => unreadRows.count(), count => count === 5);

    // From here on, note whether a dot comes back.
    await page.evaluate(() => {
      const shows = () => document.querySelectorAll('.list .row.unread:not(.done)').length > 5;
      const state = window as unknown as {dotsBack: boolean};
      state.dotsBack = shows();
      new MutationObserver(() => {
        state.dotsBack ||= shows();
      }).observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
    });
    // A load while the provider is held: focus refreshes the lists, the days' among them.
    const loaded = page.waitForResponse(response => response.request().method() === 'GET' && /\/api\/mail\/all(\?|$)/.test(new URL(response.url()).pathname + new URL(response.url()).search));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await drawn(page, await loaded);
    const markAllPending = (commands: {kind: string; state: string}[]) => commands.some(command => command.kind === 'mark_all_read' && command.state === 'pending');
    assert.ok(markAllPending(await setpoint.api('GET', '/commands')), 'the provider was still confirming when the load answered');

    // Only now does the provider confirm.
    fs.rmSync(hold);
    await until('the provider confirms', () => setpoint.api<{kind: string; state: string}[]>('GET', '/commands'), commands => !markAllPending(commands));
    await until('the server read them', () => counts(setpoint).then(value => value.unread), value => value === 5, 5000);
    await until('the list has the server\'s answer', () => page.locator('.nav:has-text("Inbox") .ubadge').textContent(), text => text === '5');
    assert.equal(await page.evaluate(() => (window as unknown as {dotsBack: boolean}).dotsBack), false, 'a dot came back before the provider confirmed');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    fs.rmSync(holdDir, {recursive: true, force: true});
  }
});

test('UX #11: ⇧U marks the open email unread and closes the reader; ⌘K names the key', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await rowOf(page, 'Your recovery email was changed').click();
    await until('Google read', () => unreadCount(page), text => text === '18');
    await page.keyboard.press('Shift+U');
    await page.locator('.pane:not(.idle)').waitFor({state: 'detached'});
    await until('unread again', () => unreadCount(page), text => text === '19', 5000);
    // Unread again where it was, in Attention.
    await page.locator('.list .row.unread', {hasText: 'Your recovery email was changed'}).waitFor();
    // ⌘K's Mark unread shows the key.
    await rowOf(page, 'Your recovery email was changed').click();
    await page.locator('.rd-subj').waitFor();
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('mark unread');
    assert.match(await page.locator('.palette [role="option"]', {hasText: 'Mark unread'}).first().textContent() ?? '', /⇧U/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
