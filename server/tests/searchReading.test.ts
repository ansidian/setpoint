// The server's reading of a whole search, offered as a suggestion (SV-138, SV-142, D386, D392), with
// Haiku faked at the HTTP boundary: what it's given, how its answer becomes chips once accepted, what
// those leave out, when a suggestion is worth offering, and every way a reading can fail to come. All
// searches and names here are invented.
import type {SearchOut} from '@setpoint/shared';
import {searchInput, searchSuggestionInput} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {searchLogEntry} from '../src/search/log.ts';
import {READING_HELD_MS, SearchReader, SUGGESTION_HIDES} from '../src/search/reading.ts';
import {FACET_MATCHES, readingFacets, readingOf, SEARCH_READING_MODEL, SEARCH_READING_PROMPT_VERSION, SEARCH_READING_SYSTEM, SEARCH_READING_TOOL, searchReadingInput} from '../src/search/readingPrompt.ts';
import {searchMail} from '../src/search/search.ts';
import {setSecret} from '../src/secrets/store.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import {aiOverview} from '../src/triage/learning.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer} from './fakeModels.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const answer = (changes: Record<string, unknown> = {}): FakeAnswer => ({tool: {organisations: [], types: [], is_date: true, keywords: '', ...changes}});

let sent = 0;
/** An invented email, in the seed's first account, newer than the seed's. */
function mail(w: World, subject: string, changes: Partial<typeof t.messages.$inferInsert> & {body?: string} = {}) {
  sent += 1;
  const {body = '', ...columns} = changes;
  const accountId = w.store.db.select().from(t.accounts).get()!.id;
  const id = upsertMessages(w.store, accountId, [{
    providerId: `reading-${sent}`, threadId: `reading-thread-${sent}`, rfc822Id: null, fromName: 'Billing Desk', fromAddress: 'billing@notices.example',
    subject, snippet: '', bodyText: body, bodyHtml: null, receivedAt: `2026-10-09T1${sent % 10}:00:00.000Z`, senderAuth: null, attachments: [],
    unread: true, trashed: false, archived: false,
  }]).inserted[0]!;
  if (Object.keys(columns).length) w.store.db.update(t.messages).set(columns).where(eq(t.messages.id, id)).run();
  return id;
}

async function setup({key = true, waitMs = 2000} = {}) {
  const fake = await fakeModels();
  fake.answer(() => answer());
  const w = world({seed: true});
  if (key) setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const reader = new SearchReader({store: w.store, endpoints: fake.endpoints, waitMs});
  // A search read and accepted, whatever the share it hides, as the web sends it back: the chips and
  // words the reading came to, with `read: 'kept'`, and no model. `fallback` says why there's no reading.
  const read = async (text: string, {limit, ...extra}: Record<string, unknown> = {}) => {
    const input = searchSuggestionInput.parse({text, ...extra});
    const {applied: {kept: {matches}, typed, fallback}} = await reader.read(input);
    const out = await reader.search(searchInput.parse({text: matches.text, chips: matches.chips, typed, read: 'kept', account_id: input.account_id, limit}));
    return {...out, fallback};
  };
  const suggest = (text: string, extra: Record<string, unknown> = {}) => reader.suggest(searchSuggestionInput.parse({text, ...extra}));
  const ledger = () => w.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, 'search_reading')).all();
  return {fake, w, reader, read, suggest, ledger};
}

const ids = (out: SearchOut) => out.results.map(result => result.id);
const suggestions = (w: World) => w.store.db.select().from(t.searchSuggestions).orderBy(t.searchSuggestions.id).all();
const labels = (out: SearchOut) => out.chips.map(chip => chip.label);
const reasons = (out: SearchOut, id: number) => out.results.find(result => result.id === id)!.reasons.map(reason => reason.label).join(' · ');
/** A later page or a chip removed, as the client sends them: what the answer gave back. */
const kept = (out: SearchOut) => ({text: out.text, chips: out.chips, typed: out.reading!.typed});

