// The phone at 390 × 844 (DESIGN.md › Phone; board 21; F8): board 21's three phones (the Inbox after
// reading Northwind, the reader on it, the agenda, the Inbox also one of the release's page
// screenshots, pages.ts), the Inbox, reader and agenda by taps, read state, Done, Trash with Undo,
// Mark unread and read, Mark all as read, plain search, and every kind of deep link an ntfy
// notification carries (`deepLinkPath`): an email, an event, one occurrence of a recurring event, a
// task's day, and a Settings page. Sign-in's fields are 16 px, so iOS doesn't zoom into them.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {InboxOut, ItemsOut, MailCountsOut} from '@setpoint/shared';
import {deepLinkPath} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, matchGolden, rested, startSetpoint, test, until, writeOutput} from './harness.ts';
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
  await page.locator('.list .row').first().waitFor();
  return page;
}

const box = async (page: Page, selector: string) => (await rested(() => page.locator(selector).first().boundingBox()))!;

test('board 21: the Inbox after reading Northwind, the reader on it, and the agenda', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.list .row[title^="Interview availability"]').tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // Opening it read it: 18 (override 2).
    await until('the server read it', () => counts(setpoint), value => value.unread === 18);

    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    await until('the count follows', () => page.locator('.hd .ph-count').textContent(), text => text === '18');
    await matchGolden(page, '21a-phone-inbox');

    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/calendar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('#239: on the phone a row\'s summary wraps to a second line rather than being cut, and the kinds are subheadings', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    // Parkside's line (its subject and summary, on the shelf) runs to two lines, all of it there.
    const lease = page.locator('.row.shelf .subj');
    const lines = await rested(() => lease.evaluate(node => Math.round(node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight))));
    assert.equal(lines, 2);
    // Every row's line in the seed fits in its two lines, none cut.
    const cut = await page.locator('.list .row .subj:not(.code-line)').evaluateAll(all => all.filter(node => node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
    assert.deepEqual(cut, []);
    // The kind column has no room on the phone, so each FYI run gets its subheading.
    const subheads = page.locator('.list.all .kh');
    await subheads.first().waitFor();
    assert.deepEqual((await subheads.allTextContents()).slice(0, 4), ['Security', 'Deliveries', 'Money', 'Career']);
    assert.equal(await page.locator('.list.all .row .kd').first().isVisible(), false);
    // They show already, so opening an email and coming back moves nothing.
    const bank = page.locator('.list.all .row', {hasText: 'Proseware'}).first();
    await bank.scrollIntoViewIfNeeded();
    const before = (await rested(() => bank.boundingBox()))!.y;
    await bank.tap();
    await page.locator('.rd-subj', {hasText: 'Bill is ready'}).waitFor();
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    assert.equal(Math.round((await rested(() => bank.boundingBox()))!.y), Math.round(before));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-73: on the phone a Done row\'s tag sits on its sender line, between the sender and the account, clear of the summary', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await setpoint.api('POST', `/mail/messages/${await email(setpoint, 'Interview availability')}/done`, {done: true});
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    const row = page.locator('.list.all .row.done', {hasText: 'Northwind'});
    await row.locator('.tag').waitFor();
    const boxOf = async (selector: string) => (await rested(() => row.locator(selector).boundingBox()))!;
    const [from, tag, account, line] = await Promise.all([boxOf('.from'), boxOf('.tag'), boxOf('.ac'), boxOf('.subj')]);
    // On the sender's line, vertically centred with it, and wholly above the summary.
    assert.ok(Math.abs((tag.y + tag.height / 2) - (from.y + from.height / 2)) <= 1, `tag centre ${tag.y + tag.height / 2}, sender centre ${from.y + from.height / 2}`);
    assert.ok(tag.y + tag.height <= line.y, `tag bottom ${tag.y + tag.height}, summary top ${line.y}`);
    // After the sender and before the account, overlapping neither.
    assert.ok(from.x + from.width <= tag.x && tag.x + tag.width <= account.x, `sender ${from.x}–${from.x + from.width}, tag ${tag.x}–${tag.x + tag.width}, account ${account.x}`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('signing in on the phone: every field\'s text is 16 px, so iOS doesn\'t zoom the page; placeholders stay 13.5 px', async () => {
  const setpoint = await startSetpoint({claim: false});
  try {
    const page = await setpoint.page('iphone');
    const sizes = () => page.locator('.sign-in .input').evaluateAll(inputs => inputs.map(input => [input.getAttribute('aria-label'), getComputedStyle(input).fontSize, getComputedStyle(input, '::placeholder').fontSize]));
    await page.goto(`${setpoint.base}/inbox`);
    await page.getByLabel('Setup token').waitFor();
    assert.deepEqual(await rested(() => sizes()), [['Setup token', '16px', '13.5px'], ['New password', '16px', '13.5px']]);
    // Claimed (elsewhere), the card asks for the password; then a recovery code and a new password.
    await setpoint.api('POST', '/auth/claim', {setup_token: setpoint.setupToken, password: 'a long enough password'});
    await page.reload();
    await page.getByLabel('Password').waitFor();
    assert.deepEqual(await rested(() => sizes()), [['Password', '16px', '13.5px']]);
    await page.getByRole('button', {name: 'Use a recovery code'}).click();
    await page.getByLabel('Recovery code').waitFor();
    assert.deepEqual(await rested(() => sizes()), [['Recovery code', '16px', '13.5px'], ['New password', '16px', '13.5px']]);
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
    // The one list, as on the desktop: New, Attention, the Pinned shelf (#243).
    const headers = (await page.locator('.gh').allTextContents()).map(text => text.trim().split(/\s/)[0]!.toLowerCase());
    assert.deepEqual(headers.slice(0, 3), ['new', 'attention', 'pinned']);
    // Every row keeps its account; the Pinned row's "Sep 30" stays on one line (override 11).
    for (const label of await page.locator('.list .row .ac').allTextContents()) assert.match(label, /Business|Personal|Work|Jobs|iCloud/);
    const age = await box(page, '.row.shelf .age');
    assert.ok(age.height < 20, `the age is one line (${age.height}px)`);
    // Two lines a row: the sender, account and age, then the subject under the sender, both readable.
    const [from, subject] = [await box(page, '.row.shelf .from'), await box(page, '.row.shelf .subj')];
    assert.ok(subject.y >= from.y + from.height, 'the subject sits under the sender');
    assert.equal(await page.locator('.row.shelf .from').evaluate(text => text.scrollWidth <= text.clientWidth), true, '"Parkside Apartments" whole');
    // … and the subject takes the row's whole width under it (at the list's 15 px, #144, a long one
    // wraps to a second line and ends in "…" past it, #239).
    const [shelf, line] = [await box(page, '.row.shelf'), await box(page, '.row.shelf .subj')];
    assert.equal(line.x, from.x, 'the subject starts under the sender');
    assert.equal(Math.round(line.x + line.width), shelf.x + shelf.width - 16, 'and runs to the row\'s end');
    const scroll = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.equal(scroll[0], scroll[1]);
    // The reader takes the whole screen, with Back.
    await page.locator('.list .row[title^="Final exam schedule"]').tap();
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

test('read state on the phone: a tap opens and reads; scrolling and opening Noise read nothing', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    await page.locator('.list').evaluate(list => list.scrollBy(0, 300));
    await page.locator('.list').evaluate(list => list.scrollTo(0, 0));
    await page.locator('.list .nfold').first().tap();
    await page.locator('.row[title^="Fall sale"]').waitFor();
    // Nothing happens to wait for: scrolling and opening Noise read nothing.
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
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).tap();
    await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === 18);
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).waitFor();
    await until('unread again', () => counts(setpoint), value => value.unread === 19);
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).tap();
    await until('read again', () => counts(setpoint), value => value.unread === 18);

    // Done: out of New, with Undo in the toast; back to the list, with nothing else opened or
    // read (UX #12).
    await page.locator('.ph-acts button', {hasText: 'Done'}).tap();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    await page.locator('.list .row.unread[title^="Interview availability"]').waitFor();
    await until('the pill drops', () => counts(setpoint), value => value.attention === 2);
    assert.equal((await counts(setpoint)).unread, 18);

    // Trash on Contoso University, then Undo brings it back into the reader.
    await page.locator('.list .row[title^="Final exam schedule"]').tap();
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
    // New empties; Northwind, left unread, joins Attention (#243).
    await until('New goes', () => page.locator('.list .gh.new').count(), count => count === 0, 5000);
    await page.locator('.list .row.unread[data-key^="attention:"][title^="Interview availability"]').waitFor();
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
    await until('Jobs only', () => page.locator('.list .row .ac .label').allTextContents(), labels => labels.length > 0 && labels.every(label => label === 'Jobs'));
    // The button names the account (its select's options follow it in the text).
    assert.ok((await page.locator('.ph-account').textContent())!.startsWith('JobsAll accounts'));
    assert.match(new URL(page.url()).search, /^\?account=\d+$/);
    await page.locator('.ph-account select').selectOption({label: 'All accounts'});
    await until('every account', () => page.locator('.list .row .ac .label').allTextContents(), labels => labels.includes('Personal'));

    const reads: string[] = [];
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/search') reads.push((request.postDataJSON() as {read?: string}).read ?? 'words');
      if (path === '/api/search/suggestion') reads.push('suggestion');
    });
    await page.locator('.search input').tap();
    await page.keyboard.type('northwind interview ');
    await page.locator('.search-list .result').first().waitFor();
    // Searching, the top reads Search alone: no attention pill or count beside it, as mail's search clears its controls.
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.equal(await page.locator('.hd .apill, .hd .ph-count').count(), 0);
    await page.keyboard.press('Enter');
    // Nothing happens to wait for: Enter makes no chips on the phone, and no pause asks for a suggestion.
    await page.waitForTimeout(900);
    await setpoint.idle();
    assert.equal(await page.locator('.search .qchip').count(), 0, 'no chips');
    assert.ok(reads.length > 0 && reads.every(read => read === 'words'), `its searches ask for no reading: ${reads.join()}`);
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

test('SV-109: a task\'s custom reminder on the phone reads as its moment, the offset beside it, inside the card', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const {items} = await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-08');
    const rent = items.find(item => item.title === 'Pay rent')!;
    await setpoint.api('PATCH', `/items/${rent.id}`, {changes: {reminders: [30, -90]}});
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar/item/${rent.id}`);
    await page.locator('.ph-detail .fd-title', {hasText: 'Pay rent'}).waitFor();
    // Pay rent has no time: its reminders count from Settings' 9:00 AM.
    const lines = page.locator('.ph-detail .fd-reminders > span');
    await until('its reminders', () => lines.allTextContents(), texts => texts.length === 2);
    assert.deepEqual(await lines.allTextContents(), ['30 min before', 'Wed, Oct 7, 10:30 AM1 hr 30 min after']);
    const card = (await rested(() => page.locator('.ph-detail .card').boundingBox()))!;
    for (const line of await lines.all()) {
      const box = (await rested(() => line.boundingBox()))!;
      assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width, 'the line sits inside the card');
    }
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
    const [line, none, wx] = await rested(() => Promise.all([head.boundingBox(), head.locator('.none').boundingBox(), head.locator('.pwx').boundingBox()]));
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
    // It asks once, in the toast (UX #21).
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).tap();
    await page.getByLabel('Password').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
