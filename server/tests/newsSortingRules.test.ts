// News's sorting policy as tables (N3; BRIEF.md › What it covers, Stories, Ranking, Models and cost,
// Missed, The page › Upcoming): the rules for a source, noise and politics as applied to the model's
// reading ("events, not arguments", the subject wins), wire copy, candidate matching, new facts
// versus repeats, the ranking formula and its order, the cap, Missed's limits, keynote confirmation,
// how the model's answers are read, and search's matching.
import type {NewsSection} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {costMicros} from '../src/domain/aiCost.ts';
import {
  applyGrouping, candidates, confirmKeynote, factTime, freshFacts, incidentKey, judgeArticle, limitMissed, matchesAll, monthStart, NEWS_MODELS, outletCount,
  rankOrder, revisionFacts, ruleMatch, searchWords, significantWords, sourceRule, STORY_BAR, storyScore, summaryModel, wireKey,
} from '../src/domain/newsSorting.ts';
import type {ArticleKind, ArticleNotes, ArticleSubject, KeynoteClaim, NoiseReason, RankSignals, SourceRule} from '../src/domain/newsSorting.ts';
import {ARTICLE_SYSTEM, groupingOf, keynoteOf, notesOf, rankingOf, writtenOf} from '../src/news/prompt.ts';

const ZONE = 'America/Los_Angeles';
const NOW = '2026-10-07T16:12:00.000Z';
const ago = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

describe('the rules for a source', () => {
  test.each<[string, {section: NewsSection; adapter: string; kind: string; name: string; config?: Record<string, unknown>}, SourceRule]>([
    ['a local TV feed', {section: 'local', adapter: 'feed', kind: 'feed', name: 'KTLA · Local news'}, {section: 'local', hazard: false, subjectCheck: false, firstParty: null}],
    ['official hazard data is Local', {section: 'local', adapter: 'cal_fire', kind: 'official_api', name: 'Cal Fire incidents'}, {section: 'local', hazard: true, subjectCheck: false, firstParty: null}],
    ['NWS alerts', {section: 'local', adapter: 'nws', kind: 'official_api', name: 'National Weather Service'}, {section: 'local', hazard: true, subjectCheck: false, firstParty: null}],
    ['Hacker News needs a tech or AI subject', {section: 'tech', adapter: 'hn_algolia', kind: 'feed', name: 'Hacker News'}, {section: 'tech', hazard: false, subjectCheck: true, firstParty: null}],
    ['a first-party newsroom speaks for its company', {section: 'tech', adapter: 'feed', kind: 'feed', name: 'Apple Newsroom'}, {section: 'tech', hazard: false, subjectCheck: false, firstParty: 'apple'}],
    ['a lab\'s page read', {section: 'ai', adapter: 'page_read', kind: 'page_read', name: 'Anthropic news'}, {section: 'ai', hazard: false, subjectCheck: false, firstParty: 'anthropic'}],
    ['an outlet in Tech isn\'t first-party', {section: 'tech', adapter: 'feed', kind: 'feed', name: 'The Verge'}, {section: 'tech', hazard: false, subjectCheck: false, firstParty: null}],
    ['an outlet\'s feed on a company is still the outlet\'s', {section: 'tech', adapter: 'feed', kind: 'feed', name: 'The Verge · Apple', config: {outlet: 'The Verge'}}, {section: 'tech', hazard: false, subjectCheck: false, firstParty: null}],
    ['a company inside a word isn\'t that company', {section: 'tech', adapter: 'feed', kind: 'feed', name: '9to5Google'}, {section: 'tech', hazard: false, subjectCheck: false, firstParty: null}],
    ['a newsroom known by its outlet: Claude\'s release notes are Anthropic\'s', {section: 'ai', adapter: 'page_read', kind: 'page_read', name: 'Claude Platform release notes', config: {outlet: 'Anthropic'}}, {section: 'ai', hazard: false, subjectCheck: false, firstParty: 'anthropic'}],
    ['a national outlet', {section: 'general', adapter: 'feed', kind: 'feed', name: 'NPR'}, {section: 'general', hazard: false, subjectCheck: false, firstParty: null}],
  ])('%s', (_, source, rule) => {
    expect(sourceRule(source)).toEqual(rule);
  });
});

