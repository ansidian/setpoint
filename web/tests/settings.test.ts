// Settings' words as tables: rules as sentences, attention precision, Google Calendar's sources as
// one row, the order moves and the presets' labels.
import type {HealthOut, RuleMatch, SourceOut} from '@setpoint/shared';
import {DEFAULT_SETTINGS} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  connectFailed, connectNote, dropIndex, expiryLabel, usageLine, laneTag, matchesThisMonth, mergeSources, monthTotal, minutesBefore, moved, placed, precisionText, ruleWords, senderMatch, shifts, sparkPath, sparkTitle, splitRules, taskTime, withPatch,
} from '../src/logic/settings.ts';

const health = (fields: Partial<HealthOut>): HealthOut => ({state: 'healthy', as_of: null, reason: null, last_check_at: null, ...fields});
const source = (id: number, fields: Partial<HealthOut>): SourceOut => ({
  id, provider: 'google_calendar', account_id: id, name: `Google Calendar · ${id}`, has_credentials: false, dev: true,
  sync: {mode: 'push', interval_seconds: 900, push_renews_at: null}, health: health(fields),
});

describe('a settings change shows at once', () => {
  test('a field changes; its section keeps the rest, and other sections stay', () => {
    const after = withPatch(DEFAULT_SETTINGS, {calendar: {weather: false}, reminders: {event_minutes_before: 30}});
    expect(after.calendar).toEqual({weather: false, home: null});
    expect(after.reminders).toEqual({event_minutes_before: 30, task_time: null});
    expect(after.notifications).toBe(DEFAULT_SETTINGS.notifications);
  });
});

