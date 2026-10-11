// B3's recorded fixture set: anonymised emails (invented senders on example domains, shaped after
// the kinds of mail v1 saw) with the answers the cheap and strong models gave, and the lane each
// must end in. It covers every kind, the protected class, codes, Noise, mail from people and the
// unsure cases. tests/triageFixtures.test.ts runs them through the real pipeline with the models
// faked at the HTTP boundary (tests/fakeModels.ts).
import type {Kind, Lane, MessageType, ProtectedReason, TriageSource} from '@setpoint/shared';

export interface ModelDecision {
  lane: Lane | 'needs_attention';
  kind: Kind | null;
  organisation: string | null;
  via?: string | null;
  type: MessageType | null;
  key_date?: string | null;
  summary: string | null;
  security?: {what: string; device?: string; location?: string; app?: string; unfamiliar?: boolean} | null;
  protected_class?: ProtectedReason | null;
  confidence: number;
}

/** What a model answered: its decision, or an answer without a usable tool call. */
export type Recorded = ModelDecision | 'no_tool' | 'broken_arguments';

export interface TriageFixture {
  name: string;
  account: 'Business' | 'Personal' | 'Work' | 'Jobs' | 'iCloud';
  from: [name: string, address: string];
  subject: string;
  body: string;
  cheap?: Recorded;
  strong?: Recorded;
  expect: {
    lane: Lane;
    kind?: Kind | null;
    type?: MessageType | null;
    organisation?: string | null;
    protected?: boolean;
    code?: string | null;
    source: TriageSource;
    // The models asked, in order.
    tiers: ('cheap' | 'strong')[];
  };
}

const sure = (decision: Omit<ModelDecision, 'confidence'>, confidence = 0.92): ModelDecision => ({via: null, key_date: null, security: null, protected_class: null, ...decision, confidence});

