// v1's export file, imported once into v2's own format (BUILD-PLAN.md › B7; BRIEF.md › Cutover).
// v1's export script runs in v1's repository with v1's own decryption and writes this one plaintext
// JSON file; `npm run cli -- import-v1 <file>` reads it. Secrets are sealed with v2's key (`sp2:`)
// as they're stored, never printed, and the operator deletes the file afterwards. The format,
// version 1 (every field required; null where v1 has nothing):
//
//   {
//     "format": "setpoint-v1-export",
//     "version": 1,
//     "exported_at": "2026-10-20T17:00:00.000Z",
//     "owner": null | {                          // ea_owner and its sign-in rows
//       "password_hash": "$2b$12$…",             // bcrypt, as v1 stored it
//       "auth_mode": "password_or_passkey" | "password_plus_passkey",
//       "passkeys": [{                           // ea_passkey_credentials
//         "credential_id": "…", "label": "MacBook", "public_key": "…",   // base64url, as stored
//         "sign_count": 3, "transports": ["internal"], "backed_up": true | null,
//         "device_type": "multiDevice" | null,
//         "created_at": "<ISO>", "last_used_at": "<ISO>" | null
//       }],
//       "recovery_codes": [{"hash": "sha256:<64 hex>", "generated_at": "<ISO>"}]   // unused ones only
//     },
//     "accounts": [                              // ea_accounts, in v1's order (sort_order, created_at)
//       {"provider": "gmail", "address": "user@example.com", "label": "Personal",
//        "color": "#818cf8" | null, "icon": "Mail" | null, "calendar_enabled": true, "needs_reauth": false,
//        "refresh_token": "…" | null, "access_token": "…" | null,        // v1's decrypted credentials
//        "expires_at": "<ISO>" | null, "scope": "https://… https://…" | null},
//       {"provider": "icloud", "address": "user@icloud.example", "label": "iCloud",
//        "color": "#a259ff" | null, "icon": "Apple" | null, "needs_reauth": false,
//        "app_password": "…" | null}
//     ],
//     "todoist": null | {"token": "…", "expires_at": "<ISO>" | null},   // v1's Todoist access token
//     "secrets": {                               // v1's instance credentials (active values)
//       "anthropic_api_key": "…" | null, "openai_api_key": "…" | null,
//       "places_api_key": "…" | null, "pirate_weather_api_key": "…" | null
//     },
//     "models": {"triage_cheap": "claude-…" | null, "triage_strong": "…" | null, "alfred": "…" | null},
//                                                // read but never imported: v2 keeps its own (D41)
//     "home": null | {"label": "Home", "address": "1 Example St", "lat": 34.1, "lng": -118.1},
//     "rules": […], "corrections": […],          // exactly as src/triage/importV1.ts documents them
//     "trusted_senders": ["news@contoso.example"],             // remote-content trust, by sender
//     "pins": [{"account": "user@example.com", "provider_id": "<Gmail message id>" | null,
//               "message_id": "<Message-ID header>" | null, "pinned_at": "<ISO>"}]
//   }
//
// The import fills what v2 doesn't have and never overwrites what it does, so running it again is
// safe; everything it leaves is reported with why. In detail:
// - **Owner:** an unclaimed v2 takes v1's password hash and unused recovery codes as its owner (the
//   CLI is already the operator's way in, as for a setup token, so it replaces the claim); a claimed
//   v2 keeps its own password and codes. v1's passkeys are added (new credential ids only), but
//   they belong to v1's hostname and work only where v2 serves it. Strict mode isn't imported: on any
//   other hostname it would lock the user out.
// - **Accounts:** a new address goes through Connect Gmail's or Connect iCloud's own path, Gmail
//   with its Calendar source; an address v2 already has keeps v2's sign-in and look.
// - **Todoist, keys, Home:** set only where v2 has none.
// - **Models** are never imported: v2 keeps its own choices (D25, D26), whatever v1 used (D41).
// - **Rules and corrections:** src/triage/importV1.ts (rules replaced by name, corrections once).
// - **Trusted senders** become their registrable domains (D28).
// - **Pins** land on emails already in the record; the rest wait for the backfill (pending_pins).
import {homeSchema, trustedDomainInput} from '@setpoint/shared';
import type {SecretName} from '@setpoint/shared';
import {and, eq, inArray, or, sql} from 'drizzle-orm';
import {z} from 'zod';
import {getOwner, securityTransition} from './auth/owner.ts';
import {ensureCalendarSources} from './calendar/sources.ts';
import * as t from './db/schema.ts';
import {swatchFor} from './domain/colours.ts';
import {trustDomainOf} from './domain/remoteContent.ts';
import {parse} from './errors.ts';
import {connectGmail} from './providers/gmail/connect.ts';
import {connectICloud} from './providers/icloud/index.ts';
import {connectTodoist} from './providers/todoist/oauth.ts';
import {listSecrets, setSecret, writeSourceCredentials} from './secrets/store.ts';
import {getSettings, updateSettings} from './settings.ts';
import {isoNow, noteLive, transaction} from './store.ts';
import type {Store} from './store.ts';
import {bareMessageId} from './sync/mailMirror.ts';
import {importV1Triage, v1ExportSchema} from './triage/importV1.ts';
import type {ImportReport as TriageReport} from './triage/importV1.ts';

