// Triage as it runs (B3): durable jobs on the engine, Unsorted while it's down and re-sorted once it
// recovers, the health line, the ledger, backfilled history, once per email, and the learning loop
// and its API (pattern prompts, Yes into a learned rule, No into quiet, rules, precision, AI).
import {and, eq} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import {openMessage, setDone} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {inbox} from '../src/queries/mail.ts';
import {setSecret} from '../src/secrets/store.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {answerPrompt, currentPrompts, deleteRule, listRules, precision} from '../src/triage/learning.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer} from './fakeModels.ts';
import {signedIn} from './helpers.ts';
import {triageWorld} from './triageWorld.ts';

// Real HTTP round trips to the fake, dozens per test: generous under a loaded machine.
vi.setConfig({testTimeout: 30_000});

const decision = (changes: Record<string, unknown> = {}): FakeAnswer => ({tool: {
  lane: 'fyi', kind: 'updates', organisation: 'Northwind Engineering', via: null, type: 'newsletter', key_date: null, summary: 'New posts', security: null,
  protected_class: null, confidence: 0.9, ...changes,
}});

async function setup(fixtures: string[] = [], timeoutMs?: number) {
  const fake = await fakeModels();
  const world = triageWorld(fake.endpoints, {timeoutMs, fixtures});
  const deliver = (changes: Parameters<typeof world.fetched>[0] = {}, account = 'Jobs', backfill = false) =>
    upsertMessages(world.store, world.accountId(account), [world.fetched(changes)], {backfill}).inserted[0]!;
  return {fake, world, deliver};
}

describe('triage down and back', () => {
  test('with no key, new mail waits in Unsorted and the Inbox says triage is down; a key sorts it', async () => {
    const {fake, world, deliver} = await setup();
    fake.answer(() => decision());
    const id = deliver({subject: 'Northwind Engineering Digest · October'});
    await world.drain();
    expect(world.message(id).lane).toBeNull();
    expect(world.status()).toEqual({state: 'down', as_of: null, reason: 'Triage has no model to ask: add an Anthropic or OpenAI key in Settings › AI.', unsorted: 1});
    expect(inbox(world.store).groups.find(group => group.group === 'unsorted')!.rows.map(row => row.id)).toEqual([id]);
    expect(fake.requests).toHaveLength(0);

    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    world.worker.configurationChanged();
    await world.drain();
    expect(world.message(id)).toMatchObject({lane: 'fyi', kind: 'updates', type: 'newsletter', organisation: 'Northwind Engineering', triageSource: 'cheap_model'});
    expect(world.status()).toMatchObject({state: 'healthy', reason: null, unsorted: 0});
    expect(inbox(world.store).groups.some(group => group.group === 'unsorted')).toBe(false);
  });

  test.each<[string, FakeAnswer, string, boolean]>([
    // name, the provider's answer, the reason shown, retried by the policy
    ['429', 'rate_limited', 'Anthropic: Number of request tokens has exceeded your per-minute rate limit (429)', true],
    ['529 overloaded', 'overloaded', 'Anthropic: Overloaded (529)', true],
    ['a timeout', 'hang', 'Anthropic didn\'t answer in time.', true],
    ['a refused key', {status: 401, body: {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}}}, 'Anthropic: invalid x-api-key (401). Check the Anthropic key in Settings › AI.', false],
  ])('%s: Unsorted with the provider\'s words, and re-sorted once triage recovers', async (_, failure, reason, retried) => {
    // A hang needs a request limit short enough to reach in the test; the other rows keep the world's.
    const {fake, world, deliver} = await setup([], failure === 'hang' ? 1500 : undefined);
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    fake.answer(() => decision());
    const first = deliver({subject: 'First'});
    await world.drain();
    const healthyAt = world.status().as_of;
    expect(healthyAt).not.toBeNull();

    world.advance(60_000);
    fake.answer(() => failure);
    const second = deliver({subject: 'Second'});
    await world.drain();
    expect(world.message(second).lane).toBeNull();
    expect(world.status()).toEqual({state: 'down', as_of: healthyAt, reason, unsorted: 1});
    expect(world.job(second)).toMatchObject(retried ? {state: 'queued', attempts: 1} : {state: 'failed', attempts: 1});
    expect(world.message(first).lane).toBe('fyi');

    // The provider is back. A refused key waits for a new key (or the next resort); a transient
    // failure retries on its own after the policy's backoff.
    fake.answer(() => decision());
    world.advance(5 * 60_000);
    await world.drain();
    expect(world.message(second)).toMatchObject({lane: 'fyi', triageSource: 'cheap_model'});
    expect(world.status()).toMatchObject({state: 'healthy', unsorted: 0});
  });

  test('a recovery runs the others waiting out their backoff at once', async () => {
    const {fake, world, deliver} = await setup();
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    fake.answer(() => 'overloaded');
    const ids = [deliver({subject: 'One'}), deliver({subject: 'Two'}), deliver({subject: 'Three'})];
    await world.drain();
    expect(ids.map(id => world.message(id).lane)).toEqual([null, null, null]);
    // A new email gets through first; its success brings the others forward.
    fake.answer(() => decision());
    const fresh = deliver({subject: 'Four'});
    await world.drain();
    await world.drain();
    expect([...ids, fresh].map(id => world.message(id).lane)).toEqual(['fyi', 'fyi', 'fyi', 'fyi']);
  });

  test('a rule\'s lane stands while the model is down, with what can be read without it', async () => {
    const {fake, world, deliver} = await setup();
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    fake.answer(() => 'overloaded');
    const id = deliver({fromName: 'Tailspin Toys', fromAddress: 'deals@tailspintoys.example', subject: 'Flash sale: 40% off', bodyText: 'Today only. Unsubscribe'}, 'Personal');
    await world.drain();
    expect(world.message(id)).toMatchObject({lane: 'noise', kind: null, organisation: 'Tailspin Toys', triageSource: 'rule'});
    expect(world.status().state).toBe('down');
  });
});

