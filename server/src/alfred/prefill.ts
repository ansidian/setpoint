// The prefill: Add to calendar and Add as task, opened from the Inbox reader, ask Claude Haiku 5.5
// to read the email and fill the proposal's fields. The reader shows the rules' proposal
// (POST /api/proposals/from-message) under skeletons while this runs, and takes this answer only if
// it comes within its cutoff.
//
// - One call, forced tool, thinking off, at most 400 output tokens. Haiku 5.5 answered in about 0.9 s
//   and within 1.5 s 98% of the time in a measured run on real mail. The call is cut at PREFILL_CALL_MS,
//   since nothing waits for it longer.
// - Every value is checked before it's used (src/domain/prefill.ts), and the answer goes through
//   proposeFromMessage's overrides, so the calendar and the project are matched against its title.
// - No call for an email with an invite, whose file states its fields exactly, and none without an
//   Anthropic key: the rules' proposal stands, and the reader says nothing.
// - The call stays out of the AI usage ledger: it costs a fraction of a cent.
//
// A dev run with the dev AI fake (SETPOINT_DEV_AI_URL) and its key stored asks the fake. No test or
// dev run reaches a real model.
import type {ItemKind, ProposalPrefillFailure, ProposalPrefillOut} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {bodyOf} from '../db/bodies.ts';
import * as t from '../db/schema.ts';
import {prefillOverrides} from '../domain/prefill.ts';
import type {PrefillAnswer} from '../domain/prefill.ts';
import {localDay, localTime} from '../domain/time.ts';
import {notFound, SetpointError} from '../errors.ts';
import {AI_ENDPOINTS, anthropicClient} from '../providers/ai/index.ts';
import type {AiEndpoints, ToolSpec} from '../providers/ai/index.ts';
import type {Store} from '../store.ts';
import type {SyncEngine} from '../sync/engine.ts';
import {ProviderError} from '../sync/errors.ts';
import {anthropicKey} from '../triage/models.ts';
import {inviteOf, proposeFromMessage} from './proposals.ts';

export const PREFILL_MODEL = 'claude-haiku-5-5';
export const PREFILL_MAX_OUTPUT_TOKENS = 400;
// The reader waits 1.5 s. The call may finish a little later and is still cut soon after.
const PREFILL_CALL_MS = 5000;
const BODY_MAX = 4000;

export interface PrefillOptions {
  endpoints?: AiEndpoints;
  timeoutMs?: number;
}

const RULES = `Use only what the email says. Leave a field null rather than guess.
The date is the day of the thing itself, never the day the email was sent. Resolve relative dates ("tomorrow", "next Friday") against Received.
Times are 24-hour HH:MM ("21:00", never "9:00 PM") in the user's time zone. Convert a time the email states in another zone.
The title is short, as the user would write it in their own calendar: no order, tracking, confirmation or verification numbers or codes.`;

export const PREFILL_SYSTEM: Record<ItemKind, string> = {
  event: `You read one email from the user's inbox and fill in the calendar event it is about. Answer only with the prefill_event tool.

${RULES}
The place is a physical place (an address, a venue, a room) or a meeting link. Never an application portal, signing, tracking or unsubscribe link.`,
  task: `You read one email from the user's inbox and fill in the to-do it asks of the user. Answer only with the prefill_task tool.

${RULES}
The title is an imperative ("Pay the March rent", "Sign the lease renewal"). The due date and time are when it must be done by.`,
};

const nullable = (description: string) => ({type: ['string', 'null'], description});

export const PREFILL_TOOLS: Record<ItemKind, ToolSpec> = {
  event: {
    name: 'prefill_event',
    description: 'The calendar event the email is about.',
    schema: {
      type: 'object', additionalProperties: false, required: ['title', 'date', 'start', 'end', 'place'],
      properties: {
        title: {type: 'string', description: 'A short title for the event.'},
        date: nullable('The event\'s day, YYYY-MM-DD.'),
        start: nullable('Its start, 24-hour HH:MM in the user\'s time zone.'),
        end: nullable('Its end, 24-hour HH:MM in the user\'s time zone.'),
        place: nullable('A physical place or a meeting link.'),
      },
    },
  },
  task: {
    name: 'prefill_task',
    description: 'The to-do the email asks of the user.',
    schema: {
      type: 'object', additionalProperties: false, required: ['title', 'due_date', 'due_time'],
      properties: {
        title: {type: 'string', description: 'A short imperative title.'},
        due_date: nullable('When it\'s due, YYYY-MM-DD.'),
        due_time: nullable('The time it\'s due, 24-hour HH:MM in the user\'s time zone.'),
      },
    },
  },
};

/** The email as the model reads it: when it came, who from, its subject and its text, blank runs collapsed and capped. */
export function prefillInput(email: {receivedAt: string; fromName: string; organisation: string | null; subject: string; bodyText: string}, timeZone: string): string {
  const day = localDay(email.receivedAt, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', {weekday: 'long', timeZone}).format(new Date(email.receivedAt));
  const from = email.organisation && email.organisation !== email.fromName ? `${email.fromName} (${email.organisation})` : email.fromName;
  const body = email.bodyText.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, BODY_MAX);
  return [`Received: ${weekday} ${day} ${localTime(email.receivedAt, timeZone)} (${timeZone})`, `From: ${from}`, `Subject: ${email.subject}`, '', body].join('\n');
}

const failed = (message: string, failure: ProposalPrefillFailure) => new SetpointError('prefill_failed', message, 502, failure);

/**
 * POST /api/proposals/prefill: the email's proposal filled by the model, or `skipped` when there's
 * no call to make (an invite, no key). A failed call is a 502 `prefill_failed` saying why, with
 * Anthropic's status when it refused.
 */
export async function prefillFromMessage(store: Store, engine: SyncEngine | null, messageId: number, kind: ItemKind, options: PrefillOptions = {}): Promise<ProposalPrefillOut> {
  const message = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!message || message.trashedAt) throw notFound('No such email.');
  if (await inviteOf(store, engine, messageId)) return {proposal: null, skipped: 'invite'};
  const apiKey = anthropicKey(store);
  if (!apiKey) return {proposal: null, skipped: 'no_key'};
  const client = anthropicClient({apiKey, baseUrl: (options.endpoints ?? AI_ENDPOINTS).anthropic, timeoutMs: options.timeoutMs ?? PREFILL_CALL_MS});
  const input = prefillInput({...message, bodyText: bodyOf(store.db, message.id).bodyText}, store.timeZone);
  let answer: PrefillAnswer | null;
  try {
    answer = (await client.call({model: PREFILL_MODEL, system: PREFILL_SYSTEM[kind], tool: PREFILL_TOOLS[kind], input, maxOutputTokens: PREFILL_MAX_OUTPUT_TOKENS})).toolInput;
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : null;
    throw failed(error instanceof Error ? error.message : String(error), {reason: status === null ? 'unreachable' : 'refused', status});
  }
  const overrides = answer ? prefillOverrides(kind, answer) : {};
  if (!overrides.title) throw failed('The model gave no usable title.', {reason: 'unusable', status: null});
  return {proposal: proposeFromMessage(store, messageId, kind, overrides), skipped: null};
}
