# Setpoint v2 design

The locked design for **Setpoint v2**, Andy's private workspace for mail and time. It was written
on 2026-10-07 from Claude Design's round-2 export ([design-export/](design-export/README.md)), its
two reviews ([round 1](reviews/2026-10-07-design-round-1-review.md),
[round 2](reviews/2026-10-07-design-round-2-review.md)), and Andy's decisions in
[BRIEF.md](BRIEF.md) (1–48). The brief still owns scope, the data model, integrations and the
cutover. This file owns what's on screen and how it behaves.

## How to use this file

- **Precedence:** Andy's standing rules in `AGENTS.md`, then this file, then the export, then the
  brief's visual notes. Where the export and this file disagree, this file wins, and
  [Overrides to the export](#overrides-to-the-export) lists every known case.
- **Values:** [`design-export/styles/setpoint.css`](design-export/styles/setpoint.css) is the source
  of truth for tokens and component values, and `design-export/tokens/setpoint-tokens.json` is the
  same data parsed. The build defines tokens once in code, mirroring that file and the tables
  below; a unit test compares them, as mantel's does.
- **Visual reference:** each board in `design-export/boards/` (gallery: `design-export/index.html`)
  is the reference for anything not written here, such as exact spacing inside a card. The board
  audit (`npm run audit:boards`) sets each board beside the app's approved screenshot of the same
  state; the browser checks compare with those screenshots, not with the boards (D69).
- **Icons:** `design-export/glyphs/icons.json`, Material Symbols Rounded at weight 300 as SVG paths
  (`viewBox="0 -960 960 960"`), bundled. Never the icon font at runtime.
- **Behaviour:** the tests own behaviour once specs exist; link to them rather than restating
  numbers. This file keeps design decisions, and its timing constants are decisions the tests read
  from the token module.
- **Changing the design:** change it deliberately, in this file first, with Andy's agreement, and
  record the decision and date inline (for example "Andy, 2026-10-12").

## Principles

- **Mail and time, then News.** After 2.0, a News page too (D85). A feature that's about glancing
  belongs to mantel.
- **Providers are the truth.** Read state, events and tasks are Gmail's, iCloud's, Google
  Calendar's and Todoist's; Setpoint mirrors them and sends commands.
- **The AI sorts and pre-fills; it never adds to a list Andy trusts.**
- **Fail visibly.** Unsorted mail stays in view; a failed change stays in place with the provider's
  words; a stale source says "as of".
- **Desktop first, Linear-fast.** Design target **1677 × 1050** (the MacBook in Arc with its sidebar
  open), holding at 1728 × 1117; from 2200 px wide the whole UI is zoomed 1.25× (darma's rule).
  Every common action has a key and opens without delay.
- **No focus rings, no accessibility work.** As in darma and mantel: no focus rings or browser
  outlines anywhere, modals and popovers included; the keyboard cursor is a fill (`sub2`). Keyboard
  navigation, focus handling and restoration stay. Night and Light only; no reduced-motion,
  reduced-transparency or contrast overrides.
- **Minimal supporting text.** Only what helps Andy decide or recover.

## Vocabulary

As in [BRIEF.md › Vocabulary](BRIEF.md#vocabulary): Inbox, All, lane (Attention, FYI, Noise),
kind, Done, Unsorted, Protected, item, floating detail, proposal, Alfred, source, and in News story,
section and Missed. The **kinds** are
Deliveries, Money, Career, Security, Updates, People and Other (Career and People, not Work and
Personal, which are account names). The UI says "Done", never "handled".

## Tokens

### Colour

| Token | Night | Light | Use |
| --- | --- | --- | --- |
| `page` | `#050506` | `#f6f6f4` | app background |
| `panel` | `#08090a` | `#f1f1ee` | sidebar, group headers, Settings nav |
| `card` | `#0c0d0f` | `#ffffff` | floating detail, proposal, Answer card, prompt, attachments |
| `cardOn` | `#131417` | `#f4f4f2` | focused search, focused field, toast, collapsed group hover |
| `chip` | `#0f1013` | `#ffffff` | inputs, tags |
| `modal` | `#0c0d0f` | `#ffffff` | Settings, popovers, ⌘K |
| `ink` / `ink2` / `ink3` | `#ecebe7` / `#a3a4a8` / `#707277` | `#1d1e21` / `#56585d` / `#6d6f74` | primary / secondary / tertiary text and icons |
| `onInk` | `#050506` | `#ffffff` | text on `ink`, on the attention pill and on solid calendar chips |
| `edge` / `edgeOn` / `edgeHover` | `rgba(255,255,255,.055)` / `.12` / `.14` | `rgba(29,30,33,.1)` / `.17` / `.22` | borders / overlays, focus / under the pointer |
| `hair` | `rgba(255,255,255,.07)` | `rgba(29,30,33,.08)` | dividers, row lines, grid lines |
| `sub` / `sub2` / `sub3` / `sub4` | `rgba(255,255,255,.055)` / `.09` / `.13` / `.17` | `rgba(29,30,33,.04)` / `.07` / `.11` / `.15` | hover / keyboard cursor, open row, selection / tracks, segmented "on", a press / a ghost button pressed (#143) |
| `stripe` | `rgba(255,255,255,.045)` | `rgba(29,30,33,.05)` | hatching (drag ghosts, hidden images) |
| `scrim` | `rgba(0,0,0,.72)` | `rgba(20,26,32,.35)` | behind Settings and ⌘K |
| `caution` | `oklch(0.75 0.16 40)` | `oklch(0.535 0.16 40)` | attention pill and count, needs-reconnect bar, failing lines |
| `alert` | `oklch(0.72 0.17 25)` | `oklch(0.535 0.185 25)` | protected mail, failed changes, offline pill, destructive actions, now-line |
| `warm` | `oklch(0.8 0.11 55)` | `oklch(0.54 0.12 55)` | Business |
| `cool` | `oklch(0.8 0.11 235)` | `oklch(0.54 0.12 235)` | Personal (account and calendar), rain |
| `comf` | `oklch(0.8 0.11 165)` | `oklch(0.54 0.1 165)` | Work |
| `good` | `oklch(0.8 0.13 150)` | `oklch(0.53 0.13 150)` | the done glyph |
| `sun` | `oklch(0.86 0.16 92)` | `oklch(0.63 0.125 92)` | sun, search highlight (26% mix) |
| `violet` | `oklch(0.8 0.11 300)` | `oklch(0.54 0.14 300)` | Jobs (account and calendar) |
| `cyan` | `oklch(0.8 0.11 195)` | `oklch(0.54 0.09 195)` | Classes |
| `onAlert` | `#1a0806` | `#ffffff` | text on `alert` |

- **Accounts** (`--a-*`): Business `warm`, Personal `cool`, Work `comf`, Jobs `violet`, iCloud `ink2`.
  **Calendars** (`--c-*`): Personal `cool`, Classes `cyan`, Jobs `violet`. Both pick from darma's 11
  swatches in Settings.
- **Mixes** are `color-mix(in oklch, <colour> N%, transparent)` unless a base is named: tags
  (`alert` 10% on `chip` with a 40% edge; `caution` 12% with a 35% edge), the needs-reconnect bar
  (`caution` 9% on `page`, 22% bottom edge), calendar tint `--evtint` (Night 16%, Light 12%),
  deepening under the pointer by `--evhover` (Night 18%, Light 14%) laid over it in the chip's own
  colour, and by 28% while pressed (#145).
- **Shadows:** popovers and the floating detail `0 18px 50px rgba(0,0,0,.4)` (Light
  `rgba(15,20,28,.14)`); modals `0 30px 80px rgba(0,0,0,.35)` (Light `.18`); pills and toasts
  `0 10px 30px rgba(0,0,0,.3)` (Light `.14`). Shadows only on overlays.
- **Scrollbars:** darma's (mantel's thin dark scrollbar; Light thumb `rgba(29,30,33,.22)`).

### Type

Geist with `font-feature-settings: "ss01"`; tabular figures on times, counts, ages and codes; Geist
Mono for codes, ntfy topics and identifiers. Bundled, never loaded from the network. Base **13 / 1.35**.

| Role | Size / weight / tracking |
| --- | --- |
| Reader subject | 20 / 500 / −.01em, line height 1.25 |
| Header title | 15 / 500 / −.005em |
| Setpoint's name | 14 / 600 / −.01em |
| Email body (plain text) | 14, line height 1.55, max 600 px |
| Rows, nav, menus, buttons, facts | 13 (unread sender and subject 500) |
| Segmented control, reader tools, small buttons, summaries in Attention | 12.5 |
| Ages, counts, account labels, calendar chips | 12 (chips 500) |
| Group headers, section labels, weekday names | 11.5 / uppercase / .08em |
| Keyboard hints | 11 / 500 |
| Verification codes | Geist Mono 13 / 500 / .06em |

On the phone the list reads a step up, as the reader's body (15) does: rows 15; ages, counts and
account labels 13; summaries in Attention 13.5; group headers 12; search's rows the same
([Decided while building](#decided-while-building) #262).

### Shape

| Radius | Elements |
| --- | --- |
| 999 | buttons, chips, tags, pills, icon buttons, toggles, avatars, day numbers |
| 26 | modals (Settings) |
| 18 | popovers, ⌘K, the floating detail, cards (proposal, Answer) |
| 14 | the pattern prompt, attachments, the email frame |
| 12 | the images-hidden bar |
| 10 | nav items, account rows, menu items, fields, search, calendar rows, segmented outer |
| 8 | segmented inner |
| 6 | calendar chips and tasks |
| 5 | keyboard hints |

### Motion

mantel's timings: **120 ms** hover and fills, **180 ms** popovers and panes, **260 ms** modals, all
`cubic-bezier(.2,0,0,1)`. The floating detail has its own motion ([The glide](#the-glide)). A lifted
calendar chip tilts −1.5° and scales 1.04. Theme switches fade every colour over 180 ms; the first
paint doesn't fade. A press goes in over **80 ms** and lets go over 120 ms (#143).

Overlays arrive on these timings ([Decided while building](#decided-while-building) #141): every
menu and popover grows from its anchor's corner (4 px and .97, 180 ms), the "+N" popover from its
"+N", and a card anchored to a calendar item opens as the floating detail does; ⌘K rises 6 px over
180 ms and Settings 8 px over 260 ms, their scrims fading in; a pane's content, and the editor however
it's opened, slides in 12 px over 180 ms; Alfred's Answer card and a proposal slide down 6 px, and
fold away when closed. ⌘K, Settings and the "+N" popover fade out over 120 ms; menus close at once.

## Glyphs, icons and the mark

- **Icons:** Material Symbols Rounded, weight 300, FILL 0 (the `-fill` files are FILL 1 uses), as SVG
  masks from `glyphs/icons.json`. One size per role (#164): 18 in the sidebar, rows, the reader's and
  the story pane's tools and 30 px icon buttons; 17 beside a label in a button (Add, More options,
  the reader's actions) and in facts; 16 in small buttons, menus and inline links; 14 in chips and
  tags. A card's or popover's ×, and Add, in a 26 px icon button are 16; × is 18 only in a 30 px
  header button (Settings', the editor's). One glyph per meaning: account trouble `sync_problem` (sidebar, Settings › Accounts and its rows, the
  Inbox's bar), a failing News feed `warning`, Try again and Retry now `refresh`, Mark all as read
  `mark_email_read`, a Settings page its nav's glyph wherever it's named.
- **Todoist glyphs** (`glyphs/task-open.svg`, `task-done.svg`): open is a 13 px ring, 1.5 px `ink3`
  stroke (12 px, `ink2` on the grid); done is darma's filled disc with the check knocked out, in
  **`good`**, title struck through in `ink3`.
- **Unread:** a 6 px `ink` dot in a 12 px gutter at the row's start; unread sender and subject are
  `ink` at 500, read are `ink2` at 400.
- **The mark** is **Day stack** (decision 44, #87): three calendar chips stacked, `cool` on top,
  `caution` lifted and tilted −6° in the middle, a shorter `violet` below. A bare 18 px glyph before
  the name, no tile, in the theme's tokens; they are the brand's and stay put when an account or
  calendar is recoloured. Never show it beside the pending spinner.
- **Favicon:** `favicon.svg` (the mark on darma's 32 px `card` tile, radius 7, with an `edgeOn`
  border, in Night's colours), 16 and 32 px PNGs (the 16 px one redrawn on its pixel grid: the middle
  chip level, set apart by the wider gap above it) and a 180 px square `apple-touch-icon`; no web
  manifest.

## Layout

### Shell

- **Sidebar** 248 px, `panel`, `edge` right border, padding 12 / 10:
  - the mark and **Setpoint** (36 px row, 8 px below). No search button: search lives in each
    page's header.
  - **Inbox** (32 px nav item, radius 10, `sub` hover, `sub2` current): the **attention pill** (18 px,
    `caution` fill, `onInk` 11.5 / 600 text; not-Done attention, read or not) then the unread count
    (`ink3` 12).
  - **Accounts** under Inbox (28 px, indented 34 px): colour dot (8 px), label, unread count. A click
    filters the Inbox to that account; a needs-reconnect account adds a `sync_problem` glyph in
    `caution` before its count, keeping the count.
  - **Calendar**.
  - **The page's section** (18 px above, 11.5 uppercase label): **Today** on mail pages, the
    mini-month and **Calendars** on Calendar.
  - **Settings**, pinned to the bottom, with its ⌘, hint.
- **Header** 56 px, `hair` bottom border, padding 0 16 0 24: title (15 / 500), the segmented control
  (28 px; Unread | All on mail, Month | Week on Calendar), a spacer, then **search** (mail: a 380 × 32
  field with its `/` hint; Calendar: a 30 px icon button) and the primary action (Calendar: **New**
  with its `C` hint).
- **Content** under the header; the list or grid scrolls, the shell never does.
- **Panes** sit under the header with a `hair` left border: the **reading pane** 680 px, Calendar's
  **right pane** 400 px. The reading pane collapses when nothing is open (decision 43).
- **Tab title:** "(3) Inbox" while attention mail is waiting, the subject when an email is open,
  "October 2026 · Calendar".

### Compact (640 to 1099 px)

An iPad or a half-width window keeps the shell's parts and stops squeezing them
([Decided while building](#decided-while-building) #258):

- **Rail:** the sidebar is a 56 px rail: the mark, then Inbox, Calendar, News and Settings as 40 × 40
  icons, each named in its tooltip. Inbox's attention pill is a 16 px badge on its icon (2 px from its
  top, 2 px past its right, 10.5 / 600, a 2 px `panel` ring). The accounts, the Today block, the
  mini-month and Calendars give way; ⌘K filters the Inbox by account ("Inbox · Jobs") and shows or
  hides each calendar.
- **Reading pane and story pane:** an open email or story covers the list under the header, its tools
  led by Back (`arrow_back`, "Back · Esc"); Esc, J / K and ↑ ↓ work as beside the list, and the edge
  doesn't drag.
- **Calendar:** the grid, month or week, takes the width. The right pane lies over its right side (400
  px, `page`, an `edgeOn` left edge and the popover shadow, in 24 px over 180 ms) while it holds the
  editor or search; the day's pane isn't drawn, and its sources' health lines sit atop the grid. The
  floating detail floats over the pane.
- **Header:** gaps 10; the search field narrows first (from 380, 520 while searching), then a calendar
  title longer than its 128 px ends in "…".

### The Today block (mail pages)

28 px rows: the next event ("2:30 PM  Dentist", time in `ink`, 58 px wide, "in 5h" right in `ink3`),
then each open task due today and tomorrow by name, today's first, behind its ring in its project's
colour, with "Tomorrow" right in `ink3` on tomorrow's. More than three tasks show the first two and
"3 more due tomorrow" (`ink3`), which shows the rest. Confirmed data only; nothing shows for an empty
line.

A line opens the floating detail's card (without its grip) 8 px right of the sidebar, its title
level with the line, over the page, which stays as it was; the line turns `sub2`. **Edit E** opens
Calendar's editor on the item; a task's ring, or Complete on its card, completes it in place with
"Completed Pay rent · Undo": its done check lands and its title is struck through for 360 ms, then
the line folds away over 180 ms, and Undo folds it back
([Decided while building](#decided-while-building) #106); an item that isn't a repeating event
deletes; **Open in Calendar** shows it there with its card. Clone, Copy and Colour stay on Calendar.
Esc, × or a click elsewhere closes it; another line moves it there (#78).

## Mail

### The list

- **Group header** 30 px, `panel`, `hair` above and below (none above the first), its group's 14 px
  glyph in `ink3` 8 px before the label (Pinned `keep`, Attention `flag` in `caution`, Unsorted
  `pending`, Security `lock`, Deliveries `local_shipping`, Money `payments`, Career `work`, People
  `person`, Updates `notifications`, Other `mail`, Noise `campaign`; #160), 11.5 uppercase
  .08em `ink3`, count in `ink2` (Attention's in `caution`). A collapsed group adds the first three
  organisations in `ink3` ("Wingtip Toys · Consolidated Messenger · Southridge Video") and a chevron, and hovers `cardOn`. Every group
  starts expanded in Unread, Noise too; one Andy collapses stays so for the session (#84).
- **Order:** Pinned (only with pins), Attention, Unsorted (only when triage is down), Security,
  Deliveries, Money, Career, People, Updates, Other, Noise. Empty groups are left out. Collapsed,
  Noise is a count.
- **Row** 38 px, padding 0 16 0 12: unread gutter (12), sender or organisation (172, ellipsis),
  subject then " · " and the summary in `ink3` (ellipsis), the **account** (dot and label in `ink3`
  12, 76 px, on every row and never dropped, decision 41), the age (64, right, `ink3` 12). Hover
  `sub`; the keyboard cursor and the open email `sub2`. Other chips drop while the reading pane is
  open; the account never does.
- **Attention row** (a three-line grid, padding 9 16 10 12, `hair` between rows): line 1 the sender
  (with "via Greenhouse" in `ink3`, the **Protected** tag when protected), account and age at the end;
  line 2 the subject (`ink` when unread; **`alert` 500 when protected**); line 3 the summary (`ink3`
  12.5). Read-but-not-Done rows lose the dot and stay.
- **Security row:** the organisation, then the extracted fact as the subject ("**New sign-in** ·
  MacBook Pro · Los Angeles"). A **code** row shows the code (Geist Mono, two groups of three), a
  **Copy** button and "Expires in 11 min" in `ink3`; it leaves the Inbox 15 minutes after arrival
  (Settings › Mail sets this). A copy the browser refuses says "Couldn't copy it"
  ([Decided while building](#decided-while-building) #109).
- **Pinned** rows sit on a shelf at the top, as rows at any count, with a `keep` glyph; a pinned
  email's line is its subject and summary.
- **Footer:** "Mark all as read ⇧I" at the end of the list, after a 16 px `mark_email_read` (#164).
- **Empty:** "All caught up" with "Open All" (board 04); the reading pane collapses.

### All

The header's **All**. Every email, Noise included, newest first, under day headings ("TODAY Wed,
Oct 7", "YESTERDAY Tue, Oct 6", "MON Oct 5"), with **clock times**, not ages (decision 39). Each day
groups its rows by lane, and the kind shows once, in a left column, where an FYI run starts, after
its group's glyph at 13 px (#160); each
day's Noise folds to one line ([Decided while building](#decided-while-building) #48). Pinned
email sits on Unread's Pinned shelf above the first day, with ages and Unpin under the pointer, and
leaves its day until it's unpinned (#101).

Going to the Inbox from another page, or opening the app at its bare address, opens Unread while
anything waits there and All when Unread would say "All caught up" (#102).

### The reader

- **Tools** (48 px, `hair` below): Done `H` (on Attention mail not yet Done, #93), Trash `E`, Pin
  `P`, Open in Gmail `O` (each a 30 px pill with its key hint), then previous and next and More. Reply has a reserved place after Open in
  Gmail, empty until reply exists. In a pane under 600 px the key hints drop and the labels stay
  ([Decided while building](#decided-while-building) #107).
- **Head** (padding 20 28 16): the subject (20 / 500), then a 32 px avatar, the sender's name, " ·
  organisation · via platform" in `ink2`, "to you", and on the right the account (dot and label) and
  the clock time, with the date before it on older mail
  ([Decided while building](#decided-while-building) #88).
- **Actions** (28 px outline buttons): **Add to calendar**, **Add as task**, **Ask about this email**.
  Security mail has no Add to calendar; it shows the **facts card** instead (board 03: what happened,
  when, device, location, "not a place you use" in `alert`), and protected mail says "Protected ·
  always stays in Attention".
  On Security and Noise mail, Add to calendar and Add as task move into the tools' **More** menu
  ([Decided while building](#decided-while-building) #4).
- **Body:** plain text at 14 / 1.55, max 600 px; HTML in a sandboxed frame as wide as the reading
  pane and as tall as the email, with radius 14 on white
  ([Decided while building](#decided-while-building) #77).
- **Images:** remote content loads for a sender that passes DMARC and isn't Noise. Otherwise the
  **images-hidden bar** (34 px, radius 12, `sub`): "Images hidden · Show · Always show from
  contosocoffee.example" (trust per domain).
- **Attachments:** 44 px cards (radius 14, 280 wide, wider to show the whole name, #61) with the
  type's tile (#163), name and size, then the preview's eye and **Download** with its glyph; PDF,
  image and CSV open a preview.

### Search

- `/` or ⌘F focuses the header field (focused: `edgeOn` border, `cardOn` fill). Results replace the
  list; the reading pane and `J` / `K` work the same.
- Recognised words become **chips** in the field (22 px, `sub2`), each with a small label in `ink3`
  and an ×: "Org Northwind ×", "Type Rejection ×", "Date Mar 2026 ×", plus account and kind. One
  case style: the label capitalised.
- **"!" before a word leaves out what it names** (#85): one that forms a chip gives a **Not** chip
  ("Not Type Confirmation ×"); one that doesn't stays in the field as typed ("!proseware") and leaves
  out the mail that has it.
- A results line: "2 results · newest first". Each result shows why it matched ("Org Northwind ·
  Type Rejection", `ink3` 12) and highlights matches (`sun` at 26%).
- The first row offers **Ask Alfred ⌘Enter**, above the results line, as board 06 draws it
  ([Decided while building](#decided-while-building) #80).
- No results: "No emails match **Northwind · Rejection · Mar 2026**", each chip removable, after a 20
  px `search_off` (#165).

### Alfred's Answer card

A `card` above the results (board 07): Alfred's one or two lines, the **sources** (rows that open
in the reading pane), each follow-up turn below the last, and a follow-up field at the bottom. From
the reader, **Ask about this email** opens the same card scoped to that email. "Couldn't find that
in your mail" says what it searched. While Alfred works, its line says what it's doing; more than
five sources show the first five and **Show all** ([Decided while building](#decided-while-building)
#80). About one email, its first line is "Reading this email…", and the follow-up field waits at
half strength until the answer is in (#108).

### Proposal

**Add to calendar** and **Add as task** open a proposal card at the top of the reading pane (board
08): the fields pre-filled from the email, each marked "from the email", the conflict line ("Free
that evening" or "Overlaps …"), **Create**, and **More options**, which opens the full editor in
Calendar. Nothing is created until Andy creates it. The day and times take typing as the editor's
do, blank ("Pick a day") when the email gave none; once they change, the mark and the conflict line
go. A task's card has no Place, and its Project suggests Todoist's projects as Andy types, making a
new one only when he picks **New project** ([Decided while building](#decided-while-building) #26).

### Pattern prompt

One `card` line at the end of Attention (board 09, radius 14, `edgeOn`): "You've cleared 4 Northwind
newsletters without opening them. Send these to FYI from now on?" with **Yes** and **No**. Never
offered for protected mail.

## Calendar

### Month grid

- **Weekday row** 30 px, 11.5 uppercase. **Columns** 147 px at the design target, **rows** 176. Cells
  have `hair` right and bottom lines; days outside the month take `panel` at 60%, weekends at 40%,
  the selected day `sub`.
- **Day head** 22 px: the number (12.5, `ink2`; today a 22 px `ink` disc with `onInk` 600; "Oct 1"
  and "Nov 1" at 500), and the weather icon at the end (16 px: sun `sun`, cloud `ink2`, rain `cool`).
- **Events** are **tinted chips** (decision 38): 20 px, radius 6, the calendar colour as text (12 /
  500, the time at 400 and .8), a 3 px inset left bar, and the colour at `--evtint` as fill. The
  **selected item turns solid** (colour fill, `onInk` text, no bar) and is the only selection mark: no
  outline ring. **Past** items are at .55 opacity. Titles end in "…".
- **Tasks:** the ring or done glyph and the title in `ink` 12; hover and selected `sub2`.
- **Overflow:** what doesn't fit folds into "+3" (`ink3` 12) on a chip's footprint (20 px, radius 6,
  the count lined up with the chips' titles, `sub` and `ink2` under the pointer), then up to three
  6 px dots 3 px apart for the first items it folds: an event's filled in its colour, a task's a
  1.5 px ring in its project's (#146). Its popover lists the day's every item (board 11b) and closes
  with Esc.
- Infinite vertical scroll through months.

### Sidebar on Calendar

The **mini-month** (26 px day cells; today an `ink` disc; the visible week or selected day `sub`; no
other marks) with ‹ › stepping. **Calendars:** 30 px rows, a 14 px checkbox in the calendar's colour
on the left (off: an outline), the name; **Todoist** has the same checkbox with its ring glyph as its
mark. With every calendar off, a 16 px `ink3` `visibility_off` follows the header's title (#113).

### Right pane

Default: the selected day (board 11): the date, its weather ("Sunny · 78° / 61°"), **Events** (time,
a 3 px colour bar, title, "7:00 – 8:00 AM · Personal", always the calendar; the place on its own
line in `ink3` 12.5 after a 16 px `location_on`, or `videocam` and the host, "zoom.us", for a link,
#166; recurring glyph; "in 5h" on the next; "Leave
by 2:05 PM · 18 min" for Time to Leave, `caution` from 15 minutes before it until the event starts,
then gone, #112), the **now-line** in `alert` with the time, then **Tasks · due today** with their
projects. A day whose items are only hidden reads "4 hidden · Show all" (#113). The footer holds "New event C · New task D". The pane also holds the
editor and calendar search results.

### The floating detail

- **Card:** 280 px wide (decision 46), `card`, radius 18, `edgeOn` inset, popover shadow, a drag grip
  at the top. Content (board 12a): colour dot and title, date and time, place and address, Time to
  Leave (as the right pane's, #112), attendees, a recurring event's repeat ("Weekly on Mon, Wed,
  Fri", #167), reminder, calendar (its glyph in the item's colour, #167); then **Edit E** and icon
  actions (duplicate, copy, colour, delete).
- **Placement:** 8 px off its item, on the side (right, left, above, below; right first) covering the
  fewest other items, inside the month grid. This applies to every overlay anchored to a calendar
  item, including the recurring-drop prompt.
- **Drag:** the card lifts from its grip (shadow deepens), follows the pointer 1:1, and stays where
  it's dropped. The next click on an item glides it **from where it was left** to its new anchor
  (board 12d).
- **Edit** (`E` or the button) hands the item to the right pane's editor: the card shrinks and fades
  toward the pane over 220 ms while the editor slides in 12 px.
- **Open and close:** open 180 ms, scale .96 → 1 with a fade from the anchor; close 120 ms, scale
  → .98 with a fade toward it, on Esc or a click on empty grid.

#### The glide

Clicking another item while the card is open moves the **same card** to it. From
`design-export/motion/glide.json`:

| Track | Value |
| --- | --- |
| Position | FLIP translate, `cubic-bezier(.22, 1.3, .36, 1)` (about 3% overshoot, position only) |
| Duration | `min(380, 280 + 40 × distance / 400)` ms (454 px → 325, 1,000 → 380) |
| Edges | the overshoot never crosses the grid's edge: near an edge it shrinks to the room left (decision 47) |
| Height | 220 ms, `cubic-bezier(.2,0,0,1)` |
| Old content | fades out 0–120 ms (override 30) |
| New content | fades in 70–220 ms with a 6 px slide in the direction of travel, crossfading with the old (override 30) |
| Selection | the new item turns solid at 60 ms; the old one goes back to tinted at 0 |
| Interruption | a click mid-glide retargets from the current position and velocity: no restart, no close |

The card's side is chosen first and may flip on landing (board 12c).

### Editor

In the right pane (board 13): the **title field** parses as you type ("Dinner with Sam fri 7-9pm
@Blue Door" → date, time and end, place, calendar, each parsed token marked; a line longer than the
field shows where it's typed, the cut side fading, #110), **Places**
suggestions under the place, the calendar picker, recurrence, reminders (default from Settings ›
Notifications) with **Time to Leave** added from the same menu, never by default (#86), and the
**conflict preview** (a small timeline of the day: "Overlaps Study group ·
1h 30m"). **Batch drafts** add a second event ("Create 2 events ⌘Enter"). A Todoist task uses the same
editor with project, labels and due date.

### Recurring events

Editing (board 14) or dropping (board 15b) one occurrence of a recurring event asks **This event**
(default), **This and following** or **All events**, each with its consequence ("Thu, Oct 8 only",
"Wed → Thu from Oct 7 on", "Wed → Thu, past ones too"), with Move or Save ↵ and Cancel Esc. While a
drop waits, the origin shows as a dashed ghost and the agenda says "Moving to Thu, Oct 8".

### Drag

A dragged chip lifts (tilt −1.5°, scale 1.04, popover shadow), its origin becomes a dashed ghost in
its colour, and a tooltip names the target day and time (board 15). Tasks move by whole day.

### Week view

Board 16, Sunday-first (override 16), built before 2.0 at Andy's ask with resizing in it
([Decided while building](#decided-while-building) #81; darma SV-18 D64).

- **Header:** "Oct 4 – 10, 2026" (min 128 px; "Sep 27 – Oct 3, 2026" across months, "Dec 27,
  2026 – Jan 2, 2027" across years), ‹ Today › paging a week, Month | Week. Tab "Oct 4 – 10, 2026 ·
  Calendar". `M` and `W` switch; Week opens on the selected day's week, Month on its month. The view
  rides in the address (`?view=week`) and the last one used is remembered, so Calendar, `2` and links
  open in it.
- **Layout:** a 56 px gutter, then seven columns filling the width (139 px at the design target,
  down to about 90 with titles cut). The **day heads** (48 px) and the **all-day row** stay put while
  the hours scroll under them. The right pane stays.
- **Day head:** the weekday (11.5 uppercase `ink3`), the date (today the 22 px `ink` disc), the
  weather icon. A click selects the day.
- **All-day row:** all-day events as tinted bars spanning their days, then each day's tasks (a timed
  one prefixed "9:00 AM"), 20 px lines 2 px apart, at least two lines and at most three: a day with
  more shows two and "+N", which opens the day's popover (board 11b). An event of 24 h or more is a
  bar here too.
- **Hours:** all 24, 44 px each, `hair` lines, the gutter's labels in `ink3` 11. Weekends take
  `panel` at 40%, the **selected day's column `sub`** (today by default, so board 16 reads the same),
  and today's column the **now-line** (1.5 px `alert`, an 8 px dot at its start, the time in the
  gutter in `alert` 500).
- **Opening scroll:** this week puts the now-line about a third down; another week an hour before
  its first timed item, else 7 AM. Paging keeps the scroll.
- **Blocks:** the month chip's tint, bar and colours (`.wb` in board 16): the title at 500, the time
  under it at 400 and .8; at least 20 px; under 50 minutes (no room for a second line) the time follows the title on one
  line ("Standup, 9:00 AM"), and the place shows under the time where a whole line is left for it; in a
  lane a block gives its start alone, as a month chip does ("7 PM"), and one with room for four
  lines wraps its title to two; no line is drawn cut off; titles end in "…" (override 10). Selected solid, past .55, pending .5 with
  the spinner, failed outlined in `alert`. An event crossing midnight draws in both days.
- **Overlaps:** each run of overlapping events shares its column in up to three equal lanes; a
  fourth or more folds into "+N" at the run's top, opening the day's popover.
- **Paging:** ← → or `P` `N` a week, `T` today; the grid slides 24 px and fades over 180 ms in the
  direction of travel. A two-finger horizontal swipe pages too. The mini-month marks the shown week
  (`sub`, board 16); a day picked there shows its week and selects it.
- **A click** on an empty slot or a day head selects the day; with a new draft open it moves the
  draft to that day and, on a slot, that time (keeping its length), unless its line names them (#47).
  A click never creates on its own.
- **Create:** press on an empty slot and drag: a dashed ghost in the default calendar's colour, "New
  event" and its range, in 15-minute steps; letting go opens the editor in the right pane with that
  day and range, the title focused. Dragging across days in the all-day row makes an all-day event
  over them. Esc while dragging cancels.
- **Move:** the month's lift, ghost and tooltip ("Thu, Oct 8 · 2:30 PM"), 15-minute steps, any day of
  the week; held at the grid's left or right edge it pages a week, at its top or bottom it scrolls.
  Timed stays timed and all-day stays all-day; tasks move by whole day in the all-day row. "Moved
  Dentist to Thu, Oct 8, 3:00 PM · Undo".
- **Resize:** a block's top edge moves its start, its bottom edge its end (the outer 5 px; under 30
  minutes only the bottom), in 15-minute steps, never under 15 minutes, the tooltip giving the new
  range; an all-day bar's ends change its first and last day. "Changed Dentist to 2:30 – 4:00 PM ·
  Undo". Tasks and Google's own kinds of event don't resize.
- **The same as month:** the floating detail and its glide (inside the week, on the side covering
  the fewest blocks, moving with its block as the hours scroll), the recurring prompt on a drop or
  resize, the failed card, multi-select, Clone, Copy, Paste (the copied time on the selected day),
  Colour, Delete, ⌘Z.
- **States:** the grid, heads and hours draw at once and blocks fade in (120 ms) as they arrive; an
  empty week draws nothing more (the agenda says "No events · New event"); a failing source's line
  sits atop the right pane (#62), and offline dims the grid.
- **Labels:** each block reads "Dentist, Wed, Oct 7, 2:30 – 3:30 PM, Personal" to assistive tech, the
  hours are a labelled region, the arrows "Previous week" and "Next week". No focus rings
  (Principles).
- **Phone:** unchanged, the read-only agenda; no Month | Week.

## News (after 2.0)

[BRIEF.md › News](BRIEF.md#news-after-20) owns what News covers, how stories are made and ranked,
and its sources and cost (darma D85–D91). The screen comes from design round 3:
[design-export/news/](design-export/news/README.md), boards 25–31, drawn 2026-10-10 and reviewed by
Andy (darma SV-43). News is built after 2.0, desktop only. Below 640 px it isn't in the
navigation.

### Shell

- **Sidebar:** a **News** item (`newspaper`) under Calendar, with **no count, ever** (D87). The lower
  section shows **Today**, as on mail pages.
- **Header:** "News"; the segmented control **All | Local | Tech | AI | General**; a spacer; the
  380 × 32 search field, "Search news" with its `/` hint. There's no primary action.
- **Content:** the list on the left. The **story pane** sits where the reading pane does (680 px,
  `hair` left border) and collapses when nothing is open.
- **Tab title:** "News", or the open story's headline.

### The list

- **Section header** (32 px): mail's group header without a count (`panel`, `hair` above and below,
  none above the first; 11.5 uppercase .08em), its label in `ink2` after the section's 14 px glyph
  in `ink3` (Local `location_on`, Tech `computer`, AI `auto_awesome`, General `public`; #161).
  - In All, the blocks come in a fixed order: Local, Tech, AI, General. A story in more than one
    section shows once, in its main section's block (#96).
  - Each block shows its **top 3–5 stories, biggest first**, then "12 more in Local". That's a 36 px
    link in `ink2` 12.5 with a chevron, and it opens the section.
- **Lead story** (each block's first; also the first of a section's list and of each Missed day):
  - Layout: a grid of 12 | 232 | text, 14 apart, padding 14 16 14 12, `hair` below.
  - Image: 232 × 130 px, radius 12.
  - Text: the headline 16 / 500 `ink` at 1.35; the summary `ink3` 13 / 1.45, clamped to two lines;
    the meta line at the foot.
- **Story row:**
  - Layout: a grid of 12 | 1fr | meta | 72, 12 apart, padding 9 16 9 12, `hair` below.
  - The headline: 13, `ink` 500 when new or updated, `ink2` 400 once seen.
  - Under it, the summary in `ink3` 12.5, one line, ellipsis.
  - The meta, right-aligned on two lines: the leading outlet and "+N" in `ink2` 12, then the age in
    `ink3` 12, or "Updated 7:55 AM" in `cool`.
  - The thumbnail: 72 × 48, radius 8. A story without an image leaves the column empty, never a
    placeholder, except one led by a hazard source (NWS, USGS, Cal Fire, AirNow): its hazard's 22 px
    glyph in `caution` on a 72 × 48 tile, radius 8, `caution` at 10% with a 22% inset ring (#162).
  - A lead without an image led by a hazard source puts its hazard's 18 px glyph in `caution` before
    the headline, rather than a large empty tile (#162).
- **The dot** (6 px in the 12 px gutter): `ink` for **new**, as unread mail; `cool` for
  **updated**; none once seen, from the next visit (#95). Hover is `sub`; the keyboard cursor and
  the open story are `sub2`.
- **Meta copy:** "KTLA +4 · 1h · Updated 8:40 AM". Ages follow [Copy](#copy). Missed rows lead with
  the section, the story's main one (#96): "General · NPR +9 · Tue".
- **Images:** Setpoint's own resized copy, cropped to fill (`object-fit: cover`). The boards draw
  tinted placeholders instead.
- **Upcoming** (Tech, under its header): a 46 px row with:
  - a 26 px `event` tile, `violet` on `violet` at 16%, radius 8
  - the label "UPCOMING" (11.5 uppercase `ink3`)
  - "**Apple event** · Tue Oct 20 · 10 AM", with the name `ink` 500
  - the outlet meta
  - an outline small **Add to calendar** button, which opens a proposal in Calendar's editor, as an
    email's does
  - When the story pane leaves the list under 600 px, the label and outlet drop and name · date
    takes an ellipsis; the leads' images shrink to 160 × 90 (#99).
  - The row opens a popover with the story that announced the keynote, which opens that story
    (#100).
- **Missed strip** (D92), at the top of All only while Missed holds stories:
  - 46 px, padding 0 12 0 22, `cool` at 9% over `page`, with a `cool` 22% hairline below.
  - A `cool` `history` icon, then "**14 stories** you missed since Mon" in `ink`, then a solid small
    **Catch up** button.
- **New-stories pill:**
  - A 32 px pill centred 10 px below the list's top (under the Missed strip when there is one):
    `cardOn`, an `edgeOn` ring, the pill shadow.
  - It shows `arrow_upward`, "3 new · 1 updated" (the updated count in `cool`) and the `N` hint.
  - A click or `N` re-sorts the list and scrolls it to the top.
- **A section with nothing new:** one 44 px line in `ink3`, "Nothing new in Tech since Mon", only
  when its own list is empty too. A block whose stories all show in other blocks (#96) has just its
  "2 more in Tech" link (#116).

### The story pane

- **Tools** (48 px): **Open at KTLA** `O` (the leading outlet's article), then a spacer, previous,
  next and More.
- **Head** (padding 18 28 14):
  - its sections as tags, each with its section's 14 px glyph in `ink3` (#161), plus "Updated" as a
    `cool` tag when it changed since Andy last looked
  - the headline (20 / 500)
  - the meta in `ink3` 12.5: "5 outlets · first reported 6:12 AM · updated 8:40 AM"
- **Image:** inset 28 px, 220 tall, radius 14. The outlet's name sits in a caption pill at the
  bottom left (11, `ink2` on `page` at 72%).
- **Body** (padding 18 28 24, 18 apart), from the top:
  - **New since you looked**, only on a story updated since Andy's last look: a card (radius 14,
    `cool` at 8% over `card`, `cool` 24% ring). It has the label "New since you looked · Mon 10:40
    PM" (11.5 uppercase `cool`) and one line per new fact: its time (60 px, `ink2` 12.5), then the
    fact in `ink`.
  - The summary (14 / 1.6, `ink`, max 600), in the body's one 600 px column (#98).
  - The **Sources** label with its count, then the outlets in a `sub` group, radius 14. Each row is
    at least 52 px:
    - a 26 px badge with the outlet's initials (`sub2`, radius 8)
    - the outlet's name (`ink` 12.5 / 500), with a "Summary only" tag when its page can't be read
      in-app
    - the outlet's own headline (`ink2` 12.5, ellipsis)
    - the age (`ink3` 12) and a chevron
  - A metered paper is never listed (D89).
- **An article** (board 26a): a source opens in the same pane.
  - Tools: **Back to story** `Esc`, then a spacer and **Open at NBC Los Angeles** `O`.
  - Head: a 22 px outlet badge, the outlet, the time and the byline; then the outlet's headline (20
    / 500).
  - The image (240 tall), then the extracted text at 14.5 / 1.6, max 600: its paragraphs and list
    items, without the outlet's membership appeals (#114).
- **An article that can't be read in-app** (board 26b):
  - A note (radius 12, `sub`, `info`): "KTLA's page can't be read here, so this is its feed
    summary", with a solid small **Read at KTLA**.
  - Then the feed summary, and **Also in this story**, listing the other sources.

### Missed

Board 28 replaces All's list.
- **Back row** (44 px): the back arrow (back to All), "Missed since Mon 10:40 PM" (14 / 500), and
  the count in `ink3` on the right.
- **Day headers** are section headers ("TUESDAY", with "Oct 6" on the right), on `history` (#161).
- Under each day, up to 5 stories per section, biggest first, the first as a lead. Each row names
  its section in the meta. A lead's image is its story's large copy, kept while the story is in
  Missed, never its thumbnail stretched (#115).
- A story leaves Missed once it's seen, but the list holds for the visit, as All's order does: rows
  seen while it's open keep their places. Back in All, the strip is gone once Missed is empty, and
  Missed opened with nothing in it is All (#117).

### States

- **AI down** (29a): a failing line at the top of the list (32 px, `caution` 12.5): "12 articles not
  sorted yet, Anthropic unreachable since 8:52 AM, retrying". A ghost small **Show headlines**
  lists the raw headlines with their links.
- **A stale section:** the muted line under its header, "AI, as of 7:02 AM". Its stories stay.
- **A failing feed** shows only in Settings › News, unless its whole section is affected (BRIEF ›
  When things break).
- **First run** (29b):
  - The muted line "Sorting the last 48 hours · 186 of 312 articles · showing what's sorted so
    far".
  - No Missed strip.
  - A section with nothing yet says "Nothing sorted in AI yet".
- **Offline:** as everywhere, the pill and the dimmed page.

### News in Settings

- The nav adds **News** (`newspaper`) between Mail and AI. While a feed fails, it carries the
  `caution` warning glyph.
- **News** (board 30a): the header shows "312 articles today · 41 stories" in `ink3`. Then one group
  per section, with its count.
  - Rows are 44 px: an icon tile; the source's name with what's read ("Feed, Local News only");
    how often ("Every 15 min"); and its state, as on Accounts ("Checked 9:10 AM", or "Failing, 404
    since 6:02 AM" in `caution` on a `caution` 7% row).
  - Read-only: no handles, no switches, until the tuning round.
- **AI** (board 30b) adds a **News** group:
  - **Articles and grouping** (Claude Haiku 5.5) and **Stories and ranking** (Claude Sonnet 5.5)
  - **Monthly cap** ($40)
  - **This month**: a 160 × 6 meter, then "$18.40 of $40"
  - **Usage this month** lists Triage, Alfred and News, with News broken into articles, grouping,
    stories and ranking.

### Keys and behaviour

- **Keys:** `3` News; `J` / `K` move; Enter opens the story; `O` opens the original article; `N`
  takes the new stories; Esc goes from an article back to its story, then closes the pane.
- **Seen:** a row fully on screen for about a second, or opened. Stories behind "N more" stay new
  until their section shows them. No "mark all seen" (D87).
- **The order holds** while the page is open. A story on screen updates its dot, sources and
  summary in place; everything else waits for the pill.
- **Thumbnails** are Setpoint's copies and expire with their story. Never an AI-generated image.

## ⌘K

The palette (board 20, about 637 px wide, radius 18) runs commands, not search. On an open email it
lists **This email** (Done H on Attention mail, Trash E, Pin P, Open in Gmail O, Add to calendar, Add as task, Ask about
this email, Mark unread), **Go to** (Inbox 1, Calendar 2, News 3 after 2.0, Settings ⌘,) and **Appearance** (System,
Light, Night, the current one ticked). As in darma, typing also finds every other command that has a
key (New event, New task, Mark all as read).

## Settings

A **1040 × 720 modal** (radius 26, modal shadow, `scrim` behind), not in the address bar, with a
**220 px nav** on `panel`. Rows are 52 px minimum inside `sub` groups of radius 16; switches are 34 ×
20. A reconnect link opens it at Accounts.

- **Nav:** Accounts, Calendar, Todoist, Notifications, Mail, News (after 2.0, [News in Settings](#news-in-settings)), AI, Appearance, Security.
- **Accounts** (board 17): **Connect Gmail** and **Connect iCloud**; under **Mail**, each account with
  drag handle, icon, label, address, how it syncs ("Gmail · Push", "iCloud · IMAP every 2 min") and
  its state: "Checked 9:11 AM" when healthy, "Checks stopped, as of 9:14 PM" muted when stale, "Needs
  sign-in" in `caution` with **Reconnect**; under **Sources**, Google Calendar ("Push · watch renews
  Oct 9"), Todoist ("Polling every 5 min") and Weather ("Every 30 min") the same way; then **Attention
  precision**, 82%, the share of attention mail opened before Done, with a 30-day sparkline.
- **Mail** (board 18a): written rules, learned rules (from pattern prompts), trusted remote-content
  domains, the code expiry presets, and the note that protected mail can't be moved by any rule.
- **Notifications** (board 18b): **ntfy** ("Connected · last sent 8:02 AM", Send test, Server, Token
  ([Decided while building](#decided-while-building) #82)), the
  topics in mono (`setpoint-reminders`: Reminders · Time to Leave · Reconnect alerts;
  `setpoint-mail`: Attention mail · Off for now), **Reminder defaults** (Events 10 min before; Tasks
  9:00 AM on the due day, as the sample sets them; each offers None, a fresh install's default, D49), **Time to Leave** (live routes; leave from Home, set in Calendar; a 5 min
  buffer; on for the events given it, #86) and **Reconnect alerts** (once per source).
- **Calendar, Todoist, AI, Appearance, Security** follow the same row pattern ([BRIEF.md ›
  Settings](BRIEF.md#settings)).
- Sign out isn't drawn; it follows darma (the foot of the nav, and ⌘K).

## Health and states

| State | Treatment |
| --- | --- |
| **Healthy** | nothing |
| **Stale** | a muted 32 px line, `ink3` 12.5: "Personal, as of 9:14 PM" |
| **Failing** | the same line in `caution`, with the reason |
| **Needs reconnect** | a 40 px bar at the top of the Inbox (`caution` text on `caution` 9%): `sync_problem`, "Business needs sign-in · Reconnect"; the account's glyph and count in the sidebar; one ntfy notification; mantel's alert chip |
| **Offline** | a 36 px `alert` pill centred 12 px under the top: "Offline, as of 9:41 PM, retrying", then Retry now with `refresh` (#164); everything under it dimmed, changes disabled |
| **Unreachable at launch** | no sign-in card: the mark at 36 px where the card's top sits, at 50% opacity with `grayscale(.4)`, and the same pill 22 px under it, "Can't reach Setpoint, retrying", then Retry now; Setpoint asks again every 5 s and when the network returns, and the app or the card follows its answer (#118) |
| **Triage down** | the **Unsorted** group under Attention, with "Triage is down, as of 9:09 AM" |
| **A change failed** | in place (board 19b): the chip outlined in `alert` with an error glyph, and a card anchored to it: "Couldn't move Dinner with Sam", where it was going and from ("Sat, Oct 10 · 7:00 – 9:00 PM · From Fri, Oct 9"), the provider and its own words ("Google Calendar", then "The requested event was modified by another client. (409 Conflict)"), **Try again** and **Move back**. A change waiting for its provider shows at .5 opacity with a spinner. |
| **First backfill** | search's status: "Indexing · 62% · showing what's indexed so far" |

Health means **the last check succeeded**, not that data changed; thresholds come from each source's
schedule ([BRIEF.md › Health](BRIEF.md#health-and-states)).

## Phone

Below 640 px, the same pages laid out in one column (board 21, 390 × 844): the Inbox (Attention,
Pinned, Security, the FYI groups, Noise), its rows with the account label; the reader full width with
Back; a read-only agenda for today and the next 7 days, empty days collapsed. Actions: Done (on
Attention mail, #93), Trash,
Mark read, Mark unread, Mark all as read. Plain search; no calendar editing, no Alfred, Settings only to
sign in. Dates never wrap.

It feels like an installed app (each line's [Decided while building](#decided-while-building) entry has its values):

- **The reader's actions** share its bottom bar evenly, Done first, its check `good` and its label
  `ink` 500 (#255).
- **Marked unread**, an email shows the unread dot before its subject (#263).
- **Search** has a clear button where the desktop's Esc hint is, no Mark all as read meanwhile, and
  Back reads "Search" from a result (#259).
- **Motion:** the reader slides in over the list and back off it; an agenda item's detail rises in;
  the toast rises from the tab bar (#257).
- **The tab bar** fills the current tab's glyph, badges Inbox with the attention count while another
  page shows, and a tap on the current tab takes its list back to the top (#260).
- **The edges:** the page reaches the screen's edges, kept clear of the status bar and the home
  indicator by their insets, and Safari's bars take the drawn theme's `page` (#261).
- **The list** reads a step up ([Type](#type), #262).
- **The agenda** reads "Today" in `ink` 500, puts the now-line among today's items, draws events as
  their calendar's chips, and keeps each day's head in view (#256).
- **Signing in**, the card sits 18% from the top (#264).

## mantel's mail chip

Board 23, for mantel's DESIGN.md (added there first, with Andy's agreement):

- **One split pill:** "✉ 3 attention" in **tone C** (fill `chip` + 15% `caution`, `caution` edge
  and words) | "11 FYI" as a plain status chip. Attention counts not-Done attention, read or not,
  the same as Setpoint's pill; FYI counts unread FYI.
- Only attention: the whole pill in tone C, after the alerts and failure chips. Only FYI: a plain
  status chip that folds first. Both 0 or the sensor unavailable: hidden.
- **Popover:** up to three attention emails (dot, sender, subject, age; a read one's sender in
  `ink2`) and **Open Setpoint ›**; each row opens that email.
- **"Business needs sign-in"** is an **alert** chip like the finance importer's sign-in chip
  (decision 42).

## Interaction rules

- **Read state:** an email becomes read only when opened (Enter or a click) or by Mark all as read.
  Moving the cursor, scrolling and expanding a group never mark anything read. Counts follow at once
  (opening an unread email drops the unread counts; the attention pill drops only on Done).
- **Keyboard cursor:** `J` / `K` move it (a `sub2` fill); moving the pointer onto a row makes it the
  cursor, as in darma. Enter opens.
- **Done** (`H`) leaves Attention; whether the email was opened first is recorded for triage, never
  asked. Only Attention mail not yet Done offers it (#93). **Trash** (`E`) offers Undo for 6 seconds, as v1 does, in the export's `.toast` (a 40 px pill
  at the top centre in the header's band, at the bottom on the phone, #92; not drawn on a board). The
  six seconds drain as a hairline and wait while the pointer rests on the toast (#140).
- **Keys:** everywhere ⌘K, `1` Inbox, `2` Calendar, `/` search, ⌘, Settings, Esc closes the
  topmost thing; mail `J` `K` Enter `H` `E` `P` `O` `U` (Unread or All, #105) ⇧I ⇧U ⌘Enter;
  Calendar ← → or `P` `N`, `T`, `C`, `D`, `E`, Delete, `M` `W`, Enter, Esc; News (after 2.0) `3`,
  `J` `K` Enter `O` `N` Esc. Key hints read "Esc",
  "⌘K", "⇧I".
- **Changes** go through one command layer: pending (.5 opacity) until the provider confirms, failed
  in place with the provider's message otherwise. Nothing quietly reverts.
- **Overlays** anchored to calendar items follow the placement rule; Esc closes the topmost.
- **Text selection:** titles, addresses, codes and email bodies can be selected; controls can't.

## Copy

Sentence case; " · " separates parts, " – " ranges, "…" is one character; times "2:30 PM"; ages
"now", "4m", "2h", "Yesterday", "Mon", "Oct 1" in the Inbox and search, clock times under All's day
headings; full timestamps in tooltips. Empty states are one line and an action: "All caught up · Open
All", "No events · New event"; a day whose items are only hidden, "4 hidden · Show all" (#113). Each
leads with its glyph in `ink3`, 20 px and 12 px before the words, or 16 px and 8 px in a row 44 px or
shorter (#165). The UI says "Done".

## Overrides to the export

Where the round-2 export and this file differ, this file wins (round-2 review and decisions 46–48).
In the board audit these are expected differences: `web/tests/browser/audit.ts` draws them onto the
boards as patches, or the check reaches the board's state another way.

1. **The overshoot clamps at the grid's edges** (decision 47). The export's README, under "Carried
   from round 2", still describes it crossing about 9 px.
2. **Counts follow the rules on every board** (decision 48). With Northwind open (01, 20, 21, 22a)
   the sidebar reads Inbox (3) 18 and Jobs 1; with the Google recovery email open (03) or Contoso
   Coffee open (02) it reads 18 and Personal 7. The export keeps 19 everywhere.
3. **All includes Noise:** today's Tailspin, Contoso Coffee and Litware emails appear in 05.
4. **The done glyph is `good`**, not `comf` (the export's `.ring.done` uses `--comf`).
5. **Light `page` is `#f6f6f4`** (the export uses `#f8f8f6`); Light row dividers are `hair`.
6. **The recurring scope defaults to "This event"** in the editor too (14 defaults to "This and
   following").
7. **Placement covers every anchored overlay:** 15b's drop prompt and 12a's card take the side
   covering the fewest items; check 12a against "above".
8. **New events take Settings' reminder default** (13 shows "30 min before"; the sample's default
   is 10 min, a fresh install's None, D49).
9. **Summaries are `ink3`** in both themes, as drawn (the brief's token table said `ink2`).
10. **Week view titles** end in "…" (16's Dinner block).
11. **Phone dates** never wrap (21's pinned "Sep 30").
12. **Search reasons** use one case style: "Org Northwind · Type Rejection".
13. **Board 24's sidebar demo** has no box around the mark and name.
14. **Every group starts expanded** in the Inbox (#84): the boards that draw Deliveries, Money or
    Noise collapsed are reached by collapsing them, and 02 draws Money collapsed.
15. **The Today block names its tasks** (#78): where a board draws "○ 2 due today" and "○ 1 due
    tomorrow", the app lists CS 101 lab report, Pay rent, and Renew car registration with
    "Tomorrow".
16. **Board 16's week starts on Sunday** (#52): Oct 4 – 10, with Sunday 4 and Saturday 10 the weekend
    columns, and the mini-month's shown week Oct 4 – 10.
17. **The mark is Day stack** (#87): every board, and board 24's options, draw the placeholder.
18. **No Done outside Attention** (#93): 02, 06, 07 and 10 draw Done on an email that isn't Attention
    mail; the app leaves it out, so Trash leads the tools.

**News** (design round 3, boards 25–31; N4 and N5). Where a board draws only some of a block's
stories, or other numbers than the seed's, the audit patches in the seed's (D3); those aren't listed.

19. **News's icons are drawn from `glyphs/icons.json`**, not the full icon font the boards load from
    the network; the photo placeholders stand in for Setpoint's own image copies.
20. **Opening a story sees it** (#95): 25 draws the open brush fire story still updated; its dot and
    "Updated 8:40 AM" go once it's opened, while the pane keeps what's new since the last look.
21. **The story pane has no More** while it would hold nothing (as #23); 25 and 26a draw one.
22. **Times say their day** (Copy): 25's "first reported 6:12 AM" of a Monday story reads "first
    reported Mon 6:12 AM", and 28's "Tue" ages read "Yesterday" on a Wednesday, as All's rows do.
23. **Also in this story lists every other source** (The story pane), FOX 11 too (26b lists four).
24. **Settings' nav lists News between Mail and AI** (News in Settings) on 17, 18a and 18b, which
    predate it, with its `caution` warning glyph while a feed fails (the seed's FOX 11 does).
25. **Settings › AI keeps the Settings row pattern** (Settings: rows 52 px at least, 48 with a
    control; only Settings › News's are 44, as News in Settings says), where 30b draws every row at
    44. Its Mail group is the app's four models, each Default until chosen and saying when a key is
    needed (D25, D26, UX #14), where 30b draws Triage and Alfred alone.
26. **News's models show as their names, not selects** (D90): no setting chooses them, so 30b's
    chevrons on Articles and grouping and Stories and ranking aren't drawn. The monthly cap stays a
    select, as drawn.
27. **Usage says what it counts** (#73): 30b's "1,214 emails" and "18 questions" read "1,214 calls ·
    2.4M tokens in · 49k out" and "18 calls · 112k tokens in · 8k out".
28. **The first run's line takes a typographic apostrophe**, "what’s sorted so far", as search's
    indexing line does (29b draws "what's").
29. **An agenda line names its calendar; the place has its own line** (#166): where boards 11, 12a,
    12b, 12d, 15, 15b, 19b and 22b draw "2:30 – 3:30 PM · Smile Dental" or "7:00 – 9:00 PM · Blue
    Door", the app reads "· Personal", then the place under it after `location_on`.
30. **The glide's contents crossfade**: old content fades out 0–120 ms and new content in 70–220 ms
    (#149), overlapping by 50 ms, where `motion/glide.json` has 0–90 and 90–220 and the card travels
    blank between them.

## Not designed yet

- Reply and compose (a reserved place in the reader's tools).
- Full phone parity; ntfy action buttons.
- Sign-in and first-run screens (they follow darma's sign-in card), and Sign out.
- The Trash Undo toast on a board (its component exists in the export).
- Settings › Calendar, Todoist, AI, Appearance and Security in detail (rows per the brief).
- Empty states beyond the Inbox and search (an empty day, a source with nothing yet).
- News's tuning round (muting, "less like this", choosing sources) and News on the phone.

## Decided while building

Record each decision made during the build here, numbered and dated, with Andy's agreement where
it changes what's on screen.

1. **The segmented control's outer radius is 10**, as the export draws it (`.seg`); Shape no longer
   lists it under 999 too (Andy, 2026-10-07; darma SV-1).
2. **The reader's tools and actions draw their icons at 18 px (tools) and 17 px (action buttons)**, as
   board 01 does, not the 16 px Glyphs gives buttons and tools: they balance the 13 px labels better
   (Andy left it to the build's eye, 2026-10-07; darma SV-10).
3. **Done or Trash on the open email opens the next one** (auto-advance), which marks it read like
   any open. The next is the following email row in list order, skipping group headers and collapsed
   groups; with none, the reader closes. From the cursor row with no email open, Done and Trash open
   nothing. Undo after Trash brings the email back into the reader (Andy, 2026-10-07; darma SV-11).
4. **On Security and Noise mail, Add to calendar and Add as task sit in the reader's More menu**
   rather than among the action buttons, so they stay reachable without cluttering mail that rarely
   needs them; every other email keeps them as buttons, and Ask about this email stays a button on
   all mail (Andy, 2026-10-08; darma SV-12).
5. **Calendar's header reads title, ‹ Today ›, then Month | Week**, as boards 11 and 22b draw it,
   so the paging arrows sit beside the month they change; the account rows under Inbox hide on
   Calendar to make room for the mini-month and calendars (Andy, 2026-10-08; darma SV-13 D17).
6. **Done offers Undo too**, not only Trash: the same 6-second toast, "Marked Done · Undo" (Andy,
   2026-10-08; darma SV-11 D18).
7. **"Always show from …" trusts the sender's whole domain** (its registrable domain:
   news.contosocoffee.example offers contosocoffee.example), so one click covers a company's sending
   subdomains; the reader's head still names the exact sending domain (Andy, 2026-10-08; darma
   SV-11 D28).
8. **Search has its own header while it's open:** the title reads "Search", Unread | All hides, and
   the field widens to 520 px with an Esc hint so the chips have room; Esc brings the page's header
   back (Andy, 2026-10-08; darma SV-12 D29).
9. **A click on the grid keeps the editor's draft:** it selects the day or item as usual (an item's
   floating detail opens beside the editor), E and New don't replace a started draft, and only
   Create, Cancel or Esc end it; Esc closes the floating detail first (Andy, 2026-10-08; darma SV-15
   D30).
10. **A failed change's second button names its undo:** Move back (a move), Discard (a create), Keep
    it (a delete), Undo (a completion). A refusal from Setpoint itself, before any provider, shows
    a 6-second pill in the toast's style. Colour and Delete on a recurring occurrence ask This /
    following / all, as a drop does (Andy, 2026-10-08; darma SV-15 D30).
11. **Moving a recurring event to another calendar** offers only This and following (the default)
    and All events: Google can move a whole series, not one occurrence. A change of time or place
    still offers all three (Andy, 2026-10-08; darma SV-19 D31).
12. **Every control answers the pointer:** every button, segmented control, menu item, suggestion
    list and row has a hover state, as the export's CSS draws it where it does, otherwise a `sub`
    fill for flat controls, rows and menu items, and an `edgeHover` border for outlined buttons and
    fields, at 120 ms (Andy, 2026-10-08).
13. **Mail actions move the list:** when Done, Trash or Mark all as read takes an email out of the
    list, its row fades and its height closes over 180 ms, and the rows below slide up into its
    place. Pin folds the row onto the Pinned shelf the same way, and Undo folds it back. Opening an
    unread email fades its dot out over 120 ms. The Undo toast is unchanged (Andy, 2026-10-08).
14. **Reordering by drag is live:** while an account is dragged in Settings › Accounts, the other
    rows make room as it passes and ease into place over 180 ms, as darma's lists do (Andy,
    2026-10-08).
15. **Day cells show the forecast's high and low** ("78° / 61°", 11.5 `ink3`) before the weather
    icon; a cell under 124 px wide keeps only the icon (Andy, 2026-10-09; darma SV-22).
16. **Each month's boundary is traced on the grid,** as v1 draws it: a 1.5 px stepped line along
    the top of the month's first days and the left of its 1st, in `cool` for today's month and
    `cool` at 32% for the others (Andy, 2026-10-09; darma SV-22).
17. **⌘ or Ctrl alone puts the floating detail away,** keeping its item selected, so ⌘-click can
    add others; ⌘C, ⌘V and ⌘Z close it too (Andy, 2026-10-09; darma SV-22).
18. **The floating detail drags from anywhere** on the card except its buttons, links and text,
    which stays selectable; the grip stays (Andy, 2026-10-09; darma SV-22).
19. **New items show at once:** a create, Clone or Paste draws the item pending (.5 with a spinner)
    before the server answers. **⌘Z** undoes the last create or paste (deleting it), move, colour,
    edit or completion made on the calendar; a delete, and a change to a recurring event's
    occurrences, can't be undone this way (Andy, 2026-10-09; darma SV-22).
20. **Unread keeps what it showed until Andy leaves it:** mail read in Unread, here or elsewhere,
    keeps its place without its dot until he goes to All, Calendar or another account; Settings
    and search don't end the visit. Done, Trash and Mark all as read still take mail out at once;
    Unpin takes it off the Pinned shelf and leaves it in its place (Andy, 2026-10-09; darma SV-22,
    SV-24).
21. **Trash takes the row out at once** in Unread and All, folding as #13 describes, rather than
    when the provider answers. **⌘Z** undoes the last Done or Trash as the toast's Undo does, and
    the email comes back to its place in Unread even if Unread wouldn't list it now (Andy,
    2026-10-09; darma SV-22).
22. **The reading pane resizes from its left edge,** 480 to 1100 px (and leaving the list 420),
    starting at 680; ← and → step it 16 px when the edge has focus. This browser keeps the width
    (Andy, 2026-10-09; darma SV-22).
23. **The reader's More shows only when it holds something**, on Security and Noise mail; elsewhere
    the tools end at previous and next (Andy, 2026-10-08; darma SV-24).
24. **Calendar search** opens as mail's does (#8): the header's search button, `/` or ⌘F turn the
    header into Search, and results replace the day's agenda in the right pane while the grid
    stays.
    - **Matches:** title, place and address, attendees, calendar, and Todoist project and labels,
      over what's synced. Notes aren't synced, so they aren't searched.
    - **Chips:** date ("march", "last week", as mail's) and calendar (a calendar's name; "Todoist"
      for all tasks). Other words are free text. A month's name alone, other than this month's,
      looks both ways: "march" in October is two chips, Mar 2026 and Mar 2027, and either matches
      (Andy, 2026-10-08; darma SV-23 D51).
    - **Results:** under a results line ("14 results"), **Upcoming** soonest first, then **Past**
      most recent first. Rows look like the agenda's, plus why each matched (`ink3`, matches
      highlighted).
    - **Recurring:** a series is one row, its next occurrence (its last once it has ended), with
      its rule as the editor words it ("Weekly on Mon, Wed", #64). An occurrence changed on its own gets its own row only when
      the change is what matched.
    - **A result:** a click scrolls to its day, selects it and opens the floating detail, and the
      row stays marked. `E` hands it to the editor until Create or Cancel. Esc closes the detail,
      then search.
    - **Keys:** ↓ or Enter go to the first result, `J` / `K` step through results as clicks do, and
      `/` returns to the field.
    - **States:** before typing, one `ink3` line ("Search events and tasks by title, place, people
      or calendar, or a date like 'march'"). No results: "No events or tasks match **Classes · Mar
      2026 · lab**", each chip removable. 50 results, then **Show more**.
    - No Ask Alfred, no search log, no phone search (Andy, 2026-10-08; darma SV-23 D48).
25. **Error and status lines join their parts with commas,** not " · ": "Couldn't move Gym, A
    repeating task's date changes in Todoist.", "Google Calendar, The calendar is read-only.",
    "Offline, as of 9:41 PM, retrying", "Triage is down, as of 9:09 AM", "Personal, as of 9:14 PM,
    Gmail answered 503." The middle dot stays for neutral details (a day and time, "PDF · 184 KB",
    "FYI · Money") and before an action button ("Business needs sign-in · Reconnect") (Andy,
    2026-10-08; darma SV-24 D50).
26. **A task proposal makes a Todoist project only when asked:** Project's menu lists the projects
    whose names hold what's typed (any case) and, when none is exact, **New project “Work”**. Only
    that pick creates it, in Todoist, before the task. Create with an unknown name says “No project
    named “Wrok”, pick one or create it” and sends nothing. A task proposal has no Place (Andy,
    2026-10-08; darma SV-24 D50).
27. **An "@" place in the editor's line ends at a pick, a comma or, for a link, at a space:** once a Places
    suggestion is picked, the place stops at the text it was picked for and what's typed after it
    is the title's again; "@https://zoom.us/j/123" or "@www.…" stops at the next space and gets no
    suggestions. A comma ends any of them by hand and goes with it ("@Blue Door, bring wine" is the
    title "bring wine"). Otherwise a place still runs to the next day, time, repeat or calendar. A
    picked place's address shows in `ink3` under the Place field (Andy, 2026-10-09; darma SV-27 D52,
    D53).
28. **Todoist projects have colours, Todoist's own:** Settings › Todoist lists each project with a
    swatch menu of Todoist's 20 colours (by Todoist's names, "Berry red" to "Taupe"), and a pick is
    written to Todoist, waiting at .5 with the spinner and failing in place with Todoist's words,
    **Try again** and **Change back**, as a calendar's colour does with Google. An open task's ring
    takes its project's colour on the grid, in the "+N" popover, the right pane, search results and
    the phone agenda; a task whose project has none keeps the plain ring. The done glyph stays `good`
    (Andy, 2026-10-09; darma SV-25 D54).
29. **Settings › Mail's trusted domains with none to show** read as one plain line across the group
    ("None yet · the reader's “Always show from …” adds one", or "No domain matches" while filtering),
    a row like "No rules yet", not a cell of the domains' grid: no pill on hover, nothing cut off
    (Andy, 2026-10-09; darma SV-25 D54).
30. **Esc in an inline Settings form cancels the form first,** from any of its fields, as Rename
    does: Add rule, Connect iCloud, Change password and Add passkey. Settings stays open; the next
    Esc closes it (Andy, 2026-10-09; darma SV-25 D54).
31. **"No rules yet · Add rule" has Add rule as a button,** reached by Tab, `ink2` turning `ink` on
    hover or keyboard focus, as the agenda's "No events · New event" does (#12); it opens the same
    form as the section's Add rule (Andy, 2026-10-09; darma SV-25 D54).
32. **One toast for the whole app,** drawn above every page and above Settings and its scrim, so a
    line raised while Settings is open is seen. It keeps the Undo toast's look and 6 seconds; any
    page can show a line, an error, or a line with one action (Undo, Try again). A new toast
    replaces the last (Andy, 2026-10-09; darma SV-25 D54).
33. **`/` or ⌘F with a search open selects its whole query,** chips with the words (the chips take
    the selection's tint), in Mail and Calendar alike: typing or Backspace replaces it all, and a
    click, an arrow key or End keeps it to add to (Andy, 2026-10-09; darma SV-25 D54).
34. **All caught up waits for Unread to hold nothing:** while Unread still shows read rows it keeps
    (#20), the list shows them and Mark all as read, and All caught up comes once Andy leaves and
    nothing is left (Andy, 2026-10-09; darma SV-25 D54).
35. **A row's summary takes its subject's place** in the Inbox's list: the summary (in the row's
    bold) then " · via Workday" when it came through a platform, and the subject moves to the row's
    tooltip and the reader. Attention rows keep both lines; security rows keep their fact, code rows
    their code, and a row with no summary its subject. Triage writes the summary to stand on its own
    (prompt v2; stored mail isn't triaged again) (Andy, 2026-10-09; darma SV-25 D54).
36. **U switches Unread and All** on mail (not while searching; `1` since #75). Its hint, a `kbd`
    "U", sits on the button it switches to (All in Unread, Unread in All), and ⌘K finds it as Show
    All or Show Unread with its key (Andy, 2026-10-09; darma SV-25 D54).
37. **Mark all as read says how many it read:** "Marked 17 as read · Undo" in the toast, from the
    footer, ⇧I or ⌘K alike (⌘K's runs the Inbox's own on the Inbox). Undo marks those same emails
    unread, and they come back to the list (Andy, 2026-10-09; darma SV-25 D54).
38. **Every attachment downloads:** each card ends in a **Download** link (12.5 `ink2`, a `sub` pill
    on hover) and the preview's head has one before ×. A card whose type has no preview is itself
    the Download link, rather than a card that does nothing (Andy, 2026-10-09; darma SV-25 D54).
39. **A task's floating detail completes it:** among its icon actions, before Clone, a Todoist task
    has **Complete** (a ringed check), or **Reopen** (an undo arrow) once it's done. It goes through
    the same completion as the agenda's ring: pending at .5 until Todoist confirms, ⌘Z and a
    failure's Undo as #10 and #19 say. It has no key; a repeating task once done, and a task
    waiting on Todoist, show it disabled (Andy, 2026-10-09; darma SV-25 D54, D55).
40. **Copy and ⌘C on the calendar say what they took,** in the toast: "Copied Dinner with Sam, ⌘V
    pastes on the selected day", or "Copied 3 items, …" for several (Andy, 2026-10-09; darma SV-25
    D54).
41. **No change fails quietly:** a change refused outright (Pin, Done, Trash and their Undo, Mark all
    as read, opening an email, a rule, a domain, an account's colour, icon or order, a calendar shown
    or hidden, Sign out) says so in the toast, what failed then the server's or the provider's words:
    "Couldn't pin it, Gmail didn't answer in time.", "Couldn't reorder rules, Can’t reach Setpoint".
    The calendar's refusals ("Couldn't paste, …") use the same toast rather than one of their own.
    Offline, nothing toasts: the offline pill already says changes are refused. Only logging which
    search result was opened stays silent (Andy, 2026-10-09; darma SV-25 D54).
42. **Check now shows itself on its row:** the row's state reads "Checking…" from the click until
    the source's check lands (at most 15 seconds), then its state as usual ("Checked now"); a check
    that couldn't start says why there, in `caution`: "Couldn't check, Can’t reach Setpoint"
    (Andy, 2026-10-09; darma SV-25 D54).
43. **A task's "#Project" in the editor's line, and one Project field for the editor and the card:**
    "#" in a task's line names its project. Without a pick it stops at the longest project name it
    starts with, any case ("Pay rent #Home now" is Home and the title "Pay rent now"); an unknown
    name runs on as an "@" place does, and "#" ends a place in a task's line. A pick or a comma ends
    it, as for a place (#27). Project's menu (the projects holding what's typed, then **New project
    “X”**) shows under the Project field while it's typed in the line or the field: ↑/↓ move, Enter
    picks, Esc closes. A picked new project shows in the field tagged **New** and isn't offered
    again; Todoist makes it only with the task (#26). An unknown name not picked as new keeps Create
    waiting, and the line under Project says why. The editor's Project is the card's typeable field;
    editing a task offers only Todoist's projects. A repeat typed in a task's line ("every mon") is
    the task's repeat, in Todoist's words as the Repeat menu says them (Andy, 2026-10-09; darma SV-25
    D54).
44. **More options carries the proposal card's fields as left:** the editor opens on the card's
    title, day and times, place, calendar, reminder and project (a New project still tagged New);
    the fields Andy changed lose the "from the email" mark (Andy, 2026-10-09; darma SV-25 D54).
45. **The editor and the proposal card share a date and a time picker:** both fields still take
    typing. Focusing the date opens the sidebar's mini month under it (‹ › step it, a click picks;
    ↑/↓ move a week, Enter picks, Esc closes). Focusing a time opens its list in 15-minute steps,
    scrolled to its value (↑/↓, Enter, Esc); End's list starts after the start and gives each
    length ("10:00 AM (1 hr)"). Typing in either closes its picker, so it never covers the card's
    Create. The time fields take shorthand, "3p", "330p", "930a", "2130"; the
    typed line still keeps 4-digit numbers as title words. An × after the times sets an event back
    to all day, or takes a task's time off. Settings' reminder time and search's date chips are
    unchanged (Andy, 2026-10-09; darma SV-25 D54).
46. **"#Calendar" in an event's line picks the calendar,** as "#Project" picks a task's project
    (#43), with no New option: "dinner with sam at 6-9pm #school" is School. The Calendar field's
    menu shows the calendars whose names hold what's typed after "#" (calendars of the same name in
    different accounts both show); ↑/↓ move, Enter or a click picks, and a pick or a comma ends it.
    Without a pick it stops at the longest text a calendar's name starts with, any case, and typing
    alone takes the first such calendar in the list's order. A "#word" no calendar's name starts
    with stays in the title ("#1 priority"). "#" ends a place in an event's line too; in a task's
    line it stays the project, and "cal Classes" still works (Andy, 2026-10-09; darma SV-25 D57).
47. **A new draft follows a click on the grid** (amending #9): a click on a day selects it as
    before and moves the active new draft there, its ghost and Date with it, unless its line names
    a day ("fri") or its Date was set by hand. **New**, C and D replace an empty draft (C or D
    switching between event and task); on a started one they keep it and add another to the batch
    on the selected day, as **Add another** does. C and D work whenever focus isn't in a text field.
    Editing an item is unchanged: a click only selects, and E doesn't replace a started edit (Andy,
    2026-10-09; darma SV-28 D56).
48. **All groups each day by lane:** under the day heading (still the one band), small-caps labels
    with their count, no band or hairlines: Attention (count in `caution`), Unsorted, FYI. FYI's
    rows follow Unread's kind order, newest first within a kind, and the kind (11 uppercase `ink3`,
    84 px) shows in a left column, before the unread dot, only where its run starts; Attention and
    Unsorted leave it blank, and it drops with the reading pane open and on the phone, as the kind on the right it replaces
    did. Each day's Noise is one line after a `hair`, "NOISE 3 Contoso Coffee · Tailspin · Litware"
    and a chevron, that opens in place on a click or Enter; J and K stop on it while folded (Andy,
    2026-10-09; darma SV-26 D58).
49. **A started draft stays until Create, Save, Cancel or Esc** (amending #47): New, C, D and E
    show "Create or cancel the draft first" (or "Save or cancel your changes first" while editing),
    put focus back in the editor and change nothing. An empty draft is still replaced, C or D
    switching between event and task, and a grid click still moves a new draft. Several drafts
    come only from **Add another**, and each folded one has an × that removes it and its ghost. An
    empty draft is a ghost on the grid too, "New event" or "New task" until it has a title (Andy,
    2026-10-09; darma SV-29 D59).
50. **An event's Date picks its first and last day in one sheet:** the first click is the first
    day, the next the last, the days between a band that follows the pointer (rounded at its ends
    and each week's edge); the same day again is one day, and a day before the first starts over.
    Enter picks as a click does; Esc or a click away keeps one day. The field reads "Tue, Oct 13 –
    Fri, Oct 16" and takes that typed, or "oct 23 - 25" or "fri to sun"; a lone day moves the event
    and keeps its length. A timed event ends at its end time on its last day; across days, End
    lists that day's times without lengths, the times wrap under the days, and the one-day
    conflict preview hides. All day and back keeps the days. A task keeps one due date (Andy,
    2026-10-09; darma SV-29 D60).
51. **A suggestion picked for the line writes its name out, then a space:** "#wo" picking Work
    reads "#Work ", "@mcd" picking McDonald's "@McDonald's ", the caret after the space so the title
    goes on (a comma typed after it stays; a picked place keeps a comma of its own). Tab picks as
    Enter does, in the line's menus and the Places list; in the Project field and the Place field
    it picks and goes on to the next field (Andy, 2026-10-09; darma SV-29 D61).
52. **Weeks start on Sunday:** the month grid's weekday row and rows, the sidebar's mini-month and
    the date pickers. The floating detail and the drop prompt take their sides by the same rules,
    so on boards 12a–12d Dentist's card sits left at 159 px and Dinner with Sam's below it (Friday
    has only Saturday to its right), and on 15b the prompt sits left of Thursday's chip. Search's
    "this week" and "last week" chips, mail's and the calendar's, run Sunday to Saturday too (Andy,
    2026-10-09; darma SV-29 D62).
53. **Repeats name their days as words:** one spelled out ("Every Saturday", "Weekly on
    Wednesday", "Monthly on the first Monday"), several capitalised short ("Every Tue, Thu, Sat"),
    in the editor, a task's floating detail and search's rows. Every project menu and the Project
    field show each Todoist project's colour as a dot (the proposal card's ring takes it). A
    calendar search emptied after a query, its last word or chip gone, closes as Esc does. A menu
    that would run past the right lines up with its field's right edge, as End's list does by the
    right pane (Andy, 2026-10-09; darma SV-29 D63).
54. **A change waits quietly for its first second:** an item or colour waiting for its provider
    shows at .5 at once, and its spinner only after a second, so a change Google or Todoist
    confirms quickly never flashes one; the server sends each change on as it's made, not at its
    next tick. The spinner turns once every 900 ms wherever it shows (Andy, 2026-10-09).
55. **A recovery code signs in:** the sign-in card's foot offers **Use a recovery code**, which asks
    for the code and a new password ("This replaces the password, removes passkeys and makes new
    codes.") and then shows the new codes once, as the claim does; **Use the password** goes back
    (Andy, 2026-10-09; polish audit #1).
56. **A pause chips the finished words:** typing "northwind rejection march" and pausing makes Org
    Northwind and Type Rejection chips and leaves "march", the word still being typed, as text;
    Enter chips it too (Andy, 2026-10-09; polish audit #2).
57. ~~**Week reads as not built yet:** the header's Week is `ink3` at .5 beside Month, and still
    doesn't answer the pointer (Andy, 2026-10-09; polish audit #3).~~ Retired by #81: Week is built.
58. **The new-event editor's Title field says "Title"** until the line gives it one (Andy,
    2026-10-09; polish audit #4).
59. **The conflict preview waits for a draft:** a new event shows it once it has a line, a title or
    a time set by hand, not on C alone (Andy, 2026-10-09; polish audit #9).
60. **A fact's label holds one line:** "What happened" no longer wraps in the facts card's 112 px
    column (board 03 drawn that way) (Andy, 2026-10-09; polish audit #6).
61. **An attachment card widens to its name:** at least 280 px, wider to show the whole file name,
    never past the reading pane (board 10 drawn that way) (Andy, 2026-10-09; polish audit #7).
62. **A failing source says all of it:** atop the calendar's right pane its line wraps, so the
    provider's words show in full; every health line, the Inbox's bars too, has its text as its
    title (Andy, 2026-10-09; polish audit #8).
63. **Alfred says it needs a key as its card opens:** with no Anthropic or OpenAI key the card says
    so before anything is asked; "Settings › AI" in that line, or in any failure that names it,
    opens Settings there, and a question that failed comes back to the field (Andy, 2026-10-09;
    polish audit #10).
64. **A calendar search row words a series' rule as the editor does**, "Weekly on Tue, Thu", not
    "Weekly · Tue, Thu" among the line's other dots; a task keeps Todoist's words ("Every Tue, Thu")
    (Andy, 2026-10-09; polish audit #11).
65. **A calendar search result's line is one line**, cut with an ellipsis and whole in its title, so
    its calendar never sits alone on a second. The header keeps ‹ Today › while searching, since the
    grid still pages (Andy, 2026-10-09; polish audit #13).
66. **Phone rows are two lines:** the sender, the account and the age, then the subject under the
    sender, as Attention's rows are, so neither is cut to a few characters (board 21 drawn that way)
    (Andy, 2026-10-09; polish audit #14).
67. **⌘K asks for a command:** its field reads "Type a command…", since it runs commands, not search
    (board 20 drawn that way) (Andy, 2026-10-09; polish audit #15).
68. **Sign out is the Settings nav's foot only:** Security has no row of its own, and **Add
    passkey** has its + as **Add rule** does (Andy, 2026-10-09; polish audit #16).
69. **Settings › Calendar labels its last group "Weather and places"**, as every other group has a
    label (Andy, 2026-10-09; polish audit #20).
70. **A group opened at the foot of the Inbox comes into view:** the list scrolls just enough to
    show its last row, never past its header (Andy, 2026-10-09; polish audit #21).
71. **The sign-in card is anchored from its top**, a little above the middle, so "Wrong password."
    grows it down rather than moving it up (Andy, 2026-10-09; polish audit #23).
72. **Searching on the phone, the top reads Search alone**, without the attention pill or count, as
    mail's search clears its controls (Andy, 2026-10-09; polish audit #24).
73. **Settings › AI says what its usage counts:** "1,204 calls · 2.4M tokens in · 48k out" (Andy,
    2026-10-09; polish audit #25).
74. **All's rows lead with the summary too:** as in the Inbox (#35), a summary takes the subject's
    place, then " · via Workday"; the subject moves to the row's tooltip and the reader. Security
    rows keep their fact, code rows their code, a protected email its subject in `alert`, and a row
    with no summary its subject (board 05 drawn that way) (Andy, 2026-10-10; polish audit #5).
75. **`1` on the Inbox switches Unread and All,** in place of U (amending #36): its hint, a `kbd`
    "1", sits on the button it switches to, and ⌘K's Show All or Show Unread carries it. From any
    other page `1` still goes to the Inbox's Unread, and while searching (or on the phone) it does
    that on the Inbox too. U does nothing now (Andy, 2026-10-10).
76. **The UX walk's fixes** (2026-10-09, `audits/2026-10-09-ux-walk.md`; fixed at Andy's ask, and
    each choice below is his to overrule):
    - **A calendar delete is held behind Undo** (amending #19): Delete, Backspace or the card's
      Delete takes the item off the grid and says "Deleted Dentist · Undo" ("Deleted 2 items");
      the delete is sent once the toast has gone, or at once if the page is closed. Undo or ⌘Z
      meanwhile keeps it and sends nothing.
    - **The calendar says what each change did, with Undo:** "Moved Dentist to Thu, Oct 8",
      "Completed Pay rent" ("Reopened"), "Cloned Gym", "Pasted Dentist on Tue, Oct 13", "Changed the
      colour of Dinner with Sam", "Created Haircut, Fri, Oct 9" ("Created 2 items"). The toast's
      Undo and ⌘Z are the same; a change to a recurring event's occurrences says what it did, with
      no Undo. An edit saved in the editor stays silent.
    - **A started draft or unsaved edit survives leaving Calendar** (amending #49): coming back
      brings the editor back as it was, line, fields and ghost.
    - **The open editor's draft day comes into view** on the grid, so More options for a December
      exam shows December.
    - **E focuses the Title, selected;** in a new item, a Title typed by hand rewrites the line's
      title words ("Coffee fri" titled "Coffee with Ana" reads "Coffee with Ana fri"), and the
      line goes on giving the title.
    - **With an email open, J and K open the next and previous,** as the reader's arrows do, so H,
      E and P never act on a different email from the highlighted one.
    - **Mark all as read leaves Security unread** (amending BRIEF.md › The Inbox), so a live code or
      a sign-in alert isn't swept away; its footer shows only when there's something to mark, and
      ⌘Z undoes it as the toast's Undo does.
    - **⇧U marks an email unread,** closing the reader so it stays so; ⌘K shows the key. The
      reader's tools and More (#23) are unchanged.
    - **On the phone, Done and Trash on the open email go back to the list,** opening nothing.
    - **Search results show what was done to them:** an opened one loses its dot, a Done one is
      quieter with a "Done" tag, and Trash takes it out until Undo. When no email has every word,
      the results line says so: "No email has every word · 1 has some of them".
    - **A filtered Inbox reads "Inbox · Business"** in the header (not on the phone, whose account
      button says it), and the sidebar's Inbox clears the filter keeping Unread or All.
    - **Settings switches that can't work are off and disabled,** saying what's missing ("Set a
      server first", "Set Home first"); Send test shows only with a server. Each AI model's Default
      names its model ("Default (Claude Sonnet 5.5)"), and models whose key isn't set can't be
      picked. Attention precision's line says what its figure is: "82% of attention mail was opened
      before Done".
    - **⌘K finds Settings' sections by what they hold** ("rules" is Settings › Mail, "ntfy"
      Notifications, "keys" AI), and Sign out from ⌘K, Settings' nav or the phone asks once in the
      toast, "Sign out of Setpoint? · Sign out".
    - **Left as they are:** E and P mean different things in mail and Calendar (Trash and Pin,
      Edit and the previous month), each page's keys being its own and mail's Undo catching a slip;
      and Enter in search, which moves to the first result in mail (where Enter then opens it) and
      opens the first result's card in Calendar (where a result's card is how it opens).
77. **An HTML email fills the reading pane's width and is as tall as it is:** the frame and the
    images bar take the pane's full width instead of 600 px, so a wider pane shows more of the
    email. The frame takes its height from a measuring script in the email's own page (the one
    script its policy allows, by hash; the frame still has no origin of its own), as the email
    lays out and as each image loads, so a newsletter that is mostly pictures is never a short box
    with scrollbars of its own. An email wider than the frame is zoomed down to fit it
    (Andy, 2026-10-09).
78. **The Today block opens a card instead of leaving the page, and names its tasks** (amending
    the brief's Today block, where the event opened Calendar and a task line its day): every click
    that leaves a page only to show something now shows it over the page. A Today line opens the
    floating detail's card beside the sidebar, with Edit (to Calendar's editor, at
    /calendar/item/3/edit), Complete, Delete and Open in Calendar; E and Esc go to the card first,
    so E never trashes the open email. Tasks show by name, tomorrow's marked "Tomorrow", up to three
    before "3 more due tomorrow". Undo right after Complete waits for the Complete to reach Todoist,
    as mail's Undo does (Andy, 2026-10-10).
79. **Settings' selects open the shared menu, not the browser's list:** a chip (Send to, Default
    project, Events and Tasks reminders, the AI models, Sign in with) opens the same small menu as a
    row's options, its choices with a check on the current one; opened from the keyboard it starts
    on that choice, ↑ ↓ move, Enter picks, and Esc closes just the menu, focus back on the chip. The
    phone's account picker keeps the phone's own (Andy, 2026-10-09).
80. **Ask Alfred leads the results, an account or an age is never cut, and a long answer stays
    short:** Ask Alfred ⌘Enter is the first row under the field, where the Answer card stands once
    asked, instead of waiting at the foot of a long list (amending Search). The Answer card's
    sources share their columns, the account and age as wide as the longest ("Business (Studio)",
    "Dec 20, 2025"), so every row's line up; a result's age stays on one line. The rows' account
    column fits the longest label, 76 px at least and 160 at most, a longer one ending in "…". In
    the Answer card, a list answers in a line, how many and over what span, the sources listing
    them, not the line; more than five sources show the first five and **Show all 26** (`ink3` 12.5,
    a chevron), then **Show fewer**. While Alfred works, its line says what it's doing: "Looking
    through your mail…", then "Searching “rejection”…", "Reading Northwind Talent’s email…",
    "Checking your calendar…" or "Preparing the event…". The answer's lines stop at 620 px, about 75
    characters (Andy, 2026-10-10).
81. **The week view is built before 2.0, with resizing:** Andy asked for it now (amending BRIEF.md
    and BUILD-PLAN's "after 2.0" and "resizing waits"), and its forks were settled together:
    [Week view](#week-view) holds them. The ones that go past board 16: Sunday-first (override 16);
    the selected day's column, not today's, takes `sub`; the view in the address and remembered;
    overlaps in up to three lanes then "+N"; all-day events as spanning bars; resizing by both edges
    (Andy, 2026-10-10; darma SV-18 D64).
82. **ntfy's Token sits under its Server:** Andy's self-hosted ntfy denies anyone without a login,
    so Settings › Notifications has a **Token** row under Server, write-only like the AI keys:
    "If the server asks for one · Not set", **Set token**, then Replace and Remove. A key row's
    field now says what it holds once ("Google Maps key", not "Google Maps key key") (Andy,
    2026-10-10; darma HA-446).
83. **The phone agenda's days show the forecast's high and low** ("78° / 61°", 11.5 `ink3`) before
    the weather icon, as a month cell does (#15). An empty day with a forecast keeps its own line
    to show it, "No events" beside its date and the forecast at the end; only empty days without
    one fold together (amending Phone's "empty days collapsed") (Andy, 2026-10-10).
84. **Unread starts with every group expanded,** Noise and the FYI groups included, rather than
    Noise and FYI groups of more than one email collapsed (amending The list). A group Andy
    collapses keeps its chevron and organisations and stays collapsed for the session, as before
    (Andy, 2026-10-10; darma SV-31).
85. **"!" negates a word in mail search:** `water invoice notification !confirmation` leaves out what
    "!confirmation" names. A word that forms a chip gives a Not chip, its label led by "Not" ("Not
    Type Confirmation", "Not Org Northwind"), and the mail it matches is left out; an email without
    that field (no type) stays. A word that forms no chip stays in the field as typed, and the mail
    with it in its sender, subject or body is left out. A Not chip is never a result's reason, and
    leaving out alone doesn't change free text's order. Calendar search keeps "!" as punctuation
    (Andy, 2026-10-10; darma SV-31).
86. **Time to Leave is a notification an event is given, not a rule for every event with a place:**
    a new event has none (a copy keeps its own). The editor's reminder menu offers **Time to Leave**
    with Settings' buffer in `ink3` ("5 min buffer") for a timed event with a place while Settings ›
    Notifications has it on; once added it is a chip like a reminder's, with a car glyph and an ×
    to remove it, as board 13 draws it (replacing D16's chip without an ×). Settings' switch still
    turns it off for every event. It is kept on the Google event, so it syncs and a recurring
    event's exceptions keep it; events from before have none until it's added. The seed gives it
    to Dentist and Dinner with Sam, where the boards draw "Leave by" (Andy, 2026-10-10; darma SV-31
    D67).
87. **Setpoint's mark is Day stack,** settling decision 44 in the sidebar, the phone header and
    sign-in, and as the browser icon, which v2 had lacked (browsers showed v1's): see [Glyphs, icons
    and the mark](#glyphs-icons-and-the-mark). Chosen over #2 of the first round (the set point
    with a `caution` dot) for something other than white on black (Andy, 2026-10-10; darma SV-32
    D68).
88. **The reader dates older mail with its time:** today's email shows its clock time ("7:12 AM"),
    an older one its date and time ("Sep 30, 2:15 PM", the year added before this one), as board
    10 draws it. Boards 06, 07 and 08 draw only the date or weekday (Andy left it to Claude,
    2026-10-10; darma SV-33 D73).
89. **On the phone, an Attention row's age hugs its account,** 8 px apart at the right edge, as
    board 21 draws it. The desktop keeps the age in its 44 px right-aligned column (Andy left it
    to Claude, 2026-10-10; darma SV-33 D74).
90. **A mail rule's words read as one sentence,** with word spaces ("From university.edu with
    “Registrar” in the subject") and an ellipsis when long; the arrow and the lane tag keep their
    8 px gaps. Board 18a's wider gaps between the words are its flex row's gap falling between bare
    text (Claude, 2026-10-10, as Andy left #88 and #89; darma SV-33 D75).
91. **A Gmail email's time is when Gmail received it,** from the top Received header Gmail adds,
    not Gmail's internalDate, which follows the sender's Date header when that's earlier. An email
    its sender held back (an invoice written at 05:06 and delivered at 10:02) shows and sorts at
    10:02, with the mail that arrived around it, and a code in it lasts its 15 minutes from then.
    Without a Received header Setpoint can read, internalDate stands; iCloud keeps INTERNALDATE
    (Andy, 2026-10-10; darma SV-36).
92. **The toast shows at the top centre,** inside the header's band, rather than at the bottom
    centre: Done and Trash are clicked in the reader's tools at the top, and the next email opens at
    the same moment, so "Marked Done · Undo" at the bottom went unseen. Every toast moves. The phone
    keeps it at the bottom, where its Done is (the reader's bottom bar) (Andy, 2026-10-10; darma
    SV-35 D72).
93. **Done is offered only on Attention mail not yet Done:** the reader's tool, the phone's button,
    ⌘K's command and `H`. Elsewhere it did nothing you could see: opening an FYI or Noise email to
    reach Done already read it, and read mail leaves the Inbox anyway; All lists Done mail; and
    triage learns only from Attention. Mail already Done (opened from All or search) has none
    either (Andy, 2026-10-10; darma SV-38 D78).
94. **Mark all as read's Undo brings the emails back at once** (amending #37): they return to their
    places unread before the server's list has them, as Done's and Trash's do (#21), so ⇧I right
    after reads them again (Andy, 2026-10-10; darma SV-37 D80).
95. **A News story's dot stays for the visit:** it's seen once its row has been fully on screen for
    about a second, or opened, so the dot is gone the next time News opens. Within the visit, the
    dots keep showing what was new or updated on arrival, and an opened story loses its dot at once.
    "New since you looked" and the Updated tag measure from the last look before this visit (Andy,
    2026-10-10; darma SV-46 D97).
96. **In All, each story appears once, in its main section's block:** the section its subject names
    (AI, Tech, Local or General) when the story is in it, Local for a hazard source's, else its
    first section. A story in Tech and AI about AI shows in AI's block only, where it had led Tech's
    and then AI's. A section's own list still shows every story in it, so "12 more in Tech" counts
    what that list holds beyond the block, a story shown in another block included. Seen stays
    shared, and a Missed row names the main section (Andy, 2026-10-11; darma SV-43 D102).
97. **AirNow's air quality comes from its free hourly reporting-area file, which needs no key;
    Settings › News has no key row.** AirNow retired its observations web service on October 1,
    2026 (Andy, 2026-10-11; darma SV-45).
98. **The story pane's body is one column at the reading measure:** its head, image, New since you
    looked, summary and Sources, and an article's head, image, text and other sources, are each at
    most 600 px wide from the pane's 28 px inset, so they line up however wide the pane is dragged
    (Andy, 2026-10-11; darma SV-46).
99. **A News list the story pane leaves under 600 px compacts itself:** Upcoming drops its label and
    outlet, and its name · date stays on one line, cut short with an ellipsis, with the whole of it on
    hover. Add to calendar stays. A lead's image shrinks from 232 × 130 to 160 × 90. The pane still
    stops 420 px short of the content's width, so at 1280 the list is 420 px (Andy, 2026-10-11;
    darma SV-51, D104).
100. **Upcoming's row opens the story behind the keynote:** a click anywhere on the row but Add to
    calendar opens a popover under its name with the announcing story's headline, line and meta,
    and a click on it opens the story, so the keynote can be read about before it's added. A press
    outside or Esc puts it away (Andy, 2026-10-11; darma SV-50).
101. **All's pinned email is on a Pinned shelf at its top, and only there:** Unread's shelf, its
    header, its rows (with ages, not clock times) and Unpin under the pointer, above the first day.
    A pinned email leaves its day until it's unpinned, so nothing shows twice; the reader still
    gives its date. P on a day's row moves it to the shelf at once, and the shelf follows the account
    filter. Day rows lose their pin column (Andy, 2026-10-11; darma SV-50, D105).
102. **Going to the Inbox opens Unread while anything waits there, else All:** an unread email, or
    Attention not yet Done, keeps Unread; otherwise All, rather than an "All caught up" Unread. It
    holds for the sidebar, `1`, ⌘K and the phone's tab from another page, and for the app opened at
    its bare address. Switching within the Inbox, and an address naming Unread or All, are as they
    were (Andy, 2026-10-11; darma SV-50, D106).
103. **An event's Date picks its other end on either side of the first** (amending #50): a day
    before the first click starts the event there and ends it on the first, rather than starting
    over, and the band follows the pointer back to it. The same day again is still one day (Andy,
    2026-10-11; darma SV-29).
104. **An event's date band is `cool`, not gray:** the days between at 28%, its first and last day
    at 50%, each 10 points stronger under the pointer, so the picked days stand out from the month
    in both themes (Andy, 2026-10-11; darma SV-29).
105. **U switches Unread and All again** (amending #75): going to the Inbox already opens the view
    that fits (#102), so `1` no longer needs to double as the switch. U's hint, a `kbd` "U", sits on
    the button it switches to, and ⌘K's Show All or Show Unread carries it. `1` goes to the Inbox
    from another page; on the Inbox it does nothing, except from a search or on the phone, where it
    goes back to the Inbox (Andy, 2026-10-11).
106. **A completed Today task shows it's done before it goes:** a ring's click, or Complete on the
    card, swaps the ring for the done check (13 px, `good`, landing from 60% over 120 ms) and
    strikes the title through in `ink3` for 360 ms, then the line folds away over 180 ms as the mail
    list's rows do (#13), and Undo or a refusal folds it back. While it shows done, the line takes
    no clicks, so a double-click completes that task alone, not the one that moves up under the
    pointer. A repeating task does the same, then shows its next date if it's due by tomorrow (Andy,
    2026-10-11, polish audit shell-01).
107. **The reader's tools fit a narrow pane:** under 600 px of pane the tools' key hints drop (the
    keys still work, and ⌘K lists them) and their padding goes from 10 to 9 px, so previous, next
    and More stay in view down to the pane's 480 px (#22), with Done and More both shown. News's
    story pane, which shares the tools, does the same (Andy, 2026-10-11, polish audit reader-05).
108. **Alfred about one email starts by reading it, and the follow-up field waits:** a question from
    Ask about this email first says "Reading this email…" rather than "Looking through your mail…".
    While Alfred answers, the follow-up field shows at half strength and Enter in it waits; what's
    typed meanwhile stays there, to send once the answer is in (Andy, 2026-10-11, polish audit
    extra-05, extra-06).
109. **A copy the browser refuses says so:** a code row's Copy that the clipboard refuses shows
    "Couldn't copy it" in the toast, and the button stays Copy, as #41 has every refused change do
    (Andy, 2026-10-11, polish audit extra-03).
110. **A line longer than the editor's field shows where it's typed:** its marks move with its
    letters as the field scrolls, so the words being typed and what they parse to stay in view, with
    the caret on its letter, and a side cut short fades over 14 px (Andy, 2026-10-11, polish audit
    calflows-01).
111. **The line's menus put first what the line reads** (amending #43 and #46): Project's menu and an
    event's Calendar menu list the names starting with what's typed, then those with a word starting
    with it, then those merely holding it, each in the list's order, with the cursor on the first,
    so "#ho" then Enter is Home, not School. A project's mark in the line takes its project's colour,
    as its dot does; one not yet named, or new, stays `ink2` (Andy, 2026-10-11, polish audit
    calflows-07).
112. **Leave by turns `caution` when it's time to go, then goes:** from 15 minutes before its time
    until the event starts, the right pane's "Leave by" line and its car are `caution`, and so is the
    floating detail's Time to Leave; once the event has started, neither shows it. The words don't
    change (Andy, 2026-10-11, polish audit calpanes-02).
113. **A day whose items are only hidden says so:** when calendars toggled off leave the selected
    day empty, its pane reads a 16 px `visibility_off` and "4 hidden" in `ink3`, then **Show all**
    (`ink2`, `ink` under the pointer), which turns every calendar back on, "Showed 4 calendars ·
    Undo" in the toast. A month cell whose items are all hidden stays empty. With every calendar
    off, a 16 px `ink3` `visibility_off` follows the header's title, so a filtered view shows from
    any day (Andy, 2026-10-11, polish audit states-12).
114. **An article's text keeps its lists and leaves out the outlet's appeals:** each list item is a
    line of its own, marked "•" or with its number (a line ending "at these sites:" is followed by the
    sites), and a list of nothing but links (the outlet's other stories) stays out. A paragraph asking the reader to become a member, before the story or after
    it, is left out (Andy, 2026-10-11, polish audit extra-10).
115. **Missed's leads keep their large images:** a story that leaves the page unseen keeps its own
    image's large copy as well as its thumbnail, so each day's lead in Catch up is drawn as sharply
    as on the page rather than from a 144 × 96 thumbnail stretched to 232 × 130. The large copy goes
    an hour after the story is seen (so the visit that saw it keeps its images), and every other copy
    goes with the page as before (Andy, 2026-10-11, polish audit news-09).
116. **"Nothing new" only when a section has nothing:** All's block for a section whose stories all
    show in other blocks, as their main section's (#96), is empty without the section being so; it
    keeps its "2 more in Tech" link and no longer says "Nothing new in Tech since Mon" above it. The
    line stays for a section whose own list is empty (Andy, 2026-10-11, polish audit extra-08).
117. **Catch up holds its list for the visit:** seeing Missed's stories while it's open no longer
    sends the page back to All the moment the last one is seen (about a second after the rows are on
    screen, with a short list). The rows keep their places and their dots follow #95; the strip is
    gone when the user goes back to All, and Missed opened empty is All, as before (Andy, 2026-10-11,
    polish audit news-01).
118. **Setpoint unreachable at launch isn't a sign-out:** when it can't be reached as it opens (a
    deploy or a restart: no connection, or the proxy's 5xx), it shows the mark, dimmed, and the
    offline pill under it, "Can't reach Setpoint, retrying" with Retry now, rather than the sign-in
    card with "Can't reach Setpoint" under an `alert` Password field. It asks again every 5 seconds
    and when the network comes back, and opens the app (or the card, on a 401) at the address it
    was opened at. Signed in, the same restart keeps the app under the offline pill instead of
    swapping it for the card. The card's own "Can't reach Setpoint" stays for a sign-in attempt
    that fails (Andy, 2026-10-11, polish audit states-02).
160. **Each lane carries its glyph:** every Unread group header leads with a 14 px glyph in `ink3`, 8
    px before its label: Pinned `keep` (was 16), Attention `flag` (in `caution`, as its count),
    Unsorted `pending`, Security `lock`, Deliveries `local_shipping`, Money `payments`, Career
    `work`, People `person`, Updates `notifications`, Other `mail`, Noise `campaign`. All's kind
    column draws the same glyph at 13 px before the kind word, the column 100 px wide to hold it.
    Shape alone, no colour per kind: the account colours already mean accounts (Andy, 2026-10-11,
    polish audit inbox-04).
161. **Each News section carries its glyph wherever it's named:** a section header leads with its
    14 px glyph in `ink3`, its optical edge on the list's 24 px line (Local `location_on`, Tech
    `computer`, AI `auto_awesome`, as Settings › AI, General `public`), and its label lifts from
    `ink3` to `ink2`, so the faintest text in the list becomes a landmark; mail's group headers keep
    `ink3`. The story pane's section tags take the same glyph, Missed's day headers `history` and
    Show headlines' Unsorted header `pending`, as mail's Unsorted. No colour per section: the
    account colours already mean accounts (Andy, 2026-10-11, polish audit news-07).
162. **An official warning without a photo shows its hazard, not a hole:** a story whose leading article
    comes from a hazard source (NWS `thunderstorm`, USGS `earthquake`, Cal Fire
    `local_fire_department`, AirNow `air`, the glyphs Settings › News gives those sources) and that
    has no image draws its glyph at 22 px in `caution` on a 72 × 48 tile (radius 8, `caution` at 10%,
    a 22% inset ring) in the thumbnail's column; as a block's lead it puts an 18 px `caution` glyph
    before the headline instead. An outlet's story without an image still leaves the column empty,
    never a placeholder. The story's lead names its hazard source (`hazard` in the API) (Andy,
    2026-10-11, polish audit news-08).
163. **An attachment's tile says what it is:** each card leads with a 30 px tile, radius 8, concentric
    in the card (padding 0 8 0 7, 12 px before the name), the type's colour at 14% with its glyph
    in that colour: PDF `alert` `picture_as_pdf`, image `violet` `image`, spreadsheet (CSV, Excel,
    Numbers) `comf` `table_chart`, document (Word, Pages, RTF, text) `cool` `description`, archive
    (ZIP, gzip, RAR, 7z) `warm` `folder_zip`, invitation (ICS) `caution` `calendar_month`, anything
    else `ink2` `draft`; the type from the name's extension, else the MIME type. **Download** carries
    a 16 px `download` (gap 6, padding 0 10 0 8). Under the pointer the ring stays `edgeHover`, the
    tile deepens to 22%, the eye turns `ink`, and in Night the card fills `cardOn` (Light stays
    white) (Andy, 2026-10-11, polish audit reader-07).
164. **A glyph means one thing, at one size per role:** account trouble is `sync_problem` everywhere
    (the sidebar, Settings › Accounts' nav and rows, the Inbox's reconnect bar, which had shown
    `warning` and `warning-fill`), while a failing News feed keeps `warning` (override 24); either
    mark in Settings' nav is `caution`, the current page's too (it had taken the nav's `ink3` and
    `ink`). A card's
    or popover's × is 16 px in a 26 px button (the day's popover, the failed card and a learned
    rule's were 18); 18 only in a 30 px header button, Settings' and the editor's, whose × and More
    become 30 px. Add is 17 beside a label, 18 in a 30 px icon button, 16 in a 26 px one;
    `open_in_new` is 18 in tools, 16 in small buttons and inline links, and 17 on the proposal
    card's More options, a labelled button as Add's. ⌘K's "Settings › Mail" carries Mail's nav
    glyph, not a generic gear; a rule's Turn off and Turn on show `toggle_off` and `toggle_on`
    (were an eye and a check); Retry now carries `refresh`, as every Try again does; the list's
    Mark all as read carries `mark_email_read`, as ⌘K's does. Stale and failing lines keep their
    glyphs here; their tone rule is settled with the health states (Andy, 2026-10-11, polish audit
    motion-10).
165. **Every one-line empty state leads with its glyph, as All caught up does:** in `ink3`, 20 px and 12
    px before the words, or 16 px and 8 px in a row 44 px or shorter. Calendar's empty day
    `event_available` ("No events · New event", 16), search's and ⌘K's nothing found `search_off`
    ("No emails match …", "No events or tasks match …", "No stories match …" at 20; "No command
    matches" at 16), Settings' "No rules yet · Add rule" `rule` (20), News's empty section
    `newspaper` ("Nothing new in Tech since Mon", 16); "4 hidden · Show all" keeps its
    `visibility_off`, now 8 px before its words. No new copy. The phone agenda's "No events" stays a
    bare label: it sits at the end of a day's header, beside the forecast's glyph, not alone on a
    line (Andy, 2026-10-11, polish audit motion-13).
166. **A place has its own line, and the time's line always names the calendar:** an event's second
    line in the right pane is always "7:00 – 8:00 AM · Personal", where it had named the place
    instead when there was one, so the line meant two things. The place follows on a line of its
    own, as Leave by does: `ink3` 12.5 after a 16 px `location_on` (6 px gap, 4 px above), its name
    or its address's street, or `videocam` and the link's host ("zoom.us") when the place is a
    link. The stacked facts (place, Leave by, Overlaps) share one 4 px gap (Overlaps had 2). No
    reminder glyph: it would sit on nearly every row. Boards 11 and the others draw the place in
    the line (override 29) (Andy, 2026-10-11, polish audit calpanes-12).
167. **A recurring event's card says it's a series, and its calendar fact takes its colour:** the
    floating detail adds a `repeat` fact after the attendees for an event with a recurrence, worded
    as the editor's repeat field words it ("Weekly on Mon, Wed, Fri", #53 and #64), so Gym's card no
    longer reads only "10 min before · Personal" until a drop asks This, Following or All. A
    repeating task keeps its own line. The calendar fact's `calendar_today` takes the item's colour
    (its own, else its calendar's), as the failed card's does, its name staying `ink2`. The date
    stays the title's subtitle, without a glyph (Andy, 2026-10-11, polish audit calflows-05).
255. **The phone reader's actions share the bar, Done leads, and none arrives late:** two, three or
    four actions take equal shares of the bottom bar, so an FYI email's Trash · Mark unread · Open in
    Gmail fill it rather than three quarters of it. Done, the phone's main job on Attention mail, has
    its label in `ink` 500 and its check in `good`; the rest keep `ink` icons over `ink2` labels. The
    bar fills once the email's row or the email is known, with Open in Gmail decided by its account
    (Gmail's mail always has the link), so nothing moves in or along when the email arrives; until
    then it's empty (Andy, 2026-10-11, polish audit phone-02).
256. **The phone's agenda marks today and now, and draws events as chips:** today's head reads
    "Today" in `ink` 500 before its date in `ink3`; a 16 px now-line (the right pane's: the time in
    `alert` 12 / 500 in the time column, a 7 px `alert` dot, a 1 px `alert` line at .7) sits before
    today's first timed event not yet over, or after its last, and only on a day with a timed event.
    Events are their calendar's tinted chips with the 3 px bar, as on the grids (34 px, radius 6,
    the title level with the tasks' titles, past ones at .55), where a 3 × 20 px bar was; tasks keep
    their ring. Each day's head stays at the top while its items scroll under it (Andy, 2026-10-11,
    polish audit phone-03).
257. **The phone's reader slides over the list:** opening an email slides the reader in from the
    right over 260 ms (`--ease`, the modal timing, as it takes the whole screen) while the list moves
    a fifth left and dims to .55 under it; Back, Done and Trash run it the other way, the row folding
    away as the list comes back. It's a view transition, so taps reach the page meanwhile; the
    browser's own Back (Safari's edge swipe) doesn't slide, as it animates itself, and without the API
    it's the cut it was. The agenda's detail rises 24 px into place as its scrim fades in, over
    180 ms, and the toast rises 8 px from the tab bar (Andy, 2026-10-11, polish audit phone-05).
258. **From 640 to 1099 px the sidebar is a rail and panes cover what they'd squeeze** (Layout ›
    Compact): an iPad or a half-width window had the reading pane 1 px wide at 640 and 152 at 820,
    and the month grid 252 px at 900. The sidebar is a 56 px rail of icons with Inbox's attention
    badge; an open email or story covers the list under the header, with Back leading its tools;
    Calendar's grid takes the width (764 px at 820) and the right pane lies over it while it holds
    the editor or search, the day's pane not drawn and its health lines atop the grid; the header's
    search narrows first. ⌘K keeps the rail's lost filters: "Inbox · Jobs", and Show or Hide each
    calendar (Andy, 2026-10-11, polish audit phone-06).
259. **Phone search has a way out, and acts only on what it shows:** while searching, a 32 px round
    clear button (an 18 px `close` in `ink3`; `sub2` and `ink` while pressed) stands where the
    desktop's Esc hint is, and a tap empties the field and lets go of it. Mark all as read leaves the
    header meanwhile, as it would read the hidden Inbox's mail, and an email opened from the results
    reads "‹ Search", going back to them (Andy, 2026-10-11, polish audit phone-07).
260. **The phone's tab bar says where you are and what waits:** the current tab draws its filled glyph
    (`inbox-fill`, `calendar_today-fill`); while Attention waits and the Inbox isn't showing, the Inbox
    tab carries the header's pill shrunk to 16 px (`caution`, `onInk` 10.5 / 600 figures, 8 px from
    the top and 6 px right of the tab's middle, a 2 px `panel` ring); a tap on the current tab
    smooth-scrolls its list back to the top, the agenda back to today (Andy, 2026-10-11, polish audit
    phone-09).
261. **The phone reaches the screen's edges in its own colour:** the page is laid out to the edges
    (`viewport-fit=cover`) and keeps clear of the status bar and the home indicator by their insets:
    the tab bar is 54 px with at least 6 px under its labels, the reader's bar 58, each taking the
    home indicator's inset when there is one, rather than a fixed 18 and 22 px. One `theme-color`
    follows the drawn theme's `page` (Night #050506, Light #f6f6f4), so Safari tints its bars to the
    theme picked in the app, not the system's (Andy, 2026-10-11, polish audit phone-10).
262. **The phone's list reads a step up** (Type): rows 15, ages and account labels 13, Attention's
    summaries 13.5, group headers 12 at 30 px, rows at least 62 px, a code's Copy 30 px; search's rows
    the same. The colours stay: the size makes `ink3` legible (Andy, 2026-10-11, polish audit
    phone-11).
263. **An email marked unread on the phone shows it:** Mark unread keeps the email open (by design),
    and now the list's unread dot (6 px `ink`, 10 px before the subject, on its line's middle) stands
    before the subject until Mark read; the dot and the swapped icon scale in from .4 over 120 ms. No
    toast (Andy, 2026-10-11, polish audit phone-13).
264. **On the phone the sign-in card sits 18% from the top** rather than near the middle, so the
    keyboard never covers Sign in; the mark shown while Setpoint can't be reached (#118) stands there
    too. The desktop is unchanged (Andy, 2026-10-11, polish audit phone-08; darma D145).
140. **The one toast says what happened** (amending #13 and #32): it drops in over 180 ms (from 8 px
    above at .96, from below on the phone), and again when a new one replaces the last, so two Trashes
    read as two; going, it fades over 120 ms. It leads with a 16 px glyph by what it says: `check` in
    `good` for a thing done ("Marked Done", "Marked 14 as read", "Completed Pay rent"), `delete` in
    `ink3` for one taken away ("Moved to Trash", "Deleted Dentist"), and `error` in `alert` for a
    failure, which also wears an `alert` ring (40%) and an 8% `alert` wash on its fill, its words
    staying `ink`, and stays 8 seconds rather than 6 so the provider's words can be read. Any other
    line has no glyph. A line with an action shows its time draining as a 2 px hairline (`ink3` at
    45%) along its foot, and both wait while the pointer rests on it (Andy, 2026-10-11, polish audit
    shell-03, shell-04, shell-12, motion-03, states-07).
141. **Overlays arrive with the motion Tokens names:** every menu and popover (the reader's More,
    Settings' selects and row menus, the editor's menus, pickers and Places, the proposal's menus,
    News's Upcoming, the attachment preview) grows in over 180 ms from 4 px and .97 at its anchor's
    corner, upward from below when it opens upward; the "+N" popover grows from its "+N"; the
    recurring-drop prompt and the failed card open as the floating detail does, .96 to 1 from their
    item's side. ⌘K rises 6 px over 180 ms and Settings 8 px over 260 ms, each scrim fading in with
    it (rising, not scaling: a big panel scaled in keeps its text drawn half a pixel off in
    Chromium), and a Settings page switch fades its content up 4 px over 120 ms. ⌘K,
    Settings and the "+N" popover fade out over 120 ms (Settings to .98), as the floating detail
    closes, taking no keys or clicks while they fade, with focus already back where it was; menus
    close at once. The reading pane's content, News's story pane and the editor opened by C, D or New
    slide in 12 px over 180 ms, as the editor does after E; J, K and another row swap what the pane
    shows without it. Alfred's Answer card and a proposal slide down 6 px over 180 ms, each new answer
    fading up 4 px, and closed (×, Esc, Cancel, Create) they fold away as a row does, so the email
    slides back up (Andy, 2026-10-11, polish audit motion-01, calflows-03, settings-02, shell-07,
    calpanes-10, reader-12, search-08, motion-08).
142. **Every menu is one component, and its button stays lit while it's open:** Settings', the
    reader's More, the editor's, the proposal's, ⌘K's items and News's Upcoming story share one look:
    a popover of radius 18 with 6 px inside, items 32 px high (Places' two lines 44) 2 px apart, radius
    10, 10 px in, `ink2` with a 16 px `ink3` glyph; the pointer and the keyboard's cursor both fill an
    item `sub2` with its words and glyph `ink` (in Light, `sub` on white barely showed); the checked
    item is `ink` with a check at its end, one that can't be picked .5. The export's 34 px and 12 px
    items, and Settings' radius 14, give way to it. While its menu is open, the button that opened it
    keeps a fill: an icon button, a reader tool or a quiet button `sub2` and `ink`, a ghost button
    `sub3`, a field its focused ring (Andy, 2026-10-11, polish audit motion-06, motion-05, reader-12).
143. **Every press registers before its result** (extending Motion and #12): a press goes in over 80
    ms and lets go over 120. A pill (a button, a reader tool, a segment, Unpin, Copy, the list's and
    the images bar's links, Download, Retry now, Reconnect) gives to .97 and a round icon button to
    .92, each taking a fill one step past its hover: the primary button `ink` at 78% on `page`, a ghost
    button the new `sub4` (Night `rgba(255,255,255,.17)`, Light `rgba(29,30,33,.15)`), an outlined one
    `sub2`, the rest `sub3` with `ink`. Wide things (rows, nav, account and Today lines, agenda items,
    News rows, calendar rows, menu items, ⌘K's items) never scale; they only take `sub3`. A disabled
    control doesn't give. A key whose button shows its hint presses that button as a click would (H
    Done, E Trash, P Pin, O Open, U, ⇧I Mark all as read, C New, T Today, E Edit). On the phone a tap
    fills a row, a group header, an agenda item or the reader's bottom-bar button `sub2` at once and
    lets go over 180 ms, the bar's and the tabs' glyphs giving to .88; hover fills answer only a pointer
    that hovers, so nothing stays lit after a tap, and the browser's own tap box is gone (Andy,
    2026-10-11, polish audit motion-02, shell-09, phone-01).
144. **The same kind of thing answers the same way on every page** (extending #12): News's rows,
    leads, Upcoming and its story, Show headlines' lines, More and the story pane's sources fade their
    hover over 120 ms as the mail list does, and so do calendar task chips, whose hover is `sub` so a
    hovered task no longer looks selected (`sub2`). Controls show the arrow, as darma's do: a link
    that's a control (the sidebar's nav, account rows and Today lines, agenda items), Noise's fold and
    Upcoming too, and rows, chips and day cells never the text cursor; dragging and resizing keep their
    own cursors. A calendar's checkbox fills or empties over 120 ms, its check growing in from .6 or
    shrinking away, and a Settings switch's knob stretches to 20 px toward where it's going while
    pressed (Andy, 2026-10-11, polish audit motion-09, motion-11, motion-14).
145. **A calendar chip answers in its own colour** (amending #12, where `sub` lay over chips):
    under the pointer a month chip or a week block lays its own colour at `--evhover` (Night 18%,
    Light 14%) over its tint, so it deepens rather than greying, over 120 ms; pressed, it gives to .97
    and deepens to 28% until a drag's lift takes over. A selected, solid chip keeps its `sub` (Andy,
    2026-10-11, polish audit grids-05).
146. **"+N" looks like a door into the day:** the month's "+3" takes a chip's footprint (20 px,
    radius 6, its count where the chips' titles start) and a `sub` hover, its open state staying
    `sub2` and `ink`, and after the count up to three 6 px dots show what it folds: an event's in its
    colour, a task's as a ring in its project's (Andy, 2026-10-11, polish audit grids-12).
149. **The glide carries its content across** (amending The glide, override 30): the old content
    fades out over 0–120 ms and the new fades in over 70–220 ms, overlapping by 50 ms, so the card is
    never an empty slab mid-flight; the 6 px slide, position, height and selection timings stay
    (Andy, 2026-10-11, polish audit calflows-12).