describe('once per email, history, the ledger', () => {
  test('each email is triaged once: a second job for it asks nothing', async () => {
    const {fake, world, deliver} = await setup();
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    fake.answer(() => decision());
    const id = deliver();
    await world.drain();
    world.store.db.insert(t.jobs).values({kind: 'triage', key: `triage:${id}`, messageId: id, runAt: world.store.now().toISOString(), createdAt: world.store.now().toISOString()}).run();
    await world.drain();
    expect(fake.requests).toHaveLength(1);
  });

  test('backfilled history is sorted at once by the rules-only pass, with no model call; protected history keeps its flag but not Attention', async () => {
    const {fake, world, deliver} = await setup();
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    const old = deliver({fromName: 'Woodgrove Bank', fromAddress: 'no-reply@woodgrovebank.example', subject: 'Statement ready', receivedAt: '2026-03-02T16:00:00.000Z'}, 'Personal', true);
    const locked = deliver({fromName: 'Google', fromAddress: 'no-reply@accounts.google.example', subject: 'Your password was changed', receivedAt: '2026-04-02T16:00:00.000Z'}, 'Personal', true);
    expect(world.message(old)).toMatchObject({lane: 'fyi', kind: 'money', type: 'statement', organisation: 'Woodgrove Bank', triageSource: 'history'});
    expect(world.message(locked)).toMatchObject({lane: 'fyi', protected: true, kind: 'security'});
    await world.drain();
    expect(fake.requests).toHaveLength(0);
    expect(world.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'triage')).all()).toEqual([]);
  });

  test('every model call goes into the AI usage ledger with its tokens and cost', async () => {
    const {fake, world, deliver} = await setup();
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    fake.answer(request => (request.model === 'claude-sonnet-5-5'
      ? {...decision({lane: 'attention', kind: 'career'}) as {tool: Record<string, unknown>}, usage: {input: 1000, output: 100, cacheRead: 2000}}
      : {...decision({lane: 'attention', kind: 'career'}) as {tool: Record<string, unknown>}, usage: {input: 1000, output: 100}}));
    const id = deliver({subject: 'Interview availability'});
    await world.drain();
    const ledger = world.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.messageId, id)).all();
    expect(ledger.map(entry => ({model: entry.model, input: entry.inputTokens, output: entry.outputTokens, cached: entry.cachedTokens, cost: entry.costMicros, purpose: entry.purpose}))).toEqual([
      // Sonnet 5.5: $2 in, $0.20 cached, $10 out; Opus 5.5: $4 in, $20 out (per million).
      {model: 'claude-sonnet-5-5', input: 3000, output: 100, cached: 2000, cost: 2000 + 400 + 1000, purpose: 'triage'},
      {model: 'claude-opus-5-5', input: 1000, output: 100, cached: 0, cost: 4000 + 2000, purpose: 'triage'},
    ]);
  });
});

