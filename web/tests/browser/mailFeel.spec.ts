// Mail feels finished (the polish audit's mail slice, darma SV-63; DESIGN.md › Decided while building
// #197–#219): rows fold text first, Done and Trash beat before the fold, groups open and close like
// drawers; the Today block's bar and its warming time, and the completion moment; the sidebar's
// folding accounts and rolling counts; All caught up; the rows' pin, sticky headers, code countdown
// and filtered account column; the reader's swap, code card and edge; search's reasons, chips and
// widening field; ⌘K's matches. Each single value stated once.
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

test('inbox-09, -10, -12: a pinned row keeps a keep glyph and a pin out of the shelf\'s sight says so; headers stay at the top; a filtered list drops the account', async () => {
  const setpoint = await startSetpoint();
  try {
    // A short window, so the list scrolls.
    const page = await setpoint.page({width: 1677, height: 560});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    const list = page.locator('.content > .list');
    const ink3 = await colourOf(page, '--ink3');

    // Headers stick to the top, each sliding over the last; J and K keep a row clear of them.
    assert.deepEqual(await page.locator('.list .gh').first().evaluate(header => [getComputedStyle(header).position, getComputedStyle(header).top, getComputedStyle(header).zIndex]), ['sticky', '0px', '2']);
    assert.equal(await list.evaluate(element => getComputedStyle(element).scrollPaddingTop), '30px');
    await list.evaluate(element => element.scrollBy(0, 300));
    const stuck = await page.evaluate(() => {
      const box = document.querySelector('.content > .list')!.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + 200, box.top + 15)?.closest('.gh');
      return top ? top.textContent : null;
    });
    assert.ok(stuck && !/^Pinned/.test(stuck), `a later group's header is on top: ${stuck}`);

    // P on Woodgrove Pay in Money, with the shelf scrolled away: its row keeps a 14 px keep-fill in
    // ink3 before its account, growing in; the toast says Pinned with its keep glyph, and Undo.
    const pay = page.locator('.row:not(.shelf)', {hasText: 'Woodgrove Pay'});
    await pay.scrollIntoViewIfNeeded();
    await point(pay);
    // What the row arriving on the shelf plays, as it arrives.
    await page.evaluate(() => {
      const landings: string[][] = [];
      (window as unknown as {landings: string[][]}).landings = landings;
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement) || !node.matches('.row.shelf')) return;
        landings.push(node.getAnimations().filter(animation => !(animation instanceof CSSTransition) && !(animation instanceof CSSAnimation)).map(animation => {
          const timing = animation.effect!.getComputedTiming();
          const first = (animation.effect as KeyframeEffect).getKeyframes()[0] as {backgroundColor?: string};
          // Its colour as the page computes it.
          const probe = document.body.appendChild(document.createElement('i'));
          probe.style.backgroundColor = first.backgroundColor ?? '';
          const colour = first.backgroundColor ? getComputedStyle(probe).backgroundColor : '';
          probe.remove();
          return `${timing.duration} ${timing.delay} ${colour}`;
        }));
      }))).observe(document.querySelector('.content > .list')!, {childList: true});
    });
    await page.keyboard.press('p');
    const mark = pay.locator('.pinmark');
    await mark.waitFor();
    assert.deepEqual(await mark.evaluate(element => [element.className, getComputedStyle(element).color, element.querySelector('svg')!.getAttribute('width'), getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]),
      ['pinmark new', ink3, '14', 'beat-in', '0.12s']);
    // Just before the account, the row's 10 px gap between them (its place, not its growing box).
    assert.equal(await pay.evaluate(row => {
      const [glyph, account] = [row.querySelector<HTMLElement>('.pinmark')!, row.querySelector<HTMLElement>('.ac')!];
      return account.offsetLeft - (glyph.offsetLeft + glyph.offsetWidth);
    }), 10);
    const toast = page.locator('.toast.pinned', {hasText: 'Pinned'});
    await toast.waitFor();
    assert.equal(await toast.locator('.tone .icon').evaluate(icon => getComputedStyle(icon).color), ink3);
    // It landed on the shelf: it folded in, then holds `sub3` and lets it go over 260 ms.
    await page.locator('.row.shelf', {hasText: 'Woodgrove Pay'}).waitFor();
    const sub3 = await backgroundOf(page, 'var(--sub3)');
    assert.deepEqual(await page.evaluate(() => (window as unknown as {landings: string[][]}).landings), [['180 0 ', `260 180 ${sub3}`]]);
    // Undo unpins it, and the toast goes.
    await toast.getByRole('button', {name: 'Undo'}).click();
    await until('unpinned', () => mark.count(), count => count === 0);
    await until('the toast gone', () => page.locator('.toast').count(), count => count === 0);

    // With the shelf in view, a pin needs no toast; an Attention row keeps its glyph before its account too.
    await list.evaluate(element => element.scrollTo(0, 0));
    const exams = page.locator('.arow', {hasText: 'Contoso University'});
    await point(exams);
    await page.keyboard.press('p');
    await exams.locator('.r1 .pinmark + .dot').waitFor();
    await setpoint.idle();
    assert.equal(await page.locator('.toast', {hasText: 'Pinned'}).count(), 0);

    // Filtered to Personal: no row repeats the account; the age keeps its column.
    await page.locator('.sb .acct', {hasText: 'Personal'}).click();
    await page.locator('.content.filtered').waitFor();
    await page.locator('.hd-title', {hasText: 'Inbox · Personal'}).waitFor();
    await page.locator('.content.filtered .list .row').first().waitFor();
    assert.deepEqual(await page.locator('.list .row .ac, .list .arow .r1 .dot, .list .arow .r1 .label').evaluateAll(parts => [...new Set(parts.map(part => getComputedStyle(part).display))]), ['none']);
    assert.ok(await page.locator('.list .row .age').first().isVisible());

    // All's day headings outrank its lanes: the day ink2, its date ink3.
    await page.locator('.sb .nav', {hasText: 'Inbox'}).click();
    await page.keyboard.press('u');
    const day = page.locator('.list.all .gh.day').first();
    await day.waitFor();
    assert.deepEqual([await day.evaluate(element => getComputedStyle(element).color), await day.locator('.date').evaluate(element => getComputedStyle(element).color)], [await colourOf(page, '--ink2'), ink3]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('reader-03, -04, -09: each email swaps in from the way the user stepped; a code is lifted into a card with Copy; the edge straddles the border with a grip', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    const swap = page.locator('.pane .rd-swap');
    const swapped = () => swap.evaluate(element => [element.getAttribute('data-swap'), getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]);

    // The first email arrives with the pane (its slide), not as a swap.
    await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.deepEqual(await swapped(), [null, 'none', '0s']);
    const tools = page.locator('.pane > .rd-tools');
    await tools.evaluate(element => element.setAttribute('data-first', ''));
    // J: up 8 px from below, over 180 ms; K: down from above; a click fades over 120 ms. The tools stay.
    await page.keyboard.press('j');
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    assert.deepEqual(await swapped(), ['next', 'rd-in-next', '0.18s']);
    await page.keyboard.press('k');
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.deepEqual(await swapped(), ['prev', 'rd-in-prev', '0.18s']);
    await page.locator('.row', {hasText: 'Contoso Insurance'}).click();
    await page.locator('.rd-subj', {hasText: 'Your code is 482913'}).waitFor();
    assert.deepEqual(await swapped(), ['fade', 'fade-in', '0.12s']);
    assert.equal(await page.locator('.pane > .rd-tools[data-first]').count(), 1, 'the tools never swap');
    assert.deepEqual(await page.evaluate(() => {
      const probe = document.querySelector('.pane .rd-scroll')!.appendChild(document.createElement('div'));
      probe.className = 'rd-swap';
      probe.dataset.swap = 'next';
      const frames = probe.getAnimations()[0] ? (probe.getAnimations()[0]!.effect as KeyframeEffect).getKeyframes().map(frame => [frame.opacity, frame.transform]) : [];
      probe.remove();
      return frames;
    }), [['0', 'translateY(8px)'], ['1', 'none']]);

    // The code email: a 56 px card after the sender, the code in Geist Mono 22 / 500 / .12em in two
    // groups, Copy, and its countdown at the right in ink3 12.5.
    const card = page.locator('.rd-head .code-card');
    await card.waitFor();
    assert.equal(await card.evaluate(element => element.previousElementSibling?.className), 'rd-meta');
    assert.deepEqual(await card.evaluate(element => {
      const style = getComputedStyle(element);
      return [style.height, style.paddingLeft, style.paddingRight, style.columnGap, style.borderTopLeftRadius];
    }), ['56px', '18px', '12px', '14px', '14px']);
    const code = card.locator('.code');
    assert.deepEqual(await code.evaluate(element => [element.textContent, getComputedStyle(element).fontSize, getComputedStyle(element).fontWeight, getComputedStyle(element).letterSpacing, getComputedStyle(element).fontFamily]),
      ['482 913', '22px', '500', '2.64px', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mono').trim())).replaceAll('\'', '"')]);
    const expiry = card.locator('.expiry');
    assert.match((await expiry.textContent())!, /^Expires in \d+ min$/);
    assert.deepEqual(await expiry.evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).fontSize]), [await colourOf(page, '--ink3'), '12.5px']);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    await card.getByRole('button', {name: 'Copy'}).click();
    await card.getByRole('button', {name: 'Copied'}).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '482913');

    // The edge: 10 px straddling the pane's border. Under the pointer, after 80 ms, its line and a
    // 14 × 28 grip at the pointer's height; a double-click puts the pane back to 680.
    const pane = (await page.locator('.pane').boundingBox())!;
    const edge = page.locator('.pane-edge');
    const lineColour = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.background = 'color-mix(in srgb, var(--ink) 26%, transparent)';
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    const box = (await edge.boundingBox())!;
    assert.deepEqual([box.x, box.width], [pane.x - 5, 10]);
    await page.mouse.move(pane.x, pane.y + 300);
    const grip = edge.locator('.grip');
    await until('the grip shows', () => grip.evaluate(element => getComputedStyle(element).opacity), opacity => opacity === '1');
    const [hover, line] = await edge.evaluate(element => [getComputedStyle(element.querySelector('.grip')!).transitionDelay, getComputedStyle(element, '::before').transitionDelay]);
    assert.deepEqual([hover, line], ['0.08s', '0.08s']);
    const held = (await grip.boundingBox())!;
    assert.deepEqual([held.width, held.height, Math.round(held.y + held.height / 2)], [14, 28, Math.round(pane.y + 300)]);
    assert.ok(Math.abs(held.x + held.width / 2 - (pane.x + 2)) <= 1, 'centred on the line by the border');
    // Its line, once its fade has ended.
    await until('the line in ink at 26%', () => edge.evaluate(element => getComputedStyle(element, '::before').backgroundColor),
      colour => colour === lineColour);
    await page.mouse.down();
    await page.mouse.move(pane.x - 100, pane.y + 300, {steps: 4});
    assert.equal(await edge.evaluate(element => element.classList.contains('dragging')), true);
    await page.mouse.up();
    await until('wider', async () => Math.round((await page.locator('.pane').boundingBox())!.width), width => width === 780);
    await edge.dblclick();
    await until('back to 680', async () => Math.round((await page.locator('.pane').boundingBox())!.width), width => width === 680);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('reader-10: a newsletter whose images give only their width keeps its shape while they\'re hidden', async () => {
  const setpoint = await startSetpoint({fixtures: ['newsletter-html']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    await page.locator('.imgbar', {hasText: 'Images hidden'}).waitFor();
    // Three 602-wide pictures at 150 each, their padding and the footer: never the ~100 px band it was.
    await until('the frame holds the newsletter', () => page.locator('.mailframe').evaluate(frame => frame.getBoundingClientRect().height), height => height > 450);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search-11, -13, -14, -15: a reason shows only when the row doesn\'t; no results are chips; the field widens with the panes; the answer\'s fact is underlined', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    // The field widens over 180 ms, and Unread | All fades out over 120 ms as the first key goes in.
    assert.match(await page.locator('.hd > .search').evaluate(field => getComputedStyle(field).transition), /width 0\.18s/);
    await page.evaluate(() => {
      const fades: string[] = [];
      (window as unknown as {fades: string[]}).fades = fades;
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement) || !node.classList.contains('seg')) return;
        fades.push(node.getAnimations().map(animation => {
          const frames = (animation.effect as KeyframeEffect).getKeyframes().map(frame => frame.opacity).join(' → ');
          return `${frames} ${animation.effect!.getComputedTiming().duration}`;
        }).join());
      }))).observe(document.querySelector('.hd')!, {childList: true});
    });
    await page.keyboard.press('/');
    await page.keyboard.type('north');
    await page.locator('.arow.result').first().waitFor();
    assert.deepEqual(await page.evaluate(() => (window as unknown as {fades: string[]}).fades), ['1 → 0 120']);
    // Free text in the highlighted sender: no why line, three lines a row.
    assert.equal(await page.locator('.arow.result').first().locator('.from mark.hl').count(), 1);
    assert.equal(await page.locator('.arow.result .why').count(), 0);

    // No results: each part is the field's own chip, with no dots between them; a Not chip keeps its Not.
    await page.locator('.search input').fill('northwind !confirmation zebra');
    await page.keyboard.press('Enter');
    const parts = page.locator('.no-results .part');
    await until('no results', () => parts.count(), count => count >= 2);
    assert.equal(await page.locator('.no-results .ink3').count(), 0);
    assert.deepEqual(await parts.first().evaluate(part => {
      const style = getComputedStyle(part);
      return [style.height, style.paddingLeft, style.paddingRight, style.borderTopLeftRadius, style.fontWeight];
    }), ['22px', '9px', '4px', '999px', '400']);
    assert.equal(await parts.first().evaluate(part => getComputedStyle(part).backgroundColor), await backgroundOf(page, 'var(--sub2)'));
    assert.equal(await page.locator('.no-results').evaluate(line => getComputedStyle(line).columnGap), '8px');
    const not = parts.filter({has: page.locator('.k')});
    if (await not.count()) assert.equal(await not.locator('.k').textContent(), 'Not');
    const before = await parts.count();
    await parts.last().getByRole('button').click();
    await until('a chip knocked off', () => parts.count(), count => count === before - 1);

    // The answer's key fact: underlined 2 px, 3 px under, in Night's `sun` at 70%.
    assert.deepEqual(await page.evaluate(() => {
      const answer = document.querySelector('.content')!.appendChild(document.createElement('p'));
      answer.className = 'ans';
      const fact = answer.appendChild(document.createElement('b'));
      const style = getComputedStyle(fact);
      const seen = [style.textDecorationLine, style.textDecorationThickness, style.textUnderlineOffset, style.textDecorationColor, style.fontWeight];
      answer.remove();
      return seen;
    }), ['underline', '2px', '3px', await colourOf(page, 'color-mix(in oklch, var(--sun) 70%, transparent)'), '500']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('shell-13: ⌘K marks what was typed', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();

    // ⌘K: "ne" marks News's Ne in ink at 600, no fill.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('ne');
    const mark = page.locator('.palette .item', {hasText: 'News'}).first().locator('mark');
    await mark.waitFor();
    assert.deepEqual(await mark.evaluate(element => [element.textContent, getComputedStyle(element).fontWeight, getComputedStyle(element).color, getComputedStyle(element).backgroundColor]),
      ['Ne', '600', await colourOf(page, '--ink'), 'rgba(0, 0, 0, 0)']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
