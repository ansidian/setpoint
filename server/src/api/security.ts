// Settings › Security's routes: the password, sign-in mode, recovery codes and passkeys. Mounted
// under /api behind the session (app.ts).
import {authModeInput, changePasswordInput, confirmPasswordInput, passkeyLabelInput, registerPasskeyInput} from '@setpoint/shared';
import type {RecoveryCodesOut, SecurityOut} from '@setpoint/shared';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {changePassword, passwordMatches, recoveryStatus, regenerateRecoveryCodes, requireOwner, reservePasswordAttempt, setAuthMode} from '../auth/owner.ts';
import {deletePasskey, listPasskeys, passkeyRegistrationOptions, registerPasskey, relyingParty} from '../auth/passkeys.ts';
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
  rp: (c: Context) => ReturnType<typeof relyingParty>;
  bcryptCost: number;
}

export function securityApi(store: Store, {cookies, rp, bcryptCost}: SecurityApiOptions) {
  const api = new Hono<Env>();

  // ---- Settings › Security ----

  /** Security changes need the password in the last 10 minutes, and a new session afterwards. */
  const recentPassword = (c: Context<Env>) => {
    const session = c.get('session');
    if (!hasRecentPassword(store, session)) throw forbidden('Confirm your password first.', 'password_required');
    return session;
  };
  const afterChange = (c: Context<Env>, generation: number | null, passwordAt: string | null) => {
    if (generation === null) throw conflict('security_changed', 'Security settings changed; sign in again.');
    const secret = createSession(store, {generation, method: c.get('session').method, passwordAt});
    if (!secret) throw conflict('security_changed', 'Security settings changed; sign in again.');
    setSessionCookie(c, cookies, secret);
  };
  const security = (c: Context<Env>): SecurityOut => ({
    auth_mode: requireOwner(store).authMode, passkeys: listPasskeys(store), recovery: recoveryStatus(store),
    recent_password: hasRecentPassword(store, c.get('session')),
  });

  api.get('/security', c => c.json(security(c)));
  api.post('/security/confirm-password', async c => {
    const input = parse(confirmPasswordInput, await body(c));
    reservePasswordAttempt(store);
    if (!await passwordMatches(requireOwner(store), input.password)) throw unauthorized('Wrong password.', 'wrong_password');
    markPasswordGiven(store, c.get('session').id);
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
  return api;
}
