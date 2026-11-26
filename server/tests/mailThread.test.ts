// An email's conversation and whether the user replied to it: the rules as tables (the reply, where
// a conversation sits in the Inbox and what it counts, who's in it, what the reader expands), then
// the thread query over the record (the seed's four-round thread with Theo, and threads built row by
// row with headers known and not), as the Inbox, All, Sent, Snoozed, search and the reader serve
// it, and the changes to a whole conversation with their Undo.
import {searchInput} from '@setpoint/shared';
import type {InboxGroup} from '@setpoint/shared';
import {and, eq, inArray} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {confirmCommand} from '../src/commands/index.ts';
import {openConversation, setConversationDone, setConversationPinned, setConversationRead, snoozeConversation, trashConversation, undoConversation} from '../src/commands/conversation.ts';
import {setDone, setRead, snoozeMessage, trashMessage} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {conversationPlace, emailCounts, inboxCounts, inboxGroups} from '../src/domain/inbox.ts';
import type {ConversationCandidate} from '../src/domain/inbox.ts';
import {conversationPeople, expandedEmails, repliedLast, replyOf} from '../src/domain/thread.ts';
import type {ConversationEmail, ThreadEmail} from '../src/domain/thread.ts';
import {allMail, conversationDetail, inbox, mailCounts, messageDetail, messageRows, sentMail, snoozedMail} from '../src/queries/mail.ts';
import {haStatus} from '../src/queries/status.ts';
import {conversationOf} from '../src/queries/thread.ts';
import {answerSearch, searchMail} from '../src/search/search.ts';
import {createDraft, updateDraft} from '../src/sending/drafts.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {liveEvents, signedIn, world} from './helpers.ts';
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
  test('each of Theo\'s emails says when the user replied, in All, search and the reader, and its thread lists the rest oldest first', () => {
    const w = world({seed: true});
    const thread = theo(w);
    expect(thread.map(row => row.sent)).toEqual([false, true, false, true, false, true, false, true]);
    const [first, reply] = thread;

    const detail = messageDetail(w.store, first!.id);
    expect(detail).toMatchObject({replied_at: reply!.receivedAt});
    const others = conversationOf(w.store, first!);
    expect(others.map(other => [other.id, other.sent, other.from_name])).toEqual(thread.slice(1).map(row => [row.id, row.sent, row.fromName]));
    expect(others[0]).toMatchObject({received_at: reply!.receivedAt, subject: 'Re: Cabin weekend in November', excerpt: 'I\'m in. What\'s the cost per person, roughly?'});

    // All lists the conversation once, as Theo's newest email, with the reply mark at the user's last
    // reply, its newest email. No other row of All carries one.
    const allRows = allMail(w.store, {limit: 500}).days.flatMap(day => day.rows);
    const theirs = thread.filter(row => !row.sent);
    const last = thread.at(-1)!;
    expect(allRows.filter(row => row.thread?.ids.includes(first!.id)).map(row => [row.id, row.replied_at, row.thread!.ids]))
      .toEqual([[theirs.at(-1)!.id, last.receivedAt, thread.map(row => row.id)]]);
    expect(allRows.filter(row => row.replied_at !== undefined).map(row => row.id)).toEqual([theirs.at(-1)!.id]);
    // Search's rows of any of Theo's emails carry it too.
    expect([...messageRows(w.store, theirs.map(row => row.id)).values()].map(row => row.out.replied_at)).toEqual(theirs.map(() => last.receivedAt));

    // A sent email has no reply of its own, and lists the rest of the thread too.
    const sentDetail = messageDetail(w.store, reply!.id);
    expect(sentDetail.replied_at).toBeUndefined();
    expect(conversationOf(w.store, reply!).map(other => other.id)).toEqual(thread.filter(row => row.id !== reply!.id).map(row => row.id));
  });

  test('a trashed reply no longer counts, and trashed mail leaves the conversation', () => {
    const w = world({seed: true});
    const [first, reply] = theo(w);
    trashMessage(w.store, reply!.id, true);
    const detail = messageDetail(w.store, first!.id);
    expect(detail.replied_at).toBeUndefined();
    const others = conversationOf(w.store, first!);
    expect(others.map(other => other.id)).not.toContain(reply!.id);
    expect(others).toHaveLength(6);
  });

  test('an email alone has an empty conversation, and the Inbox\'s rows carry no reply mark the seed doesn\'t have', () => {
    const w = world({seed: true});
    expect(conversationOf(w.store, idOf(w, 'Dinner Friday?')[0]!)).toEqual([]);
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
    expect(conversationOf(w.store, idOf(w, 'g1')[0]!)).toEqual([]);
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
    expect(messageDetail(w.store, n1!.id)).toMatchObject({replied_at: n2!.receivedAt});
    // n3 has n4 after it before the user wrote again, so the order rule gives the reply to n4 alone.
    expect(messageDetail(w.store, n3!.id).replied_at).toBeUndefined();
    expect(messageDetail(w.store, n4!.id)).toMatchObject({replied_at: n5!.receivedAt});
    expect(conversationOf(w.store, n4!).map(other => [other.subject, other.sent])).toEqual([['n1', false], ['n2', true], ['n3', false], ['n5', true]]);
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

// ---- Conversations ----

const NOW = at(59);
/** An email that came in, in conversation `threadId` of account 1, arriving at `at(id)`. */
const candidate = (id: number, threadId: string, fields: Partial<ConversationCandidate> = {}): ConversationCandidate => ({
  id, accountId: 1, threadId, lane: 'fyi', kind: 'money', unread: true, receivedAt: at(id), organisation: null, fromName: 'Bank',
  pinnedAt: null, doneAt: null, trashedAt: null, codeExpiresAt: null, archivedAt: null, ...fields,
});

describe('where a conversation sits in the Inbox', () => {
  const cases: [string, ConversationCandidate[], [InboxGroup, number] | null][] = [
    ['an email alone sits as itself', [candidate(1, 'a')], ['money', 1]],
    ['an open Attention question stays in Attention under a newer FYI reply, which doesn\'t place it', [candidate(1, 'a', {lane: 'attention'}), candidate(2, 'a', {kind: 'people'})], ['attention', 1]],
    ['of two Attention emails, the newer places it', [candidate(1, 'a', {lane: 'attention'}), candidate(2, 'a', {lane: 'attention'})], ['attention', 2]],
    ['Unsorted outranks FYI and Noise', [candidate(1, 'a', {lane: null, kind: null}), candidate(2, 'a'), candidate(3, 'a', {lane: 'noise'})], ['unsorted', 1]],
    ['FYI goes by its newest FYI email\'s kind, not the groups\' order', [candidate(1, 'a', {kind: 'security'}), candidate(2, 'a', {kind: 'updates'})], ['updates', 2]],
    ['FYI outranks Noise', [candidate(1, 'a'), candidate(2, 'a', {lane: 'noise'})], ['money', 1]],
    ['all Done: out of the Inbox', [candidate(1, 'a', {lane: 'attention', doneAt: NOW}), candidate(2, 'a', {lane: 'attention', doneAt: NOW})], null],
    ['an email Done doesn\'t pull a later one up: it sits where triage put the later one', [candidate(1, 'a', {lane: 'attention', doneAt: NOW}), candidate(2, 'a', {lane: 'noise'})], ['noise', 2]],
    ['a read FYI email is out, so an unread Noise one places it', [candidate(1, 'a', {unread: false}), candidate(2, 'a', {lane: 'noise'})], ['noise', 2]],
    ['half snoozed: the email not snoozed places it', [candidate(1, 'a', {lane: 'attention', snoozedUntil: at(90)}), candidate(2, 'a')], ['money', 2]],
  ];
  test.each(cases)('%s', (_, emails, placed) => {
    const place = conversationPlace(emails, NOW);
    expect(place && [place.group, place.lead.id]).toEqual(placed);
  });

  test('a conversation sits once, sorted by its newest email, sent mail aside (it never comes in)', () => {
    const groups = inboxGroups([
      candidate(1, 'a', {lane: 'attention'}), candidate(4, 'a', {lane: 'attention', doneAt: NOW}),
      candidate(2, 'b', {lane: 'attention'}), candidate(3, 'b', {lane: 'attention', unread: false}),
    ], NOW);
    expect(groups.map(group => [group.group, group.rows.map(row => [row.lead.id, row.emails.map(email => email.id)]), group.unread])).toEqual([
      // a's newest email is Done, yet it came in last: a sorts first, placed by the one still open.
      ['attention', [[1, [1, 4]], [3, [2, 3]]], 2],
    ]);
  });

  test('a returned conversation sorts by its return', () => {
    const groups = inboxGroups([candidate(1, 'a', {returnedAt: at(30)}), candidate(10, 'b')], NOW);
    expect(groups[0]!.rows.map(row => row.lead.id)).toEqual([1, 10]);
  });

  test('a pinned email puts its conversation on the shelf once, as itself, and the conversation stays in its group', () => {
    const groups = inboxGroups([candidate(1, 'a', {pinnedAt: at(40)}), candidate(2, 'a'), candidate(3, 'b', {pinnedAt: at(50)})], NOW);
    expect(groups.map(group => [group.group, group.rows.map(row => row.lead.id)])).toEqual([['pinned', [3, 1]], ['money', [3, 2]]]);
  });

  test('trashed mail is left out of its conversation, unless its trash failed in place', () => {
    const groups = inboxGroups([candidate(1, 'a'), candidate(2, 'a', {trashedAt: NOW}), candidate(3, 'b'), candidate(4, 'b', {trashedAt: NOW, held: true})], NOW);
    expect(groups[0]!.rows.map(row => row.emails.map(email => email.id))).toEqual([[3, 4], [1]]);
  });
});

describe('the counts count conversations; Home Assistant\'s count emails', () => {
  const emails = [
    candidate(1, 'a', {lane: 'attention'}), candidate(2, 'a', {lane: 'attention'}), candidate(3, 'a'),
    candidate(4, 'b', {accountId: 2}), candidate(5, 'b', {accountId: 2}),
    candidate(6, 'c', {lane: 'noise', unread: false}), candidate(7, 'c', {lane: 'attention', unread: false}),
  ];
  test('Attention, unread and per account by conversation; unread FYI by email', () => {
    const counts = inboxCounts(emails, NOW);
    expect({...counts, byAccount: [...counts.byAccount]}).toEqual({attention: 2, unread: 2, unreadFyi: 3, byAccount: [[1, 1], [2, 1]]});
  });
  test('Home Assistant\'s by email', () => {
    expect(emailCounts(emails, NOW)).toEqual({attention: 3, unreadFyi: 3});
  });
});

const person = (id: number, fields: Partial<ConversationEmail> = {}): ConversationEmail => ({
  id, fromName: 'Dominic', fromAddress: 'dominic@example.org', sent: false, received: true, receivedAt: at(id), unread: false, ...fields,
});
const me = (id: number) => person(id, {fromName: 'User', fromAddress: 'user@example.com', sent: true, received: false});

describe('who\'s in a conversation, its reply mark and what the reader expands', () => {
  test.each<[string, ConversationEmail[], string[]]>([
    ['each once, oldest first, the user as me', [person(1), me(2), person(3), me(4)], ['Dominic', 'me']],
    ['by address, whatever the name', [person(1), person(2, {fromName: 'Dom'}), person(3, {fromName: 'Sara', fromAddress: 'sara@example.org'})], ['Dominic', 'Sara']],
    ['a sender with no name by their address', [person(1, {fromName: ''})], ['dominic@example.org']],
    ['mail to yourself is the user\'s', [person(1, {fromName: 'User', fromAddress: 'user@example.com', sent: true})], ['me']],
  ])('%s', (_, emails, names) => expect(conversationPeople(emails).map(one => one.name)).toEqual(names));

  test.each<[string, ConversationEmail[], number | null]>([
    ['the user\'s reply is the newest email', [person(1), me(2)], 2],
    ['someone wrote after the reply', [person(1), me(2), person(3)], null],
    ['only the user\'s mail', [me(1), me(2)], null],
  ])('reply mark: %s', (_, emails, reply) => expect(repliedLast(emails)?.id ?? null).toBe(reply));

  test.each<[string, {id: number; unread: boolean}[], number, number[]]>([
    ['first, newest and unread', [1, 2, 3, 4, 5].map(id => ({id, unread: id === 3})), 1, [1, 3, 5]],
    ['and the one it was opened at', [1, 2, 3, 4, 5].map(id => ({id, unread: false})), 2, [1, 2, 5]],
    ['an email alone', [{id: 1, unread: false}], 1, [1]],
  ])('expanded: %s', (_, emails, opened, expanded) => expect([...expandedEmails(emails, opened)].sort()).toEqual(expanded));
});

/** A conversation built in Personal: Dominic's question, the user's reply, Dominic's follow-up. */
function dominic(w: World) {
  const personal = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
  const from = {fromName: 'Dominic Reyes', fromAddress: 'dominic@example.org', unread: true};
  upsertMessages(w.store, personal, [
    fetched('d1', 'dthread', 0, {...from, subject: 'Shelf plans', snippet: 'Which shelf?'}),
    fetched('d2', 'dthread', 5, {...SENT, subject: 'Re: Shelf plans', snippet: 'The oak one.'}),
    fetched('d3', 'dthread', 10, {...from, subject: 'Re: Shelf plans', snippet: 'Great, ordering it.'}),
  ]);
  const [d1, d2, d3] = ['d1', 'd2', 'd3'].map(id => w.store.db.select().from(t.messages).where(eq(t.messages.providerId, id)).get()!);
  // The question needs the user; the follow-up is FYI.
  w.store.db.update(t.messages).set({lane: 'attention', kind: 'people', summary: 'Dominic asks which shelf.'}).where(eq(t.messages.id, d1!.id)).run();
  w.store.db.update(t.messages).set({lane: 'fyi', kind: 'people', summary: 'Dominic is ordering it.'}).where(eq(t.messages.id, d3!.id)).run();
  return {personal, d1: d1!, d2: d2!, d3: d3!, ids: [d1!.id, d2!.id, d3!.id]};
}
const rowsOf = (w: World) => inbox(w.store).groups.flatMap(group => group.rows.map(row => ({group: group.group, ...row})));
const state = (w: World, ids: number[]) => w.store.db.select({
  id: t.messages.id, doneAt: t.messages.doneAt, openedBeforeDone: t.messages.openedBeforeDone, pinnedAt: t.messages.pinnedAt, snoozedUntil: t.messages.snoozedUntil,
  returnedAt: t.messages.returnedAt, trashDueAt: t.messages.trashDueAt, unread: t.messages.unread, trashedAt: t.messages.trashedAt,
}).from(t.messages).where(inArray(t.messages.id, ids)).orderBy(t.messages.id).all();
const confirmAll = (w: World) => {
  for (const row of w.store.db.select().from(t.commands).where(eq(t.commands.state, 'pending')).all()) confirmCommand(w.store, row.id);
};

describe('the lists serve conversations', () => {
  test('the Inbox lists it once, in Attention, with the question\'s words, the newest time and who\'s in it; the counts count it once', () => {
    const w = world({seed: true});
    const {personal, d1, d3, ids} = dominic(w);
    const before = mailCounts(w.store);
    const mine = rowsOf(w).filter(row => row.thread?.ids.includes(d1.id));
    expect(mine).toEqual([expect.objectContaining({
      group: 'attention', id: d1.id, summary: 'Dominic asks which shelf.', received_at: d3.receivedAt, unread: true,
      thread: {count: 3, ids, people: [{name: 'Dominic Reyes', address: 'dominic@example.org', me: false}, {name: 'me', address: 'user@example.com', me: true}]},
    })]);
    // Someone wrote after the user's reply: no reply mark.
    expect(mine[0]!.replied_at).toBeUndefined();
    // Two unread emails, one conversation: the pill and unread go up by one, unread FYI by its one FYI email.
    w.store.db.update(t.messages).set({lane: 'noise'}).where(inArray(t.messages.id, ids)).run();
    const without = mailCounts(w.store);
    expect(before.attention - without.attention).toBe(1);
    expect(before.unread_fyi - without.unread_fyi).toBe(1);
    const account = (counts: typeof before) => counts.accounts.find(one => one.account_id === personal)!.unread;
    expect(account(before)).toBe(account(without));
  });

  test('Done takes the whole conversation out, and a later email brings it back in its own group', () => {
    const w = world({seed: true});
    const {personal, d1} = dominic(w);
    setConversationDone(w.store, d1.id, true);
    expect(rowsOf(w).some(row => row.thread?.ids.includes(d1.id))).toBe(false);
    upsertMessages(w.store, personal, [fetched('d4', 'dthread', 20, {fromName: 'Dominic Reyes', fromAddress: 'dominic@example.org', unread: true})]);
    const d4 = w.store.db.select().from(t.messages).where(eq(t.messages.providerId, 'd4')).get()!;
    expect(rowsOf(w).filter(row => row.thread?.ids.includes(d1.id)).map(row => [row.group, row.id, row.thread!.count])).toEqual([['unsorted', d4.id, 4]]);
  });

  test('All, Sent, Snoozed and search list it once', () => {
    const w = world({seed: true});
    const {d1, d2, d3} = dominic(w);
    const once = (rows: {id: number; thread?: {ids: number[]}}[]) => rows.filter(row => row.thread?.ids.includes(d1.id)).map(row => row.id);
    // All by its newest email that came in, Sent by its newest sent email, with no reply mark.
    expect(once(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows))).toEqual([d3.id]);
    const sent = sentMail(w.store, {limit: 500}).days.flatMap(day => day.rows).filter(row => row.thread?.ids.includes(d1.id));
    expect(sent.map(row => [row.id, row.received_at, row.replied_at])).toEqual([[d2.id, d2.receivedAt, undefined]]);
    // Search matches emails and lists the conversation once, as its best match.
    const found = searchMail(w.store, searchInput.parse({text: 'shelf'}), {log: false});
    expect(once(found.results)).toEqual([d3.id]);
    expect(found.total).toBe(found.results.length);
    snoozeConversation(w.store, d1.id, at(60 * 24 * 30));
    expect(once(snoozedMail(w.store).rows)).toEqual([d1.id]);
    expect(snoozedMail(w.store).rows.find(row => row.id === d1.id)!.snoozed_until).toBe(at(60 * 24 * 30));
  });

  test('All pages conversations: one never shows on two pages', () => {
    const w = world({seed: true});
    const {d1} = dominic(w);
    const pages: number[][] = [];
    let before: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const out = allMail(w.store, {limit: 3, before});
      pages.push(out.days.flatMap(day => day.rows.map(row => row.id)));
      if (!out.next_before) break;
      before = out.next_before;
    }
    const ids = pages.flat();
    expect(new Set(ids).size).toBe(ids.length);
    expect(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows.map(row => row.id))).toEqual(ids);
    expect(ids.filter(id => id === d1.id || allMail(w.store, {limit: 500}).days.flatMap(day => day.rows).find(row => row.id === id)?.thread?.ids.includes(d1.id))).toHaveLength(1);
  });

  test('Home Assistant still counts and lists emails', () => {
    const w = world({seed: true});
    const before = haStatus(w.store, 'http://localhost');
    const {ids} = dominic(w);
    // A second Attention email in the conversation: one more for Home Assistant, none for the pill.
    w.store.db.update(t.messages).set({lane: 'attention'}).where(eq(t.messages.id, ids[2]!)).run();
    const pill = mailCounts(w.store).attention;
    const after = haStatus(w.store, 'http://localhost');
    expect(after.attention - before.attention).toBe(2);
    expect(pill).toBe(before.attention + 1);
  });
});

