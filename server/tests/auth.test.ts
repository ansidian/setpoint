// Sign-in (harvested from v1's server/auth; SV-2): the first claim by setup token, the password and
// its shared budget, sessions stored as hashes, recovery codes, security transitions, strict mode
// and passkeys' challenges.
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {
  changePassword, claimOwner, generateRecoveryCodes, getOwner, hashRecoveryCode, issueSetupToken, PASSWORD_MAX_ATTEMPTS, PASSWORD_WINDOW_MS,
  passwordSignInOutcome, recover, recoveryStatus, reservePasswordAttempt, securityTransition, sweepExpiredAuth,
} from '../src/auth/owner.ts';
import {passkeySignInOptions, relyingParty, startPendingSignIn} from '../src/auth/passkeys.ts';
import {createSession, findSession, hashSecret, SESSION_DAYS} from '../src/auth/sessions.ts';
import * as t from '../src/db/schema.ts';
import {claim, client, ORIGIN, PASSWORD, signedIn, world} from './helpers.ts';

const DAY = 24 * 60 * 60_000;

describe('the first claim', () => {
  test('a setup token from the CLI claims once; only its hash is kept', async () => {
    const w = world();
    const {token, expiresAt} = issueSetupToken(w.store);
    expect(token).toMatch(/^setup_[A-Za-z0-9_-]{32}$/);
    expect(Date.parse(expiresAt) - w.store.now().getTime()).toBe(60 * 60_000);
    expect(JSON.stringify(w.store.db.select().from(t.setupTokens).all())).not.toContain(token);
    const {owner, recoveryCodes} = await claimOwner(w.store, token, PASSWORD, 4);
    expect(owner).toMatchObject({id: 1, authMode: 'password_or_passkey', securityGeneration: 1});
    expect(owner.passwordHash).toMatch(/^\$2[aby]\$04\$/);
    expect(recoveryCodes).toHaveLength(8);
    expect(w.store.db.select().from(t.setupTokens).all()).toEqual([]);
    await expect(claimOwner(w.store, token, PASSWORD, 4)).rejects.toThrow(/already claimed/);
    expect(() => issueSetupToken(w.store)).toThrow(/already claimed/);
  });

  test('a wrong, replaced or expired token, or a short password, claims nothing', async () => {
    const w = world();
    const first = issueSetupToken(w.store).token;
    const second = issueSetupToken(w.store).token;
    await expect(claimOwner(w.store, first, PASSWORD, 4)).rejects.toMatchObject({code: 'bad_setup_token'});
    await expect(claimOwner(w.store, second, 'short', 4)).rejects.toMatchObject({code: 'weak_password'});
    w.advance(61 * 60_000);
    await expect(claimOwner(w.store, second, PASSWORD, 4)).rejects.toMatchObject({code: 'bad_setup_token'});
    expect(getOwner(w.store)).toBeNull();
  });

  test('two claims at once: exactly one wins', async () => {
    const w = world();
    const {token} = issueSetupToken(w.store);
    const results = await Promise.allSettled([claimOwner(w.store, token, PASSWORD, 4), claimOwner(w.store, token, `${PASSWORD}!`, 4)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  });
});

describe('the password budget', () => {
  test('10 attempts per 15 minutes, shared by every caller, successes included; a refusal doesn\'t extend it', async () => {
    const w = world();
    await claim(w);
    for (let attempt = 0; attempt < PASSWORD_MAX_ATTEMPTS; attempt += 1) reservePasswordAttempt(w.store);
    expect(() => reservePasswordAttempt(w.store)).toThrow(expect.objectContaining({status: 429, details: {retry_after_seconds: 900}}));
    w.advance(PASSWORD_WINDOW_MS - 1000);
    expect(() => reservePasswordAttempt(w.store)).toThrow(expect.objectContaining({details: {retry_after_seconds: 1}}));
    w.advance(1000);
    expect(() => reservePasswordAttempt(w.store)).not.toThrow();
  });

  test('without an owner, every attempt is refused', () => {
    expect(() => reservePasswordAttempt(world().store)).toThrow(/claimed/);
  });

  test.each([
    ['password_or_passkey', 0, 'signed_in'], ['password_or_passkey', 2, 'signed_in'],
    ['password_plus_passkey', 1, 'passkey_required'], ['password_plus_passkey', 0, 'misconfigured'],
  ] as const)('%s with %i passkeys: %s', (mode, count, outcome) => {
    expect(passwordSignInOutcome(mode, count)).toBe(outcome);
  });
});

describe('sessions', () => {
  test('stored as hashes; 30 days from last use; ended by a security change', async () => {
    const w = world();
    const {owner} = await claim(w);
    const secret = createSession(w.store, {generation: owner.securityGeneration, method: 'password', passwordAt: null})!;
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(w.store.db.select().from(t.sessions).where(eq(t.sessions.hash, hashSecret(secret))).get()).toBeDefined();
    expect(JSON.stringify(w.store.db.select().from(t.sessions).all())).not.toContain(secret);
    w.advance(SESSION_DAYS * DAY - 1000);
    expect(findSession(w.store, secret)).toMatchObject({renewed: true});
    w.advance(SESSION_DAYS * DAY - 1000);
    expect(findSession(w.store, secret)).not.toBeNull();
    w.advance(SESSION_DAYS * DAY);
    expect(findSession(w.store, secret)).toBeNull();

    const fresh = createSession(w.store, {generation: 1, method: 'password', passwordAt: null})!;
    expect(securityTransition(w.store, 1, () => {})).toBe(2);
    expect(findSession(w.store, fresh)).toBeNull();
    // A session for a generation that's gone isn't made.
    expect(createSession(w.store, {generation: 1, method: 'password', passwordAt: null})).toBeNull();
  });

  test('signing in sweeps sessions idle or ended for 30 days, and expired pending sign-ins', async () => {
    const w = world();
    await claim(w);
    const old = createSession(w.store, {generation: 1, method: 'password', passwordAt: null})!;
    startPendingSignIn(w.store, null);
    w.advance(SESSION_DAYS * DAY);
    const fresh = createSession(w.store, {generation: 1, method: 'password', passwordAt: null})!;
    sweepExpiredAuth(w.store);
    expect(w.store.db.select({hash: t.sessions.hash}).from(t.sessions).all()).toEqual([{hash: hashSecret(fresh)}]);
    expect(hashSecret(old)).not.toBe(hashSecret(fresh));
    expect(w.store.db.select().from(t.pendingSignIns).all()).toEqual([]);
  });

  test('a stale generation changes nothing; a failing change rolls back', async () => {
    const w = world();
    await claim(w);
    let ran = false;
    expect(securityTransition(w.store, 0, () => (ran = true))).toBeNull();
    expect(ran).toBe(false);
    expect(() => securityTransition(w.store, 1, () => {
      w.store.db.update(t.owner).set({authMode: 'password_plus_passkey'}).run();
      throw new Error('mutation failed');
    })).toThrow('mutation failed');
    expect(getOwner(w.store)).toMatchObject({securityGeneration: 1, authMode: 'password_or_passkey'});
  });

  test('changing the password ends the other sessions', async () => {
    const w = world();
    await claim(w);
    const other = createSession(w.store, {generation: 1, method: 'password', passwordAt: null})!;
    expect(await changePassword(w.store, 1, 'a new password entirely', 4)).toBe(2);
    expect(findSession(w.store, other)).toBeNull();
  });
});

describe('recovery codes', () => {
  test('eight, high-entropy, hashed; one recovers once, clearing passkeys and strict mode', async () => {
    const w = world();
    const {recoveryCodes} = await claim(w);
    expect(recoveryCodes.every(code => /^SP(-[0-9A-F]{4}){8}$/.test(code))).toBe(true);
    expect(new Set(recoveryCodes).size).toBe(8);
    expect(JSON.stringify(w.store.db.select().from(t.recoveryCodes).all())).not.toContain(recoveryCodes[0]);
    expect(hashRecoveryCode(recoveryCodes[0]!.toLowerCase().replaceAll('-', ' '))).toBe(hashRecoveryCode(recoveryCodes[0]!));
    w.store.db.insert(t.passkeys).values({credentialId: 'cred', label: 'MacBook', publicKey: 'pk', transports: [], createdAt: w.store.now().toISOString()}).run();
    w.store.db.update(t.owner).set({authMode: 'password_plus_passkey'}).run();

    const {generation, codes} = await recover(w.store, recoveryCodes[0]!, 'a brand new password', 4);
    expect(generation).toBe(2);
    expect(codes).toHaveLength(8);
    expect(getOwner(w.store)).toMatchObject({authMode: 'password_or_passkey'});
    expect(w.store.db.select().from(t.passkeys).all()).toEqual([]);
    expect(recoveryStatus(w.store)).toEqual({remaining: 8, generated_at: w.store.now().toISOString()});
    // The old codes are gone, the used one included.
    await expect(recover(w.store, recoveryCodes[1]!, 'another new password', 4)).rejects.toMatchObject({code: 'recovery_failed'});
    expect(getOwner(w.store)!.securityGeneration).toBe(2);
  });

  test('generated codes are unique', () => {
    expect(new Set(generateRecoveryCodes(100)).size).toBe(100);
  });
});

describe('passkeys', () => {
  test('the relying party: the public origin, or a loopback origin in development', () => {
    expect(relyingParty('https://setpoint.example.com', 'https://evil.example', true)).toEqual({rpId: 'setpoint.example.com', origin: 'https://setpoint.example.com'});
    expect(relyingParty(null, 'http://127.0.0.1:5194', false)).toEqual({rpId: '127.0.0.1', origin: 'http://127.0.0.1:5194'});
    expect(relyingParty(null, 'http://localhost:7430', false)).toEqual({rpId: 'localhost', origin: 'http://localhost:7430'});
    expect(() => relyingParty(null, 'http://192.168.1.4:7430', false)).toThrow(/SETPOINT_PUBLIC_URL/);
    expect(() => relyingParty(null, 'http://localhost:7430', true)).toThrow(/SETPOINT_PUBLIC_URL/);
    expect(() => relyingParty('http://setpoint.example.com', undefined, true)).toThrow(/https/);
  });

  test('sign-in options carry a challenge stored only as a hash, tied to the pending sign-in', async () => {
    const w = world();
    await claim(w);
    w.store.db.insert(t.passkeys).values({credentialId: 'Y3JlZA', label: 'MacBook', publicKey: 'pk', transports: ['internal'], createdAt: w.store.now().toISOString()}).run();
    const rp = relyingParty(null, 'http://localhost:7430', false);
    const {options, pendingSecret} = await passkeySignInOptions(w.store, rp, null);
    expect(options).toMatchObject({rpId: 'localhost', userVerification: 'required', allowCredentials: [{id: 'Y3JlZA', type: 'public-key', transports: ['internal']}]});
    const [challenge] = w.store.db.select().from(t.webauthnChallenges).all();
    expect(challenge).toMatchObject({hash: hashSecret(options.challenge), purpose: 'sign_in', pendingHash: hashSecret(pendingSecret!), securityGeneration: 1});
    expect(JSON.stringify(challenge)).not.toContain(options.challenge);
  });

  test('strict mode asks for the password first', async () => {
    const w = world();
    await claim(w);
    w.store.db.insert(t.passkeys).values({credentialId: 'cred', label: 'MacBook', publicKey: 'pk', transports: [], createdAt: w.store.now().toISOString()}).run();
    w.store.db.update(t.owner).set({authMode: 'password_plus_passkey'}).run();
    const rp = relyingParty(null, 'http://localhost:7430', false);
    await expect(passkeySignInOptions(w.store, rp, null)).rejects.toMatchObject({code: 'password_first'});
    const pending = startPendingSignIn(w.store, w.store.now().toISOString());
    await expect(passkeySignInOptions(w.store, rp, pending)).resolves.toMatchObject({pendingSecret: null});
  });

  test('a pending sign-in isn\'t made for a generation that moved on while the password was checked', async () => {
    const w = world();
    await claim(w);
    securityTransition(w.store, 1, () => {});
    expect(startPendingSignIn(w.store, w.store.now().toISOString(), 1)).toBeNull();
    expect(w.store.db.select().from(t.pendingSignIns).all()).toEqual([]);
    expect(startPendingSignIn(w.store, null, 2)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('sign-in over HTTP', () => {
  test('claim, use the API, sign out, sign in: the cookie is HttpOnly and SameSite=Strict', async () => {
    const w = world({seed: true});
    const c = client(w);
    expect((await c.send('GET', '/api/auth/status')).body).toEqual({claimed: false, signed_in: false, passkeys: false, auth_mode: 'password_or_passkey'});
    const {token} = issueSetupToken(w.store);
    const claimed = await c.send('POST', '/api/auth/claim', {body: {setup_token: token, password: PASSWORD}});
    expect(claimed.status).toBe(201);
    expect(claimed.body.recovery_codes).toHaveLength(8);
    const setCookie = claimed.headers.getSetCookie().find(line => line.startsWith('setpoint_session='))!;
    expect(setCookie).toMatch(/^setpoint_session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Strict$/);
    expect((await c.send('GET', '/api/mail/counts')).body).toMatchObject({attention: 3, unread: 19});
    expect((await c.send('GET', '/api/me')).body).toMatchObject({method: 'claim', time_zone: 'America/Los_Angeles', recent_password: true});

    expect((await c.send('POST', '/api/auth/sign-out')).status).toBe(204);
    c.cookie = null;
    expect((await c.send('GET', '/api/mail/counts')).status).toBe(401);
    const wrong = await c.send('POST', '/api/auth/sign-in', {body: {password: 'not the password'}});
    expect(wrong).toMatchObject({status: 401, body: {error: {code: 'wrong_password'}}});
    const right = await c.send('POST', '/api/auth/sign-in', {body: {password: PASSWORD}});
    expect(right.body).toEqual({signed_in: true, passkey_required: false});
    expect((await c.send('GET', '/api/mail/counts')).status).toBe(200);
  });

  test('over https the cookie is Secure, with the __Host- prefix', async () => {
    const w = world();
    const c = client(w, {publicUrl: 'https://setpoint.example.com'});
    const {token} = issueSetupToken(w.store);
    const claimed = await c.send('POST', '/api/auth/claim', {body: {setup_token: token, password: PASSWORD}, headers: {origin: 'https://setpoint.example.com'}});
    expect(claimed.headers.getSetCookie().find(line => line.startsWith('__Host-'))).toMatch(/^__Host-setpoint_session=[A-Za-z0-9_-]{43}; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
  });

  test('every route but sign-in needs the session; a forged or ended cookie is refused', async () => {
    const w = world({seed: true});
    const c = client(w);
    for (const [method, url] of [['GET', '/api/me'], ['GET', '/api/mail/inbox'], ['GET', '/api/items?from=2026-10-01&to=2026-11-01'], ['GET', '/api/sources'], ['GET', '/api/settings'], ['GET', '/api/events'], ['POST', '/api/mail/mark-all-read']]) {
      expect((await c.send(method!, url!, method === 'POST' ? {body: {}} : {})).status).toBe(401);
    }
    c.cookie = `setpoint_session=${'A'.repeat(43)}`;
    expect((await c.send('GET', '/api/me')).status).toBe(401);
  });

  test('sign-in and changes must come from Setpoint\'s own page', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const crossSite = {origin: 'https://ha.example.com'};
    expect((await c.send('POST', '/api/mail/mark-all-read', {body: {}, headers: crossSite})).body.error.code).toBe('cross_origin');
    expect((await c.send('GET', '/api/mail/counts', {headers: crossSite})).status).toBe(200);
    expect((await c.send('POST', '/api/auth/sign-in', {body: {password: PASSWORD}, headers: crossSite})).status).toBe(403);
    // A browser that leaves out Origin still says where the request came from.
    const bare = await c.app.request('/api/auth/sign-in', {method: 'POST', headers: {'content-type': 'application/json', 'sec-fetch-site': 'same-origin'}, body: JSON.stringify({password: PASSWORD})});
    expect(bare.status).toBe(200);
    expect(ORIGIN).toBe('http://localhost');
  });

  test('security changes need a recent password, then issue a new session and end the others', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const other = client(w);
    await other.send('POST', '/api/auth/sign-in', {body: {password: PASSWORD}});
    w.advance(11 * 60_000);
    expect((await c.send('POST', '/api/security/recovery-codes')).body.error.code).toBe('password_required');
    expect((await c.send('POST', '/api/security/confirm-password', {body: {password: PASSWORD}})).body.recent_password).toBe(true);
    const codes = await c.send('POST', '/api/security/recovery-codes');
    expect(codes.body.recovery_codes).toHaveLength(8);
    expect((await c.send('GET', '/api/security')).body).toMatchObject({auth_mode: 'password_or_passkey', passkeys: [], recovery: {remaining: 8}});
    expect((await other.send('GET', '/api/me')).status).toBe(401);
    expect((await c.send('PUT', '/api/security/auth-mode', {body: {auth_mode: 'password_plus_passkey'}})).body.error.code).toBe('no_passkey');
    expect((await c.send('PUT', '/api/security/password', {body: {new_password: 'the next long password'}})).status).toBe(204);
    expect((await c.send('GET', '/api/me')).status).toBe(200);
    c.cookie = null;
    expect((await c.send('POST', '/api/auth/sign-in', {body: {password: 'the next long password'}})).body.signed_in).toBe(true);
  });

  test('recovery over HTTP signs in with a recovery session', async () => {
    const w = world();
    const c = client(w);
    const {token} = issueSetupToken(w.store);
    const codes = (await c.send('POST', '/api/auth/claim', {body: {setup_token: token, password: PASSWORD}})).body.recovery_codes as string[];
    c.cookie = null;
    const recovered = await c.send('POST', '/api/auth/recover', {body: {recovery_code: codes[3], new_password: 'recovered password!'}});
    expect(recovered.status).toBe(200);
    expect((await c.send('GET', '/api/me')).body).toMatchObject({method: 'recovery', recent_password: false});
  });

  test('strict mode: the right password asks for the passkey and holds a pending sign-in, not a session', async () => {
    const w = world();
    const c = await signedIn(w);
    w.store.db.insert(t.passkeys).values({credentialId: 'cred', label: 'MacBook', publicKey: 'pk', transports: [], createdAt: w.store.now().toISOString()}).run();
    expect((await c.send('PUT', '/api/security/auth-mode', {body: {auth_mode: 'password_plus_passkey'}})).status).toBe(204);
    c.cookie = null;
    const response = await c.send('POST', '/api/auth/sign-in', {body: {password: PASSWORD}});
    expect(response.body).toEqual({signed_in: false, passkey_required: true});
    expect(response.headers.getSetCookie().find(line => line.startsWith('setpoint_pending='))).toMatch(/HttpOnly; SameSite=Strict$/);
    expect(c.cookie).toBeNull();
    // A made-up passkey response fails and signs nothing in.
    const pending = response.headers.getSetCookie().find(line => line.startsWith('setpoint_pending='))!.split(';')[0]!;
    const verify = await c.send('POST', '/api/auth/passkey/verify', {body: {response: {id: 'cred', rawId: 'cred', type: 'public-key', response: {}}}, headers: {cookie: pending}});
    expect(verify).toMatchObject({status: 401, body: {error: {code: 'passkey_failed'}}});
  });
});
