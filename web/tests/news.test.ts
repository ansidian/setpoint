// News's rules as tables (DESIGN.md › News; D87): the meta copy and ages against the seed's moment
// (Wed, Oct 7, 2026, 9:12 AM Pacific; the user last looked Mon at 10:40 PM), the held order and what the
// pill counts, seen timing, the cursor, and Upcoming's line; N5's states, Settings › News and
// Settings › AI's News group.
import type {StoryRowOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  articleNote, dueSeen, factsSince, initials, lookedAt, openedInVisit, shownState, visitDots, missedDay, missedSince, missedTitle, moreLine, moveStory, neighbourStory, nextSeen, outletLine, pillParts,
  rowMeta, sameLayout, SECTION_GLYPHS, sight, stamp, storiesCount, storiesOnScreen, storyKey, storyMeta, upcomingWhen, waiting, waitingSince,
  capMeter, cappedLine, CAP_CHOICES, dollars, emptySectionLine, everyLine, feedFailing, firstRunLine, newsSourceState, newsUsageParts, sectionLine, sourcesHeader, sourceTile, unsortedLine,
} from '../src/logic/news.ts';
import type {Layout} from '../src/logic/news.ts';
import {news} from '../src/tokens.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;
const LAST_LOOK = '2026-10-06T05:40:00.000Z';

let nextId = 100;
function story(fields: Partial<StoryRowOut> = {}): StoryRowOut {
  return {
    id: nextId++, headline: 'A story', one_line: null, sections: ['local'], state: 'new',
    lead: {article_id: 1, outlet: 'KTLA', outlet_short: 'KTLA', more: 0, published_at: '2026-10-07T15:02:00.000Z', url: 'https://ktla.example/a'},
    image: null, first_reported_at: '2026-10-07T12:00:00.000Z', last_new_fact_at: '2026-10-07T15:40:00.000Z', seen_at: null, expired_at: null, ...fields,
  };
}
const lead = (outlet_short: string, more: number, published_at = '2026-10-07T15:02:00.000Z') => ({...story().lead, outlet_short, more, published_at});

test('each section\'s glyph (#161): Local location_on, Tech computer, AI auto_awesome, General public', () => {
  expect(SECTION_GLYPHS).toEqual({local: 'location_on', tech: 'computer', ai: 'auto_awesome', general: 'public'});
});

