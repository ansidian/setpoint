// Alfred's thread in its store (search/alfred.ts): inline where it was asked while that place is on
// screen, in Alfred's window otherwise, the same turns either way. A new question replaces the open
// thread, and an answer to a thread since closed or replaced is dropped. The server is faked at
// fetch, each answer held until the check lets it go.
import type {AnswerOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache} from '../../src/api/client.ts';
import {AlfredWindow} from '../../src/app/search/AlfredWindow.tsx';
import {AnswerCard} from '../../src/app/search/AnswerCard.tsx';
import {alfredOf, alfredThread, askAlfred, closeAlfred, ENDED_LINE, resetAlfred, restoreAlfred, startAlfred, useAlfredThread, useClaim} from '../../src/app/search/alfred.ts';
import {dismissToast} from '../../src/app/toast.ts';
import {ToastPill} from '../../src/app/ToastPill.tsx';
import type {AlfredOrigin} from '../../src/app/search/alfred.ts';

const SEARCH: AlfredOrigin = {kind: 'search'};

const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});

const HOURS_4 = 4 * 60 * 60_000;

// Each question sent, and its answer (or the server's refusal), held until the check lets it go.
let asked: {question: string; conversation: number | null; answer: (text: string) => void; refuse: (code: string) => void}[] = [];
let turnIds = 0;
// The conversation's read after a reload, held until the check answers it.
let read: (status: number, body: unknown) => void = () => {};

beforeEach(() => {
  asked = [];
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.pathname.endsWith('/alfred/ask')) {
      const body = JSON.parse(String(init?.body)) as {question: string; conversation_id?: number};
      // The thread ends four idle hours after the question, as the server answers.
      const endsAt = new Date(Date.now() + HOURS_4).toISOString();
      return new Promise<Response>(resolve => asked.push({
        question: body.question, conversation: body.conversation_id ?? null,
        answer: text => resolve(json({conversation_id: 5, turn_id: ++turnIds, ends_at: endsAt, question: body.question, answer: text, emphasis: [], sources: [], items: [], applications: [], searched: [], proposals: []} satisfies AnswerOut)),
        refuse: code => resolve(new Response(JSON.stringify({error: {code, message: 'This conversation has ended; ask again to start a new one.'}}), {status: 410, headers: {'content-type': 'application/json'}})),
      }));
    }
    if (url.pathname.includes('/alfred/asks/')) return json({step: null});
    if (url.pathname.includes('/alfred/conversations/')) return new Promise<Response>(resolve => {
      read = (status, body) => resolve(new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}}));
    });
    if (url.pathname.endsWith('/accounts')) return json([]);
    return json({keys: {anthropic: true}});
  });
});
afterEach(() => {
  vi.useRealTimers();
  resetAlfred();
  dismissToast();
  clearCache();
  vi.restoreAllMocks();
});

/** Where a thread from search shows inline: it claims the thread while it's mounted. */
function Place() {
  const thread = useAlfredThread();
  useClaim(SEARCH);
  return (
    <section aria-label="Search">
      {thread?.origin.kind === 'search' && <AnswerCard alfred={alfredOf(thread)} scoped={false} openId={null} accounts={new Map()} now={Date.parse(SEED_NOW)} timeZone={SEED_TIME_ZONE} onOpen={() => {}} />}
    </section>
  );
}

function Shell({place}: {place: boolean}) {
  return (
    <div className="app" style={{position: 'relative', width: 1200, height: 800}}>
      <main className="main" style={{position: 'relative', height: 800}}>
        {place && <Place />}
        <AlfredWindow />
        <ToastPill />
      </main>
    </div>
  );
}

const inline = () => page.getByRole('region', {name: 'Search'}).getByLabelText('Alfred\'s answer');
const windowed = () => page.getByRole('region', {name: 'Alfred\'s window'});

