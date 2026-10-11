// News ingest end to end (N2), on the sync engine against fakes on 127.0.0.1 that answer as each
// source does: a feed's conditional GET and its articles' text and image copies, the summary-only,
// metered and discovery rules, page reads, the hazard APIs from the home location, Hacker News, and
// the health tests (a dead feed, a page read that finds nothing, a 429 with Retry-After). Every
// request names Setpoint.
import fs from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {articleSchema, SEED_NOW} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import sharp from 'sharp';
import {describe, expect, onTestFinished, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {sourceValues} from '../src/news/sources.ts';
import type {NewsSourceSpec} from '../src/news/sources.ts';
import {NEWS_USER_AGENT, NewsWorker} from '../src/news/worker.ts';
import {newsGet} from '../src/providers/news/http.ts';
import {newsAdapters, newsReader} from '../src/providers/news/index.ts';
import {articleDetail, newsSources} from '../src/queries/news.ts';
import {updateSettings} from '../src/settings.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import type {FakeRequest, FakeResponse, FakeServer} from './fakes/server.ts';
import {fakeServer, on} from './fakes/server.ts';
import {newsFixture, newsJson, photo} from './fixtures/news.ts';
import {world} from './helpers.ts';
import type {World} from './helpers.ts';

const MINUTE = 60_000;
const HOME = {label: 'Home', address: '100 Example St', lat: 34.05, lng: -118.25};
const AIRNOW_MODIFIED = 'Wed, 07 Oct 2026 15:25:00 GMT';

type Page = (base: string, request: FakeRequest) => FakeResponse;

/** A fake site: each path's answer, given the site's own address; anything else is a 404. */
async function site(pages: Record<string, Page>): Promise<FakeServer> {
  let base = '';
  const server = await fakeServer([on('GET', /^\/.*$/, request => (pages[request.path]?.(base, request) ?? {status: 404, body: 'Not Found', headers: {'content-type': 'text/html'}}))]);
  base = server.url;
  return server;
}

const xml = (name: string, headers: Record<string, string> = {}): Page => base => ({status: 200, body: newsFixture(name, base), headers: {'content-type': 'application/rss+xml; charset=UTF-8', ...headers}});
const html = (name: string): Page => base => ({status: 200, body: newsFixture(name, base), headers: {'content-type': 'text/html; charset=UTF-8'}});
const json = (body: unknown): Page => () => ({status: 200, body});
const image = (bytes: Buffer, type = 'image/jpeg'): Page => () => ({status: 200, body: bytes, headers: {'content-type': type}});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-ingest-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

/** An empty Setpoint whose News reads through N2's adapters, with a directory for image copies. */
function ingestWorld() {
  const w = world();
  const images = tempDir();
  const worker = new NewsWorker({store: w.store, adapters: newsAdapters({privateHosts: true}), reader: newsReader({privateHosts: true}), imagesDir: images});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [worker]});
  onTestFinished(() => engine.stop());
  const run = async () => {
    await engine.tick();
    await engine.settled();
  };
  return {w, images, run};
}

let position = 0;
function addSource(w: World, spec: Partial<NewsSourceSpec> & Pick<NewsSourceSpec, 'key' | 'adapter' | 'url'>) {
  position += 1;
  const full: NewsSourceSpec = {name: 'Channel 4 · Local news', section: 'local', kind: 'feed', reads: 'Feed', ...spec};
  return w.store.db.insert(t.newsSources).values({...sourceValues(full, 'local', position), createdAt: w.store.now().toISOString()}).returning().get();
}

const articles = (w: World, sourceId: number) => w.store.db.select().from(t.newsArticles).where(eq(t.newsArticles.sourceId, sourceId)).orderBy(t.newsArticles.id).all();
const health = (w: World, sourceId: number) => newsSources(w.store).sections.flatMap(section => section.sources).find(source => source.id === sourceId)!.health;
const paths = (server: FakeServer) => server.requests.map(request => request.path);
const imagesOf = (w: World, articleId: number) => w.store.db.select().from(t.newsImages).where(eq(t.newsImages.articleId, articleId)).all()
  .sort((a, b) => a.variant.localeCompare(b.variant));