describe('meta copy', () => {
  test.each([
    ['the brush fire: KTLA +4, 1h, updated at 8:40 AM', story({state: 'updated', lead: lead('KTLA', 4), seen_at: LAST_LOOK}), null,
      {section: null, outlet: 'KTLA +4', age: '1h', updated: 'Updated 8:40 AM'}],
    ['one outlet: no "+0"', story({lead: lead('NWS', 0, '2026-10-07T13:12:00.000Z')}), null, {section: null, outlet: 'NWS', age: '3h', updated: null}],
    ['seen: its age, no Updated', story({state: 'seen', lead: lead('LAist', 3, '2026-10-06T22:20:00.000Z')}), null, {section: null, outlet: 'LAist +3', age: 'Yesterday', updated: null}],
    ['an update yesterday says the day', story({state: 'updated', last_new_fact_at: '2026-10-07T03:00:00.000Z'}), null, {section: null, outlet: 'KTLA', age: '1h', updated: 'Updated Yesterday'}],
    ['Missed leads with the section', story({lead: lead('NPR', 9, '2026-10-06T13:40:00.000Z')}), 'general', {section: 'General', outlet: 'NPR +9', age: 'Yesterday', updated: null}],
    ['Missed from Monday', story({lead: lead('Google', 6, '2026-10-05T17:00:00.000Z')}), 'ai', {section: 'AI', outlet: 'Google +6', age: 'Mon', updated: null}],
  ] as const)('%s', (_name, row, section, expected) => {
    expect(rowMeta(row, now, zone, section)).toEqual(expected);
  });

  test('the leading outlet\'s line', () => {
    expect([outletLine(lead('NBC LA', 2)), outletLine(lead('Streetsblog LA', 0))]).toEqual(['NBC LA +2', 'Streetsblog LA']);
  });

  test.each([
    ['today: the clock time', '2026-10-07T15:40:00.000Z', '8:40 AM'],
    ['yesterday', '2026-10-06T23:00:00.000Z', 'Yesterday 4:00 PM'],
    ['The user\'s last look, Monday night', LAST_LOOK, 'Mon 10:40 PM'],
    ['over a week back: the date', '2026-09-29T02:15:00.000Z', 'Sep 28, 7:15 PM'],
  ])('a moment: %s', (_name, at, expected) => {
    expect(stamp(at, now, zone)).toBe(expected);
  });

  test.each([
    ['the sample\'s 14, since Monday', 14, LAST_LOOK, '14 stories', 'you missed since Mon', 'Missed since Mon 10:40 PM'],
    ['one, since this morning', 1, '2026-10-07T14:00:00.000Z', '1 story', 'you missed since 7:00 AM', 'Missed since 7:00 AM'],
    ['never looked', 3, null, '3 stories', 'you missed', 'Missed'],
  ])('the Missed strip and title: %s', (_name, count, since, strip, rest, title) => {
    expect([storiesCount(count), missedSince(since, now, zone), missedTitle(since, now, zone)]).toEqual([strip, rest, title]);
  });

  test('a day of Missed, "more" and the pane\'s meta', () => {
    expect(missedDay('2026-10-06')).toEqual({day: 'Tuesday', date: 'Oct 6'});
    expect(moreLine(12, 'local')).toBe('12 more in Local');
    expect(storyMeta({outlets: 5, first_reported_at: '2026-10-05T13:12:00.000Z', last_new_fact_at: '2026-10-07T15:40:00.000Z'}, now, zone))
      .toEqual(['5 outlets', 'first reported Mon 6:12 AM', 'updated 8:40 AM']);
    expect(storyMeta({outlets: 1, first_reported_at: '2026-10-07T13:12:00.000Z', last_new_fact_at: '2026-10-07T13:12:00.000Z'}, now, zone))
      .toEqual(['1 outlet', 'first reported 6:12 AM']);
  });

  test.each([
    ['KTLA', 'K'], ['NBC Los Angeles', 'NBC'], ['CBS Los Angeles', 'CBS'], ['ABC7', '7'], ['FOX 11', '11'], ['The Verge', 'V'], ['NPR', 'N'], ['ABC News', 'ABC'],
    ['9to5Google', '9'], ['Hugging Face', 'H'],
  ])('the badge: %s → %s', (outlet, expected) => {
    expect(initials(outlet)).toBe(expected);
  });

  test.each([
    ['readable: no note', {outlet: 'NBC Los Angeles', summary_only: false, discovery: false}, null],
    ['summary only (26b)', {outlet: 'KTLA', summary_only: true, discovery: false}, 'KTLA\'s page can\'t be read here, so this is its feed summary'],
    ['found only by Google News', {outlet: 'Daily News', summary_only: false, discovery: true}, 'Only Google News found Daily News\'s story, so it isn\'t read here'],
  ])('an article\'s note: %s', (_name, article, expected) => {
    expect(articleNote(article)).toBe(expected);
  });
});

describe('Upcoming', () => {
  const apple = {name: 'Apple event', starts_at: '2026-10-20T17:00:00.000Z', all_day: false};
  test('its line: the day and time, the time without :00', () => {
    expect(upcomingWhen(apple, zone)).toBe('Tue Oct 20 · 10 AM');
    expect(upcomingWhen({...apple, starts_at: '2026-10-20T17:30:00.000Z'}, zone)).toBe('Tue Oct 20 · 10:30 AM');
  });
  test('a keynote with no time yet: its day alone', () => {
    expect(upcomingWhen({starts_at: '2027-01-21T08:00:00.000Z', all_day: true}, zone)).toBe('Thu Jan 21');
  });
});

