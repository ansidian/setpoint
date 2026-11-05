// The phone feeling native (darma SV-66; DESIGN.md › Phone and Decided while building #137–#146), at
// 390 × 844 with touch: the reader's actions sharing the bar, the unread dot on an email marked
// unread, the reader over the list and back, search's way out, the tab bar, the safe-area insets and
// the theme colour, the list's type a step up, the agenda's today, now and chips, and the sign-in
// card clear of the keyboard. phone.spec.ts has board 21 and the phone's flows.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {InboxOut} from '@setpoint/shared';
import {deepLinkPath} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, drawn, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** The seed's emails by the start of their subject. */
async function email(setpoint: Setpoint, subject: string): Promise<number> {
  const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
  return inbox.groups.flatMap(group => group.rows).find(row => row.subject.startsWith(subject))!.id;
}

async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  return page;
}

/** A token's colour as the page computes it, to compare with an element's. */
const tokenColour = (page: Page, token: string) => page.evaluate(name => {
  const probe = document.body.appendChild(document.createElement('span'));
  probe.style.color = `var(--${name})`;
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

/** The reader's bottom bar: each action's label, width, label colour and weight, and icon colour. */
const actionBar = (page: Page) => page.locator('.ph-acts button').evaluateAll(buttons => buttons.map(button => ({
  label: button.textContent,
  width: Math.round(button.getBoundingClientRect().width),
  colour: getComputedStyle(button).color,
  weight: getComputedStyle(button).fontWeight,
  icon: getComputedStyle(button.querySelector('.icon')!).color,
})));

/** Computed styles of the first match. */
const styles = (page: Page, selector: string, names: string[]) => page.locator(selector).first().evaluate((element, keys) => {
  const style = getComputedStyle(element);
  return keys.map(key => style.getPropertyValue(key));
}, names);

test('the reader\'s actions share the bar evenly, Done leads in `good`, and none moves in as the email arrives', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // The deep links' emails, while they're in the Inbox: an FYI one read below leaves it.
    const links = [[await email(setpoint, 'Interview availability'), 'Interview availability', ['Done', 'Trash', 'Mark unread', 'Open in Gmail']], [await email(setpoint, 'Bill is ready'), 'Bill is ready', ['Trash', 'Mark unread']]] as const;
    const page = await inbox(setpoint);
    const colours = {ink: await rested(() => tokenColour(page, 'ink')), ink2: await rested(() => tokenColour(page, 'ink2')), good: await rested(() => tokenColour(page, 'good'))};
    // Attention mail: four, a quarter each of the bar's 374 px; Done's label `ink` 500 and its check `good`, the rest `ink2` under `ink` icons.
    await page.locator('.list .row[data-tip^="Final exam schedule"]').tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    const four = await rested(() => actionBar(page));
    assert.deepEqual(four.map(action => action.label), ['Done', 'Trash', 'Mark unread', 'Open in Gmail']);
    assert.deepEqual(four.map(action => action.width), [94, 94, 94, 94]);
    assert.deepEqual(four.map(action => [action.colour, action.weight, action.icon]), [
      [colours.ink, '500', colours.good], [colours.ink2, '400', colours.ink], [colours.ink2, '400', colours.ink], [colours.ink2, '400', colours.ink],
    ]);
    await page.locator('.ph-back').tap();

    // Gmail mail that isn't Attention: three, a third each, Trash leading (#93).
    await page.locator('.row', {hasText: 'Woodgrove Bank'}).tap();
    await page.locator('.rd-subj', {hasText: 'Statement ready'}).waitFor();
    assert.deepEqual((await rested(() => actionBar(page))).map(action => [action.label, action.width]), [['Trash', 125], ['Mark unread', 125], ['Open in Gmail', 125]]);
    await page.locator('.ph-back').tap();

    // iCloud mail: two, a half each, no Open in Gmail.
    await page.locator('.row', {hasText: 'Proseware'}).tap();
    await page.locator('.rd-subj', {hasText: 'Bill is ready'}).waitFor();
    assert.deepEqual((await rested(() => actionBar(page))).map(action => [action.label, action.width]), [['Trash', 187], ['Mark unread', 187]]);

    // A deep link while the email is on its way: the bar holds what it will show, or nothing, and
    // nothing moves along when the email arrives (Done once drew late and pushed the rest right).
    for (const [id, subject, labels] of links) {
      let release!: () => void;
      const held = new Promise<void>(resolve => (release = resolve));
      await page.route(`**/api/mail/messages/${id}`, async route => {
        await held;
        await route.continue();
      });
      const accounts = page.waitForResponse(response => new URL(response.url()).pathname === '/api/accounts');
      const going = page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id})}`);
      await page.locator('.pane .ph-acts').waitFor();
      await page.locator('.list .row').first().waitFor();
      // The email's row and its account known, the bar holds what it will show.
      await drawn(page, await accounts);
      const before = (await rested(() => actionBar(page))).map(action => action.label);
      assert.deepEqual(before, labels, 'before the email');
      release();
      await going;
      await page.locator('.rd-subj', {hasText: subject}).waitFor();
      assert.deepEqual((await rested(() => actionBar(page))).map(action => action.label), labels);
      await page.unroute(`**/api/mail/messages/${id}`);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// The dot's pop and its look are by eye (D416, D417).
test('Mark unread on the phone puts the unread dot before the subject; Mark read takes it away', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.list .row[data-tip^="Final exam schedule"]').tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    assert.equal(await page.locator('.rd-subj .rd-unread').count(), 0);
    // The first draw doesn't pop.
    assert.equal(await page.locator('.ph-acts .ph-swap').count(), 0);
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).waitFor();
    const dot = page.locator('.rd-subj .rd-unread');
    await dot.waitFor();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).waitFor();
    assert.equal(await dot.count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Which way the reader slides is phoneSlide's, a table in phone.test.ts; the slide itself is by eye
// (D416). Here, the list and the reader carry the names the slide draws them by.
test('the reader comes over the list and goes back to it, Done too, each named for the slide', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    assert.deepEqual(await rested(() => styles(page, '.content > .list', ['view-transition-name'])), ['ph-list']);
    await page.locator('.list .row[data-tip^="Final exam schedule"]').tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    assert.deepEqual(await rested(() => styles(page, '.pane', ['view-transition-name'])), ['ph-reader']);
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    // Done goes back to the list, where its row folds away.
    await page.locator('.list .row[data-tip^="Final exam schedule"]').tap();
    await page.locator('.ph-acts .ph-done').tap();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('phone search: a clear button where the hint was, no Mark all as read meanwhile, and Back to Search from a result', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const markAll = page.locator('.hd button[aria-label="Mark all as read"]');
    await page.locator('.list .row[data-tip^="Interview availability"]').tap();
    assert.equal(await page.locator('.ph-back').textContent(), 'Inbox');
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);

    await page.locator('.search input').tap();
    await page.keyboard.type('northwind');
    await page.locator('.search-list .result').first().waitFor();
    // The way out, where the desktop's Esc hint is: 32 px round, an 18 px `close` in `ink3`, 4 px in
    // from the field's border (8 px into its 12 px padding).
    const clear = page.locator('.search .search-clear');
    const [field, button, icon] = [await rested(() => page.locator('.hd > .search').boundingBox()), await rested(() => clear.boundingBox()), await rested(() => clear.locator('svg').boundingBox())];
    assert.deepEqual([button!.width, button!.height, icon!.width, Math.round(field!.x + field!.width - 1 - (button!.x + button!.width))], [32, 32, 18, 4]);
    assert.deepEqual(await rested(() => styles(page, '.search .search-clear', ['color', 'border-radius'])), [await rested(() => tokenColour(page, 'ink3')), '999px']);
    assert.equal(await page.locator('.search .kbd').count(), 0);
    // Mark all as read would read the hidden Inbox's mail, not the results: it's gone while searching.
    assert.equal(await markAll.count(), 0);
    // An email from the results goes back to them.
    await page.locator('.search-list .result', {hasText: 'Interview availability'}).tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.equal(await page.locator('.ph-back').textContent(), 'Search');
    await page.locator('.ph-back').tap();
    await until('back at the results', () => page.locator('.pane').count(), count => count === 0);
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.ok(await page.locator('.search-list .result').first().isVisible());
    // One tap leaves search: the field empties and lets go, and the Inbox and Mark all as read come back.
    await clear.tap();
    await page.locator('.content > .list .gh').first().waitFor();
    assert.equal(await page.locator('.search input').inputValue(), '');
    assert.equal(await page.locator('.hd-title').textContent(), 'Inbox');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
    assert.equal(await clear.count(), 0);
    await markAll.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// A tap on the current tab scrolling its list back to the top is by eye (D416).
test('the tab bar: the current tab filled, and Inbox badged while Attention waits on another page', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const glyph = (label: string) => page.locator('.ph-tab', {hasText: label}).locator('svg path').getAttribute('d');
    const badge = page.locator('.ph-tab', {hasText: 'Inbox'}).locator('.ph-badge');
    assert.deepEqual([await glyph('Inbox'), await glyph('Agenda')], [ICONS['inbox-fill'], ICONS.calendar_today]);
    // The Inbox's header has the pill: no badge there.
    assert.equal(await badge.count(), 0);
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    assert.deepEqual([await glyph('Inbox'), await glyph('Agenda')], [ICONS.inbox, ICONS['calendar_today-fill']]);
    // The header's pill, shrunk: the attention count, a 16 px `caution` pill with `onInk` 10.5 / 600
    // figures, 8 px from the top and 6 px right of the tab's middle, in a 2 px `panel` ring.
    assert.equal(await badge.textContent(), '3');
    const [tab, pill] = [await rested(() => page.locator('.ph-tab', {hasText: 'Inbox'}).boundingBox()), await rested(() => badge.boundingBox())];
    assert.deepEqual([pill!.height, pill!.y - tab!.y, pill!.x - (tab!.x + tab!.width / 2)], [16, 8, 6]);
    assert.deepEqual(await rested(() => styles(page, '.ph-badge', ['background-color', 'color', 'font-size', 'font-weight', 'font-variant-numeric', 'box-shadow'])),
      [await rested(() => tokenColour(page, 'caution')), await rested(() => tokenColour(page, 'onInk')), '10.5px', '600', 'tabular-nums', `${await rested(() => tokenColour(page, 'panel'))} 0px 0px 0px 2px`]);
    // It follows the count.
    await setpoint.api('POST', `/mail/messages/${await email(setpoint, 'Final exam')}/done`, {done: true});
    await until('the badge follows', () => badge.textContent(), text => text === '2');
    // A later week's agenda: its tab goes back to today's.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-20'})}`);
    await until('the agenda starts on the day', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 20 – 27');
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await until('today\'s agenda', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 7 – 14');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone reaches the screen\'s edges by its insets, and Safari\'s bars take the drawn theme\'s page colour', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    assert.match((await page.locator('meta[name="viewport"]').getAttribute('content'))!, /viewport-fit=cover/);
    const tint = page.locator('meta[name="theme-color"]');
    assert.deepEqual([await tint.count(), await tint.getAttribute('content')], [1, '#050506']);
    // In a browser tab there's no inset: 6 px under the labels, the bars 54 and 58 px.
    const bars = async () => [await styles(page, '.app', ['padding-top']), await styles(page, '.ph-tabs', ['min-height', 'padding-bottom', 'height'])];
    assert.deepEqual(await rested(() => bars()), [['0px'], ['54px', '6px', '54px']]);
    await page.locator('.list .row[data-tip^="Final exam schedule"]').tap();
    await page.locator('.rd-subj').waitFor();
    assert.deepEqual(await rested(() => styles(page, '.ph-acts', ['min-height', 'padding-bottom', 'height'])), ['58px', '6px', '58px']);
    // As a Home Screen app on an iPhone: 47 px for the status bar, 34 for the home indicator.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 47, bottom: 34}});
    await until('the reader keeps clear of both', () => Promise.all([styles(page, '.pane', ['padding-top']), styles(page, '.ph-acts', ['padding-bottom'])]),
      value => JSON.stringify(value) === '[["47px"],["34px"]]');
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    assert.deepEqual((await rested(() => bars())).map(values => values.slice(0, 2)), [['47px'], ['54px', '34px']]);
    // The theme drawn, not the system's: Light's page once the browser prefers light (System).
    await page.emulateMedia({colorScheme: 'light'});
    await until('Light\'s page colour', () => tint.getAttribute('content'), value => value === '#f6f6f4');
    assert.equal(await tint.count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone\'s list reads a step up: rows 15, ages and accounts 13, bands 12, search\'s rows too', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const ink3 = await rested(() => tokenColour(page, 'ink3'));
    assert.deepEqual(await rested(() => styles(page, '.row .from', ['font-size'])), ['15px']);
    assert.deepEqual(await rested(() => styles(page, '.row', ['min-height', 'row-gap'])), ['62px', '3px']);
    assert.deepEqual(await rested(() => styles(page, '.row .age', ['font-size', 'color'])), ['13px', ink3]);
    assert.deepEqual(await rested(() => styles(page, '.row .ac', ['font-size', 'color'])), ['13px', ink3]);
    assert.deepEqual(await rested(() => styles(page, '.gh', ['font-size', 'height'])), ['12px', '30px']);
    assert.deepEqual(await rested(() => styles(page, '.code-line .copy', ['height', 'font-size', 'padding-left', 'padding-right'])), ['30px', '13px', '10px', '10px']);
    // The unread dot stays level with the larger first line.
    const [dot, from] = await rested(() => page.locator('.list .row.unread').first().evaluate(row => [row.querySelector('.ud')!, row.querySelector('.from')!].map(part => {
      const box = part.getBoundingClientRect();
      return box.top + box.height / 2;
    })));
    assert.ok(Math.abs(dot! - from!) <= 1, 'the dot is level with the sender');
    await page.locator('.search input').tap();
    await page.keyboard.type('northwind');
    await page.locator('.search-list .result').first().waitFor();
    assert.deepEqual(await rested(() => styles(page, '.search-list .result .r1 .age', ['font-size'])), ['13px']);
    // A why line shows only what a row doesn't (search-11), so here none does: one put in a result reads it.
    assert.deepEqual(await rested(() => page.locator('.search-list .result').first().evaluate(row => {
      const why = row.appendChild(document.createElement('div'));
      why.className = 'why';
      const size = getComputedStyle(why).fontSize;
      why.remove();
      return [size];
    })), ['13px']);
    assert.deepEqual(await rested(() => styles(page, '.search-list .result .l2', ['font-size'])), ['15px']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the agenda marks today and now, draws events as their calendar\'s chips, and keeps each day\'s head in view', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    const [ink, ink3, alert] = [await rested(() => tokenColour(page, 'ink')), await rested(() => tokenColour(page, 'ink3')), await rested(() => tokenColour(page, 'alert'))];
    // "Today" in `ink` 500, then its date as every day's, `ink3` 400.
    assert.deepEqual(await styles(page, '.pday.today .pd-today', ['color', 'font-weight']), [ink, '500']);
    assert.deepEqual(await rested(() => styles(page, '.pday.today', ['color', 'font-weight'])), [ink3, '400']);
    assert.equal(await page.locator('.pday .pd-today').count(), 1);
    // Now, at the seed's 9:12 AM, between the past Gym and the Dentist.
    const today = page.locator('.ph-agenda [data-days="2026-10-07"]');
    assert.deepEqual(await today.locator(':scope > :not(.pday)').evaluateAll(lines => lines.map(line => (line.classList.contains('ph-now') ? `now ${line.textContent}` : line.querySelector('.ell')!.firstChild!.textContent))),
      ['Gym', 'now 9:12 AM', 'Dentist', 'CS 101 lab report', 'Pay rent']);
    assert.equal(await page.locator('.ph-now').count(), 1);
    // The right pane's now-line: 16 px; the time `alert` 12 / 500 in the 96 px time column; a 7 px
    // `alert` dot on the marks' column, centred on the tasks' rings; a 1 px `alert` line at .7 from
    // the titles' column.
    const now = await rested(() => page.locator('.ph-now').evaluate(row => {
      const [time, dot, line] = [row.querySelector('.t')!, row.querySelector('.dot')!, row.querySelector('.line')!];
      const box = (element: Element) => element.getBoundingClientRect();
      const style = (element: Element) => getComputedStyle(element);
      return {
        height: box(row).height,
        time: [box(time).width, style(time).color, style(time).fontSize, style(time).fontWeight, style(time).fontVariantNumeric],
        dot: [box(dot).width, box(dot).height, style(dot).backgroundColor, box(dot).left + box(dot).width / 2],
        line: [box(line).height, style(line).backgroundColor, style(line).opacity, box(line).left],
      };
    }));
    const task = page.locator('.pitem', {hasText: 'Pay rent'});
    const [ring, title] = [(await rested(() => task.locator('.mk').boundingBox()))!, (await rested(() => task.locator('.ell').boundingBox()))!];
    assert.deepEqual(now, {
      height: 16, time: [96, alert, '12px', '500', 'tabular-nums'],
      dot: [7, 7, alert, ring.x + ring.width / 2], line: [1, alert, '0.7', title.x],
    });
    // Events are their calendar's chips, as on the grids: its tint and 3 px bar, radius 6, 34 px in a
    // 42 px line, the title level with a task's; past ones at .55; tasks keep their ring.
    const chip = page.locator('.pitem.chip', {hasText: 'Dentist'}).locator('.ell');
    assert.equal(await page.locator('.ph-agenda .cbar').count(), 0);
    assert.deepEqual(await rested(() => chip.evaluate(element => {
      const style = getComputedStyle(element);
      return [element.getBoundingClientRect().height, style.borderRadius, style.paddingLeft, style.boxShadow.endsWith('3px 0px 0px 0px inset'), style.backgroundColor !== 'rgba(0, 0, 0, 0)', style.opacity];
    })), [34, '6px', '25px', true, true, '1']);
    assert.deepEqual(await rested(() => styles(page, '.pitem.chip.past .ell', ['opacity'])), ['0.55']);
    const words = (cell: typeof chip) => cell.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild!);
      return range.getBoundingClientRect().left;
    });
    assert.equal(await rested(() => words(chip)), await rested(() => words(task.locator('.ell'))));
    assert.ok(await task.locator('.ring').isVisible());
    assert.deepEqual(await rested(() => styles(page, '.ph-agenda .pday', ['position', 'top', 'z-index'])), ['sticky', '0px', '1']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone the sign-in card sits 18% from the top, clear of the keyboard, and so does the mark when Setpoint can\'t be reached', async () => {
  const setpoint = await startSetpoint({claim: false});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    await page.getByLabel('Setup token').waitFor();
    // 18vh, to the 1/64 px layout rounds to.
    const near = (y: number) => Math.abs(y - 844 * 0.18) < 0.05;
    assert.ok(near((await rested(() => page.locator('.sign-in').boundingBox()))!.y), 'the card');
    const boot = await setpoint.page('iphone');
    await boot.route('**/api/me', route => route.fulfill({status: 502, contentType: 'text/html', body: '<html><body>Bad Gateway</body></html>'}));
    await boot.goto(`${setpoint.base}/inbox`);
    await boot.locator('.boot .offline-pill').waitFor();
    assert.ok(near((await rested(() => boot.locator('.boot svg.mark').boundingBox()))!.y), 'the mark');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
