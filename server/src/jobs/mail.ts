// Jobs's one window on mail: small, read-only functions over mail's tables (D303). Mail never
// imports Jobs; Jobs reads mail only through here. J2 adds reading an email as triage left it.
import {and, eq, inArray} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import type {Store} from '../store.ts';

type MailReader = Pick<Store, 'db'>;

/** Which of these message ids are still emails Setpoint holds (an event links to its email while it exists, D317). */
export function existingMessages(store: MailReader, ids: (number | null)[]): Set<number> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (!wanted.length) return new Set();
  return new Set(store.db.select({id: t.messages.id}).from(t.messages).where(inArray(t.messages.id, wanted)).all().map(row => row.id));
}

/** The email with this subject received at this instant, if Setpoint holds it. */
export function findMessage(store: MailReader, subject: string, receivedAt: string): number | null {
  return store.db.select({id: t.messages.id}).from(t.messages).where(and(eq(t.messages.subject, subject), eq(t.messages.receivedAt, receivedAt))).get()?.id ?? null;
}

/** Mail's accounts by label ("Jobs", "Business"), for the accounts Jobs reads. */
export function accountsByLabel(store: MailReader): Map<string, number> {
  return new Map(store.db.select({id: t.accounts.id, label: t.accounts.label}).from(t.accounts).all().map(row => [row.label, row.id]));
}
