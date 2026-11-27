// Every page keeps its place while the app is open, with the app around it, on a fresh seed each:
// - the Inbox's open email, the reader's place in it and the list's row at the top come back after
//   2 and 1, and with a search showing its field, results and open result, with nothing focused
// - 1 on the Inbox goes to its fresh start, and an email trashed meanwhile comes back closed
// - Back returns to the kept place too
// - the Calendar's month and open item come back, a draft with no field focused, and 2 on it goes fresh
// - the phone's tabs keep the list's place, and the current tab goes fresh
// A place is anchored to rows, so each check asks which row or email is in view, never a scroll offset.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {AllOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

// Short enough that the cabin conversation scrolls in the reader.
const SHORT = {width: 1677, height: 640};

const LIST = '.main > .content > .list';
const path = (page: Page) => new URL(page.url()).pathname;

/** The key of the list's first row in view, under its top edge. */
const topRow = (page: Page) => page.evaluate(list => {
  const box = document.querySelector(list)!;
  const top = box.getBoundingClientRect().top;
  return [...box.querySelectorAll<HTMLElement>('[data-key]')].find(row => row.getBoundingClientRect().bottom > top + 1)?.dataset.key ?? null;
}, LIST);

/** The id of the reader's first email in view. */
const topEmail = (page: Page) => page.evaluate(() => {
  const box = document.querySelector('.rd-scroll')!;
  const top = box.getBoundingClientRect().top;
  return [...box.querySelectorAll<HTMLElement>('.cv > [data-email]')].find(email => email.getBoundingClientRect().bottom > top + 1)?.dataset.email ?? null;
});

/** Brings a row to the top of its list, as scrolling there would. */
const toTop = (page: Page, selector: string) => page.locator(selector).first().evaluate(row => row.scrollIntoView({block: 'start'}));

const focusedTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName ?? null);
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** 2, then 1: to the Calendar and back. */
async function calendarAndBack(page: Page) {
  await page.keyboard.press('2');
  await until('the Calendar', async () => path(page), now => now.startsWith('/calendar'));
  await page.keyboard.press('1');
  await until('the Inbox', async () => path(page), now => now.startsWith('/inbox'));
}

async function cabin(page: Page): Promise<number> {
  const all = await page.evaluate(() => fetch('/api/mail/all?limit=500').then(answer => answer.json() as Promise<AllOut>));
  return all.days.flatMap(day => day.rows).find(row => row.from_name === 'Theo Walsh')!.id;
}

