// News's states, search and Light (N5; DESIGN.md › News › States, boards 29a, 29b and 31) against
// fixtures (server/src/dev/fixtures/newsStates.ts), which reach no model or feed: Unsorted with the AI
// down and Show headlines, a stale section and a section with nothing new (29a); the first run (29b);
// offline, as on every page; and Search news over the archive. Board 31 (Light) is news.spec.ts's,
// beside board 25.
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after, test} from 'node:test';
import type {NewsSectionOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, matchGolden, startSetpoint, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** An empty line's leading glyph: its bundled path, size and colour, and the gap to the words after it (#165). */
const leadGlyph = (line: Locator) => line.evaluate(element => {
  const icon = element.querySelector('.icon')!;
  const range = document.createRange();
  range.selectNode(icon.closest('span.set-empty-icon') ? element.querySelector('.set-empty')! : icon.nextSibling!);
  return [icon.querySelector('path')!.getAttribute('d'), icon.getAttribute('width'), getComputedStyle(icon).color, Math.round(range.getBoundingClientRect().left - icon.getBoundingClientRect().right)];
});

const row = (page: Page, headline: string) => page.locator('.nw-list [data-story]', {hasText: headline}).first();

/** A colour as the page computes it, to compare with a computed style. */
const colourOf = (page: Page, colour: string) => page.evaluate(value => {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, colour);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Out of the way of every row, so no hover fill shows.
  await page.mouse.move(700, 28);
  // Lets a hover fill the move left fade out (120 ms) before the screenshot.
  await page.waitForTimeout(250);
}

/** Changes the server's database as sorting would. */
function sql(setpoint: Setpoint, statements: string) {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec(statements);
  } finally {
    database.close();
  }
}

/** A story's id by its headline, as the server has it. */
async function storyId(setpoint: Setpoint, headline: string): Promise<number> {
  for (const section of ['local', 'tech', 'ai', 'general']) {
    const found = (await setpoint.api<NewsSectionOut>('GET', `/news/sections/${section}`)).stories.find(story => story.headline === headline);
    if (found) return found.id;
  }
  throw new Error(`No story "${headline}".`);
}

