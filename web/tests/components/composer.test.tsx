// The composer in the reading pane: its recipients as chips (a comma, Enter or leaving makes an
// address one; Backspace takes the last back; a paste of several makes each one), suggestions while
// typing, Cc and Bcc on ⌘⇧B, the reply's quote folded behind "…" and trimmed in place, a failed
// send's words with Try again, and the draft saved as it's typed, once after a pause or at once on
// Esc. The server is faked at `fetch`: each test answers what the composer asks and reads what it
// saved. Send's toast and Undo are the browser journey's (browser/composer.spec.ts).
import type {AccountOut, DraftOut, FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache} from '../../src/api/client.ts';
import {ComposerSlot} from '../../src/app/compose/Composer.tsx';
import {closeComposer, DRAFT_SAVE_MS, startComposer, useOpenComposer} from '../../src/app/compose/composer.ts';

const SAM: Recipient = {name: 'Sam Lee', address: 'sam.lee@example.com'};
const JUNE: Recipient = {name: 'June Park', address: 'june.park@example.org'};
const RAVI: Recipient = {name: 'Ravi Menon', address: 'ravi.menon@example.org'};
const THEO: Recipient = {name: 'Theo Walsh', address: 'theo.walsh@example.org'};
const EMAIL = 21;

const FROM: FromOut = {accounts: [{account_id: 2, addresses: [{address: 'user@example.com', name: null, primary: true}]}], default_account_id: 2};
const ACCOUNTS = new Map<number, AccountOut>([[2, {id: 2, label: 'Personal', colour: 'cool', address: 'user@example.com', provider: 'gmail'} as AccountOut]]);
const MESSAGE = {
  id: EMAIL, account_id: 2, from_name: 'Sam Lee', from_address: SAM.address, subject: 'Dinner Friday?', received_at: '2026-10-05T19:40:00Z',
  body_text: 'Hey! Dinner Friday? Blue Door at 7?\n\nSam', body_html: null, to: [{name: 'User', address: 'user@example.com'}, JUNE], cc: [RAVI],
} as unknown as MessageOut;

let nextId = 1;
const draftOf = (fields: Partial<DraftOut>): DraftOut => ({
  id: nextId++, kind: 'reply', message_id: EMAIL, from: {account_id: 2, address: 'user@example.com'}, to: [SAM], cc: [], bcc: [],
  subject: 'Re: Dinner Friday?', body: [], quote: null, created_at: SEED_NOW, updated_at: SEED_NOW, send: null, ...fields,
});

/** The server, faked at fetch: the draft to start, From, people for any query, and the saves it got. */
function server(draft: DraftOut, people: Recipient[] = []) {
  const saves: Record<string, unknown>[] = [];
  const asked: string[] = [];
  const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}}));
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), location.href);
    const method = init?.method ?? 'GET';
    if (url.pathname === '/api/mail/drafts' && method === 'POST') return answer(draft, 201);
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'GET') return answer(draft);
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'PATCH') {
      saves.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return answer({id: draft.id, updated_at: SEED_NOW});
    }
    if (url.pathname === '/api/mail/from') return answer(FROM);
    if (url.pathname === '/api/mail/drafts') return answer({drafts: [], count: 0});
    if (url.pathname === '/api/mail/people') {
      asked.push(url.searchParams.get('q') ?? '');
      return answer({people});
    }
    return answer({error: {code: 'not_found', message: 'No such thing.'}}, 404);
  });
  return {saves, asked};
}

function Pane() {
  const open = useOpenComposer();
  return <div className="pane" style={{height: 700, width: 680}}><ComposerSlot open={open} messageId={EMAIL} message={MESSAGE} accounts={ACCOUNTS} timeZone={SEED_TIME_ZONE} /></div>;
}

/** Starts the draft as R or A does, and waits for the composer. */
async function compose(draft: DraftOut, people: Recipient[] = []) {
  const fake = server(draft, people);
  await render(<Pane />);
  startComposer({kind: draft.kind as 'reply', message_id: EMAIL});
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  return fake;
}

const chips = (field: string) => [...document.querySelectorAll(`.composer .cmp-row:has(input[aria-label="${field}"]) .cmp-chip`)].map(chip => chip.firstChild?.textContent);
const field = (name: string) => page.getByRole('textbox', {name, exact: true});

