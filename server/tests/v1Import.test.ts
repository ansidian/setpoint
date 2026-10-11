// v1's export file (an invented one: example domains, fake tokens) imported into v2: the owner and
// sign-in rows, accounts through Connect Gmail's and Connect iCloud's own paths (Gmail with its
// Calendar source), Todoist, keys, models and Home, triage's rules and corrections, trusted senders
// as domains, and pins now or as their emails arrive. Secrets are sealed with v2's key and never in
// the report; a second run changes nothing and says why; a claimed v2 keeps its own password.
import fs from 'node:fs';
import {and, eq} from 'drizzle-orm';
import {expect, test} from 'vitest';
import {claimOwner, getOwner, hashRecoveryCode, issueSetupToken, passwordMatches} from '../src/auth/owner.ts';
import {createSession, findSession} from '../src/auth/sessions.ts';
import * as t from '../src/db/schema.ts';
import {importV1} from '../src/importV1.ts';
import {connectGmail} from '../src/providers/gmail/connect.ts';
import {readSecret, readSourceCredentials} from '../src/secrets/store.ts';
import {getSettings} from '../src/settings.ts';
import type {Store} from '../src/store.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {listRules} from '../src/triage/learning.ts';
import {world} from './helpers.ts';

const FILE = JSON.parse(fs.readFileSync(new URL('./fixtures/v1-export.json', import.meta.url), 'utf8'));
// Made with v1's own bcrypt (6.0.0) for the fixture's hash.
const V1_PASSWORD = 'correct horse battery staple';
const SECRETS = ['fake-refresh-personal', 'fake-access-personal', 'fake-refresh-jobs', 'fake-app-password', 'fake-todoist-token', 'fake-anthropic-key', 'fake-places-key', 'fake-weather-key', '$2b$04$'];

const fetched = (overrides: Partial<FetchedMessage>): FetchedMessage => ({
  providerId: `p-${Math.random().toString(36).slice(2)}`, threadId: 'thread', rfc822Id: null, fromName: 'Sender', fromAddress: 'sender@example.com',
  subject: 'Hello', snippet: 'Hello.', bodyText: 'Hello.', bodyHtml: null, receivedAt: '2026-09-28T16:00:00.000Z', senderAuth: null,
  attachments: [], unread: false, trashed: false, archived: false, ...overrides,
});

const accountId = (store: Store, address: string) => store.db.select().from(t.accounts).where(eq(t.accounts.address, address)).get()!.id;
const sourcesOf = (store: Store, id: number) => store.db.select().from(t.sources).where(eq(t.sources.accountId, id)).all();

