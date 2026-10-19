// Motion and feedback (darma SV-59; DESIGN.md › Motion and Decided while building): every menu,
// popover and modal arriving with the 180 / 260 ms motion and ⌘K, Settings and the "+N" popover
// fading out over 120 ms; panes and cards sliding in; the app's failures reaching the one toast as
// failures. The toast's own motion is tests/components/toast.test.tsx's (SV-101).
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, point, rested, startSetpoint, until, watch} from './harness.ts';

after(cleanUp);

/** A colour as the page computes it: a token (`good`) or any colour expression, on a probe. */
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

const style = (target: Locator, property: string, pseudo?: string) => target.evaluate((element, [name, after]) => getComputedStyle(element, after ?? null).getPropertyValue(name!), [property, pseudo] as const);

/** The entrance an element plays: its animation's name and duration. */
const entrance = async (target: Locator) => [await style(target, 'animation-name'), await style(target, 'animation-duration')];

/** Its transform's origin as a share of its box, rounded: [0, 0] top left, [1, 1] bottom right. */
const origin = (target: Locator) => target.evaluate(element => {
  const [x, y] = getComputedStyle(element).transformOrigin.split(' ').map(parseFloat);
  const box = element as HTMLElement;
  return [Math.round(x! / box.offsetWidth * 100) / 100, Math.round(y! / box.offsetHeight * 100) / 100];
});

