// notify(): ntfy delivery against a fake ntfy server, with topics, click deep links (the app's while
// an iPhone is paired), Send test, the log, "once" keys and Settings' switches.
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {describe, expect, test} from 'vitest';
import {Notifier} from '../src/notify/index.ts';
import {setSecret} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {fakeNtfy} from './fakeNtfy.ts';
import {signedIn, world} from './helpers.ts';

const PUBLIC = 'https://setpoint.example.com';

async function setUp() {
  const w = world({seed: true});
  const ntfy = await fakeNtfy();
  updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
  return {w, ntfy, notifier: new Notifier(w.store, {publicUrl: PUBLIC})};
}

describe('notify()', () => {
  test('a reminder goes to setpoint-reminders, its click opening the exact item', async () => {
    const {ntfy, notifier} = await setUp();
    const sent = await notifier.notify({kind: 'reminder', topic: 'reminders', title: 'Dentist', body: '2:30 PM · Smile Dental', link: {to: 'item', id: 2, occurrence_start: '2026-10-07T21:30:00.000Z'}});
    expect(sent).toMatchObject({state: 'sent', error: null, click: `${PUBLIC}/calendar/item/2?at=2026-10-07T21%3A30%3A00.000Z`});
    expect(ntfy.published).toEqual([{
      path: '/', authorization: null,
      body: {topic: 'setpoint-reminders', title: 'Dentist', message: '2:30 PM · Smile Dental', click: sent.click, tags: ['calendar'], priority: 3},
    }]);
  });

  test('mail goes to setpoint-mail, only once Attention mail is turned on, opening the email', async () => {
    const {ntfy, notifier, w} = await setUp();
    const mail = {kind: 'mail' as const, topic: 'mail' as const, title: 'Google', body: 'Your recovery email was changed', link: {to: 'message' as const, id: 2}};
    expect(await notifier.notify(mail)).toMatchObject({state: 'skipped', error: 'Attention mail notifications are off.'});
    updateSettings(w.store, {notifications: {attention_mail: true}});
    expect(await notifier.notify(mail)).toMatchObject({state: 'sent', click: `${PUBLIC}/inbox/2`});
    expect(ntfy.published.map(message => message.body.topic)).toEqual(['setpoint-mail']);
  });

  test('the setpoint-reminders switch off keeps reminders, Time to Leave and reconnect alerts quiet, but not Send test', async () => {
    const {ntfy, notifier, w} = await setUp();
    updateSettings(w.store, {notifications: {reminders: false}});
    for (const kind of ['reminder', 'time_to_leave', 'reconnect'] as const) {
      expect(await notifier.notify({kind, topic: 'reminders', title: 'Gym', body: '7:00 AM'})).toMatchObject({state: 'skipped', error: 'setpoint-reminders is off.'});
    }
    expect(await notifier.sendTest()).toMatchObject({state: 'sent'});
    expect(ntfy.published).toHaveLength(1);
  });

  test('topics are Settings\'; ntfy\'s token goes as a bearer token', async () => {
    const {ntfy, notifier, w} = await setUp();
    updateSettings(w.store, {notifications: {topics: {reminders: 'user-reminders', mail: 'user-mail'}}});
    setSecret(w.store, 'ntfy_token', 'tk_fake');
    await notifier.notify({kind: 'reminder', topic: 'reminders', title: 'Gym', body: '7:00 AM'});
    expect(ntfy.published[0]).toMatchObject({authorization: 'Bearer tk_fake', body: {topic: 'user-reminders'}});
    expect(ntfy.published[0]!.body.click).toBeUndefined();
  });

  test('a key sends once; a failure is logged with ntfy\'s words and tried again next time', async () => {
    const {ntfy, notifier} = await setUp();
    const alert = {kind: 'reconnect' as const, topic: 'reminders' as const, title: 'Business needs sign-in', body: 'Reconnect it.', dedupe: 'reconnect:1:x'};
    ntfy.refuseWith(403, 'forbidden');
    expect(await notifier.notify(alert)).toMatchObject({state: 'failed', error: 'ntfy answered 403, forbidden'});
    expect(notifier.status()).toMatchObject({configured: true, last_sent_at: null, last_error: 'ntfy answered 403, forbidden'});
    ntfy.accept();
    expect(await notifier.notify(alert)).toMatchObject({state: 'sent'});
    expect(await notifier.notify(alert)).toMatchObject({state: 'sent'});
    expect(ntfy.published).toHaveLength(1);
    expect(notifier.status()).toMatchObject({last_error: null});
  });

  // The polish audit's states-11: Node's own "fetch failed" isn't words the user can act on.
  test('a server that can\'t be reached, or doesn\'t answer in time, is said in words, by its host', async () => {
    const w = world({seed: true});
    const closed = http.createServer();
    await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
    const {port} = closed.address() as AddressInfo;
    await new Promise<void>(resolve => closed.close(() => resolve()));
    updateSettings(w.store, {notifications: {ntfy_server: `http://127.0.0.1:${port}/`}});
    expect(await new Notifier(w.store, {publicUrl: PUBLIC}).sendTest()).toMatchObject({state: 'failed', error: `Can’t reach 127.0.0.1:${port}`});
    updateSettings(w.store, {notifications: {ntfy_server: 'https://ntfy.example.net'}});
    const timedOut = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    expect(await new Notifier(w.store, {publicUrl: PUBLIC, fetch: timedOut}).sendTest()).toMatchObject({state: 'failed', error: 'ntfy.example.net didn’t answer in time'});
  });

  test('without ntfy set up, nothing is sent and the log says why', async () => {
    const w = world();
    const notifier = new Notifier(w.store, {publicUrl: null});
    expect(await notifier.sendTest()).toMatchObject({state: 'skipped', error: 'ntfy isn\'t set up.'});
    expect(notifier.status()).toEqual({configured: false, last_sent_at: null, last_error: null});
  });
});