describe('feeds', () => {
  test('a feed: each new article in the 48 hours once by its canonical URL, its page\'s text, its best image copied at both sizes, then a 304 that\'s healthy', async () => {
    const {w, images, run} = await ingestWorld();
    const station = await site({
      '/news/local/feed/': (base, request) => (request.headers['if-none-match'] === '"v1"' ? {status: 304}
        : xml('station.rss.xml', {etag: '"v1"', 'last-modified': 'Wed, 07 Oct 2026 15:40:00 GMT'})(base, request)),
      '/news/local/brush-fire-fabrikam-ridge/': html('article.html'),
      '/news/local/contoso-avenue-water-main/': html('wall.html'),
      '/images/fire-1200.jpg': image(await photo(1200, 675)),
      '/images/water-main.jpg': image(await photo(800, 450)),
    });
    const source = addSource(w, {key: 'local:channel-4', adapter: 'feed', url: `${station.url}/news/local/feed/`});
    await run();

    const [fire, closure] = articles(w, source.id).sort((a, b) => a.id - b.id);
    expect(articles(w, source.id)).toHaveLength(2);
    expect(fire).toMatchObject({
      url: `${station.url}/news/local/brush-fire-fabrikam-ridge/?utm_source=rss&utm_medium=rss&utm_campaign=brush-fire`, canonicalUrl: `${station.url}/news/local/brush-fire-fabrikam-ridge`,
      outlet: 'Channel 4', byline: 'Dana Whitfield', headline: 'Brush fire near Fabrikam Ridge grows to 400 acres', publishedAt: '2026-10-07T14:05:00.000Z',
      summaryOnly: false, metered: false, discovery: false, imageUrl: `${station.url}/images/fire-1200.jpg`,
    });
    expect(fire!.extractedText!.split('\n\n')).toHaveLength(4);
    expect(fire!.extractedText).toMatch(/^A brush fire burning in the hills above Fabrikam Ridge/);
    // The page that can't be read falls back to the feed summary: summary only, not an error.
    expect(closure).toMatchObject({canonicalUrl: `${station.url}/news/local/contoso-avenue-water-main`, extractedText: null, summaryOnly: true, imageUrl: `${station.url}/images/water-main.jpg`});
    expect(articleSchema.parse(articleDetail(w.store, closure!.id))).toMatchObject({text: null, summary_only: true, feed_summary: expect.stringMatching(/^Contoso Avenue is closed/)});
    expect(articleDetail(w.store, fire!.id).text).toBe(fire!.extractedText);

    // The feed's 1200-wide image was enough, so the page's og:image wasn't fetched; both copies are
    // Setpoint's own files at their sizes, cropped to fill.
    expect(paths(station)).not.toContain('/images/fire-og.jpg');
    const copies = imagesOf(w, fire!.id);
    expect(copies.map(copy => [copy.variant, copy.width, copy.height, copy.mimeType])).toEqual([['large', 640, 360, 'image/webp'], ['thumb', 144, 96, 'image/webp']]);
    for (const copy of copies) {
      const metadata = await sharp(fs.readFileSync(path.join(images, copy.file))).metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual(['webp', copy.width, copy.height]);
    }
    expect(articleDetail(w.store, fire!.id).image).toMatchObject({width: 640, height: 360});
    expect(health(w, source.id)).toMatchObject({state: 'healthy'});

    // 15 minutes on: a conditional GET with the validators, a 304, nothing new and still healthy.
    const before = station.requests.length;
    w.advance(15 * MINUTE);
    await run();
    const conditional = station.requests.slice(before);
    expect(conditional.map(request => request.path)).toEqual(['/news/local/feed/']);
    expect(conditional[0]!.headers).toMatchObject({'if-none-match': '"v1"', 'if-modified-since': 'Wed, 07 Oct 2026 15:40:00 GMT'});
    expect(articles(w, source.id)).toHaveLength(2);
    expect(health(w, source.id)).toMatchObject({state: 'healthy', last_check_at: new Date(Date.parse(SEED_NOW) + 15 * MINUTE).toISOString()});
    expect(w.store.db.select().from(t.newsSources).where(eq(t.newsSources.id, source.id)).get()!.cursor).toBe(JSON.stringify({etag: '"v1"', lastModified: 'Wed, 07 Oct 2026 15:40:00 GMT'}));
    expect(station.requests.every(request => request.headers['user-agent'] === NEWS_USER_AGENT)).toBe(true);
  });

  test('images: the feed\'s first, the page\'s og:image when it\'s bigger, and nothing when neither is a photo worth copying; never generated', async () => {
    const {w, run} = await ingestWorld();
    const newsroom = await site({
      '/blog/feed.xml': xml('newsroom.atom.xml'),
      // A small cover, and a page whose og:image is bigger.
      '/blog/breeze-3': html('article.html'),
      '/blog/assets/breeze-3/cover.png': image(await photo(300, 169, 'png'), 'image/png'),
      '/images/fire-og.jpg': image(await photo(1200, 630)),
      // An SVG thumbnail, and a page whose og:image is gone.
      '/blog/evaluation-suite': html('wall.html'),
      '/blog/assets/evals/thumb.jpg': () => ({status: 200, body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180"/></svg>', headers: {'content-type': 'image/svg+xml'}}),
    });
    const source = addSource(w, {key: 'northwind-blog', name: 'Northwind Labs blog', section: 'ai', adapter: 'feed', url: `${newsroom.url}/blog/feed.xml`});
    await run();
    const [breeze, evals] = articles(w, source.id).sort((a, b) => a.id - b.id);
    expect(breeze).toMatchObject({imageUrl: `${newsroom.url}/images/fire-og.jpg`, outlet: 'Northwind Labs blog'});
    expect(imagesOf(w, breeze!.id).map(copy => copy.variant)).toEqual(['large', 'thumb']);
    expect(imagesOf(w, evals!.id)).toEqual([]);
    expect(evals!.imageUrl).toBe(`${newsroom.url}/blog/assets/evals/thumb.jpg`);
    expect(paths(newsroom)).toContain('/images/wall-og.jpg');
  });

  test('summary only is never read for text, only its feed\'s image copied; a metered paper\'s articles are only counted; Google News\'s only found', async () => {
    const {w, run} = await ingestWorld();
    const station = await site({
      '/news/local/feed/': xml('station.rss.xml'),
      '/images/fire-1200.jpg': image(await photo(1200, 675)),
      '/images/water-main.jpg': image(await photo(800, 450)),
    });
    const paper = await site({'/local/rss': xml('station.rss.xml')});
    const google = await site({'/rss/search': xml('google-news.rss.xml')});
    const ktla = addSource(w, {key: 'local:summary-only', adapter: 'feed', url: `${station.url}/news/local/feed/`, summaryOnly: true});
    const metered = addSource(w, {key: 'local:metro-daily', name: 'Metro Daily', adapter: 'feed', url: `${paper.url}/local/rss`, metered: true});
    const search = addSource(w, {key: 'local:google-news-area', name: 'Google News · area search', kind: 'discovery', adapter: 'google_news', url: `${google.url}/rss/search`, config: {query: '"Example City" OR "Example County"'}});
    await run();

    // Summary only: no article page was asked for, the feed's images were copied.
    expect(paths(station).filter(p => p.startsWith('/news/local/') && !p.endsWith('/feed/'))).toEqual([]);
    expect(articles(w, ktla.id).map(article => [article.summaryOnly, article.extractedText, imagesOf(w, article.id).length])).toEqual([[true, null, 2], [true, null, 2]]);
    // Metered: the feed alone, nothing read or copied.
    expect(paths(paper)).toEqual(['/local/rss']);
    expect(articles(w, metered.id).map(article => [article.metered, article.extractedText, imagesOf(w, article.id).length])).toEqual([[true, null, 0], [true, null, 0]]);
    expect(() => articleDetail(w.store, articles(w, metered.id)[0]!.id)).toThrow();
    // Discovery: Google's search, never its links.
    expect(paths(google)).toEqual(['/rss/search']);
    expect(google.requests[0]!.query.get('q')).toBe('"Example City" OR "Example County"');
    expect(google.requests[0]!.query.get('ceid')).toBe('US:en');
    expect(articles(w, search.id).map(article => ({outlet: article.outlet, headline: article.headline, discovery: article.discovery, text: article.extractedText, url: article.url}))).toEqual([
      {outlet: 'Channel 7', headline: 'Federal agents detain 9 at a car wash in Example City', discovery: true, text: null, url: 'https://news.google.com/rss/articles/CBMiInvented0001?oc=5'},
      {outlet: 'Example Daily', headline: 'Council approves a housing project near the station', discovery: true, text: null, url: 'https://news.google.com/rss/articles/CBMiInvented0002?oc=5'},
    ]);
    expect(articles(w, search.id).flatMap(article => imagesOf(w, article.id))).toEqual([]);
  });
});

/** An address nothing listens at: a port that was free a moment ago. */
async function refusedUrl() {
  const server = http.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/feed`;
}

describe('health', () => {
  test('a dead feed fails with its reason (a 404, a refused connection, something that isn\'t a feed) and is read again on its interval', async () => {
    const {w, run} = await ingestWorld();
    const gone = await site({});
    const wrong = await site({'/feed': html('article.html')});
    const refusedAt = await refusedUrl();
    const notFound = addSource(w, {key: 'local:gone', adapter: 'feed', url: `${gone.url}/feed`});
    const refused = addSource(w, {key: 'local:refused', adapter: 'feed', url: refusedAt});
    const notAFeed = addSource(w, {key: 'local:html', adapter: 'feed', url: `${wrong.url}/feed`});
    await run();
    expect(health(w, notFound.id)).toMatchObject({state: 'failing', reason: '404 Not Found', failing_since: SEED_NOW});
    expect(health(w, refused.id)).toMatchObject({state: 'failing', reason: `Couldn't reach ${new URL(refusedAt).host} (ECONNREFUSED).`});
    expect(health(w, notAFeed.id)).toMatchObject({state: 'failing', reason: `${new URL(wrong.url).host} didn't send a feed.`});

    // A 404 isn't retried (the same question gets the same answer), but is read again in 15 minutes.
    w.advance(14 * MINUTE);
    await run();
    expect(gone.requests).toHaveLength(1);
    w.advance(MINUTE);
    await run();
    expect(gone.requests).toHaveLength(2);
    expect(health(w, notFound.id)).toMatchObject({state: 'failing', failing_since: SEED_NOW});
  });

  test('a page read that finds nothing is failing, not quiet: the page\'s layout may have changed', async () => {
    const {w, run} = await ingestWorld();
    const lab = await site({'/news': () => ({status: 200, body: '<!doctype html><html><body><div id="__next"></div><script src="/app.js"></script></body></html>', headers: {'content-type': 'text/html'}})});
    const source = addSource(w, {key: 'lab-news', name: 'Northwind news', section: 'ai', kind: 'page_read', adapter: 'page_read', url: `${lab.url}/news`});
    await run();
    expect(health(w, source.id)).toMatchObject({state: 'failing', reason: 'The page listed no posts, so its layout may have changed.'});
    expect(articles(w, source.id)).toEqual([]);
  });

  test('a 429 with Retry-After is retried after it, by the one retry policy, and the source recovers', async () => {
    const {w, run} = await ingestWorld();
    const station = await site({'/feed': xml('station.rss.xml')});
    const source = addSource(w, {key: 'local:busy', adapter: 'feed', url: `${station.url}/feed`});
    station.fault({path: /^\/feed/, response: {status: 429, body: 'Slow down', headers: {'retry-after': '600'}}});
    await run();
    expect(health(w, source.id)).toMatchObject({state: 'failing', reason: '429 Too Many Requests'});
    const job = w.store.db.select().from(t.jobs).where(eq(t.jobs.newsSourceId, source.id)).get()!;
    expect(job).toMatchObject({state: 'queued', runAt: new Date(Date.parse(SEED_NOW) + 10 * MINUTE).toISOString()});

    // Not before the ten minutes it asked for (the policy's own backoff is 30 seconds)…
    const feedReads = () => paths(station).filter(p => p === '/feed').length;
    w.advance(10 * MINUTE - 1000);
    await run();
    expect(feedReads()).toBe(1);
    // … and then once, which works.
    w.advance(1000);
    await run();
    expect(feedReads()).toBe(2);
    expect(health(w, source.id)).toMatchObject({state: 'healthy', failing_since: null});
    expect(articles(w, source.id)).toHaveLength(2);
  });

  test('a 503 asking for a pause waits as long too; one without is retried by the backoff', async () => {
    const {w, run} = await ingestWorld();
    const station = await site({'/feed': xml('station.rss.xml')});
    const source = addSource(w, {key: 'local:down', adapter: 'feed', url: `${station.url}/feed`});
    station.fault({path: /^\/feed/, response: {status: 503, body: 'Down for maintenance', headers: {'retry-after': '300'}}});
    await run();
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.newsSourceId, source.id)).get()!.runAt).toBe(new Date(Date.parse(SEED_NOW) + 5 * MINUTE).toISOString());
    station.fault({path: /^\/feed/, response: {status: 503, body: 'Down'}});
    w.advance(5 * MINUTE);
    await run();
    expect(health(w, source.id)).toMatchObject({state: 'failing', reason: '503 Service Unavailable'});
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.newsSourceId, source.id)).get()!.runAt).toBe(new Date(Date.parse(SEED_NOW) + 6 * MINUTE).toISOString());
  });
});

