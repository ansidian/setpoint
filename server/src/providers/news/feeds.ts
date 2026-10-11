// News's feeds (N2): RSS and Atom with a conditional GET (the ETag and Last-Modified are the cursor;
// a 304 is a healthy check with nothing new), and Google News search, read the same way but only to
// find stories: its articles are discovery, shown with their headline and Google's link, never read.
// Adapted from v1's server/news/news-poller.ts (harvest notes on SV-45).
import {parseFeed, NotAFeed} from '../../domain/newsFeeds.ts';
import type {FeedItem} from '../../domain/newsFeeds.ts';
import {canonicalUrl, inWindow, outletOf, publishedInstant} from '../../domain/newsIngest.ts';
import type {FetchedArticle, NewsAdapter, NewsFetchContext, NewsFetchResult} from '../../news/adapter.ts';
import {ProviderError} from '../../sync/errors.ts';
import {hostOf, newsGet, responseText} from './http.ts';
import type {NewsHttpOptions} from './http.ts';

const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';

/** A conditional GET's validators, kept as the source's cursor. */
export interface Validators {
  etag: string | null;
  lastModified: string | null;
}

export function readValidators(cursor: string | null): Validators {
  try {
    const parsed = JSON.parse(cursor ?? '{}') as Record<string, unknown>;
    return {etag: typeof parsed.etag === 'string' ? parsed.etag : null, lastModified: typeof parsed.lastModified === 'string' ? parsed.lastModified : null};
  } catch {
    return {etag: null, lastModified: null};
  }
}

/** A feed's answer: its items, or none on a 304, with the validators to send next time. */
export async function readFeed(options: NewsHttpOptions, context: NewsFetchContext, url: string, cursor: string | null) {
  const validators = readValidators(cursor);
  const response = await newsGet(options, {url, userAgent: context.userAgent, signal: context.signal, accept: FEED_ACCEPT, ...validators});
  if (response.status === 304) return null;
  let items: FeedItem[];
  try {
    items = parseFeed(responseText(response), response.url).items;
  } catch (error) {
    if (error instanceof NotAFeed) throw new ProviderError('permanent', `${hostOf(url)} didn't send a feed.`, {status: response.status});
    throw error;
  }
  const next: Validators = {etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified')};
  return {items, cursor: JSON.stringify(next)};
}

/** The source's URL, which an RSS or Atom source must have. */
function sourceUrl(context: NewsFetchContext): string {
  if (!context.source.url) throw new ProviderError('permanent', 'This source has no feed address.');
  return context.source.url;
}

/** Each item once, as an article, when it was published in the last 48 hours (undated: now). */
function articlesOf(items: FeedItem[], now: string, article: (item: FeedItem, publishedAt: string) => FetchedArticle | null): FetchedArticle[] {
  const seen = new Set<string>();
  return items.flatMap(item => {
    const publishedAt = publishedInstant(item.published, now) ?? now;
    if (!inWindow(publishedAt, now)) return [];
    const made = article(item, publishedAt);
    if (!made || seen.has(made.canonicalUrl)) return [];
    seen.add(made.canonicalUrl);
    return [made];
  });
}

/** RSS and Atom feeds: outlets' feeds and the newsrooms'. */
export function feedAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    async fetch(context, cursor): Promise<NewsFetchResult> {
      const read = await readFeed(options, context, sourceUrl(context), cursor);
      if (!read) return {articles: [], cursor: null};
      const now = context.store.now().toISOString();
      const {outlet, outletShort} = outletOf(context.source.name, context.source.config);
      return {
        cursor: read.cursor,
        articles: articlesOf(read.items, now, (item, publishedAt) => ({
          url: item.url, canonicalUrl: canonicalUrl(item.url), outlet, outletShort, byline: item.byline, headline: item.headline,
          feedSummary: item.summary, publishedAt, imageUrl: item.imageUrl,
        })),
      };
    },
  };
}

export const GOOGLE_NEWS_SEARCH = 'https://news.google.com/rss/search';

/** Google News search's address for a query, in US English. */
export function googleNewsUrl(base: string, query: string): string {
  const url = new URL(base);
  url.search = new URLSearchParams({q: query, hl: 'en-US', gl: 'US', ceid: 'US:en'}).toString();
  return url.toString();
}

/** Google News titles end with " - Outlet"; the outlet is in <source>. */
export function googleHeadline(headline: string, outlet: string | null): string {
  if (outlet && headline.endsWith(` - ${outlet}`)) return headline.slice(0, -(outlet.length + 3)).trim();
  return headline;
}

/**
 * Google News search for the area (`config.query`): it finds stories but is never read (BRIEF.md ›
 * Sources). Each article is discovery, named for the outlet Google found it at, linked to Google.
 */
export function googleNewsAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    async fetch(context, cursor): Promise<NewsFetchResult> {
      const query = typeof context.source.config.query === 'string' ? context.source.config.query.trim() : '';
      if (!query) throw new ProviderError('permanent', 'This search has no query.');
      const read = await readFeed(options, context, googleNewsUrl(context.source.url ?? GOOGLE_NEWS_SEARCH, query), cursor);
      if (!read) return {articles: [], cursor: null};
      const now = context.store.now().toISOString();
      return {
        cursor: read.cursor,
        articles: articlesOf(read.items, now, (item, publishedAt) => {
          const outlet = item.source?.name ?? null;
          const headline = googleHeadline(item.headline, outlet);
          if (!headline) return null;
          return {
            url: item.url, canonicalUrl: canonicalUrl(item.url), outlet: outlet ?? 'Google News', outletShort: null, byline: null, headline,
            feedSummary: null, publishedAt, imageUrl: null, discovery: true,
          };
        }),
      };
    },
  };
}
