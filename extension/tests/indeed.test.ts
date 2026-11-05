// Indeed's readers against trimmed Indeed pages (SV-202): the job pane, the list's cards, and what a
// page expects to read, which the toolbar's badge goes by. In Chromium, as Indeed's page is.
import {beforeEach, describe, expect, test} from 'vitest';
import {expects, jobKeyOf, readCards, readPage, readPane} from '../src/indeed.ts';
import search from './fixtures/indeed-search.html?raw';
import view from './fixtures/indeed-view.html?raw';

const SEARCH = 'https://www.indeed.com/jobs?q=software+engineer&l=Redmond%2C+WA&vjk=a1b2c3d4e5f60002';
const VIEW = 'https://www.indeed.com/viewjob?jk=a1b2c3d4e5f60009';

function open(html: string) {
  document.body.innerHTML = html;
}

/** A posting as read, with its line's words in place of the line. */
const plain = (posting: {jobId: string; company: string; title: string; line: Element} | null) =>
  posting && {jobId: posting.jobId, company: posting.company, title: posting.title, line: `${posting.line.tagName} ${posting.line.textContent?.trim()}`};

/** Shows another job in the pane, as Indeed redraws it in place. */
function showInPane(title: string, company: string) {
  document.querySelector('[data-testid="vj-job-title"]')!.textContent = title;
  document.querySelector('[data-testid="company-info-metadata"] a')!.textContent = company;
}

describe('the job open', () => {
  beforeEach(() => open(search));

  test.each([
    [SEARCH, 'a1b2c3d4e5f60002'],
    [VIEW, 'a1b2c3d4e5f60009'],
    ['https://www.indeed.com/viewjob?jk=a1b2c3d4e5f60009&from=serp&vjs=3', 'a1b2c3d4e5f60009'],
    // A job's own page goes by its jk, a search by its vjk.
    ['https://www.indeed.com/viewjob?vjk=a1b2c3d4e5f60007&jk=a1b2c3d4e5f60009', 'a1b2c3d4e5f60009'],
    ['https://www.indeed.com/jobs?q=x&jk=a1b2c3d4e5f60009&vjk=a1b2c3d4e5f60007', 'a1b2c3d4e5f60007'],
    // The home feed and a search not yet in the address: the card pressed.
    ['https://www.indeed.com/', 'a1b2c3d4e5f60002'],
    ['https://www.indeed.com/jobs?q=x&vjk=not-a-key', 'a1b2c3d4e5f60002'],
  ])('%s is %s', (url, key) => {
    expect(jobKeyOf(new URL(url))).toBe(key);
  });

  test('is none with no key in the address and no card pressed', () => {
    document.querySelector('[aria-pressed="true"]')!.setAttribute('aria-pressed', 'false');
    expect(jobKeyOf(new URL('https://www.indeed.com/'))).toBeNull();
  });
});

describe('the job pane', () => {
  beforeEach(() => open(search));

  test('is read from its header once it shows the open card\'s job, its chip after the title', () => {
    expect(plain(readPane('a1b2c3d4e5f60002'))).toEqual({jobId: 'a1b2c3d4e5f60002', company: 'Fabrikam, LLC', title: 'Software Engineer I', line: 'H5 Software Engineer I'});
  });

  test('isn\'t read while it still shows the last job, at another company', () => {
    expect(readPane('a1b2c3d4e5f60001')).toBeNull();
  });

  test('isn\'t read while it still shows the last job at the same company', () => {
    expect(readPane('a1b2c3d4e5f60004')).toBeNull();
  });

  test('isn\'t read while it still shows the last job under the same title, at another company', () => {
    showInPane('Data Engineer', 'Contoso');
    expect(readPane('a1b2c3d4e5f60004')).toBeNull();
  });

  test('is read once it shows the job clicked', () => {
    showInPane('Data Engineer', 'Fabrikam, LLC');
    expect(readPane('a1b2c3d4e5f60004')?.title).toBe('Data Engineer');
  });

  test('is read as it is for a job with no card on the page', () => {
    expect(readPane('a1b2c3d4e5f60099')?.title).toBe('Software Engineer I');
  });

  test('isn\'t read while its header has no title', () => {
    document.querySelector('[data-testid="vj-job-title"]')!.textContent = '';
    expect(readPane('a1b2c3d4e5f60002')).toBeNull();
  });

  test('reads a company with no page of its own, named in a line rather than a link', () => {
    const link = document.querySelector('[data-testid="company-info-metadata"] a')!;
    const line = document.createElement('div');
    line.dir = 'ltr';
    line.textContent = 'Fabrikam, LLC';
    link.replaceWith(line);
    expect(readPane('a1b2c3d4e5f60002')?.company).toBe('Fabrikam, LLC');
  });

  test('on a job\'s own page, with no cards to hold it to', () => {
    open(view);
    expect(plain(readPane('a1b2c3d4e5f60009'))).toEqual({jobId: 'a1b2c3d4e5f60009', company: 'Tailspin Toys', title: 'Junior Developer', line: 'H5 Junior Developer'});
  });

  test('reads the same with its chip drawn after the title', () => {
    const line = readPane('a1b2c3d4e5f60002')!.line;
    line.append(chipHost());
    expect(readPane('a1b2c3d4e5f60002')?.line).toBe(line);
  });
});

