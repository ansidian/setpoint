// SV-274: an invented USPS Informed Delivery digest, shaped like the real one (an HTML body whose
// mailpieces are `cid:` images, a campaign with its ride-along ad, a package line, the logo and a
// tracking pixel), for the dev provider and the tests. Its scans are drawn here: grey envelopes and
// flats with an address block, a stamp and a barcode, each a little different. Nothing in it comes
// from a real digest.
import {crc32, deflateSync} from 'node:zlib';
import {eq} from 'drizzle-orm';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import type {OpenDatabase} from '../db/open.ts';
import * as t from '../db/schema.ts';
import {DIGEST_SENDER} from '../domain/mailpieces.ts';
import {searchBody} from '../domain/searchBody.ts';
import {zonedInstant} from '../domain/time.ts';

/** A greyscale PNG drawn by `shade(x, y)` (0 black, 255 white). */
function greyPng(width: number, height: number, shade: (x: number, y: number) => number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) rows[y * (width + 1) + 1 + x] = shade(x, y);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const inside = (x: number, y: number, [left, top, width, height]: readonly number[]) => x >= left! && x < left! + width! && y >= top! && y < top! + height!;

/** One invented scan: a letter (wide) or a flat (taller), its blocks moved a little by `seed`. */
export function devScan(seed: number): Buffer {
  const flat = seed % 4 === 3;
  const [width, height] = flat ? [300, 220] : [360, 170];
  const nudge = (seed * 37) % 23;
  const lines = [
    [Math.round(width * 0.36) + nudge, Math.round(height * 0.5), Math.round(width * 0.4), 7],
    [Math.round(width * 0.36) + nudge, Math.round(height * 0.5) + 14, Math.round(width * 0.32), 7],
    [Math.round(width * 0.36) + nudge, Math.round(height * 0.5) + 28, Math.round(width * 0.36), 7],
  ];
  const sender = [[16, 16, 70 + nudge, 5], [16, 26, 54 + nudge, 5]];
  const stamp = [width - 52, 14, 36, 42];
  const window = seed % 3 === 1 ? [Math.round(width * 0.33) + nudge - 8, Math.round(height * 0.5) - 8, Math.round(width * 0.46), 52] : null;
  return greyPng(width, height, (x, y) => {
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) return 150;
    if (inside(x, y, stamp)) return 95 + ((x + y) % 9);
    if ([...lines, ...sender].some(block => inside(x, y, block))) return 70;
    if (y > height - 22 && y < height - 10 && x > width * 0.3 && x < width * 0.88 && (x + seed) % 5 < 2) return 60;
    if (window && inside(x, y, window)) return 236;
    return 214 - ((x * 3 + y * 5 + seed * 11) % 7);
  });
}

/** An invented campaign picture: a mailer's own artwork, a dark band with a lighter panel. */
const devMailerArt = (seed: number) => greyPng(320, 180, (x, y) => (x > 20 && x < 300 && y > 110 && y < 160 ? 230 : 40 + ((x + seed * 13) % 60)));

/** An invented ride-along ad, never a mailpiece. */
const devAd = () => greyPng(300, 120, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? 250 : 20);

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface DevDigestOptions {
  // `YYYY-MM-DD`, the day it's for.
  day: string;
  // Plain scans, then campaigns (the mailer's picture with a ride-along ad).
  scans: number;
  campaigns?: number;
  // Pieces the digest says are coming without a picture.
  withoutImage?: number;
  // The first scan's seed, so days differ.
  seed?: number;
  messageId?: string;
}

/** The digest's subject: "Your Daily Digest for Thu, 11/12 is ready to view". */
export function devDigestSubject(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return `Your Daily Digest for ${DAY_NAMES[date.getUTCDay()]}, ${date.getUTCMonth() + 1}/${date.getUTCDate()} is ready to view`;
}

const base64Lines = (content: Buffer) => content.toString('base64').replace(/.{1,76}/g, '$&\r\n');

