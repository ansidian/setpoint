// An email's conversation and whether the user replied to it: the rule as a table, then the thread
// query over the record (the seed's four-round thread with Theo, and threads built row by row with
// headers known and not), as the Inbox, All, search and the reader serve it.
import {and, eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {trashMessage} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {replyOf} from '../src/domain/thread.ts';
import type {ThreadEmail} from '../src/domain/thread.ts';
import {allMail, inbox, messageDetail, messageRows} from '../src/queries/mail.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {liveEvents, world} from './helpers.ts';
import type {World} from './helpers.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 12, minute)).toISOString();
const email = (id: number, minute: number, fields: Partial<ThreadEmail> = {}): ThreadEmail => ({
  id, receivedAt: at(minute), sent: false, received: true, rfc822Id: `<${id}@example.org>`, inReplyTo: null, referenceIds: [], ...fields,
});
const sent = (id: number, minute: number, fields: Partial<ThreadEmail> = {}) => email(id, minute, {sent: true, received: false, ...fields});
const unknown = {inReplyTo: null, referenceIds: null};

describe('which sent email answers an email', () => {
  const cases: [string, ThreadEmail, ThreadEmail[], number | null][] = [
    ['In-Reply-To names it', email(1, 0), [sent(2, 5, {inReplyTo: '<1@example.org>'})], 2],
    ['In-Reply-To names another email of the thread', email(1, 0), [email(2, 3), sent(3, 5, {inReplyTo: '<2@example.org>'})], null],
    ['the earliest of two that name it', email(1, 0), [sent(3, 9, {inReplyTo: '<1@example.org>'}), sent(2, 5, {inReplyTo: '<1@example.org>'})], 2],
    ['the last of References names it, with no In-Reply-To', email(1, 0), [sent(2, 5, {referenceIds: ['<0@example.org>', '<1@example.org>']})], 2],
    ['References name it, but not last', email(1, 0), [sent(2, 5, {referenceIds: ['<1@example.org>', '<9@example.org>']})], null],
    ['headers unknown: the next sent email, nothing between', email(1, 0), [sent(2, 5, unknown)], 2],
    ['headers unknown: another email came between', email(1, 0), [email(2, 3, unknown), sent(3, 5, unknown)], null],
    ['headers unknown on the email, known-none on the reply: by order', email(1, 0, {rfc822Id: null}), [sent(2, 5)], 2],
    ['a reply before it is not its reply', email(1, 10), [sent(2, 5, unknown)], null],
    ['received mail is never a reply', email(1, 0), [email(2, 5, unknown)], null],
    ['an email the user only sent is never answered', sent(1, 0), [sent(2, 5, unknown)], null],
    ['mail to yourself is not its own reply', email(1, 0, {sent: true}), [], null],
    ['mail to yourself answers an earlier email', email(1, 0), [email(2, 5, {sent: true, inReplyTo: '<1@example.org>'})], 2],
    ['the same minute: the later id', email(1, 5), [sent(2, 5, unknown)], 2],
  ];
  test.each(cases)('%s', (_, answered, thread, reply) => {
    expect(replyOf(answered, [answered, ...thread])?.id ?? null).toBe(reply);
  });
});

const idOf = (w: World, subject: string, from?: string) =>
  w.store.db.select().from(t.messages).where(from ? and(eq(t.messages.subject, subject), eq(t.messages.fromName, from)) : eq(t.messages.subject, subject)).all();
const theo = (w: World) => w.store.db.select().from(t.messages).where(eq(t.messages.threadId, 'seed-thread-cabin')).orderBy(t.messages.receivedAt).all();

describe('the seed\'s conversation with Theo', () => {
  test('each of Theo\'s emails says when the user replied, in All, search and the reader, and the reader lists the rest oldest first', () => {
    const w = world({seed: true});
    const thread = theo(w);
    expect(thread.map(row => row.sent)).toEqual([false, true, false, true, false, true, false, true]);
    const [first, reply] = thread;

    const detail = messageDetail(w.store, first!.id);
    expect(detail).toMatchObject({replied_at: reply!.receivedAt, reply_id: reply!.id});
    expect(detail.conversation!.map(other => [other.id, other.sent, other.from_name])).toEqual(thread.slice(1).map(row => [row.id, row.sent, row.fromName]));
    expect(detail.conversation![0]).toMatchObject({received_at: reply!.receivedAt, subject: 'Re: Cabin weekend in November', excerpt: 'I\'m in. What\'s the cost per person, roughly?'});

    const allRows = allMail(w.store, {limit: 500}).days.flatMap(day => day.rows);
    const theirs = thread.filter(row => !row.sent);
    expect(theirs.map(row => allRows.find(one => one.id === row.id)!.replied_at)).toEqual(theirs.map(row => thread[thread.indexOf(row) + 1]!.receivedAt));
    // Every other email of All is left as it was: no reply mark.
    expect(allRows.filter(row => row.replied_at !== undefined).map(row => row.id)).toEqual(theirs.map(row => row.id).reverse());
    expect([...messageRows(w.store, theirs.map(row => row.id)).values()].every(row => row.out.replied_at)).toBe(true);

    // A sent email has no reply of its own, and lists the rest of the thread too.
    const sentDetail = messageDetail(w.store, reply!.id);
    expect(sentDetail.replied_at).toBeUndefined();
    expect(sentDetail.reply_id).toBeUndefined();
    expect(sentDetail.conversation!.map(other => other.id)).toEqual(thread.filter(row => row.id !== reply!.id).map(row => row.id));
  });

  test('a trashed reply no longer counts, and trashed mail leaves the conversation', () => {
    const w = world({seed: true});
    const [first, reply] = theo(w);
    trashMessage(w.store, reply!.id, true);
    const detail = messageDetail(w.store, first!.id);
    expect(detail.replied_at).toBeUndefined();
    expect(detail.conversation!.map(other => other.id)).not.toContain(reply!.id);
    expect(detail.conversation).toHaveLength(6);
  });

  test('an email alone has an empty conversation, and the Inbox\'s rows carry no reply mark the seed doesn\'t have', () => {
    const w = world({seed: true});
    expect(messageDetail(w.store, idOf(w, 'Dinner Friday?')[0]!.id).conversation).toEqual([]);
    expect(inbox(w.store).groups.flatMap(group => group.rows).some(row => row.replied_at)).toBe(false);
  });
});

const fetched = (providerId: string, threadId: string, minute: number, changes: Partial<FetchedMessage> = {}): FetchedMessage => ({
  providerId, threadId, rfc822Id: `<${providerId}@example.org>`, fromName: 'Sam Ortiz', fromAddress: 'sam@fabrikam.example.com', subject: providerId, snippet: providerId,
  bodyText: providerId, bodyHtml: null, receivedAt: at(minute), senderAuth: null, attachments: [], unread: false, trashed: false, archived: false, ...changes,
});
const headers = (inReplyTo: string | null, references: string[] = inReplyTo ? [inReplyTo] : []) => ({recipients: {to: [], cc: [], replyTo: [], references, inReplyTo}});
const SENT = {sent: true, received: false, fromName: 'User', fromAddress: 'user@example.com'};

describe('threads in the record', () => {
  test('Gmail\'s thread id: a reply in the same thread of another account is not this email\'s', () => {
    const w = world({seed: true});
    const [personal, work] = ['Personal', 'Work'].map(label => w.store.db.select().from(t.accounts).where(eq(t.accounts.label, label)).get()!.id);
    upsertMessages(w.store, personal!, [fetched('g1', 'gthread', 0, headers(null))]);
    upsertMessages(w.store, work!, [fetched('g2', 'gthread', 5, {...SENT, ...headers('<g1@example.org>')})]);
    const id = idOf(w, 'g1')[0]!.id;
    expect(messageDetail(w.store, id)).toMatchObject({conversation: []});
    expect(messageDetail(w.store, id).replied_at).toBeUndefined();
  });

  test('headers not read yet: the thread still lists, and the reply goes by order', () => {
    const w = world({seed: true});
    const personal = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    upsertMessages(w.store, personal, [
      fetched('n1', 'nthread', 0), fetched('n2', 'nthread', 5, SENT), fetched('n3', 'nthread', 10), fetched('n4', 'nthread', 12), fetched('n5', 'nthread', 20, SENT),
    ]);
    const [n1, n2, n3, n4, n5] = ['n1', 'n2', 'n3', 'n4', 'n5'].map(subject => idOf(w, subject)[0]!);
    for (const row of [n1, n2, n3, n4, n5]) expect(row!.inReplyTo).toBeNull();
    expect(messageDetail(w.store, n1!.id)).toMatchObject({reply_id: n2!.id, replied_at: n2!.receivedAt});
    // n3 has n4 after it before the user wrote again, so the order rule gives the reply to n4 alone.
    expect(messageDetail(w.store, n3!.id).replied_at).toBeUndefined();
    expect(messageDetail(w.store, n4!.id)).toMatchObject({reply_id: n5!.id});
    expect(messageDetail(w.store, n4!.id).conversation!.map(other => [other.subject, other.sent])).toEqual([['n1', false], ['n2', true], ['n3', false], ['n5', true]]);
  });

  test('a reply that arrives names the email it answers in its live event, so an open reader shows the line', () => {
    const w = world({seed: true});
    const personal = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    upsertMessages(w.store, personal, [fetched('l1', 'lthread', 0)]);
    const asked = idOf(w, 'l1')[0]!.id;
    upsertMessages(w.store, personal, [fetched('l2', 'lthread', 5, {...SENT, ...headers('<l1@example.org>')})]);
    const last = liveEvents(w).at(-1)!;
    expect(last.type === 'mail' && last.messages).toEqual(expect.arrayContaining([asked, idOf(w, 'l2')[0]!.id]));
  });
});