test('a thread asked inline moves to the window when its place goes, with the same turns, and back when it returns', async () => {
  const screen = await render(<Shell place />);
  startAlfred(SEARCH, 'When is dinner?');
  await expect.poll(() => asked.length).toBe(1);
  asked[0]!.answer('Friday at 7.');
  await expect.element(inline().getByText('Friday at 7.')).toBeVisible();
  await expect.element(windowed()).not.toBeInTheDocument();

  await screen.rerender(<Shell place={false} />);
  await expect.element(windowed().getByText('Friday at 7.')).toBeVisible();
  // A follow-up there continues the conversation.
  await userEvent.type(windowed().getByLabelText('Ask a follow-up'), 'Where?{Enter}');
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toMatchObject({question: 'Where?', conversation: 5});
  asked[1]!.answer('Blue Door.');
  await expect.element(windowed().getByText('Blue Door.')).toBeVisible();

  await screen.rerender(<Shell place />);
  await expect.element(inline().getByText('Blue Door.')).toBeVisible();
  await expect.element(inline().getByText('Friday at 7.')).toBeVisible();
  await expect.element(windowed()).not.toBeInTheDocument();
});

test('the window\'s title folds it to its bar and back, and it opens unfolded each time it comes to the window', async () => {
  const screen = await render(<Shell place={false} />);
  startAlfred(SEARCH, 'When is dinner?');
  await expect.poll(() => asked.length).toBe(1);
  asked[0]!.answer('Friday at 7.');
  await expect.element(windowed().getByText('Friday at 7.')).toBeVisible();

  await userEvent.click(windowed().getByRole('button', {name: 'Minimize the window'}));
  await expect.element(windowed().getByRole('button', {name: 'Open the window'})).toHaveAttribute('aria-expanded', 'false');
  await expect.element(windowed().getByText('Friday at 7.')).not.toBeVisible();
  await expect.element(windowed().getByLabelText('Ask a follow-up')).not.toBeVisible();
  await userEvent.click(windowed().getByRole('button', {name: 'Open the window'}));
  await expect.element(windowed().getByText('Friday at 7.')).toBeVisible();

  // Shown inline meanwhile, it comes back to the window unfolded.
  await userEvent.click(windowed().getByRole('button', {name: 'Minimize the window'}));
  await screen.rerender(<Shell place />);
  await expect.element(inline().getByText('Friday at 7.')).toBeVisible();
  await screen.rerender(<Shell place={false} />);
  await expect.element(windowed().getByText('Friday at 7.')).toBeVisible();

  // So does a new thread after this one closes.
  await userEvent.click(windowed().getByRole('button', {name: 'Minimize the window'}));
  closeAlfred();
  await expect.element(windowed()).not.toBeInTheDocument();
  startAlfred(SEARCH, 'Where?');
  await expect.element(windowed().getByText('Where?')).toBeVisible();
  await expect.element(windowed().getByRole('button', {name: 'Minimize the window'})).toHaveAttribute('aria-expanded', 'true');
});

test('a question in flight when its place goes lands in the window', async () => {
  const screen = await render(<Shell place />);
  startAlfred(SEARCH, 'When is dinner?');
  await expect.poll(() => asked.length).toBe(1);
  await screen.rerender(<Shell place={false} />);
  await expect.element(windowed().getByText('When is dinner?')).toBeVisible();
  asked[0]!.answer('Friday at 7.');
  await expect.element(windowed().getByText('Friday at 7.')).toBeVisible();
});

test('a new question replaces the open thread, and the earlier one\'s late answer is dropped', async () => {
  await render(<Shell place />);
  startAlfred(SEARCH, 'First?');
  startAlfred(SEARCH, 'Second?');
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]!.conversation).toBeNull();
  asked[1]!.answer('The second.');
  await expect.element(inline().getByText('The second.')).toBeVisible();
  asked[0]!.answer('The first.');
  startAlfred(SEARCH, 'Third?');
  await expect.poll(() => asked.length).toBe(3);
  asked[2]!.answer('The third.');
  await expect.element(inline().getByText('The third.')).toBeVisible();
  expect(document.body.textContent).not.toContain('The first.');
  expect(document.body.textContent).not.toContain('The second.');
});

test('an answer arriving after × is dropped: it doesn\'t land in the next thread', async () => {
  await render(<Shell place={false} />);
  startAlfred(SEARCH, 'When is dinner?');
  await expect.element(windowed().getByText('When is dinner?')).toBeVisible();
  await expect.poll(() => asked.length).toBe(1);
  await userEvent.click(windowed().getByRole('button', {name: 'Close answer'}));
  await expect.element(windowed()).not.toBeInTheDocument();
  startAlfred(SEARCH);
  asked[0]!.answer('Friday at 7.');
  await userEvent.type(windowed().getByLabelText('Ask a follow-up'), 'Lunch?{Enter}');
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]!.conversation).toBeNull();
  asked[1]!.answer('Noon.');
  await expect.element(windowed().getByText('Noon.')).toBeVisible();
  expect(windowed().element().textContent).not.toContain('Friday at 7.');
});

