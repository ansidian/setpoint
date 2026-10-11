// Page reads (N2; BRIEF.md › Sources): where a lab has no feed, its page is read directly. A news
// page (Anthropic's, Mistral's) lists links to its posts, each then read like a feed's article; the
// Claude release notes (`config.layout: "dated_sections"`) are dated sections of one page, each its
// own article with its own text. The cursor keeps the conditional GET's validators and the posts
// already seen, so a post is news once, and an undated post first seen on the first read isn't
// passed off as new. A read that finds no posts at all fails (BRIEF.md › When things break): the
// page's layout has probably changed, and quiet would hide it.
import {canonicalUrl, outletOf, postedAt} from '../../domain/newsIngest.ts';
import {datedSections, listedPosts} from '../../domain/newsPages.ts';
import type {FetchedArticle, NewsAdapter, NewsFetchResult} from '../../news/adapter.ts';
import {ProviderError} from '../../sync/errors.ts';
import {readValidators} from './feeds.ts';
import {newsGet, responseText} from './http.ts';
import type {NewsHttpOptions} from './http.ts';

/** How many seen posts the cursor remembers: well past what a news page lists at once. */
const SEEN_KEPT = 300;

interface PageCursor {
  etag: string | null;
  lastModified: string | null;
  // The canonical URLs of the posts already read; null before the first read.
  seen: string[] | null;
}

function readCursor(cursor: string | null): PageCursor {
  let seen: string[] | null = null;
  try {
    const parsed = JSON.parse(cursor ?? '{}') as Record<string, unknown>;
    if (Array.isArray(parsed.seen)) seen = parsed.seen.filter((url): url is string => typeof url === 'string');
  } catch {
    // An unreadable cursor reads the page as the first time.
  }
  return {...readValidators(cursor), seen};
}

export function pageReadAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    async fetch(context, cursor): Promise<NewsFetchResult> {
      const {source, store} = context;
      if (!source.url) throw new ProviderError('permanent', 'This source has no page address.');
      const previous = readCursor(cursor);
      const response = await newsGet(options, {
        url: source.url, userAgent: context.userAgent, signal: context.signal, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        etag: previous.etag, lastModified: previous.lastModified,
      });
      if (response.status === 304) return {articles: [], cursor: null};
      const html = responseText(response);
      const sections = source.config.layout === 'dated_sections';
      const posts = sections ? datedSections(html, response.url) : listedPosts(html, response.url);
      if (!posts.length) throw new ProviderError('permanent', sections ? 'The page had no dated notes, so its layout may have changed.' : 'The page listed no posts, so its layout may have changed.');
      const now = store.now().toISOString();
      const firstRead = previous.seen === null;
      const seen = new Set(previous.seen ?? []);
      // "Anthropic news" is Anthropic; "Claude release notes", Claude.
      const named = outletOf(source.name, source.config);
      const outlet = typeof source.config.outlet === 'string' ? named.outlet : named.outlet.replace(/ (news|release notes)$/i, '').trim();
      // A section of the page keeps its anchor: the page is the only address it has.
      const found = posts.map(post => ({post, canonical: post.anchor ? `${canonicalUrl(post.url)}#${post.anchor}` : canonicalUrl(post.url)}));
      const articles: FetchedArticle[] = [];
      for (const {post, canonical} of found) {
        if (seen.has(canonical)) continue;
        const publishedAt = postedAt(post.date, now, store.timeZone, firstRead);
        if (!publishedAt) continue;
        articles.push({
          url: post.url, canonicalUrl: canonical, outlet, outletShort: named.outletShort, byline: null, headline: post.headline, feedSummary: null,
          publishedAt, imageUrl: null, text: post.text,
        });
      }
      // This read's posts first, then those seen before, so the page's own list is always remembered.
      const remembered = [...new Set([...found.map(({canonical}) => canonical), ...seen])].slice(0, SEEN_KEPT);
      return {
        articles,
        cursor: JSON.stringify({etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), seen: remembered}),
      };
    },
  };
}
