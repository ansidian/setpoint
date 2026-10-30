// BRIEF.md › Sample data › Jobs (round 4) as rows (J1), on the seed's clock (Wed Oct 7, 2026, 9:12
// AM Pacific): the table's 17 applications and 45 more, invented, so the numbers come out as the
// brief's (62; Applied 31 with 18 Ghosted, In process 3, Offer 1, Rejected 25, Withdrawn 2; 3, 5, 4,
// 6, 2, 4, 7, 5, 3, 6, 8 and 3 a week), Needs you's three items and From history's six (boards 34a,
// 34b), Northwind's detail (32, 33) and the JDs the table names. Every company is one of Microsoft's
// fictional ones and every link an example domain.
//
// Events and Needs you items keep their own copies (decision 63), so the emails they name needn't
// be in mail: only the Northwind and Fabrikam emails are the Inbox's own, linked by message id. Run
// from the app's seed (src/dev/sample.ts, a wiring point) after mail's sample is in.
import type Database from 'better-sqlite3';
import {SEED_NOW, SEED_TIME_ZONE, STATUS_OF_JOB_EVENT, isQuietJobEvent} from '@setpoint/shared';
import type {JdSource, JobEventKind, JobStatus, JobWorkplace, NeedsYouKind, NeedsYouReason} from '@setpoint/shared';
import {zonedInstant} from '../domain/time.ts';
import type {Store} from '../store.ts';
import {jobsDb, migrateJobs} from './db.ts';
import {accountsByLabel, findMessage} from './mail.ts';
import {titleKey} from './rules.ts';
import * as j from './schema.ts';

/** "10-07", "09:12" (2026) in the seed's zone. */
const at = (date: string, time: string) => zonedInstant(`${date.length === 5 ? `2026-${date}` : date}`, time, SEED_TIME_ZONE);
const minutesAfter = (instant: string, minutes: number) => new Date(Date.parse(instant) + minutes * 60_000).toISOString();

type Account = 'Jobs' | 'Business';

interface SeedEvent {
  at: [string, string];
  kind: JobEventKind;
  subject: string;
  sender?: string;
  line?: string;
  // The Inbox's own email with this subject at this time.
  mail?: true;
}

interface SeedPosting {
  source: JdSource;
  platform: string | null;
  link: string;
  foundAt?: [string, string];
  summary: string;
  location: string;
  workplace: JobWorkplace;
  workplaceDetail?: string;
  salary: string | null;
  mustHaves: string[];
  niceToHaves: string[];
  fullText: string;
}

interface SeedCandidate {
  title: string;
  location: string;
  platform: string;
  link: string;
}

interface SeedApplication {
  key?: string;
  company: string;
  title: string;
  platform: string;
  account?: Account;
  events: SeedEvent[];
  // Set by hand (D322): Alpine Ski House's Withdrawn on Sep 10.
  byHand?: {status: JobStatus; at: [string, string]};
  jd: SeedPosting | {candidates: SeedCandidate[]} | 'not_found' | null;
  reappliedFrom?: string;
}

const NORTHWIND_POSTING = `## About the team

Northwind Talent builds hiring software for mid-sized companies. The hiring-platform team owns the candidate-facing web app, where people find roles, apply and schedule interviews, and the API behind it. We're five engineers, a designer and a product manager, and we ship small changes every day.

## What you'll do

- Build features end to end in TypeScript, from the React front end to the Node.js API and its Postgres tables
- Pair with senior engineers on design reviews, then own your changes through release
- Write the tests that run in CI for everything you ship
- Join a support rotation one week a quarter, with a mentor beside you

## What you'll need

- Experience with TypeScript and React, from work, school or your own projects
- An API you designed and built, and can talk through
- Comfort writing SQL by hand
- A degree in computer science or equivalent experience

## Nice to have

- Node.js on the server
- Tests running in CI
- Any time spent on hiring or HR software

## Where and pay

Irvine, CA. Hybrid, in the office three days a week. The base salary range for this role is $95,000–$115,000, plus benefits and an annual learning budget.

Shipped side projects count for more than coursework: send us a link to something you built.`;

const HUMONGOUS_CLAIMS_POSTING = `## About the role

The claims platform team builds the services adjusters use to open, review and settle claims. You'll work on the Java services and the APIs behind the claims web app, alongside the adjusters who use them every day.

## What you'll do

- Build and maintain Java services for opening, reviewing and settling claims
- Design REST APIs the claims web app and partner systems call
- Improve the tests, monitoring and alerts the team relies on

## What you'll need

- Java or another JVM language
- REST APIs running in production
- SQL
- 2 or more years of professional experience

## Nice to have

- Insurance or claims software
- Spring Boot
- Deploying to a cloud

## Where and pay

Remote, anywhere in the United States. Salary is discussed in the first call.`;

