// News's sorting rules (N3; BRIEF.md › News › What it covers, Stories, Ranking, Models and cost,
// Missed; D86–D91): the rules that map a source to a likely section, the noise and politics policy
// as applied to the model's reading of an article, wire copy, candidate matching and how a grouping
// answer is applied (new facts versus repeats), the ranking formula and the bar, the monthly cap,
// Missed's limits, keynote confirmation, and search's matching. Pure, so each is tested as a table;
// src/news/sorter.ts asks the models and keeps what these decide.
import type {NewsSection} from '@setpoint/shared';
import {NEWS_SECTIONS} from '@setpoint/shared';
import {SUBJECT_SECTION} from './news.ts';
import {distanceKm, outletOf} from './newsIngest.ts';
import {fold, wordsOf} from './searchChips.ts';
import {localDay, zonedInstant} from './time.ts';

const HOUR = 60 * 60_000;

// ---- Each article: the rules first ----

/** Adapters that read official hazard data: always Local, always a hazard (weather counts only as one). */
const HAZARD_ADAPTERS = new Set(['nws', 'usgs', 'cal_fire', 'airnow']);

/** First-party newsrooms, by the company they speak for: one confirms its own keynote on its own. */
export const FIRST_PARTY = ['apple', 'google', 'samsung', 'microsoft', 'openai', 'anthropic', 'deepmind', 'hugging face', 'mistral', 'meta'] as const;

export interface SourceRule {
  // The section the source's articles most likely belong to.
  section: NewsSection;
  // Official hazard data: Local, never noise.
  hazard: boolean;
  // Hacker News: only a tech or AI subject counts.
  subjectCheck: boolean;
  // The company a first-party newsroom speaks for ("apple"), else null.
  firstParty: string | null;
}

/**
 * What the source alone says about its articles, before any model reads them. A newsroom is first-party
 * by its outlet's name (its config's, else its name's before " · "), the company a whole word of it,
 * so The Verge's Apple feed and 9to5Google speak for no company and Claude's release notes, whose
 * outlet is Anthropic, for Anthropic.
 */
export function sourceRule(source: {section: NewsSection; adapter: string; kind: string; name: string; config?: Record<string, unknown>}): SourceRule {
  const hazard = HAZARD_ADAPTERS.has(source.adapter);
  const subjectCheck = source.adapter === 'hn_algolia';
  const words = ` ${fold(outletOf(source.name, source.config ?? {}).outlet).replace(/[^a-z0-9]+/g, ' ')} `;
  const firstParty = (source.kind === 'feed' || source.kind === 'page_read') && !subjectCheck && (source.section === 'tech' || source.section === 'ai')
    ? FIRST_PARTY.find(company => words.includes(` ${company} `)) ?? null
    : null;
  return {section: hazard ? 'local' : source.section, hazard, subjectCheck, firstParty};
}

// ---- … then the model's reading, then the policy ----

/**
 * What an article is, as the model reads it. `event` is news in BRIEF's sense (something happened or
 * takes effect); every other kind is something D88 leaves out, `politics_argument` (campaigns, polls,
 * reactions, hearings, bills being debated) unless its subject wins.
 */
export const ARTICLE_KINDS = [
  'event', 'politics_argument', 'sports', 'entertainment', 'opinion', 'sponsored', 'deal', 'weather_forecast',
  'lifestyle', 'events_listing', 'rumor', 'review', 'buying_guide', 'tutorial', 'customer_story', 'funding', 'world',
] as const;
export type ArticleKind = (typeof ARTICLE_KINDS)[number];

/** What an article is about, whatever the politics around it. */
export const ARTICLE_SUBJECTS = ['local', 'tech', 'ai', 'us', 'world', 'other'] as const;
export type ArticleSubject = (typeof ARTICLE_SUBJECTS)[number];

/** A keynote an article reports was announced ("Apple sends invites for an Oct 20 event"). */
export interface KeynoteNote {
  company: string;
  name: string;
  startsAt: string;
  allDay: boolean;
}

