// What a live event refreshes (BUILD-PLAN.md › B1: the web refreshes only what an event names), as
// paths of the API resources on screen. A `mail` event names emails and accounts: the Inbox and
// All lists, the counts and triage's health (its Unsorted count) show them, and an open email
// refreshes only when it's named. An `items` event refreshes the item ranges, and the calendars and
// Todoist's projects (their colours, SV-25) when it names a calendar; a `health` event the accounts
// and sources. A `news` event refreshes News's lists (All, a section, Missed) when it names stories or
// sections, since a story's row lives in them; the page holds their order and draws only the rows'
// dots, sources and summaries in place, keeping the rest behind its pill (logic/news.ts). An open story
// refreshes only when it's named, Settings › News only when sources are, and an article never. Every
// `news` event refreshes sorting's state and Show headlines (N5): one naming nothing says sorting's
// state changed (down, back, the first run done), one naming sources brought articles to wait, and
// one naming stories sorted some.
import type {LiveEvent} from '@setpoint/shared';

/**
 * The keys refused while Setpoint is offline (states-05): those that change something, H, E, P, C, D,
 * Delete and Backspace, ⇧I, ⇧U and ⌘Z. Reading keys go through: J, K, Enter, Esc, /, 1, 2, 3, the
 * arrows, U, O, M, W, T and N.
 */
export function offlineRefuses(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (event.metaKey || event.ctrlKey) return key === 'z';
  if (event.altKey) return false;
  if (event.shiftKey) return key === 'i' || key === 'u';
  return ['h', 'e', 'p', 'c', 'd', 'Delete', 'Backspace'].includes(key);
}

const MAIL_LISTS = ['/mail/inbox', '/mail/counts', '/mail/all', '/mail/triage'];

export function pathsForEvent(event: LiveEvent, mounted: readonly string[]): string[] {
  const under = (prefix: string) => (path: string) => path === prefix || path.startsWith(`${prefix}?`) || path.startsWith(`${prefix}/`);
  switch (event.type) {
    case 'mail': {
      const named = new Set(event.messages.map(id => `/mail/messages/${id}`));
      return mounted.filter(path => MAIL_LISTS.some(prefix => under(prefix)(path)) || named.has(path));
    }
    case 'items':
      return mounted.filter(path => under('/items')(path) || (event.calendars.length > 0 && (under('/calendars')(path) || under('/todoist/projects')(path))));
    case 'health':
      return mounted.filter(path => under('/accounts')(path) || under('/sources')(path));
    case 'news': {
      const lists = event.stories.length > 0 || event.sections.length > 0 || event.sources.length > 0;
      const named = new Set(event.stories.map(id => `/news/stories/${id}`));
      return mounted.filter(path => (lists && (path === '/news' || under('/news/sections')(path) || path === '/news/missed'))
        || named.has(path) || (event.sources.length > 0 && path === '/news/sources') || path === '/news/status' || path === '/news/unsorted');
    }
  }
}
