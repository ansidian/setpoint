// Every email's search terms (SV-136), with Haiku faked at the HTTP boundary: new mail is read once
// triage has sorted it, older mail only on the go-ahead, trashed mail never, each email is charged for
// at most once per prompt, it resumes after a restart, and with no key nothing changes.
import {eq} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {searchBody} from '../src/domain/searchBody.ts';
import {matchSearch} from '../src/search/search.ts';
import {queueSearchTerms, searchTermsKey, searchTermsProgress, SearchTermsWorker, startSearchTermsPass} from '../src/search/terms.ts';
import {SEARCH_TERMS_BODY_LIMIT, SEARCH_TERMS_PROMPT_VERSION, searchTermsInput, termsOf, termsText} from '../src/search/termsPrompt.ts';
import {setSecret} from '../src/secrets/store.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {aiOverview} from '../src/triage/learning.ts';
import {triageStatus} from '../src/triage/health.ts';
import {TriageWorker} from '../src/triage/worker.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer, FakeRequest} from './fakeModels.ts';
import {triageWorld} from './triageWorld.ts';

vi.setConfig({testTimeout: 30_000});

const FIVE_MINUTES = 5 * 60_000;
const terms = (...words: string[]): FakeAnswer => ({tool: {terms: words}});
const isTerms = (request: FakeRequest) => request.body.tools?.[0]?.name === 'submit_search_terms';

const reading = (changes: Record<string, unknown> = {}): FakeAnswer => ({tool: {
  lane: 'fyi', kind: 'money', organisation: 'Northwind Power', via: null, type: 'statement', key_date: null, summary: 'October statement', security: null,
  protected_class: null, confidence: 0.9, ...changes,
}});

async function setup({key = true} = {}) {
  const fake = await fakeModels();
  fake.answer(request => (isTerms(request) ? terms('electricity bill') : reading()));
  const world = triageWorld(fake.endpoints);
  // The seed's mail has been read, so a test sees only its own.
  world.store.db.update(t.messages).set({searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION}).run();
  if (key) setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const workers = () => {
    const searchTerms = new SearchTermsWorker({store: world.store, endpoints: fake.endpoints, timeoutMs: 2000});
    const triage = new TriageWorker({store: world.store, endpoints: fake.endpoints, timeoutMs: 2000, onSorted: () => searchTerms.nudge()});
    return new SyncEngine({store: world.store, adapters: new Adapters(), workers: [triage, world.history, searchTerms]});
  };
  const engine = workers();
  const drain = async (running = engine) => {
    for (let round = 0; round < 6; round += 1) {
      await running.tick();
      await running.settled();
    }
  };
  const deliver = (changes: Parameters<typeof world.fetched>[0] = {}, backfill = false) =>
    upsertMessages(world.store, world.accountId('Jobs'), [world.fetched(changes)], {backfill}).inserted[0]!;
  const asked = () => fake.requests.filter(isTerms);
  const ledger = () => world.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, 'search_terms')).all();
  const update = (id: number, changes: Partial<typeof t.messages.$inferInsert>) => world.store.db.update(t.messages).set(changes).where(eq(t.messages.id, id)).run();
  return {fake, world, engine, workers, drain, deliver, asked, ledger, update};
}

describe('the prompt\'s input and answer', () => {
  const email = {fromName: 'Billing', fromAddress: 'billing@northwind.example', organisation: 'Northwind Power', subject: 'Your bill', type: 'statement', summary: 'October bill', searchBody: 'Amount due.\n\nPay  now.'};

  test('who, what, then the clean body with its spacing folded', () => {
    expect(searchTermsInput(email)).toBe('From: Billing <billing@northwind.example>\nOrganisation: Northwind Power\nSubject: Your bill\nType: statement\nSummary: October bill\n\nBody:\nAmount due. Pay now.');
  });

  test('what triage hasn\'t filled is left out, and the body stops at its limit', () => {
    const input = searchTermsInput({...email, organisation: null, type: null, summary: null, searchBody: 'x'.repeat(SEARCH_TERMS_BODY_LIMIT + 50)});
    expect(input.split('\n').slice(0, 4)).toEqual(['From: Billing <billing@northwind.example>', 'Subject: Your bill', '', 'Body:']);
    expect(input.split('\n')[4]).toHaveLength(SEARCH_TERMS_BODY_LIMIT);
  });

  test.each([
    ['tidied, once each, keeping the order', {terms: [' Phone  Bill ', 'phone bill', 'Plan Change']}, ['phone bill', 'plan change']],
    ['what isn\'t a string, or is empty, or is too long to be a term', {terms: ['ok', 3, null, '  ', 'x'.repeat(61)]}, ['ok']],
    ['at most twelve', {terms: Array.from({length: 15}, (_, index) => `term ${index}`)}, Array.from({length: 12}, (_, index) => `term ${index}`)],
    ['not a list', {terms: 'phone bill'}, []],
    ['no answer', null, []],
  ])('termsOf: %s', (_name, input, expected) => {
    expect(termsOf(input)).toEqual(expected);
  });

  test('terms go in one a line, and none are null', () => {
    expect(termsText(['phone bill', 'plan change'])).toBe('phone bill\nplan change');
    expect(termsText([])).toBeNull();
  });
});

