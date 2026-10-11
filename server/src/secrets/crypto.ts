// Credentials at rest: AES-256-GCM with a fresh v2 format and key (BUILD-PLAN.md › B1 › Secrets),
// adapted from v1's credential encryption (server/platform/encryption.ts; harvest notes on SV-2).
//
//   sp2:<key id>:<iv>:<ciphertext>:<tag>       base64url parts; the key id is 8 hex characters
//
// Kept from v1: a 256-bit key given as 64 hex characters or base64; a fresh 96-bit IV per value;
// additional authenticated data binding each value to where it's stored (table, field, record), so
// a ciphertext copied to another row or field won't decrypt; one error for anything that doesn't
// decrypt, without saying why. New in v2: the key's id in each value, so a value written under
// another key says so instead of failing as "tampered". v1's `gcm:` values aren't read here: B7's
// export decrypts them with v1's own code and v2 re-encrypts them.
import {createCipheriv, createDecipheriv, createHash, randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = 'sp2';
const INVALID_KEY = 'The key must be 256 bits: 64 hex characters or base64.';
const UNREADABLE = 'This credential is invalid or can\'t be decrypted.';

export interface Keyring {
  id: string;
  key: Buffer;
}

/** Where a value is stored; it's bound into the ciphertext. */
export interface SecretContext {
  table: string;
  field: string;
  recordId: string;
}

export function parseKey(value: string): Buffer {
  const text = value.trim();
  if (/^[a-fA-F0-9]{64}$/.test(text)) return Buffer.from(text, 'hex');
  if (/^[A-Za-z0-9+/]{43}=?$/.test(text) || /^[A-Za-z0-9_-]{43}$/.test(text)) {
    const key = Buffer.from(text, text.includes('-') || text.includes('_') ? 'base64url' : 'base64');
    if (key.length === 32) return key;
  }
  throw new Error(INVALID_KEY);
}

export function keyringFrom(value: string): Keyring {
  const key = parseKey(value);
  return {id: createHash('sha256').update(key).digest('hex').slice(0, 8), key};
}

const aad = (context: SecretContext) => Buffer.from(JSON.stringify(['setpoint', 2, context.table, context.field, context.recordId]), 'utf8');

export function encryptSecret(keyring: Keyring, plaintext: string, context: SecretContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyring.key, iv);
  cipher.setAAD(aad(context));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [PREFIX, keyring.id, iv.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join(':');
}

export function decryptSecret(keyring: Keyring, ciphertext: string, context: SecretContext): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || parts[0] !== PREFIX) throw new Error(UNREADABLE);
  const [, keyId, iv, body, tag] = parts as [string, string, string, string, string];
  if (keyId !== keyring.id) throw new Error(`This credential was encrypted with another key (${keyId}); Setpoint's key is ${keyring.id}.`);
  if (!/^[A-Za-z0-9_-]{16}$/.test(iv) || !/^[A-Za-z0-9_-]*$/.test(body) || !/^[A-Za-z0-9_-]{22}$/.test(tag)) throw new Error(UNREADABLE);
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyring.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(UNREADABLE);
  }
}

/**
 * The key, from SETPOINT_KEY (the value) or SETPOINT_KEY_FILE (a file holding it). Outside
 * production with neither, a key is made once in the data folder (`setpoint.key`, mode 600), so
 * `npm run dev` works with no setup; in production one must be given, so the key never sits beside
 * the database in its backups by accident.
 */
export function loadKeyring(env: NodeJS.ProcessEnv, dataDir: string): {keyring: Keyring; from: string} {
  if (env.SETPOINT_KEY?.trim()) return {keyring: keyringFrom(env.SETPOINT_KEY), from: 'SETPOINT_KEY'};
  if (env.SETPOINT_KEY_FILE?.trim()) {
    const file = path.resolve(env.SETPOINT_KEY_FILE);
    return {keyring: keyringFrom(fs.readFileSync(file, 'utf8')), from: file};
  }
  if (env.NODE_ENV === 'production') throw new Error('Set SETPOINT_KEY_FILE (or SETPOINT_KEY) to the 256-bit key that encrypts credentials.');
  const file = path.join(dataDir, 'setpoint.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, {recursive: true});
    fs.writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, {mode: 0o600, flag: 'wx'});
  }
  return {keyring: keyringFrom(fs.readFileSync(file, 'utf8')), from: file};
}
