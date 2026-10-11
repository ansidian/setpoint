// Accounts and sources with their health (Settings › Accounts; the sidebar's needs-reconnect glyph).
// Credentials never leave: only whether a source has any.
import type {AccountOut, HealthOut, SourceOut} from '@setpoint/shared';
import {SOURCE_PROVIDERS} from '@setpoint/shared';
import {eq, inArray} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {PROVIDER_NAMES} from '../domain/sources.ts';
import {conflict, notFound} from '../errors.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {sourceHealth} from '../sync/health.ts';

/** Healthy with no checks: an account without a source yet (B2 connects them). */
const UNCHECKED: HealthOut = {state: 'healthy', as_of: null, reason: null, last_check_at: null};

export function accountList(store: Store): AccountOut[] {
  const now = isoNow(store);
  const mailSources = new Map(store.db.select().from(t.sources).where(inArray(t.sources.provider, ['gmail', 'icloud'])).all().map(source => [source.accountId, source]));
  return store.db.select().from(t.accounts).orderBy(t.accounts.position).all().map(account => {
    const source = mailSources.get(account.id);
    return {
      id: account.id, provider: account.provider, label: account.label, address: account.address, colour: account.colour, icon: account.icon,
      position: account.position, source_id: source?.id ?? null, health: source ? sourceHealth(source, now) : UNCHECKED,
    };
  });
}

/** Mail accounts in their order, then Google Calendar, Todoist and weather. */
export function sourceList(store: Store): SourceOut[] {
  const now = isoNow(store);
  const accounts = new Map(store.db.select().from(t.accounts).all().map(account => [account.id, account]));
  return store.db.select().from(t.sources).all()
    .sort((a, b) => SOURCE_PROVIDERS.indexOf(a.provider) - SOURCE_PROVIDERS.indexOf(b.provider) || (accounts.get(a.accountId!)?.position ?? 0) - (accounts.get(b.accountId!)?.position ?? 0) || a.id - b.id)
    .map(source => {
      const account = source.accountId === null ? undefined : accounts.get(source.accountId);
      const mail = source.provider === 'gmail' || source.provider === 'icloud';
      return {
        id: source.id, provider: source.provider, account_id: source.accountId,
        name: mail && account ? account.label : account ? `${PROVIDER_NAMES[source.provider]} · ${account.label}` : PROVIDER_NAMES[source.provider],
        sync: {mode: source.syncMode, interval_seconds: source.intervalSeconds, push_renews_at: source.pushRenewsAt},
        health: sourceHealth(source, now), has_credentials: source.credentials !== null, dev: source.dev,
      };
    });
}

export function updateAccount(store: Store, accountId: number, changes: {label?: string; colour?: AccountOut['colour']; icon?: string}): AccountOut {
  return transaction(store, () => {
    if (changes.label) {
      const clash = store.db.select().from(t.accounts).where(eq(t.accounts.label, changes.label)).get();
      if (clash && clash.id !== accountId) throw conflict('label_taken', `Another account is called ${changes.label}.`);
    }
    const updated = store.db.update(t.accounts).set(changes).where(eq(t.accounts.id, accountId)).returning().get();
    if (!updated) throw notFound('No such account.');
    noteLive(store, {type: 'mail', messages: [], accounts: [accountId], commands: []});
    return accountList(store).find(account => account.id === accountId)!;
  });
}

export function reorderAccounts(store: Store, accountIds: number[]): AccountOut[] {
  return transaction(store, () => {
    const existing = store.db.select({id: t.accounts.id}).from(t.accounts).all().map(row => row.id).sort((a, b) => a - b);
    if (JSON.stringify([...accountIds].sort((a, b) => a - b)) !== JSON.stringify(existing)) throw conflict('order_mismatch', 'List every account once.');
    accountIds.forEach((id, position) => store.db.update(t.accounts).set({position}).where(eq(t.accounts.id, id)).run());
    noteLive(store, {type: 'mail', messages: [], accounts: accountIds, commands: []});
    return accountList(store);
  });
}
