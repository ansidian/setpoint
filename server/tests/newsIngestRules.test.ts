// News ingest's pure rules as tables (N2): canonical URLs (v1's cases kept), plain text, the 48
// hours and page dates, distances, the hosts a read may reach, what an article is read for, which
// images are worth copying, how a refusal is retried, charsets, outlets and which NWS alerts are
// hazards.
import {SEED_NOW} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {isHazardAlert, nwsPoint, nwsZones} from '../src/domain/newsApis.ts';
import {
  canonicalUrl, clip, decodeText, distanceKm, inWindow, isPublicUrl, kindOfNewsStatus, outletOf, plainText, postedAt, publishedInstant, readDate,
  readingPlan, revisionUrl, usableImage,
} from '../src/domain/newsIngest.ts';
import {retryAfterFailure} from '../src/domain/retry.ts';
import {retryAfterMs} from '../src/providers/http.ts';

const NOW = SEED_NOW; // 2026-10-07T16:12Z, 9:12 AM in Los Angeles
const ZONE = 'America/Los_Angeles';

describe('canonical URLs', () => {
  test.each([
    // v1's cases.
    ['tracking, the fragment, www and the trailing slash go', 'https://www.example.com/a/b/?utm_source=rss&utm_medium=feed#comments', 'https://example.com/a/b'],
    ['a meaningful parameter stays', 'https://example.com/watch?v=abc123&utm_campaign=x', 'https://example.com/watch?v=abc123'],
    ['something that isn\'t a URL is kept, trimmed', ' not a url ', 'not a url'],
    // v2's.
    ['the other trackers go', 'https://example.com/story?fbclid=1&gclid=2&mc_cid=3&mc_eid=4&ref=hn&igshid=5&ocid=6&smid=7&_ga=8', 'https://example.com/story'],
    ['the rest are sorted', 'https://example.com/s?b=2&a=1', 'https://example.com/s?a=1&b=2'],
    ['the host is lower case, without a trailing dot', 'https://NEWS.Example.COM./Story', 'https://news.example.com/Story'],
    ['the root has no slash', 'https://example.com/', 'https://example.com'],
    ['a default port goes, another stays', 'https://example.com:443/a', 'https://example.com/a'],
    ['another port stays', 'http://example.com:8080/a/', 'http://example.com:8080/a'],
    ['a scheme that isn\'t the web is kept', 'mailto:desk@example.com', 'mailto:desk@example.com'],
    ['several trailing slashes go', 'https://example.com/a//', 'https://example.com/a'],
  ])('%s', (_, raw, expected) => {
    expect(canonicalUrl(raw)).toBe(expected);
  });

  test('a revision keeps the record\'s page and adds what changed', () => {
    expect(revisionUrl('https://www.example.org/incidents/2026/fire/?utm_source=x', 'acres-400-contained-10')).toBe('https://example.org/incidents/2026/fire#acres-400-contained-10');
    expect(revisionUrl('https://example.org/a', '2026-10-07 AQI Category 4')).toBe('https://example.org/a#2026-10-07-aqi-category-4');
  });
});

describe('plain text', () => {
  test.each([
    // v1's.
    ['tags and entities go, whitespace collapses', '<p>Hello <b>world</b> &amp; friends</p>\n\n  more', Infinity, 'Hello world & friends more'],
    ['nothing is empty', null, Infinity, ''],
    // v2's: blocks stay apart, every entity is read, scripts say nothing.
    ['blocks stay apart', '<p>One.</p><p>Two.</p><ul><li>Three</li></ul>', Infinity, 'One. Two. Three'],
    ['every entity', 'It&rsquo;s 5&nbsp;&deg; &#8211; &#x2014; cooler', Infinity, 'It’s 5 ° – — cooler'],
    ['scripts and styles say nothing', '<style>p{}</style><script>alert(1)</script><p>Text</p>', Infinity, 'Text'],
    ['plain text stays', 'Already plain', Infinity, 'Already plain'],
    ['cut at a word, with an ellipsis', `<p>${'word '.repeat(100)}</p>`, 52, `${'word '.repeat(10).trim()}…`],
  ])('%s', (_, html, max, expected) => {
    expect(plainText(html, max)).toBe(expected);
  });

  test('a word longer than the cut is cut where it must be (v1)', () => {
    expect(clip('x'.repeat(100), 30)).toBe(`${'x'.repeat(30)}…`);
  });
});

