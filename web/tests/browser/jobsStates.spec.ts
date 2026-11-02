// Jobs's states and Settings (J8; DESIGN.md › Jobs › States, Jobs in Settings; boards 38a–38c, 39a,
// 39b) against the seed: the history pass's line, an application landing at its date's place and
// the line's last words folding it away (38a); the AI
// down, saying so and, once it's back, folding out with its check (38b); Jobs off, its header alone, no
// sidebar item, `4` opening it and Turn on opening Settings › Jobs with the switch focused, the switch
// bringing Jobs back into the sidebar (38c); Settings › Jobs with Reads' plain values and From
// history's Show (39a); and Settings › AI's Jobs group (39b). The pass and the AI arrive as the
// reader's own would: the server's
// database changes, then a `jobs` live event (Look it up on Trey Research sends one) has the page ask
// again. The words are the component tests' tables (web/tests/components/jobs.test.tsx), and the
// server's side Jobs's own tests (server/src/jobs/tests/). No JD found, Ghosted and a status set by
// hand are jobs.spec.ts's; this file imports nothing from Jobs's folders.
import assert from 'node:assert/strict';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {JobsNavOut, JobsPageOut, JobsSettingsOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

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

/** A `jobs` live event, so the page asks again: Look it up on Trey Research (its JD stays looking, with no web here). */
async function poke(setpoint: Setpoint) {
  const {rows} = await setpoint.api<JobsPageOut>('GET', '/jobs');
  const trey = rows.find(row => row.company === 'Trey Research')!.id;
  await setpoint.api('POST', `/jobs/applications/${trey}/lookup`);
}

// The seed's moment is 9:12 AM; the pass started at 9:00, reading the mail from before Jobs was turned on.
const STARTED = '2026-10-07T16:00:00.000Z';
/** Marks `n` more emails read by the pass: emails from before it, read since it started. */
const readMore = (n: number) => `INSERT INTO jobs_emails_read (message_id, read_at, outcome, at)
  SELECT id, '2026-10-07T16:05:00.000Z', 'ignored', '2026-09-01T00:00:00.000Z' FROM messages WHERE id NOT IN (SELECT message_id FROM jobs_emails_read) ORDER BY id LIMIT ${n}`;
// Tasmanian Traders's confirmation, read by the pass: an application from Sep 12, landing among the older rows.
const TASMANIAN = `INSERT INTO jobs_applications (company, title, title_key, platform, applied_at, status, status_set_by, status_set_at, first_seen_in_email, jd_lookup, created_at, updated_at)
  VALUES ('Tasmanian Traders', 'Junior Developer', 'junior developer', 'Greenhouse', '2026-09-12T18:00:00.000Z', 'applied', 'email', '2026-09-12T18:00:00.000Z', 0, 'none',
    '2026-10-07T16:06:00.000Z', '2026-10-07T16:06:00.000Z')`;

test('board 38a: the history pass: its line, an application landing at its date\'s place, then "Read 330 emails", folding away', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    jobsChange(setpoint, `UPDATE jobs_history SET state = 'running', started_at = '${STARTED}', total = 330, read = NULL, finished_at = NULL; ${readMore(3)}`);
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    const line = page.locator('.jb-col > .jb-state');
    await line.waitFor();
    assert.equal((await setpoint.api<JobsPageOut>('GET', '/jobs')).history.read, 3);
    // A muted line at the top of the column, with the counts.
    assert.equal(await line.textContent(), 'Reading history · 3 of 330 emails · showing what’s read so far');

    // Each application lands at its date's place, and the counts move in place.
    jobsChange(setpoint, `${TASMANIAN}; ${readMore(1)}`);
    await poke(setpoint);
    await until('the count moved', () => line.textContent(), text => text === 'Reading history · 4 of 330 emails · showing what’s read so far');
    await page.locator('.jb-tr', {hasText: 'Tasmanian Traders'}).waitFor();
    // At its date's place, Sep 12, where the server's newest-first order puts it.
    const {rows} = await setpoint.api<JobsPageOut>('GET', '/jobs');
    const at = rows.findIndex(row => row.company === 'Tasmanian Traders');
    assert.ok(at > 0 && rows[at - 1]!.applied_on >= '2026-09-12' && rows[at + 1]!.applied_on <= '2026-09-12');
    assert.equal((await page.locator('.jb-scroll .jb-tr[data-application] .co').allTextContents()).indexOf('Tasmanian Traders'), at);
    assert.equal(await page.locator('.jb-status button.on').textContent(), 'All63');

    // Done: "Read 330 emails" for 1.2 s, then it folds away.
    jobsChange(setpoint, 'UPDATE jobs_history SET state = \'done\', read = 330, finished_at = \'2026-10-07T16:10:00.000Z\'');
    await poke(setpoint);
    await until('its last words', () => line.textContent(), text => text === 'Read 330 emails');
    await until('folded away', () => page.locator('.jb-col > .jb-state').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// Anthropic unreachable since 8:52 AM (the seed's day), a failure triage's retry policy retries.
const DOWN = `INSERT INTO jobs_reader (id, last_success_at, last_failure_at, failing_since, last_error, last_error_kind)
  VALUES (1, '2026-10-07T15:00:00.000Z', '2026-10-07T16:10:00.000Z', '2026-10-07T15:52:00.000Z', 'Anthropic: Overloaded (529)', 'transient')
  ON CONFLICT (id) DO UPDATE SET last_success_at = excluded.last_success_at, last_failure_at = excluded.last_failure_at, failing_since = excluded.failing_since,
    last_error = excluded.last_error, last_error_kind = excluded.last_error_kind`;

test('board 38b: the AI down: "N emails not read yet, Anthropic unreachable since 8:52 AM, retrying" shows, and folds out with its check once the AI is back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/jobs`);
    await page.locator('.jb-scroll .jb-tr').first().waitFor();
    assert.equal(await page.locator('.jb-col > .jb-state').count(), 0);
    // Emails from the Jobs account since it was turned on, waiting for the reader.
    jobsChange(setpoint, `${DOWN}; DELETE FROM jobs_emails_read WHERE message_id IN (
      SELECT id FROM messages WHERE account_id = (SELECT id FROM accounts WHERE label = 'Jobs') AND received_at > '2026-10-02T01:02:00.000Z' ORDER BY id LIMIT 5)`);
    const {reading} = await setpoint.api<JobsPageOut>('GET', '/jobs');
    assert.ok(reading.waiting > 0, 'emails wait');
    const line = page.locator('.jb-col > .jb-state');
    await poke(setpoint);
    const words = `${reading.waiting} ${reading.waiting === 1 ? 'email' : 'emails'} not read yet, Anthropic unreachable since 8:52 AM, retrying`;
    await until('the line', () => line.textContent(), text => text === words);
    assert.equal(await line.getAttribute('role'), 'alert');

    // Back: its check for 1.2 s, then it folds out. Nothing is lost.
    jobsChange(setpoint, 'UPDATE jobs_reader SET last_success_at = \'2026-10-07T16:11:00.000Z\'');
    await poke(setpoint);
    await until('its check', () => line.locator('.icon.ok').count(), count => count === 1);
    await until('folded out', () => page.locator('.jb-col > .jb-state').count(), count => count === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 38c: Jobs off: the header alone and "Jobs is off · Turn on", no sidebar item, `4` opens it; Turn on opens Settings › Jobs with the switch focused, and on brings Jobs back under News', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await setpoint.api('PATCH', '/jobs/settings', {enabled: false});
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.list .row').first().waitFor();
    await setpoint.idle();
    assert.deepEqual(await page.locator('aside.sb .nav').allTextContents(), ['Inbox319', 'Calendar', 'News', 'Settings⌘,']);

    await page.keyboard.press('4');
    const empty = page.locator('.jb-empty');
    await empty.waitFor();
    assert.equal(new URL(page.url()).pathname, '/jobs');
    // The header is "Jobs" alone: no numbers, no search.
    assert.equal(await page.locator('.hd').textContent(), 'Jobs');
    assert.equal(await page.locator('.hd .jb-status, .hd .jb-week, .hd .search').count(), 0);
    assert.equal(await empty.textContent(), 'Jobs is off·Turn on');
    // `/` and J find nothing to search or move to.
    await page.keyboard.press('/');
    await page.keyboard.press('j');
    await setpoint.idle();
    assert.equal(await page.locator('.hd').textContent(), 'Jobs');

    // Turn on: Settings › Jobs, the switch focused, still off: turning it on is a choice made there.
    await empty.getByRole('button', {name: 'Turn on'}).click();
    const settings = page.getByRole('dialog', {name: 'Settings'});
    const toggle = settings.getByRole('switch', {name: 'Jobs'});
    await toggle.waitFor();
    assert.equal(await settings.locator('.set-nav .nav.on').textContent(), 'Jobs');
    await until('the switch focused', () => toggle.evaluate(element => element === document.activeElement), focused => focused);
    assert.equal(await toggle.getAttribute('aria-checked'), 'false');

    // On: the pass starts, and Jobs comes back into the sidebar under News.
    const item = page.locator('aside.sb .nav.jobs');
    await page.keyboard.press('Space');
    await item.waitFor();
    assert.equal(await toggle.getAttribute('aria-checked'), 'true');
    await until('the server on', () => setpoint.api<JobsSettingsOut>('GET', '/jobs/settings'), value => value.enabled);
    assert.deepEqual(await page.locator('aside.sb .nav .grow').allTextContents(), ['Inbox', 'Calendar', 'News', 'Jobs', 'Settings']);
    assert.equal((await setpoint.api<JobsNavOut>('GET', '/jobs/nav')).enabled, true);
    await page.keyboard.press('Escape');
    await page.locator('.jb-scroll .jb-tr').first().waitFor();
    assert.equal(await page.locator('.jb-empty').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** Settings › Jobs, or AI, over the Jobs page. */
async function openSettings(page: Page, base: string, name: 'Jobs' | 'AI') {
  await page.goto(`${base}/jobs`);
  await page.locator('.jb-scroll .jb-tr').first().waitFor();
  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('dialog', {name: 'Settings'});
  await settings.locator('.set-nav').getByRole('button', {name, exact: true}).click();
  await settings.getByRole('region', {name}).waitFor();
  return settings;
}

test('board 39a: Settings › Jobs: its count, the switch, Reads as a select on each account, and From history\'s Show opening Jobs with it unfolded', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const settings = await openSettings(page, setpoint.base, 'Jobs');
    const main = settings.getByRole('region', {name: 'Jobs'});
    await main.locator('.jb-reads').waitFor();
    assert.equal(await main.locator('.set-head').textContent(), 'Jobs62 applications');

    assert.deepEqual(await main.locator('.set-row .t').first().textContent(), 'Jobs');
    assert.equal(await main.getByRole('switch', {name: 'Jobs'}).getAttribute('aria-checked'), 'true');
    assert.deepEqual(await main.locator('.set-label').allTextContents(), ['Reads', 'History']);

    // Reads (D310, #273, D383): what Jobs reads first, then the rest in the sidebar's order, each a select.
    const readsShown = () => main.locator('.jb-reads .set-row').evaluateAll(rows => rows.map(row => [row.querySelector('.acc')!.textContent, row.querySelector('.select')!.textContent]));
    assert.deepEqual(await readsShown(), [
      ['Jobs', 'Every email'], ['Business', 'Career mail only'], ['Personal', 'Off'], ['Work', 'Off'], ['iCloud', 'Off'],
    ]);

    const rows = main.locator('.set-sec', {has: page.locator('.set-label', {hasText: 'History'})}).locator('.set-row');

    // Choosing one sends the whole list, the account added at its end, and Off takes it out again.
    const accountOf = async (label: string) => Number(await main.locator('.jb-reads .set-row', {hasText: label}).getAttribute('data-account'));
    const [jobs, business, personal] = [await accountOf('Jobs'), await accountOf('Business'), await accountOf('Personal')];
    await main.getByRole('button', {name: 'What Jobs reads in Personal'}).click();
    await page.getByRole('menuitemradio', {name: 'Career mail only'}).click();
    await until('Personal read', () => setpoint.api<JobsSettingsOut>('GET', '/jobs/settings'), value => value.accounts.length === 3);
    assert.deepEqual((await setpoint.api<JobsSettingsOut>('GET', '/jobs/settings')).accounts,
      [{account_id: jobs, reads: 'every'}, {account_id: business, reads: 'career'}, {account_id: personal, reads: 'career'}]);
    await until('the select', readsShown, shown => shown[2]![1] === 'Career mail only');
    await main.getByRole('button', {name: 'What Jobs reads in Personal'}).click();
    await page.getByRole('menuitemradio', {name: 'Off'}).click();
    await until('Personal off again', () => setpoint.api<JobsSettingsOut>('GET', '/jobs/settings'), value => value.accounts.length === 2);

    // Show: Settings closes, and Jobs shows From history unfolded.
    await rows.getByRole('button', {name: 'Show'}).click();
    await until('Settings closed', () => page.getByRole('dialog', {name: 'Settings'}).count(), count => count === 0);
    await until('From history unfolded', () => page.locator('.jb-fold-t').getAttribute('aria-expanded'), value => value === 'true');
    await until('the address spent', () => Promise.resolve(new URL(page.url()).pathname), pathname => pathname === '/jobs');
    assert.equal(await page.locator('.jb-hist-wrap').getAttribute('inert'), null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 39b: Settings › AI\'s Jobs group: three models by name, this month with no meter', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const settings = await openSettings(page, setpoint.base, 'AI');
    const main = settings.getByRole('region', {name: 'AI'});
    const jobs = main.locator('.set-sec', {has: page.locator('.set-label', {hasText: /^Jobs$/})});
    await jobs.locator('.set-row').first().waitFor();
    // Names, not selects (override 26); no key yet, so each says one is needed, as News's do.
    assert.deepEqual(await jobs.locator('.set-row').evaluateAll(rows => rows.map(row => [row.querySelector('.t')!.textContent, row.querySelector('.s')!.textContent, row.lastElementChild!.textContent])), [
      ['Each email', 'Role title, requisition ID, the event, the match · needs a key', 'Claude Haiku 5.5'],
      ['Finding the JD', 'When the email\'s link and the platforms miss · needs a key', 'Claude Sonnet 5.5 with web search'],
      ['Reading the JD', 'Summary, must-haves and nice-to-haves, salary and setting · needs a key', 'Claude Haiku 5.5'],
      ['This month', 'No cap: a JD is worth finding while the posting is up', '$3.85'],
    ]);
    // No cap, so no meter and nothing to choose.
    assert.equal(await jobs.locator('.meter, .select, [role="meter"]').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
