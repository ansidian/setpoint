// The user's own files attached to a draft. Each is a file in the data directory's draft-files/,
// named by its row's id, recorded in `draft_files` with its name, type and size.
//
// - Upload writes the bytes under a temporary name, then the row, then renames the file to the id:
//   a row always has its file, and a crash leaves only a temporary file the startup sweep removes.
// - Every file on a draft counts toward ATTACHMENTS_MAX_BYTES with a forward's kept originals. A
//   file that would cross it is refused in words the composer shows, and so is Send.
// - A draft that goes (discarded, or deleted by its account going) leaves its files released for
//   FILES_KEPT_MS: Discard's Undo and the reply-type menu's new draft take them by id. Then the
//   sweep deletes them. A sent draft's files go at once.
// - Bytes are unlinked only after the transaction that let go of their rows has committed.
import type {DraftFileOut} from '@setpoint/shared';
import {ATTACHMENTS_MAX_BYTES, attachmentsTotal} from '@setpoint/shared';
import {and, eq, inArray, isNull, lt, or} from 'drizzle-orm';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as t from '../db/schema.ts';
import {notFound, SetpointError} from '../errors.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {assertEditable, getDraftRow, noteDraft} from './drafts.ts';
import type {DraftRow} from './drafts.ts';

export const DRAFT_FILES_DIR = 'draft-files';
export const draftFilesDir = (dataDir: string) => path.join(dataDir, DRAFT_FILES_DIR);

/** How long a gone draft's files wait to be taken by another draft before they're deleted. */
export const FILES_KEPT_MS = 10 * 60_000;

type FileRow = typeof t.draftFiles.$inferSelect;

export const presentFile = (row: FileRow): DraftFileOut => ({id: row.id, filename: row.filename, mime_type: row.mimeType, size_bytes: row.sizeBytes});

const filePath = (dir: string, id: number) => path.join(dir, String(id));

/** A draft's own files, in the order they were attached. */
export function draftFileRows(store: Store, draftId: number): FileRow[] {
  return store.db.select().from(t.draftFiles).where(eq(t.draftFiles.draftId, draftId)).orderBy(t.draftFiles.id).all();
}

/** What the draft's message would carry with `extra` more bytes, from what the server holds. */
function totalWith(store: Store, draft: DraftRow, extra: number, excluding: number[] = []): number {
  const own = draftFileRows(store, draft.id).filter(row => !excluding.includes(row.id)).map(row => ({size_bytes: row.sizeBytes}));
  return attachmentsTotal(own, forwardedOriginals(store, draft), draft.removedAttachments) + extra;
}

/** A forward's original attachments, by id and size; none for any other draft. */
function forwardedOriginals(store: Store, draft: Pick<DraftRow, 'kind' | 'messageId'>): {id: number; size_bytes: number}[] {
  if (draft.kind !== 'forward' || draft.messageId === null) return [];
  return store.db.select({id: t.attachments.id, size_bytes: t.attachments.sizeBytes}).from(t.attachments).where(eq(t.attachments.messageId, draft.messageId)).all();
}

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;

/** The refusal for a message over the limit, with what it would weigh. */
export function tooLarge(total: number): SetpointError {
  return new SetpointError('too_large', `Attachments can total 25 MB, and these would be ${megabytes(total)}.`, 413);
}

/** Refuses a draft whose attachments are over the limit (Send). */
export function assertWithinLimit(store: Store, draft: DraftRow) {
  const total = totalWith(store, draft, 0);
  if (total > ATTACHMENTS_MAX_BYTES) throw tooLarge(total);
}

/** The name a file is kept under: its own, less any path and control characters. */
export function cleanFilename(name: string): string {
  const base = [...name.replace(/^.*[\\/]/, '')].filter(char => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127).join('').trim().slice(0, 255);
  return base || 'attachment';
}

/** Attaches a file to the draft: refused when the draft is frozen or the total would cross the limit. */
export function addDraftFile(store: Store, dir: string, draftId: number, file: {filename: string; mimeType: string; content: Buffer}): DraftFileOut {
  // Checked before the bytes are written, and again in the transaction that records them.
  const check = () => {
    const draft = getDraftRow(store, draftId);
    assertEditable(draft);
    const total = totalWith(store, draft, file.content.length);
    if (total > ATTACHMENTS_MAX_BYTES) throw tooLarge(total);
    return draft;
  };
  check();
  fs.mkdirSync(dir, {recursive: true});
  const temporary = path.join(dir, `tmp-${randomBytes(8).toString('hex')}`);
  fs.writeFileSync(temporary, file.content);
  try {
    const row = transaction(store, () => {
      const draft = check();
      const inserted = store.db.insert(t.draftFiles).values({
        draftId, filename: cleanFilename(file.filename), mimeType: /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType.toLowerCase() : 'application/octet-stream',
        sizeBytes: file.content.length, createdAt: isoNow(store),
      }).returning().get();
      fs.renameSync(temporary, filePath(dir, inserted.id));
      touch(store, draft);
      return inserted;
    });
    return presentFile(row);
  } catch (error) {
    fs.rmSync(temporary, {force: true});
    throw error;
  }
}

