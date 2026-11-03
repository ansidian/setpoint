// Every control answers the pointer, and the lists move (F10; DESIGN.md › Decided while building
// #12–14; darma SV-21): a hover state on a row, and none on a disabled control; a key pressing its
// button and a tap on the phone (SV-59); the mail list's first paint not folding; Settings › Accounts
// reordering live while an account is dragged; Settings' menus inside clipped groups open whole.
// Whether a menu opens upward is opensUp's, a table in contextMenu.test.ts; that one shows whole in
// the editor's pane is by eye (D416, D417).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {AccountOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

/** The Inbox under Settings, loaded, then Settings at `page`. */
async function openSettings(page: Page, base: string, settingsPage: string) {
  await page.goto(`${base}/settings/${settingsPage}`);
  await page.locator('.settings').waitFor();
  await page.locator('.list .row').first().waitFor();
}

const fill = (element: Element) => getComputedStyle(element).backgroundColor;

/** A style of `target` (`control` unless given) changing as the pointer comes over `control`, which it hasn't been over yet. */
async function answers(page: Page, what: string, control: Locator, read: (element: Element) => string, target: Locator = control) {
  await page.mouse.move(1, 1);
  const before = await target.evaluate(read);
  await control.hover();
  await until(`${what} answers the pointer`, () => target.evaluate(read), after => after !== before);
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

test('hover: a row answers the pointer; a disabled button doesn\'t', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await rested(() => answers(page, 'a row', page.locator('.row').first(), fill));
    // The list's first email open: Previous, disabled, doesn't answer.
    await page.locator('.list [data-id]').first().click();
    const previous = page.getByRole('button', {name: 'Previous email'});
    assert.equal(await previous.isDisabled(), true);
    const look = () => previous.evaluate(element => `${getComputedStyle(element).backgroundColor} ${getComputedStyle(element).color}`);
    await page.mouse.move(1, 1);
    const previousBefore = await rested(() => look());
    await previous.hover();
    // A pause for a "nothing happened" check: a hover fill would have begun by now.
    await page.waitForTimeout(200);
    await setpoint.idle();
    // Read as it is: a disabled button has nothing in motion to wait for.
    assert.equal(await look(), previousBefore, 'a disabled button doesn\'t answer');
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

const held = (control: Locator) => control.evaluate(element => [getComputedStyle(element).transform, getComputedStyle(element).backgroundColor, getComputedStyle(element).transitionDuration.split(', ').at(-1)!].join(' | '));

/**
 * `control` held down until its scale, fill and transition read `expected`, which they hold while it's
 * pressed; then let go off it, so the press is read without the click doing anything.
 */
async function pressed(page: Page, control: Locator, expected: [string, string, string]): Promise<void> {
  await control.hover();
  await page.mouse.down();
  await until('the press goes in', () => held(control), look => look === expected.join(' | '));
  await page.mouse.move(700, 28);
  await page.mouse.up();
}

test('press: a key does its button\'s work; a disabled one doesn\'t give', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // On the list's first email, Previous is disabled.
    await page.locator('.list [data-id]').first().click();
    const previous = page.getByRole('button', {name: 'Previous email'});
    assert.equal(await previous.isDisabled(), true);
    await previous.hover();
    await page.mouse.down();
    // A pause for a "nothing happened" check: a press would have gone in by now.
    await page.waitForTimeout(150);
    await setpoint.idle();
    // Read as it is: a disabled button has nothing in motion to wait for.
    assert.equal((await held(previous)).split(' | ')[0], 'none', 'a disabled button doesn\'t give');
    await page.mouse.move(700, 28);
    await page.mouse.up();
    await page.locator('.list .row[title^="Interview availability"]').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();

    // P presses Pin, as its click would: the press, under a second, is by eye (D416); Pin's state follows.
    const pin = page.locator('.rd-tools .tool', {hasText: 'Pin'});
    await page.mouse.move(700, 28);
    await page.keyboard.press('p');
    await page.locator('.rd-tools .tool.active', {hasText: 'Unpin'}).waitFor();
    await until('and lets go', () => pin.getAttribute('data-echo'), value => value === null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('controls show the arrow, links and rows included; a hovered task isn\'t selected-looking', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const cursor = (locator: Locator) => locator.first().evaluate(element => getComputedStyle(element).cursor);
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // The arrow on controls, links included, and on rows.
    assert.deepEqual([await cursor(page.locator('a.nav')), await cursor(page.locator('.acct')), await cursor(page.locator('.row')), await cursor(page.locator('.nfold'))], ['default', 'default', 'default', 'default']);

    await page.goto(`${setpoint.base}/news`);
    const story = page.locator('.nw-row').first();
    await story.waitFor();
    assert.deepEqual([await rested(() => cursor(story)), await rested(() => cursor(page.locator('.nw-up')))], ['default', 'default']);

    await page.goto(`${setpoint.base}/calendar`);
    const task = page.locator('.cell[data-date="2026-10-07"] .tk').first();
    await task.waitFor();
    await rested(() => answers(page, 'a task chip', task, fill));
    assert.equal(await rested(() => task.evaluate(element => getComputedStyle(element).backgroundColor)), await rested(() => computed(page, 'var(--sub)')), 'a hovered task is `sub`, not the selection\'s `sub2`');
    assert.equal(await rested(() => cursor(page.locator('.ev'))), 'default');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a calendar chip deepens in its own colour under the pointer and gives when pressed', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    const dentist = page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'});
    await dentist.waitFor();
    const own = (percent: string) => dentist.evaluate((chip, mix) => {
      const probe = document.createElement('div');
      probe.style.color = `color-mix(in oklch, ${getComputedStyle(chip).getPropertyValue('--c')} ${mix}, transparent)`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }, percent);
    const layer = () => dentist.evaluate(chip => [getComputedStyle(chip, '::after').backgroundColor, getComputedStyle(chip, '::after').opacity]);
    await rested(() => answers(page, 'an event chip', dentist, element => getComputedStyle(element, '::after').opacity));
    assert.deepEqual(await rested(() => layer()), [await rested(() => own('18%')), '1'], 'under the pointer, its own colour at 18% (Night)');
    const deeper = await rested(() => own('28%'));
    await page.mouse.down();
    await until('it gives, deeper', async () => [await dentist.evaluate(chip => getComputedStyle(chip).transform), (await layer())[0]].join(), look => look === ['matrix(0.97, 0, 0, 0.97, 0, 0)', deeper].join());
    // Let go where it was pressed (moving away would drag it): a click, which selects it.
    await page.mouse.up();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a colour picker rings the current colour in itself and swells the one under the pointer; the chosen theme\'s row is filled', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    // Accounts: Business's colour picker rings its current colour in that colour, with no fill.
    await openSettings(page, setpoint.base, 'accounts');
    await page.getByRole('button', {name: 'Business colour'}).click();
    const picker = page.getByRole('menu', {name: 'Business colour'});
    const current = picker.locator('.sw.on');
    await current.waitFor();
    assert.deepEqual(await rested(() => current.evaluate(element => [getComputedStyle(element).backgroundColor, getComputedStyle(element).boxShadow.replace(/ 0px 0px 0px 1\.5px inset$/, '') === getComputedStyle(element, '::before').backgroundColor])), ['rgba(0, 0, 0, 0)', true]);
    const other = picker.locator('.sw:not(.on)').first();
    await other.hover();
    await until('the dot swells', () => other.evaluate(element => getComputedStyle(element, '::before').transform), transform => transform === 'matrix(1.25, 0, 0, 1.25, 0, 0)');
    await page.keyboard.press('Escape');
    // The account's options set its icons off with a hairline.
    await page.getByRole('button', {name: 'Business options'}).click();
    const icons = page.getByRole('group', {name: 'Icon'});
    assert.deepEqual(await rested(() => icons.evaluate(element => [getComputedStyle(element).borderTopWidth, getComputedStyle(element).borderTopColor])), ['1px', await rested(() => computed(page, 'var(--hair)'))]);
    await page.keyboard.press('Escape');

    // Appearance: the chosen theme is filled `sub2`, its tile inverted, its check `good`.
    await page.locator('.settings .set-nav').getByRole('button', {name: 'Appearance'}).click();
    const night = page.getByRole('radio', {checked: true});
    await night.waitFor();
    const chosen = [await rested(() => computed(page, 'var(--sub2)')), await rested(() => computed(page, 'var(--ink)')), await rested(() => computed(page, 'var(--good)'))].join();
    await page.mouse.move(1, 1);
    await until('Night filled `sub2`, its tile `ink`, its check `good`', () => night.evaluate(row => [getComputedStyle(row).backgroundColor, getComputedStyle(row.querySelector('.aico')!).backgroundColor, getComputedStyle(row.querySelector(':scope > .icon')!).color].join()), look => look === chosen);
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
    const row = page.locator('.list .row[title^="Interview availability"]');
    await row.waitFor();
    assert.equal(await rested(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('-webkit-tap-highlight-color'))), 'rgba(0, 0, 0, 0)');
    await pressed(page, row, ['none', await rested(() => computed(page, 'var(--sub2)')), '0s']);
    // The reader's Pin, tapped: no hover fill stays on it under the finger.
    await row.tap();
    const pin = page.locator('.ph-top .ph-icon');
    await pin.tap();
    // A pause for a "nothing happened" check: a press letting go would have faded by now.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await rested(() => pin.evaluate(element => getComputedStyle(element).backgroundColor)), 'rgba(0, 0, 0, 0)', 'nothing stays lit after a tap');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the mail list: the first paint doesn\'t fold', async () => {
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
    await page.locator('.list .row').first().waitFor();
    await page.locator('.today-row').first().waitFor();
    const firstFolds = await page.evaluate(() => (window as unknown as {firstFolds: string[]}).firstFolds);
    assert.deepEqual(firstFolds, [], `the first paint doesn't fold: ${JSON.stringify(firstFolds.map(text => text.slice(0, 60)))}`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('live reordering: dragging Business down past Personal makes room as it passes; letting go saves the order; ↑ on the handle still moves it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openSettings(page, setpoint.base, 'accounts');
    const rows = page.locator('.settings [data-account]');
    await rows.nth(2).waitFor();
    // The rows top to bottom as they show (while dragged they slide, staying in place in the page).
    const labels = () => rows.evaluateAll(all => all.map(row => ({label: row.querySelector('.lines .t')!.textContent!, y: row.getBoundingClientRect().y}))
      .sort((a, b) => a.y - b.y).map(row => row.label));
    const [first, second, third] = await rested(() => labels());
    const box = async (index: number) => (await rested(() => rows.nth(index).boundingBox()))!;

    // Down from the first row's handle, past the second row's middle.
    const handle = (await rows.nth(0).locator('.handle').boundingBox())!;
    const target = await box(1);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 20, {steps: 4});
    await page.mouse.move(handle.x + handle.width / 2, target.y + target.height * 0.75, {steps: 8});
    // Mid-drag: the second row moved up into the first place.
    await until('the rows make room', labels, order => order.slice(0, 3).join() === [second, first, third].join());
    assert.equal(await rows.nth(0).getAttribute('class').then(names => names!.includes('dragging')), true, `${first} is the one dragged`);
    const saved = () => setpoint.api<AccountOut[]>('GET', '/accounts').then(list => list.sort((a, b) => a.position - b.position).map(account => account.label));
    assert.deepEqual((await saved()).slice(0, 2), [first, second], 'nothing is saved mid-drag');
    await page.mouse.up();
    await until('the order saved', saved, order => order.slice(0, 3).join() === [second, first, third].join());

    // ↑ on the handle moves it back.
    await rows.nth(1).locator('.handle').focus();
    await page.keyboard.press('ArrowUp');
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
    await until('Weather\'s menu whole', () => unclipped(weather), problems => problems.length === 0);
    await page.keyboard.press('Escape');

    const last = page.locator('.settings [data-account]').last();
    const label = (await last.locator('.lines .t').textContent())!;
    await last.getByRole('button', {name: `${label} options`}).click();
    await until(`${label}'s menu whole`, () => unclipped(page.getByRole('menu', {name: `${label} options`})), problems => problems.length === 0);
    await page.keyboard.press('Escape');

    await page.locator('.settings .set-nav .nav', {hasText: 'Mail'}).click();
    await page.locator('.settings .rule', {hasText: 'Proseware alerts'}).waitFor();
    await page.getByRole('button', {name: 'Rule options'}).last().click();
    await until('the last rule\'s menu whole', () => unclipped(page.getByRole('menu', {name: 'Rule options'})), problems => problems.length === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