describe('what the model is given', () => {
  test('the facets are the best matches\' organisations and types with counts, most first, and a name a word starts', () => {
    const facets = readingFacets([
      {organisation: 'Contoso Insurance', type: 'statement'}, {organisation: 'Contoso Insurance', type: 'receipt'}, {organisation: 'Proseware', type: 'statement'},
      {organisation: null, type: null},
    ], ['Contoso Insurance', 'Proseware', 'Fabrikam Recruiting', 'Northwind Talent', 'Wingtip Toys'], 'fabri in premium');
    expect(facets).toEqual({
      organisations: [['Contoso Insurance', 2], ['Proseware', 1], ['Fabrikam Recruiting', 0]],
      types: [['statement', 2], ['receipt', 1]],
    });
  });

  test('a word too short or filler brings no name along', () => {
    expect(readingFacets([], ['Fabrikam Recruiting', 'Fourth Coffee'], 'fa first').organisations).toEqual([]);
  });

  test('the input says the day, the facets, the grammar\'s date when there is one, and the search', () => {
    const facets = {organisations: [['Contoso Insurance', 2] as [string, number]], types: []};
    expect(searchReadingInput({search: 'renewal march', today: '2026-10-09', facets, dates: ['Mar 2026']})).toBe([
      'Today: 2026-10-09',
      'Organisations near this search, with how many of the best keyword matches each has: Contoso Insurance (2)',
      'Types in those matches: none',
      'The app found a date in this search: Mar 2026',
      '',
      'Search: renewal march',
    ].join('\n'));
    expect(searchReadingInput({search: 'renewal', today: '2026-10-09', facets, dates: []})).not.toContain('found a date');
  });

  test('the model is Haiku 5.5 with the tool, and it can\'t say a date: only whether the grammar\'s stands', async () => {
    const {fake, read} = await setup();
    await read('lease renewal');
    const [request] = fake.requests;
    expect(request!.model).toBe(SEARCH_READING_MODEL);
    expect(request!.system).toBe(SEARCH_READING_SYSTEM);
    expect(request!.body.tools[0].name).toBe(SEARCH_READING_TOOL.name);
    expect(Object.keys(request!.body.tools[0].input_schema.properties).sort()).toEqual(['is_date', 'keywords', 'organisations', 'types']);
    expect(request!.input).toContain('Today: 2026-10-07');
    expect(request!.input).toContain('Parkside Apartments (');
    expect(request!.input).not.toContain('Woodgrove');
    expect(request!.input).toMatch(/Search: lease renewal$/);
  });

  test('only the best keyword matches are counted', async () => {
    const {fake, w, read} = await setup();
    const day = Date.parse('2026-10-05T17:00:00.000Z');
    for (let at = 0; at < FACET_MATCHES + 2; at += 1) {
      mail(w, 'Quarterly newsletter', {organisation: at < FACET_MATCHES ? 'Contoso Coffee' : 'Fourth Coffee', receivedAt: new Date(day - at * 60_000).toISOString()});
    }
    await read('quarterly');
    expect(fake.requests[0]!.input).toContain(`Contoso Coffee (${FACET_MATCHES})`);
    expect(fake.requests[0]!.input).not.toContain('Fourth Coffee (');
  });

  test('"!words" and quotes never reach it, and nothing but them isn\'t read at all', async () => {
    const {fake, read} = await setup();
    await read('lease "renewal terms" !parkside');
    expect(fake.requests[0]!.input).toMatch(/Search: lease$/);
    fake.requests.length = 0;
    for (const text of ['"lease renewal"', '!parkside', 'march', '"lease" last week']) {
      expect((await read(text)).fallback).toBe('nothing_to_read');
    }
    expect(fake.requests).toEqual([]);
  });

  test('an answer needs its lists, and a wrong type or a repeat doesn\'t count', () => {
    expect(readingOf(null)).toBeNull();
    expect(readingOf({organisations: 'Contoso', types: [], keywords: ''})).toBeNull();
    expect(readingOf({organisations: ['Contoso', 'Contoso', ' ', 7], types: ['receipt', 'memo', 'receipt'], keywords: 'x'})).toEqual({organisations: ['Contoso'], types: ['receipt'], isDate: true, keywords: 'x'});
    expect(readingOf({organisations: ['A', 'B', 'C', 'D', 'E', 'F'], types: [], keywords: ''})!.organisations).toHaveLength(5);
  });
});

