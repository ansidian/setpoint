// News's rules (DESIGN.md › News; BRIEF.md › News, D85–D92), kept out of the components: the meta
// copy and ages, the held order and what the pill counts, when a row on screen counts as seen, the
// cursor's stops; N5's states above the list and in a section (boards 29a, 29b), and Settings › News
// and Settings › AI's News group (boards 30a, 30b).
//
// The held order (D87): the page draws the order it last took (on opening, or from the pill) and
// takes each story's dot, sources and summary from the latest answer, so nothing moves under the
// cursor. A story the latest order shows that the held one doesn't waits behind the pill, counted as
// new or updated by its dot; a seen story moving into view, one leaving, or a re-ranking among the
// stories already shown wait too, but say nothing until the pill has something to count.
import type {
  AiOut, AiUsageOut, MissedOut, NewsAdapterKey, NewsAiOut, NewsSourceOut, NewsPageOut, NewsSection, NewsSectionOut, NewsSourceHealthOut, NewsSourcesOut, NewsStatusOut,
  SectionHealthOut, StoryOut, StoryRowOut, UpcomingOut,
} from '@setpoint/shared';
import {news} from '../tokens.ts';
import type {IconName} from '../ui/glyphs.ts';
import {age, clockTime, daysBetween, localDate} from './format.ts';
import {asOf, every} from './health.ts';

export const SECTION_LABELS: Record<NewsSection, string> = {local: 'Local', tech: 'Tech', ai: 'AI', general: 'General'};

/** Each section's glyph wherever it's named, its header and the story pane's tags (#161): shape alone, in `ink3`. */
export const SECTION_GLYPHS: Record<NewsSection, IconName> = {local: 'location_on', tech: 'computer', ai: 'auto_awesome', general: 'public'};

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});

/** The leading outlet and how many more cover the story: "KTLA +4", "NWS". */
export const outletLine = (lead: StoryRowOut['lead']) => (lead.more > 0 ? `${lead.outlet_short} +${lead.more}` : lead.outlet_short);

/** A day as News words it: the clock time today ("8:40 AM"), else "Yesterday", the weekday within the week, then the date. */
export function dayWord(at: string, now: number, timeZone: string): string {
  const day = localDate(at, timeZone);
  return day === localDate(now, timeZone) ? clockTime(at, timeZone) : age(at, now, timeZone);
}

/** A moment as News words it with its time: "8:40 AM" today, "Mon 10:40 PM" within the week, "Sep 30, 7:15 PM" before. */
export function stamp(at: string, now: number, timeZone: string): string {
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  const time = clockTime(at, timeZone);
  if (day === today) return time;
  const days = daysBetween(day, today);
  if (days >= 1 && days < 7) return `${days === 1 ? 'Yesterday' : onDay(day, {weekday: 'short'})} ${time}`;
  return `${onDay(day, {month: 'short', day: 'numeric'})}, ${time}`;
}

export interface RowMeta {
  // Missed's rows lead with their section: "General · NPR +9 · Tue".
  section: string | null;
  outlet: string;
  age: string;
  // "Updated 8:40 AM" in `cool`, on an updated story.
  updated: string | null;
}

/** A row's meta: "KTLA +4 · 1h · Updated 8:40 AM" (DESIGN.md › The list: Meta copy). */
export function rowMeta(row: StoryRowOut, now: number, timeZone: string, section: NewsSection | null = null): RowMeta {
  return {
    section: section && SECTION_LABELS[section],
    outlet: outletLine(row.lead),
    age: age(row.lead.published_at, now, timeZone),
    updated: row.state === 'updated' ? `Updated ${dayWord(row.last_new_fact_at, now, timeZone)}` : null,
  };
}

/** "12 more in Local". */
export const moreLine = (count: number, section: NewsSection) => `${count} more in ${SECTION_LABELS[section]}`;

/** The Missed strip's count: "14 stories", "1 story". */
export const storiesCount = (count: number) => `${count} ${count === 1 ? 'story' : 'stories'}`;

/** The rest of the strip: "you missed since Mon" (the clock time when the user last looked today); "you missed" when they never had. */
export function missedSince(since: string | null, now: number, timeZone: string): string {
  return since ? `you missed since ${dayWord(since, now, timeZone)}` : 'you missed';
}

