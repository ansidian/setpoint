// News's sources' formats (N2), each parsed from fixtures invented in its real shape (fixtures/news/):
// RSS 2.0 with Media RSS, Atom, RSS 1.0, Google News search, article pages (readable text and
// og:image, or none), a news page's listed posts, release notes' dated sections, NWS alerts, USGS
// earthquakes, Cal Fire incidents, AirNow's reporting-area file and Algolia's Hacker News search.
import {SEED_NOW} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {airNowReportingAreas, calFireIncidents, isAirNowFile, hnStories, nwsAlerts, usgsQuakes} from '../src/domain/newsApis.ts';
import {NotAFeed, parseFeed} from '../src/domain/newsFeeds.ts';
import {datedSections, extractArticle, listedPosts} from '../src/domain/newsPages.ts';
import {googleHeadline} from '../src/providers/news/feeds.ts';
import {newsFixture, newsJson} from './fixtures/news.ts';

const BASE = 'https://news.example.com';
const NOW = SEED_NOW;
const HOME = {lat: 34.05, lng: -118.25};

describe('feeds', () => {
  test('RSS 2.0: each item\'s link, headline, summary, byline, date and best image', () => {
    const feed = parseFeed(newsFixture('station.rss.xml', BASE), `${BASE}/news/local/feed/`);
    expect(feed.title).toBe('Channel 4 – Local News');
    expect(feed.items).toHaveLength(4);
    expect(feed.items[0]).toEqual({
      url: `${BASE}/news/local/brush-fire-fabrikam-ridge/?utm_source=rss&utm_medium=rss&utm_campaign=brush-fire`,
      guid: `${BASE}/?p=1100231`,
      headline: 'Brush fire near Fabrikam Ridge grows to 400 acres',
      summary: 'Evacuation warnings were issued for foothill homes as the fire spread overnight. The post Brush fire near Fabrikam Ridge grows to 400 acres appeared first on Channel 4.',
      byline: 'Dana Whitfield',
      published: 'Wed, 07 Oct 2026 14:05:00 +0000',
      // Media RSS content, over the 150-pixel thumbnail.
      imageUrl: `${BASE}/images/fire-1200.jpg`,
      source: null,
    });
    // An enclosure; an entity decoded once by XML and once as HTML.
    expect(feed.items[1]).toMatchObject({imageUrl: `${BASE}/images/water-main.jpg`, summary: 'Contoso Avenue is closed between 3rd and 5th streets & drivers are asked to avoid the area.', byline: 'Station staff'});
    // The untitled item isn't one.
    expect(feed.items.map(item => item.headline)).not.toContain('');
  });

  test('Atom: links resolved against the feed, HTML titles and summaries made plain, enclosure and thumbnail images', () => {
    const feed = parseFeed(newsFixture('newsroom.atom.xml', BASE), `${BASE}/blog/feed.xml`);
    expect(feed.items).toEqual([
      {
        url: `${BASE}/blog/breeze-3`, guid: 'tag:northwind.example,2026:breeze-3', headline: 'Northwind releases Breeze 3, an open model for speech',
        summary: 'Breeze 3 transcribes and translates 40 languages & runs on a laptop.', byline: 'Priya Raman', published: '2026-10-07T13:00:00Z',
        imageUrl: `${BASE}/blog/assets/breeze-3/cover.png`, source: null,
      },
      {
        url: `${BASE}/blog/evaluation-suite?ref=feed`, guid: 'tag:northwind.example,2026:evaluation-suite', headline: 'Inside our new evaluation suite',
        summary: 'How we measure what our models can do.', byline: null, published: '2026-10-06T20:00:00Z',
        // A Media RSS thumbnail comes before the content's inline image.
        imageUrl: `${BASE}/blog/assets/evals/thumb.jpg`, source: null,
      },
    ]);
  });

  test('an agency feed that dates its items in <startDate> rather than <pubDate>: that date, not the read\'s', () => {
    // Shaped like an air district's news feed: no pubDate, an empty description and tag.
    const feed = parseFeed(`<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Air District - Latest News</title><link>${BASE}</link>
      <item><title>Air district issues a smoke advisory due to the Fabrikam Fire</title><link>${BASE}/advisories/fabrikam-fire</link><description /><guid>${BASE}/advisories/fabrikam-fire</guid><startDate>Wed, 22 Jan 2025 07:00:00 GMT -08:00</startDate><tag /></item>
      <item><title>Air district opens grants for zero-emission heat pumps</title><link>${BASE}/grants</link><description /><guid>${BASE}/grants</guid><startDate>Fri, 09 Oct 2026 07:00:00 GMT -07:00</startDate><tag /></item>
    </channel></rss>`, `${BASE}/rss`);
    expect(feed.items.map(item => item.published)).toEqual(['Wed, 22 Jan 2025 07:00:00 GMT -08:00', 'Fri, 09 Oct 2026 07:00:00 GMT -07:00']);
  });

  test('the first inline image when there\'s nothing else, and only an absolute one (v1)', () => {
    const atom = (content: string) => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title><link href="${BASE}/a"/><content type="html">${content}</content></entry></feed>`;
    expect(parseFeed(atom('&lt;img src="https://cdn.example.com/hero.jpg"&gt;&lt;p&gt;Body&lt;/p&gt;'), BASE).items[0]!.imageUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(parseFeed(atom('&lt;img src="/relative.jpg"&gt;'), BASE).items[0]!.imageUrl).toBeNull();
  });

  test('RSS 1.0 (RDF), media:group, an author\'s address that isn\'t a byline, and a guid as the link', () => {
    const rdf = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel rdf:about="${BASE}/"><title>Wire</title></channel>
      <item rdf:about="${BASE}/wire/1"><title>Court rules on a new state law</title><link>${BASE}/wire/1</link><dc:date>2026-10-07T10:00:00Z</dc:date></item>
    </rdf:RDF>`;
    expect(parseFeed(rdf, BASE).items).toEqual([{url: `${BASE}/wire/1`, guid: null, headline: 'Court rules on a new state law', summary: null, byline: null, published: '2026-10-07T10:00:00Z', imageUrl: null, source: null}]);
    const rss = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item><title>Video</title><guid>${BASE}/v/1</guid><author>desk@example.com</author>
      <media:group><media:content url="${BASE}/v/1.mp4" medium="video"/><media:content url="${BASE}/v/1.jpg" medium="image" width="1280"/></media:group></item></channel></rss>`;
    expect(parseFeed(rss, BASE).items[0]).toMatchObject({url: `${BASE}/v/1`, byline: null, imageUrl: `${BASE}/v/1.jpg`});
    expect(parseFeed(rss.replace('desk@example.com', 'desk@example.com (Sam Ortiz)'), BASE).items[0]!.byline).toBe('Sam Ortiz');
  });

  test('Google News: the outlet from <source>, its name off the headline', () => {
    const items = parseFeed(newsFixture('google-news.rss.xml'), 'https://news.google.com/rss/search?q=x').items;
    expect(items.map(item => [googleHeadline(item.headline, item.source?.name ?? null), item.source?.name, item.url])).toEqual([
      ['Federal agents detain 9 at a car wash in Example City', 'Channel 7', 'https://news.google.com/rss/articles/CBMiInvented0001?oc=5'],
      ['Council approves a housing project near the station', 'Example Daily', 'https://news.google.com/rss/articles/CBMiInvented0002?oc=5'],
    ]);
    expect(googleHeadline('A headline - with a dash', null)).toBe('A headline - with a dash');
  });

  test.each([
    ['an HTML page', '<!doctype html><html><body><p>Not a feed</p></body></html>'],
    ['garbage', 'not xml at all {'],
    ['JSON', '{"items": []}'],
  ])('%s isn\'t a feed', (_, body) => {
    expect(() => parseFeed(body, BASE)).toThrow(NotAFeed);
  });
});

describe('article pages', () => {
  test('a station\'s article: its paragraphs only, and its og:image', () => {
    const page = extractArticle(newsFixture('article.html', BASE), `${BASE}/news/local/brush-fire-fabrikam-ridge/`);
    expect(page.imageUrl).toBe(`${BASE}/images/fire-og.jpg`);
    expect(page.text!.split('\n\n')).toEqual([
      'A brush fire burning in the hills above Fabrikam Ridge grew to 400 acres overnight, and fire officials issued evacuation warnings for homes along the foothills on Wednesday morning.',
      'The fire was first reported shortly after 6 p.m. Tuesday near a hiking trail. Gusty winds pushed it uphill and away from homes for most of the night, officials said, but a shift in the wind early Wednesday sent embers toward the foothills.',
      'About 300 firefighters were assigned to the fire by morning, supported by four helicopters. The fire was 10% contained, and the cause is under investigation.',
      'An evacuation center opened at the community college gym, which also accepts small animals.',
    ]);
  });

  test('a newsroom that writes its paragraphs as divs, with no image', () => {
    const page = extractArticle(newsFixture('newsroom-article.html', BASE), `${BASE}/newsroom/2026/10/fold-2/`);
    expect(page.imageUrl).toBeNull();
    expect(page.text!.split('\n\n')).toHaveLength(3);
    expect(page.text).toMatch(/^CONTOSO CITY, October 7, 2026 — Contoso today announced the Contoso Fold 2/);
    expect(page.text).not.toContain('Copyright');
  });

  test('a wall or an app shell has no text, and keeps its image, resolved', () => {
    expect(extractArticle(newsFixture('wall.html', BASE), `${BASE}/story/1`)).toEqual({text: null, imageUrl: `${BASE}/images/wall-og.jpg`});
  });

  test('the JSON-LD articleBody stands in when the page draws itself', () => {
    const body = 'The county board voted 4 to 1 on Tuesday to approve the housing project near the station, which will add 300 homes.\nConstruction is expected to start next spring and take two years, the developer said in a statement after the vote.';
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({'@context': 'https://schema.org', '@graph': [{'@type': 'NewsArticle', articleBody: body, image: {url: `${BASE}/ld.jpg`}}]})}</script></head><body><div id="app"></div></body></html>`;
    expect(extractArticle(html, `${BASE}/a`)).toEqual({text: body.replace('\n', '\n\n'), imageUrl: `${BASE}/ld.jpg`});
  });

  test('a layout wrapper with a noisy class keeps its article; a promo with the same word goes', () => {
    const long = 'This paragraph is the article itself and runs long enough to be taken for prose rather than for a box of links or a promotion, as articles do, with a second sentence that carries it past two hundred characters.';
    const html = `<div class="page has-sidebar"><p>${long}</p><p>${long} Again.</p></div><div class="sidebar"><p>A short promo that should go.</p></div>`;
    expect(extractArticle(html, BASE).text).toBe(`${long}\n\n${long} Again.`);
  });
});

