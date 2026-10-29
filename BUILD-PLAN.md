# Setpoint v2 build plan

Scope and decisions live in [BRIEF.md](BRIEF.md) (decisions 1–48), and the locked design in
[DESIGN.md](DESIGN.md) with its export in [design-export/](design-export/README.md). This plan cuts
the build into slices that each stand and test on their own: backend slices (B) and frontend slices
(F), run by one **orchestrating session** that hands each slice to a subagent and reviews what comes
back. Written 2026-10-07; each slice gains a "done" date and a Validated line as it lands, as
darma's plan does.

## How this plan is run

- **The orchestrator** (a fresh Claude Code session in this folder) reads AGENTS.md, BRIEF.md,
  DESIGN.md and this file, then works slice by slice. It hands each slice to a subagent with that
  slice's section, the files it owns and the contracts it must keep, then reviews the result against
  the slice's Done-when list before committing. Independent slices run in parallel (see
  [Order](#order-and-parallelism)).
- **Tracking:** a new darma project for v2 (Andy's decision, 2026-10-07; the orchestrator creates it,
  suggested key `SV`). There's one issue per slice, with `blocked_by` following [Order](#order-and-parallelism),
  and decisions are recorded as darma decisions and, where they change the screen, in DESIGN.md ›
  Decided while building. v1's `SP` issues stay with v1.
- **Andy's go-ahead** is needed for anything outward-facing: creating remotes, deploying, provider
  console changes (redirect URIs, Pub/Sub subscriptions, Todoist webhook), mantel or Home Assistant
  changes, and every cutover step.
- **Commits:** one logical change per commit, a single-line `feat:`, `fix:` or `chore:` message, no
  agent co-author, as in v1 and darma.

## Stack and layout

darma's stack (decision 34): TypeScript on Node 24 LTS, run directly with Node's type stripping (no
server build step); Hono with `@hono/node-server`; Drizzle over better-sqlite3 (synchronous
transactions, so each domain operation is atomic); Zod at every boundary; Vitest, ESLint and `tsc`;
React 19 and Vite 8 with no UI library; Geist, Geist Mono and the Material Symbols paths bundled;
Playwright for the browser. One process serves the API, the live stream and `web/dist` from one
origin and binds to 127.0.0.1, behind the existing Nginx.

npm workspaces:

- `shared/` (`@setpoint/shared`): the **contract**, written first and changed deliberately.
  - Enums: lanes, kinds, types, health states, recurring scopes, live-event types.
  - The Zod input schemas and the API's output types.
  - The search chip grammar's types.
  - The server and web import the same ones.
- `server/` (`@setpoint/server`):
  - `db/` (schema and migrations)
  - `domain/` (rules, as pure functions where possible)
  - `providers/` (one adapter per provider)
  - `sync/` (the engine)
  - `commands/` (the command layer)
  - `triage/`, `search/`, `alfred/`, `notify/`
  - `api/`, `workers/`, a CLI and the dev seed
- `web/`:
  - `src/tokens.ts`, mirroring DESIGN.md's tables and `design-export/styles/setpoint.css`, with a
    unit test comparing them
  - `src/logic/` (pure rules, tested as tables, as in mantel)
  - `src/app/` and `src/ui/` (components, kept thin)
  - `src/api/` (the only place that talks to the server)
- One root `tsconfig.base.json`, ESLint config and Vitest config (a list of workspace projects).

**Boundaries the lint enforces:** components never fetch, only `web/src/api/` does. Domain code never
imports a provider SDK, only `server/providers/` does. Nothing outside `server/notify/` knows about
ntfy. Alfred calls the same queries and commands as the API.

## Rules for every slice

### The harvest gate (decision 33)

Code from v1 (`../setpoint`) comes over only through this gate, one module at a time:

1. **Read** the v1 module and its tests.
2. **Explain every branch.** Write a short note in the slice's darma issue for each branch: what it
   does and why. A branch nobody can explain is probably a fixed bug, so keep it.
3. **Decide:** keep as is, adapt to v2's boundaries, or rewrite. Say which and why.
4. **Port it with its tests**, rewritten to v2's test policy below.
5. **The orchestrator reviews** the note and the port before it lands.

Candidates are listed per slice. Nothing else is copied. v1 is read-only throughout.

### Tests own behaviour (mantel's policy)

- Pure rules are tested as tables (triage policy, placement, the glide's duration, chip parsing,
  recurrence scope, health thresholds, counts).
- Persistence is tested against an ephemeral SQLite database, never SQL text.
- **Providers are faked at the HTTP or IMAP boundary.** No test, seed or dev run ever reaches real
  Gmail, iCloud, Google Calendar, Todoist, Places, Routes, weather, ntfy, Home Assistant or a model
  provider. Fakes answer as the providers do, including their errors (401 revoked, 409 conflict, 429,
  timeouts).
- No mocks of internal modules. Presentation goes to browser checks, not unit tests.
- **Playwright** runs in Chromium at 1677 × 1050, 1728 × 1117 and an iPhone size, against the
  production build with the seed. The checks state behaviour, relations and state-dependent values;
  nine whole-page screenshots (`web/tests/browser/pages.ts`, D281, in place of D69's region goldens)
  are compared only at release, and the board audit (`npm run audit:boards`) sets them beside their
  boards then. Before a release the checks also run under stress (`npm run test:browser:stress`: a
  CPU slowed 4×, /api late and out of order, the fonts late; D81), so a check that reads too early
  fails every time rather than now and then; a spec file that is new or largely rewritten runs once
  under stress before its commit. A failed check keeps a trace
  (SV-75), and a one-shot read of a style or box rests first (`rested`; the lint asks). A single
  value is stated in a check only where a golden can't hold it: a state-, theme- or cascade-dependent
  colour, a relation, or a value that has moved by accident before (D269).
- Every bug fix starts with a failing test. There is no known-failing list.

### Verification

- `npm test`: lint, typecheck and Vitest.
- `npm run test:browser`: build plus Playwright.
- Both pass before every commit that touches what they cover, and the orchestrator states what ran.
- Before a release, `npm run release:check`: the same under stress and the board audit too, each
  only where it hasn't already passed on HEAD's exact content (D274).

## Slices

### B0. Scaffold

- **Repository:** `git init` in this folder.
- **Remote:** a private remote for CI and backup during the build, if Andy wants one (ask). At
  cutover this history replaces `setpoint`'s (see B8).
- **Workspaces:** `shared`, `server` and `web` as above, with lint, typecheck and Vitest wired.
- **AGENTS.md and CLAUDE.md** in v1's thin style:
  - the source-of-truth map (BRIEF, DESIGN, BUILD-PLAN);
  - working rules, commit rules and verification;
  - the public-repository rule (no private domains, addresses or tailnet names).
- **`web/src/tokens.ts`** and its test against `setpoint.css`, Night and Light, applying DESIGN.md's
  overrides (Light `page` `#f6f6f4`; the done glyph `good`).
- **Fonts and icons:** Geist, Geist Mono and the icon paths from `design-export/glyphs/` bundled.
- **The dev seed:** `npm run seed` loads BRIEF.md's sample data into an empty database. Every
  email, item and count matches the brief and DESIGN.md's overrides (19 unread, 3 attention, 11
  unread FYI).
- **Done when:** `npm test` passes with the token test, and the seed loads.

### B1. Platform

- **Model:**
  - Owner, sessions, passkeys and recovery codes.
  - Settings.
  - Accounts and sources, each with provider, label, colour, icon, order, encrypted credentials and
    health.
  - Durable jobs, sync cursors and heartbeats.
  - Commands, each with its state (pending, confirmed, failed) and the provider's message.
  - A notification log.
  - An AI usage ledger.
- **Auth:**
  - A single owner, with a password (bcrypt) and/or passkeys.
  - An HttpOnly, Secure, SameSite=Strict session cookie, stored as a hash.
  - Recovery codes, and a first claim by setup token.
  - Harvest candidates: v1's `server/auth/*`.
- **Secrets:** AES-256-GCM with a fresh v2 format and key (`credential-encryption` is a harvest
  candidate). Provider credentials are write-only through the API.
- **The command layer:** every change to a provider is a command. It shows as pending until the
  provider confirms it; otherwise it fails with the provider's own message, with Try again (and
  Move back where it applies). One command per item at a time. Nothing quietly reverts.
