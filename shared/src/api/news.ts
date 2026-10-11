// News (after 2.0): All's blocks, a section, a story and its sources, an article, Missed, Upcoming
// and Settings › News (BRIEF.md › News; DESIGN.md › News, boards 25–31; darma D85–D92). Outputs
// are Zod schemas as well as types, so tests and the seed check the shapes the page draws from.
//
//   GET  /api/news                         NewsPageOut (All: the blocks in their fixed order, the Missed strip)
//   GET  /api/news/sections/:section       NewsSectionOut (that section's full list, biggest first)
//   GET  /api/news/stories/:id             StoryOut (the story pane), without marking it seen
//   GET  /api/news/articles/:id            ArticleOut (a source opened in the pane); a metered article is 404
//   GET  /api/news/missed                  MissedOut (Catch up: by day, biggest first)
//   GET  /api/news/sources                 NewsSourcesOut (Settings › News)
//   GET  /api/news/images/:id              Setpoint's own copy of an image (outlets never see the user's browsing)
//   POST /api/news/seen      {story_ids}   NewsSeenOut (a row on screen for about a second, or opened)
//
// N3 adds sorting's side (BRIEF.md › Models and cost, When things break; DESIGN.md › States):
//
//   GET  /api/news/status                  NewsStatusOut (the Unsorted line and the first run's line)
//   GET  /api/news/unsorted                NewsUnsortedOut (Show headlines: the raw headlines with their links)
//   GET  /api/news/search?q=…&limit=…      NewsSearchOut (the header's Search news, over the 90-day archive)
//   POST /api/news/events/:id/proposal     NewsProposalOut (Upcoming's Add to calendar)
//
// Settings › AI's News group (models, the cap, this month and its usage) rides on GET /api/ai (AiOut).
//
// Ages are instants; the page words them (DESIGN.md › Copy). A story's order is its stored score,
// biggest first (N3 ranks); a story under the bar never shows. Dots follow D87: there are no counts
// and no "mark all seen".
import {z} from 'zod';
import {AI_PROVIDERS, HEALTH_STATES, NEWS_ADAPTERS, NEWS_SECTIONS, NEWS_SOURCE_ICONS, NEWS_SOURCE_KINDS, STORY_STATES} from '../enums.ts';
import {id, instant, localDate} from './common.ts';
import type {ProposalOut} from './search.ts';

export const newsSectionSchema = z.enum(NEWS_SECTIONS);

/** Setpoint's copy of an image, served at `url`, with its size. */
export const newsImageSchema = z.strictObject({
  id,
  url: z.string().startsWith('/api/news/images/'),
  width: z.int().positive(),
  height: z.int().positive(),
});
export type NewsImageOut = z.infer<typeof newsImageSchema>;

/**
 * A story's image, the best across its sources: the thumbnail for a row (72 × 48) and the large copy
 * for a block's lead (232 × 130) and the pane (220 tall). `outlet` is the pane's caption pill. Once a
 * story leaves the page only the thumbnail is kept (the archive), so `large` is null. A story without
 * an image has none: never a placeholder, never an AI-generated image.
 */
export const storyImageSchema = z.strictObject({
  thumb: newsImageSchema,
  large: newsImageSchema.nullable(),
  outlet: z.string(),
});
export type StoryImageOut = z.infer<typeof storyImageSchema>;

/**
 * The leading outlet and how many more cover the story: "KTLA +4", "NBC LA +2". `published_at` is the
 * leading outlet's article, the row's age ("1h", "Yesterday"). A metered paper counts toward ranking
 * but never here (D89).
 */
export const storyLeadSchema = z.strictObject({
  article_id: id,
  outlet: z.string(),
  // The short name rows use ("NBC LA"); the pane and the article use `outlet` ("NBC Los Angeles").
  outlet_short: z.string(),
  more: z.int().nonnegative(),
  published_at: instant,
  url: z.url(),
});
export type StoryLeadOut = z.infer<typeof storyLeadSchema>;