describe('where a read may go', () => {
  test('a moved feed is followed, by hand, with its validators; too many redirects fail', async () => {
    const {w, run} = await ingestWorld();
    const station = await site({
      '/old-feed': () => ({status: 301, headers: {location: '/feed'}}),
      '/feed': xml('station.rss.xml'),
      '/loop': () => ({status: 302, headers: {location: '/loop'}}),
    });
    const moved = addSource(w, {key: 'local:moved', adapter: 'feed', url: `${station.url}/old-feed`});
    const loop = addSource(w, {key: 'local:loop', adapter: 'feed', url: `${station.url}/loop`});
    await run();
    expect(articles(w, moved.id)).toHaveLength(2);
    expect(health(w, loop.id)).toMatchObject({state: 'failing', reason: '302 Found, with too many redirects.'});
    expect(paths(station).filter(p => p === '/loop')).toHaveLength(6);
  });

  test('outside tests, a read never reaches the home network, a feed\'s links and redirects included', async () => {
    const station = await site({'/feed': xml('station.rss.xml')});
    const request = {url: `${station.url}/feed`, userAgent: NEWS_USER_AGENT, signal: new AbortController().signal, accept: '*/*'};
    await expect(newsGet({}, request)).rejects.toMatchObject({kind: 'permanent', message: `${new URL(station.url).host} isn't a public web address.`});
    expect(station.requests).toEqual([]);
    // A public address that redirects home is refused at the redirect (a stand-in fetch plays the public site).
    const redirecting = (async (url: string | URL | Request) => (String(url).startsWith('https://news.example.com')
      ? new Response(null, {status: 302, headers: {location: 'http://192.168.1.1/admin'}})
      : new Response('reached'))) as typeof fetch;
    await expect(newsGet({fetch: redirecting}, {...request, url: 'https://news.example.com/feed'})).rejects.toMatchObject({message: '192.168.1.1 isn\'t a public web address.'});
  });
});