- **Typed live events:** one stream carrying `mail`, `items` and `health` events. The web refreshes
  only what an event names.
- **The sync engine:**
  - An adapter interface: incremental sync from a cursor, a push trigger, a reconciliation sweep,
    and a heartbeat.
  - Durable jobs with one retry policy.
  - Health derived from the last successful check against a threshold from each source's own
    schedule (about twice the interval plus a grace). States: healthy, stale, failing, needs
    reconnect (decision 31).
- **The notification outlet:** one `notify()` with ntfy as its delivery: topics, click deep links,
  and Send test.
- **The API contract** for B2–B5 written in `shared/` before they start.
- **Done when:**
  - The table tests for health and command states pass.
  - Sign-in works locally.
  - A fake adapter drives the engine through all four health states.

### B2. Mail sync

- **Gmail adapter:**
  - OAuth with one consent for Gmail and Calendar, at the callback path
    `/api/ea/accounts/gmail/callback` (kept from v1 so the registration still matches).
  - The history cursor, Pub/Sub **pull** on its own subscription, and the reconciliation sweep.
  - Read state both ways, and `batchModify` for bulk changes.
  - Trash with undo, and the needs-reconnect signal.
- **iCloud adapter:** IMAP with an app password, a pooled connection, the seen flag both ways, and
  polling.
- **The message record:** one row per email, holding the provider fields plus the derived fields
  (lane, kind, organisation, type, key date, summary, security facts, protected, pinned, done,
  opened before Done).
- **Search index:** full-text search over the message record.
- **Backfill:** 365 days, resumable, with progress for "Indexing · 62%".
- **Remote content:** trust per domain, with sender authentication recorded.
- **Harvest candidates:** v1's `gmail-sync`, `gmail-pull`, `gmail-pubsub`, `gmailWatchStore`,
  `icloud`, `sender-authentication`, `email-index`.
- **Done when:**
  - The fakes take a mailbox through a backfill, new mail, read-elsewhere, Mark all as read,
    trash with undo and a revoked token.
  - Counts follow the rules: opening an unread email drops the unread counts, and Done drops the
    attention count.

### B3. Triage

- **The pipeline:** rules first, then a cheap model, then a strong model when unsure. Unsure defaults
  to **FYI**, never Attention (decision 30).
- **Extraction:** each email gets a lane, kind, organisation, type, key date, summary and security
  facts.