describe('the held order and the pill', () => {
  const rows = new Map<number, StoryRowOut>([
    [1, story({id: 1, state: 'seen'})], [2, story({id: 2})], [3, story({id: 3, state: 'updated'})], [4, story({id: 4, state: 'seen'})],
    [5, story({id: 5})], [6, story({id: 6})], [7, story({id: 7, state: 'updated'})], [8, story({id: 8, state: 'seen'})],
  ]);
  const held: Layout = [{key: 'local', ids: [1, 2, 3], more: 12}, {key: 'tech', ids: [4], more: 7}];
  test.each([
    ['nothing changed', held, {fresh: 0, updated: 0, changed: false}],
    ['a new story ranks into Local', [{key: 'local', ids: [5, 1, 2], more: 13}, {key: 'tech', ids: [4], more: 7}], {fresh: 1, updated: 0, changed: true}],
    ['the board\'s three new and one updated', [{key: 'local', ids: [5, 7, 1], more: 13}, {key: 'tech', ids: [6, 4], more: 6}, {key: 'ai', ids: [2], more: 0}],
      {fresh: 2, updated: 1, changed: true}],
    ['a seen story moving into view says nothing, but the order did change', [{key: 'local', ids: [1, 2, 3], more: 12}, {key: 'tech', ids: [8, 4], more: 6}], {fresh: 0, updated: 0, changed: true}],
    ['re-ranked among those shown: nothing to count', [{key: 'local', ids: [3, 1, 2], more: 12}, {key: 'tech', ids: [4], more: 7}], {fresh: 0, updated: 0, changed: true}],
    ['a story leaving: nothing to count', [{key: 'local', ids: [1, 2], more: 12}, {key: 'tech', ids: [4], more: 7}], {fresh: 0, updated: 0, changed: true}],
    ['one story in two blocks counts once', [{key: 'local', ids: [1, 2, 3], more: 12}, {key: 'tech', ids: [5, 4], more: 7}, {key: 'ai', ids: [5], more: 0}], {fresh: 1, updated: 0, changed: true}],
    ['only the "more" changed', [{key: 'local', ids: [1, 2, 3], more: 13}, {key: 'tech', ids: [4], more: 7}], {fresh: 0, updated: 0, changed: true}],
  ] as [string, Layout, ReturnType<typeof waiting>][])('%s', (_name, latest, expected) => {
    expect(waiting(held, latest, rows)).toEqual(expected);
  });

  test.each([
    [{fresh: 3, updated: 1}, {fresh: '3 new', updated: '1 updated'}],
    [{fresh: 2, updated: 0}, {fresh: '2 new', updated: null}],
    [{fresh: 0, updated: 1}, {fresh: null, updated: '1 updated'}],
    [{fresh: 0, updated: 0}, null],
  ])('the pill says %o', (counts, expected) => {
    expect(pillParts(counts)).toEqual(expected);
  });

  test('the same layout', () => {
    expect(sameLayout(held, held.map(shelf => ({...shelf, ids: [...shelf.ids]})))).toBe(true);
    expect(sameLayout(held, [held[1]!, held[0]!])).toBe(false);
  });

  test.each([
    ['updated: since its last look', [{state: 'updated', seen_at: LAST_LOOK}], LAST_LOOK],
    ['the first that has it updated', [null, {state: 'seen', seen_at: '2026-10-07T16:12:00.000Z'}, {state: 'updated', seen_at: LAST_LOOK}], LAST_LOOK],
    ['never seen: no "New since you looked"', [{state: 'new', seen_at: null}], null],
  ] as [string, ({state: StoryRowOut['state']; seen_at: string | null} | null)[], string | null][])('looked at: %s', (_name, states, expected) => {
    expect(lookedAt(...states)).toBe(expected);
  });

  test('the facts since that look, newest first', () => {
    const facts = [{at: '2026-10-05T13:12:00.000Z', text: 'Broke out'}, {at: '2026-10-07T13:55:00.000Z', text: 'Schools closed'}, {at: '2026-10-07T15:40:00.000Z', text: 'Grew to 400 acres'}];
    expect(factsSince(facts, LAST_LOOK).map(fact => fact.text)).toEqual(['Grew to 400 acres', 'Schools closed']);
  });
});