/** One story in a list: All's blocks, a section, Missed. */
export const storyRowSchema = z.strictObject({
  id,
  // Written by the model, plain and neutral (D86).
  headline: z.string(),
  one_line: z.string().nullable(),
  // In NEWS_SECTIONS order; a story can sit in more than one, its seen state shared.
  sections: z.array(newsSectionSchema).min(1),
  state: z.enum(STORY_STATES),
  lead: storyLeadSchema,
  image: storyImageSchema.nullable(),
  first_reported_at: instant,
  // The newest fact: "Updated 8:40 AM" on an updated row. The story leaves the page 48 h after it.
  last_new_fact_at: instant,
  // When the user last saw it; null while it's new.
  seen_at: instant.nullable(),
  // When it left the page (48 h after its last new fact); null while it's on the page.
  expired_at: instant.nullable(),
});
export type StoryRowOut = z.infer<typeof storyRowSchema>;

/**
 * A keynote coming up, in a thin strip at the top of its block (Tech): "Apple event · Tue Oct 20 ·
 * 10 AM · Add to calendar", with the outlet meta of the story that announced it.
 */
export const upcomingSchema = z.strictObject({
  id,
  name: z.string(),
  starts_at: instant,
  // A date with no time yet: `starts_at` is that day's local midnight.
  all_day: z.boolean(),
  section: newsSectionSchema,
  story_id: id,
  lead: storyLeadSchema,
});
export type UpcomingOut = z.infer<typeof upcomingSchema>;

/**
 * A section's line when the whole section is stale or failing ("Local, as of 9:14 PM"); null while
 * any of its sources is fine. One failing feed shows only in Settings › News (DESIGN.md › States).
 */
export const sectionHealthSchema = z.strictObject({
  state: z.enum(['stale', 'failing']),
  as_of: instant.nullable(),
});
export type SectionHealthOut = z.infer<typeof sectionHealthSchema>;

/** One of All's blocks: its top 3–5 stories, biggest first, then "12 more in Local". */
export const newsBlockSchema = z.strictObject({
  section: newsSectionSchema,
  stories: z.array(storyRowSchema).max(5),
  more: z.int().nonnegative(),
  upcoming: z.array(upcomingSchema),
  health: sectionHealthSchema.nullable(),
});
export type NewsBlockOut = z.infer<typeof newsBlockSchema>;

/** The Missed strip at the top of All, while Missed holds stories: "14 stories you missed since Mon". */
export const missedStripSchema = z.strictObject({
  count: z.int().positive(),
  // The user's last look before these stories left the page; null if they never looked.
  since: instant.nullable(),
});
export type MissedStripOut = z.infer<typeof missedStripSchema>;

/** All: one block per section in NEWS_SECTIONS order, and the Missed strip. */
export const newsPageSchema = z.strictObject({
  blocks: z.array(newsBlockSchema).length(NEWS_SECTIONS.length),
  missed: missedStripSchema.nullable(),
});
export type NewsPageOut = z.infer<typeof newsPageSchema>;

/** A section's full list (the segmented control, or "N more"), biggest first. */
export const newsSectionOutSchema = z.strictObject({
  section: newsSectionSchema,
  stories: z.array(storyRowSchema),
  upcoming: z.array(upcomingSchema),
  health: sectionHealthSchema.nullable(),
});
export type NewsSectionOut = z.infer<typeof newsSectionOutSchema>;

/** A fact on a story's timeline, with its time: "8:40 AM · Grew from 150 to 400 acres overnight". */
export const storyFactSchema = z.strictObject({
  at: instant,
  text: z.string(),
});
export type StoryFactOut = z.infer<typeof storyFactSchema>;

/**
 * One outlet's article in a story's Sources: its own headline and age. `summary_only` is "Summary
 * only" (its page can't be read in-app); `discovery` is one only Google News found, shown with its
 * link and no text. A metered paper is never listed.
 */
export const storySourceSchema = z.strictObject({
  article_id: id,
  outlet: z.string(),
  outlet_short: z.string(),
  headline: z.string(),
  published_at: instant,
  summary_only: z.boolean(),
  discovery: z.boolean(),
  url: z.url(),
});
export type StorySourceOut = z.infer<typeof storySourceSchema>;

