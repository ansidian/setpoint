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
  its prompts ([`jdPrompt.ts`](jdPrompt.ts)). J4 adds the history pass.
- `shared/src/jobs/`: its enums, API schemas and types, and the `jobs` live event (D328: the contract
  needs a third folder, since `web/` can't import server code).
- `web/src/app/jobs/`: the page, pane, slots and styles (J5 onwards; not there yet).

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
| `server/src/live/feed.ts`, `merge` | two `jobs` events in one transaction merge into one |
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
| `web/src/logic/live.ts`, `pathsForEvent`'s `jobs` case | a `jobs` event refreshes what's mounted under `/jobs` |
| `server/tests/contract.test.ts`, the `jobs` `noteLive` | the iPhone app's contract records the event (it ignores the type) |
| `shared/contract/` | the recorded `jobs` event and `LIVE_EVENT_TYPES` (re-recorded by `npm run contract:record`) |
| `server/vitest.config.ts`, `include` | runs `src/jobs/tests/` |
| `eslint.config.js`, `JOBS_FOLDERS`, `JOBS_WIRING`, `moduleBoundary` and its block | the lint rule |

`web/src/api/live.ts` listens for every type in `LIVE_EVENT_TYPES`, so it needs no line of its own.

J5 to J8 add: the page, the sidebar entry and `4`; Jobs's row in Settings › AI; and the slot on the
reader and on the row that mail renders without knowing what fills it. Each adds its line here.

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
- **J4's feed:** `readWindowEmails(store, askHaiku(store, jobsEmailClient(…)), {accounts, before:
  enabledAt}, {fromHistory: true})` reads the older mail oldest first through the same rules, or
  `readEmail` one id at a time. Each is read once whichever reads it first.

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
