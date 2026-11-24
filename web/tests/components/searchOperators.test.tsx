// Mail search's operators in the field (app/search/Search.tsx): each one the search reads is marked
// whole, and after from:, to:, has: and is: a list offers what they take. ↓ and ↑ move it, Enter and
// Tab pick, Esc closes it and leaves the search. On the phone a tap picks. Calendar's field has neither. The server is faked at
// `fetch`, answering people for what's typed. How the marks look is by eye.
import type {Recipient, SearchChip} from '@setpoint/shared';
import {useState} from 'react';
import {afterEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {SearchField} from '../../src/app/search/Search.tsx';

const PEOPLE: Recipient[] = [
  {name: 'Sam Ortiz', address: 'sam.ortiz@example.org'},
  {name: 'Sam Lee', address: 'sam.lee@example.com'},
  {name: null, address: 'alert@indeed.example'},
];

/** The people route, faked: those whose name or address starts with what's typed. Each URL asked is kept. */
function people() {
  const asked: URL[] = [];
  vi.spyOn(window, 'fetch').mockImplementation(input => {
    const url = new URL(String(input), location.href);
    asked.push(url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const found = url.pathname === '/api/mail/people' ? PEOPLE.filter(one => one.address.startsWith(q) || (one.name ?? '').toLowerCase().startsWith(q)) : [];
    return Promise.resolve(new Response(JSON.stringify({people: found}), {headers: {'Content-Type': 'application/json'}}));
  });
  return asked;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The field with its search held here, as the Inbox's (`operators`) or the calendar's. */
function Field({operators = true, onClear = () => {}, onSuggestion}: {operators?: boolean; onClear?: () => void; onSuggestion?: () => void}) {
  const [text, setText] = useState('');
  const search = {
    chips: [] as SearchChip[], text, active: text !== '', setText, settle: () => Promise.resolve(null), removeChip: () => {},
    clear: () => {
      onClear();
      setText('');
    },
    ...(onSuggestion ? {suggestion: {}, acceptSuggestion: onSuggestion} : {}),
  };
  return <SearchField search={search} operators={operators} label={operators ? 'Search mail' : 'Search calendar'} onEnter={() => {}} />;
}

const field = () => page.getByRole('combobox', {name: 'Search mail'});
const options = (name: string) => page.getByRole('listbox', {name}).getByRole('option');
/** Each row of a list as it reads, its name then its address, without the ↵ Enter's row shows. */
const rows = (name: string) => [...document.querySelectorAll(`[role="listbox"][aria-label="${name}"] [role="option"]`)].map(option => option.textContent!.replace('↵', ''));
const marks = () => [...document.querySelectorAll('.q-marks .tok-q')].map(mark => mark.textContent);

test('from: asks for the people who wrote, ↓ moves, and Enter puts the address in with a space', async () => {
  const asked = people();
  await render(<Field />);
  await userEvent.click(field());
  await userEvent.keyboard('from:sa');
  await expect.poll(() => rows('People')).toEqual(['Sam Ortizsam.ortiz@example.org', 'Sam Leesam.lee@example.com']);
  expect(asked.some(url => url.pathname === '/api/mail/people' && url.searchParams.get('mode') === 'from' && url.searchParams.get('q') === 'sa')).toBe(true);
  await userEvent.keyboard('{ArrowDown}');
  await expect.element(options('People').nth(1)).toHaveAttribute('aria-selected', 'true');
  await userEvent.keyboard('{ArrowUp}{Enter}');
  await expect.element(field()).toHaveValue('from:sam.ortiz@example.org ');
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  expect(marks()).toEqual(['from:sam.ortiz@example.org']);
  // The caret is after the space, so typing goes on there.
  await userEvent.keyboard('lease');
  await expect.element(field()).toHaveValue('from:sam.ortiz@example.org lease');
});

test('to: asks for the people written to, and a "-" stays where it was typed', async () => {
  const asked = people();
  await render(<Field />);
  await userEvent.click(field());
  await userEvent.keyboard('to:-sam.l');
  await expect.poll(() => rows('People')).toEqual(['Sam Leesam.lee@example.com']);
  expect(asked.some(url => url.searchParams.get('mode') === 'to')).toBe(true);
  await userEvent.keyboard('{Enter}');
  await expect.element(field()).toHaveValue('to:-sam.lee@example.com ');
  expect(marks()).toEqual(['to:-sam.lee@example.com']);
});

test('has: and is: offer their values, with no person glyph', async () => {
  people();
  await render(<Field />);
  await userEvent.click(field());
  await userEvent.keyboard('has:');
  await expect.poll(() => rows('Values')).toEqual(['attachment', 'file']);
  await userEvent.keyboard('{Enter}is:un');
  await expect.poll(() => rows('Values')).toEqual(['unread']);
  await userEvent.keyboard('{Enter}');
  await expect.element(field()).toHaveValue('has:attachment is:unread ');
  expect(marks()).toEqual(['has:attachment', 'is:unread']);
});

test('Esc closes the list and leaves the search; Tab picks rather than taking the suggestion', async () => {
  people();
  const onClear = vi.fn();
  const onSuggestion = vi.fn();
  await render(<Field onClear={onClear} onSuggestion={onSuggestion} />);
  await userEvent.click(field());
  await userEvent.keyboard('has:f');
  await expect.poll(() => rows('Values')).toEqual(['file']);
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  await expect.element(field()).toHaveValue('has:f');
  expect(onClear).not.toHaveBeenCalled();
  await userEvent.keyboard(' is:r');
  await expect.poll(() => rows('Values')).toEqual(['read']);
  await userEvent.keyboard('{Tab}');
  await expect.element(field()).toHaveValue('has:f is:read ');
  expect(onSuggestion).not.toHaveBeenCalled();
});

test('Esc closes the list only while the caret is in that operator: cleared and typed again, it opens', async () => {
  people();
  await render(<Field />);
  await userEvent.click(field());
  await userEvent.keyboard('from:');
  await expect.poll(() => rows('People')).toHaveLength(3);
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  await userEvent.keyboard('{Backspace>5/}');
  await expect.element(field()).toHaveValue('');
  await userEvent.keyboard('from:');
  await expect.poll(() => rows('People')).toHaveLength(3);
});

test('only people found for what\'s typed now are offered, so Enter never picks an older answer', async () => {
  people();
  const answer = vi.mocked(window.fetch).getMockImplementation()!;
  // An answer for "al" is held, so the list still has only the answer for nothing typed.
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  vi.mocked(window.fetch).mockImplementation(async (input, init) => {
    if (new URL(String(input), location.href).searchParams.get('q') === 'al') await held;
    return answer(input, init);
  });
  await render(<Field />);
  await userEvent.click(field());
  await userEvent.keyboard('from:');
  await expect.poll(() => rows('People')).toHaveLength(3);
  await userEvent.keyboard('al');
  await expect.poll(() => vi.mocked(window.fetch).mock.calls.some(([input]) => new URL(String(input), location.href).searchParams.get('q') === 'al')).toBe(true);
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument();
  await userEvent.keyboard('{Enter}');
  await expect.element(field()).toHaveValue('from:al');
  release();
  await expect.poll(() => rows('People')).toEqual(['alert@indeed.example']);
});

test.each<[string, string[]]>([
  ['-from:pat has:pdf lease', ['-from:pat']],
  ['from:-indeed subject:"lease renewal"', ['from:-indeed', 'subject:"lease renewal"']],
  ['from: foo:bar -renewal follow-up before:2026/13/40', []],
  ['after:3/1/26 is:read', ['after:3/1/26', 'is:read']],
])('%s marks %j', async (typed, expected) => {
  people();
  await render(<Field />);
  await userEvent.fill(field(), typed);
  await expect.element(field()).toHaveValue(typed);
  expect(marks()).toEqual(expected);
});

test('a value-less from: is unmarked until a pick', async () => {
  people();
  await render(<Field />);
  await userEvent.click(field());
  await userEvent.keyboard('from:');
  await expect.element(options('People').first()).toBeInTheDocument();
  expect(marks()).toEqual([]);
  await userEvent.keyboard('{Enter}');
  await expect.element(field()).toHaveValue('from:sam.ortiz@example.org ');
  expect(marks()).toEqual(['from:sam.ortiz@example.org']);
});

test('on the phone it marks and offers the same, and a tap picks', async () => {
  people();
  const {innerWidth: width, innerHeight: height} = window;
  await page.viewport(375, 812);
  try {
    await render(<Field />);
    await userEvent.click(field());
    await userEvent.keyboard('is:unread from:');
    await expect.poll(() => rows('People')).toHaveLength(3);
    expect(marks()).toEqual(['is:unread']);
    // The phone's field: its clear button where the desktop's Esc hint is.
    await expect.element(page.getByRole('button', {name: 'Clear search'})).toBeVisible();
    await userEvent.click(options('People').nth(1));
    await expect.element(field()).toHaveValue('is:unread from:sam.lee@example.com ');
    await expect.element(field()).toHaveFocus();
    expect(marks()).toEqual(['is:unread', 'from:sam.lee@example.com']);
  } finally {
    await page.viewport(width, height);
  }
});

test('Calendar\'s field shows no list and no marks', async () => {
  const asked = people();
  await render(<Field operators={false} />);
  const calendar = page.getByRole('textbox', {name: 'Search calendar'});
  await userEvent.click(calendar);
  await userEvent.keyboard('from:sa has:');
  await expect.element(calendar).toHaveValue('from:sa has:');
  expect(document.querySelector('.q-marks')).toBeNull();
  expect(document.querySelector('[role="listbox"]')).toBeNull();
  expect(asked).toEqual([]);
});
