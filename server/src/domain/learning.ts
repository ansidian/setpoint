// How triage learns (BRIEF.md › Triage and Read state and Done; decisions 27, 28): never from
// per-email labels, only from Done. Done from the row without opening says the email probably
// didn't need attention; opened then Done says it did. When the same organisation and type are
// cleared unopened enough times running, Attention offers one pattern prompt; Yes makes a learned
// rule, No keeps it quiet. Protected mail never gets a prompt. Attention precision is the share of
// attention mail opened before Done.
import type {Kind, MessageType} from '@setpoint/shared';
import {organisationKey} from './triageRules.ts';
import {localDay} from './time.ts';

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

/** One attention email marked Done, for precision. */
export interface DoneAttention {
  doneAt: string;
  opened: boolean;
}

export interface Precision {
  precision: number | null;
  done: number;
  opened: number;
  from: string;
  to: string;
  days: {date: string; done: number; opened: number}[];
}

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Attention precision over the last `window` local days, today included: of the attention mail
 * marked Done then, the share opened first (DESIGN.md › Settings › Accounts: "82%"), with each
 * day's counts for the sparkline. Null when nothing was Done.
 */
export function attentionPrecision(rows: readonly DoneAttention[], now: string, timeZone: string, window = 30): Precision {
  const to = localDay(now, timeZone);
  const from = shiftDate(to, -(window - 1));
  const days = Array.from({length: window}, (_, index) => ({date: shiftDate(from, index), done: 0, opened: 0}));
  const byDate = new Map(days.map(day => [day.date, day]));
  for (const row of rows) {
    const day = byDate.get(localDay(row.doneAt, timeZone));
    if (!day) continue;
    day.done += 1;
    if (row.opened) day.opened += 1;
  }
  const done = days.reduce((sum, day) => sum + day.done, 0);
  const opened = days.reduce((sum, day) => sum + day.opened, 0);
  return {precision: done ? opened / done : null, done, opened, from, to, days};
}
