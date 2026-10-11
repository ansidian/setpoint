// The interface News's source adapters implement (N2 builds them, one per NEWS_ADAPTERS key: RSS and
// Atom feeds, NWS, USGS, Cal Fire, AirNow, Hacker News through Algolia, page reads and Google News
// search, in src/providers/news/). The worker schedules each source from its own interval, runs its
// adapter as a durable `news` job, records the heartbeat, and stores what came back; adapters only
// read their source. Then the worker has each new article read (NewsArticleReader): its page's text
// and its image, copied.
import type {Home} from '@setpoint/shared';
import type * as t from '../db/schema.ts';
import type {NewsAdapterKey} from '../db/schema.ts';
import type {ImageVariant} from '../domain/news.ts';
import type {ReadingPlan} from '../domain/newsIngest.ts';
import type {Store} from '../store.ts';
import type {ImageCopy} from './images.ts';

export type NewsSourceRow = typeof t.newsSources.$inferSelect;
export type NewsArticleRow = typeof t.newsArticles.$inferSelect;

export interface NewsFetchContext {
  store: Store;
  source: NewsSourceRow;
  // Settings › Calendar's home location: the NWS zone and the hazard APIs' distances come from it
  // (D91). Null until it's set, when a hazard adapter isn't ready (it has nothing to ask about).
  home: Home | null;
  // The honest, named User-Agent every request sends (BRIEF.md › Sources).
  userAgent: string;
  // Aborted when the fetch times out or the engine stops.
  signal: AbortSignal;
}

/** An article as its source gave it, before it's sorted into a story (N3). */
export interface FetchedArticle {
  url: string;
  // The URL stripped of tracking and fragments (N2), which the store keeps an article unique by.
  canonicalUrl: string;
  outlet: string;
  outletShort?: string | null;
  byline?: string | null;
  headline: string;
  feedSummary?: string | null;
  publishedAt: string;
  // The outlet's image, for N2 to copy; never served as it is.
  imageUrl?: string | null;
  // Only found, never read (Google News).
  discovery?: boolean;
  // The text the source gave with it (an alert's description, a release note), kept as the
  // article's text instead of reading its page (N2).
  text?: string | null;
  // Where it is, when the source says (official hazard data): Local's closeness (N3).
  lat?: number | null;
  lng?: number | null;
}

export interface NewsFetchResult {
  articles: FetchedArticle[];
  // Where the next fetch resumes (an ETag, Last-Modified, the newest id); null keeps the one there is.
  cursor: string | null;
}

export interface NewsAdapter {
  /**
   * Whether the source can be read now: a hazard API needs the home location.
   * One that isn't ready isn't read, and has no health rather than failing (N2). Ready when absent.
   */
  ready?(store: Store, source: NewsSourceRow): boolean;
  /**
   * Reads the source from `cursor` (null on the first run, which fills the last 48 hours). Throws a
   * ProviderError (src/sync/errors.ts) with the source's own words when it fails; a page read that
   * suddenly finds nothing throws too, as failing rather than quiet (BRIEF.md › When things break).
   */
  fetch(context: NewsFetchContext, cursor: string | null): Promise<NewsFetchResult>;
}

export type NewsAdapters = Partial<Record<NewsAdapterKey, NewsAdapter>>;

/** What reading a new article gave: its page's text and its image's copies. */
export interface ArticleReading {
  // Paragraphs separated by a blank line; null when the page wasn't read or yielded none.
  text: string | null;
  // The image that was copied (the feed's, or the page's og:image), with its copies.
  imageUrl: string | null;
  images: {variant: ImageVariant; copy: ImageCopy}[];
}

export interface NewsReadContext {
  userAgent: string;
  signal: AbortSignal;
}

/**
 * Reads a new article (N2) as its plan says (src/domain/newsIngest.ts's readingPlan): its page for
 * the text and og:image, and the best image, copied at both sizes. A page or an image that can't be
 * read gives none, never an error: the article falls back to its feed summary (BRIEF.md › When
 * things break).
 */
export interface NewsArticleReader {
  read(context: NewsReadContext, article: Pick<NewsArticleRow, 'url' | 'imageUrl'>, plan: ReadingPlan): Promise<ArticleReading>;
}
