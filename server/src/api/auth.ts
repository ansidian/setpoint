// The session cookie and the checks around it (darma's api/auth.ts, adapted to one owner and no
// agent tokens). The cookie is HttpOnly and SameSite=Strict always, and Secure with the `__Host-`
// prefix whenever Setpoint's origin is https; over plain http in development it can't be Secure,
// or the browser wouldn't send it back.
import type {Context} from 'hono';
import {deleteCookie, getCookie, setCookie} from 'hono/cookie';
import {CHALLENGE_MS} from '../auth/passkeys.ts';
import {SESSION_DAYS} from '../auth/sessions.ts';

export interface Cookies {
  session: string;
  pending: string;
  secure: boolean;
}

export function cookieNames(secure: boolean): Cookies {
  return secure
    ? {session: '__Host-setpoint_session', pending: '__Host-setpoint_pending', secure}
    : {session: 'setpoint_session', pending: 'setpoint_pending', secure};
}

const options = (secure: boolean, maxAge: number) => ({httpOnly: true, secure, sameSite: 'Strict' as const, path: '/', maxAge});

export function setSessionCookie(c: Context, cookies: Cookies, secret: string) {
  setCookie(c, cookies.session, secret, options(cookies.secure, SESSION_DAYS * 24 * 60 * 60));
}

export function setPendingCookie(c: Context, cookies: Cookies, secret: string) {
  setCookie(c, cookies.pending, secret, options(cookies.secure, CHALLENGE_MS / 1000));
}

export function clearCookie(c: Context, cookies: Cookies, which: 'session' | 'pending') {
  deleteCookie(c, cookies[which], {path: '/', secure: cookies.secure});
}

export const readCookie = (c: Context, name: string): string | null => getCookie(c, name) ?? null;

/**
 * Whether a request comes from Setpoint's own page: its Origin is Setpoint's, or, from a browser
 * that leaves Origin out, Sec-Fetch-Site says same-origin. Other names on the same site would
 * otherwise pass SameSite (darma's rule), so every session request that changes anything, and every
 * sign-in, must pass this.
 */
export function fromOwnPage(c: Context, origin: string): boolean {
  const sent = c.req.header('origin');
  return sent ? sent === origin : c.req.header('sec-fetch-site') === 'same-origin';
}
