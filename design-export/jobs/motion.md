# Setpoint v2 · Jobs motion notes (design round 4)

Each board's motion note from the canvas, with its values. Every duration uses `cubic-bezier(.2,0,0,1)` unless a note says otherwise.

## 32 · Jobs, a typical morning

[`boards/32-jobs-a-typical-morning.html`](boards/32-jobs-a-typical-morning.html)

Motion · the detail opening and collapsing

- Open (Enter or a click): the pane takes its 680 px at once, as the reading pane does, and its content slides in 12 px from the right, opacity 0 → 1, 180 ms cubic-bezier(.2,0,0,1). The table re-lays in the same frame (Platform drops, JD becomes a glyph); no width tween, so no text reflows mid-motion.
- The open row takes sub3 and its 2 px accent bar at once (a click is a press: 80 ms in).
- J / K or another row: the pane stays; its content swaps instantly, the old row's fill going back over 120 ms.
- Collapse (Esc, or the open row again): content fades 120 ms, then the pane goes and Platform comes back in one frame.
- Keys: J/K move · Enter open · O open the posting · / search · Esc back, then close.

## 32b · A narrow window, 1024 wide: Jobs in the rail, the detail over the table

[`boards/32b-a-narrow-window.html`](boards/32b-a-narrow-window.html)

A narrow window (640–1099 px, decision 71) is still the desktop.

- The rail: Jobs takes its slot after News, its Needs you count a 16 px neutral badge (sub4, ink), not the Inbox's caution one.
- The detail lies over the table under the header, led by Back (arrow_back, "Back · Esc"); Esc, J / K and ↑ ↓ work as beside the table. It arrives 12 px from the right over 180 ms, as the reading pane's content does, and Back slides it off the same way.
- The header keeps both numbers: the status segments never wrap; the search field gives way first, then the per-week chart's label (it keeps its bars and count).

## 33 · The JD's full text

[`boards/33-the-jds-full-text.html`](boards/33-the-jds-full-text.html)

Motion · the JD's full text expanding

- "Show full posting" (or Space on it): the row becomes the section's sticky head, sub → sub2 over 120 ms, its chevron turning 180° over 180 ms.
- The text unfolds below it: clip-path inset from the bottom, 0 → its height over 260 ms cubic-bezier(.2,0,0,1); paragraphs fade 0 → 1 over 180 ms starting at 60 ms.
- In the same 260 ms the pane scrolls the head up to sit under the tools, so the summary and lists slide up out of view rather than the text appearing off-screen.
- Collapse (the head, or Esc once): 180 ms, the reverse, and the pane scrolls back to where the row was.
- O still opens the original posting, which may be gone; the kept text never changes.

## 34a · Needs you, each kind · Assign to…

[`boards/34a-needs-you-each-kind.html`](boards/34a-needs-you-each-kind.html)

Motion · Needs you

- Assign to… grows from the button's bottom-left corner: 4 px and .97 → place, opacity 0 → 1, 180 ms. A pick or Esc closes it at once.
- A candidate's halves answer separately: the pick fills sub (120 ms), the arrow sub with ink; a press is sub2 over 80 ms, .97.
- Picking: see 34b for the item resolving and leaving.

## 34b · An item resolving · From history expanded

[`boards/34b-an-item-resolving-from-history.html`](boards/34b-an-item-resolving-from-history.html)