describe('the 48 hours', () => {
  test.each([
    ['a time with a zone', 'Wed, 07 Oct 2026 14:05:00 +0000', '2026-10-07T14:05:00.000Z'],
    ['ISO', '2026-10-07T07:05:00-07:00', '2026-10-07T14:05:00.000Z'],
    ['epoch ms', 1791374400000, '2026-10-07T12:00:00.000Z'],
    ['the future is now (a feed in the wrong zone)', '2026-10-07T23:00:00Z', NOW],
    ['unreadable', 'yesterday-ish', null],
    ['none', null, null],
  ])('a published time: %s', (_, raw, expected) => {
    expect(publishedInstant(raw, NOW)).toBe(expected);
  });

  test.each([
    ['now', NOW, true],
    ['47 hours ago', '2026-10-05T17:12:00.000Z', true],
    ['exactly 48 hours ago', '2026-10-05T16:12:00.000Z', true],
    ['49 hours ago', '2026-10-05T15:12:00.000Z', false],
  ])('in the window: %s', (_, at, expected) => {
    expect(inWindow(at, NOW)).toBe(expected);
  });

  test.each([
    ['ISO day', '2026-10-08', {kind: 'day', date: '2026-10-08'}],
    ['ISO instant', '2026-10-06T17:00:00Z', {kind: 'instant', at: '2026-10-06T17:00:00.000Z'}],
    ['ISO time without a zone is UTC', '2026-10-06T17:00:00', {kind: 'instant', at: '2026-10-06T17:00:00.000Z'}],
    ['month name', 'October 8, 2026', {kind: 'day', date: '2026-10-08'}],
    ['short month', 'Oct 8, 2026', {kind: 'day', date: '2026-10-08'}],
    ['day first', '8 Oct 2026', {kind: 'day', date: '2026-10-08'}],
    ['with a weekday', 'Thursday, October 8, 2026', {kind: 'day', date: '2026-10-08'}],
    ['an ordinal', 'October 8th, 2026', {kind: 'day', date: '2026-10-08'}],
    ['September', 'Sept 2, 2026', {kind: 'day', date: '2026-09-02'}],
    ['no year', 'Oct 8', null],
    ['not a day', 'February 30, 2026', null],
    ['a sentence', 'Our most capable model yet, out today', null],
    ['a word', 'Policy', null],
  ])('a page\'s date: %s', (_, raw, expected) => {
    expect(readDate(raw)).toEqual(expected);
  });

  test.each([
    ['a time in the 48 hours is itself', {kind: 'instant', at: '2026-10-06T17:00:00.000Z'} as const, true, '2026-10-06T17:00:00.000Z'],
    ['a time before them is left out', {kind: 'instant', at: '2026-10-04T17:00:00.000Z'} as const, false, null],
    ['today is now', {kind: 'day', date: '2026-10-07'} as const, true, NOW],
    ['yesterday is its noon, local', {kind: 'day', date: '2026-10-06'} as const, true, '2026-10-06T19:00:00.000Z'],
    ['the day 48 hours ago is in', {kind: 'day', date: '2026-10-05'} as const, false, '2026-10-05T19:00:00.000Z'],
    ['the day before is out', {kind: 'day', date: '2026-10-04'} as const, false, null],
    ['undated on the first read is only noted', null, true, null],
    ['undated on a later read is new on the page', null, false, NOW],
  ])('when a page\'s post was published: %s', (_, date, firstRead, expected) => {
    expect(postedAt(date, NOW, ZONE, firstRead)).toBe(expected);
  });
});

describe('distances', () => {
  test.each([
    ['the same point', {lat: 34.05, lng: -118.25}, {lat: 34.05, lng: -118.25}, 0, 0],
    ['a tenth of a degree north', {lat: 34.05, lng: -118.25}, {lat: 34.15, lng: -118.25}, 11.1, 0.1],
    ['Los Angeles to San Francisco', {lat: 34.05, lng: -118.25}, {lat: 37.77, lng: -122.42}, 559, 3],
  ])('%s', (_, a, b, km, within) => {
    expect(Math.abs(distanceKm(a, b) - km)).toBeLessThanOrEqual(within);
  });
});