describe('Settings', () => {
  test.each<[RuleMatch, string]>([
    [{from_domains: ['university.edu'], subject_includes: ['Registrar']}, 'From **university.edu** with “Registrar” in the subject'],
    [{from_domains: ['woodgrovebank.example']}, 'From **woodgrovebank.example**'],
    [{from_addresses: ['sam@example.com'], from_domains: ['example.org']}, 'From **example.org or sam@example.com**'],
    [{organisation: 'Northwind', type: 'newsletter'}, '**Northwind newsletters**'],
    [{organisation: 'Proseware'}, '**Proseware**'],
    [{type: 'verification_code'}, '**Codes**'],
    [{from_domains: ['fabrikam.com'], type: 'rejection'}, 'From **fabrikam.com** · **Rejections**'],
    [{subject_includes: ['invoice', 'receipt']}, 'With “invoice” or “receipt” in the subject'],
    [{from_name_includes: ['Payroll'], none_includes: ['urgent']}, 'Named “Payroll”, not “urgent”'],
    [{body_regex: 'order #\\d+'}, 'With a body like /order #\\d+/'],
  ])('the rule %j reads %s', (match, text) => expect(ruleWords(match).map(run => (run.bold ? `**${run.text}**` : run.text)).join('')).toBe(text));

  test.each([
    ['attention', null, 'Attention'], ['fyi', 'money', 'FYI · Money'], ['fyi', null, 'FYI'], ['noise', null, 'Noise'],
  ] as const)('%s %s is tagged %s', (lane, kind, tag) => expect(laneTag(lane, kind)).toBe(tag));

  test.each([[0, 'None this month'], [1, '1 this month'], [31, '31 this month']])('%i matches: %s', (count, text) => expect(matchesThisMonth(count)).toBe(text));

  test.each([
    ['woodgrovebank.example', {from_domains: ['woodgrovebank.example']}], [' News.Fabrikam.com ', {from_domains: ['news.fabrikam.com']}],
    ['sam@example.com', {from_addresses: ['sam@example.com']}], ['woodgrove', null], ['', null], ['a b.com', null],
  ])('Add rule\'s From %j matches %j', (text, match) => expect(senderMatch(text)).toEqual(match));

  test.each([
    [undefined, {value: '—', line: 'Nothing in Attention was marked Done in the last 30 days'}],
    [{precision: null, done: 0}, {value: '—', line: 'Nothing in Attention was marked Done in the last 30 days'}],
    [{precision: 0.82, done: 150}, {value: '82%', line: '82% of attention mail was opened before Done · last 30 days'}],
    [{precision: 1, done: 3}, {value: '100%', line: '100% of attention mail was opened before Done · last 30 days'}],
  ])('precision %j', (value, text) => expect(precisionText(value)).toEqual(text));

  // The sparkline (the polish audit's settings-08): 180 × 32, its points 4.5 px inside the box, each day's
  // share on a fixed 50–100% scale (under 50% on the floor), the line broken where nothing was Done.
  const day = (date: string, done: number, opened: number) => ({date, done, opened_before_done: opened});
  const SPARK = {width: 180, height: 32, low: 0.5};
  test.each([
    ['a gap, then 75%, 100% and 0% (on the floor)', [day('2026-10-05', 0, 0), day('2026-10-06', 4, 3), day('2026-10-07', 5, 5), day('2026-10-08', 5, 0)], {
      line: 'M61.5 16 L118.5 4.5 L175.5 27.5',
      area: 'M61.5 27.5 L61.5 16 L118.5 4.5 L175.5 27.5 L175.5 27.5 Z',
      end: {x: 175.5, y: 27.5},
    }],
    ['a day with nothing Done breaks the line; a lone day is a dot, with no area', [day('2026-10-05', 1, 1), day('2026-10-06', 0, 0), day('2026-10-07', 2, 2), day('2026-10-08', 4, 4)], {
      line: 'M4.5 4.5 h0 M118.5 4.5 L175.5 4.5',
      area: 'M118.5 27.5 L118.5 4.5 L175.5 4.5 L175.5 27.5 Z',
      end: {x: 175.5, y: 4.5},
    }],
    ['nothing Done at all: no line, no point', [day('2026-10-05', 0, 0), day('2026-10-06', 0, 0)], {line: '', area: '', end: null}],
  ])('the sparkline: %s', (_name, days, drawn) => {
    expect(sparkPath(days, SPARK)).toMatchObject(drawn);
  });

  test('the sparkline\'s reference at 80%, and each day\'s column from halfway to its neighbours', () => {
    const spark = sparkPath([day('2026-10-05', 1, 1), day('2026-10-06', 1, 1), day('2026-10-07', 1, 1), day('2026-10-08', 1, 1)], SPARK);
    expect(spark.reference).toBe(13.7);
    expect(spark.columns).toEqual([{x: 0, width: 33}, {x: 33, width: 57}, {x: 90, width: 57}, {x: 147, width: 33}]);
  });

  test('the month\'s AI spend, for Usage this month\'s label: Triage, Alfred and News together', () => {
    expect(monthTotal({triage: {cost_usd: 2.1}, alfred: {cost_usd: 0.85}, news: {cost_usd: 18.4}})).toBeCloseTo(21.35);
    expect(monthTotal({triage: {cost_usd: 0}, alfred: {cost_usd: 0}, news: {cost_usd: 0}})).toBe(0);
  });

  test.each([
    [day('2026-10-06', 11, 9), 'Tue, Oct 6 · 9 of 11 opened first'],
    [day('2026-10-06', 0, 0), 'Tue, Oct 6 · nothing Done'],
  ])('a day\'s title %j', (one, title) => expect(sparkTitle(one)).toBe(title));

  test.each([
    [[], null],
    [[{state: 'healthy', last_check_at: '2026-10-07T16:10:00.000Z'}, {state: 'healthy', last_check_at: '2026-10-07T16:05:00.000Z'}], {state: 'healthy', last_check_at: '2026-10-07T16:05:00.000Z'}],
    [[{state: 'healthy', last_check_at: '2026-10-07T16:10:00.000Z'}, {state: 'stale', as_of: '2026-10-07T04:00:00.000Z', last_check_at: '2026-10-07T04:00:00.000Z'}], {state: 'stale', as_of: '2026-10-07T04:00:00.000Z'}],
    [[{state: 'failing', reason: 'nope'}, {state: 'needs_reconnect', reason: 'revoked'}], {state: 'needs_reconnect', reason: 'revoked'}],
  ] as const)('Google Calendar\'s sources %j as one row', (healths, merged) => {
    const result = mergeSources(healths.map((fields, index) => source(index + 1, fields)));
    if (merged === null) expect(result).toBeNull();
    else expect(result!.health).toMatchObject(merged);
  });

  test.each([
    [['a', 'b', 'c'], 0, 1, ['b', 'a', 'c']], [['a', 'b', 'c'], 2, -1, ['a', 'c', 'b']], [['a', 'b', 'c'], 0, -1, ['a', 'b', 'c']], [['a', 'b', 'c'], 2, 1, ['a', 'b', 'c']],
  ] as const)('%j with %i moved %i', (list, index, delta, order) => expect(moved([...list], index, delta)).toEqual(order));

  // A drag's live order: the dragged item at its place among the others.
  test.each<[number[], number, number, number[]]>([
    [[1, 2, 3, 4], 1, 0, [1, 2, 3, 4]], [[1, 2, 3, 4], 1, 2, [2, 3, 1, 4]], [[1, 2, 3, 4], 1, 3, [2, 3, 4, 1]],
    [[1, 2, 3, 4], 4, 0, [4, 1, 2, 3]], [[1, 2, 3, 4], 3, 1, [1, 3, 2, 4]], [[1, 2, 3, 4], 9, 0, [1, 2, 3, 4]],
  ])('%j with %i placed at %i', (ids, id, to, order) => expect(placed(ids.map(one => ({id: one})), id, to).map(one => one.id)).toEqual(order));

  // Rows of 52, 46, 52 and 46: the dragged one moves past the rows it passes, which make room.
  test.each<[number, number, number[]]>([
    [0, 0, [0, 0, 0, 0]], [0, 1, [46, -52, 0, 0]], [0, 3, [144, -52, -52, -52]], [3, 0, [46, 46, 46, -150]], [2, 1, [0, 52, -46, 0]],
  ])('dragged from %i to %i, the rows slide %j', (from, to, slides) => expect(shifts([52, 46, 52, 46], from, to)).toEqual(slides));

  // The other rows' middles at 26, 78 and 130 (52 px rows): above the first, between, past the last.
  test.each([[0, 0], [26, 0], [27, 1], [100, 2], [131, 3]])('the pointer at %i goes to %i', (y, to) => expect(dropIndex([26, 78, 130], y)).toBe(to));

  test('written rules in their order, learned ones newest first', () => {
    const rule = (id: number, origin: 'written' | 'learned', position: number, created: string) => ({
      id, origin, position, created_at: created, match: {from_domains: ['x.com']}, lane: 'fyi' as const, kind: null, enabled: true, imported: false, matches_this_month: 0,
    });
    const {written, learned} = splitRules([rule(1, 'learned', 0, '2026-09-18'), rule(2, 'written', 1, '2026-08-01'), rule(3, 'written', 0, '2026-08-02'), rule(4, 'learned', 0, '2026-10-07')]);
    expect([written.map(one => one.id), learned.map(one => one.id)]).toEqual([[3, 2], [4, 1]]);
  });

  test.each([
    [0, 'At the start'], [5, '5 min before'], [10, '10 min before'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'], [90, '90 min before'],
  ])('a reminder %i minutes before reads %s', (minutes, text) => expect(minutesBefore(minutes)).toBe(text));

  test.each([['09:00', '9:00 AM on the due day'], ['00:30', '12:30 AM on the due day'], ['12:00', '12:00 PM on the due day'], ['17:45', '5:45 PM on the due day']])(
    'a task reminder at %s reads %s', (clock, text) => expect(taskTime(clock)).toBe(text));

  test.each([[5, '5 min'], [15, '15 min'], [60, '1 hour']])('code expiry %i reads %s', (minutes, text) => expect(expiryLabel(minutes)).toBe(text));

  test.each([
    ['accounts', '', null, false], ['accounts', '?connected=6', 'Gmail is connected', false], ['accounts', '?error=access_denied', 'Gmail couldn’t be connected, access denied', true],
    ['accounts', '?error=google_not_configured', 'Google sign-in isn’t set up on this Setpoint', true],
    ['todoist', '?connected=1', 'Todoist is connected', false], ['todoist', '?connected=0', 'Todoist couldn’t be connected, try again', true], ['notifications', '', null, false],
  ])('back at /settings/%s%s: %j, a failure %s', (page, search, note, failed) => {
    expect(connectNote(page, search)).toBe(note);
    expect(connectFailed(page, search)).toBe(failed);
  });
});

describe('usageLine: Settings › AI\'s 30 days, saying what it counts', () => {
  test.each<[string, {calls: number; input_tokens: number; output_tokens: number}, string]>([
    ['nothing yet', {calls: 0, input_tokens: 0, output_tokens: 0}, '0 calls · 0 tokens in · 0 out'],
    ['one call', {calls: 1, input_tokens: 812, output_tokens: 140}, '1 call · 812 tokens in · 140 out'],
    ['thousands and millions', {calls: 1204, input_tokens: 2_350_000, output_tokens: 48_400}, '1,204 calls · 2.4M tokens in · 48k out'],
  ])('%s', (_, usage, expected) => {
    expect(usageLine(usage)).toBe(expected);
  });
});
