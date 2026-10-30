// The search index after SV-135: it holds the summary and a clean body rather than `body_text`, so
// a link matches by its domain and never by its path, a summary matches once triage writes it, and
// what a result shows comes from what the index holds. The sample emails are invented.
import type {SearchOut} from '@setpoint/shared';
import {searchInput} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {searchBody} from '../src/domain/searchBody.ts';
import {searchMail} from '../src/search/search.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {applyOutcome} from '../src/triage/intake.ts';
import {world} from './helpers.ts';
import type {World} from './helpers.ts';

const search = (w: World, text: string) => searchMail(w.store, searchInput.parse({text}), {log: false});
const subjects = (out: SearchOut) => out.results.map(result => result.subject);
const reasons = (out: SearchOut) => out.results.map(result => result.reasons.map(reason => reason.label).join(' · '));
const marked = (out: SearchOut, at = 0) => {
  const result = out.results[at]!;
  return result.highlights.filter(run => run.field === 'excerpt').map(run => result.excerpt.slice(run.start, run.end));
};
const row = (w: World, id: number) => w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!;
const integrity = (w: World) => w.store.sqlite.prepare(`INSERT INTO messages_fts(messages_fts) VALUES ('integrity-check')`).run();

let next = 0;
function fetched(overrides: Partial<FetchedMessage> = {}): FetchedMessage {
  next += 1;
  return {
    providerId: `index-${next}`, threadId: `index-thread-${next}`, rfc822Id: null, fromName: 'Billing Desk', fromAddress: 'billing@notices.example',
    subject: 'Hello', snippet: '', bodyText: 'Hello.', bodyHtml: null, receivedAt: '2026-10-07T15:00:00.000Z', senderAuth: null, attachments: [],
    unread: true, trashed: false, archived: false, ...overrides,
  };
}

function accountWorld() {
  const w = world();
  w.store.db.insert(t.accounts).values({provider: 'gmail', label: 'Personal', address: 'user@example.com', colour: 'cool', icon: 'person', position: 0, createdAt: '2026-10-07T16:00:00.000Z'}).run();
  const accountId = w.store.db.select().from(t.accounts).get()!.id;
  const add = (overrides: Partial<FetchedMessage> = {}) => upsertMessages(w.store, accountId, [fetched(overrides)]).inserted[0]!;
  return {w, accountId, add};
}

const write = (w: World, id: number, columns: Partial<typeof t.messages.$inferInsert>) => w.store.db.update(t.messages).set(columns).where(eq(t.messages.id, id)).run();

describe('links', () => {
  test('a sender known only by its link\'s domain is found with the subject\'s word, and the row shows why', () => {
    const {w, add} = accountWorld();
    for (const month of ['September', 'October']) add({subject: `Your ${month} invoice`, bodyText: `Your invoice is ready to view.\n\nView it at https://fhwbilling.example/i/${month}?token=q8x2 today.`});
    add({subject: 'Your invoice from a shop', bodyText: 'Thanks for shopping.'});
    add({subject: 'Water news', bodyText: 'Read about https://fhwbilling.example/news.'});

    const out = search(w, 'fhw invoice');
    expect(subjects(out)).toEqual(['Your October invoice', 'Your September invoice']);
    expect(reasons(out)).toEqual(['Subject invoice · Body fhw', 'Subject invoice · Body fhw']);
    expect(out.results[0]!.excerpt).toBe('Your invoice is ready to view. View it at fhwbilling today.');
    expect(marked(out)).toEqual(['invoice', 'fhw']);
    expect(subjects(search(w, 'fhw')).toSorted()).toEqual(['Water news', 'Your October invoice', 'Your September invoice']);
  });

  test('a link\'s path and query match nothing, and never read as a reason or a mark', () => {
    const {w, add} = accountWorld();
    const id = add({subject: 'Your order', bodyText: 'Track it at https://parcels.example/tracking/campaign?utm_source=spring.'});
    for (const word of ['campaign', 'utm', 'spring', 'tracking']) expect(search(w, word).total).toBe(0);

    // The any-word step finds it by `order`: `campaign` is in its body_text, but not in what's indexed.
    const out = search(w, 'order campaign');
    expect(out).toMatchObject({partial: true, total: 1});
    expect(reasons(out)).toEqual(['Subject order']);
    expect(row(w, id).bodyText).toContain('campaign');
    expect(out.results[0]!.excerpt).not.toContain('campaign');
  });

  test('a footer\'s words match nothing and don\'t show, and its link\'s domain still finds the email', () => {
    const {w, add} = accountWorld();
    add({subject: 'Your statement', bodyText: 'It\'s ready.\n\nTo unsubscribe, click here https://fhwbilling.example/unsub.'});
    expect(search(w, 'unsubscribe').total).toBe(0);
    const out = search(w, 'fhw');
    expect(out.total).toBe(1);
    expect(out.results[0]!.excerpt).toBe('It\'s ready. fhwbilling');
  });

  test('"!word" leaves out what the index holds', () => {
    const {w, add} = accountWorld();
    add({subject: 'Invoice one', bodyText: 'See https://fhwbilling.example/pathword.'});
    add({subject: 'Invoice two', bodyText: 'Hello.'});
    expect(subjects(search(w, 'invoice !fhw'))).toEqual(['Invoice two']);
    expect(search(w, 'invoice !pathword').total).toBe(2);
  });
});