/** Missed's back row: "Missed since Mon 10:40 PM", or "Missed". */
export const missedTitle = (since: string | null, now: number, timeZone: string) => (since ? `Missed since ${stamp(since, now, timeZone)}` : 'Missed');

/** A day of Missed: "Tuesday" (the header's capitals are its style) and "Oct 6" on the right. */
export const missedDay = (date: string) => ({day: onDay(date, {weekday: 'long'}), date: onDay(date, {month: 'short', day: 'numeric'})});

/** The pane's meta: "5 outlets · first reported 6:12 AM · updated 8:40 AM"; "updated" only once a later fact came. */
export function storyMeta(story: Pick<StoryOut, 'outlets' | 'first_reported_at' | 'last_new_fact_at'>, now: number, timeZone: string): string[] {
  return [
    `${story.outlets} ${story.outlets === 1 ? 'outlet' : 'outlets'}`,
    `first reported ${stamp(story.first_reported_at, now, timeZone)}`,
    ...(story.last_new_fact_at > story.first_reported_at ? [`updated ${stamp(story.last_new_fact_at, now, timeZone)}`] : []),
  ];
}

/**
 * An outlet's badge: its trailing number ("FOX 11" → "11", "ABC7" → "7"), else a short capitalised
 * first word ("NBC Los Angeles" → "NBC"), else its first letter ("KTLA" → "K", "The Verge" → "V").
 */
export function initials(outlet: string): string {
  const number = /(\d+)$/.exec(outlet.trim());
  if (number && number[1]!.length <= 3 && number.index > 0) return number[1]!;
  const words = outlet.trim().split(/\s+/).filter(word => word.toLowerCase() !== 'the');
  const first = words[0] ?? outlet;
  if (words.length > 1 && /^[A-Z]{2,3}$/.test(first)) return first;
  return first.slice(0, 1).toUpperCase();
}

/** Why an article shows no text (boards 26b): its page can't be read here, or only Google News found it. */
export function articleNote(article: {outlet: string; summary_only: boolean; discovery: boolean}): string | null {
  if (article.discovery) return `Only Google News found ${article.outlet}'s story, so it isn't read here`;
  if (article.summary_only) return `${article.outlet}'s page can't be read here, so this is its feed summary`;
  return null;
}

const shortClock = (at: string, timeZone: string) => clockTime(at, timeZone).replace(':00 ', ' ');

/** Upcoming's when: "Tue Oct 20 · 10 AM", or the day alone for one with no time yet. */
export function upcomingWhen(upcoming: Pick<UpcomingOut, 'starts_at' | 'all_day'>, timeZone: string): string {
  const day = localDate(upcoming.starts_at, timeZone);
  const date = `${onDay(day, {weekday: 'short'})} ${onDay(day, {month: 'short', day: 'numeric'})}`;
  return upcoming.all_day ? date : `${date} · ${shortClock(upcoming.starts_at, timeZone)}`;
}


// ---- The held order (D87) ----

/** One list on screen: an All block (with its "N more"), a section's list, or a day of Missed. */
export interface Shelf {
  key: string;
  ids: number[];
  more: number;
}
export type Layout = Shelf[];

export const pageLayout = (page: NewsPageOut): Layout => page.blocks.map(block => ({key: block.section, ids: block.stories.map(story => story.id), more: block.more}));
export const sectionLayout = (list: NewsSectionOut): Layout => [{key: list.section, ids: list.stories.map(story => story.id), more: 0}];
export const missedLayout = (missed: MissedOut): Layout => missed.days.map(day => ({key: day.date, ids: day.stories.map(story => story.id), more: 0}));

/** Every row an answer holds, by id. */
export function rowsById(rows: readonly StoryRowOut[]): Map<number, StoryRowOut> {
  return new Map(rows.map(row => [row.id, row]));
}

export const sameLayout = (a: Layout, b: Layout) => a.length === b.length
  && a.every((shelf, index) => {
    const other = b[index]!;
    return shelf.key === other.key && shelf.more === other.more && shelf.ids.length === other.ids.length && shelf.ids.every((id, at) => other.ids[at] === id);
  });

/** What waits behind the pill: stories the latest order shows and the held one doesn't, by their dot. */
export interface Waiting {
  fresh: number;
  updated: number;
  // Whether the latest order differs at all; the pill shows only when it has something to count.
  changed: boolean;
}

