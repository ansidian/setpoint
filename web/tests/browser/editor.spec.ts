// The editor in the right pane (DESIGN.md › Editor and Recurring events; boards 13 and 14): boards
// 13 and 14 against their approved screenshots (board 13's Dinner with Sam isn't on the calendar
// yet, the no-dinner fixture, D3), then
// the flows: creating the board's two events at once, an edit asking which occurrences (This event,
// then All events), a Todoist task from the same editor, and the editor opened from an email's
// proposal at /calendar/new.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, matchGolden, startSetpoint, until} from './harness.ts';
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
    // Before anything is typed, the Title field says what it's for and no conflict line warns about an empty draft.
    assert.equal(await page.getByLabel('Title', {exact: true}).getAttribute('placeholder'), 'Title');
    assert.equal(await page.locator('.editor .conflict').count(), 0, 'no conflict preview for an empty draft');
    await line.pressSequentially('Dinner with Sam fri 7-9pm @Blue Door');
    // Each parsed part is marked; the fields follow the line.
    await page.locator('.nl .tok-d', {hasText: 'fri 7-9pm'}).waitFor();
    await page.locator('.nl .tok-p', {hasText: '@Blue Door'}).waitFor();
    assert.equal(await page.getByLabel('Title', {exact: true}).inputValue(), 'Dinner with Sam');
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
    await matchGolden(page, '13-editor-new-event', 'main');

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
    assert.equal(await page.getByLabel('Title', {exact: true}).inputValue(), 'Lunch with Sam');
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
    await page.mouse.move(700, 28);
    // Lets a hover fill the move left fade out (120 ms) before the screenshot.
    await page.waitForTimeout(250);
    await matchGolden(page, '14-editing-a-recurring-event', 'rightPane');

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

