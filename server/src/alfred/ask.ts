// Alfred (BRIEF.md › Alfred; DESIGN.md › Alfred's Answer card): a question, answered by a model that
// uses Setpoint's own queries as tools, with the emails the answer rests on as its sources, and
// follow-up turns in a short thread held here by id. "Ask about this email" scopes a thread to one
// email. When the mail doesn't say, the answer is null and `searched` says what Alfred searched
// ("Couldn't find that in your mail"). Anything Alfred would create is a proposal.
//
// Every model call goes in the AI usage ledger (purpose `alfred`). A failed call saves nothing: the
// thread stays as it was before the question, so asking again works.
//
// Harvested from v1's `alfred-run` and `alfred-conversations` (SV-5): the tool loop with a step limit,
// one reminder when a turn ends without the expected tool call, the provider and model bound when the
// thread starts, the transcript restored on failure, and threads that end after four idle hours.
import type {AnswerOut, AnswerSourceOut, AskStep, ConversationOut, EmphasisOut, ProposalOut} from '@setpoint/shared';
import {asc, eq, inArray, lt} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {costMicros} from '../domain/aiCost.ts';
import {localDay, localTime} from '../domain/time.ts';
import {notFound, SetpointError} from '../errors.ts';
import {AI_ENDPOINTS, conversationClient} from '../providers/ai/index.ts';
import type {AiEndpoints, ConverseTurn, ToolResult} from '../providers/ai/index.ts';
import {getSettings} from '../settings.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {ProviderError} from '../sync/errors.ts';
import {aiKeys, keyOf} from '../triage/models.ts';
import {chooseAlfredModel} from './models.ts';
import {ALFRED_TOOLS, alfredSystem, ANSWER_NUDGE, fenced, MAX_OUTPUT_TOKENS, PROMPT_VERSION} from './prompt.ts';
import {runTool} from './tools.ts';
import type {ToolContext} from './tools.ts';

export interface AlfredOptions {
  // The providers' base URLs; tests point them at a fake on 127.0.0.1.
  endpoints?: AiEndpoints;
  timeoutMs?: number;
}

/** Model turns per question before Alfred gives up (v1 allowed 12 tool rounds). */
const MAX_STEPS = 10;
/** A thread ends after this long idle (v1's four hours); a follow-up then starts over. */
const THREAD_IDLE_MS = 4 * 60 * 60_000;
/** Threads are kept a week, then deleted. */
const THREAD_KEPT_MS = 7 * 24 * 60 * 60_000;

// What each question in flight is doing, by the page's ask id, while the page waits on its answer.
const inFlight = new WeakMap<Store, Map<string, AskStep | null>>();

function stepsOf(store: Store): Map<string, AskStep | null> {
  let steps = inFlight.get(store);
  if (!steps) inFlight.set(store, (steps = new Map()));
  return steps;
}

/** GET /api/alfred/asks/:id: the tool Alfred last ran for that question; nothing before or after. */
export const alfredStep = (store: Store, askId: string): AskStep | null => stepsOf(store).get(askId) ?? null;

/** A tool call as a step the card can say: what's searched, whose email is read. */
function stepOf(store: Store, name: string, input: Record<string, unknown> | null): AskStep | null {
  if (name === 'search_mail' && typeof input?.query === 'string') return {tool: 'search_mail', query: input.query};
  if (name === 'get_email') {
    const id = Number(input?.message_id);
    const row = Number.isSafeInteger(id) ? store.db.select({organisation: t.messages.organisation, fromName: t.messages.fromName}).from(t.messages).where(eq(t.messages.id, id)).get() : undefined;
    return row ? {tool: 'get_email', from: row.organisation ?? row.fromName} : null;
  }
  if (name === 'list_items') return {tool: 'list_items'};
  if (name === 'propose_item' && (input?.kind === 'event' || input?.kind === 'task')) return {tool: 'propose_item', kind: input.kind};
  return null;
}

type Conversation = typeof t.alfredConversations.$inferSelect;
type Turn = typeof t.alfredTurns.$inferSelect;

const BODY_LIMIT = 20_000;

/** The email Ask about this email attaches to the thread's first question. */
function aboutEmail(store: Store, messageId: number, question: string): string {
  const row = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get()!;
  const account = store.db.select({label: t.accounts.label}).from(t.accounts).where(eq(t.accounts.id, row.accountId)).get();
  const body = row.bodyText.length > BODY_LIMIT ? `${row.bodyText.slice(0, BODY_LIMIT)}\n[…the rest of this email was cut]` : row.bodyText;
  return [
    `The user is reading this email (message_id ${row.id}, ${account?.label ?? 'an account'}, ${localDay(row.receivedAt, store.timeZone)} ${localTime(row.receivedAt, store.timeZone)}) and asks about it.`,
    fenced(row.id, [`From: ${row.fromName} <${row.fromAddress}>${row.organisation ? ` (${row.organisation})` : ''}`, `Subject: ${row.subject}`, `Key date: ${row.keyDate ?? 'none'}`, '', body].join('\n')),
    `The user's question: ${question}`,
  ].join('\n\n');
}

