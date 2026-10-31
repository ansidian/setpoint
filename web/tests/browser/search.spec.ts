// Search, Alfred and proposals in the browser (BUILD-PLAN.md › F3), at the design target on a fresh
// seed each: words staying words as they're typed, Enter's reading into chips against a fake Anthropic
// (D385), results replacing the list with the reader and J / K / Enter working the same, each open
// logged with its position, a chip removed, what the chips left out, a reading slow, failed or
// overtaken, no results, Esc back to the Inbox; Alfred's Answer card from ⌘Enter with a follow-up, and from the reader (Ask about this
// email), against a fake Anthropic on 127.0.0.1, and its error in the server's words with no key;
// the proposal card's Create through the command layer, More options, and the More menu on Security
// mail. SV-23: calendar search, from the header's button, `/` or ⌘F, with its results in the right
// pane; a click, Enter, ↓ and J / K selecting results on the grid; E to the editor and back; Esc.
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {AccountOut, AllOut, CalendarOut, ItemsOut, TodoistProjectOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {FAKE_ANTHROPIC_KEY, fakeAlfred, leaseAlfred, listAlfred, rejectionsAlfred, SEED_READINGS} from './fakeAlfred.ts';
import type {FakeReading} from './fakeAlfred.ts';
import {cleanUp, point, rested, startSetpoint, test, until, writeOutput} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** An empty line's leading glyph: its bundled path, size and colour, and the gap to the words after it (#124). */
const leadGlyph = (line: Locator) => line.evaluate(element => {
  const icon = element.querySelector('.icon')!;
  const range = document.createRange();
  range.selectNode(icon.closest('span.set-empty-icon') ? element.querySelector('.set-empty')! : icon.nextSibling!);
  return [icon.querySelector('path')!.getAttribute('d'), icon.getAttribute('width'), getComputedStyle(icon).color, Math.round(range.getBoundingClientRect().left - icon.getBoundingClientRect().right)];
});

async function load(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('target');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.list .row').first().waitFor();
  return page;
}

async function idOf(setpoint: Setpoint, subjectStart: string): Promise<number> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  return all.days.flatMap(day => day.rows).find(row => row.subject.startsWith(subjectStart))!.id;
}

// The field's chips, not a removed one's copy collapsing away (Search.tsx).
const chips = (page: Page) => page.locator('.search .qchip:not([aria-hidden])').allTextContents();

