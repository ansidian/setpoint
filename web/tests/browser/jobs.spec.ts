// Jobs (J5, J6; DESIGN.md › Jobs, boards 32–36, 38b) against the seed's sample (BRIEF.md › Sample
// data › Jobs): the shell's item and `4`, the two numbers and the table, Needs you with From history
// unfolding, an application's detail, J / K, the full posting, Look it up on Trey Research, search
// (humongous, kubernetes by its JD, wide world loosely), the status filter, Role's width (SV-141), a narrow window at 1024,
// Esc's order, an event opening its email and one whose email is gone, and a `jobs` event landing a
// row. J6: each Needs you kind answered (a pick, None of these, Assign to…, Not about a job,
// Track this, Choose…, Dismiss all) and each correction (the title, the company, Set status and
// Let emails decide, Merge with…, Move to…, Not about this, Not an application, Delete, Not this
// posting, a row's and an event's right-click), each with its toast and Undo, reaching the server.
// SV-140: a pick Jobs can't read, and Paste the posting after a failed pick and after No JD found.
// SV-170: Paste the posting while it's looked up stops the lookup, and the JD's location set in place.
// D401: an item's email opening where the detail sits, and Esc leaving the item unanswered. D402: an
// application's email opening from Assign to…, the menu staying beside it.
// Per week's chart, the status control, the posting's unfolding, the menus' keys, the candidate
// picker and the title's field are the component tests' (web/tests/components/jobs.test.tsx); what
// each correction keeps, and that it sticks, the server's (server/src/jobs/tests/corrections.test.ts).
// A change to Jobs arrives as the reader's will: the server's database changes, then a `jobs` live
// event names an application (here, Look it up on Trey Research sends one).
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {ApplicationOut, JobsNavOut, JobsPageOut, MailCountsOut, MessageOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {layout} from '../../src/tokens.ts';
import {cleanUp, holdToast, matchGolden, point, rested, startSetpoint, test, until} from './harness.ts';
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
    // The full sidebar names it in its own words, so it has no tip; the rail's has (SV-171).
    assert.equal(await item.getAttribute('data-tip'), null);
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

    // Needs you, each kind as 34a draws it.
    assert.equal(await page.locator('.jb-band .gh').textContent(), 'Needs you 3');
    assert.deepEqual(await page.locator('.jb-need .l1').allTextContents(), [
      'Lucerne Publishing · Junior Developer· Is this the posting?',
      'Thank you for your interest in the Software Engineer II role· Humongous Insurance via iCIMS',
      'Can we set up a call this week?· Wide World Importers',
    ]);
    assert.deepEqual(await page.locator('.jb-need .acts .line').allTextContents(), ['A rejection · it could be either Humongous application', 'An interview request with no application']);
    assert.deepEqual(await page.locator('.jb-need .jb-cand').allTextContents(), ['Junior Developer · New York, NY · Greenhouse', 'Junior Developer, Digital · Remote · LinkedIn', 'None of these']);
    assert.deepEqual(await page.locator('.jb-need .acts .btn').allTextContents(), ['Assign to…', 'Not about a job', 'Track this', 'Not about a job']);

    // From history, folded until a click (D311).
    const fold = page.locator('.jb-fold-t');
    assert.equal(await fold.textContent(), 'From history 6· what the history pass wasn\'t sure of');
    assert.equal(await fold.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.jb-hist-wrap').getAttribute('inert'), '');
    await fold.click();
    await until('From history unfolded', () => page.locator('.jb-hist').evaluateAll(all => all.filter(row => row.getBoundingClientRect().height > 0 && !row.closest('[inert]')).length), count => count === 6);
    assert.equal(await page.locator('.jb-hist').first().textContent(), 'Thanks for your interest in the Support Specialist role · Relecloud · names a role neither application hasAug 30Assign to…Not about a job');
    assert.deepEqual(await page.locator('.jb-hist .acts .btn.out').allTextContents(), ['Assign to…', 'Assign to…', 'Choose…', 'Track this', 'Track this', 'Choose…']);
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
    assert.equal(await alpine.locator('.st .by').getAttribute('data-tip'), 'Set by you on Sep 10 · only an email that sets a status changes it');
    // Closed and Ghosted rows step down a shade, never in opacity.
    const fabrikam = row(page, await applicationId(setpoint, 'Fabrikam', 'Data Analyst'));
    const [open, closed] = await rested(() => Promise.all([fabrikam, alpine].map(one => one.locator('.co').evaluate(cell => [getComputedStyle(cell).color, getComputedStyle(cell.parentElement!).opacity]))));
    assert.deepEqual([open, closed], [[await rested(() => colourOf(page, 'var(--ink)')), '1'], [await rested(() => colourOf(page, 'var(--ink2)')), '1']]);
    // The JD column: how it was found, or where it stands; nothing for a closed one from history (D311).
    const jd = async (company: string, title: string) => {
      const cell = row(page, await applicationId(setpoint, company, title)).locator('.jd');
      return [await cell.textContent(), await cell.getAttribute('data-tip')];
    };
    assert.deepEqual(await jd('Northwind Talent', 'Software Engineer I'), ['Greenhouse', 'Greenhouse · found Oct 1']);
    assert.deepEqual(await jd('Lucerne Publishing', 'Junior Developer'), ['In Needs you', '2 candidates in Needs you']);
    // No tip where it would only say the words again (SV-171).
    assert.deepEqual(await jd('Trey Research', 'Data Engineer I'), ['No JD found', null]);
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

    // Board 32 as a whole: Northwind's application open beside the table (J8's page screenshot).
    await page.goto(`${setpoint.base}/jobs/${await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I')}`);
    await page.locator('.jb-pane .jb-want').waitFor();
    await page.mouse.move(0, 0);
    await matchGolden(page, '32-jobs-a-typical-morning');
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
    assert.deepEqual(await pane.locator('.jb-body > .jb-facts > *').allTextContents(), ['Irvine, CA', 'Hybrid, 3 days', '$95,000–$115,000']);
    assert.deepEqual(await pane.locator('.jb-lists .jb-label').allTextContents(), ['Must-haves 4', 'Nice-to-haves 3']);
    assert.equal(await pane.locator('.jb-src').textContent(), 'Full postingFound on Greenhouse · Oct 1, 10:41 AMgreenhouse.exampleShow');
    // The timeline, oldest first (D317); then Applied before at the company (D306).
    assert.deepEqual(await pane.locator('.jb-ev').allTextContents(), [
      'Oct 1AppliedThank you for applying to Northwind Talent', 'Oct 1Verify your email· No longer in Gmail', 'TodayInterviewInterview availability for Software Engineer I',
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
    assert.equal(await page.locator('.jb-fullhead').textContent(), 'Full postingSoftware Engineer I · Northwind TalentCollapse');
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

test('a failed pick (SV-132, SV-140): it says so and Open posting opens it; Paste the posting saves the JD, Undo takes it away, and Full posting shows it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const phone = await applicationId(setpoint, 'The Phone Company', 'Support Engineer');
    const link = 'https://www.glassdoor.example/job-listing/support-engineer-2291';
    await page.goto(`${setpoint.base}/jobs/${phone}`);
    const pane = page.locator('.jb-pane');
    const card = pane.locator('.jb-nojd');
    await card.waitFor();
    assert.equal(await card.textContent(), 'Couldn\'t read the posting you picked · glassdoor.example gave Jobs no text on Aug 12Paste the postingLook it up');
    assert.equal(await pane.locator('.rd-tools a.tool').getAttribute('href'), link);
    // The buttons sit beside the words rather than dropping to a row of their own, and the card holds them.
    const fit = await rested(() => card.evaluate(element => {
      const box = element.getBoundingClientRect();
      const words = element.querySelector('.words')!.getBoundingClientRect();
      const acts = element.querySelector('.acts')!.getBoundingClientRect();
      return {beside: acts.top < words.bottom && acts.left >= words.right, inside: acts.right <= box.right && acts.bottom <= box.bottom};
    }));
    assert.deepEqual(fit, {beside: true, inside: true});
    const pasteButton = pane.getByRole('button', {name: 'Paste the posting'});

    // Esc cancels and stops there: the pane stays.
    await pasteButton.click();
    const area = pane.getByRole('textbox', {name: 'The posting\'s text'});
    await until('the area focused', () => area.evaluate(element => element === document.activeElement), focused => focused);
    assert.equal(await pane.getByRole('button', {name: 'Look it up'}).count(), 0);
    await page.keyboard.press('Escape');
    await until('the area gone', () => area.count(), count => count === 0);
    // The pane, not one closing (it stays drawn, leaving, for its fade).
    assert.equal(await page.locator('.jb-pane:not(.leaving)').count(), 1);

    // Too little is refused in place, the words kept.
    await pasteButton.click();
    await area.fill('Support engineer.');
    await page.keyboard.press('Meta+Enter');
    await pane.getByRole('alert').waitFor();
    assert.equal(await pane.getByRole('alert').textContent(), 'That\'s too short to be a posting, paste its whole text.');
    assert.equal(await area.inputValue(), 'Support engineer.');

    const text = `About the role\n\n${'You answer the phones and fix what the customers ring about, then write down what you learned. '.repeat(4)}`;
    await area.fill(text);
    await pane.getByRole('button', {name: 'Save'}).click();
    await until('the toast', () => toast(page).textContent(), value => value === 'JD saved for The Phone CompanyUndo');
    const full = pane.getByRole('group', {name: 'Full posting'});
    await full.waitFor();
    // Undo while the toast offers it, its text gone with it; pasted again for the rest.
    await undo(page);
    await card.waitFor();
    assert.equal(await card.textContent(), 'Couldn\'t read the posting you picked · glassdoor.example gave Jobs no text on Aug 12Paste the postingLook it up');
    assert.equal(await area.count(), 0);
    await pasteButton.click();
    assert.equal(await area.inputValue(), '');
    await area.fill(text);
    await page.keyboard.press('Meta+Enter');
    await full.waitFor();
    assert.match((await full.textContent())!, /^Full postingPasted by you · Oct 7, \d+:\d\d [AP]Mglassdoor\.exampleShow$/);
    await until('its row', () => row(page, phone).locator('.jd').textContent(), value => value === 'Pasted');
    // Nothing read yet, so nothing claimed: no empty summary, no "Salary not stated", only Add location.
    assert.equal(await pane.locator('.jb-want').count(), 0);
    assert.equal(await pane.locator('.jb-facts').textContent(), 'Add location');
    assert.equal(await pane.locator('.rd-tools a.tool').getAttribute('href'), link);
    await full.getByRole('button', {name: 'Show'}).click();
    await pane.locator('.jb-full').getByText('You answer the phones', {exact: false}).waitFor();
    await pane.getByRole('button', {name: 'Collapse'}).click();
    await full.waitFor();

    // The reading lands: an open detail fills in on the `jobs` event.
    jobsChange(setpoint, `UPDATE jobs_postings SET summary = 'Answering the phones.', salary = '$60,000' WHERE application_id = ${phone}`);
    const trey = await applicationId(setpoint, 'Trey Research', 'Data Engineer I');
    await setpoint.api('POST', `/jobs/applications/${trey}/lookup`);
    await pane.locator('.jb-want').waitFor();
    assert.equal(await pane.locator('.jb-want').textContent(), 'Answering the phones.');
    await pane.locator('.jb-facts').getByText('$60,000').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a candidate Jobs can\'t read says so, and picked it keeps the link rather than say a JD was saved (SV-140)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const margies = await applicationId(setpoint, 'Margie\'s Travel', 'Associate Developer');
    await page.goto(`${setpoint.base}/jobs/${margies}`);
    const pane = page.locator('.jb-pane');
    const candidate = pane.getByRole('radio', {name: /^Associate Software Developer/});
    await candidate.waitFor();
    assert.equal(await candidate.textContent(), 'Associate Software Developer · Remote · LinkedInJobs can\'t read this one');
    await candidate.click();
    await until('the toast', () => toast(page).textContent(), value => value === 'Link kept for Margie\'s TravelUndo');
    await pane.locator('.jb-src.looking').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('No JD found (SV-140): Paste the posting beside Look it up; a posting with no link has no Open posting', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const trey = await applicationId(setpoint, 'Trey Research', 'Data Engineer I');
    await page.goto(`${setpoint.base}/jobs/${trey}`);
    const pane = page.locator('.jb-pane');
    const card = pane.locator('.jb-nojd');
    await card.waitFor();
    assert.equal(await card.textContent(), 'No JD found · Breezy and a web search had nothing for it on Oct 1Look it upPaste the posting');
    await pane.getByRole('button', {name: 'Paste the posting'}).click();
    await pane.getByRole('textbox', {name: 'The posting\'s text'}).fill(`The data team\n\n${'You build the pipelines the analysts rely on, and you keep them running through the night. '.repeat(4)}`);
    await page.keyboard.press('Meta+Enter');
    await until('the toast', () => toast(page).textContent(), value => value === 'JD saved for Trey ResearchUndo');
    await pane.getByRole('group', {name: 'Full posting'}).waitFor();
    assert.equal(await pane.locator('.rd-tools a[data-hint="o"]').count(), 0);
    assert.equal(await pane.getByRole('group', {name: 'Full posting'}).locator('a').count(), 0);
    // A saved JD offers neither.
    assert.equal(await pane.getByRole('button', {name: 'Paste the posting'}).count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Paste the posting while it\'s looked up (SV-170): the lookup stops, Esc leaves it stopped, and the JD pasted takes a location, with Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const trey = await applicationId(setpoint, 'Trey Research', 'Data Engineer I');
    // A run has no web, so its lookup stays under way until it's stopped.
    await setpoint.api('POST', `/jobs/applications/${trey}/lookup`);
    await page.goto(`${setpoint.base}/jobs/${trey}`);
    const pane = page.locator('.jb-pane');
    await pane.locator('.jb-src.looking').waitFor();
    assert.equal(await pane.locator('.jb-src.looking').textContent(), 'Looking for the posting…Breezy, then the platforms, then searchPaste the posting');
    await pane.getByRole('button', {name: 'Paste the posting'}).click();
    const area = pane.getByRole('textbox', {name: 'The posting\'s text'});
    await until('the area focused', () => area.evaluate(element => element === document.activeElement), focused => focused);
    assert.equal(await pane.locator('.jb-nojd').textContent(), 'Lookup stopped · You stopped it on Oct 7');
    await until('stopped on the server', () => setpoint.api<ApplicationOut>('GET', `/jobs/applications/${trey}`), detail => detail.jd.state === 'not_found' && detail.jd.stopped);
    await until('its row', () => row(page, trey).locator('.jd').textContent(), value => value === 'Stopped');

    // Esc leaves it stopped, Paste the posting first.
    await page.keyboard.press('Escape');
    await until('the area gone', () => area.count(), count => count === 0);
    assert.equal(await pane.locator('.jb-nojd').textContent(), 'Lookup stopped · You stopped it on Oct 7Paste the postingLook it up');
    await pane.getByRole('button', {name: 'Paste the posting'}).click();
    await area.fill(`The data team\n\n${'You build the pipelines the analysts rely on, and you keep them running through the night. '.repeat(4)}`);
    await page.keyboard.press('Meta+Enter');
    await until('the toast', () => toast(page).textContent(), value => value === 'JD saved for Trey ResearchUndo');
    await pane.getByRole('group', {name: 'Full posting'}).waitFor();

    // The location, added in place.
    await pane.getByRole('button', {name: 'Add location'}).click();
    await pane.getByRole('textbox', {name: 'Location'}).fill('Austin, TX');
    await page.keyboard.press('Enter');
    await until('the toast', () => toast(page).textContent(), value => value === 'Location setUndo');
    // The pointer rests on it, so its Undo waits while the check reads the server.
    await holdToast(page);
    assert.equal(await pane.locator('.jb-facts').textContent(), 'Austin, TX');
    await until('saved', () => setpoint.api<ApplicationOut>('GET', `/jobs/applications/${trey}`), detail => detail.posting?.location === 'Austin, TX');
    await undo(page);
    await pane.getByRole('button', {name: 'Add location'}).waitFor();
    await until('undone', () => setpoint.api<ApplicationOut>('GET', `/jobs/applications/${trey}`), detail => detail.posting?.location === null);
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
    assert.equal(await pane.locator('.jb-nojd').textContent(), 'No JD found · Breezy and a web search had nothing for it on Oct 1Look it upPaste the posting');
    // No posting link: no Open posting.
    assert.equal(await pane.locator('.rd-tools .tool').count(), 0);
    await pane.getByRole('button', {name: 'Look it up'}).click();
    await pane.locator('.jb-src.looking').waitFor();
    assert.equal(await pane.locator('.jb-src.looking').textContent(), 'Looking for the posting…Breezy, then the platforms, then searchPaste the posting');
    assert.equal(await pane.locator('[data-skeleton="jobs-jd"] .sk-bar').count(), 4);
    await until('its row looking', () => row(page, trey).locator('.jd').textContent(), text => text === 'Looking it up…');
    await setpoint.idle();
    assert.equal((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${trey}`)).jd.state, 'looking');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an event opens its email in the mail reader; one whose email is gone says so, opens nothing and its ··· has no Open email (#269)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const northwind = await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I');
    const detail = await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${northwind}`);
    const interview = detail.timeline.find(event => event.kind === 'interview')!;
    await page.goto(`${setpoint.base}/jobs/${northwind}`);
    const events = page.locator('.jb-pane .jb-ev');
    await events.first().waitFor();
    // The verification email isn't in mail: its line stays, says why, takes no hover fill and opens nothing.
    assert.deepEqual(await events.evaluateAll(all => all.map(one => Boolean(one.querySelector('button.open')))), [true, false, true]);
    const gone = events.nth(1);
    assert.equal(await gone.getAttribute('data-tip'), 'Gmail no longer has this email, so Jobs keeps only its line');
    assert.equal(await gone.locator('.gonetxt').textContent(), '· No longer in Gmail');
    await gone.hover();
    assert.equal(await rested(() => gone.evaluate(element => getComputedStyle(element).backgroundColor)), 'rgba(0, 0, 0, 0)');
    assert.equal(await rested(() => gone.evaluate(element => getComputedStyle(element).cursor)), 'default');
    // Its ··· (shown on hover) has no Open email; the one whose email is there has.
    await gone.locator('.go .ibtn').click();
    assert.deepEqual(await page.getByRole('menu', {name: 'Event'}).getByRole('menuitem').allTextContents(), ['Move to…', 'Not about this']);
    await page.keyboard.press('Escape');
    await until('its menu closed', () => page.locator('.jb-menu').count(), count => count === 0);
    await events.nth(2).click({button: 'right'});
    assert.deepEqual(await page.getByRole('menu', {name: 'Event'}).getByRole('menuitem').allTextContents(), ['Open email', 'Move to…', 'Not about this']);
    await page.keyboard.press('Escape');
    await events.nth(2).click();
    await until('the email', () => Promise.resolve(new URL(page.url()).pathname), pathname => pathname === `/inbox/${interview.message_id}`);
    await page.locator('.rd-subj', {hasText: 'Interview availability for Software Engineer I'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-141: Role stops at its longest title and the page ends at the table\'s JD edge, the Needs you dates, the fold and the search field with it, through a filter; a detail takes the header to its end, and at 1024 the rows still fill', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const columns = (page: Page) => rested(() => page.evaluate(() => {
      const all = [...document.querySelectorAll('.jb-scroll .jb-tr')];
      const first = all[0]!;
      const right = (cell: string) => [...document.querySelectorAll(cell)].map(each => Math.round(each.getBoundingClientRect().right));
      const inks = all.map(each => {
        const range = document.createRange();
        range.selectNodeContents(each.querySelector('.ro')!);
        return range.getBoundingClientRect().right;
      });
      return {
        longest: Math.max(...inks),
        role: first.querySelector('.ro')!.getBoundingClientRect().right,
        platform: first.querySelector('.pl')?.getBoundingClientRect().left,
        edge: right('.jb-tr .jd')[0]!,
        ends: [...new Set([...right('.jb-need .r1 > :last-child'), ...right('.jb-fold-t'), ...right('.hd .search')])],
        row: Math.round(first.getBoundingClientRect().right),
        padding: parseFloat(getComputedStyle(first).paddingRight),
        clipped: all.filter(each => each.querySelector('.ro')!.scrollWidth > each.querySelector('.ro')!.clientWidth).length,
      };
    }));
    const width = 2655;
    const zoom = 1.25;
    const page = await setpoint.page({width, height: 1000});
    await page.goto(`${setpoint.base}/jobs`);
    const at = await columns(page);
    assert.equal(at.clipped, 0, 'every title whole');
    const room = at.role - at.longest;
    assert.ok(room >= 16 * zoom && room <= 48 * zoom, `Role keeps a comfortable margin past its longest title, no more: ${room}`);
    assert.ok(at.row - at.edge > 200, `spare width past JD: ${at.row - at.edge}`);
    assert.deepEqual(at.ends, [at.edge], 'Needs you, the fold and the search field end at JD');
    await page.locator('.jb-status button', {hasText: 'In process'}).click();
    await until('In process\'s rows', () => rows(page).count(), count => count === 3);
    const filtered = await columns(page);
    assert.deepEqual([filtered.platform, filtered.edge, filtered.ends], [at.platform, at.edge, at.ends], 'the filter leaves the columns and the edge where they are');
    await page.locator('.jb-status button', {hasText: 'All'}).click();
    await until('all the rows', () => rows(page).count(), count => count === 62);
    await rows(page).first().click();
    await page.locator('.jb-pane').waitFor();
    const search = await rested(() => page.locator('.hd .search').boundingBox());
    assert.equal(Math.round(search!.x + search!.width), width - 16 * zoom, 'beside a detail the header runs to the pane\'s end');
    const narrow = await setpoint.page({width: 1024, height: 768});
    await narrow.goto(`${setpoint.base}/jobs`);
    const fitted = await columns(narrow);
    assert.equal(fitted.edge, fitted.row - fitted.padding, 'at 1024 the columns still fill the row');
    assert.deepEqual(fitted.ends, [fitted.edge], 'and Needs you and the header end with them');
  } finally {
    await setpoint.stop();
  }
});

test('SV-141: two lines hold a long note whole; past two it ends in an ellipsis with the whole note on hover, and J reaches it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const northwind = await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I');
    const page = await setpoint.page({width: 2655, height: 1000});
    const clipped = () => rested(() => row(page, northwind).locator('.st-t').evaluate(text => text.scrollHeight > text.clientHeight));
    await page.goto(`${setpoint.base}/jobs`);
    assert.equal(await clipped(), false, 'two lines hold this note whole');

    const note = `Case study: ${'submit the write-up and the slides to the panel before the next call, '.repeat(4)}`.trim();
    jobsChange(setpoint, `UPDATE jobs_applications SET step = '${note}' WHERE id = ${northwind}`);
    await page.reload();
    assert.equal(await clipped(), true, 'the rest ends in an ellipsis');
    assert.equal(await row(page, northwind).locator('.step').getAttribute('data-tip'), note, 'the whole note on hover');

    const steps = await rows(page).evaluateAll((all, id) => all.findIndex(each => (each as HTMLElement).dataset.application === String(id)), northwind);
    await point(rows(page).first());
    for (let press = 0; press < steps; press += 1) await page.keyboard.press('j');
    await until('the cursor on its row', () => page.locator('.jb-tr.cur').getAttribute('data-application'), id => id === String(northwind));
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
    assert.deepEqual(await page.locator('.sb .nav').evaluateAll(links => links.map(link => link.getAttribute('data-tip'))), ['Inbox', 'Calendar', 'News', 'Jobs · 3 need you', 'Settings · ⌘,']);
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
    assert.deepEqual([await back.isVisible(), await back.getAttribute('data-tip')], [true, 'Back · Esc']);
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

test('a `jobs` event: an application that lands takes its place, and a row an email moves on shows its new status', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [tailspin, trey] = [await applicationId(setpoint, 'Tailspin Toys', 'Full Stack Developer'), await applicationId(setpoint, 'Trey Research', 'Data Engineer I')];
    await page.goto(`${setpoint.base}/jobs`);
    jobsChange(setpoint, `${WIDE_WORLD};
      UPDATE jobs_applications SET status = 'in_process', status_set_at = '2026-10-07T16:00:00.000Z', step = 'Interview Fri Oct 9, 10:00 AM', step_at = '2026-10-07T16:00:00.000Z' WHERE id = ${tailspin}`);
    // Any `jobs` event refreshes the page: Look it up sends one.
    await setpoint.api('POST', `/jobs/applications/${trey}/lookup`);
    await until('Wide World landed at its date, the newest', () => companies(page).then(all => all.slice(0, 2)), first => first.join() === 'Wide World Importers,Fabrikam');
    await until('Tailspin moved on', () => row(page, tailspin).locator('.st').textContent(), text => text === 'In process· Interview Fri Oct 9, 10:00 AM');
    assert.equal(await page.locator('.jb-status button.on').textContent(), 'All63');
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

// ---- J6: Needs you's answers (34a–34c, #266) ----

const need = (page: Page, text: string) => page.locator('.jb-need[data-key]', {hasText: text});
const toast = (page: Page) => page.locator('.toast:not(.leaving)');
const undo = (page: Page) => toast(page).getByRole('button', {name: 'Undo'}).click();
const navCount = async (setpoint: Setpoint) => (await setpoint.api<JobsNavOut>('GET', '/jobs/nav')).needs_you;

test('a JD to confirm (34a, 34b): ↑ ↓ and Enter pick a candidate, the item folds with the count, and Undo folds it back; None of these', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const lucerne = await applicationId(setpoint, 'Lucerne Publishing', 'Junior Developer');
    await page.goto(`${setpoint.base}/jobs`);
    // J puts the cursor on Lucerne's item, and ↑ ↓ choose among its candidates.
    await page.mouse.move(290, 28);
    await page.keyboard.press('j');
    await until('the cursor on Lucerne', () => page.locator('.jb-need.cur').textContent(), text => Boolean(text?.includes('Lucerne')));
    await page.keyboard.press('ArrowDown');
    await until('the first candidate chosen', () => page.locator('.jb-cand.cur').textContent(), text => text === 'Junior Developer · New York, NY · Greenhouse');
    await page.keyboard.press('Enter');
    // The fold, the count going with it.
    await until('Lucerne folded away', () => need(page, 'Lucerne').count(), count => count === 0);
    assert.equal(await page.locator('.jb-band .gh').textContent(), 'Needs you 2');
    await until('the toast', () => toast(page).textContent(), text => text === 'JD saved for Lucerne PublishingUndo');
    await holdToast(page);
    await until('the sidebar\'s count', () => page.locator('aside.sb .nav.jobs .cnt').textContent(), text => text === '2');
    // A pick is the posting: its lookup reads it (here, a dev run with no web, it stays looking).
    assert.equal((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${lucerne}`)).jd.state, 'looking');

    // Undo folds it back, its candidates as they were.
    await undo(page);
    await until('Lucerne back', () => need(page, 'Lucerne').count(), count => count === 1);
    await until('Needs you 3', () => page.locator('.jb-band .gh').textContent(), text => text === 'Needs you 3');
    assert.equal((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${lucerne}`)).jd.state, 'candidates');

    // None of these: No JD found.
    await need(page, 'Lucerne').getByRole('radio', {name: 'None of these'}).click();
    await until('Lucerne gone again', () => need(page, 'Lucerne').count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'None of these for Lucerne PublishingUndo');
    await until('its row: No JD found', () => row(page, lucerne).locator('.jd').textContent(), text => text === 'No JD found');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an update to assign (34a): Assign to… lists Humongous\'s two, a pick moves its row to Rejected; Not about a job sets Wide World aside; the last item takes the band', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const java = await applicationId(setpoint, 'Humongous Insurance', 'Software Engineer II (Java)');
    await page.goto(`${setpoint.base}/jobs`);
    const assign = need(page, 'Software Engineer II role').getByRole('button', {name: 'Assign to…'});
    await assign.click();
    const menu = page.getByRole('menu', {name: 'Assign to'});
    await menu.waitFor();
    assert.equal(await menu.locator('.jb-mlab').first().textContent(), 'Humongous Insurance');
    assert.deepEqual(await menu.locator('.menu-i').allTextContents(), [
      'Software Engineer II, ClaimsApplied Sep 30 · Applied', 'Software Engineer II (Java)Applied Sep 28 · Applied', 'Another application…', 'Not about a job',
    ]);
    await menu.getByRole('menuitem', {name: /\(Java\)/}).click();
    await until('Humongous\'s update gone', () => need(page, 'Software Engineer II role').count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'Assigned to Software Engineer II (Java)Undo');
    await until('its row moved on', () => row(page, java).locator('.st').textContent(), text => text === 'Rejected· Oct 6');

    // Dismiss all first, so From history's line goes too and the band can go whole.
    await page.locator('.jb-fold-t').click();
    await page.getByRole('button', {name: 'Dismiss all'}).click();
    await until('the toast', () => toast(page).textContent(), text => text === 'Dismissed 6 from historyUndo');
    await until('From history folded away', () => page.locator('.jb-fold').count(), count => count === 0);
    await undo(page);
    await until('From history back', () => page.locator('.jb-fold-t').textContent(), text => Boolean(text?.startsWith('From history 6')));
    // Back as it was, unfolded.
    assert.equal(await page.locator('.jb-fold-t').getAttribute('aria-expanded'), 'true');
    await page.getByRole('button', {name: 'Dismiss all'}).click();
    await until('From history gone', () => page.locator('.jb-fold').count(), count => count === 0);

    await need(page, 'Wide World').getByRole('button', {name: 'Not about a job'}).click();
    await until('the toast', () => toast(page).textContent(), text => text === 'Not about a jobUndo');
    await need(page, 'Lucerne').getByRole('radio', {name: 'None of these'}).click();
    // The last item leaving folds the band, header and all.
    await until('the band gone', () => page.locator('.jb-band').count(), count => count === 0);
    // The band folds at 360 ms, with its answer still on its way.
    await until('the server agrees', () => navCount(setpoint), count => count === 0);
    await until('no count in the sidebar', () => page.locator('aside.sb .nav.jobs .cnt').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// The seed's items have no email in mail's sample: these stand in as theirs (D401), the first two
// unread, the last from history.
const ITEM_EMAILS = `
  UPDATE jobs_needs_you SET message_id = (SELECT id FROM messages WHERE subject = 'Application received') WHERE subject = 'Thank you for your interest in the Software Engineer II role';
  UPDATE jobs_needs_you SET message_id = (SELECT id FROM messages WHERE subject = 'Interview availability for Software Engineer I') WHERE subject = 'Can we set up a call this week?';
  UPDATE jobs_needs_you SET message_id = (SELECT id FROM messages WHERE subject = 'Update on your application') WHERE subject = 'Thanks for your interest in the Support Specialist role';
  UPDATE jobs_needs_you SET message_id = (SELECT id FROM messages WHERE subject = 'Your application for Data Engineer Intern') WHERE subject = 'Your application to Wingtip Toys'`;

const itemEmail = (page: Page) => page.getByRole('region', {name: 'Email', exact: true});
const itemSubject = (page: Page, text: string) => page.locator('.jb-band').getByRole('button', {name: text});
const unreadInbox = async (setpoint: Setpoint) => (await setpoint.api<MailCountsOut>('GET', '/mail/counts')).unread;

test('D401: an item\'s subject opens its email where the detail sits, the email alone, unread as it was; Esc leaves the item unanswered with the cursor on it, and a JD has no email to open', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    jobsChange(setpoint, ITEM_EMAILS);
    const page = await setpoint.page('target');
    const {needs_you: [, update]} = await setpoint.api<JobsPageOut>('GET', '/jobs');
    const unread = await unreadInbox(setpoint);
    await page.goto(`${setpoint.base}/jobs`);
    const item = need(page, 'Software Engineer II role');
    assert.equal(await need(page, 'Lucerne').locator('button.what').count(), 0, 'a JD to confirm has no email');

    await item.locator('button.what').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    await itemEmail(page).locator('.rd-body .mailtext, .rd-body iframe').waitFor();
    // Where the detail sits and as wide, with the band beside it and Assign to… reachable.
    const [pane, band] = await rested(() => Promise.all([itemEmail(page).boundingBox(), page.locator('.jb-band').boundingBox()]));
    assert.equal(pane!.width, layout.readingPane);
    assert.ok(band!.x + band!.width <= pane!.x, 'the band beside the pane');
    assert.match(await item.getAttribute('class') ?? '', /\breading\b/);
    assert.equal(await item.locator('button.what').getAttribute('aria-pressed'), 'true');
    // The email alone: none of the reader's tools or actions, and nothing of Jobs's chip.
    assert.deepEqual(await itemEmail(page).locator('.rd-tools button:visible').evaluateAll(all => all.map(one => one.textContent || one.getAttribute('aria-label'))), ['Open in Inbox', 'Previous email', 'Next email']);
    assert.equal(await itemEmail(page).locator('.rd-acts, .jb-chip, .jb-badge').count(), 0);
    // Reading it changes nothing in mail: it stays unread, here and in the Inbox's counts (D313).
    await setpoint.idle();
    assert.equal((await setpoint.api<MessageOut>('GET', `/mail/messages/${update!.message_id!}`)).unread, true);
    assert.equal(await unreadInbox(setpoint), unread);
    assert.equal(new URL(page.url()).pathname, '/jobs');

    await page.keyboard.press('Escape');
    await until('the email closed', () => itemEmail(page).count(), count => count === 0);
    assert.equal(await page.locator('.jb-band .gh').textContent(), 'Needs you 3');
    await setpoint.idle();
    assert.equal(await navCount(setpoint), 3);
    await item.getByRole('button', {name: 'Assign to…'}).waitFor();
    assert.match(await item.getAttribute('class') ?? '', /\bcur\b/, 'the cursor stays on the item');
    assert.equal(new URL(page.url()).pathname, '/jobs');

    // Its subject again, or another's, closes or swaps it.
    await item.locator('button.what').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    await item.locator('button.what').click();
    await until('its subject closes it', () => itemEmail(page).count(), count => count === 0);

    // J to the item and Enter opens it, Assign to…'s focus keeping its own Enter.
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    await page.keyboard.press('Escape');
    await until('closed', () => itemEmail(page).count(), count => count === 0);
    await item.getByRole('button', {name: 'Assign to…'}).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu', {name: 'Assign to'}).waitFor();
    assert.equal(await itemEmail(page).count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('D401: with the email open Assign to… works beside it: Esc takes the menu first, a subject pressed closes a menu, J / K step through the items\' emails, and answering closes it, Undo leaving it closed', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    jobsChange(setpoint, ITEM_EMAILS);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    const item = need(page, 'Software Engineer II role');
    const assign = item.getByRole('button', {name: 'Assign to…'});
    const menu = page.getByRole('menu', {name: 'Assign to'});

    // An open menu closes as the subject is pressed, and the email opens.
    await assign.click();
    await menu.waitFor();
    await item.locator('button.what').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.equal(await menu.count(), 0);

    await assign.click();
    await menu.waitFor();
    await page.keyboard.press('Escape');
    await until('the menu closed', () => menu.count(), count => count === 0);
    // The email, not one closing (it stays drawn, leaving and inert, for its fade).
    assert.equal(await page.locator('.jb-pane[aria-label="Email"]:not(.leaving)').count(), 1, 'Esc takes the menu first');

    // J / K step through the emails, past the JD, which has none, and the cursor goes along.
    const previous = itemEmail(page).getByRole('button', {name: 'Previous email'});
    const next = itemEmail(page).getByRole('button', {name: 'Next email'});
    assert.deepEqual([await previous.isDisabled(), await next.isDisabled()], [true, false]);
    await page.keyboard.press('j');
    await itemEmail(page).locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.match(await need(page, 'Wide World').getAttribute('class') ?? '', /\bcur\b/);
    assert.equal(await next.isDisabled(), true);
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.match(await item.getAttribute('class') ?? '', /\bcur\b/, 'the first stays');

    await assign.click();
    await menu.getByRole('menuitem', {name: /\(Java\)/}).click();
    await until('the email closed with its item', () => itemEmail(page).count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'Assigned to Software Engineer II (Java)Undo');
    await until('the item folded away', () => page.locator('.jb-band .gh').textContent(), text => text === 'Needs you 2');
    await undo(page);
    await until('the item back', () => page.locator('.jb-band .gh').textContent(), text => text === 'Needs you 3');
    assert.equal(await itemEmail(page).count(), 0);

    // An application takes the pane, and a subject takes it back.
    const northwind = await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I');
    await item.locator('button.what').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    await row(page, northwind).click();
    await page.getByRole('region', {name: 'Application', exact: true}).waitFor();
    assert.equal(await itemEmail(page).count(), 0);
    await item.locator('button.what').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.equal(await page.getByRole('region', {name: 'Application', exact: true}).count(), 0);
    assert.equal(new URL(page.url()).pathname, '/jobs');
    // Open in Inbox is the way to the rest of what mail does with it.
    const {needs_you: [, update]} = await setpoint.api<JobsPageOut>('GET', '/jobs');
    await itemEmail(page).getByRole('button', {name: 'Open in Inbox'}).click();
    await until('the Inbox', () => Promise.resolve(new URL(page.url()).pathname), pathname => pathname === `/inbox/${update!.message_id}`);
    await page.getByRole('region', {name: 'Reading pane'}).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('D401: From history\'s subject opens its email too, J / K staying among From history\'s; in a narrow window the email lies over the table and Back leaves the item unanswered', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    jobsChange(setpoint, ITEM_EMAILS);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    await page.locator('.jb-fold-t').click();
    const history = page.locator('.jb-hist', {hasText: 'Support Specialist'});
    await itemSubject(page, 'Thanks for your interest in the Support Specialist role').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Update on your application'}).waitFor();
    assert.match(await history.getAttribute('class') ?? '', /\breading\b/);
    await page.keyboard.press('j');
    await itemEmail(page).locator('.rd-subj', {hasText: 'Your application for Data Engineer Intern'}).waitFor();
    assert.equal(await itemEmail(page).getByRole('button', {name: 'Next email'}).isDisabled(), true);
    await page.keyboard.press('Escape');
    await until('closed', () => itemEmail(page).count(), count => count === 0);

    await page.setViewportSize({width: 1024, height: 768});
    await itemSubject(page, 'Thank you for your interest in the Software Engineer II role').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.deepEqual(await rested(() => itemEmail(page).boundingBox()), {x: layout.rail, y: layout.header, width: 1024 - layout.rail, height: 768 - layout.header});
    await itemEmail(page).getByRole('button', {name: 'Back'}).click();
    await until('Back closes it', () => itemEmail(page).count(), count => count === 0);
    await setpoint.idle();
    assert.equal(await navCount(setpoint), 3);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('D402: an application in Assign to… opens its first email beside the menu, which stays through a press and a scroll in the pane; Esc takes the menu, a subject shows the item\'s own, and picking closes it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    jobsChange(setpoint, ITEM_EMAILS);
    jobsChange(setpoint, `UPDATE jobs_events SET message_id = (SELECT id FROM messages WHERE subject = 'Thanks for applying')
      WHERE application_id = (SELECT id FROM jobs_applications WHERE title = 'Software Engineer II, Claims')`);
    const page = await setpoint.page('target');
    const unread = await unreadInbox(setpoint);
    await page.goto(`${setpoint.base}/jobs`);
    const item = need(page, 'Software Engineer II role');
    const subject = item.locator('button.what');
    const menu = page.getByRole('menu', {name: 'Assign to'});
    const look = (role: string) => menu.locator('.jb-mrow', {hasText: role}).getByRole('menuitem', {name: 'Read its email'});
    await item.getByRole('button', {name: 'Assign to…'}).click();
    await look('Claims').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Thanks for applying'}).waitFor();
    await menu.waitFor();
    assert.equal(await itemEmail(page).locator('.jb-of').textContent(), 'Software Engineer II, Claims');
    assert.equal(await look('Claims').getAttribute('class'), 'ibtn sm on');
    assert.equal(await item.getAttribute('class').then(names => names?.includes('reading')), true, 'the item being assigned stays marked');
    assert.equal(await subject.getAttribute('aria-pressed'), 'false', 'but it isn\'t its own email');
    await setpoint.idle();
    assert.equal(await unreadInbox(setpoint), unread);
    assert.equal(new URL(page.url()).pathname, '/jobs');

    // Reading doesn't cost the menu: a press and a scroll in the pane leave it open.
    await itemEmail(page).locator('.rd-subj').click();
    await itemEmail(page).locator('.rd-scroll').evaluate(scroller => scroller.scrollBy(0, 40));
    await setpoint.idle();
    assert.equal(await menu.count(), 1);
    // Esc takes the menu first though the focus went to the pane, then the email.
    await page.keyboard.press('Escape');
    await until('the menu closed', () => menu.count(), count => count === 0);
    assert.equal(await page.locator('.jb-pane[aria-label="Email"]:not(.leaving)').count(), 1);

    // → reads the item under the cursor; one with no email says so and the pane stays.
    await item.getByRole('button', {name: 'Assign to…'}).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await until('the toast', () => toast(page).textContent(), text => text === 'No email left for Software Engineer II (Java)');
    assert.equal(await itemEmail(page).locator('.rd-subj').textContent(), 'Thanks for applying');
    await page.keyboard.press('Escape');
    await until('the menu closed', () => menu.count(), count => count === 0);

    // The item's subject shows its own email rather than closing the pane.
    await subject.click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Application received'}).waitFor();
    assert.equal(await itemEmail(page).locator('.jb-of').count(), 0);
    assert.equal(await subject.getAttribute('aria-pressed'), 'true');

    await item.getByRole('button', {name: 'Assign to…'}).click();
    await look('Claims').click();
    await itemEmail(page).locator('.rd-subj', {hasText: 'Thanks for applying'}).waitFor();
    await menu.getByRole('menuitem', {name: /Claims/}).click();
    await until('the email closed with its item', () => itemEmail(page).count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'Assigned to Software Engineer II, ClaimsUndo');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an answer refused leaves the item for good: the fold it had coming doesn\'t take it away', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    const item = need(page, 'Wide World');
    await page.route('**/api/jobs/needs-you/*/not-a-job', route => route.fulfill({status: 500, json: {error: {code: 'server', message: 'No'}}}));
    // The page's clock is the check's from here, so the fold's timers run when it says.
    await page.clock.install();
    await item.getByRole('button', {name: 'Not about a job'}).click();
    await until('the refusal', () => toast(page).textContent(), text => Boolean(text?.startsWith('Couldn\'t set it aside')));
    // Nothing happened: past the 360 ms and the 180 ms fold it had coming, on the page's clock.
    await page.clock.runFor(600);
    await setpoint.idle();
    assert.equal(await item.getByRole('button', {name: 'Not about a job'}).count(), 1);
    assert.equal(await page.locator('.jb-band .gh').textContent(), 'Needs you 3');
  } finally {
    await setpoint.stop();
  }
});

test('Track this (34c, decision 69): the application lands at its email\'s date, opens with First seen and its JD looked up, In process, and the numbers move', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    await need(page, 'Wide World').getByRole('button', {name: 'Track this'}).click();
    await until('it opens', () => page.title(), title => title === 'Junior Software Engineer · Wide World Importers');
    const pane = page.locator('.jb-pane');
    await pane.locator('.jb-first').waitFor();
    assert.equal(await pane.locator('.jb-first').textContent(), 'First seen in this email, so Applied is its date');
    assert.equal(await pane.locator('.jb-stchip').textContent(), 'In process');
    await pane.locator('.jb-src.looking').waitFor();
    assert.equal(await pane.locator('.jb-ev .tag').textContent(), 'First seen');
    await until('the toast', () => toast(page).textContent(), text => text === 'Tracking Wide World ImportersUndo');
    await holdToast(page);
    // It landed at the top, at its date, settling from sub2; the numbers move with it (All 63, In process 4, this week 4).
    await until('its row at the top', () => companies(page), all => all[0] === 'Wide World Importers' && all[1] === 'Fabrikam');
    await until('the filter\'s counts', () => page.locator('.hd .jb-status button').allTextContents(), counts => counts.join() === 'All63,Applied31,In process4,Offer1,Rejected25,Withdrawn2');
    await until('Per week', () => page.locator('.jb-week').textContent(), text => text === 'Per week4 this week');
    await until('Needs you 2', () => page.locator('.jb-band .gh').textContent(), text => text === 'Needs you 2');

    // Undo takes the application away and brings the item back.
    await undo(page);
    await until('the item back', () => need(page, 'Wide World').count(), count => count === 1);
    await until('the row gone', () => companies(page).then(all => all.includes('Wide World Importers')), found => !found);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('From history (D364): Choose… is a menu of the candidates, each opening its posting, a pick folding the row; Assign to… and Track this on rows too', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const margies = await applicationId(setpoint, 'Margie\'s Travel', 'Associate Developer');
    await page.goto(`${setpoint.base}/jobs`);
    await page.locator('.jb-fold-t').click();
    const history = (text: string) => page.locator('.jb-hist[data-need]', {hasText: text});
    await history('Margie').getByRole('button', {name: 'Choose…'}).click();
    const menu = page.getByRole('menu', {name: 'Choose the posting'});
    await menu.waitFor();
    assert.deepEqual(await menu.locator('button[role="menuitem"]').allTextContents(), [
      'Associate DeveloperChicago, IL · Greenhouse', 'Associate Software DeveloperRemote · LinkedIn · Jobs can\'t read this one', 'Associate Developer, BookingsChicago, IL · Indeed', 'None of these',
    ]);
    // Each candidate's arrow opens its posting without picking it.
    assert.equal(await menu.getByRole('menuitem', {name: 'Look at Associate Developer, Bookings'}).getAttribute('href'), 'https://indeed.example/viewjob?jk=2b90d4e1c7a8');
    await menu.getByRole('menuitem', {name: /^Associate Developer, Bookings/}).click();
    await until('Margie\'s row folded', () => history('Margie').count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'JD saved for Margie\'s TravelUndo');
    await until('From history 5', () => page.locator('.jb-fold-t').textContent(), text => Boolean(text?.startsWith('From history 5')));
    assert.equal((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${margies}`)).jd.state, 'looking');

    // Assign to… on Relecloud's row: Another application… searches every application.
    await history('Support Specialist').getByRole('button', {name: 'Assign to…'}).click();
    await page.getByRole('menuitem', {name: 'Another application…'}).click();
    await page.getByRole('textbox', {name: 'Search applications'}).fill('proseware');
    await page.getByRole('menuitem', {name: /^Proseware · Software Engineer, Platform/}).click();
    await until('the toast', () => toast(page).textContent(), text => text === 'Assigned to Software Engineer, PlatformUndo');
    await until('Relecloud\'s row folded', () => history('Support Specialist').count(), count => count === 0);

    // Track this on Bellows College's.
    await history('Bellows').getByRole('button', {name: 'Track this'}).click();
    await until('Bellows College tracked', () => companies(page).then(all => all.includes('Bellows College')), found => found);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// ---- J6: the corrections (35a, 35b, #267, #268) ----

test('the title in place (35a): a click puts it in a field, Esc keeps it, Enter saves it; the company from More; each with Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const claims = await applicationId(setpoint, 'Humongous Insurance', 'Software Engineer II, Claims');
    await page.goto(`${setpoint.base}/jobs/${claims}`);
    const pane = page.locator('.jb-pane');
    await pane.locator('.jb-want').waitFor();
    // Under the pointer, its pencil.
    await pane.locator('.jb-title .jb-tbtn').hover();
    await until('the pencil', () => pane.locator('.jb-title .jb-tbtn .pen').evaluate(pen => getComputedStyle(pen).opacity), opacity => opacity === '1');
    await pane.locator('.jb-title .jb-tbtn').click();
    const field = pane.getByRole('textbox', {name: 'Title'});
    await field.waitFor();
    await page.keyboard.type('Claims Platform Engineer');
    await page.keyboard.press('Escape');
    await until('back as it was', () => pane.locator('.rd-subj').textContent(), text => text === 'Software Engineer II, Claims');
    assert.equal(await page.locator('.jb-pane:not(.leaving)').count(), 1, 'Esc went no further than the field');

    await pane.locator('.jb-title .jb-tbtn').click();
    await field.fill('Claims Platform Engineer');
    await page.keyboard.press('Enter');
    await until('the new title', () => pane.locator('.rd-subj').textContent(), text => text === 'Claims Platform Engineer');
    await until('its row too', () => row(page, claims).locator('.ro').textContent(), text => text === 'Claims Platform Engineer');
    await until('the toast', () => toast(page).textContent(), text => text === 'Title changedUndo');
    await holdToast(page);
    await setpoint.idle();
    assert.deepEqual((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${claims}`)).hand_set.map(each => each.field), ['title']);
    await undo(page);
    await until('the title back', () => pane.locator('.rd-subj').textContent(), text => text === 'Software Engineer II, Claims');

    // The company, from More.
    await pane.getByRole('button', {name: 'More'}).click();
    await page.getByRole('menuitem', {name: 'Edit company'}).click();
    await pane.getByRole('textbox', {name: 'Company'}).fill('Humongous Insurance Group');
    await page.keyboard.press('Enter');
    await until('the company', () => pane.locator('.jb-co .name').textContent(), text => text === 'Humongous Insurance Group');
    await until('the toast', () => toast(page).textContent(), text => text === 'Company changedUndo');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Set status (#267): the chip\'s menu, a pick changing it and marking the row set by hand; Let emails decide hands it back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const litware = await applicationId(setpoint, 'Litware', 'QA Engineer');
    await page.goto(`${setpoint.base}/jobs/${litware}`);
    const pane = page.locator('.jb-pane');
    const chip = pane.locator('.jb-stchip');
    await chip.waitFor();
    await chip.click();
    const menu = page.getByRole('menu', {name: 'Set status'});
    await menu.waitFor();
    assert.equal(await chip.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Applied', 'In process', 'Offer', 'Rejected', 'Withdrawn']);
    assert.equal(await menu.getByRole('menuitem', {name: 'In process'}).getAttribute('aria-checked'), 'true');
    await menu.getByRole('menuitem', {name: 'Rejected'}).click();
    await until('the chip', () => chip.textContent(), text => text === 'Rejected');
    await until('the toast', () => toast(page).textContent(), text => text === 'Set to RejectedUndo');
    await until('its row, set by hand', () => row(page, litware).locator('.st .by').count(), count => count === 1);

    // Set by hand, the menu ends with Let emails decide, which gives the emails' status back.
    await chip.click();
    await page.getByRole('menuitem', {name: 'Let emails decide'}).click();
    await until('the emails\' status', () => chip.textContent(), text => text === 'In process');
    await until('the toast', () => toast(page).textContent(), text => text === 'Status left to the emailsUndo');
    await until('no mark', () => row(page, litware).locator('.st .by').count(), count => count === 0);
    assert.equal((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${litware}`)).step, 'Case study due Oct 12');
    await chip.click();
    await menu.waitFor();
    assert.equal(await page.getByRole('menuitem', {name: 'Let emails decide'}).count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Merge with… (35b): More\'s submenu, its field focused, the company\'s other first; merged, the other row folds out and its emails join; Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [claims, java] = [await applicationId(setpoint, 'Humongous Insurance', 'Software Engineer II, Claims'), await applicationId(setpoint, 'Humongous Insurance', 'Software Engineer II (Java)')];
    await page.goto(`${setpoint.base}/jobs/${claims}`);
    const pane = page.locator('.jb-pane');
    await pane.locator('.jb-want').waitFor();
    await pane.getByRole('button', {name: 'More'}).click();
    const more = page.getByRole('menu', {name: 'More'});
    await more.waitFor();
    assert.deepEqual(await more.getByRole('menuitem').allTextContents(), [
      'Edit company', 'Edit title', 'Set status', 'Merge with…', 'Not this posting', 'Look up the JD again',
      'Not an applicationHides it · its emails never make one again', 'DeleteForgets it · a later email can make it again',
    ]);
    // A saved JD is never replaced: Look up the JD again waits for Not this posting.
    assert.equal(await more.getByRole('menuitem', {name: 'Look up the JD again'}).isDisabled(), true);
    await more.getByRole('menuitem', {name: 'Merge with…'}).hover();
    const field = page.getByRole('textbox', {name: 'Search applications'});
    await until('its field focused', () => field.evaluate(input => input === document.activeElement), focused => focused);
    const merge = page.getByRole('menu', {name: 'Merge with'});
    assert.deepEqual(await merge.locator('.jb-mlab').allTextContents(), ['Humongous Insurance', 'Recent']);
    await merge.getByRole('menuitem', {name: /^Software Engineer II \(Java\)/}).click();
    await until('the other row gone', () => row(page, java).count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'MergedUndo');
    await holdToast(page);
    await until('its emails here', () => pane.locator('.jb-ev').count(), count => count === 3);
    // Its row from the table's own refetch, which the detail's doesn't wait for.
    await until('its row\'s applied date, the earlier', () => row(page, claims).locator('.ap').textContent(), text => text === 'Sep 28');
    await undo(page);
    await until('the other row back', () => row(page, java).count(), count => count === 1);
    await until('its emails back', () => pane.locator('.jb-ev').count(), count => count === 2);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('an event\'s ··· (35a): Move to… the company\'s other application folds it out; Not about this folds it into Needs you', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [claims, java, northwind] = [
      await applicationId(setpoint, 'Humongous Insurance', 'Software Engineer II, Claims'), await applicationId(setpoint, 'Humongous Insurance', 'Software Engineer II (Java)'),
      await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I'),
    ];
    await page.goto(`${setpoint.base}/jobs/${claims}`);
    const pane = page.locator('.jb-pane');
    const account = pane.locator('.jb-ev', {hasText: 'Your candidate account is ready'});
    await account.hover();
    await account.getByRole('button', {name: 'Event actions'}).click();
    await page.getByRole('menuitem', {name: 'Move to…'}).hover();
    const move = page.getByRole('menu', {name: 'Move to'});
    await move.waitFor();
    assert.deepEqual(await move.getByRole('menuitem').allTextContents(), ['Software Engineer II (Java)Applied Sep 28 · Applied', 'Another application…']);
    await move.getByRole('menuitem', {name: /\(Java\)/}).click();
    await until('it folded out', () => account.count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'Moved to Software Engineer II (Java)Undo');
    await holdToast(page);
    assert.deepEqual((await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${java}`)).timeline.map(event => event.subject), ['Thank you for applying', 'Your candidate account is ready']);
    await undo(page);
    await until('it came back', () => account.count(), count => count === 1);

    // Not about this, from a right-click: the interview goes back to Needs you, and Northwind to Applied.
    await page.goto(`${setpoint.base}/jobs/${northwind}`);
    const interview = pane.locator('.jb-ev', {hasText: 'Interview availability'});
    await interview.click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Not about this'}).click();
    await until('it folded out', () => interview.count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'Back in Needs youUndo');
    await until('in Needs you', () => need(page, 'Interview availability').locator('.line').textContent(), text => text === 'An interview request · taken off the application it was on');
    await until('its status back to Applied', () => pane.locator('.jb-stchip').textContent(), text => text === 'Applied');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Not an application, Delete and Not this posting (35b): the row folds away and the pane closes; the JD goes to No JD found; each with Undo', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [trey, proseware, northwind] = [
      await applicationId(setpoint, 'Trey Research', 'Data Engineer I'), await applicationId(setpoint, 'Proseware', 'Software Engineer, Platform'),
      await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I'),
    ];
    await page.goto(`${setpoint.base}/jobs/${trey}`);
    const pane = page.locator('.jb-pane');
    await pane.locator('.jb-nojd').waitFor();
    await pane.getByRole('button', {name: 'More'}).click();
    await page.getByRole('menuitem', {name: /^Not an application/}).click();
    await until('the pane closed', () => pane.count(), count => count === 0);
    await until('the row folded away', () => row(page, trey).count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'Hidden Trey ResearchUndo');
    await undo(page);
    await until('the row back', () => row(page, trey).count(), count => count === 1);

    await page.goto(`${setpoint.base}/jobs/${proseware}`);
    await pane.locator('.jb-want').waitFor();
    await pane.getByRole('button', {name: 'More'}).click();
    const remove = page.getByRole('menuitem', {name: /^Delete/});
    await remove.hover();
    // Delete is alert on its wash under the pointer.
    assert.equal(await rested(() => remove.evaluate(item => getComputedStyle(item).color)), await rested(() => colourOf(page, 'var(--alert)')));
    await remove.click();
    await until('the row folded away', () => row(page, proseware).count(), count => count === 0);
    await until('the toast', () => toast(page).textContent(), text => text === 'Deleted ProsewareUndo');
    assert.equal((await setpoint.api<JobsPageOut>('GET', '/jobs')).rows.length, 61);

    // Not this posting: the JD crossfades to No JD found, there being no other candidates.
    await page.goto(`${setpoint.base}/jobs/${northwind}`);
    await pane.locator('.jb-want').waitFor();
    await pane.getByRole('button', {name: 'More'}).click();
    await page.getByRole('menuitem', {name: 'Not this posting'}).click();
    await until('No JD found', () => pane.locator('.jb-nojd').textContent(), text => Boolean(text?.startsWith('No JD found')));
    await until('the toast', () => toast(page).textContent(), text => text === 'JD taken awayUndo');
    assert.equal(await pane.locator('.rd-tools a[data-hint="o"]').count(), 0);
    await undo(page);
    await pane.locator('.jb-want').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a row\'s right-click (#268): its actions at the pointer, the cursor on it and nothing opened; Copy company and role; Edit title opens it with the field', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const northwind = await applicationId(setpoint, 'Northwind Talent', 'Software Engineer I');
    await page.goto(`${setpoint.base}/jobs`);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {origin: setpoint.base});
    const target = row(page, northwind);
    const box = (await rested(() => target.boundingBox()))!;
    await page.mouse.click(box.x + 60, box.y + box.height / 2, {button: 'right'});
    const menu = page.getByRole('menu', {name: 'Northwind Talent · Software Engineer I'});
    await menu.waitFor();
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
      'Open↵', 'Open postingO', 'Edit company', 'Edit title', 'Set status', 'Merge with…', 'Not this posting', 'Look up the JD again',
      'Not an applicationHides it · its emails never make one again', 'DeleteForgets it · a later email can make it again', 'Copy company and role', 'Copy posting link',
    ]);
    // At the pointer; the cursor on the row, and the row not opened.
    const at = (await rested(() => menu.boundingBox()))!;
    assert.ok(Math.abs(at.x - (box.x + 60)) < 2, `at the pointer: ${at.x}`);
    assert.match(await target.getAttribute('class') ?? '', /\bcur\b/);
    assert.equal(await page.locator('.jb-pane').count(), 0);
    await menu.getByRole('menuitem', {name: 'Copy company and role'}).click();
    await until('copied', () => page.evaluate(() => navigator.clipboard.readText()), text => text === 'Northwind Talent · Software Engineer I');

    await page.mouse.click(box.x + 60, box.y + box.height / 2, {button: 'right'});
    await menu.getByRole('menuitem', {name: 'Edit title'}).click();
    await until('it opens', () => page.title(), title => title === 'Software Engineer I · Northwind Talent');
    await until('its title in a field', () => page.getByRole('textbox', {name: 'Title'}).evaluate(input => input === document.activeElement), focused => focused);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
