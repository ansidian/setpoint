// News's store rules as tables (src/domain/news.ts): the page's 48 hours and the archive's 90 days,
// the dot per story, what's new since the user looked, which image copies the archive keeps, a block's
// size, the leading outlet with "+N", a story's main section, and a section's line.
import type {NewsSection} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {Health} from '../src/domain/health.ts';
import {
  ARCHIVE_MS, blockSize, expiresAt, keepsImage, leadOf, listedArticles, mainSection, newSince, purgeAt, sectionHealth, sectionOrder, STORY_TTL_MS, storyStage,
  storyState,
} from '../src/domain/news.ts';
import type {OutletArticle, StoryReading} from '../src/domain/news.ts';

const FACT = '2026-10-05T15:40:00.000Z';
const after = (hours: number, from = FACT) => new Date(Date.parse(from) + hours * 3_600_000).toISOString();

describe('a story\'s life', () => {
  test('it leaves the page 48 hours after its last new fact, and the archive 90 days after it', () => {
    expect(STORY_TTL_MS).toBe(48 * 3_600_000);
    expect(ARCHIVE_MS).toBe(90 * 24 * 3_600_000);
    expect(expiresAt(FACT)).toBe('2026-10-07T15:40:00.000Z');
    expect(purgeAt(FACT)).toBe('2027-01-03T15:40:00.000Z');
  });

  test.each<[string, string, ReturnType<typeof storyStage>]>([
    ['just after its fact', after(0.1), 'page'],
    ['a minute before 48 hours', after(48 - 1 / 60), 'page'],
    ['at 48 hours exactly', after(48), 'archive'],
    ['a week on', after(24 * 7), 'archive'],
    ['a minute before 90 days', after(24 * 90 - 1 / 60), 'archive'],
    ['at 90 days', after(24 * 90), 'purge'],
  ])('%s: %s', (_, now, stage) => {
    expect(storyStage(FACT, now)).toBe(stage);
  });

  test('a new fact starts the 48 hours again: a developing story stays up', () => {
    const now = after(60);
    expect(storyStage(FACT, now)).toBe('archive');
    expect(storyStage(after(20), now)).toBe('page');
  });
});

describe('the dot, per story', () => {
  const LOOKED = '2026-10-06T05:40:00.000Z';
  test.each<[string, string | null, string, ReturnType<typeof storyState>]>([
    ['never seen: new', null, '2026-10-07T15:40:00.000Z', 'new'],
    ['never seen, however old: new', null, '2026-10-05T10:00:00.000Z', 'new'],
    ['seen after its last fact: seen', LOOKED, '2026-10-06T04:30:00.000Z', 'seen'],
    ['seen at the moment of its last fact: seen', LOOKED, LOOKED, 'seen'],
    ['a fact since the user saw it: updated', LOOKED, '2026-10-07T15:40:00.000Z', 'updated'],
  ])('%s', (_, seenAt, lastNewFactAt, state) => {
    expect(storyState(seenAt, lastNewFactAt)).toBe(state);
  });

  test('new since you looked: the facts after the seen time, only when there are any', () => {
    const facts = [{at: '2026-10-05T13:12:00.000Z', text: 'About 60 acres'}, {at: '2026-10-07T13:55:00.000Z', text: 'Schools closed'}, {at: '2026-10-07T15:40:00.000Z', text: 'Grew to 400 acres'}];
    expect(newSince(facts, '2026-10-06T05:40:00.000Z')).toEqual({since: '2026-10-06T05:40:00.000Z', facts: facts.slice(1)});
    expect(newSince(facts, '2026-10-07T16:00:00.000Z')).toBeNull();
    expect(newSince(facts, null)).toBeNull();
  });
});

describe('image copies', () => {
  test.each<[string, Parameters<typeof keepsImage>[0], 'large' | 'thumb', number, boolean]>([
    // name, stage, variant, the copy's article, kept (the story's image is article 1's)
    ['on the page: the story\'s large copy', 'page', 'large', 1, true],
    ['on the page: another source\'s copy (its article view)', 'page', 'large', 2, true],
    ['archived: the story\'s thumbnail stays for its rows', 'archive', 'thumb', 1, true],
    ['archived: the story\'s large copy goes', 'archive', 'large', 1, false],
    ['archived: another source\'s thumbnail goes', 'archive', 'thumb', 2, false],
    ['in Missed: the story\'s large copy stays for its lead (news-09)', 'missed', 'large', 1, true],
    ['in Missed: the story\'s thumbnail stays', 'missed', 'thumb', 1, true],
    ['in Missed: another source\'s large copy goes', 'missed', 'large', 2, false],
    ['purged: even the thumbnail goes', 'purge', 'thumb', 1, false],
  ])('%s', (_, stage, variant, articleId, kept) => {
    expect(keepsImage(stage, {articleId, variant}, 1)).toBe(kept);
  });

  test('a story without an image keeps nothing once archived', () => {
    expect(keepsImage('archive', {articleId: 1, variant: 'thumb'}, null)).toBe(false);
  });
});

describe('a block\'s size', () => {
  test.each<[string, number[], number]>([
    ['nothing', [], 0],
    ['fewer than three', [40, 20], 2],
    ['the top three always', [30, 20, 10, 5], 3],
    ['a fourth and fifth over the bar join', [95, 90, 85, 78, 72, 66], 5],
    ['never more than five', [99, 98, 97, 96, 95, 94], 5],
    ['the fourth under the bar stops it', [88, 80, 75, 66, 90], 3],
    ['exactly the bar counts', [96, 84, 76, 70, 62], 4],
    ['only the top three when the fourth falls short', [97, 86, 82, 68], 3],
  ])('%s', (_, scores, size) => {
    expect(blockSize(scores)).toBe(size);
  });
});

