// Mail feels finished (the polish audit's mail slice, darma SV-63; DESIGN.md › Decided while building
// #195–#219): rows fold text first, Done and Trash beat before the fold, groups open and close like
// drawers; the Today block's bar and its warming time, and the completion moment; the sidebar's
// folding accounts and rolling counts; All caught up; the rows' pin, sticky headers, code countdown
// and filtered account column; the reader's swap, code card and edge; search's reasons and chips;
// ⌘K's matches and the segmented control's thumb. Each single value stated once.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, point, readSecurity, startSetpoint, until, watch} from './harness.ts';

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

test('shell-06, motion-04: the Today event leads with its calendar\'s bar and warms as it nears; completing a task lands its check as every task\'s does and fades its title', async () => {
  // The server's clock holds at the seed's 9:12 AM; the page's is the check's, moved on to Dentist.
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/inbox`);
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.count(), count => count === 4);
    const dentist = lines.filter({hasText: 'Dentist'});
    const rent = lines.filter({hasText: 'Pay rent'});
    const left = (line: typeof dentist, selector: string) => line.locator(selector).evaluate(element => Math.round(element.getBoundingClientRect().left));

    // The bar: 3 × 14, radius 2, in Personal's `cool`, in the rings' 19 px column; the time lines up
    // with the task titles.
    const bar = dentist.locator('.evbar > i');
    assert.deepEqual(await bar.evaluate(element => {
      const style = getComputedStyle(element);
      return [style.width, style.height, style.borderRadius];
    }), ['3px', '14px', '2px']);
    assert.equal(await bar.evaluate(element => getComputedStyle(element).backgroundColor), await colourOf(page, '--cool'));
    assert.equal(await left(dentist, '.evbar'), await left(rent, '.check'));
    assert.equal(await left(dentist, '.t'), await left(rent, '.title'));

    // Completing Pay rent: its done check lands as every task's does (the shared ring-done, 120 ms), and
    // its title goes ink3 over 180 ms.
    await rent.getByRole('button', {name: 'Complete Pay rent'}).click();
    const check = rent.locator('.check .task-glyph.done');
    await check.waitFor();
    assert.deepEqual(await check.evaluate(element => [getComputedStyle(element).animationName, getComputedStyle(element).animationDuration, getComputedStyle(element).color]),
      ['ring-done', '0.12s', await colourOf(page, '--good')]);
    assert.equal(await rent.locator('.title').evaluate(element => getComputedStyle(element).transitionDuration), '0.18s');
    await page.clock.runFor(1000);
    await until('Pay rent folded away', () => rent.count(), count => count === 0);

    // At 9:12 AM "in 5h" is ink3; at 2:20 PM "in 10m" is caution 500; at 2:31 PM "now" is alert 500.
    const time = dentist.locator('.in');
    const look = async () => [await time.textContent(), ...await time.evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).fontWeight])];
    assert.deepEqual(await look(), ['in 5h', await colourOf(page, '--ink3'), '400']);
    await page.clock.fastForward((5 * 60 + 8) * 60_000);
    await until('in 10m', look, seen => seen[0] === 'in 10m');
    assert.deepEqual(await look(), ['in 10m', await colourOf(page, '--caution'), '500']);
    await page.clock.fastForward(11 * 60_000);
    await until('now', look, seen => seen[0] === 'now');
    assert.deepEqual(await look(), ['now', await colourOf(page, '--alert'), '500']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('shell-08, shell-11, motion-07: the accounts fold away on Calendar; counts roll; the attention pill swells on a rise, scales in from none and out at none', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    const nav = (name: string) => page.locator('.sb .nav', {hasText: name});
    const accounts = page.locator('.sb-accts');

    // The accounts fold over 180 ms on Calendar and the page's section fades in over 120 ms; folded,
    // Calendar sits 2 px under Inbox as it did.
    assert.match(await accounts.evaluate(element => getComputedStyle(element).transition), /grid-template-rows 0\.18s/);
    await nav('Calendar').click();
    await page.waitForURL(/\/calendar/);
    await until('the accounts folded', () => accounts.evaluate(element => element.getBoundingClientRect().height), height => height === 0);
    assert.equal(await accounts.evaluate(element => (element as HTMLElement).inert), true);
    const [inbox, calendar] = [(await nav('Inbox').boundingBox())!, (await nav('Calendar').boundingBox())!];
    assert.equal(calendar.y - (inbox.y + inbox.height), 2);
    assert.deepEqual(await page.locator('.sb .sb-sec').first().evaluate(element => [getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]), ['fade-in', '0.12s']);
    await nav('Inbox').click();
    await page.waitForURL(/\/inbox/);
    await until('the accounts back', () => accounts.evaluate(element => element.getBoundingClientRect().height), height => height > 100);

    // Done takes the pill from 3 to 2: the count rolls down (the 3 leaves below, the 2 comes from above), quietly.
    const pill = page.locator('.sb .apill');
    const count = pill.locator('.count');
    const rolls = await watch(count, 'data-dir');
    await point(page.locator('.arow', {hasText: 'Northwind Talent'}));
    await page.keyboard.press('h');
    await until('the pill reads 2', () => pill.textContent(), text => text === '2');
    await until('it rolled', rolls, seen => seen.includes(null));
    assert.deepEqual((await rolls()).filter(Boolean), ['down']);
    assert.equal(await pill.evaluate(element => element.getAnimations().filter(animation => !(animation instanceof CSSTransition)).length), 0, 'a fall doesn\'t swell it');
    // The group's count rolls with it.
    assert.equal(await page.locator('.list .gh.att .n').textContent(), '2');

    // Undo is a rise: the count rolls up and the pill swells to 1.22 at 40% over 260 ms.
    const swells = await page.evaluate(() => {
      const seen: string[] = [];
      const element = document.querySelector('.sb .apill')!;
      const original = element.animate.bind(element);
      element.animate = (frames, options) => {
        const timing = options as KeyframeAnimationOptions;
        seen.push(`${JSON.stringify(frames)} ${timing.duration} ${timing.easing}`);
        return original(frames, options);
      };
      (window as unknown as {swells: string[]}).swells = seen;
      return true;
    });
    assert.ok(swells);
    const risen = await watch(count, 'data-dir');
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await until('the pill reads 3', () => pill.textContent(), text => text === '3');
    await until('it rolled up', risen, seen => seen.includes('up'));
    assert.deepEqual(await page.evaluate(() => (window as unknown as {swells: string[]}).swells),
      ['[{"transform":"none"},{"transform":"scale(1.22)","offset":0.4},{"transform":"none"}] 260 cubic-bezier(.2,0,0,1)']);

    // Every attention email Done elsewhere: the pill scales out over 120 ms, then goes; one back scales it in from .6.
    const inbox2 = await setpoint.api<{groups: {group: string; rows: {id: number}[]}[]}>('GET', '/mail/inbox');
    const attention = inbox2.groups.find(group => group.group === 'attention')!.rows.map(row => row.id);
    const going = await watch(pill, 'class');
    for (const id of attention) await setpoint.api('POST', `/mail/messages/${id}/done`, {done: true});
    await until('the pill gone', () => pill.count(), number => number === 0);
    assert.ok((await going()).includes('apill num going'), 'it scaled out first');
    assert.deepEqual(await page.evaluate(() => {
      const probe = document.querySelector('.sb .nav')!.appendChild(document.createElement('span'));
      probe.className = 'apill going';
      const style = getComputedStyle(probe);
      const seen = [style.animationName, style.animationDuration];
      probe.remove();
      return seen;
    }), ['apill-out', '0.12s']);
    await setpoint.api('POST', `/mail/messages/${attention[0]}/done`, {done: false});
    await until('the pill back', () => pill.count(), number => number === 1);
    assert.deepEqual(await pill.evaluate(element => [element.className, getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]), ['apill num arriving', 'apill-in', '0.18s']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('states-10, inbox-08: All caught up is three rows: the mark settling in at 44 px, the line, then Open All with its U', async () => {
  const setpoint = await startSetpoint();
  try {
    await readSecurity(setpoint);
    await setpoint.api('POST', '/mail/mark-all-read', {});
    await until('Mark all as read confirmed', () => setpoint.api<MailCountsOut>('GET', '/mail/counts'), counts => counts.unread_fyi === 0);
    const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
    for (const row of inbox.groups.find(group => group.group === 'attention')!.rows) await setpoint.api('POST', `/mail/messages/${row.id}/done`, {done: true});
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const empty = page.locator('.empty-line');
    await empty.waitFor();
    const mark = empty.locator('svg.mark.settle');
    const [box, line, button] = [(await mark.boundingBox())!, (await empty.locator('.t').boundingBox())!, (await empty.getByRole('button', {name: 'Open All'}).boundingBox())!];
    assert.deepEqual([box.width, box.height], [44, 44]);
    assert.equal(Math.round(line.y - (box.y + box.height)), 14);
    assert.equal(Math.round(button.y - (line.y + line.height)), 14);
    assert.ok(Math.abs((box.x + box.width / 2) - (button.x + button.width / 2)) < 1, 'centred, one above the other');
    assert.deepEqual(await empty.locator('.t').evaluate(element => [element.textContent, getComputedStyle(element).fontSize, getComputedStyle(element).fontWeight, getComputedStyle(element).color]),
      ['All caught up', '15px', '500', await colourOf(page, '--ink')]);
    assert.equal(await empty.locator('.btn .kbd').textContent(), 'U');
    // Each chip settles once, from 6 px above (3 of its 22 units), 70 ms apart; the line and the button fade in after 60 ms.
    assert.deepEqual(await mark.locator('g').evaluateAll(chips => chips.map(chip => {
      const style = getComputedStyle(chip);
      return [style.animationName, style.animationDuration, style.animationDelay, style.animationIterationCount];
    })), [['mark-settle', '0.26s', '0s', '1'], ['mark-settle', '0.26s', '0.07s', '1'], ['mark-settle', '0.26s', '0.14s', '1']]);
    assert.deepEqual(await empty.locator('.t').evaluate(element => [getComputedStyle(element).animationName, getComputedStyle(element).animationDuration, getComputedStyle(element).animationDelay]),
      ['fade-in', '0.18s', '0.06s']);
    // U opens All, as the button does.
    await page.keyboard.press('u');
    await page.waitForURL(/\/inbox\/all/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