test('menus and popovers grow in from their anchor over 180 ms; ⌘K, Settings and the "+N" popover arrive and fade out with their scrims; panes and cards slide in, and a closed card folds away', async () => {
  const setpoint = await startSetpoint({fixtures: ['busy-saturday']});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();

    // The reading pane's content slides in 12 px over 180 ms; J keeps the pane, so it doesn't again.
    await page.locator('.list .row[title^="Interview availability"]').click();
    const tools = page.locator('.pane > .rd-tools');
    await tools.waitFor();
    assert.deepEqual(await rested(() => entrance(tools)), ['pane-in', '0.18s']);
    await tools.evaluate(element => element.setAttribute('data-first', ''));
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await page.keyboard.press('j');
    await page.locator('.rd-subj', {hasText: 'Your code is'}).waitFor();
    assert.equal(await page.locator('.pane > .rd-tools[data-first]').count(), 1, 'J swaps the email in the same pane');

    // The reader's More grows from its top right corner.
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).click();
    await page.getByRole('button', {name: 'More'}).click();
    const more = page.getByRole('menu');
    await more.waitFor();
    assert.deepEqual([await rested(() => entrance(more)), await rested(() => origin(more))], [['pop-in', '0.18s'], [1, 0]]);
    await page.keyboard.press('Escape');

    // A proposal slides into place; Cancel folds it away (a copy that takes nothing, gone in 180 ms).
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.rd-acts .btn', {hasText: 'Add to calendar'}).click();
    const proposal = page.getByRole('form', {name: 'Proposal: add to calendar'});
    await proposal.waitFor();
    assert.deepEqual(await rested(() => entrance(proposal)), ['card-in', '0.18s']);
    await proposal.getByRole('button', {name: 'Cancel'}).click();
    const folding = page.locator('.prop[aria-hidden="true"]');
    assert.equal(await proposal.count(), 0, 'the card itself goes at once');
    await folding.waitFor({state: 'detached'});

    // ⌘K rises in over 180 ms with its scrim, and fades out over 120 ms, focus back at once.
    await page.keyboard.press('Meta+k');
    const palette = page.locator('.palette');
    await palette.waitFor();
    assert.deepEqual([await rested(() => entrance(palette)), await rested(() => entrance(page.locator('.palette-scrim')))], [['pal-in', '0.18s'], ['scrim-in', '0.18s']]);
    const paletteClass = await watch(palette, 'class');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.palette') ?? null), null, 'focus is back on the page at once');
    await palette.waitFor({state: 'detached'});
    assert.ok((await paletteClass()).includes('palette closing'), 'it fades out first');

    // Settings rises over 260 ms with its scrim; a page switch fades its content up over 120 ms; a
    // row's menu grows from its button's top right; Esc fades it all out over 120 ms.
    await page.keyboard.press('Meta+,');
    const settings = page.locator('.settings');
    await settings.waitFor();
    assert.deepEqual([await rested(() => entrance(settings)), await rested(() => entrance(page.locator('.settings-scrim')))], [['set-in', '0.26s'], ['scrim-in', '0.26s']]);
    await settings.getByRole('button', {name: 'Business options'}).click();
    const options = settings.getByRole('menu', {name: 'Business options'});
    await options.waitFor();
    assert.deepEqual([await rested(() => entrance(options)), await rested(() => origin(options))], [['pop-in', '0.18s'], [1, 0]]);
    await page.keyboard.press('Escape');
    await options.waitFor({state: 'detached'});
    await settings.getByRole('button', {name: 'Mail', exact: true}).click();
    await settings.getByRole('heading', {name: 'Mail'}).waitFor();
    // The head fades up with its page, and draws its hairline as the page scrolls (settings-04).
    assert.deepEqual(await entrance(settings.locator('.set-main > .set-head')), ['set-page-in, set-head-edge', '0.12s, auto']);
    const settingsClass = await watch(settings, 'class');
    await page.keyboard.press('Escape');
    await settings.waitFor({state: 'detached'});
    assert.ok((await settingsClass()).includes('settings closing'), 'it fades out first');

    // The "+N" popover grows from its "+3", and fades out on Esc.
    await page.goto(`${setpoint.base}/calendar/2026-10-17`);
    const plus = page.locator('.cell[data-date="2026-10-17"] .more');
    await plus.click();
    const popover = page.getByRole('dialog', {name: 'Sat, Oct 17'});
    await popover.waitFor();
    assert.equal((await rested(() => entrance(popover)))[1], '0.18s');
    const [from, box, anchor] = await rested(() => Promise.all([
      popover.evaluate(element => getComputedStyle(element).transformOrigin.split(' ').map(parseFloat)),
      popover.evaluate(element => ({left: (element as HTMLElement).offsetLeft, top: (element as HTMLElement).offsetTop})),
      plus.evaluate(element => element.getBoundingClientRect()),
    ]));
    const section = await rested(() => page.locator('.cal-month').evaluate(element => element.getBoundingClientRect()));
    assert.equal(Math.round(box.left + from[0]!), Math.round(anchor.left - section.left + anchor.width / 2), 'it grows from the "+3" across');
    assert.ok(box.top + from[1]! <= anchor.bottom - section.top + 8, 'and from its foot down');
    const popoverClass = await watch(popover, 'class');
    await page.keyboard.press('Escape');
    await popover.waitFor({state: 'detached'});
    assert.ok((await popoverClass()).some(value => value?.split(' ').includes('closing')), 'it fades out first');

    // The editor opened by C slides in as the hand-off does.
    await page.keyboard.press('c');
    const editor = page.locator('.editor');
    await editor.waitFor();
    assert.deepEqual(await rested(() => entrance(editor)), ['pane-in', '0.18s']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A menu's shape and its first item's, and the item's fill under the pointer. */
async function menuShape(page: Page, menu: Locator, item: Locator) {
  await item.hover();
  // The 120 ms fill runs its course.
  await page.waitForTimeout(200);
  return {
    menu: [await style(menu, 'border-radius'), await style(menu, 'padding')],
    item: [await style(item, 'height'), await style(item, 'border-radius'), await style(item, 'padding-left'), await style(item, 'background-color') === await colour(page, '--sub2')],
  };
}

test('every menu is one component: radius 18 and 6 inside, 32 px items of radius 10 and 10 px, `sub2` under the pointer; its button stays lit while it\'s open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    const shape = {menu: ['18px', '6px'], item: ['32px', '10px', '10px', true]};

    // The reader's More: its button stays `sub2` with the pointer away while the menu is open.
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).click();
    const moreButton = page.getByRole('button', {name: 'More'});
    await moreButton.click();
    const more = page.getByRole('menu');
    await more.waitFor();
    await page.mouse.move(700, 28);
    // The button's 120 ms fill runs its course with the pointer gone.
    await page.waitForTimeout(200);
    assert.equal(await rested(() => style(moreButton, 'background-color')), await rested(() => colour(page, '--sub2')), 'More stays lit');
    assert.deepEqual(await rested(() => menuShape(page, more, more.getByRole('menuitem').first())), shape);
    await page.keyboard.press('Escape');

    // ⌘K's items take the same height, padding and fill.
    await page.keyboard.press('Meta+k');
    const palette = page.locator('.palette');
    await palette.waitFor();
    const second = palette.locator('.item').nth(1);
    await second.hover();
    await until('the pointer takes the cursor', () => second.getAttribute('class'), classes => classes === 'item cur');
    // The 120 ms fill runs its course.
    await page.waitForTimeout(200);
    assert.deepEqual([await rested(() => style(second, 'height')), await rested(() => style(second, 'padding-left')), await rested(() => style(second, 'background-color')) === await rested(() => colour(page, '--sub2'))], ['32px', '10px', true]);
    await page.keyboard.press('Escape');
    await palette.waitFor({state: 'detached'});

    // A Settings row's menu; its … stays lit.
    await page.keyboard.press('Meta+,');
    const settings = page.locator('.settings');
    await settings.waitFor();
    const options = settings.getByRole('button', {name: 'Business options'});
    await options.click();
    const menu = settings.getByRole('menu', {name: 'Business options'});
    await menu.waitFor();
    assert.deepEqual(await rested(() => menuShape(page, menu, menu.getByRole('menuitem').first())), shape);
    await page.mouse.move(700, 28);
    // The button's 120 ms fill runs its course with the pointer gone.
    await page.waitForTimeout(200);
    assert.equal(await rested(() => style(options, 'background-color')), await rested(() => colour(page, '--sub2')), 'the row\'s … stays lit');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settings.waitFor({state: 'detached'});

    // The editor's Reminder menu.
    await page.goto(`${setpoint.base}/calendar`);
    await page.keyboard.press('c');
    await page.getByLabel('Describe the event').fill('Dinner fri 7-9pm');
    await page.getByRole('button', {name: 'Add reminder', exact: true}).click();
    const reminders = page.locator('.editor .menu');
    await reminders.waitFor();
    assert.deepEqual(await rested(() => menuShape(page, reminders, reminders.locator('.menu-i').nth(1))), shape);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// The toast itself (its drop, tone glyphs, hairline, the wait under the pointer, the fade, a
// failure's ring, wash and eight seconds) is tests/components/toast.test.tsx's (SV-101). Here, the
// app's failures reach it as failures: a copy the clipboard refuses and a provider's refusal, in its words.
test('a failure\'s toast: a refused copy is one, and so is a pin Gmail refuses, in Gmail\'s words', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // A copy the clipboard refuses (#41, SV-55) is a failure, while its code is still in the Inbox.
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
    });
    await page.locator('.row', {hasText: 'Contoso Insurance'}).locator('button', {hasText: 'Copy'}).click();
    await page.locator('.toast.failed', {hasText: 'Couldn\'t copy it'}).locator('.tone').waitFor();

    await page.route(/\/api\/mail\/messages\/\d+\/pin$/, route => route.fulfill({status: 502, json: {error: {code: 'provider_failed', message: 'Gmail didn\'t answer in time.'}}}));
    await point(page.locator('.list .row[title^="Interview availability"]'));
    await page.keyboard.press('p');
    await page.locator('.toast.failed', {hasText: 'Couldn\'t pin it, Gmail didn\'t answer in time.'}).locator('.tone').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
