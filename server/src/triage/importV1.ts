// v1's triage rules and lane corrections, brought over as seed evidence for the learning loop
// (BUILD-PLAN.md › B3 › Imports; the real import is B7's). B7's export script, run in v1's
// repository, writes one JSON file; this reads it. The format, version 1:
//
//   {
//     "format": "setpoint-v1-triage",
//     "version": 1,
//     "exported_at": "2026-10-20T17:00:00.000Z",
//     "rules": [                               // v1's ea_triage_rules rows, in any order
//       {
//         "name": "Woodgrove Bank statements",          // unique in v1; the import is keyed by it
//         "enabled": true,
//         "priority": 40,                      // lower runs first, as in v1
//         "rule_type": "sender",               // v1's label; kept only in the report
//         "match": {…},                        // v1's match_json, as an object (preflight-rules shape)
//         "lane": "needs_attention" | "fyi" | "noise" | null,
//         "category": "finance" | … | null,    // v1's categories
//         "route_to_model": "strong" | null,
//         "reason": "Routine statement."
//       }
//     ],
//     "corrections": [                         // v1's lane corrections (ea_triage_feedback, lane type)
//       {
//         "account": "user@example.com",       // the receiving account's address
//         "from_name": "Northwind Engineering",
//         "from_address": "digest@eng.northwind.example",
//         "subject": "Northwind Engineering Digest · September 2",
//         "received_at": "2026-09-02T13:30:00.000Z",
//         "from_lane": "needs_attention" | "fyi" | "noise",
//         "to_lane": "needs_attention" | "fyi" | "noise",
//         "corrected_at": "2026-09-02T14:40:00.000Z"
//       }
//     ]
//   }
//
// Rules that decided a lane in v1 become written rules (Settings › Mail, marked imported), after
// any written already, in v1's priority order; importing again replaces them by name. What v1
// could do that v2 doesn't is reported, not guessed: rules that only routed to a model (v2's model
// always reads), audits, and `any_includes` / `all_includes` matches are skipped; body matches v1
// never turned on come over disabled. Corrections become evidence (table triage_evidence): out of
// Attention counts as cleared without opening, into it as opened first, toward the pattern prompts.
// Their organisation and type are read without a model, as for backfilled history.
import {createHash} from 'node:crypto';
import {ruleMatchSchema} from '@setpoint/shared';
import type {Kind, Lane, RuleMatch} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {z} from 'zod';
import * as t from '../db/schema.ts';
import {organisationFromSender, typeFromText} from '../domain/triagePolicy.ts';
import {organisationKey} from '../domain/triageRules.ts';
import {parse} from '../errors.ts';
import {noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {createRule, updateRule} from './learning.ts';

const v1Lane = z.enum(['needs_attention', 'actionable', 'fyi', 'noise']);
const strings = z.array(z.string()).optional();

/** v1's match_json keys, as its preflight engine read them. */
const v1MatchSchema = z.looseObject({
  enabled: z.boolean().optional(),
  action: z.string().optional(),
  mode: z.string().optional(),
  from_addresses: strings, from_domains: strings, from_domain_suffixes: strings, from_name_includes: strings,
  subject_includes: strings, subject_regex: z.string().optional(), snippet_includes: strings,
  body_includes: strings, body_regex: z.string().optional(), allow_body_match: z.boolean().optional(), body_match_enabled: z.boolean().optional(),
  all_includes: strings, any_includes: strings, none_includes: strings,
});

export const v1ExportSchema = z.strictObject({
  format: z.literal('setpoint-v1-triage'),
  version: z.literal(1),
  exported_at: z.iso.datetime(),
  rules: z.array(z.strictObject({
    name: z.string().min(1).max(200),
    enabled: z.boolean(),
    priority: z.number(),
    rule_type: z.string(),
    match: v1MatchSchema,
    lane: v1Lane.nullable(),
    category: z.string().nullable(),
    route_to_model: z.enum(['strong', 'cheap']).nullable(),
    reason: z.string(),
  })),
  corrections: z.array(z.strictObject({
    account: z.string(),
    from_name: z.string(),
    from_address: z.string(),
    subject: z.string(),
    received_at: z.iso.datetime(),
    from_lane: v1Lane,
    to_lane: v1Lane,
    corrected_at: z.iso.datetime(),
  })),
});
export type V1Export = z.infer<typeof v1ExportSchema>;

export interface ImportReport {
  rules: {imported: number; disabled: string[]; skipped: {name: string; why: string}[]};
  corrections: {imported: number; already: number; ignored: number; toward_prompts: number};
}

const laneOf = (lane: z.infer<typeof v1Lane>): Lane => (lane === 'needs_attention' || lane === 'actionable' ? 'attention' : lane);

/** v1's categories as v2's FYI kinds (marketing and uncategorized have none). */
const KIND_OF_CATEGORY: Record<string, Kind | null> = {
  finance: 'money', utilities: 'money', delivery: 'deliveries', security: 'security', school: 'updates', legal: 'updates', infra: 'updates',
  updates: 'updates', product: 'updates', personal: 'people', work: 'other', social: 'other', marketing: null, uncategorized: null,
};

type V1Rule = V1Export['rules'][number];

/** One v1 rule as a v2 written rule, or why it can't be one. */
export function ruleFromV1(rule: V1Rule): {match: RuleMatch; lane: Lane; kind: Kind | null; enabled: boolean} | {why: string} {
  const match = rule.match;
  const mode = match.action ?? match.mode;
  if (mode === 'audit') return {why: 'an audit in v1: it never decided a lane'};
  if (mode === 'route_model' || (!rule.lane && rule.route_to_model)) return {why: 'it only sent mail to a model, which v2 always does'};
  if (!rule.lane) return {why: 'it has no lane'};
  if (match.any_includes?.length || match.all_includes?.length) return {why: 'v2 rules have no any_includes or all_includes'};
  const bodyAllowed = match.allow_body_match === true || match.body_match_enabled === true;
  const nonEmpty = (values: string[] | undefined) => (values?.length ? values : undefined);
  const candidate = {
    from_addresses: nonEmpty(match.from_addresses?.map(value => value.toLowerCase())),
    // v1's exact domains and suffixes both become v2's domains, which match subdomains too.
    from_domains: nonEmpty([...(match.from_domains ?? []), ...(match.from_domain_suffixes ?? [])].map(value => value.toLowerCase())),
    from_name_includes: nonEmpty(match.from_name_includes),
    subject_includes: nonEmpty(match.subject_includes),
    subject_regex: match.subject_regex,
    // The snippet is the body's start.
    body_includes: nonEmpty([...(match.snippet_includes ?? []), ...(match.body_includes ?? [])]),
    body_regex: match.body_regex,
    none_includes: nonEmpty(match.none_includes),
  };
  const parsed = ruleMatchSchema.safeParse(Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined)));
  if (!parsed.success) return {why: `its match doesn't fit v2 (${parsed.error.issues.map(issue => issue.message).join('; ')})`};
  const lane = laneOf(rule.lane);
  const kind = lane === 'noise' ? null : KIND_OF_CATEGORY[rule.category ?? 'uncategorized'] ?? null;
  // v1 ignored body matches unless they were turned on: such a rule never matched there.
  const bodyOff = Boolean(match.body_includes?.length || match.body_regex) && !bodyAllowed;
  return {match: parsed.data, lane, kind, enabled: rule.enabled && match.enabled !== false && mode !== 'disabled' && !bodyOff};
}

