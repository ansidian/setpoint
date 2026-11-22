// The one message builder both providers send: an RFC 5322 email with a Message-ID Setpoint sets,
// its Date, From with a display name, To, Cc and Bcc, Subject, In-Reply-To and References, and a
// multipart/alternative body (a plain-text copy, then HTML), inside multipart/mixed when it carries
// attachments (a forward's). A quoted email's inline images (stored as data: URIs) go as
// multipart/related parts beside the HTML, named by cid, since Gmail's web client drops data:
// images. Non-ASCII names and subjects are encoded words (RFC 2047), a
// non-ASCII file name RFC 2231's form; bodies and attachments are base64.
//
// Pure: the caller passes the date, the Message-ID and the boundaries' seed, so the same draft builds
// the same bytes. Bcc is in the copy Gmail sends (Gmail takes the recipients from the headers and
// drops the line) and the copy filed in Sent, never in the copy SMTP delivers, whose recipients
// are the envelope's.
import type {Recipient} from '@setpoint/shared';

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface OutgoingMessage {
  // With its angle brackets, as the record keeps one: "<…@…>".
  messageId: string;
  date: Date;
  from: Recipient;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  inReplyTo: string | null;
  references: string[];
  text: string;
  html: string;
  attachments: OutgoingAttachment[];
  // Makes the MIME boundaries; unique per message (its Message-ID's local part will do).
  boundarySeed: string;
}

const CRLF = '\r\n';
const LINE = 76;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A header value on one line: no CR or LF can start a header of its own. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ');
const isPlain = (value: string) => /^[\x20-\x7e]*$/.test(value);

