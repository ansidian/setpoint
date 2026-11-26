// The phone's Sent, Drafts and Snoozed at 390 × 844 (board 21), reached from the Inbox's title menu:
// Sent's reader naming who it went to with Back to Sent, and its rows swiping to Trash; a draft
// opening in the composer's sheet, Cancel leaving no address behind, and its row swiping to Discard;
// Snoozed's rows swiping to Unsnooze or to the snooze sheet, and the reader's More doing the same.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {DraftOut, DraftsOut, SentOut, SnoozedOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, holdToast, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';
import {email, inbox, saveDraft, swipe} from './phoneHelpers.ts';

after(cleanUp);

const path = (url: string) => new URL(url).pathname;
const snoozed = async (setpoint: Setpoint) => (await setpoint.api<SnoozedOut>('GET', '/mail/snoozed')).rows;
const drafts = async (setpoint: Setpoint) => (await setpoint.api<DraftsOut>('GET', '/mail/drafts')).drafts;

/** A reply drafted to `subject`'s email with a line in it, as Drafts lists only drafts written in. */
async function drafted(setpoint: Setpoint, subject: string): Promise<DraftOut> {
  const draft = await setpoint.api<DraftOut>('POST', '/mail/drafts', {kind: 'reply', message_id: await email(setpoint, subject)});
  await setpoint.api('PATCH', `/mail/drafts/${draft.id}`, {body: [{type: 'paragraph', runs: [{text: 'Tuesday works.', marks: [], href: null}]}]});
  return draft;
}

/** The title menu's rows, from the header's "<title> ▾". */
async function menuRows(page: Page, title: string) {
  await page.locator('.hd .ph-title-btn', {hasText: title}).tap();
  const menu = page.getByRole('menu', {name: title});
  await menu.waitFor();
  return (await menu.locator('.menu-i, .menu-sep').evaluateAll(all => all.map(node => (node.classList.contains('menu-sep') ? '—' : [
    node.querySelector('.ell')?.textContent, node.querySelector('.ph-title-count')?.textContent, node.getAttribute('aria-checked') === 'true' && '✓',
  ].filter(Boolean).join(' ')))));
}

