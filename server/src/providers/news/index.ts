// News's adapters (N2), one per NEWS_ADAPTERS key, and the reader of new articles, for
// src/news/worker.ts. Each reads its own source's address (a feed, a page, an API's base), so tests
// point a source at a fake on 127.0.0.1 and pass `privateHosts`; production never reaches a private
// host. Every request sends the worker's honest, named User-Agent.
import type {NewsAdapters} from '../../news/adapter.ts';
import {airNowAdapter, calFireAdapter, hnAdapter, nwsAdapter, usgsAdapter} from './apis.ts';
import {feedAdapter, googleNewsAdapter} from './feeds.ts';
import type {NewsHttpOptions} from './http.ts';
import {pageReadAdapter} from './pages.ts';

export {newsReader} from './reader.ts';

export function newsAdapters(options: NewsHttpOptions = {}): Required<NewsAdapters> {
  return {
    feed: feedAdapter(options),
    nws: nwsAdapter(options),
    usgs: usgsAdapter(options),
    cal_fire: calFireAdapter(options),
    airnow: airNowAdapter(options),
    hn_algolia: hnAdapter(options),
    page_read: pageReadAdapter(options),
    google_news: googleNewsAdapter(options),
  };
}