test('a thread asked where its place is already on screen never shows in the window, not even for a frame', async () => {
  await render(<Shell place />);
  let seen = false;
  const watch = new MutationObserver(() => {
    seen ||= document.querySelector('.alf-window') !== null;
  });
  watch.observe(document.body, {childList: true, subtree: true});
  startAlfred(SEARCH, 'When is dinner?');
  await expect.poll(() => asked.length).toBe(1);
  asked[0]!.answer('Friday at 7.');
  await expect.element(inline().getByText('Friday at 7.')).toBeVisible();
  watch.disconnect();
  expect(seen).toBe(false);
});

// Under the held clock: a real turn of the event loop (a message, which the clock doesn't hold),
// until the fetch's answer has landed in the store.
const turn = () => new Promise<void>(resolve => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => resolve();
  channel.port2.postMessage(null);
});
async function landed(turns: number) {
  for (let tries = 0; tries < 100 && alfredThread()?.turns.length !== turns; tries++) await turn();
  expect(alfredThread()?.turns).toHaveLength(turns);
}

test('the thread closes itself when the server ends it, four idle hours after its last question; a follow-up moves that on', async () => {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
  vi.setSystemTime(Date.parse(SEED_NOW));
  startAlfred(SEARCH, 'When is dinner?');
  asked[0]!.answer('Friday at 7.');
  await landed(1);

  // An hour on, a follow-up: the thread now ends four hours after it.
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  askAlfred('Where?');
  asked[1]!.answer('Blue Door.');
  await landed(2);
  await vi.advanceTimersByTimeAsync(HOURS_4 - 1);
  expect(alfredThread()?.turns).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(alfredThread()).toBeNull();
});

test('a follow-up the server refuses as ended closes the window with a toast, the question dropped', async () => {
  await render(<Shell place={false} />);
  startAlfred(SEARCH, 'When is dinner?');
  await expect.poll(() => asked.length).toBe(1);
  asked[0]!.answer('Friday at 7.');
  await userEvent.type(windowed().getByLabelText('Ask a follow-up'), 'Where?{Enter}');
  await expect.poll(() => asked.length).toBe(2);
  asked[1]!.refuse('conversation_ended');
  await expect.element(page.getByText(ENDED_LINE)).toBeVisible();
  await expect.element(windowed()).not.toBeInTheDocument();
  expect(alfredThread()).toBeNull();
});

const remembered = () => sessionStorage.getItem('alfred.thread');
const reloaded = () => sessionStorage.setItem('alfred.thread', JSON.stringify({conversation: 5, origin: {kind: 'search'}}));
const turnOf = (question: string, answer: string): AnswerOut => ({
  conversation_id: 5, turn_id: 1, ends_at: new Date(Date.now() + HOURS_4).toISOString(), question, answer, emphasis: [], sources: [], items: [], applications: [], searched: [], proposals: [],
});

test('after a reload the window shows at once with a skeleton while the thread is read back, then fills with its turns', async () => {
  reloaded();
  await render(<Shell place={false} />);
  restoreAlfred();
  await expect.element(windowed()).toBeVisible();
  expect(windowed().element().querySelector('[data-skeleton="thread"]')).not.toBeNull();
  read(200, {conversation_id: 5, message_id: null, ended: false, turns: [turnOf('When is dinner?', 'Friday at 7.')]});
  await expect.element(windowed().getByText('Friday at 7.')).toBeVisible();
  expect(windowed().element().querySelector('[data-skeleton="thread"]')).toBeNull();
  expect(remembered()).not.toBeNull();
});

test.each([
  ['the server has ended it', 200, {conversation_id: 5, message_id: null, ended: true, turns: [turnOf('When is dinner?', 'Friday at 7.')]}],
  ['the server no longer has it', 404, {error: {code: 'not_found', message: 'No such conversation.'}}],
])('after a reload, when %s, the skeleton goes quietly and the tab forgets the thread', async (_, status, body) => {
  reloaded();
  await render(<Shell place={false} />);
  restoreAlfred();
  await expect.element(windowed()).toBeVisible();
  read(status, body);
  await expect.element(windowed()).not.toBeInTheDocument();
  expect(remembered()).toBeNull();
});
