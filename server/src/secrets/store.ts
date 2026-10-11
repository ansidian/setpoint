// Credentials and instance secrets, encrypted at rest and write-only through the API: nothing here
// returns a value to a caller outside the server (adapters and notify() read them in process).
import {credentialsInput, SECRET_NAMES} from '@setpoint/shared';
import type {Credentials, SecretName, SecretOut} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conflict, notFound, SetpointError} from '../errors.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {decryptSecret, encryptSecret} from './crypto.ts';
import type {Keyring} from './crypto.ts';

function keyring(store: Store): Keyring {
  if (!store.keyring) throw new SetpointError('no_key', 'Setpoint has no encryption key; set SETPOINT_KEY_FILE.', 503);
  return store.keyring;
}

const sourceContext = (sourceId: number) => ({table: 'sources', field: 'credentials', recordId: String(sourceId)});
const secretContext = (name: SecretName) => ({table: 'secrets', field: 'ciphertext', recordId: name});

/**
 * Stores new credentials for a source (a connection or a reconnect), which clears needs-reconnect.
 * A dev source never takes credentials: the dev provider is never attached to a real account.
 */
export function writeSourceCredentials(store: Store, sourceId: number, credentials: Credentials) {
  const ciphertext = encryptSecret(keyring(store), JSON.stringify(credentials), sourceContext(sourceId));
  transaction(store, () => {
    const source = store.db.select().from(t.sources).where(eq(t.sources.id, sourceId)).get();
    if (!source) throw notFound('No such source.');
    if (source.dev) throw conflict('dev_source', 'This is a seeded dev source; it never takes real credentials.');
    store.db.update(t.sources).set({credentials: ciphertext, needsReconnectAt: null}).where(eq(t.sources.id, sourceId)).run();
  });
}

/** A source's credentials, for its adapter; null when it has none. */
export function readSourceCredentials(store: Store, sourceId: number): Credentials | null {
  const source = store.db.select({credentials: t.sources.credentials}).from(t.sources).where(eq(t.sources.id, sourceId)).get();
  if (!source?.credentials) return null;
  return credentialsInput.parse(JSON.parse(decryptSecret(keyring(store), source.credentials, sourceContext(sourceId))));
}

export function setSecret(store: Store, name: SecretName, value: string) {
  const ciphertext = encryptSecret(keyring(store), value, secretContext(name));
  const updatedAt = isoNow(store);
  store.db.insert(t.secrets).values({name, ciphertext, updatedAt}).onConflictDoUpdate({target: t.secrets.name, set: {ciphertext, updatedAt}}).run();
}

export function readSecret(store: Store, name: SecretName): string | null {
  const row = store.db.select().from(t.secrets).where(eq(t.secrets.name, name)).get();
  return row ? decryptSecret(keyring(store), row.ciphertext, secretContext(name)) : null;
}

export function deleteSecret(store: Store, name: SecretName) {
  store.db.delete(t.secrets).where(eq(t.secrets.name, name)).run();
}

export function listSecrets(store: Store): SecretOut[] {
  const rows = new Map(store.db.select().from(t.secrets).all().map(row => [row.name, row]));
  return SECRET_NAMES.map(name => ({name, set: rows.has(name), updated_at: rows.get(name)?.updatedAt ?? null}));
}
