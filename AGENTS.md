# Setpoint v2: working rules

The user's private workspace for mail and time: one inbox across their accounts, and the calendar with
Todoist tasks.

## Sources of truth

- [DESIGN.md](DESIGN.md) owns the global design rules: principles, tokens, motion, glyphs and copy.
- The tests own behaviour: what a page does is what its specs check.
- [OPERATIONS.md](OPERATIONS.md) owns the image, its settings and its command line, and a module's
  README (such as [server/src/jobs/README.md](server/src/jobs/README.md)) owns that module.
- [design-export/](design-export/README.md) is the original visual reference; the app and its tests
  win over it.
- [web/tests/README.md](web/tests/README.md) explains how the test runs and release checks work.
- Precedence: the owner's rules here, then DESIGN.md and the tests, then the export.
  Where the docs leave something unclear, ask the owner, one question at a time.

## Working

- Track work in the issue tracker, one issue per slice, with its decisions recorded there. A change
  to a global design rule goes in DESIGN.md too, with the owner's agreement.
- Committed files and commit messages carry no tracker ids, decision numbers or names.
- One logical change per commit, a single-line `feat:`, `fix:` or `chore:` message, no agent
  co-author.
- Push `master` once a change's checks pass and its diff is clear of private details. Never
  push tags.
- Anything else outward-facing needs the owner's go-ahead: deploying (only a pushed commit), creating a
  remote, provider consoles, mantel or Home Assistant.

## Checks

- `npm test` passes before every commit. `npm run test:browser -- <spec names>` runs the spec files
  covering the change (`--only "<prefix>"` to iterate on one check); a change to the harness or
  shared styles runs them all. Say what ran.
- One browser run at a time per machine, behind a shared lock: run them in the background when
  another session may be testing.
- Before a release, `npm run release:check` (Docker running).
- A new native package goes in the browser bundle's `external` (web/tests/browser/bundle.ts).

## Dev server

- `npm run try` is the one dev Setpoint (`setpoint-dev` in `.claude/launch.json`, its only entry):
  `data/dev/`, port 7450 (Vite, hot reloading; its API on 7451), the seed's clock, password `dev`;
  `-- --reset` reseeds, `-- --build` serves the built app instead. Sessions share it
  and may change its data, which should stay representative of prod.
- In a worktree, `npm ci` first, then `npm run try` in the background: it serves that worktree's web
  app on the next free port from 7460, on setpoint-dev's API and data, and prints the URL. Open that
  URL in the browser pane, not the `setpoint-dev` entry, which is the main checkout's page. A sign-in
  on any of these ports covers the rest. The API is the main checkout's code, so a slice that
  changes the server runs `npm run try -- --own`: its own Setpoint on a temporary copy of `data/dev`,
  removed when it stops.
- Don't add launch.json entries or `data/` copies. A check that needs its own instance runs it from
  your scratchpad and leaves nothing behind.
- Pair the Chrome extension only when a check needs it (extension/README.md).

## Tests own behaviour

- Every behaviour bug fix starts with a failing test. A presentation bug is fixed without one,
  unless it hides or breaks content and the sweep doesn't catch it. When a bug looks visual but its
  cause is logic (state, timing, data), test that logic at the smallest level, not its appearance.
  There is no known-failing list.
- Pure rules are tested as tables. Persistence runs against an ephemeral SQLite database.
- Providers are faked at the HTTP or IMAP boundary: no test, seed or dev run reaches a real
  provider, ntfy, Home Assistant or a model. No mocks of internal modules.
- A widget's own behaviour goes to a component test (`web/tests/components/`); a browser check
  keeps what needs the app around it: the server, routing, layout across pages, journeys.
- Assert what the screen does. A single value goes untested unless it's a relation that keeps
  content usable (fits, not clipped, not covered); colours, sizes and motion are judged by eye.
- Checks are deterministic: no stress run, no dependence on animation, scrolling or real
  time. A timed window is held (`holdToast`, `page.clock`, a held server answer), a read
  waits for what it reads, and a check that races is fixed by removing the dependence, never by
  adding a wait. The lint enforces the pause and bound rules.
- A fix whose check went red on its own says so in the commit ("the X check caught it").

## Boundaries (the lint enforces them)

- `shared/` is the contract: enums, Zod schemas and API types, changed deliberately.
- Only `web/src/api/` talks to the server. Only `server/src/providers/` imports provider SDKs, and
  `server/src/domain/` stays pure. Only `server/src/notify/` knows about ntfy.

## Public repository

This folder is the public `ansidian/setpoint` repository, so every commit on `master` is public
once pushed. Never commit private domains, addresses, account addresses or tailnet names; host
details live in the private ops workspace. Code calls its owner "the user", and the docs say "the user" or "the owner", never a name.
Sample data is invented, and secrets, `.env` files and `data/` stay out of git.
