// Search, the Answer card and the proposal card's rules (DESIGN.md › Search, Alfred's Answer card,
// Proposal) as tables: highlighted runs, reasons, the results line, what Alfred is asked, what the
// reader highlights, and how a proposal's time reads; SV-23's calendar results: Upcoming then Past,
// the row's day, and its line with a series' rule.
import type {AnswerOut, ItemOut, MatchReasonOut, ProposalItemOut, SearchChip, SearchResultOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  FOLD_OPENS_UNDER, firstSection, foldFor, foldStartsOpen, mentionsLine, resultSections, toggledFold, alfredQuestion, alfredStepDone, alfredStepLine, typedAfter, withStep, calendarResultGroups, calendarResultLine, failedLine, finishedWords, resultDay, indexingLine, phraseRuns, namesProject, projectChoice, projectMatches, projectMenu, rankMatches, proposalAt, proposalDay, proposalWhen, queryParts, readerMarks, reasonParts, resultSender, resultsLine, searchedLine, segments, showsQuestion, shownCalendarReasons, shownReasons, shownSources,
} from '../src/logic/search.ts';
import type {ProposalWhen, Run} from '../src/logic/search.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;
const marked = (text: string, runs: Run[]) => segments(text, runs).map(part => (part.mark ? `[${part.text}]` : part.text)).join('');

describe('segments', () => {
  test.each<[string, string, Run[], string]>([
    ['no runs: the text as it is', 'Lease renewal terms', [], 'Lease renewal terms'],
    ['one run', 'Northwind Talent', [{start: 0, end: 9}], '[Northwind] Talent'],
    ['runs a space apart become one mark, as the boards draw them', 'Lease renewal terms', [{start: 0, end: 5}, {start: 6, end: 13}], '[Lease renewal] terms'],
    ['runs apart by a word stay apart', 'lease the renewal', [{start: 0, end: 5}, {start: 10, end: 17}], '[lease] the [renewal]'],
    ['overlapping and out of order', 'abcdefgh', [{start: 4, end: 7}, {start: 1, end: 5}], 'a[bcdefg]h'],
    ['empty runs are left out', 'abc', [{start: 1, end: 1}], 'abc'],
    ['an empty text', '', [], ''],
  ])('%s', (_name, text, runs, expected) => {
    expect(marked(text, runs)).toBe(expected);
  });
});

describe('phraseRuns: where a phrase starts a word, ignoring case', () => {
  test.each<[string, string, string[], string]>([
    ['every place', 'Thank you for applying to Northwind, and to northwind again.', ['Northwind'], 'Thank you for applying to [Northwind], and to [northwind] again.'],
    ['not inside a word', 'Northwinds and Southnorthwind', ['northwind'], '[Northwind]s and Southnorthwind'],
    ['money and dates with their punctuation', 'New monthly rent: $2,140 (currently $2,060)', ['$2,140'], 'New monthly rent: [$2,140] (currently $2,060)'],
    ['a phrase', 'Sign by: Oct 31, 2026', ['Oct 31, 2026'], 'Sign by: [Oct 31, 2026]'],
    ['regex characters are plain', 'a (b) c', ['(b)'], 'a [(b)] c'],
    ['blank phrases are skipped', 'abc', ['', ' '], 'abc'],
  ])('%s', (_name, text, phrases, expected) => {
    expect(marked(text, phraseRuns(text, phrases))).toBe(expected);
  });
});

const result = (fields: Partial<SearchResultOut>): SearchResultOut => ({
  id: 1, account_id: 1, subject: 'Update on your application', organisation: 'Northwind Talent', from_name: 'Northwind Recruiting', reasons: [], excerpt: '', highlights: [],
  ...fields,
} as SearchResultOut);

describe('resultSender: the organisation, else the name, with that field\'s highlights', () => {
  test('the organisation', () => {
    const row = result({highlights: [{field: 'from_name', start: 0, end: 9}, {field: 'organisation', start: 0, end: 9}]});
    expect(segments('Northwind Talent', [{start: 0, end: 9}])).toEqual(resultSender(row));
  });
  test('no organisation: the name', () => {
    expect(resultSender(result({organisation: null, from_name: 'Sam Lee', highlights: [{field: 'from_name', start: 4, end: 7}]}))).toEqual([{text: 'Sam ', mark: false}, {text: 'Lee', mark: true}]);
  });
});

