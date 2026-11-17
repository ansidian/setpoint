// The user's own files on a draft, through the API on the seed with a temporary files directory:
// uploaded and removed, counted with a forward's kept originals toward 25 MB, refused while the
// draft is held, released by Discard for Undo or the reply-type menu's new draft to take, swept 10
// minutes later, and gone once sent. A refused send keeps them; a file gone from the disk fails it.
import {ATTACHMENTS_MAX_BYTES, SEND_HOLD_MS} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, onTestFinished, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {devProvider} from '../src/providers/dev/index.ts';
import {FILES_KEPT_MS, sweepDraftFiles} from '../src/sending/files.ts';
import {SendWorker} from '../src/sending/worker.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {liveEvents, ORIGIN, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const THEO = 55;
const MB = 1024 * 1024;
const paragraph = (text: string) => [{type: 'paragraph', runs: [{text, marks: [], href: null}]}];

async function setup() {
  const w = world({seed: true});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-draft-files-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const engine: SyncEngine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider()), workers: [new SendWorker({
    store: w.store, filesDir: dir, send: (sourceId, mail) => engine.sendMail(sourceId, mail), findSent: (sourceId, query) => engine.findSent(sourceId, query),
    attachment: (sourceId, message, id) => engine.attachment(sourceId, message, id),
  })]});
  const api = await signedIn(w, {engine, draftFiles: dir});
  const start = async (input: Record<string, unknown>) => (await api.send('POST', '/api/mail/drafts', {body: input})).body;
  /** Uploads bytes as the composer does: the body raw, the name in the query. */
  const upload = async (draftId: number, name: string, content: Buffer | string, type = 'text/plain') => {
    const response = await api.app.request(`/api/mail/drafts/${draftId}/files?name=${encodeURIComponent(name)}`, {
      method: 'POST', headers: {origin: ORIGIN, cookie: api.cookie!, 'content-type': type}, body: typeof content === 'string' ? Buffer.from(content) : content,
    });
    return {status: response.status, body: await response.json() as any}; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const draft = async (id: number) => (await api.send('GET', `/api/mail/drafts/${id}`)).body;
  /** Holds the draft and sends it past its hold through the dev provider. */
  const send = async (id: number) => {
    const held = await api.send('POST', `/api/mail/drafts/${id}/send`);
    w.advance(SEND_HOLD_MS);
    for (let round = 0; round < 5; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.kind, 'send'), lte(t.jobs.runAt, w.store.now().toISOString()), eq(t.jobs.state, 'queued'))).all().length) break;
    }
    return held;
  };
  return {w, api, dir, start, upload, draft, send};
}

const onDisk = (dir: string) => fs.readdirSync(dir).sort();
const fileRows = (w: World) => w.store.db.select().from(t.draftFiles).orderBy(t.draftFiles.id).all();
/** Records a file as weighing `bytes` without writing that many: the limit counts recorded sizes. */
const weigh = (w: World, fileId: number, bytes: number) => w.store.db.update(t.draftFiles).set({sizeBytes: bytes}).where(eq(t.draftFiles.id, fileId)).run();

/** The seed's forward with an original: Dana's lease renewal and its agreement, made to weigh `bytes`. */
async function forwardOfRenewal(w: World, start: (input: Record<string, unknown>) => Promise<{id: number}>, bytes: number) {
  const original = w.store.db.select().from(t.attachments).where(eq(t.attachments.filename, 'Renewal agreement.pdf')).get()!;
  w.store.db.update(t.attachments).set({sizeBytes: bytes}).where(eq(t.attachments.id, original.id)).run();
  const forward = await start({kind: 'forward', message_id: original.messageId});
  return {forward, original};
}

