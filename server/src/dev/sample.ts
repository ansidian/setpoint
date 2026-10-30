// BRIEF.md › Sample data as rows, for building and testing against the real schema. It's invented:
// account addresses use example domains, and senders use `.example` domains except where a board
// shows one (contosocoffee.example in 02, accounts.google.com in 03). Times are fixed relative to
// SEED_NOW (Wed, Oct 7, 2026, 9:12 AM Pacific), so the brief's ages and counts hold: 3 attention not
// Done, 11 unread FYI, 19 unread in all. Emails the brief only implies come from the boards
// (design-export/boards/: 02, 03, 05, 06, 07, 08, 09, 10); where they differ, the brief and
// DESIGN.md's overrides win. News's sample (round 3) is in src/dev/news.ts.
import {
  type AccountProvider, type Colour, type Kind, type Lane, type MessageType, type SecurityFacts, type SourceProvider, type WeatherCondition,
  SEED_NOW, SEED_TIME_ZONE, securityFactsSchema,
} from '@setpoint/shared';
import type {OpenDatabase} from '../db/open.ts';
import type {Store} from '../store.ts';
import {DEFAULT_SCHEDULES} from '../domain/sources.ts';
import {zonedInstant} from '../domain/time.ts';
import * as t from '../db/schema.ts';
import {seedNews} from './news.ts';
// Jobs (after News): a module that can be removed whole (src/jobs/README.md lists its wiring points).
import {seedJobs} from '../jobs/index.ts';
import {loadNewsSnapshot} from './newsSnapshot.ts';

const MINUTE = 60_000;
/** How long a code row stays in the Inbox (Settings › Mail's default). */
const CODE_EXPIRY_MINUTES = 15;

/** A wall-clock time in the seed's zone ("2026-10-07", "09:12") as a UTC instant. */
export function zoned(date: string, time = '00:00', timeZone = SEED_TIME_ZONE): string {
  return zonedInstant(date, time, timeZone);
}

type AccountLabel = 'Business' | 'Personal' | 'Work' | 'Jobs' | 'iCloud';

const ACCOUNTS: {label: AccountLabel; provider: AccountProvider; address: string; colour: Colour; icon: string}[] = [
  {label: 'Business', provider: 'gmail', address: 'user@studio.example.com', colour: 'warm', icon: 'storefront'},
  {label: 'Personal', provider: 'gmail', address: 'user@example.com', colour: 'cool', icon: 'person'},
  {label: 'Work', provider: 'gmail', address: 'user@work.example.org', colour: 'comf', icon: 'work'},
  {label: 'Jobs', provider: 'gmail', address: 'user.jobs@example.com', colour: 'violet', icon: 'badge'},
  {label: 'iCloud', provider: 'icloud', address: 'user@example.net', colour: 'ink2', icon: 'cloud'},
];

interface SampleEmail {
  account: AccountLabel;
  /** Local date and 24-hour time. */
  at: [string, string];
  from: [name: string, address: string];
  organisation?: string;
  via?: string;
  subject: string;
  summary?: string;
  body: string;
  html?: string;
  unread: boolean;
  lane: Lane | null;
  kind?: Kind;
  type?: MessageType;
  keyDate?: string;
  facts?: SecurityFacts;
  protected?: boolean;
  pinnedAt?: [string, string];
  done?: {at: [string, string]; opened: boolean};
  code?: string;
  attachments?: {filename: string; mimeType: string; sizeBytes: number}[];
}

const NORTHWIND_INTERVIEW = `Hi there,

Thanks for applying to the Software Engineer I role at Northwind. The team would like to set up a 30-minute call with you this week.

Please pick a time that works for you. Slots are open Wednesday through Friday, 10:00 AM – 4:00 PM Pacific.

If none of these work, reply to this email and we'll find another time.

Best,
Priya Raman
Recruiting Coordinator, Northwind`;

const PARKSIDE_RENEWAL = `Hi there,

Your lease for Unit 4B ends on Nov 30, 2026, and we'd love to have you stay. Here are your renewal terms:

Term: 12 months, Dec 1, 2026 – Nov 30, 2027
New monthly rent: $2,140 (currently $2,060)
Sign by: Oct 31, 2026

To renew, sign the attached agreement in the resident portal by Oct 31; once it's signed, your new term starts Dec 1. If we haven't heard from you by Oct 31, we'll treat your unit as available from Dec 1.

Questions? Stop by the leasing office, Monday – Friday, 9 AM – 6 PM.

Thanks,
Dana Whitfield
Leasing Office, Parkside Apartments`;

