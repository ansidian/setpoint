// Triage's job worker on B1's engine: one job per new email (`triage:<id>`), run through the
// pipeline with the models Settings › AI chooses. Each model call is written to the AI usage ledger
// with its tokens and cost, and to triage's health; a refusal fails the job by the one retry policy
// and the email waits in Unsorted. Every few minutes, and as soon as triage recovers or its keys or
// models change, Unsorted mail is queued again. New Attention and FYI mail is sent by ntfy once
// sorted, each lane as Settings › Notifications allows (SV-96).
import type {AiProvider} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {costMicros} from '../domain/aiCost.ts';
import type {Reading} from '../domain/triagePolicy.ts';
import type {Notifier} from '../notify/index.ts';
import {AI_ENDPOINTS, modelClient} from '../providers/ai/index.ts';
import type {AiEndpoints, ModelAnswer, ModelClient} from '../providers/ai/index.ts';
import {getSettings} from '../settings.ts';
import {isoNow, noteLive} from '../store.ts';
import type {Store} from '../store.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {failJob, finishJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {recordTriageFailure, recordTriageSuccess} from './health.ts';
import {applyOutcome, hurryTriage, resortUnsorted, triageEmailOf} from './intake.ts';
import {aiKeys, chooseTriageModels, keyOf} from './models.ts';
import {triageEmail, TriageUnavailable} from './pipeline.ts';
import type {Tier} from './pipeline.ts';
import {loadRules} from './rules.ts';
import {MAX_OUTPUT_TOKENS, promptInput, PROMPT_VERSION, readingOf, TRIAGE_SYSTEM, TRIAGE_TOOL} from './prompt.ts';

export interface TriageWorkerOptions {
  store: Store;
  // The providers' base URLs; tests point them at a fake on 127.0.0.1.
  endpoints?: AiEndpoints;
  // How often Unsorted mail is queued again (5 minutes).
  resortEveryMs?: number;
  // Emails triaged at once, so a burst of mail doesn't meet a rate limit all together.
  concurrency?: number;
  // One model call's limit (v1's 120 s).
  timeoutMs?: number;
  // Sends new Attention and FYI mail; none without it.
  notifier?: Notifier | null;
  // Told each time an email is sorted, after it's written: a module that reads mail as triage left
  // it (Jobs, wired in server.ts) learns there's something to read. It names no module; it should
  // return at once, and what it throws is logged, never failing the email's triage.
  onSorted?: ((messageId: number) => void) | null;
}

// Mail that waited longer than this for triage (an outage, a key added later) is sorted quietly,
// so a recovery doesn't send a burst of old mail.
const MAIL_NOTIFY_WITHIN_MS = 60 * 60_000;

/** Writes a model call to the AI usage ledger: what it was for, its tokens and its cost. */
export function recordUsage(store: Store, answer: ModelAnswer, messageId: number | null) {
  store.db.insert(t.aiUsage).values({
    at: isoNow(store), provider: answer.provider, model: answer.model, purpose: 'triage', messageId,
    inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens, cachedTokens: answer.usage.cachedTokens,
    costMicros: costMicros(answer.provider, answer.model, answer.usage) ?? 0,
  }).run();
}

export interface TriageClients {
  clients: Partial<Record<Tier | 'history', {client: ModelClient; model: string}>>;
  // Why there's no cheap model, when there isn't.
  missing: string | null;
}

/** The clients for the models Settings › AI chooses, with the keys set; none without a key. */
export function triageClients(store: Store, endpoints: AiEndpoints, timeoutMs?: number): TriageClients {
  const chosen = chooseTriageModels(getSettings(store).ai, aiKeys(store));
  const clientFor = (choice: {provider: AiProvider; model: string} | null) => {
    const apiKey = choice ? keyOf(store, choice.provider) : null;
    if (!choice || !apiKey) return undefined;
    return {client: modelClient(choice.provider, {apiKey, baseUrl: endpoints[choice.provider], timeoutMs}), model: choice.model};
  };
  const cheap = clientFor(chosen.cheap);
  const strong = clientFor(chosen.strong) ?? cheap;
  const history = clientFor(chosen.history);
  return {clients: cheap && strong ? {cheap, strong, ...(history && {history})} : {}, missing: cheap ? null : chosen.missing ?? 'Triage has no model to ask.'};
}

/** One model call for an email with triage's prompt and tool, its usage written to the ledger. */
export async function askModel(store: Store, {client, model}: {client: ModelClient; model: string}, tier: Tier, input: string, messageId: number, signal?: AbortSignal): Promise<ModelAnswer> {
  const answer = await client.call({
    model, system: TRIAGE_SYSTEM, tool: TRIAGE_TOOL, input, maxOutputTokens: MAX_OUTPUT_TOKENS[client.provider],
    cacheKey: `setpoint-triage:${PROMPT_VERSION}:${tier}:${model}`, signal,
  });
  recordUsage(store, answer, messageId);
  return answer;
}

