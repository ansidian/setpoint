// Alfred at the iPhone size, against the fake Anthropic (fakeAlfred.ts): asked from mail search by
// its Ask Alfred row, his answer above the results and a follow-up under it. Away from search the
// conversation waits as a pill above the tab bar, which opens it in the full-screen sheet; Back folds
// it again and the pill's × closes it. His email rows open the phone's reader and his item rows the
// item's detail on the Agenda. A reload brings the pill back, unless the server has ended the thread.
// His proposal is a compact card that fits 375 px, whose Add opens the phone's editor sheet.
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {ItemsOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {FAKE_ANTHROPIC_KEY, fakeAlfred, leaseAlfred} from './fakeAlfred.ts';
import type {AlfredTurn, Call} from './fakeAlfred.ts';
import {cleanUp, holdToast, rested, startSetpoint, test, until} from './harness.ts';
import {box, inbox} from './phoneHelpers.ts';

after(cleanUp);

const LEASE_QUESTION = 'When does my lease renewal need to be signed?';
const PROPOSE_QUESTION = 'Put signing the lease renewal on my calendar';
// Alfred's proposal, longer than a phone's line, at his own day and times (not the email's own reading).
const PROPOSED_TITLE = 'Sign the lease renewal at the Parkside Apartments leasing office';
const DENTIST_QUESTION = 'When is my dentist appointment?';

/**
 * Board 07's lease answers, and the dentist question: it lists the week's items named Dentist and
 * answers resting on the first, as an item the answer cites.
 */
function phoneAlfred(turn: AlfredTurn): Call {
  if (turn.question === PROPOSE_QUESTION) return proposeAlfred(turn);
  if (!/dentist/i.test(turn.question)) return leaseAlfred(turn);
  const listed = turn.results.find(result => Array.isArray(result.items)) as {items: {key: string}[]} | undefined;
  if (!listed) return {name: 'list_items', input: {from: '2026-10-07', to: '2026-10-15', query: 'Dentist'}};
  return {name: 'answer', input: {found: true, text: 'Today at 2:30 PM, at Smile Dental.', source_ids: [], item_keys: [listed.items[0]!.key], emphasis: ['2:30 PM']}};
}

/** The proposal question: searches the lease email, proposes its signing as an event, then answers. */
function proposeAlfred({question, results}: AlfredTurn): Call {
  const searched = results.find(result => 'searched' in result) as {results: {message_id: number; email: string}[]} | undefined;
  const lease = searched?.results.find(row => row.email.includes('Subject: Lease renewal terms'));
  if (!lease) return {name: 'search_mail', input: {query: 'lease renewal'}};
  if (!results.some(result => result.ready === true)) {
    return {name: 'propose_item', input: {owner_instruction: question, message_id: lease.message_id, kind: 'event', title: PROPOSED_TITLE, date: '2026-10-29', start_time: '17:30', end_time: '18:30'}};
  }
  return {name: 'answer', input: {found: true, text: 'Here it is, the Thursday before it\'s due.', source_ids: [lease.message_id], emphasis: []}};
}

async function withAlfred() {
  const fake = await fakeAlfred(phoneAlfred);
  const setpoint = await startSetpoint({env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
  return {setpoint, stop: async () => {
    await setpoint.stop();
    await fake.close();
  }};
}

function asksOf(page: Page): {question: string; conversation_id?: number}[] {
  const asks: {question: string; conversation_id?: number}[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/alfred/ask') asks.push(JSON.parse(request.postData()!) as {question: string; conversation_id?: number});
  });
  return asks;
}

const pill = (page: Page) => page.locator('.alf-pill');
const sheet = (page: Page) => page.getByRole('dialog', {name: 'Alfred'});

/** Asks a question (the lease one) from search by its Ask Alfred row, and waits for the answer above the results. */
async function askFromSearch(page: Page, question = LEASE_QUESTION, answer = 'By Oct 31, 2026') {
  await page.locator('.search input').tap();
  await page.keyboard.type(question);
  await page.locator('.search-list .result').first().waitFor();
  await page.locator('.search-list .ask').tap();
  await page.locator('.search-list .answer .ans', {hasText: answer}).waitFor();
}

/**
 * The proposal card fits the screen: its day and times show whole, in no box narrower than they
 * are and inside the card, which is inside the screen. And no key hint shows on it.
 */
async function proposalFits(card: Locator, where: string) {
  const fit = await card.evaluate(element => {
    const shown = (one: Element) => one.getBoundingClientRect();
    // Whatever shows the day: its text, or a field's value.
    const day = [...element.querySelectorAll('*')].filter(one => (one instanceof HTMLInputElement ? one.value.includes('Oct 29')
      : [...one.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent!.includes('Oct 29'))));
    const cardBox = shown(element);
    return {
      days: day.length,
      clipped: day.filter(one => one.scrollWidth > one.clientWidth + 1 || shown(one).right > cardBox.right + 0.5 || shown(one).left < cardBox.left - 0.5).map(one => (one instanceof HTMLInputElement ? one.value : one.textContent)),
      right: cardBox.right,
      width: document.documentElement.clientWidth,
      hints: [...element.querySelectorAll('.kbd')].filter(one => (one as HTMLElement).offsetParent !== null).map(one => one.textContent),
    };
  });
  assert.ok(fit.days > 0, `${where}: the proposal names its day`);
  assert.deepEqual(fit.clipped, [], `${where}: the day shows whole`);
  assert.ok(fit.right <= fit.width, `${where}: the card (to ${fit.right}) is inside the screen (${fit.width})`);
  assert.deepEqual(fit.hints, [], `${where}: no key hints`);
}

test('phone Alfred: with no conversation the round button asks from any page, the sheet answering; Back on an empty sheet leaves the button', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await inbox(setpoint);
    const asks = asksOf(page) as {question: string; context?: unknown}[];
    const button = page.getByRole('button', {name: 'Ask Alfred'});
    assert.equal(await pill(page).count(), 0);
    // Back with nothing asked: no conversation, the button again.
    await button.tap();
    await sheet(page).waitFor();
    await sheet(page).getByRole('button', {name: 'Inbox'}).tap();
    await button.waitFor();
    assert.equal(await pill(page).count(), 0);
    // Asked: the sheet answers, and the question carries the page.
    await button.tap();
    await sheet(page).getByLabel('Ask a follow-up').fill(LEASE_QUESTION);
    await sheet(page).getByLabel('Ask a follow-up').press('Enter');
    await sheet(page).locator('.ans', {hasText: 'By Oct 31, 2026'}).waitFor();
    assert.deepEqual(asks.map(ask => [ask.question, ask.context]), [[LEASE_QUESTION, {page: 'inbox'}]]);
    // Back: the conversation waits as the pill, in the button's place.
    await sheet(page).getByRole('button', {name: 'Inbox'}).tap();
    await pill(page).waitFor();
    assert.equal(await button.count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('phone Alfred: Ask Alfred in search answers above the results, a follow-up goes below, and a source opens in the reader with Back to Search', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await inbox(setpoint);
    const asks = asksOf(page);
    await askFromSearch(page);
    assert.equal(await page.locator('.search-list .ask').count(), 0, 'the Answer card stands in for Ask Alfred');
    // The card sits above the results.
    const [card, firstResult] = [await box(page, '.search-list .answer'), await box(page, '.search-list .result')];
    assert.ok(card.y + card.height <= firstResult.y, 'the card is above the results');
    // No keyboard rises on its own: the follow-up field waits for a tap.
    assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ask a follow-up');

    // A follow-up, below the first turn, in the same conversation.
    await page.locator('.search-list .answer input').tap();
    await page.keyboard.type('what\'s the new rent?');
    await page.keyboard.press('Enter');
    await until('the second answer', () => page.locator('.search-list .answer .ans').count(), count => count === 2);
    assert.equal(await page.locator('.search-list .answer .ans').nth(1).textContent(), '$2,140 a month, up from $2,060.');
    assert.equal(asks.length, 2);
    assert.ok(asks[1]!.conversation_id, 'the follow-up names its conversation');

    // A source opens in the phone's reader, which goes back to the search with the card.
    await page.locator('.search-list .answer .src', {hasText: 'Lease renewal terms'}).first().tap();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    assert.equal(await page.locator('.ph-back').textContent(), 'Search');
    await page.locator('.ph-back').tap();
    await until('back at the results', () => page.locator('.pane').count(), count => count === 0);
    await page.locator('.search-list .answer .ans', {hasText: '$2,140'}).waitFor();
    assert.equal(await pill(page).count(), 0, 'no pill while search shows him');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('phone Alfred: away from search he waits as a pill; it opens the sheet, Back folds it, an email row opens the reader, × closes him for good', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await inbox(setpoint);
    await askFromSearch(page);
    // Leaving search: the Inbox comes back with the pill above the tab bar, not the sheet.
    await page.locator('.search .search-clear').tap();
    await page.locator('.content > .list .gh').first().waitFor();
    await pill(page).waitFor();
    assert.equal(await sheet(page).count(), 0);
    const [shown, tabs] = [await box(page, '.alf-pill'), await box(page, '.ph-tabs')];
    assert.ok(shown.y + shown.height <= tabs.y, 'the pill is above the tab bar');

    // The pill opens the sheet over everything, the question shown, Back naming the page under it.
    await page.getByRole('button', {name: 'Open Alfred'}).tap();
    await sheet(page).locator('.ans', {hasText: 'By Oct 31, 2026'}).waitFor();
    assert.equal(await sheet(page).locator('.q').textContent(), LEASE_QUESTION);
    assert.equal(await sheet(page).locator('.ph-sheet-lead').textContent(), 'Inbox');
    assert.equal(await pill(page).count(), 0, 'the sheet stands in for the pill');
    // Back folds it to the pill.
    await sheet(page).locator('.ph-sheet-lead').tap();
    await until('the sheet folds', () => sheet(page).count(), count => count === 0);
    await pill(page).waitFor();

    // An email row opens the phone's reader and folds the sheet; the pill keeps out of the reader's way.
    await page.getByRole('button', {name: 'Open Alfred'}).tap();
    await sheet(page).locator('.src', {hasText: 'Lease renewal terms'}).tap();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    assert.equal(await sheet(page).count(), 0);
    assert.equal(await pill(page).count(), 0);
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    await pill(page).waitFor();

    // × closes the conversation, and a reload doesn't bring it back.
    await page.getByRole('button', {name: 'Close Alfred'}).tap();
    await until('the pill goes', () => pill(page).count(), count => count === 0);
    await page.reload();
    await page.locator('.list .row').first().waitFor();
    await setpoint.idle();
    assert.equal(await pill(page).count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('phone Alfred on the Agenda: a reload keeps the pill with no question asked, a follow-up in the sheet continues him, his item row opens its detail; ended, he doesn\'t come back', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await inbox(setpoint);
    const asks = asksOf(page);
    await askFromSearch(page);
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    await pill(page).waitFor();

    // A reload: the pill comes back, the thread read from the server, nothing asked.
    await page.reload();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    await pill(page).waitFor();
    await setpoint.idle();
    assert.equal(asks.length, 1);

    // A follow-up in the sheet continues the conversation; his item row opens the item's detail.
    await page.getByRole('button', {name: 'Open Alfred'}).tap();
    await sheet(page).locator('.ans', {hasText: 'By Oct 31, 2026'}).waitFor();
    assert.equal(await sheet(page).locator('.ph-sheet-lead').textContent(), 'Agenda');
    await sheet(page).getByLabel('Ask a follow-up').tap();
    await page.keyboard.type(DENTIST_QUESTION);
    await page.keyboard.press('Enter');
    await sheet(page).locator('.ans', {hasText: 'Today at 2:30 PM'}).waitFor();
    assert.deepEqual(await sheet(page).locator('.q').allTextContents(), [LEASE_QUESTION, DENTIST_QUESTION]);
    assert.ok(asks[1]!.conversation_id, 'the follow-up names its conversation');
    await sheet(page).locator('.src.item', {hasText: 'Dentist'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist'}).waitFor();
    assert.equal(await sheet(page).count(), 0);
    assert.equal(await pill(page).count(), 0, 'the pill keeps out of the detail\'s way');
    assert.match(new URL(page.url()).pathname, /^\/calendar\/item\//);

    // The thread was last touched five hours ago, as the server's clock now reads it: a reload ends it.
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    database.prepare('UPDATE alfred_conversations SET touched_at = ?').run(new Date(Date.parse(String((database.prepare('SELECT touched_at FROM alfred_conversations').get() as {touched_at: string}).touched_at)) - 5 * 60 * 60_000).toISOString());
    database.close();
    await page.reload();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    await setpoint.idle();
    assert.equal(await pill(page).count(), 0);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('alfred.thread')), null, 'the tab forgets it');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('phone Alfred\'s proposal: a chip that fits 375 px, inline and in his sheet; Edit opens the editor sheet on his draft, and Create makes it with Undo', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await inbox(setpoint);
    await page.setViewportSize({width: 375, height: 812});
    await askFromSearch(page, PROPOSE_QUESTION, 'the Thursday before');
    const inline = page.locator('.search-list .answer').locator('[aria-label="Proposal: add to calendar"]');
    await inline.waitFor();
    await rested(() => proposalFits(inline, 'inline in search'));

    // In his sheet too.
    await page.locator('.search .search-clear').tap();
    await page.getByRole('button', {name: 'Open Alfred'}).tap();
    const card = sheet(page).locator('[aria-label="Proposal: add to calendar"]');
    await card.waitFor();
    await rested(() => proposalFits(card, 'in his sheet'));
    assert.equal(await card.locator('.chip-what').textContent(), PROPOSED_TITLE);

    // Edit opens the editor sheet on his draft: his title, day and times.
    await card.getByRole('button', {name: 'Edit'}).tap();
    const editor = page.getByRole('dialog', {name: 'New event'});
    await editor.waitFor();
    assert.equal(await editor.getByLabel('Describe the event').inputValue(), PROPOSED_TITLE);
    assert.equal(await editor.getByLabel('Date', {exact: true}).inputValue(), '2026-10-29');
    assert.equal(await editor.getByLabel('Start', {exact: true}).inputValue(), '17:30');
    assert.equal(await editor.getByLabel('End', {exact: true}).inputValue(), '18:30');
    assert.equal(await editor.locator('.kbd:visible').count(), 0, 'no key hints in the sheet');

    // Create makes it, says so with Undo, and leaves his answer under it.
    await editor.getByRole('button', {name: 'Create'}).tap();
    await editor.waitFor({state: 'detached'});
    const toast = await holdToast(page);
    await toast.getByText(`Created ${PROPOSED_TITLE}`).waitFor();
    const made = async () => (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-29&to=2026-10-30')).items.filter(item => item.title === PROPOSED_TITLE);
    const [item] = await until('the event made', made, list => list.length === 1);
    assert.equal(item!.all_day, false);
    await sheet(page).locator('.ans', {hasText: 'the Thursday before'}).waitFor();
    // Undo deletes it again.
    await toast.getByRole('button', {name: 'Undo'}).tap();
    await until('the event undone', made, list => list.length === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});
