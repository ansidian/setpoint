// The week view in the browser (DESIGN.md › Week view; board 16 drawn Sunday first): switching from
// Month and back with the view kept in the address, the week's layout at the design target, paging
// and Today, a range dragged into the editor, a block moved and resized by drag with its Undo, a
// recurring block's scope asked on the drop, and the floating detail on a block.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, startSetpoint, still, until, writeOutput} from './harness.ts';

after(cleanUp);

const block = (page: Page, date: string, title: string) => page.locator(`.wk-col[data-date="${date}"] .wb`, {hasText: title});

async function openWeek(page: Page, base: string) {
  await page.goto(`${base}/calendar?view=week`);
  await block(page, '2026-10-07', 'Dentist').waitFor();
  await page.evaluate(() => document.fonts.ready);
}

/** The centre of a minute in a day's column, in page pixels. */
async function slot(page: Page, date: string, minutes: number) {
  const column = (await page.locator(`.wk-col[data-date="${date}"]`).boundingBox())!;
  return {x: column.x + column.width / 2, y: column.y + (minutes / 60) * 44};
}

async function dragFrom(page: Page, from: {x: number; y: number}, to: {x: number; y: number}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 6, {steps: 2});
  await page.mouse.move(to.x, to.y, {steps: 8});
  await page.mouse.up();
}

