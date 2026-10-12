// Every control answers the pointer, and the lists move (F10; DESIGN.md › Decided while building
// #12–14; darma SV-21): a hover state on each kind of control, at 120 ms, and none on a disabled one;
// a press on each (going in over 80 ms; a key pressing its button; a tap on the phone, SV-59);
// the mail list's rows folding out and in over 180 ms; Settings › Accounts reordering live while an
// account is dragged; menus inside clipped containers open fully in view.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {AccountOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, point, startSetpoint, still, until, watch} from './harness.ts';

after(cleanUp);

/** The Inbox under Settings, loaded, then Settings at `page`. */
async function openSettings(page: Page, base: string, settingsPage: string) {
  await page.goto(`${base}/settings/${settingsPage}`);
  await page.locator('.settings').waitFor();
  await page.locator('.arow').first().waitFor();
}

/** A style of `target` with the pointer away, then over `control` (itself unless given), once the 120 ms change is over. */
async function hovered(page: Page, control: Locator, read: (element: Element) => string, target: Locator = control): Promise<[string, string]> {
  await page.mouse.move(1, 1);
  // The 120 ms transitions run their course; a disabled control has no change to wait for.
  await page.waitForTimeout(200);
  const before = await target.evaluate(read);
  await control.hover();
  // The 120 ms transitions run their course; a disabled control has no change to wait for.
  await page.waitForTimeout(200);
  return [before, await target.evaluate(read)];
}

const fill = (element: Element) => getComputedStyle(element).backgroundColor;
const ring = (element: Element) => `${getComputedStyle(element).boxShadow} ${getComputedStyle(element).borderColor}`;
const layer = (element: Element) => getComputedStyle(element, '::after').opacity;
const timing = (element: Element) => `${getComputedStyle(element).transitionDuration} ${getComputedStyle(element).transitionTimingFunction}`;

async function answers(page: Page, what: string, control: Locator, read: (element: Element) => string, target?: Locator) {
  const [before, after] = await hovered(page, control, read, target);
  assert.notEqual(after, before, `${what} answers the pointer`);
}

/**
 * Whether a popover shows whole: inside the viewport, and each corner (inset past its radius) hits
 * the popover itself, so no ancestor's overflow clips it and nothing covers it.
 */
async function unclipped(menu: Locator): Promise<string[]> {
  return menu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const problems: string[] = [];
    if (rect.top < 0 || rect.left < 0 || rect.bottom > innerHeight || rect.right > innerWidth) problems.push(`outside the viewport: ${JSON.stringify(rect)}`);
    const inset = 12;
    for (const [x, y] of [[rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset], [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset]] as const) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !element.contains(hit)) problems.push(`(${Math.round(x)}, ${Math.round(y)}) hits ${hit ? hit.className || hit.tagName : 'nothing'}`);
    }
    return problems;
  });
}