const iso = z.iso.datetime();
const secret = z.string().min(1).max(8192).nullable();
const model = z.string().min(1).max(200).nullable();
// v1's look for an account: a hex colour and a Lucide icon name (or an emoji), both optional.
const look = {
  address: z.email().max(320), label: z.string().trim().min(1).max(200), color: z.string().max(32).nullable(), icon: z.string().max(64).nullable(),
  needs_reauth: z.boolean(),
};

export const v1FileSchema = z.strictObject({
  format: z.literal('setpoint-v1-export'),
  version: z.literal(1),
  exported_at: iso,
  owner: z.strictObject({
    password_hash: z.string().regex(/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/, 'Not a bcrypt hash'),
    auth_mode: z.enum(['password_or_passkey', 'password_plus_passkey']),
    passkeys: z.array(z.strictObject({
      credential_id: z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/), label: z.string().trim().min(1).max(80), public_key: z.string().regex(/^[A-Za-z0-9_-]{1,4096}$/),
      sign_count: z.number().int().min(0), transports: z.array(z.string().max(32)), backed_up: z.boolean().nullable(), device_type: z.string().max(64).nullable(),
      created_at: iso, last_used_at: iso.nullable(),
    })),
    recovery_codes: z.array(z.strictObject({hash: z.string().regex(/^sha256:[0-9a-f]{64}$/), generated_at: iso})),
  }).nullable(),
  accounts: z.array(z.discriminatedUnion('provider', [
    z.strictObject({
      provider: z.literal('gmail'), ...look, calendar_enabled: z.boolean(),
      refresh_token: secret, access_token: secret, expires_at: iso.nullable(), scope: z.string().max(4096).nullable(),
    }),
    z.strictObject({provider: z.literal('icloud'), ...look, app_password: z.string().trim().min(1).max(200).nullable()}),
  ])),
  todoist: z.strictObject({token: z.string().min(1).max(4096), expires_at: iso.nullable()}).nullable(),
  secrets: z.strictObject({anthropic_api_key: secret, openai_api_key: secret, places_api_key: secret, pirate_weather_api_key: secret}),
  models: z.strictObject({triage_cheap: model, triage_strong: model, alfred: model}),
  home: homeSchema.nullable(),
  rules: v1ExportSchema.shape.rules,
  corrections: v1ExportSchema.shape.corrections,
  trusted_senders: z.array(z.string().max(320)),
  pins: z.array(z.strictObject({account: z.string().max(320), provider_id: z.string().min(1).max(200).nullable(), message_id: z.string().min(1).max(998).nullable(), pinned_at: iso})),
});
export type V1File = z.infer<typeof v1FileSchema>;

