// News's resources and its one change, seen (shared/src/api/news.ts has the routes). Seen shows at
// once wherever the story is loaded, its dot gone, then the server's answer and its `news` event take
// over. An opened story is loaded before it's marked seen, so the pane still has what was new since
// the user last looked. N5 adds sorting's state and Show headlines, Settings › News, search, and
// Upcoming's proposal.
import type {MissedOut, NewsPageOut, NewsProposalOut, NewsSearchOut, NewsSection, NewsSectionOut, NewsSeenOut, StoryOut, StoryRowOut} from '@setpoint/shared';
import {serverNow} from './auth.ts';
import {cachedPaths, getCached, getJson, refresh, refreshIfShown, sendJson, updateCached} from './client.ts';

export const NEWS_PATH = '/news';
export const MISSED_PATH = '/news/missed';
export const sectionPath = (section: NewsSection) => `/news/sections/${section}`;
export const storyPath = (id: number) => `/news/stories/${id}`;
export const articlePath = (id: number) => `/news/articles/${id}`;
/** Sorting's state: the Unsorted line and the first run's (N3). */
export const STATUS_PATH = '/news/status';
/** Show headlines: what waits Unsorted, with its links. */
export const UNSORTED_PATH = '/news/unsorted';
/** Settings › News. */
export const NEWS_SOURCES_PATH = '/news/sources';

const seenRow = <R extends StoryRowOut>(row: R, ids: ReadonlySet<number>, at: string): R => (ids.has(row.id) && row.state !== 'seen' ? {...row, state: 'seen', seen_at: at} : row);

/** Turns the stories seen in every loaded list and story, at once. */
function showSeen(ids: ReadonlySet<number>, at: string) {
  updateCached<NewsPageOut>(NEWS_PATH, page => ({...page, blocks: page.blocks.map(block => ({...block, stories: block.stories.map(row => seenRow(row, ids, at))}))}));
  for (const path of cachedPaths('/news/sections')) {
    updateCached<NewsSectionOut>(path, list => ({...list, stories: list.stories.map(row => seenRow(row, ids, at))}));
  }
  updateCached<MissedOut>(MISSED_PATH, missed => ({...missed, days: missed.days.map(day => ({...day, stories: day.stories.map(row => seenRow(row, ids, at))}))}));
  for (const path of cachedPaths('/news/stories')) updateCached<StoryOut>(path, story => seenRow(story, ids, at));
}

/** Loads News's lists again: a refused seen puts their dots back. */
function refreshLists() {
  for (const path of [NEWS_PATH, MISSED_PATH, ...cachedPaths('/news/sections')]) refreshIfShown(path);
}

/** Stories seen: a row fully on screen for about a second, or opened (D87). */
export async function markSeen(ids: number[]): Promise<NewsSeenOut> {
  showSeen(new Set(ids), new Date(serverNow()).toISOString());
  try {
    return await sendJson<NewsSeenOut>('POST', '/news/seen', {story_ids: ids});
  } catch (error) {
    refreshLists();
    throw error;
  }
}

/**
 * Opens a story: loaded as it stands, then seen. Resolves with the story as it was before, whose
 * "New since you looked" and Updated tag the pane keeps while it's open.
 */
export async function openStory(id: number, onFailed: (error: Error) => void): Promise<StoryOut | null> {
  await refresh(storyPath(id));
  const before = getCached<StoryOut>(storyPath(id));
  if (before?.id !== id) return null;
  markSeen([id]).catch(onFailed);
  return before;
}

/** Search news over the 90-day archive, expired stories included, newest first. */
export const searchNews = (text: string) => getJson<NewsSearchOut>(`/news/search?q=${encodeURIComponent(text)}`);

/**
 * Add to calendar on an Upcoming keynote: the event Calendar's editor opens on, its calendar picked
 * as an email's proposal picks it (N3). Nothing is created until Create.
 */
export const newsProposal = (eventId: number) => sendJson<NewsProposalOut>('POST', `/news/events/${eventId}/proposal`);