describe('new mail', () => {
  test('is read on Haiku once triage has sorted it, into the index and the ledger', async () => {
    const {world, drain, deliver, asked, ledger} = await setup();
    const id = deliver({subject: 'Your statement is ready', fromName: 'Northwind Power', fromAddress: 'bills@northwind.example', bodyText: 'Your October amount is ready: https://track.example/a/b?c=d\n\nTo unsubscribe, click here.'});
    expect(asked()).toEqual([]);
    await drain();

    expect(world.message(id)).toMatchObject({lane: 'fyi', searchTerms: 'electricity bill', searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION});
    const [request] = asked();
    expect(request!.model).toBe('claude-haiku-5-5');
    // What triage settled, and the body without its links or footer.
    expect(request!.input).toContain('Organisation: Northwind Power\nSubject: Your statement is ready\nType: statement\nSummary: October statement');
    expect(request!.input).toContain(searchBody('Your October amount is ready: https://track.example/a/b?c=d\n\nTo unsubscribe, click here.').replace(/\s+/g, ' '));
    expect(request!.input).not.toContain('track.example/a');
    expect(request!.input).not.toContain('unsubscribe');

    // 900 tokens in at $0.10 per million, 120 out at $0.50.
    expect(ledger().map(row => ({model: row.model, provider: row.provider, messageId: row.messageId, cost: row.costMicros}))).toEqual([{model: 'claude-haiku-5-5', provider: 'anthropic', messageId: id, cost: 150}]);
    expect(matchSearch(world.store, {text: 'electricity', chips: [], account_id: undefined}).ids).toContain(id);
  });

  test('a nudge that never comes costs only the wait: the next round queues it', async () => {
    const {world, drain, asked} = await setup();
    await drain();
    const id = world.store.db.insert(t.messages).values({
      accountId: world.accountId('Jobs'), providerId: 'p-quiet', threadId: 't', fromName: 'Sender', fromAddress: 'sender@example.com', subject: 'Sorted elsewhere', snippet: '', bodyText: '',
      receivedAt: world.store.now().toISOString(), unread: false, lane: 'fyi',
    }).returning().get().id;
    await drain();
    expect(asked()).toEqual([]);
    world.advance(FIVE_MINUTES);
    await drain();
    expect(asked()).toHaveLength(1);
    expect(world.message(id).searchTermsVersion).toBe(SEARCH_TERMS_PROMPT_VERSION);
  });

  test('backfilled mail waits for the history pass, whose reading it uses', async () => {
    const {world, deliver, update} = await setup();
    const id = deliver({subject: 'Old bill', receivedAt: '2026-03-03T17:00:00.000Z'}, true);
    expect(world.message(id).lane).not.toBeNull();
    expect(queueSearchTerms(world.store)).toBe(0);
    update(id, {extractedAt: world.store.now().toISOString()});
    expect(queueSearchTerms(world.store)).toBe(1);
  });

  test('a provider\'s failure retries the job, leaves triage\'s health alone, and asks again later', async () => {
    const {fake, world, engine, drain, deliver, ledger} = await setup();
    fake.answer(request => (isTerms(request) ? 'overloaded' : reading()));
    const id = deliver({subject: 'Your statement'});
    await drain();
    expect(world.message(id).searchTermsVersion).toBeNull();
    expect(ledger()).toEqual([]);
    expect(triageStatus(world.store).state).toBe('healthy');
    expect(world.store.db.select().from(t.jobs).where(eq(t.jobs.key, searchTermsKey(id))).get()).toMatchObject({state: 'queued', attempts: 1});

    fake.answer(() => terms('electricity bill'));
    world.advance(60_000);
    await drain(engine);
    expect(world.message(id).searchTerms).toBe('electricity bill');
    expect(ledger()).toHaveLength(1);
  });
});

