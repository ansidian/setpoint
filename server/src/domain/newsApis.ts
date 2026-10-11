// News's sources that are APIs (N2; BRIEF.md › Sources): official data for hazards (National Weather
// Service alerts for the home location's zones, hazards only; USGS earthquakes, Cal Fire incidents
// and AirNow's air quality, each kept within its distance of the home point), whose data is the
// article's text, so they're never read as pages; and Hacker News stories over their points. Each
// source's JSON (AirNow's pipe-delimited file) comes in as documented; anything missing or malformed
// is left out rather than guessed at. Pure: JSON or text in, articles out.
import type {IngestedArticle} from './newsIngest.ts';
import {canonicalUrl, clip, distanceKm, inWindow, plainText, publishedInstant, revisionUrl, SUMMARY_MAX} from './newsIngest.ts';
import {zonedInstant} from './time.ts';

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Json : null);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : null);
const features = (json: unknown): Json[] => (Array.isArray(record(json)?.features) ? (record(json)!.features as unknown[]).flatMap((feature): Json[] => {
  const value = record(feature);
  return value ? [value] : [];
}) : []);

export interface Point {
  lat: number;
  lng: number;
}

// ---- National Weather Service ----

/**
 * The home point's zones, from /points/{lat},{lon}: its public forecast zone, its county and its
 * fire weather zone (Red Flag Warnings are issued for those), each once. Empty when the point is
 * outside NWS's area.
 */
export function nwsZones(json: unknown): string[] {
  const properties = record(record(json)?.properties);
  if (!properties) return [];
  const zones = ['forecastZone', 'county', 'fireWeatherZone']
    .map(key => /\/zones\/[a-z]+\/([A-Z]{2}[CZ]\d{3})$/i.exec(text(properties[key]))?.[1]?.toUpperCase() ?? null)
    .filter((zone): zone is string => zone !== null);
  return [...new Set(zones)];
}

/** NWS's coordinates: at most four decimals (more is a redirect), without trailing zeros. */
export const nwsPoint = (home: Point) => `${Number(home.lat.toFixed(4))},${Number(home.lng.toFixed(4))}`;

// Warnings and watches about the weather that aren't hazards in BRIEF's sense (fire, flood, storms,
// hurricanes, disasters): crops' frost and the sea's small craft.
const NOT_HAZARDS = /\b(frost|freeze|small craft|gale|hazardous seas|brisk wind|lake wind|marine|test)\b/i;

/**
 * Whether an alert is a hazard (BRIEF.md › What it covers: weather counts only as a hazard): every
 * warning, watch and emergency but crops' and the sea's, and an advisory or statement only when NWS
 * rates it severe or extreme.
 */
export function isHazardAlert(event: string, severity: string): boolean {
  if (!event || NOT_HAZARDS.test(event)) return false;
  if (/\b(warning|watch|emergency)\b/i.test(event)) return true;
  return severity === 'Severe' || severity === 'Extreme';
}

/** NWS writes its text hard-wrapped, paragraphs apart: as paragraphs separated by a blank line. */
const nwsParagraphs = (raw: string) => raw.split(/\n\s*\n/).map(paragraph => clip(paragraph.replace(/^\*\s*/, ''))).filter(Boolean).join('\n\n');

/**
 * The active alerts that are hazards: actual (not a test, exercise or draft), not a cancellation,
 * not yet over. Each update is its own alert with its own id, so a changed warning is a new
 * article. The alert's description and instructions are its text.
 */
export function nwsAlerts(json: unknown, now: string): IngestedArticle[] {
  return features(json).flatMap(feature => {
    const properties = record(feature.properties);
    if (!properties) return [];
    const event = text(properties.event);
    if (text(properties.status) !== 'Actual' || text(properties.messageType) === 'Cancel' || !isHazardAlert(event, text(properties.severity))) return [];
    const ends = text(properties.ends) || text(properties.expires);
    if (ends && Date.parse(ends) <= Date.parse(now)) return [];
    const url = text(properties['@id']) || text(feature.id);
    const publishedAt = publishedInstant(text(properties.sent) || text(properties.effective), now);
    if (!url || !publishedAt) return [];
    const description = nwsParagraphs(text(properties.description));
    const instruction = nwsParagraphs(text(properties.instruction));
    return [{
      url, canonicalUrl: canonicalUrl(url), outlet: 'National Weather Service', outletShort: 'NWS', byline: null,
      headline: text(properties.headline) || `${event} for ${text(properties.areaDesc)}`,
      feedSummary: clip(`${event}, ${text(properties.areaDesc)}`, SUMMARY_MAX), publishedAt, imageUrl: null,
      text: [description, instruction].filter(Boolean).join('\n\n') || null,
    }];
  });
}

