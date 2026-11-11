// News's routes (shapes and the list in `@setpoint/shared` src/api/news.ts): All, a section, a story,
// an article, the iPhone app's Catch up, Settings › News, Setpoint's image copies, and stories seen;
// N3's sorting state (Unsorted and the first run), Show headlines, search, and Upcoming's Add to
// calendar; and the recap's state (#298): News on screen, Done and its Undo. Mounted under /api behind
// the session, like the rest of the API. Read-only but for seen and the recap; ingest (N2) and sorting
// (N3) write the rest, and every change goes out as a `news` live event.
import {newsHereInput, newsSearchInput, newsSectionSchema, newsSeenInput, recapUndoSchema} from '@setpoint/shared';
import type {NewsSeenOut, RecapDoneOut} from '@setpoint/shared';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {invalid, notFound, parse} from '../errors.ts';
import {readNewsImage} from '../news/images.ts';
import {proposeFromNewsEvent} from '../news/proposal.ts';
import {noteHere, putRecapAway, undoPutAway} from '../news/recap.ts';
import {newsStatus, unsortedArticles} from '../news/sortState.ts';
import {markSeen} from '../news/store.ts';
import {articleDetail, missed, newsDay, newsPage, newsRecap, newsSearch, newsSection, newsSources, storyDetail, storyRows} from '../queries/news.ts';
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
  // Setpoint's public origin, which a keynote proposal's link to its story is made absolute on (SV-270).
  origin?: (c: Context) => string;
}

export function newsApi(store: Store, {imagesDir = null, origin = c => new URL(c.req.url).origin}: NewsApiOptions = {}) {
  const api = new Hono();
  api.get('/news', c => c.json(newsPage(store)));
  api.get('/news/sections/:section', c => c.json(newsSection(store, parse(newsSectionSchema, c.req.param('section')))));
  api.get('/news/stories/:id', c => c.json(storyDetail(store, id(c.req.param('id')))));
  api.get('/news/articles/:id', c => c.json(articleDetail(store, id(c.req.param('id')))));
  api.get('/news/missed', c => c.json(missed(store)));
  api.get('/news/sources', c => c.json(newsSources(store)));
  api.get('/news/day', c => c.json(newsDay(store)));
  api.get('/news/status', c => c.json(newsStatus(store)));
  api.get('/news/unsorted', c => c.json(unsortedArticles(store)));
  api.get('/news/search', c => c.json(newsSearch(store, parse(newsSearchInput, c.req.query()))));
  api.post('/news/events/:id/proposal', c => c.json(proposeFromNewsEvent(store, id(c.req.param('id')), origin(c))));
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
    const ids = parse(newsSeenInput, await body(c)).story_ids;
    // Seeing a story is being on News, and seeing one of the recap's means it's on screen: the iPhone
    // app's Catch up (D424) fixes it as the page does.
    const recap = newsRecap(store)?.stories.map(story => story.id) ?? [];
    noteHere(store, recap.some(id => ids.includes(id)) ? recap : null);
    const seen = markSeen(store, ids);
    return c.json({stories: storyRows(store, seen)} satisfies NewsSeenOut);
  });
  api.post('/news/here', async c => {
    noteHere(store, parse(newsHereInput, await body(c)).recap);
    return c.body(null, 204);
  });
  api.post('/news/recap/done', c => c.json({undo: putRecapAway(store)} satisfies RecapDoneOut));
  api.post('/news/recap/undo', async c => {
    undoPutAway(store, parse(recapUndoSchema, await body(c)));
    return c.body(null, 204);
  });
  return api;
}
