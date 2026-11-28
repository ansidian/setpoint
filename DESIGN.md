# Setpoint design

The design rules that hold across every page: principles, vocabulary, tokens, motion, glyphs and
copy. They are small and global on purpose. How a page behaves lives in its tests, not here.

## How to use this file

- **Values:** `web/src/tokens.ts` defines every token once, and the tables below record them.
  Nothing checks that they agree, so change them together. What checks colours is the contrast
  test (4.5:1 for small text in both themes) and the browser sweep's axe check.
  `design-export/` keeps the values the boards were drawn with and isn't updated.
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
- **The AI sorts and pre-fills; it never adds to a list the user trusts.** It writes a mail draft
  only when asked, fills the body alone, and never sends.
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
| `frame` | `#050506` | `#0b0c0e` | the dark frame around the content cards: the sidebar, each page's header row, the key hints; in Light drawn as Night in full |
| `panel` | `#0b0c0e` | `#f1f1ee` | not drawn since the frame and cards took its places; Light's frame is Night's `panel` |
| `card` | `#131417` | `#ffffff` | the content cards on the frame: the mail lists and reader, the grids, the right panes, Settings' page, ⌘K's list, the phone's content |
| `cardRing` / `cardTop` | `rgba(255,255,255,.07)` / `.05` | `transparent` / `transparent` | a content card's ring / its 1 px top highlight: hairlines, not shadows |
| `cardOn` | `#1a1b1f` | `#ffffff` | a surface on a card, a step up: the code and facts cards, attachments, the prompt, tags, the proposal and Answer card, the floating detail, focused search and fields, the drag tip, the phone's toast |
| `band` / `bandInk` | `#1c1d22` / `#dcdbd7` | `#eef2f7` / `#24324a` | a header band on a card (days, Calendar's weekdays, the day pane's and News's sections, Jobs's headers) / its text |
| `toast` | `#1b1c20` | `#ffffff` | the toast |
| `chip` | `#0f1013` | `#ffffff` | inputs |
| `modal` | `#0c0d0f` | `#ffffff` | popovers and menus |
| `ink` / `ink2` / `ink3` | `#ecebe7` / `#a3a4a8` / `#999ba0` | `#1b2430` / `#465263` / `#566271` | primary / secondary / tertiary text and icons; Light's are slate, everywhere |
| `inkUnread` / `inkRead` / `inkReadSubj` / `inkNoise` | `#f5f4f0` / `#9c9ea3` / `#8e9095` / `#8e9095` | `#1b2430` / `#465263` / `#465263` / `#566271` | a mail row's unread sender and subject, its read sender, its read subject, a read Noise row's sender and subject (Glyphs › Unread) |
| `onInk` | `#050506` | `#ffffff` | text on `ink`, on the unread badge, the phone's attention pill and solid calendar chips |
| `edge` / `edgeOn` / `edgeHover` | `rgba(255,255,255,.055)` / `.12` / `.14` | `rgba(20,35,55,.1)` / `.17` / `.22` | borders / overlays, focus / under the pointer |
| `hair` | `rgba(255,255,255,.07)` | `rgba(20,35,55,.08)` | dividers, grid lines |
| `rowLine` | `rgba(255,255,255,.03)` | `rgba(20,35,55,.05)` | the line between a card's rows |
| `sub` / `sub2` / `sub3` / `sub4` | `rgba(255,255,255,.055)` / `.09` / `.13` / `.17` | `rgba(20,35,55,.04)` / `.07` / `.11` / `.15` | hover / keyboard cursor / tracks, segmented "on", a press / a ghost button pressed |
| `stripe` | `rgba(255,255,255,.045)` | `rgba(20,35,55,.05)` | hatching (drag ghosts, hidden images) |
| `scrim` | `rgba(0,0,0,.72)` | `rgba(20,26,32,.35)` | behind Settings and ⌘K |
| `caution` | `oklch(0.75 0.16 40)` | `oklch(0.535 0.16 40)` | Attention's count, the phone's attention pill, needs-reconnect bar, failing lines, an overdue task |
| `alert` | `oklch(0.72 0.17 25)` | `oklch(0.535 0.185 25)` | protected mail, failed changes, offline pill, destructive actions, now-line, Jobs's Rejected mark |
| `warm` | `oklch(0.8 0.11 55)` | `oklch(0.54 0.12 55)` | Business |
| `cool` | `oklch(0.8 0.11 235)` | `oklch(0.54 0.12 235)` | Personal (account and calendar), rain |
| `accent` | `oklch(0.8 0.11 235)` | `oklch(0.54 0.12 235)` | "you are here": the selected item's tint and edge, the current page's icon, today's month boundary, a date range, selected search chips, News's updates |
| `comf` | `oklch(0.8 0.11 165)` | `oklch(0.54 0.1 165)` | Work |
| `good` | `oklch(0.8 0.13 150)` | `oklch(0.53 0.13 150)` | done or healthy: the done glyph, the reader's Done check |
| `sun` | `oklch(0.86 0.16 92)` | `oklch(0.63 0.125 92)` | sun, Night's search highlight (26% mix) |
| `violet` | `oklch(0.8 0.11 300)` | `oklch(0.54 0.14 300)` | Jobs (account and calendar) |
| `cyan` | `oklch(0.86 0.11 182)` | `oklch(0.58 0.1 182)` | Classes |
| `onAlert` | `#1a0806` | `#ffffff` | text on `alert` |
| `sunGlyph` | `var(--sun)` | `oklch(0.58 0.14 78)` | the forecast's sun on the grids and the right pane, Jobs's Ghosted ring |
| `switchOn` / `switchKnobOn` | `color-mix(in oklch, var(--good) 58%, var(--modal))` / `var(--ink)` | `var(--good)` / `var(--onInk)` | a switch that's on: its track / its knob |
| `hl` | `color-mix(in oklch, var(--sun) 26%, transparent)` | `oklch(0.92 0.12 96)` | search's match highlight |
| `edgeFocus` | `rgba(255,255,255,.2)` | `rgba(20,35,55,.3)` | a focused field's border |
| `mailEdge` | `transparent` | `rgba(20,35,55,.1)` | the HTML email frame's ring |
| `navOn` / `navOnEdge` | `rgba(255,255,255,.10)` / `rgba(255,255,255,.07)` | `#ffffff` / `rgba(20,35,55,.10)` | the current page in a nav: its fill / its inset hairline |
| `dayOff` / `dayOut` / `dayToday` | `rgba(255,255,255,.02)` / `#0e0f11` / `rgba(255,255,255,.035)` | `rgba(20,35,55,.022)` / `#f4f6f9` / `accent` 5% | the calendar's weekends / days outside the shown month / today's cell |
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

