// Mail feels finished (the polish audit's mail slice, darma SV-63; DESIGN.md › Decided while building
// #197–#219), each by what it leaves on screen: Done moving an email into its day, the Today block's
// bar and warming time, the accounts folding away on Calendar, a pin out of the shelf's sight, the
// reader's J and K, code card and edge, a newsletter's images, and search's chips when nothing
// matches.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, point, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

/** A colour as the page computes it: a token (`--good`) or any colour. */
const colourOf = (page: Page, colour: string) => page.evaluate(value => {
  const probe = document.createElement('span');
  probe.style.color = value.startsWith('--') ? `var(${value})` : value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, colour);

test('SV-69, #243: Done moves an email out of New into its day, quiet with a Done tag; New\'s Attention counts what\'s left; the reader says Done; Undo puts it back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const lane = page.locator('.list.all .lh.att').first();
    await until('New\'s Attention lane', () => lane.textContent(), text => text === 'Attention 2');
    const fresh = page.locator('.list.all .row[data-key="new:5"]');
    const inDay = page.locator('.list.all .row[data-key="all:5"]');
    await fresh.click();
    await page.locator('.rd-tools .tool.done').waitFor();
    await page.keyboard.press('h');

    // It folds out of New and into today, where its text settles in `ink3` beside a Done tag. The
    // reader moves on to the next.
    await inDay.waitFor();
    assert.ok((await inDay.getAttribute('class'))!.split(' ').includes('done'));
    assert.equal(await inDay.locator('.tag').textContent(), 'Done');
    const ink3 = await rested(() => colourOf(page, '--ink3'));
    await until('Northwind quiet', () => inDay.locator('.from').evaluate(element => getComputedStyle(element).color), colour => colour === ink3);
    await until('it leaves New', () => fresh.count(), count => count === 0);
    assert.equal(await lane.textContent(), 'Attention 1');
    // Today's Attention lane, all of it Done, has no count.
    assert.equal(await page.locator('.list.all .lh.att').nth(1).textContent(), 'Attention');
    await until('the next email open', () => page.locator('.rd-subj').textContent(), text => !/Interview availability/.test(text ?? ''));

    // Back on it, the reader says it's Done where the button was.
    await inDay.click();
    const status = page.locator('.rd-tools .rd-done');
    await until('the reader\'s Done', () => status.textContent(), text => text === 'Done');
    assert.equal(await page.locator('.rd-tools .tool.done').count(), 0);
    assert.equal(await rested(() => status.locator('.icon').evaluate(element => getComputedStyle(element).color)), await rested(() => colourOf(page, '--good')));

    // Undo puts it back as it was: in New, no tag, Attention 2, and Done offered again.
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await fresh.waitFor();
    await until('it leaves its day', () => inDay.count(), count => count === 0);
    assert.equal(await fresh.locator('.tag').count(), 0);
    await until('Attention 2 again', () => lane.textContent(), text => text === 'Attention 2');
    await page.locator('.rd-tools .tool.done').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('shell-06, motion-04: the Today event leads with its calendar\'s bar and warms as it nears', async () => {
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

    // The bar in Personal's `cool`, in the rings' column; the time lines up with the task titles.
    const bar = dentist.locator('.evbar > i');
    assert.equal(await rested(() => bar.evaluate(element => getComputedStyle(element).backgroundColor)), await rested(() => colourOf(page, '--cool')));
    assert.equal(await rested(() => left(dentist, '.evbar')), await rested(() => left(rent, '.check')));
    assert.equal(await rested(() => left(dentist, '.t')), await rested(() => left(rent, '.title')));

    // At 9:12 AM "in 5h" is ink3; at 2:20 PM "in 10m" is caution 500; at 2:31 PM "now" is alert 500.
    const time = dentist.locator('.in');
    const look = async () => [await time.textContent(), ...await rested(() => time.evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).fontWeight]))];
    assert.deepEqual(await look(), ['in 5h', await rested(() => colourOf(page, '--ink3')), '400']);
    await page.clock.fastForward((5 * 60 + 8) * 60_000);
    await until('in 10m', look, seen => seen[0] === 'in 10m');
    assert.deepEqual(await look(), ['in 10m', await rested(() => colourOf(page, '--caution')), '500']);
    await page.clock.fastForward(11 * 60_000);
    await until('now', look, seen => seen[0] === 'now');
    assert.deepEqual(await look(), ['now', await rested(() => colourOf(page, '--alert')), '500']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('shell-08: the accounts fold away on Calendar and come back on the Inbox', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    const nav = (name: string) => page.locator('.sb .nav', {hasText: name});
    const accounts = page.locator('.sb-accts');

    // The accounts fold on Calendar, out of reach while folded, and come back on the Inbox.
    await nav('Calendar').click();
    await page.waitForURL(/\/calendar/);
    await until('the accounts folded', () => accounts.evaluate(element => element.getBoundingClientRect().height), height => height === 0);
    assert.equal(await accounts.evaluate(element => (element as HTMLElement).inert), true);
    await nav('Inbox').click();
    await page.waitForURL(/\/inbox/);
    await until('the accounts back', () => accounts.evaluate(element => element.getBoundingClientRect().height), height => height > 100);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Whether the shelf is in sight is inSight's, a table in inbox.test.ts; the bands' sticking and a
// pin with the shelf in view went with it, as both needed a scroll to set up, and scrolls race.
test('inbox-09: a pin out of the shelf\'s sight says so, with Undo, and lands on the shelf', async () => {
  const setpoint = await startSetpoint();
  try {
    // A short window, so the shelf starts below New, out of sight, with nothing scrolled.
    const page = await setpoint.page({width: 1677, height: 560});
    await page.goto(`${setpoint.base}/inbox`);
    // P on Consolidated Messenger near New's top: the toast says Pinned, with Undo; the row leaves
    // New for the shelf (#243).
    const pay = page.locator('.row:not(.shelf)', {hasText: 'Consolidated Messenger'});
    await point(pay);
    await page.keyboard.press('p');
    const toast = page.locator('.toast.pinned', {hasText: 'Pinned'});
    await toast.waitFor();
    await page.locator('.row.shelf', {hasText: 'Consolidated Messenger'}).waitFor();
    await until('it left New', () => pay.count(), count => count === 0);
    // Undo unpins it, back in New, and the toast goes.
    await toast.getByRole('button', {name: 'Undo'}).click();
    await until('back in New', () => pay.count(), count => count === 1);
    await until('the toast gone', () => page.locator('.toast').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('reader-03, -04, -09: J and K step through the emails with the tools staying; a code\'s card has Copy; the edge drags the pane and a double-click resets it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();

    await page.locator('.list .row[title="Interview availability for Software Engineer I"]').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    const tools = page.locator('.pane > .rd-tools');
    await tools.evaluate(element => element.setAttribute('data-first', ''));
    // J and K step to the next email and back, and a click opens one. The tools stay.
    await page.keyboard.press('j');
    await page.locator('.rd-subj', {hasText: 'Your code is 482913'}).waitFor();
    await page.keyboard.press('k');
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await page.locator('.list .row', {has: page.locator('.code-line')}).click();
    await page.locator('.rd-subj', {hasText: 'Your code is 482913'}).waitFor();
    assert.equal(await page.locator('.pane > .rd-tools[data-first]').count(), 1, 'the tools never swap');

    // The code email: a card after the sender, whose Copy puts the code on the clipboard.
    const card = page.locator('.rd-head .code-card');
    await card.waitFor();
    assert.equal(await card.evaluate(element => element.previousElementSibling?.className), 'rd-meta');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    await card.getByRole('button', {name: 'Copy'}).click();
    await card.getByRole('button', {name: 'Copied'}).waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '482913');

    // The edge drags the pane wider, and a double-click puts it back to 680.
    const pane = (await page.locator('.pane').boundingBox())!;
    const edge = page.locator('.pane-edge');
    await page.mouse.move(pane.x, pane.y + 300);
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
    // In New's Noise, folded until opened.
    await page.locator('.list .nfold.collapsed').first().click();
    await page.locator('.row', {hasText: 'Contoso Coffee'}).click();
    await page.locator('.imgbar', {hasText: 'Images hidden'}).waitFor();
    // Three 602-wide pictures at 150 each, their padding and the footer: never the ~100 px band it was.
    await until('the frame holds the newsletter', () => page.locator('.mailframe').evaluate(frame => frame.getBoundingClientRect().height), height => height > 450);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search-13: no results are the field\'s own chips, and × knocking one off takes the line with it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('north');
    await page.locator('.arow.result').first().waitFor();

    // No results: each part is the field's own chip, with no dots between them.
    await page.locator('.search input').fill('!confirmation march');
    await page.locator('.suggest').click();
    await until('their chips', () => page.locator('.search .qchip').count(), count => count === 2);
    await page.locator('.search input').click();
    await page.keyboard.type('zebra');
    const parts = page.locator('.no-results .part');
    await until('no results', () => parts.count(), count => count >= 2);
    assert.equal(await page.locator('.no-results .ink3').count(), 0);
    // Knocking off "zebra" leaves a search with emails, so the line goes rather than losing one chip.
    await parts.last().getByRole('button').click();
    await until('a chip knocked off, and the line gone with it', () => page.locator('.no-results').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
