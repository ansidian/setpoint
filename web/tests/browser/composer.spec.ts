// The composer's journeys, at the design target on a fresh seed each, the server's clock held at the
// seed's moment so a held send stays held: R and C with the draft's start held, the composer there at
// the key and taking what's typed; Reply all from the keyboard, sent behind the "Sending"
// toast and brought back by Undo as it was; a send the provider refused, back on its email with the
// provider's words and Try again; a draft that outlives a reload, its row saying "Draft"; a new
// message from C in a window, kept in Drafts, its sidebar row and its page; Drafts with none and
// its New message; From's alias and Sent's
// account; a composer left with nothing written, which leaves no draft; a forward, its attachment
// taken off; a file attached by the attach button, kept on the server through a pop-out and
// Discard's Undo and held with the reply; and a reply popped out, kept up while other mail and Calendar show, and docked back on
// its email; and help me write, from ⌘J through a lookup to the draft sent as written. The fields, chips, the fold, the saving and what carries across a pop-out are
// components/composer.test.tsx's, how windows fold when they don't fit composer.test.ts's, a send
// that reaches the dev provider the server's (sendDev.test.ts).
import type {AiOut, AllOut, DraftOut, DraftsOut} from '@setpoint/shared';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {Page, Route} from 'playwright-core';
import {FAKE_ANTHROPIC_KEY, fakeAlfred} from './fakeAlfred.ts';
import {cleanUp, holdToast, point, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

async function idOf(setpoint: Setpoint, subject: string): Promise<number> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  return all.days.flatMap(day => day.rows).find(row => row.subject === subject)!.id;
}

const drafts = async (setpoint: Setpoint) => (await setpoint.api<DraftsOut>('GET', '/mail/drafts')).drafts;
// Every draft the server keeps, from its database, the untouched ones too.
const kept = async (setpoint: Setpoint) => {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    return database.prepare('SELECT id, kind FROM drafts ORDER BY id').all() as {id: number; kind: string}[];
  } finally {
    database.close();
  }
};
// The one composer each journey has open, in the pane or in a window.
const composer = (page: Page) => page.locator('.composer');
const chips = (page: Page, field: string) => composer(page).locator(`.cmp-row:has(input[aria-label="${field}"]) .cmp-chip`).evaluateAll(found => found.map(chip => chip.firstChild?.textContent));
const body = (page: Page) => composer(page).getByRole('textbox', {name: 'Message'});
// The composer has its draft: From is drawn once the server's answer is in (a skeleton until then).
const answered = async (page: Page) => {
  await composer(page).locator('.cmp-from > button').waitFor();
  await body(page).waitFor();
};

/**
 * Holds the page's asks to start a draft (POST /api/mail/drafts) at the server's door until the
 * returned release, as a slow server would. Installed before the key.
 */
async function holdStarts(page: Page): Promise<() => Promise<void>> {
  const waiting: Route[] = [];
  let held = true;
  const matches = (url: URL) => url.pathname === '/api/mail/drafts';
  const handler = (route: Route) => {
    if (held && route.request().method() === 'POST') waiting.push(route);
    else void route.continue();
  };
  await page.route(matches, handler);
  return async () => {
    held = false;
    await Promise.all(waiting.splice(0).map(route => route.continue()));
    await page.unroute(matches, handler);
  };
}

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
    await answered(page);
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
    await answered(page);
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