/** The model's reading of one article (Claude Haiku 5.5): Haiku's fact notes, which stories are written from. */
export interface ArticleNotes {
  sections: NewsSection[];
  kind: ArticleKind;
  subject: ArticleSubject;
  facts: string[];
  // How much it matters, 0–100, against its section's guide.
  importance: number;
  // Where it happened, for Local's closeness; null when the article doesn't say.
  place: {lat: number; lng: number} | null;
  keynote: KeynoteNote | null;
}

export type NoiseReason = Exclude<ArticleKind, 'event'> | 'off_subject';

export type Verdict = {keep: true; sections: NewsSection[]} | {keep: false; reason: NoiseReason};

/** Which sections a subject may sit in: Local is the area's, General the US's, and a lab's news can make Tech's. */
const ALLOWED: Record<ArticleSubject, readonly NewsSection[]> = {
  local: ['local', 'general'],
  tech: ['tech', 'general'],
  ai: ['ai', 'tech', 'general'],
  us: ['general'],
  world: [],
  other: NEWS_SECTIONS,
};

const inOrder = (sections: Iterable<NewsSection>) => {
  const set = new Set(sections);
  return NEWS_SECTIONS.filter(section => set.has(section));
};

/**
 * The policy (D88), applied to the model's reading:
 * - Official hazard data is Local and always kept.
 * - Sports, entertainment, opinion, sponsored posts, deals and forecasts are never news; nor is what a
 *   section leaves out (lifestyle and listings, rumors and reviews and buying guides, tutorials and
 *   customer stories and funding rounds, world news).
 * - Politics is events, not arguments, but the subject wins: an argument whose subject is tech or AI
 *   ("OpenAI testifies before Congress") is kept in that section; any other is noise. A ruling, a law
 *   taking effect or a council's vote is an event already.
 * - Hacker News counts only on a tech or AI subject.
 * - The model's sections are kept where the subject allows them; with none left, the subject's own
 *   section, else the source's.
 */
export function judgeArticle(rule: SourceRule, notes: ArticleNotes): Verdict {
  if (rule.hazard) return {keep: true, sections: ['local']};
  if (rule.subjectCheck && notes.subject !== 'tech' && notes.subject !== 'ai') return {keep: false, reason: 'off_subject'};
  if (notes.kind === 'politics_argument') {
    if (notes.subject === 'tech' || notes.subject === 'ai') return {keep: true, sections: [notes.subject]};
    return {keep: false, reason: 'politics_argument'};
  }
  if (notes.kind !== 'event') return {keep: false, reason: notes.kind};
  if (notes.subject === 'world') return {keep: false, reason: 'world'};
  let allowed = ALLOWED[notes.subject];
  if (rule.subjectCheck) allowed = allowed.filter(section => section === 'tech' || section === 'ai');
  const sections = inOrder(notes.sections.filter(section => allowed.includes(section)));
  if (sections.length) return {keep: true, sections};
  const own = SUBJECT_SECTION[notes.subject];
  return {keep: true, sections: [own && allowed.includes(own) ? own : rule.section]};
}

// ---- Wire copy ----

/**
 * A wire story's text is recognised by its opening words, which outlets that republish it keep while
 * adding their own tail; a shorter text is too generic to tell.
 */
export const WIRE_MIN_WORDS = 30;

/** The opening words of an article's text, as its wire key; null when it's too short to tell copies apart. */
export function wireKey(text: string | null | undefined): string | null {
  const words = wordsOf(text ?? '');
  return words.length < WIRE_MIN_WORDS ? null : words.slice(0, WIRE_MIN_WORDS).join(' ');
}

/**
 * How many outlets cover a story, identical wire copy counting once (D86: AP text republished by ABC
 * and PBS is one outlet). Outlets that ran the same text are one; a metered paper counts (D89).
 */
export function outletCount(articles: readonly {outlet: string; wireKey: string | null}[]): number {
  const parent = new Map<string, string>();
  const find = (outlet: string): string => {
    const up = parent.get(outlet) ?? outlet;
    if (up === outlet) return outlet;
    const root = find(up);
    parent.set(outlet, root);
    return root;
  };
  const byKey = new Map<string, string>();
  for (const article of articles) {
    if (!parent.has(article.outlet)) parent.set(article.outlet, article.outlet);
    if (!article.wireKey) continue;
    const first = byKey.get(article.wireKey);
    if (first === undefined) byKey.set(article.wireKey, article.outlet);
    else parent.set(find(article.outlet), find(first));
  }
  return new Set([...parent.keys()].map(find)).size;
}

