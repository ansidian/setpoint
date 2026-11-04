// The readers against trimmed LinkedIn pages (SV-174): the job pane, the list's cards, and what a
// page expects to read, which the toolbar's badge goes by. In Chromium, as LinkedIn's page is.
import {beforeEach, describe, expect, test} from 'vitest';
import {expects, jobIdOf, readCards, readPage, readPane} from '../src/linkedin.ts';
import search from './fixtures/search.html?raw';
import view from './fixtures/view.html?raw';

const SEARCH = 'https://www.linkedin.com/jobs/search-results/?currentJobId=4100000002&keywords=software';
const VIEW = 'https://www.linkedin.com/jobs/view/4100000009/';

function open(html: string, title: string) {
  document.body.innerHTML = html;
  document.title = title;
}

/** A posting as read, with its line's words in place of the line. */
const plain = (posting: {jobId: string; company: string; title: string; line: Element} | null) =>
  posting && {jobId: posting.jobId, company: posting.company, title: posting.title, line: `${posting.line.tagName} ${posting.line.textContent?.trim()}`};

describe('the job open', () => {
  test.each([
    ['https://www.linkedin.com/jobs/search-results/?currentJobId=4100000002&keywords=x', '4100000002'],
    ['https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4100000007', '4100000007'],
    ['https://www.linkedin.com/jobs/view/4100000009/', '4100000009'],
    ['https://www.linkedin.com/jobs/view/4100000009/?trackingId=abc', '4100000009'],
    ['https://www.linkedin.com/jobs/search-results/?currentJobId=abc', null],
    ['https://www.linkedin.com/jobs/', null],
    ['https://www.linkedin.com/feed/', null],
  ])('%s is %s', (url, id) => {
    expect(jobIdOf(new URL(url))).toBe(id);
  });
});

describe('the job pane', () => {
  beforeEach(() => open(search, 'Software Engineer I | Fabrikam | LinkedIn'));

  test('is read from the company\'s label for this job and the page\'s title, its chip after the title', () => {
    expect(plain(readPane('4100000002'))).toEqual({jobId: '4100000002', company: 'Fabrikam', title: 'Software Engineer I', line: 'P Software Engineer I'});
  });

  test('reads through LinkedIn\'s notification count in the title', () => {
    document.title = '(3) Software Engineer I | Fabrikam | LinkedIn';
    expect(readPane('4100000002')?.title).toBe('Software Engineer I');
  });

  test('isn\'t read while the title still names the last job, at another company', () => {
    document.title = 'Support Analyst | Northwind Traders | LinkedIn';
    expect(readPane('4100000002')).toBeNull();
  });

  test('isn\'t read while the title still names the last job at the same company, whose card holds it', () => {
    document.title = 'Data Engineer | Fabrikam | LinkedIn';
    expect(readPane('4100000002')).toBeNull();
  });

  test('isn\'t read onto the last job\'s card, should its title stand there alone', () => {
    // Were LinkedIn to drop the screen readers' copy, the card's title line would be the title exactly.
    document.querySelector('[componentkey="job-card-component-ref-4100000005"] [aria-hidden="true"]')!.remove();
    document.title = 'Data Engineer | Fabrikam | LinkedIn';
    expect(readPane('4100000002')).toBeNull();
  });

  test('isn\'t read while it still shows the last job: the label is keyed to another', () => {
    expect(readPane('4100000005')).toBeNull();
  });

  test('keeps a company\'s own full stop, taking only the label\'s', () => {
    document.querySelector('[aria-label^="Company, "]')!.setAttribute('aria-label', 'Company, Proseware, Inc..');
    document.title = 'Software Engineer I | Proseware, Inc. | LinkedIn';
    expect(readPane('4100000002')?.company).toBe('Proseware, Inc.');
  });

  test('on a job\'s own page, its title a line rather than a link', () => {
    open(view, 'Junior Developer | Tailspin Toys | LinkedIn');
    expect(plain(readPane('4100000009'))).toEqual({jobId: '4100000009', company: 'Tailspin Toys', title: 'Junior Developer', line: 'P Junior Developer'});
  });

  test('reads the same with its chip drawn after the title', () => {
    const line = readPane('4100000002')!.line;
    line.append(chipHost());
    expect(readPane('4100000002')?.line).toBe(line);
  });
});