const notes = (kind: ArticleKind, subject: ArticleSubject, sections: NewsSection[], extra: Partial<ArticleNotes> = {}): ArticleNotes =>
  ({kind, subject, sections, facts: [], importance: 50, place: null, keynote: null, ...extra});
const FEED: SourceRule = {section: 'general', hazard: false, subjectCheck: false, firstParty: null};
const LOCAL_FEED: SourceRule = {...FEED, section: 'local'};
const HAZARD: SourceRule = {section: 'local', hazard: true, subjectCheck: false, firstParty: null};
const HN: SourceRule = {section: 'tech', hazard: false, subjectCheck: true, firstParty: null};

describe('noise and politics, as applied to the model\'s reading (D88)', () => {
  test.each<[string, SourceRule, ArticleNotes, {keep: true; sections: NewsSection[]} | {keep: false; reason: NoiseReason}]>([
    // Events, not arguments; the subject wins over politics.
    ['"OpenAI testifies before Congress" is in, under AI', FEED, notes('politics_argument', 'ai', ['general']), {keep: true, sections: ['ai']}],
    ['an antitrust ruling against Google is in, under Tech', FEED, notes('event', 'tech', ['tech', 'general']), {keep: true, sections: ['tech', 'general']}],
    ['a council vote on a housing project in the area is in, under Local', LOCAL_FEED, notes('event', 'local', ['local']), {keep: true, sections: ['local']}],
    ['a law taking effect is an event', FEED, notes('event', 'us', ['general']), {keep: true, sections: ['general']}],
    ['a poll is an argument: out', FEED, notes('politics_argument', 'us', ['general']), {keep: false, reason: 'politics_argument'}],
    ['a bill being debated is out', FEED, notes('politics_argument', 'us', ['general']), {keep: false, reason: 'politics_argument'}],
    ['a council debate in the area is an argument, not a decision: out', LOCAL_FEED, notes('politics_argument', 'local', ['local']), {keep: false, reason: 'politics_argument'}],
    // Never anywhere.
    ['sports', LOCAL_FEED, notes('sports', 'local', ['local']), {keep: false, reason: 'sports'}],
    ['entertainment and celebrity', FEED, notes('entertainment', 'us', ['general']), {keep: false, reason: 'entertainment'}],
    ['opinion', FEED, notes('opinion', 'ai', ['ai']), {keep: false, reason: 'opinion'}],
    ['deals', FEED, notes('deal', 'tech', ['tech']), {keep: false, reason: 'deal'}],
    ['sponsored posts', FEED, notes('sponsored', 'tech', ['tech']), {keep: false, reason: 'sponsored'}],
    ['a forecast: weather counts only as a hazard', LOCAL_FEED, notes('weather_forecast', 'local', ['local']), {keep: false, reason: 'weather_forecast'}],
    // Each section's "Not".
    ['Local: food and lifestyle', LOCAL_FEED, notes('lifestyle', 'local', ['local']), {keep: false, reason: 'lifestyle'}],
    ['Local: an events listing', LOCAL_FEED, notes('events_listing', 'local', ['local']), {keep: false, reason: 'events_listing'}],
    ['Tech: a rumor', FEED, notes('rumor', 'tech', ['tech']), {keep: false, reason: 'rumor'}],
    ['Tech: a review', FEED, notes('review', 'tech', ['tech']), {keep: false, reason: 'review'}],
    ['AI: a funding round', FEED, notes('funding', 'ai', ['ai']), {keep: false, reason: 'funding'}],
    ['AI: a tutorial', FEED, notes('tutorial', 'ai', ['ai']), {keep: false, reason: 'tutorial'}],
    ['General: world news', FEED, notes('event', 'world', ['general']), {keep: false, reason: 'world'}],
    // Hazards and Hacker News.
    ['official hazard data is kept, in Local, whatever the reading says', HAZARD, notes('weather_forecast', 'other', ['general']), {keep: true, sections: ['local']}],
    ['Hacker News on a cooking subject is out', HN, notes('event', 'other', ['tech']), {keep: false, reason: 'off_subject'}],
    ['Hacker News on an AI release is in, AI and Tech only', HN, notes('event', 'ai', ['ai', 'general']), {keep: true, sections: ['ai']}],
    // Sections the subject allows; else its own.
    ['an Anthropic release in the national headlines sits in both', FEED, notes('event', 'ai', ['ai', 'general']), {keep: true, sections: ['ai', 'general']}],
    ['a US story can\'t be Local', FEED, notes('event', 'us', ['local']), {keep: true, sections: ['general']}],
    ['no sections given: the subject\'s own', FEED, notes('event', 'tech', []), {keep: true, sections: ['tech']}],
    ['no sections and no subject section: the source\'s', LOCAL_FEED, notes('event', 'other', []), {keep: true, sections: ['local']}],
  ])('%s', (_, rule, reading, verdict) => {
    expect(judgeArticle(rule, reading)).toEqual(verdict);
  });

  test('the prompt states the policy plainly, with the brief\'s examples', () => {
    for (const line of ['events, not arguments', '"OpenAI testifies before Congress" is about AI', 'an antitrust ruling against Google is about tech', 'a council vote on a housing project in the area is local', 'Never news anywhere: sports, entertainment']) {
      expect(ARTICLE_SYSTEM).toContain(line);
    }
  });
});

