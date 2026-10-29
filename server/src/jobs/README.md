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
  drop migration ([`drop.sql`](drop.sql)) and its tests ([`tests/`](tests)). Later slices add the
  reading worker (J2), the lookups (J3) and the history pass (J4).
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

J5 to J8 add: the page, the sidebar entry and `4`; Jobs's row in Settings and in the AI ledger; the
slot on the reader and on the row that mail renders without knowing what fills it; and the hook
that tells Jobs when an email in a read account is stored or triaged. Each adds its line here.

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
2. Delete the wiring lines above (the generic `routes` hook in `app.ts` and the Indeed email may stay),
   and `'jobs'` from `LIVE_EVENT_TYPES`.
3. On each database Jobs ran on, apply `drop.sql` (keep a copy before deleting the folder): it drops
   every `jobs_` table and `jobs_migrations`, and leaves mail untouched
   ([`tests/drop.test.ts`](tests/drop.test.ts) proves it on a database holding both).
4. `npm run contract:record` once setpoint-ios is pinned past the change, then `npm test`.
