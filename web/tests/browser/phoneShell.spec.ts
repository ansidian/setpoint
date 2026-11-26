// The phone's shell at 390 × 844 (board 21): board 21's three phones (the Inbox after reading
// Northwind, the reader on it, the agenda), the one column and its tab bar, and every kind of deep
// link an ntfy notification carries (`deepLinkPath`): an email, an event, one occurrence of a
// recurring event, a task's day, and a Settings page. Sign-in's fields are 16 px, so iOS doesn't
// zoom into them. The web manifest opens Setpoint standalone (News is phoneNews.spec.ts's).
// Settings is a page: an index of Places, Notifications and Appearance, each under Back to it, the
// others on the desktop and listing those, and Sign out.
import assert from 'node:assert/strict';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {after} from 'node:test';
import type {AllOut, ItemsOut, Settings} from '@setpoint/shared';
import {deepLinkPath} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, holdToast, rested, startSetpoint, test, until} from './harness.ts';
import {box, counts, email, fingertips, inbox, instantScrolls, saveDraft, scrollsAsked} from './phoneHelpers.ts';

after(cleanUp);

/** The agenda's topmost day whose line still shows, its first for folded empty days. */
const topDay = (page: Page) => page.locator('.ph-agenda').evaluate(list => {
  const top = list.getBoundingClientRect().top;
  return ([...list.querySelectorAll<HTMLElement>('.ph-day')].find(day => day.getBoundingClientRect().bottom > top + 1)?.dataset.days ?? '').split(' ')[0];
});

