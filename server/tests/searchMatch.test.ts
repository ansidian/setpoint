// How free text matches (src/domain/searchMatch.ts): v1's plural partners and zero-result ladder,
// the words the field requires and the tiers they rank by, the index expressions, field matching in
// BRIEF.md's order, highlight runs and the excerpt.
import {describe, expect, test} from 'vitest';
import {excerptOf, ftsExpression, isLinkOnly, matchTier, mergeRuns, phraseRuns, pluralVariants, searchWords, termRuns, textLadder, textMatches, TIER, withoutExcluded} from '../src/domain/searchMatch.ts';
import type {RankedRow} from '../src/domain/searchMatch.ts';

describe('pluralVariants (v1)', () => {
  test.each<[string, string[]]>([
    ['rejections', ['rejection']], ['rejection', ['rejections']], ['deliveries', ['delivery']], ['delivery', ['deliveries']],
    ['boxes', ['box']], ['matches', ['match']], ['class', []], ['days', ['day']], ['day', []], ['cs', []], ['4220', []], ['café', []],
  ])('%s → %j', (term, variants) => {
    expect(pluralVariants(term)).toEqual(variants);
  });
});

describe('textLadder: every word, then any word but filler', () => {
  test.each<[string, string[]]>([
    ['lease renewal', ['and lease renewal', 'or lease renewal']],
    ['When does my lease renewal need to be signed?', ['and when does my lease renewal need to be signed', 'or lease renewal signed']],
    ['lease', ['and lease']],
    ['the lease', ['and the lease', 'or lease']],
    ['the', ['and the']],
    ['  ', []],
  ])('%s', (text, steps) => {
    expect(textLadder(text).map(step => `${step.mode} ${step.terms.join(' ')}`)).toEqual(steps);
  });

  test('expressions: prefix terms with their plural partners, optionally in some columns', () => {
    expect(ftsExpression(['lease', 'rejections'], 'and')).toBe('("lease"* OR "leases"*) AND ("rejections"* OR "rejection"*)');
    expect(ftsExpression(['cs', 'it"s'], 'or', ['subject'])).toBe('{subject} : ("cs"* OR "it""s"*)');
  });
});

describe('searchWords: what the field requires', () => {
  test.each<[string, string[]]>([
    ['lease renewal', ['lease', 'renewal']],
    ['When does my lease renewal need to be signed?', ['lease', 'renewal', 'signed']],
    ['IT Specialist', ['it', 'specialist']],
    ['it specialist', ['specialist']],
    ['It specialist', ['specialist']],
    ['WHERE IS MY LEASE', ['lease']],
    ['IT', ['it']],
    ['the', ['the']],
    ['the of', ['the', 'of']],
    ['lease Lease LEASE', ['lease']],
    ['  ', []],
  ])('%s', (text, terms) => {
    expect(searchWords(text).map(word => word.term)).toEqual(terms);
  });

  test('filler alone asks nothing once a chip says what\'s wanted', () => {
    expect(searchWords('the of', {dropAllFiller: true})).toEqual([]);
    expect(searchWords('the lease', {dropAllFiller: true}).map(word => word.term)).toEqual(['lease']);
  });

  test('the last word is the one being typed, unless it was filler', () => {
    expect(searchWords('lease rene', {typing: true}).map(word => word.typing)).toEqual([false, true]);
    expect(searchWords('lease rene').map(word => word.typing)).toEqual([false, false]);
    expect(searchWords('lease the', {typing: true}).map(word => word.typing)).toEqual([false]);
  });

  test('a word can name a type: a chip\'s words, and a bill as a statement', () => {
    expect(searchWords('job rejections water bills lease').map(word => word.type)).toEqual([null, 'rejection', null, 'statement', null]);
  });
});