- **Frame and cards:** the frame holds the sidebar, each page's header row and the key hints; the
  content sits on `card`s inside it, radius 10, 8 px from the frame's edges and from each other (on
  the phone, one card flush to the sides with its top corners rounded). The drag edges sit in the
  gaps. The key hints are a strip of frame under their pane's card, and go with it when an email
  opens. Settings is the frame with its page a card, told from it by its fill, the modal's ring its one edge; ⌘K's field is on the frame, its list a card. In Light the frame is drawn as Night in full (inks, hues, fills,
  fields), since Light's hues don't hold on near-black: an element marked `data-theme="night"`
  takes Night's variables, keeping its own theme's `frame`. A rule meant for one theme alone is
  written so it doesn't match inside that scope (`tokens.ts › nightScope`). On the phone every menu
  follows the page's theme, as the bottom sheets do: the title menu and search's suggestions open
  from the Night header but draw in the page's own theme, light in Light (`tokens.ts › pageScope`).
- **Roles**: each colour has one job, so a screen has two or three anchors. **`accent`**
  says "you are here" (named for its job, with `cool`'s values, so recolouring Personal never moves
  it). **`good`** says done or healthy. **`caution`** says "needs you": the attention pill and count,
  Attention's band and dots, health warnings, and an overdue task (the overdue banner's label and
  a Today line's passed time), nothing else. **`alert`** says danger and now: protected
  mail, failed changes, destructive actions, offline, the now-line, today's disc and a row's "Draft".
  **`ink`** is the primary action (New, sign-in, OK: solid ink pills), except the composer's Send,
  a solid `accent` pill at the start of its format row. The identity swatches show only as dots, chip
  tints and bars, never as control fills, and the AI has no hue of its own.
