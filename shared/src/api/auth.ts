// Sign-in and Settings › Security. A single owner signs in with a password (bcrypt) and/or passkeys;
// the browser keeps an HttpOnly, SameSite=Strict session cookie (Secure over https) whose secret is
// stored only as a hash. The first claim needs a setup token from the CLI (`npm run cli --
// setup-token`).
import {z} from 'zod';
import {AUTH_MODES, SESSION_METHODS} from '../enums.ts';
import type {AuthMode, SessionMethod} from '../enums.ts';

/** New passwords: at least 12 characters (v1's policy); any password checked is at most 1,024. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 1024;
const newPassword = z.string().min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`).max(MAX_PASSWORD_LENGTH);
const password = z.string().min(1).max(MAX_PASSWORD_LENGTH);

/** GET /api/auth/status: what the sign-in card offers. Needs no session. */
export interface AuthStatusOut {
  claimed: boolean;
  signed_in: boolean;
  // A passkey is registered, so the card offers "Sign in with a passkey".
  passkeys: boolean;
  auth_mode: AuthMode;
}

/** POST /api/auth/claim: the first sign-in, with the CLI's setup token. */
export const claimInput = z.strictObject({setup_token: z.string().min(1).max(200), password: newPassword});
/** The recovery codes are shown once, here and after regenerating or recovering. */
export interface RecoveryCodesOut {
  recovery_codes: string[];
}

/** POST /api/auth/sign-in. In strict mode a correct password asks for the passkey next. */
export const signInInput = z.strictObject({password});
export interface SignInOut {
  signed_in: boolean;
  passkey_required: boolean;
}

/** POST /api/auth/passkey/options returns WebAuthn's request options as JSON; verify takes the response. */
export type WebAuthnOptionsOut = Record<string, unknown>;
export const passkeyResponseInput = z.strictObject({response: z.record(z.string(), z.unknown())});

/** POST /api/auth/recover: a recovery code and a new password; passkeys are cleared. */
export const recoverInput = z.strictObject({recovery_code: z.string().min(1).max(200), new_password: newPassword});

/** GET /api/me. A paired iPhone's bearer token reads as `device`. */
export interface MeOut {
  method: SessionMethod | 'device';
  time_zone: string;
  // The server's clock: the dev server runs from the seed's moment (SEED_NOW), so ages match the brief.
  now: string;
  // Security changes need the password confirmed in the last 10 minutes.
  recent_password: boolean;
}

/** Settings › Security. */
export interface PasskeyOut {
  id: number;
  label: string;
  created_at: string;
  last_used_at: string | null;
  backed_up: boolean | null;
}
/** A paired iPhone, signed in with its device token. */
export interface DeviceOut {
  id: number;
  name: string;
  paired_at: string;
  last_used_at: string | null;
}
export interface SecurityOut {
  auth_mode: AuthMode;
  passkeys: PasskeyOut[];
  devices: DeviceOut[];
  recovery: {remaining: number; generated_at: string | null};
  recent_password: boolean;
}
export const confirmPasswordInput = z.strictObject({password});
export const changePasswordInput = z.strictObject({new_password: newPassword});
export const authModeInput = z.strictObject({auth_mode: z.enum(AUTH_MODES)});
export const passkeyLabelInput = z.strictObject({label: z.string().trim().min(1).max(80)});
export const registerPasskeyInput = z.strictObject({label: z.string().trim().min(1).max(80), response: z.record(z.string(), z.unknown())});
export const sessionMethodSchema = z.enum(SESSION_METHODS);

/**
 * POST /api/security/pairing (Add iPhone; the password confirmed in the last 10 minutes): a
 * one-time code for five minutes, replacing any earlier one. The QR holds `link`,
 * `setpoint://pair?server=…&code=…`. DELETE /api/security/pairing withdraws it.
 */
export interface PairingOut {
  server: string;
  code: string;
  link: string;
  expires_at: string;
}

/**
 * POST /api/auth/pair, from the iPhone app, needing no session: the code for a device token, sent
 * from then on as `Authorization: Bearer <token>`. It has no idle timeout; it ends when revoked in
 * Settings › Security, by the app's DELETE /api/device, or at recovery, and then every request is
 * 401. `name` is the phone's model ("iPhone 17 Pro"); "iPhone" when left out.
 */
export const DEVICE_NAME_MAX = 80;
export const pairInput = z.strictObject({code: z.string().min(1).max(200), name: z.string().trim().max(DEVICE_NAME_MAX).optional()});
export interface PairOut {
  token: string;
  device: DeviceOut;
}