test('an email open comes back after 2 and 1: the same email at the same place in it, the list at the same row', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page(SHORT);
    await page.goto(`${setpoint.base}/inbox`);
    const theo = await cabin(page);
    // The list scrolled to a row well down it, then the cabin conversation opened from its row.
    const rows = page.locator(`${LIST} .row[data-key][data-id]`);
    const row = (await rows.nth(20).getAttribute('data-key'))!;
    await toTop(page, `${LIST} .row[data-key="${row}"]`);
    await page.locator(`${LIST} .row[data-id="${theo}"]`).first().click();
    await page.locator('.rd-subj', {hasText: 'Cabin weekend'}).waitFor();
    // Read on to the conversation's third email.
    const third = (await page.locator('.cv > [data-email]').nth(2).getAttribute('data-email'))!;
    await toTop(page, `.cv > [data-email="${third}"]`);
    await toTop(page, `${LIST} .row[data-key="${row}"]`);
    const key = await rested(() => topRow(page));

    await calendarAndBack(page);
    assert.equal(path(page), `/inbox/${theo}`);
    await page.locator('.rd-subj', {hasText: 'Cabin weekend'}).waitFor();
    await until('the reader at the third email', () => topEmail(page), shown => shown === third);
    await until('the list at its row', () => topRow(page), shown => shown === key);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a search comes back after 2 and 1: its field, results and open result, with nothing focused or dimmed', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.getByRole('combobox', {name: 'Search inbox'}).fill('cabin');
    const result = page.locator('.search-list [data-key]', {hasText: 'Cabin weekend'}).first();
    await result.click();
    await page.locator('.rd-subj', {hasText: 'Cabin weekend'}).waitFor();
    const opened = path(page);
    await blur(page);

    await calendarAndBack(page);
    assert.equal(path(page), opened);
    assert.equal(await page.getByRole('combobox', {name: 'Search inbox'}).inputValue(), 'cabin');
    await result.waitFor();
    await page.locator('.rd-subj', {hasText: 'Cabin weekend'}).waitFor();
    assert.equal(await focusedTag(page), 'BODY');
    assert.equal(await page.locator('.app').getAttribute('data-dim'), null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('1 on the Inbox goes to its fresh start: no email, no search, at its top; Back returns to the kept place', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const first = await rested(() => topRow(page));
    const rows = page.locator(`${LIST} .row[data-key][data-id]`);
    await toTop(page, `${LIST} .row[data-key="${await rows.nth(20).getAttribute('data-key')}"]`);
    const key = await rested(() => topRow(page));
    await rows.nth(21).click();
    await page.locator('.pane .rd-subj').waitFor();
    const opened = path(page);

    // Away and Back: the same place.
    await page.keyboard.press('2');
    await until('the Calendar', async () => path(page), now => now.startsWith('/calendar'));
    await page.goBack();
    await until('Back to the email', async () => path(page), now => now === opened);
    await until('the list at its row', () => topRow(page), shown => shown === key);

    await page.keyboard.press('1');
    await until('the plain Inbox', async () => path(page), now => now === '/inbox');
    await page.locator('.pane .rd-subj').waitFor({state: 'detached'});
    await until('the list at its top', () => topRow(page), shown => shown === first);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an email trashed while away comes back closed, the list at its kept row', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const rows = page.locator(`${LIST} .row[data-key][data-id]`);
    // A row well up the list, so it can still scroll there once a row below has gone.
    const mark = (await rows.nth(8).getAttribute('data-key'))!;
    // An email of its own, so trashing it brings no earlier email of a conversation into the list.
    const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
    const alone = new Set(all.days.flatMap(day => day.rows).filter(row => (row.thread?.ids.length ?? 1) <= 1).map(row => row.id));
    const ids = (await rows.evaluateAll(found => found.map(row => Number((row as HTMLElement).dataset.id)))).slice(9);
    const id = ids.find(one => alone.has(one))!;
    const row = page.locator(`${LIST} .row[data-id="${id}"]`).first();
    await row.evaluate(element => element.scrollIntoView({block: 'nearest'}));
    await row.click();
    await toTop(page, `${LIST} .row[data-key="${mark}"]`);
    const key = await rested(() => topRow(page));
    await page.locator('.pane .rd-subj').waitFor();

    await page.keyboard.press('2');
    await until('the Calendar', async () => path(page), now => now.startsWith('/calendar'));
    // Opening it read it, which the server sends on first: the trash is taken once that's through.
    await until('the trash taken', () => setpoint.api('POST', `/mail/conversations/${id}/trash`, {}).then(() => true, (failure: Error) => {
      if (!failure.message.includes('command_pending')) throw failure;
      return false;
    }), taken => taken);
    await page.keyboard.press('1');
    await until('the Inbox with nothing open', async () => path(page), now => now === '/inbox');
    await page.locator(`${LIST} .row[data-id="${id}"]`).waitFor({state: 'detached'});
    await until('the list at its row', () => topRow(page), shown => shown === key);
    assert.equal(await page.locator('.pane .rd-subj').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the Calendar\'s month and open item come back after 1 and 2, a draft with no field focused, and 2 on it goes fresh', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.keyboard.press('n');
    await until('November', () => page.title(), title => title.startsWith('November 2026'));
    await page.locator('.ev', {hasText: 'Veterans Day'}).first().click();
    await until('the item open', async () => path(page), now => now.startsWith('/calendar/item/'));
    const opened = path(page);

    await page.keyboard.press('1');
    await until('the Inbox', async () => path(page), now => now.startsWith('/inbox'));
    await page.keyboard.press('2');
    await until('the item again', async () => path(page), now => now === opened);
    await until('November again', () => page.title(), title => title.startsWith('November 2026'));
    await page.locator('.ev.sel', {hasText: 'Veterans Day'}).waitFor();

    // 2 on the Calendar: today's month, nothing open.
    await page.keyboard.press('2');
    await until('the plain Calendar', async () => path(page), now => now === '/calendar');
    await until('October', () => page.title(), title => title.startsWith('October 2026'));

    // A draft left by clicking out of its field comes back as it was, nothing focused.
    await page.keyboard.press('c');
    const line = page.locator('.editor .nl-input');
    await line.waitFor();
    await page.keyboard.type('Coffee with Sam');
    await blur(page);
    await page.keyboard.press('1');
    await until('the Inbox', async () => path(page), now => now.startsWith('/inbox'));
    await page.keyboard.press('2');
    await until('the draft again', () => line.inputValue(), text => text === 'Coffee with Sam');
    assert.equal(await focusedTag(page), 'BODY');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone\'s tabs keep the Inbox\'s place, and its tab on the Inbox goes fresh, at its top', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    const first = await rested(() => topRow(page));
    const rows = page.locator(`${LIST} .row[data-key][data-id]`);
    await toTop(page, `${LIST} .row[data-key="${await rows.nth(20).getAttribute('data-key')}"]`);
    const key = await rested(() => topRow(page));

    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda').waitFor();
    await page.locator('.ph-tab', {hasText: 'Inbox'}).tap();
    await until('the list at its row', () => topRow(page), shown => shown === key);

    await page.locator('.ph-tab', {hasText: 'Inbox'}).tap();
    await until('the list at its top', () => topRow(page), shown => shown === first);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
