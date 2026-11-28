// Settings' words as tables: rules as sentences, Google Calendar's sources as
// one row, the order moves and the presets' labels.
import type {HealthOut, RuleMatch, RuleOut, SourceOut} from '@setpoint/shared';
import {DEFAULT_SETTINGS} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  connectFailed, connectNote, DOMAINS_SHOWN, domainTools, todoistConnected, dropIndex, expiryLabel, usageLine, laneTag, matchesThisMonth, mergeSources, monthTotal, minutesBefore, moved, placed, fixedLines, ruleDestination, ruleFormStart, ruleLine, rulesToAddTo, ruleSender, ruleWords, senderMatch, sendersMatch, wordsMatch,
  shifts, splitRules, stateTip, taskTime, typedDraft, typedStep, waitingChoices, waitingTitle, withPatch, withSender,
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
    [{from_domains: ['ups.com'], subject_includes: ['delivered'], subject_excludes: ['return']}, 'From **ups.com** with “delivered” in the subject, without “return”'],
    [{from_domains: ['ups.com'], subject_excludes: ['return', 'refund']}, 'From **ups.com**, without “return” or “refund” in the subject'],
    [{from_name_includes: ['Payroll'], from_name_excludes: ['Reminders']}, 'Named “Payroll”, without “Reminders”'],
    [{from_domains: ['northwind.example'], from_name_excludes: ['Billing'], body_excludes: ['unsubscribe']}, 'From **northwind.example**, not named “Billing”, not mentioning “unsubscribe”'],
    [{body_includes: ['invoice'], body_excludes: ['draft']}, 'Mentioning “invoice”, without “draft”'],
  ])('the rule %j reads %s', (match, text) => expect(ruleWords(match).map(run => (run.bold ? `**${run.text}**` : run.text)).join('')).toBe(text));

  test.each([
    ['attention', null, 'Attention'], ['fyi', 'money', 'FYI · Money'], ['fyi', null, 'FYI'], ['noise', null, 'Noise'],
  ] as const)('%s %s is tagged %s', (lane, kind, tag) => expect(laneTag(lane, kind)).toBe(tag));

  test.each([[0, 'None this month'], [1, '1 this month']])('%i matches: %s', (count, text) => expect(matchesThisMonth(count)).toBe(text));

  test.each([
    ['woodgrovebank.example', {from_domains: ['woodgrovebank.example']}], [' News.Fabrikam.com ', {from_domains: ['news.fabrikam.com']}],
    ['sam@example.com', {from_addresses: ['sam@example.com']}], ['woodgrove', null], ['', null], ['a b.com', null],
  ])('Add rule\'s From %j matches %j', (text, match) => expect(senderMatch(text)).toEqual(match));

  test('the rule form\'s filters add each one\'s phrases to its key, leaving blank lines and blank filters out', () => {
    expect(wordsMatch({subject: [' delivered ', '', 'Shipped'], subjectNot: ['return'], name: ['', ' '], nameNot: ['Billing', 'Support'], body: undefined, bodyNot: ['unsubscribe']}))
      .toEqual({subject_includes: ['delivered', 'Shipped'], subject_excludes: ['return'], from_name_excludes: ['Billing', 'Support'], body_excludes: ['unsubscribe']});
  });

  // The rule form's sender lines: each a domain or an address, blank ones left out.
  test.each<[string[], RuleMatch | null]>([
    [['northwind.example', ' Sam@Example.com ', '', 'tailspintoys.example'], {from_domains: ['northwind.example', 'tailspintoys.example'], from_addresses: ['sam@example.com']}],
    [['woodgrovebank.example'], {from_domains: ['woodgrovebank.example']}],
    [['', ' '], {}],
    [['northwind.example', 'woodgrove'], null],
  ])('the sender lines %j match %j', (texts, match) => expect(sendersMatch(texts)).toEqual(match));

  // Edit: what the rule form draws of a written rule, and what it keeps fixed.
  test.each<[string, RuleMatch, ReturnType<typeof ruleFormStart>]>([
    ['one sender and one phrase', {from_domains: ['woodgrovebank.example'], subject_includes: ['Statement']}, {from: ['woodgrovebank.example'], words: {subject: ['Statement']}, fixed: {}}],
    ['an address', {from_addresses: ['sam@example.com'], body_excludes: ['unsubscribe']}, {from: ['sam@example.com'], words: {bodyNot: ['unsubscribe']}, fixed: {}}],
    ['no sender', {subject_includes: ['Registrar']}, {from: [''], words: {subject: ['Registrar']}, fixed: {}}],
    ['several senders, domains first', {from_domains: ['northwind.example'], from_addresses: ['sam@example.com']}, {from: ['northwind.example', 'sam@example.com'], words: {}, fixed: {}}],
    ['several phrases in a field, a pattern and words found nowhere', {from_domains: ['northwind.example'], subject_includes: ['Your order', 'Shipment'], body_regex: 'tracking', none_includes: ['refund'], from_name_includes: ['Orders']},
      {from: ['northwind.example'], words: {subject: ['Your order', 'Shipment'], name: ['Orders']}, fixed: {body_regex: 'tracking', none_includes: ['refund']}}],
  ])('the form draws %s', (_, match, start) => expect(ruleFormStart(match)).toEqual(start));

  test('a fixed part is named on its own line', () => {
    const fixed: RuleMatch = {subject_regex: 'order #\\d+', body_regex: 'tracking', none_includes: ['refund', 'return'], organisation: 'Northwind', type: 'newsletter'};
    expect(fixedLines(fixed)).toEqual(['Subject matches /order #\\d+/', 'Body matches /tracking/', '“refund” or “return” nowhere in the email', 'Northwind newsletters']);
    expect(fixedLines({})).toEqual([]);
  });

  // Add to rule: the sender an email gives a rule, the rules it can join, and the rule with it.
  test.each([
    ['no-reply@northwind.example', {text: 'northwind.example', match: {from_domains: ['northwind.example']}}],
    ['Alerts@Mail.Woodgrovebank.example', {text: 'mail.woodgrovebank.example', match: {from_domains: ['mail.woodgrovebank.example']}}],
    // A host many people share names the address, not everyone on it.
    ['sam.lee@gmail.com', {text: 'sam.lee@gmail.com', match: {from_addresses: ['sam.lee@gmail.com']}}],
    ['pat@icloud.com', {text: 'pat@icloud.com', match: {from_addresses: ['pat@icloud.com']}}],
    ['not an address', null],
  ])('an email from %j gives a rule %j', (address, sender) => expect(ruleSender(address)).toEqual(sender));

  const rule = (id: number, match: RuleMatch, fields: Partial<RuleOut> = {}): RuleOut => ({
    id, origin: 'written', match, lane: 'fyi', kind: 'money', position: id, enabled: true, mark_read: false, trash: 'never', imported: false, created_at: '2026-10-01T00:00:00Z', matches_this_month: 0, trashes_waiting: 0, ...fields,
  });
  test('the rules an email\'s sender can join: written ones on, matching on sender, not already matching it, in their order', () => {
    const rules = [
      rule(3, {from_domains: ['news.fabrikam.com']}, {lane: 'noise', kind: null}),
      rule(1, {from_domains: ['university.edu'], subject_includes: ['Registrar']}, {lane: 'attention', kind: null}),
      rule(2, {from_domains: ['woodgrovebank.example']}),
      rule(4, {from_addresses: ['sam@example.com']}, {enabled: false}),
      rule(5, {organisation: 'Northwind', type: 'newsletter'}, {origin: 'learned'}),
      rule(6, {subject_includes: ['invoice']}),
    ];
    expect(rulesToAddTo(rules, ruleSender('no-reply@northwind.example')!).map(one => one.id)).toEqual([1, 2, 3]);
    // Already matched, by the domain or a parent of it, or by the address: not offered.
    expect(rulesToAddTo(rules, ruleSender('alerts@mail.woodgrovebank.example')!).map(one => one.id)).toEqual([1, 3]);
    expect(rulesToAddTo([rule(7, {from_addresses: ['sam.lee@gmail.com']})], ruleSender('sam.lee@gmail.com')!)).toEqual([]);
    expect(rulesToAddTo(undefined, ruleSender('no-reply@northwind.example')!)).toEqual([]);
  });

  test.each<[RuleMatch, string, RuleMatch]>([
    [{from_domains: ['woodgrovebank.example']}, 'no-reply@northwind.example', {from_domains: ['woodgrovebank.example', 'northwind.example']}],
    [{from_domains: ['university.edu'], subject_includes: ['Registrar']}, 'sam@gmail.com', {from_domains: ['university.edu'], subject_includes: ['Registrar'], from_addresses: ['sam@gmail.com']}],
    [{from_addresses: ['pat@icloud.com']}, 'sam@icloud.com', {from_addresses: ['pat@icloud.com', 'sam@icloud.com']}],
  ])('the rule %j with %s\'s sender matches %j', (match, address, next) => expect(withSender(match, ruleSender(address)!)).toEqual(next));

  test.each([
    [rule(2, {from_domains: ['woodgrovebank.example']}), 'From woodgrovebank.example → FYI · Money'],
    [rule(1, {from_domains: ['university.edu'], subject_includes: ['Registrar']}, {lane: 'attention', kind: null}), 'From university.edu with “Registrar” in the subject → Attention'],
    // A written rule's actions go on after the lane.
    [rule(3, {from_domains: ['ups.example']}, {lane: 'noise', kind: null, mark_read: true, trash: 'now'}), 'From ups.example → Noise, mark read, trash now'],
    [rule(4, {from_domains: ['ups.example']}, {lane: 'noise', kind: null, trash: '1d'}), 'From ups.example → Noise, trash after 1 day'],
    [rule(5, {from_domains: ['ups.example']}, {mark_read: true}), 'From ups.example → FYI · Money, mark read'],
  ])('a rule on one line: %#', (one, line) => expect(ruleLine(one)).toBe(line));

  // New rule from the sender starts in the lane and group the email is in now.
  test.each([
    ['attention', null, 'attention'], ['fyi', 'money', 'fyi:money'], ['fyi', null, 'fyi:other'], ['noise', null, 'noise'], [null, null, 'fyi:other'],
  ] as const)('an email in %s %s starts a rule sending to %s', (lane, kind, destination) => expect(ruleDestination(lane, kind)).toBe(destination));

  test('the month\'s AI spend, for Usage this month\'s label: Triage, Search terms, Search reading, Alfred and News together', () => {
    expect(monthTotal({triage: {cost_usd: 2.1}, search_terms: {cost_usd: 0.04}, search_reading: {cost_usd: 0.01}, alfred: {cost_usd: 0.85}, mail_drafts: {cost_usd: 0.05}, news: {cost_usd: 18.4}})).toBeCloseTo(21.45);
    expect(monthTotal({triage: {cost_usd: 0}, search_terms: {cost_usd: 0}, search_reading: {cost_usd: 0}, alfred: {cost_usd: 0}, mail_drafts: {cost_usd: 0}, news: {cost_usd: 0}})).toBe(0);
  });

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

  // Turn off's and Delete's prompt for a rule's waiting trashes.
  test.each([
    [1, '1 email is waiting to be trashed', ['1 email stays', '1 email goes to the trash as planned']],
    [3, '3 emails are waiting to be trashed', ['3 emails stay', '3 emails go to the trash as planned']],
  ])('%i waiting reads %j, Cancel them first: %j', (count, title, lines) => {
    expect(waitingTitle(count)).toBe(title);
    expect(waitingChoices(count).map(choice => [choice.scope, choice.label, choice.line])).toEqual([['cancel', 'Cancel them', lines[0]], ['run', 'Let them run', lines[1]]]);
  });

  test('written rules in their order, learned ones newest first', () => {
    const rule = (id: number, origin: 'written' | 'learned', position: number, created: string) => ({
      id, origin, position, created_at: created, match: {from_domains: ['x.com']}, lane: 'fyi' as const, kind: null, enabled: true, mark_read: false, trash: 'never' as const, imported: false, matches_this_month: 0, trashes_waiting: 0,
    });
    const {written, learned} = splitRules([rule(1, 'learned', 0, '2026-09-18'), rule(2, 'written', 1, '2026-08-01'), rule(3, 'written', 0, '2026-08-02'), rule(4, 'learned', 0, '2026-10-07')]);
    expect([written.map(one => one.id), learned.map(one => one.id)]).toEqual([[3, 2], [4, 1]]);
  });

  test.each([
    [0, 'At the start'], [60, '1 hour before'], [120, '2 hours before'], [1440, '1 day before'], [90, '90 min before'],
  ])('a reminder %i minutes before reads %s', (minutes, text) => expect(minutesBefore(minutes)).toBe(text));

  test.each([['09:00', '9:00 AM on the due day'], ['00:30', '12:30 AM on the due day'], ['12:00', '12:00 PM on the due day'], ['17:45', '5:45 PM on the due day']])(
    'a task reminder at %s reads %s', (clock, text) => expect(taskTime(clock)).toBe(text));

  test.each([[5, '5 min'], [60, '1 hour']])('code expiry %i reads %s', (minutes, text) => expect(expiryLabel(minutes)).toBe(text));

  test.each([
    ['accounts', '', null, false], ['accounts', '?connected=6', 'Gmail is connected', false], ['accounts', '?error=access_denied', 'Gmail couldn’t be connected, access denied', true],
    ['accounts', '?error=google_not_configured', 'Google sign-in isn’t set up on this Setpoint', true],
    ['accounts', '?todoist=1', 'Todoist is connected', false], ['accounts', '?todoist=0', 'Todoist couldn’t be connected, try again', true], ['notifications', '', null, false],
  ])('back at /settings/%s%s: %j, a failure %s', (_page, search, note, failed) => {
    expect(connectNote(search)).toBe(note);
    expect(connectFailed(search)).toBe(failed);
  });

  const todoist = (fields: Partial<SourceOut>) => ({provider: 'todoist', has_credentials: false, dev: false, ...fields}) as SourceOut;
  test.each([
    ['no Todoist source', [], false], ['a source with no token', [todoist({})], false], ['a token', [todoist({has_credentials: true})], true],
    ['the dev run\'s source', [todoist({dev: true})], true], ['only another provider', [{...todoist({has_credentials: true}), provider: 'weather'} as SourceOut], false],
  ])('Todoist with %s: connected %s', (_case, sources, connected) => expect(todoistConnected(sources as SourceOut[])).toBe(connected));
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

