// News's sorting (N3; BRIEF.md › News › What it covers, Stories, Ranking, Models and cost): what
// arrives Unsorted becomes stories, in batches, so the page fills as it goes.
//
// 1. Each article (Claude Haiku 5.5): the rules map its source to a likely section, the model reads it
//    (sections, kind and subject, key facts, importance, place, a keynote), and the policy settles
//    noise (src/domain/newsSorting.ts). Noise is done with; the rest is grouped.
// 2. Grouping, one article at a time in the order published: the same hazard incident (each revision
//    a new fact) or the same wire text (a repeat) joins its story by rule; otherwise cheap candidate
//    matching finds the likely stories (enough words in common, or a headline a day apart with the
//    same count and place) and Haiku confirms whether it's the same event and what facts it brings.
//    No match starts a story.
// 3. Stories with new facts (or new ones) are written (Claude Sonnet 5.5, Haiku past the cap): the
//    neutral headline, the one line, the summary, the lead article and the best image. A fifth outlet
//    repeating the first four rewrites nothing. A story covered only by a metered paper is never
//    written (it never shows); one only Google News found shows its headline and link, unwritten.
// 4. Each touched story is scored by the ranking formula, and a confirmed keynote goes to Upcoming.
// The hourly ranking (rankStories) asks Sonnet to judge every story's importance on a cached prompt,
// then scores them all again.
//
// Every model call goes through `ask`, which the worker gives (the ledger and sorting's health). A
// provider's refusal stops the pass and is thrown as it came, for the job's retry policy; what was
// done stays done, and the rest waits Unsorted.
import type {NewsSection} from '@setpoint/shared';
import {NEWS_SECTIONS} from '@setpoint/shared';
import {and, asc, eq, gt, inArray, isNotNull, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {STORY_TTL_MS} from '../domain/news.ts';
import {
  applyGrouping, candidates, confirmKeynote, eventMark, factTime, freshFacts, incidentKey, judgeArticle, nearestKm, outletCount, revisionFacts, ruleMatch,
  significantWords, sourceRule, storyScore, wireKey,
} from '../domain/newsSorting.ts';
import type {ArticleNotes, KeynoteClaim, MatchableStory} from '../domain/newsSorting.ts';
import {localDay, zonedInstant} from '../domain/time.ts';
import type {ModelAnswer, ToolSpec} from '../providers/ai/index.ts';
import {getSettings} from '../settings.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {NewsClients, NewsModel, NewsPurpose} from './models.ts';
import {
  ARTICLE_SYSTEM, ARTICLE_TOOL, articleInput, fallbackNotes, GROUPING_SYSTEM, GROUPING_TOOL, groupingInput, groupingOf, MAX_OUTPUT_TOKENS, notesOf,
  RANKING_SYSTEM, RANKING_TOOL, rankingInput, rankingMaxTokens, rankingOf, STORY_SYSTEM, STORY_TOOL, storyInput, writtenOf,
} from './prompt.ts';
import {inFirstRun, pendingArticleIds} from './sortState.ts';

type ArticleRow = typeof t.newsArticles.$inferSelect;
type SourceRow = typeof t.newsSources.$inferSelect;
type StoryRow = typeof t.newsStories.$inferSelect;

export interface AskRequest {
  system: string;
  tool: ToolSpec;
  input: string;
  maxOutputTokens: number;
  cacheTtl?: '5m' | '1h';
}

/** One model call, its usage written to the ledger and its outcome to sorting's health. */
export type Ask = (purpose: NewsPurpose, model: NewsModel, request: AskRequest) => Promise<ModelAnswer>;

export interface SortContext {
  store: Store;
  clients: NewsClients;
  ask: Ask;
  // Articles read at once.
  concurrency: number;
  signal: AbortSignal;
}

const HOUR = 60 * 60_000;
/** Growth counts the articles published in this window. */
const GROWTH_MS = 6 * HOUR;

const sourcesById = (store: Store) => new Map(store.db.select().from(t.newsSources).all().map(source => [source.id, source]));
const hasThumb = (store: Store, articleIds: readonly number[]) => new Set(articleIds.length
  ? store.db.select({id: t.newsImages.articleId}).from(t.newsImages).where(and(inArray(t.newsImages.articleId, [...articleIds]), eq(t.newsImages.variant, 'thumb'))).all().map(row => row.id)
  : []);

// ---- 1. Each article ----

/** Reads one article with Haiku and settles whether it's noise. An article read already is left as it is. */
export async function readArticle(ctx: SortContext, articleId: number, sources: Map<number, SourceRow>) {
  const {store} = ctx;
  const article = store.db.select().from(t.newsArticles).where(eq(t.newsArticles.id, articleId)).get();
  if (!article || article.sortedAt !== null || article.notes !== null) return;
  const source = sources.get(article.sourceId)!;
  const rule = sourceRule(source);
  const home = getSettings(store).calendar.home;
  const answer = await ctx.ask('news_articles', ctx.clients.articles, {
    system: ARTICLE_SYSTEM, tool: ARTICLE_TOOL, maxOutputTokens: MAX_OUTPUT_TOKENS.article,
    input: articleInput({source: source.name, outlet: article.outlet, headline: article.headline, publishedAt: article.publishedAt, summary: article.feedSummary, text: article.extractedText}, rule.section, home),
  });
  const notes = notesOf(answer.toolInput, store.timeZone) ?? fallbackNotes(rule.section, article.headline);
  const verdict = judgeArticle(rule, notes);
  const kept: ArticleNotes = verdict.keep ? {...notes, sections: verdict.sections} : notes;
  store.db.update(t.newsArticles).set({
    notes: kept, wireKey: wireKey(article.extractedText ?? article.feedSummary),
    lat: article.lat ?? notes.place?.lat ?? null, lng: article.lng ?? notes.place?.lng ?? null,
    noise: verdict.keep ? null : verdict.reason, sortedAt: verdict.keep ? null : isoNow(store),
  }).where(eq(t.newsArticles.id, articleId)).run();
}

// ---- 2. Grouping ----

interface LiveStory {
  story: StoryRow;
  sections: NewsSection[];
  facts: {at: string; text: string}[];
  articles: ArticleRow[];
}

/** The stories on the page that real articles made (the seed's stand-ins are never grouped into). */
function liveStories(store: Store, sources: Map<number, SourceRow>): LiveStory[] {
  const cutoff = new Date(store.now().getTime() - STORY_TTL_MS).toISOString();
  const stories = store.db.select().from(t.newsStories).where(and(isNull(t.newsStories.expiredAt), gt(t.newsStories.lastNewFactAt, cutoff))).all();
  if (!stories.length) return [];
  const ids = stories.map(story => story.id);
  const articles = new Map<number, ArticleRow[]>();
  for (const row of store.db.select({storyId: t.newsStoryArticles.storyId, article: t.newsArticles}).from(t.newsStoryArticles)
    .innerJoin(t.newsArticles, eq(t.newsArticles.id, t.newsStoryArticles.articleId)).where(inArray(t.newsStoryArticles.storyId, ids)).all()) {
    articles.set(row.storyId, [...(articles.get(row.storyId) ?? []), row.article]);
  }
  const sections = new Map<number, NewsSection[]>();
  for (const row of store.db.select().from(t.newsStorySections).where(inArray(t.newsStorySections.storyId, ids)).orderBy(asc(t.newsStorySections.position)).all()) {
    sections.set(row.storyId, [...(sections.get(row.storyId) ?? []), row.section]);
  }
  const facts = new Map<number, {at: string; text: string}[]>();
  for (const row of store.db.select().from(t.newsFacts).where(inArray(t.newsFacts.storyId, ids)).orderBy(asc(t.newsFacts.at), asc(t.newsFacts.id)).all()) {
    facts.set(row.storyId, [...(facts.get(row.storyId) ?? []), {at: row.at, text: row.text}]);
  }
  return stories.flatMap(story => {
    const own = articles.get(story.id) ?? [];
    if (!own.some(article => sources.get(article.sourceId)?.dev === false)) return [];
    return [{story, sections: sections.get(story.id) ?? [], facts: facts.get(story.id) ?? [], articles: own}];
  });
}

function matchable(live: LiveStory, sources: Map<number, SourceRow>): MatchableStory {
  return {
    id: live.story.id,
    words: significantWords(live.story.headline, ...live.facts.map(fact => fact.text), ...live.articles.map(article => article.headline)),
    incidents: new Set(live.articles.flatMap(article => incidentKey(article.canonicalUrl, sourceRule(sources.get(article.sourceId)!).hazard) ?? [])),
    wireKeys: new Set(live.articles.flatMap(article => article.wireKey ?? [])),
    events: [eventMark(live.story.headline, live.story.lastNewFactAt), ...live.articles.map(article => eventMark(article.headline, article.publishedAt))],
  };
}

/** Joins an article to a story: its sections, any new facts (which move the story's last new fact), its outlets and importance. */
function joinStory(store: Store, live: LiveStory, article: ArticleRow, notes: ArticleNotes, facts: string[]) {
  const now = isoNow(store);
  transaction(store, () => {
    const storyId = live.story.id;
    store.db.insert(t.newsStoryArticles).values({storyId, articleId: article.id, linkedAt: now}).run();
    const added = notes.sections.filter(section => !live.sections.includes(section));
    added.forEach((section, index) => store.db.insert(t.newsStorySections).values({storyId, section, position: live.sections.length + index}).run());
    const values: Partial<StoryRow> = {
      outlets: outletCount([...live.articles, article]),
      importance: Math.max(live.story.importance, notes.importance),
      firstReportedAt: article.publishedAt < live.story.firstReportedAt ? article.publishedAt : live.story.firstReportedAt,
    };
    if (facts.length) {
      const at = factTime(article.publishedAt, article.fetchedAt, live.story.seenAt);
      for (const text of facts) store.db.insert(t.newsFacts).values({storyId, at, text, articleId: article.id}).run();
      if (at > live.story.lastNewFactAt) values.lastNewFactAt = at;
      values.needsWriting = true;
    }
    // A story nothing could show until now (a metered paper's alone) is written once something can.
    if (!article.metered && live.articles.every(other => other.metered)) values.needsWriting = true;
    if (live.story.imageArticleId === null && !article.metered && hasThumb(store, [article.id]).size) values.imageArticleId = article.id;
    store.db.update(t.newsStories).set(values).where(eq(t.newsStories.id, storyId)).run();
    store.db.update(t.newsArticles).set({sortedAt: now}).where(eq(t.newsArticles.id, article.id)).run();
  });
}

/** Starts a story from an article: its headline until the story is written, its facts, its sections. */
function startStory(store: Store, article: ArticleRow, notes: ArticleNotes): number {
  const now = isoNow(store);
  return transaction(store, () => {
    const at = factTime(article.publishedAt, article.fetchedAt, null);
    const storyId = store.db.insert(t.newsStories).values({
      headline: article.headline, oneLine: null, summary: null, score: 0,
      leadArticleId: article.metered ? null : article.id, imageArticleId: !article.metered && hasThumb(store, [article.id]).size ? article.id : null,
      firstReportedAt: article.publishedAt, lastNewFactAt: at, createdAt: now,
      importance: notes.importance, outlets: 1, needsWriting: true, backfill: inFirstRun(store),
    }).returning({id: t.newsStories.id}).get().id;
    notes.sections.forEach((section, position) => store.db.insert(t.newsStorySections).values({storyId, section, position}).run());
    store.db.insert(t.newsStoryArticles).values({storyId, articleId: article.id, linkedAt: now}).run();
    for (const text of freshFacts(notes.facts, [])) store.db.insert(t.newsFacts).values({storyId, at, text, articleId: article.id}).run();
    store.db.update(t.newsArticles).set({sortedAt: now}).where(eq(t.newsArticles.id, article.id)).run();
    return storyId;
  });
}

/** Groups one read article into a story (or starts one). Returns the story. */
export async function groupArticle(ctx: SortContext, articleId: number, sources: Map<number, SourceRow>): Promise<number | null> {
  const {store} = ctx;
  const article = store.db.select().from(t.newsArticles).where(eq(t.newsArticles.id, articleId)).get();
  if (!article || article.sortedAt !== null || article.notes === null || article.noise !== null) return null;
  const notes = article.notes;
  const hazard = sourceRule(sources.get(article.sourceId)!).hazard;
  const live = liveStories(store, sources);
  const stories = live.map(story => matchable(story, sources));
  const wanted = {
    words: significantWords(article.headline, ...notes.facts), incident: incidentKey(article.canonicalUrl, hazard), wireKey: article.wireKey,
    event: eventMark(article.headline, article.publishedAt),
  };

  const ruled = ruleMatch(wanted, stories);
  if (ruled) {
    const story = live.find(candidate => candidate.story.id === ruled.storyId)!;
    const existing = story.facts.map(fact => fact.text);
    joinStory(store, story, article, notes, ruled.by === 'incident' ? revisionFacts(notes.facts, article.headline, existing) : []);
    return story.story.id;
  }
  const likely = candidates(wanted, stories);
  if (likely.length) {
    const shown = likely.map(({id}) => live.find(candidate => candidate.story.id === id)!);
    const answer = await ctx.ask('news_grouping', ctx.clients.articles, {
      system: GROUPING_SYSTEM, tool: GROUPING_TOOL, maxOutputTokens: MAX_OUTPUT_TOKENS.grouping,
      input: groupingInput({outlet: article.outlet, headline: article.headline, publishedAt: article.publishedAt, facts: notes.facts}, shown.map(story => ({
        id: story.story.id, headline: story.story.headline, sections: story.sections, facts: story.facts,
        sources: story.articles.filter(other => !other.metered).map(other => `${other.outlet}: ${other.headline}`),
      }))),
    });
    const said = groupingOf(answer.toolInput);
    const named = shown.find(story => story.story.id === said.storyId);
    const applied = applyGrouping(said, likely.map(({id}) => id), named?.facts.map(fact => fact.text) ?? []);
    if (applied.storyId !== null) {
      joinStory(store, named!, article, notes, applied.newFacts);
      return applied.storyId;
    }
  }
  return startStory(store, article, notes);
}

// ---- 3. Stories ----

/** Writes a story's headline, one line and summary from its articles' notes, with its lead and image. */
export async function writeStory(ctx: SortContext, storyId: number) {
  const {store} = ctx;
  const story = store.db.select().from(t.newsStories).where(eq(t.newsStories.id, storyId)).get();
  if (!story || !story.needsWriting) return;
  const done = (values: Partial<StoryRow>) => store.db.update(t.newsStories).set({...values, needsWriting: false}).where(eq(t.newsStories.id, storyId)).run();
  const articles = store.db.select({article: t.newsArticles}).from(t.newsStoryArticles).innerJoin(t.newsArticles, eq(t.newsArticles.id, t.newsStoryArticles.articleId))
    .where(eq(t.newsStoryArticles.storyId, storyId)).all().map(row => row.article);
  // A metered paper is never shown or read (D89): a story it alone covers never shows, so isn't written.
  const listed = articles.filter(article => !article.metered).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id - b.id);
  if (!listed.length) return done({});
  // Only Google News found it: its headline and link, with no text (BRIEF.md › Sources).
  if (listed.every(article => article.discovery)) return done({headline: listed[0]!.headline, oneLine: null, summary: null, leadArticleId: listed[0]!.id, writtenAt: isoNow(store)});
  const sections = store.db.select().from(t.newsStorySections).where(eq(t.newsStorySections.storyId, storyId)).orderBy(asc(t.newsStorySections.position)).all().map(row => row.section);
  const facts = store.db.select({at: t.newsFacts.at, text: t.newsFacts.text}).from(t.newsFacts).where(eq(t.newsFacts.storyId, storyId)).orderBy(asc(t.newsFacts.at), asc(t.newsFacts.id)).all();
  const thumbs = hasThumb(store, listed.map(article => article.id));
  const answer = await ctx.ask('news_stories', ctx.clients.stories, {
    system: STORY_SYSTEM, tool: STORY_TOOL, maxOutputTokens: MAX_OUTPUT_TOKENS.story,
    input: storyInput({headline: story.writtenAt ? story.headline : null, sections, facts}, listed.map(article => ({
      id: article.id, outlet: article.outlet, publishedAt: article.publishedAt, headline: article.headline,
      facts: article.notes?.facts ?? [], hasImage: thumbs.has(article.id),
    }))),
  });
  const written = writtenOf(answer.toolInput);
  // An answer without a headline leaves the story as it was, until its next new fact.
  if (!written) return done({});
  const lead = listed.find(article => article.id === written.leadArticleId)?.id ?? story.leadArticleId ?? listed[0]!.id;
  const image = [written.imageArticleId, story.imageArticleId, lead, ...listed.map(article => article.id)].find(id => id !== null && thumbs.has(id)) ?? null;
  return done({headline: written.headline, oneLine: written.oneLine, summary: written.summary, leadArticleId: lead, imageArticleId: image, writtenAt: isoNow(store)});
}

