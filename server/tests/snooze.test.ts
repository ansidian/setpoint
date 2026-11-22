// An email's snooze: the Inbox's rules for snoozed and returned mail as tables, then Snooze,
// Unsnooze and the minute pass's return over the seed with the clock held, and the routes. A new
// email in a snoozed one's thread is woken at Gmail's fake boundary in gmail.test.ts.
import {and, eq, isNull} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {confirmCommand} from '../src/commands/index.ts';
import {markAllRead, setDone, setPinned, setRead, snoozeMessage, trashMessage, unsnoozeMessage} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {inboxGroups, laneGroup, markAllReadTargets} from '../src/domain/inbox.ts';
import type {InboxCandidate} from '../src/domain/inbox.ts';
import {Notifier} from '../src/notify/index.ts';
import {allMail, inbox, mailCounts, messageDetail, snoozedMail} from '../src/queries/mail.ts';
import {updateSettings} from '../src/settings.ts';
import {RuleTrashScheduler} from '../src/triage/ruleTrash.ts';
import {SnoozeScheduler} from '../src/triage/snooze.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {fakeNtfy} from './fakeNtfy.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const NOW = '2026-10-07T16:00:00.000Z';
const LATER = '2026-10-08T16:00:00.000Z';
const candidate = (fields: Partial<InboxCandidate> = {}): InboxCandidate => ({
  id: 1, accountId: 1, lane: 'fyi', kind: 'money', unread: true, receivedAt: '2026-10-06T09:00:00.000Z', organisation: null, fromName: 'Bank',
  pinnedAt: null, doneAt: null, trashedAt: null, codeExpiresAt: null, archivedAt: null, ...fields,
});

describe('the Inbox\'s rules for snoozed mail', () => {
  const cases: [string, Partial<InboxCandidate>, string | null][] = [
    ['unread FYI, snoozed: out of the Inbox', {snoozedUntil: LATER}, null],
    ['Attention, snoozed: out, though Attention stays until Done', {lane: 'attention', snoozedUntil: LATER}, null],
    ['Unsorted, snoozed: out', {lane: null, kind: null, snoozedUntil: LATER}, null],
    ['its time passed but not yet returned: still out, the return is one change', {snoozedUntil: '2026-10-07T15:00:00.000Z'}, null],
    ['snoozed with a change failed in place: held where it was', {snoozedUntil: LATER, held: true}, 'money'],
    ['returned unread FYI: back in its group', {returnedAt: '2026-10-07T15:00:00.000Z'}, 'money'],
    ['returned, then read: an FYI email out as any read one', {returnedAt: '2026-10-07T15:00:00.000Z', unread: false}, null],
    ['returned Noise: in Noise', {lane: 'noise', kind: 'updates', returnedAt: '2026-10-07T15:00:00.000Z'}, 'noise'],
  ];
  test.each(cases)('%s', (_, fields, group) => expect(laneGroup(candidate(fields), NOW)).toBe(group));

  test.each([
    ['a returned email tops its group by its return, though it arrived first', [
      candidate({id: 1, receivedAt: '2026-10-01T09:00:00.000Z', returnedAt: '2026-10-07T15:00:00.000Z'}),
      candidate({id: 2, receivedAt: '2026-10-07T12:00:00.000Z'}),
    ], [1, 2]],
    ['an email that arrived after the return tops it', [
      candidate({id: 1, receivedAt: '2026-10-01T09:00:00.000Z', returnedAt: '2026-10-07T15:00:00.000Z'}),
      candidate({id: 2, receivedAt: '2026-10-07T15:30:00.000Z'}),
    ], [2, 1]],
  ] as const)('%s', (_, messages, order) => {
    expect(inboxGroups([...messages], NOW).find(group => group.group === 'money')!.rows.map(row => row.id)).toEqual(order);
  });

  test('a snoozed pinned email is off the Pinned shelf too, and back on it once unsnoozed', () => {
    const pinned = candidate({pinnedAt: '2026-10-05T09:00:00.000Z', snoozedUntil: LATER});
    expect(inboxGroups([pinned], NOW)).toEqual([]);
    expect(inboxGroups([{...pinned, snoozedUntil: null}], NOW).map(group => group.group)).toEqual(['pinned', 'money']);
  });

  test('Mark all as read leaves snoozed mail as it is', () => {
    expect(markAllReadTargets([candidate({id: 1}), candidate({id: 2, snoozedUntil: LATER})]).map(row => row.id)).toEqual([1]);
  });
});

