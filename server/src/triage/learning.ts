// The learning loop over the record (decisions 27, 28; src/domain/learning.ts has the rules): pattern
// prompts from repeated Done without opening, Yes into a learned rule and No into quiet, the rules
// Settings › Mail lists (written and learned), attention precision for Settings › Accounts, and
// Settings › AI's overview.
import {AI_MODELS} from '@setpoint/shared';
import type {AiOut, PatternPromptOut, PrecisionOut, RuleInput, RuleOut, RuleUpdateInput} from '@setpoint/shared';
import {and, count, eq, gte, inArray, isNotNull, sql, sum} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {attentionPrecision, patternPrompts, promptKey} from '../domain/learning.ts';
import type {Verdict} from '../domain/learning.ts';
import {localDay, zonedInstant} from '../domain/time.ts';
import {organisationKey} from '../domain/triageRules.ts';
import {conflict, invalid, notFound} from '../errors.ts';
import {getSettings} from '../settings.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {aiKeys, chooseTriageModels} from './models.ts';
import {chooseAlfredModel} from '../alfred/models.ts';
import {newsAiOverview, usageThisMonth} from '../news/models.ts';

type PromptRow = typeof t.patternPrompts.$inferSelect;
type RuleRow = typeof t.triageRules.$inferSelect;

const touched = (store: Store) => noteLive(store, {type: 'mail', messages: [], accounts: [], commands: []});

// ---- Pattern prompts ----

/**
 * Every verdict on attention mail: Done opened or not (new mail only; backfilled history was never
 * in the queue), and v1's imported corrections in or out of Attention.
 */
export function verdicts(store: Store): Verdict[] {
  const done = store.db.select().from(t.messages).where(and(
    eq(t.messages.lane, 'attention'), isNotNull(t.messages.doneAt), eq(t.messages.backfill, false), isNotNull(t.messages.organisation), isNotNull(t.messages.type),
  )).all().map(row => ({
    organisation: row.organisation!, type: row.type!, kind: row.kind, protected: row.protected, opened: row.openedBeforeDone === true, at: row.doneAt!, messageId: row.id,
  }));
  const imported = store.db.select().from(t.triageEvidence).where(isNotNull(t.triageEvidence.type)).all()
    .filter(row => (row.fromLane === 'attention') !== (row.toLane === 'attention'))
    .map(row => ({organisation: row.organisation, type: row.type!, kind: null, protected: false, opened: row.toLane === 'attention', at: row.at, messageId: null}));
  return [...done, ...imported];
}

/** Patterns that mustn't be asked about: answered, or already covered by a learned rule. */
function quietKeys(store: Store): Set<string> {
  const quiet = new Set(store.db.select().from(t.patternPrompts).where(isNotNull(t.patternPrompts.answer)).all().map(row => promptKey(row.organisation, row.type)));
  for (const rule of store.db.select().from(t.triageRules).where(eq(t.triageRules.origin, 'learned')).all()) {
    if (rule.match.organisation && rule.match.type) quiet.add(promptKey(rule.match.organisation, rule.match.type));
  }
  return quiet;
}

const presentPrompt = (row: PromptRow): PatternPromptOut => ({
  id: row.id, organisation: row.organisation, type: row.type, count: row.count, protected: false, message_ids: row.messageIds, lane: 'fyi', kind: row.kind,
});

/**
 * The open pattern prompts, newest first, each written down the first time so its id and answer
 * last (and its count kept current).
 */
export function currentPrompts(store: Store): PatternPromptOut[] {
  return transaction(store, () => {
    const now = isoNow(store);
    return patternPrompts(verdicts(store), quietKeys(store)).map(prompt => {
      const key = organisationKey(prompt.organisation);
      const values = {organisation: prompt.organisation, kind: prompt.kind, count: prompt.count, messageIds: prompt.messageIds};
      const row = store.db.insert(t.patternPrompts).values({organisationKey: key, type: prompt.type, createdAt: now, ...values})
        .onConflictDoUpdate({target: [t.patternPrompts.organisationKey, t.patternPrompts.type], set: values}).returning().get()!;
      return presentPrompt(row);
    });
  });
}

