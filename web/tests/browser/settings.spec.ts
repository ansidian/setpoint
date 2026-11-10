// Settings in the browser (F7; DESIGN.md › Settings): board 17 built and checked, then each page
// saving: the modal itself (⌘,, Esc, not in the address bar, a link straight to a page, Reconnect), Accounts
// (colour, rename, order, Connect Gmail's "not configured", Connect iCloud's form), Mail (a rule, Undo
// on a learned rule, a domain, code expiry), Notifications (Send test to a fake ntfy on 127.0.0.1,
// switches, defaults), Calendar (a calendar hidden, Home, weather, and SV-20's colours written to
// Google, waiting, refused, tried again and changed back), Todoist (SV-25's project colours, the same
// way, and the task rings that take them), AI (a key set write-only, a model), Appearance, and
// Security's recovery codes and paired iPhones (SV-84). The passkey ceremony is in passkey.spec.ts.
// N5 adds boards 30a and 30b: Settings › News (sources by section, read-only, no key row: #97) and AI's
// News group (its models, the cap, this month and its usage), and the cap reached.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {after} from 'node:test';
import type {AccountOut, AiOut, CalendarOut, MessageOut, NewsSourcesOut, PairOut, RuleOut, SecretOut, Settings, TodoistProjectOut, TrustedDomainOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {choose, cleanUp, rested, startSetpoint, test, until} from './harness.ts';

after(cleanUp);

/** The Inbox under Settings, loaded, then Settings at `page` (from its address, as a link would). */
async function openAt(page: Page, base: string, settingsPage: string) {
  await page.goto(`${base}/settings/${settingsPage}`);
  await page.locator('.settings').waitFor();
  await page.waitForURL(/\/inbox$/);
  await page.locator('.list .row').first().waitFor();
  await page.locator('.today-row').first().waitFor();
}

const settled = <T,>(what: string, read: () => Promise<T>, check: (value: T) => boolean) => until(what, read, check, 5000);

/**
 * A file the dev provider waits on while it's there (SETPOINT_DEV_PROVIDER_HOLD), so a change stays
 * pending, its spinner up, for as long as the check reads it rather than the provider's 600 ms.
 * Starts held.
 */
function providerHold() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-hold-'));
  const file = path.join(dir, 'hold');
  fs.writeFileSync(file, '');
  return {
    file,
    hold: () => fs.writeFileSync(file, ''),
    release: () => fs.rmSync(file, {force: true}),
    remove: () => fs.rmSync(dir, {recursive: true, force: true}),
  };
}

