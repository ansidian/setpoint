// The composer in the reading pane: its recipients as chips (a comma, Enter or leaving makes an
// address one; Backspace takes the last back; a paste of several makes each one), suggestions while
// typing, Cc and Bcc on ⌘⇧B, the reply's quote folded behind "…" and trimmed in place, a forward's
// email in full with its attachments to take off, a failed
// send's words with Try again, the draft saved as it's typed, once after a pause or at once on
// Esc, and the reply-type menu. Popped out into a window and docked back, it is one composer: what's
// typed, a recipient, the open fold and the caret carry across, and the window's title folds it.
// The server is faked at `fetch`: each test answers what the composer asks and reads what it
// saved. Send's toast and Undo, and a window over other pages, are the browser journeys'
// (browser/composer.spec.ts).
import type {AccountOut, DraftOut, FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {SEED_NOW} from '@setpoint/shared';
import {afterEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache} from '../../src/api/client.ts';
import {ComposerRoot, ComposerSlot, ComposerWindows} from '../../src/app/compose/Composer.tsx';
import {closeComposer, DRAFT_SAVE_MS, openComposers, startComposer, useComposers, useOpenComposer} from '../../src/app/compose/composer.ts';

const SAM: Recipient = {name: 'Sam Lee', address: 'sam.lee@example.com'};
const JUNE: Recipient = {name: 'June Park', address: 'june.park@example.org'};
const RAVI: Recipient = {name: 'Ravi Menon', address: 'ravi.menon@example.org'};
const THEO: Recipient = {name: 'Theo Walsh', address: 'theo.walsh@example.org'};
const EMAIL = 21;

const FROM: FromOut = {accounts: [{account_id: 2, addresses: [{address: 'user@example.com', name: null, primary: true}]}], default_account_id: 2};
const ACCOUNTS = [{id: 2, label: 'Personal', colour: 'cool', address: 'user@example.com', provider: 'gmail', position: 0} as AccountOut];
const MESSAGE = {
  id: EMAIL, account_id: 2, from_name: 'Sam Lee', from_address: SAM.address, subject: 'Dinner Friday?', received_at: '2026-10-05T19:40:00Z',
  body_text: 'Hey! Dinner Friday? Blue Door at 7?\n\nSam', body_html: null, to: [{name: 'User', address: 'user@example.com'}, JUNE], cc: [RAVI],
  attachments: [], remote_content: {domain: 'example.com', trust_domain: 'example.com', sender_authenticated: true, trusted: false, load: false, reason: 'not_trusted'},
} as unknown as MessageOut;

let nextId = 1;
const draftOf = (fields: Partial<DraftOut>): DraftOut => ({
  id: nextId++, kind: 'reply', message_id: EMAIL, from: {account_id: 2, address: 'user@example.com'}, to: [SAM], cc: [], bcc: [],
  subject: 'Re: Dinner Friday?', body: [], quote: null, removed_attachments: [], created_at: SEED_NOW, updated_at: SEED_NOW, send: null, ...fields,
});

/**
 * The server, faked at fetch: the draft to start (and `others`, started by their kind), From, the
 * accounts, the email, people for any query, and the saves it got. `failSaves` refuses that many
 * saves next (they're still in `saves`, not in `landed`), `sends` counts Send and `discarded` the
 * drafts deleted.
 */
function server(draft: DraftOut, people: Recipient[] = [], message: MessageOut = MESSAGE, others: DraftOut[] = []) {
  const saves: Record<string, unknown>[] = [];
  const landed: Record<string, unknown>[] = [];
  const asked: string[] = [];
  const discarded: number[] = [];
  const fake = {saves, landed, asked, discarded, failSaves: 0, sends: 0};
  const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}}));
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), location.href);
    const method = init?.method ?? 'GET';
    const other = others.find(one => url.pathname === `/api/mail/drafts/${one.id}`);
    if (url.pathname === '/api/mail/drafts' && method === 'POST') {
      const kind = (JSON.parse(String(init?.body)) as {kind: string}).kind;
      return answer(others.find(one => one.kind === kind && kind !== draft.kind) ?? draft, 201);
    }
    if (other && method === 'GET') return answer(other);
    if (other && method === 'PATCH') {
      saves.push({draft: other.id, ...JSON.parse(String(init?.body)) as Record<string, unknown>});
      return answer({id: other.id, updated_at: SEED_NOW});
    }
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'DELETE') {
      discarded.push(draft.id);
      return Promise.resolve(new Response(null, {status: 204}));
    }
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'GET') return answer(draft);
    if (url.pathname === `/api/mail/drafts/${draft.id}` && method === 'PATCH') {
      const saved = JSON.parse(String(init?.body)) as Record<string, unknown>;
      saves.push(saved);
      if (fake.failSaves > 0) {
        fake.failSaves -= 1;
        return answer({error: {code: 'unavailable', message: 'Setpoint is restarting.'}}, 503);
      }
      landed.push(saved);
      return answer({id: draft.id, updated_at: SEED_NOW});
    }
    if (url.pathname === `/api/mail/drafts/${draft.id}/send` && method === 'POST') {
      fake.sends += 1;
      return answer({...draft, send: {state: 'held', send_at: SEED_NOW, error: null}});
    }
    if (url.pathname === '/api/mail/from') return answer(FROM);
    if (url.pathname === '/api/accounts') return answer(ACCOUNTS);
    if (url.pathname === `/api/mail/messages/${EMAIL}`) return answer(message);
    if (url.pathname === '/api/mail/drafts') return answer({drafts: [], count: 0});
    if (url.pathname === '/api/mail/people') {
      asked.push(url.searchParams.get('q') ?? '');
      return answer({people});
    }
    return answer({error: {code: 'not_found', message: 'No such thing.'}}, 404);
  });
  return fake;
}

