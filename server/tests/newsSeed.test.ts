// The dev seed holds BRIEF.md › Sample data › News (round 3): All's four blocks with their stories,
// dots, outlets, ages and images, the "N more" counts, Upcoming, the brush fire's pane, NBC Los
// Angeles's article (board 26a), KTLA's summary only (26b), and Missed's 14 on Tuesday.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {articleSchema, missedSchema, newsPageSchema, SEED_NOW, storySchema} from '@setpoint/shared';
import {describe, expect, onTestFinished, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {seedFile} from '../src/dev/seedFile.ts';
import {newsImagesDir, readNewsImage} from '../src/news/images.ts';
import {articleDetail, missed, newsPage, newsSection, storyDetail} from '../src/queries/news.ts';
import type {Store} from '../src/store.ts';
import {world} from './helpers.ts';

const LOOKED = zoned('2026-10-05', '22:40');
const ago = (minutes: number) => new Date(Date.parse(SEED_NOW) - minutes * 60_000).toISOString();

function seeded(): Store {
  return world({seed: true}).store;
}

const row = (story: {state: string; headline: string; lead: {outlet_short: string; more: number}; image: unknown}) =>
  `${{new: '●', updated: '◐', seen: ' '}[story.state]} ${story.headline} · ${story.lead.outlet_short}${story.lead.more ? ` +${story.lead.more}` : ''}${story.image ? ' · img' : ''}`;

describe('All', () => {
  test('four blocks in their fixed order, with the brief\'s stories, dots, outlets and images, and the "N more" counts', () => {
    const page = newsPageSchema.parse(newsPage(seeded()));
    expect(page.blocks.map(block => [block.section, block.stories.map(row), block.more])).toEqual([
      ['local', [
        '◐ Brush fire near the 210 grows to 400 acres · KTLA +4 · img',
        '● Red Flag Warning for the valleys until Thu 6 PM · NWS',
        '◐ Man arrested after a stabbing outside a Metro station · NBC LA +2 · img',
        '  Federal agents detain 9 at a car wash · LAist +3 · img',
        '  Council approves a 120-unit housing project on a former parking lot · Streetsblog LA',
      ], 12],
      ['tech', [
        '● Pixel Watch 5 goes on sale with two-day battery life · The Verge +5 · img',
        '● Samsung opens the One UI 9 beta to Galaxy S26 owners in the US · 9to5Google +2 · img',
        '  Apple sends invites for an Oct 20 event · MacRumors +6 · img',
      ], 7],
      ['ai', [
        '● Anthropic releases Claude Haiku 5.5 · Anthropic +8 · img',
        '◐ Fabrikam Hub resets every access token after a leak · Ars Technica +4 · img',
        '● Gemini app adds scheduled tasks on Android · Google +2',
        '  OpenAI testifies before a Senate committee on AI safety · NPR +5 · img',
      ], 4],
      ['general', [
        '● Hurricane Teresa makes landfall in the Florida Panhandle as a Category 3 · NPR +11 · img',
        '● Federal judge blocks a rule ending work permits for asylum seekers · Courthouse News +4',
        '◐ Four killed in a warehouse shooting in Ohio; suspect in custody · ABC News +7 · img',
      ], 9],
    ]);
    expect(page.blocks.every(block => block.health === null)).toBe(true);
    expect(page.missed).toEqual({count: 14, since: LOOKED});
  });

  test('the brief\'s ages, from each leading outlet\'s article', () => {
    const page = newsPage(seeded());
    const ages = new Map(page.blocks.flatMap(block => block.stories.map(story => [story.headline, story.lead.published_at])));
    const ageOf = (start: string) => [...ages].find(([headline]) => headline.startsWith(start))![1];
    expect([
      ageOf('Brush fire'), ageOf('Red Flag'), ageOf('Man arrested'), ageOf('Pixel Watch'), ageOf('Samsung opens'), ageOf('Anthropic releases'),
      ageOf('Fabrikam Hub'), ageOf('Gemini app'), ageOf('Hurricane Teresa'), ageOf('Federal judge'), ageOf('Four killed'),
    ]).toEqual([ago(70), ago(180), ago(300), ago(120), ago(360), ago(120), ago(540), ago(420), ago(180), ago(360), ago(480)]);
    // "Yesterday" and "Mon".
    for (const start of ['Federal agents', 'Apple sends', 'OpenAI testifies']) expect(ageOf(start).slice(0, 10)).toBe('2026-10-06');
    expect(ageOf('Council approves').slice(0, 10)).toBe('2026-10-05');
  });

  test('each block\'s lead has a large image and every image a thumbnail', () => {
    const page = newsPage(seeded());
    for (const block of page.blocks) expect(block.stories[0]!.image?.large).toMatchObject({width: 640, height: 360});
    const images = page.blocks.flatMap(block => block.stories.flatMap(story => (story.image ? [story.image] : [])));
    expect(images.every(image => image.thumb.width === 144 && image.thumb.height === 96)).toBe(true);
  });

  test('the sections\' full lists: 17 Local, 10 Tech, 8 AI, 12 General, one story in both AI and General', () => {
    const store = seeded();
    const lists = Object.fromEntries((['local', 'tech', 'ai', 'general'] as const).map(section => [section, newsSection(store, section).stories]));
    expect(Object.values(lists).map(list => list.length)).toEqual([17, 10, 8, 12]);
    const shared = lists.ai!.filter(story => story.sections.includes('general'));
    expect(shared.map(story => story.headline)).toEqual(['A federal rule on AI chip exports takes effect']);
    expect(lists.general!.map(story => story.id)).toContain(shared[0]!.id);
    // Biggest first, as All's blocks are.
    const scores = new Map(store.db.select({id: t.newsStories.id, score: t.newsStories.score}).from(t.newsStories).all().map(story => [story.id, story.score]));
    for (const list of Object.values(lists)) {
      const ranked = list.map(story => scores.get(story.id)!);
      expect(ranked).toEqual([...ranked].sort((a, b) => b - a));
    }
    expect(lists.local!.slice(0, 5).map(story => story.id)).toEqual(newsPage(store).blocks[0]!.stories.map(story => story.id));
  });

  test('Upcoming: the Apple event, Tue Oct 20 at 10 AM, at the top of Tech', () => {
    const tech = newsPage(seeded()).blocks[1]!;
    expect(tech.upcoming).toMatchObject([{name: 'Apple event', starts_at: zoned('2026-10-20', '10:00'), all_day: false, section: 'tech', lead: {outlet_short: 'MacRumors', more: 6}}]);
    expect(tech.upcoming[0]!.story_id).toBe(tech.stories[2]!.id);
  });
});

describe('the story pane and the reader', () => {
  test('the brush fire: its summary, what\'s new since Mon 10:40 PM, and five sources, KTLA summary only', () => {
    const store = seeded();
    const fire = storySchema.parse(storyDetail(store, newsPage(store).blocks[0]!.stories[0]!.id));
    expect(fire.summary).toBe('A brush fire near the 210 grew from 150 to 400 acres overnight. Evacuation warnings cover foothill homes north of the freeway. Crews held the west flank, and winds are forecast to pick up this afternoon under a Red Flag Warning.');
    expect(fire.new_since).toEqual({since: LOOKED, facts: [
      {at: zoned('2026-10-07', '06:55'), text: 'Two schools in the warning area are closed for the day'},
      {at: zoned('2026-10-07', '08:40'), text: 'Grew from 150 to 400 acres overnight; evacuation warnings widened'},
    ]});
    expect(fire.outlets).toBe(5);
    expect(fire.sources.map(source => [source.outlet, source.published_at, source.summary_only])).toEqual([
      ['KTLA', ago(70), true], ['NBC Los Angeles', ago(122), false], ['CBS Los Angeles', ago(187), false], ['ABC7', ago(251), false], ['FOX 11', ago(362), false],
    ]);
    expect(fire.image).toMatchObject({outlet: 'KTLA'});
  });

  test('the other updated stories\' new facts', () => {
    const store = seeded();
    const updated = newsPage(store).blocks.flatMap(block => block.stories).filter(story => story.state === 'updated');
    expect(updated.map(story => [story.headline, storyDetail(store, story.id).new_since?.facts.map(fact => fact.text)])).toEqual([
      ['Brush fire near the 210 grows to 400 acres', ['Two schools in the warning area are closed for the day', 'Grew from 150 to 400 acres overnight; evacuation warnings widened']],
      ['Man arrested after a stabbing outside a Metro station', ['Suspect arrested']],
      ['Fabrikam Hub resets every access token after a leak', ['Fabrikam says no models were altered']],
      ['Four killed in a warehouse shooting in Ohio; suspect in custody', ['Suspect in custody']],
    ]);
  });

  test('NBC Los Angeles\'s article reads in-app (26a); KTLA\'s is its feed summary (26b)', () => {
    const store = seeded();
    const fire = storyDetail(store, newsPage(store).blocks[0]!.stories[0]!.id);
    const nbc = articleSchema.parse(articleDetail(store, fire.sources[1]!.article_id));
    expect(nbc).toMatchObject({outlet: 'NBC Los Angeles', outlet_short: 'NBC LA', byline: 'Staff report', summary_only: false, image: {width: 640, height: 360}});
    expect(nbc.text!.split('\n\n')).toHaveLength(5);
    const ktla = articleSchema.parse(articleDetail(store, fire.sources[0]!.article_id));
    expect(ktla).toMatchObject({summary_only: true, text: null, headline: 'Brush fire near the 210 explodes overnight, prompting warnings'});
    expect(ktla.feed_summary).toMatch(/^A brush fire burning above the 210 Freeway/);
  });
});

describe('Missed', () => {
  test('14 stories that left the page unseen on Tuesday: Local 3, Tech 2, AI 4, General 5, biggest first, archived', () => {
    const store = seeded();
    const out = missedSchema.parse(missed(store));
    expect(out).toMatchObject({since: LOOKED, count: 14});
    expect(out.days.map(day => day.date)).toEqual(['2026-10-06']);
    const stories = out.days[0]!.stories;
    const bySection = stories.reduce<Record<string, number>>((counts, story) => ({...counts, [story.section]: (counts[story.section] ?? 0) + 1}), {});
    expect(bySection).toEqual({local: 3, tech: 2, ai: 4, general: 5});
    expect(stories.slice(0, 3).map(row)).toEqual([
      '● Tornado outbreak across Oklahoma and Kansas leaves 6 dead · NPR +9 · img',
      '● Google DeepMind releases Gemini 3.5 Flash · Google +6',
      '● Overnight closures on the 10 Freeway through Friday · KTLA +2 · img',
    ]);
    for (const story of stories) {
      // Each left 48 hours after its last fact, and keeps only its thumbnail and no timeline.
      expect(Date.parse(story.expired_at) - Date.parse(story.last_new_fact_at)).toBe(48 * 3_600_000);
      expect(story.image?.large ?? null).toBeNull();
      expect(storyDetail(store, story.id).facts).toEqual([]);
    }
  });
});

describe('npm run seed', () => {
  test('writes the images through the image store into the data directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-news-seed-'));
    onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'setpoint.sqlite');
    expect(seedFile(file).stories).toBe(60);
    const {sqlite, db} = openDatabase(file);
    onTestFinished(() => {
      sqlite.close();
    });
    const store: Store = {sqlite, db, timeZone: 'America/Los_Angeles', now: () => new Date(SEED_NOW), keyring: null};
    const images = db.select().from(t.newsImages).all();
    expect(fs.readdirSync(newsImagesDir(dir)).sort()).toEqual(images.map(image => image.file).sort());
    const first = readNewsImage(store, newsImagesDir(dir), images[0]!.id)!;
    expect(first.mimeType).toBe('image/png');
    expect(first.bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(first.bytes.length).toBe(images[0]!.sizeBytes);
    // Seeding afresh starts the images over too.
    expect(seedFile(file, {reset: true}).stories).toBe(60);
  });
});
