# Jobs · hand-off to Claude Design (round 4)

Paste this into Claude Design with the files it names. It's the cover note; the brief is the spec.

---

You're designing **Jobs**, Setpoint's fourth page, in the app you drew in rounds 1–3.

**Read first**

- `BRIEF.md` › [Jobs (after 2.0)](../BRIEF.md#jobs-after-20): what Jobs does. Every behaviour there
  is settled (decisions 49–63). Don't redesign it, draw it.
- `BRIEF.md` › Sample data › **Jobs (round 4)**: the data every board uses. Counts follow it.
- `BRIEF.md` › Boards to draw › **Round 4: Jobs**: boards 32–40.
- `DESIGN.md`: wins over the export wherever they differ, as in round 3.
- `design-export/styles/setpoint.css` and `design-export/news/`: the shell, tokens and components
  to draw in, and how round 3 added a page's own stylesheet beside them.

**What Jobs is for, in one breath**

Andy applies to many roles. When a recruiter replies weeks later, he needs what the role asked for
in seconds, not an email search. Before he applies, he needs to know if he already applied there
and how it went. Jobs builds itself from his mail and keeps each job description as it was. It's
passive: it informs and never nags.

**Yours to decide**

- The page's layout: where the two numbers, Needs you and the table sit, and how an application's
  detail opens (a pane like the reader's, a row that expands, or something better).
- How the two numbers read: counts by status and applications per week. Keep them small; they're
  context, not a dashboard.
- How a JD reads, both the summary and lists, and the full text, for a quick look before a call.
- Each Needs you kind, and how the corrections show without cluttering a calm page.
- The JD chip in mail's reader and the Applied before badge on a mail row: small, and part of mail's
  existing look.
- Status colours from the existing tokens (`good`, `caution`, `alert`, the inks). Ghosted should
  read as faded, not as an error.

**Fixed**

- Desktop only, at 1677 × 1050, Night and Light. No phone boards.
- The table is a table: Andy wants it tabulated.
- Only the two numbers: no response rates, funnels or charts beyond applications per week.
- No notifications and no calendar changes, and nothing in mail beyond the JD chip and the Applied
  before badge.
- darma's look and Setpoint's copy rules (sentence case, " · ", one-line empty states).
- No new tokens unless a board can't be drawn without one; say which and why.

**Hand back**

Boards 32–40 as plain HTML on `setpoint.css` plus a `jobs.css`, exported like round 3 to
`design-export/jobs/` with a README listing each board, and a short list of anything in the brief
you found unclear or would push back on.