/** An invented digest's RFC 822 source. */
export function devDigestSource({day, scans, campaigns = 0, withoutImage = 0, seed = 1, messageId = `<digest-${day}@informeddelivery.example>`}: DevDigestOptions): Buffer {
  const pieces = scans + campaigns + withoutImage;
  const parts: {cid: string; type: string; content: Buffer}[] = [];
  const blocks: string[] = [];
  for (let n = 0; n < campaigns; n += 1) {
    const art = `mailer-${seed * 100 + n}.jpg`;
    const ad = `content-${seed * 100 + n}.jpg`;
    parts.push({cid: art, type: 'image/png', content: devMailerArt(seed + n)}, {cid: ad, type: 'image/png', content: devAd()});
    blocks.push(`<img id="campaign-representative-image-src-id" alt="campaign" src="cid:${art}">`,
      `<img id="campaign-ridealong-image-src-id" style="width: 300px;" src="cid:${ad}" alt="RideAlong image">`,
      `<img id="campaign-ridealong-image-src-id-secondary" style="mso-hide:all;max-width: 300px" src="cid:${ad}" alt="RideAlong">`);
  }
  for (let n = 0; n < scans; n += 1) {
    const scan = `${1000000000 + seed * 100 + n}-038.jpg`;
    parts.push({cid: scan, type: 'image/png', content: devScan(seed + n)});
    blocks.push(`<img id="mailpiece-image-src-id" style="padding-top:15px;" src="cid:${scan}" alt="Mailpiece Image">`);
  }
  const html = [
    '<html><body>',
    '<img height="0" width="0" alt="" src="https://informeddelivery.example/tracking/emailRead?emailToken=dev">',
    '<img src="https://www.usps.example/email/id/uspslogo.png" alt="USPS Logo" width="64" height="36">',
    `<p>COMING TO YOU SOON</p><p>Hi! You have ${pieces} mailpiece(s) and 1 inbound package(s) arriving soon.</p>`,
    ...blocks,
    withoutImage ? '<p>There is one or more mailpieces for which we do not currently have an image that is included in today\'s mail.</p>' : '',
    '<img id="footer-banner-img-id" style="width: 100%" src="https://www.usps.example/email/id/banner.png" alt="footer banner">',
    '</body></html>',
  ].join('\r\n');
  const boundary = 'dev-digest-related';
  const lines = [
    `From: USPS Informed Delivery <${DIGEST_SENDER}>`,
    'To: you@example.com',
    `Subject: ${devDigestSubject(day)}`,
    `Date: ${new Date(`${day}T15:30:00Z`).toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    ...parts.flatMap(part => [
      `--${boundary}`,
      `Content-Type: ${part.type}; name="${part.cid}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${part.cid}>`,
      `Content-Disposition: inline; filename="${part.cid}"`,
      '',
      base64Lines(part.content),
    ]),
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'));
}

/**
 * The seed's digests (src/dev/sample.ts), the days before SEED_NOW (Wed, Oct 7): mail most days, a
 * Monday saying nothing is coming, none on Sunday, a Saturday with more than the rail fits, and a
 * day with a piece USPS has no picture of. The dev provider serves each one's source by its id.
 */
export const DEV_DIGESTS: readonly (DevDigestOptions & {providerId: string})[] = [
  {day: '2026-10-07', scans: 3, campaigns: 1, seed: 71},
  {day: '2026-10-06', scans: 2, seed: 61},
  {day: '2026-10-05', scans: 0, seed: 51},
  {day: '2026-10-03', scans: 7, campaigns: 1, seed: 31},
  {day: '2026-10-02', scans: 1, seed: 21},
  {day: '2026-10-01', scans: 2, withoutImage: 1, seed: 11},
  {day: '2026-09-30', scans: 4, seed: 1},
].map(digest => ({...digest, providerId: `seed-digest-${digest.day}`}));

/** The scans a seed digest's source holds, in its order: the campaigns' pictures, then the scans. */
export const devDigestScans = (digest: DevDigestOptions) => [
  ...Array.from({length: digest.campaigns ?? 0}, (_, n) => devMailerArt((digest.seed ?? 1) + n)),
  ...Array.from({length: digest.scans}, (_, n) => devScan((digest.seed ?? 1) + n)),
];

/**
 * Writes the seed's digests to the record under an account, as the mailpieces worker keeps them from
 * each one's source: the email (out of the Inbox), its day and its scans. A digest already there is
 * left as it is.
 */
export function insertDevDigests(db: Pick<OpenDatabase['db'], 'insert' | 'select'>, accountId: number) {
  for (const digest of DEV_DIGESTS) {
    if (db.select({id: t.messages.id}).from(t.messages).where(eq(t.messages.providerId, digest.providerId)).get()) continue;
    const receivedAt = zonedInstant(digest.day, '07:30', SEED_TIME_ZONE);
    const pieces = digest.scans + (digest.campaigns ?? 0) + (digest.withoutImage ?? 0);
    const body = `You have ${pieces} mailpiece(s) and 1 inbound package(s) arriving soon.`;
    const message = db.insert(t.messages).values({
      accountId, providerId: digest.providerId, threadId: `${digest.providerId}-thread`,
      fromName: 'USPS Informed Delivery', fromAddress: DIGEST_SENDER, organisation: 'USPS', subject: devDigestSubject(digest.day),
      snippet: body, bodyText: body, searchBody: searchBody(body), receivedAt, unread: false, senderAuthenticated: true,
      lane: 'fyi', kind: 'deliveries', triageSource: 'rule', triagedAt: receivedAt, uspsDigest: true,
    }).returning({id: t.messages.id}).get();
    const row = db.insert(t.mailDigests).values({messageId: message.id, day: digest.day, pieces, storedAt: receivedAt}).returning({id: t.mailDigests.id}).get();
    devDigestScans(digest).forEach((bytes, position) => db.insert(t.mailScans).values({digestId: row.id, position, mimeType: 'image/png', bytes}).run());
  }
}
