// Triage (B3): its health, the pattern prompt, rules written and learned, attention precision and
// Settings › AI (BRIEF.md › Triage, Health and states, Settings; DESIGN.md › Pattern prompt,
// Settings › Mail and › Accounts, Health and states).
//
//   GET    /api/mail/triage                 TriageStatusOut (the Unsorted line: "Triage is down, as of 9:09 AM",
//                                           and the history extraction pass's progress)
//   GET    /api/mail/prompts                PatternPromptOut[] (newest first; the Inbox shows the first)
//   POST   /api/mail/prompts/:id            {answer: 'yes' | 'no'}     PatternPromptOut[] (the prompts left)
//   GET    /api/mail/rules                  RuleOut[] (written by position, then learned, newest first)
//   POST   /api/mail/rules                  RuleInput                  RuleOut (201; a written rule, last)
//   PATCH  /api/mail/rules/:id              RuleUpdateInput            RuleOut
//   DELETE /api/mail/rules/:id              204 (a learned rule's prompt then stays quiet)
//   PUT    /api/mail/rules/order            {rule_ids}                 RuleOut[] (written rules' order)
//   GET    /api/mail/precision              PrecisionOut (Settings › Accounts, 30 days)
//   GET    /api/ai                          AiOut (Settings › AI: keys set, models in use, the catalogue, 30 days of
//                                           cost; N3: News's group and this month's usage)
//
// AI keys stay write-only secrets (PUT /api/secrets/anthropic_api_key, …/openai_api_key); model
// choices are settings (`ai.triage_model`, `ai.triage_strong_model`; null uses the built-in one).
import {z} from 'zod';
import {KINDS, LANES, MESSAGE_TYPES} from '../enums.ts';
import type {AiProvider, Kind, Lane, MessageType} from '../enums.ts';
import {id} from './common.ts';

/**
 * Why an email is protected (decision 29): it always goes to Attention and no rule or prompt moves
 * it. Password, recovery or two-step changes; an account deleted or locked; "critical" alerts; a
 * "was this you?" from a device or place the user doesn't use; money leaving an account.
 */
export const PROTECTED_REASONS = [
  'password_changed', 'recovery_changed', 'two_step_changed', 'account_deleted', 'account_locked',
  'critical_alert', 'unfamiliar_sign_in', 'money_leaving',
] as const;
export type ProtectedReason = (typeof PROTECTED_REASONS)[number];

/**
 * What decided an email's lane: a rule (written or shipped), a learned rule, the cheap or strong
 * model, the unsure default (FYI, decision 30), or the rules-only pass over backfilled history.
 */
export const TRIAGE_SOURCES = ['rule', 'learned_rule', 'cheap_model', 'strong_model', 'unsure', 'history'] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

/** Triage is healthy while its last model call succeeded; down (mail waits in Unsorted) otherwise. */
export const TRIAGE_STATES = ['healthy', 'down'] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

/** "Triage is down, as of 9:09 AM": `as_of` is the last successful model call. */
export interface TriageStatusOut {
  state: TriageState;
  as_of: string | null;
  // The provider's words, or what's missing ("Add an Anthropic or OpenAI key in Settings › AI.").
  reason: string | null;
  // Emails waiting in Unsorted.
  unsorted: number;
  // The one-time model pass over backfilled history (D20).
  history: HistoryExtractionOut;
}

/**
 * The extraction pass over backfilled history: backfilled emails the cheap model has read (`done`)
 * of all backfilled emails. It starts when every backfill has finished and a key is set (or from the
 * CLI); it waits while there's no key.
 */
export interface HistoryExtractionOut {
  state: 'not_started' | 'waiting_for_key' | 'running' | 'done';
  done: number;
  total: number;
}

/**
 * "You've cleared 4 Northwind newsletters without opening them. Send these to FYI from now on?"
 * The same organisation and type marked Done from the row, unopened, `count` times running
 * (`message_ids`, newest first; imported v1 corrections count but have no id). Never offered for
 * protected mail, so `protected` is always false. Yes makes a learned rule sending them to `lane`
 * as `kind`; No keeps this prompt quiet for good. `id` stays the same for an organisation and
 * type, while the count grows.
 */
