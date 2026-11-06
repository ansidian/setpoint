# How the checks work

The rules are in [AGENTS.md](../../AGENTS.md). This is how the machinery behind them works.

## npm test

Lint, typecheck, Vitest and the component tests (`components/*.test.tsx`, Vitest's browser mode in
a real Chromium with the app's stylesheets). It takes no lock and passes beside a browser run
(SV-144). Vitest runs one worker per performance core (vitest.config.ts), since one on an
efficiency core can miss a time limit. Component tests find by role, wait with `expect.element` or
`expect.poll`, use Vitest's clock for timed widgets, and reset module state (the toast); nothing in
`web/src/` is mocked.

## Browser runs

- `npm run test:browser -- mail search` runs those spec files; `--only "S8"` runs checks whose
  names start that way (not recorded for release:check).
- One shared lock (browser/lock.ts) across sessions: a run waits, saying whose, and gives up at 15
  minutes. A direct `node --test` and the board audit take the same lock.
- A file's checks run side by side in eight slots (SV-102), so a check keeps nothing in module
  state another reads. A run ends with its time and slowest checks; past its budget, look there.
- The server is a bundle made after the web build (browser/bundle.ts, SV-145); native packages stay
  `external`. The page screenshots, a direct `node --test` and the audit run the source.
- Runs record no traces at first. A check that fails runs again with one (up to ten), kept under
  `test-results/browser/traces/`: `npx playwright-core show-trace <file>`. One that passes the
  second time still fails the run: it races. `SETPOINT_BROWSER_TRACE` (1, `light` or 0) sets the
  first-time recording.

## Waiting in a check (harness.ts)

- Wait for what's read: `until`, a waiting locator, `point`; `goto` waits for first data and fonts.
- A fixed pause is only for a "nothing happened" check or a hover before a screenshot, says why on
  the line before, and is followed by `setpoint.idle()`. A bound under 5 s says why too; "at once"
  is proven by holding the server's answer (the lint asks, D82, SV-49).
- Timed windows are held: `holdToast`, `page.clock` with `pauseClock` and `runFor`, a held server
  answer, `SETPOINT_DEV_PROVIDER_HOLD`. A response waited for is read after `drawn` (SV-195).
- One-shot reads of styles or boxes go through `rested`, as do helpers that call readers (the lint
  asks, SV-75). A choice made from what's in sight or from timing is a pure rule with a table
  (`inSight`, `phoneSlide`, `nextAsk`).

## The visual net

- **Sweep** (browser/sweep.spec.ts, every browser run, ~40 s): main pages in Night at 1677, 1100,
  820 and phone. Fails on sideways scroll, clipped text, covered controls, broken images, missing
  fonts, failed requests, console errors; then axe in Night and Light at a 4.5:1 floor (D400). A
  finding is fixed ("the sweep caught it") or decided in darma and excluded by name.
- **Page screenshots** (browser/pages.ts, ten goldens) and the **board audit**
  (`npm run audit:boards`) run at release only (D281).

## release:check

Runs, cheapest and likeliest to fail first: npm test, page screenshots, the image build
(`git archive HEAD | docker build`, SV-188), browser checks, the audit. Each step is skipped where it
already passed on what it reads in HEAD (passes.ts › INPUTS, SV-193), so a docs-only commit is
ready in seconds and a goldens-only one reruns only the screenshots and audit. `-- unit pages image
browser audit` runs just those steps.

**Check ahead** (ahead.ts, SV-194): after each push to `master`, a reference-transaction hook
(`npm run ahead -- install`) runs `release:check --keep-going` on origin/master in
`.claude/worktrees/check-ahead`, one at a time, holding the browser lock. `npm run ahead -- status`
says how the last went.

## Dev data

- `npm run seed` loads BRIEF.md's sample into `data/dev/` (`SEED_NOW` in `@setpoint/shared` is its
  clock). With `data/news-snapshot/` present (server/src/dev/exportNews.ts), seed and try load real
  News from it; browser checks seed `--sample-news` and never see it.
- Search score (server/src/dev/scoreSearch.ts, SV-134): runs `matchSearch` over
  `data/search-test/test.json`. `--migrate` scores the local prod snapshot at this checkout's
  migrations, `--terms`, `--reading-prompts` and `--readings` cover terms and model readings
  (SV-138, SV-142). All of it stays under `data/`, in the main checkout.
