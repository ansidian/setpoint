# Setpoint v2: design brief

This is Claude Design's brief for Setpoint v2, a ground-up rebuild of Setpoint. It was agreed with
Andy on 2026-10-07 (decisions at the end) after seven months of using v1 daily. It owns scope, the
data model, integrations and the cutover. Once Claude Design's export is reviewed, the on-screen
design moves into a locked `DESIGN.md`, which wins where the two overlap, as darma's does.

This folder becomes the `setpoint` repository at cutover, and that repository is public: no private
domains, addresses, account addresses or tailnet names here. Sample data is invented.

## What Setpoint v2 is

Setpoint v2 is Andy's private workspace for **mail and time**: one inbox across all his email
accounts, sorted so catching up takes minutes, and the calendar where he creates and changes
events and Todoist tasks. It runs on his home server and is used from a desktop browser,
with a lighter phone layout.

**mantel is where Andy glances; Setpoint is where he works.** mantel, his Home Assistant
dashboard, now shows the day (Agenda, Up next, weather, bills due) and has made v1's dashboard,
Needs You band, Finances, News and Notes redundant. v2 keeps only what Andy actually opens Setpoint
for, and does those things much better.

**After 2.0, Setpoint adds [News](#news-after-20)** (Andy, 2026-10-10, darma D85). It's a third page
listing the day's biggest stories, grouped across outlets, sorted and summarized. It isn't v1's
News tab back. That tab was raw feeds with no deduplication, no filtering, no local coverage and no
summaries, so it was never opened.

### Why a rebuild, not a refactor

- v1 grew one feature at a time, so each feature brought its own pipeline: four sync mechanisms,
  snapshot copies of emails, a calendar overlay, separate reminder plumbing. With the whole feature
  set known, v2 can be designed as one system.
- About half of v1 (dashboard, notes, news, finances, snapshots, Discord) is being dropped.
- A Linear-style restyle of v1 was tried and shelved on 2026-06-19 after two of eight phases. The
  look works when it's built in from the start, as darma shows.
- v1's hard-won logic isn't thrown away: modules that genuinely fit are ported one at a time,
  each reviewed and brought over with its tests (see [Decided elsewhere](#decided-elsewhere-not-part-of-the-design)).

## Principles

- **Mail and time, then News.** Email and calendar (with Todoist tasks), plus what they need, and
  after 2.0 the news Andy reads (D85). A feature that belongs to glancing belongs to mantel.
- **Providers are the truth.** Gmail, iCloud, Google Calendar and Todoist own the data. Setpoint
  mirrors it, never keeps its own competing copy, and sends commands to change it. Read state,
  events and tasks are the same in Setpoint and in each provider's own app. News has no provider:
  Setpoint keeps its stories and what Andy has seen.
- **The AI sorts and pre-fills; it never adds to a list Andy trusts.** It may choose a lane, a
  kind and a group, pre-fill a proposal Andy reviews, and answer a question with its sources. It
  never puts a guessed deadline, task or event anywhere unprompted. In News it picks, groups, ranks
  and summarizes stories, always with their sources one click away.
- **Fail visibly, never silently.** Unsorted mail stays in view, a failed change stays in place
  with the provider's own message, a stale source says "as of". Nothing that failed looks like it
  worked.
- **Desktop first, Linear-fast.** Keyboard first, instant, no focus rings (the keyboard cursor is
  a fill), no accessibility work, as in darma and mantel. The phone gets a deliberate lighter layout.
- **Minimal supporting text.** Only what helps Andy decide or recover.

## Vocabulary

| Term | Meaning |
| --- | --- |
| **Inbox** | The default mail view: what's unhandled or unread, across every account. |
| **All** | Every email, newest first, grouped by day. History, not a to-do list. |
| **Lane** | Attention, FYI or Noise: how urgent the triage thinks an email is. |
| **Attention** | The queue. An email there stays until it's **Done**, read or not. |
| **FYI** | Mail to know about, not act on. Shown in **groups by kind** until read. |
| **Noise** | Marketing and the like. Collapsed to a count. |
| **Kind** | What an email is: Deliveries, Money, Career, Security, Updates, People, Other. Groups FYI. (Not Work or Personal: those are account names.) |
| **Done** | Taking an email out of Attention (`H`). Not the same as read, and not trash. |
| **Unsorted** | Mail that triage couldn't sort yet. Always visible. |
| **Protected** | Security mail that always goes to Attention and that no rule can move. |
| **Item** | Anything on the calendar: an event or a Todoist task. |
| **Floating detail** | The card that anchors beside a clicked calendar item and glides between items. |
| **Proposal** | A pre-filled event or task (from an email or Alfred) that Andy reviews before it's created. |
| **Alfred** | The assistant that answers questions over Andy's mail, with sources, and drafts proposals. |
| **Source** | A provider connection (an account, Calendar, Todoist, weather) or a news feed, each with a health state. |
| **Story** | In News: the articles about one event, grouped across outlets, with one summary. The unit of the page. |
| **Section** | In News: Local, Tech, AI or General. A story can be in more than one. |
| **Missed** | In News: stories that left the page before Andy saw them, to catch up on. |

Retired from v1: snapshot, briefing, Needs You, dashboard, snooze, dismiss for today, notes, v1's
News tab, finances.

## Scope

**v2.0 (the cutover release)**

- Mail across all accounts (Gmail and iCloud): Inbox, All, the reader, search, Alfred, pin, Done,
  trash, mark read, mark all as read, two-way read sync, security treatment, codes.
- Calendar: month grid (infinite scroll), floating detail, the right pane (day agenda, editor,
  search), the full v1 editor (natural-language titles, recurrence with this/following/all, the
  conflict preview, batch drafts, Places), drag to reschedule, clone, copy and paste, multi-select,
  Todoist tasks on the calendar (create, edit, complete, drag), weather in day cells, reminders
  and Time to Leave delivered by ntfy.
- The sidebar's Today block, Settings, ⌘K, Night and Light.
- Phone-light layout.
- ntfy notifications and mantel's mail chip.
- Health states for every source.
- Week view, with resizing events by dragging their edges (moved in from after 2.0, Andy,
  2026-10-10).

**After 2.0**

- Reply and compose. "Open in Gmail" covers replies until Andy has a job and needs them; leave
  room in the reader's header for Reply.
- Full phone parity (calendar editing on the phone).
- ntfy action buttons ("Done" from the lock screen).
- Matching "Setpoint was granted access" security mail to a reconnect Andy just did.
- **[News](#news-after-20)**, desktop only (D85), as its own slices once 2.0 has cut over.
- News tuning: muting topics, "less like this", choosing sources in Settings.

**Not in v2**

The dashboard page, Needs You, snapshots, Notes, v1's News tab, Finances (mantel and the finance
importer own money), Discord, snooze, dismiss for today, the important-senders list, automatic
deadlines from mail. News sends no ntfy alerts and has no mantel chip.

## Mail

### Accounts and sync

Five accounts today: four Gmail and one iCloud, each with a label, colour, icon and order. The
account is always visible on every row and in the reader; "which account did this come from?"
should never need asking. Sync is one engine with an adapter per provider: incremental sync from a
cursor (Gmail history, IMAP), a push trigger where the provider has one (Gmail Pub/Sub pull), a
reconciliation sweep, and a health state. A 365-day backfill rebuilds the index at cutover.

### Triage

Every new email is triaged once: rules first, then a cheap model, escalating to a stronger model
when unsure. Triage gives:

- **lane**: Attention, FYI or Noise. When unsure, the default is **FYI**, never Attention.
  **Bills, invoices and statements are FYI · Money**, due date or not: bills are paid or tracked
  elsewhere. Attention only when one has gone wrong:
  a failed or declined payment, past due, a shut-off, autopay turned off (Andy, 2026-10-10).
- **kind**: the FYI group (Deliveries, Money, Career, Security, Updates, People, Other). Career is
  job applications and recruiters; People is mail from actual people.
- **organisation**: who the email is really from ("Northwind", not the hiring platform's domain).
- **type**: confirmation, rejection, receipt, shipping, deadline or reminder, verification code,
  alert, newsletter, statement.
- **key date**, if any: used only to pre-fill proposals and as a search key, never shown on its own.
- **summary**: one line, shown under the subject.
- **security facts**, for security mail: what happened, device, location, app.

Andy's corrections teach it, but only through **pattern prompts**, never per-email labelling. When
the same kind of email is repeatedly marked Done straight from the row without being opened, the
Attention group shows one line: "You've cleared 4 Northwind newsletters without opening them. Send
these to FYI from now on?" **[Yes] [No]**. Yes creates a rule. Protected mail never gets a prompt.

### The Inbox

```
ATTENTION · 3                                             ← the queue
  ● Google  Protected  Your recovery email was changed                    20m
  ● Northwind Talent   Interview availability for Software Engineer I     2h
    Contoso University          Final exam schedule · CS 101                      Mon   (read, not Done)
UNSORTED · 1                                              ← only when triage is down
SECURITY · 3                                              ← key fact on each row
DELIVERIES · 4                                     ▸
MONEY · 3                                          ▸
CAREER · 1                                         ▸
NOISE · 6                                          ▸
                                        Mark all as read  ⇧I
```

- **Attention** lists each email in full. It isn't tied to a day: an email stays until Done.
- **Every row shows its account as a colour dot and its label**, in every group and while the
  reading pane is open; the label is the one chip that never drops.
- **FYI groups** list unread mail from any day; a row from an earlier day says "Yesterday" or "Mon".
  Groups expand and collapse; a group with one email shows the row.
- **Noise** is a collapsed count.
- **Read mail leaves the Inbox**, wherever it was read (Gmail's app or Setpoint).
- **Mark all as read** marks every unread email outside Attention as read, Noise included, in one
  provider call per account.
- **All caught up** is the empty state: nothing in Attention and nothing unread.
- The header's **Unread | All** switches to All, which groups every email by day (midnight, Pacific).

### Read state and Done

- Read state is the provider's and syncs both ways: read in Gmail's app is read in Setpoint, and
  opening an email in Setpoint marks it read in Gmail. iCloud uses IMAP's seen flag.
- **An email becomes read only when Andy opens it** (a click or Enter) or uses Mark all as read.
  Moving the keyboard cursor, scrolling and expanding a group never mark anything read, and
  Noise is never marked read automatically.
- **Done** (`H`) takes an email out of Attention. Whether it was opened first tells triage
  quietly whether it needed attention: opened then Done means handled; Done from the row means
  it probably didn't. Andy never labels anything.
- **Trash** (`E`) moves it to the provider's trash, with Undo.

### Security mail

About 90% of Andy's security mail is caused by Andy (his own sign-ins, apps he connected, codes
he asked for), and hiding it would train him to miss the rest. So:

1. **Routine alerts are cheap to check, not hidden.** They sit in the **Security** group with
   the decisive fact on the row: "New sign-in · MacBook Pro · Los Angeles", "Access granted ·
   Claude". "That was me" takes a second, without opening anything.
2. **Codes are temporary.** A verification code shows on its row with Copy; the email gets out of
   the way about 15 minutes after it arrives. Never Attention.
3. **Protected mail always goes to Attention** and no rule or prompt can move it: password,
   recovery or two-step changes; an account being deleted or locked; "critical" alerts; "was this
   you?" from a device or place Andy doesn't use; money leaving an account.

### The reader

- **A reading pane, never a full-screen reader.** The list is on the left, the open email on the
  right; Andy reads several emails in a sitting. With nothing open (All caught up, a fresh load) the
  pane collapses and the list takes the width; it opens with the first email.
- The pane is about **680 px**, because most HTML email is a 600 px table. While it's open, rows
  drop their chips.
- **Header:** sender, organisation, account (colour dot and label), date, and actions: Done,
  Trash, Pin, **Open in Gmail** (`O`), More. Leave room for Reply.
- **Body:** HTML in a sandboxed frame. Remote content (images, tracking pixels) **loads
  automatically when the sender passes DMARC and the email isn't Noise**. Otherwise it's blocked
  with a one-line "Images hidden · Show · Always show from northwind.com" (trust per domain).
- **Attachments:** PDF, image and CSV preview.
- **Reader actions:** **Add to calendar** and **Add as task** open a proposal pre-filled from the
  email (its key date, place and title), shown at the top of the reading pane for review, with "More
  options" opening the full editor in Calendar. **Ask about this email** opens Alfred scoped to it.

### Pin

Pin (`P`) keeps an email on a **Pinned** shelf at the top of the Inbox, independent of lanes and
read state, until it's unpinned. Andy uses it for mail he keeps going back to.

### Search

Andy looks for **an email**, and remembers it by **organisation, type and roughly when** ("the
Northwind rejection, sometime in March"), not by sender address. v1 put the right email around
third, because it ranked importance above match.

- `/` or ⌘F focuses search in the header. **Results replace the list**; the reading pane and
  `J`/`K` work the same.
- As Andy types, words become **chips**: an organisation, a type, a date or range ("march", "last
  week"), an account, a kind. `northwind rejection march` becomes **Northwind · Rejection ·
  Mar 2026**. Chips filter exactly; results are **newest first**.
- Free text without chips matches sender, then subject, then body, then date. No importance boost.
- Each result shows why it matched, with the matching words highlighted.
- Searches and the position of the opened result are logged, so ranking can be measured against
  real searches rather than made-up ones.
- No results: "No emails match **Northwind · Rejection · Mar 2026**", each chip removable.

### Alfred

Alfred is used to find things, so it lives in search and in the reader, not in a separate chat panel.

- **⌘Enter** in search (or a question) shows an **Answer card** above the results: one or two
  lines, the source emails underneath (clicking one opens it in the reading pane), and a field for
  **follow-up questions**, so it's a short thread.
- From the reader, **Ask about this email** opens the same card scoped to that email.
- Alfred's tools are the same queries and commands the UI uses. It can't do anything Andy can't,
  and anything it would create is a **proposal**.
- Can't answer: "Couldn't find that in your mail" and what it searched.
- Bring your own key: Anthropic or OpenAI keys in Settings › AI.

## Calendar

Andy's favourite part of v1, and every feature in it is used. v2 keeps all of it in darma's shell.

```
┌ sidebar ────────┬ October 2026   ‹ Today ›     Month | Week      + New  C ┬ right pane ~400 ┐
│ Inbox  (2)  9   │  Mon    Tue    Wed    Thu    Fri    Sat    Sun         │ WED, OCT 7       │
│ Calendar        │  5      6      7 ☀    8 ☁    9      10     11          │ 2:30  Dentist    │
│                 │        ■Gym   ■Dent         ■Dinr                      │ ○ CS 101 lab    │
│ ┌ October ‹ › ┐ │               ○Lab                                     │   report due     │
│ │ mini-month  │ │  12     13     14     15 …  (scrolls through months)   │                  │
│ └─────────────┘ │                         ┌──────────────┐               │ (editor and      │
│ CALENDARS       │                         │ floating     │ ← anchored to │  search open     │
│  ● Personal  ✓  │                         │ detail       │   the clicked │  here too)       │
│  ● Classes   ✓  │                         └──────────────┘   item        │                  │
│  ○ Todoist   ✓  │                                                        │                  │
│ Settings        │                                                        │                  │
└─────────────────┴────────────────────────────────────────────────────────┴──────────────────┘
```

- **The sidebar's lower half follows the page.** On Calendar it holds the mini-month and the
  calendar toggles (each Google calendar, and Todoist tasks as one more). On Inbox it holds Today.
- **Month grid:** infinite scroll through months; events as **tinted chips** (the calendar's colour
  as text and a left bar on a light tint of it), and the **selected item becomes solid**, which is
  how selection shows: no outline ring; past events dimmed; Todoist tasks with darma's status glyphs
  (an empty ring when open, a filled disc with the check knocked out when done); a weather icon by
  each date that has a forecast; overflow folds into "+3". Titles end in "…" when clipped.
- **Floating detail (the signature interaction).** Clicking an item anchors a detail card beside
  it. Clicking another item makes the same card **glide** to the new anchor rather than closing and
  reopening, the way Google Calendar's does. It's faster and closer than a side pane, and it's
  fun. Its motion is design round 1's board 12c: position overshoots about 3%
  (`cubic-bezier(.22, 1.3, .36, 1)`), 280 ms + 40 ms per 400 px of travel, capped at 380 ms; height
  and content use the standard curve; a click mid-glide retargets from the current velocity. The
  overshoot never crosses the grid's edge: near an edge it shrinks to the room left, so the card
  settles there with less bounce. The card is **280 px** wide, so it fits beside an item within two
  day columns.
  **Placement:** per click, the side (right, left, above, below) that covers the fewest other items,
  right first. **Drag:** the card can be dragged anywhere and stays there; the next click glides it
  **from where it was left** to the new item. Edit hands the item to the editor in the right pane.
- **The right pane** shows the selected day's agenda by default, the editor when creating or
  editing, and calendar search results.
- **Editor:** natural-language title ("Dinner with Sam fri 7pm @Blue Door"), parsed into date,
  time, place and calendar; recurrence (and this / following / all when editing a recurring event);
  the conflict preview (a small timeline of the day showing overlaps); reminders; Places
  autocomplete; the calendar picker; batch drafts (several events at once). A Todoist task uses the
  same editor with its project, labels and due date.
- **Direct manipulation:** drag to another day (tasks by whole day), clone, copy and paste,
  colour, delete, multi-select. Moving or deleting one occurrence of a recurring event asks this /
  following / all on drop, as editing does.
- **Week view (after 2.0, draw now):** an hour grid with an all-day row holding tasks; drag over
  a range to create, drag to move; the floating detail works the same. About 1,030 px wide at
  1677 px, about 147 px a day.
- **Reminders and Time to Leave** (from Andy's home location, using live routes) go out by ntfy.

## News (after 2.0)

The day's news for Andy, sorted so that a look takes minutes:
- what happened in his area
- what launched in tech
- what moved in AI
- the US headlines that matter

It's built against everything that sank v1's tab:
- one story per event, however many outlets ran it
- noise filtered out before anything shows
- real local coverage
- a summary of every story, so nothing needs a click-through to understand

Desktop only until it proves it's used. On the phone, News isn't in the navigation (D85).

### What it covers (D88)

| Section | In | Not |
| --- | --- | --- |
| **Local** | Andy's area (the home location in Settings › Calendar): crime and public safety, ICE raids and detentions, fires and other hazards, closures, local government decisions with a real effect. Ranked by how close they are. | Countywide fluff, events listings, food and lifestyle |
| **Tech** | Real launches and announcements from Apple, Google, Samsung, Microsoft and the like; upcoming keynotes | Rumors, leaks, deals, reviews, buying guides |
| **AI** | Releases, features and incidents at Anthropic, OpenAI, Google DeepMind, Meta, Hugging Face, Mistral and the like; big AI headlines | Tutorials, customer stories, funding rounds |
| **General** | US events: shootings, ICE incidents, disasters, laws taking effect, court rulings with real effect, shutdowns | World news |

Never anywhere: sports, entertainment and celebrity news, opinion, sponsored posts and deals.
**Weather** counts only as a hazard: fire, flood, storms, hurricanes, disasters. Calendar already
shows the forecast.

**Politics: events, not arguments.** A raid, a law taking effect, a ruling or a shutdown is in.
Campaigns, polls, reactions, hearings, and bills being "debated" until they pass are out.
**The subject wins over politics**, though:
- "OpenAI testifies before Congress" is in, under AI.
- An antitrust ruling against Google is in, under Tech.
- A council vote on a housing project in Andy's area is in, under Local.

### Stories (D86)

- **A story is the articles about one event.** The same fire from five TV stations is one story,
  "KTLA +4". Identical wire copy (AP text republished by ABC and PBS) counts as **one** outlet.
- **The headline is written by the model**, plain and neutral, not taken from whichever outlet
  wrote the most clickable one. One line of summary sits under it.
- **One summary, written from all the sources.** It's rewritten only when an article brings new
  facts. "Suspect arrested" is a new fact; a fifth outlet repeating the first four isn't.
- A story can sit in **more than one section** (an Anthropic story that makes the national
  headlines). Its seen state is shared.
- A story **leaves the page 48 hours after its last new fact**, so a story that keeps developing
  stays up.

### The page

```
┌ sidebar ─────┬ News  All | Local | Tech | AI | General      [Search news /] ────────┬ story pane ~680 ─┐
│ Inbox (3) 19 │ 14 stories you missed since Mon · Catch up    3 new · 1 updated      │ Brush fire near  │
│ Calendar     │ LOCAL                                                                │ the 210 grows to │
│ News         │ ┌───────────┐ ◐ Brush fire near the 210 grows to 400 acres           │ 400 acres        │
│              │ │ 16:9 image│   Evacuation warnings for foothill homes               │                  │
│ TODAY        │ └───────────┘   KTLA +4 · 1h                                         │ NEW SINCE YOU    │
│ 2:30 Dentist │ ● Red Flag Warning for the valleys until Thu 6 PM   NWS · 3h         │ LOOKED · 8:40 AM │
│              │ ◐ Man arrested after a stabbing outside …  NBC LA +2 · 5h  ▣         │ …                │
│              │   Federal agents detain 9 at a car wash   LAist +3 · Yest  ▣         │ SOURCES          │
│              │ 12 more in Local                                                     │ KTLA · 1h        │
│              │ TECH  Apple event · Tue Oct 20 · 10 AM · Add to calendar             │ NBC LA · 2h      │
│ Settings     │ ┌───────────┐ ● Pixel Watch 5 goes on sale …                         │ …                │
└──────────────┴──────────────────────────────────────────────────────────────────────┴──────────────────┘
```

- **All** shows one block per section in a fixed order (Local, Tech, AI, General), each with its
  **top 3–5 stories, biggest first**, then "12 more in Local", which opens that section. The order
  is fixed so the page reads the same every day.
- **A section** (the segmented control, or "N more") is that section's full list, biggest first.
- **A row:** the new or updated dot, the headline, the one-line summary, then the leading outlet
  with how many more cover it and the age ("KTLA +4 · 1h"), and a **thumbnail**. **Each block's
  top story gets a larger 16:9 image**, and the rest a small one at the row's end, so the page
  isn't a wall of text.
- **Thumbnails:**
  - Each story uses the best image across its sources.
  - Setpoint copies the image, resizes it and serves it itself. Outlets never see Andy's browsing,
    and blocking hotlinked images can't break it.
  - The copy is deleted with its story.
  - A story without an image has no placeholder. Never an AI-generated image.
- **The story pane** (the reading pane's place and width, collapsing when nothing is open):
  - the headline and the summary
  - for an updated story, **what's new since Andy last looked**, with times ("8:40 AM · Grew from
    150 to 400 acres overnight")
  - **Sources**: each outlet with its own headline and age
  - Clicking a source opens the article in the pane: its text, extracted from the page, with
    **Back** and the original link always at the top (`O`).
  - An article whose page can't be read in-app shows its feed summary and "Read at KTLA".
- **Upcoming:** a thin strip at the top of the Tech block for keynotes ("Apple event · Tue Oct 20 ·
  10 AM · Add to calendar").
  - An event is detected from invite headlines, confirmed by a second outlet or the company itself.
  - **Add to calendar** opens a proposal, as from an email.
- **Search** in the header finds stories from the last 90 days, including expired ones, by words in
  their headline, summary and sources (D91).
- The sidebar's lower section shows **Today**, as on mail pages. The tab title is "News".

### New and seen (D87)

- **No unread counts, anywhere.** The dots are information, not a to-do list: there's nothing to
  clear and no "mark all seen".
- A story is **new** until it's seen: its row fully on screen for about a second, or opened.
  Flicking past doesn't count. Stories behind "N more" stay new until their section is open and
  they scroll into view.
- A story with **new facts** gets its dot back as **updated**, and its pane shows what changed since
  Andy's last look.

### While the page is open (D87)

The list's order **holds**, so nothing moves under the cursor:
- A story already on screen updates in place: its dot, its source count, its summary.
- New stories, and stories that would now rank differently, wait behind a pill at the top: "3 new ·
  1 updated". The pill re-sorts the list.
- Opening the page always shows the latest order.

### Missed (D87)

When stories left the page before Andy saw them, a line at the top of All offers them: "14 stories
you missed since Mon · Catch up".
- **Catch up** lists them by day, biggest first, at most 5 per section per day.
- Each story leaves Missed as it's seen.
- The line goes when Missed is empty.

### Ranking (D86)

"Biggest" combines four signals:
- **how many outlets** cover the story
- **how much it matters**, judged by the model against a short guide for each section:
  - Local: public safety, hazards, ICE activity, closures
  - Tech: real launches from the named companies
  - AI: releases and incidents at the major labs
- **how close it is**, for Local
- **how recent it is and how fast it's growing**

Noise is cut before ranking. A story under the bar never shows, so a day comes to roughly 30–50
stories on the page, not everything that was published.

### Sources (D89, D91)

- **Free sources only, chosen by hand and checked to have no paywall.** Nothing costs money except
  model calls. The 2026-10-10 research (darma SV-43) found about 300 articles a day after
  filtering, from:
  - **outlet feeds:** TV stations' local feeds, a county crime wire, area sites, and national
    outlets (NPR, PBS, ABC, CBS, NBC, the Guardian US, BBC)
  - **official data for hazards:** National Weather Service alerts for the home location's zone,
    USGS earthquakes, Cal Fire incidents, air quality
  - **first-party newsrooms:** Apple, Google, Samsung, Microsoft, OpenAI, Google DeepMind, Hugging
    Face. Anthropic has no feed, so its news page and release notes are read directly.
  - **Hacker News** stories above a points threshold that match a tech or AI subject
- **A metered paper** counts toward a story's outlets and confirms local stories, but it is never
  shown or readable. A story covered only by that paper doesn't show.
- **Google News search for the area** finds stories but is never read. A story it alone found shows
  its headline and the Google link, with no text in the reader.
- No Claude web search for now.
- **The local sources and the area live with Andy's data, not in this repository** (D91), because
  the repository is public. The NWS zone and the distance filters come from the home location.
- **Polling:** every 15 minutes (many feeds hold only 10 items), hazards every 5, except AirNow's
  file, read hourly as it changes (DESIGN.md #97). Every request sends an honest, named User-Agent.
- **First run** fills the last 48 hours. Everything starts new, and Missed stays empty until there's
  history.

### Models and cost (D90)

News uses the production keys in Settings › AI, within about **$50 a month** (the Anthropic
subscription's API credits cover it).

| Work | Model | About |
| --- | --- | --- |
| Each article: section, noise filter, key facts, best image | Haiku 5.5 | $3 a month |
| Grouping: is this the same event, and does it bring new facts? | Haiku 5.5 | $2 |
| Each story's headline and summary, from Haiku's fact notes, rewritten only on new facts | Sonnet 5.5 | $15–25 |
| Ranking, hourly, on a cached prompt | Sonnet 5.5 | $3–5 |

A **monthly cap** (default $40) switches summaries to Haiku for the rest of the month and says so
in Settings › AI. News has its own row in the AI usage ledger.

### When things break

- **Each feed is a source** with a heartbeat and a health state, listed by section in
  Settings › News. The page shows a line only when a **whole section** is stale or failing:
  "Local, as of 9:14 PM".
- **A page read that suddenly finds nothing** (Anthropic's news page) counts as **failing**, not
  quiet, since the page's layout may have changed.
- **The AI is down:** articles still arrive and wait in an **Unsorted** line at the top ("12
  articles not sorted yet"), which opens the raw headlines with their links. Nothing vanishes.
- **An article that can't be extracted** isn't an error. It falls back to its feed summary and the
  link.

## The sidebar's Today block (Inbox)

Confirmed data only. No guessed deadlines.

```
TODAY
 2:30 PM  Dentist         in 5h
 ○ 2 due today
 ○ 1 due tomorrow
```

Clicking the event opens Calendar with its floating detail; clicking a task line opens Calendar on
that day.

## Phone (below 640 px)

The same pages and routes laid out for the phone, with no separate component trees, so full parity
later is layout work only.

- Inbox as one column (Attention, Pinned, Security, FYI groups, Noise), Done, Trash, Mark read and
  Mark all as read.
- The reader full width, with Back.
- A read-only agenda: today and the next 7 days, tapping an item opens its detail.
- Plain search box (no chips yet). No calendar editing, no Alfred, Settings only to sign in.
- ntfy notifications open the exact email or item.
- No News (D85): it's left out of the phone's navigation until it proves it's used on the desktop.

## Notifications and mantel

### ntfy

Setpoint sends every phone notification through Andy's self-hosted **ntfy**; Discord is retired.
Setpoint has one notification outlet with ntfy as its delivery, so the reminder logic never knows
about ntfy.

- Topics by kind (`setpoint-reminders`, `setpoint-mail`), so iOS groups them and each can be muted.
- Each notification's click opens the exact event, task or email in Setpoint.
- Sent: event and task reminders, Time to Leave, a source that needs reconnecting (once).
  Attention mail stays quiet for now: turn it on once attention precision is trusted (see Health).

### The mail chip in mantel

Setpoint exposes its mail state to Home Assistant (an integration reading a Setpoint status
endpoint, as the finance importer's does), and mantel shows **one split pill** in its chip row:

```
 ┌──────────────┬─────────┐
 │ ✉ 2 attention │ 4 FYI   │    attention half in mantel's tone C · FYI half a plain status chip
 └──────────────┴─────────┘
```

- **Attention** counts attention mail not yet Done, read or not, the same number as the sidebar's
  pill; **FYI** counts unread FYI.
- Only attention: the whole pill in tone C. Only FYI: a plain status chip that folds early. Both 0,
  or the sensor unavailable: hidden (a broken connection never reads as all clear).
- Its popover lists up to three attention emails (sender · subject · account dot) and "Open
  Setpoint"; each row opens that email.
- A source that needs reconnecting shows as an **alert** chip, "Business needs sign-in", exactly
  like the finance importer's sign-in chip: mail silently not arriving needs fixing now.
- mantel's DESIGN.md gets this entry first, with Andy's agreement, per mantel's own rule.

## Health and states

A source is **healthy** when its last check succeeded, not when its data last changed: a quiet
night with no new mail is healthy. (v1 measured time since the last change, flagged quiet mirrors
as stale, and kept lengthening thresholds.) Each source has a heartbeat (its sweep, watch renewal or
poll), and its threshold is derived from that schedule (about twice the interval plus a grace).

| State | Shown |
| --- | --- |
| **Healthy** | Nothing. |
| **Stale** (checks stopped running) | One muted line where it matters: "Personal, as of 9:14 PM". |
| **Failing** (checks run, the provider errors) | The same line with the reason. |
| **Needs reconnect** | A warning glyph on the account in the sidebar, "Business needs sign-in · Reconnect" at the top of the Inbox, one ntfy notification, mantel's chip. Reconnect opens Settings › Accounts. |
| **Offline** (Setpoint's stream dropped) | mantel's Disconnected pattern: a top pill, "Offline, as of 9:41 PM, retrying", then Retry now. Changes are disabled, not queued. |
| **Triage down** | The **Unsorted** group under Attention. |
| **A change failed** | On the item, in place: failed with the provider's own message and Try again. It never quietly reverts. |
| **First backfill** | Search's status line: "Indexing · 62% · showing what's indexed so far". |

Settings › Accounts shows every source's last check, push status and state in one place, plus
**attention precision**: the share of attention mail marked Done without being opened, over the
last 30 days.

## Settings

darma's Settings: a **1040 × 720 modal** with a 220 px nav, not in the address bar, opened from
the sidebar and ⌘K, and openable straight to a page (a reconnect link goes to Accounts).

- **Accounts:** connect Gmail (Google sign-in) and iCloud (app password); reconnect; label,
  colour, icon, order; each source's health; attention precision.
- **Calendar:** which calendars show; home location (for Time to Leave); weather on or off.
- **Todoist:** connection, default project.
- **Notifications:** ntfy server and topics, reminder defaults, Time to Leave.
- **Mail:** rules (written and learned), trusted remote-content domains, the code expiry.
- **AI:** Anthropic and OpenAI keys (write-only), the triage and Alfred models; after 2.0, News's
  models, its monthly cap and this month's spend.
- **News** (after 2.0): the sources by section, each with its health. Read-only until the tuning
  round.
- **Appearance:** System, Light or Night (per browser).
- **Security:** password, passkeys, recovery codes, sign out.

## Layout

darma's shell, unchanged where it can be.

- **Sidebar** (248 px, `panel`): Setpoint's mark with search; **Inbox** with the attention pill
  (a `caution` count, like darma's Reviews due) and the unread count; each account under it with its
  colour dot and unread count (each filters the Inbox); **Calendar**; after 2.0, **News**, with no
  count; the page's lower section (Today on Inbox and News, mini-month and calendars on Calendar);
  **Settings** pinned to the bottom.
- **Header** (56 px): the view's title, its segmented control (Unread | All; Month | Week; All |
  Local | Tech | AI | General), a spacer, search on mail pages and News, and the primary action
  (+ New on Calendar).
- **Content** scrolls under the header. **Panes** (the reading pane, Calendar's right pane) sit
  under the header with a `hair` left border.
- **Tab title:** "(2) Inbox" while attention mail is waiting; the email's subject when one is
  open; "October 2026 · Calendar"; "News", or the story's headline when one is open.
- **Wide screens:** darma's rule, 1.25× from 2200 px.
- Design target **1677 × 1050** (MacBook with Arc's sidebar open), holding at 1728 × 1117.

## Keyboard

| Where | Keys |
| --- | --- |
| Everywhere | ⌘K palette · `1` Inbox · `2` Calendar · `3` News (after 2.0) · `/` search · ⌘, Settings · Esc closes the topmost thing |
| Mail | `J`/`K` move · Enter open (marks read) · `H` Done · `E` trash (Undo) · `P` pin · `O` open in Gmail · ⇧I mark all as read · ⌘Enter ask Alfred |
| Calendar | ←/→ or `P`/`N` page · `T` today · `C` new event · `D` new task · `E` edit · Delete · `M`/`W` month or week · Enter · Esc |
| News | `J`/`K` move · Enter open the story · `O` open the original article · `N` take the new stories (the pill) · Esc back, then close |

v1's mail keys are kept where they existed (`E` was already trash, `H` handled, `P` pin) so muscle
memory carries over. `S` (snooze) and `D` (dismiss) in mail are gone.

## Visual system

darma's DESIGN.md is the visual reference: its tokens (mantel's, with a Light theme), type,
shape, motion, glyphs, scrollbars, list rows, group headers, menus, ⌘K, peek and Settings. Setpoint
adds only what mail and calendar need.

### Colour (Night; Light per darma)

| Token | Night | Use here |
| --- | --- | --- |
| `page` / `panel` | `#050506` / `#08090a` | background / sidebar, group headers |
| `card` / `cardOn` | `#0c0d0f` / `#131417` | floating detail, proposal card, Answer card |
| `chip` / `modal` | `#0f1013` / `#0c0d0f` | chips, inputs / Settings, popovers |
| `ink` / `ink2` / `ink3` | `#ecebe7` / `#a3a4a8` / `#707277` | sender and subject / summary / times, counts |
| `edge` / `edgeOn` / `hair` | `rgba(255,255,255,.055)` / `.12` / `.07` | borders / focused / dividers |
| `sub` / `sub2` / `sub3` | `rgba(255,255,255,.055)` / `.09` / `.13` | hover / keyboard cursor and selection / tracks |
| `caution` | `oklch(0.75 0.16 40)` | the attention pill, failing and needs-reconnect lines (stale lines stay muted, `ink3`) |
| `alert` | `oklch(0.72 0.17 25)` | protected security mail, failed changes, destructive actions |
| `warm` / `cool` / `good` / `comf` / `sun` / `violet` / `cyan` | darma's | account and calendar colours, weather, statuses |

- **Accounts and calendars** pick from darma's 11 swatches.
- **Unread** is a 6 px `ink` dot before the sender and a 500 weight; read rows are 400 in `ink2`.

### Type, shape, motion

darma's: Geist with `ss01` and tabular numbers on times and counts, Geist Mono for codes; base 13 px;
radii 999 / 26 / 18 / 14 / 12 / 10; mantel's 120 / 180 / 260 ms with `cubic-bezier(.2,0,0,1)`. The
floating detail's glide is the one motion to design afresh. Material Symbols Rounded 300.

### What not to carry over

- **From mantel:** the one-page no-scroll rule, device cards and dials, charts, phone sheets as
  modals, the glass Light theme.
- **From v1:** the three-rail calendar shell (a second left rail inside the sidebar), the
  dashboard, the Needs You band, the snapshot navigator, the Catppuccin palette, Lucide icons.

## Copy

darma's rules: sentence case; " · " separates parts, " – " ranges; "…" is one character; times
"2:30 PM"; ages "now", "4m", "2h", then "Yesterday", "Mon", then "Oct 1" in the Inbox and search;
**clock times** ("8:52 AM") under All's day headings, where an age would repeat the heading; full
timestamps in tooltips.
Empty states are one line and an action: "All caught up", "No events · New event". The UI says
"Done", never "handled" or "resolved".

## Sample data

Invented. Today is **Wednesday, Oct 7, 2026, 9:12 AM** (Pacific).

**Accounts:** Business (`warm`), Personal (`cool`), Work (`comf`), Jobs (`violet`), iCloud
(`ink2`).

**Inbox**

| Group | Email | Account | Age | Notes |
| --- | --- | --- | --- | --- |
| Pinned | Lease renewal terms · Parkside Apartments | Personal | Sep 30 | |
| Attention | Your recovery email was changed · Google | Personal | 20m | **Protected**, unread |
| Attention | Interview availability for Software Engineer I · Northwind Talent (via Greenhouse) | Jobs | 2h | unread; summary "Pick a 30-minute slot this week" |
| Attention | Final exam schedule · CS 101 · Contoso University | Personal | Mon | read, not Done; key date Dec 9 |
| Security | New sign-in · MacBook Pro · Los Angeles · Google | Business | 1h | |
| Security | Access granted · Claude · Google | Work | 3h | |
| Security | Your code is **482 913** · Contoso Insurance | Personal | 4m | expires in 11 min |
| Deliveries | Arriving today: USB-C hub · Wingtip Toys | Business | 6h | |
| Deliveries | Delivered: desk lamp · Wingtip Toys | Business | Yesterday | |
| Deliveries | Out for delivery · Consolidated Messenger | Personal | 2h | |
| Deliveries | Your item shipped · Southridge Video | Business | Mon | |
| Money | Statement ready · Woodgrove Bank | Personal | 5h | |
| Money | You sent $42.00 to Sam Lee · Woodgrove Pay | Business | Yesterday | |
| Money | Bill is ready · $89.99 · Proseware | iCloud | 8h | |
| Career | Application received · Data Analyst · Fabrikam (via Workday) | Jobs | 7h | |
| Noise | 6 | Business 2, Personal 4 | | |

Counts before anything is opened (opening an unread email marks it read, so a board with the
Northwind email open shows 18 unread and Jobs 1; the attention pill stays 3): **3** attention not Done (the Contoso University one is read); **11** unread
FYI (Security 3, Deliveries 4, Money 3, Career 1); **19** unread in all, Noise included. Sidebar:
Inbox (3) 19; Business 7, Personal 8, Work 1, Jobs 2, iCloud 1. mantel's chip: "3 attention | 11 FYI".
One version of each email everywhere: the Parkside email is from Dana Whitfield, offers renewal to
Nov 30, 2026, must be signed by Oct 31, and attaches "Renewal agreement.pdf"; Blue Door is at
2118 Sunset Blvd; Dinner with Sam is 7–9 PM.

**Search:** `northwind rejection march` → Northwind · Rejection · Mar 2026 → "Update on your
application · Northwind Talent · Mar 14" first. Alfred: "When does my lease renewal need to be
signed?" → "By Oct 31, 2026, per Parkside's Sep 30 email", with that email as the source; follow-up
"what's the new rent?" → "$2,140 a month, up from $2,060."

**Calendar (October 2026):** Gym Mon/Wed/Fri 7–8 AM (recurring, Personal); Dentist Wed Oct 7 2:30
PM, Smile Dental (Personal); Dinner with Sam Fri Oct 9 7 PM, Blue Door (Personal); Career fair Thu
Oct 15 10 AM–2 PM, University Student Union (Jobs); CS 101 lecture Tue/Thu 6:00–7:15 PM (Classes);
Study group Fri Oct 9 6:30–8:30 PM (Classes), overlapping Dinner with Sam;
Todoist: "CS 101 lab report" due Oct 7, "Pay rent" due Oct 7, "Renew car registration" due Oct 8,
"Return library books" done Oct 5. Weather: sun on the 7th, clouds on the 8th, rain on the 13th.

**Today block:** 2:30 PM Dentist · in 5h; ○ 2 due today; ○ 1 due tomorrow.

**News (round 3).** Same morning. Andy last looked Mon at 10:40 PM.

- **Real names and invented events.** The companies and outlets are real, but every event below is
  invented, and incidents happen to invented organisations (Fabrikam).
- The local stories stay at the level of Los Angeles, not Andy's area.
- ● marks new, ◐ updated, and no mark means seen. "img" is a thumbnail; each block's first story
  takes the large image.

| Block | Story | Sources | Age | State |
| --- | --- | --- | --- | --- |
| Local | Brush fire near the 210 grows to 400 acres · "Evacuation warnings for foothill homes; crews held the west flank overnight" | KTLA +4 | 1h | ◐, img; new 8:40 AM: "Grew from 150 to 400 acres overnight; warnings widened" |
| Local | Red Flag Warning for the valleys until Thu 6 PM · "Gusts to 50 mph, humidity under 10%" | NWS | 3h | ●, no image |
| Local | Man arrested after a stabbing outside a Metro station · "The victim is in stable condition" | NBC LA +2 | 5h | ◐, img; new 7:55 AM: "Suspect arrested" |
| Local | Federal agents detain 9 at a car wash · "Neighbors gathered to film; two were released by evening" | LAist +3 | Yesterday | img |
| Local | Council approves a 120-unit housing project on a former parking lot | Streetsblog LA | Mon | |
| | 12 more in Local | | | |
| Tech | Upcoming: **Apple event · Tue Oct 20 · 10 AM** · Add to calendar | MacRumors +6 | | |
| Tech | Pixel Watch 5 goes on sale with two-day battery life · "From $349; preorders ship Friday" | The Verge +5 | 2h | ●, img |
| Tech | Samsung opens the One UI 9 beta to Galaxy S26 owners in the US | 9to5Google +2 | 6h | ●, img |
| Tech | Apple sends invites for an Oct 20 event · "Expected: new iPads and Macs" | MacRumors +6 | Yesterday | img |
| | 7 more in Tech | | | |
| AI | Anthropic releases Claude Haiku 5.5 · "Faster and cheaper, available in the API and Claude apps today" | Anthropic +8 | 2h | ●, img |
| AI | Fabrikam Hub resets every access token after a leak · "Tokens from Sep 28 to Oct 5 may be exposed" | Ars Technica +4 | 9h | ◐, img; new 6:30 AM: "Fabrikam says no models were altered" |
| AI | Gemini app adds scheduled tasks on Android | Google +2 | 7h | ●, no image |
| AI | OpenAI testifies before a Senate committee on AI safety | NPR +5 | Yesterday | img |
| | 4 more in AI | | | |
| General | Hurricane Teresa makes landfall in the Florida Panhandle as a Category 3 · "About 400,000 without power" | NPR +11 | 3h | ●, img |
| General | Federal judge blocks a rule ending work permits for asylum seekers | Courthouse News +4 | 6h | ● |
| General | Four killed in a warehouse shooting in Ohio; suspect in custody | ABC News +7 | 8h | ◐, img; new 7:10 AM: "Suspect in custody" |
| | 9 more in General | | | |

- **Missed:** "14 stories you missed since Mon · Catch up". Tuesday holds Local 3, Tech 2, AI 4,
  General 5.
- **The pill:** "3 new · 1 updated".
- **The brush fire story's pane:**
  - Summary: "A brush fire near the 210 grew from 150 to 400 acres overnight. Evacuation warnings
    cover foothill homes north of the freeway. Crews held the west flank, and winds are forecast to
    pick up this afternoon under a Red Flag Warning."
  - Sources: KTLA 1h (summary only), NBC LA 2h, CBS LA 3h, ABC7 4h, FOX 11 6h.
- **States:**
  - Unsorted: "12 articles not sorted yet".
  - A stale section: "AI, as of 7:02 AM".
  - A section with nothing new: "Nothing new in AI since Mon".

## Boards to draw

1. **Inbox, a typical morning** (the sample data), the reading pane open on the Northwind email.
2. Inbox with **Deliveries expanded** and the pane on a 600 px HTML newsletter, images hidden.
3. **Security** detail: the protected recovery-email alert in Attention, the code row with Copy,
   routine rows with their key facts.
4. **All caught up.**
5. **All** view, grouped by day.
6. **Search** with chips (`northwind rejection march`) and results.
7. **Alfred's Answer card** with sources and one follow-up turn.
8. A **proposal** in the reading pane: Add to calendar from the Contoso University email (exam, Dec 9).
9. The **pattern prompt** in Attention.
10. Pinned shelf with two pins.
11. **Calendar month**, October 2026, with the sidebar's mini-month and calendars, and the right
    pane's agenda for Oct 7.
12. **Floating detail** on Dentist, then the same card having glided to Dinner with Sam (two frames
    and a motion note).
13. The **editor** in the right pane creating "Dinner with Sam fri 7pm @Blue Door", with the
    conflict preview and Places suggestions.
14. Editing a recurring event: the this / following / all choice.
15. A **drag in progress**: Gym moved to Thursday, with the ghost.
16. **Week view**, Oct 5–11.
17. **Settings › Accounts** with health: one healthy, one stale, one needs reconnect, and attention
    precision.
18. **Settings › Mail** (rules, learned rules, trusted domains) and **Settings › Notifications** (ntfy).
19. **States:** the needs-reconnect line in the Inbox, the offline pill, the Unsorted group, a
    calendar item whose change failed with Google's message.
20. **⌘K** on an open email.
21. **Phone:** Inbox, the reader, the agenda.
22. **Light** versions of boards 1 and 11.
23. **mantel's chip:** the split pill in each state and its popover, drawn in mantel's chip row.
24. Setpoint's **mark**: a placeholder for now (round 1's options are parked; Andy picks later).

**Round 3: News** (2026-10-10). Draw it in the existing app shell and components: the export's
`setpoint.css`, with DESIGN.md winning over it. Use the News sample above.

25. **News, a typical morning:** All with its four blocks, the Missed line, the pill, Upcoming in
    Tech, and the pane open on the brush fire story (updated, with what's new and its sources).
26. **An article in the pane:** NBC LA's article with Back and the original link; then KTLA's,
    which can't be read in-app (feed summary and "Read at KTLA").
27. **A section:** Local's full list, with new, updated and seen rows, and rows with and without
    images.
28. **Missed:** the catch-up list by day.
29. **States:** the Unsorted line, a stale section, a section with nothing new, the first run.
30. **Settings › News** (sources by section, with health) and **Settings › AI** with News's
    models, cap and spend.
31. A **Light** version of board 25.

## Decided elsewhere (not part of the design)

- **Architecture** (designed with the whole feature set in mind):
  - **One sync engine** with provider adapters (Gmail, iCloud, Google Calendar, Todoist, weather):
    cursor sync, push trigger, reconciliation sweep, health, durable jobs, one retry policy, one
    needs-reconnect signal.
  - **One message record** per email with derived fields (lane, kind, organisation, type, key date,
    summary, security facts, pinned). Every view is a query; nothing is copied per view.
  - **One item model** for the calendar: events and Todoist tasks are items with a time, a source and
    reminders. No overlay special case.
  - **One command layer** after mantel's `control`: a change shows as pending until the provider
    confirms it, and fails with the provider's message. Bulk read is one Gmail `batchModify`.
  - **Typed live events** (`mail`, `items`, `health`) over one stream.
  - **One notification outlet**, delivered by ntfy.
  - **Alfred's tools** are the UI's queries and commands; writes are proposals.
  - **News (after 2.0)** sits beside mail rather than inside it:
    - Feeds are sources in the sync engine, with heartbeats, health and durable jobs.
    - Articles go through an intake shaped like triage: rules (source to section) first, then the
      model.
    - A story is a record holding its articles, summary, facts timeline, sections, rank and seen
      state.
    - Stories get their own typed live event, `news`.
    - Images and extracted text are kept in the data directory and expire with their story.
    - The local feed list is seeded into the data directory, not committed.
- **Stack:** darma's. npm workspaces (`shared`, `server`, `web`), Hono, better-sqlite3 with
  Drizzle, Zod, React 19 and Vite 8 with no UI library, Geist and Material Symbols bundled, Node
  running TypeScript directly.
- **Porting v1:** code comes over only where it genuinely fits, one module at a time, reviewed and
  with its tests: candidates are v1's calendar models (layout, recurrence scope, quick actions,
  deadline reschedule, floating detail placement), the Google Calendar and Todoist clients, Gmail
  history sync and Pub/Sub pull, iCloud IMAP pooling, the Chrono title parser and the verification
  code detector. A branch nobody can explain is probably a fixed bug, so it's ported, not retyped.
- **Hosting:** as v1: a Docker container on the home server, SQLite in its data directory,
  covered by the existing backups, behind a private proxy. Host details live in the private ops
  workspace.
- **Cutover (alongside first, as darma did):**
  - v2 runs on its own hostname beside v1. v1's Google and Todoist tokens are exported once with
    v1's own decryption; refresh tokens belong to the OAuth **client**, not the redirect URI, so v2
    uses them at once. v2's callback is added as a second redirect URI on the same Google client.
  - v2 gets its own Pub/Sub subscription on Gmail's topic and its own Calendar watch channels;
    Todoist is polled until cutover. Providers hold the truth, so both apps can run at once.
  - **Carried over:** accounts and their labels, colours, icons and order; OAuth tokens and iCloud
    app passwords; Andy's password and passkeys; AI keys and model choices; the Places key and home
    location; triage rules and v1's lane corrections; remote-content trust (converted to domains);
    pins. **Rebuilt from providers:** the mail index (365 days), calendar and Todoist mirrors.
    **Left behind:** snapshots, usage logs, Notes, News, Finances, Discord.
  - At parity: point Setpoint's hostname at v2 (passkeys need the same hostname), copy the sign-in
    rows, move the Todoist webhook, stop v1, and this folder replaces the `setpoint` repository.
    Rollback is pointing the hostname back.
- **Process:** this brief → Claude Design → review and iterate → `DESIGN.md` → `BUILD-PLAN.md` →
  an orchestrating session fanning out to subagents, as darma and mantel were built.

## Decisions so far

All 2026-10-07, Andy, with the evidence each rests on. "v1 data" means v1's production database,
read-only: about 1,700 triaged emails over 120 days.

1. **v2 is a greenfield rebuild** in mantel's design language, replacing the `setpoint`
   repository at cutover and keeping its hostname, so Google and Todoist need no new setup.
2. **Scope is mail and calendar** (with Todoist). The dashboard, Notes, News and Finances go;
   mantel shows the day. Andy opens v1 only for mail and Calendar. (News returns after 2.0 as a
   new page, not v1's tab: darma D85–D91, 2026-10-10.)
3. **The unified inbox is the core**: every account in one place, the account always visible.
4. **Classification stays** (Attention, FYI, Noise), but **FYI is grouped by kind**. v1 data: FYI
   is 66% of mail, and Money (32%) and Deliveries (27%) are most of it.
5. **No snapshots.** Andy only ever used "midnight starts a new day".
6. **The Inbox is a view of state**: Attention until Done; FYI and Noise until read, from any day;
   no Yesterday group; **All** is the history by day.
7. **Read syncs both ways** with Gmail and iCloud.
8. **Read only by opening or Mark all as read.** Never on scroll, never Noise automatically.
9. **Search finds an email by organisation, type and date**, using chips and date order. v1 ranked
   importance (+60) above an exact match (+45), so the right email was around third.
10. **Organisation, type and key date are extracted at triage**, once per email.
11. **Alfred stays**, inside search (the Answer card, with **follow-up turns**) and the reader, not as
    a separate panel. v1 data: 22 conversations, mostly `search_email` and `get_email_body`.
12. **Reply stays out of 2.0**; Open in Gmail covers it, with room left for Reply.
13. **Reading pane always**, never a full-screen reader.
14. **The look is darma's** (mantel's tokens in a Linear-style app), with no accessibility work.
15. **No dashboard page.** The sidebar's Today block shows the next event and Todoist tasks due
    today and tomorrow; Inbox carries the attention pill and unread counts.
16. **No automatic deadlines from mail.** v1 data: about 2 extracted "deadlines" a day, about 85%
    not deadlines (autopay dates, statements, terms updates, offers). The extracted date only
    pre-fills proposals and serves search.
17. **The calendar keeps everything**; recurrence and the conflict preview are used sometimes, the
    rest often.
18. **The floating detail stays** and glides between items: faster, closer, and fun.
19. **Week view** if space permits: it does, so it's drawn now and built after 2.0.
20. **Calendar's right pane** holds the day's agenda, the editor and search; the sidebar's lower half
    holds the mini-month and calendars.
21. **Phone-light** for now: Inbox, reader, read-only agenda, deep links.
22. **ntfy for every phone notification**, Discord retired. Not Home Assistant, to keep HA's
    notifications for the home.
23. **mantel shows one split mail chip**: attention in tone C, FYI plain.
24. **Snooze is cut** (v1 data: never used). **Pin stays.**
25. **Remote content loads for authenticated, non-Noise senders**, with trust per domain. v1 data:
    78 senders trusted by hand in 7 weeks.
26. **Keys keep v1's muscle memory**: `E` trash, `H` Done, `P` pin.
27. **One Done gesture**; whether the email was opened tells triage if it needed attention. A
    separate "Not attention" key was too clunky.
28. **Corrections become rules only through pattern prompts**, never per-email labels.
29. **Security mail**: routine alerts cheap to check in a Security group, codes temporary, and a
    **protected** class no rule can move. v1 data: about 80 self-caused alerts, 10 codes and 6
    genuinely high-stakes ones in 120 days.
30. **Unsure triage defaults to FYI.** v1 defaulted to Attention, and attention precision fell: the
    share of attention mail Andy moved out rose from 0% in July to 74% in early October.
31. **Health is "the last check succeeded"**, thresholds from each source's schedule, four states.
32. **Settings is darma's modal.**
33. **Code may carry over where it genuinely fits**, each module reviewed with its tests.
34. **darma's stack.**
35. **v2 runs beside v1, then takes the hostname.** Carry-over as listed above. Notes is dropped
    entirely.

From design round 1's review (2026-10-07, Andy):

36. **The floating detail** goes on the side covering the fewest other items, can be dragged, and
    glides to the next item from wherever it was left.
37. **The glide keeps its ~3% bounce**, on position only (round 1's board 12c).
38. **Calendar chips are tinted**, not solid; the selected item turns solid, with no outline ring.
39. **All shows clock times** under its day headings; ages stay in the Inbox and search.
40. **FYI kinds are Career and People**, not Work and Personal, which are account names.
41. **Every row shows its account's label** beside its dot, even with the reading pane open.
42. **mantel's needs-sign-in chip is an alert**, like the finance importer's.
43. **The reading pane collapses when nothing is open.**
44. **The mark is a placeholder**; Andy picks one later. He picked Day stack (DESIGN.md #87).
45. **Light uses darma's Light tokens** exactly; round 1 guessed them.

From design round 2's review (2026-10-07, Andy):

46. **The floating detail is 280 px**, so it fits beside an item within two day columns.
47. **The glide's overshoot clamps at the grid's edges**: it never crosses into the right pane.
48. **Counts follow the rules on every board**: opening an email changes the unread counts, not the
    attention pill.