describe('a source\'s state names itself in its tip, the provider\'s words in brackets, its code after', () => {
  test.each([
    ['Checked 9:10 AM', null, 'Checked 9:10 AM'],
    ['Needs sign-in', 'Token has been expired or revoked. (invalid_grant)', 'Needs sign-in (token has been expired or revoked) · invalid_grant'],
    ['Refusing Setpoint since 6:02 AM', '404 Not Found', 'Refusing Setpoint since 6:02 AM · 404 Not Found'],
    ['Down (scheduled maintenance)', 'Scheduled maintenance (503 Service Unavailable)', 'Down (scheduled maintenance) · 503 Service Unavailable'],
    ['Gmail didn\'t answer in time', 'Gmail didn\'t answer in time.', 'Gmail didn\'t answer in time'],
  ])('%s with %s', (words, reason, tip) => expect(stateTip(words, reason)).toBe(tip));
});

describe('Trusted domains\' count and Filter show once there are more than Show all\'s 11', () => {
  test.each([
    [0, '', false], [3, '', false], [DOMAINS_SHOWN, '', false], [DOMAINS_SHOWN + 1, '', true], [78, '', true],
    // A filter still applied keeps its field, so it can be cleared after removals take the list to 11.
    [DOMAINS_SHOWN, 'wood', true], [0, ' x ', true], [5, '  ', false],
  ])('%i domains, filter "%s": %s', (count, filter, shown) => {
    expect(domainTools(count, filter)).toBe(shown);
  });
});