describe('the visit\'s dots (#95): they stay for the visit, go when opened, and come back with a new fact', () => {
  const NOW = '2026-10-07T16:12:00.000Z';
  const fire = {id: 1, state: 'updated' as const, last_new_fact_at: '2026-10-07T15:40:00.000Z', seen_at: LAST_LOOK};
  const flag = {id: 2, state: 'new' as const, last_new_fact_at: '2026-10-07T13:12:00.000Z', seen_at: null};
  const council = {id: 3, state: 'seen' as const, last_new_fact_at: '2026-10-05T19:40:00.000Z', seen_at: LAST_LOOK};
  type Row = typeof fire | typeof flag | typeof council | {id: number; state: StoryRowOut['state']; last_new_fact_at: string; seen_at: string | null};
  type Step = {rows: Row[]} | {open: number};
  const run = (steps: Step[]) => steps.reduce<ReturnType<typeof visitDots>>((visit, step) => ('open' in step ? openedInVisit(visit, step.open) : visitDots(visit, step.rows)), new Map());
  const states = (visit: ReturnType<typeof visitDots>, rows: Row[]) => rows.map(row => shownState(row, visit));
  const seen = <R extends Row>(row: R): Row => ({...row, state: 'seen', seen_at: NOW});

  test.each([
    ['on arrival: each story\'s own dot', [{rows: [fire, flag, council]}], [fire, flag, council], ['updated', 'new', 'seen']],
    ['seen on screen: the dots stay for the visit', [{rows: [fire, flag, council]}, {rows: [seen(fire), seen(flag), council]}], [seen(fire), seen(flag), council], ['updated', 'new', 'seen']],
    ['opened: its dot goes at once', [{rows: [fire, flag]}, {open: 1}], [fire, flag], ['seen', 'new']],
    ['opened, then seen in an answer: still gone', [{rows: [fire]}, {open: 1}, {rows: [seen(fire)]}], [seen(fire)], ['seen']],
    ['a fact during the visit after it was seen: updated again, and kept once seen again', [
      {rows: [council]}, {rows: [{...council, state: 'updated', last_new_fact_at: '2026-10-07T16:20:00.000Z'}]},
      {rows: [{...council, state: 'seen', last_new_fact_at: '2026-10-07T16:20:00.000Z', seen_at: '2026-10-07T16:21:00.000Z'}]},
    ], [council], ['updated']],
    ['a fact after it was opened: updated again', [{rows: [fire]}, {open: 1}, {rows: [{...fire, last_new_fact_at: '2026-10-07T16:30:00.000Z', seen_at: NOW}]}], [fire], ['updated']],
    ['a new story with a newer fact stays new', [{rows: [flag]}, {rows: [{...flag, last_new_fact_at: '2026-10-07T16:30:00.000Z'}]}], [flag], ['new']],
    ['a story the visit hasn\'t met shows its own dot', [{rows: [fire]}], [flag], ['new']],
    // The first run fills the last 48 hours while the user reads: a fact older than their look moves the
    // story's newest fact on, but the server still has it seen, so nothing is new to them.
    ['seen, then a fact from before the look: keeps its arrival dot, not updated', [
      {rows: [flag]}, {rows: [seen(flag)]}, {rows: [{...seen(flag), last_new_fact_at: '2026-10-07T15:50:00.000Z'}]},
    ], [flag], ['new']],
    ['opened, then a fact from before the look: no dot', [
      {rows: [council]}, {open: 3}, {rows: [{...council, last_new_fact_at: '2026-10-07T15:50:00.000Z', seen_at: NOW}]},
    ], [council], ['seen']],
  ] as [string, Step[], Row[], StoryRowOut['state'][]][])('%s', (_name, steps, rows, expected) => {
    expect(states(run(steps), rows)).toEqual(expected);
  });

  test.each([
    ['updated on arrival: since the last look before the visit', [{rows: [fire]}, {rows: [seen(fire)]}], 1, LAST_LOOK],
    ['seen on arrival, then a fact: since the look that saw it', [{rows: [council]}, {rows: [{...council, state: 'updated', last_new_fact_at: '2026-10-07T16:20:00.000Z'}]}], 3, LAST_LOOK],
    ['new: never looked', [{rows: [flag]}], 2, null],
    ['seen, then a fact from before the look: still never looked', [
      {rows: [flag]}, {rows: [seen(flag)]}, {rows: [{...seen(flag), last_new_fact_at: '2026-10-07T15:50:00.000Z'}]},
    ], 2, null],
  ] as [string, Step[], number, string | null][])('looked at for the pane: %s', (_name, steps, id, expected) => {
    expect(run(steps).get(id)?.looked ?? null).toBe(expected);
  });

  test('an answer that changes nothing keeps the same dots', () => {
    const visit = visitDots(new Map(), [fire, flag]);
    expect(visitDots(visit, [seen(fire), flag])).toBe(visit);
    expect(openedInVisit(visit, 2)).not.toBe(visit);
    expect(openedInVisit(openedInVisit(visit, 2), 2).get(2)?.dot).toBeNull();
  });
});

