// How Calendar moves and answers (darma SV-64, the polish audit's calendar lane): paging glides the
// month and swaps the title the way it went, and the rest of the lane's motion and marks, each
// stated with the values DESIGN.md gives it.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {monthTopRow} from '../../src/logic/calendar.ts';
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

    // The wheel stops a glide where it is: N, two frames, then a wheel over the grid.
    const stopped = await page.evaluate(async () => {
      const scroller = document.querySelector('.cal-scroll')!;
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'n', bubbles: true}));
      await new Promise(next => requestAnimationFrame(() => requestAnimationFrame(next)));
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
    assert.deepEqual([first.onFill, await style(seg, 'visibility', '::before')], [await colour(page, '--sub3'), 'hidden']);
    assert.deepEqual([await style(seg, 'transition-property', '::before'), await style(seg, 'transition-duration', '::before')], ['transform, width', '0.18s, 0.18s']);
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