/** Takes a file off the draft: its row and bytes go at once. */
export function removeDraftFile(store: Store, dir: string, draftId: number, fileId: number) {
  transaction(store, () => {
    const draft = getDraftRow(store, draftId);
    assertEditable(draft);
    const removed = store.db.delete(t.draftFiles).where(and(eq(t.draftFiles.id, fileId), eq(t.draftFiles.draftId, draftId))).run().changes;
    if (!removed) throw notFound('That file isn\'t on this draft.');
    touch(store, draft);
  });
  fs.rmSync(filePath(dir, fileId), {force: true});
}

/**
 * Takes files onto the draft by id: those a gone draft released (Discard's Undo), or another
 * draft's that isn't being sent (the reply-type menu's switch). An id that's gone already is
 * skipped; the limit holds as for an upload. Answers the draft's files.
 */
export function takeDraftFiles(store: Store, draftId: number, ids: number[]): DraftFileOut[] {
  return transaction(store, () => {
    const draft = getDraftRow(store, draftId);
    assertEditable(draft);
    const candidates = ids.length ? store.db.select().from(t.draftFiles).where(inArray(t.draftFiles.id, ids)).all() : [];
    const taken = candidates.filter(row => {
      if (row.draftId === draftId || row.draftId === null) return true;
      const owner = store.db.select({sendState: t.drafts.sendState}).from(t.drafts).where(eq(t.drafts.id, row.draftId)).get();
      return !owner || (owner.sendState !== 'held' && owner.sendState !== 'sending');
    });
    const moving = taken.filter(row => row.draftId !== draftId);
    const total = totalWith(store, draft, moving.reduce((sum, row) => sum + row.sizeBytes, 0));
    if (moving.length && total > ATTACHMENTS_MAX_BYTES) throw tooLarge(total);
    const others = new Set(moving.flatMap(row => (row.draftId === null ? [] : [row.draftId])));
    if (moving.length) store.db.update(t.draftFiles).set({draftId, releasedAt: null}).where(inArray(t.draftFiles.id, moving.map(row => row.id))).run();
    for (const other of others) {
      const row = store.db.select().from(t.drafts).where(eq(t.drafts.id, other)).get();
      if (row) touch(store, row);
    }
    touch(store, draft);
    return draftFileRows(store, draftId).map(presentFile);
  });
}

/** A sent draft's files: their rows go now, in the caller's transaction. Answers their ids, to unlink after. */
export function dropDraftFiles(store: Store, draftId: number): number[] {
  return store.db.delete(t.draftFiles).where(eq(t.draftFiles.draftId, draftId)).returning({id: t.draftFiles.id}).all().map(row => row.id);
}

/** Deletes the bytes of files whose rows are gone. */
export function unlinkFiles(dir: string, ids: number[]) {
  for (const id of ids) fs.rmSync(filePath(dir, id), {force: true});
}

/** A file's bytes, for the message builder, or null when they're gone from the disk. */
export function readDraftFile(dir: string, row: Pick<FileRow, 'id'>): Buffer | null {
  try {
    return fs.readFileSync(filePath(dir, row.id));
  } catch {
    return null;
  }
}

/**
 * Deletes what no draft will take any more: files released over FILES_KEPT_MS ago, files whose
 * draft went without releasing them (its account removed), and, on disk, temporary files and
 * any file with no row. Answers how many rows went.
 */
export function sweepDraftFiles(store: Store, dir: string, {disk = false} = {}): number {
  const before = new Date(store.now().getTime() - FILES_KEPT_MS).toISOString();
  const gone = transaction(store, () => store.db.delete(t.draftFiles)
    .where(and(isNull(t.draftFiles.draftId), or(isNull(t.draftFiles.releasedAt), lt(t.draftFiles.releasedAt, before))))
    .returning({id: t.draftFiles.id}).all().map(row => row.id));
  unlinkFiles(dir, gone);
  if (disk && fs.existsSync(dir)) {
    const kept = new Set(store.db.select({id: t.draftFiles.id}).from(t.draftFiles).all().map(row => String(row.id)));
    for (const name of fs.readdirSync(dir)) if (!kept.has(name)) fs.rmSync(path.join(dir, name), {force: true});
  }
  return gone.length;
}

/** A draft's files changed: its updated time moves and its composer hears of it. */
function touch(store: Store, draft: DraftRow) {
  store.db.update(t.drafts).set({updatedAt: isoNow(store)}).where(eq(t.drafts.id, draft.id)).run();
  noteDraft(store, draft);
}