const WOODGROVE_POSTING = `## About the role

Woodgrove Bank's digital team builds the web and mobile banking our customers use every day. As an application developer you'll build features across our account and payments services, with a senior engineer as your mentor for your first six months.

## What you'll do

- Build features in C# and TypeScript across the account and payments services
- Write the tests and the runbooks for what you ship
- Take part in design reviews and on-call, once you're settled in

## What you'll need

- A language like C#, Java or TypeScript, used in real projects
- SQL and a relational database
- Git and code review

## Nice to have

- Containers: our services run on Kubernetes across two regions, so you’ll pick it up from day one, and we'll teach you the rest.
- Payments or banking experience

## Where and pay

Charlotte, NC. Hybrid, two days a week in the office. $88,000–$104,000, plus a bonus.`;

const CONTOSO_PHARMA_POSTING = `## About the role

Build and maintain the internal tools our lab teams use every day, working with a small team on the web app and its services.

## What you'll do

- Build features for the lab scheduling and sample tracking web app
- Keep its services fast and its data right
- Work closely with the scientists who use it

## What you'll need

- A degree in computer science or equivalent experience
- JavaScript or TypeScript
- SQL

## Nice to have

- Python
- Lab or healthcare software

## Where and pay

San Diego, CA. Hybrid. $78,000–$92,000 a year.`;

const TAILSPIN_POSTING = `## About the role

Tailspin Toys sells toys online and in 40 stores. The commerce team builds the storefront, the checkout and the tools our store staff use, and we're hiring a full stack developer to join it.

## What you'll do

- Build storefront features in React and the Node.js services behind them
- Improve checkout's speed and reliability before the holidays
- Work with design and the stores on what to build next

## What you'll need

- React and a server-side language
- SQL
- 1 or more years building web apps

## Nice to have

- E-commerce or payments
- Performance work on a busy site

## Where and pay

Denver, CO. Hybrid. $85,000–$105,000 a year.`;

/** A plain posting for the applications the boards don't open. */
function posting(company: string, title: string, options: {
  source: JdSource; platform: string | null; link: string; location: string; workplace: JobWorkplace; workplaceDetail?: string; salary: string | null;
  foundAt?: [string, string];
}): SeedPosting {
  const lower = title.toLowerCase();
  const family = /data/.test(lower) ? 'data' : /support|technician|it /.test(`${lower} `) ? 'support' : /qa|quality/.test(lower) ? 'qa' : 'build';
  const area = {
    data: 'its reporting, dashboards and the data pipelines behind them',
    support: 'the systems its staff rely on, from laptops and accounts to the internal apps',
    qa: 'the test suites and release checks behind its products',
    build: 'the web apps and services its customers use every day',
  }[family];
  const musts = {
    data: ['SQL', 'A spreadsheet or BI tool', 'Python or R'],
    support: ['Troubleshooting Windows and macOS', 'Accounts and access in a directory', 'Clear, patient writing'],
    qa: ['Writing automated tests', 'A scripting language', 'Reading a bug down to its cause'],
    build: ['A language like TypeScript, Java or C#', 'SQL', 'Git and code review'],
  }[family];
  const nices = {
    data: ['dbt or another pipeline tool', 'Experience in the industry'],
    support: ['A help desk certification', 'Scripting with PowerShell'],
    qa: ['Playwright or Selenium', 'CI pipelines'],
    build: ['React', 'Tests in CI'],
  }[family];
  const where = options.workplace === 'remote' ? 'Remote' : options.workplace === 'hybrid' ? `Hybrid${options.workplaceDetail ? `, ${options.workplaceDetail}` : ''}` : 'On-site';
  const fullText = [
    '## About the role', '',
    `${company} is hiring a ${title} to join a small team that builds and runs ${area}.`, '',
    '## What you\'ll do', '',
    '- Take work from the first design review through to release', '- Fix what you find, and write the tests that keep it fixed', '- Work with the people who use what you build', '',
    '## What you\'ll need', '', ...musts.map(item => `- ${item}`), '',
    '## Nice to have', '', ...nices.map(item => `- ${item}`), '',
    '## Where and pay', '',
    `${options.location}. ${where}.${options.salary ? ` ${options.salary} a year.` : ''}`,
  ].join('\n');
  return {
    ...options,
    summary: `A ${title.toLowerCase()} for ${company}, working on ${area}. Small team, real ownership from the first month.`,
    mustHaves: musts, niceToHaves: nices, fullText,
  };
}

const applied = (date: string, time: string, company: string, subject = `Thank you for applying to ${company}`): SeedEvent => ({at: [date, time], kind: 'applied', subject, sender: company});
const rejected = (date: string, time: string, company: string, subject = 'Update on your application'): SeedEvent => ({at: [date, time], kind: 'rejection', subject, sender: company});

