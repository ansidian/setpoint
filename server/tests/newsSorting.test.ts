// News's sorting end to end (N3), on the sync engine against an ephemeral database, with the models
// faked on 127.0.0.1 (Haiku and Sonnet answering as the Messages API does). A recorded set of
// invented articles, across outlets and sections, groups and ranks as expected: wire copies count
// once, a developing story gains facts (a hazard's revisions among them) and is rewritten only then,
// a repeat changes nothing, noise never becomes a story, a metered-only story never shows, a Google
// News one shows its headline alone, a keynote confirmed by a second outlet goes to Upcoming, and the
// hourly ranking reorders. Then the cost and the cap, Unsorted while the AI is down or has no key,
// the first run, Missed's limit, search and Add to calendar.
import {missedSchema, newsPageSchema, newsSearchSchema, newsStatusSchema, newsUnsortedSchema, SEED_NOW, storySchema} from '@setpoint/shared';
import type {NewsSection} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, onTestFinished, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import type {ArticleKind, ArticleSubject} from '../src/domain/newsSorting.ts';
import type {FetchedArticle} from '../src/news/adapter.ts';
import {saveNewsImage} from '../src/news/images.ts';
import {NO_NEWS_KEY} from '../src/news/models.ts';
import {sourceValues} from '../src/news/sources.ts';
import type {NewsSourceSpec} from '../src/news/sources.ts';
import {markRanked, newsStatus, unsortedArticles} from '../src/news/sortState.ts';
import {NewsSortWorker, sortAfterFetch} from '../src/news/sortWorker.ts';
import {expireNews, markSeen, storeArticles} from '../src/news/store.ts';
import {missed, newsPage, newsSearch, newsSection, storyDetail} from '../src/queries/news.ts';
import {setSecret} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer, FakeRequest} from './fakeModels.ts';
import {liveEvents, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

// Real HTTP round trips to the fake, dozens per test: generous under a loaded machine.
vi.setConfig({testTimeout: 30_000});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = SEED_NOW;
const at = (hours: number) => new Date(Date.parse(NOW) + hours * HOUR).toISOString();
const HOME = {label: 'Home', address: '100 Example St', lat: 34.05, lng: -118.25};
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const AP = 'COLUMBUS, Ohio (AP) — Four people were killed and two were wounded when a gunman opened fire inside a warehouse on the city\'s east side early Tuesday, police said. The suspect fled before officers arrived, and a search continued through the morning.';

// ---- The sources: real outlets' names, invented events (BRIEF.md › Sample: News) ----

const SOURCES: Record<string, Partial<NewsSourceSpec> & Pick<NewsSourceSpec, 'name' | 'section'>> = {
  ktla: {name: 'KTLA', section: 'local', summaryOnly: true},
  nbcla: {name: 'NBC Los Angeles', section: 'local'},
  abc7: {name: 'ABC7', section: 'local'},
  fox11: {name: 'FOX 11', section: 'local'},
  times: {name: 'Fabrikam Times', section: 'local', metered: true},
  google: {name: 'Google News · Los Angeles', section: 'local', kind: 'discovery', adapter: 'google_news'},
  calfire: {name: 'Cal Fire incidents', section: 'local', kind: 'official_api', adapter: 'cal_fire'},
  abcnews: {name: 'ABC News', section: 'general'},
  pbs: {name: 'PBS News', section: 'general'},
  npr: {name: 'NPR', section: 'general'},
  macrumors: {name: 'MacRumors', section: 'tech'},
  verge: {name: 'The Verge', section: 'tech'},
  anthropic: {name: 'Anthropic news', section: 'ai', kind: 'page_read', adapter: 'page_read'},
  hn: {name: 'Hacker News', section: 'tech', adapter: 'hn_algolia'},
};

// ---- The recorded set: each article, with Haiku's reading and, where it has candidates, its grouping ----

interface Recorded {
  source: keyof typeof SOURCES;
  headline: string;
  published: number;
  outlet?: string;
  text?: string;
  url?: string;
  lat?: number;
  lng?: number;
  image?: boolean;
  kind?: ArticleKind;
  subject: ArticleSubject;
  sections?: NewsSection[];
  facts?: string[];
  importance?: number;
  keynote?: {company: string; date: string; time: string | null; time_zone: string | null};
  // Haiku's grouping answer: the story whose text holds `join`, and the facts it says the article adds.
  join?: string;
  newFacts?: string[];
}

const FIRE = 'https://fire.example/incidents/foothill-fire';

const FIRST: Recorded[] = [
  {source: 'ktla', headline: 'Brush fire breaks out near the 210 in the foothills', published: -5, image: true, subject: 'local', sections: ['local'],
    facts: ['A brush fire broke out near the 210 in the foothills', 'About 150 acres burned'], importance: 75},
  {source: 'nbcla', headline: 'Crews battle 150-acre brush fire near the 210', published: -4.5, subject: 'local', sections: ['local'],
    facts: ['Crews are fighting a 150-acre brush fire near the 210'], importance: 70, join: 'brush fire', newFacts: []},
  {source: 'calfire', headline: 'Foothill Fire: 150 acres, 0% contained', published: -4, url: `${FIRE}#acres-150-contained-0`, lat: 34.24, lng: -118.27,
    text: 'Foothill Fire in the foothills north of the 210: 150 acres, 0% contained.', subject: 'local', facts: ['The Foothill Fire covers 150 acres, 0% contained'],
    importance: 70, join: 'brush fire', newFacts: ['About 150 acres burned']},
  {source: 'times', headline: 'Council weighs new parking rules downtown', published: -4, subject: 'local', sections: ['local'], facts: ['The council weighed parking rules'], importance: 40},
  {source: 'google', outlet: 'LAist', headline: 'Water main break floods an intersection in Example Park', published: -3, subject: 'local', sections: ['local'],
    facts: ['A water main break flooded an intersection in Example Park'], importance: 45},
  {source: 'ktla', headline: 'Dodgers clinch the division', published: -3, kind: 'sports', subject: 'local', sections: ['local'], importance: 30},
  {source: 'nbcla', headline: 'Poll: voters split on the mayor\'s race', published: -3, kind: 'politics_argument', subject: 'local', sections: ['local'], importance: 30},
  {source: 'abc7', headline: 'Library branch extends weekend hours', published: -2, subject: 'local', sections: ['local'], facts: ['A library branch added Sunday hours'], importance: 20},
  {source: 'abcnews', headline: 'Four killed in a warehouse shooting in Ohio', published: -9, text: AP, image: true, subject: 'us', sections: ['general'],
    facts: ['Four people were killed in a warehouse shooting in Columbus, Ohio', 'The gunman fled'], importance: 85},
  {source: 'pbs', headline: '4 dead after gunman opens fire in Ohio warehouse', published: -8.5, text: AP, subject: 'us', sections: ['general'],
    facts: ['Four people were killed in a warehouse shooting in Columbus, Ohio'], importance: 85},
  {source: 'npr', headline: 'OpenAI testifies before a Senate committee on AI safety', published: -6, kind: 'politics_argument', subject: 'ai', sections: ['general'],
    facts: ['OpenAI testified before a Senate committee on AI safety'], importance: 60},
  {source: 'macrumors', headline: 'Apple sends invites for an Oct 20 event', published: -20, subject: 'tech', sections: ['tech'],
    facts: ['Apple sent invites for an event on Oct 20 at 10 AM'], importance: 60, keynote: {company: 'Apple', date: '2026-10-20', time: '10:00', time_zone: 'America/Los_Angeles'}},
  {source: 'verge', headline: 'Apple will hold its next event on October 20', published: -19, subject: 'tech', sections: ['tech'],
    facts: ['Apple will hold an event on October 20'], importance: 60, keynote: {company: 'Apple', date: '2026-10-20', time: '10:00', time_zone: 'America/Los_Angeles'},
    join: 'apple', newFacts: []},
  {source: 'verge', headline: 'Pixel Watch 5 goes on sale with two-day battery life', published: -2, image: true, subject: 'tech', sections: ['tech'],
    facts: ['Pixel Watch 5 is on sale from $349'], importance: 70},
  {source: 'verge', headline: 'The best AirPods deals this week', published: -2, kind: 'deal', subject: 'tech', sections: ['tech'], importance: 10},
  {source: 'anthropic', headline: 'Introducing Claude Haiku 5.5', published: -2, text: 'Claude Haiku 5.5 is available in the API and the Claude apps today.', subject: 'ai',
    sections: ['ai', 'general'], facts: ['Anthropic released Claude Haiku 5.5', 'It is available in the API and Claude apps today'], importance: 85},
  {source: 'hn', headline: 'Anthropic releases Claude Haiku 5.5', published: -1.5, subject: 'ai', sections: ['ai'], facts: ['Anthropic released Claude Haiku 5.5'],
    importance: 80, join: 'haiku', newFacts: []},
  {source: 'hn', headline: 'Show HN: a sourdough starter tracker', published: -1, subject: 'other', sections: ['tech'], importance: 30},
];

// Half an hour on, after the user has seen the fire and the shooting: the fire grows, the shooting gains a fact.
const SECOND: Recorded[] = [
  {source: 'calfire', headline: 'Foothill Fire: 400 acres, 10% contained', published: 0.55, url: `${FIRE}#acres-400-contained-10`, lat: 34.24, lng: -118.27,
    text: 'Foothill Fire in the foothills north of the 210: 400 acres, 10% contained.', subject: 'local', facts: ['The Foothill Fire grew to 400 acres', 'It is 10% contained'], importance: 80},
  {source: 'abc7', headline: 'Brush fire grows to 400 acres; evacuation warnings issued', published: 0.6, subject: 'local', sections: ['local'],
    facts: ['The fire grew to 400 acres', 'Evacuation warnings were issued for foothill homes'], importance: 80, join: 'brush fire',
    newFacts: ['Evacuation warnings were issued for foothill homes', 'The fire grew to 400 acres']},
  {source: 'npr', headline: 'Ohio warehouse shooting suspect in custody', published: 0.65, subject: 'us', sections: ['general'], facts: ['A suspect is in custody'],
    importance: 85, join: 'warehouse', newFacts: ['A suspect is in custody']},
];

// Then a fifth outlet repeating the first four, and a new story after the first run.
const THIRD: Recorded[] = [
  {source: 'fox11', headline: 'Brush fire near the 210 reaches 400 acres', published: 0.8, subject: 'local', sections: ['local'], facts: ['The fire reached 400 acres'],
    importance: 80, join: 'brush fire', newFacts: []},
  {source: 'nbcla', headline: 'Freeway ramp closures begin tonight', published: 0.85, subject: 'local', sections: ['local'], facts: ['Overnight ramp closures begin tonight'], importance: 50},
];

const RECORDED = new Map([...FIRST, ...SECOND, ...THIRD].map(article => [article.headline, article]));

// Sonnet's stories, by what their notes say (first match wins).
const STORIES: [RegExp, (input: string) => {headline: string; one_line: string; summary: string}][] = [
  [/brush fire|foothill fire/i, input => (/400 acres/.test(input)
    ? {headline: 'Brush fire near the 210 grows to 400 acres', one_line: 'Evacuation warnings for foothill homes', summary: 'A brush fire near the 210 grew from 150 to 400 acres. Evacuation warnings cover foothill homes.'}
    : {headline: 'Brush fire near the 210 burns 150 acres', one_line: 'Crews are fighting it in the foothills', summary: 'A brush fire near the 210 has burned about 150 acres in the foothills.'})],
  [/warehouse/i, input => (/in custody/.test(input)
    ? {headline: 'Four killed in a warehouse shooting in Ohio; suspect in custody', one_line: 'Two more were wounded', summary: 'Four people were killed in a Columbus warehouse. A suspect is in custody.'}
    : {headline: 'Four killed in a warehouse shooting in Ohio', one_line: 'The gunman fled before police arrived', summary: 'Four people were killed in a Columbus warehouse. The gunman fled.'})],
  [/senate/i, () => ({headline: 'OpenAI testifies before a Senate committee on AI safety', one_line: 'Lawmakers asked about model testing', summary: 'OpenAI testified on AI safety.'})],
  [/apple/i, () => ({headline: 'Apple sends invites for an Oct 20 event', one_line: 'Expected: new iPads and Macs', summary: 'Apple will hold an event on October 20 at 10 AM.'})],
  [/pixel/i, () => ({headline: 'Pixel Watch 5 goes on sale with two-day battery life', one_line: 'From $349; preorders ship Friday', summary: 'The Pixel Watch 5 is on sale from $349.'})],
  [/haiku/i, () => ({headline: 'Anthropic releases Claude Haiku 5.5', one_line: 'Faster and cheaper, in the API and Claude apps today', summary: 'Anthropic released Claude Haiku 5.5.'})],
  [/library/i, () => ({headline: 'A library branch extends its weekend hours', one_line: 'Open Sundays from this week', summary: 'A branch library added Sunday hours.'})],
  [/ramp/i, () => ({headline: 'Overnight freeway ramp closures begin tonight', one_line: 'Through Friday', summary: 'Ramp closures begin tonight.'})],
];

// Sonnet's hourly judgement, by what each story's line says.
const RANKED: [RegExp, number][] = [[/warehouse/i, 90], [/apple/i, 80], [/brush fire/i, 85], [/haiku/i, 70], [/pixel/i, 50], [/water main/i, 30], [/senate/i, 55], [/library/i, 20]];

const toolOf = (request: FakeRequest) => String(request.body.tools?.[0]?.name);
const headlineIn = (input: string) => /^Headline: (.*)$/m.exec(input)?.[1] ?? '';

/** The fake's answers from the recorded set: what Haiku and Sonnet said about each. */
function recordedAnswer(request: FakeRequest): FakeAnswer {
  const input = request.input;
  switch (toolOf(request)) {
    case 'submit_news_article': {
      const article = RECORDED.get(headlineIn(input));
      if (!article) return {status: 500, body: {type: 'error', error: {type: 'api_error', message: `Nothing recorded for ${headlineIn(input)}`}}};
      return {tool: {
        kind: article.kind ?? 'event', subject: article.subject, sections: article.sections ?? [], facts: article.facts ?? [], importance: article.importance ?? 50,
        place: null, keynote: article.keynote ?? null,
      }};
    }
    case 'submit_news_grouping': {
      const article = RECORDED.get(headlineIn(input))!;
      const blocks = input.split('\nStories:\n')[1]!.split(/\n(?=Story \d+ )/);
      const story = article.join ? blocks.find(block => block.toLowerCase().includes(article.join!)) : undefined;
      return {tool: {story_id: story ? Number(/^Story (\d+)/.exec(story)![1]) : null, new_facts: article.newFacts ?? []}};
    }
    case 'submit_news_story': {
      const written = STORIES.find(([pattern]) => pattern.test(input))![1](input);
      const lead = Number(/^Article (\d+)/m.exec(input)![1]);
      const image = /^Article (\d+) .*· has image$/m.exec(input);
      return {tool: {...written, lead_article_id: lead, image_article_id: image ? Number(image[1]) : null}};
    }
    case 'submit_news_ranking':
      return {tool: {stories: input.split('\n').flatMap(line => {
        const id = /^(\d+) · /.exec(line)?.[1];
        return id ? [{id: Number(id), importance: RANKED.find(([pattern]) => pattern.test(line))?.[1] ?? 50}] : [];
      })}};
    default:
      return {status: 500, body: {type: 'error', error: {type: 'api_error', message: 'Unknown tool'}}};
  }
}

// ---- The world ----

async function sortWorld({key = true, seed = false} = {}) {
  const fake = await fakeModels();
  fake.answer(recordedAnswer);
  const w = world({seed});
  if (!seed) updateSettings(w.store, {calendar: {home: HOME}});
  if (key) setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  // The ranking runs when its hour is up, which each test moves the clock to.
  markRanked(w.store);
  const worker = new NewsSortWorker({store: w.store, endpoints: fake.endpoints, timeoutMs: 2000, concurrency: 1});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [worker]});
  onTestFinished(() => engine.stop());
  const sources = new Map<string, typeof t.newsSources.$inferSelect>();
  let position = 0;
  for (const [key, spec] of Object.entries(SOURCES)) {
    position += 1;
    // Keyed apart, so none meets a built-in or stand-in key in the seed's database.
    const full: NewsSourceSpec = {key: `test:${key}`, kind: 'feed', adapter: 'feed', url: `https://${key}.example/feed`, reads: 'Feed', ...spec};
    sources.set(key, w.store.db.insert(t.newsSources).values({...sourceValues(full, 'local', position), createdAt: at(-24 * 30)}).returning().get());
  }
  const due = () => w.store.db.select({id: t.jobs.id}).from(t.jobs)
    .where(and(eq(t.jobs.kind, 'news_sort'), eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length;
  return {
    fake, w, worker,
    /** What a source's job keeps, then the sort it queues (src/news/worker.ts). */
    deliver(articles: readonly Recorded[]) {
      for (const article of articles) {
        const source = sources.get(article.source)!;
        const url = article.url ?? `https://${article.source}.example/news/${article.headline.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const fetched: FetchedArticle = {
          url, canonicalUrl: url, outlet: article.outlet ?? source.name, headline: article.headline, publishedAt: at(article.published),
          feedSummary: article.facts?.[0] ?? null, text: article.text ?? null, lat: article.lat ?? null, lng: article.lng ?? null,
        };
        const [id] = storeArticles(w.store, source, [fetched]);
        if (id && article.image) saveNewsImage(w.store, null, id, 'thumb', {bytes: PNG, mimeType: 'image/png', width: 144, height: 96});
      }
      sortAfterFetch(w.store);
    },
    /** Ticks until no sort or ranking is due. */
    async drain() {
      for (let round = 0; round < 20; round += 1) {
        await engine.tick();
        await engine.settled();
        if (!due()) return;
      }
      throw new Error('News sorting jobs kept coming');
    },
    article: (headline: string) => w.store.db.select().from(t.newsArticles).where(eq(t.newsArticles.headline, headline)).get()!,
    storyOf: (headline: string) => w.store.db.select({id: t.newsStoryArticles.storyId}).from(t.newsStoryArticles)
      .innerJoin(t.newsArticles, eq(t.newsArticles.id, t.newsStoryArticles.articleId)).where(eq(t.newsArticles.headline, headline)).get()?.id ?? null,
    story: (id: number) => w.store.db.select().from(t.newsStories).where(eq(t.newsStories.id, id)).get()!,
    calls: (tool: string) => fake.requests.filter(request => toolOf(request) === tool),
  };
}

const blocks = (w: World) => Object.fromEntries(newsPageSchema.parse(newsPage(w.store)).blocks.map(block => [block.section, block]));
const headlines = (w: World, section: NewsSection) => blocks(w)[section]!.stories.map(story => story.headline);
const listed = (w: World, section: NewsSection) => newsSection(w.store, section).stories.map(story => story.headline);

describe('a recorded set of articles groups and ranks as expected', () => {
  test('sections and noise, wire copy, a developing story, a repeat, metered and discovery stories, Upcoming, and the hourly ranking', async () => {
    const s = await sortWorld();
    const {w} = s;

    // The first run: everything in the last 48 hours.
    s.deliver(FIRST);
    await s.drain();
    expect(newsStatus(w.store)).toEqual({unsorted: 0, down: null, first_run: null});

    // Noise never becomes a story (D88).
    expect(['Dodgers clinch the division', 'Poll: voters split on the mayor\'s race', 'The best AirPods deals this week', 'Show HN: a sourdough starter tracker']
      .map(headline => [s.article(headline).noise, s.storyOf(headline)])).toEqual([['sports', null], ['politics_argument', null], ['deal', null], ['off_subject', null]]);
    // The subject wins over politics: OpenAI's testimony is AI's.
    expect(headlines(w, 'ai')).toContain('OpenAI testifies before a Senate committee on AI safety');

    // One story per event: the station, the other station and Cal Fire's first figures are one story.
    const fire = s.storyOf('Brush fire breaks out near the 210 in the foothills')!;
    expect(['Crews battle 150-acre brush fire near the 210', 'Foothill Fire: 150 acres, 0% contained'].map(s.storyOf)).toEqual([fire, fire]);
    // Identical wire copy is one outlet, joined without asking the model.
    const shooting = s.storyOf('Four killed in a warehouse shooting in Ohio')!;
    expect(s.storyOf('4 dead after gunman opens fire in Ohio warehouse')).toBe(shooting);
    expect(s.story(shooting).outlets).toBe(1);
    expect(s.calls('submit_news_grouping').map(request => headlineIn(request.input))).toEqual([
      'Apple will hold its next event on October 20', 'Crews battle 150-acre brush fire near the 210', 'Foothill Fire: 150 acres, 0% contained', 'Anthropic releases Claude Haiku 5.5',
    ]);
    // Hacker News's copy of Anthropic's release is the same story, a repeat.
    const haiku = s.storyOf('Introducing Claude Haiku 5.5')!;
    expect(s.storyOf('Anthropic releases Claude Haiku 5.5')).toBe(haiku);

    // A metered paper's story never shows and is never written; a Google News one shows its headline and link alone.
    const parking = s.storyOf('Council weighs new parking rules downtown')!;
    expect(s.story(parking)).toMatchObject({writtenAt: null, needsWriting: false, headline: 'Council weighs new parking rules downtown'});
    const water = s.storyOf('Water main break floods an intersection in Example Park')!;
    expect(storySchema.parse(storyDetail(w.store, water))).toMatchObject({
      headline: 'Water main break floods an intersection in Example Park', one_line: null, summary: null,
      lead: {outlet: 'LAist', more: 0}, sources: [{outlet: 'LAist', discovery: true}],
    });
    // A story under the bar never shows.
    const library = s.storyOf('Library branch extends weekend hours')!;
    expect(s.story(library).score).toBeLessThan(35);

    expect(headlines(w, 'local')).toEqual(['Brush fire near the 210 burns 150 acres', 'Water main break floods an intersection in Example Park']);
    // Anthropic's release is in AI and General; All shows it once, in AI's block, its subject's (D102).
    expect(headlines(w, 'general')).toEqual(['Four killed in a warehouse shooting in Ohio']);
    expect(listed(w, 'general')).toEqual(['Anthropic releases Claude Haiku 5.5', 'Four killed in a warehouse shooting in Ohio']);
    expect(headlines(w, 'tech')).toEqual(['Pixel Watch 5 goes on sale with two-day battery life', 'Apple sends invites for an Oct 20 event']);
    expect(headlines(w, 'ai')).toEqual(['Anthropic releases Claude Haiku 5.5', 'OpenAI testifies before a Senate committee on AI safety']);
    // A second outlet confirms Apple's keynote: Upcoming, at the top of Tech.
    expect(blocks(w).tech!.upcoming).toEqual([expect.objectContaining({name: 'Apple event', starts_at: '2026-10-20T17:00:00.000Z', all_day: false, section: 'tech', story_id: s.storyOf('Apple sends invites for an Oct 20 event')})]);

    // The fire story, written from every source's notes, with the station's image.
    const ktla = s.article('Brush fire breaks out near the 210 in the foothills').id;
    expect(storySchema.parse(storyDetail(w.store, fire))).toMatchObject({
      headline: 'Brush fire near the 210 burns 150 acres', one_line: 'Crews are fighting it in the foothills', state: 'new', outlets: 3,
      image: {outlet: 'KTLA'}, facts: [{at: at(-5), text: 'A brush fire broke out near the 210 in the foothills'}, {at: at(-5), text: 'About 150 acres burned'}],
    });
    expect(s.story(fire).imageArticleId).toBe(ktla);
    const writes = () => s.calls('submit_news_story').map(request => STORIES.find(([pattern]) => pattern.test(request.input))![0].source);
    // Seven stories written; the metered and Google News ones weren't.
    expect(writes()).toHaveLength(7);

    // The user sees the fire and the shooting; half an hour on, both develop.
    w.advance(30 * MINUTE);
    markSeen(w.store, [fire, shooting]);
    w.advance(15 * MINUTE);
    s.deliver(SECOND);
    await s.drain();
    // Cal Fire's next revision joined by its incident, without asking the model; its numbers are a new fact.
    expect(s.storyOf('Foothill Fire: 400 acres, 10% contained')).toBe(fire);
    expect(s.calls('submit_news_grouping').map(request => headlineIn(request.input)).slice(4)).toEqual(['Brush fire grows to 400 acres; evacuation warnings issued', 'Ohio warehouse shooting suspect in custody']);
    const pane = storySchema.parse(storyDetail(w.store, fire));
    expect(pane).toMatchObject({headline: 'Brush fire near the 210 grows to 400 acres', state: 'updated', outlets: 4, lead: {outlet: 'ABC7', more: 3}});
    // What's new since the user looked: the revision's facts, and the station's evacuation warnings (its 400 acres was said already).
    expect(pane.new_since!.facts.map(fact => fact.text)).toEqual(['The Foothill Fire grew to 400 acres', 'It is 10% contained', 'Evacuation warnings were issued for foothill homes']);
    expect(s.story(fire).lastNewFactAt).toBe(at(0.6));
    expect(storyDetail(w.store, shooting)).toMatchObject({headline: 'Four killed in a warehouse shooting in Ohio; suspect in custody', state: 'updated', outlets: 3});
    // Wire copy once: ABC and PBS's AP text, and NPR's own.
    expect(s.story(shooting).outlets).toBe(2);
    expect(writes().slice(7).sort()).toEqual(['brush fire|foothill fire', 'warehouse']);

    // A fifth outlet repeating the first four rewrites nothing and moves no fact.
    w.advance(10 * MINUTE);
    const before = s.story(fire);
    s.deliver(THIRD);
    await s.drain();
    expect(s.storyOf('Brush fire near the 210 reaches 400 acres')).toBe(fire);
    expect(s.story(fire)).toMatchObject({lastNewFactAt: before.lastNewFactAt, writtenAt: before.writtenAt, headline: before.headline, outlets: 5});
    expect(storyDetail(w.store, fire).lead.more).toBe(4);
    expect(writes().slice(9)).toEqual(['ramp']);

    // The hour is up: Sonnet judges each story against the day's on the cached prompt, and the order follows.
    w.advance(20 * MINUTE);
    await s.drain();
    const ranking = s.calls('submit_news_ranking');
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.model).toBe('claude-sonnet-5-5');
    expect(ranking[0]!.body.system[0].cache_control).toEqual({type: 'ephemeral', ttl: '1h'});
    expect(headlines(w, 'tech')).toEqual(['Apple sends invites for an Oct 20 event', 'Pixel Watch 5 goes on sale with two-day battery life']);
    expect(listed(w, 'general')).toEqual(['Four killed in a warehouse shooting in Ohio; suspect in custody', 'Anthropic releases Claude Haiku 5.5']);
    // Judged minor, the water main falls under the bar and leaves the page.
    expect(headlines(w, 'local')).toEqual(['Brush fire near the 210 grows to 400 acres', 'Overnight freeway ramp closures begin tonight']);

    // Every call is in the ledger under News's own rows.
    const ledger = (purpose: string) => w.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, purpose as 'news_articles')).all();
    expect([ledger('news_articles').length, ledger('news_grouping').length, ledger('news_stories').length, ledger('news_ranking').length]).toEqual([23, 7, 10, 1]);
    expect(ledger('news_articles').every(row => row.model === 'claude-haiku-5-5' && row.costMicros > 0)).toBe(true);
    expect(ledger('news_stories').every(row => row.model === 'claude-sonnet-5-5')).toBe(true);
    expect(s.calls('submit_news_article').every(request => request.model === 'claude-haiku-5-5' && request.body.tool_choice.type === 'tool')).toBe(true);
    // The model is told the home area to a tenth of a degree, never where home is.
    expect(s.calls('submit_news_article')[0]!.input).toMatch(/^Home area: near -?\d+\.\d, -?\d+\.\d$/m);
    // Stories changed in place ride on `news` events.
    expect(liveEvents(w).some(event => event.type === 'news' && event.stories.includes(fire) && event.sections.includes('local'))).toBe(true);
  });

  test('the first run never goes to Missed; a later story left unseen does, and search keeps the archive', async () => {
    const s = await sortWorld();
    const {w} = s;
    s.deliver(FIRST);
    await s.drain();
    w.advance(30 * MINUTE);
    s.deliver(THIRD.slice(1));
    await s.drain();
    const ramp = s.storyOf('Freeway ramp closures begin tonight')!;
    expect(s.story(ramp).backfill).toBe(false);
    expect(s.story(s.storyOf('Pixel Watch 5 goes on sale with two-day battery life')!).backfill).toBe(true);

    expect(newsSearchSchema.parse(newsSearch(w.store, {q: 'warehouse ohio', limit: 50})).stories.map(story => story.headline)).toEqual(['Four killed in a warehouse shooting in Ohio']);
    // By a source's outlet; never by a metered paper's; never a story under the bar.
    expect(newsSearch(w.store, {q: 'pbs', limit: 50}).stories.map(story => story.headline)).toEqual(['Four killed in a warehouse shooting in Ohio']);
    expect(newsSearch(w.store, {q: 'fabrikam', limit: 50}).total).toBe(0);
    expect(newsSearch(w.store, {q: 'parking', limit: 50}).total).toBe(0);
    expect(newsSearch(w.store, {q: 'library', limit: 50}).total).toBe(0);

    w.advance(49 * HOUR);
    expireNews(w.store, null);
    expect(newsPage(w.store).blocks.every(block => !block.stories.length)).toBe(true);
    const out = missedSchema.parse(missed(w.store));
    expect(out.days.flatMap(day => day.stories.map(story => story.id))).toEqual([ramp]);
    // Expired stories are still found.
    expect(newsSearch(w.store, {q: 'warehouse', limit: 50}).stories.map(story => story.expired_at !== null)).toEqual([true]);
  });
});

describe('cost and the cap (D90)', () => {
  test('past the monthly cap, story summaries use Haiku; Settings › AI says so, with this month\'s usage by part', async () => {
    const s = await sortWorld();
    const {w} = s;
    // Last month's spend doesn't count.
    w.store.db.insert(t.aiUsage).values({at: '2026-09-30T12:00:00.000Z', provider: 'anthropic', model: 'claude-sonnet-5-5', purpose: 'news_stories', inputTokens: 1, outputTokens: 1, costMicros: 90_000_000}).run();
    s.deliver([FIRST.find(article => article.source === 'verge' && article.headline.startsWith('Pixel'))!]);
    await s.drain();
    expect(s.calls('submit_news_story').map(request => request.model)).toEqual(['claude-sonnet-5-5']);

    const api = await signedIn(w);
    let ai = (await api.send('GET', '/api/ai')).body;
    expect(ai.news).toMatchObject({articles_model: 'claude-haiku-5-5', stories_model: 'claude-sonnet-5-5', summaries_model: 'claude-sonnet-5-5', capped: false, monthly_cap_usd: 40, missing: null});
    expect(ai.usage_this_month.news.articles.calls).toBe(1);
    expect(ai.usage_this_month.news.stories.calls).toBe(1);
    expect(ai.usage_this_month.since).toBe('2026-10-01T07:00:00.000Z');

    // This month's News spend reaches the cap.
    w.store.db.insert(t.aiUsage).values({at: at(-1), provider: 'anthropic', model: 'claude-sonnet-5-5', purpose: 'news_stories', inputTokens: 1, outputTokens: 1, costMicros: 40_000_000}).run();
    s.deliver([FIRST.find(article => article.source === 'anthropic')!]);
    await s.drain();
    expect(s.calls('submit_news_story').map(request => request.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    ai = (await api.send('GET', '/api/ai')).body;
    expect(ai.news).toMatchObject({summaries_model: 'claude-haiku-5-5', capped: true});
    expect(ai.news.this_month_usd).toBeGreaterThan(40);
    expect(ai.usage_this_month.news.calls).toBe(ai.usage_this_month.news.articles.calls + ai.usage_this_month.news.grouping.calls + ai.usage_this_month.news.stories.calls + ai.usage_this_month.news.ranking.calls);

    // A higher cap in Settings brings Sonnet back.
    expect((await api.send('PATCH', '/api/settings', {body: {news: {monthly_cap_usd: 60}}})).status).toBe(200);
    expect((await api.send('GET', '/api/ai')).body.news).toMatchObject({summaries_model: 'claude-sonnet-5-5', capped: false, monthly_cap_usd: 60});
  });
});

describe('Unsorted while the AI is down (BRIEF.md › When things break)', () => {
  test('articles wait with the provider\'s words and when it began, and are sorted once it\'s back; nothing vanishes', async () => {
    const s = await sortWorld();
    const {w, fake} = s;
    const three = FIRST.filter(article => ['Dodgers clinch the division', 'Library branch extends weekend hours', 'Pixel Watch 5 goes on sale with two-day battery life'].includes(article.headline));
    let reads = 0;
    // The first article is read (noise), then Anthropic is overloaded.
    fake.answer(request => (toolOf(request) === 'submit_news_article' && (reads += 1) > 1 ? 'overloaded' : recordedAnswer(request)));
    s.deliver(three);
    await s.drain();
    const status = newsStatusSchema.parse(newsStatus(w.store));
    expect(status).toEqual({
      unsorted: 2, first_run: {sorted: 1, total: 3},
      down: {provider: 'anthropic', cause: 'unreachable', since: NOW, reason: 'Anthropic: Overloaded (529)', retrying: true},
    });
    // Show headlines: the raw headlines with their links, newest first.
    expect(newsUnsortedSchema.parse(unsortedArticles(w.store)).articles.map(article => [article.headline, article.outlet, article.section])).toEqual([
      ['Pixel Watch 5 goes on sale with two-day battery life', 'The Verge', 'tech'], ['Library branch extends weekend hours', 'ABC7', 'local'],
    ]);
    const job = () => w.store.db.select().from(t.jobs).where(eq(t.jobs.key, 'news_sort')).all().at(-1)!;
    expect(job()).toMatchObject({state: 'queued', lastError: 'Anthropic: Overloaded (529)'});

    // Still down at the retry: the spell began when it began.
    w.advance(MINUTE);
    await s.drain();
    expect(newsStatus(w.store).down?.since).toBe(NOW);

    fake.answer(recordedAnswer);
    w.advance(2 * MINUTE);
    await s.drain();
    expect(newsStatus(w.store)).toEqual({unsorted: 0, down: null, first_run: null});
    expect(headlines(w, 'tech')).toEqual(['Pixel Watch 5 goes on sale with two-day battery life']);
    // Sorting's state changed: a `news` event naming nothing, so the page asks again.
    expect(liveEvents(w).filter(event => event.type === 'news' && !event.stories.length && !event.sources.length).length).toBeGreaterThanOrEqual(2);
  });

  test('with no Anthropic key, articles wait as Unsorted; a key sorts them', async () => {
    const s = await sortWorld({key: false});
    const {w, fake} = s;
    s.deliver(FIRST.filter(article => article.source === 'verge'));
    await s.drain();
    expect(newsStatus(w.store)).toMatchObject({unsorted: 3, down: {cause: 'no_key', reason: NO_NEWS_KEY, retrying: false}});
    expect(fake.requests).toHaveLength(0);
    const api = await signedIn(w, {newsSort: s.worker});
    expect((await api.send('GET', '/api/news/status')).body).toMatchObject({unsorted: 3, down: {cause: 'no_key'}});
    expect((await api.send('GET', '/api/ai')).body.news.missing).toBe(NO_NEWS_KEY);

    expect((await api.send('PUT', '/api/secrets/anthropic_api_key', {body: {value: FAKE_KEYS.anthropic}})).status).toBe(204);
    await s.drain();
    expect(newsStatus(w.store)).toEqual({unsorted: 0, down: null, first_run: null});
    expect(s.article('The best AirPods deals this week').noise).toBe('deal');
  });

  test('a refused key waits for Settings › AI: no retry, and a source\'s next articles don\'t ask again', async () => {
    const s = await sortWorld();
    const {w, fake} = s;
    fake.answer(() => ({status: 401, body: {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}}}));
    s.deliver(FIRST.slice(0, 1));
    await s.drain();
    expect(newsStatus(w.store).down).toMatchObject({cause: 'refused', retrying: false, reason: 'Anthropic: invalid x-api-key (401). Check the Anthropic key in Settings › AI.'});
    const asked = fake.requests.length;
    s.deliver(FIRST.slice(1, 2));
    await s.drain();
    expect(fake.requests).toHaveLength(asked);
    expect(newsStatus(w.store).unsorted).toBe(2);
  });
});

describe('the seed\'s stand-ins', () => {
  test('are never sorted, ranked or sent to a model', async () => {
    const s = await sortWorld({seed: true});
    const {w, fake} = s;
    const scores = () => w.store.db.select({id: t.newsStories.id, score: t.newsStories.score}).from(t.newsStories).all();
    const before = scores();
    w.advance(2 * HOUR);
    await s.drain();
    expect(fake.requests).toHaveLength(0);
    expect(scores()).toEqual(before);
    expect(newsStatus(w.store)).toEqual({unsorted: 0, down: null, first_run: null});
  });
});

describe('Missed\'s limit (D87)', () => {
  test('Catch up holds at most five per section per day, biggest first; the strip counts what it holds', async () => {
    const s = await sortWorld();
    const {w} = s;
    const source = w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'test:nbcla')).get()!;
    const ids: number[] = [];
    for (let index = 0; index < 7; index += 1) {
      const url = `https://nbcla.example/missed/${index}`;
      const article = w.store.db.insert(t.newsArticles).values({sourceId: source.id, url, canonicalUrl: url, outlet: 'NBC Los Angeles', headline: `Local story ${index}`, publishedAt: at(-50), fetchedAt: at(-50), sortedAt: at(-50)}).returning().get();
      const story = w.store.db.insert(t.newsStories).values({headline: `Local story ${index}`, score: 90 - index, firstReportedAt: at(-50), lastNewFactAt: at(-49), createdAt: at(-50)}).returning().get();
      w.store.db.insert(t.newsStorySections).values({storyId: story.id, section: 'local', position: 0}).run();
      w.store.db.insert(t.newsStoryArticles).values({storyId: story.id, articleId: article.id, linkedAt: at(-50)}).run();
      ids.push(story.id);
    }
    expireNews(w.store, null);
    const out = missedSchema.parse(missed(w.store));
    expect(out.days).toHaveLength(1);
    expect(out.days[0]!.stories.map(story => story.id)).toEqual(ids.slice(0, 5));
    expect(out.count).toBe(5);
    expect(newsPage(w.store).missed?.count).toBe(5);
    // Each leaves as it's seen.
    markSeen(w.store, [ids[0]!]);
    expect(missed(w.store).days[0]!.stories.map(story => story.id)).toEqual(ids.slice(1, 6));
  });
});

