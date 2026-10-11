// News's rules for the store (N1; BRIEF.md › News › Stories, New and seen, Missed; DESIGN.md › News):
// when a story leaves the page and when its archive goes, its dot, what's new since the user looked,
// which image copies an expired story keeps, how many stories a block shows, the leading outlet, a
// story's main section, and when a whole section's line shows. Pure, so each is tested as a table.
import type {HealthState, NewsSection, StoryState} from '@setpoint/shared';
import {NEWS_SECTIONS} from '@setpoint/shared';
import type {Health} from './health.ts';
import type {ArticleSubject} from './newsSorting.ts';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** A story leaves the page 48 hours after its last new fact, so one that keeps developing stays up (D86). */
export const STORY_TTL_MS = 48 * HOUR;
/** The archive keeps an expired story's summary, sources and thumbnail this long (search, D91). */
export const ARCHIVE_MS = 90 * DAY;

export const expiresAt = (lastNewFactAt: string) => new Date(Date.parse(lastNewFactAt) + STORY_TTL_MS).toISOString();
export const purgeAt = (lastNewFactAt: string) => new Date(Date.parse(lastNewFactAt) + ARCHIVE_MS).toISOString();

/** Where a story is in its life: on the page, in the archive, or due to go entirely. */
export function storyStage(lastNewFactAt: string, now: string): 'page' | 'archive' | 'purge' {
  if (now >= purgeAt(lastNewFactAt)) return 'purge';
  if (now >= expiresAt(lastNewFactAt)) return 'archive';
  return 'page';
}

/**
 * The dot (D87), per story, never per article: new until seen; updated when a fact arrived after
 * the user last saw it; otherwise seen.
 */
export function storyState(seenAt: string | null, lastNewFactAt: string): StoryState {
  if (seenAt === null) return 'new';
  return lastNewFactAt > seenAt ? 'updated' : 'seen';
}

/** "New since you looked": the facts after the user last saw the story, only when it's updated. */
export function newSince<F extends {at: string}>(facts: readonly F[], seenAt: string | null): {since: string; facts: F[]} | null {
  if (seenAt === null) return null;
  const fresh = facts.filter(fact => fact.at > seenAt);
  return fresh.length ? {since: seenAt, facts: fresh} : null;
}

export type ImageVariant = 'large' | 'thumb';

/**
 * The copies' sizes, at twice their drawn size: the large one for a block's lead, the pane and the
 * article (16:9), and the row thumbnail. Each is cropped to fill (N2).
 */
export const IMAGE_SIZES: Record<ImageVariant, {width: number; height: number}> = {
  large: {width: 640, height: 360},
  thumb: {width: 144, height: 96},
};

/**
 * The copies an expired story keeps: only the thumbnail of its own image, for the archive's rows
 * (search, Missed). Every large copy, and every other article's thumbnail, goes with the page. All of
 * them go when the archive does.
 */
export function keepsImage(stage: 'page' | 'archive' | 'purge', image: {articleId: number; variant: ImageVariant}, storyImageArticleId: number | null): boolean {
  if (stage === 'page') return true;
  if (stage === 'purge') return false;
  return image.variant === 'thumb' && image.articleId === storyImageArticleId;
}

/** A block shows at least this many stories, when it has them, … */
export const BLOCK_MIN = 3;
/** … and at most this many (DESIGN.md › The list: "top 3–5 stories, biggest first"). */
export const BLOCK_MAX = 5;
/** Past the first three, a block goes on only while a story scores at least this (scores run 0–100). */
export const BLOCK_BAR = 70;

/**
 * How many of a section's stories, biggest first, All's block shows: the top three, then up to two
 * more that clear the bar, so a big day shows more and a quiet one stays short. N3's ranking may
 * retune the bar; the rest is "N more in Local".
 */
