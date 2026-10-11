// Connecting a mail account (Settings › Accounts: Connect Gmail, Connect iCloud) and reconnecting
// one: the account with its label, colour, icon and order, its mail source with encrypted
// credentials, and for Google the Calendar source on the same consent. Reconnecting the same
// address replaces the credentials, which clears needs-reconnect.
import type {AccountProvider, Colour, Credentials, SourceProvider, SyncMode} from '@setpoint/shared';
import {COLOURS} from '@setpoint/shared';
import {and, eq, sql} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conflict} from '../errors.ts';
import {writeSourceCredentials} from '../secrets/store.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';

// The order new accounts take colours in (BRIEF.md's sample: warm, cool, comf, violet, …).
const COLOUR_ORDER: Colour[] = ['warm', 'cool', 'comf', 'violet', 'sun', 'cyan', 'good', 'caution', 'alert', 'ink2', 'ink3'];

export interface ConnectInput {
  provider: AccountProvider;
  address: string;
  credentials: Credentials;
  // The mail source's schedule ("Gmail · Push", "iCloud · IMAP every 2 min").
  syncMode: SyncMode;
  intervalSeconds: number;
  // More sources on the same credentials (Google Calendar on Gmail's consent), each with its schedule.
  alsoSources?: {provider: SourceProvider; syncMode: SyncMode; intervalSeconds: number}[];
  label?: string;
  colour?: Colour;
  icon?: string;
  // Reconnect: the account the sign-in must belong to.
  accountId?: number;
}

export interface Connected {
  accountId: number;
  sourceIds: number[];
  created: boolean;
}

/** A label nobody has: the given one, or the address's name ("user.work" → "User.work"), numbered if taken. */
function freeLabel(store: Store, wanted: string): string {
  const taken = new Set(store.db.select({label: t.accounts.label}).from(t.accounts).all().map(row => row.label.toLowerCase()));
  const base = wanted.slice(0, 36);
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

function nextColour(store: Store): Colour {
  const used = new Set(store.db.select({colour: t.accounts.colour}).from(t.accounts).all().map(row => row.colour));
  return COLOUR_ORDER.find(colour => !used.has(colour)) ?? COLOURS[0];
}

export function connectMailAccount(store: Store, input: ConnectInput): Connected {
  const address = input.address.trim().toLowerCase();
  const existing = store.db.select().from(t.accounts).where(eq(sql`lower(${t.accounts.address})`, address)).get();
  if (input.accountId !== undefined && existing?.id !== input.accountId) {
    const wanted = store.db.select().from(t.accounts).where(eq(t.accounts.id, input.accountId)).get();
    throw conflict('wrong_account', wanted ? `That sign-in is ${address}, not ${wanted.address}. Sign in as ${wanted.address} to reconnect ${wanted.label}.` : 'That account no longer exists.');
  }
  if (existing && existing.provider !== input.provider) throw conflict('address_taken', `${address} is already connected another way.`);
  const sourceIds = transaction(store, () => {
    const now = isoNow(store);
    let accountId = existing?.id;
    if (!accountId) {
      const position = (store.db.select({max: sql<number | null>`max(${t.accounts.position})`}).from(t.accounts).get()?.max ?? -1) + 1;
      const name = address.split('@')[0]!;
      accountId = store.db.insert(t.accounts).values({
        provider: input.provider, address, label: freeLabel(store, input.label ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}`),
        colour: input.colour ?? nextColour(store), icon: input.icon ?? 'mail', position, createdAt: now,
      }).returning({id: t.accounts.id}).get().id;
    }
    const wanted = [{provider: input.provider as SourceProvider, syncMode: input.syncMode, intervalSeconds: input.intervalSeconds}, ...(input.alsoSources ?? [])];
    return wanted.map(source => {
      const found = store.db.select().from(t.sources).where(and(eq(t.sources.accountId, accountId), eq(t.sources.provider, source.provider))).get();
      if (found?.dev) throw conflict('dev_source', 'This is a seeded dev account; it never takes real credentials.');
      const id = found?.id ?? store.db.insert(t.sources).values({
        provider: source.provider, accountId, syncMode: source.syncMode, intervalSeconds: source.intervalSeconds, createdAt: now,
      }).returning({id: t.sources.id}).get().id;
      writeSourceCredentials(store, id, input.credentials);
      return id;
    });
  });
  const accountId = store.db.select({id: t.accounts.id}).from(t.accounts).where(eq(sql`lower(${t.accounts.address})`, address)).get()!.id;
  noteLive(store, {type: 'mail', messages: [], accounts: [accountId], commands: []});
  noteLive(store, {type: 'health', sources: sourceIds});
  return {accountId, sourceIds, created: !existing};
}
