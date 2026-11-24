// Alfred asked from any page: ⌘K's Ask Alfred row and the phone's always-on button. Once something
// is typed, the Ask row sits above the first result with the cursor still on that result; Up (or the
// wrap from the bottom) reaches it, ⌘Enter asks from anywhere, and with nothing matching it's the
// only row and has the cursor. The question carries the page it was asked on. On the phone, with no
// conversation the button is round and opens the sheet on an empty question field; with one, it's
// the pill. The server is faked at fetch, each answer at once.
import type {AnswerOut, AskContext} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {clearCache} from '../../src/api/client.ts';
import {Palette} from '../../src/app/palette/Palette.tsx';
import {useCommands} from '../../src/app/palette/commands.ts';
import {PhoneAlfred} from '../../src/app/search/PhoneAlfred.tsx';
import {alfredThread, resetAlfred, startAlfred} from '../../src/app/search/alfred.ts';
import type {Route} from '../../src/logic/route.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});

// Each question sent, with what it carried.
let asked: {question: string; context?: AskContext}[] = [];

beforeEach(() => {
  asked = [];
  window.history.replaceState(null, '', '/calendar');
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.pathname.endsWith('/alfred/ask')) {
      const body = JSON.parse(String(init?.body)) as {question: string; context?: AskContext};
      asked.push(body);
      return json({conversation_id: 5, turn_id: asked.length, ends_at: new Date(Date.now() + 3_600_000).toISOString(), question: body.question, answer: 'Two lab reports this week.',
        emphasis: [], sources: [], items: [], searched: [], proposals: []} satisfies AnswerOut);
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
  window.history.replaceState(null, '', '/');
});

/** The Calendar's offer: its dates in view. */
function CalendarOffer() {
  useCommands(() => ({commands: [], dates: {from: '2026-10-04', to: '2026-10-10'}}));
  return null;
}

async function openPalette() {
  await render(<><CalendarOffer /><Palette /></>);
  await userEvent.keyboard('{Meta>}k{/Meta}');
  const palette = page.getByRole('dialog', {name: 'Command palette'});
  await expect.element(palette).toBeVisible();
  return palette;
}

const rows = () => [...document.querySelectorAll('.palette [role="option"]')].map(row => row.textContent);
const current = () => document.querySelector('.palette [role="option"][aria-selected="true"]')?.textContent;

test('⌘K: once something is typed the Ask row leads, the cursor on the first result; Up reaches it and Enter asks, with the page and its dates', async () => {
  await openPalette();
  expect(rows().some(row => row?.startsWith('Ask Alfred'))).toBe(false);
  await userEvent.keyboard('new');
  await expect.poll(rows).toContain('Ask Alfred · new⌘Enter');
  expect(rows()[0]).toBe('Ask Alfred · new⌘Enter');
  expect(current()).toBe(rows()[1]);
  // The wrap from the top goes to the last result, and back down to the Ask row.
  await userEvent.keyboard('{ArrowUp}');
  expect(current()).toBe(rows()[0]);
  await userEvent.keyboard('{ArrowUp}');
  expect(current()).toBe(rows().at(-1));
  await userEvent.keyboard('{ArrowDown}');
  expect(current()).toBe(rows()[0]);
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toMatchObject({question: 'new', context: {page: 'calendar', dates: {from: '2026-10-04', to: '2026-10-10'}}});
  expect(page.getByRole('dialog', {name: 'Command palette'}).query()).toBeNull();
  expect(alfredThread()?.origin).toEqual({kind: 'page', context: {page: 'calendar', dates: {from: '2026-10-04', to: '2026-10-10'}}});
});

test('⌘K: ⌘Enter asks from any row, and Enter on a result still runs it', async () => {
  await openPalette();
  await userEvent.keyboard('new');
  await userEvent.keyboard('{ArrowDown}{ArrowDown}');
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
  await expect.poll(() => asked.map(one => one.question)).toEqual(['new']);
});

test('⌘K: with nothing matching, the Ask row is the only row and has the cursor, so Enter asks', async () => {
  await openPalette();
  await userEvent.keyboard('when is my lease due');
  await expect.poll(rows).toEqual(['Ask Alfred · when is my lease due⌘Enter']);
  expect(current()).toBe(rows()[0]);
  expect(page.getByText('No command matches').query()).toBeNull();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => asked.map(one => one.question)).toEqual(['when is my lease due']);
});

const INBOX: Route = {page: 'inbox', open: null};

test('the phone: with no conversation, a round button that opens the sheet on an empty, focused field; asked, the question carries the page', async () => {
  await page.viewport(390, 844);
  await render(<div className="main" style={{position: 'relative', height: 844}}><PhoneAlfred route={INBOX} /></div>);
  await page.getByRole('button', {name: 'Ask Alfred'}).click();
  const field = page.getByRole('textbox', {name: 'Ask a follow-up'});
  await expect.element(field).toHaveFocus();
  await expect.element(field).toHaveAttribute('placeholder', 'Ask about your mail or calendar…');
  await userEvent.keyboard('rent{Enter}');
  await expect.element(page.getByText('Two lab reports this week.')).toBeVisible();
  expect(asked).toMatchObject([{question: 'rent', context: {page: 'inbox'}}]);
});

test('the phone: Back on a sheet nothing was asked in leaves no conversation, and the round button comes back', async () => {
  await page.viewport(390, 844);
  await render(<div className="main" style={{position: 'relative', height: 844}}><PhoneAlfred route={INBOX} /></div>);
  await page.getByRole('button', {name: 'Ask Alfred'}).click();
  await page.getByRole('button', {name: 'Inbox'}).click();
  expect(alfredThread()).toBeNull();
  await expect.element(page.getByRole('button', {name: 'Ask Alfred'})).toBeVisible();
});

test('the phone: with a conversation, the pill in the button\'s place', async () => {
  await page.viewport(390, 844);
  startAlfred({kind: 'page', context: {page: 'inbox'}}, 'rent');
  await render(<div className="main" style={{position: 'relative', height: 844}}><PhoneAlfred route={INBOX} /></div>);
  await expect.element(page.getByRole('button', {name: 'Open Alfred'})).toBeVisible();
  expect(page.getByRole('button', {name: 'Ask Alfred'}).query()).toBeNull();
});
