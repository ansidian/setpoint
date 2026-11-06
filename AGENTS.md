# Setpoint v2: working rules

Andy's private workspace for mail and time: one inbox across his accounts, and the calendar with
Todoist tasks. A ground-up rebuild of v1 (`../setpoint`) on darma's stack.

## Sources of truth

- [BRIEF.md](BRIEF.md) owns scope, the data model, integrations and the cutover.
- [DESIGN.md](DESIGN.md) owns what's on screen and how it behaves. It wins over
  [design-export/](design-export/README.md); its Overrides list every known case.
- [BUILD-PLAN.md](BUILD-PLAN.md) owns the slices, their order and their Done-when lists.
- [web/tests/README.md](web/tests/README.md) explains how the test runs and release checks work.
- Precedence: Andy's rules here, then DESIGN.md, then the export, then the brief's visual notes.
  Where the docs leave something unclear, ask Andy, one question at a time.

## Working

- v1 is read-only; its code comes over only through the harvest gate (BUILD-PLAN.md › Rules for
  every slice).
- Tracking is darma project **SV**, one issue per slice. Decisions go in as darma decisions and,
  when they change the screen, in DESIGN.md › Decided while building, with Andy's agreement.
- One logical change per commit, a single-line `feat:`, `fix:` or `chore:` message, no agent
  co-author.
- Push `master` once a change's checks pass and its diff is clear of private details (D119). Never
  push tags; `pre-public` stays local.
- Anything else outward-facing needs Andy's go-ahead: deploying (only a pushed commit), creating a
  remote, provider consoles, mantel or Home Assistant.

## Checks

- `npm test` passes before every commit. `npm run test:browser -- <spec names>` runs the spec files
  covering the change (`--only "<prefix>"` to iterate on one check); a change to the harness or
  shared styles runs them all. Say what ran.
- One browser run at a time per machine, behind a shared lock: run them in the background when
  another session may be testing.
- Before a release, `npm run release:check` (Docker running); read `npm run ahead -- status` first
  and fix what failed.
- A slice that changes what a page screenshot shows runs `npm run release:check -- pages image`
  before it lands. A changed golden goes to Andy beside its diff and is re-captured with
  `npm run goldens` in that slice, never just to make a run pass.
- A new native package goes in the browser bundle's `external` (web/tests/browser/bundle.ts).

## Dev server

- `npm run try` is the one dev Setpoint (`setpoint-dev` in `.claude/launch.json`, its only entry):
  `data/dev/`, port 7450, the seed's clock, password `dev`; `-- --reset` reseeds. Sessions share it
  and may change its data, which should stay representative of prod (D453).
- Don't add launch.json entries or `data/` copies. A check that needs its own instance runs it from
  your scratchpad and leaves nothing behind.
- Pairing it is a session's job: when the Simulator's app says Pair Again, open the link
  `npm run try` prints; pair the Chrome extension only when a check needs it (extension/README.md).
  Andy's own extension and phone stay on prod.

## Tests own behaviour

- Every bug fix starts with a failing test. There is no known-failing list.
- Pure rules are tested as tables. Persistence runs against an ephemeral SQLite database.
- Providers are faked at the HTTP or IMAP boundary: no test, seed or dev run reaches a real
  provider, ntfy, Home Assistant or a model. No mocks of internal modules.
- A widget's own behaviour goes to a component test (`web/tests/components/`); a browser check
  keeps what needs the app around it: the server, routing, layout across pages, journeys.
- Assert what the screen does, plus a single value only where it depends on state, theme or the
  cascade, or is a relation (fits, beside, equal room). A literal that restates the stylesheet or a
  token goes untested on purpose (D269).
- Checks are deterministic: no stress run (D446), no dependence on animation, scrolling or real
  time (D417). A timed window is held (`holdToast`, `page.clock`, a held server answer), a read
  waits for what it reads, and a check that races is fixed by removing the dependence, never by
  adding a wait. The lint enforces the pause and bound rules.
- A fix whose check went red on its own says so in the commit ("the X check caught it").
- `shared/contract/` pins what the iPhone app reads. Re-record (`npm run contract:record`) only
  once setpoint-ios handles the change.

## Boundaries (the lint enforces them)

- `shared/` is the contract: enums, Zod schemas and API types, changed deliberately.
- Only `web/src/api/` talks to the server. Only `server/src/providers/` imports provider SDKs, and
  `server/src/domain/` stays pure. Only `server/src/notify/` knows about ntfy.

## Public repository

This folder is the public `ansidian/setpoint` repository, so every commit on `master` is public
once pushed. Never commit private domains, addresses, account addresses or tailnet names; host
details live in the private ops workspace. Code calls its owner "the user", not Andy (D115).
Sample data is invented, and secrets, `.env` files and `data/` stay out of git.
