# Jobs (after News)

Jobs tracks the user's job applications from the mail they send, keeping each JD as it was
([BRIEF.md › Jobs](../../../BRIEF.md#jobs-after-20), [DESIGN.md › Jobs](../../../DESIGN.md#jobs-after-news),
[BUILD-PLAN.md › Jobs](../../../BUILD-PLAN.md#jobs-after-news), darma SV-118 to SV-126). It's a module
that can be removed whole (D303): everything lives in three folders, its tables are `jobs_` with
their own migrations, and the rest of the app reaches it only through the wiring points below. Mail
never imports Jobs; Jobs reads mail through [`mail.ts`](mail.ts), its one read-only window.

## The folders

- `server/src/jobs/` (this one): its tables ([`schema.ts`](schema.ts)), migrations ([`drizzle/`](drizzle),
  with their own table, `jobs_migrations`, run by [`db.ts`](db.ts)), pure rules ([`rules.ts`](rules.ts)),
  reads ([`queries.ts`](queries.ts)), routes ([`api.ts`](api.ts)), the seed ([`seed.ts`](seed.ts)), the
  drop migration ([`drop.sql`](drop.sql)) and its tests ([`tests/`](tests)). J2 adds reading mail:
  the worker and one email's read ([`reader.ts`](reader.ts)), its state and health
  ([`readerState.ts`](readerState.ts)), Haiku's prompt ([`prompt.ts`](prompt.ts)) and models and
  ledger ([`models.ts`](models.ts)). J3 adds the JD lookup: its run and what it keeps
  ([`lookup.ts`](lookup.ts)), its pure rules ([`lookupRules.ts`](lookupRules.ts)), the platforms'
  APIs and posting pages ([`web.ts`](web.ts)), markdown cleaning ([`markdown.ts`](markdown.ts)) and
  its prompts ([`jdPrompt.ts`](jdPrompt.ts)). J4 adds the history pass: starting, resuming and
  ending it ([`history.ts`](history.ts)), its state and progress ([`historyState.ts`](historyState.ts)),
  Settings › Jobs's turning on and off ([`settings.ts`](settings.ts)) and From history's Dismiss all
  ([`needsYou.ts`](needsYou.ts)); the reader reads it. J6 adds Needs you's answers (the rest of
  [`needsYou.ts`](needsYou.ts)), the corrections ([`corrections.ts`](corrections.ts)), their Undo
  ([`undo.ts`](undo.ts)) and the guards that make every correction stick ([`stick.ts`](stick.ts)).
- `shared/src/jobs/`: its enums, API schemas and types, and the `jobs` live event (D328: the contract
  needs a third folder, since `web/` can't import server code).
- `web/src/app/jobs/`: the page ([`JobsPage.tsx`](../../../web/src/app/jobs/JobsPage.tsx)), its table, Needs you
  (its answers J6's), Per week, the status filter, the detail and its full posting, the shell's item
  and `4` ([`Nav.tsx`](../../../web/src/app/jobs/Nav.tsx)), its calls through `web/src/api/client.ts`
  ([`api.ts`](../../../web/src/app/jobs/api.ts)), what it writes ([`words.ts`](../../../web/src/app/jobs/words.ts))
  and its styles ([`jobs.css`](../../../web/src/app/jobs/jobs.css)) (J5); J6's menus ([`Menu.tsx`](../../../web/src/app/jobs/Menu.tsx),
  what they hold in [`menus.ts`](../../../web/src/app/jobs/menus.ts)), the candidate picker, the field in place, and the
  toast with Undo ([`act.ts`](../../../web/src/app/jobs/act.ts)). The shell imports only
  [`index.ts`](../../../web/src/app/jobs/index.ts).

Its tables point at mail by message id and account id only, as plain integers with no foreign key,
and nothing in mail's tables points back.

## The wiring points

Every line outside the three folders that knows Jobs exists. The lint rule (below) lets only the
files marked *imports* import the folders.

| File | What the line does |
| --- | --- |
| `shared/src/index.ts`, the last line (*imports*) | `export * from './jobs/index.ts'`: the contract reaches `@setpoint/shared` |
| `shared/src/api/live.ts`, the `JobsLiveEvent` import and the union's last member (*imports*) | the `jobs` live event is one of `LiveEvent`'s |
| `shared/src/enums.ts`, `LIVE_EVENT_TYPES` | `'jobs'` is a live event type |
| `server/src/live/feed.ts`, `merge` | two `jobs` events in one transaction merge into one, the later history progress kept (J4) |
| `server/src/server.ts`, the `./jobs/index.ts` import (*imports*) | brings in `migrateJobs` and `jobsApi` |
| `server/src/server.ts`, after `openDatabase` | `migrateJobs(sqlite)`: Jobs's tables, after the app's migrations |
| `server/src/server.ts`, `createApp`'s `routes` | `routes: [jobsApi(store)]`: Jobs's routes under /api, behind the session |
| `server/src/server.ts`, `jobsReader` and TriageWorker's `onSorted` (J2) | Jobs's reading worker, nudged each time triage sorts an email |
| `server/src/server.ts`, the engine's `workers` (J2) | `jobsReader` runs its `jobs_read` jobs on the sync engine: the reading, and each JD lookup (J3) |
| `server/src/server.ts`, `jobsReader`'s `web` (J3) | `jobsWeb()`, the platforms' real APIs and posting hosts, given only in production |
| `server/src/triage/worker.ts`, the `onSorted` option (J2) | the generic hook the line above uses: told after each email is sorted; it names no module, so it can stay |
| `server/src/db/schema.ts`, `JOB_KINDS`, and `server/drizzle/0021_jobs_reading.sql` (J2) | `'jobs_read'` is a kind of engine job (the migration rebuilds `jobs` for its CHECK) |
| `shared/src/enums.ts`, `AI_PURPOSES`, and the same migration (J2) | Jobs's three parts of the AI usage ledger: `jobs_emails` (J2), `jobs_finding_jds` and `jobs_reading_jds` (J3) |
| `server/src/providers/ai/index.ts`, `ModelRequest.webSearch` (J3) | the generic hook Jobs's search uses: Claude's web search beside a call's tool, a paused turn resumed, searches counted; it names no module, so it can stay |
| `server/src/domain/aiCost.ts`, `webSearches` (J3) | web searches priced in the ledger at $10 per 1,000; generic, so it can stay |
| `server/src/api/app.ts`, `routes` in `AppOptions` and its mount after News's | the generic hook the line above uses; it names no module, so it can stay |
| `server/src/dev/sample.ts`, the `../jobs/index.ts` import (*imports*) | brings in `seedJobs` |
| `server/src/dev/sample.ts`, the end of `seedSampleData` | `seedJobs({sqlite, db})`: Jobs's sample for `npm run seed`, `npm run try`, the browser checks and the tests' seeded worlds |
| `server/src/dev/sample.ts`, the last of `SAMPLE_EMAILS` | the Indeed match email Jobs's sample reads (mail's own data; it can stay) |
| `web/src/logic/live.ts`, `pathsForEvent`'s `jobs` case | a `jobs` event refreshes what's mounted under `/jobs`: the page, the shell's item (`/jobs/nav`), an open application and a search (J5) |
| `web/src/logic/route.ts`, the `jobs` route (J5) | `/jobs` and `/jobs/12` (an application open) in the address bar; it names no module, so it imports nothing |
| `web/src/app/App.tsx`, the `./jobs/index.ts` import (*imports*, J5) | `JobsPage` for the `jobs` route (the phone's goes to the Inbox, decision 49), and `goToJobs` for `4` while Jobs is on |
| `web/src/app/Sidebar.tsx`, the `./jobs/index.ts` import and `<JobsNavItem>` after News (*imports*, J5) | the sidebar's Jobs item with its Needs you count, and in the compact tier the rail's slot with its neutral badge |
| `web/src/app/palette/Palette.tsx`, the `../jobs/index.ts` import and `...jobsCommands()` in Go to (*imports*, J5) | ⌘K's "Jobs 4", while Jobs is on (search stays out of ⌘K, D316) |
| `web/src/app/ShellFrame.tsx`, the starting shell's title (J5) | "Jobs" while Setpoint starts on a Jobs address; it imports nothing |
| `web/tests/components/jobs.test.tsx` (*imports*, J5) | the component tests of Per week, the status filter and the full posting, and J6's menus, candidate picker and title field (removed with the module) |
| `web/tests/browser/jobs.spec.ts`, and Jobs's lines in `sweep.spec.ts`, `news.spec.ts`, `palette.spec.ts`, `compact.spec.ts` and `web/tests/shell.test.ts` (J5) | the browser checks and the sweep's Jobs route; the shell's lists that now name Jobs; they import nothing from the folders |
| `server/tests/contract.test.ts`, the `jobs` `noteLive` | the iPhone app's contract records the event (it ignores the type) |
| `shared/contract/` | the recorded `jobs` event and `LIVE_EVENT_TYPES` (re-recorded by `npm run contract:record`) |
| `server/vitest.config.ts`, `include` | runs `src/jobs/tests/` |
| `eslint.config.js`, `JOBS_FOLDERS`, `JOBS_WIRING`, `moduleBoundary` and its block | the lint rule |

`web/src/api/live.ts` listens for every type in `LIVE_EVENT_TYPES`, so it needs no line of its own.

J6 to J8 add: Jobs's row in Settings › AI; and the slot on the reader and on the row that mail renders
without knowing what fills it. Each adds its line here.

The hook (J2) is triage's, not storing's: Jobs reads an email only once triage has typed it, so being
told when one is stored would tell it nothing it could act on. A missed nudge costs nothing: the
worker looks for what waits every five minutes, and after a restart.

The `onSorted`, `JOB_KINDS` and `AI_PURPOSES` lines don't import Jobs, so they aren't in `JOBS_WIRING`:
the lint rule still refuses an import of Jobs from triage.

## Reading mail (J2)

- **What:** emails triage has sorted in the accounts Jobs lists (every email in Jobs, only Career
  elsewhere), received since Jobs was last turned on (`jobs_settings.enabled_at`), not in
  `jobs_emails_read`. Oldest first, one at a time, and an email triage hasn't sorted yet holds back
  the ones after it for up to a day, so a confirmation is read before its update.
- **How:** [`reader.ts`](reader.ts)'s `JobsReader` runs the one `jobs_read` job on the sync engine,
  queued by a nudge from triage's `onSorted` or by its five-minute rescan. Each email is read once by
  Haiku 5.5 ([`prompt.ts`](prompt.ts)), written to the ledger as `jobs_emails`, and what it read is
  kept in `jobs_emails_read`; [`rules.ts`](rules.ts)'s `planEmail` decides what it makes.
- **The AI down:** the job fails by the one retry policy and the emails wait; `GET /api/jobs` carries
  `reading` (how many wait, and since when it's down), and a `jobs` event naming nothing goes out when
  that changes. A missing key waits for Settings › AI, and the rescan tries again.
- **J3's seam:** a confirmation makes its application with `jd_lookup = 'looking'` and `jd_lookup_at`
  set: its lookup is due. The ledger's `jobs_finding_jds` and `jobs_reading_jds` are J3's.
- **J4's feed:** the history pass reads the older mail oldest first through the same `readEmail` and
  rules, with `fromHistory`. Each is read once whichever reads it first.

## The JD lookup (J3)

- **When:** J2's confirmation leaves its application at `jd_lookup = 'looking'` (D341). After each
  reading run and on the five-minute rescan, `queueDueLookups` queues a lookup for each one still
  open; one closed before its lookup started goes back to `none` (decision 57). Look it up
  (`POST /api/jobs/applications/:id/lookup`, any application, open or closed), J6's Track this and
  J4's history pass call `requestLookup(store, id)`, which marks it `looking` at once, answers its
  waiting JD to confirm and queues the job; a saved JD answers `saved` (409 on the route) and is
  never replaced.
- **How it runs:** each lookup is a `jobs_read` job keyed `jobs_jd:<application>` on Jobs's own
  worker, so no new engine kind and no main migration; one that fails waits out its own backoff by the
  one retry policy. Six failures end the job; the rescan queues it again an hour later
  (`LOOKUP_COOL_OFF_MS`), so it stays `looking` and is never "No JD found". Without a web (any
  non-production run) lookups aren't queued, and one requested by hand finishes doing nothing.
- **Where, in order:** the emails' posting links (a platform's posting, Indeed's view-job link, a
  careers page), then Greenhouse, Lever and Ashby's public APIs by board name, then Sonnet 5.5 with
  web search only when those cleanly missed. Haiku checks what a link or a platform found; Sonnet's
  search judges its own. Confident is saved with Haiku's reading; unsure offers up to three
  candidates as a JD to confirm; nothing is `not_found`.
- **While it runs** the row's `jd` is `{state: 'looking', looked_at: <when it began>}`; its end comes as
  a `jobs` event naming the application (and any Needs you item).

## The history pass (J4)

- **When:** turning Jobs on (`PATCH /api/jobs/settings {enabled: true}`, [`settings.ts`](settings.ts))
  sets `enabled_at` and starts it ([`history.ts`](history.ts) `startHistory`): what the accounts it
  lists hold from before then that Jobs hasn't read, the Jobs account in full and Career elsewhere.
  Its `total` is fixed then; mail arriving meanwhile is the live reader's. Off stops it (and the live
  reader) where it is; on again, or other accounts while on, start a new pass over what's still
  unread from before `enabled_at` (mail that came while Jobs was off among it). One with nothing to
  read leaves the last pass's record, so a second turn-on reads nothing.
- **How it runs:** one `jobs_read` job keyed `jobs_history` on Jobs's worker, reading oldest first
  through `readEmail` with `fromHistory` (reader.ts `readHistoryEmails`), checking before each email
  that Jobs is still on and the pass the same. What it has read is jobs_emails_read itself, so a
  restart goes on from the next email and nothing is read or charged twice. The AI down fails the
  job by the one retry policy and the pass is `waiting`; the rescan (and triage's nudge) queues it
  again while it runs.
- **Unsorted mail** in its window is waited for: triage sorts it again once it's back, and only its
  kind says whether a Career-only account's email is one to read. Backfilled mail is sorted as it
  lands (rules only), so it never waits; the Jobs account's is read whatever kind the rules gave it.
  In a Career-only account backfilled mail is read when it's Career, or typed a confirmation or
  rejection (by triage's extraction, or the rules until it runs), or sent from a hiring platform's
  mail domain (mail.ts `HIRING_PLATFORM_SENDERS`), since the rules make few emails Career and the
  extraction never changes the kind (D355). Live mail there stays Career only (decision 56). An email the provider refuses
  outright (a 400) is passed over, the pass ends without it, and a later pass tries it again.
- **JDs:** the applications it makes start at `jd_lookup = 'none'`, so no lookup runs while a later
  email may still close them. At its end (`finishHistory`) the open ones never looked up become
  `looking` with `jd_lookup_from_history`, and the worker queues them (`queueDueLookups`); closed ones
  stay `none`. An unsure lookup they end in is a JD to confirm in From history; Look it up by hand
  clears the flag, so its candidates are today's.
- **Progress** (`historyState.ts` `historyStatus`): `{state, read, total, started_at, finished_at}` as
  `history` on `GET /api/jobs` and `GET /api/jobs/settings`, and on every `jobs` event the pass sends
  (each email it reads, its start and end, the AI going down). While it runs, `read` counts
  jobs_emails_read rows read since it started for mail from before its cutoff; once done it's kept.
  `state` is `waiting` while it runs and the reader is down.
- **From history:** `POST /api/jobs/from-history/dismiss` resolves every waiting From history item
  as `dismissed`, the same as ignoring each ([`needsYou.ts`](needsYou.ts)), and answers their ids;
  `POST /api/jobs/from-history/undo {needs_you: [ids]}` brings back those still dismissed.

## Search (J5)

- **What:** `GET /api/jobs/search?q=…` ([`search.ts`](search.ts), run over the store by `queries.ts`
  `jobsSearch`): company or role first, then an application whose JD's text alone matched, with the
  line it matched (D316, decision 62). Jobs's own: mail's search and ⌘K never see it.
- **Company or role** ranks best first, then newest: the query's words start the company's name in
  order, the last perhaps unfinished ("wide world", "humon"); they start words of the company; of the
  role; of the two together. Case and punctuation never count, as companies match elsewhere.
- **In a JD:** each query word starts a word of the saved posting's text; the line is quoted from the
  first word's match, up to six words back (stopping at a clause's start) and eleven on (stopping at a
  sentence's end), with an ellipsis at each end. Newest first.
- **The shell's item:** `GET /api/jobs/nav` answers whether Jobs is on and today's Needs you count,
  for the sidebar, the rail, ⌘K's Go to and `4` on every page; it's under `/jobs`, so the `jobs`
  event refreshes it.

## Needs you's answers and the corrections (J6)

- **The routes** (each answers `JobsChangeOut`, `{undo, application}`): a candidate picked
  (`POST /applications/:id/jd/pick`) or None of these (`…/jd/none`); Assign to…, Track this and Not
  about a job (`POST /needs-you/:id/assign|track|not-a-job`); the title or company
  (`PATCH /applications/:id`), Set status and Let emails decide (`POST …/status`, `{status: null}`),
  Merge with… (`…/merge`), Not this posting, Not an application (`POST …/not-this-posting|not-an-application`)
  and Delete (`DELETE /applications/:id`); an event's Move to… and Not about this
  (`POST /events/:id/move|not-about-this`). `POST /undo/:token` is the toast's Undo. Look up the JD
  again is J3's `…/lookup`. All under /api/jobs.
- **Undo** ([`undo.ts`](undo.ts)): before it writes, a correction keeps every row it may touch (its
  applications with their events, JD, candidates, hand-set fields, aliases and turned-down postings,
  the Needs you items, the emails' read records and blocks) in `jobs_undo`, and says what it made.
  Undo puts those rows back with their ids and takes away what it made, so a merge, a delete or a block
  comes back whole. A snapshot is kept a day.
- **Every correction sticks** ([`stick.ts`](stick.ts), the one place the reader, the rules, the
  history pass and the lookup ask): a field set by hand (`jobs_hand_set`) is never written again, but
  for D322's one exception, an email that sets a status (`emailSetsStatus`, used only by the reader's
  event and by an email the user brings to an application); a merge, a move, an assignment and an
  edited title or company leave the application answering to the company and role they brought
  (`jobs_aliases`, rules.ts `Alias`), so a later email finds it; Not an application blocks its emails
  and its company and role (`jobs_blocked_emails`, decision 67), and Delete blocks nothing; a posting
  turned down by None of these or Not this posting (`jobs_rejected_postings`) is never saved or
  offered again, and a lookup writes only while its application is still `looking` (`stillLooking`),
  so Undo or a correction made while it ran wins. Emails are read once, so a history re-run never
  replays one the user moved, assigned or took off.
- **A pick** (lookup.ts `requestPick`) marks the candidate and queues the application's lookup job,
  which reads that one link and saves it with Haiku's reading and no check; the other candidates stay
  for Not this posting. Without a web (a dev run) it stays `looking`, as any lookup does.
- **Track this** makes the application from the email: Applied on its date, First seen, In process
  (Offer for an offer), and requests its lookup.
- **A merge, a move or Not about this** settles the status from the emails again (rules.ts
  `statusFromEvents`) unless the user set it; an email brought in that sets a status later than one
  set by hand takes over, as it would have on arrival.

## Jobs in mail (J7)

- **What:** `GET /api/jobs/mail?messages=1,2,3` ([`queries.ts`](queries.ts) `jobsInMail`) answers what mail's
  slots draw for a page of rows, or the email the reader has open, in one request (up to 500 ids):
  for each email with something, the application it belongs to (its event's, for the reader's JD
  chip), and Applied before. Emails with nothing are left out, and everything is while Jobs is off.
  It only reads, so the Inbox's counts never change (D313).
- **Applied before** (rules.ts `appliedBefore`, D306): only on an email Jobs read as a job board's
  match ("<title> @ <company>", `jobs_emails_read.event = 'match'` with its company). Its company
  matches applications as an email's does: loosely (`sameCompany`) and by the companies corrections
  gave them (stick.ts `knownApplications`' aliases). The badge names the most recent; `query` is the
  search that shows them all on Jobs (the words their companies share, else the newest's company).
- **The seed** keeps the Indeed match email as the reader would have read it (its event, company and
  role), so its badge shows (board 37c).

## The lint rule

`module-boundary/jobs` in [`eslint.config.js`](../../../eslint.config.js) refuses an import of
`server/src/jobs/`, `web/src/app/jobs/` or `shared/src/jobs/` from any file outside them except the
files marked *imports* above (`JOBS_WIRING`). Relative imports are resolved, so a longer way round is
refused too. [`tests/boundary.test.ts`](tests/boundary.test.ts) proves it with the repository's own
config.

## Migrations

From `server/`, after changing [`schema.ts`](schema.ts):

```
npx drizzle-kit generate --config src/jobs/drizzle.config.ts --name <what changed>
```

## Removal

1. Delete `server/src/jobs/`, `web/src/app/jobs/` and `shared/src/jobs/`.
2. Delete the wiring lines above (the generic `routes` hook in `app.ts`, triage's generic `onSorted`
   option and the Indeed email may stay), and `'jobs'` from `LIVE_EVENT_TYPES`. `'jobs_read'` in
   `JOB_KINDS` and the `jobs_*` purposes in `AI_PURPOSES` may stay too, as the AirNow key's name does:
   dropping them rebuilds `jobs` and `ai_usage` for their CHECKs, and the ledger keeps Jobs's past
   rows. A queued `jobs_read` job with no worker is finished by the engine as one with nothing to run.
3. On each database Jobs ran on, apply `drop.sql` (keep a copy before deleting the folder): it drops
   every `jobs_` table and `jobs_migrations`, and leaves mail untouched
   ([`tests/drop.test.ts`](tests/drop.test.ts) proves it on a database holding both).
4. `npm run contract:record` once setpoint-ios is pinned past the change, then `npm test`.
