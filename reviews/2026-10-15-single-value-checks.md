# Single-value browser checks: have they earned their cost?

2026-10-15. Read-only investigation for SV-75 / D268. Nothing was run and nothing changed besides this file.

**Question.** AGENTS.md › Tests own behaviour says a decision that is a single value (a gap, a colour, an alignment) also gets a browser check that states it. Have those reads (`getComputedStyle`, `getBoundingClientRect`, `boundingBox` in `web/tests/browser/*.spec.ts`) ever caught a real regression, against how often they needed a fix of their own?

**Short answer.** In the history that exists, no read can be shown to have caught an accidental regression, and about 1 in 10 read lines has needed its own edit. Almost all of the cost sits in the reads being edited alongside deliberate design changes, not in fixing the reads themselves. The accidents that did happen cluster in one category, colour and state fills in the cascade. Recommendation at the end: narrow.

## What the history can and cannot say

- The repo is 8 days old (2026-10-07 to 2026-10-15). It has had no quiet period in which a regression could appear, and a 535-line set of reads was mostly written the same day as the thing it states.
- History before the public launch is squashed into `ff21632` on master. The unsquashed history survives in the local tag `pre-public` (372 commits, 10-07 to 10-11, same tree as `ff21632`). I read it beside master's 168 later commits, so the sample is all 540 commits, 337 of which touched a spec. That tag must stay local.
- **Git cannot record that a check failed first.** A commit message says what changed, not what turned red. "A check caught it" therefore needs a darma statement (SV-40, SV-49, SV-58, SV-59 were read for these). Where neither says so I count it as not shown, which makes the "caught" column a floor. The same limit applies to timing flakes that were never committed.
- Classification is by regex over the diffs and by hand for the check-only commits. Counts are good to about ±10%. A "read" is a line with one of the three primitives; reads through helpers (`style(el, 'color')`, `colourOf`, `tokenColour`, `boxOf`) are counted only in the hunk-level rows, so the line counts understate the population (SV-75's migration wrapped 919 statements).

## The table

| | Colour tokens and fills | Animation names, durations, opacity | Gaps and alignments | Boxes (size, position, fit) |
|---|---|---|---|---|
| Read lines at HEAD (535) | 184 | 79 | 41 | 231 |
| Of these, lines ever edited since written (54 removed in total) | about 10 (5%) | about 17 (22%) | about 1 (2%) | about 26 (11%) |
| **Reads never changed** | **about 95%** | **about 78%** | **about 98%** | **about 89%** |
| Fixes to the check itself, check-only commits | 3 (+1 re-capture) | 3 | 0 | 5–6 |
| Reads edited in lockstep with a deliberate app change (hunks, 47 commits) | 60 | 21 | 22 | 58 |
| App-fix commits that added the read alongside the fix (of 116 app fixes, 47 distinct) | 19 | 8 | 6 | 29 |
| App fixes a read **caught first** | 0 shown, 1 plausible | 0 | 0 | 0 |

Hunk counts can fall under two categories. "Check-only commits" is 11 in all, plus the two harness commits `bec9ae1` and `f69add7`.

### Examples

**Fixes to the check itself** (the reads were right about the value, wrong about when to read it):
- Colour: `f23abe6` the outside-weekend fill read before its 180 ms ease ended; `019fcb5` the new-task ghost read before Settings and the projects answered; `9b506f5` the code-row colour reads.
- Animation: `a020071` the Inbox dim read as it dims; `b68365b` a 120–220 ms close and a theme fade read after the action, now recorded from before it; `c09c700` the glide retarget compared with the last drawn frame, so CPU load failed it.
- Boxes: `5c92e9a` long-page and New-since-you-looked measured while Settings' sections faded up; `1714e4a` the story pane measured part-way through its slide-in; `92fba15` the quarter-full pane under a running clock; `e9f850c` text widths read before web fonts (`phone.spec.ts:84` measured 379 against a 374 row; also `detail`, `week`, `settings`, `mail` reads of the calendar's name, project names and account labels).
- Gaps and alignments: none. Their reads are mostly static CSS (`padding`, `gap`, `text-align`), which do not move with timing.
- Harness: `bec9ae1` `still` hung under a paused page clock; SV-75's migration surfaced six reads that mean to catch motion and now say so on the line before.

