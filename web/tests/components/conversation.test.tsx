// The reader's conversation list: the open email's thread as a timeline, one row each with its date, its time,
// the sender's name or "You" and the first words, oldest first, under one heading with their count.
// The open email is a row in its place, marked as current and no link; any other row opens its email,
// a sent one included, saying which. A long run of earlier emails folds behind "N more". The rows'
// order, times and fold are logic/reader.ts › conversationLines, tested as tables in reader.test.ts.
import type {ConversationEmailOut, MessageOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {Conversation} from '../../src/app/Conversation.tsx';

const DAY = 24 * 60 * 60_000;
const NOW = Date.parse(SEED_NOW);
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const email = (id: number, days: number, sent: boolean, excerpt = `Words of ${id}`): ConversationEmailOut => ({
  id, from_name: sent ? 'User' : 'Theo Walsh', from_address: sent ? 'user@example.com' : 'theo.walsh@example.org', sent, received_at: ago(days),
  subject: 'Re: Cabin weekend in November', excerpt,
});

/** The open email, ten days back unless asked, with its thread's other emails. */
const open = (conversation: ConversationEmailOut[], days = 10) => ({id: 100, received_at: ago(days), from_name: 'Theo Walsh', from_address: 'theo.walsh@example.org', conversation} as unknown as MessageOut);

async function list(message: MessageOut, onOpen = vi.fn()) {
  await render(<div style={{width: 640}}><Conversation message={message} timeZone={SEED_TIME_ZONE} onOpen={onOpen} /></div>);
  return onOpen;
}

const lines = () => [...document.querySelectorAll('.rd-conv-line')].map(line => [...line.children].map(part => part.textContent).join(' | '));
const heading = () => page.getByRole('heading', {name: /^In this conversation/});

test('every email is a row, oldest first, the open one in its place: its date, its time, the sender or "You", the first words', async () => {
  await list(open([email(1, 14, false), email(2, 13, true), email(3, 9, false, '')]));
  await expect.element(heading()).toHaveTextContent('In this conversation4');
  // An email with no words shows its subject.
  expect(lines()).toEqual([
    'Sep 23 | 9:12 AM | Theo Walsh | Words of 1', 'Sep 24 | 9:12 AM | You | Words of 2', 'Sep 27 | 9:12 AM | Theo Walsh | This email', 'Sep 28 | 9:12 AM | Theo Walsh | Re: Cabin weekend in November',
  ]);
});

test('a click on another row opens its email, a sent one too; the open email\'s row is current and no link', async () => {
  const onOpen = await list(open([email(1, 14, false), email(2, 13, true)]));
  await expect.element(heading()).toBeVisible();
  const current = document.querySelector('.rd-conv [aria-current="true"]')!;
  expect([current.tagName, current.textContent]).toEqual(['DIV', 'Sep 279:12 AMTheo WalshThis email']);
  expect(page.getByRole('button').elements().map(button => button.textContent)).toEqual(['Sep 239:12 AMTheo WalshWords of 1', 'Sep 249:12 AMYouWords of 2']);
  await userEvent.click(page.getByRole('button', {name: /You/}));
  expect(onOpen).toHaveBeenCalledWith(2, true);
  await userEvent.click(page.getByRole('button', {name: /Theo Walsh/}));
  expect(onOpen).toHaveBeenLastCalledWith(1, false);
});

test('a long run folds its oldest behind "N more", and that line opens them', async () => {
  const thread = [1, 2, 3, 4, 5, 6, 7].map(id => email(id, 20 - id, id % 2 === 0));
  await list(open(thread));
  await expect.element(page.getByRole('button', {name: '3 more'})).toBeVisible();
  // The count is the whole conversation's, folded or not.
  await expect.element(heading()).toHaveTextContent('In this conversation8');
  expect(lines().slice(1).map(line => line.split(' | ')[3])).toEqual(['Words of 4', 'Words of 5', 'Words of 6', 'Words of 7', 'This email']);
  await userEvent.click(page.getByRole('button', {name: '3 more'}));
  await expect.poll(() => lines().length).toBe(8);
  expect(lines().map(line => line.split(' | ')[3])).toEqual([...thread.map(one => one.excerpt), 'This email']);
});

test('a row\'s parts fit its width: a long sender and long words are cut short, the date and time whole', async () => {
  await list(open([{...email(1, 14, false, 'Words '.repeat(60)), from_name: 'A sender whose name runs on and on and on and on'}]));
  await expect.element(heading()).toBeVisible();
  const row = document.querySelector('button.rd-conv-line')!;
  const [day, time, who, words] = [...row.children] as HTMLElement[];
  for (const part of [day!, time!]) expect(part.scrollWidth).toBeLessThanOrEqual(part.clientWidth);
  expect(who!.scrollWidth).toBeGreaterThan(who!.clientWidth);
  expect(words!.clientWidth).toBeGreaterThan(100);
  expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
});

test('an email alone in its thread has no list', async () => {
  await list(open([]));
  expect(document.querySelector('.rd-conv')).toBeNull();
});
