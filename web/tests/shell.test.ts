// The shell's small rules as tables: the Today block, the tab title, the routes, a plain-text
// body's paragraphs, what a live event refreshes, and the toast's tone.
import type {ItemOut, LiveEvent} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE, deepLinkPath} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {paragraphs} from '../src/logic/body.ts';
import {pathsForEvent} from '../src/logic/live.ts';
import {parseRoute, routePath} from '../src/logic/route.ts';
import type {Route} from '../src/logic/route.ts';
import {tabTitle} from '../src/logic/title.ts';
import {shownTasks, todayBlock, todayRange} from '../src/logic/today.ts';
import {toastMs, toastTone} from '../src/logic/toast.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;

let nextId = 1;
function item(fields: Partial<ItemOut>): ItemOut {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, command: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null,
    all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, ...fields,
  };
}
const event = (title: string, starts: string, ends: string, fields: Partial<ItemOut> = {}) => item({title, starts_at: starts, ends_at: ends, ...fields});
const task = (title: string, due: string, fields: Partial<ItemOut> = {}) => item({kind: 'task', title, all_day: true, due_date: due, ...fields});

// The seed's two days: Gym at 7 (past), Dentist at 2:30, the lecture tomorrow, three tasks.
const gym = event('Gym', '2026-10-07T14:00:00.000Z', '2026-10-07T15:00:00.000Z', {key: '1@2026-10-07T14:00:00.000Z', recurring: true, occurrence_start: '2026-10-07T14:00:00.000Z'});
const dentist = event('Dentist', '2026-10-07T21:30:00.000Z', '2026-10-07T22:30:00.000Z');
const lecture = event('CS 101 lecture', '2026-10-09T01:00:00.000Z', '2026-10-09T02:15:00.000Z');
const seedItems = [task('CS 101 lab report', '2026-10-07'), task('Pay rent', '2026-10-07'), gym, dentist, task('Renew car registration', '2026-10-08'), lecture];

