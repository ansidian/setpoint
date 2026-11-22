// Settings › Security's routes: the password, sign-in mode, recovery codes, passkeys, Add iPhone and
// paired devices. A browser's only: a paired iPhone's token can't read or change them. Mounted under
// /api behind the session (app.ts).
import {authModeInput, changePasswordInput, confirmPasswordInput, passkeyLabelInput, registerPasskeyInput} from '@setpoint/shared';
import type {PairingOut, RecoveryCodesOut, SecurityOut} from '@setpoint/shared';
import {Hono} from 'hono';
import type {Context, Next} from 'hono';
import {z} from 'zod';
import {changePassword, passwordMatches, recoveryStatus, regenerateRecoveryCodes, requireOwner, reservePasswordAttempt, setAuthMode} from '../auth/owner.ts';
import {deletePasskey, listPasskeys, passkeyRegistrationOptions, registerPasskey, relyingParty} from '../auth/passkeys.ts';
import {issuePairingCode, listDevices, revokeDevice, withdrawPairingCode} from '../auth/devices.ts';
import {createSession, hasRecentPassword, markPasswordGiven} from '../auth/sessions.ts';
import {conflict, forbidden, invalid, parse, unauthorized} from '../errors.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {cookieNames, setSessionCookie} from './auth.ts';
import type {Env} from './app.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

export interface SecurityApiOptions {
  cookies: ReturnType<typeof cookieNames>;
  origin: (c: Context) => string;
  rp: (c: Context) => ReturnType<typeof relyingParty>;
  bcryptCost: number;
}

export function securityApi(store: Store, {cookies, origin, rp, bcryptCost}: SecurityApiOptions) {
  const api = new Hono<Env>();

  // ---- Settings › Security ----

  /** Settings › Security is the browser's: a paired iPhone's token can't read or change it. */
  const browserSession = (c: Context<Env>) => {
    const session = c.get('session');
    if (!session) throw forbidden('Security settings are changed from a browser.', 'browser_only');
    return session;
  };
  // Before any route's own work, so a device spends no password attempt either.
  const browserOnly = async (c: Context<Env>, next: Next) => {
    browserSession(c);
    await next();
  };
  api.use('/security', browserOnly);
  api.use('/security/*', browserOnly);
  /** Security changes need the password in the last 10 minutes, and a new session afterwards. */
  const recentPassword = (c: Context<Env>) => {
    const session = browserSession(c);
    if (!hasRecentPassword(store, session)) throw forbidden('Confirm your password first.', 'password_required');
    return session;
  };
  const afterChange = (c: Context<Env>, generation: number | null, passwordAt: string | null) => {
    if (generation === null) throw conflict('security_changed', 'Security settings changed; sign in again.');
    const secret = createSession(store, {generation, method: browserSession(c).method, passwordAt});
    if (!secret) throw conflict('security_changed', 'Security settings changed; sign in again.');
    setSessionCookie(c, cookies, secret);
  };
  const security = (c: Context<Env>): SecurityOut => ({
    auth_mode: requireOwner(store).authMode, passkeys: listPasskeys(store), devices: listDevices(store), recovery: recoveryStatus(store),
    recent_password: hasRecentPassword(store, browserSession(c)),
  });

  api.get('/security', c => c.json(security(c)));
  api.post('/security/confirm-password', async c => {
    const input = parse(confirmPasswordInput, await body(c));
    reservePasswordAttempt(store);
    if (!await passwordMatches(requireOwner(store), input.password)) throw unauthorized('Wrong password.', 'wrong_password');
    markPasswordGiven(store, browserSession(c).id);
    return c.json({...security(c), recent_password: true});
  });
  api.put('/security/password', async c => {
    const input = parse(changePasswordInput, await body(c));
    const session = recentPassword(c);
    afterChange(c, await changePassword(store, session.securityGeneration, input.new_password, bcryptCost), isoNow(store));
    return c.body(null, 204);
  });
  api.put('/security/auth-mode', async c => {
    const input = parse(authModeInput, await body(c));
    const session = recentPassword(c);
    afterChange(c, setAuthMode(store, session.securityGeneration, input.auth_mode), session.passwordAt);
    return c.body(null, 204);
  });
  api.post('/security/recovery-codes', c => {
    const session = recentPassword(c);
    const {generation, codes} = regenerateRecoveryCodes(store, session.securityGeneration);
    afterChange(c, generation, session.passwordAt);
    return c.json({recovery_codes: codes} satisfies RecoveryCodesOut);
  });
  api.post('/security/passkeys/options', async c => {
    parse(passkeyLabelInput, await body(c));
    return c.json(await passkeyRegistrationOptions(store, rp(c), recentPassword(c)));
  });
  api.post('/security/passkeys', async c => {
    const input = parse(registerPasskeyInput, await body(c));
    const session = recentPassword(c);
    afterChange(c, await registerPasskey(store, rp(c), session, input.label, input.response), session.passwordAt);
    return c.json(listPasskeys(store), 201);
  });
  api.delete('/security/passkeys/:id', c => {
    const session = recentPassword(c);
    afterChange(c, deletePasskey(store, session.securityGeneration, id(c.req.param('id'))), session.passwordAt);
    return c.body(null, 204);
  });
  // Add iPhone mints a token that never idles out, so it needs the recent password. Withdrawing the
  // code and Revoke only take access away, so they don't. None of them is a security
  // transition: sessions carry on.
  api.post('/security/pairing', c => {
    recentPassword(c);
    return c.json(issuePairingCode(store, origin(c)) satisfies PairingOut, 201);
  });
  api.delete('/security/pairing', c => {
    browserSession(c);
    withdrawPairingCode(store);
    return c.body(null, 204);
  });
  api.delete('/security/devices/:id', c => {
    browserSession(c);
    revokeDevice(store, id(c.req.param('id')));
    return c.body(null, 204);
  });

  return api;
}
