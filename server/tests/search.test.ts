// Search over the seed (BRIEF.md › Search, boards 06 and 07): chips filter exactly and come newest
// first; free text alone ranks by how well the words matched, newest first within each tier, with
// no importance boost, and counts what's about the search; each result says why it matched and what
// to highlight; All's mail is covered (archived in, trashed out); and the log keeps each search and
// the position of the result opened. Alfred's broad search is here too: it isn't to change.
import type {SearchOut, SearchResultOut} from '@setpoint/shared';
import {searchInput} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {searchLogEntry} from '../src/search/log.ts';
import {searchMail} from '../src/search/search.ts';
import {startBackfill} from '../src/sync/cursors.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const search = (w: World, text: string, extra: Record<string, unknown> = {}) => searchMail(w.store, searchInput.parse({text, ...extra}));
const subjects = (out: SearchOut) => out.results.map(result => result.subject);
const reasons = (result: SearchResultOut) => result.reasons.map(reason => reason.label).join(' · ');
const idOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;
/** The highlighted runs of one field, as text. */
const highlighted = (result: SearchResultOut, field: 'from_name' | 'organisation' | 'subject' | 'excerpt') => {
  const value = field === 'excerpt' ? result.excerpt : result[field] ?? '';
  return result.highlights.filter(run => run.field === field).map(run => value.slice(run.start, run.end));
};

let sent = 0;
/** An invented email, in the seed's first account, newer than the seed's. */
function sentEmail(w: World, subject: string, bodyText: string) {
  sent += 1;
  const accountId = w.store.db.select().from(t.accounts).get()!.id;
  return upsertMessages(w.store, accountId, [{
    providerId: `search-${sent}`, threadId: `search-thread-${sent}`, rfc822Id: null, fromName: 'Billing Desk', fromAddress: 'billing@notices.example',
    subject, snippet: '', bodyText, bodyHtml: null, receivedAt: `2026-10-09T1${sent % 10}:00:00.000Z`, senderAuth: null, attachments: [],
    unread: true, trashed: false, archived: false,
  }]).inserted[0]!;
}

