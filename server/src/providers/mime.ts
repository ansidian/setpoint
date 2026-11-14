// One email's RFC 822 source, parsed for the message record: Gmail's `format=raw` and IMAP's
// BODY[] go through the same parser (mailparser, as v1's reader did), so charsets, transfer
// encodings and HTML-only mail decode the same way for both providers.
import {convert} from 'html-to-text';
import type {HtmlToTextOptions} from 'html-to-text';
import {simpleParser} from 'mailparser';
import type {ParsedMail, ParsedMailAttachment} from 'mailparser';
import {evaluateGmailSenderAuthentication, evaluateICloudSenderAuthentication} from '../domain/senderAuthentication.ts';
import type {AuthenticationHeader, MailProvider} from '../domain/senderAuthentication.ts';
import {bareCid, KEPT_TYPES, pieceSources, statedPieces} from '../domain/mailpieces.ts';
import type {ReadDigest, Scan} from '../domain/mailpieces.ts';
import type {AttachmentBytes} from '../sync/adapter.ts';
import type {FetchedAttachment, FetchedMessage, ProviderState} from '../sync/mailMirror.ts';

// What the record and its index keep of a body (v1's evidence limit); the reader shows the HTML.
export const BODY_TEXT_MAX_CHARS = 20_000;
export const BODY_HTML_MAX_CHARS = 2_000_000;
const SNIPPET_CHARS = 140;

export interface ParsedEmail {
  fromName: string;
  fromAddress: string;
  subject: string;
  text: string;
  html: string | null;
  snippet: string;
  date: string | null;
  // The top Received header's date: when the receiving server (Gmail's) took it in.
  received: string | null;
  rfc822Id: string | null;
  // The thread's first message, from References or In-Reply-To (IMAP has no thread ids).
  threadRoot: string | null;
  // Every header line in order, duplicates kept, for the sender-authentication verdict.
  headers: AuthenticationHeader[];
  attachments: FetchedAttachment[];
}

