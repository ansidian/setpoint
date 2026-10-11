// What triage asks a model and how it reads the answer (BRIEF.md › Triage). v1's
// `triage-model-client` tool schema (harvested, SV-4) asked for a lane, a category, urgency, a
// badge, a summary, an action, a deadline and a confidence; v2's asks for what the record keeps:
// lane, kind, organisation (and the platform it came via), type, key date, summary, security facts,
// the protected class and a confidence. The answer is read leniently field by field: a field that
// doesn't fit is dropped, and only a missing or unknown lane makes the whole answer unusable
// (unsure, so FYI unless the strong model is sure).
import {KINDS, LANES, MESSAGE_TYPES, PROTECTED_REASONS, securityFactsSchema} from '@setpoint/shared';
import type {Kind, Lane, MessageType, ProtectedReason, SecurityFacts} from '@setpoint/shared';
import type {Reading} from '../domain/triagePolicy.ts';
import type {ToolSpec} from '../providers/ai/index.ts';

/** Bumped when the prompt or tool changes, so OpenAI's prompt cache starts over. */
export const PROMPT_VERSION = 'v3';

/** v1's evidence bound: a longer body is cut, and what was cut can't make the email Noise. */
export const EVIDENCE_LIMIT = 20_000;

export const MAX_OUTPUT_TOKENS = {anthropic: 1400, openai: 1600} as const;

export const TRIAGE_SYSTEM = `You sort one email for the user's personal inbox. Answer only with the submit_email_triage tool.

Lane:
- attention: the user has to act or decide, and something real happens if they don't: a person waiting for their reply, an interview or appointment to arrange, a deadline they must meet, a problem with an account, money or a service. Attention is a queue they must clear, so be strict.
- fyi: worth knowing, nothing to do: confirmations, receipts, statements, shipping and delivery, routine account and security notices they caused themselves, autopay notices, application updates, mail from people that needs no reply.
Bills: the user's bills are paid or tracked without them (autopay, or a budget that schedules each bill's amount and date from its email), so a new bill, invoice, statement or payment reminder is fyi with kind money, even with a due date or a pay button. It is attention only when something has gone wrong: a payment failed or was declined, the account is past due or in collections, service will be cut off, or autopay was turned off.
- noise: marketing, promotions, sales, newsletters and digests, surveys, social notifications.
Optional actions (review, track, consider, read if interested) don't make an email attention. When unsure between attention and fyi, answer fyi with a low confidence.

kind (the FYI group; null for noise): deliveries, money, career (job applications, recruiters, interviews), security, updates (accounts, services, school, products), people (written by an actual person to the user), other.

organisation: who the email is really from, as a person would say it: "Northwind", not "greenhouse.io" or "Workday". When it came through a platform (Greenhouse, Workday, Lever, a store's payment or shipping service), put the platform in via.

type: confirmation, rejection, receipt, shipping, deadline, reminder, verification_code, alert, newsletter, statement, or null.

key_date: the one date that matters (an interview, a due date, an event) as YYYY-MM-DD, or null. Autopay dates, statement dates and offer expiries are not key dates.

summary: one line, under 80 characters, shown in the list in place of the subject, so it must stand on its own: what the email is about and its decisive fact (an amount, a date, a status, who is waiting on the user). Only what the email says; never guess or round. Leave out the sender (the row shows it) and filler like "This email…" or "You have…".

security (security mail only, otherwise null): what happened in two or three words ("New sign-in", "Access granted", "Password changed"), the device, the location, the app given access, and unfamiliar: true only when the email itself says the device or place is new or unrecognised.

protected_class: only when the email reports one of these, otherwise null:
- password_changed, recovery_changed, two_step_changed: the change has already happened (not a link to make one).
- account_deleted, account_locked.
- critical_alert: the sender calls it critical.
- unfamiliar_sign_in: a sign-in or attempt from a device or place the email calls new or unrecognised, asking whether it was the user.
- money_leaving: money left one of the user's accounts and the email doesn't show they did it themselves (a withdrawal, a transfer out, a charge they must check); never a receipt for their own payment or purchase.
A verification code email is never protected.

confidence: from 0 to 1, how sure you are of the lane.`;

