// News's API sources (N2; BRIEF.md › Sources): the hazards' official data, each asked about the home
// location in Settings › Calendar (NWS alerts for its zones, found from the point; USGS, Cal Fire and
// AirNow within their radius), and Hacker News through Algolia over its points. A hazard source isn't
// ready, so isn't read, until the home location is set. AirNow's is its free hourly reporting-area
// file, which needs no key (its observations web service was retired on 2026-10-01).
import {getSettings} from '../../settings.ts';
import {airNowReportingAreas, calFireIncidents, hnStories, isAirNowFile, nwsAlerts, nwsPoint, nwsZones, usgsQuakes} from '../../domain/newsApis.ts';
import {configNumber, FILL_MS} from '../../domain/newsIngest.ts';
import type {NewsAdapter, NewsFetchContext, NewsSourceRow} from '../../news/adapter.ts';
import type {Store} from '../../store.ts';
import {ProviderError} from '../../sync/errors.ts';
import {readValidators} from './feeds.ts';
import type {Validators} from './feeds.ts';
import {hostOf, newsGet, newsGetJson, responseText} from './http.ts';
import type {NewsHttpOptions} from './http.ts';

const hasHome = (store: Store) => getSettings(store).calendar.home !== null;

function base(source: NewsSourceRow): string {
  if (!source.url) throw new ProviderError('permanent', 'This source has no address.');
  return source.url;
}

/** The home point, which a ready hazard source always has. */
function home(context: NewsFetchContext) {
  if (!context.home) throw new ProviderError('permanent', 'Set Home in Settings › Calendar for the hazards near it.');
  return {lat: context.home.lat, lng: context.home.lng};
}

const now = (context: NewsFetchContext) => context.store.now().toISOString();

// ---- National Weather Service ----

const GEO_JSON = 'application/geo+json, application/json;q=0.9';

interface NwsCursor {
  point: string;
  zones: string[];
}

function readNwsCursor(cursor: string | null): NwsCursor | null {
  try {
    const parsed = JSON.parse(cursor ?? 'null') as Partial<NwsCursor> | null;
    return parsed && typeof parsed.point === 'string' && Array.isArray(parsed.zones) ? {point: parsed.point, zones: parsed.zones.filter(zone => typeof zone === 'string')} : null;
  } catch {
    return null;
  }
}

/**
 * NWS alerts for the home location's zones: the point's zones are found once (/points) and kept in
 * the cursor until Home moves, then each zone's active alerts are read, each alert once.
 */
export function nwsAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    ready: store => hasHome(store),
    async fetch(context, cursor) {
      const root = base(context.source).replace(/\/+$/, '');
      const point = nwsPoint(home(context));
      const request = {userAgent: context.userAgent, signal: context.signal, accept: GEO_JSON};
      const kept = readNwsCursor(cursor);
      let zones = kept?.point === point ? kept.zones : null;
      if (!zones?.length) {
        zones = nwsZones(await newsGetJson(options, {...request, url: `${root}/points/${point}`}));
        if (!zones.length) throw new ProviderError('permanent', 'The National Weather Service has no zone for Home.');
      }
      const seen = new Set<string>();
      const articles = [];
      for (const zone of zones) {
        for (const article of nwsAlerts(await newsGetJson(options, {...request, url: `${root}/alerts/active/zone/${encodeURIComponent(zone)}`}), now(context))) {
          if (seen.has(article.canonicalUrl)) continue;
          seen.add(article.canonicalUrl);
          articles.push(article);
        }
      }
      return {articles, cursor: JSON.stringify({point, zones} satisfies NwsCursor)};
    },
  };
}

// ---- USGS earthquakes ----

/** USGS's earthquakes near home in the last 48 hours, at least the minimum magnitude (config). */
export function usgsAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    ready: store => hasHome(store),
    async fetch(context) {
      const at = home(context);
      const config = {minMagnitude: configNumber(context.source.config, 'minMagnitude', 3), radiusKm: configNumber(context.source.config, 'radiusKm', 100)};
      const url = new URL(base(context.source));
      url.search = new URLSearchParams({
        format: 'geojson', eventtype: 'earthquake', orderby: 'time', starttime: new Date(context.store.now().getTime() - FILL_MS).toISOString(),
        latitude: String(at.lat), longitude: String(at.lng), maxradiuskm: String(config.radiusKm), minmagnitude: String(config.minMagnitude),
      }).toString();
      const json = await newsGetJson(options, {url: url.toString(), userAgent: context.userAgent, signal: context.signal, accept: GEO_JSON});
      return {articles: usgsQuakes(json, at, config, now(context)), cursor: null};
    },
  };
}

// ---- Cal Fire ----

/** Cal Fire's active incidents within the radius of home (config), from its GeoJSON list. */
export function calFireAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    ready: store => hasHome(store),
    async fetch(context) {
      const url = base(context.source);
      const json = await newsGetJson(options, {url, userAgent: context.userAgent, signal: context.signal});
      return {articles: calFireIncidents(json, home(context), {radiusKm: configNumber(context.source.config, 'radiusKm', 80)}, url, now(context)), cursor: null};
    },
  };
}

// ---- AirNow ----

/**
 * Unhealthy air near home from AirNow's reporting-area file (config: radius, minimum AQI). The file
 * (about 2 MB, under newsGet's 5 MB cap) changes hourly, so it's a conditional GET with its
 * validators as the cursor, as a feed's are: an unchanged file is a 304, healthy with nothing new.
 */
export function airNowAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    ready: store => hasHome(store),
    async fetch(context, cursor) {
      const at = home(context);
      const config = {radiusKm: configNumber(context.source.config, 'radiusKm', 40), minAqi: configNumber(context.source.config, 'minAqi', 151)};
      const response = await newsGet(options, {url: base(context.source), userAgent: context.userAgent, signal: context.signal, accept: 'text/plain, */*;q=0.5', ...readValidators(cursor)});
      if (response.status === 304) return {articles: [], cursor: null};
      const file = responseText(response);
      // Something else (an error page) would read as clean air: failing instead.
      if (!isAirNowFile(file)) throw new ProviderError('permanent', `${hostOf(response.url)} didn't send AirNow's reporting-area file.`, {status: response.status});
      const next: Validators = {etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified')};
      return {articles: airNowReportingAreas(file, at, config, now(context)), cursor: JSON.stringify(next)};
    },
  };
}

// ---- Hacker News ----

/** Hacker News stories through Algolia's search, over the points threshold (config), in the last 48 hours. */
export function hnAdapter(options: NewsHttpOptions = {}): NewsAdapter {
  return {
    async fetch(context) {
      const minPoints = configNumber(context.source.config, 'minPoints', 300);
      const since = Math.floor((context.store.now().getTime() - FILL_MS) / 1000);
      const url = new URL(base(context.source));
      const query = typeof context.source.config.query === 'string' ? context.source.config.query.trim() : '';
      url.search = new URLSearchParams({
        tags: 'story', numericFilters: `points>=${minPoints},created_at_i>${since}`, hitsPerPage: '100', ...(query ? {query} : {}),
      }).toString();
      const json = await newsGetJson(options, {url: url.toString(), userAgent: context.userAgent, signal: context.signal});
      return {articles: hnStories(json, {minPoints}, now(context)), cursor: null};
    },
  };
}
