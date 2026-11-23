// News's resources and its changes, seen and the recap's (shared/src/api/news.ts has the routes).
// Seen shows at once wherever the story is loaded, with its dot gone. Then the server's answer and
// its `news` event take over. An opened story is loaded before it's marked seen, so the pane still
// has what was new since the user last looked. This file also has sorting's state and Show
// headlines, Settings › News, search, Upcoming's proposal, the user on News, the recap on screen and
// the phone's Done on it.
import type {NewsPageOut, NewsProposalOut, NewsSearchOut, NewsSection, NewsSectionOut, NewsSeenOut, RecapDoneOut, RecapUndoOut, StoryOut, StoryRowOut} from '@setpoint/shared';
import {serverNow} from './auth.ts';
import {cachedPaths, getCached, getJson, refresh, refreshIfShown, sendJson, updateCached} from './client.ts';

export const NEWS_PATH = '/news';
export const sectionPath = (section: NewsSection) => `/news/sections/${section}`;
export const storyPath = (id: number) => `/news/stories/${id}`;
export const articlePath = (id: number) => `/news/articles/${id}`;
/** Sorting's state: the Unsorted line and the first run's. */
export const STATUS_PATH = '/news/status';
/** Show headlines: what waits Unsorted, with its links. */
export const UNSORTED_PATH = '/news/unsorted';
/** News's empty pane: freshness, today and the quiet facts. */
export const NEWS_DAY_PATH = '/news/day';
/** Settings › News. */
export const NEWS_SOURCES_PATH = '/news/sources';

const seenRow = <R extends StoryRowOut>(row: R, ids: ReadonlySet<number>, at: string): R => (ids.has(row.id) && row.state !== 'seen' ? {...row, state: 'seen', seen_at: at} : row);

/** Turns the stories seen in every loaded list and story, at once. */
function showSeen(ids: ReadonlySet<number>, at: string) {
  updateCached<NewsPageOut>(NEWS_PATH, page => ({
    ...page, blocks: page.blocks.map(block => ({...block, stories: block.stories.map(row => seenRow(row, ids, at))})),
    recap: page.recap && {...page.recap, stories: page.recap.stories.map(row => seenRow(row, ids, at))},
  }));
  for (const path of cachedPaths('/news/sections')) {
    updateCached<NewsSectionOut>(path, list => ({...list, stories: list.stories.map(row => seenRow(row, ids, at))}));
  }
  for (const path of cachedPaths('/news/stories')) updateCached<StoryOut>(path, story => seenRow(story, ids, at));
}

/** Loads News's lists again: a refused seen puts their dots back. */
function refreshLists() {
  for (const path of [NEWS_PATH, ...cachedPaths('/news/sections')]) refreshIfShown(path);
}

/** Stories seen: a row fully on screen for about a second, or opened. */
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
 * Opens a story: loaded as it stands, then seen. Resolves with the story as it was before. The pane
 * keeps that story's "New since you looked" and Updated tag while it's open.
 */
export async function openStory(id: number, onFailed: (error: Error) => void): Promise<StoryOut | null> {
  await refresh(storyPath(id));
  const before = getCached<StoryOut>(storyPath(id));
  if (before?.id !== id) return null;
  markSeen([id]).catch(onFailed);
  return before;
}

/**
 * The user is on News, with the recap's stories once the recap is on screen, which fixes it there.
 * The server puts the recap away once it has shown and the user has then been away an hour.
 */
export const noteHere = (recap: number[] | null) => sendJson<void>('POST', '/news/here', {recap});

/** The phone's Done on the recap: put away at once, its stories still unseen. Answers what Undo puts back. */
export const putRecapAway = () => sendJson<RecapDoneOut>('POST', '/news/recap/done');

/** Done's Undo: the recap's state as it was before. */
export const bringRecapBack = (undo: RecapUndoOut) => sendJson<void>('POST', '/news/recap/undo', undo);

/** Search news over the 90-day archive, expired stories included, newest first. */
export const searchNews = (text: string) => getJson<NewsSearchOut>(`/news/search?q=${encodeURIComponent(text)}`);

/**
 * Add to calendar on an Upcoming keynote: the event Calendar's editor opens on. Its calendar is
 * picked as an email's proposal picks it. Nothing is created until Create.
 */
export const newsProposal = (eventId: number) => sendJson<NewsProposalOut>('POST', `/news/events/${eventId}/proposal`);
