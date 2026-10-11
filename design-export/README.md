# Setpoint v2 · design handoff (round 2, final)

The whole Claude Design canvas as code. Every board is plain HTML on one shared stylesheet, so spacing,
type, colour, glyph paths and motion values can be read from the source instead of measured from PNGs.
Exported 2026-10-07 from the canvas "Setpoint v2" (round 2).

Open `index.html` for a gallery of every board, or open any file in `boards/` directly. Everything is
local: the fonts are bundled, nothing loads from the network.

## What's here

| Path | What it is |
| --- | --- |
| `boards/*.html` | One standalone page per board, at its exact size. The markup is the design. |
| `styles/setpoint.css` | **The source of truth** for tokens and components. `.sp` is Night, `.sp.light` is Light, `.sp.app` is the 1677 × 1050 shell. |
| `styles/fonts.css`, `styles/fonts/` | Geist and Geist Mono (variable, OFL), and Material Symbols Rounded subset to the icons used (Apache-2.0). |
| `tokens/setpoint-tokens.json` | The tokens parsed from `setpoint.css`, per theme, plus type and layout constants. |
| `tokens/mantel-tokens.json` | mantel's design-system tokens as installed on the canvas (Night values match Setpoint's). |
| `glyphs/icons/*.svg`, `glyphs/icons.json` | Every Material Symbols icon the boards use, as SVG paths: Rounded, wght 300, FILL 0, GRAD 0, opsz 24, `viewBox="0 -960 960 960"` (the same form as mantel's `Icon`). `-fill` files are the FILL 1 uses. |
| `glyphs/marks/*.svg` | The five mark options from board 24. `1-set-point.svg` is the stand-in in the sidebar (bare 18 px, `ink`). |
| `glyphs/task-open.svg`, `glyphs/task-done.svg` | Todoist status glyphs: the open ring and darma's filled disc with the check knocked out. |
| `glyphs/material-symbols-used.txt` | The icon names, for bundling. |
| `motion/glide.json`, `motion/glide.css` | Board 12c's motion values, machine-readable. |
| `boards.json` | Board index: number, title, size, section and canvas position. |
| `source/project/` | The canvas's own files (`*.dc.html`, `canvas.json`, `setpoint.css`, the installed mantel tokens), to re-import or diff. |

## Reading the boards

- Each board's root is `<div class="sp app">` (or `sp` for spec sheets). Component classes live in
  `setpoint.css`; one-off values are inline `style` attributes, and a few board-only rules sit in that
  board's `<style>`, scoped under `.sp`.
- Icons in the boards are ligature text (`<span class="ms">inbox</span>`) on the bundled font. For the
  build, use the paths in `glyphs/icons.json`; they are the same outlines at the same settings.
- Colours are always `var(--token)`. Account colours: `--a-business` warm, `--a-personal` cool,
  `--a-work` comf, `--a-jobs` violet, `--a-icloud` ink2. Calendars: `--c-personal` cool,
  `--c-classes` cyan, `--c-jobs` violet.
- Calendar chips: the calendar colour as text, a 3 px left bar (`box-shadow: inset 3px 0 0`), and a
  `color-mix(in oklch, <colour> var(--evtint), transparent)` fill. `--evtint` is 16% in Night and 12% in
  Light. The selected item is solid (`<colour>` fill, `--onInk` text). Past items are at .55 opacity.
- Boards are static at the design target (1677 × 1050). Phone screens are 390 × 844 inside board 21.

## Key measurements

Sidebar 248 · header 56 · reading pane 680 · Calendar's right pane 400 · month columns 147, rows 176 ·
floating detail 280 wide, 8 px off its item · Settings 1040 × 720 with a 220 nav · radii 999 / 26 / 18 /
14 / 12 / 10 · base type Geist 13 / 1.35 with `ss01`, tabular figures on times and counts · icons
Material Symbols Rounded 300.

## The glide (board 12c)

| Track | Value |
| --- | --- |
| Position | FLIP `translate`, `cubic-bezier(.22, 1.3, .36, 1)` (≈3% overshoot, position only) |
| Duration | `min(380, 280 + 40 × distance / 400)` ms: 454 px → 325, 600 → 340, 724 → 352, 1,000 → 380 |
| Height | 220 ms, `cubic-bezier(.2, 0, 0, 1)` |
| Old content | fades out 0–90 ms |
| New content | fades in 90–220 ms with a 6 px slide in the direction of travel |
| Selection | new item tinted → solid at 60 ms; old item back to tinted at 0 |
| Interruption | a click mid-glide retargets from the current position and velocity |
| Open / close | 180 ms, scale .96 → 1 + fade from the anchor / 120 ms, scale → .98 + fade toward it |
| Drag | lifts from the grip, follows 1:1, stays where dropped; the next click glides from there (12d) |
| Edit | 220 ms, the card shrinks and fades toward the right pane; the editor slides in 12 px |
| Placement | per click, the side covering the fewest other items (right, left, above, below; right first), inside the month |

Everything else uses the standard motion tokens: 120 / 180 / 260 ms on `cubic-bezier(.2, 0, 0, 1)`.

## Carried from round 2

- The floating detail is 280 px wide, not 340, so it fits left of a mid-week item.
- On a long glide, the overshoot can carry the card about 9 px past the month's edge for an instant.
- Sidebar counts stay at the brief's 19 unread even on boards where an unread email is open.

## Boards

| # | Board | Size | File |
| --- | --- | --- | --- |
| | **Mail** | | |
| 01 | Inbox · a typical morning | 1677 × 1050 | [`boards/01-inbox-a-typical-morning.html`](boards/01-inbox-a-typical-morning.html) |
| 02 | Deliveries expanded · images hidden | 1677 × 1050 | [`boards/02-deliveries-expanded-images-hidden.html`](boards/02-deliveries-expanded-images-hidden.html) |
| 03 | Security | 1677 × 1050 | [`boards/03-security.html`](boards/03-security.html) |
| 04 | All caught up | 1677 × 1050 | [`boards/04-all-caught-up.html`](boards/04-all-caught-up.html) |
| 05 | All, grouped by day | 1677 × 1050 | [`boards/05-all-grouped-by-day.html`](boards/05-all-grouped-by-day.html) |
| 06 | Search with chips | 1677 × 1050 | [`boards/06-search-with-chips.html`](boards/06-search-with-chips.html) |
| 07 | Alfred's Answer card | 1677 × 1050 | [`boards/07-alfred-s-answer-card.html`](boards/07-alfred-s-answer-card.html) |
| 08 | Proposal · Add to calendar | 1677 × 1050 | [`boards/08-proposal-add-to-calendar.html`](boards/08-proposal-add-to-calendar.html) |
| 09 | Pattern prompt | 1677 × 1050 | [`boards/09-pattern-prompt.html`](boards/09-pattern-prompt.html) |
| 10 | Pinned shelf | 1677 × 1050 | [`boards/10-pinned-shelf.html`](boards/10-pinned-shelf.html) |
| 20 | ⌘K on an open email | 1677 × 1050 | [`boards/20-cmd-k-on-an-open-email.html`](boards/20-cmd-k-on-an-open-email.html) |
| 19a | States · reconnect, offline, Unsorted | 1677 × 1050 | [`boards/19a-states-reconnect-offline-unsorted.html`](boards/19a-states-reconnect-offline-unsorted.html) |
| | **Calendar** | | |
| 11 | Calendar · October 2026 | 1677 × 1050 | [`boards/11-calendar-october-2026.html`](boards/11-calendar-october-2026.html) |
| 12a | Floating detail · Dentist | 1677 × 1050 | [`boards/12a-floating-detail-dentist.html`](boards/12a-floating-detail-dentist.html) |
| 12b | Floating detail · glided to Dinner with Sam | 1677 × 1050 | [`boards/12b-floating-detail-glided-to-dinner-with-sam.html`](boards/12b-floating-detail-glided-to-dinner-with-sam.html) |
| 12c | The glide · motion | 1677 × 1050 | [`boards/12c-the-glide-motion.html`](boards/12c-the-glide-motion.html) |
| 13 | Editor · new event | 1677 × 1050 | [`boards/13-editor-new-event.html`](boards/13-editor-new-event.html) |
| 14 | Editing a recurring event | 1677 × 1050 | [`boards/14-editing-a-recurring-event.html`](boards/14-editing-a-recurring-event.html) |
| 15 | Drag in progress | 1677 × 1050 | [`boards/15-drag-in-progress.html`](boards/15-drag-in-progress.html) |
| 16 | Week view (after 2.0) | 1677 × 1050 | [`boards/16-week-view-after-2-0.html`](boards/16-week-view-after-2-0.html) |
| 11b | A busy day · +3 and its popover | 1677 × 1050 | [`boards/11b-a-busy-day-plus-3-and-its-popover.html`](boards/11b-a-busy-day-plus-3-and-its-popover.html) |
| 12d | Dragged aside, then glides to Dinner with Sam | 1677 × 1050 | [`boards/12d-dragged-aside-then-glides-to-dinner-with-sam.html`](boards/12d-dragged-aside-then-glides-to-dinner-with-sam.html) |
| 15b | Dropped · this, following or all | 1677 × 1050 | [`boards/15b-dropped-this-following-or-all.html`](boards/15b-dropped-this-following-or-all.html) |
| | **Settings and states** | | |
| 17 | Settings › Accounts | 1677 × 1050 | [`boards/17-settings-accounts.html`](boards/17-settings-accounts.html) |
| 18a | Settings › Mail | 1677 × 1050 | [`boards/18a-settings-mail.html`](boards/18a-settings-mail.html) |
| 18b | Settings › Notifications | 1677 × 1050 | [`boards/18b-settings-notifications.html`](boards/18b-settings-notifications.html) |
| 19b | States · a change that failed | 1677 × 1050 | [`boards/19b-states-a-change-that-failed.html`](boards/19b-states-a-change-that-failed.html) |
| | **Light, phone, mantel and the mark** | | |
| 22a | Light · Inbox | 1677 × 1050 | [`boards/22a-light-inbox.html`](boards/22a-light-inbox.html) |
| 22b | Light · Calendar | 1677 × 1050 | [`boards/22b-light-calendar.html`](boards/22b-light-calendar.html) |
| 21 | Phone · Inbox, reader, agenda | 1394 × 1020 | [`boards/21-phone-inbox-reader-agenda.html`](boards/21-phone-inbox-reader-agenda.html) |
| 23 | mantel's mail chip | 1400 × 900 | [`boards/23-mantel-s-mail-chip.html`](boards/23-mantel-s-mail-chip.html) |
| 24 | Setpoint's mark (placeholder) | 1400 × 900 | [`boards/24-setpoint-s-mark-placeholder.html`](boards/24-setpoint-s-mark-placeholder.html) |
