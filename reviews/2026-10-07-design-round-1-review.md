# Setpoint v2 · design round 1 review → round 2

Reviewed 2026-10-07 by Andy and Claude Code against BRIEF.md, darma's DESIGN.md and mantel's chip
rules. Round 1 is strong: dimensions are exact (sidebar 248, header 56, reading pane 680, right pane
400, Settings 1040 × 720 with a 220 nav), every Night colour matches darma, and board 12c's motion
spec is excellent. BRIEF.md is updated (decisions 36–45 and corrected sample counts); it wins over
this note where they differ.

## Your three questions, answered

1. **The floating detail covering its neighbours.** Neither a narrower card nor placing it above or
   below solves it. Instead:
   - On each click, put the card on the side (right, left, above, below) that covers the **fewest
     other items**, trying right first. In 12a, left of Dentist covers an almost empty Mon–Tue and
     keeps Dinner with Sam clickable.
   - The card can be dragged (as 12c's Drag panel has it) and stays where it's dropped. **The next
     click glides it from wherever it was left** to the new item. Show this as a 12d: card
     dragged aside, then a click on Dinner with Sam gliding it from there.
2. **Clock times in All:** accepted. Ages stay in the Inbox and search; All's day headings use
   clock times.
3. **The bounce:** kept, exactly as 12c specifies (position only, 280–380 ms by distance).

## Must fix

- **Opening an email marks it read.** The open email's row loses its unread dot and 500 weight. It
  still shows them on 01, 02, 03, 20 and 22a.
- **Board 02:** its blocked-images example must be mail whose images would really be blocked: a
  **Noise newsletter**, or a sender that fails DMARC. Southridge Video passes DMARC and isn't Noise, so its
  images load automatically (and 18a lists southridgevideo.example as trusted). Make it the 600 px HTML
  newsletter the brief asks for.
- **Done tasks:** darma's completed glyph, a filled disc with the check knocked out, not a grey
  disc with strikethrough (11, 12, 15, 16, 22b). The title can stay struck through in `ink3`.
- **Dragging a recurring event** (15, Gym) asks this / following / all on drop, as editing does.
- **⌘K › Appearance** offers System, Light and Night.
- **mantel's chip** reads **"3 attention | 11 FYI"** and matches the sidebar pill. Attention counts
  not-Done mail, read or not, so the popover includes the read Contoso University email.
- **mantel's "Business needs sign-in" chip is an alert** (`--alert` fill, never folds), exactly like
  the finance importer's sign-in chip. It isn't tone C.
- **One version of each sample email everywhere.** Parkside is from Dana Whitfield, renewal to Nov
  30, sign by Oct 31, "Renewal agreement.pdf". Sam Lee's "Dinner Friday?" is Mon 12:40 PM, so 19a's
  Unsorted needs a different, new email. Blue Door is at 2118 Sunset Blvd. Dinner with Sam is 7–9 PM.
  Use BRIEF.md's corrected counts: 3 attention not Done, 11 unread FYI, 19 unread; sidebar Inbox (3)
  19, Business 7, Personal 8, Work 1, Jobs 2, iCloud 1.

## Changes from Andy's decisions

- **Calendar chips are tinted, not solid.** Use the calendar's colour for the text and a 3 px left
  bar, on that colour at about 16% (Light: about 12%), with darma's `color-mix(in oklch, …,
  transparent)`. **The selected item turns solid** (fill in its colour, text `onInk`); that replaces
  the white outline ring on 12a and 12b, and 12c's "selection ring" track becomes a fill swap at
  60 ms. Past events are dimmed to about 55% everywhere, not only today's.
- **Kinds renamed:** Work → **Career** (job applications, recruiters), Personal → **People** (mail
  from actual people). Accounts keep the names Work and Personal.
- **Every row shows its account's label** beside its dot (Pinned, Security, FYI, search, All), and
  the label stays while the reading pane is open. Use one style everywhere: either the dot and
  label in plain text, as on Attention rows in 01, or the bordered pill from 04 and 05. Pick one.
- **The reading pane collapses when nothing is open** (as 04 does). Keep it.
- **The mark is a placeholder.** Use option 1 as a stand-in and drop the tile behind it in the
  sidebar: darma's mark is a bare 18 px glyph in `ink`. Option 1 is close to the pending spinner in
  19b, so make sure the two never appear side by side.
- **Light theme: use darma's Light tokens exactly.** In particular:

  | Token | darma Light |
  | --- | --- |
  | `panel` | `#f1f1ee` |
  | `ink` / `ink2` / `ink3` | `#1d1e21` / `#56585d` / `#6d6f74` |
  | `hair` / `edge` / `edgeOn` | `rgba(29,30,33,.08)` / `.1` / `.17` |
  | `caution` | `oklch(0.535 0.16 40)` |
  | `alert` | `oklch(0.535 0.185 25)` |
  | `warm` | `oklch(0.54 0.12 55)` |
  | `sun` | `oklch(0.63 0.125 92)` |
  | `cyan` | `oklch(0.54 0.09 195)` |
  | `cool` / `comf` / `good` / `violet` | `oklch(0.54 0.12 235)` / `oklch(0.54 0.1 165)` / `oklch(0.53 0.13 150)` / `oklch(0.54 0.14 300)` |

  Shadows, chip mixes and the scrollbar thumb are as darma's Themes section gives them.

## Consistency

- **One search entry per page:** the header's. Remove the ⌕ beside the mark in the sidebar.
- **Stale lines are muted** (`ink3`), as in 19a. **Failing and needs-reconnect lines** use `caution`.
  17 and 19b show stale in `caution`; change them.
- **Security rows:** pick one. Either every board has the leading icons from 03, or none does.
- **The pinned shelf** is rows, as in 01, at any count. 10's cards are a different element. A
  pinned email's line is its subject and summary, not a date pulled out of it.
- **19a:** a needs-reconnect account shows its warning glyph **and** its count, as in 17.
- **The mini-month** (11): drop the filled discs behind every day. With a recurring event they mark
  every day, so they mean nothing. Keep today and the selected day, and the week highlight in 16.
- **Todoist's toggle** has its checkbox on the left like the calendars, keeping its ring glyph as
  the colour mark.
- **14:** one Save button.
- **13:** "Study group" also appears on 11 and 12 (Wed, Oct 9, 6:30–8:30 PM, Classes) so the
  conflict is real across boards.
- **Month view titles** end in "…" when clipped ("Renew car registratio" doesn't).
- **Key hints** read "Esc", not "esc".
- **21 Phone:** the list's swipe or action sheet offers Mark read as well as Mark unread.
- **18a:** the written and learned Northwind rules contradict each other. Make the written one about
  something else, for example `university.edu` with "Registrar" → Attention.

## Keep (don't lose these)

The org preview on collapsed groups, the Protected chip, the code row with Copy and its expiry, the
facts card on security mail (03), search's labelled chips and per-result reasons, Alfred's sources
and follow-up field, the proposal's "from the email" marks and its conflict line, the pattern
prompt, "Leave by 2:05 PM · 18 min", the precision figure as 82% with its explanation (17), the
offline pill and dimming, "Try again" and "Move back" on a failed change, and all of 12c.

## Also draw

- A busy day, so the "+3" overflow and its popover appear.
- 12d, the drag and glide from a dropped position (above).
- 22a and 22b again, in darma's Light.