const AP = 'COLUMBUS, Ohio (AP) — Four people were killed and two were wounded when a gunman opened fire inside a warehouse on the city\'s east side early Tuesday, police said. The suspect fled before officers arrived, and a search continued through the morning.';

describe('wire copy counts as one outlet (D86)', () => {
  test.each<[string, {outlet: string; wireKey: string | null}[], number]>([
    ['five TV stations are five outlets', ['KTLA', 'NBC Los Angeles', 'CBS LA', 'ABC7', 'FOX 11'].map(outlet => ({outlet, wireKey: null})), 5],
    ['AP text republished by ABC and PBS is one', [{outlet: 'ABC News', wireKey: wireKey(AP)}, {outlet: 'PBS News', wireKey: wireKey(AP)}], 1],
    ['…and NPR\'s own reporting another', [{outlet: 'ABC News', wireKey: wireKey(AP)}, {outlet: 'PBS News', wireKey: wireKey(AP)}, {outlet: 'NPR', wireKey: wireKey('NPR\'s own reporting on the shooting, a different text from beginning to end, which no other outlet ran, and longer than the thirty words a wire key needs to count at all here.')}], 2],
    ['an outlet\'s two articles are one outlet', [{outlet: 'KTLA', wireKey: null}, {outlet: 'KTLA', wireKey: null}], 1],
    ['copies chain: A=B by one text, B=C by another', [{outlet: 'A', wireKey: 'x'}, {outlet: 'B', wireKey: 'x'}, {outlet: 'B', wireKey: 'y'}, {outlet: 'C', wireKey: 'y'}], 1],
    ['nothing is nothing', [], 0],
  ])('%s', (_, articles, count) => {
    expect(outletCount(articles)).toBe(count);
  });

  test.each<[string, string | null, string | null]>([
    ['the same text, however punctuated, is the same key', AP, AP.replace(/,/g, '').toUpperCase()],
    ['a text with an outlet\'s own tail is still the copy', AP, `${AP} Copyright 2026 The Associated Press. All rights reserved. This material may not be published, broadcast, rewritten or redistributed.`],
  ])('%s', (_, a, b) => {
    expect(wireKey(a)).not.toBeNull();
    expect(wireKey(a)).toBe(wireKey(b));
  });

  test('a short text is too generic to tell copies apart', () => {
    expect(wireKey('Four killed in a warehouse shooting in Ohio.')).toBeNull();
    expect(wireKey(null)).toBeNull();
  });
});

