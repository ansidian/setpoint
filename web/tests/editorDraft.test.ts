// The editor's drafts from Alfred's proposals: what he set beyond the title, day, times and place
// fills the fields and carries his mark, Create sends it, his repeat isn't read away by the line,
// and a change marks each field it changes.
import type {ItemOut, ProposalOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {changesOf, createInput, emptyDraft, fromChange, fromItem, fromProposal, retype} from '../src/logic/editorDraft.ts';

const zone = SEED_TIME_ZONE;
const DENTIST: ProposalOut = {
  kind: 'event', message_id: null, from_email: [], conflict: null, alfred: ['repeat', 'reminders', 'leave_reminder', 'calendar', 'colour', 'description'],
  item: {
    kind: 'event', calendar_id: 3, title: 'Dentist', all_day: false, starts_at: '2026-10-13T22:00:00.000Z', ends_at: '2026-10-13T23:00:00.000Z', start_date: null, end_date: null,
    due_date: null, due_at: null, time_zone: zone, place: 'Bright Smile', project: null,
    reminders: [30], leave_reminder: true, colour: 'alert', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU', description: 'Bring the insurance card',
  },
};
const open = (proposal: ProposalOut) => fromProposal(emptyDraft(proposal.kind, '2026-10-07'), {proposal, reminders: null, newProject: false}, zone);

describe('fromProposal: what Alfred set', () => {
  test('fills the fields and marks them as his, and Create sends them', () => {
    const draft = open(DENTIST);
    expect(draft).toMatchObject({calendarId: 3, reminders: [30], leaveReminder: true, colour: 'alert', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU', fromEmail: []});
    expect(draft.fromAlfred).toEqual(['reminders', 'calendar', 'colour', 'repeat', 'description']);
    expect(createInput(draft, zone, 9)).toMatchObject({calendar_id: 3, reminders: [30], leave_reminder: true, colour: 'alert', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU', description: 'Bring the insurance card'});
  });

  test('his repeat stays when the line is typed into', () => {
    const draft = open(DENTIST);
    expect(retype(draft, 'Dentist visit', '2026-10-07', [], [], 9 * 60).recurrence).toBe('RRULE:FREQ=WEEKLY;BYDAY=TU');
  });

  test('a task takes its repeat, reminders and description, and has no colour', () => {
    const task: ProposalOut = {
      kind: 'task', message_id: null, from_email: [], conflict: null, alfred: ['repeat', 'reminders', 'description'],
      item: {...DENTIST.item, kind: 'task', calendar_id: 9, starts_at: null, ends_at: null, due_date: '2026-10-09', recurrence: undefined, repeat: 'every fri', reminders: [0], description: 'The ferns too', colour: undefined, leave_reminder: undefined, place: null},
    };
    expect(createInput(open(task), zone, 9)).toMatchObject({repeat: 'every fri', reminders: [0], description: 'The ferns too', colour: null, leave_reminder: false});
  });

  test('an event over several days opens over them, its last day marked as his', () => {
    const conference: ProposalOut = {...DENTIST, alfred: ['days'], item: {...DENTIST.item, all_day: true, starts_at: null, ends_at: null, start_date: '2026-10-20', end_date: '2026-10-23', reminders: undefined, colour: undefined, recurrence: undefined, leave_reminder: undefined, description: undefined}};
    const draft = open(conference);
    expect(draft).toMatchObject({date: '2026-10-20', days: 3, start: null, reminders: null, colour: null});
    expect(draft.fromAlfred).toEqual(['date', 'time']);
  });

  test('an email\'s proposal keeps its From: line first, with his description after it', () => {
    const fromEmail: ProposalOut = {...DENTIST, message_id: 4, from_email: ['title'], source: {subject: 'Your appointment', url: null}, alfred: ['description']};
    const draft = open(fromEmail);
    // The description is his once he adds to it: one mark, his.
    expect(draft.fromEmail).toEqual(['title']);
    expect(draft.fromAlfred).toEqual(['description']);
    expect(createInput(draft, zone, 9)!.description).toBe('From: Your appointment<br>Bring the insurance card');
  });
});

describe('fromChange: each field he changes is marked, and Save sends it', () => {
  const dinner = {
    key: '5', id: 5, kind: 'event', calendar_id: 2, title: 'Dinner with Sam', all_day: false, starts_at: '2026-10-10T02:00:00.000Z', ends_at: '2026-10-10T04:00:00.000Z', start_date: null, end_date: null,
    due_date: null, due_at: null, time_zone: zone, recurring: false, recurrence: null, occurrence_start: null, place: 'Blue Door', address: null, attendees: [], reminders: [10], leave_reminder: false,
    project: null, colour: null, labels: [], repeat: null, description: null, done: false, done_at: null, can_reopen: false, command: null, read_only: false, due_string: null, time_to_leave: null,
    link: null, transparency: 'opaque', subtasks: [], parent_id: null,
  } as ItemOut;
  test.each<[string, Record<string, unknown>, string[]]>([
    ['reminders', {reminders: [60]}, ['reminders']],
    ['Time to Leave', {leave_reminder: true}, ['reminders']],
    ['the calendar', {calendar_id: 3}, ['calendar']],
    ['the colour', {colour: 'good'}, ['colour']],
    ['the repeat', {recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=FR'}, ['repeat']],
    ['the description', {description: 'Book a table'}, ['description']],
  ])('%s', (_name, changes, marks) => {
    const draft = fromChange({item: dinner, changes, scope: 'this'}, zone);
    expect(draft.fromAlfred).toEqual(marks);
    expect(draft.fromEmail).toEqual([]);
    expect(changesOf(draft, fromItem(dinner, zone), zone)).toMatchObject(changes);
  });
});
