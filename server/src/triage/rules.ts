// Triage's rules as it applies them: the user's written rules in their order, then learned rules, then the
// shipped defaults (defaultRules.json). The defaults keep v1's `preflight-rules.json` structure
// (key, priority, match, lane, reason; harvested, SV-4) with v1's generic rules only: the user's own v1
// rules, which name their senders, come over through B7's import (src/triage/importV1.ts) as written
// rules. v1's loader refused a broken catalogue at start rather than let a bad pattern quietly stop
// matching; so does this one.
import fs from 'node:fs';
import {KINDS, LANES, MESSAGE_TYPES, ruleMatchSchema} from '@setpoint/shared';
import {asc, desc, eq} from 'drizzle-orm';
import {z} from 'zod';
import * as t from '../db/schema.ts';
import type {Rule} from '../domain/triageRules.ts';
import type {Store} from '../store.ts';

const DEFAULT_RULES_FILE = new URL('./defaultRules.json', import.meta.url);

const defaultRuleSchema = z.strictObject({
  key: z.string().min(1),
  priority: z.number(),
  match: ruleMatchSchema,
  lane: z.enum(LANES).nullable(),
  kind: z.enum(KINDS).nullable(),
  type: z.enum(MESSAGE_TYPES).nullable(),
  reason: z.string().min(1),
});

/** The shipped defaults, in priority order; throws (naming the rule) on a broken catalogue. */
export function loadDefaultRules(file: URL | string = DEFAULT_RULES_FILE): Rule[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Triage's default rules (${String(file)}) can't be read: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
  }
  if (!Array.isArray(raw)) throw new Error(`Triage's default rules (${String(file)}) must be an array.`);
  const seen = new Set<string>();
  const rules = raw.map((entry, index) => {
    const parsed = defaultRuleSchema.safeParse(entry);
    const name = typeof (entry as {key?: unknown})?.key === 'string' ? `"${(entry as {key: string}).key}"` : `#${index + 1}`;
    if (!parsed.success) throw new Error(`Triage's default rule ${name} is invalid: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
    if (seen.has(parsed.data.key)) throw new Error(`Triage's default rule "${parsed.data.key}" appears twice.`);
    if (parsed.data.lane === 'noise' && parsed.data.kind) throw new Error(`Triage's default rule "${parsed.data.key}" gives Noise a kind.`);
    seen.add(parsed.data.key);
    return parsed.data;
  });
  return rules.sort((a, b) => a.priority - b.priority)
    .map(rule => ({id: null, key: rule.key, source: 'default' as const, match: rule.match, lane: rule.lane, kind: rule.kind, type: rule.type}));
}

export const DEFAULT_RULES = loadDefaultRules();

type RuleRow = typeof t.triageRules.$inferSelect;

export const ruleOf = (row: RuleRow): Rule => ({
  id: row.id, key: `${row.origin}:${row.id}`, source: row.origin, match: row.match, lane: row.lane, kind: row.kind, type: null,
});

/** Every enabled rule in the order triage tries them. */
export function loadRules(store: Store): Rule[] {
  const rows = store.db.select().from(t.triageRules).where(eq(t.triageRules.enabled, true))
    .orderBy(asc(t.triageRules.position), desc(t.triageRules.createdAt), asc(t.triageRules.id)).all();
  return [
    ...rows.filter(row => row.origin === 'written').map(ruleOf),
    ...rows.filter(row => row.origin === 'learned').map(ruleOf),
    ...DEFAULT_RULES,
  ];
}
