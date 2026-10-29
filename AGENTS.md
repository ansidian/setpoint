# Setpoint v2: working rules

Andy's private workspace for mail and time: one inbox across his accounts, and the calendar with
Todoist tasks. A ground-up rebuild of v1 (`../setpoint`) on darma's stack.

## Sources of truth

- [BRIEF.md](BRIEF.md) owns scope, the data model, integrations and the cutover (decisions 1–73).
- [DESIGN.md](DESIGN.md) owns what's on screen and how it behaves. It wins over the export in
  [design-export/](design-export/README.md); its Overrides list every known case.
- [BUILD-PLAN.md](BUILD-PLAN.md) owns the slices, their order and their Done-when lists.
- Precedence: Andy's rules here, then DESIGN.md, then the export, then the brief's visual notes.
  Where the docs leave something unclear, ask Andy, one question at a time.

## Working

- v1 is read-only. Its code comes over only through the harvest gate (BUILD-PLAN.md › Rules for
  every slice): read the module and its tests, explain every branch in the slice's issue, decide
  keep / adapt / rewrite, port it with its tests, and the orchestrator reviews before it lands.
- Tracking is darma project **SV**: one issue per slice. Decisions go in as darma decisions and,
  when they change the screen, in DESIGN.md › Decided while building, with Andy's agreement.
- Commit one logical change at a time with a single-line `feat:`, `fix:` or `chore:` message.
  Never add an agent co-author.
- Pushing `master` needs no go-ahead (D119): push once a change's checks pass and its diff has been
  looked over for private details (Public repository, below). Never push tags; `pre-public` stays
  local.
- Anything else outward-facing needs Andy's go-ahead first: deploying (only a pushed commit),
  creating a remote, provider consoles (redirect URIs, Pub/Sub, the Todoist webhook), mantel or
  Home Assistant.

## Verification

- `npm test` (lint, typecheck, Vitest, its component tests in Chromium too) passes before every
  commit, and `npm run test:browser` (build and Playwright) for the spec files covering what the
  change touches; a change to the harness or the shared styles runs them all. Say what ran.
- `npm run test:browser -- mail search` runs only those spec files, and
  `npm run test:browser -- mail --only "S8"` only the checks whose names start that way: iterate on
  the one check, then run its files before the commit (a run with `--only` isn't recorded for
  release:check). A file's checks run side by side, sharing the run's six slots, so one file is
  about as quick as its slowest few checks (SV-102); a check therefore keeps nothing in module
  state that another check reads. One browser run at a time on this machine: a run waits for
  another session's, saying whose, and stops at 15 minutes. It ends with its time and slowest
  checks; past its budget, look there before adding checks. A direct
  `node --test` of the specs and the board audit wait for the same lock (web/tests/browser/lock.ts),
  and each of them waits while a checkout from before the lock has a browser open.
- A check that fails or times out keeps a trace of its pages under `test-results/browser/traces/`,
  and the run says where: `npx playwright-core show-trace <file>` replays every action, with the
  screen and the DOM at each step, before guessing at what was mid-flight (SV-75).
- Stress, the page screenshots and the board audit run at release, not per change (D281). A spec
  file that is new or largely rewritten runs once under stress before its commit
  (`npm run test:browser:stress -- mail`), so a check that reads before what it reads has come is
  caught there rather than at the release.
- Before a release: `npm run release:check` (SV-83, D274). It runs `npm test`, the browser checks,
  the same under stress (`npm run test:browser:stress`: a CPU slowed 4×, /api answering late, one
  at a time and last-asked first, and the web fonts late, D81, so a check that reads before what it
  reads has come fails every time), the page screenshots (`npm run test:pages`) and the board
  audit, each only where it hasn't already passed on HEAD's exact content. Every passing run records
  itself by the working tree's content, so the runs before a commit count, spec file by spec file,
  and the audit runs when the screenshots or boards have changed. It says what it skipped and ends with whether HEAD is ready. A full stress run takes 5
  to 10 minutes.
- When Andy says a release is coming, the session that pushes its commit runs
  `npm run release:check` in the background straight after, so the release finds it done. It holds
  the browser lock while it runs.
- `npm run try` builds, seeds `data/try/`, starts Setpoint on port 7450 and claims it, then prints
  how to sign in: the quickest way to see a change or reproduce a report by hand.
- `npm run seed` loads BRIEF.md's sample into `data/dev/` (`-- --reset` starts over;
  `SETPOINT_DATA_DIR` moves it). Its fixed now is `SEED_NOW` in `@setpoint/shared`.
- With `data/news-snapshot/` there (real news taken once from prod, `server/src/dev/exportNews.ts`),
  `npm run seed` and `npm run try` load News from it, its times moved onto the seed's clock, in place
  of the sample's. It stays out of git (Local names the area); the browser checks seed with
  `--sample-news`, so they and the page screenshots never see it.

## Tests own behaviour

- Pure rules are tested as tables. Persistence runs against an ephemeral SQLite database, never
  SQL text.
- Providers are faked at the HTTP or IMAP boundary. No test, seed or dev run reaches a real
  provider, ntfy, Home Assistant or a model.
