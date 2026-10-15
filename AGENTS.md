# Setpoint v2: working rules

Andy's private workspace for mail and time: one inbox across his accounts, and the calendar with
Todoist tasks. A ground-up rebuild of v1 (`../setpoint`) on darma's stack.

## Sources of truth

- [BRIEF.md](BRIEF.md) owns scope, the data model, integrations and the cutover (decisions 1–48).
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

- `npm test` (lint, typecheck, Vitest) passes before every commit; `npm run test:browser` (build
  and Playwright, from F1) too for what it covers. Say what ran.
- `npm run test:browser -- mail search` runs only those spec files. One browser run at a time on
  this machine: a run waits for another session's, saying whose, and stops at 15 minutes. It ends
  with its time and slowest checks; past its budget, look there before adding checks. A direct
  `node --test` of the specs and the board audit wait for the same lock (web/tests/browser/lock.ts),
  and each of them waits while a checkout from before the lock has a browser open.
- A check that fails or times out keeps a trace of its pages under `test-results/browser/traces/`,
  and the run says where: `npx playwright-core show-trace <file>` replays every action, with the
  screen and the DOM at each step, before guessing at what was mid-flight (SV-75).
- A change to what a page shows also runs the spec files it touches under stress before commit
  (`npm run test:browser:stress -- mail search`, a few minutes for a large file), so a check that reads
  before what it reads has come is caught in the same commit, not at the release's run.
- Before a release, besides those: the board audit (`npm run audit:boards`) and
  `npm run test:browser:stress`, the browser checks on a CPU slowed 4×, with /api answering late,
  one at a time and last-asked first, and the web fonts late (D81), so a check that reads before
  what it reads has come fails every time. A stress run takes about 10 minutes.
- `npm run try` builds, seeds `data/try/`, starts Setpoint on port 7450 and claims it, then prints
  how to sign in: the quickest way to see a change or reproduce a report by hand.
- `npm run seed` loads BRIEF.md's sample into `data/dev/` (`-- --reset` starts over;
  `SETPOINT_DATA_DIR` moves it). Its fixed now is `SEED_NOW` in `@setpoint/shared`.
- With `data/news-snapshot/` there (real news taken once from prod, `server/src/dev/exportNews.ts`),
  `npm run seed` and `npm run try` load News from it, its times moved onto the seed's clock, in place
  of the sample's. It stays out of git (Local names the area); the browser checks seed with
  `--sample-news`, so they and the goldens never see it.

## Tests own behaviour

- Pure rules are tested as tables. Persistence runs against an ephemeral SQLite database, never
  SQL text.
- Providers are faked at the HTTP or IMAP boundary. No test, seed or dev run reaches a real
  provider, ntfy, Home Assistant or a model.
- No mocks of internal modules. Presentation goes to browser checks against approved screenshots of
  the app (`web/tests/browser/goldens/`, D69), each of the region its check is about, with the
  shared parts checked once each (`REGIONS` in harness.ts, D76). A decision that is a single value
  (a gap, a colour, an alignment) also gets a check that states it. A deliberate visual change
  re-captures its screenshots in the same commit (`npm run goldens`), and each changed image is
  looked at beside its diff before committing. A decision that changes the screen also runs the
  board audit (`npm run audit:boards`) and notes what it showed in the decision.
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