const FINAL_EXAMS = `Hi there,

Fall 2026 final exams for Computer Science are below. Exams run two hours and start on time; bring your student ID.

CS 2010 · Intro to programming — Mon, Dec 7 · 5:00 – 7:00 PM · Room 108
CS 3310 · Data structures — Tue, Dec 8 · 7:00 – 9:00 PM · Room 214
CS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214
CS 4410 · Operating systems — Thu, Dec 10 · 5:00 – 7:00 PM · Room 120
CS 4660 · Databases — Fri, Dec 11 · 7:00 – 9:00 PM · Room 108

If two of your exams overlap, contact the department office by Nov 13.

Office of the Registrar, Contoso University`;

const RECOVERY_CHANGED = `Your recovery email was changed

The recovery email for your Google Account was changed to r••••••@example.net.

If you didn't change it, someone else may be using your account. Check this activity and secure your account now.

You received this email to let you know about important changes to your Google Account and services.`;

const COFFEE_TEXT = `The Journal · October 2026

A new harvest from Huila
Our first lots from the 2026 Huila harvest are roasting now: red apple, panela and a long, clean finish. Here's what else is new this month.

Meet the growers of La Esperanza: three generations on one hillside farm.
Dialing in a pour-over at home: grind, ratio and a three-minute brew.

Roasting this month: Huila La Esperanza $19 · Ethiopia Guji $21 · House Espresso $17

You're receiving the Contoso Coffee Journal because you joined our list at contosocoffee.example.`;

// A 600 px newsletter with remote images, for the images-hidden bar (board 02). The image host is
// an `.example` domain, so nothing ever loads from it.
const COFFEE_HTML = `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="font-family:Helvetica,Arial,sans-serif;color:#1d1f22">
<tr><td style="padding:20px 28px"><b>Contoso Coffee</b> · Shop · Journal · Subscriptions</td></tr>
<tr><td><img src="https://cdn.contosocoffee.example/journal/2026-10/hero.jpg" width="600" height="240" alt="Hero image"></td></tr>
<tr><td style="padding:24px 28px"><p style="font-size:12px;color:#6b7076">The Journal · October 2026</p><h1 style="font-size:24px;margin:0 0 8px">A new harvest from Huila</h1><p>Our first lots from the 2026 Huila harvest are roasting now: red apple, panela and a long, clean finish. Here's what else is new this month.</p></td></tr>
<tr><td style="padding:0 28px"><img src="https://cdn.contosocoffee.example/journal/2026-10/growers.jpg" width="260" height="160" alt="Article image"><p><b>Meet the growers of La Esperanza</b><br>Three generations on one hillside farm.</p><img src="https://cdn.contosocoffee.example/journal/2026-10/pour-over.jpg" width="260" height="160" alt="Article image"><p><b>Dialing in a pour-over at home</b><br>Grind, ratio and a three-minute brew.</p></td></tr>
<tr><td style="padding:16px 28px"><b>Roasting this month</b><br>Huila La Esperanza · $19 · 12 oz<br>Ethiopia Guji · $21 · 12 oz<br>House Espresso · $17 · 12 oz</td></tr>
<tr><td style="padding:20px 28px;font-size:11px;color:#8a8e94">You're receiving the Contoso Coffee Journal because you joined our list at contosocoffee.example.<br>Unsubscribe · Email preferences · View in browser · Contoso Coffee Roasters, Seattle, WA</td></tr>
</table><img src="https://cdn.contosocoffee.example/open.gif?m=2026-10" width="1" height="1" alt="">`;

const INDEED_MATCH = `A new job that matches your alert

Associate Software Engineer
Contoso Pharmaceuticals · Hybrid
$78,000–$92,000 a year

Build and maintain the internal tools our lab teams use every day, working with a small team on the web app and its services.

View job: https://indeed.example/viewjob?jk=5f2c80d1e3a7

You're receiving this because of your job alert for software engineer.`;

/**
 * Every email: the brief's Inbox, then what the boards add, newest first. Board 09's history (four
 * Northwind Engineering digests cleared unopened, which raise a real pattern prompt) lives in its
 * fixture (src/dev/fixtures/mailBoards.ts), so no other board shows a prompt.
 */
