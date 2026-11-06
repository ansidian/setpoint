// News (N4; DESIGN.md › News, boards 25–27) against the seed's sample (BRIEF.md › Sample data ›
// News): All's blocks with the recap, Upcoming and the pill; the story pane, its Sources, an article
// (26a) and one that can't be read here (26b); a section (27) with Also reported (D452); While you were away (#298) with Done
// and Undo; seen; the held order with the pill; Add to calendar; the keys; and board 31, board 25 in
// Light (N5); Tab and Shift-Tab between the views (SV-207). A change to News arrives as ingest's will: the
// server's database changes, then a `news` live event names stories (here, seeing one already seen
// sends it, as nothing else in the server writes News yet).
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {NewsPageOut, NewsSectionOut, StoryOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, matchGolden, nearPx, pagePx, rested, SIZES, startSetpoint, test, until, ZOOM} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const list = (page: Page) => page.locator('.nw-list .list');
const row = (page: Page, headline: string) => page.locator('.nw-list [data-story]', {hasText: headline}).first();

/** A story's id by its headline, as the server has it. */
async function storyId(setpoint: Setpoint, headline: string): Promise<number> {
  for (const section of ['local', 'tech', 'ai', 'general']) {
    const found = (await setpoint.api<NewsSectionOut>('GET', `/news/sections/${section}`)).stories.find(story => story.headline === headline);
    if (found) return found.id;
  }
  throw new Error(`No story "${headline}".`);
}

const stateOf = async (setpoint: Setpoint, id: number) => (await setpoint.api<StoryOut>('GET', `/news/stories/${id}`)).state;

/**
 * All without its recap, as it is once an hour away has put it away: for the checks about the blocks
 * under it, whose rows it would push down. The route stays for the iPhone app (D451).
 */
const putRecapAway = (setpoint: Setpoint) => setpoint.api('POST', '/news/recap/done');

/** The recap's stories, as the page sends them once it's on screen. */
const recapShown = (page: Page) => page.waitForResponse(response => response.url().endsWith('/api/news/here')
  && (response.request().postDataJSON() as {recap: number[] | null}).recap !== null);

/**
 * Waits until the server has seen every story whose row is wholly in the list's view with a dot
 * (DESIGN.md › Keys and behaviour: about a second); the dots stay for the visit (#95). Resolves with
 * those stories.
 */
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

/** A colour as the page computes it, to compare with a computed style. */
const colourOf = (page: Page, colour: string) => page.evaluate(value => {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, colour);

const GLYPH_NAMES = new Map<string, string>(Object.entries(ICONS).map(([name, path]) => [path, name]));
/** Each glyph's name (from its bundled path), size and colour. */
const glyphs = async (icons: Locator) => (await icons.evaluateAll(all => all.map(icon => [icon.querySelector('path')!.getAttribute('d')!, icon.getAttribute('width'), getComputedStyle(icon).color])))
  .map(([path, size, colour]) => [GLYPH_NAMES.get(path!) ?? 'unknown', size, colour]);

/** A background as the page computes it, mixes included. */
const backgroundOf = (page: Page, background: string) => page.evaluate(value => {
  const probe = document.createElement('div');
  probe.style.background = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return computed;
}, background);

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Out of the way of every row, so no hover fill shows.
  await page.mouse.move(700, 28);
  // Lets a hover fill the move left fade out (120 ms) before the screenshot.
  await page.waitForTimeout(250);
}

/**
 * Changes News as ingest and ranking would, in the server's own database, then sends a `news` event
 * naming a story: seeing Council's story, which the user saw on Monday, changes nothing else.
 */
async function newsChange(setpoint: Setpoint, sql: string) {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec(sql);
  } finally {
    database.close();
  }
  const council = await storyId(setpoint, 'Council approves a 120-unit housing project on a former parking lot');
  await setpoint.api('POST', '/news/seen', {story_ids: [council]});
}

// The pill as board 25 draws it: three stories ranked into view that the user hasn't seen (Water main
// into Local, visionOS into Tech, Hugging Face into AI), and the cooling centers, seen on Monday,
// with a new fact that ranks it second in Local.
const THREE_NEW_ONE_UPDATED = `
  UPDATE news_stories SET score = 99 WHERE headline IN ('Water main break floods an intersection; repairs through Thursday',
    'visionOS 26.1 brings shared Personas to group FaceTime calls', 'Hugging Face adds hosted inference for open video models');
  UPDATE news_stories SET score = 98, last_new_fact_at = '2026-10-07T16:05:00.000Z' WHERE headline = 'County opens cooling centers as temperatures reach 100°';
  INSERT INTO news_facts (story_id, at, text) SELECT id, '2026-10-07T16:05:00.000Z', 'Two more centers open in the valleys' FROM news_stories
    WHERE headline = 'County opens cooling centers as temperatures reach 100°';`;

