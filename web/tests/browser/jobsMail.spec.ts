// Jobs in mail (J7; DESIGN.md › Jobs › In mail; boards 37a–37c; D306) against the seed: the Northwind
// interview email's JD chip in the reader and its popover; Open in Jobs arriving with the application
// open; Full posting arriving scrolled to the posting, unfolded (#271); the
// Contoso Pharmaceuticals match email's Applied before on its Noise row and in the reader, opening
// Jobs searched for the company; one request for the list's rows, not one per row; and, with Jobs
// turned off or on the phone (decision 49), neither slot drawn. The chip's, the popover's and the badge's own behaviour (their
// words, Esc, a click away) are the component tests' (web/tests/components/jobs.test.tsx); the company
// matching the server's (server/src/jobs/tests/reading.test.ts, inMail.test.ts).
import assert from 'node:assert/strict';
import {after} from 'node:test';
import type {AllOut, ApplicationOut, JobsPageOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {cleanUp, rested, startSetpoint, test, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

const INTERVIEW = 'Interview availability for Software Engineer I';
const MATCH = 'Associate Software Engineer @ Contoso Pharmaceuticals';

/** The seed's email with this subject. */
async function messageId(setpoint: Setpoint, subject: string): Promise<number> {
  const all = await setpoint.api<AllOut>('GET', '/mail/all?limit=500');
  const found = all.days.flatMap(day => day.rows).find(row => row.subject === subject);
  if (!found) throw new Error(`No email "${subject}".`);
  return found.id;
}

async function northwind(setpoint: Setpoint): Promise<number> {
  const {rows} = await setpoint.api<JobsPageOut>('GET', '/jobs');
  return rows.find(row => row.company === 'Northwind Talent' && row.title === 'Software Engineer I')!.id;
}

const pathOf = (page: Page) => Promise.resolve(new URL(page.url()).pathname + new URL(page.url()).search);

test('37a, 37b: the Northwind email\'s JD chip under the sender\'s line, and its popover; Open in Jobs arrives with it open', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [email, application] = [await messageId(setpoint, INTERVIEW), await northwind(setpoint)];
    await page.goto(`${setpoint.base}/inbox/${email}`);
    const chip = page.locator('.rd-head .jb-chip');
    await chip.waitFor();
    assert.equal(await chip.textContent(), 'Software Engineer I· Applied Oct 1 · In process');
    // Under the sender's line, above the actions, at the head's left edge.
    const [meta, box, actions] = await rested(() => Promise.all(['.rd-head .rd-meta', '.rd-head .jb-chip', '.rd-head .rd-acts'].map(selector => page.locator(selector).boundingBox())));
    assert.ok(meta!.y + meta!.height <= box!.y && box!.y + box!.height <= actions!.y, 'between the sender\'s line and the actions');
    assert.equal(box!.x, actions!.x);

    await chip.click();
    const popover = page.getByRole('dialog', {name: 'Job description'});
    await popover.waitFor();
    assert.equal(await chip.getAttribute('aria-expanded'), 'true');

    // Open in Jobs: the application open.
    await popover.getByRole('button', {name: 'Open in Jobs'}).click();
    await until('Jobs with Northwind open', () => pathOf(page), at => at === `/jobs/${application}`);
    const pane = page.locator('.jb-pane');
    await pane.locator('.jb-title', {hasText: 'Software Engineer I'}).waitFor();
    // Jobs's answers all in and drawn, so a later one can't move it after the read.
    await setpoint.idle();
    assert.equal(await page.locator('.jb-pane .rd-scroll').evaluate(scroller => scroller.scrollTop), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('37b, #271: Full posting arrives in Jobs scrolled to the full posting, unfolded; Esc folds it back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const [email, application] = [await messageId(setpoint, INTERVIEW), await northwind(setpoint)];
    await page.goto(`${setpoint.base}/inbox/${email}`);
    await page.locator('.rd-head .jb-chip').click();
    await page.getByRole('dialog', {name: 'Job description'}).getByRole('button', {name: 'Full posting'}).click();
    // It arrives, and the address drops what it carried.
    await until('Jobs with Northwind open', () => pathOf(page), at => at === `/jobs/${application}`);
    const posting = page.locator('.jb-pane .jb-posting');
    await posting.waitFor();
    assert.equal(await page.locator('.jb-pane .jb-src').count(), 0);
    const detail = await setpoint.api<ApplicationOut>('GET', `/jobs/applications/${application}`);
    assert.match((await posting.locator('.jb-full').textContent())!, new RegExp(`^${detail.posting!.full_text.split('\n')[0]!.replace(/^#+\s*/, '')}`));
    // Scrolled to: the posting's head at the top of the pane, under the tools, once Jobs's answers
    // are all in and drawn, so a later one can't move it after the read.
    await setpoint.idle();
    const [head, scroller] = await rested(() => Promise.all([posting.locator('.jb-fullhead').boundingBox(), page.locator('.jb-pane .rd-scroll').boundingBox()]));
    assert.ok(Math.abs(head!.y - scroller!.y) <= 1, `the posting's head at the pane's top: ${head!.y} beside ${scroller!.y}`);
    await page.keyboard.press('Escape');
    await page.locator('.jb-pane .jb-src').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('37c: Applied before on the Contoso Pharmaceuticals match email, on its Noise row and in the reader, opening Jobs searched for the company', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const asked: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/jobs/mail')) asked.push(new URL(request.url()).search);
    });
    const match = await messageId(setpoint, MATCH);
    await page.goto(`${setpoint.base}/inbox`);
    await until('the list\'s rows asked about', () => Promise.resolve(asked.length), count => count > 0);
    // Its day's Noise, folded until opened.
    const row = page.locator(`.list.all .row[data-id="${match}"]`);
    await page.locator('.list.all .nfold', {has: page.locator('.preview', {hasText: 'Indeed'})}).click();
    await row.waitFor();
    const badge = row.locator('.jb-badge');
    await badge.waitFor();
    assert.equal(await badge.textContent(), 'Applied Sep 16 · Rejected Oct 5');
    assert.equal(await badge.getAttribute('data-tip'), 'Open Jobs searched for Contoso Pharmaceuticals');
    assert.equal(await row.getAttribute('class'), 'row noise');
    // After the subject, before the account.
    const [subject, at, account] = await rested(() => Promise.all([row.locator('.subj'), badge, row.locator('.ac')].map(each => each.boundingBox())));
    assert.ok(subject!.x + subject!.width <= at!.x && at!.x + at!.width <= account!.x);
    // One request answered the rows the list first drew, not one per row; opening the day's Noise asked
    // about its one row alone. (The page taking focus refreshes what it shows, the same request again.)
    const sets = [...new Set(asked)];
    assert.equal(sets.length, 2, JSON.stringify(asked));
    assert.ok(sets[0]!.split(',').length > 20, sets[0]);
    assert.equal(sets[1], `?messages=${match}`);

    // In the reader, where the chip sits.
    await row.click();
    const large = page.locator('.rd-head .jb-badge.lg');
    await large.waitFor();
    assert.equal(await page.locator('.rd-head .jb-chip').count(), 0);

    // Either opens Jobs searched for the company, every application there.
    await large.click();
    await until('Jobs', () => pathOf(page), at => at === '/jobs');
    const field = page.getByRole('textbox', {name: 'Search jobs'});
    assert.equal(await field.inputValue(), 'contoso pharmaceuticals');
    await until('the results', () => page.locator('.jb-scroll .jb-tr .co').allTextContents(), companies => companies.length === 1 && companies[0] === 'Contoso Pharmaceuticals');
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    // Esc clears the query, then leaves search.
    await page.keyboard.press('Escape');
    await until('the query cleared', () => field.inputValue(), value => value === '');

    // The row's badge goes there too, without opening its email.
    await page.goBack();
    await page.goBack();
    await page.locator('.list.all .nfold', {has: page.locator('.preview', {hasText: 'Indeed'})}).click();
    await badge.click();
    await until('Jobs', () => pathOf(page), at => at === '/jobs');
    assert.equal(await page.getByRole('textbox', {name: 'Search jobs'}).inputValue(), 'contoso pharmaceuticals');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Jobs off: neither slot is drawn (D303)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    await setpoint.api('PATCH', '/jobs/settings', {enabled: false});
    const page = await setpoint.page('target');
    const [email, match] = [await messageId(setpoint, INTERVIEW), await messageId(setpoint, MATCH)];
    await page.goto(`${setpoint.base}/inbox/${email}`);
    await page.locator('.rd-head .rd-acts').waitFor();
    await page.locator('.list.all .nfold', {has: page.locator('.preview', {hasText: 'Indeed'})}).click();
    await page.locator(`.list.all .row[data-id="${match}"]`).waitFor();
    await setpoint.idle();
    assert.equal(await page.locator('.jb-chip, .jb-badge').count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone neither slot is drawn, and Jobs is never asked (decision 49)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    const asked: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/jobs/mail') || request.url().includes('/api/jobs/applications')) asked.push(request.url());
    });
    const [email, match] = [await messageId(setpoint, INTERVIEW), await messageId(setpoint, MATCH)];
    await page.goto(`${setpoint.base}/inbox/${email}`);
    await page.locator('.rd-subj', {hasText: INTERVIEW}).waitFor();
    await page.goto(`${setpoint.base}/inbox/${match}`);
    await page.locator('.rd-subj', {hasText: MATCH}).waitFor();
    await setpoint.idle();
    assert.equal(await page.locator('.jb-chip, .jb-badge').count(), 0);
    assert.deepEqual(asked, []);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
