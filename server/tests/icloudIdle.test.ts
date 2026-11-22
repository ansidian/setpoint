// iCloud's IDLE watcher against the fake IMAP server: after a poll, a second session sits in IDLE
// on INBOX, and new mail or a message moved away elsewhere wakes a sync at once, ahead of the next
// 2-minute poll. A read elsewhere is left to the poll. A revoked password ends the watcher, the next
// poll with a new one starts it again, and closing the adapter leaves no session open.
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, onTestFinished, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {ICloudAdapter, icloudConnector} from '../src/providers/icloud/index.ts';
import {writeSourceCredentials} from '../src/secrets/store.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeImap} from './fakeImap.ts';
import {signedIn, world} from './helpers.ts';
import {rawEmail} from './rawEmail.ts';

const ADDRESS = 'user@icloud.example.com';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();

async function setup({pushes = true, before}: {pushes?: boolean; before?: (imap: Awaited<ReturnType<typeof fakeImap>>) => void} = {}) {
  const w = world();
  const imap = await fakeImap();
  imap.addUser(ADDRESS, PASSWORD);
  before?.(imap);
  const changes: number[] = [];
  // As server.ts wires it: a change wakes the source's sync (or, to watch the calls alone, only records it).
  let engine: SyncEngine | null = null;
  const adapter = new ICloudAdapter({endpoint: {host: imap.host, port: imap.port, secure: false}, connectTimeoutMs: 2000, onChange: sourceId => {
    changes.push(sourceId);
    if (pushes) engine!.pushed(sourceId);
  }});
  onTestFinished(() => adapter.close());
  engine = new SyncEngine({store: w.store, adapters: new Adapters({icloud: adapter}), timeoutMs: 3000});
  const api = await signedIn(w, {engine, connectors: {icloud: icloudConnector(w.store, adapter)}});
  const drain = async () => {
    for (let round = 0; round < 30; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length) return;
    }
    throw new Error('The engine never went idle.');
  };
  expect((await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}})).status).toBe(201);
  await drain();
  const source = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'icloud')).get()!;
  if (!before) await vi.waitFor(() => expect(imap.idling).toBe(1));
  return {w, imap, adapter, engine, source, changes, drain};
}

const deliver = (imap: Awaited<ReturnType<typeof fakeImap>>, subject: string) =>
  imap.deliver(ADDRESS, rawEmail({from: 'Sam Ortiz <sam.ortiz@example.org>', to: ADDRESS, subject, date: ago(MINUTE), text: `${subject}.`}), ago(MINUTE));

const pollsDue = (w: ReturnType<typeof world>) => w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all();

describe('iCloud: IDLE wakes a sync', () => {
  test('new mail calls onChange with the source, before any second poll', async () => {
    const {imap, source, changes, w} = await setup({pushes: false});
    expect(changes).toEqual([]);
    deliver(imap, 'Flights');
    await vi.waitFor(() => expect(changes).toEqual([source.id]));
    expect(pollsDue(w)).toEqual([]);
  });

  test('through the engine, the pushed sync has the message in the store with no poll due', async () => {
    const {imap, w, engine, changes} = await setup();
    deliver(imap, 'Flights');
    await vi.waitFor(() => expect(changes).toHaveLength(1));
    await engine.tick();
    await engine.settled();
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Flights')).get()).toBeDefined();
  });

  test('a move to Archive elsewhere calls onChange; a read elsewhere doesn\'t', async () => {
    const {imap, source, changes, drain, w} = await setup({pushes: false});
    const seen = deliver(imap, 'Seen');
    const moved = deliver(imap, 'Moved');
    await vi.waitFor(() => expect(changes).toHaveLength(2));
    w.advance(2 * MINUTE);
    await drain();
    await vi.waitFor(() => expect(imap.idling).toBe(1));
    changes.length = 0;
    imap.setSeen(ADDRESS, seen, true);
    imap.move(ADDRESS, moved, 'Archive');
    await vi.waitFor(() => expect(changes).toEqual([source.id]));
  });

  test('a revoked password ends the watcher; a poll with a new one starts it again', async () => {
    const {imap, w, source, drain} = await setup({pushes: false});
    imap.revoke(ADDRESS);
    await vi.waitFor(() => expect(imap.idling).toBe(0));
    imap.addUser(ADDRESS, 'qrst-uvwx-yzab-cdef');
    writeSourceCredentials(w.store, source.id, {kind: 'app_password', username: ADDRESS, password: 'qrst-uvwx-yzab-cdef'});
    w.advance(2 * MINUTE);
    await drain();
    await vi.waitFor(() => expect(imap.idling).toBe(1));
  });

  test('an IDLE iCloud refuses ends the watcher rather than asking again; the next poll starts another', async () => {
    const {imap, w, drain} = await setup({before: fake => fake.inject(/^IDLE/, 'NO Try later', 50)});
    const idles = () => imap.commands.filter(line => line.startsWith('IDLE')).length;
    await vi.waitFor(() => expect(idles()).toBeGreaterThan(0));
    // Only the poll's pooled session is left.
    await vi.waitFor(() => expect(imap.connections).toBe(1));
    expect(idles()).toBe(1);
    w.advance(2 * MINUTE);
    await drain();
    await vi.waitFor(() => expect(idles()).toBe(2));
    await vi.waitFor(() => expect(imap.connections).toBe(1));
  });

  test('closing the adapter leaves no sessions open', async () => {
    const {imap, adapter} = await setup();
    await adapter.close();
    await vi.waitFor(() => expect(imap.connections).toBe(0));
  });
});
