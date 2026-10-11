// The calendar's overlays on a wide screen (2400 × 1300), where styles.css zooms the root by 1.25:
// the floating detail sits 8 px (CSS px) beside its item, inside the grid, on the side the pure
// placement picks; it stays beside each item it glides to; a drag follows the pointer and the next
// glide starts from the drop; and the "+3" popover hangs from its "+3". Boxes are measured on the
// page and turned into the month section's own CSS pixels by its zoom.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {hangFrom} from '../../src/logic/calendar.ts';
import type {Rect} from '../../src/logic/calendar.ts';
import {placeBeside} from '../../src/logic/placement.ts';
import {cleanUp, startSetpoint, until} from './harness.ts';

const WIDE = {width: 2400, height: 1300};
const GAP = 8;

after(cleanUp);

const card = (page: Page) => page.locator('.fd');
const chip = (page: Page, date: string, title: string) => page.locator(`.cell[data-date="${date}"] .ev`, {hasText: title});
const atRest = (page: Page) => until('the card comes to rest', () => card(page).getAttribute('data-motion'), state => state === 'rest');

/** The month section's zoom: its laid-out width over its width on screen. */
const zoomOf = (page: Page) => page.locator('.cal-month').evaluate(element => element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth);

/** A box on the page in the month section's CSS pixels. */
async function inSection(page: Page, box: {x: number; y: number; width: number; height: number}): Promise<Rect> {
  const section = (await page.locator('.cal-month').boundingBox())!;
  const zoom = await zoomOf(page);
  return {left: (box.x - section.x) / zoom, top: (box.y - section.y) / zoom, width: box.width / zoom, height: box.height / zoom};
}
const rectOf = async (page: Page, locator: Locator) => inSection(page, (await locator.boundingBox())!);

