// Jobs (J5; DESIGN.md › Jobs, boards 32, 32b, 33, 34c, 36a, 36b, 38b, 40) against the seed's sample
// (BRIEF.md › Sample data › Jobs): the shell's item and `4`, the two numbers and the table, Needs you
// drawn read-only with From history unfolding, an application's detail, J / K, the full posting, Look
// it up on Trey Research, search (humongous, kubernetes by its JD, wide world loosely), the status
// filter, a narrow window at 1024, Esc's order, an event opening its email, a `jobs` event landing a
// row, and board 40's Light. Per week's chart, the status control and the posting's unfolding are the
// component tests' (web/tests/components/jobs.test.tsx); search's ranking is the server's tables.
// A change to Jobs arrives as the reader's will: the server's database changes, then a `jobs` live
// event names an application (here, Look it up on Trey Research sends one).
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {ApplicationOut, JobsPageOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {layout} from '../../src/tokens.ts';
import {cleanUp, rested, startSetpoint, test, until, watch} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** The seed's applications by company and role. */
async function applicationId(setpoint: Setpoint, company: string, title: string): Promise<number> {
  const {rows} = await setpoint.api<JobsPageOut>('GET', '/jobs');
  const found = rows.find(row => row.company === company && row.title === title);
  if (!found) throw new Error(`No application ${company} · ${title}.`);
  return found.id;
}

const row = (page: Page, id: number) => page.locator(`.jb-tr[data-application="${id}"]`);
const rows = (page: Page) => page.locator('.jb-scroll .jb-tr');
const companies = (page: Page) => page.locator('.jb-scroll .jb-tr .co').allTextContents();

/** A colour as the page computes it, to compare with a computed style. */
const colourOf = (page: Page, colour: string) => page.evaluate(value => {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed;
}, colour);

/** A background as the page computes it. */
const fillOf = (page: Page, fill: string) => page.evaluate(value => {
  const probe = document.body.appendChild(document.createElement('i'));
  probe.style.background = value;
  const computed = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return computed;
}, fill);

/** Changes Jobs in the server's own database, as its reader would. */
function jobsChange(setpoint: Setpoint, sql: string) {
  const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000');
    database.exec(sql);
  } finally {
    database.close();
  }
}

// Wide World's interview, tracked: an application the seed leaves in Needs you (34c).
const WIDE_WORLD = `INSERT INTO jobs_applications (company, title, title_key, platform, applied_at, status, status_set_by, status_set_at, step, step_at, first_seen_in_email, jd_lookup, created_at, updated_at)
  VALUES ('Wide World Importers', 'Junior Software Engineer', 'junior software engineer', 'LinkedIn', '2026-10-07T15:12:00.000Z', 'in_process', 'email', '2026-10-07T15:12:00.000Z',
    'Set up a call this week', '2026-10-07T15:12:00.000Z', 1, 'none', '2026-10-07T15:12:00.000Z', '2026-10-07T15:12:00.000Z')`;