test('board 21: the Inbox after reading Northwind, the reader on it, and the agenda', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.list .row:has(b[data-tip^="Interview availability"])').tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // Opening it read it: 18.
    await until('the server read it', () => counts(setpoint), value => value.unread === 18);

    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    await page.locator('.list .row:not(.unread):has(b[data-tip^="Interview availability"])').waitFor();

    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/calendar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('signing in on the phone: every field\'s text is 16 px, so iOS doesn\'t zoom the page', async () => {
  const setpoint = await startSetpoint({claim: false});
  try {
    const page = await setpoint.page('iphone');
    const sizes = () => page.locator('.sign-in .input').evaluateAll(inputs => inputs.map(input => [input.getAttribute('aria-label'), getComputedStyle(input).fontSize]));
    await page.goto(`${setpoint.base}/inbox`);
    await page.getByLabel('Setup token').waitFor();
    assert.deepEqual(await rested(() => sizes()), [['Setup token', '16px'], ['New password', '16px']]);
    // Claimed (elsewhere), the card asks for the password, then a recovery code and a new password.
    await setpoint.api('POST', '/auth/claim', {setup_token: setpoint.setupToken, password: 'a long enough password'});
    await page.reload();
    await page.getByLabel('Password').waitFor();
    assert.deepEqual(await rested(() => sizes()), [['Password', '16px']]);
    // A thumb's sizes: the field, Sign in under it and the recovery code's way in under that.
    await fingertips([page.getByLabel('Password'), page.getByRole('button', {name: 'Sign in'}), page.getByRole('button', {name: 'Use a recovery code'})]);
    await page.getByRole('button', {name: 'Use a recovery code'}).click();
    await page.getByLabel('Recovery code').waitFor();
    assert.deepEqual(await rested(() => sizes()), [['Recovery code', '16px'], ['New password', '16px']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('every control a finger needs takes a 44 px tap, and none takes its neighbour\'s: the Inbox, the reader, compose, the toast and Settings', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.list .nfold').first().waitFor();
    await fingertips([page.locator('.hd .ph-title-btn'), page.getByRole('button', {name: 'Select'}), page.getByRole('button', {name: 'New message'}),
      page.locator('.list .nfold').first(), page.locator('.list .code-line .copy').first()]);
    await page.locator('.hd > .search input').fill('tailspin');
    await fingertips([page.getByRole('button', {name: 'Clear search'})]);

    // The reader's stack: a collapsed line, an email's •••, the foot's Reply and its Draft line; then Trash's Undo.
    const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
    const cabin = all.days.flatMap(day => day.rows).filter(row => row.from_name === 'Theo Walsh' && row.subject.endsWith('Cabin weekend in November'))
      .sort((one, other) => other.received_at.localeCompare(one.received_at))[0]!.id;
    await page.goto(`${setpoint.base}/inbox/${cabin}`);
    await fingertips([page.locator('.cv-line').first(), page.locator('.cv-mail.opened .cv-tools button'), page.locator('.cv-foot .cv-reply'),
      page.locator('.ph-back'), page.getByRole('button', {name: 'Pin'})]);
    await page.locator('.ph-acts button', {hasText: 'Reply'}).tap();
    const reply = page.getByRole('dialog', {name: 'Reply'});
    await reply.locator('.cmp-from > button').waitFor();
    // Reply's bar and header: Cancel, Send, the reply's kind, From, Cc Bcc, a recipient's ×, and the quote's fold.
    await fingertips([reply.getByRole('button', {name: 'Cancel'}), reply.getByRole('button', {name: 'Send'}), reply.locator('.cmp-copies'),
      reply.locator('.cmp-from > .btn'), reply.locator('.cmp-chip-x').first(), reply.locator('.cmp-fold')]);
    // Something typed, so Save draft keeps it as the foot's Draft line.
    await page.keyboard.type('Thanks.');
    await saveDraft(reply);
    await reply.waitFor({state: 'detached'});
    await fingertips([page.locator('.cv-foot .cv-draft')]);
    await page.locator('.ph-acts button', {hasText: 'Trash'}).tap();
    const toast = await holdToast(page);
    const undo = toast.getByRole('button', {name: 'Undo'});
    // Once the reader's slide back to the list is over, the page takes taps again.
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    await until('the toast takes taps', () => undo.evaluate(button => { const box = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)); }), takes => takes);
    await fingertips([undo]);
    await toast.getByRole('button', {name: 'Undo'}).tap();

    await page.goto(`${setpoint.base}/settings/notifications`);
    await page.getByRole('switch', {name: 'FYI mail'}).waitFor();
    await fingertips([page.locator('.hd .ph-back'), page.getByRole('switch', {name: 'FYI mail'}), page.getByRole('button', {name: 'Set token'}), page.getByRole('button', {name: 'Event reminders'}),
      page.getByRole('button', {name: 'Sign out'})]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone\'s one column: no sidebar, the tab bar, the reader over everything, dates on one line, nothing scrolls sideways', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    assert.equal(await page.locator('.sb').count(), 0);
    assert.deepEqual(await page.locator('.ph-tab').allTextContents(), ['Inbox', 'Agenda', 'News']);
    // The list, as on the desktop: Attention, the Pinned shelf, then the days, Today first.
    const headers = (await page.locator('.gh').allTextContents()).map(text => text.trim().split(/\s/)[0]!.toLowerCase());
    assert.deepEqual(headers.slice(0, 3), ['attention', 'pinned', 'today']);
    // The Inbox's rows carry no account (the reader's band names it). The Pinned row's "Sep 30" stays on one line.
    assert.equal(await page.locator('.list .row .ac').count(), 0);
    const age = await box(page, '.row.shelf .age');
    assert.ok(age.height < 20, `the age is one line (${age.height}px)`);
    // Two lines a row: the sender and age, then the subject under the sender, both readable.
    const [from, subject] = [await box(page, '.row.shelf .from'), await box(page, '.row.shelf .subj')];
    assert.ok(subject.y >= from.y + from.height, 'the subject sits under the sender');
    assert.equal(await page.locator('.row.shelf .from').evaluate(text => text.scrollWidth <= text.clientWidth), true, '"Parkside Apartments" whole');
    // … and the subject takes the row's whole width under it (at the list's 15 px, a long one
    // wraps to a second line and ends in "…" past it).
    const [shelf, line] = [await box(page, '.row.shelf'), await box(page, '.row.shelf .subj')];
    assert.equal(line.x, from.x, 'the subject starts under the sender');
    assert.equal(Math.round(line.x + line.width), shelf.x + shelf.width - 16, 'and runs to the row\'s end');
    const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.equal(scroll[0], scroll[1]);
    // The reader takes the whole screen, with Back.
    await page.locator('.list .row:has(b[data-tip^="Final exam schedule"])').tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    assert.deepEqual(await box(page, '.pane'), {x: 0, y: 0, width: 390, height: 844});
    assert.equal(await page.locator('.rd-tools').isVisible(), false);
    assert.deepEqual(await page.locator('.ph-acts button').allTextContents(), ['Done', 'Reply', 'More']);
    await page.locator('.ph-back').tap();
    await until('Back closes it', () => page.locator('.pane').count(), count => count === 0);
    assert.equal(new URL(page.url()).pathname, '/inbox');
    // No ⌘K and no Settings modal on the phone.
    await page.keyboard.press('Meta+k');
    await page.keyboard.press('Meta+,');
    // Nothing happens to wait for: neither opens.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await page.locator('.palette, .settings').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('deep links at the iPhone size: an email, an event, one occurrence, a task\'s day, a later day, and Settings', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const northwind = await email(setpoint, 'Interview availability');
    const {items} = await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-15');
    const dentist = items.find(item => item.title === 'Dentist')!;
    const gymFriday = items.find(item => item.title === 'Gym' && item.occurrence_start?.startsWith('2026-10-09'))!;
    const page = await setpoint.page('iphone');

    // An email (an attention notification, mantel's popover): open, full screen, and read.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id: northwind})}`);
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    assert.deepEqual(await box(page, '.pane'), {x: 0, y: 0, width: 390, height: 844});
    await until('read', () => counts(setpoint), value => value.unread === 18);
    await page.locator('.ph-back').tap();
    await page.locator('.list .row').first().waitFor();

    // An event's reminder.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'item', id: dentist.id, occurrence_start: dentist.occurrence_start})}`);
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist'}).waitFor();
    assert.equal(await page.locator('.ph-agenda .pitem.sel').textContent(), '2:30 – 3:30 PMDentist · Smile Dental');

    // One occurrence of a recurring event: Friday's Gym, not today's.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'item', id: gymFriday.id, occurrence_start: gymFriday.occurrence_start})}`);
    await page.locator('.ph-detail .fd-title', {hasText: 'Gym'}).waitFor();
    assert.equal(await page.locator('.ph-detail .fd-when').textContent(), 'Fri, Oct 9 · 7:00 – 8:00 AM');
    assert.equal(await page.locator('.ph-agenda .pitem.sel').getAttribute('data-key'), gymFriday.key);

    // A task's reminder opens its day, brought to the top of the agenda.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-08'})}`);
    await until('the day at the top', () => topDay(page), day => day === '2026-10-08');
    assert.equal(await page.locator('.hd .ph-month-btn').textContent(), 'October');
    assert.ok(await page.locator('.ph-agenda [data-days="2026-10-08"] .pitem', {hasText: 'Renew car registration'}).isVisible());
    // Further out too.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-20'})}`);
    await until('the day at the top', () => topDay(page), day => day === '2026-10-20');

    // A reconnect alert's Settings link lands on a page: Accounts is on the desktop, with Sign out.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'settings', page: 'accounts'})}`);
    await page.locator('.ph-set', {hasText: 'Accounts is on the desktop'}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/settings/accounts');
    await page.locator('.ph-set-foot button', {hasText: 'Sign out'}).tap();
    // It asks once, in the toast.
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).tap();
    await page.getByLabel('Password').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the tab bar: Inbox is badged with Attention\'s count on another page, following it, and Agenda glides back to today', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const badge = page.locator('.ph-tab', {hasText: 'Inbox'}).locator('.ph-badge');
    // The Inbox's header has the count: no badge there.
    assert.equal(await badge.count(), 0);
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    assert.equal(await badge.textContent(), '3');
    await setpoint.api('POST', `/mail/messages/${await email(setpoint, 'Final exam')}/done`, {done: true});
    await until('the badge follows', () => badge.textContent(), text => text === '2');
    // A later week's agenda: its tab glides back to today, under the past week.
    await instantScrolls(page);
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-20'})}`);
    await until('the day at the top', () => topDay(page), day => day === '2026-10-20');
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await until('today at the top', () => topDay(page), day => day === '2026-10-07');
    assert.deepEqual(await scrollsAsked(page), ['smooth']);
    assert.equal(new URL(page.url()).pathname, '/calendar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the web manifest opens the Inbox standalone, portrait, on the frame, with its home screen icons', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    // A missing file would be the app's page: the manifest is read as one, and so is its icon.
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await page.request.get(`${setpoint.base}${href}`);
    assert.equal(manifest.headers()['content-type'], 'application/manifest+json');
    const {display, start_url: start, orientation, background_color: ground, icons} = await manifest.json() as {display: string; start_url: string; orientation: string; background_color: string; icons: {src: string; sizes: string; purpose?: string}[]};
    assert.deepEqual([display, start, orientation, ground], ['standalone', '/inbox', 'portrait', '#0b0c0e']);
    assert.deepEqual(icons.map(icon => `${icon.sizes}${icon.purpose ? ` ${icon.purpose}` : ''}`), ['180x180', '192x192', '512x512', '512x512 maskable']);
    for (const {src} of icons) {
      const icon = await page.request.get(`${setpoint.base}${src}`);
      assert.equal(icon.headers()['content-type'], 'image/png', src);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A fake ntfy on 127.0.0.1 that takes every publish, so no check reaches a real one. */
async function fakeNtfy() {
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => response.writeHead(200, {'content-type': 'application/json'}).end('{"id":"msg","event":"message"}'));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise(resolve => server.close(resolve))};
}

test('phone Settings: an index of the phone\'s pages, each under Back to it; a switch saves, the theme switches; the other pages are on the desktop and list the phone\'s', async () => {
  const ntfy = await fakeNtfy();
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await setpoint.api('PATCH', '/settings', {notifications: {ntfy_server: ntfy.url}});
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/settings`);
    // The index: the phone's three pages, the tab bar under them with the Inbox lit.
    const pages = page.getByRole('navigation', {name: 'Settings pages'});
    await pages.waitFor();
    assert.equal(await page.locator('.hd .hd-title').textContent(), 'Settings');
    assert.deepEqual(await pages.getByRole('link').allTextContents(), ['Places', 'Notifications', 'Appearance']);
    assert.equal(await page.locator('.settings[role="dialog"]').count(), 0, 'no modal');
    assert.equal(await page.locator('.ph-tabs a[aria-current="page"]', {hasText: 'Inbox'}).count(), 1, 'the Inbox tab is lit');
    await fingertips([pages.getByRole('link', {name: 'Places'}), pages.getByRole('link', {name: 'Appearance'})]);

    // Notifications: the desktop's page in the phone's column, where a switch saves.
    await pages.getByRole('link', {name: 'Notifications'}).tap();
    const fyi = page.getByRole('switch', {name: 'FYI mail'});
    await fyi.waitFor();
    assert.equal(await page.locator('.hd .hd-title').textContent(), 'Notifications');
    const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.equal(scroll[0], scroll[1], 'nothing scrolls sideways');
    const was = (await setpoint.api<Settings>('GET', '/settings')).notifications.fyi_mail;
    await fyi.tap();
    await until('it saved', async () => (await setpoint.api<Settings>('GET', '/settings')).notifications.fyi_mail, on => on === !was);
    assert.equal(await fyi.getAttribute('aria-checked'), String(!was));

    // Back is the index, and Appearance there is where Night and Light switch the page.
    await page.locator('.hd .ph-back').tap();
    await until('the index', () => page.evaluate(() => window.location.pathname), path => path === '/settings');
    await pages.getByRole('link', {name: 'Appearance'}).tap();
    await page.getByText('The Home Screen app keeps its own theme, apart from Safari’s.').waitFor();
    await page.getByRole('radio', {name: /Night/}).tap();
    await until('Night', () => page.evaluate(() => document.documentElement.dataset.theme), theme => theme === 'night');
    assert.equal(new URL(page.url()).pathname, '/settings/appearance');
    await page.getByRole('radio', {name: /Light/}).tap();
    await until('Light', () => page.evaluate(() => document.documentElement.dataset.theme), theme => theme === 'light');

    // Each other page says it's on the desktop, and lists the phone's pages.
    for (const [page_, label] of [['mail', 'Mail'], ['calendar', 'Calendar'], ['news', 'News'], ['jobs', 'Jobs'], ['ai', 'AI'], ['security', 'Security']] as const) {
      await page.goto(`${setpoint.base}/settings/${page_}`);
      await page.locator('.ph-set-away', {hasText: `${label} is on the desktop`}).waitFor();
      assert.equal(await page.locator('.hd .hd-title').textContent(), label);
    }
    await pages.getByRole('link', {name: 'Places'}).tap();
    await until('Places', () => page.evaluate(() => window.location.pathname), path => path === '/settings/places');

    // The Inbox tab is the way back.
    await page.locator('.ph-tabs a', {hasText: 'Inbox'}).tap();
    await until('the Inbox', () => page.evaluate(() => window.location.pathname), path => path === '/inbox');
    await page.locator('.list .row').first().waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await ntfy.close();
  }
});

test('phone Settings: with no Anthropic key Alfred says to add it in Settings › AI on the desktop, with no link to a page the phone hasn\'t', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.search input').tap();
    await page.keyboard.type('lease renewal');
    await page.locator('.search-list .result').first().waitFor();
    await page.locator('.search-list .ask').tap();
    const line = page.locator('.search-list .answer .failed-line', {hasText: 'Alfred needs an Anthropic key in Settings › AI on the desktop.'});
    await line.waitFor();
    assert.equal(await line.getByRole('button').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
