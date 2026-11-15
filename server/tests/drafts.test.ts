// Drafts through the API, on the seed: started filled on the server, one per email and kind, saved
// as the user types, listed, discarded, marked on their email's row, and held by Send for Undo.
import {SEED_NOW, SEND_HOLD_MS} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {removeMessages} from '../src/sync/mailMirror.ts';
import {liveEvents, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

// The seed: Business (1) is user@studio.example.com, Personal (2) user@example.com, Work (3)
// user@work.example.org. Theo Walsh's last email to Personal is 55, and the last mail the user
// sent went from Work.
const THEO = 55;
const SAM_LEE = 21;
const PERSONAL = 2;
const BUSINESS = 1;
const WORK = 3;

async function setup() {
  const w = world({seed: true});
  const api = await signedIn(w);
  return {w, api};
}

const setHeaders = (w: World, id: number, fields: Partial<typeof t.messages.$inferInsert>) =>
  w.store.db.update(t.messages).set(fields).where(eq(t.messages.id, id)).run();

const body = (text: string) => [{type: 'paragraph', runs: [{text, marks: [], href: null}]}];

describe('Starting a draft', () => {
  test('a reply is filled on the server: to the sender, its subject, from the address the email came to', async () => {
    const {api} = await setup();
    const started = await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}});
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({
      kind: 'reply', message_id: THEO, from: {account_id: PERSONAL, address: 'user@example.com'},
      to: [{name: 'Theo Walsh', address: 'theo.walsh@example.org'}], cc: [], bcc: [], subject: 'Re: Cabin weekend in November', body: [], send: null,
    });
  });

  test('reply all adds the others less the user\'s own addresses; Reply-To answers when set', async () => {
    const {w, api} = await setup();
    setHeaders(w, SAM_LEE, {
      toRecipients: [{name: 'User', address: 'user@example.com'}, {name: 'June Park', address: 'june.park@example.org'}],
      ccRecipients: [{name: null, address: 'user@studio.example.com'}, {name: 'Ravi Menon', address: 'ravi.menon@example.org'}],
      replyTo: [{name: 'Sam (home)', address: 'sam.home@example.com'}],
    });
    const all = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply_all', message_id: SAM_LEE}})).body;
    expect({to: all.to, cc: all.cc, subject: all.subject}).toEqual({
      to: [{name: 'Sam (home)', address: 'sam.home@example.com'}, {name: 'June Park', address: 'june.park@example.org'}],
      cc: [{name: 'Ravi Menon', address: 'ravi.menon@example.org'}], subject: 'Re: Dinner Friday?',
    });
  });

  test('one draft per email and kind: starting it again returns it as it was left', async () => {
    const {api} = await setup();
    const reply = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}})).body;
    await api.send('PATCH', `/api/mail/drafts/${reply.id}`, {body: {body: body('Count me in.')}});
    const again = await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}});
    expect(again.body).toMatchObject({id: reply.id, body: body('Count me in.')});
    const forward = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'forward', message_id: THEO}})).body;
    const all = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply_all', message_id: THEO}})).body;
    expect(new Set([reply.id, forward.id, all.id]).size).toBe(3);
    expect(forward).toMatchObject({to: [], subject: 'Fwd: Re: Cabin weekend in November'});
    // New messages are any number.
    const first = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    const second = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    expect(first.id).not.toBe(second.id);
    expect((await api.send('GET', '/api/mail/drafts')).body.count).toBe(5);
  });

  test('a new message starts from the account last sent from, or the one asked for', async () => {
    const {api} = await setup();
    expect((await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body).toMatchObject({message_id: null, from: {account_id: WORK, address: 'user@work.example.org'}, to: [], subject: ''});
    expect((await api.send('POST', '/api/mail/drafts', {body: {kind: 'new', account_id: BUSINESS}})).body.from).toEqual({account_id: BUSINESS, address: 'user@studio.example.com'});
  });

  test.each([
    [{kind: 'reply'}, 400],
    [{kind: 'new', message_id: THEO}, 400],
    [{kind: 'reply', message_id: 9999}, 404],
  ])('%j is refused', async (input, status) => {
    const {api} = await setup();
    expect((await api.send('POST', '/api/mail/drafts', {body: input})).status).toBe(status);
  });
});

describe('From', () => {
  test('each account with its own address and the name it last sent with, then its aliases; a new message\'s account', async () => {
    const {api} = await setup();
    const from = (await api.send('GET', '/api/mail/from')).body;
    expect(from.default_account_id).toBe(WORK);
    expect(from.accounts.map((account: {account_id: number}) => account.account_id)).toEqual([1, 2, 3, 4, 5]);
    expect(from.accounts[1]).toEqual({account_id: PERSONAL, addresses: [{address: 'user@example.com', name: 'User', primary: true}]});
    // Business's "Send mail as" list in the seed: its own address, then an alias.
    expect(from.accounts[0].addresses).toEqual([{address: 'user@studio.example.com', name: 'User', primary: true}, {address: 'hello@studio.example.com', name: 'Studio', primary: false}]);
  });
});

