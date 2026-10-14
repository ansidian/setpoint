// The compact tier, 640 to 1099 px (DESIGN.md › Layout › Compact; Decided while building #140): an
// iPad or a half-width window. At 640, 820, 900 and 1099: the sidebar a 56 px rail (icons named in
// their tooltips, the attention pill a badge on Inbox), an email or a story covering the list with
// Back, Esc, J and K, the header whole, nothing scrolling sideways; Calendar's grid taking the width
// with the editor and search over it and its sources' health atop it; ⌘K keeping the rail's lost
// filters; the day's pane brought over the grid by its header button (D183); and the tier's approved
// screenshots. At 1100 the full sidebar and the panes beside return.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {AccountOut, CalendarOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {layout} from '../../src/tokens.ts';
import {cleanUp, matchGolden, startSetpoint, still, until} from './harness.ts';

after(cleanUp);

const WIDTHS = [640, 820, 900, 1099];
const HEIGHT = 760;

/** Whether every part of the header ends inside it, short of its right padding. */
const headerWhole = (page: Page) => page.locator('.hd').evaluate(header => {
  const end = header.getBoundingClientRect().right - parseFloat(getComputedStyle(header).paddingRight);
  return [...header.children].filter(part => part.getBoundingClientRect().right > end + 0.5).map(part => part.className);
});
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('the rail, and an email or a story over the list, at 640, 820, 900 and 1099 px; the full sidebar again at 1100', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    for (const width of WIDTHS) {
      const page = await setpoint.page({width, height: HEIGHT});
      await page.goto(`${setpoint.base}/inbox`);
      await page.locator('.list .row').first().waitFor();
      // The rail: the mark, then Inbox, Calendar, News and Settings, 40 × 40 icons named in their
      // tooltips; no accounts and no Today.
      const rail = (await page.locator('aside.sb').boundingBox())!;
      assert.deepEqual([rail.x, rail.width], [0, layout.rail], `${width}: the rail`);
      const items = await page.locator('.sb .nav').evaluateAll(links => links.map(link => {
        const box = link.getBoundingClientRect();
        return [link.getAttribute('title'), box.width, box.height, (link.querySelector('.grow') as HTMLElement).offsetWidth];
      }));
      assert.deepEqual(items, [['Inbox', 40, 40, 0], ['Calendar', 40, 40, 0], ['News', 40, 40, 0], ['Settings · ⌘,', 40, 40, 0]], `${width}: the rail's items`);
      assert.equal(await page.locator('.sb .acct, .sb .today-row, .sb .sb-sec, .sb .sb-name').count(), 0);
      // The attention pill as a 16 px badge on Inbox's icon: 2 px from its top, 2 px past its right,
      // 10.5 / 600, in a 2 px `panel` ring.
      const [inbox, badge] = [(await page.locator('.sb .nav').first().boundingBox())!, (await page.locator('.sb .nav .apill').boundingBox())!];
      assert.deepEqual([await page.locator('.sb .nav .apill').textContent(), badge.height, badge.y - inbox.y, badge.x + badge.width - (inbox.x + inbox.width)], ['3', 16, 2, 2]);
      assert.deepEqual(await page.locator('.sb .nav .apill').evaluate(pill => [getComputedStyle(pill).fontSize, getComputedStyle(pill).fontWeight, getComputedStyle(pill).boxShadow.endsWith('0px 0px 0px 2px')]), ['10.5px', '600', true]);
      assert.deepEqual(await headerWhole(page), [], `${width}: the Inbox's header`);
      assert.equal(await sideways(page), 0);

      // An email covers the list, under the header: Back leads its tools, and J, K and Esc work.
      await page.locator('.list .row[title^="Interview availability"]').click();
      await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
      assert.deepEqual(await page.locator('section.pane').boundingBox(), {x: layout.rail, y: layout.header, width: width - layout.rail, height: HEIGHT - layout.header}, `${width}: the reader`);
      assert.equal(await page.locator('.pane-edge').isVisible(), false, 'nothing to drag');
      const backButton = page.locator('.rd-tools .rd-back');
      assert.deepEqual([await backButton.isVisible(), await backButton.getAttribute('title')], [true, 'Back · Esc']);
      // J: the next email (New's code at first; once Northwind is read, a later width's visit has it in Attention, and the shelf's lease follows).
      await page.keyboard.press('j');
      await until('the next email', () => page.locator('.rd-subj').textContent(), text => Boolean(text) && !/Interview availability/.test(text!));
      await page.keyboard.press('k');
      await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
      await page.keyboard.press('Escape');
      await until('Esc closes it', () => page.locator('section.pane').count(), count => count === 0);
      await page.locator('.list .row[title^="Interview availability"]').click();
      await backButton.click();
      await until('Back closes it', () => page.locator('section.pane').count(), count => count === 0);
      assert.ok(await page.locator('.list .row[title^="Interview availability"]').isVisible());

      // News: its header whole, a story over the list with Back.
      await page.goto(`${setpoint.base}/news`);
      await page.locator('.nw-list [data-story]').first().waitFor();
      assert.deepEqual(await headerWhole(page), [], `${width}: News's header`);
      await page.locator('.nw-list [data-story]').first().click();
      await page.locator('section.pane .rd-subj').waitFor();
      assert.deepEqual(await page.locator('section.pane').boundingBox(), {x: layout.rail, y: layout.header, width: width - layout.rail, height: HEIGHT - layout.header}, `${width}: the story`);
      await page.locator('section.pane .rd-back').click();
      await until('Back closes the story', () => page.locator('section.pane').count(), count => count === 0);
      assert.equal(await sideways(page), 0);
      // ⌘K fits too.
      await page.keyboard.press('Meta+k');
      const palette = (await page.locator('.palette').boundingBox())!;
      assert.ok(palette.x >= 16 && palette.x + palette.width <= width - 16, `${width}: ⌘K inside the window`);
      await page.keyboard.press('Escape');
      await page.close();
    }

    // At 1100 the sidebar and the pane beside the list are back.
    const wide = await setpoint.page({width: 1100, height: HEIGHT});
    await wide.goto(`${setpoint.base}/inbox`);
    await wide.locator('.list .row').first().waitFor();
    assert.equal((await wide.locator('aside.sb').boundingBox())!.width, layout.sidebar);
    assert.ok(await wide.locator('.sb .acct').first().isVisible());
    await wide.locator('.list .row[title^="Interview availability"]').click();
    await wide.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    const [list, pane] = [(await wide.locator('section.list').boundingBox())!, (await wide.locator('section.pane').boundingBox())!];
    assert.equal(pane.x, list.x + list.width, 'beside the list');
    assert.equal(await wide.locator('.rd-tools .rd-back').isVisible(), false);
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
      const grid = async () => (await page.locator('section.cal-month').boundingBox())!;
      // The grid takes the width; the day's pane isn't drawn, and its health line sits atop the grid.
      assert.equal((await grid()).width, width - layout.rail, `${width}: the grid`);
      assert.equal(await page.locator('.rpane').count(), 0);
      const health = (await page.locator('.cal-health .rp-health').boundingBox())!;
      assert.match((await page.locator('.cal-health .rp-health').textContent())!, /^Todoist, as of /);
      assert.equal(health.y + health.height, (await grid()).y, 'the health line sits atop the grid');
      assert.deepEqual(await headerWhole(page), [], `${width}: Calendar's header`);
      // The editor lies over the grid's right side, 400 px, with an overlay's shadow; the grid stays.
      await page.keyboard.press('c');
      const editor = page.locator('.rpane.editor');
      await editor.waitFor();
      // It comes in 24 px from the right over 180 ms; measured where it lands.
      const landed = (pane: typeof editor) => until('the pane has come in', () => pane.evaluate(element => element.getAnimations().length), running => running === 0);
      await landed(editor);
      const box = (await editor.boundingBox())!;
      assert.deepEqual([box.x, box.width, box.y], [width - layout.rightPane, layout.rightPane, layout.header]);
      assert.equal((await grid()).width, width - layout.rail);
      assert.notEqual(await editor.evaluate(form => getComputedStyle(form).boxShadow), 'none');
      assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('.editor') !== null, [box.x + 200, box.y + 300]), true, 'over the grid');
      await page.keyboard.press('Escape');
      await until('Esc closes the editor', () => editor.count(), count => count === 0);
      // Search too.
      await page.keyboard.press('/');
      await page.locator('.rpane.cal-search').waitFor();
      await landed(page.locator('.rpane.cal-search'));
      assert.equal((await page.locator('.rpane.cal-search').boundingBox())!.x, width - layout.rightPane);
      await page.keyboard.press('Escape');
      await until('Esc closes the search', () => page.locator('.rpane').count(), count => count === 0);
      // The week's grid takes the width too.
      await page.keyboard.press('w');
      await page.locator('section.cal-week').waitFor();
      // Measured once Week has zoomed in from Month (polish audit grids-09).
      await still(page);
      assert.equal((await page.locator('section.cal-week').boundingBox())!.width, width - layout.rail);
      await page.keyboard.press('m');
      await page.locator('section.cal-month').waitFor();
      assert.equal(await sideways(page), 0);
      await page.close();
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘K filters the Inbox by account and shows or hides each calendar, as the rows the rail leaves out did', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const accounts = await setpoint.api<AccountOut[]>('GET', '/accounts');
    const jobs = accounts.find(account => account.label === 'Jobs')!;
    const page = await setpoint.page({width: 820, height: HEIGHT});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    const run = async (typed: string, label: string) => {
      await page.keyboard.press('Meta+k');
      await page.locator('.palette input').fill(typed);
      await page.locator('.palette .item', {hasText: label}).click();
      await page.locator('.palette').waitFor({state: 'detached'});
    };
    await run('inbox jobs', 'Inbox · Jobs');
    await until('the Inbox filtered to Jobs', () => page.evaluate(() => window.location.search), search => search === `?account=${jobs.id}`);
    assert.equal(await page.locator('.hd-title').textContent(), 'Inbox · Jobs');

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
    await button.click();
    const pane = page.locator('.rpane');
    await pane.locator('.rp-date', {hasText: 'Wed, Oct 7'}).waitFor();
    await until('it has come in', () => pane.evaluate(element => element.getAnimations().length), running => running === 0);
    const box = (await pane.boundingBox())!;
    assert.deepEqual([box.x, box.width, box.y], [820 - layout.rightPane, layout.rightPane, layout.header], 'where the editor lies');
    assert.deepEqual([await pane.locator('.ag-item', {hasText: 'Dentist'}).count(), await pane.locator('.rp-health').evaluateAll(lines => lines.filter(line => getComputedStyle(line).display !== 'none').length)], [1, 0]);
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    const sub2 = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--sub2)';
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    });
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