- No mocks of internal modules. Presentation goes to browser checks and component tests that state
  what the screen does: what's there after an action, and a single value where it matters: a colour
  or fill that depends on state, theme or the cascade (hover, press, focus, selected, outside the
  month, Light beside Night, a role colour on a glyph); a relation rather than a literal (fits or
  clips, beside or inside, equal room, a width at a breakpoint); or a value that has already moved
  by accident, stated in the commit that fixes it. A literal that only restates the stylesheet or a
  token (a padding, a gap, a font size, a motion duration) is left to `web/tests/tokens.test.ts`
  (D269).
- A widget's own behaviour goes to a component test (`web/tests/components/*.test.tsx`, SV-101):
  React renders the one widget in a real Chromium with the app's stylesheets and tokens (Vitest's
  browser mode, part of `npm test`, a few seconds; no browser lock, it's one headless page). It
  finds by role, waits with `expect.element` or `expect.poll`, and takes the same single-value rule
  as a browser check. That's a select's keys and Esc, a picker's band, the toast's timing (with
  Vitest's clock, so its seconds pass at once): what the widget does with the props and the pointer
  or keys it's given. A browser check keeps what needs the app around it: the server and its seed, a
  save reaching the API, routing, one page's layout beside another, a widget's place among the
  others, and a journey across pages. When a component test takes over a check, the browser check
  shrinks to the journey and says where the rest went. Widgets with module state (the toast) are
  reset in the test; nothing in `web/src/` is mocked.
- The visual net is two things. Per change, the layout sweep (`web/tests/browser/sweep.spec.ts`,
  SV-99, runs with every `npm run test:browser`, about 30 s) visits the main pages in Night and Light
  at 1677, 1100 and 820 wide and on the phone. At rest it fails on anything that scrolls sideways,
  text an `overflow: hidden` box cuts (an ellipsis is meant), an interactive element covered at its
  centre (a pane lying over the page is meant), a broken image, a font not loaded, a failed request
  or a console error. Then axe runs on the same pages per theme, by rule and element; its contrast
  floor is 3:1 for now (D283, SV-100). A finding is fixed, with "the sweep caught it" or "axe caught
  it" in the commit, or decided in darma and left out in the spec by name.
- At release, nine whole-page screenshots (`web/tests/browser/pages.ts`: the Inbox, calendar, editor,
  News and Settings in Night, the Inbox, calendar and News in Light, the phone's Inbox) sit beside
  the sweep (D281, SV-97 found the region goldens before them caught nothing). They're compared only
  at release, in release:check. When one has changed on purpose, `npm run goldens` re-captures them
  and Andy looks at each changed image beside its diff before it's committed; a session never
  re-captures one just to make a run pass. The board audit (`npm run audit:boards`) sets them
  beside their boards at release.
- A browser check waits for what it reads (`until`, a waiting locator, `point`, `watch` in
  harness.ts; `goto` already waits for the page's first data and fonts). A fixed pause is only for
  a "nothing happened" check or a hover settling before a screenshot, and says so on the line
  before it (the lint asks, D82). So does a bound under the 5 s default: "at once" is proven by
  holding the server's answer, not by a short limit (the lint asks, SV-49).
  A "nothing happened" pause is followed by `setpoint.idle()`, so a wrong change still on its way
  is answered and drawn before the check reads, rather than landing after it (SV-49).
  A one-shot read of a computed style or box (`getComputedStyle`, `getBoundingClientRect`,
  `boundingBox`) goes through `rested`, which waits until nothing on the check's pages is moving:
  an element mid-entrance or mid-slide measures as it passes, not where it rests. A helper that
  reads is a reader, and so is one that calls a reader; each use of one rests, polls (`until`), or
  says why on the line before it, a read meant to catch motion (the lint asks, SV-75).
- Every bug fix starts with a failing test. There is no known-failing list.
- A fix whose browser check went red on its own, not because the design changed, says so in its
  commit message ("the X check caught it"): git has no other record of a check catching something,
  and the single-value rule is judged by that count (D269).
- What the iPhone app (setpoint-ios) reads is pinned in `shared/contract/`, recorded from the seed
  (SV-85). `npm test` fails when a response loses a key, changes a kind or a status, or an enum it
  carries gains a value, since an installed app is older than the server; a new key passes.
  `npm run contract:record` re-records, only once setpoint-ios handles the change.

## Boundaries (the lint enforces them)

- `shared/` is the contract: enums, Zod schemas and API types, changed deliberately.
- Only `web/src/api/` talks to the server. Only `server/src/providers/` imports provider SDKs, and
  `server/src/domain/` stays pure. Only `server/src/notify/` knows about ntfy.

## Public repository

This folder is the public `ansidian/setpoint` repository (since 2026-10-11, SV-9), so every
commit on `master` is public once pushed. Never commit private domains, addresses, account
addresses or tailnet names; host details live in the private ops workspace. Code calls its owner
"the user", not Andy (D115). Sample data is invented (example domains and Microsoft's fictional
companies), and secrets, `.env` files and `data/` stay out of git.
