# Setpoint

One inbox, my calendar and the day's news, sorted so catching up takes seconds.

Setpoint is my private workspace for mail and time: every email account in one inbox, my calendar
with Todoist tasks, and the day's biggest stories. It's built for one person, runs in one
container, and is used from a desktop browser, with a lighter layout for the phone.

![Marking an email Done, gliding between calendar events, and reading what's new in a story](docs/media/tile.gif)

> [!NOTE]
> This is Setpoint's second version, rebuilt from the ground up. The first is deprecated and
> archived at [ansidian/setpoint-classic](https://github.com/ansidian/setpoint-classic).

## What it does

**Alfred answers from my mail, with its source.** Ask a question in search and ⌘Enter asks Alfred.
The answer names the email it came from, one click away, and takes follow-ups.

![Alfred answering when a lease renewal needs to be signed, citing the email](docs/media/alfred.gif)

**Add to calendar, pre-filled from the email.** An email about an event becomes a proposal: the
title, time and place picked out, and whether that time is free. Nothing is added until I create it.

![An exam email becoming a calendar proposal, then an event](docs/media/proposal.gif)

**One detail card glides between events.** Clicking from event to event moves the same card, with
the place, when to leave and the reminder.

![The calendar's detail card gliding between events](docs/media/glide.gif)

**A new event from one typed line.** The day, time and place are picked out as they're typed, the
place is looked up, and conflicts show before it's created.

![Typing "Lunch with Priya thu 12:30-1:30pm @Blue Door" into the editor](docs/media/editor.gif)

**A repeating event asks which ones to move.** Drag one occurrence and choose this event, this and
following, or all of them, as in Google Calendar.

![Dragging a recurring event and choosing which occurrences move](docs/media/drag.gif)

**Eight outlets, one story.** News reads free sources, groups the articles about the same event
into one story, writes one summary with its sources, and shows what's new since I last looked.
Stories are ranked biggest first, and the small ones never show.

![A story covered by eight outlets, with its summary, sources and what's new](docs/media/news.gif)

**A keynote from the news, added to the calendar.** Upcoming events in the news can go straight to
the calendar's editor, pre-filled.

![Adding an upcoming event from News to the calendar](docs/media/upcoming.gif)

**The phone layout: Inbox, reader, agenda.**

![Setpoint on a phone: the Inbox, an email in the reader, and the week's agenda](docs/media/phone.webp)

## Stack

TypeScript throughout, as npm workspaces: `shared` (the contract, Zod schemas and API types),
`server` (Node, Hono, SQLite with Drizzle, IMAP and the Google and Todoist APIs) and `web` (React
and Vite). Claude sorts mail and News and answers as Alfred.

Tests: `npm test` runs lint, typecheck and Vitest; `npm run test:browser` runs Playwright checks
against approved screenshots.

## License

[MIT](LICENSE)