export interface PatternPromptOut {
  id: number;
  organisation: string;
  type: MessageType;
  count: number;
  protected: false;
  message_ids: number[];
  lane: Extract<Lane, 'fyi'>;
  // The FYI group the learned rule would put them in (the kind they mostly had).
  kind: Kind;
}

export const patternPromptAnswerInput = z.strictObject({answer: z.enum(['yes', 'no'])});
export type PatternPromptAnswerInput = z.infer<typeof patternPromptAnswerInput>;

const phrase = z.string().trim().min(1).max(200);
const phrases = z.array(phrase).min(1).max(50);
const pattern = z.string().min(1).max(500).refine(value => {
  try {
    new RegExp(value, 'i');
    return true;
  } catch {
    return false;
  }
}, 'Not a valid regular expression');

/**
 * What a rule matches, in v1's `preflight-rules.json` shape (harvested, SV-4). Sender keys are
 * alternatives (any one matching is enough); every other key present must match too. Text matches
 * ignore case. `from_domains` matches the domain and its subdomains ("woodgrovebank.example" matches
 * "alerts.woodgrovebank.example"). `organisation` and `type` match what triage extracted, so a rule with either
 * applies once the model has read the email.
 */
export const ruleMatchSchema = z.strictObject({
  from_addresses: z.array(z.string().trim().toLowerCase().min(3).max(320)).min(1).max(50).optional(),
  from_domains: z.array(z.string().trim().toLowerCase().regex(/^([a-z0-9-]+\.)+[a-z]{2,63}$/, 'A domain such as woodgrovebank.example')).min(1).max(50).optional(),
  from_name_includes: phrases.optional(),
  subject_includes: phrases.optional(),
  subject_regex: pattern.optional(),
  body_includes: phrases.optional(),
  body_regex: pattern.optional(),
  // None of these anywhere (sender, subject, body): v1's escape hatch for risky words.
  none_includes: phrases.optional(),
  organisation: phrase.optional(),
  type: z.enum(MESSAGE_TYPES).optional(),
}).refine(match => Object.entries(match).some(([key, value]) => key !== 'none_includes' && value !== undefined), 'A rule needs something to match');
export type RuleMatch = z.infer<typeof ruleMatchSchema>;

/** Settings › Mail's "Add rule": a written rule ("From woodgrovebank.example → FYI · Money"). Noise has no kind. */
export const ruleInput = z.strictObject({
  match: ruleMatchSchema,
  lane: z.enum(LANES),
  kind: z.enum(KINDS).nullable().default(null),
  enabled: z.boolean().default(true),
}).refine(rule => rule.lane !== 'noise' || rule.kind === null, 'Noise has no kind');
export type RuleInput = z.infer<typeof ruleInput>;

export const ruleUpdateInput = z.strictObject({
  match: ruleMatchSchema,
  lane: z.enum(LANES),
  kind: z.enum(KINDS).nullable(),
  enabled: z.boolean(),
}).partial().refine(changes => Object.keys(changes).length > 0, 'Nothing to change');
export type RuleUpdateInput = z.infer<typeof ruleUpdateInput>;

export const ruleOrderInput = z.strictObject({rule_ids: z.array(id).min(1)});

export const RULE_ORIGINS = ['written', 'learned'] as const;
export type RuleOrigin = (typeof RULE_ORIGINS)[number];

/** A rule in Settings › Mail: written ones in their order (drag), learned ones from pattern prompts. */
export interface RuleOut {
  id: number;
  origin: RuleOrigin;
  match: RuleMatch;
  lane: Lane;
  kind: Kind | null;
  // Written rules' order; learned rules apply after every written one.
  position: number;
  enabled: boolean;
  // Brought over from v1 (B7's import).
  imported: boolean;
  created_at: string;
  // Emails it sorted this calendar month ("9 this month").
  matches_this_month: number;
}

