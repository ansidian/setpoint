// Boards 01 to 10 as scenes on the seed, at the design target, 1677 × 1050, each built and checked
// for its content and no page errors. The app runs on the seed with the seed's clock, so its ages and
// counts are the brief's. Board 01 also takes one of the release's page screenshots (pages.ts). The
// Inbox is one list since SV-70, so the boards drawing Unread's groups are built in its place
// (DESIGN.md override 33).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {FAKE_ANTHROPIC_KEY, fakeAlfred, leaseAlfred} from './fakeAlfred.ts';
import {cleanUp, matchGolden, readSecurity, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Out of the way of every row, so no hover fill shows.
  await page.mouse.move(700, 28);
  // Lets a hover fill the move left fade out (120 ms) before the screenshot.
  await page.waitForTimeout(250);
}

test('board 01: the Inbox on a typical morning, Northwind open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    await page.locator('.list .row[title^="Interview availability"]').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // Opening it read it: Inbox (3) 18 and Jobs 1 (DESIGN.md override 2).
    await until('the sidebar\'s unread count', () => page.locator('.nav.on .cnt').textContent(), text => text === '18');
    await settle(page);
    await matchGolden(page, '01-inbox-a-typical-morning');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 04: nothing new, the list starting at Attention, the shelf and the days', async () => {
  const setpoint = await startSetpoint();
  try {
    // The Security emails opened, Mark all as read, then Done on each attention email, through the API.
    await readSecurity(setpoint);
    await setpoint.api('POST', '/mail/mark-all-read', {});
    await until('Mark all as read confirmed', () => setpoint.api<MailCountsOut>('GET', '/mail/counts'), counts => counts.unread === counts.attention - 1 && counts.unread_fyi === 0);
    const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
    for (const row of inbox.groups.find(group => group.group === 'attention')!.rows) await setpoint.api('POST', `/mail/messages/${row.id}/done`, {done: true});
    const counts = await setpoint.api<MailCountsOut>('GET', '/mail/counts');
    assert.deepEqual([counts.attention, counts.unread], [0, 0]);

    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .gh.day').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    // Nothing unread and nothing waiting on Done: no New, no Attention, the shelf first.
    assert.deepEqual(await page.locator('.list .gh:not(.day)').allTextContents(), ['Pinned 1']);
    assert.equal(await page.locator('.pane').count(), 0, 'the reading pane is collapsed');
    assert.equal(await page.title(), 'Inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Boards 02, 03, 05, 09 and 10 (F2), each on the seed with its fixture where the board's state
// differs (decision D3) and the clock held at the seed's moment, so "now", "4m" and "Expires in
// 11 min" don't depend on how long the check takes.

/** Waits for an HTML email's frame to draw its body. */
async function frameDrawn(page: Page) {
  await page.frameLocator('iframe.mailframe').locator('body > *').first().waitFor();
  await until('the frame takes the email\'s height', () => page.locator('iframe.mailframe').evaluate(frame => frame.getBoundingClientRect().height), height => height > 100);
}

test('board 02: Money collapsed, the Contoso Coffee newsletter open with images hidden', async () => {
  const setpoint = await startSetpoint({fixtures: ['coffee-html'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    // New's Noise opens to show the newsletter.
    await page.locator('.list .nfold', {hasText: 'Noise'}).first().click();
    await page.locator('.list .row', {hasText: 'Contoso Coffee'}).first().click();
    await page.locator('.rd-subj', {hasText: 'The Contoso Coffee Journal · October'}).waitFor();
    await page.locator('.imgbar', {hasText: 'Always show from contosocoffee.example'}).waitFor();
    await frameDrawn(page);
    // Opening it read it: Inbox (3) 18 and Personal 7 (DESIGN.md override 2).
    await until('the sidebar\'s unread count', () => page.locator('.nav.on .cnt').textContent(), text => text === '18');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 03: the protected recovery-email alert open, with its facts card', async () => {
  const setpoint = await startSetpoint({fixtures: ['recovery-html'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.today-row').first().waitFor();
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).click();
    await page.locator('.facts', {hasText: 'not a place you use'}).waitFor();
    await frameDrawn(page);
    await until('the sidebar\'s unread count', () => page.locator('.nav.on .cnt').textContent(), text => text === '18');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 05: the days, under the Pinned shelf, the cursor on the shelf\'s lease', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // Every email read, as All's board draws them, so New and Attention leave the days whole.
    await readSecurity(setpoint);
    await setpoint.api('POST', '/mail/mark-all-read', {});
    await until('Mark all as read confirmed', () => setpoint.api<MailCountsOut>('GET', '/mail/counts'), counts => counts.unread_fyi === 0);
    const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
    for (const row of inbox.groups.find(group => group.group === 'attention')!.rows) {
      if (row.unread) await setpoint.api('POST', `/mail/messages/${row.id}/read`, {unread: false});
    }
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list.all .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    // The first row is Attention's, then the Pinned shelf's lease (D105).
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.locator('.list.all .row.shelf.cur', {hasText: 'Parkside Apartments'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 09: the pattern prompt in Attention, the cursor on the digest that just arrived', async () => {
  const setpoint = await startSetpoint({fixtures: ['new-digest'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    // B3's real prompt, from the fixture's four digests cleared unopened.
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.prompt').waitFor();
    await page.locator('.today-row').first().waitFor();
    // J down New to the digest.
    const digest = page.locator('.list .row[title^="Northwind Engineering Digest"]').first();
    for (let press = 0; press < 20 && !(await digest.evaluate(row => row.classList.contains('cur'))); press++) await page.keyboard.press('j');
    await page.locator('.list .row.cur[title^="Northwind Engineering Digest"]').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 10: two pins, the lease open, Unpin under the pointer on the DMV notice', async () => {
  const setpoint = await startSetpoint({fixtures: ['second-pin'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.today-row').first().waitFor();
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    await page.locator('.attach', {hasText: 'Renewal agreement.pdf'}).waitFor();
    await page.locator('.row.shelf', {hasText: 'DMV'}).hover();
    await page.locator('.row.shelf', {hasText: 'DMV'}).locator('.unpin').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Boards 06, 07 and 08 (F3), on the seed with the clock held. 07's Alfred is a fake Anthropic on
// 127.0.0.1 (fakeAlfred.ts), reached through SETPOINT_DEV_AI_URL.

test('board 06: search with chips, the first result open', async () => {
  const fake = await fakeAlfred(leaseAlfred);
  const setpoint = await startSetpoint({clock: 'frozen', env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  try {
    await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('northwind rejection march');
    await page.keyboard.press('Enter');
    await until('the chips', () => page.locator('.search .qchip').count(), count => count === 3);
    await page.locator('.arow.result.cur').waitFor();
    await page.keyboard.press('Enter');
    await page.locator('.rd-subj', {hasText: 'Update on your application'}).waitFor();
    await page.keyboard.press('/');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await fake.close();
  }
});

test('board 07: Alfred\'s Answer card with its source and one follow-up', async () => {
  const fake = await fakeAlfred(leaseAlfred);
  const setpoint = await startSetpoint({clock: 'frozen', env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  try {
    await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('When does my lease renewal need to be signed?');
    await page.locator('.arow.result').first().waitFor();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.answer .src', {hasText: 'Lease renewal terms'}).click();
    await page.locator('.attach', {hasText: 'Renewal agreement.pdf'}).waitFor();
    await page.locator('.answer input').click();
    await page.keyboard.type('what\'s the new rent?');
    await page.keyboard.press('Enter');
    await until('the follow-up\'s answer', () => page.locator('.answer .ans').count(), count => count === 2);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await fake.close();
  }
});

test('board 08: the proposal card from Add to calendar on the Contoso University email', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.today-row').first().waitFor();
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.rd-acts button', {hasText: 'Add to calendar'}).click();
    await page.locator('.prop .conflict', {hasText: 'Free that evening'}).waitFor();
    await page.locator('.prop .field.pick', {hasText: '10 min before'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
