// Jobs's pure rules as tables (J1): Ghosted, the per-week buckets, the counts, Applied before, and
// the keys applications match on.
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import type {JobStatus} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {zonedInstant} from '../../domain/time.ts';
import {companyKey, countsByStatus, daysWithoutEmail, isGhosted, relatedApplications, titleKey, weeklyCounts} from '../rules.ts';

const at = (date: string, time = '12:00') => zonedInstant(date, time, SEED_TIME_ZONE);

describe('Ghosted (decision 55)', () => {
  // Now is Wed Oct 7, 2026, 9:12 AM Pacific.
  test.each<[string, JobStatus, string, number, boolean]>([
    ['Proseware: Applied Aug 20, no email since', 'applied', at('2026-08-20', '09:15'), 48, true],
    ['30 days to the day', 'applied', at('2026-09-07', '23:59'), 30, true],
    ['29 days', 'applied', at('2026-09-08', '00:01'), 29, false],
    ['an email today', 'applied', at('2026-10-07', '07:12'), 0, false],
    ['late last night, Pacific, is yesterday', 'applied', at('2026-10-06', '23:30'), 1, false],
    ['In process is never Ghosted', 'in_process', at('2026-08-01'), 67, false],
    ['nor is Rejected', 'rejected', at('2026-08-01'), 67, false],
    ['nor Withdrawn', 'withdrawn', at('2026-08-01'), 67, false],
  ])('%s', (_, status, lastEmailAt, days, ghosted) => {
    expect(daysWithoutEmail(lastEmailAt, SEED_NOW, SEED_TIME_ZONE)).toBe(days);
    expect(isGhosted(status, lastEmailAt, SEED_NOW, SEED_TIME_ZONE)).toBe(ghosted);
  });
});

describe('applications per week (D314, D318)', () => {
  test('12 weeks, Sunday to Saturday in the zone, oldest first, this week unfinished', () => {
    const weeks = weeklyCounts([], SEED_NOW, SEED_TIME_ZONE);
    expect(weeks).toHaveLength(12);
    expect(weeks[0]).toEqual({start: '2026-07-19', end: '2026-07-25', count: 0, current: false});
    expect(weeks.at(-2)).toEqual({start: '2026-09-27', end: '2026-10-03', count: 0, current: false});
    expect(weeks.at(-1)).toEqual({start: '2026-10-04', end: '2026-10-10', count: 0, current: true});
  });

  test.each<[string, string, number | null]>([
    ['this week, today', at('2026-10-07', '02:14'), 11],
    ['this week, its Sunday', at('2026-10-04', '00:00'), 11],
    ['last week, its Saturday in Pacific (Sunday in UTC)', at('2026-10-03', '23:30'), 10],
    ['the first week, its Sunday', at('2026-07-19', '00:05'), 0],
    ['before the first week', at('2026-07-18', '23:55'), null],
    ['after now is still this week', at('2026-10-10', '20:00'), 11],
  ])('%s', (_, appliedAt, week) => {
    const counts = weeklyCounts([appliedAt], SEED_NOW, SEED_TIME_ZONE).map(bucket => bucket.count);
    expect(counts.indexOf(1)).toBe(week ?? -1);
  });
});

test('counts by status, Ghosted under Applied', () => {
  const rows: {status: JobStatus; ghosted: boolean}[] = [
    {status: 'applied', ghosted: true}, {status: 'applied', ghosted: false}, {status: 'in_process', ghosted: false},
    {status: 'rejected', ghosted: false}, {status: 'rejected', ghosted: false}, {status: 'withdrawn', ghosted: false},
  ];
  expect(countsByStatus(rows)).toEqual({all: 6, ghosted: 1, by_status: {applied: 2, in_process: 1, offer: 0, rejected: 2, withdrawn: 1}});
  expect(countsByStatus([])).toEqual({all: 0, ghosted: 0, by_status: {applied: 0, in_process: 0, offer: 0, rejected: 0, withdrawn: 0}});
});

describe('Applied before and Also at (D306)', () => {
  const app = (id: number, appliedAt: string, status: JobStatus) => ({id, appliedAt, status});
  test.each<[string, ReturnType<typeof app>, ReturnType<typeof app>[], number[], number[]]>([
    ['an earlier rejection is Applied before', app(1, '2026-10-01', 'in_process'), [app(2, '2026-02-09', 'rejected')], [2], []],
    ['an earlier open one is Also at', app(1, '2026-09-30', 'applied'), [app(2, '2026-09-28', 'applied')], [], [2]],
    ['a later one is Also at, closed or not', app(1, '2026-07-22', 'rejected'), [app(2, '2026-10-06', 'applied'), app(3, '2026-09-01', 'withdrawn')], [], [2, 3]],
    ['itself is neither', app(1, '2026-10-01', 'applied'), [app(1, '2026-10-01', 'applied')], [], []],
    ['newest first', app(1, '2026-10-01', 'applied'), [app(2, '2026-01-01', 'rejected'), app(3, '2026-05-01', 'withdrawn')], [3, 2], []],
  ])('%s', (_, self, others, before, also) => {
    const {appliedBefore, alsoAt} = relatedApplications(self, others);
    expect(appliedBefore.map(other => other.id)).toEqual(before);
    expect(alsoAt.map(other => other.id)).toEqual(also);
  });
});

test.each([
  ['Software Engineer II (Java) (2026-1042)', 'software engineer ii'],
  ['Software Engineer II', 'software engineer ii'],
  ['Software Engineer II, Claims', 'software engineer ii claims'],
  ['Data Engineer I [Remote]', 'data engineer i'],
  ['Web Developer - Hybrid', 'web developer'],
  ['QA Engineer, On-site', 'qa engineer'],
])('the title %j matches as %j (decision 51)', (title, key) => {
  expect(titleKey(title)).toBe(key);
});

test.each([
  ['City Power & Light', 'city power light'],
  ['Margie\'s Travel', 'margie s travel'],
  ['  Northwind   Talent ', 'northwind talent'],
])('the company %j groups as %j', (company, key) => {
  expect(companyKey(company)).toBe(key);
});