test('v1\'s export imports into a fresh v2, sealed, and a second run changes nothing', async () => {
  const {store} = world();
  issueSetupToken(store);
  const report = importV1(store, FILE, {gmailPush: true});

  expect(report.imported).toEqual([
    'Owner: v1\'s password and its 2 unused recovery codes',
    'Passkeys: Laptop',
    'user@example.com: Gmail (push) and its Calendar',
    'user.jobs@example.com: Gmail (push) and its Calendar',
    'user@icloud.example: iCloud',
    'Anthropic key',
    'Maps key (Places and Routes)',
    'Pirate Weather key',
    'Todoist',
    'Home: Home',
    'Trusted domains: contoso.example, fabrikam.co.uk',
    'Pins: 0 on emails already here, 3 waiting for their emails to arrive with the backfill',
  ]);
  expect(report.skipped).toEqual([
    'A passkey after the password: not turned on, so a hostname v1\'s passkeys don\'t work on can\'t lock you out. Turn it on in Settings › Security once a passkey has signed you in',
    'old@example.com: v1 has no Google sign-in for it: Connect Gmail in v2',
    'Models: v2 keeps its own choices; change them in Settings › AI',
    'Trusted sender not-an-address: it has no domain v2 can trust',
    'A pin in user@icloud.example: it names no Gmail id or Message-ID to find its email by',
    'A pin in old@example.com: that account isn\'t in v2',
  ]);
  expect(report.notes).toEqual([
    'v1\'s passkeys are tied to v1\'s hostname: they work while v2 serves it, and on any other hostname sign in with the password.',
    'user.jobs@example.com\'s icon (Rocket) has no v2 glyph; it shows mail. Pick one in Settings › Accounts.',
    'v1 kept user.jobs@example.com\'s calendars off; v2 shows them. Hide them in Settings › Calendar.',
    'v1 was waiting to sign in to user.jobs@example.com again: if v2 can\'t sync it either, reconnect it in Settings › Accounts.',
  ]);
  expect(report.triage).toEqual({rules: {imported: 1, disabled: [], skipped: []}, corrections: {imported: 1, already: 0, ignored: 0, toward_prompts: 1}});
  const printed = JSON.stringify(report);
  for (const secret of SECRETS) expect(printed).not.toContain(secret);

  // The owner: v1's bcrypt hash verifies with bcryptjs, v1's codes recover, the import replaced the claim.
  const owner = getOwner(store)!;
  expect(owner.authMode).toBe('password_or_passkey');
  expect(await passwordMatches(owner, V1_PASSWORD)).toBe(true);
  expect(await passwordMatches(owner, 'not the password')).toBe(false);
  expect(store.db.select().from(t.recoveryCodes).all().map(row => row.hash)).toContain(hashRecoveryCode('sp-1a2b-3c4d-5e6f-7a8b-9c0d-1e2f-3a4b-5c6d'));
  expect(store.db.select().from(t.setupTokens).all()).toEqual([]);
  expect(store.db.select().from(t.passkeys).all()).toMatchObject([{credentialId: 'ZmFrZS1jcmVkZW50aWFsLW9uZQ', label: 'Laptop', signCount: 7, transports: ['internal', 'hybrid'], backedUp: true}]);

  // Accounts in v1's order with their look; Gmail with its Calendar source on the same sealed sign-in.
  expect(store.db.select().from(t.accounts).orderBy(t.accounts.position).all().map(row => [row.address, row.label, row.colour, row.icon, row.provider])).toEqual([
    ['user@example.com', 'Personal', 'warm', 'mail', 'gmail'],
    ['user.jobs@example.com', 'Jobs', 'cool', 'mail', 'gmail'],
    ['user@icloud.example', 'iCloud', 'violet', 'cloud', 'icloud'],
  ]);
  const personal = sourcesOf(store, accountId(store, 'user@example.com'));
  expect(personal.map(source => [source.provider, source.syncMode])).toEqual([['gmail', 'push'], ['google_calendar', 'push']]);
  for (const source of personal) {
    expect(source.credentials).toMatch(/^sp2:/);
    expect(source.credentials).not.toContain('fake-refresh-personal');
    expect(readSourceCredentials(store, source.id)).toEqual({
      kind: 'oauth', refresh_token: 'fake-refresh-personal', access_token: 'fake-access-personal', expires_at: '2026-10-20T17:30:00.000Z',
      scope: FILE.accounts[0].scope,
    });
  }
  const [icloud] = sourcesOf(store, accountId(store, 'user@icloud.example'));
  expect(readSourceCredentials(store, icloud!.id)).toEqual({kind: 'app_password', username: 'user@icloud.example', password: 'fake-app-password'});
  const todoist = store.db.select().from(t.sources).where(eq(t.sources.provider, 'todoist')).get()!;
  expect(readSourceCredentials(store, todoist.id)).toEqual({kind: 'api_key', key: 'fake-todoist-token'});
  expect(store.db.select().from(t.calendars).where(eq(t.calendars.provider, 'todoist')).all()).toHaveLength(1);
  const weather = store.db.select().from(t.sources).where(eq(t.sources.provider, 'weather')).get()!;
  expect(readSourceCredentials(store, weather.id)).toEqual({kind: 'api_key', key: 'fake-weather-key'});
  for (const row of store.db.select().from(t.secrets).all()) expect(row.ciphertext).toMatch(/^sp2:/);
  expect(readSecret(store, 'anthropic_api_key')).toBe('fake-anthropic-key');
  expect(readSecret(store, 'places_api_key')).toBe('fake-places-key');
  expect(readSecret(store, 'openai_api_key')).toBeNull();

  const settings = getSettings(store);
  expect(settings.ai).toEqual({triage_model: null, triage_strong_model: null, alfred_model: null, history_model: null});
  expect(settings.calendar.home).toEqual({label: 'Home', address: '1 Example Street', lat: 34.1016, lng: -118.3267});
  expect(listRules(store).filter(rule => rule.imported).map(rule => rule.match)).toEqual([{from_addresses: ['news@fabrikam.example']}]);
  expect(store.db.select().from(t.trustedDomains).all().map(row => row.domain).sort()).toEqual(['contoso.example', 'fabrikam.co.uk']);

  // Pins wait for their emails, found by Gmail's id or by Message-ID, and land as they arrive.
  upsertMessages(store, accountId(store, 'user@example.com'), [fetched({providerId: 'gmail-already-here', rfc822Id: '<lease@parkside.example>'}), fetched({subject: 'Unpinned'})], {backfill: true});
  upsertMessages(store, accountId(store, 'user@icloud.example'), [fetched({providerId: '1700000000:42', rfc822Id: '<registration@dmv.example>'})], {backfill: true});
  expect(store.db.select({subject: t.messages.subject, providerId: t.messages.providerId, pinnedAt: t.messages.pinnedAt}).from(t.messages).all()).toEqual([
    {subject: 'Hello', providerId: 'gmail-already-here', pinnedAt: '2026-09-30T18:02:00.000Z'},
    {subject: 'Unpinned', providerId: expect.any(String), pinnedAt: null},
    {subject: 'Hello', providerId: '1700000000:42', pinnedAt: '2026-09-20T09:00:00.000Z'},
  ]);
  expect(store.db.select({providerId: t.pendingPins.providerId}).from(t.pendingPins).all()).toEqual([{providerId: 'gmail-arrives-later'}]);

  // Again: nothing new, nothing overwritten, and the report says why.
  const sealed = store.db.select({credentials: t.sources.credentials}).from(t.sources).all();
  const again = importV1(store, FILE, {gmailPush: false});
  expect(again.imported).toEqual([]);
  expect(again.skipped).toEqual([
    'Owner: v2 is already claimed, so its own password and recovery codes stay',
    'Passkeys: 1 already in v2',
    'A passkey after the password: not turned on, so a hostname v1\'s passkeys don\'t work on can\'t lock you out. Turn it on in Settings › Security once a passkey has signed you in',
    'user@example.com: already in v2, so its sign-in, label, colour and icon stay',
    'user.jobs@example.com: already in v2, so its sign-in, label, colour and icon stay',
    'old@example.com: v1 has no Google sign-in for it: Connect Gmail in v2',
    'user@icloud.example: already in v2, so its sign-in, label, colour and icon stay',
    'Anthropic key: already set in v2',
    'Maps key (Places and Routes): already set in v2',
    'Pirate Weather key: already set in v2',
    'Todoist: already connected in v2',
    'Models: v2 keeps its own choices; change them in Settings › AI',
    'Home: already set in v2',
    'Trusted sender not-an-address: it has no domain v2 can trust',
    'Trusted domains: 2 already trusted in v2',
    'A pin in user@icloud.example: it names no Gmail id or Message-ID to find its email by',
    'A pin in old@example.com: that account isn\'t in v2',
    'Pins: 3 already pinned or waiting in v2',
  ]);
  expect(again.triage.corrections).toEqual({imported: 0, already: 1, ignored: 0, toward_prompts: 0});
  expect(store.db.select({credentials: t.sources.credentials}).from(t.sources).all()).toEqual(sealed);
  expect(store.db.select().from(t.accounts).all()).toHaveLength(3);
});