// ---- USGS earthquakes ----

/**
 * Earthquakes from USGS's GeoJSON: at least the minimum magnitude, within the radius of home, in the
 * last 48 hours. A revised magnitude keeps its event page, so it isn't news again.
 */
export function usgsQuakes(json: unknown, home: Point, {minMagnitude, radiusKm}: {minMagnitude: number; radiusKm: number}, now: string): IngestedArticle[] {
  return features(json).flatMap(feature => {
    const properties = record(feature.properties);
    const coordinates = record(feature.geometry)?.coordinates;
    if (!properties || !Array.isArray(coordinates)) return [];
    const [lng, lat, depth] = coordinates.map(number);
    const magnitude = number(properties.mag);
    if (lat === null || lng === null || lat === undefined || lng === undefined || magnitude === null) return [];
    if (text(properties.type) && text(properties.type) !== 'earthquake') return [];
    if (magnitude < minMagnitude || distanceKm(home, {lat, lng}) > radiusKm) return [];
    const publishedAt = publishedInstant(number(properties.time), now);
    const url = text(properties.url);
    if (!publishedAt || !inWindow(publishedAt, now) || !url) return [];
    const place = text(properties.place);
    const lines = [
      `Magnitude ${magnitude.toFixed(1)}${place ? `, ${place}` : ''}${depth !== null && depth !== undefined ? `, ${Math.round(depth * 10) / 10} km deep` : ''}.`,
      number(properties.tsunami) === 1 ? 'A tsunami message was issued for it.' : null,
      text(properties.alert) ? `USGS's PAGER alert level is ${text(properties.alert)}.` : null,
    ];
    return [{
      url, canonicalUrl: canonicalUrl(url), outlet: 'USGS', outletShort: 'USGS', byline: null,
      headline: text(properties.title) || `M ${magnitude.toFixed(1)} earthquake${place ? `, ${place}` : ''}`,
      feedSummary: lines[0], publishedAt, imageUrl: null, text: lines.filter(Boolean).join(' '), lat, lng,
    }];
  });
}

// ---- Cal Fire ----

/** Cal Fire writes some times with a zone and some as California's wall clock. */
function calFireTime(raw: string, now: string): string | null {
  if (!raw) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw)) return publishedInstant(raw, now);
  const wall = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(raw);
  return wall ? publishedInstant(zonedInstant(wall[1]!, wall[2]!, 'America/Los_Angeles'), now) : null;
}

/**
 * Cal Fire's incidents with where each is: the GeoJSON list's features (GeoJsonList, the one read)
 * are the list's fields as properties with a Point at [lng, lat], and the older List is the fields
 * alone, as an array or under Incidents. A feature without a usable Point falls back to its own
 * Latitude and Longitude, and one with neither isn't placed.
 */
function calFireList(json: unknown): {incident: Json; lat: number | null; lng: number | null}[] {
  const placed = (incident: Json, point?: unknown) => {
    const coordinates = record(point)?.type === 'Point' ? record(point)!.coordinates : null;
    const [lng, lat] = Array.isArray(coordinates) ? coordinates.map(number) : [];
    return lat !== null && lat !== undefined && lng !== null && lng !== undefined
      ? {incident, lat, lng} : {incident, lat: number(incident.Latitude), lng: number(incident.Longitude)};
  };
  if (record(json)?.type === 'FeatureCollection') {
    return features(json).flatMap(feature => {
      const properties = record(feature.properties);
      return properties ? [placed(properties, feature.geometry)] : [];
    });
  }
  const list = Array.isArray(json) ? json : Array.isArray(record(json)?.Incidents) ? record(json)!.Incidents as unknown[] : [];
  return list.flatMap(item => (record(item) ? [placed(record(item)!)] : []));
}

/**
 * Active incidents from Cal Fire's list within the radius of home, updated in the last 48 hours.
 * A fire's acres and containment change in place, so each change is its own article (one revision
 * of the incident's page), which N3 groups into the fire's story as a new fact.
 */
