# Setpoint design

The design rules that hold across every page: principles, vocabulary, tokens, motion, glyphs and
copy. They are small and global on purpose. How a page behaves lives in its tests, not here.

## How to use this file

- **Values:** [`design-export/styles/setpoint.css`](design-export/styles/setpoint.css) is the source
  of truth for tokens and component values, and `design-export/tokens/setpoint-tokens.json` is the
  same data parsed. The build defines tokens once in `web/src/tokens.ts`, mirroring that file and
  the tables below; a unit test compares them.
- **Behaviour:** the tests own it. Timing constants here are read by the tests from the token module.
- **Boards:** `design-export/` is the original visual reference. Where it and the app differ, the
  app and its tests win.
- **Icons:** `design-export/glyphs/icons.json`, Material Symbols Rounded at weight 300 as SVG paths
  (`viewBox="0 -960 960 960"`), bundled. Never the icon font at runtime.
- **Changing it:** deliberately, in this file first, with the owner's agreement.

## Principles

- **Mail and time, then News and Jobs.** A feature that is about glancing belongs to mantel.
- **Providers are the truth.** Read state, events and tasks are Gmail's, iCloud's, Google
  Calendar's and Todoist's; Setpoint mirrors them and sends commands. A draft is the one exception:
  it lives in Setpoint until it is sent, and the provider only ever gets the sent email.
- **The AI sorts and pre-fills; it never adds to a list the user trusts.**
- **Fail visibly.** Unsorted mail stays in view; a failed change stays in place with the provider's
  words; a stale source says "as of".
- **Desktop first, Linear-fast.** Design target **1677 × 1050** (the MacBook in Arc with its sidebar
  open), holding at 1728 × 1117; from 1440 px wide the whole UI is zoomed 1.075× (13 px text reads
  ~14 on a MacBook), from 2200 px 1.25×.
  Every common action has a key and opens without delay.
- **No focus rings, no accessibility work.** No focus rings or browser
  outlines anywhere, modals and popovers included; the keyboard cursor is a fill (`sub2`). Keyboard
  navigation, focus handling and restoration stay. Night and Light only; no reduced-transparency or
  contrast overrides, and one reduced-motion one: a segmented control's thumb jumps.
- **Minimal supporting text.** Only what helps the user decide or recover.

## Vocabulary

