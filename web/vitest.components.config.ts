// Component tests (SV-101): one widget at a time, rendered by React in a real Chromium with the
// app's own stylesheet and tokens, in Vitest's browser mode. They take the Chromium the browser
// checks launch (Playwright's own, else Google Chrome) and download nothing. One headless page for a
// few seconds, so they don't take the browser checks' lock (web/tests/browser/lock.ts).
import react from '@vitejs/plugin-react';
import {playwright} from '@vitest/browser-playwright';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'components',
    include: ['tests/components/**/*.test.tsx'],
    setupFiles: ['tests/components/setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(process.env.SETPOINT_COMPONENTS_CHROME === '1' ? {launchOptions: {channel: 'chrome'}} : {}),
      instances: [{browser: 'chromium', viewport: {width: 1280, height: 800}}],
      screenshotFailures: false,
    },
  },
});
