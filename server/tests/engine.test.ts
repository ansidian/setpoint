// The sync engine, driven by a fake adapter through every health state (decision 31), and the
// command layer run through it: confirmed, retried, failed in place; and the dev provider, which
// serves only dev sources.
import {eq} from 'drizzle-orm';
import {describe, expect, onTestFinished, test, vi} from 'vitest';
import {openMessage} from '../src/commands/mail.ts';
import {updateItem} from '../src/commands/items.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {Notifier} from '../src/notify/index.ts';
import {boardRefusals, devProvider} from '../src/providers/dev/index.ts';
import {sourceList} from '../src/queries/sources.ts';
import {writeSourceCredentials} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import type {AdapterContext, SourceAdapter} from '../src/sync/adapter.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {ProviderError} from '../src/sync/errors.ts';
import {Adapters} from '../src/sync/registry.ts';
import {itemUpdateInput} from '@setpoint/shared';
import {fakeNtfy} from './fakeNtfy.ts';
import {liveEvents, world} from './helpers.ts';
import type {World} from './helpers.ts';

const SECOND = 1000;

/** A fake adapter whose next check does what the test says: succeed, fail, or hang until released. */
function fakeAdapter() {
  type Next = {ok: true} | {error: ProviderError} | {hang: true};
  let next: Next = {ok: true};
  let release: ((error?: ProviderError) => void) | null = null;
  const calls: {kind: string; cursor?: string | null; credentials: unknown}[] = [];
  let cursor = 0;
  const check = (kind: string, context: AdapterContext, from?: string | null) => {
    calls.push({kind, cursor: from, credentials: context.credentials()});
    if ('error' in next) return Promise.reject(next.error);
    if ('hang' in next) return new Promise<void>((resolve, reject) => (release = error => (error ? reject(error) : resolve())));
    return Promise.resolve();
  };
  const adapter: SourceAdapter = {
    async sync(context, from) {
      await check('sync', context, from);
      cursor += 1;
      return {cursor: `history-${cursor}`};
    },
    sweep: context => check('sweep', context),
    async execute() {
      if ('error' in next) throw next.error;
    },
  };
  return {
    adapter, calls,
    succeed: () => (next = {ok: true}),
    fail: (error: ProviderError) => (next = {error}),
    hang: () => (next = {hang: true}),
    release: (error?: ProviderError) => release?.(error),
  };
}

/** An iCloud account polled every minute, with credentials: stale after 3 minutes without a check. */
function icloud(w: World) {
  const account = w.store.db.insert(t.accounts).values({provider: 'icloud', label: 'iCloud', address: 'user@example.net', colour: 'ink2', icon: 'cloud', position: 0, createdAt: w.store.now().toISOString()}).returning().get();
  const source = w.store.db.insert(t.sources).values({provider: 'icloud', accountId: account.id, syncMode: 'poll', intervalSeconds: 60, createdAt: w.store.now().toISOString()}).returning().get();
  writeSourceCredentials(w.store, source.id, {kind: 'app_password', username: 'user@example.net', password: 'abcd-efgh-ijkl-mnop'});
  return source.id;
}

const health = (w: World, sourceId: number) => sourceList(w.store).find(source => source.id === sourceId)!.health;
const healthEvents = (w: World) => liveEvents(w).filter(event => event.type === 'health');

