// Reading sorted mail again for its verification code (SV-68). Triage stores the code it finds once,
// so mail sorted before the detector improved keeps what the older one found. This lists what reading
// again would change and, with apply, writes it; it also lists the emails triage typed as code
// emails that still have no code, the detector's likely misses. Unsorted mail is left alone: it gets
// its code when triage sorts it.
import {and, eq, inArray, isNotNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {detectVerificationCode} from '../domain/verificationCode.ts';
import {getSettings} from '../settings.ts';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';

export interface CodeEmail {
  id: number;
  fromAddress: string;
  subject: string;
}

export interface CodeChange extends CodeEmail {
  before: string | null;
  after: string | null;
}

export interface CodeReport {
  changes: CodeChange[];
  // Typed verification_code by triage, with no code once read again.
  missing: CodeEmail[];
}

const BATCH = 500;

export function rereadCodes(store: Store, {apply}: {apply: boolean}): CodeReport {
  const expiryMinutes = getSettings(store).mail.code_expiry_minutes;
  const ids = store.db.select({id: t.messages.id}).from(t.messages).where(isNotNull(t.messages.lane)).orderBy(t.messages.id).all().map(row => row.id);
  const report: CodeReport = {changes: [], missing: []};
  for (let at = 0; at < ids.length; at += BATCH) {
    const rows = store.db.select().from(t.messages).where(inArray(t.messages.id, ids.slice(at, at + BATCH))).all();
    const writes: (() => void)[] = [];
    for (const row of rows) {
      const found = detectVerificationCode({
        subject: row.subject, snippet: row.snippet, bodyText: row.bodyText, bodyHtml: row.bodyHtml, receivedAt: row.receivedAt, expiryMinutes,
      });
      const email = {id: row.id, fromAddress: row.fromAddress, subject: row.subject};
      if ((found?.code ?? null) !== row.code) {
        report.changes.push({...email, before: row.code, after: found?.code ?? null});
        writes.push(() => store.db.update(t.messages).set({code: found?.code ?? null, codeExpiresAt: found?.expiresAt ?? null})
          .where(and(eq(t.messages.id, row.id), isNotNull(t.messages.lane))).run());
      }
      if (row.type === 'verification_code' && !found) report.missing.push(email);
    }
    if (apply && writes.length) transaction(store, () => writes.forEach(write => write()));
  }
  return report;
}