export const SAMPLE_EMAILS: SampleEmail[] = [
  // Today, Wed Oct 7 (board 05's clock times).
  {account: 'Personal', at: ['2026-10-07', '09:08'], from: ['Contoso Insurance', 'security@contosoinsurance.example'], organisation: 'Contoso Insurance',
    subject: 'Your code is 482913', body: 'Your Contoso Insurance verification code is 482913. It expires in 15 minutes. If you didn\'t ask for it, you can ignore this email.',
    unread: true, lane: 'fyi', kind: 'security', type: 'verification_code', code: '482913'},
  {account: 'Personal', at: ['2026-10-07', '08:52'], from: ['Google', 'no-reply@accounts.google.com'], organisation: 'Google',
    subject: 'Your recovery email was changed', summary: 'If you didn\'t make this change, secure your account now', body: RECOVERY_CHANGED,
    unread: true, lane: 'attention', kind: 'security', type: 'alert', protected: true,
    facts: {what: 'Recovery email changed', device: 'Windows · Chrome', location: 'Phoenix, AZ', unfamiliar: true}},
  {account: 'Business', at: ['2026-10-07', '08:12'], from: ['Google', 'no-reply@accounts.google.com'], organisation: 'Google',
    subject: 'Security alert', summary: 'New sign-in · MacBook Pro · Los Angeles',
    body: 'A new sign-in to your Google Account on a MacBook Pro near Los Angeles. If this was you, you don\'t need to do anything.',
    unread: true, lane: 'fyi', kind: 'security', type: 'alert', facts: {what: 'New sign-in', device: 'MacBook Pro', location: 'Los Angeles'}},
  {account: 'Personal', at: ['2026-10-07', '08:05'], from: ['Tailspin Toys', 'deals@tailspintoys.example'], organisation: 'Tailspin Toys',
    subject: 'Fall sale: 30% off building sets', summary: 'Ends Sunday', body: 'Our fall sale is on: 30% off every building set until Sunday.',
    unread: true, lane: 'noise', type: 'newsletter'},
  {account: 'Jobs', at: ['2026-10-07', '07:12'], from: ['Priya Raman', 'no-reply@northwind.example'], organisation: 'Northwind Talent', via: 'Greenhouse',
    subject: 'Interview availability for Software Engineer I', summary: 'Pick a 30-minute slot this week', body: NORTHWIND_INTERVIEW,
    unread: true, lane: 'attention', kind: 'career'},
  {account: 'Personal', at: ['2026-10-07', '07:02'], from: ['Consolidated Messenger', 'mcinfo@consolidatedmessenger.example'], organisation: 'Consolidated Messenger',
    subject: 'Out for delivery', summary: 'Arriving by 8 PM', body: 'Your package is out for delivery today and should arrive by 8 PM.',
    unread: true, lane: 'fyi', kind: 'deliveries', type: 'shipping'},
  {account: 'Work', at: ['2026-10-07', '06:10'], from: ['Google', 'no-reply@accounts.google.com'], organisation: 'Google',
    subject: 'Claude was granted access to your Google Account', summary: 'Access granted · Claude',
    body: 'Claude was granted access to some of your Google Account data. If you didn\'t grant access, check this activity.',
    unread: true, lane: 'fyi', kind: 'security', type: 'alert', facts: {what: 'Access granted', app: 'Claude'}},
  {account: 'Personal', at: ['2026-10-07', '06:05'], from: ['Contoso Coffee', 'journal@contosocoffee.example'], organisation: 'Contoso Coffee',
    subject: 'The Contoso Coffee Journal · October', summary: 'A new harvest from Huila, brewing notes', body: COFFEE_TEXT, html: COFFEE_HTML,
    unread: true, lane: 'noise', type: 'newsletter'},
  {account: 'Personal', at: ['2026-10-07', '04:05'], from: ['Woodgrove Bank', 'no-reply@woodgrovebank.example'], organisation: 'Woodgrove Bank',
    subject: 'Statement ready', summary: 'Checking ending in 1234', body: 'Your statement for checking ending in 1234 is ready to view.',
    unread: true, lane: 'fyi', kind: 'money', type: 'statement'},
  {account: 'Business', at: ['2026-10-07', '04:00'], from: ['Litware', 'events@litware.example'], organisation: 'Litware',
    subject: 'Webinar: what\'s new in Litware 12', summary: 'Register for the Oct 15 session', body: 'Join us on Oct 15 for a tour of what\'s new in Litware 12.',
    unread: true, lane: 'noise', type: 'newsletter'},
  {account: 'Business', at: ['2026-10-07', '03:20'], from: ['Wingtip Toys', 'shipment-tracking@wingtiptoys.example'], organisation: 'Wingtip Toys',
    subject: 'Arriving today: USB-C hub', summary: 'By 10 PM', body: 'Your package with the USB-C hub is arriving today by 10 PM.',
    unread: true, lane: 'fyi', kind: 'deliveries', type: 'shipping'},
  {account: 'Jobs', at: ['2026-10-07', '02:14'], from: ['Fabrikam Recruiting', 'no-reply@fabrikam.example'], organisation: 'Fabrikam', via: 'Workday',
    subject: 'Application received', summary: 'Data Analyst', body: 'Thank you for applying to the Data Analyst role at Fabrikam. We\'ve received your application and will be in touch.',
    unread: true, lane: 'fyi', kind: 'career', type: 'confirmation'},
  {account: 'iCloud', at: ['2026-10-07', '01:08'], from: ['Proseware', 'billing@proseware.example'], organisation: 'Proseware',
    subject: 'Bill is ready', summary: '$89.99 · Autopay on Oct 21', body: 'Your Proseware bill of $89.99 is ready. Autopay will pay it on Oct 21.',
    unread: true, lane: 'fyi', kind: 'money', type: 'statement'},

  // Yesterday, Tue Oct 6.
  {account: 'Business', at: ['2026-10-06', '20:15'], from: ['Woodgrove Pay', 'service@woodgrovepay.example'], organisation: 'Woodgrove Pay',
    subject: 'You sent $42.00 to Sam Lee', body: 'You sent $42.00 USD to Sam Lee.',
    unread: true, lane: 'fyi', kind: 'money', type: 'receipt'},
  {account: 'Business', at: ['2026-10-06', '18:41'], from: ['Wingtip Toys', 'shipment-tracking@wingtiptoys.example'], organisation: 'Wingtip Toys',
    subject: 'Delivered: desk lamp', summary: 'Left at front door', body: 'Your package with the desk lamp was delivered. It was left at the front door.',
    unread: true, lane: 'fyi', kind: 'deliveries', type: 'shipping'},
  {account: 'Business', at: ['2026-10-06', '16:20'], from: ['Fourth Coffee', 'offers@fourthcoffee.example'], organisation: 'Fourth Coffee',
    subject: 'Office coffee, 20% off your first box', summary: 'For teams of 5 to 50', body: 'Fresh coffee for your office: 20% off your first box, for teams of 5 to 50.',
    unread: true, lane: 'noise', type: 'newsletter'},
  {account: 'Personal', at: ['2026-10-06', '11:45'], from: ['Wide World Importers', 'hello@wideworldimporters.example'], organisation: 'Wide World Importers',
    subject: 'Just landed: hand-thrown ceramics', summary: 'New from Oaxaca and Kyoto', body: 'New this week: hand-thrown ceramics from Oaxaca and Kyoto.',
    unread: true, lane: 'noise', type: 'newsletter'},
  {account: 'Personal', at: ['2026-10-06', '09:30'], from: ['CS 101', 'cs101@contosou.example'], organisation: 'Contoso University',
    subject: 'Lab 5 posted', summary: 'CS 101 · Due Wed, Oct 7', body: 'Lab 5 is posted on the course site. It\'s due Wednesday, Oct 7, before lecture.',
    unread: false, lane: 'fyi', kind: 'updates', type: 'deadline', keyDate: '2026-10-07'},
  {account: 'Business', at: ['2026-10-06', '07:55'], from: ['Adventure Works', 'news@adventureworks.example'], organisation: 'Adventure Works',
    subject: 'New arrivals for fall', body: 'Fall gear is here: jackets, boots and packs for the season.',
    unread: false, lane: 'fyi', kind: 'other', type: 'newsletter'},

  // Mon Oct 5.
  {account: 'Business', at: ['2026-10-05', '16:18'], from: ['Southridge Video', 'orders@southridgevideo.example'], organisation: 'Southridge Video',
    subject: 'Your item shipped', summary: 'Mechanical keyboard · USPS', body: 'Your mechanical keyboard has shipped with USPS.',
    unread: true, lane: 'fyi', kind: 'deliveries', type: 'shipping'},
  {account: 'Personal', at: ['2026-10-05', '12:40'], from: ['Sam Lee', 'sam.lee@example.com'],
    subject: 'Dinner Friday?', summary: 'Blue Door at 7?', body: 'Hey! Dinner Friday? Blue Door at 7? I can book a table.\n\nSam',
    unread: false, lane: 'fyi', kind: 'people'},
  {account: 'Personal', at: ['2026-10-05', '10:05'], from: ['Office of the Registrar', 'registrar@contosou.example'], organisation: 'Contoso University',
    subject: 'Final exam schedule · CS 101', summary: 'Fall 2026 finals, rooms and times', body: FINAL_EXAMS,
    // Read, not Done: it stays in Attention (board 01).
    unread: false, lane: 'attention', kind: 'updates', keyDate: '2026-12-09'},
  {account: 'Personal', at: ['2026-10-05', '08:40'], from: ['Margie\'s Travel', 'trips@margiestravel.example'], organisation: 'Margie\'s Travel',
    subject: 'Fall getaways from $199', summary: 'Three nights, flights included', body: 'Fall getaways from $199: three nights, flights included.',
    unread: true, lane: 'noise', type: 'newsletter'},

  // Earlier.
  {account: 'Business', at: ['2026-10-04', '15:47'], from: ['Wingtip Toys', 'auto-confirm@wingtiptoys.example'], organisation: 'Wingtip Toys',
    subject: 'Ordered: USB-C hub', summary: 'Arriving Wed, Oct 7', body: 'Thanks for your order. Your USB-C hub is arriving Wednesday, Oct 7.',
    unread: false, lane: 'fyi', kind: 'deliveries', type: 'confirmation'},
  {account: 'Jobs', at: ['2026-10-01', '11:26'], from: ['Northwind Recruiting', 'no-reply@northwind.example'], organisation: 'Northwind Talent', via: 'Greenhouse',
    subject: 'Thanks for applying', summary: 'Software Engineer I', body: 'Thanks for applying to the Software Engineer I role at Northwind. We\'ll review your application and be in touch.',
    unread: false, lane: 'fyi', kind: 'career', type: 'confirmation'},
  {account: 'Personal', at: ['2026-10-01', '09:00'], from: ['Parkside Apartments', 'office@parksideapts.example'], organisation: 'Parkside Apartments',
    subject: 'October rent received', summary: 'We received $2,060 for Unit 4B', body: 'We received $2,060 for Unit 4B. Your lease renewal offer was sent on Sep 30.',
    unread: false, lane: 'fyi', kind: 'money', type: 'receipt'},
  {account: 'Personal', at: ['2026-09-30', '14:15'], from: ['Dana Whitfield', 'dana.whitfield@parksideapts.example'], organisation: 'Parkside Apartments',
    subject: 'Lease renewal terms', summary: 'Renewal offer for the lease ending Nov 30 · sign by Oct 31', body: PARKSIDE_RENEWAL,
    unread: false, lane: 'fyi', kind: 'people', type: 'deadline', keyDate: '2026-10-31', pinnedAt: ['2026-09-30', '18:02'],
    attachments: [{filename: 'Renewal agreement.pdf', mimeType: 'application/pdf', sizeBytes: 184 * 1024}]},
  {account: 'iCloud', at: ['2026-09-30', '08:03'], from: ['Apple', 'noreply@icloud.example'], organisation: 'Apple',
    subject: 'Your iCloud storage is almost full', body: 'You\'ve used almost all of your 50 GB of iCloud storage.',
    unread: false, lane: 'fyi', kind: 'updates', type: 'alert'},
  // Board 10's second pin, unpinned here so board 01's shelf holds one.
  {account: 'Personal', at: ['2026-09-28', '10:00'], from: ['DMV', 'notices@dmv.example'], organisation: 'DMV',
    subject: 'Car registration renewal notice', summary: 'Renewal notice for your vehicle · online or by mail',
    body: 'Your registration for your vehicle expires soon. Renew online or by mail.',
    unread: false, lane: 'fyi', kind: 'updates', type: 'reminder'},
  {account: 'Personal', at: ['2026-08-22', '10:12'], from: ['Contoso Insurance', 'policies@contosoinsurance.example'], organisation: 'Contoso Insurance',
    subject: 'Your renters policy renewal is coming up', summary: 'Renews automatically on Sep 15', body: 'Your policy renews automatically on Sep 15. No action needed.',
    unread: false, lane: 'fyi', kind: 'updates', type: 'reminder', keyDate: '2026-09-15'},
  // Search's examples (board 06): `northwind rejection march`.
  {account: 'Jobs', at: ['2026-03-14', '15:22'], from: ['Northwind Recruiting', 'no-reply@northwind.example'], organisation: 'Northwind Talent', via: 'Greenhouse',
    subject: 'Update on your application',
    body: `Hi there,\n\nThank you for your interest in the Software Engineer Intern role at Northwind, and for the time you put into the take-home exercise.\n\nAfter careful review, we've decided to move forward with other candidates whose experience more closely matches what the team needs right now.\n\nWe'll keep your profile on file, and we encourage you to apply for future openings at Northwind.\n\nBest,\nThe Northwind Recruiting Team`,
    unread: false, lane: 'fyi', kind: 'career', type: 'rejection'},
  {account: 'Jobs', at: ['2026-03-03', '09:41'], from: ['Northwind Recruiting', 'no-reply@northwind.example'], organisation: 'Northwind Talent', via: 'Greenhouse',
    subject: 'Your application for Data Engineer Intern',
    body: 'Thank you for applying to Northwind. Unfortunately, we won\'t be moving forward with your application for the Data Engineer Intern role.',
    unread: false, lane: 'fyi', kind: 'career', type: 'rejection'},
  // Jobs (round 4): Indeed's match email for the role Jobs's Contoso Pharmaceuticals application is
  // (board 37c's Applied before), read and in All only. Last, so the emails above keep their ids, and
  // dated before the application so it sits below the Inbox's first screen (board 37c dates it today).
  {account: 'Jobs', at: ['2026-09-15', '06:05'], from: ['Indeed', 'alert@indeed.example'], organisation: 'Indeed',
    subject: 'Associate Software Engineer @ Contoso Pharmaceuticals', summary: '$78,000–$92,000 · Hybrid', body: INDEED_MATCH,
    unread: false, lane: 'noise', type: 'newsletter'},
];

