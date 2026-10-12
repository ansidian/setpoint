// How Calendar moves and answers (darma SV-64, the polish audit's calendar lane): paging glides the
// month and swaps the title the way it went, and the rest of the lane's motion and marks, each
// stated with the values DESIGN.md gives it.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {monthTopRow} from '../../src/logic/calendar.ts';
import {minuteTop} from '../../src/logic/week.ts';
import {layout, monthPaging} from '../../src/tokens.ts';
import {cleanUp, startSetpoint, until, watch} from './harness.ts';

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
const scrollTop = (page: Page) => page.locator('.cal-scroll').evaluate(element => element.scrollTop);
const style = (target: Locator, property: string, pseudo?: string) => target.evaluate((element, [name, after]) => getComputedStyle(element, after ?? null).getPropertyValue(name!).trim(), [property, pseudo] as const);

/** Where the title's swap starts from, as [x, y] px: its `--title-from` drawn on a probe. */
const titleFrom = (title: Locator) => title.evaluate(element => {
  const probe = document.createElement('div');
  probe.style.transform = getComputedStyle(element).getPropertyValue('--title-from');
  document.body.append(probe);
  const matrix = new DOMMatrix(getComputedStyle(probe).transform);
  probe.remove();
  return [matrix.e, matrix.f];
});

