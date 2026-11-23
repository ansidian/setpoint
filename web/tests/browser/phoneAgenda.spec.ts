// The phone's agenda at 390 × 844 (board 21): today and the next 7 days, an item's read-only
// detail, reminders, forecasts and now.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

test('the agenda: today and the next 7 days, empty days folded, an item\'s detail read-only', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    await page.locator('.ph-agenda .pwx').first().waitFor();
    assert.equal(await page.locator('.hd .ph-range').textContent(), 'Oct 7 – 14');
    assert.deepEqual((await page.locator('.ph-agenda .pday').allTextContents()).map(text => text.trim()), [
      'Today · Wed, Oct 778° / 61°', 'Thu, Oct 872° / 59°', 'Fri, Oct 9', 'Sat, Oct 10 – Sun, Oct 11No events', 'Mon, Oct 12', 'Tue, Oct 1364° / 55°', 'Wed, Oct 14',
    ]);
    // A forecast's high and low sit before its icon, as a month cell's do.
    assert.equal(await page.locator('.ph-agenda .pwx').first().getAttribute('data-tip'), 'Sunny · 78° / 61°');
    // The day heads never wrap.
    for (const head of await page.locator('.ph-agenda .pday').all()) assert.equal((await head.boundingBox())!.height, 30);
    // No month grid, no editor, no New.
    assert.equal(await page.locator('.cal-grid, .editor, .rpane').count(), 0);

    await page.locator('.pitem', {hasText: 'Dentist'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist'}).waitFor();
    assert.equal(await page.locator('.ph-detail .fd-when').textContent(), 'Wed, Oct 7 · 2:30 – 3:30 PM');
    assert.equal(await page.locator('.ph-detail .card-acts').isVisible(), false, 'read-only: no Edit or actions');
    assert.match(new URL(page.url()).pathname, /^\/calendar\/item\/\d+$/);
    await page.locator('.ph-detail button[aria-label="Close"]').tap();
    await until('the detail closes', () => page.locator('.ph-detail').count(), count => count === 0);

    // A task's detail too.
    await page.locator('.pitem', {hasText: 'Pay rent'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Pay rent'}).waitFor();
    await page.locator('.ph-scrim').tap({position: {x: 195, y: 100}});
    await until('a tap outside closes it', () => page.locator('.ph-detail').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a task\'s custom reminder on the phone reads as its moment, the offset beside it, inside the card', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const {items} = await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-08');
    const rent = items.find(item => item.title === 'Pay rent')!;
    await setpoint.api('PATCH', `/items/${rent.id}`, {changes: {reminders: [30, -90]}});
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar/item/${rent.id}`);
    await page.locator('.ph-detail .fd-title', {hasText: 'Pay rent'}).waitFor();
    // Pay rent has no time: its reminders count from Settings' 9:00 AM.
    const lines = page.locator('.ph-detail .fd-reminders > span');
    await until('its reminders', () => lines.allTextContents(), texts => texts.length === 2);
    assert.deepEqual(await lines.allTextContents(), ['30 min before', 'Wed, Oct 7, 10:30 AM1 hr 30 min after']);
    const card = (await rested(() => page.locator('.ph-detail .card').boundingBox()))!;
    for (const line of await lines.all()) {
      const box = (await rested(() => line.boundingBox()))!;
      assert.ok(box.x >= card.x && box.x + box.width <= card.x + card.width, 'the line sits inside the card');
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an empty day with a forecast keeps its own line to show it, "No events" beside its date', async () => {
  const setpoint = await startSetpoint({clock: 'frozen', fixtures: ['weekend-forecast']});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda [data-days="2026-10-11"] .pwx').waitFor();
    assert.deepEqual((await page.locator('.ph-agenda .pday').allTextContents()).map(text => text.trim()).slice(3, 5), [
      'Sat, Oct 10No events74° / 58°', 'Sun, Oct 11No events77° / 60°',
    ]);
    // "No events" follows the date, and the forecast takes the end, on one 30 px line.
    const head = page.locator('.ph-agenda [data-days="2026-10-10"] .pday');
    const [line, none, wx] = await rested(() => Promise.all([head.boundingBox(), head.locator('.none').boundingBox(), head.locator('.pwx').boundingBox()]));
    assert.equal(line!.height, 30);
    assert.ok(none!.x + none!.width < wx!.x - 40, 'a space between "No events" and the forecast');
    assert.ok(Math.abs(line!.x + line!.width - 20 - (wx!.x + wx!.width)) <= 1, 'the forecast at the end');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the agenda puts now in today\'s order, at the seed\'s 9:12 AM between the past Gym and the Dentist', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    const today = page.locator('.ph-agenda [data-days="2026-10-07"]');
    assert.deepEqual(await today.locator(':scope > :not(.pday)').evaluateAll(lines => lines.map(line => (line.classList.contains('ph-now') ? `now ${line.textContent}` : line.querySelector('.ell')!.firstChild!.textContent))),
      ['Gym', 'now 9:12 AM', 'Dentist', 'CS 101 lab report', 'Pay rent']);
    assert.equal(await page.locator('.ph-now').count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
