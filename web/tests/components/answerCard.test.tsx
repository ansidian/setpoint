// Alfred's Answer card with an answer that rests on an email and calendar items: the email's row
// opens it in the reading pane, and each item's row, after the emails, opens the floating detail's
// card for that item as the calendar has it now, the answer staying where it is. The card's Open in
// Calendar goes there. An item no longer on its day says so. A job application's row opens it on Jobs
// (on the phone it shows but doesn't open). An answer that found nothing says it
// looked in the mail and the calendar. The server is faked at fetch: Settings › AI's keys, the
// calendars and the item's day.
import type {AccountOut, AnswerOut, CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page, userEvent} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {AnswerCard, SettingsLink} from '../../src/app/search/AnswerCard.tsx';
import type {Alfred} from '../../src/app/search/state.ts';
import {dismissToast} from '../../src/app/toast.ts';
import {ToastPill} from '../../src/app/ToastPill.tsx';

const NOW = Date.parse(SEED_NOW);

const DINNER = {key: '41', id: 41, kind: 'event', calendar_id: 2, title: 'Dinner with Sam', date: '2026-10-09', start: '2026-10-10T02:00:00.000Z', all_day: false, occurrence_start: null} as const;
const GYM = {key: '7@2026-10-08T14:00:00.000Z', id: 7, kind: 'event', calendar_id: 2, title: 'Gym', date: '2026-10-08', start: '2026-10-08T14:00:00.000Z', all_day: false, occurrence_start: '2026-10-08T14:00:00.000Z'} as const;

const turn = (fields: Partial<AnswerOut>): AnswerOut => ({
  conversation_id: 1, turn_id: 1, ends_at: SEED_NOW, question: 'When is dinner with Sam?', answer: 'Friday at 7:00 PM at Blue Door.', emphasis: [{start: 0, end: 6}],
  sources: [{message_id: 27, account_id: 1, subject: 'Dinner Friday?', organisation: null, from_name: 'Sam Lee', received_at: '2026-10-05T19:40:00Z', pinned: false}],
  items: [DINNER], applications: [], searched: [], proposals: [], fixes: [], ...fields,
});

const alfredWith = (turns: AnswerOut[]): Alfred => ({
  open: true, turns, waiting: null, step: null, trail: [], error: null, failed: null, start: vi.fn(), ask: vi.fn(), close: vi.fn(),
});

const ACCOUNTS = new Map<number, AccountOut>([[1, {id: 1, label: 'Personal', provider: 'gmail', address: 'user@example.com'} as unknown as AccountOut]]);
const CALENDARS: CalendarOut[] = [{id: 2, provider: 'google', account_id: 1, name: 'Personal', colour: 'cool', position: 0, visible: true, listed: true, writable: true, command: null}];

const event = (fields: Partial<ItemOut>): ItemOut => ({
  key: '41', id: 41, calendar_id: 2, kind: 'event', title: 'Dinner with Sam', time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
  place: 'Blue Door', address: '2118 Sunset Blvd', attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null,
  all_day: false, starts_at: '2026-10-10T02:00:00.000Z', ends_at: '2026-10-10T04:00:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null,
  read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null, ...fields,
});

// Each day's items, by its date, as GET /api/items?from=…&to=… answers.
const DAYS: Record<string, ItemOut[]> = {
  '2026-10-09': [event({})],
  '2026-10-08': [event({key: GYM.key, id: 7, title: 'Gym', place: null, address: null, recurring: true, occurrence_start: GYM.start, starts_at: GYM.start, ends_at: '2026-10-08T15:00:00.000Z'})],
  '2026-10-07': [],
};

const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});

let was = '';
beforeEach(() => {
  was = `${window.location.pathname}${window.location.search}`;
  vi.spyOn(window, 'fetch').mockImplementation(async input => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.pathname.endsWith('/calendars')) return json(CALENDARS);
    if (url.pathname.endsWith('/items')) return json({from: url.searchParams.get('from'), to: url.searchParams.get('to'), items: DAYS[url.searchParams.get('from')!] ?? []});
    return json({keys: {anthropic: true}});
  });
});
afterEach(() => {
  window.history.replaceState(null, '', was);
  dismissToast();
  vi.restoreAllMocks();
});

// The card in the shell (`.app`), where the floating detail's card is drawn, with the toast.
async function card(turns: AnswerOut[], onOpen = vi.fn()) {
  await render(
    <div className="app" style={{position: 'relative', width: 900, height: 700}}>
      <div style={{width: 560}}><AnswerCard alfred={alfredWith(turns)} scoped={false} openId={null} accounts={ACCOUNTS} now={NOW} timeZone={SEED_TIME_ZONE} onOpen={onOpen} /></div>
      <ToastPill />
    </div>,
  );
  return onOpen;
}

const detail = (name: string) => page.getByRole('dialog', {name});

