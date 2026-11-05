// What the service worker answers a check with (SV-174): Setpoint's answer once it has been checked
// against jobsCheckSchema from @setpoint/shared, so an answer this build can't read says so on the
// pane rather than drawing wrong chips; or why there's none.
import {jobsCheckSchema} from '@setpoint/shared';
import type {JobsCheckOut} from '@setpoint/shared';
import type {BoardName} from './boards.ts';
import type {Unread} from './posting.ts';
import type {Failure} from './words.ts';

/** A posting as the route takes it: its company and title as the board shows them. */
export interface Asked {
  company: string;
  title: string;
}

/** What a board's page and the options page send the service worker. */
export type Message =
  | {type: 'check'; postings: Asked[]}
  | {type: 'options'}
  | {type: 'page'; board: BoardName; unread: Unread | null};

/** The service worker's answer to a check: Setpoint's, for the postings in the order asked, or why there's none. */
export type CheckReply = {ok: true; origin: string; data: JobsCheckOut} | {ok: false; reason: Failure; detail?: string};

/** Setpoint's answer to `asked` postings, from its HTTP status and its body (undefined when it wasn't JSON). */
export function replyOf(status: number, body: unknown, asked: number, origin: string): CheckReply {
  if (status === 401) return {ok: false, reason: 'token'};
  if (status < 200 || status > 299) return {ok: false, reason: 'unreachable', detail: `HTTP ${status}`};
  const answer = jobsCheckSchema.safeParse(body);
  if (!answer.success) return {ok: false, reason: 'answer', detail: answer.error.issues[0]?.message};
  // An answer for other postings than were asked can't be laid over them.
  const count = answer.data.postings.length;
  if (count !== asked) return {ok: false, reason: 'answer', detail: `${count} ${count === 1 ? 'answer' : 'answers'} for ${asked} postings`};
  return {ok: true, origin, data: answer.data};
}
