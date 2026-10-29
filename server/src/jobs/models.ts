// Jobs's models and cost (decision 61, D315): Claude Haiku 5.5 reads each email (J2); J3 adds Sonnet
// 5.5 with web search to find a JD and Haiku again to read it. They run on the Anthropic key in
// Settings › AI, with no cap. Each call goes in the AI usage ledger as Jobs, in its part:
// `jobs_emails` here, `jobs_finding_jds` and `jobs_reading_jds` in J3.
import type {AiPurpose} from '@setpoint/shared';
import * as t from '../db/schema.ts';
import {costMicros} from '../domain/aiCost.ts';
import {modelClient} from '../providers/ai/index.ts';
import type {AiEndpoints, ModelAnswer, ModelClient} from '../providers/ai/index.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {keyOf} from '../triage/models.ts';

export const JOBS_MODELS = {emails: 'claude-haiku-5-5'} as const;

export const JOBS_PURPOSES = ['jobs_emails', 'jobs_finding_jds', 'jobs_reading_jds'] as const satisfies readonly AiPurpose[];
export type JobsPurpose = (typeof JOBS_PURPOSES)[number];

export const NO_JOBS_KEY = 'Jobs needs an Anthropic key in Settings › AI.';

/** Writes a Jobs model call to the AI usage ledger, with the email it read. */
export function recordJobsUsage(store: Store, answer: ModelAnswer, purpose: JobsPurpose, messageId: number | null) {
  store.db.insert(t.aiUsage).values({
    at: isoNow(store), provider: answer.provider, model: answer.model, purpose, messageId,
    inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens, cachedTokens: answer.usage.cachedTokens,
    costMicros: costMicros(answer.provider, answer.model, answer.usage) ?? 0,
  }).run();
}

/** The client for reading emails with the Anthropic key; null without one. */
export function jobsEmailClient(store: Store, endpoints: AiEndpoints, timeoutMs?: number): {client: ModelClient; model: string} | null {
  const apiKey = keyOf(store, 'anthropic');
  if (!apiKey) return null;
  return {client: modelClient('anthropic', {apiKey, baseUrl: endpoints.anthropic, timeoutMs}), model: JOBS_MODELS.emails};
}