describe('Attaching', () => {
  test('a file is kept under its id with its name and type, listed on the draft in order, and Remove takes row and bytes', async () => {
    const {w, dir, start, upload, draft, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    expect(reply.files).toEqual([]);
    const notes = await upload(reply.id, 'Notes.txt', 'Bring boots.');
    expect(notes).toEqual({status: 201, body: {id: expect.any(Number), filename: 'Notes.txt', mime_type: 'text/plain', size_bytes: 12}});
    // A path is dropped from the name, and a type that isn't one is kept as bytes.
    const photo = await upload(reply.id, '../../Cabin photo.png', 'png bytes', 'not a type');
    expect(photo.body).toMatchObject({filename: 'Cabin photo.png', mime_type: 'application/octet-stream'});
    expect((await draft(reply.id)).files.map((file: {filename: string}) => file.filename)).toEqual(['Notes.txt', 'Cabin photo.png']);
    expect(fs.readFileSync(path.join(dir, String(notes.body.id)), 'utf8')).toBe('Bring boots.');

    expect((await api.send('DELETE', `/api/mail/drafts/${reply.id}/files/${notes.body.id}`)).status).toBe(204);
    expect((await draft(reply.id)).files.map((file: {id: number}) => file.id)).toEqual([photo.body.id]);
    expect(onDisk(dir)).toEqual([String(photo.body.id)]);
    expect((await api.send('DELETE', `/api/mail/drafts/${reply.id}/files/${notes.body.id}`)).status).toBe(404);
    expect(fileRows(w)).toHaveLength(1);
  });

  test('a file removed then attached again is one file, under a new id', async () => {
    const {dir, start, upload, draft, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    const first = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
    await api.send('DELETE', `/api/mail/drafts/${reply.id}/files/${first.id}`);
    const again = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
    expect(again.id).not.toBe(first.id);
    expect((await draft(reply.id)).files).toEqual([again]);
    expect(onDisk(dir)).toEqual([String(again.id)]);
  });

  test('a reply\'s file attached or removed is a save: the live stream names its email only when that makes it written or empty again', async () => {
    const {w, start, upload, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    const mailEvents = () => liveEvents(w).flatMap(event => (event.type === 'mail' ? [event] : []));
    const file = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
    expect(mailEvents().at(-1)).toMatchObject({messages: [THEO], drafts: [reply.id]});
    expect((await api.send('GET', '/api/mail/drafts')).body.count).toBe(1);
    const second = (await upload(reply.id, 'Map.txt', 'North trail.')).body;
    expect(mailEvents().at(-1)).toMatchObject({messages: [], drafts: [reply.id]});
    await api.send('DELETE', `/api/mail/drafts/${reply.id}/files/${second.id}`);
    expect(mailEvents().at(-1)).toMatchObject({messages: [], drafts: [reply.id]});
    await api.send('DELETE', `/api/mail/drafts/${reply.id}/files/${file.id}`);
    expect(mailEvents().at(-1)).toMatchObject({messages: [THEO], drafts: [reply.id]});
    expect((await api.send('GET', '/api/mail/drafts')).body.count).toBe(0);
  });

  test('Remove takes only the draft\'s own file: another draft\'s id is not found, and that file stays', async () => {
    const {dir, start, upload, draft, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    const other = await start({kind: 'new'});
    const theirs = (await upload(other.id, 'Theirs.txt', 'theirs')).body;
    expect((await api.send('DELETE', `/api/mail/drafts/${reply.id}/files/${theirs.id}`)).status).toBe(404);
    expect((await draft(other.id)).files).toEqual([theirs]);
    expect(onDisk(dir)).toEqual([String(theirs.id)]);
  });

  test('an empty file is refused, and so is one over 25 MB on its own, before anything is kept', async () => {
    const {w, dir, start, upload} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    expect(await upload(reply.id, 'Empty.txt', '')).toMatchObject({status: 400, body: {error: {message: 'That file is empty.'}}});
    expect(await upload(reply.id, 'Huge.bin', Buffer.alloc(ATTACHMENTS_MAX_BYTES + 2 * MB))).toMatchObject({
      status: 413, body: {error: {code: 'too_large', message: 'Attachments can total 25 MB, and this file alone is over it.'}},
    });
    expect(fileRows(w)).toEqual([]);
    expect(onDisk(dir)).toEqual([]);
  });

  test('a held draft\'s files can\'t change', async () => {
    const {start, upload, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    const notes = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
    await api.send('POST', `/api/mail/drafts/${reply.id}/send`);
    expect((await upload(reply.id, 'More.txt', 'More.')).body.error.code).toBe('draft_held');
    expect((await api.send('DELETE', `/api/mail/drafts/${reply.id}/files/${notes.id}`)).body.error.code).toBe('draft_held');
  });
});

describe('The 25 MB limit', () => {
  test('a forward\'s kept originals count: over it, an upload and Send are refused in words; an original taken off makes room', async () => {
    const {w, dir, start, upload, draft, api} = await setup();
    const {forward, original} = await forwardOfRenewal(w, start, 24 * MB);
    const refused = await upload(forward.id, 'Floor plan.pdf', Buffer.alloc(2 * MB));
    expect(refused).toMatchObject({status: 413, body: {error: {code: 'too_large', message: 'Attachments can total 25 MB, and these would be 26 MB.'}}});
    expect(onDisk(dir)).toEqual([]);

    await api.send('PATCH', `/api/mail/drafts/${forward.id}`, {body: {to: [{name: null, address: 'sam.ortiz@example.org'}], removed_attachments: [original.id]}});
    expect((await upload(forward.id, 'Floor plan.pdf', Buffer.alloc(2 * MB))).status).toBe(201);
    // Putting the original back would cross it: Send says so and holds nothing.
    await api.send('PATCH', `/api/mail/drafts/${forward.id}`, {body: {removed_attachments: []}});
    expect(await api.send('POST', `/api/mail/drafts/${forward.id}/send`)).toMatchObject({status: 413, body: {error: {message: 'Attachments can total 25 MB, and these would be 26 MB.'}}});
    expect((await draft(forward.id)).send).toBeNull();
  });

  test('the draft\'s own files count together', async () => {
    const {w, start, upload} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    weigh(w, (await upload(reply.id, 'Plans.pdf', 'plans')).body.id, 20 * MB);
    expect((await upload(reply.id, 'Photos.zip', Buffer.alloc(5 * MB))).status).toBe(201);
    expect((await upload(reply.id, 'One more.txt', 'x')).body.error.message).toBe('Attachments can total 25 MB, and these would be 25 MB.');
  });
});

describe('Discard, Undo and the reply-type menu', () => {
  test('Discard releases the files; Undo\'s new draft takes them back', async () => {
    const {w, dir, start, upload, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    const notes = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
    await api.send('DELETE', `/api/mail/drafts/${reply.id}`);
    expect(fileRows(w)).toMatchObject([{id: notes.id, draftId: null, releasedAt: w.store.now().toISOString()}]);
    expect(onDisk(dir)).toEqual([String(notes.id)]);

    const again = await start({kind: 'reply', message_id: THEO});
    expect(again.id).not.toBe(reply.id);
    expect(await api.send('POST', `/api/mail/drafts/${again.id}/files/take`, {body: {ids: [notes.id]}})).toMatchObject({status: 200, body: {files: [notes]}});
    expect(fileRows(w)).toMatchObject([{id: notes.id, draftId: again.id, releasedAt: null}]);
  });

  test('released files no draft takes are swept 10 minutes on, row and bytes', async () => {
    const {w, dir, start, upload, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    await upload(reply.id, 'Notes.txt', 'Bring boots.');
    await api.send('DELETE', `/api/mail/drafts/${reply.id}`);
    const other = await start({kind: 'new'});
    w.advance(FILES_KEPT_MS - 1000);
    // An upload sweeps first: not yet.
    const kept = (await upload(other.id, 'Other.txt', 'other')).body;
    expect(fileRows(w)).toHaveLength(2);
    w.advance(2000);
    await api.send('DELETE', `/api/mail/drafts/${(await start({kind: 'new'})).id}`);
    expect(fileRows(w).map(row => row.id)).toEqual([kept.id]);
    expect(onDisk(dir)).toEqual([String(kept.id)]);
  });

  test('a draft that goes without releasing its files (its account removed) leaves them to the next sweep at once', async () => {
    const {w, dir, start, upload, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    await upload(reply.id, 'Notes.txt', 'Bring boots.');
    // As an account's removal deletes its drafts: the files' draft goes, nothing released.
    w.store.db.delete(t.drafts).where(eq(t.drafts.id, reply.id)).run();
    expect(fileRows(w)).toMatchObject([{draftId: null, releasedAt: null}]);
    await api.send('DELETE', `/api/mail/drafts/${(await start({kind: 'new'})).id}`);
    expect(fileRows(w)).toEqual([]);
    expect(onDisk(dir)).toEqual([]);
  });

  test('a reply switched to a forward takes its files onto the new draft', async () => {
    const {start, upload, draft, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    const notes = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
    const forward = await start({kind: 'forward', message_id: THEO});
    expect((await api.send('POST', `/api/mail/drafts/${forward.id}/files/take`, {body: {ids: [notes.id]}})).body.files).toEqual([notes]);
    expect((await draft(reply.id)).files).toEqual([]);
    expect((await draft(forward.id)).files).toEqual([notes]);
  });

  test('a switch that would cross the limit with the forward\'s originals is refused, and the files stay where they were', async () => {
    const {w, start, upload, draft, api} = await setup();
    const {forward, original} = await forwardOfRenewal(w, start, 24 * MB);
    const reply = await start({kind: 'reply', message_id: original.messageId});
    const plans = (await upload(reply.id, 'Plans.pdf', 'plans')).body;
    weigh(w, plans.id, 2 * MB);
    expect(await api.send('POST', `/api/mail/drafts/${forward.id}/files/take`, {body: {ids: [plans.id]}})).toMatchObject({status: 413, body: {error: {code: 'too_large'}}});
    expect((await draft(reply.id)).files.map((file: {id: number}) => file.id)).toEqual([plans.id]);
    expect((await draft(forward.id)).files).toEqual([]);
  });

  test('a held draft\'s files aren\'t taken, and an id that\'s gone is skipped', async () => {
    const {start, upload, draft, api} = await setup();
    const reply = await start({kind: 'reply', message_id: THEO});
    const notes = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
    await api.send('POST', `/api/mail/drafts/${reply.id}/send`);
    const other = await start({kind: 'new'});
    expect((await api.send('POST', `/api/mail/drafts/${other.id}/files/take`, {body: {ids: [notes.id, 9999]}})).body.files).toEqual([]);
    expect((await draft(reply.id)).files).toEqual([notes]);
  });
});

describe('Sending', () => {
  test('a sent forward carries the original, then the user\'s files; their rows and bytes go', async () => {
    const {w, dir, start, upload, send, api} = await setup();
    const {forward} = await forwardOfRenewal(w, start, 184 * 1024);
    await api.send('PATCH', `/api/mail/drafts/${forward.id}`, {body: {to: [{name: null, address: 'sam.ortiz@example.org'}], body: paragraph('Have a look.')}});
    await upload(forward.id, 'Notes.txt', 'Bring boots.');
    await upload(forward.id, 'Cabin photo.png', 'png bytes', 'image/png');
    await send(forward.id);
    expect((await api.send('GET', `/api/mail/drafts/${forward.id}`)).status).toBe(404);
    const sent = w.store.db.select().from(t.messages).where(eq(t.messages.sent, true)).orderBy(t.messages.id).all().at(-1)!;
    const carried = w.store.db.select().from(t.attachments).where(eq(t.attachments.messageId, sent.id)).orderBy(t.attachments.id).all();
    expect(carried.map(file => [file.filename, file.mimeType])).toEqual([
      ['Renewal agreement.pdf', 'application/pdf'], ['Notes.txt', 'text/plain'], ['Cabin photo.png', 'image/png'],
    ]);
    expect(fileRows(w)).toEqual([]);
    expect(onDisk(dir)).toEqual([]);
  });

  test('a refused send keeps the files for Try again', async () => {
    const {w, dir, start, upload, send, draft, api} = await setup();
    const fresh = await start({kind: 'new'});
    await api.send('PATCH', `/api/mail/drafts/${fresh.id}`, {body: {to: [{name: null, address: 'nobody@refused.example'}], subject: 'Hello'}});
    const notes = (await upload(fresh.id, 'Notes.txt', 'Bring boots.')).body;
    await send(fresh.id);
    expect(await draft(fresh.id)).toMatchObject({send: {state: 'failed'}, files: [notes]});
    expect(fileRows(w)).toHaveLength(1);
    expect(onDisk(dir)).toEqual([String(notes.id)]);
  });

  test('a file gone from the disk fails the send in words, and nothing goes', async () => {
    const {w, dir, start, upload, send, draft, api} = await setup();
    const fresh = await start({kind: 'new'});
    await api.send('PATCH', `/api/mail/drafts/${fresh.id}`, {body: {to: [{name: null, address: 'sam.ortiz@example.org'}], subject: 'Hello'}});
    const notes = (await upload(fresh.id, 'Notes.txt', 'Bring boots.')).body;
    fs.rmSync(path.join(dir, String(notes.id)));
    const before = w.store.db.select().from(t.messages).where(eq(t.messages.sent, true)).all().length;
    await send(fresh.id);
    expect((await draft(fresh.id)).send).toEqual({state: 'failed', send_at: null, error: 'The attached file Notes.txt is missing from Setpoint; take it off and attach it again.'});
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.sent, true)).all()).toHaveLength(before);
  });
});

test('a start\'s sweep removes temporary files and any file with no row, and keeps the rest', async () => {
  const {w, dir, start, upload} = await setup();
  const reply = await start({kind: 'reply', message_id: THEO});
  const notes = (await upload(reply.id, 'Notes.txt', 'Bring boots.')).body;
  fs.writeFileSync(path.join(dir, 'tmp-0123456789abcdef'), 'half written');
  fs.writeFileSync(path.join(dir, '9999'), 'no row');
  expect(sweepDraftFiles(w.store, dir)).toBe(0);
  expect(onDisk(dir)).toHaveLength(3);
  sweepDraftFiles(w.store, dir, {disk: true});
  expect(onDisk(dir)).toEqual([String(notes.id)]);
});