export function calFireIncidents(json: unknown, home: Point, {radiusKm}: {radiusKm: number}, listUrl: string, now: string): IngestedArticle[] {
  return calFireList(json).flatMap(({incident, lat, lng}) => {
    if (incident.IsActive === false || incident.Final === true) return [];
    const name = text(incident.Name);
    if (lat === null || lng === null || !name || distanceKm(home, {lat, lng}) > radiusKm) return [];
    const publishedAt = calFireTime(text(incident.Updated), now) ?? calFireTime(text(incident.Started), now);
    if (!publishedAt || !inWindow(publishedAt, now)) return [];
    let url: string;
    try {
      url = new URL(text(incident.Url) || `/incidents/`, listUrl).toString();
    } catch {
      return [];
    }
    const acres = number(incident.AcresBurned);
    const contained = number(incident.PercentContained);
    const size = [acres !== null ? `${acres.toLocaleString('en-US')} acres` : null, contained !== null ? `${contained}% contained` : null].filter(Boolean).join(', ');
    const where = [text(incident.Location), text(incident.County) ? `${text(incident.County)} County` : ''].filter(Boolean).join(', ');
    const lines = [
      `${name}${where ? ` in ${where}` : ''}${size ? `: ${size}` : ''}.`,
      text(incident.Started) ? `Started ${text(incident.Started).slice(0, 10)}.` : null,
      text(incident.ControlStatement) ? plainText(text(incident.ControlStatement)) : null,
    ];
    return [{
      url, canonicalUrl: revisionUrl(url, `acres-${acres ?? 'unknown'}-contained-${contained ?? 'unknown'}`),
      outlet: 'Cal Fire', outletShort: 'Cal Fire', byline: null,
      headline: size ? `${name}: ${size}` : name, feedSummary: lines[0], publishedAt, imageUrl: null, text: lines.filter(Boolean).join(' '), lat, lng,
    }];
  });
}

// ---- AirNow ----

/** AirNow's zones as offsets (its file names the zone's abbreviation). */
const US_ZONES: Record<string, string> = {
  EST: '-05:00', EDT: '-04:00', CST: '-06:00', CDT: '-05:00', MST: '-07:00', MDT: '-06:00', PST: '-08:00', PDT: '-07:00',
  AKST: '-09:00', AKDT: '-08:00', HST: '-10:00', UTC: 'Z', GMT: 'Z',
};

/** The AQI's categories, in order: a category's number is its place here, from 1. */
const AQI_CATEGORIES = ['Good', 'Moderate', 'Unhealthy for Sensitive Groups', 'Unhealthy', 'Very Unhealthy', 'Hazardous'];
const AQI_BREAKS = [50, 100, 150, 200, 300];

/** The file's parameters as the summary names them. */
const POLLUTANTS: Record<string, string> = {OZONE: 'ozone'};

interface AirNowReading {
  area: string;
  state: string;
  lat: number;
  lng: number;
  // The local day (YYYY-MM-DD), hour (HH:MM) and zone the file gives, and the instant they make.
  date: string;
  hour: string;
  zone: string;
  at: string;
  pollutant: string;
  aqi: number;
  level: string;
  category: number;
}

/**
 * One line of AirNow's reporting-area file when it's a current hourly observation (`O`, not a
 * forecast or yesterday's) that can be read: issue date | valid date (MM/DD/YY) | valid time (HH:MM)
 * | zone | day offset | data type | primary | reporting area | state | latitude | longitude |
 * parameter | AQI | category | action day | discussion | agency. Anything else is null.
 */
function airNowReading(line: string, now: string): AirNowReading | null {
  const fields = line.split('|').map(field => field.trim());
  if (fields.length < 14 || fields[5] !== 'O') return null;
  const day = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(fields[1]!);
  const hour = /^\d{2}:\d{2}$/.test(fields[2]!) ? fields[2]! : null;
  const zone = fields[3]!.toUpperCase();
  const lat = number(fields[9]);
  const lng = number(fields[10]);
  const aqi = number(fields[12]);
  const area = fields[7]!;
  if (!day || !hour || !US_ZONES[zone] || lat === null || lng === null || aqi === null || aqi < 0 || !area) return null;
  const date = `20${day[3]}-${day[1]}-${day[2]}`;
  const at = publishedInstant(`${date}T${hour}:00${US_ZONES[zone]}`, now);
  if (!at) return null;
  const named = AQI_CATEGORIES.indexOf(fields[13]!) + 1;
  const category = named || AQI_BREAKS.filter(top => aqi > top).length + 1;
  const parameter = fields[11]!;
  return {
    area, state: fields[8]!, lat, lng, date, hour, zone, at, pollutant: POLLUTANTS[parameter.toUpperCase()] ?? parameter,
    aqi: Math.round(aqi), level: AQI_CATEGORIES[category - 1]!, category,
  };
}