describe('seen: about a second fully on screen', () => {
  const after = news.seenAfterMs;
  type Step = [at: number, row: string, full: boolean];
  // Each case: what the rows did, then when it's asked; the stories waiting since 0.
  test.each([
    ['on screen a second: seen', [[0, 'local:1', true]], after, [1]],
    ['not quite a second: not yet', [[0, 'local:1', true]], after - 1, []],
    ['flicked past: on screen, gone again', [[0, 'local:1', true], [300, 'local:1', false]], 5000, []],
    ['back again: its second starts over', [[0, 'local:1', true], [300, 'local:1', false], [800, 'local:1', true]], 800 + after - 1, []],
    ['… and is then seen', [[0, 'local:1', true], [300, 'local:1', false], [800, 'local:1', true]], 800 + after, [1]],
    ['two rows, each its own second', [[0, 'local:1', true], [600, 'tech:2', true]], after + 100, [1]],
    ['a story in two blocks, one row still on screen', [[0, 'tech:5', true], [200, 'general:5', true], [400, 'tech:5', false]], 200 + after, [5]],
  ] as [string, Step[], number, number[]][])('%s', (_name, steps, at, expected) => {
    let rows: ReadonlyMap<string, number> = new Map();
    for (const [when, key, full] of steps) rows = sight(rows, key, full, when);
    const visible = storiesOnScreen(rows);
    const waits = waitingSince(new Map(), [1, 2, 5], 0);
    expect(dueSeen(visible, waits, at)).toEqual(expected);
  });

  test('a story turning updated while on screen waits its second from then', () => {
    const visible = storiesOnScreen(sight(new Map(), 'local:4', true, 0));
    const waits = waitingSince(waitingSince(new Map(), [], 0), [4], 5000);
    expect([dueSeen(visible, waits, 5000 + after - 1), dueSeen(visible, waits, 5000 + after)]).toEqual([[], [4]]);
    expect(nextSeen(visible, waits)).toBe(5000 + after);
  });

  test('waiting keeps each story\'s start, and drops those no longer waiting', () => {
    const first = waitingSince(new Map(), [1, 2], 100);
    expect([...waitingSince(first, [2, 3], 900)]).toEqual([[2, 100], [3, 900]]);
  });

  test('nothing on screen: no next', () => {
    expect(nextSeen(new Map(), waitingSince(new Map(), [1], 0))).toBeNull();
  });
});