const CALENDARS: {key: 'personal' | 'classes' | 'jobs' | 'todoist'; name: string; provider: 'google' | 'todoist'; colour: Colour | null; account: AccountLabel | null}[] = [
  {key: 'personal', name: 'Personal', provider: 'google', colour: 'cool', account: 'Personal'},
  {key: 'classes', name: 'Classes', provider: 'google', colour: 'cyan', account: 'Personal'},
  {key: 'jobs', name: 'Jobs', provider: 'google', colour: 'violet', account: 'Jobs'},
  {key: 'todoist', name: 'Todoist', provider: 'todoist', colour: null, account: null},
];

type SampleItem = {calendar: (typeof CALENDARS)[number]['key']; title: string} & (
  | {kind: 'event'; date: string; start: string; end: string; recurrence?: string; place?: string; address?: string; attendees?: string[]; reminders?: number[]; leave?: true}
  | {kind: 'task'; due: string; project: string; done?: [string, string]}
);

/** October 2026's calendar (BRIEF.md › Sample data; boards 11, 12a, 12b, 14, 16). */
export const SAMPLE_ITEMS: SampleItem[] = [
  {calendar: 'personal', kind: 'event', title: 'Gym', date: '2026-08-31', start: '07:00', end: '08:00',
    recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', reminders: [10]},
  {calendar: 'personal', kind: 'event', title: 'Dentist', date: '2026-10-07', start: '14:30', end: '15:30',
    place: 'Smile Dental', address: '1420 Elm St', reminders: [30], leave: true},
  {calendar: 'personal', kind: 'event', title: 'Dinner with Sam', date: '2026-10-09', start: '19:00', end: '21:00',
    place: 'Blue Door', address: '2118 Sunset Blvd', attendees: ['Sam Lee'], reminders: [60], leave: true},
  {calendar: 'jobs', kind: 'event', title: 'Career fair', date: '2026-10-15', start: '10:00', end: '14:00',
    place: 'University Student Union', reminders: [10]},
  // Fall term: Tue and Thu until finals week.
  {calendar: 'classes', kind: 'event', title: 'CS 101 lecture', date: '2026-08-25', start: '18:00', end: '19:15',
    recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261204T075959Z', reminders: [10]},
  {calendar: 'classes', kind: 'event', title: 'Study group', date: '2026-10-09', start: '18:30', end: '20:30', reminders: [10]},
  {calendar: 'todoist', kind: 'task', title: 'CS 101 lab report', due: '2026-10-07', project: 'School'},
  {calendar: 'todoist', kind: 'task', title: 'Pay rent', due: '2026-10-07', project: 'Home'},
  {calendar: 'todoist', kind: 'task', title: 'Renew car registration', due: '2026-10-08', project: 'Home'},
  {calendar: 'todoist', kind: 'task', title: 'Return library books', due: '2026-10-05', project: 'Inbox', done: ['2026-10-05', '17:30']},
];

/** Forecasts only where the brief draws them: sun on the 7th, clouds on the 8th, rain on the 13th. */
export const SAMPLE_WEATHER: {date: string; condition: WeatherCondition; highF: number; lowF: number}[] = [
  {date: '2026-10-07', condition: 'sun', highF: 78, lowF: 61},
  {date: '2026-10-08', condition: 'cloud', highF: 72, lowF: 59},
  {date: '2026-10-13', condition: 'rain', highF: 64, lowF: 55},
];

const snippetOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 140);

/**
 * Loads the sample into an empty database; refuses one that already holds anything. News's images go
 * to `newsImagesDir` (the data directory's news-images/); without one only their rows are kept.
 * `newsSnapshot` loads real news from a snapshot's directory in place of the sample's (src/dev/newsSnapshot.ts);
 * one that won't load (taken before a schema change it can't follow) says so, and the sample's is loaded.
 * `usage` adds this month's AI usage (board 30b): `npm run seed` has it, while the tests' worlds start
 * with an empty ledger, so each reads only the calls it made.
 */
export function seedSampleData({sqlite, db}: OpenDatabase, {newsImagesDir = null, usage = false, newsSnapshot = null}: {newsImagesDir?: string | null; usage?: boolean; newsSnapshot?: string | null} = {}) {
  const tables = [t.accounts, t.messages, t.attachments, t.calendars, t.items, t.weatherDays, t.sources, t.newsSources];
  if (tables.some(table => db.select().from(table).limit(1).all().length)) {
    throw new Error('This database isn\'t empty. Seed a fresh one, or pass --reset to start over.');
  }
  const createdAt = zoned('2026-08-01', '09:00');
  const iso = ([date, time]: [string, string]) => zoned(date, time);

  db.transaction(tx => {
    // The sample's own reminder defaults, as the boards draw them; a fresh install starts at None (D49).
    tx.insert(t.settings).values({section: 'reminders', value: {event_minutes_before: 10, task_time: '09:00'}, updatedAt: createdAt}).run();
    const accountIds = new Map<AccountLabel, number>();
    ACCOUNTS.forEach((account, position) => {
      const row = tx.insert(t.accounts).values({...account, position, createdAt}).returning({id: t.accounts.id}).get();
      accountIds.set(account.label, row.id);
    });

    // Every source is a dev source, served by the in-process dev provider; each last checked a
    // minute before SEED_NOW, so all are healthy then.
    const checked = new Date(Date.parse(SEED_NOW) - MINUTE).toISOString();
    const source = (provider: SourceProvider, account: AccountLabel | null) => {
      const schedule = DEFAULT_SCHEDULES[provider];
      tx.insert(t.sources).values({
        provider, accountId: account ? accountIds.get(account)! : null, dev: true, syncMode: schedule.mode, intervalSeconds: schedule.intervalSeconds,
        pushRenewsAt: schedule.mode === 'push' ? zoned('2026-10-09', '09:00') : null, lastCheckAt: checked, lastSuccessAt: checked, createdAt,
      }).run();
    };
    for (const account of ACCOUNTS) source(account.provider, account.label);
    // Google Calendar on the accounts that hold the calendars, then Todoist and weather.
    for (const account of new Set(CALENDARS.flatMap(calendar => (calendar.provider === 'google' && calendar.account ? [calendar.account] : [])))) source('google_calendar', account);
    source('todoist', null);
    source('weather', null);

    SAMPLE_EMAILS.forEach((email, at) => {
      const receivedAt = iso(email.at);
      const providerId = `seed-${String(at + 1).padStart(3, '0')}`;
      const row = tx.insert(t.messages).values({
        accountId: accountIds.get(email.account)!,
        providerId,
        threadId: `${providerId}-thread`,
        fromName: email.from[0],
        fromAddress: email.from[1],
        organisation: email.organisation ?? null,
        via: email.via ?? null,
        subject: email.subject,
        summary: email.summary ?? null,
        snippet: snippetOf(email.body),
        bodyText: email.body,
        bodyHtml: email.html ?? null,
        receivedAt,
        unread: email.unread,
        lane: email.lane,
        kind: email.kind ?? null,
        type: email.type ?? null,
        keyDate: email.keyDate ?? null,
        securityFacts: email.facts ? securityFactsSchema.parse(email.facts) : null,
        protected: email.protected ?? false,
        pinnedAt: email.pinnedAt ? iso(email.pinnedAt) : null,
        doneAt: email.done ? iso(email.done.at) : null,
        openedBeforeDone: email.done ? email.done.opened : null,
        code: email.code ?? null,
        codeExpiresAt: email.code ? new Date(Date.parse(receivedAt) + CODE_EXPIRY_MINUTES * MINUTE).toISOString() : null,
      }).returning({id: t.messages.id}).get();
      email.attachments?.forEach((attachment, index) => {
        tx.insert(t.attachments).values({messageId: row.id, providerId: `${providerId}-att-${index + 1}`, ...attachment}).run();
      });
    });

    const calendarIds = new Map<string, number>();
    CALENDARS.forEach((calendar, position) => {
      const row = tx.insert(t.calendars).values({
        provider: calendar.provider, providerId: `seed-${calendar.key}`, name: calendar.name, colour: calendar.colour,
        accountId: calendar.account ? accountIds.get(calendar.account)! : null, position,
      }).returning({id: t.calendars.id}).get();
      calendarIds.set(calendar.key, row.id);
    });

    SAMPLE_ITEMS.forEach((item, at) => {
      const common = {calendarId: calendarIds.get(item.calendar)!, providerId: `seed-item-${at + 1}`, title: item.title};
      if (item.kind === 'event') {
        tx.insert(t.items).values({
          ...common, kind: 'event', allDay: false,
          startsAt: zoned(item.date, item.start), endsAt: zoned(item.date, item.end), timeZone: SEED_TIME_ZONE,
          recurrence: item.recurrence ?? null, place: item.place ?? null, address: item.address ?? null,
          attendees: item.attendees ?? null, reminders: item.reminders ?? null, leaveReminder: item.leave ?? false,
        }).run();
      } else {
        tx.insert(t.items).values({
          ...common, kind: 'task', allDay: true, dueDate: item.due, project: item.project, doneAt: item.done ? iso(item.done) : null,
        }).run();
      }
    });

    for (const day of SAMPLE_WEATHER) tx.insert(t.weatherDays).values({...day, fetchedAt: zoned('2026-10-07', '09:00')}).run();
    // F6: the Todoist projects the tasks are in, for the editor's project picker, in colours the
    // task rings take (SV-25): Inbox in Todoist's default charcoal, School near Classes' cyan.
    ([['Inbox', 'charcoal'], ['School', 'sky_blue'], ['Home', 'orange']] as const).forEach(([name, colour], position) =>
      tx.insert(t.todoistProjects).values({providerId: `seed-project-${position + 1}`, name, position, inbox: name === 'Inbox', colour}).run());
    // F6b: Todoist's labels, for the editor's labels picker.
    ['errand', 'school', 'waiting'].forEach((name, position) => tx.insert(t.todoistLabels).values({providerId: `seed-label-${position + 1}`, name, position}).run());
  });
  const store = {sqlite, db, timeZone: SEED_TIME_ZONE, now: () => new Date(SEED_NOW), keyring: null};
  const {stories} = newsSnapshot ? snapshotOrSample(store, newsSnapshot, newsImagesDir) : seedNews(store, newsImagesDir);
  if (usage) db.insert(t.aiUsage).values(sampleUsage()).run();
  seedJobs({sqlite, db, usage});
  return {now: SEED_NOW, emails: SAMPLE_EMAILS.length, items: SAMPLE_ITEMS.length, stories};
}

function snapshotOrSample(store: Store, dir: string, imagesDir: string | null) {
  try {
    return loadNewsSnapshot(store, dir, imagesDir);
  } catch (error) {
    console.warn(`The news snapshot didn't load (${error instanceof Error ? error.message : String(error)}), so News is the sample's. Take a new one (src/dev/exportNews.ts).`);
    return seedNews(store, imagesDir);
  }
}

/**
 * Settings › AI's usage this month (board 30b), invented: Triage's 1,214 calls for $2.10, Alfred's 18
 * for $0.85, and News's $18.40 (articles $1.90, grouping $1.20, stories $13.10, ranking $2.20), one
 * row a day for each of News's parts. Spread evenly from Oct 1 to the seed's moment.
 */
const SAMPLE_USAGE: {purpose: typeof t.aiUsage.$inferInsert.purpose; model: string; calls: number; dollars: number; input: number; output: number}[] = [
  {purpose: 'triage', model: 'claude-haiku-5-5', calls: 1214, dollars: 2.1, input: 1950, output: 40},
  {purpose: 'alfred', model: 'claude-sonnet-5-5', calls: 18, dollars: 0.85, input: 6200, output: 420},
  {purpose: 'news_articles', model: 'claude-haiku-5-5', calls: 7, dollars: 1.9, input: 210_000, output: 18_000},
  {purpose: 'news_grouping', model: 'claude-haiku-5-5', calls: 7, dollars: 1.2, input: 140_000, output: 9000},
  {purpose: 'news_stories', model: 'claude-sonnet-5-5', calls: 7, dollars: 13.1, input: 420_000, output: 40_000},
  {purpose: 'news_ranking', model: 'claude-sonnet-5-5', calls: 7, dollars: 2.2, input: 90_000, output: 6000},
];

export function sampleUsage(): (typeof t.aiUsage.$inferInsert)[] {
  const from = Date.parse(zoned('2026-10-01', '00:30'));
  const span = Date.parse(SEED_NOW) - 30 * MINUTE - from;
  return SAMPLE_USAGE.flatMap(({purpose, model, calls, dollars, input, output}) => {
    const micros = Math.round(dollars * 1_000_000);
    // Whole micros a call, the remainder spread over the first calls, so the month adds up exactly.
    const each = Math.floor(micros / calls);
    return Array.from({length: calls}, (_, index) => ({
      at: new Date(from + Math.floor((span * index) / calls)).toISOString(), provider: 'anthropic' as const, model, purpose, messageId: null,
      inputTokens: input, outputTokens: output, costMicros: each + (index < micros - each * calls ? 1 : 0),
    }));
  });
}