- **Accounts** (`--a-*`): Business `warm`, Personal `cool`, Work `comf`, Jobs `violet`, iCloud `ink2`.
  An account shows as a dot and its label on Sent's, Drafts', Scheduled's, Snoozed's, search's and
  Alfred's rows, and in the reader's account band under the tools: a rounded tile 8 px in from the
  card's sides, its colour at 11% with a 22% ring, the account's own icon (outline) and its name at
  600 in its colour (in Light capped at `--tintL`), its address and the email's state ("Inbox",
  "Done", "Snoozed until Mon 9:00 AM", "Sent") in `ink3`. The Inbox's rows don't show the account.
  **Calendars** (`--c-*`): Personal `cool`, Classes `cyan`, Jobs `violet`. Both pick from nine of
  the 11 swatches in Settings, not `caution` or `alert`; one picked before still shows.
- **Mixes** of a hue are `color-mix(in oklch, <colour> N%, transparent)` unless a base is named: tags
  (`alert` 10% on `cardOn` with a 40% edge; `caution` 12% with a 35% edge), the needs-reconnect bar
  (`caution` 9% on the card, 22% bottom edge), calendar tint `--evtint` (Night 16%, Light 14%),
  deepening under the pointer by `--evhover` (Night 18%, Light 14%) laid over it in the chip's own
  colour, and by 28% while pressed; as a change lands it starts at `--evland` (Night 34%, Light
  26%) and settles back; Attention's band and today's header (`caution`, `accent`, 12% on the card in srgb, Light 10%) and FYI's
  (`accent` 6%, Light 7%, its text `accent`, Light `oklch(0.47 0.12 235)`). A neutral (an ink or a surface) mixes in `srgb` or is an alpha token, never in oklch, which
  tints it.
- **Theme numbers:** on the calendar, coloured text on its own tint caps its lightness at `--tintL`
  (Night 1, Light .43), keeping its hue and chroma; the email frame's brightness `--mailDim`
  (Night .95, Light 1); Todoist's colours clamp their lightness to `--ringMin`–`--ringMax`
  (Night .72–1, Light 0–.55), keeping Todoist's hue and chroma.
- **Shadows:** popovers and the floating detail `0 18px 50px rgba(0,0,0,.4)` (Light
  `rgba(15,20,28,.14)`); modals `0 30px 80px rgba(0,0,0,.35)` (Light `.18`); pills and toasts
  `0 10px 30px rgba(0,0,0,.3)` (Light `.14`). Shadows on overlays and on the selected item.
- **The selected item lifts** (the open email, selected emails, a selected day-pane item), as
  Gmail's selected row does: full width and square, `accent` mixed into the card (`--liftTint`,
  Night 14%, Light 12%), a 3 px `accent` edge on its left, and `--shadow-lift` just below it,
  `0 1px 2px` plus `0 2px 5px -1px` in black `.75` / `.5` (Light slate `rgba(20,35,55,.28)` /
  `.14`). It sits over the rows after it and under the sticky bands; a band right after it draws
  the shadow's lower half inside its own top, except while stuck. The keyboard's cursor or a press
  on it changes nothing. In Night its quiet text (`ink3`) and a read row's sender and subject take
  `ink2`, 5.6:1 on the tint. The day pane's upcoming event, selected, keeps its rounded tile in its
  own colour (16%) and takes the shadow alone.
- **Scrollbars:** thin and dark (Light thumb `rgba(20,35,55,.22)`). The mail lists and Settings' page
  draw their own 6 px thumb over their content's right end, so rows and bands run to the card's edge
  and no scrollbar is cut by its corners; the phone keeps its native overlay scrollbar.
