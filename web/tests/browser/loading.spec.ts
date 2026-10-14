// Loading in the browser (the polish audit's loading slice, SV-61; DESIGN.md › Motion › Loading and
// Decided while building #225–#236): each page's skeleton while its data is held at the server's
// door, in its rows' shapes and the quiet breathing, never a false empty; a load that fails says so
// in place with Try again; Setpoint starting shows its mark, or the shell when this browser was
// signed in; the reader and the story pane draw their heads from their rows at once; search keeps
// the list, then a skeleton, then spins. Every check holds the answer it's about, so "while it
// loads" is as long as the check needs, and releases it to see the rows replace the skeleton.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Page, Route} from 'playwright-core';
import {skeleton} from '../../src/tokens.ts';
import {cleanUp, matchGolden, startSetpoint, until} from './harness.ts';

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

/** A token's colour as the page computes it. */
const tokenColour = (page: Page, token: string) => page.evaluate(name => {
  const probe = document.createElement('span');
  probe.style.color = `var(--${name})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

/** Waits until a skeleton has come in after its delay, and is drawn. */
async function shown(page: Page, kind: string) {
  const found = page.locator(`[data-skeleton="${kind}"]`).first();
  await found.waitFor();
  await until(`the ${kind} skeleton in`, () => found.evaluate(element => element.getAnimations().find(animation => (animation as CSSAnimation).animationName === 'sk-in')?.playState ?? 'none'), state => state === 'finished');
  return found;
}

const heights = (page: Page, selector: string) => page.locator(selector).evaluateAll(all => all.map(element => element.getBoundingClientRect().height));

test('Inbox loading: a skeleton in the rows\' shapes after 200 ms, breathing, never an empty list; the rows replace it where it stood (states-03, inbox-13)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const release = await hold(page, /^\/api\/mail\/(inbox|all)/);
    await visit(page, `${setpoint.base}/inbox`);
    const sk = await shown(page, 'all');
    // Its motion: in after 200 ms over 180, then each bar breathes over 1600 ms, from the same moment, so in phase.
    const motion = (element: Element) => {
      const style = getComputedStyle(element);
      return [style.animationName, style.animationDuration, style.animationDelay, style.animationTimingFunction, style.animationIterationCount];
    };
    assert.deepEqual(await sk.evaluate(motion), ['sk-in', '0.18s', `${skeleton.delayMs / 1000}s`, 'cubic-bezier(0.2, 0, 0, 1)', '1']);
    assert.deepEqual(await sk.locator('.sk-bar').first().evaluate(motion),
      ['sk-breathe', `${skeleton.breatheMs / 1000}s`, `${(skeleton.delayMs + 180) / 1000}s`, skeleton.breatheEase.replace(/,/g, ', ').replace(/\.(\d)/g, '0.$1'), 'infinite']);
    // The headers' band stays still under them.
    assert.equal(await sk.locator('.sk-gh').first().evaluate(header => getComputedStyle(header).animationName), 'none');
    assert.equal(await page.locator('.sk-bar').first().evaluate(bar => getComputedStyle(bar).backgroundColor), await tokenColour(page, 'sub2'));
    // No row is a skeleton's.
    assert.equal(await page.locator('.list .row, .list .gh').count(), 0);
    const before = {gh: await heights(page, '.sk-gh'), row: await heights(page, '.sk-row')};
    assert.deepEqual([before.gh[0], before.row[0]], [30, 38]);
    await page.mouse.move(700, 28);
    await matchGolden(page, 'loading-inbox', 'list');

    await release();
    await page.locator('.list .row').first().waitFor();
    assert.equal(await page.locator('[data-skeleton]').count(), 0);
    assert.equal(await page.locator('section.list').getAttribute('class'), 'list all sk-arrive', 'the rows fade in');
    // The rows stand where the skeleton's did: a band, then rows.
    assert.equal((await heights(page, '.list .gh'))[0], before.gh[0]);
    assert.equal((await heights(page, '.list .row'))[0], before.row[0]);
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
    await visit(page, `${setpoint.base}/inbox`);
    await shown(page, 'all');
    await until('the Inbox\'s groups in', () => page.evaluate(() => performance.getEntriesByType('resource').some(entry => /\/api\/mail\/inbox$/.test(entry.name))), loaded => loaded);
    assert.equal(await page.locator('.list .row, .list .gh').count(), 0);
    await release();
    await page.locator('.list .gh.new').waitFor();
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
      const sk = await shown(page, 'settings');
      const text = await main.innerText();
      for (const empty of FALSE_EMPTIES) assert.ok(!text.includes(empty), `${name} says "${empty}" while it loads`);
      // Inside the page's `sub` group, the bars are `sub3`.
      assert.equal(await sk.locator('.sk-bar').first().evaluate(bar => getComputedStyle(bar).backgroundColor), await tokenColour(page, 'sub3'));
      if (name === 'Todoist') {
        await page.mouse.move(700, 28);
        await matchGolden(page, 'loading-settings-todoist', 'settings');
      }
    }
    await release();
    await main.locator('.set-row', {hasText: 'Recovery'}).or(main.locator('.set-row', {hasText: 'left'})).first().waitFor();
    await page.locator('.settings .set-nav .nav', {hasText: 'Todoist'}).click();
    await main.locator('.set-row', {hasText: 'Connected'}).waitFor();
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
    const asked = ['/api/mail/rules', '/api/mail/trusted-domains', '/api/security', '/api/ai', '/api/news/sources']
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
    assert.equal(await page.locator('[data-skeleton="agenda"] .sk-ag').count(), 3);
    assert.equal(await page.locator('[data-skeleton="calendars"] .sk-calrow').count(), 4);
    // The sidebar's rows as tall as a calendar's (30 px), their box 14 px, radius 4.
    assert.deepEqual(await page.locator('.sk-calrow').first().evaluate(row => [row.getBoundingClientRect().height, row.querySelector('.sk-box')!.getBoundingClientRect().width, getComputedStyle(row.querySelector('.sk-box')!).borderRadius]), [30, 14, '4px']);
    await page.mouse.move(700, 28);
    await matchGolden(page, 'loading-calendar-pane', 'rightPane');

    await release();
    await page.locator('.rpane .ag-item', {hasText: 'Dentist'}).waitFor();
    await page.locator('.sb .calrow').first().waitFor();
    assert.equal(await page.locator('[data-skeleton]').count(), 0);
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

test('a load that fails says so in place, in caution with its warning, and Try again loads it (states-06)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    let failing = true;
    await failWhile(page, /^\/api\/mail\/inbox$/, () => failing);
    await visit(page, `${setpoint.base}/inbox`);
    const line = page.locator('section.list .load-failed');
    await line.waitFor();
    assert.equal(await line.innerText(), 'Couldn’t load the Inbox, Something went wrong.\n·\nTry again');
    assert.equal(await line.evaluate(element => getComputedStyle(element).color), await tokenColour(page, 'caution'));
    assert.deepEqual(await line.locator('.icon').evaluateAll(icons => icons.map(icon => icon.getAttribute('width'))), ['16', '16']);
    assert.equal(await line.evaluate(element => element.getBoundingClientRect().height), 32);
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

test('the reader draws the email\'s head from its row at once, and only its body waits, a skeleton; an HTML email holds its frame\'s place (reader-01)', async () => {
  const setpoint = await startSetpoint({fixtures: ['coffee-html'], clock: 'frozen'});
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
    const body = await shown(page, 'body');
    assert.equal(await page.locator('.pane .mailtext').count(), 0);
    // Its lines at the body's rhythm: 10 px bars 12 apart, at most 600 px.
    assert.deepEqual(await body.evaluate(element => [getComputedStyle(element).rowGap, element.getBoundingClientRect().width <= 600, element.querySelector('.sk-bar')!.getBoundingClientRect().height]), ['12px', true, 10]);
    const subjectAt = (await head.locator('.rd-subj').boundingBox())!.y;
    await page.mouse.move(700, 28);
    await matchGolden(page, 'loading-reader', 'reader');
    await release();
    await page.locator('.pane .facts-card').waitFor();
    assert.equal(await page.locator('.pane [data-skeleton]').count(), 0);
    assert.equal((await head.locator('.rd-subj').boundingBox())!.y, subjectAt, 'the head stays where it was');
    assert.equal(await page.locator('.pane .rd-body').getAttribute('class'), 'rd-body sk-arrive', 'the body fades in');

    // An email with an attachment holds its card's place too.
    release = await hold(page, /^\/api\/mail\/messages\/\d+(\/open)?$/);
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    await page.locator('.pane .rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await (await shown(page, 'body')).locator('.sk-attach').waitFor();
    await release();
    await page.locator('.pane .attach').waitFor();

    // An HTML email's frame holds 240 px on `sub`, unseen, until its page says its height; then it fades in.
    release = await hold(page, /^\/api\/mail\/messages\/\d+\/body/);
    // The newsletter is in New's Noise, folded until opened.
    await page.locator('.list .nfold.collapsed').first().click();
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    const box = page.locator('.mailframe-box');
    await box.waitFor();
    assert.deepEqual(await box.evaluate(element => [element.className, element.getBoundingClientRect().height, getComputedStyle(element).backgroundColor, getComputedStyle(element.querySelector('iframe')!).opacity]),
      ['mailframe-box measuring', 240, await tokenColour(page, 'sub'), '0']);
    await release();
    await page.locator('.mailframe-box:not(.measuring)').waitFor();
    await until('the frame takes the email\'s height', () => box.evaluate(element => element.getBoundingClientRect().height), height => height > 300);
    assert.equal(await box.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
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
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.pane .rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await shown(page, 'body');
    await matchGolden(page, 'loading-reader-phone');
    await release();
    await page.locator('.pane .mailtext').waitFor();
    assert.equal(await page.locator('.pane [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('News loading: its list\'s skeleton in the blocks\' shapes, a header, a lead and its rows, which the stories replace where they stood (news-03)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const release = await hold(page, /^\/api\/news$/);
    await visit(page, `${setpoint.base}/news`);
    const sk = await shown(page, 'news');
    assert.deepEqual(await sk.evaluate(element => [element.querySelectorAll('.sk-nw-sec').length, element.querySelectorAll('.sk-nw-lead').length, element.querySelectorAll('.sk-nw-row').length]), [2, 2, 6]);
    assert.equal(await page.locator('.nw-list :is(.nw-lead, .nw-row, .nw-sec, .nw-empty)').count(), 0, 'no story, and no "Nothing new"');
    const before = {sec: await heights(page, '.sk-nw-sec'), lead: await heights(page, '.sk-nw-lead'), row: await heights(page, '.sk-nw-row')};
    await page.mouse.move(700, 28);
    await matchGolden(page, 'loading-news', 'news');
    await release();
    await page.locator('.nw-lead').first().waitFor();
    assert.equal(await page.locator('[data-skeleton]').count(), 0);
    assert.equal(await page.locator('.nw-list .list').getAttribute('class'), 'list sk-arrive', 'the stories fade in');
    // The header, the lead and a row with its thumbnail stand where the skeleton's did.
    assert.equal((await heights(page, '.nw-sec'))[0], before.sec[0]);
    assert.equal((await heights(page, '.nw-lead'))[0], before.lead[0]);
    assert.equal(await page.locator('.nw-row', {hasText: 'Federal agents detain 9'}).evaluate(row => row.getBoundingClientRect().height), before.row[0]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a news image\'s box waits with a skeleton\'s fill, Light\'s `sub3`, and the image fades in over it with a hairline edge (news-02)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    let release = await hold(page, /^\/api\/news\/images\//);
    await visit(page, `${setpoint.base}/news`);
    const box = page.locator('.nw-lead .nw-ph').first();
    await box.waitFor();
    const look = () => box.evaluate(element => {
      const image = element.querySelector('.nw-img')!;
      return [element.className, getComputedStyle(element).backgroundColor, getComputedStyle(element).animationName, getComputedStyle(image).opacity];
    });
    assert.deepEqual(await look(), ['nw-ph', await tokenColour(page, 'sub2'), 'sk-breathe', '0']);
    assert.deepEqual(await box.locator('.nw-img').evaluate(image => [getComputedStyle(image).outlineStyle, getComputedStyle(image).outlineWidth, getComputedStyle(image).outlineOffset, getComputedStyle(image).outlineColor, getComputedStyle(image).transitionDuration]),
      ['solid', '1px', '-1px', await tokenColour(page, 'edge'), '0.18s']);
    await release();
    assert.deepEqual(await until('the image faded in', look, value => value[3] === '1'), ['nw-ph done', 'rgba(0, 0, 0, 0)', 'none', '1']);

    // In Light, the box's fill is `sub3`, which shows on the page.
    await page.evaluate(() => localStorage.setItem('setpoint.theme', 'light'));
    release = await hold(page, /^\/api\/news\/images\//);
    await visit(page, `${setpoint.base}/news`);
    await box.waitFor();
    assert.equal(await box.evaluate(element => getComputedStyle(element).backgroundColor), await tokenColour(page, 'sub3'));
    await release();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a story opens at once from its row: sections, headline, meta and its image, the thumbnail blurred until the large copy; its summary and sources a skeleton (news-05)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await page.locator('.nw-lead').first().waitFor();
    const release = await hold(page, /^\/api\/news\/stories\/\d+$/);
    const lead = page.locator('.nw-lead', {hasText: 'Brush fire near the 210'});
    const headline = await lead.locator('.hl').textContent();
    await lead.click();
    const pane = page.locator('section.pane');
    await pane.locator('.rd-subj', {hasText: headline!}).waitFor();
    assert.deepEqual(await pane.locator('.st-secs .tag').allTextContents(), ['Local']);
    const meta = await pane.locator('.st-meta').textContent();
    // Its image: the large copy over the row's thumbnail, blurred, which stands in until the large is in.
    assert.equal(await pane.locator('.st-img .nw-ph .nw-blur').evaluate(image => getComputedStyle(image).filter), 'blur(6px)');
    await shown(page, 'story');
    assert.equal(await pane.locator('.st-sum').count(), 0);
    assert.equal(await pane.locator('.st-swap').evaluate(element => getComputedStyle(element).animationName), 'st-in');
    await page.mouse.move(700, 28);
    await matchGolden(page, 'loading-story', 'reader');
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

test('Setpoint starting in a new browser shows its mark after 200 ms where the sign-in card\'s top sits, chips settling in turn; then the sidebar\'s accounts and Today are skeletons until they come (states-09, shell-10)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const releaseMe = await hold(page, /^\/api\/me$/);
    await visit(page, `${setpoint.base}/inbox`);
    const mark = page.locator('.boot.starting svg.mark');
    await mark.waitFor();
    const box = (await mark.boundingBox())!;
    assert.deepEqual([box.width, box.height, box.y], [36, 36, 1050 / 2 - 120]);
    // Each chip settles as the mark's settle has them (#203), once the start has taken 200 ms, 70 ms after the one before.
    assert.deepEqual(await mark.locator('g').evaluateAll(chips => chips.map(chip => [getComputedStyle(chip).animationName, getComputedStyle(chip).animationDuration, getComputedStyle(chip).animationDelay])),
      [['mark-settle', '0.26s', '0.2s'], ['mark-settle', '0.26s', '0.27s'], ['mark-settle', '0.26s', '0.34s']]);
    await until('the chips settled', () => mark.locator('g').evaluateAll(chips => chips.map(chip => chip.getAnimations().every(animation => animation.playState === 'finished'))), settled => settled.every(Boolean));
    assert.equal(await mark.evaluate(svg => getComputedStyle(svg).animationName), 'sk-breathe', 'then it breathes as a skeleton does');
    await matchGolden(page, 'starting');

    // Setpoint answers: the app fades in; its accounts and Today wait as skeletons, three rows each.
    const release = await hold(page, /^\/api\/(accounts|items\?.*)$/);
    await releaseMe();
    await page.locator('.app.boot-after').waitFor();
    assert.equal(await page.locator('.app.boot-after').evaluate(element => getComputedStyle(element).animationName), 'sk-arrive');
    await shown(page, 'accounts');
    assert.deepEqual(await heights(page, '[data-skeleton="accounts"] .sk-acct'), [28, 28, 28]);
    assert.equal(await (await shown(page, 'today')).locator('.sk-line').count(), 3);
    await release();
    await page.locator('aside.sb .acct').first().waitFor();
    assert.equal(await page.locator('aside.sb [data-skeleton]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a browser that was signed in starts on its shell as it last stood: its accounts, counts and Today\'s place, and the page\'s skeleton; the app takes over in place (shell-10)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    const sidebar = () => page.locator('aside.sb').evaluate(aside => ({
      accounts: [...aside.querySelectorAll('.acct')].map(row => row.textContent),
      inbox: aside.querySelector('.nav')!.textContent,
      calendarAt: [...aside.querySelectorAll('.nav')].find(nav => nav.textContent === 'Calendar')!.getBoundingClientRect().y,
    }));
    const loaded = await sidebar();
    const todayLines = await page.locator('.today-row').count();

    // The next open: Setpoint hasn't answered yet.
    const releaseMe = await hold(page, /^\/api\/me$/);
    await visit(page, `${setpoint.base}/inbox`);
    await page.locator('.app[data-frame]').waitFor();
    assert.deepEqual(await sidebar(), loaded, 'the accounts and counts as they were, nothing moved');
    assert.equal(await (await shown(page, 'today')).locator('.sk-line').count(), todayLines, 'Today\'s place, its lines as many as it had');
    await shown(page, 'all');
    await page.mouse.move(700, 28);
    await matchGolden(page, 'starting-shell', 'sidebar');

    // Setpoint answers before the Inbox's own answers: the app's sidebar keeps the same rows, and its
    // list's skeleton carries on from the shell's rather than fading in again.
    const release = await hold(page, /^\/api\/(accounts|mail\/(counts|inbox))$/);
    await releaseMe();
    await page.locator('.app:not([data-frame])').waitFor();
    assert.deepEqual(await sidebar(), loaded);
    assert.match((await page.locator('[data-skeleton="all"]').getAttribute('class'))!, /\bcarried\b/);
    await release();
    await page.locator('.list .row').first().waitFor();
    assert.deepEqual(await sidebar(), loaded);

    // Signed out, this browser forgets the session's shape.
    await page.locator('.sb-foot .nav', {hasText: 'Settings'}).click();
    await page.locator('.settings .set-nav .nav', {hasText: 'Sign out'}).click();
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).click();
    await page.locator('.sign-in').waitFor();
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem('setpoint.signedIn'), localStorage.getItem('setpoint.sidebar')]), [null, null]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone, a signed-in browser starts on its header, tabs and the page\'s skeleton, an email\'s address on its reader\'s (phone-12)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    const releaseMe = await hold(page, /^\/api\/me$/);
    await visit(page, `${setpoint.base}/inbox`);
    await page.locator('.app[data-frame] .ph-tabs').waitFor();
    assert.equal(await page.locator('.hd .hd-title').textContent(), 'Inbox');
    assert.equal(await page.locator('.hd svg.mark').count(), 1);
    await shown(page, 'all');
    await matchGolden(page, 'starting-shell-phone');
    await visit(page, `${setpoint.base}/inbox/5`);
    await page.locator('.app[data-frame] .pane').waitFor();
    await shown(page, 'body');
    await releaseMe();
    await page.locator('.pane .rd-subj').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a search on its way keeps the list, dimmed, then shows the results\' skeleton, and the field\'s glyph turns; the results fade in (search-03)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    let release = await hold(page, /^\/api\/search$/);
    // At once: the Inbox stays, at .55, not a blank page. It's dimmed only until the skeleton comes,
    // which a busy machine can spend typing, so the list is read as it dims, not after.
    const inbox = page.locator('section.list[aria-label="Inbox"]');
    await inbox.evaluate(list => new MutationObserver((_, observer) => {
      if (!list.classList.contains('search-wait')) return;
      (window as unknown as {dimmed?: string}).dimmed = getComputedStyle(list).transitionDuration;
      observer.disconnect();
    }).observe(list, {attributes: true, attributeFilter: ['class']}));
    await page.keyboard.press('/');
    await page.keyboard.type('northwind');
    assert.equal(await until('the Inbox dimmed', () => page.evaluate(() => (window as unknown as {dimmed?: string}).dimmed), dimmed => dimmed !== undefined), '0.12s');
    // Once it's taken a moment: the results' skeleton, six rows shaped as results, and the spinner in the field.
    const sk = page.locator('[data-skeleton="search"]');
    await sk.waitFor();
    assert.equal(await inbox.count(), 0);
    assert.equal(await sk.locator('.sk-result').count(), 6);
    const field = page.locator('.hd .search');
    // The search is asked once typing pauses, which on a busy machine can come after the skeleton.
    await until('the field pending', () => field.getAttribute('class'), classes => /\bpending\b/.test(classes!));
    await until('the glass gives way to the spinner', () => field.evaluate(label => [getComputedStyle(label.querySelector('.glass > .spin')!).visibility, getComputedStyle(label.querySelector('.glass > .icon')!).visibility]),
      ([spin, glass]) => spin === 'visible' && glass === 'hidden');
    assert.equal(await field.locator('.glass > .spin').evaluate(spin => getComputedStyle(spin).animationDelay), `${skeleton.delayMs / 1000}s`);
    await page.mouse.move(700, 28);
    await matchGolden(page, 'loading-search', 'main');
    await release();
    const results = page.locator('section.search-list');
    await results.locator('.arow.result').first().waitFor();
    assert.equal(await results.evaluate(list => getComputedStyle(list).animationName), 'sk-arrive');
    await until('the field\'s glass back', () => field.getAttribute('class'), classes => !classes!.includes('pending'));

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
