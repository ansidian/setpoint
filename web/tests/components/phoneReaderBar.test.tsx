// The phone reader's bottom bar (app/phone/ReaderBar.tsx) at 390 × 844: Done or Trash, Reply and
// More, and More's rows for each kind of email, as a table, with each row's glyph and its colour.
// Open in Gmail is never one of them. A row runs its action and closes the sheet. The reader's journeys through them are phoneReader.spec.ts's.
import {beforeEach, expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {moreRows, ReaderBar} from '../../src/app/phone/ReaderBar.tsx';
import type {ReaderBarActions, ReaderBarEmail} from '../../src/app/phone/ReaderBar.tsx';

beforeEach(async () => {
  await page.viewport(390, 844);
});

const actions = (): ReaderBarActions => ({
  done: vi.fn(), trash: vi.fn(), reply: vi.fn(), replyAll: vi.fn(), forward: vi.fn(), toggleRead: vi.fn(), snooze: vi.fn(), unsnooze: vi.fn(), addEvent: vi.fn(), addTask: vi.fn(),
});

const PLAIN: ReaderBarEmail = {doneable: false, replyAll: false, markedUnread: false, sent: false, snoozeable: true, snoozed: null};
// A snoozed email where the page changes or ends its snooze (Snoozed, the Inbox's search).
const SNOOZED = {until: '2026-10-09T16:00:00.000Z', when: 'Fri 9:00 AM'};
const MAKE = ['Add to calendar', 'Add as task'];

async function draw(email: ReaderBarEmail, on = actions()) {
  await render(<div className="ph-acts"><ReaderBar email={email} on={on} /></div>);
  return on;
}

const labels = (selector: string) => [...document.querySelectorAll(selector)].map(one => one.textContent);

test.each([
  ['Attention mail not yet Done leads with Done', {...PLAIN, doneable: true}, ['Done', 'Reply', 'More']],
  ['any other leads with Trash', PLAIN, ['Trash', 'Reply', 'More']],
])('the bar: %s', async (_, email, bar) => {
  await draw(email);
  expect(labels('.ph-acts > button')).toEqual(bar);
});

test.each([
  ['mail with others to reply to, Done leading', {...PLAIN, doneable: true, replyAll: true}, ['Reply all', 'Forward', 'Snooze', ...MAKE, 'Trash', 'Mark unread']],
  ['mail to the user alone', PLAIN, ['Forward', 'Snooze', ...MAKE, 'Mark unread']],
  ['mail marked unread here', {...PLAIN, markedUnread: true}, ['Forward', 'Snooze', ...MAKE, 'Mark read']],
  ['an email already snoozed: Snoozed with its return', {...PLAIN, snoozeable: false, snoozed: SNOOZED}, ['Forward', 'SnoozedFri 9:00 AM', ...MAKE, 'Mark unread']],
  ['an email already snoozed where the page can\'t change it', {...PLAIN, snoozeable: false}, ['Forward', ...MAKE, 'Mark unread']],
  ['sent mail: no Snooze and no read state', {...PLAIN, sent: true, snoozeable: false}, ['Forward', ...MAKE]],
])('More\'s rows: %s', async (_, email, rows) => {
  await draw(email);
  await page.getByRole('button', {name: 'More'}).click();
  await expect.element(page.getByRole('dialog', {name: 'More'})).toBeVisible();
  expect(labels('.ph-bs .ph-bs-i')).toEqual(rows);
});

// Each row's glyph and its colour: the swipe tray's and the toasts' for the same action, the rest ink3.
test.each([
  ['Reply all', 'reply_all', 'ink3'],
  ['Forward', 'forward', 'ink3'],
  ['Snooze', 'snooze', 'violet'],
  ['Add to calendar', 'event', 'ink3'],
  ['Add as task', 'task_alt', 'ink3'],
  ['Trash', 'delete', 'alert'],
  ['Mark unread', 'mark_email_unread', 'accent'],
])('More\'s %s: %s in %s', (label, icon, tone) => {
  const row = moreRows({...PLAIN, doneable: true, replyAll: true}, actions(), () => {}).find(one => one.label === label);
  expect(row && [row.icon, row.tone]).toEqual([icon, tone]);
});

test.each([
  ['Snoozed', {...PLAIN, snoozeable: false, snoozed: SNOOZED}, 'snooze', 'violet'],
  ['Mark read', {...PLAIN, markedUnread: true}, 'mark_email_read', 'accent'],
])('More\'s %s: its glyph and colour', (label, email, icon, tone) => {
  const row = moreRows(email, actions(), () => {}).find(one => one.label === label);
  expect(row && [row.icon, row.tone]).toEqual([icon, tone]);
});

test('Reply in the bar, and a row of More, each run their action; the row closes the sheet', async () => {
  const on = await draw({...PLAIN, doneable: true, replyAll: true});
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  expect(on.reply).toHaveBeenCalledOnce();

  for (const [label, action] of [['Reply all', 'replyAll'], ['Forward', 'forward'], ['Add to calendar', 'addEvent'], ['Add as task', 'addTask'], ['Trash', 'trash'], ['Mark unread', 'toggleRead']] as const) {
    await page.getByRole('button', {name: 'More'}).click();
    const sheet = page.getByRole('dialog', {name: 'More'});
    await sheet.getByRole('button', {name: label}).click();
    expect(on[action]).toHaveBeenCalledOnce();
    await expect.element(sheet).not.toBeInTheDocument();
  }
  expect(on.done).not.toHaveBeenCalled();
});

test('a snoozed email\'s Snoozed row opens its sheet under its return, a time there snoozes it anew and Unsnooze ends it', async () => {
  const on = await draw({...PLAIN, snoozeable: false, snoozed: SNOOZED});
  await page.getByRole('button', {name: 'More'}).click();
  await page.getByRole('dialog', {name: 'More'}).getByRole('button', {name: /^Snoozed/}).click();
  const sheet = page.getByRole('dialog', {name: /^Snoozed until /});
  await expect.element(sheet).toBeVisible();
  expect(labels('.ph-bs .ph-bs-i').at(-1)).toBe('Unsnooze');
  await sheet.getByRole('button', {name: 'Unsnooze'}).click();
  expect(on.unsnooze).toHaveBeenCalledOnce();
  await expect.element(sheet).not.toBeInTheDocument();

  await page.getByRole('button', {name: 'More'}).click();
  await page.getByRole('dialog', {name: 'More'}).getByRole('button', {name: /^Snoozed/}).click();
  await page.getByRole('dialog', {name: /^Snoozed until /}).getByRole('button', {name: /^Tomorrow/}).click();
  expect(on.snooze).toHaveBeenCalledOnce();
  expect(on.unsnooze).toHaveBeenCalledOnce();
});
