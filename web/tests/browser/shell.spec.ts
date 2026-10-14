// The shell in the browser: signing in (claiming with a setup token, then the password, or a
// recovery code), the layout's fixed sizes (DESIGN.md › Layout) at both desktop sizes, no focus
// rings, the account filter, the page keys, the tab title, and live updates from a change made
// elsewhere.
import assert from 'node:assert/strict';
import {after, describe, test} from 'node:test';
import type {ItemsOut, MailCountsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, SIZES, startSetpoint, until} from './harness.ts';
import type {SizeName} from './harness.ts';

after(cleanUp);

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

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
    const top = async () => (await page.locator('.sign-in').boundingBox())!.y;
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

test('the sign-in card answers: a refusal shakes it once over 260 ms and selects what was typed; Use a passkey leads while nothing is typed; signed in, it scales away as the app fades in (the polish audit\'s states-14)', async () => {
  const setpoint = await startSetpoint();
  try {
    const port = new URL(setpoint.base).port;
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
    // The brand: the mark at 24, the name 15 / 600.
    assert.deepEqual(await card.locator('.brand').evaluate(brand => [brand.querySelector('.mark')!.getBoundingClientRect().width, getComputedStyle(brand).fontSize, getComputedStyle(brand).fontWeight]), [24, '15px', '600']);
    // In Night the card's shadow reads as depth on the near-black page.
    assert.equal(await card.evaluate(element => getComputedStyle(element).boxShadow), 'rgba(0, 0, 0, 0.6) 0px 30px 80px 0px');
    // Nothing typed: Use a passkey is the solid button, with its glyph, and Sign in the ghost; a character
    // turns them back.
    const kinds = async () => [await passkey.getAttribute('class'), await signIn.getAttribute('class')];
    assert.deepEqual(await kinds(), ['btn', 'btn ghost']);
    assert.deepEqual(await passkey.locator('.icon').evaluate(icon => [icon.getAttribute('width'), icon.querySelector('path')!.getAttribute('d')]), ['16', ICONS.passkey]);
    // Three don't fit the card's row: Use a recovery code goes under the other two, inside the card.
    assert.deepEqual(await card.evaluate(element => {
      const box = element.getBoundingClientRect();
      const [main, , recovery] = [...element.querySelectorAll('.sign-in-foot .btn')].map(button => button.getBoundingClientRect());
      return [[...element.querySelectorAll('.sign-in-foot .btn')].every(button => button.getBoundingClientRect().left >= box.left && button.getBoundingClientRect().right <= box.right), recovery!.top > main!.bottom];
    }), [true, true]);
    await page.getByLabel('Password').press('a');
    await until('Sign in leads again', kinds, classes => classes.join() === 'btn ghost,btn');
    await page.getByLabel('Password').press('Backspace');
    await until('Use a passkey leads', kinds, classes => classes.join() === 'btn,btn ghost');

    // A wrong password: the line, one shake (0 → −6 → 5 → −3 → 0 px over 260 ms, the modal's timing), and
    // what was typed selected, so typing replaces it.
    await page.evaluate(() => {
      const shakes: {keyframes: unknown; options: unknown}[] = [];
      (window as unknown as {shakes: typeof shakes}).shakes = shakes;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (this.classList.contains('sign-in')) shakes.push({keyframes, options});
        return animate.call(this, keyframes, options);
      };
    });
    await page.getByLabel('Password').fill('not the password');
    await page.keyboard.press('Enter');
    await page.locator('.sign-in-line.failed', {hasText: 'Wrong password'}).waitFor();
    assert.deepEqual(await page.evaluate(() => (window as unknown as {shakes: unknown[]}).shakes), [{
      keyframes: [0, -6, 5, -3, 0].map(x => ({translate: `${x}px 0`})),
      options: {duration: 260, easing: 'cubic-bezier(.2,0,0,1)'},
    }]);
    assert.deepEqual(await page.getByLabel('Password').evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd, input.value.length]), [0, 16, 16]);
    await page.keyboard.type(`browser checks only ${port}`);
    assert.equal(await page.getByLabel('Password').inputValue(), `browser checks only ${port}`, 'typing replaced it');

    // Signed in: the card scales to .98 and fades over 180 ms while the app fades in under it, then goes.
    await page.evaluate(() => {
      const seen: string[][] = [];
      (window as unknown as {leaving: string[][]}).leaving = seen;
      const observer = new MutationObserver(() => {
        const leaving = document.querySelector('.sign-in-page.leaving');
        const app = document.querySelector('#root > .app');
        if (!leaving || !app || seen.length) return;
        const style = getComputedStyle(leaving.querySelector('.sign-in')!);
        seen.push([style.animationName, style.animationDuration], [getComputedStyle(app).animationName, getComputedStyle(app).animationDuration]);
      });
      observer.observe(document.getElementById('root')!, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
    });
    await page.keyboard.press('Enter');
    await page.locator('.list .row').first().waitFor();
    await until('the card gone', () => page.locator('.sign-in').count(), count => count === 0);
    assert.deepEqual(await page.evaluate(() => (window as unknown as {leaving: string[][]}).leaving), [['sign-in-out', '0.18s'], ['sign-in-app', '0.18s']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('in Light the sign-in card keeps the modal\'s shadow (states-14 deepens Night\'s only)', async () => {
  const setpoint = await startSetpoint({claim: false});
  try {
    const page = await setpoint.page('target');
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto(`${setpoint.base}/inbox`);
    const card = page.locator('.sign-in');
    await page.getByLabel('Setup token').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    assert.equal(await card.evaluate(element => getComputedStyle(element).boxShadow), 'rgba(15, 20, 28, 0.18) 0px 30px 80px 0px');
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

for (const size of ['target', 'large'] as SizeName[]) {
  describe(`the shell at ${SIZES[size].width} × ${SIZES[size].height}`, () => {
    test('sidebar 248, header 56, reading pane 680 only while an email is open; the shell never scrolls; no focus rings', async () => {
      const setpoint = await startSetpoint();
      try {
        const page = await setpoint.page(size);
        await page.goto(`${setpoint.base}/inbox`);
        await page.locator('.list .row').first().waitFor();
        assert.equal((await box(page, '.sb')).width, 248);
        assert.equal((await box(page, '.hd')).height, 56);
        assert.equal(await page.locator('.pane').count(), 0, 'nothing open: the pane is collapsed and the list takes the width');
        assert.equal((await box(page, '.list')).width, SIZES[size].width - 248);
        await page.locator('.list .row[title^="Final exam schedule"]').click();
        await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
        assert.equal((await box(page, '.pane')).width, 680);
        assert.equal((await box(page, '.list')).width, SIZES[size].width - 248 - 680);
        // Every row keeps its account while the pane is open (decision 41).
        for (const label of await page.locator('.list .row .ac').allTextContents()) assert.match(label, /Business|Personal|Work|Jobs|iCloud/);
        const scroll = await page.evaluate(() => [document.documentElement.scrollHeight, document.documentElement.clientHeight, document.documentElement.scrollWidth, document.documentElement.clientWidth]);
        assert.deepEqual([scroll[0], scroll[2]], [scroll[1], scroll[3]]);
        // Focus on a control draws no ring.
        await page.locator('.rd-tools .tool').first().focus();
        const outline = await page.locator('.rd-tools .tool').first().evaluate(element => getComputedStyle(element).outlineStyle);
        assert.equal(outline, 'none');
        assert.deepEqual(setpoint.pageErrors, []);
      } finally {
        await setpoint.stop();
      }
    });
  });
}

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
    // The counts stay every account's.
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

test('#78: the Today block names its tasks, and a line opens its card over the open email; E edits it on Calendar, not Trash', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    // Reduce motion changes nothing (DESIGN.md › Principles): the card still opens with its motion.
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row[title^="Interview availability"]').click();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.length === 4);
    assert.deepEqual(await lines.allTextContents(), ['2:30 PMDentistin 5h', 'CS 101 lab report', 'Pay rent', 'Renew car registrationTomorrow']);

    // The card sits 8 px right of the sidebar, level with its line; the email stays open behind it.
    await lines.filter({hasText: 'Renew car registration'}).click();
    const card = page.locator('.today-card');
    await card.locator('.fd-title', {hasText: 'Renew car registration'}).waitFor();
    assert.equal(await card.evaluate(element => getComputedStyle(element).animationName), 'today-card-in');
    assert.equal(new URL(page.url()).pathname.startsWith('/inbox/'), true);
    assert.equal(Math.round((await box(page, '.today-card')).x), Math.round((await box(page, '.sb')).width) + 8);
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
    const counts = await setpoint.api<MailCountsOut>('GET', '/mail/counts');
    assert.equal(counts.attention, 3);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a Today task\'s ring shows the done check for 360 ms before its line folds away, a double-click completes only it, and Undo unfolds it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    const lines = page.locator('.sb .today-row');
    await until('the Today block', () => lines.allTextContents(), texts => texts.length === 4);
    // Pay rent's line from the press on, in the page's time: too quick to read after each step.
    await page.evaluate(() => {
      const block = document.querySelector('.sb .today')!;
      const log: {at: number; state: string}[] = [];
      (window as unknown as {rent: typeof log}).rent = log;
      const note = (state: string) => {
        if (log.at(-1)?.state !== state) log.push({at: performance.now(), state});
      };
      document.addEventListener('pointerdown', () => note('pressed'), {capture: true, once: true});
      new MutationObserver(() => {
        const line = [...block.querySelectorAll('.today-row')].find(row => row.textContent === 'Pay rent');
        if (!line) return note('gone');
        if (line.classList.contains('leaving')) return note('folding');
        if (line.classList.contains('completing')) {
          // Its title goes ink3 over 180 ms (motion-04), so it's read where the transition ends.
          const title = line.querySelector<HTMLElement>('.title')!;
          const check = line.querySelector('.task-glyph.done');
          const ending = title.getAnimations().find(animation => (animation as CSSTransition).transitionProperty === 'color');
          const to = ending ? String(((ending.effect as KeyframeEffect).getKeyframes().at(-1) as {color?: string}).color) : getComputedStyle(title).color;
          return note(`done: ${check ? getComputedStyle(check).color : 'no check'}, ${getComputedStyle(title).textDecorationLine} in ${to}`);
        }
        // Back from Undo: its height opens (app/fold.ts), not a hover's transition.
        return note(line.getAnimations().some(animation => animation.constructor === Animation) ? 'unfolding' : 'open');
      }).observe(block, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style']});
    });
    const [good, ink3] = await page.evaluate(() => ['--good', '--ink3'].map(token => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = `var(${token})`;
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }));
    const log = () => page.evaluate(() => (window as unknown as {rent: {at: number; state: string}[]}).rent);

    await lines.filter({hasText: 'Pay rent'}).getByRole('button', {name: 'Complete Pay rent'}).dblclick();
    await until('Pay rent folded away', log, seen => seen.at(-1)?.state === 'gone');
    const seen = await log();
    assert.deepEqual(seen.map(step => step.state), ['pressed', `done: ${good}, line-through in ${ink3}`, 'folding', 'gone']);
    const [pressed, done, folding, gone] = seen.map(step => step.at) as [number, number, number, number];
    assert.ok(folding - pressed >= 360, `the done check showed for ${Math.round(folding - done)} ms`);
    assert.ok(gone - folding >= 179, `the line folded over ${Math.round(gone - folding)} ms`);
    await page.locator('.toast', {hasText: 'Completed Pay rent'}).waitFor();
    // The second click completed nothing more.
    await setpoint.idle();
    const tasks = async () => (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-07&to=2026-10-09')).items.filter(item => item.kind === 'task');
    await until('the completion lands', tasks, list => list.every(task => !task.command));
    assert.deepEqual((await tasks()).map(task => [task.title, task.done]).sort(), [['CS 101 lab report', false], ['Pay rent', true], ['Renew car registration', false]]);
    assert.deepEqual(await lines.allTextContents(), ['2:30 PMDentistin 5h', 'CS 101 lab report', 'Renew car registrationTomorrow']);

    // Undo unfolds it where it was.
    await page.mouse.move(800, 600);
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await until('Pay rent back', log, steps => steps.at(-1)?.state === 'open');
    assert.deepEqual((await log()).slice(4).map(step => step.state), ['unfolding', 'open']);
    assert.deepEqual(await lines.allTextContents(), ['2:30 PMDentistin 5h', 'CS 101 lab report', 'Pay rent', 'Renew car registrationTomorrow']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('live updates: an email read elsewhere loses its dot and leaves the counts without a reload, and the Inbox with the visit', async () => {
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
    // New keeps it in its place, read, until the user leaves the Inbox (2026-10-09, #243).
    const signInRow = page.locator('.row[data-key^="new:"]', {hasText: 'New sign-in'});
    await until('the dot goes', () => signInRow.getAttribute('class'), classes => !classes!.split(' ').includes('unread'));
    await page.keyboard.press('2');
    await page.waitForURL(/\/calendar/);
    await page.keyboard.press('1');
    await until('it leaves with the visit', () => signInRow.count(), count => count === 0);
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
