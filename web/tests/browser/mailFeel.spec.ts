// Mail feels finished (the polish audit's mail slice, darma SV-63; DESIGN.md › Decided while building
// #195–#219): rows fold text first, Done and Trash beat before the fold, groups open and close like
// drawers; the Today block's bar and its warming time, and the completion moment; the sidebar's
// folding accounts and rolling counts; All caught up; the rows' pin, sticky headers, code countdown
// and filtered account column; the reader's swap, code card and edge; search's reasons and chips;
// ⌘K's matches and the segmented control's thumb. Each single value stated once.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, point, startSetpoint, until} from './harness.ts';

after(cleanUp);

/** A background as the page computes it, mixes included. */
const backgroundOf = (page: Page, background: string) => page.evaluate(value => {
  const probe = document.createElement('div');
  probe.style.background = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return computed;
}, background);

/** A colour as the page computes it: a token (`--good`) or any colour. */
const colourOf = (page: Page, colour: string) => page.evaluate(value => {
  const probe = document.createElement('span');
  probe.style.color = value.startsWith('--') ? `var(${value})` : value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, colour);

interface Fold {
  fold: 'out' | 'in';
  text: string;
  classes: string;
  delay: number;
  duration: number;
  // Each keyframe's offset and opacity, as the fold plays them.
  frames: [number, string][];
  // The gutter's glyph and its colour while it beats.
  glyph: string | null;
}

/**
 * Records each fold in the list from now on: a row given `leaving` (folding out) or one added with a
 * fold in, with its fold's timing and keyframes, the classes it beats with, and its gutter's glyph.
 */
async function watchFolds(page: Page) {
  await page.evaluate(() => {
    const folds: Fold[] = [];
    (window as unknown as {folds: Fold[]}).folds = folds;
    const note = (element: Element, fold: 'out' | 'in') => {
      const animation = element.getAnimations().find(one => !(one instanceof CSSTransition) && !(one instanceof CSSAnimation));
      if (!animation) return;
      const timing = animation.effect!.getComputedTiming();
      const frames = (animation.effect as KeyframeEffect).getKeyframes().map((frame): [number, string] => [Number(frame.computedOffset.toFixed(2)), String(frame.opacity ?? '')]);
      const icon = element.querySelector('.ud > .icon');
      folds.push({fold, text: element.textContent ?? '', classes: element.className, delay: Number(timing.delay), duration: Number(timing.duration), frames,
        glyph: icon ? getComputedStyle(icon).color : null});
    };
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes') {
          const [now, was] = [(record.target as Element).classList.contains('leaving'), (record.oldValue ?? '').split(' ').includes('leaving')];
          // Leaving, or back while it still folded out (the same row, folding in again).
          if (now !== was) note(record.target as Element, now ? 'out' : 'in');
        }
        for (const node of record.addedNodes) if (node instanceof HTMLElement && !node.classList.contains('leaving')) note(node, 'in');
      }
    }).observe(document.querySelector('.content')!, {subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true});
  });
}

/** An element's turn in whole degrees, from its computed transform. */
const turn = (transform: string) => {
  const [a, b] = transform === 'none' ? [1, 0] : transform.slice(7, -1).split(',').map(Number) as [number, number];
  return Math.round(Math.atan2(b, a) * 180 / Math.PI);
};

const folds = (page: Page) => page.evaluate(() => (window as unknown as {folds: Fold[]}).folds);
const clearFolds = (page: Page) => page.evaluate(() => {
  (window as unknown as {folds: Fold[]}).folds.length = 0;
});
// A leaving row's text goes by 40% (72 ms of 180) before its height closes; an arriving row's comes
// in over the last 40% (inbox-06).
const LEAVING = [[0, '1'], [0.4, '0'], [1, '0']];
const ARRIVING = [[0, '0'], [0.6, '0'], [1, '1']];