// ---- 4. Scores and Upcoming ----

/** A story's score by the ranking formula, now. */
export function scoreStory(store: Store, storyId: number): {score: number; changed: boolean} | null {
  const story = store.db.select().from(t.newsStories).where(eq(t.newsStories.id, storyId)).get();
  if (!story) return null;
  const now = isoNow(store);
  const articles = store.db.select({publishedAt: t.newsArticles.publishedAt, lat: t.newsArticles.lat, lng: t.newsArticles.lng}).from(t.newsStoryArticles)
    .innerJoin(t.newsArticles, eq(t.newsArticles.id, t.newsStoryArticles.articleId)).where(eq(t.newsStoryArticles.storyId, storyId)).all();
  const local = store.db.select({section: t.newsStorySections.section}).from(t.newsStorySections)
    .where(and(eq(t.newsStorySections.storyId, storyId), eq(t.newsStorySections.section, 'local'))).get() !== undefined;
  const since = new Date(store.now().getTime() - GROWTH_MS).toISOString();
  const score = storyScore({
    importance: story.importance, outlets: story.outlets, local, lastNewFactAt: story.lastNewFactAt, now,
    distanceKm: nearestKm(getSettings(store).calendar.home, articles.flatMap(article => (article.lat !== null && article.lng !== null ? [{lat: article.lat, lng: article.lng}] : []))),
    recentArticles: articles.filter(article => article.publishedAt >= since).length,
  });
  if (score !== story.score) store.db.update(t.newsStories).set({score}).where(eq(t.newsStories.id, storyId)).run();
  return {score, changed: score !== story.score};
}