- **Codes:** verification codes are found by the ported detector and expire after the setting
  (15 minutes by default).
- **The protected class** always goes to Attention, and no rule can move it (decision 29).
- **Unsorted** when triage is down, re-sorted once it recovers.
- **Learning:**
  - **Done without opening** is recorded on the message.
  - **Pattern prompts** come from repeated Done-without-opening by the same organisation and type,
    never for protected mail.
  - A Yes creates a **learned rule**.
  - The precision figure covers the last 30 days.
- **Bring your own key:** Anthropic or OpenAI keys, model choices, and costs in the ledger.
- **Imports:** v1's rules and its 163 lane corrections, as seed evidence for the learning loop.
- **Harvest candidates:** `verification-code-detector`, the structure of v1's `preflight-rules.json`,
  and `triage-model-client`'s tool schema, extended with organisation, type and security facts.
- **Done when:**
  - Table tests cover the policy (protected, default FYI, codes, prompts).
  - A recorded set of anonymised fixture emails triages to the expected lanes with the model faked.

### B4. Search and Alfred

- **The chip grammar:** organisation, type, date or range (Chrono), account and kind. Chips filter
  exactly and results come newest first. Free text matches sender, then subject, then body, then
  date, with no importance boost.
- **Match reasons** come back with each result.
- **The search log:** each query, its chips, its results, and the position of the result opened.
- **Alfred:**
  - Tools that are the API's own queries and commands.
  - Answers with their sources, and follow-up turns.
  - Proposals for events and tasks, pre-filled from an email. Nothing is created without Andy.
  - Harvest candidates: v1's `server/alfred/*` tool shapes and the calendar proposal flow.
- **Done when:**
  - Table tests cover chip parsing ("northwind rejection march" → Northwind · Rejection · Mar 2026).
  - Search over the seed returns the brief's examples first.
  - Alfred with a faked model answers the brief's lease question with its source.

### B5. Calendar, Todoist and weather

- **Google Calendar adapter:**
  - Range reads and the calendar list.
  - Create, update and delete with recurring scope (this / following / all).
  - Watch channels with renewal, and the reconciliation sweep.
  - Places autocomplete with session tokens.
  - Harvest candidates: v1's `calendar-google-client`, `calendar-mutations`,
    `calendar-event-normalize`, `calendar-push*` and `google-places`.
- **Todoist adapter:**
  - OAuth at `/api/ea/accounts/todoist/callback`.
  - A mirror kept by sync, with the webhook at cutover.
  - Completed recurring occurrences kept with tombstones.
  - Create, update, complete and delete.
  - Harvest candidates: `server/tasks/*`, including v1's tombstone and `Z`-suffix fixes.
- **The item model:** events and tasks as items with a time, a source and reminders.
- **Weather:** day forecasts for the grid and the right pane.
- **Reminders and Time to Leave:**
  - Sent through `notify()`.
  - Time to Leave uses live routes from Home, with the buffer.
  - Harvest candidates: `server/reminders/*` (its timing logic, not its Discord sender) and
    `time-to-leave-*`.
- **Done when:**
  - The fakes take items through create, a recurring move with each scope, a 409 conflict (failed
    in place) and a completed recurring task.
  - Reminders reach a fake ntfy.

### B6. Home Assistant and mantel

- **Setpoint's side:** a read-only status endpoint for HA (attention count, unread FYI count, up to
  three attention emails, needs-reconnect sources), authenticated by its own token.
- **In the ops workspace**, following its AGENTS.md:
  - an HA integration in the finance importer's pattern exposing the sensors;
  - mantel's chip (DESIGN.md › mantel's mail chip), added to mantel's DESIGN.md first with Andy's
    agreement, then to its `chips.ts`, settings catalog and tests;
  - the needs-sign-in chip as an alert.
- **Done when:** mantel's tests and browser gate pass with the sensors patched in.

### B7. Packaging and side-by-side deployment

> **Changed 2026-10-08 (Andy, darma D40):** no side-by-side period and no two-week parity check.
> v2 replaces v1 directly on v1's hostname. The order: rehearse the import on a copy of v1's data,
> the Google consent scope, ship the image, then cut over (stop v1, export, import, start v2).
> Rollback is restarting v1, whose database v2 never writes. B8's steps 2–8 still apply afterwards.

- **Packaging:** a Dockerfile and a container that serves the API, the stream and `web/dist`, with
  SQLite in a mounted data directory.
- **Deployment:** on the home server **beside v1**, on its own hostname. The host details and
  steps live in the private ops workspace, not here. Andy approves each step.
