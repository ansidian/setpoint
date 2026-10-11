// Settings in the browser (F7; DESIGN.md › Settings): boards 17, 18a and 18b against their
// approved screenshots, then each page saving: the modal itself (⌘,, Esc, not in the address bar, a link
// straight to a page, Reconnect), Accounts (colour, rename, order, Connect Gmail's "not configured",
// Connect iCloud's form), Mail (a rule, Undo on a learned rule, a domain, code expiry), Notifications
// (Send test to a fake ntfy on 127.0.0.1, switches, defaults), Calendar (a calendar hidden, Home,
// weather, and SV-20's colours written to Google, waiting, refused, tried again and changed back), Todoist (SV-25's project
// colours, the same way, and the task rings that take them), AI (a key set write-only, a model), Appearance, and Security's recovery codes. The passkey ceremony is in passkey.spec.ts.
// N5 adds boards 30a and 30b: Settings › News (sources by section, read-only, no key row: #97) and AI's
// News group (its models, the cap, this month and its usage), and the cap reached.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {after, test} from 'node:test';
import type {AccountOut, AiOut, CalendarOut, NewsSourcesOut, PrecisionOut, RuleOut, SecretOut, Settings, TodoistProjectOut, TrustedDomainOut} from '@setpoint/shared';
import type {Locator, Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {choose, cleanUp, matchGolden, ROOT, startSetpoint, still, until} from './harness.ts';

after(cleanUp);

/** An empty line's leading glyph: its bundled path, size and colour, and the gap to the words after it (#165). */
const leadGlyph = (line: Locator) => line.evaluate(element => {
  const icon = element.querySelector('.icon')!;
  const range = document.createRange();
  range.selectNode(icon.closest('span.set-empty-icon') ? element.querySelector('.set-empty')! : icon.nextSibling!);
  return [icon.querySelector('path')!.getAttribute('d'), icon.getAttribute('width'), getComputedStyle(icon).color, Math.round(range.getBoundingClientRect().left - icon.getBoundingClientRect().right)];
});

/** The Inbox under Settings, loaded, then Settings at `page` (from its address, as a link would). */
async function openAt(page: Page, base: string, settingsPage: string) {
  await page.goto(`${base}/settings/${settingsPage}`);
  await page.locator('.settings').waitFor();
  await page.waitForURL(/\/inbox$/);
  await page.locator('.arow').first().waitFor();
  await page.locator('.today-row').first().waitFor();
}

const settled = <T,>(what: string, read: () => Promise<T>, check: (value: T) => boolean) => until(what, read, check, 5000);

test('board 17: Settings › Accounts, Business needing sign-in and Personal stale', async () => {
  const setpoint = await startSetpoint({fixtures: ['needs-reconnect', 'stale-personal', 'checked', 'precision', 'ntfy'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'accounts');
    await page.locator('.settings .set-row.warn', {hasText: 'Needs sign-in'}).waitFor();
    await page.locator('.settings .state', {hasText: 'Checks stopped, as of 9:14 PM'}).waitFor();
    await page.locator('.settings [data-source="todoist"]', {hasText: 'Inbox · 3 projects'}).waitFor();
    await page.locator('.settings .precision', {hasText: '82%'}).waitFor();
    await page.locator('.hbar.caution').waitFor();
    // Each day's bar names its day as the app writes dates, "Tue, Oct 6", not "2026-10-06".
    const {days} = await setpoint.api<PrecisionOut>('GET', '/mail/precision');
    assert.deepEqual(await page.locator('.settings .spark span').evaluateAll(bars => bars.map(bar => bar.getAttribute('title'))),
      days.map(day => new Date(`${day.date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'})));
    assert.match((await page.locator('.settings .spark span').last().getAttribute('title'))!, /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
    assert.equal(await page.locator('.settings .set-nav .nav.on').textContent(), 'Accounts');
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).locator('.warn').count(), 1, 'Accounts is marked');
    // Account trouble is sync_problem, in the nav and on the row, as in the sidebar and the Inbox's bar (#164).
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).locator('.warn .icon path').getAttribute('d'), ICONS.sync_problem);
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).locator('.warn .icon').evaluate(glyph => getComputedStyle(glyph).color), await computed(page, 'color', 'var(--caution)'), 'in caution on the current page too');
    assert.equal(await page.locator('.settings .set-row.warn', {hasText: 'Needs sign-in'}).locator('.state > .icon path').getAttribute('d'), ICONS.sync_problem);
    await page.mouse.move(1500, 1000);
    await matchGolden(page, '17-settings-accounts', 'settings');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 18a: Settings › Mail, consolidatedmessenger.example under the pointer', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    await page.locator('.settings .dom', {hasText: 'Show all 78'}).waitFor();
    // The rules load apart from the domains: wait for the last one before reading the list.
    await page.locator('.settings .rule', {hasText: 'Proseware alerts'}).waitFor();
    assert.deepEqual(await page.locator('.settings .rule').allTextContents(), [
      'From university.edu with “Registrar” in the subjectAttention', 'From woodgrovebank.exampleFYI · Money', 'From news.fabrikam.comNoise',
      'Northwind newslettersFYI · Updates', 'Proseware alertsFYI · Updates',
    ]);
    await page.locator('.settings .dom[data-domain="consolidatedmessenger.example"]').hover();
    await matchGolden(page, '18a-settings-mail', 'settings');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('board 18b: Settings › Notifications', async () => {
  const setpoint = await startSetpoint({fixtures: ['ntfy'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'notifications');
    await page.locator('.settings .set-label', {hasText: 'Connected · last sent 8:02 AM'}).waitFor();
    await page.mouse.move(1500, 1000);
    await matchGolden(page, '18b-settings-notifications', 'settings');
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

test('board 30a: Settings › News, between Mail and AI, its warning glyph while FOX 11 fails; sources by section, read-only', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'news');
    const fox = page.locator('.settings .news-src', {hasText: 'FOX 11'});
    await fox.waitFor();
    assert.deepEqual(await page.locator('.settings .set-nav .nav').allTextContents(), ['Accounts', 'Calendar', 'Todoist', 'Notifications', 'Mail', 'News', 'AI', 'Appearance', 'Security', 'Sign out']);
    assert.equal(await page.locator('.settings .set-nav .nav.on').textContent(), 'News');
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'News'}).locator('.warn').count(), 1, 'News carries the warning glyph');
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'News'}).locator('.warn .icon path').getAttribute('d'), ICONS.warning, 'a failing feed keeps warning (override 24)');
    assert.equal(await page.locator('.settings .set-nav .nav', {hasText: 'News'}).locator('.warn .icon').evaluate(glyph => getComputedStyle(glyph).color), await computed(page, 'color', 'var(--caution)'));
    // The head's counts, then one group per section with its count, and no Keys group (#97).
    const sources = await setpoint.api<NewsSourcesOut>('GET', '/news/sources');
    assert.equal(await page.locator('.settings .set-head .head-note').textContent(), `${sources.articles_today} articles today · ${sources.stories_on_page} stories`);
    assert.deepEqual(await page.locator('.settings .set-label').allTextContents(),
      sources.sections.map(({section, sources: list}) => `${{local: 'Local', tech: 'Tech', ai: 'AI', general: 'General'}[section]} ${list.length}`));
    // FOX 11 fails in `caution` on a `caution` 7% row; the rest say when they were checked, each 44 px.
    assert.equal(await fox.locator('.state').textContent(), 'Failing, 404 since 6:02 AM');
    assert.equal(await fox.locator('.state').getAttribute('title'), '404 Not Found');
    assert.equal(await fox.locator('.state').evaluate(state => getComputedStyle(state).color), await computed(page, 'color', 'var(--caution)'));
    assert.equal(await fox.evaluate(element => getComputedStyle(element).backgroundColor), await computed(page, 'background', 'color-mix(in oklch, var(--caution) 7%, transparent)'));
    const ktla = page.locator('.settings .news-src', {hasText: 'KTLA'});
    assert.deepEqual(await ktla.evaluate(element => [element.querySelector('.t')?.textContent, element.querySelector('.s')?.textContent, element.querySelector('.prov')?.textContent, element.querySelector('.state')?.textContent]),
      ['KTLA · Local news', 'Feed, summary only', 'Every 15 min', 'Checked 9:10 AM']);
    assert.equal(await page.locator('.settings .news-src', {hasText: 'National Weather Service'}).locator('.prov').textContent(), 'Every 5 min');
    // Each tile: the icon the source's list names (a TV station's, the crime wire's), else its adapter's.
    const glyphs = JSON.parse(fs.readFileSync(path.join(ROOT, 'design-export', 'glyphs', 'icons.json'), 'utf8')) as Record<string, {d: string}>;
    const tile = (name: string) => page.locator('.settings .news-src', {hasText: name}).locator('.aico path').getAttribute('d');
    for (const [name, icon] of [['KTLA', 'live_tv'], ['FOX 11', 'live_tv'], ['County crime wire', 'local_police'], ['LAist', 'newspaper'], ['National Weather Service', 'thunderstorm']] as const) {
      assert.equal(await tile(name), glyphs[icon]!.d, `${name}: ${icon}`);
    }
    // 44 px rows (two lines of text make them taller, as the board's are).
    assert.deepEqual([...new Set(await page.locator('.settings .news-src').evaluateAll(rows => rows.map(element => getComputedStyle(element).minHeight)))], ['44px']);
    assert.equal(await page.locator('.settings .set-main').locator('.switch, .handle, [draggable="true"]').count(), 0, 'read-only: no handles, no switches');
    await page.mouse.move(1500, 1000);
    await matchGolden(page, '30a-settings-news', 'settings');
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
    assert.deepEqual(await page.locator('.settings .set-label').allTextContents(), ['Keys', 'Mail', 'News', 'Usage this month']);
    const news = page.locator('.settings .set-sec', {has: page.locator('.set-label', {hasText: /^News$/})});
    assert.deepEqual(await news.locator('.set-row .t').allTextContents(), ['Articles and grouping', 'Stories and ranking', 'Monthly cap', 'This month']);
    assert.deepEqual(await news.locator('.val').allTextContents(), ['Claude Haiku 5.5', 'Claude Sonnet 5.5']);
    assert.equal(await news.getByRole('button', {name: 'Monthly cap', exact: true}).textContent(), '$40');
    // The meter: 160 × 6, filled to $18.40 of $40, measured once Settings has settled into place.
    await still(page);
    const meter = news.locator('.meter');
    assert.deepEqual(await meter.evaluate(element => [element.getBoundingClientRect().width, element.getBoundingClientRect().height, Math.round((element.firstElementChild as HTMLElement).getBoundingClientRect().width * 10) / 10]), [160, 6, 73.6]);
    assert.equal(await meter.locator('span').evaluate(fill => getComputedStyle(fill).backgroundColor), await computed(page, 'background', 'var(--ink2)'));
    await page.mouse.move(1500, 1000);
    await matchGolden(page, '30b-settings-ai', 'settings');

    // Usage this month: Triage, Alfred and News, News in its parts.
    const usage = page.locator('.settings .set-sec', {has: page.locator('.set-label', {hasText: 'Usage this month'})});
    await usage.scrollIntoViewIfNeeded();
    assert.deepEqual(await usage.locator('.set-row').evaluateAll(rows => rows.map(element => [element.querySelector('.t')?.textContent, element.querySelector('.s')?.textContent, element.querySelector('.cost')?.textContent])), [
      ['Triage', '1,214 calls · 2.4M tokens in · 49k out', '$2.10'],
      ['Alfred', '18 calls · 112k tokens in · 8k out', '$0.85'],
      ['News', 'Articles $1.90 · grouping $1.20 · stories $13.10 · ranking $2.20', '$18.40'],
    ]);
    await page.mouse.move(1500, 1000);
    await matchGolden(page, 'settings-ai-usage', 'settings');

    // The cap is editable, as board 30b draws it; it saves through PATCH /api/settings.
    await choose(page, 'Monthly cap', '$50');
    await settled('the cap saved', () => setpoint.api<Settings>('GET', '/settings'), value => value.news.monthly_cap_usd === 50);
    await amount.filter({hasText: '$18.40 of $50'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('at the cap, This month says so, its meter full in `caution`; a higher cap takes it back', async () => {
  const setpoint = await startSetpoint({fixtures: ['news-capped'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'ai');
    const month = page.locator('.settings .set-row', {has: page.locator('.amount')});
    await month.locator('.amount', {hasText: '$40.40 of $40'}).waitFor();
    const line = month.locator('.s .caution');
    assert.equal(await line.textContent(), 'Cap reached, summaries use Claude Haiku 5.5 until Nov 1');
    assert.equal(await line.evaluate(element => getComputedStyle(element).color), await computed(page, 'color', 'var(--caution)'));
    // Measured once Settings has settled into place.
    await still(page);
    assert.deepEqual(await month.locator('.meter > span').evaluate(fill => [fill.getBoundingClientRect().width, getComputedStyle(fill).backgroundColor]), [160, await computed(page, 'background', 'var(--caution)')]);
    await choose(page, 'Monthly cap', '$50');
    await month.locator('.amount', {hasText: '$40.40 of $50'}).waitFor();
    await line.waitFor({state: 'detached'});
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the modal: ⌘, and the sidebar open it over the page, not in the address bar; Esc closes; Reconnect opens Accounts', async () => {
  const setpoint = await startSetpoint({fixtures: ['needs-reconnect'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ev').first().waitFor();
    await page.keyboard.press('Meta+,');
    await page.locator('.settings').waitFor();
    assert.equal(new URL(page.url()).pathname, '/calendar', 'the page under it keeps the address');
    // The current page keeps its `sub2` fill with the keys in the nav, opened with ⌘, or after ↓;
    // the keyboard's own fill is `sub`, on any other page it reaches.
    const sub2 = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.background = 'var(--sub2)';
      const fill = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return fill;
    });
    const current = page.locator('.settings .set-nav .nav.on');
    const currentFill = async () => current.evaluate(nav => [nav.textContent, document.activeElement === nav, getComputedStyle(nav).backgroundColor]);
    await until('Accounts marked, with the keys on it', currentFill, now => JSON.stringify(now) === JSON.stringify(['Accounts', true, sub2]));
    // ↓ in the nav changes page; keys inside never reach the page (2 would go to Calendar, J would move a cursor).
    await page.keyboard.press('ArrowDown');
    await page.locator('.settings .set-title', {hasText: 'Calendar'}).waitFor();
    await until('Calendar marked, with the keys on it', currentFill, now => JSON.stringify(now) === JSON.stringify(['Calendar', true, sub2]));
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
    assert.equal(await page.locator('.toast').evaluate(toast => {
      const box = toast.getBoundingClientRect();
      return toast.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
    }), true);
    await page.keyboard.press('Escape');

    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.hbar.caution .act').click();
    await page.locator('.settings .set-title', {hasText: 'Accounts'}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/inbox');
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
    assert.equal(await page.locator('.acct', {hasText: 'Business'}).locator('.dot').evaluate(dot => getComputedStyle(dot).getPropertyValue('--c').trim()), 'oklch(0.86 0.11 182)', 'the sidebar follows (cyan)');

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

test('Mail: a rule added, a learned rule undone, a domain untrusted, the code expiry changed', async () => {
  const setpoint = await startSetpoint({fixtures: ['mail-rules'], clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    const rules = () => setpoint.api<RuleOut[]>('GET', '/mail/rules');

    await page.getByRole('button', {name: 'Add rule'}).click();
    await page.locator('.settings input[name="from"]').fill('alerts.contoso.example');
    await choose(page, 'Send to', 'FYI · Security');
    await page.getByRole('button', {name: 'Add', exact: true}).click();
    await settled('the new rule', rules, list => list.some(rule => rule.match.from_domains?.[0] === 'alerts.contoso.example' && rule.kind === 'security'));
    await page.locator('.settings .rule', {hasText: 'alerts.contoso.example'}).waitFor();
    // A rule's menu turns it off with toggle_off and back on with toggle_on (#164).
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
    // SV-25 (D54): nothing matching is one plain line across the group, with no pill on hover and nothing cut off.
    const empty = page.locator('.settings .set-row', {hasText: 'No domain matches'});
    await empty.hover();
    const box = await empty.evaluate(row => ({
      width: row.getBoundingClientRect().width, group: row.closest('.set-group')!.getBoundingClientRect().width,
      fits: row.scrollWidth <= row.clientWidth, fill: getComputedStyle(row).backgroundColor,
    }));
    assert.equal(box.width, box.group, 'the line spans the group');
    assert.ok(box.fits, 'the line isn\'t cut off');
    assert.equal(box.fill, 'rgba(0, 0, 0, 0)', 'no pill on hover');

    await page.getByRole('radio', {name: '30 min'}).click();
    await settled('code expiry', () => setpoint.api<Settings>('GET', '/settings'), settings => settings.mail.code_expiry_minutes === 30);
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
    await escCancels('subject', 'input[name="from"]');

    await page.locator('.settings .set-nav .nav', {hasText: 'Accounts'}).click();
    await page.getByRole('button', {name: 'Connect iCloud'}).click();
    await escCancels('password', 'input[name="password"]');

    await page.locator('.settings .set-nav .nav', {hasText: 'Security'}).click();
    await page.getByRole('button', {name: 'Change', exact: true}).click();
    await escCancels('again', 'input[name="again"]');
    await page.getByRole('button', {name: 'Add passkey'}).click();
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

test('S12 (SV-25, D54): "No rules yet · Add rule" has Add rule as a button, reached by Tab, answering the pointer, opening the form', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    assert.deepEqual(await leadGlyph(page.locator('.settings .set-row', {hasText: 'No rules yet'})), [ICONS.rule, '20', await computed(page, 'color', 'var(--ink3)'), 12], 'it leads with rule (#165)');
    const empty = page.locator('.settings .set-row', {hasText: 'No rules yet'}).getByRole('button', {name: 'Add rule'});
    const colour = () => empty.evaluate(button => getComputedStyle(button).color);
    const resting = await colour();
    await empty.hover();
    await until('the hover colour', colour, value => value !== resting);
    await page.mouse.move(0, 0);
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

test('S12b: "No rules yet · Add rule" is one line in a plain row, not the Inbox\'s centred All caught up', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'mail');
    const row = page.locator('.settings .set-row', {hasText: 'No rules yet'});
    const shape = await row.evaluate((element: HTMLElement) => {
      const line = element.querySelector<HTMLElement>('.s')!;
      const words = document.createRange();
      words.selectNodeContents(line.firstChild!);
      return {
        row: element.offsetHeight, group: element.parentElement!.offsetHeight, line: line.offsetHeight,
        wordsTop: Math.round(words.getBoundingClientRect().top), buttonTop: Math.round(line.querySelector('button')!.getBoundingClientRect().top),
        leadLeft: Math.round(element.querySelector('.icon')!.getBoundingClientRect().left - element.getBoundingClientRect().left),
      };
    });
    assert.ok(shape.line < 24, `one line, not ${shape.line}px`);
    assert.ok(Math.abs(shape.wordsTop - shape.buttonTop) <= 2, 'Add rule sits on the words\' line');
    assert.ok(shape.row <= 46, `a 46px row, not ${shape.row}px`);
    assert.equal(shape.group, shape.row, 'the group holds just the row');
    assert.ok(shape.leadLeft <= 17, 'its glyph starts at the row\'s inset, as the domains\' None yet does (#165)');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('S13: Settings\' selects open the shared menu, not the browser\'s list: the current choice checked, Enter, ↓ and Enter to pick, Esc closing just the menu', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'notifications');
    for (const name of ['Todoist', 'AI', 'Security', 'Notifications']) {
      await page.locator('.settings .set-nav .nav', {hasText: new RegExp(`^${name}$`)}).click();
      await page.locator('.settings .set-title', {hasText: new RegExp(`^${name}$`)}).waitFor();
      await page.locator('.settings .select').first().waitFor();
      assert.equal(await page.locator('.settings select').count(), 0, `${name} has no browser select`);
    }

    const before = (await setpoint.api<Settings>('GET', '/settings')).reminders.task_time;
    const chip = page.locator('.settings').getByRole('button', {name: 'Task reminders', exact: true});
    const menu = page.locator('.settings').getByRole('menu', {name: 'Task reminders', exact: true});
    await chip.click();
    const labels = await menu.getByRole('menuitemradio').allTextContents();
    const current = await menu.getByRole('menuitemradio', {checked: true}).allTextContents();
    assert.equal(current.length, 1, 'one choice checked');
    assert.equal(await chip.locator('.num').textContent(), current[0]);
    await page.keyboard.press('Escape');
    await menu.waitFor({state: 'detached'});
    assert.equal(await page.locator('.settings').count(), 1, 'Esc closes the menu, not Settings');

    await chip.focus();
    await page.keyboard.press('Enter');
    await until('the checked choice focused', () => menu.getByRole('menuitemradio', {checked: true}).evaluate(item => document.activeElement === item), Boolean);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await menu.waitFor({state: 'detached'});
    const next = labels[(labels.indexOf(current[0]!) + 1) % labels.length]!;
    await until('the chip shows the next choice', () => chip.locator('.num').textContent(), text => text === next, 5000);
    await settled('saved', () => setpoint.api<Settings>('GET', '/settings'), value => value.reminders.task_time !== before);
    assert.equal(await chip.evaluate(button => document.activeElement === button), true, 'focus back on the chip');
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

test('Notifications: the server and its token, Send test reaching a fake ntfy, the switches, the defaults and the buffer', async () => {
  const ntfy = await fakeNtfy();
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'notifications');
    const settings = () => setpoint.api<Settings>('GET', '/settings');
    await page.locator('.settings .set-label', {hasText: 'Not set up'}).waitFor();
    // With no server, the topics' switches can't work: off and disabled, saying what's missing, and no
    // Send test; Time to Leave waits for Home the same way (UX #13).
    for (const name of ['setpoint-reminders', 'setpoint-mail', 'Reconnect alerts']) {
      const toggle = page.getByRole('switch', {name});
      assert.deepEqual([await toggle.isDisabled(), await toggle.getAttribute('aria-checked')], [true, 'false'], name);
    }
    assert.equal(await page.locator('.settings .set-row', {hasText: 'setpoint-reminders'}).locator('.s').textContent(), 'Set a server first');
    assert.equal(await page.getByRole('button', {name: 'Send test'}).count(), 0);
    assert.equal(await page.getByRole('switch', {name: 'Time to Leave'}).isDisabled(), true);
    assert.equal(await page.locator('.settings .set-row', {hasText: 'Time to Leave'}).locator('.s').textContent(), 'Set Home first');
    await page.locator('.settings input[aria-label="ntfy server"]').fill(ntfy.url);
    await page.keyboard.press('Enter');
    await settled('the server', settings, value => value.notifications.ntfy_server === ntfy.url);
    await until('the switches work', () => page.getByRole('switch', {name: 'setpoint-reminders'}).isDisabled(), disabled => !disabled);

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
    await page.getByRole('switch', {name: 'setpoint-reminders'}).click();
    await page.getByRole('switch', {name: 'Reconnect alerts'}).click();
    await settled('switches', settings, value => value.notifications.attention_mail && !value.notifications.reminders && !value.notifications.reconnect_alerts);
    await page.locator('.settings .set-row', {hasText: 'setpoint-mail'}).locator('.s', {hasText: /^Attention mail$/}).waitFor();

    await choose(page, 'Event reminders', '30 min before');
    await choose(page, 'Task reminders', '8:00 AM on the due day');
    await page.getByRole('group', {name: 'Buffer'}).getByRole('button', {name: 'More'}).click();
    await settled('defaults and buffer', settings, value => value.reminders.event_minutes_before === 30 && value.reminders.task_time === '08:00' && value.time_to_leave.buffer_minutes === 10);
    await page.locator('.settings .stepper .v', {hasText: '10 min'}).waitFor();
    // Each default offers None (D49).
    await choose(page, 'Event reminders', 'None');
    await choose(page, 'Task reminders', 'None');
    await settled('reminder defaults at None', settings, value => value.reminders.event_minutes_before === null && value.reminders.task_time === null);

    await page.getByRole('button', {name: /Not set · set in Calendar/}).click();
    await page.locator('.settings .set-title', {hasText: 'Calendar'}).waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
    await ntfy.close();
  }
});

test('Calendar, Todoist and Appearance: a calendar hidden, Home set with its coordinates, weather off, the default project, Light', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'calendar');
    const settings = () => setpoint.api<Settings>('GET', '/settings');
    // Every group has its label.
    await page.getByRole('switch', {name: 'Show Classes'}).waitFor();
    assert.deepEqual(await page.locator('.settings .set-label').allTextContents(), ['Calendars', 'Home', 'Weather and places']);

    await page.getByRole('switch', {name: 'Show Classes'}).click();
    await settled('Classes hidden', () => setpoint.api<CalendarOut[]>('GET', '/calendars'), list => list.find(calendar => calendar.name === 'Classes')?.visible === false);

    await page.getByRole('button', {name: 'Set Home'}).click();
    await page.locator('.settings input[aria-label="Home"]').fill('blue door');
    await page.locator('.settings button.set-row', {hasText: 'Blue Door Bistro'}).click();
    const home = await settled('Home', settings, value => value.calendar.home !== null);
    assert.deepEqual(home.calendar.home, {label: 'Home', address: '845 Example St, Los Angeles', lat: 34.1478, lng: -118.1445});
    await page.locator('.settings .set-row', {hasText: '845 Example St, Los Angeles'}).waitFor();

    await page.getByRole('switch', {name: 'Weather'}).click();
    await settled('weather off', settings, value => !value.calendar.weather);

    await page.locator('.settings .set-nav .nav', {hasText: 'Todoist'}).click();
    await choose(page, 'Default project', 'School');
    await settled('default project', settings, value => value.todoist.default_project === 'School');
    await page.getByRole('button', {name: 'Reconnect'}).click();
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
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'calendar');
    const calendars = () => setpoint.api<CalendarOut[]>('GET', '/calendars');
    const personal = page.locator('.settings [data-calendar]', {hasText: 'Personal'});
    // Todoist has its ring and no colour to pick.
    assert.equal(await page.locator('.settings [data-calendar]', {hasText: 'Todoist'}).locator('.sw').count(), 0);

    await personal.getByRole('button', {name: 'Personal colour'}).click();
    assert.equal(await page.locator('.settings .swatches .sw').count(), 11);
    await page.locator('.settings .swatches .sw[aria-label="violet"]').click();
    await personal.locator('.spin').waitFor({state: 'attached'});
    assert.equal(await personal.getAttribute('class'), 'set-row one cal-row pending');
    await settled('Personal is violet at Google', calendars, list => list.some(calendar => calendar.name === 'Personal' && calendar.colour === 'violet' && calendar.command === null));
    await personal.locator('.spin').waitFor({state: 'detached'});
    const violet = 'oklch(0.8 0.11 300)';
    assert.equal(await personal.locator('.sw').evaluate(sw => getComputedStyle(sw).getPropertyValue('--c').trim()), violet);

    // Google refuses alert (the dev provider's rule): failed in place, in Google's words.
    await personal.getByRole('button', {name: 'Personal colour'}).click();
    await page.locator('.settings .swatches .sw[aria-label="alert"]').click();
    const refusal = personal.locator('.s.failed', {hasText: 'Couldn\'t change its colour, Google Calendar, The caller does not have permission (403 Forbidden)'});
    await refusal.waitFor();
    assert.equal(await personal.locator('.sw').evaluate(sw => getComputedStyle(sw).getPropertyValue('--c').trim()), 'oklch(0.72 0.17 25)', 'the colour picked stays in place');
    // Try again: pending once more, then refused again.
    await personal.getByRole('button', {name: 'Try again'}).click();
    await personal.locator('.spin').waitFor({state: 'attached'});
    await refusal.waitFor();
    // Change back: violet again, nothing waiting.
    await personal.getByRole('button', {name: 'Change back'}).click();
    await settled('back to violet', calendars, list => list.some(calendar => calendar.name === 'Personal' && calendar.colour === 'violet' && calendar.command === null));
    await refusal.waitFor({state: 'detached'});

    // The calendar shows it: the sidebar's checkbox and Personal's events.
    await page.keyboard.press('Escape');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    assert.equal(await page.locator('.calrow', {hasText: 'Personal'}).evaluate(row => getComputedStyle(row).getPropertyValue('--c').trim()), violet);
    assert.equal(await page.locator('.cell[data-date="2026-10-07"] .ev', {hasText: 'Gym'}).evaluate(chip => getComputedStyle(chip).getPropertyValue('--c').trim()), violet);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('SV-25: a Todoist project\'s colour, picked from Todoist\'s 20, waits for Todoist at .5 with its spinner, then rings its tasks; one Todoist refuses stays with its words until Try again or Change back', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('target');
    await openAt(page, setpoint.base, 'todoist');
    const projects = () => setpoint.api<TodoistProjectOut[]>('GET', '/todoist/projects');
    const home = page.locator('.settings [data-project]', {hasText: 'Home'});
    const colourOf = (row: typeof home) => row.locator('.sw').evaluate(sw => getComputedStyle(sw).getPropertyValue('--c').trim());
    assert.deepEqual(await page.locator('.settings [data-project] .t').allTextContents(), ['Inbox', 'School', 'Home']);
    assert.equal(await colourOf(home), '#c77100', 'the seed\'s Home is orange');

    await home.getByRole('button', {name: 'Home colour'}).click();
    assert.equal(await page.locator('.settings .swatches .sw').count(), 20);
    assert.equal(await page.locator('.settings .swatches .sw.on').getAttribute('aria-label'), 'Orange');
    await page.getByRole('button', {name: 'Teal', exact: true}).click();
    await home.locator('.spin').waitFor({state: 'attached'});
    assert.equal(await home.getAttribute('class'), 'set-row one cal-row pending');
    await settled('Home is teal at Todoist', projects, list => list.some(project => project.name === 'Home' && project.colour === 'teal' && project.command === null));
    await home.locator('.spin').waitFor({state: 'detached'});
    assert.equal(await colourOf(home), '#148fad');

    // Todoist refuses taupe (the dev provider's rule): failed in place, in Todoist's words.
    await home.getByRole('button', {name: 'Home colour'}).click();
    await page.getByRole('button', {name: 'Taupe', exact: true}).click();
    const refusal = home.locator('.s.failed', {hasText: 'Couldn\'t change its colour, Todoist, Insufficient permissions (403 Forbidden)'});
    await refusal.waitFor();
    assert.equal(await colourOf(home), '#8f7a69', 'the colour picked stays in place');
    await home.getByRole('button', {name: 'Try again'}).click();
    await home.locator('.spin').waitFor({state: 'attached'});
    await refusal.waitFor();
    await home.getByRole('button', {name: 'Change back'}).click();
    await settled('back to teal', projects, list => list.some(project => project.name === 'Home' && project.colour === 'teal' && project.command === null));
    await refusal.waitFor({state: 'detached'});

    // The calendar shows it: Home's tasks ring in teal on the grid and in the agenda, School's in sky blue.
    await page.keyboard.press('Escape');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ag-item', {hasText: 'Dentist'}).waitFor();
    const ring = (selector: string, title: string) => page.locator(selector, {hasText: title}).locator('.ring').evaluate(el => getComputedStyle(el).borderTopColor);
    // A ring can still be easing its colour in (the agenda's does), so each is read once it's there.
    await until('Pay rent rings teal on the grid', () => ring('.cell[data-date="2026-10-07"] .tk', 'Pay rent'), colour => colour === 'rgb(20, 143, 173)');
    await until('and in the agenda', () => ring('.ag-task', 'Pay rent'), colour => colour === 'rgb(20, 143, 173)');
    await until('CS 101 lab report rings sky blue', () => ring('.cell[data-date="2026-10-07"] .tk', 'CS 101 lab report'), colour => colour === 'rgb(49, 157, 192)');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
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
    // Default names its model, and OpenAI's models wait for their key (UX #14).
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
    const disabled = (await choices()).flatMap(choice => (choice.disabled ? [choice.text] : []));
    assert.ok(disabled.length > 0 && disabled.every(text => text?.startsWith('GPT')), `only OpenAI's wait for a key: ${disabled.join(', ')}`);
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
    assert.equal(await page.getByRole('button', {name: 'Add passkey'}).locator('svg').count(), 1);
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

test('a wide screen (2400 × 1300, zoomed 1.25): ⌘K, Settings and the offline pill keep their sizes and places', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page({width: 2400, height: 1300});
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.arow').first().waitFor();
    const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
    const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) <= 1, `${what}: ${a}, expected ${b}`);

    // Each measured where it rests, once it has risen into place.
    await page.keyboard.press('Meta+k');
    await page.locator('.palette').waitFor();
    await still(page);
    const palette = await box('.palette');
    near(palette.width, 640 * 1.25, 'the palette\'s width');
    near(palette.x + palette.width / 2, 1200, 'the palette is centred');
    near(palette.y, 160 * 1.25, 'the palette\'s top');
    await page.keyboard.press('Escape');

    await page.keyboard.press('Meta+,');
    await page.locator('.settings').waitFor();
    await still(page);
    const modal = await box('.settings');
    near(modal.width, 1040 * 1.25, 'Settings\' width');
    near(modal.height, 720 * 1.25, 'Settings\' height');
    near(modal.x, (2400 - 1300) / 2, 'Settings is centred across');
    near(modal.y, (1300 - 900) / 2, 'and down');
    near((await box('.settings .set-nav')).width, 220 * 1.25, 'the nav');
    await page.keyboard.press('Escape');

    await page.context().setOffline(true);
    const pill = await box('.offline-pill');
    const main = await box('.main');
    near(pill.height, 36 * 1.25, 'the pill\'s height');
    near(pill.x + pill.width / 2, main.x + main.width / 2, 'the pill is centred over the page');
    near(pill.y, 12 * 1.25, 'the pill sits 12 px under the top');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
