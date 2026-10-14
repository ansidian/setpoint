// Light, System and Night (F7): boards 22a and 22b (boards 01 and 11 in Light) against their
// approved screenshots, then the switch itself: System follows the browser, a choice is kept per browser, the
// first paint doesn't fade and a switch fades every colour over 180 ms.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, matchGolden, startSetpoint, until, watch} from './harness.ts';

after(cleanUp);

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test('board 22a: the Inbox in Light (System, with the browser preferring light), Northwind open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.today-row').first().waitFor();
    await page.locator('.list .row[title^="Interview availability"]').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await until('the sidebar\'s unread count', () => page.locator('.nav.on .cnt').textContent(), text => text === '18');
    assert.equal(await theme(page), 'light');
    await page.mouse.move(700, 28);
    await matchGolden(page, '22a-light-inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 22b: October 2026 in Light, chosen in this browser', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    // The browser prefers dark (the harness's colour scheme); the choice stored here wins.
    await page.addInitScript(() => localStorage.setItem('setpoint.theme', 'light'));
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    assert.equal(await theme(page), 'light');
    await page.mouse.move(1000, 28);
    await matchGolden(page, '22b-light-calendar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('System follows the browser, the first paint doesn\'t fade, and a change does', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    // Every fade from the document's first moment: one at the first paint is over in 180 ms.
    await page.addInitScript(() => {
      const scope = window as unknown as {fades: number};
      scope.fades = 0;
      // The page has no <html> yet, so the document itself is watched.
      new MutationObserver(() => {
        if (document.documentElement?.classList.contains('theme-fade')) scope.fades += 1;
      }).observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
    });
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    assert.equal(await theme(page), 'night', 'System, with the browser preferring dark');
    assert.equal(await page.evaluate(() => (window as unknown as {fades: number}).fades), 0, 'the first paint doesn\'t fade');
    const classes = await watch(page.locator('html'), 'class');
    await page.emulateMedia({colorScheme: 'light'});
    await until('Light', () => theme(page), value => value === 'light');
    assert.equal((await classes()).some(value => Boolean(value?.split(' ').includes('theme-fade'))), true, 'the change fades');
    // Mid-fade the page is between the two backgrounds, then lands on Light's.
    const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await until('the fade ends', () => page.evaluate(() => document.documentElement.classList.contains('theme-fade')), on => !on);
    assert.equal(await background(), 'rgb(246, 246, 244)');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