describe('the list\'s cards', () => {
  beforeEach(() => open(search, 'Software Engineer I | Fabrikam | LinkedIn'));

  test('are read once each, the title from Dismiss, past "Selected, …" and "… (Verified job)", the company the line after', () => {
    expect(readCards().map(plain)).toEqual([
      {jobId: '4100000001', company: 'Northwind Traders', title: 'Support Analyst', line: 'P Northwind Traders'},
      {jobId: '4100000002', company: 'Fabrikam', title: 'Software Engineer I', line: 'P Fabrikam'},
      {jobId: '4100000003', company: 'Wide World Importers', title: 'Frontend Developer (React)', line: 'P Wide World Importers'},
      {jobId: '4100000004', company: 'Proseware, Inc.', title: 'Full Stack Engineer, Payments Platform', line: 'P Proseware, Inc.'},
      {jobId: '4100000005', company: 'Fabrikam', title: 'Data Engineer', line: 'P Fabrikam'},
    ]);
  });

  test('read the same with their chips drawn after the company', () => {
    for (const card of readCards()) card.line.append(chipHost());
    expect(readCards().map(card => card.company)).toEqual(['Northwind Traders', 'Fabrikam', 'Wide World Importers', 'Proseware, Inc.', 'Fabrikam']);
  });

  test('aren\'t there on a job\'s own page', () => {
    open(view, 'Junior Developer | Tailspin Toys | LinkedIn');
    expect(readCards()).toEqual([]);
  });

  test('skip a card with no Dismiss to name it', () => {
    document.querySelector('[aria-label="Dismiss Support Analyst job"]')!.remove();
    expect(readCards().map(card => card.jobId)).not.toContain('4100000001');
  });
});

describe('what a page expects to read', () => {
  test.each([
    [SEARCH, {pane: true, cards: true}],
    ['https://www.linkedin.com/jobs/search/?currentJobId=4100000002', {pane: true, cards: true}],
    // A search with no results opens no job.
    ['https://www.linkedin.com/jobs/search-results/?keywords=nothing', {pane: false, cards: false}],
    [VIEW, {pane: true, cards: false}],
    // Collections may draw their cards otherwise: their chips are drawn when they read, but not expected.
    ['https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4100000002', {pane: true, cards: false}],
    ['https://www.linkedin.com/jobs/', {pane: false, cards: false}],
    ['https://www.linkedin.com/feed/', {pane: false, cards: false}],
  ])('%s', (url, expected) => {
    expect(expects(new URL(url))).toEqual(expected);
  });

  test('a search that reads leaves nothing unread', () => {
    open(search, 'Software Engineer I | Fabrikam | LinkedIn');
    const page = readPage(new URL(SEARCH));
    expect([page.unread, page.pane?.title, page.cards.length]).toEqual([null, 'Software Engineer I', 5]);
  });

  test('a pane LinkedIn changed leaves the pane unread', () => {
    open(search, 'Software Engineer I | Fabrikam | LinkedIn');
    for (const label of document.querySelectorAll('[aria-label^="Company, "]')) label.setAttribute('aria-label', 'Fabrikam');
    expect(readPage(new URL(SEARCH)).unread).toBe('pane');
  });

  test('cards LinkedIn changed leave the cards unread', () => {
    open(search, 'Software Engineer I | Fabrikam | LinkedIn');
    for (const card of document.querySelectorAll('[componentkey^="job-card-component-ref-"]')) card.setAttribute('componentkey', 'job-card-4100000001');
    expect(readPage(new URL(SEARCH)).unread).toBe('cards');
  });

  test('both changed leave both unread', () => {
    open(search, 'Jobs | LinkedIn');
    for (const button of document.querySelectorAll('[aria-label^="Dismiss "]')) button.setAttribute('aria-label', 'Hide');
    expect(readPage(new URL(SEARCH)).unread).toBe('both');
  });

  test('a job\'s own page that reads leaves nothing unread', () => {
    open(view, 'Junior Developer | Tailspin Toys | LinkedIn');
    expect(readPage(new URL(VIEW)).unread).toBeNull();
  });

  test('a page that isn\'t a job\'s expects nothing', () => {
    open('<main><p>Home</p></main>', 'Feed | LinkedIn');
    expect(readPage(new URL('https://www.linkedin.com/feed/')).unread).toBeNull();
  });
});

/** A chip's host as the content script draws it: its words are in its shadow root, out of the line's text. */
function chipHost(): HTMLElement {
  const host = document.createElement('setpoint-chip');
  host.attachShadow({mode: 'open'}).textContent = 'Applied Oct 28 · In process';
  return host;
}
