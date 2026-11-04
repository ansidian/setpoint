# Setpoint on LinkedIn

A Chromium extension that puts a chip on LinkedIn's jobs saying whether Setpoint's Jobs has an
application to one (BRIEF.md › Applied before?, D433; darma SV-172):

- **Applied Sep 16 · Rejected Oct 5**: an application for this role, the newest named, as mail's
  Applied before badge words it, green while it's open and red once it's closed (Rejected,
  Withdrawn, Ghosted). A click opens it in Setpoint.
- **Applied to 2 other roles here**: applications at the company, but for other roles. A click opens
  Jobs searched for the company.
- **Not applied**: nothing at the company, in the job pane only.

In the job pane (and on a job's own page) the chip follows the title, and says why when it can't
answer: **Set up Setpoint**, **Setpoint refused the token**, **Setpoint unreachable**, **Jobs is off
in Setpoint**, or **Couldn't read Setpoint's answer**. On the list's cards it follows the company,
smaller, and only when there's an application, as mail's rows show Applied before. A click on a chip
never selects the card under it. The words are [`src/words.ts`](src/words.ts), and the look is
[`src/chip.ts`](src/chip.ts) (DESIGN.md › Decided while building #301, D434, D435).

It's desktop Chrome only, loaded unpacked, with no Web Store listing (D433).

## Building and loading it

1. `npm run extension:build` from the repository's root bundles [`src/`](src) with esbuild into
   `extension/dist/`, with the manifest and the options page beside it. `dist/` stays out of git.
2. In Chrome, `chrome://extensions`, **Developer mode** on, **Load unpacked**, and pick
   `extension/dist/` (not `extension/`, which has no manifest).
3. After a rebuild, the extension's reload arrow in `chrome://extensions`, then reload LinkedIn's tab:
   a tab open from before keeps the old content script, whose new chips say Setpoint unreachable,
   "reload this page" in their tooltip.

## Options

The extension's **Options** (right-click its toolbar icon, or Details in `chrome://extensions`):

- **Setpoint's address**, such as `https://setpoint.example`. Only the origin is kept.
- **Jobs token**, from `npm run cli -- jobs-token` on Setpoint's server. It prints the token once and
  replaces any earlier one; `jobs-token --revoke` takes it away. It opens only `POST /api/jobs/check`.
- **Save and test** asks Chrome for access to that address, which is how the service worker reaches
  Setpoint without CORS. The manifest offers any https address and localhost's, so another http one
  is refused. It then asks Setpoint about a made-up posting, so a wrong address or token shows there
  rather than on LinkedIn.

Both are kept in `chrome.storage.local`, never synced. Setpoint's address is never in the code.

Against `npm run try` (port 7450, the seed's applications), the address is `http://localhost:7450`,
and the token comes from the repository's root:

```bash
SETPOINT_DATA_DIR="$PWD/data/try" npm run cli -- jobs-token
```

The CLI runs in `server/`, so the data directory goes in whole. The seed's companies are invented, so
a real LinkedIn job's pane says Not applied and its cards stay bare.

## What it sends

The content script reads each posting's company and title from the page and sends them to the
service worker ([`src/background.ts`](src/background.ts)), which asks Setpoint's
`POST /api/jobs/check` (server/src/jobs/api.ts) with the token as a bearer token. A page of 25 cards
and the pane is one request, and page 2 asks only about its new cards; the route takes at most 50
(`JOBS_CHECK_MAX`), so the worker splits a longer list. Setpoint matches each as mail's Applied before
does (server/src/jobs/rules.ts `checkPosting`). The worker checks the answer against `jobsCheckSchema`
from `@setpoint/shared` ([`src/reply.ts`](src/reply.ts)), so an answer this build can't read says so
on the pane rather than drawing wrong chips.

Only jobs' companies and titles leave the page, and only to the Setpoint the options name. The page
never sees the token.

## What it reads on LinkedIn

LinkedIn's class names are generated and change, so it reads only what has stayed put (checked on
2026-11-03). [`src/linkedin.ts`](src/linkedin.ts) has the readers.

- **The job pane:**
  - the job's id in the address: `currentJobId` on a search or a collection, or `/jobs/view/<id>/`;
  - the company's `[aria-label^="Company, "]`, whose `componentkey` ends in `-<id>`, so a pane still
    showing the last job is never read as this one;
  - the page's title, "<title> | <company> | LinkedIn", after LinkedIn's "(3) " count. LinkedIn sets
    it after it draws the pane, so a pane whose title still names the last job waits for it.
  - The chip goes at the end of the title's line: the `p`, `h1` or `h2` in the pane whose text is the
    title. The pane is the company label's nearest ancestor holding the title, and one holding the
    list's cards has left the pane, so the last job's card is never taken for its title.
- **A card:**
  - the innermost element keyed `job-card-component-ref-<id>` (each card is keyed twice);
  - its title from its "Dismiss <title> job" button;
  - its company, the `p` after the title's (which holds the title twice, the screen readers' copy
    with "Selected, " or " (Verified job)" added). The chip goes at the end of the company's line.

Each chip is in its own shadow root, so LinkedIn's styles don't reach it and its words stay out of
the line's text. LinkedIn draws all of this without loading a page, rebuilding the pane for each job
and the cards for each page of results, so a MutationObserver places chips wherever they're missing.

### When LinkedIn changes

On a jobs page whose pane or cards it can't read for 5 seconds, the toolbar icon shows a "!" badge
and the tooltip "Setpoint couldn't read this LinkedIn page, its job pane" (or "its job cards", or
both), so a change doesn't just make chips quietly disappear ([`src/watch.ts`](src/watch.ts)). It
expects:

- the pane wherever a job is open (`currentJobId`, or a job's own page);
- the cards on a search's results (`/jobs/search…`) with a job open. A search with no results opens
  none. Collections (`/jobs/collections/…`) get chips where their cards read, but aren't expected to.

To fix a reader, find which hook above has moved with DevTools on the page, change `linkedin.ts`, and
change the trimmed page in [`tests/fixtures/`](tests/fixtures) the same way: copy the element's outer
HTML, cut the class names, and replace every company, title, place and id with invented ones.

## Tests

`npm test` runs [`tests/`](tests) in Vitest's Chromium (`extension/vitest.config.ts`), as the
component tests run, and `npm run typecheck` checks `src/` against `@types/chrome` and
`@setpoint/shared`:

- the readers against [`tests/fixtures/`](tests/fixtures), LinkedIn's search and a job's own page
  trimmed to what they touch, with invented companies and titles;
- the chip's words as a table, and web/tests/components/jobs.test.tsx holds its standing to mail's
  (`web/src/app/jobs/words.ts`);
- the badge's rule, and the worker's reading of Setpoint's answer.

The service worker's request, the options page and the permission prompt need Chrome itself: they're
checked by hand, loaded unpacked against `npm run try`.
