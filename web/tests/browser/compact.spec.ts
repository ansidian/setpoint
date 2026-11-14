// The compact tier, 640 to 1099 px (DESIGN.md › Layout › Compact; Decided while building #140): an
// iPad or a half-width window. At 640 and 1099: the sidebar a rail (icons named in their
// tooltips, the red unread badge on Inbox), an email or a story covering the list with Back
// (and Esc, J and K, at 640), the header whole, nothing scrolling sideways; Calendar's grid taking
// the width with the editor and search over it and its sources' health atop it; ⌘K keeping the
// rail's lost filters; the day's pane brought over the grid by its header button (D183), and the
// empty pane over Inbox, News and Jobs by theirs (SV-217). At 1100 the panes beside return, the empty
// one with nothing open, and the rail opens to the full sidebar by `` ` `` (D507).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {CalendarOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {layout} from '../../src/tokens.ts';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

const WIDTHS = [640, 1099];
const HEIGHT = 760;

/** Whether every part of the header ends inside it, short of its right padding. */
const headerWhole = (page: Page) => page.locator('.hd').evaluate(header => {
  const end = header.getBoundingClientRect().right - parseFloat(getComputedStyle(header).paddingRight);
  return [...header.children].filter(part => part.getBoundingClientRect().right > end + 0.5).map(part => part.className);
});
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('the rail, and an email or a story over the list, at 640 and 1099 px; at 1100 the panes beside again and the rail opening', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    for (const width of WIDTHS) {
      const page = await setpoint.page({width, height: HEIGHT});
      await page.goto(`${setpoint.base}/inbox`);
      await page.locator('.list .row').first().waitFor();
      // The rail: Inbox, Calendar, News, Jobs and Settings, named in their tooltips; of Today, only the next-up slot (D509).
      assert.deepEqual(await page.locator('.sb .nav').evaluateAll(links => links.map(link => link.getAttribute('data-tip'))), ['Inbox', 'Calendar', 'News', 'Jobs · 3 need you', 'Settings · ⌘,'], `${width}: the rail's items`);
      assert.equal(await page.locator('.sb .today-row:not(.next), .sb .sb-sec:not(.next-up), .sb .sb-name').count(), 0);
      assert.deepEqual(await rested(() => headerWhole(page)), [], `${width}: the Inbox's header`);
      assert.equal(await sideways(page), 0);

      // An email covers the list, under the header: Back leads its tools.
      await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
      await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
      const backButton = page.locator('.rd-tools .rd-back');
      assert.deepEqual([await backButton.isVisible(), await backButton.getAttribute('data-tip')], [true, 'Back · Esc']);
      // J, K, Esc and Back have no width in them. J: the next email, Attention's Contoso University.
      if (width === 640) {
        await page.keyboard.press('j');
        await until('the next email', () => page.locator('.rd-subj').textContent(), text => Boolean(text) && !/Interview availability/.test(text!));
        await page.keyboard.press('k');
        await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
        await page.keyboard.press('Escape');
        await until('Esc closes it', () => page.locator('section.pane:not(.idle)').count(), count => count === 0);
        await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
        await backButton.click();
        await until('Back closes it', () => page.locator('section.pane:not(.idle)').count(), count => count === 0);
        assert.ok(await page.locator('.list .row:has(b[data-tip^="Interview availability"])').isVisible());
      }

      // News: its header whole, a story over the list with Back.
      await page.goto(`${setpoint.base}/news`);
      await page.locator('.nw-list [data-story]').first().waitFor();
      assert.deepEqual(await rested(() => headerWhole(page)), [], `${width}: News's header`);
      await page.locator('.nw-list [data-story]').first().click();
      await page.locator('section.pane .rd-subj').waitFor();
      await page.locator('section.pane .rd-back').click();
      await until('Back closes the story', () => page.locator('section.pane:not(.idle)').count(), count => count === 0);
      assert.equal(await rested(() => sideways(page)), 0);
      // ⌘K fits too.
      await page.keyboard.press('Meta+k');
      const palette = (await rested(() => page.locator('.palette').boundingBox()))!;
      assert.ok(palette.x >= 16 && palette.x + palette.width <= width - 16, `${width}: ⌘K inside the window`);
      await page.keyboard.press('Escape');
      await page.close();
    }

    // At 1100 the pane beside the list is back; the sidebar starts as the rail and `` ` `` opens it (D507).
    const wide = await setpoint.page({width: 1100, height: HEIGHT});
    await wide.goto(`${setpoint.base}/inbox`);
    await wide.locator('.list .row').first().waitFor();
    await wide.locator('.sb.rail').waitFor();
    await wide.keyboard.press('`');
    await wide.locator('.sb .sb-name').waitFor();
    // The empty pane is there with nothing open (SV-217); no button.
    assert.equal(await wide.locator('section.pane.idle').count(), 1);
    assert.equal(await wide.locator('.hd .pane-open').count(), 0);
    await wide.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
    await wide.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    const [list, pane] = [(await rested(() => wide.locator('section.list').boundingBox()))!, (await rested(() => wide.locator('section.pane:not(.idle)').boundingBox()))!];
    assert.equal(pane.x, list.x + list.width, 'beside the list');
    assert.equal(await wide.locator('.rd-tools .rd-back').isVisible(), false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-217: in the compact tier the empty pane comes over the list only from the header\'s button, on Inbox, News and Jobs; it again, Esc or an item opening puts it away', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const width = 1099;
    const page = await setpoint.page({width, height: HEIGHT});
    for (const [path, ready, label] of [['inbox', '.list .row', 'Inbox pane'], ['news', '.nw-list [data-story]', 'News pane'], ['jobs', '.jb-tr[data-application]', 'Jobs pane']] as const) {
      await page.goto(`${setpoint.base}/${path}`);
      await page.locator(ready).first().waitFor();
      const button = page.locator('.hd .pane-open');
      const pane = page.locator('section.pane.idle');
      assert.equal(await pane.count(), 0, `${path}: away on load`);
      await button.click();
      await pane.waitFor();
      assert.deepEqual([await pane.getAttribute('aria-label'), await button.getAttribute('aria-pressed')], [label, 'true']);
      await page.keyboard.press('Escape');
      await until(`${path}: Esc puts it away`, () => pane.count(), count => count === 0);
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      await button.click();
      await pane.waitFor();
      await button.click();
      await until(`${path}: the button again puts it away`, () => pane.count(), count => count === 0);
    }
    // An item opening takes its place.
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.hd .pane-open').click();
    await page.locator('section.pane.idle').waitFor();
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await page.locator('section.pane[aria-label="Reading pane"]').waitFor();
    assert.equal(await page.locator('section.pane.idle').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Calendar in the compact tier: the grid takes the width, the editor and search lie over it, and its sources\' health sits atop it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen', fixtures: ['stale-todoist']});
  try {
    for (const width of [640, 1099]) {
      const page = await setpoint.page({width, height: HEIGHT});
      await page.goto(`${setpoint.base}/calendar`);
      await page.locator('.cal-month .cell').first().waitFor();
      const grid = async () => (await rested(() => page.locator('section.cal-month').boundingBox()))!;
      // The grid takes the width; the day's pane isn't drawn, and its health line sits atop the grid.
      assert.equal((await grid()).width, width - layout.rail, `${width}: the grid`);
      assert.equal(await page.locator('.rpane').count(), 0);
      assert.match((await page.locator('.cal-health .rp-health').textContent())!, /^Todoist, as of /);
      assert.deepEqual(await rested(() => headerWhole(page)), [], `${width}: Calendar's header`);
      // The editor lies over the grid, which keeps its width; where the pane lies and its shadow are by
      // eye (D417).
      await page.keyboard.press('c');
      const editor = page.locator('.rpane.editor');
      await editor.waitFor();
      await until('the grid keeps the width', async () => (await page.locator('section.cal-month').boundingBox())!.width, grid => grid === width - layout.rail);
      await page.keyboard.press('Escape');
      await until('Esc closes the editor', () => editor.count(), count => count === 0);
      // Search too.
      await page.keyboard.press('/');
      await page.locator('.rpane.cal-search').waitFor();
      await until('the grid keeps the width', async () => (await page.locator('section.cal-month').boundingBox())!.width, grid => grid === width - layout.rail);
      await page.keyboard.press('Escape');
      await until('Esc closes the search', () => page.locator('.rpane').count(), count => count === 0);
      await page.keyboard.press('w');
      await page.locator('section.cal-week').waitFor();
      await page.keyboard.press('m');
      await page.locator('section.cal-month').waitFor();
      assert.equal(await rested(() => sideways(page)), 0);
      await page.close();
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘K shows or hides each calendar, as the rows the rail leaves out did', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page({width: 820, height: HEIGHT});
    const run = async (typed: string, label: string) => {
      await page.keyboard.press('Meta+k');
      await page.locator('.palette input').fill(typed);
      await page.locator('.palette .item', {hasText: label}).click();
      await page.locator('.palette').waitFor({state: 'detached'});
    };
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-month .cell').first().waitFor();
    const classes = async () => (await setpoint.api<CalendarOut[]>('GET', '/calendars')).find(calendar => calendar.name === 'Classes')!;
    await run('hide classes', 'Hide Classes');
    await until('Classes hidden', classes, calendar => !calendar.visible);
    await run('show classes', 'Show Classes');
    await until('Classes shown again', classes, calendar => calendar.visible);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the day\'s pane comes over the grid from its header button, lit while open: another day picked shows there, Esc closes it, the editor takes its place; closed on every load; none on the desktop (D183)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page({width: 820, height: HEIGHT});
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-month .cell').first().waitFor();
    const button = page.getByRole('button', {name: 'The day'});
    assert.deepEqual([await button.getAttribute('aria-pressed'), await page.locator('.rpane').count()], ['false', 0], 'closed on load');
    await button.click();
    const pane = page.locator('.rpane');
    await pane.locator('.rp-date', {hasText: 'Wed, Oct 7'}).waitFor();
    assert.equal(await pane.locator('.ag-item', {hasText: 'Dentist'}).count(), 1);
    await until('no health line in the pane, as it sits atop the grid', () => pane.locator('.rp-health').evaluateAll(lines => lines.filter(line => getComputedStyle(line).display !== 'none').length), shown => shown === 0);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    // Another day picked shows there.
    await page.locator('.cell[data-date="2026-10-05"]').click({position: {x: 40, y: 150}});
    await pane.locator('.rp-date', {hasText: 'Mon, Oct 5'}).waitFor();
    // Esc closes it.
    await page.keyboard.press('Escape');
    await until('Esc closes it', () => page.locator('.rpane').count(), count => count === 0);
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    // The editor takes its place, and with the editor gone it stays closed.
    await button.click();
    await pane.waitFor();
    await page.keyboard.press('c');
    await page.locator('.rpane.editor').waitFor();
    assert.equal(await page.locator('.rpane').count(), 1);
    await page.keyboard.press('Escape');
    await until('closed with the editor', () => page.locator('.rpane').count(), count => count === 0);
    // The button again closes it, and a reload starts closed.
    await button.click();
    await pane.waitFor();
    await button.click();
    await until('the button closes it', () => page.locator('.rpane').count(), count => count === 0);
    await button.click();
    await pane.waitFor();
    await page.reload();
    await page.locator('.cal-month .cell').first().waitFor();
    assert.equal(await page.locator('.rpane').count(), 0, 'closed on every load');
    // The desktop has its pane beside the grid and no button.
    const desktop = await setpoint.page('target');
    await desktop.goto(`${setpoint.base}/calendar`);
    await desktop.locator('.rpane .rp-date').waitFor();
    assert.equal(await desktop.getByRole('button', {name: 'The day'}).count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-273: in the compact tier a subtask opened from the card makes the card glide clear of the editor; Esc closes the editor first, the card going back, then the card', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page({width: 1000, height: HEIGHT});
    await page.goto(`${setpoint.base}/calendar/2026-10-07`);
    const task = page.locator('.cell[data-date="2026-10-07"] .tk', {hasText: 'CS 101 lab report'});
    await task.click();
    const card = page.locator('.fd .card.float');
    await card.getByRole('button', {name: 'Edit Proofread'}).waitFor();
    const before = (await rested(() => card.boundingBox()))!;
    await card.getByRole('button', {name: 'Edit Proofread'}).click();
    const editor = page.locator('.rpane.editor');
    await editor.waitFor();
    // Not covered: the card ends left of the editor.
    const [beside, pane] = await rested(async () => [(await card.boundingBox())!, (await editor.boundingBox())!]);
    assert.ok(beside.x + beside.width <= pane.x, `the card ends at ${beside.x + beside.width}, the editor starts at ${pane.x}`);
    await page.keyboard.press('Escape');
    await editor.waitFor({state: 'detached'});
    const back = (await rested(() => card.boundingBox()))!;
    assert.deepEqual([back.x, back.y], [before.x, before.y], 'back where it was');
    await page.keyboard.press('Escape');
    await card.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