/**
 * Yes or No to a prompt Attention shows. Yes adds a learned rule (organisation and type to FYI, as
 * the kind they mostly had), applied to new mail from now on; No keeps the prompt quiet for good.
 * Either way the prompts left come back.
 */
export function answerPrompt(store: Store, id: number, answer: 'yes' | 'no'): PatternPromptOut[] {
  transaction(store, () => {
    const row = store.db.select().from(t.patternPrompts).where(eq(t.patternPrompts.id, id)).get();
    if (!row) throw notFound('No such prompt.');
    if (row.answer) throw conflict('answered', 'That prompt was answered already.');
    if (!currentPrompts(store).some(prompt => prompt.id === id)) throw conflict('no_prompt', 'That pattern isn\'t being offered any more.');
    const now = isoNow(store);
    let ruleId: number | null = null;
    if (answer === 'yes') {
      ruleId = store.db.insert(t.triageRules).values({
        origin: 'learned', match: {organisation: row.organisation, type: row.type}, lane: 'fyi', kind: row.kind, position: 0, createdAt: now,
      }).returning({id: t.triageRules.id}).get()!.id;
    }
    store.db.update(t.patternPrompts).set({answer, ruleId, answeredAt: now}).where(eq(t.patternPrompts.id, id)).run();
    touched(store);
  });
  return currentPrompts(store);
}

// ---- Rules (Settings › Mail) ----

function monthStart(store: Store): string {
  const today = localDay(isoNow(store), store.timeZone);
  return zonedInstant(`${today.slice(0, 7)}-01`, '00:00', store.timeZone);
}

function presentRules(store: Store, rows: RuleRow[]): RuleOut[] {
  const ids = rows.map(row => row.id);
  const hits = new Map(ids.length
    ? store.db.select({id: t.messages.triageRuleId, n: count()}).from(t.messages)
      .where(and(inArray(t.messages.triageRuleId, ids), gte(t.messages.receivedAt, monthStart(store)))).groupBy(t.messages.triageRuleId).all()
      .map(row => [row.id!, row.n])
    : []);
  return rows.map(row => ({
    id: row.id, origin: row.origin, match: row.match, lane: row.lane, kind: row.kind, position: row.position, enabled: row.enabled,
    imported: row.importedFrom !== null, created_at: row.createdAt, matches_this_month: hits.get(row.id) ?? 0,
  }));
}

const ruleRow = (store: Store, id: number) => store.db.select().from(t.triageRules).where(eq(t.triageRules.id, id)).get();

/** Written rules in their order, then learned rules, newest first. */
export function listRules(store: Store): RuleOut[] {
  const rows = store.db.select().from(t.triageRules).all();
  const written = rows.filter(row => row.origin === 'written').sort((a, b) => a.position - b.position || a.id - b.id);
  const learned = rows.filter(row => row.origin === 'learned').sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  return presentRules(store, [...written, ...learned]);
}

/** A written rule, after every other written rule. It sorts new mail; mail already sorted stays. */
export function createRule(store: Store, input: RuleInput, importedFrom: string | null = null): RuleOut {
  return transaction(store, () => {
    const last = store.db.select({position: sql<number>`max(${t.triageRules.position})`}).from(t.triageRules).where(eq(t.triageRules.origin, 'written')).get();
    const row = store.db.insert(t.triageRules).values({
      origin: 'written', match: input.match, lane: input.lane, kind: input.lane === 'noise' ? null : input.kind, enabled: input.enabled,
      position: (last?.position ?? -1) + 1, importedFrom, createdAt: isoNow(store),
    }).returning().get()!;
    return presentRules(store, [row])[0]!;
  });
}

export function updateRule(store: Store, id: number, changes: RuleUpdateInput): RuleOut {
  return transaction(store, () => {
    const row = ruleRow(store, id);
    if (!row) throw notFound('No such rule.');
    const lane = changes.lane ?? row.lane;
    const kind = lane === 'noise' ? null : changes.kind !== undefined ? changes.kind : row.kind;
    if (changes.lane === 'noise' && changes.kind) throw invalid('Noise has no kind.');
    const updated = store.db.update(t.triageRules).set({
      ...(changes.match ? {match: changes.match} : {}), lane, kind, ...(changes.enabled !== undefined ? {enabled: changes.enabled} : {}),
    }).where(eq(t.triageRules.id, id)).returning().get()!;
    return presentRules(store, [updated])[0]!;
  });
}

