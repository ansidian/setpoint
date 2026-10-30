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
  audit (`npm run audit:boards`) sets each board beside the app's page screenshot of the same
  state, where the release keeps one (D69, D281); the browser checks never compare with the boards.
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
| `panel` | `#0b0c0e` | `#f1f1ee` | sidebar, group headers, Settings nav |
| `card` | `#0c0d0f` | `#ffffff` | floating detail, prompt, attachments; in Light the proposal and Answer card |
| `cardOn` | `#131417` | `#ffffff` | focused search and fields, toast, drag tip, News's pill; in Night the proposal and Answer card |
| `chip` | `#0f1013` | `#ffffff` | inputs, tags |
| `modal` | `#0c0d0f` | `#ffffff` | Settings, popovers, ⌘K |
| `ink` / `ink2` / `ink3` | `#ecebe7` / `#a3a4a8` / `#7d7f84` | `#1d1e21` / `#4b4d52` / `#6d6f74` | primary / secondary / tertiary text and icons |
| `onInk` | `#050506` | `#ffffff` | text on `ink`, on the attention pill and on solid calendar chips |
| `edge` / `edgeOn` / `edgeHover` | `rgba(255,255,255,.055)` / `.12` / `.14` | `rgba(29,30,33,.1)` / `.17` / `.22` | borders / overlays, focus / under the pointer |
| `hair` | `rgba(255,255,255,.07)` | `rgba(29,30,33,.08)` | dividers, row lines, grid lines |
| `sub` / `sub2` / `sub3` / `sub4` | `rgba(255,255,255,.055)` / `.09` / `.13` / `.17` | `rgba(29,30,33,.04)` / `.07` / `.11` / `.15` | hover / keyboard cursor, open row, selection / tracks, segmented "on", a press / a ghost button pressed (#150) |
| `stripe` | `rgba(255,255,255,.045)` | `rgba(29,30,33,.05)` | hatching (drag ghosts, hidden images) |
| `scrim` | `rgba(0,0,0,.72)` | `rgba(20,26,32,.35)` | behind Settings and ⌘K |
| `caution` | `oklch(0.75 0.16 40)` | `oklch(0.535 0.16 40)` | attention pill and count, needs-reconnect bar, failing lines |
| `alert` | `oklch(0.72 0.17 25)` | `oklch(0.535 0.185 25)` | protected mail, failed changes, offline pill, destructive actions, now-line, Jobs's Rejected mark (#265) |
| `warm` | `oklch(0.8 0.11 55)` | `oklch(0.54 0.12 55)` | Business |
| `cool` | `oklch(0.8 0.11 235)` | `oklch(0.54 0.12 235)` | Personal (account and calendar), rain |
| `accent` | `oklch(0.8 0.11 235)` | `oklch(0.54 0.12 235)` | "you are here": the open email's bar, the current page's icon, today's month boundary, a date range, selected search chips, News's updates |
| `comf` | `oklch(0.8 0.11 165)` | `oklch(0.54 0.1 165)` | Work |
| `good` | `oklch(0.8 0.13 150)` | `oklch(0.53 0.13 150)` | done or healthy: the done glyph, the reader's Done check |
| `sun` | `oklch(0.86 0.16 92)` | `oklch(0.63 0.125 92)` | sun, Night's search highlight (26% mix) |
| `violet` | `oklch(0.8 0.11 300)` | `oklch(0.54 0.14 300)` | Jobs (account and calendar) |
| `cyan` | `oklch(0.86 0.11 182)` | `oklch(0.58 0.1 182)` | Classes |
| `onAlert` | `#1a0806` | `#ffffff` | text on `alert` |
| `sunGlyph` | `var(--sun)` | `oklch(0.58 0.14 78)` | the forecast's sun on the grids and the right pane, Jobs's Ghosted ring (#265) |
| `switchOn` / `switchKnobOn` | `color-mix(in oklch, var(--good) 58%, var(--modal))` / `var(--ink)` | `var(--good)` / `var(--onInk)` | a switch that's on: its track / its knob |
| `hl` | `color-mix(in oklch, var(--sun) 26%, transparent)` | `oklch(0.92 0.12 96)` | search's match highlight |
| `edgeFocus` | `rgba(255,255,255,.2)` | `rgba(29,30,33,.3)` | a focused field's border |
| `mailEdge` | `transparent` | `rgba(29,30,33,.1)` | the HTML email frame's ring |
| `navOn` / `navOnEdge` | `rgba(255,255,255,.10)` / `rgba(255,255,255,.07)` | `#ffffff` / `rgba(29,30,33,.10)` | the current page in a nav: its fill / its inset hairline |
| `dayOff` / `dayOut` | `rgba(255,255,255,.02)` / `.035` | `rgba(29,30,33,.028)` / `.048` | the calendar's weekends / days outside the shown month |
| `remind` | `oklch(0.8 0.11 345)` | `oklch(0.55 0.14 345)` | the editor's line: a reminder phrase's mark, and the Reminders row's glyph it filled (#258) |
| `inProcess` | `oklch(0.7 0.15 258)` | `oklch(0.52 0.16 258)` | Jobs's In process: its mark, its label and its events' node (#264) |

- **Roles** (#163): each colour has one job, so a screen has two or three anchors. **`accent`**
  says "you are here" (named for its job, with `cool`'s values, so recolouring Personal never moves
  it). **`good`** says done or healthy. **`caution`** says "needs you": the attention pill and count,
  Attention's band and dots, and health warnings, nothing else. **`alert`** says danger and now: protected
  mail, failed changes, destructive actions, offline, the now-line and today's disc. **`ink`** is the
  primary action (New, sign-in, OK: solid ink pills). The identity swatches show only as dots, chip
  tints and bars, never as control fills, and the AI has no hue of its own.
- **Accounts** (`--a-*`): Business `warm`, Personal `cool`, Work `comf`, Jobs `violet`, iCloud `ink2`.
  **Calendars** (`--c-*`): Personal `cool`, Classes `cyan`, Jobs `violet`. Both pick from nine of
  darma's 11 swatches in Settings, not `caution` or `alert` (#163); one picked before still shows.
- **Mixes** of a hue are `color-mix(in oklch, <colour> N%, transparent)` unless a base is named: tags
  (`alert` 10% on `chip` with a 40% edge; `caution` 12% with a 35% edge), the needs-reconnect bar
  (`caution` 9% on `page`, 22% bottom edge), calendar tint `--evtint` (Night 16%, Light 14%),
  deepening under the pointer by `--evhover` (Night 18%, Light 14%) laid over it in the chip's own
  colour, and by 28% while pressed (#152); as a change lands it starts at `--evland` (Night 34%, Light
  26%) and settles back (#192); Attention's band (`caution` 8% on `panel` in srgb, Light
  6%). A neutral (an ink or a surface) mixes in `srgb` or is an alpha token, never in oklch, which
  tints it (#160).
- **Theme numbers:** on the calendar, coloured text on its own tint caps its lightness at `--tintL`
  (Night 1, Light .43), keeping its hue and chroma (#159); the email frame's brightness `--mailDim`
  (Night .95, Light 1) (#171); Todoist's colours clamp their lightness to `--ringMin`–`--ringMax`
  (Night .72–1, Light 0–.55), keeping Todoist's hue and chroma (#175).
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
| The reader's code card | Geist Mono 22 / 500 / .12em |

On the phone the list reads a step up, as the reader's body (15) does: rows 15; ages, counts and
account labels 13; summaries in Attention 13.5; group headers 12; search's rows the same
([Decided while building](#decided-while-building) #144).

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
paint doesn't fade. A segmented control's fill slides to the segment turned on over 180 ms (#179). A
press goes in over **80 ms** and lets go over 120 ms (#150). The stories `N` brings onto News's list
settle in from `sub2` over 900 ms (#131): the longer motions are kept for arrivals, as are a
calendar change's landing (420 ms, #192) and an editor field another's change moved (600 ms, #187).

Overlays arrive on these timings ([Decided while building](#decided-while-building) #148): every
menu and popover grows from its anchor's corner (4 px and .97, 180 ms), the "+N" popover from its
"+N", and a card anchored to a calendar item opens as the floating detail does; ⌘K rises 6 px over
180 ms and Settings 8 px over 260 ms, their scrims fading in; a pane's content, and the editor however
it's opened, slides in 12 px over 180 ms; Alfred's Answer card and a proposal slide down 6 px, and
fold away when closed. ⌘K, Settings and the "+N" popover fade out over 120 ms; menus close at once.

**Loading** ([Decided while building](#decided-while-building) #225): a page whose data is on its
way draws its rows' skeleton in their shapes, bars in `sub2` (`sub3` inside a `sub` group). It
appears only after 200 ms, so a quick answer never shows one, fades in over 180 ms, then breathes,
every bar in phase: opacity 1 → .45 → 1 over 1600 ms `cubic-bezier(.4,0,.6,1)`, a loop for loading
only, as the spinner's 900 ms turn is. What replaces it fades in over 120 ms. Skeletons don't shimmer.

## Glyphs, icons and the mark

- **Icons:** Material Symbols Rounded, weight 300, FILL 0 (the `-fill` files are FILL 1 uses), as SVG
  masks from `glyphs/icons.json`. One size per role (#123): 18 in the sidebar, rows, the reader's and
  the story pane's tools and 30 px icon buttons; 17 beside a label in a button (Add, More options,
  the reader's actions) and in facts; 16 in small buttons, menus and inline links; 14 in chips and
  tags. A card's or popover's ×, and Add, in a 26 px icon button are 16; × is 18 only in a 30 px
  header button (Settings', the editor's). One glyph per meaning: account trouble `sync_problem` (sidebar, Settings › Accounts and its rows, the
  Inbox's bar), a failing News feed `warning`, Try again and Retry now `refresh`, Mark all as read
  `mark_email_read`, a Settings page its nav's glyph wherever it's named.
- **Tones** (#218): `caution` and `alert` are close in hue, so a state's shape says how serious it is
  before its words do. **Caution**, something Setpoint depends on struggling (a source failing or
  retrying, triage down, News's AI down, a feed failing, ntfy failing, a search that couldn't
  answer): `warning`, the outlined triangle, in `caution`. **Alert**, something of the user's that
  failed (a change, the failure toast, Alfred's failure, a Send test) or offline: `error`, the
  circle, in `alert`; offline keeps `cloud_off`. **Stale**, checks stopped: `history` in `ink3`.
  **Healthy** shows only in Settings: a 7 px `good` dot (#219). Account trouble keeps `sync_problem`
  everywhere, the Inbox's needs-reconnect bar included. 16 px in lines and in rows.
- **Todoist glyphs** (`glyphs/task-open.svg`, `task-done.svg`): open is a 13 px ring, 1.5 px `ink3`
  stroke (12 px, `ink2` on the grid), or its project's colour clamped to the theme's band, with the
  same colour at 14% inside, as a chip's tint; a ring that completes fills to 24% under the pointer
  and shows an 11 px `check` centred on it (#175); done is darma's filled disc with the check knocked
  out, in **`good`**, title struck through in `ink3`.
- **Unread:** a 6 px `ink` dot in a 12 px gutter at the row's start (Attention's `caution`, and a
  read Attention row not yet Done keeps a 6 px `caution` ring, #167); unread sender and subject are
  `ink` at 500, read are `ink2` at 400. A Noise row recedes: unread, `ink2` at 400 with an `ink3` dot;
  read, `ink3` (#168).
- **The mark** is **Day stack** (decision 44, #87): three calendar chips stacked, `cool` on top,
  `caution` lifted and tilted −6° in the middle, a shorter `violet` below. A bare 18 px glyph before
  the name, no tile, in the theme's tokens; they are the brand's and stay put when an account or
  calendar is recoloured. Never show it beside the pending spinner.
- **Alfred's mark** is `auto_awesome` filled with a gradient from `cool` to `violet` (bottom left to
  top right), two of Day stack's colours, wherever Alfred shows: Ask Alfred, the Answer card's header,
  and Ask about this email in the reader and ⌘K (#173). Nothing else about the AI takes a hue.
- **Favicon:** `favicon.svg` (the mark on darma's 32 px `card` tile, radius 7, with an `edgeOn`
  border, in Night's colours), 16 and 32 px PNGs (the 16 px one redrawn on its pixel grid: the middle
  chip level, set apart by the wider gap above it) and a 180 px square `apple-touch-icon`; no web
  manifest.

## Layout

### Shell

- **Sidebar** 248 px, `panel`, `edge` right border, padding 12 / 10:
  - the mark and **Setpoint** (36 px row, 8 px below). No search button: search lives in each
    page's header.
  - **Inbox** (32 px nav item, radius 10, `sub` hover; current, a raised `navOn` chip with an inset
    `navOnEdge` hairline and its icon in `accent`, #166): the **attention pill** (18 px,
    `caution` fill, `onInk` 11.5 / 600 text; not-Done attention, read or not) then the unread count
    (`ink3` 12).
  - **Accounts** under Inbox (28 px, indented 34 px; folded away on Calendar, #201): colour dot
    (8 px), label, unread count. A click filters the Inbox to that account (its row the `navOn`
    chip, Inbox its parent in `ink` without a fill); a needs-reconnect account adds a `sync_problem`
    glyph in `caution` before its count, keeping the count. Until they come, the ones this browser
    last showed, with their counts, or on a first visit three skeleton rows (#234).
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
  **right pane** 400 px. The reading pane collapses when nothing is open (decision 43); its left edge
  resizes it, and shows so under the pointer (#210).
- **Tab title:** "(3) Inbox" while attention mail is waiting, the subject when an email is open,
  "October 2026 · Calendar".

### Compact (640 to 1099 px)

An iPad or a half-width window keeps the shell's parts and stops squeezing them
([Decided while building](#decided-while-building) #140):

- **Rail:** the sidebar is a 56 px rail: the mark, then Inbox, Calendar, News, Jobs (after News, while it's on) and Settings as 40 × 40
  icons, each named in its tooltip, the current page the `navOn` chip with its icon in `accent` (#166;
  Inbox stays current while an account filters it, as the rail has no accounts). Inbox's attention pill is a 16 px badge on its icon (2 px from its
  top, 2 px past its right, 10.5 / 600, a 2 px `panel` ring). The accounts, the Today block, the
  mini-month and Calendars give way; ⌘K filters the Inbox by account ("Inbox · Jobs") and shows or
  hides each calendar.
- **Reading pane and story pane:** an open email or story covers the list under the header, its tools
  led by Back (`arrow_back`, "Back · Esc"); Esc, J / K and ↑ ↓ work as beside the list, and the edge
  doesn't drag.
- **Calendar:** the grid, month or week, takes the width. The right pane lies over its right side (400
  px, `page`, an `edgeOn` left edge and the popover shadow, in 24 px over 180 ms) while it holds the
  editor or search; the day's pane comes over it only from a 30 px `right_panel_open` button before
  search (lit `sub2` while open; it again or Esc closes it; closed on every load; under 720 px New is
  its + alone so the header stays whole, #196), and its
  sources' health lines sit atop the grid. The floating detail floats over the pane.
- **Header:** gaps 10; the search field narrows first (from 380, 520 while searching), then a calendar
  title longer than its 128 px ends in "…".

### The Today block (mail pages)

28 px rows: the next event ("2:30 PM  Dentist", time in `ink`, 58 px wide, "in 5h" right in `ink3`,
`caution` from 15 minutes before and `alert` once under way), led by its calendar's 3 × 14 bar where
tasks have their rings (#199), then each open task due today and tomorrow by name, today's first, behind its ring in its project's
colour, with "Tomorrow" right in `ink3` on tomorrow's. More than three tasks show the first two and
"3 more due tomorrow" (`ink3`), which shows the rest. Confirmed data only; nothing shows for an empty
line.

A line opens the floating detail's card (without its grip) 8 px right of the sidebar, its title
level with the line, over the page, which stays as it was; the line turns `sub2`. **Edit E** opens
Calendar's editor on the item; a task's ring, or Complete on its card, completes it in place with
"Completed Pay rent · Undo": its done check lands and its title is struck through, fading to `ink3`
(#200), for 360 ms, then the line folds away over 180 ms, and Undo folds it back
([Decided while building](#decided-while-building) #106); an item that isn't a repeating event
deletes; **Open in Calendar** shows it there with its card. Clone, Copy and Colour stay on Calendar.
Esc, × or a click elsewhere closes it; another line moves it there (#78).

## Mail

### The list

The Inbox is **one list** (#243): **New**, **Attention**, the **Pinned** shelf, then every email by
day. There is no Unread or All to choose between, and going to the Inbox always opens it.

- **Bands** 30 px, `panel`, `hair` above and below (none above the first), a 14 px glyph in `ink3`
  8 px before the label, 11.5 uppercase .08em `ink3`, count in `ink2`: **New** (`mark_email_unread`,
  its unread count), **Attention** (`flag`; the loudest: `caution` 8% into its `panel`, Light 6%,
  label, glyph and count in `caution`, a `caution` 20% line under it, #167), **Pinned** (`keep`),
  then each day's heading ("TODAY Wed, Oct 7"). A part with nothing in it doesn't show.
- **New** is every email that was unread when this visit to the Inbox first saw it, and it keeps
  them, read or not, until the user leaves the Inbox, so J and K never move the list (#243). It's
  drawn as a day is (see [The days](#the-days)), with ages rather than clock times: its Attention,
  Unsorted (with triage's note while triage is down) and FYI lanes, the kind once where an FYI run
  starts, its Noise folded to one line, the pattern prompt under its Attention, and **Mark all as
  read ⇧I** under it all, after a 16 px `mark_email_read` (#123), while it has anything to read.
- **Attention** holds every read Attention email not yet Done, with ages, until it's Done or
  Trashed; unread Attention mail is in New first and comes here on the next visit (#243).
- **Pinned** rows sit on their shelf, with ages, and Unpin takes the age's place under the pointer
  (board 10); a pinned email's line is its subject and summary.
- **Row** 38 px, padding 0 16 0 12: the kind column (100, as [The days](#the-days) say), the unread
  gutter (12), sender or organisation (200, ellipsis), subject then " · " and the summary in `ink3`
  (ellipsis), the **account** (dot and label in `ink3` 12, 76 px, on every row, decision 41, dropped
  only while the list is filtered to one account, #207), the age or time (72, right, `ink3` 12).
  Hover `sub`; the keyboard cursor `sub2`; the open email `sub3` with a 2 px `accent` bar at its left
  edge, and a press `sub3` at once (#164). Other chips drop while the reading pane is open; the
  account never does, the kind becomes a subheading (#237), and the sender narrows to a quarter of
  the row (#240).
- **Security row:** the organisation, then the extracted fact as the subject ("**New sign-in** ·
  MacBook Pro · Los Angeles"); protected mail keeps its subject in `alert` 500. A **code** row in
  New, Attention or on the shelf shows the code (Geist Mono, two groups of three), a **Copy** button
  and "Expires in 11 min" in `ink3`; it leaves the Inbox 15 minutes after arrival (Settings › Mail
  sets this). A copy the browser refuses says "Couldn't copy it" ([Decided while
  building](#decided-while-building) #109). In a day the code is inside the subject.
- **Loading:** until the list's first answers, its skeleton (#225): a day under its heading, and
  three more rows at the foot while the next page loads.

### The days

Every email, Noise included, newest first, under day headings ("TODAY Wed, Oct 7", "YESTERDAY Tue,
Oct 6", "MON Oct 5"), with **clock times**, not ages (decision 39), except what New, Attention and
the shelf show, which leaves its day meanwhile (#101, #243). Each day groups its rows by lane, and
the kind shows once, in a left column, where an FYI run starts, after its group's glyph at 13 px
(#119); with the reading pane open and on the phone, where the column has no room, it's a
subheading over its run instead (#237); each day's Noise folds to one line ([Decided while
building](#decided-while-building) #48). Done mail stays in its day, quiet, with a ✓ Done tag (#241).

### The reader

- **Tools** (48 px, `hair` below): Done `H` (on Attention mail not yet Done, #93), Trash `E`, Pin
  `P`, Open in Gmail `O` (each a 30 px pill with its key hint), then previous and next and More. Reply has a reserved place after Open in
  Gmail, empty until reply exists. In a pane under 600 px the key hints drop and the labels stay
  ([Decided while building](#decided-while-building) #107). Done's check is `good` and its label
  `ink`, the others `ink2` (#163); Trash turns `alert` under the pointer and presses in `alert` (#169).
- **Head** (padding 20 28 16): the subject (20 / 500), then triage's summary (#238), then a 32 px avatar, the sender's name, " ·
  organisation · via platform" in `ink2`, "to you", and on the right the account (dot and label) and
  the clock time, with the date before it on older mail
  ([Decided while building](#decided-while-building) #88). A verification code follows in its
  **code card**, with Copy and its countdown (#209). Each email swaps in from the side the user
  stepped from (#208).
- **Actions** (28 px outline buttons, labels `ink2` and icons `ink3`, `ink` under the pointer, #170):
  **Add to calendar**, **Add as task**, **Ask about this email**.
  Security mail has no Add to calendar; it shows the **facts card** instead (board 03: what happened,
  when, device, location, "not a place you use" in `alert`), and protected mail says "Protected ·
  always stays in Attention".
  On Security and Noise mail, Add to calendar and Add as task move into the tools' **More** menu
  ([Decided while building](#decided-while-building) #4).
- **Body:** plain text at 14 / 1.55, max 600 px; HTML in a sandboxed frame as wide as the reading
  pane and as tall as the email, on a white card of radius 14 that keeps it 16 px from the top and
  bottom and up to 20 px from the sides, leaving it at least 600 px
  ([Decided while building](#decided-while-building) #77, #254),
  the card dimmed to 95% in Night and ringed with a 1 px `mailEdge` hairline in Light (#171). The
  body starts 12 px under the actions (#170).
- **Images:** remote content loads for a sender that passes DMARC and isn't Noise. Otherwise the
  **images-hidden bar** (34 px, radius 12, `sub`): "Images hidden · Show · Always show from
  contosocoffee.example" (trust per domain); each hidden image keeps its place as a hatched
  placeholder (#211).
- **Attachments:** 44 px cards (radius 14, 280 wide, wider to show the whole name, #61) with the
  type's tile (#122), name and size, then the preview's eye and **Download** with its glyph; PDF,
  image and CSV open a preview.
- **Opening:** the tools and the head draw from the email's row at once; only the body waits, a
  skeleton meanwhile (#229).

### Search

- `/` or ⌘F focuses the header field (focused: `edgeFocus` border, `cardOn` fill, its hint `Esc`;
  #172). Results replace the
  list; the reading pane and `J` / `K` work the same.
- Recognised words become **chips** in the field (22 px, `sub2`), each with a small label in `ink3`
  and an ×: "Org Northwind ×", "Type Rejection ×", "Date Mar 2026 ×", plus account and kind. One
  case style: the label capitalised.
- **"!" before a word leaves out what it names** (#85): one that forms a chip gives a **Not** chip
  ("Not Type Confirmation ×"); one that doesn't stays in the field as typed ("!proseware") and leaves
  out the mail that has it.
- A results line: "2 results · newest first". Each result shows why it matched ("Type Rejection",
  `ink3` 12) where its lines don't already show it (#212), and highlights matches (`hl`: `sun` at 26% in Night, a highlighter
  yellow in Light, #172).
- The first row offers **Ask Alfred ⌘Enter**, above the results line, as board 06 draws it
  ([Decided while building](#decided-while-building) #80), in `ink` with Alfred's mark, its words
  after it in `ink3` (#173).
- No results: "No emails match" and each chip as the field draws it, removable by its × (#213),
  after a 20 px `search_off` (#124).
- **On its way** (#235): until the first answer the list stays at .55, then the results' skeleton;
  the field's glyph turns while a search is on its way; a refinement dims the results it replaces.

### Alfred's Answer card

A `card` above the results (board 07): Alfred's one or two lines, the **sources** (rows that open
in the reading pane), each follow-up turn below the last, and a follow-up field at the bottom. From
the reader, **Ask about this email** opens the same card scoped to that email. "Couldn't find that
in your mail" says what it searched. While Alfred works, its trail says what it has done and what
it's doing (#236, amending #80); more than five sources show the first five and **Show all**
([Decided while building](#decided-while-building) #80). About one email, its first line is "Reading this email…", and the follow-up field waits at
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
  have `hair` right and bottom lines; weekends take `dayOff`, days outside the month `dayOut` (an
  outside weekend too), the selected day `sub` (#160) with its number on a `sub3` disc (#190). A day under the pointer takes `sub` at 55% over
  its tints (120 ms), and a 20 px + after its number (`add` 14 in `ink3`, `sub2` and `ink` under the
  pointer, "New event · C") makes an event on that day, selecting it; a click on the day still only
  selects it (#180).
- **Day head** 22 px: the number (12.5, `ink2`, `ink3` once the day is over (#161); today a 22 px
  `alert` disc with `onAlert` 600 (#165); "Oct 1" and "Nov 1" at 500), and the weather icon at the end (16 px:
  sun `sunGlyph`, cloud `ink2`, rain `cool`), after the high in `ink2` and the low in `ink3` (#174).
- **Events** are **tinted chips** (decision 38): 20 px, radius 6, the calendar colour as text, its
  lightness capped at `--tintL` (#159) (12 / 500, the time at 400 and .8), a 3 px inset left bar, and
  the colour at `--evtint` as fill. The **selected item turns solid** (colour fill, `onInk` text, no
  bar) and is the only selection mark: no outline ring. **Past** items turn grey: `ink3` text and time,
  the colour's bar at 45% and its fill at half `--evtint` (#161). Titles end in "…".
- **Tasks:** the ring or done glyph and the title in `ink` 12; hover and selected `sub2`.
- **Overflow:** what doesn't fit folds into "+3" (`ink3` 12) on a chip's footprint (20 px, radius 6,
  the count lined up with the chips' titles, `sub` and `ink2` under the pointer), then up to three
  6 px dots 3 px apart for the first items it folds: an event's filled in its colour, a task's a
  1.5 px ring in its project's (#153). Its popover lists the day's every item (board 11b) and closes
  with Esc.
- Infinite vertical scroll through months.
- **Paging:** ← → or `P` `N` a month and `T` today glide the grid there over 260 ms; a month more
  than 10 rows away is first jumped to 5 rows short, on the side it comes from, and glided from
  there. Pressed again mid-glide it goes on from where it is, and the wheel, a touch or a press stops
  it; the mini-month, links and Month from Week jump. The header's title swaps over 120 ms, rising 6 px
  for a later month and falling for an earlier one, a week's sliding 6 px with its days; as Today
  lands, today's disc (here, in the week's heads and in the mini-month) swells to 1.18 and back over
  260 ms (#177, #178).

### Sidebar on Calendar

The **mini-month** (26 px discs, six rows always; today an `alert` disc (#165); the selected day a
`sub3` disc, the pointer `sub2`; in Week the shown week one `sub2` band; no other marks, #188) with
‹ › stepping, the days sliding in from the side they come from. **Calendars:** 30 px rows, a 14 px checkbox in the calendar's colour
on the left (off: an outline, and the name `ink3`), the name; **Todoist** reads as the others, its
checkbox and name with no mark of its own. Toggled, a calendar's items fade out over 120 ms before they
go, or fade back in over 180 ms (#185). With every calendar off, a 16 px `ink3` `visibility_off`
follows the header's title (#113).
Until the calendars have come, four skeleton rows: a 14 px box (radius 4) and a bar (#227).

### Right pane

Default: the selected day (board 11): the date, its weather ("Sunny · 78° / 61°"), **Events** (time,
a 3 px colour bar, title, "7:00 – 8:00 AM · Personal", always the calendar; the place on its own
line in `ink3` 12.5 after a 16 px `location_on`, or `videocam` and the host, "zoom.us", for a link,
#125; recurring glyph; the next one today lifted on a tint of its colour with "in 5h" in it, and
once under way under the now-line with "45m left" and its bar filling, #183; past ones grey, #183; "Leave
by 2:05 PM · 18 min" for Time to Leave, `caution` from 15 minutes before it until the event starts,
then gone, #112), the **now-line** in `alert` with the time, 1.5 px with an 8 px dot on the colour
bars as the week's (#184), then **Tasks · due today** with their projects. Another day picked slides its items in 6 px from its side and fades its heading in (#190).
An empty day offers New event C and New task D as dashed ghost rows (#191); one whose items are only
hidden reads "4 hidden · Show all" (#113). The footer holds "New event C · New task D". The pane also holds the
editor and calendar search results; while those show, the grid dims what they don't match (#195). Until the day's items and the calendars have come, its line is
a 110 px bar and its agenda three skeleton rows (#227), never "Nothing planned" or the empty day.

### The floating detail

- **Card:** 280 px wide (decision 46), `card`, radius 18, `edgeOn` inset, popover shadow, a drag grip
  at the top. Content (board 12a): colour dot and title, date and time, place and address (a link
  as its host with Open, #245), Time to
  Leave (as the right pane's, #112), attendees, a recurring event's repeat ("Weekly on Mon, Wed,
  Fri", #126), reminders (the presets in one line, then each other one at its moment, #255),
  calendar (its glyph in the item's colour, #126); then **Edit E** and icon
  actions (duplicate, copy, colour, delete). A task's card draws its ring in its project's colour and
  its project as a 9 px dot in it, has no Colour, and is struck through once done (#186). Delete stands apart after a `hair` divider and turns
  `alert` under the pointer, a task's Complete `good` (#169).
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

In the right pane (board 13): the **line** parses as you type ("Dinner with Sam fri 7-9pm
@Blue Door" → date, time and end, place, calendar, each parsed token marked; an event's length
after "for" and its span of days too, #256, a length in whole days with no time all day over
them; days counted from today, "in 3 days", "next week", "this weekend", "end of month", and after
a repeat when it ends, "until dec 15", "6 times", "for 2 weeks", #259; reminders after "remind",
"remind me" or "reminder", an offset or a moment ("remind me 1h before", "reminder sun 8pm"), in a
tint of their own, #258; a
line longer than the field shows where it's typed,
the cut side fading, #110). A new item is that one line, as an edited one is: its title is the
words left unlit, with no Title field under it, and a click on a lit phrase (or ⌥⌫ inside it)
keeps it as words (#257). A small **?** at the line's trailing edge opens **What the line reads**
under it, one example of each kind of phrase and what it reads (#260). Then **Places**
suggestions under the place, the calendar picker, recurrence, reminders (default from Settings ›
Notifications; the presets, then **Custom…** last for a date and time, before or after the start,
#255) with **Time to Leave** added from the same menu, never by default (#86), and the
**conflict preview** (a small timeline of the day: "Overlaps Study group ·
1h 30m"). In the date picker the chosen day is the strongest mark and today a ring, and the editor's
menus tick their current choice (#189). Each row the line filled takes its mark's colour on its glyph, a mark still being typed is
only dashed until it's picked and lands, and a field another's change moved flashes (#187). **Batch drafts** add a second event ("Create 2 events ⌘Enter"). A Todoist task uses the same
editor with project, labels and due date; a new one's due date has an × that sends it with no date (#244).

### Recurring events

Editing (board 14) or dropping (board 15b) one occurrence of a recurring event asks **This event**
(default), **This and following** or **All events**, each with its consequence ("Thu, Oct 8 only",
"Wed → Thu from Oct 7 on", "Wed → Thu, past ones too"), with Move or Save ↵ and Cancel Esc. While a
drop waits, the origin shows as a dashed ghost and the agenda says "Moving to Thu, Oct 8".

### Drag

A dragged chip lifts (tilt −1.5°, scale 1.04, popover shadow, easing in over 120 ms), its origin
becomes a dashed ghost in its colour, and a tooltip names the target day and time (board 15). The day
under it takes the item's colour and shows a dashed slot where it would land; dropped, the chip settles
from the lift into its place (#194). Tasks move by whole day.

### Week view

Board 16, Sunday-first (override 16), built before 2.0 at Andy's ask with resizing in it
([Decided while building](#decided-while-building) #81; darma SV-18 D64).

- **Header:** "Oct 4 – 10, 2026" (min 128 px; "Sep 27 – Oct 3, 2026" across months, "Dec 27,
  2026 – Jan 2, 2027" across years), ‹ Today › paging a week, Month | Week. Tab "Oct 4 – 10, 2026 ·
  Calendar". `M` and `W` switch; Week opens on the selected day's week, Month on its month, Week zooming in from
  that week's row in Month and Month settling back out around it, over 180 ms (#179). The view
  rides in the address (`?view=week`) and the last one used is remembered, so Calendar, `2` and links
  open in it.
- **Layout:** a 56 px gutter, then seven columns filling the width (139 px at the design target,
  down to about 90 with titles cut). The **day heads** (48 px) and the **all-day row** stay put while
  the hours scroll under them. The right pane stays.
- **Day head:** the weekday (11.5 uppercase `ink3`), the date (14 / 500 `ink` on a 24 px disc, today
  the 24 px `alert` disc at 600, #165, #182), the weather icon, 7 px apart. A click selects the day; under
  the pointer it takes a month day's wash (#180).
- **All-day row:** all-day events as tinted bars spanning their days, then each day's tasks (a timed
  one prefixed "9:00 AM"), 20 px lines 2 px apart, at least two lines and at most three: a day with
  more shows two and "+N", which opens the day's popover (board 11b). An event of 24 h or more is a
  bar here too.
- **Hours:** all 24, 44 px each, `hair` lines, the gutter's labels in `ink3` 11. Weekends take
  `dayOff`, the **selected day's column `sub`** (today by default, so board 16 reads the same),
  and today's column the **now-line** (1.5 px `alert`, an 8 px dot at its start, the time in the
  gutter in `alert` 500), which runs on faintly through the other six days (1 px, `alert` at 55%, under
  today's, #182).
- **Opening scroll:** this week puts the now-line about a third down; another week an hour before
  its first timed item, else 7 AM. Paging keeps the scroll.
- **Blocks:** the month chip's tint, bar and colours (`.wb` in board 16): the title at 500, the time
  under it at 400 and .8; at least 20 px; under 50 minutes (no room for a second line) the time follows the title on one
  line ("Standup, 9:00 AM"), and the place shows under the time where a whole line is left for it; in a
  lane a block gives its start alone, as a month chip does ("7 PM"), and one with room for four
  lines wraps its title to two; no line is drawn cut off; titles end in "…" (override 10). Selected solid, past grey as a chip (#161), pending .5 with
  the spinner, failed outlined in `alert`. An event crossing midnight draws in both days.
- **Overlaps:** each run of overlapping events shares its column in up to three equal lanes; a
  fourth or more folds into "+N" at the run's top, opening the day's popover.
- **Paging:** ← → or `P` `N` a week, `T` today; the grid slides 24 px and fades over 180 ms in the
  direction of travel. A two-finger horizontal swipe pages too. The mini-month marks the shown week
  (`sub`, board 16); a day picked there shows its week and selects it.
- **A click** on an empty slot or a day head selects the day; with a new draft open it moves the
  draft to that day and, on a slot, that time (keeping its length), unless its line names them (#47).
  A click never creates on its own.
- **Where a press would start:** under the pointer, empty hours show a 30-minute slot (22 px, radius 6,
  `sub` with an `edge` inset) at the 15-minute step a press would start at, holding + and that time
  ("10:30 AM", 11 `ink3`), moving with the pointer over 120 ms and fading in and out; it goes over a
  block, off the hours and on a press (#181).
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
  empty week draws nothing more (the agenda offers its ghost rows, #191); a failing source's line
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
  in `ink3` (Local `location_on`, Tech `computer`, AI `auto_awesome`, General `public`; #120).
  - In All, the blocks come in a fixed order: Local, Tech, AI, General. A story in more than one
    section shows once, in its main section's block (#96).
  - Each block shows its **top 3–5 stories, biggest first**, then "12 more in Local". That's a 36 px
    link in `ink2` 12.5 with a chevron, and it opens the section.
- **Lead story** (each block's first; also the first of a section's list and of each Missed day):
  - Layout: a grid of 12 | 232 | text, 14 apart, padding 14 16 14 12, `hair` below.
  - Image: 232 × 130 px, radius 12.
  - Text: the headline 16 / 500 `ink` at 1.35, still `ink` once seen, at 400; the summary `ink3` 13 /
    1.45, clamped to two lines; the meta line at the foot (#127).
  - When the list is 1000 px or wider (nothing open at the design target), the lead grows: 12 | 320
    | text, 18 apart, padding 16 16 16 12; the image 320 × 180; the headline 19 at 1.3, −.01em, max
    760; the summary 13.5 / 1.5, three lines, max 680 (#127).
- **Story row:**
  - Layout: a grid of 12 | 1fr | meta | 72, 12 apart, padding 9 16 9 12, `hair` below.
  - The headline: 13, `ink` 500 when new or updated, `ink2` 400 once seen.
  - Under it, the summary in `ink3` 12.5, one line, ellipsis. In a list under 480 px the headline
    wraps to two 18 px lines instead and the summary goes; the row keeps its height (#128).
  - The meta, right-aligned on two lines: the leading outlet and "+N" in `ink2` 12, then the age in
    `ink3` 12, or "Updated 7:55 AM" in `cool`.
  - The thumbnail: 72 × 48, radius 8. A story without an image leaves the column empty, never a
    placeholder, except one led by a hazard source (NWS, USGS, Cal Fire, AirNow): its hazard's 22 px
    glyph in `caution` on a 72 × 48 tile, radius 8, `caution` at 10% with a 22% inset ring (#121).
  - A lead without an image led by a hazard source puts its hazard's 18 px glyph in `caution` before
    the headline, rather than a large empty tile (#121).
- **The dot** (6 px in the 12 px gutter): `ink` for **new**, as unread mail; `cool` for
  **updated**; none once seen, from the next visit (#95), an opened story's shrinking out in its
  colour over 180 ms (#131). Hover is `sub`; the keyboard cursor and the open story are `sub2`.
- **Meta copy:** "KTLA +4 · 1h · Updated 8:40 AM". Ages follow [Copy](#copy). Missed rows lead with
  the section, the story's main one (#96): "General · NPR +9 · Tue".
- **Images:** Setpoint's own resized copy, cropped to fill (`object-fit: cover`). The boards draw
  tinted placeholders instead. While one loads its box breathes in a skeleton's fill, then it
  fades in over 180 ms; every news image has a 1 px `edge` hairline inside its edge (#230).
- **Loading:** until the list's first answer, its skeleton: a section header, a lead and three
  rows per block in All, a lead and six rows in a section (#231).
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
  - A click or `N` re-sorts the list and scrolls it to the top. The stories it brings onto the list
    settle in from `sub2` over 900 ms.
  - It drops 8 px into place as it fades in over 180 ms; under the pointer its ring turns `edgeHover`
    and its arrow `ink` (#131).
- **A section with nothing new:** one 44 px line in `ink3`, "Nothing new in Tech since Mon", only
  when its own list is empty too. A block whose stories all show in other blocks (#96) has just its
  "2 more in Tech" link (#116).

### The story pane

- **Tools** (48 px): **Open at KTLA** `O` (the leading outlet's article), then a spacer, previous,
  next and More.
- **Opening** (#232): the head and the image draw from the story's row at once; the summary and
  Sources are a skeleton until the story comes; each story or article eases in as it's opened or
  stepped to.
- **Head** (padding 18 28 14):
  - its sections as tags, each with its section's 14 px glyph in `ink3` (#120), plus "Updated" as a
    `cool` tag when it changed since Andy last looked
  - the headline (20 / 500)
  - the meta in `ink3` 12.5: "5 outlets · first reported 6:12 AM · updated 8:40 AM"
- **Image:** inset 28 px, 220 tall, radius 14. The outlet's name sits in a caption pill at the
  bottom left (11, `ink2` on `page` at 72%).
- **Body** (padding 18 28 24, 18 apart), from the top:
  - **New since you looked**, only on a story updated since Andy's last look: a card (radius 14,
    `cool` at 8% over `card`, `cool` 24% ring). It has the label "New since you looked · Mon 10:40
    PM" (11.5 uppercase `cool`) and one line per new fact: its time (60 px, `ink2` 12.5), then the
    fact in `ink`. With six facts or more, the newest four show, then "6 more" folds the rest away
    (#130).
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
  - The image (240 tall), then the extracted text at 16 / 1.65, −.003em, paragraphs 16 apart, max
    600 (about 79 characters a line), in Night `ink` mixed 10% toward `ink2` (#129): its paragraphs
    and list items, without the outlet's membership appeals (#114).
- **An article that can't be read in-app** (board 26b):
  - A note (radius 12, `sub`, `info`): "KTLA's page can't be read here, so this is its feed
    summary", with a solid small **Read at KTLA**.
  - Then the feed summary, and **Also in this story**, listing the other sources.

### Missed

Board 28 replaces All's list.
- **Back row** (44 px): the back arrow (back to All), "Missed since Mon 10:40 PM" (14 / 500), and
  the count in `ink3` on the right.
- **Day headers** are section headers ("TUESDAY", with "Oct 6" on the right), on `history` (#120).
- Under each day, up to 5 stories per section, biggest first, the first as a lead. Each row names
  its section in the meta. A lead's image is its story's large copy, kept while the story is in
  Missed, never its thumbnail stretched (#115).
- A story leaves Missed once it's seen, but the list holds for the visit, as All's order does: rows
  seen while it's open keep their places. Back in All, the strip is gone once Missed is empty, and
  Missed opened with nothing in it is All (#117).

### States

- **AI down** (29a): a failing line at the top of the list (32 px, `caution` 12.5, led by `warning`,
  #218): "12 articles not sorted yet, Anthropic unreachable since 8:52 AM, retrying". A ghost small **Show headlines**
  lists the raw headlines with their links.
- **A stale section:** the muted line under its header, "AI, as of 7:02 AM", led by `history`
  (#218). Its stories stay.
- **A failing feed** shows only in Settings › News, unless its whole section is affected (BRIEF ›
  When things break).
- **First run** (29b):
  - The muted line "Sorting the last 48 hours · 186 of 312 articles · showing what's sorted so
    far", its progress along its foot (#223).
  - No Missed strip.
  - A section with nothing yet says "Nothing sorted in AI yet", turning as the first run's line does
    (#223).
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
  - **This month**: a 160 × 6 meter, `ink3` on a `sub2` track, `caution` from 90% of the cap, then
    "$18.40 of $40" in `ink` (#134)
  - **Usage this month** lists Triage, Alfred and News, with News broken into articles, grouping,
    stories and ranking, each cost in `ink` 500; its label carries the month's total (#134).

### Keys and behaviour

- **Keys:** `3` News; `J` / `K` move; Enter opens the story; `O` opens the original article; `N`
  takes the new stories; Esc goes from an article back to its story, then closes the pane.
- **Seen:** a row fully on screen for about a second, or opened. Stories behind "N more" stay new
  until their section shows them. No "mark all seen" (D87).
- **The order holds** while the page is open. A story on screen updates its dot, sources and
  summary in place; everything else waits for the pill.
- **Thumbnails** are Setpoint's copies and expire with their story. Never an AI-generated image.

## Jobs (after News)

[BRIEF.md › Jobs](BRIEF.md#jobs-after-20) owns what Jobs reads, what makes an application, how a JD
is found and kept, and what it costs (darma D303–D327). The screen comes from design round 4:
[design-export/jobs/](design-export/jobs/README.md), boards 32–40 plus 32b, 34c and the states
strip, drawn 2026-10-29 and signed off by Andy (darma SV-118). Each board's motion, with its values,
is in [`motion.md`](design-export/jobs/motion.md), and Jobs's components in
[`jobs.css`](design-export/jobs/jobs.css), which adds no tokens. Jobs is built after News, desktop
only (D303). Below 640 px it isn't in the navigation; a narrow window (640–1099 px) is still the
desktop and keeps it (D325).

### Shell

- **Sidebar:** a **Jobs** item (`work`) under News. Its count is the Needs you count, in `ink2` 12,
  never `caution`, and gone at zero; its tooltip "Jobs · 3 need you". Jobs informs and never nags
  (D313). The lower section shows **Today**, as on mail pages.
- **Header:** "Jobs"; the **status filter**; a spacer; **Per week**; the 380 × 32 search field,
  "Search jobs" with its `/` hint. There's no primary action. The status filter and Per week are the
  page's two numbers, and there are no others (D314).
- **The status filter** is the segmented control, holding the counts by status: "All 62", "Applied
  31", "In process 3", "Offer 1", "Rejected 25", "Withdrawn 2", each count `ink3` 12, tabular, and
  `ink2` on the segment turned on. So a count is also the filter. A segment never wraps. Ghosted
  counts under Applied (18 of its 31) and has no segment.
- **Per week** (32 px, padding 0 10, radius 10, `ink3` 12; `sub` under the pointer):
  - "Per week", then the last 12 weeks oldest first as bars: 5 px wide, 3 apart, the busiest week 20
    px tall and the rest in proportion, radius 1.5 at the top, `ink3` at 70%. A week with none is a
    1 px stub at 35%.
  - This week's bar is an outline (a 1 px `ink3` inset ring), since the week isn't over. It counts
    what the table shows, Track this included (D318).
  - Then "**3** this week", the count in `ink2`.
  - A bar under the pointer turns `ink` and names its week in a tip (26 px, radius 8, `cardOn`, an
    `edgeOn` ring, the pill shadow, 12): "Sep 27 – Oct 3 · 8 applications". It has no press: it's
    information.
- **Content:** Needs you, then the table, in one column that scrolls under the header. The
  **detail** sits where the reading pane does (680 px, `hair` left border) and collapses when
  nothing is open.
- **Tab title:** "Jobs", or "Software Engineer I · Northwind Talent" with an application open. No
  count, ever.
- **A narrow window** (32b, D325):
  - **Rail:** Jobs's 40 × 40 slot comes after News, named in its tooltip. Its Needs you count is a
    16 px badge placed as the Inbox's (10.5 / 600, a 2 px `panel` ring), but neutral: `sub4` with
    `ink` text, not `caution`.
  - **The detail** lies over the table under the header (`page`, no left border), its tools led by
    Back (`arrow_back`, "Back · Esc"); Esc, J / K and ↑ ↓ work as beside the table. It arrives 12 px
    from the right over 180 ms, and Back slides it off the same way.
  - **Header:** both numbers stay. The search field gives way first (180 px at 1024), then the "Per
    week" label; the chart keeps its bars and count.

### Needs you

- **The band** (D308, D311) sits above the table under a group header (mail's: 30 px, `panel`, 11.5
  uppercase): the 14 px `pending_actions` in `ink3`, "Needs you", and its count in `ink2`.
  Attention's place, without `caution` (D313). Empty on a good day, and then gone.
- **An item** (34a):
  - Layout: a grid of 12 | 18 | text | right, 10 apart and 7 between its lines, padding 10 16 11 12,
    `hair` below, `ink2`.
  - Its kind's 16 px glyph in `ink3`: `description` a JD to confirm, `alt_route` an update to
    assign, `bookmark_add` an email to track.
  - Line one (18 px): what it's about in `ink` 500, ellipsis, then "· Is this the posting?" or the
    sender ("· Humongous Insurance via iCIMS") in `ink3`. On the right in `ink3` 12, the account's
    dot and the email's age ("Yesterday", "1h"), or "Applied Oct 5" on a JD.
  - Line two: why it's here in `ink2` 12.5, then its actions as 28 px small buttons.
  - Hover `sub`. J / K reach the items before the table, the cursor `sub2`. The item isn't a button;
    its actions are.
- **A JD to confirm** ("Lucerne Publishing · Junior Developer · Is this the posting?"):
  - The candidates as a `sub` group (radius 12, at most 560 px wide) of 32 px rows, padding 0 6 0
    12, 10 apart: `radio_button_unchecked` 16 in `ink3`; "Junior Developer" in `ink` and "· New
    York, NY · Greenhouse" in `ink3`; and a 26 px `open_in_new` icon button that opens the posting
    in a new tab without picking it. The last row is **None of these**, after `block`, in `ink2`.
  - A row under the pointer or the cursor takes `sub2` and its radio `ink2`; pressed, `sub3` and
    `radio_button_checked` in `ink`. ↑ ↓ choose and Enter picks.
  - Picked, the group takes `good` at 10% with a 35% `good` ring, and the row reads `check_circle`
    in `good`, "Junior Developer · JD saved".
- **An update to assign** ("Thank you for your interest in the Software Engineer II role · Humongous
  Insurance via iCIMS"):
  - "A rejection · it could be either Humongous application", then an outline small **Assign to…**
    (`move_item`, and `expand_more` in `ink3`, turning while open, the button `sub2` with an
    `edgeOn` ring), and a quiet **Not about a job**.
  - Assign to… (312 wide) grows from the button's bottom-left corner: the company as a label
    ("HUMONGOUS INSURANCE", 26 px, 11.5 uppercase `ink3`), its applications as 44 px items with
    `work` and two lines ("Software Engineer II, Claims" over "Applied Sep 30 · Applied" in `ink3`
    12), a divider, **Another application…** (`search`) and **Not about a job** (`block`). A pick or
    Esc closes it at once.
- **An email to track** ("Can we set up a call this week? · Wide World Importers"): "An interview
  request with no application", then **Track this** (`add`), a solid small button, the page's only
  one, and a quiet **Not about a job**.
- **Answered** (34b, as the Today block's task, #106): the press lands, and line two crossfades to
  the outcome (120 ms out, 120 in): a 16 px filled `check_circle` in `good` and "JD saved" in `ink`
  12.5, then "· Junior Developer · New York, NY · Greenhouse" in `ink3` ("Tracked · Wide World
  Importers" for Track this). At 360 ms the item folds away (height over 180 ms, opacity over 120)
  and what's below rides up; the band's count and the sidebar's change as the fold starts. The toast
  says what happened, with Undo: "JD saved for Lucerne Publishing · Undo", "Tracking Wide World
  Importers · Undo"; Undo folds the item back. The row its answer changed settles in from `sub2`
  over 900 ms.
- **The last item** leaving folds the whole band, header and all, over 180 ms.
- **From history** (D311, D324):
  - Folded, a 36 px line under the items (padding 0 16 0 34, `hair` below, `ink2` 12.5):
    `chevron_right` 16 in `ink3`, "From history" with its count in `ink3`, then "· what the history
    pass wasn't sure of" in `ink3`. Under the pointer `sub` and `ink`. With nothing else waiting, it
    stays on its own.
  - Unfolded, its chevron turns 90° and its rows unfold over 180 ms; **Dismiss all**, a quiet small
    button (26 px), sits at the line's right, its tooltip "The same as ignoring each one: those
    emails make nothing".
  - Each row is 36 px: a grid of 18 | text | date | actions, 10 apart, padding 0 16 0 34, `panel` at
    50% behind it, `ink2` 12.5. Its kind's 16 px glyph in `ink3`, then the email's subject in `ink`
    and why in `ink2` ("**Thanks for your interest in the Support Specialist role** · Relecloud ·
    names a role neither application has"; "**Margie's Travel · Associate Developer** · Is this the
    posting? · 3 candidates"); the date in `ink3` 12 ("Aug 30", "Applied Jun 2"); and two 24 px
    buttons at 12: outline **Assign to…**, **Choose…** or **Track this**, and quiet **Not about a
    job** or **None of these**.
  - **Choose…** (not drawn) opens a menu from the button's bottom-left corner, as Assign to… does:
    each candidate a 44 px item with `description` and two lines (the role over "New York, NY ·
    Greenhouse" in `ink3` 12) and its 26 px `open_in_new`, then a divider and **None of these**
    (`block`). A pick saves the JD and the row folds away as an answered item does, with "JD saved
    for Lucerne Publishing · Undo" (#266).
  - Dismiss all folds the rows away together (180 ms), then the line, and says "Dismissed 6 from
    history · Undo" (D324).

### The table

- **Columns,** with the detail closed (34a): a 12 px gutter | Company 220 | Role | Platform 120 |
  Applied 72 | Status 300 | JD 128, 12 apart, padding 0 16 0 12.
- **Beside the detail** (32): Platform drops and JD is a glyph alone, as mail drops its chips beside
  the reader: 12 | 156 | Role | 60 | 214 | 18. It re-lays in the frame the pane opens, with no width
  tween, and Platform comes back in the frame it closes.
- **The header row** (30 px, `panel`, `hair` above and below, 11.5 uppercase .08em `ink3`): each
  label is a 22 px target (padding 0 6, radius 6; `sub` and `ink2` under the pointer, `sub3`
  pressed). A click sorts by it and a second flips it; the sorted label is `ink2` with a 14 px
  `arrow_downward` or `arrow_upward`. Newest first by Applied, by default (D314). JD's tooltip is
  "Job description".
- **A row** is 36 px, `hair` below:
  - Company in `ink`, Role in `ink2`, Platform in `ink3` 12.5, Applied in `ink2` 12.5 tabular
    ("Today", "Oct 6", "Feb 9"), each ending in an ellipsis. The 12 px gutter stays empty.
  - Hover `sub`, the cursor `sub2`, a press `sub3`; the open row `sub3` with a 2 px `accent` bar at
    its left edge.
- **Status** (D309): a 7 px mark, the status, then its step in `ink3` (an ellipsis when it's long).
  Existing colours, but In process's cobalt (#264, D362) and Rejected's and Ghosted's marks (#265, D363):

  | Status | Mark | Label | Step |
  | --- | --- | --- | --- |
  | Applied | a 1.5 px `ink2` ring | `ink2` | "· Re-applied" beside the detail, "· Re-applied, rejected Sep 2" without it |
  | In process | an `inProcess` disc | `inProcess` 500 | the latest step in `ink2`: "· Interview Tue Oct 13, 2:00 PM", "· Case study due Oct 12" |
  | Offer | a `good` disc | `good` 500 | "· Oct 6" |
  | Rejected | an `alert` disc (#265) | `ink3` | "· Oct 5" |
  | Withdrawn | a 1.5 px `ink3` ring | `ink3` | "· Sep 10" |
  | Ghosted | an 8 px dashed `sunGlyph` ring (1.2 px, #265) | `ink3` | "· no email in 48 days" |

  - Ghosted is a flag on Applied after 30 days without an email, and it never moves an application
    to Rejected. It appears on the next draw after the 30 days, without motion.
  - **Set by hand** (D322): a 14 px `edit` in `ink3` after the step (`ink` under the pointer), its
    tip "Set by you on Sep 10 · only an email that sets a status changes it".
- **Closed rows** (Rejected, Withdrawn) and **Ghosted** rows step down: Company `ink2`, Role `ink3`.
  Never a lower opacity, which means a change waiting for its provider.
- **JD** in `ink3` 12.5, its 16 px glyph in `ink3`, then how it was found, or a glyph alone with
  that as its tooltip beside the detail:
  - `description` with "Search", "Greenhouse", "The email's link" (tooltip "Search · found 7h ago",
    "Greenhouse · found Oct 1")
  - `pending` "In Needs you" (tooltip "2 candidates in Needs you")
  - `remove` "No JD found"
  - `progress_activity` "Looking it up…" while it's looked up (tooltip "Looking for the posting")
  - nothing for a closed application from history, which isn't looked up (D311).
- **Arrivals:** an application that lands (a confirmation, Track this, the history pass) takes its
  place by the sort and settles in from `sub2` over 900 ms, the arrival rule News uses (#131). A row
  an email moves on (Applied → In process) crossfades its status cell (120 ms out, 120 in) and
  settles the same way. In a filtered view a row stays put until the next visit, as News holds its
  order; a row that's landed moves only by a sort.
- **A re-application** (D305) is its own row, Applied with "· Re-applied"; the earlier one keeps its
  own closed row at its date (Relecloud, Oct 6 and Jul 22).

### The application's detail

- **Tools** (48 px): **Open posting** `O` (`open_in_new`, the JD's link), then a spacer, previous,
  next and More (30 px icon buttons). With no posting link there's no Open posting: 34c draws **Open
  email** (`mail`) there while the JD is looked up, and 38b nothing once none was found.
- **Opening** (32): the pane takes its 680 px at once and its content slides in 12 px from the right
  over 180 ms; the open row takes `sub3` and its bar at once. J / K or another row swaps the content
  at once, the old row's fill going back over 120 ms. Esc or the open row again fades the content
  over 120 ms, then the pane goes.
- **Head** (padding 20 28 16, 10 apart):
  - A 20 px line in `ink3` 13: the company in `ink2` 500, "· via Greenhouse", and at the right in
    12.5 the account's dot, "Jobs" in `ink2` and "· Applied Oct 1".
  - The title (20 / 500, the reader's subject). Under the pointer it takes a `sub` fill (radius 8, 4
    px beyond the text) and a 16 px `edit` in `ink3` after it, fading in over 120 ms.
  - The status line: the **status chip** (28 px, `chip`, an `edge` ring, padding 0 6 0 11, 12.5
    `ink`: the 7 px mark, the status, `expand_more` 16 in `ink3`; `sub` with an `edgeHover` ring
    under the pointer, `sub2` and .97 pressed, `sub2` with an `edgeOn` ring and `expand_less` while
    open). One click on it sets the status by hand (D309). Then the latest step in `ink2` and its
    age in `ink3` 12.5 ("Pick a 30-minute interview slot this week · 2h"), or "No reply yet" in
    `ink3`.
- **Body** (padding 6 28 28, 22 apart), the JD first (D307):
  - **What they want:** the label (11.5 uppercase `ink3`, 18 px), then the summary at 14 / 1.6 in
    `ink`, max 600, 8 px under it.
  - **Facts:** one line in `ink2` (6 / 18 apart), each after a 16 px glyph in `ink3`: `location_on`
    "Irvine, CA", `home_work` "Hybrid, 3 days", `payments` "$95,000–$115,000". With no salary
    stated, "Salary not stated" in `ink3`. A fact too long for its line wraps ([Decided while
    building](#decided-while-building) #277).
  - **Must-haves** and **Nice-to-haves** in two columns, 28 apart, max 624, each label with its
    count in `ink2` ("MUST-HAVES 4"). Items 6 apart at 13 / 1.45 in a 14 px hanging column:
    must-haves in `ink` after a 5 px `ink2` dot, nice-to-haves in `ink2` after a 5 px `ink3` ring.
  - **Full posting:** a 44 px row (radius 12, `sub`, padding 0 6 0 14): `article` 17 in `ink3`,
    "Full posting" in `ink` 500, how it was found in `ink3` 12.5 ("Found on Greenhouse · Oct 1,
    10:41 AM", "Found by search · Sep 30, 2:18 PM", no dot after the title, #265), then two 30 px tools: the link's host
    (`link`, "greenhouse.example"), which opens it, and **Show** with `expand_more`. `sub2` under
    the pointer, `sub3` pressed.
  - **Timeline** (D317), with its count, oldest first; each event opens its email:
    - A grid of 52 | 14 | text | ···, 10 apart, at least 38 px, radius 10, padding 0 6 0 8, reaching
      8 px past the body on each side.
    - The date in `ink2` 12.5 ("Oct 1"; "Today" in `ink`).
    - The node: a 7 px `ink2` dot (`inProcess` on an In process event, #264) on a 1 px `hair` line through the
      events, ringed in `page` to break it; a **quiet** event's is a 5 px `ink3` ring.
    - What it was in `ink3` 12 ("Applied", "Interview"), then the email's subject in `ink`; a quiet
      event ("Verify your email", "Your candidate account is ready") has no kind and its subject is
      `ink3` 12.5.
    - Hover `sub`, its 26 px ··· showing; with its menu open, `sub2` and the ··· `sub3` in `ink`.
    - An event whose email Gmail has purged keeps its line and opens nothing (D317): after its
      subject "· No longer in Gmail" in `ink3`, no hover fill and the default cursor, its tip
      "Gmail no longer has this email, so Jobs keeps only its line", and its ··· without Open email
      (#269).
  - **Applied before at Northwind Talent** (D306): a label, then one 44 px card per earlier
    application there (radius 12, an `edge` ring, padding 0 8 0 14): `history` 17 in `ink3`, "Junior
    Developer" in `ink`, "· Applied Feb 9" in `ink3`, its status mark and "Rejected Mar 14", and an
    18 px `chevron_right` at the right. Under the pointer `sub` with an `edgeHover` ring; pressed
    `sub2`. It opens that application. Another open application at the company shows the same way
    under **Also at Humongous Insurance**, with `work` (35a); a re-application's earlier one is here
    too.
- **The full posting** (33, D307) unfolds in place under the lists, rather than replacing them:
  - Show, or Space on its row, turns the row into the section's sticky head (44 px, `sub2`, radius
    12): `article` 16, "Full posting" in `ink` 500, "Software Engineer I · Northwind Talent" in
    `ink3` (no dot after the title, #265), and a quiet small **Collapse** with `expand_less`.
  - Under it, a line in `ink3` 12.5 (6 / 14 apart): `travel_explore` "Found on Greenhouse · Oct 1,
    10:41 AM", `link` and the whole link in `ink2`, and `lock_clock` "Kept as it was on Oct 1".
  - The text at 14 / 1.62 in `ink`, max 600: its headings 13 / 600, 18 above and 6 below; paragraphs
    and lists 12 apart, list items 4, their markers `ink3`. It's the posting's own words, cleaned to
    markdown and never rewritten (D307).
  - The text unfolds over 260 ms (a clip from the top), its paragraphs fading in over 180 ms from 60
    ms, while the pane scrolls the head up under the tools, so the summary and lists slide away
    rather than the text appearing off screen. Collapse, the head or Esc folds it back over 180 ms
    and scrolls back to the row. The body is 14 apart while it's open.
  - `O` still opens the original, which may be gone; the kept text never changes.
- **No JD found** (38b, D320): under a **Job description** label, a 44 px card (radius 12, an `edge`
  ring, padding 0 14, `ink3`): `search_off` 16, "No JD found" in `ink2`, "· Breezy and a web search
  had nothing for it on Oct 1", and a quiet small **Look it up** (`search`). Jobs never retries on
  its own; a lookup that errored is retried and never shows this. A posting the user picked that
  Jobs couldn't read says so instead (#276).
- **Looking it up** (34c): the Full posting row outlined instead of filled (an `edge` ring): the
  shared spinner (`progress_activity` 16 in `ink3`, 900 ms a turn), "Looking for the posting…" in
  `ink2`, "LinkedIn, then the platforms, then search" in `ink3`. Under it the summary's skeleton:
  four 10 px bars in `sub2` (92%, 86%, 54% and 38% wide, 9 apart, the last 10 further down),
  breathing as every skeleton does (#225). What comes fades in over 120 ms.
- **First seen in this email** (34c, D323): an application Track this made is dated by its email, so
  its head adds a line in `ink3` 12.5 under the status, after a 16 px `info`: "First seen in this
  email, so Applied is its date", and its first event carries a **First seen** tag. Tracked, it
  lands at its date, settles from `sub2`, opens, and starts its lookup; the numbers move with it
  (All 63, In process 4, this week 4) and Needs you drops to 2.

### Corrections

Out of sight until wanted (D312): the pane's More, a pencil on the title, and a ··· on each event.
Every correction sticks: no email, re-run or lookup undoes one. Each says what it did in the toast,
with Undo for 6 seconds and #147's glyph (override 36).

- **The title in place** (35a): a click on it swaps the text for a field on the same baseline, with
  no jump (34 px, radius 10, `cardOn`, the `edgeFocus` ring arriving over 120 ms, 20 / 500, padding
  0 6 0 10), with "Enter to save · Esc" under it in `ink3` 12. Enter saves and Esc cancels, both at
  once. The company edits the same way from More.
- **More** (35b, 300 wide) grows from its top-right corner:
  - **Edit company** (`edit`), **Edit title** (`edit_note`), **Set status** (`radio_button_checked`)
    and **Merge with…** (`merge`), the last two with a `chevron_right` submenu
  - a divider, then **Not this posting** (`link_off`) and **Look up the JD again** (`manage_search`)
  - a divider, then the two that remove it, 44 px with a line saying how they differ (D321): **Not
    an application** (`visibility_off`), "Hides it · its emails never make one again"; and
    **Delete** (`delete`), "Forgets it · a later email can make it again". Delete is `ink2` at rest
    and `alert` on a 14% `alert` wash under the pointer.
- **Merge with…** (330 wide) opens to More's left at its item, its field focused (32 px, `cardOn`,
  an `edgeFocus` ring, "Search applications"), then the company's other applications under its name,
  then **Recent**, each a 44 px item with `work` and two lines ("Fabrikam · Data Analyst" over
  "Applied today · Applied"). Merged, the other row folds out of the table (180 ms), this timeline
  gains its emails, each settling from `sub2` over 900 ms, and the toast says "Merged · Undo".
- **Not an application** and **Delete:** the row folds away (180 ms), the pane closes (its 120 ms
  fade), and the toast offers Undo.
- **Not this posting:** the JD section crossfades (120 / 120 ms) to "Is this the posting?" with the
  other candidates, as Needs you shows them, or to No JD found when there are none.
- **An event's ···** (220 wide) grows from the button's top-right corner: **Open email** (`mail`),
  **Move to…** (`move_item`, a submenu) and **Not about this** (`undo`). Move to… (300 wide) opens
  to the left at its item's height: the company's other applications under its name, a divider, and
  **Another application…** (`search`). Moved, the event folds out of the timeline (180 ms) and the
  toast says "Moved to Software Engineer II (Java) · Undo"; Not about this folds it out and into
  Needs you.
- **Set status** (not drawn, nor the status chip's menu) offers the five statuses; a status set by
  hand gives way only to an email that sets one (an assessment, interview, offer or rejection),
  never to a quiet one (D322). The chip's menu grows from its bottom-left corner and More's is its
  submenu (#267): Applied, In process, Offer, Rejected and Withdrawn as 32 px items, each its mark
  and its label in the table's colours, the current one with a `check` at the right; Ghosted isn't
  one, as it's a flag. A pick crossfades the chip (120 / 120 ms), the row settles from `sub2` over
  900 ms, the set-by-hand `edit` appears, and the toast says "Set to Rejected · Undo". While the
  status is set by hand, a divider and **Let emails decide** (`mail`) end the menu: the status goes
  back to what the emails make it, and the `edit` goes.
- **A right-click** on a row (#248, #268) opens its actions at the pointer, moving the cursor to it
  without opening it: **Open** ↵, **Open posting** O when there's a link, More's list (Edit company
  and Edit title open the application with that field in edit), then **Copy company and role** and
  **Copy posting link**. On a timeline event it opens the event's ··· menu.

### Search

- `/` or a click turns the header into **Search** (36a, D316): the title crossfades to "Search" over
  120 ms; the status filter and Per week go; the field widens from 380 to 520 over 180 ms and takes
  focus (`edgeFocus` border, `cardOn` fill, its hint `Esc`). Needs you folds away (180 ms) while a
  query is in.
- **Results** replace the table's rows as Andy types, at once, with no motion per keystroke; the
  column header stays. J / K, Enter and the detail work as on the table. Matches are highlighted in
  `hl`, drawn with the rows.
- **Company or role** first, under a group header with `business` ("COMPANY OR ROLE 2"); company
  names match loosely ("wide world" finds Wide World Importers, "humongous" both Humongous
  applications).
- **In a job description** next, under its own header with `description`: a match only in a JD's
  text is a 56 px row (padding 9 at the top) whose second line, from Company to the row's end in
  `ink3` 12.5, gives "Full posting · " and the line it matched, quoted, with an ellipsis at each
  end: “…our services run on **Kubernetes** across two regions, so you’ll pick it up from day one…”
  (36b). "Which one asked for Kubernetes?" answers itself without opening anything.
- **No match in company or role:** a 36 px line in `ink3` 12.5 above the JD matches (padding 0 16 0
  24), `search_off` 16, "No company or role matches “kubernetes”".
- **Esc** clears the query; a second Esc brings back the header and the table at their scroll, Needs
  you unfolding over 180 ms.
- Jobs stays out of mail's search and ⌘K (D316).

### In mail

Jobs fills two slots in mail's reader and list; the mail code doesn't know Jobs (D303). With Jobs
off, or removed, both stay empty. The Inbox's counts never change for them (D313).

- **The JD chip** (37a), in the reader's head under the sender's line and above the actions, on any
  email that belongs to an application:
  - 28 px, `chip`, an `edge` ring, padding 0 8 0 10, `ink2` 12.5: `work` 16 in `ink3`, the role in
    `ink`, "· Applied Oct 1 · In process", and `expand_more` 16 in `ink3`. Its tooltip "The job
    description you applied to".
  - `sub` with an `edgeHover` ring under the pointer (120 ms), `sub2` and .97 pressed; it draws with
    the head, with no entrance of its own.
- **Its popover** (37b, 460 wide, the popover's look) grows from the chip's bottom-left corner over
  180 ms, 8 px under it; the chip takes `sub2` with an `edgeOn` ring and its chevron turns 180°:
  - The head (padding 14 16 10): "Northwind Talent · via Greenhouse" in `ink3` 12.5 (the company
    `ink2` 500), the title at 15 / 500, then the status mark, "In process" and "· Applied Oct 1".
  - The body (padding 2 16 14, 12 apart): What they want at 13 / 1.5, the facts at 12.5, and the two
    lists at 12.5 / 1.4, 18 apart.
  - The foot (padding 8 8 8 16, `hair` above, `ink3` 12): "Found on Greenhouse · Oct 1" (the full
    time in its tooltip), then quiet small **Full posting** (`article`) and **Open in Jobs** with
    `arrow_forward`.
  - Esc, a click away or the chip closes it at once. Open in Jobs goes to Jobs with the application
    open, the pane simply there, with no slide: it's arriving, not opening. **Full posting** arrives
    the same way, scrolled to the full posting and unfolded (#271).
- **Applied before** (37c, D306), on job-match emails only ("Associate Software Engineer @ Contoso
  Pharmaceuticals"), when the company matches an application, a Noise row too:
  - **On the row:** a 20 px badge after the subject (`chip`, an `edge` ring, padding 0 7 0 6, `ink2`
    11.5 tabular), `history` 14 in `ink3`, "Applied Sep 16 · Rejected Oct 5"; its tooltip "Open Jobs
    searched for Contoso Pharmaceuticals".
  - **In the reader:** the same badge at 26 px (padding 0 10 0 8, 12.5, its glyph 16) where the JD
    chip sits; its tip "Open in Jobs · every application at Contoso Pharmaceuticals".
  - Both answer the pointer as the chip does and open Jobs searched for the company ("contoso
    pharmaceuticals"), showing every application there.

### States

- **The history pass** (38a, D311, D326), a muted line at the top of the column (32 px, `ink3` 12.5,
  `hair` below): the shared spinner, then "Reading history · 140 of 330 emails · showing what’s read
  so far".
  - Its progress runs along its foot: a 2 px `sub2` track filling in `ink3` (radius 0 2 2 0), its
    width easing over 260 ms as each count comes; the counts change in place, tabular, unanimated.
  - The pass reads oldest first, so the newest applications are still to come: three skeleton rows
    hold the table's top (#225), and each application lands at its date's place as it's made,
    settling from `sub2` over 900 ms. The numbers in the header count what's landed.
  - What the pass is unsure of gathers in From history as it goes.
  - Done: the line shows a `good` check and "Read 330 emails" for 1.2 s, then folds away (180 ms).
- **The AI is down** (38b): a failing line at the top of the column (32 px, `caution` 12.5, led by
  `warning`, #218): "5 emails not read yet, Anthropic unreachable since 8:52 AM, retrying". It folds
  in as it comes and out when the AI's back, showing a `good` check for 1.2 s first, as mail's
  health lines do. Nothing is lost.
- **No JD found**, **Ghosted** and **a status set by hand** are drawn above (The table, The
  application's detail), never animated.
- **Jobs off** (38c): the header is "Jobs" alone; the page is the one-line empty state (#124), the
  20 px `work` in `ink3` over "Jobs is off · Turn on", Turn on an `ink` link (a 26 px pill, `sub2`
  under the pointer). Turn on opens Settings › Jobs (its own 260 ms entrance) with the switch
  focused, so turning it on is a choice made where the accounts it reads are listed. While off, Jobs
  has no item in the sidebar or the rail and `4` opens this page; 38c draws the item there, current.

### Jobs in Settings

- The nav adds **Jobs** (`work`) between News and AI.
- **Jobs** (39a): the header adds "62 applications" in `ink3` 12.5.
  - A first group, one row: **Jobs**, "Builds applications from their confirmation emails and keeps
    each JD as it was", and its switch (the knob travelling 120 ms, stretching while pressed, #151).
    Turning it on starts the history pass, and Jobs folds into the sidebar under News (180 ms).
  - **Reads** (D310): a 48 px row per account, its dot and label, then a select (#273): Jobs "Every
    email", Business "Career mail only", Personal, Work and iCloud "Off". A change while Jobs is on
    starts the history pass over what the new list hasn't had read. Under the group: "Career mail is
    what triage sorts as Career. Jobs never changes how mail itself is sorted."
  - **History:** **History pass**, "Read 330 emails once, when Jobs was turned on · finished Oct 1,
    8:14 PM", with a 7 px `good` dot and "Done" (while it runs, 38a's line and progress instead);
    and **From history**, "6 waiting in Needs you, what the pass wasn't sure of", with an outline
    small **Show**.
- **AI** (39b) adds a **Jobs** group after News's (D315):
  - **Each email** ("Role title, requisition ID, the event, the match"), Claude Haiku 5.5; **Finding
    the JD** ("When the email's link and the platforms miss"), Claude Sonnet 5.5 with web search;
    **Reading the JD** ("Summary, must-haves and nice-to-haves, salary and setting"), Claude Haiku
    5.5. Names, not selects, as News's are (override 26).
  - **This month** ("No cap: a JD is worth finding while the posting is up"), "$3.85" in `ink` 12.5.
    No cap, so no meter.
  - **Usage this month** adds a Jobs row broken into its three parts, as News's is: "Emails $0.62 ·
    finding JDs $2.71 · reading JDs $0.52", $3.85; the label's total takes it in ($25.20).

### Light

Board 40 is board 32 in Light, and Jobs has no Light values of its own: its components take the
theme's tokens (Light `page`, `ink2`, `cardOn` and `navOn` with its hairline, and Light `good` for
Offer). A theme switch fades every colour over 180 ms, as everywhere.

### Keys and behaviour

- **Keys:** `4` Jobs; `J` / `K` move, through Needs you's items and then the table's rows; Enter
  opens the application; ↑ ↓ choose a candidate and Enter picks it; Space on Full posting unfolds
  it; `/` searches Jobs; `O` opens the posting's link. Esc goes from the title's field, a menu, the
  full posting or (in a narrow window) the detail back a step, then closes the pane; in search, it
  clears the query, then leaves search.
- **Passive** (D313): Jobs sends no notifications, adds nothing to mail's, and never touches the
  calendar or the Inbox's counts. Its one signal is the Needs you count, in `ink2`.
- **Motion:** [`motion.md`](design-export/jobs/motion.md) holds each board's values. In short: 80 ms
  for a press, 120 for fills and fades, 180 for menus, popovers, panes and folds, 260 for the full
  posting unfolding, the progress track and Settings, and 900 for an arrival settling from `sub2`.
  Rows and menu items never scale on a press, they only take the fill step; pills press to .97 and
  icon buttons to .92.
- **Icons:** the boards load the full icon font; the build adds these to `glyphs/icons.json` at the
  same settings as the rest (override 34): `arrow_downward`, `article`, `block`, `bookmark_add`,
  `business`, `edit_note`, `home_work`, `link`, `link_off`, `lock_clock`, `manage_search`, `merge`,
  `move_item`, `pending_actions`, `radio_button_checked`, `radio_button_unchecked`, and
  `check_circle-fill`. The rest Jobs uses (`work`, `alt_route`, `travel_explore`,
  `progress_activity`, `pending`, `description`, `remove`, `search_off`, `payments`) are already
  there.

## ⌘K

The palette (board 20, about 637 px wide, radius 18) runs commands, not search. On an open email it
lists **This email** (Done H on Attention mail, Trash E, Pin P, Open in Gmail O, Add to calendar, Add as task, Ask about
this email, Mark unread), **Go to** (Inbox 1, Calendar 2, News 3 after 2.0, Jobs 4 after News, Settings ⌘,) and **Appearance** (System,
Light, Night, the current one ticked). As in darma, typing also finds every other command that has a
key (New event, New task, Mark all as read).

## Settings

A **1040 × 720 modal** (radius 26, modal shadow, `scrim` behind), not in the address bar, with a
**220 px nav** on `panel`. Rows are 52 px minimum inside `sub` groups of radius 16; switches are 34 ×
20, on a `switchOn` track with a `switchKnobOn` knob, off an `ink3` knob on `sub3` (#176), the knob
stretching toward its travel as it's pressed (#151). A reconnect link opens it at Accounts. While a
page scrolls, its title and × stay at the top, a `hair` line under them once it has scrolled, and a
section's label stays under the title (#132).

- **Nav:** Accounts, Calendar, Todoist, Notifications, Mail, News (after 2.0, [News in Settings](#news-in-settings)), Jobs (after News, [Jobs in Settings](#jobs-in-settings)), AI, Appearance, Security.
- **Accounts** (board 17): **Connect Gmail** and **Connect iCloud**; under **Mail**, each account with
  drag handle, icon, label, address, how it syncs ("Gmail · Push", "iCloud · IMAP every 2 min") and
  its state, led by its glyph (#219): "Checked 9:11 AM" after a `good` dot when healthy, "Checks
  stopped, as of 9:14 PM" muted after `history` when stale, the reason in `caution` after `warning`
  on a `caution` 7% row when failing, "Needs sign-in" in `caution` with **Reconnect**; under **Sources**, Google Calendar ("Push · watch renews
  Oct 9"), Todoist ("Polling every 5 min") and Weather ("Every 30 min") the same way; then **Attention
  precision**, 82%, the share of attention mail opened before Done, led by the figure (24 / 500), with
  the 30 days as a line on a 50–100% scale (#133).
- **Mail** (board 18a): written rules, learned rules (from pattern prompts), trusted remote-content
  domains, the code expiry presets, and the note that protected mail can't be moved by any rule.
- **Notifications** (board 18b): **ntfy** ("Connected · last sent 8:02 AM", or "Failing, …" by a
  `caution` dot; Send test, which turns while it sends and says under the group how it went, #217;
  Server, Token ([Decided while building](#decided-while-building) #82)), the
  topics in mono (`setpoint-reminders`: Reminders · Time to Leave · Reconnect alerts;
  `setpoint-mail`: Attention mail · Off for now; then **FYI mail**, to the same topic, off,
  [Decided while building](#decided-while-building) #252), **Reminder defaults** (Events 10 min before; Tasks
  9:00 AM on the due day, as the sample sets them; each offers None, a fresh install's default, D49), **Time to Leave** (live routes; leave from Home, set in Calendar; a 5 min
  buffer; on for the events given it, #86) and **Alerts** (Reconnect alerts, once per source), every
  group labelled (#135).
- **Calendar, Todoist, AI, Appearance, Security** follow the same row pattern ([BRIEF.md ›
  Settings](BRIEF.md#settings)).
- Sign out isn't drawn; it follows darma (the foot of the nav, and ⌘K).
- **Loading** (#226): opening Settings loads every page's answers, so a page switched to shows at
  once; until a group's answers come, it draws skeleton rows (#225) in `sub3`, never what it says
  for nothing ("Not connected", "Not set", "No rules yet", "None yet").

## Health and states

| State | Treatment |
| --- | --- |
| **Healthy** | nothing on a page; in Settings a 7 px `good` dot before "Checked 9:11 AM" (#219) |
| **Stale** | a muted 32 px line, `ink3` 12.5, led by `history`: "Personal, as of 9:14 PM · Check now" (#218, #220) |
| **Failing** | the same line in `caution`, led by `warning`, with the reason and Check now (#218, #220) |
| **Needs reconnect** | a 40 px bar at the top of the Inbox (`caution` text on `caution` 9%): `sync_problem`, "Business needs sign-in · Reconnect", Reconnect going straight to Google's sign-in for one Gmail account (#220); the account's glyph and count in the sidebar; one ntfy notification; mantel's alert chip |
| **Offline** | a 36 px `alert` pill centred 12 px under the top: "Offline, as of 9:41 PM, retrying", then Retry now with `refresh` (#123), once the stream has been down 2 s; everything under it dimmed but still readable (scroll, J / K, open), changes disabled from the moment it drops (#222) |
| **Starting** | a browser signed in before: the shell as it last stood, its sidebar's accounts and counts and the page's skeleton (#234); a new one: the mark at 36 px where the card's top sits, after 200 ms, its chips settling in turn, then breathing; what follows fades in over 180 ms (#233) |
| **Unreachable at launch** | no sign-in card: the mark at 36 px where the card's top sits, at 50% opacity with `grayscale(.4)`, and the same pill 22 px under it, "Can't reach Setpoint, retrying", then Retry now; Setpoint asks again every 5 s and when the network returns, and the app or the card follows its answer (#118) |
| **Triage down** | the **Unsorted** group under Attention, with "Triage is down, as of 9:09 AM" led by `warning` (#218) |
| **A change failed** | in place (board 19b): the chip outlined in `alert` with an error glyph, and a card anchored to it: "Couldn't move Dinner with Sam", where it was going and from ("Sat, Oct 10 · 7:00 – 9:00 PM · From Fri, Oct 9"), the provider and its own words ("Google Calendar", then "The requested event was modified by another client. (409 Conflict)"), **Try again** and **Move back**. A change waiting for its provider shows at .5 opacity with a spinner, an event's bar dashed (marching from a second on), and arrives with a brighter tint that settles (#192). |
| **First backfill** | search's status: the shared spinner, "Indexing · 62% · showing what's indexed so far", and its progress along the line's foot (#224) |
| **A load failed** | in place of what didn't load, the failing line's look: `warning` in `caution`, "Couldn’t load the Inbox, Something went wrong." in the server's words, then · **Try again** with `refresh`; data already shown stays and says nothing (#228) |

Health means **the last check succeeded**, not that data changed; thresholds come from each source's
schedule ([BRIEF.md › Health](BRIEF.md#health-and-states)).

The Inbox's bar and lines and the calendar pane's lines fold in as they come and out as they go, as
rows do; a line whose source is healthy again shows a `good` check for 1.2 s first. The offline pill
comes in from above and fades out (#221).

## Phone

Below 640 px, the same pages laid out in one column (board 21, 390 × 844): the Inbox's one list
(New, Attention, Pinned, the days, #243), its rows with the account label; the reader full width with
Back; a read-only agenda for today and the next 7 days, empty days collapsed. Actions: Done (on
Attention mail, #93), Trash,
Mark read, Mark unread, Mark all as read. Plain search; no calendar editing, no Alfred, Settings only to
sign in. Dates never wrap.

It feels like an installed app (each line's [Decided while building](#decided-while-building) entry has its values):

- **The reader's actions** share its bottom bar evenly, Done first, its check `good` and its label
  `ink` 500 (#137).
- **Marked unread**, an email shows the unread dot before its subject (#145).
- **Search** has a clear button where the desktop's Esc hint is, no Mark all as read meanwhile, and
  Back reads "Search" from a result (#141).
- **Motion:** the reader slides in over the list and back off it; an agenda item's detail rises in;
  the toast rises from the tab bar (#139).
- **The tab bar** fills the current tab's glyph, badges Inbox with the attention count while another
  page shows, and a tap on the current tab takes its list back to the top (#142).
- **The edges:** the page reaches the screen's edges, kept clear of the status bar and the home
  indicator by their insets, and Safari's bars take the drawn theme's `page` (#143).
- **The list** reads a step up ([Type](#type), #144).
- **The agenda** reads "Today" in `ink` 500, puts the now-line among today's items, draws events as
  their calendar's chips, and keeps each day's head in view (#138).
- **Signing in**, the card sits 18% from the top (#146).

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
  Moving the cursor, scrolling and opening a Noise line never mark anything read. Counts follow at once
  (opening an unread email drops the unread counts; the attention pill drops only on Done).
- **Keyboard cursor:** `J` / `K` move it (a `sub2` fill); moving the pointer onto a row makes it the
  cursor, as in darma. Enter opens.
- **Done** (`H`) leaves Attention; whether the email was opened first is recorded for triage, never
  asked. Only Attention mail not yet Done offers it (#93). **Trash** (`E`) offers Undo for 6 seconds, as v1 does, in the export's `.toast` (a 40 px pill
  at the top centre in the header's band, at the bottom on the phone, #92; not drawn on a board). The
  six seconds drain as a hairline and wait while the pointer rests on the toast (#147).
- **Keys:** everywhere ⌘K, `1` Inbox, `2` Calendar, `/` search, ⌘, Settings, Esc closes the
  topmost thing; mail `J` `K` Enter `H` `E` `P` `O` `U` (to New, #243) ⇧I ⇧U ⌘Enter;
  Calendar ← → or `P` `N`, `T`, `C`, `D`, `E`, Delete, `M` `W`, Enter, Esc; News (after 2.0) `3`,
  `J` `K` Enter `O` `N` Esc. Key hints read "Esc",
  "⌘K", "⇧I".
- **Changes** go through one command layer: pending (.5 opacity) until the provider confirms, failed
  in place with the provider's message otherwise. Nothing quietly reverts. A calendar item deleted
  fades and folds away, and Undo or ⌘Z folds it back and lands it (#193).
- **Overlays** anchored to calendar items follow the placement rule; Esc closes the topmost.
- **Text selection:** titles, addresses, codes and email bodies can be selected; controls can't.
- **Right-click** on an email, a calendar item or empty grid, a story, or a sidebar row opens its
  actions at the pointer; selected text, links and fields keep the browser's menu ([Decided while
  building](#decided-while-building) #248).
- **Selecting emails:** ⌘ or Ctrl-click, and ⇧-click for a range, select several; the reading pane
  shows the selection, and H, E, P, ⇧U and a right-click act on all of it ([Decided while
  building](#decided-while-building) #249).

## Copy

Sentence case; " · " separates parts, " – " ranges, "…" is one character; times "2:30 PM"; ages
"now", "4m", "2h", "Yesterday", "Mon", "Oct 1" in the Inbox and search, clock times under All's day
headings; full timestamps in tooltips. Empty states are one line and an action: "All caught up · Open
All" (stacked under the mark, #203); the day pane's empty day is two dashed ghost rows instead, New event C and New task D (#191); a
day whose items are only hidden, "4 hidden · Show all" (#113). Each
leads with its glyph in `ink3`, 20 px and 12 px before the words, or 16 px and 8 px in a row 44 px or
shorter (#124). The UI says "Done".

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
29. **An agenda line names its calendar; the place has its own line** (#125): where boards 11, 12a,
    12b, 12d, 15, 15b, 19b and 22b draw "2:30 – 3:30 PM · Smile Dental" or "7:00 – 9:00 PM · Blue
    Door", the app reads "· Personal", then the place under it after `location_on`.
30. **The glide's contents crossfade**: old content fades out 0–120 ms and new content in 70–220 ms
    (#156), overlapping by 50 ms, where `motion/glide.json` has 0–90 and 90–220 and the card travels
    blank between them.

**The polish audit** (darma SV-54, D120; [Decided while building](#decided-while-building) #157–#176).

31. **Some tokens' values are the audit's:** Night `ink3` `#7d7f84` (the export's `#707277`), Light
    `ink2` `#4b4d52` (`#56585d`), Night `panel` `#0b0c0e` (`#08090a`) and Light `cardOn` `#ffffff`
    (`#f4f4f2`), `cyan` Night `oklch(0.86 0.11 182)` and Light `oklch(0.58 0.1 182)`
    (`oklch(0.8 0.11 195)`, `oklch(0.54 0.09 195)`), and Light `--evtint` 14% (12%). The export keeps
    its values; the board audit draws every board with these.
32. **Alfred's mark is `auto_awesome` in its gradient** (#173): boards 06 and 07 draw it in `ink`, and
    boards 01, 03 and 20 draw Ask about this email with `forum`.

**The one list** (darma SV-70, D264, D266; [Decided while building](#decided-while-building) #243).

33. **The Inbox is one list:** boards 01–04, 09, 10, 17, 19a, 19b, 20, 21a and 22a draw Unread's
    groups (and 04 All caught up, 05 All by itself); the app draws New as a day, Attention, the
    Pinned shelf, then the days, so the audit compares them as they are and expects the list to
    differ.

**Jobs** (design round 4, boards 32–40, 32b, 34c and the states strip; darma SV-118).

34. **Jobs's icons are drawn from `glyphs/icons.json`**, not the full icon font the boards load from
    the network; the build adds the ones it lacks, listed under Jobs's Keys and behaviour.
35. **Jobs's glyphs keep Glyphs' sizes per role** (#123): where the boards draw 15 px (the table's
    JD glyph, From history's rows, the JD chip, the reader's Applied before badge) the app draws 16,
    and where they draw 13 (the row's Applied before badge, the set-by-hand mark) 14; Needs you's
    small buttons, which the boards' stylesheet draws at 17 by its cascade, take 16 (#274).
36. **Jobs's toasts lead with #147's glyphs:** `check` in `good` for a thing done ("JD saved for
    Lucerne Publishing", "Merged"), where 34b draws `check_circle`; `delete` in `ink3` for one taken
    away (Dismiss all, Not an application, Delete), which no board draws.
37. **The boards from before Jobs draw it as it now is** (J8, as override 24 did for News): on 01–31
    the sidebar lists **Jobs** (`work`) under News with its Needs you count in `ink2` (the seed's 3),
    and on 17, 18a, 18b, 30a and 30b Settings' nav lists **Jobs** between News and AI.

## Not designed yet

- Reply and compose (a reserved place in the reader's tools).
- Full phone parity; ntfy action buttons.
- Sign-in and first-run screens (they follow darma's sign-in card), and Sign out.
- The Trash Undo toast on a board (its component exists in the export).
- Settings › Calendar, Todoist, AI, Appearance and Security in detail (rows per the brief).
- Empty states beyond the Inbox and search (an empty day, a source with nothing yet).
- News's tuning round (muting, "less like this", choosing sources) and News on the phone.
- Jobs on the phone and in the iPhone app (decision 49).

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
    length ("10:00 AM (1 hr)"), after No end (#246). Typing in either closes its picker, so it never covers the card's
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
58. ~~**The new-event editor's Title field says "Title"** until the line gives it one (Andy,
    2026-10-09; polish audit #4).~~ Retired by #257 (D290): a new item has no Title field.
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
      colour of Dinner with Sam"; a create says nothing (#247). The toast's
      Undo and ⌘Z are the same; a change to a recurring event's occurrences says what it did, with
      no Undo. An edit saved in the editor stays silent.
    - **A started draft or unsaved edit survives leaving Calendar** (amending #49): coming back
      brings the editor back as it was, line, fields and ghost.
    - **The open editor's draft day comes into view** on the grid, so More options for a December
      exam shows December.
    - **E focuses the Title, selected** (its title words only since #257, D290)~~; in a new item, a
      Title typed by hand rewrites the line's title words ("Coffee fri" titled "Coffee with Ana"
      reads "Coffee with Ana fri"), and the line goes on giving the title.~~ The Title rule is
      retired by #257 (D290): a new item has no Title field, its line's title words being its title.
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
119. **Each lane carries its glyph:** every Unread group header leads with a 14 px glyph in `ink3`, 8
    px before its label: Pinned `keep` (was 16), Attention `flag` (in `caution`, as its count),
    Unsorted `pending`, Security `lock`, Deliveries `local_shipping`, Money `payments`, Career
    `work`, People `person`, Updates `notifications`, Other `mail`, Noise `campaign`. All's kind
    column draws the same glyph at 13 px before the kind word, the column 100 px wide to hold it.
    Shape alone, no colour per kind: the account colours already mean accounts (Andy, 2026-10-11,
    polish audit inbox-04).
120. **Each News section carries its glyph wherever it's named:** a section header leads with its
    14 px glyph in `ink3`, its optical edge on the list's 24 px line (Local `location_on`, Tech
    `computer`, AI `auto_awesome`, as Settings › AI, General `public`), and its label lifts from
    `ink3` to `ink2`, so the faintest text in the list becomes a landmark; mail's group headers keep
    `ink3`. The story pane's section tags take the same glyph, Missed's day headers `history` and
    Show headlines' Unsorted header `pending`, as mail's Unsorted. No colour per section: the
    account colours already mean accounts (Andy, 2026-10-11, polish audit news-07).
121. **An official warning without a photo shows its hazard, not a hole:** a story whose leading article
    comes from a hazard source (NWS `thunderstorm`, USGS `earthquake`, Cal Fire
    `local_fire_department`, AirNow `air`, the glyphs Settings › News gives those sources) and that
    has no image draws its glyph at 22 px in `caution` on a 72 × 48 tile (radius 8, `caution` at 10%,
    a 22% inset ring) in the thumbnail's column; as a block's lead it puts an 18 px `caution` glyph
    before the headline instead. An outlet's story without an image still leaves the column empty,
    never a placeholder. The story's lead names its hazard source (`hazard` in the API) (Andy,
    2026-10-11, polish audit news-08).
122. **An attachment's tile says what it is:** each card leads with a 30 px tile, radius 8, concentric
    in the card (padding 0 8 0 7, 12 px before the name), the type's colour at 14% with its glyph
    in that colour: PDF `alert` `picture_as_pdf`, image `violet` `image`, spreadsheet (CSV, Excel,
    Numbers) `comf` `table_chart`, document (Word, Pages, RTF, text) `cool` `description`, archive
    (ZIP, gzip, RAR, 7z) `warm` `folder_zip`, invitation (ICS) `caution` `calendar_month`, anything
    else `ink2` `draft`; the type from the name's extension, else the MIME type. **Download** carries
    a 16 px `download` (gap 6, padding 0 10 0 8). Under the pointer the ring stays `edgeHover`, the
    tile deepens to 22%, the eye turns `ink`, and in Night the card fills `cardOn` (Light stays
    white) (Andy, 2026-10-11, polish audit reader-07).
123. **A glyph means one thing, at one size per role:** account trouble is `sync_problem` everywhere
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
124. **Every one-line empty state leads with its glyph, as All caught up does:** in `ink3`, 20 px and 12
    px before the words, or 16 px and 8 px in a row 44 px or shorter. Calendar's empty day
    `event_available` ("No events · New event", 16), search's and ⌘K's nothing found `search_off`
    ("No emails match …", "No events or tasks match …", "No stories match …" at 20; "No command
    matches" at 16), Settings' "No rules yet · Add rule" `rule` (20), News's empty section
    `newspaper` ("Nothing new in Tech since Mon", 16); "4 hidden · Show all" keeps its
    `visibility_off`, now 8 px before its words. No new copy. The phone agenda's "No events" stays a
    bare label: it sits at the end of a day's header, beside the forecast's glyph, not alone on a
    line (Andy, 2026-10-11, polish audit motion-13).
125. **A place has its own line, and the time's line always names the calendar:** an event's second
    line in the right pane is always "7:00 – 8:00 AM · Personal", where it had named the place
    instead when there was one, so the line meant two things. The place follows on a line of its
    own, as Leave by does: `ink3` 12.5 after a 16 px `location_on` (6 px gap, 4 px above), its name
    or its address's street, or `videocam` and the link's host ("zoom.us") when the place is a
    link. The stacked facts (place, Leave by, Overlaps) share one 4 px gap (Overlaps had 2). No
    reminder glyph: it would sit on nearly every row. Boards 11 and the others draw the place in
    the line (override 29) (Andy, 2026-10-11, polish audit calpanes-12).
126. **A recurring event's card says it's a series, and its calendar fact takes its colour:** the
    floating detail adds a `repeat` fact after the attendees for an event with a recurrence, worded
    as the editor's repeat field words it ("Weekly on Mon, Wed, Fri", #53 and #64), so Gym's card no
    longer reads only "10 min before · Personal" until a drop asks This, Following or All. A
    repeating task keeps its own line. The calendar fact's `calendar_today` takes the item's colour
    (its own, else its calendar's), as the failed card's does, its name staying `ink2`. The date
    stays the title's subtitle, without a glyph (Andy, 2026-10-11, polish audit calflows-05).
127. **A block's lead is unmistakably the lead:** the boards were drawn with the pane open, a list
    about 750 px wide; with nothing open it's 1,429 px at the design target, and the lead's 232 ×
    130 image filled 16% of its row while its one-line headline ran past 1,000 px. From a list 1000
    px wide the lead grows: 12 | 320 | text, 18 apart, padding 16 16 16 12, the image 320 × 180, the
    headline 19 at 1.3 and −.01em (max 760), the summary 13.5 / 1.5 on up to three lines (max 680);
    narrower lists keep 232 × 130, and 160 × 90 under 600 (#99). Seen, a lead's headline stays `ink`
    at 400 rather than dropping to `ink2`, so on a second visit the day's top stories still outrank
    Upcoming's names and the rows; new and seen leads differ by weight and the dot. Rows keep `ink2`
    once seen. Board 25 draws a seen lead in `ink2` (Andy, 2026-10-11, polish audit news-04).
128. **A narrow News list wraps its rows' headlines:** with a story open at 1280 the list is 420 px
    (#99), and the meta and thumbnail left each headline about 220 px, so every one was cut at 25–30
    characters and its summary too. Under 480 px of list a row's headline wraps to two lines (18 px,
    clamped with an ellipsis) and the summary goes; the thumbnail, meta and dot stay, and the row
    keeps its 66 px. Extends #99 (Andy, 2026-10-11, polish audit news-10).
129. **An article in the pane reads at a reader app's size:** the extracted text is 16 / 1.65 at
    −.003em with paragraphs 16 apart, about 79 characters a line in the 600 px column (#98), where
    14.5 / 1.6 gave about 87. In Night it's `ink` mixed 10% toward `ink2`, so a long article doesn't
    glare at 17:1 on the near-black page; Light keeps `ink`. The story's summary stays 14 / 1.6, as it's
    short (Andy, 2026-10-11, polish audit news-11).
130. **New since you looked folds past four facts:** an updated story with ten new facts drew about
    420 px of card, pushing its own summary below the fold and its Sources off screen. With six facts
    or more the card shows the newest four, then a 20 px line "6 more" in `ink2` 12.5 with a 16 px
    `expand_more` in `ink3`, level with the facts' text (72 px in), as the list's "12 more in Local"
    reads. A click opens the rest, the card growing over 180 ms, and the line reads "Show fewer" with
    `expand_less`. Five or fewer all show, as folding one away saves nothing (Andy, 2026-10-11,
    polish audit news-12).
131. **News answers the pointer and shows what N brought:** the new-stories pill, the one element
    whose job is to draw the eye, was the quietest on the page (`cardOn`, 1.02:1 on Light's page),
    appeared in one frame and had no hover; N re-sorted the list in one frame, the arrivals looking
    like every other row; and an opened story's dot vanished. Now the pill drops 8 px into place as
    it fades in over 180 ms, and under the pointer its ring turns `edgeHover` and its arrow `ink`
    (120 ms); the stories N (or the pill) brings onto the list, those the held order didn't show,
    settle in from `sub2` over 900 ms, a deliberate extension of the motion vocabulary used only for
    arrivals (`news.landedMs`); an opened story's dot shrinks out in its colour over 180 ms; and a
    headline turning from new's `ink` to seen's `ink2` eases over 120 ms. The rows' own 120 ms hover
    and every press state are the motion pass's (Andy, 2026-10-11, polish audit news-06).
132. **Settings keeps its title and × in view:** the page's head and × scrolled away with the page,
    so after 260 px of AI the modal's top showed only a group label, and News's 2,700 px of sources
    gave no sign of the page or the way out. The head is now sticky over the modal's colour
    (reaching up through the page's padding to 1 px short of the modal's ring, so it sits where it
    did; what scrolls by stays inside the ring too), a 1 px `hair` line appears under it once the
    page has scrolled (a scroll-driven animation over the first 24 px, CSS alone), and the × is
    fixed to the modal at its 24 / 20 px. A section's label stays under the head while its rows
    pass, so News says "TECH 14" over Tech's sources (Andy, 2026-10-11, polish audit settings-04).
133. **Attention precision leads with its figure and draws its month as a line:** the figure was 13
    px, as every row, and the 30 days were `sub3` bars scaled 0–100% (1.48:1 on the Night group), so
    a month between 70 and 100% read as a flat barcode. Now "82%" leads at 24 / 500 / −.02em in
    `ink` (64 px wide, tabular), then the title over its line (#76's copy), padding 14 20 14 16, 20
    apart; the 30 days are a 180 × 32 drawing: a 1.5 px `good` line with round joins on a fixed
    50–100% scale (a day under 50% on the floor), the area under it `good` at 14%, the latest day's
    point a 3 px `good` dot ringed 1.5 px in `modal`, and a dashed `hair` reference at 80%. A day
    with nothing Done breaks the line rather than dipping, and with nothing Done in 30 days there is
    no chart, only "—" and its line. Each day's column names it on hover as the app writes dates:
    "Tue, Oct 6 · 9 of 11 opened first", or "· nothing Done". Board 17 draws 30 bars and the figure
    inline (Andy, 2026-10-11, polish audit settings-08).
134. **Settings › AI puts the money first:** each cost in Usage this month is `ink` 500 (was `ink2`
    400), its label carries the month's total ("$21.35", `ink2`, Triage, Alfred and News together)
    so This month's News-only "$18.40 of $40" no longer reads as the whole, the amount is `ink`, and
    the meter turns `caution` from 90% of the cap rather than only at it; its fill eases to a new
    width over 260 ms. The meter stays neutral, `ink3` on a `sub2` track (was `ink2` on `sub3`;
    3.4:1 in Night, 4.1:1 in Light): the finding drew it `cool`, but #163 gives `cool` to identity
    and `accent` to "you are here", and a usage meter is neither (Claude decided, Andy left small
    gaps to Claude). At the cap it's full in `caution`, as before (Andy, 2026-10-11, polish audit
    settings-10).
135. **Every Settings group has its label, and an empty one says so as Mail does:** Notifications'
    last two groups take the labels "Time to Leave" and "Alerts" (Reconnect alerts), spaced as every
    other group, as #69 gave Calendar's last group a label. Security's empty Passkeys group is the
    one-line empty state, "None yet · Add passkey" after a 20 px `passkey` in `ink3` (#124), not a
    row titled "None yet" that read as a passkey's name; the recovery row is titled "Recovery codes"
    with "8 left" as its value (Andy, 2026-10-11, polish audit settings-11).
136. **The sign-in card answers and carries a little more of the brand:** a refused password, code
    or token shakes the card once (0 → −6 → 5 → −3 → 0 px over 260 ms, `--ease`, the modal's timing)
    and selects what was typed, so typing replaces it; the border and the line stay as they were.
    With passkeys registered and nothing typed, **Use a passkey** is the solid button and Sign in
    the ghost, until a character is typed; it and Use passkey carry a 16 px `passkey`. Where the
    three foot buttons don't fit the card (passkeys offered, the phone), Use a recovery code goes
    under the other two rather than past the card's edge. The brand row's mark is 24 px and the name
    15 / 600. Signed in, the card scales to .98 and fades over 180 ms while the app fades in under
    it. In Night the card's shadow is `0 30px 80px rgba(0,0,0,.6)`, depth rather than the faint box
    the modal shadow drew on the near-black page; Light keeps the modal's (Andy, 2026-10-11, polish
    audit states-14).
137. **The phone reader's actions share the bar, Done leads, and none arrives late:** two, three or
    four actions take equal shares of the bottom bar, so an FYI email's Trash · Mark unread · Open in
    Gmail fill it rather than three quarters of it. Done, the phone's main job on Attention mail, has
    its label in `ink` 500 and its check in `good`; the rest keep `ink` icons over `ink2` labels. The
    bar fills once the email's row or the email is known, with Open in Gmail decided by its account
    (Gmail's mail always has the link), so nothing moves in or along when the email arrives; until
    then it's empty (Andy, 2026-10-11, polish audit phone-02).
138. **The phone's agenda marks today and now, and draws events as chips:** today's head reads
    "Today" in `ink` 500 before its date in `ink3`; a 16 px now-line (the right pane's: the time in
    `alert` 12 / 500 in the time column, a 7 px `alert` dot, a 1 px `alert` line at .7) sits before
    today's first timed event not yet over, or after its last, and only on a day with a timed event.
    Events are their calendar's tinted chips with the 3 px bar, as on the grids (34 px, radius 6,
    the title level with the tasks' titles, past ones at .55), where a 3 × 20 px bar was; tasks keep
    their ring. Each day's head stays at the top while its items scroll under it (Andy, 2026-10-11,
    polish audit phone-03).
139. **The phone's reader slides over the list:** opening an email slides the reader in from the
    right over 260 ms (`--ease`, the modal timing, as it takes the whole screen) while the list moves
    a fifth left and dims to .55 under it; Back, Done and Trash run it the other way, the row folding
    away as the list comes back. It's a view transition, so taps reach the page meanwhile; the
    browser's own Back (Safari's edge swipe) doesn't slide, as it animates itself, and without the API
    it's the cut it was. The agenda's detail rises 24 px into place as its scrim fades in, over
    180 ms, and the toast rises 8 px from the tab bar (Andy, 2026-10-11, polish audit phone-05).
140. **From 640 to 1099 px the sidebar is a rail and panes cover what they'd squeeze** (Layout ›
    Compact): an iPad or a half-width window had the reading pane 1 px wide at 640 and 152 at 820,
    and the month grid 252 px at 900. The sidebar is a 56 px rail of icons with Inbox's attention
    badge; an open email or story covers the list under the header, with Back leading its tools;
    Calendar's grid takes the width (764 px at 820) and the right pane lies over it while it holds
    the editor or search, the day's pane not drawn and its health lines atop the grid; the header's
    search narrows first. ⌘K keeps the rail's lost filters: "Inbox · Jobs", and Show or Hide each
    calendar (Andy, 2026-10-11, polish audit phone-06).
141. **Phone search has a way out, and acts only on what it shows:** while searching, a 32 px round
    clear button (an 18 px `close` in `ink3`; `sub2` and `ink` while pressed) stands where the
    desktop's Esc hint is, and a tap empties the field and lets go of it. Mark all as read leaves the
    header meanwhile, as it would read the hidden Inbox's mail, and an email opened from the results
    reads "‹ Search", going back to them (Andy, 2026-10-11, polish audit phone-07).
142. **The phone's tab bar says where you are and what waits:** the current tab draws its filled glyph
    (`inbox-fill`, `calendar_today-fill`); while Attention waits and the Inbox isn't showing, the Inbox
    tab carries the header's pill shrunk to 16 px (`caution`, `onInk` 10.5 / 600 figures, 8 px from
    the top and 6 px right of the tab's middle, a 2 px `panel` ring); a tap on the current tab
    smooth-scrolls its list back to the top, the agenda back to today (Andy, 2026-10-11, polish audit
    phone-09).
143. **The phone reaches the screen's edges in its own colour:** the page is laid out to the edges
    (`viewport-fit=cover`) and keeps clear of the status bar and the home indicator by their insets:
    the tab bar is 54 px with at least 6 px under its labels, the reader's bar 58, each taking the
    home indicator's inset when there is one, rather than a fixed 18 and 22 px. One `theme-color`
    follows the drawn theme's `page` (Night #050506, Light #f6f6f4), so Safari tints its bars to the
    theme picked in the app, not the system's (Andy, 2026-10-11, polish audit phone-10).
144. **The phone's list reads a step up** (Type): rows 15, ages and account labels 13, Attention's
    summaries 13.5, group headers 12 at 30 px, rows at least 62 px, a code's Copy 30 px; search's rows
    the same. The colours stay: the size makes `ink3` legible (Andy, 2026-10-11, polish audit
    phone-11).
145. **An email marked unread on the phone shows it:** Mark unread keeps the email open (by design),
    and now the list's unread dot (6 px `ink`, 10 px before the subject, on its line's middle) stands
    before the subject until Mark read; the dot and the swapped icon scale in from .4 over 120 ms. No
    toast (Andy, 2026-10-11, polish audit phone-13).
146. **On the phone the sign-in card sits 18% from the top** rather than near the middle, so the
    keyboard never covers Sign in; the mark shown while Setpoint can't be reached (#118) stands there
    too. The desktop is unchanged (Andy, 2026-10-11, polish audit phone-08; darma D145).
147. **The one toast says what happened** (amending #13 and #32): it drops in over 180 ms (from 8 px
    above at .96, from below on the phone), and again when a new one replaces the last, so two Trashes
    read as two; going, it fades over 120 ms. It leads with a 16 px glyph by what it says: `check` in
    `good` for a thing done ("Marked Done", "Marked 14 as read", "Completed Pay rent"), `delete` in
    `ink3` for one taken away ("Moved to Trash", "Deleted Dentist"), and `error` in `alert` for a
    failure, which also wears an `alert` ring (40%) and an 8% `alert` wash on its fill, its words
    staying `ink`, and stays 8 seconds rather than 6 so the provider's words can be read. Any other
    line has no glyph. A line with an action shows its time draining as a 2 px hairline (`ink3` at
    45%) along its foot, and both wait while the pointer rests on it (Andy, 2026-10-11, polish audit
    shell-03, shell-04, shell-12, motion-03, states-07).
148. **Overlays arrive with the motion Tokens names:** every menu and popover (the reader's More,
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
149. **Every menu is one component, and its button stays lit while it's open:** Settings', the
    reader's More, the editor's, the proposal's, ⌘K's items and News's Upcoming story share one look:
    a popover of radius 18 with 6 px inside, items 32 px high (Places' two lines 44) 2 px apart, radius
    10, 10 px in, `ink2` with a 16 px `ink3` glyph; the pointer and the keyboard's cursor both fill an
    item `sub2` with its words and glyph `ink` (in Light, `sub` on white barely showed); the checked
    item is `ink` with a check at its end, one that can't be picked .5. The export's 34 px and 12 px
    items, and Settings' radius 14, give way to it. While its menu is open, the button that opened it
    keeps a fill: an icon button, a reader tool or a quiet button `sub2` and `ink`, a ghost button
    `sub3`, a field its focused ring (Andy, 2026-10-11, polish audit motion-06, motion-05, reader-12).
150. **Every press registers before its result** (extending Motion and #12): a press goes in over 80
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
151. **The same kind of thing answers the same way on every page** (extending #12): News's rows,
    leads, Upcoming and its story, Show headlines' lines, More and the story pane's sources fade their
    hover over 120 ms as the mail list does, and so do calendar task chips, whose hover is `sub` so a
    hovered task no longer looks selected (`sub2`). Controls show the arrow, as darma's do: a link
    that's a control (the sidebar's nav, account rows and Today lines, agenda items), Noise's fold and
    Upcoming too, and rows, chips and day cells never the text cursor; dragging and resizing keep their
    own cursors. A calendar's checkbox fills or empties over 120 ms, its check growing in from .6 or
    shrinking away, and a Settings switch's knob stretches to 20 px toward where it's going while
    pressed (Andy, 2026-10-11, polish audit motion-09, motion-11, motion-14).
152. **A calendar chip answers in its own colour** (amending #12, where `sub` lay over chips):
    under the pointer a month chip or a week block lays its own colour at `--evhover` (Night 18%,
    Light 14%) over its tint, so it deepens rather than greying, over 120 ms; pressed, it gives to .97
    and deepens to 28% until a drag's lift takes over. A selected, solid chip keeps its `sub` (Andy,
    2026-10-11, polish audit grids-05).
153. **"+N" looks like a door into the day:** the month's "+3" takes a chip's footprint (20 px,
    radius 6, its count where the chips' titles start) and a `sub` hover, its open state staying
    `sub2` and `ink`, and after the count up to three 6 px dots show what it folds: an event's in its
    colour, a task's as a ring in its project's (Andy, 2026-10-11, polish audit grids-12).
154. **A search chip answers as a whole:** with its × under the pointer the whole chip takes `sub3`
    and an `edgeHover` ring, so it's clear which one goes; a word that becomes a chip pops in from .92
    over 120 ms, and a removed chip collapses away over 120 ms as the rest close up. Mail's,
    Calendar's and News's fields alike (Andy, 2026-10-11, polish audit search-09).
155. **Settings marks a choice as the nav marks its page:** in a colour picker the current colour is
    ringed in itself (1.5 px, 4.5 px clear of its dot) rather than sitting on a `sub2` disc, and a
    dot swells to 1.25 under the pointer over 120 ms, so the choice and the pointer never look alike;
    an account's icons sit under a hairline after its options. In Appearance the chosen theme's row
    is filled `sub2`, its icon tile `ink` with an `onInk` glyph, its check `good` (Andy, 2026-10-11,
    polish audit settings-09, settings-12).
156. **The glide carries its content across** (amending The glide, override 30): the old content
    fades out over 0–120 ms and the new fades in over 70–220 ms, overlapping by 50 ms, so the card is
    never an empty slab mid-flight; the 6 px slide, position, height and selection timings stay
    (Andy, 2026-10-11, polish audit calflows-12).
157. **The ink ladder is re-spaced, and Night's panel lifts a step:** Night `ink3` is `#7d7f84`
    (5.1:1 on the page, 4.3:1 on a cursor row, 3.8:1 for key hints in the search field), so ages,
    account labels, counts, summaries and key hints read at a glance while `ink2` stays 1.6× it.
    Light `ink2` is `#4b4d52` (7.8:1), the same step over `ink3`, so read mail and seen headlines no
    longer look like their own summaries. Night `panel` is `#0b0c0e` (1.04:1 on the page, near
    Light's step), so the sidebar, group bands and Settings' nav read as layers. `CALENDAR_HEX`
    writes the new `ink3` to Google and still reads the old one back (Andy, 2026-10-11, polish audit
    color-04, color-07, news-14).
158. **Light's raised surfaces are white, and a band has its own hover and cursor:** Light `cardOn` is
    `#ffffff`, so the toast, the drag tip, News's pill, a focused field, and Alfred's Answer and
    proposal cards lift off the page as Light's other cards do; Night keeps `#131417` for them, its
    one deliberate lift. A collapsed group header (and one that collapses on a click) lays `sub`
    over its `panel` band under the pointer and `sub2` under the keyboard cursor, fading as fills do,
    and All's folded Noise line takes a row's `sub` and `sub2`; `cardOn` sank below the band in Light,
    so J landing on a folded group showed nothing. News's image placeholder is `sub2` (Andy,
    2026-10-11, polish audit color-03, inbox-02, shell-05, search-07).
159. **Coloured text on its own tint is capped at lightness .43 in Light:** chips, week blocks and
    the editor's timeline draw their calendar's colour as `oklch(from <colour> min(l, var(--tintL)) c h)`,
    `--tintL` Night 1 and Light .43, keeping hue and chroma, and Light's `--evtint` is 14%. Light's
    hues are tuned for text on the page and read 3.8–4.3:1 on their own tint; capped, titles read
    5.8–6.8:1 and Light's month as crisply as Night's, which is unchanged. The selected chip keeps
    `onInk`, a failed one `alert`, and bars and fills the colour itself (Andy, 2026-10-11, polish
    audit color-02, grids-01).
160. **Weekends and the days outside the month show, and neutral mixes stay grey:** weekends take
    `dayOff` (Night `rgba(255,255,255,.02)`, Light `rgba(29,30,33,.028)`) and days outside the shown
    month `dayOut` (`.035`, `.048`), an outside weekend as an outside day, the selected day `sub` over
    both; the week's weekend columns take `dayOff`. `panel` at 40% and 60% measured 1.01:1 on the
    page, and its oklch mix with transparent turned faintly pink. A cell eases its shading over
    180 ms as the scroll moves the shown month. Every neutral mix (an ink or a surface) is now `srgb`
    or an alpha token; oklch is for hues (Andy, 2026-10-11, polish audit color-06, grids-02).
161. **Past items turn grey instead of fading:** a past chip or week block draws its title and time
    in `ink3` at full strength, its bar at 45% of its colour and its fill at half `--evtint`, so
    colour means "still ahead" and a past Gym reads 3.8–4.3:1 rather than 2:1. A day that's over keeps
    its number in `ink3` ("Oct 1" keeps its weight and ink) (Andy, 2026-10-11, polish audit
    grids-01).
162. **Classes' cyan moves away from Personal's cool:** `cyan` is Night `oklch(0.86 0.11 182)` and
    Light `oklch(0.58 0.1 182)`, lighter and greener, so the two calendars that fill the month are
    told apart: 1.26:1 against `cool` in Night and 1.21:1 in Light, up from 1.03 and 1.02, and 53° of
    hue. Setpoint writes `#74e9d6` to Google for it and still reads `#57d4d4` back as cyan, and
    Google's Peacock still lands on it by hue (Andy, 2026-10-11, polish audit color-05).
163. **Colour has fixed roles, and `accent` says "you are here":** a token `accent` (`cool`'s values,
    named for its job) marks the open email's bar, the current page's icon (the sidebar's and
    Settings'), today's month boundary, a date range's band, search's selected chips, the parse
    field's selection, and News's updated dots, pill, Updated tag, New since you looked, Missed bar
    and Upcoming's tile (which borrowed Jobs' `violet`). `good` is done or healthy: the reader's Done
    shows its check in `good` and its label in `ink` beside the `ink2` tools, so on Attention mail Done
    reads as the verb. `caution` is only "needs you", and accounts and calendars pick from nine
    swatches, without `caution` and `alert`, though one picked before still shows; Google's Tomato and
    Flamingo still read as `alert` for an event. `alert` is danger and now, `ink` the primary action,
    the identity swatches dots, tints and bars, and the AI has no hue (Andy, 2026-10-11, polish
    audit color-01).
164. **The open email has its own state:** `sub3` with a 2 px `accent` bar at its left edge, fading
    in with the row's 120 ms box-shadow, while the keyboard cursor (and so the pointer's row) stays
    `sub2` and hover `sub`; with an email open, the row under the pointer no longer looks like the one
    in the reader. A press on a row is `sub3` at once, before the email opens. Unread, All and search
    results alike (Andy, 2026-10-11, polish audit inbox-01, reader-06, color-01).
165. **Today is a disc in the now-line's `alert`:** in the month, the week's day heads and the
    mini-month (the date pickers' too), with `onAlert` 600 (7.3:1 in Night, 5.7:1 in Light), so today
    and now are one red thread across the grid and the right pane's now-line (Andy, 2026-10-11,
    polish audit grids-03).
166. **The current page is a raised chip:** the sidebar's current page and filtering account, and
    Settings' current page, take `navOn` (Night `rgba(255,255,255,.10)`, Light white) with a 1 px inset
    `navOnEdge` hairline, a raised tab rather than a shadow, while hover stays a flat `sub`; the two
    measured 1.06–1.09:1 apart as `sub2` and `sub`, so pointing at Calendar from the Inbox drew two
    near-identical pills. List rows keep `sub2`. While an account filters the Inbox, Inbox reads as
    its parent, label and icon in `ink`, no fill (Andy, 2026-10-11, polish audit shell-02).
167. **Attention is the loudest block:** its header band takes `caution` into its `panel` (8% in srgb,
    6% in Light, where 8% reads salmon), its label and count in `caution` over a `caution` 20% line;
    its unread dots are `caution`, matching the sidebar's pill, and a row read but not Done keeps a
    6 px `caution` ring where the dot was, since the pill still counts it. All's Attention lane
    label is `caution` too (Andy, 2026-10-11, polish audit inbox-03).
168. **Noise recedes:** an unread Noise row's sender and subject are `ink2` at 400 with an `ink3` dot,
    a read one's `ink3`; height, columns, cursor and actions don't change. In Unread nearly every row
    is unread, so the bold no longer ranked anything and the list's foot weighed as much as its top
    (Andy, 2026-10-11, polish audit inbox-07).
169. **Destructive actions warn under the pointer, affirming ones reward it, and a press lands:**
    the reader's Trash turns `alert` with a 12% `alert` fill (its key hint 16%), the floating
    detail's and the Today card's Delete and the editor's More › Delete `alert` on 14%, and a task's
    Complete `good` on 16%; all are neutral at rest, as Delete is undoable (#76). The card's Delete
    sits 9 px further right after a 1 × 14 px `hair` divider. Every reader tool presses as pills do
    (#150), Trash on 20% `alert` in `alert`, and the phone's Trash turns `alert` as
    it's pressed (Andy, 2026-10-11, polish audit reader-02, calflows-04).
170. **The reader's actions step back:** Add to calendar, Add as task and Ask about this email draw
    their labels in `ink2` and icons in `ink3`, `ink` under the pointer; ring, hover fill and the
    held state don't change. The body starts 12 px under them (was 4), so the eye runs subject,
    sender, then words (Andy, 2026-10-11, polish audit reader-11).
171. **The HTML email frame loses its glare in Night and gains an edge in Light:** in Night it's dimmed
    to 95% brightness (`--mailDim`, white becomes `#f2f2f2`; 90% looked dirty), and in Light it takes
    a 1 px `mailEdge` ring (`rgba(29,30,33,.1)`), a hairline rather than a shadow, so its boundary
    reads stronger than the email's own borders. `color-scheme` stays light (Andy, 2026-10-11, polish
    audit reader-08).
172. **Search in Light highlights like a highlighter, and a focused field wakes up:** a token `hl`
    keeps Night's 26% `sun` mix and gives Light its own solid `oklch(0.92 0.12 96)`, ink on it 13:1;
    Light's mustard `sun` at 26% rendered khaki, 1.3:1 on the row, so matches read as smudges. A
    focused field takes `edgeFocus` (Night `rgba(255,255,255,.2)`, Light `rgba(29,30,33,.3)`), at
    least as strong as hover's `edgeHover`, on `cardOn` (white in Light): the header search, the
    Answer and proposal cards' fields, the editor's, Settings' and sign-in's. While the header field
    has focus its hint reads `Esc`, as / then types a slash (Andy, 2026-10-11, polish audit
    search-02, search-06).
173. **Alfred has one recognisable mark:** `auto_awesome` filled with a gradient from `cool` to
    `violet` (two of Day stack's own colours, so no new hue), drawn once as an unseen SVG gradient
    that every Alfred icon fills from: Ask Alfred, the Answer card's header, and Ask about this email
    in the reader and ⌘K, which leave `forum`. Ask Alfred reads in `ink`, its query in `ink3`. No
    wash on the card and no tinted hover: the AI has no hue of its own, so it never outshouts mail
    (Andy, 2026-10-11, polish audit search-05, color-01).
174. **Light's forecast sun is deeper, and the high leads:** a token `sunGlyph` keeps Night's `sun`
    and gives Light `oklch(0.58 0.14 78)` (4:1 on the page, was a pale olive 3.2:1), for the sun on
    the month's and the week's day heads, the right pane and the phone's agenda; `sun` itself is
    unchanged. Temperatures read the high in `ink2` and the low in `ink3`, "78° / 61°" (Andy,
    2026-10-11, polish audit grids-13).
175. **Todoist's colours are tuned per theme, and a ring is tinted like a chip:** a task's ring keeps
    its project's hue and chroma at a lightness clamped to the calendar tokens' band, at least .72 in
    Night and at most .55 in Light, so every swatch reads (4.2:1 or more in Light, 7.1:1 or more in
    Night, where Todoist's raw sky blue was 2.9:1 and grape 2.7:1), and its project's mark in the
    editor's line takes the same clamp. The ring holds the same colour at 14%, as a chip does. A ring
    that completes keeps its colour under the pointer, its fill rising to 24% with an 11 px `check`
    in it, centred on the whole ring (the 1.5 px stroke included) rather than on its inside, so it sits
    true; the done glyph stays `good` (Andy, 2026-10-11, polish audit calpanes-07).
176. **A switch that's on is `good`, and off recedes:** on is a `switchOn` track (Night `good` 58%
    into `modal`, Light `good`) with a `switchKnobOn` knob (Night `ink`, Light white), so a column of
    switches no longer reads as a column of primary buttons and on ties to the healthy dots; under the
    pointer the track takes 86% of itself into `modal`. Off is an `ink3` knob on `sub3` in both
    themes (Light's `ink2` knob was nearly as heavy as on). Its press stretch is #151's; a disabled
    switch stays at .5 (Andy, 2026-10-11, polish audit settings-06).
177. **Month paging glides, so P, N and T say which way you went** (as Week's paging slides): the
    grid's scroll eases to the month over 260 ms (`cubic-bezier(.2,0,0,1)`), through the rows between,
    so next month comes up from below and last month drops in from above. Today from further than 10
    rows jumps to 5 rows short on the side it comes from first, so a year away still lands with its
    direction. A page mid-glide goes on from the month it's going to (N N N chains), and the wheel, a
    touch or a press in the grid stops it where it is. The mini-month, links, Back and Month from Week
    stay jumps. The header's title swaps over 120 ms, rising 6 px into place for a later month,
    falling for an earlier one, and sliding 6 px sideways for a week (Andy, 2026-10-11, polish audit
    grids-04, motion-12).
178. **T always answers:** as Today lands (once the month's glide is there, at once when nothing had
    to move), today's disc on the grid, in the week's heads and in the mini-month swells to 1.18 and
    back over 260 ms, once (Andy, 2026-10-11, polish audit grids-11).
179. **Month and Week are one space:** switching to Week zooms it in from the selected week's row in
    Month (scale .985 to 1 and a fade, 180 ms, its origin the middle of that row, or of the grid when
    the row is out of view), and switching back settles Month out around the same row (1.015 to 1),
    so Week reads as Month zoomed in on your week. A segmented control (Month | Week, Unread | All,
    Event | Task, News's sections, Code expiry) no longer jumps its fill: when another segment turns
    on, a `sub3` thumb slides from the last one to it over 180 ms, then hands it back its own fill
    (Andy, 2026-10-11, polish audit grids-09).
180. **A day answers the pointer, and + makes an event on it** (amending Week view's "a click never
    creates on its own" only by adding a control: a click on a day still only selects it): a month day
    under the pointer lays `sub` at 55% over its weekend or outside tint, fading over 120 ms (not on
    the selected day, nor a drop target), and shows a 20 px round + after its number, `add` at 14 in
    `ink3`, taking `sub2` and `ink` under the pointer and giving to .92 when pressed, titled "New event
    · C". It selects the day and opens New event on it, as C would there. A week's day head takes the
    same wash. Only with a pointer that hovers (Andy, 2026-10-11, polish audit grids-06).
181. **The week's empty hours show where a press would start:** a 30-minute slot (left 4, right 5,
    22 px, radius 6, `sub` with an `edge` inset) at the 15-minute step under the pointer, holding `add`
    at 12 and the step's time in 11 `ink3`, moves with the pointer over 120 ms and fades in and out
    over 120 ms; over a block, off the hours, while dragging or on a press it goes, the press handing
    over to the dashed create ghost. Only with a pointer that hovers (Andy, 2026-10-11, polish audit
    grids-07).
182. **The week reads by its dates and its now:** when the week shown holds today, a 1 px line in
    `alert` at 55% runs across all seven days at now's height, under today's own 1.5 px line and dot,
    moving with the clock, so the rest of the week reads as before and after now. A head's date is its
    column's anchor, 14 / 500 in `ink` on a 24 px disc (today's `alert` disc grows to 24 px, keeping
    600), 7 px from its weekday, which stays 11.5 uppercase `ink3` (`ink2` on the selected day); the
    month's numbers are unchanged (Andy, 2026-10-11, polish audit grids-08, grids-10).
183. **The next event stands out, and one under way stays under the now-line:** today's next event
    is lifted out of the list: inset 8 px with radius 10, a tint of its colour at 9% (14% under the
    pointer, 16% selected), its time in `ink` and "in 5h" in its colour (capped at `--tintL`) at 12.5 /
    500, its content keeping the rows' 20 px inset. The now-line goes after what has ended, not what
    has started, so an event under way sits under it, its "in" slot reading what's left ("45m left",
    "1h 20m left") and its 3 px bar filling with the time gone, the rest at 30%, refreshed with the
    clock. A past event turns grey as on the grid (#161): its time and title `ink3`, its bar at 45%,
    rather than the whole row at .5 (Andy, 2026-10-11, polish audit calpanes-01).
184. **One now-line in Calendar:** the right pane's now-line is drawn as the week's, 1.5 px `alert`
    at full strength with an 8 px dot, 12 px from its time so the dot sits centred on the events' 3 px
    colour bars (Andy, 2026-10-11, polish audit calpanes-04).
185. **Toggling a calendar visibly lifts its events off the page and brings them back, and Todoist is
    a calendar like the others:** hidden, a calendar's chips, blocks and agenda rows fade to nothing over
    120 ms, then it's hidden (here, and then at the server, as before); shown, they fade in over 180 ms,
    from the sidebar, ⌘K and Show all alike. Its checkbox fills or empties and its check grows in from
    .6 over 120 ms (#151), and while it's off its name is `ink3`, so on and off rows read apart. Todoist's
    row loses its ring at the right end, which beside a ticked box read as a second, unchecked control:
    it's just "Todoist" with its checkbox (amending Sidebar on Calendar's "its ring glyph as its mark"
    and board 11) (Andy, 2026-10-11, polish audit calpanes-11, calpanes-13).
186. **Ticking a task off is one moment wherever it's done:** as in the Today block (#106), its done
    check lands from .6 and .4 over 120 ms (the shared `ring-done`), in the right pane and on its card
    alike. In the pane its strike is drawn under the title, left to right over 180 ms, in `ink3`, and
    while Todoist hasn't confirmed, the spinner sits before the project, which stays, rather than
    taking its place. A task's card is the task on the grid: its ring in its project's colour (as #175
    clamps it), its project fact a 9 px dot in that colour rather than `work`, no Colour (a task has
    none), its title struck through in `ink3` once done, and its mark at .5 with the spinner after a
    second while it waits. Reopening plays nothing (Andy, 2026-10-11, polish audit calpanes-08,
    calflows-10, shell-15).
187. **Each word typed lands in its field:** a row the editor's line filled takes the mark's colour on
    its glyph, over 120 ms: the clock `cool` for a date or time, the pin `comf` for a place, the
    calendar glyph its calendar's colour, the project glyph its project's (clamped as its ring); set
    by hand, the glyph is `ink3` again. The mark still being typed, its Places or # menu open, is only a
    dashed 1.5 px underline in its colour at 70% (6 px dashes, no fill); picked (Enter, Tab or a
    click), it's a mark again and its tint brightens from 36% once over 260 ms. A field another's change
    moved flashes `cardOn` back to its own fill over 600 ms: the Date when the End runs into the next
    day, the address a picked place fills in, and an End on a later day says "+1" after it (11.5,
    `ink3`, raised) (Andy, 2026-10-11, polish audit calflows-06).
188. **The mini-month is crisp:** its days are true 26 px discs, not 31 × 26 lozenges; the selected
    day is a `sub3` disc with its number `ink` at 500 and the pointer only `sub2`, so what's picked and
    what's pointed at never look alike; in Week the shown week is one `sub2` band across its cells, its
    ends round, today's `alert` disc on it (amending "the visible week or selected day `sub`"). It
    always draws six weeks, the next month's days after its own, so stepping into a six-week month never
    moves Calendars under it, and ‹ › slide the days in 8 px from the side they come from with a fade
    over 180 ms. The editor's date picker shares it (Andy, 2026-10-11, polish audit calpanes-05).
189. **A choice is the strongest mark in its picker:** inside the date picker only (the sidebar keeps
    its disc), the chosen day (a task's due day, an event's one day) is the `accent` 50% disc at 600,
    #104's colour, and today steps back to a 1.5 px `alert` ring around an `ink` number; a chosen today
    takes both; the pointer stays `sub2` under them. The editor's Calendar, Repeat, Project and a task's
    Repeat menus mark the current choice as Settings' do, a 16 px `check` in `ink` at its row's end
    (#149), leaving the `sub2` fill to the pointer and the keyboard's cursor (Andy, 2026-10-11, polish
    audit calflows-08).
190. **Picking a day answers in all three places:** the grid's selected day keeps its `sub` and its
    number takes a `sub3` disc with `ink` at 500 (today keeps its `alert` disc), echoing the mini-month's
    selected disc (#188); the pane's content slides in 6 px over 120 ms from the side the new day lies
    on, later from the right, earlier from the left, and its date heading fades in over the same 120 ms.
    Nothing plays on the way out, or when the same day is picked again or an item changes (Andy,
    2026-10-11, polish audit calpanes-06).
191. **An empty day is room to plan:** the right pane's empty day, past or to come, shows two 36 px
    ghost rows 6 px apart, radius 10, in the grid's draft language (a 1.5 px dashed `edgeOn` outline):
    `add` 16 in `ink3` "New event" with its `C`, and an open ring "New task" with its `D`, `ink2`; under
    the pointer `sub`, `ink` and an `edgeHover` outline over 120 ms. The line under the date stays the
    one line ("Nothing planned", or the forecast). Replacing Copy's "No events · New event" there (Andy,
    2026-10-11, polish audit calpanes-09).
192. **Changes look on their way, then visibly arrive:** an event waiting for its provider (a create,
    Save, a drop, Clone, Paste, Colour, Try again) keeps .5 but its 3 px bar is dashed (3 px on, 3 off)
    rather than solid: still for the first second, so a quick confirmation stays quiet (#54), then
    marching downward with the spinner, every 900 ms. When it arrives (its change done, or a create's
    copy first drawn settled) its tint starts at `--evland` (Night 34%, Light 26%) and settles back
    to `--evtint` over 420 ms, and the .5 eases back over 120 ms rather than snapping. The month's
    chips and the week's blocks alike; a task keeps .5 and the spinner, with the ease (Andy,
    2026-10-11, polish audit calflows-02).
193. **Deleting and undoing feel physical and reversible:** a chip deleted (the card, Del or
    Backspace, a recurring delete once it's answered) fades and shrinks out (to .96) over 120 ms, then
    folds up over 180 ms, so the chips under it slide up the 23 px into its place, as mail's rows fold
    (#13), and the cell's "+N" recounts as it goes; a week block fades and shrinks out. Undo or ⌘Z
    brings it back in reverse, unfolding and fading in from .96 over 180 ms, then its tint lands
    (#192) (Andy, 2026-10-11, polish audit calflows-11).
194. **A drag lands where it shows it will:** picked up, a chip eases into its tilt, scale and shadow
    over 120 ms (a week block its shadow). The day under it takes the item's own colour rather than
    the selected day's `sub` (its fill at 9% and a 1.5 px inset ring at 55%, Light 7% and 50%; a task's
    `ink3`), over 120 ms, so the target reads as inviting and apart from the selection; in the month it
    also shows a 20 px dashed slot (its colour at 70% over 10%, no text) where the item would sort in
    among the day's items. Dropped, the chip settles from where the lift was into its slot over 180 ms
    on the glide's curve, its tilt, scale and shadow easing out, then shows as on its way (#192); a
    recurring event's drop, which asks which occurrences first, waits where it landed. The week's
    column under a move takes the same colour (Andy, 2026-10-11, polish audit calflows-09,
    motion-15).
195. **A calendar search lights up its matches on the grid:** while the search shows its results, the
    month's chips and the week's blocks it doesn't match dim to .3 over 180 ms (a filter, so a match's
    own .5 while waiting stays), and matches keep their full strength with no ring, since a selected
    item is the solid chip; a recurring event's every occurrence matches with its series. Clearing the
    query or Esc brings the grid back over the same 180 ms. A search with more results still to load
    (past 50) dims nothing, so no match is ever dimmed (Andy, 2026-10-11, polish audit search-10).
196. **From 640 to 1099 px a header button brings the selected day's pane over the grid** (D183, as
    #140 gave the grid the width): a 30 px icon button with `right_panel_open`, before search and only
    in that tier, lays the day's pane (weather, events with Time to Leave, tasks due) over the grid's
    right side where the editor lies, with its motion; its sources' health stays atop the grid. Lit
    `sub2` while open, it again or Esc closes it; picking another day while it's open shows that day;
    the editor or search take its place, as they take each other's. Closed on every load, and no new
    key; under 720 px, where the header has no room left, New is its + alone (titled "New event · C");
    the desktop is unchanged (Andy left it to Claude, 2026-10-11, polish audit calpanes-14).
197. **A row leaving shows why, then folds text first** (amending #13): Done tints the row `good`
    (14%, Light 12%) and swaps its dot for a 14 px `check` in `good`, growing in from .6; Trash tints it
    `alert` 8% with a 14 px `delete` in `alert`. That 120 ms beat comes before the fold, which then
    takes its text away by 72 ms and closes its height over the rest of the 180 ms; an arriving row is
    the mirror, its height first and its text over the last 72 ms, so a folding row never shows a
    squashed slice of its lines (a closed card folds the same way). The cursor and the next email move
    at once; the toast's glyph is #147's (Andy, 2026-10-11, polish audit inbox-05, inbox-06).
198. **A group opens and closes like a drawer:** collapsing it folds its rows out and expanding it
    folds them in, as other rows fold, each 12 ms after the one above it up to 60; its one chevron
    turns to point right over 120 ms while it's collapsed, and its preview fades in over 120 ms. A
    group opened at the foot of the list comes into view (#70) once its rows are in. All's Noise
    opens and closes the same way (Andy, 2026-10-11, polish audit inbox-14).
199. **The Today block's event leads with its calendar's bar and warms as it nears:** a 3 × 14 bar,
    radius 2, in its calendar's colour (or its own, once recoloured) sits in the 19 px column where
    tasks have their rings, so the event reads as an appointment and its time lines up with the task
    titles; its "in 12m" turns `caution` at 500 from 15 minutes before and `alert` at 500, the
    now-line's, once it's under way (Andy, 2026-10-11, polish audit shell-06).
200. **Completing a Today task is the one completion moment:** its done check lands from .6 and .4
    over 120 ms, the `ring-done` the calendar's pane and card share (#186), and its title, struck
    through, fades from `ink` to `ink3` over 180 ms rather than at once; the line still folds away
    after #106's 360 ms. Only the user's own completion plays it (Andy, 2026-10-11, polish audit
    motion-04).
201. **The sidebar reshapes for each page instead of jumping:** on Calendar the account rows fold away
    over 180 ms, as a mail row folds, and come back the same way, so Calendar and News slide to their
    places rather than jumping from under the pointer that clicked them; the page's section (Today, or
    the mini-month and Calendars) fades in over 120 ms. The content still switches at once (Andy,
    2026-10-11, polish audit shell-08).
202. **Counts roll, and a rise in Attention registers:** the attention pill, Inbox's and each account's
    unread count, a group header's and All's lane counts roll when they change, for 180 ms, the old
    number leaving 6 px one way as the new comes in from 6 px the other: down for a fall, up for a rise.
    When the attention count rises (never on a fall, the first paint or a page switch) the pill swells
    to 1.22 at 40% over 260 ms; from none it scales in from .6 over 180 ms, and at none it scales out
    over 120 ms before it goes. The user's own Done only rolls (Andy, 2026-10-11, polish audit
    shell-11, motion-07).
203. **All caught up is a small finish** (amending #124 for it): three rows 14 px apart, centred as
    before: the mark at 44 px, its chips settling into place once (each from 6 px above, fading in over
    260 ms, 70 ms apart, then at rest), "All caught up" at 15 / 500 in `ink`, and Open All with its U
    hint, the line and the button fading in over 180 ms after 60 ms. No new words; the mark keeps its
    own colours in both themes (Andy, 2026-10-11, polish audit states-10, inbox-08).
204. **A pinned email shows its pin where it is:** its row in its group keeps a 14 px `keep-fill` in
    `ink3` just before its account, growing in from .6 over 120 ms when it's pinned there; the row
    folding onto the shelf holds `sub3` after its fold and lets it go over 260 ms; and a pin made while
    the shelf is out of sight says "Pinned" in the toast, led by `keep` in `ink3`, with Undo (amending
    #147's tones) (Andy, 2026-10-11, polish audit inbox-09).
205. **Headers stay with their rows:** Unread's group headers and All's day headings stick to the top
    of the list while their rows scroll under them, each next one sliding over the last, and J and K
    keep a row clear of them; in All a day's name is `ink2` and its date `ink3`, above the lanes'
    `ink3` (Andy, 2026-10-11, polish audit inbox-10).
206. **A code's last minute counts down, and Copied is green:** Copied takes a 14% `good` fill with
    its words and check in `good` for its 1.5 s, under the pointer too; in a code's last minute its
    countdown reads "Expires in 42 sec" in `caution`, a second at a time, and the row folds away at
    expiry as before (Andy, 2026-10-11, polish audit inbox-11).
207. **A list filtered to one account drops the account** (amending decision 41): while an account in
    the sidebar filters the Inbox (Unread, All and its search), rows and Attention rows leave out the
    account they'd all repeat; the age keeps its column and the subject runs wider. Unfiltered every
    row keeps it, and the phone's rows keep theirs (Andy, 2026-10-11, polish audit inbox-12).
208. **An email swaps in from where the user stepped** (amending #148, where J and K swapped what the
    pane shows without motion): the email the pane opens on arrives with the pane's slide; after it,
    going down the list (J, ↓, Done or Trash moving on) the next email rises 8 px from below over
    180 ms, going up (K, ↑) it comes down 8 px from above, and one opened by a click fades in over
    120 ms, as the week pages. The tools never move (Andy, 2026-10-11, polish audit reader-03).
209. **A verification code is lifted into the reader:** after the sender, a 56 px card in the facts
    card's look (`card`, radius 14, an `edgeOn` ring; padding 0 12 0 18, 14 px between its parts) holds
    the code in Geist Mono 22 / 500 / .12em in two groups, Copy (Copied in `good`, #206), and at its
    right the countdown on the clock rather than the email's own words, "Expires in 11 min" in `ink3`
    12.5, by the second and in `caution` through its last minute; expired, it reads "Expired" and the
    code turns `ink3` (Andy, 2026-10-11, polish audit reader-04).
210. **The reading pane's edge shows it resizes:** its hit area is 10 px straddling the border. Under
    the pointer, after 80 ms so a pass doesn't flash, a 2 px line in `ink` at 26% lies along the border
    and a grip (14 × 28, radius 999, `cardOn` with an `edgeOn` ring, a 14 px `drag_indicator` in
    `ink2`) fades in over 120 ms at the pointer's height; dragging, the line is `ink3` and the grip
    stays; a double-click puts the pane back to 680. News's story pane shares it (Andy, 2026-10-11,
    polish audit reader-09).
211. **Hidden images keep the email's shape:** a hidden image that gives its width but no height
    holds a quarter of its width, 56 to 160 px (a small one stays square), so a mailing service's
    newsletter keeps its pictures' places rather than collapsing to a band; one with no size and no
    words is a 56 px band its line's width; and a placeholder with no alt text shows the 20 px
    `hide_image` glyph at its centre in the frame's grey, so it still says "picture" (Andy,
    2026-10-11, polish audit reader-10).
212. **A result's why line says only what the row doesn't** (amending Search's "each result shows
    why it matched" and #24): a sender's, organisation's, subject's or body's reason goes when its
    words are highlighted in the row's lines, and a date's always, as the row's own day is its age (or
    its day column); a type, kind, account or place, and a body match the excerpt doesn't hold, stay.
    With none left the row has no why line and is three lines high. Calendar results the same: a
    highlighted title and the date go (Andy, 2026-10-11, polish audit search-11).
213. **No results reads as the field's chips:** "No emails match", then each chip and the words drawn
    as the field draws them (22 px, `sub2`, `ink` at 400, padding 0 4 0 9, its × and the whole chip
    answering, #154), 8 px apart with no dots between; a Not chip keeps its "Not" in `ink3`. Calendar's
    and News's the same (Andy, 2026-10-11, polish audit search-13).
214. **Starting a search makes room rather than cutting:** the mail header's field grows leftward from
    380 to 520 px over 180 ms (the compact tier's too), and Unread | All fades out over 120 ms as the
    title becomes Search (Andy, 2026-10-11, polish audit search-14).
215. **The answer's key fact points at its evidence:** Alfred's bold runs are underlined, 2 px thick and
    3 px under, in Night's `sun` at 70% and Light's `hl`, the yellow the email marks the same words
    with, without filling the card (Andy, 2026-10-11, polish audit search-15).
216. **⌘K marks what was typed:** in each result's label the start of each word a typed word matched
    is drawn `ink` at 600 with no fill, so rows off the cursor show it against their `ink2` and the
    cursor's row by weight; a match in a command's keywords alone marks nothing (Andy, 2026-10-11,
    polish audit shell-13).
217. **Send test answers clearly:** while it sends, the shared spinner (`progress_activity`, 900 ms)
    takes its `send` glyph's 17 px place, so the button keeps its width. Anything but sent is a
    failure: the line under the group is `alert`, led by a 16 px `error`, in words ("Not sent, Can’t
    reach ntfy.example.net", "Not sent, ntfy.example.net didn’t answer in time", "Not sent, ntfy
    answered 401, unauthorized" with ntfy's own words), never the network library's "fetch failed".
    A test that went reads "Sent to setpoint-reminders" in `ink3` after a 16 px `check` in `good`, and
    the button's glyph is that check for 2 s. The header's failing dot is `caution`, as every failing
    source is (#218). The Server field, saved, shows a 16 px `check` in `good` 9 px inside its right
    end, in over 120 ms and out over 180 ms after 1.5 s (Andy, 2026-10-11, polish audit states-11,
    settings-07).
218. **Each tone has one glyph, so seriousness reads from shape** (Glyphs › Tones): `caution` is the
    `warning` triangle (a source failing or retrying on the Inbox's and the calendar pane's lines,
    triage down on the Unsorted group, News's AI down and a failing section, a search that couldn't
    answer, ntfy failing as a `caution` dot), `alert` is the `error` circle (a change failed, the
    failure toast, Alfred's failure, a Send test), and stale is `history` in `ink3`, the Inbox moving
    off `schedule` and News's stale section line gaining it. Account trouble keeps `sync_problem`, the
    Inbox's needs-reconnect bar too. Glyphs are 16 px in lines and rows (the finding's 15 in rows
    isn't a role size, #123), the lines' gaps unchanged (Andy, 2026-10-11, polish audit states-04).
219. **Every source's state in Settings leads with its glyph:** in Accounts (Mail and Sources), News
    and Todoist's Connection row, a 7 px `good` dot before "Checked 9:11 AM", `history` in `ink3`
    before "Checks stopped, as of 9:14 PM" (the words a step up, `ink2`, still muted), `warning` in
    `caution` before a failing source's reason with its row at `caution` 7%, as News's failing rows
    were, and `sync_problem` before "Needs sign-in"; while Check now runs, the shared spinner. The
    gap stays 8 px, and a source not checked yet has no glyph (amending Health and states' "Healthy:
    nothing" for Settings, and board 17's bare healthy text) (Andy, 2026-10-11, polish audit
    settings-01, states-04).
220. **The fix is on the line:** each stale or failing line on the Inbox and atop the calendar's pane
    (Google Calendar, Todoist, Weather; above the grid in the compact tier) ends " · Check now", the
    dot `ink3` and the button the bar's Reconnect look in `ink2` (12.5, 24 px tall, padding 0 9, `sub`
    and `ink` under the pointer); it checks that account's or source's own (Google Calendar's worst
    account), and reads "Checking…" until the check lands, as Settings' rows do (#42), or why it
    couldn't start. On a failing calendar line that wraps, it sits beside the first line. The
    needs-reconnect bar's Reconnect goes straight to Google's sign-in when one Gmail account needs it,
    as its row in Settings does; for iCloud, or several accounts, it opens Settings › Accounts (amending
    Health and states, where only Needs reconnect had an action) (Andy, 2026-10-11, polish audit
    states-08).
221. **State lines arrive gently and resolve visibly:** the Inbox's needs-reconnect bar and stale and
    failing lines, and the calendar pane's lines (above the grid in the compact tier too), fold in
    and out as rows do (#13, app/fold.ts): the height opens over 180 ms with the words coming in over
    its last 40%, and closes the same way, so a 40 px bar arriving no longer shoves the list down in
    one frame. A stale or failing line whose source is healthy again keeps its place for 1.2 s with
    its glyph turned to a 16 px `check` in `good` (scaling in from .6 over 120 ms) and its words
    quiet in `ink3`, then folds out, the one success flourish the health system has; the bar, which
    clears by signing in, just folds out. The offline pill comes in from 8 px above over 180 ms and
    fades out over 120 ms. Nothing loops; a line on screen at the first paint shows as it is (Andy,
    2026-10-11, polish audit states-13).
222. **Offline is read-only for now, not a locked screen, and a blip never cries wolf** (amending
    Health and states' "everything under it dimmed, changes disabled", which the build had read as
    nothing to press): changes are refused from the moment the live stream drops, as before
    (client.ts's refusal; the keys that change something, H E P C D Delete Backspace ⇧I ⇧U ⌘Z, and the
    controls that would reach nothing), but the pill and the dim wait out a 2 s grace, so a laptop waking or a Wi-Fi
    handoff shows nothing. Once shown, the page under the pill dims to .62 with `grayscale(.5)` over
    180 ms (Night's `ink2` still 3.6:1, Light's 2.8:1) and takes the pointer: the list scrolls, J, K,
    the arrows, Enter and Esc work, and an email or story opens; the controls that change something
    (the reader's tools and actions, a task's check, Mark all as read, Unpin, Copy, Check now and
    Reconnect) sit at .4 and take no pointer. Back online, the dim lifts over 180 ms and the pill fades (#221) (Andy,
    2026-10-11, polish audit states-05).
223. **News's waiting and quiet lines say which they are:** the first run's line keeps its spinner and
    gains its progress along its foot (#224's track: 2 px `sub2`, the share sorted in `ink3`,
    easing over 260 ms as the counts come); "Nothing sorted in AI yet" turns with the same 16 px
    spinner instead of the paper; a stale section's line leads with `history` (#218). A quiet
    section ("Nothing new in Tech since Mon") keeps the 16 px `newspaper` every News empty line has
    (#124), not the finding's `done_all`, which no longer marks anything else. A section whose block
    shows none of its stories, its others shown elsewhere, links "2 in Tech" rather than "2 more in
    Tech" (Andy, 2026-10-11, polish audit news-13).
224. **Progress looks the same wherever it runs:** one spinner, `progress_activity` turning every
    900 ms (states.css; it was defined twice), and one progress line: search's first backfill leads
    "Indexing · 62% · showing what's indexed so far" with the 16 px spinner in the line's `ink3` and
    draws the 62% along the line's foot, a 2 px `sub2` track over its hairline with the share in
    `ink3` (radius 0 2 2 0), its width easing over 260 ms, as News's first run does. The fill is
    neutral, as a usage meter's is (#134), where search-12 drew it in `cool`, which is Personal's and
    "you are here"'s colour, and where states-15 drew a 48 × 3 meter inline; one foot serves both
    findings and News. A search on its way turns the field's glyph (polish audit search-03) (Andy,
    2026-10-11, polish audit states-15, search-12).
225. **A page that's loading says so, in its rows' shapes:** until its data's first answer, a page
    draws a skeleton where its rows will be, built to their geometry (the Inbox's header 30 px,
    Attention's three-line rows, the other rows 38 px), so the rows replace it where it stood. Its
    bars are `sub2`, `sub3` inside a `sub` group, rounded, 9 px for a line of text, 11 for a title;
    dots 8 px (7 for an account's), images radius 12, thumbnails 72 × 48 radius 8. It shows only
    after 200 ms, so a quick answer never flashes one, fades in over 180 ms, then breathes, every
    bar together, opacity 1 → .45 → 1 over 1600 ms `cubic-bezier(.4,0,.6,1)`: a new loop, for
    loading only, beside the spinner's turn. Skeletons don't shimmer, which would be louder than the
    house style. What replaces it fades in over 120 ms. A page shows no empty state ("All caught
    up", "No events", "Not connected") until it knows (Andy, 2026-10-11, polish audit states-03,
    inbox-13).
226. **Settings says only what it knows:** each page's groups draw skeleton rows until their answers
    come (#225): a title bar over its line (one bar and a shorter one for a one-line row: rules,
    domains, calendars, projects), the control's place an 84 px bar at the end, the icon tile first
    on Accounts and News, in `sub3` on the group's `sub`. So Todoist never reads "Not connected"
    with Connect Todoist while it's connected, Calendar "Home · Not set", Mail "No rules yet",
    "0 domains" and "None yet", Security "—" codes, Notifications "Not set up", or Attention
    precision that nothing was Done. Opening Settings loads every page's answers a moment after
    its own, so the next page shows at once (Andy, 2026-10-11, polish audit states-01,
    settings-05).
227. **Calendar's pane says what's planned only once it knows:** until the selected day's month of
    items and the calendars have come (a first open, or a day picked in a month not yet loaded),
    the right pane's line under the date is a 110 px bar, unless the forecast has come, and its
    agenda three skeleton rows (#225): a 52 px time bar, a 3 × 34 rail in `sub3`, a title over its
    line; never "Nothing planned" or the empty day's ghost rows (#191) on a day that holds Gym and the
    Dentist. Calendars in the sidebar are four 30 px rows of a 14 px box (radius 4) and a bar. The
    grid draws no stand-in chips, which would read as events; the phone's agenda draws two days of
    skeleton rows (Andy, 2026-10-11, polish audit calpanes-03, states-01).
228. **A page that couldn't load says so where it would be:** when a page's first answer fails (a
    500, a timeout) while Setpoint is reachable, the list, the reader's body, the right pane's day,
    News's list or the Settings page shows one 32 px line in its place, the failing line's look:
    a 16 px `warning` in `caution`, "Couldn’t load the Inbox, Something went wrong." (the server's
    words after a comma; "this email", "this day", "News", "Settings › AI"), then " · " and **Try
    again** in `ink` with its `refresh`, which asks again. Its skeleton goes, so nothing claims it's
    still coming. A refresh failing under data already shown keeps the data and says nothing; the
    next live event tries again. Offline, the pill already says so, and the skeleton waits (Andy,
    2026-10-11, polish audit states-06).
229. **An email opens at once from its row; only its body waits:** a click, J or K, auto-advance,
    a tap on the phone or a search result draws the reader's head from the email's row before
    the email itself has come: the protected line, the subject, the avatar, the sender with its
    organisation and platform (the sender's domain follows with the email), "to you", the account
    and the time, and the actions, More too, so nothing above the body moves when it lands. The
    body is a skeleton meanwhile (#225): 10 px lines 12 apart at the body's rhythm (100, 97, 90, 94
    and 60%, a paragraph's break, 92, 86 and 40%), at most 600 px, and an attachment's 44 × 280
    card when the email has one; then the body fades in over 120 ms. An email with no row to draw
    from (a link) has a skeleton head too. An HTML email's frame holds 240 px on `sub`, unseen,
    until its page says its height, then fades in over 120 ms. An attachment's preview loading is
    a page's skeleton, not "Loading…" (Andy, 2026-10-11, polish audit reader-01, phone-04).
230. **A news image waits in its own box and fades in:** each list thumbnail, lead, story-pane
    and article image holds its box from the start, filled as a skeleton is (`sub2`; Light `sub3`,
    which shows on the page where `cardOn` didn't) and breathing with it after 200 ms, then fades
    in over 180 ms once loaded, the fill gone under it. Every news image carries a 1 px `edge`
    outline inside its edge, which shows only where an image is white (a product shot on the
    Light page). No shimmer sweep: the image's wait breathes as every skeleton does (#225) (Andy,
    2026-10-11, polish audit news-02).
231. **News opens into its own shape:** until its first answer, the list draws its skeleton, built
    to its rows (#225): in All, two blocks of a 32 px section header with a 46 px bar, a lead (a
    232 × 130 image radius 12, two 12 px title bars, a summary bar and a 90 px meta bar at its
    foot) and three rows (title over summary, a 56 and a 28 px meta bar, a 72 × 48 thumbnail
    radius 8); in a section or Missed, a lead and six rows. The stories replace it where it stood,
    fading in over 120 ms (Andy, 2026-10-11, polish audit news-03).
232. **A story opens at once from its row:** opening a story (a click, Enter, J or K) draws its
    sections as tags, the headline and its meta ("5 outlets · first reported … · updated …", from
    the row) and its image at once; the image is the large copy, over the row's thumbnail blurred
    6 px until the large one is in. The summary is four 11 px skeleton lines and Sources three
    skeleton rows until the story comes, then they fade in over 120 ms. Each story or article
    eases in as it's opened or stepped to: opacity from 0 and 4 px up, over 180 ms. An article
    opening draws its outlet, time and headline from the story's sources and its text's skeleton
    (Andy, 2026-10-11, polish audit news-05).
233. **Setpoint starting shows its mark, not a black page:** while it asks whether this browser is
    signed in, a browser it hasn't seen signed in shows the Day stack mark at 36 px where the
    sign-in card's top sits (and Unreachable's mark, #118), only once the start has taken 200 ms.
    Its chips settle in turn as All caught up's do (#203), each from 6 px above and transparent over
    260 ms `--ease`, 70 ms apart, then the mark breathes as a skeleton does. The sign-in card or the app then fades in over
    180 ms; a quick start shows neither the mark nor the fade (Andy, 2026-10-11, polish audit
    states-09).
234. **The app opens already itself:** a browser that was signed in starts on its shell as it last
    stood while Setpoint answers: the sidebar with the accounts, their colours and counts and the
    Inbox's pill and count as this browser last showed them, Today's place (as many skeleton lines
    as it showed today, else three), the page's header and its skeleton; on the phone the mark,
    the page's name, the Inbox's search row, the tabs and the page's skeleton, an email's address
    its reader's. The answers then settle the counts in place and nothing under the accounts moves.
    A first visit draws three skeleton rows for the accounts (a 7 px `sub3` dot, an 8 px bar, a count
    bar) and three for Today (a 13 px `sub3` ring and a bar). The app's skeletons carry on from the
    shell's without fading in again. This browser keeps that shape (`setpoint.sidebar`) and that it
    was signed in (`setpoint.signedIn`) in its own storage, as it keeps the theme, and forgets both
    on Sign out or when the session ends (Andy, 2026-10-11, polish audit shell-10, phone-12).
235. **A search on its way never blanks the list:** from the first keystroke until its first
    answer, the list on screen (the Inbox, or All) stays, at .55 over 120 ms; if the answer hasn't
    come in 200 ms, six skeleton rows shaped as results take its place (a 150 px sender bar and a
    70 px one at the right, a 46% subject, a 64% excerpt at .6; 12 16 13 12 padding, `hair`
    between). While any search is on its way, once it's taken 200 ms, the field's `search` glyph
    gives way to the 900 ms spinner, so a quick answer never blinks it. The first results fade in
    over 120 ms; a refinement on its way dims the results it will replace to .55, after the same
    200 ms (Andy, 2026-10-11, polish audit search-03).
236. **Alfred shows its work as a trail** (amending #80, whose one line said only the step now):
    while Alfred answers, each step it has finished stays as a 20 px row in `ink3` 12.5 after its
    tool's 14 px glyph, in the past tense: `search` "Searched “lease renewal”", `mail` "Read
    Parkside Apartments’s email", `calendar_today` "Checked your calendar", `event` "Prepared the
    event". The step it's on keeps the spinner, its words shimmering, `ink` sweeping through `ink3`
    over 1.6 s, the one shimmer in the app, for work under way; two skeleton bars (10 px, 72% and
    46%, at most 620 px) hold the answer's place, and the header's glyph twinkles (.55 to 1 over
    1.2 s, back and forth). When the answer lands, the trail folds away over 180 ms and the answer
    and its sources fade up 4 px over 180 ms. About one email, the first step reads "Reading this
    email…" (#108) (Andy, 2026-10-11, polish audit search-04).
237. **All's kinds become subheadings where their column has no room:** with the reading pane open
    and on the phone, each FYI run of one kind starts with a 24 px subheading (its group's glyph at
    13 px, 6 px before the kind's word, 11 uppercase .04em, `ink3`, padding 0 16 4 24, as the lane's
    header) in place of the left column, so FYI never reads as one flat run. Wide, the column stays
    (#48, #119). Opening or closing the pane scrolls the list by the subheadings' height above the
    email, so the row clicked stays where it was (Andy, 2026-10-12; darma SV-67).
238. **The reader shows the summary under the subject:** the summary the list showed in the
    subject's place (#35, #74) is the head's second line, `ink2` 14 / 1.45 (15 on the phone), max
    680, 6 px under the subject, on every size and from the row at once. An email with no summary
    has no line, and security mail none (its facts card says it) (Andy, 2026-10-12; darma SV-67).
239. **On the phone a row's summary wraps to a second line** (amending #66): a row's line under the
    sender, and an Attention row's summary, take up to two lines, ending in "…" past them, rather
    than being cut at about 45 characters (Andy, 2026-10-12; darma SV-67).
240. **Beside the reading pane the sender narrows:** with the pane open (at 1100 px and up, where it
    sits beside the list), the sender or organisation takes 24% of its row's width inside its
    padding, between 112 px and its own width (172 in Unread, 200 in All), so the summary keeps
    room: at 1440 px with the pane at 680, All's summary goes from 73 to about 150 px. A long sender
    ends in "…"; the reader names it whole. Unread at 1677 px is unchanged (Andy, 2026-10-12; darma
    SV-67).
241. **Done in All shows it** (amending #93, which keeps Done mail in All): the row stays, ticking in
    place as Done's beat does (the check landing in the gutter in `good` over the row's `good` 14%
    tint, both letting go over 260 ms), then settles `ink3` at 400, unread or not, with no dot or ring
    and a ✓ Done tag before the account, as search's Done results read. Attention lanes count only
    mail not yet Done, and one whose mail is all Done shows no count. Mail already Done shows "✓ Done"
    in the reader's tools where the button was, not as a button (Andy, 2026-10-13; darma SV-69 D263).
242. **A lone `#` or `@` shows its choices before anything is typed,** as darma's `#` does: a `#`
    ending the editor's line opens Project's menu with every project (a task) or Calendar's with
    every Google calendar (an event), and a space closes it. An `@` ending the line, with at most one
    letter after it (Places searches from two), opens Place's list with the places events have used:
    the most used first, then the latest, six at most, each with its address, narrowed by that
    letter. The Place field offers the same list once focused with less than two letters in it, in
    the editor and on the proposal card (where it floats under the field as a menu). Picking one
    fills the place and its address without asking Google. Tab through an empty Place goes on
    without picking (Andy, 2026-10-14; darma SV-71).
243. **The Inbox is one list** (amending #20, #34, #36, #70, #75, #84, #89, #101, #102, #105, #203, #204; Andy,
    2026-10-14; darma SV-70 D264, D266): New, Attention, the Pinned shelf, then the days, and no
    Unread | All. New is every email unread when this visit first saw it, kept there read or not
    until the user leaves the Inbox, drawn as a day with ages: lanes, kinds, Noise folded, the
    pattern prompt under its Attention, Mark all as read under it. Attention is every read Attention
    email not yet Done; unread Attention mail is in New first and comes here on the next visit. An
    email marked unread stays where it is for the visit. Mark all as read empties New: what it reads
    goes to its day, Attention it leaves unread to Attention, and Security it leaves unread to its
    day. Pinned mail is on the shelf only. A part with nothing in it doesn't show, and there's no
    All caught up. `U` takes the cursor to New's first email; `1` and the sidebar always open the
    same Inbox, and All's old addresses land there. The phone is the same list. Attention keeps its
    `caution` dot and ring (#167) and Noise recedes (#168) on the list's rows. Board audit (override
    33): 01 1.91% → 6.18%, 04 0.19% → 2.39%, 09 0.51% → 5.09%, 10 2.72% → 7.58%, 19a 0.97% → 3.35%,
    22a 1.97% → 4.45%; 05 4.52% → 4.39%, 21a 10.35% → 10.24%; the rest within 0.1%.
244. **A new task can go to Todoist with no date:** its Due date starts on the day the editor opened
    on, as before, and an × in the field takes it off. The field then reads "No date" (`ink3`), and
    Time and Repeat go with it, since a time or a repeat needs a day; a day picked brings the date
    back. Created, it's on no day, so nothing is drawn. It says nothing (#247, which dropped the
    "Created Learn guitar, no date" toast) and has no Undo, because Setpoint keeps no copy once Todoist has it (undated tasks aren't
    on the calendar, v1's choice). A refusal has no item to fail in place on, so it comes as a
    failed toast in Todoist's words, with Try again. An existing task keeps its date; taking one
    off is done in Todoist (Andy, 2026-10-14; darma SV-74). Board audit: no board draws a new task's
    editor; the numbers are #243's (22a 4.45%, 19a 3.35%, 21a 10.24%).
245. **A link in an event's place has Open** (extending #125 to the floating detail): a place that
    is a link alone reads as the right pane's does, a 17 px `videocam` and the link's host
    ("zoom.us") in `ink`, the whole link as its tooltip. A link among other words ("Room 204 or
    https://…") keeps the words as written after `location_on`, breaking anywhere so a long link
    wraps inside the card. Either way an **Open** button (`btn ghost sm`, a 16 px `open_in_new`)
    ends the place's first line and opens the first link in a new tab; `O` does the same while the
    card is open. A link is `http://`, `https://` or `www.` (a bare domain isn't), without
    punctuation after it, read from the place and an address Google kept on the same line
    (`placeLink` in web/src/logic/place.ts, which the right pane's line now uses too). Time to Leave
    keeps its own test for a link (server/src/domain/timeToLeave.ts) (Andy, 2026-10-15; darma SV-77).
    Board audit: no board draws a link as a place, so it's unchanged (11 0.70%, 12a 0.43%).
246. **An event can have no end:** End's list starts with **No end**, and "no end" or "none" typed
    there does the same. A new event still gets an hour; No end is picked. Google needs an end, so
    the event ends as it starts (v1 kept the same zero-length hold), and that's how one made in
    Google reads here too. The End field then reads "No end" in `ink3`, as the Date field's "No
    date" (#244), and a new start keeps it without one. Its time says its start alone, "7:45 PM",
    in the agenda, the card, search and the week block, which is drawn at the shortest block's
    height. It takes no time, so it overlaps nothing and nothing overlaps it: no Overlaps line, and
    the editor's preview says No conflicts. Once its start has gone it's past (Andy, 2026-10-15;
    darma SV-78). Board audit: no board draws an event with no end; board 13's End field still
    reads "9:00 PM", so it's unchanged (13 1.56%). The line reads No end too: the same time twice ("2pm to 2pm",
    "2-2pm"), or "no end" before or after a time ("2pm no end"), lit with the time. Only an end
    before the start is the next day's ("11pm-1am"), and a bare time still gets its hour (Andy,
    2026-10-26; darma SV-108, D286).
247. **A create says nothing** (amending #76 and #244): creating an event or a task, from the
    editor or an email's proposal card, raises no toast on success, since a toast read as an error
    every time. The item on the grid, or the card closing, is the answer. ⌘Z still takes back a
    create made in the editor while it's on a day; a task created with no day has no Undo, as
    before. A failure still speaks: in place on the grid, in the proposal card, or, for a task with
    no day, as a failed toast with Try again. Clone and Paste keep their toasts with Undo, being
    changes to what's already there rather than something new (Andy, 2026-10-15; darma SV-79).
    Board audit: no board draws a create's toast, so it's unchanged.
248. **A right-click opens the thing's actions at the pointer** (Andy, 2026-10-15; darma SV-81 D272,
    following darma's DA-14 D13): the actions it already has (More, the floating detail, ⌘K's This
    email, its keys), kept on screen with their key hints, plus Copy items, which exist nowhere
    else. More, ⌘K and the menu draw from one list of actions. On a link, a field, selected text, an
    email's body or with ⌥ held, the browser keeps its own menu; a right-click that closes a popover
    opens nothing; the phone has none. It moves the cursor to the row and never opens it, so it
    never reads an email.
    - **An email's row** (New, Attention, Pinned, the days, search, Alfred's sources): Open ↵, Done
      H (Attention not yet Done), Trash E, Pin or Unpin P, Mark read on an unread row (no key; as
      Mark all as read for one email: it stays where it is in New for the visit, the attention
      pill doesn't move, Undo and ⌘Z) or Mark unread ⇧U on a read one, Open in Gmail O, Add to
      calendar, Add as task, Ask about this email (on every row; each opens the email, whose
      reading pane holds its card), Copy sender address, and Copy code on a code row. **New**'s
      band: Mark all as read ⇧I. Nothing changes an email's lane or kind (brief decision 28).
    - **The reader:** an attachment, Preview and Download; the sender, Copy address; the code
      card, Copy.
    - **The sidebar:** Inbox, Mark all as read; an account, Mark all as read for it, and Reconnect
      while it needs sign-in. **The Today block's** lines: Edit E, Complete or Reopen, Delete, Open
      in Calendar.
    - **A calendar item** (grid and day pane) is selected (solid) without the floating detail, and
      a card open on another item goes away (as #17): an event, Edit E, Open link O (#245), Clone,
      Copy ⌘C, Colour, Delete; a task, Complete or Reopen, Edit, Clone, Copy, Delete. On an item in
      a selection, the selection's: Copy, Colour, Delete, Clear selection, leaving it selected. A
      failed item: Try again, Move back. Colour's choices hang at the same spot.
    - **Empty grid** (a day, a week's slot, the all-day row, a day head): New event here C, New
      task here D, Paste here ⌘V, each on the day clicked rather than the selected day, which it
      selects. The event starts at a week slot's 15-minute step, an hour long, or is all day from
      the all-day row; Paste keeps the copied times, as ⌘V does, and is unavailable with nothing
      copied.
    - **News:** a story, Open ↵, Open at its outlet O, Copy link; an Upcoming row, Add to calendar
      and Open the story; a source in the story pane, Open here, Open at the outlet, Copy link. No
      Mark seen (D87).
    - **No menu:** Settings, fields, search, ⌘K, toasts, Calendars rows, the mini-month, "+3" and
      the ghost rows. A Copy item says what it took in the toast (#40), or "Couldn't copy it"
      (#109). The menu is the reader's More (`.pop.menu`) with the palette's key hints.
    - **Settled while building** (small gaps, decided by the build): the menu opens down and right
      from the pointer, to its left or upward where it would run out of the window, 8 px inside
      it; its cursor starts on the first item, and an item's key (H, E, P, ⇧U, ⌘C) runs it from
      the menu; a scroll, the window resizing or losing focus closes it. Mark read says "Marked as
      read · Undo". An attachment that's only a Download link, an Alfred source whose email isn't
      in a list on screen, and a sidebar row with nothing to offer keep the browser's menu. The
      Today block lists only open tasks, so its lines offer Complete, never Reopen, and a repeating
      event's line no Delete, as its card. On Calendar a failed item offers only its card's Try
      again and Move back, a change on its way leaves Edit, Colour, Delete and Complete
      unavailable, and a selection offers Colour only when every one is an event that isn't
      recurring. Paste here takes the copy glyph, the set having no paste glyph. Board audit: no
      board draws a right-click menu and no approved screenshot changed, so it's unchanged; the
      menu's own is `right-click-an-email`.
249. **⌘ or Ctrl-click selects several emails, and the reading pane shows the selection** (Andy,
    2026-10-16; darma SV-82): what led to it was trashing a few emails in one go. In the Inbox's list
    and search's results:
    - **Selecting:** ⌘ or Ctrl-click adds a row or takes it out; the first one also takes the open
      email, whose reader gives way to the selection. ⇧-click selects every email from the last one
      clicked (or the open one) to this one. A plain click, or Enter, ends the selection and opens
      that email; Esc ends it, before anything else Esc does. Selecting never opens or reads an email.
      A selected row is drawn as the open one is (`sub3`, the 2 px `accent` bar). The phone has none.
    - **The pane** (option B, drawn in the chat): the reader's tools, **Done H** (when any can be),
      **Trash E**, **Pin P** (Unpin when every one is pinned), **Mark read** (Mark unread ⇧U when none
      is unread), then **Clear Esc** at the right; then "3 emails selected" where the subject goes, and
      each email in list order as its row reads (sender, then the summary or subject), with an × that
      takes it out; past eight, "and 4 more". A click on one opens it. A selection of one is still a
      selection ("1 email selected"). From 640 to 1099 px, where a pane covers the list, there's no
      pane: the rows show the selection, and the keys and right-click act on it.
    - **Right-click on a selected row:** the same, as a menu: Done H, Trash E, Pin or Unpin P, Mark read
      or Mark unread, Clear selection. Open, Open in Gmail, the cards and the Copy items are one email's
      only. A right-click on a row outside the selection gives that row's own menu and keeps the
      selection. ⌘K offers the selection's actions under its count.
    - **H, E, P and ⇧U act on the whole selection.** One toast for each: "Moved 3 to Trash · Undo",
      "Marked 3 Done · Undo", "Marked 3 as read · Undo", and ⌘Z undoes the whole of it. Done counts
      only the emails that can be Done ("Done 2" when two of three can). Trash and Done end the
      selection; Pin and the read changes keep it.
    - **No batch endpoint:** each email's change is its own command, as it is for one email; they go
      out together, and the lists' answers wait until the last is in, so none comes back for a moment.
      Board audit: no board draws a selection and no approved screenshot changed, so it's unchanged; the
      selection's own is `selected-emails`.
250. **Settings › Security pairs an iPhone and lists the paired ones** (Andy, 2026-10-16; darma SV-84
    D276): the native iPhone app (D275) reaches Setpoint only over a private network, where passkeys
    can't work, so a signed-in browser pairs it. Security isn't drawn; this follows its row pattern.
    - **The group:** "iPhones", after Passkeys, with **+ Add iPhone** on its label as Add passkey has.
      Each paired iPhone is a row: the name the app sent (its model, "iPhone 17 Pro"; "iPhone" if
      none), "Paired 9:12 AM · last used 9:41 AM", and **Revoke**. Empty, it's the one-line empty
      state, "None yet · Add iPhone" after a 20 px `smartphone` in `ink3` (#135).
    - **Add iPhone opens a panel inside the group**, not a sheet, as Add passkey's form does: a 132 px
      QR on its tile (dark modules on the theme's lightest surface, `ink` in Night and `cardOn` in
      Light, so it scans in either), "Scan with Setpoint on your iPhone", the `setpoint://pair?…` link
      in mono with **Copy** (the Simulator opens it with `xcrun simctl openurl`), and "Works once ·
      Expires in 5 min", the code's countdown in a verification code's words and `caution` through its
      last minute; then **Cancel**, or Esc. Expired, it says so with **New code**. Add iPhone rests
      while the panel shows. Once the phone pairs, the panel closes by itself, its row is there and the
      line under the page says "Paired iPhone 17 Pro". Cancel, or leaving the page, withdraws the code.
    - **Add iPhone needs the password confirmed in the last 10 minutes**, as every change here does;
      **Revoke doesn't**, since it only takes access away, and nothing here ends a session.
    Board audit: no board draws Security and no approved screenshot with a board changed, so it's
    unchanged; the panel's own is `settings-security-iphones`.
251. **An edited item's Title reads what the edit types, as a new item's line does** (Andy,
    2026-10-17, the details left to Claude; darma SV-90 D279, D280): the Title on Edit is the same
    marked line, with its menus, and reads only what the edit typed, so the words the title already
    had stay its title. "Work" 3:00 – 8:00 AM, typed "Work at 3:45a", is Work at 3:45 – 8:45 AM: a
    time keeps the day and length, a day keeps the time, a range sets both ends, and an all-day
    event given a time ends an hour later on its last day, as Add a time does. A task's time is its
    due time. "@place", "#calendar" (the event's own account's), a task's "#project" (Todoist's
    only) and a repeat (counted from the item's day) apply too; a recurring event still asks This
    event, This and following or All events. With no phrase typed, the title is as typed and
    nothing else changes; phrases that leave no words keep the title. Board audit: board 14 draws the
    edit's Title with no phrase in it; it reads as before, its text a pixel higher, where board 13's
    line sets it (14 0.45%).
252. **New FYI mail can notify too, on its own switch** (Andy, 2026-10-18, the row left to Claude;
    darma SV-96): Settings › Notifications' ntfy group gets **FYI mail** after `setpoint-mail`'s row,
    titled in words rather than mono since it's a lane, not a topic, with just a switch, off by
    default as Attention mail is. It has no second line: right under `setpoint-mail` it reads as that
    topic's second switch, and a whole-pixel row keeps the sticky labels below it on whole pixels,
    where a fractional one put Reminder defaults' a pixel lower under the stress run.
    Each email triage sorts into Attention or FYI as it arrives sends one notification: its sender
    as the title, its subject as the message, opening the email. Noise, history, and mail already
    read, Done, trashed or archived, or that waited over an hour for triage, send nothing. Board
    audit: board 18b doesn't draw the row, so the groups under it sit 52 px lower than drawn (18b
    2.16%); no other screenshot changed.
253. **Under 80 px a day, the week's day heads stand the weekday over the date** (Claude,
    2026-10-18, a small gap left to Claude; darma SV-99 D282): at 1100 wide, the narrowest width that
    keeps the full sidebar and the right pane, the week's columns are about 57 px (under Week view's
    "down to about 90"), and the head's weekday, gap and 24 px date need about 81, so the date was
    cut. Below 560 px for the seven heads, each stacks its weekday over its date, 1 px apart with
    6 px at the sides, inside the 48 px head; the weather is already gone under 96. At the design
    target and in the compact tier nothing changes. Board audit: no board draws the week at 1100.
254. **An HTML email has room around it in the reader** (Andy, 2026-10-20, the amount left to Claude;
    darma SV-107 D285): the email's frame sits on a white card of radius 14 that keeps it 16 px from
    the card's top and bottom and up to 20 px from its sides, so a bare email's words no longer run
    into the edge. The sides give way so the frame keeps 600 px, the width most emails are built
    at, rather than zooming them down: 11.5 px a side in the design target's 623 px pane, 20 from a
    640 px pane up. The room is the card's, outside the email's page, so an email's own
    `body { padding: 0 }` can't take it away, and the page, its measuring script and the iPhone app's
    body page don't change. Night's dim and Light's ring move from the frame to the card. The phone
    keeps the frame at the screen's width with no room (D275). Board audit: boards that draw an
    HTML email show it 11.5 px further in.
255. **A reminder can go off at any moment picked, before or after the start, through Custom…**
    (the user, 2026-10-26; darma SV-109 D287, D288, D289): Add reminder's menu keeps its presets
    (At the start, 5, 10, 15 and 30 min, 1 and 2 hours, 1 day before) and gains **Custom…** last, opening a
    date and a time under the row, with Add and an ×; the line under them says how far that is from
    the item's moment ("2 hrs after"). The moment is kept as minutes from the item's, negative after
    it (D287), so it moves with the item; past 4 weeks either side it's refused, Add off and the line
    in `alert` saying why. A reminder whose offset is a preset's keeps its words ("10 min before");
    any other reads as the moment it goes off, "Sun, Oct 25, 8:00 PM", with "1 day 18 hrs before" or
    "2 hrs after" in `ink3` beside it, in the editor's chip and on the floating detail (and the
    phone's), where the presets share one line and each other one has its own. A click on a custom
    chip reopens the picker at its moment, with Done. Tasks get the same row: a timed one counts
    from its due time, a dated one without a time from Settings' task time on its day, or 9:00 AM at
    None (D288), Custom… saying "Counts from 9:00 AM"; a task with no date has no Custom… and says
    "Reminders need a date". An all-day event still counts from its midnight. Google is written only
    the before-reminders, and a sync from Google keeps the after-ones; Todoist never holds a task's.
    Board audit: no board draws Custom… or a custom reminder.
256. **The line reads an event's length and its span of days** (the user, 2026-10-26; darma SV-111,
    D291, D292). A length is read only after "for", in digits, decimals and compounds included
    ("for 15 min", "for 1.5h", "for 1 hour 20mins", "for 1h30"), in min, mins, minute(s), h, hr(s),
    hour(s), d, day(s) and week(s); no number words and no "wk" (D291). A bare length stays words
    ("30 min run"). It sets End that long after the start, past midnight if it gets there, lit with
    the when; with no time typed ("Lunch fri for 1h") it starts at the default start, the slot's
    else 9:00 AM, and an edited event at its own start. The first of a length or an end wins ("2–3pm
    for 2h" and "2pm no end for 1h" keep "for …" as words; "for 1h 2-3pm" keeps the range as words).
    A span of days takes the Date field's forms: "oct 23–25", "oct 23 to 25", "oct 30 – nov 2", "fri
    to sun", "fri through sun", "from fri to sun", the last day read from the first ("fri to mon"
    runs into next week, "dec 30 – jan 2" into next year). One that runs backwards ("oct 25–23",
    "oct 25 – oct 23", "fri 7pm to fri 3pm") stays words, its first day too. With no time it's all
    day over those days, both counting; with a time at each end ("fri 7pm to sun 3pm") one event
    across them; with one time, a range or a length ("oct 23–25 9am–5pm") that each day, a daily
    repeat until the last day (`FREQ=DAILY;UNTIL=20261025`, a repeat typed with it taking the
    UNTIL instead), Repeat saying "Daily, until Sun, Oct 25" (D292). A task's line keeps lengths and
    spans as words. The iPhone app gets the same through the compose bundle's `days` and `length`.
    Board audit: no board draws a length or a span typed in the line.
257. **A new item is one line, and a click on a lit phrase makes it words again** (the user,
    2026-10-26; darma SV-110 D290, retiring #58 and UX #8's Title rule): the new item's Title field
    goes, so a new item is its line alone, as an edited one is (#251) and as the iPhone's is; its
    title is the words the line leaves unlit. A click on a lit phrase in the focused line (the click
    that focuses the line only focuses it, so a click to start typing changes nothing), or ⌥⌫ with
    the caret inside one, turns it into title words and drops what it set ("Lunch with May 12", May
    12 clicked, is titled with it and stays on its day); it stays words while the line goes on,
    until it's typed into again, as the iPhone's tap does. Over a lit phrase the focused line's
    tooltip says "Click to keep as words" and the phrase deepens. ⌥⌫ at a phrase's edge deletes a
    word, as ever. An email's proposal puts its title in the line as words only, none of them read,
    and its "From the email" mark sits at the line's trailing edge, the text stopping before it. E
    selects the line's title words only, its first run of them, so typing renames the item and keeps
    "fri 7pm @Blue Door"; with no title words, the caret goes to the line's start. Board audit:
    board 13 draws the Title field under the line, so the rows below sit 42 px higher than drawn.
258. **The line sets reminders** (the user, 2026-10-26; darma SV-112, D293). A phrase starts with
    **remind**, **remind me** or **reminder**, no other words, then an offset ("1h before", "30 mins
    before", "2 hours after", "at start") in D291's units, or a moment ("sun 8pm", "tomorrow 9am",
    "at 6pm" on the item's own day); several join with "and" or commas ("remind 1 day and 10 mins
    before"). It's read before the day and time, so "sun 8pm" there isn't the item's day. Its mark
    is `remind`'s tint (a rose of its own, Night `oklch(0.8 0.11 345)`, Light `oklch(0.55 0.14
    345)`), not the when's, as it doesn't move the item, and the Reminders row's glyph takes it. A
    moment is kept as its offset from the item's moment (D287), counted from the item as the line
    leaves it. On a new item the line's reminders replace Settings' default; one ticked in the
    editor sits beside them, and taking the phrase out takes out only what it set (taking one of its
    chips out sets the reminders by hand, as the row then shows them; a click on the phrase keeps it
    as words and drops them, #257). On an edited item a phrase typed adds to its reminders. A phrase
    past 4 weeks either side, past 10 with the item's others, or on a task with no date stays words,
    as do "remind" alone, "reminder email", "remind 1 wk before" and "remind" with a day and no time
    ("remind sun"). The iPhone app gets the same through the compose bundle's `reminders`. Board
    audit: no board draws a reminder typed in the line.
259. **The line reads days counted from today, and when a repeat ends** (the user, 2026-10-26;
    darma SV-113, D294, D298, D301). Days, wherever a day is read (the line, a span's ends, the Date
    field, "until", a reminder's moment): "in 3 days", "in 2 weeks", "in 1 month" (the same date,
    or that month's last day when it's shorter); "next week", its Monday; "this weekend" or
    "weekend", the coming Saturday (today on a Saturday), "next weekend" the one after; "end of
    week", the coming Friday (next week's at the weekend); "end of month", "eom" and "end of next
    month", the month's last day. An event's weekend with no time is all day Saturday–Sunday, with
    a time Saturday at it; a task's is due Saturday. A length in whole days or weeks with no time is
    all day over them ("Trip fri for 3 days" is Fri–Sun, D298); "for 1.5 days" or with a time stays
    timed (#256). After a repeat, and only then (before one, they stay words): "until <day>", any
    of the days above, ends it on that day (`UNTIL=20261215`); "6 times" or "for 6 times" after
    that many (`COUNT=6`); "for 2 weeks" (days, weeks, months) lasts that long from the first
    occurrence, its last day the one before the first plus 2 weeks, so "Gym every day for 2 weeks"
    is 14 mornings at the default start, not one event two weeks long (D301). Repeat says the end:
    "Weekly on Monday, until Tue, Dec 15", "Daily, 6 times", "…, once". A second end, or a last day
    before the first, stays words. A task's end goes to Todoist as "every mon until 2026-12-15",
    written `every mon at 09:00 from 2026-10-12 until 2026-12-15` as Todoist documents it ("everyday
    from 10 May until 20 May"), and its Repeat says "Every Monday, until Tue, Dec 15"; Todoist
    documents no count, so "6 times" stays words in a task's line. The iPhone app gets the same
    through the compose bundle. Board audit: no board draws a relative day or a repeat's end typed
    in the line.
260. **What the line reads, from a ? at the line's end** (the user, 2026-10-26; darma SV-114, D295).
    The phrases should need no learning; this is the backup. A small `?` (24 px, `ink3`, `sub2`
    behind it on hover, focus or while open) sits 8 px in from the line's trailing edge, the text
    stopping 8 px before it, and an email's "From the email" mark (#257) sits before it. It's a tab
    stop after the line. It opens a popover under it, its right edge on the line's, as wide as the
    line (360 px, the phone's width less 40 px), up to 440 px tall and scrolling inside: "What the
    line reads", then a section per kind of phrase, each row an example, an arrow and what it reads
    in the editor's own words, lined up down the section: Days ("Lunch fri → Fri, Oct 9", "Review
    in 3 days → Sat, Oct 10"), Times ("Call 2-3pm → 2:00 – 3:00 PM", "Call 2pm no end → 2:00 PM, No
    end"), Lengths and spans ("Standup 9am for 15 mins → 9:00 – 9:15 AM", "Trip fri to sun → Fri,
    Oct 9 – Sun, Oct 11, all day"), Repeats ("Gym every mon → Mon, Oct 12 · Weekly on Monday", "Gym
    daily until fri → Daily, until Fri, Oct 9"), Reminders ("Call mom remind me 1h before → a reminder 1 hour before"), Places,
    calendars and projects ("Coffee @Blue Door → at Blue Door", "Lecture #classes → the Classes
    calendar", "Pay rent #home → the Home project") and Keeping a phrase as words, under "Click a
    lit phrase, or press ⌥⌫ inside it, and it stays words." ("Lunch with May 12 fri", May 12
    underlined dotted, → "“Lunch with May 12” · Fri, Oct 9"). Opened, it takes focus; Esc closes
    it and not the editor, focus going back to the `?`, and a press outside it, the `?` again or
    focus leaving it closes it too. Its words live in `shared/compose/reference.json`, beside the
    parse table, so the iPhone shows the same ones from its ⓘ (SI-52); every example is run through
    the parser on the seed's Wed, Oct 7, and a row that doesn't read what it says fails `npm test`.
    The placeholders stay as they are. Board audit: board 13 draws no `?` on the line.
261. **The 900 ms settle from `sub2` marks what reaches a list without the user doing it just now**
    (Andy left small gaps to Claude, 2026-10-29; darma SV-123, D361): #131 kept it "only for
    arrivals"; Jobs widens it, as its table and board 38a ask, to an application that lands (a
    confirmation, Track this, the history pass) and to one an email moves on (Applied → In process).
    The moved row's status cell fades its new words in over the second 120 ms of its crossfade, the
    old ones gone at once, since the row keeps no copy of its old status. It reuses
    `news.landedMs`. Board audit: 38a draws the moment, not the motion.
262. **Jobs's table and header lay out by their own width** (Andy left small gaps to Claude,
    2026-10-29; darma SV-123, D359): a table under 1100 px wide takes the beside-the-detail columns
    (Platform dropped, JD a glyph), as board 32 draws them, whether the detail or the window narrows
    it; under 600 px (the detail open at 1100) company, role and status share the room. The header
    gives way by its width: the search field to 180, then Per week's label, then, under 892 px, the
    field is its glass alone until `/` or a click opens Search, and Per week keeps its bars and count
    without "this week". Per week's tip sits under the chart. Below about 800 px wide the two numbers
    can't both fit; nothing narrower gives way yet. Board audit: 32b stops at 1024.
263. **Jobs before J6** (Andy left small gaps to Claude, 2026-10-29; darma SV-123, D357, D358, D360):
    Needs you's actions and the detail's status chip are drawn as the boards draw them but inert
    (no pointer, no focus) until J6 wires them; a candidate's arrow already opens its posting. More,
    the title's pencil and each event's ··· aren't drawn until J6 brings their menus. A role-less
    application reads "No role named" in `ink3`, its tab the company alone. A JD without a posting
    says where it stands under "Job description": No JD found (38b), "Is this the posting? · 2
    candidates in Needs you", or "Not looked up", the last two with Look it up where it can run.
    Search with no match anywhere is one line, "No application matches “x”". Board audit: the boards
    draw the buttons live and More, the pencil and the ··· on hover.
264. **In process is cobalt** (Andy, 2026-10-29; darma SV-123, D362): its mark, its label and an In
    process event's node take `inProcess`, a cobalt of its own (Night `oklch(0.7 0.15 258)`, Light
    `oklch(0.52 0.16 258)`), picked from a mock beside `accent`, periwinkle, teal and violet. It is
    deeper than `accent`, so an open In process row's bar and its mark never read as one. The other
    statuses keep D309's colours. Board audit: the boards draw In process in `ink`.
265. **Rejected and Ghosted take colour, and no dot follows "Full posting"** (Andy, 2026-10-29;
    darma SV-123, D363): Rejected's disc is `alert` and Ghosted's dashed ring `sunGlyph` (Night
    `sun`, Light the deeper amber); their labels stay `ink3` and their rows still step down, so a
    table of mostly closed rows doesn't shout. The Full posting row, its unfolded head and the
    Looking for the posting row put how it was found straight after the title, 10 px apart, with no
    "·"; the search snippet's "Full posting · " keeps it, as it introduces a quote. Board audit:
    the boards draw both marks in `ink3` and the dot after "Full posting".
266. **From history's Choose… is a menu** (Andy, 2026-10-29; darma SV-124, D364): the candidates
    open from the button, as Assign to…'s applications do, so history's rows keep one height; a pick
    folds the row as an answered Needs you item does. Board audit: no board draws it.
267. **Set status, and Let emails decide** (Andy, 2026-10-29; darma SV-124, D365): the chip's menu
    and More's submenu list the five statuses in their colours, Ghosted not among them. A status set
    by hand otherwise holds until an email sets one, so the menu offers **Let emails decide** while
    it's set by hand, handing the status back without waiting for an email. Board audit: no board
    draws it.
268. **A Jobs row's right-click** (Andy, 2026-10-29; darma SV-124, D366): #248's rule on the table,
    Open, Open posting, More's list and two Copy items; a timeline event's is its ··· menu. Board
    audit: no board draws it.
269. **An event whose email is gone says "No longer in Gmail"** (Andy, 2026-10-29; darma SV-124,
    D367): on its line, so it doesn't look like a click that failed, with a tip saying why. "No
    longer in" rather than "Deleted", as Trash expiry and retention also take mail. Board audit: no
    board draws it.
270. **J6's small gaps** (Andy left small gaps to Claude, 2026-10-30; darma SV-124, D368–D371): the
    toasts and answered items' outcome lines where no board words them ("Assigned to Software Engineer
    II (Java)", "Status left to the emails", "Hidden Trey Research", "Back in Needs you"; `delete` for
    Not about a job as for the three override 36 names); Another application… and Merge with…
    searching every application by company or role, the company's own then six Recent before a word
    is typed; Look up the JD again disabled while a JD is saved; Track this on an offer starting at
    Offer; Not about this's item saying "taken off the application it was on"; the company edited in
    its own line; a click-opened menu's cursor on its first item, a submenu under the resting pointer;
    an event's right-click opening its ··· where it sits. Board audit: 34a draws the picked group,
    which shows here only for the press before 34b's outcome replaces it.
271. **The JD popover's Full posting opens it in Jobs** (Andy, 2026-10-29; darma SV-125, D372): the
    application arrives open, scrolled to its full posting and unfolded, as Open in Jobs arrives at
    the top; the popover stays a quick look, and the long read happens where the detail is built for
    it. Board audit: 37b draws the button without saying where it goes.
272. **J7's small gaps** (Andy left small gaps to Claude, 2026-10-30; darma SV-125, D373–D376): a
    job-match email is one Jobs read as a job board's match, and one that also belongs to an
    application shows the JD chip in the reader and Applied before on its row; the chip and the badge
    word the status as the table's step does ("· In process" with no date, "· Ghosted", Applied alone
    "Applied Sep 16"), a role-less application's chip its company; the badge's search the words its
    applications' companies share; the popover without a JD in the detail's words (No JD found,
    Looking for the posting…, Is this the posting?, Not looked up) with Open in Jobs alone, and as wide
    as the reader leaves room for; Applied before on the Inbox's rows and the reader, not mail
    search's results; any application open as Jobs mounts arriving without a slide, Full posting's
    unfolded with no motion, a search's query in the field without focus, and the address dropping
    what it carried. Board audit: 37a–37c draw only In process and Rejected, and a 460 px popover.
273. **Settings › Jobs › Reads is a select on each account, as 39a draws** (Andy, 2026-10-29; darma
    SV-126, D383, superseding D377's plain values): Every email, Career mail only or Off, sending the
    accounts Jobs reads through `PATCH /api/jobs/settings`; while Jobs is on, a change starts the
    history pass over what the new list hasn't had read. Plain values left a fresh install, and prod
    after a release, reading nothing once Jobs was turned on, since no accounts are listed by
    default; D310 has the accounts set here.
274. **J8's small gaps** (Andy left small gaps to Claude, 2026-10-30; darma SV-126, D378–D382):
    - **The AI down's line** words why it's down: "Anthropic unreachable since 8:52 AM, retrying", "rate
      limited since…", "refused its key in Settings › AI" or "Jobs needs an Anthropic key in Settings ›
      AI", the last two linking there and not retrying. It counts what waits for the reader and what a
      held history pass has left, or is the reason alone with nothing to count. The pass's line stays
      under it while held, and both step aside while a search holds a query.
    - **Jobs off:** `4` opens it, while ⌘K's Go to lists Jobs only while it's on, as the sidebar does;
      `/` and J / K do nothing there. Turned on, the sidebar's item folds in whenever it appears after
      being off; turned off, it goes at once.
    - **Settings › Jobs:**
      - Reads lists the accounts Jobs reads first, as it lists them, then the rest in the sidebar's order.
      - The History pass row while it runs reads "Reading history · 140 of 330 emails" with the spinner
        and "Reading", its progress along the row's foot. Held, it reads `history` "Waiting for the AI";
        before it has run, "Runs once when Jobs is turned on, over the mail from before then".
      - From history with none waiting says so, without Show. Show opens Jobs at /jobs/from-history,
        From history unfolded and in view.
    - **Settings › AI's Jobs group** shows on or off. Without an Anthropic key each model's line ends "·
      needs a key", as News's do. Usage this month's total waits for Jobs's answer too.
    - **Matching the board and the text:** a JD to confirm's candidates have a hairline between them,
      as 32 and 34a draw, and From history's fold reads "wasn't" as written here.
    - **Board audit:**
      - Board 32 is set beside its page screenshot (`32-jobs-a-typical-morning`), with the seed's rows
        to the fold and #264, #265, #269 and override 35 patched in. The other Jobs boards are drawn
        alone.
      - 38a draws a history pass the seed doesn't run (no Needs you, From history 2); jobsStates.spec.ts
        holds it.
      - 38c draws the sidebar's item while off (States says it has none).
      - 39a and 39b draw News in Settings' nav without its warning (the seed's FOX 11 fails), and 39b
        draws the Anthropic key set.
275. **A rejection under another name of the employer waits to be assigned** (Andy, 2026-10-30; darma
    SV-128, D384): a rejection whose company matches nothing but whose role an open application has
    is an update to assign, line two "A rejection · the same role as an application under another
    name". It never moves a status on a title alone. One matching no open role stays ignored.
276. **A picked posting Jobs can't read says so** (Andy, 2026-10-30; darma SV-132): the card reads
    "Couldn't read the posting you picked · glassdoor.com gave Jobs no text on Oct 1", the row
    "Couldn't read", and the pick stays the application's link, so Open posting, `O` and the row's
    menu open it. A 403, a page drawn by script and a posting that's gone all read the same: Jobs
    can't tell them apart, and the link shows which. Look it up forgets the pick and searches again.
277. **A long fact wraps** (Andy, 2026-10-30; darma SV-129): a salary or location too long for the
    line wraps inside its box, in the detail and in the JD popover, its glyph level with the first
    line, and the short facts stay on one line each. Jobs keeps 240 characters of a salary and 200
    of a location. The source facts over the unfolded posting stay on one line, the link cut by its
    ellipsis.
