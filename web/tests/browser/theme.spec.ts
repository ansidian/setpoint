// Light, System and Night: boards 22a and 22b (boards 01 and 11 in Light), then the switch itself.
// System follows the browser, and a choice is kept per browser. In a composer ⌘J is help me write's.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, startSetpoint, test, until} from './harness.ts';

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
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 22b: October 2026 in Light, chosen in this browser', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    // The browser prefers dark (the harness's colour scheme). The choice stored here wins.
    await page.addInitScript(() => localStorage.setItem('setpoint.theme', 'light'));
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    assert.equal(await theme(page), 'light');
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

test('with the caret in a composer, ⌘J opens help me write and the theme stays; out of it, ⌘J switches the theme again', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.addInitScript(() => localStorage.setItem('setpoint.theme', 'light'));
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.list .row', {hasText: 'Blue Door at 7?'}).click();
    await page.locator('.rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
    await page.keyboard.press('r');
    const body = page.locator('.composer').getByRole('textbox', {name: 'Message'});
    await until('the caret is in the body', () => body.evaluate(field => field === document.activeElement), focused => focused);
    await page.keyboard.press('ControlOrMeta+j');
    await page.locator('.composer').getByRole('textbox', {name: 'Help me write'}).waitFor();
    assert.equal(await theme(page), 'light');
    // Esc closes the line, then the composer: ⌘J is the theme's again.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await until('the composer closes', () => page.locator('.composer').count(), count => count === 0);
    await page.keyboard.press('ControlOrMeta+j');
    await until('Night', () => theme(page), value => value === 'night');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
