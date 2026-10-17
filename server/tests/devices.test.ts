// Paired iPhones (SV-84, D276): Settings › Security's one-time pairing code, the app's exchange of it
// for a device token, requests signed in by that bearer token, and Revoke.
import {describe, expect, test} from 'vitest';
import {issuePairingCode, PAIRING_MINUTES} from '../src/auth/devices.ts';
import {issueSetupToken, sweepExpiredAuth} from '../src/auth/owner.ts';
import * as t from '../src/db/schema.ts';
import {client, PASSWORD, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const DAY = 24 * 60 * 60_000;

/** The app: no cookie and no Origin, only its bearer token once it has one. */
function phone(c: Awaited<ReturnType<typeof signedIn>>) {
  let token: string | null = null;
  const send = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await c.app.request(url, {
      method,
      headers: {...(body === undefined ? {} : {'content-type': 'application/json'}), ...(token ? {authorization: `Bearer ${token}`} : {}), ...headers},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const text = await response.text();
    return {status: response.status, body: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text, headers: response.headers};
  };
  return {
    send,
    async pair(code: string, name?: string) {
      const paired = await send('POST', '/api/auth/pair', {code, ...(name === undefined ? {} : {name})});
      if (paired.status === 201) token = paired.body.token;
      return paired;
    },
    get token() {
      return token;
    },
    set token(value: string | null) {
      token = value;
    },
  };
}

async function paired(w: World, name?: string) {
  const c = await signedIn(w);
  const code = (await c.send('POST', '/api/security/pairing')).body.code as string;
  const app = phone(c);
  expect((await app.pair(code, name)).status).toBe(201);
  return {c, app};
}

describe('pairing', () => {
  test('Add iPhone gives a one-time code for five minutes, as a setpoint://pair link holding the server; only its hash is kept', async () => {
    const w = world({seed: true});
    const c = client(w, {publicUrl: 'https://setpoint.example.com'});
    const own = {origin: 'https://setpoint.example.com'};
    await c.send('POST', '/api/auth/claim', {body: {setup_token: issueSetupToken(w.store).token, password: PASSWORD}, headers: own});
    const issued = await c.send('POST', '/api/security/pairing', {headers: own});
    expect(issued.status).toBe(201);
    const {code, server, link, expires_at: expiresAt} = issued.body;
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(server).toBe('https://setpoint.example.com');
    expect(link).toBe(`setpoint://pair?server=https%3A%2F%2Fsetpoint.example.com&code=${code}`);
    expect(new URL(link).searchParams.get('server')).toBe(server);
    expect(Date.parse(expiresAt) - w.store.now().getTime()).toBe(PAIRING_MINUTES * 60_000);
    expect(JSON.stringify(w.store.db.select().from(t.pairingCodes).all())).not.toContain(code);
  });

  test('the app exchanges the code, with no session and no Origin, for a device token kept only as a hash; the code works once', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const code = (await c.send('POST', '/api/security/pairing')).body.code as string;
    const app = phone(c);
    const exchanged = await app.pair(code, 'iPhone 17 Pro');
    expect(exchanged.status).toBe(201);
    expect(exchanged.body).toEqual({
      token: expect.stringMatching(/^sp_device_[A-Za-z0-9_-]{43}$/),
      device: {id: expect.any(Number), name: 'iPhone 17 Pro', paired_at: w.store.now().toISOString(), last_used_at: null},
    });
    expect(JSON.stringify(w.store.db.select().from(t.devices).all())).not.toContain(app.token!.slice('sp_device_'.length));
    const again = await phone(c).pair(code);
    expect(again).toMatchObject({status: 401, body: {error: {code: 'bad_pairing_code'}}});
    expect(w.store.db.select().from(t.devices).all()).toHaveLength(1);
  });

  test.each([
    ['a wrong code', async (_w: World, code: string) => `${code.slice(0, -1)}${code.endsWith('A') ? 'B' : 'A'}`],
    ['an expired code', async (w: World, code: string) => (w.advance(PAIRING_MINUTES * 60_000), code)],
    ['a code replaced by a newer one', async (w: World, code: string) => (issuePairingCode(w.store, 'http://localhost'), code)],
  ])('%s pairs nothing', async (_, spoil) => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const code = (await c.send('POST', '/api/security/pairing')).body.code as string;
    const tried = await phone(c).pair(await spoil(w, code));
    expect(tried).toMatchObject({status: 401, body: {error: {code: 'bad_pairing_code'}}});
    expect(w.store.db.select().from(t.devices).all()).toEqual([]);
  });

  test('Cancel withdraws the code; a device without a name is "iPhone"', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const withdrawn = (await c.send('POST', '/api/security/pairing')).body.code as string;
    expect((await c.send('DELETE', '/api/security/pairing')).status).toBe(204);
    expect((await phone(c).pair(withdrawn)).status).toBe(401);
    const code = (await c.send('POST', '/api/security/pairing')).body.code as string;
    expect((await phone(c).pair(code, '  ')).body.device.name).toBe('iPhone');
  });

  test('Add iPhone needs the password confirmed in the last 10 minutes; it ends no session', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    w.advance(11 * 60_000);
    expect((await c.send('POST', '/api/security/pairing')).body.error.code).toBe('password_required');
    await c.send('POST', '/api/security/confirm-password', {body: {password: PASSWORD}});
    const before = c.cookie;
    expect((await c.send('POST', '/api/security/pairing')).status).toBe(201);
    expect(c.cookie).toBe(before);
    expect((await c.send('GET', '/api/me')).status).toBe(200);
  });

  test('expired codes are swept at sign-in', async () => {
    const w = world({seed: true});
    await signedIn(w);
    issuePairingCode(w.store, 'http://localhost');
    w.advance(PAIRING_MINUTES * 60_000);
    sweepExpiredAuth(w.store);
    expect(w.store.db.select().from(t.pairingCodes).all()).toEqual([]);
  });
});

