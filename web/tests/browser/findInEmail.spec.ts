// Find in email with the app around it, on the seed's cabin conversation:
// - ⌘F with an email open searches that email: a match in a collapsed email, inside an HTML email's
//   frame and in the oldest email's folded quoted history opens what holds it and is marked and in
//   view, while a newer email's folded quote, which repeats the emails above it, finds nothing; Esc
//   folds back what it opened and gives the field back to the Inbox
// - `/` with an email open, and ⌘F with none open, search the Inbox
// - the field's focus dims the page around its scope, and a click on a dimmed part ends it and does
//   what it does
// - the phone's Find in email, from the reader's More, with ↑ / ↓ and Done
// The field's own rules (count, steps, Backspace, folding back) are the component test's.
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {AllOut, MessageRowOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const SUBJECT = 'Re: Cabin weekend in November';

/**
 * Theo's cabin conversation, his "board games" email an HTML reply over a Gmail quote that asks for a
 * thermos, and its first email an HTML one over a forwarded note about a hammock.
 */
async function cabin(setpoint: Setpoint): Promise<{latest: MessageRowOut; ids: number[]}> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  const latest = all.days.flatMap(day => day.rows).find(row => row.from_name === 'Theo Walsh')!;
  const ids = latest.thread!.ids;
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.prepare('UPDATE message_bodies SET body_html = ? WHERE message_id = ?').run(
      '<div dir="ltr">Got it, thanks. Could you bring the board games and a cooler?</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Sep 29, 2026 at 12:15 PM User wrote:</div><blockquote class="gmail_quote">Should I bring anything? I have a thermos.</blockquote></div>', ids[4]!);
    database.prepare('UPDATE message_bodies SET body_html = ? WHERE message_id = ?').run(
      '<div dir="ltr">Passing this on for the weekend.</div><div class="gmail_quote"><div class="gmail_attr">On Fri, Sep 26, 2026 at 9:02 AM Mara wrote:</div><blockquote class="gmail_quote">The cabin has a hammock on the porch.</blockquote></div>', ids[0]!);
  } finally {
    database.close();
  }
  return {latest, ids};
}

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
const count = (page: Page) => page.locator('.search .find-count').textContent();
const dim = (page: Page) => page.evaluate(() => document.querySelector('.app')?.getAttribute('data-dim') ?? null);
const shape = (page: Page) => page.locator('.cv > [data-email]').evaluateAll(found => found.map(one => (one.classList.contains('cv-mail') ? 'E' : 'c')).join(''));

/** The current match on the page itself: its words, and whether it's inside what the reader's scroller shows. */
const currentMatch = (page: Page) => page.evaluate(() => {
  const range = [...(CSS.highlights.get('setpoint-find-current') as Iterable<Range> | undefined) ?? []][0];
  if (!range) return null;
  const box = range.getBoundingClientRect();
  const pane = document.querySelector('.rd-scroll')!.getBoundingClientRect();
  return {text: range.toString(), shown: box.top >= pane.top && box.bottom <= pane.bottom};
});

/** The current match inside an email's frame, and whether the reader's scroller shows it. */
async function frameMatch(page: Page, id: number) {
  const element = await page.locator(`.cv-mail[data-email="${id}"] iframe.mailframe`).elementHandle();
  const frame = await element?.contentFrame();
  if (!element || !frame) return null;
  const inFrame = await frame.evaluate(() => {
    const range = [...(CSS.highlights.get('setpoint-find-current') as Iterable<Range> | undefined) ?? []][0];
    if (!range) return null;
    const box = range.getBoundingClientRect();
    const root = document.documentElement.getBoundingClientRect();
    const scale = document.documentElement.clientWidth / root.width;
    return {text: range.toString(), top: (box.top - root.top) * scale, bottom: (box.bottom - root.top) * scale};
  });
  if (!inFrame) return null;
  const place = (await element.boundingBox())!;
  const pane = (await page.locator('.rd-scroll').boundingBox())!;
  return {text: inFrame.text, shown: place.y + inFrame.top >= pane.y && place.y + inFrame.bottom <= pane.y + pane.height};
}