describe('search over the seed: the brief\'s and the boards\' examples', () => {
  test('northwind rejection march → Northwind · Rejection · Mar 2026, "Update on your application" first (board 06)', () => {
    const w = world({seed: true});
    const out = search(w, 'northwind rejection march');
    expect(out.chips.map(chip => chip.label).join(' · ')).toBe('Northwind · Rejection · Mar 2026');
    expect(out).toMatchObject({text: '', order: 'newest', total: 2, next_offset: null, indexing: null});
    expect(subjects(out)).toEqual(['Update on your application', 'Your application for Data Engineer Intern']);
    const [first, second] = out.results;
    expect(first).toMatchObject({organisation: 'Northwind Talent', via: 'Greenhouse', type: 'rejection'});
    expect(first!.received_at).toBe('2026-03-14T22:22:00.000Z');
    expect(reasons(first!)).toBe('Org Northwind · Type Rejection · Date Mar 14');
    expect(reasons(second!)).toBe('Org Northwind · Type Rejection · Date Mar 3');
    expect(highlighted(first!, 'organisation')).toEqual(['Northwind']);
    expect(first!.excerpt).toMatch(/^Hi there, Thank you for your interest in the Software Engineer Intern role at Northwind, .*…$/);
    expect(highlighted(first!, 'excerpt')).toEqual(['Northwind']);
    expect(second!.excerpt).toBe('Thank you for applying to Northwind. Unfortunately, we won\'t be moving forward with your application for the Data Engineer Intern role.');
  });

  test('the lease question, without its filler, is Parkside\'s renewal terms alone (board 07)', () => {
    const w = world({seed: true});
    const out = search(w, 'When does my lease renewal need to be signed?');
    expect(out).toMatchObject({chips: [], order: 'match', total: 1, partial: false});
    expect(subjects(out)).toEqual(['Lease renewal terms']);
    expect(out.results.map(reasons)).toEqual(['Subject lease renewal · Body signed']);
    const [lease] = out.results;
    expect(highlighted(lease!, 'subject')).toEqual(['Lease', 'renewal']);
    expect(lease!.excerpt).toContain('once it\'s signed, your new term starts Dec 1');
    expect(highlighted(lease!, 'excerpt')).toContain('signed');
  });

  test('free text alone: by tier, newest first within each, no importance boost', () => {
    const w = world({seed: true});
    // "Parkside" in quotes stays text: the sender and organisation tier, newest first.
    expect(subjects(search(w, '"parkside"'))).toEqual(['October rent received', 'Lease renewal terms']);
    // Renewal: three subjects, newest first, then the rent email that only says it in the body. The
    // pinned, read-and-Done or attention state of an email changes nothing.
    const renewal = search(w, 'renewal');
    expect(subjects(renewal)).toEqual(['Lease renewal terms', 'Car registration renewal notice', 'Your renters policy renewal is coming up', 'October rent received']);
    expect(renewal).toMatchObject({total: 4, first_section: 3});
    w.store.db.update(t.messages).set({lane: 'attention', unread: true}).where(eq(t.messages.subject, 'October rent received')).run();
    expect(subjects(search(w, 'renewal'))).toEqual(subjects(renewal));
  });

  test('every word but filler is required, and plurals find singulars', () => {
    const w = world({seed: true});
    expect(subjects(search(w, 'lease renewal'))).toEqual(['Lease renewal terms', 'October rent received']);
    expect(subjects(search(w, 'final exams'))).toEqual(['Final exam schedule · CS 101']);
    expect(subjects(search(w, 'the final exams for me'))).toEqual(['Final exam schedule · CS 101']);
    expect(search(w, 'zebra quokka').total).toBe(0);
  });

  test('a word in capitals isn\'t filler, as "it" would be', () => {
    const w = world({seed: true});
    const role = sentEmail(w, 'A role at Fabrikam', 'Fabrikam is hiring an IT technician for the help desk.');
    const hours = sentEmail(w, 'Desk hours', 'The help desk is open, and nothing of the kind is needed.');
    expect(search(w, 'it desk').results.map(result => result.id)).toEqual(expect.arrayContaining([hours, role]));
    const capitals = search(w, 'IT desk').results;
    expect(capitals.map(result => result.id)).toContain(role);
    expect(capitals.map(result => result.id)).not.toContain(hours);
    expect(reasons(capitals.find(result => result.id === role)!)).toBe('Sender desk · Body IT');
  });

  test('a word no email has no longer empties the list, nor passes for a match: the rarest word found ranks it', () => {
    const w = world({seed: true});
    // Lease is the rarer word and renewal the commoner, and no email has zebra.
    const out = search(w, 'zebra lease renewal');
    expect(out).toMatchObject({partial: true});
    expect(subjects(out).slice(0, 2)).toEqual(['Lease renewal terms', 'October rent received']);
    // What has the rarest word and says it well is about the search; what has less only follows.
    expect(subjects(out).slice(out.first_section)).toEqual(expect.arrayContaining(['Car registration renewal notice', 'Your renters policy renewal is coming up']));
    expect(out.first_section).toBeGreaterThan(0);
    expect(search(w, 'zebra quokka')).toMatchObject({partial: false, total: 0, first_section: 0});
  });

  test('a link\'s domain is findable, last, and a whole list of mentions is still a list', () => {
    const w = world({seed: true});
    const linked = sentEmail(w, 'Your weekly digest', 'Have a look at this week at https://www.quokkamail.example/week');
    const said = sentEmail(w, 'A note', 'Quokkamail wrote to say the order is on its way.');
    const out = search(w, 'quokkamail');
    expect(out.results.map(result => result.id)).toEqual([said, linked]);
    expect(out).toMatchObject({total: 2, first_section: 0});
  });

  test('a chip keeps newest first, in one section, and every page says the same first section', () => {
    const w = world({seed: true});
    expect(search(w, 'northwind rejection march')).toMatchObject({total: 2, first_section: 2, order: 'newest'});
    const words = search(w, 'northwind application zebra');
    expect(words).toMatchObject({order: 'newest', partial: true, first_section: words.total});
    expect(search(w, 'renewal', {limit: 2})).toMatchObject({total: 4, first_section: 3, next_offset: 2});
    expect(search(w, 'renewal', {limit: 2, offset: 2})).toMatchObject({total: 4, first_section: 3, next_offset: null});
  });

  test('with a chip in force, leftover filler asks nothing of the mail', () => {
    const w = world({seed: true});
    expect(search(w, 'northwind rejection march the').results.map(result => result.subject)).toEqual(['Update on your application', 'Your application for Data Engineer Intern']);
  });

  test('a search no email fully matches says so (UX #10)', () => {
    const w = world({seed: true});
    expect(search(w, 'lease renewal').partial).toBe(false);
    const tokyo = search(w, 'flight to tokyo');
    expect(tokyo.total).toBeGreaterThan(0);
    expect(tokyo.partial).toBe(true);
    expect(search(w, 'zebra quokka').partial).toBe(false);
  });

  test('more chips: an account and a kind, an organisation alone, a type with a month, and a day', () => {
    const w = world({seed: true});
    const jobs = search(w, 'jobs career');
    expect(jobs.chips.map(chip => `${chip.kind} ${chip.label}`)).toEqual(['account Jobs', 'kind Career']);
    expect(subjects(jobs)).toEqual([
      'Interview availability for Software Engineer I', 'Application received', 'Thanks for applying', 'Update on your application', 'Your application for Data Engineer Intern',
    ]);
    expect(reasons(jobs.results[0]!)).toBe('Account Jobs · Kind Career');
    expect(subjects(search(w, 'parkside'))).toEqual(['October rent received', 'Lease renewal terms']);
    expect(subjects(search(w, 'statement oct'))).toEqual(['Statement ready', 'Bill is ready']);
    expect(subjects(search(w, 'contoso university sep 30'))).toEqual([]);
    expect(subjects(search(w, 'parkside sep 30'))).toEqual(['Lease renewal terms']);
    // Chips with free text: the text must match too, and order stays newest first.
    const interview = search(w, 'northwind interview');
    expect(interview).toMatchObject({order: 'newest', text: 'interview'});
    expect(subjects(interview)).toEqual(['Interview availability for Software Engineer I']);
    expect(reasons(interview.results[0]!)).toBe('Org Northwind · Subject interview');
  });

  test('"!" leaves out what it names: a Not chip, or the mail with a word; neither is a reason (SV-31)', () => {
    const w = world({seed: true});
    const notRejection = search(w, 'northwind !rejection');
    expect(notRejection.chips).toEqual([{kind: 'organisation', value: 'Northwind', label: 'Northwind'}, {kind: 'type', value: 'rejection', label: 'Rejection', not: true}]);
    expect(subjects(notRejection)).toEqual(['Interview availability for Software Engineer I', 'Thanks for applying']);
    expect(reasons(notRejection.results[0]!)).toBe('Org Northwind');
    // Leaving out alone keeps free text's order: by the best field, newest first.
    const application = search(w, 'application !northwind');
    expect(application).toMatchObject({order: 'match', text: 'application'});
    expect(subjects(application)).toEqual(['Application received']);
    // A word: the mail that has it anywhere is left out; the field keeps it as typed.
    const renewal = search(w, 'renewal !lease');
    expect(renewal).toMatchObject({text: 'renewal !lease', order: 'match'});
    expect(subjects(renewal)).toEqual(['Car registration renewal notice', 'Your renters policy renewal is coming up']);
    // Only leaving out: everything else, newest first. An email with no type stays.
    const notConfirmation = search(w, '!confirmation', {limit: 200});
    expect(notConfirmation.order).toBe('newest');
    expect(notConfirmation.results.some(result => result.type === 'confirmation')).toBe(false);
    expect(notConfirmation.results.some(result => result.type === null)).toBe(true);
    expect(search(w, '!application', {limit: 200}).results.some(result => /application/i.test(result.subject))).toBe(false);
    // Chips the field already shows keep their Not.
    expect(subjects(search(w, 'northwind', {chips: [{kind: 'type', value: 'rejection', label: 'Rejection', not: true}]}))).toEqual(subjects(notRejection));
  });

  test('chips the field already shows are kept, and an organisation nobody has matches nothing', () => {
    const w = world({seed: true});
    const out = search(w, 'march', {chips: [{kind: 'organisation', value: 'Northwind', label: 'Northwind'}, {kind: 'type', value: 'rejection', label: 'Rejection'}]});
    expect(out.chips.map(chip => chip.label)).toEqual(['Northwind', 'Rejection', 'Mar 2026']);
    expect(out.total).toBe(2);
    expect(search(w, '', {chips: [{kind: 'organisation', value: 'Initech', label: 'Initech'}]}).total).toBe(0);
    expect(search(w, '').total).toBe(0);
  });

  test('covers All: archived mail is found, trashed mail isn\'t; the sidebar\'s account narrows it', () => {
    const w = world({seed: true});
    w.store.db.update(t.messages).set({archivedAt: '2026-10-02T00:00:00.000Z'}).where(eq(t.messages.subject, 'October rent received')).run();
    w.store.db.update(t.messages).set({trashedAt: '2026-10-02T00:00:00.000Z'}).where(eq(t.messages.subject, 'Lease renewal terms')).run();
    expect(subjects(search(w, 'parkside'))).toEqual(['October rent received']);
    const personal = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    const business = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Business')).get()!.id;
    expect(subjects(search(w, 'wingtip', {account_id: personal}))).toEqual([]);
    expect(subjects(search(w, 'wingtip', {account_id: business}))).toEqual(['Arriving today: USB-C hub', 'Delivered: desk lamp', 'Ordered: USB-C hub']);
  });

  test('pages, with the indexing line while the first backfill runs', () => {
    const w = world({seed: true});
    // The Jobs account's six emails (the brief's five and Jobs's Indeed match email, round 4).
    const first = search(w, 'jobs', {limit: 2});
    expect(first).toMatchObject({total: 6, next_offset: 2});
    const second = search(w, 'jobs', {limit: 2, offset: 2, search_id: first.search_id});
    expect(second).toMatchObject({search_id: first.search_id, total: 6, next_offset: 4});
    expect(searchLogEntry(w.store, first.search_id)!.resultIds).toEqual([...first.results, ...second.results].map(result => result.id));
    const source = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'gmail')).get()!;
    startBackfill(w.store, source.id, 100, null);
    expect(search(w, 'jobs').indexing).toEqual({progress: 0});
  });
});