/** The story pane. */
export const storySchema = storyRowSchema.extend({
  // One summary from all the sources, rewritten only on new facts; null until it's written.
  summary: z.string().nullable(),
  // "5 outlets": the outlets listed in `sources`.
  outlets: z.int().nonnegative(),
  // The timeline, oldest first. Empty once the story leaves the page (the archive drops it).
  facts: z.array(storyFactSchema),
  // Only on an updated story: what's new since the user last saw it ("New since you looked · Mon 10:40 PM").
  new_since: z.strictObject({since: instant, facts: z.array(storyFactSchema).min(1)}).nullable(),
  // Newest first.
  sources: z.array(storySourceSchema),
});
export type StoryOut = z.infer<typeof storySchema>;

/**
 * An article opened in the pane (board 26a): its text extracted from the page, with Back and the
 * original link. One that can't be read in-app (board 26b) has `text` null and shows its feed
 * summary and "Read at KTLA"; one only Google News found has neither.
 */
export const articleSchema = z.strictObject({
  id,
  story_id: id.nullable(),
  outlet: z.string(),
  outlet_short: z.string(),
  byline: z.string().nullable(),
  published_at: instant,
  headline: z.string(),
  // The original link (`O`).
  url: z.url(),
  // Paragraphs separated by a blank line; null when summary only, discovery only, or archived.
  text: z.string().nullable(),
  feed_summary: z.string().nullable(),
  summary_only: z.boolean(),
  discovery: z.boolean(),
  image: newsImageSchema.nullable(),
});
export type ArticleOut = z.infer<typeof articleSchema>;

/** A story in Missed: its row names its section ("General · NPR +9 · Tue"). */
export const missedStorySchema = storyRowSchema.extend({
  section: newsSectionSchema,
  expired_at: instant,
});
export type MissedStoryOut = z.infer<typeof missedStorySchema>;

/** One day of Missed, by the local day its stories left the page ("TUESDAY", "Oct 6"). */
export const missedDaySchema = z.strictObject({
  date: localDate,
  stories: z.array(missedStorySchema).min(1),
});
export type MissedDayOut = z.infer<typeof missedDaySchema>;

/**
 * Catch up (board 28): the stories that left the page before the user saw them, by day, newest day first,
 * biggest first within a day, at most five per section per day (N3). Each leaves as it's seen.
 */
export const missedSchema = z.strictObject({
  since: instant.nullable(),
  count: z.int().nonnegative(),
  days: z.array(missedDaySchema),
});
export type MissedOut = z.infer<typeof missedSchema>;

/** A source's health, as on Settings › Accounts; null until its first check. */
export const newsSourceHealthSchema = z.strictObject({
  state: z.enum(HEALTH_STATES),
  as_of: instant.nullable(),
  reason: z.string().nullable(),
  last_check_at: instant.nullable(),
  // When the current failure began: "Failing, 404 since 6:02 AM".
  failing_since: instant.nullable(),
});
export type NewsSourceHealthOut = z.infer<typeof newsSourceHealthSchema>;

/**
 * A row in Settings › News (board 30a): the source's name with what's read ("Feed, Local News only"),
 * how often ("Every 15 min") and its state ("Checked 9:10 AM", "Failing, 404 since 6:02 AM").
 * Read-only until the tuning round.
 */
export const newsSourceSchema = z.strictObject({
  id,
  name: z.string(),
  section: newsSectionSchema,
  kind: z.enum(NEWS_SOURCE_KINDS),
  // N5: which adapter reads it, for its icon tile (the hazard APIs each have their own).
  adapter: z.enum(NEWS_ADAPTERS),
  // N5: the icon its list names for its tile ("live_tv" for a TV station); null takes the adapter's.
  icon: z.enum(NEWS_SOURCE_ICONS).nullable(),
  reads: z.string(),
  interval_seconds: z.int().positive(),
  // From the data directory's local list (D91) rather than the built-in one.
  local: z.boolean(),
  health: newsSourceHealthSchema.nullable(),
});
export type NewsSourceOut = z.infer<typeof newsSourceSchema>;

/**
 * Settings › News: "312 articles today · 41 stories", then one group per section. The articles are
 * those fetched since local midnight; the stories, those on the page now (a day comes to 30–50).
 */
