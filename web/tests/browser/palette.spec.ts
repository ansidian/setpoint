// ⌘K in the browser: board 20, what it lists on the open email, then its
// commands: the open email's (Done, Add to calendar's proposal, Mark unread), Go to, Appearance with
// the current theme ticked, typing finding the commands that only have a key, the keyboard cursor,
// and Esc giving focus back.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {MailCountsOut, MessageOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

const items = (page: Page) => page.locator('.palette .item').allTextContents();
const current = (page: Page) => page.locator('.palette .item.cur').textContent();

async function openNorthwind(page: Page, base: string) {
  await page.goto(`${base}/inbox`);
  await page.locator('.today-row').first().waitFor();
  await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
  await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
}

test('board 20: ⌘K on the open Northwind email', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    // Night chosen in this browser, as board 20 ticks it.
    await page.addInitScript(() => localStorage.setItem('setpoint.theme', 'night'));
    await openNorthwind(page, setpoint.base);
    await until('the sidebar\'s unread count', () => page.locator('.nav.on .ubadge').textContent(), text => text === '18');
    await page.mouse.move(700, 28);
    await page.keyboard.press('Meta+k');
    await page.locator('.palette').waitFor();
    assert.deepEqual(await page.locator('.palette .cmdk-label').allTextContents(), ['This email', 'Go to', 'Appearance']);
    assert.deepEqual(await items(page), [
      'DoneH', 'TrashE', 'PinP', 'SnoozeS', 'Open in GmailO', 'ReplyR', 'ForwardF', 'Add to calendar', 'Add as task', 'Ask about this email', 'New rule from northwind.example…', 'Mark unread⇧U',
      'Inbox1', 'Sent', 'Drafts', 'Snoozed', 'Calendar2', 'News3', 'Jobs4', 'Settings⌘,', 'System', 'Light', 'Night', 'Fold the sidebar`',
    ]);
    assert.equal(await current(page), 'DoneH');
    assert.equal(await page.locator('.palette .ctx').textContent(), 'Interview availability for Software Engineer I');
    assert.equal(await page.locator('.palette .item .tick').count(), 1);
    assert.equal(await page.locator('.palette .item', {hasText: 'Night'}).locator('.tick').count(), 1, 'the current theme is ticked');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘K\'s Snooze opens the reader\'s snooze menu once the palette has gone, Tomorrow focused', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openNorthwind(page, setpoint.base);
    await page.keyboard.press('Meta+k');
    await page.locator('.palette').waitFor();
    await page.keyboard.type('snooze');
    await until('Snooze first', () => current(page), text => text === 'SnoozeS');
    await page.keyboard.press('Enter');
    await page.locator('.palette').waitFor({state: 'detached'});
    await page.locator('.rd-tools .snooze-list').waitFor();
    await until('Tomorrow focused', () => page.evaluate(() => document.activeElement?.textContent ?? ''), text => text.startsWith('Tomorrow'));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the open email\'s commands: Done, Add to calendar and Mark unread, and Esc gives focus back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openNorthwind(page, setpoint.base);
    const id = Number(new URL(page.url()).pathname.split('/').at(-1));

    // Esc closes it, and focus is where it was.
    await page.locator('.rd-tools .tool', {hasText: 'Trash'}).focus();
    await page.keyboard.press('Meta+k');
    await page.locator('.palette input').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT');
    await page.keyboard.press('Escape');
    await page.locator('.palette').waitFor({state: 'detached'});
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'TrashE');
    assert.equal(await page.locator('.pane:not(.idle)').count(), 1, 'Esc closed only the palette');

    // Add to calendar opens the proposal card, as the reader's button does.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('add to cal');
    assert.deepEqual(await items(page), ['Add to calendar']);
    await page.keyboard.press('Enter');
    await page.locator('.prop').waitFor();

    // Mark unread: the email is unread again, and the reader closes.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('unread');
    await page.keyboard.press('Enter');
    await page.locator('.pane:not(.idle)').waitFor({state: 'detached'});
    await until('unread again', () => setpoint.api<MessageOut>('GET', `/mail/messages/${id}`), message => message.unread);

    // Done, with the cursor moved down and back.
    await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await page.keyboard.press('Meta+k');
    await page.keyboard.press('ArrowDown');
    assert.equal(await current(page), 'TrashE');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await until('Done', () => setpoint.api<MailCountsOut>('GET', '/mail/counts'), counts => counts.attention === 2);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Go to, Appearance, and typing finds the commands that only have a key', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.keyboard.press('Meta+k');
    // No email open: Go to and Appearance only. It runs commands, not search, and says so.
    assert.deepEqual(await page.locator('.palette .cmdk-label').allTextContents(), ['Go to', 'Appearance']);
    assert.equal(await page.locator('.palette input').getAttribute('placeholder'), 'Type a command…');
    await page.keyboard.type('new');
    // Settings › News is found by its name too.
    // The Inbox's Go to next unread too, by its keyword, its key U.
    assert.deepEqual(await items(page), ['News3', 'Go to next unreadU', 'New messageC', 'New eventC', 'New taskD', 'Settings › News']);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/calendar\/new\?kind=task/);
    await page.locator('.editor').waitFor();

    // Light, then Night, each ticked once chosen.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('light');
    await page.keyboard.press('Enter');
    await until('Light', () => page.evaluate(() => document.documentElement.dataset.theme), theme => theme === 'light');
    await page.keyboard.press('Meta+k');
    assert.equal(await page.locator('.palette .item', {hasText: 'Light'}).locator('.tick').count(), 1);
    await page.keyboard.type('dark');
    assert.deepEqual(await items(page), ['Night']);
    await page.keyboard.press('Enter');
    await until('Night', () => page.evaluate(() => document.documentElement.dataset.theme), theme => theme === 'night');
    assert.equal(await page.evaluate(() => localStorage.getItem('setpoint.theme')), 'night');

    // Go to Inbox, then Settings.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('inbox');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/inbox$/);
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('settings');
    await page.keyboard.press('Enter');
    await page.locator('.settings').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.settings').waitFor({state: 'detached'});

    // Mark all as read and Sign out are found by typing.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('mark all');
    assert.deepEqual(await items(page), ['Mark all as read⇧I']);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('sign');
    assert.deepEqual(await items(page), ['Sign out']);
    await page.keyboard.press('Enter');
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).click();
    await page.locator('.sign-in').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('⌘K goes to Drafts, and New message on Calendar opens a new message with the caret in To', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('drafts');
    assert.deepEqual(await items(page), ['Drafts']);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/drafts$/);

    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-month .cell').first().waitFor();
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('new message');
    assert.deepEqual(await items(page), ['New messageC']);
    await page.keyboard.press('Enter');
    await page.locator('.cmp-window .composer').waitFor();
    assert.equal(await page.locator('.cmp-window .cmp-title-text').textContent(), 'New message');
    await until('the caret is in To', () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')), label => label === 'To');
    assert.match(page.url(), /\/calendar$/, 'it opens over Calendar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('typing what a Settings section holds finds it: "rules" opens Mail, "ntfy" Notifications, "keys" AI, "projects" and "buffer" Calendar', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    for (const [typed, section] of [['rules', 'Mail'], ['ntfy', 'Notifications'], ['keys', 'AI'], ['passkeys', 'Security'], ['projects', 'Calendar'], ['buffer', 'Calendar']] as const) {
      await page.keyboard.press('Meta+k');
      await page.keyboard.type(typed);
      assert.deepEqual(await items(page), [`Settings › ${section}`], typed);
      await page.keyboard.press('Enter');
      await page.locator('.settings .set-title', {hasText: section}).waitFor();
      await page.keyboard.press('Escape');
      await page.locator('.settings').waitFor({state: 'detached'});
    }
    // Nothing found says so.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('zebra');
    const none = page.locator('.palette .none', {hasText: 'No command matches'});
    await none.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Sign out from ⌘K asks once in the toast, and the Enter that asked doesn\'t answer; Esc cancels it, Enter signs out', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('sign out');
    await page.keyboard.press('Enter');
    const ask = page.locator('.toast', {hasText: 'Sign out of Setpoint?'});
    await ask.waitFor();
    // Nothing happens to wait for: asking signs nothing out.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await page.locator('.sign-in').count(), 0, 'still signed in');
    // Esc cancels it.
    await page.keyboard.press('Escape');
    await ask.waitFor({state: 'detached'});
    // Asked again, Enter answers it.
    await page.keyboard.press('Meta+k');
    await page.keyboard.type('sign out');
    await page.keyboard.press('Enter');
    await ask.waitFor();
    await page.keyboard.press('Enter');
    await page.locator('.sign-in').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
