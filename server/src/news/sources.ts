// News's sources (BRIEF.md › News › Sources, D89, D91): the built-in list here holds only what isn't
// local (national outlets, first-party newsrooms, the tech press, the labs' pages, Hacker News, and
// the hazard APIs, which read the home location in Settings › Calendar). The local list (the area's
// stations, a crime wire, Google News search for the area) names the user's city, so it lives in the data
// directory, never in this public repository: news-local-sources.json there, first copied from the
// uncommitted server/news/local-sources.json when there is one (server/news/local-sources.example.json
// shows the shape). Every source is registered at start, by key, so a restart adds no duplicates.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {NEWS_SECTIONS, NEWS_SOURCE_ICONS, NEWS_SOURCE_KINDS} from '@setpoint/shared';
import type {NewsSection, NewsSourceIcon, NewsSourceKind} from '@setpoint/shared';
import {and, eq, inArray, isNull, notInArray} from 'drizzle-orm';
import {z} from 'zod';
import * as t from '../db/schema.ts';
import {NEWS_ADAPTERS} from '../db/schema.ts';
import type {NewsAdapterKey} from '../db/schema.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';

const MINUTE = 60;

/** How often each kind is read by default: feeds every 15 minutes (many hold only 10 items), hazards every 5. */
export const NEWS_INTERVALS: Record<NewsSourceKind, number> = {
  feed: 15 * MINUTE,
  official_api: 5 * MINUTE,
  page_read: 15 * MINUTE,
  discovery: 30 * MINUTE,
};

export interface NewsSourceSpec {
  key: string;
  name: string;
  section: NewsSection;
  kind: NewsSourceKind;
  adapter: NewsAdapterKey;
  url: string | null;
  reads: string;
  config?: Record<string, unknown>;
  summaryOnly?: boolean;
  metered?: boolean;
  intervalSeconds?: number;
  // Its tile in Settings › News, kept in its config; none takes its adapter's (N5).
  icon?: NewsSourceIcon;
}

// Every outlet's sources name it in their config, so its several feeds (The Verge's four, Google's
// blogs) are one outlet to a story's count and read the same in its rows.
const feed = (key: string, name: string, section: NewsSection, url: string, outlet: string, reads = 'Feed', extra: Partial<NewsSourceSpec> = {}): NewsSourceSpec =>
  ({key, name, section, kind: 'feed', adapter: 'feed', url, reads, ...extra, config: {outlet, ...extra.config}});
const page = (key: string, name: string, url: string, outlet: string, reads: string, config: Record<string, unknown> = {}): NewsSourceSpec =>
  ({key, name, section: 'ai', kind: 'page_read', adapter: 'page_read', url, reads, config: {outlet, ...config}});

/**
 * The built-in list: free, chosen by hand and checked to have no paywall (D89), as the 2026-10-10
 * research (SV-43) fetched each one. Feed URLs are the ones each outlet publishes. The hazard APIs ask
 * about the home location, so they name no place here. Several are filtered rather than taken whole
 * (tech press, the status page): the model's noise filter keeps only what BRIEF's sections cover.
 */
