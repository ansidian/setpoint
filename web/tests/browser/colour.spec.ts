// Colour's roles and Light (the polish audit, darma SV-58; DESIGN.md › Tokens › Colour and Decided while
// building #120–#139): each single value stated once, in the theme it's about, and the states the
// audit found invisible in Light (the cursor on a folded group) read from the screen itself.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {inflateSync} from 'node:zlib';
import type {Locator, Page} from 'playwright-core';
import {cleanUp, collapseGroups, point, startSetpoint, until} from './harness.ts';

after(cleanUp);

/** A colour as the page computes it, to compare with a computed style. */
const colourOf = (page: Page, colour: string) => page.evaluate(value => {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, colour);

/** A background as the page computes it, mixes included. */
const backgroundOf = (page: Page, background: string) => page.evaluate(value => {
  const probe = document.createElement('div');
  probe.style.background = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return computed;
}, background);

const style = (target: Locator, property: 'color' | 'backgroundColor' | 'boxShadow' | 'borderTopColor' | 'opacity' | 'transform' | 'marginLeft' | 'filter') =>
  target.evaluate((element, name) => getComputedStyle(element)[name], property);

/** The colour the screen shows at a point of the page, [r, g, b]: a 1 px screenshot's first pixel. */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const png = await page.screenshot({clip: {x: Math.round(x), y: Math.round(y), width: 1, height: 1}, animations: 'disabled', caret: 'hide'});
  // A PNG's chunks after its 8-byte signature; the first pixel of the first row is stored as is
  // whatever its row's filter, so it's the inflated data's bytes after the filter byte.
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const data = inflateSync(Buffer.concat(idat));
  return [data[1]!, data[2]!, data[3]!];
}

/** WCAG's contrast between two colours the screen shows. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (rgb: [number, number, number]) => {
    const [r, g, b2] = rgb.map(channel => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** A blank point inside an element: its middle, a little left of its right edge. */
async function blank(target: Locator, fromRight = 80): Promise<[number, number]> {
  const box = (await target.boundingBox())!;
  return [box.x + box.width - fromRight, box.y + box.height / 2];
}

/** The Inbox in a theme, its first rows and the Today block in. */
async function inbox(page: Page, base: string, theme: 'night' | 'light') {
  await page.emulateMedia({colorScheme: theme === 'light' ? 'light' : 'dark'});
  await page.goto(`${base}/inbox`);
  await page.locator('.arow').first().waitFor();
  await page.locator('.today-row').first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
}