- **Provider setup (Andy's go-ahead on each):**
  - v2's callback added as a **second redirect URI on the same Google client**;
  - its own Pub/Sub subscription on Gmail's topic;
  - Calendar watches pointing at v2;
  - Todoist polled.
- **v1's token export:** a one-time script run **in v1's repository with v1's own decryption**. It
  writes accounts, OAuth tokens, iCloud app passwords, AI keys and models, the Places key and Home,
  rules and corrections, trusted senders (as domains) and pins to a file. v2 imports that file into
  its own format. Refresh tokens belong to the client ID, so they work in v2 at once.
- **Done when:** v2 runs beside v1 on real accounts, both apps show the same read state, and v2's
  backfill completes.

### B8. Cutover (Andy's go-ahead on each step)

1. **Parity checklist:**
   - two weeks of daily use on v2 with v1 untouched;
   - every v1 flow Andy uses works in v2;
   - the health states have been seen live;
   - ntfy reminders have arrived.
2. **Archive v1:** tag v1's last commit `v1-final` and push the tag, plus a `v1` branch.
3. **Switch deployment before any push.** Pushing `setpoint`'s `master` is a production release
   (v1's CI and the host's automatic deploy). Point the host's deployment at v2's image and pipeline,
   or turn v1's automatic deploy off, before v2's history reaches `master`.
4. **Replace the history:** force-push v2's history to `setpoint`'s `master`. This is a **fresh
   history** (Andy, 2026-10-07); v1 lives on as the tag and branch.
5. **Take over the hostname.** Point Setpoint's hostname at v2. Passkeys need the same hostname, so
   copy the password and passkey rows. Move the Todoist webhook, and point Calendar watches at the
   production URL.
6. **Stop v1** and remove its Pub/Sub subscription.
7. **Rollback** at any point before step 6 is pointing the hostname back at v1. After step 6, it's
   restarting v1 from `v1-final`; v1's database is kept untouched.
8. Rename this folder's role: `setpoint-v2/` becomes the `setpoint` checkout, and v1's local checkout
   is archived.

### F1. Shell, Inbox and reader

- **Tokens, fonts and icons;** the shell (sidebar 248, header 56).
- **Sidebar:** Inbox with the attention pill and counts, accounts with filters, Calendar, the Today
  block, and Settings.
- **The Inbox:**
  - group headers and rows;
  - Attention rows with protected and summary lines;
  - collapsed groups with their organisation preview.
- **The reading pane:** 680 px, collapsing when nothing is open.
- **Read state and keyboard:** the read-state rules, and `J` `K` Enter `H` `E` `P` `O` ⇧I.
- **Live updates and the tab title.**
- **Built against** the seed through `web/src/api/` and `shared/`'s types.
- **Done when:** boards 01 and 04 match their baselines with DESIGN.md's count overrides applied,
  and the read-state rules pass in Playwright.

### F2. Mail details

- **Reader:** the reader's HTML frame (sandboxed), the images bar and per-domain trust, and
  attachments with previews.
- **Security and codes:** security rows and the facts card, and code rows with Copy and expiry.
- **Inbox extras:**
  - the pinned shelf;
  - Done and Trash with Undo;
  - Mark all as read;
  - All with clock times and Noise;
  - the pattern prompt.
- **Done when:** boards 02, 03, 05, 09 and 10 match.

### F3. Search, Alfred and proposals

- **Search:** the search field with chips and reasons, results replacing the list, and no-results.
- **Alfred:** the Answer card with sources and follow-ups, and Ask about this email.
- **Proposals:** the card in the reading pane with "from the email" marks, its conflict line, and
  More options.
- **Done when:** boards 06, 07 and 08 match.

### F4. Calendar month

- **The grid:** the month grid with infinite scroll; tinted chips, the selected item solid, and past
  items dimmed; tasks with their glyphs; weather.
- **Overflow:** "+3" and its popover.
- **Sidebar on Calendar:** the mini-month and calendar toggles.
- **The right pane:** the day's agenda with the now-line and Time to Leave.
- **Done when:** boards 11 and 11b match.

### F5. The floating detail

- **The card:** 280 px.
- **Placement:** the fewest-covered side, inside the grid, shared with every anchored overlay.
- **The glide:** values from `design-export/motion/glide.json`, with the overshoot clamped at
  edges, retargeting, open, close and the hand-off to Edit.
- **Drag:** dragging with a glide from the dropped position.
- **Placement and duration are pure functions tested as tables.** The motion is reviewed by eye,
  with Andy, before the slice closes; it's the signature interaction.
- **Harvest candidate:** v1's `calendarFloatingDetailPlacement`.
- **Done when:** boards 12a, 12b and 12d match at rest, and Andy has seen the glide live.

### F6. Editor and direct manipulation

- **The editor in the right pane:**
  - the natural-language title with parsed tokens;
  - Places, recurrence and reminders (Settings' default);
  - the conflict preview and batch drafts;
  - tasks in the same editor.
- **Recurring scope** when editing and on drop, defaulting to This event.
- **Direct manipulation:** drag with lift, ghost and tooltip; clone, copy and paste; colour; delete;
  multi-select.
- **Pending and failed states** in place.
- **Harvest candidates:** v1's title parsing (Chrono), `calendarQuickActionModel`, the
  recurrence-scope models and the deadline reschedule model.
- **Done when:** boards 13, 14, 15, 15b and 19b match.

### F7. ⌘K, Settings, states and Light

- **⌘K** with its sections.
- **Settings:**
  - the modal and its nav;
  - Accounts with health and precision;
  - Calendar, Todoist, Notifications, Mail, AI, Appearance and Security.
- **All states:** reconnect, stale, failing, offline, Unsorted and backfill.
- **Light, System and Night,** with the theme fade; and the wide-screen zoom.
- **Done when:** boards 17, 18a, 18b, 19a, 20, 22a and 22b match.

### F8. Phone

- **Layout:** the same pages and routes laid out below 640 px (board 21).
- **Contents:** the Inbox, the full-width reader with Back, and the read-only agenda.
- **Deep links:** ntfy links open the exact email or item.
- **Done when:** board 21 matches, and the deep links open in Playwright at the iPhone size.

### F9. Week view

> **Changed 2026-10-10 (Andy, darma SV-18 D64):** built now, ahead of cutover, with resizing.

- **The view:** board 16's hour grid and its all-day row (Sunday-first), with create, move and
  resize by drag and the floating detail, as DESIGN.md › Week view has it.
- **Done when:** the week's layout rules (lanes, midnight splits, snapping, resize limits, the
  opening scroll) pass as tables, and the browser checks drive switching, paging, create, move and
  resize at the design target.

### News (after 2.0)

> **Added 2026-10-10 (Andy, darma SV-43, D85–D92):** five slices for
> [BRIEF.md › News](BRIEF.md#news-after-20) and [DESIGN.md › News](DESIGN.md#news-after-20),
> started once B8 has cut over.

### N1. News contract and store

- **Contract** (`shared/`):
  - sections (Local, Tech, AI, General) and story states (new, updated, seen)
  - the source kinds: feed, official API, page read, discovery
  - the API types for the page, a story, an article, Missed and Settings › News
  - a typed `news` live event
- **Store:** sources, articles, stories with their articles, facts timeline, sections, rank and
  seen state, and copied images. A story expires 48 h after its last new fact. The archive keeps
  the summary, sources and thumbnail for 90 days, and drops the full text.
- **Sources** register with the sync engine like the providers, with heartbeats, health and durable
  jobs.
  - The local list and the area live in the data directory, seeded from a file that isn't
    committed (D91).
  - The repository's default list holds only the non-local sources.
- **Seed:** the brief's News sample in `npm run seed`, so the page can be built before ingest
  exists.
- **Done when:**
  - Persistence tests run against an ephemeral database: expiry, the archive, and seen state per
    story.
  - The seed loads the brief's sample.

### N2. Ingest

- **Adapters**, each faked at the HTTP boundary in tests:
  - RSS and Atom feeds, with conditional GET
  - NWS alerts for the home location's zone, found from the home point
  - USGS, Cal Fire and AirNow, filtered by distance
  - Hacker News through Algolia, with a points threshold
  - **page reads** (Anthropic's news page and the Claude release notes, Mistral), which count a
    read that finds nothing as **failing**
  - Google News search, used only to find stories
- **Polling:** every 15 minutes, hazards every 5, each request with an honest, named User-Agent.
- **Article text:** extracted from the article page. A page that blocks reading (KTLA, OpenAI) is
  marked summary only. A metered source is ingested only to count toward and confirm stories (D89).
- **Images:** the best image per article is copied, resized and served by Setpoint, and expires
  with its story.
- **Harvest candidates:** v1's `server/news/news-poller.ts` and `news-model.ts` (conditional GET,
  URL canonicalising, excerpts, retry-after), through the harvest gate.
- **Done when:**
  - Each adapter parses fixtures that are invented in each feed's real shape. No outlet's real
    articles are committed.
  - The health tests cover a dead feed, a page read that finds nothing, and a 429 with retry-after.

### N3. Sorting, grouping and ranking

- **Each article (Haiku 5.5):** rules map the source to a likely section first. Then the model
  picks the section, applies the noise filter (BRIEF › What it covers, D88) and writes the key
  facts.
- **Grouping:** cheap candidate matching finds the likely story, then Haiku confirms whether it's
  the same event and whether it brings new facts. Identical wire text counts as one outlet.
- **Stories (Sonnet 5.5):** a neutral headline, the one-line summary and the summary, rewritten
  only when new facts arrive. The facts timeline drives "New since you looked".
- **Ranking:** hourly, on a cached prompt, using outlets, the model's importance judgement,
  closeness for Local, and recency and growth (D86). A metered-only story never shows.
- **Cost:**
  - The monthly cap switches summaries to Haiku for the rest of the month.
  - News gets its own rows in the AI usage ledger.
  - When the AI is down, articles wait as **Unsorted** and are sorted once it's back.
- **Missed, Upcoming and search:**
  - Missed holds the stories that expired unseen, up to 5 per section per day.
  - Upcoming detects keynote invites, confirmed by a second outlet or the company. Add to calendar
    opens a proposal.
  - Search covers the 90-day archive.
- **Done when:**
  - Table tests cover the policy: noise and politics ("events, not arguments", the subject wins),
    wire deduplication, new facts versus repeats, ranking order, the cap fallback, Missed's limits,
    and keynote confirmation.
  - A recorded set of invented articles groups and ranks as expected, with the models faked.

### N4. The News page

- **The page:** boards 25–28 as DESIGN.md › News has them.
  - the shell item and `3`; All's blocks; the lead and story rows with their dots and thumbnails
  - the Missed strip and Missed, Upcoming, and the held order with the pill and `N`
  - the story pane, the article and summary-only views, and the keys
- **Live updates:** `news` events update rows in place without reordering.
- **Seen:** a row fully on screen for about a second, or opened.
- **Icons:** the new ones join `design-export/glyphs/icons.json` (design-export/news/README.md
  lists them).
- **Done when:**
  - The seen and held-order rules pass as tables.
  - The browser checks drive opening, sources, Back, the pill, Catch up and the keys against the
    seed, with approved screenshots per region (D69, D76).
  - `npm run audit:boards` takes in `design-export/news/boards/`.

### N5. News states and Settings

- **States:** boards 29a and 29b (Unsorted with Show headlines, a stale section, nothing new, the
  first run) and offline.
- **Settings:** Settings › News (sources by section with health, read-only) and Settings › AI's News
  group (models, cap, this month, usage), boards 30a and 30b.
- **Light:** board 31.
- **Done when:**
  - The browser checks cover each state, both Settings pages and Light.
  - The board audit is clean or has its differences listed in DESIGN.md.

### Jobs (after News)

> **Added 2026-10-29 (Andy, darma SV-118, D303–D327):** eight slices for
> [BRIEF.md › Jobs](BRIEF.md#jobs-after-20) and [DESIGN.md › Jobs](DESIGN.md#jobs-after-news),
> boards 32–40 in [design-export/jobs/](design-export/jobs/README.md). Desktop web only (decision
> 49). Built one slice at a time by a subagent each, with Andy's sign-off between slices. Tracked
> as SV-119 to SV-126 (J1 to J8), each blocked by the one before.

**The module boundary** (BRIEF › Decided elsewhere › the Jobs module) holds in every slice:
- **Three folders:** `server/src/jobs/` (tables, migrations, workers, lookups, prompts, routes,
  tests), `web/src/app/jobs/` (page, pane, slots, styles, its API calls through `web/src/api/client.ts`)
  and `shared/src/jobs/` (its schemas, enums and API types). The brief names two; the contract needs
  the third, since `web/` can't import server code.
- **Tables are `jobs_`** (applications, events, postings and what the slices add), with their own
  Drizzle schema and migrations folder in `server/src/jobs/`, run from Jobs's wiring point with their
  own migrations table. They point at mail by message id only; nothing in mail's tables points back.
- **Mail never imports Jobs.** The server tells Jobs when an email in a read account is stored or
  triaged, and Jobs reads it through one small read-only function in its own folder.
- **The wiring points**, a line or two each and listed in `server/src/jobs/README.md`: the routes and
  worker in `server.ts`; the export from `@setpoint/shared`; the `jobs` live event type; the page,
  the sidebar entry and `4`; Jobs's row in Settings and in the AI ledger; and a slot on the reader
  and on the row that mail renders without knowing what fills it.
- **A lint rule** refuses any import of the Jobs folders from outside them except the wiring points,
  and a test proves it refuses one.
- **Removal** is deleting the three folders and the wiring lines, and one migration that drops the
  `jobs_` tables (`server/src/jobs/drop.sql`, applied by a test to an ephemeral database holding
  Jobs and mail: the `jobs_` tables go, mail is untouched).
- **Faked at the HTTP boundary:** Anthropic (Haiku, Sonnet and its web search), Greenhouse, Lever,
  Ashby and any posting page. No test, seed or dev run reaches a real provider, job platform or
  model. Fixtures are invented in each API's real shape, on example domains.

### J1. Jobs contract, module and store

- **Contract** (`shared/src/jobs/`): statuses (Applied, In process, Offer, Rejected, Withdrawn),
  event kinds (applied, assessment, interview, offer, rejection, and the quiet ones), how a JD was
  found (the email's link, the platform, search), the Needs you kinds, the API types for the page,
  an application, search and Settings › Jobs, and a typed `jobs` live event.
- **Store** (`jobs_` tables): applications (company, role, requisition ID, normalised title,
  platform, account, applied date, status and who set it, the latest step, re-applied link, "first
  seen in this email"), events (each keeping its own copy of date, kind, sender, subject and line,
  with the message id while the email exists, decision 63), postings (full text, source, link, found
  at, how, setting, location, salary, must-haves, nice-to-haves, summary), JD candidates, Needs you
  items, emails read (read once, never charged twice), and blocked emails (Not an application).
  Which fields Andy set by hand is stored, so later slices can keep them (decision 58).
- **Settings:** Jobs on or off (off by default), and the accounts it reads.
- **API:** the page (counts by status, per week over 12 weeks, Needs you, the rows), an
  application's detail, all read-only for now; the `jobs` live event.
- **The module boundary** above: the folders, the migrations, the wiring points, the lint rule, the
  drop migration and its test.
- **Seed:** BRIEF.md › Sample data › Jobs (round 4) in `npm run seed` and `npm run try`: the 17 rows
  and 45 older ones that make the totals (62; Applied 31 with 18 Ghosted, In process 3, Offer 1,
  Rejected 25, Withdrawn 2; 3, 5, 4, 6, 2, 4, 7, 5, 3, 6, 8 and 3 a week), Needs you's three items
  and From history's six, Northwind's detail, and the Indeed match email. The Inbox's counts and the
  nine page screenshots don't change.
- **Done when:**
  - Persistence tests run against an ephemeral database: an application with its events and
    posting round-trips; an event keeps its copy after its email is gone; the counts and per-week
    numbers come out as the seed's.
  - The lint test refuses an import of Jobs from mail, and the drop migration's test passes.
  - The `jobs` event's addition to `LIVE_EVENT_TYPES` is recorded in `shared/contract/` only once
    setpoint-ios is known to ignore an event type it doesn't know (ask Andy if it doesn't).
  - The seed loads the sample, and the API answers with its numbers.

### J2. Reading mail and matching

- **The hook:** the wiring point tells Jobs when an email in a read account is stored or triaged.
  In Jobs every email is a candidate; in any other listed account, only triage's Career (decision
  56). Jobs reuses triage's organisation, platform, type and summary.
- **Each email (Haiku 5.5):** the role title, the requisition ID, the event and its line ("Interview
  Tue Oct 13, 2:00 PM"), through a durable job like triage's, read once (decision 61). Jobs's row in
  the AI ledger counts it as "emails".
- **The rules, pure and tested as tables** (decisions 50, 51, 55, 68):
  - a confirmation makes an application unless it matches one; an update that confidently matches
    becomes an event and moves the status; one that might match waits in Needs you as an update to
    assign; a rejection matching nothing is ignored; an interview, assessment or offer matching
    nothing waits as Track this; account, code, form and job-board mail never makes one; a
    recruiter's cold email is out
  - an application is a company and a role, by requisition ID, else the normalised title (case,
    brackets, "remote" and "hybrid" ignored); companies match loosely ("Fabrikam Labs", "Fabrikam")
  - a confident match; a second confirmation is a duplicate while open, a re-application once
    closed; the same title under two requisition IDs is two applications
  - Indeed's "Indeed Application: <title>" pairs with its "<title> @ <company>" match email
  - statuses and the latest step; Ghosted after 30 days at Applied with no email; a status set by
    hand gives way only to an email that sets one, never to a quiet one
  - an email blocked by Not an application never makes one again
- **The AI down:** emails wait and are counted ("5 emails not read yet"), and are read once it's
  back. Nothing is lost.
- **Passive** (decision 59): no notification, nothing added to mail's, nothing in the calendar.
- **Done when:**
  - The rules pass as tables, with prod's shapes invented over: Indeed pairs, a re-application after
    a rejection, a confirmation twice, the same title under two IDs, a rejection with no
    confirmation, a Business email that isn't Career.
  - A recorded set of invented emails, with Haiku faked at the HTTP boundary, makes the expected
    applications, events and Needs you items, and a second pass reads nothing again.
  - The AI-down test holds emails and reads them once it's back.

### J3. The JD lookup

- **When:** within minutes of a confirmation (and of Track this, J6), and by hand from Look it up on
  any application (decision 66). Jobs never retries a "not found" on its own.
- **Where, in order** (decision 54): the email's own link (Indeed's view-job link); Greenhouse,
  Lever and Ashby's public job APIs; then Sonnet 5.5 with Claude web search, only when those miss.
  Every request carries an honest, named User-Agent.
- **The check:** the model weighs each candidate against the company, normalised title, location
  and date. Confident is saved silently; unsure saves nothing and offers up to three candidates as a
  JD to confirm in Needs you; not found says "No JD found". A lookup that *failed* (network, 429,
  timeout) is retried with backoff and never shown as not found.
- **The saved JD** (decision 53): the full text cleaned to readable markdown, never overwritten;
  its link, when and how it was found; and, by Haiku 5.5, location and setting, salary if stated,
  must-haves, nice-to-haves and the three-line what-they-want summary.
- **Cost:** no cap (decision 61). The ledger splits Jobs into emails, finding JDs and reading JDs.
- **Done when:**
  - Each platform's fixture (invented, in Greenhouse's, Lever's and Ashby's real shapes) and a
    posting page parse, faked at the HTTP boundary.
  - Tables cover confident, unsure (three candidates at most), not found and failed, and that a
    failed lookup retries while a not-found one doesn't.
  - A saved JD is never overwritten by a second lookup, and markdown cleaning passes as a table.

### J4. The history pass

- **Once, when Jobs is turned on** (decision 57), oldest first (decision 72), over all the mail
  Setpoint holds for the read accounts, through J2's reader: each email read once and never charged
  for again, as `triage-history` does. It survives a restart and goes on where it was.
- **JDs** are looked up only for applications still open; Ghosted applies to history.
- **From history:** what the pass is unsure of goes there, apart from today's Needs you, and
  Dismiss all clears it, the same as ignoring each item (decision 70).
- **Progress:** "Reading history · 140 of 330", in the API and the `jobs` event, for J5 and J8.
- **Done when:**
  - A recorded invented history (a few dozen emails over months) makes the expected applications,
    with updates finding confirmations read before them, closed ones without JDs, old silent ones
    Ghosted and the unsure in From history.
  - A pass stopped halfway goes on from there after a restart; a second turn-on reads nothing.

### J5. The Jobs page

- **The page:** boards 32, 32b, 33 and 36 as DESIGN.md › Jobs has them.
  - the sidebar item with its Needs you count, `4`, the compact rail's slot and the tab title
  - the header: the status segmented control with its counts (a filter), the 12-week chart, search
  - the table: sortable, newest first; status with Ghosted and the latest step; Platform dropping
    and JD becoming a glyph while the detail is open
  - the detail: the JD's summary, setting and salary, both lists, its link and how it was found,
    the full text unfolding in place; the timeline, each event opening its email; Applied before
    and re-applied; "No JD found" with Look it up; "First seen in this email"
  - Needs you drawn read-only here (its actions come in J6)
  - narrow windows (640–1099): the detail over the table, Back and Esc
  - **search** (`/`): company and title first, then JD text with its matched line; loose on
    company names; out of mail's search and ⌘K (decision 62)
  - the keys: `J`/`K`, Enter, `/`, `O`, Esc
- **Live updates:** `jobs` events update rows in place; an arrival settles from `sub2` over 900 ms.
- **Icons:** the new ones join `design-export/glyphs/icons.json` (design-export/jobs/README.md lists
  them).
- **Done when:**
  - Search's ranking and loose company matching pass as tables.
  - Component tests cover the chart, the status control and the JD's unfolding.
  - The browser checks drive opening, J/K, the full text, search (`humongous`, `kubernetes`, `wide
    world`), the filter and the narrow window against the seed; the layout sweep visits Jobs at
    1677, 1100 and 820 (not the phone).

### J6. Needs you and corrections

- **Needs you** (boards 34a–34c): a JD to confirm (pick, or None of these); an update to assign
  (Assign to…, that company's applications first, or Not about a job); Track this, which makes the
  application from its email, Applied that day and "First seen in this email" (decision 69), looks
  up its JD and puts it in In process; From history with Dismiss all. An item resolving folds away
  with a toast and Undo.
- **Corrections** (boards 35a, 35b, decision 58): edit the company or title in place; Merge with…;
  an event's Move to… and Not about this (back to Needs you); Not an application (hidden, its emails
  blocked) and Delete (forgotten, so a later email can make it again) as the menu says (decision
  67); Not this posting (the JD goes, its other candidates are offered); set a status by hand.
  Each with Undo.
- **Every correction sticks:** a new email, a re-run or a lookup never overwrites a field Andy set,
  undoes a merge or a move.
- **Done when:**
  - Persistence tests: each correction, then a new email, a history re-run and a lookup, and the
    correction stands; Undo restores what was there.
  - The browser checks drive each Needs you kind and each correction against the seed.

### J7. Jobs in mail

- **The slots** (decision 52): the reader's head and the row each render a slot that Jobs fills;
  mail's code imports nothing from Jobs.
  - The **JD chip** on any email that belongs to an application, in the reader, opening its JD in a
    popover with Open in Jobs (boards 37a, 37b).
  - **Applied before** on job-match emails whose company matches, on the row and in the reader
    ("Applied Sep 16 · Rejected Oct 5"), including a quieted Noise row, opening Jobs searched for
    the company (board 37c).
- One request answers a page of rows, not one per row. The Inbox's counts never change.
- **Done when:**
  - Applied before's company match passes as a table.
  - The browser checks open the Northwind email with its chip and popover, Open in Jobs arriving
    with the application open, and the Contoso Pharmaceuticals match email's badge on its row and
    in the reader, against the seed. Mail's existing spec files still pass.

### J8. Jobs states, Settings and Light

- **States** (boards 38a–38c): the history pass running with the table filling; "5 emails not read
  yet"; No JD found; a Ghosted row; a status set by hand with its tooltip; Jobs off, its Turn on
  opening Settings › Jobs.
- **Settings:** Settings › Jobs (on or off, the accounts it reads, the history pass's progress or
  when it finished; turning it on starts the pass and brings Jobs into the sidebar) and Settings ›
  AI's Jobs group (three models, this month's spend with no meter, Usage this month's Jobs row in
  three parts), boards 39a and 39b.
