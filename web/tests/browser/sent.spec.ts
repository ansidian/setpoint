// Sent in the browser, at the design target on a fresh seed each. The seed has sent mail from
// Personal, Work and iCloud, and none from Business or Jobs. From the sidebar's Sent to its list,
// each row naming who it went to, to an email with Sent's tools, Trash with Undo, and an empty
// account's view. Then search from Sent (sent mail only, in its account) and from the Inbox (sent mail
// with the rest). Tab and the quiet segments are components/sentAccounts.test.tsx's.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, holdToast, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const rows = (page: Page) => page.locator('.list .row:not(.leaving)');
const rowOf = (page: Page, subject: string) => rows(page).filter({hasText: subject});
const accountOf = (page: Page) => new URL(page.url()).searchParams.get('account');
const tools = (page: Page) => page.locator('.rd-tools .tool').allTextContents();
const results = (page: Page) => page.locator('.search-list .arow').evaluateAll(found => found.map(row => [row.querySelector('.from')?.getAttribute('aria-label') ?? row.querySelector('.from')?.textContent, row.querySelector('.l2')?.textContent]));

async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  return page;
}

async function search(page: Page, words: string) {
  await page.keyboard.press('/');
  await page.keyboard.type(words);
  await page.locator('.search-list:not(.pending) :is(.bar, .no-results, .arow)').first().waitFor();
}

test('the sidebar\'s Sent: its list names who each went to, an email opens with Trash and Open in Gmail, Trash has Undo, and an empty account says so', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    await page.locator('.sb .nav.sub', {hasText: 'Sent'}).click();
    await until('Sent opens', async () => new URL(page.url()).pathname, path => path === '/sent');
    await rowOf(page, 'Re: Saturday hike').waitFor();
    await until('the title', () => page.title(), title => title === 'Sent');
    assert.deepEqual(await page.locator('.hd .sent-accounts button').allTextContents(), ['All', 'Business', 'Personal', 'Work', 'Jobs', 'iCloud']);
    // Newest first, each naming its first recipient, and how many more.
    assert.deepEqual(await rows(page).evaluateAll(found => found.map(row => row.querySelector('.from')?.getAttribute('aria-label'))),
      ['To Priya Raman', 'To Sam Ortiz', 'To Mom', 'To Lena Fischer +1', 'To Ravi Menon +1', 'To Contoso Coffee', 'To Tailspin Toys Support']);

    // An email opens beside it with Sent's tools, and the head says who it went to.
    await rowOf(page, 'Lab notes for Friday').click();
    await page.locator('.rd-subj', {hasText: 'Lab notes for Friday'}).waitFor();
    assert.match(new URL(page.url()).pathname, /^\/sent\/\d+$/);
    assert.deepEqual(await tools(page), ['TrashE', 'Open in GmailO']);
    await until('the head names its recipients', () => page.locator('.rd-head .to').textContent(), text => text === 'to Ravi Menon +1');

    // E: out of the list, the next one opens, and Undo puts it back in the reader.
    await page.keyboard.press('e');
    await page.locator('.rd-subj', {hasText: 'Order 4417 arrived damaged'}).waitFor();
    await until('it left the list', () => rowOf(page, 'Lab notes for Friday').count(), count => count === 0);
    await holdToast(page);
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator('.rd-subj', {hasText: 'Lab notes for Friday'}).waitFor();
    await rowOf(page, 'Lab notes for Friday').waitFor();
    await page.keyboard.press('Escape');
    await until('Esc closes the reader', async () => new URL(page.url()).pathname, path => path === '/sent');

    // An account's own sent mail, then an account with none: its empty view, and Show All.
    await page.locator('.hd .sent-accounts button', {hasText: 'Work'}).click();
    await until('Work', async () => accountOf(page), account => account !== null);
    await until('only Work\'s', () => rows(page).count(), count => count === 2);
    await page.locator('.hd .sent-accounts button', {hasText: 'Jobs'}).click();
    await page.locator('.view-empty .ve-head', {hasText: 'Nothing sent from Jobs'}).waitFor();
    await page.locator('.view-empty button', {hasText: 'Show All'}).click();
    await until('Show All', async () => accountOf(page), account => account === null);
    await rowOf(page, 'Re: Saturday hike').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search from Sent covers sent mail only, in its account; from the Inbox it covers sent mail too, which reads "To …"', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    // The Inbox: received and sent mail together.
    await search(page, 'order');
    await until('sent mail with the rest', () => results(page), found => found.some(([from]) => from === 'To Contoso Coffee') && found.some(([from]) => !from?.startsWith('To ')));
    // A sent result opens with Sent's tools.
    await page.locator('.search-list .arow', {hasText: 'Order 4417 arrived damaged'}).click();
    await page.locator('.rd-subj', {hasText: 'Order 4417 arrived damaged'}).waitFor();
    assert.deepEqual(await tools(page), ['TrashE', 'Open in GmailO']);

    // Sent: sent mail only.
    await page.goto(`${setpoint.base}/sent`);
    await rowOf(page, 'Re: Saturday hike').waitFor();
    await search(page, 'order');
    await until('only the sent one', () => results(page), found => JSON.stringify(found) === JSON.stringify([['To Contoso Coffee', 'Order 4417 arrived damaged']]));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await rowOf(page, 'Re: Saturday hike').waitFor();

    // In an account: that account's sent mail only.
    await page.locator('.hd .sent-accounts button', {hasText: 'Work'}).click();
    await until('Work', async () => accountOf(page), account => account !== null);
    await until('only Work\'s', () => rows(page).count(), count => count === 2);
    await search(page, 'hike');
    await page.locator('.search-list .no-results', {hasText: 'No emails match'}).waitFor();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('.hd .sent-accounts button', {hasText: 'Personal'}).click();
    await until('Personal\'s', () => rows(page).count(), count => count === 3);
    await search(page, 'hike');
    await until('Personal\'s hike', () => results(page), found => JSON.stringify(found) === JSON.stringify([['To Sam Ortiz', 'Re: Saturday hike']]));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
