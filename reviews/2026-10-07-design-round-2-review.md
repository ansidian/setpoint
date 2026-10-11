# Setpoint v2 · design round 2 review: final

Reviewed 2026-10-07 by Andy and Claude Code. **Round 2 is the final design** (Andy, 2026-10-07):
no further Claude Design round. Every round-1 must-fix, every decision and every consistency item
landed, and the new boards 11b, 12d and 15b are good. What follows goes into DESIGN.md's
"Overrides to the export"; where the export and DESIGN.md differ, DESIGN.md wins.

## Andy's decisions this round (BRIEF.md 46–48)

- The floating detail is **280 px** wide.
- The glide's overshoot **clamps at the grid's edges** and never crosses into the right pane.
- **Counts follow the rules on every board.** Opening an unread email changes the unread counts,
  not the attention pill.

## Overrides to the round-2 export

- **Counts after opening.** With Northwind open (01, 20, 21, 22a) the sidebar reads Inbox (3) 18
  and Jobs 1. With the Google recovery email open (03) it reads 18 and Personal 7, and with Contoso
  Coffee open (02) it reads 18 and Personal 7. It stays 19 where the open email was already read
  (07, 08, 10).
- **All includes Noise.** Today's Tailspin, Contoso Coffee and Litware emails appear in All (05)
  with the kind Noise.
- **Done glyph colour** is darma's `good`, not `comf`.
- **The recurring scope defaults to "This event"** both when editing (14) and on drop (15b).
- **Summaries are `ink3`** in both themes, as drawn. BRIEF.md's token table said `ink2`; the
  export wins, so the subject stays dominant.
- **Placement applies to every anchored overlay**: the floating detail and the recurring-drop
  prompt (15b) both take the side covering the fewest items. 12a should be checked against "above".
- **New events take the reminder default from Settings › Notifications** (18b). 13's "30 min
  before" is just that board's value.
- **Light `page`** is darma's `#f6f6f4` everywhere (22a's list and reader and 22b's pane drifted to
  `#f8f8f6`). Light row dividers are `hair`, `rgba(29,30,33,.08)`.
- **Week view titles** end in "…" when clipped (16's Dinner block).
- **Phone:** the Pinned row's date never wraps (21).
- **Search reasons** use one case style: "Org Northwind · Type Rejection".
- **Board 24's sidebar demo** has no box around the mark and name.
- **Noise in the Inbox** is a collapsed count. 02 expands it only to reach the newsletter.

## Accepted as drawn

- **280 px card**, and Dentist's card going left (12a). Andy also accepted Claude Design's
  reasoning in 12d: dragged aside, then a glide from the drop point.
- **The busy day** (11b): "+3" with a popover listing all eight items.
- **The recurring-drop prompt** (15b): "Gym · Wed, Oct 7 → Thu, Oct 8 · 7:00 AM", three options,
  Move ↵ and Cancel Esc, and the agenda's "Moving to Thu, Oct 8".
- **Typed "fri 7-9pm"** in 13, so the end time comes from the title.
- **Parkside's kind is People.** **Tailspin's Unsorted email is on Personal.** **The list
  scrolls** on 02.
- **Different stale examples** (Personal, iCloud, Todoist): each board shows one realistic case.