// search-11: a reason shows only when the row doesn't already show it.
describe('shownReasons: what a result\'s why line keeps', () => {
  const org: MatchReasonOut = {field: 'organisation', label: 'Org Northwind', matched: ['Northwind']};
  const type: MatchReasonOut = {field: 'type', label: 'Type Rejection', matched: []};
  const date: MatchReasonOut = {field: 'date', label: 'Date Mar 14', matched: []};
  const sender: MatchReasonOut = {field: 'sender', label: 'Sender north', matched: ['north']};
  const subject: MatchReasonOut = {field: 'subject', label: 'Subject lease renewal', matched: ['lease', 'renewal']};
  const body: MatchReasonOut = {field: 'body', label: 'Body signed', matched: ['signed']};
  const account: MatchReasonOut = {field: 'account', label: 'Account Jobs', matched: []};
  test.each<[string, Partial<SearchResultOut>, string[]]>([
    ['chips: the highlighted organisation and the row\'s own day go, the type stays', {reasons: [org, type, date], highlights: [{field: 'organisation', start: 0, end: 9}]}, ['Type Rejection']],
    ['an organisation chip with nothing highlighted stays', {reasons: [org, type], highlights: []}, ['Org Northwind', 'Type Rejection']],
    ['free text in the highlighted sender goes', {reasons: [sender], highlights: [{field: 'organisation', start: 0, end: 5}]}, []],
    ['the sender is the name when there\'s no organisation', {organisation: null, reasons: [sender], highlights: [{field: 'organisation', start: 0, end: 5}]}, ['Sender north']],
    ['a highlighted subject and excerpt: both go', {reasons: [subject, body], highlights: [{field: 'subject', start: 0, end: 5}, {field: 'excerpt', start: 3, end: 9}]}, []],
    ['a body match the excerpt doesn\'t show stays', {reasons: [subject, body], highlights: [{field: 'subject', start: 0, end: 5}]}, ['Body signed']],
    ['an account chip stays', {reasons: [account], highlights: []}, ['Account Jobs']],
  ])('%s', (_name, fields, expected) => {
    expect(shownReasons(result(fields)).map(reason => reason.label)).toEqual(expected);
  });

  test.each<[string, {field: string; key: string; value: string}[], number, string[]]>([
    ['a highlighted title and the row\'s own day go; its calendar stays', [{field: 'title', key: 'Title', value: 'Dentist'}, {field: 'calendar', key: 'Calendar', value: 'Classes'}, {field: 'date', key: 'Date', value: 'Oct 8'}], 1, ['Calendar']],
    ['a place, which its line doesn\'t highlight, stays', [{field: 'place', key: 'Place', value: 'Blue Door'}], 0, ['Place']],
    ['a title match nothing highlights stays', [{field: 'title', key: 'Title', value: 'Dinner'}], 0, ['Title']],
  ])('calendar: %s', (_name, reasons, highlights, expected) => {
    const shown = shownCalendarReasons({reasons: reasons.map(reason => ({...reason, runs: []})), highlights: Array.from({length: highlights}, () => ({start: 0, end: 3}))} as never);
    expect(shown.map(reason => reason.key)).toEqual(expected);
  });
});

describe('reasonParts: the kind, then what matched (DESIGN.md override 12)', () => {
  test.each([
    ['Org Northwind', {key: 'Org', value: 'Northwind'}],
    ['Date Mar 14', {key: 'Date', value: 'Mar 14'}],
    ['Subject lease renewal', {key: 'Subject', value: 'lease renewal'}],
    ['Pinned', {key: 'Pinned', value: ''}],
  ])('%s', (label, parts) => {
    expect(reasonParts(label)).toEqual(parts);
  });
});

