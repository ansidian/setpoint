// One email's RFC 822 source, parsed for the message record. Gmail's `format=raw` and IMAP's
// BODY[] go through the same parser (mailparser), so charsets, transfer encodings and HTML-only
// mail decode the same way for both providers.
import render from 'dom-serializer';
import type {Element} from 'domhandler';
import {findAll, removeElement} from 'domutils';
import {convert} from 'html-to-text';
import type {HtmlToTextOptions} from 'html-to-text';
import {parseDocument} from 'htmlparser2';
import {simpleParser} from 'mailparser';
import type {ParsedMail, ParsedMailAddress, ParsedMailAddressEntry, ParsedMailAttachment} from 'mailparser';
import type {Recipient} from '@setpoint/shared';
import {unsubscribeUrl} from '../domain/listUnsubscribe.ts';
import {evaluateGmailSenderAuthentication, evaluateICloudSenderAuthentication} from '../domain/senderAuthentication.ts';
import type {AuthenticationHeader, MailProvider} from '../domain/senderAuthentication.ts';
import {artworkCount, bareCid, KEPT_TYPES, pieceSources, statedPieces} from '../domain/mailpieces.ts';
import type {ReadDigest, Scan} from '../domain/mailpieces.ts';
import type {AttachmentBytes} from '../sync/adapter.ts';
import type {FetchedAttachment, FetchedMessage, MessageHeaders, ProviderState} from '../sync/mailMirror.ts';

// What the record and its index keep of a body. The reader shows the HTML.
export const BODY_TEXT_MAX_CHARS = 20_000;
export const BODY_HTML_MAX_CHARS = 2_000_000;
const SNIPPET_CHARS = 140;

export interface ParsedEmail extends MessageHeaders {
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
  // The sender's unsubscribe page, from List-Unsubscribe (src/domain/listUnsubscribe.ts).
  listUnsubscribe: string | null;
}