const dedupeOf = (correction: V1Export['corrections'][number]) =>
  createHash('sha256').update([correction.account, correction.from_address, correction.subject, correction.received_at, correction.corrected_at].join('\u0000')).digest('hex');

/** Imports B7's v1 triage file (already parsed JSON). Safe to run twice. */
export function importV1Triage(store: Store, file: unknown): ImportReport {
  const data = parse(v1ExportSchema, file);
  const report: ImportReport = {rules: {imported: 0, disabled: [], skipped: []}, corrections: {imported: 0, already: 0, ignored: 0, toward_prompts: 0}};
  transaction(store, () => {
    for (const rule of [...data.rules].sort((a, b) => a.priority - b.priority)) {
      const converted = ruleFromV1(rule);
      if ('why' in converted) {
        report.rules.skipped.push({name: rule.name, why: converted.why});
        continue;
      }
      const importedFrom = `v1:${rule.name}`;
      const existing = store.db.select().from(t.triageRules).where(eq(t.triageRules.importedFrom, importedFrom)).get();
      if (existing) updateRule(store, existing.id, converted);
      else createRule(store, converted, importedFrom);
      report.rules.imported += 1;
      if (!converted.enabled) report.rules.disabled.push(rule.name);
    }
    for (const correction of data.corrections) {
      const fromLane = laneOf(correction.from_lane);
      const toLane = laneOf(correction.to_lane);
      if (fromLane === toLane) {
        report.corrections.ignored += 1;
        continue;
      }
      const {organisation} = organisationFromSender(correction.from_name, correction.from_address);
      const type = typeFromText(correction.subject, '');
      const inserted = store.db.insert(t.triageEvidence).values({
        source: 'v1_correction', organisation: organisation ?? correction.from_address, organisationKey: organisationKey(organisation ?? correction.from_address),
        type, fromAddress: correction.from_address.toLowerCase(), subject: correction.subject, fromLane, toLane, at: correction.corrected_at, dedupe: dedupeOf(correction),
      }).onConflictDoNothing().run();
      if (!inserted.changes) {
        report.corrections.already += 1;
        continue;
      }
      report.corrections.imported += 1;
      if (type && (fromLane === 'attention') !== (toLane === 'attention')) report.corrections.toward_prompts += 1;
    }
    noteLive(store, {type: 'mail', messages: [], accounts: [], commands: []});
  });
  return report;
}