const story = (id: number, text: string, extra: {incidents?: string[]; wireKeys?: string[]} = {}) =>
  ({id, words: significantWords(text), incidents: new Set(extra.incidents ?? []), wireKeys: new Set(extra.wireKeys ?? [])});

describe('grouping: cheap candidates first', () => {
  const stories = [
    story(1, 'Brush fire near the 210 burns 150 acres. A brush fire broke out near the 210 freeway in the foothills', {incidents: ['https://fire.example/incidents/foothill-fire']}),
    story(2, 'Four killed in a warehouse shooting in Ohio', {wireKeys: [wireKey(AP)!]}),
    story(3, 'Pixel Watch 5 goes on sale with two-day battery life'),
  ];

  test.each<[string, {words: Set<string>; incident: string | null; wireKey: string | null}, {storyId: number; by: 'incident' | 'wire'} | null]>([
    ['a hazard\'s next revision joins its incident\'s story', {words: significantWords('Foothill Fire: 400 acres'), incident: 'https://fire.example/incidents/foothill-fire', wireKey: null}, {storyId: 1, by: 'incident'}],
    ['the same wire text joins its story', {words: significantWords('Ohio warehouse shooting'), incident: null, wireKey: wireKey(AP)}, {storyId: 2, by: 'wire'}],
    ['anything else needs the model', {words: significantWords('Crews battle a brush fire near the 210'), incident: null, wireKey: null}, null],
  ])('%s', (_, article, match) => {
    expect(ruleMatch(article, stories)).toEqual(match);
  });

  test.each<[string, string, number[]]>([
    ['the same fire from another station', 'Crews battle a 150-acre brush fire near the 210 in the foothills', [1]],
    ['a different shooting shares too little with any one story', 'Police search for a gunman after a shooting at a mall in Texas', []],
    ['one shared word isn\'t a candidate', 'Apple sends invites for a watch event', []],
    ['the closest first', 'Ohio warehouse shooting: suspect in custody, four killed', [2]],
  ])('%s', (_, headline, ids) => {
    expect(candidates({words: significantWords(headline), incident: null, wireKey: null}, stories).map(candidate => candidate.id)).toEqual(ids);
  });

  test.each<[string, string, boolean, string | null]>([
    ['a Cal Fire revision', 'https://fire.example/incidents/foothill-fire#acres-400-contained-10', true, 'https://fire.example/incidents/foothill-fire'],
    ['an AirNow day and category', 'https://airnow.gov?city=Example+Valley#2026-10-07-aqi-category-4', true, 'https://airnow.gov?city=Example+Valley'],
    ['an NWS alert has no revision', 'https://api.weather.gov/alerts/urn:oid:2.49.0.1', true, null],
    ['an outlet\'s article is never an incident', 'https://ktla.example/news/fire#comments', false, null],
  ])('incident: %s', (_, url, hazard, key) => {
    expect(incidentKey(url, hazard)).toBe(key);
  });
});

