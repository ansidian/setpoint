// The service worker's answer (SV-174): Setpoint's checked against jobsCheckSchema, so an answer
// this build can't read says so on the pane rather than drawing wrong chips.
import {expect, test} from 'vitest';
import {replyOf} from '../src/reply.ts';

const ORIGIN = 'https://setpoint.example';
const application = {id: 12, company: 'Fabrikam', title: 'Software Engineer I', applied_on: '2026-10-28', status: 'in_process', status_on: '2026-11-01', ghosted: false};
const answered = {enabled: true, postings: [{role: [application], others: [], query: 'fabrikam'}, {role: [], others: [], query: null}]};

test.each([
  {was: 'an answer for each posting', status: 200, body: answered, expected: {ok: true, origin: ORIGIN, data: answered}},
  {was: 'Jobs off', status: 200, body: {enabled: false, postings: [{role: [], others: [], query: null}, {role: [], others: [], query: null}]}, expected: {ok: true}},
  {was: 'the token refused', status: 401, body: {error: 'unauthorized'}, expected: {ok: false, reason: 'token'}},
  {was: 'Setpoint failing', status: 502, body: undefined, expected: {ok: false, reason: 'unreachable', detail: 'HTTP 502'}},
  {was: 'an answer that isn\'t JSON', status: 200, body: undefined, expected: {ok: false, reason: 'answer'}},
  {was: 'an application missing a key', status: 200, body: {enabled: true, postings: [{role: [{...application, ghosted: undefined}], others: [], query: 'fabrikam'}, {role: [], others: [], query: null}]}, expected: {ok: false, reason: 'answer'}},
  {was: 'a status this build doesn\'t know', status: 200, body: {enabled: true, postings: [{role: [{...application, status: 'interviewing'}], others: [], query: 'fabrikam'}, {role: [], others: [], query: null}]}, expected: {ok: false, reason: 'answer'}},
  {was: 'an answer for fewer postings than were asked', status: 200, body: {enabled: true, postings: [answered.postings[0]]}, expected: {ok: false, reason: 'answer', detail: '1 answer for 2 postings'}},
])('$was', ({status, body, expected}) => {
  expect(replyOf(status, body, 2, ORIGIN)).toMatchObject(expected);
});