test('the Inbox\'s title menu reaches Sent, Drafts and Snoozed, each naming itself with the Inbox tab lit, and its views go back to the Inbox', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await setpoint.api('POST', `/mail/messages/${await email(setpoint, 'Final exam schedule')}/snooze`, {until: '2026-10-12T16:00:00.000Z'});
    await drafted(setpoint, 'Interview availability');
    const page = await inbox(setpoint);
    assert.deepEqual(await menuRows(page, 'Inbox'), ['All ✓', 'Unread 19', 'Attention 2', 'FYI', 'Noise', '—', 'Sent', 'Drafts 1', 'Snoozed 1', '—', 'Settings']);
    let title = 'Inbox';
    for (const [label, address] of [['Sent', '/sent'], ['Drafts', '/drafts'], ['Snoozed', '/snoozed']] as const) {
      if (title !== 'Inbox') await menuRows(page, title);
      await page.getByRole('menu').getByRole('menuitemradio', {name: new RegExp(`^${label}`)}).tap();
      await until(`on ${label}`, async () => path(page.url()), at => at === address);
      await page.locator('.hd .ph-title-btn', {hasText: label}).waitFor();
      await page.locator('.ph-tab.on', {hasText: 'Inbox'}).waitFor();
      title = label;
    }
    // From Snoozed, a view opens the Inbox in it, and the Inbox tab opens All.
    assert.deepEqual((await menuRows(page, 'Snoozed')).slice(5, 9), ['—', 'Sent', 'Drafts 1', 'Snoozed 1 ✓']);
    await page.getByRole('menu').getByRole('menuitemradio', {name: /^Attention/}).tap();
    await until('on Attention', async () => `${path(page.url())}${new URL(page.url()).search}`, at => at === '/inbox?view=attention');
    await page.goto(`${setpoint.base}/sent`);
    await page.locator('.list .row').first().waitFor();
    await page.locator('.ph-tab', {hasText: 'Inbox'}).tap();
    await until('the Inbox', async () => `${path(page.url())}${new URL(page.url()).search}`, at => at === '/inbox');
    // Scheduled stays on the desktop: its address opens the Inbox.
    await page.goto(`${setpoint.base}/scheduled`);
    await until('the Inbox', async () => path(page.url()), at => at === '/inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone Sent\'s email opens with Back to Sent and who it went to, Trash goes back to the list, and a row swiped all the way trashes with Undo', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/sent`);
    // A row swiped left rests on Trash alone, and all the way trashes it.
    const flights = page.locator('.list .row', {hasText: 'Thanksgiving flights'});
    await swipe(flights, 300, 220);
    await flights.locator('.sw-b').first().waitFor();
    assert.deepEqual(await flights.locator('.sw-b').allTextContents(), ['Trash']);
    await page.locator('.list .row', {hasText: 'Book club dates'}).tap();
    await flights.locator('.sw').waitFor({state: 'detached'});
    assert.equal(path(page.url()), '/sent', 'the press that closed the row opened nothing');
    await swipe(flights, 340, 30, false);
    await holdToast(page);
    const toast = page.locator('.toast', {hasText: 'Moved to Trash'});
    await toast.waitFor();
    const sentIds = async () => (await setpoint.api<SentOut>('GET', '/mail/sent?limit=500')).days.flatMap(day => day.rows).filter(row => row.subject === 'Thanksgiving flights').length;
    await until('trashed', sentIds, count => count === 0);
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await until('back', sentIds, count => count === 1);
    await flights.waitFor();
    const hike = page.locator('.list .row', {hasText: 'Re: Saturday hike'});
    await hike.tap();
    await page.locator('.rd-subj', {hasText: 'Re: Saturday hike'}).waitFor();
    await page.locator('.rd-meta .to', {hasText: 'to Sam Ortiz'}).waitFor();
    assert.ok(await page.locator('.rd-meta .to').isVisible(), 'who it went to shows');
    await page.locator('.ph-top .ph-back', {hasText: 'Sent'}).waitFor();
    assert.deepEqual(await page.locator('.ph-acts > button').allTextContents(), ['Trash', 'Reply', 'More']);

    await page.locator('.ph-acts > button', {hasText: 'Trash'}).tap();
    await holdToast(page);
    await page.locator('.toast', {hasText: 'Moved to Trash'}).waitFor();
    await until('back on the list', async () => path(page.url()), at => at === '/sent');
    // Undo puts it back, and the email back in the reader, as the Inbox's does.
    await page.locator('.toast button', {hasText: 'Undo'}).tap();
    await page.locator('.rd-subj', {hasText: 'Re: Saturday hike'}).waitFor();
    await page.locator('.ph-top .ph-back', {hasText: 'Sent'}).tap();
    await until('back on the list', async () => path(page.url()), at => at === '/sent');
    await hike.waitFor();

    // A sent email of the conversation opens with the rest stacked over it; a line expands where it
    // is, with no new address, and Back goes to Sent.
    await page.locator('.list .row', {hasText: 'Re: Cabin weekend in November'}).first().tap();
    const first = await until('the cabin conversation', async () => path(page.url()), at => at.startsWith('/sent/'));
    await page.locator('.cv-mail.opened', {hasText: '4 PM works.'}).waitFor();
    await page.locator('.cv-line', {hasText: 'Games and a cooler, done'}).tap();
    await page.locator('.cv-mail', {hasText: 'Games and a cooler, done'}).waitFor();
    assert.equal(path(page.url()), first);
    await page.locator('.ph-top .ph-back', {hasText: 'Sent'}).tap();
    await until('back on the list', async () => path(page.url()), at => at === '/sent');

    // New message puts up the composer's sheet, with no pane beside the list.
    await page.getByRole('button', {name: 'New message'}).tap();
    await page.getByRole('dialog', {name: 'New message'}).waitFor();
    assert.equal(await page.locator('.content > .pane').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone a draft opens in the composer\'s sheet, Cancel keeps it and leaves no address for Back, and a row swiped all the way discards it with Undo', async () => {
  const setpoint = await startSetpoint();
  try {
    const draft = await drafted(setpoint, 'Interview availability');
    const page = await inbox(setpoint);
    await page.locator('.hd .ph-title-btn').tap();
    await page.getByRole('menu').getByRole('menuitemradio', {name: /^Drafts/}).tap();
    const row = page.locator('.drafts-list .row', {hasText: draft.subject});
    await row.tap();
    const sheet = page.getByRole('dialog', {name: 'Reply'});
    await sheet.waitFor();
    await until('its address', async () => path(page.url()), at => at === `/drafts/${draft.id}`);
    await saveDraft(sheet);
    await sheet.waitFor({state: 'detached'});
    await until('back on Drafts', async () => path(page.url()), at => at === '/drafts');
    // Back leaves Drafts for the Inbox, not the draft again.
    await page.goBack();
    await until('the Inbox', async () => path(page.url()), at => at === '/inbox');
    assert.equal(await page.getByRole('dialog', {name: 'Reply'}).count(), 0);
    assert.equal((await drafts(setpoint)).length, 1, 'Cancel kept the draft');

    await page.goto(`${setpoint.base}/drafts`);
    await swipe(row, 300, 220);
    await row.locator('.sw-b').first().waitFor();
    assert.deepEqual(await row.locator('.sw-b').allTextContents(), ['Discard']);
    await row.locator('.sw-b', {hasText: 'Discard'}).tap();
    await holdToast(page);
    const toast = page.locator('.toast', {hasText: 'Draft discarded'});
    await toast.waitFor();
    await until('discarded', () => drafts(setpoint), now => now.length === 0);
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await until('back', () => drafts(setpoint), now => now.length === 1);
    await page.locator('.drafts-list .row', {hasText: draft.subject}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone a Snoozed row swiped left offers Unsnooze and Snooze, whose sheet gives a new time; all the way unsnoozes with Undo; the reader\'s More does the same', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const exams = await email(setpoint, 'Final exam schedule');
    const interview = await email(setpoint, 'Interview availability');
    await setpoint.api('POST', `/mail/messages/${exams}/snooze`, {until: '2026-10-12T16:00:00.000Z'});
    await setpoint.api('POST', `/mail/messages/${interview}/snooze`, {until: '2026-10-14T16:00:00.000Z'});
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/snoozed`);
    const examRow = page.locator('.snoozed-list .row', {hasText: 'Contoso University'});
    await examRow.waitFor();
    // The row's Unsnooze under the pointer is the swipe's on the phone.
    assert.equal(await page.locator('.snoozed-list .hact').first().isVisible(), false);

    await swipe(examRow, 300, 150);
    await examRow.locator('.sw-b').first().waitFor();
    assert.deepEqual(await examRow.locator('.sw-b').allTextContents(), ['Unsnooze', 'Snooze']);
    await examRow.locator('.sw-b', {hasText: 'Snooze'}).last().tap();
    const sheet = page.getByRole('dialog', {name: /^Snoozed until /});
    await sheet.waitFor();
    assert.equal(await sheet.locator('.ph-bs-i').last().textContent(), 'Unsnooze');
    await sheet.getByRole('button', {name: /^Tomorrow/}).tap();
    await sheet.waitFor({state: 'detached'});
    await until('a new time', () => snoozed(setpoint), rows => rows.find(row => row.id === exams)?.snoozed_until !== '2026-10-12T16:00:00.000Z');

    await swipe(examRow, 340, 30, false);
    await holdToast(page);
    const toast = page.locator('.toast', {hasText: 'Back in the Inbox'});
    await toast.waitFor();
    await until('unsnoozed', () => snoozed(setpoint), rows => !rows.some(row => row.id === exams));
    await toast.locator('button', {hasText: 'Undo'}).tap();
    await until('snoozed again', () => snoozed(setpoint), rows => rows.some(row => row.id === exams));
    await examRow.waitFor();

    // The reader: Back to Snoozed, and More's Snoozed row opens the same sheet, whose Unsnooze goes back to the list.
    await page.locator('.snoozed-list .row', {hasText: 'Northwind'}).tap();
    await page.locator('.ph-top .ph-back', {hasText: 'Snoozed'}).waitFor();
    await page.locator('.ph-acts > button', {hasText: 'More'}).tap();
    await page.getByRole('dialog', {name: 'More'}).getByRole('button', {name: /^Snoozed/}).tap();
    await page.getByRole('dialog', {name: /^Snoozed until /}).getByRole('button', {name: 'Unsnooze'}).tap();
    await page.locator('.toast', {hasText: 'Back in the Inbox'}).waitFor();
    await until('back on the list', async () => path(page.url()), at => at === '/snoozed');
    await until('unsnoozed', () => snoozed(setpoint), rows => !rows.some(row => row.id === interview));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
