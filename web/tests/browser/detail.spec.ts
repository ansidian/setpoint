// The floating detail in the browser (DESIGN.md › The floating detail and The glide; boards 12a and
// 12b): what the card says and the side it takes (Time to Leave is the time-to-leave fixture, decision
// D3), then the flows: open and close with Esc or the grid, another item shown in the same card, a drag
// starting from the card but not its text, and Edit handing over to the right pane. Where the card
// lies and how it glides are placement.test.ts's and glide.test.ts's tables; the place on screen, the
// glide and the drag's landing are by eye (D416, D417). SV-191: an event on a calendar the user can
// only read (the seed's holiday) changes nowhere, and no picker offers its calendar.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

const card = (page: Page) => page.locator('.fd');
const chip = (page: Page, date: string, title: string) => page.locator(`.cell[data-date="${date}"] .ev`, {hasText: title});

/**
 * Whether `inner`'s right edge is inside `outer`'s, both read in one frame: they scale in with the card
 * together, so one ending inside the other holds at any frame of its opening.
 */
async function endsInside(inner: Locator, outer: Locator): Promise<boolean> {
  const element = await inner.elementHandle();
  return outer.evaluate((box, within) => within!.getBoundingClientRect().right <= box.getBoundingClientRect().right, element);
}

/** Clicks `item` with the card open: the same card shows it. */
async function showIn(page: Page, item: Locator, title: string) {
  await item.click();
  await page.getByRole('dialog', {name: title}).waitFor();
}

async function openDentist(page: Page) {
  await chip(page, '2026-10-07', 'Dentist').click();
  await page.getByRole('dialog', {name: 'Dentist'}).waitFor();
}

