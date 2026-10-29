// What a model call cost, for the AI usage ledger (Settings › AI). Standard text API rates in US
// dollars per million tokens: input, cached input reads, output. Anthropic's rates are the claude-api
// skill's pricing table (cached 2026-10-06; cache reads 0.1× input except where it states otherwise:
// Opus 5.5 and Sonnet 5.5 $0.20, Fable 5.1 $0.25); OpenAI's are v1's AI_PRICING.md (checked
// 2026-10-07). Anthropic's cache writes cost 1.25× input for five minutes (triage's, Alfred's) and 2×
// for an hour (News's hourly ranking, N3).
// Claude Haiku 5.5 bills a prompt over 100K tokens at 5× in every bucket. Dated snapshots price as their model. A model not listed has no cost (null; the ledger
// keeps its tokens and records 0) rather than a guessed one. Triage prompts are bounded
// (src/triage/prompt.ts), so OpenAI's long-context premiums never apply here.
import type {AiProvider} from '@setpoint/shared';

interface Rate {
  input: number;
  cached: number;
  output: number;
}

const RATES: Record<AiProvider, Record<string, Rate>> = {
  anthropic: {
    'claude-haiku-4-5': {input: 1, cached: 0.1, output: 5},
    'claude-haiku-5-5': {input: 0.1, cached: 0.01, output: 0.5},
    'claude-sonnet-4-5': {input: 3, cached: 0.3, output: 15},
    'claude-sonnet-4-6': {input: 3, cached: 0.3, output: 15},
    'claude-sonnet-5': {input: 2, cached: 0.2, output: 10},
    'claude-sonnet-5-5': {input: 2, cached: 0.2, output: 10},
    'claude-opus-5-5': {input: 4, cached: 0.2, output: 20},
    'claude-fable-5': {input: 10, cached: 1, output: 50},
    'claude-fable-5-1': {input: 10, cached: 0.25, output: 50},
    'claude-opus-4-5': {input: 5, cached: 0.5, output: 25},
    'claude-opus-4-6': {input: 5, cached: 0.5, output: 25},
    'claude-opus-4-7': {input: 5, cached: 0.5, output: 25},
    'claude-opus-4-8': {input: 5, cached: 0.5, output: 25},
    'claude-opus-5': {input: 5, cached: 0.5, output: 25},
  },
  openai: {
    'gpt-6-astra': {input: 10, cached: 1, output: 50},
    'gpt-6-sol': {input: 2, cached: 0.2, output: 10},
    'gpt-6-luna': {input: 0.1, cached: 0.01, output: 0.5},
    'gpt-5.6-sol': {input: 4, cached: 0.4, output: 20},
    'gpt-5.6-terra': {input: 2, cached: 0.2, output: 12},
    'gpt-5.6-luna': {input: 0.2, cached: 0.02, output: 1.2},
    'gpt-5.5': {input: 5, cached: 0.5, output: 30},
    'gpt-5.4': {input: 2.5, cached: 0.25, output: 15},
    'gpt-5.4-mini': {input: 0.75, cached: 0.075, output: 4.5},
    'gpt-5.4-nano': {input: 0.2, cached: 0.02, output: 1.25},
  },
};

/** "claude-haiku-4-5-20251001" → "claude-haiku-4-5"; "gpt-5.4-2026-03-05" → "gpt-5.4". */
export const baseModel = (provider: AiProvider, model: string) => model.replace(provider === 'openai' ? /-\d{4}-\d{2}-\d{2}$/ : /-\d{8}$/, '');

export interface Tokens {
  // Every input token, cached reads and cache writes included.
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  // Claude's web searches, $10 per 1,000 on top of the tokens (the claude-api skill, 2026-10).
  webSearches?: number;
}

/** One web search, in millionths of a dollar. */
export const WEB_SEARCH_MICROS = 10_000;

/** The call's cost in millionths of a dollar, or null for a model without a known rate. */
export function costMicros(provider: AiProvider, model: string, tokens: Tokens, cacheTtl: '5m' | '1h' = '5m'): number | null {
  const rate = RATES[provider][baseModel(provider, model)];
  if (!rate) return null;
  const cached = Math.min(tokens.cachedTokens, tokens.inputTokens);
  const writes = Math.min(tokens.cacheWriteTokens, tokens.inputTokens - cached);
  const plain = tokens.inputTokens - cached - writes;
  const premium = provider === 'anthropic' && baseModel(provider, model) === 'claude-haiku-5-5' && tokens.inputTokens > 100_000 ? 5 : 1;
  // Rates are dollars per million tokens, which is micro-dollars per token.
  const write = cacheTtl === '1h' ? 2 : 1.25;
  const searches = provider === 'anthropic' ? (tokens.webSearches ?? 0) * WEB_SEARCH_MICROS : 0;
  return Math.round((plain * rate.input + cached * rate.cached + writes * rate.input * write + tokens.outputTokens * rate.output) * premium) + searches;
}
