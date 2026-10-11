// What News asks the models and how it reads their answers (N3; BRIEF.md › News › What it covers,
// Stories, Ranking, Models and cost; D86, D88, D90). Four prompts, each answered through one tool:
// - each article (Claude Haiku 5.5): its sections, what kind of thing it is and what it's about (the
//   noise and politics policy is applied to that answer in src/domain/newsSorting.ts), its key facts,
//   its importance against the section's guide, where it happened, and a keynote it announces;
// - grouping (Haiku): whether an article is about one of a few likely stories, and what facts it adds;
// - a story (Claude Sonnet 5.5, Haiku past the monthly cap): the neutral headline, the one line and
//   the summary, from Haiku's fact notes, with the lead article and the best image;
// - the hourly ranking (Sonnet): each story's importance against the day's others, on a prompt cached
//   for an hour.
// Each system prompt is fixed text, so its cached prefix holds; what changes rides in the input.
// Answers are read leniently, field by field: what doesn't fit is dropped, and only an answer missing
// what the step can't do without is unusable (null).
import {NEWS_SECTIONS} from '@setpoint/shared';
import type {NewsSection} from '@setpoint/shared';
import {ARTICLE_KINDS, ARTICLE_SUBJECTS, keynoteName} from '../domain/newsSorting.ts';
import type {ArticleKind, ArticleNotes, ArticleSubject, KeynoteNote} from '../domain/newsSorting.ts';
import {zonedInstant} from '../domain/time.ts';
import type {ToolSpec} from '../providers/ai/index.ts';

/** Bumped when a prompt or tool changes. */
export const NEWS_PROMPT_VERSION = 'n3-v1';

/** An article's text is cut here: its opening says what happened. */
export const ARTICLE_TEXT_LIMIT = 6_000;

const SECTION_GUIDES = `Sections and what matters in each (judge importance against these guides):
- local: the user's area, around the home area given with each article: crime and public safety, ICE raids and detentions, fires and other hazards, closures, local government decisions with a real effect. Most important: public safety, hazards, ICE activity, closures. Not: countywide fluff, events listings, food and lifestyle.
- tech: real launches and announcements from Apple, Google, Samsung, Microsoft and the like, and upcoming keynotes. Most important: real launches from those companies. Not: rumors, leaks, deals, reviews, buying guides.
- ai: releases, features and incidents at Anthropic, OpenAI, Google DeepMind, Meta, Hugging Face, Mistral and the like, and big AI headlines. Most important: releases and incidents at the major labs. Not: tutorials, customer stories, funding rounds.
- general: US events: shootings, ICE incidents, disasters, laws taking effect, court rulings with real effect, shutdowns. Not: world news.

Importance, 0 to 100:
- 80–100: a major event: a hurricane making landfall, an evacuation order, a major model or product release, a mass shooting, a ruling or law with wide effect.
- 50–79: notable: an arrest in a serious local crime, a real product launch, a lab's new feature, a court ruling with real effect.
- 30–49: minor but real news someone in the area or the field would want to know.
- 0–29: barely news.`;

const POLICY = `What counts (decide kind and subject; Setpoint applies the policy to your answer):
- Never news anywhere: sports, entertainment and celebrity, opinion and analysis, sponsored posts, deals and sales. Weather counts only as a hazard (fire, flood, storms, hurricanes, disasters); a forecast is weather_forecast.
- Politics: events, not arguments. A raid, a law taking effect, a court ruling, a shutdown, a council's vote are events. Campaigns, polls, reactions, hearings, and bills being debated before they pass are politics_argument.
- The subject wins over politics: "OpenAI testifies before Congress" is about AI (subject ai); an antitrust ruling against Google is about tech (subject tech, an event); a council vote on a housing project in the area is local (subject local, an event).
- Each section's "Not" list has its own kind: lifestyle, events_listing, rumor, review, buying_guide, tutorial, customer_story, funding, world (news outside the US that isn't about tech or AI).`;

