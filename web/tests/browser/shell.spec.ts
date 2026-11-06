// The shell in the browser: signing in (claiming with a setup token, then the password, or a
// recovery code), the layout's fixed sizes (DESIGN.md › Layout) at the desktop size, no focus
// rings, the account filter, the page keys, the tab title, and live updates from a change made
// elsewhere.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {ItemsOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, describe, pagePx, PASSWORD, rested, SIZES, startSetpoint, test, until} from './harness.ts';

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
    // The recovery codes, once; then the app, at the address it was asked for.
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

test('the sign-in card answers: a refusal selects what was typed; Use a passkey leads while nothing is typed (the polish audit\'s states-14)', async () => {
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
    // Nothing typed: Use a passkey is the solid button and Sign in the ghost; a character
    // turns them back.
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

    // The new password is the password now; Back returns to it from the code.
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
  test('sidebar 248, header 56, reading pane 680 only while an email is open; the shell never scrolls; no focus rings', async () => {
    const setpoint = await startSetpoint();
    try {
      const page = await setpoint.page('target');
      await page.goto(`${setpoint.base}/inbox`);
      await page.locator('.list .row').first().waitFor();
      assert.equal((await box(page, '.sb')).width, 248);
      assert.equal((await box(page, '.hd')).height, 56);
      assert.equal(await page.locator('.pane').count(), 0, 'nothing open: the pane is collapsed and the list takes the width');
      assert.equal((await box(page, '.list')).width, pagePx(SIZES.target.width) - 248);
      await page.locator('.list .row:has(b[data-tip^="Final exam schedule"])').click();
      await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
      assert.equal((await box(page, '.pane')).width, 680);
      assert.equal((await box(page, '.list')).width, pagePx(SIZES.target.width) - 248 - 680);
      // Every row keeps its account while the pane is open (decision 41).
      for (const label of await page.locator('.list .row .ac').allTextContents()) assert.match(label, /Business|Personal|Work|Jobs|iCloud/);
      const scroll = await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.clientHeight, document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.deepEqual([scroll[0], scroll[2]], [scroll[1], scroll[3]]);
      // Focus on a control draws no ring.
      await page.locator('.rd-tools .tool').first().focus();
      const outline = await rested(() => page.locator('.rd-tools .tool').first().evaluate(element => getComputedStyle(element).outlineStyle));
      assert.equal(outline, 'none');
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
});

test('an account filters the Inbox; 1 and 2 go to Inbox and Calendar; the tab title follows', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    assert.equal(await page.title(), '(3) Inbox');
    await page.locator('.acct', {hasText: 'Jobs'}).click();
    await until('only Jobs mail', () => page.locator('.list .ac .label, .list .r1 .label').allTextContents(), labels => labels.length > 0 && labels.every(label => label === 'Jobs'));
    assert.equal(new URL(page.url()).search, '?account=4');
    // The counts stay every account's, once what the filter asked is answered and drawn.
    await setpoint.idle();
    assert.equal(await page.locator('.nav:has-text("Inbox") .cnt').textContent(), '19');
    await page.keyboard.press('2');
    await page.locator('.hd-title', {hasText: 'October 2026'}).waitFor();
    assert.equal(await page.title(), 'October 2026 · Calendar');
    await page.keyboard.press('1');
    await page.locator('.list .row').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox');
    // The Today block's lines open their card over the page (#78), not Calendar.
    await page.locator('.today-row', {hasText: 'Dentist'}).click();
    await page.locator('.today-card', {hasText: 'Dentist'}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('#78: the Today block names its tasks, tomorrow\'s under their own label (D460), and a line opens its card over the open email; E edits it on Calendar, not Trash', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row:has(b[data-tip^="Interview availability"])').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.length === 5);
    assert.deepEqual(await lines.allTextContents(), ['Dentist2:30 PM · in 5h', 'CS 101 lab report', 'Pay rent', 'CS 101 lecture6:00 PM', 'Renew car registration']);
    // D460: tomorrow's event and task sit under a label of their own.
    assert.deepEqual(await page.locator('.sb .today .sb-label').allTextContents(), ['Today', 'Tomorrow']);
    assert.equal(await page.locator('.sb .today > *').evaluateAll(children => children.findIndex(child => child.textContent === 'Tomorrow')), 4);

    // The card opens over the open email, which stays behind it; where it sits and its motion (which
    // reduce motion doesn't change, DESIGN.md › Principles) are by eye (D416, D417).
    await lines.filter({hasText: 'Renew car registration'}).click();
    const card = page.locator('.today-card');
    await card.locator('.fd-title', {hasText: 'Renew car registration'}).waitFor();
    assert.equal(new URL(page.url()).pathname.startsWith('/inbox/'), true);
    assert.deepEqual(await card.locator('.card-acts button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label') ?? button.textContent)),
      ['EditE', 'Complete', 'Open in Calendar', 'Delete']);
    // Another line moves the same card; Esc closes it and leaves the email open.
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

    // E on the card edits its item on Calendar; the open email isn't trashed.
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
    await until('the sidebar follows', () => page.locator('.nav:has-text("Inbox") .cnt').textContent(), text => text === '18');
    assert.equal((await setpoint.api<MailCountsOut>('GET', '/mail/counts')).unread, 18);
    // It stays in its day, read, then and after leaving the Inbox (D449).
    const signInRow = page.locator('.row[data-key^="all:"]', {hasText: 'New sign-in'});
    await until('the dot goes', () => signInRow.getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    await page.keyboard.press('2');
    await page.waitForURL(/\/calendar/);
    await page.keyboard.press('1');
    await until('still in its day, read', () => signInRow.getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    // Done elsewhere drops the pill and the title.
    const google = inbox.groups.flatMap(group => group.rows).find(item => item.subject.startsWith('Your recovery email'))!;
    await setpoint.api('POST', `/mail/messages/${google.id}/done`, {done: true});
    await until('the pill drops', () => page.locator('.apill').textContent(), text => text === '2');
    await until('the title follows', () => page.title(), title => title === '(2) Inbox');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