test('hover: the primary, quiet and outlined buttons, segmented controls, fields, rows, chips, menu items and suggestions answer the pointer over 120 ms; a disabled one doesn\'t', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    // A row, the segmented control, the search field; an outlined button in the reader.
    await answers(page, 'a row', page.locator('.row').first(), fill);
    await answers(page, 'Unread | All', page.locator('.seg button', {hasText: 'All'}), fill);
    await answers(page, 'the search field', page.locator('label.search'), ring);
    // The list's first email open: Previous, disabled, doesn't answer.
    await page.locator('.list [data-id]').first().click();
    const previous = page.getByRole('button', {name: 'Previous email'});
    assert.equal(await previous.isDisabled(), true);
    const [previousBefore, previousAfter] = await hovered(page, previous, element => `${getComputedStyle(element).backgroundColor} ${getComputedStyle(element).color}`);
    assert.equal(previousAfter, previousBefore, 'a disabled button doesn\'t answer');
    await page.locator('.arow', {hasText: 'Contoso University'}).click();
    const addToCalendar = page.locator('.rd-acts .btn.out', {hasText: 'Add to calendar'});
    await answers(page, 'an outlined button', addToCalendar, ring);
    assert.match(await addToCalendar.evaluate(timing), /0\.12s.*cubic-bezier\(0\.2, 0, 0, 1\)/);
    // The Undo toast's button.
    await page.keyboard.press('h');
    await answers(page, 'Undo', page.locator('.toast button', {hasText: 'Undo'}), fill);

    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    const newButton = page.locator('.hd .btn', {hasText: 'New'});
    await answers(page, '+ New', newButton, fill);
    assert.match(await newButton.evaluate(timing), /0\.12s/);
    await answers(page, 'an event chip', page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'}), layer);
    // Week is built (#81, retiring #57): it answers as any segment does, and so does a block on it.
    await answers(page, 'Month | Week', page.locator('.hd .seg > *', {hasText: 'Week'}), fill);
    await page.keyboard.press('w');
    await answers(page, 'a week block', page.locator('.wk-col[data-date="2026-10-07"] .wb', {hasText: 'Dentist'}), layer);
    await page.keyboard.press('m');
    await page.locator('.cal-month').waitFor();

    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').fill('Dinner fri 7-9pm');
    await answers(page, 'Event | Task', page.locator('.editor .seg > *', {hasText: 'Task'}), fill);
    await answers(page, 'the calendar field', page.locator('.editor button.field[aria-label="Calendar"]'), ring);
    await answers(page, 'Add another', page.locator('.editor .btn', {hasText: 'Add another'}), fill);
    await answers(page, 'Create', page.locator('.editor .ed-foot .btn', {hasText: 'Create'}), fill);
    await answers(page, 'Cancel', page.locator('.editor .ed-foot .btn', {hasText: 'Cancel'}), fill);
    await page.getByRole('button', {name: 'Add reminder'}).click();
    await answers(page, 'a menu item', page.locator('.editor .menu .menu-i').first(), fill);

    await openSettings(page, setpoint.base, 'calendar');
    await page.getByRole('button', {name: 'Set Home'}).click();
    await page.locator('.settings input[aria-label="Home"]').fill('blue door');
    await answers(page, 'a Home suggestion', page.locator('.settings button.set-row', {hasText: 'Blue Door Bistro'}), fill);
    await answers(page, 'a switch', page.getByRole('switch', {name: 'Show Classes'}), fill);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A colour as the page computes it, from a token or any colour expression. */
const computed = (page: Page, value: string) => page.evaluate(css => {
  const probe = document.createElement('div');
  probe.style.color = css;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, value);

/**
 * `control`'s scale, fill and transition held down, once the 80 ms press has gone in; then let go off
 * it, so the press is read without the click doing anything.
 */
async function pressed(page: Page, control: Locator): Promise<[string, string, string]> {
  await control.hover();
  // The hover's 120 ms fill runs its course before the press.
  await page.waitForTimeout(200);
  await page.mouse.down();
  // The 80 ms press goes in.
  await page.waitForTimeout(150);
  const held = await control.evaluate(element => [getComputedStyle(element).transform, getComputedStyle(element).backgroundColor, getComputedStyle(element).transitionDuration.split(', ').at(-1)!] as [string, string, string]);
  await page.mouse.move(700, 28);
  await page.mouse.up();
  return held;
}

const scale = (factor: number) => `matrix(${factor}, 0, 0, ${factor}, 0, 0)`;

test('press: a pill gives .97 with a fill step, a round icon button .92 and `sub3`, a row only its `sub3` step, going in over 80 ms; a key presses its button; a disabled one doesn\'t give', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    const [sub3, sub4] = [await computed(page, 'var(--sub3)'), await computed(page, 'var(--sub4)')];

    // A row takes `sub3`, never scaling.
    assert.deepEqual(await pressed(page, page.locator('.row').first()), ['none', sub3, '0.08s']);
    // The segmented control: .97 and `sub3`.
    assert.deepEqual(await pressed(page, page.locator('.seg button', {hasText: 'All'})), [scale(0.97), sub3, '0.08s']);

    // The reader: a tool .97 and `sub3`; a round icon button .92 and `sub3`; Previous, disabled, gives nothing.
    await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.deepEqual(await pressed(page, page.locator('.rd-tools .tool', {hasText: 'Pin'})), [scale(0.97), sub3, '0.08s']);
    assert.deepEqual(await pressed(page, page.getByRole('button', {name: 'Next email'})), [scale(0.92), sub3, '0.08s']);
    // An outlined button: .97 and `sub2`.
    assert.deepEqual((await pressed(page, page.locator('.rd-acts .btn.out', {hasText: 'Add to calendar'}))).slice(0, 2), [scale(0.97), await computed(page, 'var(--sub2)')]);
    // On the list's first email, Previous is disabled.
    await page.locator('.list [data-id]').first().click();
    const previous = page.getByRole('button', {name: 'Previous email'});
    assert.equal(await previous.isDisabled(), true);
    assert.equal((await pressed(page, previous))[0], 'none', 'a disabled button doesn\'t give');
    await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();

    // P presses Pin, as its click would.
    const pin = page.locator('.rd-tools .tool', {hasText: 'Pin'});
    const echo = await watch(pin, 'data-echo');
    await page.mouse.move(700, 28);
    await page.keyboard.press('p');
    await until('P presses Pin', echo, seen => seen.includes(''));
    await until('and lets go', () => pin.getAttribute('data-echo'), value => value === null);

    // Calendar's New, the primary button: .97 and its fill a step darker than its hover.
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    assert.deepEqual(await pressed(page, page.locator('.hd .btn', {hasText: 'New'})),
      [scale(0.97), await computed(page, 'color-mix(in oklch, var(--ink) 78%, var(--page))'), '0.08s']);
    assert.deepEqual((await pressed(page, page.locator('.hd .btn.ghost', {hasText: 'Today'}))).slice(0, 2), [scale(0.97), sub4]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('News rows and task chips fade over 120 ms and a hovered task isn\'t selected-looking; controls show the arrow; a calendar\'s check fades; a switch\'s knob stretches on press', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const cursor = (locator: Locator) => locator.first().evaluate(element => getComputedStyle(element).cursor);
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    // The arrow on controls, links included, and on rows.
    assert.deepEqual([await cursor(page.locator('a.nav')), await cursor(page.locator('.acct')), await cursor(page.locator('.row')), await cursor(page.locator('.arow'))], ['default', 'default', 'default', 'default']);

    await page.goto(`${setpoint.base}/news`);
    const story = page.locator('.nw-row').first();
    await story.waitFor();
    assert.match(await story.evaluate(timing), /0\.12s.*cubic-bezier\(0\.2, 0, 0, 1\)/);
    assert.deepEqual([await cursor(story), await cursor(page.locator('.nw-up'))], ['default', 'default']);

    await page.goto(`${setpoint.base}/calendar`);
    const task = page.locator('.cell[data-date="2026-10-07"] .tk').first();
    await task.waitFor();
    assert.match(await task.evaluate(timing), /0\.12s/);
    await answers(page, 'a task chip', task, fill);
    assert.equal(await task.evaluate(element => getComputedStyle(element).backgroundColor), await computed(page, 'var(--sub)'), 'a hovered task is `sub`, not the selection\'s `sub2`');
    assert.equal(await cursor(page.locator('.ev')), 'default');
    // A calendar turned off: its check shrinks away over 120 ms rather than vanishing.
    const check = page.locator('.calrow .chk').first();
    assert.match(await check.evaluate(element => getComputedStyle(element, '::after').transitionDuration), /^0\.12s/);
    await page.locator('.calrow').first().click();
    await page.locator('.calrow .chk.off').first().waitFor();
    await until('the check gone', () => check.evaluate(element => getComputedStyle(element, '::after').opacity), opacity => opacity === '0');

    // Settings: a switch's knob stretches to 20 px while pressed.
    await page.goto(`${setpoint.base}/settings/calendar`);
    const toggle = page.getByRole('switch', {name: 'Show Classes'});
    await toggle.waitFor();
    await still(page);
    await toggle.hover();
    await page.mouse.down();
    await until('the knob stretched', () => toggle.evaluate(element => getComputedStyle(element, '::after').width), width => width === '20px');
    await page.mouse.move(700, 28);
    await page.mouse.up();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('press on the phone: a tapped row fills `sub2` at once and nothing stays lit after; no tap highlight', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    const row = page.locator('.arow', {hasText: 'Northwind Talent'});
    await row.waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color')), 'rgba(0, 0, 0, 0)');
    assert.deepEqual(await pressed(page, row), ['none', await computed(page, 'var(--sub2)'), '0s']);
    // The reader's Pin, tapped: no hover fill stays on it under the finger.
    await row.tap();
    const pin = page.locator('.ph-top .ph-icon');
    await pin.tap();
    // The 120 ms press lets go.
    await page.waitForTimeout(300);
    assert.equal(await pin.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'nothing stays lit after a tap');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/**
 * Records each fold in the list from now on: a row given `leaving` (folding out) or a row added
 * (folding in, if it has a motion), with its motion's duration and easing and the row's text.
 */
async function watchFolds(page: Page) {
  await page.evaluate(() => {
    const folds: {fold: string; text: string; motion: string[]}[] = [];
    (window as unknown as {folds: typeof folds}).folds = folds;
    const motion = (element: Element) => element.getAnimations().filter(animation => !(animation instanceof CSSTransition))
      .map(animation => `${animation.effect!.getTiming().duration} ${animation.effect!.getTiming().easing}`);
    new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes' && (record.target as Element).classList.contains('leaving') && !(record.oldValue ?? '').includes('leaving')) {
          folds.push({fold: 'out', text: (record.target as Element).textContent ?? '', motion: motion(record.target as Element)});
        }
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && motion(node).length) folds.push({fold: 'in', text: node.textContent ?? '', motion: motion(node)});
        }
      }
    }).observe(document.querySelector('.list')!, {subtree: true, childList: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true});
  });
}

const folds = (page: Page) => page.evaluate(() => (window as unknown as {folds: {fold: string; text: string; motion: string[]}[]}).folds);
const MOTION = /^180 cubic-bezier\(0?\.2, ?0, ?0, ?1\)$/;

test('the mail list: Done folds its row away over 180 ms and the next takes its place; Undo folds it back; Pin folds a row onto the shelf; Mark all as read folds the read rows; the dot fades', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    // Every row that folds in from the document's first moment: a fold at the first paint is over in 180 ms.
    await page.addInitScript(() => {
      const scope = window as unknown as {firstFolds: string[]};
      scope.firstFolds = [];
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof HTMLElement) || !node.closest('.list')) continue;
            for (const element of [node, ...node.querySelectorAll('*')]) {
              if (element.getAnimations().some(animation => !(animation instanceof CSSTransition))) scope.firstFolds.push(element.textContent ?? '');
            }
          }
        }
      }).observe(document, {subtree: true, childList: true});
    });
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    assert.deepEqual(await page.evaluate(() => (window as unknown as {firstFolds: string[]}).firstFolds), [], 'the first paint doesn\'t fold');
    await watchFolds(page);

    // Done from the cursor on Northwind: it folds out; Contoso University, below it, slides up into its place.
    const northwind = page.locator('.arow', {hasText: 'Northwind Talent'});
    const exams = page.locator('.arow', {hasText: 'Contoso University'});
    const place = (await northwind.boundingBox())!.y;
    await point(northwind);
    await page.keyboard.press('h');
    await until('Northwind folded away', () => northwind.count(), count => count === 0);
    const out = (await folds(page)).filter(fold => fold.fold === 'out');
    assert.equal(out.length, 1);
    assert.match(out[0]!.text, /Northwind Talent/);
    assert.match(out[0]!.motion[0] ?? '', MOTION);
    assert.equal((await exams.boundingBox())!.y, place, 'Contoso University took its place');

    // Undo folds it back in.
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await northwind.waitFor();
    await until('Northwind folded back', () => folds(page), list => list.some(fold => fold.fold === 'in' && /Northwind Talent/.test(fold.text)));
    assert.match((await folds(page)).find(fold => fold.fold === 'in')!.motion[0]!, MOTION);
    await until('Contoso University back below it', async () => (await exams.boundingBox())!.y, y => y > place);

    // Pin folds a row onto the shelf (its header with it).
    const fabrikam = page.locator('.row', {hasText: 'Fabrikam'}).first();
    await point(fabrikam);
    await page.keyboard.press('p');
    await page.locator('.row.shelf', {hasText: 'Fabrikam'}).waitFor();
    const pinned = (await folds(page)).filter(fold => fold.fold === 'in' && /Fabrikam/.test(fold.text));
    assert.ok(pinned.length >= 1, 'the shelf\'s row folded in');
    assert.match(pinned[0]!.motion[0]!, MOTION);

    // Opening an unread email fades its dot over 120 ms.
    assert.equal(await page.locator('.arow.unread .ud').first().evaluate(dot => getComputedStyle(dot, '::before').transitionDuration), '0.12s');

    // Mark all as read: the read FYI rows fold out together.
    const before = (await folds(page)).filter(fold => fold.fold === 'out').length;
    await page.mouse.move(1, 1);
    await page.keyboard.press('Shift+I');
    await until('the read rows folded out', async () => (await folds(page)).filter(fold => fold.fold === 'out').length - before, count => count > 3, 8000);
    assert.ok((await folds(page)).filter(fold => fold.fold === 'out').slice(before).every(fold => fold.motion.some(line => MOTION.test(line))));
    await until('they\'re gone', () => page.locator('.list .leaving').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('live reordering: dragging Business down past Personal makes room as it passes, the rows easing over 180 ms; letting go saves the order; ↑ on the handle still moves it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openSettings(page, setpoint.base, 'accounts');
    const rows = page.locator('.settings [data-account]');
    await rows.nth(2).waitFor();
    // The rows top to bottom as they show (while dragged they slide, staying in place in the page).
    const labels = () => rows.evaluateAll(all => all.map(row => ({label: row.querySelector('.lines .t')!.textContent!, y: row.getBoundingClientRect().y}))
      .sort((a, b) => a.y - b.y).map(row => row.label));
    const [first, second, third] = await labels();
    const box = async (index: number) => (await rows.nth(index).boundingBox())!;

    // Every slide a row starts, as it starts.
    await page.evaluate(() => {
      const slides: {label: string; motion: string}[] = [];
      (window as unknown as {slides: typeof slides}).slides = slides;
      const seen = new WeakSet<Animation>();
      const look = () => {
        for (const row of document.querySelectorAll('.settings [data-account]')) {
          for (const animation of row.getAnimations()) {
            if ((animation instanceof CSSTransition && animation.transitionProperty !== 'transform') || seen.has(animation)) continue;
            seen.add(animation);
            slides.push({label: row.querySelector('.lines .t')?.textContent ?? '', motion: `${animation.effect!.getTiming().duration} ${animation.effect!.getTiming().easing}`});
          }
        }
        requestAnimationFrame(look);
      };
      look();
    });
    const slides = () => page.evaluate(() => (window as unknown as {slides: {label: string; motion: string}[]}).slides);

    // Down from the first row's handle, past the second row's middle.
    const handle = (await rows.nth(0).locator('.handle').boundingBox())!;
    const target = await box(1);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 20, {steps: 4});
    await page.mouse.move(handle.x + handle.width / 2, target.y + target.height * 0.75, {steps: 8});
    // Mid-drag: the second row moved up into the first place, sliding there over 180 ms.
    await until('the rows make room', labels, order => order.slice(0, 3).join() === [second, first, third].join());
    const slide = await until(`${second} slides into place`, slides, list => list.some(one => one.label === second));
    assert.match(slide.find(one => one.label === second)!.motion, MOTION);
    assert.equal(await rows.nth(0).getAttribute('class').then(names => names!.includes('dragging')), true, `${first} is the one dragged`);
    const saved = () => setpoint.api<AccountOut[]>('GET', '/accounts').then(list => list.sort((a, b) => a.position - b.position).map(account => account.label));
    assert.deepEqual((await saved()).slice(0, 2), [first, second], 'nothing is saved mid-drag');
    await page.mouse.up();
    await until('the order saved', saved, order => order.slice(0, 3).join() === [second, first, third].join());

    // ↑ on the handle moves it back, easing the same way.
    const slid = (await slides()).length;
    await rows.nth(1).locator('.handle').focus();
    await page.keyboard.press('ArrowUp');
    const back = await until('the rows slide back', slides, list => list.slice(slid).some(one => one.label === first));
    assert.match(back.slice(slid).find(one => one.label === first)!.motion, MOTION);
    await until('moved back', saved, order => order.slice(0, 2).join() === [first, second].join());
    await until('shown back', labels, order => order.slice(0, 2).join() === [first, second].join());
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('menus: Sources\' last row (Weather · Check now), the last account\'s and the last rule\'s open whole, not clipped by their group', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openSettings(page, setpoint.base, 'accounts');
    await page.locator('.settings [data-source="weather"]').waitFor();
    await page.getByRole('button', {name: 'Weather options'}).click();
    const weather = page.getByRole('menu', {name: 'Weather options'});
    await page.getByRole('menuitem', {name: 'Check now'}).waitFor();
    assert.deepEqual(await unclipped(weather), [], 'Weather\'s menu');
    await page.keyboard.press('Escape');

    const last = page.locator('.settings [data-account]').last();
    const label = (await last.locator('.lines .t').textContent())!;
    await last.getByRole('button', {name: `${label} options`}).click();
    assert.deepEqual(await unclipped(page.getByRole('menu', {name: `${label} options`})), [], `${label}'s menu`);
    await page.keyboard.press('Escape');

    await page.locator('.settings .set-nav .nav', {hasText: 'Mail'}).click();
    await page.locator('.settings .rule', {hasText: 'Proseware alerts'}).waitFor();
    await page.getByRole('button', {name: 'Rule options'}).last().click();
    assert.deepEqual(await unclipped(page.getByRole('menu', {name: 'Rule options'})), [], 'the last rule\'s menu');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('menus: on a short window the last source\'s opens upward, whole; the editor\'s Reminder and Repeat menus open whole in the pane', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const short = await setpoint.page({width: 1677, height: 640});
    await openSettings(short, setpoint.base, 'accounts');
    const weatherRow = short.locator('.settings [data-source="weather"]');
    await weatherRow.waitFor();
    // Settings risen into place, so the menu measures its room as it rests.
    await still(short);
    // Weather's row at the bottom of what Settings' page shows.
    await weatherRow.evaluate(row => row.scrollIntoView({block: 'end'}));
    await short.getByRole('button', {name: 'Weather options'}).click();
    const menu = short.getByRole('menu', {name: 'Weather options'});
    await menu.waitFor();
    assert.equal(await menu.getAttribute('data-up'), '', 'it opens upward');
    assert.deepEqual(await unclipped(menu), []);

    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').fill('Dinner fri 7-9pm');
    // The editor slid into place, so each menu measures its room as it rests.
    await still(page);
    for (const opener of ['Add reminder', 'Repeat']) {
      await page.getByRole('button', {name: opener, exact: true}).click();
      assert.deepEqual(await unclipped(page.locator('.editor .menu')), [], `${opener}'s menu`);
      await page.getByRole('button', {name: opener, exact: true}).click();
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