- **Light's neutrals** (edges, hairlines, fills, stripes, the calendar's weekends and outside days,
  the scrollbar) are slate alphas, `rgba(20,35,55,…)`, as its inks are slate.

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
| A band's header: days, weekday names, the day pane's, News's and Jobs's sections | 12 / 600, sentence case |
| The Inbox's lane labels, in the lane's ink | 12 / 600, sentence case |
| The Inbox's kind labels (a hairline after them to the list's edge) | 12 / 500, sentence case |
| Noise's folded line, in `ink3` with no rule above it | 12 / 400, sentence case |
| Other group headers and section labels | 11.5 / uppercase / .08em |
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
| 18 | popovers, ⌘K, the floating detail, cards (proposal, Answer), the phone's bottom sheet (top corners) |
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

The overdue banner, an arrival, has two more. **Reveal** brings it in: the veil fades in over
320 ms and the label over 240 ms; the title slides up from behind its own baseline (from 112% of
its height, in a mask 7 px taller above and below that clips only while it enters) from 80 ms over
560 ms `cubic-bezier(.16,1,.3,1)`; then the due line, or the list, rises 6 px and fades in from
320 ms over 320 ms. It takes a click once the title is up (640 ms); a press pushes its text in to
.985, and its hint fades in over 260 ms from 1400 ms. **Return to its row** takes it out: what
isn't a returning title fades over 120 ms; each title due today moves to the centre of its Today
line's title and shrinks to that size over 420 ms `cubic-bezier(.5,0,.2,1)`, 50 ms apart, opaque
until 80% of the way; the veil fades from 60 ms over 360 ms; and the line takes `caution` at 30%,
fading to none over 420 ms, as a calendar change lands. Where Today's lines aren't on screen (the
rail, Calendar) the titles go instead to the overdue-task icon, 18 px under the sidebar's nav,
shrinking to a third of a line and opaque to 55% of the way. It scales in from .8 over 180 ms as
they leave and, as they arrive, takes `caution` at 34%, settles to 12% by 45%, holds to 75%, then
goes: 1200 ms in all. Each title has a snooze button after it, `snooze` in `ink3` (`ink` under
the pointer), 16 px in a row and 18 at the end of one task's title, that fades in over 180 ms once
the title is up; its menu offers 1 hour, 3 hours and Tomorrow, at Settings' task time or else
9:00 AM. A snoozed title fades where it is over 180 ms and its row closes up over 180 ms, the next
hidden task fading into the list as "and N more" counts down; it never returns to its Today line,
and snoozing the last one closes the banner as a dismissal does.

