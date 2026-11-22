// Mail search's Gmail-style operators, as a table: what's typed, the operators read (with where
// each sits) and the words left.
import {describe, expect, test} from 'vitest';
import {parseOperators, searchTokens, validDay} from '@setpoint/shared';
import type {OperatorFilter} from '@setpoint/shared';

const at = (text: string, token: string) => ({start: text.indexOf(token), end: text.indexOf(token) + token.length});

describe('parseOperators', () => {
  const cases: [string, OperatorFilter[], string][] = [
    ['from:pat lease', [{kind: 'from', value: 'pat', not: false}], 'lease'],
    ['from:"Sam Ortiz" lease', [{kind: 'from', value: 'Sam Ortiz', not: false}], 'lease'],
    ['lease from:"Sam', [{kind: 'from', value: 'Sam', not: false}], 'lease'],
    ['FROM:Pat', [{kind: 'from', value: 'Pat', not: false}], ''],
    ['-from:pat', [{kind: 'from', value: 'pat', not: true}], ''],
    ['!to:sam@x.org', [{kind: 'to', value: 'sam@x.org', not: true}], ''],
    ['from:-indeed', [{kind: 'from', value: 'indeed', not: true}], ''],
    ['-from:-indeed', [{kind: 'from', value: 'indeed', not: true}], ''],
    ['from:usps-informed', [{kind: 'from', value: 'usps-informed', not: false}], ''],
    ['from:- lease', [], 'lease'],
    ['from: lease', [], 'lease'],
    ['has:attachment', [{kind: 'attachment', not: false}], ''],
    ['has:file', [{kind: 'attachment', not: false}], ''],
    ['has:pdf', [], 'has:pdf'],
    ['is:unread', [{kind: 'unread', value: true, not: false}], ''],
    ['is:read', [{kind: 'unread', value: false, not: false}], ''],
    ['is:starred', [], 'is:starred'],
    ['after:2026/03/01', [{kind: 'after', date: '2026-03-01', not: false}], ''],
    ['before:2026-3-1', [{kind: 'before', date: '2026-03-01', not: false}], ''],
    ['before:2026/13/40', [], 'before:2026/13/40'],
    ['before:2026/2/30', [], 'before:2026/2/30'],
    ['subject:"lease renewal"', [{kind: 'subject', value: 'lease renewal', not: false}], ''],
    ['foo:bar', [], 'foo:bar'],
    ['https://x.org', [], 'https://x.org'],
    ['from:pat from:sam', [{kind: 'from', value: 'pat', not: false}, {kind: 'from', value: 'sam', not: false}], ''],
    ['refund -renewal "lease renewal"', [], 'refund -renewal "lease renewal"'],
  ];
  test.each(cases)('%s', (text, operators, words) => {
    const parsed = parseOperators(text);
    expect(parsed.operators.map(({start: _s, end: _e, ...operator}) => operator)).toEqual(operators);
    expect(parsed.text).toBe(words);
  });

  test.each([
    ['from:pat lease', 'from:pat'],
    ['lease -from:"Sam Ortiz" x', '-from:"Sam Ortiz"'],
    ['x from:-indeed', 'from:-indeed'],
    ['lease from:"Sam', 'from:"Sam'],
  ])('%s spans %s', (text, token) => {
    const [operator] = parseOperators(text).operators;
    expect({start: operator!.start, end: operator!.end}).toEqual(at(text, token));
  });
});

describe('searchTokens', () => {
  test.each([
    ['from:"Sam Ortiz" lease', [['from:"Sam Ortiz"', true], ['lease', false]]],
    ['-from:"Sam Ortiz"', [['-from:"Sam Ortiz"', true]]],
    ['from: has:pdf', [['from:', true], ['has:pdf', false]]],
    ['"lease renewal" x', [['"lease renewal"', false], ['x', false]]],
  ] as const)('%s', (text, expected) => {
    expect(searchTokens(text).map(token => [token.raw, token.operator])).toEqual(expected);
  });
});

describe('validDay', () => {
  test.each([
    [2026, 3, 1, true],
    [2026, 2, 29, false],
    [2028, 2, 29, true],
    [2026, 13, 1, false],
    [2026, 4, 31, false],
    [2026, 12, 31, true],
  ])('%i-%i-%i is %s', (year, month, day, valid) => {
    expect(validDay(year, month, day)).toBe(valid);
  });
});