**Edited in lockstep with a deliberate change** (the value moved because the design did): `c3a06b7` the Settings nav check from `sub2` to the raised chip; `dc67afe` and `a126d98` press and meter colours; `dfd5e36` the pending spinner, which shows after a second; `2bc13ba` an attachment card from exactly 280 wide to "at least 280". The polish audit (SV-54, 183 picks) re-stated hundreds of reads this way, each beside a re-captured golden.

**Written with an app fix** (the check pins the fixed value; the bug was found by Andy's review or the audit): `2fd93eb` a weekend outside the month took the weekend tint, a CSS-order slip (colour); `9f7571e` reader tools kept in a narrow pane; `f870dd9` SV-73's clipped Done tag on the phone; `b38e067` sign-in fields 16 px so iOS does not zoom; `80df40a` a segmented thumb resizing as fonts arrive; `6e3e3fa` overlays beside their items under the 1.25 zoom (`zoom.spec.ts` was new in that commit).

**Caught first**:
- Confirmed: none.
- Plausible, colour: Settings' current-page marker was lost twice in a day. `3ba6b9c` (16:17) fixed it for keyboard focus and added a read of the fill. When the colour slice's raised chip landed, `ddcc483` (18:18) fixed the chip under focus and a warning glyph clobbered by `.nav .icon`; `c3a06b7` then updated the old read. Whether the old read went red before `ddcc483` is not recorded.
- Shown failing on purpose, so not regressions: SV-58 says the band-cursor, weekend-shading and Settings-focus checks "failed on the old code first" (colour, written test-first); SV-40 D83 shows `detail:215` (a box read of a glide's start) failing with the app changed to restart from the first glide's start (493 px off).
- Several box checks were written with the bug they pinned, so they may have found it (`6e3e3fa`, `88d657b` a reading pane 1 px wide at 640–1099, `ba38464` the header month flipping). The commits do not say which came first.

**Never changed**: most of the 535 lines, for example those in `colour.spec.ts` (23 checks) and `calendarFeel.spec.ts`, written in the polish audit's last days, so they have had little time to move.

## What the rule costs

- Each of the roughly 900 reads now rests before it reads (`rested`, SV-75). A full run was 3m29s with tracing against 3m19s without, and a full stress run 10m23s against 9m11s.
- A deliberate design change edits its reads and its goldens, so it states the new value twice. 47 commits did so (33 feat, 9 fix, 5 chore); this is the largest recurring cost, larger than check-only fixes (11 commits).
- Check-only fixes to style/box reads were about 12 in 8 days, nearly all "read mid-motion or before a late answer", the class `rested` now addresses. The trace on failure shortens each one that remains.

## What the reads buy

- Goldens (D69) already cover rest states pixel for pixel. Single-value reads add value where a golden cannot reach: hover, press, focus, selected and out-of-month fills, Light against Night, animation and transition names, and zoomed or off-screen layouts.
- The accidents on record (Settings marker twice, weekend tint order, warning glyph overridden, thumb resizing) are cascade accidents in colour and state, found by eye or audit and pinned afterwards. A pin has no payoff until the same value moves by accident later, which this 8-day history has not had time to show.

## Recommendation

**Narrow the rule; do not drop it, and do not keep it as written.** State a single value in a browser check when it is (1) a colour or fill that depends on state, theme or cascade order (hover, press, focus, selected, out-of-month, Light against Night, role colours like the warning glyph), (2) a relation rather than a literal: fits or clips, sits beside or inside, equal room, a width at a breakpoint, and (3) a value that has already moved by accident, pinned in the commit that fixes it (already the habit: 47 of 116 app fixes). Leave plain restatements of the stylesheet to the golden or to `tokens.test.ts`, which already tables the tokens: literal px for padding, gap or font size, and animation names or durations that only repeat a motion token. **Trade-off:** the narrower rule removes the reads that restate CSS (the 41 gap lines, plus an unmeasured share of the box, typography and duration reads), with their rest cost and their lockstep edits, at the price of those values being guarded only by a golden's pixel diff, which can miss a 1–2 px or 20 ms drift that nobody looks at. The evidence supports neither extreme: no read has a recorded catch, but the history is 8 days of slices built with their own checks, so absence of catches is weak evidence against them. **Revisit** after the first release cycle in which nothing is under construction: count how many reads went red for a reason other than a deliberate change. Start that count now by putting "check went red on its own" in the fix commit's message, since git has no other record.
