// Motion and feedback (darma SV-59; DESIGN.md › Motion and Decided while building): a proposal's
// Cancel, a menu's button staying lit while it's open, and the app's failures reaching the one toast
// as failures. The toast's own motion is tests/components/toast.test.tsx's (SV-101).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, point, rested, startSetpoint, test} from './harness.ts';

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

test('a proposal\'s Cancel takes its card away at once, and the copy it leaves goes', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.rd-acts .btn', {hasText: 'Add to calendar'}).click();
    const proposal = page.getByRole('form', {name: 'Proposal: add to calendar'});
    await proposal.waitFor();
    await proposal.getByRole('button', {name: 'Cancel'}).click();
    const folding = page.locator('.prop[aria-hidden="true"]');
    assert.equal(await proposal.count(), 0, 'the card itself goes at once');
    await folding.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a menu\'s button stays lit while it\'s open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();

    // The reader's More: its button stays `sub2` with the pointer away while the menu is open.
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).click();
    const moreButton = page.getByRole('button', {name: 'More'});
    await moreButton.click();
    const more = page.getByRole('menu');
    await more.waitFor();
    await page.mouse.move(700, 28);
    // A pause for a "nothing happened" check: a fill letting go of the pointer would have faded by now.
    await page.waitForTimeout(200);
    await setpoint.idle();
    assert.equal(await rested(() => style(moreButton, 'background-color')), await rested(() => colour(page, '--sub2')), 'More stays lit');
    await page.keyboard.press('Escape');

    // A Settings row's menu; its … stays lit.
    await page.keyboard.press('Meta+,');
    const settings = page.locator('.settings');
    await settings.waitFor();
    const options = settings.getByRole('button', {name: 'Business options'});
    await options.click();
    const menu = settings.getByRole('menu', {name: 'Business options'});
    await menu.waitFor();
    await page.mouse.move(700, 28);
    // A pause for a "nothing happened" check: a fill letting go of the pointer would have faded by now.
    await page.waitForTimeout(200);
    await setpoint.idle();
    assert.equal(await rested(() => style(options, 'background-color')), await rested(() => colour(page, '--sub2')), 'the row\'s … stays lit');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await settings.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// The toast itself (its tone glyphs, hairline, the wait under the pointer, the fade, a failure's
// eight seconds) is tests/components/toast.test.tsx's (SV-101). Here, the
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
