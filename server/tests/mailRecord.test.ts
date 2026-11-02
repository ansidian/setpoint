// The message record as the adapters write it (B2): the mirror (new mail Unsorted, provider state
// kept, derived fields untouched, a waiting change never reverted), the full-text index kept in
// step by triggers, the remote-content rule, MIME parsing and the backfill's progress.
import {SEED_NOW} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {openMessage, setDone} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {remoteContent, trustDomainOf} from '../src/domain/remoteContent.ts';
import type {SenderAuthentication} from '../src/domain/senderAuthentication.ts';
import type {RemoteContentInput} from '../src/domain/remoteContent.ts';
import {fetchedMessage, parseEmail} from '../src/providers/mime.ts';
import {allMail, inbox, indexing, mailCounts, messageDetail} from '../src/queries/mail.ts';
import {startBackfill, writeBackfill} from '../src/sync/cursors.ts';
import {applyProviderStates, removeMessages, upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {liveEvents, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {gmailVerdict, rawEmail} from './rawEmail.ts';

const accountId = (w: World, label: string) => w.store.db.select().from(t.accounts).where(eq(t.accounts.label, label)).get()!.id;
const row = (w: World, id: number) => w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!;
const integrity = (w: World) => w.store.sqlite.prepare(`INSERT INTO messages_fts(messages_fts) VALUES ('integrity-check')`).run();
const inIndex = (w: World, word: string) => w.store.sqlite.prepare('SELECT count(*) AS n FROM messages_fts WHERE messages_fts MATCH ?').pluck().get(word);

function fetched(overrides: Partial<FetchedMessage> = {}): FetchedMessage {
  return {
    providerId: 'g-1', threadId: 't-1', rfc822Id: '<one@mail.example.com>', fromName: 'Contoso Coffee', fromAddress: 'news@contosocoffee.example',
    subject: 'Your beans shipped', snippet: 'Arriving Friday', bodyText: 'Arriving Friday with tracking.', bodyHtml: null,
    receivedAt: '2026-10-07T15:00:00.000Z', senderAuth: null, attachments: [], unread: true, trashed: false, archived: false, ...overrides,
  };
}

describe('the mirror', () => {
  test('new mail arrives Unsorted and counts as unread at once, with one mail event', () => {
    const w = world({seed: true});
    const business = accountId(w, 'Business');
    const {inserted} = upsertMessages(w.store, business, [fetched()]);
    expect(row(w, inserted[0]!)).toMatchObject({lane: null, unread: true, backfill: false, trashedAt: null, archivedAt: null});
    const view = inbox(w.store);
    expect(view.groups.find(group => group.group === 'unsorted')!.rows.map(message => message.subject)).toEqual(['Your beans shipped']);
    expect(mailCounts(w.store)).toMatchObject({unread: 20, attention: 3});
    expect(liveEvents(w).at(-1)).toEqual({type: 'mail', messages: inserted, accounts: [business], commands: []});
  });

  test('a refetch refreshes the provider\'s fields and never what Setpoint derived', () => {
    const w = world({seed: true});
    const business = accountId(w, 'Business');
    const [id] = upsertMessages(w.store, business, [fetched()]).inserted;
    w.store.db.update(t.messages).set({lane: 'fyi', kind: 'deliveries', organisation: 'Contoso', pinnedAt: '2026-10-07T16:00:00.000Z'}).where(eq(t.messages.id, id!)).run();
    upsertMessages(w.store, business, [fetched({subject: 'Your beans shipped (updated)', unread: false})]);
    expect(row(w, id!)).toMatchObject({subject: 'Your beans shipped (updated)', unread: false, lane: 'fyi', kind: 'deliveries', organisation: 'Contoso'});
    expect(row(w, id!).pinnedAt).not.toBeNull();
  });

  test('a refetch without a Message-ID or a verdict keeps the stored ones (v1)', () => {
    const w = world({seed: true});
    const business = accountId(w, 'Business');
    const verdict = {version: 1, status: 'pass', provider: 'gmail', source: 'gmail_authentication_results', headerFromDomain: 'contosocoffee.example', dkim: [], spf: null, dmarc: null, evaluatedAt: SEED_NOW} satisfies SenderAuthentication;
    const [id] = upsertMessages(w.store, business, [fetched({senderAuth: verdict})]).inserted;
    upsertMessages(w.store, business, [fetched({rfc822Id: null, senderAuth: null})]);
    expect(row(w, id!)).toMatchObject({rfc822Id: '<one@mail.example.com>', senderAuthenticated: true, senderAuth: {status: 'pass'}});
  });

  test('read elsewhere, archived and trashed at the provider; a waiting change keeps its state', () => {
    const w = world({seed: true});
    const business = accountId(w, 'Business');
    const [a, b, c] = upsertMessages(w.store, business, [fetched(), fetched({providerId: 'g-2', subject: 'Two'}), fetched({providerId: 'g-3', subject: 'Three'})]).inserted;
    // Opened in Setpoint: its read waits for Gmail, so a stale "unread" from a sync must not undo it.
    openMessage(w.store, c!);
    const changed = applyProviderStates(w.store, business, new Map([
      ['g-1', {unread: false, trashed: false, archived: false}],
      ['g-2', {unread: true, trashed: false, archived: true}],
      ['g-3', {unread: true, trashed: false, archived: false}],
    ]));
    expect(changed).toEqual([a, b]);
    expect(row(w, a!).unread).toBe(false);
    expect(row(w, b!).archivedAt).not.toBeNull();
    expect(row(w, c!).unread).toBe(false);
    // Archived mail leaves the Inbox, but All still has it; Unsorted mail stays, read or not.
    const unsorted = inbox(w.store).groups.find(group => group.group === 'unsorted')!.rows.map(message => message.subject);
    expect(unsorted).toEqual(['Three', 'Your beans shipped']);
    expect(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows).map(message => message.subject)).toContain('Two');
    applyProviderStates(w.store, business, new Map([['g-2', {unread: true, trashed: true, archived: true}]]));
    expect(row(w, b!)).toMatchObject({archivedAt: null});
    expect(row(w, b!).trashedAt).not.toBeNull();
  });

  test('an email moved at an IMAP provider is matched by its Message-ID, not copied', () => {
    const w = world({seed: true});
    const icloud = accountId(w, 'iCloud');
    const [id] = upsertMessages(w.store, icloud, [fetched({providerId: '7:10'})], {matchByRfc822Id: true}).inserted;
    const again = upsertMessages(w.store, icloud, [fetched({providerId: '7:42'})], {matchByRfc822Id: true});
    expect(again).toEqual({inserted: [], updated: [id]});
    expect(row(w, id!).providerId).toBe('7:42');
  });

  test('deleted at the provider: gone from the record, its index and its commands', () => {
    const w = world({seed: true});
    const business = accountId(w, 'Business');
    const [id] = upsertMessages(w.store, business, [fetched()]).inserted;
    openMessage(w.store, id!);
    expect(removeMessages(w.store, business, ['g-1'])).toEqual([id]);
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.id, id!)).get()).toBeUndefined();
    expect(w.store.db.select().from(t.commands).all().filter(command => command.targetId === id)).toEqual([]);
    expect(inIndex(w, 'beans')).toBe(0);
    integrity(w);
  });
});

