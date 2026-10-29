// A recorded set of invented emails for Jobs's reading (J2), over two weeks after it's turned on, in
// prod's shapes: each with what triage answers (its tool's fields) and what Haiku answers for Jobs
// (null: Jobs never asks, as for Business mail that isn't Career). Companies are Microsoft's
// fictional ones and every address an example domain. tests/reader.test.ts serves both answers from
// the fake Anthropic and states what they make.
export interface RecordedEmail {
  key: string;
  account: 'Jobs' | 'Business';
  at: string;
  from: [name: string, address: string];
  subject: string;
  body: string;
  triage: {lane: 'attention' | 'fyi' | 'noise'; kind: string | null; type: string | null; organisation: string; via: string | null; summary: string};
  jobs: {event: string; company: string | null; title: string | null; requisition_id: string | null; line: string | null} | null;
}

const fyi = (kind: string, type: string | null, organisation: string, via: string | null, summary: string) =>
  ({lane: 'fyi' as const, kind, type, organisation, via, summary});
const jobs = (event: string, company: string | null, title: string | null = null, requisitionId: string | null = null, line: string | null = null) =>
  ({event, company, title, requisition_id: requisitionId, line});

export const RECORDED_EMAILS: RecordedEmail[] = [
  {
    key: 'tailspin-match', account: 'Jobs', at: '2026-10-08T14:00:00.000Z', from: ['Indeed', 'alert@indeed.example'],
    subject: 'Full Stack Developer @ Tailspin Toys',
    body: 'Tailspin Toys is hiring a Full Stack Developer in Denver, CO. $85,000–$105,000 a year. Hybrid.\n\nView job: https://indeed.example/viewjob?jk=5d2e8a17c0f4',
    triage: {lane: 'noise', kind: null, type: 'newsletter', organisation: 'Indeed', via: null, summary: '$85,000–$105,000 · Hybrid'},
    jobs: jobs('match', 'Tailspin Toys', 'Full Stack Developer'),
  },
  {
    key: 'fabrikam-applied', account: 'Jobs', at: '2026-10-08T16:00:00.000Z', from: ['Fabrikam Recruiting', 'no-reply@fabrikam.example'],
    subject: 'Thank you for applying to Fabrikam Labs',
    body: 'Thank you for applying for Software Engineer II (Java) (2026-1042). Our team will review your application and be in touch.',
    triage: fyi('career', 'confirmation', 'Fabrikam Labs', 'Greenhouse', 'Application received for Software Engineer II'),
    jobs: jobs('confirmation', 'Fabrikam Labs', 'Software Engineer II (Java) (2026-1042)', '2026-1042'),
  },
  {
    key: 'fabrikam-verify', account: 'Jobs', at: '2026-10-08T16:05:00.000Z', from: ['Greenhouse', 'no-reply@greenhouse.example'],
    subject: 'Verify your email to continue with Fabrikam Labs',
    body: 'Your code is 418 207. Enter it to keep your application to Fabrikam Labs up to date.',
    triage: fyi('updates', 'verification_code', 'Greenhouse', null, 'Verification code for Fabrikam Labs'),
    jobs: jobs('verification', 'Fabrikam Labs'),
  },
  {
    key: 'humongous-r100', account: 'Jobs', at: '2026-10-08T17:00:00.000Z', from: ['Humongous Insurance Careers', 'careers@humongousinsurance.example'],
    subject: 'Application received: Data Analyst',
    body: 'We received your application for Data Analyst, requisition R-100, in Claims.',
    triage: fyi('career', 'confirmation', 'Humongous Insurance', 'Workday', 'Data Analyst application received'),
    jobs: jobs('confirmation', 'Humongous Insurance', 'Data Analyst', 'R-100'),
  },
  {
    key: 'humongous-r200', account: 'Jobs', at: '2026-10-08T17:30:00.000Z', from: ['Humongous Insurance Careers', 'careers@humongousinsurance.example'],
    subject: 'Application received: Data Analyst (R-200)',
    body: 'We received your application for Data Analyst, requisition R-200, in Underwriting.',
    triage: fyi('career', 'confirmation', 'Humongous Insurance', 'Workday', 'Data Analyst application received'),
    jobs: jobs('confirmation', 'Humongous Insurance', 'Data Analyst', 'R-200'),
  },
  {
    key: 'tailspin-applied', account: 'Jobs', at: '2026-10-09T19:00:00.000Z', from: ['Indeed', 'indeedapply@indeed.example'],
    subject: 'Indeed Application: Full Stack Developer',
    body: 'Your application has been submitted. Good luck! You can track it in My jobs.',
    triage: fyi('career', 'confirmation', 'Indeed', null, 'Application submitted for Full Stack Developer'),
    jobs: jobs('confirmation', null, 'Full Stack Developer'),
  },
  {
    key: 'humongous-update', account: 'Jobs', at: '2026-10-09T20:00:00.000Z', from: ['Humongous Insurance Careers', 'careers@humongousinsurance.example'],
    subject: 'An update on your application',
    body: 'Thank you for your interest in Humongous Insurance. We have decided to move forward with other candidates.',
    triage: fyi('career', 'rejection', 'Humongous Insurance', 'Workday', 'Not moving forward'),
    jobs: jobs('rejection', 'Humongous Insurance', null, null, 'Not moving forward'),
  },
  {
    key: 'fabrikam-again', account: 'Jobs', at: '2026-10-10T15:00:00.000Z', from: ['Fabrikam Recruiting', 'no-reply@fabrikam.example'],
    subject: 'Thank you for applying to Fabrikam',
    body: 'Thank you for applying for Software Engineer II. We\'ll be in touch.',
    triage: fyi('career', 'confirmation', 'Fabrikam', 'Greenhouse', 'Application received for Software Engineer II'),
    jobs: jobs('confirmation', 'Fabrikam', 'Software Engineer II'),
  },
  {
    key: 'adventure-applied', account: 'Jobs', at: '2026-10-11T16:00:00.000Z', from: ['Adventure Works Talent', 'talent@adventure-works.example'],
    subject: 'Thanks for applying: Web Developer',
    body: 'Thanks for applying to the Web Developer role at Adventure Works.',
    triage: fyi('career', 'confirmation', 'Adventure Works', 'Lever', 'Web Developer application received'),
    jobs: jobs('confirmation', 'Adventure Works', 'Web Developer'),
  },
  {
    key: 'fabrikam-interview', account: 'Jobs', at: '2026-10-12T17:00:00.000Z', from: ['Dana Park', 'dana.park@fabrikam.example'],
    subject: 'Interview for Software Engineer II',
    body: 'We\'d like to meet you on Tuesday, October 13 at 2:00 PM Pacific for a video interview.',
    triage: {lane: 'attention', kind: 'career', type: null, organisation: 'Fabrikam', via: null, summary: 'Interview Tue Oct 13, 2:00 PM'},
    jobs: jobs('interview', 'Fabrikam', 'Software Engineer II', null, 'Interview Tue Oct 13, 2:00 PM'),
  },
  {
    key: 'lucerne-rejection', account: 'Jobs', at: '2026-10-12T18:00:00.000Z', from: ['Lucerne Publishing', 'jobs@lucernepublishing.example'],
    subject: 'Your application to Lucerne Publishing',
    body: 'We have filled the Editorial Assistant role. Thank you for applying.',
    triage: fyi('career', 'rejection', 'Lucerne Publishing', null, 'Editorial Assistant role filled'),
    jobs: jobs('rejection', 'Lucerne Publishing', 'Editorial Assistant', null, 'Role filled'),
  },
  {
    key: 'proseware-screen', account: 'Jobs', at: '2026-10-13T16:00:00.000Z', from: ['Proseware Recruiting', 'recruiting@proseware.example'],
    subject: 'Schedule your phone screen',
    body: 'Please pick a 30-minute slot for a phone screen about the Junior Developer role.',
    triage: {lane: 'attention', kind: 'career', type: null, organisation: 'Proseware', via: null, summary: 'Pick a phone screen slot'},
    jobs: jobs('interview', 'Proseware', 'Junior Developer', null, 'Phone screen, pick a slot'),
  },
  {
    key: 'city-applied', account: 'Business', at: '2026-10-13T17:00:00.000Z', from: ['City Power & Light', 'jobs@cityofpower.example'],
    subject: 'Application received: IT Technician II',
    body: 'Your application for IT Technician II has been received.',
    triage: fyi('career', 'confirmation', 'City Power & Light', 'GovernmentJobs', 'IT Technician II application received'),
    jobs: jobs('confirmation', 'City Power & Light', 'IT Technician II'),
  },
  {
    key: 'business-order', account: 'Business', at: '2026-10-13T18:00:00.000Z', from: ['Wingtip Toys', 'orders@wingtiptoys.example'],
    subject: 'Your order has shipped',
    body: 'Your USB-C dock is on its way.',
    triage: fyi('deliveries', 'shipping', 'Wingtip Toys', null, 'USB-C dock shipped'),
    jobs: null,
  },
  {
    key: 'contoso-recruiter', account: 'Jobs', at: '2026-10-14T16:00:00.000Z', from: ['Sam Rivera', 'sam.rivera@contoso.example'],
    subject: 'Opportunity at Contoso',
    body: 'I came across your profile and think you\'d be a great fit for a Senior Engineer role on my team.',
    triage: fyi('career', null, 'Contoso', null, 'Recruiter reaching out about Senior Engineer'),
    jobs: jobs('recruiter', 'Contoso', 'Senior Engineer'),
  },
  {
    key: 'woodgrove-applied', account: 'Jobs', at: '2026-10-14T17:00:00.000Z', from: ['Woodgrove Bank Careers', 'careers@woodgrovebank.example'],
    subject: 'Application received: Junior Developer',
    body: 'Thank you for applying to Junior Developer at Woodgrove Bank.',
    triage: fyi('career', 'confirmation', 'Woodgrove Bank', 'Workday', 'Junior Developer application received'),
    jobs: jobs('confirmation', 'Woodgrove Bank', 'Junior Developer'),
  },
  {
    key: 'humongous-case', account: 'Jobs', at: '2026-10-15T16:00:00.000Z', from: ['Humongous Insurance Careers', 'careers@humongousinsurance.example'],
    subject: 'Next step: a case study for Data Analyst',
    body: 'For requisition R-200, please complete the attached case study by October 19.',
    triage: fyi('career', 'deadline', 'Humongous Insurance', 'Workday', 'Case study due Oct 19'),
    jobs: jobs('assessment', 'Humongous Insurance', 'Data Analyst', 'R-200', 'Case study due Oct 19'),
  },
  {
    key: 'woodgrove-rejected', account: 'Jobs', at: '2026-10-16T16:00:00.000Z', from: ['Woodgrove Bank Careers', 'careers@woodgrovebank.example'],
    subject: 'Your Woodgrove Bank application',
    body: 'We won\'t be moving forward with your application for Junior Developer.',
    triage: fyi('career', 'rejection', 'Woodgrove Bank', 'Workday', 'Not moving forward'),
    jobs: jobs('rejection', 'Woodgrove Bank', 'Junior Developer', null, 'Not moving forward'),
  },
  {
    key: 'fabrikam-form', account: 'Jobs', at: '2026-10-16T17:00:00.000Z', from: ['Fabrikam Recruiting', 'no-reply@fabrikam.example'],
    subject: 'Voluntary self-identification',
    body: 'Please complete our voluntary self-identification form.',
    triage: fyi('career', null, 'Fabrikam', 'Greenhouse', 'Self-identification form'),
    jobs: jobs('form', 'Fabrikam'),
  },
  {
    key: 'adventure-interview', account: 'Jobs', at: '2026-10-17T16:00:00.000Z', from: ['Adventure Works Talent', 'talent@adventure-works.example'],
    subject: 'Interview: Product Designer',
    body: 'We\'d like to invite you to interview for Product Designer on Monday, October 19 at 10:00 AM.',
    triage: {lane: 'attention', kind: 'career', type: null, organisation: 'Adventure Works', via: 'Lever', summary: 'Interview Mon Oct 19, 10:00 AM'},
    jobs: jobs('interview', 'Adventure Works', 'Product Designer', null, 'Interview Mon Oct 19, 10:00 AM'),
  },
  {
    key: 'woodgrove-reapplied', account: 'Jobs', at: '2026-10-18T16:00:00.000Z', from: ['Woodgrove Bank Careers', 'careers@woodgrovebank.example'],
    subject: 'We received your application: Junior Developer',
    body: 'Thank you for applying again to Junior Developer at Woodgrove Bank.',
    triage: fyi('career', 'confirmation', 'Woodgrove Bank', 'Workday', 'Junior Developer application received'),
    jobs: jobs('confirmation', 'Woodgrove Bank', 'Junior Developer'),
  },
  {
    key: 'newsletter', account: 'Jobs', at: '2026-10-18T17:00:00.000Z', from: ['Fourth Coffee', 'news@fourthcoffee.example'],
    subject: 'Fall blends are here',
    body: 'Three new roasts for the season.',
    triage: {lane: 'noise', kind: null, type: 'newsletter', organisation: 'Fourth Coffee', via: null, summary: 'Three new fall roasts'},
    jobs: jobs('unrelated', 'Fourth Coffee'),
  },
];
