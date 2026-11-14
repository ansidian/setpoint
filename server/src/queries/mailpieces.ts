// SV-274: the agenda rail's USPS mail for a day, and one scan's picture (src/mailpieces/worker.ts
// keeps them). A day with two digests (one sent again) shows the latest.
import type {MailpiecesOut} from '@setpoint/shared';
import {asc, desc, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {notFound} from '../errors.ts';
import type {Store} from '../store.ts';

export function mailpieces(store: Store, day: string): MailpiecesOut {
  const digest = store.db.select().from(t.mailDigests).where(eq(t.mailDigests.day, day)).orderBy(desc(t.mailDigests.storedAt), desc(t.mailDigests.id)).get();
  if (!digest) return {day, digest: null};
  const scans = store.db.select({id: t.mailScans.id}).from(t.mailScans).where(eq(t.mailScans.digestId, digest.id)).orderBy(asc(t.mailScans.position)).all();
  return {day, digest: {pieces: digest.pieces, scans: scans.map(scan => ({id: scan.id, url: `/api/mail/mailpieces/scans/${scan.id}`}))}};
}

export function mailScan(store: Store, id: number): {mimeType: string; bytes: Buffer} {
  const scan = store.db.select({mimeType: t.mailScans.mimeType, bytes: t.mailScans.bytes}).from(t.mailScans).where(eq(t.mailScans.id, id)).get();
  if (!scan) throw notFound('That mailpiece is no longer kept.');
  return scan;
}
