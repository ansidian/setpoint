// Loading in the browser (the polish audit's loading slice, SV-61; DESIGN.md › Motion › Loading and
// Decided while building #170–#181): each page's skeleton while its data is held at the server's
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

test('Unread loading: a skeleton in the rows\' shapes after 200 ms, breathing, never All caught up; the rows replace it where it stood (states-03, inbox-13)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const release = await hold(page, /^\/api\/mail\/inbox$/);
    await visit(page, `${setpoint.base}/inbox`);
    const sk = await shown(page, 'inbox');
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
    // Nothing says the Inbox is empty, and no row is a skeleton's.
    assert.equal(await page.locator('.empty').count(), 0, 'no All caught up');
    assert.equal(await page.locator('.list .row, .list .arow, .list .gh').count(), 0);
    const before = {gh: await heights(page, '.sk-gh'), arow: await heights(page, '.sk-arow'), row: await heights(page, '.sk-row')};
    assert.deepEqual([before.gh[0], before.row[0]], [30, 38]);
    await page.mouse.move(700, 28);
    await matchGolden(page, 'loading-inbox', 'list');

    await release();
    await page.locator('.list .arow').first().waitFor();
    assert.equal(await page.locator('[data-skeleton]').count(), 0);
    assert.equal(await page.locator('section.list').getAttribute('class'), 'list sk-arrive', 'the rows fade in');
    // The rows stand where the skeleton's did: a header, Attention's three-line rows, and the others.
    assert.equal((await heights(page, '.list .gh'))[0], before.gh[0]);
    assert.equal((await heights(page, '.list .arow'))[0], before.arow[0]);
    assert.equal((await heights(page, '.list .row'))[0], before.row[0]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('All loading: its skeleton under the Pinned shelf', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .arow').first().waitFor();
    const release = await hold(page, /^\/api\/mail\/all/);
    await page.locator('.seg button', {hasText: 'All'}).click();
    const sk = await shown(page, 'all');
    // The shelf, from Unread's list, stays above it.
    assert.ok((await page.locator('.list.all .row.shelf').first().boundingBox())!.y < (await sk.boundingBox())!.y);
    assert.equal(await page.locator('.list.all .row:not(.shelf)').count(), 0);
    await release();
    await page.locator('.list.all .row:not(.shelf)').first().waitFor();
    assert.equal(await page.locator('[data-skeleton]').count(), 0);
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
    await page.locator('.list .arow').first().waitFor();
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