test('board 12a: Dentist\'s card, left of it (it covers less there than right; above doesn\'t fit)', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    await openDentist(page);
    assert.equal(await page.getByRole('dialog', {name: 'Dentist'}).count(), 1);
    assert.equal(await card(page).getAttribute('data-side'), 'left');
    assert.deepEqual(await card(page).locator('.fd-layer.in .fact').allTextContents(),
      ['Smile Dental1420 Elm St', 'Leave by 2:05 PM · 18 min', '30 min before', 'Personal']);
    assert.equal(await card(page).locator('.fd-when').textContent(), 'Wed, Oct 7 · 2:30 – 3:30 PM');
    assert.equal(await page.locator('.ag-item.sel .leave').textContent(), 'Leave by 2:05 PM · 18 min');
    // The calendar fact's glyph takes the item's colour, as the failed card's does (#126): Personal's cool.
    const tint = (colour: string) => page.evaluate(value => {
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }, colour);
    assert.equal(await rested(() => card(page).locator('.fd-layer.in .fact.cal .icon').evaluate(icon => getComputedStyle(icon).color)), await rested(() => tint('var(--cool)')));
    assert.equal(await rested(() => card(page).locator('.fd-layer.in .fact.cal span').evaluate(name => getComputedStyle(name).color)), await rested(() => tint('var(--ink2)')), 'its name stays ink2');
    // A recurring event's card says it's a series, after the attendees, as the repeat field words it (#126).
    await showIn(page, chip(page, '2026-10-07', 'Gym'), 'Gym');
    await until('Gym\'s facts', () => card(page).locator('.fd-layer.in .fact').allTextContents(), facts => facts.join() === 'Weekly on Mon, Wed, Fri,10 min before,Personal');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 12b: a click on Dinner with Sam shows it in the same card, below it', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    await openDentist(page);
    const before = await card(page).elementHandle();
    await showIn(page, chip(page, '2026-10-09', 'Dinner with Sam'), 'Dinner with Sam');
    await until('Dinner with Sam turns solid', () => page.locator('.ev.sel').allTextContents(), list => list.join() === '7 PMDinner with Sam');
    assert.ok(await before!.evaluate(element => element.isConnected), 'the same card, never closed');
    // Weeks start on Sunday (SV-29): Friday has only Saturday to its right, too narrow, so it's below.
    await until('below it', () => card(page).getAttribute('data-side'), side => side === 'below');
    await until('Dinner with Sam\'s facts', () => card(page).locator('.fd-layer.in .fact').allTextContents(),
      facts => facts.join() === 'Blue Door2118 Sunset Blvd,Leave by 6:35 PM · 21 min,Sam Lee,1 hour before,Personal');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('selecting items already in view never scrolls the grid: Dentist, then Dinner with Sam, and October stays put (boards 12a, 12b)', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    const scrollTop = () => page.locator('.cal-scroll').evaluate(element => element.scrollTop);
    const october = async (when: string) => {
      assert.equal(await page.locator('.hd-title').textContent(), 'October 2026', `the header ${when}`);
      assert.equal(await page.title(), 'October 2026 · Calendar', `the tab title ${when}`);
      assert.equal(await page.locator('.mini-head .name').textContent(), 'October 2026', `the mini-month ${when}`);
    };
    const before = await scrollTop();
    await october('at rest');
    await page.locator('.cal-scroll').evaluate(element => {
      const seen: number[] = [];
      (window as unknown as {gridScrolls: number[]}).gridScrolls = seen;
      element.addEventListener('scroll', () => seen.push(element.scrollTop));
    });

    await openDentist(page);
    assert.equal(await scrollTop(), before, 'Dentist was in view: the grid stays');
    await october('after Dentist');

    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await until('Dinner with Sam turns solid', () => page.locator('.ev.sel').allTextContents(), list => list.join() === '7 PMDinner with Sam');
    // Nothing happens to wait for: a scroll would have come with the click.
    await setpoint.idle();
    assert.equal(await scrollTop(), before, 'Dinner with Sam was in view: the grid stays');
    await october('after Dinner with Sam');
    assert.deepEqual(await page.evaluate(() => (window as unknown as {gridScrolls: number[]}).gridScrolls), [], 'the grid never scrolled');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Esc closes the card and lets the item go; so does a click on empty grid; × too', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await openDentist(page);
    await page.keyboard.press('Escape');
    await until('Esc closes it', () => card(page).count(), count => count === 0);
    assert.equal(await page.locator('.ev.sel').count(), 0);
    assert.equal(new URL(page.url()).pathname, '/calendar/2026-10-07');

    await openDentist(page);
    await page.locator('.cell[data-date="2026-10-22"]').click({position: {x: 100, y: 150}});
    await until('a click on empty grid closes it', () => card(page).count(), count => count === 0);
    assert.equal(new URL(page.url()).pathname, '/calendar/2026-10-22');

    await openDentist(page);
    await card(page).getByRole('button', {name: 'Close'}).click();
    await until('× closes it', () => card(page).count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Edit (E or the button) hands the item to the right pane, and Esc gives it back to the card', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await openDentist(page);
    await page.keyboard.press('e');
    const editor = page.locator('.editor.handed');
    await editor.waitFor();
    assert.equal(await editor.getByLabel('Title', {exact: true}).inputValue(), 'Dentist');
    await until('the card has gone to the pane', () => card(page).count(), count => count === 0);
    assert.deepEqual(await page.locator('.ev.sel').allTextContents(), ['2:30 PMDentist'], 'the item stays selected');
    // Esc closes the editor, and the card comes back to the item.
    await page.keyboard.press('Escape');
    await until('the editor closes', () => editor.count(), count => count === 0);
    await page.getByRole('dialog', {name: 'Dentist'}).waitFor();
    // The button does the same.
    await card(page).getByRole('button', {name: /^Edit/}).click();
    await editor.waitFor();
    await until('the card has gone again', () => card(page).count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an item picked from the agenda opens its card, and so does a link to it once its chip is drawn', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    await page.locator('.ag-item', {hasText: 'Study group'}).first().click();
    await page.getByRole('dialog', {name: 'Study group'}).waitFor();
    assert.equal(await card(page).getAttribute('data-side'), 'above', 'above it on Friday (SV-29: weeks start on Sunday)');
    const items = await setpoint.api<{items: {id: number; title: string}[]}>('GET', '/items?from=2026-10-15&to=2026-10-16');
    const fair = items.items.find(item => item.title === 'Career fair')!;
    await page.goto(`${setpoint.base}/calendar/item/${fair.id}`);
    await page.getByRole('dialog', {name: 'Career fair'}).waitFor();
    assert.deepEqual(await page.locator('.ev.sel').allTextContents(), ['10 AMCareer fair']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-76: a place with a long link wraps inside the card rather than running out of it', async () => {
  const setpoint = await startSetpoint({fixtures: ['link-places']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    await chip(page, '2026-10-09', 'Study group').click();
    await card(page).waitFor();
    const place = card(page).locator('.fd-layer.in .fd-place');
    assert.match((await place.textContent())!, /^Room 204 or https:\/\/meet\.example\.com\/j\/81234567890\?pwd=/);
    // Fits: the place's right edge is inside the card's body, not under its clip.
    assert.ok(await endsInside(place, card(page).locator('.fd-layer.in .card-b')), 'the place ends inside the card');
    assert.ok(await rested(() => place.evaluate(element => element.scrollWidth <= element.clientWidth)), 'nothing of it runs past its own box');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-77: a place that is a link shows its host and Open; a link among words keeps them with Open; O opens it', async () => {
  const setpoint = await startSetpoint({fixtures: ['link-places']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-15`);
    await page.evaluate(() => {
      (window as unknown as {opened: string[]}).opened = [];
      window.open = (url?: string | URL) => {
        (window as unknown as {opened: string[]}).opened.push(String(url));
        return null;
      };
    });
    // The agenda's line and the card's say the host, after `videocam` (#125).
    assert.equal(await page.locator('.ag-item', {hasText: 'Career fair'}).locator('.place').textContent(), 'careers.example.edu');
    await chip(page, '2026-10-15', 'Career fair').click();
    await card(page).waitFor();
    const fact = card(page).locator('.fd-layer.in .fact.link');
    assert.equal(await fact.locator('.fd-place').textContent(), 'careers.example.edu');
    assert.equal(await fact.locator('.fd-place').getAttribute('data-tip'), 'https://www.careers.example.edu/fair/fall-2026');
    assert.equal(await fact.locator('.icon path').first().getAttribute('d'), ICONS.videocam);
    assert.equal(await page.locator('.ag-item', {hasText: 'Career fair'}).locator('.place .icon path').getAttribute('d'), ICONS.videocam);
    const open = fact.getByRole('link', {name: 'Open'});
    assert.equal(await open.getAttribute('href'), 'https://www.careers.example.edu/fair/fall-2026');
    assert.equal(await open.getAttribute('target'), '_blank');
    // Open ends the place's first line, inside the card.
    assert.ok(await endsInside(open, card(page).locator('.fd-layer.in .card-b')), 'Open ends inside the card');
    // Under the pointer its fill deepens to `sub3`, as every ghost button's does, though it's a link.
    const sub3 = await rested(() => page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--sub3)';
      document.body.append(probe);
      const computed = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return computed;
    }));
    await open.hover();
    await until('Open fills on hover', () => open.evaluate(link => getComputedStyle(link).backgroundColor), fill => fill === sub3);
    await page.mouse.move(1000, 28);
    await page.keyboard.press('o');
    await until('the link opened', () => page.evaluate(() => (window as unknown as {opened: string[]}).opened), opened => opened.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {opened: string[]}).opened), ['https://www.careers.example.edu/fair/fall-2026']);
    // Study group's room and link stay as written, after `location_on`, with Open for the link.
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    await chip(page, '2026-10-09', 'Study group').click();
    await card(page).waitFor();
    const words = card(page).locator('.fd-layer.in .fact.link');
    assert.equal(await words.locator('.icon path').first().getAttribute('d'), ICONS.location_on);
    assert.match((await words.locator('.fd-place').textContent())!, /^Room 204 or https:\/\//);
    assert.equal(await words.getByRole('link', {name: 'Open'}).getAttribute('href'), 'https://meet.example.com/j/81234567890?pwd=Q2xhc3NSb29tTGlua0ZvclN0dWR5R3JvdXA');
    // A place with no link has no Open, and O does nothing there.
    await showIn(page, chip(page, '2026-10-09', 'Dinner with Sam'), 'Dinner with Sam');
    assert.equal(await card(page).locator('.fd-layer.in .fd-open').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-179: the seed\'s Career fair has its own link (Google\'s source.url) on a line of its own, with Open to a new tab; O opens it', async () => {
  // The line's look, and a place's link winning over the event's own, are the component test's (components/detail.test.tsx).
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-15`);
    await page.evaluate(() => {
      (window as unknown as {opened: string[]}).opened = [];
      window.open = (url?: string | URL) => {
        (window as unknown as {opened: string[]}).opened.push(String(url));
        return null;
      };
    });
    await chip(page, '2026-10-15', 'Career fair').click();
    await card(page).waitFor();
    const line = card(page).locator('.fd-layer.in .fact.own');
    assert.equal(await line.locator('.fd-link').textContent(), 'careers.example.edu');
    assert.equal(await card(page).locator('.fd-layer.in .fd-place').textContent(), 'University Student Union');
    const open = line.getByRole('link', {name: 'Open'});
    assert.equal(await open.getAttribute('href'), 'https://careers.example.edu/fair/fall-2026');
    assert.equal(await open.getAttribute('target'), '_blank');
    await page.mouse.move(1000, 28);
    await page.keyboard.press('o');
    await until('the link opened', () => page.evaluate(() => (window as unknown as {opened: string[]}).opened), opened => opened.length === 1);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {opened: string[]}).opened), ['https://careers.example.edu/fair/fall-2026']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Two invented events, so the file opens the import's review (one would open the editor).
const TWO_EVENTS = `${['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example Events//Schedule Export//EN',
  'BEGIN:VEVENT', 'UID:one@events.example.com', 'DTSTAMP:20261001T120000Z', 'DTSTART:20261020T160000Z', 'DTEND:20261020T170000Z', 'SUMMARY:Planning', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:two@events.example.com', 'DTSTAMP:20261001T120000Z', 'DTSTART:20261021T160000Z', 'DTEND:20261021T170000Z', 'SUMMARY:Review', 'END:VEVENT',
  'END:VCALENDAR'].join('\r\n')}\r\n`;

test('SV-191, D447: the seed\'s Veterans Day, on a holiday calendar the user can only read: its menu and card say so and offer nothing that changes it, E does nothing, and neither the editor nor Into offers the calendar', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-11-11`);
    const holiday = chip(page, '2026-11-11', 'Veterans Day');
    await holiday.waitFor();
    // The right-click menu: only the reason, as a note (contextMenu.test.tsx has how one is drawn).
    await holiday.click({button: 'right'});
    const menu = page.locator('.ctx-menu');
    await menu.waitFor();
    assert.deepEqual(await menu.locator('.menu-i').evaluateAll(items => items.map(item => [item.textContent, item.classList.contains('note')])),
      [['This calendar is read-only', true]]);
    await page.keyboard.press('Escape');
    await menu.waitFor({state: 'detached'});

    // The card: its calendar's line says it's read-only and why, with no Edit or actions (detail.test.tsx has the rest).
    await holiday.click();
    const dialog = page.getByRole('dialog', {name: 'Veterans Day'});
    await dialog.waitFor();
    assert.equal(await dialog.getByText('Read-only · Holidays in United States').getAttribute('data-tip'), 'This calendar is read-only');
    assert.equal(await dialog.locator('.card-acts').count(), 0);
    await page.keyboard.press('e');
    // Nothing happens to wait for: E leaves the event alone.
    await page.waitForTimeout(250);
    await setpoint.idle();
    assert.equal(await page.locator('.editor').count(), 0);
    assert.equal(await dialog.count(), 1, 'the card stays');

    // The editor's Calendar menu lists only the calendars an event can go in.
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    await page.keyboard.press('c');
    await page.locator('.editor').getByRole('button', {name: 'Calendar'}).click();
    await page.locator('.editor').getByRole('menuitemradio').first().waitFor();
    assert.deepEqual(await page.locator('.editor').getByRole('menuitemradio').allTextContents(), ['Personal', 'Classes', 'Jobs']);

    // So does the import's Into.
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'Import .ics…'}).click();
    await (await chooser).setFiles({name: 'two.ics', mimeType: 'text/calendar', buffer: Buffer.from(TWO_EVENTS)});
    const pane = page.getByRole('region', {name: 'Import events'});
    await pane.getByRole('button', {name: 'Calendar'}).click();
    await page.getByRole('menuitemradio').first().waitFor();
    assert.deepEqual(await page.getByRole('menuitemradio').allTextContents(), ['Personal', 'Classes', 'Jobs']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