const rowOf = (w: World, id: number) => w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!;
const idOf = (w: World, subject: string) => w.store.db.select({id: t.messages.id}).from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;
const inInbox = (w: World, id: number) => inbox(w.store).groups.some(group => group.rows.some(row => row.id === id));
const groupOf = (w: World, id: number) => inbox(w.store).groups.find(group => group.group !== 'pinned' && group.rows.some(row => row.id === id));
const later = (w: World, ms: number) => new Date(w.store.now().getTime() + ms).toISOString();
const HOUR = 3_600_000;

/** A seed email by lane and read state, in the Inbox's world: received, kept, not Done or pinned. */
function seedEmail(w: World, lane: 'attention' | 'fyi' | 'noise', unread: boolean) {
  return w.store.db.select().from(t.messages).where(and(eq(t.messages.lane, lane), eq(t.messages.unread, unread), eq(t.messages.received, true), eq(t.messages.uspsDigest, false),
    isNull(t.messages.doneAt), isNull(t.messages.trashedAt), isNull(t.messages.archivedAt), isNull(t.messages.pinnedAt), isNull(t.messages.codeExpiresAt))).orderBy(t.messages.id).get()!;
}

async function setUp() {
  const w = world({seed: true});
  const ntfy = await fakeNtfy();
  updateSettings(w.store, {notifications: {ntfy_server: ntfy.url, attention_mail: true, fyi_mail: true}});
  const pass = new SnoozeScheduler({store: w.store, notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'})});
  return {w, ntfy, pass};
}

describe('Snooze and Unsnooze', () => {
  test('a snoozed email leaves the Inbox and its counts, and All, an email and the Snoozed list mark it snoozed', () => {
    const w = world({seed: true});
    const bill = idOf(w, 'Bill is ready');
    const counts = mailCounts(w.store);
    const until = later(w, 2 * HOUR);
    snoozeMessage(w.store, bill, until);
    expect(inInbox(w, bill)).toBe(false);
    expect(mailCounts(w.store)).toMatchObject({unread: counts.unread - 1, unread_fyi: counts.unread_fyi - 1});
    expect(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows).find(row => row.id === bill)).toMatchObject({snoozed_until: until});
    expect(messageDetail(w.store, bill)).toMatchObject({snoozed_until: until, unread: true});
    expect(snoozedMail(w.store).rows.map(row => [row.id, row.snoozed_until])).toEqual([[bill, until]]);
    // Nothing else carries the keys.
    expect(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows).filter(row => row.snoozed_until || row.returned_at).map(row => row.id)).toEqual([bill]);
  });

  test('the Snoozed list runs soonest return first, and leaves trashed mail out', () => {
    const w = world({seed: true});
    const [first, second, third] = ['Bill is ready', 'Statement ready', 'Out for delivery'].map(subject => idOf(w, subject));
    snoozeMessage(w.store, first!, later(w, 3 * HOUR));
    snoozeMessage(w.store, second!, later(w, HOUR));
    snoozeMessage(w.store, third!, later(w, 2 * HOUR));
    expect(snoozedMail(w.store).rows.map(row => row.id)).toEqual([second, third, first]);
    trashMessage(w.store, third!, true);
    expect(snoozedMail(w.store).rows.map(row => row.id)).toEqual([second, first]);
  });

  test.each([
    ['a time already past', -1000, /in the future/],
    ['now', 0, /in the future/],
  ])('Snooze refuses %s', (_, ms, error) => {
    const w = world({seed: true});
    expect(() => snoozeMessage(w.store, idOf(w, 'Bill is ready'), later(w, ms))).toThrow(error);
  });

  test('Snooze refuses a trashed email, and Unsnooze one that isn\'t snoozed', () => {
    const w = world({seed: true});
    const bill = idOf(w, 'Bill is ready');
    expect(() => unsnoozeMessage(w.store, bill)).toThrow(/isn't snoozed/);
    trashMessage(w.store, bill, true);
    expect(() => snoozeMessage(w.store, bill, later(w, HOUR))).toThrow(/in the trash/);
  });

  test('Mark all as read leaves a snoozed email unread', () => {
    const w = world({seed: true});
    const bill = idOf(w, 'Bill is ready');
    snoozeMessage(w.store, bill, later(w, HOUR));
    markAllRead(w.store);
    expect(rowOf(w, bill).unread).toBe(true);
  });

  test('Unsnooze puts it back as it was: no return mark, no notification, no change at its provider', async () => {
    const {w, ntfy, pass} = await setUp();
    const read = seedEmail(w, 'attention', false);
    snoozeMessage(w.store, read.id, later(w, HOUR));
    unsnoozeMessage(w.store, read.id);
    await pass.tick();
    expect(rowOf(w, read.id)).toMatchObject({snoozedUntil: null, returnedAt: null, unread: false});
    expect(groupOf(w, read.id)?.group).toBe('attention');
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.targetId, read.id)).all()).toEqual([]);
    expect(ntfy.published).toEqual([]);
  });
});

