// The editor in the right pane (DESIGN.md › Editor and Recurring events; boards 13 and 14): boards
// 13 and 14 built and checked (board 13's Dinner with Sam isn't on the calendar yet, the no-dinner
// fixture, D3; board 13 also takes one of the release's page screenshots, pages.ts), then the flows:
// creating the board's two events at once, an edit asking which occurrences (This event, then All
// events), a Todoist task from the same editor, the editor opened from an email's proposal at
// /calendar/new, an edited item's Title read as a line (SV-90), and a new item's one line, its lit
// phrases made title words again by a click or ⌥⌫ (D290).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {CommandOut, ItemsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, matchGolden, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** A day's items as the API has them: "Gym 7:00 AM", "Pay rent" … */
async function day(setpoint: Setpoint, date: string): Promise<{title: string; at: string | null; state: string | null; place: string | null; address: string | null; reminders: number[]; leave: boolean}[]> {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const {items} = await setpoint.api<ItemsOut>('GET', `/items?from=${date}&to=${next}`);
  return items.map(item => ({
    title: item.title, at: item.starts_at ? new Date(item.starts_at).toLocaleTimeString('en-US', {timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit'}) : null,
    state: item.command?.state ?? null, place: item.place, address: item.address, reminders: item.reminders, leave: item.leave_reminder,
  }));
}

const titles = async (setpoint: Setpoint, date: string) => (await day(setpoint, date)).map(item => `${item.title}${item.at ? ` ${item.at}` : ''}`);
// The browser's change reaches the server first: until then the day has nothing pending either.
async function settled(setpoint: Setpoint, date: string) {
  await setpoint.idle();
  return until(`${date}'s changes confirmed`, () => day(setpoint, date), items => items.every(item => item.state === null), 8000);
}

/** The line's title words as it shows them: its text outside the lit phrases (D290). */
const titleWords = (page: Page) => page.locator('.editor .nl-text').evaluate(text => [...text.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
  .map(node => node.textContent).join(' ').replace(/\s+/g, ' ').trim());

const chip = (page: Page, date: string, title: string) => page.locator(`.cell[data-date="${date}"] .ev`, {hasText: title});

async function openCalendar(page: Page, base: string) {
  await page.goto(`${base}/calendar`);
  await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
  await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
}

test('board 13: two new events drafted from one line each, the conflict preview and Places; ⌘Enter creates both', async () => {
  const setpoint = await startSetpoint({fixtures: ['no-dinner'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    // A new item is its one line, with no Title field under it (D290), and no conflict line warns about an empty draft.
    assert.equal(await page.locator('.editor').getByLabel('Title', {exact: true}).count(), 0, 'no Title field');
    assert.equal(await page.locator('.editor .conflict').count(), 0, 'no conflict preview for an empty draft');
    await line.pressSequentially('Dinner with Sam fri 7-9pm @Blue Door');
    // Each parsed part is marked; the fields follow the line.
    await page.locator('.nl .tok-d', {hasText: 'fri 7-9pm'}).waitFor();
    await page.locator('.nl .tok-p', {hasText: '@Blue Door'}).waitFor();
    assert.equal(await titleWords(page), 'Dinner with Sam');
    assert.deepEqual([await page.getByLabel('Date', {exact: true}).inputValue(), await page.getByLabel('Start', {exact: true}).inputValue(), await page.getByLabel('End', {exact: true}).inputValue(), await page.getByLabel('Place', {exact: true}).inputValue()],
      ['Fri, Oct 9', '7:00 PM', '9:00 PM', 'Blue Door']);
    await page.locator('.verdict', {hasText: 'Overlaps Study group · 1h 30m'}).waitFor();
    // Places for the place as it's typed, from the dev stand-in (never Google).
    await page.locator('.places .menu-i', {hasText: 'Blue Door Coffee'}).waitFor();
    // The draft is a ghost on Friday, which is the selected day.
    await page.locator('.cell[data-date="2026-10-09"].sel .ev.ghost', {hasText: 'Dinner with Sam'}).waitFor();

    await page.getByRole('button', {name: 'Add another'}).click();
    await line.click();
    await line.pressSequentially('Gym sat 9am');
    await page.locator('.cell[data-date="2026-10-10"] .ev.ghost', {hasText: 'Gym'}).waitFor();
    await page.getByRole('button', {name: 'Expand draft: Dinner with Sam fri 7-9pm @Blue Door'}).click();
    // Time to Leave is never there by default (SV-31); the menu offers it with Settings' buffer.
    assert.equal(await page.locator('.editor .qchip.ttl').count(), 0);
    await page.getByRole('button', {name: 'Add reminder'}).click();
    await page.getByRole('menuitem', {name: 'Time to Leave 5 min buffer'}).click();
    await page.locator('.editor .qchip.ttl', {hasText: 'Time to Leave'}).waitFor();
    await line.click();
    await page.keyboard.press('End');
    await page.locator('.places .menu-i.cur', {hasText: 'Blue Door'}).waitFor();
    await page.getByRole('button', {name: 'Create 2 events'}).waitFor();
    // The head's × is a 30 px header button with an 18 px glyph, as Settings' (#123); Add another's add is 17 beside its label.
    assert.deepEqual(await page.getByRole('button', {name: 'Close editor'}).evaluate(button => [button.getBoundingClientRect().width, button.querySelector('.icon')!.getAttribute('width')]), [30, '18']);
    assert.equal(await page.getByRole('button', {name: 'Add another'}).locator('.icon').getAttribute('width'), '17');
    await page.mouse.move(700, 28);
    // Lets a hover fill the move left fade out (120 ms) before the screenshot.
    await page.waitForTimeout(250);
    await matchGolden(page, '13-editor-new-event');

    // ⌘Enter creates both; they wait for the provider in place, then settle.
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await page.locator('.cell[data-date="2026-10-09"] .ev', {hasText: 'Dinner with Sam'}).waitFor();
    await settled(setpoint, '2026-10-09');
    const dinner = (await day(setpoint, '2026-10-09')).find(item => item.title === 'Dinner with Sam')!;
    // Settings' reminder default (override 8), the place as typed, and Time to Leave.
    assert.deepEqual([dinner.at, dinner.place, dinner.reminders, dinner.leave], ['7:00 PM', 'Blue Door', [10], true]);
    assert.deepEqual(await titles(setpoint, '2026-10-10'), ['Gym 9:00 AM']);
    await page.locator('.cell[data-date="2026-10-10"] .ev:not(.ghost)', {hasText: 'Gym'}).waitFor();
    await until('the drafts\' ghosts leave the grid', () => page.locator('.ev.ghost').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-27: a picked place stops the place, so what\'s typed after it is the title again, and its full address shows', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    await line.pressSequentially('Lunch fri 1pm @coffee');
    await page.locator('.places .menu-i.cur', {hasText: 'Blue Door Coffee'}).waitFor();
    // Tab picks as Enter does, and the line reads the place in full, then a space (SV-29).
    await page.keyboard.press('Tab');
    await page.locator('.eg > .place-address', {hasText: '77 Elm Ave, Glendale'}).waitFor();
    assert.equal(await line.inputValue(), 'Lunch fri 1pm @Blue Door Coffee ');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Describe the event');
    await line.pressSequentially('with Sam');
    await page.locator('.nl .tok-p', {hasText: /^@Blue Door Coffee$/}).waitFor();
    assert.equal(await titleWords(page), 'Lunch with Sam');
    assert.equal(await page.getByLabel('Place', {exact: true}).inputValue(), 'Blue Door Coffee');
    // The address in full from Place Details, not the suggestion's shorter second line.
    await page.locator('.eg > .place-address', {hasText: '77 Elm Ave, Glendale, CA 91203'}).waitFor();

    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const lunch = (await day(setpoint, '2026-10-09')).find(item => item.title === 'Lunch with Sam')!;
    assert.deepEqual([lunch.at, lunch.place, lunch.address], ['1:00 PM', 'Blue Door Coffee', '77 Elm Ave, Glendale, CA 91203']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 14: editing one Gym asks which occurrences, This event first; All events moves the series', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Gym'}).click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit event"]').waitFor();
    await page.getByLabel('Start', {exact: true}).fill('6:30 AM');
    await page.getByLabel('Start', {exact: true}).press('Enter');
    // The end keeps the length; the line says what it was.
    assert.equal(await page.getByLabel('End', {exact: true}).inputValue(), '7:30 AM');
    await page.locator('.was', {hasText: 'Was 7:00 – 8:00 AM'}).waitFor();
    await page.locator('.verdict', {hasText: 'No conflicts'}).waitFor();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.scope-pop .ropt.on', {hasText: 'This event'}).waitFor();
    await page.locator('.scope-pop', {hasText: 'From Wed, Oct 7 on'}).waitFor();

    // Save ↵ with This event: Wednesday's alone moves.
    await page.keyboard.press('Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-07');
    assert.deepEqual((await titles(setpoint, '2026-10-07')).filter(title => title.startsWith('Gym')), ['Gym 6:30 AM']);
    assert.deepEqual((await titles(setpoint, '2026-10-09')).filter(title => title.startsWith('Gym')), ['Gym 7:00 AM']);

    // Friday's, with All events (↓ ↓): every Gym, past ones too.
    await page.locator('.cell[data-date="2026-10-09"] .ev', {hasText: 'Gym'}).click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.getByLabel('Start', {exact: true}).fill('8am');
    await page.getByLabel('Start', {exact: true}).press('Enter');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.scope-pop').waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.locator('.scope-pop .ropt.on', {hasText: 'All events'}).waitFor();
    await page.keyboard.press('Enter');
    await settled(setpoint, '2026-10-09');
    assert.deepEqual((await titles(setpoint, '2026-10-09')).filter(title => title.startsWith('Gym')), ['Gym 8:00 AM']);
    assert.deepEqual((await titles(setpoint, '2026-10-02')).filter(title => title.startsWith('Gym')), ['Gym 8:00 AM']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('choice 14: clicks on the grid keep the draft; E doesn\'t replace it; Esc closes the card, then the editor', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    // A clean editor still hands over to E.
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').waitFor();
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit event"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.editor').waitFor({state: 'detached'});

    // A draft: two of them.
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.pressSequentially('Lunch with Jo fri noon');
    await page.getByRole('button', {name: 'Add another'}).click();
    await line.click();
    await line.pressSequentially('Gym sat 9am');
    const intact = async () => {
      assert.equal(await page.locator('.editor[aria-label="New event"]').count(), 1);
      assert.equal(await line.inputValue(), 'Gym sat 9am');
      await page.getByRole('button', {name: 'Expand draft: Lunch with Jo fri noon'}).waitFor();
    };
    // Another day: selected, the draft untouched.
    await page.locator('.cell[data-date="2026-10-13"]').click({position: {x: 70, y: 150}});
    await page.locator('.cell[data-date="2026-10-13"].sel').waitFor();
    await intact();
    // An item: its card opens beside it, the draft untouched; E doesn't replace the draft.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await intact();
    await page.keyboard.press('e');
    // Nothing happens to wait for: E leaves the draft alone.
    await page.waitForTimeout(250);
    await setpoint.idle();
    await intact();
    // Esc: the card first, then the editor (and its draft).
    await page.keyboard.press('Escape');
    await until('the card closes', () => page.locator('.fd').count(), count => count === 0);
    await intact();
    await page.keyboard.press('Escape');
    await page.locator('.editor').waitFor({state: 'detached'});
    await until('the drafts\' ghosts leave the grid', () => page.locator('.ev.ghost').count(), count => count === 0);
    assert.deepEqual(await titles(setpoint, '2026-10-09').then(list => list.filter(title => title.startsWith('Lunch'))), [], 'nothing was created');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #3: a started draft and an unsaved edit are still there after going to the Inbox and back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    await page.keyboard.type('Haircut fri 3pm');
    await page.locator('.sb').getByText('Inbox', {exact: true}).click();
    await page.locator('.list .row').first().waitFor();
    await page.locator('.sb').getByText('Calendar', {exact: true}).click();
    await page.locator('.editor').waitFor();
    assert.equal(await page.locator('.editor .nl-input').inputValue(), 'Haircut fri 3pm');
    await page.locator('.cell[data-date="2026-10-09"] .ev.ghost', {hasText: 'Haircut'}).waitFor();
    // Cancel ends it for good.
    await page.locator('.editor').getByRole('button', {name: /Cancel/}).click();
    await page.locator('.sb').getByText('Inbox', {exact: true}).click();
    await page.locator('.list .row').first().waitFor();
    await page.locator('.sb').getByText('Calendar', {exact: true}).click();
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    assert.equal(await page.locator('.editor').count(), 0);

    // An edit: Career fair renamed, left, and still renamed on return.
    await chip(page, '2026-10-15', 'Career fair').click();
    await page.keyboard.press('e');
    await page.locator('.editor input[aria-label="Title"]').fill('Career fair (bring CV)');
    await page.locator('.sb').getByText('Inbox', {exact: true}).click();
    await page.locator('.list .row').first().waitFor();
    await page.goBack();
    await page.locator('.editor').waitFor();
    assert.equal(await page.locator('.editor input[aria-label="Title"]').inputValue(), 'Career fair (bring CV)');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('D56: a click on a day moves a new draft there, empty or started, unless its line names a day', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const date = page.getByLabel('Date', {exact: true});
    const dateIs = (shown: string) => until(`the draft's date reads ${shown}`, () => date.inputValue(), value => value === shown);
    const clickDay = async (day: string) => {
      await page.locator(`.cell[data-date="${day}"]`).click({position: {x: 70, y: 150}});
      await page.locator(`.cell[data-date="${day}"].sel`).waitFor();
    };
    // An empty draft follows the click; D replaces it with a task there, and C with an event again.
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    await clickDay('2026-10-13');
    await dateIs('Tue, Oct 13');
    await page.keyboard.press('d');
    await page.locator('.editor[aria-label="New task"]').waitFor();
    assert.equal(await page.getByLabel('Due date', {exact: true}).inputValue(), 'Tue, Oct 13');
    // The new draft's line has focus again: a click on the grid takes it out, for C.
    await clickDay('2026-10-13');
    await page.keyboard.press('c');
    await page.locator('.editor[aria-label="New event"]').waitFor();
    await dateIs('Tue, Oct 13');

    // A started draft follows the click too, its ghost with it.
    await line.pressSequentially('Lunch with Jo noon');
    await page.locator('.cell[data-date="2026-10-13"] .ev.ghost', {hasText: 'Lunch with Jo'}).waitFor();
    await clickDay('2026-10-15');
    await dateIs('Thu, Oct 15');
    await page.locator('.cell[data-date="2026-10-15"] .ev.ghost', {hasText: 'Lunch with Jo'}).waitFor();
    assert.equal(await page.locator('.cell[data-date="2026-10-13"] .ev.ghost').count(), 0);
    assert.equal(await line.inputValue(), 'Lunch with Jo noon');

    // A day typed in the line stays put.
    await line.click();
    await page.keyboard.press('End');
    await line.pressSequentially(' fri');
    await dateIs('Fri, Oct 9');
    await clickDay('2026-10-14');
    // Nothing happens to wait for: the click leaves the date as typed.
    await page.waitForTimeout(250);
    await setpoint.idle();
    await dateIs('Fri, Oct 9');
    await page.locator('.cell[data-date="2026-10-09"] .ev.ghost', {hasText: 'Lunch with Jo'}).waitFor();

    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-29: New, C and D leave a started draft be and say so; a folded draft goes with its ×; an empty draft is a ghost too', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    // An empty draft is a ghost on its day, as "New event".
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    await page.locator('.cell[data-date="2026-10-07"] .ev.ghost', {hasText: 'New event'}).waitFor();
    await line.pressSequentially('Lunch with Jo fri noon');
    await page.locator('.cell[data-date="2026-10-14"]').click({position: {x: 70, y: 150}});
    await page.locator('.cell[data-date="2026-10-14"].sel').waitFor();
    const toast = page.locator('.toast', {hasText: 'Create or cancel the draft first'});
    for (const press of [() => page.keyboard.press('c'), () => page.keyboard.press('d'), () => page.locator('.hd').getByRole('button', {name: /^New/}).click()]) {
      await press();
      await toast.waitFor();
      assert.equal(await page.locator('.editor[aria-label="New event"]').count(), 1);
      assert.equal(await page.getByRole('button', {name: 'Create event'}).count(), 1, 'no second draft');
      assert.equal(await line.inputValue(), 'Lunch with Jo fri noon');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Describe the event', 'back in the line');
      await page.locator('.cell[data-date="2026-10-14"]').click({position: {x: 70, y: 150}});
      // The next press's toast is its own: the same words in the same place, so this one goes first.
      await toast.waitFor({state: 'detached'});
    }
    // Add another makes a batch on purpose; × takes a folded draft out, its ghost with it.
    await page.getByRole('button', {name: 'Add another'}).click();
    await line.pressSequentially('Gym 7am');
    await page.getByRole('button', {name: 'Create 2 events'}).waitFor();
    await page.getByRole('button', {name: 'Remove draft: Lunch with Jo fri noon'}).click();
    await page.getByRole('button', {name: 'Create event'}).waitFor();
    await until('Lunch\'s ghost goes', () => page.locator('.ev.ghost', {hasText: 'Lunch with Jo'}).count(), count => count === 0);
    assert.equal(await line.inputValue(), 'Gym 7am');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-29: an event\'s days picked in its sheet reach the event, the End list its last day\'s and on screen; typed too', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.pressSequentially('Conference 9am');
    const date = page.getByLabel('Date', {exact: true});
    await date.click();
    // The sheet itself (Sunday first, the band following the pointer either way, its fills, typing)
    // is tests/components/dateRange.test.tsx's (SV-101); here, the days picked reach the event.
    await page.getByRole('dialog', {name: 'Date: pick the first day'}).getByRole('button', {name: '2026-10-13'}).click();
    await page.getByRole('dialog', {name: 'Date: pick the last day'}).getByRole('button', {name: '2026-10-16'}).click();
    await page.locator('.datepop').waitFor({state: 'detached'});
    assert.equal(await date.inputValue(), 'Tue, Oct 13 – Fri, Oct 16');
    // The End list is the last day's times, and lines up with its field rather than run off the page.
    await page.getByLabel('End', {exact: true}).click();
    const ends = page.getByRole('listbox', {name: 'End times'});
    assert.deepEqual((await ends.getByRole('option').allTextContents()).slice(0, 2), ['No end', '12:00 AM']);
    const box = (await rested(() => ends.boundingBox()))!;
    assert.ok(box.x + box.width <= (page.viewportSize()!.width), `the End list ends at ${box.x + box.width}`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.conflict').count(), 0, 'no one-day timeline for days');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-13');
    const conference = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-13&to=2026-10-17')).items.find(item => item.title === 'Conference')!;
    assert.deepEqual([conference.starts_at, conference.ends_at], ['2026-10-13T16:00:00.000Z', '2026-10-16T17:00:00.000Z']);

    // Typed, and all day: Fri – Sun is three days.
    await page.keyboard.press('c');
    await line.pressSequentially('Retreat');
    await page.getByRole('button', {name: 'All day'}).click();
    await date.fill('Fri, Oct 23 – Sun, Oct 25');
    await date.press('Enter');
    assert.equal(await date.inputValue(), 'Fri, Oct 23 – Sun, Oct 25');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-23');
    const retreat = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-23&to=2026-10-26')).items.find(item => item.title === 'Retreat')!;
    assert.deepEqual([retreat.all_day, retreat.start_date, retreat.end_date], [true, '2026-10-23', '2026-10-26']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a Todoist task in the same editor: its due day from the line and its project', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('d');
    const line = page.getByLabel('Describe the task');
    await line.waitFor();
    await line.pressSequentially('Water plants fri');
    assert.equal(await page.getByLabel('Due date', {exact: true}).inputValue(), 'Fri, Oct 9');
    await page.getByLabel('Project', {exact: true}).click();
    await page.getByRole('option', {name: 'Home'}).click();
    await page.getByRole('button', {name: 'Create task'}).click();
    await page.locator('.cell[data-date="2026-10-09"] .tk', {hasText: 'Water plants'}).waitFor();
    await settled(setpoint, '2026-10-09');
    const {items} = await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10');
    assert.deepEqual(items.filter(item => item.kind === 'task').map(item => [item.title, item.due_date, item.project]), [['Water plants', '2026-10-09', 'Home']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-74: a new task\'s × takes its date off, its time and repeat with it; Todoist gets it with no date, and a refusal comes as a toast', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('d');
    const line = page.getByLabel('Describe the task');
    await line.waitFor();
    await line.pressSequentially('Learn guitar 3pm');
    const due = page.getByLabel('Due date', {exact: true});
    assert.equal(await due.inputValue(), 'Wed, Oct 7');
    await page.getByLabel('Start', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Remove due date'}).click();
    await page.getByRole('button', {name: 'Remove due date'}).waitFor({state: 'detached'});
    assert.deepEqual([await due.inputValue(), await due.getAttribute('placeholder')], ['', 'No date']);
    assert.deepEqual([await page.getByLabel('Start', {exact: true}).count(), await page.getByRole('button', {name: 'Add a time'}).count(), await page.getByRole('button', {name: 'Repeat'}).count()], [0, 0, 0]);
    await page.getByRole('button', {name: 'Create task'}).click();
    const created = await until('the create confirmed', () => setpoint.api<CommandOut[]>('GET', '/commands?active=false'), list => list.some(one => one.kind === 'item_create' && one.state === 'confirmed'));
    // A create says nothing (DESIGN #247), even with no day to land on.
    await setpoint.idle();
    assert.equal(await page.locator('.toast').count(), 0, 'no toast for a create');
    const id = created.find(one => one.kind === 'item_create')!.target_id;
    await assert.rejects(setpoint.api('GET', `/items/${id}`), /404|No such item/);
    assert.equal(await page.locator('.tk', {hasText: 'Learn guitar'}).count(), 0);

    // Refused by Todoist: there's no day to fail in place on, so the toast says why, with Try again.
    await page.keyboard.press('d');
    await line.waitFor();
    await line.pressSequentially('Renew passport');
    await page.getByRole('button', {name: 'Remove due date'}).click();
    await page.getByRole('button', {name: 'Create task'}).click();
    await page.locator('.toast', {hasText: 'Couldn\'t create Renew passport, Insufficient permissions (403 Forbidden)'}).getByRole('button', {name: 'Try again'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-72: a new task\'s ghost takes its default project\'s colour before one is picked, the same as a task already in it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // Home, as the seed's Inbox is Todoist's charcoal, too near the unset ring's gray to tell apart.
    await setpoint.api('PATCH', '/settings', {todoist: {default_project: 'Home'}});
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('d');
    const line = page.getByLabel('Describe the task');
    await line.waitFor();
    await line.pressSequentially('Water plants fri');
    const ring = page.locator('.cell[data-date="2026-10-09"] .tk.ghost .ring');
    await ring.waitFor();
    // The same ring as Renew car registration's, a task already in Home.
    const ringColour = (locator: typeof ring) => locator.evaluate(element => getComputedStyle(element).borderTopColor);
    const home = await rested(() => ringColour(page.locator('.cell[data-date="2026-10-08"] .tk:not(.ghost)', {hasText: 'Renew car registration'}).locator('.ring')));
    // The ghost knows the default project once Settings and the projects have answered.
    await until('the ghost takes Home\'s colour', () => ringColour(ring), colour => colour === home);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-88: a task made with no project keeps its default project\'s colour once it\'s saved, and is in that project', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await setpoint.api('PATCH', '/settings', {todoist: {default_project: 'Home'}});
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('d');
    const line = page.getByLabel('Describe the task');
    await line.waitFor();
    await line.pressSequentially('Water plants fri');
    await page.getByRole('button', {name: 'Create task'}).click();
    const ring = page.locator('.cell[data-date="2026-10-09"] .tk:not(.ghost)', {hasText: 'Water plants'}).locator('.ring');
    await ring.waitFor();
    const ringColour = (locator: typeof ring) => locator.evaluate(element => getComputedStyle(element).borderTopColor);
    const home = await rested(() => ringColour(page.locator('.cell[data-date="2026-10-08"] .tk:not(.ghost)', {hasText: 'Renew car registration'}).locator('.ring')));
    // The saved chip, while its create is on its way and once Todoist has it.
    await until('the saved task keeps Home\'s colour', () => ringColour(ring), colour => colour === home);
    await settled(setpoint, '2026-10-09');
    await until('the saved task keeps Home\'s colour once Todoist has it', () => ringColour(ring), colour => colour === home);
    const {items} = await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10');
    assert.deepEqual(items.filter(item => item.kind === 'task').map(item => [item.title, item.project]), [['Water plants', 'Home']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-25: a task\'s #project in the line: suggestions under Project, a pick ends it, and New project is made with the task; a typed repeat is the task\'s', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('d');
    const line = page.getByLabel('Describe the task');
    await line.waitFor();
    const project = page.getByLabel('Project', {exact: true});
    const menu = page.getByRole('listbox', {name: 'Projects'});
    // Typed in the line, the menu shows under Project; Enter picks, and what follows is the title's again.
    await line.pressSequentially('Pay bills #hom');
    await page.locator('.nl .tok-j', {hasText: '#hom'}).waitFor();
    assert.deepEqual(await menu.getByRole('option').allTextContents(), ['Home↵', 'New project “hom”']);
    // Each project in its own colour (SV-29): Home is the seed's orange (#c77100), clamped per theme as its rings are (#175).
    const orange = await rested(() => page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'oklch(from #c77100 clamp(var(--ringMin), l, var(--ringMax)) c h)';
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }));
    assert.equal(await rested(() => menu.getByRole('option', {name: 'Home'}).locator('.dot').evaluate(dot => getComputedStyle(dot).backgroundColor)), orange);
    await page.keyboard.press('Enter');
    await menu.waitFor({state: 'detached'});
    // The line reads the project's name, then a space (SV-29).
    assert.equal(await line.inputValue(), 'Pay bills #Home ');
    await line.pressSequentially('fri');
    assert.deepEqual([await titleWords(page), await project.inputValue(), await page.getByLabel('Due date', {exact: true}).inputValue()],
      ['Pay bills', 'Home', 'Fri, Oct 9']);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});

    // An unknown name runs on to a comma; New project, once picked, is tagged New and not offered again.
    // A repeat typed for a task is its repeat, in Todoist's words.
    await page.keyboard.press('d');
    await line.pressSequentially('Plan trip #Travel ideas, every sat');
    assert.deepEqual(await menu.getByRole('option').allTextContents(), ['New project “Travel ideas”↵']);
    await page.keyboard.press('Enter');
    await page.locator('.editor .field .tag', {hasText: 'New'}).waitFor();
    assert.equal(await project.inputValue(), 'Travel ideas');
    await page.getByRole('button', {name: 'Repeat'}).filter({hasText: 'Every Saturday'}).waitFor();
    await project.click();
    assert.equal(await menu.count(), 0);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-10');
    await settled(setpoint, '2026-10-09');
    const tasks = async (from: string, to: string) => (await setpoint.api<ItemsOut>('GET', `/items?from=${from}&to=${to}`)).items.filter(item => item.kind === 'task');
    assert.deepEqual((await tasks('2026-10-09', '2026-10-10')).filter(task => task.title === 'Pay bills').map(task => task.project), ['Home']);
    assert.deepEqual((await tasks('2026-10-10', '2026-10-11')).filter(task => task.title === 'Plan trip').map(task => [task.project, task.repeat]), [['Travel ideas', 'every sat']]);
    assert.ok((await setpoint.api<{name: string}[]>('GET', '/todoist/projects')).some(one => one.name === 'Travel ideas'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-56: "#ho" puts Home first in Project\'s menu, as the line reads it; Enter picks it, and its mark takes Home\'s colour', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('d');
    const line = page.getByLabel('Describe the task');
    await line.waitFor();
    const menu = page.getByRole('listbox', {name: 'Projects'});
    const mark = page.locator('.nl .tok-j');
    const markColour = () => mark.evaluate(element => getComputedStyle(element).getPropertyValue('--c').trim());
    // School holds "ho" too, but Home starts with it: Home first, with the cursor on it.
    await line.pressSequentially('Buy printer ink #ho');
    await mark.filter({hasText: '#ho'}).waitFor();
    assert.deepEqual(await menu.getByRole('option').allTextContents(), ['Home↵', 'School', 'New project “ho”']);
    // Not a project yet: the mark is ink2.
    assert.equal(await markColour(), await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink2').trim()));
    await page.keyboard.press('Enter');
    await menu.waitFor({state: 'detached'});
    assert.equal(await line.inputValue(), 'Buy printer ink #Home ');
    assert.equal(await page.getByLabel('Project', {exact: true}).inputValue(), 'Home');
    // Home's orange, as its dot in the Project field and menu (TODOIST_COLOURS.orange).
    await mark.filter({hasText: '#Home'}).waitFor();
    assert.equal(await rested(() => markColour()), '#c77100');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-56: a line longer than the field shows its typed end and marks, faded where it\'s cut; Home goes back to its start', async () => {
  const setpoint = await startSetpoint({fixtures: ['no-dinner'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    const marks = page.locator('.editor .nl-marks');
    const place = page.locator('.nl .tok-p', {hasText: '@Blue Door'});
    await line.pressSequentially('Coffee with Ana and the study group tomorrow 3-4pm @Blue Door');
    await place.waitFor();
    // The caret is at the end, and so is what shows: the place's mark is inside the field.
    const inView = async (mark: typeof place) => {
      const [field, box] = [(await rested(() => marks.boundingBox()))!, (await rested(() => mark.boundingBox()))!];
      // A mark draws 2 px either side of its text, and the caret takes a pixel past it.
      return box.x + 2 >= field.x && box.x + box.width - 2 <= field.x + field.width + 2;
    };
    await until('@Blue Door in view', () => inView(place), shown => shown);
    const scrolled = await line.evaluate(input => (input as HTMLInputElement).scrollLeft);
    assert.ok(scrolled > 0, `the input scrolled ${scrolled} px`);
    const shift = () => marks.locator('.nl-text').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
    assert.equal(await rested(() => shift()), -scrolled, 'the marks moved with the text');
    const clipped = () => marks.evaluate(element => [element.hasAttribute('data-clip-left'), element.hasAttribute('data-clip-right')]);
    assert.deepEqual(await clipped(), [true, false]);
    // The cut side fades over 14 px.
    assert.equal(await marks.evaluate(element => getComputedStyle(element).maskImage), 'linear-gradient(90deg, rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 14px)');
    // Home: the start shows again, the end is cut and fades.
    await page.keyboard.press('Home');
    await until('back at the start', clipped, clip => !clip[0] && !!clip[1]);
    assert.equal(await rested(() => shift()), 0);
    assert.equal(await rested(() => marks.evaluate(element => getComputedStyle(element).maskImage)), 'linear-gradient(270deg, rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 14px)');
    assert.equal(await inView(place), false, '@Blue Door is past the end');
    // However the field scrolls (a drag past its edge), the marks follow: scrolled partway, both sides are cut.
    await line.evaluate(input => {
      input.scrollLeft = 80;
    });
    await until('cut both sides', clipped, clip => !!clip[0] && !!clip[1]);
    assert.equal(await rested(() => shift()), -80);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-71: a task\'s lone # shows every project before anything is typed; a pick goes into the line and the field', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const names = (menu: ReturnType<typeof page.getByRole>) => menu.getByRole('option').evaluateAll(options => options.map(option => option.textContent!.replace('↵', '')));

    // A task's "#": every project, in Todoist's order; Enter takes the first into the line and the field.
    await page.keyboard.press('d');
    const task = page.getByLabel('Describe the task');
    await task.waitFor();
    await task.pressSequentially('Water plants #');
    const projects = page.getByRole('listbox', {name: 'Projects'});
    await until('every project', () => names(projects), list => list.join() === 'Inbox,School,Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await until('School picked', () => task.inputValue(), text => text === 'Water plants #School ');
    assert.equal(await page.getByLabel('Project', {exact: true}).inputValue(), 'School');
    assert.equal(await projects.count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-71: an event\'s lone # shows every calendar, and a lone @ or an empty Place the places events have used', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const names = (menu: ReturnType<typeof page.getByRole>) => menu.getByRole('option').evaluateAll(options => options.map(option => option.textContent!.replace('↵', '')));

    // An event's "#": every calendar of Google's.
    await page.keyboard.press('c');
    const event = page.getByLabel('Describe the event');
    await event.waitFor();
    await event.pressSequentially('Lab review #');
    const calendars = page.getByRole('listbox', {name: 'Calendars'});
    await until('every calendar', () => names(calendars), list => list.join() === 'Personal,Classes,Jobs');
    // A space ends it.
    await page.keyboard.press('Space');
    await until('the menu closes', () => calendars.count(), count => count === 0);

    // "@": the places events have used, the latest first; a letter narrows them, Enter takes one with its address.
    await event.fill('');
    await event.pressSequentially('Lunch @');
    const places = page.getByRole('listbox', {name: 'Places'});
    await until('the recent places', () => places.locator('.place-name').allTextContents(), list => list.join() === 'University Student Union,Blue Door,Smile Dental');
    await page.keyboard.type('b');
    await until('narrowed to Blue Door', () => places.locator('.place-name').allTextContents(), list => list.join() === 'Blue Door');
    await page.keyboard.press('Enter');
    await until('Blue Door in the line', () => event.inputValue(), text => text === 'Lunch @Blue Door ');
    assert.equal(await page.getByLabel('Place', {exact: true}).inputValue(), 'Blue Door');
    await page.locator('.editor .place-address', {hasText: '2118 Sunset Blvd'}).waitFor();
    assert.equal(await places.count(), 0);

    // The Place field, emptied and focused, offers them too; Tab through it goes on without picking.
    await page.getByRole('button', {name: 'Clear place'}).click();
    await event.fill('Lunch');
    await page.getByLabel('Place', {exact: true}).focus();
    await until('the recent places under Place', () => places.locator('.place-name').count(), count => count === 3);
    await page.keyboard.press('Tab');
    await until('the list goes', () => places.count(), count => count === 0);
    assert.equal(await page.getByLabel('Place', {exact: true}).inputValue(), '');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('D57: an event\'s #calendar in the line filters the Calendar menu; typing alone takes the first, a pick ends it, and #1 stays a title', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const classes = (await setpoint.api<{id: number; name: string}[]>('GET', '/calendars')).find(calendar => calendar.name === 'Classes')!.id;
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    const menu = page.getByRole('listbox', {name: 'Calendars'});
    const calendar = page.getByRole('button', {name: 'Calendar', exact: true});
    // "#cl": the calendars holding it, and typing alone takes the first.
    await line.pressSequentially('Lab review fri 3pm #cl');
    assert.deepEqual(await menu.getByRole('option').allTextContents(), ['Classes↵']);
    await calendar.filter({hasText: 'Classes'}).waitFor();
    await page.locator('.nl .tok-c', {hasText: '#cl'}).waitFor();
    // Tab picks as Enter does: the line reads the calendar's name, then a space (SV-29).
    await page.keyboard.press('Tab');
    await menu.waitFor({state: 'detached'});
    assert.equal(await line.inputValue(), 'Lab review fri 3pm #Classes ');
    // A pick ends it: what follows is the title's, and "#1" names no calendar.
    await line.pressSequentially('notes #1 prep');
    assert.equal(await titleWords(page), 'Lab review notes #1 prep');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const lab = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Lab review notes #1 prep')!;
    assert.equal(lab.calendar_id, classes);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-25: the date and time pickers: a month under the date, 15-minute lists (End\'s with lengths), shorthand, and × back to all day', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').pressSequentially('Standup fri 10am');
    const [date, start, end] = ['Date', 'Start', 'End'].map(label => page.getByLabel(label, {exact: true}));
    // The date: a month under it, a click picks the first day, then the last (SV-29): the same day
    // again is one day. ↓ moves a week and Enter picks as a click does.
    await date!.click();
    const month = page.getByRole('dialog', {name: 'Date: pick the first day'});
    const last = page.getByRole('dialog', {name: 'Date: pick the last day'});
    await month.locator('.mini-head', {hasText: 'October 2026'}).waitFor();
    await month.getByRole('button', {name: '2026-10-14'}).click();
    await last.getByRole('button', {name: '2026-10-14'}).click();
    await last.waitFor({state: 'detached'});
    assert.equal(await date!.inputValue(), 'Wed, Oct 14');
    await date!.click();
    await page.keyboard.press('ArrowDown');
    await month.locator('.cur', {hasText: '21'}).waitFor();
    await page.keyboard.press('Enter');
    await last.waitFor();
    await page.keyboard.press('Enter');
    await last.waitFor({state: 'detached'});
    assert.equal(await date!.inputValue(), 'Wed, Oct 21');

    // Start: the day in 15-minute steps, scrolled to its value; ↓ and Enter pick, and the end keeps the length.
    await start!.click();
    const starts = page.getByRole('listbox', {name: 'Start times'});
    const at10 = starts.getByRole('option', {name: '10:00 AM', exact: true});
    assert.equal(await at10.getAttribute('aria-selected'), 'true');
    const [list, row] = [await rested(() => starts.boundingBox()), await rested(() => at10.boundingBox())];
    assert.ok(row!.y >= list!.y && row!.y + row!.height <= list!.y + list!.height, 'the list shows its value');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await starts.waitFor({state: 'detached'});
    assert.deepEqual([await start!.inputValue(), await end!.inputValue()], ['10:15 AM', '11:15 AM']);
    // End: No end (SV-78), then from after the start, with lengths.
    await end!.click();
    const ends = page.getByRole('listbox', {name: 'End times'});
    assert.deepEqual((await ends.getByRole('option').allTextContents()).slice(0, 2), ['No end', '10:30 AM (15 min)']);
    assert.equal(await ends.getByRole('option', {name: '11:15 AM (1 hr)'}).getAttribute('aria-selected'), 'true');
    await ends.getByRole('option', {name: '11:45 AM (1.5 hrs)'}).click();
    assert.equal(await end!.inputValue(), '11:45 AM');
    // Shorthand: "330p".
    await start!.fill('330p');
    await start!.press('Enter');
    assert.deepEqual([await start!.inputValue(), await end!.inputValue()], ['3:30 PM', '5:00 PM']);
    // × sets the event back to all day.
    await page.getByRole('button', {name: 'All day', exact: true}).click();
    await page.getByRole('button', {name: 'All day · Add a time'}).waitFor();
    assert.equal(await start!.count(), 0);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-21');
    assert.deepEqual((await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-21&to=2026-10-22')).items.filter(item => item.title === 'Standup').map(item => [item.all_day, item.start_date]),
      [[true, '2026-10-21']]);

    // A task's × takes its time off.
    await page.keyboard.press('d');
    await page.getByLabel('Describe the task').pressSequentially('Call bank fri 3pm');
    assert.equal(await start!.inputValue(), '3:00 PM');
    await page.getByRole('button', {name: 'Remove time'}).click();
    await page.getByRole('button', {name: 'Add a time'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-78: No end in the End list makes an event that ends as it starts; it says its start alone and overlaps nothing', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').pressSequentially('Call Mom fri 7:30pm');
    const [start, end] = ['Start', 'End'].map(label => page.getByLabel(label, {exact: true}));
    // A new event keeps its hour.
    assert.deepEqual([await start!.inputValue(), await end!.inputValue()], ['7:30 PM', '8:30 PM']);
    await end!.click();
    await page.getByRole('listbox', {name: 'End times'}).getByRole('option', {name: 'No end', exact: true}).click();
    // The field reads No end as the Date field reads No date: its placeholder, in ink3.
    assert.deepEqual([await end!.inputValue(), await end!.getAttribute('placeholder')], ['', 'No end']);
    // A new start keeps it without an end.
    await start!.fill('745p');
    await start!.press('Enter');
    assert.deepEqual([await start!.inputValue(), await end!.inputValue()], ['7:45 PM', '']);
    // During Dinner with Sam and Study group, but taking no time, it has no conflicts.
    await page.locator('.editor', {hasText: 'No conflicts'}).waitFor();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const call = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Call Mom')!;
    assert.equal(call.ends_at, call.starts_at);
    // The agenda and the card say its start alone; the agenda finds no overlap.
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    const row = page.locator('.ag-item', {hasText: 'Call Mom'});
    assert.match((await row.locator('.line').textContent())!, /^7:45 PM · /);
    assert.equal(await row.locator('.overlap').count(), 0);
    await chip(page, '2026-10-09', 'Call Mom').click();
    assert.equal(await page.locator('.fd .fd-layer.in .fd-when').textContent(), 'Fri, Oct 9 · 7:45 PM');
    // Opened again, its End still reads No end.
    await page.keyboard.press('e');
    await page.locator('.editor').waitFor();
    assert.deepEqual([await start!.inputValue(), await end!.inputValue(), await end!.getAttribute('placeholder')], ['7:45 PM', '', 'No end']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-108: the line\'s "2pm no end" and "2pm to 2pm" pick No end in End, lit with the time; saved, it ends as it starts and opens as No end', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    const [start, end] = ['Start', 'End'].map(label => page.getByLabel(label, {exact: true}));
    await line.pressSequentially('Call Sam fri 2pm no end');
    await page.locator('.nl .tok-d', {hasText: 'fri 2pm no end'}).waitFor();
    assert.deepEqual([await titleWords(page), await start!.inputValue(), await end!.inputValue(), await end!.getAttribute('placeholder')],
      ['Call Sam', '2:00 PM', '', 'No end']);
    // The same time twice is No end too, not a day long.
    await line.fill('Call Sam fri 2pm to 2pm');
    await page.locator('.nl .tok-d', {hasText: 'fri 2pm to 2pm'}).waitFor();
    assert.deepEqual([await start!.inputValue(), await end!.inputValue(), await end!.getAttribute('placeholder')], ['2:00 PM', '', 'No end']);
    assert.equal(await page.locator('.editor .later').count(), 0, 'no +1 day');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const call = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Call Sam')!;
    assert.equal(call.ends_at, call.starts_at);
    // Opened again, its End reads No end, as the line had it.
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    await chip(page, '2026-10-09', 'Call Sam').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit event"]').waitFor();
    assert.deepEqual([await start!.inputValue(), await end!.inputValue(), await end!.getAttribute('placeholder')], ['2:00 PM', '', 'No end']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-111: the line\'s span of days: "oct 23–25" is all day over them, "fri 7pm to sun 3pm" one event across them', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    const date = page.getByLabel('Date', {exact: true});
    const [start, end] = ['Start', 'End'].map(label => page.getByLabel(label, {exact: true}));
    await line.pressSequentially('Retreat oct 23–25');
    await page.locator('.nl .tok-d', {hasText: 'oct 23–25'}).waitFor();
    await page.getByRole('button', {name: 'All day · Add a time'}).waitFor();
    assert.deepEqual([await titleWords(page), await date.inputValue(), await start!.count()], ['Retreat', 'Fri, Oct 23 – Sun, Oct 25', 0]);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-23');
    const retreat = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-23&to=2026-10-26')).items.find(item => item.title === 'Retreat')!;
    assert.deepEqual([retreat.all_day, retreat.start_date, retreat.end_date, retreat.recurrence], [true, '2026-10-23', '2026-10-26', null]);

    // A time at each end: one timed event from Friday evening to Sunday afternoon.
    await page.keyboard.press('c');
    await line.pressSequentially('Trip fri 7pm to sun 3pm');
    await page.locator('.nl .tok-d', {hasText: 'fri 7pm to sun 3pm'}).waitFor();
    assert.deepEqual([await date.inputValue(), await start!.inputValue(), await end!.inputValue(), await page.locator('.editor .later').textContent()],
      ['Fri, Oct 9 – Sun, Oct 11', '7:00 PM', '3:00 PM', '+2']);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const trip = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-12')).items.find(item => item.title === 'Trip')!;
    assert.deepEqual([trip.starts_at, trip.ends_at, trip.recurrence], ['2026-10-10T02:00:00.000Z', '2026-10-11T22:00:00.000Z', null]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-111: a span of days with one time range repeats it daily until the last day, as Repeat says', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').pressSequentially('Conference oct 23–25 9am–5pm');
    await page.locator('.nl .tok-d', {hasText: 'oct 23–25 9am–5pm'}).waitFor();
    const repeat = page.getByRole('button', {name: 'Repeat'});
    await repeat.filter({hasText: 'Daily, until Sun, Oct 25'}).waitFor();
    assert.deepEqual([await page.getByLabel('Date', {exact: true}).inputValue(), await page.getByLabel('Start', {exact: true}).inputValue(), await page.getByLabel('End', {exact: true}).inputValue()],
      ['Fri, Oct 23', '9:00 AM', '5:00 PM']);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-23');
    // Each day from the first to the last, and none after.
    const conference = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-22&to=2026-10-28')).items.filter(item => item.title === 'Conference');
    assert.deepEqual(conference.map(item => item.starts_at), ['2026-10-23T16:00:00.000Z', '2026-10-24T16:00:00.000Z', '2026-10-25T16:00:00.000Z']);
    assert.deepEqual([conference[0]!.ends_at, conference[0]!.recurrence], ['2026-10-24T00:00:00.000Z', 'RRULE:FREQ=DAILY;UNTIL=20261025']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-111: a length after "for" sets End from the start, and with no time typed from 9:00 AM', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    const [start, end] = ['Start', 'End'].map(label => page.getByLabel(label, {exact: true}));
    await line.pressSequentially('Call Sam fri 2pm for 1.5h');
    await page.locator('.nl .tok-d', {hasText: 'fri 2pm for 1.5h'}).waitFor();
    assert.deepEqual([await titleWords(page), await start!.inputValue(), await end!.inputValue()], ['Call Sam', '2:00 PM', '3:30 PM']);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const call = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Call Sam')!;
    assert.deepEqual([call.starts_at, call.ends_at], ['2026-10-09T21:00:00.000Z', '2026-10-09T22:30:00.000Z']);

    // No time typed: it starts at the default start and lasts the length.
    await page.keyboard.press('c');
    await line.pressSequentially('Lunch fri for 1h');
    await page.locator('.nl .tok-d', {hasText: 'fri for 1h'}).waitFor();
    assert.deepEqual([await titleWords(page), await start!.inputValue(), await end!.inputValue()], ['Lunch', '9:00 AM', '10:00 AM']);
    await line.fill('Lunch fri for 2 hours');
    await page.locator('.nl .tok-d', {hasText: 'fri for 2 hours'}).waitFor();
    assert.equal(await end!.inputValue(), '11:00 AM');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const lunch = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Lunch')!;
    assert.deepEqual([lunch.starts_at, lunch.ends_at], ['2026-10-09T16:00:00.000Z', '2026-10-09T18:00:00.000Z']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** The editor's reminder chips as they read, Time to Leave's aside. */
const reminderChips = (page: Page) => page.locator('.editor .prow.reminders .qchip:not(.ttl)').allTextContents();

test('SV-112: "remind me 1h before" in a new event\'s line replaces Settings\' default, a reminder ticked sits beside it, and its mark has a tint of its own in Night and Light', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await until('Settings\' default', () => reminderChips(page), list => list.join() === '10 min before');
    await line.pressSequentially('Call Sam fri 2pm remind me 1h before');
    await page.locator('.nl .tok-r', {hasText: 'remind me 1h before'}).waitFor();
    await page.locator('.nl .tok-d', {hasText: 'fri 2pm'}).waitFor();
    await until('the line\'s reminder in place of the default', () => reminderChips(page), list => list.join() === '1 hour before');

    // Its mark and the Reminders row's glyph aren't the when's, in either theme.
    for (const theme of ['night', 'light'] as const) {
      await page.emulateMedia({colorScheme: theme === 'light' ? 'light' : 'dark'});
      await until(`${theme} is on`, () => page.evaluate(() => document.documentElement.dataset.theme), shown => shown === theme);
      const [when, reminder, whenGlyph, reminderGlyph] = await rested(() => Promise.all([
        page.locator('.nl .tok-d').evaluate(mark => getComputedStyle(mark).backgroundColor),
        page.locator('.nl .tok-r').evaluate(mark => getComputedStyle(mark).backgroundColor),
        page.locator('.editor .eg > .icon.from-when').evaluate(glyph => getComputedStyle(glyph).color),
        page.locator('.editor .eg > .icon.from-remind').evaluate(glyph => getComputedStyle(glyph).color),
      ]));
      assert.notEqual(reminder, when, `${theme}: the reminder's mark has its own tint`);
      assert.notEqual(reminderGlyph, whenGlyph, `${theme}: so has the glyph of the row it filled`);
    }

    // Ticked beside the line's; taking the phrase out takes only what it set.
    await page.getByRole('button', {name: 'Add reminder'}).click();
    await page.getByRole('menuitem', {name: '30 min before'}).click();
    await until('the one ticked beside it', () => reminderChips(page), list => list.join() === '30 min before,1 hour before');
    await line.fill('Call Sam fri 2pm');
    await until('only the line\'s goes', () => reminderChips(page), list => list.join() === '30 min before');
    await line.fill('Call Sam fri 2pm remind me 1h before');
    await until('the line\'s back beside it', () => reminderChips(page), list => list.join() === '30 min before,1 hour before');
    await page.locator('.editor .qchip', {hasText: '30 min before'}).getByRole('button', {name: 'Remove reminder'}).click();
    await until('the ticked one gone', () => reminderChips(page), list => list.join() === '1 hour before');
    await line.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const call = (await day(setpoint, '2026-10-09')).find(item => item.title === 'Call Sam');
    assert.deepEqual(call?.reminders, [60]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-112: a moment in the line, "reminder fri 8pm", is the reminder\'s and not the event\'s day, kept as its offset; kept as words, it drops it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.pressSequentially('Office hours sat 3pm reminder fri 8pm');
    await page.locator('.nl .tok-r', {hasText: 'reminder fri 8pm'}).waitFor();
    await until('the chip at its moment, the offset beside it', () => reminderChips(page), list => list.join() === 'Fri, Oct 9, 8:00 PM19 hrs before');
    assert.match(await page.getByLabel('Date', {exact: true}).inputValue(), /Oct 10/);
    // Kept as words (⌥⌫ inside it, D290), the phrase drops its reminder for Settings' default; typed into again, it's back.
    await line.press('ArrowLeft');
    await line.press('Alt+Backspace');
    await page.locator('.nl .tok-r').waitFor({state: 'detached'});
    await until('Settings\' default again', () => reminderChips(page), list => list.join() === '10 min before');
    await line.press('End');
    await line.press('Backspace');
    await line.pressSequentially('m');
    await page.locator('.nl .tok-r', {hasText: 'reminder fri 8pm'}).waitFor();
    await until('the line\'s again', () => reminderChips(page), list => list.join() === 'Fri, Oct 9, 8:00 PM19 hrs before');
    await line.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-10');
    const office = (await day(setpoint, '2026-10-10')).find(item => item.title === 'Office hours');
    assert.deepEqual([office?.at, office?.reminders], ['3:00 PM', [1140]]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-112: a reminder phrase typed into an edited item\'s Title adds to its reminders', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit event"]').waitFor();
    await until('its own reminder', () => reminderChips(page), list => list.join() === '30 min before');
    const title = page.locator('.editor input[aria-label="Title"]');
    await title.press('End');
    await title.pressSequentially(' remind 1 day before');
    await page.locator('.nl .tok-r', {hasText: 'remind 1 day before'}).waitFor();
    await until('the phrase\'s beside its own', () => reminderChips(page), list => list.join() === '30 min before,1 day before');
    await title.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-07');
    const dentist = (await day(setpoint, '2026-10-07')).find(item => item.title === 'Dentist');
    assert.deepEqual(dentist?.reminders, [30, 1440]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('F6b: a task\'s labels and repeat: picked from Todoist\'s, set on a new task and changed on an existing one', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('d');
    const line = page.getByLabel('Describe the task');
    await line.waitFor();
    await line.pressSequentially('Water plants fri');
    await page.getByRole('button', {name: 'Add label'}).click();
    await page.getByRole('menuitem', {name: 'errand'}).click();
    await page.getByRole('button', {name: 'Add label'}).click();
    await page.getByRole('menuitem', {name: 'waiting'}).click();
    await page.getByRole('button', {name: 'Remove label errand'}).click();
    await page.getByRole('button', {name: 'Repeat'}).click();
    await page.getByRole('menuitemradio', {name: 'Every fri'}).click();
    await page.getByRole('button', {name: 'Create task'}).click();
    await page.locator('.cell[data-date="2026-10-09"] .tk', {hasText: 'Water plants'}).waitFor();
    await settled(setpoint, '2026-10-09');
    const created = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Water plants')!;
    assert.deepEqual([created.labels, created.repeat, created.recurring], [['waiting'], 'every fri', true]);

    // Pay rent: a label, and a repeat set with a new date in one change (D16: the repeat goes with the date).
    await page.locator('.cell[data-date="2026-10-07"] .tk', {hasText: 'Pay rent'}).click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit task"]').waitFor();
    await page.getByRole('button', {name: 'Add label'}).click();
    await page.getByRole('menuitem', {name: 'errand'}).click();
    await page.getByRole('button', {name: 'Repeat'}).click();
    await page.getByRole('menuitemradio', {name: 'Every month'}).click();
    await page.getByLabel('Due date', {exact: true}).fill('Oct 8');
    await page.getByLabel('Due date', {exact: true}).press('Enter');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-08');
    const rent = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-08&to=2026-10-09')).items.find(item => item.title === 'Pay rent')!;
    assert.deepEqual([rent.labels, rent.repeat, rent.due_date], [['errand'], 'every month', '2026-10-08']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('F6b: an event moves to another calendar of its account; a repeating one goes as a series', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const calendars = await setpoint.api<{id: number; name: string}[]>('GET', '/calendars');
    const classes = calendars.find(calendar => calendar.name === 'Classes')!.id;
    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit event"]').waitFor();
    await page.getByRole('button', {name: 'Calendar', exact: true}).click();
    // Only Personal's account: Jobs is another Google account.
    assert.deepEqual(await page.locator('.editor .menu .menu-i').allTextContents(), ['Personal', 'Classes']);
    await page.getByRole('menuitemradio', {name: 'Classes'}).click();
    await page.getByRole('button', {name: 'Save'}).click();
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const dinner = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Dinner with Sam')!;
    assert.equal(dinner.calendar_id, classes);

    // Gym: one occurrence can't go alone, so the prompt offers This and following and All events.
    await chip(page, '2026-10-07', 'Gym').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.getByRole('button', {name: 'Calendar', exact: true}).click();
    await page.getByRole('menuitemradio', {name: 'Classes'}).click();
    await page.getByRole('button', {name: 'Save'}).click();
    await page.locator('.scope-pop').waitFor();
    assert.deepEqual(await page.locator('.scope-pop .ropt-label').allTextContents(), ['This and following', 'All events']);
    await page.locator('.scope-pop .ropt.on', {hasText: 'This and following'}).waitFor();
    await page.locator('.scope-pop', {hasText: 'To Classes, past ones too'}).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await settled(setpoint, '2026-10-07');
    const gyms = async (date: string) => (await setpoint.api<ItemsOut>('GET', `/items?from=${date}&to=${new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}`)).items
      .filter(item => item.title === 'Gym').map(item => item.calendar_id);
    assert.deepEqual([await gyms('2026-10-02'), await gyms('2026-10-07'), await gyms('2026-10-30')], [[classes], [classes], [classes]]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// The row's own behaviour (Custom…'s fields, the 4 weeks, a chip reopening it) is in
// web/tests/components/reminders.test.tsx; this is the journey to the API and the detail.
test('SV-109: Custom… picks a moment after the start, which the event keeps and its card reads as that moment; a task without a time counts from 9:00 AM', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').pressSequentially('Office hours sat 3pm');
    await page.getByRole('button', {name: 'Add reminder'}).click();
    await page.getByRole('menuitem', {name: 'Custom…'}).click();
    const time = page.getByRole('textbox', {name: 'Reminder time'});
    await time.click();
    await time.fill('5pm');
    await time.press('Enter');
    await page.locator('.editor .field-note', {hasText: '2 hrs after'}).waitFor();
    await page.getByRole('button', {name: 'Add', exact: true}).click();
    await page.locator('.editor .qchip', {hasText: 'Sat, Oct 10, 5:00 PM'}).waitFor();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-10');
    const created = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-10&to=2026-10-11')).items.find(item => item.title === 'Office hours')!;
    assert.deepEqual(created.reminders, [10, -120]);
    // Its card: the preset in its words, the custom one at its moment with the offset beside it.
    await page.goto(`${setpoint.base}/calendar/item/${created.id}`);
    const reminders = page.getByRole('dialog', {name: 'Office hours'}).locator('.fd-reminders > span');
    await until('the card\'s reminders', () => reminders.allTextContents(), lines => lines.length === 2);
    assert.deepEqual(await reminders.allTextContents(), ['10 min before', 'Sat, Oct 10, 5:00 PM2 hrs after']);

    // A task with a day and no time: Custom… counts from 9:00 AM, and the task keeps what's picked.
    await page.keyboard.press('Escape');
    await page.keyboard.press('d');
    await page.getByLabel('Describe the task').pressSequentially('Return forms sat');
    await page.getByRole('button', {name: 'Add reminder'}).click();
    const custom = page.getByRole('menuitem', {name: /^Custom…/});
    assert.equal(await custom.textContent(), 'Custom…Counts from 9:00 AM');
    await custom.click();
    await time.click();
    await time.fill('7:30am');
    await time.press('Enter');
    await page.getByRole('button', {name: 'Add', exact: true}).click();
    await page.locator('.editor .qchip', {hasText: 'Sat, Oct 10, 7:30 AM'}).waitFor();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-10');
    const task = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-10&to=2026-10-11')).items.find(item => item.title === 'Return forms')!;
    assert.deepEqual(task.reminders, [90]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the editor\'s keys after a pick from one of its menus: ⌘Enter saves, Esc closes a menu, then the editor', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const calendars = await setpoint.api<{id: number; name: string}[]>('GET', '/calendars');
    const classes = calendars.find(calendar => calendar.name === 'Classes')!.id;
    // An event: the calendar, then a reminder, picked from their menus; ⌘Enter creates it.
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    await line.pressSequentially('Office hours sat 3pm');
    await page.getByRole('button', {name: 'Calendar', exact: true}).click();
    await page.getByRole('menuitemradio', {name: 'Classes'}).click();
    await page.getByRole('button', {name: 'Add reminder'}).click();
    await page.getByRole('menuitem', {name: '1 hour before'}).click();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-10');
    const created = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-10&to=2026-10-11')).items.find(item => item.title === 'Office hours')!;
    assert.deepEqual([created.calendar_id, created.reminders], [classes, [10, 60]]);

    // A task: its project and a label picked, then ⌘Enter.
    await page.keyboard.press('d');
    await page.getByLabel('Describe the task').pressSequentially('Return forms sat');
    await page.getByLabel('Project', {exact: true}).click();
    await page.getByRole('option', {name: 'School'}).click();
    await page.getByRole('button', {name: 'Repeat'}).click();
    await page.getByRole('menuitemradio', {name: 'Every Saturday'}).click();
    await page.getByRole('button', {name: 'Add label'}).click();
    await page.getByRole('menuitem', {name: 'waiting'}).click();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-10');
    const task = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-10&to=2026-10-11')).items.find(item => item.title === 'Return forms')!;
    assert.deepEqual([task.project, task.repeat, task.labels], ['School', 'every sat', ['waiting']]);

    // Esc after a pick: an open menu closes first, then the editor (D30's order).
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').pressSequentially('Coffee sun 10am');
    await page.getByRole('button', {name: 'Repeat'}).click();
    await page.getByRole('menuitemradio', {name: 'Daily'}).click();
    // A press outside an open menu closes it, and only it (SV-24).
    for (const opener of ['Calendar', 'Repeat']) {
      await page.getByRole('button', {name: opener, exact: true}).click();
      await page.getByRole('menu').waitFor();
      await page.getByLabel('Describe the event').click();
      await page.getByRole('menu').waitFor({state: 'detached'});
      assert.equal(await page.locator('.editor').count(), 1);
    }
    await page.getByRole('button', {name: 'Calendar', exact: true}).click();
    await page.getByRole('menu').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({state: 'detached'});
    assert.equal(await page.locator('.editor').count(), 1);
    await page.keyboard.press('Escape');
    await page.locator('.editor').waitFor({state: 'detached'});
    assert.deepEqual((await titles(setpoint, '2026-10-11')).filter(title => title.startsWith('Coffee')), [], 'nothing was created');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('/calendar/new: the proposal card\'s More options opens the editor pre-filled from the email', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const all = await setpoint.api<{days: {rows: {id: number; subject: string}[]}[]}>('GET', '/mail/all?limit=100');
    const sam = all.days.flatMap(group => group.rows).find(row => row.subject === 'Dinner Friday?')!;
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/new?kind=event&message=${sam.id}`);
    // The proposal's title goes into the line, its words read as words only (D290).
    const line = page.getByLabel('Describe the event');
    await until('the proposal fills the editor', () => line.inputValue(), value => value.length > 0);
    const proposal = await setpoint.api<{item: {title: string}; from_email: string[]}>('POST', '/proposals/from-message', {message_id: sam.id, kind: 'event'});
    assert.equal(await line.inputValue(), proposal.item.title);
    assert.equal(await page.locator('.nl [data-start]').count(), 0, 'nothing in the title lit');
    // F6b: the fields the email gave carry the card's "from the email" mark, until they're changed;
    // the title's sits at the line's trailing edge (D290).
    const marked = async () => {
      const rows = {title: '.ed-line .nl', date: '.eg .prow:has(input[aria-label="Date"])', place: '.eg label.field:has(input[aria-label="Place"])'};
      const found: string[] = [];
      for (const [field, selector] of Object.entries(rows)) if (await page.locator(`${selector} .srcm`).count()) found.push(field);
      return found;
    };
    const expected = ['title', 'date', 'place'].filter(field => proposal.from_email.includes(field) || (field === 'date' && proposal.from_email.includes('time')));
    assert.ok(expected.includes('title'), `the seed's proposal gives a title (${proposal.from_email.join(', ')})`);
    await until('the marks', marked, found => found.join() === expected.join());
    // At the line's right end, the line's text stopping before it.
    const [mark, field, input] = await rested(() => Promise.all(['.ed-line .nl > .srcm', '.ed-line .nl', '.ed-line .nl-input'].map(selector => page.locator(selector).evaluate(element => element.getBoundingClientRect().toJSON() as DOMRect))));
    assert.ok(mark!.right <= field!.right && field!.right - mark!.right < 16 && input!.right <= mark!.left, `the mark at ${mark!.left}–${mark!.right}, the line ${field!.right}, its text to ${input!.right}`);
    await page.locator('.ed-foot .legend', {hasText: 'From the email'}).waitFor();
    // It stays inside the footer's padding, however narrow the editor (UX #23).
    const [legend, foot] = await page.locator('.ed-foot').evaluate(element => [element.querySelector('.legend')!.getBoundingClientRect().right, element.getBoundingClientRect().right]);
    assert.ok(legend! <= foot! - 16, `the legend ends at ${legend}, the footer at ${foot}`);
    await line.fill('Dinner with Sam at Blue Door');
    assert.deepEqual(await marked(), expected.filter(field => field !== 'title'));
    // Cancel leaves /calendar/new.
    await page.keyboard.press('Escape');
    await page.locator('.editor').waitFor({state: 'detached'});
    assert.equal(new URL(page.url()).pathname, '/calendar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #5: More options on an email for another month shows that month, so the draft\'s ghost is in view', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const all = await setpoint.api<{days: {rows: {id: number; subject: string}[]}[]}>('GET', '/mail/all?limit=100');
    const exam = all.days.flatMap(group => group.rows).find(row => row.subject === 'Final exam schedule · CS 101')!;
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/new?kind=event&message=${exam.id}`);
    const ghost = page.locator('.cell[data-date="2026-12-09"] .ev.ghost');
    await until('the draft\'s day is December 9', () => page.getByLabel('Date', {exact: true}).inputValue(), value => /Dec 9/.test(value));
    const inView = () => ghost.first().evaluate(chip => {
      const grid = document.querySelector('.cal-scroll')!.getBoundingClientRect();
      const box = chip.getBoundingClientRect();
      return box.top >= grid.top && box.bottom <= grid.bottom;
    }).catch(() => false);
    await until('the ghost is on screen', inView, shown => shown);
    assert.match(await page.locator('.cal-title').textContent() ?? '', /December/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('UX #7: E opens the editor with its Title focused and selected, so typing renames the item', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-15"] .ev', {hasText: 'Career fair'}).click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    const title = page.locator('.editor input[aria-label="Title"]');
    await title.waitFor();
    await until('the Title has focus', () => title.evaluate(input => input === document.activeElement), focused => focused);
    await page.keyboard.type('Career fair (bring CV)');
    assert.equal(await title.inputValue(), 'Career fair (bring CV)');
    // T typed there is the title's, not the calendar's Today.
    assert.equal(await page.locator('.editor').count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('D290: a click on a lit phrase, or ⌥⌫ inside it, makes it title words, and what it set goes, until it\'s typed into again', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    const date = page.getByLabel('Date', {exact: true});
    const start = page.getByLabel('Start', {exact: true});
    await line.pressSequentially('Lunch with May 12');
    const may = page.locator('.nl .tok-d', {hasText: 'May 12'});
    await may.waitFor();
    await until('the date is May 12', () => date.inputValue(), value => /May 12/.test(value));
    // The click that focuses the line only focuses it.
    await page.locator('.editor .ed-title').click();
    const box = (await rested(() => may.boundingBox()))!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await until('the line focused', () => line.evaluate(input => input === document.activeElement), focused => focused);
    assert.equal(await may.count(), 1, 'May 12 still lit');
    // Over the lit phrase, the focused line says what a click does.
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2);
    await until('the tooltip', () => line.getAttribute('title'), title => title === 'Click to keep as words');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await may.waitFor({state: 'detached'});
    // The title has May in it, and the draft is back on the day it opened on.
    assert.deepEqual([await titleWords(page), await date.inputValue()], ['Lunch with May 12', 'Wed, Oct 7']);
    assert.equal(await line.getAttribute('title'), null);
    // It stays words as the line goes on; a phrase typed after it lights.
    await line.press('End');
    await line.pressSequentially(' fri 1pm');
    await page.locator('.nl .tok-d', {hasText: 'fri 1pm'}).waitFor();
    assert.deepEqual([await page.locator('.nl [data-start]').allTextContents(), await titleWords(page), await start.inputValue()], [['fri 1pm'], 'Lunch with May 12', '1:00 PM']);
    // ⌥⌫ with the caret inside "fri 1pm" makes it words too, its day and time gone.
    await line.press('ArrowLeft');
    await line.press('Alt+Backspace');
    await page.locator('.nl .tok-d').waitFor({state: 'detached'});
    assert.deepEqual([await line.inputValue(), await date.inputValue(), await start.inputValue()], ['Lunch with May 12 fri 1pm', 'Wed, Oct 7', '9:00 AM']);
    // Typed into again, it's read again.
    await line.press('End');
    await line.press('Backspace');
    await line.pressSequentially('m');
    await page.locator('.nl .tok-d', {hasText: 'fri 1pm'}).waitFor();
    await line.press('ArrowLeft');
    await line.press('Alt+Backspace');
    await page.locator('.nl .tok-d').waitFor({state: 'detached'});
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-07');
    assert.ok((await titles(setpoint, '2026-10-07')).includes('Lunch with May 12 fri 1pm 9:00 AM'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('D290: E on an edit with phrases typed selects only its title words, so typing renames it and the phrases stay', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const title = page.locator('.editor input[aria-label="Title"]');
    await chip(page, '2026-10-15', 'Career fair').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await title.press('End');
    await title.pressSequentially(' fri 7pm @Blue Door');
    await page.locator('.nl .tok-p', {hasText: '@Blue Door'}).waitFor();
    // Left and come back to, the edit opens again as E does: its title words selected, not its phrases.
    await page.locator('.sb').getByText('Inbox', {exact: true}).click();
    await page.locator('.list .row').first().waitFor();
    await page.goBack();
    await title.waitFor();
    await until('the title words selected', () => title.evaluate((input: HTMLInputElement) => (input === document.activeElement ? input.value.slice(input.selectionStart!, input.selectionEnd!) : null)), selected => selected === 'Career fair');
    await page.keyboard.type('Expo');
    assert.equal(await title.inputValue(), 'Expo fri 7pm @Blue Door');
    await page.locator('.nl .tok-d', {hasText: 'fri 7pm'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-90: what an edit types into a Title reads as a new item\'s line does; the words it had stay its title', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const classes = (await setpoint.api<{id: number; name: string}[]>('GET', '/calendars')).find(calendar => calendar.name === 'Classes')!.id;
    const title = page.locator('.editor input[aria-label="Title"]');
    // Dentist, 2:30 – 3:30 PM on Wed: a time keeps its length, a day keeps its time, #cl its calendar.
    await chip(page, '2026-10-07', 'Dentist').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit event"]').waitFor();
    await title.press('End');
    await title.pressSequentially(' at 3:45p');
    await page.locator('.nl .tok-d', {hasText: 'at 3:45p'}).waitFor();
    await until('the end keeps the hour', () => Promise.all(['Start', 'End'].map(label => page.getByLabel(label, {exact: true}).inputValue())), times => times.join(' – ') === '3:45 PM – 4:45 PM');
    await page.locator('.was', {hasText: 'Was 2:30 – 3:30 PM'}).waitFor();
    await title.pressSequentially(' fri #cl');
    await until('the date moves to Friday', () => page.getByLabel('Date', {exact: true}).inputValue(), value => /Oct 9/.test(value));
    const menu = page.getByRole('listbox', {name: 'Calendars'});
    assert.deepEqual(await menu.getByRole('option').allTextContents(), ['Classes↵']);
    await page.keyboard.press('Enter');
    await menu.waitFor({state: 'detached'});
    assert.equal(await title.inputValue(), 'Dentist at 3:45p fri #Classes ');
    await page.getByRole('button', {name: 'Calendar', exact: true}).filter({hasText: 'Classes'}).waitFor();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const dentist = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Dentist')!;
    assert.deepEqual([dentist.starts_at, dentist.ends_at, dentist.calendar_id], ['2026-10-09T22:45:00.000Z', '2026-10-09T23:45:00.000Z', classes]);

    // A repeating Gym: the time typed asks which occurrences, as the Start field does; This event moves Wednesday's.
    await chip(page, '2026-10-07', 'Gym').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await title.press('End');
    await title.pressSequentially(' 6:30a');
    await until('the end keeps the hour', () => page.getByLabel('End', {exact: true}).inputValue(), value => value === '7:30 AM');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.scope-pop .ropt.on', {hasText: 'This event'}).waitFor();
    await page.keyboard.press('Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-07');
    assert.deepEqual((await titles(setpoint, '2026-10-07')).filter(one => one.startsWith('Gym')), ['Gym 6:30 AM']);
    assert.deepEqual((await titles(setpoint, '2026-10-09')).filter(one => one.startsWith('Gym')), ['Gym 7:00 AM']);

    // Renew car registration, due Thu with no time: a day, a due time and a project, typed after its title.
    await page.locator('.cell[data-date="2026-10-08"] .tk', {hasText: 'Renew car registration'}).click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit task"]').waitFor();
    await title.press('End');
    await title.pressSequentially(' fri 5pm #sch');
    const projects = page.getByRole('listbox', {name: 'Projects'});
    await projects.waitFor();
    // Editing offers only Todoist's projects: no New project.
    assert.deepEqual(await projects.getByRole('option').allTextContents(), ['School↵']);
    await page.keyboard.press('Enter');
    await projects.waitFor({state: 'detached'});
    await until('the due date moves to Friday', () => page.getByLabel('Due date', {exact: true}).inputValue(), value => /Oct 9/.test(value));
    assert.equal(await page.getByLabel('Start', {exact: true}).inputValue(), '5:00 PM');
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const renew = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-10')).items.find(item => item.title === 'Renew car registration')!;
    assert.deepEqual([renew.due_date, renew.due_at, renew.project], ['2026-10-09', '2026-10-10T00:00:00.000Z', 'School']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-90: a title that already ends in "@" and a letter opens with no menu; only an edit\'s own "@" opens one', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    const title = page.locator('.editor input[aria-label="Title"]');
    const places = page.getByRole('listbox', {name: 'Places'});
    // Study group has no place, so no Places list of its own.
    await chip(page, '2026-10-09', 'Study group').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await title.waitFor();
    // Selected on opening: typing replaces it, and its "@B" is the edit's, so the recent places show.
    await page.keyboard.type('Ask @B');
    await places.waitFor();
    await page.keyboard.press('Escape');
    await places.waitFor({state: 'detached'});
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    await chip(page, '2026-10-09', 'Ask @B').click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('e');
    await title.waitFor();
    await setpoint.idle();
    assert.equal(await places.count(), 0);
    await title.press('End');
    await page.keyboard.type(' @');
    await places.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-113: "next week" is next Monday, and "Trip fri for 3 days" is all day Friday to Sunday (D294, D298)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    const date = page.getByLabel('Date', {exact: true});
    await line.pressSequentially('Plan sprint next week');
    await page.locator('.nl .tok-d', {hasText: 'next week'}).waitFor();
    assert.deepEqual([await titleWords(page), await date.inputValue()], ['Plan sprint', 'Mon, Oct 12']);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-12');
    assert.ok((await titles(setpoint, '2026-10-12')).includes('Plan sprint 9:00 AM'));

    // A length in whole days with no time: all day over them.
    await page.keyboard.press('c');
    await line.pressSequentially('Trip fri for 3 days');
    await page.locator('.nl .tok-d', {hasText: 'fri for 3 days'}).waitFor();
    await page.getByRole('button', {name: 'All day · Add a time'}).waitFor();
    assert.deepEqual([await titleWords(page), await date.inputValue(), await page.getByLabel('Start', {exact: true}).count()], ['Trip', 'Fri, Oct 9 – Sun, Oct 11', 0]);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-09');
    const trip = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-09&to=2026-10-12')).items.find(item => item.title === 'Trip')!;
    assert.deepEqual([trip.all_day, trip.start_date, trip.end_date], [true, '2026-10-09', '2026-10-12']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-113: "every mon until dec 15" ends the repeat there, as Repeat says, its Mondays on the calendar and none after', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').pressSequentially('Standup every mon 9am until dec 15');
    await page.locator('.nl .tok-d', {hasText: 'every mon 9am until dec 15'}).waitFor();
    await page.getByRole('button', {name: 'Repeat'}).filter({hasText: 'Weekly on Monday, until Tue, Dec 15'}).waitFor();
    assert.deepEqual([await titleWords(page), await page.getByLabel('Date', {exact: true}).inputValue(), await page.getByLabel('Start', {exact: true}).inputValue()],
      ['Standup', 'Mon, Oct 12', '9:00 AM']);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-12');
    // Its Mondays show on the month, and the series stops at its last day.
    for (const monday of ['2026-10-12', '2026-10-19', '2026-10-26']) await chip(page, monday, 'Standup').waitFor();
    const standups = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-12-01&to=2027-01-01')).items.filter(item => item.title === 'Standup');
    assert.deepEqual(standups.map(item => item.starts_at), ['2026-12-07T17:00:00.000Z', '2026-12-14T17:00:00.000Z']);
    assert.equal(standups[0]!.recurrence, 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261215');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-113: "Gym every day for 2 weeks" repeats daily for two weeks, an hour each, not one event two weeks long', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').pressSequentially('Gym every day for 2 weeks');
    await page.locator('.nl .tok-d', {hasText: 'every day for 2 weeks'}).waitFor();
    await page.getByRole('button', {name: 'Repeat'}).filter({hasText: 'Daily, until Tue, Oct 20'}).waitFor();
    assert.deepEqual([await page.getByLabel('Date', {exact: true}).inputValue(), await page.getByLabel('Start', {exact: true}).inputValue(), await page.getByLabel('End', {exact: true}).inputValue()],
      ['Wed, Oct 7', '9:00 AM', '10:00 AM']);
    await page.keyboard.press('Meta+Enter');
    await page.locator('.editor').waitFor({state: 'detached'});
    await settled(setpoint, '2026-10-07');
    const gym = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-25')).items.filter(item => item.title === 'Gym' && item.recurrence?.includes('UNTIL=20261020'));
    assert.equal(gym.length, 14);
    assert.deepEqual([gym[0]!.starts_at, gym[0]!.ends_at, gym.at(-1)!.starts_at], ['2026-10-07T16:00:00.000Z', '2026-10-07T17:00:00.000Z', '2026-10-20T16:00:00.000Z']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
