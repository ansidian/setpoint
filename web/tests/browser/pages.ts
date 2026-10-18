// The release's page screenshots (SV-98, D281): whole pages in Night, Light and on the phone, each
// taken in the check that builds its state. Only `npm run test:pages` (which release:check runs)
// and `npm run goldens` compare them, by running just these checks (run.ts); everywhere else
// matchGolden is a no-op, so no change waits on a screenshot.

export interface PageShot {
  // Its approved screenshot, web/tests/browser/goldens/<name>.png, and its board's name in the audit.
  name: string;
  // The spec file whose check takes it, and the start of that check's name.
  spec: string;
  test: string;
}

export const PAGES: readonly PageShot[] = [
  {name: '01-inbox-a-typical-morning', spec: 'boards', test: 'board 01:'},
  {name: '11-calendar-october-2026', spec: 'calendar', test: 'board 11:'},
  {name: '13-editor-new-event', spec: 'editor', test: 'board 13:'},
  {name: '17-settings-accounts', spec: 'settings', test: 'board 17:'},
  {name: '21a-phone-inbox', spec: 'phone', test: 'board 21:'},
  {name: '22a-light-inbox', spec: 'theme', test: 'board 22a:'},
  {name: '22b-light-calendar', spec: 'theme', test: 'board 22b:'},
  {name: '25-news-a-typical-morning', spec: 'news', test: 'board 25:'},
  {name: '31-light-news', spec: 'news', test: 'board 31:'},
];

/** Set by `npm run test:pages` and `npm run goldens`: matchGolden compares (or re-captures). */
export const COMPARING = process.env.SETPOINT_PAGES === '1';
