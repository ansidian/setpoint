// Board 01 as a scene on the seed, at the design target, 1677 × 1050, built and checked for its
// content and no page errors. The app runs on the seed with the seed's clock, so its ages and
// counts are the brief's. Then the Inbox's right edge (SV-141).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, rested, SIZES, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

test('board 01: the Inbox on a typical morning, Northwind open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    // Opening it read it: Inbox 18 and Jobs 1 (DESIGN.md override 2).
    await until('the sidebar\'s unread count', () => page.locator('.nav.on .ubadge').textContent(), text => text === '18');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-217: the Inbox\'s rows stop before the pane on every screen: the ages, the accounts\' column, the fold\'s chevron and a search\'s rows', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const rights = (page: Page, cells: string) => rested(() => page.evaluate(selector => [...new Set([...document.querySelectorAll(selector)].map(each => Math.round(each.getBoundingClientRect().right)))], cells));
    const paneLeft = async (page: Page) => Math.round((await rested(() => page.locator('section.pane').boundingBox()))!.x);
    const before = (ends: number[], pane: number) => ends.length > 0 && Math.max(...ends) <= pane;
    for (const [width, height] of [[SIZES.target.width, SIZES.target.height], [2655, 1400]] as const) {
      const page = await setpoint.page({width, height});
      await page.goto(`${setpoint.base}/inbox`);
      await page.locator('.list.all .row').first().waitFor();
      const pane = await paneLeft(page);
      const ends = await rights(page, '.row .age, .nfold .chev .icon');
      assert.ok(before(ends, pane), `${width}: the rows end at ${ends.join(', ')}, the pane from ${pane}`);
      assert.equal((await rights(page, '.row .ac')).length, 1, `${width}: the accounts in one column`);
      await page.keyboard.press('/');
      await page.keyboard.type('northwind');
      await page.locator('.arow.result').first().waitFor();
      const found = await rights(page, '.arow.result .age');
      assert.ok(before(found, pane), `${width}: a search's rows end at ${found.join(', ')}, the pane from ${pane}`);
      await page.close();
    }
  } finally {
    await setpoint.stop();
  }
});
