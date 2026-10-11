// Credentials at rest (adapted from v1's encryption tests): AES-256-GCM in the v2 format, bound to
// where each value is stored, and write-only through the API.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, onTestFinished, test} from 'vitest';
import {decryptSecret, encryptSecret, keyringFrom, loadKeyring, parseKey} from '../src/secrets/crypto.ts';
import {readSecret, readSourceCredentials, setSecret, writeSourceCredentials} from '../src/secrets/store.ts';
import * as t from '../src/db/schema.ts';
import {signedIn, TEST_KEY, world} from './helpers.ts';

const keyring = keyringFrom(TEST_KEY);
const CONTEXT = {table: 'sources', field: 'credentials', recordId: '3'};

describe('the key', () => {
  test('256 bits as 64 hex characters, base64 or base64url', () => {
    const bytes = Buffer.from(TEST_KEY, 'hex');
    for (const form of [TEST_KEY, bytes.toString('base64'), bytes.toString('base64url'), `${TEST_KEY}\n`]) expect(parseKey(form)).toEqual(bytes);
  });

  test.each(['not-a-key', Buffer.alloc(31).toString('base64'), TEST_KEY.slice(2), ''])('refuses %j', value => {
    expect(() => parseKey(value)).toThrow('The key must be 256 bits');
  });

  test('its id is the start of its hash, not the key', () => {
    expect(keyring.id).toMatch(/^[0-9a-f]{8}$/);
    expect(TEST_KEY).not.toContain(keyring.id);
  });

  test('from SETPOINT_KEY, SETPOINT_KEY_FILE, or made once in the data folder outside production', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-key-'));
    onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
    expect(loadKeyring({SETPOINT_KEY: TEST_KEY}, dir).keyring.id).toBe(keyring.id);
    fs.writeFileSync(path.join(dir, 'given.key'), TEST_KEY);
    expect(loadKeyring({SETPOINT_KEY_FILE: path.join(dir, 'given.key')}, dir).keyring.id).toBe(keyring.id);
    const made = loadKeyring({}, dir);
    expect(made.from).toBe(path.join(dir, 'setpoint.key'));
    expect(fs.statSync(made.from).mode & 0o777).toBe(0o600);
    expect(loadKeyring({}, dir).keyring.id).toBe(made.keyring.id);
    expect(() => loadKeyring({NODE_ENV: 'production'}, dir)).toThrow(/SETPOINT_KEY_FILE/);
  });
});

describe('encryptSecret and decryptSecret', () => {
  test('round trip, empty included, in the sp2 format with a fresh IV each time', () => {
    for (const value of ['abcd-efgh-ijkl-mnop', '', '{"kind":"oauth"}', 'ünïcødé 🔑']) {
      const sealed = encryptSecret(keyring, value, CONTEXT);
      expect(sealed).toMatch(new RegExp(`^sp2:${keyring.id}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]*:[A-Za-z0-9_-]{22}$`));
      expect(decryptSecret(keyring, sealed, CONTEXT)).toBe(value);
    }
    expect(encryptSecret(keyring, 'same', CONTEXT)).not.toBe(encryptSecret(keyring, 'same', CONTEXT));
  });

  test('bound to its table, field and record: moved anywhere else, it won\'t decrypt', () => {
    const sealed = encryptSecret(keyring, 'secret', CONTEXT);
    for (const elsewhere of [{...CONTEXT, recordId: '4'}, {...CONTEXT, field: 'other'}, {...CONTEXT, table: 'secrets'}]) {
      expect(() => decryptSecret(keyring, sealed, elsewhere)).toThrow('This credential is invalid or can\'t be decrypted.');
    }
  });

  test('tampering with any part fails, saying only that it can\'t be decrypted', () => {
    const sealed = encryptSecret(keyring, 'sensitive', CONTEXT);
    const parts = sealed.split(':');
    for (const index of [2, 3, 4]) {
      const tampered = [...parts];
      const chars = tampered[index]!.split('');
      chars[0] = chars[0] === 'A' ? 'B' : 'A';
      tampered[index] = chars.join('');
      expect(() => decryptSecret(keyring, tampered.join(':'), CONTEXT)).toThrow('This credential is invalid or can\'t be decrypted.');
    }
    for (const broken of ['gcm:v2:aa:bb:cc', sealed.replace(/^sp2/, 'sp3'), `${sealed}:extra`, 'plain text']) {
      expect(() => decryptSecret(keyring, broken, CONTEXT)).toThrow('This credential is invalid or can\'t be decrypted.');
    }
  });

  test('a value sealed under another key says so', () => {
    const other = keyringFrom('f'.repeat(64));
    expect(() => decryptSecret(other, encryptSecret(keyring, 'x', CONTEXT), CONTEXT)).toThrow(`encrypted with another key (${keyring.id})`);
  });
});

describe('write-only credentials and secrets', () => {
  test('stored encrypted, read back only in process', () => {
    const w = world();
    const source = w.store.db.insert(t.sources).values({provider: 'todoist', syncMode: 'poll', intervalSeconds: 300, createdAt: w.store.now().toISOString()}).returning().get();
    writeSourceCredentials(w.store, source.id, {kind: 'oauth', refresh_token: 'refresh-me', access_token: null, expires_at: null, scope: 'data:read_write'});
    const stored = w.store.db.select().from(t.sources).get()!.credentials!;
    expect(stored).not.toContain('refresh-me');
    expect(readSourceCredentials(w.store, source.id)).toMatchObject({kind: 'oauth', refresh_token: 'refresh-me'});
    setSecret(w.store, 'anthropic_api_key', 'sk-ant-fake');
    expect(JSON.stringify(w.store.db.select().from(t.secrets).all())).not.toContain('sk-ant-fake');
    expect(readSecret(w.store, 'anthropic_api_key')).toBe('sk-ant-fake');
  });

  test('the API takes them and never gives them back', async () => {
    const w = world({seed: true});
    w.store.db.update(t.sources).set({dev: false}).run();
    const c = await signedIn(w);
    expect((await c.send('PUT', '/api/sources/5/credentials', {body: {kind: 'app_password', username: 'user@example.net', password: 'abcd-efgh-ijkl-mnop'}})).status).toBe(204);
    expect((await c.send('PUT', '/api/secrets/openai_api_key', {body: {value: 'sk-fake-openai'}})).status).toBe(204);
    const everything = JSON.stringify([
      (await c.send('GET', '/api/sources')).body, (await c.send('GET', '/api/accounts')).body, (await c.send('GET', '/api/secrets')).body, (await c.send('GET', '/api/settings')).body,
    ]);
    expect(everything).not.toContain('abcd-efgh-ijkl-mnop');
    expect(everything).not.toContain('sk-fake-openai');
    expect(everything).not.toContain('sp2:');
    const sources = (await c.send('GET', '/api/sources')).body as {id: number; has_credentials: boolean}[];
    expect(sources.find(source => source.id === 5)!.has_credentials).toBe(true);
    expect((await c.send('GET', '/api/secrets')).body).toContainEqual({name: 'openai_api_key', set: true, updated_at: expect.any(String)});
    expect((await c.send('PUT', '/api/secrets/github_token', {body: {value: 'x'}})).status).toBe(400);
  });
});
