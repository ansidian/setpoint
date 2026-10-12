// Health and states in the browser (F7; DESIGN.md › Health and states): board 19a against its
// approved screenshot (fixtures needs-reconnect, stale-icloud and triage-down, the stream cut), then the
// flows: offline dims the page and refuses changes, Retry now tries again and the stream's return
// clears it, the reconnect bar opens Settings › Accounts, a failing account's line says why, and
// the first backfill's indexing line holds in search; SV-20 adds the calendar's own stale and
// failing lines. The polish audit's states-02: Setpoint unreachable at launch shows the mark and the
// pill, not the sign-in card, and asks again until it answers.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {MailCountsOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, collapseGroups, matchGolden, startSetpoint, until} from './harness.ts';

after(cleanUp);

/** A glyph's bundled path and size, to compare with ICONS. */
const glyph = async (icon: Locator) => [await icon.locator('path').getAttribute('d'), await icon.getAttribute('width')];

/** Cuts Setpoint's live stream (the browser goes offline), or brings the network back. */
const network = (page: Page, online: boolean) => page.context().setOffline(!online);

test('board 19a: Business needs sign-in, iCloud stale, triage down, and offline', async () => {
  const setpoint = await startSetpoint({fixtures: ['needs-reconnect', 'stale-icloud', 'triage-down'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.hbar.caution', {hasText: 'Business needs sign-in'}).waitFor();
    await page.locator('.hbar.muted', {hasText: 'iCloud, as of 8:40 AM'}).waitFor();
    await page.locator('.gh', {hasText: 'Unsorted'}).locator('.gh-note', {hasText: 'Triage is down, as of 9:09 AM'}).waitFor();
    await page.locator('.today-row').first().waitFor();
    await collapseGroups(page);
    assert.equal(await page.locator('.acct', {hasText: 'Business'}).locator('.reconnect').count(), 1, 'the sidebar marks Business');
    // Account trouble is sync_problem wherever it shows, the bar as the sidebar (#164).
    assert.deepEqual(await glyph(page.locator('.hbar.caution > .icon')), [ICONS.sync_problem, '16']);
    assert.deepEqual(await glyph(page.locator('.acct', {hasText: 'Business'}).locator('.reconnect .icon')), [ICONS.sync_problem, '16']);
    await network(page, false);
    await page.locator('.offline-pill', {hasText: 'Offline, as of 9:12 AM, retrying'}).waitFor();
    // Retry now carries refresh, as every Try again does (#164).
    assert.deepEqual(await glyph(page.locator('.offline-pill .retry .icon')), [ICONS.refresh, '16']);
    await page.mouse.move(700, 28);
    await matchGolden(page, '19a-states-reconnect-offline-unsorted', 'main');
    await matchGolden(page, '19a-states-reconnect-offline-unsorted.sidebar', 'sidebar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('offline: the page dims, changes are refused, not queued, Retry now tries again, and the stream\'s return clears it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.locator('.arow.cur', {hasText: 'Your recovery email was changed'}).waitFor();
    await network(page, false);
    const pill = page.locator('.offline-pill');
    await pill.waitFor();
    assert.equal(await page.locator('.main.offline > .content').evaluate(content => getComputedStyle(content).opacity), '0.4');
    // H (Done) on the cursor row reaches nothing: no change is made or kept for later.
    await page.keyboard.press('h');
    // Nothing happens to wait for: offline, H changes nothing.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await page.locator('.arow', {hasText: 'Your recovery email was changed'}).count(), 1, 'the row stays');
    // Settings still opens from the sidebar, and Esc still closes the topmost thing.
    await page.locator('.sb-foot .nav', {hasText: 'Settings'}).click();
    await page.locator('.settings').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.settings').waitFor({state: 'detached'});
    // Retry now tries a fresh stream at once; with no network it stays offline.
    const tried = page.waitForRequest(request => request.url().includes('/api/events'));
    await pill.locator('.retry').click();
    await tried;
    // Nothing happens to wait for: with no network the pill stays.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await pill.count(), 1);
    // The network back, the stream reconnects and the pill goes.
    await network(page, true);
    await pill.waitFor({state: 'detached'});
    // Nothing happens to wait for: nothing refused offline is sent now.
    await page.waitForTimeout(300);
    await setpoint.idle();
    const counts = await setpoint.api<MailCountsOut>('GET', '/mail/counts');
    assert.equal(counts.attention, 3, 'nothing was queued and sent when it came back');
    // Back online, H works again.
    await page.keyboard.press('h');
    await until('Done', () => setpoint.api<MailCountsOut>('GET', '/mail/counts'), value => value.attention === 2);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Setpoint unreachable at launch: the mark and the offline pill, not the sign-in card; it asks again until Setpoint answers (states-02)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    // Setpoint restarting behind its proxy: GET /api/me answers the proxy's 502, then no connection at all.
    let me: 'gateway' | 'refused' | 'up' = 'gateway';
    await page.route('**/api/me', route => (me === 'gateway' ? route.fulfill({status: 502, contentType: 'text/html', body: '<html><body>Bad Gateway</body></html>'})
      : me === 'refused' ? route.abort('connectionrefused') : route.continue()));
    await page.goto(`${setpoint.base}/inbox`);
    const pill = page.locator('.boot .offline-pill');
    await pill.waitFor();
    assert.equal(await pill.textContent(), 'Can’t reach Setpoint, retryingRetry now');
    assert.equal(await page.locator('.sign-in').count(), 0, 'no sign-in card: nothing says the user was signed out');
    // The mark at 36 px where the sign-in card's top sits, dimmed; the pill 22 px under it.
    const mark = page.locator('.boot svg.mark');
    const box = (await mark.boundingBox())!;
    const pillBox = (await pill.boundingBox())!;
    assert.deepEqual([box.width, box.height, box.y], [36, 36, 1050 / 2 - 120]);
    assert.equal(pillBox.y - (box.y + box.height), 22);
    // Centred on the same line, to the half pixel an odd width rounds to.
    assert.ok(Math.abs(box.x + box.width / 2 - (pillBox.x + pillBox.width / 2)) <= 0.5, 'the pill is centred under the mark');
    assert.deepEqual(await mark.evaluate(svg => [getComputedStyle(svg).opacity, getComputedStyle(svg).filter]), ['0.5', 'grayscale(0.4)']);
    await page.mouse.move(700, 28);
    await matchGolden(page, 'unreachable-at-launch');

    // No connection at all is the same; it asks again on its own, with no click.
    me = 'refused';
    await page.waitForRequest(request => request.url().endsWith('/api/me'));
    // Retry now asks at once; still nothing answers, so the pill stays.
    const asked = page.waitForRequest(request => request.url().endsWith('/api/me'));
    await pill.locator('.retry').click();
    await asked;
    await setpoint.idle();
    assert.equal(await pill.count(), 1);
    assert.equal(await page.locator('.sign-in').count(), 0);

    // Setpoint is back: the next ask opens the app at the address it was opened at, signed in.
    me = 'up';
    await page.locator('.arow').first().waitFor();
    assert.match(page.url(), /\/inbox$/);
    assert.equal(await page.locator('.boot').count(), 0);

    // Signed in, a restart that refuses the live stream and /api/me keeps the app, under the offline
    // pill, rather than swapping it for the sign-in card.
    me = 'gateway';
    await page.route(/\/api\/events/, route => route.fulfill({status: 502, contentType: 'text/html', body: '<html><body>Bad Gateway</body></html>'}));
    const checked = page.waitForResponse(response => response.url().endsWith('/api/me'));
    await page.context().setOffline(true);
    await page.locator('.main > .offline-pill').waitFor();
    await page.context().setOffline(false);
    await checked;
    await setpoint.idle();
    assert.equal(await page.locator('.sign-in').count(), 0, 'still signed in');
    assert.equal(await page.locator('.main > .offline-pill').count(), 1);
    assert.equal(await page.locator('.arow').count() > 0, true);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a failing account says why in caution, and a healthy Inbox shows no line', async () => {
  const setpoint = await startSetpoint({fixtures: ['failing-work'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const line = page.locator('.hbar.failing');
    await line.waitFor();
    assert.equal(await line.textContent(), 'Work, as of 9:06 AM, Gmail answered 503.');
    assert.equal(await line.locator('.num').getAttribute('title'), 'Work, as of 9:06 AM, Gmail answered 503.');
    assert.equal(await page.locator('.hbar.caution').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
  const healthy = await startSetpoint({clock: 'frozen'});
  try {
    const page = await healthy.page('target');
    await page.goto(`${healthy.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    assert.equal(await page.locator('.hbar').count(), 0);
    assert.equal(await page.locator('.gh').first().evaluate(header => header.classList.contains('first')), true);
  } finally {
    await healthy.stop();
  }
});

test('SV-20: the calendar\'s own sources, Todoist stale and Weather failing, atop the right pane in order; the Inbox keeps its own', async () => {
  const setpoint = await startSetpoint({fixtures: ['stale-todoist', 'failing-weather'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    const lines = page.locator('.rpane > .rp-health');
    await until('both lines', () => lines.count(), count => count === 2);
    assert.deepEqual(await lines.allTextContents(), ['Todoist, as of 8:40 AM', 'Weather, as of 8:30 AM, Pirate Weather answered 500 Internal Server Error.']);
    assert.deepEqual(await lines.evaluateAll(all => all.map(line => line.className)), ['rp-health stale', 'rp-health failing']);
    const [stale, failing] = await lines.evaluateAll(all => all.map(line => getComputedStyle(line).color));
    const token = (name: string) => page.evaluate(value => {
      const probe = document.createElement('span');
      probe.style.color = `var(--${value})`;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }, name);
    assert.equal(stale, await token('ink3'));
    assert.equal(failing, await token('caution'));
    // A failing line shows the provider's words in full, wrapping rather than cutting them off; each line's title holds it too.
    assert.equal(await lines.nth(1).locator('.num').evaluate(text => text.scrollWidth <= text.clientWidth && text.scrollHeight <= text.clientHeight), true);
    assert.deepEqual(await lines.locator('.num').evaluateAll(all => all.map(text => text.getAttribute('title'))), ['Todoist, as of 8:40 AM', 'Weather, as of 8:30 AM, Pirate Weather answered 500 Internal Server Error.']);
    // The lines stay above the day as another day is picked.
    await page.locator('.cell[data-date="2026-10-09"]').click({position: {x: 100, y: 150}});
    await page.locator('.rpane .rp-date', {hasText: 'Fri, Oct 9'}).waitFor();
    assert.equal(await lines.count(), 2);
    // The Inbox's lines are its accounts': none here.
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    assert.equal(await page.locator('.hbar').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the first backfill: search says what it has indexed so far', async () => {
  const setpoint = await startSetpoint({fixtures: ['backfill'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('lease');
    await page.locator('.search-list .bar.muted', {hasText: 'Indexing · 62% · showing what’s indexed so far'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
