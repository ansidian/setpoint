// Mail's details in the browser (BUILD-PLAN.md › F2), at the design target on a fresh seed each:
// Done or Trash on the open email opens the next (2026-10-07), each with Undo in the toast;
// pin and unpin; Mark all as read; copying a code, and a code leaving at its expiry; images hidden
// and Show / Always show; an attachment's preview; the pattern prompt's answer; All's rows.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';
import {deepLinkPath} from '@setpoint/shared';
import type {AccountOut, AllOut, InboxOut, MailCountsOut, MessageOut, TrustedDomainOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, collapseGroups, point, readSecurity, startSetpoint, still, until} from './harness.ts';
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
const pill = (page: Page) => page.locator('.nav:has-text("Inbox") .apill').textContent();
const unreadCount = (page: Page) => page.locator('.nav:has-text("Inbox") .cnt').textContent();

async function load(setpoint: Setpoint, path = '/inbox'): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}${path}`);
  await page.locator('.list .row, .list .arow').first().waitFor();
  return page;
}

async function idOf(setpoint: Setpoint, subjectStart: string): Promise<number> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  return all.days.flatMap(day => day.rows).find(row => row.subject.startsWith(subjectStart))!.id;
}

const inAll = async (setpoint: Setpoint, id: number) =>
  (await setpoint.api<AllOut>('GET', '/mail/all?limit=500')).days.some(day => day.rows.some(row => row.id === id));

test('Done on the open email opens the next, which reads it; the pill drops for the Done', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // Google (protected, unread) open: 18 unread. Done opens Northwind, the next row, and reads it.
    await page.locator('.arow', {hasText: 'Your recovery email was changed'}).click();
    await until('Google read', () => unreadCount(page), text => text === '18');
    await page.keyboard.press('h');
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await until('the unread count drops by one and the pill by one', async () => [await pill(page), await unreadCount(page)], ([shownPill, unread]) => shownPill === '2' && unread === '17');
    // The server has them once the browser's Done and open land, after the counts show them.
    await until('the server has them', () => counts(setpoint).then(value => [value.attention, value.unread].join()), value => value === '2,17');
    // Done on Northwind opens Contoso University, the row that takes its place (read already: 17 stays).
    await page.keyboard.press('h');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await until('the pill drops again', () => pill(page), text => text === '1');
    assert.equal(await page.locator('.arow.open', {hasText: 'Contoso University'}).count(), 1);
    // Northwind's row folds away over 180 ms (DESIGN.md › Decided while building #13).
    await until('Northwind folds away', () => page.locator('.arow', {hasText: 'Northwind Talent'}).count(), count => count === 0);
    await until('the server has it', () => counts(setpoint).then(value => [value.attention, value.unread].join()), value => value === '1,17');
    // The toast offers Undo: Northwind comes back to Attention and to the reader.
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await page.locator('.arow.open', {hasText: 'Northwind Talent'}).waitFor();
    await until('the pill comes back', () => pill(page), text => text === '2');
    // Undo takes the toast away: it fades out over 120 ms, then goes.
    await page.locator('.toast').waitFor({state: 'detached'});
    // FYI mail has no Done (#93): opening it already read it. Fabrikam, in Career, opens with Trash
    // first in the tools, and H leaves it where it is, with no toast.
    await page.locator('.row', {hasText: 'Fabrikam'}).click();
    await page.locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.equal(await page.locator('.rd-tools .tool', {hasText: 'Done'}).count(), 0);
    assert.equal(await page.locator('.rd-tools .tool').first().textContent(), 'TrashE');
    await page.keyboard.press('h');
    // Nothing happens to wait for: H does nothing here.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await page.locator('.rd-subj', {hasText: 'Application received'}).count(), 1, 'H does nothing on FYI mail');
    assert.equal(await page.locator('.toast').count(), 0);
    // Done on the last row shown closes the reader. With every group below Attention collapsed it is
    // the end of the list, so open Attention's last row: Contoso University.
    await collapseGroups(page, ['Security', 'Deliveries', 'Money', 'Career', 'Noise']);
    await page.locator('.arow', {hasText: 'Contoso University'}).click();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await page.keyboard.press('h');
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    // The keyboard cursor stays where Contoso University was, on what follows it (Security's header), so J and K go on from there.
    await until('the cursor stays at the foot', () => page.locator('.list .cur').allTextContents(), shown => shown.length === 1 && shown[0]!.startsWith('Security'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #2: with an email open, J and K open the next and previous email, so H, E and P act on what\'s highlighted', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.arow', {hasText: 'Interview availability for Software Engineer I'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await page.keyboard.press('j');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    // One row marked, the open one.
    assert.deepEqual(await page.locator('.list .cur, .list .open').allTextContents().then(rows => rows.length), 1);
    await page.keyboard.press('k');
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // E trashes the email that's open and highlighted.
    await page.keyboard.press('j');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    const exam = await idOf(setpoint, 'Final exam schedule');
    await page.keyboard.press('e');
    await until('the exam email is trashed', () => inAll(setpoint, exam), shown => !shown);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Trash opens the next email, and Undo brings the trashed one back to the reader', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
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
    await until('trashed at the provider', () => inAll(setpoint, signIn), present => !present, 5000);
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
    await until('back from the trash', () => inAll(setpoint, signIn), present => present, 5000);
    await page.locator('.toast').waitFor({state: 'detached'});

    // Trash from the cursor row, no reader: nothing opens, and Undo is offered for 6 seconds.
    await page.keyboard.press('Escape');
    await until('the pane collapses', () => page.locator('.pane').count(), count => count === 0);
    const ups = await idOf(setpoint, 'Out for delivery');
    await point(page.locator('.row[title="Out for delivery"]'));
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
    await page.keyboard.press('e');
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    assert.equal(await page.locator('.pane').count(), 0, 'Trash from the row opens nothing');
    await until('Consolidated Messenger leaves', () => page.locator('.row[title="Out for delivery"]').count(), count => count === 0);
    assert.equal(await inAll(setpoint, ups), true, `the server doesn't have it yet (Consolidated Messenger is ${ups}; sent ${JSON.stringify(sent)}, held ${JSON.stringify(heldAt)})`);
    release();
    await until('trashed at the provider', () => inAll(setpoint, ups), present => !present, 5000);
    assert.equal(await page.locator('.row[title="Out for delivery"]').count(), 0, 'and it stays gone');
    await until('the toast goes after 6 seconds', () => page.locator('.toast').count(), count => count === 0, 8000);
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
    await point(page.locator('.row[title="Out for delivery"]'));
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
    await page.locator('.row[data-key][title="Out for delivery"]').waitFor();
    release();
    const row = async () => (await setpoint.api<AllOut>('GET', '/mail/all?limit=500')).days.flatMap(day => day.rows).find(one => one.id === ups);
    // Two trips through the dev provider (600 ms each), the Trash's and the Undo's, and the wait between.
    await until('back from the trash at the provider', row, found => answers.includes('ok') && found !== undefined && !found.command, 10_000);
    assert.ok(answers.at(-1) === 'ok' && answers.slice(0, -1).every(code => code === 'command_pending'), `Undo goes once the Trash is in: ${answers.join(', ')}`);
    assert.equal(await page.locator('.toast').count(), 0, 'no failure shows');
    await page.unroute('**/api/mail/messages/*/trash');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Pin and Unpin: the reader\'s P, and Unpin on the shelf under the pointer', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const shelf = () => page.locator('.row.shelf').allTextContents();
    // A row's summary takes its subject's place, which moves to the tooltip; the platform stays
    // after it, and Attention keeps both lines (SV-25).
    const parkside = page.locator('.row.shelf', {hasText: 'Parkside Apartments'});
    assert.equal(await parkside.locator('.subj').textContent(), 'Renewal offer for the lease ending Nov 30 · sign by Oct 31');
    assert.equal(await parkside.getAttribute('title'), 'Lease renewal terms');
    const fabrikam = page.locator('.row', {hasText: 'Fabrikam'});
    assert.equal(await fabrikam.locator('.subj').textContent(), 'Data Analyst · via Workday');
    assert.equal(await fabrikam.getAttribute('title'), 'Application received');
    const northwind = page.locator('.arow', {hasText: 'Northwind Talent'});
    assert.deepEqual([await northwind.locator('.l2').textContent(), await northwind.locator('.l3').textContent()], ['Interview availability for Software Engineer I', 'Pick a 30-minute slot this week']);
    assert.equal(await page.locator('.row', {hasText: 'New sign-in'}).getAttribute('title'), null, 'a security row keeps its fact');
    await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await page.keyboard.press('p');
    await until('Northwind joins the shelf', () => shelf(), rows => rows.length === 2 && rows.some(text => text.includes('Pick a 30-minute slot this week')));
    await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).waitFor();
    await until('the shelf counts 2', () => page.locator('.gh.first').textContent(), text => /Pinned\s*2/i.test(text ?? ''));
    // P again unpins it.
    await page.keyboard.press('p');
    await until('it leaves the shelf', () => shelf(), rows => rows.length === 1);
    await page.locator('.rd-tools .tool:not(.active)', {hasText: 'Pin'}).waitFor();
    // Unpin from the shelf: the button shows under the pointer, in the age's place.
    assert.equal(await parkside.locator('.unpin').isVisible(), false);
    await parkside.hover();
    await parkside.locator('.unpin').click();
    await until('the shelf goes', () => page.locator('.gh', {hasText: 'Pinned'}).count(), count => count === 0);
    // The server has it once the browser's Unpin lands, after the shelf goes.
    await until('the server unpinned it', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), inbox => !inbox.groups.some(group => group.group === 'pinned'));
    assert.equal(await page.locator('.rd-subj', {hasText: 'Interview availability'}).count(), 1, 'unpinning from the shelf opens nothing');
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
    await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
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