/** Setpoint with Alfred's key set and its model calls going to the fake, which reads searches too. */
async function withAlfred({readings = SEED_READINGS, fixtures = []}: {readings?: Record<string, FakeReading>; fixtures?: string[]} = {}) {
  const fake = await fakeAlfred(leaseAlfred, {readings});
  const setpoint = await startSetpoint({fixtures, env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
  return {setpoint, fake, stop: async () => {
    await setpoint.stop();
    await fake.close();
  }};
}

interface SearchRequest {
  text: string;
  chips: {label: string}[];
  read?: string;
  typed?: string;
  account_id?: number;
  offset?: number;
}

/** Every mail search the page asks, as it's asked. */
function searchesOf(page: Page): SearchRequest[] {
  const searches: SearchRequest[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/search') searches.push(JSON.parse(request.postData()!) as SearchRequest);
  });
  return searches;
}

/** Types into the field, and waits for those words' results to be on screen. */
async function typeWords(page: Page, setpoint: Setpoint, text: string) {
  const answered = page.waitForResponse(response => new URL(response.url()).pathname === '/api/search' && (JSON.parse(response.request().postData()!) as SearchRequest).text.endsWith(text));
  await page.keyboard.type(text);
  await answered;
  await setpoint.idle();
}

const field = (page: Page) => page.locator('.search input');
const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
const titles = (page: Page) => page.locator('.arow.result .l2').allTextContents();

test('search: typing makes no chip and asks no model; Enter reads the whole search, then hands the keys to the results; J / K / Enter open them and each open is logged', async () => {
  const {setpoint, fake, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    assert.equal(await focused(page), 'Search mail');
    // Keyword results as it's typed, each word still a word, a date's too.
    await typeWords(page, setpoint, 'northwind rejection march');
    await page.locator('.list .arow.result').first().waitFor();
    assert.deepEqual(await chips(page), []);
    assert.equal(await field(page).inputValue(), 'northwind rejection march');
    assert.deepEqual(fake.read, []);
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    // Enter: the reading's chips, and the keys go to the results.
    await page.keyboard.press('Enter');
    await until('the chips', () => chips(page), shown => shown.join(' | ') === 'OrgNorthwind Talent | TypeRejection | DateMar 2026');
    assert.deepEqual(fake.read, ['northwind rejection march']);
    assert.equal(await field(page).inputValue(), '');
    assert.equal(await page.locator('.search-list .bar').textContent(), '2 results');
    assert.deepEqual(await titles(page), ['Update on your application', 'Your application for Data Engineer Intern']);
    // Only the reason the row doesn't already show (search-11): its organisation is highlighted, its day is its age.
    assert.equal(await page.locator('.arow.result .why').first().textContent(), 'Type Rejection');
    assert.equal(await page.locator('.arow.result').first().locator('.from mark.hl').textContent(), 'Northwind Talent');
    assert.equal(await page.locator('.ask').textContent(), 'Ask Alfred · Northwind Talent · Rejection · Mar 2026⌘Enter');
    // The cursor starts on the first; J, K move it; Enter opens it and logs its position.
    await page.locator('.arow.result.cur', {hasText: 'Update on your application'}).waitFor();
    assert.notEqual(await focused(page), 'Search mail');
    await page.keyboard.press('j');
    await page.locator('.arow.result.cur', {hasText: 'Your application for Data Engineer Intern'}).waitFor();
    await page.keyboard.press('k');
    await page.locator('.arow.result.cur', {hasText: 'Update on your application'}).waitFor();
    const opened = page.waitForRequest(request => request.url().endsWith('/api/search/opened'));
    await page.keyboard.press('Enter');
    await page.locator('.rd-subj', {hasText: 'Update on your application'}).waitFor();
    const log = JSON.parse((await opened).postData()!) as {message_id: number; position: number};
    assert.deepEqual(log, {...log, message_id: await idOf(setpoint, 'Update on your application'), position: 0});
    // The reader highlights the words the search matched, once its body is in (the head is drawn from the row at once).
    await page.locator('.mailtext mark.hl').first().waitFor();
    const marks = await page.locator('.mailtext mark.hl').allTextContents();
    assert.ok(marks.length > 0 && marks.every(text => /northwind|rejection/i.test(text)), `marks: ${JSON.stringify(marks)}`);
    // The reader's next steps through the results.
    await page.locator('.rd-tools [aria-label="Next email"]').click();
    await page.locator('.rd-subj', {hasText: 'Your application for Data Engineer Intern'}).waitFor();
    // A date chip's ×: the search runs again without it, its word gone with it.
    await page.locator('.qchip', {hasText: 'Mar 2026'}).locator('.x').click();
    await until('the chips', () => chips(page), shown => shown.length === 2);
    assert.equal(await field(page).inputValue(), '');
    // `/` with the search open selects the whole query, chips too (SV-25); End keeps it to add a word.
    await page.keyboard.press('/');
    assert.equal(await page.locator('.search .qchip.sel').count(), 2);
    await page.keyboard.press('End');
    assert.equal(await page.locator('.search .qchip.sel').count(), 0);
    // No results: each part removable.
    await page.keyboard.type('zebra');
    await page.locator('.no-results', {hasText: 'No emails match'}).waitFor();
    assert.equal(await page.locator('.no-results').textContent(), 'No emails matchNorthwind TalentRejectionzebra');
    const ink3 = await rested(() => page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--ink3)';
      document.body.append(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    }));
    assert.deepEqual(await rested(() => leadGlyph(page.locator('.no-results'))), [ICONS.search_off, '20', ink3, 12], 'nothing found leads with search_off (#124)');
    await page.locator('.no-results .x[aria-label="Remove zebra"]').click();
    await page.locator('.arow.result').first().waitFor();
    // Esc in the field clears the search: the Inbox is back.
    await page.keyboard.press('/');
    await page.keyboard.press('Escape');
    await page.locator('.hd-title', {hasText: 'Inbox'}).waitFor();
    assert.equal(await page.locator('.qchip').count(), 0);
    await page.locator('.list .gh.new').waitFor();
    // ⌘F focuses the field too.
    await page.locator('.list .gh.new').click();
    await page.keyboard.press('Meta+f');
    assert.equal(await focused(page), 'Search mail');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('a date is a word while it\'s typed and a chip on Enter, with no model or key, which nothing else needs', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await typeWords(page, setpoint, 'march');
    assert.deepEqual(await chips(page), []);
    await page.keyboard.press('Enter');
    await until('the date', () => chips(page), shown => shown.join() === 'DateMar 2026');
    assert.equal(await field(page).inputValue(), '');
    assert.ok((await page.locator('.arow.result').count()) > 0);
    assert.equal(await page.locator('.search-list .bar').textContent(), `${await page.locator('.arow.result').count()} results·newest first`);
    // With words a model would have to read, and no key: no reading, so nothing changes.
    await page.keyboard.press('/');
    await typeWords(page, setpoint, 'northwind march');
    const before = await titles(page);
    await page.keyboard.press('Enter');
    await page.locator('.arow.result.cur').first().waitFor();
    assert.deepEqual([await chips(page), await field(page).inputValue(), await titles(page)], [[], 'northwind march', before]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('×: the filter goes, its word is plain text again, it\'s logged, and neither the next results nor Enter on the same words bring the chip back', async () => {
  const {setpoint, fake, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    const searches = searchesOf(page);
    await page.keyboard.press('/');
    await page.keyboard.type('northwind rejection');
    await page.keyboard.press('Enter');
    await until('the chips', () => chips(page), shown => shown.join(' | ') === 'OrgNorthwind Talent | TypeRejection');
    assert.equal(await field(page).inputValue(), '');
    await page.locator('.arow.result.cur').first().waitFor();
    // Org off: Type Rejection still says its word, so only Northwind's comes back.
    const removed = page.waitForRequest(request => request.url().endsWith('/api/search/chip-removed'));
    await page.locator('.qchip', {hasText: 'Northwind'}).locator('.x').click();
    const logged = JSON.parse((await removed).postData()!) as {search_id: number; chip: {value: string}};
    assert.equal(logged.chip.value, 'Northwind Talent');
    assert.ok(logged.search_id > 0);
    await until('the word', () => field(page).inputValue(), value => value === 'northwind');
    assert.deepEqual(await chips(page), ['TypeRejection']);
    await until('what stays kept', async () => searches.at(-1)!, last => last.read === 'kept' && last.text === 'northwind' && last.typed === 'northwind rejection');
    // The last chip off: the words as typed, and still no reading.
    await page.locator('.qchip', {hasText: 'Rejection'}).locator('.x').click();
    await until('the words', () => field(page).inputValue(), value => value === 'northwind rejection');
    await until('what stays kept', async () => searches.at(-1)!, last => last.read === 'kept' && last.chips.length === 0);
    await page.locator('.ask', {hasText: 'northwind rejection'}).waitFor();
    // A pause for a "nothing happened" check: no chip comes back by itself.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.deepEqual(await chips(page), []);
    // Enter on the same words asks nothing, and hands over the keys as ever.
    await field(page).click();
    await page.keyboard.press('Enter');
    await page.locator('.arow.result.cur').first().waitFor();
    assert.notEqual(await focused(page), 'Search mail');
    const first = await page.locator('.arow.result.cur .l2').textContent();
    await page.keyboard.press('j');
    await until('the cursor moved', () => page.locator('.arow.result.cur .l2').textContent(), text => text !== first);
    // Away from those words and back is the same search.
    await page.keyboard.press('/');
    await page.keyboard.press('End');
    await page.keyboard.type('s');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await until('the keys handed over', () => focused(page), label => label !== 'Search mail');
    assert.deepEqual(await chips(page), []);
    assert.deepEqual(fake.read, ['northwind rejection']);
    // Other words are another reading, of the whole search.
    await page.keyboard.press('/');
    await page.keyboard.type('northwind');
    await page.keyboard.press('Enter');
    await until('the chip', () => chips(page), shown => shown.join() === 'OrgNorthwind Talent');
    assert.deepEqual(fake.read, ['northwind rejection', 'northwind']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('Enter on what\'s already read asks nothing and still hands over the keys; words added under the chips stay words, and the next Enter reads the whole search in the order typed', async () => {
  const {setpoint, fake, stop} = await withAlfred({readings: {...SEED_READINGS, 'parkside renewal terms': {organisations: ['Parkside Apartments'], keywords: 'renewal terms'}}});
  try {
    const page = await load(setpoint);
    const searches = searchesOf(page);
    await page.keyboard.press('/');
    await page.keyboard.type('parkside renewal');
    await page.keyboard.press('Enter');
    await until('the chip', () => chips(page), shown => shown.join() === 'OrgParkside Apartments');
    assert.equal(await field(page).inputValue(), 'renewal');
    await page.locator('.arow.result.cur').first().waitFor();
    await page.keyboard.press('/');
    assert.equal(await focused(page), 'Search mail');
    await page.keyboard.press('Enter');
    await until('the keys handed over', () => focused(page), label => label !== 'Search mail');
    await page.locator('.arow.result.cur').first().waitFor();
    assert.deepEqual(fake.read, ['parkside renewal']);
    // Twice at once is one reading: the second joins the first.
    await page.keyboard.press('/');
    await page.keyboard.press('End');
    await page.keyboard.type(' terms');
    await until('the chip keeps filtering, and what\'s typed stays a word', async () => searches.at(-1)!, last => last.read === 'kept' && last.text === 'renewal terms' && last.typed === 'parkside renewal terms');
    assert.deepEqual(await chips(page), ['OrgParkside Apartments']);
    assert.deepEqual(fake.read, ['parkside renewal']);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await until('the keys handed over', () => focused(page), label => label !== 'Search mail');
    assert.deepEqual(fake.read, ['parkside renewal', 'parkside renewal terms']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('the "more" line: what the chips hid, under the fold and apart from it, a stop for the keys, opening in place from `left_out` and gone when there\'s nothing to say', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    const searches = searchesOf(page);
    await page.keyboard.press('/');
    await page.keyboard.type('renewal');
    await page.locator('.arow.result').first().waitFor();
    assert.equal(await page.locator('.left-out').count(), 0, 'no line for words alone');
    await page.keyboard.press('Enter');
    await until('the chip', () => chips(page), shown => shown.join() === 'OrgParkside Apartments');
    const line = page.locator('.left-out');
    const fold = page.locator('.search-list .mentions:not(.left-out)');
    await line.waitFor();
    assert.equal(await line.textContent(), '2 more emails match your words');
    assert.equal(await line.getAttribute('aria-expanded'), 'false');
    // Both lines, in that order, the fold over what the chip kept.
    assert.equal(await fold.textContent(), '1 more mentions these words');
    assert.deepEqual(await page.locator('.search-list .mentions').evaluateAll(lines => lines.map(element => element.classList.contains('left-out'))), [false, true]);
    assert.deepEqual(await titles(page), ['Lease renewal terms', 'October rent received']);
    assert.equal(await page.locator('.search-list .bar').textContent(), '1 result');
    // J stops on it past the fold and its row; Enter opens it, from what the chips left out.
    await page.locator('.arow.result.cur').waitFor();
    await page.keyboard.press('j');
    await page.locator('.search-list .mentions.cur:not(.left-out)').waitFor();
    await page.keyboard.press('j');
    await page.locator('.arow.result.cur', {hasText: 'October rent received'}).waitFor();
    await page.keyboard.press('j');
    await page.locator('.left-out.cur').waitFor();
    await page.keyboard.press('Enter');
    await until('its rows', () => titles(page), shown => shown.length === 4);
    assert.deepEqual((await titles(page)).slice(2).sort(), ['Car registration renewal notice', 'Your renters policy renewal is coming up']);
    assert.equal(await line.getAttribute('aria-expanded'), 'true');
    const left = searches.filter(search => search.read === 'left_out');
    assert.deepEqual(left.map(({text, typed, chips}) => [text, typed, chips.length]), [['renewal', 'renewal', 1]]);
    // A row there opens as any other, logged past the results.
    await page.keyboard.press('j');
    await page.locator('.arow.result.cur').waitFor();
    const opened = page.waitForRequest(request => request.url().endsWith('/api/search/opened'));
    await page.keyboard.press('Enter');
    await page.locator('.rd-subj').waitFor();
    assert.equal((JSON.parse((await opened).postData()!) as {position: number}).position, 2);
    await page.keyboard.press('Escape');
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    // Closed and opened again, it asks nothing more.
    await line.click();
    await until('its rows gone', () => titles(page), shown => shown.length === 2);
    await line.click();
    await until('its rows back', () => titles(page), shown => shown.length === 4);
    assert.equal(searches.filter(search => search.read === 'left_out').length, 1);
    // A word more under the chip, and its own number; the chip off, and no line.
    await page.keyboard.press('/');
    await page.keyboard.press('End');
    await page.keyboard.type(' policy');
    await page.locator('.left-out', {hasText: '1 more email matches your words'}).waitFor();
    assert.equal(await line.getAttribute('aria-expanded'), 'false');
    await page.locator('.qchip .x').click();
    await line.waitFor({state: 'detached'});
    await page.locator('.arow.result').first().waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

/** Holds Enter's readings at the browser until the function returned lets them go. */
async function holdReadings(page: Page) {
  let release = () => {};
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(url => url.pathname === '/api/search', async route => {
    if ((route.request().postDataJSON() as SearchRequest).read === 'ask') await held;
    await route.fallback();
  });
  return release;
}

test('a reading on its way: the field\'s glyph turns, nothing else moves, the keys stay in the field, and what\'s typed meanwhile drops its answer', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    let release = await holdReadings(page);
    await page.keyboard.press('/');
    await typeWords(page, setpoint, 'northwind');
    const before = await titles(page);
    await page.keyboard.press('Enter');
    const glyph = page.locator('.search.pending .glass > .spin');
    await glyph.waitFor();
    await until('the spinner in the glass\'s place', () => glyph.evaluate(element => getComputedStyle(element).visibility), visibility => visibility === 'visible');
    assert.equal(await page.locator('.search-list.pending').count(), 0, 'the list isn\'t dimmed');
    assert.deepEqual([await titles(page), await chips(page), await focused(page)], [before, [], 'Search mail']);
    release();
    await until('the reading', () => chips(page), shown => shown.join() === 'OrgNorthwind Talent');
    await page.locator('.arow.result.cur').first().waitFor();
    assert.equal(await page.locator('.search.pending').count(), 0);
    // Typed over while it comes: the words win, and the answer is dropped.
    await page.unrouteAll();
    release = await holdReadings(page);
    await page.keyboard.press('Escape');
    await page.locator('.hd-title', {hasText: 'Inbox'}).waitFor();
    await page.keyboard.press('/');
    await typeWords(page, setpoint, 'google');
    const asked = page.waitForRequest(request => (request.postDataJSON() as SearchRequest | null)?.read === 'ask');
    await page.keyboard.press('Enter');
    await asked;
    await page.keyboard.type(' alerts');
    await page.locator('.ask', {hasText: 'google alerts'}).waitFor();
    release();
    // A pause for a "nothing happened" check: the answer that was held has time to land.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.deepEqual([await chips(page), await field(page).inputValue(), await focused(page)], [[], 'google alerts', 'Search mail']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('a reading too slow or failed changes nothing on screen, hands over the keys, and is worth another Enter: a slow one is held for it', async () => {
  const {setpoint, fake, stop} = await withAlfred({readings: {
    northwind: {organisations: ['Northwind Talent'], keywords: '', delayMs: 2600},
    'contoso policy': {fails: true},
  }});
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await typeWords(page, setpoint, 'northwind');
    const before = await titles(page);
    await page.keyboard.press('Enter');
    await page.locator('.arow.result.cur').first().waitFor({timeout: 10_000});
    assert.notEqual(await focused(page), 'Search mail');
    assert.deepEqual([await chips(page), await field(page).inputValue(), await titles(page)], [[], 'northwind', before]);
    assert.equal(await page.locator('.search.pending').count(), 0);
    // The answer that came too late is there for the next Enter, and costs no call.
    await page.keyboard.press('/');
    await page.keyboard.press('Enter');
    await until('the held reading', () => chips(page), shown => shown.join() === 'OrgNorthwind Talent');
    assert.deepEqual(fake.read, ['northwind']);
    // A failed one, with no line about it.
    await page.keyboard.press('/');
    await typeWords(page, setpoint, 'contoso policy');
    const failing = await titles(page);
    await page.keyboard.press('Enter');
    await until('the keys handed over', () => focused(page), label => label !== 'Search mail');
    assert.deepEqual([await chips(page), await field(page).inputValue(), await titles(page), await page.locator('.search-list .failing').count()], [[], 'contoso policy', failing, 0]);
    await page.keyboard.press('/');
    await page.keyboard.press('Enter');
    await until('asked again', async () => fake.read.filter(search => search === 'contoso policy').length, count => count === 2);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('chips go with their search: `/` or ⌘F and a new word, Backspace, Esc and another account in the sidebar', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    const searches = searchesOf(page);
    const enter = async (text: string, shown: string) => {
      await page.keyboard.type(text);
      await page.keyboard.press('Enter');
      await until(`the chips of ${text}`, () => chips(page), now => now.join(' | ') === shown);
      await page.locator('.arow.result.cur').first().waitFor();
    };
    await page.keyboard.press('/');
    await enter('northwind', 'OrgNorthwind Talent');
    // `/` selects the whole query, and what's typed replaces it, chips too.
    await page.keyboard.press('/');
    await enter('google', 'OrgGoogle');
    assert.deepEqual(searches.filter(search => search.read === 'ask').at(-1), {text: 'google', chips: [], read: 'ask'});
    assert.ok(searches.filter(search => search.text.startsWith('g')).every(search => search.chips.length === 0), 'no search carried the chip');
    // ⌘F the same.
    await page.keyboard.press('Meta+f');
    await enter('northwind', 'OrgNorthwind Talent');
    // Backspace in the empty field takes the chip off, its word back and whole, and goes on as a word.
    await page.keyboard.press('/');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await until('the word back', () => field(page).inputValue(), value => value === 'northwind');
    assert.deepEqual(await chips(page), []);
    await page.keyboard.press('Backspace');
    await until('a letter off', () => field(page).inputValue(), value => value === 'northwin');
    // Esc ends it, and the next search starts clean.
    await page.keyboard.press('Escape');
    await page.locator('.hd-title', {hasText: 'Inbox'}).waitFor();
    await page.keyboard.press('/');
    await enter('northwind', 'OrgNorthwind Talent');
    await page.keyboard.press('Escape');
    await page.locator('.hd-title', {hasText: 'Inbox'}).waitFor();
    assert.deepEqual([await chips(page), await field(page).inputValue()], [[], '']);
    // Another account in the sidebar is that account's Inbox, and the search goes with the page it was on.
    await page.keyboard.press('/');
    await enter('northwind', 'OrgNorthwind Talent');
    await page.locator('.sb .acct', {hasText: 'Business'}).click();
    await page.locator('.hd-title', {hasText: 'Inbox · Business'}).waitFor();
    assert.deepEqual([await chips(page), await field(page).inputValue()], [[], '']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('under a reading a later page keeps what was read, and the fold works as it does for words', async () => {
  const {setpoint, fake, stop} = await withAlfred({fixtures: ['ledger-audit'], readings: {'ledger audit': {organisations: ['Fourth Coffee'], keywords: 'ledger audit'}}});
  try {
    const page = await load(setpoint);
    const searches = searchesOf(page);
    await page.keyboard.press('/');
    await page.keyboard.type('ledger audit');
    await page.keyboard.press('Enter');
    await until('the chip', () => chips(page), shown => shown.join() === 'OrgFourth Coffee');
    const rows = page.locator('.arow.result');
    const fold = page.locator('.search-list .mentions:not(.left-out)');
    await rows.nth(49).waitFor();
    assert.equal(await page.locator('.search-list .bar').textContent(), '60 results');
    await rows.last().scrollIntoViewIfNeeded();
    await fold.waitFor();
    assert.equal(await fold.textContent(), '60 more mention these words');
    assert.equal(await rows.count(), 60);
    await fold.click();
    await until('the rows under it', () => rows.count(), count => count > 60);
    await rows.last().scrollIntoViewIfNeeded();
    await until('every row', () => rows.count(), count => count === 120);
    const later = searches.filter(search => search.offset);
    assert.deepEqual(later.map(({read, text, typed, chips: sent, offset}) => [read, text, typed, sent.length, offset]), [['kept', 'ledger audit', 'ledger audit', 1, 50], ['kept', 'ledger audit', 'ledger audit', 1, 100]]);
    assert.deepEqual(fake.read, ['ledger audit']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('a thin first section hides nothing: its fold starts open with its line, J / K cross it, an open logs the place it shows at, a close holds while the words are refined, and a new search decides again', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await page.keyboard.type('renewal');
    await page.keyboard.press('Enter');
    const rows = page.locator('.arow.result');
    const fold = page.locator('.search-list .mentions');
    await fold.waitFor();
    await page.locator('.arow.result.cur').waitFor();
    assert.equal(await page.locator('.search-list .bar').textContent(), '3 results');
    await until('every row, with no click', () => rows.count(), count => count === 4);
    assert.equal(await fold.textContent(), '1 more mentions these words');
    assert.equal(await fold.getAttribute('aria-expanded'), 'true');
    // J stops on the line, under its fill, and the list runs on over it, K back as J on.
    const fill = (token: string) => page.evaluate(name => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = `var(--${name})`;
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    }, token);
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.locator('.search-list .mentions.cur').waitFor();
    assert.equal(await rested(() => fold.evaluate(element => getComputedStyle(element).backgroundColor)), await rested(() => fill('sub2')));
    await page.keyboard.press('j');
    await page.locator('.arow.result.cur', {hasText: 'October rent received'}).waitFor();
    await page.keyboard.press('k');
    await page.locator('.search-list .mentions.cur').waitFor();
    await page.keyboard.press('j');
    await page.locator('.arow.result.cur', {hasText: 'October rent received'}).waitFor();
    const opened = page.waitForRequest(request => request.url().endsWith('/api/search/opened'));
    await page.keyboard.press('Enter');
    await page.locator('.rd-subj', {hasText: 'October rent received'}).waitFor();
    assert.equal((JSON.parse((await opened).postData()!) as {position: number}).position, 3);
    await page.keyboard.press('Escape');
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    // Its line closes it as one opened by hand, and the pointer takes the cursor as a row's does.
    await fold.click();
    await until('the row gone', () => rows.count(), count => count === 3);
    assert.equal(await fold.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('k');
    await page.locator('.arow.result.cur').waitFor();
    await point(fold);
    // More of the same words: still closed, though a search of them would start open.
    await page.keyboard.press('/');
    await page.keyboard.press('End');
    await page.keyboard.type('s');
    await page.keyboard.press('Enter');
    await until('the keys handed over', () => focused(page), label => label !== 'Search mail');
    await until('its fold', () => fold.getAttribute('aria-expanded'), expanded => expanded === 'false');
    assert.equal(await rows.count(), 3);
    // Another search decides again.
    await page.keyboard.press('/');
    await page.keyboard.type('lease');
    await page.keyboard.press('Enter');
    await page.locator('.search-list .mentions[aria-expanded="true"]').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a fold that starts open pages in with no click, page 2 and on, and closing it stops there', async () => {
  const setpoint = await startSetpoint({fixtures: ['ledger-audit']});
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await page.keyboard.type('vault inventory');
    await page.keyboard.press('Enter');
    const rows = page.locator('.arow.result');
    const fold = page.locator('.search-list .mentions');
    await fold.waitFor();
    assert.equal(await page.locator('.search-list .bar').textContent(), '3 results');
    assert.equal(await fold.textContent(), '60 more mention these words');
    assert.equal(await fold.getAttribute('aria-expanded'), 'true');
    assert.equal(await rows.count(), 50);
    // Off the fold, by the keys, to the place the row shows at.
    await page.locator('.arow.result.cur').waitFor();
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.locator('.search-list .mentions.cur').waitFor();
    await page.keyboard.press('j');
    await page.locator('.arow.result.cur').nth(0).waitFor();
    assert.equal(await page.locator('.arow.result.cur').getAttribute('data-id'), await rows.nth(3).getAttribute('data-id'));
    const opened = page.waitForRequest(request => request.url().endsWith('/api/search/opened'));
    await page.keyboard.press('Enter');
    await page.locator('.rd-subj').waitFor();
    assert.equal((JSON.parse((await opened).postData()!) as {position: number}).position, 3);
    await page.keyboard.press('Escape');
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    // Page 2 comes as the list nears its end.
    await rows.last().scrollIntoViewIfNeeded();
    await until('every row', () => rows.count(), count => count === 63);
    // Closed, its rows go, and it stays closed.
    await fold.click();
    await until('the rows above it', () => rows.count(), count => count === 3);
    assert.equal(await fold.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search\'s fold across pages: what\'s above it pages in, nothing under it is asked for until it opens, then its pages come', async () => {
  const setpoint = await startSetpoint({fixtures: ['ledger-audit']});
  try {
    const page = await load(setpoint);
    const searches: {offset?: number}[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/search')) searches.push(JSON.parse(request.postData()!) as {offset?: number});
    });
    await page.keyboard.press('/');
    await page.keyboard.type('ledger audit');
    await page.keyboard.press('Enter');
    const rows = page.locator('.arow.result');
    const fold = page.locator('.search-list .mentions');
    await rows.nth(49).waitFor();
    assert.equal(await page.locator('.search-list .bar').textContent(), '60 results');
    assert.equal(await rows.count(), 50);
    assert.equal(await fold.count(), 0);
    // To the list's end: the rest of the first section, and only then the fold under it.
    await rows.last().scrollIntoViewIfNeeded();
    await fold.waitFor();
    assert.equal(await rows.count(), 60);
    assert.equal(await fold.textContent(), '60 more mention these words');
    assert.equal(await rows.last().locator('.l2').textContent(), 'Ledger audit, part 1');
    await fold.scrollIntoViewIfNeeded();
    // A pause for a "nothing happened" check: the page under the fold isn't asked for.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.deepEqual(searches.map(search => search.offset ?? 0).filter(offset => offset > 0), [50]);
    // J from the last row above stops on the fold; Enter opens it, and the rows loaded with the last page show at once.
    await rows.last().hover();
    await page.locator('.arow.result.cur').waitFor();
    await page.keyboard.press('j');
    await page.locator('.search-list .mentions.cur').waitFor();
    await page.keyboard.press('Enter');
    await until('the rows under it', () => rows.count(), count => count > 60);
    assert.equal((await rows.nth(60).locator('.l2').textContent()), 'Quarter notes, part 60');
    // J goes on through them, and an open logs the place the row shows at, the fold's line uncounted.
    const second = await rows.nth(61).locator('.l2').textContent();
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.locator('.arow.result.cur .l2').getByText(second!, {exact: true}).waitFor();
    const opened = page.waitForRequest(request => request.url().endsWith('/api/search/opened'));
    await page.keyboard.press('Enter');
    await page.locator('.rd-subj').waitFor();
    const log = JSON.parse((await opened).postData()!) as {position: number};
    assert.equal(log.position, 61);
    await page.keyboard.press('Escape');
    await page.locator('.rd-subj').waitFor({state: 'detached'});
    // Their last page comes as the list nears its end.
    await rows.last().scrollIntoViewIfNeeded();
    await until('every row', () => rows.count(), count => count === 120);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a click on a chip, the search glyph or the Esc hint keeps every chip and goes to the words; the pointer over the field lights no ×', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await page.keyboard.type('northwind rejection march');
    await page.keyboard.press('Enter');
    await until('the chips', () => chips(page), shown => shown.join(' | ') === 'OrgNorthwind Talent | TypeRejection | DateMar 2026');
    const search = page.locator('.hd .search');
    const first = search.locator('.qchip').first().locator('.x');
    for (const [what, part] of [['the third chip', search.locator('.qchip', {hasText: 'Mar 2026'}).locator('.k')], ['the glyph', search.locator('svg.icon').first()], ['the hint', search.locator('.kbd')]] as const) {
      await page.locator('.hd-title').click();
      await until(`the words left before ${what}`, () => focused(page), label => label !== 'Search mail');
      await part.hover();
      assert.equal(await first.evaluate(x => x.matches(':hover')), false, `over ${what}, the first chip's × isn't lit`);
      await part.click();
      await until(`${what} goes to the words`, () => focused(page), label => label === 'Search mail');
      assert.deepEqual(await chips(page), ['OrgNorthwind Talent', 'TypeRejection', 'DateMar 2026'], `a click on ${what}`);
    }
    // Only a chip's own × removes it.
    await first.click();
    await until('the first chip gone', () => chips(page), shown => shown.join(' | ') === 'TypeRejection | DateMar 2026');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('"!" leaves out what a word names, as it\'s typed and on Enter: a Not chip with the model given only the rest, or the mail with a word kept as typed; a quote stays whole (SV-31)', async () => {
  const {setpoint, fake, stop} = await withAlfred({readings: {...SEED_READINGS, renewal: {keywords: 'renewal'}}});
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await page.keyboard.type('northwind !rejection');
    // In force as it's typed, in the field's own words.
    await until('Northwind without its rejections', () => titles(page), shown => shown.length > 0 && !shown.some(text => /Update on your application|Data Engineer Intern/.test(text)));
    assert.deepEqual(await chips(page), []);
    await page.keyboard.press('Enter');
    await until('the chips', () => chips(page), shown => shown.join(' | ') === 'OrgNorthwind Talent | Not TypeRejection');
    assert.deepEqual(fake.read, ['northwind']);
    assert.equal(await field(page).inputValue(), '');
    await until('Northwind without its rejections', () => titles(page),
      shown => shown.length === 2 && !shown.some(text => /Update on your application|Data Engineer Intern/.test(text)));
    // A Not chip stood for no word to give back: it goes, and what it left out returns.
    await page.locator('.qchip', {hasText: 'Rejection'}).locator('.x').click();
    await until('its rejections back', () => titles(page), shown => shown.some(text => /Update on your application/.test(text)));
    assert.equal(await field(page).inputValue(), '');
    await page.locator('.search .qchip:not([aria-hidden]) .x').first().click();
    await until('its word back', () => field(page).inputValue(), value => value === 'northwind');
    // A word that forms no chip stays in the field, "!" and all.
    await field(page).fill('renewal !lease');
    await page.keyboard.press('Enter');
    await until('the renewals but the lease', () => page.locator('.list .arow.result').count(), count => count === 2);
    assert.equal(await field(page).inputValue(), 'renewal !lease');
    assert.equal(await page.locator('.list .arow.result', {hasText: 'Lease renewal terms'}).count(), 0);
    // Quotes are what the user said exactly: nothing to read, and no chip.
    await field(page).fill('"lease renewal"');
    await page.keyboard.press('Enter');
    await until('the phrase', () => titles(page), shown => shown.join() === 'Lease renewal terms,October rent received');
    assert.deepEqual([await chips(page), await field(page).inputValue(), fake.read], [[], '"lease renewal"', ['northwind', 'renewal']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('UX #9: search results show what was done to them: an opened one loses its dot, Done is marked, Trash takes it out until Undo', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    // Google: the protected recovery email, in Attention, so it has Done (#93), and the sign-in alerts.
    await page.keyboard.type('google');
    await page.keyboard.press('Enter');
    const rows = page.locator('.arow.result');
    await rows.first().waitFor();
    const unread = await page.locator('.arow.result.unread').count();
    assert.ok(unread >= 2, `at least two unread Google emails (${unread})`);
    const first = page.locator('.arow.result.unread', {hasText: 'Your recovery email was changed'});
    const id = Number(await first.getAttribute('data-id'));
    await first.click();
    await page.locator('.rd-subj').waitFor();
    // Opened: its dot goes.
    await until('the dot goes', () => page.locator(`.arow.result[data-id="${id}"].unread`).count(), count => count === 0);
    // H: Done, and the next opens; the Done row says so, and the next one loses its dot too.
    await page.keyboard.press('h');
    await page.locator(`.arow.result[data-id="${id}"].done .tag`, {hasText: 'Done'}).waitFor();
    const next = Number(await page.locator('.arow.result.open').getAttribute('data-id'));
    assert.notEqual(next, id);
    await until('the next one read', () => page.locator(`.arow.result[data-id="${next}"].unread`).count(), count => count === 0);
    // Undo: Done comes off.
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await until('Done off', () => page.locator(`.arow.result[data-id="${id}"].done`).count(), count => count === 0);
    // E: Trash takes the open one out of the results; Undo brings it back.
    await page.locator(`.arow.result[data-id="${id}"]`).click();
    await page.keyboard.press('e');
    await until('out of the results', () => page.locator(`.arow.result[data-id="${id}"]`).count(), count => count === 0);
    await page.locator('.toast button', {hasText: 'Undo'}).click();
    await page.locator(`.arow.result[data-id="${id}"]`).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Alfred: ⌘Enter answers above the results with its source, a follow-up goes below, a source opens', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await page.keyboard.type('When does my lease renewal need to be signed?');
    await page.locator('.arow.result').first().waitFor();
    await page.keyboard.press('Meta+Enter');
    await page.locator('.answer .ans').first().waitFor();
    assert.equal(await page.locator('.answer .ans').first().innerHTML(), 'By <b>Oct 31, 2026</b>, per Parkside\'s Sep 30 email.');
    assert.equal(await page.locator('.ask').count(), 0, 'the Answer card stands in for Ask Alfred');
    assert.equal(await page.locator('.answer .q').count(), 0, 'the first question is the field\'s');
    // The source opens in the reading pane, where the answer's bold phrase is highlighted.
    await page.locator('.answer .src', {hasText: 'Lease renewal terms'}).click();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await page.locator('.answer .src.open').waitFor();
    // Its body is in after its head, which the row draws at once.
    await page.locator('.mailtext mark.hl').first().waitFor();
    assert.deepEqual(await page.locator('.mailtext mark.hl').allTextContents(), ['Oct 31, 2026']);
    // A follow-up, below the first turn.
    await page.locator('.answer input').click();
    await page.keyboard.type('what\'s the new rent?');
    await page.keyboard.press('Enter');
    await page.locator('.answer .q', {hasText: 'what\'s the new rent?'}).waitFor();
    await until('the second answer', () => page.locator('.answer .ans').count(), count => count === 2);
    assert.equal(await page.locator('.answer .ans').nth(1).innerHTML(), '<b>$2,140</b> a month, up from $2,060.');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ask a follow-up');
    // Esc in the follow-up closes the card (a copy that takes nothing folds away in its place); the results stay.
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.answer:not([aria-hidden])').count(), 0);
    await page.locator('.ask').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('Alfred: ⌘Enter asks the words in the order typed, though Enter\'s chips took them from the field and sit first, and what\'s typed after; plain Enter never asks him', async () => {
  const question = 'When does northwind need my availability';
  const {setpoint, fake, stop} = await withAlfred({readings: {[question]: {organisations: ['Northwind Talent'], keywords: 'availability'}}});
  try {
    const page = await load(setpoint);
    const asks: string[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/alfred/ask')) asks.push((JSON.parse(request.postData()!) as {question: string}).question);
    });
    await page.keyboard.press('/');
    await page.keyboard.type(question);
    await page.keyboard.press('Enter');
    await until('the organisation chipped', () => chips(page), shown => shown.join() === 'OrgNorthwind Talent');
    assert.equal(await field(page).inputValue(), 'availability');
    assert.deepEqual(fake.read, [question]);
    assert.deepEqual(asks, []);
    await page.locator('.arow.result.cur').first().waitFor();
    await page.keyboard.press('Meta+Enter');
    await until('the question as typed', async () => asks, sent => sent.length === 1);
    assert.equal(asks[0], question);
    await page.locator('.answer').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.ask').waitFor();
    // More typed after it joins the end, chips or no chips.
    await page.keyboard.press('/');
    await page.keyboard.press('End');
    await page.keyboard.type(' today');
    await page.keyboard.press('Meta+Enter');
    await until('the question and what came after', async () => asks, sent => sent.length === 2);
    assert.equal(asks[1], `${question} today`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

/** Each row's account and age: one line each, the age not cut, the account clear of it, ends aligned. */
async function rowEnds(page: Page, row: string, account: string) {
  return page.locator(row).evaluateAll((rows, account) => rows.map(element => {
    const ac = element.querySelector(account)!.getBoundingClientRect();
    const label = element.querySelector(`${account} .label`) as HTMLElement;
    const age = element.querySelector('.age') as HTMLElement;
    const box = age.getBoundingClientRect();
    return {
      age: age.textContent, label: label.textContent, labelCut: label.scrollWidth > label.clientWidth,
      ageLines: Math.round(box.height / parseFloat(getComputedStyle(age).lineHeight || '16')), ageCut: age.scrollWidth > age.clientWidth,
      gap: Math.round(box.left - ac.right), ageRight: Math.round(box.right), inside: box.right <= element.getBoundingClientRect().right,
    };
  }), account);
}

test('Alfred\'s sources and the results: a long account label and an age with its year stay whole, on one line, clear of each other; Ask Alfred leads the results', async () => {
  const fake = await fakeAlfred(rejectionsAlfred);
  const setpoint = await startSetpoint({fixtures: ['last-year'], env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  try {
    await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
    const jobs = (await setpoint.api<AccountOut[]>('GET', '/accounts')).find(account => account.label === 'Jobs')!;
    await setpoint.api('PATCH', `/accounts/${jobs.id}`, {label: 'Job applications (2026)'});
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await page.keyboard.type('northwind rejection');
    await page.locator('.arow.result').first().waitFor();
    // Ask Alfred is the list's first row, above the results line and the results (board 06), so it
    // doesn't wait at the foot of a long list.
    const order = await page.locator('.search-list').evaluate(list => [...list.children].map(child => child.className.split(' ')[0]));
    assert.deepEqual(order.slice(0, 3), ['ask', 'bar', 'arow'], `Ask Alfred leads: ${order.join(', ')}`);
    // The results: an age with its year on one line, inside the row.
    const results = await rowEnds(page, '.arow.result', '.r1');
    assert.ok(results.some(row => row.age === 'Dec 20, 2025'), JSON.stringify(results));
    for (const row of results) {
      assert.equal(row.ageLines, 1, `${row.age} on one line`);
      assert.ok(!row.ageCut && row.inside, `${row.age} whole, inside its row`);
      assert.ok(!row.labelCut, `${row.label} whole`);
    }
    // Alfred's sources: the same, the account clear of the age, and each column's ends aligned.
    await page.keyboard.press('Meta+Enter');
    await page.locator('.answer .src').first().waitFor();
    const sources = await rested(() => rowEnds(page, '.answer .src', '.ac'));
    assert.ok(sources.length >= 3, `${sources.length} sources`);
    assert.ok(sources.some(row => row.age === 'Dec 20, 2025'), JSON.stringify(sources));
    for (const row of sources) {
      assert.equal(row.ageLines, 1, `${row.age} on one line`);
      assert.ok(!row.ageCut && row.inside, `${row.age} whole, inside its row`);
      assert.ok(!row.labelCut, `${row.label} whole`);
      assert.ok(row.gap >= 8, `${row.label} clear of ${row.age} (${row.gap} px)`);
    }
    assert.equal(new Set(sources.map(row => row.ageRight)).size, 1, 'the ages end together');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await fake.close();
  }
});

test('Alfred: the card says what Alfred is doing as it works, the steps it took above it (search-04); a long list shows its first five sources and Show all; the answer keeps a reading measure', async () => {
  const fake = await fakeAlfred(listAlfred, {delayMs: 1500});
  const setpoint = await startSetpoint({env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  try {
    await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
    const page = await load(setpoint);
    await page.keyboard.press('/');
    await page.keyboard.type('northwind');
    await page.locator('.arow.result').first().waitFor();
    await page.keyboard.press('Meta+Enter');
    const waiting = page.locator('.answer .waiting');
    await until('Alfred\'s first line', () => waiting.textContent(), text => text === 'Looking through your mail…');
    await until('the search it runs', () => waiting.textContent(), text => text === 'Searching “the”…', 6000);
    await until('the email it reads', () => waiting.textContent(), text => Boolean(text?.startsWith('Reading ') && text.endsWith('’s email…')), 6000);
    // Its trail (search-04): the search it ran stays above, in the past tense after its 14 px glyph;
    // what it's doing now shimmers; two bars hold the answer's place; the header's glyph twinkles.
    const trail = page.locator('.answer .trail .done-step');
    assert.deepEqual(await trail.allTextContents(), ['Searched “the”']);
    assert.deepEqual(await trail.locator('.icon').evaluateAll(icons => icons.map(icon => [icon.querySelector('path')!.getAttribute('d'), icon.getAttribute('width')])), [[ICONS.search, '14']]);
    assert.equal(await rested(() => trail.first().evaluate(row => row.getBoundingClientRect().height)), 20);
    assert.deepEqual(await rested(() => waiting.locator('.now').evaluate(now => [getComputedStyle(now).animationName, getComputedStyle(now).animationDuration, getComputedStyle(now).backgroundClip])), ['alfred-shimmer', '1.6s', 'text']);
    assert.equal(await page.locator('.answer [data-skeleton="answer"] .sk-bar').count(), 2);
    assert.deepEqual(await rested(() => page.locator('.answer .card-h > .icon').evaluate(icon => [getComputedStyle(icon).animationName, getComputedStyle(icon).animationDuration, getComputedStyle(icon).animationDirection])), ['twinkle', '1.2s', 'alternate']);
    await page.locator('.answer .ans').waitFor({timeout: 10_000});
    // The answer fades up where its place was held; the trail folds away.
    assert.equal(await page.locator('.answer .ans').evaluate(ans => getComputedStyle(ans).animationName), 'turn-in');
    await page.locator('.answer .trail').waitFor({state: 'detached'});
    assert.equal(await page.locator('.answer [data-skeleton]').count(), 0);
    const total = Number((await page.locator('.answer .ans').textContent())!.split(' ')[0]);
    assert.ok(total > 5, `${total} sources`);
    // The first five, and Show all; then every one, and Show fewer.
    assert.equal(await page.locator('.answer .src').count(), 5);
    await page.locator('.answer .more', {hasText: `Show all ${total}`}).click();
    assert.equal(await page.locator('.answer .src').count(), total);
    await page.locator('.answer .more', {hasText: 'Show fewer'}).click();
    assert.equal(await page.locator('.answer .src').count(), 5);
    // The answer's lines stop at a reading measure, though the card runs the list's width.
    const [line, card] = await Promise.all([page.locator('.answer .ans').evaluate(element => element.getBoundingClientRect().width), page.locator('.answer').evaluate(element => element.getBoundingClientRect().width)]);
    assert.ok(card > 900 && line <= 680, `the answer ${Math.round(line)} px wide in a ${Math.round(card)} px card`);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await fake.close();
  }
});

test('Alfred: Ask about this email opens the card in the reader, scoped to it; with no key, it says so as it opens and links to Settings › AI', async () => {
  const {setpoint, stop} = await withAlfred();
  try {
    const page = await load(setpoint);
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await page.locator('.rd-acts button', {hasText: 'Ask about this email'}).click();
    await page.locator('.pane .answer input[placeholder="Ask about this email…"]').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Ask a follow-up');
    assert.equal(await page.locator('.rd-acts .btn.ghost').textContent(), 'Ask about this email');
    const asked = page.waitForRequest(request => request.url().endsWith('/api/alfred/ask'));
    await page.keyboard.type('When does my lease renewal need to be signed?');
    await page.keyboard.press('Enter');
    assert.equal(JSON.parse((await asked).postData()!).message_id, await idOf(setpoint, 'Lease renewal terms'));
    await page.locator('.pane .answer .q', {hasText: 'When does my lease renewal need to be signed?'}).waitFor();
    await page.locator('.pane .answer .ans', {hasText: 'By Oct 31, 2026'}).waitFor();
    // The button closes it again.
    await page.locator('.rd-acts button', {hasText: 'Ask about this email'}).click();
    assert.equal(await page.locator('.pane .answer:not([aria-hidden])').count(), 0);
    // With no key, the card says so as it opens, before anything is asked.
    await setpoint.api('DELETE', '/secrets/anthropic_api_key');
    await page.reload();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await page.locator('.rd-acts button', {hasText: 'Ask about this email'}).click();
    const noKey = page.locator('.pane .answer .failed-line', {hasText: 'Alfred needs an Anthropic or OpenAI key in Settings › AI.'});
    await noKey.waitFor();
    // Asked anyway: the server's words, once, and the question stays in the field.
    await page.keyboard.type('what\'s the new rent?');
    await page.keyboard.press('Enter');
    await until('the question back in the field', () => page.locator('.pane .answer input').inputValue(), value => value === 'what\'s the new rent?');
    assert.equal(await page.locator('.pane .answer .failed-line').count(), 1);
    // "Settings › AI" opens Settings there.
    await noKey.getByRole('button', {name: 'Settings › AI'}).click();
    await until('Settings › AI', () => page.locator('.settings .set-nav .nav.on').textContent(), text => text === 'AI');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await stop();
  }
});

test('Alfred about one email: its first line reads "Reading this email…", and the follow-up field dims until the answer lands', async () => {
  const fake = await fakeAlfred(leaseAlfred, {delayMs: 1500});
  const setpoint = await startSetpoint({env: {SETPOINT_DEV_AI_URL: fake.url}}).catch(async (error: unknown) => {
    await fake.close();
    throw error;
  });
  try {
    await setpoint.api('PUT', '/secrets/anthropic_api_key', {value: FAKE_ANTHROPIC_KEY});
    const page = await load(setpoint);
    await page.locator('.row.shelf', {hasText: 'Parkside Apartments'}).click();
    await page.locator('.rd-subj', {hasText: 'Lease renewal terms'}).waitFor();
    await page.locator('.rd-acts button', {hasText: 'Ask about this email'}).click();
    const field = page.locator('.pane .answer .field');
    await field.locator('input').waitFor();
    const opacity = () => field.evaluate(element => getComputedStyle(element).opacity);
    assert.equal(await rested(() => opacity()), '1');
    let asks = 0;
    page.on('request', request => {
      if (request.url().endsWith('/api/alfred/ask')) asks += 1;
    });
    await page.keyboard.type('When does my lease renewal need to be signed?');
    await page.keyboard.press('Enter');
    await until('Alfred\'s first line', () => page.locator('.pane .answer .waiting').allTextContents(), lines => lines.join() === 'Reading this email…');
    await until('the field dimmed while Alfred answers', opacity, value => value === '0.5');
    // A follow-up typed meanwhile stays in the field, unsent, until the answer is in.
    await page.keyboard.type('what\'s the new rent?');
    await page.keyboard.press('Enter');
    await page.locator('.pane .answer .ans', {hasText: 'By Oct 31, 2026'}).waitFor();
    await until('the field back', opacity, value => value === '1');
    assert.equal(asks, 1);
    assert.equal(await field.locator('input').inputValue(), 'what\'s the new rent?');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await fake.close();
  }
});

test('SV-71: the proposal card\'s Place, emptied, offers the places events have used; a letter narrows them, Enter takes one, Esc closes only the list', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.rd-acts button', {hasText: 'Add to calendar'}).click();
    const card = page.locator('.pane .prop:not([aria-hidden])');
    const place = card.locator('input[aria-label="Place"]');
    await place.waitFor();
    // The field keeps its column's width, as Title's.
    const width = (field: typeof place) => field.locator('xpath=..').evaluate(label => Math.round(label.getBoundingClientRect().width));
    assert.equal(await rested(() => width(place)), await rested(() => width(card.locator('input[aria-label="Title"]'))));
    // Its own place from the email offers nothing; emptied, the recent places show.
    await place.focus();
    const places = card.getByRole('listbox', {name: 'Places'});
    assert.equal(await places.count(), 0);
    await place.fill('');
    await until('the recent places', () => places.locator('.place-name').allTextContents(), list => list.join() === 'University Student Union,Blue Door,Smile Dental');
    // Esc closes the list, not the card.
    await page.keyboard.press('Escape');
    await until('the list goes', () => places.count(), count => count === 0);
    assert.equal(await card.count(), 1);
    await place.pressSequentially('s');
    await until('narrowed by "s"', () => places.locator('.place-name').allTextContents(), list => list.join() === 'Smile Dental,University Student Union');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await until('University Student Union picked', () => place.inputValue(), value => value === 'University Student Union');
    assert.equal(await places.count(), 0);
    assert.equal(await card.count(), 1, 'Enter picked rather than created');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the proposal card: Add to calendar pre-fills from the email, Create waits for Google Calendar, More options opens the editor', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.rd-acts button', {hasText: 'Add to calendar'}).click();
    // The card itself, not the copy that folds away in its place once it closes (app/fold.ts).
    const card = page.locator('.pane .prop:not([aria-hidden])');
    await card.waitFor();
    assert.equal(await card.locator('input[aria-label="Title"]').inputValue(), 'CS 101 final exam');
    assert.deepEqual(await card.locator('.prow .field input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)), ['Wed, Dec 9', '7:00 PM', '9:00 PM']);
    // The reminder follows Settings' default, which the card loads when it opens.
    await until('the calendar and reminder picks', () => card.locator('.prow .field.pick').allTextContents(), picks => picks.join() === 'Classes,10 min before');
    assert.equal(await card.locator('input[aria-label="Place"]').inputValue(), 'Contoso University · Room 214');
    assert.equal(await card.locator('.conflict').textContent(), 'Free that evening');
    assert.equal(await card.locator('.srcm').count(), 3);
    assert.equal(await page.locator('.rd-acts .btn.ghost').textContent(), 'Add to calendar');
    // A press outside the reminder menu closes it; the card stays (SV-24).
    await card.locator('button[aria-label="Reminder"]').click();
    await card.locator('.pop.menu').waitFor();
    await card.locator('.card-h').click();
    await card.locator('.pop.menu').waitFor({state: 'detached'});
    assert.equal(await card.count(), 1);
    // Esc cancels; nothing was created.
    await card.locator('input[aria-label="Title"]').press('Escape');
    assert.equal(await card.count(), 0);
    assert.equal(await page.locator('.rd-subj').count(), 1, 'the reader stays');
    const exams = async () => (await setpoint.api<ItemsOut>('GET', '/items?from=2026-12-01&to=2027-01-01')).items.filter(item => item.title === 'CS 101 final exam');
    assert.equal((await exams()).length, 0);
    // Create: pending (.5) until Google Calendar confirms, then the card goes and the toast says where.
    // The day takes typing (SV-24): moved to Friday, the email's mark and conflict line go.
    await page.locator('.rd-acts button', {hasText: 'Add to calendar'}).click();
    await card.waitFor();
    await card.locator('input[aria-label="Date"]').fill('dec 11');
    await card.locator('input[aria-label="Date"]').press('Enter');
    assert.equal(await card.locator('input[aria-label="Date"]').inputValue(), 'Fri, Dec 11');
    assert.equal(await card.locator('.conflict').count(), 0);
    assert.equal(await card.locator('.srcm').count(), 2);
    await card.locator('button', {hasText: 'Create'}).click();
    await page.locator('.pane .prop.pending').waitFor();
    // The card closing is the answer: a create says nothing (DESIGN #247).
    await card.waitFor({state: 'detached'});
    await setpoint.idle();
    assert.equal(await page.locator('.toast').count(), 0, 'no toast for a create');
    const [created] = await exams();
    const classes = (await setpoint.api<CalendarOut[]>('GET', '/calendars')).find(calendar => calendar.name === 'Classes')!;
    assert.deepEqual([created?.calendar_id, created?.starts_at, created?.ends_at, created?.place], [classes.id, '2026-12-12T03:00:00.000Z', '2026-12-12T05:00:00.000Z', 'Contoso University · Room 214']);
    // More options: the editor in Calendar, pre-filled from this email.
    await page.locator('.rd-acts button', {hasText: 'Add as task'}).click();
    await card.waitFor();
    assert.equal(await card.locator('input[aria-label="Project"]').inputValue(), 'School');
    // A labelled button's glyph is 17, open_in_new as Add's (#123).
    assert.equal(await card.getByRole('button', {name: 'More options'}).locator('.icon').getAttribute('width'), '17');
    // S4: the card's fields as left go with it; those changed lose the email's mark.
    await card.locator('input[aria-label="Title"]').fill('Study for the final');
    await card.locator('input[aria-label="Date"]').fill('dec 8');
    await card.locator('input[aria-label="Date"]').press('Enter');
    await card.locator('input[aria-label="Project"]').fill('Finals');
    await card.locator('.pop.menu .menu-i', {hasText: 'New project “Finals”'}).click();
    await card.locator('button', {hasText: 'More options'}).click();
    const exam = await idOf(setpoint, 'Final exam schedule');
    await until('the editor\'s address', async () => page.url(), url => url.endsWith(`/calendar/new?kind=task&message=${exam}`));
    const editor = page.locator('.editor');
    await until('the card\'s title in the editor\'s line', () => editor.getByLabel('Describe the task').inputValue(), value => value === 'Study for the final');
    assert.deepEqual([await editor.getByLabel('Due date', {exact: true}).inputValue(), await editor.getByLabel('Project', {exact: true}).inputValue()], ['Tue, Dec 8', 'Finals']);
    await editor.locator('.field .tag', {hasText: 'New'}).waitFor();
    assert.equal(await editor.locator('.nl .srcm').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Security mail: Add to calendar and Add as task are in the More menu, which opens the proposal', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.row', {hasText: 'New sign-in'}).click();
    await page.locator('.facts').waitFor();
    assert.deepEqual(await page.locator('.rd-acts button').allTextContents(), ['Ask about this email']);
    await page.locator('.rd-tools [aria-label="More"]').click();
    const menu = page.locator('.more-menu');
    assert.deepEqual(await menu.locator('button').allTextContents(), ['Add to calendar', 'Add as task']);
    // Esc closes the menu, not the reader.
    await page.keyboard.press('Escape');
    assert.equal(await menu.count(), 0);
    assert.equal(await page.locator('.rd-subj').count(), 1);
    await page.locator('.rd-tools [aria-label="More"]').click();
    await menu.locator('button', {hasText: 'Add to calendar'}).click();
    await page.locator('.pane .prop input[aria-label="Title"]').waitFor();
    assert.equal(await menu.count(), 0);
    // On other mail the buttons stay under the head, and More, holding nothing, doesn't show (SV-24).
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.rd-acts button', {hasText: 'Add to calendar'}).waitFor();
    assert.equal(await page.locator('.rd-tools [aria-label="More"]').count(), 0);
    // The sign-in's proposal, left open, doesn't stop this email's (SV-24).
    await page.locator('.rd-acts button', {hasText: 'Add to calendar'}).click();
    await until('this email\'s proposal', () => page.locator('.pane .prop input[aria-label="Title"]').inputValue(), title => title === 'CS 101 final exam');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a proposal with no day from the email starts blank; a day typed and Create, without leaving the field, makes it (SV-24)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.row', {hasText: 'New sign-in'}).click();
    await page.locator('.rd-tools [aria-label="More"]').click();
    await page.locator('.more-menu button', {hasText: 'Add to calendar'}).click();
    const day = page.locator('.pane .prop input[aria-label="Date"]');
    await day.waitFor();
    assert.deepEqual([await day.inputValue(), await day.getAttribute('placeholder')], ['', 'Pick a day']);
    await day.fill('oct 20');
    await page.locator('.pane .prop button', {hasText: 'Create'}).click();
    await page.locator('.pane .prop:not([aria-hidden])').waitFor({state: 'detached'});
    const items = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-10-20&to=2026-10-21')).items;
    assert.ok(items.some(item => item.all_day && item.start_date === '2026-10-20'), 'an all-day event on Oct 20');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

const calendarRows = (page: Page) => page.locator('.cal-search .cs-result .title').allTextContents();
const selectedRow = (page: Page) => page.locator('.cal-search .cs-result.sel .title').allTextContents();
const detailOf = (page: Page, title: string) => page.getByRole('dialog', {name: title});

test('calendar search: the header turns into Search, chips and results in the right pane, a result selected on the grid', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-grid .ev').first().waitFor();
    // `/` opens it: the header reads Search, the field is focused, and the pane says what it finds.
    await page.keyboard.press('/');
    await page.locator('.hd-title', {hasText: 'Search'}).waitFor();
    assert.equal(await page.locator('.hd .seg').count(), 0, 'Month | Week hides');
    assert.equal(await page.locator('.hd .cal-step').count(), 1, 'the grid still pages');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search calendar');
    assert.equal(await page.locator('.cs-hint').textContent(), 'Search events and tasks by title, place, people or calendar, or a date like ‘march’');
    await page.locator('.cal-grid .ev').first().waitFor();
    // Words become chips; Enter goes to the first result, selected on the grid with its card.
    await page.keyboard.type('classes october');
    await page.locator('.cal-search .cs-result').first().waitFor();
    await page.keyboard.press('Enter');
    await until('the chips', () => chips(page), shown => shown.join(' | ') === 'CalendarClasses | DateOct 2026');
    assert.equal(await page.locator('.cal-search .bar').textContent(), '2 results');
    assert.deepEqual(await page.locator('.cal-search .ag-day').allTextContents(), ['Upcoming']);
    assert.deepEqual(await calendarRows(page), ['CS 101 lecture', 'Study group']);
    const lecture = page.locator('.cal-search .cs-result').first();
    assert.equal(await lecture.locator('.line').textContent(), '6:00 – 7:15 PM · Weekly on Tue, Thu · Classes');
    assert.equal(await lecture.locator('.why').textContent(), 'Calendar Classes');
    await detailOf(page, 'CS 101 lecture').waitFor();
    await until('the marked row', () => selectedRow(page), rows => rows.join() === 'CS 101 lecture');
    assert.deepEqual(await page.locator('.cell[data-date="2026-10-08"] .ev.sel').allTextContents(), ['6 PMCS 101 lecture']);
    // J and K step through the results as clicks do: the card glides, the row stays marked.
    await page.keyboard.press('j');
    await detailOf(page, 'Study group').waitFor();
    await until('the marked row', () => selectedRow(page), rows => rows.join() === 'Study group');
    await page.keyboard.press('k');
    await detailOf(page, 'CS 101 lecture').waitFor();
    // A free word: the match highlighted in the row and its reason. `/` selects the whole query
    // (SV-25), so the word replaces it.
    await page.keyboard.press('/');
    assert.equal(await page.locator('.search .qchip.sel').count(), 2);
    await page.keyboard.type('blue');
    await until('the rows', () => calendarRows(page), rows => rows.join() === 'Dinner with Sam');
    // An answer to the half-typed word ("blu") has the same rows; its mark is the half word.
    await until('the whole word marked', () => page.locator('.cs-result .why mark.hl').textContent(), text => text === 'Blue');
    assert.equal(await page.locator('.cs-result .why').textContent(), 'Place Blue Door');
    // A click scrolls to its day and selects it there.
    await page.locator('.cs-result', {hasText: 'Dinner with Sam'}).click();
    await detailOf(page, 'Dinner with Sam').waitFor();
    await until('the chip on the grid', () => page.locator('.cell[data-date="2026-10-09"] .ev.sel').allTextContents(), shown => shown.join() === '7 PMDinner with Sam');
    writeOutput('calendar-search.actual.png', await page.screenshot());
    // E hands it to the editor; Esc (Cancel) brings the results back.
    await page.keyboard.press('e');
    await page.locator('.editor.handed').waitFor();
    assert.equal(await page.locator('.cal-search').count(), 0);
    await page.keyboard.press('Escape');
    await page.locator('.cal-search .cs-result').first().waitFor();
    // Esc closes the card first, then the search.
    await detailOf(page, 'Dinner with Sam').waitFor();
    await page.keyboard.press('Escape');
    await until('the card closes', () => page.locator('.fd').count(), count => count === 0);
    await page.locator('.hd-title', {hasText: 'Search'}).waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.hd-title', {hasText: 'October 2026'}).waitFor();
    assert.equal(await page.locator('.cal-search').count(), 0);
    await page.locator('.rpane .rp-date').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('calendar search: a result\'s line stays on one line, cut with an ellipsis and whole in its title', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-grid .ev').first().waitFor();
    await page.keyboard.press('/');
    await page.keyboard.type('gym');
    const gym = page.locator('.cal-search .cs-result', {hasText: 'Gym'}).first();
    await gym.waitFor();
    const line = gym.locator('.line');
    assert.equal(await line.getAttribute('title'), await line.textContent());
    assert.ok((await rested(() => line.boundingBox()))!.height <= 20, 'one line');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('calendar search: the button and ⌘F, Todoist as every task under Upcoming and Past, ↓ to the first, no results with chips removable', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.cal-grid .ev').first().waitFor();
    await page.getByRole('button', {name: 'Search calendar'}).click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search calendar');
    await page.keyboard.press('Escape');
    await page.locator('.hd-title', {hasText: 'October 2026'}).waitFor();
    await page.keyboard.press('Meta+f');
    await page.locator('.hd-title', {hasText: 'Search'}).waitFor();
    await page.keyboard.type('todoist ');
    await until('the chips', () => chips(page), shown => shown.join() === 'CalendarTodoist');
    await until('the rows', () => calendarRows(page), rows => rows.length === 4);
    assert.deepEqual(await page.locator('.cal-search .ag-day').allTextContents(), ['Upcoming', 'Past']);
    assert.deepEqual(await calendarRows(page), ['CS 101 lab report', 'Pay rent', 'Renew car registration', 'Return library books']);
    // ↓ goes to the first result.
    await page.keyboard.press('ArrowDown');
    await detailOf(page, 'CS 101 lab report').waitFor();
    await until('the marked row', () => selectedRow(page), rows => rows.join() === 'CS 101 lab report');
    // `/` with the search open selects the whole query, chips too (SV-25); End keeps it to add a word.
    await page.keyboard.press('/');
    assert.equal(await page.locator('.search .qchip.sel').count(), 1);
    await page.keyboard.press('End');
    assert.equal(await page.locator('.search .qchip.sel').count(), 0);
    // No results: each part removable.
    await page.keyboard.type('zebra');
    await page.locator('.cal-search .no-results').waitFor();
    assert.equal(await page.locator('.cal-search .no-results').textContent(), 'No events or tasks matchTodoistzebra');
    await page.locator('.no-results .x[aria-label="Remove zebra"]').click();
    await until('the rows', () => calendarRows(page), rows => rows.length === 4);
    // SV-29: a query emptied after searching closes the search, as Esc would.
    await page.keyboard.press('/');
    await page.keyboard.press('Backspace');
    await page.locator('.hd-title', {hasText: 'October 2026'}).waitFor();
    assert.equal(await page.locator('.cal-search').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a task proposal: no Place; Project suggests Todoist\'s projects, and makes one only when New project is picked (SV-24, D50)', async () => {
  const setpoint = await startSetpoint();
  try {
    const page = await load(setpoint);
    await page.locator('.list .row[title^="Final exam schedule"]').click();
    await page.locator('.rd-acts button', {hasText: 'Add as task'}).click();
    const card = page.locator('.pane .prop:not([aria-hidden])');
    await card.waitFor();
    assert.equal(await card.locator('input[aria-label="Place"]').count(), 0);
    const field = card.locator('input[aria-label="Project"]');
    const menu = card.locator('.pop.menu');
    await field.fill('');
    assert.deepEqual(await menu.locator('.menu-i').allTextContents(), ['Inbox↵', 'School', 'Home']);
    // A typo isn't made into a project: Create says so.
    await field.fill('Wrok');
    assert.deepEqual(await menu.locator('.menu-i').allTextContents(), ['New project “Wrok”↵']);
    await card.locator('.card-h').click();
    await menu.waitFor({state: 'detached'});
    await card.locator('button', {hasText: 'Create'}).click();
    await card.locator('.failed-line', {hasText: 'No project named “Wrok”, pick one or create it'}).waitFor();
    const projects = () => setpoint.api<TodoistProjectOut[]>('GET', '/todoist/projects').then(list => list.map(one => one.name));
    assert.deepEqual(await projects(), ['Inbox', 'School', 'Home']);
    // New project, picked, makes it with the task.
    await field.fill('Work');
    await menu.locator('.menu-i', {hasText: 'New project “Work”'}).click();
    // SV-25: the pick shows, tagged New, and isn't offered again.
    await card.locator('.field .tag', {hasText: 'New'}).waitFor();
    assert.equal(await field.inputValue(), 'Work');
    await field.click();
    assert.equal(await menu.count(), 0);
    await card.locator('button', {hasText: 'Create'}).click();
    await card.waitFor({state: 'detached'});
    assert.ok((await projects()).includes('Work'));
    const tasks = (await setpoint.api<ItemsOut>('GET', '/items?from=2026-12-01&to=2027-01-01')).items.filter(item => item.kind === 'task' && item.title === 'CS 101 final exam');
    assert.deepEqual(tasks.map(task => task.project), ['Work']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
