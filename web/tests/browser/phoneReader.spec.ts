// The phone's reader at 390 × 844 (board 21): Done, Trash with Undo, Mark unread and read, Copy,
// and the actions each email gets in its bar and its More sheet; Mark all as read from the top. Its
// composer's sheet: a reply sent from the bar and brought back by Undo, Reply all and a forward from More, a new message from the Inbox's
// header, each held behind "Sending", and a reply left on the phone that the desktop opens again.
// The bar's and More's rows for each kind of email are components/phoneReaderBar.test.tsx's.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {AllOut, DraftOut, DraftsOut, InboxOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, holdToast, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';
import {counts, email, inbox} from './phoneHelpers.ts';

after(cleanUp);

/** Taps More in the reader's bar, then the row `label` in its sheet. */
async function more(page: Page, label: string) {
  await page.locator('.ph-acts button', {hasText: 'More'}).tap();
  await page.locator('.ph-bs .ph-bs-i', {hasText: label}).tap();
  await page.locator('.ph-bs').waitFor({state: 'detached'});
}

const drafts = async (setpoint: Setpoint) => (await setpoint.api<DraftsOut>('GET', '/mail/drafts')).drafts;
// The composer's sheet, named for its kind.
const sheet = (page: Page, title: string) => page.getByRole('dialog', {name: title});
// The phone's reader open on an email of the sample (older mail, out of the Inbox's first page).
async function reading(setpoint: Setpoint, subject: string): Promise<Page> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  const id = all.days.flatMap(day => day.rows).find(row => row.subject === subject)!.id;
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox/${id}`);
  await page.locator('.rd-subj', {hasText: subject}).waitFor();
  return page;
}
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

test('Done, Trash with Undo, Mark unread and Mark read from the reader; Mark all as read from the top', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await inbox(setpoint);
    const exams = await email(setpoint, 'Final exam');

    // Mark unread keeps the email open and offers Mark read.
    await page.locator('.list .row', {hasText: 'Your recovery email was changed'}).tap();
    await page.locator('.rd-subj', {hasText: 'Your recovery email was changed'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === 18);
    await more(page, 'Mark unread');
    await page.locator('.rd-subj .rd-unread').waitFor();
    await until('unread again', () => counts(setpoint), value => value.unread === 19);
    await more(page, 'Mark read');
    await until('read again', () => counts(setpoint), value => value.unread === 18);

    // Done: out of Attention, with Undo in the toast. Back to the list, with nothing else opened or
    // read.
    await page.locator('.ph-acts button', {hasText: 'Done'}).tap();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    await page.locator('.list .row.unread:has(b[data-tip^="Interview availability"])').waitFor();
    await until('the pill drops', () => counts(setpoint), value => value.attention === 2);
    await setpoint.idle();
    assert.equal((await counts(setpoint)).unread, 18);

    // Trash on Contoso University, then Undo brings it back into the reader.
    await page.locator('.list .row:has(b[data-tip^="Final exam schedule"])').tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    // Attention mail leads with Done: its Trash is in More.
    await more(page, 'Trash');
    // Undo while the toast offers it: a wait on the server first could outlast its 6 seconds.
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    await page.locator('.toast button', {hasText: 'Undo'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    await until('it came back', () => setpoint.api<InboxOut>('GET', '/mail/inbox'), value => value.groups.some(group => group.rows.some(row => row.id === exams)));

    // Mark all as read: everything outside Attention (where Northwind, never opened, stays unread)
    // and Security, whose three stay unread.
    await page.locator('.ph-back').tap();
    assert.ok((await counts(setpoint)).unread_fyi > 3);
    await page.locator('.hd button[aria-label="Mark all as read"]').tap();
    await until('all but Security read', () => counts(setpoint), value => value.unread_fyi === 3 && value.unread === 4, 5000);
    // Every row stays where it is: Northwind, left unread, in Attention, and Security's three in their day.
    await until('the rest read', () => page.locator('.list .row.unread:not(.done)').count(), count => count === 4, 5000);
    await page.locator('.list .row.unread[data-key^="attention:"]:has(b[data-tip^="Interview availability"])').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the reader\'s Copy on an email marked unread reads it again, and offers Mark unread', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    const before = await counts(setpoint);
    await page.locator('.list .row', {has: page.locator('.code-line')}).tap();
    await page.locator('.rd-subj', {hasText: 'Your code is 482913'}).waitFor();
    await until('read', () => counts(setpoint), value => value.unread === before.unread - 1);
    await more(page, 'Mark unread');
    await page.locator('.rd-subj .rd-unread').waitFor();
    await until('unread again', () => counts(setpoint), value => value.unread === before.unread);

    await page.locator('.code-card button', {hasText: 'Copy'}).tap();
    await page.locator('.code-card button', {hasText: 'Copied'}).waitFor();
    await page.locator('.rd-subj .rd-unread').waitFor({state: 'detached'});
    await page.locator('.ph-acts button', {hasText: 'More'}).tap();
    await page.locator('.ph-bs .ph-bs-i', {hasText: 'Mark unread'}).waitFor();
    await until('read again', () => counts(setpoint), value => value.unread === before.unread - 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the reader\'s actions follow the email: Attention mail has Done, other Gmail mail leads with Trash, and iCloud mail has no Open in Gmail', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const actions = () => page.locator('.ph-acts > button').allTextContents();
    const rows = () => page.locator('.ph-bs .ph-bs-i').allTextContents();
    for (const [row, subject, labels, moreLabels] of [
      ['.list .row:has(b[data-tip^="Final exam schedule"])', 'Final exam schedule', 'Done,Reply,More', 'Forward,Trash,Mark unread,Open in Gmail'],
      ['.row:has-text("Woodgrove Bank")', 'Statement ready', 'Trash,Reply,More', 'Forward,Mark unread,Open in Gmail'],
      ['.row:has-text("Proseware")', 'Bill is ready', 'Trash,Reply,More', 'Forward,Mark unread'],
    ] as const) {
      await page.locator(row).first().tap();
      await page.locator('.rd-subj', {hasText: subject}).waitFor();
      await until(`${subject}'s actions`, actions, shown => shown.join() === labels);
      await page.locator('.ph-acts button', {hasText: 'More'}).tap();
      await until(`${subject}'s More`, rows, shown => shown.join() === moreLabels);
      await page.locator('.ph-bs-scrim').tap({position: {x: 20, y: 20}});
      await page.locator('.ph-bs').waitFor({state: 'detached'});
      await page.locator('.ph-back').tap();
      await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Reply in the bar writes in the composer\'s sheet, Send in its bar holding it behind "Sending" and Undo bringing it back; Reply all and Forward come from More', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await reading(setpoint, 'Dinner Friday?');
    const chips = (where: Locator, field: string) => where.locator(`.cmp-row:has(input[aria-label="${field}"]) .cmp-chip`).evaluateAll(found => found.map(chip => chip.firstChild?.textContent));

    // Reply: the sheet over the reader, the caret in the body once the draft is in, and no Send
    // later or Pop out (the sheet's bar has Send).
    await page.locator('.ph-acts button', {hasText: 'Reply'}).tap();
    const reply = sheet(page, 'Reply');
    await reply.locator('.cmp-from > button').waitFor();
    assert.equal(await focused(page), 'Message');
    assert.equal(await reply.getByRole('button', {name: 'Send later'}).count(), 0);
    assert.equal(await reply.getByRole('button', {name: 'Pop out'}).count(), 0);
    assert.equal(await reply.locator('.cmp-send').count(), 0);
    await page.keyboard.type('Friday works.');
    await reply.locator('.ph-sheet-act', {hasText: 'Send'}).tap();
    const toast = await holdToast(page);
    assert.equal(await toast.textContent(), 'SendingUndo');
    await reply.waitFor({state: 'detached'});
    const held = await until('the server holds the reply', () => drafts(setpoint), found => found.length === 1 && found[0]!.send_state === 'held');
    const sent = await setpoint.api<DraftOut>('GET', `/mail/drafts/${held[0]!.id}`);
    assert.equal(sent.kind, 'reply');
    assert.deepEqual(sent.to.map(one => one.address), ['sam.lee@example.com']);
    assert.deepEqual(sent.body, [{type: 'paragraph', runs: [{text: 'Friday works.', marks: [], href: null}]}]);
    // Undo: the sheet comes back as it was, and Cancel keeps the draft.
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await reply.getByRole('textbox', {name: 'Message'}).filter({hasText: 'Friday works.'}).waitFor();
    await until('the send is taken back', () => drafts(setpoint), found => found[0]?.send_state === null);
    await reply.getByRole('button', {name: 'Cancel'}).tap();
    await reply.waitFor({state: 'detached'});
    await page.evaluate(() => document.documentElement.removeAttribute('data-hold-toast'));

    // Reply all from More, with everyone the email went to.
    await more(page, 'Reply all');
    const all = sheet(page, 'Reply all');
    await all.locator('.cmp-from > button').waitFor();
    assert.deepEqual(await chips(all, 'To'), ['Sam Lee', 'June Park']);
    assert.deepEqual(await chips(all, 'Cc'), ['Ravi Menon']);
    await page.keyboard.type('See you all there.');
    await all.locator('.ph-sheet-act', {hasText: 'Send'}).tap();
    await all.waitFor({state: 'detached'});
    await until('the server holds Reply all', () => drafts(setpoint), found => found.some(one => one.send_state === 'held'));

    // Forward from More: the caret in To.
    await more(page, 'Forward');
    const forward = sheet(page, 'Forward');
    await forward.locator('.cmp-from > button').waitFor();
    assert.equal(await focused(page), 'To');
    await page.keyboard.type('mom@example.net,');
    await forward.locator('.cmp-chip', {hasText: 'mom@example.net'}).waitFor();
    await forward.locator('.ph-sheet-act', {hasText: 'Send'}).tap();
    await forward.waitFor({state: 'detached'});
    const now = await until('the server holds Reply all and the forward', () => drafts(setpoint), found => found.length === 3 && found.filter(one => one.send_state === 'held').length === 2);
    const kinds = await Promise.all(now.filter(one => one.send_state === 'held').map(one => setpoint.api<DraftOut>('GET', `/mail/drafts/${one.id}`)));
    assert.deepEqual(kinds.map(one => one.kind).sort(), ['forward', 'reply_all']);
    assert.deepEqual(kinds.find(one => one.kind === 'forward')!.to, [{name: null, address: 'mom@example.net'}]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('New message in the Inbox\'s header writes to someone with a subject, and Send in the sheet\'s bar holds it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.hd button[aria-label="New message"]').tap();
    const write = sheet(page, 'New message');
    await write.locator('.cmp-from > button').waitFor();
    assert.equal(await focused(page), 'To');
    await page.keyboard.type('june.park@example.com,');
    await write.locator('.cmp-chip', {hasText: 'june.park@example.com'}).waitFor();
    await write.getByRole('textbox', {name: 'Subject'}).tap();
    await page.keyboard.type('Saturday');
    await write.getByRole('textbox', {name: 'Message'}).tap();
    await page.keyboard.type('Are you free?');
    await write.locator('.ph-sheet-act', {hasText: 'Send'}).tap();
    await holdToast(page);
    await write.waitFor({state: 'detached'});
    const held = await until('the server holds it', () => drafts(setpoint), found => found.length === 1 && found[0]!.send_state === 'held');
    const sent = await setpoint.api<DraftOut>('GET', `/mail/drafts/${held[0]!.id}`);
    assert.equal(sent.kind, 'new');
    assert.equal(sent.subject, 'Saturday');
    assert.deepEqual(sent.to, [{name: null, address: 'june.park@example.com'}]);
    assert.deepEqual(sent.body, [{type: 'paragraph', runs: [{text: 'Are you free?', marks: [], href: null}]}]);
    // Still the Inbox under it.
    assert.equal(new URL(page.url()).pathname, '/inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a reply started on the phone and left with Cancel is kept, and the desktop opens it again on its email', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await reading(setpoint, 'Dinner Friday?');
    await page.locator('.ph-acts button', {hasText: 'Reply'}).tap();
    const reply = sheet(page, 'Reply');
    await reply.locator('.cmp-from > button').waitFor();
    await page.keyboard.type('Count me in.');
    await reply.getByRole('button', {name: 'Cancel'}).tap();
    await reply.waitFor({state: 'detached'});
    await until('it is kept as typed', () => drafts(setpoint), found => found.length === 1 && found[0]!.snippet === 'Count me in.');

    const desk = await setpoint.page('target');
    await desk.goto(page.url());
    await desk.locator('.pane .composer').getByRole('textbox', {name: 'Message'}).filter({hasText: 'Count me in.'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