describe('the results line and the indexing line', () => {
  test.each<[number, 'newest' | 'match', string[]]>([
    [2, 'newest', ['2 results', 'newest first']],
    [1, 'newest', ['1 result', 'newest first']],
    [4, 'match', ['4 results']],
  ])('%i, %s', (total, order, parts) => {
    expect(resultsLine({total, order})).toEqual(parts);
  });
  test('no email has every word: says so, and how many have some (UX #10)', () => {
    expect(resultsLine({total: 1, order: 'match', partial: true})).toEqual(['No email has every word', '1 has some of them']);
    expect(resultsLine({total: 3, order: 'newest', partial: true})).toEqual(['No email has every word', '3 have some of them', 'newest first']);
  });
  test('the results above the fold, with none about the search being a plain list', () => {
    expect(firstSection({total: 18, first_section: 6})).toBe(6);
    expect(firstSection({total: 18, first_section: 18})).toBe(18);
    expect(firstSection({total: 18, first_section: 0})).toBe(18);
  });
  test('indexing', () => {
    expect(indexingLine({progress: 0.62})).toBe('Indexing · 62% · showing what’s indexed so far');
    expect(indexingLine(null)).toBeNull();
  });
});

describe('the results by section, and the fold', () => {
  const rows = [1, 2, 3, 4, 5].map(id => ({id}));
  const none = new Set<number>();

  test.each<[string, number, number, boolean, ReadonlySet<number>, number[], number, number[]]>([
    ['folded, the rows under it held back', 5, 2, false, none, [1, 2], 3, []],
    ['opened, they follow in the server\'s order', 5, 2, true, none, [1, 2], 3, [3, 4, 5]],
    ['opened with a page still to come, it counts them', 12, 2, true, none, [1, 2], 10, [3, 4, 5]],
    ['more above it than have come: no fold yet', 12, 8, true, none, [1, 2, 3, 4, 5], 0, []],
    ['nothing under it', 5, 5, false, none, [1, 2, 3, 4, 5], 0, []],
    ['nothing about the search: a plain list, no fold', 5, 0, false, none, [1, 2, 3, 4, 5], 0, []],
    ['Trash takes a row above it without moving a row up', 5, 2, false, new Set([1]), [2], 3, []],
    ['Trash takes one under it from the count', 5, 2, true, new Set([4]), [1, 2], 2, [3, 5]],
  ])('%s', (_, total, first_section, open, gone, about, more, mentions) => {
    const sections = resultSections(rows, {total, first_section}, open, gone);
    expect(sections.about.map(row => row.id)).toEqual(about);
    expect(sections.more).toBe(more);
    expect(sections.mentions.map(row => row.id)).toEqual(mentions);
  });

  test('no answer yet shows what\'s there', () => {
    expect(resultSections(rows, null, false, none)).toEqual({about: rows, more: 0, mentions: []});
  });

  test.each<[number, boolean]>([
    [0, false], [1, true], [FOLD_OPENS_UNDER - 1, true], [4, true], [FOLD_OPENS_UNDER, false], [5, false], [60, false],
  ])('a first section of %i: starts open, %s', (first_section, open) => {
    expect(foldStartsOpen({first_section})).toBe(open);
    expect(foldFor(null, {chips: [], text: 'water bill', first_section})?.open).toBe(open);
  });

  describe('a search\'s fold', () => {
    const answer = (text: string, first_section: number, chips: SearchChip[] = []) => ({text, first_section, chips});
    const thin = foldFor(null, answer('sgv', 1))!;

    test('the same search keeps its own, whatever a later answer says', () => {
      expect(foldFor(thin, answer('sgv', 9))).toBe(thin);
      const closed = toggledFold(thin);
      expect(foldFor(closed, answer('SGV', 1))).toBe(closed);
    });

    test('a new search decides again, across the threshold either way', () => {
      expect(foldFor(thin, answer('sgv invoice', 9))).toMatchObject({open: false, closed: false});
      expect(foldFor(foldFor(null, answer('sgv', 9)), answer('sgv invoice', 4))).toMatchObject({open: true, closed: false});
    });

    test('a close holds while the same words are refined, and goes with them', () => {
      const closed = toggledFold(thin);
      expect(closed).toMatchObject({open: false, closed: true});
      const longer = foldFor(closed, answer('sgv invoice', 2))!;
      expect(longer).toMatchObject({open: false, closed: true, text: 'sgv invoice'});
      expect(foldFor(longer, answer('sgv inv', 3))).toMatchObject({open: false, closed: true});
      expect(foldFor(longer, answer('water', 2))).toMatchObject({open: true, closed: false});
      expect(foldFor(longer, answer('sgv invoice', 2, [{kind: 'type', value: 'statement', label: 'Statement'}]))).toMatchObject({open: true, closed: false});
    });

    test('opening it again by hand takes the close back, and opening one by hand is for that search', () => {
      const reopened = toggledFold(toggledFold(thin));
      expect(reopened).toMatchObject({open: true, closed: false});
      expect(foldFor(reopened, answer('sgv invoice', 9))).toMatchObject({open: false});
      const opened = toggledFold(foldFor(null, answer('renewal', 9))!);
      expect(opened).toMatchObject({open: true, closed: false});
      expect(foldFor(opened, answer('renewals', 9))).toMatchObject({open: false});
    });

    test('no search, no fold', () => {
      expect(foldFor(thin, null)).toBeNull();
    });
  });

  test.each<[number, boolean, string]>([
    [12, false, '12 more mention these words'],
    [1, false, '1 more mentions these words'],
    [12, true, '12 more mention some of these words'],
  ])('%i, partial %s', (more, partial, line) => {
    expect(mentionsLine(more, partial)).toBe(line);
  });
});

