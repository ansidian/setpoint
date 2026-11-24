// Alfred: a question, answered by a model that uses Setpoint's own queries as tools. The emails
// the answer rests on are its sources. Follow-up turns go in a short thread held here by id. "Ask
// about this email" scopes a thread to one email. When the mail doesn't say, the answer is null and
// `searched` says what Alfred searched ("Couldn't find that in your mail or calendar"). The events
// and tasks an answer rests on are sources too, and the job applications while Jobs registers its
// tools. Anything Alfred would create is a proposal.
//
// Every model call goes in the AI usage ledger (purpose `alfred`). A failed call saves nothing: the
// thread stays as it was before the question, so asking again works.
//
// The tool loop has a step limit and one reminder when a turn ends without the expected tool call.
// The provider and model are bound when the thread starts. A failure restores the transcript.
// Threads end after four idle hours.
import type {AnswerApplicationOut, AnswerItemOut, AnswerOut, AnswerSourceOut, AskContext, AskPage, AskStep, ConversationOut, EmphasisOut, ProposalOut} from '@setpoint/shared';
import {asc, eq, inArray, lt} from 'drizzle-orm';
import {withBody} from '../db/bodies.ts';
import * as t from '../db/schema.ts';
import {costMicros} from '../domain/aiCost.ts';
import {localDay, localTime} from '../domain/time.ts';
import {notFound, SetpointError} from '../errors.ts';
import {AI_ENDPOINTS, anthropicConversation} from '../providers/ai/index.ts';
import type {AiEndpoints, ConverseTurn, ToolResult} from '../providers/ai/index.ts';
import {getSettings} from '../settings.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {SyncEngine} from '../sync/engine.ts';
import {ProviderError} from '../sync/errors.ts';
import {aiKeys, anthropicKey} from '../triage/models.ts';
import {chooseAlfredModel} from './models.ts';
import {alfredSystem, alfredTools, ANSWER_NUDGE, fenced, MAX_OUTPUT_TOKENS} from './prompt.ts';
import {attachmentFile} from '../queries/mailBody.ts';
import {inviteOf} from './proposals.ts';
import {enabledRegistrations} from './registered.ts';
import type {AlfredRegistration} from './registered.ts';
import {attachmentAsked, runTool} from './tools.ts';
import type {ToolContext} from './tools.ts';

export interface AlfredOptions {
  // The provider's base URL. Tests point it at a fake on 127.0.0.1.
  endpoints?: AiEndpoints;
  timeoutMs?: number;
  // Reads an email's invite for a proposal, and a PDF for read_attachment. Without it, a proposal is
  // the text's and no PDF can be read.
  engine?: SyncEngine | null;
  // Tools a removable module registers (Jobs', from server.ts), offered while it's on.
  registered?: AlfredRegistration[];
}

/** Model turns per question before Alfred gives up (help me write's draft too) */
export const MAX_STEPS = 10;
/** A thread ends after this long idle (four hours). A follow-up then starts over. */
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
function stepOf(store: Store, name: string, input: Record<string, unknown> | null, registered: AlfredRegistration[]): AskStep | null {
  const owner = registered.find(one => one.tools.some(tool => tool.name === name));
  if (owner) return owner.step(store, name, input);
  if (name === 'search_mail' && typeof input?.query === 'string') return {tool: 'search_mail', query: input.query};
  if (name === 'get_email') {
    const id = Number(input?.message_id);
    const row = Number.isSafeInteger(id) ? store.db.select({organisation: t.messages.organisation, fromName: t.messages.fromName}).from(t.messages).where(eq(t.messages.id, id)).get() : undefined;
    return row ? {tool: 'get_email', from: row.organisation ?? row.fromName} : null;
  }
  if (name === 'list_items') return {tool: 'list_items'};
  if (name === 'search_calendar' && typeof input?.query === 'string') return {tool: 'search_calendar', query: input.query};
  if (name === 'propose_item' && (input?.kind === 'event' || input?.kind === 'task')) return {tool: 'propose_item', kind: input.kind};
  if (name === 'propose_change') return {tool: 'propose_change'};
  return null;
}