/**
 * Deletes a rule. Undoing a learned rule also says No to its prompt, so it isn't offered again the
 * moment the rule is gone.
 */
export function deleteRule(store: Store, id: number) {
  transaction(store, () => {
    const row = ruleRow(store, id);
    if (!row) throw notFound('No such rule.');
    if (row.origin === 'learned') {
      store.db.update(t.patternPrompts).set({answer: 'no', ruleId: null}).where(eq(t.patternPrompts.ruleId, id)).run();
    }
    store.db.delete(t.triageRules).where(eq(t.triageRules.id, id)).run();
  });
}

/** Settings › Mail's drag: the written rules' new order, every written rule named once. */
export function reorderRules(store: Store, ruleIds: number[]): RuleOut[] {
  return transaction(store, () => {
    const written = store.db.select({id: t.triageRules.id}).from(t.triageRules).where(eq(t.triageRules.origin, 'written')).all().map(row => row.id);
    if (ruleIds.length !== written.length || new Set(ruleIds).size !== ruleIds.length || !ruleIds.every(id => written.includes(id))) {
      throw invalid('Name every written rule once, in the new order.');
    }
    ruleIds.forEach((id, position) => store.db.update(t.triageRules).set({position}).where(eq(t.triageRules.id, id)).run());
    return listRules(store);
  });
}

// ---- Attention precision and Settings › AI ----

/** Of the attention mail marked Done in the last 30 days, the share opened first. */
export function precision(store: Store): PrecisionOut {
  const rows = store.db.select({doneAt: t.messages.doneAt, opened: t.messages.openedBeforeDone}).from(t.messages)
    .where(and(eq(t.messages.lane, 'attention'), isNotNull(t.messages.doneAt), eq(t.messages.backfill, false))).all()
    .map(row => ({doneAt: row.doneAt!, opened: row.opened === true}));
  const result = attentionPrecision(rows, isoNow(store), store.timeZone);
  return {
    precision: result.precision, done: result.done, opened_before_done: result.opened, from: result.from, to: result.to,
    days: result.days.map(day => ({date: day.date, done: day.done, opened_before_done: day.opened})),
  };
}

export function aiOverview(store: Store): AiOut {
  const keys = aiKeys(store);
  const ai = getSettings(store).ai;
  const chosen = chooseTriageModels(ai, keys);
  // Each model's Default, as if nothing were chosen.
  const unchosen = {...ai, triage_model: null, triage_strong_model: null, history_model: null, alfred_model: null};
  const builtIn = chooseTriageModels(unchosen, keys);
  const since = new Date(store.now().getTime() - 30 * 86_400_000).toISOString();
  const usage = store.db.select({calls: count(), input: sum(t.aiUsage.inputTokens), output: sum(t.aiUsage.outputTokens), cost: sum(t.aiUsage.costMicros)})
    .from(t.aiUsage).where(gte(t.aiUsage.at, since)).get();
  return {
    keys, triage: {cheap: chosen.cheap, strong: chosen.strong, history: chosen.history}, alfred: chooseAlfredModel(ai, keys).choice,
    defaults: {
      triage_model: builtIn.cheap?.model ?? null, triage_strong_model: builtIn.strong?.model ?? null, history_model: builtIn.history?.model ?? null,
      alfred_model: chooseAlfredModel(unchosen, keys).choice?.model ?? null,
    },
    models: [...AI_MODELS],
    usage_30_days: {calls: usage?.calls ?? 0, input_tokens: Number(usage?.input ?? 0), output_tokens: Number(usage?.output ?? 0), cost_usd: Number(usage?.cost ?? 0) / 1_000_000},
    news: newsAiOverview(store), usage_this_month: usageThisMonth(store),
  };
}