describe('the summary', () => {
  const settled = (summary: string) => ({
    source: 'cheap_model' as const, ruleId: null,
    settled: {lane: 'fyi' as const, kind: 'money' as const, type: 'statement' as const, organisation: null, via: null, summary, keyDate: null, securityFacts: null, protected: false, code: null, codeExpiresAt: null},
  });

  test('matches once triage writes it, and goes when it changes', () => {
    const {w, add} = accountWorld();
    const id = add({subject: 'Your account', bodyText: 'There is news about your account.'});
    expect(search(w, 'electricity').total).toBe(0);
    expect(applyOutcome(w.store, id, settled('Electricity bill is due') as never)).toBe(true);
    expect(subjects(search(w, 'electricity'))).toEqual(['Your account']);
    write(w, id, {summary: 'Gas bill is due'});
    expect(search(w, 'electricity').total).toBe(0);
    expect(subjects(search(w, 'gas'))).toEqual(['Your account']);
    integrity(w);
  });

  test('a match only there reads as Body, marks nothing, and the row keeps its excerpt', () => {
    const {w, add} = accountWorld();
    const id = add({subject: 'Your account', bodyText: 'There is news about your account.'});
    write(w, id, {summary: 'Electricity bill is due'});
    const out = search(w, 'electricity');
    expect(reasons(out)).toEqual(['Body electricity']);
    expect(out.results[0]!.excerpt).toBe('There is news about your account.');
    expect(out.results[0]!.highlights).toEqual([]);
  });

  test('the excerpt goes to the word the body has when another word is only in the summary', () => {
    const {w, add} = accountWorld();
    const filler = 'Nothing to see in this line of the email at all. '.repeat(8);
    const id = add({subject: 'Your account', bodyText: `${filler}Your signed lease is attached.`});
    write(w, id, {summary: 'Electricity bill is due'});
    const out = search(w, 'electricity signed');
    expect(out.results[0]!.excerpt).toContain('Your signed lease');
    expect(marked(out)).toEqual(['signed']);
    expect(reasons(out)).toEqual(['Body electricity signed']);
  });

  test('ranks with the body, below a subject match, and never above it', () => {
    const {w, add} = accountWorld();
    const onlySummary = add({subject: 'Your account', bodyText: 'Hello.', receivedAt: '2026-10-07T18:00:00.000Z'});
    add({subject: 'In the body', bodyText: 'The electricity is out.', receivedAt: '2026-10-07T17:00:00.000Z'});
    add({subject: 'Electricity update', bodyText: 'Hello.', receivedAt: '2026-10-07T16:00:00.000Z'});
    add({fromName: 'Electricity Co', subject: 'From them', bodyText: 'Hello.', receivedAt: '2026-10-07T15:00:00.000Z'});
    write(w, onlySummary, {summary: 'Electricity bill is due'});
    expect(subjects(search(w, 'electricity'))).toEqual(['From them', 'Electricity update', 'Your account', 'In the body']);
  });
});

describe('the index keeps up', () => {
  test('search terms match once they\'re written', () => {
    const {w, add} = accountWorld();
    const id = add({subject: 'Your account', bodyText: 'Hello.'});
    expect(row(w, id).searchTerms).toBeNull();
    write(w, id, {searchTerms: 'utility payment'});
    expect(reasons(search(w, 'utility'))).toEqual(['Body utility']);
    write(w, id, {searchTerms: 'renters insurance'});
    expect(search(w, 'utility').total).toBe(0);
    expect(search(w, 'insurance').total).toBe(1);
    integrity(w);
  });

  test('a refetch replaces the clean body with the raw one, and deleting takes it out', () => {
    const {w, accountId, add} = accountWorld();
    const id = add({providerId: 'same', subject: 'Your account', bodyText: 'Old words. https://first.example/a'});
    upsertMessages(w.store, accountId, [fetched({providerId: 'same', subject: 'Your account', bodyText: 'New words. https://second.example/b'})]);
    expect(row(w, id).searchBody).toBe('New words. second');
    expect(search(w, 'old').total).toBe(0);
    expect(search(w, 'first').total).toBe(0);
    expect(search(w, 'second').total).toBe(1);
    w.store.db.delete(t.messages).where(eq(t.messages.id, id)).run();
    expect(search(w, 'second').total).toBe(0);
    integrity(w);
  });

  test('every email the seed writes carries its search body', () => {
    const w = world({seed: true});
    const rows = w.store.db.select({bodyText: t.messages.bodyText, searchBody: t.messages.searchBody}).from(t.messages).all();
    expect(rows.length).toBeGreaterThan(0);
    for (const email of rows) expect(email.searchBody).toBe(searchBody(email.bodyText));
    integrity(w);
  });
});