describe('changes to a whole conversation, and their Undo', () => {
  test('Done applies to every email that came in, and Undo puts each back, one Done before and one snoozed', () => {
    const w = world({seed: true});
    const {d1, d3, ids} = dominic(w);
    setDone(w.store, d1.id, true);
    w.store.db.update(t.messages).set({openedAt: at(1)}).where(eq(t.messages.id, d3.id)).run();
    snoozeMessage(w.store, d3.id, at(60 * 24 * 30));
    const before = state(w, ids);
    const change = setConversationDone(w.store, d3.id, true);
    expect(change.undo.emails.map(email => email.id)).toEqual([d3.id]);
    expect(state(w, ids).filter(row => row.id !== ids[1]).every(row => row.doneAt !== null && row.snoozedUntil === null)).toBe(true);
    undoConversation(w.store, change.undo);
    expect(state(w, ids)).toEqual(before);
  });

  test('Pin and Snooze apply to every email that came in, and Undo puts each back', () => {
    const w = world({seed: true});
    const {d1, ids} = dominic(w);
    const before = state(w, ids);
    const pinned = setConversationPinned(w.store, d1.id, true);
    expect(inbox(w.store).groups.find(group => group.group === 'pinned')!.rows.filter(row => row.thread?.ids.includes(d1.id))).toHaveLength(1);
    expect(state(w, ids).map(row => row.pinnedAt !== null)).toEqual([true, false, true]);
    undoConversation(w.store, pinned.undo);
    expect(state(w, ids)).toEqual(before);
    const snoozed = snoozeConversation(w.store, d1.id, at(60 * 24 * 30));
    expect(state(w, ids).map(row => row.snoozedUntil)).toEqual([at(60 * 24 * 30), null, at(60 * 24 * 30)]);
    expect(rowsOf(w).some(row => row.thread?.ids.includes(d1.id))).toBe(false);
    undoConversation(w.store, snoozed.undo);
    expect(state(w, ids)).toEqual(before);
  });

  test('Mark read sends a command per unread email; Undo marks those unread again', () => {
    const w = world({seed: true});
    const {d1, ids} = dominic(w);
    const read = setConversationRead(w.store, d1.id, false);
    expect(read.commands.map(command => [command.kind, command.targetId])).toEqual([['mark_read', ids[0]], ['mark_read', ids[2]]]);
    expect(state(w, ids).map(row => row.unread)).toEqual([false, false, false]);
    confirmAll(w);
    const undone = undoConversation(w.store, read.undo);
    expect(undone.commands.map(command => [command.kind, command.targetId])).toEqual([['mark_unread', ids[0]], ['mark_unread', ids[2]]]);
    expect(state(w, ids).map(row => row.unread)).toEqual([true, false, true]);
    expect(() => setConversationRead(w.store, d1.id, true)).toThrow(/already unread/);
  });

  test('Trash takes every email, the user\'s reply included; Undo untrashes each once the trash is confirmed', () => {
    const w = world({seed: true});
    const {d1, ids} = dominic(w);
    const trashed = trashConversation(w.store, d1.id);
    expect(trashed.commands.map(command => [command.kind, command.targetId])).toEqual(ids.map(id => ['trash', id]));
    expect(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows).some(row => ids.includes(row.id))).toBe(false);
    // An untrash waits for the trash to settle, as one email's does.
    expect(() => undoConversation(w.store, trashed.undo)).toThrow(/still waiting/);
    confirmAll(w);
    expect(undoConversation(w.store, trashed.undo).commands.map(command => [command.kind, command.targetId])).toEqual(ids.map(id => ['untrash', id]));
    expect(state(w, ids).every(row => row.trashedAt === null)).toBe(true);
  });

  test('a change refused for one busy email changes none of them', () => {
    const w = world({seed: true});
    const {d1, d3, ids} = dominic(w);
    // The newest email's own Mark unread still waits for its provider.
    w.store.db.update(t.messages).set({unread: false}).where(eq(t.messages.id, d3.id)).run();
    setRead(w.store, d3.id, true);
    const before = state(w, ids);
    expect(() => trashConversation(w.store, d1.id)).toThrow(/still waiting/);
    expect(state(w, ids)).toEqual(before);
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.kind, 'trash')).all()).toEqual([]);
  });

  test('the routes take any email of the conversation, and answer the commands and the Undo', async () => {
    const w = world({seed: true});
    const {d2, ids} = dominic(w);
    const api = await signedIn(w);
    const done = await api.send('POST', `/api/mail/conversations/${d2.id}/done`, {body: {done: true}});
    expect(done.status).toBe(200);
    expect(done.body).toEqual({commands: [], undo: {emails: [expect.objectContaining({id: ids[0], done_at: null}), expect.objectContaining({id: ids[2], done_at: null})], read: [], trashed: []}});
    expect((await api.send('POST', '/api/mail/conversations/undo', {body: done.body.undo})).status).toBe(200);
    expect(state(w, ids).every(row => row.doneAt === null)).toBe(true);
    const read = await api.send('POST', `/api/mail/conversations/${d2.id}/read`, {body: {unread: false}});
    expect(read.body.commands.map((command: {kind: string; target_id: number}) => [command.kind, command.target_id])).toEqual([['mark_read', ids[0]], ['mark_read', ids[2]]]);
    expect((await api.send('POST', `/api/mail/conversations/${d2.id}/snooze`, {body: {until: '2026-11-01T09:00:00Z'}})).status).toBe(200);
    expect((await api.send('POST', `/api/mail/conversations/${d2.id}/unsnooze`)).status).toBe(200);
    expect((await api.send('POST', `/api/mail/conversations/${d2.id}/unsnooze`)).status).toBe(409);
    expect((await api.send('POST', `/api/mail/conversations/${d2.id}/pin`, {body: {pinned: true}})).status).toBe(200);
    // A change waits while another of its emails' changes is still with the provider.
    expect((await api.send('POST', `/api/mail/conversations/${d2.id}/trash`)).status).toBe(409);
    confirmAll(w);
    expect((await api.send('POST', `/api/mail/conversations/${d2.id}/trash`)).body.commands).toHaveLength(3);
    expect((await api.send('POST', '/api/mail/conversations/999999/done', {body: {done: true}})).status).toBe(404);
  });
});

