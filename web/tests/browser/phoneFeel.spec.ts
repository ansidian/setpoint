// The phone feeling native (darma SV-66; DESIGN.md › Phone and Decided while building #255–#264), at
// 390 × 844 with touch: the reader's actions sharing the bar, the unread dot on an email marked
// unread, the slide over the list and back, search's way out, the tab bar, the safe-area insets and
// the theme colour, the list's type a step up, the agenda's today, now and chips, and the sign-in
// card clear of the keyboard. phone.spec.ts has board 21 and the phone's flows.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {InboxOut} from '@setpoint/shared';
import {deepLinkPath} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, startSetpoint, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** The seed's emails by the start of their subject. */
async function email(setpoint: Setpoint, subject: string): Promise<number> {
  const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
  return inbox.groups.flatMap(group => group.rows).find(row => row.subject.startsWith(subject))!.id;
}

async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.arow').first().waitFor();
  return page;
}

/** A token's colour as the page computes it, to compare with an element's. */
const tokenColour = (page: Page, token: string) => page.evaluate(name => {
  const probe = document.body.appendChild(document.createElement('span'));
  probe.style.color = `var(--${name})`;
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

/** The reader's bottom bar: each action's label, width, label colour and weight, and icon colour. */
const actionBar = (page: Page) => page.locator('.ph-acts button').evaluateAll(buttons => buttons.map(button => ({
  label: button.textContent,
  width: Math.round(button.getBoundingClientRect().width),
  colour: getComputedStyle(button).color,
  weight: getComputedStyle(button).fontWeight,
  icon: getComputedStyle(button.querySelector('.icon')!).color,
})));

/** Computed styles of the first match. */
const styles = (page: Page, selector: string, names: string[]) => page.locator(selector).first().evaluate((element, keys) => {
  const style = getComputedStyle(element);
  return keys.map(key => style.getPropertyValue(key));
}, names);

test('the reader\'s actions share the bar evenly, Done leads in `good`, and none moves in as the email arrives', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // The deep links' emails, while they're in the Inbox: an FYI one read below leaves it.
    const links = [[await email(setpoint, 'Interview availability'), 'Interview availability', ['Done', 'Trash', 'Mark unread', 'Open in Gmail']], [await email(setpoint, 'Bill is ready'), 'Bill is ready', ['Trash', 'Mark unread']]] as const;
    const page = await inbox(setpoint);
    const colours = {ink: await tokenColour(page, 'ink'), ink2: await tokenColour(page, 'ink2'), good: await tokenColour(page, 'good')};
    // Attention mail: four, a quarter each of the bar's 374 px; Done's label `ink` 500 and its check `good`, the rest `ink2` under `ink` icons.
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    const four = await actionBar(page);
    assert.deepEqual(four.map(action => action.label), ['Done', 'Trash', 'Mark unread', 'Open in Gmail']);
    assert.deepEqual(four.map(action => action.width), [94, 94, 94, 94]);
    assert.deepEqual(four.map(action => [action.colour, action.weight, action.icon]), [
      [colours.ink, '500', colours.good], [colours.ink2, '400', colours.ink], [colours.ink2, '400', colours.ink], [colours.ink2, '400', colours.ink],
    ]);
    await page.locator('.ph-back').tap();

    // Gmail mail that isn't Attention: three, a third each, Trash leading (#93).
    await page.locator('.row', {hasText: 'Woodgrove Bank'}).tap();
    await page.locator('.rd-subj', {hasText: 'Statement ready'}).waitFor();
    assert.deepEqual((await actionBar(page)).map(action => [action.label, action.width]), [['Trash', 125], ['Mark unread', 125], ['Open in Gmail', 125]]);
    await page.locator('.ph-back').tap();

    // iCloud mail: two, a half each, no Open in Gmail.
    await page.locator('.row', {hasText: 'Proseware'}).tap();
    await page.locator('.rd-subj', {hasText: 'Bill is ready'}).waitFor();
    assert.deepEqual((await actionBar(page)).map(action => [action.label, action.width]), [['Trash', 187], ['Mark unread', 187]]);

    // A deep link while the email is on its way: the bar holds what it will show, or nothing, and
    // nothing moves along when the email arrives (Done once drew late and pushed the rest right).
    for (const [id, subject, labels] of links) {
      let release!: () => void;
      const held = new Promise<void>(resolve => (release = resolve));
      await page.route(`**/api/mail/messages/${id}`, async route => {
        await held;
        await route.continue();
      });
      const going = page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id})}`);
      await page.locator('.pane .ph-acts').waitFor();
      await page.locator('.list .arow').first().waitFor();
      const before = (await actionBar(page)).map(action => action.label);
      assert.ok(before.length === 0 || JSON.stringify(before) === JSON.stringify(labels), `before the email: ${JSON.stringify(before)}`);
      release();
      await going;
      await page.locator('.rd-subj', {hasText: subject}).waitFor();
      assert.deepEqual((await actionBar(page)).map(action => action.label), labels);
      await page.unroute(`**/api/mail/messages/${id}`);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark unread on the phone puts the unread dot before the subject, popping in with the swapped icon; Mark read takes it away', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    assert.equal(await page.locator('.rd-subj .rd-unread').count(), 0);
    // The first draw doesn't pop.
    assert.equal(await page.locator('.ph-acts .ph-swap').count(), 0);
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).waitFor();
    const dot = page.locator('.rd-subj .rd-unread');
    // It and the icon scale in from .4 over 120 ms: read from the animation, then measured once it's over.
    assert.deepEqual(await page.locator('.ph-acts .ph-swap').evaluate(element => [getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]), ['ph-pop', '0.12s']);
    await until('the dot has popped in', () => dot.evaluate(element => element.getAnimations().length), running => running === 0);
    // The list's dot: 6 px `ink`, 10 px before the subject, in its line's middle.
    const look = await dot.evaluate(element => {
      const style = getComputedStyle(element);
      const line = element.parentElement!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const words = document.createRange();
      words.setStart(element.parentElement!.lastChild!, 0);
      words.setEnd(element.parentElement!.lastChild!, 1);
      const first = words.getClientRects()[0]!;
      return {size: [box.width, box.height], colour: style.backgroundColor, gap: Math.round(first.left - box.right), middle: Math.abs((box.top + box.bottom) / 2 - (first.top + first.bottom) / 2) <= 2,
        inLine: box.top >= line.top, animation: [style.animationName, style.animationDuration]};
    });
    assert.deepEqual(look, {size: [6, 6], colour: await tokenColour(page, 'ink'), gap: 10, middle: true, inLine: true, animation: ['ph-pop', '0.12s']});
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).waitFor();
    assert.equal(await dot.count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});


test('phone search: a clear button where the hint was, no Mark all as read meanwhile, and Back to Search from a result', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const markAll = page.locator('.hd button[aria-label="Mark all as read"]');
    await page.locator('.arow', {hasText: 'Northwind Talent'}).tap();
    assert.equal(await page.locator('.ph-back').textContent(), 'Inbox');
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);

    await page.locator('.search input').tap();
    await page.keyboard.type('northwind');
    await page.locator('.search-list .result').first().waitFor();
    // The way out, where the desktop's Esc hint is: 32 px round, an 18 px `close` in `ink3`, 4 px in
    // from the field's border (8 px into its 12 px padding).
    const clear = page.locator('.search .search-clear');
    const [field, button, icon] = [await page.locator('.hd > .search').boundingBox(), await clear.boundingBox(), await clear.locator('svg').boundingBox()];
    assert.deepEqual([button!.width, button!.height, icon!.width, Math.round(field!.x + field!.width - 1 - (button!.x + button!.width))], [32, 32, 18, 4]);
    assert.deepEqual(await styles(page, '.search .search-clear', ['color', 'border-radius']), [await tokenColour(page, 'ink3'), '999px']);
    assert.equal(await page.locator('.search .kbd').count(), 0);
    // Mark all as read would read the hidden Inbox's mail, not the results: it's gone while searching.
    assert.equal(await markAll.count(), 0);
    // An email from the results goes back to them.
    await page.locator('.search-list .result', {hasText: 'Interview availability'}).tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.equal(await page.locator('.ph-back').textContent(), 'Search');
    await page.locator('.ph-back').tap();
    await until('back at the results', () => page.locator('.pane').count(), count => count === 0);
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.ok(await page.locator('.search-list .result').first().isVisible());
    // One tap leaves search: the field empties and lets go, and the Inbox and Mark all as read come back.
    await clear.tap();
    await page.locator('.content > .list .gh').first().waitFor();
    assert.equal(await page.locator('.search input').inputValue(), '');
    assert.equal(await page.locator('.hd-title').textContent(), 'Inbox');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
    assert.equal(await clear.count(), 0);
    await markAll.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
