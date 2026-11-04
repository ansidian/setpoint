// The Calendar in the browser: boards 11 and 11b built and checked (11b's busy Saturday is the
// busy-saturday fixture, decision D3; board 11 also takes one of the release's page screenshots,
// pages.ts), then the flows: the grid's sizes, paging through months, a calendar
// toggled off and on, the "+3" popover opening and closing with Esc, selecting a day and an item,
// the mini-month, and the Today block's links landing on the right day.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {CalendarOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, matchGolden, rested, SIZES, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Over the header's empty middle, so no hover fill shows.
  await page.mouse.move(1000, 28);
  // Lets a hover fill the move left fade out (120 ms) before the screenshot.
  await page.waitForTimeout(250);
}

const text = (page: Page, selector: string) => page.locator(selector).first().textContent();
const chips = (page: Page, date: string) => page.locator(`.cell[data-date="${date}"] :is(.ev, .tk)`).allTextContents();

test('board 11: October 2026, Wed Oct 7 selected, with Time to Leave on Dentist', async () => {
  // Time to Leave comes from live routes; the time-to-leave fixture (D3) holds the board's estimate.
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev', {hasText: 'Dentist'}).waitFor();
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    assert.equal(await page.locator('.ag-item', {hasText: 'Dentist'}).locator('.leave').textContent(), 'Leave by 2:05 PM · 18 min');
    assert.equal(await page.locator('.ag-item .leave').count(), 1, 'only Dentist has one today');
    // #125: the line names the calendar; the place has its own line.
    const dentist = page.locator('.ag-item', {hasText: 'Dentist'});
    assert.equal(await dentist.locator('.line').textContent(), '2:30 – 3:30 PM · Personal');
    assert.equal(await dentist.locator('.place').textContent(), 'Smile Dental');
    await settle(page);
    assert.equal(await page.title(), 'October 2026 · Calendar');
    await matchGolden(page, '11-calendar-october-2026');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 11b: a busy Saturday folds into "+3", and its popover closes with Esc', async () => {
  const setpoint = await startSetpoint({fixtures: ['busy-saturday']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-17`);
    const more = page.locator('.cell[data-date="2026-10-17"] .more');
    await more.waitFor();
    assert.equal(await more.textContent(), '+3');
    assert.equal((await chips(page, '2026-10-17')).length, 5, 'five rows fit under the date');
    await more.click();
    const popover = page.getByRole('dialog', {name: 'Sat, Oct 17'});
    await popover.waitFor();
    assert.deepEqual(await popover.locator(':is(.ev, .tk)').allTextContents(),
      ['9 AMFarmers market', '11 AMHaircut', '12:30 PMLunch with Jo', '2 PMVolunteer shift', '5 PMCall Mom', '8 PMMovie night', 'Grocery run', 'Laundry']);
    assert.equal(await text(page, '.rp-date'), 'Sat, Oct 17');
    await page.locator('.ag-item', {hasText: 'Movie night'}).waitFor();

    await page.keyboard.press('Escape');
    await until('the popover closes', () => popover.count(), count => count === 0);
    assert.equal(await more.getAttribute('aria-expanded'), 'false');
    // A click elsewhere closes it too, and an item in it can be selected.
    await more.click();
    await popover.waitFor();
    await page.locator('.hd-title').click();
    await until('a click elsewhere closes it', () => popover.count(), count => count === 0);
    await more.click();
    await popover.locator('.ev', {hasText: 'Movie night'}).click();
    await until('the popover gives way to the selection', () => popover.count(), count => count === 0);
    assert.match(new URL(page.url()).pathname, /^\/calendar\/item\/\d+$/);
    assert.equal(await text(page, '.ag-item.sel .title'), 'Movie night');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test(`the grid at ${SIZES.target.width} × ${SIZES.target.height}: rows 176, seven columns beside a 400 px pane, no page scroll`, async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const box = async (selector: string) => (await rested(() => page.locator(selector).first().boundingBox()))!;
    const cell = await box('.cell[data-date="2026-10-07"]');
    // 147 at the design target (1677 − 248 − 400 over seven days).
    assert.ok(Math.abs(cell.width - (SIZES.target.width - 248 - 400) / 7) < 1, `a column is ${cell.width} px`);
    assert.equal(cell.height, 176);
    const scroll = await page.evaluate(() => [document.documentElement.scrollHeight - document.documentElement.clientHeight, document.documentElement.scrollWidth - document.documentElement.clientWidth]);
    assert.deepEqual(scroll, [0, 0]);
    // Past items turn grey at full strength (#161), future ones keep their colour; the selected day is `sub`; today is the disc.
    const look = (title: string) => page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: title}).evaluate(element => [getComputedStyle(element).opacity, getComputedStyle(element).color]);
    assert.deepEqual(await rested(() => look('Gym')), ['1', await rested(() => tokenColour(page, 'ink3'))], 'past: ink3');
    const [opacity, colour] = await rested(() => look('Dentist'));
    assert.equal(opacity, '1');
    assert.notEqual(colour, await rested(() => tokenColour(page, 'ink3')), 'ahead: its calendar\'s colour');
    assert.equal(await page.locator('.cell.sel').getAttribute('data-date'), '2026-10-07');
    assert.equal(await text(page, '.dn.today'), '7');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Which month a scroll shows, and which rows it draws, are monthAtScroll's and rowsInView's, tables in
// calendar.test.ts; the wheel's scrolls went with them (D416).
test('← → P N and ‹ › page through months, the header, tab title and mini-month reading each; T comes back to today', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    await page.keyboard.press('n');
    await until('N pages to November', () => text(page, '.hd-title'), title => title === 'November 2026');
    await until('the tab title too', () => page.title(), title => title === 'November 2026 · Calendar');
    await until('November\'s days are in the month', () => page.locator('.cell[data-date="2026-11-12"]').getAttribute('class'), cls => !!cls && !cls.includes('out'));
    assert.match((await page.locator('.cell[data-date="2026-10-31"]').getAttribute('class'))!, /\bout\b/);
    assert.equal(await text(page, '.mini-head .name'), 'November 2026');
    // November's items load as it comes into view (Gym on Mon Nov 9).
    await until('November\'s items', () => chips(page, '2026-11-09'), list => list.includes('7 AMGym'));

    await page.keyboard.press('n');
    await until('N pages to December', () => text(page, '.hd-title'), title => title === 'December 2026');
    await page.keyboard.press('ArrowRight');
    await until('→ pages to January', () => text(page, '.hd-title'), title => title === 'January 2027');
    await page.keyboard.press('p');
    await page.keyboard.press('ArrowLeft');
    await until('P and ← page back to November', () => text(page, '.hd-title'), title => title === 'November 2026');
    await page.locator('.hd').getByRole('button', {name: 'Previous month'}).click();
    await until('‹ pages to October', () => text(page, '.hd-title'), title => title === 'October 2026');
    await page.locator('.hd').getByRole('button', {name: 'Next month'}).click();
    await page.locator('.hd').getByRole('button', {name: 'Next month'}).click();
    await until('› › to December', () => text(page, '.hd-title'), title => title === 'December 2026');
    await page.keyboard.press('t');
    await until('T: back to October', () => text(page, '.hd-title'), title => title === 'October 2026');
    assert.equal(await page.locator('.cell[data-date="2026-10-07"] .dn.today').count(), 1);
    assert.equal(await text(page, '.mini-head .name'), 'October 2026');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a calendar toggled off leaves the grid and the agenda, its name going `ink3`, and comes back on; Todoist has no ring', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    // Its own row (Dinner with Sam's says it overlaps Study group, F6).
    await page.locator('.ag-item', {hasText: 'Study group'}).first().waitFor();
    assert.equal(await page.locator('.calrow .ring').count(), 0, 'Todoist reads as the others');
    const personal = page.locator('.calrow', {hasText: 'Personal'});
    assert.equal(await personal.getAttribute('aria-pressed'), 'true');
    await personal.click();
    await until('Personal leaves the grid', () => chips(page, '2026-10-09'), list => list.join() === '6:30 PMStudy group');
    assert.equal(await page.locator('.ag-item', {hasText: 'Dinner with Sam'}).count(), 0, 'and the agenda');
    assert.equal(await personal.locator('.chk.off').count(), 1);
    const ink3 = await rested(() => tokenColour(page, 'ink3'));
    await until('the name recedes', () => personal.evaluate(row => getComputedStyle(row).color), value => value === ink3);
    await until('the toggle is kept', () => setpoint.api<CalendarOut[]>('GET', '/calendars'), list => list.find(calendar => calendar.name === 'Personal')?.visible === false);
    // Todoist's toggle takes the tasks.
    await page.locator('.calrow', {hasText: 'Todoist'}).click();
    await until('tasks leave Wed Oct 7', () => chips(page, '2026-10-07'), list => list.length === 0);
    // A reload before the server has it would drop it.
    await until('Todoist\'s toggle is kept', () => setpoint.api<CalendarOut[]>('GET', '/calendars'), list => list.find(calendar => calendar.name === 'Todoist')?.visible === false);
    await page.reload();
    await page.locator('.ag-item', {hasText: 'Study group'}).waitFor();
    assert.deepEqual(await chips(page, '2026-10-09'), ['6:30 PMStudy group'], 'still off after a reload');
    await page.locator('.calrow', {hasText: 'Personal'}).click();
    await page.locator('.calrow', {hasText: 'Todoist'}).click();
    await until('back on', () => chips(page, '2026-10-09'), list => list.join() === '7 AMGym,6:30 PMStudy group,7 PMDinner with Sam');
    await until('Todoist\'s tasks back on Wed Oct 7', () => chips(page, '2026-10-07'), list => list.join() === '7 AMGym,2:30 PMDentist,CS 101 lab report,Pay rent');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a calendar toggled off and straight back on stays on, on screen and at the server, however late the off arrives', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    await page.locator('.ag-item', {hasText: 'Study group'}).first().waitFor();
    // Personal's off is held on its way to the server, as a request on a slow connection can be.
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    let holding = false;
    await page.route('**/api/calendars/1', async route => {
      if ((route.request().postDataJSON() as {visible?: boolean}).visible === false) {
        holding = true;
        await held;
      }
      await route.continue();
    });
    const personal = page.locator('.calrow', {hasText: 'Personal'});
    await personal.click();
    await until('the off on its way', async () => holding, on => on);
    await personal.click();
    await until('back on screen', () => chips(page, '2026-10-09'), list => list.join() === '7 AMGym,6:30 PMStudy group,7 PMDinner with Sam');
    release();
    await setpoint.idle();
    await until('on at the server', () => setpoint.api<CalendarOut[]>('GET', '/calendars'), list => list.find(calendar => calendar.name === 'Personal')?.visible === true);
    await setpoint.idle();
    assert.equal(await personal.getAttribute('aria-pressed'), 'true', 'and on screen');
    assert.deepEqual(await chips(page, '2026-10-09'), ['7 AMGym', '6:30 PMStudy group', '7 PMDinner with Sam']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A token's colour as the page computes it, to compare with an element's. */
const tokenColour = (page: Page, token: string) => page.evaluate(name => {
  const probe = document.createElement('span');
  probe.style.color = `var(--${name})`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

test('SV-56: a day outside the month takes the outside tint, a weekend among them too; a weekend in the month takes the weekend one', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const cell = (date: string) => page.locator(`.cell[data-date="${date}"]`);
    const fill = (date: string) => cell(date).evaluate(element => getComputedStyle(element).backgroundColor);
    // Sun Sep 27 and Sat Nov 7 are both outside October and weekends.
    assert.match((await cell('2026-09-27').getAttribute('class'))!, /\bout\b.*\bweekend\b/);
    assert.match((await cell('2026-11-07').getAttribute('class'))!, /\bout\b.*\bweekend\b/);
    assert.equal(await rested(() => fill('2026-09-27')), await rested(() => fill('2026-09-28')), 'Sun Sep 27 as Mon Sep 28');
    assert.equal(await rested(() => fill('2026-11-07')), await rested(() => fill('2026-11-02')), 'Sat Nov 7 as Mon Nov 2');
    assert.notEqual(await rested(() => fill('2026-10-04')), await rested(() => fill('2026-09-27')), 'Sun Oct 4 takes the weekend tint');
    // Selected, Sun Sep 27 is `sub` like any selected day.
    await cell('2026-09-27').click({position: {x: 100, y: 150}});
    await until('Sun Sep 27 selected', () => cell('2026-09-27').getAttribute('class'), cls => !!cls?.split(' ').includes('sel'));
    // A cell eases its fill over 180 ms (#160); it's read once it has.
    const sub = await tokenColour(page, 'sub');
    await until('Sun Sep 27 is sub', () => fill('2026-09-27'), value => value === sub);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-56: Leave by turns caution 15 minutes before leaving, in the pane and the card, and goes once the event starts', async () => {
  // Dentist at 2:30 PM, leave by 2:05 PM (the time-to-leave fixture). The server's clock holds at
  // 9:12 AM and the page's is the check's, moved on to 2:10 PM and then 2:45 PM.
  const setpoint = await startSetpoint({fixtures: ['time-to-leave'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/calendar`);
    const row = page.locator('.ag-item', {hasText: 'Dentist'});
    const leave = row.locator('.leave');
    await leave.waitFor();
    await page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'}).click();
    const fact = page.locator('.fd .fact.leave');
    await fact.waitFor();
    const colours = async () => [
      await rested(() => leave.evaluate(element => getComputedStyle(element).color)),
      await rested(() => leave.locator('.icon').evaluate(element => getComputedStyle(element).color)),
      await rested(() => fact.locator('.icon').evaluate(element => getComputedStyle(element).color)),
      await rested(() => fact.locator('.v').evaluate(element => getComputedStyle(element).color)),
    ];
    // 9:12 AM: the line is ink2, the card's fact its usual ink3 glyph and ink time.
    const [ink, ink2, ink3, caution] = [await tokenColour(page, 'ink'), await tokenColour(page, 'ink2'), await tokenColour(page, 'ink3'), await tokenColour(page, 'caution')];
    assert.deepEqual(await colours(), [ink2, ink2, ink3, ink]);
    assert.equal(await leave.textContent(), 'Leave by 2:05 PM · 18 min');

    // 2:10 PM: five minutes past leaving, twenty before Dentist: the line and its glyph turn caution, and the card's fact with them.
    await page.clock.fastForward((4 * 60 + 58) * 60_000);
    await until('the now-line at 2:10 PM', () => page.locator('.nowline .t').textContent(), time => time === '2:10 PM');
    await until('Leave by in caution', colours, list => list.every(colour => colour === caution));
    assert.equal(await leave.textContent(), 'Leave by 2:05 PM · 18 min', 'the same words');

    // 2:45 PM: Dentist is under way, and Leave by is gone from both.
    await page.clock.fastForward(35 * 60_000);
    await until('the now-line at 2:45 PM', () => page.locator('.nowline .t').textContent(), time => time === '2:45 PM');
    await until('Leave by gone from the pane', () => leave.count(), count => count === 0);
    await until('and from the card', () => fact.count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-56: a day whose items are only hidden says how many and offers Show all, with Undo; every calendar off marks the header', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    const empty = page.locator('.rpane .ag-empty');
    const hiddenMark = page.locator('.hd .cal-hidden');
    const names = (await setpoint.api<CalendarOut[]>('GET', '/calendars')).map(calendar => calendar.name);
    assert.deepEqual(names, ['Personal', 'Classes', 'Jobs', 'Holidays in United States', 'Todoist']);
    // Some calendars off: the day still has what's shown, and the header is as it was.
    await page.locator('.calrow', {hasText: 'Personal'}).click();
    await until('Gym and Dentist leave the pane', () => page.locator('.rpane .ag-item').allTextContents(), rows => rows.length === 2);
    assert.equal(await empty.count(), 0);
    assert.equal(await hiddenMark.count(), 0);
    // Every calendar off: Wed Oct 7's Gym, Dentist and two tasks are hidden, not gone, and the header says the view is filtered.
    for (const name of names.slice(1)) await page.locator('.calrow', {hasText: name}).click();
    await until('the pane says what\'s hidden', () => empty.textContent(), line => line === '4 hidden · Show all');
    await hiddenMark.waitFor();
    assert.equal(await rested(() => hiddenMark.evaluate(element => getComputedStyle(element).color)), await rested(() => tokenColour(page, 'ink3')));
    assert.equal(await page.locator('.hd-title').textContent(), 'October 2026');
    // The grid stays quiet: Wed Oct 7's cell has nothing in it.
    assert.deepEqual(await chips(page, '2026-10-07'), []);

    // Show all turns every calendar back on, and Undo in the toast turns them off again.
    await empty.getByRole('button', {name: 'Show all'}).click();
    await until('Wed Oct 7 shows all four again', () => chips(page, '2026-10-07'), list => list.join() === '7 AMGym,2:30 PMDentist,CS 101 lab report,Pay rent');
    assert.equal(await hiddenMark.count(), 0);
    const toast = page.locator('.toast');
    await until('the toast', () => toast.textContent(), line => line?.startsWith('Showed 5 calendars') ?? false);
    await until('kept', () => setpoint.api<CalendarOut[]>('GET', '/calendars'), list => list.every(calendar => calendar.visible));
    await toast.getByRole('button', {name: 'Undo'}).click();
    await until('Undo hides them again', () => empty.textContent(), line => line === '4 hidden · Show all');
    await hiddenMark.waitFor();
    await until('kept hidden', () => setpoint.api<CalendarOut[]>('GET', '/calendars'), list => list.every(calendar => !calendar.visible));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('selecting a day updates the right pane; an item turns solid; Esc lets it go', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    assert.equal(await page.locator('.nowline .t').textContent(), '9:12 AM');
    assert.equal(await page.locator('.ag-item', {hasText: 'Dentist'}).locator('.in').textContent(), 'in 5h');

    await page.locator('.cell[data-date="2026-10-08"]').click({position: {x: 100, y: 150}});
    await until('the pane shows Thu, Oct 8', () => text(page, '.rp-date'), title => title === 'Thu, Oct 8');
    assert.equal(new URL(page.url()).pathname, '/calendar/2026-10-08');
    // Its counts stand in until the forecast is in (D17).
    await until('Thu, Oct 8\'s forecast', () => text(page, '.rp-sub'), line => line === 'Cloudy · 72° / 59°');
    assert.deepEqual(await page.locator('.ag-day').allTextContents(), ['Events', 'Tasks · due tomorrow']);
    assert.equal(await page.locator('.nowline').count(), 0, 'the now-line is today\'s');
    assert.equal(await page.locator('.cell.sel').getAttribute('data-date'), '2026-10-08');

    const dinner = page.locator('.cell[data-date="2026-10-09"] .ev', {hasText: 'Dinner with Sam'});
    await dinner.click();
    await until('Dinner with Sam turns solid', () => dinner.getAttribute('class'), cls => !!cls?.split(' ').includes('sel'));
    assert.equal(await text(page, '.rp-date'), 'Fri, Oct 9');
    assert.equal(await text(page, '.ag-item.sel .title'), 'Dinner with Sam');
    assert.match(new URL(page.url()).pathname, /^\/calendar\/item\/\d+$/);
    // Solid: the colour as fill and no bar, no outline ring.
    const style = await dinner.evaluate(element => [getComputedStyle(element).boxShadow, getComputedStyle(element).outlineStyle]);
    assert.deepEqual(style, ['none', 'none']);
    assert.equal(await page.locator('.ev.sel').count(), 1);

    // A recurring occurrence is selected alone.
    await page.locator('.cell[data-date="2026-10-12"] .ev', {hasText: 'Gym'}).click();
    await until('Mon Oct 12\'s Gym', () => text(page, '.rp-date'), title => title === 'Mon, Oct 12');
    // It turns solid 60 ms into the floating detail's glide (F5).
    await until('only Mon Oct 12\'s Gym is solid', () => page.locator('.ev.sel').count(), count => count === 1);
    assert.equal(await page.locator('.cell[data-date="2026-10-12"] .ev.sel').count(), 1);
    assert.match(new URL(page.url()).search, /^\?at=/);

    await page.keyboard.press('Escape');
    await until('Esc lets the item go', () => page.locator('.ev.sel').count(), count => count === 0);
    assert.equal(new URL(page.url()).pathname, '/calendar/2026-10-12');

    // The mini-month picks a day; ‹ › step only the mini-month.
    await page.locator('.mini button[aria-label="2026-10-20"]').click();
    await until('Tue, Oct 20', () => text(page, '.rp-date'), title => title === 'Tue, Oct 20');
    assert.equal(await page.locator('.mini .vis').textContent(), '20');
    await page.locator('.mini-head').getByRole('button', {name: 'Next month'}).click();
    assert.equal(await text(page, '.mini-head .name'), 'November 2026');
    assert.equal(await text(page, '.hd-title'), 'October 2026');
    await page.locator('.mini button[aria-label="2026-11-18"]').click();
    await until('Wed, Nov 18 in view', () => text(page, '.hd-title'), title => title === 'November 2026');
    assert.equal(await text(page, '.rp-date'), 'Wed, Nov 18');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the Today block\'s card opens its item on Calendar, and an item\'s link lands on its day', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.today-row', {hasText: 'Dentist'}).click();
    await page.locator('.today-card').getByRole('button', {name: 'Open in Calendar'}).click();
    await until('Dentist selected on Wed, Oct 7', () => page.locator('.ev.sel').textContent(), title => title === '2:30 PMDentist');
    assert.equal(await text(page, '.rp-date'), 'Wed, Oct 7');
    await page.keyboard.press('1');
    await page.locator('.today-row', {hasText: 'Renew car registration'}).click();
    await page.locator('.today-card').getByRole('button', {name: 'Open in Calendar'}).click();
    await until('Thu, Oct 8', () => text(page, '.rp-date'), title => title === 'Thu, Oct 8');
    // A deep link to an item far from today scrolls the grid there.
    const items = await setpoint.api<{items: {id: number; title: string}[]}>('GET', '/items?from=2026-10-15&to=2026-10-16');
    const fair = items.items.find(item => item.title === 'Career fair')!;
    await page.goto(`${setpoint.base}/calendar/item/${fair.id}`);
    await until('the Career fair selected', () => page.locator('.ev.sel').textContent(), title => title === '10 AMCareer fair');
    // The grid selects it before the right pane has followed to its day.
    await until('the right pane on Thu, Oct 15', () => text(page, '.rp-date'), title => title === 'Thu, Oct 15');
    assert.equal(await text(page, '.ag-item.sel .line'), '10:00 AM – 2:00 PM · Jobs');
    assert.equal(await text(page, '.ag-item.sel .place'), 'University Student Union');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S8 (SV-25, D54): a task made with a new project loads the calendar\'s Todoist projects again once Todoist has made it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    // As the editor's New project sends it: the confirmed create's live event names the task's
    // calendar, and that loads the projects again, with Garden.
    const todoist = (await setpoint.api<CalendarOut[]>('GET', '/calendars')).find(calendar => calendar.provider === 'todoist')!;
    const projects = page.waitForResponse(async response => response.url().endsWith('/api/todoist/projects')
      && (await response.json() as {name: string}[]).some(project => project.name === 'Garden'), {timeout: 8000});
    await setpoint.api('POST', '/items', {kind: 'task', title: 'Rake leaves', calendar_id: todoist.id, due_date: '2026-10-09', project: 'Garden', create_project: true});
    await projects;
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