describe('the full-text index', () => {
  test('stays in step with a new subject and organisation, and ignores read-state and Done changes', () => {
    const w = world({seed: true});
    const id = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Interview availability for Software Engineer I')).get()!.id;
    expect(inIndex(w, 'availability')).toBe(1);
    w.store.db.update(t.messages).set({subject: 'Scheduling call', organisation: 'Zephyr Roasters'}).where(eq(t.messages.id, id)).run();
    expect(inIndex(w, 'availability')).toBe(0);
    expect(inIndex(w, 'scheduling')).toBe(1);
    expect(inIndex(w, 'zephyr')).toBe(1);
    openMessage(w.store, id);
    setDone(w.store, id, true);
    integrity(w);
  });
});

describe('remote content (decision 25)', () => {
  test.each<[RemoteContentInput, boolean, string]>([
    [{trusted: true, senderAuthenticated: false, lane: 'noise'}, true, 'trusted'],
    [{trusted: false, senderAuthenticated: true, lane: 'fyi'}, true, 'authenticated'],
    [{trusted: false, senderAuthenticated: true, lane: null}, true, 'authenticated'],
    [{trusted: false, senderAuthenticated: true, lane: 'noise'}, false, 'noise'],
    [{trusted: false, senderAuthenticated: false, lane: 'attention'}, false, 'not_authenticated'],
    [{trusted: false, senderAuthenticated: null, lane: 'fyi'}, false, 'unknown'],
  ])('%j loads %s (%s)', (input, load, reason) => {
    expect(remoteContent(input)).toEqual({load, reason});
  });

  test.each([
    ['news.contosocoffee.example', 'contosocoffee.example'],
    ['contosocoffee.example', 'contosocoffee.example'],
    ['accounts.google.com', 'google.com'],
    ['mail.foo.co.uk', 'foo.co.uk'],
    ['eng.northwind.example', 'northwind.example'],
    ['someone.github.io', 'someone.github.io'],
    ['192.168.1.20', '192.168.1.20'],
  ])('"Always show" from %s trusts %s (D28)', (domain, trusted) => {
    expect(trustDomainOf(domain)).toBe(trusted);
  });

  test('the reader says whether and why, from the recorded verdict', async () => {
    const w = world({seed: true});
    const business = accountId(w, 'Business');
    const source = rawEmail({from: 'Contoso Coffee <news@contosocoffee.example>', subject: 'New roasts', date: '2026-10-07T15:00:00Z', text: 'Hi', html: '<img src="https://img.contosocoffee.example/a.png">', received: gmailVerdict('contosocoffee.example')});
    const message = await fetchedMessage('gmail', source, {providerId: 'g-9', threadId: 't-9', unread: true, trashed: false, archived: false}, w.store.now());
    const [id] = upsertMessages(w.store, business, [message]).inserted;
    expect(row(w, id!)).toMatchObject({senderAuthenticated: true, senderAuth: {status: 'pass', headerFromDomain: 'contosocoffee.example'}});
    expect(messageDetail(w.store, id!).remote_content).toEqual({domain: 'contosocoffee.example', trust_domain: 'contosocoffee.example', sender_authenticated: true, trusted: false, load: true, reason: 'authenticated'});
    w.store.db.update(t.messages).set({lane: 'noise'}).where(eq(t.messages.id, id!)).run();
    expect(messageDetail(w.store, id!).remote_content).toMatchObject({load: false, reason: 'noise'});
  });
});