test('⌘F with an email open searches it: a match in a collapsed email, in an HTML email\'s frame and in its folded history opens what holds it, marked and in view; Esc folds back and gives the field to the Inbox', async () => {
  const setpoint = await startSetpoint();
  try {
    const {latest, ids} = await cabin(setpoint);
    const page = await setpoint.page('target');
    // Theo's HTML email's page is held until the words are typed, so it answers after the last of them.
    let typed = () => {};
    const done = new Promise<void>(resolve => {
      typed = resolve;
    });
    await page.route(new RegExp(`/api/mail/messages/${ids[4]}/body`), async route => {
      await done;
      await route.continue();
    });
    await page.goto(`${setpoint.base}/inbox/${latest.id}`);
    await page.locator('.cv > [data-email]').first().waitFor();
    const folded = await until('the stack', () => shape(page), shown => shown.length === ids.length);

    await page.keyboard.press('Meta+f');
    await until('the field searches the email', () => focused(page), label => label === `Search ${SUBJECT}`);
    assert.equal(await dim(page), 'email');
    // Theo's HTML email and the user's plain answer, both collapsed.
    await page.keyboard.type('cooler');
    typed();
    await until('the count', () => count(page), line => line === '1 of 2');
    await until('the HTML email opens, its match marked and in view', () => frameMatch(page, ids[4]!), match => match?.text === 'cooler' && match.shown);
    await page.keyboard.press('Enter');
    await until('the count', () => count(page), line => line === '2 of 2');
    await until('the plain email opens, its match marked and in view', () => currentMatch(page), match => match?.text === 'cooler' && match.shown);
    assert.equal(await focused(page), `Search ${SUBJECT}`, 'Enter keeps the keys');
    assert.equal(await dim(page), 'email');

    // Only in a newer email's folded quote, which repeats the emails above it: nothing.
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('thermos');
    await until('the count', () => count(page), line => line === 'No matches');
    // Only in the oldest email's folded history: it opens to the email's whole page.
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('hammock');
    await until('the count', () => count(page), line => line === '1 of 1');
    await until('the whole email', () => page.locator(`.cv-mail[data-email="${ids[0]}"] iframe.mailframe`).getAttribute('src'), src => src === `/api/mail/messages/${ids[0]}/body?images=hide`);
    await until('the history\'s match marked and in view', () => frameMatch(page, ids[0]!), match => match?.text === 'hammock' && match.shown);

    await page.keyboard.press('Escape');
    await until('folded back', () => shape(page), shown => shown === folded);
    assert.equal(await dim(page), null);
    assert.equal(await page.locator('.search input').getAttribute('placeholder'), 'Search inbox');
    await until('no match marked', () => currentMatch(page), match => match === null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('`/` with an email open searches the Inbox, a click on the dimmed list ends the search\'s focus and opens what it hit, and ⌘F with no email open searches the Inbox', async () => {
  const setpoint = await startSetpoint();
  try {
    const {latest} = await cabin(setpoint);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox/${latest.id}`);
    await page.locator('.cv > [data-email]').first().waitFor();

    await page.keyboard.press('/');
    await until('the field searches the Inbox', () => focused(page), label => label === 'Search inbox');
    assert.equal(await dim(page), 'page');
    // A click on the list still lands: the field lets go and the row opens.
    const other = page.locator(`.list .row[data-id]:not([data-id="${latest.id}"])`).first();
    const id = await other.getAttribute('data-id');
    await other.click();
    await until('the row opens', () => page.evaluate(() => location.pathname), at => at === `/inbox/${id}`);
    assert.equal(await dim(page), null);

    // Esc closes the email: with none open ⌘F searches the Inbox.
    await page.keyboard.press('Escape');
    await until('no email open', () => page.evaluate(() => location.pathname), at => at === '/inbox');
    await page.keyboard.press('Meta+f');
    await until('the field searches the Inbox', () => focused(page), label => label === 'Search inbox');
    assert.equal(await dim(page), 'page');
    await page.keyboard.press('Escape');
    assert.equal(await dim(page), null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone, the reader\'s More offers Find in email: its field at the reader\'s top steps with ↑ and ↓, and Done ends it', async () => {
  const setpoint = await startSetpoint();
  try {
    const {latest, ids} = await cabin(setpoint);
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox/${latest.id}`);
    await page.locator('.cv > [data-email]').first().waitFor();
    const folded = await until('the stack', () => shape(page), shown => shown.length === ids.length);

    await page.locator('.ph-acts button', {hasText: 'More'}).click();
    await page.getByRole('dialog', {name: 'More'}).getByText('Find in email').click();
    await until('the field searches the email', () => focused(page), label => label === `Search ${SUBJECT}`);
    await page.keyboard.type('cooler');
    await until('the count', () => count(page), line => line === '1 of 2');
    await page.getByRole('button', {name: 'Next match'}).click();
    await until('the count', () => count(page), line => line === '2 of 2');
    await until('the plain email\'s match marked and in view', () => currentMatch(page), match => match?.text === 'cooler' && match.shown);
    await page.getByRole('button', {name: 'Previous match'}).click();
    await until('the count', () => count(page), line => line === '1 of 2');

    await page.getByRole('button', {name: 'Done'}).click();
    await rested(() => page.locator('.ph-back').waitFor());
    await until('folded back', () => shape(page), shown => shown === folded);
    assert.equal(await dim(page), null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
