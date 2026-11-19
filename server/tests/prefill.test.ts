// The proposal prefill: one Claude Haiku 5.5 call reads the email and fills Add to calendar or Add as
// task. Every value is checked and a wrong one dropped, leaving the rules' value. No key, no call.
// A failure says why, with Anthropic's status. Nothing goes to the AI ledger.
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {PREFILL_MODEL, prefillInput} from '../src/alfred/prefill.ts';
import * as t from '../src/db/schema.ts';
import {checkedDate, checkedPlace, checkedTime, checkedTitle, prefillOverrides} from '../src/domain/prefill.ts';
import {setSecret} from '../src/secrets/store.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer} from './fakeModels.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

describe('the checks', () => {
  test.each<[unknown, string | null]>([
    ['2026-12-09', '2026-12-09'],
    [' 2026-02-28 ', '2026-02-28'],
    ['2026-02-30', null],
    ['2026-13-01', null],
    ['Dec 9, 2026', null],
    ['2026-12-9', null],
    [null, null],
    [20261209, null],
  ])('date %j → %j', (value, date) => {
    expect(checkedDate(value)).toBe(date);
  });

  test.each<[unknown, string | null]>([
    ['21:00', '21:00'],
    ['00:05', '00:05'],
    ['9:00 PM', null],
    ['9:00', null],
    ['24:00', null],
    ['12:60', null],
    [null, null],
  ])('time %j → %j', (value, time) => {
    expect(checkedTime(value)).toBe(time);
  });

  test.each<[unknown, string | null]>([
    ['  CS 101   final exam ', 'CS 101 final exam'],
    ['', null],
    ['x'.repeat(121), null],
    ['x'.repeat(120), 'x'.repeat(120)],
    [7, null],
  ])('title %j → %j', (value, title) => {
    expect(checkedTitle(value)).toBe(title);
  });

  test.each<[string, string | null]>([
    ['Room 214', 'Room 214'],
    ['2118 Sunset Blvd, Los Angeles', '2118 Sunset Blvd, Los Angeles'],
    ['https://contoso.zoom.us/j/123456', 'https://contoso.zoom.us/j/123456'],
    ['https://meet.google.com/abc-defg-hij', 'https://meet.google.com/abc-defg-hij'],
    ['Teams: https://teams.microsoft.com/l/meetup-join/1', 'Teams: https://teams.microsoft.com/l/meetup-join/1'],
    ['https://na3.docusign.net/Signing/EmailStart.aspx?a=1', null],
    ['https://careers.northwind.example/apply/8812', null],
    ['https://tools.usps.com/go/TrackConfirmAction?tLabels=9400', null],
    ['portal.parkside.com/sign', null],
    ['   ', null],
  ])('place %j → %j', (value, place) => {
    expect(checkedPlace(value)).toBe(place);
  });

  test.each<[string, 'event' | 'task', Record<string, unknown>, Record<string, unknown>]>([
    ['every field', 'event', {title: 'CS 101 final exam', date: '2026-12-09', start: '19:00', end: '21:00', place: 'Room 214'},
      {title: 'CS 101 final exam', date: '2026-12-09', start: '19:00', end: '21:00', place: 'Room 214'}],
    ['a date brings its own times, null clearing them', 'event', {title: 'Lease deadline', date: '2026-10-31', start: null, end: null, place: null},
      {title: 'Lease deadline', date: '2026-10-31', start: null, end: null}],
    ['a time with no date is dropped', 'event', {title: 'Exam', date: null, start: '19:00', end: '21:00', place: null}, {title: 'Exam'}],
    ['a 12-hour time is dropped, its end with it', 'event', {title: 'Exam', date: '2026-12-09', start: '7:00 PM', end: '21:00'}, {title: 'Exam', date: '2026-12-09', start: null, end: null}],
    ['a wrong date leaves the rules\' when', 'event', {title: 'Exam', date: 'Dec 9', start: '19:00'}, {title: 'Exam'}],
    ['a signing link isn\'t a place', 'event', {title: 'Sign the lease', place: 'https://na3.docusign.net/Signing/1'}, {title: 'Sign the lease'}],
    ['a task\'s due date and time', 'task', {title: 'Sign the lease renewal', due_date: '2026-10-31', due_time: '17:00'}, {title: 'Sign the lease renewal', date: '2026-10-31', start: '17:00', end: null}],
    ['a task has no place', 'task', {title: 'Pay rent', due_date: null, due_time: null, place: 'Room 1'}, {title: 'Pay rent'}],
    ['no title', 'event', {title: '  ', date: '2026-12-09'}, {date: '2026-12-09', start: null, end: null}],
  ])('%s', (_, kind, answer, overrides) => {
    expect(prefillOverrides(kind, answer)).toEqual(overrides);
  });
});