Inbox, All, lane (Attention, FYI, Noise), kind, Done, Unsorted, Protected, item, floating detail,
proposal, Alfred, source, and in News story, section and recap. The **kinds** are Deliveries, Money,
Career, Security, Updates, People and Other (Career and People, not Work and Personal, which are
account names). The UI says "Done", never "handled".

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
| `ink` / `ink2` / `ink3` | `#ecebe7` / `#a3a4a8` / `#8b8d92` | `#1d1e21` / `#4b4d52` / `#606267` | primary / secondary / tertiary text and icons |
| `onInk` | `#050506` | `#ffffff` | text on `ink`, on the unread badge, the phone's attention pill and solid calendar chips |
| `edge` / `edgeOn` / `edgeHover` | `rgba(255,255,255,.055)` / `.12` / `.14` | `rgba(29,30,33,.1)` / `.17` / `.22` | borders / overlays, focus / under the pointer |
| `hair` | `rgba(255,255,255,.07)` | `rgba(29,30,33,.08)` | dividers, row lines, grid lines |
| `sub` / `sub2` / `sub3` / `sub4` | `rgba(255,255,255,.055)` / `.09` / `.13` / `.17` | `rgba(29,30,33,.04)` / `.07` / `.11` / `.15` | hover / keyboard cursor, open row, selection / tracks, segmented "on", a press / a ghost button pressed |
| `stripe` | `rgba(255,255,255,.045)` | `rgba(29,30,33,.05)` | hatching (drag ghosts, hidden images) |
| `scrim` | `rgba(0,0,0,.72)` | `rgba(20,26,32,.35)` | behind Settings and ⌘K |
| `caution` | `oklch(0.75 0.16 40)` | `oklch(0.535 0.16 40)` | Attention's count, the phone's attention pill, needs-reconnect bar, failing lines |
| `alert` | `oklch(0.72 0.17 25)` | `oklch(0.535 0.185 25)` | protected mail, failed changes, offline pill, destructive actions, now-line, Jobs's Rejected mark |
| `warm` | `oklch(0.8 0.11 55)` | `oklch(0.54 0.12 55)` | Business |
| `cool` | `oklch(0.8 0.11 235)` | `oklch(0.54 0.12 235)` | Personal (account and calendar), rain |
| `accent` | `oklch(0.8 0.11 235)` | `oklch(0.54 0.12 235)` | "you are here": the open email's bar, the current page's icon, today's month boundary, a date range, selected search chips, News's updates |
| `comf` | `oklch(0.8 0.11 165)` | `oklch(0.54 0.1 165)` | Work |
| `good` | `oklch(0.8 0.13 150)` | `oklch(0.53 0.13 150)` | done or healthy: the done glyph, the reader's Done check |
| `sun` | `oklch(0.86 0.16 92)` | `oklch(0.63 0.125 92)` | sun, Night's search highlight (26% mix) |
| `violet` | `oklch(0.8 0.11 300)` | `oklch(0.54 0.14 300)` | Jobs (account and calendar) |
| `cyan` | `oklch(0.86 0.11 182)` | `oklch(0.58 0.1 182)` | Classes |
| `onAlert` | `#1a0806` | `#ffffff` | text on `alert` |
| `sunGlyph` | `var(--sun)` | `oklch(0.58 0.14 78)` | the forecast's sun on the grids and the right pane, Jobs's Ghosted ring |
| `switchOn` / `switchKnobOn` | `color-mix(in oklch, var(--good) 58%, var(--modal))` / `var(--ink)` | `var(--good)` / `var(--onInk)` | a switch that's on: its track / its knob |
| `hl` | `color-mix(in oklch, var(--sun) 26%, transparent)` | `oklch(0.92 0.12 96)` | search's match highlight |
| `edgeFocus` | `rgba(255,255,255,.2)` | `rgba(29,30,33,.3)` | a focused field's border |
| `mailEdge` | `transparent` | `rgba(29,30,33,.1)` | the HTML email frame's ring |
| `navOn` / `navOnEdge` | `rgba(255,255,255,.10)` / `rgba(255,255,255,.07)` | `#ffffff` / `rgba(29,30,33,.10)` | the current page in a nav: its fill / its inset hairline |
| `dayOff` / `dayOut` | `rgba(255,255,255,.02)` / `.035` | `rgba(29,30,33,.028)` / `.048` | the calendar's weekends / days outside the shown month |
| `remind` | `oklch(0.8 0.11 345)` | `oklch(0.55 0.14 345)` | the editor's line: a reminder phrase's mark, and the Reminders row's glyph it filled |
| `inProcess` | `oklch(0.7 0.15 258)` | `oklch(0.5 0.16 258)` | Jobs's In process: its mark, its label and its events' node |
| `kindDeliveries` | `oklch(0.78 0.12 70)` | `oklch(0.55 0.13 70)` | the Deliveries kind's glyph in the Inbox |
| `kindMoney` | `oklch(0.78 0.12 140)` | `oklch(0.55 0.13 140)` | the Money kind's glyph in the Inbox |
| `kindUpdates` | `oklch(0.78 0.12 190)` | `oklch(0.55 0.13 190)` | the Updates kind's glyph in the Inbox |
| `kindSecurity` | `oklch(0.78 0.12 250)` | `oklch(0.55 0.13 250)` | the Security kind's glyph in the Inbox |
| `kindCareer` | `oklch(0.78 0.12 300)` | `oklch(0.55 0.13 300)` | the Career kind's glyph in the Inbox |
| `kindPeople` | `oklch(0.78 0.12 345)` | `oklch(0.55 0.13 345)` | the People kind's glyph in the Inbox |
| `kindOther` | `oklch(0.74 0.05 65)` | `oklch(0.55 0.06 65)` | the Other kind's glyph in the Inbox, a muted taupe |
| `kindNoise` | `oklch(0.74 0.05 250)` | `oklch(0.55 0.06 250)` | the glyph on each day's folded Noise line, a muted slate |