describe('a fake adapter through the four health states', () => {
  test('healthy, failing, stale, needs reconnect, and healthy again', async () => {
    const w = world();
    const ntfy = await fakeNtfy();
    updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
    const fake = fakeAdapter();
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({icloud: fake.adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'})});
    const id = icloud(w);

    // Healthy: the first check runs at once, from no cursor, with the decrypted credentials.
    await engine.tick();
    await engine.settled();
    expect(health(w, id)).toMatchObject({state: 'healthy', as_of: w.store.now().toISOString()});
    expect(fake.calls).toEqual([{kind: 'sync', cursor: null, credentials: {kind: 'app_password', username: 'user@example.net', password: 'abcd-efgh-ijkl-mnop'}}]);
    const lastSuccess = w.store.now().toISOString();

    // Not due yet: no check.
    w.advance(30 * SECOND);
    await engine.tick();
    await engine.settled();
    expect(fake.calls).toHaveLength(1);

    // Failing: the next check runs from the stored cursor and the provider errors.
    w.advance(30 * SECOND);
    fake.fail(new ProviderError('transient', 'IMAP: Too many simultaneous connections', {status: 503}));
    await engine.tick();
    await engine.settled();
    expect(fake.calls[1]).toMatchObject({kind: 'sync', cursor: 'history-1'});
    expect(health(w, id)).toEqual({state: 'failing', as_of: lastSuccess, reason: 'IMAP: Too many simultaneous connections', last_check_at: w.store.now().toISOString()});
    // The retry policy brings it back in 30 seconds, not before.
    w.advance(29 * SECOND);
    await engine.tick();
    await engine.settled();
    expect(fake.calls).toHaveLength(2);
    w.advance(SECOND);
    fake.succeed();
    await engine.tick();
    await engine.settled();
    expect(fake.calls).toHaveLength(3);
    expect(health(w, id).state).toBe('healthy');

    // Stale: a check hangs, so none finishes within twice the interval plus the grace.
    w.advance(60 * SECOND);
    fake.hang();
    await engine.tick();
    expect(fake.calls).toHaveLength(4);
    w.advance(3 * 60 * SECOND + SECOND);
    await engine.tick();
    expect(health(w, id)).toMatchObject({state: 'stale', as_of: new Date(Date.parse(w.store.now().toISOString()) - 4 * 60 * SECOND - SECOND).toISOString()});
    // No second check starts while the first hangs.
    expect(fake.calls).toHaveLength(4);

    // Needs reconnect: the hung check ends with the credentials refused.
    fake.release(new ProviderError('auth', 'AUTHENTICATIONFAILED Invalid credentials', {status: 401}));
    await engine.settled();
    expect(health(w, id)).toMatchObject({state: 'needs_reconnect', reason: 'AUTHENTICATIONFAILED Invalid credentials'});
    // One notification, and no more checks until new credentials arrive.
    w.advance(10 * 60 * SECOND);
    await engine.tick();
    await engine.settled();
    expect(fake.calls).toHaveLength(4);
    expect(ntfy.published.map(message => [message.body.title, message.body.click])).toEqual([['iCloud needs sign-in', 'https://setpoint.example.com/settings/accounts']]);

    // Reconnected: new credentials clear it, and the next check is healthy.
    fake.succeed();
    writeSourceCredentials(w.store, id, {kind: 'app_password', username: 'user@example.net', password: 'qrst-uvwx-yzab-cdef'});
    await engine.tick();
    await engine.settled();
    expect(health(w, id).state).toBe('healthy');
    expect(fake.calls.at(-1)!.credentials).toMatchObject({password: 'qrst-uvwx-yzab-cdef'});

    // Each change was announced once, naming the source: healthy, failing, healthy, stale, needs
    // reconnect, stale (no check for ten minutes) until the new credentials' check, healthy.
    expect(healthEvents(w)).toEqual(Array.from({length: 7}, () => ({type: 'health', sources: [id]})));
    engine.stop();
  });

  test('a push source sweeps on its schedule instead of syncing', async () => {
    const w = world();
    const fake = fakeAdapter();
    const account = w.store.db.insert(t.accounts).values({provider: 'gmail', label: 'Work', address: 'user@work.example.org', colour: 'comf', icon: 'work', position: 0, createdAt: w.store.now().toISOString()}).returning().get();
    w.store.db.insert(t.sources).values({provider: 'gmail', accountId: account.id, syncMode: 'push', intervalSeconds: 300, createdAt: w.store.now().toISOString()}).run();
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: fake.adapter})});
    await engine.tick();
    await engine.settled();
    expect(fake.calls.map(call => call.kind)).toEqual(['sweep']);
    engine.pushed(1);
    await engine.tick();
    await engine.settled();
    expect(fake.calls.map(call => call.kind)).toEqual(['sweep', 'sync']);
  });
});

