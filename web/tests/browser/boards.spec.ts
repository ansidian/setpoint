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

test('SV-141: the Inbox has one right edge: at the design target it\'s the row\'s end, and on a very wide window the ages, the accounts\' column, the fold\'s chevron, the search field and a search\'s rows all stop at it, a reading pane taking the header to its end', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const rights = (page: Page, cells: string) => rested(() => page.evaluate(selector => [...new Set([...document.querySelectorAll(selector)].map(each => Math.round(each.getBoundingClientRect().right)))], cells));
    const ENDS = '.row .age, .nfold .chev .icon, .hd .search';
    const target = await setpoint.page('target');
    await target.goto(`${setpoint.base}/inbox`);
    assert.deepEqual(await rights(target, ENDS), [Math.round(SIZES.target.width - 16 * ZOOM)], 'the row\'s end, as ever');
    const width = 2655;
    const wide = await setpoint.page({width, height: 1400});
    await wide.goto(`${setpoint.base}/inbox`);
    const ends = await rights(wide, ENDS);
    assert.equal(ends.length, 1, `one right edge: ${ends.join()}`);
    assert.ok(width - ends[0]! > 300, `spare width past it: ${width - ends[0]!}`);
    assert.equal((await rights(wide, '.row .ac')).length, 1, 'the accounts in one column');
    await wide.locator('.list.all .row').first().click();
    await wide.locator('.pane').waitFor();
    assert.deepEqual(await rights(wide, '.hd .search'), [width - 20], 'beside the pane the header runs to its end');
    await wide.goto(`${setpoint.base}/inbox`);
    await wide.keyboard.press('/');
    await wide.keyboard.type('northwind');
    await wide.locator('.arow.result').first().waitFor();
    assert.deepEqual(await rights(wide, '.arow.result .age, .hd .search'), ends, 'a search\'s rows stop there too');
  } finally {
    await setpoint.stop();
  }
});
