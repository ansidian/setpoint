// Help me write in the composer. ⌘J or the format row's button opens the line, and Enter asks with
// the body as it is. The line works, says so and takes no second ask. The answer goes into the body,
// and the line stays open. With text selected, only the selection changes. Undo and redo step
// between the versions. A failure says why and leaves the body. Esc closes the line before the
// composer. The line and versions are saved with the draft and come back with it. An answer for a
// composer closed meanwhile is saved into its draft, or taken by the composer opened again.
// The server is faked at `fetch`, and each ask's answer is held until the test lets it go, so the
// working state is read for as long as it needs.
import type {AccountOut, DraftOut, FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {SEED_NOW} from '@setpoint/shared';
import {afterEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache} from '../../src/api/client.ts';
import {ComposerRoot, ComposerSlot} from '../../src/app/compose/Composer.tsx';
import {closeComposer, DRAFT_SAVE_MS, flushSave, openComposers, startComposer, useOpenComposer, writingOf} from '../../src/app/compose/composer.ts';

const EMAIL = 21;
const SAM: Recipient = {name: 'Sam Lee', address: 'sam.lee@example.com'};
const FROM: FromOut = {accounts: [{account_id: 2, addresses: [{address: 'user@example.com', name: null, primary: true}]}], default_account_id: 2};
const ACCOUNTS = [{id: 2, label: 'Personal', colour: 'cool', address: 'user@example.com', provider: 'gmail', position: 0} as AccountOut];
const MESSAGE = {
  id: EMAIL, account_id: 2, from_name: 'Sam Lee', from_address: SAM.address, subject: 'Dinner Friday?', received_at: '2026-10-05T19:40:00Z',
  body_text: 'Hey! Dinner Friday? Blue Door at 7?\n\nSam', body_html: null, to: [{name: 'User', address: 'user@example.com'}], cc: [],
  attachments: [], remote_content: {domain: 'example.com', trust_domain: 'example.com', sender_authenticated: true, trusted: false, load: false, reason: 'not_trusted'},
} as unknown as MessageOut;

/** Lines of plain text as the body's blocks ('' is a blank line). */
const blocks = (...lines: string[]) => lines.map(text => ({type: 'paragraph' as const, runs: text ? [{text, marks: [] as never[], href: null}] : []}));

let nextId = 100;
const draftOf = (fields: Partial<DraftOut> = {}): DraftOut => ({
  id: nextId++, kind: 'reply', message_id: EMAIL, from: {account_id: 2, address: 'user@example.com'}, to: [SAM], cc: [], bcc: [],
  subject: 'Re: Dinner Friday?', body: [], quote: null, removed_attachments: [], write: null, created_at: SEED_NOW, updated_at: SEED_NOW, send: null, ...fields,
});

/**
 * The server, faked at fetch, keeping the draft's saves. Each ask (`asks`) waits until `answer` lets it go with the blocks
 * written, or `refuse` with the server's words. `saves` are the draft's saves. Send waits until `held`.
 */
function server(draft: DraftOut) {
  const saves: Record<string, unknown>[] = [];
  const asks: Record<string, unknown>[] = [];
  const waiting: ((response: Response) => void)[] = [];
  const sends: ((response: Response) => void)[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input), location.href);
    const method = init?.method ?? 'GET';
    const path = `/api/mail/drafts/${draft.id}`;
    if (url.pathname === '/api/mail/drafts' && method === 'POST') return Promise.resolve(json(draft, 201));
    if (url.pathname === path && method === 'GET') return Promise.resolve(json(draft));
    if (url.pathname === path && method === 'PATCH') {
      const saved = JSON.parse(String(init?.body)) as Record<string, unknown>;
      saves.push(saved);
      // Kept, as the server keeps it: starting the draft again answers it as saved.
      Object.assign(draft, saved);
      return Promise.resolve(json({id: draft.id, updated_at: SEED_NOW}));
    }
    if (url.pathname === `${path}/write` && method === 'POST') {
      asks.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Promise(resolve => waiting.push(resolve));
    }
    if (url.pathname === `${path}/send` && method === 'POST') return new Promise(resolve => sends.push(resolve));
    if (url.pathname === '/api/mail/from') return Promise.resolve(json(FROM));
    if (url.pathname === '/api/accounts') return Promise.resolve(json(ACCOUNTS));
    if (url.pathname === `/api/mail/messages/${EMAIL}`) return Promise.resolve(json(MESSAGE));
    if (url.pathname === '/api/mail/drafts') return Promise.resolve(json({drafts: [], count: 0}));
    return Promise.resolve(json({error: {code: 'not_found', message: 'No such thing.'}}, 404));
  });
  return {
    saves, asks, sends,
    // Send's hold answered, the draft now held.
    held: () => sends.shift()!(json({...draft, send: {state: 'held', send_at: SEED_NOW, error: null}})),
    answer: (written: ReturnType<typeof blocks>) => waiting.shift()!(json({blocks: written})),
    refuse: (message: string) => waiting.shift()!(json({error: {code: 'draft_write_failed', message}}, 502)),
  };
}