describe('a paired iPhone', () => {
  test('signs in with its bearer token, skipping the cookie\'s origin check, as "device"; its use shows in Settings › Security', async () => {
    const w = world({seed: true});
    const {c, app} = await paired(w, 'iPhone 17 Pro');
    expect((await app.send('GET', '/api/mail/counts')).body).toMatchObject({attention: 3, unread: 19});
    expect((await app.send('GET', '/api/me')).body).toMatchObject({method: 'device', recent_password: false});
    // No Origin, or another one: a browser never sends the token by itself, so no page can ride on it.
    expect((await app.send('POST', '/api/mail/mark-all-read', {})).status).toBe(200);
    expect((await app.send('POST', '/api/mail/messages/5/open', undefined, {origin: 'https://elsewhere.example.com'})).status).toBe(200);
    const security = (await c.send('GET', '/api/security')).body;
    expect(security.devices).toEqual([{id: expect.any(Number), name: 'iPhone 17 Pro', paired_at: expect.any(String), last_used_at: w.store.now().toISOString()}]);
  });

  test('can\'t read or change Settings › Security, or pair another, or spend a password attempt there', async () => {
    const w = world({seed: true});
    const {app} = await paired(w);
    for (const [method, url] of [['GET', '/api/security'], ['POST', '/api/security/pairing'], ['DELETE', '/api/security/devices/1'], ['POST', '/api/security/recovery-codes']] as const) {
      expect((await app.send(method, url)).body.error.code).toBe('browser_only');
    }
    const attempts = () => w.store.db.select().from(t.owner).get()!.passwordAttempts;
    const before = attempts();
    expect((await app.send('POST', '/api/security/confirm-password', {password: 'a guess'})).body.error.code).toBe('browser_only');
    expect(attempts()).toBe(before);
  });

  test('has no idle timeout and outlives a password change and new recovery codes', async () => {
    const w = world({seed: true});
    const {c, app} = await paired(w);
    w.advance(400 * DAY);
    expect((await app.send('GET', '/api/me')).status).toBe(200);
    // The browser's session idled out long ago.
    expect((await c.send('GET', '/api/me')).status).toBe(401);
    c.cookie = null;
    await c.send('POST', '/api/auth/sign-in', {body: {password: PASSWORD}});
    expect((await c.send('PUT', '/api/security/password', {body: {new_password: 'the next long password'}})).status).toBe(204);
    expect((await c.send('POST', '/api/security/recovery-codes')).status).toBe(200);
    expect((await app.send('GET', '/api/me')).status).toBe(200);
  });

  test('Revoke ends it at once, without the password; every request is then 401', async () => {
    const w = world({seed: true});
    const {c, app} = await paired(w);
    w.advance(11 * 60_000);
    const [device] = (await c.send('GET', '/api/security')).body.devices;
    expect((await c.send('DELETE', `/api/security/devices/${device.id}`)).status).toBe(204);
    const refused = await app.send('GET', '/api/mail/counts');
    expect(refused).toMatchObject({status: 401, body: {error: {code: 'unauthorized'}}});
    expect(refused.headers.get('www-authenticate')).toBe('Bearer realm="setpoint"');
    expect((await c.send('GET', '/api/security')).body.devices).toEqual([]);
  });

  test('recovery with a code ends it, as it clears passkeys', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const codes = (await c.send('POST', '/api/security/recovery-codes')).body.recovery_codes as string[];
    const code = (await c.send('POST', '/api/security/pairing')).body.code as string;
    const app = phone(c);
    await app.pair(code);
    expect((await c.send('POST', '/api/auth/recover', {body: {recovery_code: codes[0], new_password: 'recovered password!'}})).status).toBe(200);
    expect((await app.send('GET', '/api/me')).status).toBe(401);
  });

  test('the app\'s Unpair revokes its own token; a browser can\'t use that route', async () => {
    const w = world({seed: true});
    const {c, app} = await paired(w);
    expect((await c.send('DELETE', '/api/device')).body.error.code).toBe('device_only');
    expect((await app.send('DELETE', '/api/device')).status).toBe(204);
    expect((await app.send('GET', '/api/me')).status).toBe(401);
  });

  test('an Authorization header is the only credential: a wrong one is refused even beside a good cookie', async () => {
    const w = world({seed: true});
    const {c} = await paired(w);
    for (const authorization of ['Basic dXNlcjpwYXNz', 'Bearer', `Bearer ${'A'.repeat(43)}`, `Bearer sp_device_${'A'.repeat(43)}`]) {
      expect((await c.send('GET', '/api/me', {headers: {authorization}})).status).toBe(401);
    }
    // A session's secret is no device token.
    expect((await c.send('GET', '/api/me', {headers: {authorization: `Bearer ${c.cookie!.split('=')[1]}`}})).status).toBe(401);
  });

  test('its live stream ends once it is revoked', async () => {
    const w = world({seed: true});
    const c = await signedIn(w, {keepAliveMs: 20});
    const code = (await c.send('POST', '/api/security/pairing')).body.code as string;
    const app = phone(c);
    await app.pair(code);
    const stream = await c.app.request('/api/events', {headers: {authorization: `Bearer ${app.token}`}});
    expect(stream.status).toBe(200);
    const [device] = (await c.send('GET', '/api/security')).body.devices;
    await c.send('DELETE', `/api/security/devices/${device.id}`);
    expect(await stream.text()).toContain('event: ready');
  });
});
