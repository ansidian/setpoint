// A conversation's own summary, for the reader's head: written on Claude Haiku 5.5 after triage sorts
// an email of a conversation of two or more emails it summed up, from each email's date, sender and
// triage summary (never the bodies). Its call goes in the AI usage ledger as its own purpose, only
// while triage is healthy and the Anthropic key is set. A call that fails or answers without the
// tool keeps the summary there was, stores why beside it (for the newest email), and leaves
// triage's health alone. Either way the reader's open conversation hears of it (a live event), so
// its head's skeleton gives way to the words or to the newest email's own summary.
import type {ConversationSummaryOut} from '@setpoint/shared';
import {and, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {failureOf, headSummary, summaryEmails, summaryState} from '../domain/conversationSummary.ts';
import type {StoredSummary, SummaryFailure, SummaryState} from '../domain/conversationSummary.ts';
import {asProviderError} from '../sync/errors.ts';
import {anthropicClient} from '../providers/ai/index.ts';
import type {AiEndpoints, ModelClient, ToolSpec} from '../providers/ai/index.ts';
import {isoNow, noteLive} from '../store.ts';
import type {Store} from '../store.ts';
import {triageStatus} from './health.ts';
import {anthropicKey} from './models.ts';
import {recordUsage} from './worker.ts';

export const CONVERSATION_MODEL = 'claude-haiku-5-5';

const MAX_OUTPUT_TOKENS = 200;
const SUMMARY_LIMIT = 140;

export const CONVERSATION_SYSTEM = `You sum up one email conversation for the user's personal inbox. Answer only with the submit_conversation_summary tool.

You get the subject, then one line per email, oldest first: its date, its sender ("You" for the user), and a one-line summary of that email.

summary: one line, under 100 characters, shown under the subject when the conversation is open: who asked what and where it stands now, with its decisive fact (an amount, a date, a status, who is waiting on whom). Only what the lines say; never guess or round. Leave out filler like "This conversation…" or "The thread…".`;

export const CONVERSATION_TOOL: ToolSpec = {
  name: 'submit_conversation_summary',
  description: 'Submit the one-line summary of the conversation.',
  schema: {type: 'object', properties: {summary: {type: 'string'}}, required: ['summary']},
};

interface ThreadRow {
  id: number;
  receivedAt: string;
  received: boolean;
  sent: boolean;
  sorted: boolean;
  trashed: boolean;
  uspsDigest: boolean;
  summary: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  triagedAt: string | null;
}

function threadEmails(store: Store, accountId: number, threadId: string): ThreadRow[] {
  return store.db.select({
    id: t.messages.id, receivedAt: t.messages.receivedAt, received: t.messages.received, sent: t.messages.sent, lane: t.messages.lane,
    trashedAt: t.messages.trashedAt, uspsDigest: t.messages.uspsDigest, summary: t.messages.summary,
    fromName: t.messages.fromName, fromAddress: t.messages.fromAddress, subject: t.messages.subject, triagedAt: t.messages.triagedAt,
  }).from(t.messages).where(and(eq(t.messages.accountId, accountId), eq(t.messages.threadId, threadId))).all()
    .map(({lane, trashedAt, ...email}) => ({...email, sorted: lane !== null, trashed: trashedAt !== null}));
}

function stored(store: Store, accountId: number, threadId: string): StoredSummary | null {
  const row = store.db.select().from(t.conversationSummaries)
    .where(and(eq(t.conversationSummaries.accountId, accountId), eq(t.conversationSummaries.threadId, threadId))).get();
  if (!row) return null;
  const failure = row.failedMessageId !== null && row.failureCause !== null ? {messageId: row.failedMessageId, cause: row.failureCause, status: row.failureStatus} : null;
  return {summary: row.summary, coveredId: row.summary === null ? null : row.messageId, failure};
}

/** What the reader's head shows for a conversation (src/domain/conversationSummary.ts), null when its row's summary stands. */
export function conversationSummary(store: Store, accountId: number, threadId: string): ConversationSummaryOut | null {
  return headSummary(threadEmails(store, accountId, threadId), stored(store, accountId, threadId), {
    triageDown: triageStatus(store).state === 'down',
    // Triage has no AI budget of its own yet.
    budgetSpent: false,
    now: isoNow(store),
  });
}

/** Keeps why the call for the conversation's newest email failed, beside the summary there was. */
function storeFailure(store: Store, accountId: number, threadId: string, messageId: number, failure: SummaryFailure) {
  const set = {failedMessageId: messageId, failureCause: failure.cause, failureStatus: failure.status, at: isoNow(store)};
  store.db.insert(t.conversationSummaries).values({accountId, threadId, summary: null, messageId: null, ...set})
    .onConflictDoUpdate({target: [t.conversationSummaries.accountId, t.conversationSummaries.threadId], set}).run();
}

/** What the model reads: the subject, then one line per email, oldest first. */
export function conversationInput(subject: string, emails: Pick<ThreadRow, 'receivedAt' | 'sent' | 'fromName' | 'fromAddress' | 'summary'>[]): string {
  return [
    `Subject: ${subject}`,
    '',
    ...emails.map(email => `${email.receivedAt} · ${email.sent ? 'You' : email.fromName || email.fromAddress} · ${email.summary}`),
  ].join('\n');
}

const clip = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > SUMMARY_LIMIT ? `${clean.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : clean;
};

export interface ConversationWriterOptions {
  endpoints: AiEndpoints;
  timeoutMs?: number;
}

/**
 * After triage sorted `messageId`: writes its conversation's summary when one is due. Returns what
 * the rule said, and whether a summary was stored. Never throws.
 */
export async function writeConversationSummary(store: Store, messageId: number, {endpoints, timeoutMs}: ConversationWriterOptions, signal?: AbortSignal): Promise<{state: SummaryState; written: boolean}> {
  const message = store.db.select({accountId: t.messages.accountId, threadId: t.messages.threadId}).from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!message) return {state: 'none', written: false};
  const emails = threadEmails(store, message.accountId, message.threadId);
  const state = summaryState(emails, stored(store, message.accountId, message.threadId)?.coveredId ?? null);
  if (state !== 'due') return {state, written: false};
  const apiKey = anthropicKey(store);
  if (!apiKey || triageStatus(store).state === 'down') return {state, written: false};
  const lines = summaryEmails(emails);
  const newest = lines.at(-1)!;
  const subject = [...emails].sort((a, b) => (a.receivedAt < b.receivedAt || (a.receivedAt === b.receivedAt && a.id < b.id) ? -1 : 1))[0]!.subject;
  const client: ModelClient = anthropicClient({apiKey, baseUrl: endpoints.anthropic, timeoutMs});
  // The open conversation refreshes on any of its emails' ids, whichever it was opened at.
  const heard = () => noteLive(store, {type: 'mail', messages: lines.map(email => email.id), accounts: [], commands: [], conversations: emails.map(email => email.id)});
  let summary: string | null;
  try {
    const answer = await client.call({
      model: CONVERSATION_MODEL, system: CONVERSATION_SYSTEM, tool: CONVERSATION_TOOL, input: conversationInput(subject, lines),
      maxOutputTokens: MAX_OUTPUT_TOKENS, signal,
    });
    recordUsage(store, answer, newest.id, 'mail_conversations');
    summary = clip(answer.toolInput?.summary);
  } catch (error) {
    console.error(`Conversation summary after email ${messageId}`, error);
    // Setpoint stopping isn't a failure of the call.
    if (signal?.aborted) return {state, written: false};
    storeFailure(store, message.accountId, message.threadId, newest.id, failureOf(asProviderError(error).status));
    heard();
    return {state, written: false};
  }
  if (!summary) {
    storeFailure(store, message.accountId, message.threadId, newest.id, {cause: 'unusable', status: null});
    heard();
    return {state, written: false};
  }
  const set = {summary, messageId: newest.id, at: isoNow(store), failedMessageId: null, failureCause: null, failureStatus: null};
  store.db.insert(t.conversationSummaries).values({accountId: message.accountId, threadId: message.threadId, ...set})
    .onConflictDoUpdate({target: [t.conversationSummaries.accountId, t.conversationSummaries.threadId], set}).run();
  heard();
  return {state, written: true};
}
