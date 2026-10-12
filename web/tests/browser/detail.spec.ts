// The floating detail in the browser (DESIGN.md › The floating detail and The glide; boards 12a,
// 12b, 12c and 12d): boards 12a, 12b and 12d at rest against their approved screenshots (Time to
// Leave is the time-to-leave fixture, decision D3), then the flows: open and close with Esc or the grid, a glide to another item that
// lands 8 px off it on its side, a click mid-glide that retargets without closing, a drag that
// leaves the card where it's dropped and the next glide starting there, and Edit handing over to
// the right pane.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {glidePosition, glideSegment, glideVelocity} from '../../src/logic/glide.ts';
import {cleanUp, matchGolden, startSetpoint, until, watch} from './harness.ts';

const GAP = 8;

after(cleanUp);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1000, 28);
  // Lets a hover fill the move left fade out (120 ms) before the screenshot.
  await page.waitForTimeout(250);
}

const card = (page: Page) => page.locator('.fd');
const chip = (page: Page, date: string, title: string) => page.locator(`.cell[data-date="${date}"] .ev`, {hasText: title});
const motion = (page: Page) => card(page).getAttribute('data-motion');
const atRest = (page: Page) => until('the card comes to rest', () => motion(page), state => state === 'rest');

/** The card's box relative to the month section, where the boards place it. */
async function cardAt(page: Page): Promise<{left: number; top: number; width: number; height: number}> {
  const section = (await page.locator('.cal-month').boundingBox())!;
  const box = (await card(page).boundingBox())!;
  return {left: Math.round(box.x - section.x), top: Math.round(box.y - section.y), width: Math.round(box.width), height: Math.round(box.height)};
}

/** At rest beside its item: 8 px off it on the side it says, centred on it unless an edge slid it. */
async function assertBeside(page: Page, item: Locator) {
  const side = await card(page).getAttribute('data-side');
  const box = (await card(page).boundingBox())!;
  const anchor = (await item.boundingBox())!;
  const grid = (await page.locator('.cal-scroll').boundingBox())!;
  if (side === 'right') assert.equal(Math.round(box.x - (anchor.x + anchor.width)), GAP);
  else if (side === 'left') assert.equal(Math.round(anchor.x - (box.x + box.width)), GAP);
  else if (side === 'above') assert.equal(Math.round(anchor.y - (box.y + box.height)), GAP);
  else assert.equal(Math.round(box.y - (anchor.y + anchor.height)), GAP);
  const centred = side === 'right' || side === 'left'
    ? Math.abs(box.y + box.height / 2 - (anchor.y + anchor.height / 2)) <= 1
    : Math.abs(box.x + box.width / 2 - (anchor.x + anchor.width / 2)) <= 1;
  const inside = box.x >= grid.x && box.y >= grid.y && box.x + box.width <= grid.x + grid.width && box.y + box.height <= grid.y + grid.height;
  assert.ok(inside, `the card stays inside the grid: ${JSON.stringify(box)}`);
  if (!centred) assert.ok(box.y <= grid.y + GAP + 1 || box.y + box.height >= grid.y + grid.height - GAP - 1, 'off-centre only where an edge slid it');
}

/** Where the engine has the card (its translate, relative to the month section). */
const placed = (page: Page) => card(page).evaluate(element => {
  const moved = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec((element as HTMLElement).style.transform)!;
  return {left: Number(moved[1]), top: Number(moved[2])};
});

/** Clicks `item` with the card open and waits for its glide there to land: until it starts, the card still rests where it was. */
async function glideTo(page: Page, item: Locator) {
  const motions = await watch(card(page), 'data-motion');
  await item.click();
  await until('the glide starts', motions, seen => seen.includes('glide'));
  await atRest(page);
}