for (const theme of ['night', 'light'] as const) {
  test(`${theme}: J onto a folded group lays the cursor's sub2 over its band, which shows (#121)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await inbox(page, setpoint.base, theme);
      await collapseGroups(page, ['Deliveries']);
      const deliveries = page.locator('.list .gh', {hasText: 'Deliveries'});
      await page.mouse.move(1, 1);
      const [x, y] = await blank(deliveries, 240);
      const band = await pixel(page, x, y);
      for (let step = 0; step < 20 && !(await deliveries.evaluate(header => header.classList.contains('cur'))); step++) await page.keyboard.press('j');
      await until('the cursor on Deliveries', () => deliveries.getAttribute('class'), names => Boolean(names?.split(' ').includes('cur')));
      // The cursor's fill fades in over 120 ms; it's read once it has.
      const cursor = await until('the cursor drawn', () => pixel(page, x, y), shown => contrast(shown, band) > 1.1);
      // Night lightens the band and Light darkens it, as a cursor row does the page.
      const lighter = (one: number[], other: number[]) => one.reduce((sum, channel) => sum + channel, 0) > other.reduce((sum, channel) => sum + channel, 0);
      assert.equal(lighter(cursor, band), theme === 'night', `${theme}: the cursor ${theme === 'night' ? 'lightens' : 'darkens'} the band`);
      assert.ok(contrast(cursor, band) >= (theme === 'night' ? 1.18 : 1.12), `the cursor shows against its band: ${contrast(cursor, band).toFixed(2)}:1`);
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}

test('the ink ladder and the panel: Night ink3 #7d7f84 and panel #0b0c0e; Light ink2 #4b4d52, and its toast on white (#120, #121)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await inbox(page, setpoint.base, 'night');
    assert.equal(await style(page.locator('.arow .r1 .age').first(), 'color'), 'rgb(125, 127, 132)', 'Night ink3: an age');
    assert.equal(await style(page.locator('aside.sb'), 'backgroundColor'), 'rgb(11, 12, 14)', 'Night panel: the sidebar');

    await inbox(page, setpoint.base, 'light');
    const read = page.locator('.arow:not(.unread)', {hasText: 'Contoso University'});
    assert.equal(await style(read.locator('.from'), 'color'), 'rgb(75, 77, 82)', 'Light ink2: a read sender');
    assert.equal(await style(read.locator('.l3'), 'color'), await colourOf(page, 'var(--ink3)'), 'its summary stays ink3');
    // Done from the cursor: the toast floats on white above the page's header.
    await point(page.locator('.arow', {hasText: 'Northwind Talent'}));
    await page.keyboard.press('h');
    const toast = page.locator('.toast');
    await toast.waitFor();
    assert.equal(await style(toast, 'backgroundColor'), 'rgb(255, 255, 255)', 'Light\'s toast is white');
    assert.equal(await colourOf(page, 'var(--cardOn)'), 'rgb(255, 255, 255)', 'Light cardOn');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** October 2026 on Calendar in a theme, the grid and its forecast in. */
async function calendar(page: Page, base: string, theme: 'night' | 'light') {
  await page.emulateMedia({colorScheme: theme === 'light' ? 'light' : 'dark'});
  await page.goto(`${base}/calendar`);
  await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
  await page.locator('.cell[data-date="2026-10-13"] .wx').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
  await page.mouse.move(1000, 28);
}

/** A blank point low in a day's cell, under its items. */
async function inCell(page: Page, date: string): Promise<[number, number, number]> {
  const box = (await page.locator(`.cell[data-date="${date}"]`).boundingBox())!;
  return pixel(page, box.x + box.width / 2, box.y + box.height - 12);
}

for (const theme of ['night', 'light'] as const) {
  test(`${theme}: weekends sit back and the days outside the month further, an outside weekend as an outside day; past items and days turn grey; Light's chip text is capped at .43 (#122–#124)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await calendar(page, setpoint.base, theme);
      // Tue Oct 6 (a weekday in the month), Sat Oct 3, Mon Sep 28 and Sun Sep 27 (outside it).
      const weekday = await inCell(page, '2026-10-06');
      const weekend = await inCell(page, '2026-10-03');
      const outside = await inCell(page, '2026-09-28');
      const outsideWeekend = await inCell(page, '2026-09-27');
      assert.ok(contrast(weekend, weekday) >= 1.02, `a weekend shows: ${contrast(weekend, weekday).toFixed(3)}:1`);
      assert.ok(contrast(outside, weekday) > contrast(weekend, weekday) + 0.01, `outside the month recedes further: ${contrast(outside, weekday).toFixed(3)}:1`);
      assert.deepEqual(outsideWeekend, outside, 'an outside weekend takes the outside shading');
      assert.equal(await style(page.locator('.cell[data-date="2026-10-03"]'), 'backgroundColor'), await colourOf(page, 'var(--dayOff)'));
      assert.equal(await style(page.locator('.cell[data-date="2026-09-27"]'), 'backgroundColor'), await colourOf(page, 'var(--dayOut)'));

      // 7 AM Gym is over; Dentist at 2:30 PM is ahead, in Personal's cool, capped at .43 in Light.
      const chip = (title: string) => page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: title});
      const ink3 = await colourOf(page, 'var(--ink3)');
      const ahead = await colourOf(page, theme === 'light' ? 'oklch(0.43 0.12 235)' : 'var(--cool)');
      assert.equal(await style(chip('Gym'), 'color'), ink3, 'a past item is ink3');
      assert.equal(await style(chip('Gym'), 'opacity'), '1', 'at full strength');
      assert.equal(await style(chip('Dentist'), 'color'), ahead);
      // Classes' cyan sits at 182°, lighter than Personal's cool (#125).
      assert.equal(await style(page.locator('.cell[data-date="2026-10-08"] .ev', {hasText: 'CS 101 lecture'}), 'color'),
        await colourOf(page, theme === 'light' ? 'oklch(0.43 0.1 182)' : 'oklch(0.86 0.11 182)'));
      assert.equal(await style(page.locator('.cell[data-date="2026-10-06"] .dn'), 'color'), ink3, 'a day that\'s over');
      assert.equal(await style(page.locator('.cell[data-date="2026-10-01"] .dn'), 'color'), await colourOf(page, 'var(--ink)'), 'Oct 1 keeps its ink');
      assert.equal(await style(page.locator('.cell[data-date="2026-10-08"] .dn'), 'color'), await colourOf(page, 'var(--ink2)'), 'a day ahead keeps ink2');

      // The week: its weekend columns, its blocks the same.
      await page.keyboard.press('w');
      const block = (title: string) => page.locator('.wk-col[data-date="2026-10-07"] .wb', {hasText: title});
      await block('Dentist').waitFor();
      assert.equal(await style(page.locator('.wk-weekend').first(), 'backgroundColor'), await colourOf(page, 'var(--dayOff)'));
      assert.equal(await style(block('Gym'), 'color'), ink3);
      assert.equal(await style(block('Dentist'), 'color'), ahead);
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}

