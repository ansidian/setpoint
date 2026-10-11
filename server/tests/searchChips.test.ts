// The chip grammar (BRIEF.md › Search): words become organisation, type, date, account and kind
// chips; everything else stays free text. Dates resolve in the owner's zone against the clock,
// preferring the past.
import type {SearchChip} from '@setpoint/shared';
import {SEED_NOW} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {parseQuery} from '../src/domain/searchChips.ts';

const VOCABULARY = {
  organisations: ['Northwind Talent', 'Northwind Engineering', 'Parkside Apartments', 'Contoso Insurance', 'Contoso Coffee', 'Contoso University', 'Google', 'Wingtip Toys', 'The Home Depot'],
  accounts: [{id: 1, label: 'Business'}, {id: 2, label: 'Personal'}, {id: 3, label: 'Work'}, {id: 4, label: 'Jobs'}, {id: 5, label: 'iCloud'}],
};
const TIME_ZONE = 'America/Los_Angeles';

/** Chips as "Org Northwind" strings, for compact tables; dates also show their range. */
function show(chip: SearchChip): string {
  const name = `${chip.not ? 'Not ' : ''}${{organisation: 'Org', type: 'Type', date: 'Date', account: 'Account', kind: 'Kind'}[chip.kind]}`;
  return chip.kind === 'date' ? `${name} ${chip.label} [${chip.from}, ${chip.to})` : `${name} ${chip.label}`;
}

const parse = (text: string, now = SEED_NOW) => {
  const parsed = parseQuery(text, {...VOCABULARY, now, timeZone: TIME_ZONE});
  return {chips: parsed.chips.map(show), text: parsed.text};
};

describe('parseQuery: the brief\'s example', () => {
  test('northwind rejection march → Northwind · Rejection · Mar 2026', () => {
    const parsed = parseQuery('northwind rejection march', {...VOCABULARY, now: SEED_NOW, timeZone: TIME_ZONE});
    expect(parsed.chips).toEqual([
      {kind: 'organisation', value: 'Northwind', label: 'Northwind'},
      {kind: 'type', value: 'rejection', label: 'Rejection'},
      {kind: 'date', from: '2026-03-01', to: '2026-04-01', label: 'Mar 2026'},
    ]);
    expect(parsed.text).toBe('');
    expect(parsed.chips.map(chip => chip.label).join(' · ')).toBe('Northwind · Rejection · Mar 2026');
  });
});

describe('parseQuery: chips', () => {
  test.each<[string, string, string[], string]>([
    // name, query, chips, free text left
    ['organisation by its first word', 'northwind', ['Org Northwind'], ''],
    ['organisation by its leading words', 'northwind talent', ['Org Northwind Talent'], ''],
    ['the longer organisation wins', 'contoso insurance', ['Org Contoso Insurance'], ''],
    ['a later word of an organisation stays text', 'talent', [], 'talent'],
    ['filler alone never starts an organisation', 'the', [], 'the'],
    ['an organisation starting with filler, by its words', 'the home depot', ['Org The Home Depot'], ''],
    ['case and punctuation don\'t matter', 'NorthWind, Rejection!', ['Org Northwind', 'Type Rejection'], ''],
    ['plural types', 'statements', ['Type Statement'], ''],
    ['two-word type', 'verification code', ['Type Verification code'], ''],
    ['shipped is shipping', 'wingtip toys shipped', ['Org Wingtip Toys', 'Type Shipping'], ''],
    ['kind', 'deliveries', ['Kind Deliveries'], ''],
    ['"other" stays a word', 'other candidates', [], 'other candidates'],
    ['account by its label', 'jobs', ['Account Jobs'], ''],
    ['account with an organisation and free text', 'personal google recovery', ['Account Personal', 'Org Google'], 'recovery'],
    ['free text around chips keeps its order', 'lease northwind renewal', ['Org Northwind'], 'lease renewal'],
    ['quoted words stay text', '"jobs" fair', [], '"jobs" fair'],
    ['a repeated chip appears once', 'northwind northwind', ['Org Northwind'], ''],
    ['two organisations are both kept', 'northwind contoso', ['Org Northwind', 'Org Contoso'], ''],
    ['nothing recognised', 'lease renewal signed', [], 'lease renewal signed'],
    ['empty', '   ', [], ''],
  ])('%s', (_, query, chips, text) => {
    expect(parse(query)).toEqual({chips, text});
  });
});

describe('parseQuery: "!" leaves out what a word names (SV-31)', () => {
  test.each<[string, string, string[], string]>([
    // name, query, chips, free text left
    ['a type', '!confirmation', ['Not Type Confirmation'], ''],
    ['beside chips and words', 'northwind invoice !rejection', ['Org Northwind', 'Not Type Rejection'], 'invoice'],
    ['an organisation by its leading words', '!northwind talent', ['Not Org Northwind Talent'], ''],
    ['a date', '!march', ['Not Date Mar 2026 [2026-03-01, 2026-04-01)'], ''],
    ['an account and a kind', '!jobs !deliveries', ['Not Account Jobs', 'Not Kind Deliveries'], ''],
    ['a phrase never takes in a later "!" word', 'contoso !insurance', ['Org Contoso'], '!insurance'],
    ['a word that forms no chip stays text, "!" and all', 'water invoice notification !proseware', [], 'water invoice notification !proseware'],
    ['a chip and its Not are both kept', 'northwind !northwind', ['Org Northwind', 'Not Org Northwind'], ''],
    ['"!" after a word, or alone, is punctuation', 'rejection! !', ['Type Rejection'], '!'],
    ['quoted words stay text', '!"confirmation"', [], '! "confirmation"'],
  ])('%s', (_, query, chips, text) => {
    expect(parse(query)).toEqual({chips, text});
  });
});

