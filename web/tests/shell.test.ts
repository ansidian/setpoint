// The shell's small rules as tables: the Today block and the rail's next-up slot, whether the sidebar
// is the rail, the tab title, the routes, a plain-text body's paragraphs, what a live event refreshes,
// and the toast's tone.
import type {ItemOut, LiveEvent} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE, deepLinkPath} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {paragraphs} from '../src/logic/body.ts';
import {offlineRefuses, pathsForEvent} from '../src/logic/live.ts';
import {parseRoute, routePath} from '../src/logic/route.ts';
import type {Route} from '../src/logic/route.ts';
import {tabTitle} from '../src/logic/title.ts';
import {sidebarChoice, sidebarFoldable, sidebarFolded} from '../src/logic/sidebar.ts';
import {byTime, nextUp, shownTomorrow, todayBlock, todayRange} from '../src/logic/today.ts';
import {toastTone} from '../src/logic/toast.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;

let nextId = 1;
function item(fields: Partial<ItemOut>): ItemOut {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [],
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
  const lines = (today: ReturnType<typeof todayBlock>) => today.tasks.map(line => [line.title, line.tomorrow]);

  test('the seed\'s morning: 2:30 PM Dentist in 5h and today\'s two tasks; tomorrow, the lecture at its time and one task', () => {
    const today = todayBlock(seedItems, now, zone);
    expect(today.event && [today.event.time, today.event.title, today.event.in, today.event.item.id]).toEqual(['2:30 PM', 'Dentist', 'in 5h', dentist.id]);
    expect(lines(today)).toEqual([['CS 101 lab report', false], ['Pay rent', false], ['Renew car registration', true]]);
    expect(today.tasks.map(line => line.item.id)).toEqual([seedItems[0]!.id, seedItems[1]!.id, seedItems[4]!.id]);
    expect(today.tomorrowEvents.map(line => [line.time, line.title, line.item.id])).toEqual([['6:00 PM', 'CS 101 lecture', lecture.id]]);
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

  // shell-06: "in 12m" warms as it nears: `caution` from 15 minutes before, `alert` once under way.
  test.each([
    ['16 minutes away', '2026-10-07T16:25:00.000Z', 'in 16m', null],
    ['15 minutes away', '2026-10-07T16:24:00.000Z', 'in 15m', 'soon'],
    ['under way', '2026-10-07T16:00:00.000Z', 'now', 'now'],
  ])('the next event\'s urgency, %s', (_name, starts, words, urgency) => {
    const at = Date.parse('2026-10-07T16:09:00.000Z');
    const today = todayBlock([event('Standup', starts, '2026-10-07T23:00:00.000Z')], at, zone);
    expect([today.event?.in, today.event?.urgency]).toEqual([words, urgency]);
  });

  test.each([
    ['none due: no task lines', [], []],
    ['done tasks don\'t count', [task('Pay rent', '2026-10-07', {done: true}), task('Renew', '2026-10-08')], [['Renew', true]]],
    ['a task being completed isn\'t confirmed open', [task('Pay rent', '2026-10-07', {command: {state: 'pending'} as ItemOut['command']})], []],
    ['overdue and later tasks aren\'t today\'s', [task('Late', '2026-10-06'), task('Later', '2026-10-09')], []],
    // D501: each day's timed ones by their time, then the untimed.
    ['today\'s come first, then tomorrow\'s, each day\'s timed ones by their time, then the untimed', [
      task('Tomorrow', '2026-10-08'),
      task('Evening', '2026-10-07', {all_day: false, due_at: '2026-10-08T01:00:00.000Z'}),
      task('Any time', '2026-10-07'),
      task('Morning', '2026-10-07', {all_day: false, due_at: '2026-10-07T16:00:00.000Z'}),
      task('Tomorrow at 9', '2026-10-08', {all_day: false, due_at: '2026-10-08T16:00:00.000Z'}),
    ], [['Morning', false], ['Evening', false], ['Any time', false], ['Tomorrow at 9', true], ['Tomorrow', true]]],
  ])('%s', (_name, items, expected) => {
    expect(lines(todayBlock(items, now, zone))).toEqual(expected);
  });

  // D501: a timed task says its time alone, as the week's all-day row; an untimed one says none.
  test('a task\'s time', () => {
    const today = todayBlock([task('Call the bank', '2026-10-07', {all_day: false, due_at: '2026-10-07T15:00:00.000Z'}), task('Pay rent', '2026-10-07')], now, zone);
    expect(today.tasks.map(line => [line.title, line.time])).toEqual([['Call the bank', '8:00 AM'], ['Pay rent', null]]);
  });

  // D501: a day's events and tasks in one list by time, an event first at the same time, the untimed
  // tasks last in the order given; a task whose time has passed sorts by it, so it leads.
  test.each([
    ['the seed\'s morning with timed tasks: the passed one first, the event among them, the untimed last', [
      task('Any time', '2026-10-07'),
      task('Evening', '2026-10-07', {due_at: '2026-10-08T01:00:00.000Z'}),
      dentist,
      task('Passed', '2026-10-07', {due_at: '2026-10-07T15:00:00.000Z'}),
      task('Also any time', '2026-10-07'),
    ], ['Passed', 'Dentist', 'Evening', 'Any time', 'Also any time']],
    ['an event and a task at the same time: the event first', [
      task('Floss', '2026-10-07', {due_at: '2026-10-07T21:30:00.000Z'}),
      dentist,
    ], ['Dentist', 'Floss']],
    ['events alone, by their start', [dentist, gym], ['Gym', 'Dentist']],
    ['untimed tasks alone keep their order', [task('B', '2026-10-07'), task('A', '2026-10-07')], ['B', 'A']],
  ])('in time order, %s', (_name, items, expected) => {
    expect(byTime(items, one => one).map(one => one.title)).toEqual(expected);
  });

  // D501: tomorrow's fold counts the list in time order, so a timed task before an event shows first.
  test('tomorrow\'s fold in time order', () => {
    const lines = byTime([
      lecture,
      task('Book flights', '2026-10-08', {due_at: '2026-10-08T22:00:00.000Z'}),
      task('Renew car registration', '2026-10-08'),
      task('Standup notes', '2026-10-08', {due_at: '2026-10-08T16:30:00.000Z'}),
    ], one => one);
    const cut = shownTomorrow(lines, false, one => one.kind === 'event');
    expect([cut.shown.map(one => one.title), cut.more]).toEqual([['Standup notes', 'Book flights'], '2 more tomorrow']);
  });

  // D460: tomorrow's timed events by their start; all-day and pending ones, and today's, aren't listed.
  test('tomorrow\'s events', () => {
    const items = [
      event('Late', '2026-10-09T03:00:00.000Z', '2026-10-09T04:00:00.000Z'),
      lecture,
      event('Holiday', '2026-10-08T07:00:00.000Z', '2026-10-09T07:00:00.000Z', {all_day: true}),
      event('Draft', '2026-10-08T18:00:00.000Z', '2026-10-08T19:00:00.000Z', {command: {state: 'pending'} as ItemOut['command']}),
      dentist,
    ];
    expect(todayBlock(items, now, zone).tomorrowEvents.map(line => [line.time, line.title])).toEqual([['6:00 PM', 'CS 101 lecture'], ['8:00 PM', 'Late']]);
  });

  // D460: only tomorrow's lines fold; the rest's line says "due" unless an event is among them.
  test.each([
    ['three fit', ['task', 'task', 'task'], false, 3, null],
    ['more than three: two, then a line for the rest', ['task', 'task', 'task', 'task', 'task'], false, 2, '3 more due tomorrow'],
    ['an event among the rest', ['event', 'event', 'event', 'task'], false, 2, '2 more tomorrow'],
    ['opened, every one', ['task', 'task', 'task', 'task', 'task'], true, 5, null],
  ])('tomorrow\'s fold, %s', (_name, kinds, open, shown, more) => {
    const cut = shownTomorrow(kinds, open, kind => kind === 'event');
    expect([cut.shown.length, cut.more]).toEqual([shown, more]);
  });

  test('loads today and tomorrow', () => {
    expect(todayRange(now, zone)).toEqual({from: '2026-10-07', to: '2026-10-09'});
  });
});

test.each([
  ['mail unread (SV-221)', {page: 'inbox', unread: 13, subject: null}, '(13) Inbox'],
  ['all read', {page: 'inbox', unread: 0, subject: null}, 'Inbox'],
  ['an email open', {page: 'inbox', unread: 13, subject: 'Interview availability for Software Engineer I'}, 'Interview availability for Software Engineer I'],
  ['Calendar', {page: 'calendar', title: 'October 2026'}, 'October 2026 · Calendar'],
  ['News', {page: 'news', headline: null}, 'News'],
  ['a story open', {page: 'news', headline: 'Brush fire near the 210 grows to 400 acres'}, 'Brush fire near the 210 grows to 400 acres'],
] as const)('tab title: %s', (_name, page, expected) => {
  expect(tabTitle(page)).toBe(expected);
});

describe('routes', () => {
  test.each([
    ['/', '', {page: 'inbox', open: null}],
    ['/inbox', '', {page: 'inbox', open: null}],
    ['/inbox/12', '', {page: 'inbox', open: 12}],
    ['/inbox/nope', '', {page: 'inbox', open: null}],
    // The Inbox's views (SV-221): All is the address without one.
    ['/inbox', '?view=unread', {page: 'inbox', open: null, view: 'unread'}],
    ['/inbox/12', '?view=fyi', {page: 'inbox', open: 12, view: 'fyi'}],
    ['/inbox', '?view=all', {page: 'inbox', open: null}],
    ['/inbox', '?view=nope', {page: 'inbox', open: null}],
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
    // Catch up's old address is All, where the recap is (#298).
    ['/news/missed', '', {page: 'news', view: 'all', story: null, article: null}],
    ['/news/story/18', '', {page: 'news', view: 'all', story: 18, article: null}],
    ['/news/ai/story/28/article/40', '', {page: 'news', view: 'ai', story: 28, article: 40}],
    ['/news/sports/story/3', '', {page: 'news', view: 'all', story: null, article: null}],
    ['/news/story/nope/article/4', '', {page: 'news', view: 'all', story: null, article: null}],
    ['/jobs', '', {page: 'jobs', open: null}],
    ['/jobs/12', '', {page: 'jobs', open: 12}],
    ['/jobs/nope', '', {page: 'jobs', open: null}],
    // From mail (J7): Full posting arrives unfolded, and Applied before searched for the company.
    ['/jobs/12/posting', '', {page: 'jobs', open: 12, posting: true}],
    ['/jobs/posting', '', {page: 'jobs', open: null}],
    // From Settings › Jobs's Show (J8): From history unfolded.
    ['/jobs/from-history', '', {page: 'jobs', open: null, history: true}],
    ['/jobs', '?q=contoso%20pharmaceuticals', {page: 'jobs', open: null, q: 'contoso pharmaceuticals'}],
    ['/jobs', '?q=%20%20', {page: 'jobs', open: null}],
    ['/somewhere', '', {page: 'inbox', open: null}],
  ] as const)('%s%s', (path, search, expected) => {
    const route = parseRoute(path, search);
    expect(route).toEqual(expected);
    const [pathname, query] = routePath(route).split('?');
    expect(parseRoute(pathname!, query ? `?${query}` : '')).toEqual(route);
  });

  // All was its own view until the Inbox became one list (SV-70): its addresses still land there.
  test.each([
    ['/inbox/all', '', {page: 'inbox', open: null}],
    ['/inbox/all/12', '', {page: 'inbox', open: 12}],
  ] as const)('%s%s, All\'s old address, opens the Inbox', (path, search, expected) => {
    expect(parseRoute(path, search)).toEqual(expected);
  });

  // The account filter's addresses (D476) are the plain Inbox, its view and open email kept.
  test.each([
    ['/inbox', '?account=4', {page: 'inbox', open: null}, '/inbox'],
    ['/inbox/12', '?account=4&view=fyi', {page: 'inbox', open: 12, view: 'fyi'}, '/inbox/12?view=fyi'],
    ['/inbox/all/12', '?account=4', {page: 'inbox', open: 12}, '/inbox/12'],
  ] as const)('%s%s, the account filter\'s old address, opens the plain Inbox', (path, search, expected, address) => {
    expect(parseRoute(path, search)).toEqual(expected);
    expect(routePath(parseRoute(path, search))).toBe(address);
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
  const mounted = ['/mail/inbox', '/mail/counts', '/mail/messages/5', '/mail/messages/7', '/accounts', '/items?from=2026-10-07&to=2026-10-09', '/mail/inboxes', '/calendars', '/todoist/projects'];
  test.each([
    ['mail: the lists, the counts and the emails named', {type: 'mail', messages: [5], accounts: [4], commands: []}, ['/mail/inbox', '/mail/counts', '/mail/messages/5']],
    ['items: the item ranges', {type: 'items', items: [2], calendars: [], commands: []}, ['/items?from=2026-10-07&to=2026-10-09']],
    ['items naming a calendar: the calendars and Todoist\'s projects too (SV-25)', {type: 'items', items: [], calendars: [4], commands: []}, ['/items?from=2026-10-07&to=2026-10-09', '/calendars', '/todoist/projects']],
    ['health: the accounts', {type: 'health', sources: [1]}, ['/accounts']],
  ] as [string, LiveEvent, string[]][])('%s', (_name, event, expected) => {
    expect(pathsForEvent(event, mounted)).toEqual(expected);
  });

  // News (N4): the lists refetch, and the page holds their order (logic/news.ts).
  // N5: sorting's state and Show headlines on every one.
  const news = ['/news', '/news/sections/local', '/news/stories/1', '/news/stories/2', '/news/articles/3', '/news/sources', '/news/status', '/news/unsorted', '/mail/inbox'];
  test.each([
    ['stories changed in place: the lists, and the open story only when it\'s named', {type: 'news', stories: [1], sections: [], sources: []},
      ['/news', '/news/sections/local', '/news/stories/1', '/news/status', '/news/unsorted']],
    ['sections re-ranked, or the recap put away: the lists', {type: 'news', stories: [], sections: ['tech'], sources: []}, ['/news', '/news/sections/local', '/news/status', '/news/unsorted']],
    ['a source\'s health or its articles: the lists\' lines and Settings › News', {type: 'news', stories: [], sections: [], sources: [4]},
      ['/news', '/news/sections/local', '/news/sources', '/news/status', '/news/unsorted']],
    ['nothing named, sorting\'s state changed: the Unsorted and first-run lines', {type: 'news', stories: [], sections: [], sources: []}, ['/news/status', '/news/unsorted']],
  ] as [string, LiveEvent, string[]][])('news: %s', (_name, event, expected) => {
    expect(pathsForEvent(event, news)).toEqual(expected);
  });

  // Jobs (J5): every event refreshes what's on screen under /jobs: the page, the shell's item, an open
  // application and a search, so a row lands, moves or changes its JD in place.
  test('jobs: everything mounted under /jobs, nothing else', () => {
    const mounted = ['/jobs', '/jobs/nav', '/jobs/applications/4', '/jobs/search?q=humongous', '/jobsearch', '/mail/inbox'];
    expect(pathsForEvent({type: 'jobs', applications: [4], needs_you: []}, mounted)).toEqual(['/jobs', '/jobs/nav', '/jobs/applications/4', '/jobs/search?q=humongous']);
  });
});

// The polish audit's states-05: offline, the keys that change something are refused; reading goes on.
describe('the keys offline refuses', () => {
  const key = (name: string, mods: {shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean} = {}) => ({key: name, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...mods});
  test.each([
    ['H (Done)', key('h'), true], ['E (Trash, Edit)', key('e'), true], ['P (Pin)', key('p'), true], ['C (New event)', key('c'), true], ['D (New task)', key('d'), true],
    ['Delete', key('Delete'), true], ['Backspace', key('Backspace'), true], ['⇧I (Mark all as read)', key('I', {shiftKey: true}), true], ['⇧U (Mark unread)', key('U', {shiftKey: true}), true],
    ['⌘Z (Undo)', key('z', {metaKey: true}), true], ['Ctrl-Z', key('z', {ctrlKey: true}), true],
    ['J', key('j'), false], ['U (Unread or All)', key('u'), false], ['⌘K', key('k', {metaKey: true}), false], ['⇧H is no change', key('H', {shiftKey: true}), false],
  ])('%s: refused %s', (_name, event, refused) => expect(offlineRefuses(event)).toBe(refused));
});

describe('the toast\'s tone by its words (the one toast: done, taken away, failed, pinned)', () => {
  test.each([
    // A pin made out of the shelf's sight says so with its glyph (inbox-09).
    ['Pinned', 'pinned'],
    ['Marked Done', 'done'], ['Completed Pay rent', 'done'],
    ['Moved to Trash', 'gone'], ['Deleted Dentist', 'gone'],
    ['Couldn\'t pin it, Gmail didn\'t answer in time.', 'failed'], ['Couldn’t reorder rules, Can’t reach Setpoint', 'failed'],
    // Every other line has no glyph.
    ['Moved Dentist to Thu, Oct 8', null], ['Reopened Pay rent', null],
  ])('%s: %s', (text, tone) => expect(toastTone(text)).toBe(tone));
});

// D509: the folded rail's one slot, today's next timed item alike for an event or a task (the seed's
// clock is 9:12 AM): its countdown, warmth and what else is left today, or none.
describe('the rail\'s next-up slot', () => {
  const timed = (title: string, due: string) => task(title, '2026-10-07', {all_day: false, due_at: due});
  const slot = (items: ItemOut[]) => {
    const next = nextUp(items, now, zone);
    return next && [next.title, next.time, next.in, next.urgency, next.more];
  };
  test.each([
    ['the seed\'s day: Gym is over, Dentist is next, two tasks and nothing else left', seedItems, ['Dentist', '2:30 PM', '5h', null, 2]],
    ['a timed task before the event is next', [...seedItems, timed('Call the bank', '2026-10-07T17:00:00.000Z')], ['Call the bank', '10:00 AM', '48m', null, 3]],
    ['within 15 minutes it warms', [event('Standup', '2026-10-07T16:20:00.000Z', '2026-10-07T16:35:00.000Z')], ['Standup', '9:20 AM', '8m', 'soon', 0]],
    ['an event under way is now', [event('Standup', '2026-10-07T16:00:00.000Z', '2026-10-07T17:00:00.000Z'), dentist], ['Standup', '9:00 AM', 'now', 'now', 1]],
    ['an event and a task at the same time: the event', [timed('Call the bank', '2026-10-07T21:30:00.000Z'), dentist], ['Dentist', '2:30 PM', '5h', null, 1]],
    ['a timed task whose time has passed isn\'t next', [timed('Call the bank', '2026-10-07T15:00:00.000Z'), task('Pay rent', '2026-10-07')], null],
    ['untimed tasks alone: none', [task('Pay rent', '2026-10-07')], null],
    ['tomorrow\'s event isn\'t today\'s', [lecture, task('Renew car registration', '2026-10-08')], null],
    ['a pending event doesn\'t count', [{...dentist, command: {state: 'pending'} as ItemOut['command']}], null],
    ['an all-day event has no time', [event('Holiday', '2026-10-07T07:00:00.000Z', '2026-10-08T07:00:00.000Z', {all_day: true})], null],
  ] as const)('%s', (_name, items, expected) => expect(slot([...items])).toEqual(expected));
});

// D507: the rail under 1100 px always; from there the choice made by hand, else the width (the
// rail below 1600). The width is the window's, so the 1.075 zoom at 1591 doesn't move it.
describe('whether the sidebar is the rail', () => {
  test.each([
    ['the compact tier: always', 1000, null, true],
    ['the compact tier, though opened by hand', 1099, 'open', true],
    ['1100, nothing chosen: the rail', 1100, null, true],
    ['1100, opened by hand', 1100, 'open', false],
    ['a MacBook\'s 1591, nothing chosen: the rail', 1591, null, true],
    ['1599: the rail', 1599, null, true],
    ['1600: open', 1600, null, false],
    ['the design target: open', 1677, null, false],
    ['the design target, folded by hand', 1677, 'rail', true],
    ['wide, opened by hand', 2400, 'open', false],
  ] as const)('%s', (_name, width, choice, expected) => expect(sidebarFolded(width, choice)).toBe(expected));

  test.each([
    ['rail', 'rail'],
    ['open', 'open'],
    [null, null],
    ['wide', null],
    ['', null],
  ] as const)('the kept choice %j reads as %j', (stored, expected) => expect(sidebarChoice(stored)).toBe(expected));

  test.each([[1099, false], [1100, true]] as const)('opens and folds by hand at %i: %s', (width, expected) => expect(sidebarFoldable(width)).toBe(expected));
});