describe('matchTier: how well an email matches', () => {
  const email: RankedRow = {fromName: 'Billing Desk', fromAddress: 'billing@notices.example', organisation: 'Fabrikam Utilities', subject: 'A note', summary: null, searchTerms: null, searchBody: '', type: null};
  const tier = (text: string, row: Partial<RankedRow>, typing = false) => matchTier({...email, ...row}, searchWords(text, {typing}));

  test.each<[string, string, Partial<RankedRow>, number]>([
    ['every word in the sender, a word\'s start being enough', 'fabrikam bill', {}, TIER.sender],
    ['every word in the sender, across name and organisation', 'fab desk', {}, TIER.sender],
    ['one word, whole, in the subject', 'invoice', {subject: 'Your invoice is ready'}, TIER.phrase],
    ['a phrase in the subject', 'water bill', {subject: 'Your water bill is ready'}, TIER.phrase],
    ['a phrase takes each word\'s start', 'follow up', {subject: 'Following up on your order'}, TIER.phrase],
    ['a phrase takes a plural', 'water bill', {subject: 'Water bills are due'}, TIER.phrase],
    ['a phrase in one search term', 'water bill', {searchTerms: 'utility payment\nwater bill'}, TIER.phrase],
    ['every word in the subject, apart', 'application developer', {subject: 'Application: Junior Developer'}, TIER.subject],
    ['one word by its start in the subject', 'invo', {subject: 'Your invoice is ready'}, TIER.subject],
    ['every word by its start in the subject', 'appl dev', {subject: 'Application: Junior Developer'}, TIER.subject],
    ['every word in one search term, apart', 'water bill', {searchTerms: 'bill for water'}, TIER.subject],
    ['one word in a search term is no more than a term', 'autopay', {searchTerms: 'autopay\nstatement'}, TIER.across],
    ['words across the sender and the subject', 'fabrikam invoice', {subject: 'Your invoice'}, TIER.across],
    ['words across search terms', 'water bill', {searchTerms: 'water\nbill'}, TIER.across],
    ['words across the summary and the subject', 'water invoice', {subject: 'Your invoice', summary: 'Water for October'}, TIER.across],
    ['a type counts as its word', 'water bill', {subject: 'Your water usage', type: 'statement'}, TIER.across],
    ['a chip\'s type counts as its word', 'job rejections', {subject: 'Your job application', type: 'rejection'}, TIER.across],
    ['a phrase in the body', 'call off', {searchBody: 'Please call off the visit.'}, TIER.body],
    ['a phrase in the body by each word\'s start', 'call off', {searchBody: 'I am calling off the visit.'}, TIER.body],
    ['words within 8 in the body, either way round', 'visit call', {searchBody: 'Please call me today about the visit.'}, TIER.body],
    ['words 8 words apart in the body', 'call visit', {searchBody: 'call a b c d e f g visit'}, TIER.body],
    ['words 9 words apart aren\'t', 'call visit', {searchBody: 'call a b c d e f g h visit'}, TIER.mention],
    ['one word in the body is a mention', 'invoice', {searchBody: 'Your invoice is ready.'}, TIER.mention],
    ['a word in the subject and one in the body is a mention', 'invoice ready', {subject: 'Your invoice', searchBody: 'It is ready.'}, TIER.mention],
    ['a finished word by its start in the body is less', 'bon', {searchBody: 'A bonus for you.'}, TIER.partOfWord],
    ['the summary wants a word whole', 'bon', {summary: 'A bonus for you.'}, TIER.partOfWord],
    ['search terms want a word whole', 'water bill', {searchTerms: 'waterfall\nbill'}, TIER.partOfWord],
  ])('%s', (_, text, row, expected) => {
    expect(tier(text, row)).toBe(expected);
  });

  test('the word being typed matches by its start everywhere', () => {
    expect(tier('bon', {searchBody: 'A bonus for you.'}, true)).toBe(TIER.mention);
    expect(tier('call vis', {searchBody: 'Please call about the visit.'}, true)).toBe(TIER.body);
    expect(tier('water bi', {searchTerms: 'water bill'}, true)).toBe(TIER.phrase);
    expect(tier('fl water', {searchTerms: 'flood\nwater'}, true)).toBe(TIER.partOfWord);
  });

  test('a word found only in what a link left, and not one the email says or has as its type', () => {
    const row = {...email, subject: 'Your weekly digest', searchBody: 'Read it at tailspin'};
    expect(isLinkOnly(row, searchWords('tailspin'), 'Read it at ')).toBe(true);
    expect(isLinkOnly(row, searchWords('tail'), 'Read it at ')).toBe(true);
    expect(isLinkOnly(row, searchWords('tailspin'), 'Read Tailspin at ')).toBe(false);
    expect(isLinkOnly(row, searchWords('weekly tailspin'), 'Read it at ')).toBe(true);
    expect(isLinkOnly(row, searchWords('weekly digest'), 'Read it at ')).toBe(false);
    expect(isLinkOnly({...row, type: 'statement'}, searchWords('bill'), '')).toBe(false);
  });
});