Motion · a Needs you item resolving and leaving (as the Today block's task does, #106)

1. 0 ms: the press lands (sub2, 80 ms). The item's line 2 crossfades to its outcome, "JD saved" after a 16 px good check (120 ms out, 120 ms in).
2. 360 ms: the item folds away: height → 0 over 180 ms cubic-bezier(.2,0,0,1), opacity → 0 over 120 ms; the items and table below ride up with it. The band's count and the sidebar's change as the fold starts.
3. The toast says what happened with Undo for 6 s ("JD saved for Lucerne Publishing · Undo"); Undo folds the item back (180 ms).
- The last item leaving folds the whole band, header and all, over 180 ms. From history alone keeps a 36 px line.
- Track this: the new application lands in the table at its date and settles in from sub2 over 900 ms (the arrival rule News uses).
- From history: rows unfold 180 ms, chevron turns 90°.
- Dismiss all (decision 70) is the same as ignoring each item, so those emails make nothing: the six rows fold away together (180 ms), then the line itself; toast "Dismissed 6 from history · Undo".

## 34c · Track this, resolved: Wide World's detail, first seen in this email

[`boards/34c-track-this-resolved.html`](boards/34c-track-this-resolved.html)

Track this, resolved (decision 69)

- The item folds away as in 34b; the new application lands at the top of the table, at today's date (its email's), settling from sub2 over 900 ms, and opens.
- Its Applied date is the email's, and the detail says "First seen in this email", since the real one is unknown; the timeline marks the event First seen.
- Its JD is being looked up: the shared spinner (900 ms a turn) and the summary's skeleton, breathing (opacity 1 → .45 → 1 over 1600 ms); what comes fades in over 120 ms.
- The numbers move with it: All 63, In process 4, this week 4. Needs you drops to 2.

## 35a · Corrections · title edited in place, an event's Move to…

[`boards/35a-corrections-edit-in-place-move-to.html`](boards/35a-corrections-edit-in-place-move-to.html)

Motion · corrections in place

- Under the pointer, the title takes a sub fill and a 16 px edit glyph after it (fade 120 ms). A click swaps the text for a field on the same baseline: no jump, the edgeFocus ring arrives over 120 ms. Enter saves, Esc cancels, both instant.
- An event's ··· (shown on hover) opens its menu from the button's top-right corner, 180 ms; Move to… opens its submenu to the left at the item's height, 180 ms.
- Moved: the event folds out of this timeline (180 ms) and the toast says "Moved to Junior Developer · Undo". Not about this: it folds out and lands in Needs you.

## 35b · Corrections · More: Merge with…, Not an application, Not this posting

[`boards/35b-corrections-more-merge-with.html`](boards/35b-corrections-more-merge-with.html)

Motion · More's corrections

- More grows from its top-right corner (4 px, .97, 180 ms); Merge with… opens its submenu to the left, 180 ms, its field focused.
- Merged: the other row folds out of the table (180 ms); this timeline gains its emails, each settling in from sub2 over 900 ms. Toast: "Merged · Undo".
- Not an application / Delete: the row folds away 180 ms, the pane closes (120 ms fade), toast with Undo for 6 s.
- Not this posting: the JD section crossfades to "Is this the posting?" with the other candidates (120 / 120 ms), or to "No JD found" when there are none.
- The two that remove it differ, and the menu says how: Not an application hides it and its emails never make one again; Delete forgets it, so a later email can make it again (decision 67).

## 36a · Search · humongous

[`boards/36a-search-humongous.html`](boards/36a-search-humongous.html)

Motion · search

- / (or a click) turns the header into Search: the title crossfades to "Search" 120 ms, the field widens 380 → 520 over 180 ms and focuses, Needs you folds away 180 ms while a query is in.
- Results replace the table's rows as you type, instantly: no animation on each keystroke. Highlights are drawn with the rows.
- Esc clears, then a second Esc brings the header and the table back at their scroll, Needs you unfolding 180 ms.

## 36b · Search · kubernetes, in a JD's text

[`boards/36b-search-kubernetes.html`](boards/36b-search-kubernetes.html)

Search reads company and title first, then JD text: a match only in a JD shows under its own label with the line it matched, so "which one asked for Kubernetes?" answers itself without opening anything. Loose on company names: "wide world" finds Wide World Importers.

## 37a · In mail · the JD chip in the reader

[`boards/37a-in-mail-the-jd-chip.html`](boards/37a-in-mail-the-jd-chip.html)

Motion · the chip and the badge

- The JD chip and the badge answer the pointer like an outlined control: sub fill, edgeHover ring, 120 ms.
- The chip draws with the head (no entrance of its own) when the email opens.

## 37b · In mail · the chip opens its JD

[`boards/37b-in-mail-the-chip-opens-its-jd.html`](boards/37b-in-mail-the-chip-opens-its-jd.html)

Motion · the mail chip opening its JD