- **Roles**: each colour has one job, so a screen has two or three anchors. **`accent`**
  says "you are here" (named for its job, with `cool`'s values, so recolouring Personal never moves
  it). **`good`** says done or healthy. **`caution`** says "needs you": the attention pill and count,
  Attention's band and dots, and health warnings, nothing else. **`alert`** says danger and now: protected
  mail, failed changes, destructive actions, offline, the now-line, today's disc and a row's "Draft".
  **`ink`** is the primary action (New, sign-in, OK: solid ink pills). The identity swatches show only as dots, chip
  tints and bars, never as control fills, and the AI has no hue of its own.
- **Accounts** (`--a-*`): Business `warm`, Personal `cool`, Work `comf`, Jobs `violet`, iCloud `ink2`.
  **Calendars** (`--c-*`): Personal `cool`, Classes `cyan`, Jobs `violet`. Both pick from nine of
  the 11 swatches in Settings, not `caution` or `alert`; one picked before still shows.
- **Mixes** of a hue are `color-mix(in oklch, <colour> N%, transparent)` unless a base is named: tags
  (`alert` 10% on `chip` with a 40% edge; `caution` 12% with a 35% edge), the needs-reconnect bar
  (`caution` 9% on `page`, 22% bottom edge), calendar tint `--evtint` (Night 16%, Light 14%),
  deepening under the pointer by `--evhover` (Night 18%, Light 14%) laid over it in the chip's own
  colour, and by 28% while pressed; as a change lands it starts at `--evland` (Night 34%, Light
  26%) and settles back; Attention's band (`caution` 8% on `panel` in srgb, Light
  6%). A neutral (an ink or a surface) mixes in `srgb` or is an alpha token, never in oklch, which
  tints it.
- **Theme numbers:** on the calendar, coloured text on its own tint caps its lightness at `--tintL`
  (Night 1, Light .43), keeping its hue and chroma; the email frame's brightness `--mailDim`
  (Night .95, Light 1); Todoist's colours clamp their lightness to `--ringMin`–`--ringMax`
  (Night .72–1, Light 0–.55), keeping Todoist's hue and chroma.
- **Shadows:** popovers and the floating detail `0 18px 50px rgba(0,0,0,.4)` (Light
  `rgba(15,20,28,.14)`); modals `0 30px 80px rgba(0,0,0,.35)` (Light `.18`); pills and toasts
  `0 10px 30px rgba(0,0,0,.3)` (Light `.14`). Shadows only on overlays.
- **Scrollbars:** thin and dark (Light thumb `rgba(29,30,33,.22)`).

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
| Segmented control, reader tools, small buttons, summaries in Attention, the sidebar's rows under Inbox | 12.5 |
| Ages, counts, account labels, calendar chips | 12 (chips 500) |
| Group headers, section labels, weekday names | 11.5 / uppercase / .08em |
| Keyboard hints | 11 / 500 |
| Verification codes | Geist Mono 13 / 500 / .06em |
| The reader's code card | Geist Mono 22 / 500 / .12em |

On the phone the list reads a step up, as the reader's body (15) does: rows 15; ages, counts and
account labels 13; summaries in Attention 13.5; group headers 12; search's rows the same
().

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

