// Settings › Places without the Google Maps key (and no dev run's invented places): Add place and
// Home's Change say where to set it instead of searching.
import {DEFAULT_SETTINGS} from '@setpoint/shared';
import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {render} from 'vitest-browser-react';
import {PlacesPage} from '../../src/app/settings/Places.tsx';

const json = (body: unknown) => new Response(JSON.stringify(body), {status: 200, headers: {'content-type': 'application/json'}});
beforeEach(() => {
  vi.spyOn(window, 'fetch').mockImplementation(async input => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, window.location.href);
    if (url.pathname.endsWith('/settings')) return json({...DEFAULT_SETTINGS, places: {saved: [{name: 'Work', address: '1200 Market Ave'}]}});
    if (url.pathname.endsWith('/secrets')) return json([{name: 'places_api_key', set: false, updated_at: null}]);
    return json([]);
  });
});
afterEach(() => vi.restoreAllMocks());

test('without the Maps key, Add place and Home say to set it below instead of searching', async () => {
  await render(<div className="settings"><PlacesPage /></div>);
  await page.getByRole('button', {name: 'Add place'}).click();
  await expect.element(page.getByText('Set the Google Maps key below')).toBeVisible();
  await expect.element(page.getByRole('textbox', {name: 'Name'})).toBeVisible();
  expect(page.getByRole('textbox', {name: 'Address'}).elements()).toHaveLength(0);
  await page.getByRole('button', {name: 'Cancel'}).click();
  await page.getByRole('button', {name: 'Set Home'}).click();
  await expect.element(page.getByText('Set the Google Maps key below')).toBeVisible();
  expect(page.getByRole('textbox', {name: 'Home'}).elements()).toHaveLength(0);
});