- The popover grows from the chip's bottom-left corner: translateY 4 px → 0, scale .97 → 1, opacity 0 → 1, 180 ms cubic-bezier(.2,0,0,1). The chip takes sub2 and its chevron turns 180° in the same 180 ms.
- Closes at once: Esc, a click away, or the chip again.
- Open in Jobs goes to Jobs with this application already open: the pane is simply there, no slide (it's arriving, not opening).

## 37c · In mail · Applied before, on the row and in the reader

[`boards/37c-in-mail-applied-before.html`](boards/37c-in-mail-applied-before.html)

The badge opens Jobs searched for the company ("contoso pharmaceuticals"), showing every application there. It shows on job-match emails only, on the row and in the reader. The Inbox's counts don't change.

## 38a · States · the history pass running

[`boards/38a-states-the-history-pass.html`](boards/38a-states-the-history-pass.html)

Motion · the history pass's progress, and a row moving status

- The line's 2 px track (sub2) fills in ink3, radius 0 2 2 0, its width easing over 260 ms as each count comes. The counts change in place, tabular, unanimated.
- Each application lands at its date's place as it's made and settles in from sub2 over 900 ms. A landed row never moves except by a sort.
- A row moving status (an email moves it Applied → In process): the status cell crossfades, 120 ms out then 120 ms in, and the row settles from sub2 over 900 ms. In a filtered view it stays put until the next visit, as News holds its order.
- Done: the line shows a good check and "Read 330 emails" for 1.2 s, then folds away 180 ms.

## 38b · States · 5 emails not read yet, No JD found, Ghosted, set by hand

[`boards/38b-states-not-read-no-jd-ghosted-set-by-hand.html`](boards/38b-states-not-read-no-jd-ghosted-set-by-hand.html)

Motion · lines

- "5 emails not read yet" folds in (180 ms) when the AI stops answering and out when it's back, showing a good check for 1.2 s first, as mail's health lines do.
- Ghosted and a status set by hand are drawn, not animated: Ghosted appears when the 30 days pass, on the next draw.
- A status set by hand (Alpine's Withdrawn) gives way only to an email that sets a status: an assessment, interview, offer or rejection. Quiet emails never undo it (decision 68). No JD found offers Look it up by hand; Jobs never retries on its own (decision 66).

## 38c · States · Jobs off

[`boards/38c-states-jobs-off.html`](boards/38c-states-jobs-off.html)

Jobs off: the page is one line and an action, under the empty state's 20 px glyph. Turn on opens Settings › Jobs (260 ms, Settings' own entrance) with the switch focused, so turning it on is a choice there, where the accounts it reads are listed.

## 39a · Settings › Jobs

[`boards/39a-settings-jobs.html`](boards/39a-settings-jobs.html)

Motion · Settings › Jobs

- The switch's knob travels 120 ms; pressed, it stretches toward its travel (#151).
- Turning Jobs on starts the history pass: its row shows the same progress line as 38a (260 ms easing), and Jobs appears in the sidebar under News, folding in 180 ms.

## 39b · Settings › AI with Jobs

[`boards/39b-settings-ai.html`](boards/39b-settings-ai.html)

No cap for Jobs (D315), so no meter: a cap that stopped search would read as a failure. This month's spend is a figure, and Usage this month gains a Jobs row broken into its three parts, as News's is.

## 40 · Light version of 32

[`boards/40-light-jobs.html`](boards/40-light-jobs.html)

Light · same motion as 32. A theme switch fades every colour over 180 ms; the first paint doesn't fade.

Light's own values come from DESIGN.md: page #f6f6f4, ink2 #4b4d52, cardOn #fff, navOn #fff with its hairline, Light `good` oklch(.53 .13 150) for Offer.

## States · hover, press, cursor, selected

[`boards/states-hover-and-state.html`](boards/states-hover-and-state.html)

Every state on this strip changes over 120 ms cubic-bezier(.2,0,0,1). A press goes in over 80 ms and lets go over 120 ms: pills .97, icon buttons .92, rows and menu items never scale, they only take the fill step. The keyboard cursor and selection are fills (sub2, the open row sub3 with its 2 px accent bar), never rings. Durations used anywhere on Jobs: 80 (press), 120 (fills, fades), 180 (menus, popovers, panes, folds), 260 (the JD unfolding, the progress track, Settings), and 900 for an arrival settling from sub2.