export const TRIAGE_FIXTURES: TriageFixture[] = [
  // ---- Deliveries ----
  {
    name: 'a carrier\'s out-for-delivery notice', account: 'Personal', from: ['Consolidated Messenger', 'mcinfo@consolidatedmessenger.example'],
    subject: 'Out for delivery', body: 'Your package is out for delivery today and should arrive by 8 PM. Tracking number 1Z999AA10123456784.',
    cheap: sure({lane: 'fyi', kind: 'deliveries', organisation: 'Consolidated Messenger', type: 'shipping', summary: 'Arriving by 8 PM'}),
    expect: {lane: 'fyi', kind: 'deliveries', type: 'shipping', organisation: 'Consolidated Messenger', source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'a store\'s delivered notice, decided by the shipped delivery rule', account: 'Business', from: ['Wingtip Toys', 'shipment-tracking@amazon.com'],
    subject: 'Delivered: desk lamp', body: 'Your package with the desk lamp was delivered. It was left at the front door.',
    cheap: sure({lane: 'noise', kind: null, organisation: 'Wingtip Toys', type: 'shipping', summary: 'Left at front door'}, 0.6),
    expect: {lane: 'fyi', kind: 'deliveries', type: 'shipping', organisation: 'Wingtip Toys', source: 'rule', tiers: ['cheap']},
  },
  {
    name: 'a marketplace\'s item shipped', account: 'Business', from: ['Southridge Video', 'orders@southridgevideo.example'],
    subject: 'Your item shipped', body: 'Your mechanical keyboard has shipped with USPS. Estimated delivery Fri, Oct 9.',
    cheap: sure({lane: 'fyi', kind: 'deliveries', organisation: 'Southridge Video', type: 'shipping', key_date: '2026-10-09', summary: 'Mechanical keyboard · USPS'}),
    expect: {lane: 'fyi', kind: 'deliveries', type: 'shipping', source: 'cheap_model', tiers: ['cheap']},
  },

  // ---- Money ----
  {
    name: 'a bank statement', account: 'Personal', from: ['Woodgrove Bank', 'no-reply@woodgrovebank.example'],
    subject: 'Statement ready', body: 'Your statement for checking ending in 1234 is ready to view.',
    cheap: sure({lane: 'fyi', kind: 'money', organisation: 'Woodgrove Bank', type: 'statement', summary: 'Checking ending in 1234'}),
    expect: {lane: 'fyi', kind: 'money', type: 'statement', source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'a bill that autopay covers', account: 'iCloud', from: ['Proseware Internet', 'billing@proseware.example'],
    subject: 'Bill is ready', body: 'Your Proseware bill of $89.99 is ready. Autopay will pay it on Oct 21.',
    cheap: sure({lane: 'fyi', kind: 'money', organisation: 'Proseware', type: 'statement', summary: '$89.99 · Autopay on Oct 21'}),
    expect: {lane: 'fyi', kind: 'money', type: 'statement', source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'a receipt for money the user sent themselves: not protected', account: 'Business', from: ['Payments', 'service@payments.example'],
    subject: 'You sent $42.00 to Sam Lee', body: 'You sent $42.00 USD to Sam Lee. Transaction ID 7HX2-99QK.',
    cheap: sure({lane: 'fyi', kind: 'money', organisation: 'Payments', type: 'receipt', summary: '$42.00 to Sam Lee'}),
    expect: {lane: 'fyi', kind: 'money', type: 'receipt', protected: false, source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'rent past due goes straight to the strong model (v1\'s hard risk)', account: 'Personal', from: ['Parkside Apartments', 'office@parksideapts.example'],
    subject: 'Your October rent is past due', body: 'Our records show October rent of $2,060 for Unit 4B is past due. A late fee applies after Oct 10.',
    strong: sure({lane: 'attention', kind: 'money', organisation: 'Parkside Apartments', type: 'deadline', key_date: '2026-10-10', summary: '$2,060 · late fee after Oct 10'}, 0.95),
    expect: {lane: 'attention', kind: 'money', type: 'deadline', source: 'strong_model', tiers: ['strong']},
  },

  // ---- Career ----
  {
    name: 'an interview to schedule, through a hiring platform', account: 'Jobs', from: ['Priya Raman', 'no-reply@greenhouse-mail.example'],
    subject: 'Interview availability for Software Engineer I', body: 'Hi there, thanks for applying to Northwind. Please pick a 30-minute slot this week for a first interview.',
    cheap: sure({lane: 'attention', kind: 'career', organisation: 'Northwind', via: 'Greenhouse', type: null, summary: 'Pick a 30-minute slot this week'}, 0.9),
    strong: sure({lane: 'attention', kind: 'career', organisation: 'Northwind', via: 'Greenhouse', type: null, summary: 'Pick a 30-minute slot this week'}, 0.94),
    expect: {lane: 'attention', kind: 'career', organisation: 'Northwind', source: 'strong_model', tiers: ['cheap', 'strong']},
  },
  {
    name: 'an application received', account: 'Jobs', from: ['Fabrikam Recruiting', 'no-reply@myworkday.example'],
    subject: 'Application received', body: 'Thank you for applying to the Data Analyst role at Fabrikam. We\'ve received your application.',
    cheap: sure({lane: 'fyi', kind: 'career', organisation: 'Fabrikam', via: 'Workday', type: 'confirmation', summary: 'Data Analyst'}),
    expect: {lane: 'fyi', kind: 'career', type: 'confirmation', organisation: 'Fabrikam', source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'a rejection', account: 'Jobs', from: ['Northwind Recruiting', 'no-reply@northwind.example'],
    subject: 'Update on your application', body: 'Unfortunately, we\'ve decided to move forward with other candidates for the Software Engineer Intern role.',
    cheap: sure({lane: 'fyi', kind: 'career', organisation: 'Northwind', type: 'rejection', summary: 'Software Engineer Intern'}),
    expect: {lane: 'fyi', kind: 'career', type: 'rejection', source: 'cheap_model', tiers: ['cheap']},
  },

  // ---- Security, routine ----
  {
    name: 'a new sign-in the user made themselves', account: 'Business', from: ['Google', 'no-reply@accounts.google.example'],
    subject: 'Security alert', body: 'A new sign-in to your Google Account on a MacBook Pro near Los Angeles. If this was you, you don\'t need to do anything.',
    cheap: sure({lane: 'fyi', kind: 'security', organisation: 'Google', type: 'alert', summary: 'New sign-in · MacBook Pro', security: {what: 'New sign-in', device: 'MacBook Pro', location: 'Los Angeles'}}),
    expect: {lane: 'fyi', kind: 'security', type: 'alert', protected: false, source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'an app granted access', account: 'Work', from: ['Google', 'no-reply@accounts.google.example'],
    subject: 'Claude was granted access to your Google Account', body: 'Claude was granted access to some of your Google Account data.',
    cheap: sure({lane: 'fyi', kind: 'security', organisation: 'Google', type: 'alert', summary: 'Access granted · Claude', security: {what: 'Access granted', app: 'Claude'}}),
    expect: {lane: 'fyi', kind: 'security', type: 'alert', source: 'cheap_model', tiers: ['cheap']},
  },

  // ---- Codes ----
  {
    name: 'a verification code', account: 'Personal', from: ['Contoso Insurance', 'security@contosoinsurance.example'],
    subject: 'Your code is 482913', body: 'Your Contoso Insurance verification code is 482913. It expires in 15 minutes.',
    cheap: sure({lane: 'fyi', kind: 'security', organisation: 'Contoso Insurance', type: 'verification_code', summary: 'Code 482913'}),
    expect: {lane: 'fyi', kind: 'security', type: 'verification_code', code: '482913', protected: false, source: 'rule', tiers: ['cheap']},
  },
  {
    name: 'a code the model wrongly calls Attention and protected: still a code row', account: 'Business', from: ['Litware', 'accounts@litware.example'],
    subject: 'Litware sign-in', body: 'Use sign-in code 4F7K2Q to finish signing in. If this wasn\'t you, someone may be trying to get into your account.',
    cheap: sure({lane: 'attention', kind: 'security', organisation: 'Litware', type: 'verification_code', summary: 'Sign-in code', protected_class: 'unfamiliar_sign_in'}, 0.8),
    strong: sure({lane: 'attention', kind: 'security', organisation: 'Litware', type: 'verification_code', summary: 'Sign-in code', protected_class: 'unfamiliar_sign_in'}, 0.8),
    expect: {lane: 'fyi', kind: 'security', type: 'verification_code', code: '4F7K2Q', protected: false, source: 'strong_model', tiers: ['cheap', 'strong']},
  },

  // ---- The protected class ----
  {
    name: 'a recovery email changed', account: 'Personal', from: ['Google', 'no-reply@accounts.google.example'],
    subject: 'Your recovery email was changed', body: 'The recovery email for your Google Account was changed from a Windows device near Phoenix, AZ. If you didn\'t make this change, secure your account now.',
    cheap: sure({lane: 'fyi', kind: 'security', organisation: 'Google', type: 'alert', summary: 'Recovery email changed', security: {what: 'Recovery email changed', device: 'Windows', location: 'Phoenix, AZ'}}),
    expect: {lane: 'attention', kind: 'security', protected: true, source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'a password changed, from a sender the user\'s rule sends to Noise: the rule can\'t move it', account: 'Personal', from: ['Tailwind Traders', 'notices@tailwindtraders.example'],
    subject: 'Your password was changed', body: 'The password for your Tailwind Traders account was changed just now.',
    cheap: sure({lane: 'fyi', kind: 'security', organisation: 'Tailwind Traders', type: 'alert', summary: 'Password changed'}),
    expect: {lane: 'attention', kind: 'security', protected: true, source: 'rule', tiers: ['cheap']},
  },
  {
    name: 'a critical security alert', account: 'Work', from: ['Google', 'no-reply@accounts.google.example'],
    subject: 'Critical security alert', body: 'Someone just used your password to try to sign in to your account. Google blocked them.',
    cheap: sure({lane: 'attention', kind: 'security', organisation: 'Google', type: 'alert', summary: 'Sign-in attempt blocked', protected_class: 'critical_alert'}),
    strong: sure({lane: 'attention', kind: 'security', organisation: 'Google', type: 'alert', summary: 'Sign-in attempt blocked', protected_class: 'critical_alert'}),
    expect: {lane: 'attention', kind: 'security', protected: true, source: 'strong_model', tiers: ['cheap', 'strong']},
  },
  {
    name: '"was this you?" from a device the user doesn\'t use: only the model can tell', account: 'iCloud', from: ['Apple', 'noreply@id.apple.example'],
    subject: 'New sign-in to your Apple Account', body: 'Your Apple Account was used to sign in on a Windows PC near Lagos, Nigeria. This device has never been used with your account. Was this you?',
    cheap: sure({lane: 'fyi', kind: 'security', organisation: 'Apple', type: 'alert', summary: 'Sign-in from Lagos', protected_class: 'unfamiliar_sign_in', security: {what: 'New sign-in', device: 'Windows PC', location: 'Lagos, Nigeria'}}, 0.8),
    strong: sure({lane: 'attention', kind: 'security', organisation: 'Apple', type: 'alert', summary: 'Sign-in from Lagos', protected_class: 'unfamiliar_sign_in', security: {what: 'New sign-in', device: 'Windows PC', location: 'Lagos, Nigeria', unfamiliar: true}}),
    expect: {lane: 'attention', kind: 'security', protected: true, source: 'strong_model', tiers: ['cheap', 'strong']},
  },
  {
    name: 'money leaving: an unauthorised charge', account: 'Personal', from: ['Woodgrove Bank', 'alerts@woodgrovebank.example'],
    subject: 'Fraud alert on your card', body: 'An unauthorized charge of $812.00 was made at an electronics store. Reply YES if you made it.',
    cheap: sure({lane: 'attention', kind: 'money', organisation: 'Woodgrove Bank', type: 'alert', summary: '$812.00 at an electronics store', protected_class: 'money_leaving'}),
    strong: sure({lane: 'attention', kind: 'money', organisation: 'Woodgrove Bank', type: 'alert', summary: '$812.00 at an electronics store', protected_class: 'money_leaving'}),
    expect: {lane: 'attention', kind: 'money', protected: true, source: 'strong_model', tiers: ['cheap', 'strong']},
  },
  {
    name: 'an account locked', account: 'Business', from: ['Fourth Coffee', 'accounts@fourthcoffee.example'],
    subject: 'Your account has been locked', body: 'After several failed sign-in attempts your Fourth Coffee business account has been locked.',
    cheap: sure({lane: 'attention', kind: 'security', organisation: 'Fourth Coffee', type: 'alert', summary: 'Locked after failed sign-ins'}),
    strong: sure({lane: 'attention', kind: 'security', organisation: 'Fourth Coffee', type: 'alert', summary: 'Locked after failed sign-ins'}),
    expect: {lane: 'attention', kind: 'security', protected: true, source: 'strong_model', tiers: ['cheap', 'strong']},
  },

  // ---- Updates ----
  {
    name: 'coursework due', account: 'Personal', from: ['CS 101', 'cs101@contosou.example'],
    subject: 'Lab 5 posted', body: 'Lab 5 is posted on the course site. It\'s due Wednesday, Oct 7, before lecture.',
    cheap: sure({lane: 'fyi', kind: 'updates', organisation: 'Contoso University', type: 'deadline', key_date: '2026-10-07', summary: 'CS 101 · Due Wed, Oct 7'}),
    expect: {lane: 'fyi', kind: 'updates', type: 'deadline', organisation: 'Contoso University', source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'storage almost full', account: 'iCloud', from: ['Apple', 'noreply@icloud.example'],
    subject: 'Your iCloud storage is almost full', body: 'You\'ve used almost all of your 50 GB of iCloud storage.',
    cheap: sure({lane: 'fyi', kind: 'updates', organisation: 'Apple', type: 'alert', summary: '50 GB almost used'}),
    expect: {lane: 'fyi', kind: 'updates', type: 'alert', source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'an exam schedule that needs planning', account: 'Personal', from: ['Office of the Registrar', 'registrar@contosou.example'],
    subject: 'Final exam schedule · CS 101', body: 'Fall 2026 finals: CS 101 meets Wed, Dec 9, 8:00 AM in Room 214. Report conflicts by Nov 1.',
    cheap: sure({lane: 'attention', kind: 'updates', organisation: 'Contoso University', type: 'deadline', key_date: '2026-11-01', summary: 'Report conflicts by Nov 1'}, 0.8),
    strong: sure({lane: 'attention', kind: 'updates', organisation: 'Contoso University', type: 'deadline', key_date: '2026-11-01', summary: 'Report conflicts by Nov 1'}, 0.86),
    expect: {lane: 'attention', kind: 'updates', source: 'strong_model', tiers: ['cheap', 'strong']},
  },

  // ---- People ----
  {
    name: 'a friend\'s question the strong model calls FYI', account: 'Personal', from: ['Sam Lee', 'sam.lee@example.com'],
    subject: 'Dinner Friday?', body: 'Hey! Dinner Friday? Blue Door at 7? I can book a table.',
    cheap: sure({lane: 'attention', kind: 'people', organisation: 'Sam Lee', type: null, summary: 'Blue Door at 7?'}, 0.75),
    strong: sure({lane: 'fyi', kind: 'people', organisation: 'Sam Lee', type: null, summary: 'Blue Door at 7?'}, 0.8),
    expect: {lane: 'fyi', kind: 'people', source: 'strong_model', tiers: ['cheap', 'strong']},
  },
  {
    name: 'a lease to sign by a date', account: 'Personal', from: ['Dana Whitfield', 'dana.whitfield@parksideapts.example'],
    subject: 'Lease renewal terms', body: 'Hi there, attached is the renewal offer for your lease ending Nov 30. Please sign by Oct 31 if you\'d like to stay.',
    cheap: sure({lane: 'attention', kind: 'people', organisation: 'Parkside Apartments', type: 'deadline', key_date: '2026-10-31', summary: 'Sign by Oct 31'}),
    strong: sure({lane: 'attention', kind: 'people', organisation: 'Parkside Apartments', type: 'deadline', key_date: '2026-10-31', summary: 'Sign by Oct 31'}, 0.93),
    expect: {lane: 'attention', kind: 'people', type: 'deadline', source: 'strong_model', tiers: ['cheap', 'strong']},
  },

  // ---- Noise ----
  {
    name: 'a sale, by the shipped marketing rule', account: 'Personal', from: ['Tailspin Toys', 'deals@tailspintoys.example'],
    subject: 'Fall sale: 30% off building sets', body: 'Our fall sale is on: 30% off every building set until Sunday. Unsubscribe',
    cheap: sure({lane: 'noise', kind: null, organisation: 'Tailspin Toys', type: 'newsletter', summary: 'Ends Sunday'}),
    expect: {lane: 'noise', kind: null, source: 'rule', tiers: ['cheap']},
  },
  {
    name: 'a newsletter', account: 'Personal', from: ['Contoso Coffee', 'journal@contosocoffee.example'],
    subject: 'The Contoso Coffee Journal · October', body: 'A new harvest from Huila, brewing notes and what\'s roasting this month. Unsubscribe · Email preferences',
    cheap: sure({lane: 'noise', kind: null, organisation: 'Contoso Coffee', type: 'newsletter', summary: 'A new harvest from Huila'}),
    expect: {lane: 'noise', kind: null, type: 'newsletter', source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'a webinar invitation', account: 'Business', from: ['Litware', 'events@litware.example'],
    subject: 'Webinar: what\'s new in Litware 12', body: 'Join us on Oct 15 for a tour of what\'s new in Litware 12.',
    cheap: sure({lane: 'noise', kind: null, organisation: 'Litware', type: 'newsletter', summary: 'Register for the Oct 15 session'}, 0.85),
    expect: {lane: 'noise', kind: null, source: 'cheap_model', tiers: ['cheap']},
  },
  {
    name: 'a social follow, by the shipped social rule', account: 'Personal', from: ['Trailhead Runs', 'no-reply@trailhead.example'],
    subject: 'Morgan Diaz is now following you', body: 'Morgan Diaz is now following you on Trailhead Runs.',
    cheap: sure({lane: 'fyi', kind: 'other', organisation: 'Trailhead Runs', type: null, summary: 'New follower'}, 0.7),
    expect: {lane: 'noise', kind: null, source: 'rule', tiers: ['cheap']},
  },

  // ---- Unsure: FYI, never Attention ----
  {
    name: 'both models unsure about Attention: FYI', account: 'Personal', from: ['Northwind Bank', 'service@northwindbank.example'],
    subject: 'A quick question about your account', body: 'We have a quick question about your account. Please give us a call when convenient.',
    cheap: sure({lane: 'attention', kind: 'money', organisation: 'Northwind Bank', type: null, summary: 'Call when convenient'}, 0.55),
    strong: sure({lane: 'attention', kind: 'money', organisation: 'Northwind Bank', type: null, summary: 'Call when convenient'}, 0.6),
    expect: {lane: 'fyi', kind: 'money', source: 'unsure', tiers: ['cheap', 'strong']},
  },
  {
    name: 'no usable answer from either model: FYI', account: 'Work', from: ['Adatum Facilities', 'facilities@adatum.example'],
    subject: 'Parking garage update', body: 'Level 2 of the garage will be repainted next week.',
    cheap: 'no_tool', strong: 'broken_arguments',
    expect: {lane: 'fyi', kind: 'other', source: 'unsure', tiers: ['cheap', 'strong']},
  },
  {
    name: 'an unsure cheap answer the strong model settles as Noise', account: 'Business', from: ['Wide World Importers', 'hello@wideworldimporters.example'],
    subject: 'Just landed: hand-thrown ceramics', body: 'New this week: hand-thrown ceramics from Oaxaca and Kyoto. Shop now.',
    cheap: sure({lane: 'fyi', kind: 'other', organisation: 'Wide World Importers', type: null, summary: 'New ceramics'}, 0.5),
    strong: sure({lane: 'noise', kind: null, organisation: 'Wide World Importers', type: 'newsletter', summary: 'New ceramics'}, 0.9),
    expect: {lane: 'noise', kind: null, source: 'strong_model', tiers: ['cheap', 'strong']},
  },
  {
    name: 'an unsure strong FYI stays FYI', account: 'Work', from: ['Adatum IT', 'it@adatum.example'],
    subject: 'Laptop refresh program', body: 'The laptop refresh program opens next quarter. More details soon.',
    cheap: sure({lane: 'fyi', kind: 'updates', organisation: 'Adatum', type: null, summary: 'Opens next quarter'}, 0.6),
    strong: sure({lane: 'fyi', kind: 'updates', organisation: 'Adatum', type: null, summary: 'Opens next quarter'}, 0.65),
    expect: {lane: 'fyi', kind: 'updates', source: 'unsure', tiers: ['cheap', 'strong']},
  },
];

/** The user's written rule the protected fixture meets: this sender to Noise (it can't move protected mail). */
export const FIXTURE_RULES = [{match: {from_domains: ['tailwindtraders.example']}, lane: 'noise' as const, kind: null}];