describe('page reads', () => {
  test('a news page\'s posts are news once: the first read keeps the 48 hours\' dated posts and notes the rest, a later one finds what\'s new; each post\'s page is read', async () => {
    const {w, run} = await ingestWorld();
    let listing = newsFixture('lab-news.html');
    const lab = await site({
      '/news': () => ({status: 200, body: listing, headers: {'content-type': 'text/html'}}),
      '/news/northwind-breeze-3': html('newsroom-article.html'),
      '/news/safety-report-fall-2026': html('wall.html'),
      '/news/a-new-post': html('newsroom-article.html'),
    });
    const source = addSource(w, {key: 'lab-news', name: 'Northwind news', section: 'ai', kind: 'page_read', adapter: 'page_read', url: `${lab.url}/news`});
    await run();
    expect(articles(w, source.id).map(article => [article.canonicalUrl, article.outlet, article.publishedAt, article.extractedText !== null])).toEqual([
      [`${lab.url}/news/northwind-breeze-3`, 'Northwind', SEED_NOW, true],
      [`${lab.url}/news/safety-report-fall-2026`, 'Northwind', '2026-10-06T17:00:00.000Z', false],
    ]);
    expect(paths(lab)).not.toContain('/news/fabrikam-partnership');
    expect(health(w, source.id)).toMatchObject({state: 'healthy'});

    // A new undated post appears at the top: it's new on the page, so now.
    listing = listing.replace('<ul class="post-grid">', '<ul class="post-grid"><li><a class="card" href="/news/a-new-post"><h3>A new post</h3></a></li>');
    w.advance(15 * MINUTE);
    await run();
    const later = new Date(Date.parse(SEED_NOW) + 15 * MINUTE).toISOString();
    expect(articles(w, source.id).map(article => [article.headline, article.publishedAt])).toEqual([
      ['Introducing Breeze 3', SEED_NOW], ['Our fall 2026 safety report', '2026-10-06T17:00:00.000Z'], ['A new post', later],
    ]);
  });

  test('release notes: each recent dated section is an article with its own text, and the page isn\'t read again for it', async () => {
    const {w, run} = await ingestWorld();
    const docs = await site({'/en/release-notes/overview': html('release-notes.html')});
    const source = addSource(w, {key: 'release-notes', name: 'Northwind release notes', section: 'ai', kind: 'page_read', adapter: 'page_read', url: `${docs.url}/en/release-notes/overview`, config: {layout: 'dated_sections'}});
    await run();
    expect(articles(w, source.id).map(article => ({url: article.canonicalUrl, outlet: article.outlet, headline: article.headline, text: article.extractedText, at: article.publishedAt}))).toEqual([
      {url: `${docs.url}/en/release-notes/overview#october-7-2026`, outlet: 'Northwind', headline: 'We\'ve launched Breeze 3 in the API, with transcription in 40 languages.',
        text: 'We\'ve launched Breeze 3 in the API, with transcription in 40 languages. Read more in our docs.\n\nBatch requests now cost half as much.', at: SEED_NOW},
      {url: `${docs.url}/en/release-notes/overview#october-5-2026`, outlet: 'Northwind', headline: 'The usage page now shows costs by day.', text: 'The usage page now shows costs by day.', at: '2026-10-05T19:00:00.000Z'},
    ]);
    expect(paths(docs)).toEqual(['/en/release-notes/overview']);
  });
});