**Completing** a task has one moment wherever it completes (the Today block, the day pane, the
card, the grid's chips and subtasks). It plays as the task turns done, never on reopening or Undo.
Six 3 px dots in the ring's colour fly from 4 to 14 px out of its centre, 60° apart, fading over
420 ms. The done check pops from .5 through 1.18 to 1 over 280 ms `cubic-bezier(.3,0,.2,1)`. A
`good` highlight at 24%, 1 px over and 3 px past the text, sweeps across the title over the first
40% of 640 ms, then fades. The strike draws left to right over 260 ms, and the title goes `ink3`
over 180 ms and moves 3 px right and back over 300 ms. A Today line folds away once the 640 ms are
over.

**Prefilling** a proposal from the reader: while the model reads the email (1.5 s at most), the
fields it fills (the title, when, place, calendar or project) keep their boxes, their values hidden
under a breathing bar from the card's first frame, not after 200 ms, so the rules' values never
flash first; nothing in the card can be typed into or created. Its answer lands as the completion
moment's sweep: each field fades in over 120 ms while the same `good` highlight crosses it over
640 ms, the fields top to bottom 60 ms apart. Without an answer the rules' values only fade in.

Overlays arrive on these timings: every
menu and popover grows from its anchor's corner (4 px and .97, 180 ms), the "+N" popover from its
"+N", and a card anchored to a calendar item opens as the floating detail does; ⌘K rises 6 px over
180 ms and Settings 8 px over 260 ms, their scrims fading in; a pane's content over a narrow
window's list (on a desktop the pane is always there), and the editor however it's opened,
slides in 12 px over 180 ms; Alfred's Answer card and a proposal slide down 6 px, and
fold away when closed. On the phone a full-screen sheet slides up from the bottom edge over
260 ms, and a bottom sheet rises the same way as its scrim fades in, following a drag down and
settling back over 180 ms when it isn't dragged far enough to close. ⌘K, Settings, the "+N" popover,
menus and the phone's sheets close at once.

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
  Reply all `reply_all`, Forward `forward`, popping the composer out `pip` (its window's × is `close`), help me write's undo and redo `undo` and `redo`, attaching a file `attach_file`, Drafts `draft` (an email's row says "Draft" in `alert`
  instead), an attachment of an unknown type `unknown_document`, snoozing (an overdue task, an email, the
  Snoozed row, a snoozed email's return time and a returned email's mark) `snooze`,
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
  out, in **`good`**, its title struck through in `ink3` by a 1 px line at 55% of its height. Completing one plays the
  completion moment (Motion).
- **Overdue task** (`glyphs/task-overdue.svg`): a task ring with a check, open where a `caution`
  badge with an `onInk` exclamation mark sits; 20 px in `ink`, 1.5 stroke. One use: the icon the
  overdue banner's titles land on where Today's lines aren't on screen, on a 32 px tile, radius 10,
  there only for the landing.
- **Unread:** a 6 px `ink` dot in a 12 px gutter at the row's start (Attention's `caution`, and a
  read Attention row not yet Done keeps a 6 px `caution` ring); unread sender and subject are
  `inkUnread` at 500, read are at 400, the sender `inkRead` and the subject `inkReadSubj`. In Light
  these are `ink` and `ink2`. In Night unread is near-white `#f5f4f0` and read steps down to grey,
  the sender `#9c9ea3` and the subject `#8e9095` (4.5:1 on the cursor row), so unread no longer
  shows by its dot alone; on a lifted row read takes `ink2`. A Noise row recedes: unread, read's inks
  at 400 with an `ink3` dot; read, `inkNoise` for sender and subject (Light `ink3`, Night the read
  subject's grey, as no dimmer grey reads 4.5:1 on the cursor row).
- **The mark** is **Day stack**: three calendar chips stacked, `cool` on top,
  `caution` lifted and tilted −6° in the middle, a shorter `violet` below. A bare 18 px glyph before
  the name, no tile, in the theme's tokens; they are the brand's and stay put when an account or
  calendar is recoloured. Never show it beside the pending spinner.
- **Alfred's mark** is `auto_awesome` filled with a gradient from `cool` to `violet` (bottom left to
  top right), two of Day stack's colours, wherever Alfred shows: Ask Alfred, the Answer card's header,
  Ask about this email in the reader and ⌘K, help me write in the composer, and the summary tile in the reader's head
  (a conversation's or one email's summary, written by a model). Nothing else about the AI takes a hue.
- **Favicon:** `favicon.svg` (the mark on a 32 px `card` tile, radius 7, with an `edgeOn`
  border, in Night's colours), 16 and 32 px PNGs (the 16 px one redrawn on its pixel grid: the middle
  chip level, set apart by the wider gap above it) and a 180 px square `apple-touch-icon`, which the web
  manifest also names, so Add to Home Screen opens Setpoint standalone.

## Interaction rules

- **Read state:** an email becomes read only when opened (Enter or a click), by Mark all as read, or
  by copying its verification code. Moving the cursor, scrolling and opening a Noise line never mark
  anything read.
- **Keyboard first:** every common action has a key; the keyboard cursor is a `sub2` fill, and
  moving the pointer onto a row makes it the cursor. On an email, R replies, A replies to all, F forwards and S snoozes;
  C writes a page's main thing (a new message on mail, a new event on Calendar); in the composer
  ⌘Enter sends, ⌘⇧B shows Cc and Bcc and ⌘J opens help me write's line (elsewhere ⌘J switches
  Light and Night). Esc closes the topmost thing (the
  composer keeps its draft). Key hints read
  "Esc", "⌘K", "⇧I".