const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a} and ${b}`);

/** At rest beside its item: 8 px off it on its side, inside the grid, where placeBeside puts it. */
async function assertBeside(page: Page, item: Locator) {
  const side = await card(page).getAttribute('data-side');
  const box = await rectOf(page, card(page));
  const anchor = await rectOf(page, item);
  const grid = await rectOf(page, page.locator('.cal-scroll'));
  if (side === 'right') near(box.left - (anchor.left + anchor.width), GAP, 'right of it by 8');
  else if (side === 'left') near(anchor.left - (box.left + box.width), GAP, 'left of it by 8');
  else if (side === 'above') near(anchor.top - (box.top + box.height), GAP, 'above it by 8');
  else near(box.top - (anchor.top + anchor.height), GAP, 'below it by 8');
  assert.ok(box.left >= grid.left - 0.5 && box.top >= grid.top - 0.5 && box.left + box.width <= grid.left + grid.width + 0.5 && box.top + box.height <= grid.top + grid.height + 0.5,
    `the card stays inside the grid: ${JSON.stringify({box, grid})}`);
  const element = await item.elementHandle();
  const others: Rect[] = [];
  for (const other of await page.locator('.cal-grid :is(.ev, .tk, .more)').all()) {
    if (await other.evaluate((node, self) => node === self, element)) continue;
    const bounds = await other.boundingBox();
    if (bounds) others.push(await inSection(page, bounds));
  }
  const place = placeBeside(anchor, {width: box.width, height: box.height}, grid, others);
  assert.equal(side, place.side, 'the side placeBeside picks');
  near(box.left, place.left, 'left where placeBeside puts it');
  near(box.top, place.top, 'top where placeBeside puts it');
}

async function open(page: Page, date: string, title: string) {
  await chip(page, date, title).click();
  await page.getByRole('dialog', {name: title}).waitFor();
  await atRest(page);
}

test('at 2400 × 1300 (zoom 1.25) the card sits 8 px beside Gym, Dinner with Sam and Study group, inside the grid', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page(WIDE);
    await page.goto(`${setpoint.base}/calendar`);
    await chip(page, '2026-10-16', 'Gym').waitFor();
    assert.equal(await zoomOf(page), 1.25);
    await open(page, '2026-10-16', 'Gym');
    await assertBeside(page, chip(page, '2026-10-16', 'Gym'));
    // Every frame of the glide to Dinner with Sam stays inside the grid (decision 47's clamp).
    const outside = await page.evaluate(async () => {
      const grid = document.querySelector('.cal-scroll')!.getBoundingClientRect();
      const dinner = [...document.querySelectorAll<HTMLElement>('.cell[data-date="2026-10-09"] .ev')].find(element => element.textContent?.includes('Dinner'))!;
      dinner.click();
      let worst = 0;
      const ends = performance.now() + 600;
      while (performance.now() < ends) {
        await new Promise(requestAnimationFrame);
        const box = document.querySelector('.fd')!.getBoundingClientRect();
        worst = Math.max(worst, grid.left - box.left, grid.top - box.top, box.right - grid.right, box.bottom - grid.bottom);
      }
      return worst;
    });
    assert.ok(outside <= 0.5, `the glide went ${outside} px past the grid's edge`);
    await atRest(page);
    await assertBeside(page, chip(page, '2026-10-09', 'Dinner with Sam'));
    await open(page, '2026-10-09', 'Study group');
    await assertBeside(page, chip(page, '2026-10-09', 'Study group'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('at 2400 × 1300 a drag follows the pointer, and the next glide starts from the drop', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page(WIDE);
    await page.goto(`${setpoint.base}/calendar`);
    await chip(page, '2026-10-07', 'Dentist').waitFor();
    await open(page, '2026-10-07', 'Dentist');
    const grip = (await card(page).locator('.grip').boundingBox())!;
    const before = (await card(page).boundingBox())!;
    const start = {x: grip.x + grip.width / 2, y: grip.y + grip.height / 2};
    const delta = {x: 300, y: 250};
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(start.x + delta.x * step / 10, start.y + delta.y * step / 10);
    await page.mouse.up();
    await atRest(page);
    const after = (await card(page).boundingBox())!;
    near(after.x - before.x, delta.x, 'it moved with the pointer across');
    near(after.y - before.y, delta.y, 'and down');
    const dropped = await rectOf(page, card(page));
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    const from = (await card(page).getAttribute('data-glide-from'))!.split(',').map(Number);
    near(from[0]!, dropped.left, 'the glide starts at the drop (left)');
    near(from[1]!, dropped.top, 'the glide starts at the drop (top)');
    await atRest(page);
    await assertBeside(page, chip(page, '2026-10-09', 'Dinner with Sam'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('at 2400 × 1300 the "+3" popover hangs from its "+3"', async () => {
  const setpoint = await startSetpoint({fixtures: ['busy-saturday']});
  try {
    const page = await setpoint.page(WIDE);
    await page.goto(`${setpoint.base}/calendar/2026-10-17`);
    const more = page.locator('.cell[data-date="2026-10-17"] .more');
    await more.waitFor();
    await more.click();
    const popover = page.getByRole('dialog', {name: 'Sat, Oct 17'});
    await popover.waitFor();
    const box = await rectOf(page, popover);
    const anchor = await rectOf(page, more);
    const section = await rectOf(page, page.locator('.cal-month'));
    const grid = await rectOf(page, page.locator('.cal-scroll'));
    const place = hangFrom(anchor, {width: box.width, height: box.height}, {left: 0, top: grid.top, width: section.width, height: grid.height});
    near(box.left, place.left, 'left where hangFrom puts it');
    near(box.top, place.top, 'top where hangFrom puts it');
    // Saturday is the last column with Sunday first (SV-29): the popover stays inside the grid's right edge.
    assert.ok(box.left + box.width <= section.width, `inside the grid: its right at ${box.left + box.width}`);
    assert.ok(box.left < anchor.left - 2, 'slid left from the "+3" to fit');
    near(box.top, anchor.top + anchor.height + 2, '2 px under it');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