test('the compact tier\'s screenshots: the Inbox at 640 and an email over it at 820 in Night, Calendar\'s editor over the grid at 820 in Light, and the day\'s pane over it at 820 in Night', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const narrow = await setpoint.page({width: 640, height: HEIGHT});
    await narrow.goto(`${setpoint.base}/inbox`);
    await narrow.locator('.list .row').first().waitFor();
    await narrow.mouse.move(320, 28);
    await matchGolden(narrow, 'compact-640-inbox');

    const page = await setpoint.page({width: 820, height: HEIGHT});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row[title^="Interview availability"]').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await page.mouse.move(600, 28);
    await matchGolden(page, 'compact-820-reader');

    const light = await setpoint.page({width: 820, height: HEIGHT});
    await light.emulateMedia({colorScheme: 'light'});
    await light.goto(`${setpoint.base}/calendar`);
    await light.locator('.cal-month .cell').first().waitFor();
    await light.keyboard.press('c');
    await light.locator('.rpane.editor .nl-input').waitFor();
    // The draft takes Settings' reminder once Settings has answered.
    await light.getByRole('button', {name: 'Remove reminder'}).waitFor();
    await light.mouse.move(300, 28);
    await matchGolden(light, 'compact-820-calendar-editor');

    // The day's pane over the grid at 820 in Night (D183).
    const day = await setpoint.page({width: 820, height: HEIGHT});
    await day.goto(`${setpoint.base}/calendar`);
    await day.locator('.cal-month .cell').first().waitFor();
    await day.getByRole('button', {name: 'The day'}).click();
    await day.locator('.rpane .rp-date').waitFor();
    await day.mouse.move(300, 28);
    await matchGolden(day, 'compact-820-calendar-day');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
