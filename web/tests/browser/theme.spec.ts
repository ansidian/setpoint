// Light, System and Night (F7): boards 22a and 22b (boards 01 and 11 in Light), each also one of the
// release's page screenshots (pages.ts), then the switch itself: System follows the browser and a
// choice is kept per browser.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, matchGolden, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

test('board 22a: the Inbox in Light (System, with the browser preferring light), Northwind open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.today-row').first().waitFor();
    await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    await until('the sidebar\'s unread count', () => page.locator('.nav.on .ubadge').textContent(), text => text === '18');
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

test('System follows the browser', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    assert.equal(await theme(page), 'night', 'System, with the browser preferring dark');
    await page.emulateMedia({colorScheme: 'light'});
    await until('Light', () => theme(page), value => value === 'light');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘J switches Light and Night, from a field too, and leaves System alone', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // System, with the browser preferring dark: ⌘J keeps following the browser.
    await page.keyboard.press('ControlOrMeta+j');
    assert.equal(await theme(page), 'night');
    assert.equal(await page.evaluate(() => localStorage.getItem('setpoint.theme')), null);
    await page.emulateMedia({colorScheme: 'light'});
    await until('System still following the browser', () => theme(page), value => value === 'light');

    await page.evaluate(() => localStorage.setItem('setpoint.theme', 'light'));
    await page.reload();
    await page.locator('.list .row').first().waitFor();
    await page.keyboard.press('ControlOrMeta+j');
    await until('Night', () => theme(page), value => value === 'night');
    assert.equal(await page.evaluate(() => localStorage.getItem('setpoint.theme')), 'night');
    await page.keyboard.press('/');
    await page.keyboard.press('ControlOrMeta+j');
    await until('Light, from the search field', () => theme(page), value => value === 'light');
    assert.equal(await page.evaluate(() => localStorage.getItem('setpoint.theme')), 'light');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