describe('Saving', () => {
  test('only the fields sent change, the last write wins, and the answer is small', async () => {
    const {api} = await setup();
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    const saved = await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {subject: 'Lunch', to: [{name: 'Sam Ortiz', address: 'Sam.Ortiz@Example.org'}], body: body('Noon?')}});
    expect(saved.body).toEqual({id: draft.id, updated_at: SEED_NOW});
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {body: body('Noon? Or 1?')}});
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {bcc: [{name: null, address: 'june.park@example.org'}], from: {account_id: BUSINESS, address: 'user@studio.example.com'}}});
    expect((await api.send('GET', `/api/mail/drafts/${draft.id}`)).body).toMatchObject({
      subject: 'Lunch', to: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}], bcc: [{name: null, address: 'june.park@example.org'}],
      body: body('Noon? Or 1?'), from: {account_id: BUSINESS, address: 'user@studio.example.com'},
    });
  });

  test('a reply\'s quote is the full original until the user trims it, and null puts it back', async () => {
    const {api} = await setup();
    const reply = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}})).body;
    expect(reply.quote).toBeNull();
    await api.send('PATCH', `/api/mail/drafts/${reply.id}`, {body: {quote: body('Only this line')}});
    expect((await api.send('GET', `/api/mail/drafts/${reply.id}`)).body.quote).toEqual(body('Only this line'));
    await api.send('PATCH', `/api/mail/drafts/${reply.id}`, {body: {quote: null}});
    expect((await api.send('GET', `/api/mail/drafts/${reply.id}`)).body.quote).toBeNull();
  });

  test.each([
    [{from: {account_id: BUSINESS, address: 'user@example.com'}}, 'From is not one of that account\'s addresses.'],
    [{to: [{name: null, address: 'not an address'}]}, 'to.0.address: Not an email address.'],
    [{body: [{type: 'script', text: 'x'}]}, null],
    [{cc: [], extra: true}, null],
  ])('%j is refused', async (input, message) => {
    const {api} = await setup();
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    const refused = await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: input});
    expect(refused.status).toBe(400);
    if (message) expect(refused.body.error.message).toBe(message);
  });
});

describe('Listing and discarding', () => {
  test('Drafts lists the last changed first, its email\'s row carries the mark, and Discard takes it away', async () => {
    const {w, api} = await setup();
    const reply = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}})).body;
    w.advance(60_000);
    const fresh = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    w.advance(60_000);
    await api.send('PATCH', `/api/mail/drafts/${reply.id}`, {body: {body: body('Count me in, see you Friday.')}});
    const listed = (await api.send('GET', '/api/mail/drafts')).body;
    expect(listed).toMatchObject({count: 2, drafts: [
      {id: reply.id, kind: 'reply', message_id: THEO, account_id: PERSONAL, subject: 'Re: Cabin weekend in November', snippet: 'Count me in, see you Friday.', send_state: null},
      {id: fresh.id, kind: 'new', message_id: null},
    ]});
    expect((await api.send('GET', `/api/mail/messages/${THEO}`)).body.draft).toBe(true);
    expect((await api.send('GET', `/api/mail/messages/${THEO - 2}`)).body.draft).toBeUndefined();
    expect(liveEvents(w).some(event => event.type === 'mail' && event.drafts?.includes(reply.id) && event.messages.includes(THEO))).toBe(true);

    expect((await api.send('DELETE', `/api/mail/drafts/${reply.id}`)).status).toBe(204);
    expect((await api.send('GET', `/api/mail/drafts/${reply.id}`)).status).toBe(404);
    expect((await api.send('GET', '/api/mail/drafts')).body.count).toBe(1);
    expect((await api.send('GET', `/api/mail/messages/${THEO}`)).body.draft).toBeUndefined();
  });

  test('a draft outlives its email: the user\'s text stays, answering nothing', async () => {
    const {w, api} = await setup();
    const reply = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}})).body;
    await api.send('PATCH', `/api/mail/drafts/${reply.id}`, {body: {body: body('Still here.')}});
    const row = w.store.db.select().from(t.messages).where(eq(t.messages.id, THEO)).get()!;
    removeMessages(w.store, row.accountId, [row.providerId]);
    expect((await api.send('GET', `/api/mail/drafts/${reply.id}`)).body).toMatchObject({message_id: null, body: body('Still here.')});
  });
});

describe('Send holds the email for Undo', () => {
  test('held for six seconds and frozen; Undo returns the draft untouched', async () => {
    const {w, api} = await setup();
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {body: body('Count me in.')}});
    const held = await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    expect(held.body.send).toEqual({state: 'held', send_at: new Date(Date.parse(SEED_NOW) + SEND_HOLD_MS).toISOString(), error: null});
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'send')).all()).toMatchObject([{draftId: draft.id, state: 'queued', runAt: held.body.send.send_at}]);
    // A late save can't change what goes out, nor can a second Send or a Discard.
    expect((await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {subject: 'Changed'}})).body.error.code).toBe('draft_held');
    expect((await api.send('POST', `/api/mail/drafts/${draft.id}/send`)).status).toBe(409);
    expect((await api.send('GET', '/api/mail/drafts')).body.drafts[0].send_state).toBe('held');

    w.advance(5000);
    const undone = await api.send('POST', `/api/mail/drafts/${draft.id}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body).toMatchObject({id: draft.id, send: null, body: body('Count me in.'), subject: 'Re: Cabin weekend in November', to: draft.to});
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'send')).all()).toEqual([]);
    expect((await api.send('POST', `/api/mail/drafts/${draft.id}/undo`)).body.error.code).toBe('draft_not_held');
  });

  test('a draft with no one to send to is refused', async () => {
    const {api} = await setup();
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    const refused = await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    expect(refused).toMatchObject({status: 400, body: {error: {message: 'Add someone to send it to.'}}});
  });

  test('discarding a held draft takes its send with it', async () => {
    const {w, api} = await setup();
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: THEO}})).body;
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    expect((await api.send('DELETE', `/api/mail/drafts/${draft.id}`)).status).toBe(204);
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'send')).all()).toEqual([]);
  });
});