// ---- Grouping: cheap candidates, then the model confirms ----

const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
  'over', 'says', 'said', 'than', 'that', 'the', 'their', 'this', 'to', 'up', 'was', 'were', 'will', 'with', 'after', 'new', 'more',
]);

/** The words that tell one event from another: folded, without filler. */
export function significantWords(...texts: (string | null | undefined)[]): Set<string> {
  return new Set(texts.flatMap(text => wordsOf(text ?? '')).filter(word => word.length > 1 && !STOP.has(word)));
}

/**
 * A hazard's incident: the revision of its page N2 made it (Cal Fire's acres and containment, AirNow's
 * day and category) without the revision, so each revision joins the same story. Null for anything
 * else, which only the model can group.
 */
export function incidentKey(canonicalUrl: string, hazard: boolean): string | null {
  if (!hazard) return null;
  const at = canonicalUrl.indexOf('#');
  return at > 0 ? canonicalUrl.slice(0, at) : null;
}

export interface MatchableStory {
  id: number;
  words: Set<string>;
  incidents: ReadonlySet<string>;
  wireKeys: ReadonlySet<string>;
}

export interface MatchableArticle {
  words: Set<string>;
  incident: string | null;
  wireKey: string | null;
}

/**
 * A story the article certainly belongs to without asking a model: the same hazard incident (each
 * revision a new fact), or the same wire text (a repeat).
 */
export function ruleMatch(article: MatchableArticle, stories: readonly MatchableStory[]): {storyId: number; by: 'incident' | 'wire'} | null {
  if (article.incident) {
    const story = stories.find(candidate => candidate.incidents.has(article.incident!));
    if (story) return {storyId: story.id, by: 'incident'};
  }
  if (article.wireKey) {
    const story = stories.find(candidate => candidate.wireKeys.has(article.wireKey!));
    if (story) return {storyId: story.id, by: 'wire'};
  }
  return null;
}

/** At least this share of the smaller side's words in common, and at least two words, makes a candidate. */
export const CANDIDATE_OVERLAP = 0.3;
export const CANDIDATES_MAX = 3;

/**
 * The likely stories for an article, closest first: those sharing enough of its words (the overlap
 * of the article's headline and facts with the story's headline, facts and sources' headlines). Only
 * these go to the model, which confirms whether one is the same event.
 */
export function candidates(article: MatchableArticle, stories: readonly MatchableStory[], max = CANDIDATES_MAX): {id: number; overlap: number}[] {
  return stories.flatMap(story => {
    const shared = [...article.words].filter(word => story.words.has(word)).length;
    const smaller = Math.min(article.words.size, story.words.size);
    const overlap = smaller ? shared / smaller : 0;
    return shared >= 2 && overlap >= CANDIDATE_OVERLAP ? [{id: story.id, overlap}] : [];
  }).sort((a, b) => b.overlap - a.overlap || b.id - a.id).slice(0, max);
}

/** Two fact lines say the same thing: the same words, or nearly all of the shorter one's. */
export function sameFact(a: string, b: string): boolean {
  const left = significantWords(a);
  const right = significantWords(b);
  if (!left.size || !right.size) return fold(a).trim() === fold(b).trim();
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / Math.min(left.size, right.size) >= 0.8;
}

/** A story's facts per update, at most. */
export const FACTS_MAX = 3;

/** Facts that aren't already on the timeline (or said twice), at most FACTS_MAX. */
export function freshFacts(facts: readonly string[], existing: readonly string[]): string[] {
  const kept: string[] = [];
  for (const raw of facts) {
    const fact = raw.replace(/\s+/g, ' ').trim();
    if (!fact || [...existing, ...kept].some(other => sameFact(fact, other))) continue;
    kept.push(fact);
    if (kept.length === FACTS_MAX) break;
  }
  return kept;
}

