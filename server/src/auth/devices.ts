// Paired iPhones (SV-84, D276). The phone reaches Setpoint only over a private network, where native
// passkeys can't work, so a signed-in browser pairs it: Settings › Security shows a one-time code
// (five minutes, one at a time) in a QR code and a setpoint://pair link, and the app exchanges it at
// POST /api/auth/pair for a device token it sends as a bearer header. Codes and tokens are 256
// random bits kept only as SHA-256, as sessions are. A token has no idle timeout and outlives
// security changes; it ends when revoked, or at recovery (owner.ts).
import type {DeviceOut, PairingOut} from '@setpoint/shared';
import {desc, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {unauthorized} from '../errors.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {requireOwner} from './owner.ts';
import {hashSecret, newSecret} from './sessions.ts';

export const PAIRING_MINUTES = 5;
const TOKEN_PREFIX = 'sp_device_';
const TOKEN_PATTERN = /^sp_device_[A-Za-z0-9_-]{43}$/;
// Use is recorded at most once a minute, as sessions' is.
const USE_MS = 60_000;

export type Device = typeof t.devices.$inferSelect;

/** The QR's link: what the app opens, by camera or `xcrun simctl openurl`. */
export const pairingLink = (server: string, code: string) =>
  `setpoint://pair?${new URLSearchParams({server, code}).toString()}`;

/** A new pairing code, replacing (withdrawing) any earlier one. Returned once; only its hash is kept. */
export function issuePairingCode(store: Store, server: string, minutes = PAIRING_MINUTES): PairingOut {
  requireOwner(store);
  const code = newSecret();
  const now = store.now();
  const expiresAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  transaction(store, () => {
    store.db.delete(t.pairingCodes).run();
    store.db.insert(t.pairingCodes).values({hash: hashSecret(code), createdAt: now.toISOString(), expiresAt}).run();
  });
  return {server, code, link: pairingLink(server, code), expires_at: expiresAt};
}

/** Add iPhone's Cancel: the live code stops working. */
export function withdrawPairingCode(store: Store) {
  store.db.delete(t.pairingCodes).run();
}

/**
 * Spends a live code on a new device and returns its token, once. A wrong, spent or expired code
 * changes nothing and is refused alike.
 */
export function pairDevice(store: Store, code: string, name: string | undefined): {token: string; device: DeviceOut} {
  return transaction(store, () => {
    const spent = store.db.delete(t.pairingCodes)
      .where(eq(t.pairingCodes.hash, hashSecret(code))).returning().get();
    if (!spent || Date.parse(spent.expiresAt) <= store.now().getTime()) {
      throw unauthorized('That pairing code isn\'t valid any more. Add iPhone again in Settings › Security.', 'bad_pairing_code');
    }
    const token = `${TOKEN_PREFIX}${newSecret()}`;
    const row = store.db.insert(t.devices).values({hash: hashSecret(token), name: name?.trim() || 'iPhone', createdAt: isoNow(store)}).returning().get();
    return {token, device: present(row)};
  });
}

/** The device behind an Authorization header's bearer token, or null; each use is recorded. */
export function findDevice(store: Store, token: string, extend = true): Device | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const device = store.db.select().from(t.devices).where(eq(t.devices.hash, hashSecret(token))).get();
  if (!device) return null;
  const now = store.now();
  if (extend && (!device.lastUsedAt || now.getTime() - Date.parse(device.lastUsedAt) > USE_MS)) {
    store.db.update(t.devices).set({lastUsedAt: now.toISOString()}).where(eq(t.devices.id, device.id)).run();
  }
  return device;
}

/** The bearer token in an Authorization header, or null when it has none. */
export function bearerToken(authorization: string | undefined): string | null {
  return /^Bearer[ \t]+(\S{1,512})[ \t]*$/i.exec(authorization ?? '')?.[1] ?? null;
}

const present = (row: Device): DeviceOut => ({id: row.id, name: row.name, paired_at: row.createdAt, last_used_at: row.lastUsedAt});

/** Settings › Security's list, the newest first. */
export const listDevices = (store: Store): DeviceOut[] =>
  store.db.select().from(t.devices).orderBy(desc(t.devices.createdAt), desc(t.devices.id)).all().map(present);

/** Revoke: the token stops working at once. An unknown device is fine. */
export function revokeDevice(store: Store, id: number) {
  store.db.delete(t.devices).where(eq(t.devices.id, id)).run();
}