describe('the Today block', () => {
  const lines = (today: ReturnType<typeof todayBlock>) => today.tasks.map(line => [line.title, line.label]);

  test('the seed\'s morning: 2:30 PM Dentist in 5h, then its three tasks by name, tomorrow\'s marked', () => {
    const today = todayBlock(seedItems, now, zone);
    expect(today.event && [today.event.time, today.event.title, today.event.in, today.event.item.id]).toEqual(['2:30 PM', 'Dentist', 'in 5h', dentist.id]);
    expect(lines(today)).toEqual([['CS 101 lab report', null], ['Pay rent', null], ['Renew car registration', 'Tomorrow']]);
    expect(today.tasks.map(line => line.item.id)).toEqual([seedItems[0]!.id, seedItems[1]!.id, seedItems[4]!.id]);
    expect([today.today, today.tomorrow]).toEqual(['2026-10-07', '2026-10-08']);
  });

  test.each([
    ['an event under way says now', [event('Standup', '2026-10-07T16:00:00.000Z', '2026-10-07T16:30:00.000Z'), dentist], ['Standup', 'now']],
    ['nothing more today: no event line (tomorrow\'s isn\'t today\'s)', [gym, lecture], null],
    ['all-day events aren\'t the next event', [event('Holiday', '2026-10-07T07:00:00.000Z', '2026-10-08T07:00:00.000Z', {all_day: true}), dentist], ['Dentist', 'in 5h']],
    ['a pending event isn\'t confirmed yet', [event('Draft', '2026-10-07T18:00:00.000Z', '2026-10-07T19:00:00.000Z', {command: {state: 'pending'} as ItemOut['command']}), dentist], ['Dentist', 'in 5h']],
  ])('%s', (_name, items, expected) => {
    const today = todayBlock(items, now, zone);
    expect(today.event ? [today.event.title, today.event.in] : null).toEqual(expected);
  });

  test.each([
    ['none due: no task lines', [], []],
    ['done tasks don\'t count', [task('Pay rent', '2026-10-07', {done: true}), task('Renew', '2026-10-08')], [['Renew', 'Tomorrow']]],
    ['a task being completed isn\'t confirmed open', [task('Pay rent', '2026-10-07', {command: {state: 'pending'} as ItemOut['command']})], []],
    ['overdue and later tasks aren\'t today\'s', [task('Late', '2026-10-06'), task('Later', '2026-10-09')], []],
    ['today\'s come first, then tomorrow\'s, each day\'s timed ones by their time', [
      task('Tomorrow', '2026-10-08'),
      task('Evening', '2026-10-07', {all_day: false, due_at: '2026-10-08T01:00:00.000Z'}),
      task('Any time', '2026-10-07'),
      task('Morning', '2026-10-07', {all_day: false, due_at: '2026-10-07T16:00:00.000Z'}),
    ], [['Any time', null], ['Morning', null], ['Evening', null], ['Tomorrow', 'Tomorrow']]],
  ])('%s', (_name, items, expected) => {
    expect(lines(todayBlock(items, now, zone))).toEqual(expected);
  });

  test.each([
    ['three fit', 3, false, 3, null],
    ['more than three: two, then a line for the rest', 5, false, 2, '3 more due tomorrow'],
    ['opened, every one', 5, true, 5, null],
  ])('%s', (_name, count, open, shown, more) => {
    const items = [task('Pay rent', '2026-10-07'), ...Array.from({length: count - 1}, (_, index) => task(`Task ${index + 1}`, '2026-10-08'))];
    const today = todayBlock(items, now, zone);
    const cut = shownTasks(today.tasks, open);
    expect([cut.shown.length, cut.more]).toEqual([shown, more]);
  });

  test.each([
    ['all today\'s', ['2026-10-07', '2026-10-07', '2026-10-07', '2026-10-07'], '2 more due today'],
    ['today\'s and tomorrow\'s', ['2026-10-07', '2026-10-07', '2026-10-07', '2026-10-08'], '2 more due today and tomorrow'],
  ])('the rest\'s line names their days: %s', (_name, days, more) => {
    expect(shownTasks(todayBlock(days.map((day, index) => task(`Task ${index}`, day)), now, zone).tasks, false).more).toBe(more);
  });

  test('loads today and tomorrow', () => {
    expect(todayRange(now, zone)).toEqual({from: '2026-10-07', to: '2026-10-09'});
  });
});

test.each([
  ['attention waiting', {page: 'inbox', attention: 3, subject: null}, '(3) Inbox'],
  ['all caught up', {page: 'inbox', attention: 0, subject: null}, 'Inbox'],
  ['an email open', {page: 'inbox', attention: 3, subject: 'Interview availability for Software Engineer I'}, 'Interview availability for Software Engineer I'],
  ['Calendar', {page: 'calendar', title: 'October 2026'}, 'October 2026 · Calendar'],
  ['Calendar\'s week', {page: 'calendar', title: 'Oct 4 – 10, 2026'}, 'Oct 4 – 10, 2026 · Calendar'],
  ['News', {page: 'news', headline: null}, 'News'],
  ['a story open', {page: 'news', headline: 'Brush fire near the 210 grows to 400 acres'}, 'Brush fire near the 210 grows to 400 acres'],
] as const)('tab title: %s', (_name, page, expected) => {
  expect(tabTitle(page)).toBe(expected);
});