/** An inline part (a cid: image in the HTML) isn't an attachment the user would open (v1's rule). */
function isInline(attachment: ParsedMailAttachment): boolean {
  const disposition = String(attachment.contentDisposition ?? '').trim().toLowerCase();
  if (disposition === 'attachment') return false;
  return disposition === 'inline' || attachment.related === true || Boolean(attachment.cid);
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// mailparser's own conversion of HTML-only mail (its nesting limit), except that an image leaves
// only its alt text: html-to-text's default writes its address too, and an embedded `data:` image's
// address can fill the whole stored text (SV-250).
const HTML_TEXT_OPTIONS: HtmlToTextOptions = {
  limits: {maxDepth: 1000},
  formatters: {
    imageAlt: (element, _walk, builder) => {
      const alt = element.attribs?.alt?.trim();
      if (alt) builder.addInline(alt, {noWordTransform: true});
    },
  },
  selectors: [{selector: 'img', format: 'imageAlt'}],
};

/** The text of an HTML-only email; empty when its HTML can't be converted, as mailparser leaves it. */
function htmlText(html: string): string {
  try {
    return convert(html, HTML_TEXT_OPTIONS).trim();
  } catch {
    return '';
  }
}

/** What the record keeps of a body's text: its first 20,000 characters, and the snippet. */
function storedText(text: string): {text: string; snippet: string} {
  const trimmed = text.trim();
  return {
    text: trimmed.length > BODY_TEXT_MAX_CHARS ? `${trimmed.slice(0, BODY_TEXT_MAX_CHARS)}…` : trimmed,
    snippet: squash(trimmed).slice(0, SNIPPET_CHARS),
  };
}

/**
 * v1's fallback for a message the parser can't take: the header block read line by line and the
 * rest kept as text, so one malformed email still lands in the record rather than stopping sync.
 */
function naiveParse(source: Buffer): ParsedMail {
  const text = source.toString('utf8');
  const split = text.search(/\r?\n\r?\n/);
  const head = (split < 0 ? text : text.slice(0, split)).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  const header = (name: string) => head.find(line => line.toLowerCase().startsWith(`${name}:`))?.slice(name.length + 1).trim();
  const from = header('from') ?? '';
  const address = /<([^>]+)>/.exec(from)?.[1] ?? (from.includes('@') ? from : '');
  const date = header('date') ? new Date(header('date')!) : undefined;
  return {
    headerLines: head.filter(line => line.includes(':')).map(line => ({key: line.slice(0, line.indexOf(':')).toLowerCase(), line})),
    subject: header('subject'), messageId: header('message-id'), date,
    from: {value: [{name: from.replace(/<[^>]*>/, '').replace(/"/g, '').trim(), address}]},
    text: split < 0 ? '' : text.slice(split).replace(/<[^>]+>/g, ' ').trim(),
  };
}

/** The date after the top Received header's last ";", comments dropped; null when it doesn't read. */
function topReceived(headers: AuthenticationHeader[]): string | null {
  const value = headers.find(header => header.name.toLowerCase() === 'received')?.value;
  if (!value?.includes(';')) return null;
  const at = Date.parse(value.slice(value.lastIndexOf(';') + 1).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim());
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** An attachment's id in the record: its MIME part, or its place among the parts when it has none. */
const attachmentId = (attachment: ParsedMailAttachment, index: number) => attachment.partId ?? `part-${index + 1}`;

async function parsedSource(source: Buffer): Promise<ParsedMail> {
  try {
    return await simpleParser(source, {skipHtmlToText: true, skipTextToHtml: true});
  } catch {
    return naiveParse(source);
  }
}

/** One attachment of an email's source, by the id parseEmail gave it; null when it isn't there. */
export async function attachmentFromSource(source: Buffer, id: string): Promise<AttachmentBytes | null> {
  const parsed = await parsedSource(source);
  const attachment = (parsed.attachments ?? []).find((item, index) => !isInline(item) && attachmentId(item, index) === id);
  if (!attachment?.content) return null;
  return {
    content: attachment.content,
    mimeType: (attachment.contentType || 'application/octet-stream').toLowerCase(),
    filename: attachment.filename || 'Attachment',
  };
}

export async function parseEmail(source: Buffer): Promise<ParsedEmail> {
  const parsed = await parsedSource(source);
  const from = parsed.from?.value?.[0];
  const html = typeof parsed.html === 'string' && parsed.html ? parsed.html : null;
  // mailparser leaves an HTML-only email's text empty (skipHtmlToText): Setpoint makes it.
  const parsedText = (parsed.text ?? '').trim();
  const {text, snippet} = storedText(parsedText || !html ? parsedText : htmlText(html));
  const references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  const attachments = (parsed.attachments ?? []).flatMap((attachment, index) => isInline(attachment) ? [] : [{
    providerId: attachmentId(attachment, index),
    filename: attachment.filename || 'Attachment',
    mimeType: (attachment.contentType || 'application/octet-stream').toLowerCase(),
    sizeBytes: Number.isFinite(attachment.size) ? Number(attachment.size) : attachment.content?.length ?? 0,
  }]);
  const headers = (parsed.headerLines ?? []).map(({key, line}) => ({name: key, value: line.slice(line.indexOf(':') + 1)}));
  return {
    fromName: from?.name?.trim() || '',
    fromAddress: (from?.address ?? '').trim().toLowerCase(),
    subject: parsed.subject?.trim() || '(no subject)',
    text,
    html: html && html.length <= BODY_HTML_MAX_CHARS ? html : null,
    snippet,
    date: parsed.date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : null,
    rfc822Id: parsed.messageId ?? null,
    threadRoot: references[0] ?? parsed.inReplyTo ?? null,
    received: topReceived(headers),
    headers,
    attachments,
  };
}

export interface SourceMeta extends ProviderState {
  providerId: string;
  // The provider's own thread id (Gmail's); IMAP has none, so the thread root stands in.
  threadId?: string | null;
  // When the provider received it (Gmail's internalDate, IMAP's INTERNALDATE). Gmail's follows a
  // Date header earlier than its arrival, so a Gmail email takes its top Received header first.
  receivedAt?: string | null;
}

/** A parsed email as the mirror takes it, with the receiving provider's authentication verdict. */
export async function fetchedMessage(provider: MailProvider, source: Buffer, meta: SourceMeta, now: Date): Promise<FetchedMessage> {
  const email = await parseEmail(source);
  const claimedFrom = email.headers.find(header => header.name.toLowerCase() === 'from')?.value?.trim() ?? email.fromAddress;
  const senderAuth = provider === 'gmail'
    ? evaluateGmailSenderAuthentication(email.headers, claimedFrom, now)
    : evaluateICloudSenderAuthentication(email.headers, claimedFrom, now);
  return {
    providerId: meta.providerId,
    threadId: meta.threadId ?? email.threadRoot ?? email.rfc822Id ?? meta.providerId,
    rfc822Id: email.rfc822Id,
    fromName: email.fromName || email.fromAddress,
    fromAddress: email.fromAddress,
    subject: email.subject,
    snippet: email.snippet,
    bodyText: email.text,
    bodyHtml: email.html,
    receivedAt: (provider === 'gmail' ? email.received : null) ?? meta.receivedAt ?? email.date ?? now.toISOString(),
    senderAuth,
    attachments: email.attachments,
    unread: meta.unread,
    trashed: meta.trashed,
    archived: meta.archived,
  };
}

/**
 * The mailpieces in a USPS digest's source (SV-274, src/domain/mailpieces.ts): how many it says are
 * coming, and the pictures its HTML shows for them, in order, ads left out.
 */
export async function readDigest(source: Buffer): Promise<ReadDigest> {
  // Its HTML as sent: mailparser would otherwise turn each `cid:` link into the image's data URI.
  const parsed = await simpleParser(source, {skipHtmlToText: true, skipTextToHtml: true, keepCidLinks: true});
  const html = typeof parsed.html === 'string' ? parsed.html : '';
  const parts = parsed.attachments ?? [];
  const byCid = new Map<string, ParsedMailAttachment>();
  for (const part of parts) {
    if (part.cid) byCid.set(bareCid(part.cid), part);
    if (part.filename && !byCid.has(part.filename.toLowerCase())) byCid.set(part.filename.toLowerCase(), part);
  }
  const scans: Scan[] = [];
  for (const cid of pieceSources(html)) {
    const part = byCid.get(bareCid(cid));
    const mimeType = (part?.contentType ?? '').toLowerCase();
    if (!part?.content?.length || !KEPT_TYPES.has(mimeType)) continue;
    scans.push({mimeType: mimeType === 'image/jpg' ? 'image/jpeg' : mimeType, content: part.content});
  }
  return {pieces: statedPieces(`${parsed.text ?? ''}\n${html.replace(/<[^>]+>/g, ' ')}`), scans};
}