describe('withoutExcluded: "!word"s leave out the mail that has them (SV-31)', () => {
  test.each<[string, string, string[]]>([
    ['invoice !proseware', 'invoice', ['proseware']],
    ['!Proseware invoice !Woodgrove', 'invoice', ['proseware', 'woodgrove']],
    ['!water-invoice', '', ['water', 'invoice']],
    ['wow! ! invoice', 'wow! ! invoice', []],
    ['', '', []],
  ])('%s', (text, kept, excluded) => {
    expect(withoutExcluded(text)).toEqual({text: kept, excluded});
  });
});

describe('matching and highlighting', () => {
  const row = {fromName: 'Dana Whitfield', fromAddress: 'dana@parksideapts.example', organisation: 'Parkside Apartments', subject: 'Lease renewal terms', summary: 'Renewal terms for the flat', searchTerms: 'tenancy agreement', searchBody: 'Your lease ends. Once it\'s signed, your new term starts.'};

  test('fields in BRIEF.md\'s order, by word prefix', () => {
    expect(textMatches(row, ['dana', 'parkside', 'lease', 'sign', 'zebra'])).toEqual([
      {field: 'sender', terms: ['dana', 'parkside']}, {field: 'organisation', terms: ['parkside']}, {field: 'subject', terms: ['lease']}, {field: 'body', terms: ['lease', 'sign']},
    ]);
  });

  test('the summary and search terms match as the body does, and a word the index no longer holds matches nothing', () => {
    expect(textMatches(row, ['flat', 'tenancy'])).toEqual([{field: 'body', terms: ['flat', 'tenancy']}]);
    expect(textMatches({...row, summary: null, searchTerms: null}, ['flat', 'tenancy'])).toEqual([]);
  });

  test('runs cover the typed prefix, or the whole word once it\'s typed out; phrases match whole words', () => {
    const value = 'Northwind Talent · Lease renewals';
    const show = (runs: {start: number; end: number}[]) => runs.map(run => value.slice(run.start, run.end));
    expect(show(termRuns(value, ['north', 'renewal']))).toEqual(['North', 'renewals']);
    expect(show(phraseRuns(value, 'Northwind Talent'))).toEqual(['Northwind Talent']);
    expect(show(phraseRuns(value, 'North'))).toEqual([]);
    expect(mergeRuns([{start: 4, end: 8}, {start: 0, end: 5}, {start: 10, end: 12}])).toEqual([{start: 0, end: 8}, {start: 10, end: 12}]);
  });

  test('the excerpt: from the start when the word shows there, else around it with "…"', () => {
    const near = 'Your lease ends soon.';
    expect(excerptOf(near, text => termRuns(text, ['lease']))).toBe('Your lease ends soon.');
    const far = `${'Filler words go here. '.repeat(12)}Once it's signed, your new term starts Dec 1. ${'More words follow on. '.repeat(10)}`;
    const excerpt = excerptOf(far, text => termRuns(text, ['signed']));
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('Once it\'s signed, your new term starts Dec 1.');
    expect(excerpt.length).toBeLessThanOrEqual(163);
  });
});
