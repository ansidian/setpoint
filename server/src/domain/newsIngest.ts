// News ingest's rules (N2; BRIEF.md › News › Sources, When things break): an article's canonical URL,
// feed text made plain, the 48 hours a read fills, distances from the home location, which hosts a
// read may reach, what each article is read for, which images are worth copying, how a refusal is
// retried, and a page's text decoded by its charset. Pure, so each is tested as a table. Canonical
// URLs and plain text are adapted from v1's server/news/news-model.ts (harvest notes on SV-45).
import {Element, Text} from 'domhandler';
import type {ChildNode} from 'domhandler';
import {parseDocument} from 'htmlparser2';
import {STORY_TTL_MS} from './news.ts';
import type {ProviderErrorKind} from './retry.ts';
import {localDay, zonedInstant} from './time.ts';

/** An article as an adapter gives it to the store (src/news/adapter.ts's FetchedArticle). */
export interface IngestedArticle {
  url: string;
  canonicalUrl: string;
  outlet: string;
  outletShort?: string | null;
  byline?: string | null;
  headline: string;
  feedSummary?: string | null;
  publishedAt: string;
  imageUrl?: string | null;
  discovery?: boolean;
  // The text the source gave with it (an alert's description), kept instead of reading a page.
  text?: string | null;
  // Where it is, when official data says (a quake, a fire, an air reading): Local's closeness (N3).
  lat?: number | null;
  lng?: number | null;
}

// ---- Canonical URLs ----

// Query parameters that only say where a click came from. v1 stripped utm_*, fbclid, gclid, mc_cid,
// mc_eid and ref; the rest are other trackers outlets add to feed and share links.
const TRACKING = /^(utm_.+|fbclid|gclid|gclsrc|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|_ga|_gl|ref|ref_src|ref_url|cmpid|s_cid|ocid|smid|taid|at_medium|at_campaign|mkt_tok|sr_share|__twitter_impression)$/i;

/**
 * The URL an article is kept unique by: tracking parameters and the fragment gone, the rest sorted,
 * the host lower-case without `www.` or a trailing dot, and no trailing slash. Something that isn't
 * a URL is kept as it was, trimmed (v1).
 */
export function canonicalUrl(raw: string): string {
  const text = raw.trim();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return text;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return text;
  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING.test(key)).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const host = url.host.toLowerCase().replace(/^www\./, '').replace(/\.(?=:|$)/, '');
  const search = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  return `${url.protocol}//${host}${url.pathname.replace(/\/+$/, '')}${search}`;
}

/**
 * The canonical URL of one revision of an official record that changes in place (a fire's acres and
 * containment, an air quality reading's level): each revision is its own article, so N3 sees the
 * new fact, while `url` stays the record's page.
 */
export const revisionUrl = (url: string, revision: string) => `${canonicalUrl(url)}#${revision.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '')}`;

// ---- Plain text ----

const BLOCKS = new Set(['p', 'div', 'br', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'td', 'th', 'table', 'section', 'article', 'figure', 'figcaption', 'pre', 'hr', 'dd', 'dt']);
const SILENT = new Set(['script', 'style', 'noscript', 'template', 'head', 'title']);

function collect(nodes: readonly ChildNode[], out: string[]) {
  for (const node of nodes) {
    if (node instanceof Text) out.push(node.data);
    else if (node instanceof Element) {
      const name = node.name.toLowerCase();
      if (SILENT.has(name)) continue;
      const block = BLOCKS.has(name);
      if (block) out.push(' ');
      collect(node.children, out);
      if (block) out.push(' ');
    } else if ('children' in node) collect((node as {children: ChildNode[]}).children, out);
  }
}

/** Text with its whitespace collapsed, cut at a word with "…" past `maxChars` (v1's excerpt). */
export function clip(text: string, maxChars = Infinity): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * HTML (a feed's description, an Atom summary) as plain text: tags gone, entities decoded, blocks
 * apart, whitespace collapsed, and cut at a word with "…" past `maxChars` (v1's excerpt, which
 * stripped tags with a regular expression and knew six entities).
 */
export function plainText(html: string | null | undefined, maxChars = Infinity): string {
  if (!html) return '';
  const out: string[] = [];
  collect(parseDocument(html).children, out);
  return clip(out.join(''), maxChars);
}

/** A feed summary's longest: enough for the summary-only view and N3's notes. */
export const SUMMARY_MAX = 1000;

// ---- The 48 hours ----

/** A read keeps what was published in the last 48 hours, so the first run fills them (BRIEF.md › Sources). */
export const FILL_MS = STORY_TTL_MS;

/** A published time as an instant: unreadable is null, and the future (a feed's wrong zone) is now. */
export function publishedInstant(raw: string | number | null | undefined, now: string): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const at = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return at > Date.parse(now) ? now : new Date(at).toISOString();
}

export const inWindow = (publishedAt: string, now: string) => Date.parse(publishedAt) >= Date.parse(now) - FILL_MS;

/** A page's date: an instant when it gave a time, or only a day. */
export type PostDate = {kind: 'instant'; at: string} | {kind: 'day'; date: string};

/**
 * When a post on a page read was published, or null to leave it out. A dated post is kept within the
 * 48 hours (a day counts from the day 48 hours ago, in the user's zone); a day that's today is now, an
 * earlier one its noon. An undated post can't be told from an old one on the first read, so that read
 * only notes it; on later reads it's new on the page, so now.
 */