/** What the import did, line by line; no line ever holds a secret. */
export interface V1ImportReport {
  imported: string[];
  // "What: why".
  skipped: string[];
  // Things to do or know afterwards.
  notes: string[];
  triage: TriageReport;
}

/** v1's account icons (Lucide names in Settings' picker, or v1's default emoji) that have a v2 glyph. */
const ICONS: Record<string, string> = {Mail: 'mail', '📧': 'mail', Apple: 'cloud', Briefcase: 'work', Monitor: 'computer', ShoppingCart: 'storefront'};

const SECRETS: [SecretName, keyof V1File['secrets'], string][] = [
  ['anthropic_api_key', 'anthropic_api_key', 'Anthropic key'],
  ['openai_api_key', 'openai_api_key', 'OpenAI key'],
  ['places_api_key', 'places_api_key', 'Maps key (Places and Routes)'],
];


/** Imports v1's export file (already parsed JSON). Safe to run again: it fills, never overwrites. */
export function importV1(store: Store, file: unknown, options: {gmailPush: boolean}): V1ImportReport {
  const data = parse(v1FileSchema, file);
  const report: V1ImportReport = {imported: [], skipped: [], notes: [], triage: {rules: {imported: 0, disabled: [], skipped: []}, corrections: {imported: 0, already: 0, ignored: 0, toward_prompts: 0}}};
  const skip = (what: string, why: string) => report.skipped.push(`${what}: ${why}`);
  transaction(store, () => {
    importOwner(store, data.owner, report, skip);
    importAccounts(store, data.accounts, options.gmailPush, report, skip);
    importKeys(store, data, report, skip);
    report.triage = importV1Triage(store, {format: 'setpoint-v1-triage', version: 1, exported_at: data.exported_at, rules: data.rules, corrections: data.corrections});
    importTrustedSenders(store, data.trusted_senders, report, skip);
    importPins(store, data.pins, report, skip);
    noteLive(store, {type: 'mail', messages: [], accounts: [], commands: []});
  });
  return report;
}

type Skip = (what: string, why: string) => void;

function importOwner(store: Store, owner: V1File['owner'], report: V1ImportReport, skip: Skip) {
  if (!owner) return skip('Owner', 'the file has none');
  const claimed = getOwner(store);
  if (!claimed) {
    // The import is the claim: a setup token issued before it can't claim afterwards.
    store.db.delete(t.setupTokens).run();
    store.db.insert(t.owner).values({id: 1, passwordHash: owner.password_hash, claimedAt: isoNow(store)}).run();
    // v1 and v2 hash a recovery code the same way (SHA-256 of it normalised); v1 prefixed "sha256:".
    for (const code of owner.recovery_codes) store.db.insert(t.recoveryCodes).values({hash: code.hash.slice('sha256:'.length), generatedAt: code.generated_at}).onConflictDoNothing().run();
    report.imported.push(`Owner: v1's password and its ${owner.recovery_codes.length} unused recovery codes`);
  } else {
    skip('Owner', 'v2 is already claimed, so its own password and recovery codes stay');
  }
  const known = new Set(store.db.select({id: t.passkeys.credentialId}).from(t.passkeys).all().map(row => row.id));
  const fresh = owner.passkeys.filter(passkey => !known.has(passkey.credential_id));
  const insert = () => {
    for (const passkey of fresh) {
      store.db.insert(t.passkeys).values({
        credentialId: passkey.credential_id, label: passkey.label, publicKey: passkey.public_key, signCount: passkey.sign_count, transports: passkey.transports,
        backedUp: passkey.backed_up, deviceType: passkey.device_type, createdAt: passkey.created_at, lastUsedAt: passkey.last_used_at,
      }).run();
    }
  };
  if (fresh.length) {
    // Adding a passkey to a claimed owner is a security change, as registering one is: it ends every session.
    if (claimed) securityTransition(store, claimed.securityGeneration, insert);
    else insert();
    report.imported.push(`Passkeys: ${fresh.map(passkey => passkey.label).join(', ')}`);
    report.notes.push('v1\'s passkeys are tied to v1\'s hostname: they work while v2 serves it, and on any other hostname sign in with the password.');
  }
  if (owner.passkeys.length > fresh.length) skip('Passkeys', `${owner.passkeys.length - fresh.length} already in v2`);
  if (owner.auth_mode === 'password_plus_passkey') {
    skip('A passkey after the password', 'not turned on, so a hostname v1\'s passkeys don\'t work on can\'t lock you out. Turn it on in Settings › Security once a passkey has signed you in');
  }
}