/** RFC 5322's date, in UTC: "Sun, 15 Nov 2026 20:30:00 +0000". */
export function rfc5322Date(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/** Encoded words for text with non-ASCII characters, each under 76 characters, split between characters. */
export function encodeWords(text: string): string {
  const value = oneLine(text);
  if (isPlain(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    // 45 bytes of UTF-8 make 60 of base64, which with "=?UTF-8?B?" and "?=" stays under 76.
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map(word => `=?UTF-8?B?${Buffer.from(word).toString('base64')}?=`).join(`${CRLF} `);
}

/** One address with its display name: plain, quoted where it has specials, or encoded. */
export function formatAddress(recipient: Recipient): string {
  const address = oneLine(recipient.address).replace(/[<>\s,;"]/g, '');
  const name = oneLine(recipient.name ?? '').trim();
  if (!name) return address;
  if (!isPlain(name)) return `${encodeWords(name)} <${address}>`;
  if (/^[\w !#$%&'*+\-/=?^`{|}~]+$/.test(name)) return `${name} <${address}>`;
  return `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>`;
}

/** A header line, folded at commas or spaces to stay near 78 characters. */
function header(name: string, value: string): string {
  const parts = value.split(/(?<=,) |(?<=>) (?=<)/);
  const lines: string[] = [];
  let line = `${name}: `;
  for (const [index, part] of parts.entries()) {
    if (index > 0 && line.length + part.length + 1 > 78) {
      lines.push(line);
      line = ` ${part}`;
    } else {
      line += index > 0 ? ` ${part}` : part;
    }
  }
  lines.push(line);
  return lines.join(CRLF);
}

const addresses = (list: Recipient[]) => list.map(formatAddress).join(', ');
const base64Lines = (content: Buffer) => (content.toString('base64').match(new RegExp(`.{1,${LINE}}`, 'g')) ?? []).join(CRLF);

/** A file name parameter: plain, or RFC 2231's UTF-8 form beside an encoded-word fallback. */
function fileParameter(parameter: 'name' | 'filename', filename: string): string {
  const name = oneLine(filename).replace(/[\\"]/g, '_');
  if (isPlain(name)) return `${parameter}="${name}"`;
  return `${parameter}*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}

function textPart(type: 'plain' | 'html', body: string): string {
  // Lines end CRLF in the bytes base64 carries.
  const normalised = body.replace(/\r?\n/g, CRLF);
  return [`Content-Type: text/${type}; charset="UTF-8"`, 'Content-Transfer-Encoding: base64', '', base64Lines(Buffer.from(normalised, 'utf8'))].join(CRLF);
}

function attachmentPart(file: OutgoingAttachment): string {
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : 'application/octet-stream';
  return [
    `Content-Type: ${type}; ${fileParameter('name', file.filename)}`,
    `Content-Disposition: attachment; ${fileParameter('filename', file.filename)}`,
    'Content-Transfer-Encoding: base64', '', base64Lines(file.content),
  ].join(CRLF);
}

export interface InlineImage {
  cid: string;
  mimeType: string;
  content: Buffer;
}

/**
 * The HTML with each data: image (png, jpeg, gif or webp) swapped for a cid: reference, and the
 * images to send beside it. The same URI twice is one image. The HTML is parse5's, so its
 * attributes are double-quoted.
 */
export function inlineImages(html: string, seed: string): {html: string; images: InlineImage[]} {
  const images: InlineImage[] = [];
  const byUri = new Map<string, string>();
  const replaced = html.replace(/(\ssrc=")(data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+))"/gi, (_match, before: string, uri: string, type: string, data: string) => {
    let cid = byUri.get(uri);
    if (!cid) {
      cid = `img${images.length + 1}.${seed}`;
      byUri.set(uri, cid);
      images.push({cid, mimeType: `image/${type.toLowerCase()}`, content: Buffer.from(data, 'base64')});
    }
    return `${before}cid:${cid}"`;
  });
  return {html: replaced, images};
}

function imagePart(image: InlineImage): string {
  return [`Content-Type: ${image.mimeType}`, `Content-ID: <${image.cid}>`, 'Content-Disposition: inline', 'Content-Transfer-Encoding: base64', '', base64Lines(image.content)].join(CRLF);
}

function multipart(boundary: string, parts: string[]): string {
  return [...parts.map(part => `--${boundary}${CRLF}${part}`), `--${boundary}--`].join(CRLF) + CRLF;
}

/**
 * The email's bytes. `bcc: false` leaves the Bcc line out (the copy SMTP delivers); true keeps it
 * (Gmail's send, the copy filed in Sent).
 */
export function buildMessage(message: OutgoingMessage, {bcc}: {bcc: boolean}): Buffer {
  const seed = message.boundarySeed.replace(/[^\w.-]/g, '');
  const {html, images} = inlineImages(message.html, seed);
  const htmlPart = images.length
    ? `Content-Type: multipart/related; type="text/html"; boundary="=_sp_rel_${seed}"${CRLF}${CRLF}${multipart(`=_sp_rel_${seed}`, [textPart('html', html), ...images.map(imagePart)])}`
    : textPart('html', html);
  const alternative = multipart(`=_sp_alt_${seed}`, [textPart('plain', message.text), htmlPart]);
  const altHeader = `Content-Type: multipart/alternative; boundary="=_sp_alt_${seed}"`;
  const body = message.attachments.length
    ? {type: `Content-Type: multipart/mixed; boundary="=_sp_mix_${seed}"`, content: multipart(`=_sp_mix_${seed}`, [`${altHeader}${CRLF}${CRLF}${alternative}`, ...message.attachments.map(attachmentPart)])}
    : {type: altHeader, content: alternative};
  const references = message.references.map(oneLine);
  const lines = [
    header('Date', rfc5322Date(message.date)),
    header('From', formatAddress(message.from)),
    ...(message.to.length ? [header('To', addresses(message.to))] : []),
    ...(message.cc.length ? [header('Cc', addresses(message.cc))] : []),
    ...(bcc && message.bcc.length ? [header('Bcc', addresses(message.bcc))] : []),
    header('Subject', encodeWords(message.subject)),
    header('Message-ID', oneLine(message.messageId)),
    ...(message.inReplyTo ? [header('In-Reply-To', oneLine(message.inReplyTo))] : []),
    ...(references.length ? [header('References', references.join(' '))] : []),
    'MIME-Version: 1.0',
    body.type,
  ];
  return Buffer.from(`${lines.join(CRLF)}${CRLF}${CRLF}${body.content}`, 'utf8');
}

/**
 * In-Reply-To and References for an answer to an email: its own Message-ID answers it, after the
 * References it carried (or, when they are unknown, the one it answered). Nothing when the email
 * has no Message-ID and none is known.
 */
export function replyHeaders(answered: {rfc822Id: string | null; referenceIds: string[] | null; inReplyTo: string | null}): {inReplyTo: string | null; references: string[]} {
  const before = answered.referenceIds?.length ? answered.referenceIds : answered.inReplyTo ? [answered.inReplyTo] : [];
  if (!answered.rfc822Id) return {inReplyTo: null, references: before};
  return {inReplyTo: answered.rfc822Id, references: [...before.filter(id => id !== answered.rfc822Id), answered.rfc822Id]};
}