export const DEFAULT_NEWS_SOURCES: NewsSourceSpec[] = [
  // Local: official data for hazards, by distance from the home location.
  {key: 'nws-alerts', name: 'National Weather Service', section: 'local', kind: 'official_api', adapter: 'nws', url: 'https://api.weather.gov', reads: 'Alerts for the home location\'s zone'},
  {key: 'usgs-earthquakes', name: 'USGS earthquakes', section: 'local', kind: 'official_api', adapter: 'usgs', url: 'https://earthquake.usgs.gov/fdsnws/event/1/query',
    reads: 'M3 and up within 100 km', config: {minMagnitude: 3, radiusKm: 100}},
  // The incidents host's GeoJSON list: www.fire.ca.gov refuses the API's requests.
  {key: 'cal-fire', name: 'Cal Fire incidents', section: 'local', kind: 'official_api', adapter: 'cal_fire', url: 'https://incidents.fire.ca.gov/umbraco/api/IncidentApi/GeoJsonList?inactive=false',
    reads: 'Within 80 km', config: {radiusKm: 80}},
  // AirNow's free reporting-area file, which needs no key and changes hourly (its observations web
  // service was retired on 2026-10-01).
  {key: 'airnow', name: 'AirNow air quality', section: 'local', kind: 'official_api', adapter: 'airnow', url: 'https://files.airnowtech.org/airnow/today/reportingarea.dat',
    reads: 'Unhealthy air within 40 km', config: {radiusKm: 40, minAqi: 151}, intervalSeconds: 60 * MINUTE},
  // Tech: first-party newsrooms, the tech press on the named companies, and Hacker News above a
  // points threshold on a tech or AI subject.
  feed('apple-newsroom', 'Apple Newsroom', 'tech', 'https://www.apple.com/newsroom/rss-feed.rss', 'Apple'),
  feed('google-products', 'Google · Products', 'tech', 'https://blog.google/products-and-platforms/products/rss/', 'Google', 'Feed, Products'),
  feed('google-pixel', 'Google · Pixel', 'tech', 'https://blog.google/products-and-platforms/devices/pixel/rss/', 'Google', 'Feed, Pixel'),
  feed('samsung-newsroom', 'Samsung Newsroom', 'tech', 'https://news.samsung.com/global/feed', 'Samsung', 'Feed, Global'),
  feed('microsoft-news', 'Microsoft Source', 'tech', 'https://news.microsoft.com/source/feed/', 'Microsoft'),
  feed('the-verge-apple', 'The Verge · Apple', 'tech', 'https://www.theverge.com/rss/apple/index.xml', 'The Verge', 'Feed, Apple'),
  feed('the-verge-google', 'The Verge · Google', 'tech', 'https://www.theverge.com/rss/google/index.xml', 'The Verge', 'Feed, Google'),
  feed('the-verge-samsung', 'The Verge · Samsung', 'tech', 'https://www.theverge.com/rss/samsung/index.xml', 'The Verge', 'Feed, Samsung'),
  feed('the-verge-tech', 'The Verge · Tech', 'tech', 'https://www.theverge.com/rss/tech/index.xml', 'The Verge', 'Feed, Tech'),
  feed('ars-technica-gadgets', 'Ars Technica · Gadgets', 'tech', 'https://feeds.arstechnica.com/arstechnica/gadgets', 'Ars Technica', 'Feed, Gadgets'),
  feed('macrumors', 'MacRumors', 'tech', 'https://feeds.macrumors.com/MacRumors-All', 'MacRumors'),
  feed('9to5google', '9to5Google', 'tech', 'https://9to5google.com/feed/', '9to5Google'),
  {key: 'hacker-news', name: 'Hacker News', section: 'tech', kind: 'feed', adapter: 'hn_algolia', url: 'https://hn.algolia.com/api/v1/search_by_date',
    reads: 'Stories over 300 points on a tech or AI subject', config: {minPoints: 300}},
  // AI: the labs' newsrooms. Anthropic's news and release notes and Mistral's news have no feed, so
  // their pages are read directly; Anthropic's status feed is there for major outages.
  page('anthropic-news', 'Anthropic news', 'https://www.anthropic.com/news', 'Anthropic', 'News page, read directly'),
  page('claude-release-notes', 'Claude Platform release notes', 'https://platform.claude.com/docs/en/release-notes/overview', 'Anthropic', 'Release notes, read directly',
    {layout: 'dated_sections'}),
  page('claude-apps-release-notes', 'Claude apps release notes', 'https://support.claude.com/en/articles/12138966-release-notes', 'Anthropic', 'Release notes, read directly',
    {layout: 'dated_sections'}),
  feed('anthropic-status', 'Anthropic status', 'ai', 'https://status.claude.com/history.rss', 'Anthropic', 'Feed, major outages only'),
  feed('google-ai', 'Google · AI', 'ai', 'https://blog.google/innovation-and-ai/technology/ai/rss/', 'Google', 'Feed, AI'),
  feed('google-gemini', 'Google · Gemini', 'ai', 'https://blog.google/products-and-platforms/products/gemini/rss/', 'Google', 'Feed, Gemini'),
  feed('openai-news', 'OpenAI News', 'ai', 'https://openai.com/news/rss.xml', 'OpenAI', 'Feed, summary only', {summaryOnly: true}),
  feed('google-deepmind', 'Google DeepMind', 'ai', 'https://deepmind.google/blog/rss.xml', 'Google DeepMind'),
  feed('meta-newsroom', 'Meta Newsroom', 'ai', 'https://about.fb.com/feed/', 'Meta'),
  feed('hugging-face', 'Hugging Face blog', 'ai', 'https://huggingface.co/blog/feed.xml', 'Hugging Face'),
  page('mistral-news', 'Mistral AI news', 'https://mistral.ai/news', 'Mistral AI', 'News page, read directly', {outlet_short: 'Mistral'}),
  feed('the-verge-ai', 'The Verge · AI', 'ai', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'The Verge', 'Feed, AI'),
  feed('ars-technica-ai', 'Ars Technica · AI', 'ai', 'https://arstechnica.com/ai/feed/', 'Ars Technica', 'Feed, AI'),
  feed('techcrunch-ai', 'TechCrunch · AI', 'ai', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'TechCrunch', 'Feed, AI'),
  feed('simon-willison', 'Simon Willison · LLMs', 'ai', 'https://simonwillison.net/tags/llms.atom', 'Simon Willison', 'Feed, LLMs'),
  // General: national outlets' US feeds, and the courts.
  feed('npr-national', 'NPR', 'general', 'https://feeds.npr.org/1003/rss.xml', 'NPR', 'Feed, National'),
  feed('npr-law', 'NPR · Law', 'general', 'https://feeds.npr.org/1070/rss.xml', 'NPR', 'Feed, Law'),
  feed('pbs-newshour', 'PBS News', 'general', 'https://www.pbs.org/newshour/feeds/rss/nation', 'PBS News', 'Feed, Nation'),
  feed('abc-news', 'ABC News', 'general', 'https://abcnews.go.com/abcnews/usheadlines', 'ABC News', 'Feed, US headlines (the AP wire)'),
  feed('cbs-news', 'CBS News', 'general', 'https://www.cbsnews.com/latest/rss/main', 'CBS News', 'Feed, Latest'),
  feed('nbc-news', 'NBC News', 'general', 'https://feeds.nbcnews.com/nbcnews/public/news', 'NBC News', 'Feed, News'),
  feed('guardian-us', 'The Guardian US', 'general', 'https://www.theguardian.com/us-news/rss', 'The Guardian', 'Feed, US news'),
  feed('bbc-us', 'BBC News', 'general', 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml', 'BBC News', 'Feed, US & Canada'),
  feed('courthouse-news', 'Courthouse News', 'general', 'https://www.courthousenews.com/feed/', 'Courthouse News'),
];

// ---- The local list, in the data directory (D91) ----

/** The local list's name in the data directory. */
export const LOCAL_SOURCES_FILE = 'news-local-sources.json';
/** Where a checkout keeps the user's own list, never committed (.gitignore), to seed the data directory's from. */
export const REPO_LOCAL_SOURCES = fileURLToPath(new URL('../../news/local-sources.json', import.meta.url));

const localSourceSchema = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]{1,64}$/, 'Lower-case letters, digits and hyphens'),
  name: z.string().trim().min(1).max(120),
  section: z.enum(NEWS_SECTIONS).default('local'),
  kind: z.enum(NEWS_SOURCE_KINDS).default('feed'),
  adapter: z.enum(NEWS_ADAPTERS).default('feed'),
  // A discovery search builds its own from `config.query`.
  url: z.url({protocol: /^https?$/}).nullable().default(null),
  reads: z.string().trim().min(1).max(120).default('Feed'),
  config: z.record(z.string(), z.unknown()).default({}),
  summary_only: z.boolean().default(false),
  metered: z.boolean().default(false),
  interval_minutes: z.int().min(1).max(24 * 60).optional(),
  // N5: its tile in Settings › News; one not in NEWS_SOURCE_ICONS makes the list unreadable, as any bad field does.
  icon: z.enum(NEWS_SOURCE_ICONS).optional(),
});
export const localSourcesSchema = z.strictObject({
  about: z.string().optional(),
  sources: z.array(localSourceSchema),
});