/** The table (BRIEF.md › Sample data › Jobs), newest first. */
const TABLE: SeedApplication[] = [
  {company: 'Fabrikam', title: 'Data Analyst', platform: 'Workday',
    events: [{at: ['10-07', '02:14'], kind: 'applied', subject: 'Application received', sender: 'Fabrikam Recruiting', mail: true}],
    jd: posting('Fabrikam', 'Data Analyst', {source: 'search', platform: null, link: 'https://fabrikam.example/careers/data-analyst-2291', location: 'Atlanta, GA', workplace: 'hybrid', salary: '$70,000–$82,000', foundAt: ['10-07', '02:16']})},
  {key: 'relecloud-2', company: 'Relecloud', title: 'Support Engineer', platform: 'Greenhouse', reappliedFrom: 'relecloud-1',
    events: [applied('10-06', '14:30', 'Relecloud')],
    jd: posting('Relecloud', 'Support Engineer', {source: 'platform', platform: 'Greenhouse', link: 'https://greenhouse.example/relecloud/jobs/6120884', location: 'Remote, US', workplace: 'remote', salary: '$72,000–$86,000'})},
  {company: 'Lucerne Publishing', title: 'Junior Developer', platform: 'Greenhouse',
    events: [applied('10-05', '10:20', 'Lucerne Publishing', 'Thank you for your application to Lucerne Publishing')],
    jd: {candidates: [
      {title: 'Junior Developer', location: 'New York, NY', platform: 'Greenhouse', link: 'https://greenhouse.example/lucernepublishing/jobs/5520391'},
      {title: 'Junior Developer, Digital', location: 'Remote', platform: 'LinkedIn', link: 'https://linkedin.example/jobs/view/3981204417'},
    ]}},
  {company: 'Tailspin Toys', title: 'Full Stack Developer', platform: 'Indeed',
    events: [{at: ['10-02', '19:40'], kind: 'applied', subject: 'Indeed Application: Full Stack Developer', sender: 'Indeed'}],
    jd: {source: 'email_link', platform: 'Indeed', link: 'https://indeed.example/viewjob?jk=7c1e9a24f0b3', summary: 'A full stack developer for the commerce team, building the storefront and checkout in React and Node.js. Most of the work is customer-facing features before the holidays. Store staff tools come after.', location: 'Denver, CO', workplace: 'hybrid', salary: '$85,000–$105,000', mustHaves: ['React and a server-side language', 'SQL', '1 or more years building web apps'], niceToHaves: ['E-commerce or payments', 'Performance work on a busy site'], fullText: TAILSPIN_POSTING}},
  {company: 'Trey Research', title: 'Data Engineer I', platform: 'Breezy',
    events: [applied('10-01', '15:05', 'Trey Research', 'Thanks for applying to Trey Research'), {at: ['10-01', '15:06'], kind: 'verification', subject: 'Confirm your email address', sender: 'Breezy'}],
    jd: 'not_found'},
  {company: 'Northwind Talent', title: 'Software Engineer I', platform: 'Greenhouse',
    events: [
      {at: ['10-01', '11:26'], kind: 'applied', subject: 'Thank you for applying to Northwind Talent', sender: 'Northwind Recruiting', mail: true},
      {at: ['10-01', '11:31'], kind: 'verification', subject: 'Verify your email', sender: 'Greenhouse'},
      {at: ['10-07', '07:12'], kind: 'interview', subject: 'Interview availability for Software Engineer I', sender: 'Priya Raman', line: 'Pick a 30-minute interview slot this week', mail: true},
    ],
    jd: {source: 'platform', platform: 'Greenhouse', link: 'https://greenhouse.example/northwindtalent/jobs/4471029', foundAt: ['10-01', '10:41'],
      summary: 'A new-grad engineer for the hiring-platform team, shipping TypeScript features end to end. Most of the work is the candidate-facing web app and its API. Shipped side projects count for more than coursework.',
      location: 'Irvine, CA', workplace: 'hybrid', workplaceDetail: '3 days', salary: '$95,000–$115,000',
      mustHaves: ['TypeScript and React', 'An API you built', 'SQL', 'A CS degree or equivalent experience'],
      niceToHaves: ['Node.js on the server', 'Tests in CI', 'Hiring or HR software'], fullText: NORTHWIND_POSTING}},
  {company: 'Humongous Insurance', title: 'Software Engineer II, Claims', platform: 'iCIMS',
    events: [applied('09-30', '14:12', 'Humongous Insurance', 'Thank you for applying'), {at: ['09-30', '14:13'], kind: 'account', subject: 'Your candidate account is ready', sender: 'Humongous Insurance'}],
    jd: {source: 'search', platform: null, link: 'https://humongous.example/careers/jobs/2026-0917', foundAt: ['09-30', '14:18'],
      summary: 'An engineer for the claims platform team, building the services adjusters use to open, review and settle claims. Most of the work is Java services and the APIs behind the claims web app.',
      location: 'United States', workplace: 'remote', salary: null,
      mustHaves: ['Java or another JVM language', 'REST APIs in production', 'SQL', '2 or more years of professional experience'],
      niceToHaves: ['Insurance or claims software', 'Spring Boot', 'Deploying to a cloud'], fullText: HUMONGOUS_CLAIMS_POSTING}},
  {company: 'Humongous Insurance', title: 'Software Engineer II (Java)', platform: 'iCIMS',
    events: [applied('09-28', '09:50', 'Humongous Insurance', 'Thank you for applying')],
    jd: posting('Humongous Insurance', 'Software Engineer II (Java)', {source: 'search', platform: null, link: 'https://humongous.example/careers/jobs/2026-0874', location: 'Hartford, CT', workplace: 'hybrid', salary: '$98,000–$118,000'})},
  {company: 'Litware', title: 'QA Engineer', platform: 'Ashby',
    events: [applied('09-21', '13:00', 'Litware', 'Thanks for applying to Litware'), {at: ['10-02', '10:15'], kind: 'assessment', subject: 'Your Litware case study', sender: 'Litware', line: 'Case study due Oct 12'}],
    jd: posting('Litware', 'QA Engineer', {source: 'platform', platform: 'Ashby', link: 'https://ashby.example/litware/3f6e2a10', location: 'Raleigh, NC', workplace: 'remote', salary: '$76,000–$90,000'})},
  {company: 'Contoso Pharmaceuticals', title: 'Associate Software Engineer', platform: 'iCIMS',
    events: [applied('09-16', '11:00', 'Contoso Pharmaceuticals'), rejected('10-05', '16:40', 'Contoso Pharmaceuticals', 'Your application to Contoso Pharmaceuticals')],
    jd: {source: 'search', platform: null, link: 'https://contosopharma.example/careers/associate-software-engineer', summary: 'An associate engineer for the lab tools team, building the internal web app lab teams use every day and its services. Small team, close to the scientists who use it.', location: 'San Diego, CA', workplace: 'hybrid', salary: '$78,000–$92,000', mustHaves: ['A CS degree or equivalent experience', 'JavaScript or TypeScript', 'SQL'], niceToHaves: ['Python', 'Lab or healthcare software'], fullText: CONTOSO_PHARMA_POSTING}},
  {company: 'City Power & Light', title: 'IT Technician II', platform: 'GovernmentJobs', account: 'Business',
    events: [applied('09-14', '20:10', 'City Power & Light', 'Application received: IT Technician II'), {at: ['10-05', '09:30'], kind: 'interview', subject: 'Interview scheduled: IT Technician II', sender: 'City Power & Light', line: 'Interview Tue Oct 13, 2:00 PM'}],
    jd: posting('City Power & Light', 'IT Technician II', {source: 'search', platform: null, link: 'https://governmentjobs.example/cityofpower/jobs/4412093', location: 'Sacramento, CA', workplace: 'on_site', salary: '$68,400–$83,200'})},
  {company: 'Woodgrove Bank', title: 'Application Developer', platform: 'Workday',
    events: [
      applied('08-31', '12:00', 'Woodgrove Bank'),
      {at: ['09-15', '10:20'], kind: 'interview', subject: 'Next steps with Woodgrove Bank', sender: 'Woodgrove Bank', line: 'Phone screen Thu Sep 17, 11:00 AM'},
      {at: ['09-24', '15:45'], kind: 'interview', subject: 'Your interviews with Woodgrove Bank', sender: 'Woodgrove Bank', line: 'Interviews Tue Sep 29, 9:00 AM'},
      {at: ['10-06', '17:05'], kind: 'offer', subject: 'Your offer from Woodgrove Bank', sender: 'Woodgrove Bank', line: 'Offer, reply by Oct 16'},
    ],
    jd: {source: 'search', platform: null, link: 'https://woodgrovebank.example/careers/application-developer-31877', summary: 'An application developer for the digital banking team, building account and payments features in C# and TypeScript. A senior engineer mentors you for the first six months.', location: 'Charlotte, NC', workplace: 'hybrid', workplaceDetail: '2 days', salary: '$88,000–$104,000', mustHaves: ['C#, Java or TypeScript in real projects', 'SQL and a relational database', 'Git and code review'], niceToHaves: ['Containers', 'Payments or banking'], fullText: WOODGROVE_POSTING}},
  {company: 'Alpine Ski House', title: 'Web Developer', platform: 'Workable',
    events: [applied('08-27', '18:22', 'Alpine Ski House')], byHand: {status: 'withdrawn', at: ['09-10', '19:30']},
    jd: posting('Alpine Ski House', 'Web Developer', {source: 'search', platform: null, link: 'https://apply.workable.example/alpine-ski-house/j/8D0B47F1', location: 'Boulder, CO', workplace: 'on_site', salary: '$64,000–$76,000'})},
  {company: 'Proseware', title: 'Software Engineer, Platform', platform: 'Lever',
    events: [applied('08-20', '09:15', 'Proseware', 'Thanks for applying to Proseware')],
    jd: posting('Proseware', 'Software Engineer, Platform', {source: 'platform', platform: 'Lever', link: 'https://lever.example/proseware/9a41c7e2-5d0b', location: 'Remote, US', workplace: 'remote', salary: '$105,000–$125,000'})},
  {key: 'relecloud-1', company: 'Relecloud', title: 'Support Engineer', platform: 'Greenhouse',
    events: [applied('07-22', '10:05', 'Relecloud'), rejected('09-02', '13:30', 'Relecloud', 'Update on your Relecloud application')], jd: null},
  {company: 'Fourth Coffee', title: 'Software Developer', platform: 'SuccessFactors',
    events: [applied('07-08', '16:00', 'Fourth Coffee'), rejected('07-29', '09:10', 'Fourth Coffee')], jd: null},
  // Its rejection isn't in mail: the Inbox's Northwind email of Mar 14 is about another role.
  {company: 'Northwind Talent', title: 'Junior Developer', platform: 'Greenhouse',
    events: [applied('02-09', '10:00', 'Northwind Talent'), rejected('03-14', '15:30', 'Northwind Talent', 'Update on your Northwind application')], jd: null},
];