test('board 17: Settings › Accounts, Business needing sign-in and Personal stale', async () => {
  const setpoint = await startSetpoint({fixtures: ['needs-reconnect', 'stale-personal', 'checked', 'ntfy'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'accounts');
    await page.locator('.settings .set-row.warn', {hasText: 'Needs sign-in'}).waitFor();
    await page.locator('.settings .state', {hasText: 'Checks stopped, as of 9:14 PM'}).waitFor();
    await page.locator('.settings [data-source="todoist"]', {hasText: 'Inbox · 3 projects'}).waitFor();
    await page.locator('.hbar.caution').waitFor();
    assert.equal(await page.locator('.settings .set-nav .nav.on').textContent(), 'Accounts');
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).locator('.warn').count(), 1, 'Accounts is marked');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('each source says its state: checked, stopped as of when, failing in the provider\'s words, needing sign-in; the failing rows are marked', async () => {
  const setpoint = await startSetpoint({fixtures: ['needs-reconnect', 'stale-personal', 'failing-work', 'checked', 'stale-todoist'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'accounts');
    const account = (label: string) => page.locator('.settings [data-account]', {hasText: label});
    await account('Personal').locator('.state').getByText('Checks stopped, as of 9:14 PM').waitFor();
    await account('Work').locator('.state').getByText('Gmail answered 503.').waitFor();
    // A failing row is marked, as a row needing sign-in is.
    assert.deepEqual(await page.locator('.settings .set-row.warn[data-account]').evaluateAll(rows => rows.map(row => row.textContent!.match(/^(Business|Work)/)?.[0])), ['Business', 'Work']);
    // Todoist's row in Sources, its connection's only place (D514), and Settings › News with the seed's FOX 11 failing.
    await page.locator('.settings [data-source="todoist"] .state.stale').getByText('Checks stopped, as of 8:40 AM').waitFor();
    await page.locator('.settings .set-nav .nav', {hasText: 'News'}).click();
    await page.locator('.settings .news-src.warn', {hasText: 'FOX 11'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A colour or background as the page computes it, mixes included. */
const computed = (page: Page, property: 'color' | 'background', value: string) => page.evaluate(([name, css]) => {
  const probe = document.createElement('div');
  probe.style[name as 'color'] = css;
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const out = name === 'color' ? style.color : style.backgroundColor;
  probe.remove();
  return out;
}, [property, value] as const);

test('board 30a: Settings › News, after Calendar, its warning glyph while FOX 11 fails; sources by section, read-only', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'news');
    const fox = page.locator('.settings .news-src', {hasText: 'FOX 11'});
    await fox.waitFor();
    // The nav's three groups (D512): Accounts · Mail, Calendar, News, Jobs (J8; its page is
    // jobsStates.spec.ts's) · Notifications, AI, Appearance, Security, a gap before each group's first.
    assert.deepEqual(await page.locator('.settings .set-nav .nav').allTextContents(), ['Accounts', 'Mail', 'Calendar', 'News', 'Jobs', 'Notifications', 'AI', 'Appearance', 'Security', 'Sign out']);
    assert.deepEqual(await page.locator('.settings .set-nav .nav.gap').allTextContents(), ['Mail', 'Notifications']);
    // ↑ ↓ walk the nav in its order, wrapping at the ends, all the way round to News.
    await page.locator('.settings .set-nav .nav.on').focus();
    for (const [key, next] of [...['Jobs', 'Notifications', 'AI', 'Appearance', 'Security', 'Accounts', 'Mail', 'Calendar', 'News'].map(name => ['ArrowDown', name]), ['ArrowUp', 'Calendar'], ['ArrowDown', 'News']]) {
      await page.keyboard.press(key!);
      await page.locator('.settings .set-nav .nav.on', {hasText: new RegExp(`^${next}$`)}).waitFor();
    }
    assert.equal(await page.locator('.settings .set-nav .nav.on').textContent(), 'News');
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'News'}).locator('.warn').count(), 1, 'News carries the warning glyph');
    // The head's counts, then one group per section with its count, and no Keys group (#97).
    const sources = await setpoint.api<NewsSourcesOut>('GET', '/news/sources');
    assert.equal(await page.locator('.settings .set-head .head-note').textContent(), `${sources.articles_today} articles today · ${sources.stories_on_page} stories`);
    assert.deepEqual(await page.locator('.settings .set-label').allTextContents(),
      sources.sections.map(({section, sources: list}) => `${{local: 'Local', tech: 'Tech', ai: 'AI', general: 'General'}[section]} ${list.length}`));
    // FOX 11 says it's failing, and why; the rest say when they were checked.
    assert.equal(await fox.locator('.state').textContent(), 'Failing, 404 since 6:02 AM');
    assert.equal(await fox.locator('.state').getAttribute('data-tip'), '404 Not Found');
    const ktla = page.locator('.settings .news-src', {hasText: 'KTLA'});
    assert.deepEqual(await ktla.evaluate(element => [element.querySelector('.t')?.textContent, element.querySelector('.s')?.textContent, element.querySelector('.prov')?.textContent, element.querySelector('.state')?.textContent]),
      ['KTLA · Local news', 'Feed, summary only', 'Every 15 min', 'Checked 9:10 AM']);
    assert.equal(await page.locator('.settings .news-src', {hasText: 'National Weather Service'}).locator('.prov').textContent(), 'Every 5 min');
    assert.equal(await page.locator('.settings .set-main').locator('.switch, .handle, [draggable="true"]').count(), 0, 'read-only: no handles, no switches');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 30b: Settings › AI with News: its models, the monthly cap, this month on its meter, and the month\'s usage', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'ai');
    const amount = page.locator('.settings .amount');
    await amount.waitFor();
    assert.equal(await amount.textContent(), '$18.40 of $40');
    // Jobs's group follows News's (J8; its own check is jobsStates.spec.ts's).
    assert.deepEqual(await page.locator('.settings .set-label').evaluateAll(labels => labels.map(label => label.firstChild!.textContent)), ['Keys', 'Mail', 'News', 'Jobs', 'Usage this month']);
    const news = page.locator('.settings .set-sec', {has: page.locator('.set-label', {hasText: /^News$/})});
    assert.deepEqual(await news.locator('.set-row .t').allTextContents(), ['Articles and grouping', 'Stories and ranking', 'Monthly cap', 'This month']);
    assert.deepEqual(await news.locator('.val').allTextContents(), ['Claude Haiku 5.5', 'Claude Sonnet 5.5']);
    assert.equal(await news.getByRole('button', {name: 'Monthly cap', exact: true}).textContent(), '$40');
    // How far the meter fills is capMeter's, a table in news.test.ts; its width on screen is by eye (D417).
    const meter = news.locator('.meter');

    // Usage this month: Triage, Search terms, Search reading, Alfred, News and Jobs, News and Jobs in their parts.
    const usage = page.locator('.settings .set-sec', {has: page.locator('.set-label', {hasText: 'Usage this month'})});
    assert.deepEqual(await usage.locator('.set-row').evaluateAll(rows => rows.map(element => [element.querySelector('.t')?.textContent, element.querySelector('.s')?.textContent, element.querySelector('.cost')?.textContent])), [
      ['Triage', '1,214 calls · 2.4M tokens in · 49k out', '$2.10'],
      ['Search terms', '312 calls · 468k tokens in · 11k out', '$0.04'],
      ['Search reading', '48 calls · 60k tokens in · 2k out', '$0.01'],
      ['Alfred', '18 calls · 112k tokens in · 8k out', '$0.85'],
      ['News', 'Articles $1.90 · grouping $1.20 · stories $13.10 · ranking $2.20', '$18.40'],
      ['Jobs', 'Emails $0.62 · finding JDs $2.71 · reading JDs $0.52 · no cap', '$3.85'],
    ]);
    // The month's total in the label.
    assert.equal(await usage.locator('.set-label .r').textContent(), '$25.25');

    // The cap is editable, as board 30b draws it; it saves through PATCH /api/settings. From 90% of it
    // the meter is near, before the cap is reached; under that, plain again.
    await choose(page, 'Monthly cap', '$20');
    await amount.filter({hasText: '$18.40 of $20'}).waitFor();
    assert.match(await meter.getAttribute('class') ?? '', /\bnear\b/);
    await choose(page, 'Monthly cap', '$50');
    await settled('the cap saved', () => setpoint.api<Settings>('GET', '/settings'), value => value.news.monthly_cap_usd === 50);
    await amount.filter({hasText: '$18.40 of $50'}).waitFor();
    assert.equal(await meter.getAttribute('class'), 'meter');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('at the cap, This month says so; a higher cap takes it back', async () => {
  const setpoint = await startSetpoint({fixtures: ['news-capped'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'ai');
    const month = page.locator('.settings .set-row', {has: page.locator('.amount')});
    await month.locator('.amount', {hasText: '$40.40 of $40'}).waitFor();
    const line = month.locator('.s .caution');
    assert.equal(await line.textContent(), 'Cap reached, summaries use Claude Haiku 5.5 until Nov 1');
    await choose(page, 'Monthly cap', '$50');
    await month.locator('.amount', {hasText: '$40.40 of $50'}).waitFor();
    await line.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

// A long page keeping its title, × and a section's label in place as it scrolls is CSS, by eye (D416).
test('the modal: ⌘, and the sidebar open it over the page, not in the address bar; Esc closes; the bar\'s Reconnect goes straight to Google for its one Gmail account', async () => {
  const setpoint = await startSetpoint({fixtures: ['needs-reconnect'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    await page.keyboard.press('Meta+,');
    await page.locator('.settings').waitFor();
    assert.equal(new URL(page.url()).pathname, '/calendar', 'the page under it keeps the address');
    // The current page is marked, with the keys in the nav, opened with ⌘, or after ↓.
    const current = page.locator('.settings .set-nav .nav.on');
    const currentFill = async () => current.evaluate(nav => [nav.textContent, document.activeElement === nav]);
    await until('Accounts marked, with the keys on it', currentFill, now => JSON.stringify(now) === JSON.stringify(['Accounts', true]));
    // ↓ in the nav changes page; keys inside never reach the page (2 would go to Calendar, J would move a cursor).
    // ↓ from Accounts is Mail, the middle group's first (D512).
    await page.keyboard.press('ArrowDown');
    await page.locator('.settings .set-title', {hasText: 'Mail'}).waitFor();
    await until('Mail marked, with the keys on it', currentFill, now => JSON.stringify(now) === JSON.stringify(['Mail', true]));
    await page.keyboard.press('1');
    assert.equal(new URL(page.url()).pathname, '/calendar');

    await page.keyboard.press('Escape');
    await page.locator('.settings').waitFor({state: 'detached'});
    // The scrim closes it too.
    await page.locator('.sb-foot .nav', {hasText: 'Settings'}).click();
    await page.locator('.settings').waitFor();
    await page.mouse.click(40, 500);
    await page.locator('.settings').waitFor({state: 'detached'});

    // Back from Google's consent with a refusal: Accounts opens, and the toast says so.
    await page.goto(`${setpoint.base}/settings/accounts?error=access_denied`);
    await page.locator('.settings .set-title', {hasText: 'Accounts'}).waitFor();
    await page.locator('.toast', {hasText: 'Gmail couldn’t be connected, access denied'}).waitFor();
    // The toast sits above Settings and its scrim, not under them (SV-25).
    assert.equal(await rested(() => page.locator('.toast').evaluate(toast => {
      const box = toast.getBoundingClientRect();
      return toast.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    })), true);
    await page.keyboard.press('Escape');

    // The bar's Reconnect goes straight to Google's sign-in for the one Gmail account needing it, not
    // to Settings first (the polish audit's states-08). Google stands in as an address back here.
    await page.goto(`${setpoint.base}/inbox`);
    const business = (await setpoint.api<AccountOut[]>('GET', '/accounts')).find(account => account.label === 'Business')!;
    await page.route('**/api/accounts/gmail/authorize', route => route.fulfill({json: {url: `${setpoint.base}/inbox?consented`}}));
    const asked = page.waitForRequest(request => request.url().endsWith('/api/accounts/gmail/authorize'));
    await page.locator('.hbar.caution .act').click();
    assert.deepEqual((await asked).postDataJSON(), {account_id: business.id});
    await page.waitForURL(/\/inbox\?consented$/);
    await page.unroute('**/api/accounts/gmail/authorize');
    assert.equal(await page.locator('.settings').count(), 0, 'not Settings first');
    await page.locator('.sb-foot .nav', {hasText: 'Settings'}).click();
    await page.locator('.settings .set-title', {hasText: 'Accounts'}).waitFor();
    await page.keyboard.press('Meta+f');
    assert.equal(await page.evaluate(() => document.activeElement?.closest('.settings') !== null), true, '⌘F doesn\'t reach the Inbox\'s search');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Accounts: colour, rename and order save; Connect Gmail says Google isn\'t set up here; Connect iCloud asks for an app password', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'accounts');
    const accounts = () => setpoint.api<AccountOut[]>('GET', '/accounts');
    const business = page.locator('.settings [data-account]', {hasText: 'Business'});

    await business.locator('.sw').first().click();
    await page.locator('.settings .swatches .sw[aria-label="cyan"]').click();
    await settled('Business is cyan', accounts, list => list.find(account => account.label === 'Business')?.colour === 'cyan');
    assert.equal(await rested(() => page.locator('.list .ac', {hasText: 'Business'}).first().locator('.dot').evaluate(dot => getComputedStyle(dot).getPropertyValue('--c').trim())), 'oklch(0.86 0.11 182)', 'the Inbox\'s rows follow (cyan)');

    await business.getByRole('button', {name: 'Business options'}).click();
    await page.getByRole('menuitem', {name: 'Rename'}).click();
    await page.locator('.settings input[name="label"]').fill('Studio');
    await page.keyboard.press('Enter');
    await settled('renamed', accounts, list => list.some(account => account.label === 'Studio'));

    // ↓ on Studio's handle moves it below Personal.
    await page.locator('.settings .handle[aria-label="Move Studio"]').focus();
    await page.keyboard.press('ArrowDown');
    await settled('reordered', accounts, list => list.sort((a, b) => a.position - b.position).map(account => account.label).slice(0, 2).join() === 'Personal,Studio');

    const authorize = page.waitForRequest(request => request.url().endsWith('/api/accounts/gmail/authorize') && request.method() === 'POST');
    await page.getByRole('button', {name: 'Connect Gmail'}).click();
    await authorize;
    await page.locator('.settings .line.failed', {hasText: 'Google sign-in isn\'t set up on this Setpoint'}).waitFor();

    await page.getByRole('button', {name: 'Connect iCloud'}).click();
    await page.locator('.settings input[name="password"]').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mail: a long list of trusted domains shows some and Show all, a rule added, a learned rule undone, a domain untrusted, the code expiry changed', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    await page.locator('.settings .dom', {hasText: 'Show all 78'}).waitFor();
    const rules = () => setpoint.api<RuleOut[]>('GET', '/mail/rules');

    await page.getByRole('button', {name: 'Add rule'}).click();
    await page.locator('.settings input[name="from"]').fill('alerts.contoso.example');
    // SV-235 (D487): "and…" adds a filter, which then leaves the menu.
    await page.getByRole('button', {name: 'and…'}).click();
    await page.getByRole('menuitem', {name: 'Subject doesn’t contain'}).click();
    await page.getByRole('textbox', {name: 'Subject doesn’t contain'}).fill('digest');
    await page.getByRole('button', {name: 'and…'}).click();
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Subject contains', 'Sender name contains', 'Sender name doesn’t contain', 'Body contains', 'Body doesn’t contain']);
    await page.keyboard.press('Escape');
    await choose(page, 'Send to', 'FYI · Security');
    // Its actions under Send to (SV-236): Mark read's switch, and Trash's six presets (SV-237).
    await page.getByRole('switch', {name: 'Mark read'}).click();
    assert.deepEqual(await page.getByRole('radiogroup', {name: 'Trash'}).getByRole('radio').allTextContents(), ['Never', 'Now', '15 min', '1 hour', '1 day', '1 week']);
    await page.getByRole('radio', {name: '1 day'}).click();
    await page.getByRole('button', {name: 'Add', exact: true}).click();
    await settled('the new rule', rules, list => list.some(rule => rule.match.from_domains?.[0] === 'alerts.contoso.example' && rule.match.subject_excludes?.[0] === 'digest' && rule.kind === 'security' && rule.mark_read && rule.trash === '1d'));
    await page.locator('.settings .rule', {hasText: 'FYI · Security, mark read, trash after 1 day'}).waitFor();
    // A rule's menu turns it off with toggle_off and back on with toggle_on (#123).
    const added = page.locator('.settings .set-row', {hasText: 'alerts.contoso.example'});
    await added.getByRole('button', {name: 'Rule options'}).click();
    const turnOff = page.getByRole('menuitem', {name: 'Turn off'});
    assert.equal(await turnOff.locator('.icon path').getAttribute('d'), ICONS.toggle_off);
    await turnOff.click();
    await settled('the rule off', rules, list => list.some(rule => rule.match.from_domains?.[0] === 'alerts.contoso.example' && !rule.enabled));
    await added.locator('.when', {hasText: 'Off'}).waitFor();
    await added.getByRole('button', {name: 'Rule options'}).click();
    const turnOn = page.getByRole('menuitem', {name: 'Turn on'});
    assert.equal(await turnOn.locator('.icon path').getAttribute('d'), ICONS.toggle_on);
    await turnOn.click();
    await settled('the rule on', rules, list => list.some(rule => rule.match.from_domains?.[0] === 'alerts.contoso.example' && rule.enabled));

    await page.locator('.settings .set-row', {hasText: 'Northwind newsletters'}).getByRole('button', {name: 'Undo'}).click();
    await settled('Undo', rules, list => !list.some(rule => rule.match.organisation === 'Northwind'));

    await page.locator('.settings .mini-field input').fill('woodgrovebank');
    assert.deepEqual(await page.locator('.settings .dom').allTextContents(), ['woodgrovebank.example']);
    await page.getByRole('button', {name: 'Remove woodgrovebank.example'}).click();
    await settled('untrusted', () => setpoint.api<TrustedDomainOut[]>('GET', '/mail/trusted-domains'), list => list.length === 77);
    // SV-25 (D54): nothing matching is one line, nothing cut off.
    const empty = page.locator('.settings .set-row', {hasText: 'No domain matches'});
    assert.ok(await rested(() => empty.evaluate(row => row.scrollWidth <= row.clientWidth)), 'the line isn\'t cut off');

    await page.getByRole('radio', {name: '30 min'}).click();
    await settled('code expiry', () => setpoint.api<Settings>('GET', '/settings'), settings => settings.mail.code_expiry_minutes === 30);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-238 (D495): Turn off or Delete on a rule with trashes waiting asks, Cancel them first; Esc leaves the rule as it was, ↵ cancels them, Let them run keeps them', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules'], clock: 'frozen'});
  try {
    const rules = () => setpoint.api<RuleOut[]>('GET', '/mail/rules');
    const written = await rules();
    const idFrom = (domain: string) => written.find(rule => rule.match.from_domains?.[0] === domain)!.id;
    const bankId = idFrom('woodgrovebank.example');
    const fabrikamId = idFrom('news.fabrikam.com');
    // Three emails the bank's rule set to be trashed tomorrow, one the Fabrikam rule did.
    const database = new DatabaseSync(path.join(setpoint.dataDir, 'setpoint.sqlite'));
    let ids: number[] = [];
    try {
      database.exec('PRAGMA busy_timeout = 5000');
      ids = database.prepare('SELECT id FROM messages WHERE trashed_at IS NULL AND pinned_at IS NULL AND protected = 0 ORDER BY id LIMIT 4').all().map(row => Number(row.id));
      const due = database.prepare('UPDATE messages SET triage_rule_id = ?, trash_due_at = ? WHERE id = ?');
      ids.forEach((id, index) => due.run(index < 3 ? bankId : fabrikamId, '2026-10-08T14:02:00.000Z', id));
    } finally {
      database.close();
    }
    const dueOf = async (id: number) => (await setpoint.api<MessageOut>('GET', `/mail/messages/${id}`)).trash_due_at;

    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    const row = (domain: string) => page.locator('.settings .set-row', {hasText: domain});
    const ask = page.getByRole('dialog', {name: '3 emails are waiting to be trashed'});
    const choices = ask.getByRole('radiogroup', {name: 'What becomes of them'}).getByRole('radio');
    await row('woodgrovebank.example').getByRole('button', {name: 'Rule options'}).click();
    await page.getByRole('menuitem', {name: 'Turn off'}).click();
    await ask.waitFor();
    assert.deepEqual(await choices.allTextContents(), ['Cancel them3 emails stay', 'Let them run3 emails go to the trash as planned']);
    assert.equal(await ask.getByRole('radio', {checked: true}).textContent(), 'Cancel them3 emails stay');
    assert.deepEqual(await ask.getByRole('button').allTextContents(), ['Turn off↵', 'CancelEsc']);
    // Esc leaves the rule as it was, and Settings open.
    await page.keyboard.press('Escape');
    await ask.waitFor({state: 'detached'});
    await page.locator('.settings').waitFor();
    assert.deepEqual((await rules()).filter(rule => rule.id === bankId).map(rule => [rule.enabled, rule.trashes_waiting]), [[true, 3]]);
    // ↵ turns it off with Cancel them: the three emails stay.
    await row('woodgrovebank.example').getByRole('button', {name: 'Rule options'}).click();
    await page.getByRole('menuitem', {name: 'Turn off'}).click();
    await ask.waitFor();
    await page.keyboard.press('Enter');
    await settled('the rule off, nothing waiting', rules, list => list.some(rule => rule.id === bankId && !rule.enabled && rule.trashes_waiting === 0));
    assert.deepEqual(await Promise.all(ids.slice(0, 3).map(dueOf)), [null, null, null]);

    // Delete with Let them run: the rule goes, its one email keeps its due time.
    await row('news.fabrikam.com').getByRole('button', {name: 'Rule options'}).click();
    await page.getByRole('menuitem', {name: 'Delete'}).click();
    const one = page.getByRole('dialog', {name: '1 email is waiting to be trashed'});
    await one.getByRole('radio', {name: 'Let them run 1 email goes to the trash as planned'}).click();
    await one.getByRole('button', {name: 'Delete'}).click();
    await settled('the rule gone', rules, list => !list.some(rule => rule.id === fabrikamId));
    assert.equal(await dueOf(ids[3]!), '2026-10-08T14:02:00.000Z');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S11 (SV-25, D54): Esc in an inline form (Add rule, Connect iCloud, Change password, Add passkey) cancels the form first, as Rename does, and Settings stays open', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    const escCancels = async (field: string, form: string) => {
      await page.locator(`.settings input[name="${field}"]`).focus();
      await page.keyboard.press('Escape');
      await page.locator(`.settings ${form}`).waitFor({state: 'detached'});
      assert.ok(await page.locator('.settings').isVisible(), 'Settings stays open');
    };
    await openAt(page, setpoint.base, 'mail');
    await page.getByRole('button', {name: 'Add rule'}).first().click();
    await escCancels('from', 'input[name="from"]');

    await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).click();
    await page.getByRole('button', {name: 'Connect iCloud'}).click();
    await escCancels('password', 'input[name="password"]');

    await page.locator('.settings .set-nav .nav', {hasText: 'Security'}).click();
    await page.getByRole('button', {name: 'Change', exact: true}).click();
    await escCancels('again', 'input[name="again"]');
    await page.getByRole('button', {name: 'Add passkey'}).first().click();
    await escCancels('label', 'input[name="label"]');

    // With no form open, Esc closes Settings.
    await page.locator('.settings .set-nav .nav.on').focus();
    await page.keyboard.press('Escape');
    await page.locator('.settings').waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S8 (SV-25, D54): a domain the server won\'t untrust says so in the toast; Check now reads Checking… on its row, then the result, or why it couldn\'t', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules']});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    const failing = {status: 502, json: {error: {code: 'provider_failed', message: 'Setpoint\'s database is busy.'}}};
    await page.route('**/api/mail/trusted-domains/**', route => route.fulfill(failing));
    await page.locator('.settings .mini-field input').fill('woodgrovebank');
    await page.getByRole('button', {name: 'Remove woodgrovebank.example'}).click();
    await page.locator('.toast', {hasText: 'Couldn\'t remove woodgrovebank.example, Setpoint\'s database is busy.'}).waitFor();
    await page.unroute('**/api/mail/trusted-domains/**');

    await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).click();
    const weather = page.locator('.settings [data-source="weather"]');
    await weather.waitFor();
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route('**/api/sources/*/check', async route => {
      await held;
      await route.continue();
    });
    await weather.getByRole('button', {name: 'Weather options'}).click();
    await page.getByRole('menuitem', {name: 'Check now'}).click();
    await weather.locator('.state', {hasText: 'Checking…'}).waitFor();
    release();
    await until('the check lands', () => weather.locator('.state').textContent(), text => !text!.includes('Checking…'), 20_000);
    await page.unroute('**/api/sources/*/check');

    await page.route('**/api/sources/*/check', route => route.fulfill(failing));
    await weather.getByRole('button', {name: 'Weather options'}).click();
    await page.getByRole('menuitem', {name: 'Check now'}).click();
    await weather.locator('.state', {hasText: 'Couldn\'t check, Setpoint\'s database is busy.'}).waitFor();
    await page.unroute('**/api/sources/*/check');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S12 (SV-25, D54): "No rules yet · Add rule" has Add rule as a button, reached by Tab, opening the form', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    const empty = page.locator('.settings .set-row', {hasText: 'No rules yet'}).getByRole('button', {name: 'Add rule'});
    await page.locator('.settings .set-label').getByRole('button', {name: 'Add rule'}).focus();
    await page.keyboard.press('Tab');
    assert.equal(await empty.evaluate(button => document.activeElement === button), true, 'Tab reaches it');
    await page.keyboard.press('Enter');
    await page.locator('.settings input[name="from"]').waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/** A fake ntfy on 127.0.0.1: it records each publish, with its Authorization header. */
async function fakeNtfy() {
  const published: {topic: string; title: string; authorization?: string}[] = [];
  const server = http.createServer((request, response) => {
    let text = '';
    request.on('data', chunk => (text += chunk));
    request.on('end', () => {
      published.push({...JSON.parse(text), authorization: request.headers.authorization});
      response.writeHead(200, {'content-type': 'application/json'}).end('{"id":"msg","event":"message"}');
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, published, close: () => new Promise(resolve => server.close(resolve))};
}

test('Notifications: the server and its token, Send test reaching a fake ntfy, the switches and the defaults; Time to Leave is on Calendar (D513)', async () => {
  const ntfy = await fakeNtfy();
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'notifications');
    const settings = () => setpoint.api<Settings>('GET', '/settings');
    await page.locator('.settings .set-label', {hasText: 'Not set up'}).waitFor();
    // With no server, the topics' switches can't work: off and disabled, saying what's missing, and no
    // Send test (UX #13). Time to Leave's group isn't here: it's on Calendar (D513).
    for (const name of ['setpoint-reminders', 'setpoint-mail', 'FYI mail', 'Reconnect alerts']) {
      const toggle = page.getByRole('switch', {name});
      assert.deepEqual([await toggle.isDisabled(), await toggle.getAttribute('aria-checked')], [true, 'false'], name);
    }
    assert.equal(await page.locator('.settings .set-row', {hasText: 'setpoint-reminders'}).locator('.s').textContent(), 'Set a server first');
    // FYI mail says so too; with a server it has no second line (D517).
    const fyi = page.locator('.settings .set-row', {has: page.getByRole('switch', {name: 'FYI mail'})});
    assert.equal(await fyi.locator('.s').textContent(), 'Set a server first');
    assert.equal(await page.getByRole('button', {name: 'Send test'}).count(), 0);
    assert.deepEqual(await page.locator('.settings .set-label').allTextContents().then(labels => labels.map(label => label.split(/Not set up/)[0])), ['ntfy', 'Reminder defaults', 'Alerts']);
    assert.equal(await page.getByRole('switch', {name: 'Time to Leave'}).count(), 0);
    await page.locator('.settings input[aria-label="ntfy server"]').fill(ntfy.url);
    await page.keyboard.press('Enter');
    await settled('the server', settings, value => value.notifications.ntfy_server === ntfy.url);
    await until('the switches work', () => page.getByRole('switch', {name: 'setpoint-reminders'}).isDisabled(), disabled => !disabled);
    assert.equal(await fyi.locator('.s').count(), 0);

    // The token is write-only, like an AI key, and goes with each publish.
    const token = page.locator('.settings [data-secret="ntfy_token"]');
    await token.locator('.s', {hasText: 'If the server asks for one · Not set'}).waitFor();
    await token.getByRole('button', {name: 'Set token'}).click();
    await token.locator('input[aria-label="Token"]').fill('tk_fake-browser-check');
    await page.keyboard.press('Enter');
    await token.locator('.s', {hasText: 'If the server asks for one · Set'}).waitFor();
    assert.equal(await page.locator('.settings').evaluate(modal => modal.textContent?.includes('tk_fake-browser-check')), false, 'the token never shows');

    await page.getByRole('button', {name: 'Send test'}).click();
    await page.locator('.settings .line', {hasText: 'Sent to setpoint-reminders'}).waitFor();
    assert.deepEqual(ntfy.published.map(message => [message.topic, message.title, message.authorization]), [['setpoint-reminders', 'Setpoint', 'Bearer tk_fake-browser-check']]);
    await page.locator('.settings .set-label', {hasText: 'Connected · last sent 9:12 AM'}).waitFor();

    await page.getByRole('switch', {name: 'setpoint-mail'}).click();
    await page.getByRole('switch', {name: 'FYI mail'}).click();
    await page.getByRole('switch', {name: 'setpoint-reminders'}).click();
    await page.getByRole('switch', {name: 'Reconnect alerts'}).click();
    await settled('switches', settings, value => value.notifications.attention_mail && value.notifications.fyi_mail && !value.notifications.reminders && !value.notifications.reconnect_alerts);
    await page.locator('.settings .set-row', {hasText: 'setpoint-mail'}).locator('.s', {hasText: /^Attention mail$/}).waitFor();

    await choose(page, 'Event reminders', '30 min before');
    await choose(page, 'Task reminders', '8:00 AM on the due day');
    await settled('defaults', settings, value => value.reminders.event_minutes_before === 30 && value.reminders.task_time === '08:00');
    // Each default offers None (D49).
    await choose(page, 'Event reminders', 'None');
    await choose(page, 'Task reminders', 'None');
    await settled('reminder defaults at None', settings, value => value.reminders.event_minutes_before === null && value.reminders.task_time === null);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await ntfy.close();
  }
});

test('Send test (the polish audit\'s states-11, settings-07): it shows it\'s sending, a failure says so in words, a test that went says so, and the Server field says it saved', async () => {
  const ntfy = await fakeNtfy();
  // A server nothing answers at: a port just closed.
  const closed = http.createServer();
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve));
  const unreachable = `127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise(resolve => closed.close(resolve));
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'notifications');
    const server = page.locator('.settings input[aria-label="ntfy server"]');
    await server.fill(`http://${unreachable}`);
    await page.keyboard.press('Enter');
    // Saved.
    const saved = page.locator('.settings .fld-at .saved');
    await saved.waitFor();

    const button = page.getByRole('button', {name: 'Send test'});
    let release = () => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    await page.route('**/api/notifications/test', async route => {
      await held;
      await route.continue();
    });
    await button.click();
    // While it sends, the shared spinner stands where its glyph was.
    await button.locator('.spin').waitFor();
    release();
    // A failure is a failure, in words rather than Node's "fetch failed".
    const line = page.locator('.settings .line');
    await line.filter({hasText: `Not sent, Can’t reach ${unreachable}`}).waitFor();
    assert.equal(await line.getAttribute('class'), 'line failed');
    // The header agrees, as a source failing does.
    const header = page.locator('.settings .set-label', {hasText: 'ntfy'});
    await header.getByText(`Failing, Can’t reach ${unreachable}`).waitFor();
    await page.unroute('**/api/notifications/test');

    // A server that answers: the test goes, and its line says so.
    await server.fill(ntfy.url);
    await page.keyboard.press('Enter');
    await settled('the server', () => setpoint.api<Settings>('GET', '/settings'), value => value.notifications.ntfy_server === ntfy.url);
    await button.click();
    await line.filter({hasText: 'Sent to setpoint-reminders'}).waitFor();
    assert.equal(await line.getAttribute('class'), 'line done');
    assert.equal(ntfy.published.length, 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await ntfy.close();
  }
});

test('Calendar and Appearance: a calendar unlisted, Home set with its coordinates, Time to Leave waiting for Home then on with its buffer (D513), Todoist\'s default project, weather off, Light; Todoist reconnects from Accounts', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'calendar');
    const settings = () => setpoint.api<Settings>('GET', '/settings');
    // Every group has its label.
    await page.getByRole('switch', {name: 'Show Classes'}).waitFor();
    // Time to Leave's group is here, under Home (D513), and Todoist's projects and default project are a section (D514).
    assert.deepEqual(await page.locator('.settings .set-label').allTextContents(), ['Calendars', 'Home', 'Time to Leave', 'Todoist', 'Weather and places']);
    // Without Home, Time to Leave can't work: off and disabled, saying what's missing (UX #13).
    const leave = page.getByRole('switch', {name: 'Time to Leave'});
    const leaveRow = page.locator('.settings .set-row', {has: leave});
    assert.deepEqual([await leave.isDisabled(), await leave.getAttribute('aria-checked')], [true, 'false']);
    assert.equal(await leaveRow.locator('.s').textContent(), 'Set Home first');

    await page.getByRole('switch', {name: 'Show Classes'}).click();
    await settled('Classes hidden', () => setpoint.api<CalendarOut[]>('GET', '/calendars'), list => list.find(calendar => calendar.name === 'Classes')?.listed === false);

    await page.getByRole('button', {name: 'Set Home'}).click();
    await page.locator('.settings input[aria-label="Home"]').fill('blue door');
    await page.locator('.settings button.set-row', {hasText: 'Blue Door Bistro'}).click();
    const home = await settled('Home', settings, value => value.calendar.home !== null);
    assert.deepEqual(home.calendar.home, {label: 'Home', address: '845 Example St, Los Angeles', lat: 34.1478, lng: -118.1445});
    await page.locator('.settings .set-row', {hasText: '845 Example St, Los Angeles'}).waitFor();
    // With Home, Time to Leave says where it leaves from and shows on, as it's kept; it turns off and
    // back on, and the buffer steps by 5 min.
    await leaveRow.locator('.s', {hasText: /^Live routes from Home$/}).waitFor();
    assert.deepEqual([home.time_to_leave, await leave.isDisabled(), await leave.getAttribute('aria-checked')], [{enabled: true, buffer_minutes: 5}, false, 'true']);
    await leave.click();
    await settled('Time to Leave off', settings, value => !value.time_to_leave.enabled);
    await page.locator('.settings [role="switch"][aria-label="Time to Leave"][aria-checked="false"]').waitFor();
    await leave.click();
    await page.getByRole('group', {name: 'Buffer'}).getByRole('button', {name: 'More'}).click();
    await settled('Time to Leave on, buffer', settings, value => value.time_to_leave.enabled && value.time_to_leave.buffer_minutes === 10);
    await page.locator('.settings .stepper .v', {hasText: '10 min'}).waitFor();

    await choose(page, 'Default project', 'School');
    await settled('default project', settings, value => value.todoist.default_project === 'School');

    await page.getByRole('switch', {name: 'Weather'}).click();
    await settled('weather off', settings, value => !value.calendar.weather);

    // Reconnect is in Todoist's row's menu on Accounts; the dev run has no Todoist app, so it says why under Sources.
    await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).click();
    await page.getByRole('button', {name: 'Todoist options'}).click();
    await page.getByRole('menuitem', {name: 'Reconnect'}).click();
    await page.locator('.settings .line.failed').waitFor();

    await page.locator('.settings .set-nav .nav', {hasText: 'Appearance'}).click();
    await page.getByRole('radio', {name: /Light/}).click();
    await until('Light', () => page.evaluate(() => document.documentElement.dataset.theme), theme => theme === 'light');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-20: a calendar\'s colour, picked from the swatches, waits for Google at .5 with its spinner, then shows on the calendar; one Google refuses stays with its words until Try again or Change back', async () => {
  const provider = providerHold();
  const setpoint = await startSetpoint({clock: 'frozen', env: {SETPOINT_DEV_PROVIDER_HOLD: provider.file}});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'calendar');
    const calendars = () => setpoint.api<CalendarOut[]>('GET', '/calendars');
    const personal = page.locator('.settings [data-calendar]', {hasText: 'Personal'});
    // Todoist has its ring and no colour to pick.
    assert.equal(await page.locator('.settings [data-calendar]', {hasText: 'Todoist'}).locator('.sw').count(), 0);

    await personal.getByRole('button', {name: 'Personal colour'}).click();
    // Nine of darma's swatches: caution and alert keep their jobs (#163).
    assert.deepEqual(await page.locator('.settings .swatches .sw').evaluateAll(swatches => swatches.map(swatch => swatch.getAttribute('aria-label'))),
      ['ink2', 'ink3', 'cool', 'warm', 'comf', 'good', 'sun', 'violet', 'cyan']);
    await page.locator('.settings .swatches .sw[aria-label="violet"]').click();
    await personal.locator('.spin').waitFor({state: 'attached'});
    assert.equal(await personal.getAttribute('class'), 'set-row one cal-row pending');
    provider.release();
    await settled('Personal is violet at Google', calendars, list => list.some(calendar => calendar.name === 'Personal' && calendar.colour === 'violet' && calendar.command === null));
    await personal.locator('.spin').waitFor({state: 'detached'});
    const violet = 'oklch(0.8 0.11 300)';
    assert.equal(await rested(() => personal.locator('.sw').evaluate(sw => getComputedStyle(sw).getPropertyValue('--c').trim())), violet);

    // Google refuses sun (the dev provider's rule): failed in place, in Google's words.
    await personal.getByRole('button', {name: 'Personal colour'}).click();
    await page.locator('.settings .swatches .sw[aria-label="sun"]').click();
    const refusal = personal.locator('.s.failed', {hasText: 'Couldn\'t change its colour, Google Calendar, The caller does not have permission (403 Forbidden)'});
    await refusal.waitFor();
    assert.equal(await rested(() => personal.locator('.sw').evaluate(sw => getComputedStyle(sw).getPropertyValue('--c').trim())), 'oklch(0.86 0.16 92)', 'the colour picked stays in place');
    // Try again: pending once more, then refused again.
    provider.hold();
    await personal.getByRole('button', {name: 'Try again'}).click();
    await personal.locator('.spin').waitFor({state: 'attached'});
    provider.release();
    await refusal.waitFor();
    // Change back: violet again, nothing waiting.
    await personal.getByRole('button', {name: 'Change back'}).click();
    await settled('back to violet', calendars, list => list.some(calendar => calendar.name === 'Personal' && calendar.colour === 'violet' && calendar.command === null));
    await refusal.waitFor({state: 'detached'});

    // The calendar shows it: the sidebar's checkbox and Personal's events.
    await page.keyboard.press('Escape');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    assert.equal(await rested(() => page.locator('.calrow', {hasText: 'Personal'}).evaluate(row => getComputedStyle(row).getPropertyValue('--c').trim())), violet);
    assert.equal(await rested(() => page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Gym'}).evaluate(chip => getComputedStyle(chip).getPropertyValue('--c').trim())), violet);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    provider.remove();
  }
});

test('SV-25: a Todoist project\'s colour, picked from Todoist\'s 20, waits for Todoist at .5 with its spinner, then rings its tasks; one Todoist refuses stays with its words until Try again or Change back', async () => {
  const provider = providerHold();
  const setpoint = await startSetpoint({clock: 'frozen', env: {SETPOINT_DEV_PROVIDER_HOLD: provider.file}});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'calendar');
    const projects = () => setpoint.api<TodoistProjectOut[]>('GET', '/todoist/projects');
    const home = page.locator('.settings [data-project]', {hasText: 'Home'});
    const colourOf = (row: typeof home) => row.locator('.sw').evaluate(sw => getComputedStyle(sw).getPropertyValue('--c').trim());
    assert.deepEqual(await page.locator('.settings [data-project] .t').allTextContents(), ['Inbox', 'School', 'Home']);
    assert.equal(await rested(() => colourOf(home)), '#c77100', 'the seed\'s Home is orange');

    await home.getByRole('button', {name: 'Home colour'}).click();
    assert.equal(await page.locator('.settings .swatches .sw').count(), 20);
    assert.equal(await page.locator('.settings .swatches .sw.on').getAttribute('aria-label'), 'Orange');
    await page.getByRole('button', {name: 'Teal', exact: true}).click();
    await home.locator('.spin').waitFor({state: 'attached'});
    assert.equal(await home.getAttribute('class'), 'set-row one cal-row pending');
    provider.release();
    await settled('Home is teal at Todoist', projects, list => list.some(project => project.name === 'Home' && project.colour === 'teal' && project.command === null));
    await home.locator('.spin').waitFor({state: 'detached'});
    assert.equal(await rested(() => colourOf(home)), '#148fad');

    // Todoist refuses taupe (the dev provider's rule): failed in place, in Todoist's words.
    await home.getByRole('button', {name: 'Home colour'}).click();
    await page.getByRole('button', {name: 'Taupe', exact: true}).click();
    const refusal = home.locator('.s.failed', {hasText: 'Couldn\'t change its colour, Todoist, Insufficient permissions (403 Forbidden)'});
    await refusal.waitFor();
    assert.equal(await rested(() => colourOf(home)), '#8f7a69', 'the colour picked stays in place');
    provider.hold();
    await home.getByRole('button', {name: 'Try again'}).click();
    await home.locator('.spin').waitFor({state: 'attached'});
    provider.release();
    await refusal.waitFor();
    await home.getByRole('button', {name: 'Change back'}).click();
    await settled('back to teal', projects, list => list.some(project => project.name === 'Home' && project.colour === 'teal' && project.command === null));
    await refusal.waitFor({state: 'detached'});

    // The calendar shows it: Home's tasks ring in teal on the grid and in the agenda, School's in sky blue.
    await page.keyboard.press('Escape');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    const ring = (selector: string, title: string) => page.locator(selector, {hasText: title}).locator('.ring').evaluate(el => getComputedStyle(el).borderTopColor);
    // Todoist's teal (#148fad) and sky blue (#319dc0), their lightness clamped to the theme's band (#175).
    const teal = await computed(page, 'color', 'oklch(from #148fad clamp(var(--ringMin), l, var(--ringMax)) c h)');
    const sky = await rested(() => computed(page, 'color', 'oklch(from #319dc0 clamp(var(--ringMin), l, var(--ringMax)) c h)'));
    // A ring can still be easing its colour in (the agenda's does), so each is read once it's there.
    await until('Pay rent rings teal on the grid', () => ring('.cell[data-date="2026-10-07"] .tk', 'Pay rent'), colour => colour === teal);
    await until('and in the agenda', () => ring('.ag-task', 'Pay rent'), colour => colour === teal);
    await until('CS 101 lab report rings sky blue', () => ring('.cell[data-date="2026-10-07"] .tk', 'CS 101 lab report'), colour => colour === sky);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    provider.remove();
  }
});