test('board 25: All on a typical morning, the recap, Upcoming, the pill, and the brush fire story open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210 grows to 400 acres').waitFor();
    await page.locator('.today-row').first().waitFor();
    assert.equal(await page.title(), 'News');
    // The shell: News under Calendar, current, with no count (Jobs under it).
    assert.deepEqual(await page.locator('aside.sb .nav').allTextContents(), ['Inbox319', 'Calendar', 'News', 'Jobs3', 'Settings⌘,']);
    assert.equal(await page.locator('aside.sb .nav.on').textContent(), 'News');
    assert.deepEqual(await page.locator('.hd .seg button').allTextContents(), ['All', 'Local', 'Tech', 'AI', 'General']);
    assert.equal(await page.locator('.hd .search input').getAttribute('placeholder'), 'Search news');
    // The recap first, with no Done, then the blocks in their fixed order (D451).
    assert.deepEqual(await page.locator('.nw-sec').allTextContents(), ['While you were awaysince Mon 10:40 PM', 'Local', 'Tech', 'AI', 'General']);
    assert.equal(await page.locator('.nw-recap button').count(), 0);
    // Each section's glyph before its name, and the recap's `history`, 14 px in ink3, the name in ink2 (#120).
    const ink3 = await colourOf(page, 'var(--ink3)');
    assert.deepEqual(await rested(() => glyphs(page.locator('.nw-sec > .icon'))),
      [['history', '14', ink3], ['location_on', '14', ink3], ['computer', '14', ink3], ['auto_awesome', '14', ink3], ['public', '14', ink3]]);
    assert.equal(await rested(() => page.locator('.nw-sec').nth(1).evaluate(header => getComputedStyle(header).color)), await rested(() => colourOf(page, 'var(--ink2)')));
    // Each block ends after its stories, with no "N more in ‹section›" (D451).
    assert.equal(await page.getByText(/ more in /).count(), 0);
    assert.equal(await page.locator('.nw-recap [data-story]').count(), 8);
    assert.equal(await page.locator('.nw-up').textContent(), 'UpcomingApple event · Tue Oct 20 · 10 AMMacRumors +6Add to calendar');
    // The meta: the lead's on one line, a row's on two.
    assert.equal(await row(page, 'Brush fire near the 210').locator('.nw-meta').textContent(), 'KTLA +4·1h·Updated 8:40 AM');
    assert.deepEqual(await row(page, 'Man arrested after a stabbing').locator('.side .nw-meta').allTextContents(), ['NBC LA +2', 'Updated 7:55 AM']);
    assert.deepEqual(await row(page, 'Federal agents detain 9').locator('.side .nw-meta').allTextContents(), ['LAist +3', 'Yesterday']);

    // The single values: the lead's image and the dots. With nothing open the list
    // is 1,429 px wide, and its leads grow: 320 × 180 (#127).
    const lead = row(page, 'Brush fire near the 210');
    const leadImage = () => lead.locator('img').evaluate(image => [image.getBoundingClientRect().width, image.getBoundingClientRect().height, getComputedStyle(image).objectFit, getComputedStyle(image).borderRadius]).then(([width, height, ...rest]) => [pagePx(width as number), pagePx(height as number), ...rest]);
    const leadColumns = () => lead.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').slice(0, 2)).then(columns => columns.map(nearPx).join(' '));
    assert.deepEqual(await rested(() => leadImage()), [320, 180, 'cover', '12px']);
    assert.equal(await rested(() => leadColumns()), '12px 320px');
    const redFlag = row(page, 'Red Flag Warning');
    assert.equal(await redFlag.locator('img').count(), 0, 'NWS\'s story has no image');
    assert.equal(await row(page, 'Council approves').locator('img, .nw-hz').count(), 0, 'an outlet\'s story without an image leaves its column empty');
    const dot = (headline: string) => row(page, headline).locator('.nd').evaluate(element => getComputedStyle(element, '::before').backgroundColor);
    // The General block's rows are below the fold, so they're still new or updated here.
    assert.equal(await dot('Federal judge blocks a rule'), await colourOf(page, 'var(--ink)'), 'new: ink');
    assert.equal(await rested(() => dot('Four killed in a warehouse shooting')), await rested(() => colourOf(page, 'var(--accent)')), 'updated: accent');

    // Under the recap, Local's lead is on screen and seen.
    const seen = await seenSettled(page, setpoint);
    assert.ok(seen.includes(await storyId(setpoint, 'Brush fire near the 210 grows to 400 acres')), 'the brush fire story was seen');
    // Seen, its dot stays for the visit (#95).
    assert.equal(await dot('Brush fire near the 210'), await colourOf(page, 'var(--accent)'));
    await newsChange(setpoint, THREE_NEW_ONE_UPDATED);
    const pill = page.locator('.nw-pill');
    await until('the pill', () => pill.textContent(), text => text === '3 new · 1 updatedN');

    await lead.click();
    await page.locator('.pane .rd-subj', {hasText: 'Brush fire near the 210 grows to 400 acres'}).waitFor();
    await page.locator('.st-new .lab', {hasText: 'New since you looked · Mon 10:40 PM'}).waitFor();
    await page.locator('.pane .src-row').first().waitFor();
    assert.equal(await page.title(), 'Brush fire near the 210 grows to 400 acres');
    // With the pane open the list is under 1000 px, and the lead is the boards' 232 × 130 again; opened,
    // it's seen, and stays ink (#127).
    assert.deepEqual(await leadImage(), [232, 130, 'cover', '12px']);
    assert.equal(await rested(() => leadColumns()), '12px 232px');
    assert.equal(await rested(() => lead.locator('.hl').evaluate(element => getComputedStyle(element).color)), await rested(() => colourOf(page, 'var(--ink)')));
    await seenSettled(page, setpoint);
    await settle(page);
    await matchGolden(page, '25-news-a-typical-morning');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 31: board 25 in Light', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.emulateMedia({colorScheme: 'light'});
    await page.goto(`${setpoint.base}/news`);
    const lead = row(page, 'Brush fire near the 210 grows to 400 acres');
    await lead.waitFor();
    await page.locator('.today-row').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    // Board 25's state: the pill, then the brush fire story open.
    await seenSettled(page, setpoint);
    await newsChange(setpoint, THREE_NEW_ONE_UPDATED);
    await page.locator('.nw-pill', {hasText: '3 new · 1 updated'}).waitFor();

    await lead.click();
    await page.locator('.st-new .lab', {hasText: 'New since you looked · Mon 10:40 PM'}).waitFor();
    await page.locator('.pane .src-row').first().waitFor();
    await page.locator('.pane .st-img .nw-img').evaluate((image: HTMLImageElement) => image.decode());
    await seenSettled(page, setpoint);
    await settle(page);
    await matchGolden(page, '31-light-news');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-141: News has one right edge: at the design target it\'s the row\'s end, and on a very wide window the thumbnails, Upcoming and the search field all stop at it, a story\'s pane taking the header to its end', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const rights = (page: Page, cells: string) => rested(() => page.evaluate(selector => [...new Set([...document.querySelectorAll(selector)].map(each => Math.round(each.getBoundingClientRect().right)))], cells));
    const ENDS = '.nw-row img, .nw-up .btn, .hd .search';
    const target = await setpoint.page('target');
    await target.goto(`${setpoint.base}/news`);
    assert.deepEqual(await rights(target, ENDS), [Math.round(SIZES.target.width - 16 * ZOOM)], 'the row\'s end, as ever');
    const width = 2655;
    const wide = await setpoint.page({width, height: 1400});
    await wide.goto(`${setpoint.base}/news`);
    const ends = await rights(wide, ENDS);
    assert.equal(ends.length, 1, `one right edge: ${ends.join()}`);
    assert.ok(width - ends[0]! > 300, `spare width past it: ${width - ends[0]!}`);
    await wide.locator('.nw-row').first().click();
    await wide.locator('.pane').waitFor();
    assert.deepEqual(await rights(wide, '.hd .search'), [width - 20], 'beside the pane the header runs to its end');
  } finally {
    await setpoint.stop();
  }
});