describe('new facts versus repeats, as the model\'s answer is applied (D86)', () => {
  const timeline = ['A brush fire broke out near the 210', 'About 150 acres burned'];

  test.each<[string, {storyId: number | null; newFacts: string[]}, {storyId: number | null; newFacts: string[]}]>([
    ['"Suspect arrested" is a new fact', {storyId: 1, newFacts: ['Suspect arrested']}, {storyId: 1, newFacts: ['Suspect arrested']}],
    ['a fifth outlet repeating the first four is a repeat', {storyId: 1, newFacts: []}, {storyId: 1, newFacts: []}],
    ['a "new" fact the timeline has, in other words, is a repeat', {storyId: 1, newFacts: ['About 150 acres have burned']}, {storyId: 1, newFacts: []}],
    ['only the new ones count', {storyId: 1, newFacts: ['About 150 acres burned', 'Evacuation warnings issued for foothill homes']}, {storyId: 1, newFacts: ['Evacuation warnings issued for foothill homes']}],
    ['the same new fact twice counts once', {storyId: 1, newFacts: ['Grew to 400 acres', 'It grew to 400 acres']}, {storyId: 1, newFacts: ['Grew to 400 acres']}],
    ['at most three', {storyId: 1, newFacts: ['One arrest made', 'Two roads closed', 'Three schools shut', 'Four shelters opened']}, {storyId: 1, newFacts: ['One arrest made', 'Two roads closed', 'Three schools shut']}],
    ['no story named: a story of its own', {storyId: null, newFacts: ['Something']}, {storyId: null, newFacts: []}],
    ['a story that wasn\'t a candidate: a story of its own', {storyId: 9, newFacts: ['Something']}, {storyId: null, newFacts: []}],
  ])('%s', (_, answer, applied) => {
    expect(applyGrouping(answer, [1, 2], timeline)).toEqual(applied);
  });

  test.each<[string, string[], string, string[]]>([
    ['a revision\'s fresh notes are its facts', ['The fire grew to 400 acres', 'It is 10% contained'], 'Foothill Fire: 400 acres, 10% contained', ['The fire grew to 400 acres', 'It is 10% contained']],
    ['notes the timeline has fall back to the headline: its numbers changed', ['A brush fire broke out near the 210'], 'Foothill Fire: 400 acres, 10% contained', ['Foothill Fire: 400 acres, 10% contained']],
  ])('hazard revision: %s', (_, notesFacts, headline, facts) => {
    expect(revisionFacts(notesFacts, headline, timeline)).toEqual(facts);
  });

  test('blank and repeated lines are dropped', () => {
    expect(freshFacts(['  ', 'Crews held the west flank', 'crews held the west flank.'], [])).toEqual(['Crews held the west flank']);
  });

  test.each<[string, string, string, string | null, string]>([
    ['when it was published', ago(3), ago(2), null, ago(3)],
    ['seen after it was published but before Setpoint had it: when Setpoint had it, so it reads as new', ago(3), ago(1), ago(2), ago(1)],
    ['seen before it was published: when it was published', ago(3), ago(1), ago(4), ago(3)],
    ['never after Setpoint had it (a feed\'s clock ahead)', ago(-1), ago(1), null, ago(1)],
  ])('a fact\'s time: %s', (_, published, fetched, seen, at) => {
    expect(factTime(published, fetched, seen)).toBe(at);
  });
});

const signals = (extra: Partial<RankSignals>): RankSignals => ({importance: 50, outlets: 1, local: false, distanceKm: null, lastNewFactAt: NOW, recentArticles: 1, now: NOW, ...extra});