/** Records the month grid's scrollTop every frame from now on; resolves to a reader of what it saw. */
async function recordScroll(page: Page): Promise<() => Promise<number[]>> {
  await page.evaluate(() => {
    const scroller = document.querySelector('.cal-scroll')!;
    const seen: number[] = [];
    (window as unknown as {seenScroll: number[]}).seenScroll = seen;
    const frame = () => {
      seen.push(scroller.scrollTop);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  return () => page.evaluate(() => [...(window as unknown as {seenScroll: number[]}).seenScroll]);
}

/** The values strictly between `from` and `to` a recording passed through, in order. */
const between = (seen: number[], from: number, to: number) => seen.filter(value => value > Math.min(from, to) && value < Math.max(from, to));
const monotonic = (values: number[], rising: boolean) => values.every((value, at) => at === 0 || (rising ? value >= values[at - 1]! : value <= values[at - 1]!));

test('paging glides the month over 260 ms the way it goes, N N N chaining; Today from a year away glides in its last five rows; the wheel stops it; the title rises, falls or slides', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const title = page.locator('.hd-title');
    assert.equal(await scrollTop(page), top('2026-10'));
    assert.equal(await title.getAttribute('data-dir'), null, 'the first paint doesn\'t swap');

    // N: November comes up from below, through the rows between, over 260 ms.
    let seen = await recordScroll(page);
    await page.keyboard.press('n');
    await until('N lands on November', () => scrollTop(page), value => value === top('2026-11'));
    const down = between(await seen(), top('2026-10'), top('2026-11'));
    assert.ok(down.length >= 3, `it passes through the rows between: ${JSON.stringify(down)}`);
    assert.ok(monotonic(down, true), 'downward all the way');
    await until('the title reads November', () => title.textContent(), text => text === 'November 2026');
    // It rises 6 px into place over 120 ms.
    assert.deepEqual([await title.getAttribute('data-dir'), await style(title, 'animation-name'), await style(title, 'animation-duration'), await titleFrom(title)],
      ['next', 'cal-title-in', `${monthPaging.titleMs / 1000}s`, [0, monthPaging.titleShiftPx]]);

    // P: October drops in from above.
    seen = await recordScroll(page);
    await page.keyboard.press('p');
    await until('P lands on October', () => scrollTop(page), value => value === top('2026-10'));
    const up = between(await seen(), top('2026-10'), top('2026-11'));
    assert.ok(up.length >= 3 && monotonic(up, false), `upward through the rows between: ${JSON.stringify(up)}`);
    await until('the title reads October', () => title.textContent(), text => text === 'October 2026');
    assert.deepEqual([await title.getAttribute('data-dir'), await titleFrom(title)], ['prev', [0, -monthPaging.titleShiftPx]]);

    // N N N mid-glide goes on from where it's going: January, never back.
    seen = await recordScroll(page);
    await page.keyboard.press('n');
    await page.keyboard.press('n');
    await page.keyboard.press('n');
    await until('N N N land on January', () => scrollTop(page), value => value === top('2027-01'));
    const chained = (await seen()).filter(value => value >= top('2026-10'));
    assert.ok(monotonic(chained, true), `one glide on, never back: ${JSON.stringify(chained)}`);

    // Today from a year on: it jumps to five rows below October, then glides up those five.
    await page.locator('.cal-scroll').evaluate((element, to) => {
      element.scrollTop = to;
    }, top('2027-10'));
    await until('October 2027 shows', () => title.textContent(), text => text === 'October 2027');
    seen = await recordScroll(page);
    await page.keyboard.press('t');
    await until('T lands on October 2026', () => scrollTop(page), value => value === top('2026-10'));
    const near = (await seen()).filter(value => value < top('2027-10'));
    assert.ok(near.every(value => value <= top('2026-10') + monthPaging.leadRows * ROW), `it sets out five rows short: ${JSON.stringify(near)}`);
    assert.ok(between(near, top('2026-10'), top('2026-10') + monthPaging.leadRows * ROW + 1).length >= 3 && monotonic(near, false), 'and glides up from there');

    // The wheel stops a glide where it is: N, the glide's first step, then a wheel over the grid.
    const stopped = await page.evaluate(async () => {
      const scroller = document.querySelector('.cal-scroll')!;
      const from = scroller.scrollTop;
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'n', bubbles: true}));
      for (let frame = 0; frame < 300 && scroller.scrollTop === from; frame += 1) await new Promise(next => requestAnimationFrame(next));
      scroller.dispatchEvent(new WheelEvent('wheel', {bubbles: true}));
      return scroller.scrollTop;
    });
    // Nothing should move once stopped: two glides' worth of frames.
    await page.waitForTimeout(monthPaging.glideMs * 2);
    await setpoint.idle();
    assert.ok(stopped > top('2026-10') && stopped < top('2026-11'), `stopped on its way (${stopped})`);
    assert.equal(await scrollTop(page), stopped, 'and stays there, short of November');

    // A jump stays instant: Week, then Month again, lands on the selected day's month in one frame.
    await page.keyboard.press('w');
    await page.locator('.cal-week').waitFor();
    const weekTitle = page.locator('.hd-title');
    assert.equal(await weekTitle.getAttribute('data-dir'), null, 'a switch of view just shows');
    // The week's title slides 6 px with its days.
    await page.keyboard.press('n');
    await until('the next week', () => weekTitle.textContent(), text => text === 'Oct 11 – 17, 2026');
    assert.deepEqual([await weekTitle.getAttribute('data-dir'), await titleFrom(weekTitle)], ['next', [monthPaging.titleShiftPx, 0]]);
    await page.keyboard.press('p');
    await until('back a week', () => weekTitle.textContent(), text => text === 'Oct 4 – 10, 2026');
    assert.deepEqual(await titleFrom(weekTitle), [-monthPaging.titleShiftPx, 0]);
    await page.keyboard.press('m');
    await page.locator('.cal-month').waitFor();
    assert.equal(await scrollTop(page), top('2026-10'), 'Month from Week lands at once');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** Records, from now on, the grid's scrollTop each time a disc of today's starts to pulse, and which. */
async function recordPulses(page: Page): Promise<() => Promise<{where: string; scrollTop: number | null}[]>> {
  await page.evaluate(() => {
    const seen: {where: string; scrollTop: number | null}[] = [];
    (window as unknown as {pulses: typeof seen}).pulses = seen;
    new MutationObserver(records => {
      records.forEach((record, at) => {
        const element = record.target as HTMLElement;
        // Each record holds the value before its change; the next one's for the element, or the current, is after it.
        const next = records.slice(at + 1).find(later => later.target === element);
        const after = next ? next.oldValue : element.getAttribute('class');
        if (!after?.split(' ').includes('pulse') || record.oldValue?.split(' ').includes('pulse')) return;
        const where = element.closest('.mini') ? 'mini' : element.closest('.wk-dhead') ? 'week' : 'month';
        seen.push({where, scrollTop: document.querySelector('.cal-scroll')?.scrollTop ?? null});
      });
    }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true});
  });
  return () => page.evaluate(() => [...(window as unknown as {pulses: {where: string; scrollTop: number | null}[]}).pulses]);
}