/**
 * Attention precision (Settings › Accounts): of the attention mail marked Done, the share opened
 * first, over the last 30 days ("82% · 18% of attention mail was marked Done without opening").
 * `days` are the 30 local days, oldest first, for the sparkline; `precision` is null with nothing Done.
 */
export interface PrecisionOut {
  precision: number | null;
  done: number;
  opened_before_done: number;
  from: string;
  to: string;
  days: {date: string; done: number; opened_before_done: number}[];
}

/** A model Settings › AI offers. */
export interface AiModelOut {
  id: string;
  provider: AiProvider;
  label: string;
}

export interface AiModelChoiceOut {
  provider: AiProvider;
  model: string;
}

/** Settings › AI: which keys are set (never their values), the models triage and Alfred use, and what they cost. */
export interface AiOut {
  keys: Record<AiProvider, boolean>;
  // Null when no key fits: triage can't use a model (Unsorted, unless a rule decides).
  triage: {cheap: AiModelChoiceOut | null; strong: AiModelChoiceOut | null; history: AiModelChoiceOut | null};
  // B4: the model Alfred asks (`ai.alfred_model`, or the default for the key that's set); null without a key.
  alfred: AiModelChoiceOut | null;
  // The model each setting's Default stands for with the keys that are set, whatever is chosen, so
  // the picker can say "Default (Claude Sonnet 5.5)"; null without a key (UX #14).
  defaults: {triage_model: string | null; triage_strong_model: string | null; history_model: string | null; alfred_model: string | null};
  models: AiModelOut[];
  usage_30_days: {calls: number; input_tokens: number; output_tokens: number; cost_usd: number};
  // N3: Settings › AI's News group (board 30b).
  news: NewsAiOut;
  // N3: "Usage this month" (since local midnight on the 1st): Triage, Alfred and News, News in its parts.
  usage_this_month: {
    since: string;
    triage: AiUsageOut;
    alfred: AiUsageOut;
    news: AiUsageOut & {articles: AiUsageOut; grouping: AiUsageOut; stories: AiUsageOut; ranking: AiUsageOut};
  };
}

export interface AiUsageOut {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/**
 * News's models and cost (D90): Claude Haiku 5.5 reads each article and groups ("Articles and
 * grouping"), Claude Sonnet 5.5 writes stories and ranks them ("Stories and ranking"), on the
 * Anthropic key. Past the monthly cap (the `news.monthly_cap_usd` setting, $40 by default) story summaries
 * use Haiku for the rest of the month: `capped`, and `summaries_model` names what writes them now.
 * The meter reads "$18.40 of $40" from `this_month_usd` and `monthly_cap_usd`.
 */
export interface NewsAiOut {
  articles_model: string;
  stories_model: string;
  summaries_model: string;
  capped: boolean;
  monthly_cap_usd: number;
  this_month_usd: number;
  // Why News can't sort ("News needs an Anthropic key in Settings › AI."); null when it can.
  missing: string | null;
}

/**
 * The models Settings › AI lists: current Claude models (claude-api skill, 2026-10) and v1's curated
 * OpenAI Responses models. Any other id can still be saved.
 */
export const AI_MODELS: readonly AiModelOut[] = [
  {id: 'claude-haiku-5-5', provider: 'anthropic', label: 'Claude Haiku 5.5'},
  {id: 'claude-sonnet-5-5', provider: 'anthropic', label: 'Claude Sonnet 5.5'},
  {id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5'},
  {id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5'},
  {id: 'claude-sonnet-4-6', provider: 'anthropic', label: 'Claude Sonnet 4.6'},
  {id: 'gpt-5.4-nano', provider: 'openai', label: 'GPT-5.4 nano'},
  {id: 'gpt-5.4-mini', provider: 'openai', label: 'GPT-5.4 mini'},
  {id: 'gpt-5.5', provider: 'openai', label: 'GPT-5.5'},
  {id: 'gpt-5.6-luna', provider: 'openai', label: 'GPT-5.6 Luna'},
  {id: 'gpt-5.6-sol', provider: 'openai', label: 'GPT-5.6 Sol'},
];
