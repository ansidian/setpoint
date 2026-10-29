# Setpoint v2 · Jobs boards (design round 4)

These are boards 32–40 for [Jobs](../../BRIEF.md#jobs-after-20), plus 32b, 34c and a states strip. Claude
drew them on 2026-10-29 on a Claude Design canvas, from the brief (decisions 49–63), and Andy reviewed them
there; his answers to the round's questions (decisions 64–73) are drawn in. Each board is plain HTML on the
round-2 stylesheet (`../styles/setpoint.css`) plus [`jobs.css`](jobs.css). That file holds Jobs's
components, and the DESIGN.md overrides and tokens that the round-2 stylesheet doesn't carry, at the values
`web/src/tokens.ts` ships: Night `panel` and `ink3`, Light `page`, `ink2` and `cardOn`, `navOn`, `accent`,
`sub4`, `edgeFocus`, `hl`, `switchOn`, and the done glyph in `good`. It adds no new tokens.
[DESIGN.md](../../DESIGN.md) wins over these boards wherever the two differ; its Jobs section comes next.

Each board's motion, with its values, is in [`motion.md`](motion.md).

| # | Board | Size | File |
| --- | --- | --- | --- |
| 32 | Jobs, a typical morning: the two numbers, Needs you with its three items and From history folded, the table, Northwind's application open | 1677 × 1050 | [`boards/32-jobs-a-typical-morning.html`](boards/32-jobs-a-typical-morning.html) |
| 32b | A narrow window, 1024 wide: Jobs in the icon rail after News, the detail over the table | 1024 × 768 | [`boards/32b-a-narrow-window.html`](boards/32b-a-narrow-window.html) |
| 33 | The JD's full text, unfolded in place in Northwind's detail, with its link and how it was found | 1677 × 1050 | [`boards/33-the-jds-full-text.html`](boards/33-the-jds-full-text.html) |
| 34a | Needs you, each kind: Lucerne's candidates, Humongous's Assign to… (open), Wide World's Track this | 1677 × 1050 | [`boards/34a-needs-you-each-kind.html`](boards/34a-needs-you-each-kind.html) |
| 34b | An item resolving (Lucerne's JD saved), From history expanded with Dismiss all | 1677 × 1050 | [`boards/34b-an-item-resolving-from-history.html`](boards/34b-an-item-resolving-from-history.html) |
| 34c | Track this, resolved: Wide World's application, first seen in this email, its JD being looked up | 1677 × 1050 | [`boards/34c-track-this-resolved.html`](boards/34c-track-this-resolved.html) |
| 35a | Corrections: a title edited in place, an event's Move to… | 1677 × 1050 | [`boards/35a-corrections-edit-in-place-move-to.html`](boards/35a-corrections-edit-in-place-move-to.html) |
| 35b | Corrections: More, with Merge with…, Not this posting, Not an application and Delete | 1677 × 1050 | [`boards/35b-corrections-more-merge-with.html`](boards/35b-corrections-more-merge-with.html) |
| 36a | Search on Jobs: `humongous` | 1677 × 1050 | [`boards/36a-search-humongous.html`](boards/36a-search-humongous.html) |
| 36b | Search on Jobs: `kubernetes`, matching a JD's text | 1677 × 1050 | [`boards/36b-search-kubernetes.html`](boards/36b-search-kubernetes.html) |
| 37a | In mail: the Northwind interview email in the reader with the JD chip | 1677 × 1050 | [`boards/37a-in-mail-the-jd-chip.html`](boards/37a-in-mail-the-jd-chip.html) |
| 37b | In mail: the chip opening its JD | 1677 × 1050 | [`boards/37b-in-mail-the-chip-opens-its-jd.html`](boards/37b-in-mail-the-chip-opens-its-jd.html) |
| 37c | In mail: Contoso Pharmaceuticals' match email, Applied before on its row and in the reader | 1677 × 1050 | [`boards/37c-in-mail-applied-before.html`](boards/37c-in-mail-applied-before.html) |
| 38a | States: the history pass running, the table filling | 1677 × 1050 | [`boards/38a-states-the-history-pass.html`](boards/38a-states-the-history-pass.html) |
| 38b | States: 5 emails not read yet, No JD found with Look it up, a Ghosted row, a status set by hand | 1677 × 1050 | [`boards/38b-states-not-read-no-jd-ghosted-set-by-hand.html`](boards/38b-states-not-read-no-jd-ghosted-set-by-hand.html) |
| 38c | States: Jobs off | 1677 × 1050 | [`boards/38c-states-jobs-off.html`](boards/38c-states-jobs-off.html) |
| 39a | Settings › Jobs | 1677 × 1050 | [`boards/39a-settings-jobs.html`](boards/39a-settings-jobs.html) |
| 39b | Settings › AI with Jobs' models and spend | 1677 × 1050 | [`boards/39b-settings-ai.html`](boards/39b-settings-ai.html) |
| 40 | Light version of 32 | 1677 × 1050 | [`boards/40-light-jobs.html`](boards/40-light-jobs.html) |
| States | Hover and state: every control at rest, under the pointer, pressed, under the keyboard cursor, and selected or open | 1677 × 1180 | [`boards/states-hover-and-state.html`](boards/states-hover-and-state.html) |

## What the boards settle

- **The two numbers sit in the header.** Counts by status are its segmented control, so a count also filters
  the table. Applications per week is a 12-bar chart beside search, this week's bar outlined since the week
  isn't over.
- **Needs you is a band above the table**, drawn like Attention's but without `caution`: its count is
  `ink2`, in the band and in the sidebar, since Jobs informs and never nags (D313).
- **The detail opens where the reading pane does** (680 px). While it's open, the Platform column drops and
  JD becomes a glyph, as mail drops its chips beside the reader. Platform shows only while the pane is
  closed.
- **The JD's full text unfolds in place** under the summary and lists, rather than replacing them.
- **Corrections stay out of sight until wanted:** the pane's More menu, a pencil on hover over the title,
  and a ··· on each timeline event.
- **Statuses take existing colours only:** Applied `ink2`, In process `ink` 500, Offer `good`, Rejected and
  Withdrawn `ink3`. Ghosted and closed rows step down to `ink2` and `ink3`, never to lower opacity, which
  already means a change waiting for its provider.

## How these differ from round 3's boards

- **Icons come from the network.** As in round 3, the bundled icon subset lacks these icons, so each board
  loads the full Material Symbols Rounded font from Google Fonts: among them `work`, `pending_actions`,
  `alt_route`, `bookmark_add`, `move_item`, `home_work`, `payments`, `merge`, `lock_clock`,
  `travel_explore`, `radio_button_checked` and `progress_activity`. The build adds their paths to
  `glyphs/icons.json`, at the same settings as the rest.
- **Board-only rules sit in each board's `<style>`, scoped under `.sp`.** 39a and 39b carry round 3's
  Settings page rules (from `news.css`), which `setpoint.css` doesn't have.
- **States are drawn with classes:** `.hov` is the pointer, `.press` a press held, `.cur` the keyboard
  cursor and `.open` what the pane shows. The app reaches the same fills with `:hover` and `:active`.
- **Invented beyond the brief's sample:**
  - From history's six items
  - Northwind's full posting text, and Humongous Insurance · Software Engineer II, Claims' JD
  - Wide World's role, "Junior Software Engineer", and its platform, LinkedIn
  - Woodgrove's JD sentence about Kubernetes and the Indeed match email's body
  - 38a's counts while the pass runs
  - 39a's "finished Oct 1, 8:14 PM"
  - 39b's spend ($3.85 for Jobs this month)
  - Links use example domains (`greenhouse.example`, `humongous.example`).