describe('filters from the model', () => {
  test('an organisation narrows the words, the "more" number counts what it hid, and left_out lists exactly that', async () => {
    const {fake, w, reader, read} = await setup();
    const chosen = [mail(w, 'Premium notice', {organisation: 'Contoso Insurance'}), mail(w, 'Premium paid', {organisation: 'Contoso Insurance'})];
    const others = [mail(w, 'Premium offer', {organisation: 'Tailspin Toys'}), mail(w, 'Premium wax', {organisation: 'Fourth Coffee'}), mail(w, 'Premium seats')];
    fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'premium'}));
    const out = await read('premium');
    expect(labels(out)).toEqual(['Contoso Insurance']);
    expect(ids(out).sort()).toEqual([...chosen].sort());
    expect(out).toMatchObject({text: 'premium', total: 2, fallback: null, reading: {more: 3, typed: 'premium'}});
    const left = await reader.search(searchInput.parse({...kept(out), read: 'left_out'}));
    expect(ids(left).sort()).toEqual([...others].sort());
    expect(left).toMatchObject({total: 3, chips: [], reading: {more: 3}});
  });

  test('an organisation chip covers names that start with it, as the grammar\'s does', async () => {
    const {fake, w, read} = await setup();
    const first = mail(w, 'Premium notice', {organisation: 'Contoso Insurance'});
    const second = mail(w, 'Premium paid', {organisation: 'Contoso Insurance Claims'});
    mail(w, 'Premium seats', {organisation: 'Contoso Coffee'});
    fake.answer(() => answer({organisations: ['Contoso Insurance', 'Contoso Insurance Claims'], keywords: 'premium'}));
    const out = await read('premium');
    expect(labels(out)).toEqual(['Contoso Insurance']);
    expect(ids(out).sort()).toEqual([first, second].sort());
    expect(out.reading!.more).toBe(1);
  });

  test('an organisation the mail doesn\'t have is no filter, and a name in another case is the same name', async () => {
    const {fake, w, read} = await setup();
    const id = mail(w, 'Premium notice', {organisation: 'Contoso Insurance'});
    fake.answer(() => answer({organisations: ['Nobody Holdings'], keywords: 'premium'}));
    expect(await read('premium')).toMatchObject({chips: [], fallback: null, reading: {more: 0}});
    fake.answer(() => answer({organisations: ['CONTOSO INSURANCE'], keywords: 'premium'}));
    const out = await read('premium notice');
    expect(ids(out)).toEqual([id]);
    expect(out.chips).toEqual([{kind: 'organisation', value: 'Contoso Insurance', label: 'Contoso Insurance'}]);
  });

  test('a type chip finds the classified type, or the word in the subject, summary or terms, never the body (D386)', async () => {
    const {fake, w, read} = await setup();
    const typed = mail(w, 'Gadget order', {type: 'receipt'});
    const subject = mail(w, 'Gadget receipt enclosed');
    const summary = mail(w, 'Gadget order 2', {summary: 'Your receipts are attached'});
    const terms = mail(w, 'Gadget order 3', {searchTerms: 'purchase\nstore receipt'});
    const body = mail(w, 'Gadget newsletter', {body: 'Keep this receipt for your records.'});
    const partOfWord = mail(w, 'Gadget receiptless');
    fake.answer(() => answer({types: ['receipt'], keywords: 'gadget'}));
    const out = await read('gadget receipts');
    expect(labels(out)).toEqual(['Receipt']);
    expect(ids(out).sort()).toEqual([typed, subject, summary, terms].sort());
    expect(ids(out)).not.toContain(body);
    expect(ids(out)).not.toContain(partOfWord);
    // Only the body has the word: the words find it, so the line can show it.
    expect(out.reading!.more).toBeGreaterThanOrEqual(1);
  });

  test('the word a type chip stands for can leave the keywords, so a type reaches mail without it', async () => {
    const {fake, w, read} = await setup();
    const classified = mail(w, 'Your marina account', {type: 'statement', organisation: 'Proseware'});
    const billed = mail(w, 'Marina bill is ready');
    fake.answer(() => answer({types: ['statement'], keywords: 'marina'}));
    const out = await read('marina bill');
    expect(ids(out)).toEqual(expect.arrayContaining([classified, billed]));
    expect(out).toMatchObject({text: 'marina', reading: {typed: 'marina bill'}});
    // The word stays for ranking: what says all of it comes first.
    expect(ids(out)[0]).toBe(billed);
  });

  test('both filters and a date apply together, and the "more" number counts what any of them hid', async () => {
    const {fake, w, read} = await setup();
    const inMonth = mail(w, 'Gadget receipt', {organisation: 'Proseware', receivedAt: '2026-08-12T17:00:00.000Z'});
    mail(w, 'Gadget receipt late', {organisation: 'Proseware', receivedAt: '2026-09-12T17:00:00.000Z'});
    const otherOrg = mail(w, 'Gadget receipt too', {organisation: 'Fourth Coffee', receivedAt: '2026-08-13T17:00:00.000Z'});
    fake.answer(() => answer({organisations: ['Proseware'], types: ['receipt'], keywords: 'gadget'}));
    const out = await read('gadget receipts from proseware august');
    expect(labels(out)).toEqual(['Proseware', 'Receipt', 'Aug 2026']);
    expect(ids(out)).toEqual([inMonth]);
    fake.answer(() => answer({organisations: ['Proseware'], keywords: 'gadget receipt'}));
    const narrower = await read('gadget receipt');
    expect(narrower.reading!.more).toBe(1);
    const dated = await read('gadget receipt august');
    expect(labels(dated)).toEqual(['Proseware', 'Aug 2026']);
    expect(ids(dated)).toEqual([inMonth]);
    // No email has the word "august", so the words as typed find those with some of them, the seed's
    // receipts among them, and the chips hid those too.
    expect(dated.reading).toMatchObject({more: 4, typed: 'gadget receipt august'});
    expect(otherOrg).toBeGreaterThan(0);
  });

  test('keywords can only be typed words: an added word is dropped, and capitals and order stay as typed', async () => {
    const {fake, w, read} = await setup();
    const id = mail(w, 'IT liaison opening', {organisation: 'Fabrikam Recruiting'});
    fake.answer(() => answer({organisations: ['Fabrikam Recruiting'], keywords: 'hiring liaison it'}));
    const out = await read('IT liaison');
    expect(out.text).toBe('IT liaison');
    expect(ids(out)).toEqual([id]);
  });

  test('a reading\'s chips always fit a later request', async () => {
    const {fake, w, read, reader} = await setup();
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map(name => `${name} Proseware`);
    for (const organisation of names) mail(w, 'Gadget notice', {organisation});
    const nots = ['alert', 'receipt', 'rejection', 'reminder', 'deadline', 'shipping', 'newsletter', 'statement', 'confirmation'].map(word => `!${word}`).join(' ');
    fake.answer(() => answer({organisations: names, types: ['verification_code'], keywords: 'gadget'}));
    const out = await read(`gadget ${nots}`);
    expect(out.chips.length).toBe(10);
    await expect(reader.search(searchInput.parse({...kept(out), read: 'kept'}))).resolves.toMatchObject({chips: out.chips});
  });

  test('a reading only narrows: what stays keeps the words\' order', async () => {
    const {fake, w, read} = await setup();
    mail(w, 'Lantern parts', {organisation: 'Fourth Coffee'});
    const older = mail(w, 'A note', {organisation: 'Proseware', body: 'Your lantern parts are here.', receivedAt: '2026-10-01T17:00:00.000Z'});
    const newer = mail(w, 'Lantern parts shipped', {organisation: 'Proseware', receivedAt: '2026-10-02T17:00:00.000Z'});
    const words = searchMail(w.store, searchInput.parse({text: '"lantern parts"'}));
    fake.answer(() => answer({organisations: ['Proseware'], keywords: 'lantern parts'}));
    const out = await read('lantern parts');
    expect(ids(out)).toEqual([newer, older]);
    expect(ids(out)).toEqual(ids(words).filter(id => id === newer || id === older));
    expect(out.order).toBe('match');
  });

  test('a filter that leaves no keywords ranks by the words as typed, whole list', async () => {
    const {fake, w, read} = await setup();
    const named = mail(w, 'Gadget receipt', {organisation: 'Proseware', type: 'receipt', receivedAt: '2026-10-01T17:00:00.000Z'});
    const plain = mail(w, 'Your order', {organisation: 'Proseware', type: 'receipt', receivedAt: '2026-10-02T17:00:00.000Z'});
    mail(w, 'Gadget chatter', {organisation: 'Proseware'});
    fake.answer(() => answer({organisations: ['Proseware'], types: ['receipt'], keywords: ''}));
    const out = await read('gadget receipts from proseware');
    expect(out.text).toBe('');
    expect(ids(out)).toEqual(expect.arrayContaining([named, plain]));
    expect(out.total).toBe(2);
  });
});