/**
 * The 45 the table leaves out (D319), each [company, title, platform, applied, rejected or withdrawn
 * by hand]. Mostly Ghosted or Rejected; six still at Applied inside 30 days, so 18 of Applied's 31
 * are Ghosted. Wingtip Toys' two, Adventure Works' and Margie's Travel's are the ones From history
 * names.
 */
type Older = [company: string, title: string, platform: string, applied: [string, string], end?: {rejected: string} | {withdrawn: string}];
const OLDER: Older[] = [
  ['Coho Winery', 'Junior Software Engineer', 'Lever', ['05-12', '10:30'], {rejected: '06-03'}],
  ['Margie\'s Travel', 'Associate Developer', 'Greenhouse', ['06-02', '09:40']],
  ['Blue Yonder Airlines', 'Software Engineer I', 'Workday', ['06-20', '11:15'], {rejected: '07-14'}],
  ['School of Fine Art', 'Web Developer', 'SmartRecruiters', ['07-01', '16:50']],
  ['Tailwind Traders', 'Associate Developer', 'Greenhouse', ['07-20', '08:45'], {rejected: '08-12'}],
  ['A. Datum Corporation', 'Software Engineer', 'Lever', ['07-24', '13:20']],
  ['Wingtip Toys', 'Frontend Developer', 'Greenhouse', ['07-27', '10:05']],
  ['Wingtip Toys', 'Backend Developer', 'Greenhouse', ['07-28', '15:40']],
  ['VanArsdel', 'Software Developer', 'Workday', ['07-29', '12:10'], {rejected: '08-20'}],
  ['Adventure Works', 'Junior Web Developer', 'Workable', ['07-30', '09:25']],
  ['Southridge Video', 'Junior Developer', 'Ashby', ['07-31', '17:35']],
  ['Lamna Healthcare', 'Software Engineer', 'Greenhouse', ['08-03', '11:00']],
  ['First Up Consultants', 'Associate Developer', 'iCIMS', ['08-04', '14:30'], {rejected: '08-25'}],
  ['Nod Publishers', 'Junior Developer', 'Greenhouse', ['08-05', '10:15']],
  ['Fincher Architects', 'Web Developer', 'Workable', ['08-07', '19:05'], {rejected: '09-01'}],
  ['Consolidated Messenger', 'Software Engineer I', 'Workday', ['08-10', '09:00']],
  ['Best For You Organics', 'Full Stack Developer', 'Lever', ['08-11', '13:45'], {rejected: '08-28'}],
  ['The Phone Company', 'Support Engineer', 'iCIMS', ['08-12', '16:20']],
  ['Munson\'s Pickles and Preserves Farm', 'IT Support Specialist', 'Indeed', ['08-13', '11:30'], {rejected: '09-03'}],
  ['Lakeshore Retail', 'Software Developer', 'SuccessFactors', ['08-14', '10:40']],
  ['Blue Yonder Airlines', 'Data Engineer', 'Workday', ['08-15', '09:55'], {rejected: '09-08'}],
  ['Tailwind Traders', 'Software Engineer', 'Greenhouse', ['08-18', '12:00']],
  ['Zava', 'Frontend Engineer', 'Ashby', ['08-24', '10:20'], {withdrawn: '09-04'}],
  ['VanArsdel', 'Junior Developer', 'Workday', ['08-25', '15:00']],
  ['Liberty\'s Delightful Sinful Bakery & Cafe', 'Web Developer', 'Indeed', ['08-26', '18:10'], {rejected: '09-15'}],
  ['Lamna Healthcare', 'Data Analyst', 'Greenhouse', ['08-30', '11:45']],
  ['A. Datum Corporation', 'Junior Developer', 'Lever', ['09-01', '09:30']],
  ['Southridge Video', 'Software Engineer', 'Ashby', ['09-02', '14:05'], {rejected: '09-23'}],
  ['Coho Winery', 'IT Technician', 'Indeed', ['09-02', '16:40']],
  ['First Up Consultants', 'Software Engineer I', 'iCIMS', ['09-03', '10:50'], {rejected: '09-24'}],
  ['Nod Publishers', 'Web Developer', 'Greenhouse', ['09-04', '13:15'], {rejected: '09-25'}],
  ['Consolidated Messenger', 'Support Engineer', 'Workday', ['09-07', '10:10'], {rejected: '09-21'}],
  ['The Phone Company', 'Network Technician', 'iCIMS', ['09-08', '12:30'], {rejected: '09-29'}],
  ['Zava', 'Software Engineer', 'Ashby', ['09-09', '09:20'], {rejected: '09-30'}],
  ['Best For You Organics', 'Data Analyst', 'Lever', ['09-10', '15:55'], {rejected: '10-02'}],
  ['Lakeshore Retail', 'IT Support Specialist', 'SuccessFactors', ['09-11', '11:05'], {rejected: '09-28'}],
  ['Tailwind Traders', 'Junior Developer', 'Greenhouse', ['09-17', '13:40']],
  ['Fincher Architects', 'Software Developer', 'Workable', ['09-22', '10:00'], {rejected: '10-06'}],
  ['VanArsdel', 'Application Developer', 'Workday', ['09-23', '14:25']],
  ['Munson\'s Pickles and Preserves Farm', 'Software Engineer', 'Indeed', ['09-24', '09:35'], {rejected: '10-01'}],
  ['School of Fine Art', 'Developer', 'SmartRecruiters', ['09-25', '16:15'], {rejected: '10-05'}],
  ['A. Datum Corporation', 'Support Engineer', 'Lever', ['09-26', '11:50']],
  // Sunday Sep 27, so the table's top rows stay as board 32 draws them.
  ['Lamna Healthcare', 'Junior Developer', 'Greenhouse', ['09-27', '10:30']],
  ['Southridge Video', 'Web Developer', 'Ashby', ['09-27', '14:45']],
  ['Coho Winery', 'Software Developer', 'Lever', ['09-27', '19:20']],
];

