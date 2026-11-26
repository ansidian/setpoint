// A conversation's own summary, for the reader's head: when one is due (a table), and as triage
// writes it through the fake Anthropic after the conversation's second email, stale after a third
// until it's written again; what the reader's head shows (a table: fresh, pending, fallback and why);
// and a failed call's cause kept beside the summary, for the newest email.
import {and, eq} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {failureOf, headSummary, PENDING_MS, summaryState} from '../src/domain/conversationSummary.ts';
import type {StoredSummary, SummaryEmail} from '../src/domain/conversationSummary.ts';
import {conversationDetail} from '../src/queries/mail.ts';
import {setSecret} from '../src/secrets/store.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {CONVERSATION_MODEL} from '../src/triage/conversation.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import {liveEvents} from './helpers.ts';
import type {FakeAnswer, FakeRequest} from './fakeModels.ts';
import {triageWorld} from './triageWorld.ts';

vi.setConfig({testTimeout: 30_000});

describe('when a conversation\'s summary is due', () => {
  const email = (id: number, fields: Partial<SummaryEmail> = {}): SummaryEmail => ({
    id, receivedAt: `2026-10-0${id}T10:00:00.000Z`, received: true, sorted: true, trashed: false, uspsDigest: false, summary: `Email ${id}`, ...fields,
  });
  test.each([
    ['one email: never', [email(1)], null, 'none'],
    ['two summed-up emails, none stored: due', [email(1), email(2)], null, 'due'],
    ['the stored one covers the newest: fresh', [email(1), email(2)], 2, 'fresh'],
    ['a newer email since the stored one: due', [email(1), email(2), email(3)], 2, 'due'],
    ['the newest by date, not by id', [email(1), email(3, {receivedAt: '2026-10-01T09:00:00.000Z'}), email(2)], 2, 'fresh'],
    ['an email still Unsorted: wait for it', [email(1), email(2), email(3, {sorted: false, summary: null})], 2, 'wait'],
    ['an Unsorted email that\'s trashed doesn\'t hold it', [email(1), email(2), email(3, {sorted: false, summary: null, trashed: true})], null, 'due'],
    ['the user\'s own sent mail isn\'t summed up: one email', [email(1), email(2, {received: false, sorted: false, summary: null})], null, 'none'],
    ['an email sorted without a summary (a rule, history) doesn\'t count', [email(1), email(2, {summary: null})], null, 'none'],
    ['a trashed email doesn\'t count', [email(1), email(2, {trashed: true})], null, 'none'],
    ['a USPS digest doesn\'t count, nor wait', [email(1), email(2), email(3, {uspsDigest: true, sorted: false, summary: null})], 2, 'fresh'],
    ['the newest trashed: the stored one covers an email gone', [email(1), email(2), email(3, {trashed: true})], 3, 'due'],
  ] as const)('%s', (_name, emails, covered, expected) => expect(summaryState([...emails], covered)).toBe(expected));
});

describe('what the reader\'s head shows', () => {
  const now = '2026-10-07T16:12:00.000Z';
  const ago = (ms: number) => new Date(Date.parse(now) - ms).toISOString();
  const email = (id: number, fields: Partial<SummaryEmail> = {}): SummaryEmail => ({
    id, receivedAt: `2026-10-0${id}T10:00:00.000Z`, received: true, sorted: true, trashed: false, uspsDigest: false, summary: `Email ${id}`, triagedAt: ago(60 * 60_000), ...fields,
  });
  const written = (coveredId: number, failure: StoredSummary['failure'] = null): StoredSummary => ({summary: 'The conversation', coveredId, failure});
  const failedFor = (messageId: number, status: number | null): StoredSummary => ({summary: null, coveredId: null, failure: {messageId, ...failureOf(status)}});
  const fallback = (failure: {cause: string; status: number | null} | null) => ({state: 'fallback', text: 'Email 3', email_id: 3, failure});
  const healthy = {triageDown: false, budgetSpent: false, now};
  const three = (fields: Partial<SummaryEmail> = {}) => [email(1), email(2), email(3, fields)];
  test.each([
    ['one email: none (its row\'s summary stands)', [email(1)], null, healthy, null],
    ['the summary covers the newest: fresh', three(), written(3), healthy, {state: 'fresh', text: 'The conversation'}],
    ['fresh, even with triage down', three(), written(3), {...healthy, triageDown: true}, {state: 'fresh', text: 'The conversation'}],
    ['the newest just triaged: pending', three({triagedAt: ago(60_000)}), written(2), healthy, {state: 'pending'}],
    ['the newest just triaged, none written yet: pending', three({triagedAt: ago(60_000)}), null, healthy, {state: 'pending'}],
    ['an Unsorted email waiting: pending', [...three(), email(4, {sorted: false, summary: null, triagedAt: null})], written(3), healthy, {state: 'pending'}],
    ['its call refused (429): the newest email\'s, and why', three({triagedAt: ago(60_000)}), {...written(2), failure: {messageId: 3, ...failureOf(429)}}, healthy, fallback({cause: 'limited', status: 429})],
    ['its call failed (529): down', three({triagedAt: ago(60_000)}), failedFor(3, 529), healthy, fallback({cause: 'down', status: 529})],
    ['its call refused (401)', three({triagedAt: ago(60_000)}), failedFor(3, 401), healthy, fallback({cause: 'refused', status: 401})],
    ['no answer', three({triagedAt: ago(60_000)}), failedFor(3, null), healthy, fallback({cause: 'unreachable', status: null})],
    ['an older email\'s failure doesn\'t count: pending', three({triagedAt: ago(60_000)}), failedFor(2, 429), healthy, {state: 'pending'}],
    ['triage down: the newest email\'s, triage down', three({triagedAt: ago(60_000)}), written(2), {...healthy, triageDown: true}, fallback({cause: 'triage_down', status: null})],
    ['triage down with an Unsorted email waiting', [...three(), email(4, {sorted: false, summary: null, triagedAt: null})], written(3), {...healthy, triageDown: true}, fallback({cause: 'triage_down', status: null})],
    ['the budget spent', three({triagedAt: ago(60_000)}), written(2), {...healthy, budgetSpent: true}, fallback({cause: 'budget', status: null})],
    ['no rewrite coming (triaged long ago, from before summaries): the newest email\'s, no why', three(), null, healthy, fallback(null)],
    ['pending no longer than the bound', three({triagedAt: ago(PENDING_MS)}), written(2), healthy, fallback(null)],
    ['sorted before triage kept when: no why', three({triagedAt: null}), written(2), healthy, fallback(null)],
  ] as const)('%s', (_name, emails, stored, conditions, expected) => expect(headSummary([...emails], stored, conditions)).toEqual(expected));
});