describe('what isn\'t read', () => {
  test('no key: nothing is queued, terms stay empty and search works', async () => {
    const {world, drain, deliver, asked} = await setup({key: false});
    const id = deliver({subject: 'Quarterly invoice'});
    world.store.db.update(t.messages).set({lane: 'fyi'}).where(eq(t.messages.id, id)).run();
    await drain();
    expect(asked()).toEqual([]);
    expect(world.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'search_terms')).all()).toEqual([]);
    expect(world.message(id)).toMatchObject({searchTerms: null, searchTermsVersion: null});
    expect(matchSearch(world.store, {text: 'quarterly', chips: [], account_id: undefined}).ids).toEqual([id]);
    expect(searchTermsProgress(world.store)).toMatchObject({behind: 0, key: false});
  });

  test('an OpenAI key alone doesn\'t read it: terms are Haiku\'s', async () => {
    const {world, deliver, update} = await setup({key: false});
    setSecret(world.store, 'openai_api_key', FAKE_KEYS.openai);
    update(deliver({subject: 'Quarterly invoice'}), {lane: 'fyi'});
    expect(queueSearchTerms(world.store)).toBe(0);
  });

  test('unsorted mail waits for triage', async () => {
    const {world, deliver} = await setup();
    deliver({subject: 'Not yet'});
    expect(queueSearchTerms(world.store)).toBe(0);
  });

  test('trashed mail costs nothing, even trashed once queued, and is read if it comes back', async () => {
    const {world, engine, drain, deliver, asked, update} = await setup();
    const trashed = deliver({subject: 'Trashed first'});
    const queued = deliver({subject: 'Trashed once queued'});
    update(trashed, {lane: 'fyi', trashedAt: world.store.now().toISOString()});
    update(queued, {lane: 'fyi'});
    expect(queueSearchTerms(world.store)).toBe(1);
    update(queued, {trashedAt: world.store.now().toISOString()});
    world.store.db.delete(t.jobs).where(eq(t.jobs.kind, 'triage')).run();
    await engine.tick();
    await engine.settled();
    expect(asked()).toEqual([]);

    update(trashed, {trashedAt: null});
    update(queued, {trashedAt: null});
    world.advance(FIVE_MINUTES);
    await drain();
    expect(asked()).toHaveLength(2);
    expect(world.message(trashed).searchTerms).toBe('electricity bill');
  });
});

describe('charged at most once', () => {
  test('an email read already finishes without a call, whatever job asks', async () => {
    const {world, drain, deliver, asked, ledger} = await setup();
    const id = deliver({subject: 'Your statement'});
    await drain();
    world.store.db.insert(t.jobs).values({kind: 'search_terms', key: searchTermsKey(id), messageId: id, state: 'running', attempts: 1,
      runAt: world.store.now().toISOString(), leaseUntil: '2026-01-01T00:00:00.000Z', createdAt: world.store.now().toISOString()}).run();
    world.advance(FIVE_MINUTES);
    await drain();
    expect(asked()).toHaveLength(1);
    expect(ledger()).toHaveLength(1);
    expect(queueSearchTerms(world.store)).toBe(0);
  });

  test('an answer with no usable terms counts as read, since it was paid for', async () => {
    const {fake, world, drain, deliver, asked, ledger} = await setup();
    fake.answer(request => (isTerms(request) ? 'no_tool' : reading()));
    const id = deliver({subject: 'Your statement'});
    await drain();
    world.advance(FIVE_MINUTES);
    await drain();
    expect(world.message(id)).toMatchObject({searchTerms: null, searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION});
    expect(asked()).toHaveLength(1);
    expect(ledger()).toHaveLength(1);
  });

  test('an email that goes during the call keeps its cost in the ledger', async () => {
    const {fake, world, drain, deliver, ledger, update} = await setup();
    const id = deliver({subject: 'Going'});
    update(id, {lane: 'fyi'});
    world.store.db.delete(t.jobs).where(eq(t.jobs.kind, 'triage')).run();
    fake.answer(() => {
      world.store.db.delete(t.messages).where(eq(t.messages.id, id)).run();
      return terms('gone');
    });
    await drain();
    expect(ledger().map(row => row.messageId)).toEqual([null]);
  });

  test('it resumes after a restart', async () => {
    const {fake, world, workers, drain, deliver, ledger, update} = await setup();
    const ids = ['One', 'Two', 'Three'].map(subject => deliver({subject: `Old ${subject}`}));
    for (const id of ids) update(id, {lane: 'fyi'});
    world.store.db.delete(t.jobs).where(eq(t.jobs.kind, 'triage')).run();
    fake.answer(request => (/Subject: Old Two/.test(request.input) ? 'overloaded' : terms('statement')));
    await drain();
    expect(ledger()).toHaveLength(2);

    // New workers on a new engine over the same database, with the provider back.
    const restarted = workers();
    fake.answer(() => terms('statement'));
    world.advance(10 * 60_000);
    await drain(restarted);
    expect(ledger().map(row => row.messageId).sort()).toEqual([...ids].sort());
  });
});

