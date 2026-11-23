// News on the phone at 390 × 844 against the seed's sample: All in one column under "News ▾", whose
// menu has All and the sections; a story sliding in over the list with Back, its sources' articles;
// While you were away heading All, put away by Done with Undo; seen as on the desktop; Search news
// with its clear button; and the states (newsStates.spec.ts's fixtures): Unsorted with Show
// headlines, a stale section, a section with nothing new, and the first run.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {NewsPageOut, NewsSectionOut, StoryOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, holdToast, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const list = (page: Page) => page.locator('.nw-list .list');
// A story's row in the list, not the recap's (whose rows aren't the list's).
const row = (page: Page, headline: string) => page.locator('.nw-list [data-key][data-story]', {hasText: headline}).first();
const recap = (page: Page) => page.locator('.nw-list .nw-recap');

async function storyId(setpoint: Setpoint, headline: string): Promise<number> {
  for (const section of ['local', 'tech', 'ai', 'general']) {
    const found = (await setpoint.api<NewsSectionOut>('GET', `/news/sections/${section}`)).stories.find(story => story.headline === headline);
    if (found) return found.id;
  }
  throw new Error(`No story "${headline}".`);
}

const stateOf = async (setpoint: Setpoint, id: number) => (await setpoint.api<StoryOut>('GET', `/news/stories/${id}`)).state;

/** News from the Inbox's tab bar, at rest on its first rows. */
async function news(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  await page.locator('.ph-tab', {hasText: 'News'}).tap();
  await row(page, 'Brush fire near the 210').waitFor();
  return page;
}

/** The list's rows wholly in its view with a dot, once the server has seen each (about a second). */
async function seenSettled(page: Page, setpoint: Setpoint): Promise<number[]> {
  const ids = await rested(() => list(page).evaluate(scroller => {
    const box = scroller.getBoundingClientRect();
    return [...new Set([...scroller.querySelectorAll<HTMLElement>('[data-key]')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5 && (element.classList.contains('new') || element.classList.contains('upd'));
    }).map(element => Number(element.dataset.story)))];
  }));
  for (const id of ids) await until(`story ${id} seen on the server`, () => stateOf(setpoint, id), state => state === 'seen');
  await setpoint.idle();
  return ids;
}