export function blockSize(scores: readonly number[]): number {
  let size = Math.min(scores.length, BLOCK_MIN);
  while (size < Math.min(scores.length, BLOCK_MAX) && scores[size]! >= BLOCK_BAR) size += 1;
  return size;
}

export interface OutletArticle {
  id: number;
  outlet: string;
  publishedAt: string;
  metered: boolean;
}

/**
 * The articles a story lists, newest first, one per outlet (an outlet's newest): a metered paper
 * counts toward ranking but is never shown (D89).
 */
export function listedArticles<A extends OutletArticle>(articles: readonly A[]): A[] {
  const byOutlet = new Map<string, A>();
  for (const article of articles) {
    if (article.metered) continue;
    const kept = byOutlet.get(article.outlet);
    if (!kept || article.publishedAt > kept.publishedAt || (article.publishedAt === kept.publishedAt && article.id < kept.id)) byOutlet.set(article.outlet, article);
  }
  return [...byOutlet.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.id - b.id);
}

/**
 * The leading outlet and "+N": the story's chosen lead article unless it's metered, else its newest
 * listed article. Null when nothing can be shown (a metered-only story never shows).
 */
export function leadOf<A extends OutletArticle>(articles: readonly A[], leadArticleId: number | null): {article: A; more: number} | null {
  const listed = listedArticles(articles);
  if (!listed.length) return null;
  const chosen = articles.find(article => article.id === leadArticleId && !article.metered) ?? listed[0]!;
  return {article: chosen, more: listed.length - 1};
}

/** The section an article's subject names, when it names one: Local is the area's, General the US's. */
export const SUBJECT_SECTION: Partial<Record<ArticleSubject, NewsSection>> = {local: 'local', tech: 'tech', ai: 'ai', us: 'general'};

/** What a story's main section is read from, per article. */
export interface StoryReading {
  id: number;
  publishedAt: string;
  // From an official hazard source (NWS, USGS, Cal Fire, AirNow).
  hazard: boolean;
  // The model's subject for it (N3); null when it was never read, as with the seed's stand-ins.
  subject: ArticleSubject | null;
}

/**
 * A story's main section (D102), the one block All shows it in: Local for a hazard source's story,
 * else the section its subject names, read from its lead article (or, when that wasn't read, its
 * earliest article that was); either only when the story is in it. Otherwise its first section by
 * position. Derived from what's stored, so stories sorted before D102 need no re-sort.
 */
export function mainSection(sections: readonly NewsSection[], articles: readonly StoryReading[], leadArticleId: number | null): NewsSection | null {
  if (!sections.length) return null;
  if (sections.includes('local') && articles.some(article => article.hazard)) return 'local';
  const read = articles.filter(article => article.subject !== null);
  const reading = read.find(article => article.id === leadArticleId)
    ?? [...read].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id - b.id)[0];
  const own = reading?.subject ? SUBJECT_SECTION[reading.subject] : undefined;
  return own && sections.includes(own) ? own : sections[0]!;
}

/** A story's sections in NEWS_SECTIONS order. */
export const sectionOrder = (sections: readonly NewsSection[]) => NEWS_SECTIONS.filter(section => sections.includes(section));

/**
 * The page's line for a section (DESIGN.md › States): only when every source in it that has been
 * checked is stale or failing ("Local, as of 9:14 PM", as of the newest success among them). One
 * failing feed shows only in Settings › News; sources never checked yet say nothing.
 */
export function sectionHealth(healths: readonly (Health | null)[]): {state: 'stale' | 'failing'; asOf: string | null} | null {
  const checked = healths.filter((health): health is Health => health !== null);
  if (!checked.length) return null;
  const down: HealthState[] = ['stale', 'failing'];
  if (!checked.every(health => down.includes(health.state))) return null;
  const asOf = checked.map(health => health.asOf).filter((at): at is string => at !== null).sort().at(-1) ?? null;
  return {state: checked.some(health => health.state === 'stale') ? 'stale' : 'failing', asOf};
}
