// Mail's read queries and changes over the seed (BRIEF.md › Sample data; DESIGN.md › The list and
// Interaction rules), with the dev provider confirming.
import {SEED_NOW} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {confirmCommand, failCommand, moveBackCommand, retryCommand} from '../src/commands/index.ts';
import {markAllRead, openMessage, setDone, setPinned, setRead, trashMessage} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {allMail, inbox, mailCounts, messageDetail} from '../src/queries/mail.ts';
import {liveEvents, world} from './helpers.ts';
import type {World} from './helpers.ts';

const MINUTE = 60_000;
const idOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;
const accountId = (w: World, label: string) => w.store.db.select().from(t.accounts).where(eq(t.accounts.label, label)).get()!.id;
const unreadByLabel = (w: World) => {
  const labels = new Map(w.store.db.select().from(t.accounts).all().map(account => [account.id, account.label]));
  return Object.fromEntries(mailCounts(w.store).accounts.map(row => [labels.get(row.account_id), row.unread]));
};

describe('the Inbox over the seed', () => {
  test('groups in DESIGN.md\'s order, with their counts', () => {
    const w = world({seed: true});
    const view = inbox(w.store);
    expect(view.groups.map(group => [group.group, group.count])).toEqual([
      ['pinned', 1], ['attention', 3], ['security', 3], ['deliveries', 4], ['money', 3], ['career', 1], ['noise', 6],
    ]);
    expect(view.groups.find(group => group.group === 'attention')!.rows.map(row => [row.subject, row.unread, row.protected])).toEqual([
      ['Your recovery email was changed', true, true],
      ['Interview availability for Software Engineer I', true, false],
      ['Final exam schedule · CS 101', false, false],
    ]);
  });

  test('19 unread, 3 attention, 11 unread FYI; Business 7, Personal 8, Work 1, Jobs 2, iCloud 1', () => {
    const w = world({seed: true});
    expect(mailCounts(w.store)).toMatchObject({attention: 3, unread: 19, unread_fyi: 11});
    expect(unreadByLabel(w)).toEqual({Business: 7, Personal: 8, Work: 1, Jobs: 2, iCloud: 1});
  });

  test('security rows carry their fact, the code row its code and expiry', () => {
    const w = world({seed: true});
    const security = inbox(w.store).groups.find(group => group.group === 'security')!.rows;
    expect(security.map(row => row.fact ?? row.code?.value)).toEqual(['482913', 'New sign-in · MacBook Pro · Los Angeles', 'Access granted · Claude']);
    expect(Date.parse(security[0]!.code!.expires_at) - Date.parse(SEED_NOW)).toBe(11 * MINUTE);
    expect(inbox(w.store).next_change_at).toBe(security[0]!.code!.expires_at);
  });

  test('a code\'s row leaves the Inbox and its counts at its expiry', () => {
    const w = world({seed: true});
    w.advance(11 * MINUTE);
    const security = inbox(w.store).groups.find(group => group.group === 'security')!;
    expect(security.rows.map(row => row.subject)).toEqual(['Security alert', 'Claude was granted access to your Google Account']);
    expect(mailCounts(w.store)).toMatchObject({unread: 18, unread_fyi: 10});
    expect(unreadByLabel(w).Personal).toBe(7);
    expect(inbox(w.store).next_change_at).toBeNull();
  });

  test('filtering to an account keeps every account\'s counts', () => {
    const w = world({seed: true});
    const jobs = inbox(w.store, accountId(w, 'Jobs'));
    expect(jobs.groups.map(group => [group.group, group.count])).toEqual([['attention', 1], ['career', 1]]);
    expect(jobs.counts.unread).toBe(19);
  });
});