describe('the hosts a read may reach', () => {
  test.each([
    ['a public site', 'https://www.example.com/news', true],
    ['http too', 'http://example.org/a', true],
    ['a public address', 'http://93.184.215.14/a', true],
    ['loopback', 'http://127.0.0.1:8080/a', false],
    ['localhost', 'http://localhost/a', false],
    ['the home network', 'http://192.168.1.20/admin', false],
    ['a private 10/8', 'http://10.0.0.5/', false],
    ['172.16/12', 'http://172.20.1.1/', false],
    ['link-local', 'http://169.254.169.254/latest/meta-data', false],
    ['a tailnet address (100.64/10)', 'http://100.101.102.103/', false],
    ['a tailnet name', 'https://box.tail1234.ts.net/', false],
    ['a single-label name', 'http://router/', false],
    ['.local', 'http://printer.local/', false],
    ['.internal', 'http://ha.internal/', false],
    ['IPv6 loopback', 'http://[::1]/', false],
    ['IPv6 unique local', 'http://[fd12:3456::1]/', false],
    ['IPv4 mapped in IPv6', 'http://[::ffff:192.168.1.1]/', false],
    ['not the web', 'file:///etc/passwd', false],
    ['not a URL', 'nope', false],
  ])('%s', (_, url, expected) => {
    expect(isPublicUrl(url)).toBe(expected);
  });
});

describe('what a new article is read for (D89)', () => {
  test.each([
    ['an outlet\'s article: its page and its image', {discovery: false, metered: false, summaryOnly: false, hasText: false}, {page: true, image: true}],
    ['summary only: its feed\'s image, never its page', {discovery: false, metered: false, summaryOnly: true, hasText: false}, {page: false, image: true}],
    ['came with its text (official data): its image only', {discovery: false, metered: false, summaryOnly: false, hasText: true}, {page: false, image: true}],
    ['a metered paper\'s: nothing', {discovery: false, metered: true, summaryOnly: false, hasText: false}, {page: false, image: false}],
    ['metered and summary only: nothing', {discovery: false, metered: true, summaryOnly: true, hasText: false}, {page: false, image: false}],
    ['found only (Google News): nothing', {discovery: true, metered: false, summaryOnly: false, hasText: false}, {page: false, image: false}],
  ])('%s', (_, article, plan) => {
    expect(readingPlan(article)).toEqual(plan);
  });

  test.each([
    ['a photo', 1200, 675, true],
    ['exactly a thumbnail', 144, 96, true],
    ['smaller than a thumbnail', 120, 80, false],
    ['a tracking pixel', 1, 1, false],
    ['a banner', 1200, 200, false],
    ['a tall portrait', 600, 900, true],
    ['a strip', 200, 800, false],
  ])('an image worth copying: %s', (_, width, height, expected) => {
    expect(usableImage(width, height)).toBe(expected);
  });
});

describe('a refusal, by the one retry policy', () => {
  test.each([
    ['404 is permanent: the feed is gone', 404, false, 'permanent'],
    ['410', 410, false, 'permanent'],
    ['401 is permanent: there\'s no account to reconnect', 401, false, 'permanent'],
    ['403', 403, false, 'permanent'],
    ['429 is rate limited', 429, false, 'rate_limited'],
    ['429 with Retry-After', 429, true, 'rate_limited'],
    ['503 with Retry-After asks for a pause', 503, true, 'rate_limited'],
    ['503 without is transient', 503, false, 'transient'],
    ['500', 500, false, 'transient'],
    ['408', 408, false, 'transient'],
  ])('%s', (_, status, retryAfter, kind) => {
    expect(kindOfNewsStatus(status, retryAfter)).toBe(kind);
  });

  // v1's parseRetryAfterAt cases, against the one Retry-After reader every provider shares.
  test.each([
    ['delta seconds', '90', 90_000],
    ['an HTTP date', 'Wed, 07 Oct 2026 16:17:00 GMT', 5 * 60_000],
    ['a date already past is no wait', 'Wed, 07 Oct 2026 16:11:00 GMT', 0],
    ['not a window', 'not-a-window', null],
    ['none', null, null],
  ])('Retry-After: %s', (_, header, expected) => {
    expect(retryAfterMs(header, Date.parse(NOW))).toBe(expected);
  });

  test('a Retry-After past any sense waits the policy\'s longest, 30 minutes (v1 dropped one past the Date range)', () => {
    expect(retryAfterFailure('rate_limited', 1, retryAfterMs('8640000000001', Date.parse(NOW)))).toEqual({retry: true, delayMs: 30 * 60_000});
  });

  test('a 429 or 503 is retried after its Retry-After when that\'s longer than the backoff', () => {
    expect(retryAfterFailure(kindOfNewsStatus(429, true), 1, 10 * 60_000)).toEqual({retry: true, delayMs: 10 * 60_000});
    expect(retryAfterFailure(kindOfNewsStatus(503, true), 1, 5 * 60_000)).toEqual({retry: true, delayMs: 5 * 60_000});
    expect(retryAfterFailure(kindOfNewsStatus(404, false), 1, null)).toEqual({retry: false});
  });
});