test('D451: a block whose stories all show in other blocks isn\'t drawn in All; the section\'s own list still holds them', async () => {
  const setpoint = await startSetpoint();
  try {
    // Every Tech story's main section made AI (the seed's stand-ins have no reading, so it's their first), and Tech's Upcoming gone.
    await newsChange(setpoint, `
      UPDATE news_story_sections SET position = position + 1 WHERE story_id IN (SELECT story_id FROM news_story_sections WHERE section = 'tech');
      INSERT OR REPLACE INTO news_story_sections (story_id, section, position) SELECT story_id, 'ai', 0 FROM news_story_sections WHERE section = 'tech';
      DELETE FROM news_events;`);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    assert.deepEqual(await page.locator('.nw-sec').allTextContents(), ['While you were awaysince Mon 10:40 PM', 'Local', 'AI', 'General']);
    await page.locator('.hd .seg button', {hasText: 'Tech'}).click();
    await until('Tech\'s own list', () => page.locator('.nw-list [data-story]').count(), count => count > 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('#121: a hazard source\'s story without a photo shows its hazard\'s glyph in a caution tile; as a lead, before its headline', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const redFlag = row(page, 'Red Flag Warning');
    await redFlag.waitFor();
    const caution = await rested(() => colourOf(page, 'var(--caution)'));
    const tile = redFlag.locator('.nw-hz');
    assert.deepEqual(await rested(() => tile.evaluate(box => [box.getBoundingClientRect().width, box.getBoundingClientRect().height, getComputedStyle(box).borderRadius, getComputedStyle(box).backgroundColor]).then(([width, height, ...rest]) => [pagePx(width as number), pagePx(height as number), ...rest])),
      [72, 48, '8px', await rested(() => backgroundOf(page, 'color-mix(in oklch, var(--caution) 10%, transparent)'))]);
    assert.deepEqual(await rested(() => glyphs(tile.locator('.icon'))), [['thunderstorm', '22', caution]]);
    // The tile sits in the thumbnail's column, level with a photo's.
    const photo = row(page, 'Federal agents detain 9').locator('img');
    assert.equal(await rested(() => tile.evaluate(box => box.getBoundingClientRect().right)), await rested(() => photo.evaluate(image => image.getBoundingClientRect().right)));
    assert.equal(await row(page, 'Council approves').locator('.nw-hz').count(), 0, 'an outlet\'s story leaves its column empty');
    // Ranked first in Local, it leads the block without a photo: an 18 px glyph before its headline, no tile.
    await newsChange(setpoint, `UPDATE news_stories SET score = 99 WHERE headline = 'Red Flag Warning for the valleys until Thu 6 PM'`);
    await page.reload();
    const lead = page.locator('.nw-lead', {hasText: 'Red Flag Warning'});
    await lead.waitFor();
    assert.equal(await lead.locator('.nw-hz, img').count(), 0);
    assert.deepEqual(await rested(() => glyphs(lead.locator('.hl .hz .icon'))), [['thunderstorm', '18', caution]]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the story pane: its head, New since you looked, Sources; an article (26a), Back, and one that can\'t be read here (26b)', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const fire = row(page, 'Brush fire near the 210 grows to 400 acres');
    await fire.click();
    const pane = page.locator('section.pane');
    await pane.locator('.src-row').first().waitFor();
    assert.equal(await pane.locator('.rd-tools').textContent(), 'Open at KTLAO');
    assert.deepEqual(await pane.locator('.st-secs .tag').allTextContents(), ['Local', 'Updated']);
    assert.equal(await pane.locator('.st-meta').textContent(), '5 outlets·first reported Mon 6:12 AM·updated 8:40 AM');
    assert.equal(await pane.locator('.st-img .cap').textContent(), 'KTLA');
    assert.deepEqual(await pane.locator('.st-new .it').allTextContents(), ['8:40 AMGrew from 150 to 400 acres overnight; evacuation warnings widened', '6:55 AMTwo schools in the warning area are closed for the day']);
    assert.deepEqual(await pane.locator('.src-row .o').allTextContents(), ['KTLASummary only', 'NBC Los Angeles', 'CBS Los Angeles', 'ABC7', 'FOX 11']);
    assert.deepEqual(await pane.locator('.src-row .fav').allTextContents(), ['K', 'NBC', 'CBS', '7', '11']);
    // The pane's body as one 600 px column at the reading measure (#98) is by eye (D417).
    // Opening it saw it: its dot goes at once, and the server has it.
    const fireId = await storyId(setpoint, 'Brush fire near the 210 grows to 400 acres');
    await until('seen on the server', () => stateOf(setpoint, fireId), state => state === 'seen');
    assert.match(await fire.getAttribute('class') ?? '', /\bseen\b/);
    // Still new since the user's last look before this visit.
    await pane.locator('.st-new').waitFor();

    // An article in the pane (26a).
    await pane.locator('.src-row', {hasText: 'NBC Los Angeles'}).click();
    await page.waitForURL(/\/news\/story\/\d+\/article\/\d+$/);
    await pane.locator('.ar-text p').first().waitFor();
    assert.equal(await pane.locator('.rd-tools').textContent(), 'Back to storyEscOpen at NBC Los AngelesO');
    assert.equal(await pane.locator('.ar-out').textContent(), 'NBCNBC Los Angeles·7:10 AM·Staff report');
    assert.equal(await pane.locator('.ar-title').textContent(), 'Fire burns 400 acres in the foothills; evacuation warnings issued');
    assert.equal(await pane.locator('.ar-text p').count(), 5);
    // Esc goes back to the story.
    await page.keyboard.press('Escape');
    await pane.locator('.st-head').waitFor();
    assert.match(page.url(), /\/news\/story\/\d+$/);

    // One that can't be read here (26b): its note, Read at, the feed summary, and the other sources.
    await pane.locator('.src-row', {hasText: 'KTLA'}).click();
    await pane.locator('.ar-note').waitFor();
    assert.equal(await pane.locator('.ar-note').textContent(), 'KTLA\'s page can\'t be read here, so this is its feed summaryRead at KTLA');
    assert.match(await pane.locator('.ar-text').textContent() ?? '', /^A brush fire burning above the 210 Freeway grew to roughly 400 acres overnight/);
    assert.equal(await pane.locator('.st-label').textContent(), 'Also in this story');
    assert.deepEqual(await pane.locator('.src-row .o').allTextContents(), ['NBC Los Angeles', 'CBS Los Angeles', 'ABC7', 'FOX 11']);
    // The Back tool, then Esc closes the pane.
    await pane.locator('.tool', {hasText: 'Back to story'}).click();
    await pane.locator('.st-head').waitFor();
    await page.keyboard.press('Escape');
    await until('the pane closes', () => page.locator('section.pane').count(), count => count === 0);
    assert.equal(await page.title(), 'News');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('New since you looked shows the newest four facts, then "6 more"; a click opens the rest and the card grows (the polish audit\'s news-12)', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    // Eight more facts for the brush fire story since the user's last look, ten in all.
    await newsChange(setpoint, Array.from({length: 8}, (_, index) => `INSERT INTO news_facts (story_id, at, text)
      SELECT id, '2026-10-07T${String(5 + index).padStart(2, '0')}:00:00.000Z', 'Fact ${index + 1} since the last look' FROM news_stories
      WHERE headline = 'Brush fire near the 210 grows to 400 acres';`).join('\n'));
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210 grows to 400 acres').click();
    const card = page.locator('.pane .st-new');
    await card.locator('.st-fold').waitFor();
    const visible = () => card.locator('.it').evaluateAll(lines => lines.filter(line => line.getBoundingClientRect().height > 0 && !line.closest('[inert]')).map(line => line.lastElementChild!.textContent));
    assert.deepEqual(await rested(() => visible()), ['Grew from 150 to 400 acres overnight; evacuation warnings widened', 'Two schools in the warning area are closed for the day', 'Fact 8 since the last look', 'Fact 7 since the last look']);
    assert.equal(await card.locator('.st-fold').textContent(), '6 more');
    const closed = await rested(() => card.evaluate(element => element.getBoundingClientRect().height));

    await card.locator('.st-fold').click();
    await until('all ten facts', visible, lines => lines.length === 10);
    assert.equal(await card.locator('.st-fold').textContent(), 'Show fewer');
    assert.deepEqual((await rested(() => glyphs(card.locator('.st-fold .icon'))))[0]![0], 'expand_less');
    // Grown by the six facts' lines once it settles.
    await until('the card grown', () => card.evaluate(element => element.getBoundingClientRect().height), height => height > closed + 6 * 20);
    await card.locator('.st-fold').click();
    await until('back to four', visible, lines => lines.length === 4);
    await until('the card back', () => card.evaluate(element => element.getBoundingClientRect().height), height => height === closed);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a section (27): the header\'s Local opens Local\'s full list, biggest first, the first as a lead; a story All doesn\'t show is seen once Local shows it', async () => {
  const setpoint = await startSetpoint();
  try {
    const water = await storyId(setpoint, 'Water main break floods an intersection; repairs through Thursday');
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await seenSettled(page, setpoint);
    assert.equal(await stateOf(setpoint, water), 'new', 'not on All\'s front page, it isn\'t seen there');
    await page.locator('.hd .seg button', {hasText: 'Local'}).click();
    await page.waitForURL(/\/news\/local$/);
    await until('Local\'s whole list', () => page.locator('.nw-list [data-story]').count(), count => count === 17);
    assert.equal(await page.locator('.hd .seg .on').textContent(), 'Local');
    assert.equal(await page.locator('.nw-sec').count(), 0);
    assert.equal(await page.locator('.nw-recap').count(), 0, 'the recap is All\'s alone');
    assert.deepEqual(await page.locator('.nw-list [data-story]').evaluateAll(rows => rows.map(element => element.className.split(' ')[0])).then(classes => classes.slice(0, 3)), ['nw-lead', 'nw-row', 'nw-row']);
    // Shown now, Water main is seen after its second on screen.
    await until('Water main seen', () => stateOf(setpoint, water), state => state === 'seen', 5000);
    await seenSettled(page, setpoint);
    // Also reported ends the list (D452): the stories never written, headline, outlet and age, each a
    // link to its outlet's article; none is a story row, so none has a dot or is seen.
    const also = page.locator('.nw-also');
    assert.equal(await also.locator('.nw-also-hd').textContent(), 'Also reported');
    assert.deepEqual(await also.locator('a .hl').allTextContents(), ['Central library hosts a fall book sale this weekend', 'Street sweeping resumes on the usual routes after the holiday']);
    assert.deepEqual(await also.locator('a').evaluateAll(links => links.map(link => [link.getAttribute('target'), link.querySelector('.outlet')!.textContent])), [['_blank', 'LAist'], ['_blank', 'ABC7']]);
    assert.equal(await also.locator('[data-story], .nd').count(), 0);
    assert.ok(await page.evaluate(() => {
      const stories = [...document.querySelectorAll('.nw-list [data-story]')];
      return Boolean(stories.at(-1)!.compareDocumentPosition(document.querySelector('.nw-also')!) & Node.DOCUMENT_POSITION_FOLLOWING);
    }), 'after the section\'s stories');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('While you were away (#298): All opens with the recap, each section\'s biggest two without dots, naming their sections; opened, one dims; nothing slides in, and the pill counts none of it', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    const shown = recapShown(page);
    await page.goto(`${setpoint.base}/news`);
    const recap = page.locator('.nw-recap');
    await recap.waitFor();
    const fixed = (await shown).request().postDataJSON() as {recap: number[]};
    assert.equal(await recap.locator('.nw-sec').textContent(), 'While you were awaysince Mon 10:40 PM');
    const headlines = () => recap.locator('[data-story] .hl').evaluateAll(all => all.map(element => element.textContent!.split(' ').slice(0, 2).join(' ')));
    const before = await headlines();
    assert.deepEqual(before, [
      'Overnight closures', 'Teen hurt', 'iOS 26.1', 'Samsung sets', 'Google DeepMind', 'OpenAI opens', 'Tornado outbreak', 'Amtrak derailment',
    ]);
    assert.deepEqual(fixed.recap, (await setpoint.api<NewsPageOut>('GET', '/news')).recap!.stories.map(story => story.id), 'the page tells the server what it shows');
    const tornado = row(page, 'Tornado outbreak across Oklahoma and Kansas');
    // Ages follow DESIGN.md › Copy: Tuesday is "Yesterday" on a Wednesday.
    assert.deepEqual(await tornado.locator('.side .nw-meta').allTextContents(), ['General·NPR +9', 'Yesterday']);
    // No dots: every row's headline as a new one's, ink at 500, with nothing in the dot's place.
    const look = (locator: Locator) => locator.evaluate(element => [
      getComputedStyle(element.querySelector('.nd')!, '::before').backgroundColor, getComputedStyle(element.querySelector('.hl')!).color, getComputedStyle(element.querySelector('.hl')!).fontWeight,
    ]);
    const ink = await rested(() => colourOf(page, 'var(--ink)'));
    assert.deepEqual(await rested(() => look(tornado)), ['rgba(0, 0, 0, 0)', ink, '500']);

    // Opened, it's seen and its headline turns a seen row's, ink2 at 400.
    const tornadoId = Number(await tornado.getAttribute('data-story'));
    await tornado.click();
    await page.locator('.pane .rd-subj', {hasText: 'Tornado outbreak'}).waitFor();
    await until('the tornado seen', () => stateOf(setpoint, tornadoId), state => state === 'seen');
    await until('it dims', () => look(tornado), seen => seen[2] === '400');
    assert.deepEqual(await rested(() => look(tornado)), ['rgba(0, 0, 0, 0)', await rested(() => colourOf(page, 'var(--ink2)')), '400']);
    // Being on screen doesn't see the others: they stay unseen, once the rows in view with a dot have been.
    await seenSettled(page, setpoint);
    assert.equal(await stateOf(setpoint, fixed.recap[0]!), 'new');

    // A bigger story leaves the page unseen: fixed once on screen, the recap takes nothing in, here or on the server.
    // What the open asked is answered first, so the answer waited for is the change's.
    await setpoint.idle();
    const asked = page.waitForResponse(response => response.url().endsWith('/api/news') && response.request().method() === 'GET');
    await newsChange(setpoint, `UPDATE news_stories SET score = 99, expired_at = '2026-10-07T15:00:00.000Z', expired_unseen = 1
      WHERE headline = 'Water main break floods an intersection; repairs through Thursday';`);
    await asked;
    // Nothing happens to wait for: the recap holds.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.deepEqual(await headlines(), before);
    assert.equal(await page.locator('.nw-pill').count(), 0, 'the pill counts none of it');
    assert.deepEqual((await setpoint.api<NewsPageOut>('GET', '/news')).recap!.stories.map(story => story.id), fixed.recap);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the recap has no Done (D451): only the server puts it away, after an hour away, its stories still unseen; put away, the next visit has none', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    const shown = recapShown(page);
    await page.goto(`${setpoint.base}/news`);
    const recap = page.locator('.nw-recap');
    await recap.waitFor();
    await shown;
    assert.equal(await recap.locator('button').count(), 0, 'nothing on the web puts it away');
    const ids = (await setpoint.api<NewsPageOut>('GET', '/news')).recap!.stories.map(story => story.id);
    // As the server does an hour after it has shown with the user away (server/tests/news.test.ts has the hour).
    await putRecapAway(setpoint);
    await page.reload();
    await row(page, 'Brush fire near the 210').waitFor();
    assert.equal(await page.locator('.nw-recap').count(), 0);
    assert.equal(await page.locator('.nw-sec').first().textContent(), 'Local', 'Local is All\'s first block again');
    assert.deepEqual(await Promise.all(ids.map(id => stateOf(setpoint, id))), ids.map(() => 'new'), 'put away, not seen (D426)');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('seen: the stories on screen as the page loads, or opened, even off screen; the dots stay for the visit and are gone in the next', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const hurricane = await storyId(setpoint, 'Hurricane Teresa makes landfall in the Florida Panhandle as a Category 3');
    const pixel = await storyId(setpoint, 'Pixel Watch 5 goes on sale with two-day battery life');
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await seenSettled(page, setpoint);
    assert.equal(await stateOf(setpoint, hurricane), 'new', 'below the fold');
    // How long on screen counts, and flicking past not, are sight's, dueSeen's and nextSeen's, tables in
    // news.test.ts; the scrolls they needed here went (D416).
    // The rows seen on arrival keep their dots for the visit (#95).
    assert.match(await row(page, 'Red Flag Warning').getAttribute('class') ?? '', /\bnew\b/);
    // A reload is a new visit: the stories seen have no dot.
    await page.reload();
    await row(page, 'Red Flag Warning').waitFor();
    assert.match(await row(page, 'Red Flag Warning').getAttribute('class') ?? '', /\bseen\b/);
    assert.match(await row(page, 'Hurricane Teresa').getAttribute('class') ?? '', /\bnew\b/, 'below the fold, still new');
    // A seen lead keeps its ink, at 400, so it never ranks below a row; a seen row is ink2 (#127).
    const ink = (headline: string) => row(page, headline).locator('.hl').evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).fontWeight]);
    assert.match(await row(page, 'Brush fire near the 210').getAttribute('class') ?? '', /^nw-lead seen\b/);
    assert.deepEqual(await rested(() => ink('Brush fire near the 210')), [await rested(() => colourOf(page, 'var(--ink)')), '400']);
    assert.deepEqual(await rested(() => ink('Red Flag Warning')), [await rested(() => colourOf(page, 'var(--ink2)')), '400']);
    // Seen by Pixel Watch's opening, even off screen.
    await page.goto(`${setpoint.base}/news/story/${pixel}`);
    await until('Pixel Watch seen', () => stateOf(setpoint, pixel), state => state === 'seen');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the order holds: a change updates rows on screen in place, the rest waits behind the pill; the pill and N take it', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await seenSettled(page, setpoint);
    const order = () => page.locator('.nw-list [data-story]').evaluateAll(rows => rows.map(element => (element as HTMLElement).dataset.story));
    const before = await order();
    // A new fact for the car wash story on screen, and a new line for the Red Flag Warning's.
    const carWash = row(page, 'Federal agents detain 9 at a car wash');
    await newsChange(setpoint, `${THREE_NEW_ONE_UPDATED}
      UPDATE news_stories SET last_new_fact_at = '2026-10-07T16:06:00.000Z' WHERE headline = 'Federal agents detain 9 at a car wash';
      UPDATE news_stories SET one_line = 'Gusts to 60 mph, humidity under 8%' WHERE headline = 'Red Flag Warning for the valleys until Thu 6 PM';`);
    const pill = page.locator('.nw-pill', {hasText: '3 new · 1 updated'});
    await pill.waitFor();
    await row(page, 'Red Flag Warning').locator('.sm', {hasText: 'Gusts to 60 mph, humidity under 8%'}).waitFor();
    await until('the car wash turns updated in place', () => carWash.getAttribute('class'), value => /\bupd\b/.test(value ?? ''));
    assert.deepEqual(await order(), before, 'nothing moved');
    // N takes the new order; its scroll to the top is by eye (D416).
    await page.keyboard.press('n');
    await until('the new order', () => page.locator('.nw-list [data-story]').first().textContent(), text => text?.startsWith('Water main break floods an intersection') ?? false);
    const arrived = [...new Set((await order()).filter(id => !before.includes(id)))].sort();
    assert.deepEqual(arrived.length, 4, 'Water main, cooling centers, visionOS and Hugging Face');
    assert.equal(await page.locator('.nw-pill').count(), 0);
    assert.deepEqual((await page.locator('.nw-list [data-story]').allTextContents()).slice(0, 2).map(text => text.slice(0, 20)), ['Water main break flo', 'County opens cooling']);
    // Opening the page always shows the latest order.
    const latest = await setpoint.api<NewsPageOut>('GET', '/news');
    await page.reload();
    await until('the latest order on opening', () => order(), ids => ids.slice(0, latest.blocks[0]!.stories.length).join() === latest.blocks[0]!.stories.map(story => String(story.id)).join());
    assert.equal(await page.locator('.nw-pill').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('keys: 3 opens News; J and K move; Enter opens; J opens the next with one open; O opens the original; Esc closes', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await page.keyboard.press('3');
    await page.waitForURL(/\/news$/);
    await row(page, 'Brush fire near the 210').waitFor();
    await page.evaluate(() => {
      (window as unknown as {opened: string[]}).opened = [];
      window.open = (url?: string | URL) => {
        (window as unknown as {opened: string[]}).opened.push(String(url));
        return null;
      };
    });
    await page.mouse.move(700, 28);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await until('the cursor on the second row', () => page.locator('.nw-list .cur').textContent(), text => text?.startsWith('Red Flag Warning') ?? false);
    await page.keyboard.press('k');
    await until('back on the first', () => page.locator('.nw-list .cur').textContent(), text => text?.startsWith('Brush fire') ?? false);
    await page.keyboard.press('Enter');
    await page.locator('.pane .rd-subj', {hasText: 'Brush fire near the 210'}).waitFor();
    await page.keyboard.press('o');
    await until('KTLA\'s article opened', () => page.evaluate(() => (window as unknown as {opened: string[]}).opened), opened => opened.length === 1);
    assert.match((await page.evaluate(() => (window as unknown as {opened: string[]}).opened))[0]!, /^https:\/\/ktla\.example\//);
    await page.keyboard.press('j');
    await page.locator('.pane .rd-subj', {hasText: 'Red Flag Warning for the valleys'}).waitFor();
    assert.equal(await page.locator('.nw-list .open').textContent().then(text => text?.slice(0, 16)), 'Red Flag Warning');
    await page.keyboard.press('Escape');
    await until('the pane closes', () => page.locator('section.pane').count(), count => count === 0);
    // 1 and 2 still leave for the Inbox and Calendar.
    await page.keyboard.press('2');
    await page.waitForURL(/\/calendar/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-207: Tab and Shift-Tab step All | Local | Tech | AI | General, wrapping, after a click too; the open story stays where the next view lists it; J reaches Also reported, whose Enter opens its article; Tab in Search news is the browser\'s', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const chips = await storyId(setpoint, 'A federal rule on AI chip exports takes effect');
    const fire = await storyId(setpoint, 'Brush fire near the 210 grows to 400 acres');
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await page.evaluate(() => {
      (window as unknown as {opened: string[]}).opened = [];
      window.open = (url?: string | URL) => {
        (window as unknown as {opened: string[]}).opened.push(String(url));
        return null;
      };
    });
    // After a click on a button (All, focused now), Shift-Tab wraps round to General, Tab back to All, then on to Local, its first story under the cursor.
    await page.locator('.hd .seg button', {hasText: 'All'}).click();
    await page.keyboard.press('Shift+Tab');
    await page.waitForURL(/\/news\/general$/);
    await page.keyboard.press('Tab');
    await page.waitForURL(/\/news$/);
    await page.keyboard.press('Tab');
    await page.waitForURL(/\/news\/local$/);
    await until('the cursor on Local\'s first story', () => page.locator('.nw-list .cur').textContent(), text => text?.startsWith('Brush fire near the 210') ?? false);

    // J goes on past the stories into Also reported; Enter there opens the article, not the pane.
    for (let press = 0; press < 25; press += 1) await page.keyboard.press('j');
    await until('the cursor on Also reported\'s last row', () => page.locator('.nw-also .cur .hl').textContent(), text => text === 'Street sweeping resumes on the usual routes after the holiday');
    await page.keyboard.press('Enter');
    await until('ABC7\'s article opened', () => page.evaluate(() => (window as unknown as {opened: string[]}).opened), opened => opened.length === 1);
    assert.match((await page.evaluate(() => (window as unknown as {opened: string[]}).opened))[0]!, /^https:\/\/abc7\.example\//);
    assert.equal(await page.locator('section.pane').count(), 0);

    // A story Tech doesn't list: the pane closes, the cursor on Tech's first story.
    await page.goto(`${setpoint.base}/news/local/story/${fire}`);
    await page.locator('.pane .rd-subj', {hasText: 'Brush fire near the 210'}).waitFor();
    await page.keyboard.press('Tab');
    await page.waitForURL(/\/news\/tech$/);
    await until('the cursor on Tech\'s first story', () => page.locator('.nw-list .cur').textContent(), text => text?.startsWith('Pixel Watch 5') ?? false);
    assert.equal(await page.locator('section.pane').count(), 0);

    // One General lists too: the pane stays on it, there and back.
    await page.goto(`${setpoint.base}/news/ai/story/${chips}`);
    await page.locator('.pane .rd-subj', {hasText: 'A federal rule on AI chip exports'}).waitFor();
    await page.keyboard.press('Tab');
    await page.waitForURL(new RegExp(`/news/general/story/${chips}$`));
    await page.keyboard.press('Shift+Tab');
    await page.waitForURL(new RegExp(`/news/ai/story/${chips}$`));

    // In Search news, Tab is the browser's: focus leaves the field and the view stays.
    await page.keyboard.press('Escape');
    await until('the pane closes', () => page.locator('section.pane').count(), count => count === 0);
    await page.getByRole('textbox', {name: 'Search news'}).focus();
    await page.keyboard.press('Tab');
    await until('focus left the field', () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')), label => label !== 'Search news');
    assert.match(page.url(), /\/news\/ai$/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Upcoming\'s Add to calendar opens Calendar\'s editor on the Apple event, Tue Oct 20 at 10 AM, from the keynote\'s proposal', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    // One path, as an email's: the server's proposal for the keynote (N3), its calendar picked as an email's is.
    const proposed = page.waitForResponse(response => /\/api\/news\/events\/\d+\/proposal$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
    await page.locator('.nw-up .btn', {hasText: 'Add to calendar'}).click();
    const proposal = await (await proposed).json() as {item: {calendar_id: number | null}; from_email: string[]};
    await page.waitForURL(/\/calendar\/new\?kind=event&upcoming=\d+$/);
    const editor = page.locator('.editor');
    await until('the keynote in the editor', () => editor.getByLabel('Describe the event').inputValue(), value => value === 'Apple event');
    assert.deepEqual([await editor.getByLabel('Date', {exact: true}).inputValue(), await editor.getByLabel('Start', {exact: true}).inputValue(), await editor.getByLabel('End', {exact: true}).inputValue()],
      ['Tue, Oct 20', '10:00 AM', '11:00 AM']);
    assert.deepEqual(proposal.from_email, ['title', 'date', 'time']);
    assert.notEqual(proposal.item.calendar_id, null);
    // The news gave the fields, but they carry no "from the email" mark (N5).
    assert.equal(await editor.locator('.srcm').count(), 0, 'no "from the email" marks');
    assert.equal(await editor.locator('.legend').count(), 0, 'no "From the email" legend');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Upcoming\'s row opens a popover with the story behind the keynote, which opens it; Esc or a press outside puts it away (#100)', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const upcoming = page.locator('.nw-up');
    const popover = page.locator('.nw-up-pop');
    await upcoming.locator('.what').click();
    await popover.waitFor();
    assert.equal(await popover.getAttribute('aria-label'), 'The story behind Apple event');
    assert.deepEqual(await popover.locator('.nw-up-story').evaluate(story => [...story.children].map(part => part.textContent)),
      ['Apple sends invites for an Oct 20 event', 'Expected: new iPads and Macs', 'MacRumors +6·Yesterday']);
    assert.match(await upcoming.getAttribute('class') ?? '', /\bon\b/);
    // Esc puts it away, and nothing else: no story was open to close.
    await page.keyboard.press('Escape');
    await until('Esc puts it away', () => popover.count(), count => count === 0);
    assert.equal(new URL(page.url()).pathname, '/news');
    // So does a press outside it.
    await upcoming.locator('.what').click();
    await popover.waitFor();
    await page.locator('.nw-sec', {hasText: 'Local'}).click();
    await until('a press outside puts it away', () => popover.count(), count => count === 0);
    // The story opens it, at its row in the list.
    await upcoming.locator('.what').click();
    await popover.locator('.nw-up-story').click();
    const id = await storyId(setpoint, 'Apple sends invites for an Oct 20 event');
    await page.waitForURL(new RegExp(`/news/story/${id}$`));
    await page.locator('.pane .rd-subj', {hasText: 'Apple sends invites for an Oct 20 event'}).waitFor();
    assert.equal(await popover.count(), 0);
    assert.match(await row(page, 'Apple sends invites for an Oct 20 event').getAttribute('class') ?? '', /\bopen\b/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a narrow list (D104): with a story open at 1280 × 800, Upcoming keeps one line, name · date cut short, and the leads\' images shrink to 160 × 90', async () => {
  const setpoint = await startSetpoint();
  try {
    await putRecapAway(setpoint);
    const page = await setpoint.page({width: 1280, height: 800});
    await page.goto(`${setpoint.base}/news`);
    const fire = row(page, 'Brush fire near the 210 grows to 400 acres');
    await fire.click();
    await page.locator('.pane .src-row').first().waitFor();
    // The pane at its cap leaves the list its 420 px.
    assert.equal(await page.locator('.nw-list').evaluate(element => element.getBoundingClientRect().width), 420);

    const upcoming = page.locator('.nw-up');
    const what = upcoming.locator('span:has(> .what)');
    assert.deepEqual(await rested(() => what.evaluate(element => [getComputedStyle(element).whiteSpace, getComputedStyle(element).textOverflow, element.scrollWidth > element.clientWidth])),
      ['nowrap', 'ellipsis', true], 'name · date is one line, cut short with an ellipsis');
    assert.equal(await what.getAttribute('data-tip'), 'Apple event · Tue Oct 20 · 10 AM');
    assert.equal(await upcoming.locator('.lab').isVisible(), false, 'no UPCOMING label');
    assert.equal(await upcoming.locator('.nw-meta').isVisible(), false, 'no outlet');
    const inside = await rested(() => upcoming.evaluate(element => {
      const box = element.getBoundingClientRect();
      return [...element.children].every(child => {
        const rect = child.getBoundingClientRect();
        return rect.width === 0 || (rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom);
      });
    }));
    assert.equal(inside, true, 'everything in the row stays inside it');
    assert.equal(await upcoming.locator('.btn', {hasText: 'Add to calendar'}).isVisible(), true);

    assert.deepEqual(await rested(() => fire.locator('img').evaluate(image => [image.getBoundingClientRect().width, image.getBoundingClientRect().height])), [160, 90]);
    // Under 480 px a row's summary goes (#128).
    const carWash = row(page, 'Federal agents detain 9 at a car wash');
    assert.equal(await carWash.locator('.sm').isVisible(), false, 'no summary');
    await seenSettled(page, setpoint);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone: News isn\'t in the navigation, and its address opens the Inbox', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/news`);
    await page.waitForURL(/\/inbox$/);
    assert.deepEqual(await page.locator('.ph-tab').allTextContents(), ['Inbox', 'Agenda']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