test('board 32: Jobs under News with its Needs you count, `4`, the two numbers, Needs you and the table newest first', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    // The shell: Jobs under News, its count the Needs you count in ink2, never caution (D313).
    assert.deepEqual(await page.locator('aside.sb .nav').allTextContents(), ['Inbox319', 'Calendar', 'News', 'Jobs3', 'Settings⌘,']);
    const item = page.locator('aside.sb .nav.jobs');
    assert.equal(await item.getAttribute('title'), 'Jobs · 3 need you');
    assert.equal(await rested(() => item.locator('.cnt').evaluate(count => getComputedStyle(count).color)), await rested(() => colourOf(page, 'var(--ink2)')));

    await page.keyboard.press('4');
    await page.locator('.jb-scroll .jb-tr').first().waitFor();
    assert.equal(new URL(page.url()).pathname, '/jobs');
    assert.equal(await page.title(), 'Jobs');
    assert.equal(await page.locator('aside.sb .nav.on').textContent(), 'Jobs3');

    // The two numbers (D314): the status filter's counts, and Per week with this week outlined (D318).
    assert.equal(await page.locator('.hd .hd-title').textContent(), 'Jobs');
    assert.deepEqual(await page.locator('.hd .jb-status button').allTextContents(), ['All62', 'Applied31', 'In process3', 'Offer1', 'Rejected25', 'Withdrawn2']);
    assert.equal(await page.locator('.jb-week .bars > i').count(), 12);
    assert.deepEqual(await page.locator('.jb-week .bars > i.now').evaluateAll(bars => bars.map(bar => bar.dataset.week)), ['2026-10-04']);
    assert.equal(await page.locator('.jb-week').textContent(), 'Per week3 this week');
    assert.equal(await page.getByRole('textbox', {name: 'Search jobs'}).getAttribute('placeholder'), 'Search jobs');

    // Needs you, each kind as 34a draws it; its actions drawn but J6's.
    assert.equal(await page.locator('.jb-band .gh').textContent(), 'Needs you 3');
    assert.deepEqual(await page.locator('.jb-need .l1').allTextContents(), [
      'Lucerne Publishing · Junior Developer· Is this the posting?',
      'Thank you for your interest in the Software Engineer II role· Humongous Insurance via iCIMS',
      'Can we set up a call this week?· Wide World Importers',
    ]);
    assert.deepEqual(await page.locator('.jb-need .acts .line').allTextContents(), ['A rejection · it could be either Humongous application', 'An interview request with no application']);
    assert.deepEqual(await page.locator('.jb-need .jb-cand').allTextContents(), ['Junior Developer · New York, NY · Greenhouse', 'Junior Developer, Digital · Remote · LinkedIn', 'None of these']);
    assert.deepEqual(await page.locator('.jb-need .jb-inert').evaluateAll(buttons => buttons.map(button => [button.textContent, button.getAttribute('aria-disabled')])),
      [['Assign to…', 'true'], ['Not about a job', 'true'], ['Track this', 'true'], ['Not about a job', 'true']]);

    // From history, folded until a click (D311).
    const fold = page.locator('.jb-fold-t');
    assert.equal(await fold.textContent(), 'From history 6· what the history pass wasn’t sure of');
    assert.equal(await fold.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.jb-hist-wrap').getAttribute('inert'), '');
    await fold.click();
    await until('From history unfolded', () => page.locator('.jb-hist').evaluateAll(all => all.filter(row => row.getBoundingClientRect().height > 0 && !row.closest('[inert]')).length), count => count === 6);
    assert.equal(await page.locator('.jb-hist').first().textContent(), 'Thanks for your interest in the Support Specialist role · Relecloud · names a role neither application hasAug 30Assign to…Not about a job');
    assert.equal(await page.locator('.jb-fold .btn').textContent(), 'Dismiss all');

    // The table: every application, newest first by Applied (D314), its status with Ghosted and the step (D309).
    assert.equal(await rows(page).count(), 62);
    assert.deepEqual((await companies(page)).slice(0, 6), ['Fabrikam', 'Relecloud', 'Lucerne Publishing', 'Tailspin Toys', 'Trey Research', 'Northwind Talent']);
    assert.deepEqual(await page.locator('.jb-th .h').allTextContents(), ['Company', 'Role', 'Platform', 'Applied', 'Status', 'JD']);
    const status = async (company: string, title: string) => row(page, await applicationId(setpoint, company, title)).locator('.st').textContent();
    assert.equal(await status('Northwind Talent', 'Software Engineer I'), 'In process· Pick a 30-minute interview slot this week');
    assert.equal(await status('Relecloud', 'Support Engineer'), 'Applied· Re-applied, rejected Sep 2');
    assert.equal(await status('Proseware', 'Software Engineer, Platform'), 'Ghosted· no email in 48 days');
    assert.equal(await status('Woodgrove Bank', 'Application Developer'), 'Offer· Oct 6');
    const alpine = row(page, await applicationId(setpoint, 'Alpine Ski House', 'Web Developer'));
    assert.equal(await alpine.locator('.st .by').getAttribute('title'), 'Set by you on Sep 10 · only an email that sets a status changes it');
    // Closed and Ghosted rows step down a shade, never in opacity.
    const fabrikam = row(page, await applicationId(setpoint, 'Fabrikam', 'Data Analyst'));
    const [open, closed] = await rested(() => Promise.all([fabrikam, alpine].map(one => one.locator('.co').evaluate(cell => [getComputedStyle(cell).color, getComputedStyle(cell.parentElement!).opacity]))));
    assert.deepEqual([open, closed], [[await rested(() => colourOf(page, 'var(--ink)')), '1'], [await rested(() => colourOf(page, 'var(--ink2)')), '1']]);
    // The JD column: how it was found, or where it stands; nothing for a closed one from history (D311).
    const jd = async (company: string, title: string) => {
      const cell = row(page, await applicationId(setpoint, company, title)).locator('.jd');
      return [await cell.textContent(), await cell.getAttribute('title')];
    };
    assert.deepEqual(await jd('Northwind Talent', 'Software Engineer I'), ['Greenhouse', 'Greenhouse · found Oct 1']);
    assert.deepEqual(await jd('Lucerne Publishing', 'Junior Developer'), ['In Needs you', '2 candidates in Needs you']);
    assert.deepEqual(await jd('Trey Research', 'Data Engineer I'), ['No JD found', 'No JD found']);
    assert.deepEqual(await jd('Tailspin Toys', 'Full Stack Developer'), ['The email\'s link', 'The email\'s link · found Oct 2']);
    assert.deepEqual(await jd('Northwind Talent', 'Junior Developer'), ['', null]);

    // A header sorts by it, and again flips it.
    await page.locator('.jb-th .h', {hasText: 'Company'}).click();
    await until('A to Z', () => companies(page).then(all => all[0]), first => first === 'A. Datum Corporation');
    assert.equal(await page.locator('.jb-th .h.on').textContent(), 'Company');
    await page.locator('.jb-th .h', {hasText: 'Company'}).click();
    await until('Z to A', () => companies(page).then(all => all[0]), first => first === 'Zava');
    await page.locator('.jb-th .h', {hasText: 'Applied'}).click();
    await until('newest first', () => companies(page).then(all => all[0]), first => first === 'Fabrikam');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an application opens where the reading pane sits: Platform drops and JD is a glyph, its head, its JD, its timeline and Applied before, and O its posting', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const northwind = await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I');
    const before = await applicationId(setpoint, 'Northwind Talent', 'Junior Developer');
    await page.goto(`${setpoint.base}/jobs`);
    await row(page, northwind).click();
    await page.locator('.jb-pane .jb-want').waitFor();
    assert.equal(new URL(page.url()).pathname, `/jobs/${northwind}`);
    assert.equal(await page.title(), 'Software Engineer I · Northwind Talent');
    assert.equal((await rested(() => page.locator('.jb-pane').boundingBox()))!.width, layout.readingPane);
    assert.match(await row(page, northwind).getAttribute('class') ?? '', /\bopen\b/);
    // Beside the detail, Platform drops and JD is its glyph alone, its words in the tooltip.
    assert.equal(await page.locator('.jb-th .h.c-plat').isVisible(), false);
    assert.equal(await row(page, northwind).locator('.pl').isVisible(), false);
    assert.equal(await row(page, northwind).locator('.jd .t').isVisible(), false);
    assert.equal(await row(page, northwind).locator('.jd .icon').isVisible(), true);

    // The head, then the JD first (D307).
    const pane = page.locator('.jb-pane');
    assert.equal(await pane.locator('.jb-co').textContent(), 'Northwind Talent· via GreenhouseJobs· Applied Oct 1');
    assert.equal(await pane.locator('.rd-subj').textContent(), 'Software Engineer I');
    assert.equal(await pane.locator('.jb-stat').textContent(), 'In processPick a 30-minute interview slot this week· 2h');
    assert.match(await pane.locator('.jb-want').textContent() ?? '', /^A new-grad engineer for the hiring-platform team/);
    assert.deepEqual(await pane.locator('.jb-body > .jb-facts > span').allTextContents(), ['Irvine, CA', 'Hybrid, 3 days', '$95,000–$115,000']);
    assert.deepEqual(await pane.locator('.jb-lists .jb-label').allTextContents(), ['Must-haves 4', 'Nice-to-haves 3']);
    assert.equal(await pane.locator('.jb-src').textContent(), 'Full posting· Found on Greenhouse · Oct 1, 10:41 AMgreenhouse.exampleShow');
    // The timeline, oldest first (D317); then Applied before at the company (D306).
    assert.deepEqual(await pane.locator('.jb-ev').allTextContents(), [
      'Oct 1AppliedThank you for applying to Northwind Talent', 'Oct 1Verify your email', 'TodayInterviewInterview availability for Software Engineer I',
    ]);
    assert.equal(await pane.locator('.jb-before').textContent(), 'Junior Developer· Applied Feb 9Rejected Mar 14');

    // O opens the posting's link in a new tab (the platform answered here, never the real web).
    await page.context().route('https://greenhouse.example/**', route => route.fulfill({contentType: 'text/html', body: '<title>Posting</title>'}));
    const opened = page.waitForEvent('popup');
    await page.keyboard.press('o');
    assert.equal((await opened).url(), 'https://greenhouse.example/northwindtalent/jobs/4471029');

    // Applied before opens that application.
    await pane.locator('.jb-before').click();
    await until('the earlier application', () => page.title(), title => title === 'Junior Developer · Northwind Talent');
    assert.equal(new URL(page.url()).pathname, `/jobs/${before}`);
    await pane.locator('.jb-nojd').waitFor();
    assert.equal(await pane.locator('.jb-nojd').textContent(), 'Not looked up · it was closed before Jobs read itLook it up');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('J / K move through Needs you\'s items, then the rows; Enter opens one, and with one open they open the next and the one before', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [fabrikam, relecloud] = [await applicationId(setpoint, 'Fabrikam', 'Data Analyst'), await applicationId(setpoint, 'Relecloud', 'Support Engineer')];
    await page.goto(`${setpoint.base}/jobs`);
    // The pointer on the header's title, over no item or row.
    await page.mouse.move(290, 28);
    const cursor = () => page.locator('.jb-scroll .cur').evaluateAll(all => all.map(one => (one as HTMLElement).dataset.key));
    await page.keyboard.press('j');
    await until('the first item', cursor, keys => keys.length === 1 && keys[0]!.startsWith('n:'));
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await until('the first row', cursor, keys => keys[0] === `r:${fabrikam}`);
    await page.keyboard.press('k');
    await until('back on the last item', cursor, keys => keys[0]!.startsWith('n:'));
    await page.keyboard.press('j');
    await until('the first row again', cursor, keys => keys[0] === `r:${fabrikam}`);
    await page.keyboard.press('Enter');
    await until('Fabrikam open', () => page.title(), title => title === 'Data Analyst · Fabrikam');
    await page.keyboard.press('j');
    await until('the next one open', () => page.title(), title => title === 'Support Engineer · Relecloud');
    assert.equal(new URL(page.url()).pathname, `/jobs/${relecloud}`);
    assert.match(await row(page, relecloud).getAttribute('class') ?? '', /\bopen\b/);
    await page.keyboard.press('k');
    await until('the one before', () => page.title(), title => title === 'Data Analyst · Fabrikam');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Esc goes back a step at a time: it folds the full posting, then closes the detail, then clears the search, then leaves it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const northwind = await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I');
    await page.goto(`${setpoint.base}/jobs/${northwind}`);
    await page.locator('.jb-pane .jb-src').waitFor();
    // Board 33: Show unfolds the posting's own words in place, under its head.
    await page.locator('.jb-src .tool', {hasText: 'Show'}).click();
    await page.locator('.jb-fullhead').waitFor();
    assert.equal(await page.locator('.jb-fullhead').textContent(), 'Full posting· Software Engineer I · Northwind TalentCollapse');
    assert.equal(await page.locator('.jb-full h3').first().textContent(), 'About the team');

    await page.keyboard.press('Escape');
    await page.locator('.jb-pane .jb-src').waitFor();
    assert.equal(await page.locator('.jb-pane').count(), 1, 'the detail stays');
    await page.keyboard.press('Escape');
    await until('the detail closed', () => page.locator('.jb-pane').count(), count => count === 0);
    assert.equal(new URL(page.url()).pathname, '/jobs');
    assert.equal(await page.title(), 'Jobs');

    // `/` turns the header into Search; Esc clears the query, then leaves search.
    await page.keyboard.press('/');
    await until('Search', () => page.locator('.hd .hd-title').textContent(), title => title === 'Search');
    assert.equal(await page.locator('.hd .jb-status, .hd .jb-week').count(), 0);
    await page.keyboard.type('humongous');
    await until('its results', () => rows(page).count(), count => count === 2);
    await page.keyboard.press('Escape');
    await until('the query cleared', () => page.getByRole('textbox', {name: 'Search jobs'}).inputValue(), value => value === '');
    assert.equal(await page.locator('.hd .hd-title').textContent(), 'Search');
    await until('the table back under it', () => rows(page).count(), count => count === 62);
    await page.keyboard.press('Escape');
    await until('Jobs again', () => page.locator('.hd .hd-title').textContent(), title => title === 'Jobs');
    assert.equal(await page.locator('.hd .jb-status').count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('search (36a, 36b): humongous gives both applications, kubernetes Woodgrove by its JD with the line, and wide world Wide World Importers', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    jobsChange(setpoint, WIDE_WORLD);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    await page.getByRole('textbox', {name: 'Search jobs'}).click();
    await until('Search', () => page.locator('.hd .hd-title').textContent(), title => title === 'Search');
    await page.keyboard.type('humongous');
    await until('both Humongous applications', () => page.locator('.jb-scroll .jb-tr .ro').allTextContents(),
      roles => roles.join() === 'Software Engineer II, Claims,Software Engineer II (Java)');
    assert.equal(await page.locator('.jb-scroll > .gh').textContent(), 'Company or role 2');
    assert.deepEqual(await page.locator('.jb-scroll .jb-tr .co mark.hl').allTextContents(), ['Humongous', 'Humongous']);
    // Needs you folds away while a query is in.
    assert.equal(await page.locator('.jb-band').getAttribute('inert'), '');

    await page.getByRole('textbox', {name: 'Search jobs'}).fill('kubernetes');
    await until('Woodgrove, by its JD', () => companies(page), found => found.join() === 'Woodgrove Bank');
    assert.equal(await page.locator('.jb-none').textContent(), 'No company or role matches “kubernetes”');
    assert.equal(await page.locator('.jb-scroll > .gh').textContent(), 'In a job description 1');
    assert.equal(await page.locator('.jb-tr.two .snip').textContent(), 'Full posting · “…our services run on Kubernetes across two regions, so you’ll pick it up from day one…”');
    assert.deepEqual(await page.locator('.jb-tr.two .snip mark.hl').allTextContents(), ['Kubernetes']);

    // Loose on company names (decision 62).
    await page.getByRole('textbox', {name: 'Search jobs'}).fill('wide world');
    await until('Wide World Importers', () => companies(page), found => found.join() === 'Wide World Importers');
    assert.deepEqual(await page.locator('.jb-scroll .jb-tr .co mark.hl').allTextContents(), ['Wide', 'World']);
    // Enter hands the keys to the results, the cursor on the first; Enter again opens it.
    await page.keyboard.press('Enter');
    await until('the cursor on it', () => page.locator('.jb-scroll .jb-tr.cur .co').textContent(), company => company === 'Wide World Importers');
    await page.keyboard.press('Enter');
    await until('it open', () => page.title(), title => title === 'Junior Software Engineer · Wide World Importers');
    assert.equal(await page.locator('.jb-pane .jb-first').textContent(), 'First seen in this email, so Applied is its date');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the status filter: In process shows its three, and All all 62', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    await page.locator('.jb-status button', {hasText: 'In process'}).click();
    await until('In process alone', () => companies(page), found => found.join() === 'Northwind Talent,Litware,City Power & Light');
    assert.deepEqual(await page.locator('.jb-scroll .jb-tr .sl').allTextContents(), ['In process', 'In process', 'In process']);
    assert.equal(await page.locator('.jb-status button.on').textContent(), 'In process3');
    await page.locator('.jb-status button', {hasText: 'Withdrawn'}).click();
    await until('Withdrawn alone', () => rows(page).count(), count => count === 2);
    await page.locator('.jb-status button', {hasText: 'All'}).click();
    await until('every application', () => rows(page).count(), count => count === 62);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Look it up on Trey Research: No JD found becomes the lookup under way, in the detail and its row (38b, 34c)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const trey = await applicationId(setpoint, 'Trey Research', 'Data Engineer I');
    await page.goto(`${setpoint.base}/jobs/${trey}`);
    const pane = page.locator('.jb-pane');
    await pane.locator('.jb-nojd').waitFor();
    assert.equal(await pane.locator('.jb-nojd').textContent(), 'No JD found · Breezy and a web search had nothing for it on Oct 1Look it up');
    // No posting link: no Open posting.
    assert.equal(await pane.locator('.rd-tools .tool').count(), 0);
    await pane.getByRole('button', {name: 'Look it up'}).click();
    await pane.locator('.jb-src.looking').waitFor();
    assert.equal(await pane.locator('.jb-src.looking').textContent(), 'Looking for the posting…· Breezy, then the platforms, then search');
    assert.equal(await pane.locator('[data-skeleton="jobs-jd"] .sk-bar').count(), 4);
    await until('its row looking', () => row(page, trey).locator('.jd').getAttribute('title'), title => title === 'Looking for the posting');
    await setpoint.idle();
    assert.equal((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${trey}`)).jd.state, 'looking');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an event opens its email in the mail reader; one whose email is gone keeps its line and opens nothing', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const northwind = await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I');
    const detail = await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${northwind}`);
    const interview = detail.timeline.find(event => event.kind === 'interview')!;
    await page.goto(`${setpoint.base}/jobs/${northwind}`);
    const events = page.locator('.jb-pane .jb-ev');
    await events.first().waitFor();
    // The verification email isn't in mail: its line stays, and it isn't a control.
    assert.deepEqual(await events.evaluateAll(all => all.map(one => one.tagName)), ['BUTTON', 'DIV', 'BUTTON']);
    await events.nth(2).click();
    await until('the email', () => Promise.resolve(new URL(page.url()).pathname), pathname => pathname === `/inbox/${interview.message_id}`);
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a narrow window, at 1024 (32b): Jobs in the rail with a neutral badge, the header keeping both numbers, and the detail over the table led by Back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const [width, height] = [1024, 768];
    const page = await setpoint.page({width, height});
    const [northwind, humongous] = [await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I'), await applicationId(setpoint, 'Humongous Insurance', 'Software Engineer II, Claims')];
    await page.goto(`${setpoint.base}/jobs`);
    // The rail's slot after News, its count a 16 px badge placed as the Inbox's, but neutral (D325).
    assert.deepEqual(await page.locator('.sb .nav').evaluateAll(links => links.map(link => link.getAttribute('title'))), ['Inbox', 'Calendar', 'News', 'Jobs · 3 need you', 'Settings · ⌘,']);
    const [slot, badge, attention] = await rested(() => Promise.all([page.locator('.sb .nav.jobs').boundingBox(), page.locator('.sb .nav.jobs .cnt').boundingBox(), page.locator('.sb .nav .apill').boundingBox()]));
    assert.deepEqual([badge!.height, badge!.y - slot!.y, badge!.x + badge!.width - (slot!.x + slot!.width)], [attention!.height, 2, 2]);
    assert.deepEqual(await rested(() => page.locator('.sb .nav.jobs .cnt').evaluate(count => [getComputedStyle(count).backgroundColor, getComputedStyle(count).color])),
      [await rested(() => fillOf(page, 'var(--sub4)')), await rested(() => colourOf(page, 'var(--ink)'))]);
    // The header: both numbers stay, Per week without its label, the search field giving way first.
    assert.equal(await page.locator('.jb-week .lbl').isVisible(), false);
    assert.equal(await page.locator('.jb-status').isVisible(), true);
    const field = (await rested(() => page.locator('.hd .search').boundingBox()))!;
    assert.ok(field.width < layout.mailSearch, `the field gives way: ${field.width}`);
    assert.equal(await page.evaluate(() => document.querySelector('.hd')!.scrollWidth <= document.querySelector('.hd')!.clientWidth), true, 'the header holds');

    // The detail lies over the table under the header, led by Back.
    await row(page, northwind).click();
    await page.locator('.jb-pane .jb-want').waitFor();
    assert.deepEqual(await rested(() => page.locator('.jb-pane').boundingBox()), {x: layout.rail, y: layout.header, width: width - layout.rail, height: height - layout.header});
    const back = page.locator('.jb-pane .rd-back');
    assert.deepEqual([await back.isVisible(), await back.getAttribute('title')], [true, 'Back · Esc']);
    await page.keyboard.press('j');
    await until('the next one', () => Promise.resolve(new URL(page.url()).pathname), pathname => pathname === `/jobs/${humongous}`);
    await page.keyboard.press('Escape');
    await until('the detail gone', () => page.locator('.jb-pane').count(), count => count === 0);
    await row(page, northwind).click();
    await back.click();
    await until('Back closes it', () => page.locator('.jb-pane').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a `jobs` event: an application that lands takes its place and settles from sub2, and a row an email moves on crossfades its status and settles', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [tailspin, trey] = [await applicationId(setpoint, 'Tailspin Toys', 'Full Stack Developer'), await applicationId(setpoint, 'Trey Research', 'Data Engineer I')];
    await page.goto(`${setpoint.base}/jobs`);
    const classes = await watch(row(page, tailspin), 'class');
    // Every row that lands, with its classes as it's drawn.
    await page.locator('.jb-scroll').evaluate(scroller => {
      const seen: string[] = [];
      (window as unknown as {landed: string[]}).landed = seen;
      new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
        if (node instanceof HTMLElement && node.matches('.jb-tr')) seen.push(`${node.querySelector('.co')?.textContent}: ${node.className}`);
      }))).observe(scroller, {childList: true});
    });
    jobsChange(setpoint, `${WIDE_WORLD};
      UPDATE jobs_applications SET status = 'in_process', status_set_at = '2026-10-07T16:00:00.000Z', step = 'Interview Fri Oct 9, 10:00 AM', step_at = '2026-10-07T16:00:00.000Z' WHERE id = ${tailspin}`);
    // Any `jobs` event refreshes the page: Look it up sends one.
    await setpoint.api('POST', `/jobs/applications/${trey}/lookup`);
    await until('Wide World landed at its date, the newest', () => companies(page).then(all => all.slice(0, 2)), first => first.join() === 'Wide World Importers,Fabrikam');
    assert.deepEqual(await page.evaluate(() => (window as unknown as {landed: string[]}).landed), ['Wide World Importers: jb-tr landed']);
    await until('Tailspin moved on', () => row(page, tailspin).locator('.st').textContent(), text => text === 'In process· Interview Fri Oct 9, 10:00 AM');
    assert.ok((await classes()).some(value => value?.split(' ').includes('moved') && value.split(' ').includes('landed')), 'it crossfaded and settled');
    await until('both settled', () => page.locator('.jb-tr.landed, .jb-tr.moved').count(), count => count === 0);
    assert.equal(await page.locator('.jb-status button.on').textContent(), 'All63');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 40: Jobs in Light takes the theme\'s tokens, Offer in Light good and the open row\'s bar the accent', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [northwind, woodgrove] = [await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I'), await applicationId(setpoint, 'Woodgrove Bank', 'Application Developer')];
    for (const [scheme, theme] of [['light', 'light'], ['dark', 'night']] as const) {
      await page.emulateMedia({colorScheme: scheme});
      await page.goto(`${setpoint.base}/jobs/${northwind}`);
      await page.locator('.jb-pane .jb-want').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      const offer = await rested(() => row(page, woodgrove).locator('.sl').evaluate(label => getComputedStyle(label).color));
      assert.equal(offer, await rested(() => colourOf(page, 'var(--good)')), `${theme}: Offer`);
      const bar = await rested(() => row(page, northwind).evaluate(open => getComputedStyle(open, '::before').backgroundColor));
      assert.equal(bar, await rested(() => fillOf(page, 'var(--accent)')), `${theme}: the open row's bar`);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone has no Jobs: its address opens the Inbox, and its tabs don\'t name it (decision 49)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/jobs`);
    await until('the Inbox', () => Promise.resolve(new URL(page.url()).pathname), pathname => pathname === '/inbox');
    await page.locator('.list .row').first().waitFor();
    assert.deepEqual(await page.locator('.ph-tabs .ph-tab').evaluateAll(tabs => tabs.map(tab => tab.textContent!.replace(/\d+/g, ''))), ['Inbox', 'Agenda']);
    assert.equal(await page.locator('.jb-col, .nav.jobs').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