describe('routes', () => {
  test.each([
    ['/', '', {page: 'inbox', view: 'unread', account: null, open: null}],
    ['/inbox', '', {page: 'inbox', view: 'unread', account: null, open: null}],
    ['/inbox/12', '', {page: 'inbox', view: 'unread', account: null, open: 12}],
    ['/inbox/12', '?account=4', {page: 'inbox', view: 'unread', account: 4, open: 12}],
    ['/inbox/all', '', {page: 'inbox', view: 'all', account: null, open: null}],
    ['/inbox/nope', '?account=x', {page: 'inbox', view: 'unread', account: null, open: null}],
    ['/calendar', '', {page: 'calendar', date: null, item: null, at: null}],
    ['/calendar/2026-10-07', '', {page: 'calendar', date: '2026-10-07', item: null, at: null}],
    ['/calendar/item/3', '?at=2026-10-07T21%3A30%3A00.000Z', {page: 'calendar', date: null, item: 3, at: '2026-10-07T21:30:00.000Z'}],
    ['/calendar/item/3/edit', '', {page: 'calendar', date: null, item: 3, at: null, edit: true}],
    ['/calendar/item/3/edit', '?at=2026-10-07T21%3A30%3A00.000Z', {page: 'calendar', date: null, item: 3, at: '2026-10-07T21:30:00.000Z', edit: true}],
    ['/calendar/item/3/nope', '', {page: 'calendar', date: null, item: 3, at: null}],
    ['/calendar/new', '?kind=task', {page: 'calendar', date: null, item: null, at: null, compose: {kind: 'task', message: null}}],
    ['/calendar/new', '?kind=event&message=12', {page: 'calendar', date: null, item: null, at: null, compose: {kind: 'event', message: 12}}],
    ['/calendar/new', '?kind=nope', {page: 'calendar', date: null, item: null, at: null, compose: {kind: 'event', message: null}}],
    ['/calendar', '?view=week', {page: 'calendar', date: null, item: null, at: null, view: 'week'}],
    ['/calendar/2026-10-07', '?view=week', {page: 'calendar', date: '2026-10-07', item: null, at: null, view: 'week'}],
    ['/calendar/item/3', '?at=2026-10-07T21%3A30%3A00.000Z&view=week', {page: 'calendar', date: null, item: 3, at: '2026-10-07T21:30:00.000Z', view: 'week'}],
    ['/calendar/new', '?kind=task&view=week', {page: 'calendar', date: null, item: null, at: null, compose: {kind: 'task', message: null}, view: 'week'}],
    ['/calendar', '?view=nope', {page: 'calendar', date: null, item: null, at: null}],
    ['/settings', '', {page: 'settings', section: 'accounts'}],
    ['/settings/notifications', '', {page: 'settings', section: 'notifications'}],
    ['/calendar/new', '?kind=event&upcoming=4', {page: 'calendar', date: null, item: null, at: null, compose: {kind: 'event', message: null, upcoming: 4}}],
    ['/news', '', {page: 'news', view: 'all', story: null, article: null}],
    ['/news/local', '', {page: 'news', view: 'local', story: null, article: null}],
    ['/news/missed', '', {page: 'news', view: 'missed', story: null, article: null}],
    ['/news/story/18', '', {page: 'news', view: 'all', story: 18, article: null}],
    ['/news/ai/story/28/article/40', '', {page: 'news', view: 'ai', story: 28, article: 40}],
    ['/news/sports/story/3', '', {page: 'news', view: 'all', story: null, article: null}],
    ['/news/story/nope/article/4', '', {page: 'news', view: 'all', story: null, article: null}],
    ['/somewhere', '', {page: 'inbox', view: 'unread', account: null, open: null}],
  ] as const)('%s%s', (path, search, expected) => {
    const route = parseRoute(path, search);
    expect(route).toEqual(expected);
    const [pathname, query] = routePath(route).split('?');
    expect(parseRoute(pathname!, query ? `?${query}` : '')).toEqual(route);
  });

  test.each([
    {to: 'message', id: 12},
    {to: 'item', id: 3, occurrence_start: '2026-10-07T21:30:00.000Z'},
    {to: 'day', date: '2026-10-07'},
    {to: 'settings', page: 'accounts'},
  ] as const)('the server\'s deep link %o lands on its page', link => {
    const [pathname, query] = deepLinkPath(link).split('?');
    const route: Route = parseRoute(pathname!, query ? `?${query}` : '');
    expect(routePath(route)).toBe(deepLinkPath(link));
  });
});

test.each([
  ['blank lines part paragraphs; line breaks stay', 'Hi there,\n\nPlease pick a time.\n\nBest,\nPriya Raman\nRecruiting', [['Hi there,'], ['Please pick a time.'], ['Best,', 'Priya Raman', 'Recruiting']]],
  ['Windows line ends and extra blank lines', 'One\r\n\r\n\r\nTwo  \r\nthree', [['One'], ['Two', 'three']]],
  ['blank-looking lines with spaces part paragraphs', 'One\n   \nTwo', [['One'], ['Two']]],
  ['nothing', '\n\n', []],
])('paragraphs: %s', (_name, text, expected) => {
  expect(paragraphs(text)).toEqual(expected);
});