describe('the cursor', () => {
  const keys = [storyKey('local', 1), storyKey('local', 2), storyKey('tech', 3)];
  test.each([
    ['J from none: the first', null, 1, 'local:1'],
    ['K from none: the first', null, -1, 'local:1'],
    ['J: the next', 'local:1', 1, 'local:2'],
    ['J at the end stays', 'tech:3', 1, 'tech:3'],
    ['K at the start stays', 'local:1', -1, 'local:1'],
    ['gone from the list: the first', 'ai:9', 1, 'local:1'],
  ] as const)('%s', (_name, current, delta, expected) => {
    expect(moveStory(keys, current, delta)).toBe(expected);
  });
  test('with a story open: the next and previous, none past the ends', () => {
    expect([neighbourStory(keys, 'local:2', 1), neighbourStory(keys, 'local:2', -1), neighbourStory(keys, 'tech:3', 1), neighbourStory(keys, null, 1)])
      .toEqual(['tech:3', 'local:1', null, null]);
  });
});

// ---- N5 ----

const since = (time: string) => `2026-10-07T${time}:00.000Z`;
const down = (cause: 'unreachable' | 'rate_limited' | 'refused' | 'no_key', retrying = cause === 'unreachable' || cause === 'rate_limited') =>
  ({provider: 'anthropic' as const, cause, since: since('15:52'), reason: 'Anthropic didn\'t answer in time.', retrying});

describe('the Unsorted line (29a): only while sorting is down and articles wait', () => {
  test.each([
    ['unreachable, retrying (the board)', 12, down('unreachable'), {text: '12 articles not sorted yet, Anthropic unreachable since 8:52 AM, retrying', settings: false}],
    ['rate limited', 3, down('rate_limited'), {text: '3 articles not sorted yet, Anthropic rate limited since 8:52 AM, retrying', settings: false}],
    ['the key refused: Settings › AI, no retry', 1, down('refused'), {text: '1 article not sorted yet, Anthropic refused its key in Settings › AI', settings: true}],
    ['no key', 1204, down('no_key'), {text: '1,204 articles not sorted yet, News needs an Anthropic key in Settings › AI', settings: true}],
    ['down since yesterday: its date and time', 2, {...down('unreachable'), since: '2026-10-06T23:10:00.000Z'}, {text: '2 articles not sorted yet, Anthropic unreachable since 4:10 PM, retrying', settings: false}],
    ['down two days: the date', 2, {...down('unreachable'), since: '2026-10-05T16:10:00.000Z'}, {text: '2 articles not sorted yet, Anthropic unreachable since Oct 5, 9:10 AM, retrying', settings: false}],
    ['down with nothing waiting: no line', 0, down('unreachable'), null],
    ['articles waiting while sorting is up: no line', 12, null, null],
  ] as const)('%s', (_name, unsorted, state, expected) => {
    expect(unsortedLine({unsorted, down: state}, now, zone)).toEqual(expected);
  });
});

