// The compact tier, 640 to 1099 px (DESIGN.md › Layout › Compact; Decided while building #140): an
// iPad or a half-width window. At 640 and 1099: the sidebar a 56 px rail (icons named in their
// tooltips, the red unread badge on Inbox), an email or a story covering the list with Back
// (and Esc, J and K, at 640), the header whole, nothing scrolling sideways; Calendar's grid taking
// the width with the editor and search over it and its sources' health atop it; ⌘K keeping the
// rail's lost filters; the day's pane brought over the grid by its header button (D183), and the
// empty pane over Inbox, News and Jobs by theirs (SV-217). At 1100 the full sidebar and the panes
// beside return, the empty one with nothing open.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {CalendarOut, MailCountsOut} from '@setpoint/shared';
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

test('the rail, and an email or a story over the list, at 640 and 1099 px; the full sidebar again at 1100', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    for (const width of WIDTHS) {
      const page = await setpoint.page({width, height: HEIGHT});
      await page.goto(`${setpoint.base}/inbox`);
      await page.locator('.list .row').first().waitFor();
      // The rail: the mark, then Inbox, Calendar, News, Jobs (after News, while it's on; its rail is
      // jobs.spec.ts's) and Settings, 40 × 40 icons named in their tooltips; no Today.
      const rail = (await page.locator('aside.sb').boundingBox())!;
      assert.deepEqual([rail.x, rail.width], [0, layout.rail], `${width}: the rail`);
      const items = await rested(() => page.locator('.sb .nav').evaluateAll(links => links.map(link => {
        const box = link.getBoundingClientRect();
        return [link.getAttribute('data-tip'), box.width, box.height, (link.querySelector('.grow') as HTMLElement).offsetWidth];
      })));
      assert.deepEqual(items, [['Inbox', 40, 40, 0], ['Calendar', 40, 40, 0], ['News', 40, 40, 0], ['Jobs · 3 need you', 40, 40, 0], ['Settings · ⌘,', 40, 40, 0]], `${width}: the rail's items`);
      assert.equal(await page.locator('.sb .today-row, .sb .sb-sec, .sb .sb-name').count(), 0);
      // The red unread badge on Inbox's icon (SV-221), the seed's 19 less what an earlier width opened.
      assert.equal(await page.locator('.sb .nav .ubadge').textContent(), String((await setpoint.api<MailCountsOut>('GET', '/mail/counts')).unread));
      assert.deepEqual(await rested(() => headerWhole(page)), [], `${width}: the Inbox's header`);
      assert.equal(await sideways(page), 0);

      // An email covers the list, under the header: Back leads its tools.
      await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
      await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
      assert.deepEqual(await rested(() => page.locator('section.pane:not(.idle)').boundingBox()), {x: layout.rail, y: layout.header, width: width - layout.rail, height: HEIGHT - layout.header}, `${width}: the reader`);
      assert.equal(await page.locator('.pane-edge').isVisible(), false, 'nothing to drag');
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
      assert.deepEqual(await rested(() => page.locator('section.pane:not(.idle)').boundingBox()), {x: layout.rail, y: layout.header, width: width - layout.rail, height: HEIGHT - layout.header}, `${width}: the story`);
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

    // At 1100 the sidebar and the pane beside the list are back.
    const wide = await setpoint.page({width: 1100, height: HEIGHT});
    await wide.goto(`${setpoint.base}/inbox`);
    await wide.locator('.list .row').first().waitFor();
    assert.equal((await rested(() => wide.locator('aside.sb').boundingBox()))!.width, layout.sidebar);
    assert.ok(await wide.locator('.sb .sb-name').isVisible());
    // The empty pane is there with nothing open, giving way so the list keeps 420 (SV-217); no button.
    assert.equal((await rested(() => wide.locator('section.list').boundingBox()))!.width, 420);
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
      // Before search, which ends the header.
      assert.equal(await button.evaluate(element => element.nextElementSibling!.classList.contains('search')), true, `${path}: before search`);
      await button.click();
      await pane.waitFor();
      assert.deepEqual([await pane.getAttribute('aria-label'), await button.getAttribute('aria-pressed')], [label, 'true']);
      assert.deepEqual(await rested(() => pane.boundingBox()), {x: layout.rail, y: layout.header, width: width - layout.rail, height: HEIGHT - layout.header}, `${path}: over the list`);
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
      const health = (await rested(() => page.locator('.cal-health .rp-health').boundingBox()))!;
      assert.match((await page.locator('.cal-health .rp-health').textContent())!, /^Todoist, as of /);
      assert.equal(health.y + health.height, (await grid()).y, 'the health line sits atop the grid');
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
    // Before search.
    assert.equal(await page.locator('.hd .cal-daypane + .ibtn[aria-label="Search calendar"]').count(), 1);
    const sub2 = await rested(() => page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--sub2)';
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }));
    await button.click();
    const pane = page.locator('.rpane');
    await pane.locator('.rp-date', {hasText: 'Wed, Oct 7'}).waitFor();
    assert.equal(await pane.locator('.ag-item', {hasText: 'Dentist'}).count(), 1);
    await until('no health line in the pane, as it sits atop the grid', () => pane.locator('.rp-health').evaluateAll(lines => lines.filter(line => getComputedStyle(line).display !== 'none').length), shown => shown === 0);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    await until('lit while open', () => button.evaluate(element => getComputedStyle(element).backgroundColor), fill => fill === sub2);
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
