// A conversation's own summary, for the reader's head: written on Claude Haiku 5.5 after triage sorts
// an email of a conversation of two or more emails it summed up, from each email's date, sender and
// triage summary (never the bodies). Its call goes in the AI usage ledger as its own purpose, only
// while triage is healthy and the Anthropic key is set. A call that fails or answers without the
// tool stores nothing, leaves triage's health alone, and the head shows the row's summary meanwhile.
import {and, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {summaryEmails, summaryState} from '../domain/conversationSummary.ts';
import type {SummaryState} from '../domain/conversationSummary.ts';
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
}

function threadEmails(store: Store, accountId: number, threadId: string): ThreadRow[] {
  return store.db.select({
    id: t.messages.id, receivedAt: t.messages.receivedAt, received: t.messages.received, sent: t.messages.sent, lane: t.messages.lane,
    trashedAt: t.messages.trashedAt, uspsDigest: t.messages.uspsDigest, summary: t.messages.summary,
    fromName: t.messages.fromName, fromAddress: t.messages.fromAddress, subject: t.messages.subject,
  }).from(t.messages).where(and(eq(t.messages.accountId, accountId), eq(t.messages.threadId, threadId))).all()
    .map(({lane, trashedAt, ...email}) => ({...email, sorted: lane !== null, trashed: trashedAt !== null}));
}

function stored(store: Store, accountId: number, threadId: string) {
  return store.db.select().from(t.conversationSummaries)
    .where(and(eq(t.conversationSummaries.accountId, accountId), eq(t.conversationSummaries.threadId, threadId))).get();
}

/** A conversation's summary when it's fresh, else null (one email, none written, or a newer email since). */
export function conversationSummary(store: Store, accountId: number, threadId: string): string | null {
  const row = stored(store, accountId, threadId);
  if (!row) return null;
  return summaryState(threadEmails(store, accountId, threadId), row.messageId) === 'fresh' ? row.summary : null;
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
  const state = summaryState(emails, stored(store, message.accountId, message.threadId)?.messageId ?? null);
  if (state !== 'due') return {state, written: false};
  const apiKey = anthropicKey(store);
  if (!apiKey || triageStatus(store).state === 'down') return {state, written: false};
  const lines = summaryEmails(emails);
  const newest = lines.at(-1)!;
  const subject = [...emails].sort((a, b) => (a.receivedAt < b.receivedAt || (a.receivedAt === b.receivedAt && a.id < b.id) ? -1 : 1))[0]!.subject;
  const client: ModelClient = anthropicClient({apiKey, baseUrl: endpoints.anthropic, timeoutMs});
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
    return {state, written: false};
  }
  if (!summary) return {state, written: false};
  const values = {accountId: message.accountId, threadId: message.threadId, summary, messageId: newest.id, at: isoNow(store)};
  store.db.insert(t.conversationSummaries).values(values)
    .onConflictDoUpdate({target: [t.conversationSummaries.accountId, t.conversationSummaries.threadId], set: {summary, messageId: newest.id, at: values.at}}).run();
  noteLive(store, {type: 'mail', messages: lines.map(email => email.id), accounts: [], commands: []});
  return {state, written: true};
}
