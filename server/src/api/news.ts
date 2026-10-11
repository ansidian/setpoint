// News's routes (shapes and the list in `@setpoint/shared` src/api/news.ts): All, a section, a story,
// an article, Missed, Settings › News, Setpoint's image copies, and stories seen; N3's sorting state
// (Unsorted and the first run), Show headlines, search, and Upcoming's Add to calendar. Mounted under
// /api behind the session, like the rest of the API. Read-only but for seen; ingest (N2) and sorting
// (N3) write the rest, and every change goes out as a `news` live event.
import {newsSearchInput, newsSectionSchema, newsSeenInput} from '@setpoint/shared';
import type {NewsSeenOut} from '@setpoint/shared';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {invalid, notFound, parse} from '../errors.ts';
import {readNewsImage} from '../news/images.ts';
import {proposeFromNewsEvent} from '../news/proposal.ts';
import {newsStatus, unsortedArticles} from '../news/sortState.ts';
import {markSeen} from '../news/store.ts';
import {articleDetail, missed, newsPage, newsSearch, newsSection, newsSources, storyDetail, storyRows} from '../queries/news.ts';
import type {Store} from '../store.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

export interface NewsApiOptions {
  // The data directory's news-images/; null serves no images (tests without a data directory).
  imagesDir?: string | null;
}

export function newsApi(store: Store, {imagesDir = null}: NewsApiOptions = {}) {
  const api = new Hono();
  api.get('/news', c => c.json(newsPage(store)));
  api.get('/news/sections/:section', c => c.json(newsSection(store, parse(newsSectionSchema, c.req.param('section')))));
  api.get('/news/stories/:id', c => c.json(storyDetail(store, id(c.req.param('id')))));
  api.get('/news/articles/:id', c => c.json(articleDetail(store, id(c.req.param('id')))));
  api.get('/news/missed', c => c.json(missed(store)));
  api.get('/news/sources', c => c.json(newsSources(store)));
  api.get('/news/status', c => c.json(newsStatus(store)));
  api.get('/news/unsorted', c => c.json(unsortedArticles(store)));
  api.get('/news/search', c => c.json(newsSearch(store, parse(newsSearchInput, c.req.query()))));
  api.post('/news/events/:id/proposal', c => c.json(proposeFromNewsEvent(store, id(c.req.param('id')))));
  // A copy never changes under its id (a replaced one gets a new id), so the browser may keep it.
  api.get('/news/images/:id', c => {
    const image = readNewsImage(store, imagesDir, id(c.req.param('id')));
    if (!image) throw notFound('No such image.');
    c.header('Content-Type', image.mimeType);
    c.header('Cache-Control', 'private, max-age=86400');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(new Uint8Array(image.bytes));
  });
  api.post('/news/seen', async c => {
    const seen = markSeen(store, parse(newsSeenInput, await body(c)).story_ids);
    return c.json({stories: storyRows(store, seen)} satisfies NewsSeenOut);
  });
  return api;
}