describe('dates stay the grammar\'s', () => {
  test('a date chip forms, and its word doesn\'t stay a keyword even when the model keeps it', async () => {
    const {fake, w, read} = await setup();
    const id = mail(w, 'Gadget rebate', {receivedAt: '2026-03-12T17:00:00.000Z'});
    mail(w, 'Gadget rebate again', {receivedAt: '2026-04-12T17:00:00.000Z'});
    fake.answer(() => answer({organisations: ['Billing Desk'], keywords: 'gadget rebate march'}));
    const out = await read('gadget rebate march');
    expect(labels(out)).toEqual(['Mar 2026']);
    expect(out).toMatchObject({text: 'gadget rebate', fallback: null, reading: {more: 1, typed: 'gadget rebate march'}});
    expect(ids(out)).toEqual([id]);
    expect(fake.requests[0]!.input).toContain('The app found a date in this search: Mar 2026');
  });

  test('when the model says the date is a name, there\'s no chip and its words are words', async () => {
    const {fake, w, read} = await setup();
    const id = mail(w, 'March gadget finals', {receivedAt: '2026-10-05T17:00:00.000Z'});
    fake.answer(() => answer({is_date: false, keywords: 'march gadget'}));
    const out = await read('march gadget');
    expect(out).toMatchObject({chips: [], text: 'march gadget', reading: {typed: 'march gadget'}});
    expect(ids(out)).toEqual([id]);
  });

  test('a date without the model is still the grammar\'s', async () => {
    const {w, read} = await setup({key: false});
    const id = mail(w, 'Gadget rebate', {receivedAt: '2026-03-12T17:00:00.000Z'});
    mail(w, 'Gadget rebate again', {receivedAt: '2026-04-12T17:00:00.000Z'});
    const out = await read('gadget rebate march');
    expect(labels(out)).toEqual(['Mar 2026']);
    expect(ids(out)).toEqual([id]);
  });

  test('a date alone reads newest first, its word no rank, though it\'s the word × gives back', async () => {
    const {w, read} = await setup({key: false});
    mail(w, 'A March note', {receivedAt: '2026-03-02T17:00:00.000Z'});
    const newest = mail(w, 'A quiet note', {receivedAt: '2026-03-20T17:00:00.000Z'});
    const out = await read('march');
    expect(out).toMatchObject({text: '', order: 'newest', reading: {typed: 'march'}});
    expect(ids(out)[0]).toBe(newest);
  });
});

describe('exclusions and quotes', () => {
  test('a "!word" still leaves out what it names, as a Not chip or a word, and stays out of the "more" number', async () => {
    const {fake, w, read} = await setup();
    const kept = mail(w, 'Gadget notice', {organisation: 'Contoso Insurance', type: 'statement'});
    mail(w, 'Gadget notice 2', {organisation: 'Contoso Insurance', type: 'alert'});
    mail(w, 'Gadget plain', {organisation: 'Contoso Insurance', body: 'zebrafish here'});
    const other = mail(w, 'Gadget notice 3', {organisation: 'Fourth Coffee'});
    fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'gadget'}));
    const out = await read('gadget !alert !zebrafish');
    expect(fake.requests[0]!.input).toMatch(/Search: gadget$/);
    expect(out.chips).toEqual([{kind: 'organisation', value: 'Contoso Insurance', label: 'Contoso Insurance'}, {kind: 'type', value: 'alert', label: 'Alert', not: true}]);
    expect(out.text).toBe('gadget !zebrafish');
    expect(ids(out)).toEqual([kept]);
    expect(out.reading).toMatchObject({more: 1});
    expect(other).toBeGreaterThan(0);
  });

  test('a "!word" stays in force when the reading falls back', async () => {
    const {w, read} = await setup({key: false});
    const kept = mail(w, 'Gadget notice');
    mail(w, 'Gadget notice 2', {type: 'alert'});
    expect(ids(await read('gadget !alert'))).toEqual([kept]);
  });

  test('quoted words stay required whatever the model\'s keywords, and make no chip', async () => {
    const {fake, w, read} = await setup();
    const id = mail(w, 'Gadget first aid', {organisation: 'Proseware'});
    mail(w, 'Gadget rebate', {organisation: 'Proseware'});
    fake.answer(() => answer({organisations: ['Proseware'], keywords: 'gadget'}));
    const out = await read('gadget "first aid"');
    expect(out.text).toBe('gadget "first aid"');
    expect(ids(out)).toEqual([id]);
  });
});