afterEach(() => {
  closeComposer();
  clearCache();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test('Reply all opens with its people as chips, Cc and Bcc shown because it has Cc, and the caret in the body', async () => {
  await compose(draftOf({kind: 'reply_all', to: [SAM, JUNE], cc: [RAVI]}));
  expect(chips('To')).toEqual(['Sam Lee', 'June Park']);
  expect(chips('Cc')).toEqual(['Ravi Menon']);
  await expect.element(field('Bcc')).toBeVisible();
  await expect.element(page.getByRole('textbox', {name: 'Subject'})).toHaveValue('Re: Dinner Friday?');
  await expect.element(page.getByRole('button', {name: /Personal/})).toHaveTextContent('Personaluser@example.com');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Message');
});

test('in To, a comma or Enter makes an address a chip, Backspace takes the last back, and a paste of several makes each one', async () => {
  const {saves} = await compose(draftOf({to: []}));
  // With no one to send to, the caret starts in To.
  expect(document.activeElement?.getAttribute('aria-label')).toBe('To');
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.keyboard('Ravi Menon <ravi.menon@example.org>{Enter}');
  expect(chips('To')).toEqual(['june.park@example.org', 'Ravi Menon']);
  await userEvent.keyboard('{Backspace}');
  expect(chips('To')).toEqual(['june.park@example.org']);
  await userEvent.click(field('To'));
  const pasted = new DataTransfer();
  pasted.setData('text/plain', 'Sam Lee <sam.lee@example.com>; theo.walsh@example.org, not one');
  document.querySelector('.composer input[aria-label="To"]')!.dispatchEvent(new ClipboardEvent('paste', {clipboardData: pasted, bubbles: true, cancelable: true}));
  await expect.poll(() => chips('To')).toEqual(['june.park@example.org', 'Sam Lee', 'theo.walsh@example.org']);
  await expect.element(field('To')).toHaveValue('not one');
  // Words that aren't an address stay as typed, marked, once the caret leaves.
  await userEvent.click(page.getByRole('textbox', {name: 'Subject'}));
  await expect.element(field('To')).toHaveClass('invalid');
  await expect.poll(() => saves.at(-1)?.to).toEqual([{name: null, address: 'june.park@example.org'}, SAM, {name: null, address: 'theo.walsh@example.org'}]);
});

test('typing asks for people from the user\'s mail; ↓ and Enter pick one, and one already there isn\'t offered', async () => {
  const {asked} = await compose(draftOf({to: [SAM]}), [SAM, THEO, JUNE]);
  await userEvent.click(field('To'));
  await userEvent.keyboard('t');
  const offered = page.getByRole('listbox', {name: 'Suggestions'});
  await expect.element(offered).toBeVisible();
  expect(asked.at(-1)).toBe('t');
  expect([...document.querySelectorAll('.cmp-people [role="option"]')].map(option => option.textContent)).toEqual(['Theo Walshtheo.walsh@example.org', 'June Parkjune.park@example.org']);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(chips('To')).toEqual(['Sam Lee', 'June Park']);
  await expect.element(field('To')).toHaveValue('');
});

test('⌘⇧B shows Cc and Bcc on a reply without them; left empty, they fold away when the caret leaves', async () => {
  await compose(draftOf({}));
  expect(document.querySelector('.composer input[aria-label="Cc"]')).toBeNull();
  await userEvent.keyboard('{Meta>}{Shift>}b{/Shift}{/Meta}');
  await expect.element(field('Cc')).toHaveFocus();
  await expect.element(field('Bcc')).toBeVisible();
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await expect.poll(() => document.querySelector('.composer input[aria-label="Cc"]')).toBeNull();
  // The button does it too, and a Cc kept keeps them.
  await userEvent.click(page.getByRole('button', {name: 'Cc Bcc'}));
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  expect(chips('Cc')).toEqual(['june.park@example.org']);
  await expect.element(field('Bcc')).toBeVisible();
});

test('the quote folds behind "…"; opened, it shows its line and the email, and a trim is saved as the quote', async () => {
  const {saves} = await compose(draftOf({}));
  expect(document.querySelector('.cmp-quote-text')).toBeNull();
  await userEvent.click(page.getByRole('button', {name: 'Show the quoted email'}));
  await expect.element(page.getByText('On Oct 5, 2026, Sam Lee wrote:')).toBeVisible();
  const quote = page.getByRole('textbox', {name: 'Quoted email'});
  await expect.element(quote).toHaveTextContent('Hey! Dinner Friday? Blue Door at 7?Sam');
  // Trimmed to its last paragraph.
  const element = document.querySelector<HTMLElement>('.cmp-quote-text')!;
  element.firstElementChild!.remove();
  element.dispatchEvent(new InputEvent('input', {bubbles: true}));
  await expect.poll(() => saves.at(-1)?.quote, {timeout: DRAFT_SAVE_MS * 4}).toEqual([{type: 'paragraph', runs: [{text: 'Sam', marks: [], href: null}]}]);
  await userEvent.click(page.getByRole('button', {name: 'Hide the quoted email'}));
  expect(document.querySelector('.cmp-quote-text')).toBeNull();
});

test('the draft saves once a moment after the last letter, with the text as it then is; Esc closes it and saves at once', async () => {
  const {saves} = await compose(draftOf({}));
  await userEvent.keyboard('Count me in');
  await expect.poll(() => saves.length, {timeout: DRAFT_SAVE_MS * 4}).toBe(1);
  expect(saves[0]).toEqual({body: [{type: 'paragraph', runs: [{text: 'Count me in', marks: [], href: null}]}]});
  await userEvent.keyboard('.');
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1]).toEqual({body: [{type: 'paragraph', runs: [{text: 'Count me in.', marks: [], href: null}]}]});
});

test('a send the provider refused shows its words with Try again', async () => {
  await compose(draftOf({to: [{name: null, address: 'nobody@refused.example'}], send: {state: 'failed', send_at: null, error: '550 5.1.1 Recipient address rejected'}}));
  await expect.element(page.getByText('550 5.1.1 Recipient address rejected')).toBeVisible();
  await expect.element(page.getByRole('button', {name: 'Try again'})).toBeVisible();
});