const chips: SearchChip[] = [
  {kind: 'organisation', value: 'Northwind', label: 'Northwind'},
  {kind: 'type', value: 'rejection', label: 'Rejection'},
  {kind: 'date', from: '2026-03-01', to: '2026-04-01', label: 'Mar 2026'},
];

describe('what the field asks', () => {
  test.each<[string, SearchChip[], string, string[], string]>([
    ['chips: their labels, which read back as the same chips', chips, '', ['Northwind', 'Rejection', 'Mar 2026'], 'Northwind Rejection Mar 2026'],
    ['a question alone', [], 'When does my lease renewal need to be signed? ', ['When does my lease renewal need to be signed?'], 'When does my lease renewal need to be signed?'],
    ['chips, then words', chips.slice(0, 1), 'interview', ['Northwind', 'interview'], 'Northwind interview'],
    ['a Not chip after "!", as typed (SV-31)', [chips[0]!, {...chips[1]!, not: true}], 'invoice !proseware', ['Northwind', '!Rejection', 'invoice !proseware'], 'Northwind !Rejection invoice !proseware'],
  ])('%s', (_name, given, text, parts, question) => {
    expect(queryParts(given, text)).toEqual(parts);
    expect(alfredQuestion(given, text)).toBe(question);
  });

  test('a question asks its words in the order typed, though a chip formed mid-sentence', () => {
    expect(alfredQuestion(chips.slice(0, 1), 'when is my interview with ?', 'when is my interview with Northwind?')).toBe('when is my interview with Northwind?');
  });

  test('without the words as typed (an edit lost their order), chips come first as before', () => {
    expect(alfredQuestion(chips.slice(0, 1), 'interview', null)).toBe('Northwind interview');
  });
});

describe('typedAfter: the field\'s words as typed, while it holds chips', () => {
  test.each<[string, string | null, string, string, string | null]>([
    // name, typed so far, the field's text before, after, typed now
    ['typing on at the end adds the new letters', 'when is my interview with Northwind ', 'when is my interview with ', 'when is my interview with ?', 'when is my interview with Northwind ?'],
    ['an edit before the end loses the order', 'Northwind interview', 'interview', 'intrview', null],
    ['once lost, it stays lost', null, 'interview', 'interview ', null],
  ])('%s', (_name, typed, before, after, now) => {
    expect(typedAfter(typed, before, after)).toBe(now);
  });
});