test('T always answers: today\'s disc on the grid and in the mini-month swells once over 260 ms as Today lands, and in the week\'s heads', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const disc = page.locator('.cell .dn.today');

    // Today already in view: nothing to scroll, the discs answer at once.
    let pulses = await recordPulses(page);
    await page.keyboard.press('t');
    await until('the grid\'s and the mini-month\'s discs pulse', async () => (await pulses()).map(pulse => pulse.where).sort().join(), where => where === 'mini,month');
    assert.deepEqual([await style(disc, 'animation-name'), await style(disc, 'animation-duration')], ['today-pulse', '0.26s']);
    await until('it plays once and lets go', () => disc.getAttribute('class'), classes => !classes?.split(' ').includes('pulse'));

    // From November, only once the glide has landed back on October.
    await page.keyboard.press('n');
    await until('November', () => scrollTop(page), value => value === top('2026-11'));
    pulses = await recordPulses(page);
    await page.keyboard.press('t');
    await until('the grid\'s disc pulses', async () => (await pulses()).filter(pulse => pulse.where === 'month').length, count => count === 1);
    assert.deepEqual((await pulses()).filter(pulse => pulse.where === 'month').map(pulse => pulse.scrollTop), [top('2026-10')], 'after the glide lands');

    // Paging doesn't.
    pulses = await recordPulses(page);
    await page.keyboard.press('p');
    await until('September', () => scrollTop(page), value => value === top('2026-09'));
    await page.keyboard.press('n');
    await until('October again', () => scrollTop(page), value => value === top('2026-10'));
    assert.deepEqual(await pulses(), []);

    // The week's head too.
    await page.keyboard.press('w');
    await page.locator('.wk-dhead .dn.today').waitFor();
    pulses = await recordPulses(page);
    await page.keyboard.press('t');
    await until('the week\'s disc pulses', async () => (await pulses()).map(pulse => pulse.where).join(), where => where.includes('week'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** Records how each Month or Week section put on the page from now on arrives: its data-enter, entrance and the y it scales from. */
async function recordEntrances(page: Page): Promise<() => Promise<{section: string; enter: string | null; animation: string; originY: number}[]>> {
  await page.evaluate(() => {
    const seen: {section: string; enter: string | null; animation: string; originY: number}[] = [];
    (window as unknown as {entrances: typeof seen}).entrances = seen;
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (!(node instanceof HTMLElement) || !node.matches('[data-cal-section]')) return;
      const style = getComputedStyle(node);
      seen.push({section: node.className.split(' ')[0]!, enter: node.dataset.enter ?? null, animation: `${style.animationName} ${style.animationDuration}`, originY: parseFloat(style.transformOrigin.split(' ')[1]!)});
    }))).observe(document.querySelector('.cal-content')!, {childList: true});
  });
  return () => page.evaluate(() => [...(window as unknown as {entrances: {section: string; enter: string | null; animation: string; originY: number}[]}).entrances]);
}

/** A segmented control's thumb: where it sits and how wide, and the `on` segment's box. */
const thumb = (seg: Locator) => seg.evaluate(element => {
  const on = element.querySelector<HTMLElement>(':scope > .on')!;
  const style = getComputedStyle(element, '::before');
  return {x: new DOMMatrix(style.transform).e, width: parseFloat(style.width), on: [on.offsetLeft, on.offsetWidth] as [number, number], onFill: getComputedStyle(on).backgroundColor};
});