const OLDER_CANDIDATES: Record<string, SeedCandidate[]> = {
  'Adventure Works': [
    {title: 'Junior Web Developer', location: 'Bothell, WA', platform: 'Workable', link: 'https://apply.workable.example/adventure-works/j/5C21A9E0'},
    {title: 'Web Developer, Junior', location: 'Remote', platform: 'LinkedIn', link: 'https://linkedin.example/jobs/view/3870211904'},
  ],
  'Margie\'s Travel': [
    {title: 'Associate Developer', location: 'Chicago, IL', platform: 'Greenhouse', link: 'https://greenhouse.example/margiestravel/jobs/3301847'},
    {title: 'Associate Software Developer', location: 'Remote', platform: 'LinkedIn', link: 'https://linkedin.example/jobs/view/3712094381'},
    {title: 'Associate Developer, Bookings', location: 'Chicago, IL', platform: 'Indeed', link: 'https://indeed.example/viewjob?jk=2b90d4e1c7a8'},
  ],
};

const PLACES: [string, JobWorkplace, string | null][] = [
  ['Seattle, WA', 'hybrid', '$80,000–$96,000'], ['Remote, US', 'remote', null], ['Austin, TX', 'on_site', '$72,000–$88,000'],
  ['Portland, OR', 'hybrid', '$76,000–$90,000'], ['Chicago, IL', 'remote', '$70,000–$85,000'], ['Boston, MA', 'hybrid', null],
];

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function olderApplication([company, title, platform, appliedOn, end]: Older, index: number): SeedApplication {
  const events: SeedEvent[] = [applied(appliedOn[0], appliedOn[1], company)];
  if (end && 'rejected' in end) events.push(rejected(end.rejected, '10:00', company));
  const closedBeforeSeptember = end && 'rejected' in end && appliedOn[0] < '09-01';
  const [location, workplace, salary] = PLACES[index % PLACES.length]!;
  const source: JdSource = ['Greenhouse', 'Lever', 'Ashby'].includes(platform) ? 'platform' : platform === 'Indeed' ? 'email_link' : 'search';
  const host = source === 'search' ? `${slug(company)}.example/careers` : `${slug(platform)}.example/${slug(company)}`;
  return {
    company, title, platform,
    events,
    ...(end && 'withdrawn' in end ? {byHand: {status: 'withdrawn' as const, at: [end.withdrawn, '20:00'] as [string, string]}} : {}),
    // Closed before Jobs looked: none (D311); From history's two wait as candidates; the rest found.
    jd: OLDER_CANDIDATES[company] && !end ? {candidates: OLDER_CANDIDATES[company]} : closedBeforeSeptember ? null
      : posting(company, title, {source, platform: source === 'search' ? null : platform, link: `https://${host}/${slug(title)}-${1000 + index}`, location, workplace, salary}),
  };
}