describe('page reads', () => {
  test('a news page\'s posts: below its path, each once with its card\'s title and date, not its archives or navigation', () => {
    expect(listedPosts(newsFixture('lab-news.html'), `${BASE}/news`)).toEqual([
      {url: `${BASE}/news/northwind-breeze-3`, anchor: null, headline: 'Introducing Breeze 3', date: {kind: 'day', date: '2026-10-07'}, text: null},
      {url: `${BASE}/news/safety-report-fall-2026`, anchor: null, headline: 'Our fall 2026 safety report', date: {kind: 'instant', at: '2026-10-06T17:00:00.000Z'}, text: null},
      {url: `${BASE}/news/northwind-in-europe?utm_source=newsroom`, anchor: null, headline: 'Northwind opens an office in Example City', date: {kind: 'day', date: '2026-09-02'}, text: null},
      {url: `${BASE}/news/fabrikam-partnership`, anchor: null, headline: 'Partnering with Fabrikam on research compute', date: null, text: null},
    ]);
  });

  test('a page that lists nothing, or another site\'s links, has no posts', () => {
    expect(listedPosts('<html><body><div id="app"></div></body></html>', `${BASE}/news`)).toEqual([]);
    expect(listedPosts('<a href="https://elsewhere.example.org/news/a-post">A post elsewhere</a>', `${BASE}/news`)).toEqual([]);
  });

  test('release notes: each dated heading\'s notes, its anchor and its first line', () => {
    expect(datedSections(newsFixture('release-notes.html'), `${BASE}/en/release-notes/overview`)).toEqual([
      {
        url: `${BASE}/en/release-notes/overview#october-7-2026`, anchor: 'october-7-2026', headline: 'We\'ve launched Breeze 3 in the API, with transcription in 40 languages.',
        date: {kind: 'day', date: '2026-10-07'}, text: 'We\'ve launched Breeze 3 in the API, with transcription in 40 languages. Read more in our docs.\n\nBatch requests now cost half as much.',
      },
      {url: `${BASE}/en/release-notes/overview#october-5-2026`, anchor: 'october-5-2026', headline: 'The usage page now shows costs by day.', date: {kind: 'day', date: '2026-10-05'}, text: 'The usage page now shows costs by day.'},
      {url: `${BASE}/en/release-notes/overview#september-28-2026`, anchor: 'september-28-2026', headline: 'We retired the v1 endpoints, as announced in June.', date: {kind: 'day', date: '2026-09-28'}, text: 'We retired the v1 endpoints, as announced in June.'},
    ]);
    expect(datedSections('<h2>Changelog</h2><p>Nothing dated.</p>', BASE)).toEqual([]);
  });
});

