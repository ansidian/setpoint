// Jobs's models and cost (decision 61, D315): Claude Haiku 5.5 reads each email (J2); J3 adds Sonnet
// 5.5 with web search to find a JD and Haiku again to read it. They run on the Anthropic key in
// Settings › AI, with no cap. Each call goes in the AI usage ledger as Jobs, in its part:
// `jobs_emails` here, `jobs_finding_jds` and `jobs_reading_jds` in J3. Settings › AI's Jobs group
// reads them back (J8, board 39b): the three models by name, and this month's spend in its parts.
import type {AiPurpose, JobsAiOut, JobsUsageOut} from '@setpoint/shared';
import {and, count, gte, inArray, sum} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {costMicros} from '../domain/aiCost.ts';
import {monthStart} from '../domain/newsSorting.ts';
import {modelClient} from '../providers/ai/index.ts';
import type {AiEndpoints, ModelAnswer, ModelClient} from '../providers/ai/index.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {aiKeys, keyOf} from '../triage/models.ts';

export const JOBS_MODELS = {emails: 'claude-haiku-5-5', finding: 'claude-sonnet-5-5', reading: 'claude-haiku-5-5'} as const;

export const JOBS_PURPOSES = ['jobs_emails', 'jobs_finding_jds', 'jobs_reading_jds'] as const satisfies readonly AiPurpose[];
export type JobsPurpose = (typeof JOBS_PURPOSES)[number];

export const NO_JOBS_KEY = 'Jobs needs an Anthropic key in Settings › AI.';

/** Writes a Jobs model call to the AI usage ledger, with the email it read; a search's cost takes in its web searches. */
export function recordJobsUsage(store: Store, answer: ModelAnswer, purpose: JobsPurpose, messageId: number | null) {
  store.db.insert(t.aiUsage).values({
    at: isoNow(store), provider: answer.provider, model: answer.model, purpose, messageId,
    inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens, cachedTokens: answer.usage.cachedTokens,
    costMicros: costMicros(answer.provider, answer.model, answer.usage) ?? 0,
  }).run();
}

/** The client for one of Jobs's models with the Anthropic key; null without one. */
export function jobsModelClient(store: Store, endpoints: AiEndpoints, work: keyof typeof JOBS_MODELS, timeoutMs?: number): {client: ModelClient; model: string} | null {
  const apiKey = keyOf(store, 'anthropic');
  if (!apiKey) return null;
  return {client: modelClient('anthropic', {apiKey, baseUrl: endpoints.anthropic, timeoutMs}), model: JOBS_MODELS[work]};
}

/** The client for reading emails with the Anthropic key; null without one. */
export const jobsEmailClient = (store: Store, endpoints: AiEndpoints, timeoutMs?: number) => jobsModelClient(store, endpoints, 'emails', timeoutMs);

/** What Jobs's calls for these parts have cost since `since`, from the ledger. */
function usage(store: Store, since: string, purposes: readonly JobsPurpose[]): JobsUsageOut {
  const row = store.db.select({calls: count(), input: sum(t.aiUsage.inputTokens), output: sum(t.aiUsage.outputTokens), cost: sum(t.aiUsage.costMicros)})
    .from(t.aiUsage).where(and(gte(t.aiUsage.at, since), inArray(t.aiUsage.purpose, [...purposes]))).get();
  return {calls: row?.calls ?? 0, input_tokens: Number(row?.input ?? 0), output_tokens: Number(row?.output ?? 0), cost_usd: Number(row?.cost ?? 0) / 1_000_000};
}

/** GET /api/jobs/ai: Settings › AI's Jobs group and its row in Usage this month (board 39b). */
export function jobsAi(store: Store): JobsAiOut {
  const since = monthStart(isoNow(store), store.timeZone);
  return {
    models: {emails: JOBS_MODELS.emails, finding: JOBS_MODELS.finding, reading: JOBS_MODELS.reading},
    missing: aiKeys(store).anthropic ? null : NO_JOBS_KEY,
    this_month: {
      ...usage(store, since, JOBS_PURPOSES),
      emails: usage(store, since, ['jobs_emails']), finding_jds: usage(store, since, ['jobs_finding_jds']), reading_jds: usage(store, since, ['jobs_reading_jds']),
    },
  };
}