describe('the learning loop', () => {
  test('the base seed raises no prompt; board 09\'s four Northwind digests, cleared unopened, make one', () => {
    expect(currentPrompts(triageWorld({anthropic: 'http://127.0.0.1:9', openai: 'http://127.0.0.1:9'}).store)).toEqual([]);
    const {world} = triageWorldOnly();
    const [prompt] = currentPrompts(world.store);
    expect(prompt).toMatchObject({organisation: 'Northwind Engineering', type: 'newsletter', count: 4, protected: false, lane: 'fyi', kind: 'updates'});
    expect(prompt!.message_ids).toHaveLength(4);
    // The same prompt keeps its id.
    expect(currentPrompts(world.store)[0]!.id).toBe(prompt!.id);
  });

  test('protected mail cleared unopened four times gets no prompt', () => {
    const {world} = triageWorldOnly();
    const account = world.accountId('Personal');
    for (const day of [1, 2, 3, 4]) {
      const [id] = upsertMessages(world.store, account, [world.fetched({subject: `Password changed ${day}`})], {backfill: true}).inserted;
      world.store.db.update(t.messages).set({backfill: false, lane: 'attention', protected: true, organisation: 'Google', type: 'alert', kind: 'security'}).where(eq(t.messages.id, id!)).run();
      setDone(world.store, id!, true);
    }
    expect(currentPrompts(world.store).map(prompt => prompt.organisation)).toEqual(['Northwind Engineering']);
  });

  test('Yes makes a learned rule that sends the next one to FYI; No keeps it quiet', async () => {
    const {fake, world, deliver} = await setup(['new-digest']);
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    const [prompt] = currentPrompts(world.store);
    expect(answerPrompt(world.store, prompt!.id, 'yes')).toEqual([]);
    expect(listRules(world.store).filter(rule => rule.origin === 'learned')).toMatchObject([
      {match: {organisation: 'Northwind Engineering', type: 'newsletter'}, lane: 'fyi', kind: 'updates', matches_this_month: 0},
    ]);
    // The cheap model would put the next digest in Attention; the learned rule sends it to FYI.
    fake.answer(() => decision({lane: 'attention', confidence: 0.95}));
    const id = deliver({subject: 'Northwind Engineering Digest · October 7'});
    await world.drain();
    expect(world.message(id)).toMatchObject({lane: 'fyi', kind: 'updates', triageSource: 'learned_rule'});
    expect(listRules(world.store).find(rule => rule.origin === 'learned')!.matches_this_month).toBe(1);

    // No: the prompt for another pattern stays quiet even as the count grows.
    const account = world.accountId('Jobs');
    const clear = (subject: string) => {
      const [cleared] = upsertMessages(world.store, account, [world.fetched({subject})], {backfill: true}).inserted;
      world.store.db.update(t.messages).set({backfill: false, lane: 'attention', organisation: 'Fabrikam', type: 'confirmation', kind: 'career'}).where(eq(t.messages.id, cleared!)).run();
      setDone(world.store, cleared!, true);
    };
    for (const n of [1, 2, 3, 4]) clear(`Fabrikam ${n}`);
    const fabrikam = currentPrompts(world.store).find(candidate => candidate.organisation === 'Fabrikam')!;
    expect(fabrikam.count).toBe(4);
    answerPrompt(world.store, fabrikam.id, 'no');
    clear('Fabrikam 5');
    expect(currentPrompts(world.store)).toEqual([]);
    expect(() => answerPrompt(world.store, fabrikam.id, 'yes')).toThrow('answered already');
  });

  test('an opened one before Done ends the run; undoing a learned rule keeps its prompt quiet', () => {
    const {world} = triageWorldOnly();
    const account = world.accountId('Jobs');
    const [opened] = upsertMessages(world.store, account, [world.fetched({subject: 'Digest', unread: false})], {backfill: true}).inserted;
    world.store.db.update(t.messages).set({backfill: false, lane: 'attention', organisation: 'Northwind Engineering', type: 'newsletter', kind: 'updates'}).where(eq(t.messages.id, opened!)).run();
    openMessage(world.store, opened!);
    setDone(world.store, opened!, true);
    expect(currentPrompts(world.store)).toEqual([]);

    const fresh = triageWorldOnly().world;
    const [prompt] = currentPrompts(fresh.store);
    answerPrompt(fresh.store, prompt!.id, 'yes');
    deleteRule(fresh.store, listRules(fresh.store).find(rule => rule.origin === 'learned')!.id);
    expect(currentPrompts(fresh.store)).toEqual([]);
    expect(fresh.store.db.select().from(t.patternPrompts).where(and(eq(t.patternPrompts.id, prompt!.id), eq(t.patternPrompts.answer, 'no'))).get()).toBeDefined();
  });

  test('attention precision over board 09\'s history: the four digests were Done unopened', () => {
    const {world} = triageWorldOnly();
    // Sep 9, 16 and 23 fall in the 30 days to Oct 7; Sep 2 doesn't.
    expect(precision(world.store)).toMatchObject({precision: 0, done: 3, opened_before_done: 0, from: '2026-09-08', to: '2026-10-07'});
    const attention = world.store.db.select().from(t.messages).where(and(eq(t.messages.lane, 'attention'), eq(t.messages.subject, 'Final exam schedule · CS 101'))).get()!;
    openMessage(world.store, attention.id);
    setDone(world.store, attention.id, true);
    expect(precision(world.store)).toMatchObject({precision: 0.25, done: 4, opened_before_done: 1});
  });
});

