// The visual net without baselines (SV-99), beside the release's nine page screenshots (pages.ts,
// D281): the main pages (the Inbox with an email open, the calendar's month and week, the editor, News
// with a story open, every Settings page, the phone's Inbox) in Night and Light, at the design target,
// 1100 and 820 wide and on the phone. On each, at rest: nothing scrolls sideways, no text is cut by an
// overflow: hidden box (an ellipsis is meant), nothing interactive is covered at its centre, no image
// is broken, every font loaded, no request failed and nothing went to the console. Then axe, per
// theme at the target width, by rule and element. Each failure names the element, page, theme and width.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import AxeBuilder from '@axe-core/playwright';
import type {InboxOut, NewsSectionOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, rested, SIZES, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';
import {SETTINGS_PAGES} from '../../src/logic/route.ts';

after(cleanUp);

const THEMES = ['dark', 'light'] as const;
const NAMES = {dark: 'Night', light: 'Light'} as const;
const HEIGHT = SIZES.target.height;
const WIDTHS = [SIZES.target.width, 1100, 820];

interface Route {
  name: string;
  path: string;
  // What shows once it's there.
  shows: string;
}

/** Problems on the page as it rests, each naming its element. */
function sweepPage(): string[] {
  const found: string[] = [];
  const describe = (element: Element) => {
    const label = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '';
    const classes = [...element.classList].slice(0, 3).map(name => `.${name}`).join('');
    return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}${label ? ` "${label}"` : ''}`;
  };
  const inert = (element: Element) => Boolean(element.closest('[inert]'));
  const all = [...document.querySelectorAll('body *')];

  // Nothing scrolls sideways: the document, and every box that scrolls.
  const root = document.scrollingElement!;
  if (root.scrollWidth > root.clientWidth + 1) found.push(`the page scrolls sideways (${root.scrollWidth} in ${root.clientWidth})`);
  for (const element of all) {
    const {overflowX} = getComputedStyle(element);
    if ((overflowX === 'auto' || overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 1) {
      found.push(`${describe(element)} scrolls sideways (${element.scrollWidth} in ${element.clientWidth})`);
    }
  }

  // No text partly cut by a box that hides its overflow; an ellipsis is meant, and text wholly out of
  // its box (a fold shut, a clamped line) is put away rather than cut. Text a scrolling box holds is
  // scrolled to, so the walk out stops there.
  const clips = (element: Element) => {
    const style = getComputedStyle(element);
    return {x: /hidden|clip/.test(style.overflowX), y: /hidden|clip/.test(style.overflowY), scrolls: /auto|scroll/.test(style.overflowX + style.overflowY)};
  };
  // Glyph boxes overhang a tight line height by a pixel or two.
  const SLACK = 2;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const reported = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    const holder = node.parentElement!;
    if (inert(holder) || getComputedStyle(holder).visibility !== 'visible') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    // What still shows of each line, as each box on the way out hides its part.
    let rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => ({left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom}));
    let cut = false;
    for (let box = holder as Element | null; box && box !== document.body && rects.length && !cut; box = box.parentElement) {
      const clip = clips(box);
      if (clip.scrolls) break;
      if (!clip.x && !clip.y) continue;
      const edge = box.getBoundingClientRect();
      const ellipsis = getComputedStyle(holder).textOverflow === 'ellipsis' || getComputedStyle(box).textOverflow === 'ellipsis';
      const shows = rects.filter(rect => Math.min(rect.right, edge.right) - Math.max(rect.left, edge.left) > 1 && Math.min(rect.bottom, edge.bottom) - Math.max(rect.top, edge.top) > SLACK);
      for (const rect of shows) {
        const cutX = clip.x && !ellipsis && (rect.right > edge.right + 1 || rect.left < edge.left - 1);
        const cutY = clip.y && (rect.bottom > edge.bottom + SLACK || rect.top < edge.top - SLACK);
        if (!cutX && !cutY) continue;
        cut = true;
        if (!reported.has(box)) found.push(`${describe(box)} cuts its text "${node.textContent.trim().slice(0, 40)}" ${cutX ? 'at the side' : 'at the top or bottom'}`);
        reported.add(box);
        break;
      }
      rects = shows.map(rect => clip.x ? {...rect, left: Math.max(rect.left, edge.left), right: Math.min(rect.right, edge.right)} : rect)
        .map(rect => clip.y ? {...rect, top: Math.max(rect.top, edge.top), bottom: Math.min(rect.bottom, edge.bottom)} : rect);
    }
  }

  // Nothing interactive is covered at the centre of what shows of it. Behind a modal only the modal
  // counts, and a pane lying over the page (the reader over the list from 640 to 1099 px, DESIGN.md
  // #140), many times the size of what it covers, covers it on purpose.
  const modal = document.querySelector('[aria-modal="true"]');
  const interactive = all.filter(element => element.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role^="menuitem"], [tabindex]:not([tabindex="-1"])'));
  const area = (rect: DOMRect) => rect.width * rect.height;
  for (const element of interactive) {
    if (inert(element) || (modal && !modal.contains(element)) || (element as HTMLButtonElement).disabled) continue;
    const style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.pointerEvents === 'none' || Number(style.opacity) === 0) continue;
    // What shows: its box inside the window and inside every box above it that clips.
    const own = element.getBoundingClientRect();
    let [left, top, right, bottom] = [Math.max(own.left, 0), Math.max(own.top, 0), Math.min(own.right, innerWidth), Math.min(own.bottom, innerHeight)];
    for (let box = element.parentElement; box && box !== document.body; box = box.parentElement) {
      if (getComputedStyle(box).overflow === 'visible') continue;
      const edge = box.getBoundingClientRect();
      [left, top, right, bottom] = [Math.max(left, edge.left), Math.max(top, edge.top), Math.min(right, edge.right), Math.min(bottom, edge.bottom)];
    }
    if (right - left < 2 || bottom - top < 2) continue;
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    if (!hit || element.contains(hit) || hit.contains(element) || (hit as HTMLLabelElement).control === element) continue;
    // A label's own input is covered by the label on purpose.
    if (element.matches('input') && hit.closest('label')?.contains(element)) continue;
    // The cover: the outermost box holding the hit that doesn't hold the element.
    let cover = hit;
    while (cover.parentElement && !cover.parentElement.contains(element)) cover = cover.parentElement;
    if (area(cover.getBoundingClientRect()) >= 4 * area(own)) continue;
    found.push(`${describe(element)} is covered by ${describe(hit)}`);
  }

  // No image broken.
  for (const image of document.images) {
    if (image.complete && image.currentSrc && image.naturalWidth === 0) found.push(`${describe(image)} is broken (${image.currentSrc})`);
  }

  // Every font loaded (sweepPage's caller loads them first).
  for (const face of document.fonts) if (face.status !== 'loaded') found.push(`the font ${face.family} ${face.weight} is ${face.status}`);
  return found;
}

/** Collects every failed request and console error on `page` until read, emptying as it reads. */
function listen(setpoint: Setpoint, page: Page): () => string[] {
  let heard: string[] = [];
  page.on('requestfailed', request => {
    const failure = request.failure()?.errorText ?? '';
    // A request the page left behind when it moved on (a navigation, an image scrolled away) isn't a failure.
    if (failure === 'net::ERR_ABORTED' || new URL(request.url()).pathname === '/api/events') return;
    heard.push(`${request.url()} failed: ${failure}`);
  });
  page.on('response', response => {
    if (response.status() >= 400) heard.push(`${response.url()} answered ${response.status()}`);
  });
  page.on('console', message => {
    if (message.type() === 'error') heard.push(`console: ${message.text()}`);
  });
  return () => {
    const read = [...heard, ...setpoint.pageErrors.splice(0)];
    heard = [];
    return read;
  };
}

async function routes(setpoint: Setpoint): Promise<Route[]> {
  const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
  const email = inbox.groups.flatMap(group => group.rows).find(row => row.subject.startsWith('Interview availability'))!.id;
  const {stories} = await setpoint.api<NewsSectionOut>('GET', '/news/sections/local');
  const story = stories.find(one => one.headline.startsWith('Brush fire near the 210'))!.id;
  return [
    {name: 'the Inbox, an email open', path: `/inbox/${email}`, shows: '.rd-subj'},
    {name: 'the calendar\'s month', path: '/calendar', shows: '.cal-month'},
    // Over the month: a calendar address that names no view takes the one last used.
    {name: 'the editor', path: '/calendar/new?kind=event', shows: '.editor'},
    {name: 'the calendar\'s week', path: '/calendar?view=week', shows: '.cal-week'},
    {name: 'News, a story open', path: `/news/story/${story}`, shows: '.pane .rd-subj'},
    ...SETTINGS_PAGES.map(name => ({name: `Settings › ${name}`, path: `/settings/${name}`, shows: '.settings .set-nav .nav.on'})),
  ];
}

/** Goes to `route` and waits for it, Night first. */
async function visit(page: Page, base: string, route: Route) {
  await page.emulateMedia({colorScheme: 'dark'});
  await page.goto(`${base}${route.path}`);
  // A theme lands at once, as at the first paint, rather than over the 180 ms fade a switch takes, a
  // wave of colour transitions element by element that would hold each rest for a third of a second:
  // the sweep reads where things rest, not how they got there.
  await page.addStyleTag({content: ':root { --theme-fade: 0s !important; }'});
  await page.locator(route.shows).first().waitFor();
  // The pointer out of the way, so no hover card covers anything.
  await page.mouse.move(0, 0);
}

/** Night or Light at `width`, at rest, swept; what it found, each line naming where. */
async function sweepAt(page: Page, route: Route, theme: typeof THEMES[number], width: number, heard: () => string[]): Promise<string[]> {
  if (page.viewportSize()!.width !== width) await page.setViewportSize({width, height: page.viewportSize()!.height});
  await page.emulateMedia({colorScheme: theme});
  await until(NAMES[theme], () => page.evaluate(() => document.documentElement.dataset.theme), value => value === (theme === 'dark' ? 'night' : 'light'));
  const where = `${route.name}, ${NAMES[theme]}, ${width} wide`;
  // Every face asked for, as the harness's goto does: one the page doesn't use yet is "unloaded" until then.
  await page.evaluate(() => Promise.all([...document.fonts].map(face => face.load().catch(() => {}))));
  return [...await rested(() => page.evaluate(sweepPage)), ...heard()].map(problem => `${where}: ${problem}`);
}

// axe's color-contrast holds text to 3:1 for now, not WCAG AA's 4.5 (D283, SV-100): `ink3` on a raised
// surface (a selected row, a keycap, a Light event chip) measures 3.2 to 4.4, the palette's quiet
// ink as the boards draw it, and lifting it changes every page screenshot, which is the user's to look at.
// Under 3:1 is a colour gone wrong. The mini-month's days outside its month are dim on purpose.
const CONTRAST_FLOOR = 3;
const DIM_ON_PURPOSE = '.mini > .o';

/** axe's violations, as rule and element. */
async function axe(page: Page, route: Route, theme: typeof THEMES[number]): Promise<string[]> {
  const results = await rested(() => new AxeBuilder({page}).analyze());
  const found: string[] = [];
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const target = node.target.join(' ');
      if (violation.id === 'color-contrast') {
        const ratio = (node.any[0]?.data as {contrastRatio?: number} | undefined)?.contrastRatio ?? 0;
        if (ratio >= CONTRAST_FLOOR) continue;
        if (await page.locator(target).first().evaluate((element, dim) => element.matches(dim), DIM_ON_PURPOSE)) continue;
        found.push(`${route.name}, ${NAMES[theme]}: axe color-contrast ${ratio}:1 at ${target}`);
      } else {
        found.push(`${route.name}, ${NAMES[theme]}: axe ${violation.id} at ${target}`);
      }
    }
  }
  return found;
}

test('the main pages, in Night and Light at three widths, keep to their boxes, and axe finds nothing', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page({width: SIZES.target.width, height: HEIGHT});
    const heard = listen(setpoint, page);
    const found: string[] = [];
    for (const route of await routes(setpoint)) {
      await page.setViewportSize({width: SIZES.target.width, height: HEIGHT});
      await visit(page, setpoint.base, route);
      for (const width of WIDTHS) {
        for (const theme of THEMES) {
          found.push(...await sweepAt(page, route, theme, width, heard));
          if (width === SIZES.target.width) found.push(...await axe(page, route, theme));
        }
      }
    }
    assert.deepEqual(found, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone\'s Inbox, in Night and Light, keeps to its boxes, and axe finds nothing', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    const heard = listen(setpoint, page);
    const route = {name: 'the phone\'s Inbox', path: '/inbox', shows: '.list .row'};
    await visit(page, setpoint.base, route);
    const found: string[] = [];
    for (const theme of THEMES) {
      found.push(...await sweepAt(page, route, theme, SIZES.iphone.width, heard));
      found.push(...await axe(page, route, theme));
    }
    assert.deepEqual(found, []);
  } finally {
    await setpoint.stop();
  }
});