describe('triage writes a conversation\'s summary', () => {
  async function setup() {
    const fake = await fakeModels();
    const world = triageWorld(fake.endpoints);
    setSecret(world.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    const account = world.accountId('Personal');
    const deliver = (subject: string, summary: string, receivedAt: string) => {
      const id = upsertMessages(world.store, account, [world.fetched({threadId: 'thread-cabin', subject, receivedAt, fromName: 'Theo Walsh', fromAddress: 'theo@example.org'})], {backfill: false}).inserted[0]!;
      summaries.set(subject, summary);
      return id;
    };
    const summaries = new Map<string, string>();
    const conversations: FakeRequest[] = [];
    let conversationAnswer: () => FakeAnswer = () => ({tool: {summary: 'Cabin Nov 13: Theo asks if you want in'}});
    fake.answer(request => {
      if (request.model === CONVERSATION_MODEL) {
        conversations.push(request);
        return conversationAnswer();
      }
      const subject = /^Subject: (.*)$/m.exec(request.input)![1]!;
      return {tool: {
        lane: 'fyi', kind: 'people', organisation: null, via: null, type: null, key_date: null, summary: summaries.get(subject) ?? null, security: null, protected_class: null, confidence: 0.95,
      }};
    });
    const stored = () => world.store.db.select().from(t.conversationSummaries).where(and(eq(t.conversationSummaries.accountId, account), eq(t.conversationSummaries.threadId, 'thread-cabin'))).get();
    const ledger = () => world.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, 'mail_conversations')).all();
    return {world, deliver, conversations, stored, ledger, answerWith: (answer: () => FakeAnswer) => (conversationAnswer = answer)};
  }

  test('the second email writes it from the earlier summaries, oldest first; a third leaves it stale until written again', async () => {
    const {world, deliver, conversations, stored, ledger} = await setup();
    const first = deliver('Cabin weekend', 'Cabin at Lake Wenatchee Nov 13: want in?', '2026-10-01T10:00:00.000Z');
    await world.drain();
    // One email: no call, no summary.
    expect(conversations).toHaveLength(0);
    expect(conversationDetail(world.store, first).summary).toBeNull();

    const second = deliver('Re: Cabin weekend', 'About $140 each for two nights', '2026-10-02T10:00:00.000Z');
    await world.drain();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]!.input).toBe([
      'Subject: Cabin weekend',
      '',
      '2026-10-01T10:00:00.000Z · Theo Walsh · Cabin at Lake Wenatchee Nov 13: want in?',
      '2026-10-02T10:00:00.000Z · Theo Walsh · About $140 each for two nights',
    ].join('\n'));
    expect(stored()).toMatchObject({summary: 'Cabin Nov 13: Theo asks if you want in', messageId: second});
    expect(conversationDetail(world.store, first).summary).toEqual({state: 'fresh', text: 'Cabin Nov 13: Theo asks if you want in'});
    // The open conversation hears of it, under any of its emails.
    expect(liveEvents(world).at(-1)).toMatchObject({type: 'mail', conversations: [first, second]});
    // In the ledger as its own purpose, on Haiku, against the newest email it covers.
    expect(ledger().map(entry => ({model: entry.model, messageId: entry.messageId}))).toEqual([{model: 'claude-haiku-5-5', messageId: second}]);

    // A third email: being written again (the head's skeleton) while it waits in Unsorted, until it's written.
    const third = upsertMessages(world.store, world.accountId('Personal'), [world.fetched({threadId: 'thread-cabin', subject: 'Re: Cabin weekend', receivedAt: '2026-10-03T10:00:00.000Z'})], {backfill: false}).inserted[0]!;
    expect(conversationDetail(world.store, third).summary).toEqual({state: 'pending'});
    await world.drain();
    expect(conversations).toHaveLength(2);
    expect(stored()!.messageId).toBe(third);
    expect(conversationDetail(world.store, third).summary).toEqual({state: 'fresh', text: 'Cabin Nov 13: Theo asks if you want in'});
  });

  test('a refused call keeps why for the newest email, leaves triage healthy and the email sorted; the head shows that email\'s summary', async () => {
    const {world, deliver, conversations, stored, ledger, answerWith} = await setup();
    answerWith(() => ({status: 429}));
    const first = deliver('Cabin weekend', 'Cabin at Lake Wenatchee Nov 13: want in?', '2026-10-01T10:00:00.000Z');
    const second = deliver('Re: Cabin weekend', 'About $140 each for two nights', '2026-10-02T10:00:00.000Z');
    await world.drain();
    expect(conversations.length).toBeGreaterThan(0);
    expect(stored()).toMatchObject({summary: null, messageId: null, failedMessageId: second, failureCause: 'limited', failureStatus: 429});
    expect(ledger()).toEqual([]);
    expect(conversationDetail(world.store, first).summary).toEqual({state: 'fallback', text: 'About $140 each for two nights', email_id: second, failure: {cause: 'limited', status: 429}});
    expect(liveEvents(world).at(-1)).toMatchObject({type: 'mail', conversations: [first, second]});
    expect(world.message(second).lane).toBe('fyi');
    expect(world.status().state).toBe('healthy');

    // The next email's call answers: written, the failure cleared.
    answerWith(() => ({tool: {summary: 'Cabin Nov 13, $140 each'}}));
    deliver('Re: Cabin weekend', 'Bring a cooler', '2026-10-03T10:00:00.000Z');
    await world.drain();
    expect(stored()).toMatchObject({summary: 'Cabin Nov 13, $140 each', failedMessageId: null, failureCause: null, failureStatus: null});
  });

  test('a failure keeps the summary there was', async () => {
    const {world, deliver, stored, answerWith} = await setup();
    deliver('Cabin weekend', 'Cabin at Lake Wenatchee Nov 13: want in?', '2026-10-01T10:00:00.000Z');
    const second = deliver('Re: Cabin weekend', 'About $140 each for two nights', '2026-10-02T10:00:00.000Z');
    await world.drain();
    answerWith(() => 'overloaded');
    const third = deliver('Re: Cabin weekend', 'Bring a cooler', '2026-10-03T10:00:00.000Z');
    await world.drain();
    expect(stored()).toMatchObject({summary: 'Cabin Nov 13: Theo asks if you want in', messageId: second, failedMessageId: third, failureCause: 'down', failureStatus: 529});
    expect(conversationDetail(world.store, third).summary).toMatchObject({state: 'fallback', email_id: third, failure: {cause: 'down', status: 529}});
  });

  test('an answer without the tool is unusable, its call still in the ledger', async () => {
    const {world, deliver, stored, ledger, answerWith} = await setup();
    answerWith(() => 'no_tool');
    deliver('Cabin weekend', 'Cabin at Lake Wenatchee Nov 13: want in?', '2026-10-01T10:00:00.000Z');
    const second = deliver('Re: Cabin weekend', 'About $140 each for two nights', '2026-10-02T10:00:00.000Z');
    await world.drain();
    expect(stored()).toMatchObject({summary: null, failedMessageId: second, failureCause: 'unusable', failureStatus: null});
    expect(ledger()).toHaveLength(1);
    expect(conversationDetail(world.store, second).summary).toMatchObject({state: 'fallback', failure: {cause: 'unusable', status: null}});
  });

  test('while the call is out the head is pending; with no rewrite coming it gives way to the newest email\'s summary', async () => {
    const {world, deliver, stored} = await setup();
    const first = deliver('Cabin weekend', 'Cabin at Lake Wenatchee Nov 13: want in?', '2026-10-01T10:00:00.000Z');
    await world.drain();
    // Sorted now, the call not made (as if Setpoint stopped mid-call): pending for a while, then not.
    world.store.db.update(t.messages).set({lane: 'fyi', summary: 'About $140 each', triagedAt: world.store.now().toISOString()})
      .where(eq(t.messages.id, deliver('Re: Cabin weekend', 'About $140 each', '2026-10-02T10:00:00.000Z'))).run();
    world.store.db.delete(t.jobs).run();
    expect(stored()).toBeUndefined();
    expect(conversationDetail(world.store, first).summary).toEqual({state: 'pending'});
    world.advance(PENDING_MS);
    expect(conversationDetail(world.store, first).summary).toMatchObject({state: 'fallback', text: 'About $140 each', failure: null});
  });
});