describe('the leading outlet and +N', () => {
  const article = (id: number, outlet: string, hour: number, metered = false): OutletArticle => ({id, outlet, publishedAt: `2026-10-07T${String(hour).padStart(2, '0')}:00:00.000Z`, metered});

  test('one per outlet, newest first, never a metered paper', () => {
    const listed = listedArticles([article(1, 'KTLA', 15), article(2, 'NBC Los Angeles', 14), article(3, 'Los Angeles Times', 15, true), article(4, 'NBC Los Angeles', 10)]);
    expect(listed.map(row => row.id)).toEqual([1, 2]);
  });

  test.each<[string, OutletArticle[], number | null, {id: number; more: number} | null]>([
    ['the chosen lead', [article(1, 'KTLA', 15), article(2, 'NBC Los Angeles', 14), article(3, 'CBS Los Angeles', 13)], 2, {id: 2, more: 2}],
    ['the newest when none is chosen', [article(1, 'KTLA', 12), article(2, 'NBC Los Angeles', 14)], null, {id: 2, more: 1}],
    ['the newest when the chosen one is metered', [article(1, 'Los Angeles Times', 15, true), article(2, 'KTLA', 14)], 1, {id: 2, more: 0}],
    ['a metered paper isn\'t in +N', [article(1, 'KTLA', 15), article(2, 'Los Angeles Times', 14, true), article(3, 'ABC7', 13)], 1, {id: 1, more: 1}],
    ['two articles from one outlet are one outlet', [article(1, 'NPR', 15), article(2, 'NPR', 12), article(3, 'ABC News', 13)], 1, {id: 1, more: 1}],
    ['a story only a metered paper covers never shows', [article(1, 'Los Angeles Times', 15, true)], 1, null],
  ])('%s', (_, articles, leadId, expected) => {
    const lead = leadOf(articles, leadId);
    expect(lead && {id: lead.article.id, more: lead.more}).toEqual(expected);
  });

  test('sections come in All\'s order', () => {
    expect(sectionOrder(['general', 'ai'])).toEqual(['ai', 'general']);
  });
});

describe('a story\'s main section (D102)', () => {
  const read = (id: number, subject: StoryReading['subject'], hour = 12, hazard = false): StoryReading => ({id, publishedAt: `2026-10-10T${String(hour).padStart(2, '0')}:00:00.000Z`, hazard, subject});
  test.each<[string, NewsSection[], StoryReading[], number | null, NewsSection | null]>([
    ['an AI subject in Tech and AI: AI', ['tech', 'ai'], [read(1, 'ai')], 1, 'ai'],
    ['a tech subject in Tech and General: Tech', ['general', 'tech'], [read(1, 'tech')], 1, 'tech'],
    ['a local subject in Local and General: Local', ['general', 'local'], [read(1, 'local')], 1, 'local'],
    ['a US subject: General', ['ai', 'general'], [read(1, 'us')], 1, 'general'],
    ['an AI subject outside AI: its first section', ['tech', 'general'], [read(1, 'ai')], 1, 'tech'],
    ['a subject with no section of its own: its first section', ['general', 'tech'], [read(1, 'other')], 1, 'general'],
    ['no reading (the seed\'s stand-ins): its first section', ['ai', 'general'], [read(1, null)], 1, 'ai'],
    ['the lead article\'s reading over the others\'', ['tech', 'ai'], [read(1, 'tech', 9), read(2, 'ai', 10)], 2, 'ai'],
    ['a lead not read yet: the earliest article read', ['tech', 'ai'], [read(1, 'tech', 11), read(2, null, 9), read(3, 'ai', 10)], 2, 'ai'],
    ['no lead chosen: the earliest article read', ['ai', 'tech'], [read(1, 'ai', 11), read(2, 'tech', 10)], null, 'tech'],
    ['a hazard source\'s story: Local', ['general', 'local'], [read(1, 'us', 12, true)], 1, 'local'],
    ['a hazard source among others: Local', ['general', 'local'], [read(1, 'us', 12), read(2, null, 11, true)], 1, 'local'],
    ['a hazard story outside Local: its subject\'s', ['general'], [read(1, 'us', 12, true)], 1, 'general'],
    ['no sections: none', [], [read(1, 'ai')], 1, null],
  ])('%s', (_, sections, articles, leadId, main) => {
    expect(mainSection(sections, articles, leadId)).toBe(main);
  });
});

describe('a section\'s line', () => {
  const health = (state: Health['state'], asOf: string | null = '2026-10-07T04:14:00.000Z'): Health => ({state, asOf, reason: null});
  test.each<[string, (Health | null)[], ReturnType<typeof sectionHealth>]>([
    ['all healthy: nothing', [health('healthy'), health('healthy')], null],
    ['one feed failing: nothing on the page (Settings › News shows it)', [health('healthy'), health('failing')], null],
    ['every source failing: the line', [health('failing', '2026-10-07T04:14:00.000Z'), health('failing', '2026-10-07T03:00:00.000Z')], {state: 'failing', asOf: '2026-10-07T04:14:00.000Z'}],
    ['stale and failing together: stale', [health('stale', '2026-10-07T14:02:00.000Z'), health('failing', null)], {state: 'stale', asOf: '2026-10-07T14:02:00.000Z'}],
    ['sources not checked yet say nothing', [null, null], null],
    ['an unchecked source doesn\'t hide a failing one', [null, health('failing')], {state: 'failing', asOf: '2026-10-07T04:14:00.000Z'}],
    ['no sources', [], null],
  ])('%s', (_, healths, line) => {
    expect(sectionHealth(healths)).toEqual(line);
  });
});