test('the email as the model reads it: when it came in the user\'s zone, who from, the subject and the text, blank runs collapsed and capped', () => {
  const input = prefillInput({receivedAt: '2026-10-05T17:05:00.000Z', fromName: 'Office of the Registrar', organisation: 'Contoso University', subject: 'Final exam schedule · CS 101',
    bodyText: `Hi there,\r\n\r\n\r\n\r\nExams below.   \n${'x'.repeat(5000)}`}, 'America/Los_Angeles');
  const [received, from, subject, blank, ...body] = input.split('\n');
  expect([received, from, subject, blank]).toEqual(['Received: Monday 2026-10-05 10:05 (America/Los_Angeles)', 'From: Office of the Registrar (Contoso University)', 'Subject: Final exam schedule · CS 101', '']);
  expect(body.slice(0, 3)).toEqual(['Hi there,', '', 'Exams below.']);
  expect(body.join('\n')).toHaveLength(4000);
});

const EXAM = 'Final exam schedule · CS 101';
const idOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;
const calendarId = (w: World, name: string) => w.store.db.select().from(t.calendars).where(eq(t.calendars.name, name)).get()!.id;

async function setup(answer: FakeAnswer, {key = true, timeoutMs}: {key?: boolean; timeoutMs?: number} = {}) {
  const fake = await fakeModels();
  fake.answer(() => answer);
  const w = world({seed: true});
  if (key) setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const c = await signedIn(w, {prefill: {endpoints: fake.endpoints, ...(timeoutMs ? {timeoutMs} : {})}});
  const prefill = (subject: string, kind = 'event') => c.send('POST', '/api/proposals/prefill', {body: {message_id: idOf(w, subject), kind}});
  const ledger = () => w.store.db.select().from(t.aiUsage).all();
  return {fake, w, c, prefill, ledger};
}

describe('POST /api/proposals/prefill', () => {
  test('Add to calendar takes the model\'s fields, the calendar matched against its title, and stays out of the ledger', async () => {
    const {fake, w, prefill, ledger} = await setup({tool: {title: 'CS 101 final exam', date: '2026-12-09', start: '19:00', end: '21:00', place: 'Room 214'}});
    const before = ledger().length;
    const response = await prefill(EXAM);
    expect(response).toMatchObject({status: 200, body: {skipped: null, proposal: {
      kind: 'event', message_id: idOf(w, EXAM), from_email: ['title', 'date', 'time', 'place'],
      item: {title: 'CS 101 final exam', calendar_id: calendarId(w, 'Classes'), starts_at: '2026-12-10T03:00:00.000Z', ends_at: '2026-12-10T05:00:00.000Z', place: 'Room 214'},
    }}});
    expect(fake.requests).toHaveLength(1);
    const [request] = fake.requests;
    expect(request!.body).toMatchObject({model: PREFILL_MODEL, max_tokens: 400, tool_choice: {type: 'tool', name: 'prefill_event'}, thinking: {type: 'disabled'}});
    expect(request!.input).toMatch(/^Received: Monday 2026-10-05 \d\d:\d\d \(America\/Los_Angeles\)\nFrom: .+\nSubject: Final exam schedule · CS 101\n\n/);
    expect(ledger()).toHaveLength(before);
  });

  test('Add as task: the due date and the project matched against the model\'s title', async () => {
    const {prefill} = await setup({tool: {title: 'Study for the CS 101 final', due_date: '2026-12-08', due_time: null}});
    expect(await prefill(EXAM, 'task')).toMatchObject({status: 200, body: {proposal: {kind: 'task', item: {title: 'Study for the CS 101 final', due_date: '2026-12-08', due_at: null, project: 'School'}}}});
  });

  test('a value in the wrong format leaves the rules\' value', async () => {
    const {prefill} = await setup({tool: {title: 'Lease renewal deadline', date: 'Oct 31', start: '9:00 PM', end: null, place: 'https://portal.parkside.example/sign/4B'}});
    expect(await prefill('Lease renewal terms')).toMatchObject({status: 200, body: {proposal: {item: {title: 'Lease renewal deadline', all_day: true, start_date: '2026-10-31', place: null}}}});
  });

  test('no key: no call, and the rules\' proposal stands', async () => {
    const {fake, prefill} = await setup({tool: {title: 'Unused'}}, {key: false});
    expect(await prefill(EXAM)).toEqual(expect.objectContaining({status: 200, body: {proposal: null, skipped: 'no_key'}}));
    expect(fake.requests).toHaveLength(0);
  });

  test.each<[string, FakeAnswer, Record<string, unknown>]>([
    ['overloaded', 'overloaded', {reason: 'refused', status: 529}],
    ['rate limited', 'rate_limited', {reason: 'refused', status: 429}],
    ['refusing the key', {status: 401, body: {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}}}, {reason: 'refused', status: 401}],
    ['no tool call', 'no_tool', {reason: 'unusable', status: null}],
    ['no usable title', {tool: {title: '', date: '2026-12-09'}}, {reason: 'unusable', status: null}],
    ['no answer in time', 'hang', {reason: 'unreachable', status: null}],
  ])('a failure says why: %s', async (_, answer, details) => {
    const {prefill, ledger} = await setup(answer, {timeoutMs: 200});
    const before = ledger().length;
    expect(await prefill(EXAM)).toMatchObject({status: 502, body: {error: {code: 'prefill_failed', details}}});
    expect(ledger()).toHaveLength(before);
  });

  test('an email that isn\'t there', async () => {
    const {c} = await setup({tool: {title: 'Unused'}});
    expect((await c.send('POST', '/api/proposals/prefill', {body: {message_id: 9999, kind: 'event'}})).status).toBe(404);
  });
});