- **Changes** go through one command layer: pending (.5 opacity) until the provider confirms, failed
  in place with the provider's message otherwise. Nothing quietly reverts.
- **Undo** comes as a 6-second toast at the bottom centre, its time a ring draining around its glyph;
  a swipe takes it away sooner. Every toast leads with a 22 px disc of 14% of its colour holding its
  14 px glyph, the ring around it (track 26%, 1.5 px), then the line, then its action as a 26 px
  button with its key's hint where the page takes one (⌘Z on the Inbox's and Sent's Undo). Its
  colour and glyph say what happened: done `good` `check`, marked read `good` `mark_email_read`,
  Trash, deleted and discarded `alert` `delete`, Sending `accent` `send`, a pin `sunGlyph` `keep`,
  a snooze `violet` `snooze` ("Snoozed until Mon 9:00 AM"), a failure `alert` `error`, any other line `ink2` with a glyph that fits (Copied `content_copy`,
  otherwise `info`). A failure stays 8 seconds as one line, wrapping at
  380 px at most, with an `alert` edge. A failure with an action (Open, Try again) waits for an
  answer, with no ring. A toast never asks a question. The phone's toast is as it was: `cardOn`, a bare
  glyph, a hairline, and everything runs its time. It keeps 16 px from the screen's sides: a long
  line ends in an ellipsis, a failure wraps to two lines, and its action keeps its size. Send joins it: the server holds a sent email 6 seconds, and the toast reads
  "Sending" with Undo, which opens the composer again as it was.
- **Asking first:** an ask sits where it was asked, in place of the control that asked it, never in
  the toast. Sign out at Settings' foot becomes "Sign out of Setpoint?" over a quiet Cancel (Esc)
  where Sign out was and a solid `ink` Sign out (↵), with the keys taken outside a field. ⌘K's Sign out
  opens Settings with the question up.
- **Text selection:** titles, addresses, codes and email bodies can be selected; controls can't.
- **Tap size:** on the phone every control takes a tap at least 44 px across (`--ph-tap`). Where its
  look stays smaller, its hit area grows around it, never over a neighbour's.
- **Right-click** opens an item's actions at the pointer; selected text, links and fields keep the
  browser's menu.
- **Mail in the sidebar:** Inbox is mail's row, with the unread count. Sent and Drafts sit under it as
  smaller, indented rows at 400. Sent has no count, and Drafts shows only while a draft waits, with
  its count. Snoozed comes after Drafts, as small, only while an email is snoozed, with its count: its
  page lists them soonest return first, each with its return time and Unsnooze under the pointer. In the rail Inbox is mail's one icon. Sent's header filters by account (All, then each
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

A provider's trouble reads as a sentence, never a list of name, time and words. A provider's full
sentence stands alone ("The calendar is read-only."). Otherwise the status code picks the words
(5xx "is down", 429 "is limiting requests", another refusal "is refusing Setpoint", no answer
"can't be reached") and its own words follow in brackets, first letter lowered, unless they only
repeat the code: "Todoist is down (scheduled maintenance) as of 7:26 PM". A source that is only
stale reads "Todoist as of 9:14 PM"; a Settings row, which names its source, "Down (scheduled
maintenance) since 6:02 AM". The status code goes in the tooltip, except on a proposal whose
prefill failed: its line in the card's head ends with Anthropic's status ("Failed to prefill, Claude
didn't answer (529)"), and its tooltip says what the status means. A refusal shown beside what failed
says only why. Any other failure line reads "Failed to <verb>, <reason>": "Failed to pin, can't
reach Setpoint", naming what failed only where it says which or arrives later ("Failed to send
"Lunch Friday", …", "Failed to mark 3 read, …"); the reason loses its last full stop and its first
capital, unless it starts with a name.