export function postedAt(date: PostDate | null, now: string, timeZone: string, firstRead: boolean): string | null {
  if (!date) return firstRead ? null : now;
  if (date.kind === 'instant') {
    const at = publishedInstant(date.at, now);
    return at && inWindow(at, now) ? at : null;
  }
  const today = localDay(now, timeZone);
  if (date.date < localDay(Date.parse(now) - FILL_MS, timeZone)) return null;
  if (date.date >= today) return now;
  return zonedInstant(date.date, '12:00', timeZone);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date as a page writes it: an ISO date or instant ("2026-10-08", "2026-10-08T17:00:00Z"), or
 * "October 8, 2026", "Oct 8, 2026", "8 Oct 2026", with or without a weekday. Null when it isn't one.
 */
export function readDate(raw: string | null | undefined): PostDate | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text.length > 60) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (iso) {
    if (!iso[4]) return validDay(+iso[1]!, +iso[2]!, +iso[3]!);
    const at = Date.parse(iso[5] ? text.replace(' ', 'T') : `${text.replace(' ', 'T')}Z`);
    return Number.isFinite(at) ? {kind: 'instant', at: new Date(at).toISOString()} : null;
  }
  const words = text.replace(/^[A-Za-z]+,\s*/, '').replace(/,/g, ' ').replace(/(\d)(st|nd|rd|th)\b/gi, '$1').split(/\s+/);
  let month = -1;
  let day = 0;
  let year = 0;
  for (const word of words) {
    const name = MONTHS.indexOf(word.slice(0, 3).toLowerCase());
    if (name >= 0 && /^[A-Za-z]+\.?$/.test(word)) month = name + 1;
    else if (/^\d{4}$/.test(word)) year = +word;
    else if (/^\d{1,2}$/.test(word)) day = +word;
    else return null;
  }
  return month > 0 && day > 0 && year > 0 ? validDay(year, month, day) : null;
}

function validDay(year: number, month: number, day: number): PostDate | null {
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null;
  return {kind: 'day', date: at.toISOString().slice(0, 10)};
}

// ---- Distance ----

/** The great-circle distance between two points, in km. */
export function distanceKm(a: {lat: number; lng: number}, b: {lat: number; lng: number}): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A number from a source's config, or the fallback when it's missing or not a positive number. */
export function configNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

// ---- Hosts a read may reach ----

function privateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/**
 * Whether a read may fetch a URL: http(s) on a public host. A feed's links come from outside, so
 * none may point Setpoint at the home network: no loopback, private, link-local or carrier-grade
 * NAT address (a tailnet), no single-label or .local, .internal, .localhost or .ts.net name.
 */
export function isPublicUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    const ip = host.slice(1, -1);
    if (ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip)) return false;
    // An IPv4 address mapped into IPv6, which URL writes in hex (::ffff:c0a8:101 is 192.168.1.1).
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
    if (!mapped) return true;
    const [high, low] = [parseInt(mapped[1]!, 16), parseInt(mapped[2]!, 16)];
    return !privateIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (/^[\d.]+$/.test(host)) return !privateIpv4(host);
  if (!host.includes('.')) return false;
  return !/\.(local|internal|localhost|home\.arpa|ts\.net|lan)$/.test(host);
}

// ---- What an article is read for ----

export interface ReadingPlan {
  // Fetch the article's page for its text and og:image.
  page: boolean;
  // Copy an image (the feed's, or the page's when it's read).
  image: boolean;
}

/**
 * What a new article is read for (BRIEF.md › Sources; D89):
 * - found only (Google News): nothing, never read;
 * - a metered paper's: nothing, it only counts toward and confirms stories;
 * - summary only (KTLA, OpenAI block automated reading): its feed's image, never its page;
 * - one that came with its text (official data): its feed's image;
 * - the rest: its page, for the text and the image.
 */
export function readingPlan(article: {discovery: boolean; metered: boolean; summaryOnly: boolean; hasText: boolean}): ReadingPlan {
  if (article.discovery || article.metered) return {page: false, image: false};
  if (article.summaryOnly || article.hasText) return {page: false, image: true};
  return {page: true, image: true};
}

/** Below a row's thumbnail, or a strip (a banner, a spacer), an image isn't worth copying. */
export function usableImage(width: number, height: number): boolean {
  if (width < 144 || height < 96) return false;
  const ratio = width / height;
  return ratio >= 0.5 && ratio <= 3;
}

// ---- Refusals ----

/**
 * How a source's refusal is retried, by the one policy (src/domain/retry.ts): as any provider's
 * (src/sync/errors.ts's kindOfStatus), except that a 503 asking for a pause with Retry-After is
 * rate limited too, so the policy waits as long as it asks. A 401 or 403 is the source saying no to
 * reading (no account to reconnect), so permanent.
 */
export function kindOfNewsStatus(status: number, retryAfter: boolean): ProviderErrorKind {
  if (status === 429 || (status === 503 && retryAfter)) return 'rate_limited';
  if (status >= 500 || status === 408) return 'transient';
  return 'permanent';
}

// ---- Charsets ----

/**
 * A response's text in its charset: the Content-Type's, else the XML declaration's or the page's
 * <meta charset>, else UTF-8 (a label TextDecoder doesn't know is UTF-8 too).
 */
export function decodeText(bytes: Uint8Array, contentType: string | null): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const label = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1]
    ?? /^<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)/i.exec(head.trimStart())?.[1]
    ?? /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1]
    ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** The outlet a source's articles name: its config's, else its name before " · " ("KTLA · Local news" is KTLA). */
export function outletOf(name: string, config: Record<string, unknown>): {outlet: string; outletShort: string | null} {
  const outlet = typeof config.outlet === 'string' && config.outlet.trim() ? config.outlet.trim() : name.split(' · ')[0]!.trim();
  const short = typeof config.outlet_short === 'string' && config.outlet_short.trim() ? config.outlet_short.trim() : null;
  return {outlet, outletShort: short};
}
