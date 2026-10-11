// The reader's rules (DESIGN.md › The reader; BRIEF.md › The reader and Security mail): who it's
// from, which actions it offers, the security facts card, whether remote images load, and the
// attachments' labels and previews.
import type {AttachmentOut, MessageOut, RemoteContentOut, SecurityFacts} from '@setpoint/shared';
import {clockTime, daysBetween, localDate} from './format.ts';

/**
 * The head's line after the sender's name: "organisation · via platform" in `ink2` (DESIGN.md ›
 * The reader); when the organisation is the sender (Google, Contoso Coffee), the sender's domain in
 * `ink3`, as boards 02 and 03 draw it. The reader puts " · " before it (on the phone it has its own line).
 */
export function senderLine(message: Pick<MessageOut, 'from_name' | 'organisation' | 'via' | 'remote_content'>): {text: string; tone: 'ink2' | 'ink3'} | null {
  const parts = [message.organisation && message.organisation !== message.from_name ? message.organisation : null, message.via ? `via ${message.via}` : null]
    .filter((part): part is string => Boolean(part));
  if (parts.length) return {text: parts.join(' · '), tone: 'ink2'};
  return message.remote_content.domain ? {text: message.remote_content.domain, tone: 'ink3'} : null;
}

/**
 * Where Add to calendar and Add as task live: under the head, or in the tools' More menu on Security
 * mail (its facts card stands in) and Noise (2026-10-08; boards 02 and 03 draw no buttons).
 * Ask about this email is under the head on every email. Done is there only for Attention mail not
 * yet Done: elsewhere opening the email has already read it, so Done changed nothing but the toast
 * (2026-10-10; DESIGN.md #93).
 */
export function readerActions(message: Pick<MessageOut, 'kind' | 'lane' | 'done'>): {done: boolean; proposals: 'buttons' | 'more'; ask: true} {
  return {
    done: message.lane === 'attention' && !message.done,
    proposals: message.kind === 'security' || message.lane === 'noise' ? 'more' : 'buttons',
    ask: true,
  };
}

/** "Today, 8:52 AM", "Yesterday, 6:41 PM", "Mon, Oct 5, 10:05 AM", with the year once it isn't this year's. */
export function whenLabel(at: string, now: number, timeZone: string): string {
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  const time = clockTime(at, timeZone);
  const days = daysBetween(day, today);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const options: Intl.DateTimeFormatOptions = day.slice(0, 4) === today.slice(0, 4)
    ? {weekday: 'short', month: 'short', day: 'numeric'} : {month: 'short', day: 'numeric', year: 'numeric'};
  return `${new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'})}, ${time}`;
}

export type FactIcon = 'history' | 'schedule' | 'computer' | 'location_on' | 'lock';

export interface FactRow {
  icon: FactIcon;
  label: string;
  value: string;
  // "· not a place you use", in `alert`.
  note: string | null;
}

/**
 * The facts card (board 03): what happened, when, the device, the location and the app, each when
 * known. A place or device the user doesn't use says "not a place you use" after the location (or the
 * device when there's no location).
 */
export function factRows(facts: SecurityFacts, receivedAt: string, now: number, timeZone: string): FactRow[] {
  const rows: FactRow[] = [
    {icon: 'history', label: 'What happened', value: facts.what, note: null},
    {icon: 'schedule', label: 'When', value: whenLabel(receivedAt, now, timeZone), note: null},
  ];
  if (facts.device) rows.push({icon: 'computer', label: 'Device', value: facts.device, note: null});
  if (facts.location) rows.push({icon: 'location_on', label: 'Location', value: facts.location, note: null});
  if (facts.app) rows.push({icon: 'lock', label: 'App', value: facts.app, note: null});
  if (facts.unfamiliar) {
    const place = rows.find(row => row.icon === 'location_on') ?? rows.find(row => row.icon === 'computer');
    if (place) place.note = '· not a place you use';
  }
  return rows;
}

/** Whether an HTML body asks for anything remote: images, backgrounds, stylesheets. */
export function hasRemoteContent(html: string | null): boolean {
  if (!html) return false;
  return /\b(?:src|srcset|background|poster)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html)
    || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html)
    || /<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html);
}

/**
 * Whether remote images load, and whether the images-hidden bar shows: they load on their own when
 * the server says so (the sender passed DMARC and it isn't Noise, or its domain is trusted), or once
 * the user says Show for this email. The bar shows only while there's something hidden.
 */
export function remoteImages(remote: RemoteContentOut, hasRemote: boolean, shownOnce: boolean): {load: boolean; bar: boolean} {
  const load = remote.load || shownOnce;
  return {load, bar: hasRemote && !load};
}

export type PreviewKind = 'pdf' | 'image' | 'csv';

/** PDF, image and CSV open a preview (BRIEF.md › The reader). */
export function previewKind(file: Pick<AttachmentOut, 'mime_type' | 'filename'>): PreviewKind | null {
  const mime = file.mime_type.toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (/^image\/(png|jpeg|gif|webp)$/.test(mime)) return 'image';
  if (mime === 'text/csv' || (mime === 'application/vnd.ms-excel' && /\.csv$/i.test(file.filename))) return 'csv';
  return null;
}

/** "184 KB", "1.2 MB", "312 bytes": binary units, as mail clients show them. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.max(1, Math.round(kb))} KB`;
  const mb = kb / 1024;
  if (mb < 1000) return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, '')} GB`;
}

/** An attachment's second line: "PDF · 184 KB" (the type from the file's name, else its MIME type). */
export function attachmentLabel(file: Pick<AttachmentOut, 'filename' | 'mime_type' | 'size_bytes'>): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(file.filename)?.[1];
  const subtype = file.mime_type.split('/')[1]?.split(/[+;.-]/)[0];
  const type = (extension ?? subtype ?? 'File').toUpperCase().replace(/^JPG$/, 'JPEG');
  return `${type} · ${fileSize(file.size_bytes)}`;
}

/**
 * CSV as rows of cells (RFC 4180): commas, quoted fields with doubled quotes and line breaks, CRLF
 * or LF, and a final line break that doesn't start a row. At most `limit` rows.
 */
export function parseCsv(text: string, limit = Infinity): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = '';
  };
  for (; at < text.length && rows.length < limit; at += 1) {
    const char = text[at]!;
    if (quoted) {
      if (char === '"' && text[at + 1] === '"') {
        field += '"';
        at += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' && text[at + 1] === '\n') {
      endRow();
      at += 1;
    } else if (char === '\n' || char === '\r') endRow();
    else field += char;
  }
  if (rows.length < limit && (field !== '' || row.length)) endRow();
  return rows;
}

/** How wide the reading pane may be dragged (2026-10-09); DESIGN.md's 680 is where it starts. */
export const READING_PANE = {min: 480, max: 1100, start: 680, step: 16} as const;

/** A dragged or stored width, whole and inside the bounds; anything unreadable is the start. */
export function paneWidth(width: number | string | null): number {
  const value = width === null || width === '' ? NaN : Number(width);
  return Number.isFinite(value) ? Math.round(Math.min(READING_PANE.max, Math.max(READING_PANE.min, value))) : READING_PANE.start;
}