/**
 * The data directory's local list, copied in first from the checkout's uncommitted one when it has
 * none. No list is no local feeds: the hazard APIs and everything else still run.
 */
export function readLocalSources(dataDir: string, repoFile: string | null = REPO_LOCAL_SOURCES): NewsSourceSpec[] {
  const file = path.join(dataDir, LOCAL_SOURCES_FILE);
  if (!fs.existsSync(file) && repoFile && fs.existsSync(repoFile)) {
    fs.mkdirSync(dataDir, {recursive: true});
    fs.copyFileSync(repoFile, file);
  }
  if (!fs.existsSync(file)) return [];
  const parsed = localSourcesSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) throw new Error(`${file}: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  const keys = parsed.data.sources.map(source => source.key);
  const repeated = keys.find((key, index) => keys.indexOf(key) !== index);
  if (repeated) throw new Error(`${file}: the key ${repeated} is used twice.`);
  return parsed.data.sources.map(source => ({
    key: `local:${source.key}`, name: source.name, section: source.section, kind: source.kind, adapter: source.adapter, url: source.url,
    reads: source.reads, config: source.config, summaryOnly: source.summary_only, metered: source.metered,
    ...(source.interval_minutes ? {intervalSeconds: source.interval_minutes * MINUTE} : {}), ...(source.icon ? {icon: source.icon} : {}),
  }));
}

/** A spec as a row's values (not its heartbeat). */
export const sourceValues = (spec: NewsSourceSpec, origin: 'default' | 'local', position: number) => ({
  key: spec.key, name: spec.name, section: spec.section, kind: spec.kind, adapter: spec.adapter, url: spec.url, reads: spec.reads,
  config: {...spec.config, ...(spec.icon ? {icon: spec.icon} : {})}, origin, summaryOnly: spec.summaryOnly ?? false, metered: spec.metered ?? false,
  intervalSeconds: spec.intervalSeconds ?? NEWS_INTERVALS[spec.kind], position,
});

/**
 * Registers the built-in and local lists, by key: new sources are added, changed ones updated, and
 * ones dropped from their list retired (their articles stay for the archive). `local` null leaves the
 * local ones as they are (a list that couldn't be read). A seeded database's stand-ins are left
 * alone, so `npm run dev` never registers a source a fetch could reach. Returns the sources added.
 */
export function ensureNewsSources(store: Store, local: NewsSourceSpec[] | null): number[] {
  return transaction(store, () => {
    if (seeded(store)) return [];
    const now = isoNow(store);
    const added: number[] = [];
    const lists = [['default', DEFAULT_NEWS_SOURCES], ['local', local]] as const;
    for (const [origin, specs] of lists) {
      if (!specs) continue;
      specs.forEach((spec, position) => {
        const values = sourceValues(spec, origin, position);
        const existing = store.db.select().from(t.newsSources).where(eq(t.newsSources.key, spec.key)).get();
        if (existing) store.db.update(t.newsSources).set({...values, retiredAt: null}).where(eq(t.newsSources.id, existing.id)).run();
        else added.push(store.db.insert(t.newsSources).values({...values, createdAt: now}).returning({id: t.newsSources.id}).get().id);
      });
      const keys = specs.map(spec => spec.key);
      store.db.update(t.newsSources).set({retiredAt: now})
        .where(and(eq(t.newsSources.origin, origin), isNull(t.newsSources.retiredAt), keys.length ? notInArray(t.newsSources.key, keys) : undefined)).run();
    }
    if (added.length) noteLive(store, {type: 'news', stories: [], sections: [], sources: added});
    return added;
  });
}

/** At start: the data directory's local list, then both lists registered. */
export function registerNewsSources(store: Store, dataDir: string, repoFile: string | null = REPO_LOCAL_SOURCES): number[] {
  if (seeded(store)) return [];
  let local: NewsSourceSpec[] | null = null;
  try {
    local = readLocalSources(dataDir, repoFile);
  } catch (error) {
    console.error(`News's local sources weren't read, so they stay as they were: ${error instanceof Error ? error.message : error}`);
  }
  return ensureNewsSources(store, local);
}

/** The seed's database: its stand-in sources are the whole list. */
const seeded = (store: Store) => store.db.select({id: t.newsSources.id}).from(t.newsSources).where(eq(t.newsSources.dev, true)).get() !== undefined;

// Settings › News's order within a section (board 30a): outlets' feeds and pages, the local list's
// first, then official data, then discovery.
const KIND_ORDER: NewsSourceKind[] = ['feed', 'page_read', 'official_api', 'discovery'];

/** The sources still on their lists, by section in Settings › News's order. */
export function activeNewsSources(store: Store, ids?: number[]) {
  return store.db.select().from(t.newsSources)
    .where(and(isNull(t.newsSources.retiredAt), ids ? inArray(t.newsSources.id, ids) : undefined)).all()
    .sort((a, b) => NEWS_SECTIONS.indexOf(a.section) - NEWS_SECTIONS.indexOf(b.section) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)
      || (a.origin === b.origin ? 0 : a.origin === 'local' ? -1 : 1) || a.position - b.position || a.id - b.id);
}