/**
 * Upcoming: a keynote the story's articles report, once confirmed by a second outlet or the company
 * itself, while it's still to come. One event per story; a keynote another story already holds for
 * that day isn't added twice.
 */
export function noteKeynote(store: Store, storyId: number, sources: Map<number, SourceRow>) {
  const articles = store.db.select({article: t.newsArticles}).from(t.newsStoryArticles).innerJoin(t.newsArticles, eq(t.newsArticles.id, t.newsStoryArticles.articleId))
    .where(eq(t.newsStoryArticles.storyId, storyId)).all().map(row => row.article);
  const claims: KeynoteClaim[] = articles.flatMap(article => (article.notes?.keynote
    ? [{...article.notes.keynote, outlet: article.outlet, wireKey: article.wireKey, firstParty: sourceRule(sources.get(article.sourceId)!).firstParty}]
    : []));
  const keynote = confirmKeynote(claims, store.timeZone);
  if (!keynote) return;
  const now = isoNow(store);
  const today = zonedInstant(localDay(now, store.timeZone), '00:00', store.timeZone);
  if (keynote.allDay ? keynote.startsAt < today : keynote.startsAt <= now) return;
  const sections = store.db.select({section: t.newsStorySections.section}).from(t.newsStorySections).where(eq(t.newsStorySections.storyId, storyId)).all().map(row => row.section);
  const section: NewsSection = sections.includes('tech') || !sections.includes('ai') ? 'tech' : 'ai';
  const values = {name: keynote.name, startsAt: keynote.startsAt, allDay: keynote.allDay, section};
  const own = store.db.select().from(t.newsEvents).where(eq(t.newsEvents.storyId, storyId)).get();
  if (own) {
    store.db.update(t.newsEvents).set(values).where(eq(t.newsEvents.id, own.id)).run();
    return;
  }
  const day = localDay(keynote.startsAt, store.timeZone);
  const twin = store.db.select().from(t.newsEvents).where(eq(t.newsEvents.name, keynote.name)).all().some(event => localDay(event.startsAt, store.timeZone) === day);
  if (!twin) store.db.insert(t.newsEvents).values({storyId, ...values, createdAt: now}).run();
}

