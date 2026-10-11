// Setpoint's mail state for Home Assistant (GET /api/status/ha; `@setpoint/shared`'s status.ts
// says what the integration reads). It's built from the very queries the web app's sidebar uses,
// the Inbox and its counts, and accounts and sources with their health, so the chip and the
// sidebar can't drift apart.
import {deepLinkPath, HA_ATTENTION_EMAILS} from '@setpoint/shared';
import type {DeepLink, HaReconnect, HaStatusOut, SourceProvider} from '@setpoint/shared';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {inbox} from './mail.ts';
import {accountList, sourceList} from './sources.ts';

/** `origin` is Setpoint's public URL, which every link is made absolute on. */
export function haStatus(store: Store, origin: string): HaStatusOut {
  const asOf = isoNow(store);
  const link = (to: DeepLink) => {
    const path = deepLinkPath(to);
    return {path, url: new URL(path, origin).href};
  };
  const view = inbox(store);
  const accounts = new Map(accountList(store).map(account => [account.id, account]));
  const attention = view.groups.find(group => group.group === 'attention')?.rows ?? [];

  // One entry per sign-in: an account's sources (Gmail and Calendar on one Google consent) share it.
  const reconnect = new Map<string, {label: string; account_id: number | null; providers: SourceProvider[]}>();
  for (const source of sourceList(store)) {
    if (source.health.state !== 'needs_reconnect') continue;
    const account = source.account_id === null ? undefined : accounts.get(source.account_id);
    const key = account ? `account:${account.id}` : `source:${source.id}`;
    const entry = reconnect.get(key) ?? {label: account?.label ?? source.name, account_id: account?.id ?? null, providers: []};
    entry.providers.push(source.provider);
    reconnect.set(key, entry);
  }
  const needsReconnect: HaReconnect[] = [...reconnect.values()].map(entry => ({...entry, ...link({to: 'settings', page: 'accounts'})}));

  return {
    as_of: asOf,
    all_clear: view.counts.attention === 0 && view.counts.unread_fyi === 0 && needsReconnect.length === 0,
    attention: view.counts.attention,
    unread_fyi: view.counts.unread_fyi,
    attention_emails: attention.slice(0, HA_ATTENTION_EMAILS).map(row => {
      const account = accounts.get(row.account_id)!;
      return {
        id: row.id, sender: row.organisation ?? row.from_name, from_name: row.from_name, organisation: row.organisation, subject: row.subject,
        account: {id: account.id, label: account.label, colour: account.colour}, received_at: row.received_at, unread: row.unread,
        ...link({to: 'message', id: row.id}),
      };
    }),
    needs_reconnect: needsReconnect,
    open_url: new URL('/inbox', origin).href,
  };
}