test('the item it rests on is a row after the email\'s, with its day and time; it opens the item\'s card and the answer stays', async () => {
  const onOpen = await card([turn({})]);
  await expect.element(page.getByRole('button', {name: /Dinner with Sam/})).toBeVisible();
  expect([...document.querySelectorAll('.srcs .src')].map(row => row.textContent)).toEqual(['Sam LeeDinner Friday?PersonalMon', 'Dinner with SamFri, Oct 9 · 7:00 PM']);
  await userEvent.click(page.getByRole('button', {name: /Dinner Friday\?/}));
  expect(onOpen).toHaveBeenCalledWith(27);

  await userEvent.click(page.getByRole('button', {name: /Dinner with Sam/}));
  await expect.element(detail('Dinner with Sam')).toBeVisible();
  await expect.element(detail('Dinner with Sam').getByText('Blue Door')).toBeVisible();
  await expect.element(page.getByRole('button', {name: /Dinner with Sam/})).toHaveAttribute('aria-expanded', 'true');
  expect(window.location.pathname).toBe(was.split('?')[0]);
  await expect.element(page.getByText('Friday at 7:00 PM at Blue Door.')).toBeVisible();

  // Esc closes the card, and a click on the row again opens it; Open in Calendar goes there.
  await userEvent.keyboard('{Escape}');
  await expect.element(detail('Dinner with Sam')).not.toBeInTheDocument();
  await userEvent.click(page.getByRole('button', {name: /Dinner with Sam/}));
  await userEvent.click(detail('Dinner with Sam').getByRole('button', {name: 'Open in Calendar'}));
  expect(window.location.pathname).toBe('/calendar/item/41');
});

test('a recurring event\'s card is its occurrence, and Open in Calendar opens that one; a task all day shows its day alone', async () => {
  await card([turn({sources: [], items: [
    GYM,
    {key: '12', id: 12, kind: 'task', calendar_id: 3, title: 'Pay rent', date: '2026-11-01', start: null, all_day: true, occurrence_start: null},
  ]})]);
  await expect.element(page.getByRole('button', {name: /Pay rent/})).toHaveTextContent('Pay rentSun, Nov 1');
  await userEvent.click(page.getByRole('button', {name: /Gym/}));
  await userEvent.click(detail('Gym').getByRole('button', {name: 'Open in Calendar'}));
  expect(`${window.location.pathname}${window.location.search}`).toBe(`/calendar/item/7?at=${encodeURIComponent(GYM.start)}`);
});

test('an item no longer on its day says so, and no card opens', async () => {
  await card([turn({sources: [], items: [{...DINNER, key: '99', id: 99, title: 'Old plan', date: '2026-10-07'}]})]);
  await userEvent.click(page.getByRole('button', {name: /Old plan/}));
  await expect.element(page.getByText('Old plan is no longer on your calendar')).toBeVisible();
  expect(document.querySelector('.fd.item-card')).toBeNull();
});

test('nothing found says it looked in the mail and the calendar', async () => {
  await card([turn({answer: null, emphasis: [], sources: [], items: [], searched: ['passport']})]);
  await expect.element(page.getByText('Couldn’t find that in your mail or calendar')).toBeVisible();
  expect(document.querySelector('.srcs')).toBeNull();
});

const WOODGROVE = {application_id: 32, company: 'Woodgrove Bank', title: 'Application Developer', status: 'Offer'};

test('a job application it rests on is a row after the items: its company and status, then its role; it opens the application on Jobs', async () => {
  await card([turn({sources: [], items: [], applications: [WOODGROVE]})]);
  const row = page.getByRole('button', {name: /Woodgrove Bank/});
  await expect.element(row).toHaveTextContent('Woodgrove Bank· OfferApplication Developer');
  await userEvent.click(row);
  expect(window.location.pathname).toBe('/jobs/32');
  // The answer stays.
  await expect.element(page.getByText('Friday at 7:00 PM at Blue Door.')).toBeVisible();
});

test('on the phone, which has no Jobs, an application\'s row shows but doesn\'t open', async () => {
  await page.viewport(390, 844);
  try {
    await card([turn({sources: [], items: [], applications: [WOODGROVE]})]);
    await expect.element(page.getByText('Application Developer')).toBeVisible();
    expect(page.getByRole('button', {name: /Woodgrove Bank/}).elements()).toEqual([]);
  } finally {
    await page.viewport(1280, 800);
  }
});

test('"Settings › AI" is a link to that page; on the phone, which sets the key only on the desktop, it says so and is no link', async () => {
  const words = 'Alfred needs an Anthropic key in Settings › AI.';
  const shown = await render(<p><SettingsLink text={words} /></p>);
  await expect.element(page.getByRole('button', {name: 'Settings › AI'})).toBeVisible();
  await shown.unmount();
  await page.viewport(375, 812);
  try {
    await render(<p><SettingsLink text={words} /></p>);
    await expect.element(page.getByText('Alfred needs an Anthropic key in Settings › AI on the desktop.')).toBeVisible();
    expect(page.getByRole('button').elements()).toEqual([]);
  } finally {
    await page.viewport(1280, 800);
  }
});
