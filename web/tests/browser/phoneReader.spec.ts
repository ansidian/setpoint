// The phone's reader at 390 × 844 (board 21): Done, Trash with Undo, Mark unread and read, Copy,
// and the actions each email gets in its bar and its More sheet; Mark all as read from the top. Its
// composer's sheet: a reply sent from the bar and brought back by Undo, Reply all and a forward from More, a new message from the Inbox's
// header, each held behind "Sending", and a reply left on the phone that the desktop opens again.
// The bar's and More's rows for each kind of email are components/phoneReaderBar.test.tsx's. An
// invitation's card has Add to calendar, as on the desktop: the reader stays, and the editor or the
// import review opens over it in the full-screen sheet (the dev provider serves src/dev/icsFiles.ts by name).
// The thread under the email and Back through it, Snooze's sheet with Undo and Pick a date…, Add to
// calendar and Add as task from More, and an attachment's preview in its own sheet.
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {AllOut, DraftOut, DraftsOut, InboxOut, ItemsOut, MailConversationOut, MessageOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, holdToast, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';
import {counts, email, fingertips, inbox, saveDraft} from './phoneHelpers.ts';

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

test('the reader\'s actions follow the email: Attention mail has Done, other mail leads with Trash, and Gmail\'s mail has no Open in Gmail on the phone', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const actions = () => page.locator('.ph-acts > button').allTextContents();
    const rows = () => page.locator('.ph-bs .ph-bs-i').allTextContents();
    for (const [row, subject, labels, moreLabels] of [
      ['.list .row:has(b[data-tip^="Final exam schedule"])', 'Final exam schedule', 'Done,Reply,More', 'Forward,Snooze,Add to calendar,Add as task,Trash,Mark unread'],
      ['.row:has-text("Woodgrove Bank")', 'Statement ready', 'Trash,Reply,More', 'Forward,Snooze,Add to calendar,Add as task,Mark unread'],
      ['.row:has-text("Proseware")', 'Bill is ready', 'Trash,Reply,More', 'Forward,Snooze,Add to calendar,Add as task,Mark unread'],
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
    await saveDraft(reply);
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

test('on the phone compose\'s format bar fits the screen with no Discard, and Cancel asks: Save draft keeps the reply for the desktop to open on its email, Discard takes a draft with Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await reading(setpoint, 'Dinner Friday?');
    await page.locator('.ph-acts button', {hasText: 'Reply'}).tap();
    const reply = sheet(page, 'Reply');
    await reply.locator('.cmp-from > button').waitFor();
    await page.keyboard.type('Count me in.');
    // The format bar's buttons all fit across the screen, each a fingertip's, and Discard isn't one.
    const buttons = await reply.locator('.desc-bar button').all();
    assert.equal(await reply.locator('.desc-bar').getByRole('button', {name: 'Discard'}).count(), 0);
    const width = page.viewportSize()!.width;
    for (const button of buttons) {
      const box = (await rested(() => button.boundingBox()))!;
      assert.ok(box.x >= 0 && box.x + box.width <= width, `${await button.getAttribute('aria-label')}: ${box.x}–${box.x + box.width} of ${width}`);
    }
    await fingertips(buttons);

    // Cancel asks; Save draft leaves with the reply kept as typed.
    await reply.getByRole('button', {name: 'Cancel'}).tap();
    const asks = sheet(page, 'Save this draft?');
    assert.deepEqual(await asks.locator('.ph-bs-i').allTextContents(), ['Save draft', 'Discard']);
    await asks.locator('.ph-bs-i', {hasText: 'Save draft'}).tap();
    await reply.waitFor({state: 'detached'});
    await until('it is kept as typed', () => drafts(setpoint), found => found.length === 1 && found[0]!.snippet === 'Count me in.');
    // The conversation's foot shows it as a Draft line, which opens it again.
    await page.locator('.cv-foot .cv-draft', {hasText: 'Open the reply you started'}).waitFor();

    const desk = await setpoint.page('target');
    await desk.goto(page.url());
    await desk.locator('.pane .composer').getByRole('textbox', {name: 'Message'}).filter({hasText: 'Count me in.'}).waitFor();

    // A new message left with Discard goes, and Undo brings it back.
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.hd button[aria-label="New message"]').tap();
    const write = sheet(page, 'New message');
    await write.locator('.cmp-from > button').waitFor();
    await write.getByRole('textbox', {name: 'Message'}).tap();
    await page.keyboard.type('Never mind.');
    await until('the new one is kept', () => drafts(setpoint), found => found.some(one => one.snippet === 'Never mind.'));
    await write.getByRole('button', {name: 'Cancel'}).tap();
    await sheet(page, 'Save this draft?').locator('.ph-bs-i', {hasText: 'Discard'}).tap();
    const toast = await holdToast(page);
    assert.equal(await toast.textContent(), 'Draft discardedUndo');
    await write.waitFor({state: 'detached'});
    await until('it goes', () => drafts(setpoint), found => found.length === 1 && found[0]!.snippet === 'Count me in.');
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await until('Undo brings it back', () => drafts(setpoint), found => found.some(one => one.snippet === 'Never mind.'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** The seed's interview confirmation, with any more .ics files linked to it. */
function interviewEmail(setpoint: Setpoint, more: string[] = []) {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    const {id} = database.prepare('SELECT id FROM messages WHERE subject = ?').get('Interview confirmed: Data Engineer I') as {id: number};
    const insert = database.prepare('INSERT INTO attachments (message_id, provider_id, filename, mime_type, size_bytes) VALUES (?, ?, ?, ?, 900)');
    more.forEach((filename, index) => insert.run(id, `phone-${index}`, filename, 'text/calendar'));
    return id;
  } finally {
    database.close();
  }
}

async function dayTitles(setpoint: Setpoint, date: string) {
  const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const {items} = await setpoint.api<ItemsOut>('GET', `/items?from=${date}&to=${next}`);
  return items.filter(item => !item.command).map(item => item.title);
}

test('an invitation\'s card offers Add to calendar: one event opens the editor sheet over the reader, two or more the review', async () => {
  const setpoint = await startSetpoint();
  try {
    const id = interviewEmail(setpoint, ['northwind-devcon.ics']);
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox/${id}`);
    await page.locator('.rd-subj', {hasText: 'Interview confirmed: Data Engineer I'}).waitFor();
    const card = page.locator('.attach[data-type="calendar"]', {hasText: 'invite.ics'});
    // The card in place of a plain Download link, its name with room beside its two buttons.
    assert.deepEqual(await card.locator(':scope > .dl').evaluateAll(parts => parts.map(part => part.getAttribute('aria-label') ?? part.textContent)), ['Add to calendar', 'Download']);
    const name = (await rested(() => card.locator('.name').boundingBox()))!;
    assert.ok(name.width >= 60, `the name has room (${name.width} px)`);

    await card.getByRole('button', {name: 'Add to calendar'}).tap();
    const sheet = page.getByRole('dialog', {name: 'New event'});
    await sheet.waitFor();
    assert.match(new URL(page.url()).pathname, new RegExp(`^/inbox/${id}$`), 'the reader stays under it');
    assert.deepEqual([await page.getByLabel('Date', {exact: true}).inputValue(), await page.getByLabel('Start', {exact: true}).inputValue(), await page.getByLabel('End', {exact: true}).inputValue()],
      ['2026-10-20', '14:00', '14:45']);
    await sheet.getByRole('button', {name: 'Create'}).tap();
    await sheet.waitFor({state: 'detached'});
    // The sheet turns into the new event's detail, as the Agenda shows it. × closes it.
    const detail = page.locator('.ph-detail.created-detail');
    await until('the created detail', () => detail.locator('.fd-when').textContent(), when => when?.startsWith('Tue, Oct 20') ?? false);
    assert.match(await detail.getAttribute('aria-label') ?? '', /^Interview with Trey Research/);
    await page.locator('.toast', {hasText: /^Imported Interview with Trey Research/}).waitFor({timeout: 10_000});
    await until('the interview on Oct 20', () => dayTitles(setpoint, '2026-10-20'), list => list.some(title => title.startsWith('Interview with Trey Research')));
    await detail.getByRole('button', {name: 'Close'}).tap();
    await detail.waitFor({state: 'detached'});

    // A schedule: the review in the sheet, its count, then Import in the top bar.
    await page.locator('.attach[data-type="calendar"]', {hasText: 'northwind-devcon.ics'}).getByRole('button', {name: 'Add to calendar'}).tap();
    const review = page.getByRole('dialog', {name: 'Import northwind-devcon.ics'});
    await review.waitFor();
    assert.deepEqual(await review.locator('.imp-item .title').allTextContents(), ['Opening keynote', 'Hiring panel', 'Closing remarks']);
    await review.locator('.ph-sheet-top').getByRole('button', {name: 'Import'}).tap();
    await page.locator('.toast', {hasText: 'Imported 3 events to Personal'}).waitFor({timeout: 20_000});
    await review.waitFor({state: 'detached'});
    assert.match(new URL(page.url()).pathname, new RegExp(`^/inbox/${id}$`));
    await until('the schedule on Oct 15', () => dayTitles(setpoint, '2026-10-15'), list => ['Opening keynote', 'Hiring panel'].every(title => list.includes(title)), 10_000);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** Theo's newest email in the seed's cabin thread, and the one he sent on Oct 1. */
async function cabin(setpoint: Setpoint) {
  // All lists the conversation once; its emails are the reader's.
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  const row = all.days.flatMap(day => day.rows).find(one => one.from_name === 'Theo Walsh' && one.subject.endsWith('Cabin weekend in November'))!;
  const conversation = await setpoint.api<MailConversationOut>('GET', `/mail/conversations/${row.id}`);
  const theo = conversation.emails.filter(email => email.from_name === 'Theo Walsh').sort((one, other) => other.received_at.localeCompare(one.received_at));
  return {newest: theo[0]!.id, oct1: theo.find(row => row.received_at.startsWith('2026-10-02') || row.received_at.startsWith('2026-10-01'))!.id};
}

test('on the phone the reader stacks the conversation: a line expands where it is, an email\'s ••• answers that email in a sheet, and the foot replies to the newest', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const {newest, oct1} = await cabin(setpoint);
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox/${newest}`);
    await page.locator(`.cv-mail.opened[data-email="${newest}"]`).waitFor();
    // Nothing runs past the screen's edge.
    const width = page.viewportSize()!.width;
    const wide = await rested(() => page.locator('.cv > [data-email], .cv-foot').evaluateAll((all, edge) => all.filter(node => node.getBoundingClientRect().right > edge + 1).map(node => node.textContent), width));
    assert.deepEqual(wide, []);
    assert.equal(await page.locator('.ph-back').textContent(), 'Inbox');

    // Oct 1's line expands in place, with no new address.
    await page.locator(`.cv-line[data-email="${oct1}"]`).tap();
    const oct1Mail = page.locator(`.cv-mail[data-email="${oct1}"]`);
    await oct1Mail.waitFor();
    assert.equal(await page.evaluate(() => window.location.pathname), `/inbox/${newest}`);

    // Its ••• answers that email: the sheet is titled with who sent it, and Reply writes to Theo.
    await oct1Mail.locator('.cv-tools button[aria-label="More"]').tap();
    const tools = page.getByRole('dialog', {name: 'Theo Walsh'});
    assert.deepEqual(await tools.locator('.ph-bs-i').allTextContents(), ['Reply', 'Forward', 'Add to calendar', 'Add as task']);
    await tools.locator('.ph-bs-i', {hasText: 'Reply'}).tap();
    const reply = page.getByRole('dialog', {name: 'Reply'});
    await reply.locator('.cmp-from > button').waitFor();
    await page.keyboard.type('Sure.');
    await until('it answers Oct 1\'s email', () => drafts(setpoint), found => found.some(one => one.message_id === oct1 && one.snippet === 'Sure.'));
    await reply.getByRole('button', {name: 'Cancel'}).tap();
    await page.getByRole('dialog', {name: 'Save this draft?'}).locator('.ph-bs-i', {hasText: 'Discard'}).tap();
    await reply.waitFor({state: 'detached'});

    // The foot's Reply answers the newest email Theo sent, in the composer's own sheet.
    await page.locator('.cv-foot .cv-reply', {hasText: 'Reply to Theo Walsh'}).tap();
    await page.getByRole('dialog', {name: 'Reply'}).locator('.cmp-from > button').waitFor();
    await page.keyboard.type('See you Friday.');
    await until('it answers the newest', () => drafts(setpoint), found => found.some(one => one.message_id === newest && one.snippet === 'See you Friday.'));
    assert.equal(await page.locator('.pane .composer').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an email opened from the list and closed with Back leaves no entry behind: the browser\'s Back then reopens nothing', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const opened = await page.evaluate(() => window.history.length);
    for (const subject of ['Out for delivery', 'Arriving today']) {
      await page.locator(`.row:has(b[data-tip^="${subject}"])`).first().tap();
      await page.locator('.rd-subj', {hasText: subject}).waitFor();
      await page.locator('.ph-back').tap();
      await until('back on the list', () => page.evaluate(() => window.location.pathname), at => at === '/inbox');
      await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    }
    // The history holds the list once, with at most the last email ahead of it.
    assert.ok(await page.evaluate(() => window.history.length) <= opened + 1);
    // The system's Back (Safari's edge swipe) leaves the Inbox rather than reopening the last email.
    await page.goBack();
    assert.doesNotMatch(await page.evaluate(() => window.location.pathname), /^\/inbox\/\d+/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Snooze from More: Tomorrow puts the email off with Undo in the toast, and Pick a date… snoozes until the day and time picked', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await reading(setpoint, 'Dinner Friday?');
    const id = Number(new URL(page.url()).pathname.split('/').at(-1));
    const snoozedUntil = async () => (await setpoint.api<MessageOut>('GET', `/mail/messages/${id}`)).snoozed_until ?? null;
    const openSnooze = async () => {
      await page.locator('.ph-acts button', {hasText: 'More'}).tap();
      await page.getByRole('dialog', {name: 'More'}).locator('.ph-bs-i', {hasText: 'Snooze'}).tap();
      const times = page.getByRole('dialog', {name: 'Snooze'});
      await times.waitFor();
      return times;
    };

    // The seed's Wednesday: Tomorrow is Thursday, which is also the next weekday, so it's alone.
    const times = await openSnooze();
    assert.deepEqual(await times.locator('.ph-bs-i').allTextContents(), ['TomorrowThu 9:00 AM', 'Pick a date…']);
    await times.locator('.ph-bs-i', {hasText: 'Tomorrow'}).tap();
    const toast = await holdToast(page);
    assert.equal(await toast.textContent(), 'Snoozed until Tomorrow 9:00 AMUndo');
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    await until('snoozed until Thursday', snoozedUntil, until => until === '2026-10-08T16:00:00.000Z');
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await page.locator('.rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
    await until('back in the Inbox', snoozedUntil, until => until === null);
    await page.evaluate(() => document.documentElement.removeAttribute('data-hold-toast'));

    // Pick a date…: the sheet turns into its day and time fields, the moment said under them.
    await (await openSnooze()).locator('.ph-bs-i', {hasText: 'Pick a date'}).tap();
    const pick = page.getByRole('dialog', {name: 'Pick a date'});
    await pick.waitFor();
    assert.equal(await pick.locator('.ph-pick-line').textContent(), 'Until Thu, Oct 8, 9:00 AM');
    await pick.getByLabel('Day').fill('2026-10-07');
    await pick.getByLabel('Time').fill('08:00');
    await pick.locator('.ph-pick-line', {hasText: 'That time has passed'}).waitFor();
    assert.equal(await pick.getByRole('button', {name: 'Snooze'}).isDisabled(), true);
    await pick.getByLabel('Day').fill('2026-10-12');
    await pick.getByLabel('Time').fill('14:00');
    await pick.locator('.ph-pick-line', {hasText: 'Until Mon, Oct 12, 2:00 PM'}).waitFor();
    await pick.getByRole('button', {name: 'Snooze'}).tap();
    await pick.waitFor({state: 'detached'});
    await until('snoozed until Monday 2 PM', snoozedUntil, until => until === '2026-10-12T21:00:00.000Z');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Add to calendar and Add as task in More open the editor\'s sheet over the reader, filled from the email', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await reading(setpoint, 'Dinner Friday?');
    const path = new URL(page.url()).pathname;
    for (const [row, title] of [['Add to calendar', 'New event'], ['Add as task', 'New task']] as const) {
      await more(page, row);
      const sheet = page.getByRole('dialog', {name: title});
      await sheet.waitFor();
      await until(`${title} filled from the email`, () => sheet.locator('.nl-input').inputValue(), text => text.includes('Dinner'));
      assert.equal(new URL(page.url()).pathname, path, 'the reader stays under it');
      // Filled from the email, Cancel asks before its draft goes.
      await sheet.getByRole('button', {name: 'Cancel'}).tap();
      await page.getByRole('dialog', {name: /^Discard this/}).getByRole('button', {name: /^Discard/}).tap();
      await sheet.waitFor({state: 'detached'});
    }
    await page.locator('.rd-subj', {hasText: 'Dinner Friday?'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an attachment\'s preview opens full-screen with Back and Download, and Back returns to the email', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await reading(setpoint, 'Lease renewal terms');
    await page.locator('.attach .open', {hasText: 'Renewal agreement.pdf'}).tap();
    const preview = page.getByRole('dialog', {name: 'Renewal agreement.pdf'});
    await preview.locator('.preview-pdf').waitFor();
    await preview.getByRole('button', {name: 'Download'}).waitFor();
    await preview.getByRole('button', {name: 'Back'}).tap();
    await preview.waitFor({state: 'detached'});
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