- **Light:** board 40.
- **Page screenshots:** Jobs (Night) joins `web/tests/browser/pages.ts` and
  `npm run audit:boards` takes in `design-export/jobs/boards/`; its golden goes to Andy before it's
  committed.
- **A removal rehearsal**, once, in a scratch worktree: delete the folders and wiring lines, apply
  the drop migration, and `npm test` passes. Its result goes in the issue.
- **Done when:**
  - The browser checks cover each state, both Settings pages and Light.
  - The board audit is clean or has its differences listed in DESIGN.md.

## Order and parallelism

```
B0 ──► B1 ──┬──► B2 ──► B3 ──► B4 ──┐
            ├──► B5 ────────────────┼──► B6 ──► B7 ──► B8
            └──► F1 ──► F2 ──► F3   │
                 F1 ──► F4 ──► F5 ──► F6
                 F7 and F8 after F3 and F6 · F9 after F6

After B8 (News): N1 ──┬──► N2 ──► N3 ──┐
                      └──► N4 ─────────┴──► N5

After News (Jobs): J1 ──► J2 ──► J3 ──► J4 ──► J5 ──► J6 ──► J7 ──► J8
```

- **News waits for the cutover** and doesn't hold up any 2.0 slice. N4 builds against N1's seed while
  N2 and N3 build ingest and sorting. N5 needs both lanes.