describe('falling back to the word results', () => {
  const words = (w: World, text: string) => ids(searchMail(w.store, searchInput.parse({text: `"${text}"`}), {log: false}));

  test('no key: no call, and the answer says so', async () => {
    const {fake, w, read} = await setup({key: false});
    const out = await read('lease renewal');
    expect(fake.requests).toEqual([]);
    expect(out).toMatchObject({chips: [], fallback: 'no_key', reading: {more: 0, typed: 'lease renewal'}});
    expect(ids(out)).toEqual(words(w, 'lease renewal'));
  });

  test.each(['overloaded', 'server_error', 'no_tool', 'broken_arguments'] as const)('%s: the word results, and the next pause asks again', async answerWith => {
    const {fake, w, read, ledger} = await setup();
    fake.answer(() => answerWith);
    const out = await read('lease renewal');
    expect(out).toMatchObject({chips: [], fallback: 'failed', reading: {more: 0}});
    expect(ids(out)).toEqual(words(w, 'lease renewal'));
    fake.answer(() => answer());
    expect(await read('lease renewal')).toMatchObject({fallback: null});
    expect(fake.requests).toHaveLength(2);
    expect(ledger().length).toBeLessThanOrEqual(2);
  });

  test('slow: the words come when the wait is up, and the late answer lands in the ledger and the next pause', async () => {
    const {fake, w, read, ledger} = await setup({waitMs: 40});
    const id = mail(w, 'Premium notice', {organisation: 'Contoso Insurance'});
    mail(w, 'Premium offer', {organisation: 'Fourth Coffee'});
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const slowFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      await held;
      return slowFetch(...args);
    };
    fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'premium'}));
    try {
      const out = await read('premium');
      expect(out).toMatchObject({chips: [], total: 2, fallback: 'slow'});
    } finally {
      globalThis.fetch = slowFetch;
      release();
    }
    await expect.poll(() => ledger().length).toBe(1);
    const next = await read('premium');
    expect(next).toMatchObject({fallback: null, total: 1});
    expect(ids(next)).toEqual([id]);
    expect(fake.requests).toHaveLength(1);
  });

  test('filters that leave nothing: the word results, with no chips and nothing to say is more', async () => {
    const {fake, w, read} = await setup();
    mail(w, 'Home plumbing tips', {organisation: 'Fourth Coffee'});
    mail(w, 'Premium notice', {organisation: 'Contoso Insurance'});
    fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'home plumbing'}));
    const out = await read('home plumbing');
    expect(out).toMatchObject({chips: [], text: 'home plumbing', total: 1, fallback: 'left_nothing', reading: {more: 0}});
  });

  test('filters that leave nothing keep the date the grammar read', async () => {
    const {fake, w, read} = await setup();
    mail(w, 'Gadget rebate', {organisation: 'Fourth Coffee', receivedAt: '2026-03-12T17:00:00.000Z'});
    fake.answer(() => answer({organisations: ['Parkside Apartments'], keywords: 'gadget rebate'}));
    const out = await read('gadget rebate march');
    expect(labels(out)).toEqual(['Mar 2026']);
    expect(out).toMatchObject({total: 1, fallback: 'left_nothing'});
  });
});

describe('asking only when the search says so', () => {
  test('a search without `read` never reaches the model, and its words form no chip, a date\'s neither', async () => {
    const {fake, reader} = await setup();
    const out = await reader.search(searchInput.parse({text: 'northwind rejection march'}));
    expect(fake.requests).toEqual([]);
    expect(out).toMatchObject({chips: [], text: 'northwind rejection march', order: 'match', reading: null});
  });

  test('with no words left there\'s nothing to say more about', async () => {
    const {w, reader} = await setup();
    mail(w, 'Gadget notice', {organisation: 'Fourth Coffee'});
    const organisation = {kind: 'organisation', value: 'Proseware', label: 'Proseware'};
    const date = {kind: 'date', from: '2026-10-01', to: '2026-11-01', label: 'Oct 2026'};
    const out = await reader.search(searchInput.parse({text: '', typed: '', chips: [organisation, date], read: 'kept'}));
    expect(out.reading!.more).toBe(0);
  });

  test('a later page and a chip removed keep what was read, with no model call, and the word comes back', async () => {
    const {fake, w, reader, read} = await setup();
    const chosen = [1, 2, 3].map(at => mail(w, `Gadget receipt ${at}`, {organisation: 'Proseware', type: 'receipt'}));
    const other = mail(w, 'Gadget receipt 4', {organisation: 'Fourth Coffee', type: 'receipt'});
    const stray = mail(w, 'Gadget note', {organisation: 'Proseware'});
    fake.answer(() => answer({organisations: ['Proseware'], types: ['receipt'], keywords: 'gadget'}));
    const first = await read('gadget receipts', {limit: 2});
    expect(first).toMatchObject({total: 3, next_offset: 2, text: 'gadget', reading: {more: 1}});
    const second = await reader.search(searchInput.parse({...kept(first), read: 'kept', search_id: first.search_id, offset: 2, limit: 2}));
    expect(second).toMatchObject({search_id: first.search_id, total: 3, next_offset: null, reading: {more: 1}});
    expect([...ids(first), ...ids(second)].sort()).toEqual([...chosen].sort());
    expect(searchLogEntry(w.store, first.search_id)!.resultIds).toHaveLength(3);
    // Org Proseware off: the words as typed, with the type chip left.
    const typed = first.reading!.typed;
    const wider = await reader.search(searchInput.parse({text: typed, typed, chips: first.chips.filter(chip => chip.kind === 'type'), read: 'kept'}));
    expect(ids(wider)).toEqual(expect.arrayContaining([...chosen, other]));
    expect(ids(wider)).not.toContain(stray);
    expect(wider.reading!.more).toBe(0);
    // Both off: the word results.
    const plain = await reader.search(searchInput.parse({text: typed, read: 'kept'}));
    expect(plain).toMatchObject({chips: [], reading: {more: 0}});
    expect(fake.requests).toHaveLength(1);
  });

  test('chips the client holds stay filters through a new reading, and count in the "more" number', async () => {
    const {w, read} = await setup({key: false});
    const id = mail(w, 'Gadget notice', {organisation: 'Proseware'});
    mail(w, 'Gadget notice 2', {organisation: 'Fourth Coffee'});
    const out = await read('gadget', {chips: [{kind: 'organisation', value: 'Proseware', label: 'Proseware'}]});
    expect(ids(out)).toEqual([id]);
    expect(out).toMatchObject({fallback: 'no_key', reading: {more: 1}});
  });
});