/** Each phrase's first place in the text, for bold runs. */
function emphasisOf(text: string, phrases: string[]): EmphasisOut[] {
  const runs: EmphasisOut[] = [];
  for (const phrase of phrases) {
    if (!phrase.trim()) continue;
    const start = text.indexOf(phrase);
    if (start >= 0 && !runs.some(run => start < run.end && start + phrase.length > run.start)) runs.push({start, end: start + phrase.length});
  }
  return runs.sort((a, b) => a.start - b.start);
}

function sourcesOf(store: Store, ids: number[]): AnswerSourceOut[] {
  if (!ids.length) return [];
  const rows = new Map(store.db.select().from(t.messages).where(inArray(t.messages.id, ids)).all().map(row => [row.id, row]));
  return ids.flatMap(id => {
    const row = rows.get(id);
    return row ? [{message_id: row.id, account_id: row.accountId, subject: row.subject, organisation: row.organisation, from_name: row.fromName, received_at: row.receivedAt, pinned: row.pinnedAt !== null}] : [];
  });
}

function present(store: Store, conversationId: number, turn: Turn): AnswerOut {
  return {
    conversation_id: conversationId, turn_id: turn.id, question: turn.question, answer: turn.answer, emphasis: turn.emphasis,
    sources: sourcesOf(store, turn.sourceIds), searched: turn.searched, proposals: turn.proposals,
  };
}

/** GET /api/alfred/conversations/:id: the thread so far. */
export function conversation(store: Store, conversationId: number): ConversationOut {
  const row = store.db.select().from(t.alfredConversations).where(eq(t.alfredConversations.id, conversationId)).get();
  if (!row) throw notFound('No such conversation.');
  const turns = store.db.select().from(t.alfredTurns).where(eq(t.alfredTurns.conversationId, row.id)).orderBy(asc(t.alfredTurns.id)).all();
  return {conversation_id: row.id, message_id: row.messageId, turns: turns.map(turn => present(store, row.id, turn))};
}

function recordUsage(store: Store, turn: ConverseTurn, messageId: number | null) {
  store.db.insert(t.aiUsage).values({
    at: isoNow(store), provider: turn.provider, model: turn.model, purpose: 'alfred', messageId,
    inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, cachedTokens: turn.usage.cachedTokens,
    costMicros: costMicros(turn.provider, turn.model, turn.usage) ?? 0,
  }).run();
}

interface Final {
  found: boolean;
  text: string;
  sourceIds: number[];
  emphasis: string[];
}

function finalOf(input: Record<string, unknown> | null): Final {
  const ids = Array.isArray(input?.source_ids) ? input.source_ids : [];
  const phrases = Array.isArray(input?.emphasis) ? input.emphasis : [];
  return {
    found: input?.found !== false,
    text: typeof input?.text === 'string' ? input.text.trim() : '',
    sourceIds: ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0),
    emphasis: phrases.filter((phrase): phrase is string => typeof phrase === 'string'),
  };
}

