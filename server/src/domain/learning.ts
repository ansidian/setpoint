// How triage learns (BRIEF.md › Triage and Read state and Done; decisions 27, 28): never from
// per-email labels, only from Done. Done from the row without opening says the email probably
// didn't need attention; opened then Done says it did. When the same organisation and type are
// cleared unopened enough times running, Attention offers one pattern prompt; Yes makes a learned
// rule, No keeps it quiet. Protected mail never gets a prompt.
import type {Kind, MessageType} from '@setpoint/shared';
import {organisationKey} from './triageRules.ts';

/** Cleared unopened this many times running before Attention asks (the board's "4 Northwind newsletters"). */
export const PROMPT_THRESHOLD = 4;

/**
 * One verdict on an attention email: Done opened or unopened, or an imported v1 correction (out of
 * Attention counts as unopened, into it as opened).
 */
export interface Verdict {
  organisation: string;
  type: MessageType;
  kind: Kind | null;
  protected: boolean;
  opened: boolean;
  // When it was Done (or corrected).
  at: string;
  // Null for an imported correction.
  messageId: number | null;
}

export interface Prompt {
  organisation: string;
  type: MessageType;
  count: number;
  messageIds: number[];
  kind: Kind;
  // The newest verdict behind it: the most recent prompt is offered first.
  latestAt: string;
}

export const promptKey = (organisation: string, type: MessageType) => `${organisationKey(organisation)}\u0000${type}`;

/**
 * The pattern prompts there are, newest first. Per organisation and type, the run of unopened
 * verdicts since the last opened one; a run of `threshold` or more is a prompt, unless it's quiet
 * (answered already, or a learned rule covers it). Protected mail is left out entirely: no prompt
 * is ever offered for it, and no rule could move it anyway.
 */
export function patternPrompts(verdicts: readonly Verdict[], quiet: ReadonlySet<string>, threshold = PROMPT_THRESHOLD): Prompt[] {
  const groups = new Map<string, Verdict[]>();
  for (const verdict of verdicts) {
    if (verdict.protected || !verdict.organisation.trim()) continue;
    const key = promptKey(verdict.organisation, verdict.type);
    groups.set(key, [...(groups.get(key) ?? []), verdict]);
  }
  const prompts: Prompt[] = [];
  for (const [key, group] of groups) {
    if (quiet.has(key)) continue;
    const newestFirst = [...group].sort((a, b) => b.at.localeCompare(a.at) || (b.messageId ?? 0) - (a.messageId ?? 0));
    const firstOpened = newestFirst.findIndex(verdict => verdict.opened);
    const run = firstOpened < 0 ? newestFirst : newestFirst.slice(0, firstOpened);
    if (run.length < threshold) continue;
    const kinds = new Map<Kind, number>();
    for (const verdict of run) if (verdict.kind) kinds.set(verdict.kind, (kinds.get(verdict.kind) ?? 0) + 1);
    const kind = [...kinds].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
    prompts.push({
      organisation: run[0]!.organisation, type: run[0]!.type, count: run.length,
      messageIds: run.flatMap(verdict => (verdict.messageId === null ? [] : [verdict.messageId])), kind, latestAt: run[0]!.at,
    });
  }
  return prompts.sort((a, b) => b.latestAt.localeCompare(a.latestAt));
}