/** The reading pane on the email, the windows' row beside it, and the composers mounted once, as the app has them. */
function Pane() {
  const open = useOpenComposer();
  useComposers();
  return (
    <div style={{position: 'relative', height: 760, width: 1300, display: 'flex'}}>
      <div className="pane" style={{height: 700, width: 680}}><ComposerSlot open={open} messageId={EMAIL} /></div>
      <ComposerWindows />
      <ComposerRoot />
    </div>
  );
}

/** Starts the draft as R, A or F does, and waits for the composer. */
async function compose(draft: DraftOut, people: Recipient[] = [], message = MESSAGE, others: DraftOut[] = []) {
  const fake = server(draft, people, message, others);
  await render(<Pane />);
  startComposer({kind: draft.kind as 'reply', message_id: EMAIL});
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  return fake;
}

const chips = (field: string) => [...document.querySelectorAll(`.composer .cmp-row:has(input[aria-label="${field}"]) .cmp-chip`)].map(chip => chip.firstChild?.textContent);
const field = (name: string) => page.getByRole('textbox', {name, exact: true});

/**
 * Holds the save's timer, so a check never waits out DRAFT_SAVE_MS on the real clock, nor saves
 * half of what's typed when a letter comes late. `saveNow` is the moment after the last change.
 */
const holdSaves = () => vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
const saveNow = () => vi.advanceTimersByTime(DRAFT_SAVE_MS);