function importAccounts(store: Store, accounts: V1File['accounts'], gmailPush: boolean, report: V1ImportReport, skip: Skip) {
  for (const account of accounts) {
    const address = account.address.trim().toLowerCase();
    if (store.db.select({id: t.accounts.id}).from(t.accounts).where(eq(sql`lower(${t.accounts.address})`, address)).get()) {
      skip(address, 'already in v2, so its sign-in, label, colour and icon stay');
      continue;
    }
    const fallback = account.provider === 'gmail' ? 'mail' : 'cloud';
    const icon = account.icon === null ? fallback : ICONS[account.icon] ?? fallback;
    if (account.icon !== null && !ICONS[account.icon]) report.notes.push(`${address}'s icon (${account.icon}) has no v2 glyph; it shows ${fallback}. Pick one in Settings › Accounts.`);
    const look = {address, label: account.label, colour: account.color ? swatchFor(account.color) : undefined, icon};
    if (account.provider === 'gmail') {
      if (!account.refresh_token) {
        skip(address, 'v1 has no Google sign-in for it: Connect Gmail in v2');
        continue;
      }
      connectGmail(store, gmailPush, {
        ...look, credentials: {kind: 'oauth', refresh_token: account.refresh_token, access_token: account.access_token, expires_at: account.expires_at, scope: account.scope},
      });
      report.imported.push(`${address}: Gmail (${gmailPush ? 'push' : 'polled'}) and its Calendar`);
      if (!account.calendar_enabled) report.notes.push(`v1 kept ${address}'s calendars off; v2 shows them. Hide them in Settings › Calendar.`);
    } else {
      if (!account.app_password) {
        skip(address, 'v1 has no app password for it: Connect iCloud in v2');
        continue;
      }
      connectICloud(store, {...look, label: look.label.slice(0, 40), app_password: account.app_password});
      report.imported.push(`${address}: iCloud`);
    }
    if (account.needs_reauth) report.notes.push(`v1 was waiting to sign in to ${address} again: if v2 can't sync it either, reconnect it in Settings › Accounts.`);
  }
}

function importKeys(store: Store, data: V1File, report: V1ImportReport, skip: Skip) {
  const set = new Set(listSecrets(store).filter(one => one.set).map(one => one.name));
  for (const [name, from, label] of SECRETS) {
    const value = data.secrets[from];
    if (!value) continue;
    if (set.has(name)) {
      skip(label, 'already set in v2');
      continue;
    }
    setSecret(store, name, value);
    report.imported.push(label);
  }
  // Pirate Weather's key is the weather source's credential (D16).
  if (data.secrets.pirate_weather_api_key) {
    ensureCalendarSources(store);
    const weather = store.db.select().from(t.sources).where(and(eq(t.sources.provider, 'weather'), eq(t.sources.dev, false))).get();
    if (!weather) skip('Pirate Weather key', 'the weather source here is the seed\'s');
    else if (weather.credentials) skip('Pirate Weather key', 'already set in v2');
    else {
      writeSourceCredentials(store, weather.id, {kind: 'api_key', key: data.secrets.pirate_weather_api_key});
      report.imported.push('Pirate Weather key');
    }
  }

  const todoist = data.todoist;
  if (todoist) {
    const connected = store.db.select().from(t.sources).where(and(eq(t.sources.provider, 'todoist'), eq(t.sources.dev, false))).get();
    if (connected?.credentials) skip('Todoist', 'already connected in v2');
    else if (todoist.expires_at && Date.parse(todoist.expires_at) <= store.now().getTime()) skip('Todoist', 'v1\'s token has expired: connect Todoist in v2');
    else {
      connectTodoist(store, todoist.token);
      report.imported.push('Todoist');
      if (todoist.expires_at) report.notes.push(`v1's Todoist token expires ${todoist.expires_at.slice(0, 10)}, and v2 doesn't refresh it: connect Todoist in v2 before then.`);
    }
  }

  const settings = getSettings(store);
  if (Object.values(data.models).some(Boolean)) skip('Models', 'v2 keeps its own choices; change them in Settings › AI');

  if (data.home) {
    if (settings.calendar.home) skip('Home', 'already set in v2');
    else {
      updateSettings(store, {calendar: {home: data.home}});
      report.imported.push(`Home: ${data.home.label}`);
    }
  }
}