test('AI: a key set write-only and removed, and each model changed at will', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'ai');
    const secrets = () => setpoint.api<SecretOut[]>('GET', '/secrets');
    const anthropic = page.locator('.settings [data-secret="anthropic_api_key"]');
    await anthropic.getByRole('button', {name: 'Set key'}).click();
    await anthropic.locator('input').fill('sk-ant-fake-browser-check');
    await page.keyboard.press('Enter');
    await settled('the key is set', secrets, list => list.find(secret => secret.name === 'anthropic_api_key')?.set === true);
    await anthropic.locator('.s', {hasText: 'Claude models · Set'}).waitFor();
    assert.equal(await page.locator('.settings').evaluate(modal => modal.textContent?.includes('sk-ant-fake-browser-check')), false, 'the key never shows');

    // Defaults per D25 and D26 with the Anthropic key: Sonnet, Opus, Haiku, Opus.
    const ai = await setpoint.api<AiOut>('GET', '/ai');
    // Default names its model, and every model on offer is Claude's and can be picked with the key (UX #14).
    // The Triage model menu's choices, opened and closed again.
    const choices = async () => {
      await page.locator('.settings').getByRole('button', {name: 'Triage model', exact: true}).click();
      const menu = page.locator('.settings').getByRole('menu', {name: 'Triage model', exact: true});
      const all = await menu.getByRole('menuitemradio').evaluateAll(items => items.map(item => ({text: item.textContent, disabled: (item as HTMLButtonElement).disabled})));
      await page.keyboard.press('Escape');
      await menu.waitFor({state: 'detached'});
      return all;
    };
    await until('Default named', async () => (await choices())[0]?.text, text => text === 'Default (Claude Sonnet 5.5)');
    const offered = await choices();
    assert.ok(offered.every(choice => !choice.disabled && choice.text?.includes('Claude')), `only Claude's, none waiting for a key: ${offered.map(choice => choice.text).join(', ')}`);
    assert.equal(await page.locator('.settings [data-secret="openai_api_key"]').count(), 0, 'no OpenAI key row');
    assert.deepEqual([ai.triage.cheap?.model, ai.triage.strong?.model, ai.triage.history?.model, ai.alfred?.model], ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
    for (const [label, model, setting] of [
      ['Triage model', 'Claude Haiku 5.5', 'triage_model'], ['Triage, when unsure model', 'Claude Sonnet 5.5', 'triage_strong_model'],
      ['History model', 'Claude Sonnet 4.6', 'history_model'], ['Alfred model', 'Claude Sonnet 5.5', 'alfred_model'],
    ] as const) {
      await choose(page, label, model);
      await settled(label, () => setpoint.api<Settings>('GET', '/settings'), value => value.ai[setting] !== null);
    }
    const changed = await setpoint.api<AiOut>('GET', '/ai');
    assert.deepEqual([changed.triage.cheap?.model, changed.triage.strong?.model, changed.triage.history?.model, changed.alfred?.model], ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-6', 'claude-sonnet-5-5']);
    // With another model chosen, Default still names its own.
    assert.equal((await choices())[0]?.text, 'Default (Claude Sonnet 5.5)');
    await choose(page, 'Triage model', 0);
    await settled('back to the default', () => setpoint.api<Settings>('GET', '/settings'), value => value.ai.triage_model === null);

    await anthropic.getByRole('button', {name: 'Remove'}).click();
    await settled('removed', secrets, list => list.find(secret => secret.name === 'anthropic_api_key')?.set === false);
    // With no key, each model waits for it (UX #14).
    await until('every model waits for the key', async () => (await choices()).slice(1), models => models.length > 0 && models.every(model => model.disabled && model.text?.endsWith(' · no key')));
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Security: with the password given in the last 10 minutes (the claim), new recovery codes are shown once', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'security');
    await page.locator('.settings .set-row', {hasText: '8 left'}).waitFor();
    assert.equal(await page.locator('.settings .set-label', {hasText: 'Confirm it'}).count(), 0, 'no password asked for: it was given at the claim');
    // Sign out is the nav's foot only, and Add passkey has its + as Add rule does.
    assert.equal(await page.locator('.settings').getByRole('button', {name: 'Sign out'}).count(), 1);
    assert.equal(await page.locator('.settings .set-label').getByRole('button', {name: 'Add passkey'}).locator('svg').count(), 1);
    // No passkeys is an empty line, as Mail's "No rules yet · Add rule" is, not a passkey named "None yet";
    // the recovery row is titled, its count its value (the polish audit's settings-11).
    // Passkeys' own, not iPhones' (#250).
    const none = page.locator('.settings .set-row', {hasText: 'Add passkey'});
    assert.equal(await none.locator('.set-empty').textContent(), 'None yet · Add passkey');
    const recovery = page.locator('.settings .set-row', {hasText: '8 left'});
    assert.deepEqual([await recovery.locator('.t').textContent(), await recovery.locator('.val').textContent()], ['Recovery codes', '8 left']);
    await none.getByRole('button', {name: 'Add passkey'}).click();
    await page.locator('.settings input[name="label"]').waitFor();
    await page.keyboard.press('Escape');
    await none.waitFor();
    await page.getByRole('button', {name: 'Make new codes'}).click();
    const codes = page.locator('.settings pre.codes');
    await codes.waitFor();
    assert.equal((await codes.textContent())!.trim().split('\n').length, 8);
    await page.locator('.settings .set-row', {hasText: '8 left'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Security › iPhones: Add iPhone shows the QR and its link, the phone pairing closes it and lists the phone; Esc withdraws a code, Revoke ends a token (#250)', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'security');
    const group = page.locator('.settings .set-sec', {has: page.locator('.set-label', {hasText: 'iPhones'})});
    const add = group.locator('.set-label').getByRole('button', {name: 'Add iPhone'});
    const panel = group.locator('.set-row.pairing');
    const none = group.locator('.set-row', {hasText: 'None yet'});
    assert.equal(await none.locator('.set-empty').textContent(), 'None yet · Add iPhone');
    /** The app's exchange, from outside the browser: no cookie, no Origin. */
    const pair = (code: string) => fetch(`${setpoint.base}/api/auth/pair`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code, name: 'iPhone 17 Pro'})});
    const shownCode = async () => new URL((await panel.locator('.pair-link code').textContent())!).searchParams.get('code')!;

    // The QR holds the link shown beside it, to this Setpoint; Add iPhone rests while it shows.
    await add.click();
    await panel.waitFor();
    const link = (await panel.locator('.pair-link code').textContent())!;
    assert.match(link, new RegExp(`^setpoint://pair\\?server=${encodeURIComponent(setpoint.base).replace(/[.%]/g, '\\$&')}&code=[A-Za-z0-9_-]{43}$`));
    assert.equal(await panel.locator('svg.qr').getAttribute('aria-label'), 'Pairing QR code');
    assert.equal(await add.isDisabled(), true);
    await panel.getByText('Works once · Expires in 5 min').waitFor();

    // The phone pairs: the panel closes by itself and the phone is listed.
    const paired = await pair(await shownCode());
    assert.equal(paired.status, 201);
    const {token} = await paired.json() as PairOut;
    await panel.waitFor({state: 'detached'});
    const row = group.locator('.set-row', {hasText: 'iPhone 17 Pro'});
    assert.equal(await row.locator('.s').textContent(), 'Paired 9:12 AM');
    await page.locator('.settings .line', {hasText: 'Paired iPhone 17 Pro'}).waitFor();
    assert.equal(await add.isDisabled(), false);

    // Esc withdraws the code shown, and leaves Settings open.
    await add.click();
    await panel.waitFor();
    const withdrawn = await shownCode();
    await page.keyboard.press('Escape');
    await panel.waitFor({state: 'detached'});
    await setpoint.idle();
    assert.equal(await page.locator('.settings').count(), 1, 'Settings stays open');
    assert.equal((await pair(withdrawn)).status, 401);

    // Revoke, with no password asked: the row goes and the token is refused.
    await row.getByRole('button', {name: 'Revoke'}).click();
    await row.waitFor({state: 'detached'});
    await none.waitFor();
    await page.locator('.settings .line', {hasText: 'Revoked iPhone 17 Pro'}).waitFor();
    assert.equal((await fetch(`${setpoint.base}/api/me`, {headers: {Authorization: `Bearer ${token}`}})).status, 401);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Security: a load that reaches the server just after a change there ended the session it was sent under is asked again under the new one, not taken as signed out', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'security');
    await page.locator('.settings .set-row', {hasText: '8 left'}).waitFor();
    // Settings' prefetch of every page's answers, 250 ms after it opens, answered first, so the load
    // held below is Mail's own and not the prefetch's.
    await until('the prefetch of the domains answered', () => page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/api/mail/trusted-domains'))), answered => answered);
    await setpoint.idle();
    // Mail's trusted domains' load is held until Make new codes has ended every session, then reaches the server
    // under the one the browser had when it asked, which refuses it, as a slow connection can have it.
    const oldSession = `${setpoint.cookie!.name}=${setpoint.cookie!.value}`;
    let release = () => {};
    const changed = new Promise<void>(resolve => {
      release = resolve;
    });
    // Only once its page asks for it: Settings' early loads go through.
    let armed = false;
    let asked = 0;
    // Not the rules, which the Inbox under Settings has already, for Add to rule (SV-160).
    await page.route('**/api/mail/trusted-domains', async route => {
      if (!armed) return route.continue();
      asked += 1;
      if (asked > 1) return route.continue();
      await changed;
      const response = await fetch(route.request().url(), {headers: {Cookie: oldSession, Origin: setpoint.base, Accept: 'application/json'}});
      await route.fulfill({status: response.status, contentType: 'application/json', body: await response.text()});
    });
    armed = true;
    await page.locator('.settings .set-nav .nav', {hasText: 'Mail'}).click();
    await until('the domains asked for', async () => asked, count => count >= 1);
    await page.locator('.settings .set-nav .nav', {hasText: 'Security'}).click();
    await page.getByRole('button', {name: 'Make new codes'}).click();
    await page.locator('.settings pre.codes').waitFor();
    release();
    await until('the domains asked again', async () => asked, count => count >= 2);
    await setpoint.idle();
    assert.equal(await page.locator('.sign-in').count(), 0, 'still signed in');
    assert.equal(await page.locator('.settings pre.codes').count(), 1, 'the new codes still shown');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

/**
 * Whether a popover shows whole: inside the viewport, and each corner (inset past its radius) hits
 * the popover itself, so no ancestor's overflow clips it and nothing covers it.
 */
async function unclipped(menu: Locator): Promise<string[]> {
  return menu.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const problems: string[] = [];
    if (rect.top < 0 || rect.left < 0 || rect.bottom > innerHeight || rect.right > innerWidth) problems.push(`outside the viewport: ${JSON.stringify(rect)}`);
    const inset = 12;
    for (const [x, y] of [[rect.left + inset, rect.top + inset], [rect.right - inset, rect.top + inset], [rect.left + inset, rect.bottom - inset], [rect.right - inset, rect.bottom - inset]] as const) {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !element.contains(hit)) problems.push(`(${Math.round(x)}, ${Math.round(y)}) hits ${hit ? hit.className || hit.tagName : 'nothing'}`);
    }
    return problems;
  });
}

