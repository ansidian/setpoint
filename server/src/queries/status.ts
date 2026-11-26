// Setpoint's mail state for Home Assistant (GET /api/status/ha, and `@setpoint/shared`'s status.ts
// says what the integration reads). Its counts and emails are by email, as they always were, though
// Setpoint's own lists and counts are by conversation: they come from the rules the Inbox uses
// (src/domain/inbox.ts), and accounts and sources with their health.
import {deepLinkPath, HA_ATTENTION_EMAILS} from '@setpoint/shared';
import type {DeepLink, HaReconnect, HaStatusOut, SourceProvider} from '@setpoint/shared';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {mailByEmail} from './mail.ts';
import {accountList, sourceList} from './sources.ts';

/** `origin` is Setpoint's public URL, which every link is made absolute on. */
export function haStatus(store: Store, origin: string): HaStatusOut {
  const asOf = isoNow(store);
  const link = (to: DeepLink) => {
    const path = deepLinkPath(to);
    return {path, url: new URL(path, origin).href};
  };
  const mail = mailByEmail(store, HA_ATTENTION_EMAILS);
  const accounts = new Map(accountList(store).map(account => [account.id, account]));

  // One entry per sign-in, because an account's sources (Gmail and Calendar on one Google consent) share it.
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
    all_clear: mail.attention === 0 && mail.unreadFyi === 0 && needsReconnect.length === 0,
    attention: mail.attention,
    unread_fyi: mail.unreadFyi,
    attention_emails: mail.attentionEmails.map(row => {
      const account = accounts.get(row.accountId)!;
      return {
        id: row.id, sender: row.organisation ?? row.fromName, from_name: row.fromName, organisation: row.organisation, subject: row.subject,
        account: {id: account.id, label: account.label, colour: account.colour}, received_at: row.receivedAt, unread: row.unread,
        ...link({to: 'message', id: row.id}),
      };
    }),
    needs_reconnect: needsReconnect,
    open_url: new URL('/inbox', origin).href,
  };
}
