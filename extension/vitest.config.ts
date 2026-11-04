// Setpoint on LinkedIn's tests (SV-174): its readers against trimmed LinkedIn pages, its words and its
// badge's rule, in a real Chromium as the component tests run (web/vitest.components.config.ts), with
// the same browser and nothing downloaded. One headless page for a few seconds, so they take no lock.
import {playwright} from '@vitest/browser-playwright';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    name: 'extension',
    include: ['tests/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(process.env.SETPOINT_COMPONENTS_CHROME === '1' ? {launchOptions: {channel: 'chrome'}} : {}),
      instances: [{browser: 'chromium', viewport: {width: 1280, height: 800}}],
      screenshotFailures: false,
    },
  },
});
