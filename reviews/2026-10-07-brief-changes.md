# BRIEF.md changes since round 1

These are the only edits to the brief since you drew round 1. Everything else is unchanged.

## Vocabulary

**Kind** now reads: What an email is: Deliveries, Money, **Career**, Security, Updates, **People**,
Other. Groups FYI. (Not Work or Personal: those are account names.)

## Mail › Triage

**kind** now reads: the FYI group (Deliveries, Money, **Career**, Security, Updates, **People**,
Other). Career is job applications and recruiters; People is mail from actual people.

## Mail › The Inbox

The sketch now shows **ATTENTION · 3** (the protected Google email first, then Northwind, then the
read Contoso University email) and **CAREER · 1** in place of WORK · 1.

New bullet after the one on Attention:

> **Every row shows its account as a colour dot and its label**, in every group and while the
> reading pane is open; the label is the one chip that never drops.

## Mail › The reader

The first bullet is now:

> **A reading pane, never a full-screen reader.** The list is on the left, the open email on the
> right; Andy reads several emails in a sitting. With nothing open (All caught up, a fresh load) the
> pane collapses and the list takes the width; it opens with the first email.

## Calendar

**Month grid** is now:

> Infinite scroll through months; events as **tinted chips** (the calendar's colour as text and a
> left bar on a light tint of it), and the **selected item becomes solid**, which is how selection
> shows: no outline ring; past events dimmed; Todoist tasks with darma's status glyphs (an empty
> ring when open, a filled disc with the check knocked out when done); a weather icon by each date
> that has a forecast; overflow folds into "+3". Titles end in "…" when clipped.

**Floating detail**, from "the way Google Calendar's does" on, is now:

> It's faster and closer than a side pane, and it's fun. Its motion is design round 1's board 12c:
> position overshoots about 3% (`cubic-bezier(.22, 1.3, .36, 1)`), 280 ms + 40 ms per 400 px of
> travel, capped at 380 ms; height and content use the standard curve; a click mid-glide retargets
> from the current velocity. **Placement:** per click, the side (right, left, above, below) that
> covers the fewest other items, right first. **Drag:** the card can be dragged anywhere and stays
> there; the next click glides it **from where it was left** to the new item. Edit hands the item
> to the editor in the right pane.

**Direct manipulation** adds:

> Moving or deleting one occurrence of a recurring event asks this / following / all on drop, as
> editing does.

## Notifications and mantel › The mail chip in mantel

The reconnect bullet is now:

> A source that needs reconnecting shows as an **alert** chip, "Business needs sign-in", exactly
> like the finance importer's sign-in chip: mail silently not arriving needs fixing now.

## Visual system › Colour

**`caution`** is now used for: the attention pill, **failing** and needs-reconnect lines. **Stale
lines stay muted (`ink3`).**

## Copy

Ages ("now", "4m", "2h", "Yesterday", "Mon", "Oct 1") apply in the Inbox and search. **Under All's
day headings, rows use clock times** ("8:52 AM"), where an age would repeat the heading.

## Sample data

The Work row's group is now **Career**. Noise is 6: Business 2, Personal 4. The sidebar line is
replaced with:

> Counts (every board uses these): **3** attention not Done (the Contoso University one is read); **11**
> unread FYI (Security 3, Deliveries 4, Money 3, Career 1); **19** unread in all, Noise included.
> Sidebar: Inbox (3) 19; Business 7, Personal 8, Work 1, Jobs 2, iCloud 1. mantel's chip: "3
> attention | 11 FYI". One version of each email everywhere: the Parkside email is from Dana
> Whitfield, offers renewal to Nov 30, 2026, must be signed by Oct 31, and attaches "Renewal
> agreement.pdf"; Blue Door is at 2118 Sunset Blvd; Dinner with Sam is 7–9 PM.

## Boards to draw

Board 24 is now: Setpoint's **mark**: a placeholder for now (round 1's options are parked; Andy
picks later).

## Decisions so far (new, at the end)

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
44. **The mark is a placeholder**; Andy picks one later.
45. **Light uses darma's Light tokens** exactly; round 1 guessed them.
