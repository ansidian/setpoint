// The shared tooltip (DESIGN.md › Decided while building #299): resting the mouse on an element with
// `data-tip` shows its words under it, describing it while it shows, and moving off or a press
// puts it away. The reader's sender, "to you" and time are its first: the sender's address, the
// account's, and the full timestamp.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {AccountOut, AllOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, rested, startSetpoint, test} from './harness.ts';

after(cleanUp);

const tip = (page: Page) => page.locator('.tip[role="tooltip"]');

test('the reader\'s sender and "to you" show their addresses in the tooltip, under each, and leaving or a press puts it away', async () => {
  const setpoint = await startSetpoint();
  try {
    const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
    const row = all.days.flatMap(day => day.rows).find(each => each.subject.startsWith('Interview availability'))!;
    const account = (await setpoint.api<AccountOut[]>('GET', '/accounts')).find(each => each.id === row.account_id)!;
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox/${row.id}`);
    const name = page.locator('.rd-meta .name');
    const to = page.locator('.rd-meta .to > span');
    await name.waitFor();
    // Setpoint's own, never the browser's as well.
    assert.equal(await name.getAttribute('title'), null);

    await name.hover();
    await tip(page).waitFor();
    assert.equal(await tip(page).textContent(), row.from_address);
    assert.equal(await name.getAttribute('aria-describedby'), 'tip');
    const [named, shown] = await rested(async () => [(await name.boundingBox())!, (await tip(page).boundingBox())!]);
    assert.ok(shown.y >= named.y + named.height, 'under the name');
    assert.ok(Math.abs(shown.x + shown.width / 2 - (named.x + named.width / 2)) < 1, 'centred on it');

    await to.hover();
    await tip(page).filter({hasText: account.address}).waitFor();
    assert.equal(await name.getAttribute('aria-describedby'), null, 'the name is no longer described by it');

    await page.locator('.rd-subj').hover();
    await tip(page).waitFor({state: 'detached'});

    await to.hover();
    await tip(page).waitFor();
    await page.mouse.down();
    await tip(page).waitFor({state: 'detached'});
    await page.mouse.up();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