interface SeedNeedsYou {
  kind: NeedsYouKind;
  reason: NeedsYouReason;
  fromHistory?: true;
  company: string;
  title?: string;
  platform?: string;
  subject?: string;
  sender?: string;
  eventKind?: JobEventKind;
  line?: string;
  // The email's date, or for a JD to confirm its application's (found by company and title).
  at?: [string, string];
  createdAt: [string, string];
}

/** Needs you (34a), as they came, and From history (34b), newest first. */
const NEEDS_YOU: SeedNeedsYou[] = [
  {kind: 'jd_to_confirm', reason: 'unsure_posting', company: 'Lucerne Publishing', title: 'Junior Developer', platform: 'Greenhouse', createdAt: ['10-05', '10:24']},
  {kind: 'update_to_assign', reason: 'matches_several', company: 'Humongous Insurance', title: 'Software Engineer II', platform: 'iCIMS',
    subject: 'Thank you for your interest in the Software Engineer II role', sender: 'Humongous Insurance', eventKind: 'rejection', at: ['10-06', '13:05'], createdAt: ['10-06', '13:06']},
  {kind: 'email_to_track', reason: 'no_application', company: 'Wide World Importers', title: 'Junior Software Engineer', platform: 'LinkedIn',
    subject: 'Can we set up a call this week?', sender: 'Wide World Importers', eventKind: 'interview', line: 'A call this week', at: ['10-07', '08:12'], createdAt: ['10-07', '08:13']},
  {kind: 'update_to_assign', reason: 'names_other_role', fromHistory: true, company: 'Relecloud', title: 'Support Specialist', platform: 'Greenhouse',
    subject: 'Thanks for your interest in the Support Specialist role', sender: 'Relecloud', eventKind: 'rejection', at: ['08-30', '11:20'], createdAt: ['10-01', '20:14']},
  {kind: 'update_to_assign', reason: 'names_no_role', fromHistory: true, company: 'Wingtip Toys', platform: 'Greenhouse',
    subject: 'Your application to Wingtip Toys', sender: 'Wingtip Toys', eventKind: 'rejection', at: ['08-03', '16:45'], createdAt: ['10-01', '20:14']},
  {kind: 'jd_to_confirm', reason: 'unsure_posting', fromHistory: true, company: 'Adventure Works', title: 'Junior Web Developer', platform: 'Workable', createdAt: ['10-01', '20:14']},
  {kind: 'email_to_track', reason: 'no_application', fromHistory: true, company: 'Graphic Design Institute',
    subject: 'Next steps: online assessment', sender: 'Graphic Design Institute', eventKind: 'assessment', at: ['07-14', '09:05'], createdAt: ['10-01', '20:14']},
  {kind: 'email_to_track', reason: 'no_application', fromHistory: true, company: 'Bellows College',
    subject: 'Schedule your phone screen', sender: 'Bellows College', eventKind: 'interview', at: ['06-18', '14:30'], createdAt: ['10-01', '20:14']},
  {kind: 'jd_to_confirm', reason: 'unsure_posting', fromHistory: true, company: 'Margie\'s Travel', title: 'Associate Developer', platform: 'Greenhouse', createdAt: ['10-01', '20:14']},
];