describe('the routes N4 and N5 use', () => {
  test('status, Show headlines, search, and Add to calendar on an Upcoming keynote', async () => {
    const s = await sortWorld();
    const {w} = s;
    s.deliver(FIRST.filter(article => article.source === 'macrumors' || article.headline.startsWith('Apple will')));
    const api = await signedIn(w);
    expect(newsUnsortedSchema.parse((await api.send('GET', '/api/news/unsorted')).body).count).toBe(2);
    await s.drain();
    expect(newsStatusSchema.parse((await api.send('GET', '/api/news/status')).body)).toEqual({unsorted: 0, down: null, first_run: null});

    const found = (await api.send('GET', '/api/news/search?q=apple%20invites')).body;
    expect(newsSearchSchema.parse(found).stories.map(story => story.headline)).toEqual(['Apple sends invites for an Oct 20 event']);
    expect((await api.send('GET', '/api/news/search?q=')).status).toBe(400);

    const upcoming = (await api.send('GET', '/api/news')).body.blocks.find((block: {section: string}) => block.section === 'tech').upcoming[0];
    const proposal = await api.send('POST', `/api/news/events/${upcoming.id}/proposal`);
    expect(proposal.status).toBe(200);
    expect(proposal.body).toEqual({
      kind: 'event', news_event_id: upcoming.id, story_id: upcoming.story_id, from_email: ['title', 'date', 'time'],
      item: {
        kind: 'event', calendar_id: null, title: 'Apple event', all_day: false, starts_at: '2026-10-20T17:00:00.000Z', ends_at: '2026-10-20T18:00:00.000Z',
        start_date: null, end_date: null, due_date: null, due_at: null, time_zone: 'America/Los_Angeles', place: null, project: null,
      },
      conflict: {free: true, label: 'Free that morning'},
    });
    expect((await api.send('POST', '/api/news/events/999/proposal')).status).toBe(404);
  });
});
