// The phone reader's bottom bar (app/phone/ReaderBar.tsx) at 390 × 844: Done or Trash, Reply and
// More, and More's rows for each kind of email, as a table. A row runs its action and closes the
// sheet. The reader's journeys through them are phoneReader.spec.ts's.
import {beforeEach, expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {ReaderBar} from '../../src/app/phone/ReaderBar.tsx';
import type {ReaderBarActions, ReaderBarEmail} from '../../src/app/phone/ReaderBar.tsx';

beforeEach(async () => {
  await page.viewport(390, 844);
});

const actions = (): ReaderBarActions => ({
  done: vi.fn(), trash: vi.fn(), reply: vi.fn(), replyAll: vi.fn(), forward: vi.fn(), toggleRead: vi.fn(), openInGmail: vi.fn(), snooze: vi.fn(), addEvent: vi.fn(), addTask: vi.fn(),
});

const PLAIN: ReaderBarEmail = {doneable: false, replyAll: false, gmail: false, markedUnread: false, sent: false, snoozeable: true};
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
  ['Gmail mail with others to reply to, Done leading', {...PLAIN, doneable: true, replyAll: true, gmail: true}, ['Reply all', 'Forward', 'Snooze', ...MAKE, 'Trash', 'Mark unread', 'Open in Gmail']],
  ['Gmail mail to the user alone', {...PLAIN, gmail: true}, ['Forward', 'Snooze', ...MAKE, 'Mark unread', 'Open in Gmail']],
  ['iCloud mail marked unread here', {...PLAIN, markedUnread: true}, ['Forward', 'Snooze', ...MAKE, 'Mark read']],
  ['iCloud mail with others, Trash leading', {...PLAIN, replyAll: true}, ['Reply all', 'Forward', 'Snooze', ...MAKE, 'Mark unread']],
  ['an email already snoozed (found by search)', {...PLAIN, snoozeable: false}, ['Forward', ...MAKE, 'Mark unread']],
  ['sent mail: no Snooze and no read state', {...PLAIN, sent: true, snoozeable: false, gmail: true}, ['Forward', ...MAKE, 'Open in Gmail']],
])('More\'s rows: %s', async (_, email, rows) => {
  await draw(email);
  await page.getByRole('button', {name: 'More'}).click();
  await expect.element(page.getByRole('dialog', {name: 'More'})).toBeVisible();
  expect(labels('.ph-bs .ph-bs-i')).toEqual(rows);
});

test('Reply in the bar, and a row of More, each run their action; the row closes the sheet', async () => {
  const on = await draw({...PLAIN, doneable: true, replyAll: true, gmail: true});
  await page.getByRole('button', {name: 'Reply', exact: true}).click();
  expect(on.reply).toHaveBeenCalledOnce();

  for (const [label, action] of [['Reply all', 'replyAll'], ['Forward', 'forward'], ['Add to calendar', 'addEvent'], ['Add as task', 'addTask'], ['Trash', 'trash'], ['Mark unread', 'toggleRead'], ['Open in Gmail', 'openInGmail']] as const) {
    await page.getByRole('button', {name: 'More'}).click();
    const sheet = page.getByRole('dialog', {name: 'More'});
    await sheet.getByRole('button', {name: label}).click();
    expect(on[action]).toHaveBeenCalledOnce();
    await expect.element(sheet).not.toBeInTheDocument();
  }
  expect(on.done).not.toHaveBeenCalled();
});
