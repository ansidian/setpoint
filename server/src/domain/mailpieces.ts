// USPS Informed Delivery's daily digest: which email is one, the day it's for, and the
// mailpieces' pictures in it. The digest's HTML shows each mailpiece arriving as an image whose
// source is one of the email's inline parts ("cid:1037161434-038.jpg"):
// - a scan, `id="mailpiece-image-src-id"`.
// - a mailer's campaign, `id="campaign-representative-image-src-id"`, which the digest counts in
//   "You have 6 mailpiece(s)". Its picture is either the piece's own scan ("1037161434-038.jpg"), a
//   real letter that is kept and counted, or the mailer's artwork ("mailer-12345.jpg"), such as
//   USPS's own Postal Store ad, neither kept nor counted. Its ride-along ad,
//   `id="campaign-ridealong-image-src-id"` ("content-12345.jpg"), is never kept. The names are
//   told apart as the Home Assistant Mail and Packages integration does.
// Packages, the USPS logo, share buttons and tracking pixels aren't mailpieces either. A digest can
// say more pieces are coming than it has pictures for ("one or more mailpieces for which we do not
// currently have an image"). One saying 0 is "No mail today".
export const DIGEST_SENDER = 'uspsinformeddelivery@email.informeddelivery.usps.com';

/** Whether an email is the digest: USPS's sender, authenticated, with the digest's subject. */
export function isDigest(email: {fromAddress: string; subject: string; senderAuthenticated: boolean | null}): boolean {
  return email.fromAddress.trim().toLowerCase() === DIGEST_SENDER && email.senderAuthenticated === true
    && email.subject.startsWith('Your Daily Digest for ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The day a digest is for, from its subject ("Your Daily Digest for Thu, 11/12 is ready to view").
 * The year is the year of the local day it arrived, or the year before or after when that's nearer
 * (a digest for 12/31 that arrives on Jan 1). Null when the subject doesn't say.
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

/** How many mailpieces the digest says are coming ("You have 3 mailpiece(s)"). Null when it doesn't say. */
export function statedPieces(text: string): number | null {
  const match = /You\s+have\s+(\d+)\s+mailpiece/i.exec(text);
  return match ? Number(match[1]) : null;
}

const SCAN_ID = 'mailpiece-image-src-id';
const CAMPAIGN_ID = 'campaign-representative-image-src-id';
export const KEPT_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']);

// The names of a mailer's artwork, a ride-along ad and a package's picture, never a scan.
const ARTWORK_NAMES = ['mailer', 'content', 'package', 'ra_0'];
const isArtwork = (cid: string) => ARTWORK_NAMES.some(name => bareCid(cid).includes(name));

/** The `cid:` sources of the scans and campaigns' pictures in the digest's HTML, in order, each once. */
function piecePictures(html: string): {src: string; artwork: boolean}[] {
  const pictures: {src: string; artwork: boolean}[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.trim();
    const src = /\bsrc\s*=\s*["']cid:([^"']+)["']/i.exec(tag)?.[1]?.trim();
    if ((id !== SCAN_ID && id !== CAMPAIGN_ID) || !src || pictures.some(picture => picture.src === src)) continue;
    pictures.push({src, artwork: isArtwork(src)});
  }
  return pictures;
}

/** The `cid:` sources of the mailpieces' scans in the digest's HTML, campaigns' included, in order, each once. */
export const pieceSources = (html: string) => piecePictures(html).filter(picture => !picture.artwork).map(picture => picture.src);

/** How many mailers' artwork pictures the digest shows, which its stated count includes. */
export const artworkCount = (html: string) => piecePictures(html).filter(picture => picture.artwork).length;

export interface Scan {
  mimeType: string;
  content: Buffer;
}

export interface ReadDigest {
  // What the digest says is coming. Null when it doesn't say (the scans' count stands in).
  pieces: number | null;
  scans: Scan[];
}

/** A `cid:` reference as the part's Content-ID or filename is matched: no angle brackets, any case. */
export const bareCid = (cid: string) => cid.trim().replace(/^<|>$/g, '').toLowerCase();