export function waiting(held: Layout, latest: Layout, rows: ReadonlyMap<number, StoryRowOut>): Waiting {
  const arriving = landed(held, latest);
  let fresh = 0;
  let updated = 0;
  for (const id of arriving) {
    const state = rows.get(id)?.state;
    if (state === 'new') fresh += 1;
    else if (state === 'updated') updated += 1;
  }
  return {fresh, updated, changed: !sameLayout(held, latest)};
}

/** The pill's words: "3 new · 1 updated" (the updated count in `cool`), or null when it has nothing to count. */
export function pillParts({fresh, updated}: Pick<Waiting, 'fresh' | 'updated'>): {fresh: string | null; updated: string | null} | null {
  if (!fresh && !updated) return null;
  return {fresh: fresh ? `${fresh} new` : null, updated: updated ? `${updated} updated` : null};
}

// ---- Seen (D87) ----

/** Since when each story's row has been fully on screen, or has waited to be seen. */
export type Sightings = ReadonlyMap<number, number>;

/** A row came fully on screen (keeping when it first did) or left it, even partly: flicking past starts over. */
export function sight<K>(sightings: ReadonlyMap<K, number>, row: K, full: boolean, at: number): ReadonlyMap<K, number> {
  if (full === sightings.has(row)) return sightings;
  const next = new Map(sightings);
  if (full) next.set(row, at);
  else next.delete(row);
  return next;
}

/** Each story fully on screen, since the first of its rows came so (a story can sit in two of All's blocks). */
export function storiesOnScreen(rows: ReadonlyMap<string, number>): Sightings {
  const stories = new Map<number, number>();
  for (const [key, since] of rows) {
    const id = keyStory(key);
    stories.set(id, Math.min(since, stories.get(id) ?? since));
  }
  return stories;
}

/**
 * The stories waiting to be seen (new or updated on screen), each since it began to: a story that
 * turns updated while its row is on screen waits from then, not from when the row came into view.
 */
export function waitingSince(before: Sightings, ids: Iterable<number>, at: number): Sightings {
  return new Map([...ids].map(id => [id, before.get(id) ?? at]));
}

/** The stories waiting to be seen whose rows have been fully on screen for about a second by `at`. */
export function dueSeen(visible: Sightings, waiting: Sightings, at: number, after: number = news.seenAfterMs): number[] {
  return [...waiting].filter(([id, since]) => visible.has(id) && at - Math.max(since, visible.get(id)!) >= after).map(([id]) => id);
}

/** When the next of them will be, or null with none on screen. */
export function nextSeen(visible: Sightings, waiting: Sightings, after: number = news.seenAfterMs): number | null {
  const times = [...waiting].filter(([id]) => visible.has(id)).map(([id, since]) => Math.max(since, visible.get(id)!) + after);
  return times.length ? Math.min(...times) : null;
}

/**
 * When the user last looked at an updated story before this visit, from the first of these that has it
 * updated (the story as opened, before it was seen); null for a story that wasn't updated.
 */
export function lookedAt(...states: (Pick<StoryRowOut, 'state' | 'seen_at'> | null | undefined)[]): string | null {
  return states.find(state => state?.state === 'updated')?.seen_at ?? null;
}

// ---- The visit's dots (Decided while building #95, D97) ----

/**
 * A story's dot for this visit to News: what it was on arrival, kept after the story is seen (the dot
 * goes from the next visit), gone once it's opened, and back as updated when a fact comes during the
 * visit. `fact` is the newest fact the visit has, and `looked` when the user last looked before this
 * visit, for "New since you looked" and the Updated tag.
 */
export interface VisitDot {
  dot: 'new' | 'updated' | null;
  fact: string;
  looked: string | null;
}
export type VisitDots = ReadonlyMap<number, VisitDot>;

/**
 * The visit's dots after an answer: a story it hasn't met takes its dot as it is; one with a newer
 * fact takes the server's dot, new or updated. A newer fact the server still has seen is older than
 * the user's look (the first run filling the last 48 hours), so the story keeps the dot it had.
 */
