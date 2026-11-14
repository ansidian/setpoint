// USPS Informed Delivery's daily digest (SV-274, D564): which email is one, the day it's for, and the
// mailpieces' pictures in it. The digest's HTML shows each mailpiece arriving as an image whose
// source is one of the email's inline parts ("cid:1037161434-038.jpg"):
// - a scan, `id="mailpiece-image-src-id"`;
// - a mailer's campaign, `id="campaign-representative-image-src-id"`: the mailer's own picture of a
//   real mailpiece (or its scan), counted in the digest's "You have 6 mailpiece(s)".
// A campaign also carries a ride-along, `id="campaign-ridealong-image-src-id"`: an ad, never a
// mailpiece, so it's never kept. Packages, the USPS logo, share buttons and tracking pixels aren't
// mailpieces either. A digest can say more pieces are coming than it has pictures for ("one or more
// mailpieces for which we do not currently have an image"); one saying 0 is "No mail today".
export const DIGEST_SENDER = 'uspsinformeddelivery@email.informeddelivery.usps.com';

/** Whether an email is the digest: USPS's sender, authenticated, with the digest's subject. */
export function isDigest(email: {fromAddress: string; subject: string; senderAuthenticated: boolean | null}): boolean {
  return email.fromAddress.trim().toLowerCase() === DIGEST_SENDER && email.senderAuthenticated === true
    && email.subject.startsWith('Your Daily Digest for ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The day a digest is for, from its subject ("Your Daily Digest for Thu, 11/12 is ready to view"),
 * in the year of the local day it arrived, or the year before or after when that's nearer (a digest
 * for 12/31 that arrives on Jan 1). Null when the subject doesn't say.
 */
export function digestDay(subject: string, receivedDay: string): string | null {
  const match = /Daily Digest for \w+, (\d{1,2})\/(\d{1,2})\b/.exec(subject);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = Number(receivedDay.slice(0, 4));
  const received = Date.parse(`${receivedDay}T00:00:00Z`);
  const candidates = [year - 1, year, year + 1].map(y => `${y}-${pad(month)}-${pad(day)}`);
  return candidates.sort((a, b) => Math.abs(Date.parse(`${a}T00:00:00Z`) - received) - Math.abs(Date.parse(`${b}T00:00:00Z`) - received))[0]!;
}

/** How many mailpieces the digest says are coming ("You have 3 mailpiece(s)"); null when it doesn't say. */
export function statedPieces(text: string): number | null {
  const match = /You\s+have\s+(\d+)\s+mailpiece/i.exec(text);
  return match ? Number(match[1]) : null;
}

const PIECE_IDS = new Set(['mailpiece-image-src-id', 'campaign-representative-image-src-id']);
export const KEPT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

/** The `cid:` sources of the mailpieces' images in the digest's HTML, in order, each once. */
export function pieceSources(html: string): string[] {
  const sources: string[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.trim();
    const src = /\bsrc\s*=\s*["']cid:([^"']+)["']/i.exec(tag)?.[1]?.trim();
    if (!id || !src || !PIECE_IDS.has(id) || sources.includes(src)) continue;
    sources.push(src);
  }
  return sources;
}

export interface Scan {
  mimeType: string;
  content: Buffer;
}

export interface ReadDigest {
  // What the digest says is coming; null when it doesn't say (the scans' count stands in).
  pieces: number | null;
  scans: Scan[];
}

/** A `cid:` reference as the part's Content-ID or filename is matched: no angle brackets, any case. */
export const bareCid = (cid: string) => cid.trim().replace(/^<|>$/g, '').toLowerCase();
