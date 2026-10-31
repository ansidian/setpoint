// News's models and cost (N3; BRIEF.md › Models and cost, D90): Claude Haiku 5.5 reads each article
// and groups, Claude Sonnet 5.5 writes stories and ranks them, on the Anthropic key in Settings › AI
// (the production key in production). Each call goes in the AI usage ledger with its own purpose
// (news_articles, news_grouping, news_stories, news_ranking). Past the monthly cap
// (`news.monthly_cap_usd`, $40 by default) story summaries use Haiku for the rest of the month.
// Settings › AI's News group and "Usage this month" come from here.
import type {AiPurpose, AiUsageOut, AiOut, NewsAiOut} from '@setpoint/shared';
import {and, count, gte, inArray, sum} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {costMicros} from '../domain/aiCost.ts';
import {monthStart, NEWS_MODELS, summaryModel} from '../domain/newsSorting.ts';
import {modelClient} from '../providers/ai/index.ts';
import type {AiEndpoints, ModelAnswer, ModelClient} from '../providers/ai/index.ts';
import {getSettings} from '../settings.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {aiKeys, keyOf} from '../triage/models.ts';

export const NEWS_PURPOSES = ['news_articles', 'news_grouping', 'news_stories', 'news_ranking'] as const satisfies readonly AiPurpose[];
export type NewsPurpose = (typeof NEWS_PURPOSES)[number];

export const NO_NEWS_KEY = 'News needs an Anthropic key in Settings › AI.';

/** Writes a News model call to the AI usage ledger. */
export function recordNewsUsage(store: Store, answer: ModelAnswer, purpose: NewsPurpose, cacheTtl: '5m' | '1h' = '5m') {
  store.db.insert(t.aiUsage).values({
    at: isoNow(store), provider: answer.provider, model: answer.model, purpose, messageId: null,
    inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens, cachedTokens: answer.usage.cachedTokens,
    costMicros: costMicros(answer.provider, answer.model, answer.usage, cacheTtl) ?? 0,
  }).run();
}

function usage(store: Store, since: string, purposes: readonly AiPurpose[]): AiUsageOut {
  const row = store.db.select({calls: count(), input: sum(t.aiUsage.inputTokens), output: sum(t.aiUsage.outputTokens), cost: sum(t.aiUsage.costMicros)})
    .from(t.aiUsage).where(and(gte(t.aiUsage.at, since), inArray(t.aiUsage.purpose, [...purposes]))).get();
  return {calls: row?.calls ?? 0, input_tokens: Number(row?.input ?? 0), output_tokens: Number(row?.output ?? 0), cost_usd: Number(row?.cost ?? 0) / 1_000_000};
}

/** What News has cost this month, in dollars. */
export const newsSpentThisMonth = (store: Store) => usage(store, monthStart(isoNow(store), store.timeZone), NEWS_PURPOSES).cost_usd;

export interface NewsModel {
  client: ModelClient;
  model: string;
}

export interface NewsClients {
  // Each article and grouping.
  articles: NewsModel;
  // Story summaries: Sonnet, or Haiku past the cap.
  stories: NewsModel;
  ranking: NewsModel;
}

/** The clients for News's models with the Anthropic key; null without one. */
export function newsClients(store: Store, endpoints: AiEndpoints, timeoutMs?: number): NewsClients | null {
  const apiKey = keyOf(store, 'anthropic');
  if (!apiKey) return null;
  const client = modelClient('anthropic', {apiKey, baseUrl: endpoints.anthropic, timeoutMs});
  const cap = getSettings(store).news.monthly_cap_usd;
  return {
    articles: {client, model: NEWS_MODELS.articles},
    stories: {client, model: summaryModel(newsSpentThisMonth(store), cap)},
    ranking: {client, model: NEWS_MODELS.stories},
  };
}

/** Settings › AI's News group (board 30b). */
export function newsAiOverview(store: Store): NewsAiOut {
  const cap = getSettings(store).news.monthly_cap_usd;
  const spent = newsSpentThisMonth(store);
  const summaries = summaryModel(spent, cap);
  return {
    articles_model: NEWS_MODELS.articles, stories_model: NEWS_MODELS.stories, summaries_model: summaries, capped: summaries !== NEWS_MODELS.stories,
    monthly_cap_usd: cap, this_month_usd: spent, missing: aiKeys(store).anthropic ? null : NO_NEWS_KEY,
  };
}

/** "Usage this month": Triage, search terms, reading searches, Alfred and News, News in its parts. */
export function usageThisMonth(store: Store): AiOut['usage_this_month'] {
  const since = monthStart(isoNow(store), store.timeZone);
  const part = (purpose: NewsPurpose) => usage(store, since, [purpose]);
  return {
    since, triage: usage(store, since, ['triage']), search_terms: usage(store, since, ['search_terms']), search_reading: usage(store, since, ['search_reading']), alfred: usage(store, since, ['alfred']),
    news: {...usage(store, since, NEWS_PURPOSES), articles: part('news_articles'), grouping: part('news_grouping'), stories: part('news_stories'), ranking: part('news_ranking')},
  };
}