// Overdue for's field: 1 to 30 days.
describe('a stepper\'s field takes the limit as it\'s typed', () => {
  test.each([
    ['a number in range stays', '5', '3', '5'],
    ['past the most is the most', '50', '5', '30'],
    ['under the least is the least', '0', '3', '1'],
    ['a negative is the least', '-2', '-', '1'],
    ['a leading zero goes', '05', '0', '5'],
    ['empty stays, to type on from', '', '3', ''],
    ['a lone minus stays', '-', '', '-'],
    ['a letter isn\'t taken', '3x', '3', '3'],
    ['a decimal point isn\'t taken', '2.', '2', '2'],
  ])('%s', (_name, text, before, expected) => {
    expect(typedDraft(text, before, 1, 30)).toBe(expected);
  });
});

describe('a stepper\'s typed text sets a whole number in range, or keeps the value', () => {
  test.each([
    ['a number', '7', 7],
    ['past the most', '50', 30],
    ['under the least', '-2', 1],
    ['a decimal, rounded', '2.6', 3],
    ['empty keeps it', '', 3],
    ['a lone minus keeps it', '-', 3],
    ['words keep it', 'abc', 3],
  ])('%s', (_name, text, expected) => {
    expect(typedStep(text, 3, 1, 30)).toBe(expected);
  });
});