test('live reordering: dragging Business down past Personal makes room as it passes; letting go saves the order; ↑ on the handle still moves it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'accounts');
    const rows = page.locator('.settings [data-account]');
    await rows.nth(2).waitFor();
    // The rows top to bottom as they show (while dragged they slide, staying in place in the page).
    const labels = () => rows.evaluateAll(all => all.map(row => ({label: row.querySelector('.lines .t')!.textContent!, y: row.getBoundingClientRect().y}))
      .sort((a, b) => a.y - b.y).map(row => row.label));
    const [first, second, third] = await rested(() => labels());
    const box = async (index: number) => (await rested(() => rows.nth(index).boundingBox()))!;

    // Down from the first row's handle, past the second row's middle.
    const handle = (await rows.nth(0).locator('.handle').boundingBox())!;
    const target = await box(1);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 20, {steps: 4});
    await page.mouse.move(handle.x + handle.width / 2, target.y + target.height * 0.75, {steps: 8});
    // Mid-drag: the second row moved up into the first place.
    await until('the rows make room', labels, order => order.slice(0, 3).join() === [second, first, third].join());
    assert.equal(await rows.nth(0).getAttribute('class').then(names => names!.includes('dragging')), true, `${first} is the one dragged`);
    const saved = () => setpoint.api<AccountOut[]>('GET', '/accounts').then(list => list.sort((a, b) => a.position - b.position).map(account => account.label));
    // Whatever the drag has sent answered before the server is read.
    await setpoint.idle();
    assert.deepEqual((await saved()).slice(0, 2), [first, second], 'nothing is saved mid-drag');
    await page.mouse.up();
    await until('the order saved', saved, order => order.slice(0, 3).join() === [second, first, third].join());

    // ↑ on the handle moves it back.
    await rows.nth(1).locator('.handle').focus();
    await page.keyboard.press('ArrowUp');
    await until('moved back', saved, order => order.slice(0, 2).join() === [first, second].join());
    await until('shown back', labels, order => order.slice(0, 2).join() === [first, second].join());
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('menus: Sources\' last row (Weather · Check now), the last account\'s and the last rule\'s open whole, not clipped by their group', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'accounts');
    await page.locator('.settings [data-source="weather"]').waitFor();
    await page.getByRole('button', {name: 'Weather options'}).click();
    const weather = page.getByRole('menu', {name: 'Weather options'});
    await page.getByRole('menuitem', {name: 'Check now'}).waitFor();
    await until('Weather\'s menu whole', () => unclipped(weather), problems => problems.length === 0);
    await page.keyboard.press('Escape');

    const last = page.locator('.settings [data-account]').last();
    const label = (await last.locator('.lines .t').textContent())!;
    await last.getByRole('button', {name: `${label} options`}).click();
    await until(`${label}'s menu whole`, () => unclipped(page.getByRole('menu', {name: `${label} options`})), problems => problems.length === 0);
    await page.keyboard.press('Escape');

    await page.locator('.settings .set-nav .nav', {hasText: 'Mail'}).click();
    await page.locator('.settings .rule', {hasText: 'Proseware alerts'}).waitFor();
    await page.getByRole('button', {name: 'Rule options'}).last().click();
    await until('the last rule\'s menu whole', () => unclipped(page.getByRole('menu', {name: 'Rule options'})), problems => problems.length === 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