const nullable = (schema: Record<string, unknown>) => ({anyOf: [schema, {type: 'null'}]});

export const TRIAGE_TOOL: ToolSpec = {
  name: 'submit_email_triage',
  description: 'Submit how one email is sorted and what it says.',
  schema: {
    type: 'object',
    properties: {
      lane: {type: 'string', enum: [...LANES]},
      kind: nullable({type: 'string', enum: [...KINDS]}),
      organisation: nullable({type: 'string'}),
      via: nullable({type: 'string'}),
      type: nullable({type: 'string', enum: [...MESSAGE_TYPES]}),
      key_date: nullable({type: 'string', description: 'YYYY-MM-DD'}),
      summary: nullable({type: 'string'}),
      security: nullable({
        type: 'object',
        properties: {what: {type: 'string'}, device: {type: 'string'}, location: {type: 'string'}, app: {type: 'string'}, unfamiliar: {type: 'boolean'}},
        required: ['what'],
      }),
      protected_class: nullable({type: 'string', enum: [...PROTECTED_REASONS]}),
      confidence: {type: 'number', minimum: 0, maximum: 1},
    },
    required: ['lane', 'kind', 'organisation', 'via', 'type', 'key_date', 'summary', 'security', 'protected_class', 'confidence'],
  },
};

export interface PromptEmail {
  accountLabel: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  snippet: string;
}

/** The email as the model reads it, and whether its body was cut short. */
export function promptInput(email: PromptEmail): {input: string; incomplete: boolean} {
  const body = email.bodyText.trim() || email.snippet.trim();
  const incomplete = body.length > EVIDENCE_LIMIT;
  return {
    incomplete,
    input: [
      ...(email.accountLabel ? [`Account: ${email.accountLabel}`] : []),
      `From: ${email.fromName} <${email.fromAddress}>`,
      `Subject: ${email.subject}`,
      `Date: ${email.receivedAt}`,
      '',
      'Body:',
      incomplete ? `${body.slice(0, EVIDENCE_LIMIT)}\n\n[The body was cut short here; the rest wasn't sent.]` : body,
    ].join('\n'),
  };
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || /^(null|none|n\/a|unknown)$/i.test(clean)) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : null;

/** v1's normaliser: older lane names map to Attention. */
function laneOf(value: unknown): Lane | null {
  if (value === 'needs_attention' || value === 'actionable') return 'attention';
  return oneOf(LANES, value);
}

function keyDateOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())?.[1];
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

function securityOf(value: unknown): SecurityFacts | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const facts = Object.fromEntries(Object.entries({
    what: text(raw.what, 60), device: text(raw.device, 60), location: text(raw.location, 60), app: text(raw.app, 60),
    unfamiliar: typeof raw.unfamiliar === 'boolean' ? raw.unfamiliar : undefined,
  }).filter(([, field]) => field !== null && field !== undefined));
  const parsed = securityFactsSchema.safeParse(facts);
  return parsed.success ? parsed.data : null;
}

/** The tool's input as a Reading, or null when it has no usable lane (unsure). */
export function readingOf(input: Record<string, unknown> | null): Reading | null {
  if (!input) return null;
  const lane = laneOf(input.lane);
  if (!lane) return null;
  const organisation = text(input.organisation, 120);
  const via = text(input.via, 80);
  const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? Math.min(1, Math.max(0, input.confidence)) : null;
  return {
    lane,
    kind: lane === 'noise' ? null : oneOf<Kind>(KINDS, input.kind),
    organisation,
    via: via && via.toLowerCase() !== organisation?.toLowerCase() ? via : null,
    type: oneOf<MessageType>(MESSAGE_TYPES, input.type),
    keyDate: keyDateOf(input.key_date),
    summary: text(input.summary, 140),
    security: securityOf(input.security),
    protectedClaim: oneOf<ProtectedReason>(PROTECTED_REASONS, input.protected_class),
    confidence,
  };
}