test('the reader\'s tools come from the email\'s row before the email has loaded: Unpin on pinned mail, no Open in Gmail on iCloud mail; each email opens at its top', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, '/inbox/all');
    // The email's own answers are held at the server's door until the tools have been read.
    let release = () => {};
    const hold = () => new Promise<void>(resolve => {
      release = resolve;
    });
    let held = hold();
    await page.route(/\/api\/mail\/messages\/\d+(\/open)?$/, async route => {
      await held;
      await route.continue();
    });
    const tools = () => page.locator('.rd-tools .tool').evaluateAll(buttons => buttons.map(button => [button.textContent, button.getAttribute('aria-pressed')]));
    await page.locator('.list.all .row.shelf', {hasText: 'Parkside Apartments'}).click();
    await page.locator('.list.all .row.shelf.open').waitFor();
    assert.deepEqual(await tools(), [['TrashE', null], ['UnpinP', 'true'], ['Open in GmailO', null]]);
    release();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    assert.deepEqual(await tools(), [['TrashE', null], ['UnpinP', 'true'], ['Open in GmailO', null]]);

    held = hold();
    await page.locator('.list.all .row', {hasText: 'Apple'}).click();
    await page.locator('.list.all .row.open', {hasText: 'Apple'}).waitFor();
    assert.deepEqual(await tools(), [['TrashE', null], ['PinP', 'false']]);
    release();
    await page.locator('.rd-subj', {hasText: 'Your iCloud storage is almost full'}).waitFor();
    assert.deepEqual(await tools(), [['TrashE', null], ['PinP', 'false']]);
    await page.unroute(/\/api\/mail\/messages\/\d+(\/open)?$/);

    // Each email opens at its top, one shown before (drawn at once, from the cache) too.
    const short = await setpoint.page({width: 1677, height: 480});
    await short.goto(`${setpoint.base}/inbox`);
    const scroller = short.locator('.rd-scroll');
    const recovery = short.locator('.arow', {hasText: 'Your recovery email was changed'});
    await recovery.click();
    await short.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    assert.ok(await scroller.evaluate(element => element.scrollHeight > element.clientHeight + 40), 'the email is taller than the pane');
    await short.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    await short.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await scroller.evaluate(element => element.scrollTo(0, element.scrollHeight));
    assert.ok(await scroller.evaluate(element => element.scrollTop > 40), 'scrolled down the lease');
    await recovery.click();
    await short.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    assert.equal(await scroller.evaluate(element => element.scrollTop), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a key pressed as soon as the hover has moved the cursor acts on the row under the pointer', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const northwind = page.locator('.arow', {hasText: 'Northwind Talent'});
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
    await until('Northwind leaves', () => northwind.count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('opening a collapsed group at the foot of the list brings its rows into view', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page({width: 1677, height: 720});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .arow').first().waitFor();
    await collapseGroups(page, ['Noise']);
    // Scrolled to the end, Noise's header is the list's last line.
    await page.locator('.list').evaluate(list => list.scrollTo({top: list.scrollHeight}));
    await page.locator('.gh', {hasText: 'Noise'}).click();
    await page.locator('.row', {hasText: 'Contoso Coffee'}).waitFor();
    // The group's last row is inside the list (its header too, when the group is taller than the list).
    const inView = () => page.evaluate(() => {
      const list = document.querySelector('.list')!.getBoundingClientRect();
      const header = [...document.querySelectorAll<HTMLElement>('.list .gh')].find(one => one.textContent!.startsWith('Noise'))!;
      let last: Element = header;
      for (let next = header.nextElementSibling; next && !next.classList.contains('gh'); next = next.nextElementSibling) if (next.classList.contains('row')) last = next;
      const [top, bottom] = [header.getBoundingClientRect().top, last.getBoundingClientRect().bottom];
      return top >= list.top - 1 && (bottom <= list.bottom + 1 || top <= list.top + 1);
    });
    await until('Noise\'s rows in view', inView, shown => shown);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark all as read from the footer: everything outside Attention and Security reads, Noise included (UX #4)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // Its glyph is ⌘K's for the same command, 16 px before the label (#164).
    assert.deepEqual((await glyphs(page.locator('.listfoot .lnk .icon')))[0]!.slice(0, 2), ['mark_email_read', '16']);
    await page.locator('.listfoot .lnk', {hasText: 'Mark all as read'}).click();
    await until('only Attention\'s two unread and Security\'s three remain', () => unreadCount(page), text => text === '5', 5000);
    // The screen shows it at once; the server follows.
    await until('the server agrees', () => counts(setpoint).then(value => [value.attention, value.unread, value.unread_fyi].join()), value => value === '3,5,3', 5000);
    await until('Noise folds away', () => page.locator('.gh', {hasText: 'Noise'}).count(), count => count === 0);
    assert.equal(await page.locator('.gh', {hasText: 'Security'}).count(), 1, 'Security stays');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark all as read says how many it read, with Undo; ⌘K\'s runs the same (SV-25)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    // ⌘K's Mark all as read is the Inbox's own, as ⇧I is: the toast counts what it read.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('mark all');
    await page.keyboard.press('Enter');
    await page.locator('.toast', {hasText: 'Marked 14 as read'}).waitFor();
    await until('the server read them', () => counts(setpoint).then(value => [value.attention, value.unread].join()), value => value === '3,5', 5000);
    // Undo marks those 14 unread again, and they come back to the list.
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator('.toast').waitFor({state: 'detached'});
    await until('unread again', () => counts(setpoint).then(value => value.unread), value => value === 19, 15000);
    // Back in the list, not the header still folding away from before.
    await page.locator('.gh:not(.leaving)', {hasText: 'Noise'}).waitFor({timeout: 5000});
    // ⇧I says the same.
    await page.keyboard.press('Shift+I');
    await page.locator('.toast', {hasText: 'Marked 14 as read'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark all as read\'s Undo brings the 14 back at once, before the server\'s list has them, and ⇧I reads them again (SV-37)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.keyboard.press('Shift+I');
    await page.locator('.toast', {hasText: 'Marked 14 as read'}).waitFor();
    await until('the server read them', () => counts(setpoint).then(value => value.unread), value => value === 5, 5000);
    await until('Noise folds away', () => page.locator('.gh', {hasText: 'Noise'}).count(), count => count === 0);

    // The server's list answers only once released.
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route(/\/api\/mail\/inbox$/, async route => {
      await held;
      await route.continue();
    });
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await until('Noise is back at once', () => page.locator('.gh:not(.leaving)', {hasText: 'Noise'}).count(), count => count === 1);
    // Once the server has them unread and their changes are with the provider, ⇧I reads the same 14.
    await until('the server has them unread', () => counts(setpoint).then(value => value.unread), value => value === 19, 5000);
    await until('their changes are in', () => setpoint.api<AllOut>('GET', '/mail/all?limit=500'),
      all => !all.days.some(day => day.rows.some(row => row.command?.state === 'pending')), 5000);
    await page.keyboard.press('Shift+I');
    await page.locator('.toast', {hasText: 'Marked 14 as read'}).waitFor();
    await until('Noise folds away again', () => page.locator('.gh', {hasText: 'Noise'}).count(), count => count === 0);

    release();
    await until('the server read them again', () => counts(setpoint).then(value => value.unread), value => value === 5, 5000);
    await page.unroute(/\/api\/mail\/inbox$/);
    await until('the list agrees', () => page.locator('.gh', {hasText: 'Noise'}).count(), count => count === 0, 5000);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a code row: Copy puts the code on the clipboard, or says it couldn\'t, and the row leaves at its expiry', async () => {
  // The fixture's code expires 12 seconds after the seed's moment. The server's clock stays there and
  // the page's is the check's, so a slow start or a busy machine can't spend those seconds first.
  const setpoint = await startSetpoint({fixtures: ['code-expiring'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row, .list .arow').first().waitFor();
    // The page took the seed's moment from the server before this, so the code expires no later
    // than 12 seconds from here (and the app's 15 s clock first ticks later than that).
    const loaded = await page.evaluate(() => Date.now());
    // The page's clock runs on until the pause reaches it, and a pause can't go back, so it pauses a
    // little ahead of the time read: past what one round trip can take, well inside the 12 seconds.
    await page.clock.pauseAt(loaded + 2000);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    const row = page.locator('.row', {hasText: 'Contoso Insurance'});
    assert.equal(await row.locator('.code').textContent(), '482 913');
    await row.locator('button', {hasText: 'Copy'}).click();
    await row.locator('button', {hasText: 'Copied'}).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '482913');
    // Copied confirms in `good`: a 14% fill, its words and glyph `good` (inbox-11).
    const copied = row.locator('.copy.copied');
    const look = () => copied.evaluate(button => [getComputedStyle(button).backgroundColor, getComputedStyle(button).color, getComputedStyle(button.querySelector('.icon')!).color]);
    const green = [await page.evaluate(() => {
        const probe = document.body.appendChild(document.createElement('i'));
        probe.style.background = 'color-mix(in oklch, var(--good) 14%, transparent)';
        const colour = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return colour;
      }), await tokenColour(page, 'good'), await tokenColour(page, 'good')];
    // Its fill and words change over 120 ms.
    await until('Copied in good', look, seen => JSON.stringify(seen) === JSON.stringify(green));
    assert.equal(await page.locator('.pane').count(), 0, 'Copy doesn\'t open the email');
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
    // It leaves the Inbox at its expiry, without a reload (the server's own list is mail.test.ts's),
    // and not up to 15 s later on the app's clock; its last minute counts down in seconds (inbox-11).
    const countdown = row.locator('.sum');
    const seconds = Number(/^Expires in (\d+) sec$/.exec((await countdown.textContent())!)?.[1]);
    assert.ok(seconds > 0 && seconds <= 12, `${seconds} seconds left`);
    assert.equal(await countdown.evaluate(element => getComputedStyle(element).color), await tokenColour(page, 'caution'));
    // A second later it reads one less.
    await page.clock.runFor(1000);
    await until('a second less', () => countdown.textContent(), text => text === `Expires in ${seconds - 1} sec`);
    await page.clock.runFor(loaded + 12_000 + 400 - await page.evaluate(() => Date.now()));
    // Its fold out has begun (its end waits on the paused clock).
    await until('the code row leaves', () => page.locator('.row:not(.leaving)', {hasText: 'Contoso Insurance'}).count(), count => count === 0);
    await page.clock.resume();
    await until('the code row gone', () => row.count(), count => count === 0);
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
    assert.match((await element.getAttribute('src'))!, /^\/api\/mail\/messages\/\d+\/body$/);
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

    // Show was for this time: opened again (from All, now that it's read), they're hidden again.
    await page.keyboard.press('Escape');
    await until('the pane collapses', () => page.locator('.pane').count(), count => count === 0);
    await page.locator('.seg button', {hasText: 'All'}).click();
    // Today's Noise is folded in All (#48): open it first.
    await page.locator('.list.all .nfold').first().click();
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
 * nothing scrolls inside it), and how far the email's end is from the frame's bottom (a zoomed
 * email ends on a fraction of a pixel, which the frame rounds up).
 */
const fit = (page: Page) => page.frameLocator('iframe.mailframe').locator('html').evaluate(root => {
  const end = root.querySelector('setpoint-end');
  return [root.scrollWidth - innerWidth, root.scrollHeight - innerHeight, end ? Math.round(innerHeight - end.getBoundingClientRect().bottom) : -1];
}).catch(() => [-1, -1, -1]);
const fits = ([across, down, below]: number[]) => across === 0 && down === 0 && (below === 0 || below === 1);
const picturesLoaded = (page: Page) => page.frameLocator('iframe.mailframe').locator('img')
  .evaluateAll(images => images.filter(image => (image as HTMLImageElement).naturalWidth > 0).length).catch(() => -1);

test('a newsletter that is mostly pictures: the frame grows to the whole email, as wide as the pane, with no scrollbars of its own', async () => {
  const setpoint = await startSetpoint({fixtures: ['newsletter-html']});
  try {
    const page = await load(setpoint);
    await fakePictures(page);
    const element = page.locator('iframe.mailframe');
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    await page.locator('.imgbar', {hasText: 'Images hidden'}).waitFor();
    // Hidden, the frame is as wide as the reading pane's body (the images bar's width), wider than
    // the 622 px the email was built at, and exactly as tall as the email.
    await until('the hidden newsletter fits its frame', () => fit(page), fits);
    // Measured where the pane rests, once its content has slid in.
    await still(page);
    const width = (await page.locator('.imgbar').boundingBox())!.width;
    assert.ok(width > 622, `the images bar is ${width} px wide`);
    assert.equal((await element.boundingBox())!.width, width);

    await page.locator('.imgbar').getByRole('button', {name: 'Show', exact: true}).click();
    await until('the pictures load', () => picturesLoaded(page), count => count === 4);
    // Shown, the frame grows with the pictures: over a thousand pixels, not a short box with its
    // own scrollbars.
    await until('the newsletter fits its frame', () => fit(page), fits);
    const shown = (await element.boundingBox())!;
    assert.ok(shown.height > 1000, `the frame is ${shown.height} px tall`);
    assert.equal(shown.width, width);
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
    const frame = (await page.locator('iframe.mailframe').boundingBox())!;
    assert.equal(frame.width, 350);
    // 622 px zoomed into 350: the pictures' 1060 px come to under 600, and the frame follows.
    assert.ok(frame.height > 550 && frame.height < 750, `the frame is ${frame.height} px tall`);
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
    await page.locator('.arow', {hasText: 'Your recovery email was changed'}).click();
    await page.locator('.protected-line', {hasText: 'Protected · always stays in Attention'}).waitFor();
    assert.equal(await page.locator('.facts .unfamiliar').textContent(), '· not a place you use');
    // Others propose.
    await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
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
    // At least 280 wide, wider to show the whole name; 44 tall.
    const box = (await card.boundingBox())!;
    assert.ok(box.width >= 280 && box.height === 44, `the card is ${box.width} × ${box.height}`);
    assert.equal(await card.locator('.name').evaluate(name => name.scrollWidth <= name.clientWidth), true, 'the whole name shows');
    await card.click();
    await page.locator('.attach-preview iframe.preview-pdf').waitFor();
    const response = await served;
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'application/pdf');
    assert.match(response.headers()['content-disposition']!, /^inline; filename="Renewal agreement.pdf"/);
    await page.keyboard.press('Escape');
    await until('the preview closes', () => page.locator('.attach-preview').count(), count => count === 0);
    assert.equal(await page.locator('.pane').count(), 1, 'the reader stays');
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
    // At least 280 wide, wider to show the whole name; 44 tall.
    const box = (await card.boundingBox())!;
    assert.ok(box.width >= 280 && box.height === 44, `the card is ${box.width} × ${box.height}`);
    assert.equal(await card.locator('.name').evaluate(name => name.scrollWidth <= name.clientWidth), true, 'the whole name shows');
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
    // An archive's tile is warm, with folder_zip (#163).
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

/** A background as the page computes it, mixes included. */
const backgroundOf = (page: Page, background: string) => page.evaluate(value => {
  const probe = document.createElement('div');
  probe.style.background = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return computed;
}, background);

test('#163: an attachment\'s type tile says what it is in its colour and glyph, Download carries its glyph, and the pointer lifts the card', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    const card = page.locator('.attach', {hasText: 'Renewal agreement.pdf'});
    const tile = card.locator('.type');
    await tile.waitFor();
    assert.equal(await card.evaluate(element => getComputedStyle(element).padding), '0px 8px 0px 7px');
    // 30 px, radius 8, concentric in the 44 px card (7 px from its edges), 12 px before the name.
    assert.deepEqual(await tile.evaluate(element => {
      const box = element.getBoundingClientRect();
      const outer = element.closest('.attach')!.getBoundingClientRect();
      const names = element.closest('.attach')!.querySelector('.names')!.getBoundingClientRect();
      return [box.width, box.height, getComputedStyle(element).borderRadius, box.left - outer.left, box.top - outer.top, names.left - box.right];
    }), [30, 30, '8px', 7, 7, 12]);
    const alert = await tokenColour(page, 'alert');
    assert.deepEqual(await glyphs(tile.locator('.icon')), [['picture_as_pdf', '18', alert]]);
    assert.equal(await tile.evaluate(element => getComputedStyle(element).backgroundColor), await backgroundOf(page, 'color-mix(in oklch, var(--alert) 14%, transparent)'));
    const download = card.locator('.dl');
    assert.deepEqual(await glyphs(download.locator('.icon')), [['download', '16', await tokenColour(page, 'ink2')]]);
    assert.deepEqual(await download.evaluate(element => [getComputedStyle(element).columnGap, getComputedStyle(element).padding]), ['6px', '0px 10px 0px 8px']);
    // Under the pointer: the tile deepens to 22%, the eye turns ink, and in Night the card lifts to cardOn.
    await card.locator('.names').hover();
    const deeper = await backgroundOf(page, 'color-mix(in oklch, var(--alert) 22%, transparent)');
    await until('the tile deepens', () => tile.evaluate(element => getComputedStyle(element).backgroundColor), colour => colour === deeper);
    const [ink, cardOn] = [await tokenColour(page, 'ink'), await backgroundOf(page, 'var(--cardOn)')];
    await until('the eye turns ink', () => card.locator('.look').evaluate(element => getComputedStyle(element).color), colour => colour === ink);
    await until('the card lifts', () => card.evaluate(element => getComputedStyle(element).backgroundColor), colour => colour === cardOn);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the pattern prompt sits at the end of Attention; No answers it and it goes', async () => {
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
    // The last thing in Attention: after Contoso University, before Security.
    const order = await page.locator('.list > *').evaluateAll(nodes => nodes.map(node => (node.classList.contains('prompt') ? 'prompt' : node.textContent!.trim().slice(0, 18))));
    const at = order.indexOf('prompt');
    assert.match(order[at - 1]!, /^Contoso University/);
    assert.match(order[at + 1]!, /^Security/i);
    await prompt.locator('button', {hasText: 'No'}).click();
    await until('it goes', () => prompt.count(), count => count === 0);
    assert.deepEqual(answers, [{answer: 'no'}]);
    // No keeps it quiet for good, on the server too, once the browser's answer lands.
    await until('the server has the answer', () => setpoint.api<unknown[]>('GET', '/mail/prompts'), prompts => prompts.length === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('All: every email by day with clock times, grouped by lane, Noise folded per day; opening one reads it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, '/inbox/all');
    // The Pinned shelf, then the days (D105).
    assert.deepEqual((await page.locator('.list.all .gh').allTextContents()).slice(0, 4), ['Pinned 1', 'Today Wed, Oct 7', 'Yesterday Tue, Oct 6', 'Mon Oct 5']);
    // Decided while building #48: today's lanes, the kind once where an FYI run starts.
    assert.deepEqual((await page.locator('.list.all .lh').allTextContents()).slice(0, 2), ['Attention 2', 'FYI 8']);
    assert.equal(await page.locator('.list.all .row', {hasText: 'Contoso Insurance'}).first().locator('.kd').textContent(), 'Security');
    assert.equal(await page.locator('.list.all .row', {hasText: 'New sign-in'}).first().locator('.kd').textContent(), '');
    // The summary takes the subject's place, as in the Inbox; the subject is the row's tooltip.
    const fabrikam = page.locator('.list.all .row', {hasText: 'Fabrikam'}).first();
    assert.equal(await fabrikam.locator('.subj').textContent(), 'Data Analyst · via Workday');
    assert.equal(await fabrikam.getAttribute('title'), 'Application received');
    // The pinned lease is on the shelf only, with its age.
    assert.deepEqual(await page.locator('.list.all .row[title="Lease renewal terms"]').evaluateAll(rows => rows.map(row => [row.classList.contains('shelf'), row.querySelector('.age')!.textContent])),
      [[true, 'Sep 30']]);
    // Today's Noise is one line; J and K stop on it, and Enter opens it in place.
    const coffee = page.locator('.list.all .row', {hasText: 'Contoso Coffee'});
    const noise = page.locator('.list.all .nfold').first();
    assert.equal(await noise.textContent(), 'Noise 3Tailspin Toys · Contoso Coffee · Litware');
    assert.equal(await coffee.count(), 0);
    // J stops on the shelf's row first.
    for (let press = 0; press < 12; press++) await page.keyboard.press('j');
    await page.locator('.list.all .nfold.cur').waitFor();
    await page.keyboard.press('Enter');
    await coffee.waitFor();
    assert.equal(await coffee.locator('.age').textContent(), '6:05 AM');
    await coffee.click();
    await page.locator('.rd-subj', {hasText: 'The Contoso Coffee Journal'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === 18);
    // The server reads it first; the row follows when the list refreshes.
    await until('the row reads as read', () => coffee.getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    // The kind drops while the reading pane is open; the account never does.
    assert.equal(await page.locator('.list.all .row', {hasText: 'Contoso Insurance'}).first().locator('.kd').isVisible(), false);
    assert.equal(await coffee.locator('.ac').isVisible(), true);
    // Trash folds the row out at once, as in Unread, and ⌘Z folds it back in.
    await page.keyboard.press('Escape');
    const lease = page.locator('.list.all .row[title="Lease renewal terms"]');
    await point(lease);
    await page.keyboard.press('e');
    await page.locator('.list.all .row.leaving[title="Lease renewal terms"]').waitFor();
    await until('it folds away', () => lease.count(), count => count === 0);
    await page.keyboard.press('Meta+z');
    await until('⌘Z brings it back', () => lease.count(), count => count === 1, 5000);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('#160: each lane\'s header leads with its glyph, 14 px in ink3 and 8 px before its label, Attention\'s flag in caution; All\'s kind column draws it at 13 px', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const [ink3, caution] = [await tokenColour(page, 'ink3'), await tokenColour(page, 'caution')];
    const headers = page.locator('.list .gh');
    const labels = await headers.evaluateAll(all => all.map(header => header.querySelector('.gi')!.nextSibling!.textContent));
    assert.deepEqual(labels, ['Pinned', 'Attention', 'Security', 'Deliveries', 'Money', 'Career', 'Noise']);
    assert.deepEqual(await glyphs(headers.locator('.gi .icon')), [
      ['keep', '14', ink3], ['flag', '14', caution], ['lock', '14', ink3], ['local_shipping', '14', ink3], ['payments', '14', ink3], ['work', '14', ink3], ['campaign', '14', ink3],
    ]);
    // The label starts 8 px after the glyph, as the header's other parts are spaced.
    const gaps = await headers.evaluateAll(all => all.map(header => {
      const glyph = header.querySelector('.gi')!;
      const range = document.createRange();
      range.selectNode(glyph.nextSibling!);
      return Math.round(range.getBoundingClientRect().left - glyph.getBoundingClientRect().right);
    }));
    assert.deepEqual(new Set(gaps), new Set([8]));
    // All: the Pinned shelf's header the same, and each kind word after its group's glyph at 13 px.
    await page.goto(`${setpoint.base}/inbox/all`);
    await page.locator('.list.all .row').first().waitFor();
    assert.deepEqual(await glyphs(page.locator('.list.all .gh .gi .icon')), [['keep', '14', ink3]]);
    const kinds = page.locator('.list.all .row .kd:has(.icon)');
    assert.deepEqual((await kinds.allTextContents()).slice(0, 4), ['Security', 'Deliveries', 'Money', 'Career']);
    assert.deepEqual((await glyphs(kinds.locator('.icon'))).slice(0, 4), [['lock', '13', ink3], ['local_shipping', '13', ink3], ['payments', '13', ink3], ['work', '13', ink3]]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('All\'s Pinned shelf (D105): P on a day\'s row moves it to the shelf at once, and Unpin puts it back in its day', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint, '/inbox/all');
    const shelf = () => page.locator('.list.all .row.shelf .from').allTextContents();
    const bank = page.locator('.list.all .row', {hasText: 'Checking ending in 1234'});
    assert.deepEqual(await shelf(), ['Parkside Apartments']);
    assert.equal(await bank.count(), 1);
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
    assert.equal(await page.locator('.list.all .gh').first().textContent(), 'Pinned 2');
    await until('it leaves its day', () => page.locator('.list.all .row:not(.shelf)', {hasText: 'Checking ending in 1234'}).count(), count => count === 0);
    release();
    const id = await idOf(setpoint, 'Statement ready');
    await until('the server pinned it', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => message.pinned);
    // Unpin under the pointer, in the age's place, puts it back in its day.
    const pinned = page.locator('.list.all .row.shelf', {hasText: 'Checking ending in 1234'});
    assert.equal(await pinned.locator('.age').textContent(), '5h');
    await pinned.hover();
    await pinned.locator('.unpin').click();
    await until('it leaves the shelf', () => shelf(), rows => rows.join() === 'Parkside Apartments');
    await until('back in its day', () => page.locator('.list.all .row:not(.shelf)', {hasText: 'Checking ending in 1234'}).count(), count => count === 1);
    await until('the server unpinned it', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => !message.pinned);
    assert.equal(await page.locator('.rd-subj').count(), 0, 'unpinning from the shelf opens nothing');
    await page.unroute('**/api/mail/messages/*/pin');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('going to the Inbox opens All once nothing waits in Unread, from the sidebar, 1 and the bare address; Unread while anything does (D106)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    const path = () => Promise.resolve(new URL(page.url()).pathname);
    // With mail waiting, the sidebar's Inbox from the Calendar opens Unread.
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-grid').waitFor();
    await page.locator('.sb .nav', {hasText: 'Inbox'}).click();
    await page.locator('.list .arow').first().waitFor();
    assert.equal(await path(), '/inbox');
    // Nothing waiting: Security read, Mark all as read, then Done on each Attention email.
    await readSecurity(setpoint);
    await setpoint.api('POST', '/mail/mark-all-read', {});
    await until('Mark all as read confirmed', () => counts(setpoint), value => value.unread === value.attention - 1 && value.unread_fyi === 0);
    const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
    for (const row of inbox.groups.find(group => group.group === 'attention')!.rows) await setpoint.api('POST', `/mail/messages/${row.id}/done`, {done: true});
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-grid').waitFor();
    await until('the sidebar has the counts', () => page.locator('.nav:has-text("Inbox") .cnt').count(), count => count === 0);
    await page.locator('.sb .nav', {hasText: 'Inbox'}).click();
    await page.locator('.list.all .row').first().waitFor();
    assert.equal(await path(), '/inbox/all');
    // Within the Inbox, Unread is still there to pick: "All caught up".
    await page.locator('.hd .seg button', {hasText: 'Unread'}).click();
    await page.locator('.empty-line', {hasText: 'All caught up'}).waitFor();
    assert.equal(await path(), '/inbox');
    // 1 from the Calendar.
    await page.keyboard.press('2');
    await page.locator('.cal-grid').waitFor();
    await page.keyboard.press('1');
    await until('All', path, value => value === '/inbox/all');
    // The bare address, once the counts have come.
    await page.goto(`${setpoint.base}/`);
    await until('All', path, value => value === '/inbox/all');
    await page.locator('.list.all .row').first().waitFor();
    // An address naming Unread keeps it.
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.empty-line', {hasText: 'All caught up'}).waitFor();
    assert.equal(await path(), '/inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('U on the Inbox switches Unread and All, its hint on the one it switches to; ⌘K offers it with its key; 1 goes to the Inbox from elsewhere and does nothing on it (#105)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    assert.deepEqual(await page.locator('.hd .seg button').allTextContents(), ['Unread', 'AllU']);
    await page.keyboard.press('u');
    await page.locator('.list.all .row').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox/all');
    assert.deepEqual(await page.locator('.hd .seg button').allTextContents(), ['UnreadU', 'All']);
    await page.keyboard.press('1');
    // Nothing happens to wait for: 1 no longer switches.
    await page.waitForTimeout(200);
    await setpoint.idle();
    assert.equal(new URL(page.url()).pathname, '/inbox/all');
    await page.keyboard.press('u');
    await page.locator('.list .arow').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox');
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('show');
    assert.deepEqual(await page.locator('.palette .item').allTextContents(), ['Show AllU']);
    await page.keyboard.press('Enter');
    await page.locator('.list.all .row').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox/all');
    // From the Calendar, 1 goes to the Inbox's Unread, as before.
    await page.keyboard.press('2');
    await page.locator('.cal-grid').waitFor();
    await page.keyboard.press('1');
    await page.locator('.list .arow').first().waitFor();
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
    const pane = page.locator('.pane');
    const paneWidth = async () => Math.round((await pane.boundingBox())!.width);
    await page.locator('.row', {hasText: 'New sign-in'}).click();
    await page.locator('.rd-subj', {hasText: 'Security alert'}).waitFor();
    assert.equal(await paneWidth(), 680);

    const drag = async (dx: number) => {
      const edge = (await page.locator('.pane-edge').boundingBox())!;
      const at = {x: edge.x + edge.width / 2, y: edge.y + 200};
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      for (let step = 1; step <= 5; step += 1) await page.mouse.move(at.x + dx * step / 5, at.y);
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

    // At its narrowest, the tools keep previous, next and More in the pane, with Done and More both
    // shown: the key hints drop (the keys still work), the labels stay.
    await page.locator('.pane-edge').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await paneWidth(), 480);
    await page.locator('.arow', {hasText: 'Your recovery email was changed'}).click();
    await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    const tools = page.locator('.rd-tools');
    const hints = () => tools.locator('.tool .kbd').evaluateAll(kbds => kbds.map(kbd => kbd.checkVisibility()));
    assert.deepEqual((await tools.locator('.tool').allInnerTexts()).map(text => text.trim()), ['Done', 'Trash', 'Pin', 'Open in Gmail']);
    assert.deepEqual(await hints(), [false, false, false, false]);
    const right = (await pane.boundingBox())!.x + 480;
    for (const name of ['Previous email', 'Next email', 'More']) {
      const button = (await tools.getByRole('button', {name, exact: true}).boundingBox())!;
      assert.ok(button.x + button.width <= right, `${name} ends at ${button.x + button.width}, inside the pane's ${right}`);
    }
    // Wide enough again, the hints come back.
    await page.locator('.pane-edge').focus();
    for (let step = 0; step < 8; step += 1) await page.keyboard.press('ArrowLeft');
    assert.equal(await paneWidth(), 608);
    assert.deepEqual(await hints(), [true, true, true, true]);
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
    await point(page.locator('.arow', {hasText: 'Northwind Talent'}));
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

test('S8 (SV-25, D54): offline, opening an email shows no failure toast: the offline pill already says changes are refused', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const northwind = await idOf(setpoint, 'Interview availability');
    await page.context().setOffline(true);
    await page.locator('.offline-pill').waitFor();
    // Back to an unread email (as Back or a link would): opening it would mark it read.
    await page.evaluate(id => {
      history.pushState(null, '', `/inbox/${id}`);
      dispatchEvent(new PopStateEvent('popstate'));
    }, northwind);
    await page.locator('.pane').waitFor();
    // Nothing happens to wait for: no failure toast comes.
    await page.waitForTimeout(500);
    await setpoint.idle();
    assert.equal(await page.locator('.toast').count(), 0);
    await page.context().setOffline(false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Pin and Mark all as read show at once, before the server has them', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route(/\/api\/mail\/(messages\/\d+\/pin|mark-all-read)$/, async route => {
      await held;
      await route.continue();
    });
    const shelf = () => page.locator('.row.shelf').allTextContents();

    // P on Northwind's row: on the shelf at once.
    await point(page.locator('.arow', {hasText: 'Northwind Talent'}));
    await page.keyboard.press('p');
    await until('Northwind joins the shelf', () => shelf(), rows => rows.some(text => text.includes('Pick a 30-minute slot this week')));

    // ⇧I: FYI and Noise read and fold away at once, and the sidebar's count drops.
    await page.keyboard.press('Shift+I');
    await until('the FYI groups go', () => page.locator('.gh', {hasText: 'Deliveries'}).count(), count => count === 0);
    const pinned = (await setpoint.api<InboxOut>('GET', '/mail/inbox')).groups.find(group => group.group === 'pinned')!;
    assert.equal(pinned.rows.length, 1, 'the server doesn\'t have the pin yet');

    release();
    await until('the server has both', () => setpoint.api<InboxOut>('GET', '/mail/inbox'),
      inbox => inbox.groups.find(group => group.group === 'pinned')!.rows.length === 2 && !inbox.groups.some(group => group.group === 'deliveries'));
    await until('the shelf keeps it', () => shelf(), rows => rows.length === 2);
    await page.unroute(/\/api\/mail\/(messages\/\d+\/pin|mark-all-read)$/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('after Mark all as read, a load answered before the provider confirms leaves FYI and Noise gone (SV-41)', async () => {
  // The dev provider holds every change while this file is there, so the check, not how fast the
  // load comes, makes sure the load is answered before the provider confirms.
  const holdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-hold-'));
  const hold = path.join(holdDir, 'hold');
  fs.writeFileSync(hold, '');
  const setpoint = await startSetpoint({env: {SETPOINT_DEV_PROVIDER_HOLD: hold}});
  try {
    const page = await load(setpoint);
    const noise = page.locator('.gh:not(.leaving)', {hasText: 'Noise'});
    await noise.waitFor();
    const answered = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/mail/mark-all-read'));
    await page.keyboard.press('Shift+I');
    await answered;
    await until('Noise folds away at once', () => noise.count(), count => count === 0);

    // From here on, note whether a Noise header shows again.
    await page.evaluate(() => {
      const shows = () => [...document.querySelectorAll('.gh:not(.leaving)')].some(header => header.textContent?.includes('Noise'));
      const state = window as unknown as {noiseBack: boolean};
      state.noiseBack = shows();
      new MutationObserver(() => {
        state.noiseBack ||= shows();
      }).observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true});
    });
    // A load while the provider is held: focus refreshes the Inbox.
    const loaded = page.waitForResponse(response => response.request().method() === 'GET' && /\/api\/mail\/inbox$/.test(response.url()));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await loaded;
    const markAllPending = (commands: {kind: string; state: string}[]) => commands.some(command => command.kind === 'mark_all_read' && command.state === 'pending');
    assert.ok(markAllPending(await setpoint.api('GET', '/commands')), 'the provider was still confirming when the load answered');

    // Only now does the provider confirm.
    fs.rmSync(hold);
    await until('the provider confirms', () => setpoint.api<{kind: string; state: string}[]>('GET', '/commands'), commands => !markAllPending(commands));
    await until('the server read them', () => counts(setpoint).then(value => value.unread), value => value === 5, 5000);
    await until('the list has the server\'s answer', () => page.locator('.nav:has-text("Inbox") .cnt').textContent(), text => text === '5');
    assert.equal(await page.evaluate(() => (window as unknown as {noiseBack: boolean}).noiseBack), false, 'Noise came back before the provider confirmed');
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
    await page.locator('.arow', {hasText: 'Your recovery email was changed'}).click();
    await until('Google read', () => unreadCount(page), text => text === '18');
    await page.keyboard.press('Shift+U');
    await page.locator('.pane').waitFor({state: 'detached'});
    await until('unread again', () => unreadCount(page), text => text === '19', 5000);
    await page.locator('.arow.unread', {hasText: 'Your recovery email was changed'}).waitFor();
    // ⌘K's Mark unread shows the key.
    await page.locator('.arow', {hasText: 'Your recovery email was changed'}).click();
    await page.locator('.rd-subj').waitFor();
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('mark unread');
    assert.match(await page.locator('.palette [role="option"]', {hasText: 'Mark unread'}).first().textContent() ?? '', /⇧U/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #15: a filtered Inbox names its account in the header, and the sidebar\'s Inbox keeps Unread or All', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.sb .acct', {hasText: 'Business'}).click();
    await until('the header names it', () => page.locator('.hd-title').textContent(), text => text === 'Inbox · Business');
    // All, then the sidebar's Inbox: every account, still All.
    await page.keyboard.press('u');
    await until('All', () => Promise.resolve(new URL(page.url()).pathname), path => path.includes('all'));
    const all = new URL(page.url()).pathname;
    await page.locator('.sb .nav', {hasText: 'Inbox'}).click();
    await until('every account', () => page.locator('.hd-title').textContent(), text => text === 'Inbox');
    assert.match(new URL(page.url()).pathname, /all/, `still All after ${all}`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #16 and #17: Mark all as read\'s footer goes once nothing is left to mark, and ⌘Z undoes it as the toast\'s Undo does', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    const footer = page.locator('.listfoot .lnk', {hasText: 'Mark all as read'});
    await footer.waitFor();
    await page.keyboard.press('Shift+I');
    await page.locator('.toast', {hasText: 'Marked 14 as read'}).waitFor();
    await until('the server read them', () => counts(setpoint).then(value => value.unread), value => value === 5, 5000);
    // Attention's and Security's unread are left, which Mark all as read doesn't touch: no footer.
    await until('the footer goes', () => footer.count(), count => count === 0);
    await page.keyboard.press('Meta+z');
    await until('unread again', () => counts(setpoint).then(value => value.unread), value => value === 19, 15000);
    // ⌘Z takes the toast away as its Undo does: it fades out over 120 ms, then goes.
    await page.locator('.toast').waitFor({state: 'detached'});
    await footer.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a long account label: the account column fits the longest, every row\'s account lines up and stays clear of its age', async () => {
  const setpoint = await startSetpoint();
  try {
    const business = (await setpoint.api<AccountOut[]>('GET', '/accounts')).find(account => account.label === 'Business')!;
    await setpoint.api('PATCH', `/accounts/${business.id}`, {label: 'Business (Studio)'});
    for (const path of ['/inbox', '/inbox/all']) {
      const page = await load(setpoint, path);
      const rows = await page.locator('.list .row').evaluateAll(rows => rows.filter(row => row.querySelector('.ac .label')?.textContent).map(row => {
        const ac = row.querySelector('.ac')!.getBoundingClientRect();
        const label = row.querySelector('.ac .label') as HTMLElement;
        const age = row.querySelector('.age')!.getBoundingClientRect();
        return {label: label.textContent, left: Math.round(ac.left), cut: label.scrollWidth > label.clientWidth, gap: Math.round(age.left - label.getBoundingClientRect().right)};
      }));
      assert.ok(rows.some(row => row.label === 'Business (Studio)'), `${path}: ${JSON.stringify(rows)}`);
      for (const row of rows) {
        assert.ok(!row.cut, `${path}: ${row.label} whole`);
        assert.ok(row.gap >= 0, `${path}: ${row.label} clear of its age (${row.gap} px)`);
      }
      assert.equal(new Set(rows.map(row => row.left)).size, 1, `${path}: the accounts line up`);
      await page.close();
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