- **Jobs runs one slice at a time** (Andy, 2026-10-29): one writer, the machine's one browser lock,
  and Andy's sign-off between slices. Each slice lands working: the page (J5) could build on J1's
  seed alone, but it waits so that its checks also see real reading, lookups and the history pass.

- **The contract comes first.** B1 writes `shared/`'s API types and schemas for B2–B5 before they
  start, so the backend and frontend run in parallel against it. The frontend uses the seed through
  the same API, so it doesn't wait on providers.
- **Parallel lanes once B1 lands:** mail (B2, then B3, then B4), calendar (B5), and the frontend
  (F1, then F2 and F4 in parallel).
- **F5 runs alone:** it gets its own review loop with Andy.
- **B6 needs the ops workspace** and Andy's agreement on mantel's DESIGN.md; it can run any
  time after B2.

## Not in these slices

- The demo build: later, not for 2.0 (Andy, 2026-10-07). The API boundary is kept clean so a demo
  can plug in with the seed.
- Reply and compose, ntfy action buttons, full phone parity, the real mark.
- Matching a security email to a reconnect Andy just did.
- News's tuning round (muting topics, "less like this", choosing sources) and News on the phone.
- Jobs on the phone and in the iPhone app; a browser extension or a read-only check endpoint for
  Applied before; matching a JD against a résumé (BRIEF › Jobs).