test('C writes a new message in a window from the account last sent from; closed, it waits in Drafts, whose row and count show, and opens alone there', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    // No draft, no Drafts row, read once the page has nothing left to ask.
    await setpoint.idle();
    assert.equal(await page.locator('.sb .nav.sub', {hasText: 'Drafts'}).count(), 0);
    await page.keyboard.press('c');
    await page.locator('.cmp-window .composer').waitFor();
    assert.equal(await page.locator('.cmp-window .cmp-title-text').textContent(), 'New message');
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

test('with the server\'s answer held, R and C open the composer at the key: letters typed land in it, not on the page\'s shortcuts, and the answer fills it around them', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Dinner Friday?');
    const page = await openEmail(setpoint, id);
    let release = await holdStarts(page);
    await page.keyboard.press('r');
    // Under the email at once, From a placeholder until the answer, the caret in the body.
    await composer(page).locator('[data-skeleton="composer-from"]').waitFor();
    await until('the caret is in the body', () => body(page).evaluate(field => field === document.activeElement), focused => focused);
    // E, U, ⇧U, J and K are the Inbox's own keys; here they're words.
    await page.keyboard.type('Sure, just ask Uncle Joe and Kim.');
    await body(page).filter({hasText: 'Sure, just ask Uncle Joe and Kim.'}).waitFor();
    assert.equal(new URL(page.url()).pathname, `/inbox/${id}`);
    await page.locator('.rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
    assert.deepEqual(await drafts(setpoint), []);
    await release();
    await answered(page);
    assert.deepEqual(await chips(page, 'To'), ['Sam Lee']);
    await body(page).filter({hasText: 'Sure, just ask Uncle Joe and Kim.'}).waitFor();
    await until('what was typed is saved into the draft', () => drafts(setpoint), found => found.length === 1 && found[0]!.snippet === 'Sure, just ask Uncle Joe and Kim.');
    await page.keyboard.press('Escape');
    await until('Esc closes it', () => composer(page).count(), count => count === 0);

    // C: a window at once over the page, the caret in To.
    release = await holdStarts(page);
    await page.keyboard.press('c');
    await page.locator('.cmp-window .composer [data-skeleton="composer-from"]').waitFor();
    await until('the caret is in To', () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')), label => label === 'To');
    await page.keyboard.type('sam.ortiz@example.org,');
    await release();
    const window = page.locator('.cmp-window .composer');
    await window.locator('.cmp-from > button').waitFor();
    assert.deepEqual(await window.locator('.cmp-row:has(input[aria-label="To"]) .cmp-chip').evaluateAll(found => found.map(chip => chip.firstChild?.textContent)), ['sam.ortiz@example.org']);
    await until('the new message keeps its recipient', () => drafts(setpoint), found => found.some(one => one.kind === 'new' && one.to[0]?.address === 'sam.ortiz@example.org'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Drafts with none says so, and its New message writes one in a window, as C does', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/drafts`);
    await page.locator('.drafts-list .view-empty .ve-head', {hasText: 'No drafts'}).waitFor();
    await page.locator('.drafts-list .view-empty .btn', {hasText: 'New message'}).click();
    await page.locator('.cmp-window .composer').waitFor();
    assert.equal(await page.locator('.cmp-window .cmp-title-text').textContent(), 'New message');
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
    await page.locator('.cmp-window .composer').waitFor();
    assert.equal(await composer(page).locator('.cmp-from > button').textContent(), 'iClouduser@example.net');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a composer left with nothing written is in no Drafts list or sidebar row, and Esc leaves nothing behind: C in a window, then R', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Dinner Friday?');
    const page = await openEmail(setpoint, id);
    const draftsRow = page.locator('.sb .nav.sub', {hasText: 'Drafts'});
    for (const [key, what] of [['c', 'new message'], ['r', 'reply']] as const) {
      await page.keyboard.press(key);
      await answered(page);
      const [started] = await until(`the ${what} is started`, () => kept(setpoint), found => found.length === 1);
      await setpoint.idle();
      assert.deepEqual(await drafts(setpoint), [], `the untouched ${what} isn't in Drafts`);
      assert.equal(await draftsRow.count(), 0, 'no Drafts row in the sidebar');
      await page.keyboard.press('Escape');
      await until('the composer closes', () => composer(page).count(), count => count === 0);
      // The email the pane shows stays.
      await page.locator('.rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
      await until(`the untouched ${what} is gone`, () => kept(setpoint), found => !found.some(one => one.id === started!.id));
    }
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
    await answered(page);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'To');
    // Its subject is the server's, with no field for it until Edit subject asks.
    assert.equal(await composer(page).getByRole('textbox', {name: 'Subject'}).count(), 0);
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

test('a file attached by the attach button is a chip and kept on the server; popped out, discarded and brought back by Undo it\'s still there, and Send holds the reply with it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const id = await idOf(setpoint, 'Dinner Friday?');
    const page = await openEmail(setpoint, id);
    await page.locator('.rd-tools .tool', {hasText: 'Reply'}).first().waitFor();
    await page.keyboard.press('r');
    await answered(page);
    await page.keyboard.type('The menu is attached.');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), composer(page).getByRole('button', {name: 'Attach files'}).click()]);
    await chooser.setFiles({name: 'Menu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 menu')});
    await composer(page).locator('.cmp-file:not(.uploading)', {hasText: 'Menu.pdf'}).waitFor();
    assert.deepEqual(await composer(page).locator('.cmp-file').allTextContents(), ['Menu.pdf13 bytes']);
    const [draft] = await drafts(setpoint);
    const {files} = await setpoint.api<DraftOut>('GET', `/mail/drafts/${draft!.id}`);
    assert.deepEqual(files.map(file => [file.filename, file.mime_type, file.size_bytes]), [['Menu.pdf', 'application/pdf', 13]]);
    const kept = path.join(setpoint.dataDir, 'draft-files', String(files[0]!.id));
    assert.equal(fs.readFileSync(kept, 'utf8'), '%PDF-1.4 menu');

    await composer(page).getByRole('button', {name: 'Pop out'}).click();
    const window = page.locator('.cmp-window');
    await window.locator('.cmp-file', {hasText: 'Menu.pdf'}).waitFor();
    await window.getByRole('button', {name: 'Discard'}).click();
    const discarded = await holdToast(page);
    await until('the draft is discarded', () => drafts(setpoint), found => found.length === 0);
    await discarded.locator('button', {hasText: 'Undo'}).click();
    await window.locator('.cmp-file', {hasText: 'Menu.pdf'}).waitFor();
    await window.getByRole('textbox', {name: 'Message'}).filter({hasText: 'The menu is attached.'}).waitFor();
    const [back] = await until('it\'s back with its file', () => drafts(setpoint), found => found.length === 1);
    assert.deepEqual((await setpoint.api<DraftOut>('GET', `/mail/drafts/${back!.id}`)).files, files);
    assert.ok(fs.existsSync(kept));

    await window.getByRole('textbox', {name: 'Message'}).click();
    await page.keyboard.press('Meta+Enter');
    await holdToast(page);
    await until('held', () => drafts(setpoint), found => found[0]?.send_state === 'held');
    assert.deepEqual((await setpoint.api<DraftOut>('GET', `/mail/drafts/${back!.id}`)).files, files);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a reply popped out stays up while other mail and Calendar show, clear of the reader\'s tools, and back on its email its window\'s × docks it under it as it was', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const dinner = await idOf(setpoint, 'Dinner Friday?');
    const lease = await idOf(setpoint, 'Lease renewal terms');
    const page = await openEmail(setpoint, dinner);
    await page.locator('.rd-tools .tool', {hasText: 'Reply'}).first().click();
    await answered(page);
    await page.keyboard.type('Count me in.');
    await composer(page).getByRole('button', {name: 'Pop out'}).click();
    const window = page.locator('.cmp-window');
    await window.locator('.cmp-title-text', {hasText: 'Re: Dinner Friday?'}).waitFor();
    assert.equal(await page.locator('.pane .composer').count(), 0);
    // The caret came along.
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Message');

    // Another email: the window stays, within the page and below the reader's tools.
    await page.locator(`.list .row[data-id="${lease}"]`).click();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await window.locator('.cmp-title-text', {hasText: 'Re: Dinner Friday?'}).waitFor();
    const [box, tools] = await rested(() => Promise.all([window.boundingBox(), page.locator('.rd-tools').boundingBox()]));
    const viewport = page.viewportSize()!;
    assert.ok(box!.x >= 0 && box!.x + box!.width <= viewport.width && box!.y + box!.height <= viewport.height, 'the window fits the page');
    assert.ok(box!.y >= tools!.y + tools!.height, 'the window is below the reader\'s tools');

    // Calendar: still up, its text in place.
    await page.keyboard.press('2');
    await until('Calendar opens', async () => new URL(page.url()).pathname, path => path.startsWith('/calendar'));
    await window.getByRole('textbox', {name: 'Message'}).filter({hasText: 'Count me in.'}).waitFor();
    // Away from its email, × would close it.
    await window.getByRole('button', {name: 'Close', exact: true}).waitFor();

    // Its email again: × puts it back under it.
    await page.keyboard.press('1');
    await page.locator(`.list .row[data-id="${dinner}"]`).click();
    await page.locator('.rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
    await window.getByRole('button', {name: 'Back in the reading pane'}).click();
    await page.locator('.pane .composer').getByRole('textbox', {name: 'Message'}).filter({hasText: 'Count me in.'}).waitFor();
    assert.equal(await page.locator('.cmp-window').count(), 0);
    await setpoint.idle();
    assert.equal((await drafts(setpoint)).length, 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('help me write: ⌘J opens the line, the draft reads the email and Sam\'s mail, looks up the calendar the ask needs, fills the body, and Send holds it as written', async () => {
  // The model: the calendar first, then the draft, saying how many things are on Friday.
  const fake = await fakeAlfred(() => ({name: 'answer', input: {found: false, text: '', source_ids: []}}), {
    held: true,
    writer: ({results}) => (results.length
      ? {name: 'write_draft', input: {text: `Hi Sam,\n\nFriday at 7 works, I have ${results[0]!.total} other things that day.\n\nAlex`}}
      : {name: 'list_items', input: {from: '2026-10-09', to: '2026-10-09'}}),
  });
  const setpoint = await startSetpoint({clock: 'frozen', env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  try {
    await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
    const page = await openEmail(setpoint, await idOf(setpoint, 'Dinner Friday?'));
    await page.keyboard.press('r');
    await answered(page);
    await until('the caret is in the body', () => body(page).evaluate(field => field === document.activeElement), focused => focused);
    await page.keyboard.press('Meta+j');
    const line = composer(page).getByRole('textbox', {name: 'Help me write'});
    await line.waitFor();
    assert.equal(await line.getAttribute('placeholder'), 'Describe your message');
    await line.fill('say Friday at 7 works');
    await line.press('Enter');

    // The lookup and the draft are held: the line says it's working until the model answers.
    await composer(page).getByText('Writing…').waitFor();
    fake.release();
    fake.release();
    await body(page).filter({hasText: 'Friday at 7 works, I have'}).waitFor();
    assert.equal(fake.drafts.length, 1);
    assert.match(fake.drafts[0]!, /<email_content message_id="\d+">[^]*Blue Door at 7\?/);
    assert.match(fake.drafts[0]!, /The user asks: say Friday at 7 works$/);
    assert.equal(await line.inputValue(), 'say Friday at 7 works');

    await page.keyboard.press('Meta+Enter');
    await holdToast(page);
    const held = await until('the server holds it', () => drafts(setpoint), found => found.length === 1 && found[0]!.send_state === 'held');
    const sent = await setpoint.api<DraftOut>('GET', `/mail/drafts/${held[0]!.id}`);
    assert.deepEqual(sent.to.map(one => one.address), ['sam.lee@example.com']);
    assert.equal(sent.subject, 'Re: Dinner Friday?');
    assert.match(sent.body.map(block => ('runs' in block ? block.runs.map(run => run.text).join('') : '')).join('\n'), /^Hi Sam,\n\nFriday at 7 works, I have \d+ other things that day\.\n\nAlex$/);
    const ai = await setpoint.api<AiOut>('GET', '/ai');
    assert.equal(ai.usage_this_month.mail_drafts.calls, 2);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await fake.close();
  }
});