describe('the return', () => {
  test('at its time a read email returns as new: unread through the user\'s own Mark unread, at the top of its group, its arrival kept, and it notifies once', async () => {
    const {w, ntfy, pass} = await setUp();
    const read = seedEmail(w, 'fyi', false);
    snoozeMessage(w.store, read.id, later(w, HOUR));
    w.advance(HOUR - 1000);
    await pass.tick();
    expect(rowOf(w, read.id).snoozedUntil).not.toBeNull();
    expect(ntfy.published).toEqual([]);

    w.advance(1000);
    await pass.tick();
    const returnedAt = w.store.now().toISOString();
    expect(rowOf(w, read.id)).toMatchObject({snoozedUntil: null, returnedAt, unread: true, receivedAt: read.receivedAt});
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.targetId, read.id)).all())
      .toEqual([expect.objectContaining({kind: 'mark_unread', state: 'pending', payload: expect.objectContaining({message_id: read.id, unread: true, snooze: true})})]);
    const group = groupOf(w, read.id)!;
    expect(group.rows[0]).toMatchObject({id: read.id, unread: true, received_at: read.receivedAt, returned_at: returnedAt});
    expect(snoozedMail(w.store).rows).toEqual([]);
    expect(ntfy.published.map(message => [message.body.topic, message.body.title, message.body.message, message.body.click])).toEqual([
      ['setpoint-mail', read.fromName || read.fromAddress, `Back from snooze · ${read.subject}`, `https://setpoint.example.com/inbox/${read.id}`],
    ]);
    await pass.tick();
    expect(ntfy.published).toHaveLength(1);
  });

  test('an unread email returns with no change at its provider', async () => {
    const {w, pass} = await setUp();
    const bill = idOf(w, 'Bill is ready');
    snoozeMessage(w.store, bill, later(w, HOUR));
    w.advance(HOUR);
    await pass.tick();
    expect(rowOf(w, bill)).toMatchObject({snoozedUntil: null, unread: true, returnedAt: w.store.now().toISOString()});
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.targetId, bill)).all()).toEqual([]);
  });

  test('a restart returns everything that fell due while the server was down', async () => {
    const {w} = await setUp();
    const bill = idOf(w, 'Bill is ready');
    snoozeMessage(w.store, bill, later(w, HOUR));
    w.advance(3 * 86_400_000);
    await new SnoozeScheduler({store: w.store}).tick();
    expect(inInbox(w, bill)).toBe(true);
  });

  test('a Done email returns out of Done, back in Attention', async () => {
    const {w, pass} = await setUp();
    const read = seedEmail(w, 'attention', false);
    setDone(w.store, read.id, true);
    snoozeMessage(w.store, read.id, later(w, HOUR));
    w.advance(HOUR);
    await pass.tick();
    expect(rowOf(w, read.id)).toMatchObject({doneAt: null, openedBeforeDone: null});
    expect(groupOf(w, read.id)?.group).toBe('attention');
  });

  test('one with a change of its own waiting stays due, and returns on the pass after it settles', async () => {
    const {w, pass} = await setUp();
    const bill = idOf(w, 'Bill is ready');
    const read = setRead(w.store, bill, false);
    snoozeMessage(w.store, bill, later(w, HOUR));
    w.advance(HOUR);
    await pass.tick();
    expect(rowOf(w, bill).snoozedUntil).not.toBeNull();
    confirmCommand(w.store, read.id);
    await pass.tick();
    expect(rowOf(w, bill)).toMatchObject({snoozedUntil: null, unread: true});
  });

  test('a pinned email returns to the shelf and its group', async () => {
    const {w, pass} = await setUp();
    const bill = idOf(w, 'Bill is ready');
    setPinned(w.store, bill, true);
    snoozeMessage(w.store, bill, later(w, HOUR));
    expect(inbox(w.store).groups[0]!.rows.map(row => row.id)).not.toContain(bill);
    w.advance(HOUR);
    await pass.tick();
    expect(inbox(w.store).groups[0]!.rows.map(row => row.id)).toContain(bill);
  });

  test('one trashed while snoozed just loses its snooze, quietly', async () => {
    const {w, ntfy, pass} = await setUp();
    const bill = idOf(w, 'Bill is ready');
    snoozeMessage(w.store, bill, later(w, HOUR));
    trashMessage(w.store, bill, true);
    w.advance(HOUR);
    await pass.tick();
    expect(rowOf(w, bill)).toMatchObject({snoozedUntil: null, returnedAt: null});
    expect(ntfy.published).toEqual([]);
  });

  test('a waiting trash, a rule\'s or a code\'s, never takes a snoozed email: snoozing cancels it, and it returns', async () => {
    const {w, pass} = await setUp();
    const bill = idOf(w, 'Bill is ready');
    w.store.db.update(t.messages).set({trashDueAt: later(w, HOUR)}).where(eq(t.messages.id, bill)).run();
    snoozeMessage(w.store, bill, later(w, 2 * HOUR));
    const trash = new RuleTrashScheduler({store: w.store});
    w.advance(HOUR);
    await trash.tick();
    w.advance(HOUR);
    await trash.tick();
    await pass.tick();
    expect(rowOf(w, bill)).toMatchObject({trashedAt: null, trashDueAt: null, snoozedUntil: null});
    expect(groupOf(w, bill)?.group).toBe('money');
  });

  test.each([
    ['Attention, with Attention mail on', 'attention', {}, 1],
    ['Attention, with Attention mail off', 'attention', {attention_mail: false}, 0],
    ['FYI, with FYI mail on', 'fyi', {}, 1],
    ['FYI, with FYI mail off', 'fyi', {fyi_mail: false}, 0],
    ['Noise, every switch on', 'noise', {}, 0],
  ] as const)('a return notifies as an arrival would: %s', async (_, lane, switches, sent) => {
    const {w, ntfy, pass} = await setUp();
    updateSettings(w.store, {notifications: switches});
    const email = seedEmail(w, lane, false);
    snoozeMessage(w.store, email.id, later(w, HOUR));
    w.advance(HOUR);
    await pass.tick();
    expect(rowOf(w, email.id).returnedAt).not.toBeNull();
    expect(ntfy.published).toHaveLength(sent);
  });

  test('a return not notified within the hour, or read first, stays quiet', async () => {
    const {w, ntfy, pass} = await setUp();
    const [bill, statement] = ['Bill is ready', 'Statement ready'].map(subject => idOf(w, subject));
    for (const id of [bill!, statement!]) snoozeMessage(w.store, id, later(w, HOUR));
    w.advance(HOUR);
    // Returned by a pass with no notifier, as if its notification never went.
    await new SnoozeScheduler({store: w.store}).tick();
    setRead(w.store, statement!, false);
    await pass.tick();
    expect(ntfy.published.map(message => message.body.message)).toEqual(['Back from snooze · Bill is ready']);
    snoozeMessage(w.store, bill!, later(w, HOUR));
    w.advance(HOUR);
    await new SnoozeScheduler({store: w.store}).tick();
    w.advance(HOUR + 1000);
    await pass.tick();
    expect(ntfy.published).toHaveLength(1);
  });

  test('snoozed again after a return, it notifies again on its next return', async () => {
    const {w, ntfy, pass} = await setUp();
    const bill = idOf(w, 'Bill is ready');
    snoozeMessage(w.store, bill, later(w, HOUR));
    w.advance(HOUR);
    await pass.tick();
    snoozeMessage(w.store, bill, later(w, HOUR));
    expect(rowOf(w, bill).returnedAt).toBeNull();
    w.advance(HOUR);
    await pass.tick();
    expect(ntfy.published).toHaveLength(2);
  });
});

