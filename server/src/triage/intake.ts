// Where new mail meets triage (BRIEF.md › Triage: every new email is triaged once). The mail mirror
// hands over the emails it inserted: new mail gets a durable triage job on the engine (retried by the
// one policy while models are down, Unsorted meanwhile); backfilled history is sorted at once by the
// rules-only pass, so a year of history never waits in Unsorted or costs a model call. Unsorted
// mail is queued again every few minutes and whenever triage recovers or its keys change, so it's
// re-sorted once triage is back.
import {and, eq, inArray, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {enqueueJob} from '../sync/jobs.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {getSettings} from '../settings.ts';
import {triageHistory} from './pipeline.ts';
import type {Outcome, TriageEmail} from './pipeline.ts';
import {loadRules} from './rules.ts';

type MessageRow = typeof t.messages.$inferSelect;

export const triageKey = (messageId: number) => `triage:${messageId}`;

/** The email as triage reads it. */
export function triageEmailOf(store: Store, message: MessageRow): TriageEmail {
  const account = store.db.select({label: t.accounts.label}).from(t.accounts).where(eq(t.accounts.id, message.accountId)).get();
  return {
    fromName: message.fromName, fromAddress: message.fromAddress, subject: message.subject, snippet: message.snippet, bodyText: message.bodyText,
    bodyHtml: message.bodyHtml, receivedAt: message.receivedAt, accountLabel: account?.label ?? null,
  };
}

/**
 * Writes triage's decision to the record, once: only while the email is still Unsorted (a second
 * job for it, or a late answer, changes nothing). Returns whether it was written.
 */
export function applyOutcome(store: Store, messageId: number, outcome: Outcome): boolean {
  return transaction(store, () => {
    const {settled} = outcome;
    const updated = store.db.update(t.messages).set({
      lane: settled.lane, kind: settled.kind, type: settled.type, organisation: settled.organisation, via: settled.via,
      summary: settled.summary, keyDate: settled.keyDate, securityFacts: settled.securityFacts, protected: settled.protected,
      code: settled.code, codeExpiresAt: settled.codeExpiresAt,
      triageSource: outcome.source, triageRuleId: outcome.ruleId, triagedAt: isoNow(store),
    }).where(and(eq(t.messages.id, messageId), isNull(t.messages.lane))).returning({accountId: t.messages.accountId}).get();
    if (updated) noteLive(store, {type: 'mail', messages: [messageId], accounts: [updated.accountId], commands: []});
    return updated !== undefined;
  });
}

export function enqueueTriage(store: Store, messageIds: number[]) {
  for (const id of messageIds) enqueueJob(store, {kind: 'triage', key: triageKey(id), messageId: id});
}

/** The rules-only pass over backfilled history. */
export function sortHistory(store: Store, messageIds: number[]) {
  if (!messageIds.length) return;
  const context = {rules: loadRules(store), codeExpiryMinutes: getSettings(store).mail.code_expiry_minutes};
  transaction(store, () => {
    for (let at = 0; at < messageIds.length; at += 500) {
      const rows = store.db.select().from(t.messages).where(and(inArray(t.messages.id, messageIds.slice(at, at + 500)), isNull(t.messages.lane))).all();
      for (const row of rows) applyOutcome(store, row.id, triageHistory(context, triageEmailOf(store, row)));
    }
  });
}

/** The mail mirror's hand-over: emails it just inserted, new or from the backfill. */
export function triageIntake(store: Store, messageIds: number[], backfill: boolean) {
  if (backfill) sortHistory(store, messageIds);
  else enqueueTriage(store, messageIds);
}

/**
 * Unsorted mail, triaged again: history by the rules-only pass, new mail queued (a job already
 * queued or running for it stays as it is). Returns how many were queued or sorted.
 */
export function resortUnsorted(store: Store): {queued: number; sorted: number} {
  const rows = store.db.select({id: t.messages.id, backfill: t.messages.backfill}).from(t.messages).where(isNull(t.messages.lane)).all();
  const history = rows.filter(row => row.backfill).map(row => row.id);
  const fresh = rows.filter(row => !row.backfill).map(row => row.id);
  sortHistory(store, history);
  transaction(store, () => enqueueTriage(store, fresh));
  return {queued: fresh.length, sorted: history.length};
}

/** Triage is back: jobs waiting out a backoff run now. */
export function hurryTriage(store: Store) {
  store.db.update(t.jobs).set({runAt: isoNow(store)}).where(and(eq(t.jobs.kind, 'triage'), eq(t.jobs.state, 'queued'))).run();
}
