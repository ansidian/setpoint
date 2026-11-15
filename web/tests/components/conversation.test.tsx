// The reader's conversation list: the other emails of the open email's thread, one line each with
// the sender's name or "You", the first words and the age, oldest first. Its heading says where they
// sit, this email's place is marked when they sit on both sides, and a long run of earlier emails
// folds behind "N more", keeping the nearest in view. A line opens its email, a sent one included, saying which.
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
const open = (conversation: ConversationEmailOut[], days = 10) => ({id: 100, received_at: ago(days), conversation} as unknown as MessageOut);

async function list(message: MessageOut, onOpen = vi.fn()) {
  await render(<div style={{width: 640}}><Conversation message={message} now={NOW} timeZone={SEED_TIME_ZONE} onOpen={onOpen} /></div>);
  return onOpen;
}

const lines = () => [...document.querySelectorAll('.rd-conv-line')].map(line => [...line.children].map(part => part.textContent).join(' | '));

test('earlier emails, oldest first: the sender or "You", the first words and the age; a click opens a sent one too', async () => {
  const onOpen = await list(open([email(1, 14, false), email(2, 13, true), email(3, 12, false, '')]));
  await expect.element(page.getByRole('heading', {name: 'Earlier in this conversation'})).toBeVisible();
  // An email with no words shows its subject.
  expect(lines()).toEqual(['Theo Walsh | Words of 1 | Sep 23', 'You | Words of 2 | Sep 24', 'Theo Walsh | Re: Cabin weekend in November | Sep 25']);
  await userEvent.click(page.getByRole('button', {name: /^You/}));
  expect(onOpen).toHaveBeenCalledWith(2, true);
});

test('only later emails say so, and emails on both sides mark this one between them', async () => {
  await list(open([email(1, 9, true), email(2, 8, false)]));
  await expect.element(page.getByRole('heading', {name: 'Later in this conversation'})).toBeVisible();
  expect(document.querySelector('.rd-conv-line.here')).toBeNull();
  document.body.replaceChildren();

  await list(open([email(1, 14, false), email(2, 9, true)]));
  await expect.element(page.getByRole('heading', {name: 'In this conversation'})).toBeVisible();
  expect(lines()).toEqual(['Theo Walsh | Words of 1 | Sep 23', 'This email', 'You | Words of 2 | Sep 28']);
});

test('a long run folds its oldest behind "N more", and that line opens them', async () => {
  const thread = [1, 2, 3, 4, 5, 6, 7].map(id => email(id, 20 - id, id % 2 === 0));
  await list(open(thread));
  await expect.element(page.getByRole('button', {name: '3 more'})).toBeVisible();
  expect(lines().slice(1).map(line => line.split(' | ')[1])).toEqual(['Words of 4', 'Words of 5', 'Words of 6', 'Words of 7']);
  await userEvent.click(page.getByRole('button', {name: '3 more'}));
  await expect.poll(() => lines().length).toBe(7);
  expect(lines().map(line => line.split(' | ')[1])).toEqual(thread.map(one => one.excerpt));
});

test('five earlier emails all show: a fold never hides just one', async () => {
  await list(open([1, 2, 3, 4, 5].map(id => email(id, 20 - id, false))));
  await expect.element(page.getByRole('heading', {name: 'Earlier in this conversation'})).toBeVisible();
  expect(lines()).toHaveLength(5);
});

test('an email alone in its thread has no list', async () => {
  await list(open([]));
  expect(document.querySelector('.rd-conv')).toBeNull();
});