/** v1 trusted remote content per sender; v2 per registrable domain (D28). */
function importTrustedSenders(store: Store, senders: string[], report: V1ImportReport, skip: Skip) {
  const domains = new Set<string>();
  for (const sender of senders) {
    const host = sender.slice(sender.lastIndexOf('@') + 1).trim().toLowerCase();
    const parsed = trustedDomainInput.safeParse({domain: sender.includes('@') ? trustDomainOf(host) : ''});
    if (parsed.success) domains.add(parsed.data.domain);
    else skip(`Trusted sender ${sender}`, 'it has no domain v2 can trust');
  }
  const added = [...domains].filter(domain => store.db.insert(t.trustedDomains).values({domain, createdAt: isoNow(store)}).onConflictDoNothing().run().changes);
  if (added.length) report.imported.push(`Trusted domains: ${added.join(', ')}`);
  if (domains.size > added.length) skip('Trusted domains', `${domains.size - added.length} already trusted in v2`);
}

function importPins(store: Store, pins: V1File['pins'], report: V1ImportReport, skip: Skip) {
  let applied = 0;
  let waiting = 0;
  let already = 0;
  for (const pin of pins) {
    const account = store.db.select({id: t.accounts.id}).from(t.accounts).where(eq(sql`lower(${t.accounts.address})`, pin.account.trim().toLowerCase())).get();
    const messageId = bareMessageId(pin.message_id);
    if (!account) {
      skip(`A pin in ${pin.account}`, 'that account isn\'t in v2');
      continue;
    }
    if (!pin.provider_id && !messageId) {
      skip(`A pin in ${pin.account}`, 'it names no Gmail id or Message-ID to find its email by');
      continue;
    }
    const by = [
      ...(pin.provider_id ? [eq(t.messages.providerId, pin.provider_id)] : []),
      ...(messageId ? [inArray(t.messages.rfc822Id, [messageId, `<${messageId}>`])] : []),
    ];
    const row = store.db.select({id: t.messages.id, pinnedAt: t.messages.pinnedAt}).from(t.messages).where(and(eq(t.messages.accountId, account.id), or(...by))).get();
    if (row?.pinnedAt) already += 1;
    else if (row) {
      store.db.update(t.messages).set({pinnedAt: pin.pinned_at}).where(eq(t.messages.id, row.id)).run();
      applied += 1;
    } else {
      const inserted = store.db.insert(t.pendingPins).values({accountId: account.id, providerId: pin.provider_id, messageId, pinnedAt: pin.pinned_at}).onConflictDoNothing().run();
      if (inserted.changes) waiting += 1;
      else already += 1;
    }
  }
  if (applied || waiting) report.imported.push(`Pins: ${applied} on emails already here, ${waiting} waiting for their emails to arrive with the backfill`);
  if (already) skip('Pins', `${already} already pinned or waiting in v2`);
}