async function openDentist(page: Page) {
  await chip(page, '2026-10-07', 'Dentist').click();
  await card(page).waitFor();
  await atRest(page);
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
    assert.deepEqual(await cardAt(page), {left: 159, top: 143, width: 280, height: 254});
    await assertBeside(page, chip(page, '2026-10-07', 'Dentist'));
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
    assert.equal(await card(page).locator('.fd-layer.in .fact.cal .icon').evaluate(icon => getComputedStyle(icon).color), await tint('var(--cool)'));
    assert.equal(await card(page).locator('.fd-layer.in .fact.cal span').evaluate(name => getComputedStyle(name).color), await tint('var(--ink2)'), 'its name stays ink2');
    await settle(page);
    await matchGolden(page, '12a-floating-detail-dentist', 'grid');
    // A recurring event's card says it's a series, after the attendees, as the repeat field words it (#126).
    await glideTo(page, chip(page, '2026-10-07', 'Gym'));
    assert.deepEqual(await card(page).locator('.fd-layer.in .fact').allTextContents(), ['Weekly on Mon, Wed, Fri', '10 min before', 'Personal']);
    assert.equal(await card(page).locator('.fd-layer.in .fact', {hasText: 'Weekly'}).locator('.icon').getAttribute('width'), '17');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 12b: a click on Dinner with Sam glides the same card there; the selection swaps at 0 and 60 ms', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    await openDentist(page);
    const before = await card(page).elementHandle();
    // Click and look in the same turn: Dentist is tinted at once, Dinner not yet solid, the card gliding.
    const right = await page.evaluate(async () => {
      const dinner = [...document.querySelectorAll<HTMLElement>('.cell[data-date="2026-10-09"] .ev')].find(element => element.textContent?.includes('Dinner'))!;
      dinner.click();
      // React applies the click in a microtask; a zero timeout is well inside the 60 ms.
      await new Promise(resolve => setTimeout(resolve, 0));
      return {solid: document.querySelectorAll('.ev.sel').length, motion: document.querySelector('.fd')?.getAttribute('data-motion'), layers: document.querySelectorAll('.fd-layer').length};
    });
    assert.deepEqual(right, {solid: 0, motion: 'glide', layers: 2});
    await until('Dinner with Sam turns solid', () => page.locator('.ev.sel').allTextContents(), list => list.join() === '7 PMDinner with Sam');
    await atRest(page);
    assert.ok(await before!.evaluate(element => element.isConnected), 'the same card, never closed');
    assert.equal(await card(page).locator('.fd-layer').count(), 1, 'the old content has gone');
    // Weeks start on Sunday (SV-29): Friday has only Saturday to its right, too narrow, so it's below.
    assert.equal(await card(page).getAttribute('data-side'), 'below');
    assert.equal(await card(page).getAttribute('data-glide-from'), '159,143');
    assert.deepEqual(await cardAt(page), {left: 668, top: 311, width: 280, height: 282});
    await assertBeside(page, chip(page, '2026-10-09', 'Dinner with Sam'));
    assert.deepEqual(await card(page).locator('.fact').allTextContents(),
      ['Blue Door2118 Sunset Blvd', 'Leave by 6:35 PM · 21 min', 'Sam Lee', '1 hour before', 'Personal']);
    await settle(page);
    await matchGolden(page, '12b-floating-detail-glided-to-dinner-with-sam', 'grid');
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
    await settle(page);
    await matchGolden(page, '12a-floating-detail-dentist', 'grid');

    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    await until('Dinner with Sam turns solid', () => page.locator('.ev.sel').allTextContents(), list => list.join() === '7 PMDinner with Sam');
    await atRest(page);
    assert.equal(await scrollTop(), before, 'Dinner with Sam was in view: the grid stays');
    await october('after Dinner with Sam');
    assert.deepEqual(await page.evaluate(() => (window as unknown as {gridScrolls: number[]}).gridScrolls), [], 'the grid never scrolled');
    await settle(page);
    await matchGolden(page, '12b-floating-detail-glided-to-dinner-with-sam', 'grid');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the glide never crosses the grid\'s edge: its overshoot shrinks to the room left (decision 47)', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await openDentist(page);
    // Every frame of the glide to Thursday's CS 101 lecture, whose card rests 13 px from the right pane.
    const furthest = await page.evaluate(async () => {
      const grid = document.querySelector('.cal-scroll')!.getBoundingClientRect();
      const lecture = [...document.querySelectorAll<HTMLElement>('.cell[data-date="2026-10-08"] .ev')].find(element => element.textContent?.includes('CS 101'))!;
      lecture.click();
      let right = 0;
      const ends = performance.now() + 600;
      while (performance.now() < ends) {
        await new Promise(requestAnimationFrame);
        right = Math.max(right, document.querySelector('.fd')!.getBoundingClientRect().right);
      }
      return {right, edge: grid.right};
    });
    assert.ok(furthest.right <= furthest.edge, `the card reached ${furthest.right}, past the grid's edge at ${furthest.edge}`);
    assert.ok(furthest.right > furthest.edge - 13 + 3, 'it still bounces past where it rests');
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
    const motions = await watch(card(page), 'data-motion');
    await page.keyboard.press('Escape');
    assert.equal((await until('Esc moves the card', motions, seen => seen.length > 0))[0], 'closing');
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
    // F6 brings the icon actions (manipulation.spec.ts carries them out).
    await openDentist(page);
    for (const name of ['Clone', 'Copy', 'Colour', 'Delete']) assert.equal(await card(page).getByRole('button', {name}).getAttribute('aria-disabled'), null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a click mid-glide retargets from where the card is, keeping its velocity: no restart, no close', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-15"] .ev', {hasText: 'Career fair'}).waitFor();
    // The first glide's curve, built as the engine builds it (logic/glide.ts): from where the card
    // rests beside Dentist to where it rests beside Dinner, with its size there and the grid's box.
    await openDentist(page);
    await glideTo(page, chip(page, '2026-10-09', 'Dinner with Sam'));
    const to = await placed(page);
    const size = await card(page).evaluate(element => ({width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight}));
    const bounds = await page.evaluate(() => {
      const section = document.querySelector('.cal-month')!.getBoundingClientRect();
      const grid = document.querySelector('.cal-scroll')!.getBoundingClientRect();
      return {left: grid.left - section.left, top: grid.top - section.top, width: grid.width, height: grid.height};
    });
    await glideTo(page, chip(page, '2026-10-07', 'Dentist'));
    const resting = await placed(page);
    const first = glideSegment(resting, to, size, bounds);

    const trace = await page.evaluate(async () => {
      const find = (date: string, title: string) => [...document.querySelectorAll<HTMLElement>(`.cell[data-date="${date}"] .ev`)].find(element => element.textContent?.includes(title))!;
      const fd = () => document.querySelector<HTMLElement>('.fd');
      const frames: {x: number; y: number; left: number; top: number; at: number; motion: string | null}[] = [];
      const sample = () => {
        const box = fd()?.getBoundingClientRect();
        const moved = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(fd()?.style.transform ?? '');
        frames.push({x: box?.x ?? NaN, y: box?.y ?? NaN, left: Number(moved?.[1]), top: Number(moved?.[2]), at: performance.now(), motion: fd()?.getAttribute('data-motion') ?? null});
      };
      const firstClickAt = performance.now();
      find('2026-10-09', 'Dinner').click();
      const start = performance.now();
      while (performance.now() - start < 110) {
        await new Promise(requestAnimationFrame);
        sample();
      }
      const card = fd();
      const motionAtRetarget = card?.getAttribute('data-motion');
      const retargetIndex = frames.length;
      const retargetAt = performance.now();
      find('2026-10-15', 'Career fair').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      const from = card?.getAttribute('data-glide-from');
      const fromAt = performance.now();
      const ends = performance.now() + 700;
      while (performance.now() < ends) {
        await new Promise(requestAnimationFrame);
        sample();
      }
      return {frames, retargetIndex, motionAtRetarget, from, firstClickAt, retargetAt, fromAt, same: fd() === card};
    });
    assert.equal(trace.motionAtRetarget, 'glide', 'the second click came mid-glide');
    assert.ok(trace.same, 'the same card element throughout');
    assert.ok(trace.frames.every(frame => frame.motion !== null && frame.motion !== 'closing'), 'it never closed');
    // From where it was: the new glide starts on the first one's curve at the click's own time,
    // which the page's clock bounds however slow the machine. The first glide began after its
    // click and by its first frame that moved; the second starts after its click and before the
    // read. (A busy machine draws few frames, so the last one drawn can be well behind the clock.)
    const [fromX, fromY] = trace.from!.split(',').map(Number) as [number, number];
    // How near the first glide's curve comes to `point` between two moments of it.
    const nearest = (point: {left: number; top: number}, from = 0, to = first.duration) => {
      let best = {elapsed: from, off: Infinity};
      for (let elapsed = Math.max(0, from); elapsed <= Math.min(to, first.duration); elapsed += 0.25) {
        const at = glidePosition(first, elapsed);
        const off = Math.hypot(at.left - point.left, at.top - point.top);
        if (off < best.off) best = {elapsed, off};
      }
      return best;
    };
    const last = trace.frames[trace.retargetIndex - 1]!;
    const firstMoved = trace.frames.find(frame => frame.left !== resting.left || frame.top !== resting.top)!;
    const drawn = nearest(last);
    assert.ok(drawn.off <= 2, `the last frame drawn is on the first glide's curve (${drawn.off.toFixed(1)} px off)`);
    const earliest = Math.max(drawn.elapsed, trace.retargetAt - firstMoved.at);
    const latest = trace.fromAt - trace.firstClickAt;
    // (The start is rounded to whole pixels; near its end the curve barely moves, so it's matched by place.)
    const started = nearest({left: fromX, top: fromY}, earliest - 1, latest + 1);
    assert.ok(started.off <= 2, `it starts on the first glide's curve between ${earliest.toFixed(0)} and ${latest.toFixed(0)} ms into it (${trace.from}, ${started.off.toFixed(1)} px off, nearest ${nearest({left: fromX, top: fromY}).elapsed} ms in)`);
    assert.ok(Math.hypot(fromX - resting.left, fromY - resting.top) > 300, `not from where the first glide began (${trace.from})`);
    // No restart: it never goes back toward Dentist.
    const startX = trace.frames[0]!.x;
    assert.ok(trace.frames.slice(trace.retargetIndex).every(frame => frame.x > startX + 300), 'it never went back to where the first glide began');
    await atRest(page);
    assert.equal(await page.getByRole('dialog', {name: 'Career fair'}).count(), 1);
    // And from the retarget on it moves without jumps: no step between two frames is longer than
    // the glides' top speed covers in the time between them, on the page's clock (a busy machine
    // draws fewer frames, each further on). The second glide is built as the engine builds it, with
    // the first's velocity carried on.
    const there = await card(page).evaluate(element => ({width: (element as HTMLElement).offsetWidth, height: (element as HTMLElement).offsetHeight}));
    const second = glideSegment({left: fromX, top: fromY}, await placed(page), there, bounds, glideVelocity(first, started.elapsed));
    let fastest = 0;
    for (const segment of [first, second]) {
      for (let elapsed = 0; elapsed < segment.duration; elapsed += 1) {
        const [a, b] = [glidePosition(segment, elapsed), glidePosition(segment, elapsed + 1)];
        fastest = Math.max(fastest, Math.hypot(b.left - a.left, b.top - a.top));
      }
    }
    for (let index = trace.retargetIndex; index < trace.frames.length; index += 1) {
      const [earlier, a, b] = [trace.frames[index - 2]!, trace.frames[index - 1]!, trace.frames[index]!];
      // A frame can show the tick before it, so the time allowed runs from the frame before.
      const step = Math.hypot(b.left - a.left, b.top - a.top);
      const allowed = fastest * (b.at - earlier.at) + 2;
      assert.ok(step <= allowed, `a jump of ${step.toFixed(0)} px between frames ${index - 1} and ${index}, where ${allowed.toFixed(0)} px fit in ${(b.at - earlier.at).toFixed(0)} ms`);
    }
    // (That the velocity carries on is glide.test.ts's table; here it's enough that nothing jumps.)
    await assertBeside(page, chip(page, '2026-10-15', 'Career fair'));
    assert.deepEqual(await page.locator('.ev.sel').allTextContents(), ['10 AMCareer fair']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 12d: dragged aside by its grip, the card stays where it\'s dropped; the next click glides it from there', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
    await openDentist(page);
    const grip = (await card(page).locator('.grip').boundingBox())!;
    const start = {x: grip.x + grip.width / 2, y: grip.y + grip.height / 2};
    // 12d drops it at 742, 607, low over Friday and Saturday.
    const at = await cardAt(page);
    const delta = {x: 742 - at.left, y: 607 - at.top};
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 10; step += 1) await page.mouse.move(start.x + delta.x * step / 10, start.y + delta.y * step / 10);
    assert.equal(await motion(page), 'drag');
    assert.match((await card(page).getAttribute('class'))!, /\blifted\b/, 'lifted: the shadow deepens');
    assert.deepEqual(await cardAt(page), {left: 742, top: 607, width: 280, height: 254}, 'it follows the pointer 1:1');
    await page.mouse.up();
    await atRest(page);
    assert.doesNotMatch((await card(page).getAttribute('class'))!, /\blifted\b/);
    assert.deepEqual(await cardAt(page), {left: 742, top: 607, width: 280, height: 254}, 'it stays where it was dropped');

    await chip(page, '2026-10-09', 'Dinner with Sam').click();
    assert.equal(await card(page).getAttribute('data-glide-from'), '742,607', 'the glide starts where the card was left');
    await atRest(page);
    assert.equal(await card(page).getAttribute('data-side'), 'below');
    assert.deepEqual(await cardAt(page), {left: 668, top: 311, width: 280, height: 282});
    await settle(page);
    await matchGolden(page, '12d-dragged-aside-then-glides-to-dinner-with-sam', 'grid');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the whole card drags from anywhere but its buttons and text; its text stays selectable', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await openDentist(page);
    const before = await cardAt(page);
    const when = (await card(page).locator('.fd-when').boundingBox())!;
    const drag = async (x: number, y: number) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + 20 * step, y + 10 * step);
      const during = await motion(page);
      await page.mouse.up();
      return during;
    };

    // On the date line's text (past its 27 px indent): the text selects and the card stays.
    assert.notEqual(await drag(when.x + 33, when.y + when.height / 2), 'drag');
    assert.deepEqual(await cardAt(page), before);
    assert.notEqual(await page.evaluate(() => window.getSelection()?.toString() ?? ''), '');

    // Past the text's end, on the card itself: it lifts and follows.
    assert.equal(await drag(when.x + when.width - 4, when.y + when.height / 2), 'drag');
    await atRest(page);
    assert.deepEqual(await cardAt(page), {...before, left: before.left + 200, top: before.top + 100});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Edit (E or the button) hands the item to the right pane: the card shrinks toward it, the editor slides in', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await openDentist(page);
    const motions = await watch(card(page), 'data-motion');
    await page.keyboard.press('e');
    assert.equal((await until('E moves the card', motions, seen => seen.length > 0))[0], 'closing');
    const editor = page.locator('.editor.handed');
    await editor.waitFor();
    assert.equal(await editor.getByLabel('Title', {exact: true}).inputValue(), 'Dentist');
    await until('the card has gone to the pane', () => card(page).count(), count => count === 0);
    assert.deepEqual(await page.locator('.ev.sel').allTextContents(), ['2:30 PMDentist'], 'the item stays selected');
    // Esc closes the editor, and the card comes back beside the item.
    await page.keyboard.press('Escape');
    await until('the editor closes', () => editor.count(), count => count === 0);
    await card(page).waitFor();
    await atRest(page);
    await assertBeside(page, chip(page, '2026-10-07', 'Dentist'));
    // The button does the same.
    await card(page).getByRole('button', {name: /^Edit/}).click();
    await editor.waitFor();
    await until('the card has gone again', () => card(page).count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('beside its item the card scrolls with the grid, and an item picked from the agenda or a link opens it', async () => {
  const setpoint = await startSetpoint({fixtures: ['time-to-leave']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar/2026-10-09`);
    await page.locator('.ag-item', {hasText: 'Study group'}).first().click();
    await card(page).waitFor();
    await atRest(page);
    await assertBeside(page, chip(page, '2026-10-09', 'Study group'));
    // A wheel step down: the card keeps beside its item.
    await page.mouse.move(400, 900);
    const top = await page.locator('.cal-scroll').evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, 120);
    await until('the grid scrolled', () => page.locator('.cal-scroll').evaluate(element => element.scrollTop), scrolled => scrolled > top);
    const anchor = (await chip(page, '2026-10-09', 'Study group').boundingBox())!;
    const box = (await card(page).boundingBox())!;
    // Above it on Friday (SV-29: weeks start on Sunday), still centred over it.
    assert.ok(Math.abs(box.x + box.width / 2 - (anchor.x + anchor.width / 2)) <= 1, 'still centred on its item');
    assert.equal(Math.round(anchor.y - (box.y + box.height)), GAP, 'still 8 px above it');
    // A link to an item opens its card once its chip is drawn.
    const items = await setpoint.api<{items: {id: number; title: string}[]}>('GET', '/items?from=2026-10-15&to=2026-10-16');
    const fair = items.items.find(item => item.title === 'Career fair')!;
    await page.goto(`${setpoint.base}/calendar/item/${fair.id}`);
    await page.getByRole('dialog', {name: 'Career fair'}).waitFor();
    await atRest(page);
    await assertBeside(page, chip(page, '2026-10-15', 'Career fair'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