function Pane() {
  const open = useOpenComposer();
  return (
    <div style={{position: 'relative', height: 760, width: 900}}>
      <div className="pane" style={{height: 700, width: 680}}><ComposerSlot open={open} messageId={EMAIL} /></div>
      <ComposerRoot />
    </div>
  );
}

async function compose(draft: DraftOut) {
  const fake = server(draft);
  await render(<Pane />);
  startComposer({kind: 'reply', message_id: EMAIL});
  await expect.element(body()).toBeVisible();
  return fake;
}

const body = () => page.getByRole('textbox', {name: 'Message'});
const line = () => page.getByRole('textbox', {name: 'Help me write'});
const lines = () => [...document.querySelector('.composer .desc-edit')!.children].map(child => child.textContent);
/** Holds the save's timer, so a save is read the moment after the last change (`saveNow`). */
const holdSaves = () => vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
const saveNow = () => vi.advanceTimersByTime(DRAFT_SAVE_MS);

afterEach(() => {
  vi.useRealTimers();
  for (const one of openComposers()) closeComposer(one.draftId);
  clearCache();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test('⌘J opens the line over an empty body; Enter asks with the body, the line works and takes no second ask, and the answer goes in', async () => {
  const fake = await compose(draftOf());
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await expect.element(line()).toHaveFocus();
  await expect.element(line()).toHaveAttribute('placeholder', 'Describe your message');
  await userEvent.keyboard('say 7 works');
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('group', {name: 'Help me write'})).toHaveAttribute('aria-busy', 'true');
  await expect.element(page.getByText('Writing…')).toBeVisible();
  await userEvent.keyboard('{Enter}');
  expect(fake.asks).toEqual([{prompt: 'say 7 works', body: [], selection: null}]);

  holdSaves();
  fake.answer(blocks('Hi Sam,', '', '7 works.'));
  await expect.poll(lines).toEqual(['Hi Sam,', '', '7 works.']);
  // The line stays, to refine; it now asks what to change.
  await expect.element(line()).toHaveValue('say 7 works');
  await expect.element(line()).toHaveAttribute('placeholder', 'Describe your change');
  await expect.element(page.getByRole('button', {name: 'Undo'})).toBeEnabled();
  await expect.element(page.getByRole('button', {name: 'Redo'})).toBeDisabled();
  saveNow();
  await expect.poll(() => fake.saves.at(-1)).toMatchObject({
    body: blocks('Hi Sam,', '', '7 works.'),
    write: {prompt: 'say 7 works', open: true, versions: [[], blocks('Hi Sam,', '', '7 works.')], at: 1},
  });
});

test('with text selected, only the selection is asked about and changed', async () => {
  const fake = await compose(draftOf({body: blocks('Hi Sam,', 'See you at 7.', 'Alex')}));
  const middle = document.querySelector('.composer .desc-edit')!.children[1]!;
  const range = document.createRange();
  range.selectNodeContents(middle);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await expect.element(line()).toHaveFocus();
  await userEvent.keyboard('warmer{Enter}');
  await expect.poll(() => fake.asks).toEqual([{prompt: 'warmer', body: blocks('Hi Sam,', 'See you at 7.', 'Alex'), selection: 'See you at 7.'}]);
  fake.answer(blocks('Can\'t wait, see you at 7!'));
  await expect.poll(lines).toEqual(['Hi Sam,', 'Can\'t wait, see you at 7!', 'Alex']);
});

/** Selects the body's line `index` (from 0), as the user would by dragging over it. */
function selectLine(index: number) {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('.composer .desc-edit')!.children[index]!);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
}

test('the answer goes to the selection it was asked about, not one made while it works', async () => {
  const fake = await compose(draftOf({body: blocks('Hi Sam,', 'See you at 7.', 'Alex')}));
  selectLine(1);
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await expect.element(line()).toHaveFocus();
  await userEvent.keyboard('warmer{Enter}');
  await expect.poll(() => fake.asks.length).toBe(1);
  selectLine(2);
  await expect.poll(() => document.getSelection()!.toString()).toBe('Alex');
  fake.answer(blocks('Can\'t wait!'));
  await expect.poll(lines).toEqual(['Hi Sam,', 'Can\'t wait!', 'Alex']);
});

test('a selection the body was replaced under is no selection: the next ask is about the whole body', async () => {
  const fake = await compose(draftOf({body: blocks('Hi Sam,', 'See you at 7.'), write: {prompt: '', open: true, versions: [blocks('Draft me'), blocks('Hi Sam,', 'See you at 7.')], at: 1}}));
  selectLine(1);
  await expect.poll(() => document.getSelection()!.toString()).toBe('See you at 7.');
  await userEvent.click(page.getByRole('button', {name: 'Undo'}));
  expect(lines()).toEqual(['Draft me']);
  await userEvent.fill(line(), 'warmer');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => fake.asks).toEqual([{prompt: 'warmer', body: blocks('Draft me'), selection: null}]);
});