describe('one Google consent, one reconnect alert', () => {
  /** A Google account as Connect Gmail leaves it: Gmail and Calendar, each with the same consent. */
  function google(w: World) {
    const now = w.store.now().toISOString();
    const account = w.store.db.insert(t.accounts).values({provider: 'gmail', label: 'Personal', address: 'user@example.com', colour: 'cool', icon: 'person', position: 0, createdAt: now}).returning().get();
    return (['gmail', 'google_calendar'] as const).map(provider => {
      const source = w.store.db.insert(t.sources).values({provider, accountId: account.id, syncMode: 'poll', intervalSeconds: 60, createdAt: now}).returning().get();
      writeSourceCredentials(w.store, source.id, {kind: 'oauth', refresh_token: 'refresh-personal', access_token: null, expires_at: null, scope: null});
      return source.id;
    });
  }

  test('a revoked consent refused by Gmail and Calendar alike sends "Personal needs sign-in" once; a later revocation, once more', async () => {
    const w = world();
    const ntfy = await fakeNtfy();
    updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
    const [gmail, calendar] = [fakeAdapter(), fakeAdapter()];
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: gmail.adapter, google_calendar: calendar.adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'})});
    const ids = google(w);
    const revoked = new ProviderError('auth', 'Google refused Setpoint\'s access: Token has been expired or revoked. (invalid_grant) (400 Bad Request)', {status: 400});

    // Both refuse in the same round.
    gmail.fail(revoked);
    calendar.fail(revoked);
    await engine.tick();
    await engine.settled();
    expect(ids.map(id => health(w, id).state)).toEqual(['needs_reconnect', 'needs_reconnect']);
    expect(ntfy.published.map(message => message.body.title)).toEqual(['Personal needs sign-in']);

    // Reconnected (both sources take the new consent), then revoked again: Calendar first, Gmail a minute later.
    gmail.succeed();
    calendar.succeed();
    for (const id of ids) writeSourceCredentials(w.store, id, {kind: 'oauth', refresh_token: 'refresh-personal-2', access_token: null, expires_at: null, scope: null});
    await engine.tick();
    await engine.settled();
    w.advance(60 * SECOND);
    calendar.fail(revoked);
    await engine.tick();
    await engine.settled();
    w.advance(60 * SECOND);
    gmail.fail(revoked);
    await engine.tick();
    await engine.settled();
    expect(ids.map(id => health(w, id).state)).toEqual(['needs_reconnect', 'needs_reconnect']);
    expect(ntfy.published.map(message => message.body.title)).toEqual(['Personal needs sign-in', 'Personal needs sign-in']);
  });
});