export const ARTICLE_SYSTEM = `You read one news article for the user's personal news page, which sorts the day's news so a look takes minutes. Answer only with the submit_news_article tool.

${SECTION_GUIDES}

${POLICY}

Fields:
- kind: event when something happened or takes effect (a launch, a release, an incident, a ruling, an arrest, a hazard, a closure); otherwise the kind that describes it.
- subject: what the article is about whatever the politics around it: local (the home area), tech, ai, us (the rest of the United States), world, or other.
- sections: where it belongs, one or more (an Anthropic release that made national news is ai and general).
- facts: one to four short lines, each a single concrete fact the article states: who, what, numbers, times, places. Only what it says; never guess. No outlet names.
- importance: against its section's guide, as above.
- place: for an article about one place in the home area, its latitude and longitude as best you know them; otherwise null.
- keynote: only when the article reports that a company has announced or sent invites for a keynote or launch event ("Apple sends invites for an Oct 20 event"): the company, the event's date as YYYY-MM-DD, its start time as HH:MM in 24 hours with its IANA time zone (America/Los_Angeles for "10 a.m. PT"), each null when not given. Otherwise null.`;

const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]});

export const ARTICLE_TOOL: ToolSpec = {
  name: 'submit_news_article',
  description: 'Submit how one news article is sorted and the facts it states.',
  schema: {
    type: 'object',
    properties: {
      kind: {type: 'string', enum: [...ARTICLE_KINDS]},
      subject: {type: 'string', enum: [...ARTICLE_SUBJECTS]},
      sections: {type: 'array', items: {type: 'string', enum: [...NEWS_SECTIONS]}},
      facts: {type: 'array', items: {type: 'string'}, maxItems: 4},
      importance: {type: 'integer', minimum: 0, maximum: 100},
      place: nullable({type: 'object', properties: {lat: {type: 'number'}, lng: {type: 'number'}}, required: ['lat', 'lng']}),
      keynote: nullable({
        type: 'object',
        properties: {company: {type: 'string'}, date: {type: 'string', description: 'YYYY-MM-DD'}, time: nullable({type: 'string', description: 'HH:MM'}), time_zone: nullable({type: 'string'})},
        required: ['company', 'date', 'time', 'time_zone'],
      }),
    },
    required: ['kind', 'subject', 'sections', 'facts', 'importance', 'place', 'keynote'],
  },
};

export interface PromptArticle {
  source: string;
  outlet: string;
  headline: string;
  publishedAt: string;
  summary: string | null;
  text: string | null;
}

/**
 * The article as the model reads it, with the home area for Local: the home location to a tenth of a
 * degree (about 10 km), enough to tell the area without saying where home is.
 */
export function articleInput(article: PromptArticle, sourceSection: NewsSection, home: {lat: number; lng: number} | null): string {
  const text = article.text?.trim() ?? '';
  return [
    `Source: ${article.source} (usually ${sourceSection})`,
    `Outlet: ${article.outlet}`,
    `Published: ${article.publishedAt}`,
    home ? `Home area: near ${home.lat.toFixed(1)}, ${home.lng.toFixed(1)}` : 'Home area: not set',
    `Headline: ${article.headline}`,
    ...(article.summary ? [`Summary: ${article.summary}`] : []),
    ...(text ? ['', 'Text:', text.length > ARTICLE_TEXT_LIMIT ? `${text.slice(0, ARTICLE_TEXT_LIMIT)}\n[The rest was cut.]` : text] : []),
  ].join('\n');
}

export const GROUPING_SYSTEM = `You decide whether a new news article is about the same event as one of a few existing stories on the user's news page, and what it adds. Answer only with the submit_news_grouping tool.

- The same event means the same incident, announcement or decision: the same fire, the same arrest, the same product launch. The same topic is not enough: two different shootings, or two different Apple announcements, are different events.
- story_id: the id of the story it is about, or null when it's about none of them.
- new_facts: only facts the article states that the story's facts don't already have: a number that changed (acres, deaths, a price), an arrest, a new official action, a cause found, a date set. A fact said in other words is not new, and another outlet repeating what the story has is not new: answer an empty list. "Suspect arrested" is a new fact; a fifth outlet repeating the first four isn't. Each new fact is one short line, no outlet names.`;

export const GROUPING_TOOL: ToolSpec = {
  name: 'submit_news_grouping',
  description: 'Submit which story the article is about, if any, and the new facts it brings.',
  schema: {
    type: 'object',
    properties: {
      story_id: nullable({type: 'integer'}),
      new_facts: {type: 'array', items: {type: 'string'}, maxItems: 3},
    },
    required: ['story_id', 'new_facts'],
  },
};

export interface PromptStory {
  id: number;
  headline: string;
  sections: NewsSection[];
  facts: {at: string; text: string}[];
  sources: string[];
}