describe('Alfred\'s broad search, an option apart', () => {
  const broad = (w: World, text: string) => searchMail(w.store, searchInput.parse({text}), {log: false, matching: 'broad'});

  test('filler counts, any one word will do, and the best field any word matched orders them', () => {
    const w = world({seed: true});
    const out = broad(w, 'When does my lease renewal need to be signed?');
    expect(out).toMatchObject({chips: [], order: 'match', partial: true});
    expect(subjects(out)).toEqual(['Lease renewal terms', 'Car registration renewal notice', 'Your renters policy renewal is coming up', 'October rent received']);
    expect(out.results.map(reasons)).toEqual(['Subject lease renewal · Body signed', 'Subject renewal', 'Subject renewal', 'Body lease renewal']);
    expect(subjects(search(w, 'When does my lease renewal need to be signed?'))).toEqual(['Lease renewal terms']);
  });

  test('its chips are the grammar\'s', () => {
    const w = world({seed: true});
    expect(broad(w, 'northwind rejection march').chips.map(chip => chip.label)).toEqual(['Northwind', 'Rejection', 'Mar 2026']);
  });
});

describe('the search log', () => {
  test('logs each search with its chips and results; typing on replaces the row; opening records the position', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const typed: number[] = [];
    for (const text of ['nor', 'northwind rej', 'northwind rejection march']) {
      typed.push((await c.send('POST', '/api/search', {body: {text}})).body.search_id);
      w.advance(1500);
    }
    expect(new Set(typed).size).toBe(1);
    const entry = searchLogEntry(w.store, typed[0]!)!;
    expect(entry).toMatchObject({query: 'northwind rejection march', freeText: '', order: 'newest', total: 2});
    expect(entry.chips.map(chip => chip.label)).toEqual(['Northwind', 'Rejection', 'Mar 2026']);
    expect(entry.resultIds).toEqual([idOf(w, 'Update on your application'), idOf(w, 'Your application for Data Engineer Intern')]);

    expect((await c.send('POST', '/api/search/opened', {body: {search_id: typed[0], message_id: idOf(w, 'Update on your application'), position: 0}})).status).toBe(204);
    expect(searchLogEntry(w.store, typed[0]!)!.opens).toEqual([{messageId: idOf(w, 'Update on your application'), position: 0}]);
    // After an open, or a new subject, a search is a new row.
    const next = (await c.send('POST', '/api/search', {body: {text: 'northwind rejection march 2'}})).body.search_id;
    expect(next).not.toBe(typed[0]);
    w.advance(60_000);
    const lease = (await c.send('POST', '/api/search', {body: {text: 'lease'}})).body;
    expect(lease.search_id).not.toBe(next);
    expect((await c.send('POST', '/api/search/opened', {body: {search_id: 9999, message_id: 1, position: 0}})).status).toBe(404);
    expect((await c.send('POST', '/api/search', {body: {text: 'lease', search_id: 9999, offset: 50}})).status).toBe(404);
  });

  test('the API refuses a malformed search and needs a session', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    expect((await c.send('POST', '/api/search', {body: {text: 'x', chips: [{kind: 'type', value: 'memo', label: 'Memo'}]}})).status).toBe(400);
    c.cookie = null;
    expect((await c.send('POST', '/api/search', {body: {text: 'lease'}})).status).toBe(401);
  });
});