const turn = (fields: Partial<AnswerOut>): AnswerOut => ({
  conversation_id: 1, turn_id: 1, question: 'q', answer: null, emphasis: [], sources: [], searched: [], proposals: [], ...fields,
});
const source = (id: number) => ({message_id: id, account_id: 1, subject: 's', organisation: null, from_name: 'f', received_at: SEED_NOW, pinned: false});

describe('readerMarks: what the open email highlights', () => {
  const lease = turn({answer: 'By Oct 31, 2026, per Parkside\'s Sep 30 email.', emphasis: [{start: 3, end: 15}], sources: [source(27)]});
  const rent = turn({turn_id: 2, answer: '$2,140 a month, up from $2,060.', emphasis: [{start: 0, end: 6}], sources: [source(27)]});
  const results = [result({id: 27, reasons: [{field: 'subject', label: 'Subject lease renewal', matched: ['lease', 'renewal']}, {field: 'body', label: 'Body signed', matched: ['signed']}]})];
  test.each<[string, number | null, AnswerOut[], string[]]>([
    ['the answers it\'s a source of: their bold phrases (board 07)', 27, [lease, rent], ['Oct 31, 2026', '$2,140']],
    ['else the words the search matched in it (board 06)', 27, [], ['lease', 'renewal', 'signed']],
    ['an answer about another email doesn\'t count', 27, [turn({answer: 'x', emphasis: [{start: 0, end: 1}], sources: [source(9)]})], ['lease', 'renewal', 'signed']],
    ['an email that isn\'t a result', 5, [], []],
    ['nothing open', null, [lease], []],
  ])('%s', (_name, open, turns, marks) => {
    expect(readerMarks(open, results, turns)).toEqual(marks);
  });
});

describe('the Answer card\'s lines', () => {
  test('a turn shows its question when it\'s a follow-up, or the card is about an email', () => {
    expect([showsQuestion(0, false), showsQuestion(1, false), showsQuestion(0, true)]).toEqual([false, true, true]);
  });
  test.each<[string[], string | null]>([
    [[], null],
    [['lease renewal'], 'Searched “lease renewal”'],
    [['Northwind · Rejection · Mar 2026', 'northwind'], 'Searched “Northwind · Rejection · Mar 2026” and “northwind”'],
    [['a', 'b', 'c'], 'Searched “a”, “b” and “c”'],
  ])('what it searched: %j', (searched, line) => {
    expect(searchedLine(searched)).toBe(line);
  });
});

const exam: ProposalItemOut = {
  kind: 'event', calendar_id: 2, title: 'CS 101 final exam', all_day: false, starts_at: '2026-12-10T03:00:00.000Z', ends_at: '2026-12-10T05:00:00.000Z',
  start_date: null, end_date: null, due_date: null, due_at: null, time_zone: 'America/Los_Angeles', place: 'Contoso University · Room 214', project: null,
};

describe('proposalWhen: the card\'s day and times as its fields hold them (board 08)', () => {
  test.each<[string, ProposalItemOut, ProposalWhen]>([
    ['a timed event', exam, {date: '2026-12-09', start: 19 * 60, end: 21 * 60}],
    ['all day', {...exam, all_day: true, starts_at: null, ends_at: null, start_date: '2026-10-31', end_date: '2026-11-01'}, {date: '2026-10-31', start: null, end: null}],
    ['a task on its day, with its time', {...exam, kind: 'task', starts_at: null, ends_at: null, due_date: '2026-12-09', due_at: '2026-12-10T03:00:00.000Z'}, {date: '2026-12-09', start: 19 * 60, end: null}],
    ['no date: blank, to pick (SV-24)', {...exam, starts_at: null, ends_at: null}, {date: null, start: null, end: null}],
  ])('%s', (_name, item, when) => {
    expect(proposalWhen(item, zone)).toEqual(when);
  });
  test.each([
    ['this year', '2026-12-09', 'Wed, Dec 9'],
    ['another year shows it', '2027-01-12', 'Tue, Jan 12, 2027'],
  ])('its day, %s', (_name, date, shown) => expect(proposalDay(date, now, zone)).toBe(shown));
});