test('SV-29: an event\'s days in one sheet: a first click, then a last, the band following the pointer; typed too; the End list stays on screen', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openCalendar(page, setpoint.base);
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.pressSequentially('Conference 9am');
    const date = page.getByLabel('Date', {exact: true});
    await date.click();
    const sheet = page.getByRole('dialog', {name: 'Date: pick the first day'});
    await sheet.waitFor();
    // Sunday first (SV-29).
    assert.deepEqual(await sheet.locator('.mini .h').allTextContents(), ['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    await sheet.getByRole('button', {name: '2026-10-13'}).click();
    await page.getByRole('dialog', {name: 'Date: pick the last day'}).waitFor();
    assert.equal(await date.inputValue(), 'Tue, Oct 13');
    const band = () => page.locator('.datepop .mini .in').allTextContents();
    await page.locator('.datepop').getByRole('button', {name: '2026-10-16'}).hover();
    assert.deepEqual(await band(), ['13', '14', '15', '16']);
    await page.locator('.datepop').getByRole('button', {name: '2026-10-16'}).click();
    await page.locator('.datepop').waitFor({state: 'detached'});
    assert.equal(await date.inputValue(), 'Tue, Oct 13 – Fri, Oct 16');
    // The other end may come before the first: the band follows the pointer back, and the earlier
    // day starts it (#103).
    await date.click();
    await sheet.getByRole('button', {name: '2026-10-16'}).click();
    await page.getByRole('dialog', {name: 'Date: pick the last day'}).waitFor();
    await page.locator('.datepop').getByRole('button', {name: '2026-10-13'}).hover();
    await until('the band runs back to the 13th', band, days => days.join() === '13,14,15,16');
    // The band is `cool` (#104): 28% between, 50% at an end, 60% at the end under the pointer.
    // Each is compared with `cool` mixed in this page, once the fill's fade has ended.
    const expected = await page.evaluate(() => [60, 28, 28, 50].map(percent => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.background = `color-mix(in oklch, var(--cool) ${percent}%, transparent)`;
      const fill = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return fill;
    }));
    const fills = () => page.locator('.datepop .mini .in').evaluateAll(days => days.map(day => getComputedStyle(day).backgroundColor));
    await until('the band is cool', fills, now => now.join() === expected.join());
    await page.locator('.datepop').getByRole('button', {name: '2026-10-13'}).click();
    await page.locator('.datepop').waitFor({state: 'detached'});
    assert.equal(await date.inputValue(), 'Tue, Oct 13 – Fri, Oct 16');
    // The End list is the last day's times, and lines up with its field rather than run off the page.
    await page.getByLabel('End', {exact: true}).click();
    const ends = page.getByRole('listbox', {name: 'End times'});
    assert.equal(await ends.getByRole('option').first().textContent(), '12:00 AM');
    const box = (await ends.boundingBox())!;
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
    const home = await ringColour(page.locator('.cell[data-date="2026-10-08"] .tk:not(.ghost)', {hasText: 'Renew car registration'}).locator('.ring'));
    assert.equal(await ringColour(ring), home);
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
    const orange = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'oklch(from #c77100 clamp(var(--ringMin), l, var(--ringMax)) c h)';
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    });
    assert.equal(await menu.getByRole('option', {name: 'Home'}).locator('.dot').evaluate(dot => getComputedStyle(dot).backgroundColor), orange);
    await page.keyboard.press('Enter');
    await menu.waitFor({state: 'detached'});
    // The line reads the project's name, then a space (SV-29).
    assert.equal(await line.inputValue(), 'Pay bills #Home ');
    await line.pressSequentially('fri');
    assert.deepEqual([await page.getByLabel('Title', {exact: true}).inputValue(), await project.inputValue(), await page.getByLabel('Due date', {exact: true}).inputValue()],
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
    assert.equal(await markColour(), '#c77100');
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
      const [field, box] = [(await marks.boundingBox())!, (await mark.boundingBox())!];
      // A mark draws 2 px either side of its text, and the caret takes a pixel past it.
      return box.x + 2 >= field.x && box.x + box.width - 2 <= field.x + field.width + 2;
    };
    await until('@Blue Door in view', () => inView(place), shown => shown);
    const scrolled = await line.evaluate(input => (input as HTMLInputElement).scrollLeft);
    assert.ok(scrolled > 0, `the input scrolled ${scrolled} px`);
    const shift = () => marks.locator('.nl-text').evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m41);
    assert.equal(await shift(), -scrolled, 'the marks moved with the text');
    const clipped = () => marks.evaluate(element => [element.hasAttribute('data-clip-left'), element.hasAttribute('data-clip-right')]);
    assert.deepEqual(await clipped(), [true, false]);
    // The cut side fades over 14 px.
    assert.equal(await marks.evaluate(element => getComputedStyle(element).maskImage), 'linear-gradient(90deg, rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 14px)');
    // Home: the start shows again, the end is cut and fades.
    await page.keyboard.press('Home');
    await until('back at the start', clipped, clip => !clip[0] && !!clip[1]);
    assert.equal(await shift(), 0);
    assert.equal(await marks.evaluate(element => getComputedStyle(element).maskImage), 'linear-gradient(270deg, rgba(0, 0, 0, 0) 0px, rgb(0, 0, 0) 14px)');
    assert.equal(await inView(place), false, '@Blue Door is past the end');
    // However the field scrolls (a drag past its edge), the marks follow: scrolled partway, both sides are cut.
    await line.evaluate(input => {
      input.scrollLeft = 80;
    });
    await until('cut both sides', clipped, clip => !!clip[0] && !!clip[1]);
    assert.equal(await shift(), -80);
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
    assert.equal(await page.getByLabel('Title', {exact: true}).inputValue(), 'Lab review notes #1 prep');
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
    const [list, row] = [await starts.boundingBox(), await at10.boundingBox()];
    assert.ok(row!.y >= list!.y && row!.y + row!.height <= list!.y + list!.height, 'the list shows its value');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await starts.waitFor({state: 'detached'});
    assert.deepEqual([await start!.inputValue(), await end!.inputValue()], ['10:15 AM', '11:15 AM']);
    // End: from after the start, with lengths.
    await end!.click();
    const ends = page.getByRole('listbox', {name: 'End times'});
    assert.equal(await ends.getByRole('option').first().textContent(), '10:30 AM (15 min)');
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
    const title = page.getByLabel('Title', {exact: true});
    await until('the proposal fills the editor', () => title.inputValue(), value => value.length > 0);
    const proposal = await setpoint.api<{item: {title: string}; from_email: string[]}>('POST', '/proposals/from-message', {message_id: sam.id, kind: 'event'});
    assert.equal(await title.inputValue(), proposal.item.title);
    // F6b: the fields the email gave carry the card's "from the email" mark, until they're changed.
    const marked = async () => {
      const rows = {title: '.eg label.field:has(input[aria-label="Title"])', date: '.eg .prow:has(input[aria-label="Date"])', place: '.eg label.field:has(input[aria-label="Place"])'};
      const found: string[] = [];
      for (const [field, selector] of Object.entries(rows)) if (await page.locator(`${selector} .srcm`).count()) found.push(field);
      return found;
    };
    const expected = ['title', 'date', 'place'].filter(field => proposal.from_email.includes(field) || (field === 'date' && proposal.from_email.includes('time')));
    assert.ok(expected.includes('title'), `the seed's proposal gives a title (${proposal.from_email.join(', ')})`);
    await until('the marks', marked, found => found.join() === expected.join());
    await page.locator('.ed-foot .legend', {hasText: 'From the email'}).waitFor();
    // It stays inside the footer's padding, however narrow the editor (UX #23).
    const [legend, foot] = await page.locator('.ed-foot').evaluate(element => [element.querySelector('.legend')!.getBoundingClientRect().right, element.getBoundingClientRect().right]);
    assert.ok(legend! <= foot! - 16, `the legend ends at ${legend}, the footer at ${foot}`);
    await title.fill('Dinner with Sam at Blue Door');
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

test('UX #8: a Title typed by hand rewrites the line\'s title words, so the two never disagree', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    await page.keyboard.press('c');
    const line = page.locator('.editor .nl-input');
    const title = page.locator('.editor input[aria-label="Title"]');
    await line.waitFor();
    await page.keyboard.type('Coffee fri');
    await title.fill('Coffee with Ana');
    assert.equal(await line.inputValue(), 'Coffee with Ana fri');
    await line.press('End');
    await line.pressSequentially(' 3pm');
    assert.equal(await line.inputValue(), 'Coffee with Ana fri 3pm');
    assert.equal(await title.inputValue(), 'Coffee with Ana');
    // The line's title words, changed there, are the Title's again.
    await line.fill('Coffee with Ana and Jo fri 3pm');
    assert.equal(await title.inputValue(), 'Coffee with Ana and Jo');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
