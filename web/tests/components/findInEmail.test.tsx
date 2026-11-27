// Find in email in the header's field (search/Search.tsx, search/find.ts) over a reader's scroller:
// ⌘F's scope names the email, counts its matches and steps through them with Enter and ⇧Enter,
// wrapping; Backspace never leaves the scope; Esc gives the field back to the mail search with its
// words. Over a conversation (ConversationStack.tsx), a match in a collapsed email or a folded
// quoted history opens it, and Esc folds back only what find opened. A newer email's folded quote,
// which repeats the emails above it, isn't searched until the user opens it. The app around it (the keys,
// the dim, the frame, the phone) is findInEmail.spec.ts's.
import type {ConversationMessageOut, MailConversationOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {useRef} from 'react';
import type {ReactNode} from 'react';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {ConversationStack} from '../../src/app/ConversationStack.tsx';
import {closeFind, setFindFocused, setFindTarget, useFindIn} from '../../src/app/search/find.ts';
import {SearchField, selectSearch} from '../../src/app/search/Search.tsx';

const SUBJECT = 'Cabin weekend in November';

beforeEach(() => {
  vi.spyOn(window, 'fetch').mockImplementation(() => Promise.resolve(new Response('{}', {status: 200, headers: {'Content-Type': 'application/json'}})));
  setFindTarget({id: 1, subject: SUBJECT});
});

afterEach(() => {
  closeFind();
  setFindTarget(null);
  setFindFocused(false);
  vi.restoreAllMocks();
});

/** The mail search under the field, holding words of its own. */
const MAIL = {chips: [], text: 'northwind', active: true, setText: vi.fn(), settle: () => Promise.resolve(null), removeChip: vi.fn(), clear: vi.fn()};

function Reader({children}: {children: ReactNode}) {
  const pane = useRef<HTMLElement>(null);
  useFindIn(pane);
  return (
    <>
      <header className="hd"><SearchField search={MAIL} findable label="Search inbox" onEnter={() => {}} /></header>
      <section ref={pane} className="pane"><div className="rd-scroll" style={{height: 400, overflow: 'auto'}}>{children}</div></section>
    </>
  );
}

const field = () => document.querySelector<HTMLInputElement>('.search input')!;
const count = () => document.querySelector('.search .find-count')?.textContent ?? null;
const current = () => {
  const highlight = CSS.highlights.get('setpoint-find-current') as Iterable<Range> | undefined;
  return highlight ? [...highlight].map(range => `${range.startContainer.parentElement?.closest('[data-find]')?.id}:${range.toString()}`) : [];
};

test('⌘F\'s scope names the email, counts its matches, steps with Enter and ⇧Enter wrapping, keeps its scope on Backspace, and Esc gives the field back to the mail search', async () => {
  await render(<Reader><p id="one" data-find="">Could you bring a <b>cool</b>er?</p><p id="two" data-find="">Games and a Cooler, done.</p></Reader>);
  expect(selectSearch('email')).toBe(true);
  await expect.element(page.getByRole('textbox', {name: `Search ${SUBJECT}`})).toHaveFocus();
  expect(field().placeholder).toBe(`Search ${SUBJECT}`);
  expect(field().value).toBe('');

  await userEvent.keyboard('cooler');
  await expect.poll(count).toBe('1 of 2');
  // A match split across the email's own markup is one match.
  expect(current()).toEqual(['one:cooler']);
  await userEvent.keyboard('{Enter}');
  await expect.poll(count).toBe('2 of 2');
  expect(current()).toEqual(['two:Cooler']);
  await userEvent.keyboard('{Enter}');
  await expect.poll(count).toBe('1 of 2');
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
  await expect.poll(count).toBe('2 of 2');
  await expect.element(page.getByRole('textbox', {name: `Search ${SUBJECT}`})).toHaveFocus();

  await userEvent.keyboard('z');
  await expect.poll(count).toBe('No matches');
  expect(current()).toEqual([]);

  // Backspace only deletes letters: an empty field stays on the email.
  await userEvent.keyboard('{Backspace>8/}');
  expect(field().value).toBe('');
  await userEvent.keyboard('{Backspace}');
  expect(field().placeholder).toBe(`Search ${SUBJECT}`);
  expect(count()).toBeNull();

  await userEvent.keyboard('cooler{Escape}');
  await expect.poll(() => field().placeholder).toBe('Search inbox');
  expect(field().value).toBe('northwind');
  expect(MAIL.clear).not.toHaveBeenCalled();
  expect(current()).toEqual([]);
  expect(document.activeElement).not.toBe(field());
});

const NOW = Date.parse(SEED_NOW);

const email = (id: number, body: string, expanded: boolean): ConversationMessageOut => ({
  id, account_id: 1, thread_id: 't1', from_name: 'Theo Walsh', from_address: 'theo.walsh@example.org', organisation: null, via: null,
  subject: SUBJECT, summary: null, received_at: new Date(NOW - (10 - id) * 3_600_000).toISOString(), unread: false,
  lane: 'fyi', kind: 'people', type: null, protected: false, pinned: false, done: false, fact: null, code: null, trash_due_at: null,
  attachment_count: 0, command: null, body_text: body, body_html: null, key_date: null, security: null, attachments: [],
  remote_content: {domain: 'example.org', trust_domain: 'example.org', sender_authenticated: null, trusted: false, load: false, reason: 'unknown'},
  open_url: null, to: [], cc: [], reply_to: [], expanded, excerpt: `First words of ${id}`, quoted_history: false,
});

test('a match in a folded quoted history or a collapsed email opens it, and Esc folds back only what find opened', async () => {
  const emails = [
    email(1, 'See you Friday.\n\nOn Mon, Sep 29, 2026, Ana wrote:\n> Bring the cooler?', true),
    email(2, 'I have a cooler.', false),
    email(3, 'Games and a cooler, done.', false),
    email(4, 'Leaving at 4 PM.', true),
  ];
  const conversation: MailConversationOut = {account_id: 1, thread_id: 't1', subject: SUBJECT, opened_id: 4, row: emails[3]!, emails, draft: null, summary: null};
  await render(<Reader><ConversationStack conversation={conversation} accounts={new Map()} now={NOW} timeZone={SEED_TIME_ZONE} marks={[]} from={undefined} composer={null} onCard={vi.fn()} /></Reader>);
  const shape = () => [...document.querySelectorAll('.cv > [data-email]')].map(one => (one.classList.contains('cv-mail') ? 'E' : 'c')).join('');
  const history = () => document.querySelector('.cv-mail[data-email="1"] .quoted > button')?.getAttribute('aria-label');
  // The user opens email 3 themselves.
  await userEvent.click(page.getByRole('button', {name: /First words of 3/}));
  await expect.poll(shape).toBe('EcEE');

  selectSearch('email');
  await userEvent.keyboard('cooler');
  // The history's, email 2's and email 3's, in order: the first opens the history.
  await expect.poll(count).toBe('1 of 3');
  await expect.poll(history).toBe('Hide quoted text');
  // The current match is the history's own, now on screen.
  const inHistory = () => [...(CSS.highlights.get('setpoint-find-current') as Iterable<Range>)].map(range => !!range.startContainer.parentElement?.closest('.cv-mail[data-email="1"] .quoted'));
  expect(inHistory()).toEqual([true]);
  await userEvent.keyboard('{Enter}');
  await expect.poll(count).toBe('2 of 3');
  await expect.poll(shape).toBe('EEEE');
  await expect.poll(() => document.querySelector('.cv-mail[data-email="2"] .mailtext')?.textContent).toBe('I have a cooler.');

  await userEvent.keyboard('{Escape}');
  await expect.poll(shape).toBe('EcEE');
  expect(history()).toBe('Show quoted text');
});

test('in a conversation find skips a newer email\'s folded quote, the oldest\'s still counting, and one the user opens counts', async () => {
  const quote = (fresh: string, quoted: string) => `${fresh}\n\nOn Mon, Sep 29, 2026, Ana wrote:\n> ${quoted}`;
  const emails = [
    email(1, quote('Bring the cooler?', 'Is there a cooler at the cabin?'), true),
    email(2, quote('Got it.', 'Bring the cooler?'), false),
    email(3, quote('Fine by me.', 'Bring the cooler?'), true),
    email(4, 'I have a cooler.', true),
  ];
  const conversation: MailConversationOut = {account_id: 1, thread_id: 't1', subject: SUBJECT, opened_id: 4, row: emails[3]!, emails, draft: null, summary: null};
  await render(<Reader><ConversationStack conversation={conversation} accounts={new Map()} now={NOW} timeZone={SEED_TIME_ZONE} marks={[]} from={undefined} composer={null} onCard={vi.fn()} /></Reader>);
  selectSearch('email');
  await userEvent.keyboard('cooler');
  // Email 1's words and its quote, and email 4's: email 2's and 3's quotes repeat email 1.
  await expect.poll(count).toBe('1 of 3');
  // The user opens email 3's quote, and its words are on screen to count.
  await userEvent.click(document.querySelector<HTMLButtonElement>('.cv-mail[data-email="3"] .quoted > button')!);
  await expect.poll(count).toMatch(/ of 4$/);
});
