// Board 01 as a scene on the seed, at the design target, 1677 × 1050, built and checked for its
// content and no page errors, with one of the release's page screenshots (pages.ts). The app runs on
// the seed with the seed's clock, so its ages and counts are the brief's. Then the Inbox's right edge
// (SV-141).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, matchGolden, rested, SIZES, startSetpoint, test, until, ZOOM} from './harness.ts';

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
    await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
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

test('SV-217: the Inbox\'s rows run to the pane on every screen: the ages, the accounts\' column, the fold\'s chevron and a search\'s rows stop 16 before it, and the search field ends the header', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const rights = (page: Page, cells: string) => rested(() => page.evaluate(selector => [...new Set([...document.querySelectorAll(selector)].map(each => Math.round(each.getBoundingClientRect().right)))], cells));
    const paneLeft = async (page: Page) => Math.round((await rested(() => page.locator('section.pane').boundingBox()))!.x);
    for (const [width, height, zoom] of [[SIZES.target.width, SIZES.target.height, ZOOM], [2655, 1400, 1.25]] as const) {
      const page = await setpoint.page({width, height});
      await page.goto(`${setpoint.base}/inbox`);
      await page.locator('.list.all .row').first().waitFor();
      const end = await paneLeft(page) - Math.round(16 * zoom);
      assert.deepEqual(await rights(page, '.row .age, .nfold .chev .icon'), [end], `${width}: the rows' end`);
      assert.equal((await rights(page, '.row .ac')).length, 1, `${width}: the accounts in one column`);
      assert.deepEqual(await rights(page, '.hd .search'), [Math.round(width - 16 * zoom)], `${width}: the search field ends the header`);
      await page.keyboard.press('/');
      await page.keyboard.type('northwind');
      await page.locator('.arow.result').first().waitFor();
      assert.deepEqual(await rights(page, '.arow.result .age'), [end], `${width}: a search's rows stop there too`);
      await page.close();
    }
  } finally {
    await setpoint.stop();
  }
});
