// A conversation's own summary, for the reader's head: when one is due (a table), and as triage
// writes it through the fake Anthropic after the conversation's second email, stale after a third
// until it's written again, and nothing stored when the call fails.
import {and, eq} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {summaryState} from '../src/domain/conversationSummary.ts';
import type {SummaryEmail} from '../src/domain/conversationSummary.ts';
import {conversationDetail} from '../src/queries/mail.ts';
import {setSecret} from '../src/secrets/store.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {CONVERSATION_MODEL} from '../src/triage/conversation.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
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
    expect(conversationDetail(world.store, first).summary).toBe('Cabin Nov 13: Theo asks if you want in');
    // In the ledger as its own purpose, on Haiku, against the newest email it covers.
    expect(ledger().map(entry => ({model: entry.model, messageId: entry.messageId}))).toEqual([{model: 'claude-haiku-5-5', messageId: second}]);

    // A third email: stale (the head shows its row's summary) until the next one is written.
    const third = upsertMessages(world.store, world.accountId('Personal'), [world.fetched({threadId: 'thread-cabin', subject: 'Re: Cabin weekend', receivedAt: '2026-10-03T10:00:00.000Z'})], {backfill: false}).inserted[0]!;
    expect(conversationDetail(world.store, third).summary).toBeNull();
    await world.drain();
    expect(conversations).toHaveLength(2);
    expect(stored()!.messageId).toBe(third);
    expect(conversationDetail(world.store, third).summary).toBe('Cabin Nov 13: Theo asks if you want in');
  });

  test('a failed call stores nothing, leaves triage healthy and the email sorted', async () => {
    const {world, deliver, conversations, stored, ledger, answerWith} = await setup();
    answerWith(() => 'server_error');
    deliver('Cabin weekend', 'Cabin at Lake Wenatchee Nov 13: want in?', '2026-10-01T10:00:00.000Z');
    const second = deliver('Re: Cabin weekend', 'About $140 each for two nights', '2026-10-02T10:00:00.000Z');
    await world.drain();
    expect(conversations.length).toBeGreaterThan(0);
    expect(stored()).toBeUndefined();
    expect(ledger()).toEqual([]);
    expect(conversationDetail(world.store, second).summary).toBeNull();
    expect(world.message(second).lane).toBe('fyi');
    expect(world.status().state).toBe('healthy');
  });

  test('an answer without the tool stores nothing, its call still in the ledger', async () => {
    const {world, deliver, stored, ledger, answerWith} = await setup();
    answerWith(() => 'no_tool');
    deliver('Cabin weekend', 'Cabin at Lake Wenatchee Nov 13: want in?', '2026-10-01T10:00:00.000Z');
    const second = deliver('Re: Cabin weekend', 'About $140 each for two nights', '2026-10-02T10:00:00.000Z');
    await world.drain();
    expect(stored()).toBeUndefined();
    expect(ledger()).toHaveLength(1);
    expect(conversationDetail(world.store, second).summary).toBeNull();
  });
});