describe('live events refresh only what they name', () => {
  const mounted = ['/mail/inbox', '/mail/inbox?account_id=4', '/mail/counts', '/mail/messages/5', '/mail/messages/7', '/accounts', '/items?from=2026-10-07&to=2026-10-09', '/mail/inboxes', '/calendars', '/todoist/projects'];
  test.each([
    ['mail: the lists, the counts and the emails named', {type: 'mail', messages: [5], accounts: [4], commands: []}, ['/mail/inbox', '/mail/inbox?account_id=4', '/mail/counts', '/mail/messages/5']],
    ['items: the item ranges', {type: 'items', items: [2], calendars: [], commands: []}, ['/items?from=2026-10-07&to=2026-10-09']],
    ['items naming a calendar: the calendars and Todoist\'s projects too (SV-25)', {type: 'items', items: [], calendars: [4], commands: []}, ['/items?from=2026-10-07&to=2026-10-09', '/calendars', '/todoist/projects']],
    ['health: the accounts', {type: 'health', sources: [1]}, ['/accounts']],
  ] as [string, LiveEvent, string[]][])('%s', (_name, event, expected) => {
    expect(pathsForEvent(event, mounted)).toEqual(expected);
  });

  // News (N4): the lists refetch, and the page holds their order (logic/news.ts).
  // N5: sorting's state and Show headlines on every one.
  const news = ['/news', '/news/sections/local', '/news/missed', '/news/stories/1', '/news/stories/2', '/news/articles/3', '/news/sources', '/news/status', '/news/unsorted', '/mail/inbox'];
  test.each([
    ['stories changed in place: the lists, and the open story only when it\'s named', {type: 'news', stories: [1], sections: [], sources: []},
      ['/news', '/news/sections/local', '/news/missed', '/news/stories/1', '/news/status', '/news/unsorted']],
    ['sections re-ranked: the lists', {type: 'news', stories: [], sections: ['tech'], sources: []}, ['/news', '/news/sections/local', '/news/missed', '/news/status', '/news/unsorted']],
    ['a source\'s health or its articles: the lists\' lines and Settings › News', {type: 'news', stories: [], sections: [], sources: [4]},
      ['/news', '/news/sections/local', '/news/missed', '/news/sources', '/news/status', '/news/unsorted']],
    ['nothing named, sorting\'s state changed: the Unsorted and first-run lines', {type: 'news', stories: [], sections: [], sources: []}, ['/news/status', '/news/unsorted']],
  ] as [string, LiveEvent, string[]][])('news: %s', (_name, event, expected) => {
    expect(pathsForEvent(event, news)).toEqual(expected);
  });
});

describe('the toast\'s tone by its words (the one toast: done, taken away, failed)', () => {
  test.each([
    ['Marked Done', 'done'], ['Marked 14 as read', 'done'], ['Completed Pay rent', 'done'],
    ['Moved to Trash', 'gone'], ['Deleted Dentist', 'gone'], ['Deleted 2 items', 'gone'],
    ['Couldn\'t pin it, Gmail didn\'t answer in time.', 'failed'], ['Couldn\'t copy it', 'failed'], ['Couldn’t reorder rules, Can’t reach Setpoint', 'failed'],
    // Every other line has no glyph.
    ['Moved Dentist to Thu, Oct 8', null], ['Reopened Pay rent', null], ['Added to Classes', null], ['Copied Dentist, ⌘V pastes on the selected day', null],
    ['Showed 4 calendars', null], ['Created Haircut, Fri, Oct 9', null], ['Sign out of Setpoint?', null], ['Create or cancel the draft first', null],
  ])('%s: %s', (text, tone) => expect(toastTone(text)).toBe(tone));

  test('a toast stays six seconds, a failure eight', () => {
    expect([toastMs(null), toastMs('done'), toastMs('gone'), toastMs('failed')]).toEqual([6000, 6000, 6000, 8000]);
  });
});
