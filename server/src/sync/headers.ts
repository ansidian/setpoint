// The header pass: To, Cc, Reply-To, References and In-Reply-To for the mail Setpoint held before
// it kept them. New mail records them as it arrives (src/sync/mailMirror.ts); this fills the rest
// once, per mail source, from the provider's headers only (Gmail's format=metadata, IMAP's
// BODY.PEEK[HEADER]): no bodies, no AI call, nothing sorted again and read state untouched.
//
// - It starts by itself once the source's 365-day backfill is done, and takes one chunk of rows per
//   sync, oldest id first. The next chunk is queued as a sync job keyed by where it stands, as the
//   backfill's steps are.
// - Its state (src/sync/cursors.ts › HeaderBackfillState) is written after each chunk, so a restart
//   resumes. A chunk that fails (a dropped connection, a 5xx) throws before the state is written,
//   and its retry reads the same rows again.
// - A row the provider no longer has (deleted at Gmail, moved out of iCloud's INBOX) is counted as
//   skipped and passed over; the pass moves on by id, so it is never asked for again.
import {and, asc, count, eq, gt, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import type {Store} from '../store.ts';
import {transaction} from '../store.ts';
import {readBackfill, readHeaderBackfill, writeHeaderBackfill} from './cursors.ts';
import type {HeaderBackfillState} from './cursors.ts';
import {enqueueJob} from './jobs.ts';
import {headerColumns} from './mailMirror.ts';
import type {MessageHeaders} from './mailMirror.ts';

/** A row the pass reads, by the provider's id. */
export interface HeaderRow {
  id: number;
  providerId: string;
}

const headersUnread = (accountId: number) => and(eq(t.messages.accountId, accountId), isNull(t.messages.toRecipients));

/**
 * One chunk of the pass for a mail source. `read` returns the headers of the rows the provider
 * still has, by row id; a row it leaves out is skipped.
 */
export async function headerPassStep(
  store: Store, source: {id: number; accountId: number}, chunk: number,
  read: (rows: HeaderRow[]) => Promise<Map<number, MessageHeaders>>,
): Promise<void> {
  const backfill = readBackfill(store, source.id);
  if (!backfill?.done) return;
  let state = readHeaderBackfill(store, source.id);
  if (!state) {
    const now = store.now().toISOString();
    state = {total: store.db.select({n: count()}).from(t.messages).where(headersUnread(source.accountId)).get()?.n ?? 0, read: 0, skipped: 0, afterId: 0, done: false, startedAt: now, finishedAt: null};
  }
  if (state.done) return;
  const rows = store.db.select({id: t.messages.id, providerId: t.messages.providerId}).from(t.messages)
    .where(and(headersUnread(source.accountId), gt(t.messages.id, state.afterId))).orderBy(asc(t.messages.id)).limit(chunk).all();
  const found = rows.length ? await read(rows) : new Map<number, MessageHeaders>();
  const done = rows.length < chunk;
  const next: HeaderBackfillState = {
    ...state, read: state.read + found.size, skipped: state.skipped + rows.length - found.size,
    afterId: rows.at(-1)?.id ?? state.afterId, done, finishedAt: done ? store.now().toISOString() : null,
  };
  transaction(store, () => {
    // Only a row still unread: arrival or a refetch may have written it meanwhile.
    for (const [id, headers] of found) store.db.update(t.messages).set(headerColumns(headers)).where(and(eq(t.messages.id, id), isNull(t.messages.toRecipients))).run();
    writeHeaderBackfill(store, source.id, next);
  });
  if (!done) enqueueJob(store, {kind: 'sync', key: `headers:${source.id}:${next.afterId}`, sourceId: source.id});
}