describe('commands through the engine', () => {
  test('the dev provider confirms an open; the live events name the email and its command', async () => {
    const w = world({seed: true});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider())});
    const northwind = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Interview availability for Software Engineer I')).get()!;
    const command = openMessage(w.store, northwind.id)!;
    await engine.tick();
    await engine.settled();
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.id, command.id)).get()).toMatchObject({state: 'confirmed', providerMessage: null});
    const mail = liveEvents(w).filter(event => event.type === 'mail');
    expect(mail).toEqual([
      {type: 'mail', messages: [northwind.id], accounts: [northwind.accountId], commands: [command.id]},
      {type: 'mail', messages: [northwind.id], accounts: [northwind.accountId], commands: [command.id]},
    ]);
  });

  test('held, the dev provider keeps a change pending until it\'s let go, then confirms it', async () => {
    const w = world({seed: true});
    let holding = true;
    let asked = 0;
    const held = () => {
      asked += 1;
      return holding;
    };
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider({held}))});
    const northwind = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Interview availability for Software Engineer I')).get()!;
    const command = openMessage(w.store, northwind.id)!;
    await engine.tick();
    const state = () => w.store.db.select().from(t.commands).where(eq(t.commands.id, command.id)).get()!.state;
    // Asked again after the first answer: it's waiting on the hold, not done.
    await vi.waitFor(() => expect(asked).toBeGreaterThan(1));
    expect(state()).toBe('pending');
    holding = false;
    await engine.settled();
    expect(state()).toBe('confirmed');
  });

  test('board 19b through the dev provider: the move fails with Google\'s 409, in place', async () => {
    const w = world({seed: true});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider({refuse: boardRefusals}))});
    const dinner = w.store.db.select().from(t.items).where(eq(t.items.title, 'Dinner with Sam')).get()!;
    const command = updateItem(w.store, dinner.id, itemUpdateInput.parse({changes: {starts_at: zoned('2026-10-10', '19:00'), ends_at: zoned('2026-10-10', '21:00')}}));
    await engine.tick();
    await engine.settled();
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.id, command.id)).get()).toMatchObject({
      state: 'failed', providerMessage: 'The requested event was modified by another client. (409 Conflict)',
    });
    expect(w.store.db.select().from(t.items).where(eq(t.items.id, dinner.id)).get()!.startsAt).toBe(zoned('2026-10-10', '19:00'));
  });

  test('a transient failure stays pending and retries; a permanent one fails with the provider\'s words', async () => {
    const w = world({seed: true});
    const fake = fakeAdapter();
    // The seed's Gmail sources, served by the fake instead of the dev provider.
    w.store.db.update(t.sources).set({dev: false}).run();
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: fake.adapter})});
    const statement = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Statement ready')).get()!;
    fake.fail(new ProviderError('transient', 'Backend Error', {status: 503}));
    const command = openMessage(w.store, statement.id)!;
    await engine.tick();
    await engine.settled();
    const state = () => w.store.db.select().from(t.commands).where(eq(t.commands.id, command.id)).get()!;
    expect(state()).toMatchObject({state: 'pending', providerMessage: null});
    fake.fail(new ProviderError('permanent', 'Requested entity was not found.', {status: 404}));
    w.advance(30 * SECOND);
    await engine.tick();
    await engine.settled();
    expect(state()).toMatchObject({state: 'failed', providerMessage: 'Requested entity was not found.'});
  });

  test('a running engine sends a change on as it\'s made, not at its next tick (DESIGN.md #54)', async () => {
    const w = world({seed: true});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider())});
    // Ticks a minute apart: only the change itself can start its job in time.
    engine.start(60 * SECOND);
    onTestFinished(() => engine.stop());
    await engine.settled();
    const dinner = w.store.db.select().from(t.items).where(eq(t.items.title, 'Dinner with Sam')).get()!;
    const command = updateItem(w.store, dinner.id, itemUpdateInput.parse({changes: {starts_at: zoned('2026-10-09', '20:00'), ends_at: zoned('2026-10-09', '22:00')}}));
    await vi.waitFor(() => {
      expect(w.store.db.select().from(t.commands).where(eq(t.commands.id, command.id)).get()).toMatchObject({state: 'confirmed'});
    }, {timeout: 2 * SECOND});
  });

  test('a command with no adapter for its source fails, saying so', async () => {
    const w = world({seed: true});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters()});
    const statement = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Statement ready')).get()!;
    const command = openMessage(w.store, statement.id)!;
    await engine.tick();
    await engine.settled();
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.id, command.id)).get()).toMatchObject({
      state: 'failed', providerMessage: 'Setpoint has no connection to send this change through.',
    });
  });
});

describe('the dev provider never serves a real account', () => {
  test('the registry gives it only dev sources without credentials', () => {
    const dev = devProvider();
    const adapters = new Adapters({}, dev);
    const w = world({seed: true});
    const source = w.store.db.select().from(t.sources).get()!;
    expect(adapters.adapterFor(source)).toBe(dev);
    expect(adapters.adapterFor({...source, dev: false})).toBeNull();
    expect(adapters.adapterFor({...source, credentials: 'sp2:…'})).toBeNull();
  });

  test('a dev source can\'t take credentials, by the API\'s rule and the database\'s', () => {
    const w = world({seed: true});
    const source = w.store.db.select().from(t.sources).get()!;
    expect(() => writeSourceCredentials(w.store, source.id, {kind: 'api_key', key: 'x'})).toThrow(/dev source/);
    expect(() => w.store.db.update(t.sources).set({credentials: 'sp2:x'}).where(eq(t.sources.id, source.id)).run()).toThrow(/CHECK constraint failed: sources_dev_credentials/);
  });

  test('handed a real source anyway, it refuses', async () => {
    const w = world({seed: true});
    const source = {...w.store.db.select().from(t.sources).get()!, dev: false};
    const context: AdapterContext = {store: w.store, source, credentials: () => null, signal: new AbortController().signal};
    await expect(devProvider().sync(context, null)).rejects.toThrow(/only the seed's dev sources/);
  });
});