describe('the reader\'s conversation', () => {
  test('every email oldest first, the first, newest and unread expanded, with each one\'s line, and the draft that answers one', () => {
    const w = world({seed: true});
    const {d1, d2, d3, ids} = dominic(w);
    w.store.db.update(t.messages).set({unread: false}).where(eq(t.messages.id, d3.id)).run();
    const draft = createDraft(w.store, {kind: 'reply', message_id: d3.id});
    updateDraft(w.store, draft.id, {body: [{type: 'paragraph', runs: [{text: 'Thanks!', marks: [], href: null}]}]});
    const out = conversationDetail(w.store, d2.id);
    expect(out).toMatchObject({thread_id: 'dthread', subject: 'Shelf plans', opened_id: d2.id, draft: {id: draft.id, message_id: d3.id}});
    expect(out.emails.map(email => [email.id, email.expanded, email.excerpt])).toEqual([
      [d1.id, true, 'Which shelf?'], [d2.id, true, 'The oak one.'], [d3.id, true, 'Great, ordering it.'],
    ]);
    expect(out.emails.every(email => email.body_text !== undefined)).toBe(true);
    expect(out.row).toMatchObject({id: d2.id, unread: true, draft: true, thread: {ids}});
  });

  test('opening marks each email read and still expands those that were unread; a trashed email is left out', async () => {
    const w = world({seed: true});
    const {d1, d2, d3, personal} = dominic(w);
    upsertMessages(w.store, personal, [fetched('d4', 'dthread', 15), fetched('d5', 'dthread', 18)]);
    const [d4, d5] = ['d4', 'd5'].map(id => w.store.db.select().from(t.messages).where(eq(t.messages.providerId, id)).get()!);
    trashMessage(w.store, d4!.id, true);
    confirmAll(w);
    const api = await signedIn(w);
    const opened = await api.send('POST', `/api/mail/conversations/${d1.id}/open`);
    expect(opened.body.emails.map((email: {id: number; expanded: boolean; unread: boolean}) => [email.id, email.expanded, email.unread]))
      .toEqual([[d1.id, true, false], [d2.id, false, false], [d3.id, true, false], [d5!.id, true, false]]);
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.kind, 'open')).all().map(command => command.targetId).sort()).toEqual([d1.id, d3.id].sort());
    // Read again, it expands only the first and the newest.
    expect((await api.send('GET', `/api/mail/conversations/${d1.id}`)).body.emails.map((email: {expanded: boolean}) => email.expanded)).toEqual([true, false, false, true]);
    expect(openConversation(w.store, d1.id).size).toBe(0);
  });

  test('opening leaves an email whose own change still waits as it is, and opens the rest', async () => {
    const w = world({seed: true});
    const {d1, d3} = dominic(w);
    w.store.db.update(t.messages).set({unread: false}).where(eq(t.messages.id, d3.id)).run();
    setRead(w.store, d3.id, true);
    const api = await signedIn(w);
    expect((await api.send('POST', `/api/mail/conversations/${d1.id}/open`)).status).toBe(200);
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.kind, 'open')).all().map(command => command.targetId)).toEqual([d1.id]);
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.id, d3.id)).get()!.unread).toBe(true);
  });
});

describe('search lists each conversation once', () => {
  test('as its best match, with the total, the first section and the pages counted in conversations', () => {
    const w = world({seed: true});
    const {d1, d3} = dominic(w);
    const [a, b] = w.store.db.select({id: t.messages.id}).from(t.messages).where(eq(t.messages.subject, 'Bill is ready')).all()
      .concat(w.store.db.select({id: t.messages.id}).from(t.messages).where(eq(t.messages.subject, 'Your recovery email was changed')).all()).map(row => row.id);
    const matches = {chips: [], operators: [], text: 'x', terms: [], order: 'match' as const, partial: false, ids: [d3.id, a!, d1.id, b!], first: 3, readingTypes: false};
    const page = (offset: number) => answerSearch(w.store, searchInput.parse({text: 'x', offset, limit: 2}), matches, null, null);
    expect(page(0)).toMatchObject({total: 3, first_section: 2, next_offset: 2});
    expect(page(0).results.map(result => result.id)).toEqual([d3.id, a]);
    expect(page(2).results.map(result => result.id)).toEqual([b]);
    expect(page(2).next_offset).toBeNull();
  });
});