Timings: **120 ms** hover and fills, **180 ms** popovers and panes, **260 ms** modals, all
`cubic-bezier(.2,0,0,1)`. The floating detail has its own motion. A lifted
calendar chip tilts −1.5° and scales 1.04. A theme switch has no motion of its own: what has a colour
transition takes it, the rest lands at once. A segmented control's thumb travels to the segment turned on, about 125 ms on a slight spring. A
press goes in over **80 ms** and lets go over 120 ms. The stories `N` brings onto News's list
settle in from `sub2` over 900 ms: the longer motions are kept for arrivals, as are a
calendar change's landing (420 ms) and an editor field another's change moved (600 ms).

Overlays arrive on these timings: every
menu and popover grows from its anchor's corner (4 px and .97, 180 ms), the "+N" popover from its
"+N", and a card anchored to a calendar item opens as the floating detail does; ⌘K rises 6 px over
180 ms and Settings 8 px over 260 ms, their scrims fading in; a pane's content over a narrow
window's list (on a desktop the pane is always there), and the editor however it's opened,
slides in 12 px over 180 ms; Alfred's Answer card and a proposal slide down 6 px, and
fold away when closed. ⌘K, Settings, the "+N" popover and menus close at once.

**Loading**: a page whose data is on its
way draws its rows' skeleton in their shapes, bars in `sub2` (`sub3` inside a `sub` group). It
appears only after 200 ms, so a quick answer never shows one, fades in over 180 ms, then breathes,
every bar in phase: opacity 1 → .45 → 1 over 1600 ms `cubic-bezier(.4,0,.6,1)`, a loop for loading
only, as the spinner's 900 ms turn is. What replaces it fades in over 120 ms. Skeletons don't shimmer.

## Glyphs, icons and the mark

- **Icons:** Material Symbols Rounded, weight 300, FILL 0 (the `-fill` files are FILL 1 uses), as SVG
  masks from `glyphs/icons.json`. One size per role: 18 in the sidebar, rows, the reader's and
  the story pane's tools and 30 px icon buttons; 17 beside a label in a button (Add, More options,
  the reader's actions) and in facts; 16 in small buttons, menus, inline links and the sidebar's rows
  under Inbox; 14 in chips and
  tags. A card's or popover's ×, and Add, in a 26 px icon button are 16; × is 18 only in a 30 px
  header button (Settings', the editor's) and a Settings row's "…". One glyph per meaning: account trouble `sync_problem` (Settings › Accounts and its rows, the
  Inbox's bar), a failing News feed `warning`, Try again and Retry now `refresh`, Mark all as read
  `mark_email_read`, Reply and an email the user answered (its row's mark, "You replied") `reply`,
  Reply all `reply_all`, Forward `forward`, Drafts `draft` (an email's row says "Draft" in `alert`
  instead),
  a Settings page its nav's glyph wherever it's named.
- **Tones**: `caution` and `alert` are close in hue, so a state's shape says how serious it is
  before its words do. **Caution**, something Setpoint depends on struggling (a source failing or
  retrying, triage down, News's AI down, a feed failing, ntfy failing, a search that couldn't
  answer): `warning`, the outlined triangle, in `caution`. **Alert**, something of the user's that
  failed (a change, the failure toast, Alfred's failure, a Send test) or offline: `error`, the
  circle, in `alert`; offline keeps `cloud_off`. **Stale**, checks stopped: `history` in `ink3`.
  **Healthy** shows only in Settings: a 7 px `good` dot. Account trouble keeps `sync_problem`
  everywhere, the Inbox's needs-reconnect bar included. 16 px in lines and in rows.
- **Todoist glyphs** (`glyphs/task-open.svg`, `task-done.svg`): open is a 13 px ring, 1.5 px `ink3`
  stroke (12 px, `ink2` on the grid), or its project's colour clamped to the theme's band, with the
  same colour at 14% inside, as a chip's tint; a ring that completes grows to 1.15 under the pointer,
  fills to 34% with a 3 px halo of its colour and shows an 11 px `check` centred on it; done is a filled disc with the check knocked
  out, in **`good`**, title struck through in `ink3`.
- **Unread:** a 6 px `ink` dot in a 12 px gutter at the row's start (Attention's `caution`, and a
  read Attention row not yet Done keeps a 6 px `caution` ring); unread sender and subject are
  `ink` at 500, read are `ink2` at 400. A Noise row recedes: unread, `ink2` at 400 with an `ink3` dot;
  read, `ink3`.
- **The mark** is **Day stack**: three calendar chips stacked, `cool` on top,
  `caution` lifted and tilted −6° in the middle, a shorter `violet` below. A bare 18 px glyph before
  the name, no tile, in the theme's tokens; they are the brand's and stay put when an account or
  calendar is recoloured. Never show it beside the pending spinner.
- **Alfred's mark** is `auto_awesome` filled with a gradient from `cool` to `violet` (bottom left to
  top right), two of Day stack's colours, wherever Alfred shows: Ask Alfred, the Answer card's header,
  and Ask about this email in the reader and ⌘K. Nothing else about the AI takes a hue.
