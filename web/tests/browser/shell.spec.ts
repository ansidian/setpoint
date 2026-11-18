// The shell in the browser: signing in (claiming with a setup token, then the password, or a
// recovery code), the layout's fixed sizes at the desktop size, no focus rings, the account filter,
// the page keys, the tab title, the sidebar folding to its rail and its next-up slot, and live
// updates from a change made elsewhere.
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {ItemsOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {DONE_MOMENT_MS} from '../../src/logic/today.ts';
import {cleanUp, describe, drawn, drawnTwice, holdToast, pagePx, pauseClock, PASSWORD, rested, SIZES, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

// In the page's pixels, as the stylesheet sizes them.
const box = async (page: Page, selector: string) => {
  const rect = (await rested(() => page.locator(selector).first().boundingBox()))!;
  return {x: pagePx(rect.x), y: pagePx(rect.y), width: pagePx(rect.width), height: pagePx(rect.height)};
};

test('the sign-in card claims Setpoint with the setup token, then signs in with the password', async () => {
  const setpoint = await startSetpoint({claim: false});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox/5`);
    await page.getByLabel('Setup token').fill(setpoint.setupToken);
    await page.getByLabel('New password').fill('short');
    await page.getByRole('button', {name: 'Claim Setpoint'}).click();
    await page.locator('.sign-in-line.failed', {hasText: 'At least 12 characters'}).waitFor();
    await page.getByLabel('New password').fill('a long enough password');
    await page.getByRole('button', {name: 'Claim Setpoint'}).click();
    // The recovery codes, once. Then the app, at the address it was asked for.
    await page.locator('.recovery').waitFor();
    assert.equal((await page.locator('.recovery').textContent())!.trim().split('\n').length, 8);
    await page.getByRole('button', {name: 'Continue'}).click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();

    // Signed out (another tab, or the session ending): the card asks for the password.
    await page.evaluate(() => fetch('/api/auth/sign-out', {method: 'POST'}));
    await page.reload();
    const top = async () => (await rested(() => page.locator('.sign-in').boundingBox()))!.y;
    await page.getByLabel('Password').waitFor();
    const before = await top();
    await page.getByLabel('Password').fill('not the password');
    await page.keyboard.press('Enter');
    await page.locator('.sign-in-line.failed', {hasText: 'Wrong password'}).waitFor();
    assert.equal(await top(), before, 'the card grows down; it doesn\'t jump up');
    await page.getByLabel('Password').fill('a long enough password');
    await page.keyboard.press('Enter');
    await page.locator('.list .row').first().waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the sign-in card answers: a refusal selects what was typed; Use a passkey leads while nothing is typed', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    // Passkeys registered: the harness answers the card's status with one, so the card offers it.
    await page.route('**/api/auth/status', async route => {
      const response = await route.fetch();
      await route.fulfill({response, json: {...await response.json() as object, passkeys: true}});
    });
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.evaluate(() => fetch('/api/auth/sign-out', {method: 'POST'}));
    await page.reload();
    const card = page.locator('.sign-in');
    const passkey = page.getByRole('button', {name: 'Use a passkey'});
    const signIn = page.getByRole('button', {name: 'Sign in'});
    await passkey.waitFor();
    // Nothing typed: Use a passkey is the solid button and Sign in the ghost. A character turns
    // them back.
    const kinds = async () => [await passkey.getAttribute('class'), await signIn.getAttribute('class')];
    assert.deepEqual(await kinds(), ['btn', 'btn ghost']);
    // Three don't fit the card's row: Use a recovery code goes under the other two, inside the card.
    assert.deepEqual(await rested(() => card.evaluate(element => {
      const box = element.getBoundingClientRect();
      const [main, , recovery] = [...element.querySelectorAll('.sign-in-foot .btn')].map(button => button.getBoundingClientRect());
      return [[...element.querySelectorAll('.sign-in-foot .btn')].every(button => button.getBoundingClientRect().left >= box.left && button.getBoundingClientRect().right <= box.right), recovery!.top > main!.bottom];
    })), [true, true]);
    await page.getByLabel('Password').press('a');
    await until('Sign in leads again', kinds, classes => classes.join() === 'btn ghost,btn');
    await page.getByLabel('Password').press('Backspace');
    await until('Use a passkey leads', kinds, classes => classes.join() === 'btn,btn ghost');

    // A wrong password: the line, and what was typed selected, so typing replaces it.
    await page.getByLabel('Password').fill('not the password');
    await page.keyboard.press('Enter');
    await page.locator('.sign-in-line.failed', {hasText: 'Wrong password'}).waitFor();
    assert.deepEqual(await page.getByLabel('Password').evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd, input.value.length]), [0, 16, 16]);
    await page.keyboard.type(PASSWORD);
    assert.equal(await page.getByLabel('Password').inputValue(), PASSWORD, 'typing replaced it');

    await page.keyboard.press('Enter');
    await page.locator('.list .row').first().waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a recovery code signs in when the password is lost: a new password, then new codes, shown once', async () => {
  const setpoint = await startSetpoint({claim: false});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.getByLabel('Setup token').fill(setpoint.setupToken);
    await page.getByLabel('New password').fill('a long enough password');
    await page.getByRole('button', {name: 'Claim Setpoint'}).click();
    const codes = (await page.locator('.recovery').textContent())!.trim().split('\n');
    await page.getByRole('button', {name: 'Continue'}).click();
    await page.locator('.list .row').first().waitFor();

    await page.evaluate(() => fetch('/api/auth/sign-out', {method: 'POST'}));
    await page.reload();
    await page.getByRole('button', {name: 'Use a recovery code'}).click();
    await page.getByLabel('Recovery code').fill('not-a-code');
    await page.getByLabel('New password').fill('another long password');
    await page.getByRole('button', {name: 'Sign in'}).click();
    await page.locator('.sign-in-line.failed', {hasText: 'Recovery failed'}).waitFor();
    await page.getByLabel('Recovery code').fill(codes[0]!);
    await page.getByRole('button', {name: 'Sign in'}).click();
    await page.locator('.recovery').waitFor();
    const fresh = (await page.locator('.recovery').textContent())!.trim().split('\n');
    assert.equal(fresh.length, 8);
    assert.ok(!fresh.includes(codes[1]!), 'the old codes are replaced');
    await page.getByRole('button', {name: 'Continue'}).click();
    await page.locator('.list .row').first().waitFor();

    // The new password is the password now. Back returns to it from the code.
    await page.evaluate(() => fetch('/api/auth/sign-out', {method: 'POST'}));
    await page.reload();
    await page.getByRole('button', {name: 'Use a recovery code'}).click();
    await page.getByRole('button', {name: 'Use the password'}).click();
    await page.getByLabel('Password').fill('another long password');
    await page.keyboard.press('Enter');
    await page.locator('.list .row').first().waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

describe(`the shell at ${SIZES.target.width} × ${SIZES.target.height}`, () => {
  test('sidebar 248, header 56, the reading pane 680 with or without an email open, nothing moving as one opens and closes; the shell never scrolls; no focus rings', async () => {
    const setpoint = await startSetpoint();
    try {
      const page = await setpoint.page('target');
      await page.goto(`${setpoint.base}/inbox`);
      await page.locator('.list .row').first().waitFor();
      assert.equal((await box(page, '.sb')).width, 248);
      assert.equal((await box(page, '.hd')).height, 56);
      // Nothing open: the empty pane is there all the same, so nothing moves as an email opens or closes.
      assert.equal((await box(page, '.pane.idle')).width, 680);
      assert.equal((await box(page, '.list')).width, pagePx(SIZES.target.width) - 248 - 680);
      const row = page.locator('.list .row:has(b[data-tip^="Final exam schedule"])');
      const still = () => Promise.all(['.hd .search', '.list'].map(selector => box(page, selector)).concat(row.boundingBox().then(rect => rect!)));
      const before = await rested(still);
      await row.click();
      await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
      assert.equal((await box(page, '.pane:not(.idle)')).width, 680);
      assert.deepEqual(await rested(still), before, 'opening moves nothing');
      // Every row keeps its account while the pane is open.
      for (const label of await page.locator('.list .row .ac').allTextContents()) assert.match(label, /Business|Personal|Work|Jobs|iCloud/);
      const scroll = await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.clientHeight, document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.deepEqual([scroll[0], scroll[2]], [scroll[1], scroll[3]]);
      // Focus on a control draws no ring.
      await page.locator('.rd-tools .tool').first().focus();
      const outline = await rested(() => page.locator('.rd-tools .tool').first().evaluate(element => getComputedStyle(element).outlineStyle));
      assert.equal(outline, 'none');
      await page.keyboard.press('Escape');
      await page.locator('.pane.idle').waitFor();
      assert.deepEqual(await rested(still), before, 'closing moves nothing');
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
});

test('the account filter\'s old address is the plain Inbox; 1 and 2 go to Inbox and Calendar; the tab title follows', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    // No account filter: ?account=4 lands on every account's Inbox, its address the Inbox's,
    // with no account rows under Inbox in the sidebar.
    await page.goto(`${setpoint.base}/inbox?account=4`);
    await page.locator('.list .row').first().waitFor();
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.locator('.hd-title').textContent(), 'Inbox');
    assert.ok(new Set(await page.locator('.list .ac .label, .list .r1 .label').allTextContents()).size > 1, 'every account\'s mail');
    assert.equal(await page.locator('.sb .nav.on').textContent(), 'Inbox19');
    assert.equal(await page.title(), '(19) Inbox');
    await page.keyboard.press('2');
    await page.locator('.hd-title', {hasText: 'October 2026'}).waitFor();
    assert.equal(await page.title(), 'October 2026 · Calendar');
    await page.keyboard.press('1');
    await page.locator('.list .row').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox');
    // The Today block's lines open their card over the page, not Calendar.
    await page.locator('.today-row', {hasText: 'Dentist'}).click();
    await page.locator('.today-card', {hasText: 'Dentist'}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the Today block names its tasks, tomorrow\'s under their own label, and a line opens its card over the open email; E edits it on Calendar, not Trash', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.length === 5);
    assert.deepEqual(await lines.allTextContents(), ['Dentist2:30 PM · in 5h', 'CS 101 lab report', 'Pay rent', 'CS 101 lecture6:00 PM', 'Renew car registration']);
    // Tomorrow's event and task sit under a label of their own.
    assert.deepEqual(await page.locator('.sb .today .sb-label').allTextContents(), ['Today', 'Tomorrow']);
    assert.equal(await page.locator('.sb .today > *').evaluateAll(children => children.findIndex(child => child.textContent === 'Tomorrow')), 4);

    // The card opens over the open email, which stays behind it. Where it sits and its motion (which
    // reduce motion doesn't change, DESIGN.md › Principles) are by eye.
    await lines.filter({hasText: 'Renew car registration'}).click();
    const card = page.locator('.today-card');
    await card.locator('.fd-title', {hasText: 'Renew car registration'}).waitFor();
    assert.equal(new URL(page.url()).pathname.startsWith('/inbox/'), true);
    // Complete is the ring beside the title, not a footer action.
    assert.deepEqual(await card.locator('.card-acts button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? button.textContent)),
      ['EditE', 'Open in Calendar', 'Delete']);
    assert.equal(await card.locator('.card-h').getByRole('button', {name: 'Complete'}).count(), 1);
    // Another line moves the same card. Esc closes it and leaves the email open.
    await lines.filter({hasText: 'Dentist'}).click();
    await card.locator('.fd-title', {hasText: 'Dentist'}).waitFor();
    await page.keyboard.press('Escape');
    await until('the card closed', () => card.count(), count => count === 0);
    assert.equal(await page.locator('.rd-subj').count(), 1);

    // A ring completes its task in place, with Undo.
    await lines.filter({hasText: 'Pay rent'}).getByRole('button', {name: 'Complete Pay rent'}).click();
    await page.locator('.toast', {hasText: 'Completed Pay rent'}).waitFor();
    await until('Pay rent gone', () => lines.allTextContents(), texts => !texts.includes('Pay rent'));
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await until('Pay rent back', () => lines.allTextContents(), texts => texts.includes('Pay rent'));

    // E on the card edits its item on Calendar. The open email isn't trashed.
    await lines.filter({hasText: 'Renew car registration'}).click();
    await card.waitFor();
    await page.keyboard.press('e');
    await page.locator('.editor[aria-label="Edit task"]').waitFor();
    assert.equal(await page.locator('.editor').getByLabel('Title', {exact: true}).inputValue(), 'Renew car registration');
    assert.match(new URL(page.url()).pathname, /^\/calendar\/item\/\d+$/);
    // Whatever E sent answered before the server is read.
    await setpoint.idle();
    const counts = await setpoint.api<MailCountsOut>('GET', '/mail/counts');
    assert.equal(counts.attention, 3);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a double-click on a Today task\'s ring completes only it, and Undo brings it back where it was', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.length === 5);
    await lines.filter({hasText: 'Pay rent'}).getByRole('button', {name: 'Complete Pay rent'}).dblclick();
    await lines.filter({hasText: 'Pay rent'}).waitFor({state: 'detached'});
    await page.locator('.toast', {hasText: 'Completed Pay rent'}).waitFor();
    // The second click completed nothing more.
    await setpoint.idle();
    const tasks = async () => (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-09')).items.filter(item => item.kind === 'task');
    await until('the completion lands', tasks, list => list.every(task => !task.command));
    assert.deepEqual((await tasks()).map(task => [task.title, task.done]).sort(), [['CS 101 lab report', false], ['Pay rent', true], ['Renew car registration', false]]);
    assert.deepEqual(await lines.allTextContents(), ['Dentist2:30 PM · in 5h', 'CS 101 lab report', 'CS 101 lecture6:00 PM', 'Renew car registration']);

    // Undo brings it back where it was.
    await page.mouse.move(800, 600);
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await lines.filter({hasText: 'Pay rent'}).waitFor();
    assert.deepEqual(await lines.allTextContents(), ['Dentist2:30 PM · in 5h', 'CS 101 lab report', 'Pay rent', 'CS 101 lecture6:00 PM', 'Renew car registration']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a Today task ticked off plays the completion moment where it was, and its line folds only once the moment is over', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    await page.goto(`${setpoint.base}/inbox`);
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.length === 5);
    await pauseClock(page);
    const payRent = lines.filter({hasText: 'Pay rent'});
    await payRent.getByRole('button', {name: 'Complete Pay rent'}).click();
    await until('the moment', () => payRent.getAttribute('class'), names => names?.split(' ').includes('just-done') ?? false);
    assert.equal(await payRent.locator('.burst > i').count(), 6);
    // Still there, playing, until the moment is over; then it starts to fold away.
    await page.clock.runFor(DONE_MOMENT_MS - 1);
    await drawnTwice(page);
    assert.equal((await payRent.getAttribute('class'))!.split(' ').includes('leaving'), false);
    await page.clock.runFor(1);
    await until('the fold', () => payRent.getAttribute('class'), names => names?.split(' ').includes('leaving') ?? false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a repeating task completed from Today has Undo, which puts it back open on its day', async () => {
  const setpoint = await startSetpoint();
  try {
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      database.prepare('UPDATE items SET due_recurring = 1, due_string = ? WHERE title = ?').run('every month', 'Pay rent');
    } finally {
      database.close();
    }
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.includes('Pay rent'));
    await lines.filter({hasText: 'Pay rent'}).getByRole('button', {name: 'Complete Pay rent'}).click();
    const toast = await holdToast(page);
    await toast.filter({hasText: 'Completed Pay rent'}).waitFor();
    await lines.filter({hasText: 'Pay rent'}).waitFor({state: 'detached'});
    await setpoint.idle();
    const payRent = async () => (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-08')).items.filter(item => item.title === 'Pay rent');
    await until('the completion lands', payRent, list => list.every(task => !task.command));
    assert.deepEqual((await payRent()).map(task => [task.done, task.can_reopen]), [[true, true]]);

    await toast.getByRole('button', {name: 'Undo'}).click();
    await lines.filter({hasText: 'Pay rent'}).waitFor();
    await setpoint.idle();
    await until('the reopen lands', payRent, list => list.every(task => !task.command));
    assert.deepEqual((await payRent()).map(task => [task.done, task.due_date, task.repeat]), [[false, '2026-10-07', 'every month']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a timed task shows its time and takes its place by it, among the Today block\'s events and in the day pane\'s tasks', async () => {
  const setpoint = await startSetpoint();
  try {
    // Pay rent at 8:00 AM, before the seed's 9:12 AM, and tomorrow's Renew car registration at 9:30 AM.
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      const timed = database.prepare('UPDATE items SET due_at = ? WHERE title = ?');
      timed.run('2026-10-07T15:00:00.000Z', 'Pay rent');
      timed.run('2026-10-08T16:30:00.000Z', 'Renew car registration');
    } finally {
      database.close();
    }
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.length === 5);
    assert.deepEqual(await lines.allTextContents(),
      ['Pay rent8:00 AM', 'Dentist2:30 PM · in 5h', 'CS 101 lab report', 'Renew car registration9:30 AM', 'CS 101 lecture6:00 PM']);

    // The day pane keeps its Events and Tasks apart, its tasks by time and the untimed last.
    await page.goto(`${setpoint.base}/calendar/2026-10-07`);
    const tasks = page.locator('.rpane .ag-task');
    await until('the day\'s tasks', () => tasks.allTextContents(), texts => texts.length === 2);
    // The lab report's subtasks, done of all, before its project.
    assert.deepEqual(await tasks.allTextContents(), ['Pay rent8:00 AMHome', 'CS 101 lab report1/4School']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a load with overdue tasks opens on their banner over the Inbox; a click sends it, a page change in the app doesn\'t bring it back, and a reload does', async () => {
  // Three overdue tasks: one due at 8:00 AM today, before the seed's 9:12 AM, one from Monday and one
  // from Sep 24. The seed itself has none, so no other check meets the banner.
  const setpoint = await startSetpoint({fixtures: ['overdue-tasks']});
  try {
    const page = await setpoint.page('target');
    const loaded = () => page.waitForResponse(response => response.url().includes('/api/items?from=2026-09-07&to=2026-10-08'));
    const first = loaded();
    await page.goto(`${setpoint.base}/inbox`);
    const answer = await first;
    await drawn(page, answer);
    const banner = page.getByRole('dialog', {name: 'Overdue tasks'});
    await banner.waitFor();
    assert.equal(await banner.locator('.overdue-title').textContent(), '3 tasks');
    assert.deepEqual(await banner.locator('.overdue-list li').allTextContents(),
      ['Call the landlord about the heater8:00 AM', 'Submit the parking permit formMon', 'Renew the library cardSep 24']);
    // Over the Inbox and the sidebar: what's under a row and the Today block is the banner.
    await page.locator('.list .row').first().waitFor();
    const covered = await rested(() => page.evaluate(() => ['.list .row', '.sb .today-row'].map(selector => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return Boolean(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.overdue'));
    })));
    assert.deepEqual(covered, [true, true]);

    // Once it has entered, it takes the click.
    await page.locator('.overdue[data-state="in"]').waitFor();
    await banner.click();
    await page.locator('.overdue[data-state="in"]').waitFor({state: 'detached'});
    // The click opened nothing under it: the Inbox has no email open.
    assert.equal(new URL(page.url()).pathname, '/inbox');

    // A page change inside the app is no arrival: Calendar opens with no banner.
    await page.locator('.overdue').waitFor({state: 'detached'});
    await page.keyboard.press('2');
    await page.waitForURL(url => url.pathname.startsWith('/calendar'));
    await setpoint.idle();
    assert.equal(await page.locator('.overdue').count(), 0);

    // The old record of tasks shown, as the last release left it, isn't read: a reload brings the
    // banner back with all three, and the record is gone.
    const {items} = await answer.json() as {items: {id: number; kind: string; due_at: string | null; due_date: string | null}[]};
    const old = items.filter(item => item.kind === 'task').map(item => `${item.id}@${item.due_at ?? item.due_date}`);
    await page.evaluate(keys => localStorage.setItem('setpoint.overdueShown', JSON.stringify(keys)), old);
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.overdue[data-state="in"]').waitFor();
    assert.equal(await banner.locator('.overdue-title').textContent(), '3 tasks');
    assert.equal(await page.evaluate(() => localStorage.getItem('setpoint.overdueShown')), null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a task going overdue mid-use raises no banner, only its Today line, nor does input after idle minutes; the next arrival, the tab shown again, raises it with one that went overdue while away, and so does every return after a dismissal', async () => {
  // Pay rent at 9:15 AM and the lab report at 9:20 AM, just after the seed's 9:12 AM. The server's
  // clock holds; the page's is the check's, moved on in steps.
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      const timed = database.prepare('UPDATE items SET due_at = ? WHERE title = ?');
      timed.run('2026-10-07T16:15:00.000Z', 'Pay rent');
      timed.run('2026-10-07T16:20:00.000Z', 'CS 101 lab report');
    } finally {
      database.close();
    }
    const page = await setpoint.page('target');
    await page.clock.install();
    const loaded = page.waitForResponse(response => response.url().includes('/api/items?from=2026-09-07&to=2026-10-08'));
    await page.goto(`${setpoint.base}/inbox`);
    await drawn(page, await loaded);
    const payRent = page.locator('.sb .today-row', {hasText: 'Pay rent'}).locator('.t');
    await payRent.waitFor();
    await pauseClock(page);
    assert.equal(await payRent.getAttribute('class'), 't num');

    // Here throughout: past 9:15 AM, Pay rent's time turns, and no banner comes.
    await page.mouse.move(400, 300);
    await page.clock.fastForward(4 * 60_000);
    await until('Pay rent past its time', () => payRent.getAttribute('class'), names => names === 't num passed');
    await drawnTwice(page);
    assert.equal(await page.locator('.overdue').count(), 0);

    // Six minutes with no input, past 9:20 AM, then a move: time alone makes no arrival.
    await page.clock.fastForward(6 * 60_000);
    await page.mouse.move(420, 320);
    await drawnTwice(page);
    assert.equal(await page.locator('.overdue').count(), 0);

    // Away: the tab hidden. Nothing is drawn while it is.
    const tab = (state: 'hidden' | 'visible') => page.evaluate(shown => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => shown});
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => shown === 'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    await tab('hidden');
    await page.clock.fastForward(4 * 60_000);
    await drawnTwice(page);
    assert.equal(await page.locator('.overdue').count(), 0);

    // Back: the banner enters with both, the latest due first.
    await tab('visible');
    const banner = page.getByRole('dialog', {name: 'Overdue tasks'});
    await banner.waitFor();
    assert.equal(await banner.locator('.overdue-title').textContent(), '2 tasks');
    assert.deepEqual(await banner.locator('.overdue-list li').allTextContents(), ['CS 101 lab report9:20 AM', 'Pay rent9:15 AM']);

    // Dismissed, it lasts for this visit: the next return to the tab raises it again.
    await page.clock.fastForward(1000);
    await page.locator('.overdue[data-state="in"]').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.overdue[data-state="out"]').waitFor();
    await page.clock.fastForward(2000);
    await page.locator('.overdue').waitFor({state: 'detached'});
    await tab('hidden');
    await tab('visible');
    await banner.waitFor();
    assert.equal(await banner.locator('.overdue-title').textContent(), '2 tasks');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a snoozed task stays off the banner until its snooze ends, and comes back on the next arrival after it, not mid-use', async () => {
  const setpoint = await startSetpoint({fixtures: ['overdue-tasks'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.clock.install();
    const loaded = page.waitForResponse(response => response.url().includes('/api/items?from=2026-09-07&to=2026-10-08'));
    await page.goto(`${setpoint.base}/inbox`);
    await drawn(page, await loaded);
    const banner = page.getByRole('dialog', {name: 'Overdue tasks'});
    await banner.waitFor();
    await page.clock.fastForward(1000);
    await page.locator('.overdue[data-state="in"]').waitFor();
    const rows = banner.locator('.overdue-list li');

    // Call the landlord snoozed for an hour: it leaves, and the banner stays with the other two.
    await rows.filter({hasText: 'Call the landlord'}).getByRole('button', {name: 'Snooze'}).click();
    await page.getByRole('menuitem', {name: '1 hour'}).click();
    await page.clock.fastForward(1000);
    await until('the snoozed title gone', () => rows.allTextContents(), texts => texts.length === 2);
    assert.deepEqual(await rows.allTextContents(), ['Submit the parking permit formMon', 'Renew the library cardSep 24']);
    assert.equal(await banner.locator('.overdue-title').textContent(), '2 tasks');

    const tab = (state: 'hidden' | 'visible') => page.evaluate(shown => {
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => shown});
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => shown === 'hidden'});
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);
    const dismiss = async () => {
      await page.keyboard.press('Escape');
      await page.locator('.overdue[data-state="out"]').waitFor();
      await page.clock.fastForward(2000);
      await page.locator('.overdue').waitFor({state: 'detached'});
    };
    await dismiss();

    // A return within the hour: the other two alone.
    await page.clock.fastForward(30 * 60_000);
    await tab('hidden');
    await tab('visible');
    await banner.waitFor();
    assert.equal(await banner.locator('.overdue-title').textContent(), '2 tasks');
    await page.clock.fastForward(1000);
    await page.locator('.overdue[data-state="in"]').waitFor();
    await dismiss();

    // The hour ends mid-use: nothing comes until the next arrival, which brings all three.
    await page.clock.fastForward(31 * 60_000);
    await drawnTwice(page);
    assert.equal(await page.locator('.overdue').count(), 0);
    await tab('hidden');
    await tab('visible');
    await banner.waitFor();
    assert.equal(await banner.locator('.overdue-title').textContent(), '3 tasks');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('below 1600 px the sidebar starts as the rail with its next-up slot; [, its edge and ⌘K open and fold it, kept on reload; the pointer resting on it brings it out over the page', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // A MacBook's window, where the 1.075 zoom applies.
    const page = await setpoint.page({width: 1591, height: 900});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    const rail = page.locator('.sb.rail');
    const name = page.locator('.sb .sb-name');
    await rail.waitFor();
    assert.equal(await name.count(), 0);

    // The next-up slot, named in its tooltip, opens its item's card beside the rail.
    const slot = page.locator('.sb .next-up .today-row');
    const tip = (await slot.getAttribute('data-tip'))!;
    assert.match(tip, /^.+ · \d{1,2}:\d\d [AP]M · (in \d+[mh]|now)/);
    await slot.click();
    const card = page.locator('.today-card');
    await card.waitFor();
    assert.equal(await card.getAttribute('aria-label'), tip.split(' · ')[0]);
    const [sidebar, placed] = [(await rested(() => rail.boundingBox()))!, (await rested(() => card.boundingBox()))!];
    assert.ok(placed.x >= sidebar.x + sidebar.width, 'the card beside the rail, not over it');
    await page.keyboard.press('Escape');
    await until('the card closes', () => card.count(), count => count === 0);

    // [ opens it, kept on reload. Its edge folds it, kept too.
    await page.keyboard.press('`');
    await name.waitFor();
    assert.equal(await page.locator('.sb .next-up').count(), 0);
    await page.reload();
    await name.waitFor();
    await page.locator('.sb-edge').click();
    await rail.waitFor();
    await page.reload();
    await rail.waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('setpoint.sidebarRail')), 'rail');

    // ⌘K offers it, under Appearance with its key.
    await page.keyboard.press('Meta+k');
    const command = page.locator('.palette .item', {hasText: 'Open the sidebar'});
    assert.equal(await command.locator('.kbd').textContent(), '`');
    await page.keyboard.press('Escape');

    // Resting on the rail brings the whole sidebar out over the page, nothing under it moving. Off it, it folds back.
    const main = (await rested(() => page.locator('.main').boundingBox()))!;
    await page.mouse.move(sidebar.x + sidebar.width / 2, sidebar.y + sidebar.height - 120);
    await page.locator('.sb.peek').waitFor();
    await name.waitFor();
    assert.deepEqual(await rested(() => page.locator('.main').boundingBox()), main);
    await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2);
    await rail.waitFor();

    // At 1600 it starts open. Under 1100 it's always the rail, with no edge, and [ changes nothing kept.
    await page.evaluate(() => localStorage.removeItem('setpoint.sidebarRail'));
    await page.setViewportSize({width: 1600, height: 900});
    await page.reload();
    await name.waitFor();
    await page.setViewportSize({width: 1000, height: 900});
    await rail.waitFor();
    assert.equal(await page.locator('.sb-edge').count(), 0);
    await page.keyboard.press('`');
    await setpoint.idle();
    assert.deepEqual([await rail.count(), await page.evaluate(() => localStorage.getItem('setpoint.sidebarRail'))], [1, null]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('live updates: an email read elsewhere loses its dot and leaves the counts without a reload, staying in its day', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.row', {hasText: 'New sign-in'}).waitFor();
    const inbox = await setpoint.api<{groups: {rows: {id: number; subject: string}[]}[]}>('GET', '/mail/inbox');
    const signIn = inbox.groups.flatMap(group => group.rows).find(item => item.subject === 'Security alert')!;
    // Read in another client (Gmail's app would arrive the same way, through sync).
    await setpoint.api('POST', `/mail/messages/${signIn.id}/read`, {unread: false});
    await until('the sidebar follows', () => page.locator('.nav:has-text("Inbox") .ubadge').textContent(), text => text === '18');
    assert.equal((await setpoint.api<MailCountsOut>('GET', '/mail/counts')).unread, 18);
    // It stays in its day, read, then and after leaving the Inbox.
    const signInRow = page.locator('.row[data-key^="all:"]', {hasText: 'New sign-in'});
    await until('the dot goes', () => signInRow.getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    await page.keyboard.press('2');
    await page.waitForURL(/\/calendar/);
    await page.keyboard.press('1');
    await until('still in its day, read', () => signInRow.getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    // Done elsewhere drops Attention's count. The title counts unread.
    const google = inbox.groups.flatMap(group => group.rows).find(item => item.subject.startsWith('Your recovery email'))!;
    await setpoint.api('POST', `/mail/messages/${google.id}/done`, {done: true});
    await until('Attention\'s count drops', () => page.locator('.hd .ib-views .n').textContent(), text => text === '2');
    const unread = (await setpoint.api<MailCountsOut>('GET', '/mail/counts')).unread;
    await until('the title counts unread', () => page.title(), title => title === `(${unread}) Inbox`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