describe('the first run\'s line (29b), a section\'s line, and a section with nothing to show', () => {
  test('the first run says how far it is', () => {
    expect(firstRunLine({first_run: {sorted: 186, total: 312}})).toBe('Sorting the last 48 hours · 186 of 312 articles · showing what’s sorted so far');
    expect(firstRunLine({first_run: {sorted: 0, total: 1}})).toBe('Sorting the last 48 hours · 0 of 1 article · showing what’s sorted so far');
    expect(firstRunLine({first_run: null})).toBeNull();
  });

  test.each([
    ['stale (the board)', 'ai', {state: 'stale', as_of: since('14:02')}, {state: 'stale', text: 'AI, as of 7:02 AM'}],
    ['failing', 'local', {state: 'failing', as_of: '2026-10-07T04:14:00.000Z'}, {state: 'failing', text: 'Local, as of 9:14 PM'}],
    ['never worked', 'tech', {state: 'failing', as_of: null}, {state: 'failing', text: 'Tech, not checked yet'}],
    ['healthy: no line', 'general', null, null],
  ] as const)('a section\'s line: %s', (_name, section, health, expected) => {
    expect(sectionLine(section, health, now, zone)).toEqual(expected);
  });

  // The rule (DESIGN.md › The list, States): a story stays 48 hours after its last new fact, so a
  // section with none has had nothing new for 48 hours; the first run is still sorting it. In All, a
  // block can be empty while its section isn't: its stories show in other blocks, as their main
  // section's (#96), and "2 more in Tech" opens them, so nothing new isn't true (the polish audit's
  // extra-08).
  test.each([
    ['stories, seen or not: they show', 'tech', 3, 0, false, null],
    ['none (the board): nothing new for 48 hours, since Mon', 'tech', 0, 0, false, 'Nothing new in Tech since Mon'],
    ['none in All\'s block, its 2 shown in other blocks: no line over "2 more in Tech"', 'tech', 0, 2, false, null],
    ['none during the first run (29b)', 'ai', 0, 0, true, 'Nothing sorted in AI yet'],
    ['none in All\'s block during the first run, 1 in another block', 'ai', 0, 1, true, null],
    ['stories during the first run: they show', 'local', 5, 0, true, null],
  ] as const)('a section with nothing to show: %s', (_name, section, stories, more, firstRun, expected) => {
    expect(emptySectionLine(section, stories, more, firstRun, now, zone)).toBe(expected);
  });

  test('48 hours back is always two days back, worded as an age', () => {
    const justAfterMidnight = Date.parse('2026-10-07T07:05:00.000Z');
    expect(emptySectionLine('general', 0, 0, false, justAfterMidnight, zone)).toBe('Nothing new in General since Mon');
  });
});

describe('Settings › News (30a)', () => {
  test('its header counts today\'s articles and the stories on the page', () => {
    expect(sourcesHeader({articles_today: 312, stories_on_page: 41})).toBe('312 articles today · 41 stories');
    expect(sourcesHeader({articles_today: 1, stories_on_page: 1})).toBe('1 article today · 1 story');
    expect(sourcesHeader({articles_today: 1312, stories_on_page: 0})).toBe('1,312 articles today · 0 stories');
  });

  test.each([[900, 'Every 15 min'], [300, 'Every 5 min'], [1800, 'Every 30 min'], [3600, 'Every hour'], [7200, 'Every 2 hours']] as const)('%i s: %s', (seconds, line) => {
    expect(everyLine(seconds)).toBe(line);
  });

  const health = (fields: Partial<NonNullable<Parameters<typeof newsSourceState>[0]>>) =>
    ({state: 'healthy' as const, as_of: since('16:10'), reason: null, last_check_at: since('16:10'), failing_since: null, ...fields});
  test.each([
    ['checked (the board)', health({}), {tone: 'muted', text: 'Checked 9:10 AM', warn: false, title: null}],
    ['FOX 11 failing, its code standing for the words (the board)', health({state: 'failing', reason: '404 Not Found', as_of: since('12:47'), failing_since: since('13:02')}),
      {tone: 'caution', text: 'Failing, 404 since 6:02 AM', warn: true, title: '404 Not Found'}],
    ['failing in words', health({state: 'failing', reason: 'The page had no articles.', failing_since: since('13:02')}),
      {tone: 'caution', text: 'Failing since 6:02 AM, The page had no articles.', warn: true, title: 'The page had no articles.'}],
    ['failing, not known since when', health({state: 'failing', reason: '503 Service Unavailable'}), {tone: 'caution', text: 'Failing, 503', warn: true, title: '503 Service Unavailable'}],
    ['checks stopped', health({state: 'stale', as_of: '2026-10-07T04:14:00.000Z'}), {tone: 'muted', text: 'Checks stopped, as of 9:14 PM', warn: false, title: null}],
    ['not read yet (no key, no home)', null, {tone: 'muted', text: 'Not checked yet', warn: false, title: null}],
  ] as const)('a source\'s state: %s', (_name, value, expected) => {
    expect(newsSourceState(value, now, zone)).toEqual(expected);
  });

  test.each([
    ['a TV station: the icon its list names', {icon: 'live_tv', adapter: 'feed'}, 'live_tv'],
    ['the crime wire', {icon: 'local_police', adapter: 'feed'}, 'local_police'],
    ['a feed naming none: a paper', {icon: null, adapter: 'feed'}, 'newspaper'],
    ['a page read directly', {icon: null, adapter: 'page_read'}, 'newspaper'],
    ['NWS: its hazard', {icon: null, adapter: 'nws'}, 'thunderstorm'],
    ['USGS', {icon: null, adapter: 'usgs'}, 'earthquake'],
    ['Cal Fire', {icon: null, adapter: 'cal_fire'}, 'local_fire_department'],
    ['AirNow', {icon: null, adapter: 'airnow'}, 'air'],
    ['Google News: its search', {icon: null, adapter: 'google_news'}, 'travel_explore'],
    ['a named icon wins over the adapter\'s', {icon: 'newspaper', adapter: 'nws'}, 'newspaper'],
  ] as const)('a source\'s tile: %s', (_name, source, tile) => {
    expect(sourceTile(source)).toBe(tile);
  });

  test('the nav\'s warning: a feed failing, not one stale', () => {
    const sections = (state: 'healthy' | 'stale' | 'failing') => ({sections: [{section: 'local' as const, sources: [{health: health({state})}, {health: null}]}]}) as never;
    expect([feedFailing(sections('failing')), feedFailing(sections('stale')), feedFailing(sections('healthy')), feedFailing(undefined)]).toEqual([true, false, false, false]);
  });
});