- **Favicon:** `favicon.svg` (the mark on a 32 px `card` tile, radius 7, with an `edgeOn`
  border, in Night's colours), 16 and 32 px PNGs (the 16 px one redrawn on its pixel grid: the middle
  chip level, set apart by the wider gap above it) and a 180 px square `apple-touch-icon`; no web
  manifest.

## Interaction rules

- **Read state:** an email becomes read only when opened (Enter or a click), by Mark all as read, or
  by copying its verification code. Moving the cursor, scrolling and opening a Noise line never mark
  anything read.
- **Keyboard first:** every common action has a key; the keyboard cursor is a `sub2` fill, and
  moving the pointer onto a row makes it the cursor. On an email, R replies, A replies to all and F forwards;
  C writes a page's main thing (a new message on mail, a new event on Calendar); in the composer
  ⌘Enter sends and ⌘⇧B shows Cc and Bcc. Esc closes the topmost thing (the
  composer keeps its draft). Key hints read
  "Esc", "⌘K", "⇧I".
- **Changes** go through one command layer: pending (.5 opacity) until the provider confirms, failed
  in place with the provider's message otherwise. Nothing quietly reverts.
- **Undo** comes as a 6-second toast at the bottom centre, its time draining as a hairline; a swipe
  takes it away sooner. Send joins it: the server holds a sent email 6 seconds, and the toast reads
  "Sending" with Undo, which opens the composer again as it was.
- **Text selection:** titles, addresses, codes and email bodies can be selected; controls can't.
- **Right-click** opens an item's actions at the pointer; selected text, links and fields keep the
  browser's menu.
- **Mail in the sidebar:** Inbox is mail's row, with the unread count. Sent and Drafts sit under it as
  smaller, indented rows at 400. Sent has no count, and Drafts shows only while a draft waits, with
  its count. In the rail Inbox is mail's one icon. Sent's header filters by account (All, then each
  account with its colour), though the Inbox has none: the Inbox is mail that came in, whichever
  address it came to, and in Sent the account is the address the user chose to write from.

## Copy

Sentence case; " · " separates the parts of a metadata line, a comma the clauses of a sentence,
status words and lists of like things, and nothing comes before a pill or a button with a glyph; " – " ranges, "…" is one character; times "2:30 PM"; ages
"now", "4m", "2h", "Yesterday", "Mon", "Oct 1" in the Inbox and search, clock times under All's day
headings; full timestamps in tooltips. Empty states are one line and an action: "All caught up · Open
All" (stacked under the mark); the day pane's empty day is two dashed ghost rows instead, New event C and New task D; a
day whose items are only hidden, "4 hidden · Show all". Each
leads with its glyph in `ink3`, 20 px and 12 px before the words, or 16 px and 8 px in a row 44 px or
shorter. The UI says "Done".