test('Week zooms in from the selected week\'s row in Month and Month settles back out around it, over 180 ms; a segmented control\'s thumb slides to the segment that\'s on', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    // Wed Oct 7's week is October's second row: its middle is a row, the weekday row and half a row down.
    const row = layout.monthRow + layout.weekdayRow + layout.monthRow / 2;
    const seg = page.locator('.hd .seg');
    // At rest Month draws its own `sub3` fill, the thumb hidden under it.
    const first = await thumb(seg);
    assert.deepEqual([first.x, first.width], first.on, 'the thumb waits under Month');
    assert.deepEqual([first.onFill, await style(seg, 'visibility', '::before'), await style(seg, 'transition-property', '::before')], [await colour(page, '--sub3'), 'hidden', 'all']);
    // Sliding, it moves over 180 ms.
    assert.equal(await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.className = 'seg';
      probe.dataset.sliding = '';
      document.body.append(probe);
      const {transitionProperty, transitionDuration} = getComputedStyle(probe, '::before');
      probe.remove();
      return `${transitionProperty} ${transitionDuration}`;
    }), 'transform, width 0.18s, 0.18s');
    const sliding = await watch(seg, 'data-sliding');

    let entrances = await recordEntrances(page);
    await page.keyboard.press('w');
    const week = page.locator('.cal-week');
    await week.waitFor();
    assert.deepEqual(await entrances(), [{section: 'cal-week', enter: 'in', animation: 'cal-zoom-in 0.18s', originY: row}], 'it zooms in from the selected week\'s row');
    await until('the zoom lets go once it has played', () => week.getAttribute('data-enter'), value => value === null);
    await until('the thumb slides under Week, then hands the fill back', sliding, seen => seen.join() === ',');
    const after = await thumb(seg);
    assert.deepEqual([after.x, after.width, after.onFill], [...after.on, await colour(page, '--sub3')]);

    entrances = await recordEntrances(page);
    await page.keyboard.press('m');
    const month = page.locator('.cal-month');
    await month.waitFor();
    assert.deepEqual(await entrances(), [{section: 'cal-month', enter: 'out', animation: 'cal-zoom-out 0.18s', originY: row}], 'Month settles out around the same row');
    await until('the zoom lets go', () => month.getAttribute('data-enter'), value => value === null);
    // Paging doesn't zoom.
    await page.keyboard.press('n');
    await until('November', () => page.locator('.hd-title').textContent(), text => text === 'November 2026');
    assert.equal(await month.getAttribute('data-enter'), null);

    // Unread | All slides its thumb too.
    await page.goto(`${setpoint.base}/inbox`);
    const inbox = page.locator('.hd .seg');
    await inbox.locator('button', {hasText: 'Unread'}).waitFor();
    const inboxSliding = await watch(inbox, 'data-sliding');
    await inbox.locator('button', {hasText: 'All'}).click();
    await until('the thumb slides under All and hands it its fill', inboxSliding, seen => seen.join() === ',');
    const all = await thumb(inbox);
    assert.ok(all.on[0] > 2 && all.x === all.on[0] && all.width === all.on[1], 'under All');
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

    // Thursday the 15th under the pointer: its wash fades in over 120 ms, and its + shows.
    const cell = page.locator('.cell[data-date="2026-10-15"]');
    const plus = cell.locator('.dadd');
    assert.deepEqual([await opacity(cell, '::before'), await opacity(plus)], ['0', '0'], 'nothing at rest');
    await cell.hover({position: {x: 70, y: 150}});
    await until('the day answers', async () => [await opacity(cell, '::before'), await opacity(plus)], values => values.join() === '1,1');
    assert.deepEqual([await style(cell, 'background-color', '::before'), await style(cell, 'transition-duration', '::before')],
      [await colour(page, 'color-mix(in srgb, var(--sub) 55%, transparent)'), '0.12s']);
    assert.deepEqual([await plus.getAttribute('title'), await plus.locator('svg').getAttribute('width')], ['New event · C', '14']);
    // The selected day keeps its own fill.
    const selected = page.locator('.cell[data-date="2026-10-07"]');
    await selected.hover({position: {x: 70, y: 150}});
    // The wash of the day left fades out over 120 ms; the selected day's never shows.
    await page.waitForTimeout(250);
    assert.deepEqual([await opacity(selected, '::before'), await opacity(cell, '::before')], ['0', '0']);

    // Its + takes `sub2` under the pointer, and a click makes an event on that day, selecting it.
    await cell.hover({position: {x: 70, y: 150}});
    await plus.hover();
    const sub2 = await colour(page, '--sub2');
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
    const box = (await column.boundingBox())!;
    await page.mouse.move(box.x + 60, box.y + minuteTop(10 * 60 + 40));
    const slot = column.locator('.wk-hover');
    await until('10:30 AM under the pointer', () => slot.textContent(), text => text === '10:30 AM');
    await until('faded in', () => opacity(slot), value => value === '1');
    assert.deepEqual([await style(slot, 'height'), await style(slot, 'transform'), await style(slot, 'transition-duration'), await style(slot, 'animation-duration')],
      ['22px', `matrix(1, 0, 0, 1, 0, ${minuteTop(10 * 60 + 30)})`, '0.12s, 0.12s', '0.12s']);
    assert.equal(await style(slot, 'background-color'), await colour(page, '--sub'));
    // A step further down it moves there.
    await page.mouse.move(box.x + 60, box.y + minuteTop(10 * 60 + 50));
    await until('10:45 AM', () => slot.textContent(), text => text === '10:45 AM');
    // Over a block, or off the hours, it goes.
    const gym = page.locator('.wb', {hasText: 'Gym'}).first();
    await gym.hover();
    await until('gone over Gym', () => page.locator('.wk-hover').evaluateAll(slots => slots.map(one => one.className)), classes => classes.every(name => name.includes('gone')));
    // Reaching Gym may have scrolled the hours.
    const again = (await column.boundingBox())!;
    await page.mouse.move(again.x + 60, again.y + minuteTop(11 * 60 + 10));
    await until('back on empty hours', () => page.locator('.wk-hover:not(.gone)').textContent(), text => text === '11:00 AM');
    await page.mouse.move(800, 28);
    await until('gone off the hours', () => page.locator('.wk-hover:not(.gone)').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the week reads by its dates and its now: the date 14 / 500 `ink` on a 24 px disc, today\'s 24 px at 600, and now faintly across every day under today\'s line', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar?view=week`);
    await page.locator('.wb').first().waitFor();
    const date = page.locator('.wk-dhead[data-date="2026-10-08"] .dn');
    assert.deepEqual([await style(date, 'font-size'), await style(date, 'font-weight'), await style(date, 'height'), await style(date, 'min-width')], ['14px', '500', '24px', '24px']);
    assert.equal(await style(date, 'color'), await colour(page, '--ink'));
    const today = page.locator('.wk-dhead .dn.today');
    assert.deepEqual([await style(today, 'font-weight'), await style(today, 'height'), await style(today, 'min-width')], ['600', '24px', '24px']);
    assert.equal(await style(page.locator('.wk-dhead[data-date="2026-10-08"]'), 'column-gap'), '7px');
    // The weekday stays 11.5 uppercase `ink3`.
    assert.deepEqual([await style(page.locator('.wk-dhead[data-date="2026-10-08"] .dw'), 'font-size'), await style(page.locator('.wk-dhead[data-date="2026-10-08"] .dw'), 'text-transform')], ['11.5px', 'uppercase']);

    // Now across the week: one 1 px line at today's line's height, `alert` at 55%, under it.
    const across = page.locator('.wk-cols > .wk-nowx');
    const line = page.locator('.wk-now');
    assert.equal(await across.count(), 1);
    assert.equal(await style(across, 'top'), await style(line, 'top'));
    assert.deepEqual([await style(across, 'height'), await style(across, 'z-index'), await style(line, 'z-index')], ['1px', '2', '3']);
    assert.equal(await style(across, 'background-color'), await colour(page, 'color-mix(in oklch, var(--alert) 55%, transparent)'));
    const [columns, width] = [await page.locator('.wk-cols').boundingBox(), (await across.boundingBox())!.width];
    assert.equal(Math.round(width), Math.round(columns!.width), 'across all seven days');
    // Another week has none.
    await page.keyboard.press('n');
    await until('the next week', () => page.locator('.hd-title').textContent(), text => text === 'Oct 11 – 17, 2026');
    assert.equal(await page.locator('.wk-nowx').count(), 0);
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

test('the pane lifts the next event on a tint of its colour with "in 5h" in it; under way it sits under the now-line with what\'s left and its bar filling; past ones are grey; the now-line has the week\'s dot on the colour bars', async () => {
  // The server's clock holds at 9:12 AM; the page's is the check's, moved on to 2:45 PM.
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/calendar`);
    const dentist = page.locator('.rpane .ag-item', {hasText: 'Dentist'});
    const gym = page.locator('.rpane .ag-item', {hasText: 'Gym'});
    await dentist.waitFor();

    // 9:12 AM: Dentist is next, lifted: inset 8 px, radius 10, its colour at 9%, its time `ink`, "in 5h" in its colour at 12.5 / 500.
    assert.equal(await dentist.getAttribute('class'), 'ag-item next');
    assert.deepEqual([await style(dentist, 'margin-left'), await style(dentist, 'padding-left'), await style(dentist, 'border-top-left-radius')], ['8px', '12px', '10px']);
    assert.equal(await style(dentist, 'background-color'), await colourIn(dentist, 'color-mix(in oklch, var(--c) 9%, transparent)'));
    assert.equal(await style(dentist.locator('.when'), 'color'), await colour(page, '--ink'));
    const left = dentist.locator('.in');
    assert.deepEqual([await left.textContent(), await style(left, 'font-size'), await style(left, 'font-weight')], ['in 5h', '12.5px', '500']);
    assert.equal(await style(left, 'color'), await colourIn(dentist, 'oklch(from var(--c) min(l, var(--tintL)) c h)'));
    // Its bar lines up with the others': the content keeps the rows' 20 px inset.
    const [dentistBar, gymBar] = [(await dentist.locator('.cbar').boundingBox())!, (await gym.locator('.cbar').boundingBox())!];
    assert.equal(dentistBar.x, gymBar.x);

    // Gym is over: grey, not faded.
    assert.deepEqual([await style(gym, 'opacity'), await style(gym.locator('.title'), 'color'), await style(gym.locator('.when'), 'color')], ['1', await colour(page, '--ink3'), await colour(page, '--ink3')]);
    assert.equal(await style(gym.locator('.cbar'), 'background-color'), await colourIn(gym, 'color-mix(in oklch, var(--c) 45%, transparent)'));

    // The now-line: 1.5 px `alert` at full strength, an 8 px dot centred on the colour bars.
    const line = page.locator('.rpane .nowline .line');
    assert.deepEqual([await style(line, 'height'), await style(line, 'opacity'), await style(line, 'width', '::before'), await style(line, 'height', '::before')], ['1.5px', '1', '8px', '8px']);
    const dot = await line.evaluate(element => {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element, '::before');
      return box.left + parseFloat(style.left) + parseFloat(style.width) / 2;
    });
    assert.equal(dot, gymBar.x + gymBar.width / 2, 'the dot sits on the bars');

    // 2:45 PM: Dentist is under way, under the line, "45m left", its bar a quarter full.
    await page.clock.fastForward((5 * 60 + 33) * 60_000);
    await until('the now-line at 2:45 PM', () => page.locator('.nowline .t').textContent(), time => time === '2:45 PM');
    await until('Dentist under way', () => dentist.getAttribute('class'), classes => classes === 'ag-item next ongoing');
    assert.equal(await left.textContent(), '45m left');
    assert.equal(await style(dentist, '--done'), '25%');
    const order = await page.locator('.rpane .rp-scroll > *').evaluateAll(rows => rows.map(row => (row.classList.contains('nowline') ? 'now' : row.querySelector('.title')?.textContent ?? row.textContent)));
    assert.deepEqual(order.slice(0, 4), ['Events', 'Gym', 'now', 'Dentist'], 'under the now-line');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a calendar toggled off fades its chips and rows out over 120 ms before they go, and back in over 180 ms; off, its name is `ink3`; Todoist has no ring', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    const rows = page.locator('.calrow');
    assert.equal(await page.locator('.calrow', {hasText: 'Todoist'}).locator('.ring').count(), 0, 'Todoist reads as the others');
    assert.equal(await page.locator('.calrow .ring').count(), 0);
    const personal = rows.filter({hasText: 'Personal'});
    assert.equal(await style(personal, 'color'), await colour(page, '--ink2'));

    // Off: Wednesday's Gym chip and its agenda row fade out first, then go.
    const gym = page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Gym'});
    const row = page.locator('.rpane .ag-item', {hasText: 'Gym'});
    const [gymClass, rowClass] = [await watch(gym, 'class'), await watch(row, 'class')];
    await personal.click();
    await gym.waitFor({state: 'detached'});
    await row.waitFor({state: 'detached'});
    assert.ok((await gymClass()).some(value => value?.split(' ').includes('leaving')), 'the chip faded out first');
    assert.ok((await rowClass()).some(value => value?.split(' ').includes('leaving')), 'and its row');
    const ink3 = await colour(page, '--ink3');
    await until('the name recedes', () => style(personal, 'color'), value => value === ink3);

    // On: they come back fading in over 180 ms.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as {arrived: string[]}).arrived = seen;
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node instanceof HTMLElement) node.querySelectorAll<HTMLElement>('.ev, .ag-item').forEach(one => seen.push(`${one.className} ${getComputedStyle(one).animationName} ${getComputedStyle(one).animationDuration}`));
        if (node instanceof HTMLElement && node.matches('.ev, .ag-item')) seen.push(`${node.className} ${getComputedStyle(node).animationName} ${getComputedStyle(node).animationDuration}`);
      }))).observe(document.querySelector('.cal-content')!, {subtree: true, childList: true});
    });
    await personal.click();
    await gym.waitFor();
    const arrived = await page.evaluate(() => (window as unknown as {arrived: string[]}).arrived);
    assert.ok(arrived.some(line => /^ev .*entering ev-in 0\.18s$/.test(line)), `the chip fades in: ${JSON.stringify(arrived.slice(0, 4))}`);
    assert.ok(arrived.some(line => /^ag-item .*entering ev-in 0\.18s$/.test(line)), 'and its row');
    await until('it lets go of the fade', () => gym.getAttribute('class'), classes => !classes?.includes('entering'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('ticking a task off is one moment everywhere: its done check lands over 120 ms as the Today block\'s, the pane draws its strike over 180 ms and keeps its project beside the spinner, and its card is drawn in its project\'s colour', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
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
    const classes = await watch(row, 'class');
    await row.getByRole('button', {name: 'Complete Pay rent'}).click();
    await row.getByRole('button', {name: 'Reopen Pay rent'}).waitFor();
    assert.deepEqual([await row.locator('.spin').count(), await row.locator('.project').textContent()], [1, 'Home']);
    assert.deepEqual(await row.evaluate(element => [...element.children].slice(-2).map(child => child.className)), ['spin', 'ink3 project'], 'the spinner before the project');
    assert.ok((await classes()).some(value => value?.split(' ').includes('just-done')), 'it played the moment');
    const probe = (className: string, inner: string) => page.evaluate(([outer, child]) => {
      const host = document.createElement('a');
      host.className = outer!;
      host.innerHTML = child!;
      document.querySelector('.rpane .rp-scroll')!.append(host);
      const target = host.querySelector('[data-probe]')!;
      const {animationName, animationDuration} = getComputedStyle(target);
      host.remove();
      return `${animationName} ${animationDuration}`;
    }, [className, inner] as const);
    assert.equal(await probe('ag-item ag-task done just-done', '<span class="title"><span data-probe>Pay rent</span></span>'), 'strike-in 0.18s', 'the strike draws over 180 ms');
    assert.equal(await probe('ag-item ag-task done just-done', '<svg class="task-glyph done" data-probe></svg>'), 'ring-done 0.12s', 'the check lands as the Today block\'s');
    // At rest the strike is a 1 px line across the title.
    await until('the moment ends', () => row.getAttribute('class'), value => !value?.includes('just-done'));
    assert.equal(await style(row.locator('.title > span'), 'background-size'), '100% 1px');
    release();
    await until('Todoist has it', () => row.locator('.spin').count(), count => count === 0);
    // Reopened, it plays nothing.
    const again = await watch(row, 'class');
    await row.getByRole('button', {name: 'Reopen Pay rent'}).click();
    await row.getByRole('button', {name: 'Complete Pay rent'}).waitFor();
    assert.ok(!(await again()).some(value => value?.split(' ').includes('just-done')));
    await until('reopened at Todoist', () => row.locator('.spin').count(), count => count === 0);

    // A task's card: its ring in its project's colour, the project a dot in it, no Colour.
    await page.locator('.cell[data-date="2026-10-08"] .tk', {hasText: 'Renew car registration'}).click();
    const card = page.locator('.fd');
    await card.waitFor();
    const ring = card.locator('.fd-mark .ring');
    assert.equal(await ring.count(), 1);
    const gridRing = page.locator('.cell[data-date="2026-10-08"] .tk .ring');
    assert.equal(await style(ring, 'border-top-color'), await style(gridRing, 'border-top-color'), 'as the grid draws it');
    const dot = card.locator('.fact.project .fact-dot .dot');
    assert.deepEqual([await dot.count(), await style(dot, 'width'), await card.getByRole('button', {name: 'Colour'}).count()], [1, '9px', 0]);
    assert.equal(await style(dot, 'background-color'), await style(gridRing, 'border-top-color'));
    // Complete: struck through in `ink3`, its mark at .5 while Todoist hasn't answered, the check landing.
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
    const markClasses = await watch(mark, 'class');
    await card.getByRole('button', {name: 'Complete'}).click();
    await card.locator('.fd-title.done').waitFor();
    assert.deepEqual([await style(card.locator('.fd-title'), 'text-decoration-line'), await style(card.locator('.fd-title'), 'color')], ['line-through', await colour(page, '--ink3')]);
    assert.deepEqual([await style(mark, 'opacity'), await card.locator('.card-h .spin').count()], ['0.5', 1]);
    assert.ok((await markClasses()).some(value => value?.split(' ').includes('just-done')), 'its check lands');
    hold();
    await until('Todoist has it', () => style(mark, 'opacity'), value => value === '1');
    await page.unroute(/\/api\/items\/\d+\/complete$/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