export function visitDots(before: VisitDots, rows: Iterable<Pick<StoryRowOut, 'id' | 'state' | 'last_new_fact_at' | 'seen_at'>>): VisitDots {
  let next: Map<number, VisitDot> | null = null;
  for (const row of rows) {
    const known = (next ?? before).get(row.id);
    let dot: VisitDot | null = null;
    if (!known) dot = {dot: row.state === 'seen' ? null : row.state, fact: row.last_new_fact_at, looked: row.state === 'updated' ? row.seen_at : null};
    else if (row.last_new_fact_at > known.fact) {
      dot = row.state === 'seen' ? {...known, fact: row.last_new_fact_at}
        : {dot: row.state, fact: row.last_new_fact_at, looked: known.looked ?? (row.state === 'updated' ? row.seen_at : null)};
    }
    if (dot) (next ??= new Map(before)).set(row.id, dot);
  }
  return next ?? before;
}

/** Opened: its dot goes at once, for the rest of the visit (until a newer fact). */
export function openedInVisit(before: VisitDots, id: number): VisitDots {
  const known = before.get(id);
  if (!known || known.dot === null) return before;
  return new Map(before).set(id, {...known, dot: null});
}

/** The dot a row shows: the visit's, else the story's own. */
export function shownState(row: Pick<StoryRowOut, 'id' | 'state'>, visit: VisitDots): StoryRowOut['state'] {
  const known = visit.get(row.id);
  return known ? known.dot ?? 'seen' : row.state;
}

/** The facts since that look, newest first. */
export const factsSince = <F extends {at: string}>(facts: readonly F[], since: string) => facts.filter(fact => fact.at > since).reverse();

/**
 * New since you looked, folded (the polish audit's news-12): the newest `cap` facts, then the rest
 * behind "6 more", so the story's own summary stays in view. Five or fewer all show: folding one
 * fact away would save nothing.
 */
export const foldFacts = <F>(facts: readonly F[], cap = 4): {shown: F[]; folded: F[]} =>
  (facts.length > cap + 1 ? {shown: facts.slice(0, cap), folded: facts.slice(cap)} : {shown: [...facts], folded: []});

/** The fold's line: "6 more" while it's closed, "Show fewer" once open. */
export const foldLine = (count: number, open: boolean) => (open ? 'Show fewer' : `${count} more`);

/**
 * The stories the latest order brings onto the list, which the order it held didn't show: what the
 * pill counts, and the rows that settle in from `sub2` once N takes it (the polish audit's news-06).
 */
export function landed(held: Layout, latest: Layout): Set<number> {
  const shown = new Set(held.flatMap(shelf => shelf.ids));
  return new Set(latest.flatMap(shelf => shelf.ids).filter(id => !shown.has(id)));
}

/** Whether a row's story still waits to be seen: new or updated. */
export const unseen = (row: Pick<StoryRowOut, 'state'>) => row.state !== 'seen';

// ---- The cursor ----

/** A row's key on screen: its shelf and story, as a story can sit in two of All's blocks. */
export const storyKey = (shelf: string, id: number) => `${shelf}:${id}`;
export const keyStory = (key: string) => Number(key.slice(key.lastIndexOf(':') + 1));

/** J and K: the next or previous row, the first when none is under the cursor. */
export function moveStory(keys: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (!keys.length) return null;
  const at = current === null ? -1 : keys.indexOf(current);
  if (at < 0) return keys[0]!;
  return keys[Math.max(0, Math.min(keys.length - 1, at + delta))]!;
}

/** With a story open, J and K open the next or previous story along the list, or null at its end. */
export function neighbourStory(keys: readonly string[], openKey: string | null, delta: 1 | -1): string | null {
  if (openKey === null) return null;
  const at = keys.indexOf(openKey);
  if (at < 0) return null;
  return keys[at + delta] ?? null;
}

// ---- N5: the states above the list and in a section (DESIGN.md › States; boards 29a, 29b) ----

const PROVIDERS: Record<NonNullable<NewsStatusOut['down']>['provider'], string> = {anthropic: 'Anthropic', openai: 'OpenAI'};

const count = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * The Unsorted line while sorting is down and articles wait (29a): "12 articles not sorted yet,
 * Anthropic unreachable since 8:52 AM, retrying". A key that's missing or refused waits for
 * Settings › AI, which `settings` makes the line's link (#63); nothing waits, or sorting is up, is
 * no line. Status lines take commas (D50).
 */
