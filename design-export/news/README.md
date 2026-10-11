# Setpoint v2 · News boards (design round 3)

These are boards 25–31 for [News](../../BRIEF.md#news-after-20). Claude drew them on 2026-10-10 on
a Claude Design canvas, from the brief, and Andy reviewed them there. Each board is plain HTML on
the round-2 stylesheet (`../styles/setpoint.css`) plus [`news.css`](news.css). That file holds
News's components, and the DESIGN.md overrides that the round-2 stylesheet doesn't carry: Light
`page` `#f6f6f4`, and the done glyph in `good`.
[DESIGN.md › News](../../DESIGN.md#news-after-20) wins over these boards wherever the two differ.

| # | Board | File |
| --- | --- | --- |
| 25 | News, a typical morning: All, the Missed strip, the pill, Upcoming, the brush fire story open | [`boards/25-news-a-typical-morning.html`](boards/25-news-a-typical-morning.html) |
| 26a | An article in the pane (NBC Los Angeles) | [`boards/26a-an-article-in-the-pane.html`](boards/26a-an-article-in-the-pane.html) |
| 26b | An article that can't be read in-app (KTLA) | [`boards/26b-an-article-that-cant-be-read-in-app.html`](boards/26b-an-article-that-cant-be-read-in-app.html) |
| 27 | A section: Local's full list | [`boards/27-a-section-local.html`](boards/27-a-section-local.html) |
| 28 | Missed: the catch-up list | [`boards/28-missed.html`](boards/28-missed.html) |
| 29a | States: Unsorted, a stale section, a section with nothing new | [`boards/29a-states-unsorted-stale-nothing-new.html`](boards/29a-states-unsorted-stale-nothing-new.html) |
| 29b | States: the first run | [`boards/29b-states-first-run.html`](boards/29b-states-first-run.html) |
| 30a | Settings › News | [`boards/30a-settings-news.html`](boards/30a-settings-news.html) |
| 30b | Settings › AI with News | [`boards/30b-settings-ai.html`](boards/30b-settings-ai.html) |
| 31 | Light version of 25 | [`boards/31-light-news.html`](boards/31-light-news.html) |

## How these differ from round 2's boards

- **Photos are placeholders:** a tinted, hatched block with the outlet's name. The app shows the
  story's real image (copied and resized by Setpoint), cropped to fill.
- **Icons come from the network.** The bundled icon subset lacks these icons, so each board loads
  the full Material Symbols Rounded font from Google Fonts: `newspaper`, `arrow_back`,
  `arrow_upward`, `info`, `pending`, `live_tv`, `local_police`, `thunderstorm`, `earthquake`,
  `local_fire_department` and `travel_explore`. The build adds their paths to
  `glyphs/icons.json`, at the same settings as the rest. `image` is only drawn inside the
  placeholders.
- **In the board audit from N4:** `npm run audit:boards` reads these boards too (25–31, N5 adding 29–31),
  drawing News's icons from `glyphs/icons.json` rather than the network.
- **Links:** "Catch up" on board 25 opens board 28, and board 28's back arrow returns to 25.