/** The stories' sections, for the `news` event. */
function sectionsOf(store: Store, storyIds: readonly number[]): NewsSection[] {
  if (!storyIds.length) return [];
  const rows = store.db.selectDistinct({section: t.newsStorySections.section}).from(t.newsStorySections).where(inArray(t.newsStorySections.storyId, [...storyIds])).all();
  return NEWS_SECTIONS.filter(section => rows.some(row => row.section === section));
}

const announce = (store: Store, storyIds: readonly number[]) => {
  if (storyIds.length) noteLive(store, {type: 'news', stories: [...storyIds], sections: sectionsOf(store, storyIds), sources: []});
};

/** Runs `work` over the items, a few at a time; the first failure is thrown once the others have stopped. */
async function eachAtOnce<T>(items: readonly T[], width: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  let failure: unknown = null;
  const next = async (): Promise<void> => {
    const item = queue.shift();
    if (item === undefined || failure !== null) return;
    try {
      await work(item);
    } catch (error) {
      failure ??= error;
      return;
    }
    return next();
  };
  await Promise.all(Array.from({length: Math.max(1, width)}, next));
  if (failure !== null) throw failure;
}

/** Articles sorted per batch: the page fills as each batch's stories are written. */
export const SORT_BATCH = 20;

/**
 * One pass over what waits Unsorted, a batch at a time: read, group, write, score, Upcoming, and a
 * `news` event naming the stories that changed. Returns how many articles it sorted.
 */