test('Week from Month, kept in the address and remembered; the week of Oct 4 laid out as board 16', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'}).waitFor();
    await page.keyboard.press('w');
    await block(page, '2026-10-07', 'Dentist').waitFor();
    // Measured once Week has zoomed in from Month (polish audit grids-09).
    await still(page);
    assert.match(page.url(), /\/calendar\?view=week$/);
    assert.equal(await page.locator('.hd-title').textContent(), 'Oct 4 – 10, 2026');
    assert.equal(await page.title(), 'Oct 4 – 10, 2026 · Calendar');
    assert.deepEqual(await page.locator('.wk-dhead .dw').allTextContents(), ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    assert.equal(await page.locator('.wk-dhead[data-date="2026-10-07"] .dn.today').count(), 1);
    assert.equal(await page.locator('.wk-col.wk-sel').getAttribute('data-date'), '2026-10-07');
    // Board 16's measures: an hour is 44 px, a one-hour block 42 px, 139 px a day at the design target.
    const dentist = (await block(page, '2026-10-07', 'Dentist').boundingBox())!;
    assert.equal(Math.round(dentist.height), 42);
    const column = (await page.locator('.wk-col[data-date="2026-10-07"]').boundingBox())!;
    assert.ok(Math.abs(column.width - 139) <= 2, `a day is ${column.width} px`);
    assert.equal(await page.locator('.wk-now').count(), 1);
    assert.equal(await page.locator('.wk-gut.now').textContent(), '9:12 AM');
    // Tasks sit in the all-day row; the mini-month marks the week.
    await page.locator('.wk-all .tk', {hasText: 'Pay rent'}).waitFor();
    assert.deepEqual(await page.locator('.mini .wk').allTextContents(), ['4', '5', '6', '7', '8', '9', '10'], 'one band for the week (polish audit calpanes-05)');
    assert.equal(await block(page, '2026-10-07', 'Dentist').getAttribute('aria-label'), 'Dentist, Wed, Oct 7, 2:30 – 3:30 PM, Personal');
    writeOutput('week.target.png', await page.screenshot());

    // Paging keeps the view and the address; Today comes back.
    await page.keyboard.press('ArrowRight');
    await until('the next week', () => page.locator('.hd-title').textContent(), title => title === 'Oct 11 – 17, 2026');
    await page.keyboard.press('t');
    await until('this week again', () => page.locator('.hd-title').textContent(), title => title === 'Oct 4 – 10, 2026');

    // Selecting a day keeps the view in the address.
    await page.locator('.wk-dhead[data-date="2026-10-09"]').click();
    await until('Friday selected', async () => page.url(), url => url.endsWith('/calendar/2026-10-09?view=week'));
    assert.equal(await page.locator('.wk-col.wk-sel').getAttribute('data-date'), '2026-10-09');

    // Back to Month, and Calendar opens in the view last used.
    await page.keyboard.press('m');
    await page.locator('.cal-month').waitFor();
    assert.equal(page.url().includes('view=week'), false);
    await page.keyboard.press('w');
    await page.locator('.cal-week').waitFor();
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-week').waitFor();
    assert.match(page.url(), /view=week/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a range dragged over empty hours opens the editor on it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openWeek(page, setpoint.base);
    await dragFrom(page, await slot(page, '2026-10-08', 12 * 60 + 5), await slot(page, '2026-10-08', 13 * 60 + 25));
    await page.locator('.editor').waitFor();
    await page.locator('.wk-col[data-date="2026-10-08"] .wb.ghost', {hasText: 'New event'}).waitFor();
    assert.match((await page.locator('.wk-col[data-date="2026-10-08"] .wb.ghost').textContent())!, /12:00 – 1:30 PM/);
    await page.keyboard.type('Lunch with Jo');
    await page.keyboard.press('Meta+Enter');
    await block(page, '2026-10-08', 'Lunch with Jo').waitFor();
    assert.match((await block(page, '2026-10-08', 'Lunch with Jo').textContent())!, /12:00 – 1:30 PM/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a new block shows once while its create\'s answer is on its way, though the server\'s list already has it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openWeek(page, setpoint.base);
    // The server makes the item at once, the provider confirms it and the live stream reloads the
    // week, but the create's own answer reaches the browser only after those loads, as answers on
    // separate connections can.
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route('**/api/items', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      await held;
      return route.fulfill({response});
    });
    // What the week's loads have said of it: pending, then confirmed.
    const listed: string[] = [];
    page.on('response', async response => {
      if (response.request().method() !== 'GET' || !response.url().includes('/api/items?')) return;
      const lunch = ((await response.json().catch(() => null)) as ItemsOut | null)?.items.find(item => item.title === 'Lunch with Jo');
      if (lunch) listed.push(lunch.command ? 'pending' : 'confirmed');
    });
    await dragFrom(page, await slot(page, '2026-10-08', 12 * 60 + 5), await slot(page, '2026-10-08', 13 * 60 + 25));
    await page.locator('.editor').waitFor();
    await page.keyboard.type('Lunch with Jo');
    await page.keyboard.press('Meta+Enter');
    await block(page, '2026-10-08', 'Lunch with Jo').waitFor();
    await until('the browser has the server\'s list with it', async () => listed.length, count => count > 0);
    await page.evaluate(() => new Promise(drawn => requestAnimationFrame(() => requestAnimationFrame(drawn))));
    assert.equal(await block(page, '2026-10-08', 'Lunch with Jo').count(), 1, 'drawn once before the answer');
    await until('the browser has it confirmed', async () => listed, said => said.includes('confirmed'));
    await page.evaluate(() => new Promise(drawn => requestAnimationFrame(() => requestAnimationFrame(drawn))));
    assert.equal(await block(page, '2026-10-08', 'Lunch with Jo').count(), 1, 'and once it\'s confirmed');
    release();
    await until('the provider confirms it', () => block(page, '2026-10-08', 'Lunch with Jo').getAttribute('class'), classes => !classes!.split(' ').includes('pending'));
    await setpoint.idle();
    assert.equal(await block(page, '2026-10-08', 'Lunch with Jo').count(), 1, 'and once after it');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a block moves by drag in 15-minute steps to another day, and its bottom edge resizes it, each with Undo', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openWeek(page, setpoint.base);
    const dentist = (await block(page, '2026-10-07', 'Dentist').boundingBox())!;
    // Held 8 px into the block (1 px under its start's line), let go as far into 3:00 PM's hour.
    const target = await slot(page, '2026-10-08', 15 * 60);
    await dragFrom(page, {x: dentist.x + dentist.width / 2, y: dentist.y + 8}, {x: target.x, y: target.y + 9});
    await page.locator('.toast', {hasText: 'Moved Dentist to Thu, Oct 8, 3:00 PM'}).waitFor();
    await block(page, '2026-10-08', 'Dentist').waitFor();
    assert.match((await block(page, '2026-10-08', 'Dentist').textContent())!, /3:00 – 4:00 PM/);

    // Once Google has it, its edges resize it.
    await page.locator('.wk-col[data-date="2026-10-08"] .wb:not(.pending)', {hasText: 'Dentist'}).waitFor();
    const moved = (await block(page, '2026-10-08', 'Dentist').boundingBox())!;
    const end = await slot(page, '2026-10-08', 16 * 60 + 30);
    await dragFrom(page, {x: moved.x + moved.width / 2, y: moved.y + moved.height - 2}, {x: end.x, y: end.y});
    await page.locator('.toast', {hasText: 'Changed Dentist to 3:00 – 4:30 PM'}).waitFor();
    await until('Dentist an hour and a half', () => block(page, '2026-10-08', 'Dentist').textContent(), shown => !!shown?.includes('3:00 – 4:30 PM'));
    await page.keyboard.press('Meta+z');
    await until('the resize undone', () => block(page, '2026-10-08', 'Dentist').textContent(), shown => !!shown?.includes('3:00 – 4:00 PM'));
    // Pressed while Google still has the resize, the Undo waits for it rather than being refused: two
    // trips through the dev provider (600 ms each) and the wait between them.
    await until('the server has it undone', () => setpoint.api<{items: {title: string; ends_at: string | null; command: unknown}[]}>('GET', '/items?from=2026-10-08&to=2026-10-09'),
      list => list.items.some(item => item.title === 'Dentist' && item.ends_at === '2026-10-08T23:00:00.000Z' && !item.command), 10_000);
    assert.equal(await page.locator('.toast', {hasText: 'Couldn\'t'}).count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a recurring block dropped asks this, following or all; a click opens the floating detail', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await openWeek(page, setpoint.base);
    const gym = (await block(page, '2026-10-09', 'Gym').boundingBox())!;
    const target = await slot(page, '2026-10-09', 8 * 60 + 10);
    await dragFrom(page, {x: gym.x + gym.width / 2, y: gym.y + 8}, {x: target.x, y: target.y + 8});
    await page.locator('.scope-card', {hasText: 'Move recurring event'}).waitFor();
    await page.keyboard.press('Escape');
    await until('the prompt closed', () => page.locator('.scope-card').count(), count => count === 0);

    await block(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd .card', {hasText: 'Dentist'}).waitFor();
    await until('the card at rest', () => page.locator('.fd').getAttribute('data-motion'), phase => phase === 'rest');
    const card = (await page.locator('.fd .card').boundingBox())!;
    const chip = (await block(page, '2026-10-07', 'Dentist').boundingBox())!;
    assert.ok(card.x >= chip.x + chip.width || card.x + card.width <= chip.x || card.y >= chip.y + chip.height || card.y + card.height <= chip.y, 'the card sits beside its block');
    writeOutput('week.detail.png', await page.screenshot());
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