export function groupingInput(article: {outlet: string; headline: string; publishedAt: string; facts: string[]}, stories: readonly PromptStory[]): string {
  return [
    'New article:',
    `Outlet: ${article.outlet}`,
    `Published: ${article.publishedAt}`,
    `Headline: ${article.headline}`,
    'Facts:', ...article.facts.map(fact => `- ${fact}`),
    '',
    'Stories:',
    ...stories.flatMap(story => [
      `Story ${story.id} (${story.sections.join(', ')}): ${story.headline}`,
      ...story.facts.map(fact => `- ${fact.at}: ${fact.text}`),
      ...story.sources.map(source => `  Source: ${source}`),
    ]),
  ].join('\n');
}

export const STORY_SYSTEM = `You write one story for the user's news page from the fact notes of every outlet covering it, so they understand it without clicking through. Answer only with the submit_news_story tool.

- headline: plain and neutral, under 90 characters, in sentence case and the present tense, saying what happened. Never an outlet's clickbait, never a question, never an outlet's name. Use the newest facts ("Brush fire near the 210 grows to 400 acres").
- one_line: under 100 characters: the most useful detail the headline doesn't say ("Evacuation warnings for foothill homes; crews held the west flank overnight").
- summary: two to four sentences from all the sources, the newest facts first where they change the picture. Only what the notes say; never speculate, never add opinion, never name outlets.
- lead_article_id: the article that covers the event best and most fully.
- image_article_id: the article whose image best shows the event, among those marked "has image"; null when none has one. Never describe or invent an image.`;

export const STORY_TOOL: ToolSpec = {
  name: 'submit_news_story',
  description: 'Submit the story\'s headline, one line, summary, lead article and image.',
  schema: {
    type: 'object',
    properties: {
      headline: {type: 'string'},
      one_line: {type: 'string'},
      summary: {type: 'string'},
      lead_article_id: {type: 'integer'},
      image_article_id: nullable({type: 'integer'}),
    },
    required: ['headline', 'one_line', 'summary', 'lead_article_id', 'image_article_id'],
  },
};

export interface PromptSource {
  id: number;
  outlet: string;
  publishedAt: string;
  headline: string;
  facts: string[];
  hasImage: boolean;
}

export function storyInput(story: {headline: string | null; sections: NewsSection[]; facts: {at: string; text: string}[]}, sources: readonly PromptSource[]): string {
  return [
    `Sections: ${story.sections.join(', ')}`,
    ...(story.headline ? [`Current headline: ${story.headline}`] : []),
    'Facts so far, oldest first:', ...story.facts.map(fact => `- ${fact.at}: ${fact.text}`),
    '',
    'Articles:',
    ...sources.flatMap(source => [
      `Article ${source.id} · ${source.outlet} · ${source.publishedAt}${source.hasImage ? ' · has image' : ''}`,
      `  Headline: ${source.headline}`,
      ...source.facts.map(fact => `  - ${fact}`),
    ]),
  ].join('\n');
}

export const RANKING_SYSTEM = `You rank the stories on the user's news page once an hour: judge how much each one matters, against its section's guide and against the rest of today's stories. Answer only with the submit_news_ranking tool, with every story given.

${SECTION_GUIDES}

Judge the event, not the coverage: Setpoint adds how many outlets cover a story, how recent and how fast-growing it is, and how close a local one is. A story that has grown (an arrest, a fire's spread, a confirmed death toll) matters more than when it began; one that has turned out minor matters less. importance is an integer from 0 to 100 for each story id.`;

export const RANKING_TOOL: ToolSpec = {
  name: 'submit_news_ranking',
  description: 'Submit each story\'s importance.',
  schema: {
    type: 'object',
    properties: {
      stories: {
        type: 'array',
        items: {type: 'object', properties: {id: {type: 'integer'}, importance: {type: 'integer', minimum: 0, maximum: 100}}, required: ['id', 'importance']},
      },
    },
    required: ['stories'],
  },
};

export interface PromptRanked {
  id: number;
  sections: NewsSection[];
  headline: string;
  oneLine: string | null;
  outlets: number;
  firstReportedAt: string;
  lastNewFactAt: string;
}

export function rankingInput(now: string, stories: readonly PromptRanked[]): string {
  return [
    `Now: ${now}`,
    'Stories:',
    ...stories.map(story => `${story.id} · ${story.sections.join(', ')} · ${story.outlets} outlets · first ${story.firstReportedAt} · last new fact ${story.lastNewFactAt} · ${story.headline}${story.oneLine ? ` · ${story.oneLine}` : ''}`),
  ].join('\n');
}

