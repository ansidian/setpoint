// The Jobs pane's recent movement (SV-220, D467, D470) against an ephemeral database: each application's
// latest status change, newest first, the last eight. An email changes it only when it sets a status
// the application didn't have; a hand move comes from what its emails had set; turning Ghosted comes
// from Applied at the start of the day 30 days after the last email of any kind; and a new
// application has no `from`. The quiet line's accounts and earliest month come with it.
import type {JobEventKind, JobStatus} from '@setpoint/shared';
import {expect, test} from 'vitest';
import {world} from '../../../tests/helpers.ts';
import {jobsDb, migrateJobs} from '../db.ts';
import {jobsMovement, MOVES_SHOWN} from '../queries.ts';
import * as j from '../schema.ts';

const NOW = '2026-10-07T19:00:00.000Z';

type Setup = {
  company: string;
  appliedAt: string;
  status?: JobStatus;
  // Set by hand at this instant.
  hand?: string;
  events?: [string, JobEventKind][];
};

function movement(applications: Setup[], accounts: number[] = []) {
  const w = world({now: NOW});
  migrateJobs(w.store.sqlite);
  const db = jobsDb(w.store.sqlite);
  db.insert(j.jobsSettings).values({id: 1, enabled: true, accounts: accounts.map(account_id => ({account_id, reads: 'every' as const})), updatedAt: NOW}).run();
  for (const one of applications) {
    const {id} = db.insert(j.jobsApplications).values({
      company: one.company, title: 'Developer', titleKey: 'developer', appliedAt: one.appliedAt, status: one.status ?? 'applied',
      statusSetBy: one.hand ? 'user' : 'email', statusSetAt: one.hand ?? one.appliedAt, createdAt: one.appliedAt, updatedAt: one.appliedAt,
    }).returning({id: j.jobsApplications.id}).get();
    for (const [at, kind] of one.events ?? []) db.insert(j.jobsEvents).values({applicationId: id, at, kind, sender: 'Recruiting', subject: 'About your application', createdAt: at}).run();
  }
  return jobsMovement(w.store);
}

const moves = (applications: Setup[]) => movement(applications).moves.map(({company, from, to, by_hand, at}) => ({company, from, to, by_hand, at}));

test.each<{case: string; setup: Setup; move: {from: JobStatus | null; to: JobStatus | 'ghosted'; by_hand: boolean; at: string}}>([
  {case: 'a new application reads Applied, from nothing', setup: {company: 'Fabrikam', appliedAt: '2026-10-07T09:14:00.000Z', events: [['2026-10-07T09:14:00.000Z', 'applied']]},
    move: {from: null, to: 'applied', by_hand: false, at: '2026-10-07T09:14:00.000Z'}},
  {case: 'a rejection moves it from Applied', setup: {company: 'Fabrikam', appliedAt: '2026-10-01T09:00:00.000Z', status: 'rejected',
    events: [['2026-10-01T09:00:00.000Z', 'applied'], ['2026-10-06T17:00:00.000Z', 'rejection']]}, move: {from: 'applied', to: 'rejected', by_hand: false, at: '2026-10-06T17:00:00.000Z'}},
  {case: 'a second interview doesn\'t move it: the first did', setup: {company: 'Northwind', appliedAt: '2026-09-20T09:00:00.000Z', status: 'in_process',
    events: [['2026-09-20T09:00:00.000Z', 'applied'], ['2026-10-01T15:00:00.000Z', 'interview'], ['2026-10-07T14:00:00.000Z', 'interview']]},
    move: {from: 'applied', to: 'in_process', by_hand: false, at: '2026-10-01T15:00:00.000Z'}},
  {case: 'a quiet email is never a move', setup: {company: 'Contoso', appliedAt: '2026-10-02T09:00:00.000Z',
    events: [['2026-10-02T09:00:00.000Z', 'applied'], ['2026-10-05T09:00:00.000Z', 'verification']]}, move: {from: null, to: 'applied', by_hand: false, at: '2026-10-02T09:00:00.000Z'}},
  {case: 'a first email that isn\'t a confirmation comes from Applied', setup: {company: 'Relecloud', appliedAt: '2026-09-01T09:00:00.000Z', status: 'rejected',
    events: [['2026-09-10T09:00:00.000Z', 'rejection']]}, move: {from: 'applied', to: 'rejected', by_hand: false, at: '2026-09-10T09:00:00.000Z'}},
  {case: 'a hand move comes from what its emails had set', setup: {company: 'Woodgrove', appliedAt: '2026-09-01T09:00:00.000Z', status: 'withdrawn', hand: '2026-10-07T16:00:00.000Z',
    events: [['2026-09-01T09:00:00.000Z', 'applied'], ['2026-09-20T09:00:00.000Z', 'offer']]}, move: {from: 'offer', to: 'withdrawn', by_hand: true, at: '2026-10-07T16:00:00.000Z'}},
  {case: 'a hand move with no email that set a status comes from Applied', setup: {company: 'Tailspin', appliedAt: '2026-09-01T09:00:00.000Z', status: 'offer', hand: '2026-10-03T16:00:00.000Z'},
    move: {from: 'applied', to: 'offer', by_hand: true, at: '2026-10-03T16:00:00.000Z'}},
  {case: 'turning Ghosted, at the start of the day 30 days after the last email, quiet ones included', setup: {company: 'Lamna', appliedAt: '2026-08-20T09:00:00.000Z',
    events: [['2026-08-20T09:00:00.000Z', 'applied'], ['2026-08-25T20:00:00.000Z', 'account']]}, move: {from: 'applied', to: 'ghosted', by_hand: false, at: '2026-09-24T07:00:00.000Z'}},
])('$case', ({setup, move}) => {
  expect(moves([setup])).toEqual([{company: setup.company, ...move}]);
});

test('newest first, one per application, the last eight', () => {
  const setups = Array.from({length: MOVES_SHOWN + 2}, (_, index): Setup => {
    const at = `2026-10-0${Math.floor(index / 2) + 1}T${String(10 + (index % 2)).padStart(2, '0')}:00:00.000Z`;
    return {company: `Company ${index}`, appliedAt: at, events: [[at, 'applied']]};
  });
  const shown = moves(setups);
  expect(shown).toHaveLength(MOVES_SHOWN);
  expect(shown.map(move => move.company)).toEqual(Array.from({length: MOVES_SHOWN}, (_, index) => `Company ${MOVES_SHOWN + 1 - index}`));
});

test('the quiet line\'s facts: the accounts Jobs reads in its order, and its earliest email or Applied date', () => {
  const out = movement([
    {company: 'Fabrikam', appliedAt: '2026-03-04T09:00:00.000Z', events: [['2026-03-02T09:00:00.000Z', 'applied']]},
    {company: 'Contoso', appliedAt: '2026-05-01T09:00:00.000Z'},
  ], [4, 1]);
  expect({accounts: out.accounts, since: out.since}).toEqual({accounts: [4, 1], since: '2026-03-02T09:00:00.000Z'});
  expect(movement([])).toEqual({moves: [], accounts: [], since: null});
});