/**
 * The model's grouping answer, applied: the story it names, only if it was one of the candidates
 * (else the article starts its own story), and the facts it says the article brings, less those the
 * timeline already has. No fact left is a repeat: "Suspect arrested" is a new fact; a fifth outlet
 * repeating the first four isn't (D86).
 */
export function applyGrouping(answer: {storyId: number | null; newFacts: string[]}, candidateIds: readonly number[], existingFacts: readonly string[]): {storyId: number | null; newFacts: string[]} {
  if (answer.storyId === null || !candidateIds.includes(answer.storyId)) return {storyId: null, newFacts: []};
  return {storyId: answer.storyId, newFacts: freshFacts(answer.newFacts, existingFacts)};
}

/**
 * A hazard revision's facts: what its notes say that the timeline doesn't, else its headline ("Ridge
 * Fire: 400 acres, 20% contained"), since a revision only exists because its numbers changed.
 */
export function revisionFacts(notesFacts: readonly string[], headline: string, existing: readonly string[]): string[] {
  const fresh = freshFacts(notesFacts, existing);
  return fresh.length ? fresh : freshFacts([headline], existing);
}

/**
 * When a fact happened on the timeline: when its article was published, unless the user saw the story
 * after that and before Setpoint had the article, when it's the time Setpoint had it, so the fact
 * still reads as new since they looked. Never after Setpoint had it.
 */
export function factTime(publishedAt: string, fetchedAt: string, seenAt: string | null): string {
  const at = publishedAt > fetchedAt ? fetchedAt : publishedAt;
  return seenAt !== null && at <= seenAt && fetchedAt > seenAt ? fetchedAt : at;
}

// ---- Ranking (D86) ----

/** A story under this never shows: noise is cut before, and the bar leaves a day at roughly 30–50 stories. */
export const STORY_BAR = 35;

/** Closeness is full within this distance of home and none past CLOSE_NONE_KM. */
const CLOSE_FULL_KM = 5;
const CLOSE_NONE_KM = 80;

export interface RankSignals {
  // The model's judgement, 0–100: Haiku's per article, then Sonnet's hourly for the story.
  importance: number;
  // Outlets, wire copy once.
  outlets: number;
  local: boolean;
  // Distance from the home location, when both are known.
  distanceKm: number | null;
  lastNewFactAt: string;
  // Articles that joined in the last six hours: growth.
  recentArticles: number;
  now: string;
}

/**
 * "Biggest" (D86), 0–100: how much it matters (70), how many outlets cover it (10: one is nothing
 * extra, eight or more is all), how recent its last new fact is (8, gone over 48 hours), how fast it's
 * growing (4: three more articles in six hours), and for Local how close it is (8, full within 5 km
 * and none past 80; a story elsewhere, or one whose place isn't known, gets half). A one-outlet story
 * needs the model's importance at about 33 to clear the bar while it's fresh.
 */
export function storyScore(signals: RankSignals): number {
  const importance = Math.min(100, Math.max(0, signals.importance)) * 0.7;
  const outlets = 10 * Math.min(1, Math.log2(Math.max(1, signals.outlets)) / 3);
  const hours = Math.max(0, (Date.parse(signals.now) - Date.parse(signals.lastNewFactAt)) / HOUR);
  const recency = 8 * Math.max(0, 1 - hours / 48);
  const growth = 4 * Math.min(1, Math.max(0, signals.recentArticles - 1) / 3);
  let closeness = 4;
  if (signals.local && signals.distanceKm !== null) {
    closeness = 8 * Math.min(1, Math.max(0, (CLOSE_NONE_KM - signals.distanceKm) / (CLOSE_NONE_KM - CLOSE_FULL_KM)));
  }
  return Math.round(Math.min(100, importance + outlets + recency + growth + closeness));
}

/** The nearest of a story's places to home, in km; null when neither is known. */
export function nearestKm(home: {lat: number; lng: number} | null, places: readonly {lat: number; lng: number}[]): number | null {
  if (!home || !places.length) return null;
  return Math.min(...places.map(place => distanceKm(home, place)));
}