export const newsSourcesSchema = z.strictObject({
  articles_today: z.int().nonnegative(),
  stories_on_page: z.int().nonnegative(),
  sections: z.array(z.strictObject({section: newsSectionSchema, sources: z.array(newsSourceSchema)})).length(NEWS_SECTIONS.length),
});
export type NewsSourcesOut = z.infer<typeof newsSourcesSchema>;

/** Stories seen: a row fully on screen for about a second, or opened (D87). */
export const newsSeenInput = z.strictObject({story_ids: z.array(id).min(1).max(500)});
export type NewsSeenInput = z.infer<typeof newsSeenInput>;
export const newsSeenSchema = z.strictObject({stories: z.array(storyRowSchema)});
export type NewsSeenOut = z.infer<typeof newsSeenSchema>;

// ---- N3: sorting's state, Unsorted, the first run, search and Add to calendar ----

/**
 * Why sorting is stopped (DESIGN.md › States, 29a): "12 articles not sorted yet, Anthropic unreachable
 * since 8:52 AM, retrying". `cause` is what the page words: no key in Settings › AI, the provider
 * unreachable (a timeout, a 5xx, overloaded), rate limited, or the key refused. `since` is when this
 * spell began; `reason` is the provider's own words; `retrying` while the one retry policy will ask
 * again by itself (a missing or refused key waits for Settings › AI).
 */
export const NEWS_SORT_CAUSES = ['no_key', 'unreachable', 'rate_limited', 'refused'] as const;
export const newsSortDownSchema = z.strictObject({
  provider: z.enum(AI_PROVIDERS),
  cause: z.enum(NEWS_SORT_CAUSES),
  since: instant,
  reason: z.string(),
  retrying: z.boolean(),
});
export type NewsSortDownOut = z.infer<typeof newsSortDownSchema>;

/**
 * The lines above the list. `unsorted` counts the articles waiting to be sorted (never a metered
 * paper's); the Unsorted line shows while `down` says why they wait. `first_run` is the first fill's
 * progress, "Sorting the last 48 hours · 186 of 312 articles · showing what's sorted so far", and is
 * null once it's done (DESIGN.md › States, 29b).
 */
export const newsStatusSchema = z.strictObject({
  unsorted: z.int().nonnegative(),
  down: newsSortDownSchema.nullable(),
  first_run: z.strictObject({sorted: z.int().nonnegative(), total: z.int().nonnegative()}).nullable(),
});
export type NewsStatusOut = z.infer<typeof newsStatusSchema>;

/** One article waiting Unsorted, as its source gave it: Show headlines lists these with their links. */
export const unsortedArticleSchema = z.strictObject({
  id,
  // The source's own section, where the rules would put it.
  section: newsSectionSchema,
  outlet: z.string(),
  outlet_short: z.string(),
  headline: z.string(),
  url: z.url(),
  published_at: instant,
});
export type UnsortedArticleOut = z.infer<typeof unsortedArticleSchema>;

/** Show headlines, newest first. Nothing waiting Unsorted vanishes; it's sorted once the AI is back. */
export const newsUnsortedSchema = z.strictObject({
  count: z.int().nonnegative(),
  articles: z.array(unsortedArticleSchema),
});
export type NewsUnsortedOut = z.infer<typeof newsUnsortedSchema>;

/**
 * Search news (D91): every word, as a prefix, in a story's headline, one line, summary or sources (an
 * outlet's name or its own headline), over the last 90 days, expired stories included. Newest first.
 */
export const newsSearchInput = z.strictObject({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().pipe(z.int().min(1).max(100)).default(50),
});
export type NewsSearchInput = z.infer<typeof newsSearchInput>;
export const newsSearchSchema = z.strictObject({
  query: z.string(),
  total: z.int().nonnegative(),
  stories: z.array(storyRowSchema),
});
export type NewsSearchOut = z.infer<typeof newsSearchSchema>;

/**
 * Add to calendar on an Upcoming keynote: the event POST /api/items would create, pre-filled from the
 * news as an email's proposal is (board 08), with its conflict line. `from_email` marks the fields
 * the news gave (title, date, time). Nothing is created until Create.
 */
export type NewsProposalOut = Omit<ProposalOut, 'message_id'> & {news_event_id: number; story_id: number};