describe('readings held briefly', () => {
  test('a repeat, spaced or cased differently, asks nothing and gets the same chips, and is logged as held', async () => {
    const {fake, w, read, suggest, ledger} = await setup();
    mail(w, 'Premium notice', {organisation: 'Contoso Insurance'});
    mail(w, 'Premium offer', {organisation: 'Fourth Coffee'});
    let answers = 0;
    fake.answer(() => {
      answers += 1;
      return answer({organisations: answers === 1 ? ['Contoso Insurance'] : [], keywords: 'premium'});
    });
    const first = await read('premium');
    const repeat = await read('  PREMIUM ');
    expect(labels(repeat)).toEqual(labels(first));
    expect(fake.requests).toHaveLength(1);
    expect(ledger()).toHaveLength(1);
    const {suggestion} = await suggest('premium');
    expect(suggestions(w).find(row => row.id === suggestion!.id)!.reading).toMatchObject({source: 'cache'});
  });

  test('a repeat at the same moment shares one call', async () => {
    const {fake, read} = await setup();
    await Promise.all([read('lease renewal'), read('lease renewal')]);
    expect(fake.requests).toHaveLength(1);
  });

  test('it\'s asked again once the time is up, the day changes, or the account or words differ', async () => {
    const {fake, w, read} = await setup();
    await read('lease renewal');
    w.advance(READING_HELD_MS - 1);
    await read('lease renewal');
    expect(fake.requests).toHaveLength(1);
    w.advance(1);
    await read('lease renewal');
    expect(fake.requests).toHaveLength(2);
    await read('lease');
    expect(fake.requests).toHaveLength(3);
    await read('lease', {account_id: w.store.db.select().from(t.accounts).get()!.id});
    expect(fake.requests).toHaveLength(4);
    w.at('2026-10-08T17:00:00.000Z');
    await read('lease');
    expect(fake.requests).toHaveLength(5);
  });
});