/**
 * The Indeed match email (mail's sample) and the Inbox's two older Northwind rejections: read, making
 * nothing. The match email is kept as the reader keeps one (its event, company and role), so mail
 * shows Applied before on it (J7, board 37c).
 */
const IGNORED_MAIL: {subject: string; at: [string, string]; match?: {company: string; title: string}}[] = [
  {subject: 'Associate Software Engineer @ Contoso Pharmaceuticals', at: ['09-15', '06:05'], match: {company: 'Contoso Pharmaceuticals', title: 'Associate Software Engineer'}},
  {subject: 'Update on your application', at: ['03-14', '15:22']},
  {subject: 'Your application for Data Engineer Intern', at: ['03-03', '09:41']},
];

/** Every application the seed makes, the table's first. */
export const SEED_APPLICATIONS: SeedApplication[] = [...TABLE, ...OLDER.map(olderApplication)];

/** Loads Jobs's sample, turned on and reading Jobs and Business (D310). Mail's sample must be in first. */
export function seedJobs({sqlite, db: mailDb}: {sqlite: Database.Database; db: Store['db']}) {
  migrateJobs(sqlite);
  const db = jobsDb(sqlite);
  const mail = {db: mailDb};
  const accounts = accountsByLabel(mail);
  const turnedOn = at('10-01', '18:02');
  const ids = new Map<string, number>();
  const byRole = new Map<string, number>();
  const appliedAts = new Map<number, string>();
  const readMessages = new Map<number, {outcome: 'application' | 'event' | 'ignored'; at: string; match?: {company: string; title: string}}>();

  sqlite.transaction(() => {
    db.insert(j.jobsSettings).values({
      id: 1, enabled: true, enabledAt: turnedOn, updatedAt: turnedOn,
      accounts: [{account_id: accounts.get('Jobs')!, reads: 'every'}, {account_id: accounts.get('Business')!, reads: 'career'}],
    }).run();
    // The history pass ran when Jobs was turned on and finished at 8:14 PM (board 39a), over the 330
    // emails the brief counts in the Jobs account since May; the sample keeps only what it made.
    db.insert(j.jobsHistory).values({id: 1, state: 'done', before: turnedOn, startedAt: turnedOn, total: 330, read: 330, finishedAt: at('10-01', '20:14')}).run();

    // Oldest first, so a re-application's earlier one is there to link to.
    const ordered = [...SEED_APPLICATIONS].sort((a, b) => at(...a.events[0]!.at).localeCompare(at(...b.events[0]!.at)));
    for (const application of ordered) {
      const events = application.events.map(event => ({...event, instant: at(...event.at)}));
      const appliedAt = events[0]!.instant;
      const loud = events.filter(event => !isQuietJobEvent(event.kind));
      const last = loud.at(-1)!;
      let status: JobStatus = STATUS_OF_JOB_EVENT[last.kind as keyof typeof STATUS_OF_JOB_EVENT];
      let statusSetAt = last.instant;
      if (application.byHand) {
        status = application.byHand.status;
        statusSetAt = at(...application.byHand.at);
      }
      const step = status === 'in_process' ? last.line ?? null : null;
      const jd = application.jd;
      const row = db.insert(j.jobsApplications).values({
        company: application.company, title: application.title, titleKey: titleKey(application.title), platform: application.platform,
        accountId: accounts.get(application.account ?? 'Jobs') ?? null, appliedAt, status, statusSetBy: application.byHand ? 'user' : 'email', statusSetAt,
        step, stepAt: step ? last.instant : null, reappliedFromId: application.reappliedFrom ? ids.get(application.reappliedFrom)! : null,
        jdLookup: jd === 'not_found' ? 'not_found' : jd && 'candidates' in jd ? 'candidates' : 'none',
        jdLookupAt: jd === null ? null : minutesAfter(appliedAt, 4 + (jd !== 'not_found' && 'candidates' in jd ? 0 : 3)),
        createdAt: appliedAt, updatedAt: statusSetAt,
      }).returning({id: j.jobsApplications.id}).get();
      if (application.key) ids.set(application.key, row.id);
      byRole.set(`${application.company}|${application.title}`, row.id);
      appliedAts.set(row.id, appliedAt);

      for (const event of events) {
        const messageId = event.mail ? findMessage(mail, mailSubject(event.subject), event.instant) : null;
        if (event.mail && messageId === null) throw new Error(`The Inbox's email "${event.subject}" isn't in mail's sample.`);
        if (messageId !== null) readMessages.set(messageId, {outcome: event.kind === 'applied' ? 'application' : 'event', at: event.instant});
        db.insert(j.jobsEvents).values({
          applicationId: row.id, at: event.instant, kind: event.kind, sender: event.sender ?? application.company, subject: event.subject,
          line: event.line ?? null, messageId, createdAt: event.instant,
        }).run();
      }
      if (application.byHand) db.insert(j.jobsHandSet).values({applicationId: row.id, field: 'status', setAt: statusSetAt}).run();
      if (jd && jd !== 'not_found') {
        if ('candidates' in jd) {
          jd.candidates.forEach((candidate, position) => db.insert(j.jobsJdCandidates).values({
            applicationId: row.id, ...candidate, position, foundAt: minutesAfter(appliedAt, 4),
          }).run());
        } else {
          db.insert(j.jobsPostings).values({
            applicationId: row.id, fullText: jd.fullText, summary: jd.summary, location: jd.location, workplace: jd.workplace,
            workplaceDetail: jd.workplaceDetail ?? null, salary: jd.salary, mustHaves: jd.mustHaves, niceToHaves: jd.niceToHaves, link: jd.link,
            source: jd.source, platform: jd.platform, foundAt: jd.foundAt ? at(...jd.foundAt) : minutesAfter(appliedAt, 6),
          }).run();
        }
      }
    }

    for (const item of NEEDS_YOU) {
      const applicationId = item.kind === 'jd_to_confirm' ? byRole.get(`${item.company}|${item.title}`)! : null;
      const appliedAt = applicationId ? appliedAts.get(applicationId)! : null;
      db.insert(j.jobsNeedsYou).values({
        kind: item.kind, reason: item.reason, fromHistory: item.fromHistory ?? false, applicationId, company: item.company, title: item.title ?? null,
        platform: item.platform ?? null, subject: item.subject ?? null, sender: item.sender ?? null, eventKind: item.eventKind ?? null, line: item.line ?? null,
        accountId: accounts.get('Jobs') ?? null, at: item.at ? at(...item.at) : appliedAt!, messageId: null, createdAt: at(...item.createdAt),
      }).run();
    }

    for (const {subject, at: when, match} of IGNORED_MAIL) {
      const messageId = findMessage(mail, subject, at(...when));
      if (messageId === null) throw new Error(`The Inbox's email "${subject}" isn't in mail's sample.`);
      readMessages.set(messageId, {outcome: 'ignored', at: at(...when), match});
    }
    // Read by the history pass when Jobs was turned on, or within a minute of arriving after it.
    for (const [messageId, {outcome, at: received, match}] of readMessages) {
      db.insert(j.jobsEmailsRead).values({
        messageId, readAt: received > turnedOn ? minutesAfter(received, 1) : turnedOn, outcome,
        ...(match ? {at: received, event: 'match' as const, company: match.company, title: match.title, titleKey: titleKey(match.title)} : {}),
      }).run();
    }
  })();
  return {applications: SEED_APPLICATIONS.length, now: SEED_NOW};
}

/** The Inbox's own subject for an event whose copy words it differently (the board's Northwind confirmation). */
function mailSubject(subject: string) {
  return subject === 'Thank you for applying to Northwind Talent' ? 'Thanks for applying' : subject;
}