test('a claimed v2 keeps its password; v1\'s passkeys join as a security change, and pins land on mail already here', async () => {
  const {store} = world();
  const {token} = issueSetupToken(store);
  await claimOwner(store, token, 'v2 password of my own', 4);
  const session = createSession(store, {generation: getOwner(store)!.securityGeneration, method: 'password', passwordAt: null})!;
  // Personal was connected in v2 before the import, and its backfill brought the pinned email.
  const {accountId: personal} = connectGmail(store, true, {address: 'user@example.com', credentials: {kind: 'oauth', refresh_token: 'v2-own-refresh', access_token: null, expires_at: null, scope: null}});
  upsertMessages(store, personal, [fetched({providerId: 'gmail-other-id', rfc822Id: '<lease@parkside.example>'})], {backfill: true});

  const report = importV1(store, FILE, {gmailPush: true});
  expect(report.skipped.slice(0, 2)).toEqual([
    'Owner: v2 is already claimed, so its own password and recovery codes stay',
    'A passkey after the password: not turned on, so a hostname v1\'s passkeys don\'t work on can\'t lock you out. Turn it on in Settings › Security once a passkey has signed you in',
  ]);
  expect(report.skipped).toContain('user@example.com: already in v2, so its sign-in, label, colour and icon stay');
  expect(report.imported).toContain('Passkeys: Laptop');
  expect(report.imported).toContain('Pins: 1 on emails already here, 2 waiting for their emails to arrive with the backfill');

  const owner = getOwner(store)!;
  expect(await passwordMatches(owner, 'v2 password of my own')).toBe(true);
  expect(await passwordMatches(owner, V1_PASSWORD)).toBe(false);
  expect(owner.securityGeneration).toBe(2);
  expect(findSession(store, session, false)).toBeNull();
  // Found by its Message-ID under v2's own Gmail id; v2's sign-in for the account is untouched.
  expect(store.db.select({pinnedAt: t.messages.pinnedAt}).from(t.messages).where(and(eq(t.messages.accountId, personal), eq(t.messages.providerId, 'gmail-other-id'))).get()).toEqual({pinnedAt: '2026-09-30T18:02:00.000Z'});
  const [gmail] = sourcesOf(store, personal);
  expect(readSourceCredentials(store, gmail!.id)).toMatchObject({refresh_token: 'v2-own-refresh'});
});