describe('the ledger and the log', () => {
  test('each call is in the ledger as search_reading, with no email, and Settings › AI shows it apart', async () => {
    const {fake, w, read, ledger} = await setup();
    fake.answer(() => ({...answer() as object, usage: {input: 1200, output: 40}}) as FakeAnswer);
    await read('lease renewal');
    expect(ledger()).toMatchObject([{provider: 'anthropic', model: SEARCH_READING_MODEL, messageId: null, inputTokens: 1200, outputTokens: 40, costMicros: 140}]);
    const {usage_this_month: usage} = aiOverview(w.store);
    expect(usage.search_reading).toMatchObject({calls: 1, input_tokens: 1200, output_tokens: 40});
    expect(usage.search_terms.calls).toBe(0);
  });

  test('the log holds each suggestion with what the model said and what came of it; a search without one holds no reading', async () => {
    const {fake, w, reader, suggest} = await setup();
    mail(w, 'Premium notice', {organisation: 'Contoso Insurance'});
    mail(w, 'Premium offer', {organisation: 'Fourth Coffee'});
    const typing = await reader.search(searchInput.parse({text: 'premium'}));
    expect(searchLogEntry(w.store, typing.search_id)!.reading).toBeNull();
    fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'premium'}));
    const {suggestion} = await suggest('premium');
    expect(suggestions(w)).toMatchObject([{
      id: suggestion!.id, query: 'premium', chips: suggestion!.chips, words: 2, hides: 1, total: 1, shownAt: null, acceptedAt: null, searchId: null,
      reading: {source: 'model', fallback: null, prompt: SEARCH_READING_PROMPT_VERSION, organisations: ['Contoso Insurance'], types: [], keywords: 'premium', is_date: true, more: 1},
    }]);
    expect(suggestions(w)[0]!.reading!.ms).toBeGreaterThanOrEqual(0);
  });

  test('POST /api/search/suggestion reads, /api/search takes what it said with `read: kept`, and the log hears shown, accepted and a chip removed', async () => {
    const fake = await fakeModels();
    const w = world({seed: true});
    setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    fake.answer(() => answer({organisations: ['Parkside Apartments'], keywords: 'renewal'}));
    const c = await signedIn(w, {reading: {endpoints: fake.endpoints}});
    expect((await c.send('POST', '/api/search', {body: {text: 'renewal'}})).body.reading).toBeNull();
    expect(fake.requests).toEqual([]);
    const {body: first} = await c.send('POST', '/api/search/suggestion', {body: {text: 'renewal', model: false}});
    expect(first).toEqual({suggestion: null, reads: true});
    expect(fake.requests).toEqual([]);
    const {body: {suggestion}, status} = await c.send('POST', '/api/search/suggestion', {body: {text: 'renewal'}});
    expect(status).toBe(200);
    expect(suggestion.offers).toEqual([{kind: 'organisation', value: 'Parkside Apartments', label: 'Parkside Apartments'}]);
    expect(fake.requests).toHaveLength(1);
    expect((await c.send('POST', '/api/search/suggestion-log', {body: {id: suggestion.id, event: 'shown'}})).status).toBe(204);
    const {body: out} = await c.send('POST', '/api/search', {body: {text: suggestion.text, chips: suggestion.chips, typed: suggestion.typed, read: 'kept'}});
    expect(out.total).toBe(suggestion.total);
    expect(fake.requests).toHaveLength(1);
    expect(searchLogEntry(w.store, out.search_id)).toMatchObject({query: 'renewal', reading: {source: 'kept', more: suggestion.hides}});
    expect((await c.send('POST', '/api/search/suggestion-log', {body: {id: suggestion.id, event: 'accepted', search_id: out.search_id}})).status).toBe(204);
    const [logged] = suggestions(w);
    expect(logged).toMatchObject({searchId: out.search_id});
    expect(logged!.shownAt && logged!.acceptedAt).toBeTruthy();
    const chip = out.chips[0];
    expect((await c.send('POST', '/api/search/chip-removed', {body: {search_id: out.search_id, chip}})).status).toBe(204);
    expect(searchLogEntry(w.store, out.search_id)).toMatchObject({removed: [chip]});
    expect((await c.send('POST', '/api/search/chip-removed', {body: {search_id: 9999, chip}})).status).toBe(404);
    expect((await c.send('POST', '/api/search/chip-removed', {body: {search_id: out.search_id, chip: {kind: 'type', value: 'memo', label: 'Memo'}}})).status).toBe(400);
    expect((await c.send('POST', '/api/search/suggestion-log', {body: {id: 9999, event: 'shown'}})).status).toBe(404);
    expect((await c.send('POST', '/api/search/suggestion-log', {body: {id: suggestion.id, event: 'liked'}})).status).toBe(400);
    expect((await c.send('POST', '/api/search', {body: {text: 'renewal', read: 'ask'}})).status).toBe(400);
    expect((await c.send('POST', '/api/search/opened', {body: {search_id: out.search_id, message_id: out.results[0].id, position: 0}})).status).toBe(204);
  });
});

