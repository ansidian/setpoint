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

const style = (target: Locator, property: 'color' | 'backgroundColor' | 'boxShadow' | 'borderTopColor' | 'opacity') =>
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