test('a file that isn\'t v1\'s export, or is broken, is refused whole and writes nothing', () => {
  const {store} = world();
  expect(() => importV1(store, {...FILE, version: 2}, {gmailPush: true})).toThrow(/version/);
  expect(() => importV1(store, {...FILE, owner: {...FILE.owner, password_hash: 'plaintext'}}, {gmailPush: true})).toThrow('Not a bcrypt hash');
  expect(() => importV1(store, {...FILE, pins: [...FILE.pins, {account: 'user@example.com', provider_id: 'x', message_id: null, pinned_at: 'yesterday'}]}, {gmailPush: true})).toThrow(/pinned_at/);
  expect(getOwner(store)).toBeNull();
  expect(store.db.select().from(t.accounts).all()).toEqual([]);
  expect(store.db.select().from(t.secrets).all()).toEqual([]);
});

// D41: v1's model choices never replace v2's own (D25, D26), whatever they were.
test('v1\'s models are never imported', () => {
  const {store} = world();
  const report = importV1(store, {...FILE, models: {triage_cheap: 'claude-haiku-5-5', triage_strong: 'claude-haiku-5-5', alfred: 'claude-haiku-5-5'}}, {gmailPush: true});
  expect(getSettings(store).ai).toEqual({triage_model: null, triage_strong_model: null, alfred_model: null, history_model: null});
  expect(report.skipped).toContain('Models: v2 keeps its own choices; change them in Settings › AI');
});

test('without Pub/Sub, imported Gmail accounts are polled, as Connect Gmail does', () => {
  const {store} = world();
  importV1(store, {...FILE, accounts: [FILE.accounts[0]]}, {gmailPush: false});
  expect(sourcesOf(store, accountId(store, 'user@example.com')).map(source => [source.provider, source.syncMode, source.intervalSeconds])).toEqual([
    ['gmail', 'poll', 120], ['google_calendar', 'push', 900],
  ]);
});
