// How free text matches (src/domain/searchMatch.ts): v1's plural partners and zero-result ladder,
// the index expressions, field matching in BRIEF.md's order, highlight runs and the excerpt.
import {describe, expect, test} from 'vitest';
import {excerptOf, ftsExpression, mergeRuns, phraseRuns, pluralVariants, termRuns, textLadder, textMatches, withoutExcluded} from '../src/domain/searchMatch.ts';

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
  const row = {fromName: 'Dana Whitfield', fromAddress: 'dana@parksideapts.example', organisation: 'Parkside Apartments', subject: 'Lease renewal terms', bodyText: 'Your lease ends. Once it\'s signed, your new term starts.'};

  test('fields in BRIEF.md\'s order, by word prefix', () => {
    expect(textMatches(row, ['dana', 'parkside', 'lease', 'sign', 'zebra'])).toEqual([
      {field: 'sender', terms: ['dana', 'parkside']}, {field: 'organisation', terms: ['parkside']}, {field: 'subject', terms: ['lease']}, {field: 'body', terms: ['lease', 'sign']},
    ]);
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