export class TriageWorker implements JobWorker {
  readonly kind = 'triage' as const;
  private readonly store: Store;
  private readonly endpoints: AiEndpoints;
  private readonly resortEveryMs: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number | undefined;
  private readonly notifier: Notifier | null;
  private readonly onSorted: ((messageId: number) => void) | null;
  private lastResortAt = Number.NEGATIVE_INFINITY;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor({store, endpoints = AI_ENDPOINTS, resortEveryMs = 5 * 60_000, concurrency = 4, timeoutMs, notifier = null, onSorted = null}: TriageWorkerOptions) {
    this.store = store;
    this.endpoints = endpoints;
    this.resortEveryMs = resortEveryMs;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.notifier = notifier;
    this.onSorted = onSorted;
  }

  /** The engine's tick: queue Unsorted mail again when it's time. */
  schedule() {
    const now = this.store.now().getTime();
    if (now - this.lastResortAt < this.resortEveryMs) return;
    this.lastResortAt = now;
    resortUnsorted(this.store);
  }

  /** Keys or model choices changed (Settings › AI): try Unsorted mail again now. */
  configurationChanged() {
    resortUnsorted(this.store);
    hurryTriage(this.store);
  }

  async run(job: Job, signal: AbortSignal) {
    while (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active += 1;
    try {
      await this.triage(job, signal);
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  private clients() {
    return triageClients(this.store, this.endpoints, this.timeoutMs);
  }

  private async triage(job: Job, signal: AbortSignal) {
    const store = this.store;
    const message = job.messageId === null ? undefined : store.db.select().from(t.messages).where(eq(t.messages.id, job.messageId)).get();
    // Deleted, or sorted already (once per email).
    if (!message || message.lane !== null) return finishJob(store, job.id);
    const email = triageEmailOf(store, message);
    const {input, incomplete} = promptInput(email);
    const {clients, missing} = this.clients();
    const ask = async (tier: Tier, _reason: string): Promise<Reading | null> => {
      let answer: ModelAnswer;
      try {
        answer = await askModel(store, clients[tier]!, tier, input, message.id, signal);
      } catch (caught) {
        const error = asProviderError(caught);
        if (recordTriageFailure(store, error.message)) noteLive(store, {type: 'mail', messages: [], accounts: [], commands: []});
        throw error;
      }
      if (recordTriageSuccess(store)) {
        hurryTriage(store);
        noteLive(store, {type: 'mail', messages: [], accounts: [], commands: []});
      }
      return readingOf(answer.toolInput);
    };
    let sorted = false;
    try {
      const outcome = await triageEmail({
        rules: loadRules(store),
        codeExpiryMinutes: getSettings(store).mail.code_expiry_minutes,
        ask: clients.cheap ? ask : null,
      }, email, incomplete);
      sorted = applyOutcome(store, message.id, outcome);
      finishJob(store, job.id);
    } catch (caught) {
      let error: ProviderError;
      if (caught instanceof TriageUnavailable) {
        // Nothing to retry until a key arrives (configurationChanged queues it again).
        error = new ProviderError('auth', missing ?? caught.message);
        if (recordTriageFailure(store, error.message)) noteLive(store, {type: 'mail', messages: [], accounts: [], commands: []});
      } else {
        error = asProviderError(caught);
      }
      failJob(store, job, error);
    }
    if (!sorted) return;
    try {
      this.onSorted?.(message.id);
    } catch (error) {
      // Mail goes on whatever the listener does.
      console.error(`After sorting email ${message.id}`, error);
    }
    await this.notifyMail(message.id);
  }

  /**
   * One notification for an email triage just sorted into Attention or FYI, opening it, unless it's
   * been read, Done, trashed or archived meanwhile or waited too long to be news.
   */
  private async notifyMail(messageId: number) {
    if (!this.notifier) return;
    const row = this.store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
    if (!row || row.lane === null || row.lane === 'noise') return;
    if (!row.unread || row.doneAt || row.trashedAt || row.archivedAt) return;
    if (this.store.now().getTime() - Date.parse(row.receivedAt) > MAIL_NOTIFY_WITHIN_MS) return;
    await this.notifier.notify({
      kind: 'mail', topic: 'mail', lane: row.lane, title: row.fromName || row.fromAddress, body: row.subject || row.snippet,
      link: {to: 'message', id: row.id}, dedupe: `mail:${row.id}`,
    });
  }
}