export const MAX_OUTPUT_TOKENS = {article: 700, grouping: 400, story: 1000} as const;
/** The ranking answers a line per story. */
export const rankingMaxTokens = (stories: number) => Math.min(16_000, 300 + stories * 30);

// ---- Reading the answers ----

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || /^(null|none|n\/a|unknown)$/i.test(clean)) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : null;
const integer = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: zone});
    return true;
  } catch {
    return false;
  }
}

/** A keynote as the model gave it: a real date, and a time with its zone when it gave both; a day without one is all day. */
export function keynoteOf(value: unknown, timeZone: string): KeynoteNote | null {
  if (!isRecord(value)) return null;
  const company = text(value.company, 60);
  const date = typeof value.date === 'string' ? /^(\d{4}-\d{2}-\d{2})$/.exec(value.date.trim())?.[1] : undefined;
  if (!company || !date || !new Date(`${date}T12:00:00Z`).toISOString().startsWith(date)) return null;
  const time = typeof value.time === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.time.trim())?.[0] : undefined;
  const zone = typeof value.time_zone === 'string' && validZone(value.time_zone.trim()) ? value.time_zone.trim() : null;
  if (time && zone) return {company, name: keynoteName(company), startsAt: zonedInstant(date, time, zone), allDay: false};
  return {company, name: keynoteName(company), startsAt: zonedInstant(date, '00:00', timeZone), allDay: true};
}

/** The article tool's input as notes, or null without a usable kind and subject. */
export function notesOf(input: Record<string, unknown> | null, timeZone: string): ArticleNotes | null {
  if (!input) return null;
  const kind = oneOf<ArticleKind>(ARTICLE_KINDS, input.kind);
  const subject = oneOf<ArticleSubject>(ARTICLE_SUBJECTS, input.subject);
  if (!kind || !subject) return null;
  const sections = Array.isArray(input.sections) ? [...new Set(input.sections.flatMap(section => oneOf<NewsSection>(NEWS_SECTIONS, section) ?? []))] : [];
  const facts = Array.isArray(input.facts) ? input.facts.flatMap(fact => text(fact, 200) ?? []).slice(0, 4) : [];
  const place = isRecord(input.place) && typeof input.place.lat === 'number' && typeof input.place.lng === 'number'
    && Math.abs(input.place.lat) <= 90 && Math.abs(input.place.lng) <= 180 ? {lat: input.place.lat, lng: input.place.lng} : null;
  return {
    sections, kind, subject, facts, importance: Math.min(100, Math.max(0, integer(input.importance) ?? 0)), place,
    keynote: keynoteOf(input.keynote, timeZone),
  };
}

/** Notes from the rules alone, for an article the model's answer couldn't sort: a quiet event in its source's section. */
export const fallbackNotes = (section: NewsSection, headline: string): ArticleNotes => ({
  sections: [section], kind: 'event', subject: 'other', facts: [headline], importance: 20, place: null, keynote: null,
});

/** The grouping tool's input; an unusable answer is no match. */
export function groupingOf(input: Record<string, unknown> | null): {storyId: number | null; newFacts: string[]} {
  if (!input) return {storyId: null, newFacts: []};
  const storyId = integer(input.story_id);
  return {storyId, newFacts: Array.isArray(input.new_facts) ? input.new_facts.flatMap(fact => text(fact, 200) ?? []) : []};
}

export interface WrittenStory {
  headline: string;
  oneLine: string | null;
  summary: string | null;
  leadArticleId: number | null;
  imageArticleId: number | null;
}

/** The story tool's input, or null without a headline. */
export function writtenOf(input: Record<string, unknown> | null): WrittenStory | null {
  const headline = text(input?.headline, 120);
  if (!input || !headline) return null;
  return {
    headline, oneLine: text(input.one_line, 140), summary: text(input.summary, 1200),
    leadArticleId: integer(input.lead_article_id), imageArticleId: integer(input.image_article_id),
  };
}

/** The ranking tool's input: each story's importance, by id. */
export function rankingOf(input: Record<string, unknown> | null): Map<number, number> {
  const out = new Map<number, number>();
  for (const item of Array.isArray(input?.stories) ? input.stories : []) {
    if (!isRecord(item)) continue;
    const id = integer(item.id);
    const importance = integer(item.importance);
    if (id !== null && importance !== null) out.set(id, Math.min(100, Math.max(0, importance)));
  }
  return out;
}
