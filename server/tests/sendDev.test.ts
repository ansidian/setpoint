// The dev provider's send, on the seed, as `npm run try` runs it: a sent email shows in Sent as if
// the provider had accepted it, and mail to refused.example fails in a provider's words. No network.
import {SEND_HOLD_MS} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {devProvider} from '../src/providers/dev/index.ts';
import {SendWorker} from '../src/sending/worker.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {signedIn, world} from './helpers.ts';

const THEO = 55;
const paragraph = (text: string) => [{type: 'paragraph', runs: [{text, marks: [], href: null}]}];

async function setup() {
  const w = world({seed: true});
  const engine: SyncEngine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider()), workers: [new SendWorker({
    store: w.store, send: (sourceId, mail) => engine.sendMail(sourceId, mail), findSent: (sourceId, query) => engine.findSent(sourceId, query),
    attachment: (sourceId, message, id) => engine.attachment(sourceId, message, id),
  })]});
  const api = await signedIn(w, {engine});
  const sendDraft = async (start: Record<string, unknown>, fields: Record<string, unknown>) => {
    const draft = (await api.send('POST', '/api/mail/drafts', {body: start})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: fields});
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    for (let round = 0; round < 5; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.kind, 'send'), lte(t.jobs.runAt, w.store.now().toISOString()), eq(t.jobs.state, 'queued'))).all().length) break;
    }
    return draft.id as number;
  };
  return {w, api, sendDraft};
}

test('a reply sent in a dev run lands in Sent, and its email says "You replied"', async () => {
  const {api, sendDraft} = await setup();
  const before = (await api.send('GET', '/api/mail/sent')).body.days.flatMap((day: {rows: unknown[]}) => day.rows).length;
  const draftId = await sendDraft({kind: 'reply', message_id: THEO}, {body: paragraph('Count me in.')});
  expect((await api.send('GET', `/api/mail/drafts/${draftId}`)).status).toBe(404);
  const rows = (await api.send('GET', '/api/mail/sent')).body.days.flatMap((day: {rows: {subject: string}[]}) => day.rows);
  expect(rows).toHaveLength(before + 1);
  expect(rows[0]).toMatchObject({subject: 'Re: Cabin weekend in November', sent_only: true, to: [{name: 'Theo Walsh', address: 'theo.walsh@example.org'}]});
  expect((await api.send('GET', `/api/mail/messages/${THEO}`)).body.replied_at).toBeDefined();
});

test('a reply whose quote the user trimmed sends the trimmed quote', async () => {
  const {api, sendDraft} = await setup();
  await sendDraft({kind: 'reply', message_id: THEO}, {body: paragraph('Count me in.'), quote: paragraph('Only this line')});
  const rows = (await api.send('GET', '/api/mail/sent')).body.days.flatMap((day: {rows: {id: number}[]}) => day.rows);
  const sent = (await api.send('GET', `/api/mail/messages/${rows[0]!.id}`)).body;
  expect(sent.body_text).toMatch(/Count me in\.\n\nOn .+, Theo Walsh wrote:\n> Only this line$/);
});

test('mail to refused.example fails in a provider\'s words and keeps the draft', async () => {
  const {api, sendDraft} = await setup();
  const draftId = await sendDraft({kind: 'new'}, {to: [{name: null, address: 'nobody@refused.example'}], subject: 'Hello', body: paragraph('Hi.')});
  expect((await api.send('GET', `/api/mail/drafts/${draftId}`)).body).toMatchObject({
    body: paragraph('Hi.'), send: {state: 'failed', error: '550 5.1.1 <nobody@refused.example>: Recipient address rejected: User unknown'},
  });
});
