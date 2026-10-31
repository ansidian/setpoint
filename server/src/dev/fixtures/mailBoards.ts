// Mail boards' fixtures (SV decision D3), registered in index.ts: the dev seed holds BRIEF.md's
// counts exactly, and a board whose state differs gets a small change layered on a freshly seeded
// database instead.
//
//   coffee-html     02: Contoso Coffee's newsletter as the board draws it, a 600 px HTML email with
//                   remote images
//   recovery-html   03: Google's recovery-email alert as the board's HTML email
//   new-digest      09: four Northwind Engineering digests cleared unopened (the real prompt's run)
//                   and a fifth that arrived "now", unread in Attention
//                   (4 attention, 20 unread, Jobs 3); B3's GET /api/mail/prompts raises the prompt
//   second-pin      10: the DMV's renewal notice, pinned before Parkside's lease
//   code-expiring   mail checks: Contoso Insurance's code expires 12 seconds after the seed's moment
//   newsletter-html mail checks: Contoso Coffee's newsletter as a mailing service builds one, mostly
//                   images with only a width, in a shell wider than the frame
//   last-year       search checks: a Northwind rejection from Dec 20, 2025, so a row's age carries its
//                   year ("Dec 20, 2025"), the longest it gets
import {SEED_NOW} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import type {Db, OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {searchBody} from '../../domain/searchBody.ts';
import {zoned} from '../sample.ts';


// Board 02's newsletter, its placeholders as the remote images they stand for. The image host is an
// `.example` domain, so nothing ever loads from it.
const IMG = 'https://cdn.contosocoffee.example/journal/2026-10';
export const CONTOSO_COFFEE_HTML = `<!doctype html>
<html><head><style>p { margin: 0; }</style></head>
<body>
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 600px; border-collapse: collapse">
  <tbody>
    <tr>
      <td style="padding: 18px 32px; border-bottom: 1px solid #eceef0">
        <div style="display: flex; align-items: center; gap: 16px">
          <img src="${IMG}/logo.png" alt="Contoso Coffee" style="display: block; width: 132px; height: 30px; border-radius: 4px">
          <span style="flex: 1"></span>
          <span style="font-size: 12px; color: #8a8e94">Shop · Journal · Subscriptions</span>
        </div>
      </td>
    </tr>
    <tr>
      <td><img src="${IMG}/hero.jpg" alt="Hero image" width="600" height="130" style="display: block"></td>
    </tr>
    <tr>
      <td style="padding: 22px 32px 6px">
        <p style="font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #8b5a2b">The Journal · October 2026</p>
        <p style="font-size: 22px; font-weight: 700; line-height: 1.2; margin-top: 4px">A new harvest from Huila</p>
        <p style="font-size: 13.5px; line-height: 1.5; margin-top: 8px; color: #3c4046">Our first lots from the 2026 Huila harvest are roasting now: red apple, panela and a long, clean finish. Here's what else is new this month.</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 14px 32px 18px">
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px">
          <div>
            <img src="${IMG}/growers.jpg" alt="Article image" style="display: block; height: 96px; border-radius: 4px">
            <p style="font-size: 14px; font-weight: 700; line-height: 1.3; margin-top: 10px">Meet the growers of La Esperanza</p>
            <p style="font-size: 12.5px; line-height: 1.4; margin-top: 4px; color: #5b5f66">Three generations on one hillside farm.</p>
          </div>
          <div>
            <img src="${IMG}/pour-over.jpg" alt="Article image" style="display: block; height: 96px; border-radius: 4px">
            <p style="font-size: 14px; font-weight: 700; line-height: 1.3; margin-top: 10px">Dialing in a pour-over at home</p>
            <p style="font-size: 12.5px; line-height: 1.4; margin-top: 4px; color: #5b5f66">Grind, ratio and a three-minute brew.</p>
          </div>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 0 32px 18px">
        <p style="font-size: 14px; font-weight: 700">Roasting this month</p>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px; font-size: 12.5px; line-height: 1.35">
          <div style="display: flex; flex-direction: column; gap: 4px"><img src="${IMG}/huila.jpg" alt="Product" style="display: block; height: 56px; border-radius: 4px"><p>Huila La Esperanza</p><p style="font-weight: 700">$19 · 12 oz</p></div>
          <div style="display: flex; flex-direction: column; gap: 4px"><img src="${IMG}/guji.jpg" alt="Product" style="display: block; height: 56px; border-radius: 4px"><p>Ethiopia Guji</p><p style="font-weight: 700">$21 · 12 oz</p></div>
          <div style="display: flex; flex-direction: column; gap: 4px"><img src="${IMG}/espresso.jpg" alt="Product" style="display: block; height: 56px; border-radius: 4px"><p>House Espresso</p><p style="font-weight: 700">$17 · 12 oz</p></div>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 14px 32px 16px; background: #f6f7f8; font-size: 11.5px; line-height: 1.5; color: #8a8e94">
        <p>You're receiving the Contoso Coffee Journal because you joined our list at contosocoffee.example.</p>
        <p style="margin-top: 4px"><a href="https://contosocoffee.example/unsubscribe" style="color: #5b5f66; text-decoration: underline">Unsubscribe</a> · <a href="https://contosocoffee.example/preferences" style="color: #5b5f66; text-decoration: underline">Email preferences</a> · <a href="https://contosocoffee.example/journal" style="color: #5b5f66; text-decoration: underline">View in browser</a> · Contoso Coffee Roasters, Seattle, WA</p>
      </td>
    </tr>
  </tbody>
</table>
</body></html>`;

// Board 03's alert, as Google sends it: no remote images.
export const GOOGLE_RECOVERY_HTML = `<!doctype html>
<html><head><style>p { margin: 0; }</style></head>
<body>
<table role="presentation" cellpadding="0" cellspacing="0" style="width: 600px; border-collapse: collapse">
  <tbody>
    <tr>
      <td style="padding: 36px 48px 0">
        <div style="border: 1px solid #eceef0; border-radius: 8px; padding: 32px 36px 28px; text-align: center">
          <p style="font-size: 22px; letter-spacing: -.01em; color: #8a8e94">Google</p>
          <p style="font-size: 22px; line-height: 1.3; margin-top: 18px">Your recovery email was changed</p>
          <p style="display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; padding: 4px 12px 4px 4px; border: 1px solid #eceef0; border-radius: 999px; font-size: 13px">
            <span style="width: 22px; height: 22px; border-radius: 999px; background: #eceef0; display: inline-grid; place-items: center; font-size: 11px">A</span>a••••@gmail.com
          </p>
          <div style="border-top: 1px solid #eceef0; margin: 22px 0 0; padding-top: 22px; text-align: left; font-size: 14px; line-height: 1.55">
            <p>The recovery email for your Google Account was changed to r••••••@outlook.com.</p>
            <p style="margin-top: 12px">If you didn't change it, someone else may be using your account. Check this activity and secure your account now.</p>
            <p style="margin-top: 22px; text-align: center"><a href="https://myaccount.google.example/notifications" style="display: inline-flex; align-items: center; height: 38px; padding: 0 22px; border-radius: 6px; background: #1d1f22; color: #ffffff; text-decoration: none; font-weight: 700; font-size: 14px">Check activity</a></p>
          </div>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 48px 32px; text-align: center; font-size: 12px; line-height: 1.5; color: #8a8e94">
        <p>You can also see security activity at myaccount.google.com/notifications</p>
        <p style="margin-top: 14px">You received this email to let you know about important changes to your Google Account and services.</p>
        <p style="margin-top: 6px">© 2026 Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA</p>
      </td>
    </tr>
  </tbody>
</table>
</body></html>`;

// The shape a mailing service gives a newsletter that is mostly pictures: a 622 px shell (wider than
// the frame), images that carry only a width and take their height from the picture once it loads,
// and media queries for narrow screens. The pictures' host is an `.example` domain.
const PICTURES = 'https://files.mailing.example/contoso-coffee';
export const IMAGE_NEWSLETTER_HTML = `<!doctype html>
<html><head><style>.shell img { -ms-interpolation-mode: bicubic; } @media only screen and (max-width: 480px) { .stack { display: block !important; width: 100% !important; } }</style></head>
<body>
<div class="shell" style="background-color: #233d23">
  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #233d23"><tr><td align="center" valign="top">
    <table class="scale" style="width: 622px" align="center" border="0" cellpadding="0" cellspacing="0"><tr><td style="padding: 15px 10px" align="center" valign="top">
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #ffffff">
        <tr><td align="center"><img src="${PICTURES}/masthead.png" width="602" alt="" style="display: block; height: auto; max-width: 100%"></td></tr>
        <tr><td align="center"><img src="${PICTURES}/harvest.png" width="602" alt="" style="display: block; height: auto; max-width: 100%"></td></tr>
        <tr><td align="center"><img src="${PICTURES}/roasting.png" width="602" alt="" style="display: block; height: auto; max-width: 100%"></td></tr>
        <tr><td align="center" style="padding: 11px">
          <a href="https://contosocoffee.example/social"><img src="${PICTURES}/social.png" width="32" alt="Social" style="display: inline-block"></a>
        </td></tr>
      </table>
    </td></tr></table>
  </td></tr></table>
  <p style="margin: 0; padding: 10px 20px; background: #ffffff; text-align: center; font: 12px Verdana, sans-serif; color: #595959">Contoso Coffee Roasters | Seattle, WA · <a href="https://contosocoffee.example/unsubscribe" style="color: inherit">Unsubscribe</a></p>
</div>
</body></html>`;

const bySubject = (db: Db, subject: string) => {
  const row = db.select().from(t.messages).where(eq(t.messages.subject, subject)).get();
  if (!row) throw new Error(`The seed has no email "${subject}": run \`npm run seed\` first.`);
  return row;
};

const setHtml = (db: Db, subject: string, html: string) =>
  db.update(t.messages).set({bodyHtml: html}).where(eq(t.messages.id, bySubject(db, subject).id)).run();

export const coffeeHtml = ({db}: OpenDatabase) => setHtml(db, 'The Contoso Coffee Journal · October', CONTOSO_COFFEE_HTML);

export const newsletterHtml = ({db}: OpenDatabase) => setHtml(db, 'The Contoso Coffee Journal · October', IMAGE_NEWSLETTER_HTML);

export const recoveryHtml = ({db}: OpenDatabase) => setHtml(db, 'Your recovery email was changed', GOOGLE_RECOVERY_HTML);

const DIGEST_FROM = {fromName: 'Northwind Engineering', fromAddress: 'digest@eng.northwind.example', organisation: 'Northwind Engineering'};
const DIGEST_BODY = 'This week on the Northwind Engineering blog: new posts from the team.\n\nYou\'re receiving this because you applied to Northwind.';

/**
 * Board 09: four weeks of Northwind Engineering digests triaged to Attention and Done from the row
 * without opening (read later by Mark all as read, outside Attention), which is the run B3's real
 * pattern prompt counts, and a fifth digest that arrived "now", unread in Attention.
 */
export function newDigest({db}: OpenDatabase) {
  const jobs = db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get();
  if (!jobs) throw new Error('The new-digest fixture needs the seed\'s Jobs account: run `npm run seed` first.');
  for (const [date, label] of [['2026-09-02', 'September 2'], ['2026-09-09', 'September 9'], ['2026-09-16', 'September 16'], ['2026-09-23', 'September 23']] as const) {
    db.insert(t.messages).values({
      accountId: jobs.id, providerId: `fixture-09-digest-${date}`, threadId: `fixture-09-digest-${date}-thread`, ...DIGEST_FROM,
      subject: `Northwind Engineering Digest · ${label}`, summary: 'New posts from the team', snippet: DIGEST_BODY.split('\n')[0]!, bodyText: DIGEST_BODY, searchBody: searchBody(DIGEST_BODY),
      receivedAt: zoned(date, '06:30'), unread: false, lane: 'attention', kind: 'updates', type: 'newsletter',
      doneAt: zoned(date, '07:40'), openedBeforeDone: false,
    }).run();
  }
  db.insert(t.messages).values({
    accountId: jobs.id, providerId: 'fixture-09-digest', threadId: 'fixture-09-digest-thread',
    fromName: 'Northwind Engineering', fromAddress: 'digest@eng.northwind.example', organisation: 'Northwind Engineering',
    subject: 'Northwind Engineering Digest · October 7', summary: 'How we rebuilt search, and four more posts from the team',
    snippet: 'This week on the Northwind Engineering blog: how we rebuilt search, and four more posts from the team.',
    bodyText: 'This week on the Northwind Engineering blog: how we rebuilt search, and four more posts from the team.\n\nYou\'re receiving this because you applied to Northwind.',
    searchBody: searchBody('This week on the Northwind Engineering blog: how we rebuilt search, and four more posts from the team.\n\nYou\'re receiving this because you applied to Northwind.'),
    receivedAt: SEED_NOW, unread: true, lane: 'attention', kind: 'updates', type: 'newsletter',
  }).run();
}

export const secondPin = ({db}: OpenDatabase) =>
  db.update(t.messages).set({pinnedAt: zoned('2026-09-28', '10:30')}).where(eq(t.messages.id, bySubject(db, 'Car registration renewal notice').id)).run();

export const codeExpiring = ({db}: OpenDatabase) =>
  db.update(t.messages).set({codeExpiresAt: new Date(Date.parse(SEED_NOW) + 12_000).toISOString()}).where(eq(t.messages.id, bySubject(db, 'Your code is 482913').id)).run();

/** 60 emails about "ledger audit", more than a page, then 60 that only mention it, for search's fold. */
export function ledgerAudit({db}: OpenDatabase) {
  const jobs = db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get();
  if (!jobs) throw new Error('The ledger-audit fixture needs the seed\'s Jobs account: run `npm run seed` first.');
  const email = (at: number, subject: string, body: string, day: string) => {
    const bodyText = `${body}\n\nThis is number ${at}.`;
    return {
      accountId: jobs.id, providerId: `fixture-ledger-${at}`, threadId: `fixture-ledger-${at}-thread`, fromName: 'Fourth Coffee', fromAddress: 'books@fourthcoffee.example',
      subject, snippet: body, bodyText, searchBody: searchBody(bodyText), receivedAt: zoned(day, `${String(8 + at % 10).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`), unread: false, lane: 'fyi' as const,
    };
  };
  const rows = Array.from({length: 60}, (_, at) => [
    email(at, `Ledger audit, part ${at + 1}`, 'The figures for this part.', '2026-08-14'),
    email(at + 60, `Quarter notes, part ${at + 1}`, 'A ledger came up in the meeting, and later on there may well be an audit.', '2026-08-13'),
  ]).flat();
  db.insert(t.messages).values(rows).run();
}

export function lastYear({db}: OpenDatabase) {
  const jobs = db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get();
  if (!jobs) throw new Error('The last-year fixture needs the seed\'s Jobs account: run `npm run seed` first.');
  db.insert(t.messages).values({
    accountId: jobs.id, providerId: 'fixture-search-last-year', threadId: 'fixture-search-last-year-thread',
    fromName: 'Northwind Recruiting', fromAddress: 'no-reply@northwind.example', organisation: 'Northwind Talent', via: 'Greenhouse',
    subject: 'Thank you for applying to Northwind', snippet: 'Thank you for applying to Northwind. We\'ve filled the Support Engineer role.',
    bodyText: 'Thank you for applying to Northwind. We\'ve filled the Support Engineer role, and we\'ll keep your profile on file.',
    searchBody: searchBody('Thank you for applying to Northwind. We\'ve filled the Support Engineer role, and we\'ll keep your profile on file.'),
    receivedAt: zoned('2025-12-20', '11:05'), unread: false, lane: 'fyi', kind: 'career', type: 'rejection',
  }).run();
}
