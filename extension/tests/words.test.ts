// What the chip says and does (SV-174), as a table: the pane always says something, a card only for
// an application. jobs.test.tsx holds the standing to mail's Applied before words.
import type {JobsMailApplicationOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {chipFor, todayOf} from '../src/words.ts';
import type {Answer, Chip} from '../src/words.ts';

const TODAY = '2026-11-03';
const ORIGIN = 'https://setpoint.example';

const app = (id: number, title: string, rest: Partial<JobsMailApplicationOut>): JobsMailApplicationOut =>
  ({id, company: 'Fabrikam', title, applied_on: '2026-10-28', status: 'applied', status_on: '2026-10-28', ghosted: false, ...rest});
const answer = (role: JobsMailApplicationOut[], others: JobsMailApplicationOut[] = [], enabled = true): Answer =>
  ({ok: true, origin: ORIGIN, enabled, posting: {role, others, query: role.length || others.length ? 'fabrikam' : null}});

const inProcess = app(12, 'Software Engineer I', {status: 'in_process', status_on: '2026-11-01'});
const rejected = app(7, 'Support Analyst', {applied_on: '2026-09-16', status: 'rejected', status_on: '2026-10-05'});
const ghosted = app(5, 'Data Engineer', {applied_on: '2026-08-02', status_on: '2026-08-02', ghosted: true});

describe('the chip', () => {
  test.each<{was: string; answer: Answer | null; pane: Chip | null; card?: Chip | null}>([
    {was: 'while asked', answer: null, pane: {tone: 'quiet', text: 'Setpoint…', tip: 'Asking Setpoint'}, card: null},
    {
      was: 'an application for this role', answer: answer([inProcess]),
      pane: {tone: 'applied', text: 'Applied Oct 28 · In process', tip: 'Open in Setpoint\nSoftware Engineer I · Applied Oct 28 · In process', href: `${ORIGIN}/jobs/12`},
    },
    {
      was: 'two for this role, the newest closed, with the company\'s others in its tip',
      answer: answer([app(14, 'Software Engineer I', {applied_on: '2026-10-20', status: 'rejected', status_on: '2026-10-30'}), {...rejected, title: 'Software Engineer I'}], [ghosted]),
      pane: {
        tone: 'closed', text: 'Applied Oct 20 · Rejected Oct 30 · 2 times', href: `${ORIGIN}/jobs/14`,
        tip: 'Open in Setpoint\nSoftware Engineer I · Applied Oct 20 · Rejected Oct 30\nSoftware Engineer I · Applied Sep 16 · Rejected Oct 5\nData Engineer · Applied Aug 2 · Ghosted',
      },
    },
    {was: 'one ghosted', answer: answer([ghosted]), pane: {tone: 'closed', text: 'Applied Aug 2 · Ghosted', tip: 'Open in Setpoint\nData Engineer · Applied Aug 2 · Ghosted', href: `${ORIGIN}/jobs/5`}},
    {was: 'one today', answer: answer([app(30, 'Software Engineer I', {applied_on: TODAY, status_on: TODAY})]), pane: {tone: 'applied', text: 'Applied Today', tip: 'Open in Setpoint\nSoftware Engineer I · Applied Today', href: `${ORIGIN}/jobs/30`}},
    {
      was: 'one from last year, with an offer', answer: answer([app(31, '', {applied_on: '2025-12-12', status: 'offer', status_on: '2026-01-09'})]),
      pane: {tone: 'applied', text: 'Applied Dec 12, 2025 · Offer Jan 9', tip: 'Open in Setpoint\nFabrikam · Applied Dec 12, 2025 · Offer Jan 9', href: `${ORIGIN}/jobs/31`},
    },
    {
      was: 'another role at the company', answer: answer([], [rejected]),
      pane: {tone: 'other', text: 'Applied to another role here', tip: 'Open Jobs searched for Fabrikam\nSupport Analyst · Applied Sep 16 · Rejected Oct 5', href: `${ORIGIN}/jobs?q=fabrikam`},
    },
    {
      was: 'two other roles', answer: answer([], [rejected, ghosted]),
      pane: {
        tone: 'other', text: 'Applied to 2 other roles here', href: `${ORIGIN}/jobs?q=fabrikam`,
        tip: 'Open Jobs searched for Fabrikam\nSupport Analyst · Applied Sep 16 · Rejected Oct 5\nData Engineer · Applied Aug 2 · Ghosted',
      },
    },
    {was: 'nothing at the company', answer: answer([]), pane: {tone: 'quiet', text: 'Not applied', tip: 'Nothing in Setpoint\'s Jobs at Fabrikam'}, card: null},
    {was: 'Jobs off', answer: answer([], [], false), pane: {tone: 'quiet', text: 'Jobs is off in Setpoint', tip: 'Turn it on in Settings › Jobs'}, card: null},
    {
      was: 'not set up', answer: {ok: false, reason: 'setup'},
      pane: {tone: 'quiet', text: 'Set up Setpoint', tip: 'Add Setpoint\'s address and Jobs token in the extension\'s options', options: true}, card: null,
    },
    {
      was: 'the token refused', answer: {ok: false, reason: 'token'},
      pane: {tone: 'warn', text: 'Setpoint refused the token', tip: 'Issue a new one with npm run cli -- jobs-token, then paste it in the options', options: true}, card: null,
    },
    {
      was: 'Setpoint unreachable', answer: {ok: false, reason: 'unreachable', detail: 'Failed to fetch'},
      pane: {tone: 'warn', text: 'Setpoint unreachable', tip: 'Setpoint didn\'t answer, Failed to fetch', options: true}, card: null,
    },
    {
      was: 'an answer this build can\'t read', answer: {ok: false, reason: 'answer', detail: 'Invalid input'},
      pane: {tone: 'warn', text: 'Couldn\'t read Setpoint\'s answer', tip: 'It isn\'t the shape this build reads, so rebuild the extension from Setpoint\'s commit'}, card: null,
    },
  ])('$was', ({answer: got, pane, card}) => {
    expect(chipFor(got, 'Fabrikam', 'pane', TODAY)).toEqual(pane);
    // A card shows the pane's chip for an application, and nothing otherwise.
    expect(chipFor(got, 'Fabrikam', 'card', TODAY)).toEqual(card === undefined ? pane : card);
  });

  test('searches Jobs for the company when the answer has no query', () => {
    const got: Answer = {ok: true, origin: ORIGIN, enabled: true, posting: {role: [], others: [rejected], query: null}};
    expect(chipFor(got, 'Proseware, Inc.', 'card', TODAY)?.href).toBe(`${ORIGIN}/jobs?q=Proseware%2C%20Inc.`);
  });
});

test('today is the browser\'s local day', () => {
  expect(todayOf(new Date(2026, 0, 9, 23, 30))).toBe('2026-01-09');
});
