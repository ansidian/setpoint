// The desktop reader's stacked conversation: which emails open expanded (the opening's answer, held
// through later loads), every other email collapsed to its sender, paperclip, time and first words,
// a click on a collapsed email expanding it and one on an expanded email's head folding it back, and
// the foot's Reply answering the newest email someone else sent. The server is faked at `fetch`.
import type {ConversationMessageOut, MailConversationOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {openMessage} from '../../src/api/mail.ts';
import {ConversationStack} from '../../src/app/ConversationStack.tsx';

const NOW = Date.parse(SEED_NOW);
const HOUR = 60 * 60_000;

const email = (id: number, fields: Partial<ConversationMessageOut> = {}): ConversationMessageOut => ({
  id, account_id: 1, thread_id: 't1', from_name: 'Theo Walsh', from_address: 'theo.walsh@example.org', organisation: null, via: null,
  subject: 'Re: Cabin weekend in November', summary: null, received_at: new Date(NOW - (10 - id) * HOUR).toISOString(), unread: false,
  lane: 'fyi', kind: 'people', type: null, protected: false, pinned: false, done: false, fact: null, code: null, trash_due_at: null,
  attachment_count: 0, command: null, body_text: `The words of email ${id}.`, body_html: null, key_date: null, security: null, attachments: [],
  remote_content: {domain: 'example.org', trust_domain: 'example.org', sender_authenticated: null, trusted: false, load: false, reason: 'unknown'},
  open_url: null, to: [], cc: [], reply_to: [], expanded: false, excerpt: `First words of ${id}`, quoted_history: false, ...fields,
});

const conversation = (emails: ConversationMessageOut[], opened = emails.at(-1)!.id): MailConversationOut => ({
  account_id: 1, thread_id: 't1', subject: 'Cabin weekend in November', opened_id: opened, row: emails.find(one => one.id === opened)!, emails, draft: null, summary: null,
});

const posted: {url: string; body: unknown}[] = [];

/** The server: the opening's answer, and a draft started for each composer. */
function serve(opening: MailConversationOut) {
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (init?.method === 'POST') posted.push({url, body: init.body ? JSON.parse(String(init.body)) as unknown : null});
    const answer = url.endsWith('/open') ? opening : url.includes('/drafts') ? {id: 9, message_id: 3} : {};
    return Promise.resolve(new Response(JSON.stringify(answer), {status: 200, headers: {'Content-Type': 'application/json'}}));
  });
}

afterEach(() => {
  posted.length = 0;
  vi.restoreAllMocks();
});

async function stack(shown: MailConversationOut) {
  return render(<div className="pane" style={{width: 680}}><ConversationStack conversation={shown} accounts={new Map()} now={NOW} timeZone={SEED_TIME_ZONE} marks={[]} from={undefined} composer={null} onCard={vi.fn()} /></div>);
}

const shape = () => [...document.querySelectorAll('.cv > [data-email]')].map(one => `${(one as HTMLElement).dataset.email}${one.classList.contains('cv-mail') ? 'E' : 'c'}`).join(' ');

test('the opening\'s answer decides what opens expanded, and a load served after it, which read the unread email, folds nothing', async () => {
  const emails = [1, 2, 3, 4, 5].map(id => email(id));
  const expanded = (ids: number[]) => emails.map(one => ({...one, expanded: ids.includes(one.id)}));
  // The opening judged email 3 unread; a load served after it sees it read.
  serve(conversation(expanded([1, 3, 5])));
  await openMessage(5);
  const later = conversation(expanded([1, 5]));
  const screen = await stack(later);
  expect(shape()).toBe('1E 2c 3E 4c 5E');
  await screen.rerender(<div className="pane" style={{width: 680}}><ConversationStack conversation={{...later}} accounts={new Map()} now={NOW} timeZone={SEED_TIME_ZONE} marks={[]} from={undefined} composer={null} onCard={vi.fn()} /></div>);
  expect(shape()).toBe('1E 2c 3E 4c 5E');
});

test('every collapsed email shows its sender, a paperclip when it has files, its time and first words, with no run folded away', async () => {
  const pdf = {id: 1, filename: 'cabin-map.pdf', mime_type: 'application/pdf', size_bytes: 1000};
  const emails = [1, 2, 3, 4, 5, 6, 7].map(id => email(id, {expanded: id === 1 || id === 7, ...(id === 3 ? {attachments: [pdf] as never} : {})}));
  serve(conversation(emails));
  await stack(conversation(emails));
  expect(shape()).toBe('1E 2c 3c 4c 5c 6c 7E');
  const line = document.querySelector('.cv-line[data-email="3"]')!;
  expect([line.querySelector('.who')?.textContent, line.querySelector('.words')?.textContent, !!line.querySelector('[aria-label="Has attachments"]')]).toEqual(['Theo Walsh', 'First words of 3', true]);
  expect(document.querySelector('.cv-line[data-email="2"] [aria-label="Has attachments"]')).toBeNull();
});

test('a click expands a collapsed email, and a click on an expanded email\'s head, its sender\'s name too, folds it back', async () => {
  const emails = [1, 2, 3].map(id => email(id, {expanded: id !== 2}));
  serve(conversation(emails));
  await stack(conversation(emails));
  await userEvent.click(page.getByRole('button', {name: /First words of 2/}));
  expect(shape()).toBe('1E 2E 3E');
  await expect.element(page.getByText('The words of email 2.')).toBeVisible();
  await userEvent.click(document.querySelector('.cv-mail[data-email="2"] .cv-head .name')!);
  expect(shape()).toBe('1E 2c 3E');
  // Its tools don't fold it.
  await userEvent.click(document.querySelector('.cv-mail[data-email="3"] button[aria-label="More"]')!);
  expect(shape()).toBe('1E 2c 3E');
});

test('the foot\'s Reply answers the newest email someone else sent, past the user\'s own reply', async () => {
  const emails = [email(1, {expanded: true}), email(2), email(3), email(4, {expanded: true, sent_only: true, from_name: 'User', from_address: 'user@example.com'})];
  serve(conversation(emails));
  await stack(conversation(emails));
  await userEvent.click(page.getByRole('button', {name: /Reply to Theo Walsh/}));
  await expect.poll(() => posted.find(one => one.url.includes('/drafts'))?.body).toMatchObject({kind: 'reply', message_id: 3});
});