/** An inline part (a cid: image in the HTML) isn't an attachment the user would open. */
function isInline(attachment: ParsedMailAttachment): boolean {
  const disposition = String(attachment.contentDisposition ?? '').trim().toLowerCase();
  if (disposition === 'attachment') return false;
  return disposition === 'inline' || attachment.related === true || Boolean(attachment.cid);
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

// mailparser's own conversion of HTML (its nesting limit), except that an image leaves only its
// alt text and a table's rows and cells are lines of their own. html-to-text's default writes an
// image's address too, and an embedded `data:` image's address can fill the whole stored text.
const HTML_TEXT_OPTIONS: HtmlToTextOptions = {
  limits: {maxDepth: 1000},
  formatters: {
    imageAlt: (element, _walk, builder) => {
      const alt = element.attribs?.alt?.trim();
      if (alt) builder.addInline(alt, {noWordTransform: true});
    },
  },
  // Most email lays out with tables, whose cells html-to-text would run together ("LogoHi there,").
  selectors: [{selector: 'img', format: 'imageAlt'}, ...['tr', 'td', 'th'].map(selector => ({selector, format: 'block'}))],
};

/** An inline style's declarations, each name and value lowercased, `!important` and spaces dropped. */
function declarations(style: string): Map<string, string> {
  return new Map(style.split(';').flatMap(rule => {
    const at = rule.indexOf(':');
    return at < 0 ? [] : [[rule.slice(0, at).trim().toLowerCase(), rule.slice(at + 1).replace(/!important/i, '').replace(/\s+/g, '').toLowerCase()] as const];
  }));
}

// Whether the reader hides an element: a preheader, a tracking note, the filler after a preheader.
// Only inline styles count (a stylesheet's classes aren't resolved), and font-size:0 doesn't, as
// layouts set it on the cells that hold their columns.
function hidden(element: Element): boolean {
  if (element.attribs.hidden !== undefined) return true;
  const style = declarations(element.attribs.style ?? '');
  const zero = (value: string | undefined) => value !== undefined && /^(?:0+\.?0*|\.0+)(?:px|em|%)?$/.test(value);
  return style.get('display') === 'none' || style.get('visibility') === 'hidden' || style.get('mso-hide') === 'all'
    || zero(style.get('opacity')) || (zero(style.get('max-height')) && style.get('overflow') === 'hidden');
}

// Characters that show nothing, which senders repeat after a preheader to fill a list's preview.
const INVISIBLE = /\u034f|[\u00ad\u180e\u200b-\u200d\u2060\ufeff]/g;

/** The text an email's HTML shows, hidden elements left out. Empty when it can't be converted. */
function htmlText(html: string): string {
  try {
    const document = parseDocument(html);
    for (const element of findAll(hidden, document.children)) removeElement(element);
    return convert(render(document), HTML_TEXT_OPTIONS).replace(INVISIBLE, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
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
 * The fallback for a message the parser can't take: the header block read line by line and the
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

/** The date after the top Received header's last ";", comments dropped. Null when it doesn't read. */
function topReceived(headers: AuthenticationHeader[]): string | null {
  const value = headers.find(header => header.name.toLowerCase() === 'received')?.value;
  if (!value?.includes(';')) return null;
  const at = Date.parse(value.slice(value.lastIndexOf(';') + 1).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim());
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/** An address header's mailboxes in order, groups opened, each address lowercased. */
function recipients(field: ParsedMailAddress | ParsedMailAddress[] | undefined): Recipient[] {
  const entries = (Array.isArray(field) ? field : field ? [field] : []).flatMap(item => item.value ?? []);
  const open = (entry: ParsedMailAddressEntry): ParsedMailAddressEntry[] => entry.group ? entry.group.flatMap(open) : [entry];
  return entries.flatMap(open).flatMap(entry => {
    const address = (entry.address ?? '').trim().toLowerCase();
    return address ? [{name: entry.name?.trim() || null, address}] : [];
  });
}

/** Who a parsed email went to and what it answers. */
function messageHeaders(parsed: ParsedMail): MessageHeaders {
  const references = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : [];
  return {
    to: recipients(parsed.to), cc: recipients(parsed.cc), replyTo: recipients(parsed.replyTo),
    references, inReplyTo: parsed.inReplyTo?.trim() || null,
  };
}

/**
 * The same fields from a header block alone: IMAP's BODY[HEADER], or Gmail's format=metadata
 * headers written back as lines, so the header pass reads them as arrival does.
 */
export async function parseHeaderBlock(block: Buffer | string): Promise<MessageHeaders> {
  // The bytes as the provider sent them, with the blank line that ends a header block.
  return messageHeaders(await parsedSource(Buffer.concat([Buffer.isBuffer(block) ? block : Buffer.from(block), Buffer.from('\r\n\r\n')])));
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

/** One attachment of an email's source, by the id parseEmail gave it. Null when it isn't there. */
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

// A multipart/alternative part anywhere in the source: its text and HTML say the same thing twice.
const ALTERNATIVE = /^content-type:\s*multipart\/alternative/im;

export async function parseEmail(source: Buffer): Promise<ParsedEmail> {
  const parsed = await parsedSource(source);
  const from = parsed.from?.value?.[0];
  const html = typeof parsed.html === 'string' && parsed.html ? parsed.html : null;
  // The text is what the reader shows. Where the HTML is the text's alternative, that's the HTML,
  // as a sender's text part can be another template's (an "autopay cancelled" text beside a
  // "scheduled" HTML); the text part stands in when the HTML shows none. A text body with HTML
  // beside it (a list's footer) keeps its text. mailparser makes none from HTML (skipHtmlToText).
  const parsedText = (parsed.text ?? '').trim();
  const fromHtml = html && (!parsedText || ALTERNATIVE.test(source.toString('latin1'))) ? htmlText(html) : '';
  const {text, snippet} = storedText(fromHtml || parsedText);
  const headerFields = messageHeaders(parsed);
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
    threadRoot: headerFields.references[0] ?? parsed.inReplyTo ?? null,
    received: topReceived(headers),
    headers,
    attachments,
    listUnsubscribe: unsubscribeUrl(headers.find(header => header.name.toLowerCase() === 'list-unsubscribe')?.value),
    ...headerFields,
  };
}

export interface SourceMeta extends ProviderState {
  providerId: string;
  // The provider's own thread id (Gmail's). IMAP has none, so the thread root stands in.
  threadId?: string | null;
  // When the provider received it (Gmail's internalDate, IMAP's INTERNALDATE). Gmail's follows a
  // Date header earlier than its arrival, so a Gmail email takes its top Received header first.
  receivedAt?: string | null;
  // Sent by the user, and whether it came to them (src/sync/mailMirror.ts › FetchedMessage).
  sent?: boolean;
  received?: boolean;
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
    ...(email.listUnsubscribe ? {listUnsubscribe: email.listUnsubscribe} : {}),
    recipients: {to: email.to, cc: email.cc, replyTo: email.replyTo, references: email.references, inReplyTo: email.inReplyTo},
    unread: meta.unread,
    trashed: meta.trashed,
    archived: meta.archived,
    ...(meta.sent === undefined ? {} : {sent: meta.sent}),
    ...(meta.received === undefined ? {} : {received: meta.received}),
  };
}

/**
 * The mailpieces in a USPS digest's source (src/domain/mailpieces.ts): how many it says are
 * coming, and the scans its HTML shows for them, in order, mailers' artwork and ads left out.
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
  // The stated count includes the mailers' artwork, which isn't a piece in the mail.
  const stated = statedPieces(`${parsed.text ?? ''}\n${html.replace(/<[^>]+>/g, ' ')}`);
  return {pieces: stated === null ? null : Math.max(0, stated - artworkCount(html)), scans};
}