describe('APIs', () => {
  test('NWS: actual hazards still in force, with their text; advisories, tests, cancellations and expired ones left out', () => {
    const nws = newsJson('nws.json');
    expect(nwsAlerts(nws.alerts.CAZ990, NOW)).toEqual([{
      url: 'https://api.example.org/alerts/urn:oid:2.49.0.1.840.0.invented.001.1', canonicalUrl: 'https://api.example.org/alerts/urn:oid:2.49.0.1.840.0.invented.001.1',
      outlet: 'National Weather Service', outletShort: 'NWS', byline: null,
      headline: 'Red Flag Warning issued October 7 at 2:14AM PDT until October 8 at 6:00PM PDT by NWS Example Office',
      feedSummary: 'Red Flag Warning, Example Valleys; Example Foothills', publishedAt: '2026-10-07T09:14:00.000Z', imageUrl: null,
      text: 'AFFECTED AREA...Example Valleys and Example Foothills.\n\nWINDS...Northeast 20 to 30 mph with gusts up to 55 mph.\n\nRELATIVE HUMIDITY...As low as 8 percent.\n\nA Red Flag Warning means that critical fire weather conditions are either occurring now or will shortly.',
    }]);
    expect(nwsAlerts(nws.alerts.CAC037, NOW).map(alert => alert.headline)).toEqual([expect.stringMatching(/^Red Flag Warning/)]);
    expect(nwsAlerts({type: 'FeatureCollection', features: []}, NOW)).toEqual([]);
  });

  test('USGS: earthquakes at the minimum magnitude, within the radius, in the 48 hours; not blasts', () => {
    const quakes = usgsQuakes(newsJson('apis.json').usgs, HOME, {minMagnitude: 3, radiusKm: 100}, NOW);
    expect(quakes).toEqual([{
      url: 'https://earthquake.example.org/earthquakes/eventpage/ci90000001', canonicalUrl: 'https://earthquake.example.org/earthquakes/eventpage/ci90000001',
      outlet: 'USGS', outletShort: 'USGS', byline: null, headline: 'M 3.4 - 12 km NE of Example Valley, CA', feedSummary: 'Magnitude 3.4, 12 km NE of Example Valley, CA, 8.2 km deep.',
      publishedAt: '2026-10-07T12:00:00.000Z', imageUrl: null, text: 'Magnitude 3.4, 12 km NE of Example Valley, CA, 8.2 km deep.',
      lat: 34.11, lng: -118.16,
    }]);
    expect(usgsQuakes(newsJson('apis.json').usgs, HOME, {minMagnitude: 2, radiusKm: 1000}, NOW).map(quake => quake.headline)).toEqual([
      'M 3.4 - 12 km NE of Example Valley, CA', 'M 2.1 - 3 km S of Example Valley, CA', 'M 4.5 - 20 km W of Example Bay, CA',
    ]);
  });

  test('Cal Fire: active incidents within the radius, each acreage and containment its own revision', () => {
    const fires = calFireIncidents(newsJson('apis.json').calFire, HOME, {radiusKm: 80}, 'https://incidents.example.org/umbraco/api/IncidentApi/List?inactive=false', NOW);
    expect(fires).toEqual([{
      url: 'https://incidents.example.org/incidents/2026/10/6/fabrikam-fire/', canonicalUrl: 'https://incidents.example.org/incidents/2026/10/6/fabrikam-fire#acres-400-contained-10',
      outlet: 'Cal Fire', outletShort: 'Cal Fire', byline: null, headline: 'Fabrikam Fire: 400 acres, 10% contained',
      feedSummary: 'Fabrikam Fire in Fabrikam Ridge, north of Example Valley, Example County: 400 acres, 10% contained.',
      // California's wall clock, 8:30 AM PDT.
      publishedAt: '2026-10-07T15:30:00.000Z', imageUrl: null,
      text: 'Fabrikam Fire in Fabrikam Ridge, north of Example Valley, Example County: 400 acres, 10% contained. Started 2026-10-06. Evacuation warnings are in place for foothill homes.',
      lat: 34.19, lng: -118.21,
    }]);
    const grown = newsJson('apis.json').calFire.map((fire: Record<string, unknown>) => ({...fire, AcresBurned: 650}));
    expect(calFireIncidents(grown, HOME, {radiusKm: 80}, 'https://incidents.example.org/list', NOW)[0]!.canonicalUrl).toBe('https://incidents.example.org/incidents/2026/10/6/fabrikam-fire#acres-650-contained-10');
    expect(calFireIncidents({Incidents: newsJson('apis.json').calFire}, HOME, {radiusKm: 80}, 'https://incidents.example.org/list', NOW)).toHaveLength(1);
  });

  test('Cal Fire\'s GeoJSON list: each incident placed by its Point ([lng, lat]), else by its own coordinates; one that can\'t be placed is left out', () => {
    const list = 'https://incidents.example.org/umbraco/api/IncidentApi/GeoJsonList?inactive=false';
    expect(calFireIncidents(newsJson('cal-fire.geojson'), HOME, {radiusKm: 80}, list, NOW)).toEqual([{
      url: 'https://incidents.example.org/incidents/2026/10/6/tailspin-fire/', canonicalUrl: 'https://incidents.example.org/incidents/2026/10/6/tailspin-fire#acres-1250-contained-35',
      outlet: 'Cal Fire', outletShort: 'Cal Fire', byline: null, headline: 'Tailspin Fire: 1,250 acres, 35% contained',
      feedSummary: 'Tailspin Fire in Tailspin Canyon, east of Example Valley, Example County: 1,250 acres, 35% contained.',
      // California's wall clock, 7:45 AM PDT.
      publishedAt: '2026-10-07T14:45:00.000Z', imageUrl: null,
      text: 'Tailspin Fire in Tailspin Canyon, east of Example Valley, Example County: 1,250 acres, 35% contained. Started 2026-10-06.',
      lat: 34.28, lng: -118.12,
    }, {
      // No geometry: its properties' Latitude and Longitude, its numbers as text, its link relative to the list.
      url: 'https://incidents.example.org/incidents/2026/10/7/wingtip-fire/', canonicalUrl: 'https://incidents.example.org/incidents/2026/10/7/wingtip-fire#acres-60-contained-80',
      outlet: 'Cal Fire', outletShort: 'Cal Fire', byline: null, headline: 'Wingtip Fire: 60 acres, 80% contained',
      feedSummary: 'Wingtip Fire in Example County: 60 acres, 80% contained.',
      publishedAt: '2026-10-07T12:00:00.000Z', imageUrl: null,
      text: 'Wingtip Fire in Example County: 60 acres, 80% contained. Started 2026-10-07. Forward progress has been stopped.',
      lat: 34.1, lng: -118.4,
    }]);
    // Not a list Cal Fire sends: nothing, rather than a guess.
    expect(calFireIncidents({type: 'FeatureCollection', features: 'none'}, HOME, {radiusKm: 80}, list, NOW)).toEqual([]);
  });

  test('AirNow\'s reporting-area file: each nearby area\'s latest hourly observation at its worst pollutant, when unhealthy enough; one article per area, day and level', () => {
    const file = newsFixture('reportingarea.dat');
    // The file as AirNow sends it: a byte-order mark and CRLF line endings.
    expect([file.startsWith('\uFEFF'), file.includes('\r\n')]).toEqual([true, true]);
    const air = airNowReportingAreas(file, HOME, {radiusKm: 40, minAqi: 151}, NOW);
    // Forecasts and yesterday's are left out, and Example Valley's 205 at 07:00 is an earlier hour.
    expect(air).toEqual([
      {
        url: 'https://www.airnow.gov/?city=Example+Valley&state=CA&country=USA', canonicalUrl: 'https://airnow.gov?city=Example+Valley&country=USA&state=CA#2026-10-07-aqi-category-4',
        outlet: 'AirNow', outletShort: 'AirNow', byline: null, headline: 'Unhealthy air quality in Example Valley, AQI 160',
        feedSummary: 'Unhealthy air in Example Valley, CA: AQI 160 (PM2.5).', publishedAt: '2026-10-07T15:00:00.000Z', imageUrl: null,
        text: 'Unhealthy air in Example Valley, CA: AQI 160 (PM2.5). AirNow\'s reading for 2026-10-07 at 08:00 PDT.',
        lat: 34.1, lng: -118.2,
      },
      {
        url: 'https://www.airnow.gov/?city=Example+Foothills&state=CA&country=USA', canonicalUrl: 'https://airnow.gov?city=Example+Foothills&country=USA&state=CA#2026-10-07-aqi-category-4',
        outlet: 'AirNow', outletShort: 'AirNow', byline: null, headline: 'Unhealthy air quality in Example Foothills, AQI 156',
        feedSummary: 'Unhealthy air in Example Foothills, CA: AQI 156 (ozone).', publishedAt: '2026-10-07T15:00:00.000Z', imageUrl: null,
        text: 'Unhealthy air in Example Foothills, CA: AQI 156 (ozone). AirNow\'s reading for 2026-10-07 at 08:00 PDT.',
        lat: 34.2, lng: -118.1,
      },
    ]);
    // A lower bar takes Example Coast too; Example Desert, past 40 km, only a wider radius; the lines
    // that can't be read (an unknown zone, a latitude that isn't one, not a line of the file) are skipped.
    expect(airNowReportingAreas(file, HOME, {radiusKm: 40, minAqi: 101}, NOW).map(article => article.headline)).toEqual([
      'Unhealthy air quality in Example Valley, AQI 160', 'Unhealthy for Sensitive Groups air quality in Example Coast, AQI 120', 'Unhealthy air quality in Example Foothills, AQI 156',
    ]);
    expect(airNowReportingAreas(file, HOME, {radiusKm: 500, minAqi: 151}, NOW).map(article => article.headline)).toContain('Very Unhealthy air quality in Example Desert, AQI 210');
    // A worse level the same day is a new article; the same level an hour later isn't.
    const worse = `${file}10/07/26|10/07/26|09:00|PDT|0|O|Y|Example Valley|CA|34.1000|-118.2000|PM2.5|215|Very Unhealthy|No||Example Air District\r\n`;
    expect(airNowReportingAreas(worse, HOME, {radiusKm: 40, minAqi: 151}, NOW)[0]!.canonicalUrl).toBe('https://airnow.gov?city=Example+Valley&country=USA&state=CA#2026-10-07-aqi-category-5');
    const same = `${file}10/07/26|10/07/26|09:00|PDT|0|O|Y|Example Valley|CA|34.1000|-118.2000|PM2.5|170|Unhealthy|No||Example Air District\r\n`;
    expect(airNowReportingAreas(same, HOME, {radiusKm: 40, minAqi: 151}, NOW)[0]!.canonicalUrl).toBe(air[0]!.canonicalUrl);
    // Nothing that's the file: nothing, rather than a guess, and the adapter can tell it isn't the file.
    expect(airNowReportingAreas('<html>Not here</html>', HOME, {radiusKm: 40, minAqi: 151}, NOW)).toEqual([]);
    expect([isAirNowFile(file), isAirNowFile('<html>Not here</html>'), isAirNowFile('')]).toEqual([true, false, false]);
  });

  test('Hacker News: stories over the points in the 48 hours, a text post linked to its discussion', () => {
    expect(hnStories(newsJson('apis.json').hackerNews, {minPoints: 150}, NOW)).toEqual([
      {
        url: 'https://northwind.example.com/blog/breeze-3?utm_source=hn', canonicalUrl: 'https://northwind.example.com/blog/breeze-3', outlet: 'Hacker News', outletShort: 'HN', byline: null,
        headline: 'Breeze 3: an open speech model that runs on a laptop', publishedAt: '2026-10-07T13:20:00.000Z', imageUrl: null, feedSummary: '412 points, 188 comments on Hacker News.',
      },
      {
        url: 'https://news.ycombinator.com/item?id=90000002', canonicalUrl: 'https://news.ycombinator.com/item?id=90000002', outlet: 'Hacker News', outletShort: 'HN', byline: null,
        headline: 'Ask HN: How do you run evaluations for speech models?', publishedAt: '2026-10-07T09:00:00.000Z', imageUrl: null,
        feedSummary: 'We\'re trying to measure word error rate & latency together.', text: 'We\'re trying to measure word error rate & latency together.',
      },
    ]);
  });
});
