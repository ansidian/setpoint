// Motion and feedback (darma SV-59; DESIGN.md › Motion and Decided while building): the one toast
// dropping in, leading with its tone's glyph, draining its Undo as a hairline and waiting under the
// pointer, then fading out.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, point, startSetpoint, until, watch} from './harness.ts';

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

test('the toast drops in over 180 ms and again when a new one replaces it, leads with its tone\'s glyph, drains Undo as a hairline, waits under the pointer, and fades out', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();

    // Done on Northwind: "Marked Done · Undo", led by `check` in `good`, dropping in over 180 ms.
    await point(page.locator('.arow', {hasText: 'Northwind Talent'}));
    await page.keyboard.press('h');
    const toast = page.locator('.toast');
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    assert.deepEqual([await style(toast, 'animation-name'), await style(toast, 'animation-duration')], ['toast-in', '0.18s']);
    assert.equal(await toast.locator('.tone').count(), 1);
    assert.equal(await style(toast.locator('.tone'), 'color'), await colour(page, '--good'));
    assert.equal(await toast.locator('.tone svg').getAttribute('width'), '16');
    // Its Undo's six seconds drain as a 2 px hairline, `ink3` at 45%.
    assert.deepEqual([await style(toast, 'height', '::after'), await style(toast, 'animation-duration', '::after'), await style(toast, 'animation-timing-function', '::after')], ['2px', '6s', 'linear']);
    assert.equal(await style(toast, 'background-color', '::after'), await colour(page, 'color-mix(in oklch, var(--ink3) 45%, transparent)'));

    // E on the next email replaces it with "Moved to Trash · Undo": a new toast, dropping in afresh,
    // led by `delete` in `ink3`.
    await toast.evaluate(element => element.setAttribute('data-first', ''));
    await page.locator('.arow', {hasText: 'Contoso University'}).click();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await page.keyboard.press('e');
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    assert.equal(await page.locator('.toast[data-first]').count(), 0, 'the replacing toast is a new one, so it drops in again');
    assert.equal(await style(toast.locator('.tone'), 'color'), await colour(page, '--ink3'));

    // Under the pointer it waits, its hairline held, past its six seconds.
    await toast.hover();
    await until('held', () => toast.getAttribute('class'), classes => classes?.split(' ').includes('held') ?? false);
    assert.equal(await style(toast, 'animation-play-state', '::after'), 'paused');
    // Nothing happens to wait for: the toast stays while held, past the 6 seconds it has.
    await page.waitForTimeout(6500);
    await setpoint.idle();
    assert.equal(await page.locator('.toast', {hasText: 'Moved to Trash'}).count(), 1, 'it waits under the pointer');
    // Left, it runs on with what it had left, then fades out over 120 ms before it goes.
    const classes = await watch(toast, 'class');
    await page.mouse.move(1, 1);
    await toast.waitFor({state: 'detached', timeout: 7000});
    assert.ok((await classes()).some(value => value?.split(' ').includes('leaving')), 'it fades out before it goes');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a failure\'s toast leads with `error` in `alert`, wears an `alert` ring and wash, and stays eight seconds; a refused copy is one', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    // A copy the clipboard refuses (#41, SV-55) is a failure, while its code is still in the Inbox.
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
    });
    await page.locator('.row', {hasText: 'Contoso Insurance'}).locator('button', {hasText: 'Copy'}).click();
    await page.locator('.toast.failed', {hasText: 'Couldn\'t copy it'}).locator('.tone').waitFor();

    await page.route(/\/api\/mail\/messages\/\d+\/pin$/, route => route.fulfill({status: 502, json: {error: {code: 'provider_failed', message: 'Gmail didn\'t answer in time.'}}}));
    await point(page.locator('.arow', {hasText: 'Northwind Talent'}));
    await page.keyboard.press('p');
    const toast = page.locator('.toast.failed', {hasText: 'Couldn\'t pin it, Gmail didn\'t answer in time.'});
    await toast.waitFor();
    assert.equal(await style(toast.locator('.tone'), 'color'), await colour(page, '--alert'));
    assert.match(await style(toast, 'box-shadow'), new RegExp(`^${(await colour(page, 'color-mix(in oklch, var(--alert) 40%, transparent)')).replace(/[()]/g, '\\$&')} 0px 0px 0px 1px inset`));
    assert.equal(await style(toast, 'background-color'), await colour(page, 'color-mix(in oklch, var(--alert) 8%, var(--cardOn))'));
    // Its words stay `ink`; it stays 8 seconds, so the provider's words can be read.
    assert.equal(await style(toast.locator('span:not(.tone)'), 'color'), await colour(page, '--ink'));
    assert.equal(await style(toast, '--toast-ms'), '8000ms');
    // A line with no action has no hairline.
    assert.equal(await style(toast, 'content', '::after'), 'none');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