describe('a new email in its thread, in the record', () => {
  const fetched = (providerId: string, threadId: string, changes: Partial<FetchedMessage> = {}): FetchedMessage => ({
    providerId, threadId, rfc822Id: `<${providerId}@example.org>`, fromName: 'Sam Ortiz', fromAddress: 'sam@fabrikam.example.com', subject: providerId, snippet: providerId,
    bodyText: providerId, bodyHtml: null, receivedAt: '2026-10-07T15:00:00.000Z', senderAuth: null, attachments: [], unread: true, trashed: false, archived: false, ...changes,
  });
  const snoozedInThread = () => {
    const w = world({seed: true});
    const bill = rowOf(w, idOf(w, 'Bill is ready'));
    snoozeMessage(w.store, bill.id, later(w, 3 * 86_400_000));
    return {w, bill};
  };

  test('one with a change of its own waiting is made due now, and the next pass returns it', async () => {
    const {w, bill} = snoozedInThread();
    const read = setRead(w.store, bill.id, false);
    upsertMessages(w.store, bill.accountId, [fetched('reply-1', bill.threadId)]);
    expect(rowOf(w, bill.id).snoozedUntil).toBe(w.store.now().toISOString());
    confirmCommand(w.store, read.id);
    w.advance(60_000);
    await new SnoozeScheduler({store: w.store}).tick();
    expect(rowOf(w, bill.id)).toMatchObject({snoozedUntil: null, unread: true, returnedAt: w.store.now().toISOString()});
  });

  test.each([
    ['backfilled history in its thread', {backfill: true}, {}],
    ['mail the user sent in its thread', {}, {sent: true, received: false, fromName: 'User', fromAddress: 'user@example.com'}],
  ] as const)('%s leaves it snoozed', (_, options, changes) => {
    const {w, bill} = snoozedInThread();
    upsertMessages(w.store, bill.accountId, [fetched('other-1', bill.threadId, changes)], options);
    expect(rowOf(w, bill.id).snoozedUntil).not.toBeNull();
  });

  test('the same thread id in another account leaves it snoozed', () => {
    const {w, bill} = snoozedInThread();
    const other = w.store.db.select().from(t.accounts).all().find(account => account.id !== bill.accountId)!;
    upsertMessages(w.store, other.id, [fetched('other-2', bill.threadId)]);
    expect(rowOf(w, bill.id).snoozedUntil).not.toBeNull();
  });
});