describe('ranking (D86)', () => {
  test.each<[string, Partial<RankSignals>, number]>([
    ['a fresh one-outlet story, importance 50, elsewhere', {}, 47],
    ['nothing at all', {importance: 0, lastNewFactAt: ago(48)}, 4],
    ['the most of everything', {importance: 100, outlets: 12, local: true, distanceKm: 1, recentArticles: 9}, 100],
    ['more outlets', {outlets: 8}, 57],
    ['a day old', {lastNewFactAt: ago(24)}, 43],
    ['growing: three more in six hours', {recentArticles: 4}, 51],
    ['Local, close', {local: true, distanceKm: 3}, 51],
    ['Local, 80 km away', {local: true, distanceKm: 80}, 43],
    ['Local, place unknown: neutral', {local: true, distanceKm: null}, 47],
  ])('%s', (_, extra, score) => {
    expect(storyScore(signals(extra))).toBe(score);
  });

  test('the bar: a fresh one-outlet story needs an importance of about 33', () => {
    expect(storyScore(signals({importance: 33}))).toBeGreaterThanOrEqual(STORY_BAR);
    expect(storyScore(signals({importance: 28}))).toBeLessThan(STORY_BAR);
    // A minor story falls under it as it ages.
    expect(storyScore(signals({importance: 40, lastNewFactAt: ago(36)}))).toBeLessThan(STORY_BAR);
  });

  test('order: importance leads; outlets, closeness, recency and growth break near ties', () => {
    const stories = [
      {id: 1, name: 'brush fire, close, 5 outlets, growing', ...signals({importance: 80, outlets: 5, local: true, distanceKm: 6, recentArticles: 4, lastNewFactAt: ago(1)})},
      {id: 2, name: 'a stabbing arrest, 3 outlets', ...signals({importance: 70, outlets: 3, local: true, distanceKm: 15, lastNewFactAt: ago(5)})},
      {id: 3, name: 'a car-wash raid yesterday', ...signals({importance: 72, outlets: 4, local: true, distanceKm: 40, lastNewFactAt: ago(26)})},
      {id: 4, name: 'a housing vote on Monday, one outlet', ...signals({importance: 55, local: true, distanceKm: 20, lastNewFactAt: ago(40)})},
      {id: 5, name: 'a minor closure far away', ...signals({importance: 30, local: true, distanceKm: 70, lastNewFactAt: ago(10)})},
    ].map(row => ({...row, score: storyScore(row)}));
    expect(rankOrder(stories).map(row => row.name)).toEqual([
      'brush fire, close, 5 outlets, growing', 'a stabbing arrest, 3 outlets', 'a car-wash raid yesterday', 'a housing vote on Monday, one outlet', 'a minor closure far away',
    ]);
    expect(stories.find(row => row.id === 5)!.score).toBeLessThan(STORY_BAR);
    // Ties: the newest fact, then the newest story.
    expect(rankOrder([{id: 1, score: 50, lastNewFactAt: ago(2)}, {id: 2, score: 50, lastNewFactAt: ago(1)}, {id: 3, score: 50, lastNewFactAt: ago(1)}]).map(row => row.id)).toEqual([3, 2, 1]);
  });
});

describe('models and cost (D90)', () => {
  test.each<[string, number, number, string]>([
    ['under the cap: Sonnet writes summaries', 18.4, 40, NEWS_MODELS.stories],
    ['at the cap: Haiku for the rest of the month', 40, 40, NEWS_MODELS.articles],
    ['past it', 41.2, 40, NEWS_MODELS.articles],
    ['a cap of nothing: Haiku from the start', 0, 0, NEWS_MODELS.articles],
  ])('%s', (_, spent, cap, model) => {
    expect(summaryModel(spent, cap)).toBe(model);
  });

  test('the models are Haiku 5.5 and Sonnet 5.5', () => {
    expect(NEWS_MODELS).toEqual({articles: 'claude-haiku-5-5', stories: 'claude-sonnet-5-5'});
  });

  test.each<[string, string]>([
    ['2026-10-07T16:12:00.000Z', '2026-10-01T07:00:00.000Z'],
    // Still September on the user's clock.
    ['2026-10-01T03:00:00.000Z', '2026-09-01T07:00:00.000Z'],
    ['2026-12-01T08:00:00.000Z', '2026-12-01T08:00:00.000Z'],
  ])('the month starts at local midnight on the 1st: %s', (now, start) => {
    expect(monthStart(now, ZONE)).toBe(start);
  });

  test.each<[string, '5m' | '1h', number]>([
    ['five-minute cache writes at 1.25× input', '5m', 1000 * 2 * 1.25 + 1000 * 2 + 100 * 10],
    ['the ranking\'s hour-long cache writes at 2×', '1h', 1000 * 2 * 2 + 1000 * 2 + 100 * 10],
  ])('%s', (_, ttl, micros) => {
    expect(costMicros('anthropic', 'claude-sonnet-5-5', {inputTokens: 2000, cachedTokens: 0, cacheWriteTokens: 1000, outputTokens: 100}, ttl)).toBe(micros);
  });
});

