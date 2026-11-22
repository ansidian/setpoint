// Recipient suggestions (src/domain/people.ts ranks them): everyone named in To or Cc of mail the
// user sent, and the senders of received mail triaged as People, so automated mail stays out. A
// year of mail is a few thousand rows, read whole for each lookup.
//
// Mail search's `from:` and `to:` take one list each, ranked the same way: everyone who sent the user
// mail, automated senders too, and everyone the user sent to.
import type {PeopleOut} from '@setpoint/shared';
import {and, eq, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {rankPeople} from '../domain/people.ts';
import type {Seen} from '../domain/people.ts';
import type {Store} from '../store.ts';
import {sendAddresses} from './drafts.ts';

export function suggestPeople(store: Store, query: string, limit: number, mode: 'compose' | 'from' | 'to' = 'compose'): PeopleOut {
  const own = [...sendAddresses(store).values()].flat().map(address => address.address);
  const now = store.now().toISOString();
  if (mode === 'from') {
    const senders: Seen[] = store.db.select({address: t.messages.fromAddress, name: t.messages.fromName, at: t.messages.receivedAt}).from(t.messages)
      .where(and(eq(t.messages.received, true), isNull(t.messages.trashedAt))).orderBy(t.messages.id).all();
    return {people: rankPeople({written: senders, heard: [], own, query, now, limit})};
  }
  const sent = store.db.select({to: t.messages.toRecipients, cc: t.messages.ccRecipients, at: t.messages.receivedAt}).from(t.messages)
    .where(and(eq(t.messages.sent, true), isNull(t.messages.trashedAt))).all();
  const written: Seen[] = sent.flatMap(row => [...(row.to ?? []), ...(row.cc ?? [])].map(recipient => ({address: recipient.address, name: recipient.name, at: row.at})));
  if (mode === 'to') return {people: rankPeople({written, heard: [], own, query, now, limit})};
  const heard: Seen[] = store.db.select({address: t.messages.fromAddress, name: t.messages.fromName, at: t.messages.receivedAt}).from(t.messages)
    .where(and(eq(t.messages.received, true), eq(t.messages.kind, 'people'), isNull(t.messages.trashedAt))).orderBy(t.messages.id).all();
  return {people: rankPeople({written, heard, own, query, now, limit})};
}