describe('parseQuery: dates in the owner\'s zone, preferring the past (now: Wed Oct 7, 2026)', () => {
  test.each<[string, string, string[], string]>([
    ['a bare month this year', 'march', ['Date Mar 2026 [2026-03-01, 2026-04-01)'], ''],
    ['a later month is last year\'s', 'november', ['Date Nov 2025 [2025-11-01, 2025-12-01)'], ''],
    ['this month', 'oct', ['Date Oct 2026 [2026-10-01, 2026-11-01)'], ''],
    ['a month and year', 'mar 2025', ['Date Mar 2025 [2025-03-01, 2025-04-01)'], ''],
    ['a year', '2025', ['Date 2025 [2025-01-01, 2026-01-01)'], ''],
    ['a future year stays text', '2031', [], '2031'],
    ['a course number stays text', 'cs 101', [], 'cs 101'],
    ['today', 'today', ['Date Today [2026-10-07, 2026-10-08)'], ''],
    ['yesterday', 'yesterday', ['Date Yesterday [2026-10-06, 2026-10-07)'], ''],
    ['last week, Sunday to Saturday (SV-29)', 'last week', ['Date Sep 27 – Oct 3 [2026-09-27, 2026-10-04)'], ''],
    ['this week', 'this week', ['Date Oct 4 – Oct 10 [2026-10-04, 2026-10-11)'], ''],
    ['last month', 'last month', ['Date Sep 2026 [2026-09-01, 2026-10-01)'], ''],
    ['last year', 'last year', ['Date 2025 [2025-01-01, 2026-01-01)'], ''],
    ['the last 7 days', 'last 7 days', ['Date Oct 1 – Today [2026-10-01, 2026-10-08)'], ''],
    ['a day', 'sep 30', ['Date Sep 30 [2026-09-30, 2026-10-01)'], ''],
    ['a later day is last year\'s', 'dec 9', ['Date Dec 9, 2025 [2025-12-09, 2025-12-10)'], ''],
    ['a numeric day', '3/14', ['Date Mar 14 [2026-03-14, 2026-03-15)'], ''],
    ['a full day', 'march 14 2025', ['Date Mar 14, 2025 [2025-03-14, 2025-03-15)'], ''],
    ['an ordinal day', 'oct 1st', ['Date Oct 1 [2026-10-01, 2026-10-02)'], ''],
    ['a weekday is the latest one', 'monday', ['Date Oct 5 [2026-10-05, 2026-10-06)'], ''],
    ['a short weekday stays text', 'sun', [], 'sun'],
    ['a bare "may" stays text', 'may', [], 'may'],
    ['May with a year is the month', 'may 2026', ['Date May 2026 [2026-05-01, 2026-06-01)'], ''],
    ['a range of days', 'mar 1 - mar 5', ['Date Mar 1 – Mar 5 [2026-03-01, 2026-03-06)'], ''],
    ['a range of months', 'march to may', ['Date Mar – May 2026 [2026-03-01, 2026-06-01)'], ''],
    ['since a month', 'since sep', ['Date Since Sep 2026 [2026-09-01, 2026-10-08)'], ''],
    ['after a day', 'after oct 1', ['Date After Oct 1 [2026-10-02, 2026-10-08)'], ''],
    ['before a year', 'before 2026', ['Date Before 2026 [1970-01-01, 2026-01-01)'], ''],
    ['until a month', 'until march', ['Date Until Mar 2026 [1970-01-01, 2026-04-01)'], ''],
    ['a time of day stays text', '7pm', [], '7pm'],
    ['"since" alone stays text', 'since', [], 'since'],
    ['a date amid other chips', 'contoso statement last month', ['Org Contoso', 'Type Statement', 'Date Sep 2026 [2026-09-01, 2026-10-01)'], ''],
  ])('%s', (_, query, chips, text) => {
    expect(parse(query)).toEqual({chips, text});
  });

  test('"march" before March is last year\'s', () => {
    expect(parse('march', '2026-02-10T18:00:00.000Z').chips).toEqual(['Date Mar 2025 [2025-03-01, 2025-04-01)']);
  });

  test('the day is the owner\'s: 11 PM on Oct 6 in Los Angeles is already Oct 7 in UTC', () => {
    expect(parse('today', '2026-10-07T06:00:00.000Z').chips).toEqual(['Date Today [2026-10-06, 2026-10-07)']);
  });

  test('a new year: "december" is last year\'s and "today" this year\'s', () => {
    expect(parse('december today', '2027-01-02T20:00:00.000Z').chips).toEqual([
      'Date Dec 2026 [2026-12-01, 2027-01-01)', 'Date Today [2027-01-02, 2027-01-03)',
    ]);
  });
});
