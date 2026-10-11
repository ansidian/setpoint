// The one-time extraction pass over backfilled history (SV-4 D20), with the history model faked: it
// starts once the backfills are done and a key is set, fills what the history pass guessed without
// touching the lane, resumes after a restart, and never charges for an email twice.
import {and, eq} from 'drizzle-orm';
import {expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {setSecret} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {startBackfill, writeBackfill} from '../src/sync/cursors.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {Adapters} from '../src/sync/registry.ts';
import {historyProgress, HistoryExtractor, startHistoryExtraction} from '../src/triage/history.ts';
import {TriageWorker} from '../src/triage/worker.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer} from './fakeModels.ts';
import {triageWorld} from './triageWorld.ts';

vi.setConfig({testTimeout: 30_000});

const reading = (changes: Record<string, unknown>): FakeAnswer => ({tool: {
  lane: 'fyi', kind: 'career', organisation: 'Northwind', via: 'Greenhouse', type: 'rejection', key_date: null, summary: 'Data Engineer Intern',
  security: null, protected_class: null, confidence: 0.9, ...changes,
}});

async function setup() {
  const fake = await fakeModels();
  const world = triageWorld(fake.endpoints);
  const account = world.accountId('Jobs');
  const source = world.store.db.select().from(t.sources).where(eq(t.sources.accountId, account)).get()!;
  const history = (subject: string, changes: Parameters<typeof world.fetched>[0] = {}) =>
    upsertMessages(world.store, account, [world.fetched({subject, receivedAt: '2026-03-03T17:00:00.000Z', unread: false, ...changes})], {backfill: true}).inserted[0]!;
  const finishBackfill = () => {
    const state = startBackfill(world.store, source.id, 3, null);
    writeBackfill(world.store, source.id, {...state, fetched: 3, done: true, finishedAt: world.store.now().toISOString()});
  };
  const ledger = () => world.store.db.select().from(t.aiUsage).all();
  return {fake, world, history, finishBackfill, ledger};
}

test('it starts once the backfills are done and a key is set, and fills fields without touching the lane', async () => {
  const {fake, world, history, finishBackfill, ledger} = await setup();
  fake.answer(request => (/Subject: Your password was changed/.test(request.input)
    ? reading({lane: 'attention', kind: 'security', organisation: 'Google', via: null, type: 'alert', summary: 'Password changed', protected_class: 'password_changed', security: {what: 'Password changed', device: 'Pixel 9'}})
    : reading({lane: 'attention'})));
  const rejection = history('Your application for Data Engineer Intern', {fromName: 'Northwind Recruiting via Greenhouse', fromAddress: 'no-reply@greenhouse-mail.example', bodyText: 'We won\'t be moving forward.'});
  const locked = history('Your password was changed', {fromName: 'Google', fromAddress: 'no-reply@accounts.google.example'});
  expect(world.message(rejection)).toMatchObject({lane: 'fyi', organisation: 'Northwind Recruiting', type: 'rejection', extractedAt: null});
  expect(world.message(locked)).toMatchObject({lane: 'fyi', protected: true, kind: 'security'});

  // Backfill done but no key: nothing starts.
  finishBackfill();
  await world.drain();
  expect(historyProgress(world.store)).toEqual({state: 'not_started', done: 0, total: 2});

  setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  world.advance(5 * 60_000);
  await world.drain();
  expect(historyProgress(world.store)).toEqual({state: 'done', done: 2, total: 2});
  // The model's Attention and protected claim change nothing: history stays out of Attention.
  expect(world.message(rejection)).toMatchObject({lane: 'fyi', kind: 'career', organisation: 'Northwind', via: 'Greenhouse', type: 'rejection', summary: 'Data Engineer Intern'});
  expect(world.message(rejection).extractedAt).not.toBeNull();
  expect(world.message(locked)).toMatchObject({lane: 'fyi', protected: true, kind: 'security', organisation: 'Google', type: 'alert', securityFacts: {what: 'Password changed', device: 'Pixel 9'}});
  // Only the history model (Haiku 5.5 by default, D26, not triage's Sonnet), once per email, every call in the ledger.
  expect(fake.requests.map(request => request.model)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
  expect(ledger().map(entry => entry.messageId).sort()).toEqual([rejection, locked].sort());

});

test('Settings › AI can choose the history pass\'s model', async () => {
  const {fake, world, history, finishBackfill} = await setup();
  fake.answer(() => reading({}));
  updateSettings(world.store, {ai: {history_model: 'claude-sonnet-5-5'}});
  history('Your application for Data Engineer Intern');
  setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  finishBackfill();
  world.advance(5 * 60_000);
  await world.drain();
  expect(fake.requests.map(request => request.model)).toEqual(['claude-sonnet-5-5']);
});

test('it resumes after a restart and never charges for an email twice', async () => {
  const {fake, world, history, ledger} = await setup();
  setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const ids = ['One', 'Two', 'Three', 'Four', 'Five'].map(subject => history(`Old ${subject}`));
  // The provider is overloaded for two of them.
  fake.answer(request => (/Subject: Old (Two|Four)/.test(request.input) ? 'overloaded' : reading({})));
  expect(startHistoryExtraction(world.store)).toMatchObject({state: 'running', done: 0, total: 5, queued: 5});
  await world.drain();
  expect(historyProgress(world.store)).toMatchObject({state: 'running', done: 3});
  expect(ledger()).toHaveLength(3);

  // A restart: new workers on a new engine over the same database; the provider is back.
  const restarted = new SyncEngine({store: world.store, adapters: new Adapters(), workers: [
    new TriageWorker({store: world.store, endpoints: fake.endpoints}), new HistoryExtractor({store: world.store, endpoints: fake.endpoints}),
  ]});
  fake.answer(() => reading({}));
  world.advance(10 * 60_000);
  for (let round = 0; round < 5; round += 1) {
    await restarted.tick();
    await restarted.settled();
  }
  expect(historyProgress(world.store)).toEqual({state: 'done', done: 5, total: 5});
  expect(ledger().map(entry => entry.messageId).sort()).toEqual([...ids].sort());

  // Starting again, or a job left over from a crash, asks nothing more.
  const asked = fake.requests.length;
  expect(startHistoryExtraction(world.store).queued).toBe(0);
  world.store.db.insert(t.jobs).values({kind: 'extract', key: `extract:${ids[0]}`, messageId: ids[0]!, state: 'running', attempts: 1,
    runAt: world.store.now().toISOString(), leaseUntil: '2026-10-07T00:00:00.000Z', createdAt: world.store.now().toISOString()}).run();
  await restarted.tick();
  await restarted.settled();
  expect(fake.requests.length).toBe(asked);
  expect(world.store.db.select().from(t.jobs).where(and(eq(t.jobs.kind, 'extract'), eq(t.jobs.messageId, ids[0]!))).all().at(-1)!.state).toBe('done');
  expect(ledger()).toHaveLength(5);
});

test('started without a key, it waits; new mail is never part of it', async () => {
  const {fake, world, history} = await setup();
  history('Old receipt');
  upsertMessages(world.store, world.accountId('Jobs'), [world.fetched({subject: 'New mail'})]);
  expect(startHistoryExtraction(world.store)).toMatchObject({state: 'waiting_for_key', done: 0, total: 1, queued: 0});
  await world.drain();
  expect(fake.requests).toHaveLength(0);
  expect(world.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'extract')).all()).toEqual([]);
});