/** POST /api/alfred/ask: a question, a follow-up in a thread, or one about an email. */
export async function askAlfred(store: Store, input: {question: string; conversation_id?: number; message_id?: number; ask_id?: string}, options: AlfredOptions = {}): Promise<AnswerOut> {
  const now = isoNow(store);
  let thread: Conversation | null = null;
  if (input.conversation_id) {
    thread = store.db.select().from(t.alfredConversations).where(eq(t.alfredConversations.id, input.conversation_id)).get() ?? null;
    if (!thread) throw notFound('No such conversation.');
    if (Date.parse(now) - Date.parse(thread.touchedAt) > THREAD_IDLE_MS) throw new SetpointError('conversation_ended', 'This conversation has ended; ask again to start a new one.', 410);
  }
  const scope = thread ? thread.messageId : input.message_id ?? null;
  if (!thread && scope !== null) {
    const email = store.db.select({id: t.messages.id, trashedAt: t.messages.trashedAt}).from(t.messages).where(eq(t.messages.id, scope)).get();
    if (!email || email.trashedAt) throw notFound('No such email.');
  }

  // The model: the thread's own, or Settings › AI's choice for a new thread.
  const keys = aiKeys(store);
  const chosen = thread ? {choice: {provider: thread.provider, model: thread.model}, missing: null} : chooseAlfredModel(getSettings(store).ai, keys);
  const apiKey = chosen.choice ? keyOf(store, chosen.choice.provider) : null;
  if (!chosen.choice || !apiKey) {
    throw new SetpointError('alfred_no_key', chosen.missing ?? `This conversation used ${chosen.choice!.model}; add its key in Settings › AI, or ask again to start over.`, 503);
  }
  const {provider, model} = chosen.choice;
  const endpoints = options.endpoints ?? AI_ENDPOINTS;
  const client = conversationClient(provider, {apiKey, baseUrl: endpoints[provider], timeoutMs: options.timeoutMs});

  const earlier = thread ? store.db.select().from(t.alfredTurns).where(eq(t.alfredTurns.conversationId, thread.id)).orderBy(asc(t.alfredTurns.id)).all() : [];
  const items = [...(thread?.transcript.items ?? [])];
  const firstText = !thread && scope !== null ? aboutEmail(store, scope, input.question) : input.question;
  items.push(...client.userTurn(firstText, thread?.transcript.pending ?? []));

  const context: ToolContext = {
    store, read: [], searched: [], proposals: [],
    seen: new Set([...(thread?.transcript.seen ?? []), ...(scope !== null ? [scope] : [])]),
    questions: [...earlier.map(turn => turn.question), input.question],
  };
  const system = alfredSystem(localDay(now, store.timeZone), store.timeZone);

  let final: Final | null = null;
  let pending: ToolResult[] = [];
  let nudged = false;
  const steps = stepsOf(store);
  if (input.ask_id) steps.set(input.ask_id, null);
  try {
    for (let step = 0; step < MAX_STEPS && !final; step += 1) {
      const turn = await client.converse({
        model, system, tools: ALFRED_TOOLS, transcript: items, maxOutputTokens: MAX_OUTPUT_TOKENS, cacheKey: `setpoint-alfred:${PROMPT_VERSION}:${model}`,
      });
      recordUsage(store, turn, scope);
      items.push(...turn.assistant);
      if (turn.stop === 'refusal') throw new SetpointError('alfred_declined', 'The model declined to answer that.', 422);
      if (turn.toolCalls.length) {
        const results: ToolResult[] = [];
        for (const call of turn.toolCalls) {
          if (call.name === 'answer' && !final) {
            final = finalOf(call.input);
            results.push({id: call.id, output: JSON.stringify({shown: true})});
          } else {
            const step = input.ask_id ? stepOf(store, call.name, call.input) : null;
            if (step) steps.set(input.ask_id!, step);
            const outcome = runTool(context, call.name, call.input);
            results.push({id: call.id, output: outcome.output, ...(outcome.error ? {error: true} : {})});
          }
        }
        if (final) pending = results;
        else items.push(...client.toolResults(results));
      } else if (!nudged) {
        // v1's one reminder: a turn that ends without the answer tool is asked once more.
        nudged = true;
        items.push(...client.userTurn(ANSWER_NUDGE));
      } else {
        final = {found: Boolean(turn.text.trim()), text: turn.text.trim(), sourceIds: [], emphasis: []};
      }
    }
  } catch (error) {
    if (error instanceof ProviderError) throw new SetpointError('alfred_failed', error.message, 502);
    throw error;
  } finally {
    if (input.ask_id) steps.delete(input.ask_id);
  }
  if (!final) throw new SetpointError('alfred_step_limit', 'Alfred ran out of steps before answering. Try a narrower question.', 422);

  // Sources: the emails the answer names that this thread has seen; else the email it's about, or
  // the ones it read for this answer.
  const found = final.found && Boolean(final.text);
  let sourceIds = found ? [...new Set(final.sourceIds.filter(id => context.seen.has(id)))] : [];
  if (found && !sourceIds.length) sourceIds = scope !== null ? [scope] : context.read;
  // What it searched; for a question about one email that it couldn't answer without searching, that email.
  const searched = found || context.searched.length || scope === null ? context.searched : sourcesOf(store, [scope]).map(source => source.subject);
  const proposals: ProposalOut[] = context.proposals;

  return transaction(store, () => {
    const transcript = {items, pending, seen: [...context.seen]};
    let conversationId: number;
    if (thread) {
      conversationId = thread.id;
      store.db.update(t.alfredConversations).set({transcript, touchedAt: now}).where(eq(t.alfredConversations.id, thread.id)).run();
    } else {
      store.db.delete(t.alfredConversations).where(lt(t.alfredConversations.touchedAt, new Date(Date.parse(now) - THREAD_KEPT_MS).toISOString())).run();
      conversationId = store.db.insert(t.alfredConversations).values({messageId: scope, provider, model, transcript, createdAt: now, touchedAt: now}).returning({id: t.alfredConversations.id}).get().id;
    }
    const turn = store.db.insert(t.alfredTurns).values({
      conversationId, at: now, question: input.question, answer: found ? final.text : null, emphasis: found ? emphasisOf(final.text, final.emphasis) : [],
      sourceIds, searched, proposals,
    }).returning().get();
    return present(store, conversationId, turn);
  });
}