/** Whether a body is AirNow's reporting-area file: some line of it has the file's fields. */
export const isAirNowFile = (file: string) => file.split(/\r?\n/).some(line => line.split('|').length >= 14);

/**
 * Unhealthy air near home from AirNow's reporting-area file (pipe-delimited, hourly; a byte-order
 * mark and CRLF line endings are allowed). Only current hourly observations count. Each reporting
 * area within the radius is taken at its latest hour and its worst pollutant then, and is news when
 * that AQI is at least the minimum. One article per area, day and AQI category, so a worsening day is
 * news and an hourly reading at the same level isn't. Lines that can't be read are skipped.
 */
export function airNowReportingAreas(file: string, home: Point, {radiusKm, minAqi}: {radiusKm: number; minAqi: number}, now: string): IngestedArticle[] {
  const latest = new Map<string, AirNowReading>();
  for (const line of file.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const reading = airNowReading(line, now);
    if (!reading || distanceKm(home, reading) > radiusKm) continue;
    const key = `${reading.area}|${reading.state}`;
    const kept = latest.get(key);
    const later = kept ? Date.parse(reading.at) - Date.parse(kept.at) : 1;
    if (later > 0 || (later === 0 && reading.aqi > kept!.aqi)) latest.set(key, reading);
  }
  return [...latest.values()].flatMap(reading => {
    if (reading.aqi < minAqi || !inWindow(reading.at, now)) return [];
    const {area, state, aqi, level, pollutant} = reading;
    const url = `https://www.airnow.gov/?${new URLSearchParams({city: area, state, country: 'USA'}).toString()}`;
    const line = `${level} air in ${area}${state ? `, ${state}` : ''}: AQI ${aqi}${pollutant ? ` (${pollutant})` : ''}.`;
    return [{
      url, canonicalUrl: revisionUrl(url, `${reading.date}-aqi-category-${reading.category}`),
      outlet: 'AirNow', outletShort: 'AirNow', byline: null, headline: `${level} air quality in ${area}, AQI ${aqi}`, feedSummary: line, publishedAt: reading.at, imageUrl: null,
      text: `${line} AirNow's reading for ${reading.date} at ${reading.hour} ${reading.zone}.`, lat: reading.lat, lng: reading.lng,
    }];
  });
}

// ---- Hacker News ----

/**
 * Stories from Algolia's Hacker News search with at least the points, in the last 48 hours: the
 * story's own link (or its discussion, for a text post), and its points and comments as its summary.
 * Whether one is about tech or AI is N3's to judge.
 */
export function hnStories(json: unknown, {minPoints}: {minPoints: number}, now: string): IngestedArticle[] {
  const hits = record(json)?.hits;
  return (Array.isArray(hits) ? hits : []).flatMap(item => {
    const hit = record(item);
    const id = text(hit?.objectID);
    const title = text(hit?.title);
    const points = number(hit?.points);
    if (!hit || !id || !title || points === null || points < minPoints) return [];
    const publishedAt = publishedInstant(text(hit.created_at) || (number(hit.created_at_i) ?? 0) * 1000 || null, now);
    if (!publishedAt || !inWindow(publishedAt, now)) return [];
    const discussion = `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;
    const url = /^https?:\/\//i.test(text(hit.url)) ? text(hit.url) : discussion;
    const comments = number(hit.num_comments);
    // A text post (Ask HN) is its own text; a link's is read from its page.
    const storyText = plainText(text(hit.story_text));
    return [{
      url, canonicalUrl: canonicalUrl(url), outlet: 'Hacker News', outletShort: 'HN', byline: null, headline: plainText(title), publishedAt, imageUrl: null,
      feedSummary: storyText ? clip(storyText, SUMMARY_MAX) : `${points} points${comments !== null ? `, ${comments} comments` : ''} on Hacker News.`,
      ...(storyText ? {text: storyText} : {}),
    }];
  });
}