export function unsortedLine(status: Pick<NewsStatusOut, 'unsorted' | 'down'>, now: number, timeZone: string): {text: string; settings: boolean} | null {
  const {down} = status;
  if (!down || status.unsorted === 0) return null;
  const provider = PROVIDERS[down.provider];
  const since = asOf(down.since, now, timeZone);
  const why = {
    unreachable: `${provider} unreachable since ${since}`,
    rate_limited: `${provider} rate limited since ${since}`,
    refused: `${provider} refused its key in Settings › AI`,
    no_key: `News needs an ${provider} key in Settings › AI`,
  }[down.cause];
  return {text: `${count(status.unsorted, 'article', 'articles')} not sorted yet, ${why}${down.retrying ? ', retrying' : ''}`, settings: why.endsWith('Settings › AI')};
}

/** The first run's line (29b): "Sorting the last 48 hours · 186 of 312 articles · showing what's sorted so far". */
export function firstRunLine(status: Pick<NewsStatusOut, 'first_run'>): string | null {
  const run = status.first_run;
  if (!run) return null;
  return `Sorting the last 48 hours · ${run.sorted.toLocaleString('en-US')} of ${count(run.total, 'article', 'articles')} · showing what’s sorted so far`;
}

/** A whole section stale or failing (29a): "AI, as of 7:02 AM", under its header; its stories stay. */
export function sectionLine(section: NewsSection, health: SectionHealthOut | null, now: number, timeZone: string): {state: 'stale' | 'failing'; text: string} | null {
  if (!health) return null;
  return {state: health.state, text: `${SECTION_LABELS[section]}, ${health.as_of ? `as of ${asOf(health.as_of, now, timeZone)}` : 'not checked yet'}`};
}

/** How long a story stays on the page after its last new fact (BRIEF.md › Stories). */
export const STORY_HOURS = 48;

/**
 * A section with no story to show, in All's block or its own list (29a, 29b). A story stays on the
 * page for 48 hours after its last new fact, so an empty section has had nothing new for 48 hours:
 * "Nothing new in Tech since Mon", from then; anything that came and left unseen before is Missed's.
 * During the first run it's still being sorted: "Nothing sorted in AI yet". A section with stories
 * shows them, seen or not: the dots aren't a to-do list (D87). An empty block in All whose section
 * has `more` (its stories shown in other blocks, #96) isn't an empty section: its "2 more in Tech"
 * stands alone.
 */
export function emptySectionLine(section: NewsSection, stories: number, more: number, firstRun: boolean, now: number, timeZone: string): string | null {
  if (stories > 0 || more > 0) return null;
  if (firstRun) return `Nothing sorted in ${SECTION_LABELS[section]} yet`;
  return `Nothing new in ${SECTION_LABELS[section]} since ${dayWord(new Date(now - STORY_HOURS * 3_600_000).toISOString(), now, timeZone)}`;
}

// ---- N5: Settings › News (board 30a) ----

/** Its header: "312 articles today · 41 stories". */
export const sourcesHeader = (out: Pick<NewsSourcesOut, 'articles_today' | 'stories_on_page'>) =>
  `${count(out.articles_today, 'article', 'articles')} today · ${count(out.stories_on_page, 'story', 'stories')}`;

/** By how a source is read: the hazard APIs their hazard, Google News its search, every feed and page a paper. */
const ADAPTER_TILES = {
  feed: 'newspaper', page_read: 'newspaper', hn_algolia: 'newspaper', nws: 'thunderstorm', usgs: 'earthquake', cal_fire: 'local_fire_department',
  airnow: 'air', google_news: 'travel_explore',
} as const satisfies Record<NewsAdapterKey, IconName>;

/**
 * A story led by a hazard source and without a photo: its hazard's glyph where the photo would go
 * (#162), the same as the source's tile in Settings › News. An outlet's story has none, its photo's
 * column left empty.
 */
export const hazardGlyph = (row: Pick<StoryRowOut, 'image'> & {lead: Pick<StoryRowOut['lead'], 'hazard'>}): IconName | null =>
  (!row.image && row.lead.hazard ? ADAPTER_TILES[row.lead.hazard] : null);

/** A source's tile (30a): the icon its list names (a TV station's `live_tv`, a crime wire's `local_police`), else its adapter's. */
export const sourceTile = (source: Pick<NewsSourceOut, 'icon' | 'adapter'>) => source.icon ?? ADAPTER_TILES[source.adapter];

/** How often a source is read: "Every 15 min", "Every hour". */
export const everyLine = (seconds: number) => `Every ${every(seconds)}`;