describe('proposalAt: the item at the day and times left in the card (SV-24)', () => {
  test.each<[string, ProposalItemOut, ProposalWhen & {date: string}, Partial<ProposalItemOut>]>([
    ['a timed event moved', exam, {date: '2026-12-11', start: 9 * 60, end: 10 * 60 + 30}, {all_day: false, starts_at: '2026-12-11T17:00:00.000Z', ends_at: '2026-12-11T18:30:00.000Z', start_date: null, end_date: null}],
    ['a dateless event given a day: all day', {...exam, starts_at: null, ends_at: null}, {date: '2026-10-20', start: null, end: null}, {all_day: true, starts_at: null, ends_at: null, start_date: '2026-10-20', end_date: '2026-10-21'}],
    ['a three-day all-day event keeps its length', {...exam, all_day: true, starts_at: null, ends_at: null, start_date: '2026-10-30', end_date: '2026-11-02'}, {date: '2026-11-06', start: null, end: null}, {start_date: '2026-11-06', end_date: '2026-11-09'}],
    ['a task given a time', {...exam, kind: 'task', starts_at: null, ends_at: null, due_date: null}, {date: '2026-10-20', start: 8 * 60, end: null}, {due_date: '2026-10-20', due_at: '2026-10-20T15:00:00.000Z'}],
  ])('%s', (_name, item, when, expected) => {
    expect(proposalAt(item, when, zone)).toMatchObject(expected);
  });
});

describe('a task proposal\'s project (SV-24, D50)', () => {
  const projects = [{name: 'Inbox'}, {name: 'School'}, {name: 'Home'}];
  test.each<[string, boolean, ReturnType<typeof projectChoice>]>([
    ['', false, {project: null, create_project: false}],
    ['School', false, {project: 'School', create_project: false}],
    ['  school ', false, {project: 'School', create_project: false}],
    ['Work', true, {project: 'Work', create_project: true}],
    ['Wrok', false, {problem: 'No project named “Wrok”, pick one or create it'}],
    ['home', true, {project: 'Home', create_project: false}],
  ])('%j (New project picked: %s)', (text, create, choice) => expect(projectChoice(text, projects, create)).toEqual(choice));
  test('the menu: names holding what\'s typed, any case; New project only when none is exact', () => {
    expect(projectMatches('o', projects).map(project => project.name)).toEqual(['Inbox', 'School', 'Home']);
    expect(projectMatches('SCH', projects).map(project => project.name)).toEqual(['School']);
    expect(projectMatches('', projects)).toHaveLength(3);
    expect([namesProject('school', projects), namesProject('Scho', projects)]).toEqual([true, false]);
  });
  // SV-56: names starting with what's typed come first, then those with a word starting with it, then
  // those merely holding it, each in list order, so the menu's first row is what the line reads.
  test.each<[string, string[]]>([
    ['ho', ['Home', 'School']],
    ['h', ['Home', 'School']],
    ['sch', ['School']],
    ['o', ['Inbox', 'School', 'Home']],
    ['', ['Inbox', 'School', 'Home']],
  ])('the menu ranks %j: %j', (text, names) => expect(projectMatches(text, projects).map(project => project.name)).toEqual(names));
  test.each<[string, string[], string[]]>([
    ['pro', ['Approvals', 'Side projects', 'Projects'], ['Projects', 'Side projects', 'Approvals']],
    ['job', ['Odd jobs', 'Jobs', 'Bluejobs board'], ['Jobs', 'Odd jobs', 'Bluejobs board']],
    ['cal', ['Local', 'Club-calendar', 'Calendar'], ['Calendar', 'Club-calendar', 'Local']],
    ['  JOB ', ['Odd jobs', 'Jobs'], ['Jobs', 'Odd jobs']],
    ['x', ['Jobs'], []],
  ])('%j among %j ranks %j', (text, names, ranked) => expect(rankMatches(text, names.map(name => ({name})), one => one.name).map(one => one.name)).toEqual(ranked));
  // SV-25: once New project is picked for a name, the menu doesn't offer it again.
  test.each<[string, boolean, string[]]>([
    ['', false, ['Inbox', 'School', 'Home']],
    ['o', false, ['Inbox', 'School', 'Home', 'New project “o”']],
    ['ho', false, ['Home', 'School', 'New project “ho”']],
    ['school', false, ['School']],
    ['Work', false, ['New project “Work”']],
    ['Work', true, []],
    ['Hom', true, ['Home']],
  ])('the menu for %j (New picked: %s)', (text, isNew, labels) => {
    expect(projectMenu(text, projects, isNew).map(choice => (choice.isNew ? `New project “${choice.name}”` : choice.name))).toEqual(labels);
  });
});