describe('when a suggestion is worth offering', () => {
  /** `premium` found in `chosen` emails from Contoso Insurance and `others` from elsewhere. */
  async function premium(chosen: number, others: number) {
    const set = await setup();
    for (let at = 0; at < chosen; at += 1) mail(set.w, `Premium notice ${at}`, {organisation: 'Contoso Insurance'});
    for (let at = 0; at < others; at += 1) mail(set.w, `Premium offer ${at}`, {organisation: 'Fourth Coffee'});
    set.fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'premium'}));
    return set;
  }

  test.each([
    ['hiding exactly the share', 4, 1, true],
    ['hiding a little more', 3, 1, true],
    ['hiding a little less', 5, 1, false],
    ['hiding nothing', 3, 0, false],
    ['leaving one of two', 1, 1, true],
  ])('%s: %i kept, %i hidden', async (_case, chosen, others, offered) => {
    expect(SUGGESTION_HIDES).toBe(0.2);
    const {suggest} = await premium(chosen, others);
    const {suggestion} = await suggest('premium');
    expect(suggestion !== null).toBe(offered);
    if (offered) expect(suggestion).toMatchObject({total: chosen, hides: others, words: chosen + others, offers: [{label: 'Contoso Insurance'}], text: 'premium', typed: 'premium'});
  });

  test('a filter that would leave nothing isn\'t offered, whatever it would hide', async () => {
    const {fake, w, suggest} = await setup();
    mail(w, 'Premium notice', {organisation: 'Fourth Coffee'});
    mail(w, 'A note', {organisation: 'Contoso Insurance'});
    fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'premium'}));
    expect((await suggest('premium')).suggestion).toBeNull();
  });

  test('nothing to narrow but a date is a suggestion with no model, and with no word results any date that finds mail is one', async () => {
    const {fake, w, suggest} = await setup({key: false});
    mail(w, 'A quiet note', {receivedAt: '2026-03-12T17:00:00.000Z'});
    const first = await suggest('march', {model: false});
    expect(first).toMatchObject({reads: false, suggestion: {offers: [{label: 'Mar 2026'}], hides: 0, words: 0, text: '', typed: 'march', undated: ''}});
    expect(fake.requests).toEqual([]);
    expect((await suggest('2019')).suggestion).toBeNull();
  });

  test('a date first by itself, then with the reading; a name the model says it is takes the date away', async () => {
    const {fake, w, suggest} = await setup();
    mail(w, 'March gadget notice', {organisation: 'Proseware', receivedAt: '2026-03-12T17:00:00.000Z'});
    mail(w, 'March gadget note', {organisation: 'Fourth Coffee', receivedAt: '2026-03-13T17:00:00.000Z'});
    mail(w, 'March gadget again', {organisation: 'Proseware', receivedAt: '2026-04-13T17:00:00.000Z'});
    expect(await suggest('gadget march', {model: false})).toMatchObject({reads: true, suggestion: {offers: [{label: 'Mar 2026'}], total: 2}});
    expect(fake.requests).toEqual([]);
    fake.answer(() => answer({organisations: ['Proseware'], keywords: 'gadget'}));
    expect(await suggest('gadget march')).toMatchObject({reads: false, suggestion: {offers: [{label: 'Proseware'}, {label: 'Mar 2026'}], total: 1, text: 'gadget', typed: 'gadget march', undated: 'gadget'}});
    fake.answer(() => answer({is_date: false, keywords: 'gadget march'}));
    expect((await suggest('march gadget')).suggestion).toBeNull();
  });

  test('a date hides by what the words find, not by what fills the month', async () => {
    const {w, suggest} = await setup({key: false});
    mail(w, 'Gadget one', {receivedAt: '2026-03-12T17:00:00.000Z'});
    for (let at = 0; at < 4; at += 1) mail(w, `Gadget in spring ${at}`, {receivedAt: '2026-03-20T17:00:00.000Z'});
    expect((await suggest('gadget march')).suggestion).toBeNull();
    mail(w, 'March gadget', {receivedAt: '2026-05-20T17:00:00.000Z'});
    mail(w, 'March gadget too', {receivedAt: '2026-05-20T17:00:00.000Z'});
    expect((await suggest('gadget march')).suggestion).toMatchObject({offers: [{label: 'Mar 2026'}], total: 5, hides: 2, words: 2});
  });

  test('no key, a failed call, or quotes and "!words" alone: nothing to say and no call', async () => {
    const noKey = await setup({key: false});
    mail(noKey.w, 'Premium notice', {organisation: 'Contoso Insurance'});
    expect(await noKey.suggest('premium', {model: false})).toEqual({suggestion: null, reads: false});
    const {fake, w, suggest} = await premium(1, 3);
    fake.answer(() => 'overloaded');
    expect(await suggest('premium')).toEqual({suggestion: null, reads: false});
    fake.requests.length = 0;
    for (const text of ['"premium notice"', '!premium']) expect(await suggest(text, {model: false})).toMatchObject({suggestion: null, reads: false});
    expect(suggestions(w)).toEqual([]);
  });

  test('a "!word"\'s chip stays what the user typed: in force, kept, and never what\'s offered', async () => {
    const {fake, w, reader, suggest} = await premium(2, 2);
    mail(w, 'Premium alert', {organisation: 'Contoso Insurance', type: 'alert'});
    fake.answer(() => answer({organisations: ['Contoso Insurance'], keywords: 'premium'}));
    const {suggestion} = await suggest('premium !alert');
    expect(suggestion).toMatchObject({offers: [{label: 'Contoso Insurance'}], total: 2, hides: 2, text: 'premium', typed: 'premium'});
    expect(suggestion!.chips.map(chip => chip.label)).toEqual(['Contoso Insurance', 'Alert']);
    const out = await reader.search(searchInput.parse({text: suggestion!.text, chips: suggestion!.chips, typed: suggestion!.typed, read: 'kept'}));
    expect(out).toMatchObject({total: 2, reading: {more: 2}});
  });
});

describe('a row says why it\'s there', () => {
  test('found only through a type a word names: the word search says the type', async () => {
    const {reader, w} = await setup();
    const id = mail(w, 'A word from Proseware', {type: 'rejection', organisation: 'Proseware', body: 'We went another way.'});
    const out = await reader.search(searchInput.parse({text: 'proseware rejections', read: 'kept'}));
    expect(reasons(out, id)).toBe('Type Rejection · Org proseware');
    expect(out.results.find(result => result.id === id)!.reasons[0]).toEqual({field: 'type', label: 'Type Rejection', matched: []});
  });

  test('a word the email says needs no type reason', async () => {
    const {reader, w} = await setup();
    const id = mail(w, 'Your rejection notice', {type: 'rejection', organisation: 'Proseware'});
    const out = await reader.search(searchInput.parse({text: 'proseware rejection', read: 'kept'}));
    expect(reasons(out, id)).toBe('Org proseware · Subject rejection');
  });

  test('found by a reading\'s type chip: the classified type, or the word and where it was, which is highlighted', async () => {
    const {fake, w, read} = await setup();
    const sender = {fromName: 'Proseware', fromAddress: 'news@proseware.example'};
    const typed = mail(w, 'Gadget account', {...sender, type: 'statement'});
    const subject = mail(w, 'Gadget bill ready', sender);
    const summary = mail(w, 'Gadget account 2', {...sender, summary: 'The latest statement for you'});
    fake.answer(() => answer({types: ['statement'], keywords: 'gadget'}));
    const out = await read('gadget bill');
    expect(reasons(out, typed)).toBe('Type Statement · Subject gadget');
    expect(reasons(out, subject)).toBe('Subject gadget bill');
    expect(reasons(out, summary)).toBe('Subject gadget · Body statement');
    const row = out.results.find(result => result.id === subject)!;
    const highlighted = row.highlights.filter(run => run.field === 'subject').map(run => row.subject.slice(run.start, run.end));
    expect(highlighted).toEqual(['Gadget', 'bill']);
  });
});