export async function sortPending(ctx: SortContext, batch = SORT_BATCH): Promise<number> {
  const {store} = ctx;
  let sorted = 0;
  const tried = new Set<number>();
  for (;;) {
    const ids = pendingArticleIds(store, batch).filter(id => !tried.has(id));
    if (!ids.length || ctx.signal.aborted) break;
    for (const id of ids) tried.add(id);
    const sources = sourcesById(store);
    await eachAtOnce(ids, ctx.concurrency, id => readArticle(ctx, id, sources));
    const touched = new Set<number>();
    for (const id of ids) {
      if (ctx.signal.aborted) return sorted;
      const storyId = await groupArticle(ctx, id, sources);
      if (storyId !== null) touched.add(storyId);
    }
    for (const {id} of store.db.select({id: t.newsStories.id}).from(t.newsStories).where(eq(t.newsStories.needsWriting, true)).all()) {
      await writeStory(ctx, id);
      touched.add(id);
    }
    for (const id of touched) {
      scoreStory(store, id);
      noteKeynote(store, id, sources);
    }
    sorted += store.db.select({id: t.newsArticles.id}).from(t.newsArticles).where(and(inArray(t.newsArticles.id, ids), isNotNull(t.newsArticles.sortedAt))).all().length;
    announce(store, [...touched]);
  }
  return sorted;
}