describe('read state, Done and the counts (decision 48)', () => {
  test('opening an unread email drops the unread counts, not the pill: 18 and Jobs 1', () => {
    const w = world({seed: true});
    const command = openMessage(w.store, idOf(w, 'Interview availability for Software Engineer I'))!;
    expect(command).toMatchObject({kind: 'open', state: 'pending'});
    expect(mailCounts(w.store)).toMatchObject({attention: 3, unread: 18});
    expect(unreadByLabel(w).Jobs).toBe(1);
    // Still in Attention, read, with its change pending.
    const row = inbox(w.store).groups.find(group => group.group === 'attention')!.rows[1]!;
    expect(row).toMatchObject({unread: false, command: {kind: 'open', state: 'pending', provider: 'gmail'}});
    expect(liveEvents(w).at(-1)).toEqual({type: 'mail', messages: [row.id], accounts: [accountId(w, 'Jobs')], commands: [command.id]});
  });

  test('opening a read email sends nothing but records the opening', () => {
    const w = world({seed: true});
    const id = idOf(w, 'Final exam schedule · CS 101');
    expect(openMessage(w.store, id)).toBeNull();
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!.openedAt).toBe(SEED_NOW);
  });

  test('an opened FYI email leaves its group and the counts', () => {
    const w = world({seed: true});
    openMessage(w.store, idOf(w, 'Out for delivery'));
    expect(inbox(w.store).groups.find(group => group.group === 'deliveries')!.count).toBe(3);
    expect(mailCounts(w.store)).toMatchObject({unread: 18, unread_fyi: 10});
  });

  test('Done drops the attention pill, and records whether it was opened first', () => {
    const w = world({seed: true});
    const opened = idOf(w, 'Final exam schedule · CS 101');
    openMessage(w.store, opened);
    setDone(w.store, opened, true);
    const unopened = idOf(w, 'Your recovery email was changed');
    setDone(w.store, unopened, true);
    expect(mailCounts(w.store)).toMatchObject({attention: 1});
    const done = (id: number) => w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!;
    expect([done(opened).openedBeforeDone, done(unopened).openedBeforeDone]).toEqual([true, false]);
    expect(inbox(w.store).groups.find(group => group.group === 'attention')!.rows.map(row => row.subject)).toEqual(['Interview availability for Software Engineer I']);
    // Not Done puts it back.
    setDone(w.store, unopened, false);
    expect(mailCounts(w.store).attention).toBe(2);
  });

  test('Mark read, then Mark unread once the first is confirmed', () => {
    const w = world({seed: true});
    const id = idOf(w, 'Statement ready');
    const read = setRead(w.store, id, false);
    expect(() => setRead(w.store, id, true)).toThrow(/still waiting/);
    confirmCommand(w.store, read.id);
    setRead(w.store, id, true);
    expect(mailCounts(w.store).unread).toBe(19);
  });

  test('pinning puts an email on the shelf and in its group too', () => {
    const w = world({seed: true});
    setPinned(w.store, idOf(w, 'Bill is ready'), true);
    const view = inbox(w.store);
    expect(view.groups[0]!.rows.map(row => row.subject)).toEqual(['Bill is ready', 'Lease renewal terms']);
    expect(view.groups.find(group => group.group === 'money')!.count).toBe(3);
  });
});

describe('trash, failures and Mark all as read', () => {
  test('Trash takes it out at once; Undo is its own command', () => {
    const w = world({seed: true});
    const id = idOf(w, 'Arriving today: USB-C hub');
    const trash = trashMessage(w.store, id, true);
    expect(inbox(w.store).groups.find(group => group.group === 'deliveries')!.count).toBe(3);
    confirmCommand(w.store, trash.id);
    trashMessage(w.store, id, false);
    expect(inbox(w.store).groups.find(group => group.group === 'deliveries')!.count).toBe(4);
  });

  test('a failed Trash stays in place with the provider\'s words, until Try again or Move back', () => {
    const w = world({seed: true});
    const id = idOf(w, 'Arriving today: USB-C hub');
    const trash = trashMessage(w.store, id, true);
    failCommand(w.store, trash.id, 'Requested entity was not found. (404)');
    const row = inbox(w.store).groups.find(group => group.group === 'deliveries')!.rows.find(message => message.id === id)!;
    expect(row.command).toMatchObject({state: 'failed', provider_message: 'Requested entity was not found. (404)', can_retry: true, can_move_back: true});
    expect(() => trashMessage(w.store, id, false)).toThrow(/failed/);
    expect(retryCommand(w.store, trash.id).state).toBe('pending');
    failCommand(w.store, trash.id, 'Still not found');
    moveBackCommand(w.store, trash.id);
    const back = w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!;
    expect(back.trashedAt).toBeNull();
    expect(messageDetail(w.store, id).command).toBeNull();
  });

  test('Mark all as read: one command per account, every unread email outside Attention and Security, read at once (D84)', () => {
    const w = world({seed: true});
    const commands = markAllRead(w.store);
    const labels = new Map(w.store.db.select().from(t.accounts).all().map(account => [account.id, account.label]));
    expect(commands.map(command => [labels.get(command.targetId), (command.payload.message_ids as number[]).length])).toEqual([
      ['Personal', 6], ['Business', 6], ['Jobs', 1], ['iCloud', 1],
    ]);
    // Pending: read already, so a load before the provider confirms doesn't bring them back (SV-41).
    expect(mailCounts(w.store)).toMatchObject({attention: 3, unread: 5, unread_fyi: 3});
    expect(inbox(w.store).groups.map(group => group.group)).toEqual(['pinned', 'attention', 'security']);
    for (const command of commands) confirmCommand(w.store, command.id);
    expect(mailCounts(w.store)).toMatchObject({attention: 3, unread: 5, unread_fyi: 3});
    expect(inbox(w.store).groups.map(group => group.group)).toEqual(['pinned', 'attention', 'security']);
  });

  test('Mark all as read leaves Security unread: its codes and sign-in alerts stay in the Inbox (UX #4)', () => {
    const w = world({seed: true});
    const security = inbox(w.store).groups.find(group => group.group === 'security')!.rows.map(row => row.id);
    expect(security.length).toBeGreaterThan(0);
    const commands = markAllRead(w.store);
    expect(commands.flatMap(command => command.payload.message_ids as number[]).filter(id => security.includes(id))).toEqual([]);
    for (const command of commands) confirmCommand(w.store, command.id);
    const left = inbox(w.store).groups.find(group => group.group === 'security')!;
    expect(left.rows.map(row => [row.id, row.unread])).toEqual(security.map(id => [id, true]));
  });

  test('a failed Mark all as read keeps its emails in place with the failure on each; Move back makes them unread again', () => {
    const w = world({seed: true});
    const [first] = markAllRead(w.store, accountId(w, 'iCloud'));
    failCommand(w.store, first!.id, 'Connection reset');
    const bill = () => inbox(w.store).groups.find(group => group.group === 'money')?.rows.find(row => row.subject === 'Bill is ready');
    expect(bill()).toMatchObject({unread: false, command: {kind: 'mark_all_read', state: 'failed', provider_message: 'Connection reset'}});
    moveBackCommand(w.store, first!.id);
    expect(bill()).toMatchObject({unread: true, command: null});
  });
});

