// The composer's journeys, at the design target on a fresh seed each, the server's clock held at the
// seed's moment so a held send stays held: Reply all from the keyboard, sent behind the "Sending"
// toast and brought back by Undo as it was; a send the provider refused, back on its email with the
// provider's words and Try again; a draft that outlives a reload, its row saying "Draft"; a new
// message from C, kept in Drafts, its sidebar row and its page; From's alias and Sent's account; a
// composer left with nothing written, which leaves no draft; and a forward, its attachment taken off. The
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
    // Read once the page has nothing left to ask, so a discard on its way would have landed.
    await setpoint.idle();
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

test('C writes a new message by itself from the account last sent from; closed, it waits in Drafts, whose row and count show, and opens alone there', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // No draft, no Drafts row, read once the page has nothing left to ask.
    await setpoint.idle();
    assert.equal(await page.locator('.sb .nav.sub', {hasText: 'Drafts'}).count(), 0);
    await page.keyboard.press('c');
    await page.locator('.pane.writing .composer').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'To');
    // The seed's last sent mail went from Work.
    assert.equal(await composer(page).locator('.cmp-from > button').textContent(), 'Workuser@work.example.org');
    await page.keyboard.type('sam.ortiz@example.org,');
    await composer(page).getByRole('textbox', {name: 'Subject'}).fill('Hike on Saturday');
    await body(page).click();
    await page.keyboard.type('Still on for 9?');
    await page.keyboard.press('Escape');
    await until('Esc closes it', () => composer(page).count(), count => count === 0);
    await until('kept, saved', () => drafts(setpoint), found => found.length === 1 && found[0]!.kind === 'new' && found[0]!.snippet === 'Still on for 9?');

    const row = page.locator('.sb .nav.sub', {hasText: 'Drafts'});
    await row.locator('.cnt', {hasText: '1'}).waitFor();
    await row.click();
    await until('Drafts opens', async () => new URL(page.url()).pathname, path => path === '/drafts');
    const draftRow = page.locator('.drafts-list .row', {hasText: 'Hike on Saturday'});
    assert.equal(await draftRow.locator('.from').textContent(), 'To sam.ortiz@example.org');
    await draftRow.click();
    await page.locator('.pane.writing .composer').waitFor();
    await body(page).filter({hasText: 'Still on for 9?'}).waitFor();
    assert.match(new URL(page.url()).pathname, /^\/drafts\/\d+$/);
    assert.equal(await page.locator('.pane .rd-subj').count(), 0);
    await page.keyboard.press('Escape');
    await until('Esc empties the pane', async () => new URL(page.url()).pathname, path => path === '/drafts');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Drafts lists the newest first: a reply opens under its email, a refused one says "Couldn\'t send"; From offers Business\'s alias, and C on Sent starts from its account', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const dinner = await idOf(setpoint, 'Dinner Friday?');
    const reply = await setpoint.api<DraftOut>('POST', '/mail/drafts', {kind: 'reply', message_id: dinner});
    await setpoint.api('PATCH', `/mail/drafts/${reply.id}`, {body: [{type: 'paragraph', runs: [{text: 'Blue Door works.', marks: [], href: null}]}]});
    const refused = await setpoint.api<DraftOut>('POST', '/mail/drafts', {kind: 'new'});
    await setpoint.api('PATCH', `/mail/drafts/${refused.id}`, {to: [{name: null, address: 'nobody@refused.example'}], subject: 'Hello'});
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      database.prepare('UPDATE drafts SET send_state = \'failed\', send_error = ? WHERE id = ?').run('550 Recipient address rejected', refused.id);
    } finally {
      database.close();
    }

    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/drafts`);
    await page.locator('.drafts-list .row').nth(1).waitFor();
    assert.deepEqual(await page.locator('.drafts-list .row .subj b').allTextContents(), ['Hello', 'Re: Dinner Friday?']);
    await page.locator('.drafts-list .row', {hasText: 'Hello'}).locator('.drafted', {hasText: 'Couldn\'t send'}).waitFor();
    await page.locator('.drafts-list .row', {hasText: 'Re: Dinner Friday?'}).click();
    await page.locator('.pane .rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
    await body(page).filter({hasText: 'Blue Door works.'}).waitFor();

    // From: each account with its addresses, Business's alias under it.
    // The menu lists what From's own load brought, so it's opened once that is in.
    await setpoint.idle();
    await composer(page).locator('.cmp-from > button').click();
    assert.deepEqual(await composer(page).locator('.cmp-from-menu .menu-i').allTextContents(), [
      'Businessuser@studio.example.com', 'hello@studio.example.com', 'Personaluser@example.com', 'Workuser@work.example.org', 'Jobsuser.jobs@example.com', 'iClouduser@example.net',
    ]);
    await composer(page).locator('.cmp-from-menu .menu-i', {hasText: 'hello@studio.example.com'}).click();
    await until('From is the alias', async () => (await setpoint.api<DraftOut>('GET', `/mail/drafts/${reply.id}`)).from, from => from.address === 'hello@studio.example.com');

    // C on Sent, iCloud selected.
    await page.goto(`${setpoint.base}/sent?account=5`);
    await page.locator('.list .row').first().waitFor();
    await page.keyboard.press('c');
    await page.locator('.pane.writing .composer').waitFor();
    assert.equal(await composer(page).locator('.cmp-from > button').textContent(), 'iClouduser@example.net');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a composer left with nothing written leaves nothing in Drafts: C, then an email opened; R, then Esc', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Dinner Friday?');
    const page = await openEmail(setpoint, id);
    await page.keyboard.press('c');
    await page.locator('.pane.writing .composer').waitFor();
    await until('the new message is a draft', () => drafts(setpoint), found => found.length === 1);
    // The sidebar's Drafts row is seen each time before it's read as gone: the sidebar learns of a
    // draft's end by its own refresh, after the server's answer.
    const draftsRow = page.locator('.sb .nav.sub', {hasText: 'Drafts'});
    await draftsRow.waitFor();
    await page.locator(`.list .row[data-id="${id}"]`).click();
    await page.locator('.rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
    await until('the untouched message is gone', () => drafts(setpoint), found => found.length === 0);
    await draftsRow.waitFor({state: 'detached'});
    await page.keyboard.press('r');
    await body(page).waitFor();
    await draftsRow.waitFor();
    await page.keyboard.press('Escape');
    await until('the untouched reply is gone too', () => drafts(setpoint), found => found.length === 0);
    await draftsRow.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('F forwards: the email in full under the body with its attachment as a chip; × takes it off, and Send holds the forward without it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Lease renewal terms');
    const page = await openEmail(setpoint, id);
    await page.locator('.rd-tools .tool', {hasText: 'Forward'}).waitFor();
    await page.keyboard.press('f');
    await body(page).waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'To');
    assert.equal(await composer(page).getByRole('textbox', {name: 'Subject'}).inputValue(), 'Fwd: Lease renewal terms');
    await composer(page).locator('.cmp-forward-head', {hasText: 'From: Dana Whitfield <dana.whitfield@parksideapts.example>'}).waitFor();
    await composer(page).locator('.cmp-forward .mailtext', {hasText: 'Unit 4B'}).waitFor();
    assert.deepEqual(await composer(page).locator('.cmp-file').allTextContents(), ['Renewal agreement.pdf184 KB']);

    await page.keyboard.type('mom@example.net,');
    await composer(page).getByRole('button', {name: 'Remove Renewal agreement.pdf'}).click();
    assert.equal(await composer(page).locator('.cmp-file').count(), 0);
    await body(page).click();
    await page.keyboard.type('See below.');
    await page.keyboard.press('Meta+Enter');
    await holdToast(page);
    const held = await until('held', () => drafts(setpoint), found => found[0]?.send_state === 'held');
    const sent = await setpoint.api<DraftOut>('GET', `/mail/drafts/${held[0]!.id}`);
    assert.equal(sent.kind, 'forward');
    assert.deepEqual(sent.to, [{name: null, address: 'mom@example.net'}]);
    assert.equal(sent.removed_attachments.length, 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
