// A Gmail account's "Send mail as" list, kept with the account for the composer's From. The Gmail
// adapter reads it at the account's first check and then once a day (a new alias appears within a
// day; one removed in Gmail leaves From as soon as it is read again). Only verified aliases are
// kept. A read that fails leaves the list as it was and never fails the sync.
import {eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {readCursor, writeCursor} from '../sync/cursors.ts';
import {noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';

export const ALIASES_SCOPE = 'send-as';
export const ALIASES_EVERY_MS = 24 * 60 * 60_000;

export interface Alias {
  address: string;
  name: string | null;
  primary: boolean;
}

/** Whether the source's list is due a read: never read, or read a day ago. */
export function aliasesDue(store: Store, sourceId: number): boolean {
  const readAt = readCursor(store, sourceId, ALIASES_SCOPE);
  return !readAt || Date.parse(readAt) + ALIASES_EVERY_MS <= store.now().getTime();
}

/** Keeps an account's list as the provider gave it, and when it was read. */
export function replaceAliases(store: Store, sourceId: number, accountId: number, aliases: Alias[]) {
  transaction(store, () => {
    store.db.delete(t.sendAs).where(eq(t.sendAs.accountId, accountId)).run();
    const seen = new Set<string>();
    aliases.forEach((alias, position) => {
      const address = alias.address.trim().toLowerCase();
      if (!address || seen.has(address)) return;
      seen.add(address);
      store.db.insert(t.sendAs).values({accountId, address, name: alias.name?.trim() || null, primary: alias.primary, position}).run();
    });
    writeCursor(store, sourceId, store.now().toISOString(), ALIASES_SCOPE);
    noteLive(store, {type: 'mail', messages: [], accounts: [accountId], commands: []});
  });
}