for (const theme of ['night', 'light'] as const) {
  test(`${theme}: the open email is sub3 with a 2 px accent bar, the pointer's row the cursor's sub2; a press lands at once; the current page's icon is the accent; Done's check is good (#126, #127)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await inbox(page, setpoint.base, theme);
      const accent = await colourOf(page, 'var(--accent)');
      assert.equal(accent, await colourOf(page, theme === 'light' ? 'oklch(0.54 0.12 235)' : 'oklch(0.8 0.11 235)'));
      assert.equal(await style(page.locator('.nav.on .icon'), 'color'), accent, 'Inbox, the current page');

      const northwind = page.locator('.arow', {hasText: 'Northwind Talent'});
      const exams = page.locator('.arow', {hasText: 'Contoso University'});
      await northwind.click();
      await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
      // The pointer rests on another row while reading: it's the cursor, Northwind still the open one.
      await point(exams);
      // Fills and the bar ease in over 120 ms; each is read once it's there.
      const [sub2, sub3] = [await colourOf(page, 'var(--sub2)'), await colourOf(page, 'var(--sub3)')];
      await until('the open row\'s bar', () => style(northwind, 'boxShadow'), shadow => shadow === `${accent} 2px 0px 0px 0px inset`);
      await until('the open row\'s sub3', () => style(northwind, 'backgroundColor'), fill => fill === sub3);
      await until('the cursor\'s sub2', () => style(exams, 'backgroundColor'), fill => fill === sub2);
      const [x, y] = await blank(northwind, 400);
      const [x2, y2] = await blank(exams, 400);
      assert.notDeepEqual(await pixel(page, x, y), await pixel(page, x2, y2), 'the open row and the cursor\'s look different');

      // A press: sub3 at once, before the email opens.
      await page.mouse.down();
      assert.deepEqual([await style(exams, 'backgroundColor'), await exams.evaluate(row => getComputedStyle(row).transitionDuration)], [await colourOf(page, 'var(--sub3)'), '0s']);
      await page.mouse.up();
      await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();

      // The reader's tools on Attention mail: Done's check good and its label ink; Trash stays ink2.
      const done = page.locator('.rd-tools .tool', {hasText: 'Done'});
      assert.equal(await style(done.locator('.icon'), 'color'), await colourOf(page, 'var(--good)'));
      assert.equal(await style(done, 'color'), await colourOf(page, 'var(--ink)'));
      await page.mouse.move(1, 1);
      assert.equal(await style(page.locator('.rd-tools .tool', {hasText: 'Trash'}), 'color'), await colourOf(page, 'var(--ink2)'));
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}

test('today is the now-line\'s alert disc in the month, the week\'s heads and the mini-month, in both themes (#128)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    for (const theme of ['night', 'light'] as const) {
      await calendar(page, setpoint.base, theme);
      const disc = async (target: Locator) => [await style(target, 'backgroundColor'), await style(target, 'color')];
      const alert = [await colourOf(page, 'var(--alert)'), await colourOf(page, 'var(--onAlert)')];
      assert.deepEqual(await disc(page.locator('.cell[data-date="2026-10-07"] .dn.today')), alert, `${theme}: the month`);
      assert.deepEqual(await disc(page.locator('.mini > .t')), alert, `${theme}: the mini-month`);
      await page.keyboard.press('w');
      await page.locator('.wk-dhead .dn.today').waitFor();
      assert.deepEqual(await disc(page.locator('.wk-dhead .dn.today')), alert, `${theme}: the week`);
      await page.keyboard.press('m');
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

for (const theme of ['night', 'light'] as const) {
  test(`${theme}: the current page is a raised navOn chip that hover's flat sub never matches; an account's filter makes Inbox its parent (#129)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await inbox(page, setpoint.base, theme);
      const inboxNav = page.locator('.sb .nav', {hasText: 'Inbox'});
      const calendarNav = page.locator('.sb .nav', {hasText: 'Calendar'});
      const raised = [await colourOf(page, 'var(--navOn)'), `${await colourOf(page, 'var(--navOnEdge)')} 0px 0px 0px 1px inset`];
      assert.equal(raised[0], theme === 'light' ? 'rgb(255, 255, 255)' : 'rgba(255, 255, 255, 0.1)');
      assert.deepEqual([await style(inboxNav, 'backgroundColor'), await style(inboxNav, 'boxShadow')], raised, 'Inbox, current');
      // Hovering Calendar draws a flat tint, plainly not the current page's chip.
      await calendarNav.hover();
      const sub = await colourOf(page, 'var(--sub)');
      await until('Calendar\'s hover', () => style(calendarNav, 'backgroundColor'), fill => fill === sub);
      assert.equal(await style(calendarNav, 'boxShadow'), 'none');
      // Business filters the Inbox: its row is the chip, and Inbox its parent in ink, without a fill.
      await page.locator('.sb .acct', {hasText: 'Business'}).click();
      const business = page.locator('.sb .acct.on', {hasText: 'Business'});
      await business.waitFor();
      await page.mouse.move(700, 28);
      await until('Business raised', () => style(business, 'backgroundColor'), fill => fill === raised[0]);
      assert.equal(await inboxNav.getAttribute('class'), 'nav parent');
      await until('Inbox without a fill', () => style(inboxNav, 'backgroundColor'), fill => fill === 'rgba(0, 0, 0, 0)');
      const ink = await colourOf(page, 'var(--ink)');
      assert.deepEqual([await style(inboxNav, 'color'), await style(inboxNav.locator('.icon'), 'color')], [ink, ink]);
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });

  test(`${theme}: Attention's band, label and dots are caution, a read row not yet Done keeps a caution ring; Noise recedes (#130, #131)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await inbox(page, setpoint.base, theme);
      await page.mouse.move(700, 28);
      const caution = await colourOf(page, 'var(--caution)');
      const band = page.locator('.list .gh.att');
      assert.equal(await style(band, 'backgroundColor'), await colourOf(page, `color-mix(in srgb, var(--caution) ${theme === 'light' ? 6 : 8}%, var(--panel))`));
      assert.equal(await style(band, 'color'), caution, 'its label');
      const dot = (row: Locator) => row.locator('.ud').evaluate(element => [getComputedStyle(element, '::before').backgroundColor, getComputedStyle(element, '::before').boxShadow]);
      assert.deepEqual(await dot(page.locator('.arow.unread', {hasText: 'Northwind Talent'})), [caution, 'none'], 'an unread Attention row');
      assert.deepEqual(await dot(page.locator('.arow:not(.unread)', {hasText: 'Contoso University'})), ['rgba(0, 0, 0, 0)', `${caution} 0px 0px 0px 1.5px inset`], 'read, not Done: a ring');

      // Noise's rows at the list's foot: ink2 at 400, an ink3 dot; a row elsewhere keeps ink at 500.
      const noise = page.locator('.row.noise.unread', {hasText: 'Tailspin Toys'});
      assert.deepEqual(await noise.locator('.from').evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).fontWeight]), [await colourOf(page, 'var(--ink2)'), '400']);
      assert.equal((await dot(noise))[0], await colourOf(page, 'var(--ink3)'));
      const delivery = page.locator('.row.unread', {hasText: 'Consolidated Messenger'});
      assert.deepEqual(await delivery.locator('.from').evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).fontWeight]), [await colourOf(page, 'var(--ink)'), '500']);
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}

for (const theme of ['night', 'light'] as const) {
  test(`${theme}: Trash and Delete turn alert under the pointer and Complete good, neutral at rest; a reader tool presses in; Delete stands apart (#132)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await inbox(page, setpoint.base, theme);
      const alert = await colourOf(page, 'var(--alert)');
      const good = await colourOf(page, 'var(--good)');
      await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
      const trash = page.locator('.rd-tools .tool.trash');
      await trash.waitFor();
      assert.equal(await style(trash, 'color'), await colourOf(page, 'var(--ink2)'), 'Trash at rest');
      await trash.hover();
      await until('Trash turns alert', () => style(trash, 'color'), colour => colour === alert);
      assert.equal(await style(trash, 'backgroundColor'), await backgroundOf(page, 'color-mix(in oklch, var(--alert) 12%, transparent)'));
      // Pressed, it gives: .96 and a stronger alert, eased over 120 ms; let go elsewhere, nothing's trashed.
      await page.mouse.down();
      await until('Trash pressed in', () => style(trash, 'transform'), transform => transform === 'matrix(0.96, 0, 0, 0.96, 0, 0)');
      assert.equal(await style(trash, 'backgroundColor'), await backgroundOf(page, 'color-mix(in oklch, var(--alert) 20%, transparent)'));
      await page.mouse.move(700, 28);
      await page.mouse.up();

      await calendar(page, setpoint.base, theme);
      await page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'}).click();
      const del = page.locator('.fd .card-acts .ibtn.danger');
      await del.waitFor();
      assert.equal(await style(del, 'marginLeft'), '9px');
      assert.deepEqual(await del.evaluate(button => [getComputedStyle(button, '::before').width, getComputedStyle(button, '::before').height]), ['1px', '14px'], 'its divider');
      assert.equal(await style(del, 'color'), await colourOf(page, 'var(--ink2)'), 'Delete at rest');
      await del.hover();
      await until('Delete turns alert', () => style(del, 'color'), colour => colour === alert);
      assert.equal(await style(del, 'backgroundColor'), await backgroundOf(page, 'color-mix(in oklch, var(--alert) 14%, transparent)'));
      await page.keyboard.press('Escape');
      await page.locator('.cell[data-date="2026-10-07"] .tk', {hasText: 'CS 101 lab report'}).click();
      const complete = page.locator('.fd .card-acts .ibtn.affirm');
      await complete.hover();
      await until('Complete turns good', () => style(complete, 'color'), colour => colour === good);
      assert.equal(await style(complete, 'backgroundColor'), await backgroundOf(page, 'color-mix(in oklch, var(--good) 16%, transparent)'));
      await page.keyboard.press('Escape');

      // The editor's More › Delete.
      await page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Dentist'}).click();
      await page.keyboard.press('e');
      await page.locator('.editor').getByRole('button', {name: 'More'}).click();
      const item = page.locator('.editor .menu-i.danger');
      await item.hover();
      await until('More › Delete turns alert', () => style(item, 'color'), colour => colour === alert);
      assert.equal(await style(item.locator('.icon'), 'color'), alert);
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}

test('the reader\'s actions step back (ink2 labels, ink3 icons, ink under the pointer) and the body starts 12 px under them; the email frame dims to 95% in Night and takes an edge in Light (#133, #134)', async () => {
  const setpoint = await startSetpoint({fixtures: ['recovery-html'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    for (const theme of ['night', 'light'] as const) {
      await inbox(page, setpoint.base, theme);
      await page.locator('.arow', {hasText: 'Your recovery email was changed'}).click();
      const frame = page.locator('iframe.mailframe');
      await page.frameLocator('iframe.mailframe').locator('body > *').first().waitFor();
      assert.equal(await style(frame, 'filter'), theme === 'night' ? 'brightness(0.95)' : 'brightness(1)', `${theme}: the frame's brightness`);
      assert.equal(await style(frame, 'boxShadow'), theme === 'night' ? 'rgba(0, 0, 0, 0) 0px 0px 0px 1px' : 'rgba(29, 30, 33, 0.1) 0px 0px 0px 1px', `${theme}: its edge`);
      const ask = page.locator('.rd-acts .btn.out', {hasText: 'Ask about this email'});
      await page.mouse.move(1, 1);
      assert.equal(await style(ask, 'color'), await colourOf(page, 'var(--ink2)'), `${theme}: an action's label`);
      assert.equal(await style(page.locator('.rd-acts .btn.out').first().locator('.icon'), 'color'), await colourOf(page, 'var(--ink3)'), `${theme}: its icon`);
      await ask.hover();
      const ink = await colourOf(page, 'var(--ink)');
      await until('ink under the pointer', () => style(ask, 'color'), colour => colour === ink);
      assert.equal(await page.locator('.rd-body').evaluate(body => getComputedStyle(body).paddingTop), '12px');
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

for (const theme of ['night', 'light'] as const) {
  test(`${theme}: a focused search field takes edgeFocus on cardOn and its hint reads Esc; matches take hl, Light's a highlighter yellow (#135)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await inbox(page, setpoint.base, theme);
      const field = page.locator('label.search');
      await page.mouse.move(700, 300);
      assert.equal(await field.locator('.kbd').textContent(), '/');
      await page.keyboard.press('/');
      // Focused and still empty: Esc is the way out.
      await until('the hint reads Esc', () => field.locator('.kbd').textContent(), text => text === 'Esc');
      const focus = await colourOf(page, 'var(--edgeFocus)');
      assert.equal(focus, theme === 'light' ? 'rgba(29, 30, 33, 0.3)' : 'rgba(255, 255, 255, 0.2)');
      await until('the focused border', () => style(field, 'borderTopColor'), colour => colour === focus);
      assert.equal(await style(field, 'backgroundColor'), await colourOf(page, 'var(--cardOn)'));
      if (theme === 'light') assert.equal(await style(field, 'backgroundColor'), 'rgb(255, 255, 255)', 'white in Light');
      await page.keyboard.type('northwind');
      await page.keyboard.press('Enter');
      const mark = page.locator('.arow.result').first().locator('mark.hl').first();
      await mark.waitFor();
      assert.equal(await style(mark, 'backgroundColor'), await backgroundOf(page, theme === 'light' ? 'oklch(0.92 0.12 96)' : 'color-mix(in oklch, var(--sun) 26%, transparent)'));
      // Blurred, with a query: still Esc; cleared, the slash again.
      await page.keyboard.press('Escape');
      await page.locator('.list .arow:not(.result)').first().waitFor();
      await until('the hint back to /', () => field.locator('.kbd').textContent(), text => text === '/');
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}

test('Alfred has one mark: auto_awesome in the cool-to-violet ink on Ask Alfred, the Answer card, the reader\'s and ⌘K\'s Ask about this email; Ask Alfred reads in ink (#136)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    for (const theme of ['night', 'light'] as const) {
      await inbox(page, setpoint.base, theme);
      assert.equal(await page.locator('linearGradient#alfred-ink').count(), 1);
      const stops = await page.locator('linearGradient#alfred-ink stop').evaluateAll(all => all.map(stop => getComputedStyle(stop).stopColor));
      assert.deepEqual(stops, [await colourOf(page, 'var(--cool)'), await colourOf(page, 'var(--violet)')], `${theme}: cool to violet`);
      const inked = (icon: Locator) => icon.locator('path').evaluate(path => getComputedStyle(path).fill);
      await page.locator('.arow', {hasText: 'Northwind Talent'}).click();
      const ask = page.locator('.rd-acts .btn', {hasText: 'Ask about this email'});
      assert.equal(await inked(ask.locator('.icon')), 'url("#alfred-ink")', 'the reader\'s Ask about this email');
      await page.keyboard.press('Meta+k');
      const item = page.locator('.palette .item', {hasText: 'Ask about this email'});
      assert.equal(await inked(item.locator('.icon')), 'url("#alfred-ink")', '⌘K\'s');
      await page.keyboard.press('Escape');
      await page.keyboard.press('/');
      await page.keyboard.type('northwind');
      await page.keyboard.press('Enter');
      const row = page.locator('button.ask');
      await row.waitFor();
      assert.equal(await inked(row.locator('.icon')), 'url("#alfred-ink")', 'Ask Alfred');
      await page.mouse.move(1, 1);
      assert.equal(await style(row, 'color'), await colourOf(page, 'var(--ink)'), 'Ask Alfred in ink');
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the forecast\'s sun is sunGlyph, Light\'s a deeper amber, and the high leads the low in ink2 (#137)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    for (const theme of ['night', 'light'] as const) {
      await calendar(page, setpoint.base, theme);
      const sunny = page.locator('.cell[data-date="2026-10-07"] .wx.sun');
      assert.equal(await style(sunny, 'color'), await colourOf(page, theme === 'light' ? 'oklch(0.58 0.14 78)' : 'var(--sun)'), `${theme}: the sun`);
      assert.equal(await style(page.locator('.rp-sub .sun'), 'color'), await colourOf(page, 'var(--sunGlyph)'), `${theme}: the right pane's`);
      const high = sunny.locator('.temps .hi');
      assert.equal(await high.textContent(), '78°');
      assert.equal(await style(high, 'color'), await colourOf(page, 'var(--ink2)'));
      assert.equal(await style(sunny.locator('.temps'), 'color'), await colourOf(page, 'var(--ink3)'), 'the low stays ink3');
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

for (const theme of ['night', 'light'] as const) {
  test(`${theme}: a task's ring keeps Todoist's hue at the theme's lightness, tinted at 14%; one that completes fills to 24% and shows its check, centred on the ring (#138)`, async () => {
    const setpoint = await startSetpoint({clock: 'frozen'});
    try {
      const page = await setpoint.page('target');
      await calendar(page, setpoint.base, theme);
      // School's sky blue (#319dc0) on CS 101 lab report: L .63 raw, so Night lifts it to .72 and Light caps it at .55.
      const shown = await colourOf(page, `oklch(from #319dc0 ${theme === 'light' ? 'min(l, .55)' : 'max(l, .72)'} c h)`);
      const agenda = page.locator('.ag-task', {hasText: 'CS 101 lab report'});
      const ring = agenda.locator('.ring');
      await until('the ring\'s colour', () => style(ring, 'borderTopColor'), colour => colour === shown);
      assert.equal(await style(ring, 'backgroundColor'), await backgroundOf(page, `color-mix(in oklch, ${shown} 14%, transparent)`));
      assert.equal(await style(page.locator('.cell[data-date="2026-10-07"] .tk', {hasText: 'CS 101 lab report'}).locator('.ring'), 'borderTopColor'), shown, 'the grid\'s too');
      const check = ring.locator('.icon');
      assert.equal(await style(check, 'opacity'), '0', 'no check at rest');
      await agenda.locator('.check').hover();
      await until('the check shows', () => style(check, 'opacity'), opacity => opacity === '1');
      const risen = await backgroundOf(page, `color-mix(in oklch, ${shown} 24%, transparent)`);
      await until('the fill rises to 24%', () => style(ring, 'backgroundColor'), fill => fill === risen);
      assert.equal(await style(check, 'color'), shown, 'the check in the ring\'s colour');
      // Centred on the whole ring, stroke included: the same room on every side.
      const [outer, inner] = [await ring.boundingBox(), await check.boundingBox()];
      assert.deepEqual([inner!.width, inner!.height], [11, 11]);
      assert.equal(inner!.x - outer!.x, outer!.x + outer!.width - (inner!.x + inner!.width), 'as much room left as right');
      assert.equal(inner!.y - outer!.y, outer!.y + outer!.height - (inner!.y + inner!.height), 'as much above as below');
      assert.deepEqual(setpoint.pageErrors, []);
    } finally {
      await setpoint.stop();
    }
  });
}