export interface NewsSourceState {
  tone: 'muted' | 'caution';
  text: string;
  // The row in `caution` at 7% with the warning glyph, as a failing account's is.
  warn: boolean;
  // The provider's words in full.
  title: string | null;
}

/**
 * A source's state as Settings › Accounts words one (30a): "Checked 9:10 AM"; "Checks stopped, as of
 * 9:14 PM", muted; "Failing, 404 since 6:02 AM" in `caution`, the status code standing for the
 * provider's words when it leads them, else "Failing since 6:02 AM, <the words>". A source not read
 * yet (no home location, no key) says so.
 */
export function newsSourceState(health: NewsSourceHealthOut | null, now: number, timeZone: string): NewsSourceState {
  if (!health) return {tone: 'muted', text: 'Not checked yet', warn: false, title: null};
  switch (health.state) {
    case 'healthy':
      return {tone: 'muted', text: health.last_check_at ? `Checked ${asOf(health.last_check_at, now, timeZone)}` : 'Not checked yet', warn: false, title: null};
    case 'stale':
      return {tone: 'muted', text: health.as_of ? `Checks stopped, as of ${asOf(health.as_of, now, timeZone)}` : 'Checks stopped', warn: false, title: null};
    case 'failing':
    case 'needs_reconnect': {
      const reason = health.reason?.trim() || null;
      const code = reason ? /^(\d{3})\b/.exec(reason)?.[1] ?? null : null;
      const since = health.failing_since ? `since ${asOf(health.failing_since, now, timeZone)}` : null;
      const text = code ? ['Failing,', code, since].filter(Boolean).join(' ') : [`Failing${since ? ` ${since}` : ''}`, reason].filter(Boolean).join(', ');
      return {tone: 'caution', text, warn: true, title: reason};
    }
  }
}

/** Whether a feed is failing, for the Settings nav's `caution` warning glyph beside News. */
export const feedFailing = (out: Pick<NewsSourcesOut, 'sections'> | undefined) =>
  out?.sections.some(group => group.sources.some(source => source.health?.state === 'failing')) ?? false;

// ---- N5: Settings › AI's News group (board 30b) ----

/** Dollars: "$40" whole, "$18.40" otherwise; `cents` always shows them. */
export const dollars = (amount: number, cents = false) => (!cents && Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`);

/** The monthly cap's choices; one set elsewhere still shows as itself. */
export const CAP_CHOICES = [10, 20, 30, 40, 50, 75, 100];

/** How full This month's meter is when it turns `caution`, before the cap rather than at it (the polish audit's settings-10). */
export const NEAR_CAP = 0.9;

/** This month's meter: "$18.40 of $40", how full it is (0–1), and whether that's near the cap (90% or more). */
export function capMeter(news: Pick<NewsAiOut, 'this_month_usd' | 'monthly_cap_usd'>): {text: string; fill: number; near: boolean} {
  const fill = news.monthly_cap_usd > 0 ? Math.min(1, news.this_month_usd / news.monthly_cap_usd) : 1;
  return {text: `${dollars(news.this_month_usd, true)} of ${dollars(news.monthly_cap_usd)}`, fill, near: fill >= NEAR_CAP};
}

/**
 * At the cap, This month says so (BRIEF.md › Models and cost): "Cap reached, summaries use Claude
 * Haiku 5.5 until Nov 1", the 1st of next month; null below it.
 */
export function cappedLine(news: Pick<NewsAiOut, 'capped' | 'summaries_model'>, since: string, timeZone: string, label: (model: string) => string): string | null {
  if (!news.capped) return null;
  const [year, month] = localDate(since, timeZone).split('-').map(Number) as [number, number];
  const next = new Date(Date.UTC(month === 12 ? year + 1 : year, month % 12, 1, 12)).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
  return `Cap reached, summaries use ${label(news.summaries_model)} until ${next}`;
}

/** News's usage in its parts: "Articles $1.90 · grouping $1.20 · stories $13.10 · ranking $2.20". */
export function newsUsageParts(usage: AiOut['usage_this_month']['news']): string {
  const parts: [string, AiUsageOut][] = [['Articles', usage.articles], ['grouping', usage.grouping], ['stories', usage.stories], ['ranking', usage.ranking]];
  return parts.map(([name, part]) => `${name} ${dollars(part.cost_usd, true)}`).join(' · ');
}
