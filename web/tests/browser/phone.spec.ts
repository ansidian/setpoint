// The phone at 390 × 844 (DESIGN.md › Phone; board 21; F8): board 21's three phones against their
// approved screenshots (the Inbox after reading Northwind, the reader on it, the agenda), the Inbox, reader and
// agenda by taps, read state, Done, Trash with Undo, Mark unread and read, Mark all as read, plain
// search, and every kind of deep link an ntfy notification carries (`deepLinkPath`): an email, an
// event, one occurrence of a recurring event, a task's day, and a Settings page.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {InboxOut, ItemsOut, MailCountsOut} from '@setpoint/shared';
import {deepLinkPath} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, collapseGroups, matchGolden, startSetpoint, until, writeOutput} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');

/** The seed's emails by the start of their subject. */
async function email(setpoint: Setpoint, subject: string): Promise<number> {
  const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
  return inbox.groups.flatMap(group => group.rows).find(row => row.subject.startsWith(subject))!.id;
}

async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.arow').first().waitFor();
  return page;
}

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test('board 21: the Inbox after reading Northwind, the reader on it, and the agenda', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await collapseGroups(page);
    await page.locator('.arow', {hasText: 'Northwind Talent'}).tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // Opening it read it: 18 (override 2).
    await until('the server read it', () => counts(setpoint), value => value.unread === 18);
    await matchGolden(page, '21b-phone-reader');

    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    await until('the count follows', () => page.locator('.hd .ph-count').textContent(), text => text === '18');
    await matchGolden(page, '21a-phone-inbox');

    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/calendar');
    await matchGolden(page, '21c-phone-agenda');
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
    // Attention leads, then the Pinned shelf (board 21).
    const headers = (await page.locator('.gh').allTextContents()).map(text => text.trim().split(/\s/)[0]!.toLowerCase());
    assert.deepEqual(headers.slice(0, 3), ['attention', 'pinned', 'security']);
    // Every row keeps its account; the Pinned row's "Sep 30" stays on one line (override 11).
    for (const label of await page.locator('.list .row .ac, .list .arow .r1').allTextContents()) assert.match(label, /Business|Personal|Work|Jobs|iCloud/);
    const age = await box(page, '.row.shelf .age');
    assert.ok(age.height < 20, `the age is one line (${age.height}px)`);
    // An Attention row's age hugs its account, the row's 8 px gap between them, as board 21 draws
    // it: not the desktop's 44 px column (#89).
    const gap = await page.locator('.arow .r1').first().evaluate(r1 => {
      const text = document.createRange();
      text.selectNodeContents(r1.querySelector('.age')!);
      return text.getBoundingClientRect().left - r1.querySelector('.label')!.getBoundingClientRect().right;
    });
    assert.equal(Math.round(gap), 8, 'the age hugs the account');
    // Two lines a row: the sender, account and age, then the subject under the sender, both readable.
    const [from, subject] = [await box(page, '.row.shelf .from'), await box(page, '.row.shelf .subj')];
    assert.ok(subject.y >= from.y + from.height, 'the subject sits under the sender');
    assert.equal(await page.locator('.row.shelf .from').evaluate(text => text.scrollWidth <= text.clientWidth), true, '"Parkside Apartments" whole');
    assert.equal(await page.locator('.row.shelf .subj b').evaluate(text => text.getBoundingClientRect().right <= text.parentElement!.getBoundingClientRect().right), true, '"Lease renewal terms" whole');
    const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.equal(scroll[0], scroll[1]);
    // The reader takes the whole screen, with Back.
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
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
    assert.equal(await page.locator('.palette, .settings').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('read state on the phone: a tap opens and reads; scrolling and expanding a group read nothing', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    await page.locator('.list').evaluate(list => list.scrollBy(0, 300));
    await page.locator('.list').evaluate(list => list.scrollTo(0, 0));
    await collapseGroups(page, ['Deliveries']);
    await page.locator('.gh', {hasText: 'Deliveries'}).tap();
    await page.locator('.row[title="Out for delivery"]').waitFor();
    // Nothing happens to wait for: scrolling and expanding read nothing.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.deepEqual(await counts(setpoint).then(value => [value.attention, value.unread]), [3, 19]);
    assert.equal(await page.locator('.hd .ph-count').textContent(), '19');

    await page.locator('.row[title="Out for delivery"]').tap();
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

test('Done, Trash with Undo, Mark unread and Mark read from the reader; Mark all as read from the top', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    const exams = await email(setpoint, 'Final exam');

    // Mark unread keeps the email open and offers Mark read.
    await page.locator('.arow', {hasText: 'Your recovery email was changed'}).tap();
    await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === 18);
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).waitFor();
    await until('unread again', () => counts(setpoint), value => value.unread === 19);
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).tap();
    await until('read again', () => counts(setpoint), value => value.unread === 18);

    // Done: out of Attention, with Undo in the toast; back to the list, with nothing else opened or
    // read (UX #12).
    await page.locator('.ph-acts button', {hasText: 'Done'}).tap();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    await page.locator('.arow.unread', {hasText: 'Interview availability'}).waitFor();
    await until('the pill drops', () => counts(setpoint), value => value.attention === 2);
    assert.equal((await counts(setpoint)).unread, 18);

    // Trash on Contoso University, then Undo brings it back into the reader.
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await page.locator('.ph-acts button', {hasText: 'Trash'}).tap();
    // Undo while the toast offers it: a wait on the server first could outlast its 6 seconds.
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    await page.locator('.toast button', {hasText: 'Undo'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await until('it came back', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), value => value.groups.some(group => group.rows.some(row => row.id === exams)));

    // Mark all as read: everything outside Attention (where Northwind, never opened, stays unread)
    // and Security, whose three stay unread (UX #4).
    await page.locator('.ph-back').tap();
    assert.ok((await counts(setpoint)).unread_fyi > 3);
    await page.locator('.hd button[aria-label="Mark all as read"]').tap();
    await until('all but Security read', () => counts(setpoint), value => value.unread_fyi === 3 && value.unread === 4, 5000);
    await until('the other FYI groups go', () => page.locator('.gh').allTextContents(), headers => headers.length === 3 && headers.some(text => text.includes('Security')), 5000);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the account filter, and plain search with no chips and no Alfred', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    await page.locator('.ph-account select').selectOption({label: 'Jobs'});
    await until('Jobs only', () => page.locator('.list .r1 .label, .list .row .ac .label').allTextContents(), labels => labels.length > 0 && labels.every(label => label === 'Jobs'));
    // The button names the account (its select's options follow it in the text).
    assert.ok((await page.locator('.ph-account').textContent())!.startsWith('JobsAll accounts'));
    assert.match(new URL(page.url()).search, /^\?account=\d+$/);
    await page.locator('.ph-account select').selectOption({label: 'All accounts'});
    await until('every account', () => page.locator('.list .r1 .label').allTextContents(), labels => labels.includes('Personal'));

    await page.locator('.search input').tap();
    await page.keyboard.type('northwind interview ');
    await page.locator('.search-list .result').first().waitFor();
    // Searching, the top reads Search alone: no attention pill or count beside it, as mail's search clears its controls.
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.equal(await page.locator('.hd .apill, .hd .ph-count').count(), 0);
    await page.keyboard.press('Enter');
    // Nothing happens to wait for: Enter makes no chips on the phone.
    await page.waitForTimeout(500);
    await setpoint.idle();
    assert.equal(await page.locator('.search .qchip').count(), 0, 'no chips');
    assert.equal(await page.locator('.search input').inputValue(), 'northwind interview ');
    assert.equal(await page.locator('.search-list .ask').isVisible(), false, 'no Ask Alfred');
    await page.locator('.search-list .result').first().tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the agenda: today and the next 7 days, empty days folded, an item\'s detail read-only', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    await page.locator('.ph-agenda .pwx').first().waitFor();
    assert.equal(await page.locator('.hd .ph-range').textContent(), 'Oct 7 – 14');
    assert.deepEqual((await page.locator('.ph-agenda .pday').allTextContents()).map(text => text.trim()), [
      'Today · Wed, Oct 778° / 61°', 'Thu, Oct 872° / 59°', 'Fri, Oct 9', 'Sat, Oct 10 – Sun, Oct 11No events', 'Mon, Oct 12', 'Tue, Oct 1364° / 55°', 'Wed, Oct 14',
    ]);
    // A forecast's high and low sit before its icon, as a month cell's do (Decided while building #83).
    assert.equal(await page.locator('.ph-agenda .pwx').first().getAttribute('title'), 'Sunny · 78° / 61°');
    // The day heads never wrap.
    for (const head of await page.locator('.ph-agenda .pday').all()) assert.equal((await head.boundingBox())!.height, 30);
    // No month grid, no editor, no New.
    assert.equal(await page.locator('.cal-grid, .editor, .rpane').count(), 0);

    await page.locator('.pitem', {hasText: 'Dentist'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist'}).waitFor();
    assert.equal(await page.locator('.ph-detail .fd-when').textContent(), 'Wed, Oct 7 · 2:30 – 3:30 PM');
    assert.equal(await page.locator('.ph-detail .card-acts').isVisible(), false, 'read-only: no Edit or actions');
    assert.match(new URL(page.url()).pathname, /^\/calendar\/item\/\d+$/);
    await page.locator('.ph-detail button[aria-label="Close"]').tap();
    await until('the detail closes', () => page.locator('.ph-detail').count(), count => count === 0);

    // A task's detail too.
    await page.locator('.pitem', {hasText: 'Pay rent'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Pay rent'}).waitFor();
    await page.locator('.ph-scrim').tap({position: {x: 195, y: 100}});
    await until('a tap outside closes it', () => page.locator('.ph-detail').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an empty day with a forecast keeps its own line to show it, "No events" beside its date', async () => {
  const setpoint = await startSetpoint({clock: 'frozen', fixtures: ['weekend-forecast']});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda [data-days="2026-10-11"] .pwx').waitFor();
    assert.deepEqual((await page.locator('.ph-agenda .pday').allTextContents()).map(text => text.trim()).slice(3, 5), [
      'Sat, Oct 10No events74° / 58°', 'Sun, Oct 11No events77° / 60°',
    ]);
    // "No events" follows the date, and the forecast takes the end, on one 30 px line.
    const head = page.locator('.ph-agenda [data-days="2026-10-10"] .pday');
    const [line, none, wx] = await Promise.all([head.boundingBox(), head.locator('.none').boundingBox(), head.locator('.pwx').boundingBox()]);
    assert.equal(line!.height, 30);
    assert.ok(none!.x + none!.width < wx!.x - 40, 'a space between "No events" and the forecast');
    assert.ok(Math.abs(line!.x + line!.width - 20 - (wx!.x + wx!.width)) <= 1, 'the forecast at the end');
    writeOutput('phone-agenda-weekend-forecast.png', await page.screenshot());
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
    await page.locator('.arow').first().waitFor();

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
    // It asks once, in the toast (UX #21).
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).tap();
    await page.getByLabel('Password').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
