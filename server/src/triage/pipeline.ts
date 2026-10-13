// One email through triage (BRIEF.md › Triage): rules first, then the cheap model, then the strong
// model when the cheap one is unsure, and the policy last (src/domain/triagePolicy.ts).
//
// - A rule that decides the lane still has the cheap model read the email, for its organisation,
//   type, key date, summary and security facts (decision 10: extracted once, at triage); without a
//   model, or when it fails, the rule's lane stands with what the history pass can read.
// - Hard-risk mail (v1's words) goes straight to the strong model unless the user's rule names its
//   sender or keeps it in Attention.
// - The cheap model's Attention, unsure, unreadable or protected answers go to the strong model; an
//   unsure strong answer is FYI (decision 30).
// - With no model to ask and no rule deciding, the email can't be sorted: TriageUnavailable, and it
//   waits in Unsorted. A provider's refusal is thrown as it came, for the job's retry policy.
//
// Pure apart from `ask`, which the worker gives it (the model calls, their ledger and health).
import type {Lane, MessageType, Kind, TriageSource} from '@setpoint/shared';
import {escalation, historyReading, isSure, protectedFromText, settle} from '../domain/triagePolicy.ts';
import type {Reading, Settled} from '../domain/triagePolicy.ts';
import {firstMatch, hasHardRisk, needsReading, ruleDecides} from '../domain/triageRules.ts';
import type {Rule, RuleEmail} from '../domain/triageRules.ts';
import {detectVerificationCode} from '../domain/verificationCode.ts';

export type Tier = 'cheap' | 'strong';

export interface TriageEmail extends RuleEmail {
  // Read only for its verification code (SV-68): some senders put the code only in the HTML.
  bodyHtml: string | null;
  receivedAt: string;
  accountLabel: string | null;
}

export interface PipelineContext {
  rules: readonly Rule[];
  codeExpiryMinutes: number;
  // Asks a model; null when no model can be asked (no key). Resolves to null for an unusable answer.
  ask: ((tier: Tier, reason: string) => Promise<Reading | null>) | null;
}

export interface Outcome {
  settled: Settled;
  source: TriageSource;
  ruleId: number | null;
  tiers: Tier[];
}

/** No model to ask and no rule to decide: the email stays Unsorted until there is one. */
export class TriageUnavailable extends Error {
  constructor(message = 'Triage has no model to ask: add an Anthropic or OpenAI key in Settings › AI.') {
    super(message);
    this.name = 'TriageUnavailable';
  }
}

const sourceOfRule = (rule: Rule): TriageSource => (rule.source === 'learned' ? 'learned_rule' : 'rule');

/** What the rules decide once the email has been read, if anything. */
function decidingRule(context: PipelineContext, email: TriageEmail, reading: Reading | null, hardRisk: boolean): Rule | null {
  const extracted = reading ? {organisation: reading.organisation, type: reading.type} : null;
  const rule = firstMatch(context.rules.filter(candidate => candidate.lane !== null), email, extracted);
  return rule && ruleDecides(rule, hardRisk) ? rule : null;
}

export async function triageEmail(context: PipelineContext, email: TriageEmail, incomplete = false): Promise<Outcome> {
  const code = detectVerificationCode({subject: email.subject, snippet: email.snippet, bodyText: email.bodyText, bodyHtml: email.bodyHtml, receivedAt: email.receivedAt, expiryMinutes: context.codeExpiryMinutes});
  const textProtected = protectedFromText(email.subject, email.bodyText);
  const hardRisk = hasHardRisk(email);
  // Rules that need nothing read: can one decide before any model?
  const before = context.rules.filter(rule => !needsReading(rule.match) && rule.lane !== null);
  const preRule = firstMatch(before, email, null);
  const preDecides = preRule !== null && ruleDecides(preRule, hardRisk);
  const tiers: Tier[] = [];
  let cheap: Reading | null = null;
  let strong: Reading | null = null;

  if (!context.ask && !preDecides) throw new TriageUnavailable();
  if (context.ask) {
    const ask = context.ask;
    try {
      if (hardRisk && !preDecides) {
        tiers.push('strong');
        strong = await ask('strong', 'hard_risk');
      } else {
        tiers.push('cheap');
        cheap = await ask('cheap', preRule ? `rule:${preRule.key}` : 'no_rule');
        const why = preDecides ? null : escalation(cheap);
        if (why) {
          tiers.push('strong');
          strong = await ask('strong', `cheap_${why}`);
        }
      }
    } catch (error) {
      // The rule's lane stands without the model; anything else waits for it.
      if (!preDecides) throw error;
    }
  }

  const modelReading = tiers.includes('strong') ? strong ?? cheap : cheap;
  // Fields to keep even when no model read it (or its answer was unusable): the history pass's.
  const reading: Reading = modelReading ?? historyReading(email);
  const rule = decidingRule(context, email, modelReading ?? reading, hardRisk);

  let lane: Lane | null;
  let kind: Kind | null | undefined;
  let type: MessageType | null | undefined;
  let source: TriageSource;
  if (rule) {
    ({lane, kind, type} = rule);
    source = sourceOfRule(rule);
  } else if (tiers.includes('strong')) {
    lane = isSure(strong) ? strong.lane : null;
    source = lane ? 'strong_model' : 'unsure';
  } else {
    lane = isSure(cheap) ? cheap.lane : null;
    source = lane ? 'cheap_model' : 'unsure';
  }
  return {
    settled: settle({lane, kind, type, reading, code, textProtected, incomplete}),
    source, ruleId: rule?.id ?? null, tiers,
  };
}

/**
 * Backfilled history, sorted as it lands without a model: the rules, the history pass's reading,
 * then the same policy, as history (never Attention, SV-4 D19). Nothing is left Unsorted. Once a key
 * exists, the one-time extraction pass (src/triage/history.ts) has the cheap model fill in what this
 * reading guessed, without touching the lane.
 */
export function triageHistory(context: Pick<PipelineContext, 'rules' | 'codeExpiryMinutes'>, email: TriageEmail): Outcome {
  const code = detectVerificationCode({subject: email.subject, snippet: email.snippet, bodyText: email.bodyText, bodyHtml: email.bodyHtml, receivedAt: email.receivedAt, expiryMinutes: context.codeExpiryMinutes});
  const reading = historyReading(email);
  const rule = decidingRule({...context, ask: null}, email, reading, hasHardRisk(email));
  return {
    settled: settle({
      lane: rule ? rule.lane : reading.lane, kind: rule?.kind, type: rule?.type, reading, code,
      textProtected: protectedFromText(email.subject, email.bodyText), history: true,
    }),
    source: rule ? sourceOfRule(rule) : 'history', ruleId: rule?.id ?? null, tiers: [],
  };
}
