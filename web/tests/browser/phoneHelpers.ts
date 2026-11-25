// What the phone's specs share (phoneShell, phoneInbox, phoneReader, phoneAgenda, phoneSwipe,
// phoneLists): the seed's counts and emails, the Inbox at 390 × 844 (board 21), an element's box once
// it rests, and a finger's swipe.
import assert from 'node:assert/strict';
import type {InboxOut, MailCountsOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {rested} from './harness.ts';
import type {Setpoint} from './harness.ts';

export const counts = (setpoint: Setpoint) => setpoint.api<MailCountsOut>('GET', '/mail/counts');

/** The seed's emails by the start of their subject. */
export async function email(setpoint: Setpoint, subject: string): Promise<number> {
  const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
  return inbox.groups.flatMap(group => group.rows).find(row => row.subject.startsWith(subject))!.id;
}

export async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  return page;
}

/** Leaves the composer's `sheet` with Cancel, then Save draft in the question it asks, the draft kept. */
export async function saveDraft(sheet: Locator) {
  await sheet.getByRole('button', {name: 'Cancel'}).tap();
  await sheet.page().getByRole('dialog', {name: 'Save this draft?'}).locator('.ph-bs-i', {hasText: 'Save draft'}).tap();
  await sheet.waitFor({state: 'detached'});
}

export const box = async (page: Page, selector: string) => (await rested(() => page.locator(selector).first().boundingBox()))!;

/**
 * A finger on `row` from x `from` to x `to`, in steps, then lifted, and the click the browser sends
 * after a press that didn't scroll (none for one Safari took as Back).
 */
export async function swipe(row: Locator, from: number, to: number, click = true) {
  await row.evaluate((element, [start, end, clicks]) => {
    // Sent to the row itself, so its height on screen doesn't matter.
    const y = 400;
    const fire = (type: string, x: number) => element.dispatchEvent(new PointerEvent(type, {bubbles: true, isPrimary: true, pointerId: 9, pointerType: 'touch', button: 0, clientX: x, clientY: y}));
    fire('pointerdown', start);
    for (const step of [0.1, 0.25, 0.5, 0.75, 1]) fire('pointermove', start + (end - start) * step);
    fire('pointerup', end);
    if (clicks) element.dispatchEvent(new MouseEvent('click', {bubbles: true, clientX: end, clientY: y}));
  }, [from, to, click] as const);
}

/**
 * From the next page load, a list's `scrollTo` lands at once and is recorded with the behaviour it
 * asked for, so a check reads where a glide ends and that it asked to glide, not its motion.
 */
export async function instantScrolls(page: Page) {
  await page.addInitScript(() => {
    const asked: string[] = [];
    (window as unknown as {scrollsAsked: string[]}).scrollsAsked = asked;
    const scrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function (this: Element, ...args: unknown[]) {
      const options = typeof args[0] === 'object' && args[0] ? args[0] as ScrollToOptions : {left: args[0] as number, top: args[1] as number};
      asked.push(options.behavior ?? 'auto');
      Reflect.apply(scrollTo, this, [{...options, behavior: 'instant'}]);
    } as typeof Element.prototype.scrollTo;
  });
}

/** The behaviours asked of `scrollTo` since the page loaded, in order (instantScrolls). */
export const scrollsAsked = (page: Page) => page.evaluate(() => (window as unknown as {scrollsAsked: string[]}).scrollsAsked);

/**
 * Each of `controls` takes a fingertip's tap: taps along a line through its centre land on it over at
 * least 44 px across and 44 px up and down (centred on it or not), and nothing else takes a tap on its
 * own drawn box, so a neighbour's grown hit area never covers it. Fails naming the control and how
 * far its tap reaches.
 */
export async function fingertips(controls: Locator[]) {
  for (const control of controls) {
    await control.scrollIntoViewIfNeeded();
    const missed = await control.evaluate(element => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      const owns = (px: number, py: number) => { const hit = document.elementFromPoint(px, py); return !!hit && element.contains(hit); };
      // The first whole pixel from the centre, in each direction, that a tap misses.
      const reach = (dx: number, dy: number) => { let step = 1; while (step < 60 && owns(x + dx * step, y + dy * step)) step++; return step; };
      const across = reach(-1, 0) + reach(1, 0) - 1, down = reach(0, -1) + reach(0, 1) - 1;
      const own: [number, number][] = [[box.left + 2, y], [box.right - 2, y], [x, box.top + 2], [x, box.bottom - 2]];
      const covered = own.some(([px, py]) => !owns(px, py));
      return across < 44 || down < 44 || covered ? `${across} × ${down}${covered ? ', its own box covered' : ''}` : null;
    });
    assert.equal(missed, null, `${await control.evaluate(element => element.getAttribute('aria-label') || element.textContent?.trim())} takes a tap ${missed}`);
  }
}
