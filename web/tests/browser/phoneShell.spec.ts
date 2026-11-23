// The phone's shell at 390 × 844 (board 21): board 21's three phones (the Inbox after reading
// Northwind, the reader on it, the agenda), the one column and its tab bar, and every kind of deep
// link an ntfy notification carries (`deepLinkPath`): an email, an event, one occurrence of a
// recurring event, a task's day, and a Settings page. Sign-in's fields are 16 px, so iOS doesn't
// zoom into them.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import {deepLinkPath} from '@setpoint/shared';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';
import {box, counts, email, inbox} from './phoneHelpers.ts';

after(cleanUp);

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
    await until('the count follows', () => page.locator('.hd .ph-count').textContent(), text => text === '18');

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
    await page.getByRole('button', {name: 'Use a recovery code'}).click();
    await page.getByLabel('Recovery code').waitFor();
    assert.deepEqual(await rested(() => sizes()), [['Recovery code', '16px'], ['New password', '16px']]);
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
    assert.deepEqual(await page.locator('.ph-tab').allTextContents(), ['Inbox', 'Agenda']);
    // The list, as on the desktop: Attention, the Pinned shelf, then the days, Today first.
    const headers = (await page.locator('.gh').allTextContents()).map(text => text.trim().split(/\s/)[0]!.toLowerCase());
    assert.deepEqual(headers.slice(0, 3), ['attention', 'pinned', 'today']);
    // Every row keeps its account. The Pinned row's "Sep 30" stays on one line.
    for (const label of await page.locator('.list .row .ac').allTextContents()) assert.match(label, /Business|Personal|Work|Jobs|iCloud/);
    const age = await box(page, '.row.shelf .age');
    assert.ok(age.height < 20, `the age is one line (${age.height}px)`);
    // Two lines a row: the sender, account and age, then the subject under the sender, both readable.
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
    assert.deepEqual(await page.locator('.ph-acts button').allTextContents(), ['Done', 'Trash', 'Mark unread', 'Open in Gmail']);
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

    // A task's reminder opens its day: within the 8 days, the agenda keeps today first and shows it.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-08'})}`);
    await page.locator('.ph-agenda [data-days="2026-10-08"]').waitFor();
    assert.equal(await page.locator('.hd .ph-range').textContent(), 'Oct 7 – 14');
    assert.ok(await page.locator('.ph-agenda [data-days="2026-10-08"] .pitem', {hasText: 'Renew car registration'}).isVisible());
    // Further out, the agenda starts there.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-20'})}`);
    await until('the agenda starts on the day', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 20 – 27');
    assert.equal((await page.locator('.ph-agenda .pday').first().textContent())!.startsWith('Tue, Oct 20'), true);

    // A reconnect alert's Settings link: Settings is on the desktop, with Sign out.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'settings', page: 'accounts'})}`);
    await page.locator('.ph-settings', {hasText: 'Settings is on the desktop'}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/settings/accounts');
    await page.locator('.ph-settings button', {hasText: 'Sign out'}).tap();
    // It asks once, in the toast.
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).tap();
    await page.getByLabel('Password').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the tab bar: Inbox is badged with Attention\'s count on another page, following it, and Agenda goes back to today\'s week', async () => {
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
    // A later week's agenda: its tab goes back to today's.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-20'})}`);
    await until('the agenda starts on the day', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 20 – 27');
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await until('today\'s agenda', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 7 – 14');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
