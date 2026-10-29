// A recorded invented history for Jobs's history pass (J4): five months of mail held in three
// accounts before Jobs is turned on (Oct 8, 2026), in prod's shapes. Mail before Jul 1 is the year's
// backfill, sorted as it landed by triage's rules-only pass (its kind and organisation guessed from
// the words and the sender); from Jul 1 triage's model sorted each email as it came (its fields
// here). `jobs` is what Haiku answers for Jobs, null for an email Jobs must never ask about: Business
// mail that isn't Career (nor, in the backfill, typed a confirmation or rejection or sent by a hiring
// platform, D355), and an account Jobs doesn't list. Companies are Microsoft's
// fictional ones and every address an example domain. tests/history.test.ts serves the answers from
// the fake Anthropic and states what they make.
export interface HistoryEmail {
  key: string;
  account: 'Jobs' | 'Business' | 'Personal';
  at: string;
  from: [name: string, address: string];
  subject: string;
  body: string;
  // Sorted by triage's model when it came; absent for the backfill, which the rules-only pass sorts.
  triage?: {lane: 'attention' | 'fyi' | 'noise'; kind: string | null; type: string | null; organisation: string; via: string | null; summary: string};
  jobs: {event: string; company: string | null; title: string | null; requisition_id: string | null; line: string | null} | null;
}

/** When Jobs is turned on in the recorded history: everything below came before. */
export const TURNED_ON = '2026-10-08T00:00:00.000Z';

const fyi = (kind: string, type: string | null, organisation: string, via: string | null, summary: string) =>
  ({lane: 'fyi' as const, kind, type, organisation, via, summary});
const jobs = (event: string, company: string | null, title: string | null = null, requisitionId: string | null = null, line: string | null = null) =>
  ({event, company, title, requisition_id: requisitionId, line});