type Conversation = typeof t.alfredConversations.$inferSelect;
type Turn = typeof t.alfredTurns.$inferSelect;

const BODY_LIMIT = 20_000;

/** The email Ask about this email attaches to the thread's first question. */
function aboutEmail(store: Store, messageId: number, question: string): string {
  const row = withBody(store.db, store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get()!);
  const account = store.db.select({label: t.accounts.label}).from(t.accounts).where(eq(t.accounts.id, row.accountId)).get();
  const body = row.bodyText.length > BODY_LIMIT ? `${row.bodyText.slice(0, BODY_LIMIT)}\n[…the rest of this email was cut]` : row.bodyText;
  return [
    `The user is reading this email (message_id ${row.id}, ${account?.label ?? 'an account'}, ${localDay(row.receivedAt, store.timeZone)} ${localTime(row.receivedAt, store.timeZone)}) and asks about it.`,
    fenced(row.id, [`From: ${row.fromName} <${row.fromAddress}>${row.organisation ? ` (${row.organisation})` : ''}`, `Subject: ${row.subject}`, `Key date: ${row.keyDate ?? 'none'}`, '', body].join('\n')),
    `The user's question: ${question}`,
  ].join('\n\n');
}

const PAGE_NAMES: Record<AskPage, string> = {
  inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', snoozed: 'Snoozed', scheduled: 'Scheduled', calendar: 'Calendar', news: 'News', jobs: 'Jobs', settings: 'Settings',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const withWeekday = (date: string) => `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]} ${date}`;

/**
 * What was on screen when a thread's first question was asked from ⌘K or the phone's button, as one
 * line before the question: the page, the dates in view on the Calendar, and what's open. Built from
 * ids and dates only, and an open item's own title.
 */
export function contextLine(store: Store, context: AskContext, registered: AlfredRegistration[] = []): string {
  let open = 'with nothing open';
  if (context.email_id !== undefined) {
    open = `with the email message_id ${context.email_id} open (read it with get_email)`;
  } else if (context.item) {
    const row = store.db.select({kind: t.items.kind, title: t.items.title}).from(t.items).where(eq(t.items.id, context.item.id)).get();
    const key = context.item.at ? `${context.item.id}@${context.item.at}` : String(context.item.id);
    open = row ? `with the calendar ${row.kind} ${JSON.stringify(row.title)} open (key ${key})` : 'with nothing open';
  } else if (context.application_id !== undefined) {
    open = registered[0]?.openApplication(context.application_id) ?? `with job application ${context.application_id} open`;
  }
  const viewing = context.dates ? `, viewing ${withWeekday(context.dates.from)} to ${withWeekday(context.dates.to)}` : '';
  const means = [open !== 'with nothing open' && '"this" is what\'s open', viewing && 'a weekday is the one in view'].filter(Boolean).join(', and ');
  return `The user is on ${PAGE_NAMES[context.page]}${viewing}, ${open}.${means ? ` So ${means}.` : ''}`;
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

/** When a thread touched at `touchedAt` ends, if nothing more is asked. */
const endsAt = (touchedAt: string) => new Date(Date.parse(touchedAt) + THREAD_IDLE_MS).toISOString();

function present(store: Store, conversationId: number, turn: Turn, touchedAt: string): AnswerOut {
  return {
    conversation_id: conversationId, turn_id: turn.id, ends_at: endsAt(touchedAt), question: turn.question, answer: turn.answer, emphasis: turn.emphasis,
    sources: sourcesOf(store, turn.sourceIds), items: turn.itemSources, applications: turn.applicationSources, searched: turn.searched, proposals: turn.proposals,
  };
}

/**
 * Whether a thread can no longer be continued: idle past THREAD_IDLE_MS, or begun on OpenAI, when it
 * was a provider, with a transcript Claude can't continue.
 */
const ended = (thread: Conversation, now: string) => Date.parse(now) - Date.parse(thread.touchedAt) > THREAD_IDLE_MS || thread.provider !== 'anthropic';

/** Marks the thread's proposals before `turnId` that weren't acted on as replaced. */
function replaceEarlier(store: Store, conversationId: number, turnId: number) {
  const turns = store.db.select({id: t.alfredTurns.id, proposals: t.alfredTurns.proposals}).from(t.alfredTurns).where(eq(t.alfredTurns.conversationId, conversationId)).all();
  for (const turn of turns) {
    if (turn.id >= turnId || !turn.proposals.some(proposal => !proposal.acted && !proposal.replaced)) continue;
    const proposals = turn.proposals.map(proposal => (proposal.acted ? proposal : {...proposal, replaced: true}));
    store.db.update(t.alfredTurns).set({proposals}).where(eq(t.alfredTurns.id, turn.id)).run();
  }
}

/**
 * POST /api/alfred/acted: an answer's proposal was created or saved, so a later one leaves it be
 * and the next question says so. Acted wins over replaced.
 */
export function proposalActed(store: Store, turnId: number, index: number) {
  const turn = store.db.select({proposals: t.alfredTurns.proposals}).from(t.alfredTurns).where(eq(t.alfredTurns.id, turnId)).get();
  const proposal = turn?.proposals[index];
  if (!turn || !proposal) throw notFound('No such proposal.');
  if (proposal.acted && !proposal.replaced) return;
  const proposals = turn.proposals.map((one, at) => {
    if (at !== index) return one;
    const {replaced: _replaced, ...kept} = one;
    return {...kept, acted: true};
  });
  store.db.update(t.alfredTurns).set({proposals}).where(eq(t.alfredTurns.id, turnId)).run();
}

/** GET /api/alfred/conversations/:id: the thread so far, and whether it has ended. */
export function conversation(store: Store, conversationId: number): ConversationOut {
  const row = store.db.select().from(t.alfredConversations).where(eq(t.alfredConversations.id, conversationId)).get();
  if (!row) throw notFound('No such conversation.');
  const turns = store.db.select().from(t.alfredTurns).where(eq(t.alfredTurns.conversationId, row.id)).orderBy(asc(t.alfredTurns.id)).all();
  return {conversation_id: row.id, message_id: row.messageId, ended: ended(row, isoNow(store)), turns: turns.map(turn => present(store, row.id, turn, row.touchedAt))};
}

function recordUsage(store: Store, turn: ConverseTurn, messageId: number | null) {
  store.db.insert(t.aiUsage).values({
    at: isoNow(store), provider: turn.provider, model: turn.model, purpose: 'alfred', messageId,
    inputTokens: turn.usage.inputTokens, outputTokens: turn.usage.outputTokens, cachedTokens: turn.usage.cachedTokens,
    costMicros: costMicros(turn.model, turn.usage) ?? 0,
  }).run();
}

interface Final {
  found: boolean;
  text: string;
  sourceIds: number[];
  itemKeys: string[];
  applicationIds: number[];
  emphasis: string[];
}

function finalOf(input: Record<string, unknown> | null): Final {
  const ids = Array.isArray(input?.source_ids) ? input.source_ids : [];
  const phrases = Array.isArray(input?.emphasis) ? input.emphasis : [];
  const keys = Array.isArray(input?.item_keys) ? input.item_keys : [];
  const applications = Array.isArray(input?.application_ids) ? input.application_ids : [];
  return {
    found: input?.found !== false,
    text: typeof input?.text === 'string' ? input.text.trim() : '',
    sourceIds: ids.map(Number).filter(id => Number.isSafeInteger(id) && id > 0),
    itemKeys: keys.filter((key): key is string => typeof key === 'string'),
    applicationIds: applications.map(Number).filter(id => Number.isSafeInteger(id) && id > 0),
    emphasis: phrases.filter((phrase): phrase is string => typeof phrase === 'string'),
  };
}

/** POST /api/alfred/ask: a question, a follow-up in a thread, or one about an email. */
export async function askAlfred(store: Store, input: {question: string; conversation_id?: number; message_id?: number; context?: AskContext; ask_id?: string}, options: AlfredOptions = {}): Promise<AnswerOut> {
  const now = isoNow(store);
  let thread: Conversation | null = null;
  if (input.conversation_id) {
    thread = store.db.select().from(t.alfredConversations).where(eq(t.alfredConversations.id, input.conversation_id)).get() ?? null;
    if (!thread) throw notFound('No such conversation.');
    if (ended(thread, now)) throw new SetpointError('conversation_ended', 'This conversation has ended; ask again to start a new one.', 410);
  }
  const scope = thread ? thread.messageId : input.message_id ?? null;
  if (!thread && scope !== null) {
    const email = store.db.select({id: t.messages.id, trashedAt: t.messages.trashedAt}).from(t.messages).where(eq(t.messages.id, scope)).get();
    if (!email || email.trashedAt) throw notFound('No such email.');
  }

  // The model: the thread's own, or Settings › AI's choice for a new thread.
  const keys = aiKeys(store);
  const chosen = thread ? {choice: {provider: thread.provider, model: thread.model}, missing: null} : chooseAlfredModel(getSettings(store).ai, keys);
  const apiKey = chosen.choice ? anthropicKey(store) : null;
  if (!chosen.choice || !apiKey) {
    throw new SetpointError('alfred_no_key', chosen.missing ?? `This conversation used ${chosen.choice!.model}; add its key in Settings › AI, or ask again to start over.`, 503);
  }
  const {provider, model} = chosen.choice;
  const endpoints = options.endpoints ?? AI_ENDPOINTS;
  const client = anthropicConversation({apiKey, baseUrl: endpoints.anthropic, timeoutMs: options.timeoutMs});

  const earlier = thread ? store.db.select().from(t.alfredTurns).where(eq(t.alfredTurns.conversationId, thread.id)).orderBy(asc(t.alfredTurns.id)).all() : [];
  const items = [...(thread?.transcript.items ?? [])];
  // The registered tools on for this question (Jobs', while it's on).
  const registered = enabledRegistrations(store, options.registered);
  // A thread's first question carries the email it's about, or what was on screen.
  // Proposals the user created or saved since Alfred last heard: said before the follow-up, each once,
  // so a change to one goes to the item now on the calendar.
  const noted = new Set(thread?.transcript.noted ?? []);
  const acted = earlier.flatMap(turn => turn.proposals.flatMap((proposal, index) => (proposal.acted && !noted.has(`${turn.id}:${index}`) ? [{key: `${turn.id}:${index}`, proposal}] : [])));
  const actedLine = acted.map(({proposal}) => `The user ${proposal.change ? 'saved the proposed change to' : 'created the proposed'} ${proposal.kind} ${JSON.stringify(proposal.item.title)}.`).join(' ');
  const firstText = thread ? (actedLine ? `${actedLine}\n\nThe user's question: ${input.question}` : input.question)
    : scope !== null ? aboutEmail(store, scope, input.question)
      : input.context ? `${contextLine(store, input.context, registered)}\n\nThe user's question: ${input.question}` : input.question;
  items.push(...client.userTurn(firstText, thread?.transcript.pending ?? []));

  const context: ToolContext = {
    store, read: [], searched: [], proposals: [], invites: new Map(), files: new Map(), documents: new Set(), items: new Map(), registered, applications: new Map(),
    seen: new Set([...(thread?.transcript.seen ?? []), ...(scope !== null ? [scope] : [])]),
    questions: [...earlier.map(turn => turn.question), input.question],
  };
  const system = alfredSystem(localDay(now, store.timeZone), store.timeZone, registered);
  const tools = alfredTools(registered);

  let final: Final | null = null;
  let pending: ToolResult[] = [];
  let nudged = false;
  const steps = stepsOf(store);
  if (input.ask_id) steps.set(input.ask_id, null);
  try {
    for (let step = 0; step < MAX_STEPS && !final; step += 1) {
      const turn = await client.converse({
        model, system, tools, transcript: items, maxOutputTokens: MAX_OUTPUT_TOKENS,
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
            const step = input.ask_id ? stepOf(store, call.name, call.input, registered) : null;
            if (step) steps.set(input.ask_id!, step);
            // A proposal takes what the email's invite says. It's read here because the tools don't wait.
            const proposed = call.name === 'propose_item' ? Number(call.input?.message_id) : null;
            if (proposed && context.seen.has(proposed) && !context.invites!.has(proposed)) context.invites!.set(proposed, await inviteOf(store, options.engine ?? null, proposed));
            // A PDF's bytes, the same way, through the email's account. Errors leave none.
            const pdf = call.name === 'read_attachment' ? attachmentAsked(context, call.input) : null;
            if (pdf && 'id' in pdf && !context.files!.has(pdf.id)) {
              context.files!.set(pdf.id, await attachmentFile(store, options.engine ?? null, pdf.messageId, pdf.id).then(file => new Uint8Array(file.content), () => null));
            }
            const outcome = runTool(context, call.name, call.input);
            results.push({id: call.id, output: outcome.output, ...(outcome.error ? {error: true} : {}), ...(outcome.document ? {document: outcome.document} : {})});
          }
        }
        if (final) pending = results;
        else items.push(...client.toolResults(results));
      } else if (!nudged) {
        // One reminder: a turn that ends without the answer tool is asked once more.
        nudged = true;
        items.push(...client.userTurn(ANSWER_NUDGE));
      } else {
        final = {found: Boolean(turn.text.trim()), text: turn.text.trim(), sourceIds: [], itemKeys: [], applicationIds: [], emphasis: []};
      }
    }
  } catch (error) {
    if (error instanceof ProviderError) throw new SetpointError('alfred_failed', error.message, 502);
    throw error;
  } finally {
    if (input.ask_id) steps.delete(input.ask_id);
  }
  if (!final) throw new SetpointError('alfred_step_limit', 'Alfred ran out of steps before answering. Try a narrower question.', 422);

  // Sources are the emails the answer names that this thread has seen, and the events and tasks it
  // names that list_items or search_calendar gave this question. With neither, they are the email it's about, or the
  // ones it read for this answer.
  const found = final.found && Boolean(final.text);
  let sourceIds = found ? [...new Set(final.sourceIds.filter(id => context.seen.has(id)))] : [];
  const itemSources: AnswerItemOut[] = found ? [...new Set(final.itemKeys)].flatMap(key => context.items!.get(key) ?? []) : [];
  const applicationSources: AnswerApplicationOut[] = found ? [...new Set(final.applicationIds)].flatMap(id => context.applications!.get(id) ?? []) : [];
  if (found && !sourceIds.length && !itemSources.length && !applicationSources.length) sourceIds = scope !== null ? [scope] : context.read;
  // What it searched. For a question about one email that it couldn't answer without searching, that email.
  const searched = found || context.searched.length || scope === null ? context.searched : sourcesOf(store, [scope]).map(source => source.subject);
  const proposals: ProposalOut[] = context.proposals;

  return transaction(store, () => {
    const transcript = {items, pending, seen: [...context.seen], noted: [...noted, ...acted.map(one => one.key)]};
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
      sourceIds, itemSources, applicationSources, searched, proposals,
    }).returning().get();
    // A new proposal replaces the thread's earlier ones not yet created or saved. Read here, inside
    // the write, so a Create pressed while Alfred answered stands.
    if (proposals.length) replaceEarlier(store, conversationId, turn.id);
    return present(store, conversationId, turn, now);
  });
}