describe('failedLine: a failed Create, in the provider\'s own words', () => {
  test.each<[Parameters<typeof failedLine>, string]>([
    [['google_calendar', 'The calendar is read-only. (403 Forbidden)'], 'Google Calendar, The calendar is read-only. (403 Forbidden)'],
    [['todoist', null], 'Todoist, It wasn’t created.'],
    [[null, 'Can’t reach Setpoint'], 'Can’t reach Setpoint'],
  ])('%j', (args, line) => {
    expect(failedLine(...args)).toBe(line);
  });
});

describe('SV-23: calendar results', () => {
  test('Upcoming, then Past, leaving out an empty heading', () => {
    const groups = (flags: boolean[]) => calendarResultGroups(flags.map((upcoming, index) => ({upcoming, index})))
      .map(group => `${group.heading} ${group.results.map(result => result.index).join(',')}`);
    expect(groups([true, true, false])).toEqual(['Upcoming 0,1', 'Past 2']);
    expect(groups([false, false])).toEqual(['Past 0,1']);
    expect(groups([])).toEqual([]);
  });

  test.each<[string, {day: string; year: string | null}]>([
    ['2026-10-09', {day: 'Oct 9', year: null}],
    ['2025-03-14', {day: 'Mar 14', year: '2025'}],
  ])('the day column for %s', (date, expected) => {
    expect(resultDay(date, '2026-10-07')).toEqual(expected);
  });

  const item = (fields: Partial<ItemOut>): ItemOut => ({
    key: '1', id: 1, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, command: null,
    all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, read_only: false, due_string: null,
    time_to_leave: null, colour: null, labels: [], repeat: null, ...fields,
  });
  test.each<[string, ItemOut, string | null, string]>([
    ['an event: its time and place', item({starts_at: '2026-10-10T02:00:00.000Z', ends_at: '2026-10-10T04:00:00.000Z', place: 'Blue Door'}), null, '7:00 – 9:00 PM · Blue Door'],
    ['an address alone: its street', item({starts_at: '2026-10-10T02:00:00.000Z', ends_at: '2026-10-10T04:00:00.000Z', address: '2118 Sunset Blvd, Los Angeles, CA 90026'}), null, '7:00 – 9:00 PM · 2118 Sunset Blvd'],
    ['no place: its calendar', item({starts_at: '2026-10-09T21:30:00.000Z', ends_at: '2026-10-09T22:30:00.000Z'}), null, '2:30 – 3:30 PM · Personal'],
    ['a series: its rule in words', item({starts_at: '2026-10-09T14:00:00.000Z', ends_at: '2026-10-09T15:00:00.000Z', recurring: true}), 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', '7:00 – 8:00 AM · Weekly on Mon, Wed, Fri · Personal'],
    ['an all-day event', item({all_day: true, start_date: '2026-10-12', end_date: '2026-10-13'}), null, 'All day · Personal'],
    ['a task: its repeat and project', item({kind: 'task', due_date: '2026-10-12', project: 'Home', repeat: 'every mon', recurring: true}), null, 'Every Monday · Home'],
  ])('the line: %s', (_name, shown, rule, expected) => {
    expect(calendarResultLine({item: shown, rule, date: '2026-10-09'}, 'Personal', zone)).toBe(expected);
  });
});

describe('finishedWords: what a pause chips, leaving the word still being typed', () => {
  test.each<[string, string, {words: string; last: string} | null]>([
    ['the words before the last', 'northwind rejection march', {words: 'northwind rejection ', last: 'march'}],
    ['one word: nothing finished', 'northwind', null],
    ['a space at the end: the field takes the chips itself', 'northwind ', null],
    ['leading spaces don\'t count', '  northwind mar', {words: 'northwind ', last: 'mar'}],
    ['an open quote waits', '"renewal offer', null],
    ['a closed quote is finished', '"renewal offer" mar', {words: '"renewal offer" ', last: 'mar'}],
  ])('%s', (_, text, expected) => {
    expect(finishedWords(text)).toEqual(expected);
  });
});

describe('the Answer card while Alfred works, and its sources', () => {
  test.each<[string, Parameters<typeof alfredStepLine>[0], string]>([
    ['before its first tool', null, 'Looking through your mail…'],
    ['a search, in its words', {tool: 'search_mail', query: 'job rejection'}, 'Searching “job rejection”…'],
    ['an email, by its sender', {tool: 'get_email', from: 'Northwind Talent'}, 'Reading Northwind Talent’s email…'],
    ['the calendar', {tool: 'list_items'}, 'Checking your calendar…'],
    ['an event', {tool: 'propose_item', kind: 'event'}, 'Preparing the event…'],
    ['a task', {tool: 'propose_item', kind: 'task'}, 'Preparing the task…'],
  ])('alfredStepLine: %s', (_name, step, line) => {
    expect(alfredStepLine(step)).toBe(line);
  });

  test.each<[string, Parameters<typeof alfredStepLine>[0], string]>([
    ['Ask about this email, before its first tool', null, 'Reading this email…'],
    ['then the tool it runs, as anywhere', {tool: 'get_email', from: 'Parkside Apartments'}, 'Reading Parkside Apartments’s email…'],
  ])('alfredStepLine, scoped to one email: %s', (_name, step, line) => {
    expect(alfredStepLine(step, true)).toBe(line);
  });

  test.each<[string, Parameters<typeof alfredStepDone>[0], ReturnType<typeof alfredStepDone>]>([
    ['a search, in its words', {tool: 'search_mail', query: 'lease renewal'}, {icon: 'search', text: 'Searched “lease renewal”'}],
    ['an email, by its sender', {tool: 'get_email', from: 'Parkside Apartments'}, {icon: 'mail', text: 'Read Parkside Apartments’s email'}],
    ['the calendar', {tool: 'list_items'}, {icon: 'calendar_today', text: 'Checked your calendar'}],
    ['an event', {tool: 'propose_item', kind: 'event'}, {icon: 'event', text: 'Prepared the event'}],
  ])('alfredStepDone, the trail\'s past tense: %s', (_name, step, done) => {
    expect(alfredStepDone(step)).toEqual(done);
  });

  const search = {tool: 'search_mail', query: 'lease'} as const;
  const read = {tool: 'get_email', from: 'Parkside Apartments'} as const;
  test.each<[string, Parameters<typeof withStep>[0], Parameters<typeof withStep>[1], ReturnType<typeof withStep>]>([
    ['the first step', [], search, [search]],
    ['nothing yet', [], null, []],
    ['the same step polled again: once', [search], {...search}, [search]],
    ['a new step after it', [search], read, [search, read]],
    ['a search again after reading: twice', [search, read], search, [search, read, search]],
  ])('withStep: %s', (_name, trail, step, next) => {
    expect(withStep(trail, step)).toEqual(next);
  });

  const ids = (count: number) => Array.from({length: count}, (_, index) => index + 1);
  test.each<[string, number, boolean, number[], string | null]>([
    ['five or fewer show whole, with no button', 5, false, ids(5), null],
    ['more than five: the first five and Show all', 26, false, ids(5), 'Show all 26'],
    ['shown all: every one and Show fewer', 26, true, ids(26), 'Show fewer'],
    ['six: the first five and Show all 6', 6, false, ids(5), 'Show all 6'],
  ])('shownSources: %s', (_name, count, all, shown, more) => {
    expect(shownSources(ids(count), all)).toEqual({shown, more});
  });
});