describe('MIME parsing', () => {
  test('multipart with HTML, an attachment and an inline image (kept in the HTML, not listed)', async () => {
    const email = await parseEmail(rawEmail({
      from: '"Whitfield, Dana" <dana@parksideapts.example.com>', subject: 'Lease renewal terms', date: '2026-09-30T17:00:00Z',
      text: 'Renewal offered to Nov 30, 2026 =E2=80=94 sign by Oct 31.', html: '<p>Renewal offered</p><img src="cid:inline-1@mail.example.com">',
      references: '<root@parksideapts.example.com> <second@parksideapts.example.com>',
      attachments: [{filename: 'Renewal agreement.pdf', contentType: 'application/pdf', content: '%PDF-1.4 fake'}, {filename: 'logo.png', contentType: 'image/png', content: 'png', inline: true}],
    }));
    expect(email).toMatchObject({
      fromName: 'Whitfield, Dana', fromAddress: 'dana@parksideapts.example.com', subject: 'Lease renewal terms',
      text: 'Renewal offered to Nov 30, 2026 — sign by Oct 31.', html: '<p>Renewal offered</p><img src="data:image/png;base64,cG5n">',
      threadRoot: '<root@parksideapts.example.com>', date: '2026-09-30T17:00:00.000Z',
      attachments: [{filename: 'Renewal agreement.pdf', mimeType: 'application/pdf', sizeBytes: 13}],
    });
  });

  test('an HTML-only email still gets body text for the index', async () => {
    const email = await parseEmail(Buffer.from([
      'From: news@contosocoffee.example', 'Subject: Roasts', 'Date: Wed, 07 Oct 2026 15:00:00 +0000', 'Content-Type: text/html; charset=utf-8', '',
      '<table><tr><td>Ethiopia</td><td>$18</td></tr></table>', '',
    ].join('\r\n')));
    expect(email.text).toContain('Ethiopia');
    expect(email.html).toContain('<table>');
    expect(email.fromName).toBe('');
  });
});

describe('the backfill\'s progress', () => {
  test('across accounts, a finished one counting whole; null once all are done', () => {
    const w = world({seed: true});
    const sources = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'gmail')).all();
    expect(indexing(w.store)).toEqual({indexing: null, accounts: []});
    const first = startBackfill(w.store, sources[0]!.id, 100, null);
    writeBackfill(w.store, sources[0]!.id, {...first, fetched: 24});
    const second = startBackfill(w.store, sources[1]!.id, 100, null);
    writeBackfill(w.store, sources[1]!.id, {...second, fetched: 100, done: true});
    expect(indexing(w.store)).toEqual({indexing: {progress: 0.62}, accounts: [
      {account_id: sources[0]!.accountId, progress: 0.24, done: false}, {account_id: sources[1]!.accountId, progress: 1, done: true},
    ]});
    writeBackfill(w.store, sources[0]!.id, {...first, fetched: 100, done: true});
    expect(indexing(w.store).indexing).toBeNull();
  });
});
