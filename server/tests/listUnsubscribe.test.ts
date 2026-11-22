// Unsubscribe: an email's List-Unsubscribe https address, read as it arrives from Gmail and iCloud,
// kept on its row and answered as the reader's `unsubscribe_url`. A mailto or plain http is no link.
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {unsubscribeUrl} from '../src/domain/listUnsubscribe.ts';
import {Notifier} from '../src/notify/index.ts';
import {GmailAdapter} from '../src/providers/gmail/adapter.ts';
import {gmailConnector} from '../src/providers/gmail/connect.ts';
import {ICloudAdapter, icloudConnector} from '../src/providers/icloud/index.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeGoogle} from './fakeGoogle.ts';
import {fakeImap} from './fakeImap.ts';
import {client, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {gmailVerdict, rawEmail} from './rawEmail.ts';

const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();
const LIST: [string, string][] = [['List-Unsubscribe', '<mailto:leave@contoso.example?subject=unsubscribe>,\r\n <https://contoso.example/unsubscribe?u=41>']];

describe('unsubscribeUrl', () => {
  test.each<[string, string | undefined, string | null]>([
    ['a mailto then an https address gives the https one', '<mailto:a@x.example>, <https://x.example/u>', 'https://x.example/u'],
    ['a value folded across lines', '<mailto:a@x.example>,\r\n\t<https://x.example/u?id=7>', 'https://x.example/u?id=7'],
    ['a mailto only gives none', '<mailto:a@x.example?subject=unsubscribe>', null],
    ['plain http gives none', '<http://x.example/u>', null],
    ['two https addresses give the first', '<https://x.example/first>, <https://x.example/second>', 'https://x.example/first'],
    ['an unparseable entry is passed over', '<not a url>, <https://x.example/u>', 'https://x.example/u'],
    ['garbage gives none', 'unsubscribe here', null],
    ['an empty value gives none', '', null],
    ['no header gives none', undefined, null],
  ])('%s', (_, value, expected) => {
    expect(unsubscribeUrl(value)).toBe(expected);
  });
});

/** Runs the engine until nothing due is queued. */
async function drained(w: World, engine: SyncEngine) {
  for (let round = 0; round < 40; round += 1) {
    await engine.tick();
    await engine.settled();
    if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length) return;
  }
  throw new Error('The engine never went idle.');
}

const idOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;

describe('An email arriving with List-Unsubscribe', () => {
  test('from Gmail: its detail answers the https address, and one without the header leaves the key out', async () => {
    const address = 'user.work@example.com';
    const w = world();
    const google = await fakeGoogle({clock: () => w.store.now()});
    google.addMailbox(address);
    const adapter = new GmailAdapter({topic: null, pageSize: 50, backfillPagesPerStep: 1, headerChunk: 100, client: google.client()});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'}), timeoutMs: 5000});
    const connectors = {gmail: gmailConnector(w.store, google.client(), false)};
    const api = await signedIn(w, {engine, connectors});
    const consent = new URL((await api.send('POST', '/api/accounts/gmail/authorize', {body: {}})).body.url);
    await client(w, {engine, connectors})
      .send('GET', `/api/ea/accounts/gmail/callback?code=${encodeURIComponent(google.issueCode(address))}&state=${encodeURIComponent(consent.searchParams.get('state')!)}`);
    await drained(w, engine);
    const deliver = (subject: string, headers: [string, string][] = []) => google.deliver(address, {
      raw: rawEmail({from: 'Contoso <news@contoso.example>', subject, date: ago(MINUTE), text: `${subject}.`, received: gmailVerdict('contoso.example'), headers}),
      date: ago(MINUTE),
    });
    deliver('The October letter', LIST);
    deliver('Your receipt');
    w.advance(2 * MINUTE);
    await drained(w, engine);
    const letter = await api.send('GET', `/api/mail/messages/${idOf(w, 'The October letter')}`);
    expect(letter.body.unsubscribe_url).toBe('https://contoso.example/unsubscribe?u=41');
    const receipt = await api.send('GET', `/api/mail/messages/${idOf(w, 'Your receipt')}`);
    expect(receipt.status).toBe(200);
    expect(receipt.body).not.toHaveProperty('unsubscribe_url');
  });

  test('from iCloud: its detail answers the https address, and a mailto-only header gives none', async () => {
    const address = 'user@icloud.example.com';
    const password = 'abcd-efgh-ijkl-mnop';
    const w = world();
    const imap = await fakeImap();
    imap.addUser(address, password);
    const adapter = new ICloudAdapter({endpoint: {host: imap.host, port: imap.port, secure: false}, backfillChunk: 50, headerChunk: 100, connectTimeoutMs: 2000});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({icloud: adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'}), timeoutMs: 3000});
    const api = await signedIn(w, {engine, connectors: {icloud: icloudConnector(w.store, adapter)}});
    expect((await api.send('POST', '/api/accounts/icloud', {body: {address, app_password: password}})).status).toBe(201);
    await drained(w, engine);
    const deliver = (subject: string, headers: [string, string][]) =>
      imap.deliver(address, rawEmail({from: 'Proseware <news@proseware.example.com>', subject, date: ago(MINUTE), text: `${subject}.`, headers}), ago(MINUTE));
    deliver('Proseware weekly', LIST);
    deliver('Proseware notes', [['List-Unsubscribe', '<mailto:leave@proseware.example.com>']]);
    w.advance(2 * MINUTE);
    await drained(w, engine);
    const weekly = await api.send('GET', `/api/mail/messages/${idOf(w, 'Proseware weekly')}`);
    expect(weekly.body.unsubscribe_url).toBe('https://contoso.example/unsubscribe?u=41');
    const notes = await api.send('GET', `/api/mail/messages/${idOf(w, 'Proseware notes')}`);
    expect(notes.status).toBe(200);
    expect(notes.body).not.toHaveProperty('unsubscribe_url');
    await adapter.close();
  });
});