test('a whole draft answered after Send is pressed is not saved into the draft going out', async () => {
  const draft = draftOf({body: blocks('Draft me')});
  const fake = await compose(draft);
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await userEvent.keyboard('shorter{Enter}');
  await expect.poll(() => fake.asks.length).toBe(1);
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  await expect.poll(() => fake.sends.length).toBe(1);
  expect(openComposers()).toEqual([]);
  holdSaves();
  fake.answer(blocks('Short.'));
  // The answer is in once the ask stops working.
  await expect.poll(() => writingOf(draft.id).working).toBe(false);
  saveNow();
  // Every save the draft had queued has gone once its chain of saves is through.
  await flushSave(draft.id);
  expect(fake.saves.filter(save => 'body' in save)).toEqual([]);
  fake.held();
});

test('undo and redo step between the body before the draft and after it', async () => {
  const fake = await compose(draftOf({body: blocks('Draft me')}));
  await userEvent.click(page.getByRole('button', {name: 'Help me write'}));
  await userEvent.fill(line(), 'shorter');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => fake.asks.length).toBe(1);
  fake.answer(blocks('Short.'));
  await expect.poll(lines).toEqual(['Short.']);
  holdSaves();
  await userEvent.click(page.getByRole('button', {name: 'Undo'}));
  expect(lines()).toEqual(['Draft me']);
  await expect.element(page.getByRole('button', {name: 'Undo'})).toBeDisabled();
  saveNow();
  await expect.poll(() => fake.saves.at(-1)).toMatchObject({body: blocks('Draft me'), write: {at: 0}});
  await userEvent.click(page.getByRole('button', {name: 'Redo'}));
  expect(lines()).toEqual(['Short.']);
  await expect.element(page.getByRole('button', {name: 'Redo'})).toBeDisabled();
});

test('a failure says why under the line and leaves the body; typing a new ask clears it', async () => {
  const fake = await compose(draftOf({body: blocks('Keep me')}));
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await userEvent.keyboard('rewrite{Enter}');
  await expect.poll(() => fake.asks.length).toBe(1);
  fake.refuse('Anthropic: Overloaded (529)');
  await expect.element(page.getByRole('alert')).toHaveTextContent('Couldn\'t write it, Anthropic: Overloaded (529)');
  expect(lines()).toEqual(['Keep me']);
  await expect.element(page.getByRole('button', {name: 'Undo'})).toBeDisabled();
  await userEvent.keyboard('!');
  await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
});

test('Esc closes the line first, the caret back in the body; Esc again closes the composer', async () => {
  await compose(draftOf());
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await expect.element(line()).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  await expect.element(line()).not.toBeInTheDocument();
  await expect.element(body()).toHaveFocus();
  expect(openComposers()).toHaveLength(1);
  await userEvent.keyboard('{Escape}');
  expect(openComposers()).toEqual([]);
});

test('a draft saved with its line open opens with the line, its ask and its versions', async () => {
  await compose(draftOf({body: blocks('Short.'), write: {prompt: 'shorter', open: true, versions: [blocks('Draft me'), blocks('Short.')], at: 1}}));
  await expect.element(line()).toHaveValue('shorter');
  await userEvent.click(page.getByRole('button', {name: 'Undo'}));
  expect(lines()).toEqual(['Draft me']);
});

test('an answer for a composer closed meanwhile is saved into the draft, with a version to undo to', async () => {
  const fake = await compose(draftOf({body: blocks('Draft me')}));
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await userEvent.keyboard('shorter{Enter}');
  await expect.poll(() => fake.asks.length).toBe(1);
  closeComposer();
  holdSaves();
  fake.answer(blocks('Short.'));
  await expect.poll(() => vi.getTimerCount()).toBeGreaterThan(0);
  saveNow();
  await expect.poll(() => fake.saves.at(-1)).toMatchObject({body: blocks('Short.'), write: {versions: [blocks('Draft me'), blocks('Short.')], at: 1}});
});

test('a composer opened again while the line works shows it working and takes the answer', async () => {
  const fake = await compose(draftOf({body: blocks('Draft me')}));
  await userEvent.keyboard('{Meta>}j{/Meta}');
  await userEvent.keyboard('shorter{Enter}');
  await expect.poll(() => fake.asks.length).toBe(1);
  closeComposer();
  // Closing saved the open line; opened again once that has landed.
  await expect.poll(() => fake.saves.at(-1)?.write).toMatchObject({open: true});
  startComposer({kind: 'reply', message_id: EMAIL});
  await expect.element(page.getByText('Writing…')).toBeVisible();
  fake.answer(blocks('Short.'));
  await expect.poll(lines).toEqual(['Short.']);
});