describe('hazards from the home location', () => {
  async function hazardWorld() {
    const {w, run} = await ingestWorld();
    const nws = newsJson('nws.json');
    const apis = newsJson('apis.json');
    const api = await site({
      '/points/34.05,-118.25': json(nws.points),
      '/alerts/active/zone/CAZ990': json(nws.alerts.CAZ990),
      '/alerts/active/zone/CAC037': json(nws.alerts.CAC037),
      '/fdsnws/event/1/query': json(apis.usgs),
      '/umbraco/api/IncidentApi/GeoJsonList': json(newsJson('cal-fire.geojson')),
      // AirNow's hourly file, with a BOM and CRLF, and a 304 once it's asked with its Last-Modified.
      '/airnow/today/reportingarea.dat': (_, request) => (request.headers['if-modified-since'] === AIRNOW_MODIFIED ? {status: 304}
        : {status: 200, body: Buffer.from(newsFixture('reportingarea.dat')), headers: {'content-type': 'text/plain', 'last-modified': AIRNOW_MODIFIED}}),
    });
    const source = (key: string, adapter: NewsSourceSpec['adapter'], url: string, config: Record<string, unknown>, extra: Partial<NewsSourceSpec> = {}) =>
      addSource(w, {key, name: key, kind: 'official_api', adapter, url, config, ...extra});
    const sources = {
      nws: source('nws-alerts', 'nws', api.url, {}),
      usgs: source('usgs-earthquakes', 'usgs', `${api.url}/fdsnws/event/1/query`, {minMagnitude: 3, radiusKm: 100}),
      calFire: source('cal-fire', 'cal_fire', `${api.url}/umbraco/api/IncidentApi/GeoJsonList?inactive=false`, {radiusKm: 80}),
      // Hourly, as the built-in one is: the file changes once an hour.
      airNow: source('airnow', 'airnow', `${api.url}/airnow/today/reportingarea.dat`, {radiusKm: 40, minAqi: 151}, {intervalSeconds: 60 * 60}),
    };
    return {w, run, api, sources};
  }

  test('without the home location, none is read and none has health; with it, each reads near it, every 5 minutes but AirNow hourly', async () => {
    const {w, run, api, sources} = await hazardWorld();
    await run();
    expect(api.requests).toEqual([]);
    expect(Object.values(sources).map(source => health(w, source.id))).toEqual([null, null, null, null]);

    updateSettings(w.store, {calendar: {home: HOME}});
    await run();
    const outlets = (id: number) => articles(w, id).map(article => article.headline);
    // NWS: the point's zones, then each zone's alerts; the warning both list is one article.
    expect(outlets(sources.nws.id)).toEqual(['Red Flag Warning issued October 7 at 2:14AM PDT until October 8 at 6:00PM PDT by NWS Example Office']);
    expect(articles(w, sources.nws.id)[0]!.extractedText).toMatch(/^AFFECTED AREA/);
    expect(outlets(sources.usgs.id)).toEqual(['M 3.4 - 12 km NE of Example Valley, CA']);
    expect(outlets(sources.calFire.id)).toEqual(['Tailspin Fire: 1,250 acres, 35% contained', 'Wingtip Fire: 60 acres, 80% contained']);
    expect(outlets(sources.airNow.id)).toEqual(['Unhealthy air quality in Example Valley, AQI 160', 'Unhealthy air quality in Example Foothills, AQI 156']);
    const usgs = api.requests.find(request => request.path === '/fdsnws/event/1/query')!;
    expect(Object.fromEntries(usgs.query)).toMatchObject({format: 'geojson', latitude: '34.05', longitude: '-118.25', maxradiuskm: '100', minmagnitude: '3', starttime: '2026-10-05T16:12:00.000Z'});
    expect(Object.values(sources).map(source => health(w, source.id)?.state)).toEqual(['healthy', 'healthy', 'healthy', 'healthy']);
    // Official data is its own text: no page is read, no image copied.
    expect(api.requests.every(request => /^\/(points|alerts|fdsnws|umbraco|airnow)\//.test(request.path))).toBe(true);
    expect(api.requests.every(request => request.headers['user-agent'] === NEWS_USER_AGENT)).toBe(true);

    // Every 5 minutes; the zones are kept from the first read, so /points isn't asked again.
    const before = api.requests.length;
    w.advance(4 * MINUTE);
    await run();
    expect(api.requests).toHaveLength(before);
    w.advance(MINUTE);
    await run();
    expect(api.requests.slice(before).map(request => request.path).sort()).toEqual([
      '/alerts/active/zone/CAC037', '/alerts/active/zone/CAZ990', '/fdsnws/event/1/query', '/umbraco/api/IncidentApi/GeoJsonList',
    ]);
    // The same alerts, quakes and readings aren't kept twice.
    expect(Object.values(sources).map(source => articles(w, source.id).length)).toEqual([1, 1, 2, 2]);
  });

  test('AirNow needs no key: its file is read near home once Home is set, then asked with its Last-Modified an hour on, a 304 that\'s healthy', async () => {
    const {w, run, api, sources} = await hazardWorld();
    const reads = () => api.requests.filter(request => request.path === '/airnow/today/reportingarea.dat');
    await run();
    expect(reads()).toEqual([]);
    expect(health(w, sources.airNow.id)).toBeNull();

    updateSettings(w.store, {calendar: {home: HOME}});
    await run();
    expect(reads()).toHaveLength(1);
    expect(reads()[0]!.query.size).toBe(0);
    expect(reads()[0]!.headers['if-modified-since']).toBeUndefined();
    expect(articles(w, sources.airNow.id).map(article => [article.canonicalUrl, article.publishedAt, article.extractedText])).toEqual([
      ['https://airnow.gov?city=Example+Valley&country=USA&state=CA#2026-10-07-aqi-category-4', '2026-10-07T15:00:00.000Z',
        'Unhealthy air in Example Valley, CA: AQI 160 (PM2.5). AirNow\'s reading for 2026-10-07 at 08:00 PDT.'],
      ['https://airnow.gov?city=Example+Foothills&country=USA&state=CA#2026-10-07-aqi-category-4', '2026-10-07T15:00:00.000Z',
        'Unhealthy air in Example Foothills, CA: AQI 156 (ozone). AirNow\'s reading for 2026-10-07 at 08:00 PDT.'],
    ]);
    expect(health(w, sources.airNow.id)).toMatchObject({state: 'healthy'});
    expect(w.store.db.select().from(t.newsSources).where(eq(t.newsSources.id, sources.airNow.id)).get()!.cursor).toBe(JSON.stringify({etag: null, lastModified: AIRNOW_MODIFIED}));

    w.advance(60 * MINUTE);
    await run();
    expect(reads()).toHaveLength(2);
    expect(reads()[1]!.headers['if-modified-since']).toBe(AIRNOW_MODIFIED);
    expect(articles(w, sources.airNow.id)).toHaveLength(2);
    expect(health(w, sources.airNow.id)).toMatchObject({state: 'healthy', last_check_at: new Date(Date.parse(SEED_NOW) + 60 * MINUTE).toISOString()});

    // A page that isn't the file would read as clean air, so it's failing instead.
    api.fault({path: /^\/airnow\//, response: {status: 200, body: '<html>Down for maintenance</html>', headers: {'content-type': 'text/html'}}});
    w.advance(60 * MINUTE);
    await run();
    expect(health(w, sources.airNow.id)).toMatchObject({state: 'failing', reason: `${new URL(api.url).host} didn't send AirNow's reporting-area file.`});
  });

  test('Home moving finds its zones again', async () => {
    const {w, run, api} = await hazardWorld();
    updateSettings(w.store, {calendar: {home: HOME}});
    await run();
    updateSettings(w.store, {calendar: {home: {...HOME, lat: 34.1, lng: -118.3}}});
    w.advance(5 * MINUTE);
    await run();
    expect(api.requests.filter(request => request.path.startsWith('/points/')).map(request => request.path)).toEqual(['/points/34.05,-118.25', '/points/34.1,-118.3']);
  });
});

describe('Hacker News', () => {
  test('stories over the points threshold through Algolia, each story\'s own page read', async () => {
    const {w, run} = await ingestWorld();
    const story = await site({'/blog/breeze-3': html('newsroom-article.html')});
    const hits = newsJson('apis.json').hackerNews;
    hits.hits[0].url = `${story.url}/blog/breeze-3?utm_source=hn`;
    const algolia = await site({'/api/v1/search_by_date': json(hits)});
    const source = addSource(w, {key: 'hacker-news', name: 'Hacker News', section: 'tech', adapter: 'hn_algolia', url: `${algolia.url}/api/v1/search_by_date`, config: {minPoints: 150}});
    await run();
    expect(Object.fromEntries(algolia.requests[0]!.query)).toEqual({tags: 'story', numericFilters: 'points>=150,created_at_i>1791216720', hitsPerPage: '100'});
    expect(articles(w, source.id).map(article => [article.headline, article.canonicalUrl, article.extractedText !== null])).toEqual([
      ['Breeze 3: an open speech model that runs on a laptop', `${story.url}/blog/breeze-3`, true],
      // A text post is its own text: its discussion page isn't read.
      ['Ask HN: How do you run evaluations for speech models?', 'https://news.ycombinator.com/item?id=90000002', true],
    ]);
  });
});
