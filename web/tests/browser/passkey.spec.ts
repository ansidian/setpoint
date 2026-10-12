// A full passkey ceremony in the browser (F7; B1 flagged it): Chromium's virtual authenticator over
// the DevTools protocol, on http://localhost (WebAuthn won't take an IP address as its relying party).
// Settings › Security asks for the password first, adds a passkey, turns on "a password and a
// passkey"; after Sign out the card takes the password, then the passkey; then the passkey alone
// signs in once the mode is back to either, and Security then asks for the password before a change.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {SecurityOut} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {choose, cleanUp, PASSWORD, startSetpoint} from './harness.ts';

after(cleanUp);

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const {authenticatorId} = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true},
  });
  return {credentials: async () => (await cdp.send('WebAuthn.getCredentials', {authenticatorId})).credentials};
}

test('a passkey: added in Settings › Security, then used to sign in, after the password and alone', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const port = new URL(setpoint.base).port;
    const local = `http://localhost:${port}`;
    const password = `${PASSWORD} ${port}`;
    const page = await setpoint.page('target');
    // Signed in at localhost too, with the session the harness claimed with.
    await page.context().addCookies([{...setpoint.cookie!, url: local}]);
    const authenticator = await virtualAuthenticator(page);

    // The claim gave the password a moment ago, so Security asks for nothing more yet.
    await page.goto(`${local}/inbox`);
    await page.locator('.arow').first().waitFor();
    await page.keyboard.press('Meta+,');
    await page.locator('.settings .set-nav .nav', {hasText: 'Security'}).click();
    await page.getByRole('button', {name: 'Add passkey'}).first().click();
    await page.locator('.settings input[aria-label="Passkey name"]').fill('Virtual key');
    await page.keyboard.press('Enter');
    await page.locator('.settings .set-row', {hasText: 'Virtual key'}).locator('.s', {hasText: 'Added'}).waitFor();
    assert.equal((await authenticator.credentials()).length, 1, 'the authenticator holds the new passkey');

    await choose(page, 'Sign in with', 'A password and a passkey');
    await page.locator('.settings .line', {hasText: 'Sign-in changed'}).waitFor();

    // Sign out (the foot of Settings' nav), then the password, then the passkey.
    await page.locator('.settings .set-nav .nav', {hasText: 'Sign out'}).click();
    // It asks once, in the toast (UX #21).
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).click();
    await page.locator('.sign-in').waitFor();
    await page.locator('.sign-in input[type="password"]').fill(password);
    await page.keyboard.press('Enter');
    await page.locator('.arow').first().waitFor();
    const security = await page.evaluate(() => fetch('/api/security').then(response => response.json() as Promise<SecurityOut>));
    assert.equal(security.auth_mode, 'password_plus_passkey');
    assert.ok(security.passkeys[0]!.last_used_at, 'the passkey was used');

    // Back to either, then the passkey alone.
    await page.keyboard.press('Meta+,');
    await page.locator('.settings .set-nav .nav', {hasText: 'Security'}).click();
    await choose(page, 'Sign in with', 'A password or a passkey');
    await page.locator('.settings .line', {hasText: 'Sign-in changed'}).waitFor();
    await page.locator('.settings .set-nav .nav', {hasText: 'Sign out'}).click();
    await page.locator('.toast', {hasText: 'Sign out of Setpoint?'}).getByRole('button', {name: 'Sign out'}).click();
    await page.getByRole('button', {name: 'Use a passkey'}).click();
    await page.locator('.arow').first().waitFor();
    const me = await page.evaluate(() => fetch('/api/me').then(response => response.json() as Promise<{method: string}>));
    assert.equal(me.method, 'passkey');

    // Signed in by passkey, no password was given: Security asks for it before any change.
    await page.keyboard.press('Meta+,');
    await page.locator('.settings .set-nav .nav', {hasText: 'Security'}).click();
    await page.locator('.settings .set-label', {hasText: 'Confirm it'}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Make new codes'}).isDisabled(), true);
    await page.locator('.settings input[name="password"]').fill('not it');
    await page.keyboard.press('Enter');
    await page.locator('.settings .line.failed', {hasText: 'Wrong password.'}).waitFor();
    await page.locator('.settings input[name="password"]').fill(password);
    await page.keyboard.press('Enter');
    await page.locator('.settings .set-label', {hasText: 'Confirm it'}).waitFor({state: 'detached'});
    assert.equal(await page.getByRole('button', {name: 'Make new codes'}).isDisabled(), false);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