/** Biggest first: by score, then the newest fact, then the newest story (as the page reads them). */
export function rankOrder<S extends {id: number; score: number; lastNewFactAt: string}>(stories: readonly S[]): S[] {
  return [...stories].sort((a, b) => b.score - a.score || b.lastNewFactAt.localeCompare(a.lastNewFactAt) || b.id - a.id);
}

// ---- Models and cost (D90) ----

export const NEWS_MODELS = {articles: 'claude-haiku-5-5', stories: 'claude-sonnet-5-5'} as const;

/** Which model writes story summaries: Sonnet, until this month's News spend reaches the cap; then Haiku for the rest of the month. */
export function summaryModel(spentUsd: number, capUsd: number): string {
  return spentUsd >= capUsd ? NEWS_MODELS.articles : NEWS_MODELS.stories;
}

/** The month's start for the cap and "Usage this month": local midnight on the 1st. */
export function monthStart(now: string, timeZone: string): string {
  return zonedInstant(`${localDay(now, timeZone).slice(0, 8)}01`, '00:00', timeZone);
}

/** How often the ranking runs: under the hour, so its prompt's hour-long cache is still warm. */
export const RANK_EVERY_MS = 55 * 60_000;

// ---- Missed (D87) ----

/** Catch up lists at most this many per section per day, biggest first. */
export const MISSED_PER_SECTION_PER_DAY = 5;

/**
 * Missed's limit: stories in the order given (biggest first), at most five per section (the one its
 * row names) per local day it left the page; the rest never show in Missed.
 */
export function limitMissed<S extends {section: NewsSection; expired_at: string}>(stories: readonly S[], timeZone: string, max = MISSED_PER_SECTION_PER_DAY): S[] {
  const counts = new Map<string, number>();
  return stories.filter(story => {
    const key = `${localDay(story.expired_at, timeZone)}:${story.section}`;
    const count = counts.get(key) ?? 0;
    if (count >= max) return false;
    counts.set(key, count + 1);
    return true;
  });
}

// ---- Upcoming (BRIEF.md › The page) ----

export interface KeynoteClaim extends KeynoteNote {
  outlet: string;
  wireKey: string | null;
  // The company a first-party newsroom speaks for, when the claim is its own.
  firstParty: string | null;
}

const companyKey = (company: string) => fold(company).replace(/[^a-z0-9]+/g, ' ').trim();

/** "Apple event": the company's name, as the page shows it. */
export const keynoteName = (company: string) => `${company.trim()} event`;

/**
 * A keynote, once confirmed: an invite reported by a second outlet (wire copy once) or by the company
 * itself. Claims are grouped by company and day; the first confirmed one wins, with the company's own
 * time when it gave one, else the time most claims give, else all day.
 */
export function confirmKeynote(claims: readonly KeynoteClaim[], timeZone: string): {company: string; name: string; startsAt: string; allDay: boolean} | null {
  const groups = new Map<string, KeynoteClaim[]>();
  for (const claim of claims) {
    const key = `${companyKey(claim.company)}:${localDay(claim.startsAt, timeZone)}`;
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  for (const group of groups.values()) {
    const company = companyKey(group[0]!.company);
    const own = group.filter(claim => claim.firstParty !== null && company.includes(claim.firstParty));
    if (!own.length && outletCount(group) < 2) continue;
    const timed = (own.length ? own : group).filter(claim => !claim.allDay);
    const votes = new Map<string, number>();
    for (const claim of timed) votes.set(claim.startsAt, (votes.get(claim.startsAt) ?? 0) + 1);
    const startsAt = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    const first = (own[0] ?? group[0])!;
    return startsAt
      ? {company: first.company, name: keynoteName(first.company), startsAt, allDay: false}
      : {company: first.company, name: keynoteName(first.company), startsAt: zonedInstant(localDay(first.startsAt, timeZone), '00:00', timeZone), allDay: true};
  }
  return null;
}

// ---- Search (D91) ----

/** The words of a search, folded. */
export const searchWords = (query: string) => [...new Set(wordsOf(query))];

/** Every word of the search begins some word of the text (all required, as mail's search). */
export function matchesAll(words: readonly string[], text: string): boolean {
  if (!words.length) return false;
  const have = wordsOf(text);
  return words.every(word => have.some(candidate => candidate.startsWith(word)));
}
