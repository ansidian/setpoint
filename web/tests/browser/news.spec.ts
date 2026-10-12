// News (N4; DESIGN.md › News, boards 25–28) against the seed's sample (BRIEF.md › Sample data ›
// News): All's blocks with the Missed strip, Upcoming and the pill; the story pane, its Sources, an
// article (26a) and one that can't be read here (26b); a section (27); Missed (28); seen; the held
// order with the pill; Add to calendar; the keys; and board 31, board 25 in Light (N5). A change to News arrives as ingest's will: the
// server's database changes, then a `news` live event names stories (here, seeing one already seen
// sends it, as nothing else in the server writes News yet).
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after, test} from 'node:test';
import type {MissedOut, NewsPageOut, NewsSectionOut, StoryOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, matchGolden, startSetpoint, still, until, watch} from './harness.ts';
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
 * Waits until the server has seen every story whose row is wholly in the list's view with a dot
 * (DESIGN.md › Keys and behaviour: about a second); the dots stay for the visit (#95). Resolves with
 * those stories.
 */
async function seenSettled(page: Page, setpoint: Setpoint): Promise<number[]> {
  const ids = await list(page).evaluate(scroller => {
    const box = scroller.getBoundingClientRect();
    return [...new Set([...scroller.querySelectorAll<HTMLElement>('[data-key]')].filter(element => {
      const rect = element.getBoundingClientRect();
      return rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5 && (element.classList.contains('new') || element.classList.contains('upd'));
    }).map(element => Number(element.dataset.story)))];
  });
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

test('board 25: All on a typical morning, the Missed strip, Upcoming, the pill, and the brush fire story open', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210 grows to 400 acres').waitFor();
    await page.locator('.today-row').first().waitFor();
    assert.equal(await page.title(), 'News');
    // The shell: News under Calendar, current, with no count.
    assert.deepEqual(await page.locator('aside.sb .nav').allTextContents(), ['Inbox319', 'Calendar', 'News', 'Settings⌘,']);
    assert.equal(await page.locator('aside.sb .nav.on').textContent(), 'News');
    assert.deepEqual(await page.locator('.hd .seg button').allTextContents(), ['All', 'Local', 'Tech', 'AI', 'General']);
    assert.equal(await page.locator('.hd .search input').getAttribute('placeholder'), 'Search news');
    // The blocks in their fixed order, each with its "N more".
    assert.deepEqual(await page.locator('.nw-sec').allTextContents(), ['Local', 'Tech', 'AI', 'General']);
    // Each section's glyph before its name, 14 px in ink3, the name in ink2 (#161).
    const ink3 = await colourOf(page, 'var(--ink3)');
    assert.deepEqual(await glyphs(page.locator('.nw-sec > .icon')), [['location_on', '14', ink3], ['computer', '14', ink3], ['auto_awesome', '14', ink3], ['public', '14', ink3]]);
    assert.equal(await page.locator('.nw-sec').first().evaluate(header => getComputedStyle(header).color), await colourOf(page, 'var(--ink2)'));
    assert.deepEqual(await page.locator('.nw-more').allTextContents(), ['12 more in Local', '7 more in Tech', '4 more in AI', '9 more in General']);
    assert.equal(await page.locator('.nw-missed').textContent(), '14 stories you missed since MonCatch up');
    assert.equal(await page.locator('.nw-up').textContent(), 'UpcomingApple event · Tue Oct 20 · 10 AMMacRumors +6Add to calendar');
    // The meta: the lead's on one line, a row's on two.
    assert.equal(await row(page, 'Brush fire near the 210').locator('.nw-meta').textContent(), 'KTLA +4·1h·Updated 8:40 AM');
    assert.deepEqual(await row(page, 'Man arrested after a stabbing').locator('.side .nw-meta').allTextContents(), ['NBC LA +2', 'Updated 7:55 AM']);
    assert.deepEqual(await row(page, 'Federal agents detain 9').locator('.side .nw-meta').allTextContents(), ['LAist +3', 'Yesterday']);

    // The single values: the lead's image, a row's grid and thumbnail, and the dots. With nothing open
    // the list is 1,429 px wide, and its leads grow: 320 × 180, the headline 19 (#245).
    const lead = row(page, 'Brush fire near the 210');
    const leadImage = () => lead.locator('img').evaluate(image => [image.getBoundingClientRect().width, image.getBoundingClientRect().height, getComputedStyle(image).objectFit, getComputedStyle(image).borderRadius]);
    const leadColumns = () => lead.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').slice(0, 2).join(' '));
    const leadHeadline = () => lead.locator('.hl').evaluate(element => [getComputedStyle(element).fontSize, getComputedStyle(element).lineHeight, getComputedStyle(element).fontWeight]);
    assert.deepEqual(await leadImage(), [320, 180, 'cover', '12px']);
    assert.equal(await leadColumns(), '12px 320px');
    assert.deepEqual(await leadHeadline(), ['19px', '24.7px', '500']);
    assert.equal(await lead.locator('.sm').evaluate(element => getComputedStyle(element).webkitLineClamp), '3');
    const redFlag = row(page, 'Red Flag Warning');
    assert.match(await redFlag.evaluate(element => getComputedStyle(element).gridTemplateColumns), /^12px \S+ \S+ 72px$/);
    assert.deepEqual(await row(page, 'Federal agents detain 9').locator('img').evaluate(image => [image.getBoundingClientRect().width, image.getBoundingClientRect().height, getComputedStyle(image).borderRadius]), [72, 48, '8px']);
    assert.equal(await redFlag.locator('img').count(), 0, 'NWS\'s story has no image');
    assert.equal(await row(page, 'Council approves').locator('img, .nw-hz').count(), 0, 'an outlet\'s story without an image leaves its column empty');
    const dot = (headline: string) => row(page, headline).locator('.nd').evaluate(element => getComputedStyle(element, '::before').backgroundColor);
    // The General block's rows are below the fold, so they're still new or updated here.
    assert.equal(await dot('Federal judge blocks a rule'), await colourOf(page, 'var(--ink)'), 'new: ink');
    assert.equal(await dot('Four killed in a warehouse shooting'), await colourOf(page, 'var(--accent)'), 'updated: accent');

    const seen = await seenSettled(page, setpoint);
    assert.ok(seen.includes(await storyId(setpoint, 'Red Flag Warning for the valleys until Thu 6 PM')), 'Red Flag Warning was seen');
    // Seen, its dot stays for the visit (#95).
    assert.equal(await dot('Red Flag Warning'), await colourOf(page, 'var(--ink)'));
    await newsChange(setpoint, THREE_NEW_ONE_UPDATED);
    const pill = page.locator('.nw-pill');
    await until('the pill', () => pill.textContent(), text => text === '3 new · 1 updatedN');
    // It drops into place over 180 ms (news-06): measured once it's there.
    await pill.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const pillBox = await pill.evaluate(element => {
      const box = element.getBoundingClientRect();
      const strip = document.querySelector('.nw-missed')!.getBoundingClientRect();
      return {height: box.height, below: box.top - strip.bottom, centred: Math.abs((box.left + box.right) / 2 - (strip.left + strip.right) / 2) < 1};
    });
    assert.deepEqual(pillBox, {height: 32, below: 10, centred: true}, 'a 32 px pill, centred, 10 px under the Missed strip');

    await lead.click();
    await page.locator('.pane .rd-subj', {hasText: 'Brush fire near the 210 grows to 400 acres'}).waitFor();
    await page.locator('.st-new .lab', {hasText: 'New since you looked · Mon 10:40 PM'}).waitFor();
    await page.locator('.pane .src-row').first().waitFor();
    assert.equal(await page.title(), 'Brush fire near the 210 grows to 400 acres');
    // With the pane open the list is under 1000 px, and the lead is the boards' 232 × 130 again; opened,
    // it's seen, and stays ink, at 400 (#245).
    assert.deepEqual(await leadImage(), [232, 130, 'cover', '12px']);
    assert.equal(await leadColumns(), '12px 232px');
    assert.deepEqual(await leadHeadline(), ['16px', '21.6px', '400']);
    assert.equal(await lead.locator('.hl').evaluate(element => getComputedStyle(element).color), await colourOf(page, 'var(--ink)'));
    await seenSettled(page, setpoint);
    await settle(page);
    await matchGolden(page, '25-news-a-typical-morning', 'main');
    await matchGolden(page, '25-news-a-typical-morning.sidebar', 'sidebar');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 31: board 25 in Light, from the theme\'s tokens', async () => {
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

    // The single values, each Light's own token.
    const style = (selector: string, property: 'color' | 'backgroundColor') => page.locator(selector).first().evaluate((element, name) => getComputedStyle(element)[name], property);
    const dot = (headline: string) => row(page, headline).locator('.nd').evaluate(element => getComputedStyle(element, '::before').backgroundColor);
    assert.equal(await colourOf(page, 'var(--ink)'), 'rgb(29, 30, 33)', 'Light\'s ink');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(246, 246, 244)', 'Light\'s page (override 5)');
    assert.equal(await style('.nw-sec', 'backgroundColor'), await backgroundOf(page, 'var(--panel)'));
    assert.equal(await style('.nw-sec', 'color'), await colourOf(page, 'var(--ink2)'), 'the section\'s name in ink2 (#161)');
    assert.equal(await style('.nw-sec > .icon', 'color'), await colourOf(page, 'var(--ink3)'), 'its glyph in ink3');
    assert.equal(await style('.nw-missed', 'backgroundColor'), await backgroundOf(page, 'color-mix(in oklch, var(--accent) 9%, var(--page))'));
    assert.equal(await style('.nw-missed > .icon', 'color'), await colourOf(page, 'var(--accent)'));
    assert.equal(await style('.nw-pill', 'backgroundColor'), await backgroundOf(page, 'var(--cardOn)'));
    assert.equal(await style('.nw-pill .upd', 'color'), await colourOf(page, 'var(--accent)'));
    assert.equal(await dot('Red Flag Warning'), await colourOf(page, 'var(--ink)'), 'new: ink');
    assert.equal(await dot('Man arrested after a stabbing'), await colourOf(page, 'var(--accent)'), 'updated: accent');
    assert.equal(await style('.nw-row.new .hl', 'color'), await colourOf(page, 'var(--ink)'));
    assert.equal(await style('.nw-row .sm', 'color'), await colourOf(page, 'var(--ink3)'));
    assert.equal(await style('.nw-meta .upd', 'color'), await colourOf(page, 'var(--accent)'));
    // Upcoming's tile is the accent, not Jobs' violet (#126).
    assert.equal(await style('.nw-up .ico', 'color'), await colourOf(page, 'var(--accent)'));

    await lead.click();
    await page.locator('.st-new .lab', {hasText: 'New since you looked · Mon 10:40 PM'}).waitFor();
    await page.locator('.pane .src-row').first().waitFor();
    await page.locator('.pane .st-img img').evaluate((image: HTMLImageElement) => image.decode());
    assert.equal(await style('.st-new', 'backgroundColor'), await backgroundOf(page, 'color-mix(in oklch, var(--accent) 8%, var(--card))'));
    assert.equal(await style('.st-new .lab', 'color'), await colourOf(page, 'var(--accent)'));
    assert.equal(await style('.src-list', 'backgroundColor'), await backgroundOf(page, 'var(--sub)'));
    await seenSettled(page, setpoint);
    await settle(page);
    await matchGolden(page, '31-light-news');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('#162: a hazard source\'s story without a photo shows its hazard\'s glyph in a caution tile; as a lead, before its headline', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const redFlag = row(page, 'Red Flag Warning');
    await redFlag.waitFor();
    const caution = await colourOf(page, 'var(--caution)');
    const tile = redFlag.locator('.nw-hz');
    assert.deepEqual(await tile.evaluate(box => [box.getBoundingClientRect().width, box.getBoundingClientRect().height, getComputedStyle(box).borderRadius, getComputedStyle(box).backgroundColor]),
      [72, 48, '8px', await backgroundOf(page, 'color-mix(in oklch, var(--caution) 10%, transparent)')]);
    assert.deepEqual(await glyphs(tile.locator('.icon')), [['thunderstorm', '22', caution]]);
    // The tile sits in the thumbnail's column, level with a photo's.
    const photo = row(page, 'Federal agents detain 9').locator('img');
    assert.equal(await tile.evaluate(box => box.getBoundingClientRect().right), await photo.evaluate(image => image.getBoundingClientRect().right));
    assert.equal(await row(page, 'Council approves').locator('.nw-hz').count(), 0, 'an outlet\'s story leaves its column empty');
    // Ranked first in Local, it leads the block without a photo: an 18 px glyph before its headline, no tile.
    await newsChange(setpoint, `UPDATE news_stories SET score = 99 WHERE headline = 'Red Flag Warning for the valleys until Thu 6 PM'`);
    await page.reload();
    const lead = page.locator('.nw-lead', {hasText: 'Red Flag Warning'});
    await lead.waitFor();
    assert.equal(await lead.locator('.nw-hz, img').count(), 0);
    assert.deepEqual(await glyphs(lead.locator('.hl .hz .icon')), [['thunderstorm', '18', caution]]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the story pane: its head, New since you looked, Sources; an article (26a), Back, and one that can\'t be read here (26b)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    const fire = row(page, 'Brush fire near the 210 grows to 400 acres');
    await fire.click();
    const pane = page.locator('section.pane');
    await pane.locator('.src-row').first().waitFor();
    // Measured where the pane rests, once its content has slid in.
    await still(page);
    assert.equal(await pane.locator('.rd-tools').textContent(), 'Open at KTLAO');
    assert.deepEqual(await pane.locator('.st-secs .tag').allTextContents(), ['Local', 'Updated']);
    assert.deepEqual(await glyphs(pane.locator('.st-secs .tag .icon')), [['location_on', '14', await colourOf(page, 'var(--ink3)')]], 'the section\'s tag leads with its glyph (#161)');
    assert.equal(await pane.locator('.st-meta').textContent(), '5 outlets·first reported Mon 6:12 AM·updated 8:40 AM');
    assert.equal(await pane.locator('.st-img .cap').textContent(), 'KTLA');
    assert.deepEqual(await pane.locator('.st-img').evaluate(box => [box.getBoundingClientRect().height, getComputedStyle(box).borderRadius, getComputedStyle(box).marginLeft]), [220, '14px', '28px']);
    assert.deepEqual(await pane.locator('.st-new .it').allTextContents(), ['8:40 AMGrew from 150 to 400 acres overnight; evacuation warnings widened', '6:55 AMTwo schools in the warning area are closed for the day']);
    assert.deepEqual(await pane.locator('.src-row .o').allTextContents(), ['KTLASummary only', 'NBC Los Angeles', 'CBS Los Angeles', 'ABC7', 'FOX 11']);
    assert.deepEqual(await pane.locator('.src-row .fav').allTextContents(), ['K', 'NBC', 'CBS', '7', '11']);
    assert.equal(await pane.locator('.src-row', {hasText: 'NBC Los Angeles'}).evaluate(element => element.getBoundingClientRect().height >= 52), true);
    // The pane's body is one 600 px column at the reading measure, however wide the pane (#98).
    const column = async (selector: string) => pane.locator(selector).first().evaluate((box, paneLeft) => {
      const rect = box.getBoundingClientRect();
      return [Math.round(rect.left - paneLeft), Math.round(rect.width)];
    }, await pane.evaluate(element => element.getBoundingClientRect().left + element.clientLeft));
    assert.deepEqual(await Promise.all(['.st-img', '.st-new', '.st-sum', '.src-list'].map(column)), [[28, 600], [28, 600], [28, 600], [28, 600]]);
    // Opening it saw it: its dot goes at once, and the server has it.
    const fireId = await storyId(setpoint, 'Brush fire near the 210 grows to 400 acres');
    await until('seen on the server', () => stateOf(setpoint, fireId), state => state === 'seen');
    assert.match(await fire.getAttribute('class') ?? '', /\bseen\b/);
    // Its dot shrinks out in its colour over 180 ms rather than vanishing, and its headline eases to seen's
    // colour over 120 ms (news-06).
    const dot = fire.locator('.nd');
    assert.deepEqual(await dot.evaluate(element => [getComputedStyle(element, '::before').transitionProperty, getComputedStyle(element, '::before').transitionDuration, getComputedStyle(element, '::before').transitionDelay]),
      ['transform, background-color', '0.18s, 0s', '0s, 0.18s']);
    await until('the dot shrunk away', () => dot.evaluate(element => getComputedStyle(element, '::before').transform), transform => transform === 'matrix(0, 0, 0, 0, 0, 0)');
    assert.deepEqual(await fire.locator('.hl').evaluate(element => [getComputedStyle(element).transitionProperty, getComputedStyle(element).transitionDuration]), ['color', '0.12s']);
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
    // At a reading size: 16 / 1.65, paragraphs 16 apart, and in Night ink softened 10% toward ink2 (#247).
    assert.deepEqual(await pane.locator('.ar-text').evaluate(text => [getComputedStyle(text).fontSize, getComputedStyle(text).lineHeight, getComputedStyle(text).color]),
      ['16px', '26.4px', await colourOf(page, 'color-mix(in oklch, var(--ink) 90%, var(--ink2))')]);
    assert.equal(await pane.locator('.ar-text p').first().evaluate(paragraph => getComputedStyle(paragraph).marginBottom), '16px');
    assert.equal(await pane.locator('.st-img.article').evaluate(box => box.getBoundingClientRect().height), 240);
    assert.deepEqual(await Promise.all(['.st-img.article', '.ar-text'].map(column)), [[28, 600], [28, 600]]);
    await page.locator('.st-img.article img').evaluate((image: HTMLImageElement) => image.decode());
    await settle(page);
    await matchGolden(page, '26a-an-article-in-the-pane', 'reader');
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
    await settle(page);
    await matchGolden(page, '26b-an-article-that-cant-be-read-in-app', 'reader');
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

test('New since you looked shows the newest four facts, then "6 more"; a click opens the rest and the card grows over 180 ms (the polish audit\'s news-12)', async () => {
  const setpoint = await startSetpoint();
  try {
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
    assert.deepEqual(await visible(), ['Grew from 150 to 400 acres overnight; evacuation warnings widened', 'Two schools in the warning area are closed for the day', 'Fact 8 since the last look', 'Fact 7 since the last look']);
    assert.equal(await card.locator('.st-fold').textContent(), '6 more');
    assert.deepEqual(await glyphs(card.locator('.st-fold .icon')), [['expand_more', '16', await colourOf(page, 'var(--ink3)')]]);
    // The fold sits level with the facts' text, in ink2 12.5, 20 px high.
    const textLeft = await card.locator('.it').first().locator('span').last().evaluate(text => text.getBoundingClientRect().left);
    assert.deepEqual(await card.locator('.st-fold').evaluate(fold => {
      const range = document.createRange();
      range.selectNodeContents(fold.firstChild!);
      return [range.getBoundingClientRect().left, fold.getBoundingClientRect().height, getComputedStyle(fold).fontSize, getComputedStyle(fold).color];
    }), [textLeft, 20, '12.5px', await colourOf(page, 'var(--ink2)')]);
    const closed = await card.evaluate(element => element.getBoundingClientRect().height);
    assert.equal(await card.locator('.st-more').evaluate(more => getComputedStyle(more).transitionDuration), '0.18s');

    await card.locator('.st-fold').click();
    await until('all ten facts', visible, lines => lines.length === 10);
    assert.equal(await card.locator('.st-fold').textContent(), 'Show fewer');
    assert.deepEqual((await glyphs(card.locator('.st-fold .icon')))[0]![0], 'expand_less');
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

test('a section (27): "12 more in Local" opens Local\'s full list, biggest first, the first as a lead; the stories behind it stay new until it shows them', async () => {
  const setpoint = await startSetpoint();
  try {
    const water = await storyId(setpoint, 'Water main break floods an intersection; repairs through Thursday');
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await seenSettled(page, setpoint);
    assert.equal(await stateOf(setpoint, water), 'new', 'behind "12 more", it stays new');
    await page.locator('.nw-more', {hasText: '12 more in Local'}).click();
    await page.waitForURL(/\/news\/local$/);
    await until('Local\'s whole list', () => page.locator('.nw-list [data-story]').count(), count => count === 17);
    assert.equal(await page.locator('.hd .seg .on').textContent(), 'Local');
    assert.equal(await page.locator('.nw-sec').count(), 0);
    assert.equal(await page.locator('.nw-missed').count(), 0);
    assert.deepEqual(await page.locator('.nw-list [data-story]').evaluateAll(rows => rows.map(element => element.className.split(' ')[0])).then(classes => classes.slice(0, 3)), ['nw-lead', 'nw-row', 'nw-row']);
    // Shown now, Water main is seen after its second on screen.
    await until('Water main seen', () => stateOf(setpoint, water), state => state === 'seen', 5000);
    await seenSettled(page, setpoint);
    await settle(page);
    await matchGolden(page, '27-a-section-local', 'news');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Missed (28): Catch up lists the stories that left unseen, by day, each row naming its section; Back returns to All', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await page.locator('.nw-missed').waitFor();
    await page.locator('.nw-missed .btn', {hasText: 'Catch up'}).click();
    await page.waitForURL(/\/news\/missed$/);
    await page.locator('.nw-back .t', {hasText: 'Missed since Mon 10:40 PM'}).waitFor();
    assert.equal(await page.locator('.nw-back .n').textContent(), '14 stories');
    assert.equal(await page.locator('.nw-sec').textContent(), 'TuesdayOct 6');
    assert.deepEqual(await glyphs(page.locator('.nw-sec > .icon')), [['history', '14', await colourOf(page, 'var(--ink3)')]], 'a day of Missed leads with history (#161)');
    assert.equal(await page.locator('.nw-list [data-story]').count(), 14);
    const tornado = row(page, 'Tornado outbreak across Oklahoma and Kansas');
    assert.match(await tornado.getAttribute('class') ?? '', /^nw-lead/);
    // Ages follow DESIGN.md › Copy: Tuesday is "Yesterday" on a Wednesday.
    assert.equal(await tornado.locator('.nw-meta').textContent(), 'General·NPR +9·Yesterday');
    assert.deepEqual(await row(page, 'Google DeepMind releases Gemini 3.5 Flash').locator('.side .nw-meta').allTextContents(), ['AI·Google +6', 'Yesterday']);
    const tornadoId = (await setpoint.api<{days: {stories: {id: number; headline: string}[]}[]}>('GET', '/news/missed')).days[0]!.stories[0]!.id;
    await seenSettled(page, setpoint);
    // A story leaves Missed once it's seen; the list holds while it's open.
    assert.equal((await setpoint.api<{days: {stories: {id: number}[]}[]}>('GET', '/news/missed')).days.flatMap(day => day.stories).some(story => story.id === tornadoId), false);
    assert.equal(await page.locator('.nw-list [data-story]').count(), 14);
    assert.equal(await tornado.locator('.nw-meta').textContent(), 'General·NPR +9·Yesterday', 'seen, it still names its section');
    await settle(page);
    await matchGolden(page, '28-missed', 'news');
    await page.getByRole('button', {name: 'Back to All'}).click();
    await page.waitForURL(/\/news$/);
    await until('the strip counts what\'s left', () => page.locator('.nw-missed b').textContent(), text => text !== '14 stories');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Missed holds for the visit: emptied while it\'s read, it stays; opened empty, it\'s All (the polish audit\'s news-01)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await page.locator('.nw-missed .btn', {hasText: 'Catch up'}).click();
    await page.waitForURL(/\/news\/missed$/);
    await page.locator('.nw-back .t', {hasText: 'Missed since Mon 10:40 PM'}).waitFor();
    assert.equal(await page.locator('.nw-list [data-story]').count(), 14);
    // Every story in it seen during the visit, as rows fully on screen are: Missed is empty now.
    const ids = (await setpoint.api<MissedOut>('GET', '/news/missed')).days.flatMap(day => day.stories.map(story => story.id));
    const emptied = page.waitForResponse(async response => response.url().endsWith('/api/news/missed') && (await response.json() as MissedOut).count === 0);
    await setpoint.api('POST', '/news/seen', {story_ids: ids});
    await emptied;
    // Nothing happens to wait for: the list holds for the visit rather than jumping to All.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.match(page.url(), /\/news\/missed$/);
    assert.equal(await page.locator('.nw-list [data-story]').count(), 14);
    assert.equal(await page.locator('.nw-back .n').textContent(), '14 stories');
    // Back in All, the strip is gone; Missed opened again, with nothing in it, is All.
    await page.getByRole('button', {name: 'Back to All'}).click();
    await page.waitForURL(/\/news$/);
    await page.locator('.nw-missed').waitFor({state: 'detached'});
    await page.goto(`${setpoint.base}/news/missed`);
    await page.waitForURL(/\/news$/);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('seen: about a second fully on screen, or opened; flicking past doesn\'t count; the dots stay for the visit and are gone in the next', async () => {
  const setpoint = await startSetpoint();
  try {
    const hurricane = await storyId(setpoint, 'Hurricane Teresa makes landfall in the Florida Panhandle as a Category 3');
    const pixel = await storyId(setpoint, 'Pixel Watch 5 goes on sale with two-day battery life');
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await seenSettled(page, setpoint);
    assert.equal(await stateOf(setpoint, hurricane), 'new', 'below the fold');
    // Flicking past: General's lead is drawn fully on screen for a few frames, then scrolled away.
    const flicked = await list(page).evaluate(async scroller => {
      const frame = () => new Promise(next => requestAnimationFrame(next));
      scroller.scrollTo({top: scroller.scrollHeight});
      await frame();
      await frame();
      const row = [...scroller.querySelectorAll('[data-key]')].find(element => element.textContent?.startsWith('Hurricane Teresa'))!;
      const box = scroller.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      const shown = rect.top >= box.top && rect.bottom <= box.bottom;
      scroller.scrollTo({top: 0});
      return shown;
    });
    assert.equal(flicked, true, 'Hurricane was fully on screen');
    // Nothing should happen: a second and more passes with Hurricane off screen.
    await page.waitForTimeout(1500);
    await setpoint.idle();
    await setpoint.idle();
    assert.equal(await stateOf(setpoint, hurricane), 'new', 'flicking past doesn\'t count');
    // Scrolled to and left there, it's seen.
    await row(page, 'Hurricane Teresa').scrollIntoViewIfNeeded();
    await until('Hurricane seen', () => stateOf(setpoint, hurricane), state => state === 'seen');
    await setpoint.idle();
    // Its dot stays for the visit (#95), and the rows seen on arrival keep theirs.
    assert.match(await row(page, 'Hurricane Teresa').getAttribute('class') ?? '', /\bnew\b/);
    assert.match(await row(page, 'Red Flag Warning').getAttribute('class') ?? '', /\bnew\b/);
    // A reload is a new visit: the stories seen have no dot.
    await page.reload();
    await row(page, 'Red Flag Warning').waitFor();
    assert.match(await row(page, 'Red Flag Warning').getAttribute('class') ?? '', /\bseen\b/);
    assert.match(await row(page, 'Hurricane Teresa').getAttribute('class') ?? '', /\bseen\b/);
    // A seen lead keeps its ink, at 400, so it never ranks below a row; a seen row is ink2 (#245).
    const ink = (headline: string) => row(page, headline).locator('.hl').evaluate(element => [getComputedStyle(element).color, getComputedStyle(element).fontWeight]);
    assert.match(await row(page, 'Brush fire near the 210').getAttribute('class') ?? '', /^nw-lead seen\b/);
    assert.deepEqual(await ink('Brush fire near the 210'), [await colourOf(page, 'var(--ink)'), '400']);
    assert.deepEqual(await ink('Red Flag Warning'), [await colourOf(page, 'var(--ink2)'), '400']);
    // Seen by Pixel Watch's opening, even off screen.
    await page.goto(`${setpoint.base}/news/story/${pixel}`);
    await until('Pixel Watch seen', () => stateOf(setpoint, pixel), state => state === 'seen');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the order holds: a change updates rows on screen in place, the rest waits behind the pill; the pill and N take it, scrolled to the top', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    await row(page, 'Brush fire near the 210').waitFor();
    await seenSettled(page, setpoint);
    const order = () => page.locator('.nw-list [data-story]').evaluateAll(rows => rows.map(element => (element as HTMLElement).dataset.story));
    const before = await order();
    // A new fact for the car wash story on screen, and a new line for the Red Flag Warning's.
    const carWash = row(page, 'Federal agents detain 9 at a car wash');
    const classes = await watch(carWash, 'class');
    await newsChange(setpoint, `${THREE_NEW_ONE_UPDATED}
      UPDATE news_stories SET last_new_fact_at = '2026-10-07T16:06:00.000Z' WHERE headline = 'Federal agents detain 9 at a car wash';
      UPDATE news_stories SET one_line = 'Gusts to 60 mph, humidity under 8%' WHERE headline = 'Red Flag Warning for the valleys until Thu 6 PM';`);
    const pill = page.locator('.nw-pill', {hasText: '3 new · 1 updated'});
    await pill.waitFor();
    await row(page, 'Red Flag Warning').locator('.sm', {hasText: 'Gusts to 60 mph, humidity under 8%'}).waitFor();
    await until('the car wash turns updated in place', classes, seen => seen.some(value => /\bupd\b/.test(value ?? '')));
    assert.deepEqual(await order(), before, 'nothing moved');
    // The pill drops in over 180 ms; under the pointer its ring turns edgeHover and its arrow ink (news-06).
    assert.deepEqual(await pill.evaluate(element => [getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]), ['nw-pill-in', '0.18s']);
    const ring = (edge: string) => page.evaluate(value => {
      const probe = document.createElement('div');
      probe.style.boxShadow = `inset 0 0 0 1px var(${value}), var(--shadow-pill)`;
      document.body.append(probe);
      const shadow = getComputedStyle(probe).boxShadow;
      probe.remove();
      return shadow;
    }, edge);
    const hovered = [await ring('--edgeHover'), await colourOf(page, 'var(--ink)')];
    await pill.hover();
    await until('the pill answers the pointer', () => pill.evaluate(element => [getComputedStyle(element).boxShadow, getComputedStyle(element.querySelector('.icon')!).color]),
      answer => answer.join() === hovered.join());
    await page.mouse.move(700, 28);
    await list(page).evaluate(scroller => scroller.scrollTo({top: 400}));
    // Each row N brings onto the list settles in from sub2 over 900 ms: noted as it lands.
    await page.evaluate(() => {
      const landed: string[][] = [];
      (window as unknown as {landed: string[][]}).landed = landed;
      new MutationObserver(() => {
        for (const element of document.querySelectorAll<HTMLElement>('.nw-list .landed')) {
          if (!landed.some(([id]) => id === element.dataset.story)) landed.push([element.dataset.story!, getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]);
        }
      }).observe(document.querySelector('.nw-list')!, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']});
    });
    // N takes the new order and scrolls to the top.
    await page.keyboard.press('n');
    await until('the new order', () => page.locator('.nw-list [data-story]').first().textContent(), text => text?.startsWith('Water main break floods an intersection') ?? false);
    const arrived = [...new Set((await order()).filter(id => !before.includes(id)))].sort();
    assert.deepEqual(arrived.length, 4, 'Water main, cooling centers, visionOS and Hugging Face');
    const landed = await page.evaluate(() => (window as unknown as {landed: string[][]}).landed);
    assert.deepEqual([...landed].sort(), arrived.map(id => [id, 'nw-landed', '0.9s']));
    await until('they settle', () => page.locator('.nw-list .landed').count(), count => count === 0);
    assert.equal(await page.locator('.nw-pill').count(), 0);
    assert.equal(await list(page).evaluate(scroller => scroller.scrollTop), 0);
    assert.deepEqual((await page.locator('.nw-list [data-story]').allTextContents()).slice(0, 2).map(text => text.slice(0, 20)), ['Water main break flo', 'County opens cooling']);
    // Opening the page always shows the latest order.
    const latest = await setpoint.api<NewsPageOut>('GET', '/news');
    await page.reload();
    await until('the latest order on opening', () => order(), ids => ids.slice(0, 5).join() === latest.blocks[0]!.stories.map(story => String(story.id)).join());
    assert.equal(await page.locator('.nw-pill').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('keys: 3 opens News; J and K move; Enter opens; J opens the next with one open; O opens the original; Esc closes', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
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

test('Upcoming\'s Add to calendar opens Calendar\'s editor on the Apple event, Tue Oct 20 at 10 AM, from the keynote\'s proposal', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/news`);
    // One path, as an email's: the server's proposal for the keynote (N3), its calendar picked as an email's is.
    const proposed = page.waitForResponse(response => /\/api\/news\/events\/\d+\/proposal$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
    await page.locator('.nw-up .btn', {hasText: 'Add to calendar'}).click();
    const proposal = await (await proposed).json() as {item: {calendar_id: number | null}; from_email: string[]};
    await page.waitForURL(/\/calendar\/new\?kind=event&upcoming=\d+$/);
    const editor = page.locator('.editor');
    await until('the keynote in the editor', () => editor.getByLabel('Title', {exact: true}).inputValue(), value => value === 'Apple event');
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
    const page = await setpoint.page({width: 1280, height: 800});
    await page.goto(`${setpoint.base}/news`);
    const fire = row(page, 'Brush fire near the 210 grows to 400 acres');
    await fire.click();
    await page.locator('.pane .src-row').first().waitFor();
    // The pane at its cap leaves the list its 420 px.
    assert.equal(await page.locator('.nw-list').evaluate(element => element.getBoundingClientRect().width), 420);

    const upcoming = page.locator('.nw-up');
    assert.equal(await upcoming.evaluate(element => element.getBoundingClientRect().height), 46);
    const what = upcoming.locator('span:has(> .what)');
    assert.deepEqual(await what.evaluate(element => [getComputedStyle(element).whiteSpace, getComputedStyle(element).textOverflow, element.scrollWidth > element.clientWidth]),
      ['nowrap', 'ellipsis', true], 'name · date is one line, cut short with an ellipsis');
    assert.equal(await what.getAttribute('title'), 'Apple event · Tue Oct 20 · 10 AM');
    assert.equal(await upcoming.locator('.lab').isVisible(), false, 'no UPCOMING label');
    assert.equal(await upcoming.locator('.nw-meta').isVisible(), false, 'no outlet');
    const inside = await upcoming.evaluate(element => {
      const box = element.getBoundingClientRect();
      return [...element.children].every(child => {
        const rect = child.getBoundingClientRect();
        return rect.width === 0 || (rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom);
      });
    });
    assert.equal(inside, true, 'everything in the row stays inside it');
    assert.equal(await upcoming.locator('.btn', {hasText: 'Add to calendar'}).isVisible(), true);

    assert.deepEqual(await fire.locator('img').evaluate(image => [image.getBoundingClientRect().width, image.getBoundingClientRect().height]), [160, 90]);
    assert.equal(await fire.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').slice(0, 2).join(' ')), '12px 160px');
    // Under 480 px a row's headline wraps to two 18 px lines and its summary goes; the row keeps its height, 66 px and its hairline (#246).
    const carWash = row(page, 'Federal agents detain 9 at a car wash');
    assert.deepEqual(await carWash.locator('.hl').evaluate(element => [getComputedStyle(element).whiteSpace, getComputedStyle(element).webkitLineClamp, getComputedStyle(element).lineHeight, element.getBoundingClientRect().height]),
      ['normal', '2', '18px', 36]);
    assert.equal(await carWash.locator('.sm').isVisible(), false, 'no summary');
    assert.equal(await carWash.evaluate(element => element.getBoundingClientRect().height), 67);
    await seenSettled(page, setpoint);
    await settle(page);
    await matchGolden(page, 'news-narrow', 'news');
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
