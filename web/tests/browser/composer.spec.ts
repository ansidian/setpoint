// The composer's journeys, at the design target on a fresh seed each, the server's clock held at the
// seed's moment so a held send stays held: Reply all from the keyboard, sent behind the "Sending"
// toast and brought back by Undo as it was; a send the provider refused, back on its email with the
// provider's words and Try again; and a draft that outlives a reload, its row saying "Draft". The
// fields, chips, the fold and the saving are components/composer.test.tsx's, a send that reaches the
// dev provider the server's (sendDev.test.ts).
import type {AllOut, DraftOut, DraftsOut} from '@setpoint/shared';
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {Page} from 'playwright-core';
import {cleanUp, holdToast, point, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

async function idOf(setpoint: Setpoint, subject: string): Promise<number> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  return all.days.flatMap(day => day.rows).find(row => row.subject === subject)!.id;
}

const drafts = async (setpoint: Setpoint) => (await setpoint.api<DraftsOut>('GET', '/mail/drafts')).drafts;
const composer = (page: Page) => page.locator('.pane .composer');
const chips = (page: Page, field: string) => composer(page).locator(`.cmp-row:has(input[aria-label="${field}"]) .cmp-chip`).evaluateAll(found => found.map(chip => chip.firstChild?.textContent));
const body = (page: Page) => composer(page).getByRole('textbox', {name: 'Message'});

async function openEmail(setpoint: Setpoint, id: number): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}/inbox/${id}`);
  await page.locator('.rd-subj').waitFor();
  return page;
}

test('A answers everyone: the composer opens under the email, ⌘Enter sends behind "Sending", and Undo brings it back as it was', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Dinner Friday?');
    const page = await openEmail(setpoint, id);
    await page.locator('.rd-tools .tool', {hasText: 'Reply all'}).waitFor();
    await page.keyboard.press('a');
    await body(page).waitFor();
    assert.deepEqual(await chips(page, 'To'), ['Sam Lee', 'June Park']);
    assert.deepEqual(await chips(page, 'Cc'), ['Ravi Menon']);
    // The email stays above it.
    await page.locator('.rd-scroll .mailtext', {hasText: 'Blue Door at 7?'}).waitFor();
    await page.keyboard.type('Friday works. See you at 7.');

    await page.keyboard.press('Meta+Enter');
    const toast = await holdToast(page);
    assert.equal(await toast.textContent(), 'SendingUndo');
    await until('the composer closes', () => composer(page).count(), count => count === 0);
    const held = await until('the server holds it', () => drafts(setpoint), found => found.length === 1 && found[0]!.send_state === 'held');
    const sent = await setpoint.api<DraftOut>('GET', `/mail/drafts/${held[0]!.id}`);
    assert.equal(sent.kind, 'reply_all');
    assert.deepEqual(sent.body, [{type: 'paragraph', runs: [{text: 'Friday works. See you at 7.', marks: [], href: null}]}]);

    await toast.locator('button', {hasText: 'Undo'}).click();
    await body(page).filter({hasText: 'Friday works. See you at 7.'}).waitFor();
    assert.deepEqual(await chips(page, 'To'), ['Sam Lee', 'June Park']);
    await until('the send is taken back', () => drafts(setpoint), found => found[0]?.send_state === null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a send the provider refused comes back on its email with the provider\'s words, and Try again holds it once more', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Dinner Friday?');
    const draft = await setpoint.api<DraftOut>('POST', '/mail/drafts', {kind: 'reply', message_id: id});
    await setpoint.api('PATCH', `/mail/drafts/${draft.id}`, {to: [{name: null, address: 'nobody@refused.example'}]});
    // As the send worker leaves a refused send (src/sending/worker.ts).
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      database.prepare('UPDATE drafts SET send_state = \'failed\', send_error = ? WHERE id = ?').run('550 5.1.1 <nobody@refused.example>: Recipient address rejected: User unknown', draft.id);
    } finally {
      database.close();
    }

    const page = await openEmail(setpoint, id);
    // It opens by itself on its email, its words above the body.
    await composer(page).locator('.cmp-failed', {hasText: 'Recipient address rejected'}).waitFor();
    await composer(page).getByRole('button', {name: 'Try again'}).click();
    const toast = await holdToast(page);
    await toast.locator('button', {hasText: 'Undo'}).waitFor();
    await until('held again', () => drafts(setpoint), found => found[0]?.send_state === 'held');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a draft outlives a reload: its row says "Draft", its composer opens again on its email, and Esc closes it, kept', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Dinner Friday?');
    const page = await openEmail(setpoint, id);
    await page.locator('.rd-tools .tool', {hasText: 'Reply'}).first().click();
    await body(page).waitFor();
    assert.deepEqual(await chips(page, 'To'), ['Sam Lee']);
    await page.keyboard.type('Count me in.');
    await until('it saves as it\'s typed', () => drafts(setpoint), found => found[0]?.snippet === 'Count me in.');

    await page.reload();
    await page.locator(`.list .row[data-id="${id}"] .drafted`, {hasText: 'Draft'}).waitFor();
    await body(page).filter({hasText: 'Count me in.'}).waitFor();
    // Opened by itself, it leaves the keys to the page.
    assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Message');
    await page.keyboard.press('Escape');
    await until('Esc closes the composer, not the email', () => composer(page).count(), count => count === 0);
    assert.equal(new URL(page.url()).pathname, `/inbox/${id}`);
    assert.equal((await drafts(setpoint)).length, 1);

    // R from the row under the cursor opens the email with the composer, its text in place.
    await page.keyboard.press('Escape');
    await until('the reader closes', () => page.locator('.rd-subj').count(), count => count === 0);
    await point(page.locator(`.list .row[data-id="${id}"]`));
    await page.keyboard.press('r');
    await body(page).filter({hasText: 'Count me in.'}).waitFor();
    assert.equal(new URL(page.url()).pathname, `/inbox/${id}`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
