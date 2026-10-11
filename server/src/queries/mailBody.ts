// An email's HTML body as its own page, and an attachment's bytes, for the reader (DESIGN.md › The
// reader). The body page carries its own policy, so the sandboxed frame that loads it by `src`
// doesn't inherit the app's: remote images load (https only) when the remote-content rule allows
// it, or when the user pressed Show; otherwise they're placeholders and nothing leaves the page.
import {and, eq} from 'drizzle-orm';
import {mailSourceId} from '../commands/mail.ts';
import * as t from '../db/schema.ts';
import {emailPage, emailPolicy, safeEmail} from '../domain/emailHtml.ts';
import {notFound} from '../errors.ts';
import type {Store} from '../store.ts';
import type {SyncEngine} from '../sync/engine.ts';
import {messageDetail} from './mail.ts';

export interface BodyPage {
  html: string;
  policy: string;
  load: boolean;
}

/** The body page, with images when the rule allows them or `show` asks (DESIGN.md › The reader › Images). */
export function messageBody(store: Store, messageId: number, show: boolean): BodyPage {
  const message = messageDetail(store, messageId);
  if (!message.body_html) throw notFound('That email has no HTML body.');
  const load = message.remote_content.load || show;
  return {html: emailPage(safeEmail(message.body_html, load)), policy: emailPolicy(load), load};
}

/** Types the browser may show as themselves (the previews'); anything else downloads as bytes. */
const SHOWN_AS_IS = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/csv)$/;

export interface AttachmentFile {
  content: Buffer;
  contentType: string;
  disposition: string;
}

/** RFC 6266's filename and filename*, so any name survives. */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

/** An attachment's bytes, through its account's adapter. */
export async function attachmentFile(store: Store, engine: SyncEngine | null, messageId: number, attachmentId: number): Promise<AttachmentFile> {
  const row = store.db.select({
    providerId: t.attachments.providerId, filename: t.attachments.filename, mimeType: t.attachments.mimeType,
    messageProviderId: t.messages.providerId, accountId: t.messages.accountId,
  }).from(t.attachments).innerJoin(t.messages, eq(t.messages.id, t.attachments.messageId))
    .where(and(eq(t.attachments.id, attachmentId), eq(t.attachments.messageId, messageId))).get();
  if (!row) throw notFound('No such attachment.');
  const sourceId = mailSourceId(store, row.accountId);
  if (!engine || sourceId === null) throw notFound('Nothing serves this account\'s attachments in this Setpoint.');
  const bytes = await engine.attachment(sourceId, {providerId: row.messageProviderId}, row.providerId);
  if (!bytes) throw notFound('The provider no longer has that attachment.');
  const type = (bytes.mimeType || row.mimeType).toLowerCase();
  const shown = SHOWN_AS_IS.test(type);
  return {content: bytes.content, contentType: shown ? type : 'application/octet-stream', disposition: contentDisposition(shown ? 'inline' : 'attachment', row.filename)};
}
