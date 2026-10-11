// The full-text index's basic query (B2): free text over `messages_fts` (sender, organisation,
// subject, body), newest first, with which fields each result matched. B4 builds the chip grammar,
// match reasons and the search log on it (BRIEF.md › Search: chips filter exactly, results come
// newest first, and there's no importance boost).
import type {MatchField} from '@setpoint/shared';
import type {Store} from '../store.ts';

export interface MessageSearchInput {
  text: string;
  accountId?: number;
  limit?: number;
}

export type TextField = Extract<MatchField, 'sender' | 'organisation' | 'subject' | 'body'>;

export interface MessageHit {
  id: number;
  // The fields a word matched in, in BRIEF.md's order: sender, then subject, then body (the
  // organisation with the sender).
  fields: TextField[];
}

const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** The words of a query, as FTS5's tokenizer would see them. */
export function searchTerms(text: string): string[] {
  return [...new Set(fold(text).match(/[\p{L}\p{N}]+/gu) ?? [])];
}

/** Each word as a quoted prefix ("north"* finds Northwind), all required. Null when there are none. */
export function ftsQuery(text: string): string | null {
  const terms = searchTerms(text);
  return terms.length ? terms.map(term => `"${term}"*`).join(' ') : null;
}

interface Row {
  id: number;
  from_name: string;
  from_address: string;
  organisation: string | null;
  subject: string;
  body_text: string;
}

const hasWordStarting = (value: string | null, term: string) => (fold(value ?? '').match(/[\p{L}\p{N}]+/gu) ?? []).some(word => word.startsWith(term));

/** Emails matching every word, newest first; trashed mail is left out. */
export function searchMessages(store: Store, {text, accountId, limit = 50}: MessageSearchInput): MessageHit[] {
  const query = ftsQuery(text);
  if (!query) return [];
  const rows = store.sqlite.prepare(`
    SELECT m.id, m.from_name, m.from_address, m.organisation, m.subject, m.body_text
    FROM messages_fts
    JOIN messages m ON m.id = messages_fts.rowid
    WHERE messages_fts MATCH ? AND m.trashed_at IS NULL ${accountId ? 'AND m.account_id = ?' : ''}
    ORDER BY m.received_at DESC, m.id DESC
    LIMIT ?`).all(...[query, ...(accountId ? [accountId] : []), limit]) as Row[];
  const terms = searchTerms(text);
  return rows.map(row => {
    const fields = new Set<TextField>();
    for (const term of terms) {
      if (hasWordStarting(row.from_name, term) || hasWordStarting(row.from_address, term)) fields.add('sender');
      if (hasWordStarting(row.organisation, term)) fields.add('organisation');
      if (hasWordStarting(row.subject, term)) fields.add('subject');
      if (hasWordStarting(row.body_text, term)) fields.add('body');
    }
    return {id: row.id, fields: (['sender', 'organisation', 'subject', 'body'] as const).filter(field => fields.has(field))};
  });
}