describe('All and an email', () => {
  test('All: every email newest first, by local day, Noise included, with paging', () => {
    const w = world({seed: true});
    const page = allMail(w.store, {limit: 13});
    expect(page.days.map(day => [day.date, day.rows.length])).toEqual([['2026-10-07', 13]]);
    expect(page.days[0]!.rows.filter(row => row.lane === 'noise').map(row => row.from_name)).toEqual(['Tailspin Toys', 'Contoso Coffee', 'Litware']);
    const next = allMail(w.store, {limit: 200, before: page.next_before!});
    expect(next.days.map(day => day.date).slice(0, 3)).toEqual(['2026-10-06', '2026-10-05', '2026-10-04']);
    expect(next.next_before).toBeNull();
    expect(page.days[0]!.rows.length + next.days.reduce((sum, day) => sum + day.rows.length, 0)).toBe(32);
  });

  test('the Parkside email, with its attachment; reading it doesn\'t mark it read', () => {
    const w = world({seed: true});
    const email = messageDetail(w.store, idOf(w, 'Lease renewal terms'));
    expect(email).toMatchObject({from_name: 'Dana Whitfield', organisation: 'Parkside Apartments', pinned: true, key_date: '2026-10-31', attachment_count: 1});
    expect(email.attachments).toMatchObject([{filename: 'Renewal agreement.pdf', mime_type: 'application/pdf', previewable: true}]);
    expect(email.open_url).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?authuser=user%40example\.com#all\/seed-/);
  });

  test('remote content: hidden for Noise and unauthenticated senders, shown for a trusted domain', () => {
    const w = world({seed: true});
    const coffee = idOf(w, 'The Contoso Coffee Journal · October');
    expect(messageDetail(w.store, coffee).remote_content).toEqual({domain: 'contosocoffee.example', trust_domain: 'contosocoffee.example', sender_authenticated: null, trusted: false, load: false, reason: 'unknown'});
    w.store.db.update(t.messages).set({senderAuthenticated: true}).where(eq(t.messages.id, coffee)).run();
    expect(messageDetail(w.store, coffee).remote_content.load).toBe(false);
    w.store.db.insert(t.trustedDomains).values({domain: 'contosocoffee.example', createdAt: SEED_NOW}).run();
    expect(messageDetail(w.store, coffee).remote_content).toMatchObject({trusted: true, load: true});
    const statement = idOf(w, 'Statement ready');
    w.store.db.update(t.messages).set({senderAuthenticated: true}).where(eq(t.messages.id, statement)).run();
    expect(messageDetail(w.store, statement).remote_content.load).toBe(true);
  });

  test('the security facts card', () => {
    const w = world({seed: true});
    expect(messageDetail(w.store, idOf(w, 'Your recovery email was changed')).security).toEqual({
      what: 'Recovery email changed', device: 'Windows · Chrome', location: 'Phoenix, AZ', unfamiliar: true,
    });
  });
});
