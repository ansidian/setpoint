// How Calendar moves and answers (darma SV-64, the polish audit's calendar lane): paging lands on the
// month it went to, and the rest of the lane's marks and answers.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {UNDO_MS} from '../../src/app/toast.ts';
import {monthTopRow} from '../../src/logic/calendar.ts';
import {ICONS} from '../../src/ui/glyphs.ts';
import {minuteTop} from '../../src/logic/week.ts';
import {layout} from '../../src/tokens.ts';
import {cleanUp, pauseClock, rested, startSetpoint, test, until, ZOOM} from './harness.ts';

after(cleanUp);

const ROW = layout.monthRow;

/** A colour as the page computes it: a token (`--sub3`) or any colour expression, on a probe. */
async function colour(page: Page, value: string): Promise<string> {
  return page.evaluate(css => {
    const probe = document.createElement('div');
    probe.style.color = css.startsWith('--') ? `var(${css})` : css;
    document.body.append(probe);
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, value);
}
const top = (month: string) => monthTopRow(month) * ROW;
// Rounded: at a fractional zoom the scroller lands on the nearest device pixel.
const scrollTop = (page: Page) => page.locator('.cal-scroll').evaluate(element => Math.round(element.scrollTop));
const style = (target: Locator, property: string, pseudo?: string) => target.evaluate((element, [name, after]) => getComputedStyle(element, after ?? null).getPropertyValue(name!).trim(), [property, pseudo] as const);

// The glide's path between months is by eye, and where it sets out from is glideStart's table in
// calendar.test.ts; reading it frame by frame, or stopping it mid-way with the wheel, went (D416).
test('paging lands on the month it went to, N N N chaining on to January; Month from Week lands at once', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const title = page.locator('.hd-title');
    assert.equal(await scrollTop(page), top('2026-10'));

    await page.keyboard.press('n');
    await until('N lands on November', () => scrollTop(page), value => value === top('2026-11'));
    await until('the title reads November', () => title.textContent(), text => text === 'November 2026');
    await page.keyboard.press('p');
    await until('P lands on October', () => scrollTop(page), value => value === top('2026-10'));
    // N N N mid-glide goes on from where it's going: January.
    await page.keyboard.press('n');
    await page.keyboard.press('n');
    await page.keyboard.press('n');
    await until('N N N land on January', () => scrollTop(page), value => value === top('2027-01'));
    await page.keyboard.press('t');
    await until('T lands on October 2026', () => scrollTop(page), value => value === top('2026-10'));

    // A jump stays instant: Week, then Month again, lands on the selected day's month in one frame.
    await page.keyboard.press('w');
    await page.locator('.cal-week').waitFor();
    await page.keyboard.press('m');
    await page.locator('.cal-month').waitFor();
    assert.equal(await scrollTop(page), top('2026-10'), 'Month from Week lands at once');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A segmented control's thumb: where it sits and how wide, and the `on` segment's box. */
const thumb = (seg: Locator) => seg.evaluate(element => {
  const on = element.querySelector<HTMLElement>(':scope > .on')!;
  const style = getComputedStyle(element, '::before');
  return {x: Math.round(new DOMMatrix(style.transform).e), width: Math.round(parseFloat(style.width)), shown: style.visibility, on: [on.offsetLeft, on.offsetWidth] as [number, number], onFill: getComputedStyle(on).backgroundColor};
});

// The thumb's slide from one segment to the next is by eye (D416), and ui/Segmented's component test's: each page as it loads.
test('a segmented control\'s thumb waits under the segment that\'s on, as its one fill: Month, and Week', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const seg = page.locator('.hd .seg');
    const month = await rested(() => thumb(seg));
    assert.deepEqual([month.x, month.width], month.on, 'the thumb waits under Month');
    await page.goto(`${setpoint.base}/calendar?view=week`);
    await page.locator('.cal-week').waitFor();
    const week = await rested(() => thumb(seg));
    assert.deepEqual([week.x, week.width, week.shown, week.onFill], [...week.on, 'visible', 'rgba(0, 0, 0, 0)'], 'under Week, the segment drawing no fill of its own');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-211: Tab and Shift-Tab step Month | Week from anywhere, wrapping; in the editor Tab is its own', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-month').waitFor();
    assert.equal(await page.locator('.hd .seg').getAttribute('data-tip'), 'Tab · ⇧Tab');
    await page.keyboard.press('Tab');
    await page.locator('.cal-week').waitFor();
    await page.keyboard.press('Tab');
    await page.locator('.cal-month').waitFor();
    await page.keyboard.press('Shift+Tab');
    await page.locator('.cal-week').waitFor();
    await page.keyboard.press('Shift+Tab');
    await page.locator('.cal-month').waitFor();

    // A new event: Tab moves on from the line to the editor's next field, and the grid stays Month.
    await page.keyboard.press('c');
    const line = page.getByRole('textbox', {name: 'Describe the event'});
    await until('the line focused', () => line.evaluate(element => element === document.activeElement), focused => focused);
    await page.keyboard.press('Tab');
    await until('focus moved on in the editor', () => page.evaluate(() => [document.activeElement?.closest('.editor') !== null, document.activeElement?.getAttribute('aria-label')]),
      ([inEditor, label]) => inEditor === true && label !== 'Describe the event');
    assert.equal(await page.locator('.hd .seg .on').textContent(), 'Month');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

const opacity = (target: Locator, pseudo?: string) => style(target, 'opacity', pseudo);

test('a day answers the pointer with `sub` at 55% over its tints and offers + to make an event on it; a week\'s head answers too, and its empty hours show where a press would start', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();

    // Thursday the 15th under the pointer: its wash shows, and its +.
    const cell = page.locator('.cell[data-date="2026-10-15"]');
    const plus = cell.locator('.dadd');
    assert.deepEqual([await rested(() => opacity(cell, '::before')), await rested(() => opacity(plus))], ['0', '0'], 'nothing at rest');
    await cell.hover({position: {x: 70, y: 150}});
    await until('the day answers', async () => [await opacity(cell, '::before'), await opacity(plus)], values => values.join() === '1,1');
    assert.equal(await rested(() => style(cell, 'background-color', '::before')), await rested(() => colour(page, 'color-mix(in srgb, var(--sub) 55%, transparent)')));

    // Its + takes `sub2` under the pointer, and a click makes an event on that day, selecting it.
    await cell.hover({position: {x: 70, y: 150}});
    await plus.hover();
    const sub2 = await rested(() => colour(page, '--sub2'));
    await until('the + answers', () => style(plus, 'background-color'), fill => fill === sub2);
    await plus.click();
    await page.locator('.editor').waitFor();
    await until('Thu, Oct 15 is selected', () => cell.getAttribute('class'), classes => !!classes?.split(' ').includes('sel'));
    assert.equal(await page.getByLabel('Date', {exact: true}).inputValue(), 'Thu, Oct 15');
    await page.keyboard.press('Escape');
    await page.locator('.editor').waitFor({state: 'detached'});

    // Week: a head answers as a day does.
    await page.keyboard.press('w');
    const head = page.locator('.wk-dhead[data-date="2026-10-13"]');
    await head.hover();
    await until('the head answers', () => opacity(head, '::before'), value => value === '1');

    // The empty hours: the 15-minute step under the pointer, as a 30-minute slot with + and its time.
    const column = page.locator('.wk-col[data-date="2026-10-14"]');
    const box = (await rested(() => column.boundingBox()))!;
    await page.mouse.move(box.x + 60, box.y + minuteTop(10 * 60 + 40) * ZOOM);
    const slot = column.locator('.wk-hover');
    await until('10:30 AM under the pointer', () => slot.textContent(), text => text === '10:30 AM');
    // A step further down it moves there.
    await page.mouse.move(box.x + 60, box.y + minuteTop(10 * 60 + 50) * ZOOM);
    await until('10:45 AM', () => slot.textContent(), text => text === '10:45 AM');
    // Over a block, or off the hours, it goes.
    const gym = page.locator('.wb', {hasText: 'Gym'}).first();
    await gym.hover();
    await until('gone over Gym', () => page.locator('.wk-hover').evaluateAll(slots => slots.map(one => one.className)), classes => classes.every(name => name.includes('gone')));
    // Reaching Gym may have scrolled the hours.
    const again = (await column.boundingBox())!;
    await page.mouse.move(again.x + 60, again.y + minuteTop(11 * 60 + 10) * ZOOM);
    await until('back on empty hours', () => page.locator('.wk-hover:not(.gone)').textContent(), text => text === '11:00 AM');
    await page.mouse.move(800, 28);
    await until('gone off the hours', () => page.locator('.wk-hover:not(.gone)').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A colour expression as `target` computes it (so its own `--c` applies), on a probe inside it. */
const colourIn = (target: Locator, css: string) => target.evaluate((element, value) => {
  const probe = document.createElement('span');
  probe.style.color = value;
  element.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, css);

test('the pane lifts the next event on a tint of its colour with "in 5h" in it; under way it says what\'s left; past ones are grey; the now-line has the week\'s dot on the colour bars', async () => {
  // The server's clock holds at 9:12 AM; the page's is the check's, moved on to 2:45 PM.
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/calendar`);
    const dentist = page.locator('.rpane .ag-item', {hasText: 'Dentist'});
    const gym = page.locator('.rpane .ag-item', {hasText: 'Gym'});
    await dentist.waitFor();
    // Stopped within 9:12 AM, so the minutes read below are the check's, not the machine's.
    await pauseClock(page);

    // 9:12 AM: Dentist is next, lifted: its colour at 9%, its time `ink`, "in 5h" in its colour.
    assert.equal(await dentist.getAttribute('class'), 'ag-item next');
    assert.equal(await rested(() => style(dentist, 'background-color')), await rested(() => colourIn(dentist, 'color-mix(in oklch, var(--c) 9%, transparent)')));
    assert.equal(await rested(() => style(dentist.locator('.when'), 'color')), await rested(() => colour(page, '--ink')));
    const left = dentist.locator('.in');
    assert.equal(await left.textContent(), 'in 5h');
    assert.equal(await rested(() => style(left, 'color')), await rested(() => colourIn(dentist, 'oklch(from var(--c) min(l, var(--tintL)) c h)')));
    // Its bar lines up with the others': the content keeps the rows' 20 px inset.
    const [dentistBar, gymBar] = [(await dentist.locator('.cbar').boundingBox())!, (await gym.locator('.cbar').boundingBox())!];
    assert.ok(Math.abs(dentistBar.x - gymBar.x) < 0.5, `Dentist's bar at ${dentistBar.x}, Gym's at ${gymBar.x}`);

    // Gym is over: grey, not faded.
    assert.deepEqual([await style(gym, 'opacity'), await style(gym.locator('.title'), 'color'), await style(gym.locator('.when'), 'color')], ['1', await colour(page, '--ink3'), await colour(page, '--ink3')]);

    // The now-line: its dot centred on the colour bars.
    const line = page.locator('.rpane .nowline .line');
    const dot = await rested(() => line.evaluate(element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element, '::before');
      // Its offsets are in the page's pixels, the box in the window's.
      const zoom = (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom ?? 1;
      return box.left + (parseFloat(style.left) + parseFloat(style.width) / 2) * zoom;
    }));
    assert.ok(Math.abs(dot - (gymBar.x + gymBar.width / 2)) < 0.5, `the dot sits on the bars: ${dot}, the bars' middle ${gymBar.x + gymBar.width / 2}`);

    // 2:45 PM: Dentist is under way, "45m left".
    await page.clock.fastForward((5 * 60 + 33) * 60_000);
    await until('the now-line at 2:45 PM', () => page.locator('.nowline .t').textContent(), time => time === '2:45 PM');
    await until('Dentist under way', () => dentist.getAttribute('class'), classes => classes === 'ag-item next ongoing');
    assert.equal(await left.textContent(), '45m left');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('each word typed lands in its field: the rows it fills take its colour, and a mark being typed is only dashed until it\'s picked', async () => {
  const setpoint = await startSetpoint({fixtures: ['no-dinner'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    await page.keyboard.press('c');
    const line = page.getByLabel('Describe the event');
    await line.waitFor();
    const icon = (name: string) => page.locator(`.editor .eg > .icon:has(path[d="${ICONS[name as keyof typeof ICONS]}"])`);
    const [cool, comf, ink3] = [await rested(() => colour(page, '--cool')), await rested(() => colour(page, '--comf')), await rested(() => colour(page, '--ink3'))];
    assert.equal(await rested(() => style(icon('schedule'), 'color')), ink3, 'nothing from the line yet');

    await line.pressSequentially('Dinner with Sam fri 7-9pm @Blue');
    await page.locator('.places .menu-i', {hasText: 'Blue Door'}).first().waitFor();
    // The time row came from the line: its clock in the mark's `cool`.
    await until('the clock echoes the date', () => style(icon('schedule'), 'color'), value => value === cool);
    // "@Blue", its Places open, is still being typed: only a dashed underline.
    const place = page.locator('.nl .tok-p');
    assert.match((await place.getAttribute('class'))!, /\blive\b/);
    assert.deepEqual([await rested(() => style(place, 'background-color')), await rested(() => style(place, 'background-size'))], ['rgba(0, 0, 0, 0)', '6px 1.5px']);
    // Enter picks it: a normal mark again; the pin takes `comf`.
    await page.keyboard.press('Enter');
    await page.locator('.nl .tok-p', {hasText: '@Blue Door'}).waitFor();
    await until('the pin echoes the place', () => style(icon('location_on'), 'color'), value => value === comf);

    // A time set by hand: the clock is `ink3` again.
    await page.getByLabel('Start', {exact: true}).fill('4p');
    await page.keyboard.press('Enter');
    await until('set by hand', () => style(icon('schedule'), 'color'), value => value === ink3);
    // An End before the start runs into the next day: End says "+1".
    await page.getByLabel('End', {exact: true}).fill('2p');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.editor .later').textContent(), '+1');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Which ticks play the done moment is playsDone's, a table in calendar.test.ts; the moment itself is by
// eye (D416).
test('ticking a task off keeps its project beside the spinner in the pane, and its card is drawn in its project\'s colour, struck through while Todoist hasn\'t answered', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // Pay rent (Oct 7) and Renew car registration (Oct 8), as the server has them.
    const task = async (title: string) => (await setpoint.api<{items: {title: string; done: boolean; command: unknown}[]}>('GET', '/items?from=2026-10-07&to=2026-10-09')).items.find(item => item.title === title)!;
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    // Todoist's answer is held, so the change waits.
    await page.route(/\/api\/items\/\d+\/complete$/, async route => {
      await held;
      await route.continue();
    });

    // The pane: Pay rent's ring. Waiting, it keeps "Home" beside the spinner.
    const row = page.locator('.rpane .ag-task', {hasText: 'Pay rent'});
    await row.getByRole('button', {name: 'Complete Pay rent'}).click();
    await row.getByRole('button', {name: 'Reopen Pay rent'}).waitFor();
    assert.deepEqual([await row.locator('.spin').count(), await row.locator('.project').textContent()], [1, 'Home']);
    // Todoist's answer is read at the server: on the screen it comes through the refetches, whose
    // timing the check doesn't depend on (SV-185). Reopen is manipulation.spec's S1.
    release();
    await until('Todoist has Pay rent', () => task('Pay rent'), item => item.done && !item.command);

    // A task's card: its ring in its project's colour, the project a dot in it, no Colour.
    await page.locator('.cell[data-date="2026-10-08"] .tk', {hasText: 'Renew car registration'}).click();
    const card = page.locator('.fd');
    await card.waitFor();
    const ring = card.locator('.fd-mark .ring');
    assert.equal(await ring.count(), 1);
    const gridRing = page.locator('.cell[data-date="2026-10-08"] .tk .ring');
    assert.equal(await rested(() => style(ring, 'border-top-color')), await rested(() => style(gridRing, 'border-top-color')), 'as the grid draws it');
    const dot = card.locator('.fact.project .fact-dot .dot');
    assert.deepEqual([await dot.count(), await card.getByRole('button', {name: 'Colour'}).count()], [1, 0]);
    assert.equal(await rested(() => style(dot, 'background-color')), await rested(() => style(gridRing, 'border-top-color')));
    // Complete: struck through in `ink3`, its mark at .5 while Todoist hasn't answered.
    let hold = () => {};
    const waiting = new Promise<void>(resolve => {
      hold = resolve;
    });
    await page.unroute(/\/api\/items\/\d+\/complete$/);
    await page.route(/\/api\/items\/\d+\/complete$/, async route => {
      await waiting;
      await route.continue();
    });
    const mark = card.locator('.fd-mark');
    await card.getByRole('button', {name: 'Complete'}).click();
    await card.locator('.fd-title.done').waitFor();
    assert.deepEqual([await rested(() => style(card.locator('.fd-title'), 'text-decoration-line')), await rested(() => style(card.locator('.fd-title'), 'color'))], ['line-through', await rested(() => colour(page, '--ink3'))]);
    assert.deepEqual([await rested(() => style(mark, 'opacity')), await card.locator('.card-h .spin').count()], ['0.5', 1]);
    hold();
    await until('Todoist has Renew car registration', () => task('Renew car registration'), item => item.done && !item.command);
    await page.unroute(/\/api\/items\/\d+\/complete$/);
    // Once it has, the card (its address keeps it open) loads struck through, its mark whole, no spinner.
    await page.reload();
    const settled = card.locator('.fd-layer.in');
    await settled.locator('.fd-title.done').waitFor();
    assert.deepEqual([await rested(() => style(settled.locator('.fd-mark'), 'opacity')), await settled.locator('.card-h .spin').count()], ['1', 0]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the mini-month marks the selected day `sub3` and the pointer `sub2`, stepping moves nothing under it, and a band marks the week; the date picker marks its choice most and today with a ring', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    await page.locator('.ev').first().waitFor();
    const mini = page.locator('.sb .mini');
    const day = (date: string) => mini.locator(`button[aria-label="${date}"]`);
    // The selected day: `sub3`, `ink` at 500; the pointer elsewhere `sub2`.
    const [sub3, ink] = [await colour(page, '--sub3'), await colour(page, '--ink')];
    await until('the selected day', async () => [await style(day('2026-10-09'), 'background-color'), await style(day('2026-10-09'), 'color'), await style(day('2026-10-09'), 'font-weight')].join(' '), value => value === `${sub3} ${ink} 500`);
    await day('2026-10-21').hover();
    const sub2 = await rested(() => colour(page, '--sub2'));
    await until('the pointer', () => style(day('2026-10-21'), 'background-color'), fill => fill === sub2);

    // Stepping: Calendars under it stays put.
    const calendars = async () => (await page.locator('.calrow').first().boundingBox())!.y;
    const before = await rested(() => calendars());
    for (let step = 0; step < 3; step += 1) await page.locator('.sb .mini-head').getByRole('button', {name: 'Next month'}).click();
    await page.locator('.sb .mini-head', {hasText: 'January 2027'}).waitFor();
    assert.equal(await rested(() => calendars()), before, 'January\'s six weeks move nothing');
    await page.locator('.sb .mini-head').getByRole('button', {name: 'Previous month'}).click();
    for (let step = 0; step < 2; step += 1) await page.locator('.sb .mini-head').getByRole('button', {name: 'Previous month'}).click();
    await page.locator('.sb .mini-head', {hasText: 'October 2026'}).waitFor();

    // Week: the shown week one band.
    await page.keyboard.press('w');
    await page.locator('.sb .mini .wk').first().waitFor();
    const band = page.locator('.sb .mini .wk');
    assert.deepEqual(await band.allTextContents(), ['4', '5', '6', '7', '8', '9', '10']);
    await until('the band fills in', () => style(band.nth(1), 'background-color'), fill => fill === sub2);
    await page.keyboard.press('m');
    await page.locator('.cal-month').waitFor();

    // The date picker: a task due Fri 9, its day the `accent` disc, today a ring.
    await page.keyboard.press('d');
    await page.getByLabel('Due date', {exact: true}).click();
    const sheet = page.locator('.datepop');
    await sheet.waitFor();
    const chosen = sheet.locator('button[aria-label="2026-10-09"]');
    assert.equal(await rested(() => style(chosen, 'background-color')), await rested(() => colour(page, 'color-mix(in oklch, var(--accent) 50%, transparent)')));
    const today = sheet.locator('button[aria-label="2026-10-07"]');
    assert.deepEqual([await rested(() => style(today, 'background-color')), await rested(() => style(today, 'color'))], ['rgba(0, 0, 0, 0)', await rested(() => colour(page, '--ink'))]);
    assert.equal(await rested(() => style(today, 'box-shadow')), `${await rested(() => colour(page, '--alert'))} 0px 0px 0px 1.5px inset`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a day picked answers in three places: its number\'s `sub3` disc, the mini-month\'s, and the pane; an empty day offers New event C and New task D as ghost rows', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();

    // Fri 9: its number on a `sub3` disc.
    await page.locator('.cell[data-date="2026-10-09"]').click({position: {x: 100, y: 150}});
    await until('Fri, Oct 9', () => page.locator('.rp-date').textContent(), title => title === 'Fri, Oct 9');
    const number = page.locator('.cell[data-date="2026-10-09"] .dn');
    assert.deepEqual([await rested(() => style(number, 'background-color')), await rested(() => style(number, 'color')), await rested(() => style(number, 'font-weight'))], [await rested(() => colour(page, '--sub3')), await rested(() => colour(page, '--ink')), '500']);
    const sub3 = await rested(() => colour(page, '--sub3'));
    await until('as the mini-month marks it', () => style(page.locator('.sb .mini button[aria-label="2026-10-09"]'), 'background-color'), fill => fill === sub3);
    // Mon 5: the pane follows.
    await page.locator('.cell[data-date="2026-10-05"]').click({position: {x: 100, y: 150}});
    await until('Mon, Oct 5', () => page.locator('.rp-date').textContent(), title => title === 'Mon, Oct 5');

    // An empty day: two dashed ghost rows, New event C and New task D; each opens the editor.
    await page.locator('.cell[data-date="2026-10-24"]').click({position: {x: 100, y: 150}});
    const ghosts = page.locator('.rpane .ag-ghost');
    await until('Sat, Oct 24\'s ghost rows', () => ghosts.allTextContents(), rows => rows.join() === 'New eventC,New taskD');
    await ghosts.first().hover();
    const sub = await rested(() => colour(page, '--sub'));
    await until('it answers the pointer', () => style(ghosts.first(), 'background-color'), fill => fill === sub);
    await ghosts.nth(1).click();
    await page.getByRole('form', {name: 'New task'}).waitFor();
    assert.equal(await page.getByLabel('Due date', {exact: true}).inputValue(), 'Sat, Oct 24');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a change on its way holds its chip at .5, and it settles once the server has it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    // The change waits at the server's door.
    await page.route(/\/api\/items\/\d+$/, async route => {
      if (route.request().method() === 'PATCH') await held;
      await route.continue();
    });
    const dentist = page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'});
    await dentist.click();
    await page.locator('.fd').getByRole('button', {name: 'Colour'}).click();
    await page.locator('.fd-swatches').getByRole('radio', {name: 'good'}).click();
    await page.keyboard.press('Escape');
    await until('on its way', () => dentist.getAttribute('class'), classes => classes === 'ev pending');
    // Held, it's at .5.
    await until('at .5', () => style(dentist, 'opacity'), value => value === '0.5');
    release();
    await until('settled', () => dentist.getAttribute('class'), value => value === 'ev');
    await page.unroute(/\/api\/items\/\d+$/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// The fold and the slide up are by eye (D416): the day's chips are read in order once each lands.
test('a deleted chip leaves its day, the ones under it taking its place, and ⌘Z brings it back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    // Stopped, so the delete's 6 s Undo lasts until the check moves the clock.
    await pauseClock(page);
    // A chip folding away is `.removing` until it's gone: the day is read without it.
    const day = page.locator('.cell[data-date="2026-10-15"] .ev:not(.removing)');
    const fair = day.filter({hasText: 'Career fair'});
    const order = () => day.evaluateAll(chips => chips.map(chip => chip.textContent!.includes('Career fair') ? 'fair' : chip.textContent!.includes('CS 101 lecture') ? 'lecture' : 'other'));
    assert.deepEqual((await order()).filter(chip => chip !== 'other'), ['fair', 'lecture']);

    // Delete: it goes, and the lecture takes its place.
    await fair.click();
    await page.locator('.fd').waitFor();
    await page.keyboard.press('Delete');
    await fair.waitFor({state: 'detached'});
    await until('the lecture takes its place', order, chips => chips.filter(chip => chip !== 'other').join() === 'lecture');

    // ⌘Z: it comes back, above the lecture again.
    await page.keyboard.press('Meta+z');
    await fair.waitFor();
    await until('the lecture back under it', order, chips => chips.filter(chip => chip !== 'other').join() === 'fair,lecture');
    // Past where its Undo would have ended: the delete it took back is never sent.
    await page.clock.runFor(UNDO_MS);
    await setpoint.idle();
    const listed = await setpoint.api<{items: {title: string}[]}>('GET', '/items?from=2026-10-15&to=2026-10-16');
    assert.equal(listed.items.filter(item => item.title === 'Career fair').length, 1, 'nothing was deleted');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a drag lands where it shows it will: the chip lifts at its own width, the day under it takes the item\'s colour with a slot where it would sort in, and the drop lands there', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    // Dentist (2:30 PM) over Thursday, where the CS 101 lecture (6 PM) and a task are.
    const dentist = page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'});
    const box = (await rested(() => dentist.boundingBox()))!;
    const thursday = page.locator('.cell[data-date="2026-10-08"]');
    const target = (await rested(() => thursday.boundingBox()))!;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    // Held until the press has shrunk it to .97 before it moves, as a slower hand does.
    await until('the press shrinks it', () => style(dentist, 'transform'), transform => transform === 'matrix(0.97, 0, 0, 0.97, 0, 0)');
    await page.mouse.move(box.x + 40, box.y + box.height / 2 + 10, {steps: 3});
    await page.mouse.move(target.x + target.width / 2, target.y + target.height - 30, {steps: 5});
    const lift = page.locator('.ev.lift');
    await lift.waitFor();
    // It lifts at its own width, not the press's .97 of it, however long it was held (its width in the
    // page's pixels, the box in the window's; subpixel layout, so to within 0.5 px).
    const lifted = await lift.evaluate(element => parseFloat(element.style.width)) * ZOOM;
    assert.ok(Math.abs(lifted - box.width) < 0.5, `the lifted chip is ${lifted} px wide, Dentist ${box.width}`);
    await until('Thursday is the target', () => thursday.getAttribute('class'), classes => !!classes?.split(' ').includes('drop'));
    const colourOf = (css: string) => thursday.evaluate((element, value) => {
      const probe = document.createElement('span');
      probe.style.color = value;
      element.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }, css);
    const [fill, ring] = [await rested(() => colourOf('color-mix(in oklch, var(--dc) 9%, transparent)')), `${await rested(() => colourOf('color-mix(in oklch, var(--dc) 55%, transparent)'))} 0px 0px 0px 1.5px inset`];
    await until('it takes Dentist\'s colour', async () => [await style(thursday, 'background-color'), await style(thursday, 'box-shadow')].join(' | '), value => value === `${fill} | ${ring}`);
    // The slot sorts in between Gym and the lecture.
    assert.deepEqual(await thursday.locator(':is(.ev, .tk)').evaluateAll(chips => chips.map(chip => (chip.classList.contains('slot') ? 'slot' : chip.textContent))),
      ['slot', '6 PMCS 101 lecture', 'Renew car registration']);

    await page.mouse.up();
    await page.locator('.cell[data-date="2026-10-08"] .ev:not(.pending)', {hasText: 'Dentist'}).waitFor();
    assert.equal(await thursday.getAttribute('class').then(classes => classes!.split(' ').includes('drop')), false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a calendar search dims what it doesn\'t match to .3 over 180 ms and lights its matches, every occurrence of a series; Esc brings the grid back', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const dentist = page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'});
    const gym = page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Gym'});
    const task = page.locator('.cell[data-date="2026-10-07"] .tk').first();
    await page.keyboard.press('/');
    await page.keyboard.type('dentist');
    await page.locator('.cal-search .cs-result', {hasText: 'Dentist'}).first().waitFor();
    await until('the rest dims to .3', async () => [await style(gym, 'filter'), await style(task, 'filter')].join(), value => value === 'opacity(0.3),opacity(0.3)');
    assert.equal(await dentist.getAttribute('class'), 'ev');
    assert.match(await rested(() => style(gym, 'transition')), /filter 0\.18s/);

    // A series: every Gym matches.
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('gym');
    await page.locator('.cal-search .cs-result', {hasText: 'Gym'}).first().waitFor();
    await until('Gym lights up, every occurrence', () => page.locator('.cal-grid .ev.unmatched', {hasText: 'Gym'}).count(), count => count === 0);
    assert.ok(await page.locator('.cal-grid .ev', {hasText: 'Gym'}).count() > 3);
    await until('Dentist dims', () => dentist.getAttribute('class'), classes => !!classes?.split(' ').includes('unmatched'));

    // Esc: the grid comes back.
    await page.keyboard.press('Escape');
    await until('nothing dims', () => page.locator('.cal-grid .unmatched').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