// ---- The hourly ranking ----

/**
 * Asks Sonnet, on the hour-long cached prompt, how much each story on the page matters against the
 * day's others; then scores every one by the formula (recency moves with the clock). Without a model
 * (`ctx` null), only the formula runs.
 */
export async function rankStories(store: Store, ctx: Pick<SortContext, 'clients' | 'ask'> | null): Promise<number[]> {
  const sources = sourcesById(store);
  const live = liveStories(store, sources);
  if (ctx && live.length) {
    const answer = await ctx.ask('news_ranking', ctx.clients.ranking, {
      system: RANKING_SYSTEM, tool: RANKING_TOOL, cacheTtl: '1h', maxOutputTokens: rankingMaxTokens(live.length),
      input: rankingInput(isoNow(store), live.map(({story, sections}) => ({
        id: story.id, sections, headline: story.headline, oneLine: story.oneLine, outlets: story.outlets,
        firstReportedAt: story.firstReportedAt, lastNewFactAt: story.lastNewFactAt,
      }))),
    });
    const judged = rankingOf(answer.toolInput);
    const now = isoNow(store);
    transaction(store, () => {
      for (const {story} of live) {
        const importance = judged.get(story.id);
        if (importance !== undefined) store.db.update(t.newsStories).set({importance, rankedAt: now}).where(eq(t.newsStories.id, story.id)).run();
      }
    });
  }
  const changed = live.flatMap(({story}) => (scoreStory(store, story.id)?.changed ? [story.id] : []));
  announce(store, changed);
  return changed;
}
