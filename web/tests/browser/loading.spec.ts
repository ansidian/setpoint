// Loading in the browser (the polish audit's loading slice, SV-61; DESIGN.md › Motion › Loading and
// Decided while building #225–#236): each page's skeleton while its data is held at the server's
// door, never a false empty; a load that fails says so in place with Try again; Setpoint starting
// shows its mark; the reader and the story pane draw their heads from their rows at once; search
// shows a skeleton, then its results. Every check holds the answer it's about, so "while it loads"
// is as long as the check needs, and releases it to see the rows replace the skeleton.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page, Route} from 'playwright-core';
import {cleanUp, drawn, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

/**
 * Holds every /api request whose path (and query) matches until the returned release is called;
 * those asked after it pass. Installed before the page asks.
 */
async function hold(page: Page, pattern: RegExp): Promise<() => Promise<void>> {
  const waiting: Route[] = [];
  let held = true;
  const matches = (url: URL) => url.pathname.startsWith('/api/') && pattern.test(url.pathname + url.search);
  await page.route(matches, route => {
    if (held) waiting.push(route);
    else void route.continue();
  });
  return async () => {
    held = false;
    await Promise.all(waiting.splice(0).map(route => route.continue().catch(() => {})));
  };
}

/** Goes to an address without waiting for its data (the harness's goto waits for it, which a held answer never gives). */
const visit = (page: Page, url: string) => page.mainFrame().goto(url).then(() => {});

/** Waits until a skeleton has come in after its delay; its fade in is by eye (D416). */
async function shown(page: Page, kind: string) {
  const found = page.locator(`[data-skeleton="${kind}"]`).first();
  await found.waitFor();
  return found;
}

test('Inbox loading: a skeleton, never an empty list, until the rows replace it (states-03, inbox-13)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const release = await hold(page, /^\/api\/mail\/(inbox|all)/);
    await visit(page, `${setpoint.base}/inbox`);
    await shown(page, 'all');
    // No row is a skeleton's.
    assert.equal(await page.locator('.list .row, .list .gh').count(), 0);

    await release();
    await page.locator('.list .row').first().waitFor();
    // The list's own skeleton; the sidebar's may still be waiting for its answers.
    assert.equal(await page.locator('[data-skeleton="all"]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the Inbox waits for both its answers: with the days\' held, its skeleton stays, never half a list (#243)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const release = await hold(page, /^\/api\/mail\/all/);
    const groups = page.waitForResponse(response => new URL(response.url()).pathname === '/api/mail/inbox');
    await visit(page, `${setpoint.base}/inbox`);
    await shown(page, 'all');
    // The Inbox's groups in and drawn.
    await drawn(page, await groups);
    assert.equal(await page.locator('.list .row, .list .gh').count(), 0);
    await release();
    await page.locator('.list .gh.day').first().waitFor();
    // The list's skeleton is gone (the sidebar's may still wait on its own answers).
    assert.equal(await page.locator('section.list [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Settings' own answers: every page's (settings-05 loads them all as Settings opens).
const SETTINGS_PATHS = /^\/api\/(accounts|sources|mail\/precision|calendars|todoist\/projects|settings|mail\/rules|mail\/trusted-domains|notifications\/status|secrets|ai|security|news\/sources)$/;
// What a page says only once it knows (states-01): each would be false of the seed while it loads.
const FALSE_EMPTIES = ['Not connected', 'Connect Todoist', 'Not set', 'No rules yet', 'None yet', '0 domains', 'Nothing in Attention', '—', 'No sources', 'No home set'];

test('Settings loading: each page draws its groups\' skeleton rows, never a default as a fact, until its answers come (states-01, settings-05)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const release = await hold(page, SETTINGS_PATHS);
    await visit(page, `${setpoint.base}/settings/todoist`);
    const main = page.locator('.settings .set-main');
    for (const name of ['Todoist', 'Accounts', 'Calendar', 'Notifications', 'Mail', 'News', 'AI', 'Security']) {
      await page.locator('.settings .set-nav').getByRole('button', {name, exact: true}).click();
      await main.locator('.set-title', {hasText: name}).waitFor();
      await shown(page, 'settings');
      const text = await main.innerText();
      for (const empty of FALSE_EMPTIES) assert.ok(!text.includes(empty), `${name} says "${empty}" while it loads`);
    }
    await release();
    await main.locator('.set-row', {hasText: 'Recovery'}).or(main.locator('.set-row', {hasText: 'left'})).first().waitFor();
    await page.locator('.settings .set-nav .nav', {hasText: 'Todoist'}).click();
    await main.locator('.set-row', {hasText: 'Connected'}).waitFor();
    // Connected is the sources' alone; the page's other answers (nothing is held now) are in and drawn too.
    await setpoint.idle();
    assert.equal(await page.locator('.settings [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Settings opening loads every page\'s answers, so the next page shows at once (settings-05)', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // The rules aren't among them: the Inbox has them already, for Add to rule (SV-160).
    const asked = ['/api/mail/trusted-domains', '/api/security', '/api/ai', '/api/news/sources']
      .map(path => page.waitForResponse(response => new URL(response.url()).pathname === path));
    await page.keyboard.press('Meta+,');
    await page.locator('.settings .set-title', {hasText: 'Accounts'}).waitFor();
    await Promise.all(asked);
    // Mail's answers held from now on: what Settings loaded as it opened shows at once, with no skeleton.
    await hold(page, /^\/api\/mail\/(rules|trusted-domains)$/);
    await page.locator('.settings .set-nav .nav', {hasText: 'Mail'}).click();
    await page.locator('.settings .rule').first().waitFor();
    await page.locator('.settings .dom').first().waitFor();
    assert.equal(await page.locator('.settings [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Calendar loading: the right pane and Calendars draw skeletons, never "Nothing planned" or "No events", and the grid no fake chips (states-01, calpanes-03)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    // The month's items and the calendars held; the weather comes, so the pane's line waits only for the items.
    const release = await hold(page, /^\/api\/(items\?|calendars$)/);
    await visit(page, `${setpoint.base}/calendar`);
    await page.locator('.rpane .rp-date', {hasText: 'Wed, Oct 7'}).waitFor();
    await shown(page, 'agenda');
    await shown(page, 'calendars');
    const pane = await page.locator('.rpane').innerText();
    for (const empty of ['Nothing planned', 'No events', 'hidden']) assert.ok(!pane.includes(empty), `the pane says "${empty}" while it loads`);
    assert.equal(await page.locator('.rpane .ag-item').count(), 0);
    assert.equal(await page.locator('.cal-month :is(.ev, .tk)').count(), 0, 'no chip stands in for an event');

    await release();
    await page.locator('.rpane .ag-item', {hasText: 'Dentist'}).waitFor();
    await page.locator('.sb .calrow').first().waitFor();
    // The two it held; the sidebar's others may still be waiting for their answers.
    assert.equal(await page.locator('[data-skeleton="agenda"], [data-skeleton="calendars"]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** Answers every matching /api request with the server's 500 while `failing()` says so; the rest pass. */
async function failWhile(page: Page, pattern: RegExp, failing: () => boolean) {
  await page.route(url => url.pathname.startsWith('/api/') && pattern.test(url.pathname + url.search), route => (failing()
    ? route.fulfill({status: 500, json: {error: {code: 'internal', message: 'Something went wrong.'}}})
    : route.continue()));
}

test('a load that fails says so in place, and Try again loads it (states-06)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    let failing = true;
    await failWhile(page, /^\/api\/mail\/inbox$/, () => failing);
    await visit(page, `${setpoint.base}/inbox`);
    const line = page.locator('section.list .load-failed');
    await line.waitFor();
    assert.equal(await line.innerText(), 'Couldn’t load the Inbox, Something went wrong.\n·\nTry again');
    assert.equal(await page.locator('[data-skeleton="all"]').count(), 0, 'no skeleton says it\'s still coming');
    failing = false;
    await line.getByRole('button', {name: 'Try again'}).click();
    await page.locator('.list .row').first().waitFor();
    assert.equal(await line.count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the reader\'s body, Calendar\'s day, News and a Settings page each say in place when they couldn\'t load (states-06)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // Opening it would answer with the email too (POST …/open), so it fails as well.
    await failWhile(page, /^\/api\/(mail\/messages\/\d+(\/open)?|items\?.*|news|ai)$/, () => true);
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).click();
    await page.locator('.pane .load-failed', {hasText: 'Couldn’t load this email, Something went wrong.'}).waitFor();
    // Its head is drawn from its row all the same.
    await page.locator('.pane .rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();

    await page.keyboard.press('2');
    await page.locator('.rpane .load-failed', {hasText: 'Couldn’t load this day, Something went wrong.'}).waitFor();
    assert.equal(await page.locator('[data-skeleton="agenda"]').count(), 0);

    await page.keyboard.press('3');
    await page.locator('.nw-list .load-failed', {hasText: 'Couldn’t load News, Something went wrong.'}).waitFor();

    await page.keyboard.press('Meta+,');
    await page.locator('.settings .set-nav').getByRole('button', {name: 'AI', exact: true}).click();
    await page.locator('.settings .load-failed', {hasText: 'Couldn’t load Settings › AI, Something went wrong.'}).waitFor();
    assert.equal(await page.locator('.settings [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the reader draws the email\'s head from its row at once, and only its body waits, a skeleton (reader-01)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    let release = await hold(page, /^\/api\/mail\/messages\/\d+(\/open)?$/);
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).click();
    // At once, though the email itself is held: its subject, sender, account and time, and its actions.
    const head = page.locator('.pane .rd-head');
    await head.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    assert.equal(await head.locator('.name').textContent(), 'Google');
    assert.equal(await head.locator('.account').textContent(), 'Personal');
    assert.equal(await head.locator('.rd-acts .btn', {hasText: 'Ask about this email'}).count(), 1);
    await shown(page, 'body');
    assert.equal(await page.locator('.pane .mailtext').count(), 0);
    const subjectAt = (await rested(() => head.locator('.rd-subj').boundingBox()))!.y;
    await release();
    await page.locator('.pane .facts-card').waitFor();
    assert.equal(await page.locator('.pane [data-skeleton]').count(), 0);
    assert.equal((await rested(() => head.locator('.rd-subj').boundingBox()))!.y, subjectAt, 'the head stays where it was');

    // An email with an attachment holds its card's place too.
    release = await hold(page, /^\/api\/mail\/messages\/\d+(\/open)?$/);
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    await page.locator('.pane .rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await (await shown(page, 'body')).locator('.sk-attach').waitFor();
    await release();
    await page.locator('.pane .attach').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone, a tapped email opens at once from its row, its body a skeleton until it comes (phone-04)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    const release = await hold(page, /^\/api\/mail\/messages\/\d+(\/open)?$/);
    await page.locator('.list .row:has(b[data-tip^="Final exam schedule"])').click();
    await page.locator('.pane .rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await shown(page, 'body');
    await release();
    await page.locator('.pane .mailtext').waitFor();
    assert.equal(await page.locator('.pane [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('News loading: its list\'s skeleton, never "Nothing new", until the stories replace it (news-03)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const release = await hold(page, /^\/api\/news$/);
    await visit(page, `${setpoint.base}/news`);
    await shown(page, 'news');
    assert.equal(await page.locator('.nw-list :is(.nw-lead, .nw-row, .nw-sec, .nw-empty)').count(), 0, 'no story, and no "Nothing new"');
    await release();
    await page.locator('.nw-lead').first().waitFor();
    // The list's own skeleton; the sidebar's may still be waiting for its answers.
    assert.equal(await page.locator('[data-skeleton="news"]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a story opens at once from its row: sections, headline and meta; its summary and sources a skeleton (news-05)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await page.locator('.nw-lead').first().waitFor();
    const release = await hold(page, /^\/api\/news\/stories\/\d+$/);
    const lead = page.locator('.nw-lead', {hasText: 'Brush fire near the 210'});
    const headline = await lead.locator('.hl').textContent();
    await lead.click();
    const pane = page.locator('section.pane:not(.idle)');
    await pane.locator('.rd-subj', {hasText: headline!}).waitFor();
    assert.deepEqual(await pane.locator('.st-secs .tag').allTextContents(), ['Local']);
    const meta = await pane.locator('.st-meta').textContent();
    await shown(page, 'story');
    assert.equal(await pane.locator('.st-sum').count(), 0);
    await release();
    await pane.locator('.st-sum').waitFor();
    await pane.locator('.src-row').first().waitFor();
    assert.equal(await pane.locator('[data-skeleton]').count(), 0);
    assert.equal(await pane.locator('.st-meta').textContent(), meta, 'the meta drawn from the row is the story\'s');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Setpoint starting shows its mark and clears what browsers used to keep; then the sidebar\'s Today is a skeleton until it comes (states-09, shell-10)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const releaseMe = await hold(page, /^\/api\/me$/);
    await page.addInitScript(() => {
      localStorage.setItem('setpoint.sidebar', '{"accounts":[{"label":"Personal"}]}');
      localStorage.setItem('setpoint.signedIn', '1');
    });
    await visit(page, `${setpoint.base}/inbox`);
    await page.locator('.boot.starting svg.mark').waitFor();
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('setpoint.sidebar'), localStorage.getItem('setpoint.signedIn')]), [null, null]);

    // Setpoint answers: Today waits as a skeleton.
    const release = await hold(page, /^\/api\/items\?.*$/);
    await releaseMe();
    const today = await shown(page, 'today');
    assert.equal(await today.locator('.sk-line').count(), 3);
    const height = (element: Element) => Math.round(element.getBoundingClientRect().height);
    const skeleton = await rested(() => today.locator('.sk-line').first().evaluate(height));
    await release();
    await page.locator('aside.sb .today-row.next').waitFor();
    // The event's two lines (SV-210) come in where the skeleton's first stood, as tall.
    assert.equal(await rested(() => page.locator('aside.sb .today-row.next').evaluate(height)), skeleton);
    // Today's items are in (nothing is held now).
    await setpoint.idle();
    assert.equal(await page.locator('aside.sb [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a search on its way shows the results\' skeleton in the Inbox\'s place until they come, and a refinement keeps them, dimmed (search-03)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    let release = await hold(page, /^\/api\/search$/);
    const inbox = page.locator('section.list[aria-label="Inbox"]');
    await page.keyboard.press('/');
    await page.keyboard.type('northwind');
    // Once it's taken a moment: the results' skeleton.
    const sk = page.locator('[data-skeleton="search"]');
    await sk.waitFor();
    assert.equal(await inbox.count(), 0);
    await release();
    const results = page.locator('section.search-list');
    await results.locator('.arow.result').first().waitFor();

    // A refinement on its way: the results stay, dimmed once it's taken a moment.
    release = await hold(page, /^\/api\/search$/);
    await page.keyboard.type(' rejection');
    await until('the old results dimmed', () => results.locator('.arow.result').first().evaluate(row => getComputedStyle(row).opacity), opacity => opacity === '0.55');
    await release();
    await until('the new results', () => results.locator('.arow.result').first().evaluate(row => getComputedStyle(row).opacity), opacity => opacity === '1');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