test('inbox-05, -06, -14: a folding row\'s text goes first; Done and Trash beat for 120 ms before the fold; a group opens and closes like a drawer, its rows 12 ms apart', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    await watchFolds(page);
    const [good, alert] = [await colourOf(page, '--good'), await colourOf(page, '--alert')];

    // Done from the cursor: the row tints `good` 14% and its dot gives way to a 14 px check in `good`,
    // then it folds after the beat, its text first.
    const northwind = page.locator('.arow', {hasText: 'Northwind Talent'});
    await point(northwind);
    await page.keyboard.press('h');
    await until('Northwind folded', () => folds(page), list => list.some(fold => fold.fold === 'out'));
    const done = (await folds(page)).find(fold => fold.fold === 'out')!;
    assert.match(done.text, /Northwind Talent/);
    assert.ok(done.classes.split(' ').includes('beat-done'), done.classes);
    assert.deepEqual([done.delay, done.duration, done.frames, done.glyph], [120, 180, LEAVING, good]);
    assert.equal(await page.evaluate(() => {
      const probe = document.querySelector('.list')!.appendChild(document.createElement('div'));
      probe.className = 'arow beat-done';
      probe.style.transition = 'none';
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    }), await backgroundOf(page, 'color-mix(in oklch, var(--good) 14%, transparent)'));
    await until('Northwind gone', () => northwind.count(), count => count === 0);

    // Trash: `alert` 8% and a bin in `alert`.
    await clearFolds(page);
    const woodgrove = page.locator('.row', {hasText: 'Woodgrove Bank'});
    await point(woodgrove);
    await page.keyboard.press('e');
    await until('Woodgrove folded', () => folds(page), list => list.some(fold => fold.fold === 'out'));
    const trash = (await folds(page)).find(fold => fold.fold === 'out')!;
    assert.ok(trash.classes.split(' ').includes('beat-trash'), trash.classes);
    assert.deepEqual([trash.delay, trash.frames, trash.glyph], [120, LEAVING, alert]);
    assert.equal(await page.evaluate(() => {
      const probe = document.querySelector('.list')!.appendChild(document.createElement('div'));
      probe.className = 'row beat-trash';
      probe.style.transition = 'none';
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    }), await backgroundOf(page, 'color-mix(in oklch, var(--alert) 8%, transparent)'));
    // Undo folds it back in, its height first.
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await until('Woodgrove back', () => folds(page), list => list.some(fold => fold.fold === 'in' && /Woodgrove Bank/.test(fold.text)));
    const back = (await folds(page)).find(fold => fold.fold === 'in')!;
    assert.deepEqual([back.delay, back.duration, back.frames], [0, 180, ARRIVING]);

    // Collapsing Deliveries folds its rows out, 12 ms apart up to 60 and no beat; the one chevron turns to point right.
    await clearFolds(page);
    const deliveries = page.locator('.list .gh', {hasText: 'Deliveries'});
    const chevron = deliveries.locator('.chev .icon');
    assert.equal(await deliveries.locator('.chev .icon').count(), 1);
    assert.equal(await chevron.evaluate(icon => getComputedStyle(icon).transitionDuration), '0.12s');
    // Its rows: up to the next header.
    const rows = await deliveries.evaluate(header => {
      let count = 0;
      for (let next = header.nextElementSibling; next && !next.classList.contains('gh'); next = next.nextElementSibling) count += 1;
      return count;
    });
    const stagger = Array.from({length: rows}, (_, index) => Math.min(index * 12, 60));
    assert.ok(rows > 1);
    await deliveries.click();
    await page.locator('.list .gh.collapsed', {hasText: 'Deliveries'}).waitFor();
    await until('its rows folded', () => folds(page), list => list.filter(fold => fold.fold === 'out').length === rows);
    assert.deepEqual((await folds(page)).map(fold => [fold.fold, fold.delay, fold.frames, fold.classes.includes('beat')]), stagger.map(delay => ['out', delay, LEAVING, false]));
    await until('the chevron points right', async () => turn(await chevron.evaluate(icon => getComputedStyle(icon).transform)), degrees => degrees === -90);
    await until('they\'re gone', () => page.locator('.list .leaving').count(), count => count === 0);
    // Opening it folds them back in the same way.
    await clearFolds(page);
    await deliveries.click();
    await page.locator('.list .gh:not(.collapsed)', {hasText: 'Deliveries'}).waitFor();
    await until('its rows folded in', () => folds(page), list => list.filter(fold => fold.fold === 'in').length === rows);
    assert.deepEqual((await folds(page)).map(fold => [fold.fold, fold.delay, fold.frames]), stagger.map(delay => ['in', delay, ARRIVING]));
    await until('the chevron points down', async () => turn(await chevron.evaluate(icon => getComputedStyle(icon).transform)), degrees => degrees === 0);

    // Mark all as read: each group's rows fold 12 ms apart, up to 60.
    await clearFolds(page);
    await page.mouse.move(1, 1);
    await page.keyboard.press('Shift+I');
    await until('the read rows folded out', () => folds(page), list => list.filter(fold => fold.fold === 'out').length > 6);
    const delays = (await folds(page)).filter(fold => fold.fold === 'out').map(fold => fold.delay);
    assert.ok(delays.every(delay => delay % 12 === 0 && delay <= 60), delays.join(', '));
    assert.ok(delays.includes(12), delays.join(', '));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