describe('Settings › AI\'s News group (30b)', () => {
  test('dollars, the meter and its choices', () => {
    expect([dollars(40), dollars(18.4), dollars(18.4, true), dollars(0, true)]).toEqual(['$40', '$18.40', '$18.40', '$0.00']);
    expect(capMeter({this_month_usd: 18.4, monthly_cap_usd: 40}).text).toBe('$18.40 of $40');
    expect(capMeter({this_month_usd: 18.4, monthly_cap_usd: 40}).fill).toBeCloseTo(0.46);
    expect(capMeter({this_month_usd: 52, monthly_cap_usd: 40})).toEqual({text: '$52.00 of $40', fill: 1});
    expect(capMeter({this_month_usd: 0, monthly_cap_usd: 0}).fill).toBe(1);
    expect(CAP_CHOICES).toContain(40);
  });

  test('at the cap it says so, until the 1st of next month; below it, nothing', () => {
    const label = (model: string) => (model === 'claude-haiku-5-5' ? 'Claude Haiku 5.5' : model);
    expect(cappedLine({capped: true, summaries_model: 'claude-haiku-5-5'}, '2026-10-01T07:00:00.000Z', zone, label)).toBe('Cap reached, summaries use Claude Haiku 5.5 until Nov 1');
    expect(cappedLine({capped: true, summaries_model: 'claude-haiku-5-5'}, '2026-12-01T08:00:00.000Z', zone, label)).toBe('Cap reached, summaries use Claude Haiku 5.5 until Jan 1');
    expect(cappedLine({capped: false, summaries_model: 'claude-sonnet-5-5'}, '2026-10-01T07:00:00.000Z', zone, label)).toBeNull();
  });

  test('News\'s usage in its parts (the board)', () => {
    const part = (cost_usd: number) => ({calls: 7, input_tokens: 1, output_tokens: 1, cost_usd});
    expect(newsUsageParts({...part(18.4), articles: part(1.9), grouping: part(1.2), stories: part(13.1), ranking: part(2.2)}))
      .toBe('Articles $1.90 · grouping $1.20 · stories $13.10 · ranking $2.20');
  });
});