describe('the routes', () => {
  test('Snooze, the Snoozed list and Unsnooze, each answering the email', async () => {
    const w = world({seed: true});
    const api = await signedIn(w);
    const bill = idOf(w, 'Bill is ready');
    const until = '2026-10-09T16:00:00.000Z';
    const snoozed = await api.send('POST', `/api/mail/messages/${bill}/snooze`, {body: {until: '2026-10-09T09:00:00-07:00'}});
    expect(snoozed.status).toBe(200);
    expect(snoozed.body).toMatchObject({id: bill, snoozed_until: until});
    expect((await api.send('GET', '/api/mail/snoozed')).body.rows.map((row: {id: number}) => row.id)).toEqual([bill]);
    expect((await api.send('POST', `/api/mail/messages/${bill}/snooze`, {body: {until: 'Monday'}})).status).toBe(400);
    expect((await api.send('POST', `/api/mail/messages/${bill}/snooze`, {body: {until: '2026-10-01T09:00:00Z'}})).status).toBe(400);
    const back = await api.send('POST', `/api/mail/messages/${bill}/unsnooze`);
    expect(back.status).toBe(200);
    expect(back.body.snoozed_until).toBeUndefined();
    expect((await api.send('POST', `/api/mail/messages/${bill}/unsnooze`)).status).toBe(409);
  });
});