test('board 29a: Unsorted with the AI down, AI stale, and nothing new in Tech; Show headlines lists what waits', async () => {
  const setpoint = await startSetpoint({fixtures: ['news-ai-down', 'news-stale-ai', 'news-quiet-tech'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const unsorted = page.locator('.nw-state.failing');
    await unsorted.waitFor();
    await row(page, 'Brush fire near the 210').waitFor();
    assert.equal(await unsorted.textContent(), '12 articles not sorted yet, Anthropic unreachable since 8:52 AM, retryingShow headlines');
    // At the top of the list, above the Missed strip: 32 px, `caution` 12.5.
    assert.deepEqual(await page.locator('.nw-list > *').evaluateAll(all => all.slice(0, 2).map(element => element.className)), ['nw-state failing', 'nw-missed']);
    assert.deepEqual(await unsorted.evaluate(line => [line.getBoundingClientRect().height, getComputedStyle(line).fontSize]), [32, '12.5px']);
    assert.equal(await unsorted.evaluate(line => getComputedStyle(line).color), await colourOf(page, 'var(--caution)'));
    assert.equal(await unsorted.locator('.btn').getAttribute('class'), 'btn ghost sm');

    // AI's muted line under its header, its stories still there.
    const aiLine = page.locator('.nw-sec', {hasText: 'AI'}).locator('xpath=following-sibling::*[1]');
    assert.equal(await aiLine.textContent(), 'AI, as of 7:02 AM');
    assert.equal(await aiLine.getAttribute('class'), 'nw-line stale');
    assert.equal(await aiLine.evaluate(line => getComputedStyle(line).color), await colourOf(page, 'var(--ink3)'));
    await row(page, 'Anthropic releases Claude Haiku 5.5').waitFor();
    assert.equal(await page.locator('.nw-line').count(), 1, 'only the stale section has a line');

    // Tech: one 44 px line in `ink3`, no rows, no Upcoming, no "N more".
    const tech = page.locator('.nw-sec', {hasText: 'Tech'}).locator('xpath=following-sibling::*[1]');
    assert.equal(await tech.textContent(), 'Nothing new in Tech since Mon');
    assert.deepEqual(await tech.evaluate(line => [line.className, line.getBoundingClientRect().height]), ['nw-empty', 44]);
    assert.equal(await tech.evaluate(line => getComputedStyle(line).color), await colourOf(page, 'var(--ink3)'));
    assert.deepEqual(await leadGlyph(tech), [ICONS.newspaper, '16', await colourOf(page, 'var(--ink3)'), 8], 'it leads with newspaper (#165)');
    assert.equal(await page.locator('.nw-up').count(), 0);
    assert.deepEqual(await page.locator('.nw-more').allTextContents(), ['12 more in Local', '4 more in AI', '9 more in General']);
    await settle(page);
    await matchGolden(page, '29a-states-unsorted-stale-nothing-new', 'news');

    // Show headlines: the raw headlines with their links, newest first, at the top of the list.
    await unsorted.getByRole('button', {name: 'Show headlines'}).click();
    const raw = page.locator('.nw-raw');
    await until('the twelve headlines', () => raw.count(), count => count === 12);
    assert.equal(await page.locator('.nw-sec').first().textContent(), 'Unsorted12');
    assert.equal(await raw.first().textContent(), 'Crews contain a brush fire near the 210 at 40%Local·KTLA·3m');
    assert.equal(await raw.first().getAttribute('href'), 'https://ktla.example/news/crews-contain-a-brush-fire-near-the-210-at-40');
    assert.equal(await raw.first().getAttribute('target'), '_blank');
    assert.equal(await raw.first().evaluate(link => link.getBoundingClientRect().height), 36);
    await settle(page);
    await matchGolden(page, 'news-show-headlines', 'news');
    await unsorted.getByRole('button', {name: 'Hide headlines'}).click();
    await raw.first().waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the Unsorted line goes once sorting is back, at the next `news` event; its count follows', async () => {
  const setpoint = await startSetpoint({fixtures: ['news-ai-down'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const unsorted = page.locator('.nw-state.failing');
    await unsorted.waitFor();
    // Four of them sorted, then a `news` event (seeing a story the user saw on Monday sends one).
    const council = await storyId(setpoint, 'Council approves a 120-unit housing project on a former parking lot');
    sql(setpoint, `UPDATE news_articles SET sorted_at = '2026-10-07T16:12:00.000Z' WHERE id IN (SELECT id FROM news_articles WHERE source_id IN (SELECT id FROM news_sources WHERE key LIKE 'fixture:%') ORDER BY id LIMIT 4)`);
    await setpoint.api('POST', '/news/seen', {story_ids: [council]});
    await until('the count follows', () => unsorted.locator('.grow').textContent(), text => text?.startsWith('8 articles not sorted yet') ?? false);
    // Sorting back: the line goes.
    sql(setpoint, 'UPDATE news_sorting SET failing_since = NULL, last_success_at = \'2026-10-07T16:12:00.000Z\'');
    await setpoint.api('POST', '/news/seen', {story_ids: [council]});
    await unsorted.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 29b: the first run, sorting the last 48 hours; no Missed strip; nothing sorted in AI yet; everything new', async () => {
  const setpoint = await startSetpoint({fixtures: ['news-first-run'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const line = page.locator('.nw-state.muted');
    await line.waitFor();
    await row(page, 'Brush fire near the 210').waitFor();
    assert.equal(await line.textContent(), 'Sorting the last 48 hours · 186 of 312 articles · showing what’s sorted so far');
    assert.deepEqual(await line.evaluate(bar => [bar.getBoundingClientRect().height, getComputedStyle(bar).color]), [32, await colourOf(page, 'var(--ink3)')]);
    // The spinner turns once every 900 ms wherever it shows (DESIGN.md #54), and sits where the board draws it.
    // Its place is the wrapper's, which stays still while the icon inside turns.
    assert.deepEqual(await line.locator('.spin').evaluate(spin => {
      const style = getComputedStyle(spin.querySelector('.icon')!);
      return [style.animationName, style.animationDuration, style.animationIterationCount, Math.round(spin.getBoundingClientRect().left - spin.closest('.nw-state')!.getBoundingClientRect().left)];
    }), ['spin', '0.9s', 'infinite', 24]);
    assert.equal(await page.locator('.nw-missed').count(), 0, 'no Missed strip');
    assert.equal(await page.locator('.nw-state.failing').count(), 0, 'articles waiting while sorting runs are no Unsorted line');
    const ai = page.locator('.nw-sec', {hasText: 'AI'}).locator('xpath=following-sibling::*[1]');
    assert.deepEqual(await ai.evaluate(element => [element.className, element.textContent]), ['nw-empty', 'Nothing sorted in AI yet']);
    assert.equal(await page.locator('.nw-list [data-story]:not(.new)').count(), 0, 'everything starts new');
    await settle(page);
    await matchGolden(page, '29b-states-first-run', 'news');
    // A section's own list says the same.
    await page.locator('.hd .seg button', {hasText: 'AI'}).click();
    await page.locator('.nw-empty', {hasText: 'Nothing sorted in AI yet'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('offline on News: the pill, the page dimmed, its keys refused; back, the pill goes', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await page.context().setOffline(true);
    const pill = page.locator('.offline-pill');
    await pill.waitFor();
    assert.equal(await pill.textContent(), 'Offline, as of 9:12 AM, retryingRetry now');
    assert.deepEqual(await page.locator('.main.offline > .content').evaluate(content => [getComputedStyle(content).opacity, getComputedStyle(content).pointerEvents]), ['0.4', 'none']);
    await page.mouse.move(700, 28);
    await page.keyboard.press('j');
    // Nothing happens to wait for: offline, J moves no cursor.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal(await page.locator('.nw-list .cur').count(), 0);
    await page.context().setOffline(false);
    await pill.waitFor({state: 'detached'});
    await page.keyboard.press('j');
    await page.locator('.nw-list .cur').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Search news: the stories found replace the list, the archive too; one opens in the pane; Esc closes it, then clears the search', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('warehouse');
    const results = page.locator('section.nw-list[aria-label="Stories found"]');
    await results.locator('.bar.muted', {hasText: '1 result'}).waitFor();
    // Mail's search header (#8): Search, no segmented control, the field 520 wide with its Esc hint.
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.equal(await page.locator('.hd .seg').count(), 0);
    assert.deepEqual(await page.locator('.hd .search').evaluate(field => [field.getBoundingClientRect().width, field.querySelector('.kbd')?.textContent]), [520, 'Esc']);
    assert.equal(await results.locator('.bar.muted').textContent(), '1 result·newest first');
    assert.equal(await page.locator('.nw-missed, .nw-sec, .nw-pill').count(), 0, 'the list, its strip and headers, are replaced');
    const found = results.locator('[data-story]');
    assert.equal(await found.count(), 1);
    assert.deepEqual(await found.first().locator('.side .nw-meta').allTextContents(), ['General·ABC News +7', 'Updated 7:10 AM']);
    await settle(page);
    await matchGolden(page, 'news-search', 'main');

    // A story that left the page is found too (the archive), and opens in the pane.
    await page.locator('.hd .search input').fill('tornado');
    await until('the tornado story', () => found.first().textContent(), text => text?.startsWith('Tornado outbreak across Oklahoma and Kansas') ?? false);
    await found.first().click();
    await page.locator('.pane .rd-subj', {hasText: 'Tornado outbreak across Oklahoma and Kansas'}).waitFor();
    assert.match(await found.first().getAttribute('class') ?? '', /\bopen\b/);
    // Esc closes the pane, then clears the search, and the list is back.
    await page.keyboard.press('Escape');
    await until('the pane closes', () => page.locator('section.pane').count(), count => count === 0);
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    await page.keyboard.press('Escape');
    await page.locator('.hd-title', {hasText: 'News'}).waitFor();
    await row(page, 'Brush fire near the 210').waitFor();
    assert.equal(await page.locator('.hd .search input').inputValue(), '');

    // No results: the words, removable.
    await page.keyboard.press('/');
    await page.keyboard.type('zeppelin');
    await page.locator('.no-results', {hasText: 'No stories match'}).waitFor();
    assert.equal(await page.locator('.no-results').textContent(), 'No stories matchzeppelin');
    await page.getByRole('button', {name: 'Remove zeppelin'}).click();
    await row(page, 'Brush fire near the 210').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
