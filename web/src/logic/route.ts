// Setpoint's pages, kept in the address bar so a reload, a link or an ntfy notification lands in the
// same place. The paths agree with `deepLinkPath` in @setpoint/shared (the server builds ntfy's
// click links from it): /inbox/12 opens an email, /calendar/item/3 an item, /calendar/2026-10-07 a
// day, /settings/accounts a Settings page. An account filter rides in the query (?account=2).
// /calendar/new?kind=event opens the editor on a new item; &message=12 pre-fills it from that email's
// proposal (the proposal card's More options). /calendar/item/3/edit opens the editor on item 3 (the
// Today block's card's Edit, DESIGN.md › Decided while building #78). The week view rides in the
// query on every calendar address (?view=week); Month is the address without it (DESIGN.md › Week view).
// /calendar/new?kind=event&upcoming=4 opens it on News's Upcoming keynote 4 (its Add to calendar).
// News (after 2.0): /news is All, /news/local a section, /news/missed Catch up; /story/18 after any of
// them opens a story in the pane, and /article/2 after that one of its sources.
// Jobs (after News): /jobs is the page, /jobs/12 with application 12 open in its detail; from mail
// (J7), /jobs/12/posting arrives with its full posting unfolded, and /jobs?q=contoso searched.
import {ITEM_KINDS, NEWS_SECTIONS} from '@setpoint/shared';
import type {ItemKind, NewsSection} from '@setpoint/shared';

export const SETTINGS_PAGES = ['accounts', 'calendar', 'todoist', 'notifications', 'mail', 'news', 'ai', 'appearance', 'security'] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export type Compose = {kind: ItemKind; message: number | null; upcoming?: number};
/** News's list: All, a section, or Missed (Catch up). */
export type NewsView = 'all' | 'missed' | NewsSection;
/** Calendar's view. A route asking for none keeps the one showing (router.ts). */
export type CalendarMode = 'month' | 'week';

export type Route =
  | {page: 'inbox'; account: number | null; open: number | null}
  | {page: 'calendar'; date: string | null; item: number | null; at: string | null; compose?: Compose; edit?: true; view?: CalendarMode}
  | {page: 'settings'; section: SettingsPage}
  | {page: 'news'; view: NewsView; story: number | null; article: number | null}
  | {page: 'jobs'; open: number | null; posting?: true; q?: string};

const positive = (value: string | null | undefined) => (value && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : null);

export function parseRoute(pathname: string, search = ''): Route {
  const [first, second, third, fourth] = pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part));
  const query = new URLSearchParams(search);
  if (first === 'calendar') {
    const view = query.get('view') === 'week' ? {view: 'week'} as const : {};
    if (second === 'new') {
      const kind = (ITEM_KINDS as readonly string[]).includes(query.get('kind') ?? '') ? query.get('kind') as ItemKind : 'event';
      const upcoming = positive(query.get('upcoming'));
      return {page: 'calendar', date: null, item: null, at: null, compose: {kind, message: positive(query.get('message')), ...(upcoming ? {upcoming} : {})}, ...view};
    }
    if (second === 'item' && positive(third)) {
      return {page: 'calendar', date: null, item: positive(third), at: query.get('at'), ...(fourth === 'edit' ? {edit: true} as const : {}), ...view};
    }
    return {page: 'calendar', date: second && /^\d{4}-\d{2}-\d{2}$/.test(second) ? second : null, item: null, at: null, ...view};
  }
  if (first === 'news') {
    const parts = pathname.split('/').filter(Boolean).slice(1);
    const view: NewsView = (NEWS_SECTIONS as readonly string[]).includes(parts[0] ?? '') || parts[0] === 'missed' ? parts.shift() as NewsView : 'all';
    const story = parts[0] === 'story' ? positive(parts[1]) : null;
    const article = story && parts[2] === 'article' ? positive(parts[3]) : null;
    return {page: 'news', view, story, article};
  }
  if (first === 'jobs') {
    const open = positive(second);
    const q = query.get('q')?.trim();
    return {page: 'jobs', open, ...(open && third === 'posting' ? {posting: true} as const : {}), ...(q ? {q} : {})};
  }
  if (first === 'settings') {
    return {page: 'settings', section: (SETTINGS_PAGES as readonly string[]).includes(second ?? '') ? second as SettingsPage : 'accounts'};
  }
  const account = positive(query.get('account'));
  // All's old address (/inbox/all/12) from before the Inbox was one list (SV-70) lands there too.
  if (first === 'inbox' && second === 'all') return {page: 'inbox', account, open: positive(third)};
  return {page: 'inbox', account, open: first === 'inbox' ? positive(second) : null};
}

export function routePath(route: Route): string {
  switch (route.page) {
    case 'inbox':
      return `/inbox${route.open ? `/${route.open}` : ''}${route.account ? `?account=${route.account}` : ''}`;
    case 'calendar': {
      const week = route.view === 'week' ? 'view=week' : null;
      const query = (...parts: (string | null)[]) => (parts.some(Boolean) ? `?${parts.filter(Boolean).join('&')}` : '');
      if (route.compose) {
        const {kind, message, upcoming} = route.compose;
        return `/calendar/new${query(`kind=${kind}`, message ? `message=${message}` : null, upcoming ? `upcoming=${upcoming}` : null, week)}`;
      }
      if (route.item) return `/calendar/item/${route.item}${route.edit ? '/edit' : ''}${query(route.at ? `at=${encodeURIComponent(route.at)}` : null, week)}`;
      return `${route.date ? `/calendar/${route.date}` : '/calendar'}${query(week)}`;
    }
    case 'settings':
      return `/settings/${route.section}`;
    case 'jobs':
      return `/jobs${route.open ? `/${route.open}${route.posting ? '/posting' : ''}` : ''}${route.q?.trim() ? `?q=${encodeURIComponent(route.q.trim())}` : ''}`;
    case 'news':
      return `/news${route.view === 'all' ? '' : `/${route.view}`}${route.story ? `/story/${route.story}${route.article ? `/article/${route.article}` : ''}` : ''}`;
  }
}
