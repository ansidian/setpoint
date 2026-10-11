// Home Assistant's status endpoint over the API on the seed (B6; BRIEF.md › The mail chip in mantel):
// the chip's numbers are the sidebar's, opening never drops attention, Done and archiving do, a
// source needing reconnect is never all clear, and only Home Assistant's own token reads it.
import {haStatusSchema, SEED_NOW} from '@setpoint/shared';
import {and, eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {issueHaToken, revokeHaToken} from '../src/auth/haToken.ts';
import {confirmCommand} from '../src/commands/index.ts';
import {markAllRead, setRead} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {ProviderError} from '../src/sync/errors.ts';
import {recordFailure} from '../src/sync/health.ts';
import {applyProviderStates} from '../src/sync/mailMirror.ts';
import {client, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const idOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!;
const accountOf = (w: World, label: string) => w.store.db.select().from(t.accounts).where(eq(t.accounts.label, label)).get()!;
const sourceOf = (w: World, label: string, provider: 'gmail' | 'google_calendar') =>
  w.store.db.select().from(t.sources).where(and(eq(t.sources.accountId, accountOf(w, label).id), eq(t.sources.provider, provider))).get()!;
const revoked = () => new ProviderError('auth', 'Token has been expired or revoked. (invalid_grant)', {status: 400});

/** Setpoint signed in as the owner (the sidebar's view) and Home Assistant with its token. */
async function setup(options: {publicUrl?: string} = {}) {
  const w = world({seed: true});
  const owner = await signedIn(w);
  // Home Assistant's app: the same store, optionally behind a public URL.
  const haApp = options.publicUrl ? client(w, options).app : owner.app;
  const {token} = issueHaToken(w.store);
  const ha = async (authorization: string | null = `Bearer ${token}`, method = 'GET') => {
    const response = await haApp.request('/api/status/ha', {method, headers: authorization ? {authorization} : {}});
    const text = await response.text();
    return {status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null};
  };
  /** Reads the status and checks it against the sidebar's own queries, read at the same moment. */
  const status = async () => {
    const got = await ha();
    expect(got.status).toBe(200);
    const parsed = haStatusSchema.parse(got.body);
    const counts = (await owner.send('GET', '/api/mail/counts')).body;
    const view = (await owner.send('GET', '/api/mail/inbox')).body;
    expect([parsed.attention, parsed.unread_fyi]).toEqual([counts.attention, counts.unread_fyi]);
    expect([parsed.attention, parsed.unread_fyi]).toEqual([view.counts.attention, view.counts.unread_fyi]);
    const attention = view.groups.find((group: {group: string}) => group.group === 'attention')?.rows ?? [];
    expect(parsed.attention_emails.map(email => [email.id, email.unread])).toEqual(attention.slice(0, 3).map((row: {id: number; unread: boolean}) => [row.id, row.unread]));
    return parsed;
  };
  return {w, owner, token, ha, status};
}

describe('the status on the seed', () => {
  test('3 attention, 11 unread FYI, the three attention emails with their links, nothing to reconnect', async () => {
    const {w, status} = await setup();
    const got = await status();
    expect(got).toMatchObject({as_of: SEED_NOW, all_clear: false, attention: 3, unread_fyi: 11, needs_reconnect: [], open_url: 'http://localhost/inbox'});
    const recovery = idOf(w, 'Your recovery email was changed');
    const personal = accountOf(w, 'Personal');
    expect(got.attention_emails.map(email => [email.subject, email.unread])).toEqual([
      ['Your recovery email was changed', true],
      ['Interview availability for Software Engineer I', true],
      ['Final exam schedule · CS 101', false],
    ]);
    expect(got.attention_emails[0]).toEqual({
      id: recovery.id, sender: recovery.organisation ?? recovery.fromName, from_name: recovery.fromName, organisation: recovery.organisation,
      subject: 'Your recovery email was changed', account: {id: personal.id, label: 'Personal', colour: 'cool'}, received_at: recovery.receivedAt,
      unread: true, path: `/inbox/${recovery.id}`, url: `http://localhost/inbox/${recovery.id}`,
    });
  });

  test('links are on Setpoint\'s public URL', async () => {
    const {status} = await setup({publicUrl: 'https://setpoint.example.com'});
    const got = await status();
    expect(got.open_url).toBe('https://setpoint.example.com/inbox');
    expect(got.attention_emails[0]!.url).toMatch(/^https:\/\/setpoint\.example\.com\/inbox\/\d+$/);
  });
});

describe('the counts follow the Inbox', () => {
  test('opening an attention email leaves attention alone; opening FYI drops unread FYI', async () => {
    const {w, owner, status} = await setup();
    const interview = idOf(w, 'Interview availability for Software Engineer I').id;
    expect((await owner.send('POST', `/api/mail/messages/${interview}/open`)).status).toBe(200);
    let got = await status();
    expect([got.attention, got.unread_fyi]).toEqual([3, 11]);
    expect(got.attention_emails.find(email => email.id === interview)!.unread).toBe(false);
    await owner.send('POST', `/api/mail/messages/${idOf(w, 'Out for delivery').id}/open`);
    got = await status();
    expect([got.attention, got.unread_fyi]).toEqual([3, 10]);
  });

  test('Done drops it from attention and from the list', async () => {
    const {w, owner, status} = await setup();
    const recovery = idOf(w, 'Your recovery email was changed').id;
    await owner.send('POST', `/api/mail/messages/${recovery}/done`, {body: {done: true}});
    const got = await status();
    expect(got.attention).toBe(2);
    expect(got.attention_emails.map(email => email.id)).not.toContain(recovery);
  });

  test('mail archived at its provider drops out (D14)', async () => {
    const {w, status} = await setup();
    const interview = idOf(w, 'Interview availability for Software Engineer I');
    const statement = idOf(w, 'Statement ready');
    applyProviderStates(w.store, interview.accountId, new Map([[interview.providerId, {unread: true, trashed: false, archived: true}]]));
    applyProviderStates(w.store, statement.accountId, new Map([[statement.providerId, {unread: true, trashed: false, archived: true}]]));
    const got = await status();
    expect([got.attention, got.unread_fyi]).toEqual([2, 10]);
    expect(got.attention_emails.map(email => email.id)).not.toContain(interview.id);
  });
});

describe('needs reconnect', () => {
  test('an account\'s sources needing sign-in are one entry, linking to Settings › Accounts', async () => {
    const {w, status} = await setup();
    recordFailure(w.store, sourceOf(w, 'Personal', 'gmail').id, revoked());
    recordFailure(w.store, sourceOf(w, 'Personal', 'google_calendar').id, revoked());
    recordFailure(w.store, sourceOf(w, 'Jobs', 'google_calendar').id, revoked());
    const got = await status();
    expect(got.needs_reconnect).toEqual([
      {label: 'Personal', account_id: accountOf(w, 'Personal').id, providers: ['gmail', 'google_calendar'], path: '/settings/accounts', url: 'http://localhost/settings/accounts'},
      {label: 'Jobs', account_id: accountOf(w, 'Jobs').id, providers: ['google_calendar'], path: '/settings/accounts', url: 'http://localhost/settings/accounts'},
    ]);
    // A failing source isn't a reconnect.
    recordFailure(w.store, sourceOf(w, 'Business', 'gmail').id, new ProviderError('transient', 'Backend Error (503)', {status: 503}));
    expect((await status()).needs_reconnect.map(entry => entry.label)).toEqual(['Personal', 'Jobs']);
  });

  test('is never all clear, even with nothing to read', async () => {
    const {w, owner, status} = await setup();
    for (const email of (await status()).attention_emails) await owner.send('POST', `/api/mail/messages/${email.id}/done`, {body: {done: true}});
    for (const command of markAllRead(w.store)) confirmCommand(w.store, command.id);
    // Mark all as read leaves Security (UX #4); those are read one by one.
    const security = w.store.db.select().from(t.messages).where(and(eq(t.messages.kind, 'security'), eq(t.messages.unread, true))).all();
    for (const message of security) confirmCommand(w.store, setRead(w.store, message.id, false).id);
    expect(await status()).toMatchObject({attention: 0, unread_fyi: 0, attention_emails: [], needs_reconnect: [], all_clear: true});
    recordFailure(w.store, sourceOf(w, 'Business', 'gmail').id, revoked());
    expect(await status()).toMatchObject({attention: 0, unread_fyi: 0, needs_reconnect: [{label: 'Business', providers: ['gmail']}], all_clear: false});
  });
});

describe('Home Assistant\'s token', () => {
  test('401 without it, with a wrong one, or with another scheme', async () => {
    const {token, ha} = await setup();
    for (const authorization of [null, 'Bearer sp_ha_wrong', `Basic ${token}`, `Bearer ${token}x`, 'Bearer ']) {
      const got = await ha(authorization);
      expect(got.status).toBe(401);
      expect(got.headers.get('www-authenticate')).toMatch(/^Bearer/);
      expect(got.body.error.code).toBe('unauthorized');
    }
    expect((await ha()).status).toBe(200);
  });

  test('the owner\'s session doesn\'t read it, and the token reads nothing else', async () => {
    const {w, owner, token} = await setup();
    expect((await owner.send('GET', '/api/status/ha')).status).toBe(401);
    const ha = client(w);
    for (const route of ['/api/mail/counts', '/api/mail/inbox', '/api/accounts', '/api/me']) {
      expect((await ha.send('GET', route, {headers: {authorization: `Bearer ${token}`}})).status).toBe(401);
    }
  });

  test('it only reads: another method with the token is refused', async () => {
    const {ha} = await setup();
    expect((await ha(undefined, 'POST')).status).toBe(401);
    expect((await ha(undefined, 'DELETE')).status).toBe(401);
  });

  test('rotating replaces it, and revoking ends it', async () => {
    const {w, token, ha} = await setup();
    const next = issueHaToken(w.store).token;
    expect(next).not.toBe(token);
    expect((await ha(`Bearer ${token}`)).status).toBe(401);
    expect((await ha(`Bearer ${next}`)).status).toBe(200);
    expect(revokeHaToken(w.store)).toBe(true);
    expect((await ha(`Bearer ${next}`)).status).toBe(401);
    expect(revokeHaToken(w.store)).toBe(false);
  });

  test('only its hash is stored', async () => {
    const {w, token} = await setup();
    const row = w.store.db.select().from(t.haToken).get()!;
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token.slice(6));
  });
});