describe('Missed\'s limits (D87)', () => {
  const missed = (id: number, section: NewsSection, expired: string) => ({id, section, expired_at: expired});

  test('at most five per section per day, biggest first as given', () => {
    const tuesday = '2026-10-06T18:00:00.000Z';
    const stories = [
      ...Array.from({length: 7}, (_, index) => missed(index + 1, 'local', tuesday)),
      missed(8, 'tech', tuesday),
      // Monday's Local is its own day.
      missed(9, 'local', '2026-10-05T18:00:00.000Z'),
    ];
    expect(limitMissed(stories, ZONE).map(story => story.id)).toEqual([1, 2, 3, 4, 5, 8, 9]);
  });

  test('a day is the user\'s local day', () => {
    // 11 PM Tuesday and 1 AM Wednesday, Pacific.
    const stories = [...Array.from({length: 5}, (_, index) => missed(index + 1, 'ai', '2026-10-07T06:00:00.000Z')), missed(6, 'ai', '2026-10-07T08:00:00.000Z')];
    expect(limitMissed(stories, ZONE).map(story => story.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

const claim = (outlet: string, extra: Partial<KeynoteClaim> = {}): KeynoteClaim => ({
  company: 'Apple', name: 'Apple event', startsAt: '2026-10-20T17:00:00.000Z', allDay: false, outlet, wireKey: null, firstParty: null, ...extra,
});

describe('keynote confirmation (BRIEF.md › The page › Upcoming)', () => {
  test.each<[string, KeynoteClaim[], {name: string; startsAt: string; allDay: boolean} | null]>([
    ['one outlet\'s invite headline isn\'t enough', [claim('MacRumors')], null],
    ['a second outlet confirms it', [claim('MacRumors'), claim('The Verge')], {name: 'Apple event', startsAt: '2026-10-20T17:00:00.000Z', allDay: false}],
    ['the company itself confirms it', [claim('Apple Newsroom', {firstParty: 'apple'})], {name: 'Apple event', startsAt: '2026-10-20T17:00:00.000Z', allDay: false}],
    ['another company\'s newsroom doesn\'t', [claim('Google · The Keyword', {firstParty: 'google'})], null],
    ['wire copy is one outlet', [claim('ABC News', {wireKey: 'ap'}), claim('PBS News', {wireKey: 'ap'})], null],
    ['two outlets on different days don\'t confirm each other', [claim('MacRumors'), claim('The Verge', {startsAt: '2026-10-27T17:00:00.000Z'})], null],
    ['the company\'s time wins', [claim('MacRumors', {startsAt: '2026-10-20T16:00:00.000Z'}), claim('Apple Newsroom', {firstParty: 'apple'})], {name: 'Apple event', startsAt: '2026-10-20T17:00:00.000Z', allDay: false}],
    ['without the company, the time most give', [claim('MacRumors'), claim('The Verge'), claim('9to5Mac', {startsAt: '2026-10-20T18:00:00.000Z'})], {name: 'Apple event', startsAt: '2026-10-20T17:00:00.000Z', allDay: false}],
    ['a date with no time is all day', [claim('MacRumors', {allDay: true, startsAt: '2026-10-20T07:00:00.000Z'}), claim('The Verge', {allDay: true, startsAt: '2026-10-20T07:00:00.000Z'})], {name: 'Apple event', startsAt: '2026-10-20T07:00:00.000Z', allDay: true}],
  ])('%s', (_, claims, confirmed) => {
    const out = confirmKeynote(claims, ZONE);
    expect(out && {name: out.name, startsAt: out.startsAt, allDay: out.allDay}).toEqual(confirmed);
  });

  test.each<[string, unknown, {name: string; startsAt: string; allDay: boolean} | null]>([
    ['"10 a.m. PT" on Oct 20', {company: 'Apple', date: '2026-10-20', time: '10:00', time_zone: 'America/Los_Angeles'}, {name: 'Apple event', startsAt: '2026-10-20T17:00:00.000Z', allDay: false}],
    ['a date alone is all day, from local midnight', {company: 'Samsung', date: '2026-11-04', time: null, time_zone: null}, {name: 'Samsung event', startsAt: '2026-11-04T08:00:00.000Z', allDay: true}],
    ['a time with no zone is all day too', {company: 'Google', date: '2026-10-21', time: '10:00', time_zone: null}, {name: 'Google event', startsAt: '2026-10-21T07:00:00.000Z', allDay: true}],
    ['a date that doesn\'t exist', {company: 'Apple', date: '2026-02-30', time: null, time_zone: null}, null],
    ['no company', {company: '', date: '2026-10-20', time: null, time_zone: null}, null],
    ['none', null, null],
  ])('reading a keynote: %s', (_, value, keynote) => {
    const out = keynoteOf(value, ZONE);
    expect(out && {name: out.name, startsAt: out.startsAt, allDay: out.allDay}).toEqual(keynote);
  });
});

describe('reading the models\' answers', () => {
  test('an article: field by field, dropping what doesn\'t fit', () => {
    expect(notesOf({
      kind: 'event', subject: 'local', sections: ['local', 'sports', 'local'], facts: ['  A brush fire broke out ', 7, 'null'], importance: 140,
      place: {lat: 34.2, lng: -118.2}, keynote: null,
    }, ZONE)).toEqual({kind: 'event', subject: 'local', sections: ['local'], facts: ['A brush fire broke out'], importance: 100, place: {lat: 34.2, lng: -118.2}, keynote: null});
    expect(notesOf({kind: 'scandal', subject: 'local'}, ZONE)).toBeNull();
    expect(notesOf(null, ZONE)).toBeNull();
  });

  test('grouping, a story and the ranking', () => {
    expect(groupingOf({story_id: 4, new_facts: ['Suspect arrested', '']})).toEqual({storyId: 4, newFacts: ['Suspect arrested']});
    expect(groupingOf(null)).toEqual({storyId: null, newFacts: []});
    expect(writtenOf({headline: ' Brush fire grows ', one_line: 'Warnings widened', summary: 'Text.', lead_article_id: 3, image_article_id: null}))
      .toEqual({headline: 'Brush fire grows', oneLine: 'Warnings widened', summary: 'Text.', leadArticleId: 3, imageArticleId: null});
    expect(writtenOf({headline: ''})).toBeNull();
    expect([...rankingOf({stories: [{id: 1, importance: 80}, {id: 2, importance: 120}, {id: 'x', importance: 3}]}).entries()]).toEqual([[1, 80], [2, 100]]);
  });
});

describe('search\'s matching (D91)', () => {
  test.each<[string, string, string, boolean]>([
    ['every word, as a prefix', 'warehouse ohio', 'Four killed in a warehouse shooting in Ohio', true],
    ['a prefix', 'wareh', 'Four killed in a warehouse shooting', true],
    ['all words are needed', 'warehouse texas', 'Four killed in a warehouse shooting in Ohio', false],
    ['accents and case fold', 'cafe', 'Café owner arrested', true],
    ['an outlet\'s name', 'pbs', 'Four killed\nPBS News', true],
    ['nothing searched finds nothing', '  ', 'Anything', false],
  ])('%s', (_, query, text, found) => {
    expect(matchesAll(searchWords(query), text)).toBe(found);
  });
});
