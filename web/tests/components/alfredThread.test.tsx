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
import {alfredOf, resetAlfred, startAlfred, useAlfredThread, useClaim} from '../../src/app/search/alfred.ts';
import type {AlfredOrigin} from '../../src/app/search/alfred.ts';

const SEARCH: AlfredOrigin = {kind: 'search'};

const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});

// Each question sent, and its answer, held until `answer` lets it go.
let asked: {question: string; conversation: number | null; answer: (text: string) => void}[] = [];
let turnIds = 0;

beforeEach(() => {
  asked = [];
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.pathname.endsWith('/alfred/ask')) {
      const body = JSON.parse(String(init?.body)) as {question: string; conversation_id?: number};
      return new Promise<Response>(resolve => asked.push({
        question: body.question, conversation: body.conversation_id ?? null,
        answer: text => resolve(json({conversation_id: 5, turn_id: ++turnIds, question: body.question, answer: text, emphasis: [], sources: [], items: [], searched: [], proposals: []} satisfies AnswerOut)),
      }));
    }
    if (url.pathname.includes('/alfred/asks/')) return json({step: null});
    if (url.pathname.endsWith('/accounts')) return json([]);
    return json({keys: {anthropic: true}});
  });
});
afterEach(() => {
  resetAlfred();
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