describe('the go-ahead', () => {
  async function older() {
    const context = await setup();
    const {world, deliver, update} = context;
    const before = deliver({subject: 'From before terms'});
    const read = deliver({subject: 'Read by an older prompt'});
    update(before, {lane: 'fyi', searchTermsVersion: 0});
    update(read, {lane: 'fyi', searchTerms: 'older words', searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION - 1});
    world.store.db.delete(t.jobs).where(eq(t.jobs.kind, 'triage')).run();
    return {...context, before, read};
  }

  test('mail from before terms and mail an older prompt read wait for it, keeping what they have', async () => {
    const {world, drain, asked, before, read} = await older();
    await drain();
    world.advance(FIVE_MINUTES);
    await drain();
    expect(asked()).toEqual([]);
    expect(world.message(read).searchTerms).toBe('older words');
    const {done, total} = searchTermsProgress(world.store);
    expect(total - done).toBe(2);
    expect(searchTermsProgress(world.store)).toMatchObject({behind: 2, started: false, key: true});

    expect(startSearchTermsPass(world.store)).toMatchObject({done, total, behind: 2, started: true});
    world.advance(FIVE_MINUTES);
    await drain();
    expect(asked()).toHaveLength(2);
    expect(world.message(before)).toMatchObject({searchTerms: 'electricity bill', searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION});
    expect(world.message(read)).toMatchObject({searchTerms: 'electricity bill', searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION});
    expect(searchTermsProgress(world.store)).toMatchObject({done: total, total, behind: 0});
  });

  test('a read that comes back with nothing keeps the terms it had', async () => {
    const {fake, world, drain, read} = await older();
    fake.answer(() => 'no_tool');
    startSearchTermsPass(world.store);
    world.advance(FIVE_MINUTES);
    await drain();
    expect(world.message(read)).toMatchObject({searchTerms: 'older words', searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION});
  });

  test('newest first, a round at a time, so a whole mailbox doesn\'t stand in front of new mail', async () => {
    const {world, deliver, update} = await setup();
    const ids = Array.from({length: 3}, (_, index) => deliver({subject: `Mail ${index}`, receivedAt: `2026-10-0${index + 1}T12:00:00.000Z`}));
    for (const id of ids) update(id, {lane: 'fyi'});
    world.store.db.delete(t.jobs).run();
    queueSearchTerms(world.store);
    expect(world.store.db.select().from(t.jobs).all().map(job => job.messageId)).toEqual([...ids].reverse());
  });
});

test('Settings › AI: the month\'s search terms have their own line and aren\'t News\'s or Triage\'s', async () => {
  const {world, drain, deliver} = await setup();
  deliver({subject: 'Your statement'});
  await drain();
  const {usage_this_month: usage, usage_30_days: thirty} = aiOverview(world.store);
  expect(usage.search_terms).toEqual({calls: 1, input_tokens: 900, output_tokens: 120, cost_usd: 0.00015});
  expect(usage.news.cost_usd).toBe(0);
  expect(thirty.calls).toBe(usage.triage.calls + 1);
});