export const HISTORY_EMAILS: HistoryEmail[] = [
  // The backfill: May and June.
  {
    key: 'trey-applied', account: 'Jobs', at: '2026-05-04T16:00:00.000Z', from: ['Trey Research', 'no-reply@us.greenhouse-mail.example'],
    subject: 'Thank you for applying to Trey Research', body: 'Thank you for applying for Data Engineer. Our team will review your application.',
    jobs: jobs('confirmation', 'Trey Research', 'Data Engineer'),
  },
  {
    key: 'wingtip-applied', account: 'Jobs', at: '2026-05-12T16:00:00.000Z', from: ['Wingtip Toys Careers', 'careers@wingtiptoys.example'],
    subject: 'Application received: Support Engineer', body: 'We have your application for Support Engineer and will be in touch.',
    jobs: jobs('confirmation', 'Wingtip Toys', 'Support Engineer'),
  },
  {
    key: 'coho-applied', account: 'Jobs', at: '2026-05-20T16:00:00.000Z', from: ['Coho Winery', 'jobs@cohowinery.example'],
    subject: 'Thanks for applying: Marketing Analyst', body: 'Thanks for applying to the Marketing Analyst role at Coho Winery.',
    jobs: jobs('confirmation', 'Coho Winery', 'Marketing Analyst'),
  },
  {
    key: 'wingtip-rejected', account: 'Jobs', at: '2026-05-30T16:00:00.000Z', from: ['Wingtip Toys Careers', 'careers@wingtiptoys.example'],
    subject: 'Your application for Support Engineer', body: 'Unfortunately we will not be moving forward with your application for Support Engineer.',
    jobs: jobs('rejection', 'Wingtip Toys', 'Support Engineer', null, 'Not moving forward'),
  },
  {
    key: 'blueyonder-applied', account: 'Jobs', at: '2026-06-02T16:00:00.000Z', from: ['Blue Yonder Airlines', 'talent@blueyonderairlines.example'],
    subject: 'Application received', body: 'Your application for IT Support Specialist has been received.',
    jobs: jobs('confirmation', 'Blue Yonder Airlines', 'IT Support Specialist'),
  },
  {
    key: 'coho-assessment', account: 'Jobs', at: '2026-06-03T16:00:00.000Z', from: ['Coho Winery', 'jobs@cohowinery.example'],
    subject: 'Next step: a case study', body: 'Please complete the attached case study for Marketing Analyst by June 10.',
    jobs: jobs('assessment', 'Coho Winery', 'Marketing Analyst', null, 'Case study due Jun 10'),
  },
  {
    key: 'school-applied', account: 'Business', at: '2026-06-10T16:00:00.000Z', from: ['School of Fine Art HR', 'hr@schooloffineart.example'],
    subject: 'Application received: Records Clerk', body: 'Your application for Records Clerk has been received.',
    // Backfilled into a Career-only account, sorted Other by the rules but typed a confirmation: read (D355).
    jobs: jobs('confirmation', 'School of Fine Art', 'Records Clerk'),
  },
  {
    key: 'business-order', account: 'Business', at: '2026-06-12T16:00:00.000Z', from: ['Wide World Importers', 'orders@wideworldimporters.example'],
    subject: 'Your order has shipped', body: 'Your desk lamp has shipped. Tracking number 1Z999.',
    jobs: null,
  },
  {
    key: 'relecloud-310', account: 'Jobs', at: '2026-06-15T16:00:00.000Z', from: ['Relecloud Recruiting', 'no-reply@relecloud.example'],
    subject: 'Application received: Cloud Support Associate (R-310)', body: 'We received your application for Cloud Support Associate, requisition R-310.',
    jobs: jobs('confirmation', 'Relecloud', 'Cloud Support Associate', 'R-310'),
  },
  {
    key: 'relecloud-322', account: 'Jobs', at: '2026-06-16T16:00:00.000Z', from: ['Relecloud Recruiting', 'no-reply@relecloud.example'],
    subject: 'Application received: Cloud Support Associate (R-322)', body: 'We received your application for Cloud Support Associate, requisition R-322.',
    jobs: jobs('confirmation', 'Relecloud', 'Cloud Support Associate', 'R-322'),
  },
  {
    key: 'graphic-interview', account: 'Business', at: '2026-06-17T16:00:00.000Z', from: ['Graphic Design Institute', 'no-reply@hire.lever.example'],
    subject: 'Interview invitation: Program Coordinator', body: 'We would like to invite you to interview for Program Coordinator on Friday, June 19 at 2:00 PM.',
    // Backfilled into a Career-only account, sorted Other with no type, but sent by a hiring platform: read (D355).
    jobs: jobs('interview', 'Graphic Design Institute', 'Program Coordinator', null, 'Interview Fri Jun 19, 2:00 PM'),
  },
  {
    key: 'nod-digest', account: 'Business', at: '2026-06-18T16:00:00.000Z', from: ['Nod Publishers', 'news@nodpublishers.example'],
    subject: 'Your monthly digest', body: 'This month\'s new titles and events.',
    // Backfilled into a Career-only account, a newsletter from no platform: never read.
    jobs: null,
  },
  {
    key: 'coho-rejected', account: 'Jobs', at: '2026-06-20T16:00:00.000Z', from: ['Coho Winery', 'jobs@cohowinery.example'],
    subject: 'An update on your application', body: 'Thank you for your time. We have decided to move forward with other candidates.',
    jobs: jobs('rejection', 'Coho Winery', null, null, 'Not moving forward'),
  },
  {
    key: 'school-rejected', account: 'Business', at: '2026-06-24T16:00:00.000Z', from: ['School of Fine Art HR', 'hr@schooloffineart.example'],
    subject: 'Your application for Records Clerk', body: 'Thank you for your interest. Unfortunately you were not selected for Records Clerk.',
    // Backfilled into a Career-only account and sorted Career by the rules (a rejection): read, and it matches nothing.
    jobs: jobs('rejection', 'School of Fine Art', 'Records Clerk', null, 'Not selected'),
  },
  {
    key: 'alpine-interview', account: 'Jobs', at: '2026-06-25T16:00:00.000Z', from: ['Alpine Ski House', 'recruiting@alpineskihouse.example'],
    subject: 'Interview request: Operations Analyst', body: 'We would like to interview you for Operations Analyst on Monday, June 29 at 10:00 AM.',
    jobs: jobs('interview', 'Alpine Ski House', 'Operations Analyst', null, 'Interview Mon Jun 29, 10:00 AM'),
  },
  {
    key: 'nod-newsletter', account: 'Jobs', at: '2026-06-28T16:00:00.000Z', from: ['Nod Publishers', 'news@nodpublishers.example'],
    subject: 'Summer reading list', body: 'Ten new titles for the summer.',
    jobs: jobs('unrelated', 'Nod Publishers'),
  },
  // Sorted by triage's model as it came: July on.
  {
    key: 'relecloud-rejection', account: 'Jobs', at: '2026-07-01T16:00:00.000Z', from: ['Relecloud Recruiting', 'no-reply@relecloud.example'],
    subject: 'Your Relecloud application', body: 'We will not be moving forward with your application for Cloud Support Associate.',
    triage: fyi('career', 'rejection', 'Relecloud', 'Greenhouse', 'Not moving forward'),
    jobs: jobs('rejection', 'Relecloud', 'Cloud Support Associate', null, 'Not moving forward'),
  },
  {
    key: 'fourth-applied', account: 'Jobs', at: '2026-07-06T16:00:00.000Z', from: ['Fourth Coffee', 'no-reply@hire.lever.example'],
    subject: 'Thanks for applying to Fourth Coffee', body: 'Thanks for applying for Junior Data Analyst at Fourth Coffee.',
    triage: fyi('career', 'confirmation', 'Fourth Coffee', 'Lever', 'Junior Data Analyst application received'),
    jobs: jobs('confirmation', 'Fourth Coffee', 'Junior Data Analyst'),
  },
  {
    key: 'fourth-verify', account: 'Jobs', at: '2026-07-06T16:10:00.000Z', from: ['Lever', 'no-reply@hire.lever.example'],
    subject: 'Verify your email to continue with Fourth Coffee', body: 'Your code is 551 208.',
    triage: fyi('security', 'verification_code', 'Lever', null, 'Verification code for Fourth Coffee'),
    jobs: jobs('verification', 'Fourth Coffee'),
  },
  {
    key: 'fourth-form', account: 'Jobs', at: '2026-07-08T16:00:00.000Z', from: ['Fourth Coffee', 'no-reply@hire.lever.example'],
    subject: 'Voluntary self-identification', body: 'Please complete our voluntary self-identification form.',
    triage: fyi('career', null, 'Fourth Coffee', 'Lever', 'Self-identification form'),
    jobs: jobs('form', 'Fourth Coffee'),
  },
  {
    key: 'litware-rejection', account: 'Jobs', at: '2026-07-09T16:00:00.000Z', from: ['Litware', 'jobs@litware.example'],
    subject: 'Your application to Litware', body: 'We have filled the QA Engineer role. Thank you for applying.',
    triage: fyi('career', 'rejection', 'Litware', null, 'QA Engineer role filled'),
    jobs: jobs('rejection', 'Litware', 'QA Engineer', null, 'Role filled'),
  },
  {
    key: 'margies-booking', account: 'Business', at: '2026-07-15T16:00:00.000Z', from: ['Margie\'s Travel', 'bookings@margiestravel.example'],
    subject: 'Your booking is confirmed', body: 'Your hotel booking in Portland is confirmed for August 3.',
    triage: fyi('other', 'confirmation', 'Margie\'s Travel', null, 'Hotel booking confirmed'),
    // Live mail in a Career-only account, typed a confirmation but not Career: never read (decision 56).
    jobs: null,
  },
  {
    key: 'tailspin-match', account: 'Jobs', at: '2026-07-20T14:00:00.000Z', from: ['Indeed', 'alert@indeed.example'],
    subject: 'Full Stack Developer @ Tailspin Toys', body: 'Tailspin Toys is hiring a Full Stack Developer in Denver, CO. Hybrid.',
    triage: {lane: 'noise', kind: null, type: 'newsletter', organisation: 'Indeed', via: null, summary: 'Hybrid, Denver'},
    jobs: jobs('match', 'Tailspin Toys', 'Full Stack Developer'),
  },
  {
    key: 'tailspin-applied', account: 'Jobs', at: '2026-07-21T19:00:00.000Z', from: ['Indeed', 'indeedapply@indeed.example'],
    subject: 'Indeed Application: Full Stack Developer', body: 'Your application has been submitted. Good luck!',
    triage: fyi('career', 'confirmation', 'Indeed', null, 'Application submitted for Full Stack Developer'),
    jobs: jobs('confirmation', null, 'Full Stack Developer'),
  },
  {
    key: 'contoso-recruiter', account: 'Jobs', at: '2026-07-28T16:00:00.000Z', from: ['Sam Rivera', 'sam.rivera@contoso.example'],
    subject: 'Opportunity at Contoso', body: 'I came across your profile and think you\'d be a great fit for a Senior Engineer role.',
    triage: fyi('career', null, 'Contoso', null, 'Recruiter reaching out'),
    jobs: jobs('recruiter', 'Contoso', 'Senior Engineer'),
  },
  {
    key: 'fourth-rejected', account: 'Jobs', at: '2026-08-03T16:00:00.000Z', from: ['Fourth Coffee', 'no-reply@hire.lever.example'],
    subject: 'Your Fourth Coffee application', body: 'We won\'t be moving forward with your application for Junior Data Analyst.',
    triage: fyi('career', 'rejection', 'Fourth Coffee', 'Lever', 'Not moving forward'),
    jobs: jobs('rejection', 'Fourth Coffee', 'Junior Data Analyst', null, 'Not moving forward'),
  },
  {
    key: 'city-applied', account: 'Business', at: '2026-08-10T17:00:00.000Z', from: ['City Power & Light', 'jobs@cityofpower.example'],
    subject: 'Application received: IT Technician II', body: 'Your application for IT Technician II has been received.',
    triage: fyi('career', 'confirmation', 'City Power & Light', 'GovernmentJobs', 'IT Technician II application received'),
    jobs: jobs('confirmation', 'City Power & Light', 'IT Technician II'),
  },
  {
    key: 'personal-applied', account: 'Personal', at: '2026-08-12T17:00:00.000Z', from: ['Southridge Video', 'jobs@southridgevideo.example'],
    subject: 'Application received: Video Editor', body: 'Your application for Video Editor has been received.',
    triage: fyi('career', 'confirmation', 'Southridge Video', null, 'Video Editor application received'),
    // An account Jobs doesn't list: never read.
    jobs: null,
  },
  {
    key: 'proseware-applied', account: 'Jobs', at: '2026-09-05T16:00:00.000Z', from: ['Proseware', 'no-reply@hire.lever.example'],
    subject: 'Thanks for applying to Proseware', body: 'Thanks for applying for Product Designer at Proseware.',
    triage: fyi('career', 'confirmation', 'Proseware', 'Lever', 'Product Designer application received'),
    jobs: jobs('confirmation', 'Proseware', 'Product Designer'),
  },
  {
    key: 'fourth-reapplied', account: 'Jobs', at: '2026-09-14T16:00:00.000Z', from: ['Fourth Coffee', 'no-reply@hire.lever.example'],
    subject: 'We received your application: Junior Data Analyst', body: 'Thanks for applying again for Junior Data Analyst at Fourth Coffee.',
    triage: fyi('career', 'confirmation', 'Fourth Coffee', 'Lever', 'Junior Data Analyst application received'),
    jobs: jobs('confirmation', 'Fourth Coffee', 'Junior Data Analyst'),
  },
  {
    key: 'fourth-interview', account: 'Jobs', at: '2026-09-20T16:00:00.000Z', from: ['Avery Chen', 'avery.chen@fourthcoffee.example'],
    subject: 'Interview: Junior Data Analyst', body: 'Can you meet on Thursday, September 24 at 1:00 PM?',
    triage: {lane: 'attention', kind: 'career', type: null, organisation: 'Fourth Coffee', via: null, summary: 'Interview Thu Sep 24, 1:00 PM'},
    jobs: jobs('interview', 'Fourth Coffee', 'Junior Data Analyst', null, 'Interview Thu Sep 24, 1:00 PM'),
  },
  {
    key: 'proseware-interview', account: 'Jobs', at: '2026-09-25T16:00:00.000Z', from: ['Proseware Recruiting', 'recruiting@proseware.example'],
    subject: 'Interview: Product Designer', body: 'We\'d like to meet on Wednesday, September 30 at 11:00 AM.',
    triage: {lane: 'attention', kind: 'career', type: null, organisation: 'Proseware', via: null, summary: 'Interview Wed Sep 30, 11:00 AM'},
    jobs: jobs('interview', 'Proseware', 'Product Designer', null, 'Interview Wed Sep 30, 11:00 AM'),
  },
  {
    key: 'lucerne-applied', account: 'Jobs', at: '2026-09-30T16:00:00.000Z', from: ['Lucerne Publishing', 'no-reply@us.greenhouse-mail.example'],
    subject: 'Thank you for your application to Lucerne Publishing', body: 'Hi, thank you for applying to Junior Developer at Lucerne Publishing in New York.',
    triage: fyi('career', 'confirmation', 'Lucerne Publishing', 'Greenhouse', 'Junior Developer application received'),
    jobs: jobs('confirmation', 'Lucerne Publishing', 'Junior Developer'),
  },
  {
    key: 'proseware-other', account: 'Jobs', at: '2026-10-03T16:00:00.000Z', from: ['Proseware Recruiting', 'recruiting@proseware.example'],
    subject: 'Interview for UX Researcher', body: 'We\'d like to invite you to interview for UX Researcher.',
    triage: {lane: 'attention', kind: 'career', type: null, organisation: 'Proseware', via: null, summary: 'Interview for UX Researcher'},
    jobs: jobs('interview', 'Proseware', 'UX Researcher', null, 'Interview request'),
  },
];