function triageWorldOnly() {
  // Board 09's fixture: four Northwind Engineering digests cleared unopened.
  return {world: triageWorld({anthropic: 'http://127.0.0.1:9', openai: 'http://127.0.0.1:9'}, {fixtures: ['new-digest']})};
}

describe('the API', () => {
  test('prompts, answers, rules, precision, triage health and AI as F2 and F7 read them', async () => {
    const {world} = triageWorldOnly();
    const api = await signedIn(world, {triage: world.worker});
    expect((await api.send('GET', '/api/mail/triage')).body).toEqual({state: 'healthy', as_of: null, reason: null, unsorted: 0, history: {state: 'not_started', done: 0, total: 0}});
    const prompts = (await api.send('GET', '/api/mail/prompts')).body;
    expect(prompts).toEqual([expect.objectContaining({id: expect.any(Number), organisation: 'Northwind Engineering', type: 'newsletter', count: 4, protected: false})]);
    expect((await api.send('POST', `/api/mail/prompts/${prompts[0].id}`, {body: {answer: 'maybe'}})).status).toBe(400);
    expect((await api.send('POST', `/api/mail/prompts/${prompts[0].id}`, {body: {answer: 'yes'}})).body).toEqual([]);
    expect((await api.send('POST', `/api/mail/prompts/${prompts[0].id}`, {body: {answer: 'no'}})).body.error.code).toBe('answered');
    expect((await api.send('POST', '/api/mail/prompts/999', {body: {answer: 'no'}})).status).toBe(404);

    const created = await api.send('POST', '/api/mail/rules', {body: {match: {from_domains: ['woodgrovebank.example']}, lane: 'fyi', kind: 'money'}});
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({origin: 'written', match: {from_domains: ['woodgrovebank.example']}, lane: 'fyi', kind: 'money', position: 0, enabled: true, imported: false});
    expect((await api.send('POST', '/api/mail/rules', {body: {match: {from_domains: ['x.example']}, lane: 'noise', kind: 'money'}})).body.error.message).toContain('Noise has no kind');
    expect((await api.send('POST', '/api/mail/rules', {body: {match: {subject_regex: '(['}, lane: 'fyi'}})).status).toBe(400);
    const second = (await api.send('POST', '/api/mail/rules', {body: {match: {subject_includes: ['registrar']}, lane: 'attention'}})).body;
    expect((await api.send('PUT', '/api/mail/rules/order', {body: {rule_ids: [second.id, created.body.id]}})).body.map((rule: {id: number}) => rule.id).slice(0, 2)).toEqual([second.id, created.body.id]);
    expect((await api.send('PATCH', `/api/mail/rules/${created.body.id}`, {body: {enabled: false}})).body.enabled).toBe(false);
    const rules = (await api.send('GET', '/api/mail/rules')).body;
    expect(rules.map((rule: {origin: string}) => rule.origin)).toEqual(['written', 'written', 'learned']);
    expect((await api.send('DELETE', `/api/mail/rules/${second.id}`)).status).toBe(204);

    expect((await api.send('GET', '/api/mail/precision')).body).toMatchObject({precision: 0, done: 3, opened_before_done: 0});
    expect((await api.send('GET', '/api/mail/precision')).body.days).toHaveLength(30);

    expect((await api.send('GET', '/api/ai')).body).toMatchObject({
      keys: {anthropic: false, openai: false}, triage: {cheap: null, strong: null, history: null}, usage_30_days: {calls: 0, cost_usd: 0},
      defaults: {triage_model: null, triage_strong_model: null, history_model: null, alfred_model: null},
    });
    expect((await api.send('PUT', '/api/secrets/openai_api_key', {body: {value: FAKE_KEYS.openai}})).status).toBe(204);
    expect((await api.send('GET', '/api/ai')).body.triage).toEqual({cheap: {provider: 'openai', model: 'gpt-5.4-mini'}, strong: {provider: 'openai', model: 'gpt-5.5'}, history: {provider: 'openai', model: 'gpt-5.4-mini'}});
    expect((await api.send('GET', '/api/ai')).body.alfred).toEqual({provider: 'openai', model: 'gpt-5.5'});
    expect((await api.send('PATCH', '/api/settings', {body: {ai: {triage_model: 'claude-haiku-5-5'}}})).status).toBe(200);
    // What Default is for each model, whatever is chosen, so the picker can name it (UX #14).
    expect((await api.send('GET', '/api/ai')).body.defaults).toEqual({
      triage_model: 'gpt-5.4-mini', triage_strong_model: 'gpt-5.5', history_model: 'gpt-5.4-mini', alfred_model: 'gpt-5.5',
    });
    expect((await api.send('GET', '/api/ai')).body.triage).toEqual({cheap: null, strong: {provider: 'openai', model: 'gpt-5.5'}, history: {provider: 'openai', model: 'gpt-5.4-mini'}});
    // Keys stay write-only.
    expect(JSON.stringify((await api.send('GET', '/api/secrets')).body)).not.toContain(FAKE_KEYS.openai);
  });
});