describe('the list\'s cards', () => {
  beforeEach(() => open(search));

  test('are read from their job keys, past the hidden made-up card and the carousel, the chip after the company', () => {
    expect(readCards().map(plain)).toEqual([
      {jobId: 'a1b2c3d4e5f60001', company: 'Northwind Traders', title: 'Support Analyst', line: 'DIV Northwind Traders'},
      {jobId: 'a1b2c3d4e5f60002', company: 'Fabrikam, LLC', title: 'Software Engineer I', line: 'DIV Fabrikam, LLC'},
      {jobId: 'a1b2c3d4e5f60003', company: 'Wide World Importers', title: 'Frontend Developer (React)', line: 'DIV Wide World Importers'},
      {jobId: 'a1b2c3d4e5f60004', company: 'Fabrikam, LLC', title: 'Data Engineer', line: 'DIV Fabrikam, LLC'},
    ]);
  });

  test('skip the made-up card for being hidden, even with a title of its own', () => {
    document.querySelector('[data-jk="a1b2c3d4e5f6beef"] span')!.id = 'jobTitle-a1b2c3d4e5f6beef';
    expect(readCards().map(card => card.jobId)).not.toContain('a1b2c3d4e5f6beef');
  });

  test('read the same with their chips drawn after the company', () => {
    for (const card of readCards()) card.line.append(chipHost());
    expect(readCards().map(card => card.company)).toEqual(['Northwind Traders', 'Fabrikam, LLC', 'Wide World Importers', 'Fabrikam, LLC']);
  });

  test('aren\'t there on a job\'s own page', () => {
    open(view);
    expect(readCards()).toEqual([]);
  });
});

describe('what a page expects to read', () => {
  test.each([
    [SEARCH, {pane: true, cards: true}],
    // A search with no results opens no job.
    ['https://www.indeed.com/jobs?q=nothing', {pane: false, cards: false}],
    [VIEW, {pane: true, cards: false}],
    ['https://www.indeed.com/viewjob', {pane: false, cards: false}],
    // The home feed draws its cards as it likes: their chips are drawn when they read, but not expected.
    ['https://www.indeed.com/', {pane: false, cards: false}],
    ['https://www.indeed.com/q-software-engineer-jobs.html', {pane: false, cards: false}],
    ['https://www.indeed.com/cmp/Fabrikam', {pane: false, cards: false}],
  ])('%s', (url, expected) => {
    expect(expects(new URL(url))).toEqual(expected);
  });

  test('a search that reads leaves nothing unread', () => {
    open(search);
    const page = readPage(new URL(SEARCH));
    expect([page.unread, page.pane?.title, page.cards.length]).toEqual([null, 'Software Engineer I', 4]);
  });

  test('a pane Indeed changed leaves the pane unread', () => {
    open(search);
    document.querySelector('[data-testid="vj-job-title"]')!.removeAttribute('data-testid');
    expect(readPage(new URL(SEARCH)).unread).toBe('pane');
  });

  test('cards Indeed changed leave the cards unread, and the pane read as it is', () => {
    open(search);
    for (const name of document.querySelectorAll('[data-testid="company-name"]')) name.removeAttribute('data-testid');
    const page = readPage(new URL(SEARCH));
    expect([page.unread, page.pane?.title]).toEqual(['cards', 'Software Engineer I']);
  });

  test('both changed leave both unread', () => {
    open(search);
    for (const link of document.querySelectorAll('[data-jk]')) link.removeAttribute('data-jk');
    document.querySelector('[data-testid="desktop-job-header"]')!.removeAttribute('data-testid');
    expect(readPage(new URL(SEARCH)).unread).toBe('both');
  });

  test('a job\'s own page that reads leaves nothing unread', () => {
    open(view);
    expect(readPage(new URL(VIEW)).unread).toBeNull();
  });

  test('the home feed reads its cards and the pane for the card pressed', () => {
    open(search);
    const page = readPage(new URL('https://www.indeed.com/'));
    expect([page.unread, page.pane?.jobId, page.cards.length]).toEqual([null, 'a1b2c3d4e5f60002', 4]);
  });
});

/** A chip's host as the content script draws it: its words are in its shadow root, out of the line's text. */
function chipHost(): HTMLElement {
  const host = document.createElement('setpoint-chip');
  host.attachShadow({mode: 'open'}).textContent = 'Applied Oct 28 · In process';
  return host;
}