describe('Send test', () => {
  test('POST /api/notifications/test sends to the reminders topic, opening Settings › Notifications', async () => {
    const {w, ntfy, notifier} = await setUp();
    const c = await signedIn(w, {notifier});
    const response = await c.send('POST', '/api/notifications/test');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({kind: 'test', state: 'sent', click: `${PUBLIC}/settings/notifications`});
    expect(ntfy.published.map(message => [message.body.topic, message.body.title])).toEqual([['setpoint-reminders', 'Setpoint']]);
    expect((await c.send('GET', '/api/notifications/status')).body).toMatchObject({configured: true, last_sent_at: expect.any(String), last_error: null});
  });
});

describe('while an iPhone is paired (SV-87)', () => {
  const mail = {kind: 'mail' as const, topic: 'mail' as const, title: 'Google', body: 'Your recovery email was changed', link: {to: 'message' as const, id: 2}};
  const reminder = {kind: 'reminder' as const, topic: 'reminders' as const, title: 'Dentist', body: '2:30 PM · Smile Dental', link: {to: 'item' as const, id: 2, occurrence_start: '2026-10-07T21:30:00.000Z'}};
  const task = {kind: 'reminder' as const, topic: 'reminders' as const, title: 'Pay rent', body: 'Due today', link: {to: 'day' as const, date: '2026-10-07'}};

  /** Pairs a phone as the app does: Add iPhone's code, exchanged with no cookie and no Origin. */
  async function pair(c: Awaited<ReturnType<typeof signedIn>>): Promise<number> {
    const code = (await c.send('POST', '/api/security/pairing')).body.code as string;
    const response = await c.app.request('/api/auth/pair', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({code})});
    expect(response.status).toBe(201);
    return ((await response.json()) as {device: {id: number}}).device.id;
  }

  test('an email or item opens in the app, by the ids the API takes; web links unpaired and again once the last is revoked', async () => {
    const {w, ntfy, notifier} = await setUp();
    updateSettings(w.store, {notifications: {attention_mail: true}});
    const c = await signedIn(w, {notifier});
    const clicks = async () => [(await notifier.notify(mail)).click, (await notifier.notify(reminder)).click];
    const web = [`${PUBLIC}/inbox/2`, `${PUBLIC}/calendar/item/2?at=2026-10-07T21%3A30%3A00.000Z`];
    const app = ['setpoint://mail/2', 'setpoint://item/2'];

    expect(await clicks()).toEqual(web);
    const first = await pair(c);
    expect(await clicks()).toEqual(app);
    const second = await pair(c);
    expect((await c.send('DELETE', `/api/security/devices/${first}`)).status).toBe(204);
    expect(await clicks()).toEqual(app);
    expect((await c.send('DELETE', `/api/security/devices/${second}`)).status).toBe(204);
    expect(await clicks()).toEqual(web);

    expect(ntfy.published.map(message => message.body.click)).toEqual([...web, ...app, ...app, ...web]);
  });

  test('a day or a Settings page, which the app has no screen for, keeps its web link', async () => {
    const {w, ntfy, notifier} = await setUp();
    await pair(await signedIn(w, {notifier}));
    expect(await notifier.notify(task)).toMatchObject({state: 'sent', click: `${PUBLIC}/calendar/2026-10-07`});
    expect(await notifier.sendTest()).toMatchObject({state: 'sent', click: `${PUBLIC}/settings/notifications`});
    expect(ntfy.published.map(message => message.body.click)).toEqual([`${PUBLIC}/calendar/2026-10-07`, `${PUBLIC}/settings/notifications`]);
  });

  test('the app\'s link needs no public URL; a web link does', async () => {
    const {w, ntfy} = await setUp();
    const notifier = new Notifier(w.store, {publicUrl: null});
    await pair(await signedIn(w, {notifier}));
    expect(await notifier.notify(reminder)).toMatchObject({state: 'sent', click: 'setpoint://item/2'});
    expect(await notifier.notify(task)).toMatchObject({state: 'sent', click: null});
    expect(ntfy.published[1]!.body.click).toBeUndefined();
  });

  test('a failure tried again takes the link of its retry: paired since, it opens the app', async () => {
    const {w, ntfy, notifier} = await setUp();
    const alert = {...reminder, dedupe: 'reminder:2@x'};
    ntfy.refuseWith(500, 'oops');
    expect(await notifier.notify(alert)).toMatchObject({state: 'failed', click: `${PUBLIC}/calendar/item/2?at=2026-10-07T21%3A30%3A00.000Z`});
    await pair(await signedIn(w, {notifier}));
    ntfy.accept();
    expect(await notifier.notify(alert)).toMatchObject({state: 'sent', click: 'setpoint://item/2'});
    expect(ntfy.published.map(message => message.body.click)).toEqual(['setpoint://item/2']);
  });
});