afterEach(() => {
  vi.useRealTimers();
  for (const one of openComposers()) closeComposer(one.draftId);
  clearCache();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test('Reply all opens with its people as chips, Cc and Bcc shown because it has Cc, and the caret in the body', async () => {
  await compose(draftOf({kind: 'reply_all', to: [SAM, JUNE], cc: [RAVI]}));
  expect(chips('To')).toEqual(['Sam Lee', 'June Park']);
  expect(chips('Cc')).toEqual(['Ravi Menon']);
  await expect.element(field('Bcc')).toBeVisible();
  // A reply's subject is the server's: no field for it.
  expect(document.querySelector('.composer input[aria-label="Subject"]')).toBeNull();
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
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
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
  await expect.element(field('Cc')).toHaveFocus();
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  expect(chips('Cc')).toEqual(['june.park@example.org']);
  await expect.element(field('Bcc')).toBeVisible();
});

test('the quote folds behind "…"; opened, it shows its line and the email, and a trim is saved as the quote', async () => {
  const {saves} = await compose(draftOf({}));
  holdSaves();
  expect(document.querySelector('.cmp-quote-text')).toBeNull();
  await userEvent.click(page.getByRole('button', {name: 'Show the quoted email'}));
  await expect.element(page.getByText('On Oct 5, 2026, Sam Lee wrote:')).toBeVisible();
  const quote = page.getByRole('textbox', {name: 'Quoted email'});
  await expect.element(quote).toHaveTextContent('Hey! Dinner Friday? Blue Door at 7?Sam');
  // Trimmed to its last paragraph.
  const element = document.querySelector<HTMLElement>('.cmp-quote-text')!;
  element.firstElementChild!.remove();
  element.dispatchEvent(new InputEvent('input', {bubbles: true}));
  saveNow();
  await expect.poll(() => saves.at(-1)?.quote).toEqual([{type: 'paragraph', runs: [{text: 'Sam', marks: [], href: null}]}]);
  await userEvent.click(page.getByRole('button', {name: 'Hide the quoted email'}));
  expect(document.querySelector('.cmp-quote-text')).toBeNull();
});

test('the draft saves once a moment after the last letter, with the text as it then is; Esc closes it and saves at once', async () => {
  const {saves} = await compose(draftOf({}));
  holdSaves();
  await userEvent.keyboard('Count me in');
  // Not before the moment is up.
  vi.advanceTimersByTime(DRAFT_SAVE_MS - 1);
  expect(saves).toEqual([]);
  vi.advanceTimersByTime(1);
  await expect.poll(() => saves.length).toBe(1);
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

test('a forward shows its email in full: its header lines, its attachments as chips that × takes off, and its words', async () => {
  const message = {...MESSAGE, attachments: [
    {id: 31, filename: 'Menu.pdf', mime_type: 'application/pdf', size_bytes: 184 * 1024, previewable: true},
    {id: 32, filename: 'Map.png', mime_type: 'image/png', size_bytes: 12 * 1024, previewable: true},
  ]} as MessageOut;
  const {saves} = await compose(draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'}), [], message);
  holdSaves();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('To');
  await expect.element(page.getByText('---------- Forwarded message ---------')).toBeVisible();
  await expect.element(page.getByText('From: Sam Lee <sam.lee@example.com>')).toBeVisible();
  expect(document.querySelector('.cmp-forward .mailtext')?.textContent).toBe('Hey! Dinner Friday? Blue Door at 7?Sam');
  expect([...document.querySelectorAll('.cmp-file')].map(file => file.textContent)).toEqual(['Menu.pdf184 KB', 'Map.png12 KB']);
  // Nothing folds it.
  expect(document.querySelector('.cmp-fold')).toBeNull();
  await userEvent.click(page.getByRole('button', {name: 'Remove Map.png'}));
  expect([...document.querySelectorAll('.cmp-file')].map(file => file.textContent)).toEqual(['Menu.pdf184 KB']);
  saveNow();
  await expect.poll(() => saves.at(-1)?.removed_attachments).toEqual([32]);
});

test('a change whose save failed stays owed: it goes out again with the next save, the failure said until it lands', async () => {
  const fake = await compose(draftOf({kind: 'reply_all', to: [SAM, JUNE]}));
  fake.failSaves = 1;
  holdSaves();
  await userEvent.click(page.getByRole('button', {name: 'Remove June Park'}));
  saveNow();
  await expect.element(page.getByText(/^Couldn't save the draft, Setpoint is restarting/)).toBeVisible();
  expect(fake.landed).toEqual([]);
  // The next save carries it, under what was typed since.
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('Hi');
  saveNow();
  await expect.poll(() => fake.landed.length).toBe(1);
  expect(fake.landed[0]).toEqual({to: [SAM], body: [{type: 'paragraph', runs: [{text: 'Hi', marks: [], href: null}]}]});
  await expect.poll(() => document.querySelector('.composer .cmp-failed')).toBeNull();
});

test('Send never sends while a change is owed and its save fails again: the composer stays with the failure', async () => {
  const fake = await compose(draftOf({kind: 'reply_all', to: [SAM, JUNE]}));
  fake.failSaves = 2;
  holdSaves();
  await userEvent.click(page.getByRole('button', {name: 'Remove June Park'}));
  saveNow();
  await expect.element(page.getByText(/^Couldn't save the draft/)).toBeVisible();
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  // Its second try was refused too: nothing was sent, and the composer is back with what the user had.
  await expect.poll(() => fake.saves.length).toBe(2);
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toBeVisible();
  expect(fake.sends).toBe(0);
  expect(chips('To')).toEqual(['Sam Lee']);
  expect(fake.saves[1]).toEqual({to: [SAM]});
});

const inWindow = () => document.querySelector('.cmp-window .composer');
const inPane = () => document.querySelector('.pane .composer');

test('popped out and docked again, it is one composer: what\'s typed, a recipient, the open fold and the caret carry across', async () => {
  await compose(draftOf({}));
  await userEvent.keyboard('Count me in');
  await userEvent.click(page.getByRole('button', {name: 'Cc Bcc'}));
  await userEvent.keyboard('june.park@example.org,');
  await userEvent.click(page.getByRole('button', {name: 'Show the quoted email'}));
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{End}');

  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  await expect.poll(inWindow).not.toBeNull();
  expect(inPane()).toBeNull();
  const kept = () => [
    document.querySelector('.composer .desc-edit')?.textContent,
    chips('Cc'),
    document.querySelector('.cmp-quote-text')?.textContent,
    document.activeElement?.getAttribute('aria-label'),
  ];
  const before = ['Count me in', ['june.park@example.org'], 'Hey! Dinner Friday? Blue Door at 7?Sam', 'Message'];
  expect(kept()).toEqual(before);
  expect(document.querySelector('.cmp-window .cmp-title-text')?.textContent).toBe('Re: Dinner Friday?');
  // The caret stays where it was: typing goes on at the end.
  await userEvent.keyboard('.');

  await userEvent.click(page.getByRole('button', {name: 'Back in the reading pane'}));
  await expect.poll(inPane).not.toBeNull();
  expect(inWindow()).toBeNull();
  expect(kept()).toEqual(['Count me in.', ...before.slice(1)]);
});

test('the window\'s title folds it to its bar and brings it back; Esc in the window closes it, the draft saved', async () => {
  const {saves} = await compose(draftOf({}));
  await userEvent.keyboard('Count me in');
  await userEvent.click(page.getByRole('button', {name: 'Pop out'}));
  await expect.poll(inWindow).not.toBeNull();
  // Folded to its bar (the stylesheet, not loaded here, hides the rest).
  await userEvent.click(page.getByRole('button', {name: 'Minimize the window'}));
  await expect.poll(() => document.querySelector('.cmp-window')?.classList.contains('min')).toBe(true);
  await userEvent.click(page.getByRole('button', {name: 'Open the window'}));
  await expect.poll(() => document.querySelector('.cmp-window')?.classList.contains('min')).toBe(false);
  await userEvent.click(page.getByRole('textbox', {name: 'Message'}));
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.composer')).toBeNull();
  await expect.poll(() => saves.at(-1)?.body).toEqual([{type: 'paragraph', runs: [{text: 'Count me in', marks: [], href: null}]}]);
});

test('the reply-type menu\'s Edit subject turns a reply into a forward that keeps its recipients and words, its subject a field, the menu gone, the caret in the body', async () => {
  const reply = draftOf({});
  const forward = draftOf({kind: 'forward', to: [], subject: 'Fwd: Dinner Friday?'});
  const {saves, discarded} = await compose(reply, [], MESSAGE, [forward]);
  await userEvent.keyboard('Count me in');
  await userEvent.click(page.getByRole('button', {name: 'Reply, change'}));
  await userEvent.click(page.getByRole('menuitem', {name: 'Edit subject'}));
  await expect.element(page.getByRole('textbox', {name: 'Subject'})).toHaveValue('Fwd: Dinner Friday?');
  await expect.element(page.getByRole('textbox', {name: 'Message'})).toHaveFocus();
  expect(document.querySelector('.cmp-type')).toBeNull();
  expect(chips('To')).toEqual(['Sam Lee']);
  expect(document.querySelector('.composer .desc-edit')?.textContent).toBe('Count me in');
  expect(saves.find(one => one.draft === forward.id)).toMatchObject({to: [SAM], body: [{type: 'paragraph', runs: [{text: 'Count me in', marks: [], href: null}]}]});
  await expect.poll(() => discarded).toEqual([reply.id]);
});