describe('charsets', () => {
  const latin1 = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><rss>Café</rss>', 'latin1');
  test.each([
    ['the Content-Type\'s', Buffer.from('Café', 'latin1'), 'text/html; charset=ISO-8859-1', 'Café'],
    ['the XML declaration\'s', latin1, 'application/xml', '<?xml version="1.0" encoding="ISO-8859-1"?><rss>Café</rss>'],
    ['the page\'s meta', Buffer.from('<meta charset="windows-1252"><p>\u0093Quoted\u0094</p>', 'latin1'), 'text/html', '<meta charset="windows-1252"><p>“Quoted”</p>'],
    ['UTF-8 otherwise', Buffer.from('Café', 'utf8'), null, 'Café'],
    ['an unknown label is UTF-8', Buffer.from('Café', 'utf8'), 'text/html; charset=x-unknown', 'Café'],
  ])('%s', (_, bytes, type, expected) => {
    expect(decodeText(bytes, type)).toBe(expected);
  });
});

describe('outlets', () => {
  test.each([
    ['the name before " · "', 'Channel 4 · Local news', {}, {outlet: 'Channel 4', outletShort: null}],
    ['a plain name', 'NPR', {}, {outlet: 'NPR', outletShort: null}],
    ['the config\'s', 'Channel 4 · Local news', {outlet: 'Channel 4 News', outlet_short: 'Ch 4'}, {outlet: 'Channel 4 News', outletShort: 'Ch 4'}],
  ])('%s', (_, name, config, expected) => {
    expect(outletOf(name, config)).toEqual(expected);
  });
});

describe('NWS', () => {
  test.each([
    ['a Red Flag Warning', 'Red Flag Warning', 'Severe', true],
    ['a Flash Flood Watch', 'Flash Flood Watch', 'Moderate', true],
    ['an Extreme Heat Warning', 'Extreme Heat Warning', 'Severe', true],
    ['an evacuation order', 'Evacuation Immediate', 'Extreme', true],
    ['a Civil Emergency Message', 'Civil Emergency Message', 'Extreme', true],
    ['a Wind Advisory', 'Wind Advisory', 'Moderate', false],
    ['a severe Dust Advisory', 'Dust Advisory', 'Severe', true],
    ['a Special Weather Statement', 'Special Weather Statement', 'Moderate', false],
    ['a Frost Advisory', 'Frost Advisory', 'Minor', false],
    ['a Freeze Warning (crops)', 'Freeze Warning', 'Moderate', false],
    ['a Small Craft Advisory', 'Small Craft Advisory', 'Minor', false],
    ['a Gale Warning (the sea)', 'Gale Warning', 'Moderate', false],
    ['nothing', '', 'Severe', false],
  ])('a hazard: %s', (_, event, severity, expected) => {
    expect(isHazardAlert(event, severity)).toBe(expected);
  });

  test('the point has at most four decimals, the zones each once', () => {
    expect(nwsPoint({lat: 34.050012, lng: -118.25})).toBe('34.05,-118.25');
    expect(nwsZones({properties: {forecastZone: 'https://api.example/zones/forecast/CAZ990', county: 'https://api.example/zones/county/CAC037', fireWeatherZone: 'https://api.example/zones/fire/CAZ990'}}))
      .toEqual(['CAZ990', 'CAC037']);
    expect(nwsZones({properties: {}})).toEqual([]);
    expect(nwsZones(null)).toEqual([]);
  });
});