test('the phone\'s News: "News ▾" with All and the sections, All in one column, a section from the menu; no pane, no Add to calendar', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await news(setpoint);
    assert.equal(new URL(page.url()).pathname, '/news');
    assert.equal(await page.locator('.ph-tab.on').textContent(), 'News');
    assert.equal(await page.locator('.hd .ph-title-btn').textContent(), 'News');
    assert.equal(await page.locator('.hd .seg').count(), 0, 'no segmented control');
    assert.equal(await page.locator('.hd .search input').getAttribute('placeholder'), 'Search news');
    // The recap heads the list, then the blocks in their fixed order. No empty pane beside it.
    assert.deepEqual(await page.locator('.nw-list .list > .nw-sec').allTextContents(), ['Local', 'Tech', 'AI', 'General']);
    assert.equal(await recap(page).locator('.nw-recap-row').count(), 8);
    assert.equal(await page.locator('.pane').count(), 0);
    // Upcoming, without Add to calendar for now.
    await page.locator('.nw-up', {hasText: 'Apple event · Tue Oct 20 · 10 AM'}).waitFor();
    assert.equal(await page.locator('.nw-up button').count(), 0);
    // Nothing scrolls sideways.
    assert.ok(await list(page).evaluate(scroller => scroller.scrollWidth <= scroller.clientWidth));

    // The menu: All and the sections, All checked. Local shows Local's list under "Local ▾".
    await page.locator('.hd .ph-title-btn').tap();
    const menu = page.getByRole('menu', {name: 'News'});
    assert.deepEqual(await menu.getByRole('menuitemradio').allTextContents(), ['All', 'Local', 'Tech', 'AI', 'General']);
    assert.equal(await menu.getByRole('menuitemradio', {checked: true}).textContent(), 'All');
    await menu.getByRole('menuitemradio', {name: 'Local'}).tap();
    await page.waitForURL(/\/news\/local$/);
    await until('Local\'s whole list', () => page.locator('.nw-list [data-story]').count(), count => count === 17);
    assert.equal(await page.locator('.hd .ph-title-btn').textContent(), 'Local');
    assert.equal(await page.locator('.nw-sec').count(), 0);
    assert.equal(await recap(page).count(), 0, 'the recap is All\'s alone');
    await page.locator('.hd .ph-title-btn').tap();
    await page.getByRole('menu', {name: 'Local'}).getByRole('menuitemradio', {name: 'All'}).tap();
    await page.waitForURL(/\/news$/);
    await recap(page).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a story slides in over the list with Back and Open at its outlet; a source opens its article, whose Back is the story; opened, it\'s seen', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await news(setpoint);
    const brush = await storyId(setpoint, 'Brush fire near the 210 grows to 400 acres');
    await row(page, 'Brush fire near the 210').tap();
    const pane = page.locator('.pane');
    await pane.locator('.rd-subj', {hasText: 'Brush fire near the 210 grows to 400 acres'}).waitFor();
    assert.equal(new URL(page.url()).pathname, `/news/story/${brush}`);
    assert.equal(await pane.locator('.ph-back').textContent(), 'News');
    await pane.getByRole('button', {name: 'Open at KTLA'}).waitFor();
    // Over the whole screen, the tab bar under it.
    const [box, tabs] = await rested(() => Promise.all([pane.boundingBox(), page.locator('.ph-tabs').boundingBox()]));
    assert.ok(box!.x === 0 && box!.width === 390 && box!.y + box!.height >= tabs!.y + tabs!.height, 'the pane covers the screen');
    await until('the brush fire seen', () => stateOf(setpoint, brush), state => state === 'seen');

    // A source opens its article in the pane; Back goes to the story.
    await pane.locator('.src-row').first().tap();
    await pane.locator('.ar-title').waitFor();
    assert.equal(await pane.locator('.ph-back').textContent(), 'Story');
    await pane.locator('.ph-back').tap();
    await pane.locator('.rd-subj', {hasText: 'Brush fire near the 210'}).waitFor();
    // Back to the list.
    await pane.locator('.ph-back').tap();
    await until('the pane closes', () => page.locator('.pane').count(), count => count === 0);
    assert.equal(new URL(page.url()).pathname, '/news');
    assert.match(await row(page, 'Brush fire near the 210').getAttribute('class') ?? '', /\bseen\b/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('While you were away heads All: on screen it isn\'t seen, a story opens over the list; Done puts it away at once, and Undo brings it back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const shown = (page: Page) => page.waitForResponse(response => response.url().endsWith('/api/news/here')
      && (response.request().postDataJSON() as {recap: number[] | null}).recap !== null);
    const page = await setpoint.page('iphone');
    const told = shown(page);
    await page.goto(`${setpoint.base}/news`);
    await recap(page).waitFor();
    // The page tells the server what the recap shows, which fixes it, as the desktop's pane does.
    const fixed = (await told).request().postDataJSON() as {recap: number[]};
    const ids = (await setpoint.api<NewsPageOut>('GET', '/news')).recap!.stories.map(story => story.id);
    assert.deepEqual(fixed.recap, ids);
    assert.equal(await recap(page).locator('.nw-sec').textContent(), 'While you were awaysince Mon 10:40 PMDone');
    const headlines = await recap(page).locator('.nw-recap-row .hl').evaluateAll(all => all.map(element => element.textContent!.split(' ').slice(0, 2).join(' ')));
    assert.deepEqual(headlines, ['Overnight closures', 'Teen hurt', 'iOS 26.1', 'Samsung sets', 'Google DeepMind', 'OpenAI opens', 'Tornado outbreak', 'Amtrak derailment']);
    assert.equal(await recap(page).locator('.nw-recap-row', {hasText: 'Tornado outbreak'}).locator('.nw-meta').textContent(), 'General·NPR +9·Yesterday');
    // Wholly on screen, its stories stay unseen once the list's rows have been seen.
    await seenSettled(page, setpoint);
    assert.equal(await stateOf(setpoint, ids[0]!), 'new');

    // A recap story opens over the list, and is seen.
    await recap(page).locator('.nw-recap-row').first().tap();
    await page.locator('.pane .rd-subj', {hasText: 'Overnight closures'}).waitFor();
    await until('seen once opened', () => stateOf(setpoint, ids[0]!), state => state === 'seen');
    await page.locator('.pane .ph-back').tap();
    await until('the pane closes', () => page.locator('.pane').count(), count => count === 0);
    assert.match(await recap(page).locator('.nw-recap-row').first().getAttribute('class') ?? '', /\bseen\b/);

    // Done: gone at once, put away on the server, its other stories still unseen.
    await recap(page).getByRole('button', {name: 'Done'}).tap();
    await until('the recap goes', () => recap(page).count(), count => count === 0);
    const toast = await holdToast(page);
    await until('the toast', () => toast.textContent(), text => text?.includes('Recap put away') ?? false);
    await until('put away on the server', () => setpoint.api<NewsPageOut>('GET', '/news'), out => out.recap === null);
    assert.equal(await stateOf(setpoint, ids[1]!), 'new', 'put away, not seen');
    assert.deepEqual(await page.locator('.nw-list .list > .nw-sec').allTextContents(), ['Local', 'Tech', 'AI', 'General']);

    // Undo: the recap as it was, here and on the server.
    await toast.getByRole('button', {name: 'Undo'}).tap();
    await recap(page).waitFor();
    assert.equal(await recap(page).locator('.nw-recap-row').count(), 8);
    await until('back on the server', () => setpoint.api<NewsPageOut>('GET', '/news'), out => out.recap?.stories.map(story => story.id).join() === ids.join());
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('seen on the phone: the rows wholly on screen for about a second; a row below the fold stays new; the dots stay for the visit', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // All without its recap, as an hour away leaves it: on the phone the recap fills the first screen.
    await setpoint.api('POST', '/news/recap/done');
    const page = await news(setpoint);
    const hurricane = await storyId(setpoint, 'Hurricane Teresa makes landfall in the Florida Panhandle as a Category 3');
    const seen = await seenSettled(page, setpoint);
    assert.ok(seen.length > 0, 'some rows are on screen');
    assert.equal(await stateOf(setpoint, hurricane), 'new', 'below the fold');
    // The rows seen keep their dots for the visit.
    for (const id of seen) assert.match(await page.locator(`.nw-list [data-key][data-story="${id}"]`).first().getAttribute('class') ?? '', /\b(new|upd)\b/);
    await page.reload();
    await row(page, 'Brush fire near the 210').waitFor();
    for (const id of seen) assert.match(await page.locator(`.nw-list [data-key][data-story="${id}"]`).first().getAttribute('class') ?? '', /\bseen\b/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Search news on the phone: the stories found replace the list, one opens with Back to Search, and the clear button leaves search', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await news(setpoint);
    await page.locator('.hd .search input').tap();
    await page.keyboard.type('tornado');
    const results = page.locator('section.nw-list[aria-label="Stories found"]');
    await results.locator('[data-story]', {hasText: 'Tornado outbreak across Oklahoma and Kansas'}).waitFor();
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.equal(await page.locator('.hd .ph-title-btn').count(), 0, 'no menu while searching');
    assert.equal(await page.locator('.nw-sec, .nw-recap').count(), 0, 'the list is replaced');

    await results.locator('[data-story]').first().tap();
    await page.locator('.pane .rd-subj', {hasText: 'Tornado outbreak'}).waitFor();
    assert.equal(await page.locator('.pane .ph-back').textContent(), 'Search');
    await page.locator('.pane .ph-back').tap();
    await until('the pane closes', () => page.locator('.pane').count(), count => count === 0);
    await results.waitFor();

    await page.getByRole('button', {name: 'Clear search'}).tap();
    await page.locator('.hd .ph-title-btn', {hasText: 'News'}).waitFor();
    await row(page, 'Brush fire near the 210').waitFor();
    assert.equal(await page.locator('.hd .search input').inputValue(), '');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone\'s states: Unsorted with Show headlines, a stale section and one with nothing new; the first run with no recap', async () => {
  const setpoint = await startSetpoint({fixtures: ['news-ai-down', 'news-stale-ai', 'news-quiet-tech'], clock: 'frozen'});
  try {
    const page = await news(setpoint);
    const unsorted = page.locator('.nw-state.failing');
    assert.equal(await unsorted.textContent(), '12 articles not sorted yet, Anthropic unreachable since 8:52 AM, retryingShow headlines');
    const aiLine = page.locator('.nw-list .list > .nw-sec', {hasText: 'AI'}).locator('xpath=following-sibling::*[1]');
    assert.deepEqual(await aiLine.evaluate(element => [element.className, element.textContent]), ['nw-line stale', 'AI as of 7:02 AM']);
    const tech = page.locator('.nw-list .list > .nw-sec', {hasText: 'Tech'}).locator('xpath=following-sibling::*[1]');
    assert.deepEqual(await tech.evaluate(element => [element.className, element.textContent]), ['nw-empty', 'Nothing new in Tech since Mon']);
    // Show headlines: the twelve waiting, each its outlet's link, within the screen's width.
    await unsorted.getByRole('button', {name: 'Show headlines'}).tap();
    await until('the twelve headlines', () => page.locator('.nw-raw').count(), count => count === 12);
    assert.equal(await page.locator('.nw-raw').first().getAttribute('target'), '_blank');
    const [line, button] = await rested(() => Promise.all([unsorted.boundingBox(), unsorted.getByRole('button').boundingBox()]));
    assert.ok(button!.x + button!.width <= line!.x + line!.width, 'Hide headlines fits its line');
    await unsorted.getByRole('button', {name: 'Hide headlines'}).tap();
    await page.locator('.nw-raw').first().waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }

  const first = await startSetpoint({fixtures: ['news-first-run'], clock: 'frozen'});
  try {
    const page = await news(first);
    await page.locator('.nw-state.muted', {hasText: 'Sorting the last 48 hours · 186 of 312 articles'}).waitFor();
    assert.equal(await recap(page).count(), 0, 'no recap');
    const ai = page.locator('.nw-list .list > .nw-sec', {hasText: 'AI'}).locator('xpath=following-sibling::*[1]');
    assert.deepEqual(await ai.evaluate(element => [element.className, element.textContent]), ['nw-empty', 'Nothing sorted in AI yet']);
    assert.deepEqual(first.pageErrors, []);
  } finally {
    await first.stop();
  }
});
